import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addKey, setKey, deleteKey, setDur, uniqueName, newAnim, duplicateAnim, renameAnim, deleteAnim, bakePreset,
  sampleChannel, animParts, keysOf, animOffset, ANIM_NAMES, setTopLevelProperty, applyEdit, psdToStage, stageToPsd, setPivot, setPivots, showLine, removeTopLevelProperty, readRigSettings, speakValue, blinkValue, speakPart, blinkPart, noRigSettings,
} from '../../dist/engine/src/index.js';

const wave = { dur: 1.2, keys: [{ t: 0.2, rot: 7 }, { t: 0.8, rot: 4 }] };

test('addKey keeps keys sorted and merges a key at the same time', () => {
  const a = addKey(wave, { t: 0.5, rot: -5 });
  assert.deepEqual(a.def.keys.map(k => k.t), [0.2, 0.5, 0.8]);
  assert.equal(a.index, 1);
  const b = addKey(a.def, { t: 0.5004, y: -0.01 });
  assert.equal(b.def.keys.length, 3);
  assert.deepEqual(b.def.keys[1], { t: 0.5, rot: -5, y: -0.01 });
  assert.equal(addKey(wave, { t: 2, rot: 1 }).def.keys.at(-1).t, 1); // clamped
  assert.equal(wave.keys.length, 2); // input untouched
});

test('a key for a part does not merge with the body key at the same time', () => {
  const r = addKey(wave, { t: 0.2, part: 'head', rot: 3 });
  assert.equal(r.def.keys.length, 3);
  assert.deepEqual(animParts(r.def), ['head']);
  assert.deepEqual(keysOf(r.def, 'head').map(k => k.key.rot), [3]);
  assert.equal(keysOf(r.def, null).length, 2);
});

test('setKey changes channels, reorders when t passes another key, and drops undefined channels', () => {
  const r = setKey(wave, 0, { t: 0.9 });
  assert.deepEqual(r.def.keys.map(k => k.t), [0.8, 0.9]);
  assert.equal(r.index, 1);
  assert.equal('rot' in setKey(wave, 0, { rot: undefined }).def.keys[0], false);
  assert.equal(setKey(wave, 0, { rot: 1.234567 }).def.keys[0].rot, 1.2346);
  assert.equal(setKey(wave, 9, { rot: 1 }).def, wave); // unknown index: no change
});

test('deleteKey and setDur', () => {
  assert.deepEqual(deleteKey(wave, 0).keys, [{ t: 0.8, rot: 4 }]);
  assert.equal(setDur(wave, 2).dur, 2);
  assert.equal('dur' in setDur(wave, 0), false);
  assert.equal('dur' in setDur(wave, NaN), false);
});

test('animation names: new, duplicate, rename, delete', () => {
  assert.equal(uniqueName({ a: wave }, 'a'), 'a2');
  assert.equal(uniqueName({ a: wave, a2: wave }, 'a'), 'a3');
  const n = newAnim({ anim: wave });
  assert.equal(n.name, 'anim2');
  assert.deepEqual(n.anims[n.name], { dur: 1, keys: [] });
  const d = duplicateAnim({ wave }, 'wave');
  assert.equal(d.name, 'wave-copy');
  d.anims['wave-copy'].keys[0].rot = 99;
  assert.equal(wave.keys[0].rot, 7); // a deep copy
  assert.equal(duplicateAnim({ wave }, 'toString'), null);
  assert.deepEqual(Object.keys(renameAnim({ a: wave, b: wave, c: wave }, 'b', 'x')), ['a', 'x', 'c']);
  assert.equal(renameAnim({ a: wave, b: wave }, 'a', 'b'), null);
  assert.equal(renameAnim({ a: wave }, 'a', ' '), null);
  assert.deepEqual(Object.keys(deleteAnim({ a: wave, b: wave }, 'a')), ['b']);
});

test('sampleChannel follows the animation and returns to 0 at the ends', () => {
  const v = sampleChannel(wave, 'rot', null, 10);
  assert.equal(v.length, 11);
  assert.equal(v[0], 0);
  assert.equal(v[10], 0);
  assert.ok(Math.abs(v[2] - 7) < 1e-9);
  assert.deepEqual(sampleChannel(wave, 'y', null, 4), [0, 0, 0, 0, 0]);
  const p = addKey(wave, { t: 0.5, part: 'head', x: 0.1 }).def;
  assert.ok(Math.abs(sampleChannel(p, 'x', 'head', 10)[5] - 0.1) < 1e-9);
  assert.deepEqual(sampleChannel(p, 'x', 'nope', 2), [0, 0, 0]);
});

test('bakePreset gives keys that play like the preset', () => {
  assert.equal(bakePreset('nope'), null);
  assert.equal(bakePreset('toString'), null);
  for (const name of ANIM_NAMES) {
    const def = bakePreset(name, 64);
    assert.ok(def.keys.length > 0, name);
    if (name === 'shiver') continue; // 12 cycles: too fast for a sampled copy to match
    const peak = Math.max(...[...Array(65)].flatMap((_, i) => Object.values(animOffset(name, i / 64)).map(Math.abs)));
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const want = animOffset(name, t), got = animOffset(name, t, 1, { [name]: def });
      for (const k of ['dx', 'dy', 'rot']) assert.ok(Math.abs(want[k] - got[k]) <= peak * 0.05, `${name} ${k} at ${t}`);
    }
  }
});

test('setTopLevelProperty replaces one property and keeps the rest of the file as written', () => {
  const text = '{\n  "order": ["bottom", "top"],\n  "animations": { "a": { "keys": [] } },\n  "idle": "breathe"\n}\n';
  const e = setTopLevelProperty(text, 'animations', { wave: { dur: 1, keys: [{ t: 0.5, rot: 3 }] } });
  const out = applyEdit(text, e);
  assert.ok(out.startsWith('{\n  "order": ["bottom", "top"],\n  "animations": {\n    "wave": {'));
  assert.ok(out.endsWith('},\n  "idle": "breathe"\n}\n'));
  assert.deepEqual(JSON.parse(out).animations.wave.keys, [{ t: 0.5, rot: 3 }]);
  assert.equal(JSON.parse(out).idle, 'breathe');
});

test('setTopLevelProperty adds a missing property after the last one, or into an empty object', () => {
  const out = applyEdit('{\n  "idle": "bob"\n}\n', setTopLevelProperty('{\n  "idle": "bob"\n}\n', 'animations', {}));
  assert.deepEqual(JSON.parse(out), { idle: 'bob', animations: {} });
  assert.equal(out, '{\n  "idle": "bob",\n  "animations": {}\n}\n');
  assert.deepEqual(JSON.parse(applyEdit('{}', setTopLevelProperty('{}', 'animations', { a: 1 }))), { animations: { a: 1 } });
});

test('setTopLevelProperty skips keys and values that hold braces, quotes and nested objects', () => {
  const text = '{ "x}": "a\\"b{", "animations": { "k": [ {"s": "]}" } ] }, "tail": 1 }';
  const out = applyEdit(text, setTopLevelProperty(text, 'animations', 5));
  assert.deepEqual(JSON.parse(out), { 'x}': 'a"b{', animations: 5, tail: 1 });
  assert.equal(setTopLevelProperty('[1]', 'a', 1), null);
  assert.equal(setTopLevelProperty('{ "a": ', 'a', 1), null);
  assert.equal(setTopLevelProperty('', 'a', 1), null);
});

test('setTopLevelProperty writes keys on one line, like a hand-written rig.json', () => {
  const anims = { wave: { dur: 1.2, keys: [{ t: 0.2, rot: 7, ease: 'out' }, { part: 'face', t: 0.5, x: -0.01 }] }, none: { keys: [] } };
  const out = applyEdit('{\n  "idle": "bob"\n}\n', setTopLevelProperty('{\n  "idle": "bob"\n}\n', 'animations', anims));
  assert.equal(out, [
    '{', '  "idle": "bob",', '  "animations": {', '    "wave": {', '      "dur": 1.2,', '      "keys": [',
    '        { "t": 0.2, "rot": 7, "ease": "out" },', '        { "part": "face", "t": 0.5, "x": -0.01 }', '      ]', '    },',
    '    "none": {', '      "keys": []', '    }', '  }', '}', ''].join('\n'));
  assert.deepEqual(JSON.parse(out).animations, anims);
});

test('pivots: stage and PSD pixels convert both ways, and setPivot adds, replaces and removes', () => {
  const f = { stageW: 1920, stageH: 1080, width: 540, height: 900 };
  assert.deepEqual(psdToStage(f, 270, 900), [1920 / 2, 1080]); // bottom middle of the canvas is the feet
  assert.deepEqual(stageToPsd(f, 960, 1080), [270, 900]);
  const [sx, sy] = psdToStage(f, 123, 456);
  assert.deepEqual(stageToPsd(f, sx, sy), [123, 456]);
  assert.deepEqual(stageToPsd(f, 960.4, 1079.6), [270, 900]); // rounded
  const p = { face: [1, 2] };
  assert.deepEqual(setPivot(p, 'face', [10.4, 20.6]), { face: [10, 21] });
  assert.deepEqual(setPivot(p, 'eyes', [3, 4]), { face: [1, 2], eyes: [3, 4] });
  assert.deepEqual(Object.keys(setPivot({ a: [1, 1], face: [1, 2], b: [2, 2] }, 'face', [5, 5])), ['a', 'face', 'b']);
  assert.deepEqual(setPivot(p, 'face', null), {});
  assert.deepEqual(p, { face: [1, 2] }); // untouched
});

test('removeTopLevelProperty takes a property and its comma out, wherever it stands', () => {
  const t = '{\n  "a": 1,\n  "idle": "bob",\n  "b": { "x": [1, 2] }\n}\n';
  for (const key of ['a', 'idle', 'b']) {
    const out = applyEdit(t, removeTopLevelProperty(t, key));
    assert.deepEqual(JSON.parse(out), Object.fromEntries(Object.entries(JSON.parse(t)).filter(([k]) => k !== key)), key);
  }
  assert.equal(applyEdit('{ "only": 1 }', removeTopLevelProperty('{ "only": 1 }', 'only')).replace(/\s/g, ''), '{}');
  assert.equal(removeTopLevelProperty(t, 'missing'), null);
  assert.equal(removeTopLevelProperty('[1]', 'a'), null);
});

test('setPivots gives several parts one pivot; showLine writes the show line for a placement', () => {
  assert.deepEqual(setPivots({ a: [1, 1] }, ['head', 'hair'], [5.4, 6]), { a: [1, 1], head: [5, 6], hair: [5, 6] });
  assert.deepEqual(setPivots({ head: [1, 1], hair: [2, 2] }, ['head', 'hair'], null), {});
  const at = (x, y = 0, scale = 1, flip = false) => ({ x, y, scale, flip });
  assert.equal(showLine('alice', null, at(0.5)), 'show alice at center');
  assert.equal(showLine('alice', 'smile', at(0.2004)), 'show alice smile at left');
  assert.equal(showLine('alice', 'smile', at(0.3567, 0.0214, 1.1049, true)), 'show alice smile at 0.357 y=0.021 scale=1.1 flip=on');
  assert.equal(showLine('alice', null, { ...at(0.5), anchor: [0.5, 1] }), 'show alice at center');
  assert.equal(showLine('alice', null, { ...at(0.5, 0, 1.5), anchor: [0.5, 0.5] }), 'show alice at center scale=1.5 anchor=center');
  assert.equal(showLine('alice', null, { ...at(0.2), anchor: [0.5, 0.30004] }), 'show alice at left anchor=0.5,0.3');
});

test('readRigSettings, speakValue and blinkValue round-trip the studio fields and keep the rest', () => {
  const data = { idle: 'bob', speak: { anim: 'nod', variants: ['open', 'neutral'], rate: 6, extra: 1 }, blink: { variant: 'shut', every: [2, 4] } };
  const s = readRigSettings(data);
  assert.deepEqual([s.idle, s.speakAnim, s.speakVariants, s.speakRate, s.blink, s.blinkVariant, s.blinkEvery], ['bob', 'nod', ['open', 'neutral'], 6, true, 'shut', [2, 4]]);
  assert.deepEqual(speakValue(data.speak, s), data.speak);
  assert.deepEqual(speakValue(data.speak, { ...s, speakAnim: null, speakRate: null, speakSlot: 'lips' }), { variants: ['open', 'neutral'], extra: 1, slot: 'lips' });
  assert.equal(speakValue({ anim: 'nod' }, { ...s, speakAnim: null, speakVariants: [], speakRate: null }), null);
  assert.deepEqual(blinkValue(data.blink, { ...s, blinkDur: 0.2 }), { variant: 'shut', every: [2, 4], dur: 0.2 });
  assert.equal(blinkValue(true, { ...s, blinkVariant: null, blinkEvery: null }), true);
  assert.equal(blinkValue(data.blink, { ...s, blink: false }), null);
  assert.deepEqual(readRigSettings({ blink: true, speak: 5 }), { ...noRigSettings(), blink: true });
  assert.notEqual(speakPart(s), speakPart({ ...s, speakRate: 7 }));
  assert.equal(blinkPart(s), blinkPart({ ...s }));
});
