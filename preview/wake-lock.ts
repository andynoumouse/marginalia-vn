// Keeps a phone's screen on while the game plays by itself (auto-advance, a movie), through the Screen Wake Lock API where the browser has
// one. The browser drops the lock when the tab is hidden, so `resume()` asks again on return. docs/design/mobile.md, step 4.

interface Sentinel { release(): Promise<void>; addEventListener(type: 'release', fn: () => void): void }
interface WakeApi { request(type: 'screen'): Promise<Sentinel> }

export class ScreenWake {
  private reasons = new Set<string>();
  private lock: Sentinel | null = null;
  private asking = false;

  constructor(private api: WakeApi | undefined = (navigator as unknown as { wakeLock?: WakeApi }).wakeLock) {}

  /** `reason` wants the screen kept on (or no longer does). The lock is held while any reason does. */
  set(reason: string, on: boolean) {
    if (on) this.reasons.add(reason); else this.reasons.delete(reason);
    void this.sync();
  }

  resume() { void this.sync(); }

  private async sync() {
    const want = this.reasons.size > 0;
    if (!want) {
      const held = this.lock;
      this.lock = null;
      try { await held?.release(); } catch { /* already released */ }
      return;
    }
    if (this.lock || this.asking || !this.api || document.visibilityState !== 'visible') return;
    this.asking = true;
    try {
      const lock = await this.api.request('screen');
      if (this.reasons.size === 0) { await lock.release(); return; } // nobody wants it any more
      this.lock = lock;
      lock.addEventListener('release', () => { if (this.lock === lock) this.lock = null; });
    } catch { /* refused (battery saver, no permission): the screen may dim, nothing else */ } finally { this.asking = false; }
  }
}
