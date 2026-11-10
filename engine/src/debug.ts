// Commands of the preview's debug console (preview/debug.ts runs them). Pure, so the grammar is testable in node.

import { ExprError, parseExpr, type Value } from './expr.js';

/** What `reset` can clear: the things that persist across playthroughs, plus the saves. */
export const RESET_TARGETS = ['gallery', 'music', 'chapters', 'flags', 'options', 'persistent', 'seen', 'saves'] as const;
export type ResetTarget = typeof RESET_TARGETS[number];
/** `reset progress` clears everything the player earns; `reset all` also deletes the saves. */
const RESET_GROUPS: Record<string, readonly ResetTarget[]> = {
  progress: RESET_TARGETS.filter(t => t !== 'saves'),
  all: RESET_TARGETS,
};

export type DebugCommand =
  | { cmd: 'help' | 'clear' | 'vars' | 'labels' | 'flags' | 'persistent' | 'memory' }
  | { cmd: 'set'; name: string; expr: string }
  | { cmd: 'jump'; label: string }
  | { cmd: 'unlock' | 'lock'; flag: string }
  | { cmd: 'reset'; targets: ResetTarget[] }
  | { cmd: 'eval'; expr: string }
  | { cmd: 'error'; message: string };

export const DEBUG_HELP = [
  'vars                    variables of the running story',
  'set <name> = <expr>     change a variable now (persistent.<name> works too)',
  '<expr>                  evaluate an expression, e.g. trust + 1',
  'jump <label>            start a new playthrough at a label',
  'labels                  every label',
  'flags                   unlock flags',
  'unlock <flag> / lock <flag>',
  'persistent              persistent values',
  'memory                  loaded images and audio against the memory budget',
  `reset <${RESET_TARGETS.join('|')}|progress|all>   clear what persists (progress = all but saves)`,
  'clear                   empty this log',
];

const NAME = /^[\p{L}_][\p{L}\p{N}\p{M}_]*(\.[\p{L}_][\p{L}\p{N}\p{M}_]*)?$/u; // a variable in any alphabet (names.ts)
const FLAG = /^[A-Za-z_][\w.-]*$/;
const NO_ARGS = new Set(['help', 'clear', 'vars', 'labels', 'flags', 'persistent', 'memory']);

function checkExpr(src: string): string | null {
  try { parseExpr(src); return null; } catch (e) { return e instanceof ExprError ? e.message : String(e); }
}

export function parseDebugCommand(line: string): DebugCommand | null {
  const text = line.trim();
  if (!text) return null;
  const [word, ...rest] = text.split(/\s+/);
  const arg = rest.join(' ');
  const error = (message: string): DebugCommand => ({ cmd: 'error', message });

  if (NO_ARGS.has(word)) return arg ? error(`"${word}" takes no arguments`) : { cmd: word as 'help' };
  if (word === 'set') {
    const m = /^(\S+?)\s*=\s*(.+)$/.exec(arg);
    if (!m) return error('Use: set <name> = <expr>');
    if (!NAME.test(m[1])) return error(`"${m[1]}" is not a variable name`);
    const bad = checkExpr(m[2]);
    return bad ? error(bad) : { cmd: 'set', name: m[1], expr: m[2] };
  }
  if (word === 'jump') return /^\S+$/.test(arg) ? { cmd: 'jump', label: arg } : error('Use: jump <label>');
  if (word === 'unlock' || word === 'lock') return FLAG.test(arg) ? { cmd: word, flag: arg } : error(`Use: ${word} <flag>`);
  if (word === 'reset') {
    const names = rest.length ? rest : [''];
    const targets = new Set<ResetTarget>();
    for (const n of names) {
      const group = RESET_GROUPS[n];
      if (group) { for (const t of group) targets.add(t); continue; }
      if (!(RESET_TARGETS as readonly string[]).includes(n)) return error(`Use: reset <${RESET_TARGETS.join('|')}|progress|all>`);
      targets.add(n as ResetTarget);
    }
    return { cmd: 'reset', targets: RESET_TARGETS.filter(t => targets.has(t)) };
  }
  const bad = checkExpr(text);
  return bad ? error(`Unknown command "${word}", and not an expression (${bad}). Type help.`) : { cmd: 'eval', expr: text };
}

/** A value as the console prints it: strings quoted, lists in brackets. */
export function formatDebugValue(v: Value): string {
  return Array.isArray(v) ? `[${v.map(formatDebugValue).join(', ')}]` : typeof v === 'string' ? JSON.stringify(v) : String(v);
}
