import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, countText, plainText, readingTime, scriptStats, statsText } from '../../dist/engine/src/index.js';

test('tags are left out, a variable is one word, punctuation alone is no word', () => {
  assert.equal(plainText('{b}Hello{/b} there{pause=0.5s} [name]!'), 'Hello there  x!');
  assert.deepEqual(countText('Oh... {i}really{/i}? — [n:one=one apple|other=# apples] left'), { lines: 1, words: 4, chars: 18 });
  assert.equal(countText('...').words, 0);
});

test('words per file, label and character, with menus and prompts as choices', () => {
  const program = compile([
    { file: 'a.vn', text: [
      'define alice "Alice"',
      '"Before any label."',
      'label start:',
      '  alice: Hello there, friend.',
      '  "The wind picks up."',
      '  input name "Your name?"',
      '  menu "Where now?":',
      '    "Left":',
      '      jump left',
      '    "Right" if false else "Locked away":',
      '      end',
    ].join('\n') },
    { file: 'b.vn', text: ['label left:', '  alice: Left it is.', '  end'].join('\n') },
  ]);
  assert.deepEqual(program.diagnostics.filter(d => d.severity === 'error'), []);
  const s = scriptStats(program, 100);
  assert.deepEqual(s.total, { lines: 9, words: 21, chars: 94 });
  assert.deepEqual(s.choices, { lines: 5, words: 8, chars: 37 });
  assert.deepEqual(s.files.map(f => [f.name, f.words]), [['a.vn', 18], ['b.vn', 3]]);
  assert.deepEqual(s.labels.map(l => [l.file, l.name, l.lines]), [['a.vn', '(top level)', 1], ['a.vn', 'start', 7], ['b.vn', 'left', 1]]);
  assert.deepEqual(s.characters.map(c => [c.id, c.name, c.words]), [[null, '(narration)', 7], ['alice', 'Alice', 6]]);
  assert.equal(s.minutes, 0.21);
  assert.match(statsText(s), /^Script statistics: 21 words, 9 lines/);
  assert.match(statsText(s), /b\.vn {2}left {2}/);
});

test('translation counts each localizable string once', () => {
  const program = compile([{ file: 'a.vn', text: ['label start:', '  "One two." #aa01', '  "Three." #aa02', '  end'].join('\n') }]);
  assert.deepEqual(scriptStats(program).translation, { lines: 2, words: 3, chars: 13 });
});

test('reading time in words', () => {
  assert.equal(readingTime(0.4), 'under a minute');
  assert.equal(readingTime(12.4), 'about 12 min');
  assert.equal(readingTime(60), 'about 1 h');
  assert.equal(readingTime(83), 'about 1 h 23 min');
});
