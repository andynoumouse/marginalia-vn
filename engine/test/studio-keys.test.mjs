import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dialogEscape, escapesToMove, undoInField, refocusIndex } from '../../dist/engine/src/index.js';

test('Esc in the side columns and the bar: a typed edit first, then a deform tool hands it to the stage, any other tool goes back to Move, Move closes', () => {
  assert.equal(dialogEscape(true, 'warp', true), 'revert');
  assert.equal(dialogEscape(true, 'move', true), 'revert');
  assert.equal(dialogEscape(false, 'weights', true), 'stage');
  assert.equal(dialogEscape(false, 'weights', false), 'move', 'no stage to clear a selection: straight back to Move');
  for (const t of ['pivot', 'rotate', 'scale']) assert.equal(dialogEscape(false, t, true), 'move', t);
  assert.equal(dialogEscape(false, 'move', true), 'close');
  for (const t of ['pivot', 'rotate', 'scale', 'warp', 'weights', 'mask']) assert.equal(escapesToMove(t), true, t);
  assert.equal(escapesToMove('move'), false);
});

test('Ctrl+Z in a field undoes the typing only while there is an edit not committed', () => {
  assert.equal(undoInField(true), true);
  assert.equal(undoInField(false), false);
});

const slots = (...sigs) => sigs.map(s => (typeof s === 'string' ? { sig: s, usable: true } : s));

test('after a redraw the control with the same signature takes the focus back, wherever it moved', () => {
  assert.equal(refocusIndex('key 0.5', 1, slots('key 0', 'key 0.5', 'key 1')), 1);
  assert.equal(refocusIndex('key 0.5', 1, slots('key 0', 'key 0.25', 'key 0.5', 'key 1')), 2, 'a key added before it');
  assert.equal(refocusIndex('chip b', 0, slots('chip a', 'chip b')), 1);
});

test('with several of the same signature, the one nearest the old place wins', () => {
  assert.equal(refocusIndex('✕', 3, slots('✕', 'a', '✕', 'b', '✕')), 2);
  assert.equal(refocusIndex('✕', 4, slots('✕', 'a', '✕', 'b', '✕')), 4);
});

test('a control that is gone or disabled gives the focus to the one at its place, or the nearest before it', () => {
  assert.equal(refocusIndex('chip b', 1, slots('chip a', 'chip c')), 1, 'the next one moved up into its place');
  assert.equal(refocusIndex('chip c', 2, slots('chip a', 'chip b')), 1, 'it was the last: the one before it');
  assert.equal(refocusIndex('Delete key', 1, slots('t', { sig: 'Delete key', usable: false }, 'ease')), 0, 'disabled: the one before it');
  assert.equal(refocusIndex('x', 0, slots({ sig: 'a', usable: false }, 'b')), 1, 'nothing usable before it: the first usable after');
});

test('nothing to focus gives -1', () => {
  assert.equal(refocusIndex('x', 0, []), -1);
  assert.equal(refocusIndex('x', 2, slots({ sig: 'a', usable: false })), -1);
});
