// Hand-written additions to a layered character (assets/char/<name>/rig.json), applied on top of the PSD
// converter's sprite.json:
//  - order:  part names (a slot, or a plain part's file name without extension), bottom to top. Listed parts are
//            re-stacked among the positions they already occupy; parts not listed stay where the PSD had them.
//  - bones, parts: the tree that moves parts together (see bones.ts); a key or `animate ... part=` may name a bone.
//  - parameters, pads, keyforms, poses: the parameter model (params.ts); a pose is a named snapshot of some parameters.
//  - deformers: a lattice that warps a part (params.ts); clips and mask shapes are entries of `parts` (masks.ts).
//  - looks:  named maps from slots to variants (`show alice shy casual`): dressing, expressions, whole poses.
//  - animations: keyframe animations for `animate alice <name>` (see anim.ts).
//  - an animation's `auto` (see auto-anim.ts): when it starts by itself (every so often, and/or while a condition holds);
//    `reactions`: poses the character holds while a condition is true.
// project-data.mjs attaches the file to the manifest as `rig`, so renderer, preloads and checks all see it.

import { isBezier, KEY_CHANNELS, rigEaseProblem, type AnimDef } from './anim.js';
import type { RigManifest, RigPart } from './assets.js';
import { boneCycles, type BoneDef } from './bones.js';
import { DEFAULT_REACTION_OVER, everyBounds, parseCondition, type ReactionDef } from './auto-anim.js';
import { collectVars } from './expr.js';
import { checkFrames, framesNeeded, frameTracks } from './frames.js';
import { checkDeformers, checkParams, checkPoses, type DeformerDef, type KeyformDef, type PadDef, type ParamDef, type PoseDef } from './params.js';
import { checkClipGroups, checkMasks, shapePartNames, type PartEntry } from './masks.js';
import { checkPhysics, type RigPhysicsChain } from './physics-rig.js';

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
  /**
   * Which bone each part sits on, and a pivot of its own for a part that must turn about another point than its bone's. A part may
   * be clipped (`clip`: a shape part or another part), and an entry with a `polygon` is a shape part with no art: see masks.ts.
   */
  parts?: Record<string, PartEntry>;
  /** The Parameters panel's categories, in order: a parameter or pad names one in its `group`. A UI grouping only. */
  categories?: string[];
  /** Named scalars (id, min, max, default, group) that drive keyforms; see params.ts. */
  parameters?: ParamDef[];
  /** 2D controls over two parameters: a UI grouping only. */
  pads?: PadDef[];
  /** Named snapshots of some parameters (`happy: { mouth_smile: 1 }`), set with `show <char> pose=happy` or tweened with `animate`; they layer. */
  poses?: Record<string, PoseDef>;
  /** Authored poses of a bone or part at chosen parameter values, blended; see params.ts. */
  keyforms?: KeyformDef[];
  /** Lattices that warp a part's mesh, driven by parameters; see params.ts and docs/design/mesh-warp.md. */
  deformers?: DeformerDef[];
  /** Secondary motion: chains by id, reading parameters or bone channels and writing parameters or a part's rotation; see physics-rig.ts. */
  physics?: Record<string, RigPhysicsChain>;
  /** Poses held while a condition is true, first match wins: `{ when, pose, over, ease }`; see auto-anim.ts. */
  reactions?: ReactionDef[];
}

/** The slot variants rig.json swaps in by itself (the frame tracks of its animations), as `slot=variant` overrides. */
export function liveOverrides(data: RigData | undefined): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  for (const def of Object.values(data?.animations ?? {})) for (const [slot, names] of Object.entries(framesNeeded(frameTracks(def?.frames)))) for (const v of names) out.push({ [slot]: v });
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

const AUTO_KEYS = ['every', 'while'];
const REACTION_KEYS = ['when', 'pose', 'over', 'ease'];
/** Names a condition may use besides the script's variables. */
const BUILTIN_NAMES = ['speaking', 'always'];

/** Problems in a condition text: it must parse, and name only the built-ins, `param.<id>` of a defined parameter, or (when the project's variables are known) a script variable. */
function checkCondition(src: unknown, at: string, where: string, paramIds: Set<string>, vars: readonly string[] | undefined, problem: (message: string, at: string) => void): void {
  if (typeof src !== 'string' || !src.trim()) { problem(`${where}: needs a condition (an expression such as "speaking" or "affection > 3")`, at); return; }
  const e = parseCondition(src);
  if (!e) { problem(`${where}: "${src}" is not a valid expression`, at); return; }
  for (const name of collectVars(e)) {
    if (BUILTIN_NAMES.includes(name)) continue;
    if (name.startsWith('param.')) { if (!paramIds.has(name.slice(6))) problem(`${where}: no parameter "${name.slice(6)}" (parameters: ${[...paramIds].join(', ') || 'none'})`, at); continue; }
    if (vars && !vars.includes(name)) problem(`${where}: "${name}" is no script variable (speaking, always, param.<id>, ${vars.join(', ') || 'no variables'})`, at);
  }
}

/** An animation's `auto`: `every` and/or `while`, valid. */
function checkAuto(name: string, def: AnimDef, paramIds: Set<string>, vars: readonly string[] | undefined, problem: (message: string, at: string) => void): void {
  const au = (def as { auto?: unknown }).auto, where = `animations.${name}.auto`;
  if (au === undefined) return;
  if (!au || typeof au !== 'object' || Array.isArray(au)) { problem(`${where}: needs an object with "every" and/or "while"`, name); return; }
  const a = au as Record<string, unknown>;
  for (const k of Object.keys(a)) if (!AUTO_KEYS.includes(k)) problem(`${where}.${k}: unknown (use ${AUTO_KEYS.join(', ')})`, name);
  if (a.every === undefined && a.while === undefined) problem(`${where}: give "every" (a wait in seconds, or { "min", "max" }) and/or "while" (a condition)`, name);
  if (a.every !== undefined && !everyBounds(a.every)) problem(`${where}.every: use seconds (more than 0) or { "min", "max" } with 0 < min <= max`, name);
  if (a.while !== undefined) checkCondition(a.while, name, `${where}.while`, paramIds, vars, problem);
}

/** `reactions`: an ordered list of { when, pose, over, ease }. */
function checkReactions(data: RigData, paramIds: Set<string>, vars: readonly string[] | undefined, problem: (message: string, at: string) => void): void {
  const raw = data.reactions as unknown;
  if (raw === undefined) return;
  if (!Array.isArray(raw)) { problem('reactions: needs a list of { "when", "pose", "over", "ease" }', 'reactions'); return; }
  raw.forEach((r: unknown, i) => {
    const where = `reactions[${i}]`;
    if (!r || typeof r !== 'object' || Array.isArray(r)) { problem(`${where}: not a reaction`, 'reactions'); return; }
    const x = r as Record<string, unknown>;
    for (const k of Object.keys(x)) if (!REACTION_KEYS.includes(k)) problem(`${where}.${k}: unknown (use ${REACTION_KEYS.join(', ')})`, 'reactions');
    checkCondition(x.when, 'reactions', `${where}.when`, paramIds, vars, problem);
    if (typeof x.pose !== 'string' || !Object.hasOwn(data.poses ?? {}, x.pose)) problem(`${where}.pose: no pose "${String(x.pose)}" (poses: ${Object.keys(data.poses ?? {}).join(', ') || 'none'})`, 'reactions');
    if (x.over !== undefined && !(typeof x.over === 'number' && x.over >= 0)) problem(`${where}.over: seconds, 0 or more (default ${DEFAULT_REACTION_OVER})`, 'reactions');
    const bad = x.ease !== undefined ? rigEaseProblem(x.ease) : null;
    if (bad) problem(`${where}.ease: ${bad}`, 'reactions');
  });
}

/** Problems in rig.json itself (for the editor's rig tab). */
export function checkRig(rig: RigManifest, vars?: readonly string[]): RigProblem[] {
  const data = rig.rig;
  if (!data) return [];
  const out: RigProblem[] = [];
  const problem = (message: string, at: string) => out.push({ message, at });
  const slots = slotsOf(rig);
  const names = new Set((rig.parts ?? []).map(partName));
  const variants = variantNames(rig);
  const shapes = new Set(shapePartNames(data.parts));
  for (const n of data.order ?? []) {
    if (shapes.has(n) && !names.has(n)) problem(`order: "${n}" is a shape part, which has no art to stack; leave it out`, n);
    else if (!names.has(n)) problem(`order: no part named "${n}"`, n);
  }
  const raw = data as Record<string, unknown>;
  if (raw.masks !== undefined) problem('masks was replaced by shape parts and clip links: a drawn shape is an entry of parts with a polygon (and bone or follow), and the clipped part has "clip": "<shape or part>"; see rig-json.md', 'masks');
  if (raw.groups !== undefined) problem('groups was replaced by bones and parts: give the members one bone (parts.<name>.bone) and key the bone; see rig-json.md', 'groups');
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
  checkBones(data, names, shapes, problem);
  checkParams(data, new Set([...names, ...Object.keys(data.bones ?? {})]), problem);
  checkPoses(data, problem);
  checkDeformers(data, names, new Set(Object.keys(data.bones ?? {})), new Set(Object.values(data.animations ?? {}).flatMap(a => frameTracks(a?.frames).map(f => f.slot))), problem,
    new Map(Object.entries(data.parts ?? {}).flatMap(([p, def]) => (def && typeof def.bone === 'string' ? [[p, def.bone] as [string, string]] : []))), new Set(shapePartNames(data.parts)));
  checkMasks(data, names, new Set(Object.keys(data.bones ?? {})), problem);
  checkClipGroups(data, problem);
  checkPhysics(data, new Set([...names, ...Object.keys(data.bones ?? {})]), problem);
  if (raw.autonomous !== undefined) problem('autonomous was replaced by "auto" on an animation: blinking, talking and idling are animations with "auto": { "every": ... } or { "while": ... }; see rig-json.md', 'autonomous');
  const paramIds = new Set((Array.isArray(data.parameters) ? data.parameters : []).map(p => p?.id).filter((x): x is string => typeof x === 'string'));
  checkReactions(data, paramIds, vars, problem);
  const autoFrameSlots = new Map<string, string>(); // slot -> the first automatic animation with a frame track on it
  for (const [name, def] of Object.entries(data.animations ?? {})) {
    const tracked = !!def && typeof def === 'object' && ((!!def.params && typeof def.params === 'object' && Object.keys(def.params).length > 0) || (Array.isArray(def.frames) && def.frames.length > 0));
    if (!def || typeof def !== 'object' || !Array.isArray(def.keys) || (def.keys.length === 0 && !tracked)) { problem(`animations.${name}: needs a non-empty "keys" list (or "params" or "frames" tracks)`, name); continue; }
    if (def.params && typeof def.params === 'object' && Object.keys(def.params).length) checkTracks(name, def.params as Record<string, unknown>, data.parameters, problem);
    checkFrames(name, def.frames, slots, problem);
    if (def.physicsOff !== undefined && !(def.physicsOff === true || def.physicsOff === false || (Array.isArray(def.physicsOff) && def.physicsOff.every(c => Object.hasOwn(data.physics ?? {}, c))))) problem(`animations.${name}.physicsOff: use true or a list of physics chain ids (${Object.keys(data.physics ?? {}).join(', ') || 'none'})`, name);
    if (def.dur !== undefined && !(def.dur > 0)) problem(`animations.${name}: dur must be more than 0 seconds`, name);
    checkAuto(name, def, paramIds, vars, problem);
    if (def.auto && typeof def.auto === 'object') {
      for (const tr of frameTracks(def.frames)) {
        const other = autoFrameSlots.get(tr.slot);
        if (other) problem(`animations.${name}: automatic animations "${other}" and "${name}" both have a frame track on slot "${tr.slot}" (the later one wins)`, name);
        else autoFrameSlots.set(tr.slot, name);
      }
    }
    def.keys.forEach((k, i) => {
      const at = `animations.${name}.keys[${i}]`;
      if (!k || typeof k !== 'object') { problem(`${at}: not a key`, name); return; }
      if (k.part !== undefined && !names.has(k.part) && !Object.hasOwn(data.bones ?? {}, k.part)) problem(`${at}: no part or bone named "${k.part}" (${rigPartNames(rig).join(', ') || 'no parts'})`, name);
      if (!(k.t >= 0 && k.t <= 1)) problem(`${at}: t must be a number from 0 to 1`, name);
      const bad = k.ease !== undefined ? rigEaseProblem(k.ease) : null;
      if (bad) problem(`${at}: ${bad}`, name);
      const channels = KEY_CHANNELS.filter(c => k[c] !== undefined);
      for (const c of channels) if (!Number.isFinite(k[c])) problem(`${at}: ${c} must be a number`, name);
      for (const key of Object.keys(k)) if (key !== 't' && key !== 'ease' && key !== 'part' && !(KEY_CHANNELS as readonly string[]).includes(key)) problem(`${at}: unknown channel "${key}" (${KEY_CHANNELS.join(', ')})`, name);
      if (!channels.length) problem(`${at}: sets no channel (${KEY_CHANNELS.join(', ')})`, name);
    });
  }
  return out;
}

/** The `params` tracks of animation `name`: each is a list of { t, v, ease? } for a defined parameter. */
function checkTracks(name: string, tracks: Record<string, unknown>, defs: RigData['parameters'], problem: (message: string, at: string) => void): void {
  const byId = new Map((defs ?? []).map(d => [d.id, d]));
  for (const [id, keys] of Object.entries(tracks)) {
    const at = `animations.${name}.params.${id}`, def = byId.get(id);
    if (!def) problem(`${at}: no parameter "${id}" (parameters: ${[...byId.keys()].join(', ') || 'none'})`, name);
    if (!Array.isArray(keys) || !keys.length) { problem(`${at}: needs a list of keys { t, v }`, name); continue; }
    keys.forEach((k: Record<string, unknown>, i) => {
      if (!k || typeof k !== 'object') { problem(`${at}[${i}]: not a key`, name); return; }
      if (typeof k.t !== 'number' || !(k.t >= 0 && k.t <= 1)) problem(`${at}[${i}]: t must be a number from 0 to 1`, name);
      if (typeof k.v !== 'number' || !Number.isFinite(k.v)) problem(`${at}[${i}]: v must be a number`, name);
      else if (def && (k.v < def.min || k.v > def.max)) problem(`${at}[${i}]: ${k.v} lies outside "${id}" (${def.min} to ${def.max})`, name);
      const bad = k.ease !== undefined ? rigEaseProblem(k.ease) : null;
      if (bad) problem(`${at}[${i}]: ${bad}`, name);
      if (k.bezier !== undefined && !isBezier(k.bezier)) problem(`${at}[${i}]: bezier needs [x1, y1, x2, y2], numbers, with x1 and x2 from 0 to 1`, name);
      for (const key of Object.keys(k)) if (key !== 't' && key !== 'v' && key !== 'ease' && key !== 'bezier') problem(`${at}[${i}]: unknown field "${key}" (t, v, ease, bezier)`, name);
    });
  }
}

/** The `bones` and `parts` keys of rig.json: a bone's parent and pivot, the bone each part sits on, and bones that do nothing. */
function checkBones(data: RigData, names: Set<string>, shapes: Set<string>, problem: (message: string, at: string) => void): void {
  const isPoint = (p: unknown) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
  const bones: Record<string, BoneDef> = {};
  for (const [b, def] of Object.entries(data.bones ?? {})) {
    if (!def || typeof def !== 'object' || Array.isArray(def)) { problem(`bones.${b}: needs an object with parent and/or pivot`, b); continue; }
    bones[b] = def;
  }
  for (const [b, def] of Object.entries(bones)) {
    if (def.parent !== undefined && (typeof def.parent !== 'string' || !Object.hasOwn(bones, def.parent))) problem(`bones.${b}.parent: no bone named "${String(def.parent)}" (bones: ${Object.keys(bones).join(', ')})`, b);
    if (def.pivot !== undefined && !isPoint(def.pivot)) problem(`bones.${b}.pivot: use [x, y] in pixels of the PSD canvas`, b);
    if (def.tip !== undefined && !isPoint(def.tip)) problem(`bones.${b}.tip: use [x, y] in pixels of the PSD canvas`, b);
    if (names.has(b)) problem(`bones: "${b}" is also a part name; the part wins where a script or key names it`, b);
  }
  for (const loop of boneCycles(bones)) problem(`bones: parents form a loop (${[...loop, loop[0]].join(' > ')})`, loop[0]);
  const onBone = new Map<string, number>();
  for (const [part, def] of Object.entries(data.parts ?? {})) {
    const shape = shapes.has(part) && !names.has(part);
    if (!names.has(part) && !shape) { problem(`parts.${part}: no part (slot or layer) named "${part}"`, part); continue; }
    if (!def || typeof def !== 'object' || Array.isArray(def)) { problem(`parts.${part}: needs an object with bone and/or pivot`, part); continue; }
    if (def.pivot !== undefined && !isPoint(def.pivot)) problem(`parts.${part}.pivot: use [x, y] in pixels of the PSD canvas`, part);
    if (def.bone === undefined) continue;
    if (typeof def.bone !== 'string' || !Object.hasOwn(bones, def.bone)) problem(`parts.${part}.bone: no bone named "${String(def.bone)}" (bones: ${Object.keys(bones).join(', ')})`, part);
    else if (!shape) onBone.set(def.bone, (onBone.get(def.bone) ?? 0) + 1); // a shape moves with its bone but cannot measure a pivot from it
  }
  // A bone that a skinned mesh weights moves that mesh: it has something on it (and a pivot can be measured from nothing there, but it moves art).
  for (const d of Array.isArray(data.deformers) ? data.deformers : []) {
    const m = d && typeof d === 'object' ? (d as { mesh?: { weights?: unknown; defaultBone?: unknown } }).mesh : undefined;
    if (!m || typeof m !== 'object') continue;
    const used = new Set<string>(typeof m.defaultBone === 'string' ? [m.defaultBone] : []);
    if (m.weights && typeof m.weights === 'object') for (const e of Object.values(m.weights)) if (e && typeof e === 'object') for (const b of Object.keys(e)) used.add(b);
    for (const b of used) if (Object.hasOwn(bones, b)) onBone.set(b, (onBone.get(b) ?? 0) + 1);
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
  // A shape part (an imageless entry of `parts`, see masks.ts) has no layer in the PSD: it is never added to `order` and never missing.
  const shapes = new Set(shapePartNames(existing.parts));
  const missing = order.filter(n => !names.includes(n) && !shapes.has(n));
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
