// Editing free-mesh deformers (docs/design/free-mesh.md): the pure half of the animation studio's Mesh workflow. A part has one
// deformer, a lattice or a free mesh; generating a mesh creates it, or replaces what the part has, and drops the keyforms the old
// topology owned (their `pts` index vertices or lattice points that no longer exist).

import { MESH_MAX_VERTS, deformerPoints, type DeformerDef, type DeformerMesh, type MeshWeights, type ParamDef } from './params.js';
import { resampleWeights } from './skin-edit.js';
import { deformerOf, mirrorPoints, smoothPoints, transformPoints, type WarpVec } from './warp-edit.js';
import { locateInMesh, meshAdjacency } from './mesh.js';
import type { GeneratedMesh, MeshDetail } from './mesh-gen.js';
import { nearestOnSegment } from './geometry.js';

/** The detail steps in the order the studio offers them, with the labels it shows. */
export const MESH_DETAIL_STEPS: readonly { id: MeshDetail; label: string }[] = [
  { id: 'low', label: 'Low' }, { id: 'medium', label: 'Medium' }, { id: 'high', label: 'High' }, { id: 'veryhigh', label: 'Very high' },
];

/** What generating a mesh for `part` would throw away: nothing, a lattice (and its keyforms), or the keyforms of a mesh. */
export type MeshReplace = 'none' | 'lattice' | 'keyforms';

/** The keyforms of a deformer hold something: a topology edit would drop it. */
export const hasKeyforms = (def: Pick<DeformerDef, 'keyforms'>): boolean => (def.keyforms ?? []).length > 0;

/**
 * What `setPartMesh` would replace on `part`. A lattice always counts (the kind changes); a mesh only when it has keyforms, so
 * Regenerate on a bare mesh needs no confirmation.
 */
export function meshReplaces(deformers: readonly DeformerDef[], part: string): MeshReplace {
  const d = deformerOf(deformers, part);
  if (!d) return 'none';
  if (!d.mesh) return 'lattice';
  return hasKeyforms(d) ? 'keyforms' : 'none';
}

/** Is the generated mesh usable: at least one triangle and no more vertices than the cap? */
export const meshUsable = (m: GeneratedMesh): boolean => m.tris.length >= 3 && m.verts.length >= 6 && m.verts.length / 2 <= MESH_MAX_VERTS;

/**
 * `deformers` with the free mesh `mesh` on `part`: a new deformer named after the part when it has none; else its deformer keeps
 * its id and gets the mesh in place of its lattice or old mesh, with no keyforms. `detail` is stored as the generator's hint for
 * Regenerate. An unusable mesh leaves everything as it was (the same array contents).
 */
export function setPartMesh(deformers: readonly DeformerDef[], part: string, mesh: GeneratedMesh, detail: MeshDetail): DeformerDef[] {
  if (!meshUsable(mesh)) return [...deformers];
  const made: DeformerMesh = { verts: [...mesh.verts], tris: [...mesh.tris], detail };
  const own = deformerOf(deformers, part);
  // Bone weights are painted work: they carry over to the new mesh, each new vertex sampling the old mesh at its position.
  if (own?.mesh?.weights) {
    made.weights = resampleWeights(own.mesh, own.mesh.verts, own.mesh.tris, made.verts);
    if (own.mesh.defaultBone !== undefined) made.defaultBone = own.mesh.defaultBone;
  }
  if (own) return deformers.map(d => (d === own ? { id: own.id, part, mesh: made, keyforms: [] } : d));
  const taken = new Set(deformers.map(d => d.id));
  let id = `${part}_mesh`;
  for (let i = 2; taken.has(id); i++) id = `${part}_mesh${i}`;
  return [...deformers, { id, part, mesh: made, keyforms: [] }];
}

// ---- editing the vertices of a mesh in a keyform (the Warp tool's operations, over vertices instead of lattice points) ----

/**
 * For each vertex, the vertex that mirrors it across the part's vertical middle (x = `pixels[0]` / 2): the nearest to the mirrored rest
 * position, if within a few percent of the part's size, else -1. A vertex on the axis is its own partner. `pixels` is the part image's size.
 */
export function meshMirrorPartners(verts: ArrayLike<number>, pixels: readonly [number, number]): Int32Array {
  const n = Math.floor(verts.length / 2), out = new Int32Array(n).fill(-1), tol = 0.03 * Math.max(pixels[0], pixels[1]);
  for (let i = 0; i < n; i++) {
    const mx = pixels[0] - verts[i * 2], my = verts[i * 2 + 1];
    let best = -1, bd = Infinity;
    for (let j = 0; j < n; j++) { const d = Math.hypot(verts[j * 2] - mx, verts[j * 2 + 1] - my); if (d < bd) { bd = d; best = j; } }
    if (bd <= tol) out[i] = best;
  }
  return out;
}

/**
 * Copies the keyform at `value` across the part's vertical middle: `from` the left half onto the right (or back), each vertex taking its
 * partner's displacement with x flipped; with `only`, those vertices are the source and land on their partners. A vertex on the axis
 * just loses its sideways move. `unpaired` lists the vertices that should have changed but have no partner (they are left alone).
 */
export function mirrorMeshWarp(def: DeformerDef, param: ParamDef, value: number, from: 'left' | 'right', pixels: readonly [number, number], only?: readonly number[]): { def: DeformerDef; unpaired: number[] } {
  if (!def.mesh) return { def, unpaired: [] };
  const partner = meshMirrorPartners(def.mesh.verts, pixels), mid = pixels[0] / 2, verts = def.mesh.verts;
  // Vertices just off the middle on the source side stay with it.
  const overwritten = (p: number) => (from === 'left' ? verts[p * 2] > mid : verts[p * 2] < mid);
  return mirrorPoints(def, param, value, deformerPoints(def), p => partner[p], overwritten, only);
}

/** Moves each vertex of the keyform at `value` `amount` (0-1) of the way to the average of the vertices it shares an edge with; with `only`, just those. */
export function smoothMeshWarp(def: DeformerDef, param: ParamDef, value: number, amount = 0.5, only?: readonly number[]): DeformerDef {
  if (!def.mesh) return def;
  const n = deformerPoints(def), adj = meshAdjacency(n, def.mesh.tris);
  return smoothPoints(def, param, value, n, p => adj[p], amount, only);
}

/**
 * Scales (`scale`) and rotates (`rotate`, degrees, clockwise on screen) the chosen vertices of the keyform at `value` about where they sit
 * now (`about` 'selection') or about the middle of the part's image box ('lattice', the studio's "part centre"). `pixels` is the image
 * size and `box` its size in stage units, so rest positions (pixels) and displacements (stage units) can be added.
 */
export function transformMeshPoints(
  def: DeformerDef, param: ParamDef, value: number, points: readonly number[], pixels: readonly [number, number], box: { w: number; h: number },
  by: { scale?: number | WarpVec; rotate?: number; about?: 'selection' | 'lattice' },
): DeformerDef {
  if (!def.mesh) return def;
  const verts = def.mesh.verts, k: WarpVec = [pixels[0] > 0 ? box.w / pixels[0] : 0, pixels[1] > 0 ? box.h / pixels[1] : 0];
  return transformPoints(def, param, value, points, deformerPoints(def), p => [verts[p * 2] * k[0], verts[p * 2 + 1] * k[1]], box, by);
}

// ---- topology edits (docs/design/free-mesh.md, step 5) ----
//
// Each edit takes the mesh's `{ verts, tris }` and returns a new one, or `{ error }` with a message for the panel. Nothing is changed in
// place. An edit that would leave a degenerate, flipped or overlapping triangle, a vertex no triangle uses, or more than MESH_MAX_VERTS
// vertices is refused. Vertex indices move on add (the new vertex is last) and delete (the ones above shift down), so a deformer's
// per-vertex keyform points no longer mean what they did: `setMeshGeometry` drops them.

export interface MeshGeo { verts: number[]; tris: number[] }
export type MeshEditResult = { mesh: MeshGeo } | { error: string };

/** Smallest triangle area (square pixels) a triangle may have. */
const MIN_AREA = 1e-3;
/** Two vertices closer than this (pixels) are one vertex for the add tool. */
const MIN_GAP = 1;
const cross = (v: ArrayLike<number>, a: number, b: number, c: number): number => (v[b * 2] - v[a * 2]) * (v[c * 2 + 1] - v[a * 2 + 1]) - (v[b * 2 + 1] - v[a * 2 + 1]) * (v[c * 2] - v[a * 2]);

/** +1 for a mesh whose triangles wind with a positive cross product (the generator's), -1 for the other way round. */
function windingOf(verts: ArrayLike<number>, tris: ArrayLike<number>): 1 | -1 {
  let sum = 0;
  for (let t = 0; t + 2 < tris.length; t += 3) sum += cross(verts, tris[t], tris[t + 1], tris[t + 2]);
  return sum < 0 ? -1 : 1;
}

/** Do the interiors of triangles `p` and `q` (index triples into `v`) overlap? Touching along an edge or at a corner does not count. */
function overlaps(v: ArrayLike<number>, p: readonly number[], q: readonly number[]): boolean {
  const eps = 1e-6;
  for (const [t, u] of [[p, q], [q, p]] as const) {
    for (let k = 0; k < 3; k++) {
      const a = t[k], b = t[(k + 1) % 3], nx = v[b * 2 + 1] - v[a * 2 + 1], ny = v[a * 2] - v[b * 2], tol = eps * Math.hypot(nx, ny);
      let lo1 = Infinity, hi1 = -Infinity, lo2 = Infinity, hi2 = -Infinity;
      for (const i of t) { const d = v[i * 2] * nx + v[i * 2 + 1] * ny; lo1 = Math.min(lo1, d); hi1 = Math.max(hi1, d); }
      for (const i of u) { const d = v[i * 2] * nx + v[i * 2 + 1] * ny; lo2 = Math.min(lo2, d); hi2 = Math.max(hi2, d); }
      if (hi1 <= lo2 + tol || hi2 <= lo1 + tol) return false;
    }
  }
  return true;
}

/**
 * The first thing wrong with a mesh, or null: indices out of range, a triangle with no area or wound against the others, an edge
 * used twice the same way round (inconsistent winding), a vertex no triangle uses, or two triangles that overlap. `changed` limits the
 * overlap search to those triangles (against all the others); without it every pair is tested.
 */
export function meshProblem(verts: ArrayLike<number>, tris: ArrayLike<number>, changed?: readonly number[]): string | null {
  const n = Math.floor(verts.length / 2), nt = Math.floor(tris.length / 3);
  if (nt < 1) return 'The mesh would have no triangle left.';
  if (n > MESH_MAX_VERTS) return `A mesh has at most ${MESH_MAX_VERTS} vertices.`;
  const s = windingOf(verts, tris), used = new Uint8Array(n), dir = new Set<number>(), box: number[][] = [];
  for (let t = 0; t < nt; t++) {
    const a = tris[t * 3], b = tris[t * 3 + 1], c = tris[t * 3 + 2];
    for (const i of [a, b, c]) if (!Number.isInteger(i) || i < 0 || i >= n) return 'A triangle points at a vertex that does not exist.';
    if (cross(verts, a, b, c) * s <= MIN_AREA) return 'That would leave a flat or flipped triangle.';
    for (const [p, q] of [[a, b], [b, c], [c, a]]) { const key = p * 4294967296 + q; if (dir.has(key)) return 'That would wind two triangles against each other.'; dir.add(key); }
    used[a] = used[b] = used[c] = 1;
    box.push([Math.min(verts[a * 2], verts[b * 2], verts[c * 2]), Math.min(verts[a * 2 + 1], verts[b * 2 + 1], verts[c * 2 + 1]), Math.max(verts[a * 2], verts[b * 2], verts[c * 2]), Math.max(verts[a * 2 + 1], verts[b * 2 + 1], verts[c * 2 + 1])]);
  }
  if (used.includes(0)) return 'That would leave a vertex that no triangle uses.';
  const tri = (t: number) => [tris[t * 3], tris[t * 3 + 1], tris[t * 3 + 2]];
  for (const t of changed ?? Array.from({ length: nt }, (_, i) => i)) {
    for (let u = 0; u < nt; u++) {
      if (u === t || (!changed && u < t)) continue;
      const p = box[t], q = box[u];
      if (!p || !q || p[2] < q[0] || q[2] < p[0] || p[3] < q[1] || q[3] < p[1]) continue;
      if (overlaps(verts, tri(t), tri(u))) return 'That would make two triangles overlap.';
    }
  }
  return null;
}

/** Checks the candidate mesh (only the triangles in `changed` against the rest for overlap) and wraps it as an edit result. */
function finish(verts: number[], tris: number[], changed: readonly number[]): MeshEditResult {
  const problem = meshProblem(verts, tris, changed);
  return problem ? { error: problem } : { mesh: { verts, tris } };
}

const distToSegment = nearestOnSegment;

/** The index of the triangle (not its offset) holding the directed edge a -> b, or -1. */
function triWithEdge(tris: readonly number[], a: number, b: number): number {
  for (let t = 0; t + 2 < tris.length; t += 3) for (let k = 0; k < 3; k++) if (tris[t + k] === a && tris[t + (k + 1) % 3] === b) return t / 3;
  return -1;
}

/**
 * Adds a vertex at (x, y) in the part's pixels: inside a triangle it splits it in three; within `snap` pixels of an edge it splits that
 * edge (and the triangle on its other side) instead, the new vertex lying on the edge. The new vertex is the last one. Refused outside
 * the mesh, on top of a vertex, or past the cap.
 */
export function addMeshVertex(mesh: MeshGeo, x: number, y: number, snap = 2, maxVerts = MESH_MAX_VERTS): MeshEditResult {
  const { verts, tris } = mesh, n = verts.length / 2;
  if (n + 1 > maxVerts) return { error: `A mesh has at most ${maxVerts} vertices.` };
  const hit = locateInMesh(verts, tris, x, y);
  if (!hit) return { error: 'Click inside the mesh to add a vertex.' };
  const t = hit.tri, [a, b, c] = [tris[t * 3], tris[t * 3 + 1], tris[t * 3 + 2]];
  for (const i of [a, b, c]) if (Math.hypot(verts[i * 2] - x, verts[i * 2 + 1] - y) < MIN_GAP) return { error: 'There is a vertex here already.' };
  const edges = [[a, b, c], [b, c, a], [c, a, b]].map(([p, q, o]) => ({ p, q, o, ...distToSegment(x, y, verts[p * 2], verts[p * 2 + 1], verts[q * 2], verts[q * 2 + 1]) }));
  const near = edges.reduce((m, e) => (e.d < m.d ? e : m));
  const out = tris.slice(), nv = verts.slice();
  if (near.d <= snap) {
    const { p, q, o } = near;
    const ex = verts[p * 2] + (verts[q * 2] - verts[p * 2]) * near.t, ey = verts[p * 2 + 1] + (verts[q * 2 + 1] - verts[p * 2 + 1]) * near.t;
    if (Math.hypot(ex - verts[p * 2], ey - verts[p * 2 + 1]) < MIN_GAP || Math.hypot(ex - verts[q * 2], ey - verts[q * 2 + 1]) < MIN_GAP) return { error: 'There is a vertex here already.' };
    nv.push(ex, ey);
    const u = triWithEdge(tris, q, p);
    out.splice(t * 3, 3, p, n, o);
    out.push(n, q, o);
    const changed = [t, out.length / 3 - 1];
    if (u >= 0) {
      const base = u * 3, k = [0, 1, 2].find(j => tris[base + j] === q)!, d = tris[base + (k + 2) % 3];
      out.splice(base, 3, q, n, d);
      out.push(n, p, d);
      changed.push(u, out.length / 3 - 1);
    }
    return finish(nv, out, changed);
  }
  nv.push(x, y);
  out.splice(t * 3, 3, a, b, n);
  out.push(b, c, n, c, a, n);
  const last = out.length / 3;
  return finish(nv, out, [t, last - 2, last - 1]);
}

/** Ear clipping of a polygon (vertex indices, winding `s`); null when it cannot be cut into triangles. */
function earClip(verts: ArrayLike<number>, poly: number[], s: 1 | -1): number[] | null {
  const out: number[] = [], p = poly.slice();
  const inside = (a: number, b: number, c: number, q: number) => cross(verts, a, b, q) * s >= -1e-9 && cross(verts, b, c, q) * s >= -1e-9 && cross(verts, c, a, q) * s >= -1e-9;
  while (p.length > 3) {
    let cut = -1;
    for (let j = 0; j < p.length && cut < 0; j++) {
      const a = p[(j + p.length - 1) % p.length], b = p[j], c = p[(j + 1) % p.length];
      if (cross(verts, a, b, c) * s <= MIN_AREA) continue;
      if (p.some(q => q !== a && q !== b && q !== c && inside(a, b, c, q))) continue;
      cut = j;
    }
    if (cut < 0) return null;
    out.push(p[(cut + p.length - 1) % p.length], p[cut], p[(cut + 1) % p.length]);
    p.splice(cut, 1);
  }
  if (p.length === 3) out.push(...p);
  return out;
}

/**
 * Deletes vertex `i` and re-triangulates the hole it leaves (the polygon of its neighbours, cut into triangles by ear clipping; for a
 * vertex on the outline the polygon is closed by the chord between its two outline neighbours). Refused when it leaves no triangle, when
 * the vertex joins two separate fans, or when the hole cannot be filled without a flipped or overlapping triangle.
 */
export function deleteMeshVertex(mesh: MeshGeo, i: number): MeshEditResult {
  const { verts, tris } = mesh, n = verts.length / 2, apart = { error: 'That vertex joins two separate pieces of the mesh; remove an edge first.' };
  if (!Number.isInteger(i) || i < 0 || i >= n) return { error: 'There is no such vertex.' };
  if (n <= 3) return { error: 'A mesh needs at least three vertices.' };
  const s = windingOf(verts, tris), star: number[] = [], next = new Map<number, number>(), targets = new Set<number>();
  for (let t = 0; t < tris.length / 3; t++) {
    const k = [0, 1, 2].find(j => tris[t * 3 + j] === i);
    if (k === undefined) continue;
    star.push(t);
    const x = tris[t * 3 + (k + 1) % 3], y = tris[t * 3 + (k + 2) % 3];
    if (next.has(x) || targets.has(y)) return apart;
    next.set(x, y);
    targets.add(y);
  }
  const poly: number[] = [];
  if (star.length) {
    const start = [...next.keys()].find(x => !targets.has(x)) ?? [...next.keys()][0];
    for (let x: number | undefined = start; x !== undefined && !poly.includes(x); x = next.get(x)) poly.push(x);
    const open = !targets.has(start);
    if (poly.length !== next.size + (open ? 1 : 0)) return apart;
  }
  const fill = poly.length >= 3 ? earClip(verts, poly, s) : [];
  if (!fill) return { error: 'The hole this vertex leaves cannot be filled without a flipped triangle.' };
  const keep: number[] = [], drop = new Set(star);
  for (let t = 0; t < tris.length / 3; t++) if (!drop.has(t)) keep.push(tris[t * 3], tris[t * 3 + 1], tris[t * 3 + 2]);
  const all = keep.concat(fill).map(v => (v > i ? v - 1 : v)), nv = verts.slice(0, i * 2).concat(verts.slice(i * 2 + 2)), first = keep.length / 3;
  return finish(nv, all, Array.from({ length: fill.length / 3 }, (_, k) => first + k));
}

/** Moves vertex `i` to (x, y), refused when a triangle around it would flip or overlap another. */
export function moveMeshVertex(mesh: MeshGeo, i: number, x: number, y: number): MeshEditResult {
  const { verts, tris } = mesh;
  if (!Number.isInteger(i) || i < 0 || i * 2 >= verts.length) return { error: 'There is no such vertex.' };
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { error: 'That is not a place.' };
  const nv = verts.slice();
  nv[i * 2] = x; nv[i * 2 + 1] = y;
  const around: number[] = [];
  for (let t = 0; t < tris.length / 3; t++) if (tris[t * 3] === i || tris[t * 3 + 1] === i || tris[t * 3 + 2] === i) around.push(t);
  return finish(nv, tris.slice(), around);
}

/** Flips the edge a-b shared by two triangles to join their other two vertices; refused on an outline edge or when the quad is not convex. */
export function flipMeshEdge(mesh: MeshGeo, a: number, b: number): MeshEditResult {
  const { verts, tris } = mesh, t1 = triWithEdge(tris, a, b), t2 = triWithEdge(tris, b, a);
  if (t1 < 0 && t2 < 0) return { error: 'There is no such edge.' };
  if (t1 < 0 || t2 < 0) return { error: 'An edge on the outline has only one triangle: it cannot be flipped.' };
  const opp = (t: number) => [0, 1, 2].map(k => tris[t * 3 + k]).find(v => v !== a && v !== b)!;
  const c = opp(t1), d = opp(t2), out = tris.slice();
  // t1 holds a -> b with c beyond it and t2 holds b -> a with d; the quad runs a, d, b, c.
  out.splice(t1 * 3, 3, a, d, c);
  out.splice(t2 * 3, 3, d, b, c);
  return finish(verts.slice(), out, [t1, t2]);
}

/** Removes the triangle on an outline edge a-b. Refused for an inner edge (it would leave a hole), or when a vertex would be left with no triangle. */
export function removeMeshEdge(mesh: MeshGeo, a: number, b: number): MeshEditResult {
  const { verts, tris } = mesh, t1 = triWithEdge(tris, a, b), t2 = triWithEdge(tris, b, a);
  if (t1 < 0 && t2 < 0) return { error: 'There is no such edge.' };
  if (t1 >= 0 && t2 >= 0) return { error: 'An edge between two triangles cannot go: it would leave a hole. Only outline edges can be removed.' };
  const t = t1 >= 0 ? t1 : t2;
  return finish(verts.slice(), tris.slice(0, t * 3).concat(tris.slice(t * 3 + 3)), []);
}

/**
 * Adds the edge a-b by closing a triangle across the outline: a and b must already share a neighbour c (edges a-c and b-c exist), the
 * edge a-b must not exist, and the new triangle must not overlap the mesh. The inverse of removing an outline edge.
 */
export function addMeshEdge(mesh: MeshGeo, a: number, b: number): MeshEditResult {
  const { verts, tris } = mesh, n = verts.length / 2;
  if (a === b || !(a >= 0 && a < n && b >= 0 && b < n)) return { error: 'Choose two different vertices.' };
  const adj = meshAdjacency(n, tris);
  if (adj[a].includes(b)) return { error: 'Those vertices are joined already.' };
  const s = windingOf(verts, tris), common = adj[a].filter(v => adj[b].includes(v));
  if (!common.length) return { error: 'An edge closes a triangle: the two vertices need a neighbour in common.' };
  let last = 'That would make two triangles overlap.';
  for (const c of common) {
    const out = tris.concat(cross(verts, a, b, c) * s > 0 ? [a, b, c] : [b, a, c]), r = finish(verts.slice(), out, [out.length / 3 - 1]);
    if ('mesh' in r) return r;
    last = r.error;
  }
  return { error: last };
}

/**
 * The deformer with its mesh's geometry replaced and its keyforms dropped (their per-vertex points index the old vertices). The `detail` hint stays.
 * Bone weights are never dropped: they stay as they are (right for a moved vertex or a flipped edge), unless `weights` says what they
 * become (skin-edit.ts: addVertexWeights, removeVertexWeights).
 */
export function setMeshGeometry(def: DeformerDef, geo: MeshGeo, weights?: MeshWeights): DeformerDef {
  const mesh = { ...def.mesh, verts: [...geo.verts], tris: [...geo.tris] } as DeformerMesh;
  if (weights) mesh.weights = weights;
  return { ...def, mesh, keyforms: [] };
}
