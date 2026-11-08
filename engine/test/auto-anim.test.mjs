import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  autoAnimations, startAuto, stepAuto, holds, reduceMotionSafe, reactionTarget, startReaction, stepReaction, checkRig, liveOverrides,
} from '../../dist/engine/src/index.js';

const blink = { dur: 0.1, keys: [], frames: [{ slot: 'eyes', keys: [{ t: 0, frame: 'closed' }] }], auto: { every: { min: 3, max: 6 } } };
const talk = { dur: 0.25, keys: [], frames: [{ slot: 'mouth', frames: ['open', 'neutral'], fps: 8, loop: true }], auto: { while: 'speaking' } };
const breathe = { dur: 3, keys: [{ t: 0, y: 0 }, { t: 0.5, y: 0.01 }, { t: 1, y: 0 }], auto: { while: 'always' } };
const ctx = (over = {}) => ({ speaking: false, behaviors: true, reduceMotion: false, vars: {}, params: {}, ...over });
const mid = () => 0.5; // waits of 4.5 s in a 3-6 range
const names = list => list.join(',');

test('autoAnimations lists the automatic animations in file order, with dur and reduce-motion safety', () => {
  const list = autoAnimations({ plain: { keys: [{ t: 0, x: 1 }] }, blink, talk, breathe });
  assert.deepEqual(list.map(e => e.name), ['blink', 'talk', 'breathe']);
  assert.deepEqual(list.map(e => e.safe), [true, true, false]);
  assert.equal(list[0].dur, 0.1);
  assert.deepEqual(autoAnimations(undefined), []);
});

test('every: one run per wait, the wait counted from the end of the run', () => {
  const entries = autoAnimations({ blink });
  let st = startAuto(entries, mid);
  assert.equal(st.slots[0].wait, 4.5);
  let r = stepAuto(st, entries, 4, ctx(), mid);
  assert.deepEqual(r.start, []);
  r = stepAuto(r.state, entries, 0.5, ctx(), mid);
  assert.deepEqual(r.start, ['blink']);
  r = stepAuto(r.state, entries, 0.05, ctx(), mid);
  assert.deepEqual([r.start, r.stop], [[], []]);
  r = stepAuto(r.state, entries, 0.06, ctx(), mid);
  assert.deepEqual(r.stop, ['blink']);
  assert.equal(r.state.slots[0].wait, 4.5);
  r = stepAuto(r.state, entries, 4.4, ctx(), mid);
  assert.deepEqual(r.start, []);
});

test('every: a plain number is a fixed wait; the first wait is random within the bounds', () => {
  const entries = autoAnimations({ b: { ...blink, auto: { every: 5 } } });
  assert.equal(startAuto(entries, () => 0).slots[0].wait, 5);
  assert.equal(startAuto(entries, () => 1).slots[0].wait, 5);
  const ranged = autoAnimations({ blink });
  assert.equal(startAuto(ranged, () => 0).slots[0].wait, 3);
  assert.equal(startAuto(ranged, () => 1).slots[0].wait, 6);
});

test('while: loops while the condition holds and stops with it; speaking follows the line', () => {
  const entries = autoAnimations({ talk });
  let r = stepAuto(startAuto(entries, mid), entries, 0.1, ctx(), mid);
  assert.deepEqual([r.start, r.stop], [[], []]);
  r = stepAuto(r.state, entries, 0.1, ctx({ speaking: true }), mid);
  assert.deepEqual(r.start, ['talk']);
  r = stepAuto(r.state, entries, 5, ctx({ speaking: true }), mid);
  assert.deepEqual([r.start, r.stop], [[], []]); // loops on, no restart
  r = stepAuto(r.state, entries, 0.1, ctx({ speaking: false }), mid);
  assert.deepEqual(r.stop, ['talk']);
});

test('while with every: the timer only runs while the condition holds', () => {
  const entries = autoAnimations({ fidget: { ...blink, auto: { every: 4, while: 'affection > 3' } } });
  let r = stepAuto(startAuto(entries, mid), entries, 10, ctx({ vars: { affection: 1 } }), mid);
  assert.deepEqual(r.start, []);
  assert.equal(r.state.slots[0].wait, 4); // held, not counted
  r = stepAuto(r.state, entries, 3, ctx({ vars: { affection: 5 } }), mid);
  assert.deepEqual(r.start, []);
  r = stepAuto(r.state, entries, 1, ctx({ vars: { affection: 5 } }), mid);
  assert.deepEqual(r.start, ['fidget']);
  r = stepAuto(r.state, entries, 0.01, ctx({ vars: { affection: 0 } }), mid);
  assert.deepEqual(r.stop, ['fidget']); // the condition left: the run stops
});

test('behaviors off stops what runs and holds timers; on again re-rolls the waits', () => {
  const entries = autoAnimations({ blink, breathe });
  let r = stepAuto(startAuto(entries, mid), entries, 0.1, ctx(), mid);
  assert.deepEqual(r.start, ['breathe']);
  r = stepAuto(r.state, entries, 2, ctx({ behaviors: false }), mid);
  assert.deepEqual(r.stop, ['breathe']);
  assert.equal(r.state.slots[0].wait, 4.4); // 4.5 - 0.1, held through the 2 s
  r = stepAuto(r.state, entries, 0, ctx({ behaviors: true }), () => 0);
  assert.equal(r.state.slots[0].wait, 3);
  assert.deepEqual(r.start, ['breathe']);
});

test('reduced motion keeps frame-only animations and drops the ones with keys or params', () => {
  const entries = autoAnimations({ blink, breathe });
  const r = stepAuto(startAuto(entries, mid), entries, 0.1, ctx({ reduceMotion: true }), mid);
  assert.deepEqual(r.start, []);
  const r2 = stepAuto(startAuto(entries, mid), entries, 5, ctx({ reduceMotion: true }), mid);
  assert.deepEqual(r2.start, ['blink']);
  assert.equal(reduceMotionSafe(blink), true);
  assert.equal(reduceMotionSafe(breathe), false);
  assert.equal(reduceMotionSafe({ keys: [], frames: [{ slot: 'a', keys: [] }], params: { p: [{ t: 0, v: 0 }] } }), false);
});

test('two automatic animations step in file order', () => {
  const entries = autoAnimations({ talk, breathe });
  const r = stepAuto(startAuto(entries, mid), entries, 0.1, ctx({ speaking: true }), mid);
  assert.deepEqual(r.start, ['talk', 'breathe']);
});

test('an animation that left the rig stops', () => {
  const entries = autoAnimations({ breathe });
  let r = stepAuto(startAuto(entries, mid), entries, 0.1, ctx(), mid);
  r = stepAuto(r.state, [], 0.1, ctx(), mid);
  assert.deepEqual(r.stop, ['breathe']);
});

test('conditions: script variables, speaking, always, param.<id>; errors and unknown names are false', () => {
  const c = { speaking: true, vars: { affection: 6, angry: false, name: 'Ann' }, params: { mouth: 0.8 } };
  assert.equal(holds('affection >= 5 and not angry', c), true);
  assert.equal(holds('speaking and always', c), true);
  assert.equal(holds('param.mouth > 0.5', c), true);
  assert.equal(holds('param.mouth > 0.9', c), false);
  assert.equal(holds('name == "Ann"', c), true);
  assert.equal(holds('affection >', c), false);
  assert.equal(holds('random()', c), false);
});

const poses = { happy: { smile: 1 }, sad: { smile: -1 } };
const defs = [{ id: 'smile', min: -1, max: 1, default: 0 }];
const reactions = [{ when: 'affection >= 5', pose: 'happy', over: 1 }, { when: 'affection < 0', pose: 'sad', over: 0.5 }];

test('reactionTarget: the first match wins, none gives null', () => {
  assert.equal(reactionTarget(reactions, ctx({ vars: { affection: 7 } })), 0);
  assert.equal(reactionTarget(reactions, ctx({ vars: { affection: -3 } })), 1);
  assert.equal(reactionTarget(reactions, ctx({ vars: { affection: 2 } })), null);
  assert.equal(reactionTarget(undefined, ctx()), null);
});

test('reaction stepper: moves into the pose over `over`, and back to nothing over the entry that stopped holding', () => {
  const pose = n => poses[n];
  let st = startReaction();
  st = stepReaction(st, reactions, 0, 0.5, pose, defs, { smile: 0 });
  assert.equal(st.now.smile, 0.5);
  st = stepReaction(st, reactions, 0, 0.5, pose, defs, { smile: 0 });
  assert.equal(st.now.smile, 1);
  st = stepReaction(st, reactions, null, 0.5, pose, defs, { smile: 0 }); // back to 0 over entry 0's 1 s
  assert.equal(st.now.smile, 0.5);
  st = stepReaction(st, reactions, null, 0.5, pose, defs, { smile: 0 });
  assert.deepEqual(st.now, {});
  assert.equal(st.entry, null);
});

test('reaction stepper: a new entry starts from where the last one is', () => {
  const pose = n => poses[n];
  let st = stepReaction(startReaction(), reactions, 0, 1, pose, defs, { smile: 0 });
  assert.equal(st.now.smile, 1);
  st = stepReaction(st, reactions, 1, 0.25, pose, defs, { smile: 0 }); // 1 -> -1 over 0.5 s
  assert.equal(st.now.smile, 0);
});

const manifest = rig => ({
  width: 100, height: 100,
  parts: [{ file: 'body.png' }, { slot: 'eyes', default: 'open', variants: { open: { file: 'o.png' }, closed: { file: 'c.png' } } }],
  rig,
});
const msgs = (rig, vars) => checkRig(manifest(rig), vars).map(p => p.message);

test('checkRig: auto', () => {
  const ok = { animations: { blink } };
  assert.deepEqual(msgs(ok), []);
  assert.match(msgs({ animations: { b: { ...blink, auto: {} } } }).join('|'), /every.*and\/or.*while/);
  assert.match(msgs({ animations: { b: { ...blink, auto: { every: { min: 5, max: 2 } } } } }).join('|'), /auto\.every/);
  assert.match(msgs({ animations: { b: { ...blink, auto: { every: 0 } } } }).join('|'), /auto\.every/);
  assert.match(msgs({ animations: { b: { ...blink, auto: { while: 'a >' } } } }).join('|'), /not a valid expression/);
  assert.match(msgs({ animations: { b: { ...blink, auto: { while: 'x', loud: 1 } } } }).join('|'), /auto\.loud: unknown/);
  assert.deepEqual(msgs({ animations: { b: { ...blink, auto: { while: 'affection > 2' } } } }), []); // names are not checked without the project's variables
  assert.match(msgs({ animations: { b: { ...blink, auto: { while: 'affection > 2' } } } }, ['mood']).join('|'), /"affection" is no script variable/);
  assert.deepEqual(msgs({ animations: { b: { ...blink, auto: { while: 'mood > 2 and speaking' } } } }, ['mood']), []);
  assert.match(msgs({ animations: { b: { ...blink, auto: { while: 'param.nope > 0' } } } }).join('|'), /no parameter "nope"/);
  assert.match(msgs({ animations: { a: blink, b: { ...blink, auto: { every: 4 } } } }).join('|'), /both have a frame track on slot "eyes"/);
});

test('checkRig: the old autonomous section is reported', () => {
  assert.match(msgs({ autonomous: { blink: { slot: 'eyes', variant: 'closed' } } }).join('|'), /autonomous was replaced by "auto"/);
});

test('checkRig: reactions', () => {
  const rig = { parameters: defs, poses, reactions };
  assert.deepEqual(msgs(rig, ['affection']), []);
  assert.match(msgs({ ...rig, reactions: [{ when: 'x', pose: 'nope' }] }).join('|'), /no pose "nope"/);
  assert.match(msgs({ ...rig, reactions: [{ when: '', pose: 'happy' }] }).join('|'), /needs a condition/);
  assert.match(msgs({ ...rig, reactions: [{ when: 'x', pose: 'happy', over: -1 }] }).join('|'), /over/);
  assert.match(msgs({ ...rig, reactions: [{ when: 'x', pose: 'happy', ease: 'wobble' }] }).join('|'), /unknown ease/);
  assert.match(msgs({ ...rig, reactions: 'x' }).join('|'), /needs a list/);
});

test('the frame tracks of automatic animations are preloaded through liveOverrides', () => {
  const o = liveOverrides({ animations: { blink, talk } });
  assert.ok(o.some(x => x.eyes === 'closed') && o.some(x => x.mouth === 'open'));
});
