import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeChange, studioDocOf } from '../../dist/engine/src/index.js';

const doc = () => studioDocOf({
  parameters: [{ id: 'lean', min: -1, max: 1, default: 0 }],
  bones: { root: { pivot: [0, 0] }, arm: { parent: 'root', pivot: [1, 1] } },
  parts: { hand: { bone: 'arm' } },
  pivots: { face: [5, 5] },
  keyforms: [{ target: 'head', param: 'lean', keys: [{ at: 0 }, { at: 1, rot: 4 }] }],
  deformers: [{ id: 'hand_mesh', part: 'hand', mesh: { verts: [0, 0, 1, 0, 0, 1], tris: [0, 1, 2] } }],
  physics: { hair: { inputs: [{ param: 'lean', weight: 1 }], segments: [{ length: 1, mass: 1, damping: 3, stiffness: 90, limit: 25 }], outputs: [{ param: 'lean', scale: 1 }] } },
  animations: { wave: { dur: 1.1, keys: [{ t: 0.5, part: 'arm', rot: 20 }] }, nod: { keys: [] } },
});
const change = edit => { const a = doc(), b = structuredClone(a); edit(b); return describeChange(a, b); };

test('an animation edit names the animation, what changed in it, and Animate', () => {
  assert.deepEqual(change(d => { d.anims.wave.dur = 3; }), { label: 'wave: Length 1.1 s → 3 s', mode: 'animate', anim: 'wave' });
  assert.deepEqual(change(d => { d.anims.wave.keys.push({ t: 0.9, part: 'arm', rot: 0 }); }), { label: 'wave: key added on arm', mode: 'animate', anim: 'wave', part: 'arm' });
  assert.deepEqual(change(d => { d.anims.wave.keys = []; }), { label: 'wave: key removed on arm', mode: 'animate', anim: 'wave', part: 'arm' });
  assert.equal(change(d => { d.anims.wave.keys[0].rot = 30; }).label, 'wave: key on arm changed');
  assert.equal(change(d => { d.anims.nod.keys.push({ t: 0, rot: 1 }); }).label, 'nod: key added on the whole character');
  assert.equal(change(d => { d.anims.wave.params = { lean: [{ t: 0, v: 1 }] }; }).label, 'wave: lean track');
  assert.equal(change(d => { d.anims.wave.frames = [{ slot: 'eyes', keys: [{ t: 0, frame: 'shut' }] }]; }).label, 'wave: frames of eyes');
  assert.equal(change(d => { d.anims.wave.auto = { every: 3 }; }).label, 'wave: Automatic');
});

test('animations added, deleted and renamed', () => {
  assert.deepEqual(change(d => { d.anims.hop = { keys: [] }; }), { label: 'new animation hop', mode: 'animate', anim: 'hop' });
  assert.deepEqual(change(d => { delete d.anims.nod; }), { label: 'deleted animation nod', mode: 'animate', anim: 'nod' });
  assert.deepEqual(change(d => { d.anims.bow = d.anims.nod; delete d.anims.nod; }), { label: 'animation nod renamed bow', mode: 'animate', anim: 'bow' });
});

test('Model edits name their area and part, and Model', () => {
  assert.deepEqual(change(d => { d.pivots.face = [6, 6]; }), { label: 'pivot of face', mode: 'model', part: 'face' });
  assert.deepEqual(change(d => { d.keyforms[0].keys[1].rot = 8; }), { label: 'keyform of head on lean', mode: 'model', part: 'head' });
  assert.deepEqual(change(d => { d.keyforms = []; }), { label: 'keyform of head on lean removed', mode: 'model', part: 'head' });
  assert.deepEqual(change(d => { d.deformers[0].mesh.verts[0] = 1; }), { label: 'deformer hand_mesh', mode: 'model', part: 'hand' });
  assert.deepEqual(change(d => { d.physics.hair.segments[0].mass = 2; }), { label: 'physics chain hair', mode: 'model' });
  assert.deepEqual(change(d => { d.parts.hand = { bone: 'root' }; }), { label: 'bone of hand', mode: 'model', part: 'hand' });
});

test('a change spanning areas is named by its cause; parameters and poses show in both modes', () => {
  // removing a bone also moves its part and its weights: the bone is what was done
  assert.deepEqual(change(d => { delete d.bones.arm; d.parts.hand = { bone: 'root' }; d.deformers[0].part = 'hand'; }), { label: 'bone arm removed', mode: 'model', part: 'arm' });
  assert.deepEqual(change(d => { d.parameters.push({ id: 'tilt', min: 0, max: 1, default: 0 }); }), { label: 'parameter tilt added', mode: null });
  assert.deepEqual(change(d => { d.poses.happy = { lean: 1 }; }), { label: 'pose happy added', mode: null });
  assert.deepEqual(change(() => {}), { label: 'an edit', mode: null }, 'no difference');
});
