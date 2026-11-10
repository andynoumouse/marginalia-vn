import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assetSaveConflict, assetSaveTrash, isCleanPath, isFolderName, isLocaleFile, isPlainName, isScriptFile, isVoiceLock, manifestText,
  newestFirst, planAssetSave, voiceTakes,
} from '../../dist/engine/src/index.js';

const q = params => new URLSearchParams(params);

test('names the routes take', () => {
  assert.equal(isScriptFile('park.vn'), true);
  assert.equal(isScriptFile('chapters/one.vn'), true);
  for (const bad of ['../x.vn', 'a/../b.vn', './a.vn', 'a//b.vn', 'a.txt', '', 'a\\b.vn']) assert.equal(isScriptFile(bad), false, bad);
  assert.equal(isFolderName('cg', true), true);
  assert.equal(isFolderName('cg/more', true), false, 'one level under assets/');
  assert.equal(isFolderName('chapters/two', false), true);
  assert.equal(isFolderName('..', false), false);
  assert.equal(isLocaleFile('fi.json'), true);
  assert.equal(isLocaleFile('fi.src'), true);
  assert.equal(isLocaleFile('fi.txt'), false);
  assert.equal(isPlainName('robo'), true);
  assert.equal(isPlainName('../robo'), false);
  assert.equal(isCleanPath('assets/bg/x.png'), true);
  assert.equal(isCleanPath('assets/./x.png'), false);
});

test('isVoiceLock: an object of { sum, text }', () => {
  assert.equal(isVoiceLock({}), true);
  assert.equal(isVoiceLock({ ab12: { sum: 'x', text: 'Hi.' } }), true);
  assert.equal(isVoiceLock({ ab12: { sum: 'x' } }), false);
  assert.equal(isVoiceLock({ ab12: null }), false);
  assert.equal(isVoiceLock([]), false);
  assert.equal(isVoiceLock(null), false);
});

test('planAssetSave: a drop, a Replace and a voice take', () => {
  assert.deepEqual(planAssetSave(q({ name: 'Park.png' })), { dest: 'assets/bg/Park.png', replacing: null, voice: null, replaceVoice: false });
  assert.deepEqual(planAssetSave(q({ name: 'a.ogg', folder: 'bg' })), { error: 'a.ogg: bg/ takes images (png, webp, jpg, jpeg, avif)' });
  assert.deepEqual(planAssetSave(q({ name: 'new.png', replace: 'assets/bg/park.png' })),
    { dest: 'assets/bg/park.png', replacing: 'assets/bg/park.png', voice: null, replaceVoice: false });
  assert.deepEqual(planAssetSave(q({ name: 'new.webp', replace: 'assets/bg/park.png' })), { error: 'pick a .png file' });
  assert.deepEqual(planAssetSave(q({ name: 'x.vn', replace: 'script/park.vn' })), { error: 'replace assets and masters only' });
  assert.deepEqual(planAssetSave(q({ name: 'take.WAV', voice: 'ab12.fi', replace: '1' })),
    { dest: 'assets/voice/ab12.fi.wav', replacing: null, voice: 'ab12.fi', replaceVoice: true });
  assert.deepEqual(planAssetSave(q({ name: 'take.png', voice: 'ab12' })), { error: 'Not a voice recording name' });
  assert.deepEqual(planAssetSave(q({ name: 'take.ogg', voice: '../x' })), { error: 'Not a voice recording name' });
});

test('assetSaveConflict and assetSaveTrash: a drop never overwrites, a take only with replace=1', () => {
  const drop = planAssetSave(q({ name: 'park.png' }));
  assert.equal(assetSaveConflict(drop, true, []), 'assets/bg/park.png');
  assert.equal(assetSaveConflict(drop, false, []), null);
  const take = planAssetSave(q({ name: 'b.mp3', voice: 'ab12' }));
  const takes = voiceTakes(['ab12.ogg', 'ab12.fi.ogg', 'cd34.ogg', 'ab12.txt', 'ab12.wav'], 'ab12');
  assert.deepEqual(takes, ['ab12.ogg', 'ab12.wav']);
  assert.equal(assetSaveConflict(take, false, takes), 'assets/voice/ab12.ogg');
  const again = planAssetSave(q({ name: 'b.mp3', voice: 'ab12', replace: '1' }));
  assert.equal(assetSaveConflict(again, false, takes), null);
  assert.deepEqual(assetSaveTrash(again, takes), ['assets/voice/ab12.ogg', 'assets/voice/ab12.wav']);
  const replace = planAssetSave(q({ name: 'n.png', replace: 'assets/bg/park.png' }));
  assert.equal(assetSaveConflict(replace, true, []), null);
  assert.deepEqual(assetSaveTrash(replace, []), ['assets/bg/park.png']);
});

test('trash: newest first, and the manifest text', () => {
  const e = (id, time) => ({ id, time, action: 'delete', paths: [], bytes: 0 });
  assert.deepEqual(newestFirst([e('a', '2026-01-01'), e('c', '2026-02-01'), e('b', '2026-02-01')]).map(x => x.id), ['c', 'b', 'a']);
  assert.deepEqual(JSON.parse(manifestText('replace', ['assets/x.png'], new Date('2026-11-10T12:00:00Z'))),
    { action: 'replace', paths: ['assets/x.png'], time: '2026-11-10T12:00:00.000Z' });
});
