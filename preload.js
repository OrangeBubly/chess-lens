const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  get: (name) => ipcRenderer.invoke('store:get', name),
  set: (name, value) => ipcRenderer.invoke('store:set', name, value),
  clear: () => ipcRenderer.invoke('store:clear'),
  importLichess: (user, since) => ipcRenderer.invoke('import:lichess', user, since),
  importChesscom: (user, since) => ipcRenderer.invoke('import:chesscom', user, since),
  openExternal: (url) => ipcRenderer.invoke('open:external', url),
  onProgress: (fn) => ipcRenderer.on('import:progress', (_e, p) => fn(p)),
});
