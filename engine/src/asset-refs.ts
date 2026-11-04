/**
 * Where the scripts, game.json and theme files name asset files, so renaming or moving one in the Files panel can rewrite them.
 * Pure text in, edits out, like the label rename (refactor.ts). Each mention is resolved to an asset key (the path under
 * assets/ without extension, as in assets.ts); a move maps the keys it touches and writes each mention back in the form
 * its command takes. Character poses (`show alice smile`) are not followed: a pose names a layer as well as a file.
 */

import { jsonStrings, maskStrings, type ProjectFile, type TextEdit } from './refactor.js';
import { movedPath } from './file-ops.js';

/**
 * How a mention names its file: `bg` a background name (`assets/bg/<name>`, or a path from assets/), `image` a path
 * under assets/ with optional extension, `music`/`sound`/`ui` a bare name in that folder.
 */
export type AssetRefKind = 'bg' | 'image' | 'music' | 'sound' | 'movie' | 'ui';

/** A mention of an asset: 1-based line, 0-based column and length of the name as written, and the key it resolves to. */
export interface AssetRef { file: string; line: number; col: number; length: number; text: string; kind: AssetRefKind; key: string }

const IMAGE = /\.(png|webp|jpe?g|avif)$/i;
const AUDIO = /\.(ogg|mp3|wav|m4a|flac|opus)$/i;
const MOVIE = /\.(webm|mp4|m4v|ogv)$/i;
const NAME = String.raw`[\w\-.\/]+(?=\s|$)`;
const RE_SCENE = new RegExp(String.raw`^(\s*scene\s+)(${NAME})`);
const RE_IMAGE_SHOW = new RegExp(String.raw`^(\s*image\s+show\s+[\w\-]+\s+)(${NAME})`);
const RE_MUSIC = new RegExp(String.raw`^(\s*music\s+play\s+)(${NAME})`);
const RE_SOUND = new RegExp(String.raw`^(\s*sound\s+(?:play|loop|stop)\s+)(${NAME})`);
const RE_MOVIE = new RegExp(String.raw`^(\s*movie\s+play\s+)(${NAME})`);
// A `define` option naming a file: `image=` of an item (bare or quoted), `blip=` of a character (a sound sample or a voice).
const RE_OPTION = /(?<![\w])(image|blip)=/g;
// Screen elements that take a file in quotes: `image "..."`, `mask "..."`, `hover "..."` and `hover sound "..."`.
const RE_QUOTED = /(?<![\w=])(image|mask|hover)\s+(sound\s+)?"/g;

const stemOf = (name: string, ext: RegExp) => name.replace(ext, '');

/** The key a mention names; `assetFiles` (paths under assets/) settles whether a background is in bg/ or at the root. */
function keyOf(kind: AssetRefKind, text: string, assetFiles?: Set<string>): string {
  switch (kind) {
    case 'bg': return assetFiles && !assetFiles.has(`bg/${text}`) && assetFiles.has(text) ? text : `bg/${text}`;
    case 'image': return stemOf(text, IMAGE);
    default: return `${kind}/${text}`;
  }
}

function scriptRefs(file: string, text: string, assetFiles?: Set<string>): AssetRef[] {
  const refs: AssetRef[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const masked = maskStrings(raw);
    // Only the part before a trailing comment (ids like #ab12 and colors are not comments).
    const hash = masked.search(/#(?![0-9a-z]{4,}\b)/);
    const code = hash >= 0 ? masked.slice(0, hash) : masked;
    const at = (col: number, name: string, kind: AssetRefKind) => {
      if (!name || /[\[\\"]/.test(name)) return; // `[variables]` are filled in while playing
      refs.push({ file, line: i + 1, col, length: name.length, text: name, kind, key: keyOf(kind, name, assetFiles) });
    };
    const first = (re: RegExp, kind: AssetRefKind, skip?: string) => {
      const m = re.exec(code);
      if (m && m[2] !== skip) at(m[1].length, m[2], kind);
      return !!m;
    };
    if (first(RE_SCENE, 'bg') || first(RE_IMAGE_SHOW, 'image') || first(RE_MUSIC, 'music') || first(RE_SOUND, 'sound', 'fade') || first(RE_MOVIE, 'movie', 'noskip')) return;
    if (/^\s*define\s/.test(code)) {
      RE_OPTION.lastIndex = 0;
      for (let m = RE_OPTION.exec(code); m; m = RE_OPTION.exec(code)) {
        const start = m.index + m[0].length;
        const quoted = raw[start] === '"';
        const name = quoted ? raw.slice(start + 1, Math.max(raw.indexOf('"', start + 1), start + 1)) : /^[\w\-.\/]*/.exec(code.slice(start))![0];
        at(start + (quoted ? 1 : 0), name, m[1] === 'blip' ? 'sound' : 'image');
      }
      return;
    }
    RE_QUOTED.lastIndex = 0;
    for (let m = RE_QUOTED.exec(code); m; m = RE_QUOTED.exec(code)) {
      const start = m.index + m[0].length, end = raw.indexOf('"', start);
      if (end > start) at(start, raw.slice(start, end), m[2] ? 'sound' : 'image');
    }
  });
  return refs;
}

/** The kind of file a game.json value at `path` names, or null when it names none. */
function gameKind(path: (string | number)[]): AssetRefKind | null {
  const [a, b, c, d] = path, n = path.length;
  if (a === 'titleScreen' && n === 2) return b === 'background' ? 'bg' : b === 'music' ? 'music' : null;
  if (a === 'gallery' && n === 3 && c === 'image') return 'bg';
  if (a === 'splash' && typeof b === 'number' && (n === 2 || (n === 3 && c === 'image'))) return 'bg';
  if (a === 'musicRoom' && typeof b === 'number' && (n === 2 || (n === 3 && c === 'track'))) return 'music';
  if (a === 'achievements' && typeof b === 'number' && n === 3 && c === 'icon') return 'ui';
  if (a === 'achievementToast' && n === 2 && b === 'sound') return 'sound';
  if (a === 'blips' && ((n === 3 && c === 'sound') || (n === 4 && c === 'vowels'))) return 'sound';
  const box = (k: unknown) => k === 'textbox' || k === 'namebox' || k === 'choices';
  if (a === 'theme' && ((n === 3 && box(b) && c === 'image') || (n === 5 && b === 'skins' && box(d) && path[4] === 'image'))) return 'ui';
  return null;
}

/** The kind of file a value in a theme file (`themes/<name>.json`) names: the `image` of a frame, in the layered or the legacy keys. */
function themeFileKind(path: (string | number)[]): AssetRefKind | null {
  const last = path[path.length - 1], n = path.length;
  if (last !== 'image') return null;
  const box = (k: unknown) => k === 'textbox' || k === 'namebox' || k === 'choices' || k === 'choice';
  // textbox.image, components.textbox.image, skins.<s>.textbox.image, styles.<s>.textbox.image
  if (n === 2 && box(path[0])) return 'ui';
  if (n === 3 && path[0] === 'components' && box(path[1])) return 'ui';
  if (n === 4 && (path[0] === 'skins' || path[0] === 'styles') && box(path[2])) return 'ui';
  return null;
}

const isThemeFile = (name: string) => /(^|\/)themes\/[^/]+\.json$/.test(name);

function gameRefs(file: string, text: string, assetFiles?: Set<string>): AssetRef[] {
  return jsonStrings(text).flatMap(s => {
    const kind = isThemeFile(file) ? themeFileKind(s.path) : gameKind(s.path);
    if (!kind || !s.value || /[\\[]/.test(s.value)) return [];
    return [{ file, line: s.line, col: s.col, length: s.value.length, text: s.value, kind, key: keyOf(kind, s.value, assetFiles) }];
  });
}

/**
 * Every mention of an asset file in `.vn` scripts and game.json (other files are ignored). `assetFiles` are the paths
 * under assets/ (`bg/park.png`); without them a background name is taken to be in bg/.
 */
export function assetRefs(files: ProjectFile[], assetFiles?: string[]): AssetRef[] {
  const keys = assetFiles && new Set(assetFiles.map(f => stemOf(stemOf(stemOf(f, IMAGE), AUDIO), MOVIE)));
  return files.flatMap(f => f.name.endsWith('.vn') ? scriptRefs(f.name, f.text, keys)
    : f.name === 'game.json' || f.name.endsWith('/game.json') || isThemeFile(f.name) ? gameRefs(f.name, f.text, keys) : []);
}

/** How a mention of `kind` names the key `key`, or null when that kind cannot reach it (a track outside music/). */
function nameFor(kind: AssetRefKind, key: string, ext: string): string | null {
  switch (kind) {
    case 'bg': return key.startsWith('bg/') ? key.slice(3) : key;
    case 'image': return key + ext;
    default: {
      const parts = key.split('/');
      return parts.length === 2 && parts[0] === kind ? parts[1] : null;
    }
  }
}

export interface AssetRename {
  edits: TextEdit[];
  /** Mentions of what moved that cannot name its new place (`music play` only reaches files right in assets/music/). */
  stranded: AssetRef[];
}

/**
 * Edits that keep the scripts and game.json pointing at `from` after it is renamed or moved to `to` (project-relative
 * paths as in file-ops.ts, a folder when `isDir`). Paths outside assets/ give no edits.
 */
export function renameAssetRefs(files: ProjectFile[], from: string, to: string, isDir = false, assetFiles?: string[]): AssetRename {
  const out: AssetRename = { edits: [], stranded: [] };
  if (!from.startsWith('assets/') || !to.startsWith('assets/')) return out;
  const rel = (p: string) => p.slice('assets/'.length);
  const strip = (p: string) => isDir ? p : stemOf(stemOf(stemOf(p, IMAGE), AUDIO), MOVIE);
  const a = strip(rel(from)), b = strip(rel(to));
  if (a === b) return out;
  for (const r of assetRefs(files, assetFiles)) {
    // A folder takes what is under it, not the file of the same name beside it (cg/set/ and cg/set.png).
    const moved = isDir ? (r.key.startsWith(`${a}/`) ? movedPath(r.key, a, b) : null) : r.key === a ? b : null;
    if (moved === null) continue;
    const ext = r.kind === 'image' ? r.text.slice(stemOf(r.text, IMAGE).length) : '';
    const name = nameFor(r.kind, moved, ext);
    if (name === null) out.stranded.push(r);
    else if (name !== r.text) out.edits.push({ file: r.file, line: r.line, col: r.col, length: r.length, text: name });
  }
  return out;
}
