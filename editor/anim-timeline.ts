// The animation studio's timeline: one lane per key channel with the sampled curve, the key diamonds and a time axis,
// drawn into an SVG, plus the geometry the pointer handlers need to turn a position back into a time and a value.

import { CHANNEL_REST, KEY_CHANNELS, foldedChannels, keysOf, restEnds, rowAt, sampleChannel, timeLabel, timelineRows, FLANE, LANE, PLANE, type AnimDef, type FrameBlock, type KeyChannel, type ParamKey, type TimelineRows } from '../engine/src/index.js';
import { svg } from './anim-dom.js';

export const AXIS = 22, LABEL = 70, PAD = 14;
/** The rows each timeline was last drawn with (the pointer handlers turn a height back into a lane with them). */
const drawn = new WeakMap<SVGSVGElement, TimelineRows>();
export const drawnRows = (tl: SVGSVGElement) => drawn.get(tl) ?? timelineRows([], 0, 0);
const paramTop = (tl: SVGSVGElement, i: number) => drawnRows(tl).rows.find(r => r.kind === 'param' && r.index === i)?.top ?? 0;
/** Which parameter lane (index) is under height `y`, or -1. */
export const paramLaneAt = (tl: SVGSVGElement, y: number) => { const r = rowAt(drawnRows(tl), y); return r?.kind === 'param' ? r.index : -1; };
/** The parameter value (from `min` to `max`) under height `y` in lane `i`. */
export const paramValueAt = (tl: SVGSVGElement, i: number, y: number, min: number, max: number) =>
  Math.min(max, Math.max(min, max - ((y - paramTop(tl, i) - 6) / (PLANE - 12)) * (max - min)));
/** Which frame row (index) is under height `y`, or -1. */
export const frameLaneAt = (tl: SVGSVGElement, y: number) => { const r = rowAt(drawnRows(tl), y); return r?.kind === 'frame' ? r.index : -1; };
/** The channel lane under height `y` and whether it is folded, or null over the parameter and frame rows. */
export function channelAt(tl: SVGSVGElement, y: number): { ch: KeyChannel; folded: boolean } | null {
  const r = rowAt(drawnRows(tl), y);
  return r?.kind === 'channel' ? { ch: r.ch, folded: r.folded } : null;
}
/** The smallest range a lane shows, so a tiny value does not fill it. */
const MIN_RANGE: Record<KeyChannel, number> = { x: 0.02, y: 0.02, scale: 0.02, rot: 2, opacity: 0.5 };
/** How much an arrow key changes a channel. */
export const NUDGE: Record<KeyChannel, number> = { x: 0.005, y: 0.005, scale: 0.005, rot: 0.5, opacity: 0.05 };

export const timelineWidth = (tl: SVGSVGElement) => Math.max(320, tl.clientWidth);
export const xOf = (tl: SVGSVGElement, t: number) => LABEL + t * (timelineWidth(tl) - LABEL - PAD);
/** The channel value under height `y` in its lane, for a lane that shows +-`range` around the channel's rest value (opacity never goes below 0). */
export function valueAt(tl: SVGSVGElement, ch: KeyChannel, y: number, range: number) {
  const row = drawnRows(tl).rows.find(r => r.kind === 'channel' && r.ch === ch)!, mid = row.top + LANE / 2;
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

/** Redraw `tl` and its time ruler `ruler` (kept in view over the lanes); returns the playhead lines (the caller moves them with the time). */
export function drawTimeline(tl: SVGSVGElement, ruler: SVGSVGElement, v: TimelineView): SVGLineElement[] {
  const def = v.def, layout = timelineRows(foldedChannels(def, v.part, v.tracks.length, v.frames.length), v.tracks.length, v.frames.length);
  drawn.set(tl, layout);
  const w = timelineWidth(tl), height = layout.height;
  tl.setAttribute('viewBox', `0 0 ${w} ${height}`);
  tl.setAttribute('height', String(height));
  tl.replaceChildren();
  KEY_CHANNELS.forEach((ch, i) => {
    const row = layout.rows[i] as Extract<TimelineRows['rows'][number], { kind: 'channel' }>, top = row.top;
    if (row.folded) {
      // No key on this channel: a thin row with its name; a double-click adds the first key at rest and opens the lane.
      const r = svg('rect', { x: 0, y: top, width: w, height: row.height, class: `tl-fold ${i % 2 ? 'tl-bg-b' : 'tl-bg-a'}`, 'data-fold': ch });
      if (v.editable) r.append(svg('title', {}, `${ch}: no keys. Double-click to add one at rest, then drag it.`));
      tl.append(r, svg('text', { x: 8, y: top + 13, class: 'tl-label tl-flabel' }, ch));
      return;
    }
    const mid = top + LANE / 2;
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
        'aria-label': `${ch} key at ${timeLabel(k.key.t, v.dur)}, value ${k.key[ch]}${v.editable ? '. Arrows move it, Delete removes it' : ''}`,
      });
      d.append(svg('title', {}, `${ch} ${k.key[ch]} at ${timeLabel(k.key.t, v.dur)}${k.key.ease ? `, ease ${k.key.ease}` : ''}`));
      tl.append(d);
    }
    // The rest the engine adds at an end with no key: drawn hollow, so a single pose key's slide back to rest has a visible cause.
    if (!v.preset) for (const end of restEnds(def, ch, v.part)) {
      const r = svg('rect', { x: -5, y: -5, width: 10, height: 10, class: 'tl-rest', transform: `translate(${xOf(tl, end)} ${y(rest)}) rotate(45)`, 'data-rest': end, 'data-ch': ch });
      r.append(svg('title', {}, `${ch} rests at ${rest} at ${timeLabel(end, v.dur)}: with no key at ${end ? 'the end' : 'the start'}, a channel ${end ? 'returns to' : 'starts from'} rest.${v.editable ? ' Double-click to hold the pose: a key here with the nearest key\'s value.' : ''}`));
      tl.append(r);
    }
  });
  v.tracks.forEach((tr, i) => {
    const top = paramTop(tl, i), y = (val: number) => top + 6 + (1 - (val - tr.min) / (tr.max - tr.min)) * (PLANE - 12);
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
        'aria-label': `${tr.id} key at ${timeLabel(k.t, v.dur)}, value ${k.v}${v.editable ? '. Arrows move it, Delete removes it' : ''}`,
      });
      d.append(svg('title', {}, `${tr.id} ${k.v} at ${timeLabel(k.t, v.dur)}${k.ease ? `, ease ${k.ease}` : ''}`));
      tl.append(d);
    });
  });
  v.frames.forEach((row, i) => {
    const top = layout.rows.find(r => r.kind === 'frame' && r.index === i)!.top;
    tl.append(
      svg('rect', { x: 0, y: top, width: w, height: FLANE, class: 'tl-bg-f' }),
      svg('text', { x: 8, y: top + 14, class: 'tl-label' }, row.slot.length > 9 ? `${row.slot.slice(0, 8)}…` : row.slot),
      svg('text', { x: 8, y: top + 27, class: 'tl-range' }, 'frames'),
    );
    for (const b of row.blocks) {
      const x0 = xOf(tl, b.from), x1 = Math.max(x0 + 2, xOf(tl, b.to)), on = v.selFrame?.slot === row.slot && v.selFrame.index === b.index;
      const g = svg('g', { class: on ? 'tl-fblock tl-on' : 'tl-fblock', 'data-fkey': b.index, 'data-fslot': row.slot, tabindex: on ? 0 : -1, role: 'button',
        'aria-label': `${row.slot} frame ${b.frame} from ${timeLabel(b.from, v.dur)}${v.editable ? '. Arrows move it, Delete removes it' : ''}` });
      g.append(svg('title', {}, `${row.slot}: ${b.frame} from ${timeLabel(b.from, v.dur)}`),
        svg('rect', { x: x0, y: top + 3, width: x1 - x0 - 1, height: FLANE - 6, rx: 3, class: b.frame === 'none' ? 'tl-fnone' : 'tl-fbody' }));
      if (x1 - x0 > 16) g.append(svg('text', { x: x0 + 4, y: top + FLANE / 2 + 4, class: 'tl-ftext' }, b.frame));
      tl.append(g);
    }
  });
  const dur = v.dur, base = layout.height;
  if (v.editable && !keysOf(def, v.part).length && !v.tracks.length && !v.frames.length) {
    tl.append(svg('text', { x: xOf(tl, 0.5), y: base / 2, class: 'tl-empty', 'text-anchor': 'middle' }, 'No keys yet. Double-click a lane to add one, then drag it.'));
  }
  // The ruler sits over the lanes and stays there when they scroll, so the times are always in view.
  ruler.setAttribute('viewBox', `0 0 ${w} ${AXIS}`);
  ruler.setAttribute('height', String(AXIS));
  ruler.replaceChildren();
  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    const x = xOf(tl, f);
    tl.append(svg('line', { x1: x, x2: x, y1: 0, y2: base, class: 'tl-grid' }));
    ruler.append(svg('line', { x1: x, x2: x, y1: AXIS - 5, y2: AXIS, class: 'tl-grid' }),
      svg('text', { x, y: 14, class: 'tl-tick', 'text-anchor': f === 1 ? 'end' : f === 0 ? 'start' : 'middle' }, `${+(f * dur).toFixed(2)}s`));
  }
  const playLine = svg('line', { x1: 0, x2: 0, y1: 0, y2: base, class: 'tl-play' }), rulerLine = svg('line', { x1: 0, x2: 0, y1: 0, y2: AXIS, class: 'tl-play' });
  tl.append(playLine);
  ruler.append(rulerLine);
  return [playLine, rulerLine];
}
