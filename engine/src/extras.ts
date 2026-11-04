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

// game.json "achievements" (unlocked by `unlock <flag>`, with endings marked `ending`) and "achievementToast" (how the
// notice that pops up on an unlock looks and lasts).

export interface AchievementEntry {
  /** The flag that unlocks it (script: `unlock <flag>`); also its id. */
  unlock: string;
  title: string;
  description: string;
  /** Image name (assets/ui/<icon>.*), '' for none. */
  icon: string;
  /** Shown as "???" with no description until unlocked. */
  hidden: boolean;
  /** An ending rather than an achievement (listed and counted apart). */
  ending: boolean;
  /** Whether unlocking it pops up the toast. */
  toast: boolean;
}
export interface AchievementItem extends AchievementEntry { unlocked: boolean }

/** An object needs `unlock`; a string is a flag with itself as the title. Entries without a flag and repeats are dropped. */
export function normalizeAchievements(raw: unknown): AchievementEntry[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: AchievementEntry[] = [];
  for (const r of raw) {
    const o: Record<string, unknown> = typeof r === 'string' ? { unlock: r } : r && typeof r === 'object' ? r as Record<string, unknown> : {};
    const flag = str(o.unlock);
    if (!flag || seen.has(flag)) continue;
    seen.add(flag);
    out.push({ unlock: flag, title: str(o.title) ?? flag, description: str(o.description) ?? '', icon: str(o.icon) ?? '', hidden: o.hidden === true, ending: o.ending === true, toast: o.toast !== false });
  }
  return out;
}

/** Achievements with their lock state. */
export function achievementItems(raw: unknown, flag: (name: string) => boolean): AchievementItem[] {
  return normalizeAchievements(raw).map(e => ({ ...e, unlocked: flag(e.unlock) }));
}

/** The achievement a newly set flag unlocks and that should pop up a toast, or null (not an achievement, already held, or `toast: false`). */
export function achievementToToast(raw: unknown, flag: string, had: boolean): AchievementEntry | null {
  if (had) return null;
  const e = normalizeAchievements(raw).find(a => a.unlock === flag);
  return e && e.toast ? e : null;
}

export const TOAST_POSITIONS = ['topright', 'topleft', 'bottomright', 'bottomleft', 'top', 'bottom'] as const;
export type ToastPosition = typeof TOAST_POSITIONS[number];
export interface AchievementToastSettings {
  position: ToastPosition;
  /** How long one toast stays, in seconds. */
  seconds: number;
  /** Sound name (assets/sound/<sound>.*) played as it appears, '' for none. */
  sound: string;
}

/** game.json "achievementToast" with defaults for missing or bad values (top right, 4 seconds, no sound). */
export function achievementToastSettings(raw: unknown): AchievementToastSettings {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const position = (TOAST_POSITIONS as readonly string[]).includes(o.position as string) ? o.position as ToastPosition : 'topright';
  const seconds = typeof o.seconds === 'number' && Number.isFinite(o.seconds) && o.seconds > 0 ? Math.min(o.seconds, 30) : 4;
  return { position, seconds, sound: str(o.sound) ?? '' };
}

/** Warnings for achievements whose flag no script unlocks, and for a bad "achievementToast". */
export function achievementProblems(raw: unknown, toast: unknown, unlocks: ReadonlySet<string>): string[] {
  const out = normalizeAchievements(raw).filter(a => !unlocks.has(a.unlock)).map(a => `achievements: no script runs "unlock ${a.unlock}"`);
  if (toast !== undefined) {
    const o = toast && typeof toast === 'object' && !Array.isArray(toast) ? toast as Record<string, unknown> : null;
    if (!o) out.push('achievementToast needs an object like { "position": "topright", "seconds": 4 }');
    else {
      if (o.position !== undefined && !(TOAST_POSITIONS as readonly string[]).includes(o.position as string)) out.push(`achievementToast.position must be one of ${TOAST_POSITIONS.join(', ')}`);
      if (o.seconds !== undefined && !(typeof o.seconds === 'number' && o.seconds > 0)) out.push('achievementToast.seconds needs a number of seconds above 0');
    }
  }
  return out;
}

export const QUICK_ITEMS = ['back', 'history', 'auto', 'skip', 'qsave', 'qload', 'save', 'load', 'options', 'voice', 'hide'] as const;
export interface QuickMenuSettings {
  /** The buttons in order (`voice` last unless listed; the shell shows it only on voiced lines). */
  items: string[];
  /** An anchor place for the bar (`bottom`, `topright`, ...). */
  place: string;
}

/** game.json "quickMenu" with defaults: every button, along the bottom edge, centered. Unknown buttons are dropped, a repeated one is shown once. */
export function quickMenuSettings(raw: unknown): QuickMenuSettings {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const known = (i: unknown): i is string => typeof i === 'string' && (QUICK_ITEMS as readonly string[]).includes(i);
  const listed = Array.isArray(o.items) ? [...new Set(o.items.filter(known))] : null;
  const items = listed ? [...listed, ...(listed.includes('voice') ? [] : ['voice'])] : [...QUICK_ITEMS];
  const vertical = o.position === 'top' ? 'top' : 'bottom';
  const align = o.align === 'left' || o.align === 'right' ? o.align : 'center';
  return { items, place: align === 'center' ? vertical : vertical + align };
}
