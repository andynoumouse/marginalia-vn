// What makes two playtest states the same: which variables matter, and how finely (see Abstraction).

import { collectVars, type Expr } from './expr.js';
import { hudLabels, isClickable, walkNodes, type ScreenNode } from './screens.js';
import type { FallThroughOp, Op, Program } from './types.js';

/**
 * Which variables decide what the story does, and how finely. Counters that keep growing (`set clue += 1` in a loop)
 * would make the search endless, so a number that is only ever compared with fixed numbers counts as the same once it is
 * beyond all of them (or below all of them); a variable no condition can see, or that is overwritten before anything
 * reads it again, is left out of the state; lists are compared as sets unless the story picks elements by position.
 */
export interface Abstraction {
  relevant: Set<string>;
  /** Numbers each variable is compared with; absent when it is also used in some other way (then it is exact). */
  limits: Map<string, { lo: number; hi: number }>;
  /** Lists are compared as sets, except these: in order (read by position) or with repeats (counted). `*All`: a list not
   *  named at the call, so every list is treated that way. */
  ordered: Set<string>;
  counted: Set<string>;
  orderedAll: boolean;
  countedAll: boolean;
  /** Per op, the relevant variables that may still be read before they are written again; the rest is left out of the state. */
  live: Set<string>[];
}

/** Every variable an expression (or an op or screen holding expressions) reads, and the lists a screen walks with `each`. */
function readVars(x: unknown, out: Set<string>) {
  if (!x || typeof x !== 'object') return;
  if (Array.isArray(x)) { for (const y of x) readVars(y, out); return; }
  const o = x as Record<string, unknown>;
  if (o.t === 'var' && typeof o.name === 'string') out.add(o.name);
  if (o.kind === 'each' && typeof o.list === 'string') out.add(o.list);
  for (const v of Object.values(o)) readVars(v, out);
}

/**
 * Backward dataflow over the ops: a variable is live at an op when some path from there reads it before a plain `set`,
 * a screen's answer or an `input` writes it again. Conservative where it is cheap to be: a `ret` may go back to any call,
 * and what a HUD handler reads is live everywhere (it can start at any time).
 */
function liveness(program: Program, relevant: Set<string>): Set<string>[] {
  const { ops } = program;
  const n = ops.length;
  const use: Set<string>[] = [];
  const kill: (string | null)[] = [];
  const screenReads = new Map<string, Set<string>>();
  for (const op of ops) {
    const u = new Set<string>();
    let k: string | null = null;
    if (op.op === 'screen') {
      readVars(op.args, u);
      let r = screenReads.get(op.name);
      if (!r) { r = new Set(); readVars(program.screens?.[op.name], r); screenReads.set(op.name, r); }
      for (const v of r) u.add(v);
      k = op.as;
    } else if (op.op === 'set') {
      readVars(op.expr, u);
      if (op.assign === '=') k = op.name; else u.add(op.name);
    } else if (op.op === 'input') k = op.name;
    else readVars(op, u);
    use.push(new Set([...u].filter(v => relevant.has(v))));
    kill.push(k);
  }
  const returns = ops.flatMap((op, pc) => (op.op === 'call' ? [pc + 1] : []));
  const succ = (pc: number): number[] => {
    const op = ops[pc];
    switch (op.op) {
      case 'jump': case 'goto': return [op.target];
      case 'branch': return [pc + 1, op.target];
      case 'menu': return [pc + 1, op.end, ...op.options.map(o => o.target), ...(op.timeout ? [op.timeout.target] : [])];
      case 'call': return [op.target, pc + 1];
      case 'ret': return returns;
      case 'end': return [];
      default: op satisfies FallThroughOp; return [pc + 1];
    }
  };
  const handlers = [...new Set(Object.values(program.screens ?? {}).flatMap(d => hudLabels(d)))].map(l => program.labels[l]).filter(pc => pc !== undefined);
  const live: Set<string>[] = ops.map(() => new Set<string>());
  const everywhere = new Set<string>();
  for (let outer = true; outer;) {
    outer = false;
    for (let changed = true; changed;) {
      changed = false;
      for (let pc = n - 1; pc >= 0; pc--) {
        const cur = live[pc];
        const before = cur.size;
        for (const v of use[pc]) cur.add(v);
        for (const v of everywhere) cur.add(v);
        for (const t of succ(pc)) {
          if (t < 0 || t >= n) continue;
          for (const v of live[t]) if (v !== kill[pc]) cur.add(v);
        }
        if (cur.size !== before) changed = true;
      }
    }
    for (const pc of handlers) for (const v of live[pc]) if (!everywhere.has(v)) { everywhere.add(v); outer = true; }
  }
  return live;
}

/** Steps past the compared-with numbers that stay distinct, so `-= 2` or `+= 3` loops still come back into range. */
const MARGIN = 5;

const COMPARE = new Set(['<', '<=', '>', '>=', '==', '!=']);

export function abstraction(program: Program): Abstraction {
  const conds: Expr[] = [];
  const lists = new Set<string>();
  for (const op of program.ops) {
    if (op.op === 'branch') conds.push(op.cond);
    else if (op.op === 'menu') for (const o of op.options) if (o.cond) conds.push(o.cond);
  }
  const visit = (n: ScreenNode) => {
    if (n.cond) conds.push(n.cond);
    if (isClickable(n) && n.enabled) conds.push(n.enabled);
    if (n.kind === 'each') lists.add(n.list);
    if (n.kind === 'bar') conds.push(n.value, n.min, n.max);
  };
  for (const def of Object.values(program.screens ?? {})) walkNodes(def.body, visit);

  const relevant = new Set<string>(lists);
  const exact = new Set<string>();
  const bounds = new Map<string, number[]>();
  const ordered = new Set<string>(), counted = new Set<string>();
  let orderedAll = false, countedAll = false;
  const bound = (name: string, n: number) => { relevant.add(name); (bounds.get(name) ?? bounds.set(name, []).get(name)!).push(n); };
  const scan = (e: Expr) => {
    switch (e.t) {
      case 'bin':
        if (COMPARE.has(e.op) && e.l.t === 'var' && e.r.t === 'num') bound(e.l.name, e.r.v);
        else if (COMPARE.has(e.op) && e.r.t === 'var' && e.l.t === 'num') bound(e.r.name, e.l.v);
        else { scan(e.l); scan(e.r); }
        return;
      case 'var': relevant.add(e.name); exact.add(e.name); return;
      case 'un': scan(e.e); return;
      case 'call':
        if (e.name === 'item' || e.name === 'index' || e.name === 'count') {
          const first = e.args[0];
          const by = e.name === 'count' ? counted : ordered;
          if (first?.t === 'var') by.add(first.name);
          else if (e.name === 'count') countedAll = true;
          else orderedAll = true;
        }
        e.args.forEach(scan);
        return;
      case 'list': e.items.forEach(scan); return;
    }
  };
  conds.forEach(scan);
  // What feeds a variable that matters matters too (and is exact: `set total = a + b`).
  const sets = program.ops.filter((op): op is Extract<Op, { op: 'set' }> => op.op === 'set');
  // A call's arguments feed the label's parameters like a `set`.
  const calls = program.ops.filter((op): op is Extract<Op, { op: 'call' }> => op.op === 'call' && !!op.args);
  for (let changed = true; changed;) {
    changed = false;
    for (const op of sets) {
      if (!relevant.has(op.name)) continue;
      for (const v of collectVars(op.expr)) {
        if (!relevant.has(v) || !exact.has(v)) { relevant.add(v); exact.add(v); changed = true; }
        // a copy keeps the order (and repeats) its source had to keep
        if (ordered.has(op.name) && !ordered.has(v)) { ordered.add(v); changed = true; }
        if (counted.has(op.name) && !counted.has(v)) { counted.add(v); changed = true; }
      }
    }
    for (const op of calls) {
      (program.params?.[op.label] ?? []).forEach((name, i) => {
        const arg = op.args![i];
        if (!arg || !relevant.has(name)) return;
        for (const v of collectVars(arg)) if (!relevant.has(v) || !exact.has(v)) { relevant.add(v); exact.add(v); changed = true; }
      });
    }
  }
  const limits = new Map<string, { lo: number; hi: number }>();
  for (const [name, nums] of bounds) if (!exact.has(name)) limits.set(name, { lo: Math.min(...nums) - 1 - MARGIN, hi: Math.max(...nums) + 1 + MARGIN });
  return { relevant, limits, ordered, counted, orderedAll, countedAll, live: liveness(program, relevant) };
}
