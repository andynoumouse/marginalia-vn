import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAssets, checkRig, compile, getCompletions, layerPoses, lerpParams, NullRenderer, Runtime, resolveParams } from '../../dist/engine/src/index.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
const params = [
  { id: 'look_x', min: -1, max: 1, default: 0 },
  { id: 'mouth', min: 0, max: 1, default: 0 },
  { id: 'brow', min: 0, max: 1, default: 0.5, ease: 'in' },
];
const poses = { happy: { mouth: 1, brow: 0.9 }, sad: { mouth: 0.1, brow: 0.1 }, left: { look_x: -1 } };
const manifest = rig => ({ width: 100, height: 100, parts: [{ file: 'head.png' }], rig });
const build = lines => compile([{ file: 't.vn', text: `define robo "Robo"\nlabel start:\n${lines.map(l => `  ${l}`).join('\n')}\n  end\n` }]);
const errs = p => p.diagnostics.filter(d => d.severity === 'error').map(d => d.message);

test('layerPoses: later poses win, unknown names add nothing', () => {
  assert.deepEqual(layerPoses(poses, ['happy', 'left']), { mouth: 1, brow: 0.9, look_x: -1 });
  assert.deepEqual(layerPoses(poses, ['sad', 'happy']), { mouth: 1, brow: 0.9 });
  assert.deepEqual(layerPoses(poses, ['nope']), {});
  assert.deepEqual(layerPoses(undefined, ['happy']), {});
});

test('lerpParams: per-parameter easing, untouched parameters stay, results are clamped', () => {
  const from = resolveParams(params, {});
  const to = resolveParams(params, { mouth: 1, brow: 1, look_x: 0.6 });
  const mid = lerpParams(params, from, to, 0.5);
  close(mid.mouth, 0.5); // no ease on the definition: linear
  close(mid.brow, 0.5 + 0.5 * 0.125); // `in` curve of the definition
  close(lerpParams(params, from, to, 0.5, 'out').brow, 0.5 + 0.5 * 0.875); // the line's ease wins
  const still = lerpParams(params, from, { ...from, mouth: 1 }, 0.5);
  assert.equal(still.look_x, 0);
  assert.equal(still.brow, 0.5);
  assert.deepEqual(lerpParams(params, from, to, 1), to);
  assert.equal(lerpParams(params, from, { ...to, look_x: 1 }, 0.8, 'back').look_x, 1); // overshoot is clamped
});

test('parse: show pose=, animate pose= and parameter=value', () => {
  const p = build(['show robo pose=happy,left', 'animate robo look_x=0.6 mouth=0.8 over 0.4s', 'animate robo pose=sad mouth=0 over 0.5s ease=out nowait', 'animate robo pose=happy']);
  assert.deepEqual(errs(p), []);
  const show = p.ops.find(o => o.op === 'show');
  assert.deepEqual(show.poses, ['happy', 'left']);
  assert.deepEqual(show.overrides, {});
  const ops = p.ops.filter(o => o.op === 'param').map(({ poses, params, dur, ease, nowait }) => ({ poses, params, dur, ease, nowait }));
  assert.deepEqual(ops, [
    { poses: [], params: { look_x: 0.6, mouth: 0.8 }, dur: 0.4, ease: null, nowait: undefined },
    { poses: ['sad'], params: { mouth: 0 }, dur: 0.5, ease: 'out', nowait: true },
    { poses: ['happy'], params: {}, dur: 0, ease: null, nowait: undefined },
  ]);
  assert.equal(build(['show robo']).ops.find(o => o.op === 'show').poses, undefined);
});

test('parse: bad pose and parameter arguments', () => {
  const run = line => build([line]).diagnostics.map(d => d.message).join('|');
  assert.match(run('animate robo pose=happy over'), /duration after over like 0.5s/);
  assert.match(run('animate robo pose=happy over -1s'), /cannot be negative/);
  assert.match(run('animate robo mouth=x'), /number/);
  assert.match(run('animate robo mouth=1 fast'), /Use: animate/);
  assert.match(run('animate robo mouth=1 ease=wobble'), /Unknown ease/);
  assert.match(run('animate robo pose=a,b-c'), /pose= takes/);
  assert.match(run('show robo pose='), /pose= takes/);
  assert.match(run('animate bob pose=happy'), /Unknown character/);
});

test('state: poses and values layer in order and persist until hide', async () => {
  const p = build(['show robo pose=happy', 'animate robo look_x=0.6', 'animate robo pose=sad mouth=0.4 over 0.5s', '"mid"', 'show robo pose=left', '"again"', 'hide robo', 'show robo', '"fresh"']);
  p.rigPoses = { robo: poses };
  const r = new NullRenderer(), seen = [];
  const rt = new Runtime(p, r);
  const say = r.say.bind(r);
  r.say = async ev => { seen.push({ ...rt.state.sprites[0].params }); return say(ev); };
  await rt.start();
  assert.deepEqual(seen, [
    { mouth: 0.4, brow: 0.1, look_x: 0.6 }, // the parameter after the pose wins; look_x is kept
    { mouth: 0.4, brow: 0.1, look_x: -1 },  // a show with a pose lays it over what is there
    {},                                     // hide and show: back to the defaults
  ]);
});

test('checkRig: poses name parameters in range', () => {
  const msgs = rig => checkRig(manifest(rig)).map(p => p.message);
  assert.deepEqual(msgs({ parameters: params, poses }), []);
  assert.deepEqual(msgs({ parameters: params, poses: { a: { nope: 1 } } }), ['poses.a: no parameter "nope" (parameters: look_x, mouth, brow)']);
  assert.match(msgs({ parameters: params, poses: { a: { mouth: 2 } } })[0], /2 lies outside "mouth" \(0 to 1\)/);
  assert.match(msgs({ parameters: params, poses: { a: { mouth: 'x' } } })[0], /must be a number/);
  assert.match(msgs({ parameters: params, poses: { a: {} } })[0], /names no parameter/);
  assert.match(msgs({ parameters: params, poses: { 'a b': { mouth: 1 } } })[0], /not a usable name/);
  assert.match(msgs({ parameters: params, poses: [] })[0], /poses: needs an object/);
  assert.match(msgs({ parameters: [{ ...params[0], ease: 'wobble' }] })[0], /unknown ease "wobble"/);
});

test('checkAssets: unknown poses, parameters and out-of-range values', () => {
  const p = build(['show robo pose=happy', 'show robo pose=nope', 'animate robo pose=sad,zzz look_x=3 brow=0.2', 'animate robo bogus=1']);
  const index = { files: [], rigs: { robo: manifest({ parameters: params, poses }) } };
  const warns = checkAssets(p, index).map(d => d.message);
  assert.equal(warns.length, 4);
  assert.match(warns[0], /robo has no pose "nope".*happy, sad, left/);
  assert.match(warns[1], /no pose "zzz"/);
  assert.match(warns[2], /look_x of robo runs from -1 to 1, not 3/);
  assert.match(warns[3], /no parameter "bogus".*look_x, mouth, brow/);
});

test('completions offer the rig poses and parameters', () => {
  const p = build(['show robo']);
  const rigs = { robo: manifest({ parameters: params, poses }) };
  const show = getCompletions(p, '  show robo ', rigs).map(s => s.label);
  assert.ok(show.includes('pose=happy') && show.includes('pose=left'));
  const first = getCompletions(p, '  animate robo ', rigs).map(s => s.label);
  assert.ok(first.includes('nod') && first.includes('pose=sad') && first.includes('mouth=0'));
  const later = getCompletions(p, '  animate robo mouth=1 ', rigs).map(s => s.label);
  assert.ok(later.includes('over') && later.includes('ease=out') && later.includes('look_x=0') && !later.includes('nod'));
});
