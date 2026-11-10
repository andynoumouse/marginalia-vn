// Automatic triangle-mesh generator for free meshes (docs/design/free-mesh.md). Pure: takes an alpha array, runs in node.
//
// Pipeline: threshold alpha -> downsample to a working grid of at most WORK_SIZE cells -> dilate by margin + tolerance
// (Euclidean distance transform) -> trace the pixel-edge outlines (outer loops and holes) -> simplify by a tolerance ->
// subdivide outline edges to the spacing -> add a hex grid of interior points -> constrained Delaunay -> drop triangles
// outside the region (outside the outer loop or inside a hole). When the result has more than maxVerts vertices, tolerance
// and spacing grow by COARSEN_STEP and everything is redone.
//
// Coordinates are the image's own pixels, origin top-left, y down. Triangles are wound with a positive cross product
// ((b - a) x (c - a) > 0 in these coordinates, i.e. clockwise on screen).

import { traceLoops } from './contour.js';
import { pointInPolygon, segmentDistance, signedArea } from './geometry.js';

export type MeshDetail = 'low' | 'medium' | 'high' | 'veryhigh';

export interface MeshGenOptions {
  detail: MeshDetail;
  /** How far the mesh reaches past the opaque area, in image pixels. Default: 1.5% of the opaque box, at least 2. */
  margin?: number;
  /** Hard vertex cap (default MESH_MAX_VERTS). */
  maxVerts?: number;
}

export interface GeneratedMesh {
  verts: number[];
  tris: number[];
}

/** The least margin a generated mesh has around the opaque pixels, in image pixels. */
export const MIN_MARGIN = 2;
export const MESH_MAX_VERTS = 500;

/**
 * Detail steps, as fractions of B, the longer side of the opaque bounding box (so they scale with the art):
 *  - tol: outline simplification tolerance (at least MESH_MIN_TOL pixels);
 *  - spacing: interior point spacing and the longest outline edge.
 */
export const MESH_DETAIL: Record<MeshDetail, { tol: number; spacing: number }> = {
  low: { tol: 0.02, spacing: 0.3 },
  medium: { tol: 0.012, spacing: 0.18 },
  high: { tol: 0.006, spacing: 0.11 },
  veryhigh: { tol: 0.003, spacing: 0.07 },
};

export const MESH_ALPHA_THRESHOLD = 128;
export const MESH_MIN_TOL = 1;
/** Interior spacing never goes below this many pixels. */
export const MESH_MIN_SPACING = 4;
const DEFAULT_MARGIN = 0.015;
const WORK_SIZE = 512;
const COARSEN_STEP = 1.25;
const COARSEN_TRIES = 60;
/** Interior points keep this fraction of the spacing away from the outline. */
const EDGE_CLEARANCE = 0.6;

/** How many times a segment the triangulation misses is halved before it is given up. */
const MAX_SPLIT_DEPTH = 5;

type Pt = [number, number];

// ---- constrained Delaunay -------------------------------------------------------------------------------------------

/**
 * Delaunay triangulation of `pts` (x,y pairs) in which every segment in `segs` (index pairs) is an edge. Segments that the
 * plain Delaunay misses are split at their midpoint (a conforming triangulation), so the result can hold extra vertices
 * at the end of `verts`. Triangles have a positive cross product; all points are used unless duplicated.
 */
export function triangulate(pts: number[], segs: number[] = []): GeneratedMesh {
  const n = pts.length / 2;
  if (n < 3) return { verts: pts.slice(), tris: [] };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, pts[2 * i]); maxX = Math.max(maxX, pts[2 * i]);
    minY = Math.min(minY, pts[2 * i + 1]); maxY = Math.max(maxY, pts[2 * i + 1]);
  }
  const ext = Math.max(maxX - minX, maxY - minY, 1);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, S = ext * 1e4;
  // Internal arrays: indices 0..2 are the super triangle, a real point i is i + 3.
  const X = [cx - 2 * S, cx + 2 * S, cx], Y = [cy - S, cy - S, cy + 2 * S];
  for (let i = 0; i < n; i++) { X.push(pts[2 * i]); Y.push(pts[2 * i + 1]); }
  let T: number[][] = [[0, 1, 2]];

  const inCircle = (t: number[], p: number): boolean => {
    const ax = X[t[0]] - X[p], ay = Y[t[0]] - Y[p];
    const bx = X[t[1]] - X[p], by = Y[t[1]] - Y[p];
    const cxx = X[t[2]] - X[p], cyy = Y[t[2]] - Y[p];
    return (ax * ax + ay * ay) * (bx * cyy - cxx * by)
      - (bx * bx + by * by) * (ax * cyy - cxx * ay)
      + (cxx * cxx + cyy * cyy) * (ax * by - bx * ay) > 0;
  };
  const M = X.length + 100000;
  const insert = (p: number): void => {
    const bad: number[][] = [];
    const keep: number[][] = [];
    for (const t of T) (inCircle(t, p) ? bad : keep).push(t);
    if (!bad.length) return;
    for (const t of bad) for (let k = 0; k < 3; k++) {
      if (X[t[k]] === X[p] && Y[t[k]] === Y[p]) return; // duplicate point: leave it unused
    }
    const dir = new Set<number>();
    for (const t of bad) for (let k = 0; k < 3; k++) dir.add(t[k] * M + t[(k + 1) % 3]);
    for (const t of bad) for (let k = 0; k < 3; k++) {
      const a = t[k], b = t[(k + 1) % 3];
      if (!dir.has(b * M + a)) keep.push([a, b, p]);
    }
    T = keep;
  };
  // Points that coincide (to a micro-pixel) are one point: the later copies stay out of the triangulation and the segments use the first, so a segment
  // never ends at a point that was left unused (it could not become an edge, and splitting it would go on for ever).
  const first = new Map<string, number>(), same: number[] = [];
  for (let i = 0; i < n; i++) {
    const key = `${Math.round(pts[2 * i] * 1e6)},${Math.round(pts[2 * i + 1] * 1e6)}`;
    const at = first.get(key);
    if (at === undefined) { first.set(key, i); same.push(i); } else same.push(at);
  }
  for (let i = 3; i < X.length; i++) if (same[i - 3] === i - 3) insert(i);

  const edges: number[] = segs.map(i => same[i] + 3);
  // A segment that crosses another one, or runs through a point, can never become an edge, and halving it for ever fills memory (and leaves slivers behind).
  // A segment is split at most MAX_SPLIT_DEPTH levels deep and not once its pieces are all but points; what is still missing then is left as it is.
  const depth = segs.map(() => 0);
  const maxPoints = n + 3 + 20 * (segs.length / 2) + 1000;
  for (let pass = 0; pass < 100; pass++) {
    const have = new Set<number>();
    for (const t of T) for (let k = 0; k < 3; k++) {
      const a = t[k], b = t[(k + 1) % 3];
      have.add(a * M + b); have.add(b * M + a);
    }
    let changed = false;
    for (let s = 0; s < edges.length; s += 2) {
      const a = edges[s], b = edges[s + 1];
      if (a === b || have.has(a * M + b)) continue;
      if (depth[s / 2] >= MAX_SPLIT_DEPTH || Math.hypot(X[a] - X[b], Y[a] - Y[b]) <= 1e-6 * ext || X.length >= maxPoints) continue;
      const m = X.length;
      X.push((X[a] + X[b]) / 2); Y.push((Y[a] + Y[b]) / 2);
      insert(m);
      edges[s + 1] = m; edges.push(m, b);
      depth[s / 2]++; depth.push(depth[s / 2]);
      changed = true;
    }
    if (!changed) break;
  }

  const verts: number[] = [];
  for (let i = 3; i < X.length; i++) verts.push(X[i], Y[i]);
  const tris: number[] = [];
  for (const t of T) if (t[0] > 2 && t[1] > 2 && t[2] > 2) tris.push(t[0] - 3, t[1] - 3, t[2] - 3);
  return { verts, tris };
}

// ---- geometry helpers -----------------------------------------------------------------------------------------------

const cross = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number =>
  (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

const polyArea = signedArea, inPoly = pointInPolygon;
const segDist = (px: number, py: number, a: Pt, b: Pt): number => segmentDistance(px, py, a[0], a[1], b[0], b[1]);

/** Douglas-Peucker on a closed loop, split at the point farthest from the first. */
function simplifyClosed(p: Pt[], tol: number): Pt[] {
  const n = p.length;
  if (n <= 3) return p;
  let f = 1, best = -1;
  for (let i = 1; i < n; i++) {
    const d = Math.hypot(p[i][0] - p[0][0], p[i][1] - p[0][1]);
    if (d > best) { best = d; f = i; }
  }
  const keep = new Uint8Array(n);
  keep[0] = 1; keep[f] = 1;
  const stack: number[][] = [[0, f], [f, n]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    const a = p[i % n], b = p[j % n];
    let far = -1, fd = tol;
    for (let k = i + 1; k < j; k++) {
      const d = segDist(p[k][0], p[k][1], a, b);
      if (d > fd) { fd = d; far = k; }
    }
    if (far >= 0) { keep[far] = 1; stack.push([i, far], [far, j]); }
  }
  return p.filter((_, i) => keep[i]);
}

// ---- outline ---------------------------------------------------------------------------------------------------------

/** Felzenszwalb squared Euclidean distance transform, in place on a w*h array (0 at sources, large elsewhere). */
function edt(f: Float64Array, w: number, h: number): void {
  const m = Math.max(w, h);
  const col = new Float64Array(m), out = new Float64Array(m), z = new Float64Array(m + 1), v = new Int32Array(m);
  const pass = (n: number, get: (i: number) => number, put: (i: number, d: number) => void) => {
    for (let i = 0; i < n; i++) col[i] = get(i);
    let k = 0;
    v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
    for (let q = 1; q < n; q++) {
      let s = ((col[q] + q * q) - (col[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((col[q] + q * q) - (col[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      out[q] = (q - v[k]) * (q - v[k]) + col[v[k]];
    }
    for (let i = 0; i < n; i++) put(i, out[i]);
  };
  for (let x = 0; x < w; x++) pass(h, i => f[i * w + x], (i, d) => { f[i * w + x] = d; });
  for (let y = 0; y < h; y++) pass(w, i => f[y * w + i], (i, d) => { f[y * w + i] = d; });
}

interface Island { outer: Pt[]; holes: Pt[][]; area: number }

/** Dilated, traced, simplified islands (image pixels), largest first. */
function buildIslands(cells: Uint8Array, gw: number, gh: number, c: number, r: number, tol: number, minHole: number): Island[] {
  const pad = Math.ceil(r / c) + 2;
  const pw = gw + 2 * pad, ph = gh + 2 * pad;
  const f = new Float64Array(pw * ph).fill(1e9);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) if (cells[y * gw + x]) f[(y + pad) * pw + x + pad] = 0;
  edt(f, pw, ph);
  const rc = r / c;
  const mask = new Uint8Array(pw * ph);
  // The mesh stays inside the image box: the texture has no pixels outside it (clamp-to-edge would smear the border row), so the margin only grows inward.
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) { const i = (y + pad) * pw + x + pad; mask[i] = f[i] <= rc * rc ? 1 : 0; }
  const toPx = (p: Pt): Pt => [(p[0] - pad) * c, (p[1] - pad) * c];
  const outers: Island[] = [];
  const holes: Pt[][] = [];
  for (const loop of traceLoops(mask, pw, ph)) {
    const raw = loop.map(toPx);
    const a = polyArea(raw);
    const s = simplifyClosed(raw, tol);
    if (s.length < 3 || Math.abs(polyArea(s)) < 1e-6) continue;
    if (a > 0) outers.push({ outer: s, holes: [], area: polyArea(s) });
    else if (-polyArea(s) >= minHole) holes.push(s);
  }
  outers.sort((p, q) => q.area - p.area);
  for (const hole of holes) {
    const hx = hole.reduce((s, p) => s + p[0], 0) / hole.length, hy = hole.reduce((s, p) => s + p[1], 0) / hole.length;
    // Smallest outer loop containing the hole.
    for (let i = outers.length - 1; i >= 0; i--) {
      if (inPoly(outers[i].outer, hx, hy)) { outers[i].holes.push(hole); break; }
    }
  }
  return outers;
}

// ---- meshing ---------------------------------------------------------------------------------------------------------

/** The ring without consecutive points closer than a micro-pixel: float noise from the tracing can leave such a pair, and a segment between them cannot be triangulated. */
function dedupeRing(ring: Pt[]): Pt[] {
  const near = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= 1e-6;
  const out: Pt[] = [];
  for (const p of ring) if (!out.length || !near(p, out[out.length - 1])) out.push(p);
  while (out.length > 1 && near(out[0], out[out.length - 1])) out.pop();
  return out;
}

function meshIsland(isl: Island, spacing: number): GeneratedMesh {
  const pts: number[] = [], segs: number[] = [];
  const rings = [isl.outer, ...isl.holes].map(dedupeRing);
  for (const ring of rings) {
    const first = pts.length / 2;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const pieces = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / spacing));
      for (let k = 0; k < pieces; k++) pts.push(a[0] + (b[0] - a[0]) * k / pieces, a[1] + (b[1] - a[1]) * k / pieces);
    }
    const count = pts.length / 2 - first;
    for (let i = 0; i < count; i++) segs.push(first + i, first + (i + 1) % count);
  }
  const inRegion = (x: number, y: number) => inPoly(isl.outer, x, y) && !isl.holes.some(h => inPoly(h, x, y));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of isl.outer) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const rowH = spacing * Math.sqrt(3) / 2, clear = spacing * EDGE_CLEARANCE;
  for (let row = 0, y = minY + rowH / 2; y < maxY; row++, y += rowH) {
    for (let x = minX + (row % 2 ? spacing : spacing / 2); x < maxX; x += spacing) {
      if (!inRegion(x, y)) continue;
      if (rings.some(ring => ring.some((a, i) => segDist(x, y, a, ring[(i + 1) % ring.length]) < clear))) continue;
      pts.push(x, y);
    }
  }
  const t = triangulate(pts, segs);
  // Keep triangles inside the region, then drop vertices nothing uses.
  const kept: number[] = [];
  for (let i = 0; i < t.tris.length; i += 3) {
    const a = t.tris[i], b = t.tris[i + 1], c = t.tris[i + 2];
    const ax = t.verts[2 * a], ay = t.verts[2 * a + 1], bx = t.verts[2 * b], by = t.verts[2 * b + 1], cx = t.verts[2 * c], cy = t.verts[2 * c + 1];
    if (cross(ax, ay, bx, by, cx, cy) <= 1e-9) continue;
    if (inRegion((ax + bx + cx) / 3, (ay + by + cy) / 3)) kept.push(a, b, c);
  }
  const remap = new Map<number, number>();
  const verts: number[] = [];
  const tris = kept.map(i => {
    let m = remap.get(i);
    if (m === undefined) { m = verts.length / 2; remap.set(i, m); verts.push(t.verts[2 * i], t.verts[2 * i + 1]); }
    return m;
  });
  return { verts, tris };
}

/**
 * Generate a triangle mesh covering the opaque part of an alpha image (alpha >= MESH_ALPHA_THRESHOLD) plus a margin.
 * Holes bigger than a few spacings stay holes; smaller ones are filled. Several islands give one mesh with separate
 * parts. A fully transparent image gives an empty mesh. The vertex count never exceeds maxVerts.
 */
export function generateMesh(
  alpha: Uint8Array | Uint8ClampedArray, width: number, height: number, opts: MeshGenOptions,
): GeneratedMesh {
  const preset = MESH_DETAIL[opts.detail];
  if (!preset) throw new Error(`Unknown mesh detail "${opts.detail}"`);
  const cap = Math.floor(opts.maxVerts ?? MESH_MAX_VERTS);
  const empty: GeneratedMesh = { verts: [], tris: [] };
  if (!(width >= 1) || !(height >= 1) || alpha.length < width * height || cap < 4) return empty;

  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (alpha[y * width + x] < MESH_ALPHA_THRESHOLD) continue;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (x1 < 0) return empty;
  const B = Math.max(x1 - x0 + 1, y1 - y0 + 1);
  // At least MIN_MARGIN pixels: with none the outline follows every step of the pixel edge and makes far more vertices than any detail asks
  // for (SD-14: legs at Medium went from 23 vertices to 197).
  const margin = Math.max(MIN_MARGIN, opts.margin ?? DEFAULT_MARGIN * B);

  // Working grid: one cell per c x c pixels, opaque when any pixel in it is.
  const c = Math.max(1, Math.ceil(Math.max(width, height) / WORK_SIZE));
  const gw = Math.ceil(width / c), gh = Math.ceil(height / c);
  const cells = new Uint8Array(gw * gh);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (alpha[y * width + x] >= MESH_ALPHA_THRESHOLD) cells[Math.floor(y / c) * gw + Math.floor(x / c)] = 1;
  }

  const maxIslands = Math.max(1, Math.floor(cap / 6));
  for (let i = 0, k = 1; i < COARSEN_TRIES; i++, k *= COARSEN_STEP) {
    const tol = Math.max(MESH_MIN_TOL, preset.tol * B) * k;
    const spacing = Math.max(MESH_MIN_SPACING, preset.spacing * B) * k;
    const islands = buildIslands(cells, gw, gh, c, margin + tol, tol, spacing * spacing * 0.5).slice(0, maxIslands);
    // Skip attempts that would obviously blow the cap, so a tiny spacing never makes the triangulation crawl.
    let est = 0;
    for (const isl of islands) {
      est += isl.area / (spacing * spacing * 0.866);
      for (const ring of [isl.outer, ...isl.holes]) est += ring.reduce((s, p, j) => s + Math.hypot(p[0] - ring[(j + 1) % ring.length][0], p[1] - ring[(j + 1) % ring.length][1]), 0) / spacing;
    }
    if (est > cap * 3) continue;
    const out: GeneratedMesh = { verts: [], tris: [] };
    for (const isl of islands) {
      const m = meshIsland(isl, spacing);
      const base = out.verts.length / 2;
      for (const v of m.verts) out.verts.push(v);
      for (const t of m.tris) out.tris.push(t + base);
    }
    if (out.verts.length / 2 <= cap) {
      for (let i = 0; i < out.verts.length; i += 2) { out.verts[i] = Math.min(width, Math.max(0, out.verts[i])); out.verts[i + 1] = Math.min(height, Math.max(0, out.verts[i + 1])); } // the last working cell may overhang the image
      return out;
    }
  }
  // Last resort: the opaque box plus margin (inside the image) as two triangles.
  const ax = Math.max(0, x0 - margin), ay = Math.max(0, y0 - margin), bx = Math.min(width, x1 + 1 + margin), by = Math.min(height, y1 + 1 + margin);
  return { verts: [ax, ay, bx, ay, bx, by, ax, by], tris: [0, 1, 2, 0, 2, 3] };
}
