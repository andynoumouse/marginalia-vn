// Mesh-warp geometry (docs/design/mesh-warp.md): the rest lattice of a part's image box and the displacement laid on it.
// Pure arrays so the renderer can hand them to a Pixi mesh buffer; nothing here draws.

/** Rest positions of the (cols + 1) * (rows + 1) lattice points over a width x height box, interleaved [x0, y0, ...], row-major (y outer). */
export function restLattice(width: number, height: number, grid: readonly [number, number]): Float32Array {
  const [cols, rows] = grid, out = new Float32Array((cols + 1) * (rows + 1) * 2);
  let k = 0;
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) { out[k++] = (i / cols) * width; out[k++] = (j / rows) * height; }
  return out;
}

/**
 * `rest` plus `disp` (stage fractions, see evalDeformer) scaled to the stage size in the rest positions' unit.
 * Writes into `out` (same length as `rest`) when given, so a per-frame call allocates nothing.
 */
export function applyDisplacement(rest: ArrayLike<number>, disp: ArrayLike<number>, stageW: number, stageH: number, out: Float32Array = new Float32Array(rest.length)): Float32Array {
  for (let i = 0; i < rest.length; i += 2) {
    out[i] = rest[i] + (disp[i] ?? 0) * stageW;
    out[i + 1] = rest[i + 1] + (disp[i + 1] ?? 0) * stageH;
  }
  return out;
}

/**
 * Where the point (x, y), in the mesh's own coordinates, lies on the undeformed art: the rest position of whatever the deformed `lattice`
 * draws there. The triangles are the ones Pixi's MeshPlane draws (each quad is split top-left, top-right, bottom-left and top-right,
 * bottom-right, bottom-left), so a click lands on the same pixel the player sees. Null outside the mesh; where a fold draws two
 * triangles over the point the later one wins, as it is painted last. Both arrays are laid out as `restLattice`.
 */
export function unwarpPoint(lattice: ArrayLike<number>, rest: ArrayLike<number>, grid: readonly [number, number], x: number, y: number): [number, number] | null {
  const [cols, rows] = grid, stride = cols + 1;
  let hit: [number, number] | null = null;
  const tri = (a: number, b: number, c: number) => {
    const ax = lattice[a * 2], ay = lattice[a * 2 + 1], bx = lattice[b * 2], by = lattice[b * 2 + 1], cx = lattice[c * 2], cy = lattice[c * 2 + 1];
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(det) < 1e-9) return; // a collapsed triangle draws nothing
    const u = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / det, v = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / det, w = 1 - u - v;
    const eps = -1e-6;
    if (u < eps || v < eps || w < eps) return;
    hit = [rest[a * 2] * u + rest[b * 2] * v + rest[c * 2] * w, rest[a * 2 + 1] * u + rest[b * 2 + 1] * v + rest[c * 2 + 1] * w];
  };
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const a = j * stride + i, b = a + 1, c = a + stride, d = c + 1;
    tri(a, b, c);
    tri(b, d, c);
  }
  return hit;
}

/** The edges of the lattice as pairs of point indices (row-major, y outer), horizontal lines first: what the studio draws over a part. */
export function latticeEdges(grid: readonly [number, number]): [number, number][] {
  const [cols, rows] = grid, at = (i: number, j: number) => j * (cols + 1) + i, out: [number, number][] = [];
  for (let j = 0; j <= rows; j++) for (let i = 0; i < cols; i++) out.push([at(i, j), at(i + 1, j)]);
  for (let i = 0; i <= cols; i++) for (let j = 0; j < rows; j++) out.push([at(i, j), at(i, j + 1)]);
  return out;
}
