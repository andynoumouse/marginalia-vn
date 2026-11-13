// Binding parts to a parameter, the parameter-first half of Model mode in the animation studio (the order of Live2D Cubism): the
// author picks one parameter (a slider, or a pad's grid), picks the parts it affects, and each pick binds the part to it and makes
// its keys at once, every one at rest; the author then poses the part at each key (keyform-edit.ts writes those poses). Nothing here
// draws or touches the DOM. A part is bound by a keyform of its own:
//
//   pose:  a bone's or part's transform: a `keyforms` entry of the parameter (`param` + `keys`) or of a pad (`params` + `grid` + `forms`).
//   warp:  a part's mesh warp (`deformers`), keyed to one parameter (a slider).
//   mask:  a drawn mask polygon's points (`masks`), keyed to one parameter (a slider).
//
// A slider is bound with a key at its minimum, its default and its maximum ("Add 3 points" in Cubism); a pad with a grid of
// 2 x 2 (the ends), 3 x 3 (the ends and the default) or 5 x 5 (and halfway between each pair). Every key starts at rest, so the pose on
// show does not change by binding. The default is always a line unless the grid is 2 x 2, because a rest pose at the default is what
// lets the author pose the ends without moving the part at rest.

import type { DeformerDef, DeformerKeyform, KeyformDef, PadDef, ParamDef } from './params.js';
import type { ShapeDef } from './masks.js';
import { isPadSpot, isRestForm, keyformDrivers, snapSpot, type KeyDriver, type KeySpot } from './keyform-edit.js';
import { deformerById, deformerOf, groupOf, replaceDeformer } from './warp-edit.js';
import { paramById } from './params.js';
import { round5 } from './util.js';

/** What the author picked: a parameter (a slider, or one axis of a pad) or a pad's two parameters (its grid). */
export type BindDriver = KeyDriver;
export type BindKind = 'pose' | 'warp' | 'mask';

/** The grid sizes a pad is bound with. */
export const PAD_SIZES = [2, 3, 5] as const;
export type PadSize = (typeof PAD_SIZES)[number];
export const DEFAULT_PAD_SIZE: PadSize = 3;


/** The values a slider is bound at: its minimum, default and maximum (the default is the minimum or the maximum for some, so two lines). */
export const sliderLines = (d: ParamDef): number[] => [...new Set([d.min, d.default, d.max].map(round5))].sort((a, b) => a - b);

/** The ascending values one pad axis is bound at: 2 = the ends, 3 = the ends and the default, 5 = and halfway between each two of those. */
export function axisLines(d: ParamDef, size: number): number[] {
  if (size <= 2) return [...new Set([d.min, d.max].map(round5))].sort((a, b) => a - b);
  const base = sliderLines(d);
  if (size < 5) return base;
  const out = new Set(base);
  for (let i = 1; i < base.length; i++) out.add(round5((base[i - 1] + base[i]) / 2));
  return [...out].sort((a, b) => a - b);
}

const padKey = (d: BindDriver): string => ('params' in d ? `${d.params[0]}|${d.params[1]}` : d.param);

const isGridForm = (k: KeyformDef, d: BindDriver): boolean => 'params' in d && !!k.params && k.params[0] === d.params[0] && k.params[1] === d.params[1] && !!k.grid && Array.isArray(k.forms);
const isKeysForm = (k: KeyformDef, d: BindDriver): boolean => 'param' in d && k.param === d.param && Array.isArray(k.keys);
const ofDriver = (k: KeyformDef, d: BindDriver): boolean => isGridForm(k, d) || isKeysForm(k, d);

/** Does `target` have a keyform for this driver? */
export const isBound = (kfs: readonly KeyformDef[], target: string, driver: BindDriver): boolean => kfs.some(k => k.target === target && ofDriver(k, driver));

/**
 * The keyforms with `target` bound to `driver`: a slider gets keys at its minimum, default and maximum, a pad a grid of `size` lines on each
 * axis, all at rest. Nothing changes (`bound` false) when the target is bound to it already or a parameter is unknown.
 */
export function bindPose(kfs: readonly KeyformDef[], defs: readonly ParamDef[], target: string, driver: BindDriver, size: number = DEFAULT_PAD_SIZE): { keyforms: KeyformDef[]; bound: boolean } {
  const same = { keyforms: kfs as KeyformDef[], bound: false };
  if (isBound(kfs, target, driver)) return same;
  if ('params' in driver) {
    const xd = paramById(defs, driver.params[0]), yd = paramById(defs, driver.params[1]);
    if (!xd || !yd || xd === yd) return same;
    const x = axisLines(xd, size), y = axisLines(yd, size);
    return { keyforms: [...structuredClone(kfs) as KeyformDef[], { target, params: [xd.id, yd.id], grid: { x, y }, forms: Array.from({ length: x.length * y.length }, () => ({})) }], bound: true };
  }
  const d = paramById(defs, driver.param);
  if (!d) return same;
  return { keyforms: [...structuredClone(kfs) as KeyformDef[], { target, param: d.id, keys: sliderLines(d).map(at => ({ at })) }], bound: true };
}

/** The keyforms without the ones that bind `target` to `driver`, with every key they had. */
export function unbindPose(kfs: readonly KeyformDef[], target: string, driver: BindDriver): { keyforms: KeyformDef[]; unbound: boolean } {
  const kept = kfs.filter(k => !(k.target === target && ofDriver(k, driver)));
  return kept.length === kfs.length ? { keyforms: kfs as KeyformDef[], unbound: false } : { keyforms: structuredClone(kept) as KeyformDef[], unbound: true };
}

/**
 * The keyforms with the key at `spot` taken out, the keyform kept (it is the binding; `unbindPose` ends that). A slider's key goes, except the one
 * at the parameter's default, which goes back to rest instead: the rest pose at the default is what the other keys are posed against. A pad's
 * corner goes back to rest (a grid line is not removed). `removed` is false when there was nothing to change.
 */
export function removeKey(kfs: readonly KeyformDef[], defs: readonly ParamDef[], target: string, spot: KeySpot): { keyforms: KeyformDef[]; removed: boolean } {
  const s = snapSpot(kfs, defs, target, spot), same = { keyforms: kfs as KeyformDef[], removed: false };
  const i = s ? kfs.findIndex(k => k.target === target && (isPadSpot(s) ? isGridForm(k, { params: s.params }) : isKeysForm(k, { param: s.param }))) : -1;
  if (!s || i < 0) return same;
  const next = structuredClone(kfs) as KeyformDef[], kf = next[i];
  if (isPadSpot(s)) {
    const g = kf.grid!, at = g.y.indexOf(s.at[1]) * g.x.length + g.x.indexOf(s.at[0]);
    if (at < 0 || isRestForm(kf.forms![at])) return same;
    kf.forms![at] = {};
    return { keyforms: next, removed: true };
  }
  const d = paramById(defs, s.param)!, j = kf.keys!.findIndex(k => k.at === s.value);
  if (j < 0) return same;
  if (Math.abs(s.value - d.default) < 1e-9) {
    if (isRestForm(kf.keys![j])) return same;
    kf.keys![j] = { at: s.value };
  } else kf.keys!.splice(j, 1);
  return { keyforms: next, removed: true };
}

// ---- warps and masks: keyed to one parameter ----

const restKeys = (d: ParamDef) => sliderLines(d).map(at => ({ at }));
const keyformOf = (kfs: readonly DeformerKeyform[] | undefined, param: string): DeformerKeyform | undefined => (kfs ?? []).find(k => k.param === param && Array.isArray(k.keys));

/** The deformer of `part` (or the one named `id`, a group warp the part is in) bound to a parameter: its keys at the minimum, default and maximum, no point moved. Nothing changes when there is no warp, it is bound, or the parameter is unknown. */
export function bindDeformer(deformers: readonly DeformerDef[], defs: readonly ParamDef[], part: string, param: string, id?: string): { deformers: DeformerDef[]; bound: boolean } {
  const def = id !== undefined ? deformerById(deformers, id) : deformerOf(deformers, part), d = paramById(defs, param);
  if (!def || !d || keyformOf(def.keyforms, param)) return { deformers: deformers as DeformerDef[], bound: false };
  return { deformers: replaceDeformer(deformers, { ...def, keyforms: [...(def.keyforms ?? []), { param, keys: restKeys(d) }] }), bound: true };
}

/** The deformers with the keys of `param` taken off the warp of `part` (or the deformer named `id`). */
export function unbindDeformer(deformers: readonly DeformerDef[], part: string, param: string, id?: string): { deformers: DeformerDef[]; unbound: boolean } {
  const def = id !== undefined ? deformerById(deformers, id) : deformerOf(deformers, part);
  if (!def || !keyformOf(def.keyforms, param)) return { deformers: deformers as DeformerDef[], unbound: false };
  return { deformers: replaceDeformer(deformers, { ...def, keyforms: def.keyforms.filter(k => k.param !== param) }), unbound: true };
}

/** The polygon of shape `name` bound to a parameter, as a warp is. */
export function bindMask(shapes: Readonly<Record<string, ShapeDef>>, defs: readonly ParamDef[], name: string, param: string): { shapes: Record<string, ShapeDef>; bound: boolean } {
  const m = shapes[name], d = paramById(defs, param);
  if (!m || !d || keyformOf(m.keyforms, param)) return { shapes: shapes as Record<string, ShapeDef>, bound: false };
  return { shapes: { ...shapes, [name]: { ...m, keyforms: [...(m.keyforms ?? []), { param, keys: restKeys(d) }] } }, bound: true };
}

/** The shapes with the keys of `param` taken off shape `name` (a shape left with no keyform has none). */
export function unbindMask(shapes: Readonly<Record<string, ShapeDef>>, name: string, param: string): { shapes: Record<string, ShapeDef>; unbound: boolean } {
  const m = shapes[name];
  if (!m || !keyformOf(m.keyforms, param)) return { shapes: shapes as Record<string, ShapeDef>, unbound: false };
  const left = m.keyforms!.filter(k => k.param !== param);
  const { keyforms: _gone, ...rest } = m;
  return { shapes: { ...shapes, [name]: left.length ? { ...rest, keyforms: left } : rest }, unbound: true };
}

// ---- what is bound to what ----

/** What the keyforms, warps and masks of a rig bind. */
export interface BindDoc { keyforms: readonly KeyformDef[]; deformers: readonly DeformerDef[]; shapes: Readonly<Record<string, ShapeDef>> }

/** A part (or bone) bound to a parameter: `keys` is how many keys it has there, `posed` how many of them are off rest. */
export interface BoundPart { target: string; kind: BindKind; keys: number; posed: number }

const pointsPosed = (k: { pts?: Record<string, unknown> }): boolean => !!k.pts && Object.keys(k.pts).length > 0;

/**
 * The parts bound to `driver`: poses first (a bone's or part's transform keyform, for a slider or a pad's grid), then the warps and the
 * mask polygons keyed to a slider's parameter. In file order within each.
 */
export function boundParts(doc: BindDoc, driver: BindDriver): BoundPart[] {
  const out: BoundPart[] = [];
  for (const k of doc.keyforms) {
    if (!ofDriver(k, driver)) continue;
    const forms = isGridForm(k, driver) ? k.forms! : k.keys!;
    const posed = forms.filter(f => !isRestForm(f)).length;
    const at = out.find(o => o.kind === 'pose' && o.target === k.target);
    if (at) { at.keys += forms.length; at.posed += posed; } else out.push({ target: k.target, kind: 'pose', keys: forms.length, posed });
  }
  if ('param' in driver) {
    for (const d of doc.deformers) {
      const k = keyformOf(d.keyforms, driver.param);
      if (k) out.push({ target: d.part ?? d.members?.[0] ?? d.id, kind: 'warp', keys: k.keys!.length, posed: k.keys!.filter(pointsPosed).length });
    }
    for (const [name, m] of Object.entries(doc.shapes)) {
      const k = keyformOf(m.keyforms, driver.param);
      if (k) out.push({ target: name, kind: 'mask', keys: k.keys!.length, posed: k.keys!.filter(pointsPosed).length });
    }
  }
  return out;
}

/** The warp that bends `part`: its own, else the group warp it is a member of. */
export const warpOf = (deformers: readonly DeformerDef[], part: string): DeformerDef | undefined => deformerOf(deformers, part) ?? groupOf(deformers, part);

/**
 * Is `part` bound to `driver` through a warp: its own or its group's has keys on that slider (`param` + `keys`) or on that pad's grid
 * (`params` + `grid` + `forms`, as a group warp often is)?
 */
export function warpBound(deformers: readonly DeformerDef[], part: string, driver: BindDriver): boolean {
  return [deformerOf(deformers, part), groupOf(deformers, part)].some(d => (d?.keyforms ?? []).some(k => ('params' in driver
    ? Array.isArray(k.params) && k.params[0] === driver.params[0] && k.params[1] === driver.params[1]
    : k.param === driver.param)));
}

/** What affects `target`: the parameters and pads it is bound to, as a pose, and the parameters its warp and its mask polygon are keyed to. */
export function affectedBy(doc: BindDoc, target: string): { driver: BindDriver; kind: BindKind }[] {
  const out: { driver: BindDriver; kind: BindKind }[] = keyformDrivers(doc.keyforms as KeyformDef[], target).map(driver => ({ driver, kind: 'pose' }));
  const keyed = (kfs: readonly DeformerKeyform[] | undefined, kind: BindKind) => {
    for (const k of kfs ?? []) if (k.param && Array.isArray(k.keys)) out.push({ driver: { param: k.param }, kind });
  };
  keyed(deformerOf(doc.deformers, target)?.keyforms, 'warp');
  keyed(groupOf(doc.deformers, target)?.keyforms, 'warp');
  keyed(doc.shapes[target]?.keyforms, 'mask');
  return out;
}

/** Does the same thing the driver names: the same parameter, or the same pad. */
export const sameDriver = (a: BindDriver, b: BindDriver): boolean => padKey(a) === padKey(b) && 'params' in a === 'params' in b;

// ---- the keys of a part on a parameter ----

export interface KeyTick { at: number; posed: boolean }

/**
 * Where `param` has keys for `target` (every target when none is given), ascending: a one-parameter keyform's keys and a pad grid's lines. `posed`
 * says the key holds a pose (a grid line: some corner on it does). The same value from several targets is one tick, posed if any is.
 */
export function keyTicks(kfs: readonly KeyformDef[], param: string, target?: string): KeyTick[] {
  const out = new Map<number, boolean>();
  const add = (at: number, posed: boolean) => out.set(at, (out.get(at) ?? false) || posed);
  for (const k of kfs) {
    if (target !== undefined && k.target !== target) continue;
    if (k.param === param && Array.isArray(k.keys)) for (const key of k.keys) add(key.at, !isRestForm(key));
    else if (k.params && k.grid && Array.isArray(k.forms)) {
      const nx = k.grid.x.length;
      if (k.params[0] === param) k.grid.x.forEach((v, ix) => add(v, k.grid!.y.some((_, iy) => !isRestForm(k.forms![iy * nx + ix]))));
      if (k.params[1] === param) k.grid.y.forEach((v, iy) => add(v, k.grid!.x.some((_, ix) => !isRestForm(k.forms![iy * nx + ix]))));
    }
  }
  return [...out].map(([at, posed]) => ({ at, posed })).sort((a, b) => a.at - b.at);
}

/** The key ticks of a deformer's or mask's keyform on `param`. */
export function warpTicks(kfs: readonly DeformerKeyform[] | undefined, param: string): KeyTick[] {
  return (keyformOf(kfs, param)?.keys ?? []).map(k => ({ at: k.at, posed: pointsPosed(k) })).sort((a, b) => a.at - b.at);
}

// ---- controls: the string the studio keeps for the active parameter ----

/** The key the studio keeps the active control under: a parameter id, or `pad:<id>` for a pad's grid. */
export const PAD_PREFIX = 'pad:';

/** The driver a control key names (the pad's two parameters, or the parameter), null when it is not in the rig. */
export function driverOf(control: string, defs: readonly ParamDef[], pads: readonly PadDef[]): BindDriver | null {
  if (control.startsWith(PAD_PREFIX)) {
    const pad = pads.find(p => p.id === control.slice(PAD_PREFIX.length));
    return pad && paramById(defs, pad.x) && paramById(defs, pad.y) ? { params: [pad.x, pad.y] } : null;
  }
  return paramById(defs, control) ? { param: control } : null;
}

/** The control key of a driver: the pad that has those two parameters, else (for a parameter) its own id; null when none is in the rig. */
export function controlOf(driver: BindDriver, defs: readonly ParamDef[], pads: readonly PadDef[]): string | null {
  if ('params' in driver) { const pad = pads.find(p => p.x === driver.params[0] && p.y === driver.params[1]); return pad ? `${PAD_PREFIX}${pad.id}` : null; }
  return paramById(defs, driver.param) ? driver.param : null;
}
