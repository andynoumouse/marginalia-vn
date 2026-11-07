import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyToState, compile, emptyState, blinkOf, speakOf, liveOverrides, checkRig, spriteKeys, assetContext, startBlink, stepBlink, blinkWait, mouthFrame } from '../../dist/engine/src/index.js';

const v = file => ({ file });
const manifest = rig => ({
  width: 100, height: 100,
  parts: [
    { file: 'body.png' },
    { slot: 'eyes', default: 'open', variants: { open: v('e_open.png'), closed: v('e_closed.png') } },
    { slot: 'mouth', default: 'neutral', variants: { neutral: v('m_neutral.png'), open: v('m_open.png'), wide: v('m_wide.png') } },
  ],
  rig,
});
const msgs = rig => checkRig(manifest(rig)).map(p => p.message);

test('blink: eyes close when the wait runs out, stay shut for dur, then wait again', () => {
  const def = { every: [3, 6], dur: 0.1 };
  const rand = () => 0.5; // waits of 4.5 s
  assert.equal(blinkWait([3, 6], () => 0), 3);
  assert.equal(blinkWait([3, 6], () => 1), 6);
  let st = startBlink(def.every, rand);
  assert.deepEqual(st, { closed: false, wait: 4.5 });
  st = stepBlink(st, 4, def, rand);
  assert.deepEqual(st, { closed: false, wait: 0.5 });
  st = stepBlink(st, 0.5, def, rand);
  assert.deepEqual(st, { closed: true, wait: 0.1 });
  st = stepBlink(st, 0.05, def, rand);
  assert.equal(st.closed, true);
  st = stepBlink(st, 0.06, def, rand);
  assert.deepEqual(st, { closed: false, wait: 4.5 });
});

test('mouthFrame cycles through the variants at the given rate', () => {
  assert.equal(mouthFrame([], 1, 8), null);
  assert.deepEqual([0, 0.1, 0.13, 0.26, 0.4].map(t => mouthFrame(['open', 'neutral'], t, 8)), ['open', 'open', 'neutral', 'open', 'neutral']);
  assert.equal(mouthFrame(['open', 'neutral'], -3, 8), 'open');
});

const au = autonomous => ({ autonomous });
const BLINK = { slot: 'eyes', variant: 'closed' };

test('blinkOf and speakOf fill in defaults and ignore what is off', () => {
  assert.equal(blinkOf(undefined), null);
  assert.equal(blinkOf({}), null);
  assert.equal(blinkOf(au({ blink: { slot: 'eyes' } })), null); // no variant written out: nothing to swap
  assert.deepEqual(blinkOf(au({ blink: BLINK })), { slot: 'eyes', variant: 'closed', every: [3, 6], dur: 0.12 });
  assert.deepEqual(blinkOf(au({ blink: { slot: 'lids', variant: 'shut', every: [1, 2], dur: 0.2 } })), { slot: 'lids', variant: 'shut', every: [1, 2], dur: 0.2 });
  assert.deepEqual(blinkOf(au({ blink: { ...BLINK, every: [5, 1] } })).every, [3, 6]); // a bad range falls back
  assert.equal(blinkOf({ blink: BLINK }), null); // the old top-level key is no longer read
  assert.equal(speakOf({}), null);
  assert.equal(speakOf(au({ speak: {} })), null);
  assert.equal(speakOf(au({ speak: { variants: ['open'] } })), null); // variants without their slot
  assert.deepEqual(speakOf(au({ speak: { slot: 'mouth', variants: ['open', 'neutral'] } })), { anim: null, slot: 'mouth', variants: ['open', 'neutral'], rate: 8 });
  assert.deepEqual(speakOf(au({ speak: { anim: 'bob', rate: 12 } })), { anim: 'bob', slot: '', variants: [], rate: 12 });
  assert.deepEqual(liveOverrides(au({ blink: BLINK, speak: { slot: 'mouth', variants: ['open', 'wide'] } })), [{ eyes: 'closed' }, { mouth: 'open' }, { mouth: 'wide' }]);
});

test('checkRig: autonomous idle, speak and blink are checked against the animations and slots', () => {
  assert.deepEqual(msgs(au({ idle: 'breathe', blink: BLINK, speak: { anim: 'bob', slot: 'mouth', variants: ['open', 'wide'] } })), []);
  assert.deepEqual(msgs({ ...au({ idle: 'mine' }), animations: { mine: { keys: [{ t: 0.5, rot: 1 }] } } }), []);
  assert.match(msgs(au({ idle: 'wobble' }))[0], /autonomous.idle: no animation "wobble"/);
  assert.match(msgs(au({ speak: {} }))[0], /autonomous.speak: needs an "anim" or/);
  assert.match(msgs(au({ speak: { slot: 'mouth', variants: ['open', 'huge'] } }))[0], /no variant "huge"/);
  assert.match(msgs(au({ speak: { slot: 'jaw', variants: ['open'] } }))[0], /no slot "jaw"/);
  assert.match(msgs(au({ speak: { variants: ['open'] } }))[0], /needs the "slot"/);
  assert.match(msgs(au({ speak: { anim: 'nope' } }))[0], /speak.anim: no animation "nope"/);
  assert.match(msgs(au({ speak: { anim: 'bob', rate: 0 } }))[0], /rate/);
  assert.match(msgs(au({ blink: { slot: 'eyes', variant: 'shut' } }))[0], /no variant "shut"/);
  assert.match(msgs(au({ blink: { slot: 'lids', variant: 'closed' } }))[0], /no slot "lids"/);
  assert.match(msgs(au({ blink: { slot: 'eyes' } }))[0], /needs a "slot" and the closed-eyes "variant"/);
  assert.match(msgs(au({ blink: { ...BLINK, every: [6, 3] } }))[0], /blink.every/);
  assert.match(msgs(au({ blink: { ...BLINK, dur: -1 } }))[0], /blink.dur/);
  assert.equal(checkRig(manifest(au({}))).length, 0);
});

test('checkRig: typos, unknown keys, the true shorthand are errors', () => {
  assert.match(msgs(au({ blnik: BLINK }))[0], /autonomous.blnik: unknown/);
  assert.match(msgs(au({ speak: { slot: 'mouth', variants: ['open'], speed: 3 } }))[0], /speak.speed: unknown/);
  assert.match(msgs(au({ blink: { ...BLINK, evry: [1, 2] } }))[0], /blink.evry: unknown/);
  assert.match(msgs(au({ blink: true }))[0], /autonomous.blink: needs an object/);
  assert.match(msgs({ autonomous: 'yes' })[0], /autonomous: needs an object/);
});

test('spriteKeys also asks for the variants a character blinks and talks with', () => {
  const keyList = ['char/a/body', 'char/a/e_open', 'char/a/e_closed', 'char/a/m_neutral', 'char/a/m_open', 'char/a/m_wide'], files = keyList.map(k => k + '.png');
  const sprite = { char: 'a', pose: null, overrides: {} };
  const keys = rig => spriteKeys(sprite, assetContext({ files, rigs: { a: manifest(rig) } }));
  assert.deepEqual(keys(undefined).sort(), ['char/a/body', 'char/a/e_open', 'char/a/m_neutral']);
  assert.deepEqual(keys(au({ blink: BLINK, speak: { slot: 'mouth', variants: ['open', 'wide'] } })).sort(), keyList.sort());
});

test('behaviors on/off parse to a visual op and are kept in the display state across scenes', () => {
  const p = compile([{ file: 't.vn', text: 'label start:\n  behaviors off\n  scene park\n  behaviors on nowait\n' }]);
  assert.deepEqual(p.diagnostics, []);
  const ops = p.ops.filter(o => o.op === 'behaviors');
  assert.deepEqual(ops.map(({ op, on, nowait }) => ({ op, on, nowait })), [{ op: 'behaviors', on: false, nowait: undefined }, { op: 'behaviors', on: true, nowait: true }]);
  const s = emptyState();
  applyToState(s, ops[0]);
  assert.equal(s.behaviors, false);
  applyToState(s, p.ops.find(o => o.op === 'scene'));
  assert.equal(s.behaviors, false);
  applyToState(s, ops[1]);
  assert.equal('behaviors' in s, false);
  const bad = text => compile([{ file: 't.vn', text }]).diagnostics[0].message;
  assert.match(bad('label start:\n  behaviors maybe\n'), /Use: behaviors on {2}\| {2}behaviors off/);
  assert.match(bad('label start:\n  behaviors\n'), /Use: behaviors on/);
});
