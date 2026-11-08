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

// ---- a warp over a group of parts (rig.json `deformers` with `members`) ----

/** A canvas-pixel box [x, y, w, h]. */
export type LatticeBox = readonly [number, number, number, number];

/** The smallest box holding all of `boxes` (null for none). */
export function unionLatticeBox(boxes: readonly LatticeBox[]): [number, number, number, number] | null {
  if (!boxes.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y, w, h] of boxes) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h); }
  return [x0, y0, x1 - x0, y1 - y0];
}

/**
 * The displacement a lattice of `grid` cells gives the point at (u, v) in its box (0-1 across, 0-1 down), bilinear between the
 * four control points around it. A point outside the box takes the nearest edge's value. `disp` is interleaved [dx, dy, ...], row-major.
 */
export function sampleLattice(disp: ArrayLike<number>, grid: readonly [number, number], u: number, v: number): [number, number] {
  const [cols, rows] = grid, stride = cols + 1;
  const x = Math.min(cols, Math.max(0, (Number.isFinite(u) ? u : 0) * cols)), y = Math.min(rows, Math.max(0, (Number.isFinite(v) ? v : 0) * rows));
  const i = Math.min(cols - 1, Math.floor(x)), j = Math.min(rows - 1, Math.floor(y)), fx = x - i, fy = y - j;
  const at = (a: number, b: number, k: number) => disp[(b * stride + a) * 2 + k] ?? 0;
  const one = (k: number) => (at(i, j, k) * (1 - fx) + at(i + 1, j, k) * fx) * (1 - fy) + (at(i, j + 1, k) * (1 - fx) + at(i + 1, j + 1, k) * fx) * fy;
  return [one(0), one(1)];
}

/** A group warp's lattice as the members' meshes see it: its box in canvas pixels, its grid and the displacement of its points now (stage fractions). */
export interface GroupStage { box: LatticeBox; grid: readonly [number, number]; disp: ArrayLike<number> }
/** A part's own warp: its grid and the displacement of its points now (stage fractions). */
export interface OwnStage { grid: readonly [number, number]; disp: ArrayLike<number> }

/**
 * The vertices of a group member's mesh, written into `out` (same length as `rest`). `rest` is the mesh's regular grid of
 * `meshGrid` cells over the part's image box (as `restLattice`, in the part's own pixels) and `origin` is where that box sits on the
 * canvas. Each vertex is first moved by the part's own warp (`own`, sampled where the mesh is finer than its lattice) and then by
 * the group's lattice, sampled at the vertex's REST position in the group box, so the group bends the member as it was drawn and
 * not as its own warp reshaped it. Displacements are in stage fractions; `unit` is the stage size they scale to.
 */
export function warpMemberMesh(
  rest: ArrayLike<number>, meshGrid: readonly [number, number], own: OwnStage | null, group: GroupStage | null,
  origin: readonly [number, number], unit: number, out: Float32Array = new Float32Array(rest.length),
): Float32Array {
  const [mc, mr] = meshGrid, sameGrid = !!own && own.grid[0] === mc && own.grid[1] === mr;
  for (let k = 0; k * 2 + 1 < rest.length; k++) {
    let dx = 0, dy = 0;
    if (own) {
      if (sameGrid) { dx = own.disp[k * 2] ?? 0; dy = own.disp[k * 2 + 1] ?? 0; }
      else [dx, dy] = sampleLattice(own.disp, own.grid, (k % (mc + 1)) / mc, Math.floor(k / (mc + 1)) / mr);
    }
    if (group) {
      const [bx, by, bw, bh] = group.box, [gx, gy] = sampleLattice(group.disp, group.grid, bw > 0 ? (rest[k * 2] + origin[0] - bx) / bw : 0, bh > 0 ? (rest[k * 2 + 1] + origin[1] - by) / bh : 0);
      dx += gx; dy += gy;
    }
    out[k * 2] = rest[k * 2] + dx * unit;
    out[k * 2 + 1] = rest[k * 2 + 1] + dy * unit;
  }
  return out;
}

/** The finest a member's mesh is cut when a group lattice bends it: a coarse lattice over a 1 x 1 mesh would only shear it. */
export const MEMBER_MIN_GRID = 8;

/** The grid of a group member's mesh: its own lattice's, but at least MEMBER_MIN_GRID cells each way when a group lattice bends it. */
export const memberMeshGrid = (own: readonly [number, number] | null, inGroup: boolean): [number, number] =>
  own ? (inGroup ? [Math.max(own[0], MEMBER_MIN_GRID), Math.max(own[1], MEMBER_MIN_GRID)] : [own[0], own[1]]) : [MEMBER_MIN_GRID, MEMBER_MIN_GRID];
