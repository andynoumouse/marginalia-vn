// Opening a character with no game project (the standalone animation studio, docs/design/animation-studio-parameters.md): from
// the files of a folder, find out what it holds and build what the studio and its stage page need, the manifest and asset list
// the game's project data would have made. A file store (a File System Access directory in the browser, Marginalia Studio's
// folder bridge) lists and reads; this module only reasons about paths and texts, so node can test it.
//
// A character folder is the PSD converter's output (sprite.json and the part images, usually with a rig.json beside them), or a
// flat character: one image per pose (default.png, smile.png ...) with or without a rig.json. The picked folder may also be a
// game project or its assets/char/ folder; then each character in it is an option.

import type { RigManifest } from './assets.js';
import { projectFromListing, type ListedFile } from './project-data.js';
import { rigSkeleton } from './rig.js';

const IMAGE = /\.(png|webp|jpe?g|avif)$/i;
/** Hidden files and folders (.git, .trash, .gitkeep) and node_modules are no part of a character. */
const skipped = (path: string) => path.split('/').some(seg => seg.startsWith('.') || seg === 'node_modules');

export interface CharacterOption { /** Where the character's files start inside the picked folder: '' or 'assets/char/mina/'. */ base: string; /** Its id (the folder's name, made safe). */ name: string }

export type FolderKind =
  /** sprite.json (the PSD converter's output) and its images, with or without a rig.json. */
  | 'layered'
  /** Images only, or a rig.json without sprite.json: one image per pose, the whole picture animated. */
  | 'flat'
  /** Several characters (a game project, or its assets/char/): the author picks one from `options`. */
  | 'choose'
  /** Nothing a character is made of. */
  | 'empty';

export interface FolderScan extends CharacterOption { kind: FolderKind; options: CharacterOption[] }

/** A folder's name as a character id: letters, digits, `_` and `-`; the rest becomes `_`. */
export function characterId(folderName: string): string {
  return folderName.trim().replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '') || 'character';
}

const lastSegment = (base: string) => base.replace(/\/$/, '').split('/').pop() ?? '';

/**
 * What the picked folder holds. `paths` are folder-relative and '/'-separated; `folderName` is the picked folder's own name
 * (the character's id when the character is the folder itself).
 */
export function scanFolder(paths: Iterable<string>, folderName: string): FolderScan {
  const files = [...paths].filter(p => !skipped(p));
  const own = characterId(folderName);
  const markers = new Set(files.flatMap(p => { const m = /^((?:.*\/)?)(sprite|rig)\.json$/.exec(p); return m ? [m[1]] : []; }));
  const manifestAt = (base: string) => files.includes(`${base}sprite.json`);
  const kindAt = (base: string): FolderKind => (manifestAt(base) ? 'layered' : 'flat');
  const one = (base: string): FolderScan => ({ kind: kindAt(base), base, name: base ? characterId(lastSegment(base)) : own, options: [] });
  if (markers.has('')) return one('');
  // Characters in a game project (assets/char/<name>/) or in a char/ folder: a manifest or any image makes one; anywhere else only a manifest does.
  const dirs = new Set<string>();
  for (const base of markers) if (/^(?:assets\/char\/|char\/)?[^/]+\/$/.test(base)) dirs.add(base);
  for (const p of files) { const m = /^((?:assets\/)?char\/[^/]+\/)/.exec(p); if (m && IMAGE.test(p)) dirs.add(m[1]); }
  const options = [...dirs].sort().map(base => ({ base, name: characterId(lastSegment(base)) }));
  if (options.length === 1) return { ...one(options[0].base), options };
  if (options.length > 1) return { kind: 'choose', base: '', name: own, options };
  if (files.some(p => IMAGE.test(p) && !p.includes('/'))) return { kind: 'flat', base: '', name: own, options: [] };
  return { kind: 'empty', base: '', name: own, options: [] };
}

/** A file of the picked folder: its path (relative to the folder) and modification time. */
export type StandaloneFile = ListedFile;

/** What the studio and its stage page need of a character folder, the shape the game's project data has. */
export interface StandaloneChar {
  /** The character's id. */
  char: string;
  /** Where its files start inside the picked folder; the studio writes rig.json there. */
  base: string;
  /** Every file of the character as the asset list has it ("char/<id>/body.png"), with what to draw it from when it is only an alias. */
  assets: { file: string; v: number; from?: string }[];
  /** sprite.json with rig.json attached (`rig`); a flat character has `{ parts: [], flat: true }`. */
  manifest: RigManifest;
  /** The rig.json's text; null when there is none yet (the studio starts from `starter`). */
  rigText: string | null;
  /** What a first rig.json holds: the part order and bones from the PSD's folders. */
  starter: string;
  /** Files that could not be read as JSON. */
  problems: string[];
}

/** The pose a flat character is drawn with when no pose is named: `default`, else `neutral`, else the first image by name. */
function defaultPose(images: string[]): string | null {
  const names = images.map(f => f.replace(IMAGE, '')).sort();
  return names.includes('default') ? null : (names.find(n => n === 'neutral') ?? names[0] ?? null);
}

/**
 * The character of a scan as the game would see it. `files` are folder-relative; `text` reads one (null when it cannot be
 * read). Only the files under the character's base count.
 */
export function standaloneChar(scan: CharacterOption, files: readonly StandaloneFile[], text: (path: string) => string | null): StandaloneChar {
  const { base, name: char } = scan;
  const prefix = `assets/char/${char}/`;
  const own = files.filter(f => f.path.startsWith(base) && !skipped(f.path.slice(base.length)));
  const problems: string[] = [];
  const data = projectFromListing({
    files: own.map(f => ({ path: prefix + f.path.slice(base.length), mtime: f.mtime })),
    dirs: [],
    text: p => text(base + p.slice(prefix.length)),
    warn: m => problems.push(m),
  });
  const manifest: RigManifest = data.rigs[char] ?? ({ parts: [], flat: true } as RigManifest);
  const assets: StandaloneChar['assets'] = data.assets.map(a => ({ file: a.file, v: a.v }));
  // A flat character is drawn from its `default` image: with none, the first pose stands in for it.
  if (manifest.flat) {
    const images = assets.map(a => a.file.slice(`char/${char}/`.length)).filter(f => !f.includes('/') && IMAGE.test(f));
    const pose = defaultPose(images);
    const src = pose === null ? undefined : assets.find(a => a.file.slice(`char/${char}/`.length).replace(IMAGE, '') === pose);
    if (src) assets.push({ file: `char/${char}/default${/\.\w+$/.exec(src.file)![0]}`, v: src.v, from: src.file });
  }
  return {
    char, base, assets, manifest, rigText: data.rigTexts[char] ?? null,
    starter: `${JSON.stringify(rigSkeleton(manifest), null, 2)}\n`, problems,
  };
}

/** The file names the studio writes, relative to the picked folder; nothing else of a character folder is ever changed. */
export const rigFile = (base: string) => `${base}rig.json`;
