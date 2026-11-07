import test from 'node:test';
import assert from 'node:assert/strict';
import { copyKeys, mapValue } from '../../dist/engine/src/index.js';

const defs = [
  { id: 'eye_l', min: 0, max: 1, default: 1 },
  { id: 'eye_r', min: 0, max: 1, default: 1 },
  { id: 'look_x', min: -1, max: 1, default: 0 },
  { id: 'look_y', min: -1, max: 1, default: 0 },
  { id: 'big', min: -10, max: 10, default: 0 },
];

test('mapValue lines min, default and max up', () => {
  assert.equal(mapValue(defs[2], defs[4], 0.5), 5);
  assert.equal(mapValue(defs[2], defs[2], -1, true), 1);
  assert.equal(mapValue(defs[0], defs[1], 0.25), 0.25);
});

test('slider keys copy to another part and parameter, flipped', () => {
  const kfs = [{ target: 'brow_l', param: 'look_x', keys: [{ at: -1, dx: 0.1, rot: 5 }, { at: 0 }, { at: 1, dy: 0.2 }] }];
  const r = copyKeys(kfs, defs, { target: 'brow_l', driver: { param: 'look_x' } }, { target: 'brow_r', driver: { param: 'look_x' } }, { flip: true, reverse: true });
  assert.ok(r.copied);
  assert.equal(r.keyforms.length, 2);
  assert.deepEqual(r.keyforms[1], { target: 'brow_r', param: 'look_x', keys: [{ at: -1, dy: 0.2 }, { at: 0 }, { at: 1, dx: -0.1, rot: -5 }] });
  assert.deepEqual(kfs.length, 1);
});

test('copy replaces the destination keys and refuses a no-op or mixed kinds', () => {
  const kfs = [
    { target: 'a', param: 'eye_l', keys: [{ at: 0, dy: 0.3 }, { at: 1 }] },
    { target: 'b', param: 'eye_r', keys: [{ at: 0 }, { at: 1 }] },
  ];
  const r = copyKeys(kfs, defs, { target: 'a', driver: { param: 'eye_l' } }, { target: 'b', driver: { param: 'eye_r' } });
  assert.deepEqual(r.keyforms[1].keys, [{ at: 0, dy: 0.3 }, { at: 1 }]);
  assert.equal(copyKeys(kfs, defs, { target: 'a', driver: { param: 'eye_l' } }, { target: 'a', driver: { param: 'eye_l' } }).copied, false);
  assert.equal(copyKeys(kfs, defs, { target: 'a', driver: { param: 'eye_l' } }, { target: 'a', driver: { params: ['look_x', 'look_y'] } }).copied, false);
  assert.equal(copyKeys(kfs, defs, { target: 'zz', driver: { param: 'eye_l' } }, { target: 'b', driver: { param: 'eye_r' } }).copied, false);
});

test('a pad mirrors left to right', () => {
  const pad = { params: ['look_x', 'look_y'] };
  const kfs = [{ target: 'p', params: ['look_x', 'look_y'], grid: { x: [-1, 1], y: [-1, 1] }, forms: [{ dx: 0.1 }, {}, {}, { rot: 3 }] }];
  const r = copyKeys(kfs, defs, { target: 'p', driver: pad }, { target: 'q', driver: pad }, { flip: true, reverse: true });
  assert.ok(r.copied);
  assert.deepEqual(r.keyforms[1], { target: 'q', params: ['look_x', 'look_y'], grid: { x: [-1, 1], y: [-1, 1] }, forms: [{}, { dx: -0.1 }, { rot: -3 }, {}] });
});

import { boneSubtree } from '../../dist/engine/src/index.js';
test('boneSubtree: the bone, what is below it and the parts on them', () => {
  const bones = { body: {}, arm: { parent: 'body' }, hand: { parent: 'arm' }, head: { parent: 'body' } };
  const parts = { sleeve: { bone: 'arm' }, glove: { bone: 'hand' }, hat: { bone: 'head' }, bg: {} };
  assert.deepEqual(boneSubtree(bones, parts, 'arm'), { bones: ['arm', 'hand'], parts: ['sleeve', 'glove'] });
  assert.deepEqual(boneSubtree(bones, parts, 'nope'), { bones: [], parts: [] });
});
