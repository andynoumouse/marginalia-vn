import type { Expr, Value } from './expr.js';
import type { TransformDef } from './transform.js';
import type { Segment } from './text.js';
import type { ScreenDef, ScreenView } from './screens.js';

declare const pcBrand: unique symbol;
declare const optionBrand: unique symbol;
/** An index into `Program.ops`. A plain number is no `Pc`; `asPc(n)` marks one. */
export type Pc = number & { readonly [pcBrand]: true };
/** The index of a menu option in the `options` the renderer was given; `options.length` is a timeout. Not a `Pc`. */
export type OptionIndex = number & { readonly [optionBrand]: true };
export const asPc = (n: number) => n as Pc;
export const asOptionIndex = (n: number) => n as OptionIndex;
/** A jump target that `compile` has not resolved yet (and a label that is missing). */
export const UNRESOLVED = -1 as Pc;

export interface Src { file: string; line: number }
/** `fix`: the line's `word` is unknown and one of `options` (closest first) is probably what was meant (a quick fix). */
export interface Diagnostic { file: string; line: number; severity: 'error' | 'warning'; message: string; fix?: { word: string; options: string[] } }
/** How a character's lines look and sound (define ... text= font= size= italic speed= blip= style=). */
export interface CharacterStyle {
  textColor?: string;
  font?: string;
  size?: number;   // text size multiplier
  italic?: boolean;
  speed?: number;  // typing speed multiplier
  blip?: string;   // sound played while the text types
  box?: string;    // text box skin (game.json theme.skins.<box>)
}
/**
 * `focus: false`: `define ... focus=off`, always lit under speaker focus (game.json "speakerFocus").
 * `side`: `define ... side=<name>`, the portrait in the text box (assets/side/<name>, game.json "sideImages").
 */
export interface CharacterDef { id: string; name: string; color: string | null; style: CharacterStyle; focus?: false; side?: string; src: Src }

/** `define item <id> "Name" [image=<file>]`: what a list entry shows as (`[bag]` in text, `item.name` / `item.image` in screens). */
export interface ItemDef { id: string; name: string; nameId: string | null; image: string | null; src: Src }

/** One entry of a menu as shown to the player. */
export interface MenuItem {
  text: string;
  /** Shown but not choosable (`if cond else "Reason"` with the condition false). */
  disabled?: boolean;
  /** The reason text of a disabled option. */
  reason?: string;
  /** The player has taken this option before (this playthrough or an earlier one). */
  seen?: boolean;
}

/** `menu ... timeout <seconds>:` with its `on timeout:` block; the block is run when the player's answer is one past the last option. */
export interface MenuTimeout {
  seconds: Expr;
  target: Pc;   // pc of the `on timeout` block
  from: number;     // source line range of the block (for live preview restore)
  to: number;
}

export interface MenuOption {
  text: string;
  id: string | null;
  cond: Expr | null;
  /** `else "Reason"`: when the condition fails the option is shown disabled with this text instead of being hidden. */
  reason: string | null;
  reasonId: string | null;
  target: Pc;   // pc of the option's block
  from: number;     // source line range of the option block (for live preview restore)
  to: number;
}

import type { AnimDef, SpriteAnim } from './anim.js';
import type { BurstName, FilterName, WeatherName } from './fx.js';

export type Transition = 'cut' | 'fade' | 'dissolve' | 'wipe' | 'iris' | 'blinds' | 'pixelate';
export const TRANSITIONS: Transition[] = ['cut', 'fade', 'dissolve', 'wipe', 'iris', 'blinds', 'pixelate'];

export type VisualBody =
  | { op: 'scene'; bg: string; transition: Transition; dir: string | null; mask: string | null; dur: number }
  | { op: 'show'; char: string; pose: string | null; more: string[]; overrides: Record<string, string>; x: number | null; fade: number; y?: number; scale?: number; flip?: boolean; anchor?: [number, number]; order?: 'front' | 'back'; behind?: string; /** `pose=a,b`: rig.json poses laid over the character's parameters */ poses?: string[] } // order/behind: where it goes in the draw order (state.sprites, back to front)
  | { op: 'hide'; char: string; fade: number }
  | { op: 'move'; char: string; x: number | null; y: number | null; scale: number | null; rotation: number | null; alpha: number | null; flip: boolean | null; anchor: [number, number] | null; tint?: string | null; dur: number; ease: string } // null = unchanged; tint: a color, null = back to none, left out = unchanged
  | { op: 'shake'; target: string; dur: number; strength: number }
  | { op: 'hop'; char: string; dur: number }
  | { op: 'animate'; char: string; name: string | null; dur: number | null; loop: boolean; strength: number; part: string | null; args?: Expr[]; def?: AnimDef; auto?: 'on' | 'off' } // name null = stop the loop; dur null = the animation's own length; part = move only that part
  | { op: 'param'; char: string; poses: string[]; params: Record<string, number>; dur: number; ease: string | null } // `animate <char> pose=... p=v ... over <t>`: poses first, then the values; ease null = each parameter's own
  | { op: 'perform'; name: string } // play a `choreography` block: every actor's part at once, ending with the longest
  | { op: 'burst'; kind: BurstName; char?: string; x?: number; y?: number; count: number | null; dur: number | null } // a puff of particles at a character, or at a point (stage fractions); not kept in the state
  | { op: 'flash'; color: string; dur: number; char?: string } // char: flash that character or picture instead of the screen
  | { op: 'tint'; color: string | null; strength: number; dur: number } // colour wash over the scene; null clears it
  | { op: 'camera'; zoom: number | null; x: number | null; y: number | null; roll?: number; dur: number; ease: string } // zoom about (x, y), both 0-1; zoom null = a pan that keeps the zoom; x/y null (a roll) keep the pivot; roll = degrees, left out keeps it
  | { op: 'weather'; kind: WeatherName | null; intensity: number; dur: number } // falling particles over the scene; null clears them
  | { op: 'filter'; name: FilterName | null; strength: number; dur: number } // screen-wide look (blur, grayscale, ...); null clears it
  | { op: 'gravity'; factor: number } // how hard weather and bursts fall: 1 as authored, 0 none, negative up
  | { op: 'wind'; strength: number; gusts: number; dur: number } // the scene's wind on physics chains: signed (positive blows right), 0 = calm; dur = seconds to reach it
  | { op: 'behaviors'; on: boolean } // rig.json `auto` animations (idle, blink, talk) on or off for the story from here
  | { op: 'focus'; on: boolean } // speaker focus (game.json "speakerFocus") on or off for the story from here
  | { op: 'image'; action: 'show'; name: string; file: string; x?: number; y?: number; scale?: number; rotation?: number; alpha?: number; anchor?: [number, number]; layer?: number; fixed?: boolean; keep?: boolean; parallax?: number; tint?: string; fade: number } // an overlay picture; fields left out stay as they are
  | { op: 'image'; action: 'hide'; name: string; fade: number }
  | { op: 'image'; action: 'move'; name: string; x: number | null; y: number | null; scale: number | null; rotation: number | null; alpha: number | null; anchor: [number, number] | null; tint?: string | null; dur: number; ease: string } // null = unchanged
  | { op: 'music'; action: 'play' | 'stop' | 'pause' | 'resume'; name: string | null; loop: boolean; fade: number }
  | { op: 'sound'; action: 'play' | 'loop' | 'stop'; name: string | null; fade: number; duck?: boolean }
  | { op: 'movie'; name: string; noskip: boolean; loop: boolean }
  | { op: 'wait'; dur: number };

export type ControlBody =
  | { op: 'say'; who: string | null; text: string; id: string | null; /** `style=<name>` on the line: a theme style for it alone */ look?: string }
  | { op: 'menu'; prompt: string | null; promptId: string | null; look?: string; options: MenuOption[]; timeout: MenuTimeout | null; /** pc after the last option block (where a menu with nothing choosable goes on) */ end: Pc }
  | { op: 'screen'; name: string; as: string; /** values for the screen's parameters, evaluated each time the screen is drawn */ args?: Expr[]; /** per parameter, the story variable an \`inout\` parameter is written back to (set by compile) */ outs?: (string | null)[] } // show a declared screen and store the id of the element the player chose
  | { op: 'input'; name: string; prompt: string; id: string | null; default: string; max: number } // ask the player for text, stored in a variable
  | { op: 'set'; name: string /* or persistent.<name> */; assign: '=' | '+=' | '-=' | '*=' | '/='; expr: Expr }
  | { op: 'jump'; label: string; target: Pc }
  | { op: 'call'; label: string; target: Pc; args?: Expr[] } // args bind to the label's parameters (Program.params) for the length of the call
  | { op: 'ret' }
  | { op: 'end' }
  | { op: 'hud'; mode: 'on' | 'off'; name: string; keep: boolean } // put a screen up beside the story (`hud on <screen>`), or take it down
  | { op: 'nvl'; mode: 'on' | 'off' | 'clear' } // full-screen narration pages instead of the text box
  | { op: 'textbox'; mode: 'hide' } // hide the text box until the next line shows it again
  | { op: 'unlock'; name: string } // persistent flag (endings, gallery, extras), read as unlocked.<name>
  | { op: 'branch'; cond: Expr; target: Pc } // jump to target when cond is false
  | { op: 'goto'; target: Pc };

export type OpBody = (VisualBody & { nowait?: boolean }) | ControlBody;
export type VisualOp = VisualBody & { nowait?: boolean; src: Src };
export type Op = VisualOp | (ControlBody & { src: Src });
/**
 * The ops that, for control flow, just go on to the next one. A switch over ops that ends in a fall-through `default`
 * checks the leftover with `op satisfies FallThroughOp`, so a new control op has to get a case there or be listed here.
 * Visual ops always qualify.
 */
export type FallThroughOp = VisualOp | Extract<Op, { op: 'say' | 'screen' | 'input' | 'set' | 'hud' | 'nvl' | 'textbox' | 'unlock' }>;

/** An asset to load ahead (key: see assets.ts) and how many lines of the story away its first use is. */
export interface PreloadTask { key: string; lines: number }
/** Preload tasks attached to a program by attachPreloads (assets.ts). */
export interface Preload {
  /** How many lines ahead the tasks reach. */
  lookahead: number;
  /** By pc of the op that starts them (program start, label entries and every line, menu and input), nearest first. */
  tasks: Record<number, PreloadTask[]>;
  /** Needed whatever the player does (blip samples, rig defaults for `show` without a pose): load last, keep. */
  always: string[];
  /** Backgrounds of the gallery (game.json); the gallery fetches them itself, they are only kept from unloading. */
  gallery: string[];
}

export interface Program {
  ops: Op[];
  labels: Record<string, Pc>;
  /** Parameter names of the labels that declare any (`label shop(item, price):`). */
  params: Record<string, string[]>;
  characters: Record<string, CharacterDef>;
  /** Items by id (`define item`), and screens by name (`screen name:` blocks). */
  items: Record<string, ItemDef>;
  screens: Record<string, ScreenDef>;
  strings: Record<string, string>; // localization id -> original text
  /** Where each localized string is written (only when there are strings): the Translations dialog's file and line. */
  stringSrc?: Record<string, Src>;
  diagnostics: Diagnostic[];
  /** The named stage positions the scripts were compiled with (built in plus game.json "positions"). */
  positions: Record<string, { x: number; y?: number }>;
  /** The named anchors the scripts were compiled with (built in plus game.json "anchors"). */
  anchors: Record<string, [number, number]>;
  /** The stage size the scripts were compiled with (game.json "stage", default 1920x1080). Layout only: never saved. */
  stage: { width: number; height: number };
  /** Set by attachPreloads once the project's files are known. */
  preload?: Preload;
  /** Each character's rig.json `poses`, set by attachPreloads so the display state can resolve `pose=`; absent: poses are ignored. */
  rigPoses?: Record<string, Record<string, Record<string, number>>>;
  /** The script's `transform` blocks by name, as keyframe animations the renderer plays like a rig's; absent: none. */
  transforms?: Record<string, AnimDef>;
  /** The transforms that are worked out when `animate` runs (parameters, script variables, `if`, `pick`), by name. */
  dynamicTransforms?: Record<string, TransformDef>;
  /** The script's `choreography` blocks by name: who plays which generated transform (in `transforms`), all of the same length; absent: none. */
  choreographies?: Record<string, { target: string; transform: string }[]>;
}

// ---- runtime-facing types ----

/**
 * A character on stage. `x` is the fraction of the stage width its feet are at; `y` offsets it down by a fraction of the
 * stage height (negative = up); `scale` grows it about its `anchor` (the feet by default); `rotation` is in degrees, clockwise; `flip` mirrors it.
 */
export interface SpriteState {
  /** `pose` is the first bare word of the `show` line (a look, or the image of a flat character); `more` are the bare words after it, applied left to right. */
  char: string; pose: string | null; more: string[]; overrides: Record<string, string>;
  x: number; y: number; scale: number; rotation: number; alpha: number; flip: boolean;
  /** A color the sprite is multiplied by (`move <char> tint=#rrggbb`); absent = none. */
  tint?: string;
  /** The point `scale`, `rotation` and `flip` turn about, as fractions of the sprite (0,0 top left); the feet by default. */
  anchor: [number, number];
  /** The looping animation running on it (`animate <char> <name> loop`), if any. */
  anim: SpriteAnim | null;
  /** Parameter values the script has set (`pose=`, `animate <char> p=v`), by parameter id; the others are at their defaults. */
  params: Record<string, number>;
  /** Automatic transforms attached with `animate <char> <name> auto`, in the order attached; absent = none. */
  autos?: string[];
}
/**
 * An overlay picture (`image show <name> <file>`): an item, a CG, a letter. `x`/`y` are stage pixels of its
 * `anchor` (fractions of the picture, 0,0 top left); `scale`, `rotation` (degrees) turn it about the anchor. `layer` below 0
 * draws behind the characters, 0 and up in front of them; `fixed` pictures ignore the camera; `keep` survives `scene`.
 */
export interface ImageState {
  name: string; file: string; x: number; y: number; scale: number; rotation: number; alpha: number;
  anchor: [number, number]; layer: number; fixed: boolean; keep: boolean;
  /** A color the picture is multiplied by (`image move <name> tint=#rrggbb`); absent = none. */
  tint?: string;
  /** How much of the camera's zoom, pan and roll the picture follows (1 = all, the default; 0 = none, like `fixed`; above 1 = nearer than the characters). Absent = 1. */
  parallax?: number;
  /** The looping animation running on it (`animate <image> <name> loop`), if any; absent = none. Only body-level presets (`part` is always null). */
  anim?: SpriteAnim | null;
  /** Automatic transforms attached with `animate <image> <name> auto`; absent = none. */
  autos?: string[];
}
/** A screen shown as a HUD (`hud on`); `keep` survives `scene`. */
export interface HudState { name: string; keep: boolean }
/** `roll` is degrees about the pivot (x, y); absent = 0. `anim` and `autos` are what `animate camera ...` runs on top of the view (see CAMERA_TARGET). */
export interface Camera { zoom: number; x: number; y: number; roll?: number; anim?: SpriteAnim | null; autos?: string[] }
/** The name `animate` (and only it) takes for the camera: a character or picture of that name would be ambiguous, which is an error. */
export const CAMERA_TARGET = 'camera';
export interface DisplayState {
  bg: string | null; sprites: SpriteState[]; music: string | null; musicLoop: boolean;
  /** Lasting effects; absent in older saves and in the title screen state (= none). */
  tint?: { color: string; strength: number } | null;
  camera?: Camera;
  weather?: { kind: WeatherName; intensity: number } | null;
  filter?: { name: FilterName; strength: number } | null;
  /** `wind`: the scene's wind on physics chains (strength signed, positive to the right); absent or null = calm. */
  wind?: { strength: number; gusts: number } | null;
  /** `gravity`: the factor on how hard weather and bursts fall; absent or null = 1. */
  gravity?: number | null;
  /** `music pause` is in effect (the track named in `music` waits); absent = playing. */
  musicPaused?: boolean;
  /** Looping sounds (`sound loop`), in the order started; absent in older saves (= none). */
  ambience?: string[];
  /** Overlay pictures in the order shown; absent in older saves (= none). */
  images?: ImageState[];
  /** Screens up as a HUD, in the order shown; absent in older saves (= none). */
  hud?: HudState[];
  /** `focus off` is in effect (speaker focus does not dim anyone); absent = on. Survives `scene`. */
  focus?: false;
  /** `behaviors off` is in effect (no automatic animation runs); absent = on. Survives `scene`. */
  behaviors?: false;
}

export interface SayEvent {
  /** Localization id of the line, if it has one (also a stable key for "already read"). */
  id: string | null;
  who: string | null;
  name: string | null;
  color: string | null;
  /** Style of the speaker, or of `define narrator` for narration. */
  style: CharacterStyle;
  /** `style=<name>` on the line itself; wins over the speaker's `define ... style=`. */
  look?: string;
  text: string;
  segments: Segment[];
  src: Src;
  /** Set in NVL mode: the line is added to a full-screen page; `page` holds the lines already on it. */
  nvl?: boolean;
  page?: SayEvent[];
}

/** Anything that can present the game: DOM, Pixi, a test double... */
export interface Renderer {
  /** The script's transforms (`animate <target> <name>` plays one when no rig animation has the name); called with the program and again when it is replaced. */
  setTransforms?(transforms: Record<string, AnimDef>): void;
  /** Replace everything on screen with `state` instantly; also clears any open textbox or menu. */
  sync(state: DisplayState): void;
  /** Load what `state` shows; the runtime waits for this before sync() so nothing is drawn as a placeholder. */
  prepare?(state: DisplayState): Promise<void>;
  /** Preload tasks that just came within reach of the story; the renderer decides what to load and when. */
  prefetch?(tasks: PreloadTask[], always: string[]): void;
  /** Animate a visual command. `state` already holds the final result. */
  apply(op: VisualOp, state: DisplayState): Promise<void>;
  /** The HUD screens as they look now (re-resolved before every line); the renderer redraws what changed. */
  hud?(views: ScreenView[]): void;
  /** The `quickmenu` screen (null: the program has none); pushed whenever the HUD is. */
  quick?(view: ScreenView | null): void;
  /** A HUD event is waiting: end the line on screen at once (the runtime shows it again afterwards). */
  interruptLine?(): void;
  /** Remove the NVL page from the screen (`nvl clear`/`off`, a new scene). */
  clearPage?(): void;
  /** Hide the text box (`textbox hide`); the next line shows it again. */
  hideBox?(): void;
  /**
   * Show a line in the text box already typed, with nothing to wait for: a restore (rollback, load, reload) that ends at a choice,
   * prompt or screen leaves the last line under it, as the first visit does. Called right after sync(), and not for NVL lines.
   */
  showLine?(ev: SayEvent): void;
  /** Show a line; resolve when the player advances. */
  say(ev: SayEvent): Promise<void>;
  /**
   * Show choices (with the menu's prompt line, if it has one); resolve with the index into `options`. A disabled option cannot be chosen.
   * With a `timer` the player has that many seconds; when they run out, resolve with `options.length` (one past the last option).
   */
  menu(options: MenuItem[], src: Src, prompt?: string, timer?: { seconds: number }, style?: string): Promise<OptionIndex>;
  /** Ask for a line of text; resolve with the answer. */
  input(prompt: string, def: string, max: number, src: Src): Promise<string>;
  /**
   * Show a screen and wait; resolve with the id of the chosen element ("" = cancelled). A screen with local `state` gets `live`: an element's
   * `on click|focus|blur set` handler (ViewItem.sets) calls `live.set(name, value)` and the screen is drawn again from the view it returns.
   */
  screen(view: ScreenView, src: Src, live?: ScreenLive): Promise<string>;
  end(): void;
}

/** What the player answered at a menu (option index), an input (text) or a screen (element id), or the HUD event taken at a safe point; replayed in order by restore(). */
export type Answer = number | string | Value[] | { hud: string; on: string }; // a HUD event is recorded where it was taken, in order with the other answers; a screen with inout parameters records [answer, ...returned values]

/** The local state of a blocking screen that is up, kept in a save (and a reload) so that restoring reopens it as the player left it: its `state`s and inout values. */
export interface ScreenSnap { at: Src; name: string; local: Vars }

/** What a renderer calls when a handler changes the local state of the screen it shows; returns the screen as it looks now. */
export interface ScreenLive { set(name: string, value: Value): ScreenView }

export type Vars = Record<string, Value>;
