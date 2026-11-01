import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, Runtime, NullRenderer, checkAssets, assetContext, stateAssets, opAssets, getCompletions } from '../../dist/engine/src/index.js';

const errors = p => p.diagnostics.filter(d => d.severity === 'error');
const play = async text => {
  const p = compile([{ file: 't.vn', text }]);
  assert.deepEqual(errors(p), []);
  const r = new NullRenderer();
  const rt = new Runtime(p, r);
  const seen = {};
  r.say = async ev => { seen[ev.text] = structuredClone(rt.state); };
  await rt.start();
  return { p, rt, seen };
};
const parse = line => compile([{ file: 't.vn', text: `label start:\n  ${line}\n  end` }]);
const op = line => parse(line).ops.find(o => o.op === 'sound' || o.op === 'music');

test('sound and music commands parse', () => {
  assert.equal(op('sound play door').action, 'play');
  assert.equal(op('sound play door duck').duck, true);
  assert.equal(op('sound play door').duck, undefined);
  const loop = op('sound loop rain fade 2');
  assert.equal(loop.action, 'loop'); assert.equal(loop.name, 'rain'); assert.equal(loop.fade, 2);
  assert.deepEqual([op('sound stop').name, op('sound stop').fade], [null, 0]);
  assert.deepEqual([op('sound stop rain fade 1.5').name, op('sound stop rain fade 1.5').fade], ['rain', 1.5]);
  assert.deepEqual([op('sound stop fade 1').name, op('sound stop fade 1').fade], [null, 1]);
  assert.equal(op('music pause fade 1').action, 'pause');
  assert.equal(op('music resume').fade, 0);
  assert.equal(op('sound loop rain nowait').nowait, true);
  for (const bad of ['sound loop', 'sound play', 'sound loop rain fade', 'sound play a b', 'sound stop a b', 'sound play a fade 1', 'sound loop a duck', 'sound mute', 'music rewind']) {
    assert.ok(errors(parse(bad)).length > 0, bad);
  }
});

test('ambience and music pause live in the display state', async () => {
  const { rt, seen } = await play([
    'label start:', '  scene a', '  music play theme loop',
    '  sound loop rain', '  sound loop crowd fade 1', '  sound loop rain',
    '  "both"', '  sound stop rain fade 2', '  music pause', '  "one, paused"',
    '  music resume', '  sound stop', '  "none"', '  music stop', '  end',
  ].join('\n'));
  assert.deepEqual(seen.both.ambience, ['rain', 'crowd']);
  assert.equal(seen.both.musicPaused, undefined);
  assert.deepEqual(seen['one, paused'].ambience, ['crowd']);
  assert.equal(seen['one, paused'].musicPaused, true);
  assert.equal(seen['one, paused'].music, 'theme');
  assert.equal('ambience' in seen.none, false);
  assert.equal('musicPaused' in seen.none, false);
  assert.equal('ambience' in rt.state, false);
});

test('music play and stop clear a pause; pause without music does nothing', async () => {
  const { seen } = await play([
    'label start:', '  music pause', '  "idle"', '  music play t', '  music pause', '  music play u', '  "new"', '  music pause', '  music stop', '  "stopped"', '  end',
  ].join('\n'));
  assert.equal('musicPaused' in seen.idle, false);
  assert.equal('musicPaused' in seen.new, false);
  assert.equal('musicPaused' in seen.stopped, false);
});

test('restore and rollback rebuild ambience and pause', async () => {
  const text = ['label start:', '  scene a', '  sound loop rain', '  music play t loop', '  "one"', '  music pause', '  sound stop rain', '  sound loop wind', '  "two"', '  end'].join('\n');
  const p = compile([{ file: 't.vn', text }]);
  const stateAt = async line => {
    const r = new NullRenderer(), rt = new Runtime(p, r);
    let got;
    r.say = () => { got = structuredClone(rt.state); return new Promise(() => {}); }; // hold on the first line reached
    void rt.restore({ file: 't.vn', line });
    await new Promise(res => setTimeout(res, 20));
    return { got, rt };
  };
  const one = await stateAt(5);
  assert.deepEqual(one.got.ambience, ['rain']);
  assert.equal(one.got.musicPaused, undefined);
  const two = await stateAt(9);
  assert.deepEqual(two.got.ambience, ['wind']);
  assert.equal(two.got.musicPaused, true);
  const saved = two.rt.save();
  assert.deepEqual([saved.state.ambience, saved.state.musicPaused], [['wind'], true]);
});

test('sound loops are assets of the state and of the op; stop is not', () => {
  const ctx = assetContext({ files: ['sound/rain.ogg', 'music/t.ogg'] });
  assert.deepEqual(stateAssets({ bg: null, sprites: [], music: 't', ambience: ['rain', 'gone'] }, ctx), ['music/t', 'sound/rain']);
  assert.deepEqual(opAssets(op('sound loop rain'), ctx), ['sound/rain']);
  assert.deepEqual(opAssets(op('sound play rain duck'), ctx), ['sound/rain']);
  assert.deepEqual(opAssets(op('sound stop rain'), ctx), []);
  assert.deepEqual(opAssets(op('sound stop'), ctx), []);
});

test('a missing looping sound is warned about; stop without a name is not', () => {
  const p = parse('sound loop rain');
  assert.ok(checkAssets(p, { files: [] }).some(d => d.message.includes('No sound "rain"')));
  const q = compile([{ file: 't.vn', text: 'label start:\n  sound stop\n  music pause\n  end' }]);
  assert.deepEqual(checkAssets(q, { files: [] }), []);
});

test('completions for sound and music', () => {
  const p = parse('sound play door');
  const labels = line => getCompletions(p, line).map(s => s.label);
  assert.deepEqual(labels('  sound '), ['play', 'loop', 'stop']);
  assert.ok(labels('  sound play door ').includes('duck'));
  assert.ok(labels('  sound stop ').includes('door'));
  assert.deepEqual(labels('  music ').slice(0, 4), ['play', 'stop', 'pause', 'resume']);
});
