import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  gizmoTarget, keyFromDelta, keyedOffset, offsetDelta, gizmoHandles, pickHandle, ringAround, GIZMO_RING, NO_OFFSET, BONE_REST, composeBones, applyMatrix,
} from '../../dist/engine/src/index.js';

const off = o => ({ ...NO_OFFSET, ...o });
const box = (x, y, w, h) => ({ x, y, w, h });
const geo = {
  bones: { torso: { pivot: [0, 0] }, arm: { parent: 'torso', pivot: [50, 0] }, loop: { parent: 'loop' } },
  parts: { body: { box: box(-20, -100, 40, 100), bone: 'torso' }, hand: { box: box(40, -10, 20, 20), bone: 'arm' }, hat: { box: box(-10, -140, 20, 20) } },
  pivotOf: () => null, unit: 100,
};

test('gizmoTarget: a root bone hangs on the rest matrix, a child on its parent in the pose', () => {
  const t = gizmoTarget(geo, new Map(), 'torso');
  assert.equal(t.kind, 'bone');
  assert.deepEqual(t.parent, BONE_REST);
  assert.deepEqual(t.pivot, [0, 0]);
  const posed = new Map([['torso', off({ rot: 90 })]]);
  const arm = gizmoTarget(geo, posed, 'arm');
  const w = composeBones(geo.bones, posed, { torso: [0, 0], arm: [50, 0] }, 100);
  assert.deepEqual(arm.parent, w.torso);
  const [x, y] = applyMatrix(arm.parent, 50, 0);
  assert.ok(Math.abs(x) < 1e-9 && Math.abs(y - 50) < 1e-9, 'the arm pivot swung with the torso');
  assert.deepEqual(arm.offset, NO_OFFSET);
});

test('gizmoTarget: a part uses its bone, its own pivot or the middle of its box; a looped parent makes a root', () => {
  const hand = gizmoTarget(geo, new Map([['hand', off({ rot: 5 })]]), 'hand');
  assert.equal(hand.kind, 'part');
  assert.deepEqual(hand.pivot, [50, 0]); // the pivot of the arm it sits on
  assert.equal(hand.offset.rot, 5);
  assert.deepEqual(gizmoTarget(geo, new Map(), 'hat').pivot, [0, -130]);
  assert.deepEqual(gizmoTarget(geo, new Map(), 'hat').parent, BONE_REST);
  assert.deepEqual(gizmoTarget({ ...geo, pivotOf: n => (n === 'hat' ? [1, 2] : null) }, new Map(), 'hat').pivot, [1, 2]);
  assert.deepEqual(gizmoTarget(geo, new Map(), 'loop').parent, BONE_REST);
  assert.equal(gizmoTarget(geo, new Map(), 'nope'), null);
});

test('gizmoTarget: alt-scale centre is the middle of the parts under a bone', () => {
  const t = gizmoTarget(geo, new Map(), 'torso');
  assert.deepEqual(t.center, [20, -45]); // body and hand together: x -20..60, y -100..10
});

test('keyFromDelta adds the drag to what the animation has at that time, one channel group per tool', () => {
  const def = { keys: [{ t: 0.5, part: 'arm', rot: 10 }] };
  const moved = keyFromDelta(def, 'arm', 0.25, 'move', off({ dx: 0.01, dy: -0.02 }));
  const k = moved.keys.find(x => x.t === 0.25);
  assert.equal(k.part, 'arm');
  assert.equal(k.x, 0.01);
  assert.equal(k.y, -0.02);
  assert.equal(k.rot, undefined);
  assert.equal(moved.keys.length, 2);
  const rotated = keyFromDelta(def, 'arm', 0.5, 'rotate', off({ rot: 5 }));
  assert.equal(rotated.keys.length, 1, 'the key at the playhead is updated');
  assert.equal(rotated.keys[0].rot, 15);
  const scaled = keyFromDelta(def, 'arm', 0.5, 'scale', off({ sx: 0.2, sy: 0.4 }));
  assert.equal(scaled.keys[0].scale, 0.3);
  assert.equal(def.keys.length, 1, 'the input is not changed');
});

test('keyedOffset reads one part and gives zeros for the unkeyed', () => {
  const def = { keys: [{ t: 1, part: 'arm', rot: 10 }] };
  assert.equal(keyedOffset(def, 'arm', 1).rot, 10);
  assert.deepEqual(keyedOffset(def, 'leg', 1), NO_OFFSET);
  assert.deepEqual(offsetDelta(off({ dx: 1 }), off({ dx: 3, rot: 2 })), off({ dx: 2, rot: 2 }));
});

test('handles: tips, the middle, shafts and the ring are picked; empty space is not', () => {
  const f = { origin: [100, 100], x: [1, 0], y: [0, 1] };
  const mv = gizmoHandles('move', f);
  assert.equal(pickHandle(mv, [190, 100]).axis, 'x');
  assert.equal(pickHandle(mv, [100, 190]).axis, 'y');
  assert.equal(pickHandle(mv, [102, 98]).axis, 'free');
  assert.equal(pickHandle(mv, [150, 102]).axis, 'x', 'on the shaft');
  assert.equal(pickHandle(mv, [150, 150]), null);
  const rt = gizmoHandles('rotate', f);
  assert.equal(pickHandle(rt, [164, 100]).kind, 'ring');
  assert.equal(pickHandle(rt, [100, 100]), null);
  assert.equal(pickHandle(gizmoHandles('scale', f), [190, 99]).axis, 'x');
});

test('the rotate ring: a press just outside its line still turns, and one inside it is the ring for a drag (SD-12, SR-17)', () => {
  const ring = gizmoHandles('rotate', { origin: [100, 100], x: [1, 0], y: [0, 1] });
  assert.equal(pickHandle(ring, [100 + GIZMO_RING + 8, 100])?.kind, 'ring', 'a few px past the line');
  assert.equal(pickHandle(ring, [100 + GIZMO_RING + 12, 100]), null, 'farther out is the art under it');
  assert.equal(pickHandle(ring, [130, 100]), null, 'inside is not the line');
  assert.equal(ringAround(ring, [130, 100])?.kind, 'ring', 'but a drag from inside turns');
  assert.equal(ringAround(ring, [100 + GIZMO_RING + 2, 100]), null);
  const move = gizmoHandles('move', { origin: [100, 100], x: [1, 0], y: [0, 1] });
  assert.equal(ringAround(move, [130, 100]), null, 'only Rotate has a ring');
});
