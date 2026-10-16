'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { join, basename } = require('node:path');
const { tmpdir } = require('node:os');
const { createCipheriv } = require('node:crypto');
const { execFile, spawnSync } = require('node:child_process');
const { promisify } = require('node:util');
const { convertFile, safeStem } = require('../src/converter');

const execute = promisify(execFile);
const FFMPEG = process.env.NCM_TEST_FFMPEG || (process.platform === 'darwin'
  ? '/Applications/Downie 4.app/Contents/Resources/ffmpeg' : 'ffmpeg');
const probe = spawnSync(FFMPEG, ['-hide_banner', '-version'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
if (process.env.NCM_TEST_FFMPEG && probe.status !== 0) {
  throw new Error('NCM_TEST_FFMPEG 指定的工具无法运行，不能跳过集成测试：' + (probe.error?.message || probe.stderr || probe.status));
}
const external = { skip: probe.status === 0 ? false : '未找到测试用 FFmpeg；可通过 NCM_TEST_FFMPEG 指定路径' };
const STREAM_KEY = Buffer.from('integration fixture key - not a recording');

async function ffmpeg(args) {
  return execute(FFMPEG, ['-hide_banner', '-nostdin', '-y', ...args], {
    encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, windowsHide: true,
  });
}

function seal(bytes, key) {
  const cipher = createCipheriv('aes-128-ecb', key, null);
  return Buffer.concat([cipher.update(bytes), cipher.final()]);
}

function ncmFixture(audio, metadata) {
  const key = seal(Buffer.concat([Buffer.from('neteasecloudmusic'), STREAM_KEY]), Buffer.from('hzHRAmso5kInbaxW'));
  for (let index = 0; index < key.length; index += 1) key[index] ^= 0x64;
  const cipherInfo = seal(Buffer.from('music:' + JSON.stringify(metadata)), Buffer.from("#14ljk_!\\]&0U<'("));
  const info = Buffer.from(`163 key(Don't modify):${cipherInfo.toString('base64')}`);
  for (let index = 0; index < info.length; index += 1) info[index] ^= 0x63;
  const box = Array.from({ length: 256 }, (_, index) => index);
  let last = 0;
  for (let index = 0; index < 256; index += 1) {
    const next = (box[index] + last + STREAM_KEY[index % STREAM_KEY.length]) % 256;
    [box[index], box[next]] = [box[next], box[index]];
    last = next;
  }
  const audioBytes = Buffer.from(audio);
  for (let index = 0; index < audioBytes.length; index += 1) {
    const j = (index + 1) % 256;
    audioBytes[index] ^= box[(box[j] + box[(box[j] + j) % 256]) % 256];
  }
  const length = (value) => { const bytes = Buffer.alloc(4); bytes.writeUInt32LE(value); return bytes; };
  return Buffer.concat([
    Buffer.from('CTENFDAM'), Buffer.alloc(2), length(key.length), key,
    length(info.length), info, Buffer.alloc(5), length(0), length(0), audioBytes,
  ]);
}

async function workspace(t) {
  const directory = await fs.mkdtemp(join(tmpdir(), 'ncm-converter-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return { directory, outputDir: join(directory, '中文输出 & files') };
}

async function sourceFile(t, format, stem = '黄龄,邓典 - 测试音 & [1]') {
  const context = await workspace(t);
  const original = join(context.directory, '合成原音频.' + format);
  const codec = format === 'flac'
    ? ['-c:a', 'flac'] : ['-c:a', 'libmp3lame', '-b:a', '128k'];
  await ffmpeg([
    '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=523.25:sample_rate=48000',
    '-t', '1.35', ...codec, '-metadata', 'title=音频内原有标题', '-metadata', 'artist=内嵌测试歌手', '-metadata', 'album=内嵌测试专辑', original,
  ]);
  const metadata = { musicName: '合成测试音（月亮）', artist: [['测试歌手甲', 1], ['测试歌手乙', 2]], album: '无版权测试样本', duration: 1350 };
  const source = ncmFixture(await fs.readFile(original), metadata);
  const inputPath = join(context.directory, stem + '.ncm');
  await fs.writeFile(inputPath, source);
  return { ...context, original, source, inputPath, metadata };
}

async function outputFiles(directory) {
  return fs.readdir(directory).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
}

async function audioPacketHash(file) {
  const result = await ffmpeg(['-v', 'error', '-i', file, '-map', '0:a:0', '-c:a', 'copy', '-f', 'hash', '-hash', 'sha256', '-']);
  return result.stdout.trim();
}

test('safeStem preserves Chinese names and neutralizes Windows reserved/invalid names', () => {
  assert.equal(safeStem(join(tmpdir(), '中文目录', '黄龄,邓典 - 月亮之下.ncm')), '黄龄,邓典 - 月亮之下');
  for (const name of ['CON', 'prn', 'AUX', 'NUL', 'COM1', 'LPT9', 'con.extra']) {
    assert.match(safeStem(name + '.ncm'), /^_/);
  }
  // A backslash is a directory separator on Windows, not a filename character.
  assert.equal(safeStem('曲名:*?<>|".ncm'), '曲名_______');
  assert.equal(safeStem('...  .ncm'), '音频');
  assert.doesNotMatch(safeStem('字'.repeat(179) + '.后缀.ncm'), /[. ]$/);
  const emojiName = safeStem('🎵'.repeat(200) + '.ncm');
  assert.ok(emojiName.length <= 180, 'Windows filename length is bounded in UTF-16 code units');
  assert.equal(emojiName, '🎵'.repeat(90), 'truncation never leaves an unmatched UTF-16 surrogate');
});

test('FLAC NCM becomes fully decodable 320 kbps / 44.1 kHz MP3 with Chinese metadata', external, async (t) => {
  const context = await sourceFile(t, 'flac');
  const statuses = [];
  const result = await convertFile(context.inputPath, context.outputDir, {
    ffmpegPath: FFMPEG, onUpdate: (update) => statuses.push(update.status),
  });
  assert.equal(basename(result.outputPath), '黄龄,邓典 - 测试音 & [1].mp3');
  assert.match(result.message, /320 kbps.*44.1 kHz/);
  const decoded = await ffmpeg(['-xerror', '-err_detect', 'explode', '-i', result.outputPath, '-map', '0:a:0', '-f', 'null', '-']);
  assert.match(decoded.stderr, /44100 Hz/);
  assert.match(decoded.stderr, /320 kb\/s/);
  assert.match(decoded.stderr, /Duration: 00:00:01\./);
  const tags = await ffmpeg(['-loglevel', 'error', '-i', result.outputPath, '-f', 'ffmetadata', '-']);
  assert.match(tags.stdout, /title=合成测试音（月亮）/);
  assert.match(tags.stdout, /artist=测试歌手甲\/测试歌手乙/);
  assert.match(tags.stdout, /album=无版权测试样本/);
  assert.ok(statuses.includes('decoding') && statuses.includes('encoding') && statuses.includes('validating'));
  assert.deepEqual(await fs.readFile(context.inputPath), context.source);
});

test('MP3 NCM retains identical encoded audio packets without a second lossy encode', external, async (t) => {
  const context = await sourceFile(t, 'mp3');
  const result = await convertFile(context.inputPath, context.outputDir, { ffmpegPath: FFMPEG, bitrate: 320 });
  assert.equal(await audioPacketHash(result.outputPath), await audioPacketHash(context.original));
  const decoded = await ffmpeg(['-xerror', '-err_detect', 'explode', '-i', result.outputPath, '-map', '0:a:0', '-f', 'null', '-']);
  assert.match(decoded.stderr, /48000 Hz/);
  assert.match(decoded.stderr, /128 kb\/s/);
  assert.match(result.message, /保留原音质/);
});

test('a duplicate output name keeps existing bytes and publishes the result with (2)', external, async (t) => {
  const context = await sourceFile(t, 'flac', '重复中文歌名');
  await fs.mkdir(context.outputDir);
  const existingPath = join(context.outputDir, '重复中文歌名.mp3');
  const existing = Buffer.from('已有成品，不能覆盖');
  await fs.writeFile(existingPath, existing);
  const result = await convertFile(context.inputPath, context.outputDir, { ffmpegPath: FFMPEG });
  assert.equal(basename(result.outputPath), '重复中文歌名 (2).mp3');
  assert.deepEqual(await fs.readFile(existingPath), existing);
  assert.deepEqual((await outputFiles(context.outputDir)).sort(), ['重复中文歌名 (2).mp3', '重复中文歌名.mp3']);
  await ffmpeg(['-loglevel', 'error', '-xerror', '-err_detect', 'explode', '-i', result.outputPath, '-f', 'null', '-']);
});

test('a damaged container or invalid encoded audio never publishes a finished MP3', external, async (t) => {
  for (const source of [Buffer.from('broken NCM'), ncmFixture(Buffer.from('ID3this is not playable audio'), {})]) {
    await t.test(source.subarray(0, 8).toString(), async (subtest) => {
      const context = await workspace(subtest);
      const inputPath = join(context.directory, '损坏.ncm');
      await fs.writeFile(inputPath, source);
      await assert.rejects(convertFile(inputPath, context.outputDir, { ffmpegPath: FFMPEG }));
      assert.deepEqual(await outputFiles(context.outputDir), []);
      assert.deepEqual(await fs.readFile(inputPath), source);
    });
  }
});

test('cancellation during decoding or FFmpeg progress publishes no output and preserves the source', external, async (t) => {
  for (const status of ['decoding', 'encoding']) {
    await t.test(status, async (subtest) => {
      const context = await sourceFile(subtest, 'flac', '取消测试');
      const controller = new AbortController();
      let reached = false;
      await assert.rejects(convertFile(context.inputPath, context.outputDir, {
        ffmpegPath: FFMPEG,
        signal: controller.signal,
        onUpdate: (update) => {
          if (update.status === status && update.progress > (status === 'encoding' ? 30 : 0)) {
            reached = true;
            controller.abort();
          }
        },
      }), { name: 'AbortError' });
      assert.equal(reached, true, 'the requested cancellation phase was reached');
      assert.deepEqual(await outputFiles(context.outputDir), []);
      assert.deepEqual(await fs.readFile(context.inputPath), context.source);
    });
  }
});


test('ordinary FLAC converts at all supported bitrates and preserves Chinese tags and source bytes', external, async (t) => {
  for (const bitrate of [320, 256, 192]) {
    await t.test(String(bitrate), async (subtest) => {
      const context = await sourceFile(subtest, 'flac');
      const inputPath = join(context.directory, '独立中文原音频.FLAC');
      await fs.rename(context.original, inputPath);
      const originalBytes = await fs.readFile(inputPath);
      const originalStat = await fs.stat(inputPath);
      assert.equal(originalBytes.subarray(0, 4).toString(), 'fLaC');
      const beforeTags = await ffmpeg(['-loglevel', 'error', '-i', inputPath, '-f', 'ffmetadata', '-']);
      const expectedTags = beforeTags.stdout.split(/\r?\n/).filter((line) => /^(title|artist|album)=/.test(line));
      assert.equal(expectedTags.length, 3);
      const updates = [];
      const result = await convertFile(inputPath, context.outputDir, {
        ffmpegPath: FFMPEG, bitrate, onUpdate: (update) => updates.push(update),
      });
      assert.equal(basename(result.outputPath), '独立中文原音频.mp3');
      assert.match(result.message, new RegExp(bitrate + ' kbps.*44.1 kHz'));
      const decoded = await ffmpeg(['-xerror', '-err_detect', 'explode', '-i', result.outputPath, '-map', '0:a:0', '-f', 'null', '-']);
      assert.match(decoded.stderr, /44100 Hz/);
      assert.match(decoded.stderr, new RegExp(bitrate + ' kb/s'));
      const tags = await ffmpeg(['-loglevel', 'error', '-i', result.outputPath, '-f', 'ffmetadata', '-']);
      for (const line of expectedTags) assert.ok(tags.stdout.includes(line), 'preserved tag: ' + line);
      assert.ok(updates.some((update) => update.status === 'decoding' && /FLAC/.test(update.message || '')));
      assert.deepEqual(await fs.readFile(inputPath), originalBytes);
      assert.equal((await fs.stat(inputPath)).mtimeMs, originalStat.mtimeMs);
    });
  }
});

test('ordinary FLAC output uses a unique name without overwriting a finished file or the source', external, async (t) => {
  const context = await sourceFile(t, 'flac');
  const originalBytes = await fs.readFile(context.original);
  await fs.mkdir(context.outputDir);
  const stem = basename(context.original, '.flac');
  const existingPath = join(context.outputDir, stem + '.mp3');
  const existing = Buffer.from('existing finished MP3; must not overwrite');
  await fs.writeFile(existingPath, existing);
  const result = await convertFile(context.original, context.outputDir, { ffmpegPath: FFMPEG });
  assert.equal(basename(result.outputPath), stem + ' (2).mp3');
  assert.deepEqual(await fs.readFile(existingPath), existing);
  assert.deepEqual(await fs.readFile(context.original), originalBytes);
  await ffmpeg(['-loglevel', 'error', '-xerror', '-err_detect', 'explode', '-i', result.outputPath, '-f', 'null', '-']);
});

test('a false FLAC extension or corrupt FLAC frames cannot publish an MP3', external, async (t) => {
  for (const source of [Buffer.from('ID3this is not a FLAC file'), Buffer.from('fLaCthis has no valid STREAMINFO or audio frames')]) {
    await t.test(source.subarray(0, 4).toString(), async (subtest) => {
      const context = await workspace(subtest);
      const inputPath = join(context.directory, '伪装或损坏.flac');
      await fs.writeFile(inputPath, source);
      await assert.rejects(convertFile(inputPath, context.outputDir, { ffmpegPath: FFMPEG }));
      assert.deepEqual(await outputFiles(context.outputDir), []);
      assert.deepEqual(await fs.readFile(inputPath), source);
    });
  }
});

test('ordinary FLAC cancellation before reading or during FFmpeg leaves no result and preserves the source', external, async (t) => {
  for (const phase of ['decoding', 'encoding']) {
    await t.test(phase, async (subtest) => {
      const context = await sourceFile(subtest, 'flac');
      const originalBytes = await fs.readFile(context.original);
      const controller = new AbortController();
      let reached = false;
      await assert.rejects(convertFile(context.original, context.outputDir, {
        ffmpegPath: FFMPEG, signal: controller.signal,
        onUpdate(update) {
          if (reached || update.status !== phase) return;
          reached = true;
          if (phase === 'encoding') setImmediate(() => controller.abort());
          else controller.abort();
        },
      }), { name: 'AbortError' });
      assert.equal(reached, true);
      assert.deepEqual(await outputFiles(context.outputDir), []);
      assert.deepEqual(await fs.readFile(context.original), originalBytes);
    });
  }
});
