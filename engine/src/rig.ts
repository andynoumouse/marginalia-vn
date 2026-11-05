// Hand-written additions to a layered character (assets/char/<name>/rig.json), applied on top of the PSD
// converter's sprite.json:
//  - order:  part names (a slot, or a plain part's file name without extension), bottom to top. Listed parts are
//            re-stacked among the positions they already occupy; parts not listed stay where the PSD had them.
//  - bones, parts: the tree that moves parts together (see bones.ts); a key or `animate ... part=` may name a bone.
//  - looks:  named maps from slots to variants (`show alice shy casual`): dressing, expressions, whole poses.
//  - animations: keyframe animations for `animate alice <name>` (see anim.ts).
//  - idle, speak, blink: what the character does by itself (see idle.ts): a looping animation while it is on stage, a
//    mouth and/or animation while its lines type, and blinking through a slot.
// project-data.mjs attaches the file to the manifest as `rig`, so renderer, preloads and checks all see it.

import { ANIM_NAMES, EASE_NAMES, KEY_CHANNELS, resolveAnim, type AnimDef } from './anim.js';
import type { RigManifest, RigPart } from './assets.js';
import { boneCycles, type BoneDef } from './bones.js';

export interface RigData {
  order?: string[];
  /** Look name to slot variants (or `none`); the reserved key `look` names another look applied first. */
  looks?: Record<string, Record<string, string>>;
  /** Keyframe animations by name, played with `animate <char> <name>`; one named like a preset replaces it for this character. */
  animations?: Record<string, AnimDef>;
  /** Where a part turns and scales from, in PSD canvas pixels `[x, y]` from the top left; the middle of the part's image when left out. */
  pivots?: Record<string, [number, number]>;
  /** The bone tree: transform nodes with a parent and a pivot (canvas pixels), imageless ones allowed. See bones.ts. */
  bones?: Record<string, BoneDef>;
  /** Which bone each part sits on, and a pivot of its own for a part that must turn about another point than its bone's. */
  parts?: Record<string, { bone?: string; pivot?: [number, number] }>;
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

/** The bare words of a `show` (or a sprite on stage), in order. */
export const showLooks = (s: { pose: string | null; more: string[] }): string[] => (s.pose ? [s.pose, ...s.more] : []);

/** The slot variants a bare word picks on its own: every slot with a variant of that name, else one tagged with it. */
function implicitLook(rig: RigManifest, name: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const [slot, variants] of slotsOf(rig)) {
    const v = Object.hasOwn(variants, name) ? name : Object.keys(variants).find(k => variants[k].poses?.includes(name));
    if (v !== undefined) out[slot] = v;
  }
  return Object.keys(out).length ? out : null;
}

/** The slots a look names (the `look` reference expanded first), or null when the name is no look of this rig. */
function lookPicks(rig: RigManifest, name: string, problems: string[], seen: string[] = []): Record<string, string> | null {
  const def = rig.rig?.looks;
  if (!def || !Object.hasOwn(def, name) || !def[name] || typeof def[name] !== 'object') return implicitLook(rig, name);
  if (seen.includes(name)) { problems.push(`look "${name}" refers back to itself (${[...seen, name].join(' > ')})`); return {}; }
  const slots = slotsOf(rig), out: Record<string, string> = {};
  const raw = def[name];
  if (typeof raw.look === 'string') Object.assign(out, lookPicks(rig, raw.look, problems, [...seen, name]) ?? (problems.push(`look "${name}" refers to "${raw.look}", which is no look`), {}));
  for (const [slot, value] of Object.entries(raw)) {
    if (slot === 'look') continue;
    const variants = slots.get(slot);
    if (!variants) problems.push(`look "${name}" names slot "${slot}", which this character does not have`);
    else if (value !== 'none' && !variants[value]) problems.push(`slot "${slot}" of look "${name}" has no variant "${value}"`);
    else out[slot] = value;
  }
  return out;
}

/**
 * A `show`'s looks (bare words, applied left to right) and slot overrides as one map of slot overrides: the last look
 * wins per slot, and explicit overrides beat every look. `problems` lists look entries that do not fit; `unknown` the
 * words that are no look, implicit look or variant of this rig.
 */
export function expandShow(rig: RigManifest, looks: string[], overrides: Record<string, string>): { overrides: Record<string, string>; unknown: string[]; problems: string[] } {
  const problems: string[] = [], unknown: string[] = [];
  const out: Record<string, string> = {};
  if (!rig.rig && !(rig.parts ?? []).length) return { overrides, unknown, problems };
  for (const word of looks) {
    const picks = lookPicks(rig, word, problems);
    if (picks) Object.assign(out, picks);
    else unknown.push(word);
  }
  return { overrides: { ...out, ...overrides }, unknown, problems };
}

/** Every variant name and alias in the PSD's slots. */
const variantNames = (rig: RigManifest): Set<string> => {
  const out = new Set<string>();
  for (const v of slotsOf(rig).values()) for (const [name, x] of Object.entries(v)) { out.add(name); for (const a of x.poses ?? []) out.add(a); }
  return out;
};

/** What a bare word on `show <char>` accepts: rig.json looks, then PSD variant names and tags (implicit looks). */
export const rigLookNames = (rig: RigManifest): string[] => [...new Set([...Object.keys(rig.rig?.looks ?? {}), ...variantNames(rig)])].sort();

/** What `animate ... part=` and keyframe `part`s can name: the parts of a layered character (slots and plain layers), then its bones. */
export const rigPartNames = (rig: RigManifest): string[] => [...new Set([...(rig.parts ?? []).map(partName), ...Object.keys(rig.rig?.bones ?? {})])];

/** What `animate <char> <name>` accepts beyond the presets. */
export const rigAnimNames = (rig: RigManifest): string[] => Object.keys(rig.rig?.animations ?? {});

/** What `slot=variant` accepts on the left: the slots. */
export const rigSlotNames = (rig: RigManifest): string[] => [...slotsOf(rig).keys()];

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
  const raw = data as Record<string, unknown>;
  if (raw.groups !== undefined) problem('groups was replaced by bones and parts: give the members one bone (parts.<name>.bone) and key the bone; see rig-json.md', 'groups');
  if (raw.poses !== undefined) problem('poses was replaced by looks; see rig-json.md', 'poses');
  const lookNames = new Set([...Object.keys(data.looks ?? {}), ...variants]);
  if (slots.has('look') && data.looks) problem('looks: a slot named "look" cannot be set by a look; "look" is reserved for naming another look', 'look');
  for (const [name, def] of Object.entries(data.looks ?? {})) {
    if (variants.has(name)) problem(`looks: "${name}" is also a variant or pose name in the PSD; the look wins`, name);
    if (!def || typeof def !== 'object') { problem(`looks.${name}: needs an object of slot: variant`, name); continue; }
    for (const [k, v] of Object.entries(def)) {
      if (typeof v !== 'string') { problem(`looks.${name}.${k}: must be a string`, name); continue; }
      if (k === 'look') { if (!lookNames.has(v)) problem(`looks.${name}: look "${v}" is no look`, name); continue; }
      const have = slots.get(k);
      if (!have) problem(`looks.${name}: no slot "${k}"`, k);
      else if (v !== 'none' && !have[v]) problem(`looks.${name}: slot "${k}" has no variant "${v}"`, name);
    }
    const loop = [name];
    for (let cur = def.look; typeof cur === 'string' && Object.hasOwn(data.looks!, cur); cur = data.looks![cur]?.look) {
      if (cur === name) { problem(`looks.${name}: look references form a cycle (${[...loop, name].join(' > ')})`, name); break; }
      if (loop.includes(cur)) break; // a cycle that does not include this look: reported at its own entry
      loop.push(cur);
    }
  }
  for (const [part, pv] of Object.entries(data.pivots ?? {})) {
    if (!names.has(part)) problem(`pivots: no part named "${part}"${Object.hasOwn(data.bones ?? {}, part) ? ' (a bone takes its pivot in bones)' : ''}`, part);
    else if (!Array.isArray(pv) || pv.length !== 2 || !pv.every(Number.isFinite)) problem(`pivots.${part}: use [x, y] in pixels of the PSD canvas`, part);
  }
  checkBones(data, names, problem);
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
      if (k.part !== undefined && !names.has(k.part) && !Object.hasOwn(data.bones ?? {}, k.part)) problem(`${at}: no part or bone named "${k.part}" (${rigPartNames(rig).join(', ') || 'no parts'})`, name);
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

/** The `bones` and `parts` keys of rig.json: a bone's parent and pivot, the bone each part sits on, and bones that do nothing. */
function checkBones(data: RigData, names: Set<string>, problem: (message: string, at: string) => void): void {
  const isPoint = (p: unknown) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
  const bones: Record<string, BoneDef> = {};
  for (const [b, def] of Object.entries(data.bones ?? {})) {
    if (!def || typeof def !== 'object' || Array.isArray(def)) { problem(`bones.${b}: needs an object with parent and/or pivot`, b); continue; }
    bones[b] = def;
  }
  for (const [b, def] of Object.entries(bones)) {
    if (def.parent !== undefined && (typeof def.parent !== 'string' || !Object.hasOwn(bones, def.parent))) problem(`bones.${b}.parent: no bone named "${String(def.parent)}" (bones: ${Object.keys(bones).join(', ')})`, b);
    if (def.pivot !== undefined && !isPoint(def.pivot)) problem(`bones.${b}.pivot: use [x, y] in pixels of the PSD canvas`, b);
    if (names.has(b)) problem(`bones: "${b}" is also a part name; the part wins where a script or key names it`, b);
  }
  for (const loop of boneCycles(bones)) problem(`bones: parents form a loop (${[...loop, loop[0]].join(' > ')})`, loop[0]);
  const onBone = new Map<string, number>();
  for (const [part, def] of Object.entries(data.parts ?? {})) {
    if (!names.has(part)) { problem(`parts.${part}: no part (slot or layer) named "${part}"`, part); continue; }
    if (!def || typeof def !== 'object' || Array.isArray(def)) { problem(`parts.${part}: needs an object with bone and/or pivot`, part); continue; }
    if (def.pivot !== undefined && !isPoint(def.pivot)) problem(`parts.${part}.pivot: use [x, y] in pixels of the PSD canvas`, part);
    if (def.bone === undefined) continue;
    if (typeof def.bone !== 'string' || !Object.hasOwn(bones, def.bone)) problem(`parts.${part}.bone: no bone named "${String(def.bone)}" (bones: ${Object.keys(bones).join(', ')})`, part);
    else onBone.set(def.bone, (onBone.get(def.bone) ?? 0) + 1);
  }
  // Warnings: a bone that moves nothing, or has nothing to turn about.
  const looped = new Set(boneCycles(bones).flat());
  const parentOf = (b: string) => (typeof bones[b].parent === 'string' && Object.hasOwn(bones, bones[b].parent!) && !looped.has(b) ? bones[b].parent! : null);
  const children = (b: string) => Object.keys(bones).filter(c => parentOf(c) === b);
  const measured = (b: string, seen = new Set<string>()): boolean => !seen.has(b) && (seen.add(b), (onBone.get(b) ?? 0) > 0 || children(b).some(c => measured(c, seen)));
  for (const b of Object.keys(bones)) {
    let cur: string | null = b, pivoted = false;
    for (let i = 0; cur !== null && i <= Object.keys(bones).length; i++) { if (isPoint(bones[cur].pivot)) { pivoted = true; break; } cur = parentOf(cur); }
    if (!measured(b) && !children(b).length) problem(`bones: "${b}" has no parts and no children, so it moves nothing`, b);
    else if (!pivoted && !measured(b)) problem(`bones: "${b}" has no pivot (and neither has anything above it) and no parts to measure one from, so it has nothing to turn about`, b);
  }
}

/**
 * The bones the PSD's `+folders` suggest: one per distinct folder path (parents first), named after the last folder
 * (the whole path joined with `_` when that name is taken by another path), parented along the path, and each folder's
 * parts on it. Pivots are left out: the studio's Rig mode is where they get placed.
 */
export function folderBones(rig: RigManifest): { bones: Record<string, BoneDef>; parts: Record<string, { bone: string }> } {
  const names = new Map<string, string>(); // folder path -> bone name
  const bones: Record<string, BoneDef> = {}, parts: Record<string, { bone: string }> = {};
  const boneFor = (path: string): string => {
    const known = names.get(path);
    if (known) return known;
    const segs = path.split('/'), last = segs[segs.length - 1];
    const taken = new Set(names.values());
    let name = taken.has(last) ? segs.join('_') : last;
    for (let i = 2; taken.has(name); i++) name = `${segs.join('_')}_${i}`;
    names.set(path, name);
    const parent = segs.length > 1 ? boneFor(segs.slice(0, -1).join('/')) : undefined;
    bones[name] = parent ? { parent } : {};
    return name;
  };
  for (const p of rig.parts ?? []) if (p.group) parts[partName(p)] = { bone: boneFor(p.group) };
  return { bones, parts };
}

/** A starting rig.json: the current part order, and bones from the PSD's folders. */
export function rigSkeleton(rig: RigManifest): RigData {
  const { bones, parts } = folderBones(rig);
  return { order: (rig.parts ?? []).map(partName), ...(Object.keys(bones).length ? { bones, parts } : {}), looks: {} };
}

/**
 * `existing` brought up to date with a reconverted manifest: parts that are new are added to `order` after the part
 * below them in the PSD, and new folders add bones (and new parts their `parts` entry); nothing is removed or changed
 * (`missing` lists names that no longer exist, for the author to fix).
 */
export function mergeRig(existing: RigData, rig: RigManifest): { rig: RigData; added: string[]; missing: string[]; bonesAdded: string[] } {
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
  const fromArt = folderBones(rig), bones = { ...existing.bones }, parts = { ...existing.parts }, bonesAdded: string[] = [];
  // Only for the new parts: a bone that would hold nothing is not added, and nothing the author already has is touched.
  const needed = new Set<string>();
  for (const p of added) for (let b: string | undefined = fromArt.parts[p]?.bone; b !== undefined && !needed.has(b); b = fromArt.bones[b]?.parent) needed.add(b);
  for (const [b, def] of Object.entries(fromArt.bones)) if (needed.has(b) && !Object.hasOwn(bones, b)) { bones[b] = def; bonesAdded.push(b); }
  for (const p of added) if (fromArt.parts[p] && !Object.hasOwn(parts, p)) parts[p] = fromArt.parts[p];
  const out: RigData = { ...existing, order };
  if (Object.keys(bones).length) out.bones = bones;
  if (Object.keys(parts).length) out.parts = parts;
  return { rig: out, added, missing, bonesAdded };
}
