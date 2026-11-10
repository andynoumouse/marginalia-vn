import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renameBone, removeBone, BONE_NAME } from '../../dist/engine/src/index.js';

/** A rig that names `head` in every place a bone can be named, next to things that do not. */
const doc = () => ({
  bones: { root: {}, head: { parent: 'root', pivot: [1, 2] }, hat: { parent: 'head' }, arm: { parent: 'root' } },
  parts: { face: { bone: 'head' }, coat: { bone: 'root' }, hair: { bone: 'head', pivot: [3, 4] } },
  shapes: { lids: { bone: 'head', polygon: [] }, mark: { follow: 'face', polygon: [] } },
  keyforms: [{ target: 'head', param: 'tilt', keys: [{ at: 0 }] }, { target: 'face', param: 'tilt', keys: [] }],
  anims: { nod: { keys: [{ t: 0, part: 'head', rot: 5 }, { t: 1, part: 'arm' }, { t: 1, part: 'head' }] }, wave: { keys: [{ t: 0, part: 'arm' }] } },
  deformers: [
    { id: 'hair_mesh', part: 'hair', mesh: { verts: [0, 0, 1, 0, 0, 1], tris: [0, 1, 2], defaultBone: 'head', weights: { 0: { head: 0.5, root: 0.5 } } }, keyforms: [] },
    { id: 'coat_warp', part: 'coat', grid: [2, 2], keyforms: [] },
  ],
  physics: {
    bob: { inputs: [{ bone: 'head', channel: 'rot', weight: 1 }, { param: 'x', weight: 1 }], segments: [], outputs: [{ part: 'head', scale: 1 }, { part: 'arm', scale: 1 }] },
    still: { inputs: [], segments: [], outputs: [{ param: 'x', scale: 1 }] },
  },
});

test('renameBone: the name follows into bones, parts, shapes, keyforms, keys, physics and skins; the input is left alone', () => {
  const before = doc(), copy = structuredClone(before);
  const r = renameBone(before, 'head', ' skull ', ['face', 'coat', 'hair']);
  assert.ok(!('error' in r), r.error);
  assert.deepEqual(before, copy, 'the input is left alone');
  assert.equal(r.name, 'skull', 'trimmed');
  const d = r.doc;
  assert.deepEqual(Object.keys(d.bones), ['root', 'skull', 'hat', 'arm'], 'the bones keep their order');
  assert.deepEqual(d.bones.skull, { parent: 'root', pivot: [1, 2] });
  assert.equal(d.bones.hat.parent, 'skull');
  assert.equal(d.bones.arm, before.bones.arm, 'an untouched bone is the same object');
  assert.deepEqual(d.parts, { face: { bone: 'skull' }, coat: { bone: 'root' }, hair: { bone: 'skull', pivot: [3, 4] } });
  assert.equal(d.shapes.lids.bone, 'skull');
  assert.equal(d.shapes.mark, before.shapes.mark);
  assert.equal(d.keyforms[0].target, 'skull');
  assert.equal(d.keyforms[1], before.keyforms[1]);
  assert.deepEqual(d.anims.nod.keys.map(k => k.part), ['skull', 'arm', 'skull']);
  assert.equal(d.anims.nod.keys[0].rot, 5, 'the rest of a key stays');
  assert.equal(d.anims.wave, before.anims.wave);
  assert.deepEqual(d.deformers[0].mesh, { verts: [0, 0, 1, 0, 0, 1], tris: [0, 1, 2], defaultBone: 'skull', weights: { 0: { skull: 0.5, root: 0.5 } } });
  assert.equal(d.deformers[1], before.deformers[1], 'a lattice has no bones');
  assert.deepEqual(d.physics.bob.inputs, [{ bone: 'skull', channel: 'rot', weight: 1 }, { param: 'x', weight: 1 }]);
  assert.deepEqual(d.physics.bob.outputs, [{ part: 'skull', scale: 1 }, { part: 'arm', scale: 1 }]);
  assert.equal(d.physics.still, before.physics.still);
  for (const re of [/1 child bone/, /2 parts/, /1 mask shape/, /1 keyform/, /2 keys in 1 animation/, /1 physics input/, /1 physics output/, /1 skinned mesh/, /part=head/]) assert.match(r.note, re);
});

test('renameBone: refusals, the name rule and a bone nothing names', () => {
  const d = doc();
  assert.match(renameBone(d, 'ghost', 'x', []).error, /no bone "ghost"/);
  assert.match(renameBone(d, 'head', 'head', []).error, /named "head" already/);
  assert.match(renameBone(d, 'head', ' head ', []).error, /already/, 'trimmed before the check');
  assert.match(renameBone(d, 'head', 'he ad', []).error, /letters, digits/);
  assert.match(renameBone(d, 'head', '', []).error, /letters, digits/);
  assert.match(renameBone(d, 'head', '2nd', []).error, /letters, digits/);
  assert.match(renameBone(d, 'head', 'arm', []).error, /bone named "arm" already/);
  assert.match(renameBone(d, 'head', 'face', ['face', 'coat']).error, /"face" is a part/);
  assert.match(renameBone(d, 'head', 'lids', []).error, /mask shape/);
  assert.ok(BONE_NAME.test('arm_l') && BONE_NAME.test('hair-2') && BONE_NAME.test('_x'));
  assert.ok(!BONE_NAME.test('2arm') && !BONE_NAME.test('a.b') && !BONE_NAME.test('a b'));
  const lone = renameBone({ bones: { a: {}, b: {} }, parts: {}, shapes: {}, keyforms: [], anims: {}, deformers: [], physics: {} }, 'a', 'c', []);
  assert.deepEqual(lone.doc.bones, { c: {}, b: {} });
  assert.equal(lone.note, 'Renamed a to c. Script lines that say part=a are not changed.');
});

test('removeBone: children, parts, shapes and weights go to the parent; keyforms, keys and physics that name it go with it', () => {
  const before = doc(), copy = structuredClone(before);
  const r = removeBone(before, 'head');
  assert.ok(!('error' in r), r.error);
  assert.deepEqual(before, copy, 'the input is left alone');
  const d = r.doc;
  assert.deepEqual(Object.keys(d.bones), ['root', 'hat', 'arm']);
  assert.equal(d.bones.hat.parent, 'root', 'the child bone goes to the parent');
  assert.deepEqual(d.parts.face, { bone: 'root' });
  assert.deepEqual(d.parts.hair, { bone: 'root', pivot: [3, 4] });
  assert.equal(d.shapes.lids.bone, 'root', 'a mask shape on it goes to the parent');
  assert.deepEqual(d.keyforms.map(k => k.target), ['face'], 'the keyform that targets it goes');
  assert.deepEqual(d.anims.nod.keys, [{ t: 1, part: 'arm' }], 'the keys that move it go');
  assert.equal(d.anims.wave, before.anims.wave, 'an animation that does not name it is the same object');
  assert.deepEqual(d.physics.bob.inputs, [{ param: 'x', weight: 1 }], 'the input that reads it goes');
  assert.deepEqual(d.physics.bob.outputs, [{ part: 'arm', scale: 1 }], 'the output that turns it goes (it was left dangling before)');
  assert.equal(d.physics.still, before.physics.still);
  assert.equal(d.deformers[0].mesh.defaultBone, 'root', 'the skinned mesh gives its weight to the parent');
  assert.deepEqual(d.deformers[0].mesh.weights, {}, 'all of the vertex is on the default bone now, which a mesh stores as no entry');
  assert.equal(d.deformers[1], before.deformers[1]);
  assert.equal(r.note, 'Removed head; 1 child bone, 2 parts, 1 mask shape, the weights of 1 skinned mesh went to root; 1 keyform, 2 keys in 1 animation, 1 physics input, 1 physics output that moved it went with it. Ctrl+Z brings it back.');
});

test('removeBone: a top bone hands its parts to the top, a bone nothing names says only that it went, an unknown one is refused', () => {
  const r = removeBone(doc(), 'root');
  assert.ok(!('error' in r));
  assert.equal(r.doc.bones.head.parent, undefined, 'a child of a top bone becomes a top bone');
  assert.equal(r.doc.parts.coat, undefined, 'a part on it sits on no bone: its entry, left empty, goes');
  assert.match(r.note, /^Removed root; 2 child bones, 1 part went to the top;/);
  assert.match(r.note, /its weights in 1 skinned mesh were dropped \(it had no parent to take them\)/);
  const lone = removeBone({ ...doc(), bones: { ...doc().bones, spare: {} } }, 'spare');
  assert.equal(lone.note, 'Removed spare. Ctrl+Z brings it back.');
  assert.deepEqual(removeBone(doc(), 'nope'), { error: 'There is no bone "nope".' });
});
