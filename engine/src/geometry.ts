// Plane geometry shared by the rig, mesh, mask and screen code: points, segments and closed polygons.

type Pt = readonly [number, number];

/** A finite [x, y] pair. */
export const isPoint = (p: unknown): p is [number, number] => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);

/**
 * The point of segment a-b nearest to p: how far along it lies (`t`, 0 at a and 1 at b; 0 for a segment of no length), the
 * point itself and its distance from p.
 */
export function nearestOnSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): { t: number; x: number; y: number; d: number } {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  const x = ax + dx * t, y = ay + dy * t;
  return { t, x, y, d: Math.hypot(px - x, py - y) };
}

/** The distance from p to segment a-b. */
export const segmentDistance = (px: number, py: number, ax: number, ay: number, bx: number, by: number): number =>
  nearestOnSegment(px, py, ax, ay, bx, by).d;

/** Whether (x, y) lies inside the closed polygon (even-odd ray casting; a point exactly on an edge may go either way). */
export function pointInPolygon(poly: readonly Pt[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The shoelace area of a closed polygon: positive when it runs clockwise on screen (y down), negative the other way. */
export function signedArea(poly: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}
