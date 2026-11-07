import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPORT_MAX_FPS, EXPORT_MAX_FRAMES, EXPORT_MIN_FPS, exportBackground, exportStem, fitFrame, frameFile, frameProgress, frameStep, frameTime, movieProblem, movieSeconds, planMovie, restStates, resolveAnim, stepPhysics, unionBox,
  ZipStream, readZip, crc32, runMovieExport, readExportOptions, DEFAULT_EXPORT,
} from '../../dist/engine/src/index.js';

test('a single play has a frame for each step and one for the last pose', () => {
  const p = planMovie({ dur: 1, fps: 24 });
  assert.equal(p.frames, 25);
  assert.equal(frameTime(p, 0), 0);
  assert.equal(frameTime(p, 24), 1);
  assert.equal(frameProgress(p, 12), 0.5);
  // 0.25 s at 30 fps is 7.5 frames: the eighth step is past the end and shows the held last pose.
  const q = planMovie({ dur: 0.25, fps: 30 });
  assert.equal(q.frames, 9);
  assert.equal(frameProgress(q, 8), 1);
  assert.ok(Math.abs(frameTime(q, 7) - 7 / 30) < 1e-12);
  assert.equal(movieSeconds(planMovie({ dur: 2, fps: 10 })), 2.1);
});

test('a loop has no repeated end frame, and each cycle starts again at 0', () => {
  const p = planMovie({ dur: 3.5, fps: 30, loop: true });
  assert.equal(p.frames, 105);
  assert.equal(frameTime(p, 0), 0);
  assert.ok(frameTime(p, 104) < p.dur);
  assert.ok(Math.abs(frameTime(p, 104) - 104 / 30) < 1e-9);
  const two = planMovie({ dur: 1, fps: 25, loop: true, loops: 2 });
  assert.equal(two.frames, 50);
  assert.equal(frameTime(two, 25), 0);
  assert.equal(frameProgress(two, 26), frameProgress(two, 1));
  // A length that is no whole number of frames wraps by time, not by frame count.
  const odd = planMovie({ dur: 0.25, fps: 30, loop: true });
  assert.equal(odd.frames, 8);
  assert.ok(Math.abs(frameTime(odd, 7) - 7 / 30) < 1e-12);
});

test('the numbers are put in range; nonsense falls back to the defaults', () => {
  assert.equal(planMovie({ dur: 1, fps: 1000 }).fps, EXPORT_MAX_FPS);
  assert.equal(planMovie({ dur: 1, fps: 0 }).fps, EXPORT_MIN_FPS);
  assert.equal(planMovie({ dur: 1, fps: NaN }).fps, 30);
  assert.equal(planMovie({ dur: -2, fps: 10 }).dur, 1);
  assert.equal(planMovie({ dur: 1, fps: 10, loops: 5 }).loops, 1, 'loops only count for a loop');
  assert.equal(planMovie({ dur: 1, fps: 10, loop: true, loops: 0 }).loops, 1);
  assert.equal(planMovie({ dur: 1, fps: 10, loop: true, loops: 1e9 }).loops, 50);
  assert.equal(frameStep(planMovie({ dur: 1, fps: 25 })), 0.04);
});

test('the lead-in runs before frame 1: a loop wraps backwards from its end, a single play holds its first pose', () => {
  const loop = planMovie({ dur: 1, fps: 10, loop: true, leadIn: 1 });
  assert.equal(loop.lead, 10);
  assert.equal(loop.frames, 10);
  assert.ok(Math.abs(frameTime(loop, -1) - 0.9) < 1e-12);
  assert.equal(frameTime(loop, -10), 0);
  assert.equal(frameTime(loop, -3), frameTime(loop, 7), 'one cycle back is the same moment');
  const once = planMovie({ dur: 1, fps: 10, leadIn: 0.5 });
  assert.equal(once.lead, 5);
  assert.equal(frameTime(once, -5), 0);
  assert.equal(frameTime(once, -1), 0);
  assert.equal(planMovie({ dur: 1, fps: 10 }).lead, 0);
  assert.equal(planMovie({ dur: 1, fps: 10, leadIn: -3 }).lead, 0);
});

test('a size that cannot be drawn or too many frames is a problem before anything runs', () => {
  const p = planMovie({ dur: 1, fps: 30 });
  assert.equal(movieProblem(p, 1280, 720), null);
  assert.match(movieProblem(p, 4, 720), /whole pixels/);
  assert.match(movieProblem(p, 1280.5, 720), /whole pixels/);
  assert.match(movieProblem(p, 9000, 720), /whole pixels/);
  assert.match(movieProblem(planMovie({ dur: 100, fps: 60 }), 1280, 720), new RegExp(`the most is ${EXPORT_MAX_FRAMES}`));
});

test('fitFrame centres the box and draws it as large as the image allows, with a margin', () => {
  // A tall box in a wide image: the height decides.
  const f = fitFrame({ x: 100, y: 50, w: 200, h: 400 }, 800, 600, 0);
  assert.equal(f.resolution, 1.5);
  assert.ok(Math.abs(f.w * f.resolution - 800) < 1e-9 && Math.abs(f.h * f.resolution - 600) < 1e-9);
  assert.ok(Math.abs(f.x + f.w / 2 - 200) < 1e-9 && Math.abs(f.y + f.h / 2 - 250) < 1e-9);
  // A margin shrinks it: 10 % on each side of 400 tall leaves 600 / 480.
  assert.equal(fitFrame({ x: 0, y: 0, w: 200, h: 400 }, 800, 600, 0.1).resolution, 600 / 480);
  // The whole 1280 x 720 stage into 1920 x 1080 is 1.5x, no margin, nothing cropped.
  const s = fitFrame({ x: 0, y: 0, w: 1280, h: 720 }, 1920, 1080, 0);
  assert.deepEqual({ x: s.x, y: s.y, w: s.w, h: s.h, r: s.resolution }, { x: 0, y: 0, w: 1280, h: 720, r: 1.5 });
  // An empty box does not divide by zero.
  assert.ok(Number.isFinite(fitFrame({ x: 5, y: 5, w: 0, h: 0 }, 64, 64).resolution));
});

test('unionBox grows over both and ignores a missing one', () => {
  assert.deepEqual(unionBox({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: -5, w: 20, h: 8 }), { x: 0, y: -5, w: 25, h: 15 });
  assert.deepEqual(unionBox(null, { x: 1, y: 2, w: 3, h: 4 }), { x: 1, y: 2, w: 3, h: 4 });
  assert.equal(unionBox(null, null), null);
});

test('names and colours: files sort in order, a stem is made safe, a background is #rrggbb or transparent', () => {
  assert.equal(frameFile('walk', 0, 30), 'walk_0001.png');
  assert.equal(frameFile('walk', 29, 30), 'walk_0030.png');
  assert.equal(frameFile('walk', 99999, 100000), 'walk_100000.png');
  assert.equal(exportStem('  Robo: walk cycle! ', 'x'), 'Robo_walk_cycle');
  assert.equal(exportStem('...', 'robo'), 'robo');
  assert.equal(exportStem('../../etc', 'x'), 'etc');
  assert.equal(exportBackground('#FF8800'), '#ff8800');
  for (const bad of ['red', '#fff', '#12345g', null, undefined, 5]) assert.equal(exportBackground(bad), null);
});

// What the export promises: the same frames however it is run. The chains are stepped one frame at a time from rest, and nothing
// reads the clock, so two runs agree to the last bit; a lead-in changes frame 1 of a swinging loop, and a held first pose does not.
const chain = { inputs: [{ param: 'turn', weight: 1 }], segments: [{ length: 1, mass: 1, damping: 1.5, stiffness: 40, limit: 40 }], outputs: [{ param: 'sway', scale: 1 }] };
function run(spec, turn) {
  const plan = planMovie(spec), physics = { hair: chain }, out = [];
  let states = restStates(physics);
  for (let n = -plan.lead; n < plan.frames; n++) {
    const r = stepPhysics(physics, states, { turn: turn(frameProgress(plan, n)) }, new Map(), frameStep(plan));
    states = r.states;
    if (n >= 0) out.push(r.params.sway);
  }
  return out;
}
const swing = p => 30 * Math.sin(p * Math.PI * 2);

test('physics from rest, one step per frame, gives the same frames every run', () => {
  const a = run({ dur: 2, fps: 30, loop: true }, swing), b = run({ dur: 2, fps: 30, loop: true }, swing);
  assert.equal(a.length, 60);
  assert.deepEqual(a, b);
  assert.ok(a.some(v => Math.abs(v) > 0.5), 'the chain swings');
  assert.notDeepEqual(run({ dur: 2, fps: 24, loop: true }, swing).slice(0, 5), a.slice(0, 5), 'a different frame rate is a different sampling');
});

test('a lead-in has a swinging loop begin mid-swing, and a held start does not need one', () => {
  const cold = run({ dur: 2, fps: 30, loop: true }, swing), warm = run({ dur: 2, fps: 30, loop: true, leadIn: 20 }, swing);
  assert.equal(cold[0], 0, 'from rest the chain has not moved at frame 1');
  assert.ok(Math.abs(warm[0]) > 2, 'after a lead-in it is already swinging');
  // Settled, a loop repeats: the second cycle starts where the first did.
  const settled = run({ dur: 2, fps: 30, loop: true, loops: 2, leadIn: 20 }, swing);
  assert.ok(Math.abs(settled[0] - settled[60]) < 1e-3, 'cycle 2 starts where cycle 1 did');
  const twice = run({ dur: 2, fps: 30, loop: true, loops: 2 }, swing);
  assert.ok(Math.abs(twice[0] - twice[60]) > 1, 'without the lead-in it does not');
  // A single play starts with the input as the rest value: no kick, no lead-in needed.
  const held = run({ dur: 1, fps: 30, leadIn: 0 }, () => 20);
  assert.ok(held.every(v => Math.abs(v) < 1e-9));
});

test('an animation from the library is sampled at the frame times the plan gives', () => {
  const r = resolveAnim('breathe', {}), plan = planMovie({ dur: r.dur, fps: 30, loop: true });
  assert.equal(plan.frames, 105);
  const values = Array.from({ length: plan.frames }, (_, n) => r.fn(frameProgress(plan, n)).sy ?? 0);
  assert.ok(values.every(v => Number.isFinite(v)));
  assert.equal(values[0], r.fn(0).sy ?? 0);
  assert.ok(Math.max(...values) > 0.005, 'it breathes in during the cycle');
  assert.ok(Math.abs(r.fn(frameProgress(plan, plan.frames)).sy - values[0]) < 1e-9, 'the next cycle begins where this one did');
});

test('ZipStream: pieces added one by one make a store-only zip that reads back', async () => {
  const z = new ZipStream(), pieces = [];
  const files = [['walk_0001.png', new Uint8Array([137, 80, 78, 71, 1, 2, 3])], ['walk_0002.png', new Uint8Array(0)], ['sub/ünï.png', new Uint8Array(70000).map((_, i) => (i * 31) & 255)]];
  for (const [path, bytes] of files) pieces.push(...z.add(path, bytes, Date.UTC(2026, 10, 7)));
  pieces.push(...z.finish());
  assert.equal(z.files, 3);
  const total = pieces.reduce((n, p) => n + p.length, 0), zip = new Uint8Array(total);
  let at = 0;
  for (const p of pieces) { zip.set(p, at); at += p.length; }
  const back = await readZip(zip, async () => { throw new Error('nothing here is deflated'); });
  assert.deepEqual(back.map(e => e.path), files.map(f => f[0]));
  for (let i = 0; i < files.length; i++) assert.deepEqual(back[i].bytes, files[i][1]);
  // The record of the first file: stored (method 0), the checksum and sizes of its bytes, offset 0.
  const v = new DataView(zip.buffer);
  assert.equal(v.getUint32(0, true), 0x04034b50);
  assert.equal(v.getUint16(8, true), 0);
  assert.equal(v.getUint32(14, true), crc32(files[0][1]));
  assert.equal(v.getUint32(18, true), files[0][1].length);
});

test('ZipStream refuses what classic zip cannot describe', () => {
  const z = new ZipStream();
  assert.throws(() => z.add('big.bin', { length: 0xffffffff }), /too much/);
});

test('runMovieExport asks for the frames in order, names the files and reports as it goes', async () => {
  const asked = [], wrote = [], seen = [];
  const r = await runMovieExport({
    frames: 12, stem: 'walk',
    frame: async n => { asked.push(n); await Promise.resolve(); return new Uint8Array([n]); },
    write: (name, bytes) => { wrote.push([name, bytes[0]]); },
    progress: done => seen.push(done),
  });
  assert.deepEqual(r, { written: 12, cancelled: false });
  assert.deepEqual(asked, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.deepEqual(wrote[0], ['walk_0001.png', 0]);
  assert.deepEqual(wrote[11], ['walk_0012.png', 11]);
  assert.deepEqual(seen, asked.map(n => n + 1));
});

test('cancelling stops before the next frame is asked for; a failure stops the run and says why', async () => {
  let stop = false;
  const asked = [];
  const r = await runMovieExport({ frames: 50, stem: 'x', frame: async n => { asked.push(n); if (n === 3) stop = true; return new Uint8Array(1); }, write: () => {}, cancelled: () => stop });
  assert.deepEqual(r, { written: 4, cancelled: true });
  assert.deepEqual(asked, [0, 1, 2, 3]);
  await assert.rejects(runMovieExport({ frames: 5, stem: 'x', frame: async n => { if (n === 2) throw new Error('no GPU'); return new Uint8Array(1); }, write: () => {} }), /no GPU/);
  const wrote = [];
  await assert.rejects(runMovieExport({ frames: 5, stem: 'x', frame: async () => new Uint8Array(1), write: name => { wrote.push(name); if (wrote.length === 2) throw new Error('disk full'); } }), /disk full/);
  assert.equal(wrote.length, 2, 'nothing is written after the failure');
  assert.deepEqual(await runMovieExport({ frames: 0, stem: 'x', frame: async () => { throw new Error('never'); }, write: () => {} }), { written: 0, cancelled: false });
});

test('stored export options come back in range, a field at a time', () => {
  const d = readExportOptions(null);
  assert.deepEqual(d, DEFAULT_EXPORT);
  assert.deepEqual(readExportOptions('not json'), DEFAULT_EXPORT);
  assert.deepEqual(readExportOptions('[1,2]'), DEFAULT_EXPORT);
  const o = readExportOptions(JSON.stringify({ fps: 24.4, loop: true, loops: 3, leadIn: 500, width: 99999, height: 'tall', framing: 'character', background: '#00FF00', save: 'zip', junk: 1 }));
  assert.deepEqual(o, { fps: 24, loop: true, loops: 3, leadIn: 60, width: 4096, height: DEFAULT_EXPORT.height, framing: 'character', background: '#00ff00', save: 'zip' });
  assert.equal(readExportOptions('{"framing":"fit","save":"cloud","background":"red","loop":"yes"}').loop, false);
  assert.equal(readExportOptions('{"framing":"fit","save":"cloud","background":"red"}').save, 'folder');
});
