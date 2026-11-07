// The maths behind the studio's stage viewport and bone gizmos: no DOM, so node tests cover it and the editor only feeds
// pointer positions in. Points are in canvas pixels (the space of bone pivots) unless a name says screen.
//
// A bone's pose is an Offset (bones.ts): world(bone) = world(parent) . T(pivot) . T(d) . R(rot) . S(1 + sx, 1 + sy) . T(-pivot).
// So a drag changes the offset only, and every conversion goes through the parent's world matrix.

import type { Offset } from './anim.js';
import { mulMatrix, applyMatrix, offsetMatrix, type Matrix, type Box } from './bones.js';

export type GizmoPoint = [number, number];
export type GizmoTool = 'move' | 'rotate' | 'scale';
/** `local`: the gizmo's axes follow the bone (parent matrix and own rotation); `world`: they stay the canvas axes. */
export type GizmoSpace = 'local' | 'world';
/** The handle a drag started on: an axis arrow, or the free handle in the middle. */
export type GizmoAxis = 'x' | 'y' | 'free';
export interface GizmoMods { shift?: boolean; alt?: boolean }

export interface GizmoDrag {
  tool: GizmoTool;
  /** The bone's offset when the drag began; the result is relative to it, so a drag can be redone from its start. */
  start: Offset;
  /** The bone's rest pivot (canvas space). */
  pivot: GizmoPoint;
  /** The parent's world matrix (BONE_REST for a root). */
  parent: Matrix;
  /** Pixels per unit of dx / dy (as in offsetMatrix). */
  unit: number;
  /** Pointer at the drag's start and now, in canvas space. */
  from: GizmoPoint;
  to: GizmoPoint;
  mods?: GizmoMods;
  space?: GizmoSpace;
  axis?: GizmoAxis;
  /** Rest-pose point that alt scales around (the middle of the bone's parts); without it alt does nothing. */
  center?: GizmoPoint;
}

export const SNAP_DEG = 15;
const EPS = 1e-9;

export function invertMatrix(m: Matrix): Matrix | null {
  const det = m.a * m.d - m.b * m.c;
  if (!Number.isFinite(det) || Math.abs(det) < EPS) return null;
  const a = m.d / det, b = -m.b / det, c = -m.c / det, d = m.a / det;
  return { a, b, c, d, tx: -(a * m.tx + c * m.ty), ty: -(b * m.tx + d * m.ty) };
}

const linear = (m: Matrix): Matrix => ({ ...m, tx: 0, ty: 0 });
const rad = (deg: number) => (deg * Math.PI) / 180;
const norm = (v: GizmoPoint): GizmoPoint => { const l = Math.hypot(v[0], v[1]); return l < EPS ? [1, 0] : [v[0] / l, v[1] / l]; };

/** The bone's world matrix for an offset. */
export const boneWorld = (parent: Matrix, o: Offset, pivot: GizmoPoint, unit: number): Matrix => mulMatrix(parent, offsetMatrix(o, pivot, unit));

/** Where the gizmo sits and which way its axes point (unit vectors, canvas space) for a bone in its current pose. */
export function gizmoFrame(parent: Matrix, o: Offset, pivot: GizmoPoint, unit: number, space: GizmoSpace = 'local'): { origin: GizmoPoint; x: GizmoPoint; y: GizmoPoint } {
  const origin = applyMatrix(parent, pivot[0] + o.dx * unit, pivot[1] + o.dy * unit);
  if (space === 'world') return { origin, x: [1, 0], y: [0, 1] };
  const w = boneWorld(parent, o, pivot, unit);
  return { origin, x: norm([w.a, w.b]), y: norm([w.c, w.d]) };
}

/** Normalizes an angle in degrees into (-180, 180]. */
export const wrapDeg = (deg: number): number => { const r = ((deg + 180) % 360 + 360) % 360 - 180; return r === -180 ? 180 : r; };

/**
 * The bone's new offset after a pointer drag. Move shifts dx / dy (`axis` limits it to one axis of `space`); rotate turns
 * by the angle the pointer swept around the pivot, and shift snaps the resulting rot to 15 degrees; scale stretches along
 * the bone's own axes from the pivot, with shift keeping the ratio and alt scaling from `center` instead. A sweep of more
 * than half a turn from the start point wraps (the angle is read between two points, not along the path).
 */
export function dragBone(d: GizmoDrag): Offset {
  const inv = invertMatrix(d.parent);
  if (!inv) return { ...d.start };
  const o = d.start, unit = d.unit || 1;
  const mods = d.mods ?? {};
  const pToLocal = (p: GizmoPoint): GizmoPoint => applyMatrix(inv, p[0], p[1]);
  if (d.tool === 'move') {
    let delta: GizmoPoint = [d.to[0] - d.from[0], d.to[1] - d.from[1]];
    if (d.axis === 'x' || d.axis === 'y') {
      const f = gizmoFrame(d.parent, o, d.pivot, unit, d.space ?? 'local');
      const dir = d.axis === 'x' ? f.x : f.y, t = delta[0] * dir[0] + delta[1] * dir[1];
      delta = [dir[0] * t, dir[1] * t];
    }
    const l = applyMatrix(linear(inv), delta[0], delta[1]);
    return { ...o, dx: o.dx + l[0] / unit, dy: o.dy + l[1] / unit };
  }
  const centre: GizmoPoint = [d.pivot[0] + o.dx * unit, d.pivot[1] + o.dy * unit]; // the pivot in the parent's space
  if (d.tool === 'rotate') {
    const a = pToLocal(d.from), b = pToLocal(d.to);
    const sweep = (Math.atan2(b[1] - centre[1], b[0] - centre[0]) - Math.atan2(a[1] - centre[1], a[0] - centre[0])) * 180 / Math.PI;
    let rot = o.rot + wrapDeg(sweep);
    if (mods.shift) rot = Math.round(rot / SNAP_DEG) * SNAP_DEG;
    return { ...o, rot };
  }
  // scale: the anchor stays put in the parent's space while the pointer vector from it is stretched along the bone axes
  const own = offsetMatrix(o, d.pivot, unit);
  const anchorRest = mods.alt && d.center ? d.center : d.pivot;
  const anchor = applyMatrix(own, anchorRest[0], anchorRest[1]);
  const a = pToLocal(d.from), b = pToLocal(d.to);
  const cos = Math.cos(rad(o.rot)), sin = Math.sin(rad(o.rot));
  const toBone = (p: GizmoPoint): GizmoPoint => { const x = p[0] - anchor[0], y = p[1] - anchor[1]; return [cos * x + sin * y, -sin * x + cos * y]; };
  const u0 = toBone(a), u1 = toBone(b);
  const ratio = (n: number, m: number) => (Math.abs(m) < 1e-6 ? 1 : n / m);
  let fx = ratio(u1[0], u0[0]), fy = ratio(u1[1], u0[1]);
  if (d.axis === 'x') fy = mods.shift ? fx : 1;
  else if (d.axis === 'y') fx = mods.shift ? fy : 1;
  else if (mods.shift) fx = fy = u0[0] * u0[0] + u0[1] * u0[1] < EPS ? 1 : (u1[0] * u0[0] + u1[1] * u0[1]) / (u0[0] * u0[0] + u0[1] * u0[1]);
  const sx = (1 + o.sx) * fx - 1, sy = (1 + o.sy) * fy - 1;
  // keep the anchor where it was: the pivot's parent-space position absorbs the change of R.S applied to (anchor - pivot)
  const r = { x: anchorRest[0] - d.pivot[0], y: anchorRest[1] - d.pivot[1] };
  const m = (px: number, py: number) => ({ x: cos * (1 + px) * r.x - sin * (1 + py) * r.y, y: sin * (1 + px) * r.x + cos * (1 + py) * r.y });
  const before = m(o.sx, o.sy), after = m(sx, sy);
  return { ...o, sx, sy, dx: o.dx + (before.x - after.x) / unit, dy: o.dy + (before.y - after.y) / unit };
}

// ---- viewport: screen = world * zoom + pan ----

export interface StageView { zoom: number; panX: number; panY: number }
export const MIN_ZOOM = 0.05, MAX_ZOOM = 32;
export const IDENTITY_STAGE_VIEW: StageView = { zoom: 1, panX: 0, panY: 0 };

const clampZoom = (z: number, lo = MIN_ZOOM, hi = MAX_ZOOM) => Math.min(hi, Math.max(lo, z));

export const worldToScreen = (v: StageView, p: GizmoPoint): GizmoPoint => [p[0] * v.zoom + v.panX, p[1] * v.zoom + v.panY];
export const screenToWorld = (v: StageView, p: GizmoPoint): GizmoPoint => [(p[0] - v.panX) / v.zoom, (p[1] - v.panY) / v.zoom];

/** Zooms by `factor` keeping the world point under `cursor` (screen) where it is. Zoom is clamped. */
export function zoomViewAt(v: StageView, cursor: GizmoPoint, factor: number, min = MIN_ZOOM, max = MAX_ZOOM): StageView {
  const zoom = clampZoom(v.zoom * factor, min, max);
  const w = screenToWorld(v, cursor);
  return { zoom, panX: cursor[0] - w[0] * zoom, panY: cursor[1] - w[1] * zoom };
}

/** The zoom factor of one wheel event (`deltaY` > 0 scrolls away, zooming out); smooth for both notched and fine wheels. */
export const wheelFactor = (deltaY: number, speed = 0.0015): number => Math.exp(-deltaY * speed);

export const panBy = (v: StageView, dx: number, dy: number): StageView => ({ ...v, panX: v.panX + dx, panY: v.panY + dy });

/** The view that shows `box` (world) centred in a `width` x `height` screen area with `margin` screen pixels around it. */
export function fitBounds(box: Box, width: number, height: number, margin = 24, max = MAX_ZOOM): StageView {
  const aw = Math.max(1, width - 2 * margin), ah = Math.max(1, height - 2 * margin);
  if (!(box.w > 0) || !(box.h > 0)) return { ...IDENTITY_STAGE_VIEW, panX: width / 2 - box.x, panY: height / 2 - box.y };
  const zoom = clampZoom(Math.min(aw / box.w, ah / box.h), MIN_ZOOM, max);
  return { zoom, panX: width / 2 - (box.x + box.w / 2) * zoom, panY: height / 2 - (box.y + box.h / 2) * zoom };
}

/** The world size a handle needs to look `px` screen pixels across at this zoom. */
export const handleSize = (v: StageView, px: number): number => px / v.zoom;
/** The scale to give a handle drawn at its natural size of `px` world pixels so it stays that many screen pixels. */
export const handleScale = (v: StageView): number => 1 / v.zoom;


/** Index of the screen point nearest to `p` within `tol` pixels, -1 for none (a later point wins a tie, as it is drawn on top). */
export function pickPoint(points: readonly GizmoPoint[], p: GizmoPoint, tol = 10): number {
  let best = -1, bestD = tol * tol + 1e-9;
  points.forEach((q, i) => { const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2; if (d <= bestD) { best = i; bestD = d; } });
  return best;
}
