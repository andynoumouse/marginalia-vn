// Zero-dependency dev server: serves the preview, exposes the project's scripts and
// locale tables as JSON, and pushes reload events over Server-Sent Events.
// Also runs the TypeScript compiler in watch mode, so engine edits rebuild automatically, and the
// PSD converter in watch mode, so saving a master in masters/ updates assets/ and the preview.
// Code comes from the engine folder, content from the project (see tools/paths.mjs).
//
//   vn dev [--no-build] [--no-art]      (or node preview/dev-server.mjs; PORT=5173 by default)
//   Preview:  http://localhost:5173/        Editor:  http://localhost:5173/editor/

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { checkEngineVersion, engineRoot as root, projectRoot } from '../tools/paths.mjs';
import { projectData as readProject } from '../tools/project-data.mjs';

const project = projectRoot();
checkEngineVersion(project);
const port = Number(process.env.PORT) || 5173;
const scriptDir = path.join(project, 'script');
const localeDir = path.join(project, 'locale');
const assetDir = path.join(project, 'assets');
const gameFile = path.join(project, 'game.json');
// URL prefixes: engine code, and the project's assets and exported game (build/).
// VN_DIST_ROOT=<folder holding a copy of dist/> serves (and watches) that copy instead, so a tsc run in the checkout cannot
// touch a running server (the browser tests use it).
const distRoot = process.env.VN_DIST_ROOT ? path.resolve(process.env.VN_DIST_ROOT) : root;
const served = { dist: distRoot, preview: root, editor: root, docs: root, assets: project, build: project };
const childEnv = { ...process.env, VN_PROJECT: project }; // tools started from here work on the same project
// Browser builds of dev dependencies, served at /vendor/<name>/
const vendorDirs = {
  monaco: path.join(root, 'node_modules', 'monaco-editor', 'min'),
  pixi: path.join(root, 'node_modules', 'pixi.js', 'dist'),
};
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.css': 'text/css', '.map': 'application/json', '.png': 'image/png', '.webp': 'image/webp',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.m4a': 'audio/mp4', '.flac': 'audio/flac', '.opus': 'audio/ogg', '.avif': 'image/avif',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
};

// ---- TypeScript build ----
if (!process.argv.includes('--no-build')) {
  let tsc;
  try { tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc'); }
  catch { console.error('TypeScript not found. Run "npm install" first (or use --no-build).'); process.exit(1); }
  console.log('Building engine...');
  const first = spawnSync(process.execPath, [tsc, '-p', '.'], { cwd: root, stdio: 'inherit' });
  if (first.status !== 0) console.error('Initial build reported errors (see above); watching for fixes.');
  spawn(process.execPath, [tsc, '-p', '.', '--watch', '--preserveWatchOutput'], { cwd: root, stdio: 'inherit' });
}

// ---- art pipeline ----
if (!process.argv.includes('--no-art')) {
  spawn(process.execPath, [path.join(root, 'tools', 'psd-convert.mjs'), '--watch'], { cwd: root, stdio: 'inherit', env: childEnv });
}

// ---- project data (shared with the web export) ----
const projectData = () => readProject(project);

// ---- live reload ----
const clients = new Set();
function broadcast(type, file) {
  const msg = `data: ${JSON.stringify({ type, file })}\n\n`;
  for (const c of clients) c.write(msg);
}
function watch(dir, type) {
  if (!fs.existsSync(dir)) return;
  let timer;
  try {
    fs.watch(dir, { recursive: true }, (_ev, file) => {
      clearTimeout(timer);
      timer = setTimeout(() => { console.log(`[${type}] changed: ${file ?? ''}`); broadcast(type, file ?? ''); }, 120);
    });
  } catch (e) { console.warn(`Cannot watch ${dir}: ${e.message}`); }
}
watch(scriptDir, 'content');
watch(localeDir, 'content');
watch(path.join(distRoot, 'dist'), 'engine');
watch(assetDir, 'content');
fs.watchFile(gameFile, { interval: 300 }, () => broadcast('content', 'game.json')); // also notices it being created

// ---- script saving (used by the editor) ----
// Bound to localhost only; writes additionally require a custom header (forces a CORS preflight
// that this server never approves) and a localhost Host header (blocks DNS rebinding).
function isLocalRequest(req) {
  const host = (req.headers.host ?? '').replace(/:\d+$/, '');
  return (host === 'localhost' || host === '127.0.0.1') && req.headers['x-vn-editor'] === '1';
}
function readBody(req, limit = 2_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('Too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
async function saveScript(req, res, url) {
  const file = url.searchParams.get('file') ?? '';
  const target = path.resolve(scriptDir, file);
  const ok = /^[\w\-./]+\.vn$/.test(file) && !file.includes('..') && target.startsWith(scriptDir + path.sep);
  if (!isLocalRequest(req) || !ok) { res.writeHead(403); res.end('Forbidden'); return; }
  try {
    const body = await readBody(req);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  } catch (e) { res.writeHead(500); res.end(String(e.message)); }
}
// A new folder under script/ (with a .gitkeep so git keeps it empty).
function saveFolder(req, res, url) {
  const dir = url.searchParams.get('dir') ?? '';
  const target = path.resolve(scriptDir, dir);
  const ok = /^[\w\-./]+$/.test(dir) && !dir.includes('..') && target.startsWith(scriptDir + path.sep);
  if (!isLocalRequest(req) || !ok) { res.writeHead(403); res.end('Forbidden'); return; }
  try {
    fs.mkdirSync(target, { recursive: true });
    const keep = path.join(target, '.gitkeep');
    if (!fs.existsSync(keep) && fs.readdirSync(target).length === 0) fs.writeFileSync(keep, '');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  } catch (e) { res.writeHead(500); res.end(String(e.message)); }
}

// The translation tables, so the editor can keep `[variable]` in them in step with a rename. Only locale/<lang>.json.
const localeName = file => /^[\w\-]+\.json$/.test(file) && path.resolve(localeDir, file).startsWith(localeDir + path.sep);

function readLocales(res) {
  const out = {};
  if (fs.existsSync(localeDir)) for (const f of fs.readdirSync(localeDir)) if (localeName(f)) out[`locale/${f}`] = fs.readFileSync(path.join(localeDir, f), 'utf8');
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(out));
}

async function saveLocale(req, res, url) {
  const file = url.searchParams.get('file') ?? '';
  if (!isLocalRequest(req) || !localeName(file)) { res.writeHead(403); res.end('Forbidden'); return; }
  try {
    const body = await readBody(req);
    try { JSON.parse(body); } catch (e) { res.writeHead(400); res.end(`Invalid JSON: ${e.message}`); return; }
    fs.writeFileSync(path.join(localeDir, file), body);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  } catch (e) { res.writeHead(500); res.end(String(e.message)); }
}

async function saveGame(req, res) {
  if (!isLocalRequest(req)) { res.writeHead(403); res.end('Forbidden'); return; }
  try {
    const body = await readBody(req);
    try { JSON.parse(body); } catch (e) { res.writeHead(400); res.end(`Invalid JSON: ${e.message}`); return; }
    fs.writeFileSync(gameFile, body);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  } catch (e) { res.writeHead(500); res.end(String(e.message)); }
}

// A character's hand-written rig.json (the editor's rig tab); the character must already have art.
async function saveRig(req, res, url) {
  const char = url.searchParams.get('char') ?? '';
  const dir = path.resolve(assetDir, 'char', char);
  const ok = /^[\w\-]+$/.test(char) && dir.startsWith(path.join(assetDir, 'char') + path.sep) && fs.existsSync(dir);
  if (!isLocalRequest(req) || !ok) { res.writeHead(403); res.end('Forbidden'); return; }
  try {
    const body = await readBody(req);
    try { JSON.parse(body); } catch (e) { res.writeHead(400); res.end(`Invalid JSON: ${e.message}`); return; }
    fs.writeFileSync(path.join(dir, 'rig.json'), body);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  } catch (e) { res.writeHead(500); res.end(String(e.message)); }
}

// ---- project tasks (editor command palette) ----
const TASKS = {
  export: ['tools/export-web.mjs', '--no-build'],
  strings: ['tools/vn-tool.mjs', 'strings'],
  art: ['tools/psd-convert.mjs', '--force'],
};
let taskRunning = false;
// The answer streams as NDJSON while the task runs: `{"out": text}` per chunk of stdout/stderr, then `{"ok": bool}` at exit.
function runTask(req, res, url) {
  const args = TASKS[url.searchParams.get('name') ?? ''];
  if (!isLocalRequest(req) || !args) { res.writeHead(403); res.end('Forbidden'); return; }
  const send = o => res.write(`${JSON.stringify(o)}\n`);
  const head = status => res.writeHead(status, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  if (taskRunning) { head(409); send({ out: 'Another task is running.' }); send({ ok: false }); res.end(); return; }
  taskRunning = true;
  head(200);
  const child = spawn(process.execPath, args, { cwd: root, env: childEnv });
  for (const s of [child.stdout, child.stderr]) { s.setEncoding('utf8'); s.on('data', out => send({ out })); }
  const finish = (ok, note) => {
    if (!taskRunning) return;
    taskRunning = false;
    console.log(`[task] ${args.join(' ')} -> ${note}`);
    send({ ok });
    res.end();
  };
  child.on('error', e => { send({ out: `${e.message}\n` }); finish(false, e.message); });
  child.on('close', code => finish(code === 0, `exit ${code}`));
}

// ---- http ----
http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/__events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('retry: 500\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (url.pathname === '/api/script' && req.method === 'PUT') { saveScript(req, res, url); return; }
  if (url.pathname === '/api/folder' && req.method === 'PUT') { saveFolder(req, res, url); return; }
  if (url.pathname === '/api/game' && req.method === 'PUT') { saveGame(req, res); return; }
  if (url.pathname === '/api/locales' && req.method === 'GET') { readLocales(res); return; }
  if (url.pathname === '/api/locale' && req.method === 'PUT') { saveLocale(req, res, url); return; }
  if (url.pathname === '/api/rig' && req.method === 'PUT') { saveRig(req, res, url); return; }
  if (url.pathname === '/api/task' && req.method === 'POST') { runTask(req, res, url); return; }
  if (url.pathname === '/api/project') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(projectData()));
    return;
  }
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/preview/index.html';
  if (rel === '/editor') rel = '/editor/';
  if (rel.endsWith('/')) rel += 'index.html'; // folders: /editor/, /build/web/
  let full, top;
  const vendor = /^\/vendor\/(\w+)\//.exec(rel);
  if (vendor && Object.hasOwn(vendorDirs, vendor[1])) {
    const dir = vendorDirs[vendor[1]];
    full = path.normalize(path.join(dir, rel.slice(vendor[0].length)));
    top = full.startsWith(dir + path.sep) ? 'vendor' : '';
    if (top && !fs.existsSync(dir)) { res.writeHead(404); res.end(`${vendor[1]} is not installed. Run "npm install".`); return; }
  } else {
    top = rel.split('/')[1] ?? '';
    const base = Object.hasOwn(served, top) ? served[top] : null;
    full = base ? path.normalize(path.join(base, rel)) : '';
    if (!base || !full.startsWith(path.join(base, top) + path.sep)) top = '';
  }
  if (!top || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
    res.writeHead(404); res.end('Not found'); return;
  }
  res.writeHead(200, { 'Content-Type': mime[path.extname(full)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(full).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`Project: ${project}\nPreview: http://localhost:${port}\nEditor:  http://localhost:${port}/editor/`));
