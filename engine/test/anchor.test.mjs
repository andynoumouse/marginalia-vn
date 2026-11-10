// Sprite anchors: `anchor=` on show and move.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, parseAnchor, anchorOffset, getCompletions, Runtime, NullRenderer } from '../../dist/engine/src/index.js';
import { errors } from './helpers.mjs';

const script = line => [{ file: 't.vn', text: `define al "Al"\nlabel start:\n  ${line}\n  end\n` }];

test('parseAnchor: names, fractions and errors that list the names', () => {
  assert.deepEqual(parseAnchor('feet'), [0.5, 1]);
  assert.deepEqual(parseAnchor('center'), [0.5, 0.5]);
  assert.deepEqual(parseAnchor('head'), [0.5, 0.1]);
  assert.deepEqual(parseAnchor('0.25,.3'), [0.25, 0.3]);
  assert.deepEqual(parseAnchor('-0.5,1.5'), [-0.5, 1.5]);
  assert.throws(() => parseAnchor('middle'), /feet, center, head, top/);
  assert.throws(() => parseAnchor('toString'), /takes/);
  assert.throws(() => parseAnchor('0.5'), /takes/);
});

test('anchorOffset: zero at the feet, relative to the feet otherwise', () => {
  assert.deepEqual(anchorOffset([0.5, 1], 200, 400), { x: 0, y: 0 });
  assert.deepEqual(anchorOffset([0.5, 0.5], 200, 400), { x: 0, y: -200 });
  assert.deepEqual(anchorOffset([0, 0], 200, 400), { x: -100, y: -400 });
});

test('show and move parse anchor= in any order; a move with only anchor= is valid', () => {
  const p = compile(script('show al at left anchor=center scale=1.2\n  move al anchor=0.5,0.3 rot=15 0.4s\n  move al anchor=head'));
  assert.deepEqual(errors(p), []);
  const sh = p.ops.find(o => o.op === 'show'), mv = p.ops.filter(o => o.op === 'move');
  assert.deepEqual(sh.anchor, [0.5, 0.5]);
  assert.deepEqual([mv[0].anchor, mv[0].rotation, mv[0].dur], [[0.5, 0.3], 15, 0.4]);
  assert.deepEqual(mv[1].anchor, [0.5, 0.1]);
  assert.equal(compile(script('show al')).ops.find(o => o.op === 'show').anchor, undefined);
  assert.equal(compile(script('show al\n  move al scale=2')).ops.find(o => o.op === 'move').anchor, null);
});

test('bad anchors are parse errors', () => {
  assert.match(errors(compile(script('show al anchor=middle')))[0], /feet, center, head, top/);
  assert.match(errors(compile(script('show al\n  move al anchor=1')))[0], /anchor= takes/);
});

test('runtime: fresh sprites stand on their feet, show keeps the anchor unless given, move changes it', async () => {
  const run = async line => { const rt = new Runtime(compile(script(line)), new NullRenderer()); await rt.start(); return rt.state.sprites[0].anchor; };
  assert.deepEqual(await run('show al'), [0.5, 1]);
  assert.deepEqual(await run('show al anchor=center'), [0.5, 0.5]);
  assert.deepEqual(await run('show al anchor=center\n  show al at left'), [0.5, 0.5]);
  assert.deepEqual(await run('show al anchor=center\n  show al anchor=feet'), [0.5, 1]);
  assert.deepEqual(await run('show al\n  move al rot=15 anchor=head 0.4s'), [0.5, 0.1]);
  const rt = new Runtime(compile(script('show al anchor=top')), new NullRenderer());
  await rt.start();
  rt.state.sprites[0].anchor[0] = 0; // the state owns its array: the compiled op is not shared
  assert.deepEqual(rt.program.ops.find(o => o.op === 'show').anchor, [0.5, 0]);
});

test('completions offer anchor= names after show and move', () => {
  const p = compile(script('end'));
  for (const cmd of ['show al ', 'move al ']) {
    const labels = getCompletions(p, '  ' + cmd).map(s => s.label);
    assert.ok(labels.includes('anchor=center'), cmd);
  }
});
