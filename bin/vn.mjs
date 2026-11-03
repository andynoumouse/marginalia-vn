#!/usr/bin/env node
// The vn command: runs the engine's tools on a game project (the current folder, or --project <dir>).
//   vn dev [--no-build] [--no-art]   editor + live preview, http://localhost:5173 (PORT to change)
//   vn export [--out <dir>]          static web build (default build/web in the project)
//   vn export --desktop [--out <dir>] Electron app folder with packed assets (default build/desktop)
//   vn export --desktop --portable    the app ready to run, zipped (default build/portable; only inside Marginalia Studio)
//   vn art [--force] [--watch]       convert changed PSDs in masters/ to assets/
//   vn ids                           add localization ids to lines that lack one
//   vn strings                       write locale/<source language>.json, report untranslated lines
//   vn voice [accept <name>...|all]  report voice recordings made for lines that were reworded since
//   vn playtest [--strict] [--json]  play every route; report unreachable lines, endings, unused assets and variables
//   vn stats [--json] [--wpm <n>]    words, lines and reading time per script, label and character
//   vn init <folder> [--title "My Game"] [--stage 1920x1080]   start a new game project that uses this engine
//   vn version
// Inside the engine repo (no project in the current folder) the commands work on games/sample/.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { checkEngineVersion, engineRoot, engineVersion, findProject } from '../tools/paths.mjs';

const TOOLS = {
  dev: ['preview/dev-server.mjs'],
  export: ['tools/export-web.mjs'],
  art: ['tools/psd-convert.mjs'],
  ids: ['tools/vn-tool.mjs', 'ids'],
  strings: ['tools/vn-tool.mjs', 'strings'],
  voice: ['tools/vn-tool.mjs', 'voice'],
  playtest: ['tools/playtest.mjs'],
  stats: ['tools/stats.mjs'],
};

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv.splice(i, 2)[1] : undefined; };

function usage() {
  // The header comment of this file is the help text.
  const lines = fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1);
  const header = lines.slice(0, lines.findIndex(l => !l.startsWith('//')));
  console.log(header.map(l => l.slice(3)).join('\n'));
}

if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  usage();
} else if (cmd === 'version' || cmd === '--version') {
  console.log(`marginalia-vn ${engineVersion} (${engineRoot})`);
} else if (cmd === 'init') {
  const title = flag('--title'), stage = flag('--stage');
  await init(argv[1], title, stage);
} else if (TOOLS[cmd]) {
  const projectArg = flag('--project');
  const project = findProject(projectArg ?? process.cwd());
  if (!project) {
    console.error(`No game project in ${path.resolve(projectArg ?? process.cwd())} (no game.json or script/). Start one with: vn init <folder>`);
    process.exit(1);
  }
  checkEngineVersion(project);
  const [script, ...extra] = TOOLS[cmd];
  const r = spawnSync(process.execPath, [path.join(engineRoot, script), ...extra, ...argv.slice(1)], {
    cwd: engineRoot, stdio: 'inherit', env: { ...process.env, VN_PROJECT: project },
  });
  process.exit(r.status ?? 1);
} else {
  console.error(`Unknown command "${cmd}".\n`);
  usage();
  process.exit(1);
}

// ---- vn init ----
async function init(dir, title, stage) {
  if (!dir) { console.error('Use: vn init <folder> [--title "My Game"] [--stage 1920x1080]'); process.exit(1); }
  const target = path.resolve(dir);
  if (fs.existsSync(target) && fs.readdirSync(target).length) {
    console.error(`${target} is not empty; vn init only creates new projects.`);
    process.exit(1);
  }
  const { newProjectFiles, titleFromFolder } = await import(pathToFileURL(path.join(engineRoot, 'dist', 'engine', 'src', 'new-project.js')).href);
  const name = title ?? titleFromFolder(path.basename(target));
  const [width, height] = (stage ?? '').split('x').map(Number);
  let files;
  try {
    files = newProjectFiles({
      title: name, engineVersion, kind: 'npm', stage: stage ? { width, height } : undefined,
      engineRef: path.relative(target, engineRoot).split(path.sep).join('/') || '.', engineRoot,
    });
  } catch (e) { console.error(`${e.message} (--stage 1080x1920, for example).`); process.exit(1); }
  for (const [rel, text] of Object.entries(files)) {
    const file = path.join(target, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  console.log(`Created ${name} in ${target}`);
  console.log(`Next: cd "${target}" && npm install && npm run dev`);
}
