// Screen effects: camera pan, weather, filter, the iris/blinds/pixelate transitions and their pure helpers (engine/src/fx.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compile, Runtime, NullRenderer, getCompletions,
  filterMatrix, IDENTITY, blurRadius, weatherCount, WEATHER, WEATHER_NAMES, spawnParticle, stepParticle, mulberry32,
  irisRadius, blindsRects, pixelBlock,
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
  for (const bad of ['weather', 'weather hail', 'weather rain 2', 'filter', 'filter glow', 'filter blur 1.5']) {
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
