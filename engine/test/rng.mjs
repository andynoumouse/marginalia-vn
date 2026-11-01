// Seeded generators for tests: varied values (like a real rng) but the same sequence on every run, so failures reproduce.
// Assert properties (format, uniqueness) rather than exact values; a constant generator is only for degenerate-input tests.
export const seededRng = seed => { let s = seed; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };
/** The `{ next }` shape the engine's random functions take. */
export const seededDraw = seed => ({ next: seededRng(seed) });
