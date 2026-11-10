// The project as the game sees it: scripts, locale tables, the asset list and game.json.
// Served live by the dev server (/api/project) and written as project.json by the web export; engine/src/project-data.ts
// builds it from the listing made here.

import fs from 'node:fs';
import path from 'node:path';

const { projectFromListing } = await import(new URL('../dist/engine/src/index.js', import.meta.url).href);

export function listFiles(dir, ext = '') {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(e => e.isFile() && e.name.endsWith(ext) && e.name !== '.gitkeep')
    .map(e => path.join(e.parentPath ?? e.path, e.name))
    .sort();
}

const rel = (dir, f) => path.relative(dir, f).split(path.sep).join('/');

/** Every folder under `dir` as a '/'-separated path, empty ones included (the editor lists them to create files in). */
export function listDirs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => rel(dir, path.join(e.parentPath ?? e.path, e.name)))
    .sort();
}

/** What checkAssets (engine/src/assets.ts) needs, from project data. */
export function assetIndex(project) {
  const game = project.game ?? {};
  return {
    files: project.assets.map(a => a.file),
    rigs: project.rigs,
    blips: Object.keys(game.blips ?? {}),
    skins: Object.keys(game.theme?.skins ?? {}),
  };
}

/** Every file and folder under script/, locale/ and assets/ (plus game.json) as the listing engine/src/project-data.ts reads. */
export function projectListing(root) {
  const files = [], dirs = [];
  for (const top of ['script', 'locale', 'themes', 'assets']) {
    const dir = path.join(root, top);
    for (const f of listFiles(dir)) files.push({ path: `${top}/${rel(dir, f)}`, mtime: fs.statSync(f).mtimeMs });
    if (top !== 'themes') for (const d of listDirs(dir)) dirs.push(`${top}/${d}`);
  }
  const game = path.join(root, 'game.json');
  if (fs.existsSync(game)) files.push({ path: 'game.json', mtime: fs.statSync(game).mtimeMs });
  const text = p => { try { return fs.readFileSync(path.join(root, ...p.split('/')), 'utf8'); } catch { return null; } };
  return { files, dirs, text, warn: m => console.warn(m) };
}

export const projectData = root => projectFromListing(projectListing(root));

const TOPS = ['script', 'locale', 'themes', 'assets'];
/** How often a listing in memory is checked against the disk anyway, in case the file watcher missed something. */
export const FULL_SCAN_MS = 60_000;

/**
 * projectListing kept in memory for the dev server, so /api/project does not walk a big project on every request.
 * The file watcher reports each changed path (`touch`) and the next listing() re-checks only those; a path it cannot
 * name, or a change it is not told about, calls for a full scan (`stale`). Text files are read once per change.
 */
export function projectIndex(root, { now = Date.now, fullScanMs = FULL_SCAN_MS } = {}) {
  const files = new Map(); // project path ('script/park.vn', 'game.json') -> mtime
  const dirs = new Set();  // 'script/sub', 'assets/bg'... (no themes/ folders, as projectListing)
  const texts = new Map(); // project path -> text, as of its last read
  let pending = new Set(), full = true, scannedAt = 0;

  const abs = p => path.join(root, ...p.split('/'));
  const inListing = p => p === 'game.json' || TOPS.some(t => p.startsWith(`${t}/`));
  const forget = p => {
    for (const map of [files, texts]) for (const k of [...map.keys()]) if (k === p || k.startsWith(`${p}/`)) map.delete(k);
    for (const d of [...dirs]) if (d === p || d.startsWith(`${p}/`)) dirs.delete(d);
  };
  /** Add what is at `p` now: a file, or a folder with everything under it. */
  const add = p => {
    let s;
    try { s = fs.statSync(abs(p)); } catch { return; }
    if (s.isFile()) { if (!p.endsWith('/.gitkeep') && p !== '.gitkeep') files.set(p, s.mtimeMs); return; }
    if (!s.isDirectory()) return;
    if (!p.startsWith('themes/') && p.includes('/')) dirs.add(p);
    for (const e of fs.readdirSync(abs(p), { withFileTypes: true })) add(`${p}/${e.name}`);
  };
  const scan = () => {
    files.clear(); dirs.clear(); texts.clear();
    for (const t of TOPS) add(t);
    add('game.json');
    pending = new Set(); full = false; scannedAt = now();
  };

  return {
    /** These project paths changed (a file or a folder, added, edited or removed); '' or null when the watcher could not say. */
    touch(paths) {
      for (const p of paths) if (!p) full = true; else if (inListing(p)) pending.add(p);
    },
    /** Something changed that the watcher may not report: scan everything at the next listing(). */
    stale() { full = true; },
    /** The listing projectFromListing reads, brought up to date. */
    listing() {
      if (full || now() - scannedAt > fullScanMs) scan();
      else if (pending.size) {
        // Shortest first, so a folder is re-added before (and instead of) the files under it.
        for (const p of [...pending].sort((a, b) => a.length - b.length)) { forget(p); add(p); }
        pending = new Set();
      }
      const text = p => {
        if (texts.has(p)) return texts.get(p);
        let t = null;
        try { t = fs.readFileSync(abs(p), 'utf8'); } catch { /* gone */ }
        texts.set(p, t);
        return t;
      };
      return {
        files: [...files].map(([p, mtime]) => ({ path: p, mtime })),
        dirs: [...dirs].sort(),
        text,
        warn: m => console.warn(m),
      };
    },
  };
}
