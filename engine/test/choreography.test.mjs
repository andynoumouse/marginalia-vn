import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildChoreography, parseTransformLine, compile, Runtime, NullRenderer, transformToAnim } from '../../dist/engine/src/index.js';
import { errors, warnings } from './helpers.mjs';

const src = { file: 't.vn', line: 1 };
const build = (...lines) => buildChoreography({ name: 'c', src, lines: lines.map(([at, target, text]) => ({ at, target, step: parseTransformLine(text, src), src })) });
const program = (...lines) => compile([{ file: 't.vn', text: lines.join('\n') + '\n' }]);
const durs = def => def.steps.map(s => `${s.kind}${s.dur}`).join(' ');

test('buildChoreography: gaps become waits and every target ends together', () => {
  const b = build([0, 'alice', 'x=0.1 0.5s'], [0, 'bob', 'x=-0.1 0.5s'], [1, 'alice', 'hop 0.25s'], [1.5, 'camera', 'scale=1.05 0.5s']);
  assert.equal(b.total, 2);
  assert.deepEqual(b.problems, []);
  const by = Object.fromEntries(b.members.map(m => [m.target, m.def]));
  assert.equal(durs(by.alice), 'tween0.5 wait0.5 preset0.25 wait0.75');
  assert.equal(durs(by.bob), 'tween0.5 wait1.5');
  assert.equal(durs(by.camera), 'wait1.5 tween0.5');
  assert.equal(by.alice.name, 'c:alice');
  for (const d of Object.values(by)) assert.equal(transformToAnim(d).dur, 2, 'as long as the whole thing');
});

test('buildChoreography: lines may come in any order; a line that starts while its actor is busy is a problem and is left out', () => {
  const b = build([1, 'alice', 'hop 0.25s'], [0, 'alice', 'x=0.1 0.5s'], [0.3, 'alice', 'nod 0.2s']);
  assert.equal(b.problems.length, 1);
  assert.match(b.problems[0].message, /alice is still busy at 0.3s .* until 0.5s/);
  assert.equal(durs(b.members[0].def), 'tween0.5 wait0.5 preset0.25');
});

test('a choreography compiles to one generated transform per actor and perform names it', () => {
  const p = program('define alice "Alice"', 'define bob "Bob"', 'choreography meet:', '    0s alice: x=0.1 0.5s', '    0.2s bob: nod', '    1s camera: scale=1.05 0.4s',
    'label start:', '  scene a', '  show alice at left', '  show bob at right', '  perform meet', '  "hi"');
  assert.deepEqual(errors(p), []);
  assert.deepEqual(warnings(p), []);
  assert.deepEqual(p.choreographies.meet.map(m => m.target), ['alice', 'bob', 'camera']);
  for (const m of p.choreographies.meet) assert.ok(p.transforms[m.transform], m.transform);
  assert.ok(p.ops.some(o => o.op === 'perform' && o.name === 'meet'));
});

test('perform plays every actor\'s part as an animate, all but the last without waiting', async () => {
  const p = program('define alice "Alice"', 'define bob "Bob"', 'choreography meet:', '    0s alice: x=0.1 0.5s', '    0s bob: nod', '    1s camera: scale=1.05 0.4s',
    'label start:', '  scene a', '  show alice at left', '  show bob at right', '  perform meet', '  "hi"');
  const r = new NullRenderer();
  const seen = [];
  const apply = r.apply.bind(r);
  r.apply = async (op, state) => { if (op.op === 'animate') seen.push({ char: op.char, name: op.name, loop: op.loop }); return apply(op, state); };
  await new Runtime(p, r).start();
  assert.deepEqual(seen, [{ char: 'alice', name: 'meet:alice', loop: false }, { char: 'bob', name: 'meet:bob', loop: false }, { char: 'camera', name: 'meet:camera', loop: false }]);
});

test('choreography mistakes are reported', () => {
  const tail = ['label start:', '  scene a', '  "hi"'];
  assert.match(errors(program(...tail.slice(0, 2), '  perform nope', '  "hi"'))[0] ?? '', /Unknown choreography "nope"/);
  assert.match(errors(program('choreography a:', '    0s alice: nod', 'choreography a:', '    0s alice: nod', ...tail))[0] ?? '', /defined twice/);
  assert.ok(errors(program('choreography a:', '    alice: nod', ...tail)).some(m => /Use: <time>/.test(m)));
  assert.ok(errors(program('choreography a:', '    0s alice: parallel:', ...tail)).length > 0, 'a block step is refused');
  assert.ok(errors(program('choreography a:', '    0s alice: repeat', ...tail)).some(m => /tween, wait or preset/.test(m)));
  assert.ok(errors(program('choreography a:', '    0.5 alice: nod', ...tail)).some(m => /needs its unit: write 0.5s/.test(m)), 'a time needs its unit');
  assert.ok(errors(program('define alice "A"', 'choreography a:', '    0s alice: x=0.1 1s', '    0.5s alice: nod', ...tail)).some(m => /still busy/.test(m)));
  assert.ok(warnings(program('choreography a:', '    0s nobody: nod', ...tail)).some(m => /nobody/.test(m)), 'an unknown actor is reported');
  assert.deepEqual(errors(program('choreography a:', '    0s camera: shake 1s', ...tail)), [], 'the camera is a valid actor');
});
