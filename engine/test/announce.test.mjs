import test from 'node:test';
import assert from 'node:assert/strict';
import { announceLine } from '../../dist/engine/src/index.js';

test('announceLine puts the speaker first', () => {
  assert.equal(announceLine('Mina', 'Hello there.'), 'Mina: Hello there.');
});

test('announceLine reads narration without a speaker', () => {
  assert.equal(announceLine(undefined, 'Rain fell.'), 'Rain fell.');
  assert.equal(announceLine('', 'Rain fell.'), 'Rain fell.');
});

test('announceLine tidies whitespace and skips empty lines', () => {
  assert.equal(announceLine(' Ren ', ' a \n  b '), 'Ren: a b');
  assert.equal(announceLine('Ren', '  \n '), null);
});
