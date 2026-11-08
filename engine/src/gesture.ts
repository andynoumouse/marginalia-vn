// Touch gestures on the stage (docs/design/mobile.md, step 2): a finished touch path to the thing it means.
// Pure: the page records where a touch started and ended and passes the numbers in. Distances are CSS pixels, not stage
// pixels, so a gesture feels the same at any window size.

export type Gesture = 'tap' | 'swipe-left' | 'swipe-right' | 'swipe-up' | 'swipe-down' | 'two-finger-tap';

export interface Stroke {
  /** Where the touch ended, relative to where it began. */
  dx: number;
  dy: number;
  /** From the first finger down to the last one up. */
  ms: number;
  /** The most fingers down at once. */
  fingers: number;
}

/** A touch that moves less than this is a tap (or a hold). */
export const TAP_SLOP = 12;
/** A swipe covers at least this far, and no slower than SWIPE_MAX_MS. */
export const SWIPE_MIN = 56;
export const SWIPE_MAX_MS = 800;
/** A swipe is mostly along one axis: the long side is at least this many times the short one. */
export const SWIPE_AXIS = 1.6;
/** A finger held still this long is a long press (the page fires it from a timer, before the finger lifts). */
export const LONG_PRESS_MS = 550;
/** Two fingers that come and go within this are a two-finger tap. */
export const TWO_FINGER_MS = 350;

/** What a finished touch means, or null when it was a drag that is neither a tap nor a clean swipe (a slow or diagonal one). */
export function classifyStroke(s: Stroke): Gesture | null {
  const dist = Math.hypot(s.dx, s.dy);
  if (s.fingers >= 2) return dist <= TAP_SLOP * 2 && s.ms <= TWO_FINGER_MS ? 'two-finger-tap' : null;
  if (dist <= TAP_SLOP) return s.ms < LONG_PRESS_MS ? 'tap' : null; // a long hold is the page's timer's business
  if (dist < SWIPE_MIN || s.ms > SWIPE_MAX_MS) return null;
  const ax = Math.abs(s.dx), ay = Math.abs(s.dy);
  if (ax >= ay * SWIPE_AXIS) return s.dx > 0 ? 'swipe-right' : 'swipe-left';
  if (ay >= ax * SWIPE_AXIS) return s.dy > 0 ? 'swipe-down' : 'swipe-up';
  return null;
}

/** Whether a touch that moved this far since it began is still a press that could become a long press. */
export function stillForLongPress(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) <= TAP_SLOP;
}

/** game.json "touch": gestures are on unless the project turns them off. */
export interface TouchSettings { gestures: boolean }

export function touchSettings(raw: unknown): TouchSettings {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return { gestures: o.gestures !== false };
}

/** Problems with game.json "touch" for the Problems list. */
export function touchProblems(raw: unknown): string[] {
  if (raw === undefined) return [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ['"touch" must be an object, e.g. { "gestures": false }'];
  return Object.entries(raw as Record<string, unknown>).flatMap(([k, v]) =>
    k !== 'gestures' ? [`"touch": unknown key "${k}" (only "gestures")`] : typeof v !== 'boolean' ? ['"touch.gestures" must be true or false'] : []);
}
