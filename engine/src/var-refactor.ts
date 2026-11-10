/**
 * Variable refactoring across the scripts: find every place a story variable is written or read (`set`, conditions,
 * `call` arguments, `[name]` in text, `input`, `show screen ... as`, label parameters, screen `each ... as`) and rename
 * them together. Label parameters and `each` names are local to their label / loop body, so they are renamed apart from
 * a global of the same name. `persistent.<name>` is a separate namespace. Pure text in, edits out (see refactor.ts).
 */

import { FUNCTIONS } from './expr.js';
import { ACHIEVEMENT_TOAST_SCREEN, ACHIEVEMENTS_SCREEN, CHAPTERS_SCREEN, GALLERY_SCREEN, HISTORY_SCREEN, MUSIC_SCREEN, OPTIONS_SCREEN, SAVES_SCREEN, TITLE_SCREEN, VIEWER_SCREEN, shellVars } from './screens.js';
import type { ProjectFile, RenameResult, TextEdit } from './refactor.js';
import { commentStart, maskStrings, quotedRanges } from './script-lex.js';

/** A place a variable name appears: 1-based line, 0-based column of the name and its length. `scope` is null for a global, else the label or loop that declares it. */
export interface VarRef { file: string; line: number; col: number; length: number; name: string; persistent: boolean; scope: string | null }

// A variable name in any alphabet (names.ts); every pattern built from it takes the u flag.
const ID = String.raw`[\p{L}_][\p{L}\p{N}\p{M}_]*`;
const uRe = (src: string, flags = '') => new RegExp(src, `${flags}u`);
const NAME = uRe(`^${ID}$`);
const KEYWORDS = new Set(['and', 'or', 'not', 'true', 'false']);
const RESERVED = new Set([...KEYWORDS, ...Object.keys(FUNCTIONS), 'persistent', 'unlocked', 'screen']);
const SHELL_VARS = new Set([TITLE_SCREEN, OPTIONS_SCREEN, SAVES_SCREEN, HISTORY_SCREEN, GALLERY_SCREEN, VIEWER_SCREEN, MUSIC_SCREEN, CHAPTERS_SCREEN, ACHIEVEMENTS_SCREEN, ACHIEVEMENT_TOAST_SCREEN].flatMap(shellVars));
// an element line, or a clause continuation line (`if` ones are scanned like a story `if`) of one
const ELEMENT = /^\s*(?:(?:image|hotspot|button|tab|radio|toggle|select|state|text|slider|bar|panel|each|scroll|row|column|grid)\b|on\s+(?:click|focus|blur)\s+set\b|enabled\b)/;

const quoted = quotedRanges;

const SAY = uRe(`^\\s*${ID}:[ \\t]+`);
/** The [from, to) ranges of a line's shown text: everything after `who:` on a dialogue line, else its "quoted" strings. */
function textSpans(line: string): [number, number][] {
  const say = SAY.exec(line);
  return say ? [[say[0].length, line.length]] : quoted(line);
}

type Add =(col: number, name: string, persistent: boolean, how?: 'param' | 'each' | 'outer') => void;

/** Variable names in an expression (strings, numbers, keywords and function names skipped); stops at a `#` comment. */
function exprRefs(raw: string, from: number, to: number, add: Add) {
  let i = from;
  while (i < to) {
    const c = raw[i];
    if (c === '"' || c === "'") { i++; while (i < to && raw[i] !== c) i += raw[i] === '\\' ? 2 : 1; i++; continue; }
    if (c === '#') return;
    if (/[0-9]/.test(c)) { while (i < to && /[0-9.]/.test(raw[i])) i++; continue; }
    const m = uRe(`^(${ID})(?:\\.(${ID}))?`).exec(raw.slice(i, to));
    if (!m) { i++; continue; }
    const [all, head, tail] = m;
    if (/^\s*\(/.test(raw.slice(i + all.length, to))) { i += all.length; continue; }
    if (head === 'persistent' && tail) add(i + 'persistent.'.length, tail, true);
    else if (head !== 'unlocked' && !KEYWORDS.has(head)) add(i, head, false);
    i += all.length;
  }
}

/** `[name]`, `[name.field]` and `[persistent.name]` in a piece of text. */
function textRefs(raw: string, from: number, to: number, add: Add) {
  const re = uRe(`\\[(${ID})(?:\\.(${ID}))?(?::[^\\]\\[]+)?\\]`, 'g');
  const text = raw.slice(from, to);
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[1] === 'persistent' && m[2]) add(from + m.index + 1 + 'persistent.'.length, m[2], true);
    else if (m[1] !== 'unlocked') add(from + m.index + 1, m[1], false);
  }
}

interface Scope { id: string; file: string; start: number; end: number; indent: number; names: Set<string> }
interface RawRef { file: string; line: number; col: number; name: string; persistent: boolean; outer: boolean }

interface LineCtx { raw: string; m: string; end: number; no: number; indent: number; add: Add; strings: (limit?: number) => void }

/** Reads one file line by line, keeping the open scopes (labels with parameters, screens, loops) on a stack. */
class FileScanner {
  private stack: Scope[] = [];
  private screenIndent: number | null = null;
  private screenScope: Scope | null = null; // the screen being scanned: its parameters and `state`s are local to it
  private lines: string[];

  constructor(private file: string, text: string, private scopes: Scope[], private refs: RawRef[]) {
    this.lines = text.split(/\r?\n/);
  }

  run() {
    this.lines.forEach((raw, i) => this.line(raw, i + 1));
    for (const s of this.stack) s.end = this.lines.length;
  }

  private line(raw: string, no: number) {
    const { file, stack, refs, scopes, lines } = this;
    if (/^\s*$/.test(raw) || /^\s*#/.test(raw)) return;
    const indent = /^ */.exec(raw)![0].length;
    while (stack.length && indent <= stack[stack.length - 1].indent) stack.pop()!.end = no - 1;
    if (this.screenIndent !== null && indent <= this.screenIndent) this.screenIndent = null;
    const m = maskStrings(raw);
    const hash = commentStart(m);
    const end = hash >= 0 ? hash : raw.length;
    const add: Add = (col, name, persistent, how) => {
      refs.push({ file, line: no, col, name, persistent, outer: how === 'outer' });
      if (how === 'param' || how === 'each') {
        let s = stack[stack.length - 1];
        if (!s || s.start !== no) { s = { id: `${file}#${no}`, file, start: no, end: lines.length, indent, names: new Set() }; stack.push(s); scopes.push(s); }
        s.names.add(name);
      }
    };
    const strings = (limit = raw.length) => { for (const [a, b] of quoted(raw)) if (a < limit) textRefs(raw, a, b, add); };
    const c: LineCtx = { raw, m, end, no, indent, add, strings };
    if (
      this.labelDef(c) ||
      this.label(c) ||
      this.assign(c) ||
      this.condition(c) ||
      this.callLine(c) ||
      this.inputLine(c) ||
      this.showScreen(c) ||
      this.screenHead(c) ||
      this.menuLine(c) ||
      this.quoted(c) ||
      this.element(c) ||
      this.say(c)
    ) return;
    strings();
  }


  private labelDef(c: LineCtx): boolean {
    const { m, add } = c;
    let r: RegExpExecArray | null;
    if ((r = uRe(`^(\\s*label\\s+${ID}\\s*\\()([^()]*)\\)\\s*:`).exec(m))) {
      const ps = uRe(ID, 'g');
      for (let p = ps.exec(r[2]); p; p = ps.exec(r[2])) add(r[1].length + p.index, p[0], false, 'param');
      return true;
    }
    return false;
  }

  private label(c: LineCtx): boolean {
    const { m } = c;
    if (/^\s*label\s/.test(m)) return true;
    return false;
  }

  private assign(c: LineCtx): boolean {
    const { raw, m, end, add } = c;
    let r: RegExpExecArray | null;
    if ((r = uRe(`^(\\s*set\\s+)(persistent\\.)?(${ID})\\s*(?:=|\\+=|-=|\\*=|\\/=)\\s*`).exec(m))) {
      add(r[1].length + (r[2]?.length ?? 0), r[3], !!r[2]);
      exprRefs(raw, r[0].length, end, add);
      return true;
    }
    return false;
  }

  private condition(c: LineCtx): boolean {
    const { raw, m, end, add } = c;
    let r: RegExpExecArray | null;
    if ((r = /^\s*(?:if|elif)\s+/.exec(m))) { exprRefs(raw, r[0].length, end, add); return true; }
    return false;
  }

  private callLine(c: LineCtx): boolean {
    const { raw, m, end, add } = c;
    let r: RegExpExecArray | null;
    if ((r = uRe(`^\\s*call\\s+${ID}\\s*\\(`).exec(m))) { exprRefs(raw, r[0].length, end, add); return true; }
    return false;
  }

  private inputLine(c: LineCtx): boolean {
    const { m, add, strings } = c;
    let r: RegExpExecArray | null;
    if ((r = uRe(`^(\\s*input\\s+)(${ID})`).exec(m))) { add(r[1].length, r[2], false); strings(); return true; }
    return false;
  }

  private showScreen(c: LineCtx): boolean {
    const { raw, m, end, add } = c;
    let r: RegExpExecArray | null;
    if ((r = uRe(`^(\\s*show\\s+screen\\s+${ID})(?:(\\s*\\()(.*)\\))?(?:(\\s+as\\s+)(${ID}))?`).exec(m.slice(0, end)))) {
      let at = r[1].length;
      if (r[3] !== undefined) { // the arguments
        exprRefs(raw, at + r[2].length, at + r[2].length + r[3].length, add);
        at += r[2].length + r[3].length + 1;
      }
      if (r[5]) add(at + r[4].length, r[5], false);
      return true;
    }
    return false;
  }

  private screenHead(c: LineCtx): boolean {
    const { m, no, indent, add } = c;
    const { file, stack, scopes, lines } = this;
    let r: RegExpExecArray | null;
    if (/^\s*screen\s/.test(m)) { // the screen is a scope even without parameters: its states belong to it
      this.screenScope = { id: `${file}#${no}`, file, start: no, end: lines.length, indent, names: new Set() };
      stack.push(this.screenScope);
      scopes.push(this.screenScope);
      this.screenIndent = indent;
      if ((r = uRe(`^(\\s*screen\\s+${ID}\\s*\\()([^()]*)\\)\\s*:?`).exec(m))) { // a parameter (an inout one too) is local to its screen, like a label's
        const ps = uRe(`(?:\\binout\\s+)?(${ID})`, 'g');
        for (let p = ps.exec(r[2]); p; p = ps.exec(r[2])) add(r[1].length + p.index + p[0].length - p[1].length, p[1], false, 'param');
      }
      return true;
    }
    return false;
  }

  private menuLine(c: LineCtx): boolean {
    const { raw, m, end, add, strings } = c;
    if (/^\s*menu\b/.test(m)) {
      const t = /\stimeout\s+/.exec(m);
      if (t) exprRefs(raw, t.index + t[0].length, end, add);
      strings(t?.index);
      return true;
    }
    return false;
  }

  private quoted(c: LineCtx): boolean {
    const { raw, m, end, add, strings } = c;
    if (m.trimStart().startsWith('"')) {
      const c = /\sif\s+/.exec(m);
      if (c) {
        const e = /\selse\s+(?=")/.exec(m);
        exprRefs(raw, c.index + c[0].length, e && e.index > c.index ? e.index : end, add);
      }
      strings();
      return true;
    }
    return false;
  }

  private element(c: LineCtx): boolean {
    const { raw, m, end, add, strings } = c;
    let r: RegExpExecArray | null;
    if (this.screenIndent !== null && ELEMENT.test(m)) {
      const cuts = [...m.matchAll(/\s(?:if|enabled)\s+/g)];
      if (cuts.length) cuts.forEach((c, k) => exprRefs(raw, c.index! + c[0].length, k + 1 < cuts.length ? cuts[k + 1].index! : end, add));
      const setAt = m.search(/\bon\s+(?:click|focus|blur)\s+set\s/); // the strings of the label come before the clauses
      const clauses = Math.min(cuts[0]?.index ?? Infinity, setAt < 0 ? Infinity : setAt);
      strings(clauses === Infinity ? undefined : clauses);
      // local state: a declaration, the state a toggle, radio or tab is bound to, and the states an "on ... set" changes (with the value it computes)
      if ((r = uRe(`^(\\s*state\\s+)(${ID})\\s*=\\s*`).exec(m))) {
        add(r[1].length, r[2], false);
        this.screenScope?.names.add(r[2]);
        exprRefs(raw, r[0].length, end, add);
      }
      if ((r = uRe(`^\\s*(?:toggle\\s+${ID}\\s+|(?:radio|tab)\\s+${ID}\\s+)(${ID})`).exec(m))) add(r[0].length - r[1].length, r[1], false);
      const sets = [...m.matchAll(uRe(`\\bon\\s+(?:click|focus|blur)\\s+set\\s+(${ID})\\s*=\\s*`, 'g'))];
      sets.forEach((st, k) => {
        add(st.index! + st[0].indexOf(st[1], st[0].indexOf('set') + 3), st[1], false);
        const stop = [...(sets[k + 1] ? [sets[k + 1].index!] : []), ...cuts.map(c => c.index!).filter(c => c > st.index!)];
        exprRefs(raw, st.index! + st[0].length, stop.length ? Math.min(...stop) : end, add);
      });
      if ((r = uRe(`^(\\s*each\\s+)(${ID})(\\s+as\\s+)(${ID})`).exec(m))) {
        add(r[1].length, r[2], false, 'outer');
        add(r[1].length + r[2].length + r[3].length, r[4], false, 'each');
      }
      // a bar's value, `max` and `min` are expressions of one word each (no spaces)
      if (/^\s*bar\b/.test(m)) {
        const head = cuts[0]?.index ?? end;
        for (const w of m.slice(0, head).matchAll(/(?:^\s*bar\s+|\s(?:max|min)\s+)(\S+)/g)) exprRefs(raw, w.index! + w[0].length - w[1].length, w.index! + w[0].length, add);
      }
      return true;
    }
    return false;
  }

  private say(c: LineCtx): boolean {
    const { raw, m, add } = c;
    let r: RegExpExecArray | null;
    if ((r = SAY.exec(m))) { textRefs(raw, r[0].length, raw.length, add); return true; }
    return false;
  }
}

function scanFile(file: string, text: string, scopes: Scope[], refs: RawRef[]) {
  new FileScanner(file, text, scopes, refs).run();
}


function analyse(files: ProjectFile[]): { refs: VarRef[]; scopes: Map<string, Scope> } {
  const scopes: Scope[] = [], raw: RawRef[] = [];
  for (const f of files) if (f.name.endsWith('.vn')) scanFile(f.name, f.text, scopes, raw);
  const refs = raw.map(r => {
    let owner: Scope | undefined;
    if (!r.persistent) {
      for (const s of scopes) {
        if (s.file !== r.file || r.line < s.start || r.line > s.end || !s.names.has(r.name)) continue;
        if (r.outer && s.start === r.line) continue;
        if (!owner || s.start > owner.start) owner = s;
      }
    }
    return { file: r.file, line: r.line, col: r.col, length: r.name.length, name: r.name, persistent: r.persistent, scope: owner?.id ?? null };
  });
  return { refs, scopes: new Map(scopes.map(s => [s.id, s])) };
}

/** Every write and read of a story variable in the `.vn` scripts, each tagged with the label or loop that owns it (null: global). */
export const variableRefs = (files: ProjectFile[]): VarRef[] => analyse(files).refs;

/** The variable named at a position (1-based line, 0-based column). */
export function variableAt(files: ProjectFile[], file: string, line: number, col: number): VarRef | undefined {
  return variableRefs(files).find(r => r.file === file && r.line === line && col >= r.col && col <= r.col + r.length);
}

/** Every use of `target` itself (not an unrelated variable of the same name, a persistent value or another label's local). */
export const variableUses = (files: ProjectFile[], target: VarRef): VarRef[] =>
  variableRefs(files).filter(r => r.name === target.name && r.persistent === target.persistent && r.scope === target.scope);

/** Edits that rename the variable `target` (all its uses, not an unrelated one of the same name), or why that cannot be done. */
export function renameVariable(files: ProjectFile[], target: VarRef, to: string): RenameResult {
  if (!NAME.test(to)) return { ok: false, error: `"${to}" is not a valid variable name (letters, digits and _, not starting with a digit)` };
  if (RESERVED.has(to)) return { ok: false, error: `"${to}" is a reserved word` };
  if (to === target.name) return { ok: false, error: 'That is already the name' };
  const { refs, scopes } = analyse(files);
  const mine = refs.filter(r => r.name === target.name && r.persistent === target.persistent && r.scope === target.scope);
  if (!mine.length) return { ok: false, error: `No variable "${target.name}" in the scripts` };
  if (!target.persistent) {
    if (!target.scope && SHELL_VARS.has(target.name)) return { ok: false, error: `"${target.name}" is filled in by the game, not a story variable` };
    if (SHELL_VARS.has(to)) return { ok: false, error: `"${to}" is filled in by the game on some screens` };
  }
  const others = refs.filter(r => r.name === to && r.persistent === target.persistent);
  const inside = (r: { file: string; line: number }, s: Scope) => r.file === s.file && r.line >= s.start && r.line <= s.end;
  const local = target.scope ? scopes.get(target.scope) : undefined;
  if (local) {
    if (others.some(r => inside(r, local))) return { ok: false, error: `"${to}" is already used where "${target.name}" is local` };
  } else {
    if (others.some(r => !r.scope)) return { ok: false, error: `A ${target.persistent ? 'persistent value' : 'variable'} "${to}" already exists` };
    // a local of the new name would capture the uses inside it
    const hit = [...new Set(others.map(r => r.scope).filter((id): id is string => !!id))].some(id => mine.some(r => inside(r, scopes.get(id)!)));
    if (hit) return { ok: false, error: `"${to}" is a local name where "${target.name}" is used` };
  }
  const edits = mine.map(r => ({ file: r.file, line: r.line, col: r.col, length: r.length, text: to }));
  return { ok: true, edits: [...edits, ...localeEdits(files, mine, target, to), ...(target.scope ? [] : gameJsonEdits(files, target, to))] };
}

/**
 * `[name]` in game.json's strings. Its `labels` replace the stock screens' words, and those are filled in with the story's
 * variables ("The end, [player]"); a local never reaches them.
 */
function gameJsonEdits(files: ProjectFile[], target: VarRef, to: string): TextEdit[] {
  const game = files.find(f => f.name === 'game.json');
  if (!game) return [];
  const out: TextEdit[] = [];
  game.text.split(/\r?\n/).forEach((raw, i) => {
    textRefs(raw, 0, raw.length, (col, name, persistent) => {
      if (name !== target.name || persistent !== target.persistent || !quoted(raw).some(([a, b]) => col >= a && col < b)) return;
      out.push({ file: game.name, line: i + 1, col, length: name.length, text: to });
    });
  });
  return out;
}

/** True for `locale/<lang>.json` and the `locale/<lang>.src` source snapshots (translation.ts), which quote the same text. */
export const isLocaleFile = (name: string) => /(^|\/)locale\/[^/]+\.(json|src)$/.test(name);

/**
 * `[name]` inside the translations of the lines that mention the variable in text. A translation is found through the
 * line's `#id`, so a local (label parameter, `each` name) only changes in the translations of its own lines.
 */
function localeEdits(files: ProjectFile[], mine: { file: string; line: number; col: number }[], target: VarRef, to: string): TextEdit[] {
  const locales = files.filter(f => isLocaleFile(f.name));
  if (!locales.length) return [];
  const lineOf = new Map(files.filter(f => f.name.endsWith('.vn')).map(f => [f.name, f.text.split(/\r?\n/)]));
  const ids = new Set<string>();
  for (const r of mine) {
    const raw = lineOf.get(r.file)?.[r.line - 1] ?? '';
    const id = /#([0-9a-z]{4,})\s*$/.exec(raw);
    if (id && textSpans(raw).some(([a, b]) => r.col >= a && r.col < b)) ids.add(id[1]);
  }
  if (!ids.size) return [];
  const ref = uRe(`\\[${target.persistent ? 'persistent\\.' : ''}(${target.name})(?=[\\].:])`, 'g');
  const out: TextEdit[] = [];
  for (const f of locales) {
    f.text.split(/\r?\n/).forEach((raw, i) => {
      const key = /^\s*"([0-9a-z]+)"\s*:\s*"/.exec(raw);
      if (!key || !ids.has(key[1])) return;
      for (const [a, b] of quoted(raw.slice(key[0].length - 1)).slice(0, 1)) {
        const from = key[0].length - 1 + a, text = raw.slice(from, key[0].length - 1 + b);
        ref.lastIndex = 0;
        for (let m = ref.exec(text); m; m = ref.exec(text)) {
          if (!target.persistent && m[0].startsWith('[persistent.')) continue;
          out.push({ file: f.name, line: i + 1, col: from + m.index + m[0].length - target.name.length, length: target.name.length, text: to });
        }
      }
    });
  }
  return out;
}
