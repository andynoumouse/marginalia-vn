// The parameter model of a layered character (rig.json `parameters`, `pads`, `keyforms`): pure maths from parameter
// values to the transform a target (a bone or part) gets. Nothing here draws; the renderer and studio feed it.
//
//   parameter: a scalar with id, min, max, default (and a group for the UI). A pad is two parameters shown as one 2D control.
//   keyform:   authored poses of one target at chosen parameter values, blended linearly (one parameter) or bilinearly
//              on a grid (two). Several keyforms may drive one target; they combine (see combineForms).
//
// Evaluation order: parameter keyforms first, then the bone's own local transform on top (applyLocal). Rotation and
// translation add; scale and opacity multiply. A form uses the units of anim.ts Offset (dx, dy as stage fractions, sx, sy
// added to a size of 1, rot in degrees) plus `opacity` as a factor.

import { easing, lerp, rigEaseProblem } from './anim.js';
import { isNum } from './util.js';
import type { ProblemReport } from './suggest.js';

/** `ease`: the curve a script tween of this parameter follows (anim.ts EASES); linear when left out. */
export interface ParamDef { id: string; min: number; max: number; default: number; group?: string; ease?: string }
/** Two parameters shown as one 2D control. Only a UI grouping: both axes stay ordinary parameters. */
export interface PadDef { id: string; x: string; y: string; group?: string }

/** A pose of one target. A missing field is the rest value (0 for the offsets, 1 for opacity). */
export interface FormValue { dx?: number; dy?: number; sx?: number; sy?: number; rot?: number; opacity?: number }
/** A form with every field filled in. */
export type FullForm = Required<FormValue>;
export const FORM_FIELDS = ['dx', 'dy', 'sx', 'sy', 'rot', 'opacity'] as const;
export const REST_FORM: FullForm = { dx: 0, dy: 0, sx: 0, sy: 0, rot: 0, opacity: 1 };

/** One authored pose at parameter value `at`. `ease` is the curve the pose follows on the way to this key from the previous one (anim.ts EASES); linear when left out. */
export interface FormKey extends FormValue { at: number; ease?: string }
/** A target driven by one parameter (`keys`) or by two on a grid (`params` + `grid` + `forms`, row-major: y outer, x inner). */
export interface KeyformDef {
  target: string;
  param?: string;
  keys?: FormKey[];
  params?: [string, string];
  grid?: { x: number[]; y: number[] };
  forms?: FormValue[];
}

const full = (f: FormValue | undefined): FullForm => ({
  dx: f?.dx ?? 0, dy: f?.dy ?? 0, sx: f?.sx ?? 0, sy: f?.sy ?? 0, rot: f?.rot ?? 0, opacity: f?.opacity ?? 1,
});

export const clampParam = (def: ParamDef, v: number): number =>
  Number.isFinite(v) ? Math.min(def.max, Math.max(def.min, v)) : def.default;
/** The parameter `id` among `defs`. */
export const paramById = (defs: readonly ParamDef[], id: string): ParamDef | undefined => defs.find(d => d.id === id);

/** Every parameter at its default. */
export function paramDefaults(defs: ParamDef[] | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of defs ?? []) out[d.id] = d.default;
  return out;
}

/** `values` clamped to each parameter's range, a missing one at its default; names that are no parameter are dropped. */
export function resolveParams(defs: ParamDef[] | undefined, values: Record<string, number> = {}): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of defs ?? []) out[d.id] = Object.hasOwn(values, d.id) ? clampParam(d, values[d.id]) : d.default;
  return out;
}

export function blendForms(a: FormValue | undefined, b: FormValue | undefined, t: number): FullForm {
  const x = full(a), y = full(b);
  return { dx: lerp(x.dx, y.dx, t), dy: lerp(x.dy, y.dy, t), sx: lerp(x.sx, y.sx, t), sy: lerp(x.sy, y.sy, t), rot: lerp(x.rot, y.rot, t), opacity: lerp(x.opacity, y.opacity, t) };
}

/** Index of the segment `[i, i+1]` of the ascending `at` list holding `v`, and the position inside it (0-1); clamps outside the list. */
export function segment(at: number[], v: number): [number, number] {
  if (at.length < 2 || v <= at[0]) return [0, 0];
  if (v >= at[at.length - 1]) return [at.length - 2, 1];
  let i = 0;
  while (v > at[i + 1]) i++;
  const span = at[i + 1] - at[i];
  return [i, span > 0 ? (v - at[i]) / span : 0];
}

/** Blend of authored keys at `v`, linear unless the key a segment ends at has an `ease`; the ends hold outside the range. No keys is the rest form. */
export function blend1D(keys: FormKey[], v: number): FullForm {
  if (!keys.length) return { ...REST_FORM };
  if (keys.length === 1) return full(keys[0]);
  const sorted = [...keys].sort((p, q) => p.at - q.at);
  const [i, t] = segment(sorted.map(k => k.at), v);
  const ease = sorted[i + 1].ease;
  return blendForms(sorted[i], sorted[i + 1], ease && t > 0 && t < 1 ? easing(ease)(t) : t);
}

/** Bilinear blend on a grid of forms (`forms[iy * xs.length + ix]`) at (`x`, `y`); the edges hold outside the grid. */
export function blendGrid(xs: number[], ys: number[], forms: FormValue[], x: number, y: number): FullForm {
  if (!xs.length || !ys.length) return { ...REST_FORM };
  const [ix, tx] = segment(xs, x), [iy, ty] = segment(ys, y);
  const at = (cx: number, cy: number) => forms[Math.min(cy, ys.length - 1) * xs.length + Math.min(cx, xs.length - 1)];
  const top = blendForms(at(ix, iy), at(ix + 1, iy), tx);
  const bottom = blendForms(at(ix, iy + 1), at(ix + 1, iy + 1), tx);
  return blendForms(top, bottom, ty);
}

/** One keyform at the given parameter values (a parameter missing from `params` counts as 0). */
export function evalKeyform(kf: KeyformDef, params: Record<string, number>): FullForm {
  if (kf.params && kf.grid && kf.forms) return blendGrid(kf.grid.x, kf.grid.y, kf.forms, params[kf.params[0]] ?? 0, params[kf.params[1]] ?? 0);
  if (kf.param && kf.keys) return blend1D(kf.keys, params[kf.param] ?? 0);
  return { ...REST_FORM };
}

/** Several forms on one target at once: rotation and translation add, scale and opacity multiply. */
export function combineForms(forms: FormValue[]): FullForm {
  const out = { ...REST_FORM };
  for (const f of forms) {
    const g = full(f);
    out.dx += g.dx; out.dy += g.dy; out.rot += g.rot;
    out.sx = (1 + out.sx) * (1 + g.sx) - 1;
    out.sy = (1 + out.sy) * (1 + g.sy) - 1;
    out.opacity *= g.opacity;
  }
  return out;
}

/** The bone's own local transform (animation, gizmo drag) laid on top of what the parameters gave: same rule as combineForms. */
export const applyLocal = (fromParams: FormValue, local: FormValue): FullForm => combineForms([fromParams, local]);

/** What the parameters make of `target`: all its keyforms evaluated and combined. A target without keyforms is at rest. */
export function evalTarget(keyforms: KeyformDef[] | undefined, target: string, params: Record<string, number>): FullForm {
  return combineForms((keyforms ?? []).filter(k => k.target === target).map(k => evalKeyform(k, params)));
}

/** Every target that has keyforms, evaluated once. */
export function evalAll(keyforms: KeyformDef[] | undefined, params: Record<string, number>): Record<string, FullForm> {
  const by = new Map<string, FullForm[]>();
  for (const k of keyforms ?? []) {
    const list = by.get(k.target) ?? [];
    list.push(evalKeyform(k, params));
    by.set(k.target, list);
  }
  return Object.fromEntries([...by].map(([t, forms]) => [t, combineForms(forms)]));
}

// ---- checks ----

const ascending = (a: unknown): a is number[] => Array.isArray(a) && a.every(isNum) && a.every((n, i) => i === 0 || n > a[i - 1]);

/** Problems in the `categories`, `parameters`, `pads` and `keyforms` sections; `targets` are the names a keyform may drive (bones and parts). */
export function checkParams(data: { categories?: unknown; parameters?: unknown; pads?: unknown; keyforms?: unknown }, targets: Set<string>, problem: ProblemReport): void {
  const ids = new Map<string, ParamDef>();
  const categories = new Set<string>();
  if (data.categories !== undefined && !Array.isArray(data.categories)) problem('categories: needs a list of names', 'categories');
  else for (const c of (data.categories as unknown[] | undefined) ?? []) {
    if (typeof c !== 'string' || !c.trim()) problem('categories: each needs a name', 'categories');
    else if (c === 'Other') problem('categories: "Other" is where controls without a category show; pick another name', 'categories');
    else if (categories.has(c)) problem(`categories: "${c}" is listed twice`, 'categories');
    else categories.add(c);
  }
  const checkGroup = (what: string, id: string, group: unknown) => {
    if (group === undefined) return;
    if (typeof group !== 'string') problem(`${what}.${id}: group must be a string`, id);
    else if (!categories.has(group)) problem(`${what}.${id}: group "${group}" is not in categories (categories: ${[...categories].join(', ') || 'none'})`, id);
  };
  if (data.parameters !== undefined && !Array.isArray(data.parameters)) problem('parameters: needs a list of { id, min, max, default }', 'parameters');
  else (data.parameters as ParamDef[] | undefined)?.forEach((p, i) => {
    const at = `parameters[${i}]`;
    if (!p || typeof p !== 'object') { problem(`${at}: needs an object with id, min, max and default`, 'parameters'); return; }
    if (typeof p.id !== 'string' || !p.id) { problem(`${at}: needs an id`, 'parameters'); return; }
    if (ids.has(p.id)) { problem(`parameters: "${p.id}" is defined twice`, p.id); return; }
    if (!isNum(p.min) || !isNum(p.max)) problem(`parameters.${p.id}: min and max must be numbers`, p.id);
    else if (!(p.min < p.max)) problem(`parameters.${p.id}: min must be less than max`, p.id);
    else if (!isNum(p.default) || p.default < p.min || p.default > p.max) problem(`parameters.${p.id}: default must be a number from ${p.min} to ${p.max}`, p.id);
    const badEase = p.ease !== undefined ? rigEaseProblem(p.ease) : null;
    if (badEase) problem(`parameters.${p.id}: ${badEase}`, p.id);
    checkGroup('parameters', p.id, p.group);
    ids.set(p.id, p);
  });
  const known = () => [...ids.keys()].join(', ') || 'none';
  if (data.pads !== undefined && !Array.isArray(data.pads)) problem('pads: needs a list of { id, x, y }', 'pads');
  else {
    const seen = new Set<string>();
    (data.pads as PadDef[] | undefined)?.forEach((p, i) => {
      const at = `pads[${i}]`;
      if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !p.id) { problem(`${at}: needs an id, x and y`, 'pads'); return; }
      if (seen.has(p.id)) problem(`pads: "${p.id}" is defined twice`, p.id);
      seen.add(p.id);
      for (const axis of ['x', 'y'] as const) if (typeof p[axis] !== 'string' || !ids.has(p[axis])) problem(`pads.${p.id}.${axis}: no parameter "${String(p[axis])}" (parameters: ${known()})`, p.id, String(p[axis]), ids.keys());
      checkGroup('pads', p.id, p.group);
      if (p.x === p.y && ids.has(p.x)) problem(`pads.${p.id}: x and y are the same parameter`, p.id);
    });
  }
  if (data.keyforms !== undefined && !Array.isArray(data.keyforms)) { problem('keyforms: needs a list of targets', 'keyforms'); return; }
  (data.keyforms as KeyformDef[] | undefined)?.forEach((k, i) => {
    const at = `keyforms[${i}]`;
    if (!k || typeof k !== 'object') { problem(`${at}: not a keyform`, 'keyforms'); return; }
    if (typeof k.target !== 'string' || !targets.has(k.target)) problem(`${at}: no part or bone named "${String(k.target)}"`, 'keyforms', String(k.target), targets);
    const oneD = k.param !== undefined || k.keys !== undefined, twoD = k.params !== undefined || k.grid !== undefined || k.forms !== undefined;
    if (oneD === twoD) { problem(`${at}: use either param + keys, or params + grid + forms`, 'keyforms'); return; }
    const checkForm = (f: unknown, where: string) => {
      if (!f || typeof f !== 'object') { problem(`${where}: not a form`, 'keyforms'); return; }
      for (const [field, v] of Object.entries(f)) {
        if (field === 'at') continue;
        if (field === 'ease' && where.includes('.keys[')) {
          const bad = rigEaseProblem(v);
          if (bad) problem(`${where}.ease: ${bad}`, 'keyforms');
          continue;
        }
        if (!(FORM_FIELDS as readonly string[]).includes(field)) problem(`${where}: unknown field "${field}" (${FORM_FIELDS.join(', ')})`, 'keyforms', field, FORM_FIELDS);
        else if (!isNum(v)) problem(`${where}.${field}: must be a number`, 'keyforms');
        else if (field === 'opacity' && v < 0) problem(`${where}.opacity: must not be negative`, 'keyforms');
      }
    };
    const checkParam = (id: unknown, where: string, lo?: number, hi?: number) => {
      const def = typeof id === 'string' ? ids.get(id) : undefined;
      if (!def) problem(`${where}: no parameter "${String(id)}" (parameters: ${known()})`, 'keyforms', String(id), ids.keys());
      else if (lo !== undefined && hi !== undefined && (lo < def.min || hi > def.max)) problem(`${where}: values ${lo} to ${hi} lie outside "${def.id}" (${def.min} to ${def.max})`, 'keyforms');
    };
    if (oneD) {
      if (!Array.isArray(k.keys) || k.keys.length === 0) { problem(`${at}.keys: needs at least one key`, 'keyforms'); return; }
      const ats = k.keys.map(key => key?.at);
      if (!ats.every(isNum)) problem(`${at}.keys: every key needs a numeric "at"`, 'keyforms');
      else {
        if (new Set(ats).size !== ats.length) problem(`${at}.keys: two keys at the same value`, 'keyforms');
        checkParam(k.param, `${at}.param`, Math.min(...ats), Math.max(...ats));
      }
      k.keys.forEach((key, j) => checkForm(key, `${at}.keys[${j}]`));
      return;
    }
    if (!Array.isArray(k.params) || k.params.length !== 2) { problem(`${at}.params: needs two parameter ids`, 'keyforms'); return; }
    if (k.params[0] === k.params[1]) problem(`${at}.params: the two parameters must differ`, 'keyforms');
    if (!k.grid || !ascending(k.grid.x) || !ascending(k.grid.y) || !k.grid.x.length || !k.grid.y.length) { problem(`${at}.grid: needs x and y lists of numbers in ascending order`, 'keyforms'); return; }
    checkParam(k.params[0], `${at}.params[0]`, k.grid.x[0], k.grid.x[k.grid.x.length - 1]);
    checkParam(k.params[1], `${at}.params[1]`, k.grid.y[0], k.grid.y[k.grid.y.length - 1]);
    const want = k.grid.x.length * k.grid.y.length;
    if (!Array.isArray(k.forms) || k.forms.length !== want) { problem(`${at}.forms: needs ${want} forms (${k.grid.x.length} x ${k.grid.y.length}, one row of x after another), has ${Array.isArray(k.forms) ? k.forms.length : 0}`, 'keyforms'); return; }
    k.forms.forEach((f, j) => checkForm(f, `${at}.forms[${j}]`));
  });
}

// ---- poses and tweens ----

/** A named snapshot of some parameters (rig.json `poses`); parameters it leaves out are not touched. */
export type PoseDef = Record<string, number>;

/** Poses laid over each other, left to right: a later pose wins where two name the same parameter. An unknown name adds nothing. */
export function layerPoses(poses: Record<string, PoseDef> | undefined, names: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const n of names) if (poses && Object.hasOwn(poses, n)) Object.assign(out, poses[n]);
  return out;
}

/**
 * The parameters part-way (`t`, 0-1) from `from` to `to`, both full sets. Each parameter eases along its own curve
 * (`ease` given here, else that of its definition, else linear); one the target leaves alone is not moved. Every curve may
 * overshoot at the ends, so the result is clamped to the parameter's range.
 */
export function lerpParams(defs: ParamDef[] | undefined, from: Record<string, number>, to: Record<string, number>, t: number, ease?: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of defs ?? []) {
    const a = from[d.id] ?? d.default, b = to[d.id] ?? a;
    out[d.id] = a === b ? a : clampParam(d, lerp(a, b, easing(ease ?? d.ease ?? 'linear')(t)));
  }
  return out;
}

/** Problems in the `poses` section: each pose is a map of parameter id to a value inside that parameter's range. */
export function checkPoses(data: { poses?: unknown; parameters?: unknown }, problem: ProblemReport): void {
  if (data.poses === undefined) return;
  if (!data.poses || typeof data.poses !== 'object' || Array.isArray(data.poses)) { problem('poses: needs an object of pose name: { parameter: value }', 'poses'); return; }
  const defs = new Map<string, ParamDef>();
  if (Array.isArray(data.parameters)) for (const p of data.parameters as ParamDef[]) if (p && typeof p.id === 'string') defs.set(p.id, p);
  const known = () => [...defs.keys()].join(', ') || 'none';
  for (const [name, pose] of Object.entries(data.poses as Record<string, unknown>)) {
    if (!/^[A-Za-z_]\w*$/.test(name)) problem(`poses: "${name}" is not a usable name (letters, digits and _)`, name);
    if (!pose || typeof pose !== 'object' || Array.isArray(pose)) { problem(`poses.${name}: needs an object of parameter: value`, name); continue; }
    if (!Object.keys(pose).length) problem(`poses.${name}: names no parameter`, name);
    for (const [id, v] of Object.entries(pose)) {
      const def = defs.get(id);
      if (!def) problem(`poses.${name}: no parameter "${id}" (parameters: ${known()})`, name, id, defs.keys());
      else if (!isNum(v)) problem(`poses.${name}.${id}: must be a number`, name);
      else if (v < def.min || v > def.max) problem(`poses.${name}.${id}: ${v} lies outside "${id}" (${def.min} to ${def.max})`, name);
    }
  }
}

// ---- mesh-warp deformers (rig.json `deformers`, see docs/design/mesh-warp.md) ----

/** Displacements of lattice points, sparse: point index (row-major, y outer) to [dx, dy] in stage fractions; a missing point is 0. */
export type WarpPoints = Record<string, [number, number]>;
/** A deformer driven by one parameter (`param` + `keys`) or by two on a grid (`params` + `grid` + `forms`, row-major like KeyformDef). */
export interface DeformerKeyform {
  param?: string;
  keys?: { at: number; pts?: WarpPoints }[];
  params?: [string, string];
  grid?: { x: number[]; y: number[] };
  forms?: { pts?: WarpPoints }[];
}
/**
 * A lattice over one part (`part`) or over a group of parts (`members`: every part is bent by the lattice over their common
 * box, after its own warp). `grid` is [cols, rows] of cells; several keyforms add their displacements. `box` is a group warp's
 * lattice box [x, y, w, h] in canvas pixels; left out, it is the union of the members' image boxes. A deformer has `part` or `members`, not both.
 */
export interface DeformerDef { id: string; part?: string; members?: string[]; box?: [number, number, number, number]; grid?: [number, number]; mesh?: DeformerMesh; keyforms: DeformerKeyform[] }
/**
 * A free mesh in place of a lattice (see docs/design/free-mesh.md): `verts` are rest positions [x0, y0, x1, y1, ...] in the part's own pixels,
 * `tris` index triples wound consistently; keyform `pts` index the vertices. `detail` is only the generator's hint for Regenerate.
 */
export interface DeformerMesh { verts: number[]; tris: number[]; detail?: string; weights?: MeshWeights; defaultBone?: string }
/**
 * Bone weights of a free mesh (docs/design/skinning.md): vertex number to { bone: weight }. A vertex not listed binds to the mesh's
 * `defaultBone`. Read as relative, normalized per vertex; a mesh with `weights` is skinned.
 */
export type MeshWeights = Record<string, Record<string, number>>;

/** The most bones that may pull one vertex. */
export const MAX_INFLUENCES = 4;

/** The most vertices a free mesh may have. */
export const MESH_MAX_VERTS = 500;
/** How far (pixels) a mesh vertex may lie outside the part's image box. */
export const MESH_BOX_MARGIN = 100;

/** Does the deformer warp a group of parts (it has `members`) rather than one part? */
export const isGroupDeformer = (def: Pick<DeformerDef, 'members'>): boolean => Array.isArray(def.members);

export const DEFORMER_DEFAULT_GRID: [number, number] = [4, 4];
export const DEFORMER_MAX_GRID = 12;

/** The deformer's [cols, rows] (the default when left out). */
export const deformerGrid = (def: Pick<DeformerDef, 'grid'>): [number, number] => def.grid ?? DEFORMER_DEFAULT_GRID;
/** Does the deformer use a free mesh (it has `mesh`) rather than a lattice? */
export const isMeshDeformer = (def: { mesh?: unknown }): boolean => def.mesh !== undefined && def.mesh !== null;
/** Control points of a deformer: (cols + 1) * (rows + 1) for a lattice, the vertex count for a free mesh. */
export const deformerPoints = (def: Pick<DeformerDef, 'grid'> & { mesh?: { verts: ArrayLike<number> } }): number => {
  if (def.mesh) return Math.floor((def.mesh.verts?.length ?? 0) / 2);
  const [c, r] = deformerGrid(def);
  return (c + 1) * (r + 1);
};

/** Linear blend of two equally long displacement vectors. */
export function blendVec(a: ArrayLike<number>, b: ArrayLike<number>, t: number): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < out.length; i++) out[i] = lerp(a[i], b[i] ?? 0, t);
  return out;
}

/** Sparse points as a dense interleaved [dx, dy, ...] vector of `n` points. */
function densify(pts: WarpPoints | undefined, n: number): Float32Array {
  const out = new Float32Array(n * 2);
  for (const [k, p] of Object.entries(pts ?? {})) {
    const i = Number(k);
    if (Number.isInteger(i) && i >= 0 && i < n && Array.isArray(p)) { out[i * 2] = p[0] ?? 0; out[i * 2 + 1] = p[1] ?? 0; }
  }
  return out;
}

function evalDeformerForm(kf: DeformerKeyform, n: number, params: Record<string, number>): Float32Array {
  if (kf.params && kf.grid && kf.forms) {
    const { x: xs, y: ys } = kf.grid;
    if (!xs.length || !ys.length) return new Float32Array(n * 2);
    const form = (cx: number, cy: number) => densify(kf.forms![Math.min(cy, ys.length - 1) * xs.length + Math.min(cx, xs.length - 1)]?.pts, n);
    const [ix, tx] = segment(xs, params[kf.params[0]] ?? 0), [iy, ty] = segment(ys, params[kf.params[1]] ?? 0);
    const top = blendVec(form(ix, iy), form(ix + 1, iy), tx), bottom = blendVec(form(ix, iy + 1), form(ix + 1, iy + 1), tx);
    return blendVec(top, bottom, ty);
  }
  if (kf.param && kf.keys?.length) {
    const keys = [...kf.keys].sort((p, q) => p.at - q.at);
    if (keys.length === 1) return densify(keys[0].pts, n);
    const [i, t] = segment(keys.map(k => k.at), params[kf.param] ?? 0);
    return blendVec(densify(keys[i].pts, n), densify(keys[i + 1].pts, n), t);
  }
  return new Float32Array(n * 2);
}

/** The displacement of `n` points under `keyforms`, interleaved [dx0, dy0, dx1, dy1, ...] in stage fractions; all keyforms added. Lattices and mask polygons share it. */
export function evalPointKeyforms(keyforms: DeformerKeyform[] | undefined, n: number, params: Record<string, number>): Float32Array {
  const out = new Float32Array(n * 2);
  for (const kf of keyforms ?? []) {
    const d = evalDeformerForm(kf, n, params);
    for (let i = 0; i < out.length; i++) out[i] += d[i];
  }
  return out;
}

/** The displacement of every lattice point, interleaved [dx0, dy0, dx1, dy1, ...] in stage fractions; all keyforms added. */
export const evalDeformer = (def: DeformerDef, params: Record<string, number>): Float32Array => evalPointKeyforms(def.keyforms, deformerPoints(def), params);

/** The parameters `keyforms` read, sorted. */
export function pointKeyformParams(keyforms: DeformerKeyform[] | undefined): string[] {
  const ids = new Set<string>();
  for (const kf of keyforms ?? []) { if (kf.param) ids.add(kf.param); for (const p of kf.params ?? []) ids.add(p); }
  return [...ids].sort();
}

/** The parameters a deformer reads, sorted. */
export const deformerParams = (def: DeformerDef): string[] => pointKeyformParams(def.keyforms);

/** The values of the parameters `keyforms` read, joined: it changes exactly when the displacement may, so the renderer's dirty check. */
export const pointKeyformKey = (keyforms: DeformerKeyform[] | undefined, params: Record<string, number>): string => pointKeyformParams(keyforms).map(id => params[id] ?? 0).join('|');

/** The deformer's own parameter values joined: it changes exactly when the displacement may, so the renderer's dirty check. */
export const paramsKey = (def: DeformerDef, params: Record<string, number>): string => pointKeyformKey(def.keyforms, params);

const validGrid = (g: unknown): g is [number, number] => Array.isArray(g) && g.length === 2 && g.every(n => Number.isInteger(n) && n >= 1 && n <= DEFORMER_MAX_GRID);

/**
 * Problems in the `deformers` section. `parts` are the part names, `bones` the bone names (a deformer needs a part),
 * `boneOf` the bone each part sits on (a group warp
 * of parts on different bones is warned about: its displacement is in each part's own space, so a turning bone would skew it).
 */
export function checkDeformers(data: { deformers?: unknown; parameters?: unknown }, parts: Set<string>, bones: Set<string>, problem: ProblemReport, boneOf: ReadonlyMap<string, string> = new Map(), shapes: ReadonlySet<string> = new Set(), boxes: ReadonlyMap<string, readonly [number, number]> = new Map()): void {
  if (data.deformers === undefined) return;
  if (!Array.isArray(data.deformers)) { problem('deformers: needs a list of { id, part or members, grid, keyforms }', 'deformers'); return; }
  const defs = new Map<string, ParamDef>();
  if (Array.isArray(data.parameters)) for (const p of data.parameters as ParamDef[]) if (p && typeof p.id === 'string') defs.set(p.id, p);
  const ids = new Set<string>(), onPart = new Map<string, string>(), inGroup = new Map<string, string>();
  const skinned = new Set<string>(); // parts whose mesh has weights: the weights decide where their points go, not the bone they sit on
  for (const d of data.deformers as DeformerDef[]) if (d && typeof d.part === 'string' && d.mesh && typeof d.mesh === 'object' && d.mesh.weights !== undefined) skinned.add(d.part);
  (data.deformers as DeformerDef[]).forEach((d, i) => {
    const at = `deformers[${i}]`;
    if (!d || typeof d !== 'object') { problem(`${at}: not a deformer`, 'deformers'); return; }
    if (typeof d.id !== 'string' || !d.id) { problem(`${at}: needs an id`, 'deformers'); return; }
    const where = `deformers.${d.id}`;
    if (ids.has(d.id)) problem(`deformers: "${d.id}" is defined twice`, d.id);
    ids.add(d.id);
    if (d.members !== undefined) {
      if (d.part !== undefined) problem(`${where}: has both part and members; a deformer warps one part or a group, not both`, d.id);
      checkMembers(d, where, parts, bones, inGroup, boneOf, problem, shapes, skinned);
    } else if (typeof d.part !== 'string' || !parts.has(d.part)) problem(`${where}.part: ${typeof d.part === 'string' && bones.has(d.part) ? `"${d.part}" is a bone, a deformer needs a part (or list parts in members)` : d.part === undefined ? 'needs a part, or members for a group warp' : `no part named "${String(d.part)}"`}`, d.id);
    else {
      const other = onPart.get(d.part);
      if (other !== undefined) problem(`${where}.part: part "${d.part}" already has deformer "${other}" (one per part)`, d.id);
      else onPart.set(d.part, d.id);
    }
    if (d.box !== undefined && d.members === undefined) problem(`${where}.box: only a group warp (members) has a box; a part warp covers the part's image`, d.id);
    if (d.grid !== undefined && !validGrid(d.grid)) problem(`${where}.grid: use [cols, rows], two whole numbers from 1 to ${DEFORMER_MAX_GRID}`, d.id);
    let n: number, outside = 'the lattice';
    if (d.mesh !== undefined) {
      if (d.grid !== undefined) problem(`${where}: has both grid and mesh; a deformer is a lattice or a free mesh, not both`, d.id);
      if (d.members !== undefined) problem(`${where}.mesh: a group warp (members) is a lattice; a free mesh warps one part`, d.id);
      const size = typeof d.part === 'string' ? boxes.get(d.part) : undefined;
      n = checkMesh(d.mesh, `${where}.mesh`, d.id, size, problem, bones);
      outside = 'the mesh';
    } else n = deformerPoints({ grid: validGrid(d.grid) ? d.grid : undefined });
    if (!Array.isArray(d.keyforms)) { problem(`${where}.keyforms: needs a list`, d.id); return; }
    checkPointKeyforms(d.keyforms, n, `${where}.keyforms`, outside, defs, d.id, problem);
  });
}

/**
 * Problems in a free mesh; returns its vertex count (0 when `verts` is unusable). `size` is the part's image [width, height] when
 * known: no vertex may lie further than MESH_BOX_MARGIN outside it.
 */
function checkMesh(mesh: unknown, where: string, at: string, size: readonly [number, number] | undefined, problem: ProblemReport, bones: ReadonlySet<string> = new Set()): number {
  if (!mesh || typeof mesh !== 'object' || Array.isArray(mesh)) { problem(`${where}: needs { verts, tris }`, at); return 0; }
  const { verts, tris } = mesh as DeformerMesh;
  if (!Array.isArray(verts) || verts.length % 2 !== 0 || !verts.every(isNum)) { problem(`${where}.verts: needs a list of x, y numbers, two per vertex`, at); return 0; }
  const n = verts.length / 2;
  if (n > MESH_MAX_VERTS) problem(`${where}.verts: ${n} vertices, at most ${MESH_MAX_VERTS}`, at);
  checkSkin(mesh as DeformerMesh, n, where, at, bones, problem);
  if (size) {
    const bad = verts.findIndex((v, i) => v < -MESH_BOX_MARGIN || v > size[i % 2] + MESH_BOX_MARGIN);
    if (bad >= 0) problem(`${where}.verts: vertex ${bad >> 1} lies more than ${MESH_BOX_MARGIN} pixels outside the part's image (${size[0]} x ${size[1]})`, at);
  }
  if (!Array.isArray(tris) || tris.length % 3 !== 0 || !tris.length) { problem(`${where}.tris: needs at least one triangle, three vertex indices each`, at); return n; }
  if (!tris.every(i => Number.isInteger(i) && i >= 0 && i < n)) { problem(`${where}.tris: indices must be whole numbers from 0 to ${n - 1}`, at); return n; }
  let sign = 0, flagged = false;
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t] * 2, b = tris[t + 1] * 2, c = tris[t + 2] * 2;
    const area = (verts[b] - verts[a]) * (verts[c + 1] - verts[a + 1]) - (verts[c] - verts[a]) * (verts[b + 1] - verts[a + 1]);
    if (Math.abs(area) < 1e-9) { problem(`${where}.tris: triangle ${t / 3} has no area (collinear or repeated vertices)`, at); continue; }
    const s = Math.sign(area);
    if (sign === 0) sign = s;
    else if (s !== sign && !flagged) { problem(`${where}.tris: triangle ${t / 3} is wound the other way from the first; wind all triangles the same way`, at); flagged = true; }
  }
  return n;
}

/** Problems in a mesh's `weights` and `defaultBone` (n is the vertex count). */
function checkSkin(mesh: DeformerMesh, n: number, where: string, at: string, bones: ReadonlySet<string>, problem: ProblemReport): void {
  const known = (b: string) => bones.has(b);
  const list = () => [...bones].join(', ') || 'no bones';
  if (mesh.defaultBone !== undefined && (typeof mesh.defaultBone !== 'string' || !known(mesh.defaultBone))) problem(`${where}.defaultBone: no bone named "${String(mesh.defaultBone)}" (bones: ${list()})`, at, String(mesh.defaultBone), bones);
  const w = mesh.weights;
  if (w === undefined) return;
  if (!w || typeof w !== 'object' || Array.isArray(w)) { problem(`${where}.weights: needs { "<vertex>": { "<bone>": weight } }`, at); return; }
  for (const [k, v] of Object.entries(w)) {
    const vertex = `${where}.weights.${k}`;
    if (!/^(0|[1-9]\d*)$/.test(k) || Number(k) >= n) { problem(`${vertex}: not a vertex (use a whole number from 0 to ${n - 1})`, at); continue; }
    if (!v || typeof v !== 'object' || Array.isArray(v)) { problem(`${vertex}: needs { "<bone>": weight }`, at); continue; }
    const entries = Object.entries(v);
    if (!entries.length) { problem(`${vertex}: is empty (leave the vertex out to bind it to defaultBone)`, at); continue; }
    let sum = 0, ok = true;
    for (const [bone, x] of entries) {
      if (!known(bone)) { problem(`${vertex}: no bone named "${bone}" (bones: ${list()})`, at, bone, bones); ok = false; }
      if (!(typeof x === 'number' && Number.isFinite(x) && x > 0)) { problem(`${vertex}.${bone}: a weight is a number above 0`, at); ok = false; } else sum += x;
    }
    if (entries.length > MAX_INFLUENCES) problem(`${vertex}: ${entries.length} bones, at most ${MAX_INFLUENCES} may pull one vertex`, at);
    else if (ok && Math.abs(sum - 1) > 0.01) problem(`${vertex}: weights add up to ${Math.round(sum * 1000) / 1000}, not 1 (they are normalized when read)`, at);
  }
}

/**
 * The `members` and `box` of a group warp: image parts or shape parts that exist (once each, in one group at most), ideally on one bone. The default box is the union of the image members' boxes, so a group of shapes only needs one.
 */
/**
 * The bones a group warp's members sit on ('' for none), in member order, leaving out skinned meshes (their weights place their points).
 * More than one, and a bone that turns relative to another skews the group's lattice: the rig check warns, and the studio says so when it
 * makes such a group.
 */
export function groupBones(members: Iterable<string>, boneOf: (m: string) => string | undefined, skinned: (m: string) => boolean = () => false): string[] {
  return [...new Set([...members].filter(m => !skinned(m)).map(m => boneOf(m) ?? ''))];
}

function checkMembers(d: DeformerDef, where: string, parts: Set<string>, bones: Set<string>, inGroup: Map<string, string>, boneOf: ReadonlyMap<string, string>, problem: ProblemReport, shapes: ReadonlySet<string> = new Set(), skinned: ReadonlySet<string> = new Set()): void {
  const members = d.members;
  if (!Array.isArray(members) || !members.length) { problem(`${where}.members: needs a list of one or more part names`, d.id); return; }
  const seen = new Set<string>();
  for (const m of members) {
    if (typeof m !== 'string' || !(parts.has(m) || shapes.has(m))) { problem(`${where}.members: ${typeof m === 'string' && bones.has(m) ? `"${m}" is a bone, a group warp needs parts or shapes` : `no part or shape named "${String(m)}"`}`, d.id); continue; }
    if (seen.has(m)) { problem(`${where}.members: "${m}" is listed twice`, d.id); continue; }
    seen.add(m);
    const other = inGroup.get(m);
    if (other !== undefined) problem(`${where}.members: part "${m}" is already in group warp "${other}" (one group per part)`, d.id);
    else inGroup.set(m, d.id);
  }
  if (d.box === undefined && seen.size && ![...seen].some(m => parts.has(m))) problem(`${where}.box: a group of shapes only has no image box to take; give a box [x, y, width, height] in pixels of the PSD canvas`, d.id);
  const onBones = groupBones(seen, m => boneOf.get(m), m => skinned.has(m));
  if (onBones.length > 1) problem(`${where}.members: the parts sit on different bones (${onBones.map(b => b || 'none').join(', ')}); the group lattice moves them in each part's own space, so a bone that turns relative to the others skews the warp`, d.id);
  if (d.box !== undefined && !(Array.isArray(d.box) && d.box.length === 4 && d.box.every(isNum) && d.box[2] > 0 && d.box[3] > 0)) problem(`${where}.box: use [x, y, width, height] in pixels of the PSD canvas, width and height above 0`, d.id);
}

/**
 * Problems in a list of point keyforms (`DeformerKeyform`: a lattice's or a mask polygon's): parameter ids and ranges, key and
 * grid shapes, and point indices below `n`. `where` names the list in messages, `outside` what a bad index lies outside of, and
 * `at` is the key the editor jumps to.
 */
export function checkPointKeyforms(keyforms: DeformerKeyform[], n: number, where: string, outside: string, defs: Map<string, ParamDef>, at: string, problem: ProblemReport): void {
  const known = () => [...defs.keys()].join(', ') || 'none';
  const checkPts = (pts: unknown, w: string) => {
    if (pts === undefined) return;
    if (!pts || typeof pts !== 'object' || Array.isArray(pts)) { problem(`${w}.pts: needs an object of point: [dx, dy]`, at); return; }
    for (const [k, p] of Object.entries(pts)) {
      if (!/^\d+$/.test(k) || Number(k) >= n) problem(`${w}.pts: point "${k}" is outside ${outside} (0 to ${n - 1})`, at);
      if (!Array.isArray(p) || p.length !== 2 || !p.every(isNum)) problem(`${w}.pts.${k}: use [dx, dy] numbers`, at);
    }
  };
  const checkParam = (id: unknown, w: string, lo: number, hi: number) => {
    const def = typeof id === 'string' ? defs.get(id) : undefined;
    if (!def) problem(`${w}: no parameter "${String(id)}" (parameters: ${known()})`, at, String(id), defs.keys());
    else if (lo < def.min || hi > def.max) problem(`${w}: values ${lo} to ${hi} lie outside "${def.id}" (${def.min} to ${def.max})`, at);
  };
  keyforms.forEach((k, j) => {
    const w = `${where}[${j}]`;
    if (!k || typeof k !== 'object') { problem(`${w}: not a keyform`, at); return; }
    const oneD = k.param !== undefined || k.keys !== undefined, twoD = k.params !== undefined || k.grid !== undefined || k.forms !== undefined;
    if (oneD === twoD) { problem(`${w}: use either param + keys, or params + grid + forms`, at); return; }
    if (oneD) {
      if (!Array.isArray(k.keys) || !k.keys.length) { problem(`${w}.keys: needs at least one key`, at); return; }
      const ats = k.keys.map(key => key?.at);
      if (!ats.every(isNum)) problem(`${w}.keys: every key needs a numeric "at"`, at);
      else {
        if (new Set(ats).size !== ats.length) problem(`${w}.keys: two keys at the same value`, at);
        checkParam(k.param, `${w}.param`, Math.min(...ats), Math.max(...ats));
      }
      k.keys.forEach((key, m) => checkPts(key?.pts, `${w}.keys[${m}]`));
      return;
    }
    if (!Array.isArray(k.params) || k.params.length !== 2) { problem(`${w}.params: needs two parameter ids`, at); return; }
    if (k.params[0] === k.params[1]) problem(`${w}.params: the two parameters must differ`, at);
    if (!k.grid || !ascending(k.grid.x) || !ascending(k.grid.y) || !k.grid.x.length || !k.grid.y.length) { problem(`${w}.grid: needs x and y lists of numbers in ascending order`, at); return; }
    checkParam(k.params[0], `${w}.params[0]`, k.grid.x[0], k.grid.x[k.grid.x.length - 1]);
    checkParam(k.params[1], `${w}.params[1]`, k.grid.y[0], k.grid.y[k.grid.y.length - 1]);
    const want = k.grid.x.length * k.grid.y.length;
    if (!Array.isArray(k.forms) || k.forms.length !== want) { problem(`${w}.forms: needs ${want} forms (${k.grid.x.length} x ${k.grid.y.length}, one row of x after another), has ${Array.isArray(k.forms) ? k.forms.length : 0}`, at); return; }
    k.forms.forEach((f, m) => checkPts(f?.pts, `${w}.forms[${m}]`));
  });
}
