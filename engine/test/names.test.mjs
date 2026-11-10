import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, Runtime, NullRenderer, isScriptName, isAsciiName, mixedAlphabets, renameLabel, renameVariable } from '../../dist/engine/src/index.js';

test('script names take letters of any alphabet; file names stay ASCII (EL-11)', () => {
  for (const n of ['päivä_1', '体力', 'нагрузка', 'नाम', '_x', 'Ölü2']) assert.ok(isScriptName(n), n);
  for (const n of ['1st', 'a-b', 'a b', '', 'x.y', '💡']) assert.ok(!isScriptName(n), n);
  assert.ok(isAsciiName('alice') && !isAsciiName('älice'));
});

test('labels, variables and [interpolation] in another alphabet compile and run', async () => {
  const text = [
    'label start:',
    '  set 体力 = 3',
    '  set päivä = "maanantai"',
    '  jump päivä_1',
    'label päivä_1:',
    '  "[päivä]: [体力]"',
    '  call lepo(2)',
    '  end',
    'label lepo(määrä):',
    '  set 体力 += määrä',
    '  "[体力]"',
    '  return',
  ].join('\n');
  const p = compile([{ file: 't.vn', text }]);
  assert.deepEqual(p.diagnostics.filter(d => d.severity === 'error'), []);
  const r = new NullRenderer();
  const rt = new Runtime(p, r);
  await rt.start();
  assert.deepEqual(r.says.map(s => s.text), ['maanantai: 3', '5']);
  assert.equal(rt.vars['体力'], 5);
});

test('a name typed decomposed (a + combining ring) is the same as the composed one', () => {
  const decomposed = 'påiva', composed = 'påiva';
  const p = compile([{ file: 't.vn', text: `label start:\n  jump ${decomposed}\nlabel ${composed}:\n  end\n` }]);
  assert.deepEqual(p.diagnostics.filter(d => d.severity === 'error'), []);
});

test('a name mixing look-alike alphabets warns (a Latin and a Cyrillic а)', () => {
  assert.deepEqual(mixedAlphabets('vаlue'), ['Latin', 'Cyrillic']);
  assert.equal(mixedAlphabets('päivä'), null);
  assert.equal(mixedAlphabets('体力'), null);
  const p = compile([{ file: 't.vn', text: 'label start:\n  set vаlue = 1\n  end\n' }]);
  assert.match(p.diagnostics.map(d => d.message).join('|'), /mixes Latin and Cyrillic letters/);
});

test('rename follows labels and variables in another alphabet', () => {
  const files = [{ name: 't.vn', text: 'label start:\n  set 体力 = 1\n  "[体力]"\n  jump päivä\nlabel päivä:\n  end\n' }];
  const l = renameLabel(files, 'päivä', 'ilta');
  assert.ok(l.ok && l.edits.length === 2, JSON.stringify(l));
  const v = renameVariable(files, { name: '体力', persistent: false, scope: null }, 'stamina');
  assert.ok(v.ok && v.edits.length === 2, JSON.stringify(v));
});
