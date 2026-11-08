// What a character does by itself: animations that start on their own (rig.json `animations.<name>.auto`) and poses it
// holds while a condition is true (`reactions`). Pure, so the renderer only feeds in time and the story's state.
// See docs/design/auto-animations.md.

import type { AnimDef } from './anim.js';
import { evalExpr, parseExpr, type Expr, type Value } from './expr.js';
import { frameTracks } from './frames.js';
import { lerpParams, type ParamDef } from './params.js';

/** `auto` of an animation: a wait after each run (`every`), a condition it loops under (`while`), or both. */
export interface AutoDef { every?: number | { min: number; max: number }; while?: string }

/** An automatic animation of a rig, ready for the scheduler. `dur` is a run's length; `safe`: only frame tracks (kept under reduced motion). */
export interface AutoEntry { name: string; auto: AutoDef; dur: number; safe: boolean }

/** What the scheduler sees each step. `vars` is the script's variables, `params` the character's base parameter values. */
export interface AutoContext { speaking: boolean; behaviors: boolean; reduceMotion: boolean; vars: Record<string, Value>; params: Record<string, number> }

/** Per animation: `wait` seconds left until the next run (null: none counting), `left` seconds left of the run now (null: not running). */
export interface AutoSlot { name: string; wait: number | null; left: number | null; looping: boolean }
export interface AutoState { slots: AutoSlot[]; suspended: boolean }
export interface AutoStep { state: AutoState; start: string[]; stop: string[] }

const cache = new Map<string, Expr | null>();

/** The parsed condition (cached by its text), or null when it does not parse. */
export function parseCondition(src: string): Expr | null {
  if (cache.has(src)) return cache.get(src)!;
  let e: Expr | null = null;
  try { e = parseExpr(src); } catch { e = null; }
  cache.set(src, e);
  return e;
}

/** Whether the condition `src` holds. Unparsable text, an evaluation error (a random function) and a missing name are false. */
export function holds(src: string, ctx: Pick<AutoContext, 'speaking' | 'vars' | 'params'>): boolean {
  const e = parseCondition(src);
  if (!e) return false;
  const scope: Record<string, Value> = { ...ctx.vars, speaking: ctx.speaking, always: true };
  for (const [id, v] of Object.entries(ctx.params)) scope[`param.${id}`] = v;
  try { return Boolean(evalExpr(e, scope)); } catch { return false; }
}

const isRange = (e: unknown): e is { min: number; max: number } =>
  !!e && typeof e === 'object' && typeof (e as { min: unknown }).min === 'number' && typeof (e as { max: unknown }).max === 'number';

/** `every` as bounds, or null when it is absent or invalid. */
export function everyBounds(every: unknown): { min: number; max: number } | null {
  if (typeof every === 'number') return every > 0 ? { min: every, max: every } : null;
  return isRange(every) && every.min > 0 && every.max >= every.min ? every : null;
}

/** True when an animation has frame tracks and nothing else: it keeps running under reduced motion. */
export function reduceMotionSafe(def: AnimDef | undefined): boolean {
  if (!def) return false;
  const hasKeys = Array.isArray(def.keys) && def.keys.length > 0;
  const hasParams = !!def.params && typeof def.params === 'object' && Object.keys(def.params).length > 0;
  return !hasKeys && !hasParams && frameTracks(def.frames).length > 0;
}

/** The automatic animations of a rig, in file order. */
export function autoAnimations(animations: Record<string, AnimDef> | undefined): AutoEntry[] {
  const out: AutoEntry[] = [];
  for (const [name, def] of Object.entries(animations ?? {})) {
    const auto = (def as { auto?: unknown } | undefined)?.auto;
    if (!auto || typeof auto !== 'object' || Array.isArray(auto)) continue;
    const a = auto as AutoDef;
    if (a.every === undefined && a.while === undefined) continue;
    out.push({ name, auto: a, dur: def.dur !== undefined && def.dur > 0 ? def.dur : 1, safe: reduceMotionSafe(def) });
  }
  return out;
}

const roll = (every: AutoDef['every'], rand: () => number): number | null => {
  const b = everyBounds(every);
  return b ? b.min + (b.max - b.min) * rand() : null;
};

const fresh = (e: AutoEntry, rand: () => number): AutoSlot => ({ name: e.name, wait: roll(e.auto.every, rand), left: null, looping: false });

/** The first state of a character that has just appeared: every timer rolled, nothing running. */
export function startAuto(entries: readonly AutoEntry[], rand: () => number): AutoState {
  return { slots: entries.map(e => fresh(e, rand)), suspended: false };
}

/**
 * Advance `dt` seconds. An `every` animation runs once, then waits (counted from the run's end) a random time within
 * its bounds; a `while` one loops while the condition holds; with both, the timer only runs while the condition holds.
 * `behaviors` off (or reduced motion, for an animation with motion) stops what runs and holds the timers; turning
 * behaviors back on rolls the waits again.
 */
export function stepAuto(prev: AutoState, entries: readonly AutoEntry[], dt: number, ctx: AutoContext, rand: () => number): AutoStep {
  const start: string[] = [], stop: string[] = [];
  const reroll = prev.suspended && ctx.behaviors;
  const byName = new Map(prev.slots.map(s => [s.name, s]));
  for (const s of prev.slots) if (s.left !== null && !entries.some(e => e.name === s.name)) stop.push(s.name);
  const slots = entries.map((e): AutoSlot => {
    let s = byName.get(e.name) ?? fresh(e, rand);
    if (reroll) s = { ...s, wait: roll(e.auto.every, rand) };
    const enabled = ctx.behaviors && (!ctx.reduceMotion || e.safe);
    const gate = enabled && (e.auto.while === undefined || holds(e.auto.while, ctx));
    if (!gate) {
      if (s.left !== null) stop.push(e.name);
      return { ...s, left: null, looping: false };
    }
    const timed = everyBounds(e.auto.every) !== null;
    if (!timed) { // `while` alone: loop while it holds
      if (s.left === null) start.push(e.name);
      return { ...s, left: e.dur, looping: true };
    }
    if (s.left !== null) {
      const left = s.left - dt;
      if (left > 0) return { ...s, left };
      stop.push(e.name);
      return { ...s, left: null, wait: roll(e.auto.every, rand) };
    }
    const wait = (s.wait ?? roll(e.auto.every, rand)!) - dt;
    if (wait > 0) return { ...s, wait };
    start.push(e.name);
    return { ...s, wait: null, left: e.dur };
  });
  return { state: { slots, suspended: !ctx.behaviors }, start, stop };
}

// ---- reactions: a condition that holds a pose ----

export interface ReactionDef { when: string; pose: string; over?: number; ease?: string }

/** The first reaction whose condition holds (an index), or null. */
export function reactionTarget(reactions: readonly ReactionDef[] | undefined, ctx: Pick<AutoContext, 'speaking' | 'vars' | 'params'>): number | null {
  const list = Array.isArray(reactions) ? reactions : [];
  for (let i = 0; i < list.length; i++) if (typeof list[i]?.when === 'string' && holds(list[i].when, ctx)) return i;
  return null;
}

/** The move into a reaction's pose: from the values it left, to the pose (or back to nothing), `elapsed` of `over` seconds in. */
export interface ReactionState { entry: number | null; from: Record<string, number>; to: Record<string, number>; elapsed: number; over: number; ease?: string; now: Record<string, number> }

export const DEFAULT_REACTION_OVER = 0.4;

export const startReaction = (): ReactionState => ({ entry: null, from: {}, to: {}, elapsed: 0, over: 0, now: {} });

/**
 * Advance the reaction `dt` seconds. `target` is `reactionTarget`'s answer, `poseValues` the stored pose of an entry, `base` the
 * script's parameter values. The result's `now` holds the parameters the reaction sets right now (the renderer lays them under
 * the script's own values); once a move back to nothing has finished it is empty.
 */
export function stepReaction(
  st: ReactionState, reactions: readonly ReactionDef[] | undefined, target: number | null, dt: number,
  poseValues: (pose: string) => Record<string, number> | undefined, defs: readonly ParamDef[] | undefined, base: Record<string, number>,
): ReactionState {
  const list = reactions ?? [];
  let cur = st;
  if (target !== st.entry) {
    // `over` and `ease` of the entry that takes over; going back to nothing uses those of the entry that just stopped holding.
    const gov = target !== null ? list[target] : st.entry !== null ? list[st.entry] : undefined;
    const to = target !== null ? poseValues(list[target].pose) ?? {} : {};
    const from: Record<string, number> = {};
    for (const id of new Set([...Object.keys(st.now), ...Object.keys(to)])) from[id] = st.now[id] ?? base[id] ?? 0;
    cur = { entry: target, from, to, elapsed: 0, over: Math.max(0, gov?.over ?? DEFAULT_REACTION_OVER), ease: gov?.ease, now: st.now };
  }
  if (cur.entry === null && !Object.keys(cur.now).length) return cur;
  const elapsed = cur.elapsed + dt;
  if (cur.entry === null && elapsed >= cur.over) return { ...cur, elapsed, now: {} };
  const k = cur.over <= 0 ? 1 : Math.min(1, elapsed / cur.over);
  const end: Record<string, number> = {};
  for (const id of Object.keys(cur.from)) end[id] = cur.to[id] ?? base[id] ?? cur.from[id];
  const moved = lerpParams(defs as ParamDef[] | undefined, cur.from, end, k, cur.ease);
  const now: Record<string, number> = {};
  for (const id of Object.keys(cur.from)) if (id in moved) now[id] = moved[id];
  return { ...cur, elapsed, now };
}
