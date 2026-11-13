import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  frameOf, framesAt, expandFrames, framesNeeded, framesFromSlot, slotShare, frameBlocks, retimeFrame, duplicateFrame, reorderFrame, setFrame, deleteFrame, addFrameKey, asKeys,
  resolveAnim, checkRig, liveOverrides, withFrameTrack, trackOfSlot,
} from '../../dist/engine/src/index.js';

const v = file => ({ file });
const manifest = rig => ({
  width: 100, height: 100,
  parts: [
    { file: 'body.png' },
    { slot: 'walk', default: '01', variants: { '01': v('w1.png'), '02': v('w2.png'), '03': v('w3.png') } },
    { slot: 'eyes', default: 'open', variants: { open: v('o.png'), closed: v('c.png') } },
  ],
  rig,
});
const clip = { slot: 'walk', frames: ['01', '02', '03'], fps: 10, loop: true };

test('a clip is a function of the time: frames step at fps and loop', () => {
  assert.equal(frameOf(clip, 0, 0), '01');
  assert.equal(frameOf(clip, 0, 0.099), '01');
  assert.equal(frameOf(clip, 0, 0.1), '02');
  assert.equal(frameOf(clip, 0, 0.35), '01'); // wrapped
  assert.equal(frameOf({ ...clip, loop: false }, 0, 5), '03'); // holds the last frame
  assert.equal(frameOf({ slot: 'walk', frames: ['01', 'none'] }, 0, 2), 'none');
});

test('keys hold until the next; before the first key the slot is left alone', () => {
  const tr = { slot: 'walk', keys: [{ t: 0.5, frame: '02' }, { t: 0.2, frame: '01' }, { t: 0.8, frame: 'none' }] };
  assert.equal(frameOf(tr, 0.1, 0), undefined);
  assert.equal(frameOf(tr, 0.2, 0), '01');
  assert.equal(frameOf(tr, 0.79, 0), '02');
  assert.equal(frameOf(tr, 1, 0), 'none');
  assert.deepEqual(framesAt([tr, clip.slot === 'x' ? clip : { slot: 'eyes', keys: [{ t: 0, frame: 'closed' }] }], 0.3, 0), { walk: '01', eyes: 'closed' });
});

test('resolveAnim carries frames, and an animation with only frames resolves', () => {
  const r = resolveAnim('step', { step: { dur: 1, keys: [], frames: [clip] } });
  assert.deepEqual(r.frames(0, 0.25), { walk: '03' });
  assert.equal(resolveAnim('step', { step: { dur: 1, keys: [{ t: 0.5, rot: 1 }] } }).frames, undefined);
});

test('a clip expands to keys for the animation length', () => {
  assert.deepEqual(expandFrames({ ...clip, loop: false }, 1).map(k => [k.t, k.frame]), [[0, '01'], [0.1, '02'], [0.2, '03']]);
  assert.equal(expandFrames(clip, 0.5).length, 5); // loops to fill
  assert.deepEqual(expandFrames(clip, 0.5).map(k => k.frame), ['01', '02', '03', '01', '02']);
  assert.deepEqual(asKeys(clip, 0.3).keys.map(k => k.frame), ['01', '02', '03']);
});

test('studio edits: from slot, retime, duplicate, reorder, set, delete', () => {
  const t = framesFromSlot('walk', ['01', '02', '03'], 4, 1);
  assert.deepEqual(t.keys, [{ t: 0, frame: '01' }, { t: 0.25, frame: '02' }, { t: 0.5, frame: '03' }]);
  assert.equal(framesFromSlot('walk', ['a', 'b', 'c'], 1, 2).keys.length, 2); // past the end dropped
  assert.deepEqual(retimeFrame(t, 1, 0.6).keys.map(k => k.frame), ['01', '03', '02']);
  assert.equal(retimeFrame(t, 1, 0.5), t, 'not onto another block\'s time, where that block would last no time (UX round 3 AN-15)');
  const d = duplicateFrame(t, 0);
  assert.deepEqual(d.keys.map(k => [k.t, k.frame]), [[0, '01'], [0.125, '01'], [0.25, '02'], [0.5, '03']]);
  assert.equal(duplicateFrame(t, 0, 0.25), t);
  const r = reorderFrame(t, 0, 2);
  assert.deepEqual(r.keys.map(k => [k.t, k.frame]), [[0, '02'], [0.25, '03'], [0.5, '01']]);
  assert.equal(setFrame(t, 1, 'none').keys[1].frame, 'none');
  assert.equal(deleteFrame(t, 1).keys.length, 2);
  assert.deepEqual(addFrameKey(t, 0.25004, 'none').keys[1], { t: 0.25, frame: 'none' });
  assert.deepEqual(frameBlocks(t).map(b => [b.from, b.to]), [[0, 0.25], [0.25, 0.5], [0.5, 1]]);
  assert.equal(t.keys.length, 3); // input untouched
});

test('checkRig: unknown slot or variant, two tracks on one slot, bad fields', () => {
  const msgs = frames => checkRig(manifest({ animations: { a: { dur: 1, keys: [{ t: 0.5, rot: 1 }], frames } } })).map(p => p.message);
  assert.deepEqual(msgs([clip, { slot: 'eyes', keys: [{ t: 0, frame: 'none' }] }]), []);
  assert.ok(msgs([clip, { slot: 'walk', keys: [{ t: 0, frame: '01' }] }]).some(m => m.includes('second frame track on slot "walk"')));
  assert.ok(msgs([{ slot: 'nope', frames: ['a'] }]).some(m => m.includes('no slot "nope"')));
  assert.ok(msgs([{ slot: 'body', frames: ['a'] }]).some(m => m.includes('no slot "body"')));
  assert.ok(msgs([{ slot: 'walk', frames: ['01', '09'] }]).some(m => m.includes('no variant "09"')));
  assert.ok(msgs([{ slot: 'walk', keys: [{ t: 2, frame: '01' }] }]).some(m => m.includes('t must be')));
  assert.ok(msgs([{ slot: 'walk', frames: ['01'], fps: 0 }]).some(m => m.includes('fps')));
  assert.ok(msgs([{ slot: 'walk', frames: ['01'], keys: [] }]).some(m => m.includes('either')));
  assert.ok(msgs('x').some(m => m.includes('list of tracks')));
});

test('frames are preloaded like blink variants', () => {
  assert.deepEqual(framesNeeded([clip, { slot: 'eyes', keys: [{ t: 0, frame: 'none' }, { t: 0.5, frame: 'closed' }] }]), { walk: ['01', '02', '03'], eyes: ['closed'] });
  const lo = liveOverrides({ animations: { a: { keys: [], frames: [clip] } } });
  assert.deepEqual(lo, [{ walk: '01' }, { walk: '02' }, { walk: '03' }]);
});

test('withFrameTrack replaces in place, adds, and drops an emptied list', () => {
  const def = { dur: 1, keys: [], frames: [{ slot: 'a', keys: [] }, { slot: 'b', keys: [] }] };
  const r = withFrameTrack(def, 'a', { slot: 'a', keys: [{ t: 0, frame: 'x' }] });
  assert.deepEqual(r.frames.map(t => t.slot), ['a', 'b']);
  assert.equal(r.frames[0].keys.length, 1);
  assert.deepEqual(withFrameTrack(def, 'c', { slot: 'c', keys: [] }).frames.map(t => t.slot), ['a', 'b', 'c']);
  assert.equal('frames' in withFrameTrack({ keys: [], frames: [{ slot: 'a' }] }, 'a', null), false);
  assert.equal(trackOfSlot(def, 'b').slot, 'b');
  assert.equal(def.frames.length, 2);
});

test('frames from a slot that end before the animation: loop them, spread them, or play once (SA-18)', () => {
  const v = ['open', 'smile', 'neutral'];
  assert.equal(slotShare(3, 12, 1), 0.25, 'three frames at 12 fps take a quarter of a 1 s animation');
  assert.deepEqual(framesFromSlot('mouth', v, 12, 1).keys.map(k => k.frame), v, 'once: each one time, the last holds');
  const loop = framesFromSlot('mouth', v, 12, 1, 'loop').keys;
  assert.equal(loop.length, 12, 'loop: 12 blocks fill the second');
  assert.deepEqual(loop.slice(0, 4).map(k => k.frame), ['open', 'smile', 'neutral', 'open']);
  assert.ok(loop.every(k => k.t < 1));
  assert.deepEqual(framesFromSlot('mouth', v, 12, 1, 'spread').keys, [{ t: 0, frame: 'open' }, { t: 0.3333, frame: 'smile' }, { t: 0.6667, frame: 'neutral' }], 'spread: a third each');
});
