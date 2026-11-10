// The rows of the animation studio's timeline, top to bottom: one lane per key channel (folded to a thin row while it has no
// key, so keyed parameter lanes stay in view), one lane per keyed parameter, one row per frame track.

import { KEY_CHANNELS, type AnimDef, type KeyChannel } from './anim.js';
import { keysOf } from './anim-edit.js';

/** Heights: an open channel lane, a folded one, a parameter lane, a frame row. */
export const LANE = 52, FOLD = 18, PLANE = 44, FLANE = 34;

export type TimelineRow =
  | { kind: 'channel'; ch: KeyChannel; folded: boolean; top: number; height: number }
  | { kind: 'param'; index: number; top: number; height: number }
  | { kind: 'frame'; index: number; top: number; height: number };

export interface TimelineRows { rows: TimelineRow[]; /** the lanes' total height */ height: number }

/**
 * The channels to fold for the body (`part` null) or one part: those without a key, once anything is keyed for what the timeline
 * shows (a channel of the target, a parameter or a frame track). With nothing keyed every lane stays open for the first double-click.
 */
export function foldedChannels(def: AnimDef, part: string | null, params: number, frames: number): KeyChannel[] {
  const keys = keysOf(def, part);
  if (!keys.length && !params && !frames) return [];
  return KEY_CHANNELS.filter(ch => !keys.some(k => Number.isFinite(k.key[ch])));
}

/** The rows for the channels in `folded` folded, then `params` parameter lanes and `frames` frame rows. */
export function timelineRows(folded: readonly KeyChannel[], params: number, frames: number): TimelineRows {
  const rows: TimelineRow[] = [];
  let top = 0;
  for (const ch of KEY_CHANNELS) {
    const f = folded.includes(ch), height = f ? FOLD : LANE;
    rows.push({ kind: 'channel', ch, folded: f, top, height });
    top += height;
  }
  for (let index = 0; index < params; index++) { rows.push({ kind: 'param', index, top, height: PLANE }); top += PLANE; }
  for (let index = 0; index < frames; index++) { rows.push({ kind: 'frame', index, top, height: FLANE }); top += FLANE; }
  return { rows, height: top };
}

/** The row under height `y`, or null below the last one. */
export const rowAt = (r: TimelineRows, y: number): TimelineRow | null => r.rows.find(row => y >= row.top && y < row.top + row.height) ?? null;
