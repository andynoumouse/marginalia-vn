// Web export: a self-contained static folder that plays the game (no dev server, editor or dev bar).
//   vn export [--out build/web] [--no-build]       (--out is relative to the project folder)
// Upload the folder to any static host, or zip it for itch.io ("HTML" project, index.html at the root).
// Everything uses relative URLs, so the game also works from a subfolder.
//
//   vn export --desktop [--out build/desktop]
// Writes an Electron app folder instead: the same game, but assets/ is packed and scrambled into assets.pak
// (engine/src/pak.ts) and served by tools/desktop/main.cjs, so players don't browse or edit the art and audio.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { checkEngineVersion, engineRoot as root, projectRoot } from './paths.mjs';
import { assetIndex, listFiles, projectData } from './project-data.mjs';

const ELECTRON_VERSION = '^33.0.0'; // the desktop app folder installs its own copy: the engine repo does not depend on Electron
const projectDir = projectRoot();
checkEngineVersion(projectDir);
const args = process.argv.slice(2);
const desktop = args.includes('--desktop');
const outArg = args.indexOf('--out');
const out = path.resolve(projectDir, outArg >= 0 ? args[outArg + 1] : path.join('build', desktop ? 'desktop' : 'web'));
const run = (script, extra = []) =>
  spawnSync(process.execPath, [script, ...extra], { cwd: root, stdio: 'inherit', env: { ...process.env, VN_PROJECT: projectDir } }).status === 0;

// 1. Build the code and convert changed art.
if (!args.includes('--no-build')) {
  const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
  if (!run(tsc, ['-p', '.'])) { console.error('TypeScript build failed; nothing exported.'); process.exit(1); }
}
if (!run(path.join(root, 'tools', 'psd-convert.mjs'))) console.warn('Some art failed to convert (see above); exporting the rest.');

// 2. Refuse to ship a script with errors.
const project = projectData(projectDir);
const { compile, checkAssets, checkGame, namedPositions, namedAnchors, stageSize } = await import(new URL('../dist/engine/src/index.js', import.meta.url).href);
const program = compile(project.scripts, namedPositions(project.game), namedAnchors(project.game), stageSize(project.game));
const diagnostics = [...program.diagnostics, ...checkAssets(program, assetIndex(project)),
  ...checkGame(project.game, assetIndex(project), project.gameText ?? '')];
const errors = diagnostics.filter(d => d.severity === 'error');
for (const d of diagnostics) console[d.severity === 'error' ? 'error' : 'warn'](`${d.severity} ${d.file}:${d.line} ${d.message}`);
if (errors.length) { console.error(`${errors.length} script error(s); nothing exported.`); process.exit(1); }

// 3. Write the folder from scratch (refuse anything that is not clearly an export target).
if (out === projectDir || !out.startsWith(projectDir + path.sep) || ['assets', 'script', 'masters', 'locale'].includes(path.relative(projectDir, out).split(path.sep)[0])) {
  console.error(`Refusing to export into ${out}: pick a folder such as build/web.`);
  process.exit(1);
}
fs.rmSync(out, { recursive: true, force: true });
const copy = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); };

// Compiled modules the game needs: the engine and the preview shell (not the editor), from their sources.
for (const [srcDir, distDir] of [['engine/src', 'dist/engine/src'], ['preview', 'dist/preview']]) {
  for (const f of listFiles(path.join(root, srcDir), '.ts')) {
    const js = path.join(root, distDir, `${path.basename(f, '.ts')}.js`);
    copy(js, path.join(out, distDir, path.basename(js)));
  }
}
copy(path.join(root, 'node_modules/pixi.js/dist/pixi.min.mjs'), path.join(out, 'vendor/pixi/pixi.min.mjs'));
const assetsDir = path.join(projectDir, 'assets');
const assetFiles = listFiles(assetsDir);
const key = crypto.randomBytes(16).toString('hex');
if (!desktop) {
  for (const f of assetFiles) copy(f, path.join(out, 'assets', path.relative(assetsDir, f)));
} else {
  // One scrambled pak, written file by file so a large game never sits in memory at once.
  const { pakHeader, pakSeed, scramble } = await import(new URL('../dist/engine/src/index.js', import.meta.url).href);
  const entries = assetFiles.map(f => ({ file: f, path: path.relative(assetsDir, f).split(path.sep).join('/'), size: fs.statSync(f).size }));
  const { header, offsets } = pakHeader(entries, key);
  const fd = fs.openSync(path.join(out, 'assets.pak'), 'w');
  fs.writeSync(fd, header);
  const seed = pakSeed(key);
  for (const e of entries) {
    const data = new Uint8Array(fs.readFileSync(e.file));
    fs.writeSync(fd, scramble(data, offsets.get(e.path), seed));
  }
  fs.closeSync(fd);
  for (const f of ['main.cjs', 'preload.cjs', 'save-files.cjs']) copy(path.join(root, 'tools/desktop', f), path.join(out, f));
  fs.writeFileSync(path.join(out, 'config.json'), JSON.stringify({ key, title: String(project.game.title ?? 'Untitled') }));
  const slug = String(project.game.id ?? project.game.title ?? 'game').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'game';
  fs.writeFileSync(path.join(out, 'package.json'), JSON.stringify({
    name: slug, version: '1.0.0', private: true, type: 'module', main: 'main.cjs', description: String(project.game.title ?? 'Untitled'),
    scripts: { start: 'electron .', dist: 'electron-builder' },
    devDependencies: { electron: ELECTRON_VERSION,'electron-builder': '^25.0.0' },
    build: { appId: `game.${slug}`, productName: String(project.game.title ?? 'Untitled'), files: ['**/*'], win: { target: 'nsis' }, linux: { target: 'AppImage' }, mac: { target: 'dmg' } },
  }, null, 2));
}

const { gameText: _editorOnly, ...data } = project;
fs.writeFileSync(path.join(out, 'project.json'), JSON.stringify(data));

const title = String(project.game.title ?? 'Untitled').replace(/[<&]/g, c => (c === '<' ? '&lt;' : '&amp;'));
let html = fs.readFileSync(path.join(root, 'preview/index.html'), 'utf8')
  .replace('<html lang="en">', '<html lang="en" data-mode="game">')
  .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`);
if (!html.includes('data-mode="game"')) { console.error('preview/index.html has no <html lang="en"> to mark as the game.'); process.exit(1); }
fs.writeFileSync(path.join(out, 'index.html'), html);

// 4. Report.
const files = listFiles(out);
const size = files.reduce((n, f) => n + fs.statSync(f).size, 0);
console.log(`Exported "${project.game.title ?? 'Untitled'}" to ${out}: ${files.length} files, ${(size / 1048576).toFixed(1)} MB`);
if (desktop) {
  const rel = path.relative(projectDir, out);
  console.log(`Desktop app folder. Try it: cd ${rel} && npm install && npm start`);
  console.log('Installer (for the platform you are on): npm run dist   (results in dist/ inside that folder)');
} else {
  console.log(`Open it through a web server (browsers block modules from file://): upload it, or run "npx serve ${path.relative(projectDir, out)}" in the project.`);
}
