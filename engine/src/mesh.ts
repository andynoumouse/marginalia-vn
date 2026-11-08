// Free-mesh geometry (docs/design/free-mesh.md): pure lookups over a triangle mesh given as interleaved vertices [x0, y0, ...] and
// index triples. The mesh counterparts of the lattice helpers in warp.ts and warp-edit.ts; nothing here draws.

const EPS = 1e-6;

/** The barycentric coordinates of (x, y) in the triangle a, b, c (vertex indices into `verts`); null for a triangle with no area. */
function bary(verts: ArrayLike<number>, a: number, b: number, c: number, x: number, y: number): [number, number, number] | null {
  const ax = verts[a * 2], ay = verts[a * 2 + 1], bx = verts[b * 2], by = verts[b * 2 + 1], cx = verts[c * 2], cy = verts[c * 2 + 1];
  const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  if (Math.abs(det) < 1e-9) return null;
  const u = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / det, v = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / det;
  return [u, v, 1 - u - v];
}

/** The unique edges of the triangles as [low, high] vertex pairs, in the order they first appear. */
export function meshEdges(tris: ArrayLike<number>): [number, number][] {
  const seen = new Set<number>(), out: [number, number][] = [];
  const add = (p: number, q: number) => {
    const a = Math.min(p, q), b = Math.max(p, q), key = a * 4294967296 + b;
    if (!seen.has(key)) { seen.add(key); out.push([a, b]); }
  };
  for (let t = 0; t + 2 < tris.length; t += 3) { add(tris[t], tris[t + 1]); add(tris[t + 1], tris[t + 2]); add(tris[t + 2], tris[t]); }
  return out;
}

/** For each of `vertCount` vertices, the vertices it shares an edge with, ascending. */
export function meshAdjacency(vertCount: number, tris: ArrayLike<number>): number[][] {
  const out: number[][] = Array.from({ length: vertCount }, () => []);
  for (const [a, b] of meshEdges(tris)) { if (a < vertCount && b < vertCount) { out[a].push(b); out[b].push(a); } }
  for (const list of out) list.sort((p, q) => p - q);
  return out;
}

/**
 * The triangle of the mesh that contains (x, y) and the point's barycentric weights (u, v, w) for its three vertices in the order
 * `tris` lists them; null outside the mesh. Where triangles overlap (a folded mesh) the later one wins, as it is painted last.
 */
export function locateInMesh(verts: ArrayLike<number>, tris: ArrayLike<number>, x: number, y: number): { tri: number; u: number; v: number; w: number } | null {
  let hit: { tri: number; u: number; v: number; w: number } | null = null;
  for (let t = 0; t + 2 < tris.length; t += 3) {
    const b = bary(verts, tris[t], tris[t + 1], tris[t + 2], x, y);
    if (b && b[0] >= -EPS && b[1] >= -EPS && b[2] >= -EPS) hit = { tri: t / 3, u: b[0], v: b[1], w: b[2] };
  }
  return hit;
}

/**
 * Where the point (x, y) on the deformed mesh lies on the undeformed art: the rest position of whatever `deformedVerts` draws
 * there. Null outside the mesh. The mesh counterpart of `unwarpPoint`.
 */
export function unwarpMeshPoint(restVerts: ArrayLike<number>, deformedVerts: ArrayLike<number>, tris: ArrayLike<number>, x: number, y: number): [number, number] | null {
  const hit = locateInMesh(deformedVerts, tris, x, y);
  if (!hit) return null;
  const a = tris[hit.tri * 3], b = tris[hit.tri * 3 + 1], c = tris[hit.tri * 3 + 2];
  return [restVerts[a * 2] * hit.u + restVerts[b * 2] * hit.v + restVerts[c * 2] * hit.w, restVerts[a * 2 + 1] * hit.u + restVerts[b * 2 + 1] * hit.v + restVerts[c * 2 + 1] * hit.w];
}

/**
 * The displacement the mesh gives the rest position (x, y): `disp` (interleaved [dx, dy, ...] per vertex) blended barycentrically over
 * the triangle holding the point. A point outside the mesh takes the nearest triangle's value, clamped onto it, as `sampleLattice`
 * does at the box edge. [0, 0] for a mesh without usable triangles. The counterpart of `sampleLattice`.
 */
export function sampleMesh(disp: ArrayLike<number>, restVerts: ArrayLike<number>, tris: ArrayLike<number>, x: number, y: number): [number, number] {
  const hit = locateInMesh(restVerts, tris, x, y);
  let tri = -1, u = 0, v = 0, w = 0;
  if (hit) ({ tri, u, v, w } = hit);
  else {
    let best = -Infinity;
    for (let t = 0; t + 2 < tris.length; t += 3) {
      const b = bary(restVerts, tris[t], tris[t + 1], tris[t + 2], x, y);
      if (!b) continue;
      const low = Math.min(b[0], b[1], b[2]);
      if (low > best) { best = low; tri = t / 3; [u, v, w] = b; }
    }
    if (tri < 0) return [0, 0];
    u = Math.max(0, u); v = Math.max(0, v); w = Math.max(0, w);
    const sum = u + v + w;
    u /= sum; v /= sum; w /= sum;
  }
  const a = tris[tri * 3], b = tris[tri * 3 + 1], c = tris[tri * 3 + 2];
  return [(disp[a * 2] ?? 0) * u + (disp[b * 2] ?? 0) * v + (disp[c * 2] ?? 0) * w, (disp[a * 2 + 1] ?? 0) * u + (disp[b * 2 + 1] ?? 0) * v + (disp[c * 2 + 1] ?? 0) * w];
}

/** Hops along edges from the nearest of `from` to every vertex: 0 for those, Infinity for vertices no edge path reaches. */
export function meshGraphDistance(vertCount: number, tris: ArrayLike<number>, from: Iterable<number>): Float64Array {
  const dist = new Float64Array(vertCount).fill(Infinity), adj = meshAdjacency(vertCount, tris);
  let frontier: number[] = [];
  for (const s of from) if (Number.isInteger(s) && s >= 0 && s < vertCount && dist[s] !== 0) { dist[s] = 0; frontier.push(s); }
  for (let d = 1; frontier.length; d++) {
    const next: number[] = [];
    for (const p of frontier) for (const q of adj[p]) if (dist[q] === Infinity) { dist[q] = d; next.push(q); }
    frontier = next;
  }
  return dist;
}

/** The smallest box [x, y, width, height] holding the vertices; null for none. */
export function meshBox(verts: ArrayLike<number>): [number, number, number, number] | null {
  if (verts.length < 2) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i + 1 < verts.length; i += 2) { x0 = Math.min(x0, verts[i]); x1 = Math.max(x1, verts[i]); y0 = Math.min(y0, verts[i + 1]); y1 = Math.max(y1, verts[i + 1]); }
  return [x0, y0, x1 - x0, y1 - y0];
}

/**
 * The vertices of a free-mesh part's mesh, written into `out` (same length as `rest`): each rest vertex moved by the part's own
 * displacement `own` (stage fractions, interleaved per vertex; null for none) and then by the group lattice `group` sampled at the
 * vertex's REST position on the canvas (`origin` is where the part's box sits there), as `warpMemberMesh` does for a regular mesh.
 * A group bends a free mesh at its own vertices only (no subdivision), so a coarse mesh in a group follows the lattice coarsely.
 */
export function warpFreeMesh(
  rest: ArrayLike<number>, own: ArrayLike<number> | null, group: { box: readonly [number, number, number, number]; sample: (u: number, v: number) => [number, number] } | null,
  origin: readonly [number, number], unit: number, out: Float32Array = new Float32Array(rest.length),
): Float32Array {
  for (let k = 0; k * 2 + 1 < rest.length; k++) {
    let dx = own?.[k * 2] ?? 0, dy = own?.[k * 2 + 1] ?? 0;
    if (group) {
      const [bx, by, bw, bh] = group.box, [gx, gy] = group.sample(bw > 0 ? (rest[k * 2] + origin[0] - bx) / bw : 0, bh > 0 ? (rest[k * 2 + 1] + origin[1] - by) / bh : 0);
      dx += gx; dy += gy;
    }
    out[k * 2] = rest[k * 2] + dx * unit;
    out[k * 2 + 1] = rest[k * 2 + 1] + dy * unit;
  }
  return out;
}

/**
 * Carry points (flat [x, y, ...] in the mesh's own pixels) along with a deformed free mesh: each point is located in the rest mesh and
 * moved by the blend of its triangle's vertex displacements (`sampleMesh`, so a point off the mesh follows the nearest triangle).
 * The mesh counterpart of `warpPoints`.
 */
export function warpMeshPoints(points: ArrayLike<number>, restVerts: ArrayLike<number>, deformedVerts: ArrayLike<number>, tris: ArrayLike<number>, out: Float32Array = new Float32Array(points.length)): Float32Array {
  const disp = new Float32Array(restVerts.length);
  for (let i = 0; i < disp.length; i++) disp[i] = deformedVerts[i] - restVerts[i];
  for (let i = 0; i + 1 < points.length; i += 2) {
    const [dx, dy] = sampleMesh(disp, restVerts, tris, points[i], points[i + 1]);
    out[i] = points[i] + dx;
    out[i + 1] = points[i + 1] + dy;
  }
  return out;
}
