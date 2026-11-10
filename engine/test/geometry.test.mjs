import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPoint, nearestOnSegment, pointInPolygon, segmentDistance, signedArea } from '../../dist/engine/src/geometry.js';
import { byTime, freeName, plural, round4, round5 } from '../../dist/engine/src/util.js';

test('nearestOnSegment: clamped to the ends, and a segment of no length is its start', () => {
  assert.deepEqual(nearestOnSegment(5, 3, 0, 0, 10, 0), { t: 0.5, x: 5, y: 0, d: 3 });
  assert.deepEqual(nearestOnSegment(-4, 3, 0, 0, 10, 0), { t: 0, x: 0, y: 0, d: 5 });
  assert.equal(nearestOnSegment(20, 0, 0, 0, 10, 0).t, 1);
  assert.deepEqual(nearestOnSegment(3, 4, 0, 0, 0, 0), { t: 0, x: 0, y: 0, d: 5 });
  assert.equal(segmentDistance(13, 4, 0, 0, 10, 0), 5);
});

test('polygons: inside test and the signed area by winding', () => {
  const square = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.equal(pointInPolygon(square, 5, 5), true);
  assert.equal(pointInPolygon(square, 15, 5), false);
  assert.equal(signedArea(square), 100, 'clockwise on screen (y down) is positive');
  assert.equal(signedArea([...square].reverse()), -100);
  assert.equal(isPoint([1, 2]), true);
  assert.equal(isPoint([1, NaN]), false);
  assert.equal(isPoint([1, 2, 3]), false);
});

test('freeName, plural and the stored-number roundings', () => {
  assert.equal(freeName(['a'], 'b'), 'b');
  assert.equal(freeName(['anim', 'anim2'], 'anim'), 'anim3');
  assert.equal(freeName(['bone', 'bone_2'], 'bone', '_'), 'bone_3');
  assert.equal(plural(1, 'file'), '1 file');
  assert.equal(plural(3, 'file'), '3 files');
  assert.equal(plural(2, 'child', 'children'), '2 children');
  assert.equal(round4(0.123456), 0.1235);
  assert.ok(Object.is(round5(-0.000001), 0), 'no -0');
  assert.deepEqual(byTime([{ t: 0.5 }, { t: 0.1 }]).map(k => k.t), [0.1, 0.5]);
});
