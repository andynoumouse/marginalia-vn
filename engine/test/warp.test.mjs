import { test } from 'node:test';
import assert from 'node:assert/strict';
import { restLattice, applyDisplacement, evalDeformer, unwarpPoint, sampleLattice, unionLatticeBox, warpMemberMesh, memberMeshGrid, MEMBER_MIN_GRID } from '../../dist/engine/src/index.js';

test('unwarpPoint: the identity at rest, a shifted mesh shifts the hit, outside the mesh is null', () => {
  const rest = restLattice(100, 100, [2, 2]);
  assert.deepEqual(unwarpPoint(rest, rest, [2, 2], 30, 70).map(Math.round), [30, 70]);
  const moved = applyDisplacement(rest, new Float32Array(rest.length).fill(0).map((_, i) => (i % 2 === 0 ? 0.25 : 0)), 100, 100);
  assert.deepEqual(unwarpPoint(moved, rest, [2, 2], 55, 40).map(Math.round), [30, 40], 'the art drawn at 55 is the art that rests at 30');
  assert.equal(unwarpPoint(moved, rest, [2, 2], 10, 40), null, 'where the art was, nothing is drawn now');
});

test('unwarpPoint: a stretched cell maps back linearly, and a collapsed one draws nothing', () => {
  const rest = restLattice(100, 100, [1, 1]);
  const wide = Float32Array.from([0, 0, 200, 0, 0, 100, 200, 100]); // twice as wide
  assert.deepEqual(unwarpPoint(wide, rest, [1, 1], 150, 50).map(Math.round), [75, 50]);
  const flat = Float32Array.from([0, 0, 100, 0, 0, 0, 100, 0]);
  assert.equal(unwarpPoint(flat, rest, [1, 1], 50, 0), null);
});

test('restLattice: a regular grid over the box, row-major', () => {
  const r = restLattice(100, 50, [2, 1]);
  assert.deepEqual([...r], [0, 0, 50, 0, 100, 0, 0, 50, 50, 50, 100, 50]);
});

test('applyDisplacement scales stage fractions and can reuse a buffer', () => {
  const rest = restLattice(100, 100, [1, 1]);
  const disp = new Float32Array([0.5, 0, 0, 0, 0, 0, 0, -0.25]);
  const out = new Float32Array(8);
  assert.equal(applyDisplacement(rest, disp, 200, 400, out), out);
  assert.deepEqual([...out], [100, 0, 100, 0, 0, 100, 100, 0]);
  assert.deepEqual([...applyDisplacement(rest, new Float32Array(8), 200, 400)], [...rest]);
});

test('a deformer evaluates straight into vertices', () => {
  const def = { id: 'd', part: 'p', grid: [1, 1], keyforms: [{ param: 'a', keys: [{ at: 0 }, { at: 1, pts: { 1: [0.1, 0] } }] }] };
  const v = applyDisplacement(restLattice(10, 10, [1, 1]), evalDeformer(def, { a: 1 }), 100, 100);
  assert.ok(Math.abs(v[2] - 20) < 1e-4 && v[3] === 0);
});

// ---- a warp over a group of parts ----

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} is not ${b}`);

test('union of boxes, and none', () => {
  assert.deepEqual(unionLatticeBox([[10, 20, 30, 40], [0, 50, 20, 20]]), [0, 20, 40, 50]);
  assert.equal(unionLatticeBox([]), null);
});

test('sampleLattice: the control points, bilinear between them, edge values outside', () => {
  // A 1x1 lattice: dx 0, 1, 2, 3 at top left, top right, bottom left, bottom right.
  const d = [0, 0, 1, 0, 2, 0, 3, 0];
  assert.deepEqual(sampleLattice(d, [1, 1], 0, 0), [0, 0]);
  assert.deepEqual(sampleLattice(d, [1, 1], 1, 1), [3, 0]);
  near(sampleLattice(d, [1, 1], 0.5, 0.5)[0], 1.5);
  near(sampleLattice(d, [1, 1], 0.5, 0)[0], 0.5);
  assert.deepEqual(sampleLattice(d, [1, 1], -3, 9), [2, 0], 'outside the box the nearest edge value holds');
  // A 2x1 lattice: the middle column moves, the others do not.
  const m = [0, 0, 0.2, 0.1, 0, 0, 0, 0, 0.2, 0.1, 0, 0];
  near(sampleLattice(m, [2, 1], 0.25, 0.5)[0], 0.1);
  near(sampleLattice(m, [2, 1], 0.5, 0.5)[1], 0.1);
});

test('a member mesh: the group lattice is sampled at the vertex rest position in canvas pixels', () => {
  const rest = restLattice(100, 100, [1, 1]);
  // The part's box sits at canvas (200, 50); the group box is [100, 50, 400, 100]: the part covers its middle half horizontally.
  const group = { box: [100, 50, 400, 100], grid: [1, 1], disp: [0, 0, 0.4, 0, 0, 0, 0.4, 0] }; // the right edge moves 0.4, the left none
  const out = warpMemberMesh(rest, [1, 1], null, group, [200, 50], 1000);
  // Vertex x = 0 sits at canvas 200: a quarter of the way across the group box: 0.1 of 1000 px. x = 100 sits at 300: 0.5 across, 0.2.
  near(out[0], 0 + 100); near(out[2], 100 + 200); near(out[1], 0);
});

test('a member mesh: own warp first, and the group lattice sees where the vertex rested, not where its own warp moved it', () => {
  const rest = restLattice(100, 100, [1, 1]);
  const own = { grid: [1, 1], disp: [0.5, 0, 0.5, 0, 0.5, 0, 0.5, 0] }; // the whole part moves by half a unit
  const group = { box: [0, 0, 100, 100], grid: [1, 1], disp: [0, 0, 0.1, 0, 0, 0, 0.1, 0] }; // left edge still, right edge 0.1
  const both = warpMemberMesh(rest, [1, 1], own, group, [0, 0], 100);
  const only = warpMemberMesh(rest, [1, 1], own, null, [0, 0], 100), grp = warpMemberMesh(rest, [1, 1], null, group, [0, 0], 100);
  for (let i = 0; i < both.length; i++) near(both[i], only[i] + grp[i] - rest[i]);
  near(both[0], 50);        // left vertex: own 50, group 0
  near(both[2], 100 + 50 + 10); // right vertex: own 50, group 10, however far the own warp moved it
});

test('a member mesh finer than its own lattice samples that lattice; the mesh grid floors at MEMBER_MIN_GRID inside a group', () => {
  assert.deepEqual(memberMeshGrid(null, true), [MEMBER_MIN_GRID, MEMBER_MIN_GRID]);
  assert.deepEqual(memberMeshGrid([4, 12], true), [MEMBER_MIN_GRID, 12]);
  assert.deepEqual(memberMeshGrid([2, 2], false), [2, 2], 'a part warp alone keeps its own lattice as its mesh');
  const grid = memberMeshGrid([1, 1], true), rest = restLattice(80, 80, grid);
  const own = { grid: [1, 1], disp: [0, 0, 0.1, 0, 0, 0, 0.1, 0] }; // a ramp across the part
  const out = warpMemberMesh(rest, grid, own, null, [0, 0], 100);
  const mid = (grid[0] / 2); // the vertex in the middle of the first row
  near(out[mid * 2] - rest[mid * 2], 5);
  near(out[0] - rest[0], 0);
});

test('a group deformer with no group is the same as before: the mesh follows its own lattice exactly', () => {
  const rest = restLattice(100, 100, [2, 2]);
  const disp = evalDeformer({ id: 'd', part: 'p', grid: [2, 2], keyforms: [{ param: 'x', keys: [{ at: 0, pts: { 4: [0.1, 0.2] } }, { at: 1, pts: { 4: [0.1, 0.2] } }] }] }, { x: 0.5 });
  const a = warpMemberMesh(rest, [2, 2], { grid: [2, 2], disp }, null, [0, 0], 100), b = applyDisplacement(rest, disp, 100, 100);
  assert.deepEqual([...a], [...b]);
});
