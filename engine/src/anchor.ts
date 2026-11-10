import { isNum } from './util.js';
// Sprite anchors: the point a character scales, turns and mirrors about, as fractions of its own size
// (0,0 top left, 1,1 bottom right). `x`/`y` of a character still say where its feet stand at rest.

export type Anchor = [number, number];

export const FEET: Anchor = [0.5, 1];
export const ANCHORS: Record<string, Anchor> = { feet: FEET, center: [0.5, 0.5], head: [0.5, 0.1], top: [0.5, 0] };

export type Anchors = Record<string, Anchor>;

/** `anchor=` value: a name from `names` or `<fx>,<fy>`. Throws a message listing the names when it is neither. */
export function parseAnchor(tok: string, names: Anchors = ANCHORS): Anchor {
  const named = Object.hasOwn(names, tok) ? names[tok] : undefined;
  if (named) return [named[0], named[1]];
  const m = /^(-?\d*\.?\d+),(-?\d*\.?\d+)$/.exec(tok);
  if (m) return [Number(m[1]), Number(m[2])];
  throw new Error(`anchor= takes ${Object.keys(names).join(', ')} or two fractions like 0.5,0.3 (more in game.json "anchors")`);
}

const NAME = /^[A-Za-z_]\w*$/;

/** Why a game.json `anchors` entry is unusable, or null when it is fine. */
export function anchorProblem(name: string, value: unknown): string | null {
  if (!NAME.test(name)) return `anchors: "${name}" is not a usable name (letters, digits and _; not starting with a digit)`;
  if (Array.isArray(value) && value.length === 2 && value.every(isNum)) return null;
  return `anchors: "${name}" needs [fx, fy], two fractions of the sprite (0,0 top left, 1,1 bottom right)`;
}

/** The built-in anchors plus the valid entries of `game.anchors`; a project entry replaces a built-in of the same name. */
export function namedAnchors(game: unknown): Anchors {
  const out: Anchors = { ...ANCHORS };
  const own = (game as { anchors?: unknown } | null | undefined)?.anchors;
  if (own && typeof own === 'object' && !Array.isArray(own)) {
    for (const [name, value] of Object.entries(own)) {
      if (anchorProblem(name, value) === null) out[name] = [(value as number[])[0], (value as number[])[1]];
    }
  }
  return out;
}

/** The `anchor=` value for `a`: a built-in name when it matches one, else `<fx>,<fy>` (rounded to 3 places). */
export function anchorToken(a: Anchor, names: Anchors = ANCHORS): string {
  const r = (v: number) => Math.round(v * 1000) / 1000;
  const name = Object.entries(names).find(([, v]) => v[0] === r(a[0]) && v[1] === r(a[1]))?.[0];
  return name ?? `${r(a[0])},${r(a[1])}`;
}

/** Where the anchor sits relative to the feet, in pixels of a sprite `w` x `h` (y downwards). */
export function anchorOffset(a: Anchor, w: number, h: number): { x: number; y: number } {
  return { x: (a[0] - 0.5) * w, y: (a[1] - 1) * h };
}
