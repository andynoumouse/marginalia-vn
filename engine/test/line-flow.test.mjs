// The decisions behind typing a line: clicks, holds, settings kicks and what the clock does once a line is shown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startFlow, finished, held, released, ended, clickAct, kickAct, settleAfterVoice, settlePlan, pagePlan, waitPlan, SKIP_MS, NEXT_MS } from '../../dist/engine/src/index.js';

const pace = (o = {}) => ({ skipping: false, skippable: true, autoOn: false, autoMs: 900, ...o });

test('a click shows the rest of the line, then moves on', () => {
  let f = startFlow();
  assert.equal(clickAct(f), 'finish');
  f = finished(f);
  assert.equal(clickAct(f), 'next');
});

test('a click lifts a hold first, whether or not the line is done', () => {
  const f = held(startFlow(), 'wait');
  assert.equal(clickAct(f), 'release');
  assert.equal(clickAct(released(f)), 'finish');
  assert.equal(clickAct(held(startFlow(), 'page')), 'release');
});

test('finishing a line clears a hold', () => {
  const f = finished(held(startFlow(), 'page'));
  assert.equal(f.hold, 'none');
  assert.equal(f.done, true);
});

test('a settings kick settles a finished line, finishes a skippable one, else leaves it', () => {
  assert.equal(kickAct(finished(startFlow()), false), 'settle');
  assert.equal(kickAct(startFlow(), true), 'finish');
  assert.equal(kickAct(startFlow(), false), 'none');
});

test('a voice that ends settles only a finished line that is still being read', () => {
  assert.equal(settleAfterVoice(startFlow()), false);
  assert.equal(settleAfterVoice(finished(startFlow())), true);
  assert.equal(settleAfterVoice(ended(finished(startFlow()))), false);
});

test('settling: skip passes a skippable line, unread text stops skipping, auto waits for the voice', () => {
  assert.deepEqual(settlePlan(pace({ skipping: true })), { dropSkip: false, after: SKIP_MS });
  assert.deepEqual(settlePlan(pace({ skipping: true, skippable: false })), { dropSkip: true, after: null });
  assert.deepEqual(settlePlan(pace({ skipping: true, skippable: false, autoOn: true })), { dropSkip: true, after: 900 });
  assert.deepEqual(settlePlan(pace({ autoOn: true })), { dropSkip: false, after: 900 });
  assert.deepEqual(settlePlan(pace({ autoOn: true, voicePlaying: true })), { dropSkip: false, after: null });
  assert.deepEqual(settlePlan(pace()), { dropSkip: false, after: null });
});

test('{next} moves on by itself, voice or not', () => {
  assert.deepEqual(settlePlan(pace({ autoNext: true, voicePlaying: true })), { dropSkip: false, after: NEXT_MS });
  assert.deepEqual(settlePlan(pace({ autoNext: true, skipping: true, skippable: false })), { dropSkip: true, after: NEXT_MS });
});

test('a full page turns on its own when skipping or in auto mode', () => {
  assert.deepEqual(pagePlan(pace({ skipping: true })), { dropSkip: false, after: SKIP_MS });
  assert.deepEqual(pagePlan(pace({ skipping: true, skippable: false, autoOn: true })), { dropSkip: true, after: 900 });
  assert.deepEqual(pagePlan(pace({ autoOn: true, voicePlaying: true })), { dropSkip: false, after: 900 });
  assert.deepEqual(pagePlan(pace()), { dropSkip: false, after: null });
});

test('a {w} wait is skipped only by skippable skipping; unread text keeps skipping on', () => {
  assert.deepEqual(waitPlan(pace({ skipping: true })), { skip: true, after: null });
  assert.deepEqual(waitPlan(pace({ skipping: true, skippable: false })), { skip: false, after: null });
  assert.deepEqual(waitPlan(pace({ autoOn: true })), { skip: false, after: 900 });
});
