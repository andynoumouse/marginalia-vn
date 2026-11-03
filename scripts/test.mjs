// Runs the node:test files. `fast` skips browser.test.mjs (it plays the sample in a real browser and takes ~2.5 minutes)
// and studio.test.mjs (Marginalia Studio in Electron), `browser` and `studio` run only that file, `all` runs everything
// but the Studio's. Extra arguments go to `node --test`.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const BROWSER = 'browser.test.mjs', STUDIO = 'studio.test.mjs';
const MODES = {
  fast: f => f !== BROWSER && f !== STUDIO,
  browser: f => f === BROWSER,
  studio: f => f === STUDIO,
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
const r = spawnSync(process.execPath, ['--test', ...rest, ...files], { stdio: 'inherit' });
process.exit(r.status ?? 1);
