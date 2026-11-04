// Web export: a self-contained static folder that plays the game (no dev server, editor or dev bar).
//   vn export [--out build/web] [--no-build]       (--out is relative to the project folder)
//   vn export --check                              only run the pre-build checks and print the report (writes nothing)
//   vn export --strict                             refuse to export while the checks have warnings, not just errors
//   vn export --no-playtest                        skip the playtest bot's check for this run
//   vn export --locales fi,ja --voice ja          ship only these translations / voice languages (default: all; the source name
//                                                  stands for the default takes in --voice; the languages left out are not checked)
// Per-check levels ("error", "warning", "info" or "off") go in game.json: { "build": { "checks": { "voice-missing": "off" } } }.
// Upload the folder to any static host, or zip it for itch.io ("HTML" project, index.html at the root).
// Everything uses relative URLs, so the game also works from a subfolder.
//
//   vn export --desktop [--out build/desktop]
// Writes an Electron app folder instead: the same game, but assets/ is packed and scrambled into assets.pak
// (engine/src/pak.ts) and served by tools/desktop/main.cjs, so players don't browse or edit the art and audio.
// The folder is an npm project: `npm install && npm start` downloads Electron, `npm run dist` makes an installer.
//
//   vn export --desktop --portable [--out build/portable]
// The same app ready to run, with no npm: the Electron runtime the export runs under (Marginalia Studio's own, so only from
// inside the Studio) is copied to <out>/<title>-<platform>-<arch>/ with the exe named after the game, the game goes into its
// resources/app, and the folder is zipped next to it.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildPlan } from './build-plan.mjs';
import { checkEngineVersion, engineRoot as root, engineVersion, projectRoot } from './paths.mjs';
import { assetIndex, listFiles } from './project-data.mjs';
import { runBuildChecks } from './build-checks.mjs';
import { checkVoiceFiles } from './voice-check.mjs';
import { zipFolder } from './zip-folder.mjs';

// The desktop app folder installs its own copy: the engine repo does not depend on Electron. 33's installer unzips only one file
// under Node 24; 45 fetches the binary on first run with a working unzip.
const ELECTRON_VERSION = '^45.2.1';
const ELECTRON_BUILDER_VERSION = '^26.0.0';
const projectDir = projectRoot();
checkEngineVersion(projectDir);
const args = process.argv.slice(2);
const portable = args.includes('--portable');
const desktop = args.includes('--desktop') || portable;
const checkOnly = args.includes('--check');
const strict = args.includes('--strict');
// --locales fi,ja ships only those translations, --voice en,ja only those voice languages (the source language's name stands for the
// default takes); an empty value ships none. Left out, everything ships. The languages left out are not checked either.
const list = flag => { const i = args.indexOf(flag); return i < 0 ? undefined : (args[i + 1] ?? '').split(',').map(s => s.trim()).filter(Boolean); };
const include = { text: list('--locales'), voice: list('--voice') };
const outArg = args.indexOf('--out');
const out = path.resolve(projectDir, outArg >= 0 ? args[outArg + 1] : path.join('build', portable ? 'portable' : desktop ? 'desktop' : 'web'));
// The portable app carries the runtime this export runs under: the Studio starts its tasks with its own exe as node
// (ELECTRON_RUN_AS_NODE). Plain node has no runtime to copy.
const runtimeDir = path.dirname(process.execPath);
if (portable && !checkOnly) {
  if (!process.versions.electron) {
    console.error('--portable copies the Electron runtime of Marginalia Studio: run it from the Studio\'s Build dialog. From the command line, --desktop writes an npm folder instead.');
    process.exit(1);
  }
  if (process.platform === 'darwin') { console.error('The portable app is built for Windows and Linux only for now (macOS needs an .app bundle).'); process.exit(1); }
}
const run = (script, extra = []) =>
  spawnSync(process.execPath, [script, ...extra], { cwd: root, stdio: 'inherit', env: { ...process.env, VN_PROJECT: projectDir } }).status === 0;

// 1. Build the code and convert changed art.
// Without TypeScript (a packaged engine) the dist/ that is there is exported.
const build = buildPlan(root, { noBuild: args.includes('--no-build') });
if (build.mode === 'missing') { console.error(`${build.message} Nothing exported.`); process.exit(1); }
if (build.note) console.log(build.note);
if (build.mode === 'build' && !run(build.tsc, ['-p', '.'])) { console.error('TypeScript build failed; nothing exported.'); process.exit(1); }
if (!checkOnly && !run(path.join(root, 'tools', 'psd-convert.mjs'))) console.warn('Some art failed to convert (see above); exporting the rest.');

// 2. The pre-build checks (engine/src/build-checks.ts): errors always refuse, warnings only with --strict.
const { project, program, report, languages } = runBuildChecks(projectDir, undefined, include, { playtest: !args.includes('--no-playtest') });
for (const [flag, asked, known] of [['--locales', include.text, languages.text], ['--voice', include.voice, [...new Set([...languages.voice, languages.source])]]]) {
  const unknown = (asked ?? []).filter(l => !known.includes(l));
  if (unknown.length) console.warn(`warning ${flag}: no such language: ${unknown.join(', ')} (known: ${known.join(', ') || 'none'})`);
}
const { formatBuildReport } = await import(new URL('../dist/engine/src/index.js', import.meta.url).href);
for (const line of formatBuildReport(report)) console[line.startsWith('error') ? 'error' : line.startsWith('warning') ? 'warn' : 'log'](line);
if (report.errors) { console.error(`${report.errors} error(s); nothing exported.`); process.exit(1); }
if (strict && report.warnings) { console.error(`${report.warnings} warning(s) and --strict is on; nothing exported.`); process.exit(1); }
if (checkOnly) process.exit(0);
const voice = checkVoiceFiles(projectDir, program, project.locales); // adopts new takes into voice.lock.json
if (voice.outdated.length) console.warn('Reworded lines with recordings: re-record them, or accept the ones where the rewording changes nothing: "vn voice accept <name>"');

// 3. Write the folder from scratch (refuse anything that is not clearly an export target).
if (out === projectDir || !out.startsWith(projectDir + path.sep) || ['assets', 'script', 'masters', 'locale'].includes(path.relative(projectDir, out).split(path.sep)[0])) {
  console.error(`Refusing to export into ${out}: pick a folder such as build/web.`);
  process.exit(1);
}
fs.rmSync(out, { recursive: true, force: true });
// The game's files: the export folder itself, or the portable app's resources/app.
const { safeFileName, portableExeName, portableFolderName, keepRuntimeFile } = await import(new URL('../dist/engine/src/index.js', import.meta.url).href);
const appName = safeFileName(String(project.game.title ?? ''), 'Game');
const appFolder = path.join(out, portableFolderName(appName, process.platform, process.arch));
const game = portable ? path.join(appFolder, 'resources', 'app') : out;
const copy = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); };

// Compiled modules the game needs: the engine and the preview shell (not the editor), from their sources (so a stale .js of a
// deleted source stays home). A packaged engine (Marginalia Studio) ships no sources: there dist/ is the list.
for (const [srcDir, distDir] of [['engine/src', 'dist/engine/src'], ['preview', 'dist/preview']]) {
  const sources = listFiles(path.join(root, srcDir), '.ts');
  const modules = sources.length ? sources.map(f => path.join(root, distDir, `${path.basename(f, '.ts')}.js`)) : listFiles(path.join(root, distDir), '.js');
  for (const js of modules) copy(js, path.join(game, distDir, path.basename(js)));
}
copy(path.join(root, 'node_modules/pixi.js/dist/pixi.min.mjs'), path.join(game, 'vendor/pixi/pixi.min.mjs'));
const assetsDir = path.join(projectDir, 'assets');
const { shipsAsset, sourceLanguage } = await import(new URL('../dist/engine/src/index.js', import.meta.url).href);
const source = sourceLanguage(project.game);
const assetFiles = listFiles(assetsDir).filter(f => shipsAsset(path.relative(assetsDir, f).split(path.sep).join('/'), include.voice, source));
const key = crypto.randomBytes(16).toString('hex');
// game.json `icon`: icon.png next to index.html (the web build's favicon, the desktop window's icon). The build checks have
// already said what is wrong with a missing or odd one; a file that is not a PNG at all is left out.
const { iconAsset, pngSize, packageVersion } = await import(new URL('../dist/engine/src/index.js', import.meta.url).href);
const iconSource = iconAsset(project.game) && path.join(assetsDir, iconAsset(project.game));
const icon = iconSource && fs.existsSync(iconSource) && pngSize(fs.readFileSync(iconSource)) ? iconSource : '';
if (icon) copy(icon, path.join(game, 'icon.png'));
if (!desktop) {
  for (const f of assetFiles) copy(f, path.join(game, 'assets', path.relative(assetsDir, f)));
} else {
  // The pak itself is written after the project data below, which goes into it too.
  for (const f of ['main.cjs', 'preload.cjs', 'save-files.cjs']) copy(path.join(root, 'tools/desktop', f), path.join(game, f));
  fs.writeFileSync(path.join(game, 'config.json'), JSON.stringify({ key, title: String(project.game.title ?? 'Untitled') }));
  const slug = String(project.game.id ?? project.game.title ?? 'game').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'game';
  fs.writeFileSync(path.join(game, 'package.json'), JSON.stringify({
    name: slug, version: packageVersion(project.game.version), private: true, type: 'module', main: 'main.cjs', description: String(project.game.title ?? 'Untitled'),
    scripts: { start: 'electron .', dist: 'electron-builder' },
    devDependencies: { electron: ELECTRON_VERSION, 'electron-builder': ELECTRON_BUILDER_VERSION },
    // The installer goes to release/: electron-builder's default output, dist/, holds the game's engine code and would be left
    // out of the packaged app.
    build: {
      appId: `game.${slug}`, productName: String(project.game.title ?? 'Untitled'), directories: { output: 'release' }, files: ['**/*'],
      win: { target: 'nsis', ...(icon && { icon: 'icon.png' }) }, linux: { target: 'AppImage', ...(icon && { icon: 'icon.png' }) },
      mac: { target: 'dmg', ...(icon && { icon: 'icon.png' }) },
    },
  }, null, 2));
}

// The game plays the compiled program, not the .vn text. Preloads are baked in from the asset set that ships.
const { attachPreloads, packProgram, scriptsVersion } = await import(new URL('../dist/engine/src/index.js', import.meta.url).href);
project.assets = project.assets.filter(a => shipsAsset(a.file, include.voice, source)); // the shipped list, so no preload points at a dropped take
// `v` is the ?v= cache-buster the loader appends. The dev server stamps it with the mtime (to reload edited files); an export
// uses the content instead, so a rebuild or a touched file keeps its URL and only changed art busts a browser's cache.
for (const a of project.assets) a.v = parseInt(crypto.createHash('sha1').update(fs.readFileSync(path.join(assetsDir, a.file))).digest('hex').slice(0, 12), 16);
const gallery = Array.isArray(project.game.gallery) ? project.game.gallery.map(g => g?.image).filter(n => typeof n === 'string') : [];
attachPreloads(program, assetIndex(project), { gallery });
const { gameText: _editorOnly, scripts, scriptDirs: _dirs, ...data } = project;
data.program = packProgram(program, scriptsVersion(scripts));
data.engine = engineVersion; // for the error screen's report
// Each translation is its own locale/<lang>.json, fetched when the player picks that language. The source language needs no table
// (the program holds its text), so its locale/<source>.json export stays home.
const tables = Object.entries(data.locales ?? {}).filter(([l]) => l !== source && (!include.text || include.text.includes(l)));
data.locales = {};
data.localeFiles = tables.map(([l]) => l);
// The program and the translations hold all the story text. The web export ships them as plain files; the desktop one packs them
// into the pak under `.vn/` (engine/src/pak.ts, tools/desktop/main.cjs), so the text is not lying around readable either.
const texts = [['project.json', JSON.stringify(data)], ...tables.map(([lang, table]) => [`locale/${lang}.json`, JSON.stringify(table)])];
if (!desktop) {
  for (const [rel, text] of texts) { fs.mkdirSync(path.dirname(path.join(game, rel)), { recursive: true }); fs.writeFileSync(path.join(game, rel), text); }
} else {
  // One scrambled pak, written file by file so a large game never sits in memory at once.
  const { pakHeader, pakSeed, scramble, PAK_TEXT_DIR } = await import(new URL('../dist/engine/src/index.js', import.meta.url).href);
  const entries = [
    ...assetFiles.map(f => ({ file: f, path: path.relative(assetsDir, f).split(path.sep).join('/'), size: fs.statSync(f).size })),
    ...texts.map(([rel, text]) => { const data = Buffer.from(text); return { data, path: `${PAK_TEXT_DIR}/${rel}`, size: data.length }; }),
  ];
  const { header, offsets } = pakHeader(entries, key);
  const fd = fs.openSync(path.join(game, 'assets.pak'), 'w');
  fs.writeSync(fd, header);
  const seed = pakSeed(key);
  for (const e of entries) {
    const data = new Uint8Array(e.data ?? fs.readFileSync(e.file));
    fs.writeSync(fd, scramble(data, offsets.get(e.path), seed));
  }
  fs.closeSync(fd);
}

const title = String(project.game.title ?? 'Untitled').replace(/[<&]/g, c => (c === '<' ? '&lt;' : '&amp;'));
let html = fs.readFileSync(path.join(root, 'preview/index.html'), 'utf8')
  .replace('<html lang="en">', '<html lang="en" data-mode="game">')
  .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>${icon ? '\n<link rel="icon" type="image/png" href="icon.png">' : ''}`);
if (!html.includes('data-mode="game"')) { console.error('preview/index.html has no <html lang="en"> to mark as the game.'); process.exit(1); }
fs.writeFileSync(path.join(game, 'index.html'), html);

// 4. The portable app: the runtime around the game, the exe named after it, and a zip.
const mb = n => `${(n / 1048576).toFixed(1)} MB`;
let exePath = '';
if (portable) {
  fs.cpSync(runtimeDir, appFolder, { recursive: true, filter: src => keepRuntimeFile(path.relative(runtimeDir, src).split(path.sep).join('/')) });
  exePath = path.join(appFolder, portableExeName(appName, process.platform));
  fs.renameSync(path.join(appFolder, path.basename(process.execPath)), exePath);
  // On Windows the exe gets the game's icon and version info instead of Electron's (tools/exe-info.mjs).
  if (process.platform === 'win32') {
    const { patchExe } = await import('./exe-info.mjs');
    const { icoFromPng, windowsVersion } = await import(new URL('../dist/engine/src/index.js', import.meta.url).href);
    patchExe(exePath, {
      ico: icon ? icoFromPng(fs.readFileSync(icon)) : undefined, version: windowsVersion(project.game.version),
      title: String(project.game.title ?? 'Untitled'), originalFilename: path.basename(exePath),
    });
  }
}

// 5. Report.
const files = listFiles(portable ? appFolder : out);
const size = files.reduce((n, f) => n + fs.statSync(f).size, 0);
console.log(`Exported "${project.game.title ?? 'Untitled'}" to ${portable ? appFolder : out}: ${files.length} files, ${mb(size)}`);
if (portable) {
  console.log(`App: ${path.relative(projectDir, exePath)}`);
  const failed = zipFolder(out, path.basename(appFolder), { stdio: 'ignore' });
  if (failed) { console.error(failed); process.exit(1); }
  console.log(`Zip: ${path.relative(projectDir, appFolder)}.zip (${mb(fs.statSync(`${appFolder}.zip`).size)}). Share the zip; players unzip it and run ${path.basename(exePath)}.`);
} else if (desktop) {
  const rel = path.relative(projectDir, out);
  console.log(`Desktop app folder. Try it: cd ${rel} && npm install && npm start`);
  console.log('Installer (for the platform you are on): npm run dist   (results in release/ inside that folder)');
} else {
  console.log(`Open it through a web server (browsers block modules from file://): upload it, or run "npx serve ${path.relative(projectDir, out)}" in the project.`);
}
