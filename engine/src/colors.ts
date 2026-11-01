/**
 * Hex colors in the project's text, for the editor's color swatches and picker. Pure text in, positions out.
 * In a script a color is only taken where one is valid: after `=` (`color=`, `text=`, `{color=#...}`) or after
 * `tint` / `flash`, so a string id like `#ab12` is never mistaken for one. In game.json any string that is a hex color.
 */

/** A hex color in the text: 1-based line, 0-based column and length of the `#...` token, and its parsed value. */
export interface ColorRef { line: number; col: number; length: number; r: number; g: number; b: number; a: number }

const HEX = '#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_])';
const RE_SCRIPT = new RegExp(`(?:(?<==)|(?<=\\b(?:tint|flash)[ \\t]+))${HEX}`, 'g');
const RE_JSON = new RegExp(`(?<=")${HEX}(?=")`, 'g');

/** `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa` as channels in 0-1; undefined if it is not one. */
export function parseHex(s: string): { r: number; g: number; b: number; a: number } | undefined {
  const m = /^#([0-9a-fA-F]+)$/.exec(s);
  if (!m || ![3, 4, 6, 8].includes(m[1].length)) return undefined;
  let h = m[1];
  if (h.length <= 4) h = [...h].map(c => c + c).join('');
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) : 1 };
}

/** Channels in 0-1 as `#rrggbb`, or `#rrggbbaa` when the color is not opaque. */
export function formatHex(c: { r: number; g: number; b: number; a: number }): string {
  const h = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}${c.a < 1 ? h(c.a) : ''}`;
}

/** Every hex color in a script (`kind` 'vn') or game.json (`kind` 'json'). Comment lines are skipped in scripts. */
export function findColors(text: string, kind: 'vn' | 'json'): ColorRef[] {
  const out: ColorRef[] = [];
  const re = kind === 'json' ? RE_JSON : RE_SCRIPT;
  text.split('\n').forEach((line, i) => {
    if (kind === 'vn' && line.trimStart().startsWith('#')) return;
    re.lastIndex = 0;
    for (let m; (m = re.exec(line));) {
      const c = parseHex(m[0]);
      if (c) out.push({ line: i + 1, col: m.index, length: m[0].length, ...c });
    }
  });
  return out;
}
