import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../../dist/engine/src/index.js';
import { abstraction } from '../../dist/engine/src/playtest-abstraction.js';

const abs = (...lines) => {
  const program = compile([{ file: 't.vn', text: lines.join('\n') + '\n' }]);
  assert.deepEqual(program.diagnostics.filter(d => d.severity === 'error'), []);
  return { program, a: abstraction(program) };
};
const opIndex = (program, pred) => program.ops.findIndex(pred);

test('a variable no condition can see is not relevant; one compared with numbers gets limits past the extremes', () => {
  const { a } = abs('set clue = 0', 'set noise = 0', 'label start:', '  set clue += 1', '  set noise += 1', '  if clue >= 3:', '    "x"', '  end');
  assert.ok(a.relevant.has('clue'));
  assert.ok(!a.relevant.has('noise'));
  assert.deepEqual(a.limits.get('clue'), { lo: 3 - 1 - 5, hi: 3 + 1 + 5 });
});

test('several comparisons: the limits span all the numbers, and the number may be on either side', () => {
  const { a } = abs('set n = 0', 'label start:', '  if n < 2:', '    "a"', '  end', '  if 10 == n:', '    "b"', '  end');
  assert.deepEqual(a.limits.get('n'), { lo: 2 - 1 - 5, hi: 10 + 1 + 5 });
});

test('a variable also used another way is exact (no limits), and what feeds a relevant variable is relevant and exact', () => {
  const { a } = abs('set a = 1', 'set b = 2', 'set total = 0', 'label start:', '  set total = a + b', '  if total > 2:', '    "x"', '  end');
  assert.ok(a.limits.has('total'));
  for (const v of ['a', 'b']) assert.ok(a.relevant.has(v) && !a.limits.has(v), v);
  const mixed = abs('set n = 0', 'label start:', '  if n > 2 and n != m:', '    "x"', '  end', 'set m = 0').a;
  assert.ok(mixed.relevant.has('n') && !mixed.limits.has('n'), 'compared with a variable too');
});

test('lists are sets unless the story picks by position (ordered) or counts them (counted)', () => {
  const plain = abs('set bag = ["a"]', 'label start:', '  if contains(bag, "a"):', '    "x"', '  end').a;
  assert.ok(!plain.ordered.has('bag') && !plain.counted.has('bag'));
  const byPosition = abs('set bag = ["a", "b"]', 'label start:', '  if item(bag, 0) == "a":', '    "x"', '  end').a;
  assert.ok(byPosition.ordered.has('bag'));
  const counted = abs('set bag = ["a", "a"]', 'label start:', '  if count(bag, "a") > 1:', '    "x"', '  end').a;
  assert.ok(counted.counted.has('bag'));
  assert.ok(!counted.ordered.has('bag'));
});

test('a copy of an ordered list is ordered too', () => {
  const { a } = abs('set bag = ["a", "b"]', 'set copy = []', 'label start:', '  set copy = bag', '  if item(copy, 0) == "a":', '    "x"', '  end');
  assert.ok(a.ordered.has('copy') && a.ordered.has('bag'));
});

test('liveness: a value overwritten before it is read is not live, one read later is', () => {
  const { program, a } = abs('set n = 0', 'label start:', '  set n = 1', '  set n = 2', '  if n > 1:', '    "x"', '  end');
  const first = opIndex(program, o => o.op === 'set' && o.expr?.v === 1);
  const second = opIndex(program, o => o.op === 'set' && o.expr?.v === 2);
  const branch = opIndex(program, o => o.op === 'branch');
  assert.ok(!a.live[first].has('n'), 'n = 1 is overwritten by n = 2');
  assert.ok(!a.live[second].has('n'), 'n = 2 writes it; the read after it is its own');
  assert.ok(a.live[branch].has('n'), 'the branch reads n');
  assert.equal(a.live.length, program.ops.length);
});

test('liveness: a value read in only one branch of a menu is live before the menu', () => {
  const { program, a } = abs('set n = 0', 'label start:', '  menu:', '    "A":', '      if n > 0:', '        "x"', '      end', '    "B":', '      "y"');
  assert.ok(a.live[opIndex(program, o => o.op === 'menu')].has('n'));
});

test('a call argument feeds a relevant parameter of the label', () => {
  const { a } = abs('set x = 3', 'label start:', '  call show_it(x)', '  end', 'label show_it(k):', '  if k == 3:', '    "x"', '  end');
  assert.ok(a.relevant.has('k') && a.relevant.has('x'));
  assert.ok(!a.limits.has('x'));
});
