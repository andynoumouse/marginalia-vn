import { arith, evalExpr, type Value } from './expr.js';
import { Locale } from './locale.js';
import { blocks, fitsInout, initialState, pickables, replayAnswer, firstTab, ACHIEVEMENT_TOAST_SCREEN, ACHIEVEMENTS_SCREEN, CHAPTERS_SCREEN, GALLERY_SCREEN, MUSIC_SCREEN, HISTORY_SCREEN, OPTIONS_SCREEN, PAUSE_SCREEN, QUICKMENU_SCREEN, resolveScreen, SAVES_SCREEN, screenParams, TITLE_SCREEN, VIEWER_SCREEN, type HudEvent, type ScreenEnv, type ScreenView } from './screens.js';
import { newSeed, randomStep, type Rng } from './random.js';
import { interpolate, parseRich } from './text.js';
import type { Answer, ScreenSnap, DisplayState, MenuOption, Op, Program, Renderer, SayEvent, Src, VisualOp, Vars } from './types.js';

export interface SaveData {
  pc: number;
  stack: number[];
  /** Saved values of the callee's parameters, one per stack entry (null: none; see Runtime.frames). */
  frames?: (Record<string, Value | null> | null)[];
  vars: Vars;
  state: DisplayState;
  choices: Answer[];
  unlocks?: string[];
  unlockedBase?: string[];
  /** Menu options taken (see Runtime.seen): the ones from before the playthrough, and its own. */
  seenBase?: string[];
  seen?: string[];
  /** Persistent data: the values when the playthrough began, and its own changes (see Runtime.persistentBase). */
  persistentBase?: Record<string, Value>;
  persistent?: Record<string, Value>;
  /** Random generator: the playthrough's seed and the current state (see Runtime.seed). */
  seed?: number;
  rng?: number;
  nvl?: boolean;
  page?: SayEvent[];
}

/** Where restore() stops: a source position, or the n-th line/choice from the start. */
export type RestoreTarget = Src | { step: number; from?: Src };

/** How many menus a restore to a source line answers by default before it gives up on reaching the line by playing. */
const RESTORE_GUESS_LIMIT = 200;

export const emptyState = (): DisplayState => ({ bg: null, sprites: [], music: null, musicLoop: false, tint: null, camera: { zoom: 1, x: 0.5, y: 0.5 }, weather: null, filter: null, images: [], hud: [] });

/** Apply a visual command to the canonical display state (also used for instant restore). */
export function applyToState(state: DisplayState, op: VisualOp): void {
  switch (op.op) {
    case 'scene':
      state.bg = op.bg;
      state.sprites = [];
      state.tint = null;
      state.camera = { zoom: 1, x: 0.5, y: 0.5 };
      state.weather = null;
      state.filter = null;
      state.images = (state.images ?? []).filter(i => i.keep);
      state.hud = (state.hud ?? []).filter(h => h.keep);
      break;
    case 'show': {
      let s = state.sprites.find(x => x.char === op.char);
      if (!s) {
        s = { char: op.char, pose: null, more: [], overrides: {}, x: 0.5, y: 0, scale: 1, rotation: 0, alpha: 1, flip: false, anchor: [0.5, 1], anim: null };
        state.sprites.push(s);
      }
      if (op.pose !== null) { s.pose = op.pose; s.more = [...op.more]; s.overrides = { ...op.overrides }; }
      else s.overrides = { ...s.overrides, ...op.overrides };
      if (op.x !== null) s.x = op.x;
      if (op.y !== undefined) s.y = op.y;
      if (op.scale !== undefined) s.scale = op.scale;
      if (op.flip !== undefined) s.flip = op.flip;
      if (op.anchor !== undefined) s.anchor = [...op.anchor];
      if (op.order || (op.behind && state.sprites.some(x => x.char === op.behind))) { // behind someone not on stage: stays where it is
        const rest = state.sprites.filter(x => x !== s);
        const at = op.order === 'back' ? 0 : op.order === 'front' ? rest.length : rest.findIndex(x => x.char === op.behind);
        state.sprites = [...rest.slice(0, at), s, ...rest.slice(at)];
      }
      break;
    }
    case 'hide':
      state.sprites = state.sprites.filter(x => x.char !== op.char);
      break;
    case 'move': {
      const s = state.sprites.find(x => x.char === op.char);
      if (!s) break;
      if (op.x !== null) s.x = op.x;
      if (op.y !== null) s.y = op.y;
      if (op.scale !== null) s.scale = op.scale;
      if (op.rotation !== null) s.rotation = op.rotation;
      if (op.alpha !== null) s.alpha = op.alpha;
      if (op.flip !== null) s.flip = op.flip;
      if (op.anchor !== null) s.anchor = [...op.anchor];
      break;
    }
    case 'animate': {
      const s = state.sprites.find(x => x.char === op.char);
      if (s && (op.loop || op.name === null)) s.anim = op.name === null ? null : { name: op.name, dur: op.dur, strength: op.strength, part: op.part };
      break;
    }
    case 'image': {
      const images = state.images ??= [];
      if (op.action === 'hide') { state.images = images.filter(i => i.name !== op.name); break; }
      let img = images.find(i => i.name === op.name);
      if (op.action === 'show') {
        if (!img) {
          img = { name: op.name, file: op.file, x: 0, y: 0, scale: 1, rotation: 0, alpha: 1, anchor: [0, 0], layer: 0, fixed: false, keep: false };
          images.push(img);
        }
        img.file = op.file;
        if (op.x !== undefined) img.x = op.x;
        if (op.y !== undefined) img.y = op.y;
        if (op.scale !== undefined) img.scale = op.scale;
        if (op.rotation !== undefined) img.rotation = op.rotation;
        if (op.alpha !== undefined) img.alpha = op.alpha;
        if (op.anchor !== undefined) img.anchor = [...op.anchor];
        if (op.layer !== undefined) img.layer = op.layer;
        if (op.fixed !== undefined) img.fixed = op.fixed;
        if (op.keep !== undefined) img.keep = op.keep;
      } else if (img) {
        if (op.x !== null) img.x = op.x;
        if (op.y !== null) img.y = op.y;
        if (op.scale !== null) img.scale = op.scale;
        if (op.rotation !== null) img.rotation = op.rotation;
        if (op.alpha !== null) img.alpha = op.alpha;
        if (op.anchor !== null) img.anchor = [...op.anchor];
      }
      break;
    }
    case 'music':
      if (op.action === 'pause') { if (state.music) state.musicPaused = true; break; }
      if (op.action === 'resume') { delete state.musicPaused; break; }
      state.music = op.action === 'play' ? op.name : null;
      state.musicLoop = op.action === 'play' && op.loop;
      delete state.musicPaused;
      break;
    case 'sound':
      if (op.action === 'loop' && op.name) { if (!(state.ambience ?? []).includes(op.name)) state.ambience = [...(state.ambience ?? []), op.name]; }
      else if (op.action === 'stop') {
        const left = op.name ? (state.ambience ?? []).filter(n => n !== op.name) : [];
        if (left.length) state.ambience = left; else delete state.ambience;
      }
      break;
    case 'tint':
      state.tint = op.color ? { color: op.color, strength: op.strength } : null;
      break;
    case 'camera':
      state.camera = { zoom: op.zoom ?? state.camera?.zoom ?? 1, x: op.x, y: op.y };
      break;
    case 'weather':
      state.weather = op.kind ? { kind: op.kind, intensity: op.intensity } : null;
      break;
    case 'filter':
      state.filter = op.name ? { name: op.name, strength: op.strength } : null;
      break;
    case 'focus':
      if (op.on) delete state.focus; else state.focus = false;
      break;
    // flash, shake, hop, one-shot animate, sound play, movie, wait leave no lasting state
  }
}

/**
 * Deterministic state machine: state is (pc, call stack, variables, display state).
 * Everything the player sees can be rebuilt by replaying from the start in "instant" mode,
 * which is what makes hot reload (restore to a source line) cheap.
 */
export class Runtime {
  vars: Vars = {};
  pc = 0;
  stack: number[] = [];
  /**
   * Parallel to the stack: what a `call label(args)` shadowed. The parameters live in `vars` while the call runs; the
   * entry holds the caller's value of each (null: it had none), and `return` puts them back.
   */
  frames: (Record<string, Value | null> | null)[] = [];
  state: DisplayState = emptyState();
  /** Answers given so far, in order (menu option indexes and input texts). */
  choices: Answer[] = [];
  /** Source position of the op that ran last (what the preview should return to after a reload). */
  current: Src | null = null;
  /** Index of the line or choice on screen, counted from the start (-1 before the first); see restore(). */
  step = -1;
  /**
   * Persistent flags (`unlock x`, read as `unlocked.x`). A playthrough reads the flags as they were when it
   * began (`unlockedBase`, set by the caller before start/restore and kept in saves) plus its own unlocks, so
   * replaying it always takes the same branches. `onUnlock` stores new flags for good right away.
   */
  unlockedBase: string[] = [];
  unlocks: string[] = [];
  /**
   * Menu options already taken, by key (the option's localization id, else `file:line`), same rule as the flags: `seenBase` is what
   * earlier playthroughs took (set by the caller before start/restore, kept in saves), `seen` is this playthrough's own, rebuilt by
   * replay so rollback and load agree. The renderer gets `seen` on each menu item; `onSeen` stores a newly taken option for good.
   */
  seenBase: string[] = [];
  seen: string[] = [];
  onSeen: (key: string) => void = () => {};
  /**
   * Persistent data of any basic type (`set persistent.x = ...`, read as `persistent.x`), same rule as the flags: a
   * playthrough reads the values as they were when it began (`persistentBase`) plus its own changes (`persistent`);
   * `onPersist` stores each changed value for good. Unset names read as 0.
   */
  persistentBase: Record<string, Value> = {};
  persistent: Record<string, Value> = {};
  onPersist: (name: string, value: Value) => void = () => {};
  /**
   * Randomness (`random()`, `pick()`, `chance()`): a seeded generator whose state is part of the runtime state.
   * `seed` is chosen when a playthrough starts and kept in saves; every reset rewinds `rng` to it, so replaying
   * to a line (restore, rollback, hot reload) draws the same numbers as the first time. Set `seed` before
   * restore() to replay a stored playthrough; `seedSource` makes the seed of a new one.
   */
  seed = newSeed();
  rng = this.seed;
  seedSource: () => number = newSeed;
  private readonly draw: Rng = { next: () => { const r = randomStep(this.rng); this.rng = r.state; return r.value; } };
  /** NVL mode (`nvl on`): lines collect on a full-screen page. `page` holds the lines on it so far. */
  nvl = false;
  page: SayEvent[] = [];
  onUnlock: (name: string) => void = () => {};
  /** The story entered a label (jump, call or falling through), but not while a restore is replaying (chapters unlock from it). */
  onLabel: (name: string) => void = () => {};
  /**
   * The story stopped on an error (a bad expression, a failing renderer call): the error and the line it was on (`current`).
   * The run is stopped first. Unset, the error rejects the promise of start/restore/load like any other.
   */
  onError: ((error: unknown, at: Src | null) => void) | null = null;
  private labelNames: Map<number, string[]> | null = null;
  /**
   * HUD events (`hud on <screen>`, elements with `on click <label>`): the shell reports a choice with hudEvent(); it waits in
   * `queued` until the story is at a safe point (before a line, menu, input or screen), where the label is called and
   * recorded in `choices`. `pending` is what the runtime is waiting on right now; events during a menu, input or
   * screen are dropped (the HUD is not interactive then), and while an event's label runs (its return address on
   * the stack is stored negative) further events are ignored.
   */
  private queued: { hud: string; on: string }[] = [];
  private pending: 'line' | 'modal' | null = null;
  private lineInterrupted = false;

  private gen = 0;
  private instant = false;
  private target: RestoreTarget | null = null;
  private replay: Answer[] = [];
  /** The blocking screen waiting for the player: its op and its local variables (parameters, `state`s), which `live.set` changes. */
  private open: { op: Extract<Op, { op: 'screen' }>; local: Vars } | null = null;
  /** Local state a restore() hands back to the screen it reopens (see screenSnapshot); used once, by the first live showing of that screen. */
  private resume: ScreenSnap | null = null;
  /** Set while a restore() to a source line the story never reaches is rerun to enter that label body directly. */
  private forced = false;
  private triedForce = false;
  /**
   * A forced rerun first enters at the start of the label around the line and replays up to it (so the label's earlier
   * lines set up the scene); `forceLabel` is set while that runs, with `budget` ops left before it gives up and `forceOp`
   * the op it must get to. If the label never gets there, a second rerun enters at the line itself (`forceDirect`, also
   * used by step restores).
   */
  private forceLabel = false;
  private forceDirect = false;
  private forceOp = -1;
  private budget = 0;
  /** Menus a restore() answered with its default (nothing recorded): a story that loops through menus never ends this way. */
  private guessed = 0;
  /** True when the last restore() had to jump straight to its line (the story does not get there on its own). */
  jumped = false;
  /** The source position the last restore() entered directly (steps count from there: pass it as `from` to restore a step). */
  jumpedFrom: Src | null = null;
  private forceAt: Src | null = null;
  /** Set during playLabel(): the label the entry jump goes to instead of `start`, and whether the run reached its end. */
  private entry: number | null = null;
  private cutscene = false;
  private cutsceneDone = false;

  constructor(public program: Program, private renderer: Renderer, public locale: Locale = new Locale()) {}

  setProgram(program: Program, locale?: Locale) {
    this.program = program;
    this.labelNames = null;
    if (locale) this.locale = locale;
  }

  /** Start a new NVL page (the renderer drops the old one unless we are replaying). */
  private clearPage() {
    this.page = [];
    if (!this.instant) this.renderer.clearPage?.();
  }

  private reset() {
    this.nvl = false;
    this.page = [];
    this.vars = {};
    this.pc = 0;
    this.stack = [];
    this.frames = [];
    this.state = emptyState();
    this.choices = [];
    this.current = null;
    this.step = -1;
    this.unlocks = [];
    this.seen = [];
    this.persistent = {};
    this.rng = this.seed;
    this.entry = null;
    this.cutscene = false;
    this.queued = [];
    this.pending = null;
    this.lineInterrupted = false;
  }

  /** A `call`: push the return address and bind the arguments (evaluated in the caller's scope) to the label's parameters. */
  private enter(op: Extract<Op, { op: 'call' }>) {
    const names = this.program.params?.[op.label];
    let frame: Record<string, Value | null> | null = null;
    if (names?.length) {
      const scope = this.scope();
      const values = names.map((_, i) => (op.args?.[i] ? evalExpr(op.args[i], scope, this.draw) : 0));
      frame = {};
      names.forEach((n, i) => { frame![n] = n in this.vars ? this.vars[n] : null; this.vars[n] = values[i]; });
    }
    this.frames.push(frame);
    this.stack.push(this.pc);
  }

  /** A `return`: give the caller its own values of the parameters back. */
  private leave(frame: Record<string, Value | null> | null | undefined) {
    if (!frame) return;
    for (const [n, v] of Object.entries(frame)) { if (v === null) delete this.vars[n]; else this.vars[n] = v; }
  }

  /** Variables plus unlocked.<flag> and persistent.<name> for expressions. */
  private scope(): Vars {
    const s: Vars = { ...this.vars };
    for (const [k, v] of Object.entries(this.persistentBase)) s[`persistent.${k}`] = v;
    for (const [k, v] of Object.entries(this.persistent)) s[`persistent.${k}`] = v;
    for (const f of this.unlockedBase) s[`unlocked.${f}`] = true;
    for (const f of this.unlocks) s[`unlocked.${f}`] = true;
    return s;
  }

  stop() { this.gen++; }

  start(): Promise<void> {
    this.stop();
    this.seed = this.seedSource();
    this.reset();
    this.instant = false;
    this.target = null;
    this.syncRenderer();
    this.hint(0);
    return this.run();
  }

  /** Start a new playthrough at `label` instead of `start` (chapter select): the top-level setup runs first. False for an unknown label. */
  startAt(label: string): Promise<boolean> {
    const pc = this.program.labels[label];
    if (pc === undefined) return Promise.resolve(false);
    this.stop();
    this.seed = this.seedSource();
    this.reset();
    this.instant = false;
    this.target = null;
    this.entry = pc;
    this.syncRenderer();
    this.hint(0);
    return this.run().then(() => true);
  }

  /**
   * Play a label as a cutscene (the title-screen intro): the top-level setup runs, then the story enters at `label`
   * instead of `start`. Finishing (`end`, or `return` with nothing to return to) does not call renderer.end(), so the
   * shell can carry on. True when it finished; false when the label is unknown or the run was stopped or replaced.
   */
  async playLabel(label: string): Promise<boolean> {
    const pc = this.program.labels[label];
    if (pc === undefined) return false;
    this.stop();
    this.seed = this.seedSource();
    this.reset();
    this.instant = false;
    this.target = null;
    this.entry = pc;
    this.cutscene = true;
    this.cutsceneDone = false;
    this.syncRenderer();
    this.hint(0);
    await this.run();
    return this.cutsceneDone;
  }

  /**
   * Rebuild state up to `target`, then continue live from there. Menus and inputs on the way take `choices` in order
   * (default: the ones made so far).
   *  - a source position stops at the first op at or after it: `{ current, choices }` is a save that
   *    survives script edits;
   *  - `{ step }` stops at exactly that line or choice (rollback within one version of the script).
   */
  restore(target: RestoreTarget, choices: Answer[] = this.choices, screen?: ScreenSnap | null): Promise<void> {
    const replay = [...choices];
    this.stop();
    this.reset();
    this.resume = screen ?? null;
    this.instant = true;
    this.target = target;
    this.replay = replay;
    this.forced = this.triedForce = false;
    this.forceAt = null;
    this.forceLabel = this.forceDirect = false;
    if ('step' in target && target.from) { this.forced = this.triedForce = this.forceDirect = true; this.forceAt = target.from; }
    this.guessed = 0;
    this.jumped = false;
    this.jumpedFrom = null;
    this.syncRenderer();
    return this.run();
  }

  /** The blocking screen that is up, with the local state it has now (null when none): a save keeps it, and restore() can hand it back. */
  screenSnapshot(): ScreenSnap | null {
    const o = this.open;
    if (!o) return null;
    const def = this.program.screens[o.op.name];
    const keep = [...(def?.inout ?? []), ...(def?.states ?? []).map(d => d.name)];
    return { at: o.op.src, name: o.op.name, local: Object.fromEntries(keep.map(k => [k, o.local[k]])) };
  }

  save(): SaveData {
    return JSON.parse(JSON.stringify({
      pc: this.pc, stack: this.stack, frames: this.frames, vars: this.vars, state: this.state, choices: this.choices,
      unlocks: this.unlocks, unlockedBase: this.unlockedBase, seenBase: this.seenBase, seen: this.seen, persistentBase: this.persistentBase, persistent: this.persistent,
      seed: this.seed, rng: this.rng, nvl: this.nvl, page: this.page,
    }));
  }

  async load(data: SaveData): Promise<void> {
    this.stop();
    const gen = this.gen;
    this.pc = data.pc;
    this.stack = [...data.stack];
    this.frames = data.stack.map((_, i) => data.frames?.[i] ?? null);
    this.vars = { ...data.vars };
    this.state = JSON.parse(JSON.stringify(data.state));
    this.choices = [...data.choices];
    this.unlocks = [...(data.unlocks ?? [])];
    if (data.unlockedBase) this.unlockedBase = [...data.unlockedBase];
    if (data.seenBase) this.seenBase = [...data.seenBase];
    this.seen = [...(data.seen ?? [])];
    if (data.persistentBase) this.persistentBase = { ...data.persistentBase };
    this.persistent = { ...data.persistent };
    if (data.seed !== undefined) this.seed = data.seed;
    this.rng = data.rng ?? this.seed;
    this.nvl = data.nvl ?? false;
    this.page = data.page ?? [];
    this.instant = false;
    this.target = null;
    this.entry = null;
    this.cutscene = false;
    if (this.renderer.prepare) { await this.renderer.prepare(this.state); if (gen !== this.gen) return; }
    this.syncRenderer();
    this.hintNear(this.pc);
    return this.run();
  }

  /** Start preloading from the beginning of the story (behind the title screen), so the first scene is ready by the time it is needed. */
  warm() { this.hint(0); }

  /** Ask the renderer to load the preload tasks attached to the op at `pc`, if it has any. */
  private hint(pc: number) {
    const pre = this.program.preload, tasks = pre?.tasks[pc];
    if (pre && tasks) this.renderer.prefetch?.(tasks, pre.always);
  }
  /** Like hint(), for a position between anchors (after a load or restore): the next op that has tasks. */
  private hintNear(pc: number) {
    const tasks = this.program.preload?.tasks;
    for (let i = pc; tasks && i < Math.min(pc + 24, this.program.ops.length); i++) if (tasks[i]) { this.hint(i); return; }
  }

  /** Load what the final state shows before drawing it, so that no placeholder appears; false if superseded meanwhile. */
  private async finishInstant(gen: number): Promise<boolean> {
    if (!this.instant) return true;
    this.instant = false;
    this.target = null;
    if (this.renderer.prepare) { await this.renderer.prepare(this.state); if (gen !== this.gen) return false; }
    this.syncRenderer();
    this.hintNear(this.pc);
    return true;
  }

  private reached(op: Op): boolean {
    const t = this.target;
    if (!t) return false;
    if ('step' in t) {
      const stops = op.op === 'say' || op.op === 'input' || (op.op === 'menu' && this.visibleOptions(op).length > 0)
        || (op.op === 'screen' && blocks(this.screenView(op)));
      return stops && this.step + 1 >= t.step;
    }
    return op.src.file === t.file && op.src.line >= t.line;
  }

  /** Text with [variables] filled in; lists show the display names of their items. */
  private fmt(text: string): string {
    const names: Record<string, string> = {};
    for (const it of Object.values(this.program.items ?? {})) names[it.id] = this.locale.t(it.nameId, it.name);
    return interpolate(text, this.scope(), names, this.locale.lang);
  }

  /** What the screen of a `show screen` op looks like with the variables as they are now. */
  private screenView(op: Extract<Op, { op: 'screen' }>, local = this.screenLocal(op)): ScreenView {
    return this.viewOf(op.name, local);
  }

  /** The variables a `show screen` adds to the story's: its parameters and its `state`s at their initial values (the screen's own, gone when it closes). */
  private screenLocal(op: Extract<Op, { op: 'screen' }>): Vars {
    const def = this.program.screens[op.name];
    const params = screenParams(def, op.args, this.scope());
    return { ...params, ...initialState(def, { ...this.scope(), ...params }) };
  }

  private viewOf(name: string, extra: Vars = {}, entries?: ScreenEnv['entries']): ScreenView {
    const def = this.program.screens[name];
    if (!def) return { name, parts: [], default: null, cancel: false };
    const names: Record<string, string> = {};
    const items: Record<string, { name: string; image: string | null }> = {};
    for (const it of Object.values(this.program.items ?? {})) {
      names[it.id] = this.locale.t(it.nameId, it.name);
      items[it.id] = { name: names[it.id], image: it.image };
    }
    const stock = def.src.file.startsWith('stock/'); // a starter the shell draws for a screen the project does not declare
    return resolveScreen(def, { ...this.scope(), ...extra }, { items, entries, stage: this.program.stage, text: (id, raw, vars) => interpolate(stock && !id ? this.uiText(raw) : this.locale.t(id, raw), vars, names, this.locale.lang) });
  }

  /** What the shell tells the quick menu: the buttons to show (action name and label, in order) and where the bar goes (an anchor place, see `quickMenuSettings`). */
  quickMenu: { items: { id: string; label: string; /** the key that does the same, shown as a tooltip */ hint?: string }[]; place: string } = { items: [], place: 'bottom' };

  /** The `quickmenu` screen (the project's, else the starter) as it looks now, or null with no such screen. */
  quickView(): ScreenView | null {
    if (!(QUICKMENU_SCREEN in this.program.screens)) return null;
    const { items, place } = this.quickMenu;
    return this.viewOf(QUICKMENU_SCREEN, { quick_items: items.map(i => i.id), quick_place: place }, { quick_items: Object.fromEntries(items.map(i => [i.id, { label: i.label, hint: i.hint ?? '' }])) });
  }

  /** The translation of a built-in label ("New game") in the starter screens; the shell sets it from the `ui.<key>` entries of the locale. */
  uiText: (raw: string) => string = raw => raw;

  /**
   * The `screen title` as it looks now (the project's, else the starter), or null with no such screen. Without `canContinue` the `action continue` elements are
   * disabled; the other flags are the screen's variables of the same names (`has_gallery`...), and the buttons for what is missing are disabled on a project's screen.
   */
  titleView(canContinue: boolean, hasGallery = true, hasMusic = true, hasChapters = true, hasAchievements = true, gameTitle = '', showTitle = true, continueText = ''): ScreenView | null {
    if (!(TITLE_SCREEN in this.program.screens)) return null;
    const view = this.viewOf(TITLE_SCREEN, { game_title: gameTitle, show_title: showTitle, can_continue: canContinue, continue_text: canContinue ? continueText : '', has_gallery: hasGallery, has_music: hasMusic, has_chapters: hasChapters, has_achievements: hasAchievements });
    const off = (act: string | null) => (act === 'continue' && !canContinue) || (act === 'gallery' && !hasGallery) || (act === 'music' && !hasMusic) || (act === 'chapters' && !hasChapters)
      || (act === 'achievements' && !hasAchievements);
    return { ...view, parts: view.parts.map(p => ('act' in p && off(p.act) ? { ...p, enabled: false } : p)) };
  }

  /** The `screen pause` as it looks now (the project's, else the starter), or null with no such screen. */
  pauseView(): ScreenView | null {
    return PAUSE_SCREEN in this.program.screens ? this.viewOf(PAUSE_SCREEN) : null;
  }

  /**
   * The project's `screen options` as it looks now, or null with no such screen (the default is drawn in its place). `values` are the
   * player's settings as variables of the screen (the sliders' numbers, the words of the cycle settings, `tab`); an empty `tab` is the first tab.
   */
  optionsView(values: Vars, entries?: NonNullable<ScreenEnv['entries']>): ScreenView | null {
    const def = this.program.screens[OPTIONS_SCREEN];
    if (!def) return null;
    return this.viewOf(OPTIONS_SCREEN, { ...values, tab: values.tab || firstTab(def) }, entries);
  }

  /**
   * The project's `screen saves` as it looks now, or null with no such screen (the default is drawn in its place). `values` are
   * `mode`, `page`, `pages` (list), `slots` (list) and `deleting`; `entries` carry the data of each page and slot (`slot.title`, `slot.when`, `slot.text`, `slot.empty`, `pg.name`).
   */
  savesView(values: Vars, entries: NonNullable<ScreenEnv['entries']>): ScreenView | null {
    return SAVES_SCREEN in this.program.screens ? this.viewOf(SAVES_SCREEN, values, entries) : null;
  }

  /**
   * The `screen history` as it looks now (the project's, else the starter). `values` are `lines` (list of line
   * ids, oldest first) and `total`; `entries` carry each line (`ln.name` the speaker, `ln.color` its colour, `ln.text`).
   */
  historyView(values: Vars, entries: NonNullable<ScreenEnv['entries']>): ScreenView | null {
    return HISTORY_SCREEN in this.program.screens ? this.viewOf(HISTORY_SCREEN, values, entries) : null;
  }

  /**
   * The project's `screen gallery` as it looks now, or null with no such screen (the default is drawn in its place). `values` are `tiles` (list of
   * tile ids), `count` (unlocked) and `total`; `entries` carry each tile (`t.title`, `t.unlocked`, `t.file`, the picture's asset file, '' without one).
   */
  galleryView(values: Vars, entries: NonNullable<ScreenEnv['entries']>): ScreenView | null {
    return GALLERY_SCREEN in this.program.screens ? this.viewOf(GALLERY_SCREEN, values, entries) : null;
  }

  /**
   * The `screen viewer` as it looks now (the project's, else the starter), or null with no such screen. `values` are `file` (the
   * picture's asset file, '' without one), `title`, `position` (1-based) and `total`.
   */
  viewerView(values: Vars): ScreenView | null {
    return VIEWER_SCREEN in this.program.screens ? this.viewOf(VIEWER_SCREEN, values) : null;
  }

  /**
   * The project's `screen music` as it looks now, or null with no such screen (the default is drawn in its place). `values` are `tracks` (list of
   * track ids), `count` (unlocked), `total` and `now` (the title of the track playing, '' for none); `entries` carry each track (`t.title`, `t.unlocked`, `t.playing`).
   */
  musicView(values: Vars, entries: NonNullable<ScreenEnv['entries']>): ScreenView | null {
    return MUSIC_SCREEN in this.program.screens ? this.viewOf(MUSIC_SCREEN, values, entries) : null;
  }

  /**
   * The project's `screen chapters` as it looks now, or null with no such screen (the default is drawn in its place). `values` are `chapters`
   * (list of chapter ids), `count` (unlocked) and `total`; `entries` carry each chapter (`c.title`, `c.unlocked`).
   */
  chaptersView(values: Vars, entries: NonNullable<ScreenEnv['entries']>): ScreenView | null {
    return CHAPTERS_SCREEN in this.program.screens ? this.viewOf(CHAPTERS_SCREEN, values, entries) : null;
  }

  /**
   * The project's `screen achievements` as it looks now, or null with no such screen (the default is drawn in its place). `values` are `achievements`
   * and `endings` (lists of ids), `count` / `total` (achievements unlocked / all) and `endings_count` / `endings_total`; `entries` carry each one under
   * its list (`a.title`, `a.description`, `a.icon` the image's asset file or '', `a.unlocked`, `a.hidden`, `a.ending`).
   */
  achievementsView(values: Vars, entries: NonNullable<ScreenEnv['entries']>): ScreenView | null {
    return ACHIEVEMENTS_SCREEN in this.program.screens ? this.viewOf(ACHIEVEMENTS_SCREEN, values, entries) : null;
  }

  /**
   * The `achievement_toast` screen (the project's, else the starter) showing one unlock, or null with no such screen. `values` are
   * `title`, `description`, `icon` (the image's asset file or ''), `ending` and `position` (an anchor place).
   */
  achievementToastView(values: Vars): ScreenView | null {
    return ACHIEVEMENT_TOAST_SCREEN in this.program.screens ? this.viewOf(ACHIEVEMENT_TOAST_SCREEN, values) : null;
  }

  /** The HUD screens as they look now. */
  private hudViews(): ScreenView[] {
    return (this.state.hud ?? []).map(h => this.viewOf(h.name));
  }

  /** Replace what the renderer shows with the current state, HUD included. */
  private syncRenderer() {
    this.renderer.sync(this.state);
    this.pushHud();
  }

  /** Push the HUD screens and the quick menu screen to the renderer. */
  private pushHud() {
    this.renderer.hud?.(this.hudViews());
    this.renderer.quick?.(this.quickView());
  }

  /** The label an event of a HUD element calls, or null. */
  private hudHandler(id: string, on: string): string | null {
    for (const v of this.hudViews()) {
      const it = pickables(v).find(p => p.id === id);
      const label = it?.on[on as HudEvent];
      if (label !== undefined && label in this.program.labels) return label;
    }
    return null;
  }

  /**
   * A HUD element was chosen (`click`) or gained or lost focus (`focus`, `blur`). It is taken at the next safe point; a line on
   * screen ends at once and comes back after the label returns. False when it is dropped: no handler, a menu, input
   * or screen is open, a replay is running, or another event's label is still running.
   */
  hudEvent(id: string, on: string = 'click'): boolean {
    if (this.instant || this.pending === 'modal' || this.stack.some(v => v < 0)) return false;
    const label = this.hudHandler(id, on);
    if (label !== null && this.isQuiet(label)) { // nothing to show: run it now, the line on screen stays as it is
      this.runQuiet(label);
      this.choices.push({ hud: id, on });
      this.pushHud();
      return true;
    }
    if (this.queued.length >= 4 || !this.hudHandler(id, on)) return false; // focus moves queue as a blur plus a focus
    if (on === 'click' && this.queued.some(q => q.on === 'click')) return false;
    this.queued.push({ hud: id, on });
    if (this.pending === 'line') { this.lineInterrupted = true; this.renderer.interruptLine?.(); }
    return true;
  }

  /** At a safe point: call the label of the event that is queued (or, in a replay, recorded next). True when it was taken. */
  private takeHudEvent(): boolean {
    let ev: { hud: string; on: string } | undefined;
    if (this.instant) {
      const next = this.replay[0];
      if (typeof next === 'object' && next !== null && !Array.isArray(next)) ev = this.replay.shift() as { hud: string; on: string };
    } else ev = this.queued.shift();
    if (!ev) return false;
    const label = this.hudHandler(ev.hud, ev.on);
    if (label === null) return false; // the script changed since it was recorded
    this.choices.push(ev);
    this.frames.push(null);
    this.stack.push(-this.pc - 1); // negative: marks a HUD event's call (see hudEvent)
    this.pc = this.program.labels[label];
    return true;
  }

  /** Writes a story variable (or a `persistent.` one, stored for good right away). */
  private assign(name: string, v: Value) {
    if (name.startsWith('persistent.')) {
      const key = name.slice('persistent.'.length);
      this.persistent[key] = v;
      this.onPersist(key, v);
    } else this.vars[name] = v;
  }

  /** The ops that change state and show nothing (the only ones a quiet HUD handler may hold). */
  private applyQuiet(op: Extract<Op, { op: 'set' | 'unlock' | 'hud' }>) {
    switch (op.op) {
      case 'set': {
        const scope = this.scope();
        const v = evalExpr(op.expr, scope, this.draw);
        const cur = (scope[op.name] ?? 0) as Value;
        let next: Value = v;
        if (op.assign !== '=') next = arith(op.assign[0], cur, v);
        this.assign(op.name, next); // also during replay: the value is recomputed from the same start, so storing a persistent one again is harmless
        break;
      }
      case 'unlock':
        if (!this.unlocks.includes(op.name)) this.unlocks.push(op.name);
        this.onUnlock(op.name); // also during replay: storing a flag again is harmless
        break;
      case 'hud': {
        const list = (this.state.hud ??= []).filter(h => h.name !== op.name);
        this.state.hud = op.mode === 'on' ? [...list, { name: op.name, keep: op.keep }] : list;
        if (!this.instant) this.pushHud();
        break;
      }
    }
  }

  /**
   * Whether the label only changes state: every path from it reaches `return` through set, unlock, hud, if and goto ops,
   * with no line, menu, effect, jump or call. Such a handler runs on the spot, without ending the line on screen.
   */
  private isQuiet(label: string): boolean {
    const { ops, labels } = this.program;
    const seen = new Set<number>();
    const todo = [labels[label]];
    while (todo.length) {
      const pc = todo.pop()!;
      if (seen.has(pc)) continue;
      seen.add(pc);
      const op = ops[pc];
      if (!op) return false;
      if (op.op === 'ret') continue;
      if (op.op === 'set' || op.op === 'unlock' || op.op === 'hud') todo.push(pc + 1);
      else if (op.op === 'branch') todo.push(pc + 1, op.target);
      else if (op.op === 'goto') todo.push(op.target);
      else return false;
    }
    return true;
  }

  /** Run a quiet label to its `return` now. A loop that does not end is cut off after a thousand ops. */
  private runQuiet(label: string) {
    const { ops, labels } = this.program;
    let pc = labels[label];
    for (let n = 0; n < 1000; n++) {
      const op = ops[pc++];
      if (op.op === 'ret') return;
      if (op.op === 'branch') { if (!evalExpr(op.cond, this.scope(), this.draw)) pc = op.target; }
      else if (op.op === 'goto') pc = op.target;
      else this.applyQuiet(op as Extract<Op, { op: 'set' | 'unlock' | 'hud' }>);
    }
  }

  private isSeen(key: string) { return this.seen.includes(key) || this.seenBase.includes(key); }

  /** The options a menu can take right now (condition true or none). */
  private visibleOptions(op: Extract<Op, { op: 'menu' }>) {
    return op.options.filter(o => !o.cond || Boolean(evalExpr(o.cond, this.scope())));
  }

  private optionKey(op: Extract<Op, { op: 'menu' }>, o: MenuOption) { return o.id ?? `${op.src.file}:${o.from}`; }

  /** What the player sees: the choosable options, plus the failed ones that have an `else "Reason"` (disabled), in script order. */
  private shownOptions(op: Extract<Op, { op: 'menu' }>) {
    const scope = this.scope();
    const out: { o: MenuOption; disabled: boolean }[] = [];
    for (const o of op.options) {
      if (!o.cond || Boolean(evalExpr(o.cond, scope))) out.push({ o, disabled: false });
      else if (o.reason !== null) out.push({ o, disabled: true });
    }
    return out;
  }

  private async run(): Promise<void> {
    const gen = this.gen + 1; // the one loop() takes
    try {
      await this.loop();
    } catch (e) {
      if (!this.onError) throw e;
      if (gen !== this.gen) return; // a newer run replaced this one meanwhile
      this.stop();
      this.onError(e, this.current);
    }
  }

  private async loop(): Promise<void> {
    const gen = ++this.gen;
    const { ops } = this.program;

    while (gen === this.gen) {
      if (this.forceLabel && this.instant && --this.budget < 0) this.pc = ops.length; // the label goes round in circles
      if (this.pc < 0 || this.pc >= ops.length) {
        const t = this.target;
        if (this.instant && t && 'file' in t && (!this.triedForce || this.forceLabel) && ops.some(o => o.src.file === t.file && o.src.line >= t.line && o.src.line > 0)) {
          // The story never gets to that line: rerun the setup, then enter the label around it (or, when that failed too, the line itself).
          this.forceDirect = this.forceLabel;
          this.forceLabel = false;
          this.reset();
          this.replay = [];
          this.guessed = 0;
          this.forced = this.triedForce = true;
          this.forceAt = t;
          this.syncRenderer();
          continue;
        }
        if (this.cutscene) { this.cutscene = false; this.cutsceneDone = true; return; }
        if (!await this.finishInstant(gen)) return;
        this.renderer.end();
        return;
      }
      const op = ops[this.pc];
      // Replaying a label went past the line without running it (an `if` around it was false): enter the line itself.
      if (this.forceLabel && this.instant && this.pc !== this.forceOp && this.reached(op)) { this.pc = ops.length; continue; }
      const stops =op.op === 'say' || op.op === 'input' || (op.op === 'menu' && this.visibleOptions(op).length > 0)
        || (op.op === 'screen' && blocks(this.screenView(op)));
      if (stops) { // a safe point: HUD events are taken here, before the line or choice is shown
        if (this.takeHudEvent()) continue;
        if (!this.instant) this.pushHud();
      }
      if (this.instant && this.reached(op) && !await this.finishInstant(gen)) return;
      if (!this.instant) {
        this.hint(this.pc);
        if (!this.labelNames) {
          this.labelNames = new Map();
          for (const [n, p] of Object.entries(this.program.labels)) this.labelNames.set(p, [...(this.labelNames.get(p) ?? []), n]);
        }
        for (const name of this.labelNames.get(this.pc) ?? []) this.onLabel(name);
      }
      this.current = op.src;
      this.pc++;

      switch (op.op) {
        case 'say': {
          this.step++;
          if (this.instant && !this.nvl) break;
          const def = this.program.characters[op.who ?? 'narrator'];
          const text = this.fmt(this.locale.t(op.id, op.text));
          const ev: SayEvent = {
            who: op.who,
            name: op.who ? def?.name ?? op.who : null,
            color: def?.color ?? null,
            style: def?.style ?? {},
            ...(op.look ? { look: op.look } : {}),
            text,
            segments: parseRich(text),
            src: op.src,
            id: op.id,
          };
          if (this.nvl) { // the page grows line by line; the shown line gets the ones before it
            ev.nvl = true;
            ev.page = this.page;
            this.page = [...this.page, { ...ev, page: undefined }];
          }
          if (this.instant) break;
          const pageBefore = ev.page;
          this.pending = 'line';
          this.lineInterrupted = false;
          await this.renderer.say(ev);
          this.pending = null;
          if (gen !== this.gen) return;
          if (this.lineInterrupted) { // a HUD event ended the line: undo it, the event is taken first and the line comes back after it
            this.lineInterrupted = false;
            this.step--;
            this.pc--;
            if (this.nvl) this.page = pageBefore ?? [];
          }
          break;
        }
        case 'menu': {
          const shown = this.shownOptions(op);
          if (shown.every(s => s.disabled)) { this.pc = op.end; break; } // nothing to choose: skipped, records nothing
          this.step++;
          let idx: number;
          const to = op.timeout;
          // Evaluated in a replay too, so random() draws the same numbers as the first time.
          const seconds = to ? Number(evalExpr(to.seconds, this.scope())) || 0 : 0;
          if (this.instant) {
            const t = this.target;
            const here = t && 'file' in t && t.file === op.src.file ? t : null;
            let inside = here ? shown.findIndex(s => !s.disabled && here.line >= s.o.from && here.line <= s.o.to) : -1;
            if (inside < 0 && here && to && here.line >= to.from && here.line <= to.to) inside = shown.length; // the timeout answer
            if (inside < 0 && this.replay.length === 0) this.guessed++;
            idx = inside >= 0 ? inside : Math.min(Number(this.replay.shift() ?? 0) || 0, to ? shown.length : shown.length - 1);
          } else {
            this.pending = 'modal';
            this.queued = [];
            idx = await this.renderer.menu(
              shown.map(({ o, disabled }) => ({
                text: this.fmt(this.locale.t(o.id, o.text)),
                ...(disabled ? { disabled: true, reason: this.fmt(this.locale.t(o.reasonId, o.reason ?? '')) } : {}),
                seen: this.isSeen(this.optionKey(op, o)),
              })),
              op.src,
              op.prompt !== null ? this.fmt(this.locale.t(op.promptId, op.prompt)) : undefined,
              seconds > 0 ? { seconds } : undefined,
              op.look,
            );
            this.pending = null;
            if (gen !== this.gen) return;
          }
          if (to && idx === shown.length) { // time ran out: not an option, so nothing is marked as seen
            this.choices.push(idx);
            this.pc = to.target;
          } else {
            if (shown[idx]?.disabled || !shown[idx]) idx = shown.findIndex(s => !s.disabled); // a renderer must not return a disabled option
            this.choices.push(idx);
            const taken = this.optionKey(op, shown[idx].o);
            if (!this.seen.includes(taken)) { this.seen.push(taken); this.onSeen(taken); }
            this.pc = shown[idx].o.target;
          }
          // Still guessing after this many menus: the story goes round in circles and never gets to the line (see the forced rerun).
          if (this.instant && this.target && 'file' in this.target && (!this.triedForce || this.forceLabel) && this.guessed > RESTORE_GUESS_LIMIT) this.pc = ops.length;
          break;
        }
        case 'screen': {
          const def = this.program.screens[op.name];
          const initial = this.screenLocal(op);
          const local: Vars = { ...initial };
          const view = this.screenView(op, local);
          if (!blocks(view)) { this.vars[op.as] = ''; break; } // nothing to choose: returns at once, records nothing
          this.step++;
          const inout = def?.inout ?? [];
          let id: string;
          if (this.instant) {
            if (this.replay.length === 0) this.guessed++;
            const rec = this.replay.shift();
            const ret = Array.isArray(rec) ? rec : undefined;
            id = replayAnswer(view, ret ? ret[0] : rec as Value | undefined);
            // a returned value that no longer fits (another type, a word no radio sets) stays as the story had it
            inout.forEach((p, i) => { if (ret && fitsInout(def, p, ret[1 + i], initial[p])) local[p] = ret[1 + i]; });
          } else {
            this.pending = 'modal';
            this.queued = [];
            const snap = this.resume;
            this.resume = null;
            if (snap && snap.name === op.name && snap.at.file === op.src.file && snap.at.line === op.src.line) {
              for (const [k, v] of Object.entries(snap.local)) if (k in local && (k in initial) && v !== undefined) local[k] = v;
            }
            this.open = { op, local };
            // a screen with `state`s or `inout` redraws when a handler sets one; the local state is kept here, not in the story, so nothing is recorded until it answers
            const live = def?.states?.length || inout.length
              ? { set: (name: string, value: Value) => { if (name in local) local[name] = value; return this.screenView(op, local); } }
              : undefined;
            id = await this.renderer.screen(live ? this.screenView(op, local) : view, op.src, live);
            this.open = null;
            this.pending = null;
            if (gen !== this.gen) return;
          }
          // bare `cancel` answers "" and drops the inout changes; `cancel keep` and every other answer keep them
          if (id === '' && def?.cancel && !def.cancelKeep) for (const p of inout) local[p] = initial[p];
          inout.forEach((p, i) => { const to = op.outs?.[i]; if (to) this.assign(to, local[p]); });
          this.choices.push(inout.length ? [id, ...inout.map(p => local[p])] : id);
          this.vars[op.as] = id;
          // Still guessing after this many answers: a screen loop that never leaves (see the menu case).
          if (this.instant && this.target && 'file' in this.target && (!this.triedForce || this.forceLabel) && this.guessed > RESTORE_GUESS_LIMIT) this.pc = ops.length;
          break;
        }
        case 'input': {
          this.step++;
          let text: string;
          if (this.instant) text = String(this.replay.shift() ?? this.fmt(op.default));
          else {
            this.pending = 'modal';
            this.queued = [];
            text = (await this.renderer.input(this.fmt(this.locale.t(op.id, op.prompt)), this.fmt(op.default), op.max, op.src)).slice(0, op.max);
            this.pending = null;
            if (gen !== this.gen) return;
          }
          this.choices.push(text);
          this.vars[op.name] = text;
          break;
        }
        case 'set': case 'unlock': case 'hud':
          this.applyQuiet(op);
          break;
        case 'branch':
          if (!evalExpr(op.cond, this.scope(), this.draw)) this.pc = op.target;
          break;
        case 'goto':
          this.pc = op.target;
          if (this.entry !== null && op.src.line === 0) { this.pc = this.entry; this.entry = null; }
          if (this.forced && this.forceAt && op.src.line === 0) { // the entry jump after the top-level setup
            const t = this.forceAt;
            const gi = ops.indexOf(op);
            const at = ops.findIndex((o, i) => i > gi && o.src.file === t.file && o.src.line >= t.line);
            // The label the line is in (the nearest one before it in that file): its earlier lines replay first.
            const label = this.forceDirect ? -1
              : Math.max(-1, ...Object.values(this.program.labels).filter(l => l > gi && l <= at && ops[l]?.src.file === t.file));
            if (label >= 0) {
              this.pc = label; this.jumped = true; this.jumpedFrom = ops[label].src;
              this.forceLabel = true;
              this.forceOp = at;
              this.budget = 100000;
            } else if (at >= 0) {
              this.pc = at; this.jumped = true; this.jumpedFrom = t;
              // Entering mid-page: NVL is whatever the nearest earlier `nvl on|off` of that file left it as.
              for (let i = at - 1; i >= 0 && ops[i].src.file === t.file; i--) {
                const o = ops[i];
                if (o.op === 'nvl' && o.mode !== 'clear') { this.nvl = o.mode === 'on'; break; }
              }
            }
            this.forced = false;
          }
          break;
        case 'jump':
          this.pc = op.target;
          break;
        case 'call':
          if (op.target >= 0) { this.enter(op); this.pc = op.target; }
          break;
        case 'ret':
          if (this.stack.length) { const back = this.stack.pop()!; this.leave(this.frames.pop()); this.pc = back < 0 ? -back - 1 : back; }
          else this.pc = ops.length;
          break;
        case 'end':
          this.pc = ops.length;
          break;
        case 'nvl':
          if (op.mode !== 'clear') this.nvl = op.mode === 'on';
          this.clearPage();
          break;
        case 'textbox':
          if (!this.instant) this.renderer.hideBox?.();
          break;
        default: {
          // visual ops
          const vop = op as VisualOp;
          applyToState(this.state, vop);
          if (vop.op === 'scene') this.clearPage();
          if (this.instant) break;
          const p = this.renderer.apply(vop, this.state);
          if (vop.nowait) p.catch(() => {});
          else { await p; if (gen !== this.gen) return; }
        }
      }
    }
  }
}
