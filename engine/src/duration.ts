// Durations in scripts carry their unit: `2s`, `0.25s`, `250ms` (docs/design/time-units.md). A bare number where a duration goes is
// an error that says how to write it. Pure; the parser, transforms and the `{pause=}` text tag share it.

const DURATION = /^(\d+(?:\.\d+)?|\.\d+)(ms|s)$/;

/** The seconds a duration token stands for (`2s` 2, `250ms` 0.25), or null when `tok` is not a duration with its unit. */
export function durationOf(tok: string | undefined): number | null {
  const m = DURATION.exec(tok ?? '');
  return m ? Number(m[1]) / (m[2] === 'ms' ? 1000 : 1) : null;
}

export const isDuration = (tok: string | undefined): boolean => durationOf(tok) !== null;

/** A bare number (`2`, `0.5`): what used to be a duration, now an error in a duration's place. */
export const isBareNumber = (tok: string | undefined): boolean => tok !== undefined && tok !== '' && Number.isFinite(Number(tok));

/** The message for a bare number where a duration goes. */
export const unitMessage = (tok: string): string => `A duration needs its unit: write ${tok}s (or ${Math.round(Number(tok) * 1000)}ms), not ${tok}`;

/**
 * Reads a duration token where only a duration can go. Returns its seconds, and throws (with `fail` building the error) for a bare
 * number, saying to add the unit, or for anything else, naming `what`.
 */
export function readDuration(tok: string | undefined, what: string, fail: (message: string) => Error = m => new Error(m)): number {
  const d = durationOf(tok);
  if (d !== null) return d;
  if (tok?.startsWith('-') && (isBareNumber(tok) || durationOf(tok.slice(1)) !== null)) throw fail(`A duration cannot be negative (${tok})`);
  if (isBareNumber(tok)) throw fail(unitMessage(tok!));
  throw fail(`Expected ${what} like 0.5s or 500ms${tok === undefined ? '' : `, not "${tok}"`}`);
}
