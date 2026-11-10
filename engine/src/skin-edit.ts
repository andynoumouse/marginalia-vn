// Editing the bone weights of a free mesh (docs/design/skinning.md): the pure half of the studio's Weights tool. Every function takes
// the mesh's `{ weights, defaultBone }` and returns new weights; nothing is changed in place. An entry is `{ bone: weight }`, read as
// relative; what these functions write has at most MAX_INFLUENCES bones, four decimals and a sum of 1. A vertex that is not listed
// binds to `defaultBone`, so an entry that says exactly that is not stored.

import type { BoneDef } from './bones.js';
import { locateClamped, meshAdjacency } from './mesh.js';
import { MAX_INFLUENCES, type DeformerDef, type DeformerMesh, type MeshWeights } from './params.js';
import { segmentDistance } from './geometry.js';
import { clamp01 } from './util.js';

type Entry = Record<string, number>;
/** What the edits read of a mesh. */
export type SkinMesh = Pick<DeformerMesh, 'weights' | 'defaultBone'>;

const DECIMALS = 1e4;

/** The weights of vertex `v` as they bind it: its entry normalized, else 100% `defaultBone`, else nothing (it stays at rest). */
export function vertexWeights(mesh: SkinMesh, v: number): Entry {
  const own = mesh.weights && Object.hasOwn(mesh.weights, String(v)) ? mesh.weights[String(v)] : undefined;
  const e = own && typeof own === 'object' ? tidy(own, undefined, false) : undefined;
  if (e) return e;
  return typeof mesh.defaultBone === 'string' ? { [mesh.defaultBone]: 1 } : {};
}

/**
 * `entry` cleaned for storing: weights that are not a number above 0 dropped, the MAX_INFLUENCES largest kept, normalized, rounded to
 * four decimals (the largest takes the rounding so the sum stays 1). Undefined when nothing is left, or, with `defaultBone` given, when
 * the result only says "100% the default bone" (the vertex is then left out). `drop` false keeps such an entry.
 */
function tidy(entry: Entry, defaultBone: string | undefined, drop = true): Entry | undefined {
  const picks = Object.entries(entry).filter(([, w]) => typeof w === 'number' && Number.isFinite(w) && w > 0).sort((p, q) => q[1] - p[1]).slice(0, MAX_INFLUENCES);
  if (!picks.length) return undefined;
  const sum = picks.reduce((s, [, w]) => s + w, 0);
  const rounded = picks.map(([b, w]) => [b, Math.round((w / sum) * DECIMALS) / DECIMALS] as [string, number]).filter(([, w]) => w > 0);
  if (!rounded.length) return undefined;
  const rest = rounded.slice(1).reduce((s, [, w]) => s + w, 0);
  rounded[0][1] = Math.round((1 - rest) * DECIMALS) / DECIMALS;
  if (drop && rounded.length === 1 && rounded[0][0] === defaultBone) return undefined;
  return Object.fromEntries(rounded);
}

/** The weights with each vertex in `edits` set to its entry (tidied; undefined or empty removes the vertex from the list). */
function withEntries(mesh: SkinMesh, edits: Iterable<[number, Entry | undefined]>): MeshWeights {
  const out: MeshWeights = { ...(mesh.weights ?? {}) };
  for (const [v, e] of edits) {
    const t = e && tidy(e, mesh.defaultBone);
    if (t) out[String(v)] = t; else delete out[String(v)];
  }
  return out;
}

const uniq = (vertices: Iterable<number>) => [...new Set(vertices)].filter(v => Number.isInteger(v) && v >= 0);

/**
 * Gives `bone` the weight `value` (0-1) on each vertex; the other bones share what is left in proportion to what they had. A vertex with
 * no other bone puts the rest on the default bone (when that is another bone).
 */
export function setBoneWeight(mesh: SkinMesh, vertices: Iterable<number>, bone: string, value: number): MeshWeights {
  const value01 = clamp01(value);
  return withEntries(mesh, uniq(vertices).map(v => {
    const others = Object.entries(vertexWeights(mesh, v)).filter(([b]) => b !== bone);
    const sum = others.reduce((s, [, w]) => s + w, 0), left = 1 - value01, out: Entry = { [bone]: value01 };
    if (sum > 0) for (const [b, w] of others) out[b] = (w / sum) * left;
    else if (left > 0 && mesh.defaultBone !== undefined && mesh.defaultBone !== bone) out[mesh.defaultBone] = left;
    return [v, out] as [number, Entry];
  }));
}

/** Adds `delta` (negative subtracts) to `bone`'s weight on each vertex, kept between 0 and 1; see setBoneWeight. */
export function addBoneWeight(mesh: SkinMesh, vertices: Iterable<number>, bone: string, delta: number): MeshWeights {
  let out: MeshWeights = { ...(mesh.weights ?? {}) };
  for (const v of uniq(vertices)) out = setBoneWeight({ ...mesh, weights: out }, [v], bone, (vertexWeights({ ...mesh, weights: out }, v)[bone] ?? 0) + delta);
  return out;
}

/** Binds each vertex to the default bone again (its entry goes). */
export function resetWeights(mesh: SkinMesh, vertices: Iterable<number>): MeshWeights {
  return withEntries(mesh, uniq(vertices).map(v => [v, undefined] as [number, undefined]));
}

/** Drops the weights below `limit` (0-1) on each vertex, or on all; a vertex whose weights are all below keeps its largest. */
export function pruneWeights(mesh: SkinMesh, limit: number, only?: Iterable<number>): MeshWeights {
  const vs = only ? uniq(only) : Object.keys(mesh.weights ?? {}).map(Number);
  return withEntries(mesh, vs.map(v => {
    const e = vertexWeights(mesh, v), top = Object.entries(e).sort((p, q) => q[1] - p[1])[0];
    const kept = Object.fromEntries(Object.entries(e).filter(([, w]) => w >= limit));
    return [v, Object.keys(kept).length || !top ? kept : { [top[0]]: top[1] }] as [number, Entry];
  }));
}

/**
 * One smoothing step: each vertex (of `only`, else all) moves `amount` (0-1) of the way from its weights to the average of its
 * neighbours' over the mesh's edges. `count` is the vertex count and `tris` the triangles (the edges).
 */
export function smoothWeights(mesh: SkinMesh, count: number, tris: ArrayLike<number>, amount = 0.5, only?: Iterable<number>): MeshWeights {
  const adj = meshAdjacency(count, tris), vs = only ? uniq(only).filter(v => v < count) : Array.from({ length: count }, (_, v) => v);
  const a = clamp01(amount);
  return withEntries(mesh, vs.filter(v => adj[v].length).map(v => {
    const own = vertexWeights(mesh, v), out: Entry = {};
    for (const [b, w] of Object.entries(own)) out[b] = (out[b] ?? 0) + (1 - a) * w;
    for (const n of adj[v]) for (const [b, w] of Object.entries(vertexWeights(mesh, n))) out[b] = (out[b] ?? 0) + (a * w) / adj[v].length;
    return [v, out] as [number, Entry];
  }));
}

// ---- auto-weights ----

/** The bones and where they turn (canvas pixels, see resolvePivots) that auto-weights measure the bodies of. */
export interface BoneTree { bones: Record<string, BoneDef>; pivots: Record<string, [number, number]> }

/** The default soft-zone radius of auto-weights: an eighth of the mesh's longer side. */
export function defaultBlend(verts: ArrayLike<number>): number {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i + 1 < verts.length; i += 2) { x0 = Math.min(x0, verts[i]); x1 = Math.max(x1, verts[i]); y0 = Math.min(y0, verts[i + 1]); y1 = Math.max(y1, verts[i + 1]); }
  return verts.length < 2 ? 1 : Math.max(1, Math.max(x1 - x0, y1 - y0) / 8);
}

/** A bone's body: the segments from its pivot to each child's pivot and to its `tip`; just the pivot (a zero-length segment) when it has neither. */
export function boneBody(tree: BoneTree, bone: string): [number, number, number, number][] {
  const p = tree.pivots[bone];
  if (!p) return [];
  const out: [number, number, number, number][] = [];
  for (const [name, def] of Object.entries(tree.bones)) if (def.parent === bone && name !== bone && tree.pivots[name]) out.push([p[0], p[1], tree.pivots[name][0], tree.pivots[name][1]]);
  const tip = tree.bones[bone]?.tip;
  if (Array.isArray(tip) && tip.length === 2 && tip.every(Number.isFinite)) out.push([p[0], p[1], tip[0], tip[1]]);
  return out.length ? out : [[p[0], p[1], p[0], p[1]]];
}

function distToBody(body: readonly [number, number, number, number][], x: number, y: number): number {
  let best = Infinity;
  for (const [ax, ay, bx, by] of body) best = Math.min(best, segmentDistance(x, y, ax, ay, bx, by));
  return best;
}

/**
 * Weights from the bones' bodies: for each vertex (`verts` in the part's pixels, `origin` where they sit on the canvas) and each of the
 * `bound` bones, `r = max(0, 1 - distance to its body / blend)`; the four largest are normalized. A vertex outside every reach goes
 * entirely to the nearest bone. `blend` is in pixels (see defaultBlend). Only the bound bones can get weight. Returns the whole
 * `weights` (vertices that come out as the default bone alone are left out); empty when no bound bone is in the tree.
 */
export function autoWeights(verts: ArrayLike<number>, origin: readonly [number, number], tree: BoneTree, bound: readonly string[], blend: number, defaultBone?: string): MeshWeights {
  const bodies = bound.filter(b => tree.pivots[b]).map(b => [b, boneBody(tree, b)] as const);
  if (!bodies.length) return {};
  const reach = Math.max(blend, 1e-6), edits: [number, Entry][] = [];
  for (let v = 0; v * 2 + 1 < verts.length; v++) {
    const x = verts[v * 2] + origin[0], y = verts[v * 2 + 1] + origin[1];
    const d = bodies.map(([b, body]) => [b, distToBody(body, x, y)] as const);
    const r = d.map(([b, dist]) => [b, Math.max(0, 1 - dist / reach)] as const).filter(([, w]) => w > 0);
    if (r.length) edits.push([v, Object.fromEntries(r)]);
    else edits.push([v, { [d.reduce((m, e) => (e[1] < m[1] ? e : m))[0]]: 1 }]);
  }
  return withEntries({ defaultBone }, edits);
}

// ---- mirror ----

const swapCase = (from: string, to: string) => (from === from.toUpperCase() ? to.toUpperCase() : from[0] === from[0].toUpperCase() && from.length > 1 ? to[0].toUpperCase() + to.slice(1) : to);

/**
 * The bone on the other side: `_l` / `_r` (also `.L` / `.R`, `-l`), or a leading or trailing `left` / `right` word with `_`, `.` or `-` between
 * (`arm_l` <-> `arm_r`, `Left.Hand` <-> `Right.Hand`). Null when the name says no side. The case of the original is kept.
 */
export function pairedBone(name: string): string | null {
  let m = /^(.+)([._-])([lr])$/i.exec(name);
  if (m) return `${m[1]}${m[2]}${swapCase(m[3], m[3].toLowerCase() === 'l' ? 'r' : 'l')}`;
  m = /^(left|right)([._-])(.+)$/i.exec(name);
  if (m) return `${swapCase(m[1], m[1].toLowerCase() === 'left' ? 'right' : 'left')}${m[2]}${m[3]}`;
  m = /^(.+)([._-])(left|right)$/i.exec(name);
  if (m) return `${m[1]}${m[2]}${swapCase(m[3], m[3].toLowerCase() === 'left' ? 'right' : 'left')}`;
  return null;
}

/**
 * A guess at the partner of a bone whose name says no side, for the Mirror dialog to start from (SD-13): among the rig's bones whose names
 * differ from `name` in one number only (a family such as hair_0_0 … hair_4_0), the one at the mirrored place in that run of numbers
 * (hair_0_0 <-> hair_4_0; hair_2_0, in the middle, is its own). Null when no such family or no bone at the mirrored number.
 */
export function guessPartner(name: string, bones: readonly string[]): string | null {
  const parts = (s: string) => s.split(/(\d+)/);
  const own = parts(name);
  for (let i = 1; i < own.length; i += 2) {
    const values: number[] = [];
    for (const b of bones) {
      const p = parts(b);
      if (p.length !== own.length || !p.every((x, j) => j === i || x === own[j])) continue;
      values.push(Number(p[i]));
    }
    if (values.length < 2) continue;
    const want = Math.min(...values) + Math.max(...values) - Number(own[i]);
    const hit = bones.find(b => { const p = parts(b); return p.length === own.length && p.every((x, j) => (j === i ? Number(x) === want : x === own[j])); });
    if (hit !== undefined) return hit;
  }
  return null;
}

/**
 * Copies the weights across the part's vertical middle: each vertex on the `from` side (x at or left of / right of `mid`) gives its
 * weights to its partner (see meshMirrorPartners), with every bone replaced by its pair. A bone with no pair in the name rules is looked up
 * in `pairs` (the author's answer); one with neither is listed in `unpaired` and then nothing at all changes: it is never guessed.
 * A vertex on the axis, or with no partner, is left alone (`lonely` lists the vertices that have no partner).
 */
export function mirrorWeights(mesh: SkinMesh, verts: ArrayLike<number>, partner: ArrayLike<number>, mid: number, from: 'left' | 'right', pairs: Readonly<Record<string, string>> = {}): { weights: MeshWeights; unpaired: string[]; lonely: number[] } {
  const n = Math.floor(verts.length / 2), unpaired = new Set<string>(), lonely: number[] = [], edits: [number, Entry][] = [];
  const pair = (b: string) => (Object.hasOwn(pairs, b) ? pairs[b] : pairedBone(b));
  for (let p = 0; p < n; p++) {
    const x = verts[p * 2];
    if (partner[p] === p || (from === 'left' ? x > mid : x < mid)) continue;
    const q = partner[p];
    if (q < 0) { lonely.push(p); continue; }
    const out: Entry = {};
    for (const [b, w] of Object.entries(vertexWeights(mesh, p))) { const o = pair(b); if (o === null) unpaired.add(b); else out[o] = (out[o] ?? 0) + w; }
    edits.push([q, out]);
  }
  if (unpaired.size) return { weights: { ...(mesh.weights ?? {}) }, unpaired: [...unpaired], lonely };
  return { weights: withEntries(mesh, edits), unpaired: [], lonely };
}

// ---- topology edits ----

/** The weights after vertex `i` is deleted: its entry goes and every higher number moves down by one. */
export function removeVertexWeights(weights: MeshWeights | undefined, i: number): MeshWeights {
  const out: MeshWeights = {};
  for (const [k, e] of Object.entries(weights ?? {})) { const v = Number(k); if (v !== i) out[String(v > i ? v - 1 : v)] = e; }
  return out;
}

/** Weights of the point (x, y) of a mesh (`verts`, `tris`): its triangle's corners blended by position, the nearest triangle when it lies outside. */
export function sampleWeights(mesh: SkinMesh, verts: ArrayLike<number>, tris: ArrayLike<number>, x: number, y: number): Entry | undefined {
  const at = locateClamped(verts, tris, x, y);
  if (!at) return undefined;
  const out: Entry = {};
  [[tris[at.tri * 3], at.u], [tris[at.tri * 3 + 1], at.v], [tris[at.tri * 3 + 2], at.w]].forEach(([v, k]) => {
    for (const [b, w] of Object.entries(vertexWeights(mesh, v))) out[b] = (out[b] ?? 0) + w * k;
  });
  return out;
}

/**
 * The weights after a vertex is added at (x, y) of the mesh `verts` / `tris` (the mesh as it was, with `count` vertices): the new vertex is
 * the last, number `count`, and blends its triangle's corners by position (an edge split blends the edge's two ends). A blend that comes out as the
 * default bone alone is not stored.
 */
export function addVertexWeights(mesh: SkinMesh, verts: ArrayLike<number>, tris: ArrayLike<number>, x: number, y: number): MeshWeights {
  const count = Math.floor(verts.length / 2), e = sampleWeights(mesh, verts, tris, x, y);
  return withEntries(mesh, [[count, e]]);
}

/**
 * The weights for a mesh that replaces another (Regenerate, Replace lattice with mesh): each new vertex samples the old mesh at its own
 * position, so a finer or coarser mesh keeps the painted result. The default bone stays.
 */
export function resampleWeights(mesh: SkinMesh, oldVerts: ArrayLike<number>, oldTris: ArrayLike<number>, newVerts: ArrayLike<number>): MeshWeights {
  const n = Math.floor(newVerts.length / 2), edits: [number, Entry | undefined][] = [];
  for (let v = 0; v < n; v++) edits.push([v, sampleWeights(mesh, oldVerts, oldTris, newVerts[v * 2], newVerts[v * 2 + 1])]);
  return withEntries({ defaultBone: mesh.defaultBone }, edits);
}

// ---- bones in the tree ----

/** The weights with bone `from` renamed `to` (merged into it when `to` has weight already) on every vertex; the same for the default bone. */
export function renameWeightBone<T extends SkinMesh>(mesh: T, from: string, to: string): T {
  if (from === to) return mesh;
  const weights = mesh.weights && Object.fromEntries(Object.entries(mesh.weights).map(([k, e]) => {
    const out: Entry = {};
    for (const [b, w] of Object.entries(e)) { const name = b === from ? to : b; out[name] = (out[name] ?? 0) + w; }
    return [k, out];
  }));
  const out = { ...mesh } as T;
  if (weights) out.weights = weights;
  if (mesh.defaultBone === from) out.defaultBone = to;
  return out;
}

/**
 * The weights after bone `bone` is deleted: its weight goes to `parent` (merged with what that has, renormalized), as merging the bone into its
 * parent would; the default bone moves up the same way. Without a parent (`null`) the bone's weight is just dropped.
 */
export function deleteWeightBone<T extends SkinMesh>(mesh: T, bone: string, parent: string | null): T {
  if (parent === null) {
    const weights = mesh.weights && withEntries(mesh, Object.entries(mesh.weights).map(([k, e]) => [Number(k), Object.fromEntries(Object.entries(e).filter(([b]) => b !== bone))] as [number, Entry]));
    const out = { ...mesh } as T;
    if (weights) out.weights = weights;
    if (mesh.defaultBone === bone) delete out.defaultBone;
    return out;
  }
  const out = renameWeightBone(mesh, bone, parent);
  return out.weights ? { ...out, weights: withEntries(out, Object.entries(out.weights).map(([k, e]) => [Number(k), e] as [number, Entry])) } : out;
}

// ---- binding (the studio's Skin sub-block) ----

/**
 * The mesh with `bone` unbound (the ✕ on a bone in the studio's Skin sub-block): its weight, and `defaultBone` when it was that, go to its
 * parent in `bones` as deleteWeightBone does, or are dropped when it has none (or its parent is not in the rig). `to` says where the weight
 * went (null: dropped). A bone the mesh does not name comes back as it is. Unbinding the last bone takes the skin with it (stopSkinning, `to`
 * null): nothing is left to weight, and the part follows its own bone again.
 */
export function unbindBone<T extends SkinMesh>(mesh: T, bone: string, bones: Readonly<Record<string, { parent?: string }>>): { mesh: T; to: string | null } {
  const parent = bones[bone]?.parent;
  const to = typeof parent === 'string' && parent !== bone && Object.hasOwn(bones, parent) ? parent : null;
  const bound = boundBones(mesh);
  if (!bound.includes(bone)) return { mesh, to };
  if (bound.length === 1) return { mesh: stopSkinning(mesh), to: null };
  return { mesh: deleteWeightBone(mesh, bone, to), to };
}

/** The bones a mesh's weights name, the default bone first, in the order they first appear. */
export function boundBones(mesh: SkinMesh): string[] {
  const out = new Set<string>(typeof mesh.defaultBone === 'string' ? [mesh.defaultBone] : []);
  for (const e of Object.values(mesh.weights ?? {})) for (const b of Object.keys(e)) out.add(b);
  return [...out];
}

/**
 * The mesh as skinning starts: it gets `weights` (empty: every vertex on the default bone) and, when it has none, `defaultBone`: the part's own
 * bone, so the part draws as before until a vertex is weighted elsewhere. A mesh that is skinned already is returned as it is.
 */
export function startSkinning<T extends SkinMesh>(mesh: T, partBone: string | undefined): T {
  if (mesh.weights !== undefined) return mesh;
  const out = { ...mesh, weights: {} } as T;
  if (mesh.defaultBone === undefined && partBone !== undefined) out.defaultBone = partBone;
  return out;
}

/** The mesh with no skin: its `weights` and `defaultBone` removed. */
export function stopSkinning<T extends SkinMesh>(mesh: T): T {
  const out = { ...mesh };
  delete out.weights;
  delete out.defaultBone;
  return out;
}

/**
 * Auto-weights (see autoWeights) written into the mesh: on all its vertices, or only on `only` (the others keep what they have). A mesh that is not
 * skinned yet starts skinning (see startSkinning). `bound` are the bones that may get weight. Returns the mesh unchanged when no bound bone is in the tree.
 */
export function applyAutoWeights<T extends SkinMesh & { verts: number[] }>(mesh: T, origin: readonly [number, number], tree: BoneTree, bound: readonly string[], blend: number, partBone: string | undefined, only?: Iterable<number>): T {
  const base = startSkinning(mesh, partBone);
  if (!bound.some(b => tree.pivots[b])) return mesh;
  const made = autoWeights(base.verts, origin, tree, bound, blend, base.defaultBone);
  if (!only) return { ...base, weights: made };
  const weights: MeshWeights = { ...(base.weights ?? {}) };
  for (const v of uniq(only)) { if (made[v]) weights[String(v)] = made[v]; else delete weights[String(v)]; }
  return { ...base, weights };
}

/** The weight of `bone` at each of the mesh's `count` vertices (0-1): what the studio shows as heat. */
export function boneHeat(mesh: SkinMesh, bone: string, count: number): number[] {
  return Array.from({ length: count }, (_, v) => vertexWeights(mesh, v)[bone] ?? 0);
}

/** A vertex's weights as a line of text: `arm_l 0.65 · forearm_l 0.35` (largest first); `at rest` when it binds to no bone. */
export function weightsText(mesh: SkinMesh, v: number): string {
  const e = Object.entries(vertexWeights(mesh, v)).sort((p, q) => q[1] - p[1]);
  return e.length ? e.map(([b, w]) => `${b} ${Math.round(w * 1e4) / 1e4}`).join(' · ') : 'at rest';
}

// ---- numeric edits on a selection ----

/** A numeric edit of the studio's Numeric row: set / add / subtract move `bone`'s weight by `value`; smooth, prune and reset need no bone. */
export type NumericOp =
  | { kind: 'set' | 'add' | 'subtract'; bone: string; value: number }
  | { kind: 'smooth'; amount: number }
  | { kind: 'prune'; limit: number }
  | { kind: 'reset' };

/**
 * `mesh` with `op` applied to the vertices of `selection` (those outside the `count` vertices are ignored). A mesh that is not skinned yet starts
 * skinning with `partBone` as its default bone. Returns the mesh itself when no vertex is left to edit.
 */
export function applyNumeric<T extends SkinMesh>(mesh: T, selection: Iterable<number>, op: NumericOp, count: number, tris: ArrayLike<number>, partBone?: string): T {
  const vs = uniq(selection).filter(v => v < count);
  if (!vs.length) return mesh;
  const base = startSkinning(mesh, partBone);
  let weights: MeshWeights;
  switch (op.kind) {
    case 'set': weights = setBoneWeight(base, vs, op.bone, op.value); break;
    case 'add': weights = addBoneWeight(base, vs, op.bone, Math.abs(op.value)); break;
    case 'subtract': weights = addBoneWeight(base, vs, op.bone, -Math.abs(op.value)); break;
    case 'smooth': weights = smoothWeights(base, count, tris, op.amount, vs); break;
    case 'prune': weights = pruneWeights(base, op.limit, vs); break;
    case 'reset': weights = resetWeights(base, vs); break;
  }
  return { ...base, weights };
}

// ---- the brush ----

/** What a brush stroke does to the active bone's weight under it: Add and Subtract move it, Replace pulls it toward the strength, Smooth blurs all the bones' weights. */
export type BrushMode = 'add' | 'subtract' | 'replace' | 'smooth';

/**
 * One dab of the weight brush: `hits` are the vertices under it with how strongly each is touched (0-1, the brush's falloff: 1 at the middle).
 * Add and Subtract move `bone`'s weight by `strength` times that; Replace pulls it toward `strength` by that much (a strength of 1 at the middle
 * paints it solid); Smooth moves each vertex's weights `strength` times that of the way to the average of its neighbours' (`count` vertices, `tris`
 * the edges). Every vertex is worked out from the weights as they were before the dab, so the order of `hits` does not matter. A mesh that is not
 * skinned yet starts skinning with `partBone` as its default bone.
 */
export function paintWeights<T extends SkinMesh>(mesh: T, hits: readonly (readonly [number, number])[], mode: BrushMode, bone: string | null, strength: number, count: number, tris: ArrayLike<number>, partBone?: string): MeshWeights {
  const base = startSkinning(mesh, partBone), s = clamp01(strength), edits: [number, Entry | undefined][] = [];
  const adj = mode === 'smooth' ? meshAdjacency(count, tris) : [];
  for (const [v, k0] of hits) {
    const k = clamp01(k0);
    if (!(v >= 0 && v < count) || k <= 0) continue;
    const own = vertexWeights(base, v);
    if (mode === 'smooth') {
      if (!adj[v]?.length) continue;
      const out: Entry = {}, a = s * k;
      for (const [b, w] of Object.entries(own)) out[b] = (out[b] ?? 0) + (1 - a) * w;
      for (const n of adj[v]) for (const [b, w] of Object.entries(vertexWeights(base, n))) out[b] = (out[b] ?? 0) + (a * w) / adj[v].length;
      edits.push([v, out]);
      continue;
    }
    if (bone === null) continue;
    const now = own[bone] ?? 0;
    const want = mode === 'add' ? now + s * k : mode === 'subtract' ? now - s * k : now + (s - now) * k;
    const others = Object.entries(own).filter(([b]) => b !== bone), sum = others.reduce((t, [, w]) => t + w, 0), value = clamp01(want), out: Entry = { [bone]: value };
    if (sum > 0) for (const [b, w] of others) out[b] = (w / sum) * (1 - value);
    else if (value < 1 && base.defaultBone !== undefined && base.defaultBone !== bone) out[base.defaultBone] = 1 - value;
    edits.push([v, out]);
  }
  return withEntries(base, edits);
}

// ---- bones leaving the rig, and the rest-pose rule ----

/**
 * `deformers` after bone `bone` is removed from the rig: every skinned mesh that names it gives its weight (and its default bone) to `parent`, as
 * deleteWeightBone does; with no parent the weight is dropped. Meshes that do not name the bone, and deformers without a skin, come back as they were.
 */
export function removeBoneWeights(deformers: readonly DeformerDef[], bone: string, parent: string | null): DeformerDef[] {
  return deformers.map(d => (d.mesh && isSkinnedMesh(d.mesh) && boundBones(d.mesh).includes(bone) ? { ...d, mesh: deleteWeightBone(d.mesh, bone, parent) } : d));
}

const isSkinnedMesh = (m: SkinMesh) => m.weights !== undefined && m.weights !== null;

/**
 * The bones that move a skinned mesh and are posed now: those of its weights (and its default bone), and those above them in the tree, that have
 * a transform in `forms` (by bone name, as the keyforms give it at the slider values on show). A keyform of a skinned mesh is a shape before the
 * skin, so it is authored with these at rest (docs/design/skinning.md, "Editing keyforms of a skinned mesh").
 */
export function posedInfluences(mesh: SkinMesh, bones: Readonly<Record<string, { parent?: string }>>, forms: Readonly<Record<string, Partial<Record<'dx' | 'dy' | 'sx' | 'sy' | 'rot', number>>>>, eps = 1e-6): string[] {
  const chain = new Set<string>();
  for (const b of boundBones(mesh)) {
    for (let cur: string | undefined = b, i = 0; cur !== undefined && Object.hasOwn(bones, cur) && !chain.has(cur) && i <= Object.keys(bones).length; cur = bones[cur].parent, i++) chain.add(cur);
  }
  return [...chain].filter(b => { const f = forms[b]; return !!f && (['dx', 'dy', 'sx', 'sy', 'rot'] as const).some(k => Math.abs(f[k] ?? 0) > eps); }).sort();
}
