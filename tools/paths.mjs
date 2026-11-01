// Where things live. The engine folder holds the code (engine/, preview/, editor/, tools/, dist/, node_modules/);
// a game project holds the content (game.json, script/, locale/, assets/, masters/, build/). They are separate
// folders when a game uses the engine as a package; inside the engine repo the project is the bundled sample.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const engineRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const sampleRoot = path.join(engineRoot, 'sample');
export const engineVersion = JSON.parse(fs.readFileSync(path.join(engineRoot, 'package.json'), 'utf8')).version;

const isProject = dir => fs.existsSync(path.join(dir, 'game.json')) || fs.existsSync(path.join(dir, 'script'));

/** VN_PROJECT (set by the vn command), else the current folder, else (in the engine repo) the sample. */
export function findProject(start = process.env.VN_PROJECT || process.cwd()) {
  const dir = path.resolve(start);
  if (isProject(dir)) return dir;
  if (dir === engineRoot) return sampleRoot;
  return null;
}

export function projectRoot() {
  const dir = findProject();
  if (!dir) {
    console.error(`No game project in ${path.resolve(process.env.VN_PROJECT || process.cwd())} (no game.json or script/).`);
    console.error('Start one with: vn init <folder>');
    process.exit(1);
  }
  return dir;
}

/** Warn when game.json asks for a newer engine ("engine": "0.3") than this one. */
export function checkEngineVersion(project) {
  let wanted;
  try { wanted = JSON.parse(fs.readFileSync(path.join(project, 'game.json'), 'utf8')).engine; } catch { return; }
  if (typeof wanted !== 'string') return;
  const parse = v => v.split('.').map(n => Number(n) || 0);
  const [wMaj, wMin = 0] = parse(wanted), [eMaj, eMin = 0] = parse(engineVersion);
  if (eMaj < wMaj || (eMaj === wMaj && eMin < wMin)) {
    console.warn(`This game expects engine ${wanted} or newer, but the engine is ${engineVersion} (${engineRoot}). Update the engine.`);
  }
}
