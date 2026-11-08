// Screen effects: camera pan, weather, filter, the iris/blinds/pixelate transitions and their pure helpers (engine/src/fx.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compile, Runtime, NullRenderer, getCompletions,
  filterMatrix, IDENTITY, blurRadius, weatherCount, WEATHER, WEATHER_NAMES, spawnParticle, stepParticle, spawnBurst, stepBurst, windVelocity, WIND_PX, mulberry32,
  irisRadius, blindsRects, revealShapes, shakeOffset, cameraPivot, pixelBlock, maskReveal, assetContext, opAssets, checkAssets,
} from '../../dist/engine/src/index.js';

const build = lines => compile([{ file: 'a.vn', text: lines.join('\n') }]);
const ops = (name, p) => p.ops.filter(o => o.op === name);

test('camera pan: parsed without a zoom, keeps the zoom in the state, resets on scene', async () => {
  const p = build(['label start:', '  scene a', '  camera zoom 1.5 at left 0.2', '  camera pan right y=0.3 1.2 ease=out', '  "x"', '  scene b', '  "y"']);
  assert.deepEqual(p.diagnostics, []);
  const [, pan] = ops('camera', p);
  assert.deepEqual([pan.zoom, pan.x, pan.y, pan.dur, pan.ease], [null, 0.8, 0.3, 1.2, 'out']);
  const rt = new Runtime(p, new NullRenderer());
  const seen = [];
  rt.renderer.say = async ev => { seen.push(structuredClone(rt.state.camera)); };
  await rt.start();
  assert.deepEqual(seen[0], { zoom: 1.5, x: 0.8, y: 0.3 });
  assert.deepEqual(seen[1], { zoom: 1, x: 0.5, y: 0.5 });
});

test('camera pan: bad arguments are parse errors', () => {
  for (const bad of ['camera pan', 'camera pan sideways', 'camera spin']) {
    const p = build(['label start:', `  ${bad}`]);
    assert.equal(p.diagnostics.length, 1, bad);
  }
});

test('weather and filter: parsing, lasting state, reset on scene', async () => {
  const p = build([
    'label start:', '  scene a', '  weather rain 0.8 2', '  filter sepia 0.5 1', '  "x"',
    '  weather snow', '  filter blur', '  "y"', '  weather off', '  filter off', '  "z"', '  weather petals', '  filter night', '  scene b', '  "w"',
  ]);
  assert.deepEqual(p.diagnostics, []);
  const [rain, snow, off1, petals] = ops('weather', p);
  assert.deepEqual([rain.kind, rain.intensity, rain.dur], ['rain', 0.8, 2]);
  assert.deepEqual([snow.kind, snow.intensity, snow.dur], ['snow', 0.6, 0]);
  assert.equal(off1.kind, null);
  assert.equal(petals.kind, 'petals');
  const [sepia, blur] = ops('filter', p);
  assert.deepEqual([sepia.name, sepia.strength, sepia.dur], ['sepia', 0.5, 1]);
  assert.deepEqual([blur.name, blur.strength], ['blur', 1]);
  const rt = new Runtime(p, new NullRenderer());
  const seen = [];
  rt.renderer.say = async () => { seen.push([rt.state.weather, rt.state.filter]); };
  await rt.start();
  assert.deepEqual(seen[0], [{ kind: 'rain', intensity: 0.8 }, { name: 'sepia', strength: 0.5 }]);
  assert.deepEqual(seen[1], [{ kind: 'snow', intensity: 0.6 }, { name: 'blur', strength: 1 }]);
  assert.deepEqual(seen[2], [null, null]);
  assert.deepEqual(seen[3], [null, null]); // the scene before it cleared both
});

test('weather and filter: bad arguments are parse errors', () => {
  for (const bad of ['weather', 'weather hail', 'weather rain 2', 'filter', 'filter glitter', 'filter blur 1.5']) {
    const p = build(['label start:', `  ${bad}`]);
    assert.equal(p.diagnostics.length, 1, bad);
  }
});

test('weather and filter survive a restore into the middle of the story', async () => {
  const p = build(['label start:', '  scene a', '  weather embers 0.3', '  filter vignette', '  "x"', '  "y"']);
  const rt = new Runtime(p, new NullRenderer());
  await rt.restore({ file: 'a.vn', line: 6 });
  assert.deepEqual(rt.state.weather, { kind: 'embers', intensity: 0.3 });
  assert.deepEqual(rt.state.filter, { name: 'vignette', strength: 1 });
});

test('scene accepts the iris, blinds and pixelate transitions', () => {
  const p = build(['label start:', '  scene a iris 1', '  scene b blinds', '  scene c pixelate 0.8', '  scene d wipe up 0.4']);
  assert.deepEqual(p.diagnostics, []);
  assert.deepEqual(ops('scene', p).map(o => [o.transition, o.dur, o.dir]), [['iris', 1, null], ['blinds', 0.5, null], ['pixelate', 0.8, null], ['wipe', 0.4, 'up']]);
});

test('completions offer the new commands and arguments', () => {
  const p = build(['label start:', '  "x"']);
  const labels = line => getCompletions(p, line).map(s => s.label);
  assert.ok(labels('  wea').includes('weather'));
  assert.ok(labels('  fil').includes('filter'));
  assert.deepEqual(labels('  weather ').slice(0, 5), [...WEATHER_NAMES, 'off']);
  assert.ok(labels('  filter ').includes('night'));
  assert.ok(labels('  camera ').includes('pan'));
  assert.ok(labels('  camera pan ').includes('right'));
  assert.ok(labels('  scene a ').includes('pixelate'));
});

test('filterMatrix: identity at 0, the full matrix at 1, in between at half; null for blur and vignette', () => {
  assert.deepEqual(filterMatrix('sepia', 0), IDENTITY);
  assert.equal(filterMatrix('sepia', 1)[0], 0.393);
  assert.ok(Math.abs(filterMatrix('grayscale', 0.5)[0] - (1 + 0.299) / 2) < 1e-9);
  assert.equal(filterMatrix('blur', 1), null);
  assert.equal(filterMatrix('vignette', 1), null);
  assert.ok(Math.abs(filterMatrix('night', 5)[0] - 0.45) < 1e-9); // strength is clamped
  assert.equal(blurRadius(2), blurRadius(1));
  assert.equal(blurRadius(0), 0);
});

test('weather: counts follow the intensity; particles fall, drift and are respawned off screen', () => {
  assert.equal(weatherCount('rain', 0), 0);
  assert.equal(weatherCount('rain', 1), WEATHER.rain.count);
  assert.equal(weatherCount('rain', 0.5), WEATHER.rain.count / 2);
  const rand = mulberry32(1);
  for (const kind of WEATHER_NAMES) {
    const p = spawnParticle(kind, rand, 1920, 1080, true);
    assert.ok(p.y >= 0 && p.y <= 1080, kind);
    const y0 = p.y;
    assert.ok(stepParticle(p, kind, 0.01, 0, 1920, 1080), kind);
    assert.equal(Math.sign(p.y - y0), Math.sign(WEATHER[kind].vy[0]), kind); // embers rise, the rest fall
    const edge = spawnParticle(kind, rand, 1920, 1080, false);
    assert.ok(edge.y < 0 || edge.y > 1080, `${kind} starts off screen`);
  }
  const gone = spawnParticle('snow', rand, 1920, 1080, true);
  gone.y = 1080 + 200;
  assert.equal(stepParticle(gone, 'snow', 0, 0, 1920, 1080), false);
});

test('mulberry32 is deterministic and stays in [0, 1)', () => {
  const a = mulberry32(7), b = mulberry32(7);
  for (let i = 0; i < 50; i++) { const v = a(); assert.equal(v, b()); assert.ok(v >= 0 && v < 1); }
});

test('iris, blinds and pixelate geometry', () => {
  assert.equal(irisRadius(0, 1920, 1080), 0);
  assert.ok(irisRadius(1, 1920, 1080) >= Math.hypot(960, 540));
  const closed = blindsRects(0, 12, 1920, 1080), half = blindsRects(0.5, 12, 1920, 1080), open = blindsRects(1, 12, 1920, 1080);
  assert.equal(closed.length, 12);
  assert.ok(closed.every(r => r.w === 0));
  assert.ok(half.every(r => r.w === 80));
  assert.ok(open.every((r, i) => r.x === i * 160 && r.w === 160));
  assert.equal(pixelBlock(0), 1);
  assert.equal(pixelBlock(1), 1);
  assert.equal(pixelBlock(0.5, 64), 64);
  assert.ok(pixelBlock(0.25, 64) < pixelBlock(0.5, 64));
});

test('scene accepts mask=<image> on dissolve; elsewhere it is an error', () => {
  const p = build(['label start:', '  scene a dissolve mask=wipe_clock 0.8', '  scene b mask=radial', '  scene c dissolve', '  scene d mask=x wipe up', '  scene e dissolve mask=']);
  assert.deepEqual(p.diagnostics.map(d => d.line), [5, 6]);
  assert.deepEqual(ops('scene', p).map(o => [o.transition, o.mask, o.dur]), [['dissolve', 'wipe_clock', 0.8], ['dissolve', 'radial', 0.5], ['dissolve', null, 0.5]]);
});

test('maskReveal: dark pixels show first, nothing at 0, everything at 1, monotonic in progress', () => {
  for (const m of [0, 0.3, 1]) { assert.equal(maskReveal(0, m), 0, `m=${m} at 0`); assert.equal(maskReveal(1, m), 1, `m=${m} at 1`); }
  assert.ok(maskReveal(0.4, 0.1) > maskReveal(0.4, 0.9));
  let last = 0;
  for (let k = 0; k <= 1; k += 0.05) { const v = maskReveal(k, 0.5); assert.ok(v >= last); last = v; }
  assert.ok(maskReveal(0.5, 0.5) > 0 && maskReveal(0.5, 0.5) < 1); // a soft edge, not a hard threshold
});

test('mask assets: preloaded with the scene, a missing one is warned about, names are completed', () => {
  const index = { files: ['bg/a.png', 'transitions/wipe_clock.png'], rigs: {} };
  const p = build(['label start:', '  scene a dissolve mask=wipe_clock', '  scene a dissolve mask=wipe_clok']);
  const ctx = assetContext(index);
  assert.deepEqual(opAssets(ops('scene', p)[0], ctx), ['bg/a', 'transitions/wipe_clock']);
  assert.deepEqual(opAssets(ops('scene', p)[1], ctx), ['bg/a']);
  const msgs = checkAssets(p, index).map(d => d.message);
  assert.deepEqual(msgs, ['No mask "wipe_clok" in assets/transitions (did you mean "wipe_clock"?)']);
  assert.ok(getCompletions(p, '  scene a dissolve ', {}, [], undefined, index.files).some(s => s.label === 'mask=wipe_clock'));
});

test('revealShapes: a wipe grows from its side, an iris is one circle, blinds are twelve slats', () => {
  const rect = (t, dir, k) => revealShapes(t, dir, k, 100, 50);
  assert.deepEqual(rect('wipe', 'left', 0.5), [{ rect: { x: 0, y: 0, w: 50, h: 50 } }]);
  assert.deepEqual(rect('wipe', 'right', 0.25), [{ rect: { x: 75, y: 0, w: 25, h: 50 } }]);
  assert.deepEqual(rect('wipe', 'up', 0.5), [{ rect: { x: 0, y: 0, w: 100, h: 25 } }]);
  assert.deepEqual(rect('wipe', 'down', 0.5), [{ rect: { x: 0, y: 25, w: 100, h: 25 } }]);
  assert.deepEqual(rect('iris', 'left', 0.5), [{ circle: { x: 50, y: 25, r: irisRadius(0.5, 100, 50) } }]);
  assert.equal(rect('blinds', 'left', 0.5).length, 12);
});

test('shakeOffset: starts and ends at rest and swings out first', () => {
  assert.equal(shakeOffset(10, 0), 0);
  assert.equal(shakeOffset(10, 1), 0);
  assert.equal(shakeOffset(10, 1 / 6), -10);
  assert.equal(shakeOffset(10, 2 / 6), 10);
  assert.equal(shakeOffset(10, 1 / 12), -5);
});

test('cameraPivot: recovers the pivot from the world offset, the fallback at zoom 1', () => {
  assert.deepEqual(cameraPivot(1, 0, 0, 100, 50, { x: 0.3, y: 0.7 }), { x: 0.3, y: 0.7 });
  // zoom 2 around (0.25, 0.5): offset = pivot * size * (1 - zoom)
  assert.deepEqual(cameraPivot(2, 25 * -1, 25 * -1, 100, 50, { x: 0, y: 0 }), { x: 0.25, y: 0.5 });
});

test('wind: parsing, lasting state, reset on scene, bad arguments', async () => {
  const p = build([
    'label start:', '  scene a', '  wind right 0.6 gusts=0.2 1.5', '  "x"', '  wind left', '  "y"', '  wind off 2', '  "z"', '  wind right 1', '  scene b', '  "w"',
  ]);
  assert.deepEqual(p.diagnostics, []);
  const [right, left, off] = ops('wind', p);
  assert.deepEqual([right.strength, right.gusts, right.dur], [0.6, 0.2, 1.5]);
  assert.deepEqual([left.strength, left.gusts, left.dur], [-0.5, 0.4, 0]);
  assert.deepEqual([off.strength, off.dur], [0, 2]);
  const rt = new Runtime(p, new NullRenderer());
  const seen = [];
  rt.renderer.say = async () => { seen.push(structuredClone(rt.state.wind)); };
  await rt.start();
  assert.deepEqual(seen, [{ strength: 0.6, gusts: 0.2 }, { strength: -0.5, gusts: 0.4 }, null, null]);
  for (const bad of ['wind', 'wind up', 'wind right 3', 'wind right gusts=2', 'wind right gusts=x', 'wind right 1 1 1', 'wind off gusts=0.1', 'wind right fast']) {
    assert.equal(build(['label start:', `  ${bad}`]).diagnostics.length, 1, bad);
  }
});

test('wind completions', () => {
  const p = build(['label start:', '  "x"']);
  const labels = line => getCompletions(p, line).map(s => s.label);
  assert.ok(labels('  wi').includes('wind'));
  assert.deepEqual(labels('  wind ').slice(0, 3), ['right', 'left', 'off']);
});

test('wind and gravity act on weather: sideways push, stronger for light things, fall scaled, zero-g hangs', () => {
  const at = (kind, env) => { const p = spawnParticle(kind, mulberry32(3), 1920, 1080, true); const x = p.x, y = p.y; stepParticle(p, kind, 0.1, 0, 1920, 1080, env); return { dx: p.x - x, dy: p.y - y }; };
  assert.ok(at('snow', { windVx: 400 }).dx > at('snow', {}).dx + 30, 'a wind to the right carries snow right');
  assert.ok(at('snow', { windVx: -400 }).dx < at('snow', {}).dx - 30, 'and a wind to the left carries it left');
  const heavy = at('rain', { windVx: 400 }).dx - at('rain', {}).dx, light = at('petals', { windVx: 400 }).dx - at('petals', {}).dx;
  assert.ok(light > heavy, 'petals feel more of the wind than rain');
  assert.equal(at('snow', { gravity: 0 }).dy, 0);
  assert.ok(Math.abs(at('snow', { gravity: 2 }).dy - 2 * at('snow', {}).dy) < 1e-9);
  assert.ok(at('snow', { gravity: -1 }).dy < 0, 'negative gravity lifts snow');
  // upside-down snow enters from the bottom, and a particle off screen and heading in is not culled
  assert.ok(spawnParticle('snow', mulberry32(1), 1920, 1080, false, { gravity: -1 }).y > 1080);
  const p = spawnParticle('snow', mulberry32(1), 1920, 1080, true);
  p.y = 1200;
  assert.equal(stepParticle(p, 'snow', 0, 0, 1920, 1080, { gravity: -1 }), true);
  assert.equal(stepParticle(p, 'snow', 0, 0, 1920, 1080, { gravity: 1 }), false);
});

test('wind and gravity act on bursts', () => {
  const fall = env => { const p = spawnBurst('confetti', mulberry32(5), 0, 0, 1)[0]; p.vx = 0; p.vy = 0; for (let i = 0; i < 10; i++) stepBurst(p, 'confetti', 0.1, env); return p; };
  assert.ok(fall({ gravity: 0 }).y === 0 && fall({}).y > 100 && fall({ gravity: -1 }).y < -100);
  assert.ok(fall({ windVx: 400 }).x > 50 && fall({ windVx: -400 }).x < -50);
  assert.equal(windVelocity(null, 1), 0);
  assert.equal(windVelocity({ strength: 1, gusts: 0 }, 5), WIND_PX);
  const gusty = [0, 1, 2, 3, 4, 5, 6].map(t => windVelocity({ strength: 1, gusts: 1 }, t));
  assert.ok(Math.max(...gusty) - Math.min(...gusty) > 100 && gusty.every(v => v >= 0 && v <= WIND_PX));
});

test('gravity: parsing, lasting state, reset on scene, bad arguments, completions', async () => {
  const p = build(['label start:', '  scene a', '  gravity 0.3', '  "x"', '  gravity -1', '  "y"', '  gravity reset', '  "z"', '  gravity 2', '  scene b', '  "w"']);
  assert.deepEqual(p.diagnostics, []);
  assert.deepEqual(ops('gravity', p).map(o => o.factor), [0.3, -1, 1, 2]);
  const rt = new Runtime(p, new NullRenderer());
  const seen = [];
  rt.renderer.say = async () => { seen.push(rt.state.gravity ?? null); };
  await rt.start();
  assert.deepEqual(seen, [0.3, -1, null, null]);
  for (const bad of ['gravity', 'gravity heavy', 'gravity 9', 'gravity 1 2', 'gravity reset 1']) {
    assert.equal(build(['label start:', `  ${bad}`]).diagnostics.length, 1, bad);
  }
  assert.ok(getCompletions(p, '  gra').map(s => s.label).includes('gravity'));
});
