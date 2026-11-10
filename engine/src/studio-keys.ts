// The animation studio's keys outside the stage, and where focus goes after a redraw: what Esc does in the dialog, where Ctrl+Z
// goes from a field, and which control takes the focus back when a panel redraws the one that had it. The stage page has its own
// keys (preview/studio-gizmo.ts) and hands the studio the ones it does not use. See docs/design/ux-test-2026-11-studio/summary.md.

import { isDeformMode, stageMode, type StageTool } from './studio-stage.js';

/**
 * What Esc does in the studio's side columns and its tool options bar, in this order (an open popover of the bar takes its own Esc
 * first): an edit typed into a field and not committed yet is put back; with a deform tool on (Warp, Weights, Mask) and the stage there,
 * the stage takes it, which clears the tool's selection or goes back to Move; any other tool but Move goes back to Move; on Move the
 * studio closes.
 */
export type DialogEscape = 'revert' | 'stage' | 'move' | 'close';
export const dialogEscape = (fieldDirty: boolean, tool: StageTool, stage: boolean): DialogEscape =>
  (fieldDirty ? 'revert' : stage && isDeformMode(stageMode(tool)) ? 'stage' : tool !== 'move' ? 'move' : 'close');

/** Esc that reached the tool row (from the stage with nothing left to clear, or from the side columns): every tool but Move steps back to Move. */
export const escapesToMove = (tool: StageTool): boolean => tool !== 'move';

/** Ctrl+Z (or Ctrl+Y) from a field with an edit not committed yet undoes the typing, as a text field does; otherwise it is the studio's undo, wherever focus is. */
export const undoInField = (fieldDirty: boolean): boolean => fieldDirty;

/** A control as the focus keeper knows it: what identifies it (its kind, data, name and text) and whether it can take focus now. */
export interface FocusSlot { sig: string; usable: boolean }

/**
 * Which control takes the focus back after a redraw replaced the one that had it (`sig`, at `index` among the focusable controls of
 * its section before): the usable control with the same signature (the nearest to `index` when there are several), else the usable
 * one at `index` or the nearest before it, else -1.
 */
export function refocusIndex(sig: string, index: number, after: readonly FocusSlot[]): number {
  let best = -1;
  after.forEach((s, i) => { if (s.usable && s.sig === sig && (best < 0 || Math.abs(i - index) < Math.abs(best - index))) best = i; });
  if (best >= 0) return best;
  for (let i = Math.min(index, after.length - 1); i >= 0; i--) if (after[i].usable) return i;
  for (let i = Math.max(0, index + 1); i < after.length; i++) if (after[i].usable) return i;
  return -1;
}
