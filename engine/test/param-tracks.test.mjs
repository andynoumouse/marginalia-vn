import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  trackAt, tracksAt, resolveAnim, addParamKey, setParamKey, deleteParamKey, keyParams, sampleTrack, displayValues,
  controlGroups, changedParams, savePose, deletePose, trackIds, checkRig,
} from '../../dist/engine/src/index.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
const defs = [
  { id: 'head_x', min: -1, max: 1, default: 0, group: 'Head' },
  { id: 'head_y', min: -1, max: 1, default: 0, group: 'Head' },
  { id: 'smile', min: 0, max: 1, default: 0.5, group: 'Mouth' },
  { id: 'wind', min: 0, max: 1, default: 0 },
];
const categories = ['Head', 'Mouth'];
const pads = [{ id: 'head', x: 'head_x', y: 'head_y', group: 'Head' }];

test('a track holds its ends, eases between keys and gives null without keys', () => {
  const keys = [{ t: 0.25, v: 0 }, { t: 0.75, v: 1, ease: 'linear' }];
  close(trackAt(keys, 0), 0); close(trackAt(keys, 0.5), 0.5); close(trackAt(keys, 1), 1);
  assert.equal(trackAt([], 0.5), null);
  assert.deepEqual(tracksAt({ smile: keys, none: [] }, 0.5), { smile: 0.5 });
});

test('resolveAnim carries the tracks, and an animation of tracks alone resolves', () => {
  const r = resolveAnim('smiles', { smiles: { dur: 2, keys: [], params: { smile: [{ t: 0, v: 0 }, { t: 1, v: 1, ease: 'linear' }] } } });
  assert.equal(r.dur, 2);
  close(r.params(0.5).smile, 0.5);
  assert.equal(resolveAnim('bob').params, undefined);
});

test('adding, moving and deleting parameter keys', () => {
  let def = { keys: [] };
  let r = addParamKey(def, 'smile', { t: 0.5, v: 1 });
  r = addParamKey(r.def, 'smile', { t: 0, v: 0.2 });
  assert.equal(r.index, 0);
  assert.deepEqual(trackIds(r.def), ['smile']);
  // the same t replaces the value
  r = addParamKey(r.def, 'smile', { t: 0.5, v: 0.8, ease: 'out' });
  assert.deepEqual(r.def.params.smile, [{ t: 0, v: 0.2 }, { t: 0.5, v: 0.8, ease: 'out' }]);
  // moving a key past another reorders and reports the new index
  const m = setParamKey(r.def, 'smile', 0, { t: 0.9 });
  assert.equal(m.index, 1);
  assert.equal(m.def.params.smile[0].t, 0.5);
  assert.equal(setParamKey(m.def, 'smile', 1, { ease: undefined }).def.params.smile[1].ease, undefined);
  // the input is not touched, and the last key removes the track and then the section
  assert.equal(def.params, undefined);
  const gone = deleteParamKey(deleteParamKey(m.def, 'smile', 0), 'smile', 0);
  assert.equal(gone.params, undefined);
});

test('keyParams keys several at once and sampleTrack follows the curve', () => {
  const def = keyParams(keyParams({ keys: [] }, { head_x: -1, head_y: 0 }, 0), { head_x: 1, head_y: 0 }, 1);
  assert.deepEqual(trackIds(def).sort(), ['head_x', 'head_y']);
  const s = sampleTrack(def, 'head_x', 2);
  assert.equal(s.length, 3); close(s[0], -1); close(s[2], 1);
  assert.deepEqual(sampleTrack(def, 'smile'), []);
});

test('displayValues: tracks beat the panel, except for held parameters', () => {
  const def = { keys: [], params: { smile: [{ t: 0, v: 1 }], head_x: [{ t: 0, v: 5 }] } };
  const v = displayValues(defs, { smile: 0.1, wind: 0.3 }, def, 0.5);
  assert.deepEqual(v, { head_x: 1, head_y: 0, smile: 1, wind: 0.3 }); // 5 is clamped to the range
  assert.equal(displayValues(defs, { smile: 0.1 }, def, 0.5, ['smile']).smile, 0.1);
  assert.equal(displayValues(defs, {}, null, 0).smile, 0.5);
});

test('controlGroups: a pad comes first and its axes keep their sliders, categories keep their order and uncategorised come last', () => {
  const g = controlGroups(defs, pads, categories);
  assert.deepEqual(g.map(x => x.name), ['Head', 'Mouth', 'Other']);
  assert.deepEqual(g[0].controls.map(c => (c.kind === 'pad' ? `pad:${c.pad.id}` : c.param.id)), ['pad:' + pads[0].id, 'head_x', 'head_y']);
  assert.equal(g[1].controls[0].param.id, 'smile');
  // a pad over an unknown parameter is skipped
  assert.equal(controlGroups(defs, [{ id: 'p', x: 'head_x', y: 'nope' }], categories).flatMap(x => x.controls).length, 4);
});

test('poses: only changed parameters, valid names, no mutation', () => {
  assert.deepEqual(changedParams(defs, { head_x: 0, smile: 1, wind: 0.12345678 }), { smile: 1, wind: 0.1235 });
  const poses = { a: { smile: 1 } };
  const next = savePose(poses, 'happy', { smile: 0.66666 });
  assert.deepEqual(next, { a: { smile: 1 }, happy: { smile: 0.6667 } });
  assert.deepEqual(poses, { a: { smile: 1 } });
  assert.equal(savePose(poses, 'two words', { smile: 1 }), null);
  assert.equal(savePose(poses, 'empty', {}), null);
  assert.deepEqual(deletePose(next, 'a'), { happy: { smile: 0.6667 } });
});

test('checkRig validates parameter tracks', () => {
  const msgs = anims => checkRig({ parts: [{ file: 'a.png' }], rig: { categories, parameters: defs, animations: anims } }).map(p => p.message);
  assert.deepEqual(msgs({ ok: { keys: [], params: { smile: [{ t: 0, v: 0 }, { t: 1, v: 1, ease: 'out' }] } } }), []);
  assert.deepEqual(msgs({ ok: { keys: [{ t: 0.5, y: -10, ease: 'bezier(0.3,0,0.7,1)' }], params: { smile: [{ t: 0, v: 0 }, { t: 1, v: 1, ease: 'bezier(0.3,0,0.7,1)' }] } } }), []);
  assert.match(msgs({ x: { keys: [] } })[0], /non-empty/);
  const bad = msgs({ x: { keys: [], params: { nope: [{ t: 0, v: 0 }], smile: [{ t: 2, v: 5, zzz: 1 }, { t: 0, v: 0, ease: 'wobble' }], wind: [] } } }).join('\n');
  for (const want of [/no parameter "nope"/, /t must be/, /outside "smile"/, /unknown field "zzz"/, /unknown ease/, /needs a list of keys/]) assert.match(bad, want);
});

test('a key reached along a bezier: exact ends, presets close to their names, overshoot, bezier wins over ease, bad ones are reported', async () => {
  const { bezierEase, presetBezier, trackAt, EASES, isBezier, checkRig, setParamKey } = await import('../../dist/engine/src/index.js');
  const lin = bezierEase([0, 0, 1, 1]);
  for (const u of [0, 0.25, 0.5, 1]) assert.ok(Math.abs(lin(u) - u) < 1e-5, `linear at ${u}`);
  for (const name of ['in', 'out', 'inout']) {
    const f = bezierEase(presetBezier(name));
    assert.equal(f(0), 0); assert.equal(f(1), 1);
    for (const u of [0.1, 0.3, 0.5, 0.7, 0.9]) assert.ok(Math.abs(f(u) - EASES[name](u)) < 0.03, `${name} at ${u}`);
  }
  assert.equal(presetBezier('bounce'), null);
  assert.ok(Math.max(...Array.from({ length: 50 }, (_, i) => bezierEase([0.3, 1.8, 0.6, 1])(i / 49))) > 1, 'y past 1 overshoots');
  assert.ok(Math.abs(bezierEase([1, 0, 0, 1])(0.5) - 0.5) < 1e-3, 'a flat slope still solves');
  const keys = [{ t: 0, v: 0 }, { t: 1, v: 10, ease: 'in', bezier: [0, 0, 1, 1] }];
  assert.ok(Math.abs(trackAt(keys, 0.5) - 5) < 1e-3, 'bezier wins over ease');
  assert.ok(isBezier([0.2, -1, 0.8, 2])); assert.ok(!isBezier([1.2, 0, 0.5, 1])); assert.ok(!isBezier([0, 0, 1]));
  const def = { keys: [], params: { a: [{ t: 0, v: 0 }, { t: 1, v: 1, ease: 'in' }] } };
  const set = setParamKey(def, 'a', 1, { bezier: [0.1, 0, 0.9, 1] }).def;
  assert.deepEqual(set.params.a[1].bezier, [0.1, 0, 0.9, 1]);
  assert.equal('bezier' in setParamKey(set, 'a', 1, { bezier: undefined }).def.params.a[1], false);
  const rig = { parameters: [{ id: 'a', min: 0, max: 1, default: 0 }], animations: { s: { keys: [], params: { a: [{ t: 0, v: 0 }, { t: 1, v: 1, bezier: [2, 0, 1, 1] }] } } } };
  const msgs = checkRig({ width: 100, height: 100, parts: [{ file: 'body.png' }], rig }).map(p => p.message);
  assert.ok(msgs.some(m => /bezier needs/.test(m)), msgs.join(' | '));
  rig.animations.s.params.a[1].bezier = [0.2, -0.5, 0.8, 1.4];
  assert.deepEqual(checkRig({ width: 100, height: 100, parts: [{ file: 'body.png' }], rig }).filter(p => /bezier|unknown field/.test(p.message)), []);
});
