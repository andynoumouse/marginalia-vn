import { test } from 'node:test';
import assert from 'node:assert/strict';
import { meshEdges, meshAdjacency, locateInMesh, unwarpMeshPoint, sampleMesh, meshGraphDistance, meshBox, warpFreeMesh, warpMeshPoints } from '../../dist/engine/src/index.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} is not ${b}`);
// a square 0-10 split along a diagonal, plus a tail triangle: 0 1 2 / 2 1 3 / 1 4 3
const verts = [0, 0, 10, 0, 0, 10, 10, 10, 20, 5];
const tris = [0, 1, 2, 2, 1, 3, 1, 4, 3];

test('meshEdges lists each edge once, low index first', () => {
  const edges = meshEdges(tris);
  assert.equal(edges.length, 7);
  assert.deepEqual(edges.slice(0, 3), [[0, 1], [1, 2], [0, 2]]);
  assert.ok(edges.every(([a, b]) => a < b));
  assert.deepEqual(meshEdges([]), []);
});

test('meshAdjacency gives sorted neighbours', () => {
  const adj = meshAdjacency(5, tris);
  assert.deepEqual(adj[0], [1, 2]);
  assert.deepEqual(adj[1], [0, 2, 3, 4]);
  assert.deepEqual(adj[4], [1, 3]);
});

test('locateInMesh finds the triangle and barycentric weights', () => {
  const hit = locateInMesh(verts, tris, 2, 2);
  assert.equal(hit.tri, 0);
  near(hit.u, 0.6); near(hit.v, 0.2); near(hit.w, 0.2);
  assert.equal(locateInMesh(verts, tris, 8, 8).tri, 1);
  assert.equal(locateInMesh(verts, tris, 15, 5).tri, 2);
  assert.equal(locateInMesh(verts, tris, -1, 5), null);
  assert.equal(locateInMesh(verts, tris, 19, 0), null);
  assert.ok(locateInMesh(verts, tris, 0, 0), 'a vertex is inside');
  assert.equal(locateInMesh(verts, [], 1, 1), null);
});

test('locateInMesh skips a collapsed triangle and lets the later of two overlapping ones win', () => {
  assert.equal(locateInMesh([0, 0, 5, 0, 10, 0], [0, 1, 2], 5, 0), null);
  const v = [0, 0, 10, 0, 0, 10, 0, 0, 10, 0, 0, 10];
  assert.equal(locateInMesh(v, [0, 1, 2, 3, 4, 5], 2, 2).tri, 1);
});

test('unwarpMeshPoint maps a deformed position back to rest', () => {
  const moved = verts.map((v, i) => (i % 2 === 0 ? v + 5 : v)); // shifted right by 5
  const p = unwarpMeshPoint(verts, moved, tris, 7, 2);
  near(p[0], 2); near(p[1], 2);
  assert.equal(unwarpMeshPoint(verts, moved, tris, 2, 2), null, 'the rest spot is outside the drawn mesh now');
  const wide = verts.map((v, i) => (i % 2 === 0 ? v * 2 : v)); // x doubled
  const q = unwarpMeshPoint(verts, wide, tris, 12, 3);
  near(q[0], 6); near(q[1], 3);
});

test('sampleMesh blends vertex displacement, clamping outside', () => {
  const disp = [0, 0, 0.1, 0, 0, 0.1, 0.1, 0.1, 0.2, 0];
  const mid = sampleMesh(disp, verts, tris, 5, 5);
  near(mid[0], 0.05); near(mid[1], 0.05);
  const at0 = sampleMesh(disp, verts, tris, 0, 0);
  near(at0[0], 0); near(at0[1], 0);
  const far = sampleMesh(disp, verts, tris, 40, 5); // nearest is the tail triangle, clamped onto it
  assert.ok(far[0] <= 0.2 + 1e-9 && far[0] >= 0.1 - 1e-9);
  assert.deepEqual(sampleMesh(disp, verts, [], 1, 1), [0, 0]);
  assert.deepEqual(sampleMesh([], verts, tris, 3, 3), [0, 0], 'missing displacement reads as 0');
});

test('meshGraphDistance counts hops from the start set', () => {
  assert.deepEqual([...meshGraphDistance(5, tris, [0])], [0, 1, 1, 2, 2]);
  assert.deepEqual([...meshGraphDistance(5, tris, [0, 4])], [0, 1, 1, 1, 0]);
  assert.equal(meshGraphDistance(6, tris, [0])[5], Infinity, 'a vertex without edges is unreachable');
  assert.deepEqual([...meshGraphDistance(5, tris, [])], Array(5).fill(Infinity));
  assert.deepEqual([...meshGraphDistance(5, tris, [9, -1])], Array(5).fill(Infinity));
});

test('meshBox is the bounding box', () => {
  assert.deepEqual(meshBox(verts), [0, 0, 20, 10]);
  assert.deepEqual(meshBox([3, 4, -1, 8]), [-1, 4, 4, 4]);
  assert.equal(meshBox([]), null);
});

test('warpFreeMesh moves vertices by the own displacement and the group lattice at the rest position', () => {
  const own = [0.1, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const out = warpFreeMesh(verts, own, null, [0, 0], 100);
  near(out[0], 10); near(out[1], 0); near(out[2], 10); // vertex 1 untouched
  const group = { box: [100, 0, 20, 10], sample: (u, v) => [u * 0.1, 0] }; // the box starts at canvas x 100; the part sits at x 100
  const both = warpFreeMesh(verts, null, group, [100, 0], 100);
  near(both[2], 10 + 0.5 * 10); // vertex 1 at u = 10 / 20
  near(both[8], 20 + 1 * 10); // vertex 4 at u = 1
  const none = warpFreeMesh(verts, null, null, [0, 0], 100);
  assert.deepEqual([...none], verts);
});

test('warpMeshPoints carries points with the deformed triangles', () => {
  const moved = verts.map((v, i) => (i % 2 === 0 ? v + 5 : v)); // every vertex 5 to the right
  const out = warpMeshPoints([5, 5, 40, 5], verts, moved, tris);
  near(out[0], 10); near(out[1], 5);
  assert.ok(out[2] > 40 - 1e-6, 'a point off the mesh follows the nearest triangle');
});
