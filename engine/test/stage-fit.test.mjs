// Stage fitting, safe-area insets in stage pixels and the rotate check (docs/design/mobile.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitScale, stageInsets, needsRotate, NO_INSETS } from '../../dist/engine/src/index.js';

const HD = { width: 1920, height: 1080 };

test('fitScale letterboxes to the smaller ratio', () => {
  assert.equal(fitScale(1920, 1080, HD), 1);
  assert.equal(fitScale(960, 1080, HD), 0.5);
  assert.equal(fitScale(3840, 1080, HD), 1);
});

test('stageInsets: no insets, no change (desktop)', () => {
  assert.deepEqual(stageInsets(1920, 1080, HD, NO_INSETS), NO_INSETS);
});

test('stageInsets: an inset the letterbox bar already covers counts for nothing', () => {
  // 1600x1080 window: scale .8333, the stage is 1600x900, bars of 90 px above and below.
  const r = stageInsets(1600, 1080, HD, { top: 40, right: 0, bottom: 40, left: 0 });
  assert.equal(r.top, 0);
  assert.equal(r.bottom, 0);
});

test('stageInsets: a notch on the side of a wide phone becomes stage pixels', () => {
  // 2000x720 phone: scale .6667, the stage is 1280 wide, bars of 360 px; a 100 px inset hides behind the bar.
  assert.equal(stageInsets(2000, 720, HD, { top: 0, right: 100, bottom: 0, left: 100 }).left, 0);
  // 1280x720: no bars; a 60 px inset is 90 stage pixels.
  const r = stageInsets(1280, 720, HD, { top: 0, right: 0, bottom: 0, left: 60 });
  assert.ok(Math.abs(r.left - 90) < 1e-9);
  assert.equal(r.right, 0);
});

test('needsRotate: only touch devices, only when the orientation is wrong', () => {
  assert.equal(needsRotate(390, 844, HD, true), true);
  assert.equal(needsRotate(844, 390, HD, true), false);
  assert.equal(needsRotate(390, 844, HD, false), false);
  assert.equal(needsRotate(844, 390, { width: 1080, height: 1920 }, true), true);
  assert.equal(needsRotate(800, 800, HD, true), false);
  assert.equal(needsRotate(390, 844, { width: 1000, height: 1000 }, true), false);
});
