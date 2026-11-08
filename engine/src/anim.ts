// Animation math shared by the parser, the editor and the renderer: easing curves and interpolation.
// Pure functions, no DOM.

import type { AutoDef } from './auto-anim.js';
import { framesAt, frameTracks, type FrameTrackDef } from './frames.js';
import { clamp01 } from './util.js';
import { lerpRgb, mulRgb, rgbNumber } from './fx.js';

const WHITE = 0xffffff;

export type EaseFn = (t: number) => number;

const outBounce: EaseFn = t => {
  const n = 7.5625, d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
};

/** Easing curves by name, as written after `ease=`. `back`, `bounce` and `elastic` overshoot or rebound at the end. */
export const EASES: Record<string, EaseFn> = {
  linear: t => t,
  in: t => t * t * t,
  out: t => 1 - (1 - t) ** 3,
  inout: t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  back: t => { const c = 1.70158; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; },
  bounce: outBounce,
  elastic: t => (t === 0 || t === 1 ? t : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
};
export const EASE_NAMES = Object.keys(EASES);
export const DEFAULT_EASE = 'inout';

/** The control points of a CSS-style cubic Bezier: the curve from (0, 0) to (1, 1) through (x1, y1) and (x2, y2). */
export type Bezier = [x1: number, y1: number, x2: number, y2: number];

/** A valid Bezier: four numbers, the two x in 0-1 (time never runs backwards), the two y free (past 0-1 overshoots). */
export const isBezier = (b: unknown): b is Bezier => Array.isArray(b) && b.length === 4 && b.every(n => typeof n === 'number' && Number.isFinite(n)) && b[0] >= 0 && b[0] <= 1 && b[2] >= 0 && b[2] <= 1;

/** The easing curve of a Bezier: for progress `u` the y of the point whose x is `u` (Newton steps, bisection when the slope is flat). */
export function bezierEase([x1, y1, x2, y2]: Bezier): EaseFn {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (s: number) => ((ax * s + bx) * s + cx) * s;
  const dx = (s: number) => (3 * ax * s + 2 * bx) * s + cx;
  return u => {
    if (u <= 0) return 0;
    if (u >= 1) return 1;
    let s = u;
    for (let i = 0; i < 8; i++) {
      const err = sx(s) - u, slope = dx(s);
      if (Math.abs(err) < 1e-7) return ((ay * s + by) * s + cy) * s;
      if (Math.abs(slope) < 1e-6) break;
      s -= err / slope;
    }
    let lo = 0, hi = 1;
    s = u;
    for (let i = 0; i < 40; i++) {
      const x = sx(s);
      if (Math.abs(x - u) < 1e-7) break;
      if (x < u) lo = s; else hi = s;
      s = (lo + hi) / 2;
    }
    return ((ay * s + by) * s + cy) * s;
  };
}

/** The Bezier closest to the named ease, to start a handle drag from; null for `bounce` and `elastic`, which no Bezier makes. */
export function presetBezier(name: string | undefined): Bezier | null {
  const named: Record<string, Bezier> = {
    linear: [0, 0, 1, 1], in: [0.32, 0, 0.67, 0], out: [0.33, 1, 0.68, 1], inout: [0.65, 0, 0.35, 1], back: [0.34, 1.56, 0.64, 1],
  };
  return Object.hasOwn(named, name ?? DEFAULT_EASE) ? [...named[name ?? DEFAULT_EASE]] as Bezier : null;
}

/** `bezier(x1,y1,x2,y2)` or `cubic-bezier(x1,y1,x2,y2)` (no spaces) as an `ease=` value: the control points, or null when it is not one. */
export function parseBezierSpec(spec: string): Bezier | null {
  const m = /^(?:cubic-)?bezier\(([^()]*)\)$/.exec(spec);
  if (!m) return null;
  const parts = m[1].split(',');
  if (parts.length !== 4 || parts.some(p => p.trim() === '')) return null;
  const b = parts.map(Number);
  return isBezier(b) ? b : null;
}

/** Whether `spec` is something `ease=` accepts: a name from EASES or a `bezier(...)` with valid control points. */
export const isEaseSpec = (spec: string): boolean => EASE_NAMES.includes(spec) || parseBezierSpec(spec) !== null;

/** What to tell the author when an `ease=` value is not accepted. */
export const easeProblem = (spec: string): string => /^(?:cubic-)?bezier\(/.test(spec)
  ? `Unknown ease "${spec}": a bezier is bezier(x1,y1,x2,y2) with four numbers and x1 and x2 from 0 to 1`
  : `Unknown ease "${spec}" (${EASE_NAMES.join(', ')}, or bezier(x1,y1,x2,y2))`;

/** The curve named `name` (or a `bezier(...)` spec); an unknown name gives the default curve. */
export function easing(name: string | undefined): EaseFn {
  if (name !== undefined && Object.hasOwn(EASES, name)) return EASES[name];
  const b = name !== undefined ? parseBezierSpec(name) : null;
  return b ? bezierEase(b) : EASES[DEFAULT_EASE];
}

/** `from` to `to` at progress `k` (0-1, already eased; may overshoot). */
export const lerp = (from: number, to: number, k: number) => from + (to - from) * k;

// ---- named animations (`animate <char> <name>`) ----
// An animation is a function of progress t (0-1) giving a small offset on top of where the sprite stands. Every one
// starts and ends at no offset, so a loop repeats without a jump and a one-shot leaves the sprite where it was.

/** How an animation moves a sprite: `dx`/`dy` as fractions of the stage's shorter side (fxUnit), `sx`/`sy` added to the scale, `rot` in degrees. */
export interface Offset {
  dx: number; dy: number; sx: number; sy: number; rot: number;
  /** A factor on the part's alpha (from keyforms); absent is 1. */ opacity?: number;
  /** A color (0xrrggbb) the sprite is multiplied by on top of its own tint (a transform's `tint=`); absent is white. */ tint?: number;
  /** A hit flash: the sprite mixes `amount` (0-1) of the way to `color` (a transform's `flash=`); absent is none. */ flash?: { color: number; amount: number };
}
export const NO_OFFSET: Offset = { dx: 0, dy: 0, sx: 0, sy: 0, rot: 0 };
export const addOffset = (a: Offset, b: Offset): Offset => {
  const sum: Offset = { dx: a.dx + b.dx, dy: a.dy + b.dy, sx: a.sx + b.sx, sy: a.sy + b.sy, rot: a.rot + b.rot };
  if (a.opacity !== undefined || b.opacity !== undefined) sum.opacity = (a.opacity ?? 1) * (b.opacity ?? 1);
  if (a.tint !== undefined || b.tint !== undefined) sum.tint = mulRgb(a.tint ?? WHITE, b.tint ?? WHITE);
  const flash = a.flash && b.flash ? (b.flash.amount > a.flash.amount ? b.flash : a.flash) : a.flash ?? b.flash; // the stronger of two flashes shows
  if (flash) sum.flash = flash;
  return sum;
};

/** A looping animation on a sprite (`animate <char> <name> loop`); `dur` is the length of one cycle in seconds (null: the animation's own). */
export interface SpriteAnim { name: string; dur: number | null; strength: number; part: string | null; /** A dynamic transform as `animate` worked it out, kept so a save or rollback plays that very one. */ def?: AnimDef }

interface Preset { dur: number; fn: (t: number) => Partial<Offset> }
const TAU = Math.PI * 2;
const HOP_PX = 44; // how high `hop` jumps, on a 1080 side
const SHAKE_PTS = [0, -1, 1, -0.6, 0.6, -0.3, 0];
// Offsets are fractions of fxUnit(stage), the shorter stage side (stage.ts), so pixel constants are written against the
// 1080 reference and keep their size relative to the screen on any stage size.
const SHAKE_PX = 8 / 1080; // the amplitude of `shake <char>` at its default strength of 8 pixels (on a 1080 side)

/** Presets by name; `dur` is the default length in seconds (one cycle when looping). */
export const ANIMS: Record<string, Preset> = {
  breathe: { dur: 3.5, fn: t => { const s = 0.012 * (0.5 - 0.5 * Math.cos(TAU * t)); return { sy: s, sx: s * 0.4 }; } },
  bob: { dur: 1.2, fn: t => ({ dy: -0.012 * (0.5 - 0.5 * Math.cos(TAU * t)) }) },
  sway: { dur: 3, fn: t => ({ rot: 2.5 * Math.sin(TAU * t), dx: 0.004 * Math.sin(TAU * t) }) },
  nod: { dur: 0.5, fn: t => ({ dy: 0.018 * Math.sin(2 * TAU * t) * Math.sin(Math.PI * t), rot: 1.5 * Math.sin(2 * TAU * t) * Math.sin(Math.PI * t) }) },
  shiver: { dur: 0.6, fn: t => ({ dx: 0.004 * Math.sin(12 * TAU * t) }) },
  pulse: { dur: 1, fn: t => { const s = 0.05 * (0.5 - 0.5 * Math.cos(TAU * t)); return { sx: s, sy: s }; } },
  bounce: { dur: 0.8, fn: t => ({ dy: -0.07 * (1 - t) * Math.abs(Math.sin(3 * Math.PI * t)) }) },
  hop: { dur: 0.25, fn: t => ({ dy: -(HOP_PX / 1080) * Math.sin(Math.PI * EASES.out(t)) }) },
  shake: { dur: 0.3, fn: t => {
    const f = t * (SHAKE_PTS.length - 1), i = Math.min(Math.floor(f), SHAKE_PTS.length - 2);
    return { dx: SHAKE_PX * lerp(SHAKE_PTS[i], SHAKE_PTS[i + 1], f - i) };
  } },
};
export const ANIM_NAMES = Object.keys(ANIMS);

// ---- keyframe animations (a character's rig.json `animations`) ----
// `{ "dur": 1.2, "keys": [{ "t": 0.3, "rot": 8, "ease": "out" }, { "t": 0.7, "rot": -8 }] }`. A key sets the offset of the
// channels it names at progress `t` (0-1, so `animate` can stretch the animation to other lengths); each channel is
// eased between its own keys and returns to 0 at the ends unless a key says otherwise, so a loop repeats without a jump.
// Channels: `x`, `y` (fractions of the stage's shorter side, its height on a landscape stage), `scale` (added to the size: 0.05 is 5% bigger), `rot` (degrees),
// `opacity` (a factor on the alpha: 1 is as drawn, 0 is gone; unlike the others it rests at 1, so it returns to 1 at the ends).
// A key with a `part` moves that part of a layered character on its own (about its pivot, see rig.ts) instead of the body.

export const KEY_CHANNELS = ['x', 'y', 'scale', 'rot', 'opacity'] as const;
export type KeyChannel = typeof KEY_CHANNELS[number];
/** The value a channel has with no key: 0 for the offsets, 1 for opacity. */
export const CHANNEL_REST: Record<KeyChannel, number> = { x: 0, y: 0, scale: 0, rot: 0, opacity: 1 };
/**
 * A key also carries the colors a script `transform` can set (not rig.json keys, and not in the studio's lanes): `tint` (`#rrggbb`, the
 * sprite multiplied by it; rests at white) and `flash` (0-1 of the way to `flashColor`, white when absent; rests at 0).
 */
export type KeyDef = { t: number; ease?: string; part?: string; tint?: string; flash?: number; flashColor?: string } & Partial<Record<KeyChannel, number>>;
/** A key of a parameter track: the parameter's value `v` at progress `t` (0-1), eased into from the key before it: along `bezier` when it has one, else the named `ease`. */
export interface ParamKey { t: number; v: number; ease?: string; bezier?: Bezier }
/** Parameter tracks by parameter id (`animations.<name>.params`). */
export type ParamTracks = Record<string, ParamKey[]>;
/** `physicsOff`: while the animation plays, the rig's physics chains are bypassed (all of them for true, or the listed chain ids). */
export interface AnimDef { dur?: number; keys: KeyDef[]; params?: ParamTracks; frames?: FrameTrackDef[]; physicsOff?: boolean | string[]; auto?: AutoDef }


/** A value over progress: eased between its keys from `rest` at 0, and back to `rest` after the last key; `mix` blends two values. */
function timeline(keys: { t: number; v: number; ease?: string }[], rest: number, mix: (a: number, b: number, k: number) => number, t: number): number {
  const pts = keys.filter(k => Number.isFinite(k.t)).sort((a, b) => a.t - b.t);
  let prevT = 0, prevV = rest;
  for (const p of pts) {
    const pt = clamp01(p.t);
    if (t <= pt) return pt === prevT ? p.v : mix(prevV, p.v, easing(p.ease)((t - prevT) / (pt - prevT)));
    prevT = pt; prevV = p.v;
  }
  return prevT >= 1 ? prevV : mix(prevV, rest, easing(undefined)((t - prevT) / (1 - prevT)));
}

/** One channel of `keys` at progress `t`. */
function channelAt(keys: KeyDef[], ch: KeyChannel, t: number): number {
  return timeline(keys.filter(k => Number.isFinite(k[ch])).map(k => ({ t: k.t, v: k[ch]!, ease: k.ease })), CHANNEL_REST[ch], lerp, t);
}

/** The offset of all channels of `keys` at progress `t`. */
function keysAt(keys: KeyDef[], t: number): Partial<Offset> {
  const scale = channelAt(keys, 'scale', t), o: Partial<Offset> = { dx: channelAt(keys, 'x', t), dy: channelAt(keys, 'y', t), sx: scale, sy: scale, rot: channelAt(keys, 'rot', t) };
  if (keys.some(k => Number.isFinite(k.opacity))) o.opacity = Math.max(0, channelAt(keys, 'opacity', t)); // only an animation that keys it touches the alpha
  if (keys.some(k => typeof k.tint === 'string')) {
    const pts = keys.filter(k => typeof k.tint === 'string').map(k => ({ t: k.t, v: rgbNumber(k.tint), ease: k.ease }));
    o.tint = Math.round(timeline(pts, WHITE, lerpRgb, t));
  }
  if (keys.some(k => Number.isFinite(k.flash))) {
    const fk = keys.filter(k => Number.isFinite(k.flash));
    const amount = Math.max(0, Math.min(1, timeline(fk.map(k => ({ t: k.t, v: k.flash!, ease: k.ease })), 0, lerp, t)));
    // The color is the one of the first key at or after `t` (the one being reached), else the last one.
    const sorted = [...fk].sort((a, b) => a.t - b.t), at = sorted.find(k => k.t >= t) ?? sorted[sorted.length - 1];
    o.flash = { color: rgbNumber(at.flashColor), amount };
  }
  return o;
}

/** A keyframe animation's body keys (the ones without a `part`) as a function of progress. */
export function keyframeFn(def: AnimDef): (t: number) => Partial<Offset> {
  const body = (def.keys ?? []).filter(k => k.part === undefined);
  return t => keysAt(body, clamp01(t));
}

/** The keys that name a `part`, as a function of progress giving each part's offset; null when there are none. */
export function keyframeParts(def: AnimDef): ((t: number) => Record<string, Partial<Offset>>) | null {
  const byPart = new Map<string, KeyDef[]>();
  for (const k of def.keys ?? []) if (typeof k.part === 'string') byPart.set(k.part, [...(byPart.get(k.part) ?? []), k]);
  if (!byPart.size) return null;
  return t => Object.fromEntries([...byPart].map(([part, keys]) => [part, keysAt(keys, clamp01(t))]));
}

/** The curve a key is reached along: its Bezier, else its named ease. */
const keyEase = (k: ParamKey): EaseFn => (isBezier(k.bezier) ? bezierEase(k.bezier) : easing(k.ease));

/**
 * A parameter track at progress `t`: an absolute value (not an offset), held at the first key before it and at the last after it,
 * eased between keys by the ease of the key being reached. No keys gives null.
 */
export function trackAt(keys: ParamKey[], t: number): number | null {
  const pts = keys.filter(k => Number.isFinite(k.t) && Number.isFinite(k.v)).sort((a, b) => a.t - b.t);
  if (!pts.length) return null;
  if (t <= pts[0].t) return pts[0].v;
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i].t) return pts[i].t === pts[i - 1].t ? pts[i].v : lerp(pts[i - 1].v, pts[i].v, keyEase(pts[i])((t - pts[i - 1].t) / (pts[i].t - pts[i - 1].t)));
  }
  return pts[pts.length - 1].v;
}

/** Every track of `tracks` at progress `t`, by parameter id. */
export function tracksAt(tracks: ParamTracks, t: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, keys] of Object.entries(tracks)) {
    const v = Array.isArray(keys) ? trackAt(keys, clamp01(t)) : null;
    if (v !== null) out[id] = v;
  }
  return out;
}

/** An animation: its default length, the body's motion, for keyframes with `part`s the parts' motion, and for ones with `params` the parameter values it sets. */
export interface Resolved { dur: number; fn: (t: number) => Partial<Offset>; parts?: (t: number) => Record<string, Partial<Offset>>; params?: (t: number) => Record<string, number>; frames?: (t: number, seconds: number) => Record<string, string>; physicsOff?: boolean | string[] }

/** What a name stands for: the character's own keyframe animation (it beats a preset of the same name), else a preset. */
export function resolveAnim(name: string, custom?: Record<string, AnimDef>): Resolved | null {
  const def = custom && Object.hasOwn(custom, name) ? custom[name] : null;
  if (def && Array.isArray(def.keys)) {
    const tracks = def.params && Object.keys(def.params).length ? def.params : null, frames = frameTracks(def.frames);
    return { dur: def.dur !== undefined && def.dur > 0 ? def.dur : 1, fn: keyframeFn(def), parts: keyframeParts(def) ?? undefined, params: tracks ? t => tracksAt(tracks, t) : undefined, frames: frames.length ? (t, seconds) => framesAt(frames, t, seconds) : undefined, physicsOff: def.physicsOff };
  }
  return Object.hasOwn(ANIMS, name) ? ANIMS[name] : null;
}

/** The offset of animation `name` at progress `t` (0-1), `strength` times its usual size. */
export function animOffset(name: string, t: number, strength = 1, custom?: Record<string, AnimDef>): Offset {
  const a = resolveAnim(name, custom);
  return a ? scaleOffset(a.fn(clamp01(t)), strength) : NO_OFFSET;
}

/** Offsets from an animation's function (missing channels are 0), times `strength`. */
export function scaleOffset(o: Partial<Offset>, strength: number): Offset {
  const scaled: Offset = { dx: (o.dx ?? 0) * strength, dy: (o.dy ?? 0) * strength, sx: (o.sx ?? 0) * strength, sy: (o.sy ?? 0) * strength, rot: (o.rot ?? 0) * strength };
  if (o.opacity !== undefined) scaled.opacity = Math.max(0, 1 + (o.opacity - 1) * strength); // strength fades the fade
  if (o.tint !== undefined) scaled.tint = lerpRgb(WHITE, o.tint, Math.min(1, strength));
  if (o.flash) scaled.flash = { color: o.flash.color, amount: Math.min(1, o.flash.amount * strength) };
  return scaled;
}
