import { collectVars, listArgs, usesRandom, type Expr } from './expr.js';
import { parseFile, type Node } from './parser.js';
import { ANCHORS, type Anchors } from './anchor.js';
import { BUILTIN_POSITIONS, type Positions } from './positions.js';
import { DEFAULT_STAGE, type StageSize } from './stage.js';
import { shellEntryFields, shellVars, validateScreen, type ScreenDef, type ScreenNode } from './screens.js';
import { withFix } from './suggest.js';
import { stackedShows } from './stacking.js';
import type { CharacterDef, Diagnostic, ItemDef, MenuOption, Op, OpBody, Program, Src } from './types.js';

export interface SourceFile { file: string; text: string }

/**
 * Compile one or more script files into a single flat program.
 * Layout: [top-level statements of every file] [goto entry] [label bodies...]
 * Entry is the label "start" if present, otherwise the first label.
 */
export function compile(files: SourceFile[], positions: Positions = BUILTIN_POSITIONS, anchors: Anchors = ANCHORS, stage: StageSize = DEFAULT_STAGE): Program {
  const diagnostics: Diagnostic[] = [];
  const parsed = files.map(f => parseFile(f.file, f.text, diagnostics, positions, anchors, stage));

  const characters: Record<string, CharacterDef> = {};
  for (const p of parsed) for (const c of p.characters) characters[c.id] = c;

  const items: Record<string, ItemDef> = {};
  const screens: Record<string, ScreenDef> = {};
  const ops: Op[] = [];
  const labels: Record<string, number> = {};
  const params: Record<string, string[]> = {};
  const strings: Record<string, string> = {};
  const assigned = new Set<string>();
  const unlocked = new Set<string>();
  const persisted = new Set<string>();
  const maybeList = new Set<string>(); // set to something that is not a plain number, string or boolean
  /** `local` is a loop variable of a screen's `each` (and its `.name`, `.image`, `.index`): not a story variable. */
  const exprs: { e: Expr; src: Src; local?: Set<string> }[] = [];
  const eachLists: { list: string; src: Src }[] = [];

  const diag = (src: Src, severity: 'error' | 'warning', message: string) =>
    diagnostics.push({ file: src.file, line: src.line, severity, message });

  const unknownChar = (src: Src, who: string) =>
    diagnostics.push(withFix(src, 'warning', `Unknown character "${who}"`, who, Object.keys(characters), ' (add a define line)'));

  const emit = (src: Src, body: OpBody): number => ops.push({ ...body, src } as Op) - 1;

  const registerString = (src: Src, id: string | null, text: string) => {
    if (!id) return;
    if (id in strings) diag(src, 'error', `Duplicate localization id #${id}`);
    else strings[id] = text;
  };

  function emitNodes(nodes: Node[]) {
    for (const n of nodes) {
      switch (n.k) {
        case 'op': {
          const b = n.body;
          if (b.op === 'say') {
            registerString(n.src, b.id, b.text);
            if (b.who && !(b.who in characters)) unknownChar(n.src, b.who);
          } else if (b.op === 'unlock') {
            unlocked.add(b.name);
          } else if (b.op === 'screen') {
            assigned.add(b.as);
          } else if (b.op === 'input') {
            assigned.add(b.name);
            registerString(n.src, b.id, b.prompt);
          } else if (b.op === 'set') {
            if (b.name.startsWith('persistent.')) persisted.add(b.name.slice('persistent.'.length));
            else assigned.add(b.name);
            if (b.assign === '=' ? !['num', 'str', 'bool'].includes(b.expr.t) : b.expr.t === 'list') maybeList.add(b.name);
            exprs.push({ e: b.expr, src: n.src });
          } else if (b.op === 'call') {
            for (const e of b.args ?? []) exprs.push({ e, src: n.src }); // random() is fine: arguments are evaluated once, at the call
          } else if ((b.op === 'show' || b.op === 'hide' || b.op === 'move' || b.op === 'hop' || b.op === 'animate') && !(b.char in characters)) {
            unknownChar(n.src, b.char);
          }
          if (b.op === 'show' && b.behind && !(b.behind in characters)) unknownChar(n.src, b.behind);
          emit(n.src, b);
          break;
        }
        case 'label':
          diag(n.src, 'error', 'Labels must be at the top level');
          break;
        case 'if': {
          const endJumps: number[] = [];
          for (const br of n.branches) {
            let skip = -1;
            if (br.cond) {
              exprs.push({ e: br.cond, src: br.src });
              skip = emit(br.src, { op: 'branch', cond: br.cond, target: -1 });
            }
            emitNodes(br.body);
            if (br !== n.branches[n.branches.length - 1]) endJumps.push(emit(br.src, { op: 'goto', target: -1 }));
            if (skip >= 0) (ops[skip] as { target: number }).target = ops.length;
          }
          for (const j of endJumps) (ops[j] as { target: number }).target = ops.length;
          break;
        }
        case 'menu': {
          const options: MenuOption[] = n.options.map(o => {
            if (o.cond) {
              exprs.push({ e: o.cond, src: o.src });
              if (usesRandom(o.cond)) diag(o.src, 'error', 'random(), pick() and chance() cannot be used in a menu option condition (set a variable first)');
            }
            registerString(o.src, o.id, o.text);
            if (o.reason !== null) registerString(o.src, o.reasonId, o.reason);
            return { text: o.text, id: o.id, cond: o.cond, reason: o.reason, reasonId: o.reasonId, target: -1, from: o.src.line, to: o.to };
          });
          if (n.prompt !== null) registerString(n.src, n.promptId, n.prompt);
          if (n.timeout) {
            exprs.push({ e: n.timeout.seconds, src: n.src }); // random() is fine: the seconds are evaluated once, when the menu is shown
            if (n.timeout.seconds.t === 'num' && n.timeout.seconds.v > 0 && n.timeout.seconds.v < 2) diag(n.src, 'warning', `A timeout of ${n.timeout.seconds.v} seconds is too short to read the choices`);
          }
          if (n.options.length === 0) diag(n.src, 'error', 'A menu needs at least one option');
          const timeout = n.timeout ? { seconds: n.timeout.seconds, target: -1, from: n.timeout.src.line, to: n.timeout.to } : null;
          const menuAt = emit(n.src, { op: 'menu', prompt: n.prompt, promptId: n.promptId, ...(n.look ? { look: n.look } : {}), options, timeout, end: -1 });
          const endJumps: number[] = [];
          n.options.forEach((o, idx) => {
            options[idx].target = ops.length;
            emitNodes(o.body);
            endJumps.push(emit(o.src, { op: 'goto', target: -1 }));
          });
          if (n.timeout && timeout) {
            timeout.target = ops.length;
            emitNodes(n.timeout.body);
            endJumps.push(emit(n.timeout.src, { op: 'goto', target: -1 }));
          }
          for (const j of endJumps) (ops[j] as { target: number }).target = ops.length;
          (ops[menuAt] as { end: number }).end = ops.length;
          break;
        }
      }
    }
  }

  for (const p of parsed) {
    for (const it of p.items) {
      if (it.id in items) diag(it.src, 'error', `Item "${it.id}" is defined twice`);
      items[it.id] = it;
      registerString(it.src, it.nameId, it.name);
    }
    for (const sc of p.screens) {
      if (sc.name in screens) diag(sc.src, 'error', `Screen "${sc.name}" is defined twice`);
      screens[sc.name] = sc;
      for (const pr of validateScreen(sc, stage)) diag(pr.src, pr.severity, pr.message);
      const fields = shellEntryFields(sc.name);
      const walk = (nodes: ScreenNode[], local: Set<string>) => {
        for (const n of nodes) {
          for (const e of [n.cond, n.kind === 'hotspot' || n.kind === 'button' ? n.enabled : null]) {
            if (!e) continue;
            exprs.push({ e, src: n.src, local });
            if (usesRandom(e)) diag(n.src, 'error', 'random(), pick() and chance() cannot be used in a screen condition (set a variable first)');
          }
          if (n.kind === 'hotspot' || n.kind === 'button') registerString(n.src, n.labelId, n.label);
          else if (n.kind === 'text') registerString(n.src, n.id, n.text);
          else if (n.kind === 'layout' || n.kind === 'scroll' || n.kind === 'panel') walk(n.body, local);
          else if (n.kind === 'bar') for (const e of [n.value, n.min, n.max]) exprs.push({ e, src: n.src, local });
          else if (n.kind === 'each') {
            if (!local.has(n.list)) eachLists.push({ list: n.list, src: n.src });
            walk(n.body, new Set([...local, n.as, `${n.as}.name`, `${n.as}.image`, `${n.as}.index`, ...fields.map(f => `${n.as}.${f}`)]));
          }
        }
      };
      // the shell fills these in on the options and saves screens: they are not story variables
      walk(sc.body, new Set(shellVars(sc.name)));
    }
  }

  // 1. top-level statements (setup code) in file order
  for (const p of parsed) emitNodes(p.nodes.filter(n => n.k !== 'label'));
  const gotoEntry = ops.push({ op: 'goto', target: -1, src: { file: files[0]?.file ?? '', line: 0 } }) - 1;

  // 2. label bodies
  let firstLabel = -1;
  for (const p of parsed) {
    for (const n of p.nodes) {
      if (n.k !== 'label') continue;
      if (n.name in labels) diag(n.src, 'error', `Label "${n.name}" is defined twice`);
      labels[n.name] = ops.length;
      if (n.params.length) params[n.name] = n.params;
      for (const p of n.params) { assigned.add(p); maybeList.add(p); } // bound by the call; may hold a list
      if (firstLabel < 0) firstLabel = ops.length;
      emitNodes(n.body);
    }
  }
  const entry = 'start' in labels ? labels['start'] : firstLabel;
  (ops[gotoEntry] as { target: number }).target = entry >= 0 ? entry : ops.length;
  if (entry < 0 && files.length) diag({ file: files[0].file, line: 1 }, 'warning', 'No labels found; nothing to play');

  // 3. resolve jumps/calls
  for (const op of ops) {
    if (op.op === 'jump' || op.op === 'call') {
      if (op.label in labels) op.target = labels[op.label];
      else diagnostics.push(withFix(op.src, 'error', `Unknown label "${op.label}"`, op.label, Object.keys(labels)));
      const want = params[op.label]?.length ?? 0;
      if (op.label in labels) {
        if (op.op === 'jump' && want) diag(op.src, 'warning', `"${op.label}" takes parameters (${params[op.label].join(', ')}); jump does not set them (use call)`);
        if (op.op === 'call' && (op.args?.length ?? 0) !== want) {
          diag(op.src, 'error', `"${op.label}" takes ${want} argument${want === 1 ? '' : 's'}${want ? ` (${params[op.label].join(', ')})` : ''}, but the call gives ${op.args?.length ?? 0}`);
        }
      }
    } else if (op.op === 'hud' && !(op.name in screens)) {
      diagnostics.push(withFix(op.src, 'error', `Unknown screen "${op.name}"`, op.name, Object.keys(screens), ` (declare it with "screen ${op.name}:")`));
    } else if (op.op === 'screen' && !(op.name in screens)) {
      diagnostics.push(withFix(op.src, 'error', `Unknown screen "${op.name}"`, op.name, Object.keys(screens), ` (declare it with "screen ${op.name}:")`));
    }
  }

  // A HUD element's event calls a label: it must exist.
  const checkHandlers = (nodes: ScreenNode[]) => {
    for (const n of nodes) {
      if (n.kind === 'each' || n.kind === 'layout' || n.kind === 'scroll' || n.kind === 'panel') checkHandlers(n.body);
      else if (n.kind === 'hotspot' || n.kind === 'button') {
        for (const [event, label] of Object.entries(n.on)) if (!(label in labels)) diagnostics.push(withFix(n.src, 'error', `Unknown label "${label}" (on ${event} of ${n.id})`, label, Object.keys(labels)));
      }
    }
  };
  for (const def of Object.values(screens)) checkHandlers(def.body);

  // Two characters on one spot because a `show` left out `at`.
  diagnostics.push(...stackedShows(ops, Object.keys(characters)));

  // 4. variable sanity check
  for (const { list, src } of eachLists) {
    if (!maybeList.has(list)) diag(src, 'warning', `"${list}" is used as a list but never set to one (add "set ${list} = []" somewhere)`);
  }
  for (const { e, src, local } of exprs) {
    for (const v of listArgs(e)) {
      if (!maybeList.has(v) && !local?.has(v)) diag(src, 'warning', `"${v}" is used as a list but never set to one (add "set ${v} = []" somewhere)`);
    }
    for (const v of collectVars(e)) {
      if (local?.has(v)) continue;
      const flag = /^unlocked\.(\w+)$/.exec(v);
      if (flag) {
        if (!unlocked.has(flag[1])) diag(src, 'warning', `Nothing unlocks "${flag[1]}" (add "unlock ${flag[1]}" somewhere)`);
      } else if (v.startsWith('persistent.')) {
        if (!persisted.has(v.slice('persistent.'.length))) diag(src, 'warning', `Persistent value "${v}" is never written (add "set ${v} = ..." somewhere; reads as 0)`);
      } else if (v.includes('.')) {
        diag(src, 'error', `Unknown name "${v}" (only unlocked.<flag> and persistent.<name> have a dot)`);
      } else if (!assigned.has(v)) {
        diag(src, 'warning', `Variable "${v}" is never assigned (reads as 0)`);
      }
    }
  }

  return { ops, labels, params, characters, items, screens, strings, diagnostics, positions, anchors, stage: { ...stage } };
}
