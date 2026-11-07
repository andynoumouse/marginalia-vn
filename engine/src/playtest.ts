// Playtest bot: plays a compiled program on its own, taking every menu option and screen element, and reports what the
// story can and cannot do: lines that never run, the endings it reaches, assets and variables nothing uses.
// Pure and DOM-free (`vn playtest` and the editor's palette command are thin wrappers). It steps the compiled ops the way
// Runtime does (same expression scope, same persistent data rules) but forks at every choice instead of asking a player.
//
// The search is breadth first over states at a choice: (op, call stack, variables, flags, persistent data). A state met
// twice is explored once, so loops end as soon as they stop changing anything, and a budget keeps the rest finite.
// Approximations (all documented in the README, "Playtest bot"): input answers are the default text; a condition that draws a
// random number is taken both ways; other draws come from a seeded generator and the search repeats with a few seeds.

import { arith, collectVars, evalExpr, usesRandom, type Value } from './expr.js';
import { randomStep, type Rng } from './random.js';
import { blocks, enabledItems, hudLabels, initialState, pickables, resolveScreen, screenParams, type ScreenView } from './screens.js';
import type { AssetIndex } from './assets.js';
import { interpolate } from './text.js';
import { abstraction, type Abstraction } from './playtest-abstraction.js';
import { strings, unusedAssets, variableUse } from './static-use.js';
import type { Diagnostic, FallThroughOp, Op, Program, Src, Vars } from './types.js';

export interface PlaytestOptions {
  /** Choices expanded in all (default 50000); when it runs out the report is marked incomplete. */
  maxStates?: number;
  /** Ops executed in all (default 5 million). */
  maxSteps?: number;
  /** Distinct states expanded at one menu, screen or input before the rest are skipped (default 500). */
  maxPerChoice?: number;
  /** Random seeds to try when the story draws random numbers (default 4; 1 when it never does). */
  seeds?: number;
  /** Labels to also start from (chapter select, the intro), each with the top-level setup run first. */
  roots?: string[];
  /** Also start from every label nothing jumps, calls or lists to (scenes meant to be entered with Preview from cursor). */
  allLabels?: boolean;
  /** game.json, for the labels it starts from (`intro`, `chapters`) and the assets and flags it names. */
  game?: unknown;
  /** The project's asset files, to find unused assets. Leave out to skip that check. */
  assets?: AssetIndex;
}

export interface PlaytestEnding {
  kind: 'end' | 'return' | 'fall';
  /** The `end` or `return` that stopped the story (for `fall`: the last op, the script ran off its end). */
  src: Src;
  /** The shortest route found: the options and screen elements taken, in order. */
  route: string[];
  /** Flags (`unlock`) set on that route. */
  unlocks: string[];
}

export interface LineRange { file: string; from: number; to: number }
export interface VariableUse { name: string; src: Src }

export interface PlaytestReport {
  /** False when the budget ran out: unreachable lines may then still be reachable. */
  complete: boolean;
  /** Why it is incomplete, if it is. */
  notes: string[];
  choices: number;
  steps: number;
  endings: PlaytestEnding[];
  /** Lines (grouped in ranges) no route executes. */
  unreachableLines: LineRange[];
  /** Labels whose first line is never reached. */
  unreachableLabels: string[];
  /** Places a route ran a long way without reaching a choice or the end (a loop with no way out). */
  loops: Src[];
  /** Screens that waited for a choice but offered none the bot could take. */
  stuck: Src[];
  /** Variables set but never read, and read but never set. */
  unusedVariables: VariableUse[];
  unsetVariables: VariableUse[];
  /** `unlock` flags nothing checks (neither a script nor game.json). */
  unusedFlags: VariableUse[];
  /** Asset files (images, music, sounds) no script, screen or game.json names; empty when no asset list was given. */
  unusedAssets: string[];
}

// ---- the bot ----

interface Sim {
  pc: number;
  stack: number[];
  /** What each call shadowed, parallel to the stack (see Runtime.frames). */
  frames: (Record<string, Value | null> | null)[];
  vars: Vars;
  unlocks: string[];
  persistent: Record<string, Value>;
  rng: number;
  /** Label pc the entry jump goes to instead of `start` (null: start). */
  entry: number | null;
  route: string[];
}

const HUD_RETURN = Number.MIN_SAFE_INTEGER; // return address of a HUD handler: running into it ends that path quietly
const SEGMENT_STEPS = 20000;               // ops between two choices before a path counts as a loop
const HANDLER_RUNS = 20;                   // times a screen's handlers are started per label

type Choice = { label: string; apply(s: Sim): void; /** Source line of the menu option this takes. */ line?: number };
type Stop =
  | { kind: 'choice'; at: number; choices: Choice[]; key: string }
  | { kind: 'end'; ending: Omit<PlaytestEnding, 'route' | 'unlocks'> }
  | { kind: 'fork'; states: Sim[] }
  | { kind: 'loop' | 'done' | 'stuck'; at: number };

const copy = (s: Sim): Sim => ({ ...s, stack: [...s.stack], frames: [...s.frames], vars: { ...s.vars }, unlocks: [...s.unlocks], persistent: { ...s.persistent }, route: [...s.route] });

const short = (t: string) => { const one = t.replace(/\s+/g, ' ').replace(/\{[^}]*\}/g, '').trim(); return one.length > 40 ? `${one.slice(0, 39)}…` : one; };

class Bot {
  readonly covered = new Set<number>();
  /** `file\0line` of the menu options some route took. */
  readonly taken = new Set<string>();
  readonly endings = new Map<string, PlaytestEnding>();
  readonly loops = new Map<string, Src>();
  readonly stuck = new Map<string, Src>();
  steps = 0;
  choices = 0;
  notes = new Set<string>();
  exhausted = false;
  /** Flags and persistent data any ending left behind: the base of the next playthrough round. */
  unlocksSeen = new Set<string>();
  persistentSeen: Record<string, Value> = {};
  private handlerRuns = new Map<string, number>();

  private abs: Abstraction;
  constructor(private program: Program, private o: Required<Pick<PlaytestOptions, 'maxStates' | 'maxSteps' | 'maxPerChoice'>>) { this.abs = abstraction(program); }

  /** Everything the expression language can read, as Runtime.scope builds it. */
  private scope(s: Sim, base: Round): Vars {
    const v: Vars = { ...s.vars };
    for (const [k, x] of Object.entries(base.persistent)) v[`persistent.${k}`] = x;
    for (const [k, x] of Object.entries(s.persistent)) v[`persistent.${k}`] = x;
    for (const f of base.unlocks) v[`unlocked.${f}`] = true;
    for (const f of s.unlocks) v[`unlocked.${f}`] = true;
    return v;
  }

  private view(name: string, vars: Vars): ScreenView {
    const def = this.program.screens[name];
    if (!def) return { name, parts: [], default: null, cancel: false };
    const items: Record<string, { name: string; image: string | null }> = {};
    for (const it of Object.values(this.program.items ?? {})) items[it.id] = { name: it.name, image: it.image };
    const names = Object.fromEntries(Object.entries(items).map(([k, v]) => [k, v.name]));
    return resolveScreen(def, vars, { items, stage: this.program.stage, text: (_id, raw, v) => interpolate(raw, v, names) });
  }

  /** Run `s` forward to its next choice, fork, ending or dead end. */
  advance(s: Sim, base: Round, spawn: (s: Sim) => void): Stop {
    const { ops } = this.program;
    const rng: Rng = { next: () => { const r = randomStep(s.rng); s.rng = r.state; return r.value; } };
    let n = 0;
    for (;;) {
      if (s.pc < 0 || s.pc >= ops.length) {
        return { kind: 'end', ending: { kind: 'fall', src: ops[ops.length - 1]?.src ?? { file: '', line: 0 } } };
      }
      if (++n > SEGMENT_STEPS || ++this.steps > this.o.maxSteps) {
        if (this.steps > this.o.maxSteps) { this.exhausted = true; this.notes.add(`stopped after ${this.o.maxSteps} steps`); return { kind: 'done', at: s.pc }; }
        return { kind: 'loop', at: s.pc };
      }
      const op: Op = ops[s.pc];
      this.covered.add(s.pc);
      const here = s.pc;
      switch (op.op) {
        case 'menu': {
          const scope = this.scope(s, base);
          const visible = op.options.filter(o => !o.cond || Boolean(evalExpr(o.cond, scope)));
          if (visible.length === 0) { s.pc++; break; }
          // Which target an option leads to is part of the state, so the key is the op plus everything that decides what happens next.
          const choices: Choice[] = visible.map(o => ({ label: short(o.text), line: o.from, apply: t => { t.pc = o.target; } }));
          // The clock can always run out (the player's timed-choices setting is ignored), unless it is a fixed number of 0 or less.
          const to = op.timeout;
          if (to && (usesRandom(to.seconds) || collectVars(to.seconds).size > 0 || Number(evalExpr(to.seconds, {})) > 0)) {
            choices.push({ label: 'timeout', line: to.from, apply: t => { t.pc = to.target; } });
          }
          return { kind: 'choice', at: here, key: this.key(s), choices };
        }
        case 'screen': {
          const def = this.program.screens[op.name];
          const scope = this.scope(s, base);
          const params = screenParams(def, op.args, scope);
          const init: Vars = { ...params, ...initialState(def, { ...scope, ...params }) };
          const view0 = this.view(op.name, { ...scope, ...init });
          if (!blocks(view0)) { s.vars[op.as] = ''; s.pc++; break; }
          const inout = def?.inout ?? [];
          // The screen's local state is explored as the initial state plus one change per toggle or radio (not their product);
          // a numeric inout stays at its initial value.
          const variants: Vars[] = [init];
          for (const p of pickables(view0)) {
            const set = p.enabled && (p.role === 'toggle' || p.role === 'radio') ? p.sets?.click : undefined;
            if (set && set[0] in init && init[set[0]] !== set[1]) variants.push({ ...init, [set[0]]: set[1] });
          }
          const seen = new Set<string>();
          const choices: Choice[] = [];
          const answer = (local: Vars, id: string, label: string) => {
            const kept = id === '' && def?.cancel && !def.cancelKeep ? init : local; // bare cancel drops the inout changes
            const key = JSON.stringify([id, inout.map(p => kept[p])]);
            if (seen.has(key)) return;
            seen.add(key);
            choices.push({ label, apply: t => {
              t.vars[op.as] = id;
              inout.forEach((p, i) => {
                const to = op.outs?.[i];
                if (!to) return;
                if (to.startsWith('persistent.')) t.persistent[to.slice('persistent.'.length)] = kept[p]; else t.vars[to] = kept[p];
              });
              t.pc = here + 1;
            } });
          };
          for (const local of variants) {
            const view = local === init ? view0 : this.view(op.name, { ...scope, ...local });
            const changed = inout.filter(p => local[p] !== init[p]).map(p => `${p}=${String(local[p])}`).join(', ');
            const tag = local === init ? '' : ` (${changed || 'state changed'})`;
            for (const p of enabledItems(view).filter(p => !p.act)) answer(local, p.id, `${op.name}: ${p.id}${tag}`);
            if (view.cancel) answer(local, '', `${op.name}: cancel${tag}`);
          }
          if (!choices.length) return { kind: 'stuck', at: here };
          return { kind: 'choice', at: here, key: this.key(s), choices };
        }
        case 'input':
          s.vars[op.name] = interpolate(op.default, this.scope(s, base));
          s.pc++;
          break;
        case 'set': {
          const scope = this.scope(s, base);
          const v = evalExpr(op.expr, scope, rng);
          const persist = op.name.startsWith('persistent.') ? op.name.slice('persistent.'.length) : null;
          const cur = (scope[op.name] ?? 0) as Value;
          const next: Value = op.assign === '=' ? v : arith(op.assign[0], cur, v);
          if (persist === null) s.vars[op.name] = next; else s.persistent[persist] = next;
          s.pc++;
          break;
        }
        case 'unlock':
          if (!s.unlocks.includes(op.name)) s.unlocks.push(op.name);
          s.pc++;
          break;
        case 'hud':
          if (op.mode === 'on') this.startHandlers(s, op.name, spawn);
          s.pc++;
          break;
        case 'branch':
          if (usesRandom(op.cond)) { // either outcome can happen: follow both
            const other = copy(s);
            other.pc = op.target;
            s.pc++;
            return { kind: 'fork', states: [s, other] };
          }
          s.pc = evalExpr(op.cond, this.scope(s, base), rng) ? s.pc + 1 : op.target;
          break;
        case 'goto':
          s.pc = op.target;
          if (s.entry !== null && op.src.line === 0) { s.pc = s.entry; s.entry = null; }
          break;
        case 'jump':
          s.pc = op.target >= 0 ? op.target : s.pc + 1;
          break;
        case 'call':
          if (op.target >= 0) {
            const names = this.program.params?.[op.label];
            let frame: Record<string, Value | null> | null = null;
            if (names?.length) {
              const scope = this.scope(s, base);
              const values = names.map((_, i) => (op.args?.[i] ? evalExpr(op.args[i], scope, rng) : 0));
              frame = {};
              names.forEach((n, i) => { frame![n] = n in s.vars ? s.vars[n] : null; s.vars[n] = values[i]; });
            }
            s.frames.push(frame);
            s.stack.push(s.pc + 1);
            s.pc = op.target;
          } else s.pc++;
          break;
        case 'ret': {
          if (!s.stack.length) return { kind: 'end', ending: { kind: 'return', src: op.src } };
          const back = s.stack.pop()!;
          const frame = s.frames.pop();
          if (frame) for (const [n, v] of Object.entries(frame)) { if (v === null) delete s.vars[n]; else s.vars[n] = v; }
          if (back === HUD_RETURN) return { kind: 'done', at: here };
          s.pc = back;
          break;
        }
        case 'end':
          return { kind: 'end', ending: { kind: 'end', src: op.src } };
        default: // lines and visual commands change nothing the story can see
          op satisfies FallThroughOp;
          s.pc++;
      }
    }
  }

  /** A screen put up as a HUD can call labels from its elements at any time: explore them from here. */
  private startHandlers(s: Sim, screen: string, spawn: (s: Sim) => void) {
    for (const label of hudLabels(this.program.screens[screen])) {
      const target = this.program.labels[label];
      const count = this.handlerRuns.get(label) ?? 0;
      if (target === undefined || count >= HANDLER_RUNS) continue;
      this.handlerRuns.set(label, count + 1);
      const h = copy(s);
      h.pc = target;
      h.stack = [HUD_RETURN];
      h.frames = [null];
      h.route = [...s.route, `hud ${screen}: ${label}`];
      spawn(h);
    }
  }

  private key(s: Sim): string {
    const { relevant, limits, ordered, counted, orderedAll, countedAll, live } = this.abs;
    const here = live[s.pc];
    const seen = (o: Record<string, Value>, prefix = '', alive?: Set<string>) => Object.keys(o).sort().filter(k => relevant.has(prefix + k) && (!alive || alive.has(k))).map(k => {
      const v = o[k], lim = limits.get(prefix + k);
      if (lim && typeof v === 'number') return [k, Math.min(lim.hi, Math.max(lim.lo, v))];
      if (!Array.isArray(v) || orderedAll || ordered.has(prefix + k)) return [k, v];
      return [k, countedAll || counted.has(prefix + k) ? [...v].sort() : [...new Set(v)].sort()];
    });
    return JSON.stringify([s.pc, s.stack, s.frames.map(f => (f ? seen(f as Record<string, Value>) : null)), seen(s.vars, '', here), [...s.unlocks].sort(), seen(s.persistent, 'persistent.'), s.entry]);
  }

  /** Explore everything reachable from `start`; `seen` is shared by the runs that share a seed and a base. */
  explore(start: Sim, base: Round, seen: Map<number, Set<string>>) {
    const queue: Sim[] = [start];
    const spawn = (s: Sim) => queue.push(s);
    for (let head = 0; head < queue.length; head++) {
      if (this.exhausted) return;
      const s = queue[head];
      queue[head] = undefined as unknown as Sim; // let the state go
      const stop = this.advance(s, base, spawn);
      switch (stop.kind) {
        case 'fork': queue.push(...stop.states); break;
        case 'loop': this.loops.set(`${this.program.ops[stop.at].src.file}:${this.program.ops[stop.at].src.line}`, this.program.ops[stop.at].src); break;
        case 'stuck': { const src = this.program.ops[stop.at].src; this.stuck.set(`${src.file}:${src.line}`, src); break; }
        case 'end': {
          const id = `${stop.ending.kind}:${stop.ending.src.file}:${stop.ending.src.line}`;
          if (!this.endings.has(id)) this.endings.set(id, { ...stop.ending, route: s.route, unlocks: [...s.unlocks] });
          for (const f of s.unlocks) this.unlocksSeen.add(f);
          Object.assign(this.persistentSeen, s.persistent);
          break;
        }
        case 'choice': {
          const known = seen.get(stop.at) ?? seen.set(stop.at, new Set()).get(stop.at)!;
          if (known.has(stop.key)) break;
          if (known.size >= this.o.maxPerChoice) { this.notes.add(`more than ${this.o.maxPerChoice} different situations at ${this.where(stop.at)}; the rest were skipped`); this.truncated = true; break; }
          if (this.choices >= this.o.maxStates) { this.exhausted = true; this.notes.add(`stopped after ${this.o.maxStates} choices`); return; }
          known.add(stop.key);
          this.choices++;
          for (const c of stop.choices) {
            const t = copy(s);
            c.apply(t);
            if (c.line !== undefined) this.taken.add(`${this.program.ops[stop.at].src.file}\0${c.line}`);
            t.route.push(c.label);
            queue.push(t);
          }
          break;
        }
      }
    }
  }
  truncated = false;
  private where(pc: number) { const src = this.program.ops[pc].src; return `${src.file}:${src.line}`; }
}

interface Round { unlocks: Set<string>; persistent: Record<string, Value> }

/** The labels game.json starts the story from besides `start`: `intro` and the `chapters`. */
function gameRoots(game: unknown, labels: Record<string, number>): string[] {
  const g = (game && typeof game === 'object' ? game : {}) as Record<string, unknown>;
  const out: unknown[] = [g.intro];
  if (Array.isArray(g.chapters)) for (const c of g.chapters) out.push(typeof c === 'string' ? c : (c as Record<string, unknown> | null)?.label);
  return [...new Set(out.filter((l): l is string => typeof l === 'string' && l in labels))];
}

/** Labels nothing refers to: not jumped or called, not a HUD handler, not in game.json. */
function entryLabels(program: Program, game: unknown): string[] {
  const named = strings(game);
  const used = new Set<number>();
  const starts = [...new Set(Object.values(program.labels))].sort((a, b) => a - b);
  const end = (t: number) => starts.find(x => x > t) ?? program.ops.length;
  program.ops.forEach((op, pc) => { // a label that only its own body refers to (a loop) is still an entry
    const mark = (t: number) => { if (!(pc >= t && pc < end(t))) used.add(t); };
    if (op.op === 'jump' || op.op === 'call') mark(op.target);
    else if (op.op === 'menu') { for (const o of op.options) mark(o.target); if (op.timeout) mark(op.timeout.target); }
  });
  const handlers = new Set(Object.values(program.screens ?? {}).flatMap(d => hudLabels(d)));
  return Object.entries(program.labels).filter(([name, pc]) => !used.has(pc) && !handlers.has(name) && !named.has(name)).map(([name]) => name);
}

const ROUNDS = 3; // playthroughs that carry flags and persistent data from the ones before

/** Play `program` every way it goes and report what it found. */
export function playtest(program: Program, opts: PlaytestOptions = {}): PlaytestReport {
  const o = { maxStates: opts.maxStates ?? 50000, maxSteps: opts.maxSteps ?? 5_000_000, maxPerChoice: opts.maxPerChoice ?? 500 };
  const bot = new Bot(program, o);
  const random = program.ops.some(op => (op.op === 'set' && usesRandom(op.expr)) || (op.op === 'branch' && usesRandom(op.cond)));
  const seeds = Math.max(1, random ? opts.seeds ?? 4 : 1);
  const named = [...(opts.roots ?? []), ...gameRoots(opts.game, program.labels), ...(opts.allLabels ? entryLabels(program, opts.game) : [])];
  const roots: (number | null)[] = [null, ...new Set(named.filter(l => l in program.labels).map(l => program.labels[l]))];

  // Flags and persistent data survive between playthroughs: play again with what the endings left behind until that stops growing.
  const base: Round = { unlocks: new Set(), persistent: {} };
  for (let round = 0; round < ROUNDS && !bot.exhausted; round++) {
    for (let seed = 1; seed <= seeds && !bot.exhausted; seed++) {
      const seen = new Map<number, Set<string>>();
      for (const entry of roots) {
        bot.explore({ pc: 0, stack: [], frames: [], vars: {}, unlocks: [], persistent: {}, rng: seed * 7919, entry, route: [] }, base, seen);
      }
    }
    const grown = [...bot.unlocksSeen].some(f => !base.unlocks.has(f)) || Object.keys(bot.persistentSeen).some(k => !(k in base.persistent));
    if (!grown) break;
    for (const f of bot.unlocksSeen) base.unlocks.add(f);
    Object.assign(base.persistent, bot.persistentSeen);
  }

  const complete = !bot.exhausted && !bot.truncated;

  // Lines: a line is unreachable when it has ops and none ran.
  const ranOn = new Set<string>(), hasOps = new Set<string>();
  program.ops.forEach((op, pc) => {
    if (op.op === 'menu') { // an option line counts as run when a route takes it
      for (const o of op.options) hasOps.add(`${op.src.file}\0${o.from}`);
      if (op.timeout) hasOps.add(`${op.src.file}\0${op.timeout.from}`);
    }
    if (op.src.line <= 0 || op.op === 'goto') return; // the gotos that close an option or branch belong to no line of their own
    hasOps.add(`${op.src.file}\0${op.src.line}`);
    if (bot.covered.has(pc)) ranOn.add(`${op.src.file}\0${op.src.line}`);
  });
  for (const k of bot.taken) ranOn.add(k);
  const dead = [...hasOps].filter(k => !ranOn.has(k)).map(k => { const [file, line] = k.split('\0'); return { file, line: Number(line) }; });
  dead.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
  const unreachableLines: LineRange[] = [];
  for (const d of dead) {
    const last = unreachableLines[unreachableLines.length - 1];
    if (last && last.file === d.file && d.line === last.to + 1) last.to = d.line;
    else unreachableLines.push({ file: d.file, from: d.line, to: d.line });
  }

  const starts = new Map<number, string[]>();
  for (const [name, pc] of Object.entries(program.labels)) starts.set(pc, [...(starts.get(pc) ?? []), name]);
  const unreachableLabels = Object.entries(program.labels)
    .filter(([, pc]) => pc < program.ops.length && !bot.covered.has(pc)).map(([name]) => name);

  const use = variableUse(program);
  const gameNames = strings(opts.game);
  const unusedVariables = [...use.writes].filter(([n]) => !n.startsWith('persistent.') && !use.reads.has(n)).map(([name, src]) => ({ name, src }));
  const unsetVariables = [...use.exprReads].filter(([n]) => !n.includes('.') && !use.writes.has(n)).map(([name, src]) => ({ name, src }));
  const unusedFlags = [...use.unlocks].filter(([n]) => !use.reads.has(`unlocked.${n}`) && !gameNames.has(n)).map(([name, src]) => ({ name, src }));

  return {
    complete, notes: [...bot.notes], choices: bot.choices, steps: bot.steps,
    endings: [...bot.endings.values()],
    unreachableLines, unreachableLabels,
    loops: [...bot.loops.values()], stuck: [...bot.stuck.values()],
    unusedVariables, unsetVariables, unusedFlags,
    unusedAssets: opts.assets ? unusedAssets(program, opts.assets, opts.game) : [],
  };
}

/** The report as editor problems: unreachable lines, loops and variables, anchored to the scripts. */
export function playtestDiagnostics(report: PlaytestReport): Diagnostic[] {
  const out: Diagnostic[] = [];
  const warn = (src: Src, message: string) => out.push({ file: src.file, line: src.line, severity: 'warning', message });
  const hedge = report.complete ? '' : ' (the playtest ran out of budget, so this may be wrong)';
  for (const r of report.unreachableLines) {
    warn({ file: r.file, line: r.from }, `${r.from === r.to ? 'This line' : `Lines ${r.from}-${r.to}`} can never run${hedge}`);
  }
  for (const src of report.loops) warn(src, 'The story can loop here forever without reaching a choice or an end');
  for (const src of report.stuck) warn(src, 'A screen waits here but offers nothing the player can pick');
  for (const v of report.unusedVariables) warn(v.src, `"${v.name}" is set but never read`);
  for (const f of report.unusedFlags) warn(f.src, `Nothing checks the flag "${f.name}" (unlocked.${f.name})`);
  return out;
}

/** The report as plain text (the CLI prints it, the editor shows it in the Output panel). */
export function playtestText(report: PlaytestReport, title = 'Playtest'): string {
  const out: string[] = [];
  const at = (s: Src) => `${s.file}:${s.line}`;
  const section = <T>(heading: string, items: T[], line: (i: T) => string) => {
    if (!items.length) return;
    out.push('', `${heading} (${items.length})`, ...items.map(i => `  ${line(i)}`));
  };
  out.push(`${title}: ${report.choices} choices explored, ${report.steps} steps${report.complete ? '' : ' (INCOMPLETE)'}`);
  for (const n of report.notes) out.push(`  note: ${n}`);
  section('Endings reached', report.endings, e => {
    const what = e.kind === 'end' ? 'end' : e.kind === 'return' ? 'return' : 'end of script';
    return `${what} at ${at(e.src)}  via ${e.route.length ? e.route.join(' > ') : '(no choices)'}${e.unlocks.length ? `  unlocks ${e.unlocks.join(', ')}` : ''}`;
  });
  section('Lines no route reaches', report.unreachableLines, r => `${r.file}:${r.from}${r.to > r.from ? `-${r.to}` : ''}`);
  section('Labels no route reaches', report.unreachableLabels, l => l);
  section('Possible endless loops', report.loops, at);
  section('Screens with nothing to pick', report.stuck, at);
  section('Variables set but never read', report.unusedVariables, v => `${v.name}  (${at(v.src)})`);
  section('Variables read but never set', report.unsetVariables, v => `${v.name}  (${at(v.src)})`);
  section('Flags nothing checks', report.unusedFlags, v => `${v.name}  (${at(v.src)})`);
  section('Unused assets', report.unusedAssets, f => f);
  return out.join('\n');
}
