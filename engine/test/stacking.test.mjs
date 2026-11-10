// Characters stacked at center: a `show` without `at` onto a spot someone already stands on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../../dist/engine/src/index.js';

const run = body => {
  const p = compile([{ file: 't.vn', text: `define al "Al"\ndefine bo "Bo"\ndefine cy "Cy"\nlabel start:\n${body.trim().split('\n').map(l => '  ' + l.trim().replace(/^>/, '  ')).join('\n')}\n` }]);
  assert.deepEqual(p.diagnostics.filter(d => d.severity === 'error').map(d => d.message), []);
  return p.diagnostics.filter(d => /stand at center/.test(d.message)).map(d => d.line);
};

test('a second character shown without at onto center is flagged on its line', () => {
  assert.deepEqual(run('show al\nshow bo\n"Hi"'), [6]);
  assert.match(compile([{ file: 't.vn', text: 'define al "Al"\ndefine bo "Bo"\nlabel start:\n  show al\n  show bo\n' }]).diagnostics.at(-1).message,
    /"bo" is shown without "at", so they stand at center on top of "al"/);
});

test('no warning when the spot is free, chosen, or the overlap is meant', () => {
  assert.deepEqual(run('show al at left\nshow bo'), []);
  assert.deepEqual(run('show al\nshow bo at right'), []);
  assert.deepEqual(run('show al\nhide al\nshow bo'), []);
  assert.deepEqual(run('show al\nmove al to left 0.5s\nshow bo'), []);
  assert.deepEqual(run('show al\nscene bg_room\nshow bo'), []);
  assert.deepEqual(run('show al\nshow bo behind=al'), []);
  assert.deepEqual(run('show al\nshow bo order=back'), []);
  assert.deepEqual(run('show al\nshow al smile'), []);     // a pose change keeps al where she is
  assert.deepEqual(run('show al at left\nshow al\nshow bo'), []); // al stays at left
});

test('a character moved onto center is stood on too', () => {
  assert.deepEqual(run('show al at left\nmove al to center 0.5s\nshow bo'), [7]);
});

test('paths: flagged only when every path leaves someone at center', () => {
  assert.deepEqual(run('show al\nif x > 1:\n>"A"\nelse:\n>"B"\nshow bo'), [10]);
  assert.deepEqual(run('if x > 1:\n>show al\nshow bo'), []);
  assert.deepEqual(run('show al\nif x > 1:\n>hide al\nshow bo'), []);
  assert.deepEqual(run('show al\nmenu:\n>"Stay":\n>  "Ok"\n>"Go":\n>  hide al\nshow bo'), []);
  assert.deepEqual(run('show al\nmenu:\n>"Stay":\n>  "Ok"\n>"Go":\n>  "Fine"\nshow bo'), [11]);
});

test('labels: the stage carries over a jump, and is unknown after a call', () => {
  const p = compile([{ file: 't.vn', text: 'define al "Al"\ndefine bo "Bo"\nlabel start:\n  show al\n  jump next\nlabel next:\n  show bo\n' }]);
  assert.deepEqual(p.diagnostics.map(d => d.line), [7]);
  const q = compile([{ file: 't.vn', text: 'define al "Al"\ndefine bo "Bo"\nlabel start:\n  call side\n  show bo\n  end\nlabel side:\n  show al\n  return\n' }]);
  assert.deepEqual(q.diagnostics, []);
});
