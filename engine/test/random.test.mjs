import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, Runtime, NullRenderer, parseExpr, evalExpr, formatExpr, randomStep, getCompletions } from '../../dist/engine/src/index.js';

const play = (text, setup = () => {}) => {
  const p = compile([{ file: 'a.vn', text }]);
  const r = new NullRenderer();
  const rt = new Runtime(p, r);
  setup(rt, r);
  return { p, r, rt };
};
const lines = r => r.says.map(s => s.text);

test('randomStep is a pure seeded generator in [0, 1)', () => {
  let s = 42;
  const a = [];
  for (let i = 0; i < 1000; i++) { const r = randomStep(s); assert.ok(r.value >= 0 && r.value < 1); a.push(r.value); s = r.state; }
  assert.ok(new Set(a).size > 990);
  assert.deepEqual(randomStep(42), randomStep(42));
  assert.notEqual(randomStep(1).value, randomStep(2).value);
});

test('random(), pick() and chance() parse, format and need a generator', () => {
  assert.throws(() => parseExpr('nope(1)'), /Unknown function/);
  assert.throws(() => parseExpr('random(1, 2, 3)'), /random/);
  assert.throws(() => parseExpr('pick()'), /pick/);
  assert.throws(() => parseExpr('chance(1'), /parenthesis/);
  assert.equal(formatExpr(parseExpr('random(1,6)+2')), 'random(1, 6) + 2');
  assert.throws(() => evalExpr(parseExpr('random(3)'), {}), /running story/);
  let n = 0;
  const rng = { next: () => [0, 0.5, 0.999][n++ % 3] };
  assert.equal(evalExpr(parseExpr('random(1, 6)'), {}, rng), 1);
  assert.equal(evalExpr(parseExpr('random(1, 6)'), {}, rng), 4);
  assert.equal(evalExpr(parseExpr('random(1, 6)'), {}, rng), 6);
  assert.equal(evalExpr(parseExpr('random(10)'), {}, rng), 1);
  assert.equal(evalExpr(parseExpr('random(-2, 2)'), {}, rng), 0);
  assert.equal(evalExpr(parseExpr('random(5, 1)'), {}, rng), 5); // empty range: the lower bound
  assert.equal(evalExpr(parseExpr('pick("x", "y", "z")'), {}, rng), 'x');
  assert.equal(evalExpr(parseExpr('pick(1, 2, 3, 4)'), {}, rng), 3);
  assert.equal(evalExpr(parseExpr('chance(50)'), {}, { next: () => 0.49 }), true);
  assert.equal(evalExpr(parseExpr('chance(50)'), {}, { next: () => 0.5 }), false);
  assert.equal(evalExpr(parseExpr('random()'), {}, { next: () => 0.25 }), 0.25);
});

const dice = [
  'label start:',
  '  set a = random(1, 6)',
  '  "Roll [a]"',
  '  set b = pick("red", "green", "blue")',
  '  "Colour [b]"',
  '  if chance(50):',
  '    "Lucky"',
  '  else:',
  '    "Unlucky"',
  '  set c = random(1, 1000)',
  '  menu:',
  '    "One":',
  '      "Roll [c]"',
  '    "Two":',
  '      "Roll [c]"',
  '  set d = random(1, 1000)',
  '  "Last [d]"',
].join('\n');

test('a seed fixes the draws; a new start picks a new seed', async () => {
  const run = async seed => {
    const { r, rt } = play(dice, rt => { rt.seedSource = () => seed; });
    await rt.start();
    return lines(r);
  };
  assert.deepEqual(await run(7), await run(7));
  const all = new Set();
  for (let s = 1; s < 8; s++) all.add((await run(s)).join('|'));
  assert.ok(all.size > 1);
});

test('rollback and restore redraw the same numbers', async () => {
  const { r, rt } = play(dice, rt => { rt.seedSource = () => 99; });
  await rt.start();
  const first = lines(r);
  assert.equal(first.length, 5);
  const choices = [...rt.choices];
  // a fresh runtime with the same seed restored to a later step lands on the same line and generator state
  const r2 = new NullRenderer();
  const rt2 = new Runtime(rt.program, r2);
  rt2.seed = rt.seed;
  await rt2.restore({ step: 5 }, choices);
  assert.equal(r2.says.at(-1).text, first[4]);
  assert.equal(rt2.rng, rt.rng);
  // a rollback on the same runtime replays identically
  r.says.length = 0;
  await rt.restore({ step: 2 }, choices);
  assert.deepEqual(lines(r), first.slice(2)); // continues live from the target with the same draws
  assert.equal(rt.seed, rt2.seed);
});

test('saves keep the seed and the generator state', async () => {
  const { r, rt } = play(dice, rt => { rt.seedSource = () => 5; });
  await rt.start();
  const save = rt.save();
  assert.equal(save.seed, 5);
  const rt2 = new Runtime(rt.program, new NullRenderer());
  await rt2.load(JSON.parse(JSON.stringify(save)));
  assert.equal(rt2.seed, 5);
  assert.equal(rt2.rng, rt.rng);
  // a source-position save replays the branches with the saved seed
  const r3 = new NullRenderer();
  const rt3 = new Runtime(rt.program, r3);
  rt3.seed = save.seed;
  await rt3.restore({ file: 'a.vn', line: 17 }, save.choices);
  assert.equal(r3.says.at(-1).text, lines(r).at(-1));
});

test('hot reload (setProgram + restore) keeps the draws before the edit', async () => {
  const { r, rt } = play(dice, rt => { rt.seedSource = () => 11; });
  await rt.start();
  const first = lines(r);
  rt.setProgram(compile([{ file: 'a.vn', text: dice.replace('"Last [d]"', '"Final [d]"') }]));
  r.says.length = 0;
  await rt.restore({ file: 'a.vn', line: 17 });
  assert.equal(r.says.at(-1).text, first.at(-1).replace('Last', 'Final'));
});

test('random in a menu option condition is an error', () => {
  const p = compile([{ file: 'a.vn', text: ['label start:', '  menu:', '    "A" if chance(50):', '      "x"', '    "B":', '      "y"'].join('\n') }]);
  assert.ok(p.diagnostics.some(d => d.severity === 'error' && d.message.includes('menu option condition')));
});

test('completions offer the random functions in expressions', () => {
  const p = compile([{ file: 'a.vn', text: 'label start:\n  "x"' }]);
  const labels = getCompletions(p, '  set x = ').map(s => s.label);
  assert.ok(['random', 'pick', 'chance'].every(f => labels.includes(f)));
  assert.ok(getCompletions(p, '  if ').some(s => s.label === 'chance'));
});
