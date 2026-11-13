import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deleteKeys, groupShift, liveRefs, moveKeys, refId, setKeysEase } from '../../dist/engine/src/index.js';

// Several timeline keys edited as one (docs/design/timeline-multi-select.md, UX round 3 AN-13).

const anim = () => ({
  dur: 2,
  keys: [{ t: 0, part: 'arm', rot: 0 }, { t: 0.25, part: 'arm', rot: 30 }, { t: 0.5, part: 'arm', rot: -10 }, { t: 0.9, part: 'leg', x: 0.1 }],
  params: { look_x: [{ t: 0.1, v: 0 }, { t: 0.6, v: 1, ease: 'out' }] },
});
const K = index => ({ kind: 'key', index }), P = (id, index) => ({ kind: 'param', id, index });

test('refs name keys once and only those that exist', () => {
  assert.equal(refId(K(3)), 'k:3');
  assert.equal(refId(P('look_x', 1)), 'p:look_x:1');
  assert.deepEqual(liveRefs(anim(), [K(1), K(1), K(9), P('look_x', 0), P('nope', 0)]), [K(1), P('look_x', 0)]);
});

test('a group moves by one amount and stops at the edges as one', () => {
  const d = anim();
  assert.equal(groupShift(d, [K(1), P('look_x', 1)], 0.2), 0.2);
  assert.equal(groupShift(d, [K(1), P('look_x', 1)], 0.6), 0.4, 'the last one (0.6) stops at the end');
  assert.equal(groupShift(d, [K(1), P('look_x', 0)], -0.5), -0.1, 'the first one (0.1) stops at the start');
});

test('moveKeys moves channel and parameter keys together and follows them into their new places', () => {
  const r = moveKeys(anim(), [K(1), P('look_x', 0)], 0.3);
  assert.deepEqual(r.def.keys.map(k => [k.t, k.rot ?? k.x]), [[0, 0], [0.5, -10], [0.55, 30], [0.9, 0.1]]);
  assert.deepEqual(r.def.params.look_x.map(k => k.t), [0.4, 0.6]);
  assert.deepEqual(r.refs, [K(2), P('look_x', 0)], 'the rot 30 key sorted past the 0.5 one');
  assert.equal(r.def.keys[2].rot, 30);
  const same = anim();
  assert.equal(moveKeys(same, [K(0)], -0.5).def, same, 'a key at the start cannot go earlier: nothing changes');
});

test('deleteKeys removes them all, and a track left empty', () => {
  const d = deleteKeys(anim(), [K(0), K(2), P('look_x', 0), P('look_x', 1)]);
  assert.deepEqual(d.keys.map(k => k.t), [0.25, 0.9]);
  assert.equal(d.params, undefined);
  assert.deepEqual(deleteKeys(anim(), [P('look_x', 1)]).params, { look_x: [{ t: 0.1, v: 0 }] });
});

test('setKeysEase sets or clears the ease of every chosen key', () => {
  const d = setKeysEase(anim(), [K(1), P('look_x', 0)], 'bezier(0.3,0,0.7,1)');
  assert.equal(d.keys[1].ease, 'bezier(0.3,0,0.7,1)');
  assert.equal(d.params.look_x[0].ease, 'bezier(0.3,0,0.7,1)');
  assert.equal(d.keys[0].ease, undefined, 'others are left alone');
  assert.equal(Object.hasOwn(setKeysEase(anim(), [P('look_x', 1)], undefined).params.look_x[1], 'ease'), false);
});
