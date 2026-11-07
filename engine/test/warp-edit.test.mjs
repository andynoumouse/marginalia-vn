import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDeformer, checkDeformers, deformerOf, deleteWarpKey, dragWarpPoint, evalDeformer, latticeEdges, mirrorWarp, ownDisplacement, pickPoint,
  removeDeformer, replaceDeformer, resetWarpPoint, resizeWarp, setWarpOwn, smoothWarp, warpKeyAt, warpKeyValues, warpPreset, WARP_PRESETS,
} from '../../dist/engine/src/index.js';

const near = (a, b, eps = 1e-5) => assert.ok(Math.abs(a - b) <= eps, `${a} is not ${b}`);
const nearAll = (a, b, eps = 1e-5) => { assert.equal(a.length, b.length); a.forEach((x, i) => near(x, b[i], eps)); };
const sway = { id: 'sway', min: 0, max: 1, default: 0 };
const turn = { id: 'turn', min: -1, max: 1, default: 0 };
const deformer = (keyforms = [], grid = [2, 2]) => ({ id: 'd', part: 'p', grid, keyforms });
const problems = def => { const out = []; checkDeformers({ deformers: [def], parameters: [sway, turn] }, new Set(['p']), new Set(), new Set(), m => out.push(m)); return out; };
const at = (def, id, v) => [...evalDeformer(def, { [id]: v })];

test('a drag on a point at a key writes its displacement there, sparse', () => {
  const def = deformer([{ param: 'sway', keys: [{ at: 0 }, { at: 1 }] }]);
  const next = dragWarpPoint(def, sway, 1, 4, [0.01, -0.02]);
  assert.deepEqual(next.keyforms[0].keys, [{ at: 0 }, { at: 1, pts: { 4: [0.01, -0.02] } }]);
  assert.deepEqual(def.keyforms[0].keys, [{ at: 0 }, { at: 1 }], 'the input is not touched');
  nearAll(at(next, 'sway', 1).slice(8, 10), [0.01, -0.02]);
  assert.deepEqual(problems(next), []);
});

test('dragging again adds to what the key holds, and a point moved back to rest leaves the key', () => {
  let def = deformer([{ param: 'sway', keys: [{ at: 0 }, { at: 1, pts: { 4: [0.01, 0] } }] }]);
  def = dragWarpPoint(def, sway, 1, 4, [0.005, 0.01]);
  assert.deepEqual(def.keyforms[0].keys[1].pts, { 4: [0.015, 0.01] });
  def = dragWarpPoint(def, sway, 1, 4, [-0.015, -0.01]);
  assert.equal('pts' in def.keyforms[0].keys[1], false, 'an empty pts is dropped');
  assert.deepEqual(def.keyforms[0].keys[1], { at: 1 });
});

test('a value close to a key edits that key and the point still lands where it was dragged', () => {
  const def = deformer([{ param: 'sway', keys: [{ at: 0, pts: { 4: [0.002, 0] } }, { at: 1, pts: { 4: [0.01, 0] } }] }]);
  assert.equal(warpKeyAt(def, sway, 0.99), 1);
  const next = dragWarpPoint(def, sway, 0.99, 4, [0.004, 0.003]);
  assert.equal(next.keyforms[0].keys.length, 2, 'no key was added');
  const was = at(def, 'sway', 0.99), now = at(next, 'sway', 0.99);
  near(now[8] - was[8], 0.004);
  near(now[9] - was[9], 0.003);
});

test('a value away from every key inserts a key there that leaves the curve as it was', () => {
  const def = deformer([{ param: 'sway', keys: [{ at: 0 }, { at: 1, pts: { 4: [0.01, 0], 8: [0.02, 0.02] } }] }]);
  assert.equal(warpKeyAt(def, sway, 0.5), null);
  const next = dragWarpPoint(def, sway, 0.5, 0, [0, 0.01]);
  assert.deepEqual(next.keyforms[0].keys.map(k => k.at), [0, 0.5, 1]);
  assert.deepEqual(next.keyforms[0].keys[1].pts, { 0: [0, 0.01], 4: [0.005, 0], 8: [0.01, 0.01] }, 'the new key holds the interpolated shape plus the drag');
  // everything but the dragged point is the same along the whole range
  for (const v of [0, 0.2, 0.5, 0.8, 1]) {
    const a = at(def, 'sway', v), b = at(next, 'sway', v);
    a.forEach((x, i) => { if (i > 1) near(b[i], x); });
  }
  near(at(next, 'sway', 0.5)[1], 0.01);
  assert.deepEqual(problems(next), []);
});

test('the first key of a parameter with no keyform comes with an empty key at the default', () => {
  const def = deformer();
  const next = dragWarpPoint(def, turn, 0.6, 4, [0.02, 0]);
  assert.deepEqual(next.keyforms, [{ param: 'turn', keys: [{ at: 0 }, { at: 0.6, pts: { 4: [0.02, 0] } }] }]);
  near(at(next, 'turn', 0.3)[8], 0.01, 1e-9);
  assert.deepEqual(problems(next), []);
});

test('at the default value the first key is that one key', () => {
  const next = dragWarpPoint(deformer(), sway, 0, 0, [0.01, 0]);
  assert.deepEqual(next.keyforms[0].keys, [{ at: 0, pts: { 0: [0.01, 0] } }]);
});

test('a value past the last key inserts a key that holds the end shape', () => {
  const def = deformer([{ param: 'turn', keys: [{ at: 0 }, { at: 0.5, pts: { 4: [0.01, 0] } }] }]);
  const next = dragWarpPoint(def, turn, 1, 0, [0.02, 0]);
  assert.deepEqual(next.keyforms[0].keys.map(k => k.at), [0, 0.5, 1]);
  assert.deepEqual(next.keyforms[0].keys[2].pts, { 0: [0.02, 0], 4: [0.01, 0] });
});

test('the value is clamped to the parameter range', () => {
  const next = dragWarpPoint(deformer(), sway, 7, 0, [0.01, 0]);
  assert.deepEqual(warpKeyValues(next, 'sway'), [0, 1]);
});

test('other keyforms and other parameters\' keys are left alone and the rest of the deformer is kept', () => {
  const other = { param: 'turn', keys: [{ at: 0 }, { at: 1, pts: { 1: [0.1, 0] } }] };
  const grid2 = { params: ['sway', 'turn'], grid: { x: [0, 1], y: [0, 1] }, forms: [{}, {}, {}, { pts: { 0: [0.3, 0] } }] };
  const def = deformer([other, grid2]);
  const next = dragWarpPoint(def, sway, 1, 4, [0.01, 0]);
  assert.deepEqual(next.keyforms[0], other);
  assert.deepEqual(next.keyforms[1], grid2);
  assert.equal(next.keyforms.length, 3);
  assert.equal(next.id, 'd');
  assert.deepEqual(next.grid, [2, 2]);
});

test('a drag that changes nothing hands back the same deformer; a point out of range too', () => {
  const def = deformer([{ param: 'sway', keys: [{ at: 0 }, { at: 1 }] }]);
  assert.equal(dragWarpPoint(def, sway, 1, 4, [0, 0]), def);
  assert.equal(dragWarpPoint(def, sway, 1, 9, [0.1, 0]), def);
  assert.equal(dragWarpPoint(def, sway, 1, -1, [0.1, 0]), def);
  assert.equal(resetWarpPoint(def, sway, 1, 4), def, 'resetting a point at rest is no change');
});

test('stored displacements are rounded to five decimals', () => {
  const next = dragWarpPoint(deformer([{ param: 'sway', keys: [{ at: 0 }, { at: 1 }] }]), sway, 1, 4, [0.0123456789, -1e-9]);
  assert.deepEqual(next.keyforms[0].keys[1].pts, { 4: [0.01235, 0] });
});

test('reset point takes the point back to rest in that key only', () => {
  const def = deformer([{ param: 'sway', keys: [{ at: 0, pts: { 4: [0.5, 0] } }, { at: 1, pts: { 4: [0.01, 0], 5: [0.02, 0] } }] }]);
  const next = resetWarpPoint(def, sway, 1, 4);
  assert.deepEqual(next.keyforms[0].keys, [{ at: 0, pts: { 4: [0.5, 0] } }, { at: 1, pts: { 5: [0.02, 0] } }]);
});

test('delete key removes the key the value selects and the keyform with its last key', () => {
  const def = deformer([{ param: 'sway', keys: [{ at: 0 }, { at: 1, pts: { 4: [0.01, 0] } }] }]);
  const one = deleteWarpKey(def, sway, 1);
  assert.deepEqual(one.keyforms[0].keys, [{ at: 0 }]);
  assert.equal(deleteWarpKey(def, sway, 0.5), def, 'no key there');
  assert.deepEqual(deleteWarpKey(one, sway, 0).keyforms, []);
});

test('setWarpOwn takes several points at once', () => {
  const def = deformer([{ param: 'sway', keys: [{ at: 0 }, { at: 1 }] }]);
  const next = setWarpOwn(def, sway, 1, [[0, [0.01, 0]], [8, [0, 0.01]]]);
  assert.deepEqual(next.keyforms[0].keys[1].pts, { 0: [0.01, 0], 8: [0, 0.01] });
  nearAll(ownDisplacement(next, sway, 1).slice(0, 2), [0.01, 0]);
  assert.deepEqual(ownDisplacement(def, turn, 1), new Array(18).fill(0), 'no keyform for the parameter: zeros');
});

test('mirror copies one half of the lattice across the axis with dx flipped', () => {
  // 2x2 cells: points 0..8, columns 0 1 2 per row
  const def = deformer([{ param: 'sway', keys: [{ at: 0 }, { at: 1, pts: { 0: [0.01, 0.02], 3: [0.03, 0], 4: [0.05, 0.01] } }] }]);
  const right = mirrorWarp(def, sway, 1, 'left');
  assert.deepEqual(right.keyforms[0].keys[1].pts, { 0: [0.01, 0.02], 2: [-0.01, 0.02], 3: [0.03, 0], 5: [-0.03, 0], 4: [0, 0.01] });
  const left = mirrorWarp(def, sway, 1, 'right');
  assert.deepEqual(left.keyforms[0].keys[1].pts, { 4: [0, 0.01] }, 'the right half was at rest, so the left goes to rest');
});

test('smooth pulls a lone bump toward its neighbours', () => {
  const def = deformer([{ param: 'sway', keys: [{ at: 0 }, { at: 1, pts: { 4: [0.04, 0] } }] }]);
  const next = smoothWarp(def, sway, 1, 0.5);
  const own = ownDisplacement(next, sway, 1);
  near(own[8], 0.02);
  near(own[2], 0.04 * 0.5 * (1 / 3), 1e-5);   // point 1 has three neighbours, one of them the bump
  near(own[0], 0, 1e-9);                       // a corner two steps away is untouched
  // a flat shape stays flat
  const flat = deformer([{ param: 'sway', keys: [{ at: 0 }, { at: 1, pts: Object.fromEntries([...Array(9).keys()].map(i => [i, [0.01, 0.01]])) }] }]);
  assert.equal(smoothWarp(flat, sway, 1), flat);
});

test('resizing keeps the displacement field, sampled on the new lattice', () => {
  const def = deformer([{ param: 'sway', keys: [{ at: 0 }, { at: 1, pts: { 0: [0, 0], 1: [0.02, 0], 2: [0.04, 0], 3: [0, 0], 4: [0.02, 0], 5: [0.04, 0], 6: [0, 0], 7: [0.02, 0], 8: [0.04, 0] } }] }], [2, 2]);
  const bigger = resizeWarp(def, [4, 1]);
  assert.deepEqual(bigger.grid, [4, 1]);
  const own = ownDisplacement(bigger, sway, 1);
  for (let i = 0; i <= 4; i++) { near(own[i * 2], 0.01 * i, 1e-5); near(own[(5 + i) * 2], 0.01 * i, 1e-5); }
  assert.deepEqual(problems(bigger), []);
  assert.equal(resizeWarp(def, [2, 2]), def);
  assert.deepEqual(resizeWarp(def, [99, 0]).grid, [12, 1], 'clamped to 1..12');
  // a point outside the new lattice would be an error; resizing never leaves one
  assert.deepEqual(problems(resizeWarp(def, [1, 1])), []);
});

test('resizing a deformer with no grid (the default 4x4) works too, and 2D forms are resampled', () => {
  const def = { id: 'd', part: 'p', keyforms: [{ params: ['sway', 'turn'], grid: { x: [0, 1], y: [-1, 1] }, forms: [{}, { pts: { 12: [0.1, 0] } }, {}, {}] }] };
  const next = resizeWarp(def, [2, 2]);
  assert.deepEqual(next.grid, [2, 2]);
  assert.deepEqual(problems(next), []);
  assert.deepEqual(Object.keys(next.keyforms[0].forms[1].pts), ['4']);
});

test('adding a deformer names it after the part, once, and removing takes it away', () => {
  const one = addDeformer([], 'hair');
  assert.deepEqual(one, [{ id: 'hair_warp', part: 'hair', grid: [4, 4], keyforms: [] }]);
  assert.deepEqual(addDeformer(one, 'hair'), one, 'a part has one');
  const two = addDeformer([{ id: 'face_warp', part: 'x', keyforms: [] }], 'face', [30, 2]);
  assert.equal(two[1].id, 'face_warp2');
  assert.deepEqual(two[1].grid, [12, 2]);
  assert.equal(deformerOf(two, 'face').id, 'face_warp2');
  assert.deepEqual(removeDeformer(two, 'face').map(d => d.id), ['face_warp']);
  assert.deepEqual(replaceDeformer(two, { ...two[1], grid: [3, 3] })[1].grid, [3, 3]);
});

test('presets write explicit keys: rest at the default, the shape at the ends', () => {
  const box = { w: 0.4, h: 0.6 };
  const def = deformer([], [2, 2]);
  const s = warpPreset(def, turn, 'sway', box, { amount: 0.1 });
  assert.deepEqual(s.keyforms[0].keys.map(k => k.at), [-1, 0, 1]);
  assert.equal('pts' in s.keyforms[0].keys[1], false);
  // the top row stays, the bottom row moves the most; the other side mirrors
  const top = ownDisplacement(s, turn, 1);
  near(top[0], 0); near(top[4 * 2], 0.1 * 0.4 * 0.25); near(top[8 * 2], 0.1 * 0.4);
  near(ownDisplacement(s, turn, -1)[16], -0.04);
  assert.deepEqual(problems(s), []);
  // a 0..1 parameter gets no key below the default
  assert.deepEqual(warpPreset(def, sway, 'sway', box).keyforms[0].keys.map(k => k.at), [0, 1]);
  assert.ok(WARP_PRESETS.every(p => p.amount > 0 && p.hint));
});

test('breathe scales about the pivot', () => {
  const s = warpPreset(deformer([], [2, 2]), sway, 'breathe', { w: 0.4, h: 0.6 }, { amount: 0.1, pivot: [0.5, 1] });
  const d = ownDisplacement(s, sway, 1);
  near(d[0], -0.5 * 0.4 * 0.1); near(d[1], -1 * 0.6 * 0.1);   // the top left corner moves up and out
  near(d[8 * 2], 0.5 * 0.4 * 0.1); near(d[8 * 2 + 1], 0);      // the bottom right moves out only
  near(d[7 * 2], 0); near(d[7 * 2 + 1], 0);                    // the pivot stays
});

test('sine and noise: sine is pinned at the top, noise repeats with its seed and differs with another', () => {
  const box = { w: 0.4, h: 0.6 }, def = deformer([], [2, 4]);
  const sine = ownDisplacement(warpPreset(def, sway, 'sine', box, { waves: 1, amount: 0.05 }), sway, 1);
  near(sine[0], 0);
  near(sine[(1 * 3 + 0) * 2], 0.05 * 0.4 * 1);                  // a quarter of the way down, sin(pi/2)
  const a = warpPreset(def, sway, 'noise', box, { seed: 5 }), b = warpPreset(def, sway, 'noise', box, { seed: 5 }), c = warpPreset(def, sway, 'noise', box, { seed: 6 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.deepEqual(problems(a), []);
});

test('a preset replaces that parameter\'s keys and keeps other keyforms', () => {
  const other = { param: 'turn', keys: [{ at: 0 }, { at: 1, pts: { 1: [0.1, 0] } }] };
  const def = deformer([{ param: 'sway', keys: [{ at: 0.5, pts: { 0: [9, 9] } }] }, other]);
  const next = warpPreset(def, sway, 'sway', { w: 1, h: 1 });
  assert.equal(next.keyforms.length, 2);
  assert.deepEqual(next.keyforms[0].keys.map(k => k.at), [0, 1]);
  assert.deepEqual(next.keyforms[1], other);
});

test('lattice edges and point picking', () => {
  assert.deepEqual(latticeEdges([2, 1]), [[0, 1], [1, 2], [3, 4], [4, 5], [0, 3], [1, 4], [2, 5]]);
  assert.equal(latticeEdges([4, 4]).length, 40);
  const pts = [[0, 0], [100, 0], [100, 100]];
  assert.equal(pickPoint(pts, [96, 4]), 1);
  assert.equal(pickPoint(pts, [50, 50]), -1);
  assert.equal(pickPoint([[10, 10], [10, 10]], [10, 10]), 1, 'the later point is on top');
  assert.equal(pickPoint(pts, [100, 108], 5), -1);
});
