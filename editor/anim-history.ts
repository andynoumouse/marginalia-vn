// The animation studio's undo/redo: snapshots of the working copy before each change, capped at `limit`.

export class UndoStack<T> {
  private past: T[] = [];
  private future: T[] = [];

  constructor(private limit = 100) {}

  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }

  clear() { this.past = []; this.future = []; }

  /** Remember `before` as the state a change started from; that drops anything that could be redone. */
  record(before: T) {
    this.past.push(before);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  /** The state to go back to (`current` becomes redoable), or undefined with nothing to undo. */
  undo(current: T): T | undefined {
    const prev = this.past.pop();
    if (prev !== undefined) this.future.push(current);
    return prev;
  }

  redo(current: T): T | undefined {
    const next = this.future.pop();
    if (next !== undefined) this.past.push(current);
    return next;
  }
}
