// Shape geometry of custom screens: bounds, centres, hit tests, translation and directional focus. Pure; re-exported by screens.ts.

import type { Point, Shape, StageRect } from './screens.js';

export function shapeBounds(s: Shape): StageRect {
  if (s.k !== 'poly') return { x: s.x, y: s.y, w: s.w, h: s.h };
  const xs = s.points.map(p => p[0]), ys = s.points.map(p => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** The point directional focus aims at: the centroid of a polygon (its bounding box centre when it has no area), else the centre. */
export function shapeCenter(s: Shape): Point {
  if (s.k === 'poly') {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < s.points.length; i++) {
      const [x0, y0] = s.points[i], [x1, y1] = s.points[(i + 1) % s.points.length];
      const f = x0 * y1 - x1 * y0;
      a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
    }
    if (Math.abs(a) > 1e-9) return [cx / (3 * a), cy / (3 * a)];
  }
  const b = shapeBounds(s);
  return [b.x + b.w / 2, b.y + b.h / 2];
}

/** Ray casting; points on an edge count as inside only by luck, which is fine for a mouse. */
export function pointInPolygon(points: Point[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i], [xj, yj] = points[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export const pointInRect = (r: StageRect, x: number, y: number) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
export function pointInEllipse(r: StageRect, x: number, y: number): boolean {
  if (r.w <= 0 || r.h <= 0) return false;
  const dx = (x - (r.x + r.w / 2)) / (r.w / 2), dy = (y - (r.y + r.h / 2)) / (r.h / 2);
  return dx * dx + dy * dy <= 1;
}

/** Whether a stage point is in the shape. A mask is only tested against its box here: the shell checks the pixel. */
export function hitTest(s: Shape, x: number, y: number): boolean {
  switch (s.k) {
    case 'rect': case 'mask': return pointInRect(s, x, y);
    case 'ellipse': return pointInEllipse(s, x, y);
    case 'poly': return pointInPolygon(s.points, x, y);
  }
}

export function translate(s: Shape, dx: number, dy: number): Shape {
  if (s.k === 'poly') return { k: 'poly', points: s.points.map(([x, y]) => [x + dx, y + dy] as Point) };
  return { ...s, x: s.x + dx, y: s.y + dy };
}

/**
 * The element of a direction from `from`, or -1: of the candidates ahead (at most about 60 degrees off the
 * direction, else any ahead when none is in that cone) the one with the smallest distance along the direction plus
 * twice the distance across it. Used for the arrow keys and the pad on maps, where reading order means nothing.
 */
export function focusMove(centers: Point[], from: number, dir: 'up' | 'down' | 'left' | 'right'): number {
  const a = centers[from];
  if (!a) return -1;
  const cands: { i: number; along: number; across: number }[] = [];
  centers.forEach((c, i) => {
    if (i === from) return;
    const dx = c[0] - a[0], dy = c[1] - a[1];
    const along = dir === 'up' ? -dy : dir === 'down' ? dy : dir === 'left' ? -dx : dx;
    if (along <= 0.5) return;
    cands.push({ i, along, across: dir === 'up' || dir === 'down' ? Math.abs(dx) : Math.abs(dy) });
  });
  if (!cands.length) return -1;
  const inCone = cands.filter(c => c.across <= c.along * 1.75);
  const pool = inCone.length ? inCone : cands;
  return pool.reduce((best, c) => (c.along + 2 * c.across < best.along + 2 * best.across ? c : best)).i;
}
