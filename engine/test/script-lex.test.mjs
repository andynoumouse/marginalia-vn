import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commentStart, endsInString, maskStrings, quotedRanges, withoutComment } from '../../dist/engine/src/script-lex.js';

test('commentStart: a leading #, or one with spaces around it outside quotes', () => {
  assert.equal(commentStart('# a note'), 0);
  assert.equal(commentStart('    #note'), 4);
  assert.equal(commentStart('jump x # why'), 7);
  assert.equal(commentStart('jump x #'), 7);
  assert.equal(commentStart('panel color #000 on click x'), -1, 'a colour');
  assert.equal(commentStart('"Hi." #ab12'), -1, 'an id');
  assert.equal(commentStart('"a # b" x'), -1, 'inside quotes');
  assert.equal(commentStart('"a \\" # b" x'), -1, 'an escaped quote does not end the string');
  assert.equal(commentStart('"a \\\\" # b'), 7, 'an escaped backslash does');
  assert.equal(withoutComment('call cafe   # trailing'), 'call cafe');
});

test('maskStrings blanks string insides at the same length; quotedRanges and endsInString agree with it', () => {
  const line = 'say "a \\"b\\" c" and "d"';
  const masked = maskStrings(line);
  assert.equal(masked.length, line.length);
  assert.equal(masked, 'say "         " and " "');
  assert.deepEqual(quotedRanges(line), [[5, 14], [21, 22]]);
  assert.equal(maskStrings('"ab\\').length, 4, 'a trailing backslash keeps the length');
  assert.equal(endsInString('input name "Your \\"name'), true);
  assert.equal(endsInString('"a \\\\" x'), false);
  assert.equal(endsInString('"a\\"" "b'), true);
});
