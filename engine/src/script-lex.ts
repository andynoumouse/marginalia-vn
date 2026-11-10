// Quotes and comments on one script line, shared by the parser and the tools that read scripts as text (rename, asset
// references, suggestions, completions), so they all agree on what is text, what is code and where a comment starts.

/** The line with the inside of every "string" blanked (same length, quotes kept), so words in text are never taken for syntax. */
export function maskStrings(line: string): string {
  let out = '', quote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote && c === '\\') { out += i + 1 < line.length ? '  ' : ' '; i++; continue; }
    if (c === '"') { quote = !quote; out += c; continue; }
    out += quote ? ' ' : c;
  }
  return out;
}

/** The [from, to) ranges inside "quotes" (an unclosed one is left out). */
export function quotedRanges(line: string): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let i = 0; i < line.length; i++) {
    if (start >= 0 && line[i] === '\\') { i++; continue; }
    if (line[i] !== '"') continue;
    if (start < 0) start = i + 1; else { out.push([start, i]); start = -1; }
  }
  return out;
}

/** Whether the line ends inside an unclosed "string" (escaped quotes do not count). */
export function endsInString(line: string): boolean {
  let quote = false;
  for (let i = 0; i < line.length; i++) {
    if (quote && line[i] === '\\') i++;
    else if (line[i] === '"') quote = !quote;
  }
  return quote;
}

/**
 * Where the line's comment starts, or -1: a `#` that opens the line, or one outside quotes with a space before and
 * after it (or ending the line). `#ff6fa5`, `#000` and an id like `#ab12` are not comments.
 */
export function commentStart(line: string): number {
  const lead = /^\s*/.exec(line)![0].length;
  if (line[lead] === '#') return lead;
  let quote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '\\') i++;
    else if (c === '"') quote = !quote;
    else if (c === '#' && !quote && i > 0 && /\s/.test(line[i - 1]) && (i + 1 === line.length || /\s/.test(line[i + 1]))) return i;
  }
  return -1;
}

/** The line without a trailing comment (see `commentStart`), trailing spaces trimmed. */
export function withoutComment(line: string): string {
  const at = commentStart(line);
  return at < 0 ? line : line.slice(0, at).trimEnd();
}
