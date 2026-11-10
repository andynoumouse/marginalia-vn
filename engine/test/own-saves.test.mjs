import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OwnSaves, OWN_SAVE_MS } from '../../dist/engine/src/index.js';

test('OwnSaves: an event naming only our recent saves is ours, once', () => {
  const s = new OwnSaves();
  s.saved('script/park.vn', 1000);
  s.saved('script/demo.vn', 1010);
  assert.equal(s.covers(['script/park.vn'], 1200), true);
  assert.equal(s.covers(['script/park.vn'], 1300), false); // used up: a second event is an outside change
  assert.equal(s.covers(['script/demo.vn', 'assets/bg/x.png'], 1300), false); // something else changed too
  assert.equal(s.covers(['script/demo.vn'], 1300), true);  // ...and that did not use up demo.vn
});

test('OwnSaves: unnamed events and old saves are never ours', () => {
  const s = new OwnSaves();
  s.saved('script/park.vn', 0);
  assert.equal(s.covers(undefined, 10), false); // a server that sends no names
  assert.equal(s.covers([], 10), false);
  assert.equal(s.covers([''], 10), false);      // a change the watcher could not name
  assert.equal(s.covers(['script/park.vn'], OWN_SAVE_MS + 1), false);
});
