// The animation studio's undo/redo: snapshots of the working copy before each change, capped at `limit`. Each step carries a label
// (what it changed and where, studio-history.ts) that goes with it to the redo side, so undo and redo can say what they did.

export class UndoStack<T, L = string> {
  private past: { state: T; label: L }[] = [];
  private future: { state: T; label: L }[] = [];

  constructor(private limit = 100) {}

  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  /** The label of the step Undo would take back, and of the one Redo would do again. */
  get undoLabel(): L | undefined { return this.past.at(-1)?.label; }
  get redoLabel(): L | undefined { return this.future.at(-1)?.label; }

  clear() { this.past = []; this.future = []; }

  /** Remember `before` as the state a change started from, with what the change was; that drops anything that could be redone. */
  record(before: T, label: L) {
    this.past.push({ state: before, label });
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  /** The state to go back to and the step undone (`current` becomes redoable), or undefined with nothing to undo. */
  undo(current: T): { state: T; label: L } | undefined {
    const prev = this.past.pop();
    if (prev !== undefined) this.future.push({ state: current, label: prev.label });
    return prev;
  }

  redo(current: T): { state: T; label: L } | undefined {
    const next = this.future.pop();
    if (next !== undefined) this.past.push({ state: current, label: next.label });
    return next;
  }
}
