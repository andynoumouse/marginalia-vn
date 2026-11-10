// Custom screens: the declaration (`screen map:` blocks), its resolution against the current variables, and the pure
// geometry the shell needs (hit tests, directional focus, the default answer). No DOM here: preview/screen-ui.ts draws.
// Coordinates are stage pixels (the project's stage size, 1920x1080 unless game.json says otherwise; origin top left, y down).

import { evalExpr, type Expr, type Value } from './expr.js';
import { DEFAULT_STAGE, type StageSize } from './stage.js';
import type { Src, Vars } from './types.js';
import { partAnim, staggered, type ElementAnim, type PartAnim } from './screen-anim.js';
import { shapeBounds, shapeCenter, translate } from './screen-geometry.js';
import { layoutGroups, partBox, shiftPart } from './screen-layout.js';
import { nameParts } from './screen-names.js';

export * from './screen-geometry.js';
export * from './screen-validate.js';
export { shiftPart } from './screen-layout.js';

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
export const SHELL_ACTIONS = ['back', 'history', 'auto', 'skip', 'qsave', 'qload', 'save', 'load', 'options', 'hide', 'start', 'continue', 'quit', 'resume', 'title', 'close', 'fullscreen', 'reset', 'tab', 'cycle', 'slot', 'page', 'delete', 'gallery', 'tile', 'music', 'track', 'stop', 'chapters', 'chapter', 'achievements', 'next', 'prev', 'voice', 'line', 'remove', 'rename', 'select', 'choose'] as const;
export type ShellAction = typeof SHELL_ACTIONS[number];
/** Reserved screen name: when a project declares it, the shell draws it in place of the default quick menu bar. */
export const QUICKMENU_SCREEN = 'quickmenu';
/** Reserved screen name: when a project declares it, the shell draws it in place of the default title screen. */
export const TITLE_SCREEN = 'title';
/** Reserved screen name: when a project declares it, the shell draws it in place of the default pause menu. */
export const PAUSE_SCREEN = 'pause';
/** Reserved screen name: when a project declares it, the shell draws it in place of the default options screen. */
export const OPTIONS_SCREEN = 'options';
/** Reserved screen name: when a project declares it, the shell draws it in place of the default save/load screen. */
export const SAVES_SCREEN = 'saves';
/** Reserved screen name: the history panel; a project's own replaces the default. */
export const HISTORY_SCREEN = 'history';
/** Reserved screen name: when a project declares it, the shell draws it in place of the default gallery. */
export const GALLERY_SCREEN = 'gallery';
/** Reserved screen name: the picture viewer a gallery tile opens; a project's own replaces the default. */
export const VIEWER_SCREEN = 'viewer';
/** Reserved screen name: when a project declares it, the shell draws it in place of the default music room. */
export const MUSIC_SCREEN = 'music';
/** Reserved screen name: when a project declares it, the shell draws it in place of the default chapter select. */
export const CHAPTERS_SCREEN = 'chapters';
/** Reserved screen name: when a project declares it, the shell draws it in place of the default achievements and endings list. */
export const ACHIEVEMENTS_SCREEN = 'achievements';
/** Reserved screen name: when a project declares it, the shell draws it in place of the default notice that pops up when an achievement unlocks. */
export const ACHIEVEMENT_TOAST_SCREEN = 'achievement_toast';
/** Variables the shell fills in on a reserved screen (not story variables): the options settings, the saves screen's mode, page, page and slot lists and delete toggle, the history's lines, the gallery's tiles, the viewer's picture, the music room's tracks, the chapter select's chapters, the achievements list or the achievement toast. */
export function shellVars(screen: string): string[] {
  if (screen === TITLE_SCREEN) return TITLE_VARS;
  if (screen === OPTIONS_SCREEN) return ['tab', ...Object.keys(SLIDER_SETTINGS), ...CYCLE_SETTINGS, ...CYCLE_SETTINGS.map(c => `${c}_word`), ...OPTIONS_VARS];
  if (screen === SAVES_SCREEN) return ['mode', 'page', 'pages', 'slots', 'deleting', 'note', 'can_rename'];
  if (screen === HISTORY_SCREEN) return ['lines', 'total'];
  if (screen === GALLERY_SCREEN) return ['tiles', 'count', 'total'];
  if (screen === VIEWER_SCREEN) return ['file', 'title', 'position', 'total'];
  if (screen === MUSIC_SCREEN) return ['tracks', 'count', 'total', 'now'];
  if (screen === CHAPTERS_SCREEN) return ['chapters', 'count', 'total'];
  if (screen === ACHIEVEMENTS_SCREEN) return ['achievements', 'endings', 'count', 'total', 'endings_count', 'endings_total'];
  if (screen === ACHIEVEMENT_TOAST_SCREEN) return ['title', 'description', 'icon', 'ending', 'position'];
  if (screen === QUICKMENU_SCREEN) return ['quick_items', 'quick_place'];
  return [];
}
/**
 * What the shell tells the title screen: the game's name (game.json `title`), whether to show it (`titleScreen.showTitle`), and which of the
 * buttons have something behind them (a save to continue, and gallery, music, chapters or achievements that are set up and listed in `titleScreen.buttons`).
 */
export const TITLE_VARS = ['game_title', 'show_title', 'can_continue', 'continue_text', 'has_gallery', 'has_music', 'has_chapters', 'has_achievements'];
/** Extra fields the shell gives each entry of an `each` on a reserved screen (`slot.when`), next to `.name`, `.image` and `.index`. */
export function shellEntryFields(screen: string): string[] {
  return screen === SAVES_SCREEN ? ['title', 'heading', 'label', 'when', 'text', 'empty', 'thumb', 'removable', 'renamable'] : screen === HISTORY_SCREEN ? ['text', 'current', 'voiced'] : screen === GALLERY_SCREEN ? ['title', 'unlocked', 'file']
    : screen === MUSIC_SCREEN ? ['title', 'unlocked', 'playing'] : screen === CHAPTERS_SCREEN ? ['title', 'unlocked']
    : screen === ACHIEVEMENTS_SCREEN ? ['title', 'description', 'icon', 'unlocked', 'hidden', 'ending']
    : screen === QUICKMENU_SCREEN ? ['label'] : [];
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
export const CYCLE_SETTINGS = ['text_sounds', 'auto_speed', 'skip', 'reduce_motion', 'captions', 'speaker_focus', 'timed_choices', 'language', 'announce_lines', 'touch_gestures', 'theme', 'voice_language'] as const;
export type CycleSetting = (typeof CYCLE_SETTINGS)[number];
/**
 * A `select <setting>` on the options screen: a button showing the setting's current value that opens a list of its values. The shell tells the
 * screen the list as the variable `<setting>_options` (the values) with entries `<setting>_options` carrying each one's `label`, and which select is open
 * as `select_open` (a setting name, or ""). The open list is drawn from these by `resolveScreen`; the shell answers `action select` (open or close) and `action choose`
 * (the option's id is `<setting>.<value>`).
 */
export const SELECT_SETTINGS = CYCLE_SETTINGS;
/** What else the shell tells the options screen: which of the optional settings the game offers (a second language, a theme choice, voice recordings, a fullscreen mode). Each cycle setting also has a `<setting>_word` variable, its current value written in the player's language. */
export const OPTIONS_VARS = ['has_languages', 'has_themes', 'has_voice_languages', 'has_fullscreen', 'has_touch'];
/** Art-free hover look of a hotspot or button: `hover tint <color>`, `hover scale <n>`, `hover sound "name"`. */
export interface HoverFx { tint: string | null; scale: number | null; sound: string | null }

/** Explicit focus moves of an element: the id the arrow keys go to instead of the nearest one. */
export type FocusHints = Partial<Record<'up' | 'down' | 'left' | 'right', string>>;

export const LAYOUT_ANCHORS = ['topleft', 'top', 'topright', 'left', 'center', 'right', 'bottomleft', 'bottom', 'bottomright'] as const;
export type LayoutAnchor = typeof LAYOUT_ANCHORS[number];
export type LayoutKind = 'row' | 'column' | 'grid';
export type LayoutAlign = 'start' | 'center' | 'end' | 'stretch';
/** How the edges of a 9-slice frame fill their strip (CSS `border-image-repeat`). */
export const FRAME_EDGES = ['stretch', 'repeat', 'round'] as const;
export type FrameEdge = typeof FRAME_EDGES[number];
/** The slice a frame image gets when the script gives none (the same 32px the theme's `slice` defaults to). */
export const DEFAULT_SLICE: Sides = [32, 32, 32, 32];

/** `anim`: the node's `on enter` / `loop`; a container hands them to every element it holds (a child's own clause wins). */
interface Common { src: Src; cond: Expr | null; anim?: ElementAnim }
export type ScreenNode = Common & (
  | { kind: 'image'; file: string; x: number; y: number; w: number | null; h: number | null }
  | { kind: 'text'; x: number; y: number; text: string; id: string | null; style?: string; /** px, default 40 */ font?: number; /** a box this wide (px), the text aligned inside it */ width?: number; align?: 'left' | 'center' | 'right'; /** CSS colour */ color?: string; /** show at most this many lines */ lines?: number; /** shrink the font until the text fits `width` in `lines` lines */ fit?: boolean }
  /** A range input bound to a player setting (options screen). */
  | { kind: 'slider'; setting: string; x: number; y: number; w: number; h: number; readout: boolean }
  | { kind: 'hotspot'; id: string; shape: Shape; label: string; labelId: string | null; enabled: Expr | null; cursor: string | null; hover: string | null; plain: boolean; fx: HoverFx; tip: boolean; focus: FocusHints; on: HudHandlers; act: ShellAction | null; sets?: LocalSets; /** elements shown with it, in stage coordinates: the group stays active while any of them is */ body?: ScreenNode[] }
  | { kind: 'button'; id: string; x: number; y: number; w: number | null; h: number | null; label: string; labelId: string | null; enabled: Expr | null; hover: string | null; plain: boolean; fx: HoverFx; focus: FocusHints; on: HudHandlers; act: ShellAction | null; /** `action [name]`: the action is this variable's value */ actVar?: string; style?: string; /** px, default 40 */ font?: number; /** `tooltip "text"` */ tooltip?: string; /** `sub "text"`: a smaller second line inside the button */ sub?: string; /** `select <setting>`: the button that opens the list of the setting's values */ select?: true; sets?: LocalSets; bind?: Bind; body?: ScreenNode[] }
  /** One copy of the body per entry of the list variable; offsets are `at` plus the entry's number times `step`. */
  | { kind: 'each'; list: string; as: string; x: number; y: number; dx: number; dy: number; /** at most this many entries are drawn */ limit: number | null; body: ScreenNode[] }
  /** A clipped box that scrolls its children, placed relative to its top left (so they need no stage coordinates). */
  | { kind: 'scroll'; x: number; y: number; w: number; h: number; start: 'top' | 'bottom'; bar: boolean; body: ScreenNode[] }
  /** A row, column or grid: places its children one after another (an `each` inside spreads its entries), so they need no `at`. */
  | { kind: 'layout'; type: LayoutKind; columns: number; at: Point | null; anchor: LayoutAnchor | null; /** `anchor [name]`: the place is this variable's value */ anchorVar?: string; margin: Sides; padding: Sides; gap: number; align: LayoutAlign; cell: Point | null; /** least size of the box (px) */ width?: number; height?: number; body: ScreenNode[] }
  /**
   * A box framed by a 9-slice image (`file`: the corners keep their size, the edges stretch, repeat or round). Its children are placed
   * from its top left plus `padding`; without a size it fits them. With no image it is the default panel look.
   */
  | { kind: 'panel'; x: number; y: number; w: number | null; h: number | null; file: string | null; slice: Sides; edge: FrameEdge; padding: Sides; /** a plain fill (a dimmer) */ color?: string; body: ScreenNode[] }
  /** A filled bar showing `value` between `min` and `max`; `back` is the frame, `fill` the part that grows (cropped, or 9-sliced when `slice` is set). */
  | { kind: 'bar'; x: number; y: number; w: number; h: number; value: Expr; min: Expr; max: Expr; back: string | null; fill: string | null; slice: Sides | null; edge: FrameEdge; padding: Sides; color: string | null; readout: boolean }
);

/** What a `tab`, `toggle` or `radio` sets: the local state it is bound to and, for a tab or radio, the word it sets (a toggle flips the state). */
export interface Bind { role: 'tab' | 'toggle' | 'radio'; name: string; value: Value | null }

/** The nodes inside an `each`, a layout, a scroll area or a panel. */
/** A hotspot or a button: the elements that take clicks, hover and focus, and may hold child elements. */
export const isClickable = (n: ScreenNode): n is Extract<ScreenNode, { kind: 'hotspot' | 'button' }> => n.kind === 'hotspot' || n.kind === 'button';

/** Calls `visit` on every node of the trees, each parent before its children. */
export function walkNodes(nodes: ScreenNode[], visit: (n: ScreenNode) => void): void {
  for (const n of nodes) { visit(n); walkNodes(childNodes(n), visit); }
}
export const childNodes = (n: ScreenNode): ScreenNode[] => (n.kind === 'each' || n.kind === 'layout' || n.kind === 'scroll' || n.kind === 'panel' ? n.body : isClickable(n) ? n.body ?? [] : []);
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
  | { kind: 'text'; x: number; y: number; text: string; style?: string; font?: number; width?: number; align?: 'left' | 'center' | 'right'; color?: string; lines?: number; fit?: boolean }
  | { kind: 'slider'; setting: string; x: number; y: number; w: number; h: number; readout: boolean; min: number; max: number; step: number; value: number; /** what a screen reader calls it: the text beside it (see `nameParts`) */ name?: string }
  | { kind: 'panel'; x: number; y: number; w: number; h: number; file: string | null; slice: Sides; edge: FrameEdge; color?: string }
  | { kind: 'bar'; x: number; y: number; w: number; h: number; back: string | null; fill: string | null; slice: Sides | null; edge: FrameEdge; padding: Sides; color: string | null; value: number; min: number; max: number; /** 0..1 */ fraction: number; /** "37 / 100" with `readout` */ readout: string | null }
  | { kind: 'hotspot' | 'button'; id: string; shape: Shape; label: string; enabled: boolean; cursor: string | null; /** image drawn over the element while it is active */ hover: string | null; /** `hover none`: no highlight while active */ plain: boolean; fx: HoverFx; /** false for `tooltip off` (and for a button) */ tip: boolean; /** `style=` of a button */ style?: string; /** px of a button's label, default 40 */ font?: number; /** a button's `tooltip "text"`, worked out */ tooltip?: string; /** a button's `sub "text"`, worked out (empty: none) */ sub?: string; /** a `select`'s values; its list is drawn below it while `open` (see `expandSelects`) */ select?: { options: { value: string; label: string }[]; value: string; open: boolean }; bounds: StageRect; center: Point; focus: FocusHints; on: HudHandlers; /** built-in action (`action auto`) the shell runs on click */ act: ShellAction | null; /** `on click|focus|blur set`: the local state each event sets (the screen redraws; a click here does not answer the screen) */ sets?: ViewSets; /** a `tab`, `toggle` or `radio`: lit (`checked`) while its state holds its word (a toggle: while it is true) */ role?: 'tab' | 'toggle' | 'radio'; checked?: boolean; /** id of the element this one is a child of (`hotspot ...:` with a body), else absent */ parent?: string; /** what a screen reader calls a button when its label is not enough (`nameParts`): "Reduce motion: On", a save slot's card text, "Delete save: Slot 2" */ name?: string }
) & { /** the scroll area (its `index`) this part is inside; coordinates stay stage pixels */ area?: number; /** `on enter` / `loop` of the element or of a container around it, with a key that survives redraws */ anim?: PartAnim };
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
export function buttonSize(label: string, font = 40, sub = ''): { w: number; h: number } {
  const k = font / 40;
  // a `sub` line is drawn at 55% of the label's size
  const subW = Array.from(sub).length * 24 * k * 0.55 + 72 * k;
  return { w: Math.max(200 * k, Array.from(label).length * 24 * k + 72 * k, subW), h: 84 * k + (sub ? 28 * k : 0) };
}

/** Size guess for a `text` line (40px text, about 24px a character, 48px a line): layouts need it to place the neighbours. */
export function textSize(text: string, font = 40, width?: number): { w: number; h: number } {
  const lines = text.split('\n');
  return { w: width ?? Math.max(...lines.map(l => Array.from(l).length)) * font * 0.6, h: lines.length * font * 1.2 };
}

const truthy = (v: Value) => (Array.isArray(v) ? v.length > 0 : Boolean(v));


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
  if (def) walkNodes(def.body, n => { if (isClickable(n)) for (const l of Object.values(n.on)) out.add(l); });
  return [...out];
}

/** A text's `color`: a CSS color, or `[variable]` worked out (nothing when the variable is empty, so the default colour stays). */
function textColor(raw: string, env: ScreenEnv, vars: Vars): { color?: string } {
  const c = env.text(null, raw, vars);
  return c ? { color: c } : {};
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

/** The values a `select` offers, from the shell's `<setting>_options` list and entries (a value without an entry is its own label). */
function selectOptions(setting: string, vars: Vars, env: ScreenEnv): { value: string; label: string }[] {
  const list = vars[`${setting}_options`];
  return (Array.isArray(list) ? list : []).map(v => ({ value: String(v), label: String(env.entries?.[`${setting}_options`]?.[String(v)]?.label ?? v) }));
}

/**
 * The lists of the open `select`s, as parts to add after the rest of the screen (so they sit on top and do not move the layout): one button per
 * value under the select, as wide and as tall as it, or above it when there is no room below. The current value is lit (a radio); an option's id is
 * `<setting>.<value>` and its action `choose`.
 */
function expandSelects(parts: ViewPart[], stage: StageSize): ViewPart[] {
  const out: ViewPart[] = [];
  for (const p of parts) {
    if (p.kind !== 'button' || !p.select?.open) continue;
    const b = p.bounds, n = p.select.options.length, gap = 4;
    const below = b.y + b.h + gap + n * (b.h + gap) <= stage.height || b.y - n * (b.h + gap) < 0;
    const top = below ? b.y + b.h : b.y - n * (b.h + gap) - gap;
    // a backing under the buttons, so the rows behind the list do not show through the gaps
    out.push({ kind: 'panel', x: b.x - gap, y: top, w: b.w + 2 * gap, h: n * (b.h + gap) + gap, file: null, slice: DEFAULT_SLICE, edge: 'stretch', ...(p.area !== undefined ? { area: p.area } : {}) });
    p.select.options.forEach((o, i) => {
      const shape: Shape = { k: 'rect', x: b.x, y: below ? b.y + (i + 1) * (b.h + gap) : b.y - (n - i) * (b.h + gap), w: b.w, h: b.h };
      out.push({
        kind: 'button', id: `${p.id}.${o.value}`, shape, label: o.label, enabled: true, cursor: null, hover: null, plain: false, fx: { tint: null, scale: null, sound: null }, tip: false,
        ...(p.style ? { style: p.style } : {}), ...(p.font ? { font: p.font } : {}), bounds: shapeBounds(shape), center: shapeCenter(shape), focus: {}, on: {}, act: 'choose',
        role: 'radio', checked: o.value === p.select!.value, ...(p.area !== undefined ? { area: p.area } : {}),
      });
    });
  }
  return out;
}

/** Evaluates the screen's conditions and fills in its text for the current variables. Never draws and never changes anything. */
export function resolveScreen(def: ScreenDef, scope: Vars, env: ScreenEnv): ScreenView {
  const parts: ViewPart[] = [];
  let areas = 0;
  // `on enter` / `loop` of the containers around the node being resolved, and the `each` entries it sits in (the key of its part)
  let inherit: ElementAnim | null = null;
  const path: string[] = [];
  const merged = (n: ScreenNode): ElementAnim | null => (n.anim ? { enter: n.anim.enter ?? inherit?.enter, exit: n.anim.exit ?? inherit?.exit, loop: n.anim.loop ?? inherit?.loop } : inherit);
  const within = <T,>(n: ScreenNode, fn: () => T): T => {
    const prev = inherit;
    inherit = merged(n);
    try { return fn(); } finally { inherit = prev; }
  };
  /** One entry of an `each`: its elements enter `stagger` seconds later than the entry before. */
  const entry = <T,>(n: Extract<ScreenNode, { kind: 'each' }>, value: Value, i: number, fn: () => T): T => {
    const prev = inherit, m = merged(n);
    inherit = m ? staggered(m, i) : null;
    path.push(`[${String(value)}]`);
    try { return fn(); } finally { path.pop(); inherit = prev; }
  };
  const mark = <P extends ViewPart>(n: ScreenNode, p: P): P => {
    const a = merged(n);
    const anim = a ? partAnim(a, `${n.src.file}:${n.src.line}${path.join('')}`, p.kind) : null;
    return anim ? { ...p, anim } : p;
  };
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
        (Array.isArray(list) ? list : []).slice(0, n.limit ?? undefined).forEach((e, i) => entry(n, e, i, () => groups.push(...groupsOf(n.body, entryScope(n, vars, e, i), n.as))));
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
    const body = n.body;
    const owner = parts[parts.length - 1] as ViewItem;
    const inner: ViewPart[] = [];
    within(n, () => walk(body, vars, ox, oy, loop, inner));
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
    const elementId = (id: string) => (id === loop ? String(vars[loop]) : loop && id.startsWith(`${loop}.`) ? String(vars[loop]) + id.slice(loop.length) : id);
    const hints = (f: FocusHints): FocusHints => Object.fromEntries(Object.entries(f).map(([d, id]) => [d, elementId(id)]));
    for (const n of nodes) {
      if (n.cond && !truthy(evalExpr(n.cond, vars))) continue;
      switch (n.kind) {
        case 'image':
          parts.push(mark(n, { kind: 'image', file: env.text(null, n.file, vars), x: n.x + ox, y: n.y + oy, w: n.w, h: n.h }));
          break;
        case 'text':
          parts.push(mark(n, { kind: 'text', x: n.x + ox, y: n.y + oy, text: env.text(n.id, n.text, vars), ...(n.style ? { style: n.style } : {}), ...(n.font ? { font: n.font } : {}), ...(n.width ? { width: n.width } : {}), ...(n.align ? { align: n.align } : {}), ...(n.color ? textColor(n.color, env, vars) : {}), ...(n.lines ? { lines: n.lines } : {}), ...(n.fit ? { fit: true } : {}) }));
          break;
        case 'slider': {
          const r = SLIDER_SETTINGS[n.setting as keyof typeof SLIDER_SETTINGS] ?? SLIDER_SETTINGS.master;
          const v = Number(vars[n.setting]);
          parts.push(mark(n, { kind: 'slider', setting: n.setting, x: n.x + ox, y: n.y + oy, w: n.w, h: n.h, readout: n.readout, ...r, value: Number.isFinite(v) ? Math.min(r.max, Math.max(r.min, v)) : r.min }));
          break;
        }
        case 'hotspot': {
          const shape = translate(n.shape, ox, oy);
          parts.push(mark(n, {
            kind: 'hotspot', id: elementId(n.id), shape, label: env.text(n.labelId, n.label, vars),
            enabled: !n.enabled || truthy(evalExpr(n.enabled, vars)), cursor: n.cursor, hover: n.hover ? env.text(null, n.hover, vars) : null, plain: n.plain, fx: n.fx, tip: n.tip, bounds: shapeBounds(shape), center: shapeCenter(shape), focus: hints(n.focus), on: n.on, act: n.act, ...local(n, vars),
          }));
          children(n, vars, ox, oy, loop, parts);
          break;
        }
        case 'button': {
          const choices = n.select ? selectOptions(n.id, vars, env) : null;
          const shown = choices?.find(o => o.value === String(vars[n.id]));
          const label = choices ? `${shown?.label ?? String(vars[`${n.id}_word`] ?? '')} ▾` : env.text(n.labelId, n.label, vars);
          const sub = n.sub ? env.text(null, n.sub, vars) : '';
          const size = buttonSize(label, n.font, sub);
          const named = n.actVar ? String(vars[n.actVar]) : null;
          const act = named !== null ? ((SHELL_ACTIONS as readonly string[]).includes(named) ? named as ShellAction : null) : n.act;
          const shape: Shape = { k: 'rect', x: n.x + ox, y: n.y + oy, w: n.w ?? size.w, h: n.h ?? size.h };
          parts.push(mark(n, {
            kind: 'button', id: elementId(n.id), shape, label,
            enabled: (!n.enabled || truthy(evalExpr(n.enabled, vars))) && (!choices || choices.length > 0), cursor: null, hover: n.hover ? env.text(null, n.hover, vars) : null, plain: n.plain, fx: n.fx, tip: false, ...(choices ? { select: { options: choices, value: String(vars[n.id]), open: String(vars.select_open ?? '') === n.id } } : {}), ...(n.style ? { style: n.style } : {}), ...(n.font ? { font: n.font } : {}), ...(n.tooltip ? { tooltip: env.text(null, n.tooltip, vars) } : {}), ...(sub ? { sub } : {}), bounds: shapeBounds(shape), center: shapeCenter(shape), focus: hints(n.focus), on: n.on, act, ...local(n, vars),
            ...(n.act === 'tab' ? { role: 'tab' as const, checked: String(vars.tab) === n.id } : {}), // an `action tab` button is lit while its tab is the shown one
          }));
          children(n, vars, ox, oy, loop, parts);
          break;
        }
        case 'each': {
          const list = vars[n.list];
          (Array.isArray(list) ? list : []).slice(0, n.limit ?? undefined).forEach((e, i) => entry(n, e, i, () => walk(n.body, entryScope(n, vars, e, i), ox + n.x + i * n.dx, oy + n.y + i * n.dy, n.as, parts)));
          break;
        }
        case 'scroll': {
          const inner: ViewPart[] = [];
          within(n, () => walk(n.body, vars, 0, 0, loop, inner));
          const index = areas++;
          const content = Math.max(0, ...inner.map(p => partBox(p).y + partBox(p).h));
          parts.push(mark(n, { kind: 'scroll', index, x: n.x + ox, y: n.y + oy, w: n.w, h: n.h, start: n.start, bar: n.bar, contentH: Math.max(content, n.h) }));
          for (const p of inner) parts.push({ ...shiftPart(p, n.x + ox, n.y + oy), area: index });
          break;
        }
        case 'panel': {
          const inner: ViewPart[] = [];
          within(n, () => walk(n.body, vars, 0, 0, loop, inner));
          const [pt, pr, pb, pl] = n.padding;
          const boxes = inner.map(partBox);
          // without a size the panel fits its children, and never gets smaller than its frame's corners
          const w = n.w ?? Math.max(n.file ? n.slice[1] + n.slice[3] : 0, pl + pr + Math.max(0, ...boxes.map(b => b.x + b.w)));
          const h = n.h ?? Math.max(n.file ? n.slice[0] + n.slice[2] : 0, pt + pb + Math.max(0, ...boxes.map(b => b.y + b.h)));
          parts.push(mark(n, { kind: 'panel', x: n.x + ox, y: n.y + oy, w, h, file: n.file ? env.text(null, n.file, vars) : null, slice: n.slice, edge: n.edge, ...(n.color ? { color: n.color } : {}) }));
          for (const p of inner) parts.push(shiftPart(p, n.x + ox + pl, n.y + oy + pt));
          break;
        }
        case 'bar': {
          const num = (e: Expr) => { const v = Number(evalExpr(e, vars)); return Number.isFinite(v) ? v : 0; };
          const min = num(n.min), max = num(n.max), value = Math.min(Math.max(num(n.value), min), Math.max(min, max));
          const fraction = max > min ? (value - min) / (max - min) : 0;
          const shown = (v: number) => String(Math.round(v * 10) / 10);
          parts.push(mark(n, {
            kind: 'bar', x: n.x + ox, y: n.y + oy, w: n.w, h: n.h, back: n.back ? env.text(null, n.back, vars) : null, fill: n.fill ? env.text(null, n.fill, vars) : null,
            slice: n.slice, edge: n.edge, padding: n.padding, color: n.color, value, min, max, fraction, readout: n.readout ? `${shown(value)} / ${shown(max)}` : null,
          }));
          break;
        }
        case 'layout':
          for (const p of layoutGroups(n, within(n, () => groupsOf(n.body, vars, loop)), env.stage ?? DEFAULT_STAGE, vars)) parts.push(shiftPart(p, ox, oy));
          break;
      }
    }
  };
  walk(def.body, scope, 0, 0, null, parts);
  parts.push(...expandSelects(parts, env.stage ?? DEFAULT_STAGE));
  return { name: def.name, parts: nameParts(parts), default: def.default, cancel: def.cancel, ...(def.hideBox ? { hideBox: true as const } : {}) };
}

