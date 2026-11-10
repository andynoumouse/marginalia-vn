// Fitting the stage into a window, and what a notch or a rounded corner takes from it (docs/design/mobile.md, step 1).
// Pure: the page reads the window size and the CSS safe-area insets and passes them in.

import type { StageSize } from './stage.js';

export interface Insets { top: number; right: number; bottom: number; left: number }

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/** The scale that fits the whole stage in a window (letterboxed). */
export function fitScale(vw: number, vh: number, stage: StageSize): number {
  return Math.min(vw / stage.width, vh / stage.height);
}

/**
 * The safe-area insets (CSS pixels at the window's edges) as stage pixels: only the part of an inset that the stage
 * actually reaches counts, since the letterbox bars already cover the rest. With no insets, or a window much wider or
 * taller than the stage, the result is all zeros.
 */
export function stageInsets(vw: number, vh: number, stage: StageSize, insets: Insets): Insets {
  const s = fitScale(vw, vh, stage);
  if (!(s > 0)) return NO_INSETS;
  const barX = (vw - stage.width * s) / 2, barY = (vh - stage.height * s) / 2;
  const px = (inset: number, bar: number) => Math.max(0, inset - bar) / s;
  return { top: px(insets.top, barY), right: px(insets.right, barX), bottom: px(insets.bottom, barY), left: px(insets.left, barX) };
}

/** Below this many CSS px on its short side, a stage fitted into a window held the wrong way is too small to play. */
export const ROTATE_BELOW = 400;

/**
 * True when a touch device is held the wrong way for the stage (a landscape game in a portrait window, or the reverse) and
 * the stage would be too small that way: a phone gets the cover, a tablet (a 1920x1080 stage is 768x432 on a 768x1024 one) plays.
 */
export function needsRotate(vw: number, vh: number, stage: StageSize, coarse: boolean): boolean {
  if (!coarse || stage.width === stage.height) return false;
  if ((stage.width > stage.height) === (vw > vh) || vw === vh) return false;
  return Math.min(stage.width, stage.height) * fitScale(vw, vh, stage) < ROTATE_BELOW;
}
