const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('ncm', Object.freeze({
  getSettings: () => ipcRenderer.invoke('ncm:get-settings'),
  chooseFiles: () => ipcRenderer.invoke('ncm:choose-files'),
  chooseFolder: () => ipcRenderer.invoke('ncm:choose-folder'),
  addPaths: (paths) => ipcRenderer.invoke('ncm:add-paths', paths),
  chooseOutput: () => ipcRenderer.invoke('ncm:choose-output'),
  start: (settings) => ipcRenderer.invoke('ncm:start', settings),
  cancel: () => ipcRenderer.invoke('ncm:cancel'),
  clearCompleted: () => ipcRenderer.invoke('ncm:clear-completed'),
  removeItem: (id) => ipcRenderer.invoke('ncm:remove-item', id),
  clearQueue: () => ipcRenderer.invoke('ncm:clear-queue'),
  openOutput: (path) => ipcRenderer.invoke('ncm:open-output', path),
  getDropPaths: (files) => Array.from(files || []).map((file) => {
    try { return webUtils.getPathForFile(file); } catch { return ''; }
  }).filter(Boolean),
  onEvent: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('ncm:event', handler);
    return () => ipcRenderer.removeListener('ncm:event', handler);
  },
}));
