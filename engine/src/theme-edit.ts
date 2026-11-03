// What the editor's theme panel needs from a theme file: the fields it shows, reading and writing one value by path in
// the file's JSON text, and where an unset value comes from (the `extends` chain). Pure, so it is tested in node.

import { UI_COMPONENTS } from './theme.js';
import { contrast } from './colors.js';

export type FieldKind = 'color' | 'number' | 'font' | 'text';
export interface ThemeField { path: string[]; label: string; kind: FieldKind }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export const TOKEN_FIELDS: ThemeField[] = [
  ...(['accent', 'text', 'muted', 'surface', 'line', 'danger', 'warn'] as const).map(k => ({ path: ['tokens', k], label: k, kind: 'color' as const })),
  { path: ['tokens', 'font'], label: 'font', kind: 'font' },
  { path: ['tokens', 'uiFont'], label: 'uiFont', kind: 'font' },
  ...(['radius', 'borderWidth', 'gap', 'uiSize'] as const).map(k => ({ path: ['tokens', k], label: k, kind: 'number' as const })),
];

const LOOK_FIELDS: { key: string; kind: FieldKind }[] = [
  { key: 'background', kind: 'color' }, { key: 'color', kind: 'color' }, { key: 'border', kind: 'color' }, { key: 'borderWidth', kind: 'number' },
  { key: 'radius', kind: 'number' }, { key: 'size', kind: 'number' }, { key: 'opacity', kind: 'number' }, { key: 'width', kind: 'number' }, { key: 'shadow', kind: 'text' },
];

/** The in-game text parts, which have their own fields (the rest of the components share the look fields above). */
const BOX_FIELDS: Record<string, { key: string; kind: FieldKind }[]> = {
  textbox: [{ key: 'x', kind: 'number' }, { key: 'y', kind: 'number' }, { key: 'width', kind: 'number' }, { key: 'height', kind: 'number' },
    { key: 'background', kind: 'color' }, { key: 'border', kind: 'color' }, { key: 'radius', kind: 'number' }],
  namebox: [{ key: 'x', kind: 'number' }, { key: 'y', kind: 'number' }, { key: 'width', kind: 'number' }, { key: 'height', kind: 'number' },
    { key: 'background', kind: 'color' }, { key: 'border', kind: 'color' }, { key: 'radius', kind: 'number' }, { key: 'size', kind: 'number' }],
  text: [{ key: 'size', kind: 'number' }, { key: 'color', kind: 'color' }, { key: 'lineHeight', kind: 'number' }, { key: 'lines', kind: 'number' }],
  choice: [{ key: 'width', kind: 'number' }, { key: 'height', kind: 'number' }, { key: 'background', kind: 'color' }, { key: 'border', kind: 'color' },
    { key: 'radius', kind: 'number' }, { key: 'size', kind: 'number' }, { key: 'gap', kind: 'number' }],
};
const isBoxKey = (key: string) => Object.hasOwn(BOX_FIELDS, key);

/** The component keys of a theme (`textbox`, `button`, `button.primary`, ...). */
export function componentKeys(): string[] {
  return [...Object.keys(BOX_FIELDS), ...Object.entries(UI_COMPONENTS).flatMap(([k, c]) => [k, ...Object.keys(c.variants ?? {}).map(v => `${k}.${v}`)])];
}

/** The states a component key can take (`selected` only where the component has a selected form); `''` is the resting look. */
export function componentStates(key: string): string[] {
  if (isBoxKey(key)) return key === 'choice' ? ['', 'hover', 'focus', 'disabled'] : [''];
  const c = Object.hasOwn(UI_COMPONENTS, key.split('.')[0]) ? UI_COMPONENTS[key.split('.')[0]] : undefined;
  return ['', 'hover', 'focus', 'disabled', ...(c?.selected ? ['selected'] : [])];
}

/** The look fields of one component key in one state. */
export function componentFields(key: string, state = ''): ThemeField[] {
  const list = isBoxKey(key) && !state ? BOX_FIELDS[key] : LOOK_FIELDS;
  return list.map(f => ({ path: ['components', key, ...(state ? [state] : []), f.key], label: f.key, kind: f.kind }));
}

export function getValue(obj: unknown, path: string[]): unknown {
  let v: unknown = obj;
  for (const k of path) { if (!isObj(v) || !Object.hasOwn(v, k)) return undefined; v = v[k]; }
  return v;
}

/** The theme text with `path` set to `value` (undefined removes it, and parents left empty). Null if the text is not a JSON object. */
export function setValue(text: string, path: string[], value: unknown): string | null {
  let root: unknown;
  try { root = JSON.parse(text); } catch { return null; }
  if (!isObj(root)) return null;
  const chain: Record<string, unknown>[] = [root];
  for (const k of path.slice(0, -1)) {
    const cur = chain[chain.length - 1];
    let next = Object.hasOwn(cur, k) ? cur[k] : undefined;
    if (!isObj(next)) {
      if (value === undefined) return text;
      next = cur[k] = {};
    }
    chain.push(next as Record<string, unknown>);
  }
  const last = path[path.length - 1];
  if (value === undefined) delete chain[chain.length - 1][last]; else chain[chain.length - 1][last] = value;
  for (let i = chain.length - 1; i > 0; i--) if (Object.keys(chain[i]).length === 0) delete chain[i - 1][path[i - 1]];
  return `${JSON.stringify(root, null, 2)}\n`;
}

/** Where `path` gets its value for theme `name`: its own file, a theme it extends (named), or nowhere. */
export function valueSource(name: string, path: string[], files: Record<string, unknown>): { value: unknown; from: string | null } {
  const seen: string[] = [];
  let n: unknown = name;
  while (typeof n === 'string' && !seen.includes(n) && Object.hasOwn(files, n)) {
    seen.push(n);
    const v = getValue(files[n], path);
    if (v !== undefined) return { value: v, from: n };
    n = getValue(files[n], ['extends']);
  }
  return { value: undefined, from: null };
}

/** The stage's own palette, which a theme's tokens replace. */
export const TOKEN_DEFAULTS: Record<string, string> = {
  text: '#e6e9ef', muted: '#8b93a3', accent: '#5fd1c3', surface: '#0e1117', line: '#ffffff', danger: '#f0707a', warn: '#e8b64c',
};

/**
 * Fonts most players have without the game shipping them (Windows, macOS and the big Linux/Android sets overlap only
 * partly, so none is guaranteed). A theme font that is neither one of these nor a file in assets/fonts/ falls back to
 * Iowan Old Style, Georgia or the browser's serif where it is missing.
 */
export const COMMON_FONTS = ['Georgia', 'Palatino Linotype', 'Times New Roman', 'Arial', 'Verdana', 'Trebuchet MS', 'Tahoma', 'Courier New', 'Segoe UI'];

/** A warning for a font field naming a font that players may not have, or null; `projectFonts` are the names in assets/fonts/. */
export function fontNote(font: string, projectFonts: string[]): string | null {
  if (!font || projectFonts.includes(font) || COMMON_FONTS.includes(font)) return null;
  return `"${font}" is not in assets/fonts/ or a common system font; players without it see the fallback serif`;
}

const fmt = (n: number) => (Math.floor(n * 10) / 10).toFixed(1);

/**
 * A readability note for the color field at `path`, or null when it is fine or cannot be judged. `get` gives the value
 * a path has for the theme (own or inherited), undefined if unset. Text colors are held to 4.5:1 against the background
 * they sit on (WCAG AA), accent-like colors to 3:1. Only hex and `rgb()` colors are judged.
 */
export function contrastNote(path: string[], get: (path: string[]) => unknown): string | null {
  const str = (p: string[], fallback?: string): string | undefined => { const v = get(p); return typeof v === 'string' ? v : fallback; };
  const tok = (k: string) => str(['tokens', k], TOKEN_DEFAULTS[k])!;
  const check = (fg: string | undefined, bg: string | undefined, what: string, min: number) => {
    if (fg === undefined || bg === undefined) return null;
    const r = contrast(fg, bg);
    return r !== undefined && r < min ? `Contrast ${fmt(r)}:1 with ${what} (aim for ${min}:1)` : null;
  };
  const last = path[path.length - 1];
  if (path[0] === 'tokens' && path.length === 2) {
    if (last === 'surface') return check(tok('text'), tok('surface'), 'the text color', 4.5);
    if (last === 'text' || last === 'muted') return check(tok(last), tok('surface'), 'surface', 4.5);
    if (last === 'accent' || last === 'danger' || last === 'warn') return check(tok(last), tok('surface'), 'surface', 3);
    return null;
  }
  // The dialogue text sits on the text box, the speaker's name on the name tag (neither is a menu component).
  if (path[0] === 'components' && path.length === 3 && (last === 'color' || last === 'background')) {
    const pair = path[1] === 'text' || path[1] === 'textbox' ? ['text', 'textbox', tok('text'), '#0a0d13'] : path[1] === 'namebox' ? ['namebox', 'namebox', '#ffffff', '#20252f'] : null;
    if (pair) {
      const fg = str(['components', pair[0], 'color'], pair[2]), bg = str(['components', pair[1], 'background'], pair[3]);
      if (str(path) === undefined) return null;
      return check(fg, bg, last === 'color' ? 'the box behind it' : 'its text color', 4.5);
    }
  }
  if (path[0] !== 'components' || path.length < 3 || path.length > 4 || (last !== 'color' && last !== 'background')) return null;
  if (!Object.hasOwn(UI_COMPONENTS, path[1].split('.')[0]) || path[1].startsWith('slider')) return null;
  const base = path.slice(0, -1), rest = path.length === 4 ? ['components', path[1]] : null;
  const pick = (k: string) => str([...base, k]) ?? (rest ? str([...rest, k]) : undefined);
  const fg = pick('color') ?? tok('text'), bg = pick('background') ?? tok('surface');
  if (pick(last) === undefined) return null;
  return check(fg, bg, last === 'color' ? 'its background' : 'its text color', 4.5);
}

const LEGACY_MOVES: [string, string[]][] = [
  ['accent', ['tokens', 'accent']], ['font', ['tokens', 'font']],
  ['textbox', ['components', 'textbox']], ['namebox', ['components', 'namebox']], ['text', ['components', 'text']],
  ['choices', ['components', 'choice']],
  ['hotFill', ['components', 'hotspot', 'background']], ['hotBorder', ['components', 'hotspot', 'border']],
  ['hotBorderWidth', ['components', 'hotspot', 'borderWidth']],
  ['tipBackground', ['components', 'tooltip', 'background']], ['tipColor', ['components', 'tooltip', 'color']],
  ['tipFont', ['components', 'tooltip', 'font']],
  ['skins', ['styles']],
];

/**
 * The quick fix for an inline `theme` object in game.json: the theme as a layered theme file (legacy keys mapped onto
 * their new places, docs/design/theming.md) and the game.json text with `"theme": "<name>"` in its place. `name` is the
 * first of `default`, `theme`, `theme2`... not in `taken`. Null if game.json has no inline theme object.
 */
export function moveInlineTheme(gameText: string, taken: string[]): { name: string; themeText: string; gameText: string } | null {
  let game: unknown;
  try { game = JSON.parse(gameText); } catch { return null; }
  if (!isObj(game) || !isObj(game.theme)) return null;
  const inline = game.theme;
  const out: Record<string, unknown> = {};
  const layered = new Set(['extends', 'tokens', 'components', 'styles']);
  for (const k of layered) if (Object.hasOwn(inline, k)) out[k] = structuredClone(inline[k]);
  if (out.extends === undefined) out.extends = 'base';
  const moved = new Set(LEGACY_MOVES.map(([k]) => k));
  for (const [key, to] of LEGACY_MOVES) {
    if (!Object.hasOwn(inline, key) || inline[key] === undefined) continue;
    if (getValue(out, to) !== undefined) continue; // the layered form wins, as in normalizeTheme
    const next = setValue(JSON.stringify(out), to, structuredClone(inline[key]));
    if (next !== null) Object.assign(out, JSON.parse(next));
  }
  for (const [k, v] of Object.entries(inline)) if (!layered.has(k) && !moved.has(k)) out[k] = structuredClone(v); // keys this fix does not know stay
  const name = ['default', 'theme', ...Array.from({ length: 98 }, (_, i) => `theme${i + 2}`)].find(n => !taken.includes(n)) ?? 'theme-moved';
  game.theme = name;
  return { name, themeText: `${JSON.stringify(out, null, 2)}\n`, gameText: `${JSON.stringify(game, null, 2)}\n` };
}
