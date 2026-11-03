import { test } from 'node:test';
import assert from 'node:assert/strict';
import { touchRecent, removeRecent, parseRecent, sharedGameId, changesSince, withEngineVersion, MAX_RECENT } from '../../dist/engine/src/index.js';

const row = (folder, extra = {}) => ({ folder, title: folder.toUpperCase(), lastOpened: '2026-01-01T00:00:00.000Z', ...extra });

test('touchRecent moves the folder to the top and caps the list', () => {
  const list = [row('a'), row('b'), row('c')];
  assert.deepEqual(touchRecent(list, row('b', { title: 'New' })).map(r => [r.folder, r.title]), [['b', 'New'], ['a', 'A'], ['c', 'C']]);
  assert.deepEqual(touchRecent(list, row('B'), { caseInsensitive: true }).map(r => r.folder), ['B', 'a', 'c']);
  assert.equal(touchRecent(list, row('B')).length, 4);
  const long = Array.from({ length: MAX_RECENT }, (_, i) => row(`p${i}`));
  const next = touchRecent(long, row('new'));
  assert.equal(next.length, MAX_RECENT);
  assert.equal(next[0].folder, 'new');
  assert.equal(next.at(-1).folder, `p${MAX_RECENT - 2}`);
});

test('removeRecent and parseRecent', () => {
  assert.deepEqual(removeRecent([row('a'), row('b')], 'A', { caseInsensitive: true }).map(r => r.folder), ['b']);
  assert.deepEqual(parseRecent(null), []);
  assert.deepEqual(parseRecent('not json'), []);
  assert.deepEqual(parseRecent('{}'), []);
  assert.deepEqual(parseRecent(JSON.stringify([{ folder: 'x' }, { title: 'no folder' }, null])), [{ folder: 'x', title: '', lastOpened: '' }]);
});

test('sharedGameId names the other folders with the same id', () => {
  const list = [row('a', { id: 'g' }), row('b', { id: 'g' }), row('c', { id: 'h' }), row('d')];
  assert.deepEqual(sharedGameId(list, 'a', 'g'), ['b']);
  assert.deepEqual(sharedGameId(list, 'A', 'g', { caseInsensitive: true }), ['b']);
  assert.deepEqual(sharedGameId(list, 'e', 'g'), ['a', 'b']);
  assert.deepEqual(sharedGameId(list, 'c', 'h'), []);
  assert.deepEqual(sharedGameId(list, 'd', undefined), []);
});

test('changesSince lists the minor versions after the game\'s, up to the engine\'s', () => {
  const changes = { '0.2': ['two'], '0.3': ['three'], '0.10': ['ten'], '1.0': ['one'] };
  assert.deepEqual(changesSince('0.1', '0.3.4', changes), [{ version: '0.2', changes: ['two'] }, { version: '0.3', changes: ['three'] }]);
  assert.deepEqual(changesSince('0.3', '1.0.0', changes).map(c => c.version), ['0.10', '1.0']);
  assert.deepEqual(changesSince('0.3', '0.3.1', changes), []);
  assert.ok(changesSince('0.1', '0.2.1').length === 1, 'the engine has an entry for 0.2');
  assert.deepEqual(changesSince('0.2', '0.3.0').map(c => c.version), ['0.3'], 'the engine has an entry for 0.3');
});

test('withEngineVersion rewrites only the engine field', () => {
  const text = '{\n  "id": "x",\n  "engine": "0.1",\n  "nested": { "engine": "keep" }\n}\n';
  assert.equal(withEngineVersion(text, '0.2'), '{\n  "id": "x",\n  "engine": "0.2",\n  "nested": { "engine": "keep" }\n}\n');
  assert.equal(withEngineVersion('{\r\n    "id": "x"\r\n}', '0.2'), '{\r\n    "engine": "0.2",\r\n    "id": "x"\r\n}');
});
