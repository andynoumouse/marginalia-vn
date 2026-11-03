// The online demo: the editor as a static site that keeps its projects in the browser (online/: a service worker serves
// the dev server's API from IndexedDB). Upload the folder to any HTTPS host, at its root or in a subfolder.
//   node scripts/build-online.mjs [--out build/online] [--no-build]       (npm run build:online)
//
//   index.html, sw.js        the project list (online/index.html) and the service worker's entry (it must sit at the root)
//   dist/                    the compiled engine, editor, preview and online code
//   editor/, preview/, docs/ the pages and the help the editor reads
//   vendor/                  Monaco, PixiJS and ag-psd (the PSD converter) from node_modules
//   seed/                    the sample game (its files in git), copied into a new project by "New from the sample game"

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outArg = args.indexOf('--out');
const out = path.resolve(root, outArg >= 0 ? args[outArg + 1] : 'build/online');
if (!path.relative(root, out).startsWith('build')) { console.error(`--out must be inside build/ (it is replaced): ${out}`); process.exit(1); }

if (!args.includes('--no-build')) {
  const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
  if (spawnSync(process.execPath, [tsc, '-p', '.'], { cwd: root, stdio: 'inherit' }).status !== 0) { console.error('TypeScript build failed.'); process.exit(1); }
}
for (const need of ['node_modules/monaco-editor/min', 'node_modules/pixi.js/dist/pixi.min.mjs', 'node_modules/ag-psd/dist/bundle.js']) {
  if (!fs.existsSync(path.join(root, need))) { console.error(`${need} is missing: run "npm install".`); process.exit(1); }
}

fs.rmSync(out, { recursive: true, force: true });
const copy = (from, to = from, filter) => fs.cpSync(path.join(root, from), path.join(out, to), { recursive: true, filter });
const noBuildInfo = src => !src.endsWith('.tsbuildinfo');

copy('online/index.html', 'index.html');
// ag-psd's browser bundle is a UMD script: imported for its side effect, it sets self.agPsd before the worker's module runs.
fs.writeFileSync(path.join(out, 'sw.js'), "import './vendor/ag-psd/bundle.js';\nimport './dist/online/sw.js';\n");
for (const dir of ['engine', 'editor', 'preview', 'online']) copy(`dist/${dir}`, `dist/${dir}`, noBuildInfo);
copy('editor/index.html');
copy('preview/index.html');
for (const f of fs.readdirSync(path.join(root, 'docs')).filter(f => f.endsWith('.md'))) copy(`docs/${f}`);
copy('node_modules/monaco-editor/min', 'vendor/monaco');
copy('node_modules/pixi.js/dist/pixi.min.mjs', 'vendor/pixi/pixi.min.mjs');
copy('node_modules/ag-psd/dist/bundle.js', 'vendor/ag-psd/bundle.js');
copy('node_modules/ag-psd/LICENSE', 'vendor/ag-psd/LICENSE');

// The sample as git has it (no build/ output, no trash), with its file list for the project list page.
const tracked = execFileSync('git', ['ls-files', '-z', '--', 'sample'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)
  .map(f => f.slice('sample/'.length)).filter(f => !/^(build|\.trash)\//.test(f) && fs.existsSync(path.join(root, 'sample', f)));
for (const f of tracked) copy(`sample/${f}`, `seed/${f}`);
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
let title = 'Sample game';
try { title = JSON.parse(fs.readFileSync(path.join(root, 'sample', 'game.json'), 'utf8')).title || title; } catch { /* default */ }
fs.writeFileSync(path.join(out, 'seed', 'index.json'), JSON.stringify({ engine: pkg.version, title, files: tracked }, null, 2) + '\n');
fs.writeFileSync(path.join(out, '.nojekyll'), ''); // GitHub Pages: serve the folder as it is

const size = dir => fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter(e => e.isFile())
  .reduce((n, e) => n + fs.statSync(path.join(e.parentPath ?? e.path, e.name)).size, 0);
console.log(`Online demo written to ${path.relative(root, out) || '.'} (${(size(out) / 1e6).toFixed(1)} MB, ${tracked.length} sample files).`);
console.log('Serve it over HTTPS (or from localhost), at the root or in a subfolder; open index.html.');
