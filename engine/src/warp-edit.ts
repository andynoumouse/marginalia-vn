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
import { meshGraphDistance } from './mesh.js';
import { boneSubtree, type Bones, type PartBones } from './anim-edit.js';
import { clampParam } from './params.js';
import { round5 } from './util.js';

export type WarpVec = [number, number];
/** The size of a part's image box in stage units (pixels over `fxUnit`), the unit displacements are in. */
export interface PartBox { w: number; h: number }

/** A slider value this close (as a fraction of the parameter's range) to a key edits that key; farther away it makes a new one. */
export const WARP_KEY_SNAP = 0.02;
const EPS = 1e-9;

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
    const dx = round5(v[i * 2]), dy = round5(v[i * 2 + 1]);
    if (dx !== 0 || dy !== 0) pts[String(i)] = [dx, dy];
  }
  return Object.keys(pts).length ? pts : undefined;
}
const keyOf = (at: number, pts: WarpPoints | undefined): { at: number; pts?: WarpPoints } => (pts ? { at, pts } : { at });
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
  return i < 0 ? new Array<number>(n * 2).fill(0) : keyformAt(def.keyforms[i], n, clampParam(param, value));
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
  const n = deformerPoints(def), v = clampParam(param, value), own = ownDisplacement(def, param, v);
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
    const to: WarpVec = [0, 1].map(c => round5(other ? (d[c] - (1 - w) * other[p * 2 + c]) / w : d[c])) as WarpVec;
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
 * Adds a key at `value` holding the shape the keyform gives there, so the curve stays as it is (Keyforms' Add key). The same deformer when a key
 * is there already; a parameter with no keyform yet gets rest at its default and, away from it, a second key at rest.
 */
export function addWarpKey(def: DeformerDef, param: ParamDef, value: number): DeformerDef {
  if (warpKeyAt(def, param, value) !== null) return def;
  const n = deformerPoints(def), v = clampParam(param, value), next = structuredClone(def);
  next.keyforms ??= [];
  let k = formIndex(next, param.id);
  if (k < 0) { k = next.keyforms.length; next.keyforms.push({ param: param.id, keys: [] }); }
  const kf = next.keyforms[k], keys = kf.keys!;
  keys.sort((a, b) => a.at - b.at);
  if (!keys.length && Math.abs(param.default - v) > WARP_KEY_SNAP * (param.max - param.min)) keys.push({ at: param.default });
  const at = keys.findIndex(key => key.at > v);
  keys.splice(at < 0 ? keys.length : at, 0, keyOf(v, sparse(keyformAt(kf, n, v))));
  return next;
}

/**
 * Writes a copied keyform shape (`disp`, every point's [dx, dy] interleaved, as ownDisplacement gives it) at `value`: the key there takes it, or
 * a new one is made (setWarpOwn). `mirrored` flips it sideways on a lattice (column c takes column cols - c, dx changes sign). The same deformer
 * when the point counts differ, when a mesh is asked to mirror (its vertices have no fixed partners), or when nothing would change.
 */
export function pasteWarpForm(def: DeformerDef, param: ParamDef, value: number, disp: readonly number[], mirrored = false): DeformerDef {
  const n = deformerPoints(def);
  if (disp.length !== n * 2 || (mirrored && def.mesh)) return def;
  const cols = mirrored ? deformerGrid(def)[0] + 1 : 0;
  const from = (p: number) => (mirrored ? Math.floor(p / cols) * cols + (cols - 1 - (p % cols)) : p);
  return setWarpOwn(def, param, value, Array.from({ length: n }, (_, p) => [p, [(mirrored ? -1 : 1) * disp[from(p) * 2], disp[from(p) * 2 + 1]]] as const));
}

/**
 * Copies the keyform at `value` across the vertical axis of the lattice: `from` the left half to the right (or back), the
 * displacement of a mirrored point flipped in x. Points on the axis cannot move sideways in a symmetric shape, so their dx goes to 0.
 */
export function mirrorWarp(def: DeformerDef, param: ParamDef, value: number, from: 'left' | 'right', only?: readonly number[]): DeformerDef {
  const [cols] = deformerGrid(def), w = cols + 1, col = (p: number) => p % w;
  const partner = (p: number) => p - col(p) + (cols - col(p));
  return mirrorPoints(def, param, value, deformerPoints(def), partner, p => (from === 'left' ? col(p) * 2 > cols : col(p) * 2 < cols), only).def;
}

/** Moves every point of the keyform at `value` `amount` (0-1) of the way to the average of its neighbours, evening out kinks; with `only`, just those points move. */
export function smoothWarp(def: DeformerDef, param: ParamDef, value: number, amount = 0.5, only?: readonly number[]): DeformerDef {
  const [cols, rows] = deformerGrid(def), w = cols + 1;
  const neighbours = (p: number) => {
    const i = p % w, j = Math.floor(p / w);
    return [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]].filter(([x, y]) => x >= 0 && x <= cols && y >= 0 && y <= rows).map(([x, y]) => y * w + x);
  };
  return smoothPoints(def, param, value, deformerPoints(def), neighbours, amount, only);
}

// ---- point tools on either kind of deformer: a lattice's grid points or a free mesh's vertices (mesh-edit.ts) ----

/**
 * Copies the keyform at `value` across the vertical middle. `partner(p)` is the point mirroring `p` (`p` itself on the middle, -1 for
 * none) and `overwritten(p)` whether `p` lies on the half that takes the copy. With `only`, those points are the source and land on their
 * partners. A point on the middle just loses its sideways move. `unpaired` lists the points that should have changed but have no partner.
 */
export function mirrorPoints(
  def: DeformerDef, param: ParamDef, value: number, n: number, partner: (p: number) => number, overwritten: (p: number) => boolean, only?: readonly number[],
): { def: DeformerDef; unpaired: number[] } {
  const own = ownDisplacement(def, param, value), edits: [number, WarpVec][] = [], unpaired: number[] = [];
  for (const p of only ? cleanSelection(only, n) : Array.from({ length: n }, (_, i) => i)) {
    const q = partner(p);
    if (!only && q !== p && !overwritten(p)) continue; // the source half stays
    if (q < 0) unpaired.push(p);
    else if (q === p) edits.push([p, [0, own[p * 2 + 1]]]);
    else if (only) edits.push([q, [-own[p * 2], own[p * 2 + 1]]]);
    else edits.push([p, [-own[q * 2], own[q * 2 + 1]]]);
  }
  return { def: setWarpOwn(def, param, value, edits), unpaired };
}

/** Moves each point (with `only`, just those) `amount` (0-1) of the way to the average of its `neighbours`; a point with none stays. */
export function smoothPoints(def: DeformerDef, param: ParamDef, value: number, n: number, neighbours: (p: number) => readonly number[], amount: number, only?: readonly number[]): DeformerDef {
  const own = ownDisplacement(def, param, value), edits: [number, WarpVec][] = [];
  for (const p of only ? cleanSelection(only, n) : Array.from({ length: n }, (_, i) => i)) {
    const around = neighbours(p);
    if (!around.length) continue;
    const avg = [0, 1].map(c => around.reduce((s, q) => s + own[q * 2 + c], 0) / around.length);
    edits.push([p, [own[p * 2] + (avg[0] - own[p * 2]) * amount, own[p * 2 + 1] + (avg[1] - own[p * 2 + 1]) * amount]]);
  }
  return setWarpOwn(def, param, value, edits);
}

/**
 * Scales and rotates the chosen points about the centre of where they sit now (`about` 'selection') or of the part's box (`box`, in
 * stage units). `rest(p)` is a point's rest position in the same units, so the rotation does not shear.
 */
export function transformPoints(
  def: DeformerDef, param: ParamDef, value: number, points: readonly number[], n: number, rest: (p: number) => WarpVec, box: { w: number; h: number },
  by: { scale?: number | WarpVec; rotate?: number; about?: 'selection' | 'lattice' },
): DeformerDef {
  const own = ownDisplacement(def, param, value), ok = cleanSelection(points, n);
  if (!ok.length) return def;
  const [sx, sy] = typeof by.scale === 'number' ? [by.scale, by.scale] : by.scale ?? [1, 1], a = ((by.rotate ?? 0) * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
  const at = (p: number): WarpVec => { const r = rest(p); return [r[0] + own[p * 2], r[1] + own[p * 2 + 1]]; };
  const pivot: WarpVec = by.about === 'lattice' ? [box.w / 2, box.h / 2] : [0, 1].map(c => ok.reduce((s, p) => s + at(p)[c], 0) / ok.length) as WarpVec;
  return setWarpOwn(def, param, value, ok.map(p => {
    const [x, y] = at(p), dx = (x - pivot[0]) * sx, dy = (y - pivot[1]) * sy, r = rest(p);
    return [p, [pivot[0] + dx * cos - dy * sin - r[0], pivot[1] + dx * sin + dy * cos - r[1]]] as [number, WarpVec];
  }));
}

// ---- selections of points ----

/** How a soft selection fades: `linear` straight down, `smooth` an ease, `constant` full strength out to the radius. */
export type WarpCurve = 'linear' | 'smooth' | 'constant';
export const WARP_CURVES: WarpCurve[] = ['linear', 'smooth', 'constant'];
/** A soft selection's reach, in lattice cells, and its fade. A radius of 0 (or none) is a hard selection. */
export interface WarpFalloff { radius: number; curve: WarpCurve }
export const WARP_DEFAULT_FALLOFF: WarpFalloff = { radius: 1.5, curve: 'smooth' };

/** The sorted, distinct valid point indices of `points` on a lattice of `n` points. */
export const cleanSelection = (points: Iterable<number>, n: number): number[] => [...new Set(points)].filter(p => Number.isInteger(p) && p >= 0 && p < n).sort((a, b) => a - b);

/** The points of row `j` (0 at the top), or none for a row the lattice does not have. */
export function warpRow(def: Pick<DeformerDef, 'grid'>, j: number): number[] {
  const [cols, rows] = deformerGrid(def);
  return Number.isInteger(j) && j >= 0 && j <= rows ? Array.from({ length: cols + 1 }, (_, i) => j * (cols + 1) + i) : [];
}
/** The points of column `i` (0 at the left). */
export function warpColumn(def: Pick<DeformerDef, 'grid'>, i: number): number[] {
  const [cols, rows] = deformerGrid(def);
  return Number.isInteger(i) && i >= 0 && i <= cols ? Array.from({ length: rows + 1 }, (_, j) => j * (cols + 1) + i) : [];
}
/** Every point of the lattice. */
/** What the point helpers need of a deformer: a lattice's `grid`, or a free mesh's vertices and triangles. */
export type PointedDef = Pick<DeformerDef, 'grid'> & { mesh?: { verts: ArrayLike<number>; tris?: ArrayLike<number> } };
export const warpAllPoints = (def: PointedDef): number[] => Array.from({ length: deformerPoints(def) }, (_, i) => i);
/** The points `selected` leaves out. */
export const invertSelection = (def: PointedDef, selected: readonly number[]): number[] => { const s = new Set(selected); return warpAllPoints(def).filter(p => !s.has(p)); };
/** `selected` with `points` added (`add`), flipped (`toggle`) or in its place (`set`). */
export function combineSelection(selected: readonly number[], points: readonly number[], mode: 'set' | 'add' | 'toggle'): number[] {
  if (mode === 'set') return cleanSelection(points, Infinity);
  const s = new Set(selected);
  for (const p of points) { if (mode === 'toggle' && s.has(p)) s.delete(p); else s.add(p); }
  return cleanSelection(s, Infinity);
}

/** A weight 0-1 for a distance `d` cells from the selection. */
export function falloffWeight(d: number, f: WarpFalloff): number {
  if (d <= 0) return 1;
  if (!(f.radius > 0) || d >= f.radius) return 0;
  const t = 1 - d / f.radius;
  return f.curve === 'constant' ? 1 : f.curve === 'smooth' ? t * t * (3 - 2 * t) : t;
}

/**
 * How strongly each point follows an edit of `selected`: 1 for the chosen points, fading with the distance (in lattice cells) to
 * the nearest chosen one. Points the fade does not reach are left out.
 */
export function softWeights(def: PointedDef, selected: readonly number[], falloff?: WarpFalloff): Map<number, number> {
  if (def.mesh) return meshSoftWeights(deformerPoints(def), def.mesh.tris ?? [], selected, falloff);
  const [cols] = deformerGrid(def), stride = cols + 1, n = deformerPoints(def), out = new Map<number, number>();
  const chosen = cleanSelection(selected, n);
  for (const p of chosen) out.set(p, 1);
  if (!falloff || !(falloff.radius > 0)) return out;
  for (let p = 0; p < n; p++) {
    if (out.has(p)) continue;
    let d = Infinity;
    for (const s of chosen) d = Math.min(d, Math.hypot((p % stride) - (s % stride), Math.floor(p / stride) - Math.floor(s / stride)));
    const w = falloffWeight(d, falloff);
    if (w > 0) out.set(p, w);
  }
  return out;
}

/**
 * The mesh counterpart of softWeights: the fade runs over hops along the mesh's edges (the radius is in hops), so a vertex across
 * a gap in the art, or in another island, is not dragged along. `n` is the vertex count, `tris` the triangle indices.
 */
export function meshSoftWeights(n: number, tris: ArrayLike<number>, selected: readonly number[], falloff?: WarpFalloff): Map<number, number> {
  const out = new Map<number, number>(), chosen = cleanSelection(selected, n);
  for (const p of chosen) out.set(p, 1);
  if (!falloff || !(falloff.radius > 0) || !chosen.length) return out;
  const dist = meshGraphDistance(n, tris, chosen);
  for (let p = 0; p < n; p++) {
    if (out.has(p)) continue;
    const w = falloffWeight(dist[p], falloff);
    if (w > 0) out.set(p, w);
  }
  return out;
}

/** The points of the keyform at `value` move by `delta` times their weight (a drag of a selection, soft or hard). */
export function moveWarpPoints(def: DeformerDef, param: ParamDef, value: number, weights: ReadonlyMap<number, number>, delta: WarpVec): DeformerDef {
  const own = ownDisplacement(def, param, value), n = deformerPoints(def), edits: [number, WarpVec][] = [];
  for (const [p, w] of weights) if (p >= 0 && p < n) edits.push([p, [own[p * 2] + delta[0] * w, own[p * 2 + 1] + delta[1] * w]]);
  return setWarpOwn(def, param, value, edits);
}

/** The average displacement of `points` in the keyform at `value` (what the Point fields show for a selection), or null for none. */
export function averageDisplacement(def: DeformerDef, param: ParamDef, value: number, points: readonly number[]): WarpVec | null {
  const own = ownDisplacement(def, param, value), ok = cleanSelection(points, deformerPoints(def));
  return ok.length ? [0, 1].map(c => ok.reduce((s, p) => s + own[p * 2 + c], 0) / ok.length) as WarpVec : null;
}

/**
 * Scales (`scale`, per axis) and rotates (`rotate`, degrees, clockwise on screen) the chosen points of the keyform at `value`
 * about the centre of where they sit now (`about` 'selection') or of the lattice. `box` is the part's size in stage units: the
 * lattice's rest positions and the displacements have to share a unit for a rotation not to shear.
 */
export function transformWarpPoints(
  def: DeformerDef, param: ParamDef, value: number, points: readonly number[], box: PartBox,
  by: { scale?: number | WarpVec; rotate?: number; about?: 'selection' | 'lattice' },
): DeformerDef {
  const [cols, rows] = deformerGrid(def);
  const rest = (p: number): WarpVec => [((p % (cols + 1)) / cols) * box.w, (Math.floor(p / (cols + 1)) / rows) * box.h];
  return transformPoints(def, param, value, points, deformerPoints(def), rest, box, by);
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

/** Shapes the Warp tool's Presets ▾ can write as explicit keys; there is no preset type at run time. */
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
  /** A free mesh: the part image's size in pixels, which the vertices' rest positions are measured against (they give u and v). */
  pixels?: readonly [number, number];
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
function pattern(kind: WarpPreset, uvs: readonly (readonly [number, number])[], box: PartBox, o: WarpPresetOptions): number[] {
  const out: number[] = [], amount = o.amount ?? WARP_PRESETS.find(p => p.id === kind)!.amount, rand = random(o.seed ?? 1);
  const [px, py] = o.pivot ?? [0.5, 1];
  for (const [u, v] of uvs) {
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
  let uvs: [number, number][] = [];
  if (def.mesh) {
    // Each vertex's place in the part's image box, 0-1 (a vertex in the margin outside it is clamped to the edge).
    const [pw, ph] = options.pixels ?? [0, 0], v = def.mesh.verts, c = (x: number) => Math.min(1, Math.max(0, x));
    for (let i = 0; i + 1 < v.length; i += 2) uvs.push([pw > 0 ? c(v[i] / pw) : 0.5, ph > 0 ? c(v[i + 1] / ph) : 0.5]);
  } else {
    const [cols, rows] = deformerGrid(def);
    for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) uvs.push([i / cols, j / rows]);
  }
  const shape = pattern(kind, uvs, box, options);
  const keys: { at: number; pts?: WarpPoints }[] = [];
  if (param.min < param.default) keys.push(keyOf(param.min, sparse(shape.map(x => -x))));
  keys.push({ at: param.default });
  if (param.max > param.default) keys.push(keyOf(param.max, sparse(shape)));
  const next = structuredClone(def), i = formIndex(next, param.id);
  next.keyforms ??= [];
  if (i < 0) next.keyforms.push({ param: param.id, keys }); else next.keyforms[i].keys = keys;
  return next;
}

// ---- by id, and group warps (a lattice over several parts: docs/design/mesh-warp.md, "Group warps") ----

/** The deformer with this id, if any (a part warp or a group warp). */
export const deformerById = (deformers: readonly DeformerDef[] | undefined, id: string): DeformerDef | undefined => (deformers ?? []).find(d => d.id === id);

/** The group warp `part` is a member of, if any (a part is in at most one). */
export const groupOf = (deformers: readonly DeformerDef[] | undefined, part: string): DeformerDef | undefined => (deformers ?? []).find(d => Array.isArray(d.members) && d.members.includes(part));

/** The deformers that bend `part`: its own warp first, then its group's. This is what the studio's target choice lists. */
export const deformersOfPart = (deformers: readonly DeformerDef[] | undefined, part: string): DeformerDef[] => [deformerOf(deformers, part), groupOf(deformers, part)].filter((d): d is DeformerDef => !!d);

/** `deformers` without the one with this id. */
export const removeDeformerById = (deformers: readonly DeformerDef[], id: string): DeformerDef[] => deformers.filter(d => d.id !== id);

/**
 * The parts of `parts` that sit on `bone` or a bone below it, in the order `parts` lists them, then the mask `shapes` on those bones: what
 * "Add group warp from this bone" covers. (A part comes first: the first member is the one a drag is measured in.)
 */
export function membersFromBone(bones: Bones, parts: PartBones, bone: string, shapes: Readonly<Record<string, { bone?: string }>> = {}): string[] {
  const { bones: below, parts: onThem } = boneSubtree(bones, parts, bone), set = new Set(below);
  return [...onThem, ...Object.keys(shapes).filter(n => typeof shapes[n]?.bone === 'string' && set.has(shapes[n].bone!))];
}

/** `members` without repeats, in order, dropping anything that is not a non-empty string. */
const uniqueNames = (members: readonly string[]): string[] => [...new Set(members.filter(m => typeof m === 'string' && m !== ''))];

/**
 * `deformers` with the parts of `members` taken out of every other group warp (a part is in one group at most, so adding it to a
 * group moves it). A group left with no members goes. `keep` is the id to leave alone.
 */
function withoutMembers(deformers: readonly DeformerDef[], members: readonly string[], keep: string): DeformerDef[] {
  const out: DeformerDef[] = [];
  for (const d of deformers) {
    if (d.id === keep || !Array.isArray(d.members) || !d.members.some(m => members.includes(m))) { out.push(d); continue; }
    const left = d.members.filter(m => !members.includes(m));
    if (left.length) out.push({ ...d, members: left });
  }
  return out;
}

/**
 * `deformers` with a new group warp over `members` (default grid, no keyforms). Its id is the `name` (a bone's, say) or the first
 * member's, plus `_warp`, made unique. Parts that are in another group move to this one; nothing is added without a member.
 */
export function addGroupDeformer(deformers: readonly DeformerDef[], members: readonly string[], grid: readonly [number, number] = DEFORMER_DEFAULT_GRID, name?: string): DeformerDef[] {
  const list = uniqueNames(members);
  if (!list.length) return [...deformers];
  const rest = withoutMembers(deformers, list, ''), taken = new Set(rest.map(d => d.id));
  const base = `${name || list[0]}_warp`;
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}${i}`;
  return [...rest, { id, members: list, grid: [clampGrid(grid[0]), clampGrid(grid[1])], keyforms: [] }];
}

/**
 * The group warp `id` with these members, in this order (the first is the one a drag is measured in). Parts in another group move
 * here; with no members, or for an id that is not a group, the list is returned as it was. The lattice and keyforms are kept.
 */
export function setMembers(deformers: readonly DeformerDef[], id: string, members: readonly string[]): DeformerDef[] {
  const list = uniqueNames(members), cur = deformerById(deformers, id);
  if (!cur || !Array.isArray(cur.members) || !list.length) return [...deformers];
  if (list.length === cur.members.length && list.every((m, i) => m === cur.members![i])) return [...deformers];
  return withoutMembers(deformers, list, id).map(d => (d.id === id ? { ...d, members: list } : d));
}
