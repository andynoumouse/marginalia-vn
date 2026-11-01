// Seeded random numbers (mulberry32). The generator state is one 32-bit integer that lives in the Runtime, so a
// restore, rollback, hot reload or save replays exactly the same draws. Nothing here touches Math.random.

/** One draw from `state`: a float in [0, 1) and the next state. */
export function randomStep(state: number): { value: number; state: number } {
  const s = (state + 0x6D2B79F5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, state: s };
}

/** A source of draws that advances some stored state. */
export interface Rng { next(): number }

/** A fresh seed for a new playthrough (the one place where the clock is used). */
let seeds = 0;
export function newSeed(): number {
  return (Date.now() ^ Math.imul(++seeds, 0x9E3779B1)) >>> 0;
}
