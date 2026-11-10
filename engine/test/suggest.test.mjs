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
  assert.deepEqual(wordSpan('  "a\\\\" mnia "mnia"', 'mnia'), [8, 12]); // an escaped backslash does not escape the closing quote
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

test('a narration line with a missing or extra quote says so, not "Unknown command" (UX round EA-1)', () => {
  const p = compile([{ file: 't.vn', text: 'label start:\n  "The rain falls.""\n  "The rain falls.\n  "One" "Two"\n  "Fine."\n  "It\\"s fine."\n' }]);
  const at = line => p.diagnostics.filter(d => d.line === line).map(d => d.message);
  assert.deepEqual(at(2), ['Missing or extra quote: narration is "text" with one closing quote']);
  assert.deepEqual(at(3), ['Missing or extra quote: narration is "text" with one closing quote']);
  assert.deepEqual(at(4), ['Narration is one "quoted text" per line, then an optional style= and #id']);
  assert.deepEqual([at(5), at(6)], [[], []]); // good narration, an escaped quote included
});

test('syntax slips say what to write, and the rest of the block still reads (UX round EA-5, EA-6, EL-11)', () => {
  const run = lines => compile([{ file: 't.vn', text: lines.join('\n') + '\n' }]);
  const msgs = p => p.diagnostics.map(d => `${d.line} ${d.severity}: ${d.message}`);
  // a missing colon is one message, and the block under the line is read as if it had one: no stray indentation, no "No labels found"
  const colons = run([
    'define hero "Hero"', 'label start', '  set trust = 0', '  if trust >= 1', '    hero: Hi.', '  elif trust > 0', '    hero: Mm.', '  else', '    hero: Oh.',
    '  menu', '    "Yes":', '      jump start', '',
  ]);
  assert.deepEqual(msgs(colons), [
    '2 error: "label" needs a colon at the end of the line: label start:',
    '4 error: "if" needs a colon at the end of the line: if trust >= 1:',
    '6 error: "elif" needs a colon at the end of the line: elif trust > 0:',
    '8 error: "else" needs a colon at the end of the line: else:',
    '10 error: "menu" needs a colon at the end of the line: menu:',
  ]);
  assert.ok(Object.hasOwn(colons.labels, 'start'));
  // a comment after a block opener is not read as part of it
  assert.deepEqual(msgs(run(['label start:', '  if 1 == 1: # always', '    "a"', '  else: # never', '    "b"'])), [
    '2 error: A # comment goes on a line of its own, not after "if...:"',
    '4 error: A # comment goes on a line of its own, not after "else...:"',
  ]);
  assert.deepEqual(msgs(run(['label start:', '  menu "Pick #1": # hm', '    "A":', '      "a"'])), ['2 error: A # comment goes on a line of its own, not after "menu...:"']);
  // a label name in another alphabet is a name (EL-11); one starting with a digit or holding a dash is not, and the block is still read
  assert.deepEqual(msgs(run(['label start:', '  jump a', 'label päivä_1:', '  "Hei."', 'label 2b:', '  "x"', 'label:', 'label a-b:', '  "y"'])), [
    '5 error: Label names use letters, digits and _, and do not start with a digit: "2b" has "2"',
    '7 error: Use: label <name>:  or  label <name>(<parameters>):',
    '8 error: Label names use letters, digits and _, and do not start with a digit: "a-b" has "-"',
    '2 error: Unknown label "a"', // the link step comes after the parse; the blocks under the bad names raised nothing of their own
  ]);
  // habits from other languages, and `set` that is not name = value
  const habits = run([
    'define hero "Hero"', 'label start:', '  $ trust = 1', '  set trust =', '  set trust 1', '  set trust == 1', '  hero "Hello there."', '  scene bg_title # park', '',
  ]);
  assert.deepEqual(msgs(habits).filter(m => !/^8 /.test(m)), [
    '3 error: Use set instead of $: set trust = 1',
    '4 error: Use: set <name> = <value>  (also +=, -=, *= and /=)',
    '5 error: Use: set <name> = <value>  (also +=, -=, *= and /=)',
    '6 error: Unexpected "=": == compares (if trust == 1:) and set trust = 1 assigns',
    '7 error: Dialogue is written hero: text  (a colon after the name, no quotes); a quoted "text" on its own line is narration',
  ]);
  assert.match(msgs(habits).find(m => /^8 /.test(m)), /a # comment goes on a line of its own\)$/);
  assert.match(msgs(run(['label start:', '  if trust = 1:', '    "a"']))[0], /Unexpected "=": == compares/);
  // typos keep their did-you-mean; a block opener with its colon and a good header is quiet
  assert.deepEqual(run(['label start:', '  shwo x', '  menu:', '    "A":', '      "a"']).diagnostics.map(d => d.message), ['Unknown command "shwo" (did you mean "show"?)']);
  // dialogue: an id followed by words, or a # comment, is shown to the player: warned, not an error
  const leaks = run(['define hero "Hero"', 'label start:', '  hero: Stay a while. #ghg3 She smiles.', '  hero: Hello there. # greet', '  hero: Done. # #gljn', '  hero: Room #2024 and a #1 fan. #ab12', '  hero: Fine. #cd34', '  hero: Press 5 to quit.', '']);
  assert.deepEqual(msgs(leaks), [
    '3 warning: The text goes on after the id #ghg3, and the player sees it: the #id is the last thing on the line',
    '4 warning: Everything after the colon is dialogue, so the player sees this "#" and what follows it: a # comment goes on a line of its own',
    '5 warning: Everything after the colon is dialogue, so the player sees this "#" and what follows it: a # comment goes on a line of its own',
  ]);
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
