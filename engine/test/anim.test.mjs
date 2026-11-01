import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EASES, EASE_NAMES, DEFAULT_EASE, easing, lerp, ANIM_NAMES, NO_OFFSET, animOffset, addOffset, resolveAnim, ANIMS } from '../../dist/engine/src/index.js';

test('every easing curve starts at 0 and ends at 1', () => {
  for (const name of EASE_NAMES) {
    assert.ok(Math.abs(EASES[name](0)) < 1e-9, name);
    assert.ok(Math.abs(EASES[name](1) - 1) < 1e-9, name);
  }
});

test('easing: named curves, unknown names fall back to the default', () => {
  assert.equal(easing('linear')(0.25), 0.25);
  assert.equal(easing('nope'), EASES[DEFAULT_EASE]);
  assert.equal(easing(undefined), EASES[DEFAULT_EASE]);
  assert.equal(easing('toString'), EASES[DEFAULT_EASE]); // not an inherited property
  assert.ok(easing('in')(0.5) < 0.5 && easing('out')(0.5) > 0.5);
});

test('back, bounce and elastic overshoot or rebound before settling', () => {
  assert.ok(Math.max(...[...Array(100)].map((_, i) => EASES.back(i / 99))) > 1);
  assert.ok(Math.max(...[...Array(100)].map((_, i) => EASES.elastic(i / 99))) > 1);
  assert.ok([...Array(100)].every((_, i) => EASES.bounce(i / 99) <= 1 + 1e-9));
});

test('lerp', () => {
  assert.equal(lerp(2, 6, 0.5), 4);
  assert.equal(lerp(2, 6, 0), 2);
  assert.equal(lerp(2, 6, 1.25), 7);
});

test('every animation starts and ends at no offset, so loops repeat without a jump', () => {
  for (const name of ANIM_NAMES) {
    for (const t of [0, 1]) {
      const o = animOffset(name, t);
      for (const k of Object.keys(NO_OFFSET)) assert.ok(Math.abs(o[k]) < 1e-9, `${name} ${k} at ${t}`);
    }
    assert.ok(Object.values(animOffset(name, 0.3)).some(v => v !== 0), `${name} moves`);
  }
});

test('animOffset: strength scales, unknown names and out-of-range progress are harmless', () => {
  assert.equal(animOffset('bob', 0.5, 2).dy, 2 * animOffset('bob', 0.5).dy);
  assert.deepEqual(animOffset('nope', 0.5), NO_OFFSET);
  assert.deepEqual(animOffset('toString', 0.5), NO_OFFSET);
  assert.deepEqual(animOffset('bob', 7), animOffset('bob', 1));
  assert.deepEqual(addOffset(animOffset('bob', 0.5), NO_OFFSET), animOffset('bob', 0.5));
});

test('keyframe animations: channels ease between their own keys and are 0 at the ends', () => {
  const wave = { dur: 2, keys: [{ t: 0.5, rot: 10, ease: 'linear' }, { t: 0.25, y: -0.1, ease: 'linear' }] }; // unsorted on purpose
  const at = t => animOffset('wave', t, 1, { wave });
  assert.deepEqual(at(0), NO_OFFSET);
  assert.ok(Math.abs(at(1).rot) < 1e-9 && Math.abs(at(1).dy) < 1e-9);
  assert.equal(at(0.5).rot, 10);
  assert.ok(Math.abs(at(0.25).rot - 5) < 1e-9);          // linear from 0 at t=0 to 10 at t=0.5
  assert.ok(Math.abs(at(0.25).dy + 0.1) < 1e-9);         // y's only key
  assert.ok(Math.abs(at(0.75).rot - 5) < 1e-9);          // ...and back to 0 at t=1 (default inout is symmetric at the midpoint)
  assert.equal(animOffset('wave', 0.5, 2, { wave }).rot, 20); // strength
});

test('keyframe animations: scale moves both axes; a key may start or end off zero', () => {
  const grow = { keys: [{ t: 0, scale: 0.2, ease: 'linear' }, { t: 1, scale: 0.4 }] };
  assert.deepEqual([animOffset('grow', 0, 1, { grow }).sx, animOffset('grow', 0, 1, { grow }).sy], [0.2, 0.2]);
  assert.ok(Math.abs(animOffset('grow', 1, 1, { grow }).sy - 0.4) < 1e-9);
});

test('resolveAnim: the character\'s own animation beats a preset of the same name; unknown names are null', () => {
  const own = { bob: { dur: 3, keys: [{ t: 0.5, y: -1 }] } };
  assert.equal(resolveAnim('bob', own).dur, 3);
  assert.equal(resolveAnim('bob').dur, ANIMS.bob.dur);
  assert.equal(resolveAnim('nope', own), null);
  assert.equal(resolveAnim('toString', own), null);
  assert.equal(resolveAnim('x', { x: { keys: [] } }).dur, 1); // no dur: one second
  assert.equal(resolveAnim('x', { x: { dur: -2, keys: [] } }).dur, 1);
});

test('keyframes with a part move that part, not the body', () => {
  const def = { dur: 1, keys: [{ t: 0.5, rot: 10, ease: 'linear' }, { t: 0.5, part: 'arm', rot: 30, y: -0.1, ease: 'linear' }, { t: 0.25, part: 'hair', x: 0.02, ease: 'linear' }] };
  const a = resolveAnim('wave', { wave: def });
  assert.equal(a.fn(0.5).rot, 10);
  assert.equal(a.fn(0.5).dy, 0); // the arm's y is not the body's
  const parts = a.parts(0.5);
  assert.deepEqual(Object.keys(parts).sort(), ['arm', 'hair']);
  assert.equal(parts.arm.rot, 30);
  assert.equal(parts.arm.dy, -0.1);
  assert.ok(Math.abs(a.parts(0.25).hair.dx - 0.02) < 1e-9);
  assert.equal(a.parts(0).arm.rot, 0);
  assert.equal(resolveAnim('bob'), ANIMS.bob);
  assert.equal(resolveAnim('x', { x: { keys: [{ t: 0.5, rot: 1 }] } }).parts, undefined); // body-only: no part track
});
