// Outlines of a pixel mask, shared by mask tracing (masks.ts) and mesh generation (mesh-gen.ts).

type Pt = [number, number];

/**
 * Pixel-edge boundary loops of a mask (`mask[y * w + x]` non-zero is inside), corners only. Each opaque cell contributes
 * its boundary edges with the cell on the right of the travel direction, so outer loops have positive shoelace area
 * (clockwise on screen) and holes negative. At a vertex shared by diagonal cells the loop turns right, which keeps
 * 4-connected regions apart: a region's outline is one loop, never spliced with a hole or a neighbour touching it at a corner.
 * `joinCorners` turns left there instead, so cells touching at a corner are one region and a gap that only leaks out through
 * a corner is inside the outer loop (for one region's outline, holes ignored).
 */
export function traceLoops(mask: ArrayLike<number>, w: number, h: number, joinCorners = false): Pt[][] {
  const vw = w + 1;
  const from: number[] = [], to: number[] = [];
  const outs = new Map<number, number[]>();
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    const a = y0 * vw + x0;
    from.push(a); to.push(y1 * vw + x1);
    const l = outs.get(a);
    if (l) l.push(from.length - 1); else outs.set(a, [from.length - 1]);
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue;
    if (y === 0 || !mask[(y - 1) * w + x]) add(x, y, x + 1, y);
    if (x === w - 1 || !mask[y * w + x + 1]) add(x + 1, y, x + 1, y + 1);
    if (y === h - 1 || !mask[(y + 1) * w + x]) add(x + 1, y + 1, x, y + 1);
    if (x === 0 || !mask[y * w + x - 1]) add(x, y + 1, x, y);
  }
  const dirOf = (e: number): Pt => [Math.sign((to[e] % vw) - (from[e] % vw)), Math.sign(Math.floor(to[e] / vw) - Math.floor(from[e] / vw))];
  const used = new Uint8Array(from.length);
  const loops: Pt[][] = [];
  for (let e0 = 0; e0 < from.length; e0++) {
    if (used[e0]) continue;
    const raw: Pt[] = [];
    let e = e0;
    do {
      used[e] = 1;
      raw.push([from[e] % vw, Math.floor(from[e] / vw)]);
      const [dx, dy] = dirOf(e);
      const cands = outs.get(to[e])!;
      let next = cands[0];
      if (cands.length > 1) {
        const rank = (c: number) => {
          const [cx, cy] = dirOf(c);
          const turn = joinCorners ? cx === dy && cy === -dx : cx === -dy && cy === dx;
          return turn ? 0 : cx === dx && cy === dy ? 1 : 2;
        };
        next = cands.reduce((a, b) => (rank(b) < rank(a) ? b : a));
      }
      e = next;
    } while (e !== e0);
    // Drop collinear vertices.
    const loop = raw.filter((p, i) => {
      const a = raw[(i + raw.length - 1) % raw.length], b = raw[(i + 1) % raw.length];
      return (p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0]) !== 0;
    });
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}
