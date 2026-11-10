// "Did you mean": the known names closest to a mistyped one, for diagnostics and the editor's quick fixes.
// Pure functions, no DOM.

import type { Diagnostic, Src } from './types.js';
import { maskStrings } from './script-lex.js';

/** Edits (insert, delete, change, or swap two neighbours) that turn `a` into `b`; case is ignored. */
export function editDistance(a: string, b: string): number {
  a = a.toLowerCase(); b = b.toLowerCase();
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/**
 * Up to `max` names from `known` close enough to `word` to be what was meant: about a third of the word's letters may
 * be wrong, and only the closest names count (a tie gives several, by name). Empty when nothing is close or `word` is
 * itself known.
 */
export function closest(word: string, known: Iterable<string>, max = 3): string[] {
  const names = [...new Set(known)];
  if (!word || names.includes(word)) return [];
  const scored = names.map(name => ({ name, d: editDistance(word, name) }));
  const best = Math.min(...scored.map(x => x.d));
  if (!(best <= Math.max(1, Math.round(word.length / 3)))) return [];
  return scored.filter(x => x.d === best).map(x => x.name).sort().slice(0, max);
}

/**
 * Where `word` stands in a line as a whole word (not inside a longer name or a quoted string), as [start, end)
 * character offsets of its first such place; null when it is not there. Used to replace it with a fix.
 */
export function wordSpan(line: string, word: string): [number, number] | null {
  if (!word) return null;
  const isName = (c: string | undefined) => c !== undefined && /[\w.]/.test(c);
  const code = maskStrings(line); // a word inside "quotes" is text, not the one meant
  for (let i = 0; i <= code.length - word.length; i++) {
    if (!code.startsWith(word, i) || isName(code[i - 1]) || isName(code[i + word.length])) continue;
    return [i, i + word.length];
  }
  return null;
}

/** ` (did you mean "show"?)` for a message, or '' when nothing is close. */
export function didYouMean(options: string[]): string {
  if (!options.length) return '';
  return ` (did you mean ${options.map(o => `"${o}"`).join(' or ')}?)`;
}

/**
 * A diagnostic about `word` on `src`'s line, with the close names as a message hint and as quick fixes; `otherwise`
 * ends the message when nothing is close (`' (add a define line)'`).
 */
export function withFix(src: Src, severity: Diagnostic['severity'], message: string, word: string, known: Iterable<string>, otherwise = ''): Diagnostic {
  const options = closest(word, known);
  return { file: src.file, line: src.line, severity, message: message + (options.length ? didYouMean(options) : otherwise), ...(options.length ? { fix: { word, options } } : {}) };
}
