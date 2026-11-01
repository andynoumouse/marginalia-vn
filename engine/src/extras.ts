// game.json "musicRoom" (a track list that unlocks as the music plays) and "chapters" (labels the player can start
// from, unlocked when the story reaches them), cleaned up so the game shell can trust the values.

export interface MusicEntry {
  /** Track name (assets/music/<track>.*). */
  track: string;
  title: string;
  /** Unlock with this flag (script: `unlock <flag>`) instead of by hearing the track. */
  unlock?: string;
}
export interface ChapterEntry {
  /** Script label the chapter starts at. */
  label: string;
  title: string;
  /** Unlock with this flag instead of by reaching the label. */
  unlock?: string;
}
/** An entry as a screen shows it. */
export interface MusicItem extends MusicEntry { unlocked: boolean }
export interface ChapterItem extends ChapterEntry { unlocked: boolean }

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

function entries<T>(raw: unknown, key: 'track' | 'label'): T[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of raw) {
    const o: Record<string, unknown> = typeof r === 'string' ? { [key]: r } : r && typeof r === 'object' ? r as Record<string, unknown> : {};
    const id = str(o[key]);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const unlock = str(o.unlock);
    out.push({ [key]: id, title: str(o.title) ?? id, ...(unlock ? { unlock } : {}) } as T);
  }
  return out;
}

/** A string is a track name; an object has track, title and unlock. Entries without a track and repeats are dropped. */
export const normalizeMusicRoom = (raw: unknown) => entries<MusicEntry>(raw, 'track');
/** A string is a label; an object has label, title and unlock. Entries without a label and repeats are dropped. */
export const normalizeChapters = (raw: unknown) => entries<ChapterEntry>(raw, 'label');

/** Music room entries with their lock state: heard (a persistent set of track names) or the entry's own flag. */
export function musicItems(raw: unknown, heard: (track: string) => boolean, flag: (name: string) => boolean): MusicItem[] {
  return normalizeMusicRoom(raw).map(e => ({ ...e, unlocked: e.unlock ? flag(e.unlock) : heard(e.track) }));
}

/** Chapter entries with their lock state: reached (a persistent set of label names) or the entry's own flag. */
export function chapterItems(raw: unknown, reached: (label: string) => boolean, flag: (name: string) => boolean): ChapterItem[] {
  return normalizeChapters(raw).map(e => ({ ...e, unlocked: e.unlock ? flag(e.unlock) : reached(e.label) }));
}

/** Warnings for chapters that start at a label no script defines. */
export function chapterProblems(raw: unknown, labels: Record<string, number>): string[] {
  return normalizeChapters(raw).filter(c => !(c.label in labels)).map(c => `chapters: no label "${c.label}" in the scripts`);
}
