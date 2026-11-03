// Where things live. The engine folder holds the code (engine/, preview/, editor/, tools/, dist/, node_modules/);
// a game project holds the content (game.json, script/, locale/, assets/, masters/, build/). They are separate
// folders when a game uses the engine as a package; inside the engine repo the project is the bundled sample.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const engineRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const sampleRoot = path.join(engineRoot, 'games', 'sample');
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

/**
 * How a game's game.json "engine" ("0.3", major.minor) compares with an engine version: 'newer-game' when the game asks
 * for a newer engine, 'older-game' when it was made with an older one, 'ok' when they match or the game names none.
 */
export function engineStatus(wanted, have = engineVersion) {
  if (typeof wanted !== 'string') return { wanted: null, have, status: 'ok' };
  const parse = v => v.split('.').map(n => Number(n) || 0);
  const [wMaj, wMin = 0] = parse(wanted), [hMaj, hMin = 0] = parse(have);
  const diff = wMaj !== hMaj ? wMaj - hMaj : wMin - hMin;
  return { wanted, have, status: diff > 0 ? 'newer-game' : diff < 0 ? 'older-game' : 'ok' };
}

/** The project's engineStatus; warns when the game asks for a newer engine than this one (unless quiet). */
export function checkEngineVersion(project, { quiet = false } = {}) {
  let wanted;
  try { wanted = JSON.parse(fs.readFileSync(path.join(project, 'game.json'), 'utf8')).engine; } catch { /* no game.json */ }
  const result = engineStatus(wanted);
  if (result.status === 'newer-game' && !quiet) {
    console.warn(`This game expects engine ${wanted} or newer, but the engine is ${engineVersion} (${engineRoot}). Update the engine.`);
  }
  return result;
}
