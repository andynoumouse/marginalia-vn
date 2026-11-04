// game.json "theme" -> a stylesheet for the stage: tokens (accent, font) as `--vn-*` variables on #stage, the text box,
// name tag, choices and text, per-character skins (`define alice ... box=alice` uses theme.skins.alice) and @font-face
// rules for assets/fonts/*. Coordinates and sizes are in stage pixels. Image frames are 9-slice: `slice` px of each
// edge stay unscaled (art from masters/ui/<name>.psd -> assets/ui/<name>.png). Design: docs/design/theming.md.

import { isCssColor, parseColor, formatHex } from './colors.js';

export interface BoxTheme {
  x?: number; y?: number; width?: number; height?: number;
  padding?: number | number[];
  background?: string;
  border?: string;   // border color (2px)
  radius?: number;
  image?: string;    // assets/ui/<image>.png
  slice?: number | number[];
}
export interface TextTheme { size?: number; color?: string; lineHeight?: number; lines?: number }
/**
 * A named style (`styles.<name>`), used by `define ... style=`, `style=` on a line or a menu, and `style=` on a screen
 * button or text. Appearance only: placement and size keys are ignored. `choice` styles a menu's buttons, `button` a screen
 * button, and `text` the dialogue text (and the color and size of a screen text).
 */
export interface Skin {
  textbox?: BoxTheme; namebox?: BoxTheme & { size?: number }; text?: TextTheme;
  choice?: BoxTheme & { size?: number; hover?: UiLook; focus?: UiLook; disabled?: UiLook };
  button?: UiComponent;
}
/** Color tokens beyond `accent`: the base palette of the stage (docs/design/theming.md). */
export interface Tokens { fonts?: Record<string, string>; radius?: number; borderWidth?: number; gap?: number; uiSize?: number; uiFont?: string; text?: string; muted?: string; surface?: string; line?: string; danger?: string; warn?: string }
/** Appearance of a menu building block (`button`, `panel`, `tab`, `row`, `pager`, `toast`) and of its states. */
export interface UiLook {
  background?: string; color?: string; border?: string; borderWidth?: number; radius?: number;
  padding?: number | number[]; size?: number; opacity?: number; shadow?: string; width?: number;
}
export type UiComponent = UiLook & { hover?: UiLook; selected?: UiLook; disabled?: UiLook; focus?: UiLook };
export interface Theme extends Skin {
  tokens?: Tokens;
  /** Components by key, variants with a dot (`button.primary`); see `UI_COMPONENTS`. */
  ui?: Record<string, UiComponent>;
  /** The same components, inside one built-in screen (`SCREEN_IDS`). */
  screens?: Record<string, Record<string, UiComponent>>;
  /** The theme's own stylesheet (`themes/<name>.css`, with those of the themes it extends), added after everything else. */
  css?: string;
  accent?: string;
  hotFill?: string; hotBorder?: string; hotBorderWidth?: number; // hotspot/button highlight of screens and HUDs
  tipBackground?: string; tipColor?: string; tipFont?: string;   // hotspot tooltip
  font?: string;
  choices?: BoxTheme & { size?: number; gap?: number; hover?: UiLook; focus?: UiLook; disabled?: UiLook };
  skins?: Record<string, Skin>;
}

/** A theme file (`themes/<name>.json`): the layered form of docs/design/theming.md, or the legacy `Theme` keys, or both. */
export interface ThemeFile extends Omit<Theme, 'screens'> {
  extends?: string;
  tokens?: Tokens & { accent?: string; font?: string };
  components?: {
    textbox?: BoxTheme; namebox?: BoxTheme & { size?: number }; text?: TextTheme; choice?: BoxTheme & { size?: number; gap?: number; hover?: UiLook; focus?: UiLook; disabled?: UiLook };
    hotspot?: { background?: string; border?: string; borderWidth?: number };
    tooltip?: { background?: string; color?: string; font?: string };
    [ui: string]: unknown;
  };
  styles?: Record<string, Skin>;
  screens?: Record<string, Record<string, unknown>>;
}

/**
 * Built-in themes a theme file can extend. `base` is the engine's own look, so it adds nothing; `paper` is a light,
 * warm look and `high-contrast` pure black and white with thick borders and larger menu text.
 */
export const BUILTIN_THEMES: Record<string, ThemeFile> = {
  base: {},
  paper: {
    tokens: { accent: '#9a4a2a', text: '#2b2118', muted: '#6b5c4c', surface: '#f3ead8', line: '#2b2118', danger: '#b02a30', warn: '#9a6a10' },
    components: { textbox: { background: 'rgba(243,234,216,0.94)', border: '#2b2118' }, text: { color: '#2b2118' } },
  },
  'high-contrast': {
    tokens: { accent: '#ffff00', text: '#ffffff', muted: '#d0d0d0', surface: '#000000', line: '#ffffff', danger: '#ff6060', warn: '#ffd000', borderWidth: 3, uiSize: 46 },
    components: { textbox: { background: '#000000', border: '#ffffff' }, text: { color: '#ffffff' } },
  },
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function mergeDeep(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = isObj(v) && isObj(out[k]) ? mergeDeep(out[k] as Record<string, unknown>, v) : v;
  return out;
}

export const SCREEN_IDS = ['title', 'pause', 'options', 'saves', 'history', 'gallery', 'music', 'chapters', 'achievements', 'confirm', 'saveName'];
const TOKEN_COLORS = ['text', 'muted', 'surface', 'line', 'danger', 'warn'] as const;

/** Components that style a stage element by selector. A key is `name` or `name.variant`. */
export const UI_COMPONENTS: Record<string, { selector: string; variants?: Record<string, string>; selected?: string }> = {
  button: { selector: '.screen button, .screen select, .sc-btn:not(#quickui .sc-btn)', variants: { primary: '[data-variant="primary"]', danger: '[data-variant="danger"]' } },
  panel: { selector: '.panel' },
  tab: { selector: '.sc-btn[role="tab"]', selected: '[aria-selected="true"]' },
  row: { selector: '.screen .row-list .row, .ach-row', selected: '[aria-current]' },
  pager: { selector: '.screen .pages button', selected: '[aria-current="page"]' },
  toast: { selector: '#toast, #achtoastui .sc-panel' },
  field: { selector: '#menu input, .save-name input' },
  quickmenu: { selector: '#quickui .sc-btn', selected: '[aria-pressed="true"]' },
  slider: { selector: '.sc-slider' },
  title: { selector: '.sc-text[data-style="title"]' },
};
const isUiKey = (k: string) => {
  const [base, variant, ...rest] = k.split('.');
  const c = Object.hasOwn(UI_COMPONENTS, base) ? UI_COMPONENTS[base] : undefined;
  return !!c && rest.length === 0 && (variant === undefined || (!!c.variants && Object.hasOwn(c.variants, variant)));
};

/** Maps the layered keys (tokens, components, styles) onto the flat `Theme`; legacy keys in the same object win over nothing, and layered ones win over legacy. */
export function normalizeTheme(raw: ThemeFile): Theme {
  const { extends: _ext, tokens, components, styles, screens, ...legacy } = raw;
  void _ext;
  const c = components ?? {};
  const h = c.hotspot, t = c.tooltip;
  const ui: Record<string, UiComponent> = {};
  for (const [k, v] of Object.entries(c)) if (isUiKey(k) && isObj(v)) ui[k] = v as UiComponent;
  const scr: Record<string, Record<string, UiComponent>> = {};
  for (const [id, comps] of Object.entries(screens ?? {})) {
    if (!SCREEN_IDS.includes(id) || !isObj(comps)) continue;
    const own: Record<string, UiComponent> = {};
    for (const [k, v] of Object.entries(comps)) if (isUiKey(k) && isObj(v)) own[k] = v as UiComponent;
    if (Object.keys(own).length) scr[id] = own;
  }
  const palette: Tokens = {};
  for (const k of ['radius', 'borderWidth', 'gap', 'uiSize'] as const) if (typeof tokens?.[k] === 'number') palette[k] = tokens[k];
  if (tokens?.uiFont !== undefined) palette.uiFont = tokens.uiFont;
  if (isObj(tokens?.fonts)) palette.fonts = tokens.fonts;
  for (const k of TOKEN_COLORS) if (tokens?.[k] !== undefined) palette[k] = tokens[k];
  const layered: Theme = {
    ...(tokens?.accent !== undefined ? { accent: tokens.accent } : {}),
    ...(tokens?.font !== undefined ? { font: tokens.font } : {}),
    ...(Object.keys(palette).length ? { tokens: palette } : {}),
    ...(Object.keys(ui).length ? { ui } : {}),
    ...(Object.keys(scr).length ? { screens: scr } : {}),
    ...(c.textbox ? { textbox: c.textbox } : {}), ...(c.namebox ? { namebox: c.namebox } : {}), ...(c.text ? { text: c.text } : {}),
    ...(c.choice ? { choices: c.choice } : {}),
    ...(h?.background !== undefined ? { hotFill: h.background } : {}), ...(h?.border !== undefined ? { hotBorder: h.border } : {}),
    ...(h?.borderWidth !== undefined ? { hotBorderWidth: h.borderWidth } : {}),
    ...(t?.background !== undefined ? { tipBackground: t.background } : {}), ...(t?.color !== undefined ? { tipColor: t.color } : {}),
    ...(t?.font !== undefined ? { tipFont: t.font } : {}),
    ...(styles ? { skins: styles } : {}),
  };
  return mergeDeep(legacy as Record<string, unknown>, layered as Record<string, unknown>) as Theme;
}

/**
 * game.json `theme` as a flat Theme: an object is the inline (legacy) form; a string names `themes/<name>.json` in `files`
 * (name -> parsed JSON), followed through `extends` (project themes first, then built-in ones). Problems go to `warn`
 * and the theme falls back to what could be read; a missing file gives the plain built-in look.
 */
export function resolveTheme(theme: unknown, files: Record<string, unknown>, warn: (message: string) => void = () => {}): Theme {
  if (isObj(theme)) return normalizeTheme(theme as ThemeFile);
  if (typeof theme !== 'string') return {};
  const load = (n: string, seen: string[]): ThemeFile => {
    if (seen.includes(n)) { warn(`Theme "${n}" extends itself (${[...seen, n].join(' -> ')})`); return {}; }
    const raw = Object.hasOwn(files, n) ? files[n] : Object.hasOwn(BUILTIN_THEMES, n) ? BUILTIN_THEMES[n] : undefined;
    if (!isObj(raw)) { warn(raw === undefined ? `No theme "${n}" (add themes/${n}.json)` : `Theme "${n}" needs a JSON object`); return {}; }
    const own = raw as ThemeFile;
    if (own.extends === undefined) return own;
    if (typeof own.extends !== 'string') { warn(`Theme "${n}": extends needs a theme name`); return own; }
    const parent = normalizeTheme(load(own.extends, [...seen, n]));
    return mergeDeep(parent as Record<string, unknown>, normalizeTheme(own) as Record<string, unknown>) as ThemeFile;
  };
  return normalizeTheme(load(theme, []));
}

/**
 * The CSS of theme `name` (`themes/<name>.css`, `css` by theme name) with the files of the themes it extends before it,
 * so a child's rules win. A theme without a stylesheet adds nothing; a cycle stops where it closes.
 */
export function themeStylesheet(name: string, files: Record<string, unknown>, css: Record<string, string>): string {
  const parts: string[] = [];
  const seen: string[] = [];
  for (let n: string | undefined = name; n !== undefined && !seen.includes(n); ) {
    seen.push(n);
    if (Object.hasOwn(css, n)) parts.unshift(css[n]);
    const raw: unknown = Object.hasOwn(files, n) ? files[n] : Object.hasOwn(BUILTIN_THEMES, n) ? BUILTIN_THEMES[n] : undefined;
    const ext: unknown = isObj(raw) ? raw.extends : undefined;
    n = typeof ext === 'string' ? ext : undefined;
  }
  return parts.join('\n');
}

/** A theme stylesheet may not load anything from the network: `@import` and `url()` of a scheme or `//` host are removed. */
const localCss = (css: string) => css.replace(/@import\b[^;]*;?/gi, '').replace(/url\(\s*(["']?)\s*(?:[a-z][a-z0-9+.-]*:|\/\/)[^)]*\)/gi, m => /^url\(\s*["']?\s*data:/i.test(m) ? m : 'none');

const FONT = /^fonts\/([^/]+)\.(woff2?|ttf|otf)$/i;

// Values come from the project's own game.json, but keep them from breaking out of the declaration (projects in the
// online demo are shared).
const safe = (v: unknown): string | null => (typeof v === 'string' && !/[;{}<>\\]|url\(/i.test(v) ? v : null);
const color = (v: unknown) => { const s = safe(v); return s && isCssColor(s) ? s : null; };
const px = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? `${v}px` : null);
const pxList = (v: unknown) =>
  typeof v === 'number' ? px(v) : Array.isArray(v) && v.every(n => typeof n === 'number') ? v.map(n => `${n}px`).join(' ') : null;
const name = (v: unknown) => (typeof v === 'string' && /^[\w\-/]+$/.test(v) ? v : null);

// A themed background follows the player's box opacity option too (an `image` frame keeps its own look).
const fadeable = (c: string | null) => (c ? `color-mix(in srgb, ${c} calc(var(--box-alpha, 1) * 100%), transparent)` : null);

function rule(selector: string, decls: Record<string, string | null>): string {
  const body = Object.entries(decls).filter(([, v]) => v !== null).map(([k, v]) => `${k}: ${v};`).join(' ');
  return body ? `${selector} { ${body} }\n` : '';
}

/**
 * The declarations that draw a 9-slice frame: `slice` is the edge size that does not stretch, as 1, 2 or 4 numbers
 * separated by spaces (top right bottom left); `edge` says how the edges fill their strip. Shared with the screens' `panel`.
 */
export function sliceDecls(url: string, slice: string, edge: 'stretch' | 'repeat' | 'round' = 'stretch'): Record<string, string> {
  const width = slice.split(' ').map(n => `${n}px`).join(' ');
  return { 'border-style': 'solid', 'border-width': width, 'border-image': `url("${url}") ${slice} fill / ${width} ${edge}` };
}

function boxDecls(b: BoxTheme | undefined, place: boolean): Record<string, string | null> {
  if (!b) return {};
  const image = name(b.image), slice = pxList(b.slice ?? 32)?.replace(/px/g, '') ?? '32';
  return {
    ...(place && b.x !== undefined ? { left: px(b.x), right: 'auto' } : {}),
    ...(place && b.y !== undefined ? { top: px(b.y), bottom: 'auto' } : {}),
    width: px(b.width),
    'min-height': px(b.height),
    padding: pxList(b.padding),
    background: image ? 'none' : fadeable(color(b.background)),
    'border-color': color(b.border),
    'border-radius': px(b.radius),
    ...(image ? sliceDecls(`assets/ui/${image}.png`, slice) : {}),
  };
}

function textDecls(t: TextTheme | undefined): Record<string, string | null> {
  if (!t) return {};
  return {
    '--text-size': px(t.size),
    '--text-line': typeof t.lineHeight === 'number' ? String(t.lineHeight) : null,
    '--text-lines': typeof t.lines === 'number' && t.lines >= 1 ? String(Math.floor(t.lines)) : null,
    color: color(t.color),
  };
}

/** Keys that place or size a box; a style leaves them out so it cannot move a layout. */
const PLACEMENT = ['left', 'right', 'top', 'bottom', 'width', 'min-height', 'height'];
const appearance = (d: Record<string, string | null>, place: boolean) =>
  place ? d : Object.fromEntries(Object.entries(d).filter(([k]) => !PLACEMENT.includes(k)));

function skinCss(scope: string, s: Skin, place = true): string {
  return rule(`${scope} #box`, appearance(boxDecls(s.textbox, place), place))
    + rule(`${scope} #name`, { ...appearance(boxDecls(s.namebox, place), place), 'font-size': px(s.namebox?.size) })
    + rule(`${scope} #text`, textDecls(s.text));
}

/** What a style adds beyond the text box: its menu buttons (`data-style` on #menu), a screen button and a screen text. */
function styleCss(style: string, s: Skin): string {
  const tag = `[data-style="${style}"]`;
  let css = '';
  const c = s.choice;
  if (isObj(c)) {
    css += rule(`#stage #menu${tag} button`, { ...appearance(boxDecls(c, false), false), 'font-size': px(c.size) });
    for (const [state, pseudo] of CHOICE_STATES) css += rule(`#stage #menu${tag} button${pseudo}`, appearance(uiDecls(c[state as 'hover' | 'focus' | 'disabled'] as UiLook | undefined), false));
  }
  const b = s.button;
  if (isObj(b)) {
    const sel = (extra: string) => `#stage .sc-btn${tag}${extra}`;
    css += rule(sel(''), appearance(uiDecls(b), false));
    for (const [state, pseudo] of STATES) {
      const p = pseudo(UI_COMPONENTS.button);
      if (p) css += rule(sel(p), appearance(uiDecls(b[state] as UiLook | undefined), false));
    }
  }
  if (isObj(s.text)) css += rule(`#stage .sc-text${tag}`, { color: color(s.text.color), 'font-size': px(s.text.size) });
  return css;
}

function uiDecls(l: UiLook | undefined): Record<string, string | null> {
  if (!isObj(l)) return {};
  const shadow = safe(l.shadow);
  return {
    background: color(l.background),
    color: color(l.color),
    'border-color': color(l.border),
    ...(typeof l.borderWidth === 'number' && l.borderWidth >= 0 ? { 'border-width': px(l.borderWidth), 'border-style': 'solid' } : {}),
    'border-radius': px(l.radius),
    padding: pxList(l.padding),
    'font-size': px(l.size),
    opacity: typeof l.opacity === 'number' && l.opacity >= 0 && l.opacity <= 1 ? String(l.opacity) : null,
    'box-shadow': shadow,
    width: px(l.width),
  };
}

/** A slider is drawn by the browser: `color` is its accent, `size` its height, `width` its width. */
function sliderDecls(l: UiLook | undefined): Record<string, string | null> {
  if (!isObj(l)) return {};
  return { 'accent-color': color(l.color), height: px(l.size), width: px(l.width), opacity: uiDecls(l).opacity };
}

/** The states a choice button can take on top of its resting look. */
const CHOICE_STATES: [keyof UiComponent, string][] = [
  ['hover', ':hover:not([aria-disabled="true"])'], ['focus', ':focus-visible'], ['disabled', '[aria-disabled="true"]'],
];

const STATES: [keyof UiComponent, (c: { selected?: string }) => string | null][] = [
  ['hover', () => ':hover:not(:disabled)'], ['focus', () => ':focus-visible'], ['disabled', () => ':disabled'], ['selected', c => c.selected ?? null],
];

function uiCss(ui: Record<string, UiComponent>, scope = '#stage'): string {
  let css = '';
  // The base component first, then its variants: a variant's rules are more specific and come later.
  const keys = Object.keys(ui).filter(isUiKey).sort((a, b) => a.split('.').length - b.split('.').length);
  for (const key of keys) {
    const [base, variant] = key.split('.');
    const def = UI_COMPONENTS[base], look = ui[key];
    const suffix = variant ? def.variants![variant] : '';
    const sel = (extra: string) => def.selector.split(',').map(s => `${scope} ${scope === '#stage' ? s.trim() : s.trim().replace(/^\.screen /, '')}${suffix}${extra}`).join(', ');
    const decls = (l: UiLook | undefined) => base === 'slider' ? sliderDecls(l) : uiDecls(l);
    css += rule(sel(''), decls(look));
    for (const [state, pseudo] of STATES) {
      const p = pseudo(def);
      if (p) css += rule(sel(p), decls(look[state] as UiLook | undefined));
    }
  }
  return css;
}

const TOKEN_REF = /^\$([A-Za-z]+)(?:\/(\d{1,3}))?$/;

/**
 * Replaces token references (`"$accent"`, `"$accent/15"` for 15% opacity) with the token's color. A token that is not set,
 * or a `/N` on a color that cannot be read (a named color other than white, black), stays as written, so the value is dropped.
 */
export function expandTokenRefs<T>(theme: T): T {
  const t = theme as Theme;
  const token = (n: string): string | undefined => {
    const v = n === 'accent' ? t.accent : (TOKEN_COLORS as readonly string[]).includes(n) ? t.tokens?.[n as typeof TOKEN_COLORS[number]] : undefined;
    return typeof v === 'string' && !TOKEN_REF.test(v) ? v : undefined;
  };
  const sub = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const m = TOKEN_REF.exec(v);
      const base = m && token(m[1]);
      if (!m || !base) return v;
      if (m[2] === undefined) return base;
      const c = parseColor(base);
      return c ? formatHex({ ...c, a: c.a * Math.min(100, Number(m[2])) / 100 }) : v;
    }
    if (Array.isArray(v)) return v.map(sub);
    return isObj(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sub(x)])) : v;
  };
  return sub(theme) as T;
}

/** The stylesheet for a theme; `assets` are the project's asset files (fonts in it get @font-face rules). */
export function themeCss(raw: Theme = {}, assets: { file: string; v: number }[] = []): string {
  const theme = expandTokenRefs(raw);
  let css = '';
  for (const a of assets) {
    const m = FONT.exec(a.file);
    if (m) css += `@font-face { font-family: "${m[1]}"; src: url("assets/${a.file}?v=${a.v}"); font-display: swap; }\n`;
  }
  const font = safe(theme.font);
  css += rule('#stage', {
    '--vn-accent': color(theme.accent),
    '--vn-radius': typeof theme.tokens?.radius === 'number' && theme.tokens.radius >= 0 ? px(theme.tokens.radius) : null,
    '--vn-border-width': typeof theme.tokens?.borderWidth === 'number' && theme.tokens.borderWidth >= 0 ? px(theme.tokens.borderWidth) : null,
    '--vn-gap': typeof theme.tokens?.gap === 'number' && theme.tokens.gap >= 0 ? px(theme.tokens.gap) : null,
    '--vn-ui-size': typeof theme.tokens?.uiSize === 'number' && theme.tokens.uiSize > 0 ? px(theme.tokens.uiSize) : null,
    '--vn-ui-font': safe(theme.tokens?.uiFont) ? `"${theme.tokens!.uiFont!.replace(/"/g, '')}", "Iowan Old Style", Georgia, serif` : null,
    ...Object.fromEntries(TOKEN_COLORS.map(k => [`--vn-${k}`, color(theme.tokens?.[k])])),
    '--hot-fill': color(theme.hotFill),
    '--hot-border': color(theme.hotBorder),
    '--hot-border-width': typeof theme.hotBorderWidth === 'number' && theme.hotBorderWidth >= 0 ? px(theme.hotBorderWidth) : null,
    '--tip-bg': color(theme.tipBackground),
    '--tip-color': color(theme.tipColor),
    '--tip-font': safe(theme.tipFont) ? `"${theme.tipFont!.replace(/"/g, '')}", var(--vn-font)` : null,
    '--vn-font': font ? `"${font.replace(/"/g, '')}", "Iowan Old Style", Georgia, serif` : null,
  });
  // A font per language: the preview sets lang on #stage, and `:lang(ja)` also matches ja-JP.
  for (const [lang, f] of Object.entries(isObj(theme.tokens?.fonts) ? theme.tokens!.fonts! : {})) {
    const face = safe(f)?.replace(/"/g, '');
    if (!face || !/^[A-Za-z]{2,3}(-[A-Za-z0-9]+)*$/.test(lang)) continue;
    const stack = `"${face}", "Iowan Old Style", Georgia, serif`;
    css += rule(`#stage:lang(${lang})`, { '--vn-font': stack, '--vn-ui-font': stack });
  }
  css += skinCss('#stage', theme);
  const c = theme.choices;
  if (c) {
    css += rule('#stage #menu', { gap: px(c.gap) });
    css += rule('#stage #menu button', { ...boxDecls(c, false), 'font-size': px(c.size) });
    for (const [state, pseudo] of CHOICE_STATES) css += rule(`#stage #menu button${pseudo}`, uiDecls(c[state as 'hover' | 'focus' | 'disabled']));
  }
  if (isObj(theme.ui)) css += uiCss(theme.ui);
  for (const [id, ui] of Object.entries(theme.screens ?? {})) if (SCREEN_IDS.includes(id) && isObj(ui)) css += uiCss(ui, `#stage #${id}`);
  for (const [skin, s] of Object.entries(theme.skins ?? {})) {
    if (name(skin) && s) css += skinCss(`#stage[data-skin="${skin}"]`, s, false) + styleCss(skin, s);
  }
  if (typeof theme.css === 'string') css += `${localCss(theme.css)}\n`;
  return css;
}
