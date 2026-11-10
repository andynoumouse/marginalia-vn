import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  writeForm, dragForm, dragForms, formAt, isKeyed, snapSpot, padCorners, extendGrid, keyformDrivers, targetsOf, spotLabel,
  isRestForm, evalTarget, evalKeyform, checkParams, KEY_SNAP, GRID_MAX, snapToTicks,
} from '../../dist/engine/src/index.js';

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-4, `${msg ?? ''} ${a} vs ${b}`);
const defs = [
  { id: 'head_x', min: -1, max: 1, default: 0 },
  { id: 'head_y', min: -1, max: 1, default: 0 },
  { id: 'lift', min: 0, max: 1, default: 0 },
  { id: 'eyes_open', min: 0, max: 1, default: 1 },
];
const targets = new Set(['head', 'arm', 'eyes']);
const sliderAt = (param, value) => ({ param, value });
const padAt = (x, y, a = 'head_x', b = 'head_y') => ({ params: [a, b], at: [x, y] });
const problems = kfs => { const out = []; checkParams({ parameters: defs, keyforms: kfs }, targets, m => out.push(m)); return out; };

test('the first write makes the keyform with a rest key at the default, and keeps the keys sorted and sparse', () => {
  const r = writeForm([], defs, 'head', sliderAt('head_x', 1), { rot: 8.123456, dx: 0.0123456, sx: 0, opacity: 1 });
  assert.deepEqual(r.spot, { param: 'head_x', value: 1 });
  assert.deepEqual(r.keyforms, [{ target: 'head', param: 'head_x', keys: [{ at: 0 }, { at: 1, dx: 0.01235, rot: 8.12346 }] }]);
  assert.deepEqual(problems(r.keyforms), []);
  const left = writeForm(r.keyforms, defs, 'head', sliderAt('head_x', -1), { rot: -8 });
  assert.deepEqual(left.keyforms[0].keys.map(k => k.at), [-1, 0, 1]);
  assert.equal(left.keyforms.length, 1, 'one keyform per target and parameter');
  const first = writeForm([], defs, 'head', sliderAt('head_x', 0), { rot: 3 });
  assert.deepEqual(first.keyforms[0].keys, [{ at: 0, rot: 3 }], 'a write at the default is the only key');
});

test('a value near a key edits that key; near the default of a new keyform it lands on the default; the range clamps', () => {
  const base = writeForm([], defs, 'head', sliderAt('head_x', 1), { rot: 8 }).keyforms;
  assert.deepEqual(snapSpot(base, defs, 'head', sliderAt('head_x', 1 - KEY_SNAP * 2 * 0.9)), { param: 'head_x', value: 1 });
  assert.deepEqual(snapSpot(base, defs, 'head', sliderAt('head_x', 0.5)), { param: 'head_x', value: 0.5 }, 'far from every key it is a new one');
  assert.deepEqual(snapSpot([], defs, 'head', sliderAt('head_x', 0.01)), { param: 'head_x', value: 0 });
  assert.deepEqual(snapSpot([], defs, 'head', sliderAt('head_x', 9)), { param: 'head_x', value: 1 });
  assert.equal(snapSpot([], defs, 'head', sliderAt('nope', 0)), null);
  const edited = writeForm(base, defs, 'head', sliderAt('head_x', 0.99), { rot: 12 });
  assert.deepEqual(edited.keyforms[0].keys, [{ at: 0 }, { at: 1, rot: 12 }]);
  assert.equal(writeForm(base, defs, 'head', sliderAt('nope', 0), { rot: 1 }), null);
});

test('a drag writes the pose on show plus the delta: first drag at a new value, and on a curve between keys', () => {
  const zero = { dx: 0, dy: 0, sx: 0, sy: 0, rot: 0 };
  // Nothing authored yet: the drag at head_x = 1 becomes the key; the curve eases from the rest key at 0.
  const a = dragForm([], defs, 'head', sliderAt('head_x', 1), { ...zero, rot: 8, dx: 0.01 }, { head_x: 1 });
  close(evalTarget(a.keyforms, 'head', { head_x: 1 }).rot, 8);
  close(evalTarget(a.keyforms, 'head', { head_x: 0.5 }).rot, 4);
  close(evalTarget(a.keyforms, 'head', { head_x: 0 }).rot, 0);
  assert.deepEqual(problems(a.keyforms), []);
  // Between the keys at 0.5 the pose on show is 4; a drag of +2 makes a new key there that holds 6 and leaves the ends alone.
  const b = dragForm(a.keyforms, defs, 'head', sliderAt('head_x', 0.5), { ...zero, rot: 2 }, { head_x: 0.5 });
  assert.deepEqual(b.keyforms[0].keys.map(k => k.at), [0, 0.5, 1]);
  close(evalTarget(b.keyforms, 'head', { head_x: 0.5 }).rot, 6);
  close(evalTarget(b.keyforms, 'head', { head_x: 1 }).rot, 8);
  close(evalTarget(b.keyforms, 'head', { head_x: 0 }).rot, 0);
  // A second drag at the same value updates that key instead of adding one.
  const c = dragForm(b.keyforms, defs, 'head', sliderAt('head_x', 0.5), { ...zero, rot: -1 }, { head_x: 0.5 });
  assert.equal(c.keyforms[0].keys.length, 3);
  close(evalTarget(c.keyforms, 'head', { head_x: 0.5 }).rot, 5);
});

test('one drag poses several targets by the same delta, each on its own keyform, duplicates once, and none is null', () => {
  const zero = { dx: 0, dy: 0, sx: 0, sy: 0, rot: 0 };
  const r = dragForms([], defs, ['head', 'arm', 'head'], sliderAt('head_x', 1), { ...zero, rot: 8 }, { head_x: 1 });
  assert.deepEqual(r.written, ['head', 'arm']);
  assert.deepEqual(r.spot, { param: 'head_x', value: 1 });
  assert.equal(r.keyforms.length, 2);
  close(evalTarget(r.keyforms, 'head', { head_x: 1 }).rot, 8);
  close(evalTarget(r.keyforms, 'arm', { head_x: 1 }).rot, 8);
  assert.deepEqual(problems(r.keyforms), []);
  const again = dragForms(r.keyforms, defs, ['arm'], sliderAt('head_x', 1), { ...zero, rot: 2 }, { head_x: 1 });
  close(evalTarget(again.keyforms, 'arm', { head_x: 1 }).rot, 10);
  close(evalTarget(again.keyforms, 'head', { head_x: 1 }).rot, 8, 'the others stay');
  assert.equal(dragForms([], defs, ['head'], sliderAt('nope', 0), { ...zero, rot: 1 }, {}), null);
  assert.equal(dragForms([], defs, [], sliderAt('head_x', 1), { ...zero, rot: 1 }, {}), null);
});

test('the pose after a drag is the pose before plus the delta, also where other keyforms of the target scale it', () => {
  const kfs = [
    { target: 'arm', param: 'lift', keys: [{ at: 0 }, { at: 1, sx: 0.5, rot: 40 }] },
    { target: 'arm', param: 'head_x', keys: [{ at: 0 }, { at: 1, sx: 1, rot: 10 }] },   // x2 across
  ];
  const values = { lift: 1, head_x: 1 };
  const before = evalTarget(kfs, 'arm', values);
  close(before.sx, 2 * 1.5 - 1);
  const delta = { dx: 0.02, dy: -0.01, sx: 0.3, sy: 0.2, rot: 5 };
  const r = dragForm(kfs, defs, 'arm', sliderAt('lift', 1), delta, values);
  const after = evalTarget(r.keyforms, 'arm', values);
  for (const f of ['dx', 'dy', 'sx', 'sy', 'rot']) close(after[f] - before[f], delta[f], f);
  // The other keyform is untouched.
  assert.deepEqual(r.keyforms[1], kfs[1]);
});

test('isKeyed tells a key from a value between keys', () => {
  const kfs = writeForm(writeForm([], defs, 'head', sliderAt('head_x', 1), { rot: 8 }).keyforms, defs, 'head', sliderAt('head_x', -1), { rot: -8 }).keyforms;
  assert.equal(isKeyed(kfs, defs, 'head', sliderAt('head_x', 1)), true);
  assert.equal(isKeyed(kfs, defs, 'head', sliderAt('head_x', 0.5)), false);
});

test('a pad writes the nearest corner of a grid it makes from min, default and max', () => {
  const r = writeForm([], defs, 'head', padAt(0.9, 0.1), { rot: 8, dx: 0.01 });
  assert.deepEqual(r.spot, padAt(1, 0));
  const kf = r.keyforms[0];
  assert.deepEqual(kf.params, ['head_x', 'head_y']);
  assert.deepEqual(kf.grid, { x: [-1, 0, 1], y: [-1, 0, 1] });
  assert.equal(kf.forms.length, 9);
  assert.deepEqual(kf.forms[1 * 3 + 2], { dx: 0.01, rot: 8 }, 'row y = 0, column x = 1');
  assert.equal(kf.forms.filter(f => !isRestForm(f)).length, 1);
  assert.deepEqual(problems(r.keyforms), []);
  close(evalTarget(r.keyforms, 'head', { head_x: 1, head_y: 0 }).rot, 8);
  close(evalTarget(r.keyforms, 'head', { head_x: 0.5, head_y: 0 }).rot, 4);
  close(evalTarget(r.keyforms, 'head', { head_x: 0, head_y: 0 }).rot, 0);
  // The default-only axis: a parameter whose default is its min has a grid of two lines.
  const two = writeForm([], defs, 'arm', padAt(1, 1, 'lift', 'eyes_open'), { rot: 1 });
  assert.deepEqual(two.keyforms[0].grid, { x: [0, 1], y: [0, 1] });
  assert.deepEqual(problems(two.keyforms), []);
});

test('a pad drag starts from the corner on show; formAt and isKeyed read it back', () => {
  const zero = { dx: 0, dy: 0, sx: 0, sy: 0, rot: 0 };
  const a = dragForm([], defs, 'head', padAt(-1, 1), { ...zero, rot: -8 }, { head_x: -1, head_y: 1 });
  assert.deepEqual(a.spot, padAt(-1, 1));
  const b = dragForm(a.keyforms, defs, 'head', padAt(-0.9, 0.9), { ...zero, rot: -2, dy: 0.01 }, { head_x: -0.9, head_y: 0.9 });
  assert.deepEqual(b.spot, padAt(-1, 1), 'same corner');
  close(formAt(b.keyforms, defs, 'head', padAt(-1, 1)).rot, -10);
  close(formAt(b.keyforms, defs, 'head', padAt(-1, 1)).dy, 0.01);
  assert.equal(isKeyed(b.keyforms, defs, 'head', padAt(-1, 1)), true);
  assert.equal(isKeyed(b.keyforms, defs, 'head', padAt(1, 1)), false, 'a corner at rest is not keyed');
  assert.equal(formAt(b.keyforms, defs, 'eyes', padAt(-1, 1)), null, 'another target has no keyform');
  assert.equal(formAt([], defs, 'head', padAt(0, 0)), null);
});

test('extending a grid adds a line and keeps the pose; it refuses a line that is there and a grid that is full', () => {
  const kfs = writeForm(writeForm([], defs, 'head', padAt(1, 0), { rot: 8, dx: 0.02 }).keyforms, defs, 'head', padAt(0, 1), { rot: 3, dy: 0.01 }).keyforms;
  const r = extendGrid(kfs, defs, 'head', ['head_x', 'head_y'], 'x', 0.5);
  assert.equal(r.added, true);
  assert.deepEqual(r.keyforms[0].grid, { x: [-1, 0, 0.5, 1], y: [-1, 0, 1] });
  assert.equal(r.keyforms[0].forms.length, 12);
  assert.deepEqual(problems(r.keyforms), []);
  for (const x of [-1, -0.3, 0, 0.2, 0.5, 0.8, 1]) for (const y of [-1, -0.2, 0, 0.6, 1]) {
    const was = evalKeyform(kfs[0], { head_x: x, head_y: y }), now = evalKeyform(r.keyforms[0], { head_x: x, head_y: y });
    for (const f of ['dx', 'dy', 'rot', 'sx', 'sy', 'opacity']) close(now[f], was[f], `${f} at ${x},${y}`);
  }
  const y = extendGrid(r.keyforms, defs, 'head', ['head_x', 'head_y'], 'y', -0.5);
  assert.deepEqual(y.keyforms[0].grid.y, [-1, -0.5, 0, 1]);
  assert.equal(extendGrid(r.keyforms, defs, 'head', ['head_x', 'head_y'], 'x', 0.51).added, false, 'a line within the snap distance');
  assert.equal(extendGrid(kfs, defs, 'head', ['head_x', 'nope'], 'x', 0.5).added, false);
  // From nothing: the grid is made first.
  const fresh = extendGrid([], defs, 'eyes', ['head_x', 'head_y'], 'y', 0.5);
  assert.deepEqual(fresh.keyforms[0].grid, { x: [-1, 0, 1], y: [-1, 0, 0.5, 1] });
  let full = kfs;
  for (let i = 1; i < 20; i++) full = extendGrid(full, defs, 'head', ['head_x', 'head_y'], 'x', -1 + i * 0.1).keyforms;
  assert.equal(full[0].grid.x.length, GRID_MAX);
});

test('the corners of a pad, and what drives a target', () => {
  const kfs = [
    ...writeForm([], defs, 'head', sliderAt('lift', 1), { rot: 5 }).keyforms,
    ...writeForm([], defs, 'arm', sliderAt('lift', 0.5), { rot: 5 }).keyforms,
    ...writeForm([], defs, 'head', padAt(1, 0), { rot: 8 }).keyforms,
  ];
  const corners = padCorners(kfs, ['head_x', 'head_y']);
  assert.equal(corners.length, 9);
  assert.deepEqual(corners.filter(c => c.authored), [{ x: 1, y: 0, authored: true }]);
  assert.deepEqual(padCorners(kfs, ['head_x', 'head_y'], 'arm'), []);
  assert.deepEqual(keyformDrivers(kfs, 'head'), [{ param: 'lift' }, { params: ['head_x', 'head_y'] }]);
  assert.deepEqual(keyformDrivers(kfs, 'eyes'), []);
  assert.deepEqual(targetsOf(kfs, 'lift'), ['head', 'arm']);
  assert.deepEqual(targetsOf(kfs, 'head_y'), ['head']);
  assert.equal(spotLabel(sliderAt('head_x', 0.33333)), 'head_x = 0.333');
  assert.equal(spotLabel(padAt(1, -0.5)), 'head_x 1, head_y -0.5');
});

test('writing never touches the input list', () => {
  const kfs = [{ target: 'head', param: 'head_x', keys: [{ at: 0 }, { at: 1, rot: 8 }] }];
  const frozen = structuredClone(kfs);
  writeForm(kfs, defs, 'head', sliderAt('head_x', 1), { rot: 1 });
  dragForm(kfs, defs, 'head', sliderAt('head_x', 0.5), { dx: 0.1, dy: 0, sx: 0, sy: 0, rot: 1 }, { head_x: 0.5 });
  extendGrid(kfs, defs, 'head', ['head_x', 'head_y'], 'x', 0.5);
  assert.deepEqual(kfs, frozen);
});

test('a key can be reached along an ease; writes keep it, linear drops it, bad names are reported', async () => {
  const { setKeyEase, easeAt, blend1D, easing } = await import('../../dist/engine/src/index.js');
  const kfs = [{ target: 'a', param: 'head_x', keys: [{ at: -1, rot: -10 }, { at: 0 }, { at: 1, rot: 10 }] }];
  const spot = { param: 'head_x', value: 1 };
  assert.equal(easeAt(kfs, defs, 'a', spot), 'linear');
  const eased = setKeyEase(kfs, defs, 'a', spot, 'in');
  assert.equal(easeAt(eased, defs, 'a', spot), 'in');
  assert.equal(kfs[0].keys[2].ease, undefined, 'the input is not changed');
  close(blend1D(eased[0].keys, 0.5).rot, 10 * easing('in')(0.5), 'eased halfway');
  close(blend1D(eased[0].keys, 0).rot, 0, 'a key is exact');
  close(blend1D(eased[0].keys, -0.5).rot, -5, 'the other segment stays linear');
  const written = writeForm(eased, defs, 'a', spot, { rot: 20 });
  assert.equal(easeAt(written.keyforms, defs, 'a', spot), 'in', 'writing a pose keeps the ease');
  assert.equal(setKeyEase(eased, defs, 'a', spot, 'linear')[0].keys[2].ease, undefined);
  assert.equal(setKeyEase(kfs, defs, 'a', { param: 'head_x', value: 0.5 }, 'in'), null, 'no key there');
  const problems = [];
  checkParams({ parameters: defs, keyforms: [{ target: 'a', param: 'head_x', keys: [{ at: 0, ease: 'nope' }, { at: 1, ease: 'out' }] }] }, new Set(['a']), m => problems.push(m));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /unknown ease "nope"/);
});

test('a scrubbed slider lands on a key near it, else on its step (SR-18)', () => {
  assert.equal(snapToTicks(0.53, [0, 0.5, 1], 0, 1, 0.01), 0.5, 'within reach of the key at 0.5');
  assert.equal(snapToTicks(0.6, [0, 0.5, 1], 0, 1, 0.01), 0.6, 'out of reach: the step');
  assert.equal(snapToTicks(0.6049, [], 0, 1, 0.01), 0.6);
  assert.equal(snapToTicks(-0.97, [-1, 0, 1], -1, 1, 0.01), -1, 'the reach is a fraction of the whole range');
  assert.equal(snapToTicks(12.4, [], 0, 30, 1), 12, 'a wide range steps by 1');
});
