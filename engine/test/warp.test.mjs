import { test } from 'node:test';
import assert from 'node:assert/strict';
import { restLattice, applyDisplacement, evalDeformer, unwarpPoint } from '../../dist/engine/src/index.js';

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
