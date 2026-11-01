import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const { loadAll, removeKey, writeKey } = createRequire(import.meta.url)('../../tools/desktop/save-files.cjs');
const { desktopBackend } = await import('../../dist/preview/storage.js');

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vn-saves-')), 'saves');

test('save files: values round trip under awkward keys, remove deletes, temp files are ignored', () => {
  const dir = tmp();
  assert.deepEqual(loadAll(dir), {}); // folder does not exist yet
  const keys = ['vn.game.save.1', 'vn.game.choice:2', 'vn.a*b.c?d', "vn.x.it's/ok"];
  keys.forEach((k, i) => writeKey(dir, k, `value ${i}`));
  writeKey(dir, keys[0], 'changed');
  fs.writeFileSync(path.join(dir, 'half.tmp'), 'partial');
  const all = loadAll(dir);
  assert.equal(all[keys[0]], 'changed');
  assert.equal(all[keys[3]], 'value 3');
  assert.equal(Object.keys(all).length, 4);
  removeKey(dir, keys[1]);
  removeKey(dir, keys[1]);
  assert.equal(Object.keys(loadAll(dir)).length, 3);
});

test('desktop backend: reads come from memory, writes reach the bridge', () => {
  const calls = [];
  const b = desktopBackend({ load: () => ({ 'vn.g.a': '1' }), set: (k, v) => calls.push(['set', k, v]), remove: k => calls.push(['remove', k]) });
  assert.equal(b.get('vn.g.a'), '1');
  assert.equal(b.get('vn.g.zzz'), null);
  assert.equal(b.set('vn.g.b', '2'), true);
  assert.deepEqual(b.keys().sort(), ['vn.g.a', 'vn.g.b']);
  b.remove('vn.g.a');
  assert.equal(b.get('vn.g.a'), null);
  assert.deepEqual(calls, [['set', 'vn.g.b', '2'], ['remove', 'vn.g.a']]);
});
