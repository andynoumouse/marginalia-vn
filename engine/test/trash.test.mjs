import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trashId, isTrashId, readManifest, planPurge, describeTrashEntry } from '../../dist/engine/src/index.js';

const at = iso => new Date(iso);

test('entry ids are the UTC time, made unique within the same second', () => {
  const now = at('2026-11-02T09:05:07Z');
  assert.equal(trashId(now, []), '2026-11-02_09-05-07');
  assert.equal(trashId(now, ['2026-11-02_09-05-07']), '2026-11-02_09-05-07-2');
  assert.equal(trashId(now, ['2026-11-02_09-05-07', '2026-11-02_09-05-07-2']), '2026-11-02_09-05-07-3');
  assert.ok(isTrashId('2026-11-02_09-05-07') && isTrashId('2026-11-02_09-05-07-12'));
  assert.ok(!isTrashId('notes') && !isTrashId('..') && !isTrashId('2026-11-02'));
});

test('a manifest only names paths the Files panel could have removed', () => {
  const ok = { action: 'delete', paths: ['assets/bg', 'script/a.vn'], time: '2026-11-02T09:05:07Z' };
  assert.deepEqual(readManifest(JSON.stringify(ok)), ok);
  assert.equal(readManifest('not json'), null);
  assert.equal(readManifest(JSON.stringify({ ...ok, action: 'eat' })), null);
  assert.equal(readManifest(JSON.stringify({ ...ok, paths: [] })), null);
  assert.equal(readManifest(JSON.stringify({ ...ok, paths: ['../outside.txt'] })), null);
  assert.equal(readManifest(JSON.stringify({ ...ok, paths: ['game.json'] })), null);
  assert.equal(readManifest(JSON.stringify({ ...ok, paths: ['assets'] })), null, 'never a top folder');
  assert.equal(readManifest(JSON.stringify({ ...ok, time: 5 })), null);
});

const entry = (id, days, bytes) => ({ id, action: 'delete', paths: ['assets/x.png'], time: new Date(Date.UTC(2026, 10, 30 - days)).toISOString(), bytes });

test('purge drops old entries, then the oldest over the size cap, and never the newest', () => {
  const now = Date.UTC(2026, 10, 30);
  const limits = { maxAgeDays: 30, maxBytes: 100 };
  const old = entry('2026-10-01_00-00-00', 40, 1), mid = entry('2026-11-20_00-00-00', 10, 60), last = entry('2026-11-29_00-00-00', 1, 50);
  assert.deepEqual(planPurge([last, mid, old], now, limits), [old.id, mid.id]);
  assert.deepEqual(planPurge([mid, last], now, { maxAgeDays: 30, maxBytes: 200 }), []);
  const huge = entry('2026-11-29_00-00-00', 0, 5000);
  assert.deepEqual(planPurge([huge], now, limits), [], 'a delete bigger than the cap still stays until the next one');
  assert.deepEqual(planPurge([], now, limits), []);
});

test('an entry reads as what happened, to what, and when', () => {
  const now = Date.parse('2026-11-02T10:00:00Z');
  const e = { id: 'x', action: 'delete', paths: ['assets/bg'], time: '2026-11-02T09:55:00Z', bytes: 2048 };
  assert.deepEqual(describeTrashEntry(e, now), { label: 'assets/bg', detail: 'deleted 5 min ago, 2.0 KB' });
  const r = { ...e, action: 'replace', paths: ['assets/voice/a.ogg', 'assets/voice/a.mp3'], time: '2026-10-31T10:00:00Z' };
  assert.deepEqual(describeTrashEntry(r, now), { label: 'assets/voice/a.ogg and 1 more', detail: 'replaced 2 days ago, 2.0 KB' });
});
