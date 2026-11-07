// The decisions behind typing one line, apart from the DOM and the timers (preview/line-typer.ts performs them).
// A line is typing, held (at a {w} or a full page, waiting for the player or a timer), or done (shown in full); `over`
// once the player has moved past it. A click, a kick from a settings change and the timers all ask the same questions.

/** Why typing stopped short of the end: at a {w} wait, or because the page of the text box is full. */
export type LineHold = 'none' | 'wait' | 'page';

export interface LineFlow {
  /** The line is shown in full. */
  done: boolean;
  hold: LineHold;
  /** The player moved past the line. */
  over: boolean;
}

/** Time each line stays on screen while skipping. */
export const SKIP_MS = 45;
/** How long a line ending in `{next}` stays before the story goes on. */
export const NEXT_MS = 250;

export const startFlow = (): LineFlow => ({ done: false, hold: 'none', over: false });
/** The line is shown in full (finishing clears any hold). */
export const finished = (f: LineFlow): LineFlow => ({ ...f, done: true, hold: 'none' });
/** Typing stopped at a hold; `done` stays as it was. */
export const held = (f: LineFlow, hold: 'wait' | 'page'): LineFlow => ({ ...f, hold });
/** The hold was lifted (by a click or a timer). */
export const released = (f: LineFlow): LineFlow => ({ ...f, hold: 'none' });
export const ended = (f: LineFlow): LineFlow => ({ ...f, over: true });

/** What a player click does: lift a hold, move on from a finished line, or show the rest of the line. */
export function clickAct(f: LineFlow): 'release' | 'next' | 'finish' {
  if (f.hold !== 'none') return 'release';
  return f.done ? 'next' : 'finish';
}

/** What a changed setting does to the line on screen (`skipNow`: skipping is on and this line may be skipped). */
export function kickAct(f: LineFlow, skipNow: boolean): 'settle' | 'finish' | 'none' {
  if (f.done) return 'settle';
  return skipNow ? 'finish' : 'none';
}

/** The voice recording ended: whether the line, if it was waiting only for it, should settle now. */
export const settleAfterVoice = (f: LineFlow): boolean => f.done && !f.over;

export interface Pace {
  skipping: boolean;
  /** Whether skipping may pass this line (already read, or skip-all). */
  skippable: boolean;
  autoOn: boolean;
  /** Milliseconds auto-advance waits for this line or page. */
  autoMs: number;
  /** A voice recording of the line is still playing (auto-advance waits for it). */
  voicePlaying?: boolean;
  /** The line ends in `{next}`. */
  autoNext?: boolean;
}

/** What to do about the clock: stop skipping first (unread text), then wait `after` ms (null: wait for the player). */
export interface Plan { dropSkip: boolean; after: number | null }

/** The line is shown in full: skip on, auto-advance, or wait for the player. */
export function settlePlan(p: Pace): Plan {
  if (p.skipping) {
    if (p.skippable) return { dropSkip: false, after: SKIP_MS };
    return { dropSkip: true, after: p.autoNext ? NEXT_MS : p.autoOn && !p.voicePlaying ? p.autoMs : null };
  }
  if (p.autoNext) return { dropSkip: false, after: NEXT_MS };
  return { dropSkip: false, after: p.autoOn && !p.voicePlaying ? p.autoMs : null };
}

/** The text box is full and the line goes on: when the next page starts. */
export function pagePlan(p: Pace): Plan {
  if (p.skipping) {
    if (p.skippable) return { dropSkip: false, after: SKIP_MS };
    return { dropSkip: true, after: p.autoOn ? p.autoMs : null };
  }
  return { dropSkip: false, after: p.autoOn ? p.autoMs : null };
}

/** A {w} wait: `skip` when skipping passes it, else hold, with `after` ms for auto mode (null: wait for the player). */
export function waitPlan(p: Pace): { skip: boolean; after: number | null } {
  if (p.skipping && p.skippable) return { skip: true, after: null };
  return { skip: false, after: p.autoOn ? p.autoMs : null };
}
