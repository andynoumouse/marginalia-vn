// Capturing the moment on screen as a save (manual slots, quick save) and the autosave that follows each line.

import type { Runtime } from '../engine/src/index.js';
import type { PixiRenderer } from './pixi-renderer.js';
import { writeChoiceSave, writeSave, type SaveData } from './saves.js';
import type { LineInfo } from './stage-ui.js';
import type { Timeline } from './timeline.js';

export interface CaptureHost {
  runtime(): Runtime | null;
  lastLine(): LineInfo;
  scriptVersion(): string;
  saveVersion(): number;
  timeline: Timeline;
  renderer: PixiRenderer;
}

export class SaveCapture {
  private autosaveSeq = 0;

  constructor(private host: CaptureHost) {}

  /** The moment on screen, as a save; null before the story has shown anything. */
  async capture(): Promise<SaveData | null> {
    const { host } = this;
    const runtime = host.runtime();
    const at = runtime?.current;
    if (!runtime || !at) return null;
    const line = host.lastLine();
    const data: SaveData = {
      at, choices: [...runtime.choices], ...(runtime.screenSnapshot() ? { screen: runtime.screenSnapshot()! } : {}), name: line.name, text: line.text, time: Date.now(),
      base: [...runtime.unlockedBase], persistentBase: { ...runtime.persistentBase }, seed: runtime.seed, version: host.scriptVersion(), saveVersion: host.saveVersion(), history: host.timeline.recent(),
    };
    return { ...data, thumb: await host.renderer.snapshot() };
  }

  async autosave(atChoice: boolean) {
    const seq = ++this.autosaveSeq;
    const data = await this.capture();
    if (!data || seq !== this.autosaveSeq) return; // a newer line may have finished capturing first
    writeSave('auto', data);
    if (atChoice) writeChoiceSave(data);
  }
}
