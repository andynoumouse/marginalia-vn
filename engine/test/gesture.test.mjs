// Touch gesture classification and game.json "touch" (docs/design/mobile.md, step 2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyStroke, stillForLongPress, touchSettings, touchProblems, LONG_PRESS_MS } from '../../dist/engine/src/index.js';

const one = (dx, dy, ms = 150) => classifyStroke({ dx, dy, ms, fingers: 1 });

test('a short, still touch is a tap; a long still one is left to the long-press timer', () => {
  assert.equal(one(0, 0, 80), 'tap');
  assert.equal(one(6, -5, 200), 'tap');
  assert.equal(one(0, 0, LONG_PRESS_MS), null);
});

test('clean swipes in the four directions', () => {
  assert.equal(one(120, 10), 'swipe-right');
  assert.equal(one(-120, -20), 'swipe-left');
  assert.equal(one(5, -150), 'swipe-up');
  assert.equal(one(-10, 150), 'swipe-down');
});

test('too short, too slow or too diagonal is nothing', () => {
  assert.equal(one(40, 0), null);
  assert.equal(one(200, 0, 900), null);
  assert.equal(one(100, 90), null);
});

test('two fingers: a quick tap only', () => {
  assert.equal(classifyStroke({ dx: 3, dy: 2, ms: 200, fingers: 2 }), 'two-finger-tap');
  assert.equal(classifyStroke({ dx: 3, dy: 2, ms: 600, fingers: 2 }), null);
  assert.equal(classifyStroke({ dx: 150, dy: 0, ms: 200, fingers: 2 }), null);
});

test('a press stays a candidate for a long press only while it is still', () => {
  assert.equal(stillForLongPress(3, 4), true);
  assert.equal(stillForLongPress(20, 0), false);
});

test('touchSettings: gestures on unless the project turns them off', () => {
  assert.deepEqual(touchSettings(undefined), { gestures: true });
  assert.deepEqual(touchSettings({}), { gestures: true });
  assert.deepEqual(touchSettings({ gestures: false }), { gestures: false });
  assert.deepEqual(touchSettings('x'), { gestures: true });
});

test('touchProblems', () => {
  assert.deepEqual(touchProblems(undefined), []);
  assert.deepEqual(touchProblems({ gestures: true }), []);
  assert.equal(touchProblems(true).length, 1);
  assert.equal(touchProblems({ gestures: 'no' }).length, 1);
  assert.equal(touchProblems({ swipe: 1 }).length, 1);
});
