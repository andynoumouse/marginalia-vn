// Script transforms (`transform name:` blocks): a named sequence of tweens and waits that compiles to the keyframe
// animation a rig.json `animations` entry is, so the renderer plays it with the code that plays those (docs/design/script-transforms.md).
// Pure functions, no DOM.

import { ANIMS, ANIM_NAMES, easeProblem, isEaseSpec, type AnimDef, type KeyChannel, type KeyDef } from './anim.js';
import type { AutoDef } from './auto-anim.js';
import { evalExpr, ExprError, parseExpr, type Expr, type Value } from './expr.js';
import type { Rng } from './random.js';
import { rgbNumber } from './fx.js';
import type { Src } from './types.js';

/** A number, or an expression (over the transform's parameters and the script's variables) worked out when `animate` runs. */
export type Val = number | Expr;
/** A tween's target values, relative to where the sprite stands: `x`, `y` as in a rig key (fractions of the stage's shorter side), `scale` 1 = as is, `rot` degrees, `alpha` a factor on the opacity. */
export interface TweenStep { kind: 'tween'; x?: Val; y?: Val; scale?: Val; rot?: Val; alpha?: Val; tint?: string | null; flash?: number; flashColor?: string; dur: number; ease: string | null; src: Src }
/** The channels a transform has: the rig key ones, and the two colors (`tint`, multiplied in, rests at white; `flash`, 0-1 of the way to a color, rests at 0). */
type Chan = KeyChannel | 'tint' | 'flash';
export interface WaitStep { kind: 'wait'; dur: number; src: Src }
/** A preset (`hop`, `nod` ...) played for `dur` seconds at `strength`, on top of where the channels stand. */
export interface PresetStep { kind: 'preset'; name: string; dur: number; strength: Val; src: Src }
/** Branches that start together; the step ends with the longest. Each channel may be moved by one branch only. */
export interface ParallelStep { kind: 'parallel'; branches: TransformStep[][]; src: Src }
/** `if` / `elif` / `else` (a null `cond`): the first branch whose condition holds is played. Worked out when `animate` runs. */
export interface IfStep { kind: 'if'; branches: { cond: Expr | null; steps: TransformStep[] }[]; src: Src }
/** One branch, chosen at random when `animate` runs. */
export interface PickStep { kind: 'pick'; branches: TransformStep[][]; src: Src }
export type TransformStep = TweenStep | WaitStep | PresetStep | ParallelStep | IfStep | PickStep;
/** `repeat` as the last line: a count, or `'forever'` (the animation then loops by itself). */
export type TransformRepeat = number | 'forever' | null;
/** A parameter of `transform name(amount=1):` and the number it has when `animate` gives no argument. */
export interface TransformParam { name: string; def: number }
/** `auto`: `transform fidget every 4..9 while trust > 2:` runs by itself on whatever it is attached to (`animate <target> fidget auto`). */
/** One line of a `choreography` block: the step `step` (a tween, a wait or a preset) that `target` starts `at` seconds in. */
export interface ChoreographyLine { at: number; target: string; step: TweenStep | WaitStep | PresetStep; src: Src }
export interface ChoreographyDef { name: string; src: Src; lines: ChoreographyLine[] }

export interface TransformDef { name: string; src: Src; params: TransformParam[]; steps: TransformStep[]; repeat: TransformRepeat; auto?: AutoDef }

export const TRANSFORM_USAGE = 'A transform step is: [x=] [y=] [scale=] [rot=] [alpha=] [tint=] [flash=] [seconds] [ease=], wait <seconds>, a preset [seconds] [strength=], parallel:, if <condition>:, pick:, or repeat [times] (last)';
const MAX_STEPS = 400; // after repeat is unrolled

/** The tween properties a writer types, and the rig key channel each sets. */
const PROPS = [['x', 'x'], ['y', 'y'], ['scale', 'scale'], ['rot', 'rot'], ['alpha', 'opacity']] as const;
const WHITE = 0xffffff;
const REST: Record<Chan, number> = { x: 0, y: 0, scale: 0, rot: 0, opacity: 1, tint: WHITE, flash: 0 };
const hexOf = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const HEX = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

const tokens = (text: string) => text.trim().split(/\s+/).filter(Boolean);
const finite = (s: string) => s !== '' && Number.isFinite(Number(s));

/** The text of a tween value: a number stays one, anything else is an expression (written without spaces: `rot=-2*amount`). */
function valueOf(k: string, v: string): Val {
  if (finite(v)) return Number(v);
  try { return parseExpr(v); } catch (e) { throw new Error(`${k}=${v}: ${e instanceof ExprError ? e.message : 'not a number or an expression'}`); }
}

/**
 * One line of a transform body; `repeat` comes back as `{ repeat }`, and the block headers as `{ block }` with their
 * condition (`if`, `elif`). Throws an Error with the message to show.
 */
export function parseTransformLine(text: string, src: Src): TransformStep | { repeat: Exclude<TransformRepeat, null> } | { block: 'parallel' | 'pick' | 'choice' | 'else' } | { block: 'if' | 'elif'; cond: Expr } {
  const [head, ...rest] = tokens(text);
  if ((head === 'parallel:' || head === 'pick:' || head === 'choice:' || head === 'else:') && !rest.length) return { block: head.slice(0, -1) as 'parallel' | 'pick' | 'choice' | 'else' };
  const cond = /^(if|elif)\s+(.+?)\s*:$/.exec(text.trim());
  if (cond) {
    try { return { block: cond[1] as 'if' | 'elif', cond: parseExpr(cond[2]) }; } catch (e) { throw new Error(e instanceof ExprError ? e.message : `Bad condition "${cond[2]}"`); }
  }
  if (head === 'repeat') {
    if (!rest.length) return { repeat: 'forever' };
    if (rest.length > 1 || !/^\d+$/.test(rest[0]) || Number(rest[0]) < 1) throw new Error('Use: repeat [times] (a whole number, 1 or more; nothing at all loops forever)');
    return { repeat: Number(rest[0]) };
  }
  if (head === 'wait') {
    if (rest.length !== 1 || !finite(rest[0]) || Number(rest[0]) < 0) throw new Error('Use: wait <seconds>');
    return { kind: 'wait', dur: Number(rest[0]), src };
  }
  if (ANIM_NAMES.includes(head)) { // a preset: hop 0.25 strength=2
    const step: PresetStep = { kind: 'preset', name: head, dur: ANIMS[head].dur, strength: 1, src };
    let gotDur = false;
    for (const t of rest) {
      if (t.startsWith('strength=')) step.strength = valueOf('strength', t.slice(9));
      else if (finite(t) && Number(t) > 0 && !gotDur) { step.dur = Number(t); gotDur = true; }
      else throw new Error(`Use: ${head} [seconds] [strength=1]`);
    }
    return step;
  }
  const step: TweenStep = { kind: 'tween', dur: 0, ease: null, src };
  let gotDur = false, any = false;
  for (const t of [head, ...rest]) {
    const eq = t.indexOf('=');
    if (eq > 0) {
      const k = t.slice(0, eq), v = t.slice(eq + 1);
      if (k === 'ease') {
        if (!isEaseSpec(v)) throw new Error(easeProblem(v));
        step.ease = v;
      } else if (k === 'x' || k === 'y' || k === 'scale' || k === 'rot' || k === 'alpha') {
        step[k] = valueOf(k, v);
        any = true;
      } else if (k === 'tint') {
        if (v !== 'none' && !HEX.test(v)) throw new Error('tint= takes a color like #ff8080, or none');
        step.tint = v === 'none' ? null : v;
        any = true;
      } else if (k === 'flash') { // flash=0.8 (white), flash=#ff0000 (all the way), flash=#ff0000:0.8
        const [c, amount, extra] = HEX.test(v.split(':')[0]) ? v.split(':') : ['', v, undefined];
        if (extra !== undefined || (amount !== undefined && !finite(amount)) || (c === '' && !finite(amount)) || (amount !== undefined && (Number(amount) < 0 || Number(amount) > 1))) throw new Error('flash= takes an amount from 0 to 1 (white), a color like #ff0000 (all the way), or color:amount like #ff0000:0.8');
        step.flash = amount === undefined ? 1 : Number(amount);
        if (c) step.flashColor = c;
        any = true;
      } else throw new Error(`Unknown property "${k}" in a transform (x, y, scale, rot, alpha, tint, flash, ease)`);
    } else if (finite(t) && !gotDur) {
      if (Number(t) < 0) throw new Error('The seconds of a step cannot be negative');
      step.dur = Number(t);
      gotDur = true;
    } else throw new Error(TRANSFORM_USAGE);
  }
  if (!any) throw new Error(TRANSFORM_USAGE);
  return step;
}

const SAMPLE_FPS = 30, MAX_SAMPLES = 120;
/** A preset as offsets on the transform's channels, sampled at 30 a second (`strength` times its usual size); the time in each is seconds from the step's start. */
function presetSamples(name: string, dur: number, strength: number): ({ t: number } & Partial<Record<KeyChannel, number>>)[] {
  const n = Math.min(MAX_SAMPLES, Math.max(2, Math.ceil(dur * SAMPLE_FPS)));
  return Array.from({ length: n }, (_, i) => {
    const u = (i + 1) / n, o = ANIMS[name].fn(u);
    return { t: u * dur, x: (o.dx ?? 0) * strength, y: (o.dy ?? 0) * strength, scale: (o.sy ?? 0) * strength, rot: (o.rot ?? 0) * strength };
  });
}
const presetChannelCache = new Map<string, { channels: KeyChannel[]; uniform: boolean }>();
/** The channels a preset moves, and whether it scales x and y alike (`breathe` does not, and a transform has one scale channel). */
function presetInfo(name: string) {
  let info = presetChannelCache.get(name);
  if (!info) {
    const channels = new Set<KeyChannel>();
    let uniform = true;
    for (let i = 0; i <= 40; i++) {
      const o = ANIMS[name].fn(i / 40);
      if (Math.abs(o.dx ?? 0) > 1e-9) channels.add('x');
      if (Math.abs(o.dy ?? 0) > 1e-9) channels.add('y');
      if (Math.abs(o.sy ?? 0) > 1e-9) channels.add('scale');
      if (Math.abs(o.rot ?? 0) > 1e-9) channels.add('rot');
      if (Math.abs((o.sx ?? 0) - (o.sy ?? 0)) > 1e-9) uniform = false;
    }
    info = { channels: [...channels], uniform };
    presetChannelCache.set(name, info);
  }
  return info;
}

/** How long a step takes: a parallel step as long as its longest branch, an if or pick as its longest (they differ per play). */
const stepDur = (st: TransformStep): number => (st.kind === 'parallel' || st.kind === 'pick' ? Math.max(0, ...st.branches.map(seqDur)) : st.kind === 'if' ? Math.max(0, ...st.branches.map(b => seqDur(b.steps))) : st.dur);
const seqDur = (steps: TransformStep[]) => steps.reduce((s, st) => s + stepDur(st), 0);

/** The channels a run of steps moves, parallel branches included. */
function channelsOf(steps: TransformStep[], into = new Set<Chan>()): Set<Chan> {
  for (const st of steps) {
    if (st.kind === 'parallel' || st.kind === 'pick') for (const b of st.branches) channelsOf(b, into);
    else if (st.kind === 'if') for (const b of st.branches) channelsOf(b.steps, into);
    else if (st.kind === 'preset') for (const ch of presetInfo(st.name).channels) into.add(ch);
    else if (st.kind === 'tween') {
      for (const [prop, ch] of PROPS) if (st[prop] !== undefined) into.add(ch);
      if (st.tint !== undefined) into.add('tint');
      if (st.flash !== undefined) into.add('flash');
    }
  }
  return into;
}

/** The steps with `repeat n` unrolled (`forever` and no repeat play the body once; forever is the caller's loop). */
function unrolled(def: TransformDef): TransformStep[] {
  const times = typeof def.repeat === 'number' ? def.repeat : 1;
  return Array.from({ length: times }, () => def.steps).flat();
}

const countSteps = (steps: TransformStep[]): number => steps.reduce((n, st) => n + (st.kind === 'parallel' || st.kind === 'pick' ? 1 + st.branches.reduce((m, b) => m + countSteps(b), 0) : st.kind === 'if' ? 1 + st.branches.reduce((m, b) => m + countSteps(b.steps), 0) : 1), 0);

const round = (n: number) => Math.round(n * 1e6) / 1e6;

interface Point { ch: Chan; t: number; v: number; ease?: string; /** A flash point's color (0xrrggbb). */ c?: number }

/**
 * Walk the steps once: each channel gets a track of points (time in seconds, value, the ease it is reached by). A channel
 * is held, by a flat point, from its last point to the start of its next move and to the end, because a rig key track
 * otherwise slides on to its next key. Returns the points, the total length, and the values the channels end at.
 */
/** The running value of every channel, and the color a flash is heading to. */
type Cur = Record<Chan, number> & { fcolor: number };
function simulate(def: TransformDef) {
  const steps = unrolled(def);
  const total = seqDur(steps);
  const pts: Point[] = [];
  const lastT: Record<Chan, number> = { x: 0, y: 0, scale: 0, rot: 0, opacity: 0, tint: 0, flash: 0 };
  const hold = (ch: Chan, t: number, v: number, c?: number) => {
    if (lastT[ch] < t) { pts.push({ ch, t, v, ease: 'linear', ...(c !== undefined ? { c } : {}) }); lastT[ch] = t; }
  };
  const run = (list: TransformStep[], t0: number, cur: Cur): number => {
    let t = t0;
    for (const st of list) {
      if (st.kind === 'tween') {
        for (const [prop, ch] of PROPS) {
          const raw = st[prop];
          if (raw === undefined || typeof raw !== 'number') continue; // an expression is worked out first (resolveTransform)
          hold(ch, t, cur[ch]);
          const v = prop === 'scale' ? raw - 1 : raw; // the scale channel is added to the size
          cur[ch] = v;
          pts.push({ ch, t: t + st.dur, v, ...(st.ease ? { ease: st.ease } : {}) });
          lastT[ch] = t + st.dur;
        }
        if (st.tint !== undefined) {
          hold('tint', t, cur.tint);
          cur.tint = st.tint === null ? WHITE : rgbNumber(st.tint);
          pts.push({ ch: 'tint', t: t + st.dur, v: cur.tint, ...(st.ease ? { ease: st.ease } : {}) });
          lastT.tint = t + st.dur;
        }
        if (st.flash !== undefined) {
          hold('flash', t, cur.flash, cur.fcolor);
          cur.flash = st.flash;
          if (st.flashColor) cur.fcolor = rgbNumber(st.flashColor);
          pts.push({ ch: 'flash', t: t + st.dur, v: st.flash, c: cur.fcolor, ...(st.ease ? { ease: st.ease } : {}) });
          lastT.flash = t + st.dur;
        }
        t += st.dur;
      } else if (st.kind === 'wait') t += st.dur;
      else if (st.kind === 'preset') {
        const samples = presetSamples(st.name, st.dur, typeof st.strength === 'number' ? st.strength : 1);
        for (const ch of presetInfo(st.name).channels) {
          hold(ch, t, cur[ch]);
          for (const sm of samples) pts.push({ ch, t: t + sm.t, v: cur[ch] + (sm[ch] ?? 0), ease: 'linear' });
          lastT[ch] = t + st.dur;
        }
        t += st.dur;
      } else if (st.kind === 'parallel') {
        let end = t;
        for (const branch of st.branches) {
          const own: Cur = { ...cur };
          end = Math.max(end, run(branch, t, own));
          for (const ch of channelsOf(branch)) cur[ch] = own[ch];
          if (channelsOf(branch).has('flash')) cur.fcolor = own.fcolor;
        }
        t = end;
      } // an if or pick is resolved before this walk
    }
    return t;
  };
  const cur: Cur = { ...REST, fcolor: WHITE };
  run(steps, 0, cur);
  for (const ch of channelsOf(steps)) hold(ch, total, cur[ch], ch === 'flash' ? cur.fcolor : undefined);
  return { pts, total, end: cur, used: channelsOf(steps) };
}

/**
 * The keyframe animation of a transform: a key per track point at its time over the total, so a tween eases from the
 * previous values to the named ones and a wait is a flat stretch. Channels start at rest, and the animation returns to
 * rest after its last key as a rig animation does.
 */
export function transformToAnim(def: TransformDef): AnimDef {
  const { pts, total, used } = simulate(def);
  if (total <= 0 || !used.size) return { dur: total > 0 ? total : 1, keys: [], ...(def.auto ? { auto: def.auto } : {}) };
  const keyOf = (p: Point): KeyDef => {
    const k = { t: round(Math.min(1, p.t / total)), ...(p.ease ? { ease: p.ease } : {}) };
    if (p.ch === 'tint') return { ...k, tint: hexOf(p.v) };
    if (p.ch === 'flash') return { ...k, flash: round(p.v), ...(p.c !== undefined && p.c !== WHITE ? { flashColor: hexOf(p.c) } : {}) };
    return { ...k, [p.ch]: round(p.v) };
  };
  const keys: KeyDef[] = [...pts].sort((a, b) => a.t - b.t).map(keyOf);
  return { dur: round(total), keys, ...(def.auto ? { auto: def.auto } : {}) };
}

/** Channels moved by two branches of one parallel step (which one wins would be arbitrary). */
function clashes(steps: TransformStep[], out: string[] = []): string[] {
  for (const st of steps) {
    if (st.kind === 'if') { for (const b of st.branches) clashes(b.steps, out); continue; }
    if (st.kind === 'pick') { for (const b of st.branches) clashes(b, out); continue; }
    if (st.kind !== 'parallel') continue;
    const seen = new Set<Chan>();
    for (const b of st.branches) {
      for (const ch of channelsOf(b)) {
        if (seen.has(ch)) out.push(ch === 'opacity' ? 'alpha' : ch);
        seen.add(ch);
      }
      clashes(b, out);
    }
  }
  return out;
}

/** Problems with a transform that are not syntax: it does nothing, is too long, clashes in a parallel step, or loops forever without coming back to rest. */
export function checkTransform(def: TransformDef): { severity: 'error' | 'warning'; message: string }[] {
  const out: { severity: 'error' | 'warning'; message: string }[] = [];
  const add = (severity: 'error' | 'warning', message: string) => out.push({ severity, message });
  if (!def.steps.length) { add('error', `Transform "${def.name}" has no steps`); return out; }
  const n = countSteps(unrolled(def));
  if (n > MAX_STEPS) add('error', `Transform "${def.name}" has ${n} steps once repeated (at most ${MAX_STEPS})`);
  const presets = new Set<string>();
  const collect = (steps: TransformStep[]) => {
    for (const st of steps) {
      if (st.kind === 'preset') presets.add(st.name);
      else if (st.kind === 'parallel' || st.kind === 'pick') st.branches.forEach(collect);
      else if (st.kind === 'if') st.branches.forEach(b => collect(b.steps));
    }
  };
  collect(def.steps);
  for (const name of presets) if (!presetInfo(name).uniform) add('error', `Transform "${def.name}": ${name} stretches x and y by different amounts, which a transform cannot do (play it with animate ... ${name} instead)`);
  for (const ch of new Set(clashes(def.steps))) add('error', `Transform "${def.name}": ${ch} is moved by two branches of one parallel step (give each channel to one branch)`);
  const { total, end } = simulate(def);
  if (!(total > 0)) add('error', `Transform "${def.name}" takes no time (give a tween seconds, or add wait)`);
  if (def.repeat === 'forever') {
    const used = channelsOf(def.steps);
    const props: readonly (readonly [string, Chan])[] = [...PROPS, ['tint', 'tint'], ['flash', 'flash']];
    const away = props.filter(([, ch]) => used.has(ch) && end[ch] !== REST[ch]).map(([prop]) => prop);
    const restOf = (k: string) => k === 'scale' || k === 'alpha' ? '1' : k === 'tint' ? 'none' : '0';
    if (away.length) add('warning', `Transform "${def.name}" repeats forever but ends with ${away.join(', ')} away from rest, so each loop jumps back (finish with ${away.map(k => `${k}=${restOf(k)}`).join(' ')})`);
  }
  return out;
}

const dynamicSteps = (steps: TransformStep[]): boolean => steps.some(st => st.kind === 'if' || st.kind === 'pick'
  || (st.kind === 'parallel' && st.branches.some(dynamicSteps))
  || (st.kind === 'preset' && typeof st.strength === 'object')
  || (st.kind === 'tween' && PROPS.some(([prop]) => typeof st[prop] === 'object')));

/** A transform that depends on `animate`'s arguments, the script's variables or chance, so it is worked out when `animate` runs (resolveTransform) instead of at compile time. */
export const isDynamic = (def: TransformDef): boolean => def.params.length > 0 || dynamicSteps(def.steps);

/**
 * The keyframe animation of a dynamic transform for one `animate`: the parameters take the arguments (else their
 * defaults), expressions see them and the script's variables, the first `if` branch that holds is played and a `pick`
 * takes one branch with `rng` (the runtime's, so a rollback or a load plays the same one). `repeat` unrolls the result.
 */
export function resolveTransform(def: TransformDef, args: Value[], scope: Record<string, Value>, rng: Rng): AnimDef {
  const vars: Record<string, Value> = { ...scope };
  def.params.forEach((p, i) => { vars[p.name] = args[i] ?? p.def; });
  const val = (v: Val | undefined): number | undefined => {
    if (v === undefined || typeof v === 'number') return v;
    const n = Number(evalExpr(v, vars, rng));
    return Number.isFinite(n) ? n : 0;
  };
  const flat = (steps: TransformStep[]): TransformStep[] => steps.flatMap((st): TransformStep[] => {
    switch (st.kind) {
      case 'tween': {
        const out: TweenStep = { ...st };
        for (const [prop] of PROPS) {
          const v = val(st[prop]);
          if (v === undefined) delete out[prop]; else out[prop] = v;
        }
        return [out];
      }
      case 'wait': return [st];
      case 'preset': return [{ ...st, strength: val(st.strength) ?? 1 }];
      case 'parallel': return [{ ...st, branches: st.branches.map(flat) }];
      case 'if': {
        const branch = st.branches.find(b => b.cond === null || Boolean(evalExpr(b.cond, vars, rng)));
        return branch ? flat(branch.steps) : [];
      }
      case 'pick': {
        if (!st.branches.length) return [];
        return flat(st.branches[Math.min(st.branches.length - 1, Math.floor(rng.next() * st.branches.length))]);
      }
    }
  });
  return transformToAnim({ ...def, steps: flat(def.steps) });
}

/** What a `choreography` block becomes: one transform per target, padded with waits to the same length, and the faults found. */
export interface ChoreographyBuilt { members: { target: string; def: TransformDef }[]; total: number; problems: { src: Src; message: string }[] }

/**
 * Split the timed lines of a choreography by target. Each target's lines are ordered by start; the gap before a line (and
 * after the last) becomes a `wait`, so every target's transform is as long as the whole choreography and starts at once.
 * A line that starts before the same target's previous one has ended is a problem and is left out.
 */
export function buildChoreography(c: ChoreographyDef): ChoreographyBuilt {
  const problems: ChoreographyBuilt['problems'] = [];
  const byTarget = new Map<string, ChoreographyLine[]>();
  for (const l of c.lines) byTarget.set(l.target, [...(byTarget.get(l.target) ?? []), l]);
  const built = [...byTarget].map(([target, lines]) => {
    const steps: TransformStep[] = [];
    let cursor = 0;
    for (const l of [...lines].sort((a, b) => a.at - b.at)) {
      if (l.at < cursor - 1e-9) { problems.push({ src: l.src, message: `${target} is still busy at ${l.at}s in "${c.name}": its previous step runs until ${round3(cursor)}s` }); continue; }
      if (l.at > cursor + 1e-9) steps.push({ kind: 'wait', dur: round3(l.at - cursor), src: l.src });
      steps.push(l.step);
      cursor = l.at + l.step.dur;
    }
    return { target, steps, end: cursor, src: lines[0].src };
  });
  const total = round3(Math.max(0, ...built.map(b => b.end)));
  const members = built.map(b => {
    const steps = b.end < total - 1e-9 ? [...b.steps, { kind: 'wait', dur: round3(total - b.end), src: b.src } as TransformStep] : b.steps;
    return { target: b.target, def: { name: `${c.name}:${b.target}`, src: c.src, params: [], steps, repeat: null } as TransformDef };
  });
  return { members, total, problems };
}
const round3 = (n: number) => Math.round(n * 1000) / 1000;
