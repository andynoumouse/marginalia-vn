// Creating, renaming, deleting and re-ranging the parameters and pads of a rig (rig.json `parameters`, `pads`): the pure half of
// the Parameters section's editing in the animation studio's Model mode. A parameter is named by the keyforms, poses, animation
// tracks, deformers, masks and physics chains that use it, so a rename or a delete has to reach all of them; these functions take
// the parts of the working copy that can name one (`ParamDoc`), return a changed copy and leave their input alone. A refusal
// is `{ error }` with a sentence for the author; scripts are not in the document, so their `animate` lines are not followed.

import { EASE_NAMES } from './anim.js';
import type { Anims } from './anim-edit.js';
import type { ShapeDef } from './masks.js';
import type { RigPhysicsChain } from './physics-rig.js';
import { controlGroups, OTHER } from './param-tracks.js';
import type { DeformerDef, KeyformDef, PadDef, ParamDef, PoseDef } from './params.js';

/** What can name a parameter: the working copy's parameter section and everything that refers to one. */
export interface ParamDoc {
  /** The panel's categories, in order (rig.json `categories`); a parameter or pad names one in its `group`. */
  categories: string[];
  parameters: ParamDef[];
  pads: PadDef[];
  keyforms: KeyformDef[];
  poses: Record<string, PoseDef>;
  anims: Anims;
  deformers: DeformerDef[];
  shapes: Record<string, ShapeDef>;
  physics: Record<string, RigPhysicsChain>;
}
const mapShapes = (shapes: Record<string, ShapeDef>, fn: (s: ShapeDef) => ShapeDef): Record<string, ShapeDef> => Object.fromEntries(Object.entries(shapes).map(([k, v]) => [k, fn(v)]));
export type ParamEdit = { doc: ParamDoc; note: string; id?: string } | { error: string };

/** What a parameter or pad id may be: the same words a script's `animate robo id=0.5` and a `pose=` name take. */
export const PARAM_ID = /^[A-Za-z_]\w*$/;
const EPS = 1e-9;
const round5 = (n: number) => Math.round(n * 1e5) / 1e5 + 0;

/** `base`, else `base2`, `base3`... the first not in `taken`. */
export function uniqueParamId(taken: Iterable<string>, base = 'param'): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ---- renaming ----

/** Anything shaped like a keyform: a bone's, a lattice's or a mask polygon's. */
interface AnyKeyform { param?: string; keys?: { at: number }[]; params?: [string, string]; grid?: { x: number[]; y: number[] }; forms?: unknown[] }

const renameKey = <T>(o: Record<string, T>, from: string, to: string): Record<string, T> => Object.fromEntries(Object.entries(o).map(([k, v]) => [k === from ? to : k, v]));

function renameInKeyform<T extends AnyKeyform>(k: T, from: string, to: string): T {
  const out: AnyKeyform = { ...k };
  if (out.param === from) out.param = to;
  if (out.params) out.params = out.params.map(p => (p === from ? to : p)) as [string, string];
  return out as T;
}

function renameIn(doc: ParamDoc, from: string, to: string): ParamDoc {
  const sub = (id: string | undefined) => (id === from ? to : id);
  return {
    categories: doc.categories,
    parameters: doc.parameters.map(p => (p.id === from ? { ...p, id: to } : p)),
    pads: doc.pads.map(p => ({ ...p, x: sub(p.x)!, y: sub(p.y)! })),
    keyforms: doc.keyforms.map(k => renameInKeyform(k, from, to)),
    poses: Object.fromEntries(Object.entries(doc.poses).map(([n, pose]) => [n, Object.hasOwn(pose, from) ? renameKey(pose, from, to) : pose])),
    anims: Object.fromEntries(Object.entries(doc.anims).map(([n, a]) => [n, a?.params && Object.hasOwn(a.params, from) ? { ...a, params: renameKey(a.params, from, to) } : a])),
    deformers: doc.deformers.map(d => ({ ...d, keyforms: (d.keyforms ?? []).map(k => renameInKeyform(k, from, to)) })),
    shapes: mapShapes(doc.shapes, m => (m.keyforms ? { ...m, keyforms: m.keyforms.map(k => renameInKeyform(k, from, to)) } : m)),
    physics: Object.fromEntries(Object.entries(doc.physics).map(([n, c]) => [n, {
      ...c,
      inputs: (c.inputs ?? []).map(i => (i.param === from ? { ...i, param: to } : i)),
      outputs: (c.outputs ?? []).map(o => (o.param === from ? { ...o, param: to } : o)),
    }])),
  };
}

// ---- fitting to a new range ----

/**
 * The lines (keys or grid lines) of one axis fitted to `min`..`max`: those inside stay, and the nearest one beyond each end moves
 * onto that end unless a line is there already; the others are dropped. `keep` are the indices of the old lines that remain.
 */
export function fitAxis(values: readonly number[], min: number, max: number): { values: number[]; keep: number[] } {
  const idx = values.map((_, i) => i);
  const list = idx.filter(i => values[i] >= min - EPS && values[i] <= max + EPS).map(i => ({ i, v: Math.min(max, Math.max(min, values[i])) }));
  const below = idx.filter(i => values[i] < min - EPS).sort((a, b) => values[b] - values[a])[0];
  const above = idx.filter(i => values[i] > max + EPS).sort((a, b) => values[a] - values[b])[0];
  if (below !== undefined && !list.some(l => l.v <= min + EPS)) list.push({ i: below, v: min });
  if (above !== undefined && !list.some(l => l.v >= max - EPS)) list.push({ i: above, v: max });
  list.sort((a, b) => a.v - b.v);
  return { values: list.map(l => round5(l.v)), keep: list.map(l => l.i) };
}

function fitKeyform<T extends AnyKeyform>(k: T, id: string, min: number, max: number): T {
  const out: AnyKeyform = { ...k };
  if (out.param === id && Array.isArray(out.keys)) {
    const old = out.keys, f = fitAxis(old.map(key => key.at), min, max);
    out.keys = f.keep.map((i, n) => ({ ...old[i], at: f.values[n] }));
  } else if (out.params && out.grid && Array.isArray(out.forms)) {
    const xf = out.params[0] === id ? fitAxis(out.grid.x, min, max) : null, yf = out.params[1] === id ? fitAxis(out.grid.y, min, max) : null;
    if (xf || yf) {
      const nx = out.grid.x.length, kx = xf?.keep ?? out.grid.x.map((_, i) => i), ky = yf?.keep ?? out.grid.y.map((_, i) => i), old = out.forms;
      out.forms = ky.flatMap(y => kx.map(x => old[y * nx + x]));
      out.grid = { x: xf?.values ?? out.grid.x, y: yf?.values ?? out.grid.y };
    }
  }
  return out as T;
}

function fitIn(doc: ParamDoc, id: string, min: number, max: number): ParamDoc {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  return {
    ...doc,
    keyforms: doc.keyforms.map(k => fitKeyform(k, id, min, max)),
    poses: Object.fromEntries(Object.entries(doc.poses).map(([n, pose]) => [n, Object.hasOwn(pose, id) ? { ...pose, [id]: clamp(pose[id]) } : pose])),
    anims: Object.fromEntries(Object.entries(doc.anims).map(([n, a]) => [n, a?.params && Object.hasOwn(a.params, id) ? { ...a, params: { ...a.params, [id]: a.params[id].map(k => ({ ...k, v: clamp(k.v) })) } } : a])),
    deformers: doc.deformers.map(d => ({ ...d, keyforms: (d.keyforms ?? []).map(k => fitKeyform(k, id, min, max)) })),
    shapes: mapShapes(doc.shapes, m => (m.keyforms ? { ...m, keyforms: m.keyforms.map(k => fitKeyform(k, id, min, max)) } : m)),
  };
}

// ---- parameters ----

/** A new parameter: -1 to 1, default 0, at the end of the list, in category `group` when one is given. */
export function addParam(doc: ParamDoc, group?: string): ParamEdit {
  if (group && !doc.categories.includes(group)) return { error: `There is no category "${group}".` };
  const id = uniqueParamId(doc.parameters.map(p => p.id));
  const def: ParamDef = { id, min: -1, max: 1, default: 0, ...(group ? { group } : {}) };
  return { doc: { ...doc, parameters: [...doc.parameters, def] }, note: `Added parameter "${id}" (-1 to 1, default 0)${group ? ` under ${group}` : ''}. Rename it and set its range under Edit; pose the chosen bone at a value to key it.`, id };
}

export interface ParamPatch { id?: string; min?: number; max?: number; default?: number; group?: string | null; ease?: string | null }

/**
 * Parameter `id` with `patch` applied. A new id is carried through the keyforms, pads, poses, animation tracks, deformers, masks
 * and physics chains that name it. A new range moves keys, grid lines and pose and track values that fall outside it (the nearest
 * onto the edge, the rest dropped, see `fitAxis`); the default follows into the range unless the patch gives one.
 */
export function updateParam(doc: ParamDoc, id: string, patch: ParamPatch): ParamEdit {
  const def = doc.parameters.find(p => p.id === id);
  if (!def) return { error: `There is no parameter "${id}".` };
  const notes: string[] = [];
  let out = doc, name = id;
  if (patch.id !== undefined && patch.id !== id) {
    const to = patch.id.trim();
    if (!PARAM_ID.test(to)) return { error: 'A parameter name has letters, digits and _ only, and starts with a letter or _.' };
    if (doc.parameters.some(p => p.id === to)) return { error: `There is a parameter named "${to}" already.` };
    out = renameIn(out, id, to);
    name = to;
    notes.push(`Renamed to "${to}" in the keyforms, pads, poses, animation tracks, deformers, masks and physics of this rig. Script lines that name "${id}" are not changed.`);
  }
  if (patch.group && !doc.categories.includes(patch.group)) return { error: `There is no category "${patch.group}".` };
  const pad = padOfAxis(doc, id);
  if (pad && patch.group !== undefined && (patch.group || undefined) !== pad.group) return { error: `"${id}" is an axis of the pad "${pad.id}" and stays in its category. Change the category of the pad instead.` };
  const min = patch.min ?? def.min, max = patch.max ?? def.max;
  if (!Number.isFinite(min) || !Number.isFinite(max) || (patch.default !== undefined && !Number.isFinite(patch.default))) return { error: 'The range and the default are numbers.' };
  if (!(min < max)) return { error: 'The minimum must be less than the maximum.' };
  if (patch.default !== undefined && (patch.default < min || patch.default > max)) return { error: `The default must lie between ${min} and ${max}.` };
  const dflt = patch.default ?? Math.min(max, Math.max(min, def.default));
  if (patch.ease !== undefined && patch.ease !== null && patch.ease !== '' && !EASE_NAMES.includes(patch.ease)) return { error: `Unknown ease "${patch.ease}" (${EASE_NAMES.join(', ')}).` };
  const ranged = min !== def.min || max !== def.max;
  if (ranged) {
    const fitted = fitIn(out, name, min, max);
    if (JSON.stringify(fitted) !== JSON.stringify(out)) notes.push('Keys, poses and track values beyond the new range were moved to its edge or dropped.');
    out = fitted;
  }
  if (dflt !== def.default && patch.default === undefined) notes.push(`The default moved to ${dflt}, inside the new range.`);
  out = {
    ...out,
    parameters: out.parameters.map(p => {
      if (p.id !== name) return p;
      const next: ParamDef = { ...p, min, max, default: dflt };
      if (patch.group !== undefined) { if (patch.group) next.group = patch.group; else delete next.group; }
      if (patch.ease !== undefined) { if (patch.ease) next.ease = patch.ease; else delete next.ease; }
      return next;
    }),
  };
  return { doc: out, note: notes.join(' ') || `Changed "${name}".`, id: name };
}

/** Parameter `id` and everything of this rig that used it: its keyforms, the pads on it, its pose values, animation tracks, and deformer and mask keyforms. Refused while a physics chain reads or writes it. */
export function deleteParam(doc: ParamDoc, id: string): ParamEdit {
  if (!doc.parameters.some(p => p.id === id)) return { error: `There is no parameter "${id}".` };
  const chains = Object.entries(doc.physics).filter(([, c]) => (c.inputs ?? []).some(i => i.param === id) || (c.outputs ?? []).some(o => o.param === id)).map(([n]) => n);
  if (chains.length) return { error: `"${id}" is read or written by the physics chain${chains.length === 1 ? '' : 's'} ${chains.join(', ')}. Point ${chains.length === 1 ? 'it' : 'them'} at another parameter (Physics section) first.` };
  const uses = (k: AnyKeyform) => k.param === id || !!k.params?.includes(id);
  const gone = { keyforms: doc.keyforms.filter(uses).length, pads: doc.pads.filter(p => p.x === id || p.y === id).length, poses: 0, tracks: 0, lattices: 0 };
  const poses: Record<string, PoseDef> = {};
  for (const [n, pose] of Object.entries(doc.poses)) {
    if (!Object.hasOwn(pose, id)) { poses[n] = pose; continue; }
    gone.poses++;
    const { [id]: _drop, ...rest } = pose;
    if (Object.keys(rest).length) poses[n] = rest;
  }
  const anims: Anims = {};
  for (const [n, a] of Object.entries(doc.anims)) {
    if (!a?.params || !Object.hasOwn(a.params, id)) { anims[n] = a; continue; }
    gone.tracks++;
    const { [id]: _drop, ...rest } = a.params;
    const { params: _params, ...others } = a;
    anims[n] = Object.keys(rest).length ? { ...others, params: rest } : others;
  }
  const deformers = doc.deformers.map(d => { const kept = (d.keyforms ?? []).filter(k => !uses(k)); gone.lattices += (d.keyforms ?? []).length - kept.length; return kept.length === (d.keyforms ?? []).length ? d : { ...d, keyforms: kept }; });
  const shapes = mapShapes(doc.shapes, m => {
    if (!m.keyforms) return m;
    const kept = m.keyforms.filter(k => !uses(k));
    gone.lattices += m.keyforms.length - kept.length;
    if (kept.length === m.keyforms.length) return m;
    const { keyforms: _k, ...rest } = m;
    return kept.length ? { ...rest, keyforms: kept } : rest;
  });
  const parts = [
    gone.keyforms ? plural(gone.keyforms, 'bone or part keyform') : '', gone.pads ? plural(gone.pads, 'pad') : '', gone.poses ? plural(gone.poses, 'pose value') : '',
    gone.tracks ? plural(gone.tracks, 'animation track') : '', gone.lattices ? plural(gone.lattices, 'warp or mask keyform') : '',
  ].filter(Boolean);
  return {
    doc: { ...doc, parameters: doc.parameters.filter(p => p.id !== id), pads: doc.pads.filter(p => p.x !== id && p.y !== id), keyforms: doc.keyforms.filter(k => !uses(k)), poses, anims, deformers, shapes },
    note: `Deleted "${id}"${parts.length ? ` with ${parts.join(', ')}` : ''}. Script lines that set it are not changed.`,
  };
}

// ---- pads ----

/** The parameters no pad uses, in order: a pad takes two of them. */
export const freeParams = (doc: Pick<ParamDoc, 'parameters' | 'pads'>, except?: string): ParamDef[] =>
  doc.parameters.filter(p => !doc.pads.some(pad => pad.id !== except && (pad.x === p.id || pad.y === p.id)));

/** What a new pad is made of: a name (else "pad", "pad2"...) and, for each axis, an existing parameter no pad uses or null for a new one (named `<pad>_x`, `<pad>_y`, -1 to 1). */
export interface PadSpec { id?: string; x: string | null; y: string | null }

/** A new pad over the parameters `spec` names (a parameter in a pad has no slider of its own), in category `group` (else the first existing axis's, else none). Nothing is picked for the caller. */
export function addPad(doc: ParamDoc, group: string | undefined, spec: PadSpec): ParamEdit {
  if (group && !doc.categories.includes(group)) return { error: `There is no category "${group}".` };
  const taken = new Set(doc.pads.flatMap(p => [p.x, p.y]));
  for (const axis of [spec.x, spec.y]) {
    if (axis === null) continue;
    if (!doc.parameters.some(p => p.id === axis)) return { error: `There is no parameter "${axis}".` };
    if (taken.has(axis)) return { error: `"${axis}" is on another pad already.` };
  }
  if (spec.x !== null && spec.x === spec.y) return { error: 'A pad needs two different parameters.' };
  const name = spec.id?.trim();
  if (name) {
    if (!PARAM_ID.test(name)) return { error: 'A pad name has letters, digits and _ only, and starts with a letter or _.' };
    if (doc.pads.some(p => p.id === name)) return { error: `There is a pad named "${name}" already.` };
  }
  const id = name || uniqueParamId(doc.pads.map(p => p.id), 'pad');
  const used = doc.parameters.map(p => p.id);
  const made: ParamDef[] = [];
  const axis = (given: string | null, suffix: string) => {
    if (given !== null) return given;
    const pid = uniqueParamId([...used, ...made.map(m => m.id)], `${id}_${suffix}`);
    made.push({ id: pid, min: -1, max: 1, default: 0 });
    return pid;
  };
  const x = axis(spec.x, 'x'), y = axis(spec.y, 'y');
  const first = doc.parameters.find(p => p.id === x || p.id === y);
  const pad: PadDef = { id, x, y };
  const cat = group ?? first?.group;
  if (cat) pad.group = cat;
  const out = alignAxes({ ...doc, parameters: [...doc.parameters, ...made], pads: [...doc.pads, pad] }, pad);
  return { doc: out, note: `Added pad "${id}" over ${x} (across) and ${y} (up)${made.length ? `; new parameter${made.length === 1 ? '' : 's'} ${made.map(m => m.id).join(', ')}` : ''}. Both parameters now share the pad's control.`, id };
}

/** `item` in category `group` (none: no category). */
const inCategory = <T extends { group?: string }>(item: T, group?: string): T => { const { group: _g, ...rest } = item; return (group ? { ...rest, group } : rest) as T; };

/** The pad whose axis parameter `id` is, if any: an axis shows under its pad and moves with it. */
const padOfAxis = (doc: Pick<ParamDoc, 'pads'>, id: string) => doc.pads.find(p => p.x === id || p.y === id);

/** The pad's two parameters in the pad's category, so that taking the pad away leaves them where they were shown. */
const alignAxes = (doc: ParamDoc, pad: PadDef): ParamDoc => ({ ...doc, parameters: doc.parameters.map(p => (p.id === pad.x || p.id === pad.y ? inCategory(p, pad.group) : p)) });

export interface PadPatch { id?: string; x?: string; y?: string; group?: string | null }

/** Pad `id` with `patch` applied; its two parameters differ, exist, and are used by no other pad. */
export function updatePad(doc: ParamDoc, id: string, patch: PadPatch): ParamEdit {
  const pad = doc.pads.find(p => p.id === id);
  if (!pad) return { error: `There is no pad "${id}".` };
  const next: PadDef = { ...pad };
  if (patch.id !== undefined && patch.id !== id) {
    const to = patch.id.trim();
    if (!PARAM_ID.test(to)) return { error: 'A pad name has letters, digits and _ only, and starts with a letter or _.' };
    if (doc.pads.some(p => p.id === to)) return { error: `There is a pad named "${to}" already.` };
    next.id = to;
  }
  for (const axis of ['x', 'y'] as const) if (patch[axis] !== undefined) {
    const to = patch[axis]!;
    if (!doc.parameters.some(p => p.id === to)) return { error: `There is no parameter "${to}".` };
    if (doc.pads.some(p => p.id !== id && (p.x === to || p.y === to))) return { error: `"${to}" is on another pad already.` };
    next[axis] = to;
  }
  if (next.x === next.y) return { error: 'A pad needs two different parameters.' };
  if (patch.group && !doc.categories.includes(patch.group)) return { error: `There is no category "${patch.group}".` };
  if (patch.group !== undefined) { if (patch.group) next.group = patch.group; else delete next.group; }
  return { doc: alignAxes({ ...doc, pads: doc.pads.map(p => (p.id === id ? next : p)) }, next), note: `Changed pad "${next.id}".`, id: next.id };
}

/** Pad `id` goes; its parameters stay, and so do their keyforms (each shows as a slider again). */
export function deletePad(doc: ParamDoc, id: string): ParamEdit {
  const pad = doc.pads.find(p => p.id === id);
  if (!pad) return { error: `There is no pad "${id}".` };
  return { doc: { ...doc, pads: doc.pads.filter(p => p.id !== id) }, note: `Deleted pad "${id}". ${pad.x} and ${pad.y} are sliders again; their keyforms are kept.` };
}

// ---- categories ----

/** A new, empty category at the end of the list; `name` when it is free, else "Category", "Category2"... */
export function addCategory(doc: ParamDoc, name = 'Category'): ParamEdit {
  const to = uniqueParamId([...doc.categories, OTHER], name.trim() || 'Category');
  return { doc: { ...doc, categories: [...doc.categories, to] }, note: `Added the category "${to}". Drag parameters into it, or add one with its + button.`, id: to };
}

/** Category `from` under the name `to`: the parameters and pads in it follow. A name is a non-empty label no other category has ("Other" is the home of the uncategorised). */
export function renameCategory(doc: ParamDoc, from: string, to: string): ParamEdit {
  if (!doc.categories.includes(from)) return { error: `There is no category "${from}".` };
  const name = to.trim();
  if (!name) return { error: 'A category needs a name.' };
  if (name === from) return { doc, note: `"${from}" keeps its name.`, id: from };
  if (name === OTHER || doc.categories.includes(name)) return { error: `There is a category named "${name}" already.` };
  const sub = <T extends { group?: string }>(x: T): T => (x.group === from ? { ...x, group: name } : x);
  return {
    doc: { ...doc, categories: doc.categories.map(c => (c === from ? name : c)), parameters: doc.parameters.map(sub), pads: doc.pads.map(sub) },
    note: `Renamed the category "${from}" to "${name}".`, id: name,
  };
}

/** Category `name` goes; what was in it moves to Other (the parameters themselves stay). */
export function deleteCategory(doc: ParamDoc, name: string): ParamEdit {
  if (!doc.categories.includes(name)) return { error: `There is no category "${name}".` };
  const drop = <T extends { group?: string }>(x: T): T => { if (x.group !== name) return x; const { group: _g, ...rest } = x; return rest as T; };
  const held = doc.parameters.filter(p => p.group === name).length + doc.pads.filter(p => p.group === name).length;
  return {
    doc: { ...doc, categories: doc.categories.filter(c => c !== name), parameters: doc.parameters.map(drop), pads: doc.pads.map(drop) },
    note: `Deleted the category "${name}"${held ? `; its ${plural(held, 'control')} moved to Other` : ''}.`,
  };
}

/** Category `name` in front of category `before`, or last when `before` is left out. */
export function moveCategory(doc: ParamDoc, name: string, before?: string): ParamEdit {
  if (!doc.categories.includes(name)) return { error: `There is no category "${name}".` };
  if (before !== undefined && !doc.categories.includes(before)) return { error: `There is no category "${before}".` };
  const others = doc.categories.filter(c => c !== name);
  const at = before === undefined ? others.length : others.indexOf(before);
  return { doc: { ...doc, categories: [...others.slice(0, at), name, ...others.slice(at)] }, note: `Moved the category "${name}".` };
}

/**
 * A slider or pad (`control`: the parameter id, or `pad:<id>`) into category `category` (null: Other), in front of control `before`
 * of the same kind when that is given and already there, else at the end. A drag in the panel is this.
 */
export function moveControlTo(doc: ParamDoc, control: string, category: string | null, before?: string): ParamEdit {
  if (category !== null && !doc.categories.includes(category)) return { error: `There is no category "${category}".` };
  const isPad = control.startsWith('pad:'), id = isPad ? control.slice(4) : control;
  const list = (isPad ? doc.pads : doc.parameters) as ({ id: string; group?: string })[];
  const item = list.find(x => x.id === id);
  if (!item) return { error: `There is no ${isPad ? 'pad' : 'parameter'} "${id}" to move.` };
  const pad = isPad ? undefined : padOfAxis(doc, id);
  if (pad) return { error: `"${id}" is an axis of the pad "${pad.id}": it moves with the pad. Drag the pad instead.` };
  const moved = inCategory(item, category ?? undefined);
  const others = list.filter(x => x.id !== id);
  const beforeId = before?.startsWith('pad:') === isPad ? before?.replace(/^pad:/, '') : undefined;
  const at = beforeId === undefined ? -1 : others.findIndex(x => x.id === beforeId);
  const next = at < 0 ? [...others, moved] : [...others.slice(0, at), moved, ...others.slice(at)];
  return {
    doc: isPad ? alignAxes({ ...doc, pads: next as PadDef[] }, moved as PadDef) : { ...doc, parameters: next as ParamDef[] },
    note: `Moved "${id}" to ${category ?? OTHER}.`,
  };
}

/**
 * A slider or pad (`control`: the parameter id, or `pad:<id>`) one place up or down inside its group, among the controls of its own
 * kind: the panel lists a group's pads first, then its sliders, each in the order of the `pads` and `parameters` lists, so the two
 * lists are what is reordered. A refusal at either end of the group.
 */
export function moveControl(doc: ParamDoc, control: string, dir: -1 | 1): ParamEdit {
  const isPad = control.startsWith('pad:'), id = isPad ? control.slice(4) : control;
  const group = controlGroups(doc.parameters, doc.pads, doc.categories).find(g => g.controls.some(c => (c.kind === 'pad' ? c.pad.id === id && isPad : c.param.id === id && !isPad)));
  if (!group) return { error: `There is no ${isPad ? 'pad' : 'parameter'} "${id}" to move.` };
  const pad = isPad ? undefined : padOfAxis(doc, id);
  if (pad) return { error: `"${id}" is an axis of the pad "${pad.id}": it stays under the pad.` };
  const mates = group.controls.filter(c => (c.kind === 'pad') === isPad && (isPad || !padOfAxis(doc, c.kind === 'slider' ? c.param.id : ''))).map(c => (c.kind === 'pad' ? c.pad.id : c.param.id));
  const at = mates.indexOf(id), other = mates[at + dir];
  if (other === undefined) return { error: `"${id}" is already the ${dir < 0 ? 'first' : 'last'} ${isPad ? 'pad' : 'slider'} of ${group.name}.` };
  const list = (isPad ? doc.pads : doc.parameters) as { id: string }[], next = [...list];
  const i = next.findIndex(x => x.id === id), j = next.findIndex(x => x.id === other);
  [next[i], next[j]] = [next[j], next[i]];
  return { doc: isPad ? { ...doc, pads: next as PadDef[] } : { ...doc, parameters: next as ParamDef[] }, note: `Moved "${id}" ${dir < 0 ? 'up' : 'down'} in ${group.name}.` };
}
