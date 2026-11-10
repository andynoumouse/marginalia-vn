// Editing mask shapes (rig.json shape parts and `clip` links, see masks.ts): the pure half of the animation studio's Clip sub-block and Mask tool.
// Nothing here draws or touches the DOM; the studio feeds it picks from the lists and points dragged on the stage, and keeps the
// result as its working copy.
//
// The working copy is a `ShapeSet`: the shape parts by name, the `clip` link of each clipped part, and the deformers (a group warp lists
// a shape among its `members`, so a rename or a delete has to reach them). A shape is one entry however many parts it clips. The studio
// never edits keyforms; it keeps them across edits of the polygon, shifting their point numbers when a point is added or removed.

import type { DeformerDef, DeformerKeyform, WarpPoints } from './params.js';
import { MASK_MAX_POINTS, MASK_MAX_SHAPES, MASK_MIN_POINTS, type MaskPoint, type ShapeDef } from './masks.js';
import { nearestOnSegment, pointInPolygon, signedArea } from './geometry.js';
import { freeName } from './util.js';

/** A part's image box in canvas pixels. */
export interface CanvasBox { x: number; y: number; w: number; h: number }
/** What the Clip sub-block edits: shape parts by name, clipped part to the shape or part it is clipped to, and the deformers that list shapes as members. */
export interface ShapeSet { shapes: Record<string, ShapeDef>; clips: Record<string, string>; deformers: DeformerDef[] }
/** The names a shape must not take: image parts and bones (the shapes themselves are in the set). */
export interface ShapeNames { parts: Iterable<string>; bones: Iterable<string> }
/** An edit's answer: the new set and a note saying what changed, or why it was refused. */
export type ShapeEdit = { set: ShapeSet; note: string; name?: string } | { error: string };

const round = (n: number): number => Math.round(n) + 0;
const without = <T>(o: Record<string, T>, k: string): Record<string, T> => { const { [k]: _gone, ...rest } = o; return rest; };

/** `base`, then `base_2`, `base_3` ... the first that is not in `taken`. */
export const uniqueName = (taken: Iterable<string>, base: string): string => freeName(taken, base, '_');
/** Every name a shape would clash with: the shapes, image parts and bones. */
const allNames = (set: ShapeSet, names: ShapeNames, except?: string): Set<string> => {
  const out = new Set<string>([...names.parts, ...names.bones, ...Object.keys(set.shapes)]);
  if (except !== undefined) out.delete(except);
  return out;
};

/** A rectangle inset by `inset` (a share of the box on each side), clockwise from the top left: where a new drawn shape starts. */
export function defaultPolygon(box: CanvasBox, inset = 0.12): MaskPoint[] {
  const x0 = round(box.x + box.w * inset), x1 = round(box.x + box.w * (1 - inset)), y0 = round(box.y + box.h * inset), y1 = round(box.y + box.h * (1 - inset));
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

// ---- shapes and clips ----

/** The longest run of clips from `part` (a clip to an image part continues with that part's own clip; a clip to a shape ends it), or null for a loop. */
function chainLength(clips: Readonly<Record<string, string>>, shapes: Readonly<Record<string, unknown>>, part: string): number | null {
  const seen = new Set<string>();
  let n = 0;
  for (let cur: string | undefined = part; cur !== undefined && Object.hasOwn(clips, cur); ) {
    if (seen.has(cur)) return null;
    seen.add(cur);
    n++;
    const to: string = clips[cur];
    cur = Object.hasOwn(shapes, to) ? undefined : to;
  }
  return n;
}
/** Why the clips of a set break the nesting rules (checkMasks says the same), or null when they are fine. */
function clipProblem(clips: Readonly<Record<string, string>>, shapes: Readonly<Record<string, unknown>>): string | null {
  for (const part of Object.keys(clips)) {
    const n = chainLength(clips, shapes, part);
    if (n === null) return `${part} would be clipped through a loop of parts`;
    if (n > MASK_MAX_SHAPES) return `${part} would be clipped through ${n} shapes; at most ${MASK_MAX_SHAPES} (clip it to a part that is not itself clipped, or to a shape)`;
  }
  return null;
}

/**
 * The set with a new shape part: `name` (made unique across parts, bones and shapes; `<part>_mask` or `shape` by default), on `bone`, with
 * `polygon`. With `clipPart` that part is clipped to it, replacing the clip it had.
 */
export function addShape(set: ShapeSet, names: ShapeNames, opts: { name?: string; bone?: string; polygon: readonly MaskPoint[]; clipPart?: string }): ShapeEdit {
  if (opts.polygon.length < MASK_MIN_POINTS || opts.polygon.length > MASK_MAX_POINTS) return { error: `A shape needs ${MASK_MIN_POINTS} to ${MASK_MAX_POINTS} points.` };
  const name = uniqueName(allNames(set, names), opts.name?.trim() || (opts.clipPart ? `${opts.clipPart}_mask` : 'shape'));
  const shape: ShapeDef = { ...(opts.bone ? { bone: opts.bone } : {}), polygon: opts.polygon.map(p => [p[0], p[1]] as MaskPoint) };
  const clips = opts.clipPart ? { ...set.clips, [opts.clipPart]: name } : set.clips;
  const next = { ...set, shapes: { ...set.shapes, [name]: shape }, clips };
  const bad = opts.clipPart ? clipProblem(clips, next.shapes) : null;
  if (bad) return { error: bad };
  return { set: next, name, note: opts.clipPart ? `Added shape ${name} and clipped ${opts.clipPart} to it.` : `Added shape ${name}.` };
}

/** The parts clipped to `shape` (or to the part of that name), in clip order. */
export const clippedBy = (set: Pick<ShapeSet, 'clips'>, shape: string): string[] => Object.keys(set.clips).filter(p => set.clips[p] === shape);

/**
 * Shape `from` renamed to `to`: every `clip` and group `members` entry that names it follows. Refused for an empty name or one that a
 * part, a bone or another shape has (names are unique across all three).
 */
export function renameShape(set: ShapeSet, names: ShapeNames, from: string, to: string): ShapeEdit {
  const name = to.trim();
  if (!Object.hasOwn(set.shapes, from)) return { error: `No shape named ${from}.` };
  if (!name) return { error: 'A shape needs a name.' };
  if (name === from) return { error: 'That is already its name.' };
  if (allNames(set, names, from).has(name)) return { error: `"${name}" is already the name of a part, a bone or a shape.` };
  const shapes = Object.fromEntries(Object.entries(set.shapes).map(([k, v]) => [k === from ? name : k, v]));
  const clips = Object.fromEntries(Object.entries(set.clips).map(([k, v]) => [k, v === from ? name : v]));
  const deformers = set.deformers.map(d => (Array.isArray(d.members) && d.members.includes(from) ? { ...d, members: d.members.map(m => (m === from ? name : m)) } : d));
  return { set: { shapes, clips, deformers }, name, note: `Renamed ${from} to ${name}.` };
}

/**
 * The set without shape `name`: the parts that were clipped to it are drawn whole again, and it leaves the members of any group warp
 * (a group left with no member goes). The note says what changed.
 */
export function deleteShape(set: ShapeSet, name: string): ShapeEdit {
  if (!Object.hasOwn(set.shapes, name)) return { error: `No shape named ${name}.` };
  const freed = clippedBy(set, name), groups: string[] = [];
  const clips = Object.fromEntries(Object.entries(set.clips).filter(([, v]) => v !== name));
  const deformers: DeformerDef[] = [];
  for (const d of set.deformers) {
    if (!Array.isArray(d.members) || !d.members.includes(name)) { deformers.push(d); continue; }
    groups.push(d.id);
    const left = d.members.filter(m => m !== name);
    if (left.length) deformers.push({ ...d, members: left });
  }
  const bits = [freed.length ? `${freed.join(', ')} ${freed.length === 1 ? 'is' : 'are'} drawn whole again` : '', groups.length ? `removed from ${groups.join(', ')}` : ''].filter(Boolean);
  return { set: { shapes: without(set.shapes, name), clips, deformers }, note: `Deleted shape ${name}${bits.length ? `: ${bits.join('; ')}` : ''}.` };
}

/**
 * `part` clipped to `target` (a shape or an image part), or with no clip for null. Refused when `part` is not an image part, the target is
 * neither a shape nor an image part, the part is its own target, or the clips would loop or nest deeper than checkMasks allows.
 */
export function setClip(set: ShapeSet, parts: ReadonlySet<string>, part: string, target: string | null): ShapeEdit {
  if (!parts.has(part)) return { error: `${part} has no art to clip.` };
  if (target === null) return Object.hasOwn(set.clips, part) ? { set: { ...set, clips: without(set.clips, part) }, note: `${part} is drawn whole again.` } : { set, note: `${part} has no clip.` };
  if (target === part) return { error: 'A part cannot be clipped to its own shape.' };
  if (!Object.hasOwn(set.shapes, target) && !parts.has(target)) return { error: `${target} is neither a shape nor a part with art.` };
  const clips = { ...set.clips, [part]: target }, bad = clipProblem(clips, set.shapes);
  return bad ? { error: bad } : { set: { ...set, clips }, note: `${part} is clipped to ${target}.` };
}

/**
 * Shape `name` placed on another bone (`bone`, null: none) and/or hung on an image part's drawn mesh (`follow`, null: none). Leave a field
 * `undefined` to keep it. Refused for an unknown name, bone or part.
 */
export function moveShape(set: ShapeSet, names: { parts: ReadonlySet<string>; bones: ReadonlySet<string> }, name: string, to: { bone?: string | null; follow?: string | null }): ShapeEdit {
  const cur = set.shapes[name];
  if (!cur) return { error: `No shape named ${name}.` };
  if (typeof to.bone === 'string' && !names.bones.has(to.bone)) return { error: `No bone named ${to.bone}.` };
  if (typeof to.follow === 'string' && !names.parts.has(to.follow)) return { error: `No part with art named ${to.follow}.` };
  const { bone: _b, follow: _f, ...rest } = cur;
  const bone = to.bone === undefined ? cur.bone : to.bone, follow = to.follow === undefined ? cur.follow : to.follow;
  if (bone === cur.bone && follow === cur.follow) return { set, note: '' };
  const next: ShapeDef = { ...(bone ? { bone } : {}), ...(follow ? { follow } : {}), ...rest };
  return { set: { ...set, shapes: { ...set.shapes, [name]: next } }, note: `${name} ${follow ? `follows ${follow}` : bone ? `is on ${bone}` : 'is on the character'}.` };
}

/** The groups whose members include `name`: the group warp that bends it. */
const groupIdOf = (deformers: readonly DeformerDef[], name: string): string | undefined => deformers.find(d => Array.isArray(d.members) && d.members.includes(name))?.id;

/**
 * Clipped parts that a group warp bends while their clip shape is not bent with them (checkClipGroups says the same in rig.json): the
 * shape is neither a member of the group nor following a member. Only clips to a shape are listed.
 */
export function clipGroupIssues(set: ShapeSet): { part: string; shape: string; group: string }[] {
  const out: { part: string; shape: string; group: string }[] = [];
  for (const [part, shape] of Object.entries(set.clips)) {
    const s = set.shapes[shape], g = groupIdOf(set.deformers, part);
    if (!s || g === undefined) continue;
    if (groupIdOf(set.deformers, shape) === g || (s.follow !== undefined && groupIdOf(set.deformers, s.follow) === g)) continue;
    out.push({ part, shape, group: g });
  }
  return out;
}

/** The deformers with `name` added to the members of group `group` (it leaves any other group: a member is in one at most). */
export function addToGroup(deformers: readonly DeformerDef[], group: string, name: string): DeformerDef[] {
  return deformers.flatMap(d => {
    if (d.id === group && Array.isArray(d.members)) return [d.members.includes(name) ? d : { ...d, members: [...d.members, name] }];
    if (!Array.isArray(d.members) || !d.members.includes(name)) return [d];
    const left = d.members.filter(m => m !== name);
    return left.length ? [{ ...d, members: left }] : [];
  });
}

// ---- the points of a polygon ----

/** Anything with a drawn polygon (a ShapeDef, or a MaskDef of the renderer's list) and keyforms that reshape it. */
export interface PolygonHolder { polygon?: MaskPoint[]; keyforms?: DeformerKeyform[] }

/** `def` with polygon point `i` at `to` (canvas pixels, rounded to whole ones); the same object when it does not move or `i` is no point. */
export function movePolygonPoint<T extends PolygonHolder>(def: T, i: number, to: MaskPoint): T {
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

/**
 * `def` with a new point `p` inserted before point `at` (`at` = the point count appends); the keyforms' point numbers follow. In each keyform
 * the new point moves as the edge it was put on does: its displacement is its two neighbours' mixed by how far along the edge it sits, so a
 * point added to a keyed shape (the closed lid of a blink) stays on that edge at every key instead of staying at rest. The same object at the
 * point cap.
 */
export function insertPolygonPoint<T extends PolygonHolder>(def: T, at: number, p: MaskPoint): T {
  const poly = def.polygon;
  if (!poly || poly.length >= MASK_MAX_POINTS || !Number.isInteger(at) || at < 0 || at > poly.length || !p.every(Number.isFinite)) return def;
  const q: MaskPoint = [round(p[0]), round(p[1])];
  const next = [...poly.slice(0, at), q, ...poly.slice(at)];
  // The edge it lands on runs from the point before it to the one after it (the first point again when it is appended), in the old numbering.
  const n = poly.length, prev = (at - 1 + n) % n, after = at % n, a = poly[prev], b = poly[after];
  const dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / len2)) : 0.5;
  const fill = <K extends { pts?: WarpPoints }>(old: K, shifted: K): K => {
    const d0 = old.pts?.[String(prev)] ?? [0, 0], d1 = old.pts?.[String(after)] ?? [0, 0];
    const d: [number, number] = [mix(d0[0], d1[0], t), mix(d0[1], d1[1], t)];
    return d[0] === 0 && d[1] === 0 ? shifted : { ...shifted, pts: { ...shifted.pts, [String(at)]: d } };
  };
  const keyforms = def.keyforms ? shiftKeyforms(def.keyforms, at, 1)!.map((k, i) => {
    const o = def.keyforms![i];
    return { ...k, ...(k.keys ? { keys: k.keys.map((x, j) => fill(o.keys![j], x)) } : {}), ...(k.forms ? { forms: k.forms.map((x, j) => fill(o.forms![j], x)) } : {}) };
  }) : undefined;
  return { ...def, polygon: next, ...(keyforms ? { keyforms } : {}) };
}
/** `a` to `b` by `t`, to six decimals (keyform displacements are stage fractions). */
const mix = (a: number, b: number, t: number): number => Math.round((a + (b - a) * t) * 1e6) / 1e6 + 0;

/** `def` without polygon point `i`; null (nothing changes) when the shape would be left with fewer than three points. */
export function removePolygonPoint<T extends PolygonHolder>(def: T, i: number): T | null {
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
    const a = poly[i], b = poly[(i + 1) % poly.length], n = nearestOnSegment(p[0], p[1], a[0], a[1], b[0], b[1]);
    if (!best || n.d < best.dist) best = { index: i, at: [n.x, n.y], dist: n.d };
  }
  return best;
}

/** The point halfway along the edge from point `i` to the next, for "add a point after this one" from the keyboard. */
export function edgeMidpoint(poly: readonly MaskPoint[], i: number): MaskPoint | null {
  if (!poly.length || !Number.isInteger(i) || i < 0 || i >= poly.length) return null;
  const a = poly[i], b = poly[(i + 1) % poly.length];
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

/** The image parts a part could be clipped to: every other part, in the order given. */
export const clipTargets = (parts: readonly string[], part: string): string[] => parts.filter(p => p !== part);

// ---- picking a shape on the stage ----

/** A shape as drawn on screen: its outlines (usually one closed polygon), in the same space as the pointer. */
export interface ShapeOutline { name: string; outlines: readonly (readonly MaskPoint[])[] }

/** Whether `p` lies inside the closed polygon `poly` (even-odd rule). */
export const pointInOutline = (poly: readonly MaskPoint[], p: MaskPoint): boolean => pointInPolygon(poly, p[0], p[1]);

const outlineArea = (poly: readonly MaskPoint[]): number => Math.abs(signedArea(poly));

/** The shape whose outline passes within `tol` of `p` (the nearest one), or null. */
export function shapeAtEdge(shapes: readonly ShapeOutline[], p: MaskPoint, tol: number): string | null {
  let best: string | null = null, dist = tol;
  for (const s of shapes) for (const o of s.outlines) {
    const e = nearestEdge(o as MaskPoint[], p);
    if (e && e.dist <= dist) { best = s.name; dist = e.dist; }
  }
  return best;
}

/** The shape with `p` inside it; of several, the smallest (the one drawn on top of the others). */
export function shapeAtInside(shapes: readonly ShapeOutline[], p: MaskPoint): string | null {
  let best: string | null = null, area = Infinity;
  for (const s of shapes) for (const o of s.outlines) {
    if (o.length < 3 || !pointInOutline(o as MaskPoint[], p)) continue;
    const a = outlineArea(o);
    if (a < area) { best = s.name; area = a; }
  }
  return best;
}
