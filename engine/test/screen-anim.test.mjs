import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, resolveScreen, SCREEN_CLAUSE_WORDS } from '../../dist/engine/src/index.js';

const errors = p => p.diagnostics.filter(d => d.severity === 'error').map(d => d.message);
const TAIL = '\nlabel start:\n  show screen s\n  end\n';
const build = body => compile([{ file: 's.vn', text: `screen s:\n${body}${TAIL}` }]);
const view = (p, vars = {}) => resolveScreen(p.screens.s, vars, { items: {}, text: (_id, raw) => raw });

test('on enter and loop parse on an element, with defaults and options', () => {
  const p = build('  text at 10,10 "Hi" on enter slide left 0.5 delay 0.2 distance=120 loop glow 2 strength=2\n  image "a.png" at 0,0 on enter fade\n');
  assert.deepEqual(errors(p), []);
  assert.deepEqual(p.screens.s.body[0].anim, {
    enter: { fx: 'slide', dur: 0.5, delay: 0.2, stagger: 0, dir: 'left', dist: 120 },
    loop: { fx: 'glow', dur: 2, strength: 2 },
  });
  assert.deepEqual(p.screens.s.body[1].anim.enter, { fx: 'fade', dur: 0.3, delay: 0, stagger: 0, dir: 'down', dist: 80 });
});

test('the clauses sit beside if, enabled, on click and a multi-line element', () => {
  const p = build('  state on = true\n  button go at 10,10 "Go" on click start on enter pop 0.3 enabled on if on\n  text at 5,5 "X"\n    on enter zoom\n    loop pulse\n');
  assert.deepEqual(errors(p), []);
  const [b, t] = p.screens.s.body;
  assert.equal(b.on.click, 'start');
  assert.equal(b.anim.enter.fx, 'pop');
  assert.ok(b.cond && b.enabled);
  assert.equal(t.anim.enter.fx, 'zoom');
  assert.equal(t.anim.loop.fx, 'pulse');
  assert.ok(SCREEN_CLAUSE_WORDS.includes('loop'));
});

test('a variable called loop in a condition is not taken for the clause', () => {
  const p = build('  state loop = 1\n  text at 1,1 "A" if loop > 0\n');
  assert.deepEqual(errors(p), []);
  assert.equal(p.screens.s.body[0].anim, undefined);
});

test('bad animation clauses are refused with a message', () => {
  const msg = body => errors(build(body))[0] ?? '';
  assert.match(msg('  text at 1,1 "A" on enter swoosh\n'), /on enter needs an effect/);
  assert.match(msg('  text at 1,1 "A" on enter slide\n'), /slide needs a direction/);
  assert.match(msg('  text at 1,1 "A" on enter fade distance=5\n'), /distance= goes with slide/);
  assert.match(msg('  text at 1,1 "A" on enter fade 0\n'), /above 0/);
  assert.match(msg('  text at 1,1 "A" on enter fade on enter pop\n'), /appears twice/);
  assert.match(msg('  text at 1,1 "A" loop pulse 1 strength=0\n'), /above 0/);
  assert.match(msg('  text at 1,1 "A" on exit fade stagger 0.1\n'), /stagger goes with on enter/);
  assert.match(msg('  hotspot h at 1,1 size 5,5 "H" on exit zoom\n'), /on exit zoom/);
  assert.match(msg('  text at 1,1 "A" on enter fade stagger 0.1\n'), /stagger belongs on an each line/);
  assert.match(msg('  panel at 0,0 size 10,10 on enter fade stagger 0.1:\n    text at 1,1 "A"\n'), /stagger belongs on an each line/);
});

test('a hotspot can only fade or glow', () => {
  const ok = build('  hotspot door at 0,0 size 10,10 "Door" on enter fade loop glow\n');
  assert.deepEqual(errors(ok), []);
  assert.match(errors(build('  hotspot door at 0,0 size 10,10 "Door" on enter slide up\n'))[0], /hit area does not move/);
  assert.match(errors(build('  hotspot door at 0,0 size 10,10 "Door" loop pulse\n'))[0], /hit area does not move/);
});

test('the view carries the effect of the element and of the containers around it', () => {
  const p = build('  panel at 100,100 size 400,300 on enter fade 0.4:\n    text at 10,10 "In the panel"\n    text at 10,50 "Own" on enter pop\n  text at 0,0 "Plain"\n');
  assert.deepEqual(errors(p), []);
  const [panel, inPanel, own, plain] = view(p).parts;
  assert.equal(panel.anim.enter.fx, 'fade');
  assert.equal(inPanel.anim.enter.fx, 'fade');
  assert.equal(inPanel.anim.enter.dur, 0.4);
  assert.equal(own.anim.enter.fx, 'pop');
  assert.equal(plain.anim, undefined);
  assert.equal(new Set([panel, inPanel, own].map(x => x.anim.key)).size, 3);
});

test('each staggers its entries and keys them by entry, so a new entry does not replay the others', () => {
  const p = build('  each items as it at 0,0 step 0,40 on enter slide right 0.2 delay 0.1 stagger 0.05:\n    text at 0,0 "[it]"\n');
  assert.deepEqual(errors(p), []);
  const a = view(p, { items: ['x', 'y', 'z'] }).parts;
  assert.deepEqual(a.map(x => x.anim.enter.delay.toFixed(2)), ['0.10', '0.15', '0.20']);
  assert.ok(a.every(x => x.anim.enter.stagger === undefined));
  const b = view(p, { items: ['w', 'x', 'y', 'z'] }).parts;
  assert.equal(b[1].anim.key, a[0].anim.key); // x is still x
  assert.notEqual(b[0].anim.key, a[0].anim.key);
});

test('a layout hands its effect to the elements it places', () => {
  const p = build('  column anchor center gap 10 loop bob:\n    text "A"\n    text "B" loop sway\n');
  assert.deepEqual(errors(p), []);
  const parts = view(p).parts;
  assert.deepEqual(parts.map(x => x.anim.loop.fx), ['bob', 'sway']);
});

test('a hotspot inside an animated container gets only what it can use', () => {
  const p = build('  panel at 0,0 size 50,50 on enter slide up loop pulse:\n    hotspot door at 0,0 size 10,10 "Door"\n');
  assert.deepEqual(errors(p), []);
  const door = view(p).parts[1];
  assert.equal(door.anim.enter.fx, 'fade');
  assert.equal(door.anim.loop, undefined);
});

test('elements without a clause carry no anim field', () => {
  const p = build('  text at 1,1 "A"\n  button b at 1,1 "B"\n');
  assert.ok(view(p).parts.every(x => !('anim' in x)));
});


test('on exit parses, is inherited from a container and rides on the part', () => {
  const p = build('  panel at 0,0 size 50,50 on exit slide left 0.4 delay 0.1:\n    text at 1,1 "A"\n    text at 2,2 "B" on exit fade\n');
  assert.deepEqual(errors(p), []);
  const parts = view(p).parts;
  assert.deepEqual(parts.find(x => x.kind === 'text' && x.text === 'A').anim.exit, { fx: 'slide', dur: 0.4, delay: 0.1, dir: 'left', dist: 80 });
  assert.equal(parts.find(x => x.kind === 'text' && x.text === 'B').anim.exit.fx, 'fade');
});
