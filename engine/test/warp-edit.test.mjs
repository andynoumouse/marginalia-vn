import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDeformer, addWarpKey, pasteWarpForm, checkDeformers, deformerOf, deleteWarpKey, dragWarpPoint, evalDeformer, latticeEdges, mirrorWarp, ownDisplacement, pickPoint,
  removeDeformer, replaceDeformer, resetWarpPoint, resizeWarp, setWarpOwn, smoothWarp, warpKeyAt, warpKeyValues, warpPreset, WARP_PRESETS,
  averageDisplacement, combineSelection, invertSelection, moveWarpPoints, softWeights, transformWarpPoints, warpAllPoints, warpColumn, warpRow, groupBones,
} from '../../dist/engine/src/index.js';

const near = (a, b, eps = 1e-5) => assert.ok(Math.abs(a - b) <= eps, `${a} is not ${b}`);
const nearAll = (a, b, eps = 1e-5) => { assert.equal(a.length, b.length); a.forEach((x, i) => near(x, b[i], eps)); };
const sway = { id: 'sway', min: 0, max: 1, default: 0 };
const turn = { id: 'turn', min: -1, max: 1, default: 0 };
const deformer = (keyforms = [], grid = [2, 2]) => ({ id: 'd', part: 'p', grid, keyforms });
const problems = def => { const out = []; checkDeformers({ deformers: [def], parameters: [sway, turn] }, new Set(['p']), new Set(), m => out.push(m)); return out; };
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

test('add key holds the shape the keyform gives at the value, so the curve stays; no keyform yet: rest at the default too', () => {
  const def = deformer([{ param: 'sway', keys: [{ at: 0 }, { at: 1, pts: { 4: [0.02, 0] } }] }]);
  const mid = addWarpKey(def, sway, 0.5);
  assert.deepEqual(mid.keyforms[0].keys, [{ at: 0 }, { at: 0.5, pts: { 4: [0.01, 0] } }, { at: 1, pts: { 4: [0.02, 0] } }]);
  for (const v of [0.25, 0.75]) nearAll(ownDisplacement(mid, sway, v), ownDisplacement(def, sway, v));
  assert.equal(addWarpKey(def, sway, 0.99), def, 'a key within reach is there already');
  assert.deepEqual(addWarpKey(deformer(), turn, 1).keyforms, [{ param: 'turn', keys: [{ at: 0 }, { at: 1 }] }]);
  assert.deepEqual(addWarpKey(deformer(), turn, 0).keyforms, [{ param: 'turn', keys: [{ at: 0 }] }]);
});

test('paste form writes a copied shape at the value, mirrored sideways on a lattice; a mismatch or a mesh mirror changes nothing', () => {
  const def = deformer([{ param: 'sway', keys: [{ at: 0 }, { at: 1, pts: { 0: [0.01, 0.02], 4: [0.03, 0] } }] }]);
  const copied = ownDisplacement(def, sway, 1);
  const half = pasteWarpForm(def, sway, 0.5, copied);
  assert.deepEqual(half.keyforms[0].keys.map(k => k.at), [0, 0.5, 1], 'a new key between');
  nearAll(ownDisplacement(half, sway, 0.5), copied);
  const flipped = pasteWarpForm(def, sway, 1, copied, true);
  assert.deepEqual(flipped.keyforms[0].keys[1].pts, { 2: [-0.01, 0.02], 4: [-0.03, 0] }, 'column 0 goes to column 2; the middle column stays, dx flipped');
  assert.equal(pasteWarpForm(def, sway, 1, copied), def, 'the same shape: nothing changes');
  assert.equal(pasteWarpForm(def, sway, 1, copied.slice(2)), def, 'another point count');
  const mesh = { id: 'm', part: 'p', mesh: { verts: [0, 0, 10, 0, 0, 10], tris: [0, 1, 2] }, keyforms: [{ param: 'sway', keys: [{ at: 0 }, { at: 1 }] }] };
  assert.equal(pasteWarpForm(mesh, sway, 1, [0.01, 0, 0, 0, 0, 0], true), mesh, 'a mesh is not mirrored');
  assert.deepEqual(pasteWarpForm(mesh, sway, 1, [0.01, 0, 0, 0, 0, 0]).keyforms[0].keys[1].pts, { 0: [0.01, 0] });
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

// ---- selections of points ----

const keyed = (pts = {}) => deformer([{ param: 'sway', keys: [{ at: 0 }, { at: 1, pts }] }]);
const own1 = def => [...ownDisplacement(def, sway, 1)];

test('rows, columns, all and invert on a 2x2 lattice (9 points)', () => {
  const def = deformer();
  assert.deepEqual(warpRow(def, 1), [3, 4, 5]);
  assert.deepEqual(warpColumn(def, 2), [2, 5, 8]);
  assert.deepEqual(warpRow(def, 3), []);
  assert.equal(warpAllPoints(def).length, 9);
  assert.deepEqual(invertSelection(def, [0, 1, 2, 3, 4, 5, 6]), [7, 8]);
});

test('combining selections: set, add and toggle', () => {
  assert.deepEqual(combineSelection([1, 2], [5, 2], 'set'), [2, 5]);
  assert.deepEqual(combineSelection([1, 2], [5, 2], 'add'), [1, 2, 5]);
  assert.deepEqual(combineSelection([1, 2], [5, 2], 'toggle'), [1, 5]);
});

test('soft weights are 1 on the selection and fade with the distance in cells', () => {
  const def = deformer([], [4, 4]);
  const hard = softWeights(def, [12]);
  assert.deepEqual([...hard], [[12, 1]]);
  const soft = softWeights(def, [12], { radius: 2, curve: 'linear' });
  assert.equal(soft.get(12), 1);
  near(soft.get(13), 0.5);
  near(soft.get(7), 0.5);
  assert.equal(soft.has(14), false, 'at the radius the weight is 0, so the point is left out');
  const flat = softWeights(def, [12], { radius: 2, curve: 'constant' });
  assert.equal(flat.get(13), 1);
  const smooth = softWeights(def, [12], { radius: 2, curve: 'smooth' });
  near(smooth.get(13), 0.5);
  near(softWeights(def, [12], { radius: 4, curve: 'smooth' }).get(13), 0.84375);
});

test('moving a selection moves each point by delta times its weight, in one write', () => {
  const def = keyed({ 4: [0.01, 0] });
  const next = moveWarpPoints(def, sway, 1, new Map([[4, 1], [5, 0.5]]), [0.02, 0.04]);
  const v = own1(next);
  near(v[8], 0.03); near(v[9], 0.04); near(v[10], 0.01); near(v[11], 0.02);
  assert.equal(moveWarpPoints(def, sway, 1, new Map(), [1, 1]), def, 'nothing chosen is no change');
});

test('the average displacement of a selection', () => {
  const def = keyed({ 0: [0.02, 0], 1: [0, 0.04] });
  nearAll(averageDisplacement(def, sway, 1, [0, 1]), [0.01, 0.02]);
  assert.equal(averageDisplacement(def, sway, 1, []), null);
});

test('scaling about the selection keeps its centre; a lattice scale grows the shape from the middle', () => {
  const box = { w: 0.2, h: 0.2 };
  const def = keyed();
  // The row 0 points (0, 1, 2) sit at x = 0, 0.1, 0.2: doubling about their centre moves the ends outwards by 0.1 and the middle not at all.
  const next = transformWarpPoints(def, sway, 1, [0, 1, 2], box, { scale: [2, 1] });
  const v = own1(next);
  near(v[0], -0.1); near(v[2], 0); near(v[4], 0.1); near(v[1], 0);
  const grown = transformWarpPoints(def, sway, 1, [0], box, { scale: 2, about: 'lattice' });
  nearAll(own1(grown).slice(0, 2), [-0.1, -0.1]);
});

test('rotating a quarter turn about the centre of the lattice moves a corner to the next corner', () => {
  const box = { w: 0.2, h: 0.2 };
  const next = transformWarpPoints(keyed(), sway, 1, [0], box, { rotate: 90, about: 'lattice' });
  // The top left corner (0, 0) turned clockwise about (0.1, 0.1) lands on the top right (0.2, 0).
  nearAll(own1(next).slice(0, 2), [0.2, 0]);
});

test('mirror and smooth can act on chosen points only', () => {
  const def = keyed({ 0: [0.02, 0.01], 3: [0.04, 0], 1: [0.03, 0.03] });
  const m = own1(mirrorWarp(def, sway, 1, 'left', [0, 3]));
  nearAll([m[4], m[5]], [-0.02, 0.01]);     // point 2 took point 0, mirrored
  nearAll([m[10], m[11]], [-0.04, 0]);      // point 5 took point 3
  nearAll([m[0], m[1]], [0.02, 0.01]);      // the chosen points stay
  assert.equal(m[2], 0.03, 'a point not chosen and not a partner is as it was');
  const axis = own1(mirrorWarp(def, sway, 1, 'left', [1]));
  nearAll([axis[2], axis[3]], [0, 0.03]);   // on the axis: no sideways move
  const s = own1(smoothWarp(def, sway, 1, 1, [4]));
  const rest = own1(def);
  nearAll(s.slice(0, 8), rest.slice(0, 8));
  near(s[8], (rest[2] + rest[6] + rest[10] + rest[14]) / 4);
});

// ---- group warps: checkDeformers ----

const groupProblems = (def, extra = {}) => {
  const out = [];
  checkDeformers({ deformers: Array.isArray(def) ? def : [def], parameters: [sway, turn] }, new Set(['a', 'b', 'c']), new Set(['head']), m => out.push(m), extra.boneOf ?? new Map());
  return out;
};
const group = (more = {}) => ({ id: 'g', members: ['a', 'b'], grid: [2, 2], keyforms: [], ...more });

test('a group warp of existing parts is valid', () => {
  assert.deepEqual(groupProblems(group({ box: [0, 10, 200, 300] })), []);
  assert.deepEqual(groupProblems([group(), { id: 'own', part: 'a', keyforms: [] }]), [], 'a part may have its own warp and a group warp');
});

test('a group warp needs members that are parts, once each, and a part or members but not both', () => {
  assert.match(groupProblems(group({ members: [] }))[0], /members: needs a list/);
  assert.match(groupProblems(group({ members: ['a', 'nope'] }))[0], /no part or shape named "nope"/);
  assert.match(groupProblems(group({ members: ['a', 'head'] }))[0], /"head" is a bone/);
  assert.match(groupProblems(group({ members: ['a', 'a'] }))[0], /"a" is listed twice/);
  assert.match(groupProblems(group({ part: 'a' }))[0], /both part and members/);
  assert.match(groupProblems({ id: 'x', keyforms: [] })[0], /needs a part, or members/);
});

test('a part is in one group warp at most, and keeps its one own warp', () => {
  assert.match(groupProblems([group(), group({ id: 'g2', members: ['b', 'c'] })])[0], /part "b" is already in group warp "g"/);
  assert.match(groupProblems([{ id: 'p1', part: 'a', keyforms: [] }, { id: 'p2', part: 'a', keyforms: [] }])[0], /already has deformer "p1"/);
});

test('members on different bones are warned about', () => {
  assert.deepEqual(groupProblems(group(), { boneOf: new Map([['a', 'head'], ['b', 'head']]) }), []);
  assert.match(groupProblems(group(), { boneOf: new Map([['a', 'head'], ['b', 'neck']]) })[0], /different bones \(head, neck\)/);
});

test('the box of a group warp is [x, y, w, h] with a size, and a part warp has none', () => {
  assert.match(groupProblems(group({ box: [0, 0, 0, 10] }))[0], /box: use \[x, y, width, height\]/);
  assert.match(groupProblems(group({ box: [0, 0, 10] }))[0], /box: use/);
  assert.match(groupProblems({ id: 'x', part: 'a', box: [0, 0, 10, 10], keyforms: [] })[0], /only a group warp/);
});

test('a group warp\'s keyforms are checked like any lattice', () => {
  const bad = groupProblems(group({ grid: [1, 1], keyforms: [{ param: 'sway', keys: [{ at: 0, pts: { 9: [0, 0] } }] }] }));
  assert.match(bad[0], /point "9" is outside the lattice/);
});

test('deformers are found, replaced and removed by id; a part is told its own warp and its group', async () => {
  const { deformerById, groupOf, deformersOfPart, removeDeformerById } = await import('../../dist/engine/src/index.js');
  const list = [{ id: 'a_warp', part: 'a', keyforms: [] }, { id: 'g', members: ['a', 'b'], keyforms: [] }];
  assert.equal(deformerById(list, 'g'), list[1]);
  assert.equal(deformerById(list, 'x'), undefined);
  assert.equal(groupOf(list, 'b'), list[1]);
  assert.equal(groupOf(list, 'c'), undefined);
  assert.deepEqual(deformersOfPart(list, 'a').map(d => d.id), ['a_warp', 'g']);
  assert.deepEqual(deformersOfPart(list, 'b').map(d => d.id), ['g']);
  assert.deepEqual(removeDeformerById(list, 'g'), [list[0]]);
});

test('a group warp gets a unique id from its name or first member, and takes members out of another group', async () => {
  const { addGroupDeformer, setMembers } = await import('../../dist/engine/src/index.js');
  let list = addGroupDeformer([], ['face', 'eyes', 'face', '']);
  assert.deepEqual(list, [{ id: 'face_warp', members: ['face', 'eyes'], grid: [3, 3], keyforms: [] }].map(d => ({ ...d, grid: list[0].grid })));
  assert.deepEqual(addGroupDeformer(list, [], undefined), list, 'no members: nothing is added');
  list = addGroupDeformer(list, ['hair'], [2, 2], 'face');
  assert.deepEqual(list.map(d => d.id), ['face_warp', 'face_warp2']);
  assert.deepEqual(list[1].grid, [2, 2]);
  // eyes moves to the new group; the old one keeps face
  list = addGroupDeformer(list, ['eyes', 'mouth']);
  assert.deepEqual(list.find(d => d.id === 'face_warp').members, ['face']);
  assert.deepEqual(list.at(-1).members, ['eyes', 'mouth']);
  // a group with all its members moved away goes
  list = setMembers(list, 'face_warp2', ['hair', 'face']);
  assert.equal(list.some(d => d.id === 'face_warp'), false);
  assert.deepEqual(list.find(d => d.id === 'face_warp2').members, ['hair', 'face']);
  assert.deepEqual(setMembers(list, 'face_warp2', []), list, 'an empty list is refused');
  assert.deepEqual(setMembers(list, 'nope', ['x']), list);
  assert.deepEqual(setMembers([{ id: 'p', part: 'a', keyforms: [] }], 'p', ['a']), [{ id: 'p', part: 'a', keyforms: [] }], 'a part warp has no members');
});

test('members from a bone are the parts on it and the bones below, in the parts list order', async () => {
  const { membersFromBone } = await import('../../dist/engine/src/index.js');
  const bones = { body: { pivot: [0, 0] }, head: { parent: 'body', pivot: [0, 0] }, jaw: { parent: 'head', pivot: [0, 0] } };
  const parts = { torso: { bone: 'body' }, face: { bone: 'head' }, mouth: { bone: 'jaw' }, eyes: { bone: 'head' } };
  assert.deepEqual(membersFromBone(bones, parts, 'head'), ['face', 'mouth', 'eyes']);
  assert.deepEqual(membersFromBone(bones, parts, 'jaw'), ['mouth']);
  assert.deepEqual(membersFromBone(bones, parts, 'body'), ['torso', 'face', 'mouth', 'eyes']);
  assert.deepEqual(membersFromBone(bones, parts, 'nope'), []);
  const shapes = { lids: { bone: 'head' }, lip: { bone: 'jaw' }, loose: {}, lost: { bone: 'nope' } };
  assert.deepEqual(membersFromBone(bones, parts, 'head', shapes), ['face', 'mouth', 'eyes', 'lids', 'lip'], 'shapes on the bone and below follow the parts');
  assert.deepEqual(membersFromBone(bones, parts, 'jaw', shapes), ['mouth', 'lip']);
});

test('groupBones: the bones a group warp\'s members sit on, in member order, without skinned meshes', () => {
  const boneOf = m => ({ upper: 'arm_r', lower: 'forearm_r', hand: 'forearm_r', skirt: undefined, lid: 'head' })[m];
  assert.deepEqual(groupBones(['upper', 'lower', 'hand'], boneOf), ['arm_r', 'forearm_r'], 'a group from arm_r takes forearm_r\'s parts too');
  assert.deepEqual(groupBones(['lower', 'hand'], boneOf), ['forearm_r']);
  assert.deepEqual(groupBones(['upper', 'skirt'], boneOf), ['arm_r', ''], 'a part on no bone counts as one more');
  assert.deepEqual(groupBones(['upper', 'lower'], boneOf, m => m === 'lower'), ['arm_r'], 'a skinned mesh follows its weights, not its bone');
});
