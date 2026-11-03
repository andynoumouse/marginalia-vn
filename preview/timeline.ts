// Rollback history: the lines and choices passed, for rollback and the history screen.

import type { LineInfo } from './stage-ui.js';
import type { Moment } from './saves.js';

/** Lines and choices passed, for rollback and the history screen; saves carry it (same script version only). */
export const HISTORY_IN_SAVES = 150;
export class Timeline {
  private moments: Moment[] = [];
  push(m: Moment) {
    if (this.moments.at(-1)?.step === m.step) this.moments.pop(); // the same line shown again (rollback lands here)
    this.moments.push(m);
    if (this.moments.length > 500) this.moments.shift();
  }
  /** Drop the current moment and return the one before it (it is pushed again when shown). */
  back(): Moment | null {
    if (this.moments.length < 2) return null;
    this.moments.pop();
    return this.moments.pop()!;
  }
  /** Drop everything after the `n`th line (0-based, as `lines()` counts them) and return that line's moment (it is pushed
   *  again when shown); null when it is the line on screen or there is no such line. */
  backTo(n: number): Moment | null {
    let seen = -1;
    const at = this.moments.findIndex(m => m.line && ++seen === n);
    if (at < 0 || at === this.moments.length - 1) return null;
    return this.moments.splice(at)[0];
  }
  clear() { this.moments = []; }
  set(moments: Moment[]) { this.moments = [...moments]; }
  recent(): Moment[] { return this.moments.slice(-HISTORY_IN_SAVES); }
  /** The newest moment is a line (not a choice or prompt shown after it). */
  atLine(): boolean { return !!this.moments.at(-1)?.line; }
  lines(): LineInfo[] { return this.moments.flatMap(m => (m.line ? [m.line] : [])); }
}
