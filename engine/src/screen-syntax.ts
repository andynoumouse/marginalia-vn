// Line syntax of the elements inside a `screen name:` block (parsed into ScreenNode by parser.ts, found by ids.ts):
//   image "file" [at x,y] [size w,h]
//   hotspot <id> at x,y size w,h | ellipse at x,y size w,h | poly x,y x,y x,y... | mask "file" [at x,y] [size w,h]
//            ["Label"] [#id] [cursor <name>] [hover "file"|none|tint <color>|scale <n>|sound "name"] [tooltip off] [up|down|left|right <id>]... [on click <label>] [action <name>] [if <expr>] [enabled <expr>]
//   button <id> at x,y [size w,h] "Label" [#id] [font n] [hover "file"|none] [up|down|left|right <id>]... [on click <label>] [action <name>] [if <expr>] [enabled <expr>]
//   tab <id> <state>=<word> at x,y [size w,h] "Label" [#id] [hover ...] [if <expr>] [enabled <expr>]      (sets a local state and keeps the screen up; lit while the state holds the word)
//   radio <id> <state>=<word> at x,y [size w,h] "Label" [#id] [hover ...] [if <expr>] [enabled <expr>]      (like tab, drawn as a radio mark)
//   toggle <id> <state> at x,y [size w,h] "Label" [#id] [hover ...] [if <expr>] [enabled <expr>]      (flips a true/false state; drawn as a checkbox)
//   a hotspot, button, tab, radio or toggle may end with  on click|focus|blur set <state> = <expr>  (one per event, before any `if` / `enabled`)
//   slider <setting> at x,y [size w,h] [readout]      (options screen: a range bound to a player setting)
//   select <setting> at x,y [size w,h] [font n]      (options screen: shows a player setting's value; a click opens the list of its values)
//   text at x,y "Text with [variables]" [#id] [font n] [width n|full] [align a] [color c] [lines n] [if <expr>]
//   bar <value> [max <n>] [min <n>] [at x,y] [size w,h] [back "file"] [fill "file"] [slice s] [edge e] [padding p] [color c] [readout] [if <expr>]
//   panel [at x,y] [size w,h] [image "file" [slice s] [edge stretch|repeat|round]] [padding p] [if <expr>]:      (a framed box; its children are placed from its top left plus the padding)
//   each <list> as <name> [at x,y] [step dx,dy] [limit n] [if <expr>]:      (the body repeats for every entry, at most n)
//   scroll at x,y size w,h [start top|bottom] [bar off] [if <expr>]:      (a clipped box that scrolls its children, placed relative to its top left)
//   row|column|grid <columns> [at x,y | anchor <place> [margin m]] [padding m] [gap n] [align start|center|end|stretch] [width n] [height n] [cell w,h] [if <expr>]:
//        (children of a row, column or grid omit `at`; a hotspot there is `rect`/`ellipse` with `size`, an image needs `size`)
//   default <id>   cancel [keep]   textbox off   state <name> = <expr>

import type { Value } from './expr.js';
import { DEFAULT_STAGE, type StageSize } from './stage.js';
import { AnimSyntaxError, animProblem, parseEnter, parseExit, parseLoop, type ElementAnim } from './screen-anim.js';
import { CYCLE_SETTINGS, type Bind, SLIDER_SETTINGS, LAYOUT_ANCHORS, HUD_EVENTS, SHELL_ACTIONS, FRAME_EDGES, DEFAULT_SLICE, type FrameEdge, type ShellAction, type HoverFx, type LayoutAnchor, type FocusHints, type HudEvent, type HudHandlers, type LayoutAlign, type LayoutKind, type Shape, type Sides } from './screens.js';

export class ElementSyntaxError extends Error {}

/**
 * Words that start a clause of an element line (`on click|focus|blur|enter ...`, `if`, `enabled`, `hover`, `tooltip`, `cursor`,
 * `up|down|left|right`, `action`, `loop`, `style=name`). A deeper-indented line under an element that starts with one continues
 * the element's line instead of being a child of it.
 */
export const SCREEN_CLAUSE_WORDS = ['on', 'if', 'enabled', 'hover', 'tooltip', 'sub', 'cursor', 'up', 'down', 'left', 'right', 'action', 'loop', 'style='] as const;

/** Whether a (trimmed) screen body line starts with a clause word, i.e. continues the element line above it. */
export function startsWithClause(t: string): boolean {
  const w = /^[^\s:]+/.exec(t)?.[0] ?? '';
  return w.startsWith('style=') || (SCREEN_CLAUSE_WORDS as readonly string[]).includes(w);
}

/** Lines of an element that carry a localizable string (the label or text), as ids.ts and the parser see them. */
export const RE_ELEMENT = /^(hotspot|button|tab|radio|toggle|select|text)[ \t]/;
const RE_ID = /^#[A-Za-z0-9]{4,8}$/;
const NAME = /^[A-Za-z_]\w*$/;
/** An element id: a name, or `entry.suffix` (inside an `each`, `slot.rename` stands for that entry's own second button). */
const ELEMENT_ID = /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?$/;
const TINT = /^(#[0-9a-f]{3,8}|[a-z]+|(?:rgb|hsl)a?\([\d.,%/-]+\))$/i;
const unescapeText = (s: string) => s.replace(/\\(["\\n])/g, (_, c: string) => (c === 'n' ? '\n' : c));

/** `on click set tip = "x"` as written: the state name and the expression text. */
export interface SetText { name: string; expr: string }
export interface ElementLine { head: string; cond: string | null; enabled: string | null; sets: Partial<Record<HudEvent, SetText>>; anim: ElementAnim | null }

/**
 * Cuts the trailing ` on <event> set <state> = <expr>`, ` on enter <effect> ...`, ` loop <effect> ...`, ` if <expr>` and
 * ` enabled <expr>` clauses off an element line (only outside quotes).
 */
export function splitElementLine(t: string): ElementLine {
  type Key = 'if' | 'enabled' | 'enter' | 'exit' | 'loop' | HudEvent;
  const cuts: { at: number; key: Key; skip: number }[] = [];
  let quoted = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quoted) { if (c === '\\') i++; else if (c === '"') quoted = false; continue; }
    if (c === '"') { quoted = true; continue; }
    if (i > 0 && /\s/.test(t[i - 1])) {
      const m = /^(?:(if|enabled)|on[ \t]+(click|focus|blur)[ \t]+set|on[ \t]+(enter|exit)|(loop)(?=[ \t]+(?:pulse|bob|sway|breathe|shiver|glow)\b))[ \t]+/.exec(t.slice(i));
      if (m) cuts.push({ at: i, key: (m[1] ?? m[2] ?? m[3] ?? m[4]) as Key, skip: m[0].length });
    }
  }
  const out: ElementLine = { head: (cuts.length ? t.slice(0, cuts[0].at) : t).trim(), cond: null, enabled: null, sets: {}, anim: null };
  cuts.forEach((c, k) => {
    const part = t.slice(c.at + c.skip, k + 1 < cuts.length ? cuts[k + 1].at : undefined).trim();
    if (c.key === 'if') out.cond = part;
    else if (c.key === 'enabled') out.enabled = part;
    else if (c.key === 'enter' || c.key === 'exit' || c.key === 'loop') {
      const anim = out.anim ??= {};
      if (anim[c.key]) throw new ElementSyntaxError(`${c.key === 'loop' ? 'loop' : `on ${c.key}`} appears twice`);
      try {
        if (c.key === 'enter') anim.enter = parseEnter(part); else if (c.key === 'exit') anim.exit = parseExit(part); else anim.loop = parseLoop(part);
      } catch (e) {
        throw e instanceof AnimSyntaxError ? new ElementSyntaxError(e.message) : e;
      }
    }
    else {
      const m = /^([A-Za-z_]\w*)[ \t]*=(?!=)[ \t]*(\S[\s\S]*)$/.exec(part);
      if (!m) throw new ElementSyntaxError(`on ${c.key} set needs a state and a value: on ${c.key} set <state> = <expr>`);
      if (out.sets[c.key]) throw new ElementSyntaxError(`on ${c.key} set appears twice`);
      out.sets[c.key] = { name: m[1], expr: m[2] };
    }
  });
  return out;
}

export interface ElementString { text: string; id: string | null; /** where the opening quote is in `head` */ start: number; /** where the closing quote (or the id after it) ends */ end: number; /** where an id could be inserted (after the closing quote) */ quoteEnd: number }

/** The label or text string of a hotspot, button or text line (not a `mask "file"`), with its `#id`. */
export function elementString(head: string): ElementString | null {
  const re = /"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(head))) {
    if (/\b(?:mask|image|tooltip|sub|hover(?:[ \t]+sound)?)[ \t]+$/.test(head.slice(0, m.index))) continue;
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
  | { kind: 'text'; x: number; y: number; text: string; id: string | null; style?: string; /** px, default 40 */ font?: number; /** a box this wide (px), the text aligned inside it */ width?: number; align?: 'left' | 'center' | 'right'; /** CSS colour */ color?: string; /** show at most this many lines */ lines?: number }
  | { kind: 'slider'; setting: string; x: number; y: number; w: number; h: number; readout: boolean }
  /** `value`, `min` and `max` are expression text (no spaces); the parser turns them into expressions. */
  | { kind: 'bar'; x: number; y: number; w: number; h: number; value: string; min: string; max: string; back: string | null; fill: string | null; slice: Sides | null; edge: FrameEdge; padding: Sides; color: string | null; readout: boolean }
  | { kind: 'hotspot'; id: string; shape: Shape; label: string; labelId: string | null; cursor: string | null; hover: string | null; plain: boolean; fx: HoverFx; tip: boolean; focus: FocusHints; on: HudHandlers; act: ShellAction | null }
  | { kind: 'button'; id: string; x: number; y: number; w: number | null; h: number | null; label: string; labelId: string | null; hover: string | null; plain: boolean; fx: HoverFx; focus: FocusHints; on: HudHandlers; act: ShellAction | null; /** `action [name]`: the action is the value of this variable (an `each` entry's id) */ actVar?: string; style?: string; /** px, default 40 */ font?: number; /** `tooltip "text"`: shown near the button while it is active */ tooltip?: string; /** `select <setting>` */ select?: true };

export interface ParsedElement {
  el: ElementSyntax; cond: string | null; enabled: string | null;
  /** inline handlers on the screen's local state, as written (the parser checks the state and parses the expression) */
  sets: Partial<Record<HudEvent, SetText>>;
  /** `tab` / `radio <id> <state>=<word>` or `toggle <id> <state>`: the state it sets and the value */
  bind?: Bind;
  /** `on enter` / `loop`, as written (`stagger` is only valid on an `each` line, which the parser checks) */
  anim?: ElementAnim;
}

/** `inLayout`: the element sits in a row, column or grid, which places it, so `at` is left out. */
export function parseElementLine(t: string, inLayout = false, stage: StageSize = DEFAULT_STAGE): ParsedElement {
  const p = parseElementBody(t, inLayout, stage);
  const { anim } = splitElementLine(t);
  if (anim) {
    const problem = animProblem(p.el.kind, anim);
    if (problem) throw new ElementSyntaxError(problem);
    if (anim.enter?.stagger) throw new ElementSyntaxError('stagger belongs on an each line: each <list> as <name> on enter fade stagger 0.05:');
    p.anim = anim;
  }
  return p;
}

function parseElementBody(t: string, inLayout: boolean, stage: StageSize): ParsedElement {
  const { head, cond, enabled, sets } = splitElementLine(t);
  const word = /^\S+/.exec(head)?.[0] ?? '';
  const role = word === 'tab' || word === 'radio' || word === 'toggle' ? word : null; // a button that also sets a local state; the rest of the line reads as a button's
  const isSelect = word === 'select'; // a button that opens the list of a player setting's values
  const kind = role || isSelect ? 'button' : word;
  if (isSelect && Object.keys(sets).length) throw new ElementSyntaxError('A select sets its player setting itself: remove "on ... set"');
  if (kind === 'bar') {
    if (enabled !== null) throw new ElementSyntaxError('A bar cannot be disabled: remove "enabled"');
    return { el: parseBar(head, inLayout), cond, enabled, sets };
  }
  if (Object.keys(sets).length && kind !== 'hotspot' && kind !== 'button') throw new ElementSyntaxError(`on ... set goes on a hotspot, button, tab, radio or toggle, not on ${kind}`);
  const str = kind === 'image' ? null : elementString(head);
  // the label (and its id) is cut out whole, wherever it stands among the other words
  let rest = str ? head.slice(word.length, str.start) + ' ' + head.slice(str.end) : head.slice(word.length);
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
  let tooltip: string | undefined;
  const tt = /\btooltip[ \t]+"((?:[^"\\]|\\.)*)"/.exec(rest);
  if (tt) {
    if (kind !== 'button') throw new ElementSyntaxError(`tooltip "text" goes on a button (a ${kind} shows its label, or "tooltip off")`);
    tooltip = unescapeText(tt[1]);
    rest = rest.replace(tt[0], ' ');
  }
  let sub: string | undefined;
  const sb = /\bsub[ \t]+"((?:[^"\\]|\\.)*)"/.exec(rest);
  if (sb) {
    if (kind !== 'button') throw new ElementSyntaxError(`sub "text" goes on a button, not on ${kind}`);
    sub = unescapeText(sb[1]);
    rest = rest.replace(sb[0], ' ');
  }
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
  let style: string | undefined, color: string | undefined, lines: number | undefined, font: number | undefined, width: number | undefined, talign: 'left' | 'center' | 'right' | undefined;
  const focus: FocusHints = {};
  const on: HudHandlers = {};
  let act: ShellAction | null = null, actVar: string | null = null;
  let bind: Bind | undefined, idAt = -1;
  for (let i = 0; i < toks.length; i++) {
    const w = toks[i];
    if (role && role !== 'toggle' && id && !bind && /^[A-Za-z_]\w*=/.test(w)) {
      const eq = w.indexOf('='), raw = w.slice(eq + 1);
      if (raw === '') throw new ElementSyntaxError(`Use: ${role} <id> <state>=<word> at x,y "Label" (the word is one value: a number, true, false or text)`);
      bind = { role, name: w.slice(0, eq), value: raw === 'true' ? true : raw === 'false' ? false : /^-?\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : raw };
    }
    else if (role === 'toggle' && id && !bind && i === idAt + 1 && NAME.test(w) && w !== 'at') bind = { role, name: w, value: null };
    else if (w === 'at') at = pair(toks[++i], '"at"');
    else if (id && (kind === 'hotspot' || kind === 'button') && w === 'action') {
      const name = toks[++i] ?? '';
      const dyn = kind === 'button' ? /^\[([A-Za-z_][\w.]*)\]$/.exec(name) : null;
      if (dyn) { actVar = dyn[1]; continue; }
      if (!(SHELL_ACTIONS as readonly string[]).includes(name)) throw new ElementSyntaxError(`Unknown action "${name}" (actions: ${SHELL_ACTIONS.join(', ')}): action <name>`);
      act = name as ShellAction;
    }
    else if (w === 'size') size = pair(toks[++i], '"size"');
    else if (kind === 'slider' && w === 'readout') readout = true;
    else if (kind === 'text' && w === 'width') {
      if (toks[i + 1] === 'full') { width = stage.width; i++; } else width = Number(toks[++i]);
      if (!(width > 0)) throw new ElementSyntaxError('width needs a size in pixels or full: width 800');
    }
    else if (kind === 'text' && w === 'align') {
      const a = toks[++i] ?? '';
      if (a !== 'left' && a !== 'center' && a !== 'right') throw new ElementSyntaxError('align needs left, center or right');
      talign = a;
    }
    else if ((kind === 'text' || kind === 'button') && w === 'font') {
      font = Number(toks[++i]);
      if (!(font >= 8 && font <= 400)) throw new ElementSyntaxError('font needs a size in pixels from 8 to 400: font 112');
    }
    else if (kind === 'text' && w === 'lines') {
      lines = Number(toks[++i]);
      if (!Number.isInteger(lines) || lines < 1 || lines > 50) throw new ElementSyntaxError('lines needs a whole number from 1 to 50: lines 2');
    }
    else if (kind === 'text' && w === 'color') {
      color = toks[++i] ?? '';
      if (!TINT.test(color) && !/^\[[A-Za-z_][\w.]*\]$/.test(color)) throw new ElementSyntaxError('color needs a color without spaces, like #ff6688, gold or rgba(255,100,100,.9), or [variable] holding one');
    }
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
    else if (/^style=/.test(w)) {
      if (kind !== 'button' && kind !== 'text') throw new ElementSyntaxError(`style= goes on a button or a text, not on ${kind}`);
      if (!/^style=\w+$/.test(w)) throw new ElementSyntaxError('style= needs a style name from the theme: style=urgent');
      style = w.slice(6);
    }
    else if (kind !== 'text' && kind !== 'image' && !id && ELEMENT_ID.test(w)) { id = w; idAt = i; }
    else if (RE_ID.test(w)) continue;
    else if (role && role !== 'toggle' && id && !bind && NAME.test(w)) throw new ElementSyntaxError(`Use: ${role} <id> <state>=<word> at x,y [size w,h] "Label"`);
    else throw new ElementSyntaxError(`Unexpected "${w}" in ${kind}`);
  }
  for (const e of Object.keys(sets)) if (on[e as HudEvent]) throw new ElementSyntaxError(`on ${e} is both a label and a set: use one`);
  if (inLayout) {
    if (at) throw new ElementSyntaxError(`Inside a row, column or grid the container places the ${kind}: remove "at"`);
    if (kind === 'image' && !size) throw new ElementSyntaxError('An image inside a row, column or grid needs size w,h (its natural size is not known here)');
    if (kind === 'hotspot' && (shape === 'poly' || shape === 'mask')) throw new ElementSyntaxError('A hotspot inside a row, column or grid must be a rectangle or ellipse with size w,h');
    if (kind === 'hotspot' && !size) throw new ElementSyntaxError(`hotspot ${id} inside a row, column or grid needs size w,h`);
    at = [0, 0];
  }
  switch (kind) {
    case 'image':
      return { el: { kind, file: imageFile!, x: at?.[0] ?? 0, y: at?.[1] ?? 0, w: size?.[0] ?? null, h: size?.[1] ?? null }, cond, enabled, sets };
    case 'text':
      if (!str) throw new ElementSyntaxError('Use: text at x,y "Text"');
      if (!at) throw new ElementSyntaxError('text needs a position: text at x,y "Text"');
      return { el: { kind, x: at[0], y: at[1], text: str.text, id: str.id, ...(style ? { style } : {}), ...(font ? { font } : {}), ...(width ? { width } : {}), ...(talign ? { align: talign } : {}), ...(color ? { color } : {}), ...(lines ? { lines } : {}) }, cond, enabled, sets };
    case 'slider':
      if (!(id in SLIDER_SETTINGS)) throw new ElementSyntaxError(`slider needs a setting (${Object.keys(SLIDER_SETTINGS).join(', ')}): slider <setting> at x,y [size w,h]`);
      if (!at) throw new ElementSyntaxError(`slider ${id} needs a position: at x,y`);
      return { el: { kind, setting: id, x: at[0], y: at[1], w: size?.[0] ?? 400, h: size?.[1] ?? 48, readout }, cond, enabled, sets };
    case 'button':
      if (role === 'toggle' && (!id || !bind)) throw new ElementSyntaxError('Use: toggle <id> <state> at x,y [size w,h] "Label"');
      if (role && role !== 'toggle' && (!id || !bind)) throw new ElementSyntaxError(`Use: ${role} <id> <state>=<word> at x,y [size w,h] "Label"`);
      if (bind && (act || on.click || sets.click)) throw new ElementSyntaxError(`A ${bind.role} sets its state itself: remove "action" and "on click"`);
      if (isSelect) {
        if (!(CYCLE_SETTINGS as readonly string[]).includes(id)) throw new ElementSyntaxError(`select needs a player setting: select <setting> at x,y [size w,h] (${CYCLE_SETTINGS.join(', ')})`);
        if (act || on.click) throw new ElementSyntaxError('A select opens its list itself: remove "action" and "on click"');
        act = 'select';
      }
      if (!id) throw new ElementSyntaxError('Use: button <id> at x,y [size w,h] "Label"');
      if (act === 'cycle' && !(CYCLE_SETTINGS as readonly string[]).includes(id)) throw new ElementSyntaxError(`action cycle steps a player setting, so the id must be one of: ${CYCLE_SETTINGS.join(', ')}`);
      if (!at) throw new ElementSyntaxError(`button ${id} needs a position: at x,y`);
      return { el: { kind, id, x: at[0], y: at[1], w: size?.[0] ?? null, h: size?.[1] ?? null, label: str?.text ?? id, labelId: str?.id ?? null, hover, plain, fx, focus, on, act, ...(actVar ? { actVar } : {}), ...(style ? { style } : {}), ...(font ? { font } : {}), ...(tooltip ? { tooltip } : {}), ...(sub ? { sub } : {}), ...(isSelect ? { select: true as const } : {}) }, cond, enabled, sets, ...(bind ? { bind } : {}) };
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
      return { el: { kind, id, shape: s, label: str?.text ?? '', labelId: str?.id ?? null, cursor, hover, plain, fx, tip, focus, on, act }, cond, enabled, sets };
    }
  }
  throw new ElementSyntaxError(`Unknown screen element "${kind}" (image, hotspot, button, tab, radio, toggle, slider, text, bar, panel, scroll, row, column, grid, each, default, cancel)`);
}

/** `n` (all sides), `v,h` or `t,r,b,l` slice or padding, in pixels with no spaces; what a frame's `slice` and `padding` take. */
function frameSides(tok: string | undefined, what: string): Sides {
  const s = sides(tok, what);
  if (s.some(n => n < 0)) throw new ElementSyntaxError(`${what} cannot be negative`);
  return s;
}

const frameEdge = (tok: string | undefined): FrameEdge => {
  if (!(FRAME_EDGES as readonly string[]).includes(tok ?? '')) throw new ElementSyntaxError(`edge needs one of: ${FRAME_EDGES.join(', ')}`);
  return tok as FrameEdge;
};

/** Cuts `key "file"` out of `s`, returning the file and what is left. */
function takeFile(s: string, key: string): { file: string | null; rest: string } {
  const m = new RegExp(`\\b${key}[ \\t]+"((?:[^"\\\\]|\\\\.)*)"`).exec(s);
  return m ? { file: unescapeText(m[1]), rest: s.replace(m[0], ' ') } : { file: null, rest: s };
}

const BAR_WORDS = ['max', 'min', 'at', 'size', 'slice', 'edge', 'padding', 'color', 'readout'];
const BAR_USAGE ='Use: bar <variable> [max <n>] [min <n>] at x,y [size w,h] [back "file"] [fill "file"] [slice s] [edge stretch|repeat|round] [padding p] [color c] [readout]';

function parseBar(head: string, inLayout: boolean): Extract<ElementSyntax, { kind: 'bar' }> {
  const b = takeFile(head.slice(3), 'back'), f = takeFile(b.rest, 'fill');
  const toks = f.rest.split(/\s+/).filter(Boolean);
  const expr = (tok: string | undefined, what: string) => {
    if (tok === undefined || /["']/.test(tok)) throw new ElementSyntaxError(`${what} needs a number or variable without spaces, like ${what === 'bar' ? 'health' : `${what} 100`}`);
    return tok;
  };
  const value = expr(BAR_WORDS.includes(toks[0]) ? undefined : toks[0], 'bar');
  let max = '100', min = '0', at: [number, number] | null = null, size: [number, number] | null = null;
  let slice: Sides | null = null, edge: FrameEdge = 'stretch', padding: Sides = [0, 0, 0, 0], color: string | null = null, readout = false;
  for (let i = 1; i < toks.length; i++) {
    const w = toks[i];
    if (w === 'max') max = expr(toks[++i], 'max');
    else if (w === 'min') min = expr(toks[++i], 'min');
    else if (w === 'at') at = pair(toks[++i], '"at"');
    else if (w === 'size') size = pair(toks[++i], '"size"');
    else if (w === 'slice') slice = frameSides(toks[++i], 'slice');
    else if (w === 'edge') edge = frameEdge(toks[++i]);
    else if (w === 'padding') padding = frameSides(toks[++i], 'padding');
    else if (w === 'color') {
      color = toks[++i] ?? '';
      if (!TINT.test(color)) throw new ElementSyntaxError('color needs a color without spaces, like #ff6688, gold or rgba(255,100,100,.9)');
    }
    else if (w === 'readout') readout = true;
    else throw new ElementSyntaxError(`Unexpected "${w}" in bar. ${BAR_USAGE}`);
  }
  if (inLayout && at) throw new ElementSyntaxError('Inside a row, column or grid the container places the bar: remove "at"');
  if (!inLayout && !at) throw new ElementSyntaxError(`bar ${value} needs a position: at x,y`);
  if (slice && !b.file && !f.file) throw new ElementSyntaxError('slice needs a back or fill image to cut');
  if (edge !== 'stretch' && !b.file && !f.file) throw new ElementSyntaxError('edge needs a back or fill image');
  return { kind: 'bar', x: at?.[0] ?? 0, y: at?.[1] ?? 0, w: size?.[0] ?? 400, h: size?.[1] ?? 40, value, min, max, back: b.file, fill: f.file, slice, edge, padding, color, readout };
}

/** A container line's animation: its `on enter` / `loop` go to every element the container holds (a child's own clause wins). */
function containerAnim(anim: ElementAnim | null, what: string): ElementAnim | null {
  if (anim?.enter?.stagger && what !== 'each') throw new ElementSyntaxError('stagger belongs on an each line, where it delays entry by entry');
  return anim;
}

export interface PanelHeader { x: number; y: number; w: number | null; h: number | null; file: string | null; slice: Sides; edge: FrameEdge; padding: Sides; color?: string; cond: string | null; anim: ElementAnim | null }

/** `panel [at x,y] [size w,h|full] [image "file" [slice s] [edge e]] [padding p] [color c] [if <expr>]` (without the colon), or null when `t` is not a panel line. */
export function parsePanelHeader(t: string, inLayout: boolean, stage: StageSize = DEFAULT_STAGE): PanelHeader | null {
  if (!/^panel(?=[ \t]|$)/.test(t)) return null;
  const { head, cond, anim } = splitElementLine(t);
  const im = takeFile(head.slice(5), 'image');
  const toks = im.rest.split(/\s+/).filter(Boolean);
  const usage = 'Use: panel [at x,y] [size w,h|full] [image "file.png" [slice s] [edge stretch|repeat|round]] [padding p] [color c]:';
  let at: [number, number] | null = null, size: [number, number] | null = null, slice: Sides | null = null, edge: FrameEdge | null = null, padding: Sides = [0, 0, 0, 0];
  let color: string | undefined;
  for (let i = 0; i < toks.length; i++) {
    const w = toks[i];
    if (w === 'at') at = pair(toks[++i], '"at"');
    else if (w === 'size' && toks[i + 1] === 'full') { size = [stage.width, stage.height]; i++; }
    else if (w === 'size') size = pair(toks[++i], '"size"');
    else if (w === 'color') {
      color = toks[++i] ?? '';
      if (!TINT.test(color)) throw new ElementSyntaxError('color needs a color without spaces, like #101820, gold or rgba(4,6,10,.6)');
    }
    else if (w === 'slice') slice = frameSides(toks[++i], 'slice');
    else if (w === 'edge') edge = frameEdge(toks[++i]);
    else if (w === 'padding') padding = frameSides(toks[++i], 'padding');
    else throw new ElementSyntaxError(`Unexpected "${w}" in panel. ${usage}`);
  }
  if (inLayout && at) throw new ElementSyntaxError('Inside a row, column or grid the container places the panel: remove "at"');
  if ((slice || edge) && !im.file) throw new ElementSyntaxError('slice and edge need the panel\'s image "file.png"');
  return { x: at?.[0] ?? 0, y: at?.[1] ?? 0, w: size?.[0] ?? null, h: size?.[1] ?? null, file: im.file, slice: slice ?? DEFAULT_SLICE, edge: edge ?? 'stretch', padding, ...(color ? { color } : {}), cond, anim: containerAnim(anim, 'panel') };
}

export interface EachHeader { list: string; as: string; x: number; y: number; dx: number; dy: number; limit: number | null; cond: string | null; anim: ElementAnim | null }

/** `each <list> as <name> [at x,y] [step dx,dy] [limit n] [if <expr>]` (without the trailing colon), or null when `t` is not an each line. */
export function parseEachHeader(t: string): EachHeader | null {
  if (!/^each[ \t]/.test(t)) return null;
  const { head, cond, anim } = splitElementLine(t);
  const toks = head.split(/\s+/).slice(1);
  const usage = 'Use: each <list> as <name> [at x,y] [step dx,dy] [limit n] [on enter ...] [loop ...]:';
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
  return { list: toks[0], as: toks[2], x: at[0], y: at[1], dx: step[0], dy: step[1], limit, cond, anim: containerAnim(anim, 'each') };
}

export interface ScrollHeader { x: number; y: number; w: number; h: number; start: 'top' | 'bottom'; bar: boolean; cond: string | null; anim: ElementAnim | null }

/** `scroll at x,y size w,h [start top|bottom] [bar off] [if <expr>]` (without the colon), or null when `t` is not a scroll line. */
export function parseScrollHeader(t: string): ScrollHeader | null {
  if (!/^scroll(?=[ \t]|$)/.test(t)) return null;
  const { head, cond, anim } = splitElementLine(t);
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
  return { x: at[0], y: at[1], w: size[0], h: size[1], start, bar, cond, anim: containerAnim(anim, 'scroll') };
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
  type: LayoutKind; columns: number; at: [number, number] | null; anchor: LayoutAnchor | null; anchorVar?: string; margin: Sides; padding: Sides; gap: number;
  align: LayoutAlign; cell: [number, number] | null; width?: number; height?: number; cond: string | null; anim: ElementAnim | null;
}

/** `row|column|grid <columns> [at x,y | anchor <place> [margin m]] [padding m] [gap n] [align a] [width n] [height n] [cell w,h] [if <expr>]` (without the colon), or null when `t` is not a layout line. */
export function parseLayoutHeader(t: string, inLayout: boolean): LayoutHeader | null {
  const first = /^(row|column|grid)(?=[ \t]|$)/.exec(t)?.[1] as LayoutKind | undefined;
  if (!first) return null;
  const { head, cond, anim } = splitElementLine(t);
  const toks = head.split(/\s+/).slice(1);
  const usage = 'Use: row|column|grid <columns> [at x,y | anchor <place> [margin m]] [padding m] [gap n] [align start|center|end|stretch] [width n] [height n] [cell w,h]:';
  const out: LayoutHeader = { type: first, columns: 1, at: null, anchor: null, margin: [0, 0, 0, 0], padding: [0, 0, 0, 0], gap: 0, align: 'start', cell: null, cond, anim: containerAnim(anim, first) };
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
      const dyn = /^\[([A-Za-z_]\w*)\]$/.exec(a);
      if (dyn) out.anchorVar = dyn[1];
      else if (!(LAYOUT_ANCHORS as readonly string[]).includes(a)) throw new ElementSyntaxError(`anchor needs one of: ${LAYOUT_ANCHORS.join(', ')}, or [variable] holding one`);
      else out.anchor = a as LayoutAnchor;
    }
    else if (w === 'margin' || w === 'padding') out[w] = sides(toks[++i], w);
    else if (w === 'gap') out.gap = num('gap');
    else if (w === 'align') {
      const a = toks[++i] ?? '';
      if (a !== 'start' && a !== 'center' && a !== 'end' && a !== 'stretch') throw new ElementSyntaxError('align needs start, center, end or stretch');
      out.align = a;
    }
    else if (w === 'width' || w === 'height') {
      const v = num(w);
      if (v <= 0) throw new ElementSyntaxError(`${w} needs a number above 0`);
      out[w] = v;
    }
    else if (w === 'cell' && first === 'grid') out.cell = pair(toks[++i], '"cell"');
    else throw new ElementSyntaxError(usage);
  }
  if (out.at && (out.anchor || out.anchorVar)) throw new ElementSyntaxError('Use either "at x,y" or "anchor <place>", not both');
  if (inLayout && (out.at || out.anchor || out.anchorVar)) throw new ElementSyntaxError('A row, column or grid inside another is placed by it: remove "at" / "anchor"');
  return out;
}
