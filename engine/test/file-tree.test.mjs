import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildFileTree } from '../../dist/engine/src/index.js';
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
