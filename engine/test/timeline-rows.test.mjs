import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldedChannels, timelineRows, rowAt, LANE, FOLD, PLANE, FLANE } from '../../dist/engine/src/index.js';

test('foldedChannels folds the unkeyed channels once something is keyed (SA-8)', () => {
  const empty = { keys: [] };
  assert.deepEqual(foldedChannels(empty, null, 0, 0), [], 'nothing keyed: every lane stays open for the first double-click');
  assert.deepEqual(foldedChannels(empty, null, 5, 0), ['x', 'y', 'scale', 'rot', 'opacity'], 'only parameters keyed: the channel lanes fold');
  assert.deepEqual(foldedChannels(empty, 'arm', 0, 1), ['x', 'y', 'scale', 'rot', 'opacity'], 'a frame track counts too');
  const arm = { keys: [{ t: 0.5, part: 'arm', rot: 20, x: 0.1 }] };
  assert.deepEqual(foldedChannels(arm, 'arm', 0, 0), ['y', 'scale', 'opacity']);
  assert.deepEqual(foldedChannels(arm, null, 0, 0), [], 'the body has no keys of its own');
  assert.deepEqual(foldedChannels(arm, 'head', 2, 0), ['x', 'y', 'scale', 'rot', 'opacity'], "another part's keys do not open lanes");
});

test('timelineRows stacks the lanes and rowAt finds them', () => {
  const r = timelineRows(['x', 'y', 'scale', 'opacity'], 2, 1);
  assert.deepEqual(r.rows.map(row => row.top), [0, FOLD, 2 * FOLD, 3 * FOLD, 3 * FOLD + LANE, 3 * FOLD + LANE + FOLD, 3 * FOLD + LANE + FOLD + PLANE, 3 * FOLD + LANE + FOLD + 2 * PLANE]);
  assert.equal(r.height, 4 * FOLD + LANE + 2 * PLANE + FLANE);
  assert.deepEqual(rowAt(r, 3 * FOLD + 1), { kind: 'channel', ch: 'rot', folded: false, top: 3 * FOLD, height: LANE });
  assert.equal(rowAt(r, 4 * FOLD + LANE + 1).kind, 'param');
  assert.equal(rowAt(r, r.height - 1).kind, 'frame');
  assert.equal(rowAt(r, r.height), null);
  assert.equal(timelineRows([], 0, 0).height, 5 * LANE, 'all open: five full lanes, as before');
});
