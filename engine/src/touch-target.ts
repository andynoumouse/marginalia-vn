// Making small buttons usable under a finger (docs/design/mobile.md, step 3). Pure: the page measures a group of buttons in stage
// pixels and the window's scale, and gets back how much to enlarge the group.

import type { StageSize } from './stage.js';

/** The smallest height a dense bar's buttons should have on a touch screen, in CSS pixels (WCAG 2.2 asks 24, platform guides 44-48). */
export const BAR_TARGET_CSS = 32;
/** A bar is never enlarged more than this, however small the window is. */
export const MAX_BOOST = 2;

export interface Extent { left: number; right: number; top: number; bottom: number }

/** The point a quick bar placed at `place` (top, bottom, topleft, ... bottomright) grows from, as fractions of the stage. */
export function boostOrigin(place: string): [number, number] {
  const fx = place.endsWith('left') ? 0 : place.endsWith('right') ? 1 : 0.5;
  const fy = place.startsWith('top') ? 0 : 1;
  return [fx, fy];
}

/**
 * The scale factor (1 to MAX_BOOST) that brings a group of buttons whose tallest is `height` stage pixels to `minCss` CSS pixels at
 * the window's `scale`, kept small enough that the enlarged group (growing from `origin`) stays inside the stage.
 */
export function barBoost(scale: number, height: number, extent: Extent, stage: StageSize, origin: [number, number], minCss = BAR_TARGET_CSS): number {
  if (!(scale > 0) || !(height > 0)) return 1;
  let k = Math.min(MAX_BOOST, minCss / (height * scale));
  const ox = origin[0] * stage.width, oy = origin[1] * stage.height;
  const room = (lo: number, hi: number, o: number, size: number) => {
    if (lo < o && o > 0) k = Math.min(k, o / (o - lo));
    if (hi > o && size - o > 0) k = Math.min(k, (size - o) / (hi - o));
  };
  room(extent.left, extent.right, ox, stage.width);
  room(extent.top, extent.bottom, oy, stage.height);
  return Math.max(1, k);
}

export interface TouchBox { x: number; y: number; w: number; h: number }

/** The smallest target side on a touch screen, in CSS pixels (platform guides ask 44-48). */
export const TOUCH_MIN_CSS = 44;

/**
 * Which button a touch at (x, y) means, given the buttons' boxes (all in the same unit, say CSS pixels), or -1. A touch inside a
 * button is that button (the last one listed wins an overlap: it is drawn on top). Otherwise each button counts as at least
 * `minSide` wide and tall around its centre, and the nearest centre among the buttons that cover the touch wins, so a thumb that
 * lands in the gap beside a small button still presses it, and a direct hit on a neighbour is never stolen.
 */
export function resolveTouch(x: number, y: number, boxes: TouchBox[], minSide = TOUCH_MIN_CSS): number {
  for (let i = boxes.length - 1; i >= 0; i--) {
    const b = boxes[i];
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return i;
  }
  let best = -1, bestDist = Infinity;
  boxes.forEach((b, i) => {
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2, hw = Math.max(b.w, minSide) / 2, hh = Math.max(b.h, minSide) / 2;
    if (Math.abs(x - cx) > hw || Math.abs(y - cy) > hh) return;
    const d = Math.hypot(x - cx, y - cy);
    if (d < bestDist) { best = i; bestDist = d; }
  });
  return best;
}

/** The smallest dialogue text on a touch screen, in CSS pixels. */
export const TEXT_MIN_CSS = 16;

/**
 * The multiplier (1 or more) that keeps text of `stagePx` stage pixels at no less than `minCss` CSS pixels in a window scaled by
 * `scale`. Capped at 1.5 so a tiny window does not fill the text box with a few big words.
 */
export function textFloor(scale: number, stagePx: number, minCss = TEXT_MIN_CSS): number {
  if (!(scale > 0) || !(stagePx > 0)) return 1;
  return Math.min(1.5, Math.max(1, minCss / (stagePx * scale)));
}
