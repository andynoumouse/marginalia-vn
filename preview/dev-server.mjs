// Zero-dependency dev server: serves the preview, exposes the project's scripts and
// locale tables as JSON, and pushes reload events over Server-Sent Events.
// Also runs the TypeScript compiler in watch mode, so engine edits rebuild automatically, and the
// PSD converter in watch mode, so saving a master in masters/ updates assets/ and the preview.
// Code comes from the engine folder, content from the project (see tools/paths.mjs).
//
//   vn dev [--no-build] [--no-art]      (or node preview/dev-server.mjs; PORT=5173 by default)
//   Preview:  http://localhost:5173/        Editor:  http://localhost:5173/editor/

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
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

const { isLocalHost, isOwnOrigin, isOpenable } = await import(pathToFileURL(path.join(distRoot, 'dist', 'engine', 'src', 'request-guard.js')).href);

// ---- art pipeline ----
if (!process.argv.includes('--no-art')) {
  spawn(process.execPath, [path.join(root, 'tools', 'psd-convert.mjs'), '--watch'], { cwd: root, stdio: 'inherit', env: childEnv });
}

// ---- project data (shared with the web export) ----
// The editor's files panel also gets the PSD masters and the top-level asset folders (empty ones included); the export does not.
const projectData = () => ({
  ...readProject(project),
  masters: ['bg', 'char', 'ui'].flatMap(d => subEntries(path.join(project, 'masters', d), e => e.isFile() && /\.psd$/i.test(e.name)).map(n => `${d}/${n}`)),
  assetDirs: subEntries(assetDir, e => e.isDirectory()),
});
const subEntries = (dir, keep) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).filter(keep).map(e => e.name).sort() : []);

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
watch(path.join(project, 'masters'), 'masters'); // only the editor's files panel listens (the converter's output arrives as 'content')
fs.watchFile(gameFile, { interval: 300 }, () => broadcast('content', 'game.json')); // also notices it being created

// ---- script saving (used by the editor) ----
// Bound to localhost only, and every request must name a local Host (blocks DNS rebinding; see engine/src/request-guard.ts).
// Writes additionally require a custom header (forces a CORS preflight that this server never approves) and, when a
// browser sends an Origin, the server's own.
function isLocalRequest(req) {
  return isLocalHost(req.headers.host) && isOwnOrigin(req.headers.origin, req.headers.host) && req.headers['x-vn-editor'] === '1';
}
function readBuffer(req, limit = 2_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('Too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
const readBody = (req, limit) => readBuffer(req, limit).then(b => b.toString('utf8'));
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
// A new folder under script/, or with `in=assets` a top-level one under assets/ (with a .gitkeep so git keeps it empty).
function saveFolder(req, res, url) {
  const dir = url.searchParams.get('dir') ?? '';
  const inAssets = url.searchParams.get('in') === 'assets';
  const base = inAssets ? assetDir : scriptDir;
  const target = path.resolve(base, dir);
  const ok = (inAssets ? /^[\w\-]+$/ : /^[\w\-./]+$/).test(dir) && !dir.includes('..') && target.startsWith(base + path.sep);
  if (!isLocalRequest(req) || !ok) { res.writeHead(403); res.end('Forbidden'); return; }
  try {
    fs.mkdirSync(target, { recursive: true });
    const keep = path.join(target, '.gitkeep');
    if (!fs.existsSync(keep) && fs.readdirSync(target).length === 0) fs.writeFileSync(keep, '');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  } catch (e) { res.writeHead(500); res.end(String(e.message)); }
}

// The files panel's "Reveal in file manager" (`reveal`) and "Open in default app" (`open`, files under masters/, assets/ and
// script/ only, so a page can never start an exported .exe). `path` is project-relative; '' is the project folder.
function showPath(req, res, url, how) {
  const rel = url.searchParams.get('path') ?? '';
  let target = path.resolve(project, rel);
  const inside = target === project || target.startsWith(project + path.sep);
  const openable = how === 'open' && /^(masters|assets|script)\//.test(rel) && isOpenable(rel) && fs.existsSync(target) && fs.statSync(target).isFile();
  if (!isLocalRequest(req) || rel.includes('..') || !inside || (how === 'open' && !openable)) { res.writeHead(403); res.end('Forbidden'); return; }
  while (!fs.existsSync(target) && target !== project) target = path.dirname(target); // masters/char before the first PSD: show masters/
  // explorer.exe /select, highlights the item in its folder (and exits 1 even when it worked); `open -R` does the same on macOS.
  // Windows paths cannot hold '"', so quoting them by hand (verbatim arguments) is safe; explorer misreads node's own quoting.
  const [cmd, args] = process.platform === 'win32' ? ['explorer.exe', [how === 'open' ? `"${target}"` : `/select,"${target}"`]]
    : process.platform === 'darwin' ? ['open', how === 'open' ? [target] : ['-R', target]]
    : ['xdg-open', [how === 'open' || target === project ? target : path.dirname(target)]];
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsVerbatimArguments: process.platform === 'win32' });
    child.on('error', e => console.warn(`[${how}] ${cmd}: ${e.message}`));
    child.unref();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  } catch (e) { res.writeHead(500); res.end(String(e.message)); }
}

// The files panel's Rename/Move (`POST /api/move?from=&to=`) and Delete (`POST /api/delete?path=`) on files and folders under
// script/, assets/ and masters/ (engine/src/file-ops.ts has the rules). `dir=1` says the path is a folder; it must match the disk.
// A move never overwrites (409); a delete moves the path to the project trash (below) and answers with the entry's id.
const fileOps = () => import(pathToFileURL(path.join(distRoot, 'dist', 'engine', 'src', 'file-ops.js')).href);
const isKind = (target, dir) => fs.existsSync(target) && fs.statSync(target).isDirectory() === dir;
async function movePath(req, res, url) {
  if (!isLocalRequest(req)) { res.writeHead(403); res.end('Forbidden'); return; }
  const { planMove } = await fileOps();
  const from = url.searchParams.get('from') ?? '', dir = url.searchParams.get('dir') === '1';
  const plan = planMove(from, url.searchParams.get('to') ?? '', dir);
  if ('error' in plan) { res.writeHead(400); res.end(plan.error); return; }
  const src = path.resolve(project, from), dest = path.resolve(project, plan.to);
  if (!isKind(src, dir)) { res.writeHead(404); res.end(`${from} not found`); return; }
  if (fs.existsSync(dest) && !(process.platform !== 'linux' && src.toLowerCase() === dest.toLowerCase())) { // a case-only rename is fine
    res.writeHead(409); res.end(`${plan.to} exists`); return;
  }
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(src, dest);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, to: plan.to }));
  } catch (e) { res.writeHead(500); res.end(String(e.message)); }
}
async function deletePath(req, res, url) {
  if (!isLocalRequest(req)) { res.writeHead(403); res.end('Forbidden'); return; }
  const { checkProjectPath } = await fileOps();
  const rel = url.searchParams.get('path') ?? '', dir = url.searchParams.get('dir') === '1';
  const bad = checkProjectPath(rel);
  if (bad) { res.writeHead(400); res.end(bad); return; }
  const target = path.resolve(project, rel);
  if (!isKind(target, dir)) { res.writeHead(404); res.end(`${rel} not found`); return; }
  try {
    const trash = await toTrash([rel], 'delete');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, trash }));
  } catch (e) { res.writeHead(500); res.end(String(e.message)); }
}

// ---- project trash ----
// What Delete removes and what Replace (or a new voice take) overwrites goes to .trash/<id>/ under the project, at its
// project-relative path, with a manifest.json (engine/src/trash.ts). `GET /api/trash` lists the entries newest first,
// `POST /api/trash/restore?id=` puts one back (whatever is in its way goes to the trash in turn), and `POST /api/trash/empty`
// (`?id=` for one entry) deletes for good. Old entries are purged when a new one is made and when the server starts.
const trashDir = path.join(project, '.trash');
const trashLib = () => import(pathToFileURL(path.join(distRoot, 'dist', 'engine', 'src', 'trash.js')).href);
const treeBytes = p => {
  const s = fs.statSync(p);
  return s.isDirectory() ? fs.readdirSync(p).reduce((n, f) => n + treeBytes(path.join(p, f)), 0) : s.size;
};
async function readTrash() {
  const { isTrashId, readManifest, MANIFEST } = await trashLib();
  if (!fs.existsSync(trashDir)) return [];
  return fs.readdirSync(trashDir).filter(isTrashId).flatMap(id => {
    const dir = path.join(trashDir, id);
    try {
      const m = readManifest(fs.readFileSync(path.join(dir, MANIFEST), 'utf8'));
      return m ? [{ id, ...m, bytes: treeBytes(dir) }] : [];
    } catch { return []; }
  }).sort((a, b) => b.time.localeCompare(a.time) || b.id.localeCompare(a.id)); // newest first
}
async function purgeTrash(keep) {
  const { planPurge } = await trashLib();
  for (const id of planPurge((await readTrash()).filter(e => e.id !== keep), Date.now())) fs.rmSync(path.join(trashDir, id), { recursive: true, force: true });
}
/** Moves project-relative `rels` into a new trash entry; returns its id. A path that fails to move stops the rest (and is not listed). */
async function toTrash(rels, action, keep) {
  const { trashId, MANIFEST } = await trashLib();
  fs.mkdirSync(trashDir, { recursive: true });
  const id = trashId(new Date(), fs.readdirSync(trashDir));
  const dir = path.join(trashDir, id), moved = [];
  try {
    for (const rel of rels) {
      const dest = path.join(dir, ...rel.split('/'));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.renameSync(path.resolve(project, rel), dest);
      moved.push(rel);
    }
  } finally {
    if (moved.length) fs.writeFileSync(path.join(dir, MANIFEST), JSON.stringify({ action, paths: moved, time: new Date().toISOString() }, null, 2));
    else fs.rmSync(dir, { recursive: true, force: true });
  }
  await purgeTrash(keep).catch(e => console.warn(`[trash] purge: ${e.message}`));
  return id;
}
async function listTrash(res) {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(await readTrash()));
}
async function restoreTrash(req, res, url) {
  if (!isLocalRequest(req)) { res.writeHead(403); res.end('Forbidden'); return; }
  const id = url.searchParams.get('id') ?? '';
  const entry = (await readTrash()).find(e => e.id === id);
  if (!entry) { res.writeHead(404); res.end(`${id || '(no id)'} is not in the trash`); return; }
  try {
    const inTheWay = entry.paths.filter(rel => fs.existsSync(path.resolve(project, rel)));
    const aside = inTheWay.length ? await toTrash(inTheWay, 'restore', id) : null;
    for (const rel of entry.paths) {
      const dest = path.resolve(project, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.renameSync(path.join(trashDir, id, ...rel.split('/')), dest);
    }
    fs.rmSync(path.join(trashDir, id), { recursive: true, force: true });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, paths: entry.paths, aside }));
  } catch (e) { res.writeHead(500); res.end(String(e.message)); }
}
async function emptyTrash(req, res, url) {
  if (!isLocalRequest(req)) { res.writeHead(403); res.end('Forbidden'); return; }
  const { isTrashId } = await trashLib();
  const one = url.searchParams.get('id');
  if (one !== null && !isTrashId(one)) { res.writeHead(400); res.end('Not a trash entry'); return; }
  try {
    const ids = fs.existsSync(trashDir) ? fs.readdirSync(trashDir).filter(id => isTrashId(id) && (one === null || id === one)) : [];
    for (const id of ids) fs.rmSync(path.join(trashDir, id), { recursive: true, force: true });
    if (fs.existsSync(trashDir) && !fs.readdirSync(trashDir).length) fs.rmdirSync(trashDir);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, removed: ids.length }));
  } catch (e) { res.writeHead(500); res.end(String(e.message)); }
}
purgeTrash().catch(() => {}); // dist/ may not be built yet on a first start: the next delete purges

// ---- git (the Files panel's branch, changes and Commit) ----
// `GET /api/git` gathers the facts (engine/src/git.ts decides what blocks or warns), `POST /api/git/commit` (body: the message)
// stages and commits everything under the project folder, `POST /api/git/ignore` adds the missing GIT_IGNORE_LINES to the
// project's .gitignore. git runs through execFile with fixed arguments (no shell); paths only ever reach it after `--`.
// Nothing here pushes, pulls, switches branches or discards changes.
const gitLib = () => import(pathToFileURL(path.join(distRoot, 'dist', 'engine', 'src', 'git.js')).href);
const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' };
const git = args => new Promise(resolve => execFile('git', args, { cwd: project, env: gitEnv, maxBuffer: 64_000_000, windowsHide: true },
  (err, stdout, stderr) => resolve({ ok: !err, code: err ? err.code : 0, stdout, stderr: String(stderr).trim() })));
// Everything under the project except the trash, which is excluded by pathspec until .gitignore covers it (git add refuses
// to be handed a path that is ignored, even in an exclude).
const gitScope = trashIgnored => ['--', '.', ...(trashIgnored ? [] : [':(exclude).trash'])];
const OPERATIONS = { MERGE_HEAD: 'merge', 'rebase-merge': 'rebase', 'rebase-apply': 'rebase', CHERRY_PICK_HEAD: 'cherry-pick', REVERT_HEAD: 'revert' };

async function gitFacts() {
  const where = await git(['rev-parse', '--show-prefix']);
  if (!where.ok) return { repo: false, git: where.code !== 'ENOENT' };
  const { parseGitStatus, LFS_WARN_BYTES, GIT_IGNORE_LINES } = await gitLib();
  const prefix = where.stdout.trim();
  const probes = GIT_IGNORE_LINES.map(l => `${l.replace(/^\/|\/$/g, '')}/probe`);
  const ignored = (await git(['check-ignore', '--', ...probes])).stdout.split('\n').map(s => s.trim());
  const unignored = GIT_IGNORE_LINES.filter((_, i) => !ignored.includes(probes[i]));
  const trashIgnored = ignored.includes('.trash/probe');
  const [head, gitPaths, status] = await Promise.all([
    git(['symbolic-ref', '--short', '-q', 'HEAD']),
    git(['rev-parse', ...Object.keys(OPERATIONS).flatMap(k => ['--git-path', k])]),
    git(['status', '--porcelain=v1', '-z', '--untracked-files=all', ...gitScope(trashIgnored)]),
  ]);
  if (!status.ok) throw new Error(status.stderr || 'git status failed');
  const found = gitPaths.stdout.split('\n').map(s => s.trim()).filter(Boolean).findIndex(p => fs.existsSync(path.resolve(project, p)));
  const changes = parseGitStatus(status.stdout, prefix);
  const sized = changes.flatMap(c => {
    try { const bytes = fs.statSync(path.resolve(project, c.path)).size; return /\.psd$/i.test(c.path) || bytes >= LFS_WARN_BYTES ? [{ path: c.path, bytes }] : []; } catch { return []; }
  });
  const attrs = sized.length ? (await git(['check-attr', '-z', 'filter', '--', ...sized.map(s => s.path)])).stdout.split('\0') : [];
  const lfs = new Set(attrs.flatMap((_, i) => (i % 3 === 0 && attrs[i + 2] === 'lfs' ? [attrs[i]] : [])));
  return {
    repo: true, git: true, changes, branch: head.ok ? head.stdout.trim() : null,
    operation: found < 0 ? null : Object.values(OPERATIONS)[found],
    large: sized.map(s => ({ ...s, lfs: lfs.has(s.path) })),
    unignored, trashIgnored,
  };
}

async function readGit(res) {
  try {
    const facts = await gitFacts();
    const { checkCommit, suggestCommitMessage } = await gitLib();
    const extra = facts.repo ? { ...checkCommit(facts), suggest: suggestCommitMessage(facts.changes) } : {};
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ...facts, ...extra }));
  } catch (e) { res.writeHead(500); res.end(String(e.message)); }
}

async function commitGit(req, res) {
  if (!isLocalRequest(req)) { res.writeHead(403); res.end('Forbidden'); return; }
  try {
    const message = (await readBody(req, 100_000)).trim();
    if (!message) { res.writeHead(400); res.end('Write a commit message first'); return; }
    const facts = await gitFacts();
    if (!facts.repo) { res.writeHead(409); res.end('The project is not in a git repository'); return; }
    const { blockers } = (await gitLib()).checkCommit(facts);
    if (blockers.length) { res.writeHead(409); res.end(blockers.join(' ')); return; }
    const scope = gitScope(facts.trashIgnored);
    const add = await git(['add', '-A', ...scope]);
    if (!add.ok) { res.writeHead(500); res.end(add.stderr); return; }
    const commit = await git(['commit', '--no-edit', '-m', message, ...scope]);
    if (!commit.ok) { res.writeHead(500); res.end(commit.stderr || commit.stdout.trim()); return; }
    const hash = (await git(['rev-parse', '--short', 'HEAD'])).stdout.trim();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, hash, files: facts.changes.length }));
  } catch (e) { res.writeHead(500); res.end(String(e.message)); }
}

async function ignoreGit(req, res) {
  if (!isLocalRequest(req)) { res.writeHead(403); res.end('Forbidden'); return; }
  try {
    const facts = await gitFacts();
    if (!facts.repo) { res.writeHead(409); res.end('The project is not in a git repository'); return; }
    const file = path.join(project, '.gitignore');
    const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (facts.unignored.length) fs.writeFileSync(file, `${text}${text && !text.endsWith('\n') ? '\n' : ''}${facts.unignored.join('\n')}\n`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, added: facts.unignored }));
  } catch (e) { res.writeHead(500); res.end(String(e.message)); }
}
// A file dropped on the editor's Assets panel: the body is the file, `name` its original name and `folder` the asset folder it
// was dropped on (engine/src/asset-drop.ts decides where it goes). An existing file is never overwritten (409).
const MAX_ASSET_BYTES = 200_000_000;
// A voice take is the exception: `voice=<id>[.<lang>]` names it (planDrop would turn the dot into `_`), `name` supplies the audio
// extension, and `replace=1` overwrites an existing take, moving the same recording under any extension to the trash. The reply
// carries the file's sha1, which is what voice.lock.json stores.
// The files panel's Replace is the other: `replace=<assets/... or masters/... path>` overwrites that existing file, same extension
// (the old one goes to the trash; the reply's `trash` is the entry).
const VOICE_AUDIO = /\.(ogg|mp3|wav|m4a|flac|opus)$/i;
async function saveAsset(req, res, url) {
  if (!isLocalRequest(req)) { res.writeHead(403); res.end('Forbidden'); return; }
  const voice = url.searchParams.get('voice');
  const replacing = voice === null ? url.searchParams.get('replace') : null;
  let plan, replaceVoice = null;
  if (replacing !== null) {
    const { checkProjectPath } = await fileOps();
    const ext = s => path.extname(s).toLowerCase();
    const bad = checkProjectPath(replacing) ?? (replacing.startsWith('script/') ? 'replace assets and masters only' : null)
      ?? (ext(replacing) !== ext(url.searchParams.get('name') ?? '') ? `pick a ${ext(replacing) || 'same-type'} file` : null);
    if (bad) { res.writeHead(400); res.end(bad); return; }
    if (!isKind(path.resolve(project, replacing), false)) { res.writeHead(404); res.end(`${replacing} not found`); return; }
    plan = { dest: replacing };
  } else if (voice !== null) {
    const ext = VOICE_AUDIO.exec(url.searchParams.get('name') ?? '')?.[0].toLowerCase();
    if (!/^[\w\-]+(\.[\w\-]+)?$/.test(voice) || !ext) { res.writeHead(400); res.end('Not a voice recording name'); return; }
    plan = { dest: `assets/voice/${voice}${ext}` };
    if (url.searchParams.get('replace') === '1') replaceVoice = voice;
  } else {
    const { planDrop } = await import(pathToFileURL(path.join(distRoot, 'dist', 'engine', 'src', 'asset-drop.js')).href);
    plan = planDrop(url.searchParams.get('name') ?? '', url.searchParams.get('folder') ?? '');
  }
  const target = 'dest' in plan ? path.resolve(project, plan.dest) : '';
  if ('error' in plan || !target.startsWith(project + path.sep)) { res.writeHead(400); res.end('error' in plan ? plan.error : 'Bad path'); return; }
  const dir = path.dirname(target);
  // Takes of the same recording under another extension would make the name ambiguous (the first by file name wins).
  const siblings = voice === null ? [] : (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter(f => VOICE_AUDIO.test(f) && f.replace(VOICE_AUDIO, '') === voice);
  if (replacing !== null ? false : voice === null ? fs.existsSync(target) : siblings.length && !replaceVoice) {
    res.writeHead(409, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ dest: voice === null ? plan.dest : `assets/voice/${siblings[0]}` }));
    return;
  }
  try {
    const body = await readBuffer(req, MAX_ASSET_BYTES);
    fs.mkdirSync(dir, { recursive: true });
    // What gets overwritten goes to the trash first: the replaced file, or every take of the re-recorded line.
    const old = replacing !== null ? [replacing] : siblings.map(f => `assets/voice/${f}`);
    const trash = old.length ? await toTrash(old, 'replace') : undefined;
    fs.writeFileSync(target, body);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, dest: plan.dest, trash, ...(voice === null ? {} : { sum: crypto.createHash('sha1').update(body).digest('hex') }) }));
  } catch (e) { res.writeHead(500); res.end(String(e.message)); }
}

// The translation tables, so the editor can keep `[variable]` in them in step with a rename. Only locale/<lang>.json, and the
// locale/<lang>.src source snapshots the Translations dialog keeps beside them (JSON too, but not a language: the game skips them).
const localeName = file => /^[\w\-]+\.(json|src)$/.test(file) && path.resolve(localeDir, file).startsWith(localeDir + path.sep);

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
    const body = await readBody(req, 50_000_000); // a big project's table is several MB
    try { JSON.parse(body); } catch (e) { res.writeHead(400); res.end(`Invalid JSON: ${e.message}`); return; }
    fs.mkdirSync(localeDir, { recursive: true });
    fs.writeFileSync(path.join(localeDir, file), body);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  } catch (e) { res.writeHead(500); res.end(String(e.message)); }
}

// Voice recordings and what the lock remembers of them; the editor's Voice dialog compares them with the lines (voice.lock.json).
async function readVoice(res) {
  const { readRecordings, readLock, readVoiceFiles } = await import('../tools/voice-check.mjs');
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ recordings: readRecordings(project), files: readVoiceFiles(project), lock: readLock(project) }));
}

async function saveVoice(req, res) {
  if (!isLocalRequest(req)) { res.writeHead(403); res.end('Forbidden'); return; }
  try {
    const lock = JSON.parse(await readBody(req, 10_000_000));
    if (!lock || typeof lock !== 'object' || Array.isArray(lock) || Object.values(lock).some(e => typeof e?.sum !== 'string' || typeof e?.text !== 'string')) {
      res.writeHead(400); res.end('Not a voice lock'); return;
    }
    const { writeLock } = await import('../tools/voice-check.mjs');
    writeLock(project, lock);
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
// The editor's Build dialog: `name=build&target=web|desktop&out=<folder>`. The folder is a validated parameter (never raw args): it
// must sit inside build/ (export-web.mjs also refuses anything that is not clearly an export target, and deletes what it replaces).
const buildFolder = out => /^build(\/\w[\w.-]*)+$/.test(out) && !out.includes('..');
function taskArgs(url) {
  const name = url.searchParams.get('name') ?? '';
  if (name !== 'build') return Object.hasOwn(TASKS, name) ? TASKS[name] : undefined;
  const target = url.searchParams.get('target');
  const out = url.searchParams.get('out') ?? `build/${target}`;
  if ((target !== 'web' && target !== 'desktop') || !buildFolder(out)) return undefined;
  const langs = langParams(url);
  if (!langs) return undefined;
  return ['tools/export-web.mjs', '--no-build', ...(target === 'desktop' ? ['--desktop'] : []), '--out', out,
    ...(langs.text ? ['--locales', langs.text.join(',')] : []), ...(langs.voice ? ['--voice', langs.voice.join(',')] : [])];
}
// `locales=fi,ja&voice=en` (present but empty = none): validated language codes, or null when one is malformed.
function langParams(url) {
  const out = {};
  for (const [param, key] of [['locales', 'text'], ['voice', 'voice']]) {
    const v = url.searchParams.get(param);
    if (v === null) continue;
    const list = v.split(',').filter(Boolean);
    if (!list.every(l => /^[A-Za-z0-9_-]{1,12}$/.test(l))) return null;
    out[key] = list;
  }
  return out;
}
let taskRunning = false;
// The answer streams as NDJSON while the task runs: `{"out": text}` per chunk of stdout/stderr, then `{"ok": bool}` at exit.
function runTask(req, res, url) {
  const args = taskArgs(url);
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

// The pre-build checks (engine/src/build-checks.ts) on the project as it is on disk; the editor's Build dialog lists them.
async function readBuildCheck(req, res, url) {
  const include = langParams(url);
  if (!isLocalRequest(req) || !include) { res.writeHead(403); res.end('Forbidden'); return; }
  try {
    const { runBuildChecks } = await import('../tools/build-checks.mjs');
    const { report, languages } = runBuildChecks(project, undefined, include);
    const { findings, errors, warnings } = report;
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ findings, errors, warnings, languages }));
  } catch (e) { res.writeHead(500); res.end(String(e.message)); }
}

// ---- http ----
http.createServer((req, res) => {
  if (!isLocalHost(req.headers.host)) { res.writeHead(403); res.end('Forbidden host'); return; } // reads too: script text must not leak
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/__events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('retry: 500\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (url.pathname === '/api/script' && req.method === 'PUT') { saveScript(req, res, url); return; }
  if (url.pathname === '/api/asset' && req.method === 'PUT') { saveAsset(req, res, url); return; }
  if (url.pathname === '/api/folder' && req.method === 'PUT') { saveFolder(req, res, url); return; }
  if (url.pathname === '/api/move' && req.method === 'POST') { void movePath(req, res, url); return; }
  if (url.pathname === '/api/delete' && req.method === 'POST') { void deletePath(req, res, url); return; }
  if (url.pathname === '/api/trash' && req.method === 'GET') { void listTrash(res); return; }
  if (url.pathname === '/api/trash/restore' && req.method === 'POST') { void restoreTrash(req, res, url); return; }
  if (url.pathname === '/api/trash/empty' && req.method === 'POST') { void emptyTrash(req, res, url); return; }
  if (url.pathname === '/api/git' && req.method === 'GET') { void readGit(res); return; }
  if (url.pathname === '/api/git/commit' && req.method === 'POST') { void commitGit(req, res); return; }
  if (url.pathname === '/api/git/ignore' && req.method === 'POST') { void ignoreGit(req, res); return; }
  if ((url.pathname === '/api/reveal' || url.pathname === '/api/open') && req.method === 'POST') { showPath(req, res, url, url.pathname.slice(5)); return; }
  if (url.pathname === '/api/game' && req.method === 'PUT') { saveGame(req, res); return; }
  if (url.pathname === '/api/locales' && req.method === 'GET') { readLocales(res); return; }
  if (url.pathname === '/api/locale' && req.method === 'PUT') { saveLocale(req, res, url); return; }
  if (url.pathname === '/api/voice' && req.method === 'GET') { void readVoice(res); return; }
  if (url.pathname === '/api/voice' && req.method === 'PUT') { void saveVoice(req, res); return; }
  if (url.pathname === '/api/rig' && req.method === 'PUT') { saveRig(req, res, url); return; }
  if (url.pathname === '/api/build-check' && req.method === 'GET') { void readBuildCheck(req, res, url); return; }
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
