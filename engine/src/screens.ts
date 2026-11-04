// Custom screens: the declaration (`screen map:` blocks), its resolution against the current variables, and the pure
// geometry the shell needs (hit tests, directional focus, the default answer). No DOM here: preview/screen-ui.ts draws.
// Coordinates are stage pixels (the project's stage size, 1920x1080 unless game.json says otherwise; origin top left, y down).

import { evalExpr, type Expr, type Value } from './expr.js';
import { DEFAULT_STAGE, stageLabel, type StageSize } from './stage.js';
import type { Src, Vars } from './types.js';

/** Space on the four sides, in stage pixels: top, right, bottom, left. */
export type Sides = [number, number, number, number];

export type Point = [number, number];
export interface StageRect { x: number; y: number; w: number; h: number }

/** The clickable region of a hotspot. `mask` is a PNG whose opaque pixels are the region, placed at x,y. */
export type Shape =
  | ({ k: 'rect' } & StageRect)
  | ({ k: 'ellipse' } & StageRect)
  | { k: 'poly'; points: Point[] }
  | ({ k: 'mask'; file: string } & StageRect);

// ---- declaration (what the parser produces) ----

/** What can happen to a HUD element (`on <event> <label>`): the closed list the parser accepts. */
export const HUD_EVENTS = ['click', 'focus', 'blur'] as const;
export type HudEvent = typeof HUD_EVENTS[number];
/** The label each event of an element calls. */
export type HudHandlers = Partial<Record<HudEvent, string>>;
/** Built-in actions an element can trigger with `action <name>` (the quick menu's and the title screen's buttons); the shell runs them, the script does not see them. */
export const SHELL_ACTIONS = ['back', 'history', 'auto', 'skip', 'qsave', 'qload', 'save', 'load', 'options', 'hide', 'start', 'continue', 'quit', 'resume', 'title', 'close', 'fullscreen', 'tab', 'cycle', 'slot', 'page', 'delete', 'gallery', 'tile', 'music', 'track', 'stop', 'chapters', 'chapter', 'achievements', 'next', 'prev', 'voice', 'line'] as const;
export type ShellAction = typeof SHELL_ACTIONS[number];
/** Reserved screen name: when a project declares it, the shell draws it in place of the stock quick menu bar. */
export const QUICKMENU_SCREEN = 'quickmenu';
/** Reserved screen name: when a project declares it, the shell draws it in place of the stock title screen. */
export const TITLE_SCREEN = 'title';
/** Reserved screen name: when a project declares it, the shell draws it in place of the stock pause menu. */
export const PAUSE_SCREEN = 'pause';
/** Reserved screen name: when a project declares it, the shell draws it in place of the stock options screen. */
export const OPTIONS_SCREEN = 'options';
/** Reserved screen name: when a project declares it, the shell draws it in place of the stock save/load screen. */
export const SAVES_SCREEN = 'saves';
/** Reserved screen name: when a project declares it, the shell draws it in place of the stock history panel. */
export const HISTORY_SCREEN = 'history';
/** Reserved screen name: when a project declares it, the shell draws it in place of the stock gallery. */
export const GALLERY_SCREEN = 'gallery';
/** Reserved screen name: when a project declares it, the shell draws it in place of the stock gallery image viewer. */
export const VIEWER_SCREEN = 'viewer';
/** Reserved screen name: when a project declares it, the shell draws it in place of the stock music room. */
export const MUSIC_SCREEN = 'music';
/** Reserved screen name: when a project declares it, the shell draws it in place of the stock chapter select. */
export const CHAPTERS_SCREEN = 'chapters';
/** Reserved screen name: when a project declares it, the shell draws it in place of the stock achievements and endings list. */
export const ACHIEVEMENTS_SCREEN = 'achievements';
/** Reserved screen name: when a project declares it, the shell draws it in place of the stock notice that pops up when an achievement unlocks. */
export const ACHIEVEMENT_TOAST_SCREEN = 'achievement_toast';
/** Variables the shell fills in on a reserved screen (not story variables): the options settings, the saves screen's mode, page, page and slot lists and delete toggle, the history's lines, the gallery's tiles, the viewer's picture, the music room's tracks, the chapter select's chapters, the achievements list or the achievement toast. */
export function shellVars(screen: string): string[] {
  if (screen === OPTIONS_SCREEN) return ['tab', ...Object.keys(SLIDER_SETTINGS), ...CYCLE_SETTINGS];
  if (screen === SAVES_SCREEN) return ['mode', 'page', 'pages', 'slots', 'deleting'];
  if (screen === HISTORY_SCREEN) return ['lines', 'total'];
  if (screen === GALLERY_SCREEN) return ['tiles', 'count', 'total'];
  if (screen === VIEWER_SCREEN) return ['file', 'title', 'position', 'total'];
  if (screen === MUSIC_SCREEN) return ['tracks', 'count', 'total', 'now'];
  if (screen === CHAPTERS_SCREEN) return ['chapters', 'count', 'total'];
  if (screen === ACHIEVEMENTS_SCREEN) return ['achievements', 'endings', 'count', 'total', 'endings_count', 'endings_total'];
  if (screen === ACHIEVEMENT_TOAST_SCREEN) return ['title', 'description', 'icon', 'ending'];
  return [];
}
/** Extra fields the shell gives each entry of an `each` on a reserved screen (`slot.when`), next to `.name`, `.image` and `.index`. */
export function shellEntryFields(screen: string): string[] {
  return screen === SAVES_SCREEN ? ['title', 'label', 'when', 'text', 'empty'] : screen === HISTORY_SCREEN ? ['text', 'current'] : screen === GALLERY_SCREEN ? ['title', 'unlocked', 'file']
    : screen === MUSIC_SCREEN ? ['title', 'unlocked', 'playing'] : screen === CHAPTERS_SCREEN ? ['title', 'unlocked']
    : screen === ACHIEVEMENTS_SCREEN ? ['title', 'description', 'icon', 'unlocked', 'hidden', 'ending'] : [];
}
/** Player settings a `slider` can be bound to, with the range the shell allows. */
export const SLIDER_SETTINGS = {
  master: { min: 0, max: 1, step: 0.05 }, music: { min: 0, max: 1, step: 0.05 }, sound: { min: 0, max: 1, step: 0.05 }, voice: { min: 0, max: 1, step: 0.05 },
  text_speed: { min: 10, max: 100, step: 5 }, text_size: { min: 0.8, max: 1.5, step: 0.1 }, box_opacity: { min: 0.3, max: 1, step: 0.05 },
} as const;
/** The text beside a slider with `readout`: a percentage for the 0..1 volumes and opacity, a number otherwise. */
export function sliderReadout(setting: string, value: number): string {
  return setting === 'text_speed' ? String(Math.round(value)) : `${Math.round(value * 100)}%`;
}
/** Player settings a button with `action cycle` steps through (its id names the setting); their current word is a variable of the options screen. */
export const CYCLE_SETTINGS = ['text_sounds', 'auto_speed', 'skip', 'reduce_motion', 'captions', 'speaker_focus', 'timed_choices', 'language'] as const;
/** Art-free hover look of a hotspot or button: `hover tint <color>`, `hover scale <n>`, `hover sound "name"`. */
export interface HoverFx { tint: string | null; scale: number | null; sound: string | null }

/** Explicit focus moves of an element: the id the arrow keys go to instead of the nearest one. */
export type FocusHints = Partial<Record<'up' | 'down' | 'left' | 'right', string>>;

export const LAYOUT_ANCHORS = ['topleft', 'top', 'topright', 'left', 'center', 'right', 'bottomleft', 'bottom', 'bottomright'] as const;
export type LayoutAnchor = typeof LAYOUT_ANCHORS[number];
export type LayoutKind = 'row' | 'column' | 'grid';
export type LayoutAlign = 'start' | 'center' | 'end';
/** How the edges of a 9-slice frame fill their strip (CSS `border-image-repeat`). */
export const FRAME_EDGES = ['stretch', 'repeat', 'round'] as const;
export type FrameEdge = typeof FRAME_EDGES[number];
/** The slice a frame image gets when the script gives none (the same 32px the theme's `slice` defaults to). */
export const DEFAULT_SLICE: Sides = [32, 32, 32, 32];

interface Common { src: Src; cond: Expr | null }
export type ScreenNode = Common & (
  | { kind: 'image'; file: string; x: number; y: number; w: number | null; h: number | null }
  | { kind: 'text'; x: number; y: number; text: string; id: string | null; style?: string }
  /** A range input bound to a player setting (options screen). */
  | { kind: 'slider'; setting: string; x: number; y: number; w: number; h: number; readout: boolean }
  | { kind: 'hotspot'; id: string; shape: Shape; label: string; labelId: string | null; enabled: Expr | null; cursor: string | null; hover: string | null; plain: boolean; fx: HoverFx; tip: boolean; focus: FocusHints; on: HudHandlers; act: ShellAction | null; sets?: LocalSets; /** elements shown with it, in stage coordinates: the group stays active while any of them is */ body?: ScreenNode[] }
  | { kind: 'button'; id: string; x: number; y: number; w: number | null; h: number | null; label: string; labelId: string | null; enabled: Expr | null; hover: string | null; plain: boolean; fx: HoverFx; focus: FocusHints; on: HudHandlers; act: ShellAction | null; style?: string; sets?: LocalSets; bind?: Bind; body?: ScreenNode[] }
  /** One copy of the body per entry of the list variable; offsets are `at` plus the entry's number times `step`. */
  | { kind: 'each'; list: string; as: string; x: number; y: number; dx: number; dy: number; /** at most this many entries are drawn */ limit: number | null; body: ScreenNode[] }
  /** A clipped box that scrolls its children, placed relative to its top left (so they need no stage coordinates). */
  | { kind: 'scroll'; x: number; y: number; w: number; h: number; start: 'top' | 'bottom'; bar: boolean; body: ScreenNode[] }
  /** A row, column or grid: places its children one after another (an `each` inside spreads its entries), so they need no `at`. */
  | { kind: 'layout'; type: LayoutKind; columns: number; at: Point | null; anchor: LayoutAnchor | null; margin: Sides; padding: Sides; gap: number; align: LayoutAlign; cell: Point | null; body: ScreenNode[] }
  /**
   * A box framed by a 9-slice image (`file`: the corners keep their size, the edges stretch, repeat or round). Its children are placed
   * from its top left plus `padding`; without a size it fits them. With no image it is the stock panel look.
   */
  | { kind: 'panel'; x: number; y: number; w: number | null; h: number | null; file: string | null; slice: Sides; edge: FrameEdge; padding: Sides; body: ScreenNode[] }
  /** A filled bar showing `value` between `min` and `max`; `back` is the frame, `fill` the part that grows (cropped, or 9-sliced when `slice` is set). */
  | { kind: 'bar'; x: number; y: number; w: number; h: number; value: Expr; min: Expr; max: Expr; back: string | null; fill: string | null; slice: Sides | null; edge: FrameEdge; padding: Sides; color: string | null; readout: boolean }
);

/** What a `tab`, `toggle` or `radio` sets: the local state it is bound to and, for a tab or radio, the word it sets (a toggle flips the state). */
export interface Bind { role: 'tab' | 'toggle' | 'radio'; name: string; value: Value | null }

/** The nodes inside an `each`, a layout, a scroll area or a panel. */
export const childNodes = (n: ScreenNode): ScreenNode[] => (n.kind === 'each' || n.kind === 'layout' || n.kind === 'scroll' || n.kind === 'panel' ? n.body : n.kind === 'hotspot' || n.kind === 'button' ? n.body ?? [] : []);
/** Inline handlers of an element, `on click set tip = "x"`: a change to the screen's local state, per event. */
export type LocalSets = Partial<Record<HudEvent, { name: string; expr: Expr }>>;
/** The same handlers resolved against the current state: the state to set and the value it gets. */
export type ViewSets = Partial<Record<HudEvent, [string, Value]>>;
/** A `state <name> = <expr>` declaration of a screen. */
export interface StateDecl { name: string; expr: Expr; src: Src }
export interface ScreenDef {
  name: string;
  src: Src;
  body: ScreenNode[];
  /** The element chosen when a replay has no recorded answer (else the first enabled one). */
  default: string | null;
  /** Declared with `cancel`: the cancel key answers "" instead of being ignored. */
  cancel: boolean;
  /** Declared with `textbox off`: the text box is hidden while a blocking `show screen` of this screen is up. */
  hideBox?: boolean;
  /** `screen room(name, floor):` parameter names; `show screen room("hall", 2)` binds them for that showing. */
  params?: string[];
  /** Names of the parameters declared `inout` (a subset of `params`): copied in from the story variable the call names, written back when the screen answers. */
  inout?: string[];
  /** Declared `cancel keep`: the cancel key answers "" but the `inout` changes are applied (bare `cancel` discards them). */
  cancelKeep?: boolean;
  /** `state` declarations in order: the local state the screen starts with (a blocking screen only keeps it while it is up). */
  states?: StateDecl[];
}

/** The local state a screen starts with: each `state` evaluated in order, with the story variables, the parameters and the earlier states in scope. */
export function initialState(def: ScreenDef | undefined, vars: Vars): Vars {
  const out: Vars = {};
  for (const d of def?.states ?? []) out[d.name] = evalExpr(d.expr, { ...vars, ...out });
  return out;
}

/** The parameters of `def` bound to the values of the `show screen` arguments, as extra variables for drawing it. */
export function screenParams(def: ScreenDef | undefined, args: Expr[] | undefined, vars: Vars): Vars {
  const out: Vars = {};
  (def?.params ?? []).forEach((p, i) => { out[p] = args?.[i] ? evalExpr(args[i], vars) : 0; });
  return out;
}

// ---- resolved view (what a renderer draws) ----

export type ViewPart = (
  | { kind: 'scroll'; /** the number its children carry in `area` */ index: number; x: number; y: number; w: number; h: number; start: 'top' | 'bottom'; bar: boolean; contentH: number }
  | { kind: 'image'; file: string; x: number; y: number; w: number | null; h: number | null }
  | { kind: 'text'; x: number; y: number; text: string; style?: string }
  | { kind: 'slider'; setting: string; x: number; y: number; w: number; h: number; readout: boolean; min: number; max: number; step: number; value: number }
  | { kind: 'panel'; x: number; y: number; w: number; h: number; file: string | null; slice: Sides; edge: FrameEdge }
  | { kind: 'bar'; x: number; y: number; w: number; h: number; back: string | null; fill: string | null; slice: Sides | null; edge: FrameEdge; padding: Sides; color: string | null; value: number; min: number; max: number; /** 0..1 */ fraction: number; /** "37 / 100" with `readout` */ readout: string | null }
  | { kind: 'hotspot' | 'button'; id: string; shape: Shape; label: string; enabled: boolean; cursor: string | null; /** image drawn over the element while it is active */ hover: string | null; /** `hover none`: no highlight while active */ plain: boolean; fx: HoverFx; /** false for `tooltip off` (and for a button) */ tip: boolean; /** `style=` of a button */ style?: string; bounds: StageRect; center: Point; focus: FocusHints; on: HudHandlers; /** built-in action (`action auto`) the shell runs on click */ act: ShellAction | null; /** `on click|focus|blur set`: the local state each event sets (the screen redraws; a click here does not answer the screen) */ sets?: ViewSets; /** a `tab`, `toggle` or `radio`: lit (`checked`) while its state holds its word (a toggle: while it is true) */ role?: 'tab' | 'toggle' | 'radio'; checked?: boolean; /** id of the element this one is a child of (`hotspot ...:` with a body), else absent */ parent?: string }
) & { /** the scroll area (its `index`) this part is inside; coordinates stay stage pixels */ area?: number };
export type ViewItem = Extract<ViewPart, { id: string }>;
export interface ScreenView { name: string; parts: ViewPart[]; default: string | null; cancel: boolean; /** `textbox off`: the shell hides the text box while the screen is up */ hideBox?: true }

/** What a screen needs from the runtime: localized text with variables filled in, and the item table. */
export interface ScreenEnv {
  text: (id: string | null, raw: string, scope: Vars) => string;
  items: Record<string, { name: string; image: string | null }>;
  /** Data the shell attaches to the entries of a list (`entries.slots["3"].when` is `slot.when` in `each slots as slot`); `name` replaces the entry's display name. */
  entries?: Record<string, Record<string, Record<string, Value>>>;
  /** The project's stage size (anchored layouts sit against its edges); the default 1920x1080 when left out. */
  stage?: StageSize;
}

/** Size guess for a button without `size` (40px text with padding): the shell uses it too, so focus and drawing agree. */
export function buttonSize(label: string): { w: number; h: number } {
  return { w: Math.max(200, Array.from(label).length * 24 + 72), h: 84 };
}

/** Size guess for a `text` line (40px text, about 24px a character, 48px a line): layouts need it to place the neighbours. */
export function textSize(text: string): { w: number; h: number } {
  const lines = text.split('\n');
  return { w: Math.max(...lines.map(l => Array.from(l).length)) * 24, h: lines.length * 48 };
}

const truthy = (v: Value) => (Array.isArray(v) ? v.length > 0 : Boolean(v));

export function shapeBounds(s: Shape): StageRect {
  if (s.k !== 'poly') return { x: s.x, y: s.y, w: s.w, h: s.h };
  const xs = s.points.map(p => p[0]), ys = s.points.map(p => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** The point directional focus aims at: the centroid of a polygon (its bounding box centre when it has no area), else the centre. */
export function shapeCenter(s: Shape): Point {
  if (s.k === 'poly') {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < s.points.length; i++) {
      const [x0, y0] = s.points[i], [x1, y1] = s.points[(i + 1) % s.points.length];
      const f = x0 * y1 - x1 * y0;
      a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
    }
    if (Math.abs(a) > 1e-9) return [cx / (3 * a), cy / (3 * a)];
  }
  const b = shapeBounds(s);
  return [b.x + b.w / 2, b.y + b.h / 2];
}

/** Ray casting; points on an edge count as inside only by luck, which is fine for a mouse. */
export function pointInPolygon(points: Point[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i], [xj, yj] = points[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export const pointInRect = (r: StageRect, x: number, y: number) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
export function pointInEllipse(r: StageRect, x: number, y: number): boolean {
  if (r.w <= 0 || r.h <= 0) return false;
  const dx = (x - (r.x + r.w / 2)) / (r.w / 2), dy = (y - (r.y + r.h / 2)) / (r.h / 2);
  return dx * dx + dy * dy <= 1;
}

/** Whether a stage point is in the shape. A mask is only tested against its box here: the shell checks the pixel. */
export function hitTest(s: Shape, x: number, y: number): boolean {
  switch (s.k) {
    case 'rect': case 'mask': return pointInRect(s, x, y);
    case 'ellipse': return pointInEllipse(s, x, y);
    case 'poly': return pointInPolygon(s.points, x, y);
  }
}

export function translate(s: Shape, dx: number, dy: number): Shape {
  if (s.k === 'poly') return { k: 'poly', points: s.points.map(([x, y]) => [x + dx, y + dy] as Point) };
  return { ...s, x: s.x + dx, y: s.y + dy };
}

/**
 * The element of a direction from `from`, or -1: of the candidates ahead (at most about 60 degrees off the
 * direction, else any ahead when none is in that cone) the one with the smallest distance along the direction plus
 * twice the distance across it. Used for the arrow keys and the pad on maps, where reading order means nothing.
 */
export function focusMove(centers: Point[], from: number, dir: 'up' | 'down' | 'left' | 'right'): number {
  const a = centers[from];
  if (!a) return -1;
  const cands: { i: number; along: number; across: number }[] = [];
  centers.forEach((c, i) => {
    if (i === from) return;
    const dx = c[0] - a[0], dy = c[1] - a[1];
    const along = dir === 'up' ? -dy : dir === 'down' ? dy : dir === 'left' ? -dx : dx;
    if (along <= 0.5) return;
    cands.push({ i, along, across: dir === 'up' || dir === 'down' ? Math.abs(dx) : Math.abs(dy) });
  });
  if (!cands.length) return -1;
  const inCone = cands.filter(c => c.across <= c.along * 1.75);
  const pool = inCone.length ? inCone : cands;
  return pool.reduce((best, c) => (c.along + 2 * c.across < best.along + 2 * best.across ? c : best)).i;
}

/** The id of the first `action tab` button of a screen: the tab shown until the player picks another. */
export function firstTab(def: ScreenDef): string {
  const find = (nodes: ScreenNode[]): string => {
    for (const n of nodes) {
      const id = n.kind === 'button' ? (n.act === 'tab' ? n.id : '') : find(childNodes(n));
      if (id) return id;
    }
    return '';
  };
  return find(def.body);
}

/** The labels the elements of a screen call (`on click <label>`), in order, without repeats. */
export function hudLabels(def: ScreenDef | undefined): string[] {
  const out = new Set<string>();
  const walk = (nodes: ScreenNode[]) => {
    for (const n of nodes) {
      if (n.kind === 'each' || n.kind === 'layout' || n.kind === 'scroll' || n.kind === 'panel') walk(n.body);
      else if (n.kind === 'hotspot' || n.kind === 'button') { for (const l of Object.values(n.on)) out.add(l); if (n.body) walk(n.body); }
    }
  };
  if (def) walk(def.body);
  return [...out];
}

// ---- layout ----

export function shiftPart(p: ViewPart, dx: number, dy: number): ViewPart {
  if (dx === 0 && dy === 0) return p;
  if (p.kind === 'image' || p.kind === 'text' || p.kind === 'slider' || p.kind === 'scroll' || p.kind === 'panel' || p.kind === 'bar') return { ...p, x: p.x + dx, y: p.y + dy };
  const shape = translate(p.shape, dx, dy);
  return { ...p, shape, bounds: shapeBounds(shape), center: shapeCenter(shape) };
}

/** The box a part occupies for layout purposes (an image needs its size; text and buttons use the size guesses). */
function partBox(p: ViewPart): StageRect {
  if (p.kind === 'image') return { x: p.x, y: p.y, w: p.w ?? 0, h: p.h ?? 0 };
  if (p.kind === 'text') return { x: p.x, y: p.y, ...textSize(p.text) };
  if (p.kind === 'slider' || p.kind === 'scroll' || p.kind === 'panel' || p.kind === 'bar') return { x: p.x, y: p.y, w: p.w, h: p.h };
  return p.bounds;
}

function groupBox(g: ViewPart[]): StageRect {
  const boxes = g.map(partBox);
  const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
  return { x, y, w: Math.max(...boxes.map(b => b.x + b.w)) - x, h: Math.max(...boxes.map(b => b.y + b.h)) - y };
}

const alignOffset = (align: LayoutAlign, room: number) => (align === 'center' ? room / 2 : align === 'end' ? room : 0);

/** Where a layout's box goes on the stage: `at`, or an anchor with a margin (a layout inside another is placed by its parent: 0,0). */
function anchorOrigin(n: Extract<ScreenNode, { kind: 'layout' }>, w: number, h: number, stage: StageSize): Point {
  if (n.at) return n.at;
  const a = n.anchor;
  if (!a) return [0, 0];
  const [mt, mr, mb, ml] = n.margin;
  const x = a.endsWith('left') || a === 'left' ? ml : a.endsWith('right') ? stage.width - mr - w : (stage.width - w + ml - mr) / 2;
  const y = a.startsWith('top') ? mt : a.startsWith('bottom') ? stage.height - mb - h : (stage.height - h + mt - mb) / 2;
  return [x, y];
}

/** Places the groups of a row, column or grid: every part comes back moved to its cell, the whole at `at` or the anchor. */
function layoutGroups(n: Extract<ScreenNode, { kind: 'layout' }>, groups: ViewPart[][], stage: StageSize): ViewPart[] {
  if (!groups.length) return [];
  const boxes = groups.map(groupBox);
  const moves: Point[] = [];
  let width: number, height: number;
  if (n.type === 'grid') {
    const cols = Math.max(1, n.columns), rows = Math.ceil(groups.length / cols);
    const cw = n.cell?.[0] ?? Math.max(...boxes.map(b => b.w)), ch = n.cell?.[1] ?? Math.max(...boxes.map(b => b.h));
    boxes.forEach((b, i) => {
      const cx = (i % cols) * (cw + n.gap), cy = Math.floor(i / cols) * (ch + n.gap);
      moves.push([cx + alignOffset(n.align, cw - b.w) - b.x, cy + alignOffset(n.align, ch - b.h) - b.y]);
    });
    width = cols * cw + (cols - 1) * n.gap;
    height = rows * ch + (rows - 1) * n.gap;
  } else {
    const row = n.type === 'row';
    const across = Math.max(...boxes.map(b => (row ? b.h : b.w)));
    let at = 0;
    for (const b of boxes) {
      const cross = alignOffset(n.align, across - (row ? b.h : b.w));
      moves.push(row ? [at - b.x, cross - b.y] : [cross - b.x, at - b.y]);
      at += (row ? b.w : b.h) + n.gap;
    }
    const total = at - n.gap;
    width = row ? total : across;
    height = row ? across : total;
  }
  const [pt, pr, pb, pl] = n.padding;
  const [ox, oy] = anchorOrigin(n, width + pl + pr, height + pt + pb, stage);
  return groups.flatMap((g, i) => g.map(p => shiftPart(p, moves[i][0] + ox + pl, moves[i][1] + oy + pt)));
}

// ---- resolution ----

export const pickables = (view: ScreenView): ViewItem[] => view.parts.filter((p): p is ViewItem => 'id' in p);
/** The enabled elements that answer the screen when chosen (an element with `on click set` only changes local state). */
export const enabledItems = (view: ScreenView): ViewItem[] => pickables(view).filter(p => p.enabled && !p.sets?.click);

/** Whether the screen waits for the player: something can be chosen, or the player can cancel out. */
export const blocks = (view: ScreenView) => view.cancel || enabledItems(view).length > 0;

/** What an unrecorded screen answers (restore, Preview from cursor): the declared default if it can be chosen, else the first enabled element, else "". */
export function defaultAnswer(view: ScreenView): string {
  const on = enabledItems(view);
  return on.find(p => p.id === view.default)?.id ?? on[0]?.id ?? '';
}

/** A recorded answer if it still names an enabled element (or is the cancel answer of a cancellable screen); else the default. */
export function replayAnswer(view: ScreenView, recorded: Value | undefined): string {
  if (recorded === undefined) return defaultAnswer(view);
  const id = String(recorded);
  if (id === '' ? view.cancel : enabledItems(view).some(p => p.id === id)) return id;
  return defaultAnswer(view);
}

/** Whether a value recorded for `inout` parameter `name` still fits the screen: the type of its current value, and a word one of its radios sets. */
export function fitsInout(def: ScreenDef, name: string, recorded: Value | undefined, current: Value): boolean {
  if (recorded === undefined || Array.isArray(recorded) !== Array.isArray(current) || typeof recorded !== typeof current) return false;
  const words: Value[] = [];
  const find = (nodes: ScreenNode[]) => {
    for (const n of nodes) {
      if (n.kind === 'button' && n.bind?.role === 'radio' && n.bind.name === name) words.push(n.bind.value!);
      find(childNodes(n));
    }
  };
  find(def.body);
  return !words.length || words.includes(recorded);
}

/** Evaluates the screen's conditions and fills in its text for the current variables. Never draws and never changes anything. */
export function resolveScreen(def: ScreenDef, scope: Vars, env: ScreenEnv): ScreenView {
  const parts: ViewPart[] = [];
  let areas = 0;
  const entryScope = (n: Extract<ScreenNode, { kind: 'each' }>, vars: Vars, entry: Value, i: number): Vars => {
    const id = String(entry), info = env.items[id];
    const extra = Object.fromEntries(Object.entries(env.entries?.[n.list]?.[id] ?? {}).map(([k, v]) => [`${n.as}.${k}`, v]));
    return { ...vars, [n.as]: id, [`${n.as}.name`]: info?.name ?? id, [`${n.as}.image`]: info?.image ?? '', [`${n.as}.index`]: i + 1, ...extra };
  };
  /** Each child of a layout as the parts it resolves to (an `each` contributes one group per child per entry). */
  const groupsOf = (nodes: ScreenNode[], vars: Vars, loop: string | null): ViewPart[][] => {
    const groups: ViewPart[][] = [];
    for (const n of nodes) {
      if (n.cond && !truthy(evalExpr(n.cond, vars))) continue;
      if (n.kind === 'each') {
        const list = vars[n.list];
        (Array.isArray(list) ? list : []).slice(0, n.limit ?? undefined).forEach((entry, i) => groups.push(...groupsOf(n.body, entryScope(n, vars, entry, i), n.as)));
      } else {
        const g: ViewPart[] = [];
        walk([n], vars, 0, 0, loop, g);
        if (g.length) groups.push(g);
      }
    }
    return groups;
  };
  /** The body of a hotspot or button that was just pushed as the last part: drawn after it, in the same coordinates, each child marked with its parent's id. */
  const children = (n: ScreenNode, vars: Vars, ox: number, oy: number, loop: string | null, parts: ViewPart[]) => {
    if ((n.kind !== 'hotspot' && n.kind !== 'button') || !n.body?.length) return;
    const owner = parts[parts.length - 1] as ViewItem;
    const inner: ViewPart[] = [];
    walk(n.body, vars, ox, oy, loop, inner);
    for (const p of inner) parts.push('id' in p && p.parent === undefined ? { ...p, parent: owner.id } : p);
  };
  /** What an element adds to its part for local state: its handlers evaluated now, and a tab's lit state. */
  const local = (n: Extract<ScreenNode, { kind: 'hotspot' | 'button' }>, vars: Vars) => {
    const sets: ViewSets = {};
    for (const [e, h] of Object.entries(n.sets ?? {})) sets[e as HudEvent] = [h.name, evalExpr(h.expr, vars)];
    const bind = n.kind === 'button' ? n.bind : undefined;
    if (!bind) return Object.keys(sets).length ? { sets } : {};
    const checked = bind.role === 'toggle' ? truthy(vars[bind.name] ?? false) : vars[bind.name] === bind.value;
    sets.click = [bind.name, bind.role === 'toggle' ? !checked : bind.value!];
    return { sets, role: bind.role, checked };
  };
  const walk = (nodes: ScreenNode[], vars: Vars, ox: number, oy: number, loop: string | null, parts: ViewPart[]) => {
    /** Inside `each`, an element named like the loop variable stands for the entry itself. */
    const elementId = (id: string) => (id === loop ? String(vars[loop]) : id);
    const hints = (f: FocusHints): FocusHints => Object.fromEntries(Object.entries(f).map(([d, id]) => [d, elementId(id)]));
    for (const n of nodes) {
      if (n.cond && !truthy(evalExpr(n.cond, vars))) continue;
      switch (n.kind) {
        case 'image':
          parts.push({ kind: 'image', file: env.text(null, n.file, vars), x: n.x + ox, y: n.y + oy, w: n.w, h: n.h });
          break;
        case 'text':
          parts.push({ kind: 'text', x: n.x + ox, y: n.y + oy, text: env.text(n.id, n.text, vars), ...(n.style ? { style: n.style } : {}) });
          break;
        case 'slider': {
          const r = SLIDER_SETTINGS[n.setting as keyof typeof SLIDER_SETTINGS] ?? SLIDER_SETTINGS.master;
          const v = Number(vars[n.setting]);
          parts.push({ kind: 'slider', setting: n.setting, x: n.x + ox, y: n.y + oy, w: n.w, h: n.h, readout: n.readout, ...r, value: Number.isFinite(v) ? Math.min(r.max, Math.max(r.min, v)) : r.min });
          break;
        }
        case 'hotspot': {
          const shape = translate(n.shape, ox, oy);
          parts.push({
            kind: 'hotspot', id: elementId(n.id), shape, label: env.text(n.labelId, n.label, vars),
            enabled: !n.enabled || truthy(evalExpr(n.enabled, vars)), cursor: n.cursor, hover: n.hover ? env.text(null, n.hover, vars) : null, plain: n.plain, fx: n.fx, tip: n.tip, bounds: shapeBounds(shape), center: shapeCenter(shape), focus: hints(n.focus), on: n.on, act: n.act, ...local(n, vars),
          });
          children(n, vars, ox, oy, loop, parts);
          break;
        }
        case 'button': {
          const label = env.text(n.labelId, n.label, vars);
          const size = buttonSize(label);
          const shape: Shape = { k: 'rect', x: n.x + ox, y: n.y + oy, w: n.w ?? size.w, h: n.h ?? size.h };
          parts.push({
            kind: 'button', id: elementId(n.id), shape, label,
            enabled: !n.enabled || truthy(evalExpr(n.enabled, vars)), cursor: null, hover: n.hover ? env.text(null, n.hover, vars) : null, plain: n.plain, fx: n.fx, tip: false, ...(n.style ? { style: n.style } : {}), bounds: shapeBounds(shape), center: shapeCenter(shape), focus: hints(n.focus), on: n.on, act: n.act, ...local(n, vars),
          });
          children(n, vars, ox, oy, loop, parts);
          break;
        }
        case 'each': {
          const list = vars[n.list];
          (Array.isArray(list) ? list : []).slice(0, n.limit ?? undefined).forEach((entry, i) => walk(n.body, entryScope(n, vars, entry, i), ox + n.x + i * n.dx, oy + n.y + i * n.dy, n.as, parts));
          break;
        }
        case 'scroll': {
          const inner: ViewPart[] = [];
          walk(n.body, vars, 0, 0, loop, inner);
          const index = areas++;
          const content = Math.max(0, ...inner.map(p => partBox(p).y + partBox(p).h));
          parts.push({ kind: 'scroll', index, x: n.x + ox, y: n.y + oy, w: n.w, h: n.h, start: n.start, bar: n.bar, contentH: Math.max(content, n.h) });
          for (const p of inner) parts.push({ ...shiftPart(p, n.x + ox, n.y + oy), area: index });
          break;
        }
        case 'panel': {
          const inner: ViewPart[] = [];
          walk(n.body, vars, 0, 0, loop, inner);
          const [pt, pr, pb, pl] = n.padding;
          const boxes = inner.map(partBox);
          // without a size the panel fits its children, and never gets smaller than its frame's corners
          const w = n.w ?? Math.max(n.file ? n.slice[1] + n.slice[3] : 0, pl + pr + Math.max(0, ...boxes.map(b => b.x + b.w)));
          const h = n.h ?? Math.max(n.file ? n.slice[0] + n.slice[2] : 0, pt + pb + Math.max(0, ...boxes.map(b => b.y + b.h)));
          parts.push({ kind: 'panel', x: n.x + ox, y: n.y + oy, w, h, file: n.file ? env.text(null, n.file, vars) : null, slice: n.slice, edge: n.edge });
          for (const p of inner) parts.push(shiftPart(p, n.x + ox + pl, n.y + oy + pt));
          break;
        }
        case 'bar': {
          const num = (e: Expr) => { const v = Number(evalExpr(e, vars)); return Number.isFinite(v) ? v : 0; };
          const min = num(n.min), max = num(n.max), value = Math.min(Math.max(num(n.value), min), Math.max(min, max));
          const fraction = max > min ? (value - min) / (max - min) : 0;
          const shown = (v: number) => String(Math.round(v * 10) / 10);
          parts.push({
            kind: 'bar', x: n.x + ox, y: n.y + oy, w: n.w, h: n.h, back: n.back ? env.text(null, n.back, vars) : null, fill: n.fill ? env.text(null, n.fill, vars) : null,
            slice: n.slice, edge: n.edge, padding: n.padding, color: n.color, value, min, max, fraction, readout: n.readout ? `${shown(value)} / ${shown(max)}` : null,
          });
          break;
        }
        case 'layout':
          for (const p of layoutGroups(n, groupsOf(n.body, vars, loop), env.stage ?? DEFAULT_STAGE)) parts.push(shiftPart(p, ox, oy));
          break;
      }
    }
  };
  walk(def.body, scope, 0, 0, null, parts);
  return { name: def.name, parts, default: def.default, cancel: def.cancel, ...(def.hideBox ? { hideBox: true as const } : {}) };
}

// ---- validation ----

export interface ScreenProblem { src: Src; severity: 'error' | 'warning'; message: string }

/** Problems in one screen declaration that need no variables: ids, shapes, an empty screen. */
export function validateScreen(def: ScreenDef, stage: StageSize = DEFAULT_STAGE): ScreenProblem[] {
  const out: ScreenProblem[] = [];
  const problem = (src: Src, severity: 'error' | 'warning', message: string) => out.push({ src, severity, message });
  const ids = new Set<string>();
  const hinted: { src: Src; from: string; to: string }[] = [];
  let interactive = 0, hasEach = false;
  const walk = (nodes: ScreenNode[], loop: string | null, area = false, nested = false) => {
    for (const n of nodes) {
      if (n.kind === 'scroll') {
        if (area) problem(n.src, 'error', 'A scroll area cannot be inside another scroll area');
        else if (nested) problem(n.src, 'error', 'A scroll area goes directly in the screen, not inside each, row, column or grid');
        if (n.w <= 0 || n.h <= 0) problem(n.src, 'error', 'A scroll area needs a size above zero');
        walk(n.body, loop, true, nested);
        continue;
      }
      if (n.kind === 'each') { hasEach = true; walk(n.body, n.as, area, true); continue; }
      if (n.kind === 'panel') {
        if ((n.w !== null && n.w <= 0) || (n.h !== null && n.h <= 0)) problem(n.src, 'error', 'A panel needs a size above zero');
        else if (n.w === null && n.h === null && !n.body.length && !n.file) problem(n.src, 'warning', 'An empty panel without a size or an image draws nothing useful (give it size w,h)');
        if (n.slice.some(s => s < 0)) problem(n.src, 'error', 'A panel slice cannot be negative');
        walk(n.body, loop, area, nested);
        continue;
      }
      if (n.kind === 'bar') {
        if (n.w <= 0 || n.h <= 0) problem(n.src, 'error', 'A bar needs a size above zero');
        continue;
      }
      if (n.kind === 'layout') {
        if (n.type === 'grid' && n.cell && (n.cell[0] <= 0 || n.cell[1] <= 0)) problem(n.src, 'error', 'A grid cell needs a size above zero');
        walk(n.body, loop, area, true);
        continue;
      }
      if (area && n.kind === 'hotspot' && (n.shape.k === 'poly' || n.shape.k === 'mask')) problem(n.src, 'error', 'A poly or mask hotspot cannot be inside a scroll area (use a rect or ellipse)');
      if (area && n.kind === 'slider') problem(n.src, 'error', 'A slider cannot be inside a scroll area');
      if ((n.kind === 'hotspot' || n.kind === 'button') && n.body?.length && loop !== null) problem(n.src, 'error', `"${n.id}" has child elements, which "each" cannot repeat (every copy would share the children's ids); put the group outside the each`);
      if (n.kind === 'hotspot' || n.kind === 'button') {
        interactive++;
        if (loop !== null && n.id !== loop) problem(n.src, 'error', `Inside "each", the element id must be "${loop}" (the entry), or every copy would share one id`);
        else if (loop === null && ids.has(n.id)) problem(n.src, 'error', `Duplicate element id "${n.id}" in screen ${def.name}`);
        if (loop === null) ids.add(n.id);
        if (loop === null) for (const to of Object.values(n.focus)) hinted.push({ src: n.src, from: n.id, to });
        if (n.id === '') problem(n.src, 'error', 'An element id cannot be empty (an empty answer means cancel)');
      }
      if (n.kind === 'hotspot') {
        const s = n.shape, b = shapeBounds(s);
        if (s.k === 'poly' && s.points.length < 3) problem(n.src, 'error', 'A poly needs at least three points');
        if (s.k !== 'poly' && (s.w <= 0 || s.h <= 0)) problem(n.src, 'error', 'A hotspot needs a size above zero');
        if (loop === null && (b.x + b.w < 0 || b.y + b.h < 0 || b.x > stage.width || b.y > stage.height)) {
          problem(n.src, 'warning', `Hotspot "${n.id}" is outside the ${stageLabel(stage)} stage (coordinates are stage pixels)`);
        }
      }
      if (n.kind === 'button' && loop === null && (n.x < 0 || n.y < 0 || n.x > stage.width || n.y > stage.height)) {
        problem(n.src, 'warning', `Button "${n.id}" is outside the ${stageLabel(stage)} stage (coordinates are stage pixels)`);
      }
      if ((n.kind === 'hotspot' || n.kind === 'button') && n.body?.length) walk(n.body, loop, area, nested);
    }
  };
  walk(def.body, null);
  if (!hasEach) for (const h of hinted) if (!ids.has(h.to)) problem(h.src, 'error', `"${h.from}" moves focus to "${h.to}", which is not an element of screen ${def.name}`);
  if (!interactive && !def.cancel && def.name !== ACHIEVEMENT_TOAST_SCREEN) problem(def.src, 'warning', `Screen ${def.name} has nothing to choose (it would return at once)`);
  if (def.default !== null && !ids.has(def.default) && !hasEach) problem(def.src, 'error', `Default "${def.default}" is not an element of screen ${def.name}`);
  return out;
}
