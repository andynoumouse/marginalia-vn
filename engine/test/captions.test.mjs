// Captions for sound effects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captionFor, captionTable, humanizeSoundName, checkGame } from '../../dist/engine/src/index.js';

test('humanizeSoundName: separators, case, folders and extensions', () => {
  assert.equal(humanizeSoundName('door_slam'), '[door slam]');
  assert.equal(humanizeSoundName('Door-Slam'), '[door slam]');
  assert.equal(humanizeSoundName('doorSlam'), '[door slam]');
  assert.equal(humanizeSoundName('sfx/glass_break.ogg'), '[glass break]');
  assert.equal(humanizeSoundName('___'), '');
});

test('captionFor: table wins, empty text silences, fallback is the humanized name', () => {
  const table = captionTable({ captions: { door: '[door slams]', quiet: '', bad: 3 } });
  assert.deepEqual(table, { door: '[door slams]', quiet: '' });
  assert.equal(captionFor('door', table), '[door slams]');
  assert.equal(captionFor('quiet', table), null);
  assert.equal(captionFor('bell_ring', table), '[bell ring]');
  assert.equal(captionFor('toString', table), '[to string]');
  assert.equal(captionFor('x', captionTable(null)), '[x]');
});

test('checkGame warns about a caption that is not text', () => {
  const out = checkGame({ captions: { ok: 'fine', bad: 5 } }, { files: [] }, '');
  assert.ok(out.some(d => /captions: "bad"/.test(d.message)));
  assert.ok(!out.some(d => /captions: "ok"/.test(d.message)));
});

test('checkGame warns about unusable hover look values in the theme', () => {
  const ok = checkGame({ theme: { hotFill: 'rgba(0,0,0,.2)', hotBorder: '#fff', hotBorderWidth: 4, tipBackground: 'black', tipColor: 'white', tipFont: 'Georgia' } }, { files: [] }, '');
  assert.deepEqual(ok, []);
  const bad = checkGame({ theme: { hotFill: 5, hotBorder: 'red; x', hotBorderWidth: -1, tipFont: '' } }, { files: [] }, '').map(d => d.message);
  assert.equal(bad.length, 4);
  assert.ok(bad.some(m => /hotBorderWidth/.test(m)) && bad.some(m => /tipFont/.test(m)));
});
