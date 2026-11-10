// Animation clauses of a screen element: `on enter <effect> ...` and `loop <effect> ...` (docs/design/screen-animation.md).
// Pure parsing and the numbers a renderer needs; the DOM side lives in preview/screen-ui.ts.

import { isBareNumber, isDuration, readDuration } from './duration.js';

export const ENTER_EFFECTS = ['fade', 'slide', 'pop', 'zoom'] as const;
export type EnterEffect = typeof ENTER_EFFECTS[number];
export const LOOP_EFFECTS = ['pulse', 'bob', 'sway', 'breathe', 'shiver', 'glow'] as const;
export type LoopEffect = typeof LOOP_EFFECTS[number];
export const SLIDE_DIRS = ['left', 'right', 'up', 'down'] as const;
export type SlideDir = typeof SLIDE_DIRS[number];

const ENTER_SECONDS: Record<EnterEffect, number> = { fade: 0.3, slide: 0.35, pop: 0.25, zoom: 0.4 };
const LOOP_SECONDS: Record<LoopEffect, number> = { pulse: 1, bob: 1.2, sway: 3, breathe: 3.5, shiver: 0.6, glow: 1.5 };
export const DEFAULT_SLIDE_DISTANCE = 80;

/** `on enter`: plays when the element first appears. `stagger` (an `each` line only) delays entry i by i times it. */
export interface EnterAnim { fx: EnterEffect; dur: number; delay: number; stagger: number; dir: SlideDir; dist: number }
/** `loop`: repeats for as long as the element is shown; `dur` is one cycle. */
export interface LoopAnim { fx: LoopEffect; dur: number; strength: number }
/** `on exit`: plays on a copy of the element when a redraw drops it (the effect runs the other way: it leaves toward `dir`). */
export type ExitAnim = Omit<EnterAnim, 'stagger'>;
export interface ElementAnim { enter?: EnterAnim; exit?: ExitAnim; loop?: LoopAnim }

/** What a resolved view part carries: the effects with the stagger worked out, and a key that stays the same across redraws. */
export interface PartAnim { enter?: Omit<EnterAnim, 'stagger'>; exit?: ExitAnim; loop?: LoopAnim; key: string }

export class AnimSyntaxError extends Error {}

const NUMBER = /^\d*\.?\d+$/;

function positive(tok: string | undefined, what: string): number {
  const n = tok !== undefined && NUMBER.test(tok) ? Number(tok) : NaN;
  if (!(n > 0)) throw new AnimSyntaxError(`${what} needs a number above 0`);
  return n;
}
/** A duration above 0 with its unit (`0.3s`, `300ms`). */
function positiveDur(tok: string | undefined, what: string): number {
  const d = readDuration(tok, `a duration for ${what}`, m => new AnimSyntaxError(m));
  if (!(d > 0)) throw new AnimSyntaxError(`${what} needs a duration above 0`);
  return d;
}

/** The text after `on enter`: `<effect> [slide direction] [duration] [delay <duration>] [stagger <duration>] [distance=px]`. */
export function parseEnter(text: string): EnterAnim {
  const usage = `Use: on enter ${ENTER_EFFECTS.join('|')} [duration like 0.3s] [delay 0.1s] [stagger 0.05s]  (slide also takes left, right, up or down and distance=px)`;
  const toks = text.split(/\s+/).filter(Boolean);
  const fx = toks.shift() ?? '';
  if (!(ENTER_EFFECTS as readonly string[]).includes(fx)) throw new AnimSyntaxError(`on enter needs an effect (${ENTER_EFFECTS.join(', ')}), not "${fx}"`);
  const out: EnterAnim = { fx: fx as EnterEffect, dur: ENTER_SECONDS[fx as EnterEffect], delay: 0, stagger: 0, dir: 'down', dist: DEFAULT_SLIDE_DISTANCE };
  if (fx === 'slide') {
    const d = toks.shift() ?? '';
    if (!(SLIDE_DIRS as readonly string[]).includes(d)) throw new AnimSyntaxError(`slide needs a direction (${SLIDE_DIRS.join(', ')}): on enter slide left`);
    out.dir = d as SlideDir;
  }
  let timed = false;
  for (let i = 0; i < toks.length; i++) {
    const w = toks[i];
    if ((isDuration(w) || isBareNumber(w)) && !timed) { out.dur = positiveDur(w, 'on enter'); timed = true; }
    else if (w === 'delay') out.delay = positiveDur(toks[++i], 'delay');
    else if (w === 'stagger') out.stagger = positiveDur(toks[++i], 'stagger');
    else if (/^distance=/.test(w)) {
      if (fx !== 'slide') throw new AnimSyntaxError('distance= goes with slide');
      out.dist = positive(w.slice(9), 'distance=');
    }
    else throw new AnimSyntaxError(usage);
  }
  return out;
}

/** The text after `on exit`: the same words as `on enter`, without `stagger`. */
export function parseExit(text: string): ExitAnim {
  if (/(^|\s)stagger(\s|$)/.test(text)) throw new AnimSyntaxError('stagger goes with on enter');
  const { stagger: _s, ...exit } = parseEnter(text);
  return exit;
}

/** The text after `loop`:`<effect> [duration] [strength=n]`. */
export function parseLoop(text: string): LoopAnim {
  const toks = text.split(/\s+/).filter(Boolean);
  const fx = toks.shift() ?? '';
  if (!(LOOP_EFFECTS as readonly string[]).includes(fx)) throw new AnimSyntaxError(`loop needs an effect (${LOOP_EFFECTS.join(', ')}), not "${fx}"`);
  const out: LoopAnim = { fx: fx as LoopEffect, dur: LOOP_SECONDS[fx as LoopEffect], strength: 1 };
  let timed = false;
  for (const w of toks) {
    if ((isDuration(w) || isBareNumber(w)) && !timed) { out.dur = positiveDur(w, 'loop'); timed = true; }
    else if (/^strength=/.test(w)) out.strength = positive(w.slice(9), 'strength=');
    else throw new AnimSyntaxError('Use: loop pulse|bob|sway|breathe|shiver|glow [duration like 1.2s] [strength=1]');
  }
  return out;
}

/** The effect an element of kind `kind` may use. A hotspot's hit area is fixed to the art behind it, so it can only fade or glow. */
export function animProblem(kind: string, a: ElementAnim): string | null {
  if (kind !== 'hotspot') return null;
  if (a.enter && a.enter.fx !== 'fade') return `A hotspot's hit area does not move: on enter ${a.enter.fx} goes on its image, a button or a panel (a hotspot can use on enter fade)`;
  if (a.exit && a.exit.fx !== 'fade') return `A hotspot's hit area does not move: on exit ${a.exit.fx} goes on its image, a button or a panel (a hotspot can use on exit fade)`;
  if (a.loop && a.loop.fx !== 'glow') return `A hotspot's hit area does not move: loop ${a.loop.fx} goes on its image, a button or a panel (a hotspot can use loop glow)`;
  return null;
}

/** The enter effect of entry `i` of an `each`: the delay grows by the stagger. */
export function staggered(a: ElementAnim, i: number): ElementAnim {
  if (!a.enter || !a.enter.stagger) return a;
  return { ...a, enter: { ...a.enter, delay: a.enter.delay + i * a.enter.stagger, stagger: 0 } };
}

/** An element's animation as a part carries it: the stagger is already in the delay, and a hotspot keeps only what it may use. */
export function partAnim(a: ElementAnim, key: string, kind: string): PartAnim | null {
  const out: PartAnim = { key };
  if (a.enter) {
    const { stagger: _s, ...enter } = a.enter;
    if (kind !== 'hotspot' || enter.fx === 'fade') out.enter = enter;
    else out.enter = { ...enter, fx: 'fade' };
  }
  if (a.exit) out.exit = kind !== 'hotspot' || a.exit.fx === 'fade' ? a.exit : { ...a.exit, fx: 'fade' };
  if (a.loop && (kind !== 'hotspot' || a.loop.fx === 'glow')) out.loop = a.loop;
  return out.enter || out.exit || out.loop ? out : null;
}
