// Editing mesh-warp deformers (rig.json `deformers`, docs/design/mesh-warp.md): the pure half of the animation studio's Warp
// section. Nothing here draws or touches the DOM; the studio feeds it pointer deltas and button presses and keeps the result
// as its working copy.
//
// The studio edits one parameter's keyform at a time (`param` + `keys`, the 1D form): the parameter's slider value selects
// where on that keyform a change lands. A displacement is in stage fractions (see evalDeformer), added to the lattice's rest
// position; `pts` is sparse, so only points that moved are stored and a key that moved nothing is just `{ at }`.

import {
  DEFORMER_DEFAULT_GRID, DEFORMER_MAX_GRID, deformerGrid, deformerPoints, segment,
  type DeformerDef, type DeformerKeyform, type ParamDef, type WarpPoints,
} from './params.js';

export type WarpVec = [number, number];
/** The size of a part's image box in stage units (pixels over `fxUnit`), the unit displacements are in. */
export interface PartBox { w: number; h: number }

/** A slider value this close (as a fraction of the parameter's range) to a key edits that key; farther away it makes a new one. */
export const WARP_KEY_SNAP = 0.02;
const EPS = 1e-9;
const DECIMALS = 1e5;
/** Stored displacements are kept to 5 decimals (a hundredth of a pixel on a 1080 px stage); `+ 0` turns -0 into 0. */
const clean = (n: number): number => Math.round(n * DECIMALS) / DECIMALS + 0;

/** Sparse points as a dense interleaved [dx, dy, ...] list of `n` points. */
function dense(pts: WarpPoints | undefined, n: number): number[] {
  const out = new Array<number>(n * 2).fill(0);
  for (const [k, p] of Object.entries(pts ?? {})) {
    const i = Number(k);
    if (Number.isInteger(i) && i >= 0 && i < n && Array.isArray(p)) { out[i * 2] = p[0] ?? 0; out[i * 2 + 1] = p[1] ?? 0; }
  }
  return out;
}
/** The points of a dense list that moved; undefined when none did. */
function sparse(v: ArrayLike<number>): WarpPoints | undefined {
  const pts: WarpPoints = {};
  for (let i = 0; i < v.length / 2; i++) {
    const dx = clean(v[i * 2]), dy = clean(v[i * 2 + 1]);
    if (dx !== 0 || dy !== 0) pts[String(i)] = [dx, dy];
  }
  return Object.keys(pts).length ? pts : undefined;
}
const keyOf = (at: number, pts: WarpPoints | undefined): { at: number; pts?: WarpPoints } => (pts ? { at, pts } : { at });
const clampTo = (p: ParamDef, v: number): number => Math.min(p.max, Math.max(p.min, Number.isFinite(v) ? v : p.default));
const clampGrid = (n: number): number => Math.min(DEFORMER_MAX_GRID, Math.max(1, Math.round(Number.isFinite(n) ? n : 1)));

/** Index of the first one-parameter keyform of `param` on `def`, -1 for none. This is the one the studio edits. */
const formIndex = (def: DeformerDef, param: string): number => (def.keyforms ?? []).findIndex(k => k.param === param && Array.isArray(k.keys));

/** The dense displacement a one-parameter keyform adds at `v`. */
function keyformAt(kf: DeformerKeyform, n: number, v: number): number[] {
  const keys = [...(kf.keys ?? [])].sort((a, b) => a.at - b.at);
  if (!keys.length) return new Array<number>(n * 2).fill(0);
  if (keys.length === 1) return dense(keys[0].pts, n);
  const [i, t] = segment(keys.map(k => k.at), v);
  const a = dense(keys[i].pts, n), b = dense(keys[i + 1].pts, n);
  return a.map((x, k) => x + (b[k] - x) * t);
}

/** What the keyform of `param` alone adds to every point when the parameter is at `value`, interleaved [dx, dy, ...]. Zeros without a keyform. */
export function ownDisplacement(def: DeformerDef, param: ParamDef, value: number): number[] {
  const n = deformerPoints(def), i = formIndex(def, param.id);
  return i < 0 ? new Array<number>(n * 2).fill(0) : keyformAt(def.keyforms[i], n, clampTo(param, value));
}

/** The values the keyform of `param` has keys at, ascending. */
export function warpKeyValues(def: DeformerDef, param: string): number[] {
  const i = formIndex(def, param);
  return i < 0 ? [] : def.keyforms[i].keys!.map(k => k.at).sort((a, b) => a - b);
}

/** The value of the key `value` selects (within WARP_KEY_SNAP of the range), or null: a change there would make a new key. */
export function warpKeyAt(def: DeformerDef, param: ParamDef, value: number): number | null {
  const tol = WARP_KEY_SNAP * (param.max - param.min);
  let best: number | null = null;
  for (const at of warpKeyValues(def, param.id)) if (Math.abs(at - value) <= tol && (best === null || Math.abs(at - value) < Math.abs(best - value))) best = at;
  return best;
}

/**
 * Sets what the keyform of `param` adds to the given points at `value` to the given `[dx, dy]`, and returns the new deformer
 * (the same object when nothing would change). A key within WARP_KEY_SNAP of `value` takes the change (solved so the point
 * lands exactly on the new value at `value`, not only at the key); with none near, a key is inserted at `value` first, holding
 * what the keyform gave there, so the curve elsewhere stays as it was. A keyform's first key comes with an empty key at the
 * parameter's default, so the shape eases in from rest instead of holding everywhere.
 */
export function setWarpOwn(def: DeformerDef, param: ParamDef, value: number, edits: readonly (readonly [number, WarpVec])[]): DeformerDef {
  const n = deformerPoints(def), v = clampTo(param, value), own = ownDisplacement(def, param, v);
  const todo = edits.filter(([p, d]) => Number.isInteger(p) && p >= 0 && p < n && (Math.abs(own[p * 2] - d[0]) > EPS || Math.abs(own[p * 2 + 1] - d[1]) > EPS));
  if (!todo.length) return def;
  const next = structuredClone(def);
  next.keyforms ??= [];
  let k = formIndex(next, param.id);
  if (k < 0) { k = next.keyforms.length; next.keyforms.push({ param: param.id, keys: [] }); }
  const kf = next.keyforms[k], keys = kf.keys!, tol = WARP_KEY_SNAP * (param.max - param.min);
  keys.sort((a, b) => a.at - b.at);
  if (!keys.length && Math.abs(param.default - v) > tol) keys.push({ at: param.default });
  let j = -1;
  keys.forEach((key, i) => { if (Math.abs(key.at - v) <= tol && (j < 0 || Math.abs(key.at - v) < Math.abs(keys[j].at - v))) j = i; });
  // `w` is how much the key at `j` counts at `v`; the rest comes from its neighbour `nb` on the side `v` lies on (a value past the last key holds it).
  let w = 1, nb = -1;
  if (j >= 0 && keys[j].at !== v) {
    const side = v > keys[j].at ? j + 1 : j - 1;
    if (keys[side]) {
      w = 1 - Math.abs(v - keys[j].at) / Math.abs(keys[side].at - keys[j].at);
      if (w < 0.5) j = -1; else nb = side;
    }
  }
  if (j < 0) {
    const at = keys.findIndex(key => key.at > v);
    j = at < 0 ? keys.length : at;
    keys.splice(j, 0, keyOf(v, sparse(keyformAt(kf, n, v))));
    w = 1; nb = -1;
  }
  const key = keys[j], pts: WarpPoints = key.pts ?? {}, other = nb >= 0 ? dense(keys[nb].pts, n) : null;
  for (const [p, d] of todo) {
    const to: WarpVec = [0, 1].map(c => clean(other ? (d[c] - (1 - w) * other[p * 2 + c]) / w : d[c])) as WarpVec;
    if (to[0] === 0 && to[1] === 0) delete pts[String(p)]; else pts[String(p)] = to;
  }
  if (Object.keys(pts).length) key.pts = pts; else delete key.pts;
  return next;
}

/** The pointer moved lattice point `point` by `delta` (stage fractions, in the part's own space): the drag-to-keyform write. */
export function dragWarpPoint(def: DeformerDef, param: ParamDef, value: number, point: number, delta: WarpVec): DeformerDef {
  const own = ownDisplacement(def, param, value);
  if (!(point >= 0) || point * 2 + 1 >= own.length) return def;
  return setWarpOwn(def, param, value, [[point, [own[point * 2] + delta[0], own[point * 2 + 1] + delta[1]]]]);
}

/** The point goes back to rest in the keyform at `value`. */
export const resetWarpPoint = (def: DeformerDef, param: ParamDef, value: number, point: number): DeformerDef => setWarpOwn(def, param, value, [[point, [0, 0]]]);

/** Removes the key `value` selects; the keyform goes with its last key. */
export function deleteWarpKey(def: DeformerDef, param: ParamDef, value: number): DeformerDef {
  const at = warpKeyAt(def, param, value), i = formIndex(def, param.id);
  if (at === null || i < 0) return def;
  const next = structuredClone(def), kf = next.keyforms[i];
  kf.keys = kf.keys!.filter(k => k.at !== at);
  if (!kf.keys.length) next.keyforms.splice(i, 1);
  return next;
}

/**
 * Copies the keyform at `value` across the vertical axis of the lattice: `from` the left half to the right (or back), the
 * displacement of a mirrored point flipped in x. Points on the axis cannot move sideways in a symmetric shape, so their dx goes to 0.
 */
export function mirrorWarp(def: DeformerDef, param: ParamDef, value: number, from: 'left' | 'right'): DeformerDef {
  const [cols, rows] = deformerGrid(def), own = ownDisplacement(def, param, value), edits: [number, WarpVec][] = [];
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
    const p = j * (cols + 1) + i, q = j * (cols + 1) + (cols - i);
    if (i * 2 === cols) edits.push([p, [0, own[p * 2 + 1]]]);
    else if (from === 'left' ? i * 2 > cols : i * 2 < cols) edits.push([p, [-own[q * 2], own[q * 2 + 1]]]);
  }
  return setWarpOwn(def, param, value, edits);
}

/** Moves every point of the keyform at `value` `amount` (0-1) of the way to the average of its neighbours, evening out kinks. */
export function smoothWarp(def: DeformerDef, param: ParamDef, value: number, amount = 0.5): DeformerDef {
  const [cols, rows] = deformerGrid(def), own = ownDisplacement(def, param, value), edits: [number, WarpVec][] = [];
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
    const p = j * (cols + 1) + i, around = [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]].filter(([x, y]) => x >= 0 && x <= cols && y >= 0 && y <= rows).map(([x, y]) => y * (cols + 1) + x);
    const avg = [0, 1].map(c => around.reduce((s, q) => s + own[q * 2 + c], 0) / around.length);
    edits.push([p, [own[p * 2] + (avg[0] - own[p * 2]) * amount, own[p * 2 + 1] + (avg[1] - own[p * 2 + 1]) * amount]]);
  }
  return setWarpOwn(def, param, value, edits);
}

// ---- the deformers of a rig ----

/** The deformer on `part`, if it has one. */
export const deformerOf = (deformers: readonly DeformerDef[] | undefined, part: string): DeformerDef | undefined => (deformers ?? []).find(d => d.part === part);

/** `deformers` with a new one on `part` (default grid, no keyforms), named after the part. A part that has one already is left alone. */
export function addDeformer(deformers: readonly DeformerDef[], part: string, grid: readonly [number, number] = DEFORMER_DEFAULT_GRID): DeformerDef[] {
  if (deformerOf(deformers, part)) return [...deformers];
  const taken = new Set(deformers.map(d => d.id));
  let id = `${part}_warp`;
  for (let i = 2; taken.has(id); i++) id = `${part}_warp${i}`;
  return [...deformers, { id, part, grid: [clampGrid(grid[0]), clampGrid(grid[1])], keyforms: [] }];
}

/** `deformers` without the one on `part`. */
export const removeDeformer = (deformers: readonly DeformerDef[], part: string): DeformerDef[] => deformers.filter(d => d.part !== part);

/** `deformers` with `def` in place of the one with its id. */
export const replaceDeformer = (deformers: readonly DeformerDef[], def: DeformerDef): DeformerDef[] => deformers.map(d => (d.id === def.id ? def : d));

/**
 * The deformer on a lattice of `grid` cells. The points move to their new places by sampling the old displacement field
 * (bilinear), so a shape authored on 4x4 survives a change to 6x6 or 2x2 as well as a coarser or finer lattice can hold it.
 */
export function resizeWarp(def: DeformerDef, grid: readonly [number, number]): DeformerDef {
  const [c0, r0] = deformerGrid(def), c1 = clampGrid(grid[0]), r1 = clampGrid(grid[1]);
  if (c0 === c1 && r0 === r1) return def;
  const n0 = (c0 + 1) * (r0 + 1), n1 = (c1 + 1) * (r1 + 1);
  const sample = (src: number[], u: number, v: number): WarpVec => {
    const x = u * c0, y = v * r0, i = Math.min(Math.floor(x), c0 - 1), j = Math.min(Math.floor(y), r0 - 1), fx = x - i, fy = y - j;
    const at = (a: number, b: number, c: number) => src[(b * (c0 + 1) + a) * 2 + c];
    const blend = (c: number) => (at(i, j, c) * (1 - fx) + at(i + 1, j, c) * fx) * (1 - fy) + (at(i, j + 1, c) * (1 - fx) + at(i + 1, j + 1, c) * fx) * fy;
    return [blend(0), blend(1)];
  };
  const resample = (pts: WarpPoints | undefined): WarpPoints | undefined => {
    const old = dense(pts, n0), out = new Array<number>(n1 * 2).fill(0);
    for (let j = 0; j <= r1; j++) for (let i = 0; i <= c1; i++) { const [dx, dy] = sample(old, i / c1, j / r1); out[(j * (c1 + 1) + i) * 2] = dx; out[(j * (c1 + 1) + i) * 2 + 1] = dy; }
    return sparse(out);
  };
  const next = structuredClone(def);
  next.grid = [c1, r1];
  for (const kf of next.keyforms ?? []) for (const form of [...(kf.keys ?? []), ...(kf.forms ?? [])] as { pts?: WarpPoints }[]) {
    const pts = resample(form.pts);
    if (pts) form.pts = pts; else delete form.pts;
  }
  return next;
}

// ---- presets ----

/** Shapes the Warp section can write as explicit keys; there is no preset type at run time. */
export type WarpPreset = 'sway' | 'breathe' | 'sine' | 'noise';
export interface WarpPresetOptions {
  /** Size of the effect: a fraction of the part's width (sway, sine, noise) or the scale gained (breathe). */
  amount?: number;
  /** Breathe: the point the part grows from, as a fraction of its box from the top left. */
  pivot?: WarpVec;
  /** Sine: waves from the top of the part to its bottom. */
  waves?: number;
  /** Noise: the same seed gives the same shape. */
  seed?: number;
}
export const WARP_PRESETS: { id: WarpPreset; label: string; amount: number; hint: string }[] = [
  { id: 'sway', label: 'Sway', amount: 0.08, hint: 'Bends sideways about the top edge: the bottom moves most. Amount is the share of the part\'s width.' },
  { id: 'breathe', label: 'Breathe', amount: 0.03, hint: 'Scales the part about a pivot (bottom middle). Amount is the scale gained.' },
  { id: 'sine', label: 'Sine', amount: 0.04, hint: 'A sideways wave down the part, the top fixed. Amount is the share of the part\'s width.' },
  { id: 'noise', label: 'Noise', amount: 0.03, hint: 'Random but repeatable jitter of every point. Amount is the share of the part\'s width.' },
];

/** A small seeded generator (mulberry32), so a preset written twice with one seed is the same shape. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** The displacement every point gets at the far end of the parameter (dense). */
function pattern(kind: WarpPreset, cols: number, rows: number, box: PartBox, o: WarpPresetOptions): number[] {
  const out: number[] = [], amount = o.amount ?? WARP_PRESETS.find(p => p.id === kind)!.amount, rand = random(o.seed ?? 1);
  const [px, py] = o.pivot ?? [0.5, 1];
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
    const u = i / cols, v = j / rows;
    if (kind === 'sway') out.push(amount * box.w * v * v, 0);
    else if (kind === 'breathe') out.push((u - px) * box.w * amount, (v - py) * box.h * amount);
    else if (kind === 'sine') out.push(amount * box.w * Math.sin(2 * Math.PI * (o.waves ?? 1) * v), 0);
    else out.push((rand() * 2 - 1) * amount * box.w, (rand() * 2 - 1) * amount * box.w);
  }
  return out;
}

/**
 * Writes `kind` as the keyform of `param` on the deformer, replacing that parameter's keys: an empty key at the default, the
 * shape at the far end above it and, when the range reaches below the default, the opposite shape at the far end below. Other
 * parameters' keyforms stay. `box` is the part's image size in stage units.
 */
export function warpPreset(def: DeformerDef, param: ParamDef, kind: WarpPreset, box: PartBox, options: WarpPresetOptions = {}): DeformerDef {
  const [cols, rows] = deformerGrid(def), shape = pattern(kind, cols, rows, box, options);
  const keys: { at: number; pts?: WarpPoints }[] = [];
  if (param.min < param.default) keys.push(keyOf(param.min, sparse(shape.map(x => -x))));
  keys.push({ at: param.default });
  if (param.max > param.default) keys.push(keyOf(param.max, sparse(shape)));
  const next = structuredClone(def), i = formIndex(next, param.id);
  next.keyforms ??= [];
  if (i < 0) next.keyforms.push({ param: param.id, keys }); else next.keyforms[i].keys = keys;
  return next;
}
