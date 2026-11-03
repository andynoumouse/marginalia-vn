// Characters stacked on one spot: a `show` without `at` puts a newcomer at center, so a second character arriving that way
// lands on top of whoever already stands there. This pass follows the stage through the compiled ops and warns when it
// happens on every path that reaches the line. Pure; compile() calls it once jumps are resolved.
//
// What is tracked per pc: where characters certainly stand (`at`) and who is certainly off stage (`absent`). Paths meet by
// keeping only what both agree on, so the check stays quiet whenever it cannot be sure. A `call` may change the stage, so
// nothing is known after it returns; HUD handlers that show characters are not followed.

import type { Diagnostic, Op } from './types.js';

interface Stage { at: Map<string, number>; absent: Set<string> }

const CENTER = 0.5; // where runtime puts a character shown without `at`

const meet = (a: Stage, b: Stage): Stage => ({
  at: new Map([...a.at].filter(([c, x]) => b.at.get(c) === x)),
  absent: new Set([...a.absent].filter(c => b.absent.has(c))),
});

const same = (a: Stage, b: Stage): boolean =>
  a.at.size === b.at.size && a.absent.size === b.absent.size &&
  [...a.at].every(([c, x]) => b.at.get(c) === x) && [...a.absent].every(c => b.absent.has(c));

/** Where control can go after `ops[pc]`. */
function successors(ops: Op[], pc: number): number[] {
  const op = ops[pc];
  switch (op.op) {
    case 'goto': case 'jump': return [op.target];
    case 'branch': return [pc + 1, op.target];
    case 'menu': return [...op.options.map(o => o.target), ...(op.timeout ? [op.timeout.target] : []), op.end];
    case 'ret': case 'end': return [];
    default: return [pc + 1];
  }
}

/** The stage after `op`; `warn` hears about a character shown without `at` onto someone else's spot. */
function step(op: Op, s: Stage, everyone: Set<string>, warn?: (char: string, under: string) => void): Stage {
  switch (op.op) {
    case 'scene': return { at: new Map(), absent: new Set(everyone) };
    case 'call': return { at: new Map(), absent: new Set() };
    case 'show': {
      const at = new Map(s.at), absent = new Set(s.absent);
      if (absent.has(op.char)) {
        const x = op.x ?? CENTER;
        if (op.x === null && !op.order && !op.behind && warn) {
          const under = [...at].find(([c, cx]) => c !== op.char && cx === x)?.[0];
          if (under) warn(op.char, under);
        }
        at.set(op.char, x);
      } else if (op.x !== null) at.set(op.char, op.x);
      absent.delete(op.char);
      return { at, absent };
    }
    case 'hide': {
      const at = new Map(s.at), absent = new Set(s.absent);
      at.delete(op.char);
      absent.add(op.char);
      return { at, absent };
    }
    case 'move': {
      if (op.x === null || s.absent.has(op.char) || !s.at.has(op.char)) return s;
      return { at: new Map(s.at).set(op.char, op.x), absent: s.absent };
    }
    default: return s;
  }
}

/** Warnings for characters shown without `at` onto a spot another character certainly stands on. */
export function stackedShows(ops: Op[], characters: Iterable<string>): Diagnostic[] {
  const everyone = new Set(characters);
  for (const op of ops) if (op.op === 'show') everyone.add(op.char);

  // A pc nothing leads to (the program start, a scene entered with Preview from cursor) starts on an empty stage.
  const reached = new Set<number>();
  for (let pc = 0; pc < ops.length; pc++) {
    for (const n of successors(ops, pc)) reached.add(n);
    if (ops[pc].op === 'call') reached.add((ops[pc] as { target: number }).target);
  }
  const before: (Stage | undefined)[] = new Array(ops.length);
  const work: number[] = [];
  const reach = (pc: number, s: Stage) => {
    if (pc < 0 || pc >= ops.length) return;
    const old = before[pc];
    const next = old ? meet(old, s) : s;
    if (old && same(old, next)) return;
    before[pc] = next;
    work.push(pc);
  };
  for (let pc = 0; pc < ops.length; pc++) if (!reached.has(pc)) reach(pc, { at: new Map(), absent: new Set(everyone) });

  while (work.length) {
    const pc = work.pop()!;
    const op = ops[pc];
    const after = step(op, before[pc]!, everyone);
    for (const n of successors(ops, pc)) reach(n, after);
    if (op.op === 'call') reach(op.target, before[pc]!);
  }

  const out: Diagnostic[] = [];
  ops.forEach((op, pc) => {
    if (op.op !== 'show' || !before[pc]) return;
    step(op, before[pc]!, everyone, (char, under) => out.push({
      file: op.src.file, line: op.src.line, severity: 'warning',
      message: `"${char}" is shown without "at", so they stand at center on top of "${under}" (give one of them "at", or use behind=/order= if the overlap is meant)`,
    }));
  });
  return out;
}
