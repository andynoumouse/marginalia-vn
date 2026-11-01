// Runs the node:test files. `fast` skips browser.test.mjs (it plays the sample in a real browser and takes ~2.5 minutes),
// `browser` runs only that file, `all` runs everything. Extra arguments go to `node --test`.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const [mode = 'fast', ...rest] = process.argv.slice(2);
if (!['fast', 'browser', 'all'].includes(mode)) {
  console.error('Use: node scripts/test.mjs [fast|browser|all] [node --test options]');
  process.exit(2);
}
const BROWSER = 'browser.test.mjs';
const files = readdirSync('engine/test')
  .filter(f => f.endsWith('.test.mjs'))
  .filter(f => (mode === 'all') || (mode === 'browser') === (f === BROWSER))
  .map(f => `engine/test/${f}`);
const r = spawnSync(process.execPath, ['--test', ...rest, ...files], { stdio: 'inherit' });
process.exit(r.status ?? 1);
