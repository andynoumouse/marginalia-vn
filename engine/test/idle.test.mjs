import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blinkOf, speakOf, liveOverrides, checkRig, spriteKeys, assetContext, startBlink, stepBlink, blinkWait, mouthFrame } from '../../dist/engine/src/index.js';

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

test('blinkOf and speakOf fill in defaults and ignore what is off', () => {
  assert.equal(blinkOf(undefined), null);
  assert.equal(blinkOf({ blink: false }), null);
  assert.deepEqual(blinkOf({ blink: true }), { slot: 'eyes', variant: 'closed', every: [3, 6], dur: 0.12 });
  assert.deepEqual(blinkOf({ blink: { slot: 'lids', every: [1, 2], dur: 0.2 } }), { slot: 'lids', variant: 'closed', every: [1, 2], dur: 0.2 });
  assert.deepEqual(blinkOf({ blink: { every: [5, 1] } }).every, [3, 6]); // a bad range falls back
  assert.equal(speakOf({}), null);
  assert.equal(speakOf({ speak: {} }), null);
  assert.deepEqual(speakOf({ speak: { variants: ['open', 'neutral'] } }), { anim: null, slot: 'mouth', variants: ['open', 'neutral'], rate: 8 });
  assert.deepEqual(speakOf({ speak: { anim: 'bob', rate: 12 } }), { anim: 'bob', slot: 'mouth', variants: [], rate: 12 });
  assert.deepEqual(liveOverrides({ blink: true, speak: { variants: ['open', 'wide'] } }), [{ eyes: 'closed' }, { mouth: 'open' }, { mouth: 'wide' }]);
});

test('checkRig: idle, speak and blink are checked against the animations and slots', () => {
  assert.deepEqual(msgs({ idle: 'breathe', blink: true, speak: { anim: 'bob', variants: ['open', 'wide'] } }), []);
  assert.deepEqual(msgs({ idle: 'mine', animations: { mine: { keys: [{ t: 0.5, rot: 1 }] } } }), []);
  assert.match(msgs({ idle: 'wobble' })[0], /idle: no animation "wobble"/);
  assert.match(msgs({ speak: {} })[0], /speak: needs an "anim" or/);
  assert.match(msgs({ speak: { variants: ['open', 'huge'] } })[0], /no variant "huge"/);
  assert.match(msgs({ speak: { slot: 'jaw', variants: ['open'] } })[0], /no slot "jaw"/);
  assert.match(msgs({ speak: { anim: 'nope' } })[0], /speak.anim: no animation "nope"/);
  assert.match(msgs({ speak: { anim: 'bob', rate: 0 } })[0], /rate/);
  assert.match(msgs({ blink: { variant: 'shut' } })[0], /no variant "shut"/);
  assert.match(msgs({ blink: { slot: 'lids' } })[0], /no slot "lids"/);
  assert.match(msgs({ blink: { every: [6, 3] } })[0], /blink.every/);
  assert.match(msgs({ blink: { dur: -1 } })[0], /blink.dur/);
  assert.equal(checkRig(manifest({ blink: false })).length, 0);
});

test('spriteKeys also asks for the variants a character blinks and talks with', () => {
  const keyList = ['char/a/body', 'char/a/e_open', 'char/a/e_closed', 'char/a/m_neutral', 'char/a/m_open', 'char/a/m_wide'], files = keyList.map(k => k + '.png');
  const sprite = { char: 'a', pose: null, overrides: {} };
  const keys = rig => spriteKeys(sprite, assetContext({ files, rigs: { a: manifest(rig) } }));
  assert.deepEqual(keys(undefined).sort(), ['char/a/body', 'char/a/e_open', 'char/a/m_neutral']);
  assert.deepEqual(keys({ blink: true, speak: { variants: ['open', 'wide'] } }).sort(), keyList.sort());
});
