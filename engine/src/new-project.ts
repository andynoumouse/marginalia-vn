// The file set of a new game project, shared by `vn init` and Marginalia Studio's New project. Pure: the caller writes it.
// An npm project links the engine as a `file:` dependency and runs it through `npm run ...`; a Studio project has no
// package.json and gets its engine from the app.

import { DEFAULT_STAGE, stageProblem, type StageSize } from './stage.js';

export type ProjectKind = 'npm' | 'studio';

export interface NewProjectOptions {
  /** The game's title; the id and package name are made from it. */
  title: string;
  /** The engine version ("0.2.1"); game.json asks for its major.minor. */
  engineVersion: string;
  kind: ProjectKind;
  /** Stage size, when not the default 1920x1080. */
  stage?: StageSize;
  /** npm only: the engine folder relative to the project ("../marginalia-vn"), for the file: dependency. */
  engineRef?: string;
  /** npm only: the engine folder as shown in the README. */
  engineRoot?: string;
}

/** A project id from a title: lowercase, dashes, "game" when nothing is left. */
export function projectSlug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'game';
}

/** A title from a folder name: "my_game" and "MyGame" both become "My Game"-like words. */
export function titleFromFolder(folder: string): string {
  return folder.replace(/[-_]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
}

/** Relative path → file text for a new project. Throws on an unusable stage size (the message says why). */
export function newProjectFiles(opts: NewProjectOptions): Record<string, string> {
  const { title, kind, engineVersion } = opts;
  const problem = stageProblem(opts.stage);
  if (problem) throw new Error(problem);
  const slug = projectSlug(title);
  const [major, minor] = engineVersion.split('.');
  const stage = opts.stage && (opts.stage.width !== DEFAULT_STAGE.width || opts.stage.height !== DEFAULT_STAGE.height)
    ? { stage: { width: opts.stage.width, height: opts.stage.height } } : {};
  const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';

  const files: Record<string, string> = {};
  if (kind === 'npm') {
    files['package.json'] = json({
      name: slug,
      version: '0.1.0',
      private: true,
      description: `${title} (visual novel)`,
      scripts: { dev: 'vn dev', export: 'vn export', art: 'vn art', ids: 'vn ids', strings: 'vn strings' },
      devDependencies: { 'marginalia-vn': `file:${opts.engineRef ?? '.'}` },
    });
  }
  files['game.json'] = json({
    id: slug,
    title,
    engine: `${major}.${minor}`,
    ...stage,
    titleScreen: { background: 'bg_title', music: '', buttons: ['new_game', 'continue', 'load', 'gallery', 'options'] },
    gallery: [],
    labels: {},
    theme: { accent: '#5fd1c3' },
  });
  files['script/start.vn'] = [
    '# start.vn - the story starts at "label start". Lines starting with # are comments.',
    kind === 'npm'
      ? '# Give dialogue lines localization ids with "npm run ids" (or the editor\'s Add Localization IDs).'
      : '# Give dialogue lines localization ids with the editor\'s Add Localization IDs.',
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
  ].join('\n');
  files['locale/.gitkeep'] = '';
  files['assets/.gitkeep'] = '';
  files['masters/bg/.gitkeep'] = '';
  files['masters/char/.gitkeep'] = '';
  files['masters/ui/.gitkeep'] = '';
  files['.gitignore'] = kind === 'npm' ? 'node_modules/\nbuild/\n' : 'build/\n';
  files['.gitattributes'] = [
    '# Keep LF everywhere (scripts, sources) regardless of core.autocrlf',
    '* text=auto eol=lf',
    '# Photoshop masters are large: keep them in Git LFS',
    'masters/** filter=lfs diff=lfs merge=lfs -text',
    '',
  ].join('\n');
  const content = [
    'Content: script/ (scenes), game.json (title screen, menus, theme, gallery), locale/ (translations),',
    'masters/ (layered PSDs: bg/, char/, ui/), assets/ (game-ready art and audio: bg/, char/, music/, sound/, fonts/).',
  ];
  files['README.md'] = (kind === 'npm' ? [
    `# ${title}`,
    '',
    `A visual novel made with Marginalia VN Engine (${opts.engineRoot ?? 'marginalia-vn'}).`,
    '',
    '```',
    'npm install        # once: links the engine (file: dependency, so engine updates apply immediately)',
    'npm run dev        # editor + live preview: http://localhost:5173/editor/',
    'npm run export     # web build in build/web',
    'npm run art        # convert masters/*.psd to assets/ (npm run dev does this on save)',
    'npm run ids        # add localization ids to new lines',
    'npm run strings    # write locale/<source language>.json (en.json by default)',
    '```',
    '',
    ...content,
    'See the engine README for the script language and the art pipeline.',
    '',
  ] : [
    `# ${title}`,
    '',
    'A visual novel made with Marginalia Studio. Open this folder from the Studio\'s projects screen to edit and preview it;',
    'Build there makes the web or desktop version in build/. PSDs saved in masters/ are converted to assets/ while it is open.',
    '',
    ...content,
    'See the Studio\'s Help for the script language and the art pipeline.',
    '',
  ]).join('\n');
  return files;
}
