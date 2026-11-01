// Line syntax of the elements inside a `screen name:` block (parsed into ScreenNode by parser.ts, found by ids.ts):
//   image "file" [at x,y] [size w,h]
//   hotspot <id> at x,y size w,h | ellipse at x,y size w,h | poly x,y x,y x,y... | mask "file" [at x,y] [size w,h]
//            ["Label"] [#id] [cursor <name>] [hover "file"|none|tint <color>|scale <n>|sound "name"] [tooltip off] [up|down|left|right <id>]... [on click <label>] [action <name>] [if <expr>] [enabled <expr>]
//   button <id> at x,y [size w,h] "Label" [#id] [hover "file"|none] [up|down|left|right <id>]... [on click <label>] [action <name>] [if <expr>] [enabled <expr>]
//   slider <setting> at x,y [size w,h] [readout]      (options screen: a range bound to a player setting)
//   text at x,y "Text with [variables]" [#id] [if <expr>]
//   each <list> as <name> [at x,y] [step dx,dy] [limit n] [if <expr>]:      (the body repeats for every entry, at most n)
//   scroll at x,y size w,h [start top|bottom] [bar off] [if <expr>]:      (a clipped box that scrolls its children, placed relative to its top left)
//   row|column|grid <columns> [at x,y | anchor <place> [margin m]] [padding m] [gap n] [align start|center|end] [cell w,h] [if <expr>]:
//        (children of a row, column or grid omit `at`; a hotspot there is `rect`/`ellipse` with `size`, an image needs `size`)
//   default <id>   cancel

import { DEFAULT_STAGE, type StageSize } from './stage.js';
import { CYCLE_SETTINGS, SLIDER_SETTINGS, LAYOUT_ANCHORS, HUD_EVENTS, SHELL_ACTIONS, type ShellAction, type HoverFx, type LayoutAnchor, type FocusHints, type HudEvent, type HudHandlers, type LayoutAlign, type LayoutKind, type Shape, type Sides } from './screens.js';

export class ElementSyntaxError extends Error {}

/** Lines of an element that carry a localizable string (the label or text), as ids.ts and the parser see them. */
export const RE_ELEMENT = /^(hotspot|button|text)[ \t]/;
const RE_ID = /^#[A-Za-z0-9]{4,8}$/;
const NAME = /^[A-Za-z_]\w*$/;
const TINT = /^(#[0-9a-f]{3,8}|[a-z]+|(?:rgb|hsl)a?\([\d.,%/-]+\))$/i;
const unescapeText = (s: string) => s.replace(/\\(["\\n])/g, (_, c: string) => (c === 'n' ? '\n' : c));

export interface ElementLine { head: string; cond: string | null; enabled: string | null }

/** Cuts a trailing ` if <expr>` and ` enabled <expr>` off an element line (only outside quotes). */
export function splitElementLine(t: string): ElementLine {
  const cuts: { at: number; key: 'if' | 'enabled'; skip: number }[] = [];
  let quoted = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quoted) { if (c === '\\') i++; else if (c === '"') quoted = false; continue; }
    if (c === '"') { quoted = true; continue; }
    if (i > 0 && /\s/.test(t[i - 1])) {
      const m = /^(if|enabled)[ \t]+/.exec(t.slice(i));
      if (m) cuts.push({ at: i, key: m[1] as 'if' | 'enabled', skip: m[0].length });
    }
  }
  const out: ElementLine = { head: (cuts.length ? t.slice(0, cuts[0].at) : t).trim(), cond: null, enabled: null };
  cuts.forEach((c, k) => {
    const part = t.slice(c.at + c.skip, k + 1 < cuts.length ? cuts[k + 1].at : undefined).trim();
    if (c.key === 'if') out.cond = part; else out.enabled = part;
  });
  return out;
}

export interface ElementString { text: string; id: string | null; /** where the opening quote is in `head` */ start: number; /** where the closing quote (or the id after it) ends */ end: number; /** where an id could be inserted (after the closing quote) */ quoteEnd: number }

/** The label or text string of a hotspot, button or text line (not a `mask "file"`), with its `#id`. */
export function elementString(head: string): ElementString | null {
  const re = /"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(head))) {
    if (/\b(?:mask|image|hover(?:[ \t]+sound)?)[ \t]+$/.test(head.slice(0, m.index))) continue;
    const quoteEnd = m.index + m[0].length;
    const id = /^[ \t]+#([A-Za-z0-9]{4,8})(?=[ \t]|$)/.exec(head.slice(quoteEnd));
    return { text: unescapeText(m[1]), id: id ? id[1] : null, start: m.index, end: quoteEnd + (id ? id[0].length : 0), quoteEnd };
  }
  return null;
}

function pair(tok: string | undefined, what: string): [number, number] {
  const m = tok === undefined ? null : /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(tok);
  if (!m) throw new ElementSyntaxError(`${what} needs two numbers like 595,454 (stage pixels, no spaces)`);
  return [Number(m[1]), Number(m[2])];
}

export type ElementSyntax =
  | { kind: 'image'; file: string; x: number; y: number; w: number | null; h: number | null }
  | { kind: 'text'; x: number; y: number; text: string; id: string | null }
  | { kind: 'slider'; setting: string; x: number; y: number; w: number; h: number; readout: boolean }
  | { kind: 'hotspot'; id: string; shape: Shape; label: string; labelId: string | null; cursor: string | null; hover: string | null; plain: boolean; fx: HoverFx; tip: boolean; focus: FocusHints; on: HudHandlers; act: ShellAction | null }
  | { kind: 'button'; id: string; x: number; y: number; w: number | null; h: number | null; label: string; labelId: string | null; hover: string | null; plain: boolean; fx: HoverFx; focus: FocusHints; on: HudHandlers; act: ShellAction | null };

export interface ParsedElement { el: ElementSyntax; cond: string | null; enabled: string | null }

/** `inLayout`: the element sits in a row, column or grid, which places it, so `at` is left out. */
export function parseElementLine(t: string, inLayout = false, stage: StageSize = DEFAULT_STAGE): ParsedElement {
  const { head, cond, enabled } = splitElementLine(t);
  const kind = /^\S+/.exec(head)?.[0] ?? '';
  const str = kind === 'image' ? null : elementString(head);
  // the label (and its id) is cut out whole, wherever it stands among the other words
  let rest = str ? head.slice(kind.length, str.start) + ' ' + head.slice(str.end) : head.slice(kind.length);
  let maskFile: string | null = null;
  const mm = /\bmask[ \t]+"((?:[^"\\]|\\.)*)"/.exec(rest);
  if (mm) { maskFile = unescapeText(mm[1]); rest = rest.replace(mm[0], 'mask'); }
  let hover: string | null = null;
  const hm = /\bhover[ \t]+"((?:[^"\\]|\\.)*)"/.exec(rest);
  if (hm) {
    if (kind !== 'hotspot' && kind !== 'button') throw new ElementSyntaxError(`hover goes on a hotspot or button, not on ${kind}`);
    hover = unescapeText(hm[1]);
    rest = rest.replace(hm[0], ' ');
  }
  let plain = false;
  const pm = /\bhover[ \t]+none\b/.exec(rest);
  if (pm) {
    if (kind !== 'hotspot' && kind !== 'button') throw new ElementSyntaxError(`hover goes on a hotspot or button, not on ${kind}`);
    if (hover) throw new ElementSyntaxError('Use either hover "file" or hover none, not both');
    plain = true;
    rest = rest.replace(pm[0], ' ');
  }
  const fx: HoverFx = { tint: null, scale: null, sound: null };
  const sm = /\bhover[ \t]+sound[ \t]+"((?:[^"\\]|\\.)*)"/.exec(rest);
  if (sm) {
    if (kind !== 'hotspot' && kind !== 'button') throw new ElementSyntaxError(`hover sound goes on a hotspot or button, not on ${kind}`);
    fx.sound = unescapeText(sm[1]);
    rest = rest.replace(sm[0], ' ');
  }
  const tn = /\bhover[ \t]+tint[ \t]+(\S+)/.exec(rest);
  if (tn) {
    if (kind !== 'hotspot' && kind !== 'button') throw new ElementSyntaxError(`hover tint goes on a hotspot or button, not on ${kind}`);
    if (!TINT.test(tn[1])) throw new ElementSyntaxError('hover tint needs a color without spaces, like #ffcc66, gold or rgba(255,200,100,.35)');
    fx.tint = tn[1];
    rest = rest.replace(tn[0], ' ');
  }
  const sc = /\bhover[ \t]+scale[ \t]+(\S+)/.exec(rest);
  if (sc) {
    if (kind !== 'hotspot' && kind !== 'button') throw new ElementSyntaxError(`hover scale goes on a hotspot or button, not on ${kind}`);
    const n = Number(sc[1]);
    if (!(n > 0 && n <= 4)) throw new ElementSyntaxError('hover scale needs a number above 0 and up to 4, like 1.08');
    fx.scale = n;
    rest = rest.replace(sc[0], ' ');
  }
  if ((fx.tint || fx.scale) && hover) throw new ElementSyntaxError('hover tint and hover scale cannot be combined with a hover image');
  if (fx.tint && plain) throw new ElementSyntaxError('Use either hover tint or hover none, not both');
  let tip = true;
  const tm = /\btooltip[ \t]+off\b/.exec(rest);
  if (tm) {
    if (kind !== 'hotspot') throw new ElementSyntaxError(`tooltip off goes on a hotspot (a ${kind} has no tooltip)`);
    tip = false;
    rest = rest.replace(tm[0], ' ');
  }
  let imageFile: string | null = null;
  if (kind === 'image') {
    const im = /^[ \t]*"((?:[^"\\]|\\.)*)"/.exec(rest);
    if (!im) throw new ElementSyntaxError('Use: image "file.png" [at x,y] [size w,h]');
    imageFile = unescapeText(im[1]);
    rest = rest.slice(im[0].length);
  }
  const toks = rest.split(/\s+/).filter(Boolean);
  let at: [number, number] | null = null, size: [number, number] | null = null, cursor: string | null = null;
  const points: [number, number][] = [];
  let shape: 'rect' | 'ellipse' | 'poly' | 'mask' = 'rect';
  let id = '';
  let readout = false;
  const focus: FocusHints = {};
  const on: HudHandlers = {};
  let act: ShellAction | null = null;
  for (let i = 0; i < toks.length; i++) {
    const w = toks[i];
    if (w === 'at') at = pair(toks[++i], '"at"');
    else if (id && (kind === 'hotspot' || kind === 'button') && w === 'action') {
      const name = toks[++i] ?? '';
      if (!(SHELL_ACTIONS as readonly string[]).includes(name)) throw new ElementSyntaxError(`Unknown action "${name}" (actions: ${SHELL_ACTIONS.join(', ')}): action <name>`);
      act = name as ShellAction;
    }
    else if (w === 'size') size = pair(toks[++i], '"size"');
    else if (kind === 'slider' && w === 'readout') readout = true;
    else if (w === 'cursor' && kind === 'hotspot') { cursor = toks[++i] ?? ''; if (!/^[\w-]+$/.test(cursor)) throw new ElementSyntaxError('cursor needs a CSS cursor name like pointer or help'); }
    else if (id && (kind === 'hotspot' || kind === 'button') && w === 'on') {
      const event = toks[++i] ?? '', label = toks[++i] ?? '';
      if (!(HUD_EVENTS as readonly string[]).includes(event)) throw new ElementSyntaxError(`Unknown event "${event}" (events: ${HUD_EVENTS.join(', ')}): on ${HUD_EVENTS[0]} <label>`);
      if (!NAME.test(label)) throw new ElementSyntaxError(`on ${event} needs the label to call: on ${event} <label>`);
      on[event as HudEvent] = label;
    }
    else if (id && (kind === 'hotspot' || kind === 'button') && (w === 'up' || w === 'down' || w === 'left' || w === 'right')) {
      const to = toks[++i] ?? '';
      if (!NAME.test(to)) throw new ElementSyntaxError(`${w} needs the id of the element it moves to: ${w} <id>`);
      focus[w] = to;
    }
    else if (kind === 'hotspot' && w === 'ellipse') shape = 'ellipse';
    else if (kind === 'hotspot' && w === 'poly') shape = 'poly';
    else if (kind === 'hotspot' && w === 'mask') shape = 'mask';
    else if (shape === 'poly' && /^-?[\d.]+,-?[\d.]+$/.test(w)) points.push(pair(w, 'poly point'));
    else if (kind !== 'text' && kind !== 'image' && !id && NAME.test(w)) id = w;
    else if (RE_ID.test(w)) continue;
    else throw new ElementSyntaxError(`Unexpected "${w}" in ${kind}`);
  }
  if (inLayout) {
    if (at) throw new ElementSyntaxError(`Inside a row, column or grid the container places the ${kind}: remove "at"`);
    if (kind === 'image' && !size) throw new ElementSyntaxError('An image inside a row, column or grid needs size w,h (its natural size is not known here)');
    if (kind === 'hotspot' && (shape === 'poly' || shape === 'mask')) throw new ElementSyntaxError('A hotspot inside a row, column or grid must be a rectangle or ellipse with size w,h');
    if (kind === 'hotspot' && !size) throw new ElementSyntaxError(`hotspot ${id} inside a row, column or grid needs size w,h`);
    at = [0, 0];
  }
  switch (kind) {
    case 'image':
      return { el: { kind, file: imageFile!, x: at?.[0] ?? 0, y: at?.[1] ?? 0, w: size?.[0] ?? null, h: size?.[1] ?? null }, cond, enabled };
    case 'text':
      if (!str) throw new ElementSyntaxError('Use: text at x,y "Text"');
      if (!at) throw new ElementSyntaxError('text needs a position: text at x,y "Text"');
      return { el: { kind, x: at[0], y: at[1], text: str.text, id: str.id }, cond, enabled };
    case 'slider':
      if (!(id in SLIDER_SETTINGS)) throw new ElementSyntaxError(`slider needs a setting (${Object.keys(SLIDER_SETTINGS).join(', ')}): slider <setting> at x,y [size w,h]`);
      if (!at) throw new ElementSyntaxError(`slider ${id} needs a position: at x,y`);
      return { el: { kind, setting: id, x: at[0], y: at[1], w: size?.[0] ?? 400, h: size?.[1] ?? 48, readout }, cond, enabled };
    case 'button':
      if (!id) throw new ElementSyntaxError('Use: button <id> at x,y [size w,h] "Label"');
      if (act === 'cycle' && !(CYCLE_SETTINGS as readonly string[]).includes(id)) throw new ElementSyntaxError(`action cycle steps a player setting, so the id must be one of: ${CYCLE_SETTINGS.join(', ')}`);
      if (!at) throw new ElementSyntaxError(`button ${id} needs a position: at x,y`);
      return { el: { kind, id, x: at[0], y: at[1], w: size?.[0] ?? null, h: size?.[1] ?? null, label: str?.text ?? id, labelId: str?.id ?? null, hover, plain, fx, focus, on, act }, cond, enabled };
    case 'hotspot': {
      if (!id) throw new ElementSyntaxError('Use: hotspot <id> at x,y size w,h "Label"');
      let s: Shape;
      if (shape === 'poly') {
        if (points.length < 3) throw new ElementSyntaxError(`hotspot ${id}: a poly needs at least three points like 1300,560 1420,540 1440,650`);
        s = { k: 'poly', points };
      } else if (shape === 'mask') {
        s = { k: 'mask', file: maskFile ?? '', x: at?.[0] ?? 0, y: at?.[1] ?? 0, w: size?.[0] ?? stage.width, h: size?.[1] ?? stage.height };
      } else {
        if (!at || !size) throw new ElementSyntaxError(`hotspot ${id} needs a shape: at x,y size w,h  |  ellipse at x,y size w,h  |  poly x,y x,y x,y  |  mask "file.png"`);
        s = { k: shape, x: at[0], y: at[1], w: size[0], h: size[1] };
      }
      return { el: { kind, id, shape: s, label: str?.text ?? '', labelId: str?.id ?? null, cursor, hover, plain, fx, tip, focus, on, act }, cond, enabled };
    }
  }
  throw new ElementSyntaxError(`Unknown screen element "${kind}" (image, hotspot, button, slider, text, scroll, row, column, grid, each, default, cancel)`);
}

export interface EachHeader { list: string; as: string; x: number; y: number; dx: number; dy: number; limit: number | null; cond: string | null }

/** `each <list> as <name> [at x,y] [step dx,dy] [limit n] [if <expr>]` (without the trailing colon), or null when `t` is not an each line. */
export function parseEachHeader(t: string): EachHeader | null {
  if (!/^each[ \t]/.test(t)) return null;
  const { head, cond } = splitElementLine(t);
  const toks = head.split(/\s+/).slice(1);
  const usage = 'Use: each <list> as <name> [at x,y] [step dx,dy] [limit n]:';
  if (!NAME.test(toks[0] ?? '') || toks[1] !== 'as' || !NAME.test(toks[2] ?? '')) throw new ElementSyntaxError(usage);
  let at: [number, number] = [0, 0], step: [number, number] = [0, 0], limit: number | null = null;
  for (let i = 3; i < toks.length; i++) {
    if (toks[i] === 'at') at = pair(toks[++i], '"at"');
    else if (toks[i] === 'step') step = pair(toks[++i], '"step"');
    else if (toks[i] === 'limit') {
      if (!/^[1-9]\d*$/.test(toks[++i] ?? '')) throw new ElementSyntaxError('"limit" needs a whole number of at least 1');
      limit = Number(toks[i]);
    } else throw new ElementSyntaxError(usage);
  }
  return { list: toks[0], as: toks[2], x: at[0], y: at[1], dx: step[0], dy: step[1], limit, cond };
}

export interface ScrollHeader { x: number; y: number; w: number; h: number; start: 'top' | 'bottom'; bar: boolean; cond: string | null }

/** `scroll at x,y size w,h [start top|bottom] [bar off] [if <expr>]` (without the colon), or null when `t` is not a scroll line. */
export function parseScrollHeader(t: string): ScrollHeader | null {
  if (!/^scroll(?=[ \t]|$)/.test(t)) return null;
  const { head, cond } = splitElementLine(t);
  const toks = head.split(/\s+/).slice(1);
  const usage = 'Use: scroll at x,y size w,h [start top|bottom] [bar off]:';
  let at: [number, number] | null = null, size: [number, number] | null = null, start: 'top' | 'bottom' = 'top', bar = true;
  for (let i = 0; i < toks.length; i++) {
    if (toks[i] === 'at') at = pair(toks[++i], '"at"');
    else if (toks[i] === 'size') size = pair(toks[++i], '"size"');
    else if (toks[i] === 'start') {
      const v = toks[++i];
      if (v !== 'top' && v !== 'bottom') throw new ElementSyntaxError('"start" is top or bottom');
      start = v;
    } else if (toks[i] === 'bar') {
      if (toks[++i] !== 'off') throw new ElementSyntaxError('Use "bar off" to hide the scroll bar');
      bar = false;
    } else throw new ElementSyntaxError(usage);
  }
  if (!at || !size) throw new ElementSyntaxError(usage);
  return { x: at[0], y: at[1], w: size[0], h: size[1], start, bar, cond };
}

/** `n` (all sides), `v,h` (top and bottom, then left and right) or `t,r,b,l`, in stage pixels with no spaces. */
function sides(tok: string | undefined, what: string): Sides {
  const v = (tok ?? '').split(',');
  if (![1, 2, 4].includes(v.length) || !v.every(x => /^-?\d+(?:\.\d+)?$/.test(x))) {
    throw new ElementSyntaxError(`${what} needs a number for all sides, v,h or top,right,bottom,left (no spaces), like ${what} 20 or ${what} 10,20,10,20`);
  }
  const n = v.map(Number);
  return n.length === 1 ? [n[0], n[0], n[0], n[0]] : n.length === 2 ? [n[0], n[1], n[0], n[1]] : [n[0], n[1], n[2], n[3]];
}

export interface LayoutHeader {
  type: LayoutKind; columns: number; at: [number, number] | null; anchor: LayoutAnchor | null; margin: Sides; padding: Sides; gap: number;
  align: LayoutAlign; cell: [number, number] | null; cond: string | null;
}

/** `row|column|grid <columns> [at x,y | anchor <place> [margin m]] [padding m] [gap n] [align a] [cell w,h] [if <expr>]` (without the colon), or null when `t` is not a layout line. */
export function parseLayoutHeader(t: string, inLayout: boolean): LayoutHeader | null {
  const first = /^(row|column|grid)(?=[ \t]|$)/.exec(t)?.[1] as LayoutKind | undefined;
  if (!first) return null;
  const { head, cond } = splitElementLine(t);
  const toks = head.split(/\s+/).slice(1);
  const usage = 'Use: row|column|grid <columns> [at x,y | anchor <place> [margin m]] [padding m] [gap n] [align start|center|end] [cell w,h]:';
  const out: LayoutHeader = { type: first, columns: 1, at: null, anchor: null, margin: [0, 0, 0, 0], padding: [0, 0, 0, 0], gap: 0, align: 'start', cell: null, cond };
  let i = 0;
  if (first === 'grid') {
    if (!/^\d+$/.test(toks[0] ?? '') || Number(toks[0]) < 1) throw new ElementSyntaxError('A grid needs its column count: grid 3 at x,y ...');
    out.columns = Number(toks[i++]);
  }
  const num = (what: string) => {
    const v = toks[++i];
    if (v === undefined || !/^-?\d+(?:\.\d+)?$/.test(v)) throw new ElementSyntaxError(`${what} needs a number`);
    return Number(v);
  };
  for (; i < toks.length; i++) {
    const w = toks[i];
    if (w === 'at') out.at = pair(toks[++i], '"at"');
    else if (w === 'anchor') {
      const a = toks[++i] ?? '';
      if (!(LAYOUT_ANCHORS as readonly string[]).includes(a)) throw new ElementSyntaxError(`anchor needs one of: ${LAYOUT_ANCHORS.join(', ')}`);
      out.anchor = a as LayoutAnchor;
    }
    else if (w === 'margin' || w === 'padding') out[w] = sides(toks[++i], w);
    else if (w === 'gap') out.gap = num('gap');
    else if (w === 'align') {
      const a = toks[++i] ?? '';
      if (a !== 'start' && a !== 'center' && a !== 'end') throw new ElementSyntaxError('align needs start, center or end');
      out.align = a;
    }
    else if (w === 'cell' && first === 'grid') out.cell = pair(toks[++i], '"cell"');
    else throw new ElementSyntaxError(usage);
  }
  if (out.at && out.anchor) throw new ElementSyntaxError('Use either "at x,y" or "anchor <place>", not both');
  if (inLayout && (out.at || out.anchor)) throw new ElementSyntaxError('A row, column or grid inside another is placed by it: remove "at" / "anchor"');
  return out;
}
