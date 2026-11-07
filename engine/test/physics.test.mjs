import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepChain, restState, PHYSICS_PRESETS, PHYSICS_HZ } from '../../dist/engine/src/index.js';

const chain = PHYSICS_PRESETS['long hair'];
const peak = o => Math.max(...o.map(Math.abs));

// Run `seconds` of frames of length 1/hz; the inputs come from `at(time)`.
function run(c, hz, seconds, at, state = restState(c)) {
  const frames = Math.round(hz * seconds), outs = [];
  let t = 0;
  for (let i = 0; i < frames; i++) {
    state = stepChain(c, state, at(t), 1 / hz);
    outs.push(state.outputs[0]);
    t += 1 / hz;
  }
  return { state, outs };
}
const jump = t => ({ angle_x: t < 0.5 ? 0 : 20 });

test('a held input at rest does not move the chain', () => {
  const { outs } = run(chain, 60, 2, () => ({ angle_x: 30 }));
  assert.equal(peak(outs), 0);
});

test('an input step swings the hair against the motion, then it settles', () => {
  const { outs } = run(chain, 60, 12, jump);
  assert.equal(peak(outs.slice(0, 29)), 0, 'nothing before the head moves');
  const swing = outs.slice(30, 120);
  assert.ok(Math.min(...swing) < -1, `swings against the motion: ${Math.min(...swing)}`);
  assert.ok(Math.max(...swing) > 0, 'and overshoots back');
  assert.ok(peak(outs.slice(-60)) < 0.01, 'at rest again');
});

test('input value does not matter, only its motion', () => {
  const a = run(chain, 60, 3, jump).outs;
  const b = run(chain, 60, 3, t => ({ angle_x: 100 + jump(t).angle_x })).outs;
  a.forEach((x, i) => assert.ok(Math.abs(x - b[i]) < 1e-9, `frame ${i}: ${x} vs ${b[i]}`));
});

test('the same total time gives the same result at 30, 60 and 144 Hz', () => {
  const prime = stepChain(chain, restState(chain), { angle_x: 0 }, 0);
  const results = [30, 60, 144].map(hz => run(chain, hz, 3, () => ({ angle_x: 20 }), prime).state);
  for (const r of results.slice(1)) {
    assert.equal(r.time, results[0].time);
    r.angles.forEach((x, i) => assert.ok(Math.abs(x - results[0].angles[i]) < 1e-9));
  }
  assert.equal(PHYSICS_HZ, 60);
});

test('uneven frame times also add up (the remainder is carried)', () => {
  const prime = stepChain(chain, restState(chain), { angle_x: 0 }, 0);
  const a = stepChain(chain, prime, { angle_x: 10 }, 0.1);
  let b = prime;
  for (const dt of [0.01, 0.02, 0.005, 0.03, 0.035]) b = stepChain(chain, b, { angle_x: 10 }, dt);
  assert.equal(a.time, b.time);
  assert.deepEqual(a.angles, b.angles);
});

test('deterministic, wind included', () => {
  const ribbon = PHYSICS_PRESETS.ribbon;
  assert.deepEqual(run(ribbon, 60, 5, jump).outs, run(ribbon, 60, 5, jump).outs);
  const calm = run({ ...ribbon, wind: undefined }, 60, 5, () => ({})).outs;
  assert.equal(peak(calm), 0);
  const windy = run(ribbon, 60, 5, () => ({})).outs;
  assert.ok(peak(windy) > 0.1, 'wind keeps the ribbon moving');
  const other = run({ ...ribbon, wind: { ...ribbon.wind, seed: 7 } }, 60, 5, () => ({})).outs;
  assert.notDeepEqual(other, windy);
});

test('the angle limit and the output range hold', () => {
  const stiff = { inputs: [{ name: 'x', weight: 1 }], segments: [{ length: 1, mass: 1, damping: 2, stiffness: 50, limit: 8 }], outputs: [{ name: 'o', scale: 2, min: -10, max: 10 }] };
  let s = stepChain(stiff, restState(stiff), { x: 0 }, 0);
  for (let i = 0; i < 300; i++) {
    s = stepChain(stiff, s, { x: i % 2 ? 90 : -90 }, 1 / 60);
    assert.ok(Math.abs(s.angles[0]) <= 8 + 1e-9);
    assert.ok(Math.abs(s.outputs[0]) <= 10);
  }
});

test('later segments follow the ones before them', () => {
  let s = stepChain(chain, restState(chain), { angle_x: 0 }, 0);
  for (let i = 0; i < 20; i++) s = stepChain(chain, s, { angle_x: 20 }, 1 / 60);
  assert.ok(s.angles.slice(1).some(a => Math.abs(a) > 0.01));
});

test('every preset is stable and settles', () => {
  for (const [name, c] of Object.entries(PHYSICS_PRESETS)) {
    const calm = { ...c, wind: undefined };
    let s = stepChain(calm, restState(calm), {}, 0);
    const kick = Object.fromEntries(c.inputs.map(i => [i.name, 30]));
    for (let i = 0; i < 60 * 15; i++) s = stepChain(calm, s, kick, 1 / 60);
    assert.ok(s.angles.every(a => Math.abs(a) < 0.01), `${name} settles: ${s.angles}`);
  }
});
