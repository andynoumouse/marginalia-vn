// Pure edits for the animation studio's Parameters panel and parameter tracks (rig.json `animations.<name>.params`,
// `poses`). Every function returns new objects and leaves its input alone; keys stay sorted by `t`.

import { tracksAt, type AnimDef, type ParamKey, type ParamTracks } from './anim.js';
import { clampParam, type PadDef, type ParamDef, type PoseDef } from './params.js';
import { clamp01 } from './util.js';

const round4 = (n: number) => Math.round(n * 10000) / 10000;
const sortKeys = (keys: ParamKey[]) => [...keys].sort((a, b) => a.t - b.t);

/** The parameters `def` has tracks for, in order of first appearance. */
export const trackIds = (def: AnimDef): string[] => Object.keys(def.params ?? {}).filter(id => Array.isArray(def.params![id]) && def.params![id].length);

export const paramKeys = (def: AnimDef, id: string): ParamKey[] => (Object.hasOwn(def.params ?? {}, id) ? def.params![id] : []);

function withTrack(def: AnimDef, id: string, keys: ParamKey[]): AnimDef {
  const { params, ...rest } = def;
  const next: ParamTracks = { ...params };
  if (keys.length) next[id] = keys; else delete next[id];
  return Object.keys(next).length ? { ...rest, params: next } : rest as AnimDef;
}

/** `def` with a key on parameter `id`. A key within 0.0005 of the same `t` is replaced. Returns the index it ended up at. */
export function addParamKey(def: AnimDef, id: string, key: ParamKey): { def: AnimDef; index: number } {
  const add: ParamKey = { ...key, t: round4(clamp01(key.t)), v: round4(key.v) };
  const keys = [...paramKeys(def, id)];
  const same = keys.findIndex(k => Math.abs(k.t - add.t) < 0.0005);
  if (same >= 0) keys[same] = { ...keys[same], ...add, t: keys[same].t };
  else keys.push(add);
  const sorted = sortKeys(keys);
  return { def: withTrack(def, id, sorted), index: sorted.indexOf(same >= 0 ? keys[same] : add) };
}

/** `def` with key `index` of parameter `id` changed by `patch` (an undefined `ease` or `bezier` removes it). Returns the key's new index. */
export function setParamKey(def: AnimDef, id: string, index: number, patch: Partial<ParamKey>): { def: AnimDef; index: number } {
  const keys = [...paramKeys(def, id)];
  if (!keys[index]) return { def, index };
  const next: ParamKey = { ...keys[index], ...patch };
  if (next.ease === undefined) delete next.ease;
  if (next.bezier === undefined) delete next.bezier;
  next.t = round4(clamp01(next.t));
  next.v = round4(next.v);
  keys[index] = next;
  const sorted = sortKeys(keys);
  return { def: withTrack(def, id, sorted), index: sorted.indexOf(next) };
}

/** `def` without key `index` of parameter `id`; the last key takes the track with it. */
export function deleteParamKey(def: AnimDef, id: string, index: number): AnimDef {
  return withTrack(def, id, paramKeys(def, id).filter((_, i) => i !== index));
}

/** `def` with every parameter of `values` keyed at `t` (what a pad key or "key all" does). */
export function keyParams(def: AnimDef, values: Record<string, number>, t: number): AnimDef {
  let out = def;
  for (const [id, v] of Object.entries(values)) out = addParamKey(out, id, { t, v }).def;
  return out;
}

/** Values of the tracks at `n + 1` evenly spaced progress points, for drawing a lane; empty when the track has no keys. */
export function sampleTrack(def: AnimDef, id: string, n = 120): number[] {
  const tracks: ParamTracks = { [id]: paramKeys(def, id) };
  const out: number[] = [];
  for (let i = 0; i <= n; i++) { const v = tracksAt(tracks, i / n)[id]; if (v === undefined) return []; out.push(v); }
  return out;
}

/**
 * What the Parameters panel shows for the stage: the panel's own values (`base`, a missing one at its default), with the
 * animation's tracks at `t` on top except for the parameters in `hold` (ones the user is moving by hand).
 */
export function displayValues(defs: ParamDef[], base: Record<string, number>, def: AnimDef | null, t: number, hold: ReadonlySet<string> | string[] = []): Record<string, number> {
  const held = new Set(hold), tracked = def?.params ? tracksAt(def.params, t) : {};
  const out: Record<string, number> = {};
  for (const d of defs) {
    const v = !held.has(d.id) && Object.hasOwn(tracked, d.id) ? tracked[d.id] : base[d.id] ?? d.default;
    out[d.id] = clampParam(d, v);
  }
  return out;
}

/** One control of the panel: a slider for a parameter, or a pad for two. */
export type Control = { kind: 'slider'; param: ParamDef } | { kind: 'pad'; pad: PadDef; x: ParamDef; y: ParamDef };
export interface ControlGroup { name: string; controls: Control[] }

/**
 * The panel's layout: one group per category (rig.json `categories`, in that order, empty ones too), each holding the controls
 * whose `group` it names (a pad has its own). Controls in no category go last under "Other", which is
 * listed only when it has any. Every parameter has its slider, also the two a pad drives: the pad is a shortcut over them,
 * and they follow it, in its category and right under it (a pad's axes never part from it). The sliders of no pad come after.
 */
export const OTHER = 'Other';
export function controlGroups(defs: ParamDef[] | undefined, pads: PadDef[] | undefined, categories: string[] = []): ControlGroup[] {
  const byId = new Map((defs ?? []).map(d => [d.id, d]));
  const used = new Set<string>();
  const groups = new Map<string, Control[]>(categories.map(c => [c, []]));
  const other: Control[] = [];
  const add = (name: string | undefined, c: Control) => { const list = name ? groups.get(name) : undefined; (list ?? other).push(c); };
  for (const pad of pads ?? []) {
    const x = byId.get(pad.x), y = byId.get(pad.y);
    if (!x || !y || used.has(x.id) || used.has(y.id)) continue;
    used.add(x.id); used.add(y.id);
    // The pad's two sliders stay right under it, in its category, whatever their own `group` says.
    add(pad.group, { kind: 'pad', pad, x, y });
    add(pad.group, { kind: 'slider', param: x });
    add(pad.group, { kind: 'slider', param: y });
  }
  for (const d of defs ?? []) if (!used.has(d.id)) add(d.group, { kind: 'slider', param: d });
  return [...[...groups].map(([name, controls]) => ({ name, controls })), ...(other.length ? [{ name: OTHER, controls: other }] : [])];
}

/** The parameters whose value differs from the default (a pose usually names only these). */
export function changedParams(defs: ParamDef[], values: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of defs) if (Object.hasOwn(values, d.id) && Math.abs(values[d.id] - d.default) > 1e-9) out[d.id] = round4(values[d.id]);
  return out;
}

/** `poses` plus pose `name` holding `values` (rounded); null when the name is not usable or `values` is empty. */
export function savePose(poses: Record<string, PoseDef>, name: string, values: Record<string, number>): Record<string, PoseDef> | null {
  if (!/^[A-Za-z_]\w*$/.test(name) || !Object.keys(values).length) return null;
  return { ...poses, [name]: Object.fromEntries(Object.entries(values).map(([id, v]) => [id, round4(v)])) };
}

/** `poses` without `name`. */
export const deletePose = (poses: Record<string, PoseDef>, name: string): Record<string, PoseDef> =>
  Object.fromEntries(Object.entries(poses).filter(([n]) => n !== name));
