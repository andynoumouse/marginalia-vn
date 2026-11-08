// What the studio's stage needs around gizmo.ts: which matrix and pivot a chosen bone or part has in its pose, where the
// gizmo's handles sit on the screen and which one a pointer is on, and how a finished drag becomes a key. No DOM.

import { NO_OFFSET, keyframeParts, type AnimDef, type KeyDef, type Offset } from './anim.js';
import { addKey } from './anim-edit.js';
import { BONE_REST, boneCycles, composeBones, partsUnder, resolvePivots, type BoneDef, type Box, type Matrix, type PlacedPart } from './bones.js';
import type { GizmoAxis, GizmoPoint, GizmoTool } from './gizmo.js';

/** The rig as the renderer lays it out: bones, the parts (boxes in the same space as the pivots), and the part pivots by part name. */
export interface RigGeometry {
  bones: Record<string, BoneDef>;
  parts: Record<string, PlacedPart>;
  pivotOf: (part: string) => GizmoPoint | null;
  /** Pixels a dx or dy of 1 is. */
  unit: number;
  /** The character origin in that space. */
  origin?: GizmoPoint;
}

/** What `dragBone` needs for one bone or part. */
export interface GizmoTarget {
  name: string;
  kind: 'bone' | 'part';
  /** The world matrix of what it hangs on (BONE_REST for a root, or a part on no bone). */
  parent: Matrix;
  /** Where it turns (rest space). */
  pivot: GizmoPoint;
  /** Its own offset in the pose being shown. */
  offset: Offset;
  /** The middle of its parts (alt scales from here). */
  center: GizmoPoint;
}

const mid = (b: Box): GizmoPoint => [b.x + b.w / 2, b.y + b.h / 2];
const isPoint = (p: unknown): p is GizmoPoint => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);

/** The target for `name` (a part, else a bone) posed with `offsets` (by part or bone name); null when the rig has no such name. */
export function gizmoTarget(g: RigGeometry, offsets: ReadonlyMap<string, Offset>, name: string): GizmoTarget | null {
  const origin = g.origin ?? [0, 0];
  const isPart = Object.hasOwn(g.parts, name), isBone = Object.hasOwn(g.bones, name);
  if (!isPart && !isBone) return null;
  const boxes: Record<string, Box[]> = {};
  for (const p of Object.values(g.parts)) if (p.bone !== undefined && Object.hasOwn(g.bones, p.bone)) (boxes[p.bone] ??= []).push(p.box);
  const pivots = resolvePivots(g.bones, boxes, origin);
  const world = composeBones(g.bones, new Map([...offsets].filter(([n]) => !Object.hasOwn(g.parts, n))), pivots, g.unit);
  const looped = new Set(boneCycles(g.bones).flat());
  const hang = (b: string | undefined): Matrix => (b !== undefined && Object.hasOwn(g.bones, b) ? world[b] : BONE_REST);
  if (isPart) {
    const p = g.parts[name], bone = p.bone !== undefined && Object.hasOwn(g.bones, p.bone) ? p.bone : undefined;
    const pivot = g.pivotOf(name) ?? (isPoint(p.pivot) ? p.pivot : bone ? pivots[bone] : mid(p.box));
    return { name, kind: 'part', parent: hang(bone), pivot, offset: offsets.get(name) ?? NO_OFFSET, center: mid(p.box) };
  }
  const par = g.bones[name].parent;
  const parent = typeof par === 'string' && !looped.has(name) && Object.hasOwn(g.bones, par) ? par : undefined;
  const onBone = Object.fromEntries(Object.entries(g.parts).map(([n, p]) => [n, p.bone]));
  const under = partsUnder(g.bones, onBone, name).map(n => g.parts[n].box);
  let center = pivots[name];
  if (under.length) {
    const x0 = Math.min(...under.map(b => b.x)), y0 = Math.min(...under.map(b => b.y));
    const x1 = Math.max(...under.map(b => b.x + b.w)), y1 = Math.max(...under.map(b => b.y + b.h));
    center = [(x0 + x1) / 2, (y0 + y1) / 2];
  }
  return { name, kind: 'bone', parent: hang(parent), pivot: pivots[name], offset: offsets.get(name) ?? NO_OFFSET, center };
}

/** `b - a`, field by field. */
export const offsetDelta = (a: Offset, b: Offset): Offset => ({ dx: b.dx - a.dx, dy: b.dy - a.dy, sx: b.sx - a.sx, sy: b.sy - a.sy, rot: b.rot - a.rot });
export const sumOffset = (a: Offset, b: Offset): Offset => ({ dx: a.dx + b.dx, dy: a.dy + b.dy, sx: a.sx + b.sx, sy: a.sy + b.sy, rot: a.rot + b.rot });
export const isNoOffset = (o: Offset): boolean => o.dx === 0 && o.dy === 0 && o.sx === 0 && o.sy === 0 && o.rot === 0;

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** The value of each key channel of `def` for `name` at progress `t` (the animation's own, no parameters). */
export function keyedOffset(def: AnimDef, name: string, t: number): Offset {
  const o = keyframeParts(def)?.(Math.min(1, Math.max(0, t)))[name];
  return { ...NO_OFFSET, ...o };
}

/**
 * `def` with a key for `name` at `t` that carries `delta` (what a drag added to the pose) on top of what the animation already
 * has there. Only the channels the tool changes are written: move x and y, rotate rot, scale `scale` (keys scale evenly, so the
 * two axes are averaged). A key already at `t` is updated.
 */
export function keyFromDelta(def: AnimDef, name: string, t: number, tool: GizmoTool, delta: Offset): AnimDef {
  const base = keyedOffset(def, name, t);
  const key: KeyDef = { t, part: name };
  if (tool === 'move') { key.x = round4(base.dx + delta.dx); key.y = round4(base.dy + delta.dy); }
  else if (tool === 'rotate') key.rot = round4(base.rot + delta.rot);
  else key.scale = round4((base.sx + base.sy) / 2 + (delta.sx + delta.sy) / 2);
  return addKey(def, key).def;
}

// ---- handles ----

export interface GizmoFrameScreen { origin: GizmoPoint; /** unit axes on the screen */ x: GizmoPoint; y: GizmoPoint }
export interface GizmoHandle { axis: GizmoAxis; kind: 'arrow' | 'box' | 'ring'; at: GizmoPoint; /** the arrow's or ring's other end / the ring's radius */ to?: GizmoPoint; radius: number }
export const GIZMO_LEN = 90, GIZMO_RING = 64;

/** The handles of `tool` for a frame, in screen pixels (so they keep their size at any zoom). */
export function gizmoHandles(tool: GizmoTool, f: GizmoFrameScreen, len = GIZMO_LEN, ring = GIZMO_RING): GizmoHandle[] {
  const tip = (v: GizmoPoint): GizmoPoint => [f.origin[0] + v[0] * len, f.origin[1] + v[1] * len];
  if (tool === 'rotate') return [{ axis: 'free', kind: 'ring', at: f.origin, radius: ring }];
  const kind = tool === 'move' ? 'arrow' : 'box';
  return [
    { axis: 'x', kind, at: tip(f.x), to: f.origin, radius: 9 },
    { axis: 'y', kind, at: tip(f.y), to: f.origin, radius: 9 },
    { axis: 'free', kind: 'box', at: f.origin, radius: 9 },
  ];
}

const segDist = (p: GizmoPoint, a: GizmoPoint, b: GizmoPoint): number => {
  const vx = b[0] - a[0], vy = b[1] - a[1], l2 = vx * vx + vy * vy;
  const t = l2 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / l2)) : 0;
  return Math.hypot(p[0] - (a[0] + vx * t), p[1] - (a[1] + vy * t));
};

/** The handle under screen point `p` (the tips and the middle first, then the shafts and the ring), or null. */
export function pickHandle(handles: GizmoHandle[], p: GizmoPoint, tol = 6): GizmoHandle | null {
  const near = (h: GizmoHandle) => Math.hypot(p[0] - h.at[0], p[1] - h.at[1]) <= h.radius + tol * 0.5;
  const tips = handles.filter(h => h.axis !== 'free' && near(h));
  if (tips.length) return tips[0];
  const centre = handles.find(h => h.kind === 'box' && h.axis === 'free' && near(h));
  if (centre) return centre;
  for (const h of handles) {
    if (h.kind === 'ring' && Math.abs(Math.hypot(p[0] - h.at[0], p[1] - h.at[1]) - h.radius) <= tol) return h;
    if (h.kind === 'arrow' && h.to && segDist(p, h.to, h.at) <= tol) return h;
    if (h.kind === 'box' && h.to && h.axis !== 'free' && segDist(p, h.to, h.at) <= tol) return h;
  }
  return null;
}
