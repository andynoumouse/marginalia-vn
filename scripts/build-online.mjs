// The online demo: the editor as a static site that keeps its projects in the browser (online/: a service worker serves
// the dev server's API from IndexedDB). Upload the folder to any HTTPS host, at its root or in a subfolder.
//   node scripts/build-online.mjs [--out build/online] [--no-build]       (npm run build:online)
//
//   index.html, sw.js        the project list (online/index.html) and the service worker's entry (it must sit at the root)
//   dist/                    the engine, editor, preview and online code, bundled to one file per page
//   editor/, preview/, docs/ the pages and the help the editor reads
//   vendor/                  Monaco, PixiJS and ag-psd (the PSD converter) from node_modules
//   templates/assets/        the shared asset pool: the placeholder art and audio a new project copies
//   seed/<id>/               the bundled game (the Iris demo; its files in git), copied into a new project by the list page's card

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

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

copy('online/index.html', 'index.html');
// ag-psd's browser bundle is a UMD script: imported for its side effect, it sets self.agPsd before the worker's module runs.
fs.writeFileSync(path.join(out, 'sw.js'), "import './vendor/ag-psd/bundle.js';\nimport './dist/online/sw.js';\n");
// One bundled file per page (esbuild, from the tsc output), at the paths the pages already load. PixiJS stays external:
// preview/index.html maps it to vendor/pixi through an import map.
await build({
  entryPoints: ['editor/editor', 'editor/help-page', 'preview/preview', 'online/projects', 'online/sw'].map(e => path.join(root, 'dist', `${e}.js`)),
  outdir: path.join(out, 'dist'), outbase: path.join(root, 'dist'),
  bundle: true, format: 'esm', target: 'es2022', minify: true, sourcemap: false, external: ['pixi.js'], logLevel: 'warning',
});
copy('editor/index.html');
copy('editor/help.html');
copy('editor/help.css');
copy('editor/studio.css');
copy('preview/index.html');
for (const f of fs.readdirSync(path.join(root, 'docs')).filter(f => f.endsWith('.md'))) copy(`docs/${f}`);
copy('templates/assets');
copy('node_modules/monaco-editor/min', 'vendor/monaco');
copy('node_modules/pixi.js/dist/pixi.min.mjs', 'vendor/pixi/pixi.min.mjs');
copy('node_modules/ag-psd/dist/bundle.js', 'vendor/ag-psd/bundle.js');
copy('node_modules/ag-psd/LICENSE', 'vendor/ag-psd/LICENSE');

// The bundled games as git has them (no build/ output, no trash), each under seed/<id>/, with their file lists for the project list page.
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const GAMES = [
  { id: 'demo', dir: 'games/demo', title: 'Rainy Day Library', description: 'The Iris demo: a feature index with a playable card for each group of script commands, a guided tour, a library map and several endings.' },
];
const games = [];
let count = 0;
for (const g of GAMES) {
  const tracked = execFileSync('git', ['ls-files', '-z', '--', g.dir], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)
    .map(f => f.slice(g.dir.length + 1)).filter(f => !/^(build|\.trash)\//.test(f) && fs.existsSync(path.join(root, g.dir, f)));
  for (const f of tracked) copy(`${g.dir}/${f}`, `seed/${g.id}/${f}`);
  let title = g.title;
  try { title = JSON.parse(fs.readFileSync(path.join(root, g.dir, 'game.json'), 'utf8')).title || title; } catch { /* default */ }
  games.push({ id: g.id, title, description: g.description, files: tracked });
  count += tracked.length;
}
fs.writeFileSync(path.join(out, 'seed', 'index.json'), JSON.stringify({ engine: pkg.version, games }, null, 2) + '\n');
// The pages' own script URLs carry the version, so a new release is never served from the browser's cache of the old one.
for (const f of ['index.html', 'editor/index.html', 'preview/index.html']) {
  const target = path.join(out, f);
  fs.writeFileSync(target, fs.readFileSync(target, 'utf8').replace(/(src="(?:\.\.\/)?dist\/[\w/-]+\.js)"/g, `$1?v=${pkg.version}"`));
}
fs.writeFileSync(path.join(out, '.nojekyll'), ''); // GitHub Pages: serve the folder as it is

const size = dir => fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter(e => e.isFile())
  .reduce((n, e) => n + fs.statSync(path.join(e.parentPath ?? e.path, e.name)).size, 0);
console.log(`Online demo written to ${path.relative(root, out) || '.'} (${(size(out) / 1e6).toFixed(1)} MB, ${count} bundled game files).`);
console.log('Serve it over HTTPS (or from localhost), at the root or in a subfolder; open index.html.');
