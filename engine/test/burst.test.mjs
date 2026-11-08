import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BURST_NAMES, BURSTS, isBurstName, spawnBurst, stepBurst, burstLook, mulberry32 } from '../../dist/engine/src/index.js';

test('every burst kind has a spec and is recognised; unknown names are not', () => {
  for (const k of BURST_NAMES) assert.ok(isBurstName(k) && BURSTS[k].count > 0 && BURSTS[k].life > 0, k);
  assert.equal(isBurstName('rainbow'), false);
});

test('spawnBurst: the asked count (or the kind\'s) at the asked place, deterministic for a seed, lives scaled by the asked seconds', () => {
  const a = spawnBurst('sparkle', mulberry32(1), 100, 200, 5, 2), b = spawnBurst('sparkle', mulberry32(1), 100, 200, 5, 2);
  assert.equal(a.length, 5);
  assert.deepEqual(a, b);
  assert.ok(a.every(p => p.x === 100 && p.y === 200 && p.life > 1.4 && p.life <= 2));
  assert.equal(spawnBurst('confetti', mulberry32(2), 0, 0).length, BURSTS.confetti.count);
});

test('stepBurst: particles move, slow by drag, fall by gravity, and die when their life is over', () => {
  const [p] = spawnBurst('confetti', mulberry32(3), 0, 0, 1);
  const vy0 = p.vy;
  assert.equal(stepBurst(p, 'confetti', 0.1), true);
  assert.ok(p.y !== 0 && p.age === 0.1);
  assert.ok(p.vy > vy0 * (1 - BURSTS.confetti.drag * 0.1), 'gravity pulls it down');
  assert.equal(stepBurst(p, 'confetti', 10), false);
  const [s] = spawnBurst('smoke', mulberry32(4), 0, 0, 1);
  const y0 = s.y; for (let i = 0; i < 10; i++) stepBurst(s, 'smoke', 0.1);
  assert.ok(s.y < y0, 'smoke rises');
});

test('burstLook: fades out over the life and grows by the kind\'s factor; confetti stays solid until the last third', () => {
  const [p] = spawnBurst('smoke', mulberry32(5), 0, 0, 1);
  const first = burstLook(p, 'smoke'); p.age = p.life * 0.99;
  const last = burstLook(p, 'smoke');
  assert.ok(last.alpha < first.alpha * 0.05 && last.size > first.size * 1.7);
  const [c] = spawnBurst('confetti', mulberry32(6), 0, 0, 1);
  c.age = c.life * 0.5;
  assert.equal(burstLook(c, 'confetti').alpha, 1);
});
