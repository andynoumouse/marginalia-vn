/**
 * Where a file dropped on the editor's Assets panel goes. `folder` is the asset folder it was dropped on ('music', 'bg', ...),
 * absent when it landed on the panel itself. Images, sounds and fonts go to `assets/<folder>/`; a PSD goes to `masters/<folder>/`
 * (only bg, char and ui have a converter). Without a folder the file type picks one: images -> bg, sounds -> music, fonts -> fonts, movies -> movie.
 * A folder of the engine's own takes its kind of file only (bg: images, music: sounds, ...). Returns a project-relative path, or why the file is refused.
 */

import { AUDIO_EXTS as AUDIO, FONT_EXTS as FONT, IMAGE_EXTS as IMAGE, MOVIE_EXTS as MOVIE } from './asset-kinds.js';

const MASTER_FOLDERS = ['bg', 'char', 'ui'];
// What the engine's own folders take; a folder of the author's own (cg/, map/) takes any supported type.
const TAKES: Record<string, { exts: string[]; what: string }> = {
  bg: { exts: IMAGE, what: 'images' }, ui: { exts: IMAGE, what: 'images' }, transitions: { exts: IMAGE, what: 'images' },
  music: { exts: AUDIO, what: 'sounds' }, sound: { exts: AUDIO, what: 'sounds' }, voice: { exts: AUDIO, what: 'sounds' },
  fonts: { exts: FONT, what: 'fonts' }, movie: { exts: MOVIE, what: 'movies' },
};

export type DropPlan = { dest: string } | { error: string };

export function planDrop(fileName: string, folder = ''): DropPlan {
  const base = fileName.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  const ext = dot < 0 ? '' : base.slice(dot + 1).toLowerCase();
  const stem = base.slice(0, Math.max(dot, 0)).replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '');
  if (!stem) return { error: `${base || 'file'}: no usable name` };
  const name = `${stem}.${ext}`;
  if (folder && (!/^[\w\-]+(\/[\w\-]+)*$/.test(folder) || folder.split('/').includes('..'))) return { error: `${name}: invalid folder ${folder}` };
  if (ext === 'psd') {
    if (!MASTER_FOLDERS.includes(folder)) return { error: `${name}: drop a PSD on the bg, char or ui folder` };
    return { dest: `masters/${folder}/${name}` };
  }
  const fallback = IMAGE.includes(ext) ? 'bg' : AUDIO.includes(ext) ? 'music' : FONT.includes(ext) ? 'fonts' : MOVIE.includes(ext) ? 'movie' : '';
  if (!fallback) return { error: `${name}: unsupported file type (images ${IMAGE.join(', ')}; sounds ${AUDIO.join(', ')}; fonts ${FONT.join(', ')}; movies ${MOVIE.join(', ')})` };
  const [top, ...inside] = folder.split('/');
  if (top === 'char' && !inside.length) return { error: `${name}: char/ holds a folder per character: drop it on a character's folder (char/<name>), or drop a PSD on char` };
  const takes = TAKES[top];
  if (takes && !takes.exts.includes(ext)) return { error: `${name}: ${top}/ takes ${takes.what} (${takes.exts.join(', ')})` };
  return { dest: `assets/${folder || fallback}/${name}` };
}

/**
 * What tools/psd-convert.mjs makes from a master (`bg/park.psd`, relative to masters/), relative to assets/: `bg/park.png`,
 * `ui/frame.png`, or a character's `char/mina/sprite.json`. Null for anything the converter skips.
 */
export function masterOutput(master: string): string | null {
  const m = /^(bg|char|ui)\/([^/]+)\.psd$/i.exec(master);
  if (!m) return null;
  return m[1] === 'char' ? `char/${m[2]}/sprite.json` : `${m[1]}/${m[2]}.png`;
}

/** Each master's output, if it exists yet: the files panel marks converted art and lists the masters still waiting. */
export function matchMasters(masters: string[], assets: string[]): { master: string; output: string | null }[] {
  const have = new Set(assets);
  return masters.map(master => {
    const out = masterOutput(master);
    return { master, output: out && have.has(out) ? out : null };
  });
}
