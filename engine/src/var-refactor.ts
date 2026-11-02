/**
 * Variable refactoring across the scripts: find every place a story variable is written or read (`set`, conditions,
 * `call` arguments, `[name]` in text, `input`, `show screen ... as`, label parameters, screen `each ... as`) and rename
 * them together. Label parameters and `each` names are local to their label / loop body, so they are renamed apart from
 * a global of the same name. `persistent.<name>` is a separate namespace. Pure text in, edits out (see refactor.ts).
 */

import { FUNCTIONS } from './expr.js';
import { ACHIEVEMENT_TOAST_SCREEN, ACHIEVEMENTS_SCREEN, CHAPTERS_SCREEN, GALLERY_SCREEN, HISTORY_SCREEN, MUSIC_SCREEN, OPTIONS_SCREEN, SAVES_SCREEN, VIEWER_SCREEN, shellVars } from './screens.js';
import type { ProjectFile, RenameResult, TextEdit } from './refactor.js';

/** A place a variable name appears: 1-based line, 0-based column of the name and its length. `scope` is null for a global, else the label or loop that declares it. */
export interface VarRef { file: string; line: number; col: number; length: number; name: string; persistent: boolean; scope: string | null }

const ID = '[A-Za-z_][A-Za-z0-9_]*';
const NAME = new RegExp(`^${ID}$`);
const KEYWORDS = new Set(['and', 'or', 'not', 'true', 'false']);
const RESERVED = new Set([...KEYWORDS, ...Object.keys(FUNCTIONS), 'persistent', 'unlocked', 'screen']);
const SHELL_VARS = new Set([OPTIONS_SCREEN, SAVES_SCREEN, HISTORY_SCREEN, GALLERY_SCREEN, VIEWER_SCREEN, MUSIC_SCREEN, CHAPTERS_SCREEN, ACHIEVEMENTS_SCREEN, ACHIEVEMENT_TOAST_SCREEN].flatMap(shellVars));
const ELEMENT = /^\s*(?:image|hotspot|button|text|slider|each|scroll|row|column|grid)\b/;

/** The line with the inside of every "string" blanked (same length), so words in text are never taken for syntax. */
function mask(line: string): string {
  let out = '', quote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote && c === '\\') { out += '  '; i++; continue; }
    if (c === '"') { quote = !quote; out += c; continue; }
    out += quote ? ' ' : c;
  }
  return out;
}

/** The [from, to) ranges inside "quotes". */
function quoted(line: string): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let i = 0; i < line.length; i++) {
    if (start >= 0 && line[i] === '\\') { i++; continue; }
    if (line[i] !== '"') continue;
    if (start < 0) start = i + 1; else { out.push([start, i]); start = -1; }
  }
  return out;
}

type Add = (col: number, name: string, persistent: boolean, how?: 'param' | 'each' | 'outer') => void;

/** Variable names in an expression (strings, numbers, keywords and function names skipped); stops at a `#` comment. */
function exprRefs(raw: string, from: number, to: number, add: Add) {
  let i = from;
  while (i < to) {
    const c = raw[i];
    if (c === '"' || c === "'") { i++; while (i < to && raw[i] !== c) i += raw[i] === '\\' ? 2 : 1; i++; continue; }
    if (c === '#') return;
    if (/[0-9]/.test(c)) { while (i < to && /[0-9.]/.test(raw[i])) i++; continue; }
    const m = new RegExp(`^(${ID})(?:\\.(${ID}))?`).exec(raw.slice(i, to));
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
  const re = new RegExp(`\\[(${ID})(?:\\.(${ID}))?(?::[^\\]\\[]+)?\\]`, 'g');
  const text = raw.slice(from, to);
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[1] === 'persistent' && m[2]) add(from + m.index + 1 + 'persistent.'.length, m[2], true);
    else if (m[1] !== 'unlocked') add(from + m.index + 1, m[1], false);
  }
}

interface Scope { id: string; file: string; start: number; end: number; indent: number; names: Set<string> }
interface RawRef { file: string; line: number; col: number; name: string; persistent: boolean; outer: boolean }

function scanFile(file: string, text: string, scopes: Scope[], refs: RawRef[]) {
  const stack: Scope[] = [];
  let screenIndent: number | null = null;
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const no = i + 1;
    if (/^\s*$/.test(raw) || /^\s*#/.test(raw)) return;
    const indent = /^ */.exec(raw)![0].length;
    while (stack.length && indent <= stack[stack.length - 1].indent) stack.pop()!.end = no - 1;
    if (screenIndent !== null && indent <= screenIndent) screenIndent = null;
    const m = mask(raw);
    const hash = m.indexOf('#');
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
    let r: RegExpExecArray | null;

    if ((r = new RegExp(`^(\\s*label\\s+${ID}\\s*\\()([^()]*)\\)\\s*:`).exec(m))) {
      const ps = new RegExp(ID, 'g');
      for (let p = ps.exec(r[2]); p; p = ps.exec(r[2])) add(r[1].length + p.index, p[0], false, 'param');
      return;
    }
    if (/^\s*label\s/.test(m)) return;
    if ((r = new RegExp(`^(\\s*set\\s+)(persistent\\.)?(${ID})\\s*(?:=|\\+=|-=|\\*=|\\/=)\\s*`).exec(m))) {
      add(r[1].length + (r[2]?.length ?? 0), r[3], !!r[2]);
      exprRefs(raw, r[0].length, end, add);
      return;
    }
    if ((r = /^\s*(?:if|elif)\s+/.exec(m))) { exprRefs(raw, r[0].length, end, add); return; }
    if ((r = new RegExp(`^\\s*call\\s+${ID}\\s*\\(`).exec(m))) { exprRefs(raw, r[0].length, end, add); return; }
    if ((r = new RegExp(`^(\\s*input\\s+)(${ID})`).exec(m))) { add(r[1].length, r[2], false); strings(); return; }
    if ((r = new RegExp(`^(\\s*show\\s+screen\\s+${ID}\\s+as\\s+)(${ID})`).exec(m))) { add(r[1].length, r[2], false); return; }
    if (/^\s*screen\s/.test(m)) { screenIndent = indent; return; }
    if (/^\s*menu\b/.test(m)) {
      const t = /\stimeout\s+/.exec(m);
      if (t) exprRefs(raw, t.index + t[0].length, end, add);
      strings(t?.index);
      return;
    }
    if (m.trimStart().startsWith('"')) {
      const c = /\sif\s+/.exec(m);
      if (c) {
        const e = /\selse\s+(?=")/.exec(m);
        exprRefs(raw, c.index + c[0].length, e && e.index > c.index ? e.index : end, add);
      }
      strings();
      return;
    }
    if (screenIndent !== null && ELEMENT.test(m)) {
      const cuts = [...m.matchAll(/\s(?:if|enabled)\s+/g)];
      if (cuts.length) cuts.forEach((c, k) => exprRefs(raw, c.index! + c[0].length, k + 1 < cuts.length ? cuts[k + 1].index! : end, add));
      strings(cuts[0]?.index);
      if ((r = new RegExp(`^(\\s*each\\s+)(${ID})(\\s+as\\s+)(${ID})`).exec(m))) {
        add(r[1].length, r[2], false, 'outer');
        add(r[1].length + r[2].length + r[3].length, r[4], false, 'each');
      }
      return;
    }
    if ((r = new RegExp(`^\\s*${ID}:[ \\t]+`).exec(m))) { textRefs(raw, r[0].length, raw.length, add); return; }
    strings();
  });
  for (const s of stack) s.end = lines.length;
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
  return { ok: true, edits: [...edits, ...localeEdits(files, mine, target, to)] };
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
    if (id && quoted(raw).some(([a, b]) => r.col >= a && r.col < b)) ids.add(id[1]);
  }
  if (!ids.size) return [];
  const ref = new RegExp(`\\[${target.persistent ? 'persistent\\.' : ''}(${target.name})(?=[\\].:])`, 'g');
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
