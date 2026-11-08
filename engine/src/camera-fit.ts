// Overscan: the smallest camera zoom at which a rolled or shifted view still lies inside the stage.

/** How far v (a world offset from the pivot, times z) may reach: `room` is the distance to the edge on v's side. */
const bound = (v: number, lo: number, hi: number): number => v > 1e-9 ? v / Math.max(hi, 1e-9) : v < -1e-9 ? -v / Math.max(lo, 1e-9) : 0;

/**
 * The zoom floor that keeps every screen corner inside the world rectangle (0..w, 0..h) when the camera zooms and rolls
 * about the pivot (px, py) and is shifted by (dx, dy). Screen point s maps to world P + R⁻¹(s - P - d) / z, so each
 * corner bounds 1/z independently. Returns 1 at rest (no roll, no shift).
 */
export function overscanZoom(w: number, h: number, px: number, py: number, rollRad: number, dx: number, dy: number): number {
  const cos = Math.cos(rollRad), sin = Math.sin(rollRad);
  let z = 1;
  for (const [sx, sy] of [[0, 0], [w, 0], [0, h], [w, h]]) {
    const ax = sx - px - dx, ay = sy - py - dy;
    const vx = cos * ax + sin * ay, vy = -sin * ax + cos * ay; // R⁻¹ applied
    z = Math.max(z, bound(vx, px, w - px), bound(vy, py, h - py));
  }
  return z;
}
