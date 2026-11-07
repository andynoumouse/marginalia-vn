// Achievement toasts: one at a time, each shown for `seconds` and then faded out before the next.

import type { AchievementEntry, AchievementToastSettings } from '../engine/src/index.js';
import { sleep } from './stage-ui.js';

export interface ToastHost {
  settings(): AchievementToastSettings;
  /** Show the toast (and play its sound), or with null take it away. */
  present(entry: AchievementEntry | null, cfg: AchievementToastSettings): void;
}

export class AchievementQueue {
  private queue: AchievementEntry[] = [];
  private showing = false;

  constructor(private host: ToastHost) {}

  add(entry: AchievementEntry) {
    this.queue.push(entry);
    if (!this.showing) void this.next();
  }

  private async next() {
    const entry = this.queue.shift();
    if (!entry) { this.showing = false; return; }
    this.showing = true;
    try {
      const cfg = this.host.settings();
      this.host.present(entry, cfg);
      await sleep(cfg.seconds * 1000);
      this.host.present(null, cfg);
      await sleep(300); // the fade out
    } catch (e) {
      console.warn('achievement toast failed:', e); // a throw must not leave `showing` set, or no toast ever appears again
    }
    void this.next();
  }
}
