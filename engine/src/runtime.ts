import { arith, evalExpr, type Value } from './expr.js';
import { applyToState, emptyState } from './display-state.js';
import { isQuietLabel } from './quiet-label.js';
import { Locale } from './locale.js';
import { blocks, fitsInout, initialState, pickables, replayAnswer, resolveScreen, screenParams, type HudEvent, type ScreenEnv, type ScreenView } from './screens.js';
import { newSeed, randomStep, type Rng } from './random.js';
import { resolveTransform } from './transform.js';
import { putSave, takeSave, type SaveData } from './save-data.js';
import * as views from './shell-views.js';
import type { QuickMenu, ViewHost } from './shell-views.js';
import { interpolate, parseRich } from './text.js';
import type { Answer, ScreenSnap, DisplayState, MenuOption, Op, Program, Renderer, SayEvent, Src, VisualOp, Vars } from './types.js';

export { applyToState, emptyState };
export type { SaveData };

/** Where restore() stops: a source position, or the n-th line/choice from the start. */
export type RestoreTarget = Src | { step: number; from?: Src };

/** Where a restore() stands in getting to a line the story never reaches (see Runtime.rerun). */
type Rerun =
  | { kind: 'none' }
  | { kind: 'pending'; at: Src; direct: boolean }
  | { kind: 'label'; op: number; budget: number }
  | { kind: 'done' };

/** How many menus a restore to a source line answers by default before it gives up on reaching the line by playing. */
const RESTORE_GUESS_LIMIT = 200;

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
  /** Op indices where a label starts, ascending (see labelAt); and the label a source-position restore() must stop in (see targetLabel). */
  private labelStarts: number[] | null = null;
  private stopLabel: { target: Src; label: number } | null = null;
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
  /** The last line a replay passed that the text box still shows (none after `textbox hide`, an NVL line or a screen with `textbox off`): see finishInstant. */
  private boxLine: { op: Extract<Op, { op: 'say' }>; text: string } | null = null;

  private gen = 0;
  private instant = false;
  private target: RestoreTarget | null = null;
  private replay: Answer[] = [];
  /** The blocking screen waiting for the player: its op and its local variables (parameters, `state`s), which `live.set` changes. */
  private open: { op: Extract<Op, { op: 'screen' }>; local: Vars } | null = null;
  /** Local state a restore() hands back to the screen it reopens (see screenSnapshot); used once, by the first live showing of that screen. */
  private resume: ScreenSnap | null = null;
  /** Set while a restore() to a source line the story never reaches is rerun to enter that label body directly. */
  /**
   * How a restore() gets to a line the story never reaches. 'none': replaying the recorded answers, no rerun tried yet.
   * 'pending': the setup is being rerun and the entry jump will enter at `at`: at the start of the label around the line,
   * replaying up to it so the label's earlier lines set up the scene, or at the line itself when `direct` (a second
   * try after the label failed; also used by step restores). 'label': that replay is running, with `budget` ops left
   * before it gives up and `op` the op it must get to. 'done': entered, nothing more to try.
   */
  private rerun: Rerun = { kind: 'none' };
  /** Menus a restore() answered with its default (nothing recorded): a story that loops through menus never ends this way. */
  private guessed = 0;
  /** True when the last restore() had to jump straight to its line (the story does not get there on its own). */
  jumped = false;
  /** The source position the last restore() entered directly (steps count from there: pass it as `from` to restore a step). */
  jumpedFrom: Src | null = null;
  /** Set during playLabel(): the label the entry jump goes to instead of `start`, and whether the run reached its end. */
  private entry: number | null = null;
  private cutscene = false;
  private cutsceneDone = false;

  constructor(public program: Program, private renderer: Renderer, public locale: Locale = new Locale()) {
    renderer.setTransforms?.(program.transforms ?? {});
  }

  setProgram(program: Program, locale?: Locale) {
    this.program = program;
    this.renderer.setTransforms?.(program.transforms ?? {});
    this.labelNames = null;
    this.labelStarts = null;
    this.stopLabel = null;
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
    this.boxLine = null;
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
    this.rerun = 'step' in target && target.from ? { kind: 'pending', at: target.from, direct: true } : { kind: 'none' };
    this.guessed = 0;
    this.jumped = false;
    this.jumpedFrom = null;
    this.syncRenderer();
    return this.run();
  }

  /** True while a forced rerun can still be started: none was tried, or the label replay is running (and may fall back to the line). */
  private canForce() { return this.rerun.kind === 'none' || this.rerun.kind === 'label'; }

  /** The blocking screen that is up, with the local state it has now (null when none): a save keeps it, and restore() can hand it back. */
  screenSnapshot(): ScreenSnap | null {
    const o = this.open;
    if (!o) return null;
    const def = this.program.screens[o.op.name];
    const keep = [...(def?.inout ?? []), ...(def?.states ?? []).map(d => d.name)];
    return { at: o.op.src, name: o.op.name, local: Object.fromEntries(keep.map(k => [k, o.local[k]])) };
  }

  save(): SaveData { return takeSave(this); }

  async load(data: SaveData): Promise<void> {
    this.stop();
    const gen = this.gen;
    putSave(this, data);
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
  private async finishInstant(gen: number, op: Op | null): Promise<boolean> {
    if (!this.instant) return true;
    this.instant = false;
    this.target = null;
    if (this.renderer.prepare) { await this.renderer.prepare(this.state); if (gen !== this.gen) return false; }
    this.syncRenderer();
    // The first visit left the last line in the box under a choice, prompt or screen; a say types its own line, and the end hides the box.
    const box = this.boxLine;
    if (box && op && op.op !== 'say' && !(op.op === 'screen' && this.screenView(op).hideBox && blocks(this.screenView(op)))) this.renderer.showLine?.(this.sayEvent(box.op, box.text));
    this.hintNear(this.pc);
    return true;
  }

  private sayEvent(op: Extract<Op, { op: 'say' }>, text: string): SayEvent {
    const def = this.program.characters[op.who ?? 'narrator'];
    return {
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
  }

  private reached(op: Op): boolean {
    const t = this.target;
    if (!t) return false;
    if ('step' in t) {
      const stops = op.op === 'say' || op.op === 'input' || (op.op === 'menu' && this.visibleOptions(op).length > 0)
        || (op.op === 'screen' && blocks(this.screenView(op)));
      return stops && this.step + 1 >= t.step;
    }
    return op.src.file === t.file && op.src.line >= t.line && this.labelAt(this.pc) === this.targetLabel(t);
  }

  /** The start of the label whose body holds op `pc` (-1 before the first label: the top-level setup). */
  private labelAt(pc: number): number {
    const starts = this.labelStarts ??= [...new Set(Object.values(this.program.labels) as number[])].sort((a, b) => a - b);
    let lo = 0, hi = starts.length; // how many starts are at or before pc
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] <= pc) lo = mid + 1; else hi = mid;
    }
    return lo ? starts[lo - 1] : -1;
  }

  /**
   * The label a restore() to a source position stops in: the one around the op nearest at or after the line (top-level
   * lines are hoisted ahead of the labels, so the op list is not in file order). A label run on the way there, such as a
   * subroutine written further down the file and called before the cursor's label, does not catch the stop.
   * -2 when no op is at or after the line, where nothing is reached anyway.
   */
  private targetLabel(t: Src): number {
    if (this.stopLabel?.target !== t) {
      const { ops } = this.program;
      let at = -1;
      for (let i = 0; i < ops.length; i++) {
        const { file, line } = ops[i].src;
        if (file === t.file && line > 0 && line >= t.line && (at < 0 || line < ops[at].src.line)) at = i;
      }
      this.stopLabel = { target: t, label: at < 0 ? -2 : this.labelAt(at) };
    }
    return this.stopLabel.label;
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

  /** What the shell tells the quick menu: the buttons to show and where the bar goes (see `QuickMenu`). */
  quickMenu: QuickMenu = { items: [], place: 'bottom' };

  /** The translation of a built-in label ("New game") in the starter screens; the shell sets it from the `ui.<key>` entries of the locale. */
  uiText: (raw: string) => string = raw => raw;

  // The built-in shell screens as views; what each takes and returns is documented in shell-views.ts.
  private get host(): ViewHost { return { screens: this.program.screens, viewOf: (name, extra, entries) => this.viewOf(name, extra, entries) }; }
  quickView(): ScreenView | null { return views.quickView(this.host, this.quickMenu); }
  titleView(canContinue: boolean, hasGallery = true, hasMusic = true, hasChapters = true, hasAchievements = true, gameTitle = '', showTitle = true, continueText = ''): ScreenView | null {
    return views.titleView(this.host, canContinue, hasGallery, hasMusic, hasChapters, hasAchievements, gameTitle, showTitle, continueText);
  }
  pauseView(): ScreenView | null { return views.pauseView(this.host); }
  optionsView(values: Vars, entries?: NonNullable<ScreenEnv['entries']>): ScreenView | null { return views.optionsView(this.host, values, entries); }
  savesView(values: Vars, entries: NonNullable<ScreenEnv['entries']>): ScreenView | null { return views.savesView(this.host, values, entries); }
  historyView(values: Vars, entries: NonNullable<ScreenEnv['entries']>): ScreenView | null { return views.historyView(this.host, values, entries); }
  galleryView(values: Vars, entries: NonNullable<ScreenEnv['entries']>): ScreenView | null { return views.galleryView(this.host, values, entries); }
  viewerView(values: Vars): ScreenView | null { return views.viewerView(this.host, values); }
  musicView(values: Vars, entries: NonNullable<ScreenEnv['entries']>): ScreenView | null { return views.musicView(this.host, values, entries); }
  chaptersView(values: Vars, entries: NonNullable<ScreenEnv['entries']>): ScreenView | null { return views.chaptersView(this.host, values, entries); }
  achievementsView(values: Vars, entries: NonNullable<ScreenEnv['entries']>): ScreenView | null { return views.achievementsView(this.host, values, entries); }
  achievementToastView(values: Vars): ScreenView | null { return views.achievementToastView(this.host, values); }

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

  private isQuiet(label: string): boolean { return isQuietLabel(this.program, label); }

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
      if (this.rerun.kind === 'label' && this.instant && --this.rerun.budget < 0) this.pc = ops.length; // the label goes round in circles
      if (this.pc < 0 || this.pc >= ops.length) {
        if (this.resolveRerun()) continue;
        if (this.cutscene) { this.cutscene = false; this.cutsceneDone = true; return; }
        if (!await this.finishInstant(gen, null)) return;
        this.renderer.end();
        return;
      }
      const op = ops[this.pc];
      // Replaying a label went past the line without running it (an `if` around it was false): enter the line itself.
      if (this.rerun.kind === 'label' && this.instant && this.pc !== this.rerun.op && this.reached(op)) { this.pc = ops.length; continue; }
      const stops =op.op === 'say' || op.op === 'input' || (op.op === 'menu' && this.visibleOptions(op).length > 0)
        || (op.op === 'screen' && blocks(this.screenView(op)));
      if (stops) { // a safe point: HUD events are taken here, before the line or choice is shown
        if (this.takeHudEvent()) continue;
        if (!this.instant) this.pushHud();
      }
      if (this.instant && this.reached(op) && !await this.finishInstant(gen, op)) return;
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

      if (!await this.stepOp(op, gen)) return;
    }
  }

  /** The program ran out while replaying toward a target line: rerun the setup, which then enters the label around it. True when it did. */
  private resolveRerun(): boolean {
    const { ops } = this.program;
    const t = this.target;
    if (this.instant && t && 'file' in t && this.canForce() && ops.some(o => o.src.file === t.file && o.src.line >= t.line && o.src.line > 0)) {
      // The story never gets to that line: rerun the setup, then enter the label around it (or, when that failed too, the line itself).
      this.rerun = { kind: 'pending', at: t, direct: this.rerun.kind === 'label' };
      this.reset();
      this.replay = [];
      this.guessed = 0;
      this.syncRenderer();
      return true;
    }
    return false;
  }

  /** One op of the loop. False when the loop must stop: a newer run replaced this one while it awaited. */
  private async stepOp(op: Op, gen: number): Promise<boolean> {
    const { ops } = this.program;
    switch (op.op) {
      case 'say': {
        this.step++;
        const raw = this.locale.t(op.id, op.text);
        const text = raw.includes('[') ? this.fmt(raw) : raw; // a replay passes every line: no scope copy for plain text
        this.boxLine = this.nvl ? null : { op, text };
        if (this.instant && !this.nvl) break;
        const ev = this.sayEvent(op, text);
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
        if (gen !== this.gen) return false;
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
          if (gen !== this.gen) return false;
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
        if (this.instant && this.target && 'file' in this.target && this.canForce() && this.guessed > RESTORE_GUESS_LIMIT) this.pc = ops.length;
        break;
      }
      case 'screen': {
        const def = this.program.screens[op.name];
        const initial = this.screenLocal(op);
        const local: Vars = { ...initial };
        const view = this.screenView(op, local);
        if (!blocks(view)) { this.vars[op.as] = ''; break; } // nothing to choose: returns at once, records nothing
        this.step++;
        if (view.hideBox) this.boxLine = null; // `textbox off`: the last line stays gone after the screen
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
          if (gen !== this.gen) return false;
        }
        // bare `cancel` answers "" and drops the inout changes; `cancel keep` and every other answer keep them
        if (id === '' && def?.cancel && !def.cancelKeep) for (const p of inout) local[p] = initial[p];
        inout.forEach((p, i) => { const to = op.outs?.[i]; if (to) this.assign(to, local[p]); });
        this.choices.push(inout.length ? [id, ...inout.map(p => local[p])] : id);
        this.vars[op.as] = id;
        // Still guessing after this many answers: a screen loop that never leaves (see the menu case).
        if (this.instant && this.target && 'file' in this.target && this.canForce() && this.guessed > RESTORE_GUESS_LIMIT) this.pc = ops.length;
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
          if (gen !== this.gen) return false;
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
        if (this.rerun.kind === 'pending' && op.src.line === 0) { // the entry jump after the top-level setup
          const { at: t, direct } = this.rerun;
          this.rerun = { kind: 'done' };
          const gi = ops.indexOf(op);
          const at = ops.findIndex((o, i) => i > gi && o.src.file === t.file && o.src.line >= t.line);
          // The label the line is in (the nearest one before it in that file): its earlier lines replay first.
          const label = direct ? -1
            : Math.max(-1, ...Object.values(this.program.labels).filter(l => l > gi && l <= at && ops[l]?.src.file === t.file));
          if (label >= 0) {
            this.pc = label; this.jumped = true; this.jumpedFrom = ops[label].src;
            this.rerun = { kind: 'label', op: at, budget: 100000 };
          } else if (at >= 0) {
            this.pc = at; this.jumped = true; this.jumpedFrom = t;
            // Entering mid-page: NVL is whatever the nearest earlier `nvl on|off` of that file left it as.
            for (let i = at - 1; i >= 0 && ops[i].src.file === t.file; i--) {
              const o = ops[i];
              if (o.op === 'nvl' && o.mode !== 'clear') { this.nvl = o.mode === 'on'; break; }
            }
          }
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
        this.boxLine = null;
        if (!this.instant) this.renderer.hideBox?.();
        break;
      case 'perform': { // a choreography: every actor's part starts together, and the longest (they are all as long) ends it
        const members = this.program.choreographies?.[op.name] ?? [];
        for (const [i, m] of members.entries()) {
          const part: VisualOp = { op: 'animate', char: m.target, name: m.transform, dur: null, loop: false, strength: 1, part: null, src: op.src };
          if (this.instant) continue;
          const p = this.renderer.apply(part, this.state);
          if (op.nowait || i < members.length - 1) p.catch(e => console.warn('perform (part) failed:', e));
          else { await p; if (gen !== this.gen) return false; }
        }
        break;
      }
      default: {
        // visual ops: no cast, so a control op without a case above is a type error here
        let vop: VisualOp = op;
        if (op.op === 'animate' && op.name !== null && this.program.dynamicTransforms && Object.hasOwn(this.program.dynamicTransforms, op.name)) {
          // a transform with parameters, variables, if or pick: worked out now, and kept in the state with a loop so a save plays the same one
          const scope = this.scope();
          vop = { ...op, def: resolveTransform(this.program.dynamicTransforms[op.name], (op.args ?? []).map(e => evalExpr(e, scope, this.draw)), scope, this.draw) };
        }
        applyToState(this.state, vop, this.program.rigPoses);
        if (vop.op === 'scene') this.clearPage();
        if (this.instant) break;
        const p = this.renderer.apply(vop, this.state);
        if (vop.nowait) p.catch(e => console.warn(`${vop.op} (nowait) failed:`, e));
        else { await p; if (gen !== this.gen) return false; }
      }
    }
    return true;
  }
}
