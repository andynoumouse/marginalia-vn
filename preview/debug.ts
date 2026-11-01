// The debug drawer of the dev preview: a console for the running story (variables, jumps, flags) and for what persists
// across playthroughs. The grammar lives in engine/src/debug.ts; this file runs the commands and draws the panel.

import { DEBUG_HELP, evalExpr, formatDebugValue, parseDebugCommand, parseExpr, type DebugCommand, type ResetTarget, type Runtime, type Value } from '../engine/src/index.js';
import { deleteAllSaves, type PersistentSet, type PersistentValues, type SeenLines } from './saves.js';

export interface DebugContext {
  runtime(): Runtime | null;
  /** Starts a new playthrough at a label (a known one). */
  jump(label: string): void;
  sets: Record<'gallery' | 'music' | 'chapters' | 'flags' | 'options', PersistentSet>;
  persistent: PersistentValues;
  seen: SeenLines;
}

type Line = { text: string; kind: 'in' | 'out' | 'err' };

const RESET_LABEL: Record<ResetTarget, string> = {
  gallery: 'gallery images', music: 'heard tracks', chapters: 'reached chapters', flags: 'unlock flags',
  options: 'taken options', persistent: 'persistent values', seen: 'read lines', saves: 'saves',
};

/** Runs one parsed command; returns the lines it prints (null: clear the log). */
export function runDebugCommand(cmd: DebugCommand, ctx: DebugContext): Line[] | null {
  const out = (text: string): Line => ({ text, kind: 'out' });
  const err = (text: string): Line => ({ text, kind: 'err' });
  const rt = ctx.runtime();
  const scope = (): Record<string, Value> => {
    const s: Record<string, Value> = { ...rt?.vars };
    for (const [k, v] of Object.entries({ ...ctx.persistent.values(), ...rt?.persistent })) s[`persistent.${k}`] = v;
    for (const f of ctx.sets.flags.values()) s[`unlocked.${f}`] = true;
    return s;
  };
  const table = (entries: [string, Value][], none: string) =>
    entries.length ? entries.map(([k, v]) => out(`${k} = ${formatDebugValue(v)}`)) : [out(none)];

  switch (cmd.cmd) {
    case 'error': return [err(cmd.message)];
    case 'clear': return null;
    case 'help': return DEBUG_HELP.map(out);
    case 'vars':
      if (!rt) return [err('No story is loaded.')];
      return table(Object.entries(rt.vars).sort(([a], [b]) => a.localeCompare(b)), 'No variables yet (start the story first).');
    case 'labels':
      return rt ? [out(Object.keys(rt.program.labels).join('  ') || 'No labels.')] : [err('No story is loaded.')];
    case 'flags': return [out(ctx.sets.flags.values().join('  ') || 'No flags unlocked.')];
    case 'persistent': return table(Object.entries(ctx.persistent.values()), 'No persistent values.');
    case 'eval':
      try { return [out(formatDebugValue(evalExpr(parseExpr(cmd.expr), scope())))]; } catch (e) { return [err(String((e as Error).message ?? e))]; }
    case 'set': {
      if (!rt) return [err('No story is loaded.')];
      let value: Value;
      try { value = evalExpr(parseExpr(cmd.expr), scope()); } catch (e) { return [err(String((e as Error).message ?? e))]; }
      if (cmd.name.startsWith('persistent.')) {
        const name = cmd.name.slice('persistent.'.length);
        ctx.persistent.set(name, value);
        rt.persistent[name] = value;
      } else if (cmd.name.includes('.')) {
        return [err(`Only persistent.<name> can be set with a dot; "${cmd.name}" cannot.`)];
      } else {
        rt.vars[cmd.name] = value;
      }
      return [out(`${cmd.name} = ${formatDebugValue(value)}`)];
    }
    case 'jump':
      if (!rt) return [err('No story is loaded.')];
      if (!(cmd.label in rt.program.labels)) return [err(`No label "${cmd.label}". Type labels for the list.`)];
      ctx.jump(cmd.label);
      return [out(`New playthrough at ${cmd.label}.`)];
    case 'unlock': ctx.sets.flags.add(cmd.flag); return [out(`Unlocked ${cmd.flag}. (A playthrough already running keeps the flags it began with.)`)];
    case 'lock': ctx.sets.flags.remove(cmd.flag); return [out(`Locked ${cmd.flag}.`)];
    case 'reset': {
      const done: string[] = [];
      for (const t of cmd.targets) {
        if (t === 'saves') done.push(`${deleteAllSaves()} saves`);
        else {
          (t === 'persistent' ? ctx.persistent : t === 'seen' ? ctx.seen : ctx.sets[t]).clear();
          done.push(RESET_LABEL[t]);
        }
      }
      return [out(`Cleared ${done.join(', ')}.`)];
    }
  }
}

/** Wires the drawer: `button` toggles `panel`; the panel fills itself with a log, an input and quick buttons. */
export function initDebug(button: HTMLElement, panel: HTMLElement, ctx: DebugContext) {
  const log = document.createElement('div'); log.className = 'log'; log.setAttribute('role', 'log');
  const form = document.createElement('form');
  const input = document.createElement('input');
  input.type = 'text'; input.autocomplete = 'off'; input.spellcheck = false; input.placeholder = 'help'; input.setAttribute('aria-label', 'Debug command');
  form.append(input);
  const quick = document.createElement('div'); quick.className = 'quick';
  const h = document.createElement('h2'); h.textContent = 'Debug';

  const lines: Line[] = [];
  const history: string[] = [];
  let at = 0;
  const print = (more: Line[]) => {
    lines.push(...more);
    log.replaceChildren(...lines.map(l => { const d = document.createElement('div'); d.className = l.kind; d.textContent = (l.kind === 'in' ? '> ' : '') + l.text; return d; }));
    log.scrollTop = log.scrollHeight;
  };
  const run = (text: string) => {
    const cmd = parseDebugCommand(text);
    if (!cmd) return;
    print([{ text, kind: 'in' }]);
    const result = runDebugCommand(cmd, ctx);
    if (result === null) { lines.length = 0; print([]); } else print(result);
  };
  for (const [label, command] of [['Variables', 'vars'], ['Reset progress', 'reset progress'], ['Reset everything', 'reset all']] as const) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
    b.addEventListener('click', () => { run(command); input.focus(); });
    quick.append(b);
  }
  panel.append(h, quick, log, form);
  print([{ text: 'Type help for the commands.', kind: 'out' }]);

  form.addEventListener('submit', e => {
    e.preventDefault();
    const text = input.value.trim();
    input.value = '';
    if (!text) return;
    if (history[history.length - 1] !== text) history.push(text);
    at = history.length;
    run(text);
  });
  // The story's own keys (Space, arrows, hotkeys) must not fire while typing here.
  panel.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Escape') { panel.dataset.visible = 'false'; return; }
    if (e.target !== input || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    at = Math.min(history.length, Math.max(0, at + (e.key === 'ArrowUp' ? -1 : 1)));
    input.value = history[at] ?? '';
  });
  button.addEventListener('click', () => {
    const open = panel.dataset.visible !== 'true';
    panel.dataset.visible = String(open);
    if (open) input.focus();
  });
}
