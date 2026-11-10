// The editor's own saves, so it can tell a reload event it caused from a change made outside it. A script autosave would
// otherwise make the editor fetch and re-apply the whole project (/api/project) every few seconds while someone types.

/** How long after a save its reload event still counts as ours (the server sends it ~120 ms after the write). */
export const OWN_SAVE_MS = 2000;

export class OwnSaves {
  private recent = new Map<string, number>(); // project path ('script/park.vn') -> when its save went through

  /** A save of `path` went through at `now`. */
  saved(path: string, now: number) { this.recent.set(path, now); }

  /**
   * Whether a reload event naming `files` is only our own recent saves; if so, those saves are used up (a second event
   * for the same file is then treated as an outside change). An event without names, or with one the watcher did not
   * name (''), is never ours.
   */
  covers(files: readonly string[] | undefined, now: number): boolean {
    for (const [p, at] of this.recent) if (now - at > OWN_SAVE_MS) this.recent.delete(p);
    if (!files?.length || !files.every(f => this.recent.has(f))) return false;
    for (const f of files) this.recent.delete(f);
    return true;
  }
}
