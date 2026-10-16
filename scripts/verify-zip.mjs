#!/usr/bin/env node
/** Offline smoke check of the UTF-8 streaming ZIP writer used for Windows. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createZip } from './package-windows.mjs';

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ncm-windows-zip-check-'));
try {
  const source = path.join(temporary, 'source');
  await fs.mkdir(path.join(source, '中文路径'), { recursive: true });
  const sample = randomBytes(2 * 1024 * 1024 + 13);
  const text = Buffer.from('月亮之下 — 中文歌曲与 Windows 路径\r\n', 'utf8');
  await fs.writeFile(path.join(source, '中文路径', '歌曲.txt'), text);
  await fs.writeFile(path.join(source, 'random.bin'), sample);
  await fs.writeFile(path.join(source, 'empty.txt'), '');
  const archive = path.join(temporary, 'portable.zip');
  await createZip(source, 'NCM批量转MP3-Windows-x64', archive);
  const check = spawnSync('unzip', ['-tq', archive], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr || check.stdout);
  const extraction = path.join(temporary, 'unpacked');
  const result = spawnSync('unzip', ['-q', archive, '-d', extraction], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const extracted = path.join(extraction, 'NCM批量转MP3-Windows-x64');
  assert.deepEqual(await fs.readFile(path.join(extracted, '中文路径', '歌曲.txt')), text);
  assert.deepEqual(await fs.readFile(path.join(extracted, 'random.bin')), sample);
  assert.equal((await fs.stat(path.join(extracted, 'empty.txt'))).size, 0);
  const data = await fs.readFile(archive);
  assert.equal(data.readUInt16LE(6) & 0x0800, 0x0800, 'ZIP filenames must carry the UTF-8 flag');
  console.log('ZIP验证通过：中文目录与文件名、空文件、大于流缓冲区的二进制文件及解压CRC。');
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
