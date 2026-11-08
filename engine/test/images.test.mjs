import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, Runtime, NullRenderer, checkAssets, assetContext, stateAssets, opAssets, getCompletions } from '../../dist/engine/src/index.js';

const errors = p => p.diagnostics.filter(d => d.severity === 'error');
const play = async text => {
  const p = compile([{ file: 't.vn', text }]);
  assert.deepEqual(errors(p), []);
  const r = new NullRenderer();
  const rt = new Runtime(p, r);
  const seen = {};
  r.say = async ev => { seen[ev.text] = structuredClone(rt.state.images); };
  await rt.start();
  return { p, rt, seen };
};

test('image: show, change, move, hide', async () => {
  const { p, seen } = await play([
    'label start:', '  scene a',
    '  image show letter cg/letter at 960,540 anchor=center scale=0.8 layer=-1 fixed keep fade 0.4',
    '  "one"',
    '  image move letter to 100,200 alpha=0.5 rot=10 0.5 ease=out',
    '  "two"',
    '  image show letter cg/letter2 scale=2',
    '  "three"',
    '  image hide letter fade 0.2',
    '  "four"', '',
  ].join('\n'));
  const show = p.ops.find(o => o.op === 'image');
  assert.deepEqual([show.action, show.name, show.file, show.x, show.y, show.anchor, show.layer, show.fixed, show.keep, show.fade], ['show', 'letter', 'cg/letter', 960, 540, [0.5, 0.5], -1, true, true, 0.4]);
  assert.deepEqual(seen.one, [{ name: 'letter', file: 'cg/letter', x: 960, y: 540, scale: 0.8, rotation: 0, alpha: 1, anchor: [0.5, 0.5], layer: -1, fixed: true, keep: true }]);
  assert.deepEqual([seen.two[0].x, seen.two[0].y, seen.two[0].alpha, seen.two[0].rotation, seen.two[0].scale], [100, 200, 0.5, 10, 0.8]);
  assert.deepEqual([seen.three.length, seen.three[0].file, seen.three[0].scale, seen.three[0].x], [1, 'cg/letter2', 2, 100]); // only the named fields change
  assert.deepEqual(seen.four, []);
});

test('image: reset on scene unless kept', async () => {
  const { seen } = await play([
    'label start:', '  scene a', '  image show a x', '  image show b y keep', '  scene b', '  "x"', '',
  ].join('\n'));
  assert.deepEqual(seen.x.map(i => i.name), ['b']);
});

test('image: usage errors', () => {
  for (const bad of ['image', 'image show', 'image show a', 'image show a f at 5', 'image show a f layer=1.5', 'image show a f scale=0', 'image show a f alpha=2',
    'image show a f bogus=1', 'image show a f g', 'image move a', 'image move a to 1,2 ease=nope', 'image hide', 'image hide a fade', 'image spin a']) {
    assert.equal(errors(compile([{ file: 't.vn', text: `label start:\n  ${bad}\n` }])).length, 1, bad);
  }
});

test('image: assets are preloaded and checked', () => {
  const p = compile([{ file: 't.vn', text: 'label start:\n  image show a cg/letter\n  image show b cg/missing.png\n' }]);
  const index = { files: ['cg/letter.png', 'bg/park.png'] };
  const ctx = assetContext(index);
  assert.deepEqual(opAssets(p.ops.filter(o => o.op === 'image')[0], ctx), ['cg/letter']);
  assert.deepEqual(opAssets(p.ops.filter(o => o.op === 'image')[1], ctx), []);
  assert.deepEqual(stateAssets({ bg: null, sprites: [], music: null, images: [{ file: 'cg/letter.png' }] }, ctx), ['cg/letter']);
  const w = checkAssets(p, index);
  assert.deepEqual(w.map(d => [d.line, d.message]), [[3, 'No image "cg/missing.png" in assets (image b)']]);
});

test('image: completions', () => {
  const p = compile([{ file: 't.vn', text: 'label start:\n  image show letter cg/letter\n' }]);
  const labels = prefix => getCompletions(p, prefix).map(s => s.label);
  assert.ok(labels('image ').includes('show'));
  assert.deepEqual(labels('image move '), ['letter']);
  assert.ok(labels('image show x ').includes('cg/letter'));
  assert.ok(labels('image show x cg/letter ').includes('layer=-1'));
});

test('animate on an image: the loop is kept in the picture state until stop, hide or scene', async () => {
  const { rt, seen } = await play([
    'label start:', '  scene a',
    '  image show lantern prop/lantern at 400,300 keep',
    '  animate lantern sway loop strength=2',
    '  "one"',
    '  image move lantern to 500,300 0.1',
    '  "two"',
    '  animate lantern stop',
    '  "three"',
    '  animate lantern pulse loop',
    '  scene b',
    '  "four"', '',
  ].join('\n'));
  assert.deepEqual(seen.one[0].anim, { name: 'sway', dur: null, strength: 2, part: null });
  assert.deepEqual(seen.two[0].anim, { name: 'sway', dur: null, strength: 2, part: null }); // image move keeps it
  assert.equal(seen.three[0].anim, undefined);
  assert.equal(seen.four[0].anim?.name, 'pulse'); // a kept picture keeps its loop through scene
  assert.equal(rt.state.images.length, 1);
});

test('animate: a name that is both a character and an image is an error; an unknown target is a warning', () => {
  const clash = compile([{ file: 't.vn', text: 'define lamp = Character("Lamp")\nlabel start:\n  image show lamp prop/lamp\n  animate lamp sway loop\n' }]);
  assert.ok(errors(clash).some(d => /both a character and an image/.test(d.message)), JSON.stringify(clash.diagnostics));
  const unknown = compile([{ file: 't.vn', text: 'label start:\n  animate ghost sway loop\n' }]);
  assert.ok(unknown.diagnostics.some(d => /Unknown character "ghost"/.test(d.message)));
  const fine = compile([{ file: 't.vn', text: 'label start:\n  animate lamp sway loop\n  image show lamp prop/lamp\n' }]); // shown later in the file: still known
  assert.deepEqual(fine.diagnostics.filter(d => /Unknown character/.test(d.message)), []);
});
