// The rig.json `physics` section: chains by id, each reading parameters or bone channels and writing parameters or a part
// or bone's rotation. This file turns that into physics.ts chains, steps them for
// one character and checks the section; the simulation itself is physics.ts. Pure, no DOM.
//
//   "physics": { "hair": {
//     "inputs":   [{ "param": "angle_x", "weight": 1, "smoothing": 0.3 }, { "bone": "head", "channel": "rot", "weight": 0.5 }],
//     "segments": [{ "length": 1, "mass": 1, "damping": 3, "stiffness": 90, "limit": 25 }],
//     "outputs":  [{ "param": "hair_sway", "scale": 1, "min": -40, "max": 40 }, { "part": "hair_back", "scale": 1 }],
//     "wind":     { "strength": 6, "noise": 0.8 } } }

import { restState, stepChain, type PhysicsChain, type PhysicsSegment, type PhysicsState, type PhysicsWind, type WorldWind } from './physics.js';
import type { Offset } from './anim.js';
import type { KeyformDef, ParamDef } from './params.js';
import { isNum } from './util.js';
import type { ProblemReport } from './suggest.js';

export const PHYSICS_CHANNELS = ['dx', 'dy', 'sx', 'sy', 'rot'] as const;
export type PhysicsChannel = typeof PHYSICS_CHANNELS[number];

export interface RigPhysicsInput { param?: string; bone?: string; channel?: PhysicsChannel; weight: number; smoothing?: number }
export interface RigPhysicsOutput { param?: string; part?: string; scale: number; segment?: number; min?: number; max?: number }
export interface RigPhysicsChain { inputs: RigPhysicsInput[]; segments: PhysicsSegment[]; outputs: RigPhysicsOutput[]; wind?: PhysicsWind; windScale?: number }

const inKey = (i: RigPhysicsInput) => i.param !== undefined ? `p:${i.param}` : `b:${i.bone}.${i.channel ?? 'rot'}`;
const outKey = (o: RigPhysicsOutput) => o.param !== undefined ? `p:${o.param}` : `r:${o.part}`;

/** The simulation's view of a rig chain: inputs and outputs named by where they read and write. */
export function toChain(c: RigPhysicsChain): PhysicsChain {
  return {
    inputs: c.inputs.map(i => ({ name: inKey(i), weight: i.weight, smoothing: i.smoothing })),
    segments: c.segments,
    outputs: c.outputs.map(o => ({ name: outKey(o), segment: o.segment, scale: o.scale, min: o.min, max: o.max })),
    wind: c.wind,
    windScale: c.windScale,
  };
}

/** The state of each chain of a character, by chain id. */
export type ChainStates = Record<string, PhysicsState>;

export function restStates(physics: Record<string, RigPhysicsChain> | undefined): ChainStates {
  const out: ChainStates = {};
  for (const [id, c] of Object.entries(physics ?? {})) out[id] = restState(toChain(c));
  return out;
}

export interface PhysicsResult {
  states: ChainStates;
  /** Added to the parameters (then clamped to their range). */
  params: Record<string, number>;
  /** Rotation (degrees) added to a part or bone. */
  rot: Record<string, number>;
}

/** What `off` names: every chain, or the listed ones. */
export type PhysicsOff = boolean | string[] | undefined;
export const isOff = (off: PhysicsOff, id: string): boolean => off === true || (Array.isArray(off) && off.includes(id));

/**
 * Step every chain by `dt`. `params` are the parameter values and `parts` the offsets of the parts and bones, both
 * before physics. A chain that is `off` is held at rest and writes nothing. `world` is the scene's wind.
 */
export function stepPhysics(physics: Record<string, RigPhysicsChain>, states: ChainStates, params: Record<string, number>, parts: ReadonlyMap<string, Offset>, dt: number, off?: PhysicsOff, world?: WorldWind | null): PhysicsResult {
  const next: ChainStates = {}, outParams: Record<string, number> = {}, outRot: Record<string, number> = {};
  for (const [id, rc] of Object.entries(physics)) {
    const chain = toChain(rc);
    if (isOff(off, id)) { next[id] = restState(chain); continue; }
    const inputs: Record<string, number> = {};
    for (const i of rc.inputs) inputs[inKey(i)] = i.param !== undefined ? params[i.param] ?? 0 : parts.get(i.bone ?? '')?.[i.channel ?? 'rot'] ?? 0;
    const s = stepChain(chain, states[id] ?? restState(chain), inputs, dt, world);
    next[id] = s;
    rc.outputs.forEach((o, k) => {
      const v = s.outputs[k] ?? 0;
      if (o.param !== undefined) outParams[o.param] = (outParams[o.param] ?? 0) + v;
      else if (o.part !== undefined) outRot[o.part] = (outRot[o.part] ?? 0) + v;
    });
  }
  return { states: next, params: outParams, rot: outRot };
}

/** Parameters with the physics outputs added, each kept inside its range. */
export function addPhysicsParams(defs: ParamDef[] | undefined, params: Record<string, number>, add: Record<string, number>): Record<string, number> {
  const out = { ...params };
  for (const d of defs ?? []) if (add[d.id]) out[d.id] = Math.min(d.max, Math.max(d.min, (out[d.id] ?? d.default) + add[d.id]));
  return out;
}

// ---- checks ----


/** Parameters a keyform reads. */
const formParams = (k: KeyformDef): string[] => [...(k.param ? [k.param] : []), ...(Array.isArray(k.params) ? k.params : [])];

/**
 * Problems in the `physics` section: unknown ids, ranges, and an output that feeds an input of the same chain or,
 * through other chains, of itself. `targets` are the part and bone names.
 */
export function checkPhysics(
  data: { physics?: unknown; parameters?: ParamDef[]; keyforms?: KeyformDef[] },
  targets: Set<string>, problem: ProblemReport,
): void {
  if (data.physics === undefined) return;
  if (!data.physics || typeof data.physics !== 'object' || Array.isArray(data.physics)) { problem('physics: needs an object of chain id: { inputs, segments, outputs }', 'physics'); return; }
  const params = new Map((Array.isArray(data.parameters) ? data.parameters : []).map(p => [p.id, p]));
  const known = () => [...params.keys()].join(', ') || 'none';
  const chains = data.physics as Record<string, RigPhysicsChain>;
  const reads = new Map<string, Set<string>>(); // chain -> what it reads: 'p:id' or 'b:name'
  const writes = new Map<string, Set<string>>(); // chain -> 'p:id' or 'r:name'
  for (const [id, c] of Object.entries(chains)) {
    const at = `physics.${id}`;
    if (!/^[A-Za-z_]\w*$/.test(id)) problem(`physics: "${id}" is not a usable chain id (letters, digits and _)`, id);
    if (!c || typeof c !== 'object') { problem(`${at}: needs an object with inputs, segments and outputs`, id); continue; }
    const r = new Set<string>(), w = new Set<string>();
    reads.set(id, r); writes.set(id, w);
    if (!Array.isArray(c.inputs) || !c.inputs.length) problem(`${at}.inputs: needs at least one input { param } or { bone, channel }`, id);
    else c.inputs.forEach((i, n) => {
      const where = `${at}.inputs[${n}]`;
      if (!i || typeof i !== 'object') { problem(`${where}: not an input`, id); return; }
      if ((i.param === undefined) === (i.bone === undefined)) problem(`${where}: name either a param or a bone (with a channel)`, id);
      else if (i.param !== undefined) {
        if (!params.has(i.param)) problem(`${where}: no parameter "${i.param}" (parameters: ${known()})`, id, i.param, params.keys()); else r.add(`p:${i.param}`);
        if (i.channel !== undefined) problem(`${where}: channel belongs to a bone input`, id);
      } else {
        if (!targets.has(i.bone!)) problem(`${where}: no part or bone named "${i.bone}"`, id, i.bone!, targets); else r.add(`b:${i.bone}`);
        if (i.channel !== undefined && !(PHYSICS_CHANNELS as readonly string[]).includes(i.channel)) problem(`${where}: unknown channel "${String(i.channel)}" (${PHYSICS_CHANNELS.join(', ')})`, id, String(i.channel), PHYSICS_CHANNELS);
      }
      if (!isNum(i.weight)) problem(`${where}.weight: must be a number`, id);
      if (i.smoothing !== undefined && !(isNum(i.smoothing) && i.smoothing >= 0 && i.smoothing < 1)) problem(`${where}.smoothing: must be from 0 up to (not including) 1`, id);
    });
    if (!Array.isArray(c.segments) || !c.segments.length) problem(`${at}.segments: needs at least one segment`, id);
    else c.segments.forEach((s, n) => {
      const where = `${at}.segments[${n}]`;
      if (!s || typeof s !== 'object') { problem(`${where}: not a segment`, id); return; }
      for (const f of ['length', 'mass'] as const) if (!(isNum(s[f]) && s[f] > 0)) problem(`${where}.${f}: must be more than 0`, id);
      for (const f of ['damping', 'stiffness', 'limit'] as const) if (!(isNum(s[f]) && s[f] >= 0)) problem(`${where}.${f}: must be 0 or more`, id);
    });
    if (!Array.isArray(c.outputs) || !c.outputs.length) problem(`${at}.outputs: needs at least one output { param } or { part }`, id);
    else c.outputs.forEach((o, n) => {
      const where = `${at}.outputs[${n}]`;
      if (!o || typeof o !== 'object') { problem(`${where}: not an output`, id); return; }
      if ((o.param === undefined) === (o.part === undefined)) problem(`${where}: name either a param or a part (its rotation)`, id);
      else if (o.param !== undefined) { if (!params.has(o.param)) problem(`${where}: no parameter "${o.param}" (parameters: ${known()})`, id, o.param, params.keys()); else w.add(`p:${o.param}`); }
      else if (!targets.has(o.part!)) problem(`${where}: no part or bone named "${o.part}"`, id, o.part!, targets);
      else w.add(`r:${o.part}`);
      if (!isNum(o.scale)) problem(`${where}.scale: must be a number`, id);
      if (o.min !== undefined && !isNum(o.min)) problem(`${where}.min: must be a number`, id);
      if (o.max !== undefined && !isNum(o.max)) problem(`${where}.max: must be a number`, id);
      if (isNum(o.min) && isNum(o.max) && o.min > o.max) problem(`${where}: min is above max`, id);
      if (o.segment !== undefined && !(Number.isInteger(o.segment) && o.segment >= 0 && o.segment < (c.segments?.length ?? 0))) problem(`${where}.segment: no segment ${String(o.segment)}`, id);
    });
    if (c.wind !== undefined && (!c.wind || typeof c.wind !== 'object' || !isNum(c.wind.strength))) problem(`${at}.wind: needs a numeric strength`, id);
    if (c.windScale !== undefined && !isNum(c.windScale)) problem(`${at}.windScale: must be a number (1 = the scene's wind, 0 = none, negative = mirrored)`, id);
  }
  // A cycle: chain A writes something chain B reads. A parameter read counts as read by a bone input too when
  // keyforms of that bone depend on it.
  const viaForms = (bone: string): string[] => (data.keyforms ?? []).filter(k => k.target === bone).flatMap(k => formParams(k).map(p => `p:${p}`));
  const feeds = (from: string, to: string): boolean => {
    const w = writes.get(from) ?? new Set<string>();
    for (const x of reads.get(to) ?? []) {
      if (x.startsWith('p:') ? w.has(x) : w.has(`r:${x.slice(2)}`) || viaForms(x.slice(2)).some(p => w.has(p))) return true;
    }
    return false;
  };
  const ids = [...reads.keys()], seen = new Set<string>();
  const visit = (id: string, path: string[]): boolean => {
    if (path.includes(id)) { problem(`physics: chains feed each other in a cycle (${[...path.slice(path.indexOf(id)), id].join(' > ')})`, id); return true; }
    if (seen.has(id)) return false;
    for (const to of ids) if (feeds(id, to) && visit(to, [...path, id])) { seen.add(id); return true; }
    seen.add(id);
    return false;
  };
  for (const id of ids) if (visit(id, [])) break;
}

// ---- editing (the studio's Physics tab) ----

/** The three lists of a chain the studio edits as rows. */
export type ChainList = 'inputs' | 'segments' | 'outputs';

/** A segment that swings like a hair strand: the presets' usual numbers. */
export const DEFAULT_SEGMENT: PhysicsSegment = { length: 1, mass: 1, damping: 3, stiffness: 90, limit: 25 };

/**
 * `chain` with row `index` of `list` changed by `patch`; a field set to undefined is removed. An input or output that
 * switches between a parameter and a bone or part drops the other kind's fields (an input's channel goes with its bone).
 */
export function setChainRow(chain: RigPhysicsChain, list: ChainList, index: number, patch: Record<string, unknown>): RigPhysicsChain {
  const rows = [...(chain[list] ?? [])] as unknown as Record<string, unknown>[];
  if (!rows[index]) return chain;
  const row: Record<string, unknown> = { ...rows[index], ...patch };
  if (list === 'inputs') {
    if (patch.param !== undefined) { delete row.bone; delete row.channel; }
    if (patch.bone !== undefined) { delete row.param; row.channel ??= 'rot'; }
  }
  if (list === 'outputs') {
    if (patch.param !== undefined) delete row.part;
    if (patch.part !== undefined) delete row.param;
  }
  for (const [k, v] of Object.entries(row)) if (v === undefined) delete row[k];
  rows[index] = row;
  return { ...chain, [list]: rows };
}

/**
 * `chain` with a row added to `list`: an input reading `param` (or copying the last input), a segment like the last one
 * (or the default), an output writing `param` (or copying the last output).
 */
export function addChainRow(chain: RigPhysicsChain, list: ChainList, param?: string): RigPhysicsChain {
  const rows = chain[list] ?? [], last = rows[rows.length - 1];
  let row: unknown;
  if (list === 'segments') row = { ...(last as PhysicsSegment ?? DEFAULT_SEGMENT) };
  else if (list === 'inputs') row = last ? { ...(last as RigPhysicsInput) } : { param: param ?? '', weight: 1 };
  else row = last ? { ...(last as RigPhysicsOutput) } : { param: param ?? '', scale: 1 };
  return { ...chain, [list]: [...rows, row] };
}

/** `chain` without row `index` of `list`. Outputs keep reading the same segment; one that read the removed segment reads the last. */
export function removeChainRow(chain: RigPhysicsChain, list: ChainList, index: number): RigPhysicsChain {
  const rows = (chain[list] ?? []).filter((_, i) => i !== index) as RigPhysicsChain[ChainList];
  const next = { ...chain, [list]: rows } as RigPhysicsChain;
  if (list === 'segments') {
    next.outputs = (chain.outputs ?? []).map(o => {
      if (o.segment === undefined || o.segment < index) return o;
      const { segment, ...rest } = o;
      return segment > index ? { ...rest, segment: segment - 1 } : rest; // the removed one: read the last
    });
  }
  return next;
}

/** `chain` with its own wind set, changed (merged) or removed (null). */
export function setChainWind(chain: RigPhysicsChain, wind: Partial<PhysicsWind> | null): RigPhysicsChain {
  const { wind: old, ...rest } = chain;
  if (wind === null) return rest;
  const next: Record<string, unknown> = { strength: 6, noise: 0.8, ...old, ...wind };
  for (const [k, v] of Object.entries(next)) if (v === undefined) delete next[k];
  return { ...rest, wind: next as unknown as PhysicsWind };
}

/** Where a `checkPhysics` message points inside its chain: a row of a list, or the chain as a whole (null). */
export function problemRow(message: string): { list: ChainList; index: number } | null {
  const m = /^physics\.[A-Za-z_]\w*\.(inputs|segments|outputs)\[(\d+)\]/.exec(message);
  return m ? { list: m[1] as ChainList, index: Number(m[2]) } : null;
}
