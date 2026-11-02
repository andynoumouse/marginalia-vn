// `path/file.ext:line[:col]` references in tool output (export, strings, art tasks), so the editor can link them.

/** One reference found in a line of text; `start`/`end` are offsets into that line. */
export interface FileRef { start: number; end: number; path: string; line: number; col?: number }

// A path (optionally with a drive letter) that ends in `name.ext`, then `:line` and an optional `:col`. The lookbehind keeps
// matches from starting inside a longer word or after `:` (so `http://host.com:80` is not taken as a file).
const RE_REF = /(?<![\w.\/\\:-])((?:[A-Za-z]:[\\/])?[\w.\/\\-]*\w\.[A-Za-z][\w]*):(\d+)(?::(\d+))?(?!\d)/g;

/** Every `file.ext:line` / `file.ext:line:col` reference in `text`, in order. Line 0 is not a reference. */
export function findFileRefs(text: string): FileRef[] {
  const out: FileRef[] = [];
  for (const m of text.matchAll(RE_REF)) {
    const line = Number(m[2]);
    if (line < 1) continue;
    const ref: FileRef = { start: m.index!, end: m.index! + m[0].length, path: m[1], line };
    if (m[3] !== undefined) ref.col = Number(m[3]);
    out.push(ref);
  }
  return out;
}

/**
 * The name in `names` (the editor's open files, such as `park.vn` or `char/mia/rig.json`) that `path` points to: the same
 * name, or a path ending in `/name` (`script/park.vn`, `C:\proj\script\park.vn`). The longest such name wins; none gives undefined.
 */
export function resolveFileRef(path: string, names: Iterable<string>): string | undefined {
  const p = path.replace(/\\/g, '/');
  let best: string | undefined;
  for (const n of names) {
    if ((p === n || p.endsWith(`/${n}`)) && (best === undefined || n.length > best.length)) best = n;
  }
  return best;
}
