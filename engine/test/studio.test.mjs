// Marginalia Studio (studio/main.cjs) through playwright-core's Electron launcher: `npm run test:studio`, not part of
// `npm test`. Each test runs on temp copies of the sample (no build/) with its own user data, documents folder and port.
//   VN_STUDIO=<exe> tests a packaged Studio instead of `electron studio` from the repo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { _electron } = require('playwright-core');

let electronExe = process.env.VN_STUDIO;
if (!electronExe) { try { electronExe = require('electron'); } catch { /* not installed */ } }
const skip = electronExe ? false : 'Electron is not installed (npm install) and VN_STUDIO is not set';
const engineVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const engineMinor = engineVersion.split('.').slice(0, 2).join('.');

const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer().once('error', reject);
  probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});
const portFree = port => new Promise(resolve => {
  const probe = net.createServer().once('error', () => resolve(false));
  probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
});
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** A copy of the sample (without build/) at tmp/<name>, with game.json changed by `game`. */
function sampleCopy(tmp, name, game) {
  const project = path.join(tmp, name);
  fs.cpSync(path.join(root, 'sample'), project, { recursive: true, filter: src => path.relative(path.join(root, 'sample'), src) !== 'build' });
  if (game) {
    const file = path.join(project, 'game.json');
    fs.writeFileSync(file, JSON.stringify(game(JSON.parse(fs.readFileSync(file, 'utf8'))), null, 2) + '\n');
  }
  return project;
}

/** A temp project, user data folder (settings name a free port) and documents folder. */
async function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-studio-'));
  const project = sampleCopy(tmp, 'Rain Park');
  const userData = path.join(tmp, 'user-data');
  const documents = path.join(tmp, 'documents');
  const port = await freePort();
  fs.mkdirSync(userData);
  fs.mkdirSync(documents);
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ port }));
  return { tmp, project, userData, documents, port };
}

const editorReady = win => win.waitForFunction(() => typeof monaco !== 'undefined' && monaco.editor.getModels().length > 0, null, { timeout: 60_000 });
const screenReady = win => win.waitForFunction(() => document.body?.dataset.ready === '1' && !document.body.classList.contains('busy'), null, { timeout: 30_000 });

/** process.env with `extra` over it; a PATH in `extra` replaces the one there in any spelling (Windows has Path). */
function withEnv(extra) {
  const env = { ...process.env };
  if ('PATH' in extra) for (const k of Object.keys(env)) if (k.toUpperCase() === 'PATH') delete env[k];
  return { ...env, ...extra };
}

/** Start the Studio: on `project` when given (then wait for the editor), else on the projects screen. */
async function launch({ userData, documents }, { project, env = {} } = {}) {
  const projectArgs = project ? ['--project', project] : [];
  const app = await _electron.launch({
    executablePath: electronExe,
    args: process.env.VN_STUDIO ? projectArgs : [path.join(root, 'studio'), ...projectArgs],
    env: withEnv({ VN_STUDIO_USER_DATA: userData, VN_STUDIO_DOCUMENTS: documents, VN_PROJECT: '', ...env }),
    timeout: 60_000,
  });
  const win = await app.firstWindow({ timeout: 60_000 });
  await (project ? editorReady(win) : screenReady(win));
  return { app, win };
}

/** Answer the Studio's notices (dialog.showMessageBox) with `answers` in turn, recording their messages. */
const answerNotices = (app, answers) => app.evaluate(({ dialog }, answers) => {
  globalThis.notices = [];
  dialog.showMessageBox = async (...args) => {
    const options = args.at(-1);
    globalThis.notices.push(options.message);
    return { response: answers[globalThis.notices.length - 1] ?? options.cancelId ?? 0 };
  };
}, answers);

/** pid and command line of every process below `pid`. */
function descendants(pid) {
  let rows;
  if (process.platform === 'win32') {
    // The full path: the run may have only System32 on PATH, or not even that.
    const powershell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const r = spawnSync(powershell, ['-NoProfile', '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress'], { encoding: 'utf8', maxBuffer: 64 << 20 });
    rows = JSON.parse(r.stdout).map(p => ({ pid: p.ProcessId, ppid: p.ParentProcessId, cmd: p.CommandLine ?? '' }));
  } else {
    const r = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,args='], { encoding: 'utf8' });
    rows = r.stdout.trim().split('\n').map(l => { const [, a, b, cmd] = l.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/); return { pid: +a, ppid: +b, cmd }; });
  }
  const out = [];
  const walk = p => { for (const c of rows.filter(x => x.ppid === p)) { out.push(c); walk(c.pid); } };
  walk(pid);
  return out;
}
/** The Studio's dev server child and what it started (the PSD watcher, tsc in the repo). */
async function serverTree(app) {
  const main = await app.evaluate(() => process.pid);
  const server = descendants(main).find(p => p.cmd.includes('dev-server.mjs'));
  assert.ok(server, 'a dev server runs');
  return [server, ...descendants(server.pid)];
}

const clickSwitchProject = app => app.evaluate(({ Menu }) => {
  const file = Menu.getApplicationMenu().items.find(i => i.label === 'File');
  file.submenu.items.find(i => i.label.startsWith('Switch Project')).click();
});

test('opens the editor on the project, on the stored port, with the Studio bridge', { skip, timeout: 120_000 }, async () => {
  const s = await setup();
  const { app, win } = await launch(s, { project: s.project });
  try {
    assert.equal(new URL(win.url()).href, `http://localhost:${s.port}/editor/`);
    const info = await win.evaluate(() => window.vnStudio.info());
    assert.equal(info.project, s.project);
    // A packaged Studio runs the engine from its own resources/app, not from this repo.
    const appPath = await app.evaluate(({ app }) => app.getAppPath());
    assert.equal(appPath, process.env.VN_STUDIO ? path.join(path.dirname(process.env.VN_STUDIO), 'resources', 'app') : path.join(root, 'studio'));
    assert.equal(await win.evaluate(() => typeof process), 'undefined', 'no node integration');
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle()), 'Evening in the Park - Marginalia Studio');
    // The project calls are for the projects screen only.
    await assert.rejects(win.evaluate(() => window.vnStudio.projects.list()), /Not allowed/);
  } finally { await app.close(); }
});

test('a task runs as node through the Studio exe: output and no second window', { skip, timeout: 120_000 }, async () => {
  const s = await setup();
  const { app, win } = await launch(s, { project: s.project });
  try {
    const lines = await win.evaluate(async () => {
      const r = await fetch('/api/task?name=strings', { method: 'POST', headers: { 'X-VN-Editor': '1' } });
      return (await r.text()).trim().split('\n').map(l => JSON.parse(l));
    });
    assert.deepEqual(lines.at(-1), { ok: true });
    assert.ok(lines.some(l => l.out?.trim()), 'the task printed something');
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  } finally { await app.close(); }
});

test('window.open: Studio pages open in a Studio window, other sites do not', { skip, timeout: 120_000 }, async () => {
  const s = await setup();
  const { app, win } = await launch(s, { project: s.project });
  try {
    // Leave the real browser alone: record what would have been opened.
    await app.evaluate(({ shell }) => { globalThis.opened = []; shell.openExternal = async url => { globalThis.opened.push(url); }; });
    const child = app.waitForEvent('window');
    await win.evaluate(() => { window.open('/editor/docs-does-not-matter'); });
    await child;
    await win.evaluate(() => { window.open('https://example.com/'); });
    await win.waitForTimeout(500);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 2);
    assert.deepEqual(await app.evaluate(() => globalThis.opened), ['https://example.com/']);
    // Navigating the editor away from the server is refused.
    await win.evaluate(() => { location.href = 'https://example.com/'; });
    await win.waitForTimeout(500);
    assert.match(win.url(), /\/editor\/$/);
  } finally { await app.close(); }
});

test('closing with unsaved edits asks first; the server is gone afterwards; localStorage survives a restart', { skip, timeout: 180_000 }, async () => {
  const s = await setup();
  let { app, win } = await launch(s, { project: s.project });
  await win.evaluate(() => localStorage.setItem('vn-studio-test', 'kept'));
  // game.json that does not parse is never autosaved, so it stays unsaved.
  await win.evaluate(() => {
    const m = monaco.editor.getModels().find(x => x.uri.toString() === 'file:///game.json');
    m.setValue(m.getValue() + 'x');
  });
  await app.evaluate(({ dialog }) => {
    globalThis.asked = 0;
    dialog.showMessageBoxSync = () => { globalThis.asked++; return globalThis.asked === 1 ? 1 : 0; }; // Stay, then Leave
  });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await win.waitForTimeout(500);
  assert.equal(await app.evaluate(() => globalThis.asked), 1);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1, 'Stay kept the window');
  const closed = app.waitForEvent('close');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await closed;
  assert.ok(await portFree(s.port), 'the server stopped with the Studio');
  assert.doesNotMatch(fs.readFileSync(path.join(s.project, 'game.json'), 'utf8'), /x$/);

  ({ app, win } = await launch(s, { project: s.project }));
  try {
    assert.equal(await win.evaluate(() => localStorage.getItem('vn-studio-test')), 'kept');
  } finally { await app.close(); }
});

test('projects screen: recent rows with engine, missing and shared-id marks; Remove, Reveal, engine notices', { skip, timeout: 120_000 }, async () => {
  const s = await setup();
  const older = sampleCopy(s.tmp, 'Older', g => ({ ...g, id: 'same-id', engine: '0.1' }));
  const newer = sampleCopy(s.tmp, 'Newer', g => ({ ...g, id: 'same-id', title: 'From the Future', engine: '99.0' }));
  const missing = path.join(s.tmp, 'Gone');
  fs.writeFileSync(path.join(s.userData, 'recent-projects.json'), JSON.stringify([
    { folder: older, title: 'Old title', lastOpened: new Date().toISOString() },
    { folder: newer, title: 'x', lastOpened: '2020-01-01T00:00:00.000Z' },
    { folder: missing, title: 'Gone Game', lastOpened: '2020-01-01T00:00:00.000Z' },
  ]));
  const { app, win } = await launch(s);
  try {
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle()), 'Marginalia Studio');
    assert.equal(await win.evaluate(() => window.vnStudio.info().project), null);
    const rows = await win.$$eval('#list li', lis => lis.map(li => ({
      title: li.querySelector('.title').textContent, folder: li.querySelector('.folder').textContent,
      marks: [...li.querySelectorAll('.mark')].map(m => m.textContent), missing: li.classList.contains('missing'),
    })));
    assert.deepEqual(rows.map(r => [r.title, r.folder, r.missing]), [
      ['Evening in the Park', older, false], ['From the Future', newer, false], ['Gone Game', missing, true],
    ]);
    assert.ok(rows[0].marks.includes('engine 0.1: older'), rows[0].marks.join());
    assert.ok(rows[0].marks.includes('same id as another project'));
    assert.ok(rows[0].marks.includes('opened today'));
    assert.ok(rows[1].marks.includes('engine 99.0: newer than this Studio'));
    assert.ok(rows[2].marks.includes('missing'));

    await app.evaluate(({ shell }) => { globalThis.revealed = []; shell.showItemInFolder = f => { globalThis.revealed.push(f); }; });
    await win.click(`#list li:nth-child(1) [data-action=reveal]`);
    await win.click(`#list li:nth-child(3) [data-action=remove]`);
    await win.waitForFunction(() => document.querySelectorAll('#list li').length === 2);
    assert.deepEqual(await app.evaluate(() => globalThis.revealed), [older]);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(s.userData, 'recent-projects.json'), 'utf8')).map(r => r.folder), [older, newer]);

    // A newer game: Cancel stays on the screen and starts nothing.
    await answerNotices(app, [0]);
    await win.click('#list li:nth-child(2)');
    await screenReady(win);
    assert.match((await app.evaluate(() => globalThis.notices))[0], /newer Marginalia Studio/);
    assert.match(win.url(), /^file:.*projects\.html$/);
    assert.ok(await portFree(s.port));

    // An older one: "Update" rewrites game.json's engine; then the shared id is asked about, and Open opens it.
    await answerNotices(app, [0, 0]);
    await win.click('#list li:nth-child(1)');
    await editorReady(win);
    const notices = await app.evaluate(() => globalThis.notices);
    assert.match(notices[0], /made with engine 0\.1; this Studio has/);
    assert.match(notices[1], /game id "same-id"/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(older, 'game.json'), 'utf8')).engine, engineMinor);
  } finally { await app.close(); }
});

test('Open Folder, then File > Switch Project (asks about unsaved edits) stops the old server and its PSD watcher', { skip, timeout: 180_000 }, async () => {
  const s = await setup();
  const second = sampleCopy(s.tmp, 'Second', g => ({ ...g, title: 'Second Game', id: 'second' }));
  const { app, win } = await launch(s, { env: { VN_STUDIO_TEST_PICK: s.project } });
  try {
    await win.click('#openFolder');
    await editorReady(win);
    assert.equal(new URL(win.url()).href, `http://localhost:${s.port}/editor/`);
    const first = await serverTree(app);
    assert.ok(first.some(p => p.cmd.includes('psd-convert.mjs')), 'the PSD watcher runs');

    // Unsaved edits: Stay keeps the project open, Leave goes to the projects screen.
    await win.evaluate(() => {
      const m = monaco.editor.getModels().find(x => x.uri.toString() === 'file:///game.json');
      m.setValue(m.getValue() + 'x');
    });
    await app.evaluate(({ dialog }) => { globalThis.asked = 0; dialog.showMessageBoxSync = () => (++globalThis.asked === 1 ? 1 : 0); });
    await clickSwitchProject(app);
    await win.waitForTimeout(1000);
    assert.equal(await app.evaluate(() => globalThis.asked), 1);
    assert.match(win.url(), /\/editor\/$/);
    assert.ok(first.every(p => alive(p.pid)), 'Stay kept the server');
    await clickSwitchProject(app);
    await win.waitForURL(/projects\.html$/);
    await screenReady(win);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle()), 'Marginalia Studio');
    for (let i = 0; i < 50 && first.some(p => alive(p.pid)); i++) await win.waitForTimeout(100);
    assert.deepEqual(first.filter(p => alive(p.pid)).map(p => p.cmd), [], 'the old server and what it started are gone');

    fs.writeFileSync(path.join(s.userData, 'recent-projects.json'), JSON.stringify([
      ...JSON.parse(fs.readFileSync(path.join(s.userData, 'recent-projects.json'), 'utf8')),
      { folder: second, title: 'Second Game', lastOpened: new Date().toISOString() },
    ]));
    await win.reload();
    await screenReady(win);
    await win.click('#list li:nth-child(2)');
    await editorReady(win);
    assert.equal(new URL(win.url()).href, `http://localhost:${s.port}/editor/`, 'the same port, so the same localStorage');
    assert.equal(await win.evaluate(() => window.vnStudio.info().project), second);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle()), 'Second Game - Marginalia Studio');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(s.userData, 'recent-projects.json'), 'utf8')).map(r => r.folder), [second, s.project]);
  } finally { await app.close(); }
});

test('New Project without git on PATH: the option is off, the project has no npm parts and no .git; Open the Demo copies once', { skip, timeout: 180_000 }, async () => {
  const s = await setup();
  const parent = path.join(s.tmp, 'games');
  fs.mkdirSync(parent);
  const systemDir = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32') : '/usr/bin:/bin';
  const env = { VN_STUDIO_TEST_PICK: parent, PATH: systemDir };
  if (process.platform !== 'win32' && spawnSync('sh', ['-c', 'command -v git'], { env: { PATH: systemDir } }).status === 0) {
    env.PATH = ''; // git lives in /usr/bin here; the Studio needs nothing from PATH but taskkill on Windows
  }
  const { app, win } = await launch(s, { env });
  try {
    assert.equal(await win.$eval('#newGit', el => el.disabled), true);
    assert.match(await win.textContent('#gitNote'), /git is not installed/);
    await win.click('#newProject');
    assert.equal(await win.inputValue('#newParent'), path.join(s.documents, 'Marginalia Studio'));
    await win.click('#newBrowse');
    assert.equal(await win.inputValue('#newParent'), parent);
    await win.fill('#newTitle', 'Night: Train?');
    assert.equal(await win.inputValue('#newName'), 'Night Train');
    await win.selectOption('#newStage', '1080x1920');
    await win.click('#newCreate');
    await editorReady(win);
    const folder = path.join(parent, 'Night Train');
    const game = JSON.parse(fs.readFileSync(path.join(folder, 'game.json'), 'utf8'));
    assert.deepEqual([game.title, game.id, game.engine, game.stage], ['Night: Train?', 'night-train', engineMinor, { width: 1080, height: 1920 }]);
    assert.ok(!fs.existsSync(path.join(folder, 'package.json')));
    assert.ok(!fs.existsSync(path.join(folder, '.git')));
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle()), 'Night: Train? - Marginalia Studio');

    await clickSwitchProject(app);
    await win.waitForURL(/projects\.html$/);
    await screenReady(win);
    // A second project in the same folder is refused.
    await win.click('#newProject');
    await win.fill('#newParent', parent);
    await win.fill('#newTitle', 'Night Train');
    await win.click('#newCreate');
    await win.waitForFunction(() => /not empty/.test(document.getElementById('newError').textContent));
    await win.click('#newCancel');

    await win.click('#openDemo');
    await editorReady(win);
    const demo = path.join(s.documents, 'Marginalia Studio', 'Rainy Day Library');
    assert.equal(await win.evaluate(() => window.vnStudio.info().project), demo);
    assert.equal(JSON.parse(fs.readFileSync(path.join(demo, 'game.json'), 'utf8')).engine, engineMinor, 'no older-engine notice for the demo');
    assert.ok(!fs.existsSync(path.join(demo, 'package.json')), 'no npm link to the engine repo');
    assert.ok(fs.existsSync(path.join(demo, 'script')));
    // Once: the copy is kept as the author changed it.
    fs.writeFileSync(path.join(demo, 'mine.txt'), 'kept');
    await clickSwitchProject(app);
    await win.waitForURL(/projects\.html$/);
    await screenReady(win);
    await win.click('#openDemo');
    await editorReady(win);
    assert.equal(fs.readFileSync(path.join(demo, 'mine.txt'), 'utf8'), 'kept');
  } finally { await app.close(); }
});

const hasGit = spawnSync('git', ['--version']).status === 0;
test('New Project with git makes a repository', { skip: skip || (!hasGit && 'git is not installed'), timeout: 120_000 }, async () => {
  const s = await setup();
  const { app, win } = await launch(s, { env: { VN_STUDIO_TEST_PICK: s.tmp } });
  try {
    assert.equal(await win.$eval('#newGit', el => el.disabled || !el.checked), false);
    await win.click('#newProject');
    await win.click('#newBrowse');
    await win.fill('#newTitle', 'With Git');
    await win.click('#newCreate');
    await editorReady(win);
    assert.ok(fs.existsSync(path.join(s.tmp, 'With Git', '.git')));
    assert.match(fs.readFileSync(path.join(s.tmp, 'With Git', '.gitattributes'), 'utf8'), /masters\/\*\* filter=lfs/);
  } finally { await app.close(); }
});

test('Build: the desktop app on the Studio\'s runtime, named after the game, zipped, and it starts the game', { skip, timeout: 300_000 }, async () => {
  const s = await setup();
  const gameFile = path.join(s.project, 'game.json');
  fs.writeFileSync(gameFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(gameFile, 'utf8')), title: 'Rain: Park?' }, null, 2) + '\n');
  const { app, win } = await launch(s, { project: s.project });
  const out = path.join(s.project, 'build', 'portable');
  try {
    await win.click('#buildBtn');
    const dialog = win.locator('#build');
    await dialog.locator('.bd-summary').filter({ hasText: /error|warning|passed/ }).waitFor({ timeout: 60_000 });
    await dialog.locator('.bd-target').selectOption('portable');
    assert.equal(await dialog.locator('.bd-folder').inputValue(), 'build/portable');
    if (await dialog.locator('.bd-ack').isVisible()) await dialog.locator('.bd-ack-box').check();
    await dialog.locator('.bd-go').click();
    await dialog.locator('.bd-result[data-state=ok], .bd-result[data-state=failed]').waitFor({ timeout: 240_000 });
    const result = await dialog.locator('.bd-result').innerText();
    assert.equal(await dialog.locator('.bd-result').getAttribute('data-state'), 'ok', result);
    assert.match(result, /Rain Park-win-x64\.zip/);
  } finally { await app.close(); }

  const folder = path.join(out, `Rain Park-${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`);
  assert.ok(fs.statSync(`${folder}.zip`).size > 50 << 20, 'the zip holds the runtime');
  const exe = path.join(folder, process.platform === 'win32' ? 'Rain Park.exe' : 'rain-park');
  assert.ok(fs.existsSync(exe));
  // The Studio's runtime without its app, its default app or the other Chromium locales; the game in resources/app.
  assert.deepEqual(fs.readdirSync(path.join(folder, 'resources')), ['app']);
  assert.deepEqual(fs.readdirSync(path.join(folder, 'locales')), ['en-US.pak']);
  assert.ok(!fs.existsSync(path.join(folder, path.basename(electronExe))), 'the Studio exe is renamed');
  assert.deepEqual(fs.readdirSync(path.join(folder, 'resources', 'app')).sort(),
    ['assets.pak', 'config.json', 'dist', 'index.html', 'main.cjs', 'package.json', 'preload.cjs', 'save-files.cjs', 'vendor']);
  // A packaged Studio has no TypeScript sources: the modules come from its dist/.
  for (const f of ['dist/engine/src/index.js', 'dist/engine/src/pak.js', 'dist/preview/preview.js']) assert.ok(fs.existsSync(path.join(folder, 'resources', 'app', f)), f);

  // Its own profile folder, not %APPDATA%/rain-park.
  const game = await _electron.launch({ executablePath: exe, args: [`--user-data-dir=${path.join(s.tmp, 'game-data')}`], env: withEnv({}), timeout: 60_000 });
  try {
    const page = await game.firstWindow({ timeout: 60_000 });
    await page.waitForSelector('canvas', { timeout: 30_000 });
    assert.equal(page.url(), 'vn://game/index.html');
    assert.equal(await page.title(), 'Rain: Park?');
    assert.equal(await game.evaluate(({ app }) => app.getAppPath()), path.join(folder, 'resources', 'app'));
    assert.equal(await game.evaluate(({ app }) => app.getPath('userData')), path.join(s.tmp, 'game-data'));
  } finally { await game.close(); }
});
