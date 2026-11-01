// game.json "theme" -> a stylesheet for the text box, name tag, choices and text, plus per-character skins
// (`define alice ... box=alice` uses theme.skins.alice) and @font-face rules for assets/fonts/*.
// Coordinates and sizes are in stage pixels. Image frames are 9-slice: `slice` px of each edge
// stay unscaled (art from masters/ui/<name>.psd -> assets/ui/<name>.png).

import type { AssetFile } from './stage-ui.js';

export interface BoxTheme {
  x?: number; y?: number; width?: number; height?: number;
  padding?: number | number[];
  background?: string;
  border?: string;   // border color (2px)
  radius?: number;
  image?: string;    // assets/ui/<image>.png
  slice?: number | number[];
}
export interface TextTheme { size?: number; color?: string; lineHeight?: number }
export interface Skin { textbox?: BoxTheme; namebox?: BoxTheme & { size?: number }; text?: TextTheme }
export interface Theme extends Skin {
  accent?: string;
  hotFill?: string; hotBorder?: string; hotBorderWidth?: number; // hotspot/button highlight of screens and HUDs
  tipBackground?: string; tipColor?: string; tipFont?: string;   // hotspot tooltip
  font?: string;
  choices?: BoxTheme & { size?: number; gap?: number };
  skins?: Record<string, Skin>;
}

const FONT = /^fonts\/([^/]+)\.(woff2?|ttf|otf)$/i;

// Values come from the project's own game.json, but keep them from breaking out of the declaration.
const safe = (v: unknown): string | null => (typeof v === 'string' && !/[;{}<>\\]|url\(/i.test(v) ? v : null);
const color = (v: unknown) => { const s = safe(v); return s && CSS.supports('color', s) ? s : null; };
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
    ...(image ? {
      'border-style': 'solid',
      'border-width': slice.split(' ').map(n => `${n}px`).join(' '),
      'border-image': `url("assets/ui/${image}.png") ${slice} fill / ${slice.split(' ').map(n => `${n}px`).join(' ')} stretch`,
    } : {}),
  };
}

function textDecls(t: TextTheme | undefined): Record<string, string | null> {
  if (!t) return {};
  return {
    '--text-size': px(t.size),
    '--text-line': typeof t.lineHeight === 'number' ? String(t.lineHeight) : null,
    color: color(t.color),
  };
}

function skinCss(scope: string, s: Skin): string {
  return rule(`${scope} #box`, boxDecls(s.textbox, true))
    + rule(`${scope} #name`, { ...boxDecls(s.namebox, true), 'font-size': px(s.namebox?.size) })
    + rule(`${scope} #text`, textDecls(s.text));
}

export function themeCss(theme: Theme = {}, assets: AssetFile[] = []): string {
  let css = '';
  for (const a of assets) {
    const m = FONT.exec(a.file);
    if (m) css += `@font-face { font-family: "${m[1]}"; src: url("assets/${a.file}?v=${a.v}"); font-display: swap; }\n`;
  }
  const font = safe(theme.font);
  css += rule('#stage', {
    '--accent': color(theme.accent),
    '--hot-fill': color(theme.hotFill),
    '--hot-border': color(theme.hotBorder),
    '--hot-border-width': typeof theme.hotBorderWidth === 'number' && theme.hotBorderWidth >= 0 ? px(theme.hotBorderWidth) : null,
    '--tip-bg': color(theme.tipBackground),
    '--tip-color': color(theme.tipColor),
    '--tip-font': safe(theme.tipFont) ? `"${theme.tipFont!.replace(/"/g, '')}", var(--vn-font)` : null,
    '--vn-font': font ? `"${font.replace(/"/g, '')}", "Iowan Old Style", Georgia, serif` : null,
  });
  css += skinCss('#stage', theme);
  const c = theme.choices;
  if (c) {
    css += rule('#stage #menu', { gap: px(c.gap) });
    css += rule('#stage #menu button', { ...boxDecls(c, false), 'font-size': px(c.size) });
  }
  for (const [skin, s] of Object.entries(theme.skins ?? {})) {
    if (name(skin) && s) css += skinCss(`#stage[data-skin="${skin}"]`, s);
  }
  return css;
}
