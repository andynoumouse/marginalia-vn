// The small state machines behind a character that is alive without the script saying so (rig.json `idle`, `speak`,
// `blink`): when to blink and which mouth variant to show while talking. Pure, so the renderer only feeds in time.

export interface BlinkState { closed: boolean; wait: number }

/** A random wait in seconds from `every` ([min, max]); `rand` returns 0-1. */
export const blinkWait = (every: readonly [number, number], rand: () => number): number => every[0] + (every[1] - every[0]) * rand();

/** The first state of a character that has just appeared: eyes open, a wait until the first blink. */
export const startBlink = (every: readonly [number, number], rand: () => number): BlinkState => ({ closed: false, wait: blinkWait(every, rand) });

/** Advance `dt` seconds: eyes close when the wait runs out, stay closed for `dur`, then open for another random wait. */
export function stepBlink(st: BlinkState, dt: number, def: { every: readonly [number, number]; dur: number }, rand: () => number): BlinkState {
  const wait = st.wait - dt;
  if (wait > 0) return { closed: st.closed, wait };
  return st.closed ? { closed: false, wait: blinkWait(def.every, rand) } : { closed: true, wait: def.dur };
}

/** The mouth variant `elapsed` seconds into a line, cycling through `variants` at `rate` changes per second. */
export function mouthFrame(variants: readonly string[], elapsed: number, rate: number): string | null {
  if (!variants.length) return null;
  return variants[Math.floor(Math.max(0, elapsed) * rate) % variants.length];
}
