// Preload of the Studio's window: tells the page it runs inside Marginalia Studio, and gives the projects screen
// (projects.html) what a web page cannot do: pick folders, the recent list, open a project. The main process refuses the
// project calls from any other page; everything the editor does goes through the dev server's /api/ routes.

const { contextBridge, ipcRenderer } = require('electron');

const call = channel => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('vnStudio', {
  info: () => ipcRenderer.sendSync('studio:info'),
  projects: {
    defaults: call('projects:defaults'),
    list: call('projects:list'),
    pickFolder: call('projects:pick'),
    open: call('projects:open'),
    create: call('projects:new'),
    openDemo: call('projects:demo'),
    remove: call('projects:remove'),
    reveal: call('projects:reveal'),
  },
});
