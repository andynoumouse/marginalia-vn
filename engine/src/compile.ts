import { collectVars, listArgs, parseExpr, usesRandom, type Expr } from './expr.js';
import { parseFile, type Node, type ParsedFile } from './parser.js';
import { ANIM_NAMES, type AnimDef } from './anim.js';
import { buildChoreography, checkTransform, isDynamic, transformToAnim, type TransformDef } from './transform.js';
import { ANCHORS, type Anchors } from './anchor.js';
import { BUILTIN_POSITIONS, type Positions } from './positions.js';
import { DEFAULT_STAGE, type StageSize } from './stage.js';
import { isClickable, shellEntryFields, shellVars, validateScreen, type ScreenDef, type ScreenNode } from './screens.js';
import { withFix } from './suggest.js';
import { defaultScreenFiles } from './ui-screens.js';
import { stackedShows } from './stacking.js';
import { asPc, CAMERA_TARGET, UNRESOLVED, type CharacterDef, type Diagnostic, type ItemDef, type MenuOption, type Op, type OpBody, type Pc, type Program, type Src } from './types.js';

export interface SourceFile { file: string; text: string }

class Compiler {
  private diagnostics: Diagnostic[] = [];
  private parsed: ParsedFile[];
  private characters: Record<string, CharacterDef> = {};
  private items: Record<string, ItemDef> = {};
  private screens: Record<string, ScreenDef> = {};
  private ops: Op[] = [];
  private labels: Record<string, Pc> = {};
  private params: Record<string, string[]> = {};
  private strings: Record<string, string> = {};
  private assigned = new Set<string>();
  private unlocked = new Set<string>();
  private persisted = new Set<string>();
  private maybeList = new Set<string>(); // set to something that is not a plain number, string or boolean
  /** `local` is a loop variable of a screen's `each` (and its `.name`, `.image`, `.index`): not a story variable. */
  private exprs: { e: Expr; src: Src; local?: Set<string> }[] = [];
  private stateDecls: { name: string; src: Src }[] = [];
  private eachLists: { list: string; src: Src }[] = [];
  private transforms: Record<string, AnimDef> = {};
  /** `choreography` blocks: who plays which generated transform, and the lines' targets to check once the pictures are known. */
  private choreographies: Record<string, { target: string; transform: string }[]> = {};
  private choreoTargets: { target: string; src: Src }[] = [];
  private dynamicTransforms: Record<string, TransformDef> = {}; // worked out when `animate` runs (parameters, variables, if, pick)
  private foreverTransforms = new Set<string>(); // `repeat` with no count: `animate` loops them without the word loop

  constructor(private files: SourceFile[], private positions: Positions, private anchors: Anchors, private stage: StageSize) {
    this.parsed = [...files, ...defaultScreenFiles(files, stage)].map(f => parseFile(f.file, f.text, this.diagnostics, positions, anchors, stage));
    for (const p of this.parsed) for (const c of p.characters) this.characters[c.id] = c;
  }

  private diag(src: Src, severity: 'error' | 'warning', message: string) {
    this.diagnostics.push({ file: src.file, line: src.line, severity, message });
  }

  private unknownChar(src: Src, who: string) {
    this.diagnostics.push(withFix(src, 'warning', `Unknown character "${who}"`, who, Object.keys(this.characters), ' (add a define line)'));
  }

  private here(): Pc { return asPc(this.ops.length); } // the pc of the next op to be emitted
  private emit(src: Src, body: OpBody): Pc { return asPc(this.ops.push({ ...body, src } as Op) - 1); }

  private registerString(src: Src, id: string | null, text: string) {
    if (!id) return;
    if (id in this.strings) this.diag(src, 'error', `Duplicate localization id #${id}`);
    else this.strings[id] = text;
  }


  private emitNodes(nodes: Node[]) {
    for (const n of nodes) {
      switch (n.k) {
        case 'op': {
          const b = n.body;
          if (b.op === 'say') {
            this.registerString(n.src, b.id, b.text);
            if (b.who && !(b.who in this.characters)) this.unknownChar(n.src, b.who);
          } else if (b.op === 'unlock') {
            this.unlocked.add(b.name);
          } else if (b.op === 'screen') {
            this.assigned.add(b.as);
            for (const e of b.args ?? []) {
              this.exprs.push({ e, src: n.src });
              if (usesRandom(e)) this.diag(n.src, 'error', 'random(), pick() and chance() cannot be used in a screen argument (set a variable first)');
            }
          } else if (b.op === 'input') {
            this.assigned.add(b.name);
            this.registerString(n.src, b.id, b.prompt);
          } else if (b.op === 'set') {
            if (b.name.startsWith('persistent.')) this.persisted.add(b.name.slice('persistent.'.length));
            else this.assigned.add(b.name);
            if (b.assign === '=' ? !['num', 'str', 'bool'].includes(b.expr.t) : b.expr.t === 'list') this.maybeList.add(b.name);
            this.exprs.push({ e: b.expr, src: n.src });
          } else if (b.op === 'call') {
            for (const e of b.args ?? []) this.exprs.push({ e, src: n.src }); // random() is fine: arguments are evaluated once, at the call
          } else if ((b.op === 'show' || b.op === 'hide' || b.op === 'move' || b.op === 'hop' || b.op === 'param') && !(b.char in this.characters)) {
            this.unknownChar(n.src, b.char);
          }
          if (b.op === 'burst' && b.char !== undefined && !(b.char in this.characters)) this.unknownChar(n.src, b.char);
          if (b.op === 'show' && b.behind && !(b.behind in this.characters)) this.unknownChar(n.src, b.behind);
          this.emit(n.src, b);
          break;
        }
        case 'label':
          this.diag(n.src, 'error', 'Labels must be at the top level');
          break;
        case 'if': {
          const endJumps: Pc[] = [];
          for (const br of n.branches) {
            let skip = -1;
            if (br.cond) {
              this.exprs.push({ e: br.cond, src: br.src });
              skip = this.emit(br.src, { op: 'branch', cond: br.cond, target: UNRESOLVED });
            }
            this.emitNodes(br.body);
            if (br !== n.branches[n.branches.length - 1]) endJumps.push(this.emit(br.src, { op: 'goto', target: UNRESOLVED }));
            if (skip >= 0) (this.ops[skip] as { target: Pc }).target = this.here();
          }
          for (const j of endJumps) (this.ops[j] as { target: Pc }).target = this.here();
          break;
        }
        case 'menu': {
          const options: MenuOption[] = n.options.map(o => {
            if (o.cond) {
              this.exprs.push({ e: o.cond, src: o.src });
              if (usesRandom(o.cond)) this.diag(o.src, 'error', 'random(), pick() and chance() cannot be used in a menu option condition (set a variable first)');
            }
            this.registerString(o.src, o.id, o.text);
            if (o.reason !== null) this.registerString(o.src, o.reasonId, o.reason);
            return { text: o.text, id: o.id, cond: o.cond, reason: o.reason, reasonId: o.reasonId, target: UNRESOLVED, from: o.src.line, to: o.to };
          });
          if (n.prompt !== null) this.registerString(n.src, n.promptId, n.prompt);
          if (n.timeout) {
            this.exprs.push({ e: n.timeout.seconds, src: n.src }); // random() is fine: the seconds are evaluated once, when the menu is shown
            if (n.timeout.seconds.t === 'num' && n.timeout.seconds.v > 0 && n.timeout.seconds.v < 2) this.diag(n.src, 'warning', `A timeout of ${n.timeout.seconds.v} seconds is too short to read the choices`);
          }
          if (n.options.length === 0) this.diag(n.src, 'error', 'A menu needs at least one option');
          const timeout = n.timeout ? { seconds: n.timeout.seconds, target: UNRESOLVED, from: n.timeout.src.line, to: n.timeout.to } : null;
          const menuAt = this.emit(n.src, { op: 'menu', prompt: n.prompt, promptId: n.promptId, ...(n.look ? { look: n.look } : {}), options, timeout, end: UNRESOLVED });
          const endJumps: Pc[] = [];
          n.options.forEach((o, idx) => {
            options[idx].target = this.here();
            this.emitNodes(o.body);
            endJumps.push(this.emit(o.src, { op: 'goto', target: UNRESOLVED }));
          });
          if (n.timeout && timeout) {
            timeout.target = this.here();
            this.emitNodes(n.timeout.body);
            endJumps.push(this.emit(n.timeout.src, { op: 'goto', target: UNRESOLVED }));
          }
          for (const j of endJumps) (this.ops[j] as { target: Pc }).target = this.here();
          (this.ops[menuAt] as { end: Pc }).end = this.here();
          break;
        }
      }
    }
  }

  /** Items and screens of every file, and the expressions, states and lists the screens use (checked at the end). */
  private collectDefinitions() {
    for (const p of this.parsed) {
      for (const it of p.items) {
        if (it.id in this.items) this.diag(it.src, 'error', `Item "${it.id}" is defined twice`);
        this.items[it.id] = it;
        this.registerString(it.src, it.nameId, it.name);
      }
      for (const tf of p.transforms) {
        if (tf.name in this.transforms) { this.diag(tf.src, 'error', `Transform "${tf.name}" is defined twice`); continue; }
        if (ANIM_NAMES.includes(tf.name)) this.diag(tf.src, 'warning', `Transform "${tf.name}" has the name of a preset and replaces it (a character's own rig.json animation of that name still wins)`);
        for (const pr of checkTransform(tf)) this.diag(tf.src, pr.severity, pr.message);
        if (isDynamic(tf) && tf.auto) this.diag(tf.src, 'error', `Transform "${tf.name}" runs by itself (every / while), so it cannot have parameters, expressions, if or pick yet`);
        if (tf.auto?.while && !tf.auto.while.includes('param.')) {
          try { this.exprs.push({ e: parseExpr(tf.auto.while), src: tf.src, local: new Set(['speaking', 'always']) }); } catch { /* the parser reported it */ }
        }
        if (isDynamic(tf)) {
          this.dynamicTransforms[tf.name] = tf;
          const local = new Set(tf.params.map(p => p.name));
          const walk = (steps: TransformDef['steps']) => {
            for (const st of steps) {
              if (st.kind === 'tween') for (const v of [st.x, st.y, st.scale, st.rot, st.alpha]) { if (typeof v === 'object') this.exprs.push({ e: v, src: st.src, local }); }
              else if (st.kind === 'preset') { if (typeof st.strength === 'object') this.exprs.push({ e: st.strength, src: st.src, local }); }
              else if (st.kind === 'parallel' || st.kind === 'pick') st.branches.forEach(walk);
              else if (st.kind === 'if') for (const br of st.branches) { if (br.cond) this.exprs.push({ e: br.cond, src: st.src, local }); walk(br.steps); }
            }
          };
          walk(tf.steps);
        } else this.transforms[tf.name] = transformToAnim(tf);
        if (tf.repeat === 'forever') this.foreverTransforms.add(tf.name);
      }
      for (const ch of p.choreographies) {
        if (ch.name in this.choreographies) { this.diag(ch.src, 'error', `Choreography "${ch.name}" is defined twice`); continue; }
        const built = buildChoreography(ch);
        for (const pr of built.problems) this.diag(pr.src, 'error', pr.message);
        for (const { target, def } of built.members) {
          for (const pr of checkTransform(def)) this.diag(ch.src, pr.severity, `${target} in "${ch.name}": ${pr.message}`);
          this.transforms[def.name] = transformToAnim(def);
        }
        this.choreographies[ch.name] = built.members.map(m => ({ target: m.target, transform: m.def.name }));
        for (const l of ch.lines) this.choreoTargets.push({ target: l.target, src: l.src });
      }
      for (const sc of p.screens) {
        if (sc.name in this.screens) this.diag(sc.src, 'error', `Screen "${sc.name}" is defined twice`);
        this.screens[sc.name] = sc;
        for (const pr of validateScreen(sc, this.stage)) this.diag(pr.src, pr.severity, pr.message);
        const fields = shellEntryFields(sc.name);
        const walk = (nodes: ScreenNode[], local: Set<string>) => {
          for (const n of nodes) {
            for (const e of [n.cond, isClickable(n) ? n.enabled : null]) {
              if (!e) continue;
              this.exprs.push({ e, src: n.src, local });
              if (usesRandom(e)) this.diag(n.src, 'error', 'random(), pick() and chance() cannot be used in a screen condition (set a variable first)');
            }
            if (isClickable(n)) {
              this.registerString(n.src, n.labelId, n.label);
              for (const h of Object.values(n.sets ?? {})) this.exprs.push({ e: h.expr, src: n.src, local });
            }
            if (isClickable(n) && n.body) walk(n.body, local);
            if (n.kind === 'text') this.registerString(n.src, n.id, n.text);
            else if (n.kind === 'layout' || n.kind === 'scroll' || n.kind === 'panel') walk(n.body, local);
            else if (n.kind === 'bar') for (const e of [n.value, n.min, n.max]) this.exprs.push({ e, src: n.src, local });
            else if (n.kind === 'each') {
              if (!local.has(n.list)) this.eachLists.push({ list: n.list, src: n.src });
              walk(n.body, new Set([...local, n.as, `${n.as}.name`, `${n.as}.image`, `${n.as}.index`, ...fields.map(f => `${n.as}.${f}`)]));
            }
          }
        };
        // the shell fills these in on the options and saves screens: they are not story variables
        // (and its parameters, bound by `show screen name(...)`)
        // a local `state` is read inside the screen, and hides a story variable of the same name
        const names = new Set([...shellVars(sc.name), ...(sc.params ?? []), ...(sc.states ?? []).map(d => d.name)]);
        for (const d of sc.states ?? []) this.exprs.push({ e: d.expr, src: d.src, local: new Set([...shellVars(sc.name), ...(sc.params ?? []), ...(sc.states ?? []).filter(o => o !== d).map(o => o.name)]) });
        this.stateDecls.push(...(sc.states ?? []));
        walk(sc.body, names);
      }
    }
  }

  /** The ops: top-level statements of every file, the jump to the entry, then each label body. */
  private emitProgram() {
    // 1. top-level statements (setup code) in file order
    for (const p of this.parsed) this.emitNodes(p.nodes.filter(n => n.k !== 'label'));
    const gotoEntry = this.ops.push({ op: 'goto', target: UNRESOLVED, src: { file: this.files[0]?.file ?? '', line: 0 } }) - 1;

    // 2. label bodies
    let firstLabel = -1;
    for (const p of this.parsed) {
      for (const n of p.nodes) {
        if (n.k !== 'label') continue;
        if (n.name in this.labels) this.diag(n.src, 'error', `Label "${n.name}" is defined twice`);
        this.labels[n.name] = this.here();
        if (n.params.length) this.params[n.name] = n.params;
        for (const p of n.params) { this.assigned.add(p); this.maybeList.add(p); } // bound by the call; may hold a list
        if (firstLabel < 0) firstLabel = this.ops.length;
        this.emitNodes(n.body);
      }
    }
    const entry = 'start' in this.labels ? this.labels['start'] : firstLabel;
    (this.ops[gotoEntry] as { target: Pc }).target = entry >= 0 ? asPc(entry) : this.here();
    if (entry < 0 && this.files.length) this.diag({ file: this.files[0].file, line: 1 }, 'warning', 'No labels found; nothing to play');
  }

  /** Jumps, calls, screens and HUD handlers name things that exist, with the right arguments. */
  private resolveReferences() {
    const pictures = new Set(this.ops.flatMap(o => (o.op === 'image' && o.action === 'show' ? [o.name] : [])));
    for (const { target, src } of this.choreoTargets) { // a choreography's actors are characters, pictures shown somewhere, or the camera
      if (target !== CAMERA_TARGET && !(target in this.characters) && !pictures.has(target)) this.unknownChar(src, target);
    }
    // 3. resolve jumps/calls
    for (const op of this.ops) {
      if (op.op === 'perform') {
        if (!(op.name in this.choreographies)) this.diagnostics.push(withFix(op.src, 'error', `Unknown choreography "${op.name}"`, op.name, Object.keys(this.choreographies), ' (declare it with "choreography ' + op.name + ':")'));
      } else if (op.op === 'animate') { // the target is a character or a picture shown with `image show`, never both
        if (op.name !== null && op.auto) {
          const known = this.transforms[op.name];
          if (Object.hasOwn(this.dynamicTransforms, op.name)) this.diag(op.src, 'error', `"${op.name}" has parameters, expressions, if or pick, which an automatic transform cannot have yet`);
          else if (known ? !known.auto : ANIM_NAMES.includes(op.name)) this.diag(op.src, 'error', `"${op.name}" is not an automatic transform: give its transform line every <seconds> and/or while <condition> (a preset cannot be automatic)`);
        } else if (op.name !== null && this.foreverTransforms.has(op.name)) op.loop = true;
        if (op.name !== null) {
          const own = this.dynamicTransforms[op.name], want = own?.params.length ?? 0;
          if ((op.args?.length ?? 0) > want) this.diag(op.src, 'error', `"${op.name}" takes ${want} argument${want === 1 ? '' : 's'}${own ? ` (${own.params.map(p => p.name).join(', ')})` : ''}, but animate gives ${op.args!.length}`);
          for (const e of op.args ?? []) this.exprs.push({ e, src: op.src });
        }
        if (op.char === CAMERA_TARGET) {
          if (op.char in this.characters || pictures.has(op.char)) this.diag(op.src, 'error', `"${op.char}" is the camera for animate, but is also ${op.char in this.characters ? 'a character' : 'an image'}: rename it so animate knows which to move`);
          else if (op.part) this.diag(op.src, 'error', 'The camera has no parts: animate camera takes no part=');
        } else if (op.char in this.characters && pictures.has(op.char)) this.diag(op.src, 'error', `"${op.char}" is both a character and an image: rename one so animate knows which to move`);
        else if (!(op.char in this.characters) && !pictures.has(op.char)) this.unknownChar(op.src, op.char);
      } else if (op.op === 'jump' || op.op === 'call') {
        if (op.label in this.labels) op.target = this.labels[op.label];
        else this.diagnostics.push(withFix(op.src, 'error', `Unknown label "${op.label}"`, op.label, Object.keys(this.labels)));
        const want = this.params[op.label]?.length ?? 0;
        if (op.label in this.labels) {
          if (op.op === 'jump' && want) this.diag(op.src, 'warning', `"${op.label}" takes parameters (${this.params[op.label].join(', ')}); jump does not set them (use call)`);
          if (op.op === 'call' && (op.args?.length ?? 0) !== want) {
            this.diag(op.src, 'error', `"${op.label}" takes ${want} argument${want === 1 ? '' : 's'}${want ? ` (${this.params[op.label].join(', ')})` : ''}, but the call gives ${op.args?.length ?? 0}`);
          }
        }
      } else if (op.op === 'hud' && !(op.name in this.screens)) {
        this.diagnostics.push(withFix(op.src, 'error', `Unknown screen "${op.name}"`, op.name, Object.keys(this.screens), ` (declare it with "screen ${op.name}:")`));
      } else if (op.op === 'hud' && op.mode === 'on' && this.screens[op.name].states?.length) {
        this.diag(op.src, 'error', `"${op.name}" declares local state, which only a blocking "show screen" keeps; a HUD cannot use it`);
      } else if (op.op === 'hud' && op.mode === 'on' && this.screens[op.name].params?.length) {
        this.diag(op.src, 'error', `"${op.name}" takes parameters (${this.screens[op.name].params!.join(', ')}), and a HUD has no arguments to give them; show it with "show screen"`);
      } else if (op.op === 'screen' && !(op.name in this.screens)) {
        this.diagnostics.push(withFix(op.src, 'error', `Unknown screen "${op.name}"`, op.name, Object.keys(this.screens), ` (declare it with "screen ${op.name}:")`));
      } else if (op.op === 'screen') {
        const want = this.screens[op.name].params ?? [], got = op.args?.length ?? 0;
        if (got !== want.length) this.diag(op.src, 'error', `Screen "${op.name}" takes ${want.length} argument${want.length === 1 ? '' : 's'}${want.length ? ` (${want.join(', ')})` : ''}, but show screen gives ${got}`);
        else if (this.screens[op.name].inout?.length) {
          op.outs = want.map((p, i) => {
            if (!this.screens[op.name].inout!.includes(p)) return null;
            const a = op.args![i];
            if (a.t !== 'var' || a.name.startsWith('unlocked.')) { this.diag(op.src, 'error', `"${p}" is an inout parameter of screen ${op.name}: the argument must be a plain variable name (or a persistent. one), which the screen writes back to`); return null; }
            if (a.name.startsWith('persistent.')) this.persisted.add(a.name.slice('persistent.'.length)); else this.assigned.add(a.name);
            return a.name;
          });
        }
      }
    }

    // A HUD element's event calls a label: it must exist.
    const checkHandlers = (nodes: ScreenNode[]) => {
      for (const n of nodes) {
        if (n.kind === 'each' || n.kind === 'layout' || n.kind === 'scroll' || n.kind === 'panel') checkHandlers(n.body);
        else if (isClickable(n)) {
          if (n.body) checkHandlers(n.body);
          for (const [event, label] of Object.entries(n.on)) if (!(label in this.labels)) this.diagnostics.push(withFix(n.src, 'error', `Unknown label "${label}" (on ${event} of ${n.id})`, label, Object.keys(this.labels)));
        }
      }
    };
    for (const def of Object.values(this.screens)) checkHandlers(def.body);

    // Two this.characters on one spot because a `show` left out `at`.
    this.diagnostics.push(...stackedShows(this.ops, Object.keys(this.characters)));
  }

  /** Variables read but never assigned, lists never set to one, flags nothing unlocks. */
  private checkVariables() {
    // 4. variable sanity check
    for (const d of this.stateDecls) if (this.assigned.has(d.name)) this.diag(d.src, 'warning', `state ${d.name} hides the story variable ${d.name} inside this screen`);
    for (const { list, src } of this.eachLists) {
      if (!this.maybeList.has(list)) this.diag(src, 'warning', `"${list}" is used as a list but never set to one (add "set ${list} = []" somewhere)`);
    }
    for (const { e, src, local } of this.exprs) {
      for (const v of listArgs(e)) {
        if (!this.maybeList.has(v) && !local?.has(v)) this.diag(src, 'warning', `"${v}" is used as a list but never set to one (add "set ${v} = []" somewhere)`);
      }
      for (const v of collectVars(e)) {
        if (local?.has(v)) continue;
        const flag = /^unlocked\.(\w+)$/.exec(v);
        if (flag) {
          if (!this.unlocked.has(flag[1])) this.diag(src, 'warning', `Nothing unlocks "${flag[1]}" (add "unlock ${flag[1]}" somewhere)`);
        } else if (v.startsWith('persistent.')) {
          if (!this.persisted.has(v.slice('persistent.'.length))) this.diag(src, 'warning', `Persistent value "${v}" is never written (add "set ${v} = ..." somewhere; reads as 0)`);
        } else if (v.includes('.')) {
          this.diag(src, 'error', `Unknown name "${v}" (only unlocked.<flag> and persistent.<name> have a dot)`);
        } else if (!this.assigned.has(v)) {
          this.diag(src, 'warning', `Variable "${v}" is never assigned (reads as 0)`);
        }
      }
    }
  }

  compile(): Program {
    this.collectDefinitions();
    this.emitProgram();
    this.resolveReferences();
    this.checkVariables();
    const { ops, labels, params, characters, items, screens, strings, diagnostics, positions, anchors, stage, transforms, dynamicTransforms, choreographies } = this;
    return { ops, labels, params, characters, items, screens, strings, diagnostics, positions, anchors, stage: { ...stage }, ...(Object.keys(transforms).length ? { transforms } : {}), ...(Object.keys(dynamicTransforms).length ? { dynamicTransforms } : {}), ...(Object.keys(choreographies).length ? { choreographies } : {}) };
  }
}


/**
 * Compile one or more script files into a single flat program.
 * Layout: [top-level statements of every file] [goto entry] [label bodies...]
 * Entry is the label "start" if present, otherwise the first label.
 */
export function compile(files: SourceFile[], positions: Positions = BUILTIN_POSITIONS, anchors: Anchors = ANCHORS, stage: StageSize = DEFAULT_STAGE): Program {
  return new Compiler(files, positions, anchors, stage).compile();
}
