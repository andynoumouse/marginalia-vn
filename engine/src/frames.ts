// Frame-by-frame animation: stepped tracks over a slot's variants (rig.json `animations.<name>.frames`).
// Pure functions, no DOM. Two written forms, both stored as written and expanded in memory:
//   { "slot": "hand", "keys": [{ "t": 0, "frame": "up" }, { "t": 0.5, "frame": "none" }] }   keys at progress t (0-1)
//   { "slot": "walk", "frames": ["01", "02", "03"], "fps": 12, "loop": true }               a clip, timed in seconds
// A frame is a variant name or `none` (the slot is hidden). The frame shown is a function of the animation's time, so
// a jump (instant mode, skip, the studio's scrubber) lands on the right frame with no state to keep.

import { clamp01 } from './util.js';

export interface FrameKey { t: number; frame: string }
export interface FrameTrackDef { slot: string; keys?: FrameKey[]; frames?: string[]; fps?: number; loop?: boolean }

export const DEFAULT_FPS = 12;

const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** The tracks of an animation's `frames` that are usable (an object with a slot name), in order. */
export const frameTracks = (frames: unknown): FrameTrackDef[] =>
  (Array.isArray(frames) ? frames : []).filter((f): f is FrameTrackDef => !!f && typeof f === 'object' && typeof (f as FrameTrackDef).slot === 'string');

/** A clip's frames per second (12 unless it says a positive number). */
export const clipFps = (t: FrameTrackDef): number => (typeof t.fps === 'number' && t.fps > 0 ? t.fps : DEFAULT_FPS);

/**
 * The frame of `track` at progress `t` (0-1) of an animation `seconds` into its run. Undefined before the first key:
 * the slot has no say there, so the script's value (or the character's own blinking) shows. After the last key the last
 * frame holds until the animation ends; a looping clip repeats instead.
 */
export function frameOf(track: FrameTrackDef, t: number, seconds: number): string | undefined {
  if (Array.isArray(track.frames) && track.frames.length) {
    const n = track.frames.length, i = Math.floor(Math.max(0, seconds) * clipFps(track) + 1e-9);
    const f = track.frames[track.loop ? i % n : Math.min(i, n - 1)];
    return typeof f === 'string' ? f : undefined;
  }
  let at: string | undefined;
  const p = clamp01(t);
  for (const k of [...(track.keys ?? [])].filter(k => Number.isFinite(k?.t) && typeof k.frame === 'string').sort((a, b) => a.t - b.t)) {
    if (k.t <= p) at = k.frame; else break;
  }
  return at;
}

/** Every track of `tracks` at progress `t`, `seconds` in: the slot variants the animation holds right now, by slot. */
export function framesAt(tracks: FrameTrackDef[], t: number, seconds: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tr of tracks) { const f = frameOf(tr, t, seconds); if (f !== undefined) out[tr.slot] = f; }
  return out;
}

/** A track as keys at progress for an animation `dur` seconds long (a clip expanded; a loop repeated to fill `dur`). */
export function expandFrames(track: FrameTrackDef, dur: number): FrameKey[] {
  if (!Array.isArray(track.frames) || !track.frames.length) return [...(track.keys ?? [])].sort((a, b) => a.t - b.t);
  const fps = clipFps(track), n = track.frames.length, out: FrameKey[] = [];
  const count = track.loop ? Math.ceil(dur * fps - 1e-9) : n;
  for (let i = 0; i < count; i++) {
    const t = round4(i / fps / dur);
    if (t >= 1) break;
    out.push({ t, frame: track.frames[i % n] });
  }
  return out;
}

/** The variants each slot's frames name (what must be loaded to play the tracks), by slot; `none` is left out. */
export function framesNeeded(tracks: FrameTrackDef[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const tr of tracks) {
    const names = [...(tr.frames ?? []), ...(tr.keys ?? []).map(k => k?.frame)].filter((x): x is string => typeof x === 'string' && x !== 'none');
    out[tr.slot] = [...new Set([...(out[tr.slot] ?? []), ...names])];
  }
  return out;
}

// ---- edits for the studio's frame rows (pure; the track is expanded to keys first) ----

/** The track as plain keys (a clip expanded for `dur` seconds), the form the studio edits. */
export const asKeys = (track: FrameTrackDef, dur: number): FrameTrackDef => ({ slot: track.slot, keys: expandFrames(track, dur) });

/** One block of a frame row: the frame held from `from` to `to` (progress). */
export interface FrameBlock { index: number; from: number; to: number; frame: string }

/** The blocks of a keys track: each key holds until the next, the last until the end of the animation. */
export function frameBlocks(track: FrameTrackDef): FrameBlock[] {
  const keys = track.keys ?? [];
  return keys.map((k, i) => ({ index: i, from: k.t, to: i + 1 < keys.length ? keys[i + 1].t : 1, frame: k.frame }));
}

/** A track of every variant in order, `fps` frames a second, for an animation `dur` seconds long (what "frames from this slot" fills). Frames past the end are dropped. */
export function framesFromSlot(slot: string, variants: string[], fps: number, dur: number): FrameTrackDef {
  const step = 1 / (Math.max(1, fps) * dur), keys: FrameKey[] = [];
  variants.forEach((frame, i) => { if (i * step < 1) keys.push({ t: round4(i * step), frame }); });
  return { slot, keys };
}

/** `track` with key `index` moved to `t` (the keys re-sort), and where that key ended up. */
export function retimeFrameAt(track: FrameTrackDef, index: number, t: number): { track: FrameTrackDef; index: number } {
  const keys = [...(track.keys ?? [])];
  if (!keys[index]) return { track, index };
  const moved = { ...keys[index], t: round4(clamp01(t)) };
  keys[index] = moved;
  keys.sort((a, b) => a.t - b.t);
  return { track: { ...track, keys }, index: keys.indexOf(moved) };
}

/** `track` with key `index` moved to `t` (the keys re-sort). */
export const retimeFrame = (track: FrameTrackDef, index: number, t: number): FrameTrackDef => retimeFrameAt(track, index, t).track;

/** `track` with key `index` copied to `t` (halfway to the next key, or the end, when `t` is omitted). Unchanged when a key is already there. */
export function duplicateFrame(track: FrameTrackDef, index: number, t?: number): FrameTrackDef {
  const keys = [...(track.keys ?? [])];
  if (!keys[index]) return track;
  const next = keys[index + 1]?.t ?? 1;
  const at = round4(clamp01(t ?? (keys[index].t + next) / 2));
  if (keys.some(k => Math.abs(k.t - at) < 0.0005)) return track;
  keys.push({ ...keys[index], t: at });
  keys.sort((a, b) => a.t - b.t);
  return { ...track, keys };
}

/** `track` with the frame of key `index` replaced (timings stay). */
export function setFrame(track: FrameTrackDef, index: number, frame: string): FrameTrackDef {
  const keys = [...(track.keys ?? [])];
  if (!keys[index]) return track;
  keys[index] = { ...keys[index], frame };
  return { ...track, keys };
}

/** `track` without key `index`. */
export const deleteFrame = (track: FrameTrackDef, index: number): FrameTrackDef => ({ ...track, keys: (track.keys ?? []).filter((_, i) => i !== index) });

/** `track` with block `from` moved to position `to` in the order: the times stay where they are, the frames move between them. */
export function reorderFrame(track: FrameTrackDef, from: number, to: number): FrameTrackDef {
  const keys = [...(track.keys ?? [])];
  if (!keys[from] || to < 0 || to >= keys.length || from === to) return track;
  const frames = keys.map(k => k.frame), [f] = frames.splice(from, 1);
  frames.splice(to, 0, f);
  return { ...track, keys: keys.map((k, i) => ({ ...k, frame: frames[i] })) };
}

/** `track` with a key added at `t` showing `frame` (replacing one within 0.0005). */
export function addFrameKey(track: FrameTrackDef, t: number, frame: string): FrameTrackDef {
  const at = round4(clamp01(t)), keys = (track.keys ?? []).filter(k => Math.abs(k.t - at) >= 0.0005);
  keys.push({ t: at, frame });
  keys.sort((a, b) => a.t - b.t);
  return { ...track, keys };
}

/** Problems of an animation's frame tracks, for `checkRig`. `slots` maps each slot to its variants; `anim` is the animation's name. */
export function checkFrames(anim: string, frames: unknown, slots: Map<string, Record<string, unknown>>, problem: (message: string, at: string) => void): void {
  if (frames === undefined) return;
  if (!Array.isArray(frames)) { problem(`animations.${anim}.frames: needs a list of tracks`, anim); return; }
  const seen = new Set<string>();
  frames.forEach((tr: unknown, i) => {
    const at = `animations.${anim}.frames[${i}]`;
    if (!tr || typeof tr !== 'object' || Array.isArray(tr)) { problem(`${at}: not a track`, anim); return; }
    const t = tr as Record<string, unknown>;
    for (const k of Object.keys(t)) if (!['slot', 'keys', 'frames', 'fps', 'loop'].includes(k)) problem(`${at}: unknown field "${k}" (slot, keys, frames, fps, loop)`, anim);
    if (typeof t.slot !== 'string') { problem(`${at}: needs the "slot" it plays`, anim); return; }
    const slot = t.slot, have = slots.get(slot);
    if (!have) problem(`${at}: no slot "${slot}" (slots: ${[...slots.keys()].join(', ') || 'none'}; a plain layer has no variants to step through)`, anim);
    if (seen.has(slot)) problem(`${at}: a second frame track on slot "${slot}" (one animation plays one track per slot)`, anim);
    seen.add(slot);
    const known = (f: unknown, where: string) => {
      if (typeof f !== 'string') problem(`${where}: a frame is a variant name or "none"`, anim);
      else if (have && f !== 'none' && !Object.hasOwn(have, f)) problem(`${where}: slot "${slot}" has no variant "${f}"`, anim);
    };
    if (t.keys !== undefined && t.frames !== undefined) problem(`${at}: use either "keys" or "frames", not both`, anim);
    if (t.frames !== undefined) {
      if (!Array.isArray(t.frames) || !t.frames.length) problem(`${at}.frames: needs a list of variant names`, anim);
      else t.frames.forEach((f, j) => known(f, `${at}.frames[${j}]`));
      if (t.fps !== undefined && !(typeof t.fps === 'number' && t.fps > 0)) problem(`${at}.fps: must be more than 0 frames a second`, anim);
    } else if (!Array.isArray(t.keys) || !t.keys.length) problem(`${at}: needs "keys" or "frames"`, anim);
    else t.keys.forEach((k: Record<string, unknown>, j) => {
      if (!k || typeof k !== 'object') { problem(`${at}.keys[${j}]: not a key`, anim); return; }
      if (typeof k.t !== 'number' || !(k.t >= 0 && k.t <= 1)) problem(`${at}.keys[${j}]: t must be a number from 0 to 1`, anim);
      known(k.frame, `${at}.keys[${j}].frame`);
    });
  });
}

// ---- the tracks of an animation ----

/** The track of `def` for `slot`, or undefined. */
export const trackOfSlot = (def: { frames?: FrameTrackDef[] }, slot: string): FrameTrackDef | undefined => frameTracks(def.frames).find(t => t.slot === slot);

/** `def` with the track for `track.slot` replaced (or added), or removed when `track` is null; `slot` names it then. An emptied list is dropped. */
export function withFrameTrack<T extends { frames?: FrameTrackDef[] }>(def: T, slot: string, track: FrameTrackDef | null): T {
  const rest = (def.frames ?? []).filter(t => t?.slot !== slot);
  const at = (def.frames ?? []).findIndex(t => t?.slot === slot);
  const list = track ? (at >= 0 ? [...rest.slice(0, at), track, ...rest.slice(at)] : [...rest, track]) : rest;
  const { frames: _old, ...others } = def;
  return (list.length ? { ...others, frames: list } : others) as T;
}
