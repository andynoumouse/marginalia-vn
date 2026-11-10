/**
 * Calls `move` for each pointermove on `target` until the pointer is released or cancelled (a touch the browser takes
 * over, a pen leaving range), then `end` with that last event. Ending on pointercancel too keeps a drag from staying
 * half open: its undo step is committed and the listeners go.
 */
export function followPointer(target: EventTarget, move: (m: PointerEvent) => void, end?: (m: PointerEvent) => void): void {
  const stop = (m: Event) => {
    target.removeEventListener('pointermove', move as EventListener);
    target.removeEventListener('pointerup', stop);
    target.removeEventListener('pointercancel', stop);
    end?.(m as PointerEvent);
  };
  target.addEventListener('pointermove', move as EventListener);
  target.addEventListener('pointerup', stop);
  target.addEventListener('pointercancel', stop);
}
