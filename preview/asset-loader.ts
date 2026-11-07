// What the stage renderer has loaded and what it is loading: the files behind asset keys (images, music, sounds,
// movies), the waits the story makes for them (with the loading bar), and the lookahead that fetches them early.

import { VOICE_KEY, type PreloadTask } from '../engine/src/index.js';

const LOADING_BAR_MS = 250; // a wait for files shows the loading bar only after this long
const PREFETCH_PARALLEL = 4;   // files fetched ahead at once (8 while skipping); a file the story is waiting for never queues
const HOLD_MAX_MS = 20000;  // a wait never lasts longer than this; the placeholder is drawn instead
/** How many lines ahead voice recordings are decoded (the cache holds a dozen; the rest of the lookahead is only for images and audio files). */
const VOICE_AHEAD = 4;

/** The key of an asset file: its path under assets/ without the extension. */
export const assetKey = (file: string) => file.replace(/\.[^./]+$/, '');

export interface LoaderHooks {
  /** Load one asset key; never rejects. */
  fetch(key: string): Promise<void>;
  /** Decode the recording of a line (by localization id). */
  voice(id: string): Promise<void>;
}

export class AssetLoader {
  private versions = new Map<string, number>();     // asset key -> file version it was loaded from
  private ready = new Set<string>();                // asset keys that are loaded
  private loading = new Map<string, Promise<void>>();
  private queue: PreloadTask[] = [];                // preload tasks not started yet, nearest first
  private running = 0;                              // preload tasks in flight
  private waiting = 0;                              // waits in progress (the loading bar is shown while any is slow)
  private barTimer = 0;
  private barDone = 0;
  private barTotal = 0;

  /** `bar` is the loading bar element; its first child is the fill. `skipping` says whether skip mode is on (the lookahead goes wider). */
  constructor(private bar: HTMLElement, private hooks: LoaderHooks, private skipping: () => boolean) {}

  /** The project's files and their versions; a file that changed or went away must load again. */
  setVersions(versions: Map<string, number>) {
    for (const [key, v] of this.versions) {
      if (versions.get(key) !== v) { this.ready.delete(key); this.loading.delete(key); }
    }
    this.versions = versions;
  }
  isReady(key: string) { return this.ready.has(key); }
  /** The keys that exist in the project and are not loaded yet. */
  pending(keys: string[]): string[] { return keys.filter(k => !this.ready.has(k) && this.versions.has(k)); }

  /** Load the files behind these asset keys and resolve once they are all ready (or after HOLD_MAX_MS). */
  ensure(keys: string[]): Promise<void> {
    const todo = this.pending([...new Set(keys)]);
    if (!todo.length) return Promise.resolve();
    const { bar } = this;
    this.barTotal += todo.length;
    if (++this.waiting === 1) this.barTimer = window.setTimeout(() => { bar.dataset.show = 'true'; }, LOADING_BAR_MS);
    const draw = () => { (bar.firstElementChild as HTMLElement).style.width = `${(this.barDone / this.barTotal) * 100}%`; };
    const all = Promise.all(todo.map(k => this.fetch(k).then(() => { this.barDone++; draw(); })));
    let cap = 0;
    return Promise.race([all, new Promise<void>(r => { cap = window.setTimeout(r, HOLD_MAX_MS); })]).then(() => {
      clearTimeout(cap);
      if (--this.waiting === 0) {
        clearTimeout(this.barTimer);
        bar.dataset.show = 'false';
        this.barDone = this.barTotal = 0;
      }
    });
  }

  private fetch(key: string): Promise<void> {
    let p = this.loading.get(key);
    if (!p) {
      p = this.hooks.fetch(key).then(() => { this.ready.add(key); });
      this.loading.set(key, p);
    }
    return p;
  }

  /**
   * The story came near these assets (nearest first; see Preload in the engine): fetch them in order, a few at a
   * time. Each call replaces the list of what is still waiting, since the newest view of what is ahead is the
   * best; files the story already waits for are loaded by ensure() at once, not queued here.
   */
  prefetch(tasks: PreloadTask[], always: string[]) {
    this.queue = [...tasks, ...always.map(key => ({ key, lines: Infinity }))];
    this.pump();
  }
  private pump() {
    const limit = this.skipping() ? PREFETCH_PARALLEL * 2 : PREFETCH_PARALLEL;
    while (this.running < limit && this.queue.length) {
      const { key, lines } = this.queue.shift()!;
      if (key.startsWith(VOICE_KEY)) { // recordings are decoded only for the next few lines; the cache is small
        if (lines <= VOICE_AHEAD) { this.running++; void this.hooks.voice(key.slice(VOICE_KEY.length)).then(() => { this.running--; this.pump(); }); }
        continue;
      }
      if (this.ready.has(key) || this.loading.has(key) || !this.versions.has(key)) continue;
      this.running++;
      void this.fetch(key).then(() => { this.running--; this.pump(); });
    }
  }
}
