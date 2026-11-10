// The dev server's in-memory project listing (tools/project-data.mjs projectIndex) against a fresh scan (projectListing).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { projectIndex, projectListing } from '../../tools/project-data.mjs';

function project() {
  const root = mkdtempSync(path.join(tmpdir(), 'vn-index-'));
  const put = (p, text = 'x') => { mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); writeFileSync(path.join(root, p), text); };
  put('game.json', '{}');
  put('script/park.vn', 'label start:\n');
  put('script/sub/more.vn', '# more\n');
  put('assets/bg/park.png');
  put('assets/bg/.gitkeep', '');
  put('assets/char/al/sprite.json', '{"parts":[]}');
  put('themes/dark.json', '{}');
  mkdirSync(path.join(root, 'assets', 'empty'));
  return { root, put };
}

/** What a listing says, in a form to compare: files with mtimes, folders, and the text of the files read. */
const view = l => ({
  files: [...l.files].sort((a, b) => a.path.localeCompare(b.path)),
  dirs: [...l.dirs].sort(),
  texts: l.files.map(f => f.path).filter(p => /\.(vn|json)$/.test(p)).sort().map(p => [p, l.text(p)]),
});

test('projectIndex: the first listing is a fresh scan', () => {
  const { root } = project();
  try {
    assert.deepEqual(view(projectIndex(root).listing()), view(projectListing(root)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('projectIndex: touched files and folders follow the disk; untouched ones are not re-read', () => {
  const { root, put } = project();
  try {
    const index = projectIndex(root);
    index.listing();
    put('script/park.vn', 'label start:\n  "edited"\n');
    put('assets/cg/new.png');
    rmSync(path.join(root, 'script', 'sub'), { recursive: true });
    renameSync(path.join(root, 'assets', 'bg'), path.join(root, 'assets', 'backgrounds'));
    index.touch(['script/park.vn', 'assets/cg/new.png', 'assets/cg', 'script/sub', 'assets/bg', 'assets/backgrounds', 'masters/x.psd']);
    assert.deepEqual(view(index.listing()), view(projectListing(root)));

    put('game.json', '{"title":"changed"}'); // not touched: the index keeps what it had
    assert.equal(index.listing().text('game.json'), '{}');
    index.touch(['game.json']);
    assert.equal(index.listing().text('game.json'), '{"title":"changed"}');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('projectIndex: an unnamed change, stale() and the periodic check scan everything', () => {
  const { root, put } = project();
  try {
    let t = 0;
    const index = projectIndex(root, { now: () => t, fullScanMs: 1000 });
    index.listing();
    put('script/a.vn', '# a\n');
    index.touch(['']);
    assert.ok(index.listing().files.some(f => f.path === 'script/a.vn'));
    put('script/b.vn', '# b\n');
    index.stale();
    assert.ok(index.listing().files.some(f => f.path === 'script/b.vn'));
    put('script/c.vn', '# c\n');
    assert.ok(!index.listing().files.some(f => f.path === 'script/c.vn'));
    t = 2000;
    assert.ok(index.listing().files.some(f => f.path === 'script/c.vn'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
