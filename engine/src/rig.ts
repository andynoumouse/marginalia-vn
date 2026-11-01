// Hand-written additions to a layered character (assets/char/<name>/rig.json), applied on top of the PSD
// converter's sprite.json:
//  - order:  part names (a slot, or a plain part's file name without extension), bottom to top. Listed parts are
//            re-stacked among the positions they already occupy; parts not listed stay where the PSD had them.
//  - groups: one name that sets several slots at once (`outfit=school` sets outfit_back and outfit_front).
//  - poses:  named shorthands for a pose plus slot overrides (`show alice shy`).
//  - animations: keyframe animations for `animate alice <name>` (see anim.ts).
//  - idle, speak, blink: what the character does by itself (see idle.ts): a looping animation while it is on stage, a
//    mouth and/or animation while its lines type, and blinking through a slot.
// project-data.mjs attaches the file to the manifest as `rig`, so renderer, preloads and checks all see it.

import { ANIM_NAMES, EASE_NAMES, KEY_CHANNELS, resolveAnim, type AnimDef } from './anim.js';
import type { RigManifest, RigPart } from './assets.js';

export interface RigData {
  order?: string[];
  groups?: Record<string, string[]>;
  /** `pose` is the base pose; every other key is a slot or group name with its variant. */
  poses?: Record<string, Record<string, string>>;
  /** Keyframe animations by name, played with `animate <char> <name>`; one named like a preset replaces it for this character. */
  animations?: Record<string, AnimDef>;
  /** Where a part turns and scales from, in PSD canvas pixels `[x, y]` from the top left; the middle of the part's image when left out. */
  pivots?: Record<string, [number, number]>;
  /** An animation (preset or one of `animations`) that loops while the character is on stage. */
  idle?: string;
  /** While one of the character's lines types: cycle a slot through `variants` (`rate` changes a second) and/or loop `anim`. */
  speak?: { anim?: string; slot?: string; variants?: string[]; rate?: number };
  /** Blink by swapping `variant` into `slot` for `dur` seconds every `every` ([min, max]) seconds; `true` takes the defaults. */
  blink?: boolean | { slot?: string; variant?: string; every?: [number, number]; dur?: number };
}

export interface BlinkDef { slot: string; variant: string; every: [number, number]; dur: number }
export interface SpeakDef { anim: string | null; slot: string; variants: string[]; rate: number }

/** rig.json `blink` with its defaults (the `eyes` slot's `closed` variant every 3-6 s for 0.12 s), or null when off. */
export function blinkOf(data: RigData | undefined): BlinkDef | null {
  const b = data?.blink;
  if (!b || (typeof b !== 'boolean' && typeof b !== 'object')) return null;
  const o = b === true ? {} : b;
  const every = Array.isArray(o.every) && o.every.length === 2 && o.every[0] > 0 && o.every[1] >= o.every[0] ? o.every : [3, 6];
  return { slot: o.slot || 'eyes', variant: o.variant || 'closed', every: [every[0], every[1]], dur: o.dur !== undefined && o.dur > 0 ? o.dur : 0.12 };
}

/** rig.json `speak` with its defaults (the `mouth` slot at 8 changes a second), or null when off or empty. */
export function speakOf(data: RigData | undefined): SpeakDef | null {
  const s = data?.speak;
  if (!s || typeof s !== 'object') return null;
  const variants = Array.isArray(s.variants) ? s.variants.filter(v => typeof v === 'string') : [];
  if (!s.anim && !variants.length) return null;
  return { anim: s.anim || null, slot: s.slot || 'mouth', variants, rate: s.rate !== undefined && s.rate > 0 ? s.rate : 8 };
}

/** The slot variants rig.json swaps in by itself (blinking, talking), as `slot=variant` overrides. */
export function liveOverrides(data: RigData | undefined): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  const blink = blinkOf(data), speak = speakOf(data);
  if (blink) out.push({ [blink.slot]: blink.variant });
  if (speak) for (const v of speak.variants) out.push({ [speak.slot]: v });
  return out;
}

export const partName = (p: RigPart): string => p.slot ?? (p.file ?? '').replace(/^.*\//, '').replace(/\.[^.]+$/, '');

const slotsOf = (rig: RigManifest): Map<string, NonNullable<RigPart['variants']>> => {
  const slots = new Map<string, NonNullable<RigPart['variants']>>();
  for (const p of rig.parts ?? []) if (p.slot && p.variants) slots.set(p.slot, p.variants);
  return slots;
};

/** The parts with `rig.order` applied. */
export function orderedParts(rig: RigManifest): RigPart[] {
  const parts = rig.parts ?? [];
  const order = rig.rig?.order;
  if (!order?.length) return parts;
  const byName = new Map(parts.map(p => [partName(p), p]));
  const listed = [...new Set(order)].filter(n => byName.has(n));
  const next = [...listed];
  return parts.map(p => (listed.includes(partName(p)) ? byName.get(next.shift()!)! : p));
}

/**
 * A `show`'s pose and slot overrides with the rig's shorthands and groups expanded. Explicit overrides come after
 * (and so beat) what a shorthand sets. `problems` lists group members that do not fit.
 */
export function expandShow(rig: RigManifest, pose: string | null, overrides: Record<string, string>): { pose: string | null; overrides: Record<string, string>; problems: string[] } {
  const data = rig.rig;
  const problems: string[] = [];
  if (!data) return { pose, overrides, problems };
  const slots = slotsOf(rig);
  const out: Record<string, string> = {};
  const apply = (key: string, value: string) => {
    const members = data.groups?.[key];
    if (!members || slots.has(key)) { out[key] = value; return; } // a real slot wins over a group of the same name
    for (const slot of members) {
      const variants = slots.get(slot);
      if (!variants) problems.push(`group "${key}" names slot "${slot}", which this character does not have`);
      else if (value !== 'none' && !variants[value]) problems.push(`slot "${slot}" of group "${key}" has no variant "${value}"`);
      else out[slot] = value;
    }
  };
  let outPose = pose;
  const shorthand = pose ? data.poses?.[pose] : undefined;
  if (shorthand) {
    outPose = shorthand.pose ?? null;
    for (const [k, v] of Object.entries(shorthand)) if (k !== 'pose') apply(k, v);
  }
  for (const [k, v] of Object.entries(overrides)) apply(k, v);
  return { pose: outPose, overrides: out, problems };
}

/** Every variant name and alias in the PSD's slots. */
const variantNames = (rig: RigManifest): Set<string> => {
  const out = new Set<string>();
  for (const v of slotsOf(rig).values()) for (const [name, x] of Object.entries(v)) { out.add(name); for (const a of x.poses ?? []) out.add(a); }
  return out;
};

/** What `show <char> <pose>` accepts: PSD variant names and aliases, and rig.json shorthands. */
export const rigPoseNames = (rig: RigManifest): string[] => [...new Set([...Object.keys(rig.rig?.poses ?? {}), ...variantNames(rig)])].sort();

/** The parts of a layered character (slots and plain layers) that `animate ... part=` and keyframe `part`s can name. */
export const rigPartNames = (rig: RigManifest): string[] => (rig.parts ?? []).map(partName);

/** What `animate <char> <name>` accepts beyond the presets. */
export const rigAnimNames = (rig: RigManifest): string[] => Object.keys(rig.rig?.animations ?? {});

/** What `slot=variant` accepts on the left: slots and rig.json groups. */
export const rigSlotNames = (rig: RigManifest): string[] => [...new Set([...slotsOf(rig).keys(), ...Object.keys(rig.rig?.groups ?? {})])];

/** A problem in rig.json; `at` is the key it is about, so the editor can find its line. */
export interface RigProblem { message: string; at: string }

/** Problems in rig.json itself (for the editor's rig tab). */
export function checkRig(rig: RigManifest): RigProblem[] {
  const data = rig.rig;
  if (!data) return [];
  const out: RigProblem[] = [];
  const problem = (message: string, at: string) => out.push({ message, at });
  const slots = slotsOf(rig);
  const names = new Set((rig.parts ?? []).map(partName));
  const variants = variantNames(rig);
  for (const n of data.order ?? []) if (!names.has(n)) problem(`order: no part named "${n}"`, n);
  for (const [g, members] of Object.entries(data.groups ?? {})) {
    if (slots.has(g)) problem(`groups: "${g}" is also a slot name; the slot wins`, g);
    for (const s of members) if (!slots.has(s)) problem(`groups: "${g}" names slot "${s}", which does not exist`, s);
  }
  const target = (k: string) => (slots.has(k) ? [k] : data.groups?.[k]?.filter(s => slots.has(s)));
  for (const [name, def] of Object.entries(data.poses ?? {})) {
    if (variants.has(name)) problem(`poses: "${name}" is also a variant or pose name in the PSD; the shorthand wins`, name);
    for (const [k, v] of Object.entries(def)) {
      if (k === 'pose') { if (v && !variants.has(v)) problem(`poses.${name}: no layer named or aliased "${v}"`, name); continue; }
      const members = target(k);
      if (!members) { problem(`poses.${name}: no slot or group "${k}"`, k); continue; }
      for (const s of members) if (v !== 'none' && !slots.get(s)![v]) problem(`poses.${name}: slot "${s}" has no variant "${v}"`, name);
    }
  }
  for (const [part, pv] of Object.entries(data.pivots ?? {})) {
    if (!names.has(part)) problem(`pivots: no part named "${part}"`, part);
    else if (!Array.isArray(pv) || pv.length !== 2 || !pv.every(Number.isFinite)) problem(`pivots.${part}: use [x, y] in pixels of the PSD canvas`, part);
  }
  const knownAnim = (n: string) => resolveAnim(n, data.animations) !== null;
  const animList = [...ANIM_NAMES, ...Object.keys(data.animations ?? {})].join(', ');
  if (data.idle !== undefined && (typeof data.idle !== 'string' || !knownAnim(data.idle))) problem(`idle: no animation "${String(data.idle)}" (${animList})`, 'idle');
  if (data.speak !== undefined) {
    const sp = data.speak;
    if (!sp || typeof sp !== 'object') problem('speak: needs an object with anim and/or variants', 'speak');
    else {
      if (sp.anim !== undefined && !knownAnim(sp.anim)) problem(`speak.anim: no animation "${sp.anim}" (${animList})`, 'speak');
      if (sp.rate !== undefined && !(sp.rate > 0)) problem('speak.rate: must be more than 0 changes a second', 'speak');
      if (!sp.anim && !sp.variants?.length) problem('speak: needs an "anim" or a list of mouth "variants"', 'speak');
      const slot = sp.slot ?? 'mouth', have = slots.get(slot);
      if (sp.variants?.length && !have) problem(`speak: no slot "${slot}" to cycle (slots: ${[...slots.keys()].join(', ') || 'none'})`, 'speak');
      else for (const v of sp.variants ?? []) if (have && !have[v]) problem(`speak: slot "${slot}" has no variant "${v}"`, 'speak');
    }
  }
  if (data.blink !== undefined && data.blink !== false) {
    const b = blinkOf(data), raw = data.blink === true ? {} : data.blink;
    if (!b || typeof raw !== 'object') problem('blink: use true or an object (slot, variant, every, dur)', 'blink');
    else {
      const have = slots.get(b.slot);
      if (!have) problem(`blink: no slot "${b.slot}" (slots: ${[...slots.keys()].join(', ') || 'none'})`, 'blink');
      else if (!have[b.variant]) problem(`blink: slot "${b.slot}" has no variant "${b.variant}"`, 'blink');
      if (raw.every !== undefined && !(Array.isArray(raw.every) && raw.every.length === 2 && raw.every[0] > 0 && raw.every[1] >= raw.every[0])) problem('blink.every: use [min, max] seconds, 0 < min <= max', 'blink');
      if (raw.dur !== undefined && !(raw.dur > 0)) problem('blink.dur: must be more than 0 seconds', 'blink');
    }
  }
  for (const [name, def] of Object.entries(data.animations ?? {})) {
    if (!def || typeof def !== 'object' || !Array.isArray(def.keys) || def.keys.length === 0) { problem(`animations.${name}: needs a non-empty "keys" list`, name); continue; }
    if (def.dur !== undefined && !(def.dur > 0)) problem(`animations.${name}: dur must be more than 0 seconds`, name);
    def.keys.forEach((k, i) => {
      const at = `animations.${name}.keys[${i}]`;
      if (!k || typeof k !== 'object') { problem(`${at}: not a key`, name); return; }
      if (k.part !== undefined && !names.has(k.part)) problem(`${at}: no part named "${k.part}" (parts: ${[...names].join(', ') || 'none'})`, name);
      if (!(k.t >= 0 && k.t <= 1)) problem(`${at}: t must be a number from 0 to 1`, name);
      if (k.ease !== undefined && !EASE_NAMES.includes(k.ease)) problem(`${at}: unknown ease "${k.ease}" (${EASE_NAMES.join(', ')})`, name);
      const channels = KEY_CHANNELS.filter(c => k[c] !== undefined);
      for (const c of channels) if (!Number.isFinite(k[c])) problem(`${at}: ${c} must be a number`, name);
      for (const key of Object.keys(k)) if (key !== 't' && key !== 'ease' && key !== 'part' && !(KEY_CHANNELS as readonly string[]).includes(key)) problem(`${at}: unknown channel "${key}" (${KEY_CHANNELS.join(', ')})`, name);
      if (!channels.length) problem(`${at}: sets no channel (${KEY_CHANNELS.join(', ')})`, name);
    });
  }
  return out;
}

/** A starting rig.json: the current part order, and groups suggested from slots like `outfit_back` + `outfit_front`. */
export function rigSkeleton(rig: RigManifest): RigData {
  const slots = slotsOf(rig);
  const buckets = new Map<string, string[]>();
  for (const slot of slots.keys()) {
    const m = /^(.+)_([A-Za-z0-9]+)$/.exec(slot);
    if (m && !slots.has(m[1])) buckets.set(m[1], [...(buckets.get(m[1]) ?? []), slot]);
  }
  const groups: Record<string, string[]> = {};
  for (const [base, members] of buckets) {
    const key = (s: string) => Object.keys(slots.get(s)!).sort().join(',');
    if (members.length > 1 && members.every(s => key(s) === key(members[0]))) groups[base] = members;
  }
  return { order: (rig.parts ?? []).map(partName), groups, poses: {} };
}

/**
 * `existing` brought up to date with a reconverted manifest: parts that are new are added to `order` after the part
 * below them in the PSD; nothing is removed (`missing` lists names that no longer exist, for the author to fix).
 */
export function mergeRig(existing: RigData, rig: RigManifest): { rig: RigData; added: string[]; missing: string[] } {
  const names = (rig.parts ?? []).map(partName);
  const order = [...(existing.order ?? [])];
  const added: string[] = [];
  names.forEach((n, i) => {
    if (order.includes(n)) return;
    const below = names.slice(0, i).reverse().find(x => order.includes(x));
    order.splice(below ? order.indexOf(below) + 1 : 0, 0, n);
    added.push(n);
  });
  const missing = order.filter(n => !names.includes(n));
  return { rig: { ...existing, order }, added, missing };
}
