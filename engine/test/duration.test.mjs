import { test } from 'node:test';
import assert from 'node:assert/strict';
import { durationOf, readDuration, compile, parseRich } from '../../dist/engine/src/index.js';
import { parseEnter } from '../../dist/engine/src/screen-anim.js';

const errorsOf = body => compile([{ file: 't.vn', text: `define alice "A"\nlabel start:\n  show alice\n${body}\n  end\n` }]).diagnostics.filter(d => d.severity === 'error').map(d => d.message);
const opOf = (body, op) => compile([{ file: 't.vn', text: `define alice "A"\nlabel start:\n  show alice\n${body}\n  end\n` }]).ops.find(o => o.op === op);

test('durationOf reads s and ms; anything else is not a duration', () => {
  assert.equal(durationOf('2s'), 2);
  assert.equal(durationOf('0.25s'), 0.25);
  assert.equal(durationOf('.5s'), 0.5);
  assert.equal(durationOf('250ms'), 0.25);
  for (const t of ['2', '-1s', '2 s', 's', '2sec', '1e3ms', undefined]) assert.equal(durationOf(t), null, String(t));
  assert.throws(() => readDuration('2', 'a duration'), /needs its unit: write 2s \(or 2000ms\), not 2/);
  assert.throws(() => readDuration('-1s', 'a duration'), /cannot be negative/);
  assert.throws(() => readDuration('soon', 'a duration'), /Expected a duration like 0.5s or 500ms, not "soon"/);
});

test('every duration slot takes s or ms and refuses a bare number (docs/design/time-units.md)', () => {
  const slots = [
    ['  scene bg fade 2', 'scene'], ['  show alice fade 0.3', 'show'], ['  hide alice fade 0.3', 'hide'], ['  move alice to left 0.5', 'move'],
    ['  shake alice 0.3', 'shake'], ['  hop alice 0.25', 'hop'], ['  animate alice nod 2', 'animate'], ['  animate alice look_x=1 over 0.4', 'param'],
    ['  burst sparkle 1', 'burst'], ['  flash #ffffff 0.4', 'flash'], ['  tint #ffcc88 0.5 1', 'tint'], ['  camera zoom 1.3 1', 'camera'],
    ['  weather rain 0.6 2', 'weather'], ['  wind right 1 2', 'wind'], ['  filter night 1 1', 'filter'], ['  music stop fade 2', 'music'],
    ['  sound stop fade 1', 'sound'], ['  wait 1', 'wait'], ['  image move logo to 10,10 0.5', 'image'],
  ];
  for (const [line] of slots) assert.ok(errorsOf(line).some(m => /needs its unit/.test(m)), `bare: ${line}`);
  for (const [line, op] of slots) {
    const withUnit = line.replace(/(\d+(?:\.\d+)?)$/, '$1s').replace(/ over (\S+)$/, ' over $1');
    assert.deepEqual(errorsOf(withUnit), [], withUnit);
    assert.ok(opOf(withUnit, op), `${withUnit} compiles to ${op}`);
  }
});

test('the unit says which number is the time: a level and a duration side by side', () => {
  assert.deepEqual([opOf('  tint #ffcc88 0.5 1s', 'tint').strength, opOf('  tint #ffcc88 0.5 1s', 'tint').dur], [0.5, 1]);
  assert.deepEqual([opOf('  tint #ffcc88 2s', 'tint').strength, opOf('  tint #ffcc88 2s', 'tint').dur], [0.4, 2], 'a duration alone keeps the default strength');
  assert.equal(opOf('  wait 1500ms', 'wait').dur, 1.5);
  assert.equal(opOf('  move alice to left 250ms', 'move').dur, 0.25);
});

test('shake with a duration first shakes the screen', () => {
  assert.deepEqual([opOf('  shake 0.4s', 'shake').target, opOf('  shake 0.4s', 'shake').dur], ['screen', 0.4]);
  assert.ok(errorsOf('  shake 0.4').some(m => /needs its unit/.test(m)), 'not a character named 0.4');
});

test('text pauses and screen animations take the unit too', () => {
  assert.deepEqual(parseRich('A{pause=0.5s}B').map(s => s.kind === 'pause' ? s.seconds : s.text), ['A', 0.5, 'B']);
  assert.deepEqual(parseRich('A{pause=250ms}B').map(s => s.kind === 'pause' ? s.seconds : s.text), ['A', 0.25, 'B']);
  assert.ok(errorsOf('  alice: Wait{pause=0.5} for it.').some(m => /needs its unit/.test(m)), 'a bare pause is an error, not shown text');
  assert.deepEqual([parseEnter('fade 0.3s delay 100ms').dur, parseEnter('fade 0.3s delay 100ms').delay], [0.3, 0.1]);
  assert.throws(() => parseEnter('fade 0.3'), /needs its unit/);
});
