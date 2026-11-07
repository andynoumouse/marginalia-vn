// Pure edits of a character's keyframe animations (rig.json `animations`) for the editor's animation dialog.
// Every function returns new objects and leaves its input alone; keys stay sorted by `t`.

import { ANCHORS, anchorToken, type Anchor, type Anchors } from './anchor.js';
import { BUILTIN_POSITIONS, type Positions } from './positions.js';
import { boneCycles, type BoneDef } from './bones.js';
import { ANIMS, KEY_CHANNELS, keyframeFn, keyframeParts, type AnimDef, type KeyChannel, type KeyDef, type Offset } from './anim.js';
import { clamp01 } from './util.js';

export type Anims = Record<string, AnimDef>;

const round4 = (n: number) => Math.round(n * 10000) / 10000;
const sortKeys = (keys: KeyDef[]) => [...keys].sort((a, b) => a.t - b.t);

/** The `Offset` field a key channel drives. */
const OFFSET_FIELD: Record<KeyChannel, keyof Offset> = { x: 'dx', y: 'dy', scale: 'sy', rot: 'rot' };

/** The parts that animation `def` has keys for, in order of first appearance. */
export function animParts(def: AnimDef): string[] {
  return [...new Set((def.keys ?? []).flatMap(k => (typeof k.part === 'string' ? [k.part] : [])))];
}

/** `steps + 1` values of one channel of `def` at evenly spaced progress 0-1, for the body or for the part `part`. */
export function sampleChannel(def: AnimDef, ch: KeyChannel, part: string | null, steps = 60): number[] {
  const body = keyframeFn(def), parts = keyframeParts(def);
  const out: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const o = part === null ? body(i / steps) : parts?.(i / steps)[part];
    out.push(o?.[OFFSET_FIELD[ch]] ?? 0);
  }
  return out;
}

/** Keys of `def` as a pair of (index, key) for the body (`part` null) or one part. */
export function keysOf(def: AnimDef, part: string | null): { index: number; key: KeyDef }[] {
  return (def.keys ?? []).flatMap((key, index) => ((key.part ?? null) === part ? [{ index, key }] : []));
}

/** `def` with a key added. A key at the same `t` (within 0.0005) for the same target gets the channels merged in. Returns the index it ended up at. */
export function addKey(def: AnimDef, key: KeyDef): { def: AnimDef; index: number } {
  const add = { ...key, t: round4(clamp01(key.t)) };
  const keys = [...(def.keys ?? [])];
  const same = keys.findIndex(k => (k.part ?? null) === (add.part ?? null) && Math.abs(k.t - add.t) < 0.0005);
  if (same >= 0) keys[same] = { ...keys[same], ...add, t: keys[same].t };
  else keys.push(add);
  const sorted = sortKeys(keys);
  return { def: { ...def, keys: sorted }, index: sorted.indexOf(same >= 0 ? keys[same] : add) };
}

/** `def` with key `index` changed by `patch` (an undefined channel in the patch removes it). Returns the key's new index, as a change of `t` may reorder. */
export function setKey(def: AnimDef, index: number, patch: Partial<KeyDef>): { def: AnimDef; index: number } {
  const keys = [...(def.keys ?? [])];
  if (!keys[index]) return { def, index };
  const next: KeyDef = { ...keys[index], ...patch };
  for (const [k, v] of Object.entries(next)) if (v === undefined) delete (next as Record<string, unknown>)[k];
  if (patch.t !== undefined) next.t = round4(clamp01(patch.t));
  for (const ch of KEY_CHANNELS) if (next[ch] !== undefined) next[ch] = round4(next[ch]!);
  keys[index] = next;
  const sorted = sortKeys(keys);
  return { def: { ...def, keys: sorted }, index: sorted.indexOf(next) };
}

/** `def` without key `index`. */
export function deleteKey(def: AnimDef, index: number): AnimDef {
  return { ...def, keys: (def.keys ?? []).filter((_, i) => i !== index) };
}

/** `def` with a new default length (seconds); anything not above 0 removes it (1 second applies). */
export function setDur(def: AnimDef, dur: number): AnimDef {
  const { dur: _old, ...rest } = def;
  return Number.isFinite(dur) && dur > 0 ? { dur: round4(dur), ...rest } : rest as AnimDef;
}

/** A name from `base` that `anims` does not have yet: `base`, `base2`, `base3`... */
export function uniqueName(anims: Anims, base: string): string {
  if (!Object.hasOwn(anims, base)) return base;
  let n = 2;
  while (Object.hasOwn(anims, `${base}${n}`)) n++;
  return `${base}${n}`;
}

/** `anims` plus an empty animation; returns the name it got. */
export function newAnim(anims: Anims, name = 'anim'): { anims: Anims; name: string } {
  const got = uniqueName(anims, name.trim() || 'anim');
  return { anims: { ...anims, [got]: { dur: 1, keys: [] } }, name: got };
}

/** `anims` plus a copy of `name`; returns the copy's name. */
export function duplicateAnim(anims: Anims, name: string): { anims: Anims; name: string } | null {
  if (!Object.hasOwn(anims, name)) return null;
  const got = uniqueName(anims, `${name}-copy`);
  return { anims: { ...anims, [got]: structuredClone(anims[name]) }, name: got };
}

/** `anims` with `from` called `to`, keeping the order; null when `to` is empty or taken, or `from` is missing. */
export function renameAnim(anims: Anims, from: string, to: string): Anims | null {
  to = to.trim();
  if (!to || !Object.hasOwn(anims, from) || (to !== from && Object.hasOwn(anims, to))) return null;
  return Object.fromEntries(Object.entries(anims).map(([k, v]) => [k === from ? to : k, v]));
}

/** `anims` without `name`. */
export function deleteAnim(anims: Anims, name: string): Anims {
  return Object.fromEntries(Object.entries(anims).filter(([k]) => k !== name));
}

/** A preset turned into editable keys: its motion sampled `steps` times with linear easing. Null for an unknown name. */
export function bakePreset(name: string, steps = 16): AnimDef | null {
  if (!Object.hasOwn(ANIMS, name)) return null;
  const preset = ANIMS[name];
  const samples = Array.from({ length: steps + 1 }, (_, i) => preset.fn(i / steps));
  const used = KEY_CHANNELS.filter(ch => samples.some(s => Math.abs(s[OFFSET_FIELD[ch]] ?? 0) > 1e-6));
  const keys: KeyDef[] = [];
  for (let i = 1; i < steps; i++) {
    const key: KeyDef = { t: round4(i / steps), ease: 'linear' };
    for (const ch of used) key[ch] = round4(samples[i][OFFSET_FIELD[ch]] ?? 0);
    keys.push(key);
  }
  return { dur: preset.dur, keys };
}

// ---- editing the text of a rig.json ----

/** A change to a text: the characters from `start` to `end` become `insert`. */
export interface TextEdit { start: number; end: number; insert: string }

/** End of the JSON string that starts at `i` (the index after its closing quote), or -1. */
function skipString(s: string, i: number): number {
  for (i++; i < s.length; i++) {
    if (s[i] === '\\') i++;
    else if (s[i] === '"') return i + 1;
  }
  return -1;
}
/** End of the JSON value that starts at `i`, or -1. */
function skipValue(s: string, i: number): number {
  if (s[i] === '"') return skipString(s, i);
  if (s[i] === '{' || s[i] === '[') {
    let depth = 0;
    for (; i < s.length; i++) {
      if (s[i] === '"') { i = skipString(s, i) - 1; if (i < 0) return -1; }
      else if (s[i] === '{' || s[i] === '[') depth++;
      else if ((s[i] === '}' || s[i] === ']') && --depth === 0) return i + 1;
    }
    return -1;
  }
  const m = /^[^\s,\]}]+/.exec(s.slice(i));
  return m ? i + m[0].length : -1;
}
const ws = (s: string, i: number) => { while (i < s.length && /\s/.test(s[i])) i++; return i; };

const isScalar = (v: unknown) => v === null || typeof v !== 'object';

/**
 * `value` as JSON in the layout rig.json is written in: two-space indent, lists of plain values and objects of plain
 * values inside lists (a key of an animation) on one line. `pad` is the indent of the line it starts on.
 */
function pretty(value: unknown, pad: string, inList = false): string {
  if (isScalar(value)) return JSON.stringify(value) ?? 'null';
  const list = Array.isArray(value);
  const items: [string, unknown][] = list ? (value as unknown[]).map(v => ['', v]) : Object.entries(value as object).filter(([, v]) => v !== undefined);
  if (!items.length) return list ? '[]' : '{}';
  const one = (k: string, v: unknown, p: string, l: boolean) => `${list ? '' : `${JSON.stringify(k)}: `}${pretty(v, p, l)}`;
  if ((list || inList) && items.every(([, v]) => isScalar(v))) {
    const body = items.map(([k, v]) => one(k, v, pad, false)).join(', ');
    return list ? `[${body}]` : `{ ${body} }`;
  }
  const inner = `${pad}  `;
  return `${list ? '[' : '{'}\n${items.map(([k, v]) => `${inner}${one(k, v, inner, list)}`).join(',\n')}\n${pad}${list ? ']' : '}'}`;
}

/**
 * The edit that sets the top-level property `key` of the JSON object `text` to `value` and leaves everything else as it
 * is (hand-written layout included). The new value is written indented by two spaces. Null when `text` is not an object.
 */
export function setTopLevelProperty(text: string, key: string, value: unknown): TextEdit | null {
  const ser = pretty(value, '  ');
  let i = ws(text, 0);
  if (text[i] !== '{') return null;
  i++;
  let lastEnd = -1;
  for (;;) {
    i = ws(text, i);
    if (text[i] === ',') { i++; continue; }
    if (text[i] === '}') break;
    if (text[i] !== '"') return null;
    const ke = skipString(text, i);
    if (ke < 0) return null;
    const name = JSON.parse(text.slice(i, ke)) as string;
    i = ws(text, ke);
    if (text[i] !== ':') return null;
    const vs = ws(text, i + 1), ve = skipValue(text, vs);
    if (ve < 0) return null;
    if (name === key) return { start: vs, end: ve, insert: ser };
    lastEnd = ve;
    i = ve;
  }
  if (lastEnd < 0) return { start: i, end: i, insert: `\n  ${JSON.stringify(key)}: ${ser}\n` };
  return { start: lastEnd, end: lastEnd, insert: `,\n  ${JSON.stringify(key)}: ${ser}` };
}

/** The edit that removes top-level property `key` (and its comma) from the JSON object `text`; null when it is not there or `text` is no object. */
export function removeTopLevelProperty(text: string, key: string): TextEdit | null {
  let i = ws(text, 0);
  if (text[i] !== '{') return null;
  i++;
  let prevEnd = -1; // end of the property before, where a comma to remove would start
  for (;;) {
    i = ws(text, i);
    if (text[i] === ',') { i++; continue; }
    if (text[i] === '}') return null;
    if (text[i] !== '"') return null;
    const ks = i, ke = skipString(text, i);
    if (ke < 0) return null;
    const name = JSON.parse(text.slice(ks, ke)) as string;
    i = ws(text, ke);
    if (text[i] !== ':') return null;
    const ve = skipValue(text, ws(text, i + 1));
    if (ve < 0) return null;
    if (name === key) {
      const after = ws(text, ve);
      if (text[after] === ',') return { start: ks, end: ws(text, after + 1), insert: '' };
      return prevEnd < 0 ? { start: ks, end: ve, insert: '' } : { start: prevEnd, end: ve, insert: '' };
    }
    prevEnd = ve;
    i = ve;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Whether two JSON values are the same (the order of an object's keys does not count). */
function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => jsonEqual(v, b[i]));
  }
  if (!isObject(a) || !isObject(b)) return false;
  const ka = Object.keys(a).filter(k => a[k] !== undefined), kb = Object.keys(b).filter(k => b[k] !== undefined);
  return ka.length === kb.length && ka.every(k => Object.hasOwn(b, k) && jsonEqual(a[k], b[k]));
}

/** The indent of the line that holds index `i` of `s`. */
function lineIndent(s: string, i: number): string {
  const start = s.lastIndexOf('\n', i - 1) + 1;
  return /^[ \t]*/.exec(s.slice(start))![0];
}

/** One property of an object as written: `lead` is the space before it (after the comma), `ks` its key, `vs`-`ve` its value. */
interface Member { key: string; lead: string; ks: number; vs: number; ve: number }

/** The properties of the JSON object that starts at `i` (a `{`), and the space before its `}`; null when it is malformed. */
function readMembers(s: string, i: number): { members: Member[]; tail: string } | null {
  const members: Member[] = [];
  let from = ++i; // where the space before the next key starts
  for (;;) {
    i = ws(s, i);
    if (s[i] === '}') return { members, tail: s.slice(from, i) };
    if (members.length) {
      if (s[i] !== ',') return null;
      from = ++i;
      i = ws(s, i);
    }
    if (s[i] !== '"') return null;
    const ks = i, ke = skipString(s, i);
    if (ke < 0) return null;
    i = ws(s, ke);
    if (s[i] !== ':') return null;
    const vs = ws(s, i + 1), ve = skipValue(s, vs);
    if (ve < 0) return null;
    members.push({ key: JSON.parse(s.slice(ks, ke)) as string, lead: s.slice(from, ks), ks, vs, ve });
    i = from = ve;
  }
}

/**
 * The text for the JSON value written in `s` from `vs` to `ve` (whose value is `was`) once it becomes `now`. A value that
 * did not change keeps its text; in an object only the properties that changed are written anew (in the layout of
 * `pretty`), the others keep theirs, and the space between them is kept too. A one-line object that would get a
 * multi-line property, or that keeps none of its properties, is written anew as a whole.
 */
function rewriteValue(s: string, vs: number, ve: number, was: unknown, now: unknown): string {
  if (jsonEqual(was, now)) return s.slice(vs, ve);
  const pad = lineIndent(s, vs);
  if (!isObject(was) || !isObject(now) || s[vs] !== '{') return pretty(now, pad);
  const read = readMembers(s, vs);
  if (!read) return pretty(now, pad);
  const old = new Map(read.members.map((m, i) => [m.key, { m, i }]));
  const keys = Object.keys(now).filter(k => now[k] !== undefined);
  if (old.size !== read.members.length || !keys.some(k => old.has(k))) return pretty(now, pad);
  const first = read.members[0].lead;
  const sep = read.members[1]?.lead ?? (first.includes('\n') ? first : ' ');
  const oneLine = !s.slice(vs, ve).includes('\n');
  let out = '{';
  for (const [j, k] of keys.entries()) {
    const had = old.get(k);
    let lead: string, body: string;
    if (had) {
      lead = j === 0 ? first : had.i === 0 ? sep : had.m.lead;
      body = s.slice(had.m.ks, had.m.vs) + rewriteValue(s, had.m.vs, had.m.ve, was[k], now[k]);
    } else {
      lead = j === 0 ? first : sep;
      body = `${JSON.stringify(k)}: ${pretty(now[k], lead.includes('\n') ? lead.slice(lead.lastIndexOf('\n') + 1) : pad)}`;
    }
    if (oneLine && body.includes('\n')) return pretty(now, pad);
    out += `${j ? ',' : ''}${lead}${body}`;
  }
  return `${out}${read.tail}}`;
}

/** A top-level property of rig.json to put in; a null value removes the property. */
export interface RigWrite { key: string; value: unknown }

/**
 * The text of rig.json `text` with the top-level properties of `writes` put in (what the animation studio's Apply does).
 * Only what changed is written anew: a property, an animation or a pivot whose value is the same keeps its text and layout
 * (a one-line `pivots` stays one line), so a diff shows just the edit. An empty object is not added to a file that lacks
 * the property. Null when `text` is not a JSON object.
 */
export function writeRigText(text: string, writes: RigWrite[]): string | null {
  let was: unknown;
  try { was = JSON.parse(text); } catch { return null; }
  if (!isObject(was)) return null;
  const now: Record<string, unknown> = { ...was };
  for (const { key, value } of writes) {
    if (value === null) delete now[key];
    else if (Object.hasOwn(now, key) || !isObject(value) || Object.keys(value).length) now[key] = value;
  }
  const vs = ws(text, 0), ve = skipValue(text, vs);
  return text.slice(0, vs) + rewriteValue(text, vs, ve, was, now) + text.slice(ve);
}

/** The one edit (between the common start and end of both) that turns `before` into `after`; null when they are the same. */
export function textChange(before: string, after: string): TextEdit | null {
  if (before === after) return null;
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  return { start, end: before.length - end, insert: after.slice(start, after.length - end) };
}

/** `pivots` with the same pivot `at` for every one of `parts` (a head made of several parts turns about one point). */
export function setPivots(pivots: Pivots, parts: string[], at: [number, number] | null): Pivots {
  return parts.reduce((p, part) => setPivot(p, part, at), pivots);
}

/** Where a character stands on the stage: `x` across (0-1), `y` from the floor (negative lifts), `scale` and mirroring. */
export interface Placement { x: number; y: number; scale: number; flip: boolean; anchor?: Anchor }

const round = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

/** The `show` line that puts `char` (in `pose`, with the slot variants in `overrides`) where `p` says: the named position when it matches, `y=` `scale=` `flip=` `anchor=` only when they differ from the default. */
export function showLine(char: string, pose: string | null, p: Placement, positions: Positions = BUILTIN_POSITIONS, anchors: Anchors = ANCHORS, overrides: Record<string, string> = {}): string {
  const x = round(p.x), y = round(p.y), scale = round(p.scale, 2);
  // A name stands for its x and its height, so it only matches when both agree.
  const named = Object.entries(positions).find(([, v]) => v.x === x && (v.y ?? 0) === y)?.[0];
  return ['show', char, pose, 'at', named ?? String(x), !named && y !== 0 && `y=${y}`, scale !== 1 && `scale=${scale}`, p.flip && 'flip=on', p.anchor && anchorToken(p.anchor, anchors) !== 'feet' && `anchor=${anchorToken(p.anchor, anchors)}`, ...Object.entries(overrides).map(([slot, variant]) => `${slot}=${variant}`)].filter(Boolean).join(' ');
}

/** `text` with `edit` done. */
export const applyEdit = (text: string, e: TextEdit) => text.slice(0, e.start) + e.insert + text.slice(e.end);

// ---- pivots: PSD pixels (from the top left of the canvas) and the stage ----

export type Pivots = Record<string, [number, number]>;
/** The size of the stage the character stands on, and the PSD canvas size of the character. */
export interface PivotFrame { stageW: number; stageH: number; width: number; height: number }

/** Where the PSD pixel (`x`, `y`) is on the stage when the character stands bottom-centre at the middle and is at rest. */
export const psdToStage = (f: PivotFrame, x: number, y: number): [number, number] => [x - f.width / 2 + f.stageW / 2, y - f.height + f.stageH];
/** The PSD pixel under the stage point (`x`, `y`), rounded: what a click on the stage sets as a pivot. */
export const stageToPsd = (f: PivotFrame, x: number, y: number): [number, number] =>
  [Math.round(x + f.width / 2 - f.stageW / 2), Math.round(y + f.height - f.stageH)];

/** `pivots` with the pivot of `part` set to `at`, or removed when `at` is null. */
export function setPivot(pivots: Pivots, part: string, at: [number, number] | null): Pivots {
  if (!at) return Object.fromEntries(Object.entries(pivots).filter(([k]) => k !== part));
  return { ...pivots, [part]: [Math.round(at[0]), Math.round(at[1])] }; // an existing part keeps its place in the list
}

// ---- bones: the working copy of rig.json `bones` and `parts` ----

export type Bones = Record<string, BoneDef>;
export type PartBones = Record<string, { bone?: string; pivot?: [number, number] }>;

export type Looks = Record<string, Record<string, string>>;

/** `looks` with `name` set to the slot `picks` (a slot with no variant shown is `none`); null when the name is empty or has no picks. */
export function saveLook(looks: Looks, name: string, picks: Record<string, string | null>): Looks | null {
  const entries = Object.entries(picks).map(([slot, v]) => [slot, v ?? 'none'] as const);
  if (!name.trim() || !entries.length) return null;
  return { ...looks, [name.trim()]: Object.fromEntries(entries) };
}

/** `base` (or `base_2`, `base_3`...) as a bone name nobody has. */
export function uniqueBoneName(bones: Bones, base = 'bone'): string {
  let name = base;
  for (let i = 2; Object.hasOwn(bones, name); i++) name = `${base}_${i}`;
  return name;
}

/** `bones` with a new bone `name` (under `parent`, else at the top); null when the name is taken or the parent is no bone. */
export function addBone(bones: Bones, name: string, parent: string | null = null): Bones | null {
  if (!name || Object.hasOwn(bones, name) || (parent !== null && !Object.hasOwn(bones, parent))) return null;
  return { ...bones, [name]: parent === null ? {} : { parent } };
}

/** `bones` with the pivot of `name` set to `at` (rounded), or removed when `at` is null. */
export function setBonePivot(bones: Bones, name: string, at: [number, number] | null): Bones {
  if (!Object.hasOwn(bones, name)) return bones;
  const { pivot: _, ...rest } = bones[name];
  return { ...bones, [name]: at ? { ...rest, pivot: [Math.round(at[0]), Math.round(at[1])] } : rest };
}

/** `bones` with `name` hanging from `parent` (null: from the top); null when either is no bone or it would make a loop. */
export function setBoneParent(bones: Bones, name: string, parent: string | null): Bones | null {
  if (!Object.hasOwn(bones, name) || (parent !== null && !Object.hasOwn(bones, parent))) return null;
  const { parent: _, ...rest } = bones[name];
  const out = { ...bones, [name]: parent === null ? rest : { ...rest, parent } };
  return boneCycles(out).length ? null : out;
}

/** `parts` with `part` on `bone` (null: on none); an entry left with nothing in it goes away. */
export function setPartBone(parts: PartBones, part: string, bone: string | null): PartBones {
  const { bone: _, ...rest } = parts[part] ?? {};
  if (bone === null && !Object.keys(rest).length) return Object.fromEntries(Object.entries(parts).filter(([k]) => k !== part));
  return { ...parts, [part]: bone === null ? rest : { bone, ...rest } };
}

/** `bones` and `parts` without bone `name`: its children and its parts go to its parent (or to the top). */
export function deleteBone(bones: Bones, parts: PartBones, name: string): { bones: Bones; parts: PartBones } {
  if (!Object.hasOwn(bones, name)) return { bones, parts };
  const up = bones[name].parent !== undefined && Object.hasOwn(bones, bones[name].parent!) && bones[name].parent !== name ? bones[name].parent! : null;
  const out: Bones = {};
  for (const [b, def] of Object.entries(bones)) {
    if (b === name) continue;
    if (def.parent !== name) { out[b] = def; continue; }
    const { parent: _, ...rest } = def;
    out[b] = up === null ? rest : { ...rest, parent: up };
  }
  let kept = parts;
  for (const [p, def] of Object.entries(parts)) if (def?.bone === name) kept = setPartBone(kept, p, up);
  return { bones: out, parts: kept };
}

/** Bone names parents first, each with how deep it is, for an indented list (children in file order). */
export function boneRows(bones: Bones): { name: string; depth: number }[] {
  const looped = new Set(boneCycles(bones).flat());
  const parentOf = (b: string) => { const p = bones[b].parent; return typeof p === 'string' && p !== b && Object.hasOwn(bones, p) && !looped.has(b) ? p : null; };
  const out: { name: string; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => { for (const b of Object.keys(bones)) if (parentOf(b) === parent) { out.push({ name: b, depth }); walk(b, depth + 1); } };
  walk(null, 0);
  return out;
}

/** `bone` with every bone below it, and the parts that sit on any of them: what one pick binds to a parameter. Bones come parent first. */
export function boneSubtree(bones: Bones, parts: PartBones, bone: string): { bones: string[]; parts: string[] } {
  if (!Object.hasOwn(bones, bone)) return { bones: [], parts: [] };
  const below = boneRows(bones), at = below.findIndex(r => r.name === bone);
  const set = new Set<string>([bone]);
  for (let i = at + 1; i < below.length && below[i].depth > below[at].depth; i++) set.add(below[i].name);
  return { bones: [...set], parts: Object.keys(parts).filter(p => { const b = parts[p]?.bone; return typeof b === 'string' && set.has(b); }) };
}

/** What the animation studio edits of rig.json besides `animations` and `pivots`: null means "not written, use the default". */
export interface RigSettings {
  idle: string | null;
  speakAnim: string | null; speakSlot: string | null; speakVariants: string[]; speakRate: number | null;
  blink: boolean; blinkSlot: string | null; blinkVariant: string | null; blinkEvery: [number, number] | null; blinkDur: number | null;
}

export const noRigSettings = (): RigSettings => ({
  idle: null, speakAnim: null, speakSlot: null, speakVariants: [], speakRate: null,
  blink: false, blinkSlot: null, blinkVariant: null, blinkEvery: null, blinkDur: null,
});

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const nonEmpty = (v: unknown) => (typeof v === 'string' && v ? v : null);
const positive = (v: unknown) => (typeof v === 'number' && v > 0 ? v : null);

/** The studio's settings as a parsed rig.json states them. */
export function readRigSettings(data: unknown): RigSettings {
  const d = obj(obj(data).autonomous), speak = obj(d.speak), blink = obj(d.blink);
  const every = blink.every;
  return {
    idle: nonEmpty(d.idle),
    speakAnim: nonEmpty(speak.anim), speakSlot: nonEmpty(speak.slot),
    speakVariants: Array.isArray(speak.variants) ? speak.variants.filter((v): v is string => typeof v === 'string') : [],
    speakRate: positive(speak.rate),
    blink: !!d.blink, blinkSlot: nonEmpty(blink.slot), blinkVariant: nonEmpty(blink.variant),
    blinkEvery: Array.isArray(every) && every.length === 2 && every.every(n => typeof n === 'number') ? [every[0], every[1]] : null,
    blinkDur: positive(blink.dur),
  };
}

/** Set or drop (null) a key of a copy of `base`, keeping the other keys and their order. */
function withKey(base: Record<string, unknown>, key: string, value: unknown): Record<string, unknown> {
  const { [key]: _old, ...rest } = base;
  if (value === null) return rest;
  return key in base ? { ...base, [key]: value } : { ...rest, [key]: value };
}

/** The new `autonomous.speak` value: `current` (the file's) with the studio's fields set (variants get their slot written out, `mouth` unless set); null when nothing is left. */
export function speakValue(current: unknown, s: RigSettings): Record<string, unknown> | null {
  let out = obj(current);
  out = withKey(out, 'anim', s.speakAnim);
  out = withKey(out, 'slot', s.speakSlot ?? (s.speakVariants.length ? 'mouth' : null));
  out = withKey(out, 'variants', s.speakVariants.length ? s.speakVariants : null);
  out = withKey(out, 'rate', s.speakRate);
  return Object.keys(out).length ? out : null;
}

/** The new `autonomous.blink` value: the slot and variant are always written out (`eyes` / `closed` unless set); null when blinking is off. */
export function blinkValue(current: unknown, s: RigSettings): Record<string, unknown> | null {
  if (!s.blink) return null;
  let out = obj(current);
  out = withKey(out, 'slot', s.blinkSlot ?? 'eyes');
  out = withKey(out, 'variant', s.blinkVariant ?? 'closed');
  out = withKey(out, 'every', s.blinkEvery);
  out = withKey(out, 'dur', s.blinkDur);
  return out;
}

/** The new `autonomous` value: `current` (the file's) with the studio's idle, speak and blink set; null when nothing is left. */
export function autonomousValue(current: unknown, s: RigSettings): Record<string, unknown> | null {
  let out = obj(current);
  out = withKey(out, 'idle', s.idle);
  out = withKey(out, 'speak', speakValue(out.speak, s));
  out = withKey(out, 'blink', blinkValue(out.blink, s));
  return Object.keys(out).length ? out : null;
}

/** The parts of the settings that end up in `autonomous.speak` / `autonomous.blink`, to tell whether the file needs rewriting. */
export const speakPart = (s: RigSettings) => JSON.stringify([s.speakAnim, s.speakSlot, s.speakVariants, s.speakRate]);
export const blinkPart = (s: RigSettings) => JSON.stringify([s.blink, s.blinkSlot, s.blinkVariant, s.blinkEvery, s.blinkDur]);
