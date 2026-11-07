// DOM helpers for typed text: styled runs, page breaks for a long line, a finished line shown at once.

import type { SayEvent } from '../engine/src/index.js';

export type TextRun = Extract<SayEvent['segments'][number], { kind: 'text' }>;
/** Class and inline style of a styled run of text (italic, bold, effect, color, size). */
export const look = (el: HTMLElement, r: TextRun) => {
  el.className = `${r.italic ? 'i ' : ''}${r.bold ? 'b ' : ''}${r.fx ? `fx fx-${r.fx}` : ''}`.trim();
  if (r.color) el.style.color = r.color;
  if (r.size) el.style.fontSize = `${r.size}em`;
};
/** Where a typed character sits: a range of a text node, or a whole element (`at` -1) for ruby and animated text. */
export type Spot = { node: Node; at: number; len: number };
/**
 * The item indexes where a new page of the text box starts, for a line laid out in full in `box`. A page holds
 * `--text-lines` lines (theme text.lines, default 3) and breaks only at the start of a line. `spots` has null for items
 * that cannot start a line (pauses, spaces).
 */
export function pageStarts(box: HTMLElement, spots: (Spot | null)[]): number[] {
  const cs = getComputedStyle(box);
  if (!box.offsetWidth) return [];
  const scale = box.getBoundingClientRect().width / box.offsetWidth; // the stage is scaled to fit the window
  const line = (parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.45) * scale;
  const room = ((Number(cs.getPropertyValue('--text-lines')) || 3) + 0.5) * line;
  const range = document.createRange(), starts: number[] = [];
  let top = NaN, bottom = -Infinity;
  spots.forEach((s, i) => {
    if (!s) return;
    let r: DOMRect | undefined;
    if (s.at < 0) r = (s.node as Element).getBoundingClientRect();
    else { range.setStart(s.node, s.at); range.setEnd(s.node, s.at + s.len); r = range.getClientRects()[0]; }
    if (!r?.height) return;
    if (Number.isNaN(top)) { top = r.top; bottom = r.bottom; return; }
    if (r.top < bottom - 1) { bottom = Math.max(bottom, r.bottom); return; } // same line
    if (r.bottom - top > room) { starts.push(i); top = r.top; }
    bottom = r.bottom;
  });
  return starts;
}
/** Show a finished line at once (the earlier lines of an NVL page). */
export function appendRuns(target: HTMLElement, segments: SayEvent['segments']) {
  for (const seg of segments) {
    if (seg.kind !== 'text') continue;
    const pieces = seg.ruby ? [seg.text] : seg.fx ? Array.from(seg.text) : [seg.text];
    pieces.forEach((text, i) => {
      const el = document.createElement(seg.ruby ? 'ruby' : 'span');
      el.textContent = text;
      if (seg.ruby) { const rt = document.createElement('rt'); rt.textContent = seg.ruby; el.append(rt); }
      look(el, seg);
      if (seg.fx) el.style.animationDelay = `${(i % 24) * 0.07}s`;
      target.append(el);
    });
  }
}
