import { defaultAnswer, type ScreenView } from './screens.js';
import type { DisplayState, MenuItem, Renderer, SayEvent, ScreenLive, Src, VisualOp } from './types.js';

/** Headless renderer for tests and tools: records everything and never waits. */
export class NullRenderer implements Renderer {
  events: string[] = [];
  says: SayEvent[] = [];
  menus: string[][] = [];
  /** The menus as shown, with disabled/seen flags, and their prompt lines (null: none). */
  menuItems: MenuItem[][] = [];
  prompts: (string | null)[] = [];
  syncs: DisplayState[] = [];
  inputs: string[] = [];
  ended = false;
  /** Decide which option to take; defaults to the first. */
  chooser: (options: MenuItem[]) => number = () => 0;

  sync(state: DisplayState) { this.syncs.push(JSON.parse(JSON.stringify(state))); this.ended = false; }
  async apply(op: VisualOp) { this.events.push(op.op); }
  async say(ev: SayEvent) { this.says.push(ev); }
  /** The clock of each menu as shown (null: none). The null renderer never times out by itself: have `chooser` return `options.length` to do so. */
  timers: ({ seconds: number } | null)[] = [];
  /** The `style=` of each menu as shown (null: none). */
  menuStyles: (string | null)[] = [];
  async menu(options: MenuItem[], _src: Src, prompt?: string, timer?: { seconds: number }, style?: string) {
    this.timers.push(timer ?? null);
    this.menuStyles.push(style ?? null);
    this.menus.push(options.map(o => o.text));
    this.menuItems.push(options.map(o => ({ ...o })));
    this.prompts.push(prompt ?? null);
    return this.chooser(options);
  }
  /** Decide the answer to an input; defaults to its default text. */
  answerer: (prompt: string, def: string) => string = (_p, def) => def;
  async input(prompt: string, def: string, _max: number, _src: Src) { this.inputs.push(prompt); return this.answerer(prompt, def); }
  screens: ScreenView[] = [];
  /** Decide which element a screen returns; defaults to its default answer. A screen with local state also gets its `live`, to change that state before answering. */
  picker: (view: ScreenView, live?: ScreenLive) => string = defaultAnswer;
  async screen(view: ScreenView, _src: Src, live?: ScreenLive) { this.screens.push(view); return this.picker(view, live); }
  /** The HUD screens as the runtime last pushed them. */
  huds: ScreenView[][] = [];
  hud(views: ScreenView[]) { this.huds.push(views); }
  end() { this.ended = true; }
}
