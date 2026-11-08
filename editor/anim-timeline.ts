// The animation studio's timeline: one lane per key channel with the sampled curve, the key diamonds and a time axis,
// drawn into an SVG, plus the geometry the pointer handlers need to turn a position back into a time and a value.

import { CHANNEL_REST, KEY_CHANNELS, keysOf, sampleChannel, type AnimDef, type FrameBlock, type KeyChannel, type ParamKey } from '../engine/src/index.js';
import { svg } from './anim-dom.js';

export const LANE = 52, AXIS = 22, LABEL = 70, PAD = 14;
/** The height of a parameter track's lane; the parameter lanes sit under the four channel lanes. */
export const PLANE = 44;
export const paramLaneTop = (i: number) => LANE * KEY_CHANNELS.length + i * PLANE;
/** Which parameter lane (index) is under height `y`, or -1 when `y` is over the channel lanes or below the last of `n`. */
export const paramLaneAt = (y: number, n: number) => { const i = Math.floor((y - LANE * KEY_CHANNELS.length) / PLANE); return y >= LANE * KEY_CHANNELS.length && i < n ? i : -1; };
/** The parameter value (from `min` to `max`) under height `y` in lane `i`. */
export const paramValueAt = (i: number, y: number, min: number, max: number) =>
  Math.min(max, Math.max(min, max - ((y - paramLaneTop(i) - 6) / (PLANE - 12)) * (max - min)));
/** The height of a frame track's row of blocks; the rows sit under the parameter lanes. */
export const FLANE = 34;
export const frameLaneTop = (i: number, params: number) => LANE * KEY_CHANNELS.length + PLANE * params + i * FLANE;
/** Which frame row (index) is under height `y`, or -1, given `params` parameter lanes and `n` frame rows. */
export const frameLaneAt = (y: number, params: number, n: number) => { const i = Math.floor((y - frameLaneTop(0, params)) / FLANE); return y >= frameLaneTop(0, params) && i < n ? i : -1; };
/** The smallest range a lane shows, so a tiny value does not fill it. */
const MIN_RANGE: Record<KeyChannel, number> = { x: 0.02, y: 0.02, scale: 0.02, rot: 2, opacity: 0.5 };
/** How much an arrow key changes a channel. */
export const NUDGE: Record<KeyChannel, number> = { x: 0.005, y: 0.005, scale: 0.005, rot: 0.5, opacity: 0.05 };

export const timelineWidth = (tl: SVGSVGElement) => Math.max(320, tl.clientWidth);
export const xOf = (tl: SVGSVGElement, t: number) => LABEL + t * (timelineWidth(tl) - LABEL - PAD);
export const laneOf = (y: number) => Math.min(KEY_CHANNELS.length - 1, Math.max(0, Math.floor(y / LANE)));
/** The channel value under height `y` in its lane, for a lane that shows +-`range` around the channel's rest value (opacity never goes below 0). */
export function valueAt(ch: KeyChannel, y: number, range: number) {
  const i = KEY_CHANNELS.indexOf(ch), mid = i * LANE + LANE / 2;
  const v = CHANNEL_REST[ch] + ((mid - y) / (LANE / 2 - 8)) * range;
  return ch === 'opacity' ? Math.max(0, v) : v;
}
/** A pointer position over the timeline: pixels, and the time 0..1 along the lanes. */
export function localPoint(tl: SVGSVGElement, e: PointerEvent | MouseEvent) {
  const r = tl.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top, t: Math.min(1, Math.max(0, (e.clientX - r.left - LABEL) / Math.max(1, r.width - LABEL - PAD))) };
}

/** What the timeline shows. `ranges` is filled with the range each lane ended up with (the pointer handlers read it back). */
export interface TimelineView {
  def: AnimDef;
  dur: number;
  preset: boolean;
  editable: boolean;
  part: string | null;
  sel: number | null;
  frozen: Partial<Record<KeyChannel, number>> | null;
  ranges: Record<KeyChannel, number>;
  /** One lane per parameter the animation keys, under the channel lanes. */
  tracks: { id: string; min: number; max: number; keys: ParamKey[]; samples: number[] }[];
  selParam: { id: string; index: number } | null;
  /** One row per frame track, under the parameter lanes: a block per held frame. */
  frames: { slot: string; blocks: FrameBlock[] }[];
  selFrame: { slot: string; index: number } | null;
}

/** Redraw `tl`; returns the playhead line (the caller moves it with the time). */
export function drawTimeline(tl: SVGSVGElement, v: TimelineView): SVGLineElement {
  const w = timelineWidth(tl), height = LANE * KEY_CHANNELS.length + PLANE * v.tracks.length + FLANE * v.frames.length + AXIS;
  tl.setAttribute('viewBox', `0 0 ${w} ${height}`);
  tl.setAttribute('height', String(height));
  tl.replaceChildren();
  const def = v.def;
  KEY_CHANNELS.forEach((ch, i) => {
    const top = i * LANE, mid = top + LANE / 2;
    const samples = sampleChannel(def, ch, v.part, 120);
    // A preset is only a sampled copy: its curve is shown, but no diamonds that look as if they could be moved.
    const keys = v.preset ? [] : keysOf(def, v.part).filter(k => typeof k.key[ch] === 'number');
    const rest = CHANNEL_REST[ch];
    const own = Math.max(MIN_RANGE[ch], ...samples.map(x => Math.abs(x - rest)), ...keys.map(k => Math.abs(k.key[ch]! - rest)));
    const range = v.frozen?.[ch] ?? own;
    v.ranges[ch] = range;
    const y = (val: number) => mid - ((val - rest) / range) * (LANE / 2 - 8);
    tl.append(
      svg('rect', { x: 0, y: top, width: w, height: LANE, class: i % 2 ? 'tl-bg-b' : 'tl-bg-a' }),
      svg('line', { x1: LABEL, x2: w - PAD, y1: mid, y2: mid, class: 'tl-zero' }),
      svg('text', { x: 8, y: mid - 2, class: 'tl-label' }, ch),
      svg('text', { x: 8, y: mid + 12, class: 'tl-range' }, `${rest ? `${rest} ` : ''}±${+range.toPrecision(2)}`),
      svg('polyline', { points: samples.map((val, s) => `${xOf(tl, s / 120)},${y(val)}`).join(' '), class: 'tl-curve' }),
    );
    for (const k of keys) {
      const on = k.index === v.sel;
      const d = svg('rect', {
        x: -5, y: -5, width: 10, height: 10, class: on ? 'tl-key tl-on' : 'tl-key', transform: `translate(${xOf(tl, k.key.t)} ${y(k.key[ch]!)}) rotate(45)`,
        'data-key': k.index, 'data-ch': ch, tabindex: on ? 0 : -1, role: 'button',
        'aria-label': `${ch} key at t ${k.key.t}, value ${k.key[ch]}${v.editable ? '. Arrows move it, Delete removes it' : ''}`,
      });
      d.append(svg('title', {}, `${ch} ${k.key[ch]} at t=${k.key.t}${k.key.ease ? `, ease ${k.key.ease}` : ''}`));
      tl.append(d);
    }
  });
  v.tracks.forEach((tr, i) => {
    const top = paramLaneTop(i), y = (val: number) => top + 6 + (1 - (val - tr.min) / (tr.max - tr.min)) * (PLANE - 12);
    tl.append(
      svg('rect', { x: 0, y: top, width: w, height: PLANE, class: 'tl-bg-p' }),
      svg('text', { x: 8, y: top + 16, class: 'tl-label' }, tr.id.length > 9 ? `${tr.id.slice(0, 8)}…` : tr.id),
      svg('text', { x: 8, y: top + 30, class: 'tl-range' }, `${+tr.min.toPrecision(2)}…${+tr.max.toPrecision(2)}`),
      svg('polyline', { points: tr.samples.map((val, s) => `${xOf(tl, s / (tr.samples.length - 1))},${y(val)}`).join(' '), class: 'tl-curve tl-pcurve' }),
    );
    if (v.preset) return;
    tr.keys.forEach((k, index) => {
      const on = v.selParam?.id === tr.id && v.selParam.index === index;
      const d = svg('rect', {
        x: -5, y: -5, width: 10, height: 10, class: on ? 'tl-key tl-pkey tl-on' : 'tl-key tl-pkey', transform: `translate(${xOf(tl, k.t)} ${y(k.v)}) rotate(45)`,
        'data-pkey': index, 'data-param': tr.id, tabindex: on ? 0 : -1, role: 'button',
        'aria-label': `${tr.id} key at t ${k.t}, value ${k.v}${v.editable ? '. Arrows move it, Delete removes it' : ''}`,
      });
      d.append(svg('title', {}, `${tr.id} ${k.v} at t=${k.t}${k.ease ? `, ease ${k.ease}` : ''}`));
      tl.append(d);
    });
  });
  v.frames.forEach((row, i) => {
    const top = frameLaneTop(i, v.tracks.length);
    tl.append(
      svg('rect', { x: 0, y: top, width: w, height: FLANE, class: 'tl-bg-f' }),
      svg('text', { x: 8, y: top + 14, class: 'tl-label' }, row.slot.length > 9 ? `${row.slot.slice(0, 8)}…` : row.slot),
      svg('text', { x: 8, y: top + 27, class: 'tl-range' }, 'frames'),
    );
    for (const b of row.blocks) {
      const x0 = xOf(tl, b.from), x1 = Math.max(x0 + 2, xOf(tl, b.to)), on = v.selFrame?.slot === row.slot && v.selFrame.index === b.index;
      const g = svg('g', { class: on ? 'tl-fblock tl-on' : 'tl-fblock', 'data-fkey': b.index, 'data-fslot': row.slot, tabindex: on ? 0 : -1, role: 'button',
        'aria-label': `${row.slot} frame ${b.frame} from t ${b.from}${v.editable ? '. Arrows move it, Delete removes it' : ''}` });
      g.append(svg('title', {}, `${row.slot}: ${b.frame} from t=${b.from}`),
        svg('rect', { x: x0, y: top + 3, width: x1 - x0 - 1, height: FLANE - 6, rx: 3, class: b.frame === 'none' ? 'tl-fnone' : 'tl-fbody' }));
      if (x1 - x0 > 16) g.append(svg('text', { x: x0 + 4, y: top + FLANE / 2 + 4, class: 'tl-ftext' }, b.frame));
      tl.append(g);
    }
  });
  const dur = v.dur, base = LANE * KEY_CHANNELS.length + PLANE * v.tracks.length + FLANE * v.frames.length;
  if (v.editable && !keysOf(def, v.part).length && !v.tracks.length) {
    tl.append(svg('text', { x: xOf(tl, 0.5), y: base / 2, class: 'tl-empty', 'text-anchor': 'middle' }, 'No keys yet. Double-click a lane to add one, then drag it.'));
  }
  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    const x = xOf(tl, f);
    tl.append(svg('line', { x1: x, x2: x, y1: 0, y2: base + 4, class: 'tl-grid' }),
      svg('text', { x, y: base + 16, class: 'tl-tick', 'text-anchor': f === 1 ? 'end' : f === 0 ? 'start' : 'middle' }, `${+(f * dur).toFixed(2)}s`));
  }
  const playLine = svg('line', { x1: 0, x2: 0, y1: 0, y2: base, class: 'tl-play' });
  tl.append(playLine);
  return playLine;
}
