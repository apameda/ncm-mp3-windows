'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs/promises');
const path = require('node:path');
const { tmpdir } = require('node:os');
const { pathToFileURL } = require('node:url');

const mainPath = path.join(__dirname, '..', 'src', 'main.js');
const clean = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

async function harness(t, convert, { platform = 'win32', isPackaged = false, toolLocation = 'development' } = {}) {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'ncm-main-test-')));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const appDirectory = path.join(directory, 'application');
  const resourcesPath = path.join(directory, 'runtime-resources');
  const binaryName = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const tool = toolLocation === 'app' ? path.join(appDirectory, 'resources', binaryName)
    : toolLocation === 'runtime' ? path.join(resourcesPath, binaryName) : path.join(directory, 'fake-ffmpeg.exe');
  await fs.mkdir(path.dirname(tool), { recursive: true });
  await fs.writeFile(tool, 'Only a presence check; converter is stubbed.');
  const developmentOverride = isPackaged ? path.join(directory, 'ignored-development-ffmpeg') : tool;
  if (isPackaged) await fs.writeFile(developmentOverride, 'Packaged apps must ignore development tool overrides.');
  const handlers = new Map();
  const events = [];
  const calls = [];
  const waiters = new Set();
  const permissions = {};
  const io = { ...fs };
  let instance;
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  class BrowserWindow {
    constructor(options) {
      this.options = options;
      this.listeners = new Map();
      this.webContents = {
        send(channel, event) {
          const entry = { channel, ...clean(event) };
          events.push(entry);
          for (const waiter of [...waiters]) waiter(entry);
        },
        setWindowOpenHandler(callback) { permissions.openWindow = callback; },
        on() {},
      };
      instance = this;
    }
    isDestroyed() { return false; }
    removeMenu() {}
    once(name, callback) { this.listeners.set(name, callback); }
    on(name, callback) { this.listeners.set(name, callback); }
    show() {}
    close() {}
    isMinimized() { return false; }
    restore() {}
    focus() {}
    loadFile(file) { this.loadedFile = file; readyResolve(); return Promise.resolve(); }
  }
  const electron = {
    app: {
      isPackaged,
      setName() {},
      getPath(name) { return path.join(directory, name === 'music' ? 'Music' : 'UserData'); },
      getAppPath() { return appDirectory; },
      requestSingleInstanceLock() { return true; },
      whenReady() { return Promise.resolve(); },
      on() {},
      quit() {},
    },
    BrowserWindow,
    ipcMain: { handle(name, handler) { assert.ok(!handlers.has(name)); handlers.set(name, handler); } },
    dialog: {
      async showOpenDialog(_window, options) { permissions.lastOpenDialog = clean(options); return { canceled: true, filePaths: [] }; },
      showMessageBoxSync() { return 0; },
      showErrorBox(title, message) { readyReject(new Error(title + ': ' + message)); },
    },
    shell: { async openPath() { return ''; } },
    Menu: {
      buildFromTemplate(template) { return template; },
      setApplicationMenu(template) { permissions.applicationMenu = clean(template); },
    },
    session: { defaultSession: {
      setPermissionRequestHandler(callback) { permissions.request = callback; },
      webRequest: { onBeforeRequest(callback) { permissions.beforeRequest = callback; } },
    } },
  };
  const allowed = new Set(['node:fs/promises', 'node:path', 'node:crypto', 'node:url', 'node:fs']);
  const source = await fs.readFile(mainPath, 'utf8');
  vm.runInNewContext(source, {
    __dirname: path.dirname(mainPath),
    // Independent process/env values keep concurrent test files isolated.
    process: { platform, resourcesPath, env: { NCM_FFMPEG: developmentOverride } },
    AbortController,
    console,
    require(name) {
      if (name === 'electron') return electron;
      if (name === 'node:fs/promises') return io;
      if (name === './converter') return { convertFile(...args) {
        calls.push({ inputPath: args[0], outputDir: args[1], options: args[2] });
        if (convert) return convert(...args);
        return Promise.resolve({ outputPath: path.join(args[1], path.basename(args[0], path.extname(args[0])) + '.mp3'), message: '转换完成' });
      } };
      assert.ok(allowed.has(name), 'unexpected dependency ' + name);
      return require(name);
    },
  }, { filename: mainPath });
  await ready;
  assert.equal(handlers.size >= 10, true);
  const event = { sender: instance.webContents, senderFrame: { url: pathToFileURL(instance.loadedFile).href } };
  const invokeRaw = (name, customEvent, ...args) => {
    const handler = handlers.get('ncm:' + name);
    assert.ok(handler, 'handler exists: ' + name);
    return handler(customEvent, ...args);
  };
  const invoke = async (name, ...args) => clean(await invokeRaw(name, event, ...args));
  function waitFor(predicate, from = 0) {
    const existing = events.slice(from).find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { waiters.delete(listener); reject(new Error('Timed out waiting for a main-process event')); }, 2000);
      const listener = (entry) => {
        if (predicate(entry)) {
          clearTimeout(timer);
          waiters.delete(listener);
          resolve(entry);
        }
      };
      waiters.add(listener);
    });
  }
  const latest = (type) => events.findLast((entry) => entry.type === type);
  const options = { outputDir: path.join(directory, 'output'), bitrate: 320 };
  const finished = (from = 0) => waitFor((entry) => entry.type === 'batch' && entry.running === false && entry.total > 0, from);
  async function addFiles(names = ['第一首.ncm', '第二首.ncm']) {
    const inputs = [];
    for (const name of names) {
      const file = path.join(directory, name);
      await fs.writeFile(file, 'synthetic container; converter is mocked');
      inputs.push(file);
    }
    await invoke('add-paths', inputs);
    return inputs;
  }
  return { directory, tool, io, handlers, instance, permissions, event, invoke, invokeRaw, events, calls, latest, finished, options, addFiles, waitFor };
}

test('recursive additions include only NCM files, skip symlink loops and deduplicate real paths', async (t) => {
  const app = await harness(t);
  const inputDir = path.join(app.directory, '输入');
  const nested = path.join(inputDir, '中文子目录');
  await fs.mkdir(nested, { recursive: true });
  const first = path.join(inputDir, '歌曲一.NCM');
  const second = path.join(nested, '歌曲二.ncm');
  await Promise.all([
    fs.writeFile(first, 'first'), fs.writeFile(second, 'second'),
    fs.writeFile(path.join(nested, '无关.mp3'), 'not NCM'),
    fs.writeFile(path.join(nested, '说明.txt'), 'not NCM'),
  ]);
  // Windows junctions exercise the same traversal guard without requiring
  // elevated symbolic-link privileges or Developer Mode on the test runner.
  const loopPath = path.join(nested, 'loop');
  await fs.symlink(inputDir, loopPath, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await fs.lstat(loopPath)).isSymbolicLink(), true);
  let items = await app.invoke('add-paths', [inputDir, first, second]);
  assert.deepEqual(items.map((item) => item.name).sort(), ['歌曲一.NCM', '歌曲二.ncm']);
  assert.ok(items.every((item) => item.status === 'pending' && item.progress === 0 && item.size > 0));
  const ids = items.map((item) => item.id);
  items = await app.invoke('add-paths', [inputDir, first]);
  assert.deepEqual(items.map((item) => item.id), ids);
  assert.match(app.latest('notice').message, /重复文件会自动跳过/);
  await assert.rejects(app.invoke('add-paths', ['relative.ncm']), /有效的本地文件/);
});

test('simultaneous additions cannot enqueue the same NCM twice', async (t) => {
  const app = await harness(t);
  const input = path.join(app.directory, '同时添加.ncm');
  await fs.writeFile(input, 'fixture');
  const attempts = await Promise.allSettled([app.invoke('add-paths', [input]), app.invoke('add-paths', [input])]);
  assert.equal(attempts[0].status, 'fulfilled');
  assert.equal(attempts[1].status, 'rejected');
  assert.match(attempts[1].reason.message, /正在处理当前操作/);
  assert.equal(app.latest('queue').items.length, 1);
});

test('native picker and recursive mixed batches accept ordinary FLAC as well as NCM', async (t) => {
  const app = await harness(t);
  const directory = path.join(app.directory, '混合音频');
  const nested = path.join(directory, '子目录');
  await fs.mkdir(nested, { recursive: true });
  await fs.writeFile(path.join(directory, '加密歌曲.ncm'), 'mock NCM');
  await fs.writeFile(path.join(nested, '原始音频.FLAC'), 'fLaC mock');
  await fs.writeFile(path.join(nested, '歌词.lrc'), '[00:01.00]not an audio file');
  const items = await app.invoke('add-paths', [directory]);
  assert.deepEqual(items.map((item) => item.name).sort(), ['加密歌曲.ncm', '原始音频.FLAC'].sort());
  await app.invoke('choose-files');
  assert.deepEqual(app.permissions.lastOpenDialog.filters[0].extensions, ['ncm', 'flac']);
  const from = app.events.length;
  await app.invoke('start', app.options);
  const batch = await app.finished(from);
  assert.equal(batch.success, 2);
  assert.deepEqual(app.calls.map((call) => path.basename(call.inputPath)).sort(), ['加密歌曲.ncm', '原始音频.FLAC'].sort());
});

test('a failed item records a useful error while the following item still succeeds', async (t) => {
  const app = await harness(t, async (inputPath, outputDir, { onUpdate }) => {
    onUpdate({ status: 'decoding', progress: 8 });
    if (path.basename(inputPath) === '损坏.ncm') {
      const error = new Error('raw permission details'); error.code = 'EACCES'; throw error;
    }
    onUpdate({ status: 'encoding', progress: 52 });
    return { outputPath: path.join(outputDir, '正常.mp3'), message: '已转换' };
  });
  const inputs = await app.addFiles(['损坏.ncm', '正常.ncm']);
  const from = app.events.length;
  assert.equal(await app.invoke('start', app.options), true);
  const batch = await app.finished(from);
  assert.deepEqual(app.calls.map((call) => call.inputPath), inputs);
  assert.equal(batch.total, 2);
  assert.equal(batch.completed, 2);
  assert.equal(batch.success, 1);
  assert.equal(batch.failed, 1);
  assert.equal(batch.cancelled, 0);
  const items = app.latest('queue').items;
  assert.equal(items[0].status, 'failed');
  assert.match(items[0].error, /有写入权限/);
  assert.equal(items[1].status, 'success');
  assert.equal(items[1].progress, 100);
  assert.equal(items[1].outputPath, path.join(app.options.outputDir, '正常.mp3'));
});

test('a second start is refused during preparation and during the active conversion', async (t) => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  t.after(() => release());
  const app = await harness(t, async (_input, outputDir) => {
    await held;
    return { outputPath: path.join(outputDir, '完成.mp3'), message: '完成' };
  });
  await app.addFiles(['第一首.ncm']);
  const from = app.events.length;
  const first = app.invoke('start', app.options);
  await assert.rejects(app.invoke('start', app.options), /正在处理当前操作/);
  assert.equal(await first, true);
  await assert.rejects(app.invoke('start', app.options), /正在处理当前操作/);
  await assert.rejects(app.invoke('clear-queue'), /正在处理当前操作/);
  assert.equal(app.calls.length, 1);
  release();
  const batch = await app.finished(from);
  assert.equal(batch.success, 1);
});

test('cancelling startup while tool inspection is pending prevents conversion and permits retry', async (t) => {
  const app = await harness(t);
  await app.addFiles(['准备取消.ncm']);
  let release;
  let enteredResolve;
  const held = new Promise((resolve) => { release = resolve; });
  const entered = new Promise((resolve) => { enteredResolve = resolve; });
  t.after(() => release());
  let block = true;
  app.io.stat = async (candidate, ...args) => {
    if (block && candidate === app.tool) {
      enteredResolve();
      await held;
    }
    return fs.stat(candidate, ...args);
  };
  const pending = app.invoke('start', app.options);
  await entered;
  await app.invoke('cancel');
  release();
  await assert.rejects(pending, /已取消转换准备，可再次开始/);
  assert.equal(app.calls.length, 0);
  assert.equal(app.latest('queue').items[0].status, 'pending');
  block = false;
  const from = app.events.length;
  await app.invoke('start', app.options);
  const batch = await app.finished(from);
  assert.equal(app.calls.length, 1);
  assert.equal(batch.success, 1);
});

test('cancellation marks remaining items cancelled, and a new start retries all of them', async (t) => {
  let retry = false;
  let enteredResolve;
  const entered = new Promise((resolve) => { enteredResolve = resolve; });
  const app = await harness(t, async (inputPath, outputDir, { signal, onUpdate }) => {
    onUpdate({ status: 'decoding', progress: 12 });
    if (!retry) {
      enteredResolve();
      await new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          const error = new Error('cancelled'); error.name = 'AbortError'; reject(error);
        }, { once: true });
      });
    }
    return { outputPath: path.join(outputDir, path.basename(inputPath) + '.mp3'), message: '完成' };
  });
  const inputs = await app.addFiles(['一.ncm', '二.ncm', '三.ncm']);
  let from = app.events.length;
  await app.invoke('start', app.options);
  await entered;
  assert.equal(await app.invoke('cancel'), true);
  let batch = await app.finished(from);
  assert.equal(app.calls.length, 1, 'cancelled pending files are not passed to the converter');
  assert.equal(batch.completed, 3);
  assert.equal(batch.cancelled, 3);
  assert.ok(app.latest('queue').items.every((item) => item.status === 'cancelled' && item.error === '' && /再次开始/.test(item.message)));
  retry = true;
  from = app.events.length;
  await app.invoke('start', app.options);
  batch = await app.finished(from);
  assert.equal(batch.success, 3);
  assert.equal(batch.cancelled, 0);
  assert.deepEqual(app.calls.slice(1).map((call) => call.inputPath), inputs);
  assert.ok(app.latest('queue').items.every((item) => item.status === 'success'));
});

test('successful items are skipped on later starts and queue cleanup keeps pending items', async (t) => {
  const app = await harness(t);
  const first = await app.addFiles(['已完成一.ncm']);
  let from = app.events.length;
  await app.invoke('start', app.options);
  await app.finished(from);
  await assert.rejects(app.invoke('start', app.options), /添加需要转换/);
  const second = await app.addFiles(['已完成二.ncm']);
  from = app.events.length;
  await app.invoke('start', app.options);
  const batch = await app.finished(from);
  assert.equal(batch.total, 1);
  assert.deepEqual(app.calls.map((call) => call.inputPath), [...first, ...second]);
  await app.addFiles(['待处理.ncm']);
  const pending = await app.invoke('clear-completed');
  assert.equal(pending.length, 1);
  assert.equal(pending[0].name, '待处理.ncm');
  assert.equal(pending[0].status, 'pending');
  assert.deepEqual(await app.invoke('clear-queue'), []);
  assert.deepEqual(app.latest('queue').items, []);
});

test('IPC accepts only the main window and its local document frame', async (t) => {
  const app = await harness(t);
  await app.addFiles(['保留.ncm']);
  const invalid = [
    { sender: {}, senderFrame: app.event.senderFrame },
    { sender: app.event.sender, senderFrame: { url: 'https://example.invalid/' } },
    { sender: app.event.sender },
  ];
  for (const event of invalid) {
    await assert.rejects(app.invokeRaw('clear-queue', event), /请求来源无效/);
    await assert.rejects(app.invokeRaw('get-settings', event), /请求来源无效/);
  }
  assert.equal(app.latest('queue').items.length, 1);
  const settings = await app.invoke('get-settings');
  assert.equal(settings.bitrate, 320);
  assert.ok(settings.outputDir.startsWith(app.directory));
});

test('macOS startup installs native app, edit and window menus for standard keyboard actions', async (t) => {
  const app = await harness(t, undefined, { platform: 'darwin' });
  assert.deepEqual(app.permissions.applicationMenu.map((entry) => entry.role), ['appMenu', 'editMenu', 'windowMenu']);
  assert.ok(app.handlers.has('ncm:start'));
  assert.ok(app.handlers.has('ncm:add-paths'));
});

test('packaged tool lookup uses native filenames and ignores development overrides', async (t) => {
  for (const entry of [
    { platform: 'darwin', toolLocation: 'app', name: 'macOS application resources' },
    { platform: 'darwin', toolLocation: 'runtime', name: 'macOS runtime resources fallback' },
    { platform: 'win32', toolLocation: 'app', name: 'Windows application resources' },
  ]) {
    await t.test(entry.name, async (subtest) => {
      const app = await harness(subtest, undefined, { ...entry, isPackaged: true });
      await app.addFiles(['跨平台测试.ncm']);
      const from = app.events.length;
      await app.invoke('start', app.options);
      const batch = await app.finished(from);
      assert.equal(batch.success, 1);
      assert.equal(app.calls[0].options.ffmpegPath, app.tool);
      assert.equal(path.basename(app.tool), entry.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
      assert.ok(app.events.every((event) => event.channel === 'ncm:event'));
    });
  }
});
