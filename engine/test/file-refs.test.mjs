import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findFileRefs, resolveFileRef } from '../../dist/engine/src/index.js';

test('findFileRefs finds file:line and file:line:col with their offsets', () => {
  const text = 'error park.vn:12 Unknown label "x"; see sub/demo.vn:3:7.';
  assert.deepEqual(findFileRefs(text), [
    { start: 6, end: 16, path: 'park.vn', line: 12 },
    { start: 40, end: 55, path: 'sub/demo.vn', line: 3, col: 7 },
  ]);
  assert.equal(text.slice(6, 16), 'park.vn:12');
});

test('findFileRefs takes Windows and absolute paths', () => {
  const [a] = findFileRefs('at C:\\proj\\script\\park.vn:4');
  assert.equal(a.path, 'C:\\proj\\script\\park.vn');
  assert.equal(a.line, 4);
  const [b] = findFileRefs('(/work/proj/assets/char/mia/rig.json:20:3)');
  assert.deepEqual([b.path, b.line, b.col], ['/work/proj/assets/char/mia/rig.json', 20, 3]);
});

test('findFileRefs ignores urls, times, line 0 and names without an extension', () => {
  assert.deepEqual(findFileRefs('http://localhost:3000 and http://example.com:80/x'), []);
  assert.deepEqual(findFileRefs('took 12:30, ratio 1.5:2, Makefile:3, park.vn:0'), []);
  assert.deepEqual(findFileRefs('masters/char/mia.psd: not an RGB document'), []);
});

test('resolveFileRef maps a reported path onto an open file name', () => {
  const names = ['park.vn', 'demo.vn', 'char/mia/rig.json', 'game.json'];
  assert.equal(resolveFileRef('park.vn', names), 'park.vn');
  assert.equal(resolveFileRef('script/park.vn', names), 'park.vn');
  assert.equal(resolveFileRef('C:\\proj\\script\\demo.vn', names), 'demo.vn');
  assert.equal(resolveFileRef('assets/char/mia/rig.json', names), 'char/mia/rig.json');
  assert.equal(resolveFileRef('xpark.vn', names), undefined);
  assert.equal(resolveFileRef('other.vn', names), undefined);
  assert.equal(resolveFileRef('script/ch2/park.vn', ['park.vn', 'ch2/park.vn']), 'ch2/park.vn');
});
