// Enlarging a bar of small buttons for a finger (docs/design/mobile.md, step 3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { barBoost, boostOrigin, MAX_BOOST } from '../../dist/engine/src/index.js';

const HD = { width: 1920, height: 1080 };

test('boostOrigin follows the quick menu place', () => {
  assert.deepEqual(boostOrigin('bottom'), [0.5, 1]);
  assert.deepEqual(boostOrigin('topleft'), [0, 0]);
  assert.deepEqual(boostOrigin('bottomright'), [1, 1]);
});

test('barBoost: big enough already, no change; small on a small window, enlarged up to the cap', () => {
  const small = { left: 800, right: 1100, top: 1000, bottom: 1040 };
  assert.equal(barBoost(1, 40, small, HD, [0.5, 1]), 1);
  assert.ok(Math.abs(barBoost(0.6, 40, small, HD, [0.5, 1]) - 32 / 24) < 1e-9);
  assert.equal(barBoost(0.1, 40, small, HD, [0.5, 1]), MAX_BOOST);
});

test('barBoost: the enlarged bar stays on the stage', () => {
  // 1600 px wide, centred: it can grow to 1920/1600 = 1.2 at most.
  const wide = { left: 160, right: 1760, top: 1000, bottom: 1040 };
  assert.ok(Math.abs(barBoost(0.3, 40, wide, HD, [0.5, 1]) - 960 / 800) < 1e-9);
  // growing from the right edge, a bar that starts 200 px from the left grows by 1720/1720... bounded by the left edge.
  const right = { left: 200, right: 1760, top: 1000, bottom: 1040 };
  assert.ok(Math.abs(barBoost(0.3, 40, right, HD, [1, 1]) - 1920 / 1720) < 1e-9);
});

test('barBoost: nothing to measure, nothing to do', () => {
  assert.equal(barBoost(0, 40, { left: 0, right: 1, top: 0, bottom: 1 }, HD, [0.5, 1]), 1);
  assert.equal(barBoost(0.5, 0, { left: 0, right: 1, top: 0, bottom: 1 }, HD, [0.5, 1]), 1);
});

test('resolveTouch: a direct hit wins, a near miss goes to the nearest button, a far one to nothing', async () => {
  const { resolveTouch } = await import('../../dist/engine/src/index.js');
  // two 20x20 buttons 10 apart (a thumb is ~44 wide): centres at x=10 and x=40
  const boxes = [{ x: 0, y: 0, w: 20, h: 20 }, { x: 30, y: 0, w: 20, h: 20 }];
  assert.equal(resolveTouch(5, 5, boxes), 0);
  assert.equal(resolveTouch(45, 15, boxes), 1);
  assert.equal(resolveTouch(24, 10, boxes), 0, 'in the gap, nearer the first');
  assert.equal(resolveTouch(26, 10, boxes), 1, 'in the gap, nearer the second');
  assert.equal(resolveTouch(10, 30, boxes), 0, 'below the first, within a 44 px target');
  assert.equal(resolveTouch(10, 60, boxes), -1);
  assert.equal(resolveTouch(5, 5, []), -1);
  // an overlap: the later (drawn on top) button wins a direct hit
  assert.equal(resolveTouch(15, 10, [{ x: 0, y: 0, w: 20, h: 20 }, { x: 10, y: 0, w: 20, h: 20 }]), 1);
  // a big button needs no help: just outside it is nothing
  assert.equal(resolveTouch(150, 50, [{ x: 0, y: 0, w: 100, h: 100 }]), -1);
});

test('textFloor: only a window small enough to push the text under 16 CSS px enlarges it, to a cap', async () => {
  const { textFloor } = await import('../../dist/engine/src/index.js');
  assert.equal(textFloor(1, 44), 1);
  assert.equal(textFloor(0.4, 44), 1); // 17.6 px already
  assert.ok(Math.abs(textFloor(0.3, 44) - 16 / 13.2) < 1e-9);
  assert.equal(textFloor(0.1, 44), 1.5);
  assert.equal(textFloor(0, 44), 1);
});
