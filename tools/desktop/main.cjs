// Electron main process of the desktop build. The game runs from a private vn://game/ origin: files of the app
// folder are served as they are, and everything under assets/ comes out of assets.pak (see engine/src/pak.ts),
// so no loose art or audio sits on disk. Written next to the game by `vn export --desktop`.

const { app, BrowserWindow, Menu, ipcMain, protocol, net, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { loadAll, removeKey, writeKey } = require('./save-files.cjs');

const appDir = __dirname;
const config = JSON.parse(fs.readFileSync(path.join(appDir, 'config.json'), 'utf8'));
// Saves and settings: one file per key in <user data>/saves (Windows: %APPDATA%/<app name>/saves).
const savesDir = path.join(app.getPath('userData'), 'saves');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.flac': 'audio/flac',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
};
// Only these parts of the app folder are reachable through the protocol (not main.cjs, config.json or the pak).
const PUBLIC = /^(index\.html|icon\.png|dist\/.+|vendor\/.+)$/;
// The program and the translations live in the pak, under TEXT_DIR (engine/src/pak.ts: PAK_TEXT_DIR).
const TEXT = /^(project\.json|locale\/[^/]+\.json)$/;
const TEXT_DIR = '.vn';

protocol.registerSchemesAsPrivileged([{
  scheme: 'vn',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
}]);

let pak;
async function openAssets() {
  const { openPak } = await import(pathToFileURL(path.join(appDir, 'dist/engine/src/pak.js')).href);
  const fh = await fs.promises.open(path.join(appDir, 'assets.pak'), 'r');
  pak = await openPak(async (pos, len) => {
    const buf = Buffer.alloc(len);
    const { bytesRead } = await fh.read(buf, 0, len, pos);
    return buf.subarray(0, bytesRead);
  }, config.key);
}

const plain = (status, text) => new Response(text, { status, headers: { 'content-type': 'text/plain' } });

async function serveAsset(rel, request) {
  const total = pak.size(rel);
  if (total === undefined) return plain(404, 'Not found');
  const headers = {
    'content-type': MIME[path.extname(rel).toLowerCase()] ?? 'application/octet-stream',
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
  };
  const m = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '');
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : Math.max(0, total - Number(m[2]));
    let end = m[1] && m[2] ? Math.min(Number(m[2]), total - 1) : total - 1;
    if (start > end || start >= total) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${total}` } });
    const body = await pak.read(rel, start, end + 1);
    return new Response(body, { status: 206, headers: { ...headers, 'content-length': String(body.length), 'content-range': `bytes ${start}-${end}/${total}` } });
  }
  return new Response(await pak.read(rel), { headers: { ...headers, 'content-length': String(total) } });
}

async function handle(request) {
  const url = new URL(request.url);
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  if (rel.split('/').includes('..')) return plain(400, 'Bad path');
  if (rel.startsWith('assets/')) {
    const inner = rel.slice('assets/'.length);
    return inner.startsWith(`${TEXT_DIR}/`) ? plain(404, 'Not found') : serveAsset(inner, request);
  }
  if (TEXT.test(rel)) return serveAsset(`${TEXT_DIR}/${rel}`, request);
  if (!PUBLIC.test(rel)) return plain(404, 'Not found');
  return net.fetch(pathToFileURL(path.join(appDir, rel)).href);
}

function createWindow() {
  // The stage is 16:9 and scales to fit, so the window opens with a 16:9 content area (useContentSize leaves the
  // title bar and frame out of the numbers). Once the player resizes it, the stage letterboxes as usual.
  const area = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.max(640, Math.min(1280, Math.floor((area.height - 80) * 16 / 9), area.width - 40));
  // game.json `icon`, copied next to this file by the export. Without it the window shows the exe's icon.
  const icon = path.join(appDir, 'icon.png');
  const win = new BrowserWindow({
    useContentSize: true, width, height: Math.round(width * 9 / 16), minWidth: 640, minHeight: 360,
    backgroundColor: '#000000',
    title: config.title,
    icon: fs.existsSync(icon) ? icon : undefined,
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, devTools: false, spellcheck: false, preload: path.join(appDir, 'preload.cjs') },
  });
  win.removeMenu();
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.loadURL('vn://game/index.html');
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  ipcMain.on('vn:load', e => { e.returnValue = loadAll(savesDir); });
  ipcMain.on('vn:set', (_e, key, value) => { try { writeKey(savesDir, key, value); } catch (err) { console.error('Could not save', key, err.message); } });
  ipcMain.on('vn:remove', (_e, key) => removeKey(savesDir, key));
  await openAssets();
  protocol.handle('vn', handle);
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => app.quit());
