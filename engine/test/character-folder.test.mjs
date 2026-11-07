import { test } from 'node:test';
import assert from 'node:assert/strict';
import { characterId, scanFolder, standaloneChar, rigFile, studioDocOf, studioWrites, readRigSettings, writeRigText } from '../../dist/engine/src/index.js';

const at = (...paths) => paths;
const files = (...paths) => paths.map(path => ({ path, mtime: 1000 + path.length }));
const texts = map => p => (Object.hasOwn(map, p) ? map[p] : null);

test('characterId makes a folder name a character id', () => {
  assert.equal(characterId('mina'), 'mina');
  assert.equal(characterId('Mina (v2) final'), 'Mina_v2_final');
  assert.equal(characterId('  '), 'character');
  assert.equal(characterId('a-b_c'), 'a-b_c');
});

test('a folder with sprite.json is a layered character named after the folder', () => {
  const s = scanFolder(at('sprite.json', 'rig.json', 'body.png', 'eyes/open.png'), 'robo');
  assert.deepEqual(s, { kind: 'layered', base: '', name: 'robo', options: [] });
});

test('rig.json without sprite.json, or plain images, is a flat character', () => {
  assert.equal(scanFolder(at('rig.json', 'default.png', 'smile.png'), 'alice').kind, 'flat');
  assert.equal(scanFolder(at('default.png', 'smile.png'), 'alice').kind, 'flat');
  assert.equal(scanFolder(at('rig.json'), 'alice').kind, 'flat');
});

test('hidden files, .trash and node_modules do not make a character', () => {
  assert.equal(scanFolder(at('.trash/x/sprite.json', '.gitkeep', 'node_modules/p/rig.json', 'notes.txt'), 'x').kind, 'empty');
  assert.equal(scanFolder(at(), 'x').kind, 'empty');
});

test('a game project or its assets/char folder offers its characters', () => {
  const project = at('game.json', 'script/park.vn', 'assets/char/mina/sprite.json', 'assets/char/mina/body.png', 'assets/char/robo/sprite.json', 'assets/char/robo/rig.json', 'assets/char/alice/neutral.png', 'assets/bg/park.png');
  const s = scanFolder(project, 'sample');
  assert.equal(s.kind, 'choose');
  assert.deepEqual(s.options.map(o => o.name), ['alice', 'mina', 'robo']);
  assert.deepEqual(s.options.map(o => o.base), ['assets/char/alice/', 'assets/char/mina/', 'assets/char/robo/']);
  const inside = scanFolder(at('mina/sprite.json', 'mina/body.png', 'robo/sprite.json'), 'char');
  assert.equal(inside.kind, 'choose');
  assert.deepEqual(inside.options.map(o => o.base), ['mina/', 'robo/']);
});

test('one character below the picked folder is opened at once, under its own name', () => {
  const s = scanFolder(at('assets/char/Mina Two/sprite.json', 'assets/char/Mina Two/body.png', 'assets/bg/park.png'), 'game');
  assert.equal(s.kind, 'layered');
  assert.equal(s.base, 'assets/char/Mina Two/');
  assert.equal(s.name, 'Mina_Two');
});

const SPRITE = JSON.stringify({ width: 100, height: 200, parts: [{ file: 'body.png' }, { slot: 'eyes', default: 'open', variants: { open: { file: 'eyes/open.png' }, closed: { file: 'eyes/closed.png' } } }, { file: 'hand.png', group: 'arm/hand' }] });

test('a layered character gets the manifest, rig.json attached, and its files as assets', () => {
  const listed = files('sprite.json', 'rig.json', 'body.png', 'hand.png', 'eyes/open.png', 'eyes/closed.png', '.trash/old.png', 'notes.txt');
  const rig = JSON.stringify({ order: ['body'], animations: {} });
  const c = standaloneChar({ base: '', name: 'robo' }, listed, texts({ 'sprite.json': SPRITE, 'rig.json': rig }));
  assert.equal(c.char, 'robo');
  assert.equal(c.manifest.width, 100);
  assert.deepEqual(c.manifest.rig, { order: ['body'], animations: {} });
  assert.equal(c.rigText, rig);
  assert.deepEqual(c.assets.map(a => a.file), ['char/robo/body.png', 'char/robo/eyes/closed.png', 'char/robo/eyes/open.png', 'char/robo/hand.png', 'char/robo/notes.txt', 'char/robo/rig.json', 'char/robo/sprite.json']);
  assert.deepEqual(c.problems, []);
  assert.ok(c.assets.every(a => Number.isInteger(a.v)));
});

test('without a rig.json the studio starts from a generated skeleton (the part order and bones from the PSD folders)', () => {
  const c = standaloneChar({ base: '', name: 'robo' }, files('sprite.json', 'body.png'), texts({ 'sprite.json': SPRITE }));
  assert.equal(c.rigText, null);
  const starter = JSON.parse(c.starter);
  assert.deepEqual(starter.order, ['body', 'eyes', 'hand']);
  assert.deepEqual(Object.keys(starter.bones).sort(), ['arm', 'hand']);
});

test('a character below the picked folder reads its files from there and ignores the rest', () => {
  const listed = files('game.json', 'assets/char/robo/sprite.json', 'assets/char/robo/body.png', 'assets/char/robo/rig.json', 'assets/char/mina/sprite.json', 'assets/char/mina/hair.png');
  const c = standaloneChar({ base: 'assets/char/robo/', name: 'robo' }, listed, texts({ 'assets/char/robo/sprite.json': SPRITE, 'assets/char/robo/rig.json': '{"order":[]}', 'assets/char/mina/sprite.json': '{"parts":[]}' }));
  assert.deepEqual(c.assets.map(a => a.file), ['char/robo/body.png', 'char/robo/rig.json', 'char/robo/sprite.json']);
  assert.equal(c.manifest.width, 100);
  assert.equal(rigFile(c.base), 'assets/char/robo/rig.json');
  assert.equal(rigFile(''), 'rig.json');
});

test('a flat character is a manifest without parts, drawn from default, else neutral, else the first pose', () => {
  const flat = (...names) => standaloneChar({ base: '', name: 'alice' }, files(...names), texts({}));
  const a = flat('smile.png', 'default.png');
  assert.equal(a.manifest.flat, true);
  assert.deepEqual(a.manifest.parts, []);
  assert.ok(!a.assets.some(x => x.from));
  const b = flat('smile.png', 'neutral.webp', 'annoyed.png');
  assert.deepEqual(b.assets.find(x => x.file === 'char/alice/default.webp'), { file: 'char/alice/default.webp', v: b.assets.find(x => x.file === 'char/alice/neutral.webp').v, from: 'char/alice/neutral.webp' });
  const c = flat('smile.png', 'annoyed.png');
  assert.equal(c.assets.find(x => x.file === 'char/alice/default.png').from, 'char/alice/annoyed.png');
  assert.equal(flat('rig.json').rigText, null); // no rig text read: texts({}) answers null
});

test('a flat character with a rig.json carries it', () => {
  const c = standaloneChar({ base: '', name: 'alice' }, files('rig.json', 'default.png'), texts({ 'rig.json': '{"animations":{"nod":{"dur":1,"keys":[]}}}' }));
  assert.equal(c.manifest.flat, true);
  assert.deepEqual(Object.keys(c.manifest.rig.animations), ['nod']);
  assert.equal(c.rigText, '{"animations":{"nod":{"dur":1,"keys":[]}}}');
});

test('a broken sprite.json or rig.json is reported and the character still opens', () => {
  const c = standaloneChar({ base: '', name: 'robo' }, files('sprite.json', 'rig.json', 'default.png'), texts({ 'sprite.json': '{nope', 'rig.json': '{"order":[]}' }));
  assert.ok(c.problems.some(p => p.includes('sprite.json')));
  assert.equal(c.manifest.flat, true); // without a readable manifest it is drawn as a flat character
});

test('studioDocOf reads what the studio edits, and an empty rig has empty sections', () => {
  const empty = studioDocOf({});
  assert.deepEqual(empty.parameters, []);
  assert.deepEqual(empty.anims, {});
  assert.deepEqual(empty.rig, readRigSettings({}));
  const doc = studioDocOf({ animations: { nod: { dur: 1, keys: [] } }, parameters: [{ id: 'a', min: 0, max: 1, default: 0 }], pivots: { head: [1, 2] }, autonomous: { idle: 'breathe' } });
  assert.deepEqual(Object.keys(doc.anims), ['nod']);
  assert.equal(doc.parameters.length, 1);
  assert.deepEqual(doc.categories, []);
  assert.deepEqual(studioDocOf({ categories: ['A', 'B'] }).categories, ['A', 'B']);
  assert.deepEqual(doc.pivots, { head: [1, 2] });
  assert.equal(doc.rig.idle, 'breathe');
  assert.deepEqual(studioDocOf(null).anims, {});
  assert.deepEqual(studioDocOf({ parameters: 'nope' }).parameters, []);
});

test('studioWrites rewrites only what changed and leaves the file layout and unknown keys alone', () => {
  const text = '{\n  "order": ["body"],\n  "custom": { "keep": true },\n  "animations": {}\n}\n';
  const data = JSON.parse(text);
  const doc = studioDocOf(data);
  const was = readRigSettings(data);
  const next = { ...doc, anims: { nod: { dur: 1, keys: [{ t: 0, x: 0 }] } } };
  const out = writeRigText(text, studioWrites(next, was, data));
  const parsed = JSON.parse(out);
  assert.deepEqual(parsed.custom, { keep: true });
  assert.deepEqual(parsed.order, ['body']);
  assert.equal(parsed.animations.nod.dur, 1);
  assert.ok(!('autonomous' in parsed)); // idle / speak / blink did not change
  assert.ok(!('parameters' in parsed)); // an empty list is no key
  // idle changed: autonomous is written on top of the file's own, so its other keys survive
  const data2 = { ...data, autonomous: { speak: { anim: 'talk' }, extra: 1 } };
  const doc2 = studioDocOf(data2);
  const withAuto = { ...doc2, rig: { ...doc2.rig, idle: 'breathe' } };
  const out2 = JSON.parse(writeRigText(JSON.stringify(data2), studioWrites(withAuto, readRigSettings(data2), data2)));
  assert.equal(out2.autonomous.idle, 'breathe');
  assert.equal(out2.autonomous.speak.anim, 'talk');
  assert.equal(out2.autonomous.extra, 1);
});
