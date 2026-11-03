import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keepRuntimeFile, portableExeName, portableFolderName, safeFileName } from '../../dist/engine/src/index.js';

test('safeFileName: forbidden characters, spaces, dots, device names, length, empty titles', () => {
  assert.equal(safeFileName('Evening in the Park'), 'Evening in the Park');
  assert.equal(safeFileName('Who? What: A/B "story" <1>|*'), 'Who What A B story 1');
  assert.equal(safeFileName('  Rain\tPark\n '), 'Rain Park');
  assert.equal(safeFileName('The End...'), 'The End');
  assert.equal(safeFileName('...hidden'), 'hidden');
  assert.equal(safeFileName('雨の公園'), '雨の公園');
  assert.equal(safeFileName('Ending: Café'), 'Ending Café');
  assert.equal(safeFileName('CON'), 'CON game');
  assert.equal(safeFileName('lpt1.txt'), 'lpt1.txt game');
  assert.equal(safeFileName('Console'), 'Console');
  assert.equal(safeFileName('x'.repeat(100)).length, 64);
  assert.equal(safeFileName('a'.repeat(63) + ' b'), 'a'.repeat(63)); // cut at 64, then the trailing space goes
  assert.equal(safeFileName(''), 'Game');
  assert.equal(safeFileName('???', 'my-game'), 'my-game');
});

test('portable names: the exe per platform and the folder like the Studio release', () => {
  assert.equal(portableExeName('Evening in the Park', 'win32'), 'Evening in the Park.exe');
  assert.equal(portableExeName('Evening in the Park', 'linux'), 'evening-in-the-park');
  assert.equal(portableFolderName('Evening in the Park', 'win32', 'x64'), 'Evening in the Park-win-x64');
  assert.equal(portableFolderName('Rain', 'linux', 'arm64'), 'Rain-linux-arm64');
});

test('keepRuntimeFile: the runtime without the carried app, the default app and the other locales', () => {
  // A packaged Studio's install folder, and an Electron from node_modules.
  const studio = ['Marginalia Studio.exe', 'LICENSE', 'LICENSES.chromium.html', 'ffmpeg.dll', 'icudtl.dat', 'resources.pak', 'version',
    'locales', 'locales/en-US.pak', 'locales/fi.pak', 'resources', 'resources/app', 'resources/app/package.json',
    'resources/app/node_modules/monaco-editor/min/vs/loader.js', 'resources/default_app.asar', 'resources/app.asar'];
  assert.deepEqual(studio.filter(keepRuntimeFile), ['Marginalia Studio.exe', 'LICENSE', 'LICENSES.chromium.html', 'ffmpeg.dll', 'icudtl.dat',
    'resources.pak', 'version', 'locales', 'locales/en-US.pak', 'resources']);
  assert.equal(keepRuntimeFile('resources\\app\\studio\\main.cjs'), false);
  assert.equal(keepRuntimeFile('resources/app/'), false);
  assert.equal(keepRuntimeFile('resources/application.txt'), true);
});
