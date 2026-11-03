// Script statistics: how much text the player reads, per script file, label and character, with a reading-time estimate.
// Pure and DOM-free (`vn stats` and the editor's palette command are thin wrappers). Counts come from the compiled
// program, so only text the player can see counts: dialogue and narration (`say`), menu prompts, options and their
// `else` reasons, and `input` prompts. Comments, commands, ids and text tags do not.

import { parseRich } from './text.js';
import type { Op, Program } from './types.js';

export interface TextCount {
  /** Dialogue lines, menu options and prompts. */
  lines: number;
  /** Words separated by spaces; a `[variable]` is one word. */
  words: number;
  /** Characters other than spaces (what translators quote by for languages written without spaces). */
  chars: number;
}

export interface NamedCount extends TextCount { name: string }
export interface LabelCount extends NamedCount { file: string }
export interface CharacterCount extends NamedCount {
  /** The `define` id, or null for narration. */
  id: string | null;
}

export interface ScriptStats {
  /** All the text the player reads. */
  total: TextCount;
  /** Menu prompts, options, `else` reasons and `input` prompts (part of `total`, in no character). */
  choices: TextCount;
  /** Per script file, in file order. */
  files: NamedCount[];
  /** Per label, in script order; text before a file's first label is under "(top level)". */
  labels: LabelCount[];
  /** Spoken lines per character, most words first; narration is the one with `id` null. */
  characters: CharacterCount[];
  /** The localizable strings, each id once (dialogue, menus, screens, item names): what a translation is quoted by. */
  translation: TextCount;
  /** Estimated reading time of `total` at `wordsPerMinute`, in minutes. */
  minutes: number;
  wordsPerMinute: number;
}

const TOP = '(top level)', NARRATOR = '(narration)';

/** The text with tags (`{b}`, `{pause=1}`) taken out; a `[variable]` or keyed plural becomes one word. */
export function plainText(text: string): string {
  const shown = parseRich(text).map(s => (s.kind === 'text' ? s.text : ' ')).join('');
  return shown.replace(/\[[^\][]*\]/g, 'x');
}

/** Lines, words and characters of one piece of player-facing text. */
export function countText(text: string): TextCount {
  const plain = plainText(text);
  const words = plain.split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length; // a lone "..." or dash is no word
  return { lines: 1, words, chars: plain.replace(/\s+/g, '').length };
}

const zero = (): TextCount => ({ lines: 0, words: 0, chars: 0 });
const add = (to: TextCount, c: TextCount) => { to.lines += c.lines; to.words += c.words; to.chars += c.chars; };

/** The player-facing texts of one op. */
function opTexts(op: Op): string[] {
  if (op.op === 'say') return [op.text];
  if (op.op === 'input') return [op.prompt];
  if (op.op === 'menu') {
    const out = op.prompt !== null ? [op.prompt] : [];
    for (const o of op.options) { out.push(o.text); if (o.reason !== null) out.push(o.reason); }
    return out;
  }
  return [];
}

/** Count the text of `program`. `wordsPerMinute` sets the reading speed (default 200, an unhurried reader). */
export function scriptStats(program: Program, wordsPerMinute = 200): ScriptStats {
  const total = zero(), choices = zero();
  const files = new Map<string, NamedCount>();
  const labels = new Map<string, LabelCount>();
  const characters = new Map<string | null, CharacterCount>();

  // The label an op belongs to: the last one starting at or before it in the same file.
  const starts = new Map<number, string>();
  for (const [name, pc] of Object.entries(program.labels)) if (!starts.has(pc)) starts.set(pc, name);
  let label = TOP, labelFile = '';

  program.ops.forEach((op, pc) => {
    const file = op.src.file;
    if (starts.has(pc)) { label = starts.get(pc)!; labelFile = file; } else if (file !== labelFile) { label = TOP; labelFile = file; }
    const texts = opTexts(op);
    if (!texts.length) return;
    const fileCount = files.get(file) ?? { name: file, ...zero() };
    files.set(file, fileCount);
    const key = `${file}\0${label}`;
    const labelCount = labels.get(key) ?? { name: label, file, ...zero() };
    labels.set(key, labelCount);
    for (const t of texts) {
      const c = countText(t);
      add(total, c); add(fileCount, c); add(labelCount, c);
      if (op.op !== 'say') { add(choices, c); continue; }
      const id = op.who;
      const who = characters.get(id) ?? { id, name: id === null ? NARRATOR : program.characters[id]?.name || id, ...zero() };
      characters.set(id, who);
      add(who, c);
    }
  });

  const translation = zero();
  for (const text of Object.values(program.strings)) add(translation, countText(text));

  return {
    total, choices,
    files: [...files.values()],
    labels: [...labels.values()],
    characters: [...characters.values()].sort((a, b) => b.words - a.words || a.name.localeCompare(b.name)),
    translation,
    minutes: total.words / wordsPerMinute,
    wordsPerMinute,
  };
}

/** A reading time as "about 1 h 20 min", "about 12 min" or "under a minute". */
export function readingTime(minutes: number): string {
  if (minutes < 1) return 'under a minute';
  const m = Math.round(minutes);
  return m < 60 ? `about ${m} min` : `about ${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
}

/** The statistics as plain text (the CLI prints it, the editor shows it in the Output panel). */
export function statsText(stats: ScriptStats, title = 'Script statistics'): string {
  const n = (c: TextCount) => `${c.words} words, ${c.lines} lines, ${c.chars} characters`;
  const rows = (items: NamedCount[], name: (i: NamedCount) => string[]) => {
    const cols = items.map(name);
    const widths = cols[0].map((_, k) => Math.max(...cols.map(c => c[k].length)));
    return items.map((i, r) => `  ${cols[r].map((c, k) => c.padEnd(widths[k])).join('  ')}  ${String(i.words).padStart(7)} words  ${String(i.lines).padStart(6)} line${i.lines === 1 ? '' : 's'}`);
  };
  const out = [
    `${title}: ${n(stats.total)}`,
    `  reading time ${readingTime(stats.minutes)} (at ${stats.wordsPerMinute} words a minute, every route read once)`,
    `  choices and prompts: ${n(stats.choices)}`,
    `  to translate: ${n(stats.translation)} (localizable strings, each once)`,
  ];
  if (stats.characters.length) out.push('', 'Characters', ...rows(stats.characters, i => [i.name]));
  if (stats.files.length) out.push('', 'Scripts', ...rows(stats.files, i => [i.name]));
  if (stats.labels.length) out.push('', 'Labels', ...rows(stats.labels, i => [(i as LabelCount).file, i.name]));
  return out.join('\n');
}
