import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatHover, interpolate } from '../../dist/engine/src/index.js';

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

test('keyed plural forms follow the language rules, exact counts first, then other', () => {
  const ru = '[n:one=монета|few=монеты|many=монет|other=монеты]';
  assert.equal(interpolate(ru, { n: 1 }, {}, 'ru'), 'монета');
  assert.equal(interpolate(ru, { n: 3 }, {}, 'ru'), 'монеты');
  assert.equal(interpolate(ru, { n: 5 }, {}, 'ru'), 'монет');
  assert.equal(interpolate(ru, { n: 21 }, {}, 'ru'), 'монета');
  assert.equal(interpolate(ru, { n: 1.5 }, {}, 'ru'), 'монеты');
  assert.equal(interpolate('[n:0=none|one=a coin|other=coins]', { n: 0 }), 'none');
  assert.equal(interpolate('[n:one=a coin|other=coins]', { n: 2 }), 'coins');
  assert.equal(interpolate('[n:few=x|other=y]', { n: 1 }, {}, 'en'), 'y'); // 'one' missing: falls back to other
  assert.equal(interpolate('[n:one=a|two=b]', { n: 5 }), '[n:one=a|two=b]'); // no form fits
  assert.equal(interpolate('[n:one=a|other=b]', { n: 1 }, {}, 'not a lang!'), 'a'); // bad tag: en-like rules
  assert.equal(interpolate('[bag:one=item|other=items]', { bag: ['key'] }), 'item');
  assert.equal(interpolate('[name:one=a|other=b]', { name: 'Ann' }), '[name:one=a|other=b]');
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

test('formatHover: what a [name:format] tag makes of sample values, or that the format is unknown', () => {
  const line = '  "You have [gold:,2] and [coins:no coins|a coin|coins], [x:wat]." #ab12';
  const at = s => line.indexOf(s) + 1;
  assert.deepEqual(formatHover(line, at('[gold')), { from: line.indexOf('[gold'), to: line.indexOf('[gold') + '[gold:,2]'.length, text: '`gold` with `:,2`: 0 → "0.00", 1234.5 → "1,234.50", -7 → "-7.00"' });
  assert.equal(formatHover(line, at('[coins')).text, '`coins` with `:no coins|a coin|coins`: 0 → "no coins", 1 → "a coin", 2 → "coins", 5 → "coins", 21 → "coins"');
  assert.match(formatHover(line, at('[x:')).text, /^Unknown format `:wat`/);
  assert.equal(formatHover(line, line.indexOf('You')), null);
  assert.equal(formatHover('"[plain]"', 2), null);
  assert.match(formatHover('[n:one=монета|few=монеты|many=монет|other=монеты]', 1, 'ru').text, /1 → "монета", 2 → "монеты", 5 → "монет", 21 → "монета"/);
});
