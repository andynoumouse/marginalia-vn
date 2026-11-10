import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRig, checkPhysics, restStates, stepPhysics, addPhysicsParams, resolveAnim, setChainRow, addChainRow, removeChainRow, setChainWind, problemRow, DEFAULT_SEGMENT } from '../../dist/engine/src/index.js';

const chain = (over = {}) => ({
  inputs: [{ param: 'turn', weight: 1 }],
  segments: [{ length: 1, mass: 1, damping: 3, stiffness: 90, limit: 25 }],
  outputs: [{ param: 'sway', scale: 1, min: -30, max: 30 }],
  ...over,
});
const rig = (physics, extra = {}) => ({
  parts: [{ name: 'face', file: 'face.png' }, { name: 'hair', file: 'hair.png' }],
  rig: {
    parameters: [{ id: 'turn', min: -30, max: 30, default: 0 }, { id: 'sway', min: -30, max: 30, default: 0 }],
    bones: { head: { pivot: [0, 0] } }, parts: { face: { bone: 'head' } },
    physics, ...extra,
  },
});
const problems = r => checkRig(r).map(p => p.message);

test('a valid physics section has no problems', () => {
  assert.deepEqual(problems(rig({ hair: chain() })), []);
  assert.deepEqual(problems(rig({ hair: chain({ outputs: [{ part: 'hair', scale: 1 }] }) })), []);
});

test('unknown ids, bad numbers and shape errors are reported', () => {
  assert.match(problems(rig({ hair: chain({ inputs: [{ param: 'nope', weight: 1 }] }) })).join('\n'), /no parameter "nope"/);
  assert.match(problems(rig({ hair: chain({ inputs: [{ bone: 'ghost', weight: 1 }] }) })).join('\n'), /no part or bone named "ghost"/);
  assert.match(problems(rig({ hair: chain({ outputs: [{ part: 'ghost', scale: 1 }] }) })).join('\n'), /no part or bone named "ghost"/);
  assert.match(problems(rig({ hair: chain({ inputs: [{ param: 'turn', bone: 'head', weight: 1 }] }) })).join('\n'), /either a param or a bone/);
  assert.match(problems(rig({ hair: chain({ segments: [{ length: 0, mass: 1, damping: 1, stiffness: 1, limit: 1 }] }) })).join('\n'), /length: must be more than 0/);
  assert.match(problems(rig({ hair: chain({ inputs: [{ param: 'turn', weight: 1, smoothing: 1 }] }) })).join('\n'), /smoothing/);
  assert.match(problems(rig({ hair: chain({ outputs: [{ param: 'sway', scale: 1, min: 5, max: 1 }] }) })).join('\n'), /min is above max/);
  assert.match(problems(rig({ hair: chain({ outputs: [{ param: 'sway', scale: 1, segment: 3 }] }) })).join('\n'), /no segment 3/);
  assert.match(problems(rig({ hair: chain({ inputs: [{ bone: 'head', channel: 'spin', weight: 1 }] }) })).join('\n'), /unknown channel/);
  assert.match(problems(rig([])).join('\n'), /physics: needs an object/);
});

test('an output that feeds its own input is a cycle', () => {
  assert.match(problems(rig({ hair: chain({ inputs: [{ param: 'sway', weight: 1 }] }) })).join('\n'), /cycle/);
  // through a keyform: sway drives the head bone, which the chain reads
  const keyforms = [{ target: 'head', param: 'sway', keys: [{ at: -30, rot: -10 }, { at: 30, rot: 10 }] }];
  assert.match(problems(rig({ hair: chain({ inputs: [{ bone: 'head', weight: 1 }] }) }, { keyforms })).join('\n'), /cycle/);
  // through two chains
  const two = { a: chain({ inputs: [{ param: 'turn', weight: 1 }], outputs: [{ param: 'sway', scale: 1 }] }), b: chain({ inputs: [{ param: 'sway', weight: 1 }], outputs: [{ param: 'turn', scale: 1 }] }) };
  assert.match(problems(rig(two)).join('\n'), /cycle \(/);
  // a one-way hand-off is fine
  assert.deepEqual(problems(rig({ a: chain(), b: chain({ inputs: [{ param: 'sway', weight: 1 }], outputs: [{ part: 'hair', scale: 1 }] }) })), []);
});

test('physicsOff on an animation must name chains of the rig', () => {
  const r = rig({ hair: chain() }, { animations: { still: { keys: [{ t: 0.5, rot: 1 }], physicsOff: ['hair'] }, bad: { keys: [{ t: 0.5, rot: 1 }], physicsOff: ['ghost'] } } });
  const m = problems(r);
  assert.equal(m.length, 1);
  assert.match(m[0], /bad\.physicsOff/);
  assert.deepEqual(resolveAnim('still', r.rig.animations).physicsOff, ['hair']);
});

test('stepPhysics reads bone channels and writes parameters and part rotations', () => {
  const def = {
    a: chain({ inputs: [{ bone: 'head', channel: 'rot', weight: 1 }], outputs: [{ param: 'sway', scale: 1 }, { part: 'hair', scale: 0.5 }] }),
  };
  let states = restStates(def);
  const run = (rot, n) => {
    let res;
    for (let i = 0; i < n; i++) {
      res = stepPhysics(def, states, {}, new Map([['head', { dx: 0, dy: 0, sx: 0, sy: 0, rot }]]), 1 / 60);
      states = res.states;
    }
    return res;
  };
  assert.equal(run(0, 10).params.sway, 0);
  const swing = run(20, 8);
  assert.ok(Math.abs(swing.params.sway) > 0.5, `moves: ${swing.params.sway}`);
  assert.ok(Math.abs(swing.rot.hair - swing.params.sway * 0.5) < 1e-9, 'the part output is scaled');
  const off = stepPhysics(def, states, {}, new Map(), 1 / 60, true);
  assert.deepEqual(off.params, {});
  assert.equal(off.states.a.primed, false, 'a bypassed chain is held at rest');
  const listed = stepPhysics(def, states, {}, new Map(), 1 / 60, ['other']);
  assert.ok(listed.states.a.primed, 'a chain not named stays on');
});

test('the same frames give the same swing (no hidden state)', () => {
  const def = { a: chain() };
  const go = () => {
    let st = restStates(def), last;
    for (let i = 0; i < 90; i++) { last = stepPhysics(def, st, { turn: i < 30 ? 0 : 20 }, new Map(), 1 / 60); st = last.states; }
    return last.params.sway;
  };
  assert.equal(go(), go());
});

test('addPhysicsParams adds and keeps each parameter inside its range', () => {
  const defs = [{ id: 'sway', min: -10, max: 10, default: 0 }];
  assert.equal(addPhysicsParams(defs, { sway: 4 }, { sway: 3 }).sway, 7);
  assert.equal(addPhysicsParams(defs, { sway: 8 }, { sway: 9 }).sway, 10);
  assert.deepEqual(addPhysicsParams(defs, { sway: 1 }, {}), { sway: 1 });
});

test('chain shape errors: ids, empty lists, entries that are not objects, wrong field types, wind', () => {
  const msgs = (physics) => problems(rig(physics)).join('\n');
  assert.match(msgs({ '2bad': chain() }), /"2bad" is not a usable chain id/);
  assert.match(msgs({ hair: 3 }), /physics\.hair: needs an object with inputs, segments and outputs/);
  assert.match(msgs({ hair: chain({ inputs: [] }) }), /inputs: needs at least one input/);
  assert.match(msgs({ hair: chain({ segments: [] }) }), /segments: needs at least one segment/);
  assert.match(msgs({ hair: chain({ outputs: [] }) }), /outputs: needs at least one output/);
  assert.match(msgs({ hair: chain({ inputs: [null] }) }), /inputs\[0\]: not an input/);
  assert.match(msgs({ hair: chain({ segments: [null] }) }), /segments\[0\]: not a segment/);
  assert.match(msgs({ hair: chain({ outputs: [null] }) }), /outputs\[0\]: not an output/);
  assert.match(msgs({ hair: chain({ inputs: [{ param: 'turn', channel: 'rot', weight: 1 }] }) }), /channel belongs to a bone input/);
  assert.match(msgs({ hair: chain({ inputs: [{ param: 'turn' }] }) }), /inputs\[0\]\.weight: must be a number/);
  assert.match(msgs({ hair: chain({ segments: [{ length: 1, mass: 1, damping: -1, stiffness: 1, limit: 1 }] }) }), /damping: must be 0 or more/);
  assert.match(msgs({ hair: chain({ outputs: [{ param: 'sway', part: 'hair', scale: 1 }] }) }), /either a param or a part/);
  assert.match(msgs({ hair: chain({ outputs: [{ param: 'ghost', scale: 1 }] }) }), /outputs\[0\]: no parameter "ghost"/);
  assert.match(msgs({ hair: chain({ outputs: [{ param: 'sway' }] }) }), /outputs\[0\]\.scale: must be a number/);
  assert.match(msgs({ hair: chain({ outputs: [{ param: 'sway', scale: 1, min: 'a', max: 'b' }] }) }), /\.min: must be a number[\s\S]*\.max: must be a number/);
  assert.match(msgs({ hair: chain({ wind: { strength: 'x' } }) }), /wind: needs a numeric strength/);
  assert.deepEqual(problems(rig({ hair: chain({ wind: { strength: 2 } }) })), []);
});

test("Mina's hair: the sample rig is valid, and the scene wind moves its strands differently", async () => {
  const { readFileSync } = await import('node:fs');
  const mina = JSON.parse(readFileSync(new URL('../../games/sample/assets/char/mina/rig.json', import.meta.url), 'utf8'));
  assert.deepEqual(checkRig(mina), []);
  const run = world => {
    let states = restStates(mina.physics), last;
    for (let i = 0; i < 300; i++) { last = stepPhysics(mina.physics, states, {}, new Map(), 1 / 60, false, world); states = last.states; }
    return last.rot;
  };
  assert.ok(Object.values(run(null)).every(v => v === 0), 'a calm scene leaves the strands at rest');
  // the strands are bone chains under a skinned mesh: each segment turns its bone, with no parameter in between
  assert.equal(mina.parameters, undefined);
  assert.ok(Object.keys(mina.deformers[0].mesh.weights).length > 0 && mina.deformers[0].mesh.verts.length / 2 <= 500);
  const wind = run({ strength: 0.6, gusts: 0.8 });
  const tips = [0, 1, 2, 3, 4].map(c => wind[`hair_${c}_2`]);
  assert.ok(tips.every(v => v < 0), 'a wind to the right turns every strand so its tip swings right (a negative turn)');
  assert.ok(Math.max(...tips) - Math.min(...tips) > 2, 'the strands do not move in step');
});

test('setChainRow changes a row and drops the other kind of source or target', () => {
  const c = chain();
  const w = setChainRow(c, 'inputs', 0, { weight: 0.5, smoothing: 0.2 });
  assert.deepEqual(w.inputs, [{ param: 'turn', weight: 0.5, smoothing: 0.2 }]);
  assert.deepEqual(c.inputs, [{ param: 'turn', weight: 1 }], 'the input is left alone');
  assert.deepEqual(setChainRow(w, 'inputs', 0, { smoothing: undefined }).inputs, [{ param: 'turn', weight: 0.5 }], 'undefined removes a field');
  const b = setChainRow(c, 'inputs', 0, { bone: 'head' });
  assert.deepEqual(b.inputs, [{ weight: 1, bone: 'head', channel: 'rot' }], 'a bone input gets a channel, and loses the param');
  assert.deepEqual(setChainRow(b, 'inputs', 0, { param: 'turn' }).inputs, [{ weight: 1, param: 'turn' }], 'back to a param: the channel goes too');
  assert.deepEqual(setChainRow(c, 'outputs', 0, { part: 'hair' }).outputs, [{ scale: 1, min: -30, max: 30, part: 'hair' }]);
  assert.equal(setChainRow(c, 'segments', 3, { mass: 2 }), c, 'no such row: unchanged');
});

test('addChainRow and removeChainRow', () => {
  const c = chain();
  assert.deepEqual(addChainRow(c, 'inputs').inputs[1], { param: 'turn', weight: 1 }, 'a new input copies the last');
  assert.deepEqual(addChainRow({ ...c, inputs: [] }, 'inputs', 'tilt').inputs, [{ param: 'tilt', weight: 1 }]);
  assert.deepEqual(addChainRow({ ...c, outputs: [] }, 'outputs', 'sway').outputs, [{ param: 'sway', scale: 1 }]);
  assert.deepEqual(addChainRow({ ...c, segments: [] }, 'segments').segments, [DEFAULT_SEGMENT]);
  const three = { ...c, segments: [1, 2, 3].map(length => ({ ...DEFAULT_SEGMENT, length })), outputs: [{ param: 'a', scale: 1, segment: 0 }, { param: 'b', scale: 1, segment: 1 }, { param: 'c', scale: 1, segment: 2 }, { param: 'd', scale: 1 }] };
  const r = removeChainRow(three, 'segments', 1);
  assert.deepEqual(r.segments.map(s => s.length), [1, 3]);
  assert.deepEqual(r.outputs, [{ param: 'a', scale: 1, segment: 0 }, { param: 'b', scale: 1 }, { param: 'c', scale: 1, segment: 1 }, { param: 'd', scale: 1 }], 'outputs follow their segment; the removed one reads the last');
  assert.deepEqual(removeChainRow(c, 'inputs', 0).inputs, []);
});

test('setChainWind adds, merges and removes the chain\'s own wind', () => {
  const w = setChainWind(chain(), {});
  assert.deepEqual(w.wind, { strength: 6, noise: 0.8 });
  assert.deepEqual(setChainWind(w, { strength: 2, frequency: 0.5 }).wind, { strength: 2, noise: 0.8, frequency: 0.5 });
  assert.deepEqual(setChainWind(w, { noise: undefined }).wind, { strength: 6 });
  assert.equal('wind' in setChainWind(w, null), false);
});

test('problemRow points a checkPhysics message at its row', () => {
  const messages = [];
  checkPhysics({ physics: { hair: chain({ inputs: [{ param: 'turn', weight: 1 }, { param: 'nope', weight: 1 }], segments: [{ ...DEFAULT_SEGMENT, mass: 0 }] }) }, parameters: [{ id: 'turn', min: -1, max: 1, default: 0 }, { id: 'sway', min: -1, max: 1, default: 0 }] }, new Set(), m => messages.push(m));
  assert.deepEqual(messages.map(problemRow), [{ list: 'inputs', index: 1 }, { list: 'segments', index: 0 }]);
  assert.equal(problemRow('physics: chains feed each other in a cycle (a > b > a)'), null);
  assert.equal(problemRow('physics.hair.wind: needs a numeric strength'), null);
});
