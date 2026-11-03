// Builds the portable Marginalia Studio: release/Marginalia Studio-<version>-<platform>-<arch>/ and a .zip of it
// (docs/design/studio.md, "Packaging"). `npm run package:studio` (it runs tsc first).
//   The folder is Electron's runtime from node_modules/electron/dist with the exe renamed, and resources/app holding the
//   engine unpacked (no asar: the dev server spawns, serves and watches files there): the prebuilt dist/, the editor,
//   preview, tools, docs and the demo, and only the vendor files that are served or imported (Monaco's min build, the one
//   PixiJS module the preview imports, ag-psd's runtime). No TypeScript, playwright or games/sample/.
//   --no-zip skips the zip.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { zipFolder } from '../tools/zip-folder.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const productName = 'Marginalia Studio';
const platform = { win32: 'win', darwin: 'mac', linux: 'linux' }[process.platform] ?? process.platform;
if (platform === 'mac') { console.error('The portable Studio is built for Windows and Linux only for now (macOS needs an .app bundle).'); process.exit(1); }
const name = `${productName}-${pkg.version}-${platform}-${process.arch}`;
const releaseDir = path.join(root, 'release');
const out = path.join(releaseDir, name);
const app = path.join(out, 'resources', 'app');

const electronDist = path.join(path.dirname(require.resolve('electron/package.json')), 'dist');
if (!fs.existsSync(electronDist)) { console.error(`No Electron runtime in ${electronDist}. Run "npm install".`); process.exit(1); }
if (!fs.existsSync(path.join(root, 'dist', 'engine', 'src', 'index.js'))) { console.error('No dist/: run "npm run build" first.'); process.exit(1); }
const { keepRuntimeFile } = await import('../dist/engine/src/index.js');

let files = 0, bytes = 0;
/** Copy a file or a folder (recursively), keeping only what `keep(relative path, isDir)` accepts. */
function copy(from, to, keep = () => true, rel = '') {
  const stat = fs.statSync(from);
  if (stat.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from)) {
      const r = rel ? `${rel}/${entry}` : entry;
      const src = path.join(from, entry);
      if (!keep(r, fs.statSync(src).isDirectory())) continue;
      copy(src, path.join(to, entry), keep, r);
    }
  } else {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    files++; bytes += stat.size;
  }
}
const fromRoot = (rel, keep) => copy(path.join(root, rel), path.join(app, rel), keep);
const noTs = (rel, dir) => dir || !/\.ts$/.test(rel); // the TypeScript sources are built into dist/
const nodeModule = (name, keep) => copy(path.join(root, 'node_modules', name), path.join(app, 'node_modules', name), keep);

fs.rmSync(out, { recursive: true, force: true });
fs.rmSync(`${out}.zip`, { force: true });

// ---- the runtime: Electron without its default app, the exe named after the Studio ----
// Only the en-US locale (the Studio's UI is English, and Chromium falls back to en-US): the others are ~49 MB. The
// licence files stay (engine/src/portable-app.ts, which the portable game export uses too).
copy(electronDist, out, keepRuntimeFile);
const exe = { win: 'electron.exe', linux: 'electron' }[platform];
const exeName = platform === 'win' ? `${productName}.exe` : productName.toLowerCase().replace(/ /g, '-');
fs.renameSync(path.join(out, exe), path.join(out, exeName));
const runtime = { files, bytes };

// ---- resources/app: the engine ----
// The engine's own package.json gives "type": "module" to dist/ and tools/, the version to tools/paths.mjs and
// app.getVersion(), and the Studio's main script.
fs.mkdirSync(app, { recursive: true });
fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({
  name: 'marginalia-studio', productName, version: pkg.version, private: true, license: pkg.license, type: 'module',
  description: 'Marginalia Studio: the Marginalia VN editor as a desktop app', main: 'studio/main.cjs',
}, null, 2) + '\n');
for (const f of ['LICENSE', 'README.md']) fromRoot(f);
fromRoot('dist', (rel, dir) => dir || (/\.js$/.test(rel)));
fromRoot('studio', rel => rel !== 'package.json');
fromRoot('editor', noTs);
fromRoot('preview', noTs);
fromRoot('tools');
fromRoot('templates');
fromRoot('bin');
fromRoot('docs', rel => rel !== 'design');
fromRoot('games/demo', rel => !['build', 'node_modules', '.trash'].includes(rel));

// ---- vendor files: only what is served or imported ----
const withPackageJson = keep => (rel, dir) => rel === 'package.json' || /^LICENSE/i.test(rel) || keep(rel, dir);
nodeModule('monaco-editor', withPackageJson(rel => rel === 'min' || rel.startsWith('min/')));
nodeModule('pixi.js', withPackageJson(rel => rel === 'dist' || rel === 'dist/pixi.min.mjs'));
// ag-psd's CommonJS build without its canvas helpers and the browser bundle; it needs base64-js and pako.
nodeModule('ag-psd', withPackageJson((rel, dir) => rel === 'dist' || (rel.startsWith('dist/') && /\.js$/.test(rel) && !/^dist\/(bundle|initializeCanvas)\.js$/.test(rel))));
nodeModule('base64-js', (rel, dir) => dir || /\.js$|package\.json$|^LICENSE/.test(rel));
nodeModule('pako', withPackageJson((rel, dir) => rel === 'index.js' || rel === 'lib' || rel.startsWith('lib/')));
// resedit (and pe-library under it) writes the icon and version info into a desktop export's exe (tools/exe-info.mjs).
for (const name of ['resedit', 'pe-library']) nodeModule(name, withPackageJson((rel, dir) => rel === 'dist' || (rel.startsWith('dist/') && (dir || /\.js$/.test(rel)))));

const mb = n => `${(n / 1048576).toFixed(1)} MB`;
console.log(`${out}\n  runtime ${mb(runtime.bytes)} (${runtime.files} files), app ${mb(bytes - runtime.bytes)} (${files - runtime.files} files)`);

if (!process.argv.includes('--no-zip')) {
  const failed = zipFolder(releaseDir, name);
  if (failed) { console.error(failed); process.exit(1); }
  console.log(`${out}.zip  ${mb(fs.statSync(`${out}.zip`).size)}`);
}
