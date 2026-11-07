// Editing masks (rig.json `masks`, see masks.ts): the pure half of the animation studio's Mask section. Nothing here draws or touches
// the DOM; the studio feeds it picks from the lists and points dragged on the stage, and keeps the result as its working copy.
//
// A part has at most one mask. Its shape is another part's silhouette (`from`) or a drawn polygon (`polygon`, canvas pixels, with an
// optional `on` and keyforms that reshape it). The studio never edits keyforms; it keeps them across edits of the polygon, shifting
// their point numbers when a point is added or removed.

import type { DeformerKeyform, WarpPoints } from './params.js';
import { MASK_MAX_POINTS, MASK_MIN_POINTS, maskOf, type MaskDef, type MaskPoint } from './masks.js';

/** The shape a mask is given: another part's silhouette, or a polygon (with the bone or part it follows). */
export type MaskSource = { from: string } | { polygon: MaskPoint[]; on?: string };
/** A part's image box in canvas pixels. */
export interface CanvasBox { x: number; y: number; w: number; h: number }

const round = (n: number): number => Math.round(n) + 0;

/** A mask id for `part` that no mask has yet: `<part>_mask`, then `<part>_mask_2`, and so on. */
export function maskId(masks: readonly MaskDef[], part: string): string {
  const taken = new Set(masks.map(m => m?.id));
  let id = `${part}_mask`;
  for (let i = 2; taken.has(id); i++) id = `${part}_mask_${i}`;
  return id;
}

/**
 * `masks` with `part` clipped to `source`: a new mask, or the part's own one given another shape (its id stays). Changing from a
 * polygon to a part drops the polygon, `on` and keyforms; a polygon given to a polygon mask keeps `on` and the keyforms.
 */
export function setMask(masks: readonly MaskDef[], part: string, source: MaskSource): MaskDef[] {
  const old = maskOf(masks, part);
  const next: MaskDef = 'from' in source
    ? { id: old?.id ?? maskId(masks, part), part, from: source.from }
    : { id: old?.id ?? maskId(masks, part), part, polygon: source.polygon.map(p => [p[0], p[1]] as MaskPoint), ...(source.on ?? old?.on ? { on: source.on ?? old?.on } : {}), ...(old?.polygon && old.keyforms ? { keyforms: old.keyforms } : {}) };
  return old ? masks.map(m => (m === old ? next : m)) : [...masks, next];
}

/** `masks` without the mask clipping `part` (the same list when it has none). */
export function removeMask(masks: readonly MaskDef[], part: string): MaskDef[] | readonly MaskDef[] {
  return maskOf(masks, part) ? masks.filter(m => m?.part !== part) : masks;
}

/** A rectangle inset by `inset` (a share of the box on each side), clockwise from the top left: where a new drawn shape starts. */
export function defaultPolygon(box: CanvasBox, inset = 0.12): MaskPoint[] {
  const x0 = round(box.x + box.w * inset), x1 = round(box.x + box.w * (1 - inset)), y0 = round(box.y + box.h * inset), y1 = round(box.y + box.h * (1 - inset));
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

/** `def` with the polygon followed on `on` (a bone or part); null or an empty name leaves it on the character. */
export function setMaskOn(def: MaskDef, on: string | null): MaskDef {
  const { on: _was, ...rest } = def;
  return on ? { ...rest, on } : rest;
}

/** `def` with polygon point `i` at `to` (canvas pixels, rounded to whole ones); the same object when it does not move or `i` is no point. */
export function movePolygonPoint(def: MaskDef, i: number, to: MaskPoint): MaskDef {
  const poly = def.polygon;
  if (!poly || !Number.isInteger(i) || i < 0 || i >= poly.length || !to.every(Number.isFinite)) return def;
  const p: MaskPoint = [round(to[0]), round(to[1])];
  if (poly[i][0] === p[0] && poly[i][1] === p[1]) return def;
  return { ...def, polygon: poly.map((q, k) => (k === i ? p : q)) };
}

/** Point numbers of sparse `pts` from `from` on shifted by `by`; a point that would land below `from` when removing (by = -1) is dropped. */
function shiftPts(pts: WarpPoints | undefined, from: number, by: 1 | -1): WarpPoints | undefined {
  if (!pts) return pts;
  const out: WarpPoints = {};
  for (const [k, p] of Object.entries(pts)) {
    const i = Number(k);
    if (!Number.isInteger(i)) { out[k] = p; continue; }
    if (by === -1 && i === from) continue;
    out[String(i >= from + (by === 1 ? 0 : 1) ? i + by : i)] = p;
  }
  return Object.keys(out).length ? out : undefined;
}
function shiftKeyforms(kfs: DeformerKeyform[] | undefined, from: number, by: 1 | -1): DeformerKeyform[] | undefined {
  if (!kfs) return kfs;
  const put = <T extends { pts?: WarpPoints }>(x: T): T => { const { pts, ...rest } = x; const next = shiftPts(pts, from, by); return (next ? { ...rest, pts: next } : rest) as T; };
  return kfs.map(k => ({ ...k, ...(k.keys ? { keys: k.keys.map(put) } : {}), ...(k.forms ? { forms: k.forms.map(put) } : {}) }));
}

/** `def` with a new point `p` inserted before point `at` (`at` = the point count appends); the keyforms' point numbers follow. The same object at the point cap. */
export function insertPolygonPoint(def: MaskDef, at: number, p: MaskPoint): MaskDef {
  const poly = def.polygon;
  if (!poly || poly.length >= MASK_MAX_POINTS || !Number.isInteger(at) || at < 0 || at > poly.length || !p.every(Number.isFinite)) return def;
  const next = [...poly.slice(0, at), [round(p[0]), round(p[1])] as MaskPoint, ...poly.slice(at)];
  const keyforms = shiftKeyforms(def.keyforms, at, 1);
  return { ...def, polygon: next, ...(keyforms ? { keyforms } : {}) };
}

/** `def` without polygon point `i`; null (nothing changes) when the shape would be left with fewer than three points. */
export function removePolygonPoint(def: MaskDef, i: number): MaskDef | null {
  const poly = def.polygon;
  if (!poly || poly.length <= MASK_MIN_POINTS || !Number.isInteger(i) || i < 0 || i >= poly.length) return null;
  const keyforms = shiftKeyforms(def.keyforms, i, -1);
  return { ...def, polygon: poly.filter((_, k) => k !== i), ...(keyforms ? { keyforms } : {}) };
}

/** The edge of the closed polygon `poly` nearest to `p`: the number of the point it starts at (it ends at the next one), the nearest point on it and the distance. Null for fewer than two points. */
export function nearestEdge(poly: readonly MaskPoint[], p: MaskPoint): { index: number; at: MaskPoint; dist: number } | null {
  if (poly.length < 2) return null;
  let best: { index: number; at: MaskPoint; dist: number } | null = null;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
    const at: MaskPoint = [a[0] + dx * t, a[1] + dy * t], dist = Math.hypot(p[0] - at[0], p[1] - at[1]);
    if (!best || dist < best.dist) best = { index: i, at, dist };
  }
  return best;
}

/** The point halfway along the edge from point `i` to the next, for "add a point after this one" from the keyboard. */
export function edgeMidpoint(poly: readonly MaskPoint[], i: number): MaskPoint | null {
  if (!poly.length || !Number.isInteger(i) || i < 0 || i >= poly.length) return null;
  const a = poly[i], b = poly[(i + 1) % poly.length];
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

/** The parts a mask on `part` could take its shape from: every other part, in the order given. */
export const maskSources = (parts: readonly string[], part: string): string[] => parts.filter(p => p !== part);

/** What a mask of `part` is, in a few words, for a section header and a note: its source, or none. */
export function maskSummary(masks: readonly MaskDef[], part: string | null): string {
  if (part) {
    const m = maskOf(masks, part);
    if (m) return m.from !== undefined ? `to ${m.from}` : `polygon, ${m.polygon?.length ?? 0} points`;
  }
  return masks.length ? `${masks.length} mask${masks.length === 1 ? '' : 's'}` : 'none';
}
