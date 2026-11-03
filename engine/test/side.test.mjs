// Side images: game.json "sideImages", `define ... side=<name>` and which portrait a line shows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAssets, checkGame, compile, sideImageKey, sideImageProblems, sideImageSettings } from '../../dist/engine/src/index.js';

const SIDE = { place: 'left', size: 260, when: 'always' };
const files = new Set(['side/al', 'side/al_smile', 'side/bo']);
const key = (side, pose, settings = SIDE) => sideImageKey(side, pose, settings, k => files.has(k));

test('sideImages settings: off when absent, defaults for true and bad values', () => {
  assert.equal(sideImageSettings(undefined), null);
  assert.equal(sideImageSettings(false), null);
  assert.equal(sideImageSettings('yes'), null);
  assert.deepEqual(sideImageSettings(true), SIDE);
  assert.deepEqual(sideImageSettings({ place: 'right', size: 300, when: 'offstage' }), { place: 'right', size: 300, when: 'offstage' });
  assert.deepEqual(sideImageSettings({ place: 'top', size: -1, when: 'never' }), SIDE);
});

test('sideImages problems are warned about in game.json', () => {
  assert.deepEqual(sideImageProblems(undefined), []);
  assert.deepEqual(sideImageProblems(true), []);
  assert.deepEqual(sideImageProblems(3), ['sideImages needs true or an object like { "place": "left", "size": 260 }']);
  assert.deepEqual(sideImageProblems({ place: 'top', size: 0, when: 'x', big: true }), [
    'sideImages.place must be one of left, right', 'sideImages.size needs a height in stage pixels (above 0)',
    'sideImages.when must be one of always, offstage', 'sideImages has no option "big" (use place, size, when)',
  ]);
  const text = '{\n  "title": "T",\n  "sideImages": { "place": "up" }\n}';
  assert.deepEqual(checkGame(JSON.parse(text), { files: [] }, text).map(d => `${d.line} ${d.message}`), ['3 sideImages.place must be one of left, right']);
});

test('the portrait follows the pose on stage, else the plain one', () => {
  assert.equal(key('al', undefined), 'side/al');     // not on stage
  assert.equal(key('al', null), 'side/al');          // on stage, no pose
  assert.equal(key('al', 'smile'), 'side/al_smile');
  assert.equal(key('al', 'sad'), 'side/al');         // no portrait for that pose
  assert.equal(key('bo', 'smile'), 'side/bo');
});

test('no portrait when the game has none, the character has none or the file is missing', () => {
  assert.equal(key('al', undefined, null), null);
  assert.equal(key(undefined, undefined), null);
  assert.equal(key('cy', undefined), null);
});

test('when: offstage shows the portrait only while the speaker is not on stage', () => {
  const off = { ...SIDE, when: 'offstage' };
  assert.equal(key('al', undefined, off), 'side/al');
  assert.equal(key('al', null, off), null);
  assert.equal(key('al', 'smile', off), null);
});

const program = text => compile([{ file: 't.vn', text }]);

test('define ... side= names the portrait; a missing file is warned about', () => {
  const p = program('define al "Al" side=al_face\ndefine bo "Bo"\nlabel start:\n  "x"\n');
  assert.deepEqual(p.diagnostics, []);
  assert.equal(p.characters.al.side, 'al_face');
  assert.equal('side' in p.characters.bo, false);
  assert.match(program('define al "Al" side=\nlabel start:\n  "x"\n').diagnostics[0].message, /side= needs a portrait name/);
  assert.deepEqual(checkAssets(p, { files: ['side/al_face.png'] }), []);
  assert.deepEqual(checkAssets(p, { files: ['side/other.png'] }).map(d => d.message), ['No portrait "al_face" in assets/side (side=)']);
});
