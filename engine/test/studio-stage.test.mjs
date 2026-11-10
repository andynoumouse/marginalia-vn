import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  stageMode, isDeformMode, chooseOnStage, keepsSubject, escapeAction,
  DEFAULT_BRUSH, effectiveBrush, brushCursor, isPaintBrush, weightsHint, meshPartOnBone,
  EMPTY_WEIGHTS_SESSION, weightsSession, patchWeightsSession,
} from '../../dist/engine/src/index.js';

const press = (over = {}) => ({ mode: 'transform', hit: 'arm_l', boneOf: 'upper_l', alt: false, ctrl: false, model: true, ...over });

test('the stage mode is named by the tool; Move, Rotate and Scale share one', () => {
  for (const t of ['move', 'rotate', 'scale']) assert.equal(stageMode(t), 'transform');
  for (const t of ['pivot', 'warp', 'weights', 'mask']) assert.equal(stageMode(t), t);
  assert.deepEqual(['transform', 'pivot', 'warp', 'weights', 'mask'].filter(isDeformMode), ['warp', 'weights', 'mask']);
});

test('a click on art chooses the part in every mode, both studio modes; Alt-click chooses the bone it sits on', () => {
  for (const mode of ['transform', 'pivot', 'warp', 'weights', 'mask']) {
    assert.deepEqual(chooseOnStage(press({ mode })), { kind: 'choose', name: 'arm_l' }, mode);
    assert.deepEqual(chooseOnStage(press({ mode, alt: true })), { kind: 'choose', name: 'upper_l' }, `${mode}, Alt`);
  }
  assert.deepEqual(chooseOnStage(press({ model: false })), { kind: 'choose', name: 'arm_l' }, 'Animate: the part, not the bone');
  assert.deepEqual(chooseOnStage(press({ model: false, alt: true })), { kind: 'choose', name: 'upper_l' });
  assert.deepEqual(chooseOnStage(press({ alt: true, boneOf: null })), { kind: 'choose', name: 'arm_l' }, 'a part on no bone: Alt changes nothing');
  assert.deepEqual(chooseOnStage(press({ hit: 'upper_l', boneOf: null })), { kind: 'choose', name: 'upper_l' }, "a bone's pivot dot chooses the bone");
});

test('Ctrl in Model mode adds the part to the chosen ones; with Alt it adds the bone; Animate has no extras', () => {
  assert.deepEqual(chooseOnStage(press({ ctrl: true })), { kind: 'toggle', name: 'arm_l' });
  assert.deepEqual(chooseOnStage(press({ ctrl: true, alt: true })), { kind: 'choose', name: 'upper_l' }, 'Alt wins: the bone is chosen, not toggled');
  assert.deepEqual(chooseOnStage(press({ ctrl: true, model: false })), { kind: 'choose', name: 'arm_l' });
});

test('a press on nothing clears the row with the transform, Pivot and Mask tools and leaves it alone with Warp and Weights', () => {
  for (const mode of ['transform', 'pivot', 'mask']) assert.deepEqual(chooseOnStage(press({ mode, hit: null, boneOf: null })), { kind: 'choose', name: null }, mode);
  for (const mode of ['warp', 'weights']) {
    assert.deepEqual(chooseOnStage(press({ mode, hit: null, boneOf: null })), { kind: 'none' }, mode);
    assert.deepEqual(chooseOnStage(press({ mode, hit: null, boneOf: null, ctrl: true, alt: true })), { kind: 'none' }, `${mode} with modifiers`);
  }
});

test('with Warp or Weights a click on the chosen part itself is work on it, not a choice; other parts and other modes choose', () => {
  assert.equal(keepsSubject('weights', ['arm_l', 'torso'], 'arm_l'), true);
  assert.equal(keepsSubject('warp', ['torso', 'arm_l'], 'arm_l'), true, 'even behind another part');
  assert.equal(keepsSubject('weights', ['torso'], 'arm_l'), false);
  assert.equal(keepsSubject('weights', ['arm_l'], null), false);
  assert.equal(keepsSubject('transform', ['arm_l'], 'arm_l'), false, 'the transform tools cycle through the parts as ever');
  assert.equal(keepsSubject('mask', ['arm_l'], 'arm_l'), false);
});

test('Esc clears a selection, leaves a deform tool that has none, and does nothing elsewhere', () => {
  assert.equal(escapeAction('weights', 3), 'clear');
  assert.equal(escapeAction('weights', 0), 'leave');
  assert.equal(escapeAction('warp', 1), 'clear');
  assert.equal(escapeAction('warp', 0), 'leave');
  assert.equal(escapeAction('mask', 0), 'none', 'the Mask tool is left by its button or key');
  assert.equal(escapeAction('transform', 0), 'none');
});

test('the brush starts on Add, reads only until a bone is bound, and has a cursor per mode', () => {
  assert.equal(DEFAULT_BRUSH, 'add');
  assert.equal(effectiveBrush('add', 0), 'pick', 'no bone bound: a press reads a vertex out');
  assert.equal(effectiveBrush('select', 0), 'pick');
  assert.equal(effectiveBrush('add', 2), 'add');
  assert.equal(effectiveBrush('pick', 2), 'pick');
  assert.equal(brushCursor('pick'), 'crosshair');
  assert.equal(brushCursor('select'), 'cell');
  for (const b of ['add', 'subtract', 'replace', 'smooth']) { assert.equal(brushCursor(b), 'none', b); assert.equal(isPaintBrush(b), true); }
  assert.equal(isPaintBrush('pick'), false);
  assert.equal(isPaintBrush('select'), false);
});

test('the status line with the Weights tool says what a press does and its keys, always the way back to Move; the mode is the bar\'s', () => {
  const add = weightsHint('add', 'forearm_l', true, 'Esc close');
  assert.match(add, /^Drag over the mesh to add forearm_l's weight/);
  assert.match(add, /\[ \] radius, Shift strength/);
  assert.match(add, /B or Esc \(nothing selected\) back to Move/);
  assert.match(add, /Esc close$/);
  assert.match(weightsHint('smooth', null, true, 'Ctrl+S save'), /^Drag over the mesh to blur the weights.*Ctrl\+S save$/);
  assert.match(weightsHint('pick', 'arm_l', true, ''), /^Click a vertex to read its weights.*Alt-click a part for its bone/);
  assert.match(weightsHint('select', null, true, ''), /^Drag a rectangle.*Esc clears/);
  assert.match(weightsHint('add', null, false, ''), /^Click a part with a mesh on the stage/, 'no mesh: how to get one');
});

test('B with a bone chosen picks the first part on it that has a mesh', () => {
  const boneOf = p => ({ arm_l: 'upper_l', hand_l: 'upper_l', torso: 'spine' })[p];
  const hasMesh = p => p === 'hand_l' || p === 'torso';
  assert.equal(meshPartOnBone('upper_l', ['arm_l', 'hand_l', 'torso'], boneOf, hasMesh), 'hand_l', 'arm_l has no mesh: the hand is first');
  assert.equal(meshPartOnBone('spine', ['arm_l', 'hand_l', 'torso'], boneOf, hasMesh), 'torso');
  assert.equal(meshPartOnBone('head', ['arm_l', 'hand_l', 'torso'], boneOf, hasMesh), null);
  assert.equal(meshPartOnBone('upper_l', ['arm_l'], boneOf, hasMesh), null, 'a part without a mesh is no pick');
});

test('the Weights panel keeps its state per mesh: a change of row and a return find it as it was', () => {
  let s = {};
  assert.deepEqual(weightsSession(s, 'arm_mesh'), EMPTY_WEIGHTS_SESSION, 'a mesh not seen yet starts empty');
  s = patchWeightsSession(s, 'arm_mesh', { extra: ['arm_l', 'forearm_l'], active: 'forearm_l' });
  s = patchWeightsSession(s, 'arm_mesh', { selected: [3, 4], picked: 13 });
  s = patchWeightsSession(s, 'hair_mesh', { active: 'strand_1' });
  assert.deepEqual(weightsSession(s, 'arm_mesh'), { extra: ['arm_l', 'forearm_l'], active: 'forearm_l', picked: 13, selected: [3, 4] });
  assert.deepEqual(weightsSession(s, 'hair_mesh'), { extra: [], active: 'strand_1', picked: null, selected: [] }, 'another mesh has its own');
  assert.equal(patchWeightsSession(s, 'arm_mesh', { active: 'forearm_l', selected: [3, 4] }), s, 'a patch that changes nothing returns the same map');
  assert.notEqual(patchWeightsSession(s, 'arm_mesh', { active: 'arm_l' }), s);
  assert.deepEqual(weightsSession(s, 'arm_mesh').extra, ['arm_l', 'forearm_l'], 'the map is not changed in place');
});
