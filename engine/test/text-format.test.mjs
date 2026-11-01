import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpolate } from '../../dist/engine/src/index.js';

test('[n:2] fixes decimals and [n:,] groups thousands', () => {
  assert.equal(interpolate('[t:2]', { t: 1.5 }), '1.50');
  assert.equal(interpolate('[t:0]', { t: 2.6 }), '3');
  assert.equal(interpolate('[gold:,]', { gold: 1234567 }), '1,234,567');
  assert.equal(interpolate('[gold:,2]', { gold: 1234.5 }), '1,234.50');
  assert.equal(interpolate('[persistent.score:,]', { 'persistent.score': 12000 }), '12,000');
});

test('[n:one|other] picks a plural form, three forms add a zero form', () => {
  assert.equal(interpolate('[n] [n:coin|coins]', { n: 1 }), '1 coin');
  assert.equal(interpolate('[n] [n:coin|coins]', { n: 3 }), '3 coins');
  assert.equal(interpolate('[n] [n:coin|coins]', { n: 0 }), '0 coins');
  assert.equal(interpolate('[n:no coins|a coin|coins]', { n: 0 }), 'no coins');
  assert.equal(interpolate('[n:no coins|a coin|coins]', { n: 1 }), 'a coin');
  assert.equal(interpolate('[n:no coins|a coin|coins]', { n: 5 }), 'coins');
  assert.equal(interpolate('[bag:item|items]', { bag: ['key', 'map'] }), 'items'); // a list counts its length
});

test('unknown variables, formats and non-numbers stay as written', () => {
  assert.equal(interpolate('[x:2]', {}), '[x:2]');
  assert.equal(interpolate('[t:wat]', { t: 1 }), '[t:wat]');
  assert.equal(interpolate('[t:9]', { t: 1 }), '[t:9]');
  assert.equal(interpolate('[name:2]', { name: 'Ann' }), '[name:2]');
  assert.equal(interpolate('[name:a|b]', { name: 'Ann' }), '[name:a|b]');
  assert.equal(interpolate('[a:b|c|d|e]', { a: 1 }), '[a:b|c|d|e]');
  assert.equal(interpolate('[t]', { t: 1.5 }), '1.5');
});
