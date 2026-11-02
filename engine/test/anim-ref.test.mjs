import { test } from 'node:test';
import assert from 'node:assert/strict';
import { animateRef } from '../../dist/engine/src/index.js';

test('animateRef reads the character and animation of an animate line', () => {
  assert.deepEqual(animateRef('animate mina wave'), { char: 'mina', name: 'wave' });
  assert.deepEqual(animateRef('    animate mina head_tilt 1.5 loop strength=2'), { char: 'mina', name: 'head_tilt' });
  assert.deepEqual(animateRef('animate mina wave # greet'), { char: 'mina', name: 'wave' });
});

test('animateRef ignores stop and other lines', () => {
  assert.equal(animateRef('animate mina stop'), null);
  assert.equal(animateRef('animate mina'), null);
  assert.equal(animateRef('show mina happy'), null);
  assert.equal(animateRef('mina "animate mina wave"'), null);
});
