#!/usr/bin/env node
// The vn command: runs the engine's tools on a game project (the current folder, or --project <dir>).
//   vn dev [--no-build] [--no-art]   editor + live preview, http://localhost:5173 (PORT to change)
//   vn export [--out <dir>]          static web build (default build/web in the project)
//   vn export --desktop [--out <dir>] Electron app folder with packed assets (default build/desktop)
//   vn art [--force] [--watch]       convert changed PSDs in masters/ to assets/
//   vn ids                           add localization ids to lines that lack one
//   vn strings                       write locale/en.json, report untranslated lines
//   vn playtest [--strict] [--json]  play every route; report unreachable lines, endings, unused assets and variables
//   vn init <folder> [--title "My Game"]   start a new game project that uses this engine
//   vn version
// Inside the engine repo (no project in the current folder) the commands work on sample/.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkEngineVersion, engineRoot, engineVersion, findProject } from '../tools/paths.mjs';

const TOOLS = {
  dev: ['preview/dev-server.mjs'],
  export: ['tools/export-web.mjs'],
  art: ['tools/psd-convert.mjs'],
  ids: ['tools/vn-tool.mjs', 'ids'],
  strings: ['tools/vn-tool.mjs', 'strings'],
  playtest: ['tools/playtest.mjs'],
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
  const title = flag('--title');
  init(argv[1], title);
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
function init(dir, title) {
  if (!dir) { console.error('Use: vn init <folder> [--title "My Game"]'); process.exit(1); }
  const target = path.resolve(dir);
  if (fs.existsSync(target) && fs.readdirSync(target).length) {
    console.error(`${target} is not empty; vn init only creates new projects.`);
    process.exit(1);
  }
  const name = title ?? path.basename(target).replace(/[-_]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'game';
  const engineRef = path.relative(target, engineRoot).split(path.sep).join('/') || '.';
  const [major, minor] = engineVersion.split('.');

  const files = {
    'package.json': JSON.stringify({
      name: slug,
      version: '0.1.0',
      private: true,
      description: `${name} (visual novel)`,
      scripts: { dev: 'vn dev', export: 'vn export', art: 'vn art', ids: 'vn ids', strings: 'vn strings' },
      devDependencies: { 'marginalia-vn': `file:${engineRef}` },
    }, null, 2) + '\n',
    'game.json': JSON.stringify({
      id: slug,
      title: name,
      engine: `${major}.${minor}`,
      titleScreen: { background: 'bg_title', music: '', buttons: ['new_game', 'continue', 'load', 'gallery', 'options'] },
      gallery: [],
      labels: {},
      theme: { accent: '#5fd1c3' },
    }, null, 2) + '\n',
    'script/start.vn': [
      '# start.vn - the story starts at "label start". Lines starting with # are comments.',
      '# Give dialogue lines localization ids with "npm run ids" (or the editor\'s Add Localization IDs).',
      '',
      'define narrator "" text=#d8d2c0',
      'define hero "Hero" color=#7cc4ff blip=mid',
      '',
      'label start:',
      '  scene bg_title fade 0.5',
      '  "The story begins."',
      '  hero: Hello! Edit script/start.vn to continue.',
      '  end',
      '',
    ].join('\n'),
    'locale/.gitkeep': '',
    'assets/.gitkeep': '',
    'masters/bg/.gitkeep': '',
    'masters/char/.gitkeep': '',
    'masters/ui/.gitkeep': '',
    '.gitignore': 'node_modules/\nbuild/\n',
    '.gitattributes': [
      '# Keep LF everywhere (scripts, sources) regardless of core.autocrlf',
      '* text=auto eol=lf',
      '# Photoshop masters are large: keep them in Git LFS',
      'masters/** filter=lfs diff=lfs merge=lfs -text',
      '',
    ].join('\n'),
    'README.md': [
      `# ${name}`,
      '',
      `A visual novel made with Marginalia VN Engine (${engineRoot}).`,
      '',
      '```',
      'npm install        # once: links the engine (file: dependency, so engine updates apply immediately)',
      'npm run dev        # editor + live preview: http://localhost:5173/editor/',
      'npm run export     # web build in build/web',
      'npm run art        # convert masters/*.psd to assets/ (npm run dev does this on save)',
      'npm run ids        # add localization ids to new lines',
      'npm run strings    # write locale/en.json',
      '```',
      '',
      'Content: script/ (scenes), game.json (title screen, menus, theme, gallery), locale/ (translations),',
      'masters/ (layered PSDs: bg/, char/, ui/), assets/ (game-ready art and audio: bg/, char/, music/, sound/, fonts/).',
      'See the engine README for the script language and the art pipeline.',
      '',
    ].join('\n'),
  };
  for (const [rel, text] of Object.entries(files)) {
    const file = path.join(target, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  console.log(`Created ${name} in ${target}`);
  console.log(`Next: cd "${target}" && npm install && npm run dev`);
}
