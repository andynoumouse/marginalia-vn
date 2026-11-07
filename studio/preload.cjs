// Preload of the Studio's window: tells the page it runs inside Marginalia Studio, and gives the projects screen
// (projects.html) what a web page cannot do: pick folders, the recent list, open a project. The main process refuses the
// project calls from any other page; everything the editor does goes through the dev server's /api/ routes, except the
// movie export's folder (movie.*) and the standalone studio's character folder (character.*), both allowed from the editor's pages only.

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
    openCharacter: call('projects:character'),
    remove: call('projects:remove'),
    reveal: call('projects:reveal'),
  },
  // The animation studio's movie export (editor/anim-export.ts): a folder chosen in a native dialog, then PNG frames written into it.
  movie: {
    pickFolder: call('movie:pick'),
    write: call('movie:write'),
  },
  // The standalone studio's character folder (editor/studio.html, editor/character-store.ts): the one folder the main process holds for the window.
  character: {
    folder: call('character:folder'),
    pick: call('character:pick'),
    list: call('character:list'),
    read: call('character:read'),
    write: call('character:write'),
  },
});
