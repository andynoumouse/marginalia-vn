// The project as the game sees it: scripts, locale tables, the asset list and game.json.
// Served live by the dev server (/api/project) and written as project.json by the web export.

import fs from 'node:fs';
import path from 'node:path';

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

export function projectData(root) {
  const scriptDir = path.join(root, 'script'), localeDir = path.join(root, 'locale'), assetDir = path.join(root, 'assets');
  const scripts = listFiles(scriptDir, '.vn').map(f => ({ file: rel(scriptDir, f), text: fs.readFileSync(f, 'utf8') }));
  const scriptDirs = listDirs(scriptDir);
  const locales = {};
  for (const f of listFiles(localeDir, '.json')) {
    try { locales[path.basename(f, '.json')] = JSON.parse(fs.readFileSync(f, 'utf8')); }
    catch (e) { console.warn(`Bad locale file ${f}: ${e.message}`); }
  }
  // Asset list with a version stamp so the renderer refetches files that changed.
  const assets = listFiles(assetDir).map(f => ({ file: rel(assetDir, f), v: Math.floor(fs.statSync(f).mtimeMs) }));
  // Layered characters (PSD converter output), for checking poses and slots used in scripts.
  const rigs = {}, rigTexts = {}; // rigTexts: raw rig.json per character, for the editor
  for (const a of assets) {
    const m = /^char\/([^/]+)\/sprite\.json$/.exec(a.file);
    if (!m) continue;
    try { rigs[m[1]] = JSON.parse(fs.readFileSync(path.join(assetDir, a.file), 'utf8')); }
    catch (e) { console.warn(`Bad ${a.file}: ${e.message}`); }
  }
  // A flat character (one image per pose) with a rig.json gets a manifest without parts, so its animations work.
  for (const a of assets) {
    const m = /^char\/([^/]+)\/rig\.json$/.exec(a.file);
    if (m && !rigs[m[1]]) rigs[m[1]] = { parts: [], flat: true };
  }
  // Hand-written additions (z-order, groups, shorthands) next to a generated sprite.json: engine/src/rig.ts.
  for (const [char, manifest] of Object.entries(rigs)) {
    const file = path.join(assetDir, 'char', char, 'rig.json');
    if (!fs.existsSync(file)) continue;
    try { rigTexts[char] = fs.readFileSync(file, 'utf8'); manifest.rig = JSON.parse(rigTexts[char]); }
    catch (e) { console.warn(`Bad char/${char}/rig.json: ${e.message}`); }
  }
  // game.json: parsed for the game, raw text for the editor (keeps the author's formatting).
  let game = {}, gameText = null;
  try { gameText = fs.readFileSync(path.join(root, 'game.json'), 'utf8'); game = JSON.parse(gameText); }
  catch (e) { if (e.code !== 'ENOENT') console.warn(`Bad game.json: ${e.message}`); }
  return { scripts, scriptDirs, locales, assets, rigs, rigTexts, game, gameText };
}
