// Small helpers shared across the engine and the editor.

/** Escape text for HTML content and double-quoted attributes. */
export const esc = (s: string): string => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** A plain JSON object (not null, not an array). */
export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A finite number. */
export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));
