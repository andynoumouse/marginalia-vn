// The rules of the editor's /api routes that both of its servers apply: preview/dev-server.mjs on disk and the online demo
// (online/routes.ts) on its file store. Which names a route takes, what a voice lock is, where an uploaded asset goes and when it
// would overwrite something, and the trash's order and manifest. The servers keep only their storage (api-routes.ts lists the routes).

import { planDrop } from './asset-drop.js';
import { AUDIO_FILE } from './asset-kinds.js';
import { checkProjectPath } from './file-ops.js';
import type { TrashAction, TrashEntry } from './trash.js';

/** A project-relative path with no empty, '.' or '..' segments and no backslashes: what path.resolve would have normalized away on disk. */
export const isCleanPath = (p: string): boolean => p !== '' && !p.includes('\\') && p.split('/').every(s => s !== '' && s !== '.' && s !== '..');

/** PUT /api/script's `file`: a .vn path under script/. */
export const isScriptFile = (file: string): boolean => /^[\w\-./]+\.vn$/.test(file) && isCleanPath(file);
/** PUT /api/folder's `dir`: a folder path under script/, or (`inAssets`) one top-level folder under assets/. */
export const isFolderName = (dir: string, inAssets: boolean): boolean => (inAssets ? /^[\w\-]+$/ : /^[\w\-./]+$/).test(dir) && isCleanPath(dir);
/** A file directly in locale/ the editor reads and writes: a language's table (.json) or the Translations dialog's source snapshot (.src). */
export const isLocaleFile = (file: string): boolean => /^[\w\-]+\.(json|src)$/.test(file);
/** A character's folder name (PUT /api/rig) or a theme's name (PUT /api/theme). */
export const isPlainName = (name: string): boolean => /^[\w\-]+$/.test(name);

/** voice.lock.json: an object of `{ sum, text }` per recording name. */
export function isVoiceLock(x: unknown): x is Record<string, { sum: string; text: string }> {
  return !!x && typeof x === 'object' && !Array.isArray(x)
    && Object.values(x as Record<string, { sum?: unknown; text?: unknown } | null>).every(e => typeof e?.sum === 'string' && typeof e?.text === 'string');
}

/** The extension of a file name, lowercased with its dot ('' without one). */
const extOf = (s: string) => /\.[^./]*$/.exec(s)?.[0].toLowerCase() ?? '';

/**
 * Where PUT /api/asset writes. `replacing`: the files panel's Replace of an existing assets/ or masters/ file (same extension; the
 * server answers 404 when it is not there). `voice`: a take of that recording name (`id[.lang]`, the extension from `name`;
 * `replaceVoice` overwrites the takes it has). Otherwise a drop (asset-drop.ts). `error` is a 400.
 */
export interface AssetSave { dest: string; replacing: string | null; voice: string | null; replaceVoice: boolean }
export function planAssetSave(q: { get(key: string): string | null }): AssetSave | { error: string } {
  const voice = q.get('voice'), name = q.get('name') ?? '';
  const replacing = voice === null ? q.get('replace') : null;
  let dest: string;
  if (replacing !== null) {
    const bad = checkProjectPath(replacing) ?? (replacing.startsWith('script/') ? 'replace assets and masters only' : null)
      ?? (extOf(replacing) !== extOf(name) ? `pick a ${extOf(replacing) || 'same-type'} file` : null);
    if (bad) return { error: bad };
    dest = replacing;
  } else if (voice !== null) {
    const ext = AUDIO_FILE.exec(name)?.[0].toLowerCase();
    if (!/^[\w\-]+(\.[\w\-]+)?$/.test(voice) || !ext) return { error: 'Not a voice recording name' };
    dest = `assets/voice/${voice}${ext}`;
  } else {
    const plan = planDrop(name, q.get('folder') ?? '');
    if ('error' in plan) return plan;
    dest = plan.dest;
  }
  if (!isCleanPath(dest)) return { error: 'Bad path' };
  return { dest, replacing, voice, replaceVoice: voice !== null && q.get('replace') === '1' };
}

/** The takes of recording `voice` among the file names directly in assets/voice/ (any audio extension), sorted. */
export const voiceTakes = (names: readonly string[], voice: string): string[] =>
  names.filter(f => AUDIO_FILE.test(f) && f.replace(AUDIO_FILE, '') === voice).sort();

/**
 * The path PUT /api/asset answers 409 with, or null to go ahead: a drop never overwrites, and a new take never overwrites
 * the recording's takes (under any extension, which would make the name ambiguous) unless `replaceVoice`. `takes` from voiceTakes.
 */
export function assetSaveConflict(plan: AssetSave, destExists: boolean, takes: readonly string[]): string | null {
  if (plan.replacing !== null) return null;
  if (plan.voice === null) return destExists ? plan.dest : null;
  return takes.length && !plan.replaceVoice ? `assets/voice/${takes[0]}` : null;
}

/** What a save moves to the trash before it writes: the replaced file, or every take of a re-recorded line. */
export const assetSaveTrash = (plan: AssetSave, takes: readonly string[]): string[] =>
  plan.replacing !== null ? [plan.replacing] : takes.map(f => `assets/voice/${f}`);

/** Trash entries newest first (GET /api/trash). */
export const newestFirst = (entries: TrashEntry[]): TrashEntry[] =>
  entries.sort((a, b) => b.time.localeCompare(a.time) || b.id.localeCompare(a.id));

/** A trash entry's manifest.json text. */
export const manifestText = (action: TrashAction, paths: readonly string[], now: Date): string =>
  JSON.stringify({ action, paths: [...paths], time: now.toISOString() }, null, 2);
