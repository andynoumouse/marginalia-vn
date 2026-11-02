// Pre-release scan of the tracked files for things that must not reach the public repo: local paths, the owner's
// personal email, tokens and private keys. Exits 1 and lists each hit when it finds any. Run it on `main` before pushing.
import { execFileSync } from 'node:child_process';

const patterns = [
  ['local Windows path', String.raw`[A-Za-z]:\\(Users|Code)\\`],
  ['local path (slashes)', String.raw`[A-Za-z]:/(Users|Code)/`],
  ['user home path', String.raw`/(Users|home)/[a-z0-9_.-]+/`],
  ['personal email', String.raw`@gmail\.com`],
  ['GitHub token', String.raw`gh[pousr]_[A-Za-z0-9]{20,}`],
  ['API key', String.raw`sk-[A-Za-z0-9]{20,}`],
  ['private key', String.raw`-----BEGIN [A-Z ]*PRIVATE KEY-----`],
];

let hits = 0;
for (const [name, re] of patterns) {
  let out = '';
  try { out = execFileSync('git', ['grep', '-n', '-I', '-E', '-e', re, '--', '.', ':!package-lock.json', ':!scripts/sanitize-check.mjs'], { encoding: 'utf8' }); }
  catch (e) { if (e.status !== 1) throw e; }
  for (const line of out.split('\n').filter(Boolean)) { console.log(`${name}: ${line.slice(0, 160)}`); hits++; }
}
console.log(hits ? `${hits} hit(s): fix or justify them before pushing.` : 'Clean: no paths, emails or secrets found in tracked files.');
process.exit(hits ? 1 : 0);
