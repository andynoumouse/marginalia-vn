import { csvCell, type StringRow } from './translation.js';
import { AUDIO_EXTS, AUDIO_FILE, extAlternatives } from './asset-kinds.js';

/** A take in voice/: the file name without its extension in group 1. */
const VOICE_TAKE = new RegExp(`^voice/([^/]+)\\.(?:${extAlternatives(AUDIO_EXTS)})$`, 'i');

/**
 * A recording's name is its file name under `assets/voice/` without the audio extension: `ab12` for the default take, `ab12.fi` for
 * the one in language `fi`. The default carries no language, so the filename never depends on game.json "language".
 */
export function splitVoiceName(name: string): { id: string; lang: string | null } {
  const dot = name.indexOf('.');
  return dot < 0 ? { id: name, lang: null } : { id: name.slice(0, dot), lang: name.slice(dot + 1) };
}

/**
 * The voice recording of a line is found from its localization id: `assets/voice/<id>.<lang>.<ext>` for the player's language,
 * else `assets/voice/<id>.<ext>`. `has` tells whether a name under `voice/` exists (without extension). Returns that name, or null
 * when the line has no recording (lines without an id never do).
 */
export function voiceFile(id: string | null | undefined, lang: string, has: (name: string) => boolean): string | null {
  if (!id) return null;
  for (const name of [`${id}.${lang}`, id]) if (has(name)) return name;
  return null;
}

/** The language the scripts are written in: game.json `language` when it is a non-empty string, else `en`. */
export function sourceLanguage(game: { language?: unknown } | null | undefined): string {
  const l = game?.language;
  return typeof l === 'string' && l.trim() ? l.trim() : 'en';
}

/**
 * The languages game.json `voiceLanguages` lists for recording, whether or not they have recordings yet or a text translation.
 * Trimmed, without duplicates, the source language (the default take) and anything that is not a string left out.
 */
export function declaredVoiceLanguages(game: { voiceLanguages?: unknown } | null | undefined, source: string): string[] {
  const l = game?.voiceLanguages;
  if (!Array.isArray(l)) return [];
  const out = new Set<string>();
  for (const v of l) if (typeof v === 'string' && v.trim() && v.trim() !== source) out.add(v.trim());
  return [...out];
}

/** Which languages a build ships. A missing list means all; the source language's text always ships (it is the script). */
export interface BuildLanguages {
  /** Translation tables (`locale/<lang>.json`) to ship. */
  text?: string[];
  /** Voice languages to ship; `source` stands for the default takes (`voice/<id>.<ext>`). */
  voice?: string[];
}

/** Whether an asset (path under assets/) ships: only voice files in a language left out of `voice` are dropped. */
export function shipsAsset(file: string, voice: string[] | undefined, source: string): boolean {
  if (!voice) return true;
  const m = VOICE_TAKE.exec(file);
  return !m || voice.includes(splitVoiceName(m[1]).lang ?? source);
}

/**
 * The languages a build can include: translation tables (not the source's own export) and voice languages (recordings, the
 * default take under the source label, and game.json "voiceLanguages"). Sorted.
 */
export function buildLanguages(
  game: { voiceLanguages?: unknown } | null | undefined, source: string, locale: string[], recordings: string[],
): { text: string[]; voice: string[] } {
  const voice = new Set(declaredVoiceLanguages(game, source));
  for (const name of recordings) voice.add(splitVoiceName(name).lang ?? source);
  return { text: locale.filter(l => l !== source).sort(), voice: [...voice].sort() };
}

/**
 * The languages the player can hear voices in: those named by a recording (`voice/<id>.<lang>.<ext>` among `files`, paths under
 * assets/), plus `source` (the label of the default) when default recordings `voice/<id>.<ext>` exist. Sorted, without duplicates.
 */
export function voiceLanguages(files: string[], source: string): string[] {
  const out = new Set<string>();
  for (const f of files) {
    const m = VOICE_TAKE.exec(f);
    if (m) out.add(splitVoiceName(m[1]).lang ?? source);
  }
  return [...out].sort();
}

/**
 * The language to look recordings up in: the player's voice setting (`''` = follow the text) when the game has recordings in it,
 * else the text language. `available` is `voiceLanguages`.
 */
export function resolveVoiceLanguage(setting: string, textLang: string, available: string[]): string {
  return setting && available.includes(setting) ? setting : textLang;
}

/**
 * The text a recording is of: the line's text in the language its name carries (falling back to the source text while that
 * language has no translation yet), or the source text for a default recording. Undefined when no line has that id.
 */
export function voiceText(name: string, strings: Record<string, string>, locale: Record<string, Record<string, string>>): string | undefined {
  const { id, lang } = splitVoiceName(name);
  if (!(id in strings)) return undefined;
  return (lang !== null && locale[lang]?.[id]) || strings[id];
}

/**
 * What was known of each recording the last time it was checked, by name under `voice/` without extension (`ab12`, `ab12.fi`):
 * a checksum of the audio file and the text of the line when that file was adopted (`voice.lock.json` in the project folder, committed;
 * the game never loads it). A recording whose file is unchanged but whose line was reworded is outdated.
 */
export type VoiceLock = Record<string, { sum: string; text: string }>;

export interface VoiceCheck {
  lock: VoiceLock;
  /** Names of recordings made against text the line no longer has, in `recordings` order. */
  outdated: string[];
}

/**
 * Compares the recordings on disk (`name -> checksum`) with the lock. A recording not in the lock is adopted with the line's
 * current text (what it was recorded against is unknowable); a new checksum is a re-recording and is adopted the same way; an
 * unchanged file under changed text is outdated and its entry stays, so it keeps being reported until it is re-recorded or
 * accepted. Entries of deleted files and of recordings whose line is gone (`textOf` undefined) are dropped.
 */
export function checkVoice(recordings: Record<string, string>, textOf: (name: string) => string | undefined, old: VoiceLock): VoiceCheck {
  const lock: VoiceLock = {};
  const outdated: string[] = [];
  for (const [name, sum] of Object.entries(recordings)) {
    const text = textOf(name);
    if (text === undefined) continue;
    const prev = old[name];
    if (prev && prev.sum === sum && prev.text !== text) {
      lock[name] = prev;
      outdated.push(name);
    } else lock[name] = { sum, text };
  }
  return { lock, outdated };
}

/** Marks recordings as still matching their line (a typo fix that needs no new take): their entry takes the line's current text. */
export function acceptVoice(lock: VoiceLock, names: string[], textOf: (name: string) => string | undefined): VoiceLock {
  const next = { ...lock };
  for (const name of names) {
    const text = textOf(name);
    if (next[name] && text !== undefined) next[name] = { sum: next[name].sum, text };
  }
  return next;
}

/** The part of `a` and `b` that differs, with what they share around it: `[start, aMiddle, bMiddle, end]` (shown to judge whether a rewording matters). */
export function changedSpan(a: string, b: string): [string, string, string, string] {
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let e = 0;
  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  return [a.slice(0, s), a.slice(s, a.length - e), b.slice(s, b.length - e), a.slice(a.length - e)];
}

export type VoiceStatus = 'missing' | 'recorded' | 'outdated';

export interface VoiceRow {
  row: StringRow;
  /** The recording's name for this row and language: `ab12`, or `ab12.fi`. */
  name: string;
  status: VoiceStatus;
  /** The line's text in the chosen language (the source while that language has no translation). */
  text: string;
  /** For an outdated row: the wording the take was recorded against. */
  recorded?: string;
}

export interface VoiceFilter {
  /** Only rows without a recording. */
  missing?: boolean;
  /** Only rows whose recording is outdated. */
  outdated?: boolean;
  /** Case-insensitive text in the id, speaker, text, file or label. */
  query?: string;
}

export interface VoiceTable {
  /** The rows passing the filter, in script order. */
  rows: VoiceRow[];
  /** Spoken lines of the script (those with an id), and how many of them have a recording in this language. */
  total: number;
  voiced: number;
  outdated: number;
}

/** The recording name of line `id` in `lang` (`null` = the default take). */
export const voiceName = (id: string, lang: string | null) => (lang ? `${id}.${lang}` : id);

/**
 * One row per spoken line (`say` rows) for a language, with the recording's status: missing (no file), recorded, or outdated (the
 * file is unchanged since the lock was written but the line's text differs; a file not in the lock counts as recorded, as in
 * `checkVoice`). `recordings` is `name -> checksum`; `locale` maps a language to its string table.
 */
export function voiceRows(rows: StringRow[], lang: string | null, recordings: Record<string, string>, lock: VoiceLock,
  locale: Record<string, Record<string, string>>, filter: VoiceFilter = {}): VoiceTable {
  const q = filter.query?.trim().toLowerCase() ?? '';
  const out: VoiceRow[] = [];
  let total = 0, voiced = 0, outdated = 0;
  for (const row of rows) {
    if (row.kind !== 'say' || !row.id) continue;
    const name = voiceName(row.id, lang);
    const text = (lang && locale[lang]?.[row.id]) || row.source;
    const sum = recordings[name];
    let status: VoiceStatus = 'missing';
    let recorded: string | undefined;
    if (sum !== undefined) {
      const prev = lock[name];
      if (prev && prev.sum === sum && prev.text !== text) { status = 'outdated'; recorded = prev.text; } else status = 'recorded';
    }
    total++;
    if (status !== 'missing') voiced++;
    if (status === 'outdated') outdated++;
    if (filter.missing && status !== 'missing') continue;
    if (filter.outdated && status !== 'outdated') continue;
    if (q && ![row.id, row.who ?? '', text, row.source, row.file ?? '', row.label ?? ''].some(s => s.toLowerCase().includes(q))) continue;
    out.push({ row, name, status, text, ...(recorded === undefined ? {} : { recorded }) });
  }
  return { rows: out, total, voiced, outdated };
}


/**
 * Sorts dropped file names into the lines they are recordings of for `lang`: a file already named `<id>.<ext>` (default take) or
 * `<id>.<lang>.<ext>` whose id is among `ids`. `rest` holds everything else (other languages, unknown ids, non-audio), to be dropped
 * on a row by hand. When two files claim one name the first wins and the other goes to `rest`.
 */
export function matchVoiceDrops(files: string[], lang: string | null, ids: Iterable<string>): { matched: { name: string; file: string }[]; rest: string[] } {
  const known = new Set(ids);
  const taken = new Set<string>();
  const matched: { name: string; file: string }[] = [];
  const rest: string[] = [];
  for (const file of files) {
    const base = file.split(/[\/]/).pop() ?? '';
    const name = AUDIO_FILE.test(base) ? base.replace(AUDIO_FILE, '') : '';
    const { id, lang: l } = splitVoiceName(name);
    if (name && l === lang && known.has(id) && !taken.has(name)) { taken.add(name); matched.push({ name, file }); } else rest.push(file);
  }
  return { matched, rest };
}

/** The recording script for the voice actor: one line per spoken line with who says it, what, and the file name to deliver it as (no extension). */
export function recordingScriptCsv(rows: VoiceRow[]): string {
  const head = ['id', 'file', 'line', 'speaker', 'text', 'filename'];
  const lines = rows.map(r => [r.row.id, r.row.file ?? '', r.row.line === undefined ? '' : String(r.row.line), r.row.who ?? '', r.text, r.name]);
  return [head, ...lines].map(cells => cells.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
