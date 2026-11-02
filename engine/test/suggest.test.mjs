import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAssets, closest, compile, editDistance, wordSpan } from '../../dist/engine/src/index.js';

test('editDistance counts inserts, deletes, changes and swaps of neighbours, ignoring case', () => {
  assert.equal(editDistance('show', 'show'), 0);
  assert.equal(editDistance('shwo', 'show'), 1); // a swap
  assert.equal(editDistance('sho', 'show'), 1);
  assert.equal(editDistance('Scene', 'scene'), 0);
  assert.equal(editDistance('', 'abc'), 3);
});

test('closest: near names first, nothing for a known or far-off word', () => {
  assert.deepEqual(closest('shwo', ['show', 'hide', 'shake']), ['show']);
  assert.deepEqual(closest('show', ['show', 'shows']), []);
  assert.deepEqual(closest('zzzz', ['show', 'hide']), []);
  assert.deepEqual(closest('ab', ['ac', 'ad', 'ae', 'af']), ['ac', 'ad', 'ae']); // at most 3
  assert.deepEqual(closest('evening_thme', ['evening_theme', 'morning_theme']), ['evening_theme']);
});

test('wordSpan finds a whole word outside quotes', () => {
  assert.deepEqual(wordSpan('  shwo alice', 'shwo'), [2, 6]);
  assert.deepEqual(wordSpan('jump endx  # endx', 'endx'), [5, 9]);
  assert.deepEqual(wordSpan('  mnia: "mnia is here" mnia', 'mnia'), [2, 6]);
  assert.deepEqual(wordSpan('  "mnia" mnia', 'mnia'), [9, 13]);
  assert.equal(wordSpan('show alice_b', 'alice'), null); // part of a longer name
  assert.equal(wordSpan('show bob', 'alice'), null);
});

test('unknown commands, labels, characters and screens say what was probably meant, with a fix', () => {
  const p = compile([{ file: 't.vn', text: 'define alice "Alice"\nlabel start:\n  shwo alice\n  meun:\n    "a":\n      jump strat\n  alcie: Hi\n  show screen inventroy\n  qqqq\n  jump zzzzzz\nscreen inventory:\n  button b at 1,1 "B"\n' }]);
  const by = line => p.diagnostics.find(d => d.line === line && d.fix) ?? p.diagnostics.find(d => d.line === line);
  assert.equal(by(3).message, 'Unknown command "shwo" (did you mean "show"?)');
  assert.deepEqual(by(3).fix, { word: 'shwo', options: ['show'] });
  assert.deepEqual(by(4).fix, { word: 'meun', options: ['menu'] }); // the colon is not part of the word
  assert.deepEqual(by(6).fix, { word: 'strat', options: ['start'] });
  assert.match(by(7).message, /^Unknown character "alcie" \(did you mean "alice"\?\)$/);
  assert.deepEqual(by(8).fix, { word: 'inventroy', options: ['inventory'] });
  assert.equal(by(9).fix, undefined); // nothing close
  assert.equal(by(10).message, 'Unknown label "zzzzzz"');
  const q = compile([{ file: 't.vn', text: 'label start:\n  bob: Hi\n' }]);
  assert.match(q.diagnostics[0].message, /Unknown character "bob" \(add a define line\)/); // the old hint when nothing is close
});

test('missing assets suggest the close file names', () => {
  const p = compile([{ file: 't.vn', text: 'define al "Al"\nlabel start:\n  scene parck\n  music play evening_thme\n  sound play clik\n  show al hapy\n  animate al nodd\n  scene nowhere_at_all\n' }]);
  const index = { files: ['bg/park.png', 'music/evening_theme.ogg', 'sound/click.ogg', 'char/al/happy.png', 'char/al/sad.png'] };
  const ds = checkAssets(p, index);
  const fix = line => ds.find(d => d.line === line)?.fix?.options;
  assert.deepEqual([fix(3), fix(4), fix(5), fix(6), fix(7)], [['park'], ['evening_theme'], ['click'], ['happy'], ['nod']]);
  assert.match(ds.find(d => d.line === 3).message, /^No background "parck" in assets\/bg \(did you mean "park"\?\)$/);
  assert.match(ds.find(d => d.line === 8).message, /\(a placeholder is drawn\)$/);
});
