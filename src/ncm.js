'use strict';

// NCM container/key-box algorithm: taurusxin/ncmdump (MIT).
// https://github.com/taurusxin/ncmdump/blob/main/src/ncmcrypt.cpp
// This module uses Node's crypto implementation and bounded, positional I/O.
const { open } = require('node:fs/promises');
const { createDecipheriv } = require('node:crypto');

const CORE_KEY = Buffer.from('687A4852416D736F356B496E62617857', 'hex');
const META_KEY = Buffer.from('2331346C6A6B5F215C5D2630553C2728', 'hex');
const MAGIC = Buffer.from('CTENFDAM');
const KEY_PREFIX = Buffer.from('neteasecloudmusic');
const META_PREFIX = "163 key(Don't modify):";
const MAX_KEY_BYTES = 1024 * 1024;
const MAX_METADATA_BYTES = 8 * 1024 * 1024;
const MAX_COVER_BYTES = 16 * 1024 * 1024;
const CHUNK_BYTES = 256 * 1024;

function invalid(message) {
  const error = new Error(message);
  error.code = 'ERR_NCM_INVALID';
  return error;
}

function checkAbort(signal) {
  if (signal?.aborted) {
    const error = new Error('已取消转换');
    error.name = 'AbortError';
    error.code = 'ABORT_ERR';
    throw error;
  }
}

function decryptAes(bytes, key) {
  if (!bytes.length || bytes.length % 16 !== 0) {
    throw invalid('加密区块长度不正确');
  }
  const decipher = createDecipheriv('aes-128-ecb', key, null);
  return Buffer.concat([decipher.update(bytes), decipher.final()]);
}

function makeKeystream(encryptedKey) {
  const raw = Buffer.from(encryptedKey);
  for (let i = 0; i < raw.length; i += 1) raw[i] ^= 0x64;
  let clear;
  try {
    clear = decryptAes(raw, CORE_KEY);
  } catch {
    throw invalid('NCM 密钥区块损坏，无法还原音频');
  }
  if (clear.length <= KEY_PREFIX.length || !clear.subarray(0, 17).equals(KEY_PREFIX)) {
    throw invalid('NCM 密钥内容不正确，文件可能已损坏或格式不受支持');
  }
  const key = clear.subarray(KEY_PREFIX.length);
  const box = Uint8Array.from({ length: 256 }, (_, i) => i);
  let last = 0;
  for (let i = 0; i < 256; i += 1) {
    const swap = box[i];
    const next = (swap + last + key[i % key.length]) & 0xff;
    box[i] = box[next];
    box[next] = swap;
    last = next;
  }
  return Uint8Array.from({ length: 256 }, (_, i) => {
    const j = (i + 1) & 0xff;
    return box[(box[j] + box[(box[j] + j) & 0xff]) & 0xff];
  });
}

function text(value) {
  return typeof value === 'string' ? value.replaceAll('\0', '').trim() : '';
}

function readMetadata(bytes) {
  const raw = Buffer.from(bytes);
  for (let i = 0; i < raw.length; i += 1) raw[i] ^= 0x63;
  const encoded = raw.toString('utf8');
  if (!encoded.startsWith(META_PREFIX)) throw invalid('歌曲信息前缀不正确');
  const base64 = encoded.slice(META_PREFIX.length);
  if (!base64.length || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
    throw invalid('歌曲信息编码不正确');
  }
  const clear = decryptAes(Buffer.from(base64, 'base64'), META_KEY).toString('utf8');
  if (!clear.startsWith('music:')) throw invalid('歌曲信息格式不受支持');
  const data = JSON.parse(clear.slice(6));
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw invalid('歌曲信息不是有效对象');
  }
  const artists = Array.isArray(data.artist)
    ? data.artist.map((artist) => text(Array.isArray(artist) ? artist[0] : artist?.name ?? artist)).filter(Boolean)
    : [text(data.artist)].filter(Boolean);
  return {
    title: text(data.musicName),
    artist: artists.join('/'),
    album: text(data.album),
    // NCM stores duration in milliseconds; the public interface uses seconds.
    duration: typeof data.duration === 'number' && Number.isFinite(data.duration) && data.duration > 0
      ? data.duration / 1000 : null,
  };
}

function audioFormat(bytes) {
  if (bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from('fLaC'))) return 'flac';
  if (bytes.length >= 3 && bytes.subarray(0, 3).equals(Buffer.from('ID3'))) return 'mp3';
  // MPEG Layer III frame, with a valid version, bitrate and sample-rate field.
  if (bytes.length >= 4 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0
      && ((bytes[1] >> 3) & 3) !== 1 && ((bytes[1] >> 1) & 3) === 1
      && (bytes[2] >> 4) !== 0 && (bytes[2] >> 4) !== 15 && ((bytes[2] >> 2) & 3) !== 3) return 'mp3';
  throw invalid('还原后的音频不是受支持的 MP3 或 FLAC，文件可能已损坏');
}

function coverMime(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  return null;
}

/**
 * Restore the original audio in a local NCM container without loading it in full.
 * outputPath must be a new temporary file; partial output is left for the caller
 * to clean up after an error/cancellation. This function never changes inputPath.
 *
 * @returns {Promise<{format: 'mp3'|'flac', metadata: {
 *   title: string, artist: string, album: string, duration: number|null
 * }, cover?: {data: Buffer, mime: string}, warnings: string[]}>}
 */
async function decodeNcm(inputPath, outputPath, { signal, onProgress } = {}) {
  let input;
  let output;
  checkAbort(signal);
  try {
    input = await open(inputPath, 'r');
    const stat = await input.stat();
    if (!stat.isFile()) throw invalid('请选择 NCM 文件，不能直接转换文件夹');
    if (!Number.isSafeInteger(stat.size)) throw invalid('文件过大，无法安全读取');
    let position = 0;
    const requireBytes = (length, label) => {
      if (!Number.isSafeInteger(length) || length < 0 || length > stat.size - position) {
        throw invalid(`NCM ${label}不完整，文件可能已截断`);
      }
    };
    const read = async (length, label) => {
      checkAbort(signal);
      requireBytes(length, label);
      const buffer = Buffer.alloc(length);
      let received = 0;
      while (received < length) {
        checkAbort(signal);
        const { bytesRead } = await input.read(buffer, received, length - received, position + received);
        if (!bytesRead) throw invalid(`NCM ${label}不完整，文件可能已截断`);
        received += bytesRead;
      }
      position += length;
      checkAbort(signal);
      return buffer;
    };
    const skip = (length, label) => {
      requireBytes(length, label);
      position += length;
    };
    const uint32 = async (label) => (await read(4, label)).readUInt32LE(0);
    const header = await read(10, '文件头');
    if (!header.subarray(0, 8).equals(MAGIC)) throw invalid('文件头不正确，这不是有效的 NCM 文件');
    const keyLength = await uint32('密钥长度');
    if (keyLength === 0 || keyLength > MAX_KEY_BYTES) throw invalid('NCM 密钥区块长度不合理');
    const keystream = makeKeystream(await read(keyLength, '密钥区块'));

    const warnings = [];
    let metadata = { title: '', artist: '', album: '', duration: null };
    const metadataLength = await uint32('歌曲信息长度');
    if (!metadataLength) {
      warnings.push('NCM 未包含歌曲信息，将保留音频内已有的信息');
    } else if (metadataLength > MAX_METADATA_BYTES) {
      skip(metadataLength, '歌曲信息区块');
      warnings.push('歌曲信息区块过大，已跳过，音频仍会继续处理');
    } else {
      // A broken payload may be ignored; an out-of-bounds length cannot be.
      const bytes = await read(metadataLength, '歌曲信息区块');
      try {
        metadata = readMetadata(bytes);
      } catch {
        warnings.push('歌曲信息无法读取，已跳过，音频仍会继续处理');
      }
    }

    await read(5, '校验及封面版本区块');
    const coverFrameLength = await uint32('封面预留长度');
    const coverLength = await uint32('封面长度');
    if (coverLength > coverFrameLength) throw invalid('NCM 封面长度超过封面区块，文件结构损坏');
    requireBytes(coverFrameLength, '封面区块');
    let cover;
    if (coverLength > MAX_COVER_BYTES) {
      skip(coverLength, '封面数据');
      warnings.push('封面图片过大，已跳过');
    } else if (coverLength > 0) {
      const data = await read(coverLength, '封面数据');
      const mime = coverMime(data);
      if (mime) cover = { data, mime };
      else warnings.push('封面图片格式无法识别，已跳过');
    }
    skip(coverFrameLength - coverLength, '封面预留区块');
    const audioBytes = stat.size - position;
    if (audioBytes === 0) throw invalid('NCM 文件没有音频内容');

    let completed = 0;
    let format;
    let reported = -1;
    const progress = (value) => {
      const percent = Math.max(0, Math.min(100, Math.floor(value)));
      if (percent !== reported) {
        reported = percent;
        onProgress?.(percent);
      }
      checkAbort(signal);
    };
    progress(0);
    while (completed < audioBytes) {
      const bytes = await read(Math.min(CHUNK_BYTES, audioBytes - completed), '音频数据');
      for (let i = 0; i < bytes.length; i += 1) bytes[i] ^= keystream[(completed + i) & 0xff];
      checkAbort(signal);
      if (!output) {
        format = audioFormat(bytes);
        output = await open(outputPath, 'wx');
        checkAbort(signal);
      }
      let written = 0;
      while (written < bytes.length) {
        checkAbort(signal);
        const result = await output.write(bytes, written, bytes.length - written);
        if (!result.bytesWritten) throw new Error('无法写入音频，请检查磁盘空间和输出目录权限');
        written += result.bytesWritten;
      }
      completed += bytes.length;
      progress(completed / audioBytes * 100);
    }
    await output.close();
    output = null;
    return { format, metadata, ...(cover ? { cover } : {}), warnings };
  } catch (error) {
    if (error.code === 'EEXIST') error.message = '输出文件已存在，为保护已有文件，本次转换已停止';
    if (error.code === 'ENOENT') error.message = '找不到输入文件或输出目录，请重新选择';
    if (error.code === 'EACCES' || error.code === 'EPERM') error.message = '没有权限读取文件或写入输出目录，请选择其他位置';
    if (error.code === 'ENOSPC') error.message = '磁盘空间不足，请清理空间后重试';
    throw error;
  } finally {
    // Await closure on both handles, including when the signal aborts mid-file.
    await Promise.allSettled([output?.close(), input?.close()]);
  }
}

module.exports = { decodeNcm };
