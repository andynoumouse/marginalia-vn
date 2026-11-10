// Named stage positions: built in plus game.json "positions", resolved while compiling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, namedPositions, getCompletions, checkGame, showLine } from '../../dist/engine/src/index.js';
import { errors } from './helpers.mjs';

const script = line => [{ file: 't.vn', text: `define al "Al"\nlabel start:\n  ${line}\n` }];
const game = { positions: { farleft: 0.08, leftcenter: 0.35 } };

test('namedPositions: built ins, project names, invalid entries dropped, built ins replaceable', () => {
  assert.deepEqual(namedPositions(undefined), { left: { x: 0.2 }, center: { x: 0.5 }, right: { x: 0.8 } });
  const p = namedPositions({ positions: { farleft: 0.08, 'bad name': 1, fade: 0.4, str: 'x', left: 0.25 } });
  assert.deepEqual(p, { left: { x: 0.25 }, center: { x: 0.5 }, right: { x: 0.8 }, farleft: { x: 0.08 } });
  assert.deepEqual(namedPositions({ positions: [1, 2] }), namedPositions(null));
});

test('custom positions resolve in show, move and camera; without the table they are errors', () => {
  const pos = namedPositions(game);
  const p = compile(script('show al at farleft\n  move al to leftcenter 0.5s\n  camera pan farleft'), pos);
  assert.deepEqual(errors(p), []);
  assert.equal(p.ops.find(o => o.op === 'show').x, 0.08);
  assert.equal(p.ops.find(o => o.op === 'move').x, 0.35);
  assert.equal(p.ops.find(o => o.op === 'camera').x, 0.08);
  assert.match(errors(compile(script('show al at farleft')))[0], /Unknown position "farleft"/);
  assert.match(errors(compile(script('show al at nowhere'), pos))[0], /farleft/); // the message lists the names
  assert.equal(compile(script('show al at toString'), pos).diagnostics.length, 1);   // no inherited object keys
});

test('completions offer the project positions after at and to', () => {
  const p = compile(script('end'), namedPositions(game));
  for (const prefix of ['  show al at ', '  move al to ']) {
    const labels = getCompletions(p, prefix).map(s => s.label);
    assert.deepEqual(labels, ['left', 'center', 'right', 'farleft', 'leftcenter']);
  }
});

test('checkGame warns about unusable positions', () => {
  const msgs = checkGame({ positions: { ok: 0.5, 'a b': 0.1, nowait: 0.2, far: 'x' } }, { files: [] }).map(d => d.message);
  assert.equal(msgs.length, 3);
  assert.deepEqual(checkGame(game, { files: [] }), []);
});

test('showLine names a custom position when it matches', () => {
  const at = x => ({ x, y: 0, scale: 1, flip: false });
  assert.equal(showLine('al', null, at(0.08), namedPositions(game)), 'show al at farleft');
  assert.equal(showLine('al', null, at(0.08)), 'show al at 0.08');
});

test('a position can carry a height: used by show and move unless the line has its own y=', () => {
  const pos = namedPositions({ positions: { balcony: { x: 0.7, y: -0.15 }, bad: { y: 1 }, worse: { x: 0.5, y: 'up' } } });
  assert.deepEqual(pos.balcony, { x: 0.7, y: -0.15 });
  assert.ok(!('bad' in pos) && !('worse' in pos));
  const ops = line => compile(script(line), pos).ops.find(o => o.op === 'show' || o.op === 'move');
  assert.equal(ops('show al at balcony').y, -0.15);
  assert.equal(ops('show al at balcony y=0.1').y, 0.1);
  assert.equal(ops('show al y=0.1 at balcony').y, 0.1);
  assert.equal(ops('show al at left').y, undefined);
  assert.equal(ops('move al to balcony 0.5s').y, -0.15);
  assert.equal(ops('move al to balcony y=0 0.5s').y, 0);
  assert.equal(ops('move al to left 0.5s').y, null);
  const cam = compile(script('camera pan balcony'), pos).ops.find(o => o.op === 'camera');
  assert.equal(cam.x, 0.7);
  assert.equal(cam.y, 0.5); // the camera's y is a point on the stage, not a sprite offset
  assert.equal(checkGame({ positions: { bad: { y: 1 }, worse: { x: 0.5, y: 'up' }, ok: { x: 0.2 } } }, { files: [] }).length, 2);
});

test('showLine uses a named position only when x and height both match', () => {
  const pos = namedPositions({ positions: { balcony: { x: 0.7, y: -0.15 } } });
  const at = (x, y) => ({ x, y, scale: 1, flip: false });
  assert.equal(showLine('al', null, at(0.7, -0.15), pos), 'show al at balcony');
  assert.equal(showLine('al', null, at(0.7, 0), pos), 'show al at 0.7');
  assert.equal(showLine('al', null, at(0.7, 0.1), pos), 'show al at 0.7 y=0.1');
  assert.equal(showLine('al', null, at(0.2, 0), pos), 'show al at left');
});

test('game.json anchors add names for anchor=, bad entries are ignored and warned about', async () => {
  const { namedAnchors, anchorToken } = await import('../../dist/engine/src/index.js');
  const anchors = namedAnchors({ anchors: { waist: [0.5, 0.6], bad: [1], worse: ['a', 'b'], head: [0.5, 0.2] } });
  assert.deepEqual(anchors.waist, [0.5, 0.6]);
  assert.deepEqual(anchors.head, [0.5, 0.2]);
  assert.ok(!('bad' in anchors) && !('worse' in anchors));
  const prog = compile(script('show al anchor=waist'), undefined, anchors);
  assert.deepEqual(prog.ops.find(o => o.op === 'show').anchor, [0.5, 0.6]);
  assert.ok(compile(script('show al anchor=waist')).diagnostics.length > 0); // unknown without the table
  assert.match(compile(script('show al anchor=nope'), undefined, anchors).diagnostics[0].message, /waist/);
  assert.ok(getCompletions(prog, 'show al ').some(s => s.label === 'anchor=waist'));
  assert.equal(anchorToken([0.5, 0.6], anchors), 'waist');
  assert.equal(showLine('al', null, { x: 0.5, y: 0, scale: 1, flip: false, anchor: [0.5, 0.6] }, undefined, anchors), 'show al at center anchor=waist');
  assert.equal(checkGame({ anchors: { bad: [1], waist: [0.5, 0.6] } }, { files: [] }).length, 1);
});
