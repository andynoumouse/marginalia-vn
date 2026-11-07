import type { Program } from './types.js';

/**
 * Whether the label only changes state: every path from it reaches `return` through set, unlock, hud, if and goto ops,
 * with no line, menu, effect, jump or call. Such a HUD handler runs on the spot, without ending the line on screen.
 */
export function isQuietLabel({ ops, labels }: Pick<Program, 'ops' | 'labels'>, label: string): boolean {
  const seen = new Set<number>();
  const todo: number[] = [labels[label]];
  while (todo.length) {
    const pc = todo.pop()!;
    if (seen.has(pc)) continue;
    seen.add(pc);
    const op = ops[pc];
    if (!op) return false;
    if (op.op === 'ret') continue;
    if (op.op === 'set' || op.op === 'unlock' || op.op === 'hud') todo.push(pc + 1);
    else if (op.op === 'branch') todo.push(pc + 1, op.target);
    else if (op.op === 'goto') todo.push(op.target);
    else return false;
  }
  return true;
}
