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
  for (const top of ['script', 'locale', 'assets']) {
    const dir = path.join(root, top);
    for (const f of listFiles(dir)) files.push({ path: `${top}/${rel(dir, f)}`, mtime: fs.statSync(f).mtimeMs });
    for (const d of listDirs(dir)) dirs.push(`${top}/${d}`);
  }
  const game = path.join(root, 'game.json');
  if (fs.existsSync(game)) files.push({ path: 'game.json', mtime: fs.statSync(game).mtimeMs });
  const text = p => { try { return fs.readFileSync(path.join(root, ...p.split('/')), 'utf8'); } catch { return null; } };
  return { files, dirs, text, warn: m => console.warn(m) };
}

export const projectData = root => projectFromListing(projectListing(root));
