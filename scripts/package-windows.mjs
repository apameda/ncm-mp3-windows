#!/usr/bin/env node
/** Build a portable Windows x64 app on macOS/Linux. No npm packages or Wine. */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable, Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createDeflateRaw } from 'node:zlib';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRODUCT = 'NCM批量转MP3';
const FOLDER = `${PRODUCT}-Windows-x64`;
const ELECTRON_VERSION = '44.7.2';
const ELECTRON_ZIP = `electron-v${ELECTRON_VERSION}-win32-x64.zip`;
const ELECTRON_BASE = `https://github.com/electron/electron/releases/download/v${ELECTRON_VERSION}`;
const ELECTRON_SHA256 = '10a89447ef64ac5cb9f782af48ffd83734a40ae91681259d1048ca3c9e6c5da4';
const FFMPEG_VERSION = '9.0.2';
const FFMPEG_ZIP = `ffmpeg-${FFMPEG_VERSION}-essentials_build.zip`;
const FFMPEG_URL = `https://www.gyan.dev/ffmpeg/builds/packages/${FFMPEG_ZIP}`;
// Published by the build maintainer, checked on 2026-10-15. Do not auto-update.
const FFMPEG_SHA256 = '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba';
let options;

function parseOptions(args) {
  const result = { offline: false, cache: path.join(ROOT, '.cache', 'windows') };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--offline') result.offline = true;
    else if (args[i] === '--cache-dir' && args[i + 1]) result.cache = path.resolve(args[++i]);
    else if (args[i] === '--help' || args[i] === '-h') {
      console.log('用法：node scripts/package-windows.mjs [--offline] [--cache-dir 目录]\n默认从审核过的上游下载、校验并打包；--offline 仅使用缓存。');
      process.exit(0);
    } else throw new Error(`未知参数：${args[i]}`);
  }
  return result;
}

async function exists(file) {
  return fs.access(file).then(() => true, () => false);
}

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function cachedDownload(url, filename) {
  const destination = path.join(options.cache, filename);
  if (await exists(destination)) return destination;
  if (options.offline) throw new Error(`离线缓存缺少 ${filename}。请按 docs/打包说明.md 下载到 ${options.cache}`);
  console.log(`下载 ${filename}`);
  const partial = `${destination}.download-${process.pid}`;
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(15 * 60 * 1000),
      headers: { 'User-Agent': 'ncm-mp3-windows-local-packager/1.0' },
    });
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(partial, { flags: 'wx' }));
    await fs.rename(partial, destination);
    return destination;
  } catch (error) {
    await fs.rm(partial, { force: true });
    throw new Error(`下载 ${filename} 失败：${error.message}。可手动下载审核URL到缓存后用 --offline 重试。`, { cause: error });
  }
}

async function requireHash(file, expected) {
  const actual = await sha256(file);
  if (actual !== expected.toLowerCase()) {
    throw new Error(`SHA-256 不符，拒绝使用 ${path.basename(file)}\n预期 ${expected}\n实际 ${actual}\n请删除该缓存并重新下载。`);
  }
  console.log(`校验通过 ${path.basename(file)} (${actual})`);
  return actual;
}

function run(command, args, extra = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...extra });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} 失败：${result.error?.message || result.stderr || result.stdout}`);
  }
  return result.stdout;
}

async function extractZip(archive, destination) {
  const entries = run('unzip', ['-Z1', archive]).split(/\r?\n/).filter(Boolean);
  // Even verified upstream archives must not escape the build directory.
  for (const entry of entries) {
    const normalized = entry.replaceAll('\\', '/');
    if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.split('/').includes('..')) {
      throw new Error(`压缩包含不安全路径：${entry}`);
    }
  }
  await fs.mkdir(destination, { recursive: true });
  run('unzip', ['-q', archive, '-d', destination]);
}

async function listFiles(directory, prefix = '') {
  const result = [];
  for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...await listFiles(path.join(directory, entry.name), relative));
    else if (entry.isFile()) result.push(relative);
    else throw new Error(`打包目录中不允许符号链接或特殊文件：${relative}`);
  }
  return result;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let i = 0; i < 8; i += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : crc >>> 1;
  return crc >>> 0;
});

/** Streaming ZIP32 with UTF-8 names, DEFLATE, and data descriptors. */
export async function createZip(sourceDirectory, rootName, destination) {
  const output = await fs.open(destination, 'wx');
  let offset = 0;
  const central = [];
  const write = async (buffer) => {
    let written = 0;
    while (written < buffer.length) written += (await output.write(buffer, written, buffer.length - written, offset + written)).bytesWritten;
    offset += buffer.length;
    if (offset >= 0xffffffff) throw new Error('便携包超过 ZIP32 大小限制。');
  };
  try {
    const files = await listFiles(sourceDirectory);
    if (files.length > 0xffff) throw new Error('便携包文件数超过 ZIP32 限制。');
    for (const relative of files) {
      const source = path.join(sourceDirectory, relative);
      const stat = await fs.stat(source);
      if (stat.size >= 0xffffffff) throw new Error(`文件过大：${relative}`);
      const name = Buffer.from(`${rootName}/${relative}`, 'utf8');
      if (name.length > 0xffff) throw new Error(`文件名过长：${relative}`);
      const year = Math.min(2107, Math.max(1980, stat.mtime.getFullYear()));
      const dosDate = ((year - 1980) << 9) | ((stat.mtime.getMonth() + 1) << 5) | stat.mtime.getDate();
      const dosTime = (stat.mtime.getHours() << 11) | (stat.mtime.getMinutes() << 5) | Math.floor(stat.mtime.getSeconds() / 2);
      const localOffset = offset;
      const header = Buffer.alloc(30);
      header.writeUInt32LE(0x04034b50, 0);
      header.writeUInt16LE(20, 4);
      header.writeUInt16LE(0x0808, 6); // UTF-8 filename + data descriptor.
      header.writeUInt16LE(8, 8);
      header.writeUInt16LE(dosTime, 10);
      header.writeUInt16LE(dosDate, 12);
      header.writeUInt16LE(name.length, 26);
      await write(header);
      await write(name);
      let crc = 0xffffffff;
      let originalSize = 0;
      let compressedSize = 0;
      const checksum = new Transform({ transform(chunk, encoding, callback) {
        for (const byte of chunk) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
        originalSize += chunk.length;
        callback(null, chunk);
      } });
      const sink = new Writable({ write(chunk, encoding, callback) {
        compressedSize += chunk.length;
        write(chunk).then(() => callback(), callback);
      } });
      await pipeline(createReadStream(source), checksum, createDeflateRaw({ level: 6 }), sink);
      if (originalSize !== stat.size || compressedSize >= 0xffffffff) throw new Error(`压缩时文件发生变化或过大：${relative}`);
      crc = (crc ^ 0xffffffff) >>> 0;
      const descriptor = Buffer.alloc(16);
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(crc, 4);
      descriptor.writeUInt32LE(compressedSize, 8);
      descriptor.writeUInt32LE(originalSize, 12);
      await write(descriptor);
      const directory = Buffer.alloc(46);
      directory.writeUInt32LE(0x02014b50, 0);
      // Unix creator prevents legacy macOS unzip from converting UTF-8 as OEM.
      directory.writeUInt16LE(0x0314, 4);
      directory.writeUInt16LE(20, 6);
      directory.writeUInt16LE(0x0808, 8);
      directory.writeUInt16LE(8, 10);
      directory.writeUInt16LE(dosTime, 12);
      directory.writeUInt16LE(dosDate, 14);
      directory.writeUInt32LE(crc, 16);
      directory.writeUInt32LE(compressedSize, 20);
      directory.writeUInt32LE(originalSize, 24);
      directory.writeUInt16LE(name.length, 28);
      directory.writeUInt32LE(0o100644 * 0x10000, 38);
      directory.writeUInt32LE(localOffset, 42);
      central.push(directory, name);
    }
    const centralOffset = offset;
    for (const item of central) await write(item);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(files.length, 8);
    end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(offset - centralOffset, 12);
    end.writeUInt32LE(centralOffset, 16);
    await write(end);
    await output.sync();
  } finally {
    await output.close();
  }
}

async function main() {
  options = parseOptions(process.argv.slice(2));
  if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('构建需要 Node.js 20 或更新版本。');
  if (process.platform === 'win32') throw new Error('此跨平台打包脚本在 macOS/Linux 构建机使用；生成的软件供 Windows 使用。');
  run('unzip', ['-v']);
  for (const name of ['package.json', 'src/main.js', 'README.md', 'THIRD_PARTY_NOTICES.md', 'LICENSE', 'RELEASE_NOTES.md', 'docs/第三方源码.md']) {
    if (!await exists(path.join(ROOT, name))) throw new Error(`缺少应用文件：${name}`);
  }
  const packageJson = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));
  if (packageJson.main !== 'src/main.js') throw new Error('package.json 的 main 必须为 src/main.js。');
  if (Object.keys(packageJson.dependencies || {}).length) throw new Error('打包脚本面向无运行时 npm 依赖的应用；请勿省略依赖文件后继续构建。');
  await fs.mkdir(options.cache, { recursive: true });
  const electronChecksums = await cachedDownload(`${ELECTRON_BASE}/SHASUMS256.txt`, `electron-v${ELECTRON_VERSION}-SHASUMS256.txt`);
  const checksumText = await fs.readFile(electronChecksums, 'utf8');
  const checksumLine = checksumText.split(/\r?\n/).find((line) => line.trim().split(/\s+/).at(-1)?.replace(/^\*/, '') === ELECTRON_ZIP);
  const electronExpected = checksumLine?.trim().split(/\s+/)[0];
  if (!/^[a-f0-9]{64}$/i.test(electronExpected || '')) throw new Error(`Electron 官方 SHA256 清单中缺少 ${ELECTRON_ZIP}`);
  if (electronExpected.toLowerCase() !== ELECTRON_SHA256) throw new Error('Electron 官方校验值与审核固定值不符，拒绝自动升级。');
  const electronArchive = await cachedDownload(`${ELECTRON_BASE}/${ELECTRON_ZIP}`, ELECTRON_ZIP);
  const electronHash = await requireHash(electronArchive, electronExpected);
  const ffmpegChecksums = await cachedDownload(`${FFMPEG_URL}.sha256`, `${FFMPEG_ZIP}.sha256`);
  const ffmpegPublished = (await fs.readFile(ffmpegChecksums, 'utf8')).trim().split(/\s+/)[0];
  if (ffmpegPublished.toLowerCase() !== FFMPEG_SHA256) throw new Error('FFmpeg 维护方校验值与审核固定值不符，拒绝自动升级。');
  const ffmpegArchive = await cachedDownload(FFMPEG_URL, FFMPEG_ZIP);
  const ffmpegHash = await requireHash(ffmpegArchive, FFMPEG_SHA256);
  const staging = await fs.mkdtemp(path.join(options.cache, 'build-'));
  const outputDirectory = path.join(ROOT, 'dist');
  const portable = path.join(staging, FOLDER);
  const temporaryZip = path.join(outputDirectory, `${FOLDER}.zip.build-${process.pid}`);
  try {
    console.log('展开经校验的 Windows 运行环境');
    await extractZip(electronArchive, portable);
    const ffmpegExtracted = path.join(staging, 'ffmpeg');
    await extractZip(ffmpegArchive, ffmpegExtracted);
    const ffmpegRelative = (await listFiles(ffmpegExtracted)).filter((file) => file.endsWith('/bin/ffmpeg.exe'));
    if (ffmpegRelative.length !== 1) throw new Error('FFmpeg 压缩包目录结构与预期不符。');
    const ffmpegRoot = path.dirname(path.dirname(path.join(ffmpegExtracted, ffmpegRelative[0])));
    const appDirectory = path.join(portable, 'resources', 'app');
    await fs.rm(path.join(portable, 'resources', 'default_app.asar'), { force: true });
    await fs.rename(path.join(portable, 'electron.exe'), path.join(portable, `${PRODUCT}.exe`));
    await fs.rename(path.join(portable, 'LICENSE'), path.join(portable, 'LICENSE-electron'));
    await fs.mkdir(appDirectory, { recursive: true });
    await fs.cp(path.join(ROOT, 'src'), path.join(appDirectory, 'src'), { recursive: true });
    for (const name of ['package.json', 'README.md', 'THIRD_PARTY_NOTICES.md', 'LICENSE']) {
      await fs.copyFile(path.join(ROOT, name), path.join(appDirectory, name));
    }
    await fs.copyFile(path.join(ROOT, 'docs', '第三方源码.md'), path.join(appDirectory, '第三方源码.md'));
    if (await exists(path.join(ROOT, 'resources'))) await fs.cp(path.join(ROOT, 'resources'), path.join(appDirectory, 'resources'), { recursive: true });
    await fs.mkdir(path.join(appDirectory, 'resources'), { recursive: true });
    await fs.copyFile(path.join(ffmpegRoot, 'bin', 'ffmpeg.exe'), path.join(appDirectory, 'resources', 'ffmpeg.exe'));
    const ffmpegLicense = path.join(portable, 'licenses', 'ffmpeg');
    await fs.mkdir(ffmpegLicense, { recursive: true });
    for (const name of ['LICENSE', 'README.txt']) {
      const source = path.join(ffmpegRoot, name);
      if (!await exists(source)) throw new Error(`FFmpeg 发行包缺少上游许可文件 ${name}`);
      await fs.copyFile(source, path.join(ffmpegLicense, name));
    }
    for (const name of ['README.md', 'THIRD_PARTY_NOTICES.md', 'LICENSE', 'RELEASE_NOTES.md']) await fs.copyFile(path.join(ROOT, name), path.join(portable, name));
    await fs.copyFile(path.join(ROOT, 'docs', '第三方源码.md'), path.join(portable, '第三方源码.md'));
    await fs.cp(path.join(ROOT, 'docs'), path.join(portable, 'docs'), { recursive: true });
    const manifest = {
      product: PRODUCT, version: packageJson.version, target: 'win32-x64', builtAt: new Date().toISOString(),
      electron: { version: ELECTRON_VERSION, url: `${ELECTRON_BASE}/${ELECTRON_ZIP}`, sha256: electronHash, checksumsUrl: `${ELECTRON_BASE}/SHASUMS256.txt`, license: 'MIT' },
      ffmpeg: { version: FFMPEG_VERSION, url: FFMPEG_URL, sha256: ffmpegHash, checksumsUrl: `${FFMPEG_URL}.sha256`, license: 'GPL-3.0-or-later' },
      binaries: {
        [`${PRODUCT}.exe`]: await sha256(path.join(portable, `${PRODUCT}.exe`)),
        'resources/app/resources/ffmpeg.exe': await sha256(path.join(appDirectory, 'resources', 'ffmpeg.exe')),
      },
    };
    await fs.writeFile(path.join(portable, 'BUILD-MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    await fs.mkdir(outputDirectory, { recursive: true });
    console.log('生成含完整运行环境的绿色版 ZIP（中文文件名使用 UTF-8）');
    await createZip(portable, FOLDER, temporaryZip);
    run('unzip', ['-tq', temporaryZip]);
    const zipHash = await sha256(temporaryZip);
    const finalZip = path.join(outputDirectory, `${FOLDER}.zip`);
    await fs.rename(temporaryZip, finalZip);
    await fs.writeFile(`${finalZip}.sha256`, `${zipHash}  ${path.basename(finalZip)}\n`);
    console.log(`完成：${finalZip}\nSHA-256：${zipHash}`);
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
    await fs.rm(temporaryZip, { force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`打包失败：${error.message}`);
    process.exitCode = 1;
  });
}
