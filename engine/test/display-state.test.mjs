import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyToState, emptyState, newSprite } from '../../dist/engine/src/index.js';

const show = (char, over = {}) => ({ op: 'show', char, pose: 'neutral', more: [], overrides: {}, x: null, ...over });
const move = (char, over = {}) => ({ op: 'move', char, x: null, y: null, scale: null, rotation: null, alpha: null, flip: null, anchor: null, ...over });
const stateWith = (...ops) => { const s = emptyState(); for (const o of ops) applyToState(s, o); return s; };
const chars = s => s.sprites.map(x => x.char);

test('show adds a sprite with defaults, and a second show keeps its place and fields', () => {
  const s = stateWith(show('ann', { x: 0.25, scale: 2, flip: true, overrides: { eyes: 'closed' } }));
  assert.deepEqual(s.sprites[0], { ...newSprite('ann'), pose: 'neutral', x: 0.25, scale: 2, flip: true, overrides: { eyes: 'closed' } });
  applyToState(s, show('ann', { pose: null, overrides: { mouth: 'open' } }));
  assert.equal(s.sprites.length, 1);
  assert.equal(s.sprites[0].pose, 'neutral', 'a show without a pose keeps the pose');
  assert.deepEqual(s.sprites[0].overrides, { eyes: 'closed', mouth: 'open' });
  assert.equal(s.sprites[0].x, 0.25, 'and the place');
  applyToState(s, show('ann', { pose: 'sad', more: ['blush'], overrides: {} }));
  assert.deepEqual([s.sprites[0].pose, s.sprites[0].more, s.sprites[0].overrides], ['sad', ['blush'], {}], 'a new pose replaces the overrides');
});

test('show order: back, front and behind (someone not on stage changes nothing)', () => {
  const s = stateWith(show('a'), show('b'), show('c'));
  applyToState(s, show('c', { order: 'back' }));
  assert.deepEqual(chars(s), ['c', 'a', 'b']);
  applyToState(s, show('c', { order: 'front' }));
  assert.deepEqual(chars(s), ['a', 'b', 'c']);
  applyToState(s, show('c', { behind: 'a' }));
  assert.deepEqual(chars(s), ['c', 'a', 'b']);
  applyToState(s, show('b', { behind: 'ghost' }));
  assert.deepEqual(chars(s), ['c', 'a', 'b']);
});

test('hide, and move changing only the fields it names; a move of someone absent does nothing', () => {
  const s = stateWith(show('a'), show('b'));
  applyToState(s, move('a', { x: 0.9, rotation: 15, flip: true, anchor: [0, 0] }));
  assert.deepEqual([s.sprites[0].x, s.sprites[0].rotation, s.sprites[0].flip, s.sprites[0].anchor, s.sprites[0].scale], [0.9, 15, true, [0, 0], 1]);
  applyToState(s, move('ghost', { x: 0 }));
  applyToState(s, { op: 'hide', char: 'a' });
  assert.deepEqual(chars(s), ['b']);
});

test('param merges into the sprite parameters; animate keeps only looping animations', () => {
  const s = stateWith(show('a'));
  applyToState(s, { op: 'param', char: 'a', params: { turn: 5 }, poses: [] });
  applyToState(s, { op: 'param', char: 'a', params: { sway: 2 }, poses: [] });
  assert.deepEqual(s.sprites[0].params, { turn: 5, sway: 2 });
  applyToState(s, { op: 'animate', char: 'a', name: 'bob', loop: true, dur: 1, strength: 1 });
  assert.equal(s.sprites[0].anim.name, 'bob');
  applyToState(s, { op: 'animate', char: 'a', name: 'nod', loop: false, dur: 1, strength: 1 });
  assert.equal(s.sprites[0].anim.name, 'bob', 'a one-shot leaves no lasting state');
  applyToState(s, { op: 'animate', char: 'a', name: null, loop: false, dur: 0, strength: 1 });
  assert.equal(s.sprites[0].anim, null);
});

test('scene resets sprites, tint, camera, weather and filter, and keeps only images and HUD marked keep', () => {
  const s = stateWith(show('a'), { op: 'tint', color: '#f00', strength: 0.5 }, { op: 'camera', zoom: 2, x: 0.1, y: 0.2 },
    { op: 'weather', kind: 'rain', intensity: 1 }, { op: 'filter', name: 'sepia', strength: 1 },
    { op: 'image', action: 'show', name: 'logo', file: 'logo.png', keep: true }, { op: 'image', action: 'show', name: 'tmp', file: 'tmp.png' });
  s.hud = [{ name: 'a', keep: true }, { name: 'b', keep: false }];
  applyToState(s, { op: 'scene', bg: 'park' });
  assert.deepEqual([s.bg, s.sprites, s.tint, s.camera, s.weather, s.filter], ['park', [], null, { zoom: 1, x: 0.5, y: 0.5 }, null, null]);
  assert.deepEqual(s.images.map(i => i.name), ['logo']);
  assert.deepEqual(s.hud.map(h => h.name), ['a']);
});

test('image: show creates with defaults, a later show and a move change named fields, hide removes', () => {
  const s = stateWith({ op: 'image', action: 'show', name: 'x', file: 'a.png', x: 5 });
  assert.deepEqual(s.images[0], { name: 'x', file: 'a.png', x: 5, y: 0, scale: 1, rotation: 0, alpha: 1, anchor: [0, 0], layer: 0, fixed: false, keep: false });
  applyToState(s, { op: 'image', action: 'show', name: 'x', file: 'b.png', layer: 3, fixed: true });
  assert.deepEqual([s.images[0].file, s.images[0].x, s.images[0].layer, s.images[0].fixed], ['b.png', 5, 3, true]);
  applyToState(s, { op: 'image', action: 'move', name: 'x', x: null, y: 7, scale: 2, rotation: null, alpha: null, anchor: null });
  assert.deepEqual([s.images[0].y, s.images[0].scale, s.images[0].x], [7, 2, 5]);
  applyToState(s, { op: 'image', action: 'move', name: 'ghost', x: 1, y: null, scale: null, rotation: null, alpha: null, anchor: null });
  assert.equal(s.images.length, 1);
  applyToState(s, { op: 'image', action: 'hide', name: 'x' });
  assert.deepEqual(s.images, []);
});

test('music: play, pause and resume, stop; sound loops stack and stop by name or all', () => {
  const s = stateWith({ op: 'music', action: 'play', name: 'theme', loop: true });
  assert.deepEqual([s.music, s.musicLoop], ['theme', true]);
  applyToState(s, { op: 'music', action: 'pause' });
  assert.equal(s.musicPaused, true);
  applyToState(s, { op: 'music', action: 'resume' });
  assert.ok(!('musicPaused' in s));
  applyToState(s, { op: 'music', action: 'stop' });
  assert.deepEqual([s.music, s.musicLoop], [null, false]);
  applyToState(s, { op: 'music', action: 'pause' });
  assert.ok(!s.musicPaused, 'pausing with no music does nothing');
  applyToState(s, { op: 'sound', action: 'loop', name: 'rain' });
  applyToState(s, { op: 'sound', action: 'loop', name: 'rain' });
  applyToState(s, { op: 'sound', action: 'loop', name: 'wind' });
  assert.deepEqual(s.ambience, ['rain', 'wind']);
  applyToState(s, { op: 'sound', action: 'stop', name: 'rain' });
  assert.deepEqual(s.ambience, ['wind']);
  applyToState(s, { op: 'sound', action: 'stop' });
  assert.ok(!('ambience' in s));
});

test('tint, weather and filter set or clear; camera keeps the zoom when none is given; behaviors and focus toggle', () => {
  const s = stateWith({ op: 'tint', color: '#00f', strength: 0.3 }, { op: 'weather', kind: 'snow', intensity: 2 }, { op: 'filter', name: 'blur', strength: 4 });
  assert.deepEqual([s.tint, s.weather, s.filter], [{ color: '#00f', strength: 0.3 }, { kind: 'snow', intensity: 2 }, { name: 'blur', strength: 4 }]);
  applyToState(s, { op: 'tint', color: null }); applyToState(s, { op: 'weather', kind: null }); applyToState(s, { op: 'filter', name: null });
  assert.deepEqual([s.tint, s.weather, s.filter], [null, null, null]);
  applyToState(s, { op: 'camera', zoom: 3, x: 0.2, y: 0.3 });
  applyToState(s, { op: 'camera', x: 0.6, y: 0.7 });
  assert.deepEqual(s.camera, { zoom: 3, x: 0.6, y: 0.7 });
  applyToState(s, { op: 'behaviors', on: false }); applyToState(s, { op: 'focus', on: false });
  assert.deepEqual([s.behaviors, s.focus], [false, false]);
  applyToState(s, { op: 'behaviors', on: true }); applyToState(s, { op: 'focus', on: true });
  assert.ok(!('behaviors' in s) && !('focus' in s));
});

test('one-shot effects leave the state as it was', () => {
  const s = stateWith(show('a'));
  const before = JSON.stringify(s);
  for (const op of [{ op: 'flash' }, { op: 'shake', target: 'screen', dur: 1, strength: 1 }, { op: 'hop', char: 'a' }, { op: 'wait', seconds: 1 }]) applyToState(s, op);
  assert.equal(JSON.stringify(s), before);
});

test('camera roll keeps the zoom and pivot, survives a pan, and reset clears it', () => {
  const s = stateWith({ op: 'camera', zoom: 2, x: 0.3, y: 0.4 }, { op: 'camera', zoom: null, x: null, y: null, roll: 6 });
  assert.deepEqual(s.camera, { zoom: 2, x: 0.3, y: 0.4, roll: 6 });
  applyToState(s, { op: 'camera', zoom: null, x: 0.7, y: 0.5 });
  assert.deepEqual(s.camera, { zoom: 2, x: 0.7, y: 0.5, roll: 6 }, 'a pan keeps the roll');
  applyToState(s, { op: 'camera', zoom: 1, x: 0.5, y: 0.5, roll: 0 });
  assert.deepEqual(s.camera, { zoom: 1, x: 0.5, y: 0.5 }, 'no roll key when it is 0');
});

test('image parallax is kept when given, dropped at 1, and kept by a later show without it', () => {
  const img = (over = {}) => ({ op: 'image', action: 'show', name: 'sky', file: 'sky.png', fade: 0, ...over });
  const s = stateWith(img({ parallax: 0.4 }));
  assert.equal(s.images[0].parallax, 0.4);
  applyToState(s, img());
  assert.equal(s.images[0].parallax, 0.4);
  applyToState(s, img({ parallax: 1 }));
  assert.ok(!('parallax' in s.images[0]));
});

test('move and image move keep a tint, none clears it, and a move without tint leaves it', () => {
  const s = stateWith(show('ann'), move('ann', { tint: '#ff8080' }));
  assert.equal(s.sprites[0].tint, '#ff8080');
  applyToState(s, move('ann', { x: 0.5 }));
  assert.equal(s.sprites[0].tint, '#ff8080');
  applyToState(s, move('ann', { tint: null }));
  assert.ok(!('tint' in s.sprites[0]));
  const img = (over = {}) => ({ op: 'image', action: 'move', name: 'sky', x: null, y: null, scale: null, rotation: null, alpha: null, anchor: null, dur: 0, ease: 'inout', ...over });
  applyToState(s, { op: 'image', action: 'show', name: 'sky', file: 'sky.png', fade: 0, tint: '#00ff00' });
  assert.equal(s.images[0].tint, '#00ff00');
  applyToState(s, img({ tint: null }));
  assert.ok(!('tint' in s.images[0]));
});
