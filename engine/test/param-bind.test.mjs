import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  axisLines, sliderLines, bindPose, unbindPose, isBound, removeKey, bindDeformer, unbindDeformer, bindMask, unbindMask,
  boundParts, affectedBy, keyTicks, warpTicks, driverOf, controlOf, sameDriver, writeForm, evalTarget, checkParams, DEFAULT_PAD_SIZE,
} from '../../dist/engine/src/index.js';

const defs = [
  { id: 'head_x', min: -1, max: 1, default: 0 },
  { id: 'head_y', min: -1, max: 1, default: 0 },
  { id: 'lift', min: 0, max: 1, default: 0 },
  { id: 'eyes_open', min: 0, max: 1, default: 1 },
  { id: 'wide', min: -2, max: 6, default: 1 },
];
const pads = [{ id: 'head_turn', x: 'head_x', y: 'head_y' }];
const slider = id => ({ param: id });
const padOf = { params: ['head_x', 'head_y'] };
const targets = new Set(['head', 'arm', 'eyes']);
const problems = kfs => { const out = []; checkParams({ parameters: defs, keyforms: kfs }, targets, m => out.push(m)); return out; };

test('binding a part to a slider makes its keys at the minimum, default and maximum, all at rest', () => {
  const r = bindPose([], defs, 'head', slider('head_x'));
  assert.equal(r.bound, true);
  assert.deepEqual(r.keyforms, [{ target: 'head', param: 'head_x', keys: [{ at: -1 }, { at: 0 }, { at: 1 }] }]);
  assert.deepEqual(problems(r.keyforms), [], 'checkRig accepts it');
  assert.deepEqual(bindPose([], defs, 'arm', slider('lift')).keyforms[0].keys, [{ at: 0 }, { at: 1 }], 'the default is an end: two keys');
  assert.deepEqual(bindPose([], defs, 'eyes', slider('wide')).keyforms[0].keys, [{ at: -2 }, { at: 1 }, { at: 6 }], 'a default anywhere in the range');
  assert.deepEqual(sliderLines(defs[4]), [-2, 1, 6]);
  // At rest it changes nothing: the target stays where it was.
  assert.deepEqual(evalTarget(r.keyforms, 'head', { head_x: 0.7 }), { dx: 0, dy: 0, sx: 0, sy: 0, rot: 0, opacity: 1 });
});

test('binding twice, or to an unknown parameter, changes nothing and leaves the input alone', () => {
  const first = bindPose([], defs, 'head', slider('head_x')).keyforms;
  const copy = structuredClone(first);
  const again = bindPose(first, defs, 'head', slider('head_x'));
  assert.equal(again.bound, false);
  assert.equal(again.keyforms, first);
  assert.equal(bindPose(first, defs, 'head', slider('nope')).bound, false);
  assert.equal(bindPose(first, defs, 'head', { params: ['head_x', 'nope'] }).bound, false);
  assert.equal(bindPose(first, defs, 'head', { params: ['head_x', 'head_x'] }).bound, false, 'a pad needs two different parameters');
  const second = bindPose(first, defs, 'head', slider('head_y'));
  assert.equal(second.keyforms.length, 2, 'a part can be bound to several parameters');
  assert.deepEqual(first, copy, 'the input is not touched');
  const other = bindPose(first, defs, 'arm', slider('head_x'));
  assert.equal(other.keyforms.length, 2, 'and several parts to one parameter');
});

test('a pad is bound with a grid of corners: 2x2 the ends, 3x3 with the default, 5x5 with the halves', () => {
  assert.equal(DEFAULT_PAD_SIZE, 3);
  const three = bindPose([], defs, 'head', padOf).keyforms[0];
  assert.deepEqual(three, { target: 'head', params: ['head_x', 'head_y'], grid: { x: [-1, 0, 1], y: [-1, 0, 1] }, forms: Array.from({ length: 9 }, () => ({})) });
  const two = bindPose([], defs, 'head', padOf, 2).keyforms[0];
  assert.deepEqual([two.grid, two.forms.length], [{ x: [-1, 1], y: [-1, 1] }, 4]);
  const five = bindPose([], defs, 'head', padOf, 5).keyforms[0];
  assert.deepEqual(five.grid, { x: [-1, -0.5, 0, 0.5, 1], y: [-1, -0.5, 0, 0.5, 1] });
  assert.equal(five.forms.length, 25);
  assert.deepEqual(axisLines(defs[2], 5), [0, 0.5, 1], 'a default at an end has one line halfway');
  assert.deepEqual(axisLines(defs[3], 3), [0, 1]);
  assert.deepEqual(problems([three, two, five].map((k, i) => ({ ...k, target: ['head', 'arm', 'eyes'][i] }))), []);
  const pose = evalTarget([three], 'head', { head_x: 0.4, head_y: -0.8 });
  assert.equal(pose.rot, 0, 'at rest everywhere');
  // The first pose lands on a corner of the grid that binding made.
  const w = writeForm([three], defs, 'head', { params: ['head_x', 'head_y'], at: [1, 0] }, { rot: 20 });
  assert.equal(w.keyforms.length, 1);
  assert.equal(w.keyforms[0].forms[5].rot, 20);
});

test('unbinding removes the keyforms of that parameter for that part only', () => {
  let kfs = bindPose([], defs, 'head', slider('head_x')).keyforms;
  kfs = bindPose(kfs, defs, 'head', slider('head_y')).keyforms;
  kfs = bindPose(kfs, defs, 'arm', slider('head_x')).keyforms;
  kfs = bindPose(kfs, defs, 'head', padOf).keyforms;
  const u = unbindPose(kfs, 'head', slider('head_x'));
  assert.equal(u.unbound, true);
  assert.deepEqual(u.keyforms.map(k => [k.target, k.param ?? k.params.join('+')]), [['head', 'head_y'], ['arm', 'head_x'], ['head', 'head_x+head_y']]);
  assert.equal(isBound(u.keyforms, 'head', slider('head_x')), false);
  assert.equal(isBound(u.keyforms, 'arm', slider('head_x')), true);
  const p = unbindPose(u.keyforms, 'head', padOf);
  assert.deepEqual(p.keyforms.map(k => k.target), ['head', 'arm']);
  assert.equal(unbindPose(p.keyforms, 'head', padOf).unbound, false);
  assert.equal(unbindPose(p.keyforms, 'head', padOf).keyforms, p.keyforms, 'nothing to unbind: the same list back');
});

test('the parts bound to a parameter, with how many keys they have and how many are posed', () => {
  let kfs = bindPose([], defs, 'head', slider('head_x')).keyforms;
  kfs = bindPose(kfs, defs, 'arm', slider('head_x')).keyforms;
  kfs = bindPose(kfs, defs, 'eyes', padOf).keyforms;
  kfs = writeForm(kfs, defs, 'head', { param: 'head_x', value: 1 }, { rot: 30 }).keyforms;
  const doc = { keyforms: kfs, deformers: [], shapes: {} };
  assert.deepEqual(boundParts(doc, slider('head_x')), [{ target: 'head', kind: 'pose', keys: 3, posed: 1 }, { target: 'arm', kind: 'pose', keys: 3, posed: 0 }]);
  assert.deepEqual(boundParts(doc, padOf), [{ target: 'eyes', kind: 'pose', keys: 9, posed: 0 }]);
  assert.deepEqual(boundParts(doc, slider('head_y')), []);
  const grid = writeForm(kfs, defs, 'eyes', { params: ['head_x', 'head_y'], at: [1, 1] }, { dx: 0.02 }).keyforms;
  assert.equal(boundParts({ ...doc, keyforms: grid }, padOf)[0].posed, 1);
});

test('what affects a part: the parameters and pads it is bound to, and the ones its warp and mask are keyed to', () => {
  let kfs = bindPose([], defs, 'head', slider('head_x')).keyforms;
  kfs = bindPose(kfs, defs, 'head', padOf).keyforms;
  const deformers = [{ id: 'head_warp', part: 'head', keyforms: [{ param: 'lift', keys: [{ at: 0 }, { at: 1, pts: { 0: [0.1, 0] } }] }] }];
  const shapes = { lids: { polygon: [[0, 0], [10, 0], [10, 10]], keyforms: [{ param: 'eyes_open', keys: [{ at: 0 }] }] } };
  const doc = { keyforms: kfs, deformers, shapes };
  assert.deepEqual(affectedBy(doc, 'head'), [
    { driver: { param: 'head_x' }, kind: 'pose' }, { driver: { params: ['head_x', 'head_y'] }, kind: 'pose' }, { driver: { param: 'lift' }, kind: 'warp' },
  ]);
  assert.deepEqual(affectedBy(doc, 'lids'), [{ driver: { param: 'eyes_open' }, kind: 'mask' }]);
  assert.deepEqual(affectedBy(doc, 'eyes'), [], "a shape is bound under its own name, not the clipped part's");
  assert.deepEqual(affectedBy(doc, 'arm'), []);
  assert.deepEqual(boundParts(doc, slider('lift')), [{ target: 'head', kind: 'warp', keys: 2, posed: 1 }]);
  assert.deepEqual(boundParts(doc, slider('eyes_open')), [{ target: 'lids', kind: 'mask', keys: 1, posed: 0 }]);
});

test('a warp and a shape polygon are bound to a slider the same way', () => {
  const warps = [{ id: 'torso_warp', part: 'torso', grid: [2, 2], keyforms: [] }];
  const b = bindDeformer(warps, defs, 'torso', 'eyes_open');
  assert.equal(b.bound, true);
  assert.deepEqual(b.deformers[0].keyforms, [{ param: 'eyes_open', keys: [{ at: 0 }, { at: 1 }] }]);
  assert.equal(bindDeformer(b.deformers, defs, 'torso', 'eyes_open').bound, false, 'bound already');
  assert.equal(bindDeformer(warps, defs, 'arm', 'lift').bound, false, 'no warp on that part');
  assert.equal(bindDeformer(warps, defs, 'torso', 'nope').bound, false);
  assert.deepEqual(warpTicks(b.deformers[0].keyforms, 'eyes_open'), [{ at: 0, posed: false }, { at: 1, posed: false }]);
  const u = unbindDeformer(b.deformers, 'torso', 'eyes_open');
  assert.deepEqual([u.unbound, u.deformers[0].keyforms], [true, []]);
  assert.deepEqual(warps, [{ id: 'torso_warp', part: 'torso', grid: [2, 2], keyforms: [] }], 'the input is not touched');

  const shapes = { lids: { polygon: [[0, 0], [10, 0], [10, 10]] } };
  const m = bindMask(shapes, defs, 'lids', 'wide');
  assert.equal(m.bound, true);
  assert.deepEqual(m.shapes.lids.keyforms, [{ param: 'wide', keys: [{ at: -2 }, { at: 1 }, { at: 6 }] }]);
  assert.equal(bindMask(shapes, defs, 'iris', 'wide').bound, false, 'no such shape');
  assert.equal(bindMask(m.shapes, defs, 'lids', 'wide').bound, false, 'bound already');
  const gone = unbindMask(m.shapes, 'lids', 'wide');
  assert.equal(gone.unbound, true);
  assert.equal('keyforms' in gone.shapes.lids, false, 'a shape with no keyform has no keyforms field');
});

test('a key is removed but the keyform stays; the default key goes back to rest instead; a pad corner goes back to rest', () => {
  let kfs = bindPose([], defs, 'head', slider('head_x')).keyforms;
  kfs = writeForm(kfs, defs, 'head', { param: 'head_x', value: 1 }, { rot: 30 }).keyforms;
  kfs = writeForm(kfs, defs, 'head', { param: 'head_x', value: 0.5 }, { rot: 12 }).keyforms;
  assert.deepEqual(kfs[0].keys.map(k => k.at), [-1, 0, 0.5, 1]);
  const one = removeKey(kfs, defs, 'head', { param: 'head_x', value: 0.5 });
  assert.equal(one.removed, true);
  assert.deepEqual(one.keyforms[0].keys.map(k => k.at), [-1, 0, 1]);
  const last = removeKey(one.keyforms, defs, 'head', { param: 'head_x', value: 1 });
  assert.deepEqual(last.keyforms[0].keys, [{ at: -1 }, { at: 0 }], 'the keyform stays, now with nothing posed');
  assert.equal(last.keyforms.length, 1, 'it is still bound');
  // The default key is the rest pose the others are posed against: a posed one is put back to rest, not removed.
  const posedDefault = writeForm(kfs, defs, 'head', { param: 'head_x', value: 0 }, { rot: 5 }).keyforms;
  const rest = removeKey(posedDefault, defs, 'head', { param: 'head_x', value: 0 });
  assert.deepEqual(rest.keyforms[0].keys.find(k => k.at === 0), { at: 0 });
  assert.equal(removeKey(rest.keyforms, defs, 'head', { param: 'head_x', value: 0 }).removed, false, 'a rest default key has nothing to remove');
  assert.equal(removeKey(kfs, defs, 'arm', { param: 'head_x', value: 1 }).removed, false, 'no keyform for that part');
  assert.equal(removeKey(kfs, defs, 'head', { param: 'lift', value: 1 }).removed, false);
  // Pad: the corner goes to rest and the grid stays.
  let pad = bindPose([], defs, 'head', padOf).keyforms;
  pad = writeForm(pad, defs, 'head', { params: ['head_x', 'head_y'], at: [1, 1] }, { dx: 0.02 }).keyforms;
  const cleared = removeKey(pad, defs, 'head', { params: ['head_x', 'head_y'], at: [1, 0.9] });
  assert.equal(cleared.removed, true);
  assert.equal(cleared.keyforms.length, 1);
  assert.deepEqual(cleared.keyforms[0].forms.filter(f => Object.keys(f).length), []);
  assert.equal(removeKey(cleared.keyforms, defs, 'head', { params: ['head_x', 'head_y'], at: [1, 1] }).removed, false);
});

test('key ticks: where a parameter has keys, which of them hold a pose, for one part or for every part', () => {
  let kfs = bindPose([], defs, 'head', slider('head_x')).keyforms;
  kfs = bindPose(kfs, defs, 'arm', slider('head_x')).keyforms;
  kfs = writeForm(kfs, defs, 'head', { param: 'head_x', value: 1 }, { rot: 30 }).keyforms;
  assert.deepEqual(keyTicks(kfs, 'head_x', 'head'), [{ at: -1, posed: false }, { at: 0, posed: false }, { at: 1, posed: true }]);
  assert.deepEqual(keyTicks(kfs, 'head_x', 'arm').map(t => t.posed), [false, false, false]);
  assert.deepEqual(keyTicks(kfs, 'head_x').map(t => t.posed), [false, false, true], 'every part: posed if any is');
  assert.deepEqual(keyTicks(kfs, 'head_y'), []);
  // A pad's grid gives ticks on both of its parameters: a line is posed when one of its corners is.
  let pad = bindPose([], defs, 'head', padOf).keyforms;
  pad = writeForm(pad, defs, 'head', { params: ['head_x', 'head_y'], at: [1, -1] }, { rot: 9 }).keyforms;
  assert.deepEqual(keyTicks(pad, 'head_x'), [{ at: -1, posed: false }, { at: 0, posed: false }, { at: 1, posed: true }]);
  assert.deepEqual(keyTicks(pad, 'head_y'), [{ at: -1, posed: true }, { at: 0, posed: false }, { at: 1, posed: false }]);
});

test('controls: the studio\'s key for a parameter or a pad, and back', () => {
  assert.deepEqual(driverOf('head_x', defs, pads), { param: 'head_x' });
  assert.deepEqual(driverOf('pad:head_turn', defs, pads), { params: ['head_x', 'head_y'] });
  assert.equal(driverOf('pad:nope', defs, pads), null);
  assert.equal(driverOf('nope', defs, pads), null);
  assert.equal(controlOf({ params: ['head_x', 'head_y'] }, defs, pads), 'pad:head_turn');
  assert.equal(controlOf({ params: ['head_y', 'head_x'] }, defs, pads), null, 'a pad is its two parameters in order');
  assert.equal(controlOf({ param: 'lift' }, defs, pads), 'lift');
  assert.equal(controlOf({ param: 'nope' }, defs, pads), null);
  assert.equal(sameDriver({ param: 'head_x' }, { param: 'head_x' }), true);
  assert.equal(sameDriver({ param: 'head_x' }, padOf), false);
  assert.equal(sameDriver(padOf, { params: ['head_x', 'head_y'] }), true);
});
