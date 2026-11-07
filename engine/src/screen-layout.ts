// Layout of custom screens: moving parts, group boxes and the row / column / grid placement. Pure; used by resolveScreen.

import type { Vars } from './types.js';
import type { StageSize } from './stage.js';
import { LAYOUT_ANCHORS, textSize, type LayoutAlign, type LayoutAnchor, type Point, type ScreenNode, type Shape, type StageRect, type ViewPart } from './screens.js';
import { shapeBounds, shapeCenter, translate } from './screen-geometry.js';

export function shiftPart(p: ViewPart, dx: number, dy: number): ViewPart {
  if (dx === 0 && dy === 0) return p;
  if (p.kind === 'image' || p.kind === 'text' || p.kind === 'slider' || p.kind === 'scroll' || p.kind === 'panel' || p.kind === 'bar') return { ...p, x: p.x + dx, y: p.y + dy };
  const shape = translate(p.shape, dx, dy);
  return { ...p, shape, bounds: shapeBounds(shape), center: shapeCenter(shape) };
}

/** The box a part occupies for layout purposes (an image needs its size; text and buttons use the size guesses). */
export function partBox(p: ViewPart): StageRect {
  if (p.kind === 'image') return { x: p.x, y: p.y, w: p.w ?? 0, h: p.h ?? 0 };
  if (p.kind === 'text') return { x: p.x, y: p.y, ...textSize(p.text, p.font, p.width) };
  if (p.kind === 'slider' || p.kind === 'scroll' || p.kind === 'panel' || p.kind === 'bar') return { x: p.x, y: p.y, w: p.w, h: p.h };
  return p.bounds;
}

function groupBox(g: ViewPart[]): StageRect {
  const boxes = g.map(partBox);
  const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
  return { x, y, w: Math.max(...boxes.map(b => b.x + b.w)) - x, h: Math.max(...boxes.map(b => b.y + b.h)) - y };
}

const alignOffset =(align: LayoutAlign, room: number) => (align === 'center' || align === 'stretch' ? room / 2 : align === 'end' ? room : 0);

/**
 * `align stretch`: a group's parts that span its box on an axis grow to `w` / `h` (null: leave that axis). Only boxes that can be
 * resized without distorting are touched: text (a wider box), buttons and hotspots with a rectangle, panels, bars, sliders and scrolls.
 * Children placed inside a panel keep their place.
 */
function stretchGroup(g: ViewPart[], w: number | null, h: number | null): ViewPart[] {
  const box = groupBox(g);
  return g.map(p => {
    const b = partBox(p);
    const sw = w !== null && b.x === box.x && b.w === box.w ? w : null, sh = h !== null && b.y === box.y && b.h === box.h ? h : null;
    if (sw === null && sh === null) return p;
    if (p.kind === 'text') return sw === null ? p : { ...p, width: sw };
    if (p.kind === 'slider' || p.kind === 'scroll' || p.kind === 'panel' || p.kind === 'bar') return { ...p, w: sw ?? p.w, h: sh ?? p.h };
    if (p.kind === 'button' || p.kind === 'hotspot') {
      if (p.shape.k !== 'rect') return p;
      const shape: Shape = { ...p.shape, w: sw ?? p.shape.w, h: sh ?? p.shape.h };
      return { ...p, shape, bounds: shapeBounds(shape), center: shapeCenter(shape) };
    }
    return p;
  });
}

/** Where a layout's box goes on the stage: `at`, or an anchor with a margin (a layout inside another is placed by its parent: 0,0). */
function anchorOrigin(n: Extract<ScreenNode, { kind: 'layout' }>, w: number, h: number, stage: StageSize, vars: Vars): Point {
  if (n.at) return n.at;
  const named = n.anchorVar ? String(vars[n.anchorVar]) : null;
  const a = named !== null ? ((LAYOUT_ANCHORS as readonly string[]).includes(named) ? named : 'center') as LayoutAnchor : n.anchor;
  if (!a) return [0, 0];
  const [mt, mr, mb, ml] = n.margin;
  const x = a.endsWith('left') || a === 'left' ? ml : a.endsWith('right') ? stage.width - mr - w : (stage.width - w + ml - mr) / 2;
  const y = a.startsWith('top') ? mt : a.startsWith('bottom') ? stage.height - mb - h : (stage.height - h + mt - mb) / 2;
  return [x, y];
}

/** Places the groups of a row, column or grid: every part comes back moved to its cell, the whole at `at` or the anchor. */
export function layoutGroups(n: Extract<ScreenNode, { kind: 'layout' }>, groups: ViewPart[][], stage: StageSize, vars: Vars): ViewPart[] {
  if (!groups.length) return [];
  let boxes = groups.map(groupBox);
  const stretch = n.align === 'stretch';
  const moves: Point[] = [];
  let width: number, height: number;
  if (n.type === 'grid') {
    const cols = Math.max(1, n.columns), rows = Math.ceil(groups.length / cols);
    const cw = n.cell?.[0] ?? Math.max(...boxes.map(b => b.w)), ch = n.cell?.[1] ?? Math.max(...boxes.map(b => b.h));
    if (stretch) { groups = groups.map(g => stretchGroup(g, cw, ch)); boxes = groups.map(groupBox); }
    boxes.forEach((b, i) => {
      const cx = (i % cols) * (cw + n.gap), cy = Math.floor(i / cols) * (ch + n.gap);
      moves.push([cx + alignOffset(n.align, cw - b.w) - b.x, cy + alignOffset(n.align, ch - b.h) - b.y]);
    });
    width = cols * cw + (cols - 1) * n.gap;
    height = rows * ch + (rows - 1) * n.gap;
  } else {
    const row = n.type === 'row';
    const across = Math.max((row ? n.height : n.width) ?? 0, ...boxes.map(b => (row ? b.h : b.w)));
    if (stretch) { groups = groups.map(g => stretchGroup(g, row ? null : across, row ? across : null)); boxes = groups.map(groupBox); }
    let at = 0;
    for (const b of boxes) {
      const cross = alignOffset(n.align, across - (row ? b.h : b.w));
      moves.push(row ? [at - b.x, cross - b.y] : [cross - b.x, at - b.y]);
      at += (row ? b.w : b.h) + n.gap;
    }
    const total = Math.max(at - n.gap, (row ? n.width : n.height) ?? 0);
    width = row ? total : across;
    height = row ? across : total;
  }
  const [pt, pr, pb, pl] = n.padding;
  const [ox, oy] = anchorOrigin(n, width + pl + pr, height + pt + pb, stage, vars);
  return groups.flatMap((g, i) => g.map(p => shiftPart(p, moves[i][0] + ox + pl, moves[i][1] + oy + pt)));
}
