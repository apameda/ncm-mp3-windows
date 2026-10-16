'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, writeFile, readFile, stat, rm, rename } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { createCipheriv, randomBytes } = require('node:crypto');
const { decodeNcm } = require('../src/ncm');

const CORE_KEY = Buffer.from('hzHRAmso5kInbaxW');
const META_KEY = Buffer.from("#14ljk_!\\]&0U<'(");
const MUSIC_KEY = Buffer.from('independent fixture audio key');

function encrypted(bytes, key, xor) {
  const cipher = createCipheriv('aes-128-ecb', key, null);
  const result = Buffer.concat([cipher.update(bytes), cipher.final()]);
  if (xor !== undefined) for (let i = 0; i < result.length; i += 1) result[i] ^= xor;
  return result;
}

function uint32(value) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
}

// Synthetic fixtures contain no copyrighted recordings. Encode the NCM byte
// layout directly so tests can vary lengths independently from the decoder.
function fixture(audio, { metadata = null, metadataBytes, cover = Buffer.alloc(0), coverPadding = 0 } = {}) {
  const keyBlock = encrypted(Buffer.concat([Buffer.from('neteasecloudmusic'), MUSIC_KEY]), CORE_KEY, 0x64);
  let info = metadataBytes ?? Buffer.alloc(0);
  if (metadata !== null && metadataBytes === undefined) {
    const sealed = encrypted(Buffer.from(`music:${JSON.stringify(metadata)}`), META_KEY);
    info = Buffer.from(`163 key(Don't modify):${sealed.toString('base64')}`);
    for (let i = 0; i < info.length; i += 1) info[i] ^= 0x63;
  }
  const box = Array.from({ length: 256 }, (_, index) => index);
  let previous = 0;
  let keyIndex = 0;
  for (let index = 0; index < box.length; index += 1) {
    const next = (box[index] + previous + MUSIC_KEY[keyIndex]) % 256;
    [box[index], box[next]] = [box[next], box[index]];
    previous = next;
    keyIndex = (keyIndex + 1) % MUSIC_KEY.length;
  }
  const sealedAudio = Buffer.from(audio);
  for (let index = 0; index < sealedAudio.length; index += 1) {
    const j = (index + 1) % 256;
    const k = (box[j] + j) % 256;
    sealedAudio[index] ^= box[(box[j] + box[k]) % 256];
  }
  const metadataLengthOffset = 14 + keyBlock.length;
  const coverFrameOffset = metadataLengthOffset + 4 + info.length + 5;
  return {
    bytes: Buffer.concat([
      Buffer.from('CTENFDAM'), Buffer.alloc(2), uint32(keyBlock.length), keyBlock,
      uint32(info.length), info, Buffer.alloc(5), uint32(cover.length + coverPadding),
      uint32(cover.length), cover, Buffer.alloc(coverPadding, 0xab), sealedAudio,
    ]),
    metadataLengthOffset,
    coverFrameOffset,
  };
}

async function files(t, source, name = '测试 音乐 & [1].ncm') {
  const directory = await mkdtemp(join(tmpdir(), 'ncm-decoder-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const input = join(directory, name);
  const output = join(directory, '还原结果.audio');
  await writeFile(input, source);
  return { input, output, directory };
}

test('streams FLAC exactly across chunk boundaries and returns normalized Chinese metadata and PNG cover', async (t) => {
  const audio = Buffer.concat([Buffer.from('fLaC'), randomBytes(768 * 1024 + 41)]);
  const cover = Buffer.from('89504e470d0a1a0a0102030405', 'hex');
  const source = fixture(audio, {
    metadata: { musicName: ' 月亮之下 ', artist: [['黄龄', 1], ['邓典', 2]], album: '作品集', duration: 168123 },
    cover,
    coverPadding: 37,
  }).bytes;
  const { input, output } = await files(t, source, '黄龄,邓典 - 月亮之下 & 副本.ncm');
  const progress = [];
  const result = await decodeNcm(input, output, { onProgress: (value) => progress.push(value) });
  assert.equal(result.format, 'flac');
  assert.deepEqual(result.metadata, { title: '月亮之下', artist: '黄龄/邓典', album: '作品集', duration: 168.123 });
  assert.deepEqual(result.cover, { data: cover, mime: 'image/png' });
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(await readFile(output), audio);
  assert.deepEqual(await readFile(input), source);
  assert.equal(progress[0], 0);
  assert.equal(progress.at(-1), 100);
  assert.ok(progress.every((value, i) => value >= 0 && value <= 100 && (!i || value >= progress[i - 1])));
});

test('recognizes both ID3 and bare MPEG Layer III MP3 without requiring metadata', async (t) => {
  for (const header of [Buffer.from('ID3'), Buffer.from([0xff, 0xfb, 0x90, 0x64])]) {
    await t.test(header.toString('hex'), async (subtest) => {
      const audio = Buffer.concat([header, randomBytes(1024)]);
      const { input, output } = await files(subtest, fixture(audio).bytes);
      const result = await decodeNcm(input, output);
      assert.equal(result.format, 'mp3');
      assert.deepEqual(result.metadata, { title: '', artist: '', album: '', duration: null });
      assert.match(result.warnings.join(''), /未包含歌曲信息/);
      assert.deepEqual(await readFile(output), audio);
    });
  }
});

test('corrupt metadata payload and unrecognized cover do not block usable audio', async (t) => {
  const audio = Buffer.from('ID3this fixture is not a recording');
  const { input, output } = await files(t, fixture(audio, {
    metadataBytes: Buffer.from('damaged metadata, including invalid AES padding'),
    cover: Buffer.from('not an image'),
  }).bytes);
  const result = await decodeNcm(input, output);
  assert.equal(result.format, 'mp3');
  assert.equal(result.cover, undefined);
  assert.equal(result.warnings.length, 2);
  assert.deepEqual(await readFile(output), audio);
});

test('oversized metadata is safely skipped without allocation and the audio is still restored', async (t) => {
  const audio = Buffer.from('fLaCfixture');
  const { input, output } = await files(t, fixture(audio, { metadataBytes: Buffer.alloc(8 * 1024 * 1024 + 1) }).bytes);
  const result = await decodeNcm(input, output);
  assert.match(result.warnings.join(''), /歌曲信息区块过大/);
  assert.deepEqual(await readFile(output), audio);
});

test('normalizes missing or unexpected metadata fields without crashing', async (t) => {
  const { input, output } = await files(t, fixture(Buffer.from('fLaCfixture'), {
    metadata: { musicName: 3, artist: [null, { name: '艺术家' }, ['A\0B', 7], []], album: null, duration: 'invalid' },
  }).bytes);
  const result = await decodeNcm(input, output);
  assert.deepEqual(result.metadata, { title: '', artist: '艺术家/AB', album: '', duration: null });
});

test('rejects truncated header, invalid magic, key block and unbounded lengths with Chinese errors', async (t) => {
  const original = fixture(Buffer.from('ID3fixture'));
  const cases = [
    { name: 'short header', bytes: original.bytes.subarray(0, 9), message: /文件头不完整/ },
    { name: 'bad magic', bytes: Buffer.from(original.bytes), message: /不是有效的 NCM/ },
    { name: 'zero key', bytes: Buffer.from(original.bytes), offset: 10, value: 0, message: /密钥区块长度不合理/ },
    { name: 'huge key', bytes: Buffer.from(original.bytes), offset: 10, value: 0xffffffff, message: /密钥区块长度不合理/ },
    { name: 'truncated key', bytes: original.bytes.subarray(0, 24), message: /密钥区块不完整/ },
    { name: 'huge metadata', bytes: Buffer.from(original.bytes), offset: original.metadataLengthOffset, value: 0xffffffff, message: /歌曲信息区块不完整/ },
  ];
  cases[1].bytes[0] = 0;
  for (const item of cases) {
    if (item.offset !== undefined) item.bytes.writeUInt32LE(item.value, item.offset);
    await t.test(item.name, async (subtest) => {
      const { input, output } = await files(subtest, item.bytes);
      await assert.rejects(decodeNcm(input, output), item.message);
      await assert.rejects(stat(output), { code: 'ENOENT' });
      assert.deepEqual(await readFile(input), item.bytes);
    });
  }
});

test('rejects malformed cover boundaries and missing audio before creating output', async (t) => {
  const original = fixture(Buffer.from('fLaCfixture'), { cover: Buffer.from('12345678') });
  const cases = [
    { name: 'cover exceeds frame', bytes: Buffer.from(original.bytes), offset: original.coverFrameOffset, value: 2, message: /封面长度超过封面区块/ },
    { name: 'cover extends past file', bytes: Buffer.from(original.bytes), offset: original.coverFrameOffset, value: 0xffffffff, message: /封面区块不完整/ },
    { name: 'missing cover length', bytes: original.bytes.subarray(0, original.coverFrameOffset + 6), message: /封面长度不完整/ },
    { name: 'missing audio', bytes: fixture(Buffer.alloc(0)).bytes, message: /没有音频内容/ },
  ];
  for (const item of cases) {
    if (item.offset !== undefined) item.bytes.writeUInt32LE(item.value, item.offset);
    await t.test(item.name, async (subtest) => {
      const { input, output } = await files(subtest, item.bytes);
      await assert.rejects(decodeNcm(input, output), item.message);
      await assert.rejects(stat(output), { code: 'ENOENT' });
    });
  }
});

test('corrupt AES key data fails clearly before creating output', async (t) => {
  const source = fixture(Buffer.from('ID3fixture')).bytes;
  source.fill(0, 14, 14 + source.readUInt32LE(10));
  const { input, output } = await files(t, source);
  await assert.rejects(decodeNcm(input, output), /密钥区块损坏|密钥内容不正确/);
  await assert.rejects(stat(output), { code: 'ENOENT' });
});

test('never overwrites existing output, including the source itself', async (t) => {
  const source = fixture(Buffer.from('ID3fixture')).bytes;
  const { input, output } = await files(t, source);
  const existing = Buffer.from('already here');
  await writeFile(output, existing);
  await assert.rejects(decodeNcm(input, output), { code: 'EEXIST', message: /输出文件已存在/ });
  assert.deepEqual(await readFile(output), existing);
  await assert.rejects(decodeNcm(input, input), { code: 'EEXIST' });
  assert.deepEqual(await readFile(input), source);
});

test('rejects unknown decoded audio instead of guessing FLAC from metadata', async (t) => {
  const { input, output } = await files(t, fixture(Buffer.from('RIFFnot supported'), {
    metadata: { format: 'flac' },
  }).bytes);
  await assert.rejects(decodeNcm(input, output), /不是受支持的 MP3 或 FLAC/);
  await assert.rejects(stat(output), { code: 'ENOENT' });
});

test('pre-aborted signal creates no output', async (t) => {
  const { input, output } = await files(t, fixture(Buffer.from('ID3fixture')).bytes);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(decodeNcm(input, output, { signal: controller.signal }), { name: 'AbortError', code: 'ABORT_ERR' });
  await assert.rejects(stat(output), { code: 'ENOENT' });
});

test('mid-file cancellation stops at a bounded chunk, closes handles and preserves source', async (t) => {
  const audio = Buffer.concat([Buffer.from('fLaC'), randomBytes(1024 * 1024)]);
  const source = fixture(audio).bytes;
  const { input, output, directory } = await files(t, source);
  const controller = new AbortController();
  await assert.rejects(decodeNcm(input, output, {
    signal: controller.signal,
    onProgress: (percent) => { if (percent > 0) controller.abort(); },
  }), { name: 'AbortError', code: 'ABORT_ERR' });
  const partial = await readFile(output);
  assert.ok(partial.length > 0 && partial.length < audio.length);
  assert.deepEqual(partial, audio.subarray(0, partial.length));
  assert.deepEqual(await readFile(input), source);
  // The caller can immediately move/delete temporary output after cancellation.
  await rename(output, join(directory, 'cancelled.tmp'));
});
