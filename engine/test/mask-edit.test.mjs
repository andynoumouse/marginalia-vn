import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRig, defaultPolygon, edgeMidpoint, insertPolygonPoint, maskId, maskSources, maskSummary, movePolygonPoint, nearestEdge, removeMask, removePolygonPoint, setMask, setMaskOn, MASK_MAX_POINTS } from '../../dist/engine/src/index.js';

const tri = [[10, 10], [60, 10], [30, 50]];
const poly = { id: 'm', part: 'iris', polygon: tri, on: 'head', keyforms: [{ param: 'open', keys: [{ at: 0, pts: { 0: [0, 0.1], 2: [0.1, 0] } }, { at: 1 }] }] };

test('maskId makes a free id from the part name', () => {
  assert.equal(maskId([], 'iris'), 'iris_mask');
  assert.equal(maskId([{ id: 'iris_mask', part: 'x' }], 'iris'), 'iris_mask_2');
  assert.equal(maskId([{ id: 'iris_mask', part: 'x' }, { id: 'iris_mask_2', part: 'y' }], 'iris'), 'iris_mask_3');
});

test('setMask adds a mask, or gives the part\'s own mask another shape and keeps its id', () => {
  const a = setMask([], 'iris', { from: 'eye_white' });
  assert.deepEqual(a, [{ id: 'iris_mask', part: 'iris', from: 'eye_white' }]);
  const b = setMask(a, 'iris', { from: 'face' });
  assert.deepEqual(b, [{ id: 'iris_mask', part: 'iris', from: 'face' }]);
  assert.deepEqual(a, [{ id: 'iris_mask', part: 'iris', from: 'eye_white' }], 'the old list is not touched');
  const c = setMask(b, 'tongue', { polygon: tri });
  assert.equal(c.length, 2);
  assert.deepEqual(c[1], { id: 'tongue_mask', part: 'tongue', polygon: tri });
  assert.notEqual(c[1].polygon, tri, 'the polygon is copied');
});

test('setMask from a polygon to a part drops the polygon, on and keyforms; polygon to polygon keeps on and keyforms', () => {
  assert.deepEqual(setMask([poly], 'iris', { from: 'face' }), [{ id: 'm', part: 'iris', from: 'face' }]);
  const kept = setMask([poly], 'iris', { polygon: [[0, 0], [5, 0], [5, 5]] });
  assert.equal(kept[0].on, 'head');
  assert.deepEqual(kept[0].keyforms, poly.keyforms);
  assert.deepEqual(kept[0].polygon, [[0, 0], [5, 0], [5, 5]]);
  assert.equal(setMask([poly], 'iris', { polygon: tri, on: 'face' })[0].on, 'face');
});

test('removeMask and setMaskOn', () => {
  const masks = [{ id: 'a', part: 'x', from: 'y' }, poly];
  assert.deepEqual(removeMask(masks, 'iris'), [masks[0]]);
  assert.equal(removeMask(masks, 'nope'), masks, 'the same list when there is nothing to remove');
  assert.equal(setMaskOn(poly, null).on, undefined);
  assert.equal(setMaskOn(poly, 'face').on, 'face');
  assert.deepEqual(setMaskOn({ id: 'm', part: 'p', polygon: tri }, ''), { id: 'm', part: 'p', polygon: tri });
});

test('defaultPolygon is an inset rectangle in whole pixels, clockwise from the top left', () => {
  assert.deepEqual(defaultPolygon({ x: 100, y: 200, w: 100, h: 50 }, 0.1), [[110, 205], [190, 205], [190, 245], [110, 245]]);
  assert.equal(defaultPolygon({ x: 0, y: 0, w: 10, h: 10 }).length, 4);
});

test('movePolygonPoint rounds, and ignores a missing point or no move', () => {
  const moved = movePolygonPoint(poly, 1, [64.6, 12.2]);
  assert.deepEqual(moved.polygon, [[10, 10], [65, 12], [30, 50]]);
  assert.deepEqual(poly.polygon, tri, 'the old mask is not touched');
  assert.equal(movePolygonPoint(poly, 1, [60, 10]), poly);
  assert.equal(movePolygonPoint(poly, 9, [1, 1]), poly);
  assert.equal(movePolygonPoint(poly, 0, [NaN, 1]), poly);
  assert.equal(movePolygonPoint({ id: 'a', part: 'x', from: 'y' }, 0, [1, 1]).polygon, undefined);
});

test('insertPolygonPoint adds a point and shifts the keyforms\' point numbers up', () => {
  const next = insertPolygonPoint(poly, 1, [35.4, 8]);
  assert.deepEqual(next.polygon, [[10, 10], [35, 8], [60, 10], [30, 50]]);
  assert.deepEqual(next.keyforms[0].keys[0].pts, { 0: [0, 0.1], 3: [0.1, 0] }, 'point 2 became point 3, point 0 stayed');
  assert.deepEqual(insertPolygonPoint(poly, 3, [0, 0]).polygon.at(-1), [0, 0], 'appends at the count');
  assert.equal(insertPolygonPoint(poly, 9, [0, 0]), poly);
  const full = { id: 'f', part: 'p', polygon: Array.from({ length: MASK_MAX_POINTS }, (_, i) => [i, 0]) };
  assert.equal(insertPolygonPoint(full, 0, [1, 1]), full, 'at the cap nothing is added');
});

test('removePolygonPoint drops a point, its keyform entries and shifts the rest down; three points stay three', () => {
  const four = insertPolygonPoint(poly, 1, [35, 8]);
  const next = removePolygonPoint(four, 0);
  assert.deepEqual(next.polygon, [[35, 8], [60, 10], [30, 50]]);
  assert.deepEqual(next.keyforms[0].keys[0].pts, { 2: [0.1, 0] }, 'point 0 is gone, point 3 became 2');
  assert.equal(removePolygonPoint(poly, 0), null);
  assert.equal(removePolygonPoint(four, 9), null);
  const bare = removePolygonPoint({ id: 'a', part: 'p', polygon: [[0, 0], [1, 0], [1, 1], [0, 1]] }, 3);
  assert.equal(bare.keyforms, undefined);
});

test('an edited polygon still passes checkRig, keyforms included', () => {
  const m = insertPolygonPoint(poly, 1, [35, 8]);
  const msgs = checkRig({ width: 100, height: 100, parts: [{ file: 'iris.png' }, { file: 'face.png' }], rig: { parameters: [{ id: 'open', min: 0, max: 1, default: 1 }], bones: { head: { pivot: [0, 0] } }, parts: { face: { bone: 'head' } }, masks: [m] } }).map(p => p.message);
  assert.deepEqual(msgs, []);
});

test('nearestEdge finds the closest side of the closed polygon', () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const top = nearestEdge(sq, [5, -2]);
  assert.equal(top.index, 0);
  assert.deepEqual(top.at, [5, 0]);
  assert.equal(top.dist, 2);
  assert.equal(nearestEdge(sq, [-3, 5]).index, 3, 'the closing edge from the last point to the first');
  assert.equal(nearestEdge(sq, [15, 15]).dist, Math.hypot(5, 5));
  assert.equal(nearestEdge([[1, 1]], [0, 0]), null);
  assert.deepEqual(edgeMidpoint(sq, 3), [0, 5]);
  assert.equal(edgeMidpoint(sq, 4), null);
});

test('maskSources lists the other parts; maskSummary says what a part\'s mask is', () => {
  assert.deepEqual(maskSources(['a', 'b', 'c'], 'b'), ['a', 'c']);
  const masks = [{ id: 'a', part: 'x', from: 'y' }, poly];
  assert.equal(maskSummary(masks, 'x'), 'to y');
  assert.equal(maskSummary(masks, 'iris'), 'polygon, 3 points');
  assert.equal(maskSummary(masks, 'z'), '2 masks');
  assert.equal(maskSummary([masks[0]], null), '1 mask');
  assert.equal(maskSummary([], 'x'), 'none');
});
