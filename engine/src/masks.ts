// Masks (rig.json `masks`): a part is clipped to a shape, so an iris stays inside the eye and a tongue inside the mouth.
// Pure data and geometry; the renderer (preview/pixi-renderer.ts) turns a shape into a Pixi stencil mask and nothing here draws.
//
//   mask:    { id, part, from | polygon, on?, keyforms? }. `part` is the part that is clipped (a slot or layer, one mask each).
//   shape:   `from` is another part, whose visible silhouette (its opaque pixels, traced by traceOutline) is the shape; it
//            follows that part's bone, animation, keyforms and warp. `polygon` is a drawn shape, points [x, y] in pixels
//            of the PSD canvas; `on` names the bone or part it follows (the character when left out), and `keyforms`
//            (the shape of DeformerKeyform: `pts` are per-vertex displacements in stage fractions) reshape it with
//            parameters, so the eyelid of a blink can close its mask.
//   nesting: a part whose `from` part is itself masked is clipped by both shapes (nested stencils). One level of nesting is
//            allowed (two shapes in all); a loop, or a chain of three, is a checkRig error.
//
// Stencil masks are hard-edged; soft alpha masks would need render textures and are not offered (docs/design/animation-studio-parameters.md).

import { checkPointKeyforms, type DeformerKeyform, type ParamDef } from './params.js';
import { isNum } from './util.js';

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
}

export const MASK_MIN_POINTS = 3;
export const MASK_MAX_POINTS = 64;
/** The shapes one part may be clipped by, counting those it inherits through `from` (one nested level). */
export const MASK_MAX_SHAPES = 2;
/** Masks per character above which checkRig and the renderer warn: each is stencil passes and batch breaks every frame, unmeasured on weak phones. */
export const MASK_WARN_COUNT = 8;

const MASK_KEYS = ['id', 'part', 'from', 'polygon', 'on', 'keyforms'];

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

const signedArea = (pts: readonly MaskPoint[]): number => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
};

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
  const stride = w + 1, vertex = (x: number, y: number) => y * stride + x;
  for (const { id } of keep) {
    // The boundary edges of the blob, each running with the blob on its right (clockwise on screen): along the top of a pixel to the
    // right, down its right side, back along the bottom and up the left. They chain into closed loops; only a clockwise one is an
    // outer outline (a hole runs the other way).
    const edges: [number, number, number, number][] = [], from = new Map<number, number[]>();
    const add = (x0: number, y0: number, x1: number, y1: number) => {
      const k = vertex(x0, y0), list = from.get(k);
      if (list) list.push(edges.length); else from.set(k, [edges.length]);
      edges.push([x0, y0, x1, y1]);
    };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (label[y * w + x] !== id) continue;
      if (y === 0 || label[(y - 1) * w + x] !== id) add(x, y, x + 1, y);
      if (x === w - 1 || label[y * w + x + 1] !== id) add(x + 1, y, x + 1, y + 1);
      if (y === h - 1 || label[(y + 1) * w + x] !== id) add(x + 1, y + 1, x, y + 1);
      if (x === 0 || label[y * w + x - 1] !== id) add(x, y + 1, x, y);
    }
    const used = new Uint8Array(edges.length);
    let best: MaskPoint[] | null = null, bestArea = 0;
    for (let e0 = 0; e0 < edges.length; e0++) {
      if (used[e0]) continue;
      const steps: MaskPoint[] = [];
      let e = e0;
      for (;;) {
        used[e] = 1;
        const [x0, y0, x1, y1] = edges[e];
        steps.push([x0, y0]);
        const next = (from.get(vertex(x1, y1)) ?? []).find(k => !used[k]);
        if (next === undefined) break;
        e = next;
      }
      // Only corners are kept: a vertex between two steps in one direction is dropped.
      const loop = steps.filter((p, i) => {
        const a = steps[(i + steps.length - 1) % steps.length], b = steps[(i + 1) % steps.length];
        return (p[0] - a[0]) * (b[1] - p[1]) !== (p[1] - a[1]) * (b[0] - p[0]);
      });
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

// ---- checks ----


/**
 * Problems in the `masks` section. `parts` are the part names, `bones` the bone names (a mask clips a part; a polygon may follow
 * a bone or a part). Unknown ids, a part with two masks, a mask that names neither or both of `from` and `polygon`, loops of
 * `from`, nesting beyond MASK_MAX_SHAPES, bad polygons and keyforms, and too many masks.
 */
export function checkMasks(data: { masks?: unknown; parameters?: unknown }, parts: Set<string>, bones: Set<string>, problem: (message: string, at: string) => void): void {
  if (data.masks === undefined) return;
  if (!Array.isArray(data.masks)) { problem('masks: needs a list of { id, part, from or polygon }', 'masks'); return; }
  const defs = new Map<string, ParamDef>();
  if (Array.isArray(data.parameters)) for (const p of data.parameters as ParamDef[]) if (p && typeof p.id === 'string') defs.set(p.id, p);
  const partList = () => [...parts].join(', ') || 'none';
  const ids = new Set<string>(), onPart = new Map<string, string>();
  const good: MaskDef[] = [];
  const needPart = (v: unknown, where: string, id: string): boolean => {
    if (typeof v === 'string' && parts.has(v)) return true;
    problem(`${where}: ${typeof v === 'string' && bones.has(v) ? `"${v}" is a bone, a mask needs a part` : `no part named "${String(v)}"`} (parts: ${partList()})`, id);
    return false;
  };
  (data.masks as MaskDef[]).forEach((m, i) => {
    const at = `masks[${i}]`;
    if (!m || typeof m !== 'object' || Array.isArray(m)) { problem(`${at}: not a mask`, 'masks'); return; }
    if (typeof m.id !== 'string' || !m.id) { problem(`${at}: needs an id`, 'masks'); return; }
    const where = `masks.${m.id}`;
    if (ids.has(m.id)) problem(`masks: "${m.id}" is defined twice`, m.id);
    ids.add(m.id);
    for (const k of Object.keys(m)) if (!MASK_KEYS.includes(k)) problem(`${where}.${k}: unknown field (${MASK_KEYS.join(', ')})`, m.id);
    const partOk = needPart(m.part, `${where}.part`, m.id);
    if (partOk) {
      const other = onPart.get(m.part);
      if (other !== undefined) problem(`${where}.part: part "${m.part}" already has mask "${other}" (one per part)`, m.id);
      else onPart.set(m.part, m.id);
    }
    const hasFrom = m.from !== undefined, hasPoly = m.polygon !== undefined;
    if (hasFrom === hasPoly) problem(`${where}: give either "from" (a part whose shape clips it) or "polygon" (points [x, y]), ${hasFrom ? 'not both' : 'one of them'}`, m.id);
    let fromOk = false;
    if (hasFrom && needPart(m.from, `${where}.from`, m.id)) {
      fromOk = true;
      if (m.from === m.part) { problem(`${where}.from: a part cannot be clipped to its own shape`, m.id); fromOk = false; }
    }
    let n = 0;
    if (hasPoly) {
      const poly = m.polygon as unknown;
      if (!Array.isArray(poly) || poly.length < MASK_MIN_POINTS || poly.length > MASK_MAX_POINTS) problem(`${where}.polygon: needs ${MASK_MIN_POINTS} to ${MASK_MAX_POINTS} points [x, y] in pixels of the PSD canvas`, m.id);
      else {
        n = poly.length;
        poly.forEach((p, k) => { if (!Array.isArray(p) || p.length !== 2 || !p.every(isNum)) problem(`${where}.polygon[${k}]: use [x, y] in pixels of the PSD canvas`, m.id); });
      }
    }
    if (m.on !== undefined) {
      if (!hasPoly) problem(`${where}.on: only a polygon has "on"; a "from" mask follows that part`, m.id);
      else if (typeof m.on !== 'string' || !(parts.has(m.on) || bones.has(m.on))) problem(`${where}.on: no part or bone named "${String(m.on)}"`, m.id);
    }
    if (m.keyforms !== undefined) {
      if (!hasPoly) problem(`${where}.keyforms: only a polygon can be reshaped by parameters; a "from" mask takes the shape of its part`, m.id);
      else if (!Array.isArray(m.keyforms)) problem(`${where}.keyforms: needs a list`, m.id);
      else if (n) checkPointKeyforms(m.keyforms, n, `${where}.keyforms`, 'the polygon', defs, m.id, problem);
    }
    if (partOk && (fromOk || hasPoly)) good.push(m);
  });
  for (const loop of maskCycles(good)) problem(`masks: shapes form a loop (${[...loop, loop[0]].join(' > ')})`, onPart.get(loop[0]) ?? 'masks');
  const looped = new Set(maskCycles(good).flat());
  for (const m of good) {
    if (looped.has(m.part)) continue;
    const chain = maskChain(good, m.part);
    if (chain.length > MASK_MAX_SHAPES) problem(`masks.${m.id}: "${m.part}" would be clipped through ${chain.length} shapes (${chain.map(c => c.id).join(', ')}); at most ${MASK_MAX_SHAPES} (one nested level): clip it to a part that is not itself clipped, or a polygon`, m.id);
  }
  if (ids.size > MASK_WARN_COUNT) problem(`masks: ${ids.size} masks on one character (more than ${MASK_WARN_COUNT}); each is stencil passes and batch breaks every frame, which has not been measured on weak phones`, 'masks');
}
