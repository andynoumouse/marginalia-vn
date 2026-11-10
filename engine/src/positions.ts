import { isNum } from './util.js';
// Named stage positions: the built-in left, center and right plus the project's own from game.json "positions"
// (`"positions": { "farleft": 0.08, "balcony": { "x": 0.7, "y": -0.15 } }`). The scripts are compiled with the table,
// so a name is turned into its numbers while parsing and the runtime only ever sees numbers.

/** `x` across the stage (0-1); `y` is the default height offset of `show` and `move` (a line's own `y=` wins). */
export interface Position { x: number; y?: number }
export type Positions = Record<string, Position>;

export const BUILTIN_POSITIONS: Positions = { left: { x: 0.2 }, center: { x: 0.5 }, right: { x: 0.8 } };

const NAME = /^[A-Za-z_]\w*$/;
/** Words that mean something else after `at`/`to` or elsewhere on the line. */
const RESERVED = new Set(['nowait', 'fade', 'loop', 'stop', 'reset', 'zoom', 'pan']);

/** Why a game.json `positions` entry is unusable, or null when it is fine. */
export function positionProblem(name: string, value: unknown): string | null {
  if (!NAME.test(name)) return `positions: "${name}" is not a usable name (letters, digits and _; not starting with a digit)`;
  if (RESERVED.has(name)) return `positions: "${name}" is a script keyword`;
  if (isNum(value)) return null;
  const v = value as { x?: unknown; y?: unknown } | null;
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    if (!isNum(v.x)) return `positions: "${name}" needs "x" as a number (0 = left edge, 1 = right edge)`;
    if (v.y !== undefined && !isNum(v.y)) return `positions: "${name}" has a "y" that is not a number (negative lifts the character)`;
    return null;
  }
  return `positions: "${name}" needs a number (0 = left edge, 1 = right edge) or { "x": number, "y": number }`;
}

/** The built-in positions plus the valid entries of `game.positions`; a project entry replaces a built-in of the same name. */
export function namedPositions(game: unknown): Positions {
  const out: Positions = { ...BUILTIN_POSITIONS };
  const own = (game as { positions?: unknown } | null | undefined)?.positions;
  if (own && typeof own === 'object' && !Array.isArray(own)) {
    for (const [name, value] of Object.entries(own)) {
      if (positionProblem(name, value) !== null) continue;
      out[name] = isNum(value) ? { x: value } : { x: (value as Position).x, ...((value as Position).y !== undefined && { y: (value as Position).y }) };
    }
  }
  return out;
}
