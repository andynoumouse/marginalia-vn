// Animation math shared by the parser, the editor and the renderer: easing curves and interpolation.
// Pure functions, no DOM.

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

/** The curve named `name`; an unknown name gives the default curve. */
export function easing(name: string | undefined): EaseFn {
  return (name !== undefined && Object.hasOwn(EASES, name) ? EASES[name] : EASES[DEFAULT_EASE]);
}

/** `from` to `to` at progress `k` (0-1, already eased; may overshoot). */
export const lerp = (from: number, to: number, k: number) => from + (to - from) * k;

// ---- named animations (`animate <char> <name>`) ----
// An animation is a function of progress t (0-1) giving a small offset on top of where the sprite stands. Every one
// starts and ends at no offset, so a loop repeats without a jump and a one-shot leaves the sprite where it was.

/** How an animation moves a sprite: `dx`/`dy` as fractions of the stage's shorter side (fxUnit), `sx`/`sy` added to the scale, `rot` in degrees. */
export interface Offset { dx: number; dy: number; sx: number; sy: number; rot: number }
export const NO_OFFSET: Offset = { dx: 0, dy: 0, sx: 0, sy: 0, rot: 0 };
export const addOffset = (a: Offset, b: Offset): Offset =>
  ({ dx: a.dx + b.dx, dy: a.dy + b.dy, sx: a.sx + b.sx, sy: a.sy + b.sy, rot: a.rot + b.rot });

/** A looping animation on a sprite (`animate <char> <name> loop`); `dur` is the length of one cycle in seconds (null: the animation's own). */
export interface SpriteAnim { name: string; dur: number | null; strength: number; part: string | null }

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
// Channels: `x`, `y` (fractions of the stage's shorter side, its height on a landscape stage), `scale` (added to the size: 0.05 is 5% bigger), `rot` (degrees).
// A key with a `part` moves that part of a layered character on its own (about its pivot, see rig.ts) instead of the body.

export const KEY_CHANNELS = ['x', 'y', 'scale', 'rot'] as const;
export type KeyChannel = typeof KEY_CHANNELS[number];
export type KeyDef = { t: number; ease?: string; part?: string } & Partial<Record<KeyChannel, number>>;
export interface AnimDef { dur?: number; keys: KeyDef[] }

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/** One channel of `keys` at progress `t`. */
function channelAt(keys: KeyDef[], ch: KeyChannel, t: number): number {
  const pts = keys.filter(k => Number.isFinite(k[ch]) && Number.isFinite(k.t)).sort((a, b) => a.t - b.t);
  let prevT = 0, prevV = 0;
  for (const p of pts) {
    const pt = clamp01(p.t);
    if (t <= pt) return pt === prevT ? p[ch]! : lerp(prevV, p[ch]!, easing(p.ease)((t - prevT) / (pt - prevT)));
    prevT = pt; prevV = p[ch]!;
  }
  return prevT >= 1 ? prevV : lerp(prevV, 0, easing(undefined)((t - prevT) / (1 - prevT)));
}

/** The offset of all channels of `keys` at progress `t`. */
function keysAt(keys: KeyDef[], t: number): Partial<Offset> {
  const scale = channelAt(keys, 'scale', t);
  return { dx: channelAt(keys, 'x', t), dy: channelAt(keys, 'y', t), sx: scale, sy: scale, rot: channelAt(keys, 'rot', t) };
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

/** An animation: its default length, the body's motion and, for keyframes with `part`s, the parts' motion. */
export interface Resolved { dur: number; fn: (t: number) => Partial<Offset>; parts?: (t: number) => Record<string, Partial<Offset>> }

/** What a name stands for: the character's own keyframe animation (it beats a preset of the same name), else a preset. */
export function resolveAnim(name: string, custom?: Record<string, AnimDef>): Resolved | null {
  const def = custom && Object.hasOwn(custom, name) ? custom[name] : null;
  if (def && Array.isArray(def.keys)) return { dur: def.dur !== undefined && def.dur > 0 ? def.dur : 1, fn: keyframeFn(def), parts: keyframeParts(def) ?? undefined };
  return Object.hasOwn(ANIMS, name) ? ANIMS[name] : null;
}

/** The offset of animation `name` at progress `t` (0-1), `strength` times its usual size. */
export function animOffset(name: string, t: number, strength = 1, custom?: Record<string, AnimDef>): Offset {
  const a = resolveAnim(name, custom);
  return a ? scaleOffset(a.fn(clamp01(t)), strength) : NO_OFFSET;
}

/** Offsets from an animation's function (missing channels are 0), times `strength`. */
export function scaleOffset(o: Partial<Offset>, strength: number): Offset {
  return { dx: (o.dx ?? 0) * strength, dy: (o.dy ?? 0) * strength, sx: (o.sx ?? 0) * strength, sy: (o.sy ?? 0) * strength, rot: (o.rot ?? 0) * strength };
}
