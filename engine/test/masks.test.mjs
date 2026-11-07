import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRig, maskOf, maskChain, maskCycles, maskFrame, warpPoints, traceOutline, simplifyOutline, evalPointKeyforms, pointKeyformKey, placeRig, placeParts, NO_OFFSET, MASK_MAX_SHAPES, MASK_WARN_COUNT, restLattice } from '../../dist/engine/src/index.js';

const part = file => ({ file });
const manifest = rig => ({
  width: 100, height: 100,
  parts: [part('face.png'), part('eye_white.png'), part('iris.png'), part('shine.png'), part('mouth.png'), part('tongue.png'), { slot: 'lids', default: 'open', variants: { open: part('l_open.png'), shut: part('l_shut.png') } }],
  rig,
});
const msgs = rig => checkRig(manifest({ parameters: [{ id: 'open', min: 0, max: 1, default: 1 }], bones: { head: { pivot: [50, 40] } }, parts: { face: { bone: 'head' } }, ...rig })).map(p => p.message);
const tri = [[10, 10], [60, 10], [30, 50]];

test('a clean set of masks has no problems', () => {
  assert.deepEqual(msgs({ masks: [
    { id: 'iris_clip', part: 'iris', from: 'eye_white' },
    { id: 'tongue_clip', part: 'tongue', polygon: tri, on: 'head', keyforms: [{ param: 'open', keys: [{ at: 0, pts: { 1: [0, 0.01] } }, { at: 1 }] }] },
  ] }), []);
});

test('checkRig: masks name real parts, one mask per part, one shape source', () => {
  const ok = { id: 'm', part: 'iris', from: 'eye_white' };
  assert.ok(msgs({ masks: 'x' }).some(m => m.includes('masks: needs a list')));
  assert.ok(msgs({ masks: [ok, { ...ok, id: 'm' }] }).some(m => m.includes('"m" is defined twice')));
  assert.ok(msgs({ masks: [{ ...ok, part: 'nope' }] }).some(m => m.includes('no part named "nope"')));
  assert.ok(msgs({ masks: [{ ...ok, part: 'head' }] }).some(m => m.includes('"head" is a bone')));
  assert.ok(msgs({ masks: [{ ...ok, from: 'nope' }] }).some(m => m.includes('masks.m.from: no part named "nope"')));
  assert.ok(msgs({ masks: [{ ...ok, from: 'head' }] }).some(m => m.includes('"head" is a bone')));
  assert.ok(msgs({ masks: [ok, { id: 'n', part: 'iris', from: 'face' }] }).some(m => m.includes('already has mask "m"')));
  assert.ok(msgs({ masks: [{ id: 'm', part: 'iris' }] }).some(m => m.includes('give either "from"') && m.includes('one of them')));
  assert.ok(msgs({ masks: [{ ...ok, polygon: tri }] }).some(m => m.includes('not both')));
  assert.ok(msgs({ masks: [{ ...ok, from: 'iris' }] }).some(m => m.includes('its own shape')));
  assert.ok(msgs({ masks: [{ ...ok, size: 3 }] }).some(m => m.includes('masks.m.size: unknown field')));
  assert.ok(msgs({ masks: [null] }).some(m => m.includes('not a mask')));
});

test('checkRig: polygons, on and keyforms', () => {
  const poly = { id: 'p', part: 'tongue', polygon: tri };
  assert.ok(msgs({ masks: [{ ...poly, polygon: [[0, 0], [1, 1]] }] }).some(m => m.includes('needs 3 to 64 points')));
  assert.ok(msgs({ masks: [{ ...poly, polygon: Array.from({ length: 65 }, (_, i) => [i, i % 7]) }] }).some(m => m.includes('needs 3 to 64 points')));
  assert.ok(msgs({ masks: [{ ...poly, polygon: [[0, 0], [1, 'a'], [2, 2]] }] }).some(m => m.includes('masks.p.polygon[1]')));
  assert.ok(msgs({ masks: [{ ...poly, on: 'nope' }] }).some(m => m.includes('masks.p.on: no part or bone named "nope"')));
  assert.deepEqual(msgs({ masks: [{ ...poly, on: 'face' }] }), []);
  assert.ok(msgs({ masks: [{ id: 'm', part: 'iris', from: 'face', on: 'head' }] }).some(m => m.includes('only a polygon has "on"')));
  assert.ok(msgs({ masks: [{ id: 'm', part: 'iris', from: 'face', keyforms: [] }] }).some(m => m.includes('only a polygon can be reshaped')));
  const kf = pts => [{ param: 'open', keys: [{ at: 0, pts }, { at: 1 }] }];
  assert.ok(msgs({ masks: [{ ...poly, keyforms: kf({ 3: [0, 0] }) }] }).some(m => m.includes('point "3" is outside the polygon (0 to 2)')));
  assert.ok(msgs({ masks: [{ ...poly, keyforms: [{ param: 'ghost', keys: [{ at: 0 }] }] }] }).some(m => m.includes('no parameter "ghost"')));
  assert.deepEqual(msgs({ masks: [{ ...poly, keyforms: kf({ 2: [0, 0.01] }) }] }), []);
});

test('checkRig: a clip of a clipped part nests once; loops and deeper chains are errors', () => {
  const white = { id: 'white', part: 'eye_white', polygon: tri };
  const iris = { id: 'iris', part: 'iris', from: 'eye_white' };
  assert.deepEqual(msgs({ masks: [white, iris] }), [], 'two shapes, one nested level');
  const shine = { id: 'shine', part: 'shine', from: 'iris' };
  assert.ok(msgs({ masks: [white, iris, shine] }).some(m => m.includes('"shine" would be clipped through 3 shapes') && m.includes('at most 2')));
  assert.equal(MASK_MAX_SHAPES, 2);
  const loop = msgs({ masks: [{ id: 'a', part: 'iris', from: 'eye_white' }, { id: 'b', part: 'eye_white', from: 'iris' }] });
  assert.ok(loop.some(m => m.includes('masks: shapes form a loop (iris > eye_white > iris)')), loop.join('\n'));
  assert.ok(!loop.some(m => m.includes('would be clipped through')), 'a loop is reported once, not also as a deep chain');
});

test('checkRig: warns about many masks', () => {
  const many = Array.from({ length: MASK_WARN_COUNT + 1 }, (_, i) => ({ id: `m${i}`, part: i % 2 ? 'iris' : 'tongue', polygon: tri }));
  // nine masks need nine parts: reuse a bigger manifest.
  const big = checkRig({ width: 100, height: 100, parts: many.map((m, i) => part(`p${i}.png`)), rig: { masks: many.map((m, i) => ({ ...m, part: `p${i}` })) } }).map(p => p.message);
  assert.ok(big.some(m => m.includes(`${MASK_WARN_COUNT + 1} masks on one character`) && m.includes('not been measured')), big.join('\n'));
  assert.ok(!msgs({ masks: [{ id: 'a', part: 'iris', polygon: tri }] }).some(m => m.includes('masks on one character')));
});

test('maskOf, maskChain and maskCycles follow from links', () => {
  const masks = [{ id: 'a', part: 'iris', from: 'eye_white' }, { id: 'b', part: 'eye_white', polygon: tri }, { id: 'c', part: 'shine', from: 'iris' }];
  assert.equal(maskOf(masks, 'iris').id, 'a');
  assert.equal(maskOf(masks, 'face'), undefined);
  assert.deepEqual(maskChain(masks, 'iris').map(m => m.id), ['a', 'b']);
  assert.deepEqual(maskChain(masks, 'shine').map(m => m.id), ['c', 'a', 'b']);
  assert.deepEqual(maskChain(masks, 'face'), []);
  assert.deepEqual(maskCycles(masks), []);
  const loop = [{ id: 'a', part: 'x', from: 'y' }, { id: 'b', part: 'y', from: 'z' }, { id: 'c', part: 'z', from: 'x' }];
  assert.deepEqual(maskCycles(loop), [['x', 'y', 'z']]);
  assert.equal(maskChain(loop, 'x').length, 3, 'a chain stops when it comes back to a part it has seen');
  assert.equal(maskFrame(masks[0]), 'eye_white');
  assert.equal(maskFrame({ id: 'p', part: 'a', polygon: tri, on: 'head' }), 'head');
  assert.equal(maskFrame({ id: 'p', part: 'a', polygon: tri }), undefined);
});

test('warpPoints carries points along a deformed lattice', () => {
  const box = { w: 100, h: 50 }, rest = restLattice(100, 50, [2, 1]);
  const pts = [25, 25, 75, 10, 100, 50];
  assert.deepEqual([...warpPoints(pts, box, [2, 1], rest)], pts, 'a lattice at rest changes nothing');
  const moved = Float32Array.from(rest);
  for (let i = 0; i < moved.length; i += 2) moved[i] += 10; // every point 10 right
  assert.deepEqual([...warpPoints(pts, box, [2, 1], moved)], [35, 25, 85, 10, 110, 50]);
  const shear = Float32Array.from(rest);
  shear[1] -= 20; shear[3] -= 20; shear[5] -= 20; // the top row 20 up: points move by how near the top they are
  const out = warpPoints([50, 0, 50, 25, 50, 50], box, [2, 1], shear);
  assert.deepEqual([...out], [50, -20, 50, 15, 50, 50]);
  const far = warpPoints([-10, 60], box, [2, 1], moved);
  assert.ok(Math.abs(far[0]) < 1e-4 && Math.abs(far[1] - 60) < 1e-4, 'a point outside the box keeps its place in the edge cell, so a shift of the lattice shifts it too');
  const reuse = new Float32Array(2);
  assert.equal(warpPoints([1, 1], box, [2, 1], rest, reuse), reuse);
});

// An ellipse and a ring on a w x h alpha grid, for the tracing tests.
const grid = (w, h, f) => Uint8Array.from({ length: w * h }, (_, i) => (f(i % w, Math.floor(i / w)) ? 255 : 0));
const area = poly => Math.abs(poly.reduce((a, p, i) => { const q = poly[(i + 1) % poly.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);

test('traceOutline: a full image traces to its box, an empty one to nothing', () => {
  const full = traceOutline(grid(8, 4, () => true), 8, 4);
  assert.equal(full.length, 1);
  assert.deepEqual([...full[0]].sort((a, b) => a[0] - b[0] || a[1] - b[1]), [[0, 0], [0, 1], [1, 0], [1, 1]]);
  assert.deepEqual(traceOutline(grid(8, 4, () => false), 8, 4), []);
  assert.deepEqual(traceOutline(new Uint8Array(3), 8, 4), [], 'a too short buffer is not read past its end');
});

test('traceOutline: an ellipse gives one simple outline close to its area', () => {
  const w = 64, h = 32, cx = 32, cy = 16, rx = 28, ry = 10;
  const a = grid(w, h, (x, y) => ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1);
  const out = traceOutline(a, w, h);
  assert.equal(out.length, 1);
  assert.ok(out[0].length >= 8 && out[0].length <= 64, `${out[0].length} points`);
  const truth = (Math.PI * rx * ry) / (w * h);
  assert.ok(Math.abs(area(out[0]) - truth) / truth < 0.05, `area ${area(out[0])} vs ${truth}`);
  for (const [x, y] of out[0]) assert.ok(x >= 0 && x <= 1 && y >= 0 && y <= 1);
});

test('traceOutline: two blobs give two outlines (biggest first), specks and holes are ignored', () => {
  const w = 40, h = 20;
  const a = grid(w, h, (x, y) => (x >= 2 && x < 16 && y >= 4 && y < 16 && !(x >= 6 && x < 10 && y >= 8 && y < 12)) || (x >= 24 && x < 34 && y >= 4 && y < 14) || (x === 20 && y === 0));
  const out = traceOutline(a, w, h);
  assert.equal(out.length, 2, 'the speck at (20, 0) is dropped');
  assert.ok(area(out[0]) > area(out[1]));
  // The left blob has a hole; its outline is the outer square only: 14 x 12 px of 800.
  assert.ok(Math.abs(area(out[0]) - (14 * 12) / (w * h)) < 1e-9, `${area(out[0])}`);
  assert.ok(Math.abs(area(out[1]) - (10 * 10) / (w * h)) < 1e-9);
  assert.equal(traceOutline(a, w, h, { maxShapes: 1 }).length, 1);
});

test('traceOutline: the threshold picks the soft edge, the point cap thins the outline', () => {
  const w = 30, h = 30;
  const soft = Uint8Array.from({ length: w * h }, (_, i) => { const x = i % w, y = Math.floor(i / w), d = Math.hypot(x + 0.5 - 15, y + 0.5 - 15); return d < 8 ? 255 : d < 12 ? 100 : 0; });
  const inner = traceOutline(soft, w, h, { threshold: 128 }), outer = traceOutline(soft, w, h, { threshold: 50 });
  assert.ok(area(outer[0]) > area(inner[0]) * 1.5);
  const capped = traceOutline(soft, w, h, { threshold: 50, maxPoints: 12 });
  assert.ok(capped[0].length <= 12, `${capped[0].length}`);
  assert.ok(area(capped[0]) > area(outer[0]) * 0.8);
});

test('simplifyOutline drops points that lie on the line and keeps the corners', () => {
  const line = [[0, 0], [1, 0], [2, 0], [3, 0], [3, 1], [3, 2], [3, 3], [0, 3]];
  assert.deepEqual(simplifyOutline(line, 0.1).map(p => p.join(',')).sort(), ['0,0', '0,3', '3,0', '3,3']);
  assert.equal(simplifyOutline([[0, 0], [1, 0], [0, 1]], 5).length, 3);
});

test('mask keyforms reuse the deformer point maths', () => {
  const kfs = [{ param: 'open', keys: [{ at: 0, pts: { 1: [0, 0.2] } }, { at: 1 }] }];
  assert.deepEqual([...evalPointKeyforms(kfs, 3, { open: 0 })].map(n => Math.round(n * 1000) / 1000), [0, 0, 0, 0.2, 0, 0]);
  assert.deepEqual([...evalPointKeyforms(kfs, 3, { open: 1 })], [0, 0, 0, 0, 0, 0]);
  assert.equal(evalPointKeyforms(undefined, 2, {}).length, 4);
  assert.equal(pointKeyformKey(kfs, { open: 0.5, other: 3 }), '0.5', 'only the parameters the keyforms read');
  assert.equal(pointKeyformKey(undefined, { open: 0.5 }), '');
});

test('placeRig also gives the bones\' world matrices; placeParts is unchanged', () => {
  const bones = { head: { pivot: [0, 0] } };
  const parts = { face: { box: { x: 0, y: 0, w: 10, h: 10 }, bone: 'head' } };
  const offsets = new Map([['head', { ...NO_OFFSET, dx: 0.5 }]]);
  const rig = placeRig(bones, parts, offsets, () => null, [0, 0], 100);
  assert.equal(rig.bones.head.tx, 50);
  assert.equal(rig.parts.face.tx, 50);
  assert.deepEqual(placeParts(bones, parts, offsets, () => null, [0, 0], 100), rig.parts);
});

test('checkRig: a mask without an id, and keyforms that are not a list', () => {
  assert.ok(msgs({ masks: [{ part: 'iris', from: 'eye_white' }] }).some(m => m.includes('masks[0]: needs an id')));
  assert.ok(msgs({ masks: [{ id: 'p', part: 'tongue', polygon: tri, keyforms: 'x' }] }).some(m => m.includes('masks.p.keyforms: needs a list')));
});
