// Rollback through the timeline and the quick save/load slot, as used by the quick menu, keys and history screen.

import type { Runtime } from '../engine/src/index.js';
import { readSave, writeSave, type SaveData } from './saves.js';
import type { Timeline } from './timeline.js';

export interface QuickHost {
  runtime(): Runtime | null;
  timeline: Timeline;
  /** Playing with no menu open. */
  canAct(): boolean;
  /** Playing, menus allowed (the history screen has closed by the time it rolls back). */
  playing(): boolean;
  stopModes(): void;
  capture(): Promise<SaveData | null>;
  toast(key: string): void;
  confirm(key: string, ok: () => void): void;
  resumeSave(s: SaveData, go: () => void): void;
  play(run: (rt: Runtime) => Promise<void>, from?: SaveData): void;
}

export class QuickActions {
  constructor(private host: QuickHost) {}

  rollback() {
    const { host } = this;
    const runtime = host.runtime();
    if (!host.canAct() || !runtime) return;
    const prev = host.timeline.back();
    if (!prev) return;
    host.stopModes();
    void runtime.restore({ step: prev.step, from: runtime.jumpedFrom ?? undefined }, prev.choices); // steps count from a direct entry
  }

  /** A line picked in the history screen (which has closed): roll back to it, however far. */
  rollbackTo(n: number) {
    const { host } = this;
    const runtime = host.runtime();
    if (!host.playing() || !runtime) return;
    const to = host.timeline.backTo(n);
    if (!to) return;
    host.stopModes();
    void runtime.restore({ step: to.step, from: runtime.jumpedFrom ?? undefined }, to.choices);
  }

  async quickSave() {
    const { host } = this;
    if (!host.canAct()) return;
    const data = await host.capture();
    host.toast(data && writeSave('quick', data) ? 'toast_qsaved' : 'save_failed');
  }

  quickLoad() {
    const { host } = this;
    if (!host.canAct()) return;
    const s = readSave('quick');
    if (!s) { host.toast('toast_no_qsave'); return; }
    host.confirm('confirm_qload', () => host.resumeSave(s, () => host.play(rt => rt.restore(s.at, s.choices, s.screen), s)));
  }
}
