/**
 * Label refactoring across the project's files: find every place a label is defined or named (the `label` line,
 * `jump`/`call`, a HUD element's `on click|focus|blur`, game.json's `intro` and `chapters`) and rename them together.
 * Pure text in, edits out, so the editor only has to apply them to its models.
 */

import { HUD_EVENTS } from './screens.js';

export interface ProjectFile { name: string; text: string }

export type LabelRefKind = 'label' | 'jump' | 'call' | 'on' | 'intro' | 'chapter';

/** A place a label name appears: 1-based line, 0-based column of the name and its length. */
export interface LabelRef { file: string; line: number; col: number; length: number; name: string; kind: LabelRefKind }

export interface TextEdit { file: string; line: number; col: number; length: number; text: string }

export type RenameResult = { ok: true; edits: TextEdit[] } | { ok: false; error: string };

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RE_DEF = /^(\s*label\s+)([A-Za-z_][A-Za-z0-9_]*)(?=\s*[:(])/;
const RE_JUMP = /^(\s*(jump|call)\s+)([A-Za-z_][A-Za-z0-9_]*)(?=\s*(\(.*\))?\s*(#.*)?$)/;
const RE_ON = new RegExp(`(?<![\\w])on\\s+(?:${HUD_EVENTS.join('|')})\\s+(?=[A-Za-z_])`, 'g');

/** The line with the inside of every "string" blanked, so words in dialogue and menu text are never taken for syntax. */
function maskStrings(line: string): string {
  let out = '', quote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote && c === '\\') { out += '  '; i++; continue; }
    if (c === '"') { quote = !quote; out += c; continue; }
    out += quote ? ' ' : c;
  }
  return out;
}

function scriptRefs(file: string, text: string): LabelRef[] {
  const refs: LabelRef[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = maskStrings(raw);
    const at = (col: number, name: string, kind: LabelRefKind) => refs.push({ file, line: i + 1, col, length: name.length, name, kind });
    let m = RE_DEF.exec(line);
    if (m) { at(m[1].length, m[2], 'label'); return; }
    m = RE_JUMP.exec(line);
    if (m) { at(m[1].length, m[3], m[2] as 'jump' | 'call'); return; }
    // Only inside the part before a trailing comment.
    const hash = line.search(/#(?![0-9a-z]{4,}\b)/);
    const code = hash >= 0 ? line.slice(0, hash) : line;
    RE_ON.lastIndex = 0;
    for (let o = RE_ON.exec(code); o; o = RE_ON.exec(code)) {
      const col = o.index + o[0].length;
      const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(code.slice(col))![0];
      at(col, name, 'on');
    }
  });
  return refs;
}

/** String tokens of a JSON text with their path (keys and array positions simplified to key names), no real parsing. */
function jsonRefs(file: string, text: string): LabelRef[] {
  const refs: LabelRef[] = [];
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
  const lineOf = (pos: number) => { let lo = 0, hi = lineStarts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= pos) lo = mid; else hi = mid - 1; } return lo; };
  // Stack of containers: the key a container is the value of, and (for objects) the last key seen.
  const stack: { type: '{' | '['; key: string; last: string }[] = [];
  let pendingKey = '';
  const re = /"((?:[^"\\\n]|\\.)*)"|[{}[\]:,]/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const tok = m[0];
    if (tok === '{' || tok === '[') { stack.push({ type: tok, key: pendingKey, last: '' }); pendingKey = ''; continue; }
    if (tok === '}' || tok === ']') { stack.pop(); pendingKey = ''; continue; }
    if (tok === ',') { pendingKey = ''; continue; }
    if (tok === ':') continue;
    const top = stack[stack.length - 1];
    // A string followed by ':' is a key; otherwise it is a value.
    const after = /^\s*(.)/.exec(text.slice(m.index + tok.length));
    if (top?.type === '{' && after?.[1] === ':') { top.last = m[1]; pendingKey = m[1]; continue; }
    const value = m[1];
    if (!NAME.test(value)) { pendingKey = ''; continue; }
    const key = top?.type === '{' ? top.last : '';
    const depth = stack.length;
    let kind: LabelRefKind | null = null;
    if (depth === 1 && key === 'intro') kind = 'intro';
    else if (depth === 2 && top.type === '[' && top.key === 'chapters') kind = 'chapter';
    else if (depth === 3 && key === 'label' && stack[1].key === 'chapters') kind = 'chapter';
    if (kind) {
      const line = lineOf(m.index);
      refs.push({ file, line: line + 1, col: m.index + 1 - lineStarts[line], length: value.length, name: value, kind });
    }
    pendingKey = '';
  }
  return refs;
}

/** Every definition and mention of a label in the project: `.vn` scripts and game.json (other files are ignored). */
export function labelRefs(files: ProjectFile[]): LabelRef[] {
  return files.flatMap(f => f.name.endsWith('.vn') ? scriptRefs(f.name, f.text) : f.name === 'game.json' || f.name.endsWith('/game.json') ? jsonRefs(f.name, f.text) : []);
}

/** The label named at a position (1-based line, 0-based column), on its definition or on a reference to it. */
export function labelAt(files: ProjectFile[], file: string, line: number, col: number): LabelRef | undefined {
  return labelRefs(files).find(r => r.file === file && r.line === line && col >= r.col && col <= r.col + r.length);
}

/** Edits that rename label `from` to `to` everywhere, or why that cannot be done. */
export function renameLabel(files: ProjectFile[], from: string, to: string): RenameResult {
  if (!NAME.test(to)) return { ok: false, error: `"${to}" is not a valid label name (letters, digits and _, not starting with a digit)` };
  const refs = labelRefs(files);
  if (!refs.some(r => r.kind === 'label' && r.name === from)) return { ok: false, error: `No label "${from}" in the scripts` };
  if (to === from) return { ok: false, error: 'That is already the name' };
  if (refs.some(r => r.kind === 'label' && r.name === to)) return { ok: false, error: `A label "${to}" already exists` };
  return { ok: true, edits: refs.filter(r => r.name === from).map(r => ({ file: r.file, line: r.line, col: r.col, length: r.length, text: to })) };
}

/** Apply edits to one file's text (for tests and non-Monaco callers). */
export function applyTextEdits(text: string, edits: TextEdit[]): string {
  const lines = text.split('\n');
  for (const e of [...edits].sort((a, b) => b.line - a.line || b.col - a.col)) {
    const l = lines[e.line - 1];
    lines[e.line - 1] = l.slice(0, e.col) + e.text + l.slice(e.col + e.length);
  }
  return lines.join('\n');
}

export interface FindOptions { find: string; regex?: boolean; matchCase?: boolean; wholeWord?: boolean }
export interface FindMatch { file: string; line: number; col: number; length: number; /** The matched text. */ text: string; /** The whole line, for showing the hit in context. */ preview: string }

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The regexp for a search, or an error message (empty search, bad pattern). */
export function searchPattern(o: FindOptions): RegExp | string {
  if (!o.find) return 'Type something to find';
  try {
    const src = o.regex ? o.find : escapeRe(o.find);
    return new RegExp(o.wholeWord ? `\\b(?:${src})\\b` : src, o.matchCase ? 'g' : 'gi');
  } catch (e) { return e instanceof Error ? e.message : String(e); }
}

function scan(files: ProjectFile[], re: RegExp): { match: FindMatch; groups: RegExpExecArray }[] {
  const out: { match: FindMatch; groups: RegExpExecArray }[] = [];
  for (const f of files) {
    f.text.split(/\r?\n/).forEach((line, i) => {
      re.lastIndex = 0;
      for (let m = re.exec(line); m; m = re.exec(line)) {
        if (!m[0]) { re.lastIndex++; continue; }
        out.push({ match: { file: f.name, line: i + 1, col: m.index, length: m[0].length, text: m[0], preview: line }, groups: m });
      }
    });
  }
  return out;
}

/** Every match of a search in the given files, line by line (a match never spans lines). */
export function findInFiles(files: ProjectFile[], o: FindOptions): { matches: FindMatch[] } | { error: string } {
  const re = searchPattern(o);
  return typeof re === 'string' ? { error: re } : { matches: scan(files, re).map(s => s.match) };
}

/** Edits that replace every match (`$1`, `$&` and `$$` work when the search is a regexp). */
export function replaceInFiles(files: ProjectFile[], o: FindOptions, replacement: string): { edits: TextEdit[] } | { error: string } {
  const re = searchPattern(o);
  if (typeof re === 'string') return { error: re };
  const expand = (g: RegExpExecArray) => replacement.replace(/\$(\$|&|\d{1,2})/g, (all, k: string) => k === '$' ? '$' : k === '&' ? g[0] : g[Number(k)] ?? all);
  return { edits: scan(files, re).map(({ match: m, groups }) => ({ file: m.file, line: m.line, col: m.col, length: m.length, text: o.regex ? expand(groups) : replacement })) };
}
