import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGitStatus, changeKind, suggestCommitMessage, checkCommit } from '../../dist/engine/src/index.js';

const ch = (path, x = ' ', y = 'M') => ({ path, x, y });

test('status paths become project-relative, renames keep their old path, outside paths drop', () => {
  const out = ['RM proj/script/b.vn', 'proj/script/a.vn', '?? proj/script/new.vn', ' M top.txt', ' D proj/assets/bg/park.png', ''].join('\0');
  assert.deepEqual(parseGitStatus(out, 'proj/'), [
    { path: 'assets/bg/park.png', x: ' ', y: 'D' },
    { path: 'script/b.vn', x: 'R', y: 'M', from: 'script/a.vn' },
    { path: 'script/new.vn', x: '?', y: '?' },
  ]);
  assert.deepEqual(parseGitStatus(' M game.json\0'), [{ path: 'game.json', x: ' ', y: 'M' }], 'the project is the repository root');
  assert.deepEqual(parseGitStatus(''), []);
});

test('change kinds', () => {
  assert.equal(changeKind(ch('a', '?', '?')), 'added');
  assert.equal(changeKind(ch('a', 'A', 'M')), 'added');
  assert.equal(changeKind(ch('a', ' ', 'D')), 'deleted');
  assert.equal(changeKind(ch('a', 'R', ' ')), 'renamed');
  assert.equal(changeKind(ch('a', 'U', 'U')), 'conflict');
  assert.equal(changeKind(ch('a', 'A', 'A')), 'conflict');
  assert.equal(changeKind(ch('a', 'M', 'M')), 'modified');
});

test('the suggested message names scripts and counts the rest', () => {
  assert.equal(suggestCommitMessage([]), '');
  assert.equal(suggestCommitMessage([ch('script/park.vn')]), 'Update park.vn');
  assert.equal(suggestCommitMessage([ch('script/ch1/a.vn', '?', '?'), ch('assets/bg/x.png', '?', '?')]), 'Add a.vn and 1 asset');
  assert.equal(suggestCommitMessage([ch('assets/bg/x.png', ' ', 'D'), ch('assets/bg/y.png', ' ', 'D')]), 'Remove 2 assets');
  assert.equal(suggestCommitMessage(['a', 'b', 'c', 'd'].map(n => ch(`script/${n}.vn`)).concat(ch('game.json'), ch('masters/bg/p.psd'), ch('locale/fi.json'))),
    'Update 4 scripts, 1 PSD master, 1 translation file and game.json');
  assert.equal(suggestCommitMessage([ch('a.txt'), ch('b.txt'), ch('c.txt')]), 'Update 3 other files');
});

const facts = over => ({ changes: [ch('script/park.vn')], operation: null, branch: 'main', large: [], unignored: [], ...over });

test('a merge in progress, conflicts or nothing to commit block; the rest warns', () => {
  assert.deepEqual(checkCommit(facts()), { blockers: [], warnings: [] });
  assert.equal(checkCommit(facts({ operation: 'merge' })).blockers.length, 1);
  assert.match(checkCommit(facts({ changes: [ch('script/a.vn', 'U', 'U')] })).blockers[0], /1 file with merge conflicts: script\/a.vn/);
  assert.deepEqual(checkCommit(facts({ changes: [] })).blockers, ['Nothing to commit.']);
  const w = checkCommit(facts({
    branch: null, unignored: ['/build/'],
    large: [{ path: 'masters/bg/a.psd', bytes: 20 * 1048576, lfs: false }, { path: 'masters/bg/b.psd', bytes: 200 * 1048576, lfs: false }, { path: 'masters/bg/c.psd', bytes: 5e8, lfs: true }],
  })).warnings;
  assert.equal(w.length, 4);
  assert.match(w[0], /detached HEAD/);
  assert.match(w[1], /a\.psd \(20\.0 MB\) is not in Git LFS/);
  assert.match(w[2], /b\.psd is 200\.0 MB .*refuse the push/);
  assert.match(w[3], /does not ignore \/build\/ yet/);
});
