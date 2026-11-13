import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bezierSpec, curveStart, moveHandle, parseBezierSpec, presetBezier, CURVE_Y_MIN, CURVE_Y_MAX } from '../../dist/engine/src/index.js';

// The curve dialog of the ease selects (docs/design/param-curve-editor.md, UX round 3 AN-11).

test('bezierSpec writes a curve that parseBezierSpec reads back, three decimals at most', () => {
  assert.equal(bezierSpec([0.25, 0.1, 0.25, 1]), 'bezier(0.25,0.1,0.25,1)');
  assert.equal(bezierSpec([1 / 3, -0.25, 0.66666, 1.4]), 'bezier(0.333,-0.25,0.667,1.4)');
  assert.equal(bezierSpec([-0.00001, 0, 1, 1]), 'bezier(0,0,1,1)', 'no -0');
  for (const b of [[0, 0, 1, 1], [0.34, 1.56, 0.64, 1], [0.5, -0.5, 0.5, 1.5]]) assert.deepEqual(parseBezierSpec(bezierSpec(b)), b);
});

test('the dialog starts from the curve, the named ease, or inout', () => {
  assert.deepEqual(curveStart('bezier(0.1,0.2,0.3,0.4)'), [0.1, 0.2, 0.3, 0.4]);
  assert.deepEqual(curveStart('out'), presetBezier('out'));
  assert.deepEqual(curveStart('bounce'), presetBezier('inout'), 'no Bezier makes bounce');
  assert.deepEqual(curveStart(''), presetBezier('inout'), 'the default ease');
  assert.deepEqual(curveStart(undefined), presetBezier('inout'));
});

test('a handle moves in time within 0-1 and in value within the editor\'s room', () => {
  assert.deepEqual(moveHandle([0.25, 0.1, 0.25, 1], 0, 0.4, 0.8), [0.4, 0.8, 0.25, 1]);
  assert.deepEqual(moveHandle([0.25, 0.1, 0.25, 1], 1, 1.3, 9), [0.25, 0.1, 1, CURVE_Y_MAX]);
  assert.deepEqual(moveHandle([0.25, 0.1, 0.25, 1], 1, -2, -9), [0.25, 0.1, 0, CURVE_Y_MIN]);
});
