/**
 * Where a file dropped on the editor's Assets panel goes. `folder` is the asset folder it was dropped on ('music', 'bg', ...),
 * absent when it landed on the panel itself. Images, sounds and fonts go to `assets/<folder>/`; a PSD goes to `masters/<folder>/`
 * (only bg, char and ui have a converter). Without a folder the file type picks one: images -> bg, sounds -> music, fonts -> fonts.
 * Returns a project-relative path, or why the file is refused.
 */

const IMAGE = ['png', 'webp', 'jpg', 'jpeg', 'avif', 'svg'];
const AUDIO = ['ogg', 'mp3', 'wav', 'm4a', 'flac', 'opus'];
const FONT = ['woff2', 'woff', 'ttf', 'otf'];
const MASTER_FOLDERS = ['bg', 'char', 'ui'];

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
  const fallback = IMAGE.includes(ext) ? 'bg' : AUDIO.includes(ext) ? 'music' : FONT.includes(ext) ? 'fonts' : '';
  if (!fallback) return { error: `${name}: unsupported file type` };
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
