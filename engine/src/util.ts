// Small helpers shared across the engine and the editor.

/** Escape text for HTML content and double-quoted attributes. */
export const esc = (s: string): string => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** A plain JSON object (not null, not an array). */
export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A finite number. */
export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));

/** "1 file", "3 files" (`many` for an irregular plural). */
export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** `base`, else `base<sep>2`, `base<sep>3`... the first name not in `taken`. */
export function freeName(taken: Iterable<string>, base: string, sep = ''): string {
  const used = new Set(taken);
  let name = base;
  for (let i = 2; used.has(name); i++) name = `${base}${sep}${i}`;
  return name;
}

/** `n` rounded to 5 decimals, as rig.json stores parameter values and displacements; `+ 0` turns -0 into 0. */
export const round5 = (n: number): number => Math.round(n * 1e5) / 1e5 + 0;
/** `n` rounded to 4 decimals: what key times and key values are stored at. */
export const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
/** Two key times (0-1) closer than this are the same time. */
export const SAME_TIME = 0.0005;
/** A copy of `keys` sorted by time. */
export const byTime = <K extends { t: number }>(keys: readonly K[]): K[] => [...keys].sort((a, b) => a.t - b.t);
