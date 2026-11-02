import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageBytes, audioBytes, memoryBudget, formatBytes, residencyReport, parseDebugCommand } from '../../dist/engine/src/index.js';

const MB = 1024 * 1024;

test('image and audio sizes', () => {
  assert.equal(imageBytes(1920, 1080), 1920 * 1080 * 4);
  assert.equal(imageBytes(-5, 10), 0);
  assert.equal(audioBytes(180, 44100, 2), 180 * 44100 * 2 * 4); // about 60 MB for a 3 minute track
  assert.equal(audioBytes(0, 44100, 2), 0);
});

test('the budget comes from game.json, else from the device', () => {
  assert.equal(memoryBudget({}, undefined), 512 * MB);
  assert.equal(memoryBudget(undefined, 8), 512 * MB);
  assert.equal(memoryBudget({}, 2), 256 * MB);
  assert.equal(memoryBudget({}, 0.5), 256 * MB);
  assert.equal(memoryBudget({ memoryBudgetMB: 100 }, 2), 100 * MB);
  for (const bad of [0, -1, NaN, '100', null]) assert.equal(memoryBudget({ memoryBudgetMB: bad }, undefined), 512 * MB);
});

test('formatBytes', () => {
  assert.equal(formatBytes(500), '500 B');
  assert.equal(formatBytes(2048), '2.0 KB');
  assert.equal(formatBytes(3 * MB), '3.0 MB');
  assert.equal(formatBytes(1.5 * 1024 * MB), '1.50 GB');
});

test('the report totals per kind, names the largest and flags going over', () => {
  const resident = [
    { key: 'bg/park', kind: 'image', bytes: 8 * MB },
    { key: 'bg/cafe', kind: 'image', bytes: 4 * MB },
    { key: 'music/theme', kind: 'audio', bytes: 60 * MB },
  ];
  const text = residencyReport(resident, 100 * MB, { lateLoads: 2 }).join('\n');
  assert.match(text, /resident 72\.0 MB of 100\.0 MB budget \(72%\)\n/);
  assert.match(text, /images 12\.0 MB in 2 files, audio 60\.0 MB in 1 files/);
  assert.match(text, /late loads 2/);
  assert.ok(text.indexOf('music/theme') < text.indexOf('bg/park'));
  assert.doesNotMatch(text, /over budget/);
  assert.match(residencyReport(resident, 50 * MB, { lateLoads: 0 })[0], /over budget/);
  assert.match(residencyReport(resident, 100 * MB, { lateLoads: 0 }, 1).join('\n'), /music\/theme/);
  assert.doesNotMatch(residencyReport(resident, 100 * MB, { lateLoads: 0 }, 1).join('\n'), /bg\/park/);
});

test('an empty report still reads', () => {
  const lines = residencyReport([], 512 * MB, { lateLoads: 0 });
  assert.match(lines[0], /resident 0 B of 512\.0 MB budget \(0%\)/);
  assert.ok(!lines.includes('largest:'));
});

test('memory is a debug command without arguments', () => {
  assert.deepEqual(parseDebugCommand('memory'), { cmd: 'memory' });
  assert.equal(parseDebugCommand('memory x').cmd, 'error');
});
