// Authoring the keyforms of bones and parts (rig.json `keyforms`): the pure half of Model mode in the animation studio, where
// a slider (or a pad) holds a value, the author poses the chosen bone on the stage, and that pose is written as the keyform of
// that parameter at that value. Nothing here draws or touches the DOM; the studio feeds it drag deltas and button presses and
// keeps the result as its working copy. The maths of blending is in params.ts; this edits the data it reads.
//
//   spot:  where a keyform is written. A slider's value (`param` + `value`: a key of a `param` + `keys` keyform) or a pad's
//          point (`params` + `at`: a corner of a `params` + `grid` + `forms` keyform). A value near an existing key edits that
//          key (KEY_SNAP of the range); a pad always writes the corner of the grid nearest to its point.
//   first key of a slider keyform comes with an empty key at the parameter's default, so the pose eases in from rest instead of
//          holding everywhere. A pad's first write makes the grid min / default / max on each axis, every corner at rest.
//
// Combination rules stay as params.ts has them (docs/design/animation-studio-parameters.md, Decisions): rotation and translation
// add, scale and opacity multiply. A drag adds its delta to the pose on show, so `dragForm` divides a scale delta by what the
// target's other keyforms contribute, and the pose after the write is exactly the pose before plus the drag.

import type { Offset } from './anim.js';
import { blend1D, blendGrid, combineForms, evalKeyform, FORM_FIELDS, REST_FORM, type FormValue, type FullForm, type KeyformDef, type ParamDef } from './params.js';
import { clampParam, paramById } from './params.js';
import { round5 } from './util.js';

/** Where a keyform is written: a slider's value, or a pad's point (the `params` are the pad's x and y parameters). */
export type KeySpot = { param: string; value: number } | { params: [string, string]; at: [number, number] };
export type PadSpot = Extract<KeySpot, { params: [string, string] }>;
export const isPadSpot = (s: KeySpot): s is PadSpot => 'params' in s;

/** A slider value this close (as a fraction of the range) to a key edits that key; farther away it makes a new one. */
export const KEY_SNAP = 0.02;
/**
 * Where a scrubbed slider lands in Model mode: on the nearest key within `reach` (a fraction of the range, wider than KEY_SNAP so a scrub
 * catches it), else on the slider's own step, so a drag does not make a key at an odd value such as 0.53 by accident (SR-18).
 */
export function snapToTicks(v: number, ticks: readonly number[], min: number, max: number, step: number, reach = 0.04): number {
  const span = max - min;
  let best: number | null = null;
  for (const t of ticks) if (Math.abs(t - v) <= reach * span && (best === null || Math.abs(t - v) < Math.abs(best - v))) best = t;
  if (best !== null) return best;
  return round5(Math.min(max, Math.max(min, min + Math.round((v - min) / step) * step)));
}
/** The most grid lines a pad keyform grows to on one axis. */
export const GRID_MAX = 9;
const EPS = 1e-9;

const tol = (d: ParamDef): number => KEY_SNAP * (d.max - d.min);
const full = (f: FormValue): FullForm => combineForms([f]);

/** True when the form has no effect (every field at its rest value). */
export const isRestForm = (f: FormValue | undefined): boolean => FORM_FIELDS.every(k => (f?.[k] ?? REST_FORM[k]) === REST_FORM[k]);

/** The form as it is stored: rounded, and only the fields that differ from rest. */
function sparse(f: FormValue): FormValue {
  const out: FormValue = {};
  for (const k of FORM_FIELDS) { const v = round5(f[k] ?? REST_FORM[k]); if (v !== REST_FORM[k]) out[k] = v; }
  return out;
}

/** The ascending values a pad axis starts with: the parameter's min, default and max. */
const axisOf = (d: ParamDef): number[] => [...new Set([d.min, d.default, d.max])].sort((a, b) => a - b);
const nearest = (values: readonly number[], v: number): number => {
  let best = 0;
  values.forEach((x, i) => { if (Math.abs(x - v) < Math.abs(values[best] - v)) best = i; });
  return best;
};

function indexOfForm(kfs: readonly KeyformDef[], target: string, spot: KeySpot): number {
  return kfs.findIndex(k => k.target === target && (isPadSpot(spot)
    ? !!k.params && k.params[0] === spot.params[0] && k.params[1] === spot.params[1] && !!k.grid && Array.isArray(k.forms)
    : k.param === spot.param && Array.isArray(k.keys)));
}

function newGrid(target: string, params: [string, string], xd: ParamDef, yd: ParamDef): KeyformDef {
  const x = axisOf(xd), y = axisOf(yd);
  return { target, params: [params[0], params[1]], grid: { x, y }, forms: Array.from({ length: x.length * y.length }, () => ({})) };
}

/**
 * The spot an edit at `spot` really lands on: a slider's value is the key within KEY_SNAP of it (else the parameter's default
 * when that is as near, else the value itself, clamped to the range); a pad's point is the nearest corner of the target's grid
 * (the grid it would be made with when there is none yet). Null when a parameter is unknown.
 */
export function snapSpot(kfs: readonly KeyformDef[], defs: readonly ParamDef[], target: string, spot: KeySpot): KeySpot | null {
  if (isPadSpot(spot)) {
    const xd = paramById(defs, spot.params[0]), yd = paramById(defs, spot.params[1]);
    if (!xd || !yd || xd === yd) return null;
    const i = indexOfForm(kfs, target, spot);
    const xs = i >= 0 ? kfs[i].grid!.x : axisOf(xd), ys = i >= 0 ? kfs[i].grid!.y : axisOf(yd);
    if (!xs.length || !ys.length) return null;
    return { params: [xd.id, yd.id], at: [xs[nearest(xs, clampParam(xd, spot.at[0]))], ys[nearest(ys, clampParam(yd, spot.at[1]))]] };
  }
  const d = paramById(defs, spot.param);
  if (!d) return null;
  const v = clampParam(d, spot.value), i = indexOfForm(kfs, target, spot);
  const near = (at: number) => Math.abs(at - v) <= tol(d);
  let best: number | undefined;
  if (i >= 0) for (const k of kfs[i].keys!) if (near(k.at) && (best === undefined || Math.abs(k.at - v) < Math.abs(best - v))) best = k.at;
  if (best === undefined && near(d.default)) best = d.default;
  return { param: d.id, value: best ?? round5(v) };
}

/** The form stored at `spot` (after snapping): the key's, or the grid corner's. Null when there is no keyform there (or no key). */
export function formAt(kfs: readonly KeyformDef[], defs: readonly ParamDef[], target: string, spot: KeySpot): FullForm | null {
  const s = snapSpot(kfs, defs, target, spot), i = s ? indexOfForm(kfs, target, s) : -1;
  if (!s || i < 0) return null;
  if (isPadSpot(s)) {
    const g = kfs[i].grid!, ix = g.x.indexOf(s.at[0]), iy = g.y.indexOf(s.at[1]);
    return ix < 0 || iy < 0 ? null : full(kfs[i].forms![iy * g.x.length + ix] ?? {});
  }
  const key = kfs[i].keys!.find(k => k.at === s.value);
  return key ? full(key) : null;
}

/** Is there something authored at `spot`: a key at the value, or a corner that is not at rest? */
export function isKeyed(kfs: readonly KeyformDef[], defs: readonly ParamDef[], target: string, spot: KeySpot): boolean {
  const f = formAt(kfs, defs, target, spot);
  if (!f) return false;
  return isPadSpot(spot) ? !isRestForm(f) : true;
}

/** What a write at `spot` starts from: the form stored there, else what the keyform gives there now (so a new key changes nothing). The form at the spot a write would land on, snapped as writeForm does. */
export function spotForm(kfs: readonly KeyformDef[], defs: readonly ParamDef[], target: string, spot: KeySpot): FullForm {
  const stored = formAt(kfs, defs, target, spot);
  if (stored) return stored;
  const i = indexOfForm(kfs, target, spot);
  return i >= 0 && !isPadSpot(spot) ? blend1D(kfs[i].keys!, spot.value) : { ...REST_FORM };
}

/**
 * The keyforms with `form` stored for `target` at `spot` (snapped): a key is added or replaced, or a grid corner set. Makes the
 * keyform when the target has none for this parameter or pad. Returns the new list and the spot written, or null for an unknown parameter.
 */
export function writeForm(kfs: readonly KeyformDef[], defs: readonly ParamDef[], target: string, spot: KeySpot, form: FormValue): { keyforms: KeyformDef[]; spot: KeySpot } | null {
  const s = snapSpot(kfs, defs, target, spot);
  if (!s) return null;
  const next = structuredClone(kfs) as KeyformDef[], stored = sparse(form);
  if (isPadSpot(s)) {
    let i = indexOfForm(next, target, s);
    if (i < 0) { next.push(newGrid(target, s.params, paramById(defs, s.params[0])!, paramById(defs, s.params[1])!)); i = next.length - 1; }
    const g = next[i].grid!;
    next[i].forms![g.y.indexOf(s.at[1]) * g.x.length + g.x.indexOf(s.at[0])] = stored;
    return { keyforms: next, spot: s };
  }
  const d = paramById(defs, s.param)!;
  let i = indexOfForm(next, target, s);
  if (i < 0) { next.push({ target, param: s.param, keys: [] }); i = next.length - 1; }
  const keys = next[i].keys!;
  if (!keys.length && Math.abs(d.default - s.value) > EPS) keys.push({ at: d.default });
  const j = keys.findIndex(k => k.at === s.value);
  if (j >= 0) keys[j] = { at: s.value, ...stored, ...(keys[j].ease ? { ease: keys[j].ease } : {}) }; else keys.push({ at: s.value, ...stored });
  keys.sort((a, b) => a.at - b.at);
  return { keyforms: next, spot: s };
}

/** The ease of the slider key at `spot` (after snapping): 'linear' when it has none; null when no key is there (a pad corner has none). */
export function easeAt(kfs: readonly KeyformDef[], defs: readonly ParamDef[], target: string, spot: KeySpot): string | null {
  const s = snapSpot(kfs, defs, target, spot), i = s ? indexOfForm(kfs, target, s) : -1;
  if (!s || i < 0 || isPadSpot(s)) return null;
  const key = kfs[i].keys!.find(k => k.at === s.value);
  return key ? key.ease ?? 'linear' : null;
}

/** The key at `spot` reached along `ease` from the key before it (`linear` drops the field). Null when no slider key is there. */
export function setKeyEase(kfs: readonly KeyformDef[], defs: readonly ParamDef[], target: string, spot: KeySpot, ease: string): KeyformDef[] | null {
  if (easeAt(kfs, defs, target, spot) === null) return null;
  const s = snapSpot(kfs, defs, target, spot)!, next = structuredClone(kfs) as KeyformDef[];
  const key = next[indexOfForm(next, target, s)].keys!.find(k => k.at === (s as { value: number }).value)!;
  if (ease === 'linear') delete key.ease; else key.ease = ease;
  return next;
}

/**
 * A pose drag as a keyform write: `delta` is what the drag added to the pose the stage showed (stage fractions, degrees, and a
 * scale added to 1: an `Offset`) at the parameter `values` (the ones the stage showed). It lands on the form stored at `spot`,
 * or on the form the keyform gives there when no key is (so the first drag at a new value starts from the pose on show). Scale
 * multiplies across keyforms, so the delta is divided by what the target's other keyforms make of the values.
 */
export function dragForm(kfs: readonly KeyformDef[], defs: readonly ParamDef[], target: string, spot: KeySpot, delta: Offset, values: Record<string, number>): { keyforms: KeyformDef[]; spot: KeySpot } | null {
  const s = snapSpot(kfs, defs, target, spot);
  if (!s) return null;
  const start = spotForm(kfs, defs, target, s), at = indexOfForm(kfs, target, s);
  let kx = 1, ky = 1;
  kfs.forEach((k, j) => { if (k.target === target && j !== at) { const f = evalKeyform(k, values); kx *= 1 + f.sx; ky *= 1 + f.sy; } });
  return writeForm(kfs, defs, target, s, {
    dx: start.dx + delta.dx, dy: start.dy + delta.dy, rot: start.rot + delta.rot,
    sx: start.sx + delta.sx / (kx > 1e-6 ? kx : 1), sy: start.sy + delta.sy / (ky > 1e-6 ? ky : 1),
    opacity: start.opacity,
  });
}

/**
 * One pose drag written to several targets: each gets `dragForm` with the same `delta`, one after another on the growing list.
 * Targets that cannot take it are skipped; `written` lists the ones that did, in order, and `spot` is where the first landed.
 * Null when none took it. Duplicates in `targets` count once.
 */
export function dragForms(kfs: readonly KeyformDef[], defs: readonly ParamDef[], targets: readonly string[], spot: KeySpot, delta: Offset, values: Record<string, number>): { keyforms: KeyformDef[]; spot: KeySpot; written: string[] } | null {
  let list = kfs as KeyformDef[], at: KeySpot | null = null;
  const written: string[] = [];
  for (const t of new Set(targets)) {
    const r = dragForm(list, defs, t, at ?? spot, delta, values);
    if (!r) continue;
    list = r.keyforms;
    at ??= r.spot;
    written.push(t);
  }
  return at ? { keyforms: list, spot: at, written } : null;
}

/** The corners of the grids keyed on a pad (its two parameters); `authored` is false for a corner still at rest. Only `target`'s when given. */
export function padCorners(kfs: readonly KeyformDef[], params: readonly [string, string], target?: string): { x: number; y: number; authored: boolean }[] {
  const out = new Map<string, { x: number; y: number; authored: boolean }>();
  for (const k of kfs) {
    if ((target !== undefined && k.target !== target) || !k.params || !k.grid || !Array.isArray(k.forms) || k.params[0] !== params[0] || k.params[1] !== params[1]) continue;
    k.grid.y.forEach((y, iy) => k.grid!.x.forEach((x, ix) => {
      const id = `${x},${y}`, authored = !isRestForm(k.forms![iy * k.grid!.x.length + ix]);
      const was = out.get(id);
      out.set(id, { x, y, authored: authored || !!was?.authored });
    }));
  }
  return [...out.values()];
}

/**
 * The pad keyform of `target` with a new grid line at `value` on `axis`, every new corner holding what the grid gave there, so the
 * pose does not change (the grid is made first when the target has none). `added` is false, and the list as it was, when a line is
 * there already, the grid is at GRID_MAX or a parameter is unknown.
 */
export function extendGrid(kfs: readonly KeyformDef[], defs: readonly ParamDef[], target: string, params: readonly [string, string], axis: 'x' | 'y', value: number): { keyforms: KeyformDef[]; added: boolean } {
  const xd = paramById(defs, params[0]), yd = paramById(defs, params[1]), same = { keyforms: kfs as KeyformDef[], added: false };
  if (!xd || !yd || xd === yd) return same;
  const spot: PadSpot = { params: [xd.id, yd.id], at: [xd.default, yd.default] };
  const next = structuredClone(kfs) as KeyformDef[];
  let i = indexOfForm(next, target, spot);
  if (i < 0) { next.push(newGrid(target, spot.params, xd, yd)); i = next.length - 1; }
  const kf = next[i], g = kf.grid!, d = axis === 'x' ? xd : yd, lines = axis === 'x' ? g.x : g.y;
  const at = round5(clampParam(d, value));
  if (lines.length >= GRID_MAX || lines.some(l => Math.abs(l - at) <= tol(d))) return same;
  const xs = axis === 'x' ? [...g.x, at].sort((a, b) => a - b) : g.x, ys = axis === 'y' ? [...g.y, at].sort((a, b) => a - b) : g.y;
  const old = kf.forms!, forms: FormValue[] = [];
  for (const y of ys) for (const x of xs) forms.push(sparse(blendGrid(g.x, g.y, old, x, y)));
  kf.grid = { x: xs, y: ys };
  kf.forms = forms;
  return { keyforms: next, added: true };
}

/** What drives a target: a parameter (a one-parameter keyform) or a pad's two parameters. */
export type KeyDriver = { param: string } | { params: [string, string] };

/** The parameters and parameter pairs that have keyforms on `target`, in file order and without repeats. */
export function keyformDrivers(kfs: readonly KeyformDef[], target: string): KeyDriver[] {
  const out: KeyDriver[] = [], seen = new Set<string>();
  for (const k of kfs) {
    if (k.target !== target) continue;
    const id = k.params && k.grid ? `${k.params[0]}|${k.params[1]}` : k.param && k.keys ? k.param : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(k.params && k.grid ? { params: [k.params[0], k.params[1]] } : { param: k.param! });
  }
  return out;
}

/** The targets that have a keyform on `param` (a one-parameter keyform, or a pad keyform using it), in file order. */
export function targetsOf(kfs: readonly KeyformDef[], param: string): string[] {
  return [...new Set(kfs.filter(k => k.param === param || k.params?.includes(param)).map(k => k.target))];
}

const shown = (v: number) => String(Math.round(v * 1000) / 1000);
/** "head_x = 1" for a slider, "head_x 0, head_y 1" for a pad. */
export const spotLabel = (s: KeySpot): string => (isPadSpot(s) ? `${s.params[0]} ${shown(s.at[0])}, ${s.params[1]} ${shown(s.at[1])}` : `${s.param} = ${shown(s.value)}`);
