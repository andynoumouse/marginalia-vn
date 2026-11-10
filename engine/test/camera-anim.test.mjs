import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AnimPlayer, applyToState, compile, emptyState, ANIMS } from '../../dist/engine/src/index.js';
import { errors } from './helpers.mjs';

const animate = (over = {}) => ({ op: 'animate', char: 'camera', name: 'shake', dur: null, loop: true, strength: 1, part: null, ...over });
const prog = text => compile([{ file: 't.vn', text }]);

test('AnimPlayer: a loop runs on and replaces the previous loop, a one-shot calls done and returns to rest, stop ends loops', () => {
  const p = new AnimPlayer(() => ({}));
  assert.equal(p.step(0.1), null, 'nothing running is rest');
  assert.equal(p.start('nope', null, 1, true), false);
  assert.equal(p.active, false);
  assert.equal(p.start('shake', 0.2, 1, true), true);
  p.start('bob', 0.2, 1, true);
  const o = p.step(0.05);
  assert.ok(o && p.running);
  let done = 0;
  p.start('hop', 0.1, 1, false, () => { done++; });
  p.step(0.2);
  assert.equal(done, 1);
  p.stop();
  assert.equal(p.running, false);
  assert.equal(p.step(0.1), null);
});

test('AnimPlayer: strength scales the offset and two animations add up', () => {
  const at = (strength, names) => {
    const p = new AnimPlayer(() => ({}));
    for (const n of names) p.start(n, 1, strength, true);
    return p.step(0.25);
  };
  const one = at(1, ['shake']), two = at(2, ['shake']);
  assert.ok(Math.abs(two.dx - one.dx * 2) < 1e-9);
  const sum = at(1, ['shake', 'sway']), a = at(1, ['shake']), b = at(1, ['sway']);
  assert.ok(Math.abs(sum.dx - (a.dx + b.dx)) < 1e-9 && Math.abs(sum.rot - (a.rot + b.rot)) < 1e-9);
  assert.ok(ANIMS.shake && ANIMS.sway);
});

test('animate camera: the loop lives in the state, survives a pan, and a scene ends it', () => {
  const s = emptyState();
  applyToState(s, animate({ strength: 0.5 }));
  assert.deepEqual(s.camera.anim, { name: 'shake', dur: null, strength: 0.5, part: null });
  applyToState(s, { op: 'camera', zoom: 2, x: 0.3, y: 0.4, dur: 0, ease: 'inout' });
  assert.equal(s.camera.anim.name, 'shake', 'a zoom keeps it');
  applyToState(s, { op: 'camera', zoom: 1, x: 0.5, y: 0.5, roll: 0, dur: 0, ease: 'inout' });
  assert.equal(s.camera.anim.name, 'shake', 'and so does a reset');
  applyToState(s, animate({ name: null, loop: false }));
  assert.ok(!('anim' in s.camera));
  applyToState(s, animate());
  applyToState(s, { op: 'scene', bg: 'a', transition: 'cut', dur: 0, ease: 'inout' });
  assert.deepEqual(s.camera, { zoom: 1, x: 0.5, y: 0.5 });
});

test('animate camera ... auto attaches and detaches an automatic transform in the state', () => {
  const s = emptyState();
  applyToState(s, animate({ name: 'rumble', loop: false, auto: 'on' }));
  assert.deepEqual(s.camera.autos, ['rumble']);
  applyToState(s, animate({ name: 'rumble', loop: false, auto: 'off' }));
  assert.ok(!('autos' in s.camera));
});

test('animate camera: a one-shot is not kept; the camera is a valid target and a character or image of that name is not', () => {
  const s = emptyState();
  applyToState(s, animate({ loop: false }));
  assert.ok(!s.camera.anim);
  assert.deepEqual(errors(prog('label start:\n  scene a\n  animate camera shake loop\n  animate camera stop\n  "hi"\n')), []);
  assert.match(errors(prog('define camera "Cam"\nlabel start:\n  scene a\n  animate camera shake\n  "hi"\n'))[0] ?? '', /is the camera for animate, but is also a character/);
  assert.match(errors(prog('label start:\n  scene a\n  image show camera cg\n  animate camera shake\n  "hi"\n'))[0] ?? '', /also an image/);
  assert.match(errors(prog('label start:\n  scene a\n  animate camera shake part=hair\n  "hi"\n'))[0] ?? '', /no parts/);
});
