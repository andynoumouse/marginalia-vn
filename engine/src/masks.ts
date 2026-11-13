// Masks: a part is clipped to a shape, so an iris stays inside the eye and a tongue inside the mouth.
// Pure data and geometry; the renderer (preview/pixi-renderer.ts) turns a shape into a Pixi stencil mask and nothing here draws.
//
//   A SHAPE is an imageless entry of `parts` (`eyelids: { bone?, follow?, polygon, keyforms? }`) and a clip is a link on the clipped
//   part (`eyes: { bone, clip: "eyelids" }`). `clip` names a shape part or an image part (that part's visible silhouette, its opaque
//   pixels traced by traceOutline). `polygon` is points [x, y] in pixels of the PSD canvas; `keyforms` (the shape of DeformerKeyform:
//   `pts` are per-vertex displacements in stage fractions) reshape it with parameters, so the eyelid of a blink can close its mask.
//   `bone` places the shape with that bone, `follow` hangs it on an image part's drawn mesh (its own warp and its group warp). A shape
//   is not in `order` and has no layer; it may clip many parts, a part has one clip.
//   nesting: a part whose clip source is itself clipped is clipped by both shapes (nested stencils). One level of nesting is
//            allowed (two shapes in all); a loop, or a chain of three, is a checkRig error.
//   maskView gives the clips as the list of MaskDef (one per clipped part) that the renderer and the studio work with.
//
// Stencil masks are hard-edged; soft alpha masks would need render textures and are not offered (docs/design/animation-studio-parameters.md).

import { checkPointKeyforms, type DeformerKeyform, type ParamDef } from './params.js';
import { isNum, isObj } from './util.js';
import { traceLoops } from './contour.js';
import { signedArea } from './geometry.js';
import { sampleLattice, type GroupStage } from './warp.js';
import type { ProblemReport } from './suggest.js';

export type MaskPoint = [number, number];

export interface MaskDef {
  id: string;
  /** The part that is clipped. */
  part: string;
  /** Clip to the visible shape of this other part. */
  from?: string;
  /** Clip to a drawn shape: points in pixels of the PSD canvas. */
  polygon?: MaskPoint[];
  /** For a polygon: the bone or part it follows. */
  on?: string;
  /** For a polygon: per-vertex displacements driven by parameters (stage fractions, as a deformer's). */
  keyforms?: DeformerKeyform[];
  /** For a polygon read from a shape part: that shape's name (several masks, one per clipped part, share a shape). */
  shape?: string;
}

export const MASK_MIN_POINTS = 3;
export const MASK_MAX_POINTS = 64;
/** The shapes one part may be clipped by, counting those it inherits through `from` (one nested level). */
export const MASK_MAX_SHAPES = 2;
/** Masks per character above which checkRig and the renderer warn: each is stencil passes and batch breaks every frame, unmeasured on weak phones. */
export const MASK_WARN_COUNT = 8;

export const maskOf = (masks: readonly MaskDef[] | undefined, part: string): MaskDef | undefined => masks?.find(m => m?.part === part);

/** The masks `part` is drawn through: its own, then that of its `from` part, and so on; stops at a part with none or at a loop. */
export function maskChain(masks: readonly MaskDef[] | undefined, part: string): MaskDef[] {
  const out: MaskDef[] = [], seen = new Set<string>();
  for (let cur: string | undefined = part; cur !== undefined && !seen.has(cur); ) {
    seen.add(cur);
    const m = maskOf(masks, cur);
    if (!m) break;
    out.push(m);
    cur = m.from;
  }
  return out;
}

/** Loops of `from` links (a clipped by b, b clipped by a), each as the part names around it, listed once. */
export function maskCycles(masks: readonly MaskDef[] | undefined): string[][] {
  const out: string[][] = [], done = new Set<string>();
  for (const m of masks ?? []) {
    const path: string[] = [];
    let cur: string | undefined = m?.part;
    while (cur !== undefined && !path.includes(cur) && !done.has(cur)) { path.push(cur); cur = maskOf(masks, cur)?.from; }
    if (cur !== undefined && path.includes(cur)) out.push(path.slice(path.indexOf(cur)));
    for (const p of path) done.add(p);
  }
  return out;
}

/** The parts a mask's shape follows or is taken from: `from`, or the part named by a polygon's `on`. */
export const maskFrame = (m: MaskDef): string | undefined => m.from ?? m.on;

/** Points of `polygon` as a flat [x0, y0, x1, y1, ...] list. */

// ---- bending a shape with a part's warp ----

/**
 * `points` (flat [x, y, ...], in the lattice's own space: pixels of the part's image box) carried along by a warped lattice:
 * each point keeps its place in its cell, so a polygon over a warped part bends with it. `lattice` holds the deformed control
 * points of the (cols + 1) x (rows + 1) grid (row-major, flat), in the same space as the points. A point outside the box moves
 * with the nearest edge cell.
 */
export function warpPoints(points: ArrayLike<number>, box: { w: number; h: number }, grid: readonly [number, number], lattice: ArrayLike<number>, out: Float32Array = new Float32Array(points.length)): Float32Array {
  const [cols, rows] = grid, stride = cols + 1;
  const at = (i: number, j: number, k: number) => lattice[(j * stride + i) * 2 + k];
  for (let n = 0; n + 1 < points.length; n += 2) {
    const u = box.w > 0 ? (points[n] / box.w) * cols : 0, v = box.h > 0 ? (points[n + 1] / box.h) * rows : 0;
    const i = Math.min(cols - 1, Math.max(0, Math.floor(u))), j = Math.min(rows - 1, Math.max(0, Math.floor(v)));
    const fu = u - i, fv = v - j;
    for (let k = 0; k < 2; k++) {
      const top = at(i, j, k) * (1 - fu) + at(i + 1, j, k) * fu, bottom = at(i, j + 1, k) * (1 - fu) + at(i + 1, j + 1, k) * fu;
      out[n + k] = top * (1 - fv) + bottom * fv;
    }
  }
  return out;
}

/**
 * Whether a group warp bends a shape that is one of its members. A shape that `follow`s an image part of that same group is not bent
 * again: the followed part's mesh buffer already holds the group's displacement and warpPoints carries the shape along with it.
 * `members` are the group's member names; `follow` is the shape's follow part, if any.
 */
export const shapeBentByGroup = (follow: string | undefined, members: readonly string[] | undefined): boolean => !(follow !== undefined && !!members?.includes(follow));

/**
 * A shape's points (`base`, default `sample`) moved by a group warp's lattice. `sample` are the points in drawn space (canvas pixels less
 * `at`), whose canvas position (plus `at`) is looked up in the group's box; the displacement (stage fractions) times `unit` is added.
 * Writes into `out` (same length).
 */
export function bendShapeByGroup(sample: ArrayLike<number>, at: readonly [number, number], group: GroupStage, unit: number, base: ArrayLike<number> = sample, out: Float32Array = new Float32Array(sample.length)): Float32Array {
  const [bx, by, bw, bh] = group.box;
  for (let n = 0; n + 1 < sample.length; n += 2) {
    const [dx, dy] = sampleLattice(group.disp, group.grid, bw > 0 ? (sample[n] + at[0] - bx) / bw : 0, bh > 0 ? (sample[n + 1] + at[1] - by) / bh : 0);
    out[n] = base[n] + dx * unit;
    out[n + 1] = base[n + 1] + dy * unit;
  }
  return out;
}

// ---- the silhouette of a part's art ----

export interface TraceOptions {
  /** Alpha (0-255) from which a pixel counts as part of the shape; 128 by default (the visible edge of a soft one). */
  threshold?: number;
  /** How far, in pixels of the alpha grid, the simplified outline may stray from the traced one; 0.7 by default. */
  tolerance?: number;
  /** Shapes smaller than this share of the biggest one's area are dropped as specks; 0.01 by default. */
  speck?: number;
  /** Most points of one outline (the tolerance grows until it fits); MASK_MAX_POINTS by default. */
  maxPoints?: number;
  /** Most outlines kept (the biggest); 8 by default. */
  maxShapes?: number;
}


/** Douglas-Peucker on an open run of `pts` between its two ends, which are kept. */
function dpRun(pts: readonly MaskPoint[], tol: number): MaskPoint[] {
  if (pts.length < 3) return [...pts];
  const a = pts[0], b = pts[pts.length - 1], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
  let far = 0, at = -1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = len > 0 ? Math.abs(dy * (pts[i][0] - a[0]) - dx * (pts[i][1] - a[1])) / len : Math.hypot(pts[i][0] - a[0], pts[i][1] - a[1]);
    if (d > far) { far = d; at = i; }
  }
  if (at < 0 || far <= tol) return [a, b];
  return [...dpRun(pts.slice(0, at + 1), tol).slice(0, -1), ...dpRun(pts.slice(at), tol)];
}

/** A closed outline simplified: the two points farthest apart anchor it, and each half is thinned to within `tol`. */
export function simplifyOutline(pts: readonly MaskPoint[], tol: number): MaskPoint[] {
  if (pts.length <= 3) return [...pts];
  let far = 0, best = -1;
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]); if (d > best) { best = d; far = i; } }
  const first = dpRun(pts.slice(0, far + 1), tol), second = dpRun([...pts.slice(far), pts[0]], tol);
  return [...first.slice(0, -1), ...second.slice(0, -1)];
}

/**
 * The outlines of the opaque shapes in a w x h grid of alpha values (row-major, 0-255): one closed polygon per blob of pixels
 * at or above the threshold (4-connected, biggest first, specks dropped), holes ignored, as points in fractions (0-1) of the
 * grid so the same trace fits an image at any scale. Corners are on pixel edges, so a fully opaque image traces to its box.
 * Nothing opaque gives no outlines.
 */
export function traceOutline(alpha: ArrayLike<number>, w: number, h: number, opts: TraceOptions = {}): MaskPoint[][] {
  const threshold = opts.threshold ?? 128, speck = opts.speck ?? 0.01, maxPoints = opts.maxPoints ?? MASK_MAX_POINTS, maxShapes = opts.maxShapes ?? 8;
  if (!(w > 0 && h > 0) || alpha.length < w * h) return [];
  const solid = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) solid[i] = alpha[i] >= threshold ? 1 : 0;
  // Label the blobs.
  const label = new Int32Array(w * h), sizes: number[] = [0];
  const stack: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (!solid[s] || label[s]) continue;
    const id = sizes.length;
    let count = 0;
    stack.push(s);
    label[s] = id;
    while (stack.length) {
      const p = stack.pop()!, x = p % w, y = (p - x) / w;
      count++;
      if (x > 0 && solid[p - 1] && !label[p - 1]) { label[p - 1] = id; stack.push(p - 1); }
      if (x < w - 1 && solid[p + 1] && !label[p + 1]) { label[p + 1] = id; stack.push(p + 1); }
      if (y > 0 && solid[p - w] && !label[p - w]) { label[p - w] = id; stack.push(p - w); }
      if (y < h - 1 && solid[p + w] && !label[p + w]) { label[p + w] = id; stack.push(p + w); }
    }
    sizes.push(count);
  }
  const biggest = Math.max(0, ...sizes);
  const keep = sizes.map((n, id) => ({ n, id })).filter(b => b.id > 0 && b.n >= Math.max(1, biggest * speck)).sort((a, b) => b.n - a.n).slice(0, maxShapes);
  const out: MaskPoint[][] = [];
  const blob = new Uint8Array(w * h);
  for (const { id } of keep) {
    // The blob's outline is its biggest clockwise loop (holes run the other way, and a gap open only at a corner is a hole too).
    for (let s = 0; s < w * h; s++) blob[s] = label[s] === id ? 1 : 0;
    let best: MaskPoint[] | null = null, bestArea = 0;
    for (const loop of traceLoops(blob, w, h, true)) {
      const area = signedArea(loop);
      if (area > bestArea) { best = loop; bestArea = area; }
    }
    if (!best || best.length < 3) continue;
    let tol = opts.tolerance ?? 0.7, poly = simplifyOutline(best, tol);
    for (let i = 0; poly.length > maxPoints && i < 12; i++) poly = simplifyOutline(best, (tol *= 1.5));
    if (poly.length >= 3) out.push(poly.map(p => [p[0] / w, p[1] / h] as MaskPoint));
  }
  return out;
}

// ---- shape parts and the normalised form ----

/** An entry of rig.json `parts`: a drawn part's bone, pivot and `clip`; or, with a `polygon`, a shape (imageless) part. */
export interface PartEntry {
  bone?: string;
  pivot?: [number, number];
  /** The shape part or image part this part is clipped to. */
  clip?: string;
  /** A shape part: its outline, points [x, y] in pixels of the PSD canvas. */
  polygon?: MaskPoint[];
  /** A shape part: the image part whose drawn mesh (own warp and group warp) bends it; with `bone` only, it follows that bone. */
  follow?: string;
  /** A shape part: per-vertex displacements driven by parameters (stage fractions, as a deformer's). */
  keyforms?: DeformerKeyform[];
}
export interface ShapeDef { bone?: string; follow?: string; polygon: MaskPoint[]; keyforms?: DeformerKeyform[] }


/** Whether a `parts` entry is a shape part (it has a `polygon`, whatever else is wrong with it; checkRig says what). */
export const isShapeEntry = (def: unknown): boolean => isObj(def) && def.polygon !== undefined;

/** The names of the shape parts in rig.json `parts`. */
export function shapePartNames(parts: unknown): string[] {
  return isObj(parts) ? Object.keys(parts).filter(k => isShapeEntry(parts[k])) : [];
}

export interface MaskSet {
  /** Shape parts by name: those of `parts` and the converted polygon masks. */
  shapes: Record<string, ShapeDef>;
  /** Clipped part to the shape part or image part it is clipped to. */
  clips: Record<string, string>;
}

const validPoly = (v: unknown): v is MaskPoint[] => Array.isArray(v) && v.length >= MASK_MIN_POINTS && v.length <= MASK_MAX_POINTS && v.every(p => Array.isArray(p) && p.length === 2 && p.every(isNum));

/**
 * The masks of a rig.json as shape parts and clip links, read from `parts`. Entries that are not usable (checkRig says why) are skipped.
 */
export function normalizeMasks(data: { parts?: unknown } | undefined): MaskSet {
  const shapes: Record<string, ShapeDef> = {}, clips: Record<string, string> = {};
  const parts = isObj(data?.parts) ? data!.parts as Record<string, unknown> : {};
  for (const [name, def] of Object.entries(parts)) {
    if (!isObj(def)) continue;
    if (isShapeEntry(def)) {
      if (!validPoly(def.polygon)) continue;
      shapes[name] = { polygon: def.polygon, ...(typeof def.bone === 'string' ? { bone: def.bone } : {}), ...(typeof def.follow === 'string' ? { follow: def.follow } : {}), ...(Array.isArray(def.keyforms) ? { keyforms: def.keyforms as DeformerKeyform[] } : {}) };
    } else if (typeof def.clip === 'string' && def.clip) clips[name] = def.clip;
  }
  for (const [part, to] of Object.entries(clips)) if (to === part) delete clips[part];
  return { shapes, clips };
}

/**
 * The masks as the list the renderer works with: one MaskDef per clipped part, in clip order. A polygon mask's id is its
 * shape's name (the others of a shape that clips several parts are `name:part`) and `shape` names the shape; a clip to an image part is
 * `from` with the id `<part>_mask`. `on` is the shape's `follow`, else its `bone`. With `unclipped` the shapes that clip nothing follow,
 * with an empty `part` (the studio draws them so they can be chosen).
 */
export function maskView(data: { parts?: unknown } | undefined, unclipped = false): MaskDef[] {
  const { shapes, clips } = normalizeMasks(data);
  const out: MaskDef[] = [], used = new Set<string>();
  const unique = (id: string) => { let x = id; for (let i = 2; used.has(x); i++) x = `${id}~${i}`; used.add(x); return x; };
  const polygonOf = (name: string, s: ShapeDef) => { const on = s.follow ?? s.bone; return { polygon: s.polygon, ...(on !== undefined ? { on } : {}), ...(s.keyforms ? { keyforms: s.keyforms } : {}), shape: name }; };
  for (const [part, to] of Object.entries(clips)) {
    const s = shapes[to];
    if (!s) { out.push({ id: unique(`${part}_mask`), part, from: to }); continue; }
    out.push({ id: unique(used.has(to) ? `${to}:${part}` : to), part, ...polygonOf(to, s) });
  }
  if (unclipped) for (const [name, s] of Object.entries(shapes)) if (!Object.values(clips).includes(name)) out.push({ id: unique(name), part: '', ...polygonOf(name, s) });
  return out;
}

/** `parts` without its shape parts and without `clip`, which is what the studio keeps as its own bones-and-pivots `parts`; an entry left empty goes. */
export function stripMasks<T extends PartEntry>(parts: Record<string, T> | undefined): Record<string, Omit<T, 'clip'>> {
  const out: Record<string, Omit<T, 'clip'>> = {};
  for (const [k, def] of Object.entries(parts ?? {})) {
    if (isShapeEntry(def)) continue;
    if (isObj(def) && def.clip !== undefined) {
      const { clip: _clip, ...rest } = def;
      if (Object.keys(rest).length) out[k] = rest as Omit<T, 'clip'>;
    } else out[k] = def;
  }
  return out;
}

/**
 * `parts` (shapes and clips replaced, see stripMasks) with the studio's `shapes` as shape parts and each `clips` link on its clipped part.
 * A shape's entry is its `bone`, `follow`, `polygon` and `keyforms`. The caller drops the `masks` key.
 */
export function writeShapes(parts: Record<string, PartEntry>, shapes: Readonly<Record<string, ShapeDef>>, clips: Readonly<Record<string, string>>): Record<string, PartEntry> {
  const out: Record<string, PartEntry> = { ...stripMasks(parts) };
  for (const [name, s] of Object.entries(shapes)) {
    out[name] = { ...(s.bone !== undefined ? { bone: s.bone } : {}), ...(s.follow !== undefined ? { follow: s.follow } : {}), polygon: s.polygon.map(p => [p[0], p[1]] as MaskPoint), ...(s.keyforms ? { keyforms: s.keyforms } : {}) };
  }
  for (const [part, to] of Object.entries(clips)) out[part] = { ...(out[part] ?? {}), clip: to };
  return out;
}

// ---- checks ----

/**
 * Warnings for a clipped part that a group warp bends while the shape (or part) it is clipped to is not bent with it: the art would
 * move and its clip would stay. A clip source counts as bent with the group when it is a member, or a shape that `follow`s a member.
 * Nothing is said when neither is in a group.
 */
export function checkClipGroups(data: { deformers?: unknown; parts?: unknown }, problem: ProblemReport): void {
  if (!Array.isArray(data.deformers)) return;
  const groupOf = new Map<string, string>();
  for (const d of data.deformers as { id?: unknown; members?: unknown }[]) {
    if (!isObj(d) || typeof d.id !== 'string' || !Array.isArray(d.members)) continue;
    for (const m of d.members) if (typeof m === 'string' && !groupOf.has(m)) groupOf.set(m, d.id);
  }
  if (!groupOf.size) return;
  const { shapes, clips } = normalizeMasks(data);
  for (const [part, src] of Object.entries(clips)) {
    const g = groupOf.get(part);
    if (g === undefined) continue;
    const shape = shapes[src], follow = shape?.follow;
    if (groupOf.get(src) === g || (follow !== undefined && groupOf.get(follow) === g)) continue;
    problem(`masks: ${part} is bent by ${g} but its clip ${shape ? 'shape' : 'part'} ${src} is not${shape ? ` (add ${src} to the members of ${g}, or make it follow a member)` : ` (add ${src} to the members of ${g})`}`, part);
  }
}

/**
 * Problems in the masks of a rig: the shape parts and `clip` links of `parts`. `parts` are the image part
 * names, `bones` the bone names. Shape names that clash with a part or bone, bad polygons and keyforms, `follow` that is no image part,
 * unknown `clip` targets, a part clipped to itself, loops, nesting beyond MASK_MAX_SHAPES, and too many masks.
 */
export function checkMasks(data: { parameters?: unknown; parts?: unknown }, parts: Set<string>, bones: Set<string>, problem: ProblemReport): void {
  const entries = isObj(data.parts) ? data.parts : {};
  const defs = new Map<string, ParamDef>();
  if (Array.isArray(data.parameters)) for (const p of data.parameters as ParamDef[]) if (p && typeof p.id === 'string') defs.set(p.id, p);
  const shapes = new Set(shapePartNames(entries));
  for (const name of shapes) {
    const def = entries[name] as PartEntry, where = `parts.${name}`;
    if (parts.has(name)) { problem(`${where}.polygon: "${name}" is a part with art; a shape needs a name of its own`, name); continue; }
    if (bones.has(name)) problem(`${where}: shape "${name}" has the name of a bone; names are unique across parts and bones`, name);
    const poly = def.polygon as unknown;
    if (!Array.isArray(poly) || poly.length < MASK_MIN_POINTS || poly.length > MASK_MAX_POINTS) problem(`${where}.polygon: needs ${MASK_MIN_POINTS} to ${MASK_MAX_POINTS} points [x, y] in pixels of the PSD canvas`, name);
    else poly.forEach((p, k) => { if (!Array.isArray(p) || p.length !== 2 || !p.every(isNum)) problem(`${where}.polygon[${k}]: use [x, y] in pixels of the PSD canvas`, name); });
    if (def.follow !== undefined && (typeof def.follow !== 'string' || !parts.has(def.follow))) problem(`${where}.follow: no part with art named "${String(def.follow)}" (a shape follows a bone with "bone", or the drawn mesh of a part with "follow"; parts: ${[...parts].join(', ') || 'none'})`, name, String(def.follow), parts);
    if (def.clip !== undefined) problem(`${where}.clip: a shape part is not itself clipped`, name);
    if (def.keyforms !== undefined) {
      if (!Array.isArray(def.keyforms)) problem(`${where}.keyforms: needs a list`, name);
      else if (Array.isArray(poly) && poly.length >= MASK_MIN_POINTS && poly.length <= MASK_MAX_POINTS) checkPointKeyforms(def.keyforms, poly.length, `${where}.keyforms`, 'the polygon', defs, name, problem);
    }
  }
  for (const [part, def] of Object.entries(entries)) {
    if (!isObj(def) || def.clip === undefined || shapes.has(part) || !parts.has(part)) continue;
    const at = `parts.${part}.clip`, to = def.clip;
    if (typeof to !== 'string' || !(parts.has(to) || shapes.has(to))) { problem(`${at}: ${typeof to === 'string' && bones.has(to) ? `"${to}" is a bone, a clip needs a shape or a part` : `no shape or part named "${String(to)}"`} (shapes: ${[...shapes].join(', ') || 'none'})`, part); continue; }
    if (to === part) problem(`${at}: a part cannot be clipped to its own shape`, part);
  }
  // The nesting rules run on the whole set: a clip to an image part chains; a clip to a shape ends the chain.
  const all = maskView({ parts: entries });
  const loops = maskCycles(all);
  for (const loop of loops) problem(`masks: shapes form a loop (${[...loop, loop[0]].join(' > ')})`, loop[0]);
  const looped = new Set(loops.flat());
  const seen = new Set<string>();
  for (const m of all) {
    if (looped.has(m.part) || seen.has(m.part)) continue;
    seen.add(m.part);
    const chain = maskChain(all, m.part);
    if (chain.length > MASK_MAX_SHAPES) problem(`masks: "${m.part}" would be clipped through ${chain.length} shapes (${chain.map(c => c.part).join(', ')}); at most ${MASK_MAX_SHAPES} (one nested level): clip it to a part that is not itself clipped, or to a shape`, m.part);
  }
  if (all.length > MASK_WARN_COUNT) problem(`masks: ${all.length} masks on one character (more than ${MASK_WARN_COUNT}); each is stencil passes and batch breaks every frame, which has not been measured on weak phones`, 'masks');
}
