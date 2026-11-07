// Electron main process of Marginalia Studio, the editor as a desktop app (docs/design/studio.md). It shows the projects
// screen (studio/projects.html, a local page) and, for the project opened there, starts the dev server
// (preview/dev-server.mjs) as a child process and shows /editor/ from it in the same window. The child runs on this exe
// with ELECTRON_RUN_AS_NODE=1, so no Node.js is needed; the tasks the server starts inherit that env.
//   npx electron studio [--project <folder>]      (from the engine repo; without --project: VN_PROJECT, else the projects screen)
// Test hooks: VN_STUDIO_USER_DATA (settings, recent list, localStorage), VN_STUDIO_DOCUMENTS (where the demo copy and new
// projects go by default), VN_STUDIO_TEST_PICK (the folder every folder picker returns).

const { app, BrowserWindow, Menu, dialog, ipcMain, session, shell } = require('electron');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const engineRoot = path.resolve(__dirname, '..');
const projectsPage = path.join(__dirname, 'projects.html');
const caseInsensitive = process.platform === 'win32' || process.platform === 'darwin';
// Tests keep their settings and localStorage out of the real profile.
if (process.env.VN_STUDIO_USER_DATA) app.setPath('userData', path.resolve(process.env.VN_STUDIO_USER_DATA));
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const recentFile = () => path.join(app.getPath('userData'), 'recent-projects.json');
/** Where "Open the demo" puts its copy and New project starts browsing. Never the install folder (read-only). */
const studioDocuments = () => path.join(process.env.VN_STUDIO_DOCUMENTS ? path.resolve(process.env.VN_STUDIO_DOCUMENTS) : app.getPath('documents'), 'Marginalia Studio');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}
const readSettings = () => readJson(settingsFile(), {});
/** The folder the author last made a project in, if it is still there: New project starts from it. */
function lastParent() {
  const { lastParent } = readSettings();
  try { if (typeof lastParent === 'string' && fs.statSync(lastParent).isDirectory()) return lastParent; } catch { /* gone */ }
  return undefined;
}

// The engine's own modules are ES modules: tools/paths.mjs (engine version) and the built engine (dist/).
let engine = null;
async function loadEngine() {
  if (engine) return engine;
  const paths = await import(pathToFileURL(path.join(engineRoot, 'tools', 'paths.mjs')).href);
  const lib = await import(pathToFileURL(path.join(engineRoot, 'dist', 'engine', 'src', 'index.js')).href);
  engine = { ...paths, ...lib };
  return engine;
}

const portFree = port => new Promise(resolve => {
  const probe = net.createServer().once('error', () => resolve(false));
  probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
});
const anyFreePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer().once('error', reject);
  probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * The editor's origin keeps its localStorage (sidebar, recent commands, the preview's saves), and Chromium keys that on the
 * port, so the Studio keeps one port: the stored one when it is free, else 5173, else any free one, which is then stored.
 */
async function studioPort() {
  const settings = readSettings();
  if (Number.isInteger(settings.port) && await portFree(settings.port)) return settings.port;
  const port = await portFree(5173) ? 5173 : await anyFreePort();
  if (settings.port === undefined) writeJson(settingsFile(), { ...settings, port });
  return port;
}

function projectArg() {
  const i = process.argv.indexOf('--project');
  const dir = i >= 0 ? process.argv[i + 1] : process.env.VN_PROJECT;
  return dir ? path.resolve(dir) : null;
}

let win = null;
let server = null;
let port = 0;
let currentProject = null;
let currentCharacter = null; // the folder the standalone character studio is open on (editor/studio.html), when it is
let quitting = false;
let busy = false;
const origin = () => `http://localhost:${port}`;

/** Start the dev server on `project` (or, for the standalone character studio, on none); resolves with the URL of its page once it listens. */
async function startServer(project, { studio = false } = {}) {
  // The previous server may still hold the port for a moment; the same port keeps the editor's localStorage.
  for (let i = 0; i < 50 && !await portFree(port); i++) await sleep(100);
  if (!await portFree(port)) port = await studioPort();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(engineRoot, 'preview', 'dev-server.mjs')], {
      cwd: engineRoot,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ...(studio ? { VN_STUDIO_ONLY: '1' } : { VN_PROJECT: project }), PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      // Its own process group elsewhere, so stopping it also stops the PSD watcher and tsc it starts.
      detached: process.platform !== 'win32',
    });
    server = child;
    let log = '', ready = false;
    const tail = () => log.trim().split('\n').slice(-8).join('\n');
    const take = (stream, out) => stream.on('data', chunk => {
      out.write(chunk);
      log = (log + chunk).slice(-4000);
      if (!ready && (studio ? /Studio: +http/ : /Editor: +http/).test(log)) { ready = true; resolve(studio ? `${origin()}/editor/studio.html` : `${origin()}/editor/`); }
    });
    take(child.stdout, process.stdout);
    take(child.stderr, process.stderr);
    child.on('exit', code => {
      if (server === child) server = null;
      if (!ready) reject(new Error(`The project server stopped (exit ${code}).\n\n${tail()}`));
      else if (!quitting && !child.stopping) {
        dialog.showErrorBox('Marginalia Studio', `The project server stopped (exit ${code}).\n\n${tail()}`);
        void showProjects({ force: true });
      }
    });
  });
}

/** Stop the server and what it started (tsc --watch, the PSD watcher): Windows does not end a child's children with it. */
function stopServer() {
  const child = server;
  server = null;
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  child.stopping = true;
  const gone = new Promise(resolve => child.once('exit', resolve));
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true });
  else { try { process.kill(-child.pid); } catch { child.kill(); } }
  return gone;
}

function guardContents(contents) {
  // Studio pages (asset viewer "Open in tab", the exported game) open in a Studio window; other links in the browser.
  contents.setWindowOpenHandler(({ url }) => {
    if (port && new URL(url).origin === origin()) {
      return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: { contextIsolation: true, sandbox: true } } };
    }
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('did-create-window', child => guardContents(child.webContents));
  contents.on('will-navigate', (e, url) => {
    if (new URL(url).origin !== origin()) e.preventDefault();
  });
  // The editor's beforeunload guard (unsaved edits) shows no dialog in Electron: ask here.
  contents.on('will-prevent-unload', e => {
    const choice = dialog.showMessageBoxSync(BrowserWindow.fromWebContents(contents), {
      type: 'warning', buttons: ['Leave', 'Stay'], defaultId: 1, cancelId: 1, title: 'Unsaved edits',
      message: 'Some edits are not saved yet.', detail: 'Leave anyway and lose them?',
    });
    if (choice === 0) e.preventDefault(); // preventDefault here ignores the page's beforeunload and leaves
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1600, height: 1000, minWidth: 900, minHeight: 600, show: false,
    backgroundColor: '#1e1e1e',
    title: 'Marginalia Studio',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'preload.cjs') },
  });
  win.once('ready-to-show', () => win.show());
  win.on('page-title-updated', e => e.preventDefault());
  win.on('closed', () => { win = null; });
  guardContents(win.webContents);
}

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    {
      label: 'File', submenu: [
        { label: 'Switch Project...', enabled: !!(currentProject || currentCharacter), click: () => void showProjects() },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ]));
}

function setProject(folder, title, character = false) {
  currentProject = character ? null : folder;
  currentCharacter = character ? folder : null;
  win?.setTitle(folder ? `${title} - Marginalia Studio` : 'Marginalia Studio');
  buildMenu();
}

/**
 * Back to the projects screen. Leaving the editor runs its unsaved-edits guard first; choosing Stay keeps the project open
 * (false). The server stops only once the editor is gone.
 */
async function showProjects({ force = false } = {}) {
  if (!win) return false;
  try {
    await win.loadFile(projectsPage);
  } catch (err) {
    if (!force) return false; // Stay: the navigation was cancelled
    throw err;
  }
  await stopServer();
  setProject(null);
  return true;
}

// ---- projects ----

const isProject = dir => fs.existsSync(path.join(dir, 'game.json')) || fs.existsSync(path.join(dir, 'script'));

/** What the Studio knows of a project folder now: its game.json title, id and engine, and an npm setup next to it. */
async function describe(folder) {
  const { engineStatus } = await loadEngine();
  if (!fs.existsSync(folder)) return { folder, missing: true };
  const game = readJson(path.join(folder, 'game.json'), {});
  const pkg = readJson(path.join(folder, 'package.json'), null);
  const npm = !!(pkg && (pkg.dependencies?.['marginalia-vn'] || pkg.devDependencies?.['marginalia-vn']));
  return {
    folder, missing: false, project: isProject(folder),
    title: typeof game.title === 'string' && game.title ? game.title : path.basename(folder),
    id: typeof game.id === 'string' ? game.id : undefined,
    engine: engineStatus(game.engine),
    npm,
  };
}

async function recentList() {
  const { parseRecent } = await loadEngine();
  let text = null;
  try { text = fs.readFileSync(recentFile(), 'utf8'); } catch { /* none yet */ }
  return parseRecent(text);
}

/** The recent list for the projects screen: live game.json facts, missing folders, and game ids shared with another row. */
async function listProjects() {
  const { sharedGameId } = await loadEngine();
  const rows = await Promise.all((await recentList()).map(async r => {
    const now = await describe(r.folder);
    return now.missing ? { ...r, missing: true } : { ...r, ...now, lastOpened: r.lastOpened };
  }));
  return rows.map(r => ({ ...r, sharedId: sharedGameId(rows, r.folder, r.id, { caseInsensitive }) }));
}

const choose = async (options) => (await dialog.showMessageBox(win?.isVisible() ? win : undefined, options)).response;

/**
 * The notices shown before a project opens: an engine newer or older than the Studio's, an npm setup the Studio does not
 * use, a game id another recent project has. False when the author cancels.
 */
async function openNotices(info, recent) {
  const { changesSince, sharedGameId, withEngineVersion } = await loadEngine();
  const { wanted, have, status } = info.engine;
  const npmNote = info.npm ? '\n\nThis project also has an npm setup (package.json); the Studio uses its own engine, not that one.' : '';
  if (status === 'newer-game') {
    const r = await choose({
      type: 'warning', buttons: ['Cancel', 'Open Anyway'], defaultId: 0, cancelId: 0, title: 'Newer engine',
      message: `${info.title} was made with a newer Marginalia Studio.`,
      detail: `It asks for engine ${wanted}; this Studio has ${have}. Update the Studio before editing it: this engine may not understand all of its scripts and game.json.${npmNote}`,
    });
    if (r !== 1) return false;
  } else if (status === 'older-game') {
    const [major, minor] = have.split('.');
    const now = `${major}.${minor}`;
    const changes = changesSince(wanted, have).flatMap(c => c.changes.map(line => `${c.version}: ${line}`));
    const r = await choose({
      type: 'info', buttons: [`Update to ${now}`, 'Open Without Changing', 'Cancel'], defaultId: 0, cancelId: 2, title: 'Older engine',
      message: `${info.title} was made with engine ${wanted}; this Studio has ${have}.`,
      detail: `${changes.length ? `What changed since:\n${changes.map(l => `- ${l}`).join('\n')}\n\n` : ''}Update sets "engine" in game.json to ${now}, so this notice stops.${npmNote}`,
    });
    if (r === 2) return false;
    if (r === 0) {
      const file = path.join(info.folder, 'game.json');
      fs.writeFileSync(file, withEngineVersion(fs.readFileSync(file, 'utf8'), now));
    }
  }
  const others = sharedGameId(recent, info.folder, info.id, { caseInsensitive });
  if (others.length) {
    const r = await choose({
      type: 'warning', buttons: ['Open', 'Cancel'], defaultId: 0, cancelId: 1, title: 'Same game id',
      message: `Another recent project has the game id "${info.id}".`,
      detail: `${others.join('\n')}\n\nThe preview keeps saves, settings and read text per game id, so these projects share them. Change "id" in one game.json to keep them apart.`,
    });
    if (r !== 0) return false;
  }
  return true;
}

/** Open `folder` in the editor: notices, the recent list, a new server child. Resolves with { error } or { ok }. */
async function openProject(folder) {
  if (busy) return { error: 'Another project is opening.' };
  busy = true;
  try {
    folder = path.resolve(folder);
    const info = await describe(folder);
    if (info.missing) return { error: `${folder} does not exist.` };
    if (!info.project) return { error: `${folder} is not a game project (no game.json or script/). Use New Project to start one.` };
    const recent = await recentList();
    // The ids as game.json has them now, not as last seen.
    if (!await openNotices(info, await listProjects())) return { cancelled: true };
    const { touchRecent } = await loadEngine();
    const after = await describe(folder); // the notice may have updated game.json
    writeJson(recentFile(), touchRecent(recent, {
      folder, title: after.title, ...(after.id ? { id: after.id } : {}), ...(after.engine.wanted ? { engine: after.engine.wanted } : {}),
      lastOpened: new Date().toISOString(),
    }, { caseInsensitive }));
    await stopServer();
    const url = await startServer(folder);
    setProject(folder, after.title);
    await win.loadURL(url);
    return { ok: true };
  } catch (err) {
    if (server || currentProject) {
      await stopServer();
      setProject(null);
      if (win && !win.webContents.getURL().startsWith('file:')) {
        dialog.showErrorBox('Marginalia Studio', err.message);
        await win.loadFile(projectsPage).catch(() => {});
      }
    }
    return { error: err.message };
  } finally { busy = false; }
}

/** The standalone character studio: pick a character folder, start the server with no project and show its studio page. Resolves with { error }, { cancelled } or { ok }. */
async function openCharacter() {
  if (busy) return { error: 'Another project is opening.' };
  const folder = await pickFolder('Open a character folder', lastParent() ?? studioDocuments());
  if (!folder) return { cancelled: true };
  busy = true;
  try {
    await stopServer();
    const url = await startServer(null, { studio: true });
    setProject(folder, path.basename(folder), true);
    await win.loadURL(url);
    return { ok: true };
  } catch (err) {
    await stopServer();
    setProject(null);
    if (win && !win.webContents.getURL().startsWith('file:')) await win.loadFile(projectsPage).catch(() => {});
    return { error: err.message };
  } finally { busy = false; }
}

/** The folder a picker chose, or null. VN_STUDIO_TEST_PICK answers for it in tests. */
async function pickFolder(title, defaultPath) {
  if (process.env.VN_STUDIO_TEST_PICK) return path.resolve(process.env.VN_STUDIO_TEST_PICK);
  const r = await dialog.showOpenDialog(win, { title, defaultPath, properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
}

const gitAvailable = () => { const r = spawnSync('git', ['--version'], { windowsHide: true }); return !r.error && r.status === 0; };

/** Write a Studio-kind project into parent/name, optionally as a git repository. Resolves with { folder } or { error }. */
async function newProject({ parent, name, title, stage, git, template }) {
  const { newProjectFiles, templateAssets, engineVersion } = await loadEngine();
  if (!title?.trim()) return { error: 'Give the game a title.' };
  if (!parent || !name?.trim()) return { error: 'Choose a location and a folder name.' };
  if (/[<>:"/\\|?*]/.test(name)) return { error: 'The folder name cannot contain < > : " / \\ | ? *' };
  const folder = path.resolve(parent, name.trim());
  if (fs.existsSync(folder) && fs.readdirSync(folder).length) return { error: `${folder} is not empty; choose another folder name.` };
  let files;
  try { files = newProjectFiles({ title: title.trim(), engineVersion, kind: 'studio', stage, template }); } catch (err) { return { error: err.message }; }
  writeJson(settingsFile(), { ...readSettings(), lastParent: path.resolve(parent) });
  for (const [rel, text] of Object.entries(files)) {
    const file = path.join(folder, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  try { (await import(pathToFileURL(path.join(engineRoot, 'tools', 'template-assets.mjs')).href)).copyTemplateAssets(templateAssets(template, stage), folder); } catch (err) { return { error: err.message }; }
  if (git && gitAvailable()) {
    const r = spawnSync('git', ['init'], { cwd: folder, windowsHide: true, encoding: 'utf8' });
    if (r.status !== 0) return { folder, warning: `git init failed: ${(r.stderr || r.error?.message || '').trim()}` };
  }
  return { folder };
}

/** The bundled demo, copied to the documents folder once (the install folder is read-only), then that copy. */
async function demoCopy() {
  const { withEngineVersion, engineVersion } = await loadEngine();
  const source = path.join(engineRoot, 'games', 'demo');
  const game = readJson(path.join(source, 'game.json'), {});
  const folder = path.join(studioDocuments(), game.title || 'Demo');
  if (fs.existsSync(path.join(folder, 'game.json'))) return { folder };
  if (fs.existsSync(folder) && fs.readdirSync(folder).length) return { error: `${folder} exists and is not the demo; move it away to copy the demo again.` };
  // The npm parts link the engine repo; the Studio uses its own engine.
  const skip = new Set(['package.json', 'node_modules', 'build'].map(f => path.join(source, f)));
  fs.cpSync(source, folder, { recursive: true, filter: src => !skip.has(src) });
  const file = path.join(folder, 'game.json');
  const [major, minor] = engineVersion.split('.');
  fs.writeFileSync(file, withEngineVersion(fs.readFileSync(file, 'utf8'), `${major}.${minor}`));
  return { folder };
}

// ---- the bridge (studio/preload.cjs) ----

/** Only the projects screen may use the project calls; the editor and the game get info() alone. */
const fromProjectsPage = e => {
  try { return e.senderFrame && new URL(e.senderFrame.url).href === pathToFileURL(projectsPage).href; } catch { return false; }
};
function handle(channel, fn) {
  ipcMain.handle(channel, async (e, ...args) => {
    if (!fromProjectsPage(e)) throw new Error('Not allowed from this page');
    return fn(...args);
  });
}
/** The movie export's calls come from the editor page of the open project (the stage page inside it has no bridge), and nobody else. */
const fromEditorPage = e => {
  try { const u = new URL(e.senderFrame.url); return !!port && u.origin === origin() && u.pathname.startsWith('/editor/'); } catch { return false; }
};
/** The folder the animator picked for the frames: writes go there and nowhere else, as plain PNG file names. */
let movieFolder = null;
function registerMovieBridge() {
  ipcMain.handle('movie:pick', async (e, title) => {
    if (!fromEditorPage(e)) throw new Error('Not allowed from this page');
    const folder = await pickFolder(String(title ?? 'Folder for the frames'), currentProject ?? currentCharacter ?? studioDocuments());
    if (folder) movieFolder = folder;
    return folder;
  });
  ipcMain.handle('movie:write', async (e, name, bytes) => {
    if (!fromEditorPage(e)) throw new Error('Not allowed from this page');
    if (!movieFolder) throw new Error('No folder was chosen');
    if (typeof name !== 'string' || !/^[A-Za-z0-9_-]+\.png$/.test(name)) throw new Error('Not a frame file name');
    await fs.promises.writeFile(path.join(movieFolder, name), Buffer.from(bytes));
  });
}
/** The character studio's own page: its folder calls come from there and nowhere else. */
const fromStudioPage = e => {
  try { const u = new URL(e.senderFrame.url); return !!port && u.origin === origin() && u.pathname === '/editor/studio.html'; } catch { return false; }
};
const HIDDEN_NAME = name => name.startsWith('.') || name === 'node_modules';
const MAX_LISTED = 20_000;
/** A path the page named, inside the character folder: no way out of it. */
function inCharacter(rel) {
  if (typeof rel !== 'string' || !rel || rel.includes('\\') || rel.startsWith('/') || rel.split('/').some(seg => seg === '..' || seg === '')) throw new Error('Not a path in the character folder');
  const full = path.resolve(currentCharacter, ...rel.split('/'));
  if (!full.startsWith(currentCharacter + path.sep)) throw new Error('Not a path in the character folder');
  return full;
}
/**
 * The standalone studio reads the one folder the author picked (a listing, images and JSON) and writes its rig.json and sprite.json.
 * Nothing else is read or written, and the folder is the one the main process holds for the window, never one the page names.
 */
function registerCharacterBridge() {
  const allowed = e => { if (!fromStudioPage(e)) throw new Error('Not allowed from this page'); };
  const held = e => { allowed(e); if (!currentCharacter) throw new Error('No character folder is open'); };
  ipcMain.handle('character:folder', e => { allowed(e); return currentCharacter ? { name: path.basename(currentCharacter) } : null; });
  ipcMain.handle('character:pick', async (e, title) => {
    allowed(e);
    const folder = await pickFolder(String(title ?? 'Open a character folder'), currentCharacter ?? studioDocuments());
    if (!folder) return null;
    setProject(folder, path.basename(folder), true);
    return { name: path.basename(folder) };
  });
  ipcMain.handle('character:list', async e => {
    held(e);
    const out = [];
    const walk = async (dir, prefix) => {
      for (const entry of await fs.promises.readdir(dir, { withFileTypes: true })) {
        if (out.length >= MAX_LISTED) return;
        if (HIDDEN_NAME(entry.name)) continue;
        if (entry.isDirectory()) await walk(path.join(dir, entry.name), `${prefix}${entry.name}/`);
        else if (entry.isFile()) out.push(prefix + entry.name);
      }
    };
    await walk(currentCharacter, '');
    return out;
  });
  ipcMain.handle('character:read', async (e, rel) => {
    held(e);
    if (typeof rel !== 'string' || !/\.(png|webp|jpe?g|avif|json)$/i.test(rel)) throw new Error('Not a file the studio reads');
    const full = inCharacter(rel);
    const [bytes, stat] = await Promise.all([fs.promises.readFile(full), fs.promises.stat(full)]);
    return { bytes, mtime: stat.mtimeMs };
  });
  ipcMain.handle('character:write', async (e, rel, text) => {
    held(e);
    if (typeof rel !== 'string' || !/(^|\/)(rig|sprite)\.json$/.test(rel) || typeof text !== 'string') throw new Error('Not a file the studio writes');
    const full = inCharacter(rel);
    await fs.promises.mkdir(path.dirname(full), { recursive: true });
    await fs.promises.writeFile(full, text);
  });
}
function registerBridge() {
  registerMovieBridge();
  registerCharacterBridge();
  ipcMain.on('studio:info', e => { e.returnValue = { project: currentProject, engineRoot, version: app.getVersion() }; });
  handle('projects:defaults', async () => {
    const { engineVersion, TEMPLATES, DEFAULT_TEMPLATE } = await loadEngine();
    const templates = TEMPLATES.map(({ id, title, description, stage }) => ({ id, title, description, stage }));
    return { documents: studioDocuments(), parent: lastParent() ?? studioDocuments(), git: gitAvailable(), engineVersion, version: app.getVersion(), templates, defaultTemplate: DEFAULT_TEMPLATE };
  });
  handle('projects:list', listProjects);
  handle('projects:pick', (title, defaultPath) => pickFolder(title, defaultPath));
  handle('projects:open', folder => openProject(folder));
  handle('projects:new', async opts => {
    const made = await newProject(opts);
    if (made.error) return made;
    const opened = await openProject(made.folder);
    return { ...opened, warning: made.warning };
  });
  handle('projects:character', () => openCharacter());
  handle('projects:demo', async () => {
    const copy = await demoCopy();
    return copy.error ? copy : openProject(copy.folder);
  });
  handle('projects:remove', async folder => {
    const { removeRecent } = await loadEngine();
    writeJson(recentFile(), removeRecent(await recentList(), folder, { caseInsensitive }));
    return listProjects();
  });
  handle('projects:reveal', folder => { shell.showItemInFolder(folder); });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(async () => {
    registerBridge();
    buildMenu();
    // Downloads (translation and recording-script CSVs) default to the project folder.
    session.defaultSession.on('will-download', (_e, item) => {
      item.setSaveDialogOptions({ defaultPath: path.join(currentProject ?? currentCharacter ?? studioDocuments(), item.getFilename()) });
    });
    port = await studioPort();
    createWindow();
    const project = projectArg();
    if (project) {
      const r = await openProject(project);
      if (r.ok) return;
      if (r.error) dialog.showErrorBox('Marginalia Studio', r.error);
    }
    await win.loadFile(projectsPage);
  });
  app.on('before-quit', () => { quitting = true; void stopServer(); });
  app.on('window-all-closed', () => app.quit());
}
