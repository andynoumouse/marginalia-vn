// A synthetic game project with many asset files, for measuring how the editor and the dev server scale
// (docs/design/editor-asset-scaling.md). It is the sample's scripts, locale, themes, game.json and assets, plus `count` tiny
// files: half backgrounds in assets/bg/, 30% CGs in assets/cg/, 20% sounds in assets/sound/. Their size does not matter
// (nothing measured reads them), so every image is the same 1x1 PNG and every sound a few bytes.
//
//   node scripts/make-big-project.mjs <count> [<folder>]    (default folder: a new one in the system temp folder)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const SOUND = Buffer.from('OggS not really');

/** Make the project in `dir` (made if missing) and return its path. */
export function makeBigProject(count, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-big-'))) {
  const sample = path.join(root, 'games', 'sample');
  for (const top of ['script', 'locale', 'themes', 'assets', 'game.json']) {
    if (fs.existsSync(path.join(sample, top))) fs.cpSync(path.join(sample, top), path.join(dir, top), { recursive: true });
  }
  const bg = Math.round(count * 0.5), cg = Math.round(count * 0.3), sound = count - bg - cg;
  const write = (folder, n, ext, bytes) => {
    fs.mkdirSync(path.join(dir, 'assets', folder), { recursive: true });
    for (let i = 0; i < n; i++) fs.writeFileSync(path.join(dir, 'assets', folder, `${folder}_${String(i).padStart(5, '0')}${ext}`), bytes);
  };
  write('bg', bg, '.png', PNG);
  write('cg', cg, '.png', PNG);
  write('sound', sound, '.ogg', SOUND);
  return dir;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const count = Number(process.argv[2]);
  if (!Number.isInteger(count) || count < 0) { console.error('usage: node scripts/make-big-project.mjs <count> [<folder>]'); process.exit(1); }
  console.log(makeBigProject(count, process.argv[3] && path.resolve(process.argv[3])));
}
