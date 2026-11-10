// The bone tree of a layered character (rig.json `bones`): pure maths from rest pivots and animated offsets to one
// world matrix per bone, in PSD canvas pixels. Nothing here draws; the renderer (a later phase) feeds it.
//
//   world(bone) = world(parent) . T(pivot) . offset . T(-pivot),   offset = T(dx, dy) . R(rot) . S(1 + sx, 1 + sy)
//
// Pivots are read in the canvas space of the bind pose, so a child at rest needs no knowledge of its parent: only
// offsets accumulate down the tree.

import { NO_OFFSET, type Offset } from './anim.js';
import { isPoint } from './geometry.js';

/** `tip` is where a bone ends, [x, y] in canvas pixels like `pivot`: it moves nothing, it only shapes auto-weights (skin-edit.ts) and the studio's drawing. */
export interface BoneDef { parent?: string; pivot?: [number, number]; tip?: [number, number] }
/** A matrix as Pixi writes it: x' = a x + c y + tx, y' = b x + d y + ty. */
export interface Matrix { a: number; b: number; c: number; d: number; tx: number; ty: number }
export interface Box { x: number; y: number; w: number; h: number }

export const BONE_REST: Matrix = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

/** `m` after `n`: applying the result to a point applies `n` first, then `m`. */
export const mulMatrix = (m: Matrix, n: Matrix): Matrix => ({
  a: m.a * n.a + m.c * n.b, b: m.b * n.a + m.d * n.b,
  c: m.a * n.c + m.c * n.d, d: m.b * n.c + m.d * n.d,
  tx: m.a * n.tx + m.c * n.ty + m.tx, ty: m.b * n.tx + m.d * n.ty + m.ty,
});
export const applyMatrix = (m: Matrix, x: number, y: number): [number, number] => [m.a * x + m.c * y + m.tx, m.b * x + m.d * y + m.ty];


/** The bones whose `parent` chain loops back on itself, each loop listed once starting at its first bone in file order. */
export function boneCycles(bones: Record<string, BoneDef>): string[][] {
  const out: string[][] = [], seen = new Set<string>();
  for (const start of Object.keys(bones)) {
    const path: string[] = [];
    let cur: string | undefined = start;
    while (cur !== undefined && Object.hasOwn(bones, cur) && !path.includes(cur) && !seen.has(cur)) { path.push(cur); cur = bones[cur]?.parent; }
    if (cur !== undefined && path.includes(cur)) out.push(path.slice(path.indexOf(cur)));
    for (const p of path) seen.add(p);
  }
  return out;
}

/** The parent of `bone` when it is another bone of the tree and not part of a loop; null for a root. */
function parentOf(bones: Record<string, BoneDef>, bone: string, looped: Set<string>): string | null {
  const p = bones[bone]?.parent;
  return typeof p === 'string' && p !== bone && Object.hasOwn(bones, p) && !looped.has(bone) ? p : null;
}

/** Bone names with every parent before its children (unknown parents and loops count as roots). */
export function boneOrder(bones: Record<string, BoneDef>): string[] {
  const looped = new Set(boneCycles(bones).flat());
  const out: string[] = [], done = new Set<string>();
  const visit = (b: string) => {
    if (done.has(b)) return;
    done.add(b);
    const p = parentOf(bones, b, looped);
    if (p) visit(p);
    out.push(b);
  };
  Object.keys(bones).forEach(visit);
  return out;
}

/**
 * Where each bone turns, in canvas pixels: its own `pivot`; else its parent's; else (a root) the middle of the boxes of
 * the parts on it and its descendants; else `origin` (the character origin, bottom middle). `boxes` lists the parts'
 * image boxes by the bone they sit on.
 */
export function resolvePivots(bones: Record<string, BoneDef>, boxes: Record<string, Box[]> = {}, origin: [number, number] = [0, 0]): Record<string, [number, number]> {
  const looped = new Set(boneCycles(bones).flat());
  const order = boneOrder(bones);
  const kids = new Map<string, string[]>();
  for (const b of order) { const p = parentOf(bones, b, looped); if (p) kids.set(p, [...(kids.get(p) ?? []), b]); }
  const subtree = (b: string): Box[] => [...(Object.hasOwn(boxes, b) ? boxes[b] : []), ...(kids.get(b) ?? []).flatMap(subtree)];
  const out: Record<string, [number, number]> = {};
  for (const b of order) {
    const own = bones[b]?.pivot, p = parentOf(bones, b, looped);
    if (isPoint(own)) { out[b] = [own[0], own[1]]; continue; }
    if (p) { out[b] = out[p]; continue; }
    const all = subtree(b);
    if (!all.length) { out[b] = origin; continue; }
    const x0 = Math.min(...all.map(r => r.x)), y0 = Math.min(...all.map(r => r.y));
    const x1 = Math.max(...all.map(r => r.x + r.w)), y1 = Math.max(...all.map(r => r.y + r.h));
    out[b] = [(x0 + x1) / 2, (y0 + y1) / 2];
  }
  return out;
}

/** The matrix of one offset about a pivot: T(pivot) . T(dx, dy) . R(rot) . S(1 + sx, 1 + sy) . T(-pivot). `unit` is how many pixels a dx or dy of 1 is. */
export function offsetMatrix(o: Offset, pivot: [number, number], unit: number): Matrix {
  const r = (o.rot * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r), sx = 1 + o.sx, sy = 1 + o.sy;
  const a = cos * sx, b = sin * sx, c = -sin * sy, d = cos * sy;
  return {
    a, b, c, d,
    tx: pivot[0] + o.dx * unit - (a * pivot[0] + c * pivot[1]),
    ty: pivot[1] + o.dy * unit - (b * pivot[0] + d * pivot[1]),
  };
}

export interface PlacedPart { box: Box; bone?: string; pivot?: [number, number] }

/** The parts on `name` (a bone) or on any bone below it; a part's own name gives just itself. */
export function partsUnder(bones: Record<string, BoneDef>, onBone: Record<string, string | undefined>, name: string): string[] {
  if (!Object.hasOwn(bones, name)) return [];
  const looped = new Set(boneCycles(bones).flat());
  const inside = (b: string | undefined): boolean => {
    for (let cur = b, i = 0; cur !== undefined && Object.hasOwn(bones, cur) && i <= Object.keys(bones).length; i++) {
      if (cur === name) return true;
      cur = parentOf(bones, cur, looped) ?? undefined;
    }
    return false;
  };
  return Object.keys(onBone).filter(p => inside(onBone[p]));
}

/**
 * The matrix each part is drawn with. A part follows the world matrix of its bone, with its own animated offset on top,
 * turning about its own `pivot`, else its bone's pivot, else the middle of its box. A part on no bone is just its own
 * offset. `pivotOf` gives a part's own pivot by part name (rig.json `pivots`). All coordinates share one space (the caller's).
 */
export function placeParts(bones: Record<string, BoneDef>, parts: Record<string, PlacedPart>, offsets: ReadonlyMap<string, Offset>, pivotOf: (part: string) => [number, number] | null, origin: [number, number], unit: number): Record<string, Matrix> {
  return placeRig(bones, parts, offsets, pivotOf, origin, unit).parts;
}

/**
 * placeParts, and the world matrix of every bone too (what something that follows a bone but is no part, such as a mask polygon, is drawn with).
 * A part in `skinned` (its mesh has bone weights, docs/design/skinning.md) is drawn with the rest matrix: its bone does not move it, the
 * weights do. Its own offset is not put on that matrix either but handed back in `keys`, to be applied to its vertices before the skin.
 */
export function placeRig(bones: Record<string, BoneDef>, parts: Record<string, PlacedPart>, offsets: ReadonlyMap<string, Offset>, pivotOf: (part: string) => [number, number] | null, origin: [number, number], unit: number, skinned: ReadonlySet<string> = new Set()): { parts: Record<string, Matrix>; bones: Record<string, Matrix>; keys: Record<string, Matrix> } {
  const boxes: Record<string, Box[]> = {};
  for (const [, p] of Object.entries(parts)) if (p.bone !== undefined && Object.hasOwn(bones, p.bone)) (boxes[p.bone] ??= []).push(p.box);
  const pivots = resolvePivots(bones, boxes, origin);
  const world = composeBones(bones, new Map([...offsets].filter(([n]) => !Object.hasOwn(parts, n))), pivots, unit); // a name that is also a part moves the part only
  const out: Record<string, Matrix> = {}, keys: Record<string, Matrix> = {};
  for (const [name, p] of Object.entries(parts)) {
    const bone = p.bone !== undefined && Object.hasOwn(bones, p.bone) ? p.bone : undefined;
    const own = offsets.get(name), skin = skinned.has(name);
    const base = bone && !skin ? world[bone] : BONE_REST;
    if (!own) { out[name] = base; continue; }
    const pv = pivotOf(name) ?? (isPoint(p.pivot) ? p.pivot : bone ? pivots[bone] : [p.box.x + p.box.w / 2, p.box.y + p.box.h / 2] as [number, number]);
    const key = offsetMatrix(own, pv, unit);
    if (skin) { out[name] = base; keys[name] = key; } else out[name] = mulMatrix(base, key);
  }
  return { parts: out, bones: world, keys };
}

/**
 * The world matrix of every bone, in canvas pixels, from the animated `offsets` by bone name (a bone without one stays
 * at rest). Offsets compose down the tree: a bone carries everything below it. Unknown parents and loops make a root.
 */
export function composeBones(bones: Record<string, BoneDef>, offsets: ReadonlyMap<string, Offset>, pivots: Record<string, [number, number]>, unit: number): Record<string, Matrix> {
  const looped = new Set(boneCycles(bones).flat());
  const out: Record<string, Matrix> = {};
  for (const b of boneOrder(bones)) {
    const p = parentOf(bones, b, looped);
    const local = offsetMatrix(offsets.get(b) ?? NO_OFFSET, pivots[b] ?? [0, 0], unit);
    out[b] = p ? mulMatrix(out[p], local) : local;
  }
  return out;
}
