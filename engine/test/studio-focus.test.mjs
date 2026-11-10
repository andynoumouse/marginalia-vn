import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  focusKind, afterChoosePart, afterChooseControl, goUp, breadcrumb, poseTarget, pickTargets, cycleHit, cycleLabel,
} from '../../dist/engine/src/index.js';

const bound = new Set(['arm_r|lift', 'hand_r|lift']);
const boundTo = (p, c) => bound.has(`${p}|${c}`);

test('the focus kind is what the two fields make together', () => {
  assert.equal(focusKind({ control: null, part: null }), 'none');
  assert.equal(focusKind({ control: 'lift', part: null }), 'param');
  assert.equal(focusKind({ control: null, part: 'arm_r' }), 'part');
  assert.equal(focusKind({ control: 'lift', part: 'arm_r' }), 'keyform');
});

test('choosing a part: bound to the control stays under it, any other replaces it', () => {
  const param = { control: 'lift', part: null };
  assert.deepEqual(afterChoosePart(param, 'arm_r', boundTo), { control: 'lift', part: 'arm_r' });
  assert.deepEqual(afterChoosePart(param, 'head', boundTo), { control: null, part: 'head' }, 'an unbound part drops the control');
  assert.deepEqual(afterChoosePart({ control: 'lift', part: 'arm_r' }, 'head', boundTo), { control: null, part: 'head' });
  assert.deepEqual(afterChoosePart({ control: null, part: 'head' }, 'arm_r', boundTo), { control: null, part: 'arm_r' }, 'with no control nothing is under it');
  assert.deepEqual(afterChoosePart({ control: 'lift', part: 'arm_r' }, null, boundTo), { control: 'lift', part: null }, 'clearing the part keeps the control');
  assert.deepEqual(afterChoosePart({ control: null, part: 'head' }, null, boundTo), { control: null, part: null });
});

test('choosing a control mirrors choosing a part; going up keeps one of the two', () => {
  assert.deepEqual(afterChooseControl({ control: null, part: 'head' }, 'lift', boundTo), { control: 'lift', part: null }, 'a part the control does not move is dropped');
  assert.deepEqual(afterChooseControl({ control: null, part: 'arm_r' }, 'lift', boundTo), { control: 'lift', part: 'arm_r' }, 'a part it moves stays: a keyform focus');
  assert.deepEqual(afterChooseControl({ control: 'lift', part: 'arm_r' }, 'lift', boundTo), { control: 'lift', part: 'arm_r' });
  assert.deepEqual(afterChooseControl({ control: 'lift', part: 'arm_r' }, null, boundTo), { control: null, part: 'arm_r' });
  const kf = { control: 'lift', part: 'arm_r' };
  assert.deepEqual(goUp(kf, 'param'), { control: 'lift', part: null });
  assert.deepEqual(goUp(kf, 'part'), { control: null, part: 'arm_r' });
});

test('the breadcrumb names the keyform, its value and whether a key is there', () => {
  const kf = { control: 'lift', part: 'arm_r' };
  const on = breadcrumb(kf, 'Arm lift', '0.5', true), off = breadcrumb(kf, 'Arm lift', '0.7', false);
  assert.deepEqual(on.crumbs.map(c => c.text), ['arm_r', 'Arm lift', '@ 0.5']);
  assert.deepEqual(on.crumbs.map(c => c.up), ['part', 'param', null]);
  assert.equal(on.status, 'key');
  assert.equal(off.status, 'no key here: a drag adds one');
  assert.deepEqual(breadcrumb({ control: 'lift', part: null }, 'Arm lift', '0.5', null).crumbs, [{ text: 'Arm lift', up: null }]);
  assert.deepEqual(breadcrumb({ control: null, part: 'head' }, 'x', '0', null).crumbs, [{ text: 'head', up: null }]);
  assert.deepEqual(breadcrumb({ control: null, part: null }, 'x', '0', null), { crumbs: [], status: '' });
});

test('the breadcrumb says when the gizmo poses the bone a part sits on, and asks nothing about keys when nothing it poses is bound', () => {
  const kf = { control: 'eye_x', part: 'eyes' };
  assert.equal(breadcrumb(kf, 'eye_x', '1', true, 'eyes').status, 'key', 'the part itself: nothing more to say');
  assert.equal(breadcrumb(kf, 'eye_x', '1', false, 'head').status, 'no key here: a drag adds one · the gizmo poses head, the bone eyes sits on');
  assert.equal(breadcrumb(kf, 'eye_x', '1', null, 'head').status, 'the gizmo poses head, the bone eyes sits on');
  assert.equal(breadcrumb(kf, 'eye_x', '1', null).status, '');
});

test('the gizmo poses a part bound by itself, else the bone it sits on', () => {
  assert.equal(poseTarget('eyes', 'head', true), 'eyes', 'eyes keyed alone: the gizmo poses the eyes');
  assert.equal(poseTarget('eyes', 'head', false), 'head', 'not bound by itself: the bone, whose keyform the part follows');
  assert.equal(poseTarget('skirt', null, false), 'skirt', 'on no bone: the part');
  assert.equal(poseTarget('skirt', null, true), 'skirt');
});

test('what a pick may land on', () => {
  const parts = ['head', 'arm_r', 'hand_r', 'body'];
  assert.deepEqual(pickTargets('bindParts', parts, new Set(['arm_r'])), ['head', 'hand_r', 'body'], 'bound parts are not offered again');
  assert.deepEqual(pickTargets('bindToParam', ['lift', 'turn'], new Set(['lift'])), ['turn']);
  assert.deepEqual(pickTargets('copyKeys', parts, new Set(), new Set(['arm_r', 'body']), 'body'), ['arm_r'], 'only parts with keys, and not the part itself');
});

test('clicks on one spot walk through the parts under it and wrap', () => {
  const hits = ['hand', 'arm', 'body'];
  const a = cycleHit(hits, null, null, [100, 100]);
  assert.equal(a.part, 'hand');
  assert.deepEqual([a.position, a.count], [1, 3]);
  const b = cycleHit(hits, null, a.state, [102, 101]);
  assert.equal(b.part, 'arm', 'a second click within 4 px takes the next');
  const c = cycleHit(hits, null, b.state, [103, 100]);
  assert.equal(c.part, 'body');
  assert.equal(cycleHit(hits, null, c.state, [100, 100]).part, 'hand', 'and wraps');
  assert.equal(cycleLabel(b), 'arm, 2 of 3. Click again for the next.');
});

test('a click elsewhere, or on a changed stack, starts again from the front', () => {
  const hits = ['hand', 'arm', 'body'];
  const a = cycleHit(hits, null, null, [100, 100]);
  const b = cycleHit(hits, null, a.state, [100, 100]);
  assert.equal(cycleHit(hits, null, b.state, [140, 100]).part, 'hand', 'moved: front again');
  assert.equal(cycleHit(['hand', 'body'], null, b.state, [100, 100]).part, 'hand', 'a different stack: front again');
  // the run keeps its first point, so small drifts cannot carry a run across the stage
  const near = cycleHit(hits, null, a.state, [103, 100]);
  assert.equal(near.part, 'arm', '3 px from where the run began continues it');
  assert.equal(cycleHit(hits, null, near.state, [106, 100]).part, 'hand', '6 px from where it began (not from the last click) is a new run');
});

test('candidates limit the cycle; with none under the pointer the frontmost hit is a plain part', () => {
  const hits = ['hand', 'arm', 'body'];
  const only = new Set(['arm', 'body']);
  const a = cycleHit(hits, only, null, [5, 5]);
  assert.equal(a.part, 'arm');
  assert.equal(a.count, 2);
  assert.equal(cycleHit(hits, only, a.state, [5, 5]).part, 'body');
  const none = cycleHit(hits, new Set(['head']), null, [5, 5]);
  assert.deepEqual([none.part, none.fallback, none.state], ['hand', true, null]);
  const empty = cycleHit([], null, null, [5, 5]);
  assert.deepEqual([empty.part, empty.fallback, empty.count], [null, false, 0]);
  assert.equal(cycleLabel(none), '', 'nothing to cycle, no label');
});
