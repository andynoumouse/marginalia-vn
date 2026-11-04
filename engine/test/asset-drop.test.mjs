import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planDrop, masterOutput, matchMasters } from '../../dist/engine/src/index.js';

test('files without a folder are routed by type', () => {
  assert.deepEqual(planDrop('rain.PNG'), { dest: 'assets/bg/rain.png' });
  assert.deepEqual(planDrop('theme.ogg'), { dest: 'assets/music/theme.ogg' });
  assert.deepEqual(planDrop('Fancy.woff2'), { dest: 'assets/fonts/Fancy.woff2' });
  assert.deepEqual(planDrop('intro.MP4'), { dest: 'assets/movie/intro.mp4' });
  assert.deepEqual(planDrop('intro.webm', 'cutscenes'), { dest: 'assets/cutscenes/intro.webm' });
  assert.ok('error' in planDrop('blink.gif')); // not an engine image format
});

test('a folder wins over the type, and PSDs go to masters', () => {
  assert.deepEqual(planDrop('door.wav', 'sound'), { dest: 'assets/sound/door.wav' });
  assert.deepEqual(planDrop('cg1.webp', 'cg/extra'), { dest: 'assets/cg/extra/cg1.webp' });
  assert.deepEqual(planDrop('alice.psd', 'char'), { dest: 'masters/char/alice.psd' });
  assert.ok('error' in planDrop('alice.psd'));
  assert.ok('error' in planDrop('alice.psd', 'music'));
});

test('names are cleaned and bad input refused', () => {
  assert.deepEqual(planDrop('C:\\art\\My Room (v2).png', 'bg'), { dest: 'assets/bg/My_Room_v2.png' });
  assert.ok('error' in planDrop('x.exe'));
  assert.ok('error' in planDrop('x.png', '../secret'));
  assert.ok('error' in planDrop('.png'));
});

test('masters map to the art the converter makes from them', () => {
  assert.equal(masterOutput('bg/park.psd'), 'bg/park.png');
  assert.equal(masterOutput('ui/frame.PSD'), 'ui/frame.png');
  assert.equal(masterOutput('char/mina.psd'), 'char/mina/sprite.json');
  assert.equal(masterOutput('char/sub/mina.psd'), null); // the converter reads each folder's top level only
  assert.equal(masterOutput('cg/one.psd'), null);
  assert.deepEqual(matchMasters(['bg/park.psd', 'char/mina.psd'], ['char/mina/sprite.json', 'bg/other.png']), [
    { master: 'bg/park.psd', output: null },
    { master: 'char/mina.psd', output: 'char/mina/sprite.json' },
  ]);
});
