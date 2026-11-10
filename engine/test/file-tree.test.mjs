import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildFileTree, groupAssetFiles } from '../../dist/engine/src/index.js';
import { projectData, listDirs } from '../../tools/project-data.mjs';

test('files nest under their folders, folders first', () => {
  const t = buildFileTree(['park.vn', 'ui/title.vn', 'ui/pause.vn', 'a.vn', 'ui/deep/x.vn'], []);
  assert.equal(t.flat, false);
  assert.deepEqual(t.root.files, ['a.vn', 'park.vn']);
  assert.deepEqual(t.root.folders.map(f => f.path), ['ui']);
  assert.deepEqual(t.root.folders[0].files, ['ui/pause.vn', 'ui/title.vn']);
  assert.deepEqual(t.root.folders[0].folders.map(f => f.path), ['ui/deep']);
});

test('empty folders and their parents are nodes', () => {
  const t = buildFileTree(['a.vn'], ['intro/extra', 'zeta']);
  assert.deepEqual(t.root.folders.map(f => f.path), ['intro', 'zeta']);
  assert.deepEqual(t.root.folders[0].folders.map(f => f.path), ['intro/extra']);
  assert.deepEqual(t.root.folders[0].folders[0].files, []);
});

test('a filter gives a flat list of matching files', () => {
  const t = buildFileTree(['park.vn', 'ui/title.vn', 'ui/pause.vn'], ['empty'], ' TI');
  assert.deepEqual(t, { flat: true, files: ['ui/title.vn'] });
});

test('projectData lists empty script folders', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'vn-tree-'));
  try {
    mkdirSync(path.join(root, 'script', 'ui'), { recursive: true });
    mkdirSync(path.join(root, 'script', 'intro', 'empty'), { recursive: true });
    writeFileSync(path.join(root, 'script', 'ui', 'a.vn'), 'label a:\n');
    assert.deepEqual(projectData(root).scriptDirs, ['intro', 'intro/empty', 'ui']);
    assert.deepEqual(listDirs(path.join(root, 'nope')), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('groupAssetFiles: by top folder, sorted, without .gitkeep, layered characters or what keep rejects', () => {
  const files = ['bg/b.png', 'bg/a.png', 'bg/.gitkeep', 'char/al/sprite.json', 'char/al/arm.png', 'char/bo/happy.png', 'char/readme.txt', 'music/x/theme.ogg', 'logo.png'];
  assert.deepEqual([...groupAssetFiles(files, ['al'])], [
    ['bg', ['a.png', 'b.png']],
    ['char', ['bo/happy.png', 'readme.txt']], // bo is a flat character: its images stay listed here
    ['music', ['x/theme.ogg']],
    ['logo.png', ['']],
  ]);
  assert.deepEqual([...groupAssetFiles(files, ['al'], f => f.includes('a'))].map(([d, n]) => [d, n.length]), [['bg', 1], ['char', 2]]); // bg/a.png, char/bo/happy.png and char/readme.txt
  const many = Array.from({ length: 20000 }, (_, i) => `bg/${String(i).padStart(5, '0')}.png`);
  assert.equal(groupAssetFiles(many).get('bg').length, 20000);
});
