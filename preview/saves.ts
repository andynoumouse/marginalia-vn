// Save slots in browser storage (per game, see storage.ts). A save is a source position plus the choices
// made on the way there (see Runtime.restore), so saves keep working after the script is edited.
//   slot "auto"      written on every line (Continue uses the newest save of all)
//   slots "choice.1".. written when a choice or prompt appears, newest first (rotating, see rotateChoiceSaves)
//   slot "quick"    quick save (F5 / Q.Save), loaded by quick load (F9 / Q.Load)
//   slots "1".."N"   manual saves from the Save screen
// Also what persists across playthroughs: read lines (Skip), unlock flags and images seen (gallery).

import { valuesEqual, type Answer, type Scalar, type Src, type Value } from '../engine/src/index.js';
import type { LineInfo } from './stage-ui.js';
import { getItem, keysWith, removeItem, setItem } from './storage.js';

export interface SaveData {
  at: Src;
  choices: Answer[];
  name: string | null; // speaker of the line on screen
  text: string;        // the line on screen, without markup
  time: number;
  thumb?: string;      // small JPEG data URL of the scene
  base?: string[];     // unlock flags as they were when this playthrough began (Runtime.unlockedBase)
  persistentBase?: Record<string, Value>; // persistent values as they were then (Runtime.persistentBase)
  seed?: number;       // random seed of this playthrough (Runtime.seed)
  version?: string;    // script version; rollback history is only reused when it matches
  saveVersion?: number; // game.json "saveVersion" when saved (none: 0); see isOutdatedSave
  history?: Moment[];  // rollback history up to this point
  label?: string;      // the name the player gave it (game.json "saveNames"; manual slots only)
}

/** The longest save name, in characters. */
export const SAVE_NAME_MAX = 40;

/** A line or choice passed, for rollback and the history screen (exact within one script version). */
export interface Moment { step: number; choices: Answer[]; line?: LineInfo }

export const SLOTS_PER_PAGE = 6;
export const PAGES = 9;
const PREFIX = 'save.';

export function readSave(slot: string): SaveData | null {
  try {
    const s = JSON.parse(getItem(PREFIX + slot) ?? 'null') as SaveData | null;
    return s && s.at && Array.isArray(s.choices) ? s : null;
  } catch {
    return null;
  }
}

/** Returns false when storage is unavailable or full. */
export function writeSave(slot: string, data: SaveData): boolean {
  if (setItem(PREFIX + slot, JSON.stringify(data))) return true;
  // Most likely the quota: retry without the thumbnail before giving up.
  return !!data.thumb && setItem(PREFIX + slot, JSON.stringify({ ...data, thumb: undefined }));
}

export function deleteSave(slot: string) {
  removeItem(PREFIX + slot);
}

/** Deletes every save slot (auto, choice, quick and manual); returns how many there were. */
export function deleteAllSaves(): number {
  const keys = keysWith(PREFIX);
  for (const key of keys) removeItem(key);
  return keys.length;
}

/** Lines the player has seen, by localization id (or file:line for lines without one). */
export class SeenLines {
  private set = new Set<string>();
  private timer = 0;
  constructor() {
    try { for (const k of JSON.parse(getItem('seen') ?? '[]') as string[]) this.set.add(k); } catch { /* none yet */ }
  }
  static key(ev: { id: string | null; src: Src }) { return ev.id ?? `${ev.src.file}:${ev.src.line}`; }
  has(key: string) { return this.set.has(key); }
  add(key: string) {
    if (this.set.has(key)) return;
    this.set.add(key);
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => setItem('seen', JSON.stringify([...this.set])), 500);
  }
  clear() {
    clearTimeout(this.timer);
    this.set.clear();
    removeItem('seen');
  }
}

/** A small persistent set (flags, image names) kept under one storage key. */
export class PersistentSet {
  private set: Set<string>;
  constructor(private key: string) {
    let stored: string[] = [];
    try { stored = JSON.parse(getItem(key) ?? '[]') as string[]; } catch { /* none yet */ }
    this.set = new Set(stored);
  }
  has(name: string) { return this.set.has(name); }
  values() { return [...this.set]; }
  add(name: string) {
    if (this.set.has(name)) return;
    this.set.add(name);
    setItem(this.key, JSON.stringify([...this.set]));
  }
  remove(name: string) {
    if (this.set.delete(name)) setItem(this.key, JSON.stringify([...this.set]));
  }
  clear() {
    this.set.clear();
    removeItem(this.key);
  }
}

const isScalar = (v: unknown): v is Scalar => typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean';
const isValue = (v: unknown): v is Value => isScalar(v) || (Array.isArray(v) && v.every(isScalar));

/** Persistent values of any basic type (`set persistent.x = ...`), kept under one storage key. */
export class PersistentValues {
  private data: Record<string, Value> = {};
  constructor(private key: string) {
    try {
      const stored = JSON.parse(getItem(key) ?? '{}') as Record<string, unknown>;
      for (const [k, v] of Object.entries(stored ?? {})) if (isValue(v)) this.data[k] = v;
    } catch { /* none yet */ }
  }
  values() { return { ...this.data }; }
  set(name: string, value: Value) {
    if (name in this.data && valuesEqual(this.data[name], value)) return;
    this.data[name] = value;
    setItem(this.key, JSON.stringify(this.data));
  }
  clear() {
    this.data = {};
    removeItem(this.key);
  }
}

/** game.json `saveVersion`: a whole number of 0 or more, else 0 (not set). */
export const normalizeSaveVersion = (v: unknown): number => typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;

/** True when the save was made under an older game.json `saveVersion` (saves from before it existed count as 0). */
export const isOutdatedSave = (data: { saveVersion?: number }, current: number): boolean => normalizeSaveVersion(data.saveVersion) < current;

export const CHOICE_SLOTS = 5;
export const MAX_CHOICE_SLOTS = 20;
let choiceSlots = CHOICE_SLOTS;
/** Applies game.json `choiceSaves`: a whole number from 1 to MAX_CHOICE_SLOTS, else the default. */
export function setChoiceSlots(n: unknown) {
  choiceSlots = typeof n === 'number' && Number.isFinite(n) ? Math.min(MAX_CHOICE_SLOTS, Math.max(1, Math.round(n))) : CHOICE_SLOTS;
}
export const choiceSlotCount = () => choiceSlots;
export const choiceSlot = (i: number) => `choice.${i + 1}`;
export const isChoiceSlot = (slot: string) => slot.startsWith('choice.');

/** The ring of choice saves, newest first, after a new one. The same moment again (a rollback to the choice and
 *  back) replaces its entry in place instead of pushing older ones out. */
export function rotateChoiceSaves<T extends { at: Src; choices: Answer[] }>(ring: (T | null)[], item: T, max = CHOICE_SLOTS): T[] {
  const key = (s: T) => JSON.stringify([s.at, s.choices]);
  const kept = ring.filter((s): s is T => !!s);
  const same = kept.findIndex(s => key(s) === key(item));
  if (same >= 0) kept.splice(same, 1);
  return [item, ...kept].slice(0, Math.max(1, max));
}

/** Saves a choice or prompt as the newest of the rotating choice saves. */
export function writeChoiceSave(data: SaveData, max = choiceSlots) {
  const ring = Array.from({ length: max }, (_, i) => readSave(choiceSlot(i)));
  const next = rotateChoiceSaves(ring, data, max);
  for (let i = 0; i < next.length; i++) {
    // A full storage drops the oldest choice saves first and tries again.
    if (!writeSave(choiceSlot(i), next[i])) { for (let j = max - 1; j > i; j--) deleteSave(choiceSlot(j)); writeSave(choiceSlot(i), next[i]); }
  }
  // Also clears slots left over from a larger setting.
  for (let i = next.length; i < Math.max(max, MAX_CHOICE_SLOTS); i++) deleteSave(choiceSlot(i));
}

export const manualSlot =(page: number, i: number) => String(page * SLOTS_PER_PAGE + i + 1);

/** The most recent save in any slot (for Continue). */
export function newestSave(): SaveData | null {
  let best: SaveData | null = null;
  for (const key of keysWith(PREFIX)) {
    const s = readSave(key.slice(PREFIX.length));
    if (s && (!best || s.time > best.time)) best = s;
  }
  return best;
}
