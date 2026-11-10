import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assetRefs, renameAssetRefs, applyTextEdits } from '../../dist/engine/src/index.js';

const script = `define alice "Alice" color=#ff6fa5 blip=chirp
define item key "Brass key" image=ui/key.png
define item map "Map" image="ui/map"
label start:
    scene bg_park fade 0.5   # bg_park in a comment stays
    image show letter cg/letter.png at 960,540
    image show photo cg/letter
    music play evening loop
    sound play thunder duck
    sound loop rain fade 2s
    sound stop fade 1s
    alice "scene bg_park is where we met #ab12"
    scene "[place]"
screen map:
    image "ui/map.png" at 0,0
    hotspot door mask "ui/door_mask.png" at 1,1 size 2,2 "Door" hover "ui/door_glow.png" hover sound "tick"
    image "[t.file]" size 320,180
`;

const game = `{
  "titleScreen": { "background": "bg_park", "music": "evening" },
  "gallery": [ { "image": "bg_park", "title": "bg_park" } ],
  "splash": [ "bg_park", { "image": "logo", "text": "logo" } ],
  "musicRoom": [ "evening", { "track": "night", "title": "evening" } ],
  "blips": { "kiki": { "sound": "chirp", "vowels": { "a": "kiki_a" } } },
  "intro": "bg_park"
}`;

const files = [{ name: 'park.vn', text: script }, { name: 'game.json', text: game }, { name: 'char/mina/rig.json', text: '{"image":"bg_park"}' }];
const textOf = (name, edits) => applyTextEdits(files.find(f => f.name === name).text, edits.filter(e => e.file === name));

test('finds the files named by commands, screens, defines and game.json', () => {
  const keys = assetRefs(files).map(r => `${r.file}:${r.line} ${r.kind} ${r.key}`);
  assert.deepEqual(keys, [
    'park.vn:1 sound sound/chirp',
    'park.vn:2 image ui/key',
    'park.vn:3 image ui/map',
    'park.vn:5 bg bg/bg_park',
    'park.vn:6 image cg/letter',
    'park.vn:7 image cg/letter',
    'park.vn:8 music music/evening',
    'park.vn:9 sound sound/thunder',
    'park.vn:10 sound sound/rain',
    'park.vn:15 image ui/map',
    'park.vn:16 image ui/door_mask',
    'park.vn:16 image ui/door_glow',
    'park.vn:16 sound sound/tick',
    'game.json:2 bg bg/bg_park',
    'game.json:2 music music/evening',
    'game.json:3 bg bg/bg_park',
    'game.json:4 bg bg/bg_park',
    'game.json:4 bg bg/logo',
    'game.json:5 music music/evening',
    'game.json:5 music music/night',
    'game.json:6 sound sound/chirp',
    'game.json:6 sound sound/kiki_a',
  ]);
  const quoted = assetRefs(files).find(r => r.line === 3 && r.file === 'park.vn');
  assert.equal(script.split('\n')[2].slice(quoted.col, quoted.col + quoted.length), 'ui/map');
});

test('renaming a background rewrites scenes and game.json, not dialogue or comments', () => {
  const { edits, stranded } = renameAssetRefs(files, 'assets/bg/bg_park.png', 'assets/bg/park_day.png');
  assert.deepEqual(stranded, []);
  assert.equal(edits.length, 4);
  const vn = textOf('park.vn', edits).split('\n');
  assert.equal(vn[4], '    scene park_day fade 0.5   # bg_park in a comment stays');
  assert.equal(vn[11], '    alice "scene bg_park is where we met #ab12"');
  const json = textOf('game.json', edits);
  assert.match(json, /"background": "park_day"/);
  assert.match(json, /"gallery": \[ \{ "image": "park_day", "title": "bg_park" \} \]/);
  assert.match(json, /"splash": \[ "park_day",/);
  assert.match(json, /"intro": "bg_park"/);
});

test('a background moved where a scene line cannot name it is listed, not rewritten to a path nothing resolves (UX round EP-2)', () => {
  for (const to of ['assets/cg/park.png', 'assets/ui/bg_park.png', 'assets/bg/old/park.png']) {
    const { edits, stranded } = renameAssetRefs(files, 'assets/bg/bg_park.png', to);
    assert.deepEqual(edits, [], to);
    assert.deepEqual(stranded.map(r => `${r.file}:${r.line}`), ['park.vn:5', 'game.json:2', 'game.json:3', 'game.json:4'], to);
  }
  // The assets root works: a scene finds a background there when bg/ has none.
  const { edits, stranded } = renameAssetRefs(files, 'assets/bg/bg_park.png', 'assets/park_day.png');
  assert.deepEqual(stranded, []);
  assert.equal(textOf('park.vn', edits).split('\n')[4], '    scene park_day fade 0.5   # bg_park in a comment stays');
});

test('a background at the assets root resolves there when bg/ has none', () => {
  const vn = [{ name: 'a.vn', text: 'scene sky\n' }];
  assert.equal(assetRefs(vn, ['sky.png'])[0].key, 'sky');
  assert.equal(assetRefs(vn, ['bg/sky.png', 'sky.png'])[0].key, 'bg/sky');
  const { edits } = renameAssetRefs(vn, 'assets/sky.png', 'assets/bg/sky_blue.png', false, ['sky.png']);
  assert.equal(applyTextEdits(vn[0].text, edits), 'scene sky_blue\n');
});

test('image paths keep whether they had an extension', () => {
  const { edits } = renameAssetRefs(files, 'assets/cg/letter.png', 'assets/cg/old/note.png');
  const vn = textOf('park.vn', edits).split('\n');
  assert.equal(vn[5], '    image show letter cg/old/note.png at 960,540');
  assert.equal(vn[6], '    image show photo cg/old/note');
});

test('moving a folder rewrites everything under it, quoted or not', () => {
  const { edits } = renameAssetRefs(files, 'assets/ui', 'assets/gui', true);
  const vn = textOf('park.vn', edits).split('\n');
  assert.equal(vn[1], 'define item key "Brass key" image=gui/key.png');
  assert.equal(vn[2], 'define item map "Map" image="gui/map"');
  assert.equal(vn[14], '    image "gui/map.png" at 0,0');
  assert.equal(vn[15], '    hotspot door mask "gui/door_mask.png" at 1,1 size 2,2 "Door" hover "gui/door_glow.png" hover sound "tick"');
});

test('music and sounds follow a rename in their folder and are stranded outside it', () => {
  let r = renameAssetRefs(files, 'assets/music/evening.ogg', 'assets/music/dusk.ogg');
  assert.deepEqual(r.stranded, []);
  assert.equal(textOf('park.vn', r.edits).split('\n')[7], '    music play dusk loop');
  assert.match(textOf('game.json', r.edits), /"music": "dusk"/);
  assert.match(textOf('game.json', r.edits), /"musicRoom": \[ "dusk", \{ "track": "night", "title": "evening" \} \]/);
  r = renameAssetRefs(files, 'assets/sound/chirp.wav', 'assets/sound/peep.wav');
  assert.equal(textOf('park.vn', r.edits).split('\n')[0], 'define alice "Alice" color=#ff6fa5 blip=peep');
  assert.match(textOf('game.json', r.edits), /"sound": "peep"/);
  r = renameAssetRefs(files, 'assets/music/evening.ogg', 'assets/music/old/evening.ogg');
  assert.deepEqual(r.edits, []);
  assert.equal(r.stranded.length, 3);
});

test('only paths under assets/ and only exact files match', () => {
  assert.deepEqual(renameAssetRefs(files, 'masters/bg/bg_park.psd', 'masters/bg/x.psd').edits, []);
  const vn = [{ name: 'a.vn', text: 'image show a cg/set/one\nimage show b cg/set\n' }];
  assert.equal(applyTextEdits(vn[0].text, renameAssetRefs(vn, 'assets/cg/set.png', 'assets/cg/kit.png').edits), 'image show a cg/set/one\nimage show b cg/kit\n');
  assert.equal(applyTextEdits(vn[0].text, renameAssetRefs(vn, 'assets/cg/set', 'assets/cg/kit', true).edits), 'image show a cg/kit/one\nimage show b cg/set\n');
});
