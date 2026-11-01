// Preload of the desktop build: hands the game its saved data synchronously (storage.ts reads on startup and
// then keeps a copy in memory) and forwards writes to the main process, which keeps them as files.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vnDesktop', {
  load: () => ipcRenderer.sendSync('vn:load'),
  set: (key, value) => { ipcRenderer.send('vn:set', String(key), String(value)); },
  remove: key => { ipcRenderer.send('vn:remove', String(key)); },
});
