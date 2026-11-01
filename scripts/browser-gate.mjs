// Decides whether Claude should run the (slow) browser tests before a commit: every 5th gated change only, unless the
// user asks. Each call counts one change that touched preview/, editor/ or the renderer; the count lives in
// .claude/browser-test-counter (untracked). Prints RUN or SKIP.
import fs from 'node:fs';
const file = new URL('../.claude/browser-test-counter', import.meta.url);
let n = 0;
try { n = Number(fs.readFileSync(file, 'utf8')) || 0; } catch { /* first call */ }
n++;
fs.mkdirSync(new URL('.', file), { recursive: true });
fs.writeFileSync(file, String(n % 5));
console.log(n % 5 === 0 ? 'RUN browser tests (5th change since the last run)' : `SKIP browser tests (${n % 5}/5)`);
