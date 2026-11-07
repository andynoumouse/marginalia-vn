// Runs the node:test files. `fast` skips browser.test.mjs (it plays the sample in a real browser, ~30 s), studio.test.mjs
// (Marginalia Studio in Electron) and dock-ui.test.mjs (the docking layer on its own page); `browser`, `studio` and `dock`
// run only that file, `all` runs everything but the Studio's. Extra arguments go to `node --test`.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const BROWSER = 'browser.test.mjs', STUDIO = 'studio.test.mjs', DOCK = 'dock-ui.test.mjs';
const MODES = {
  fast: f => f !== BROWSER && f !== STUDIO && f !== DOCK,
  browser: f => f === BROWSER,
  studio: f => f === STUDIO,
  dock: f => f === DOCK,
  all: f => f !== STUDIO,
};
const [mode = 'fast', ...rest] = process.argv.slice(2);
if (!Object.hasOwn(MODES, mode)) {
  console.error(`Use: node scripts/test.mjs [${Object.keys(MODES).join('|')}] [node --test options]`);
  process.exit(2);
}
const files = readdirSync('engine/test')
  .filter(f => f.endsWith('.test.mjs') && MODES[mode](f))
  .map(f => `engine/test/${f}`);
// Tests must not leave changes in the game projects (a stray autosave once wrote into park.vn): compare `git status`
// of games/ before and after, and name any file that changed.
const dirty = () => {
  const g = spawnSync('git', ['status', '--porcelain', '--', 'games/'], { encoding: 'utf8' });
  return g.status === 0 ? new Set(g.stdout.split('\n').filter(Boolean)) : null;
};
const before = dirty();
const r = spawnSync(process.execPath, ['--test', ...rest, ...files], { stdio: 'inherit' });
const after = dirty();
let polluted = false;
if (before && after) {
  const changed = [...after].filter(l => !before.has(l));
  if (changed.length) {
    polluted = true;
    console.error(`\nThe tests changed files under games/ (restore them with git checkout):\n${changed.join('\n')}`);
  }
}
process.exit(polluted ? 1 : r.status ?? 1);
