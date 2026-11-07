import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dragBone, gizmoFrame, boneWorld, invertMatrix, wrapDeg, offsetMatrix, applyMatrix, mulMatrix, BONE_REST, NO_OFFSET,
  worldToScreen, screenToWorld, zoomViewAt, wheelFactor, panBy, fitBounds, handleSize, handleScale, MIN_ZOOM, MAX_ZOOM,
} from '../../dist/engine/src/index.js';

const off = o => ({ ...NO_OFFSET, ...o });
const near = (got, want, eps = 1e-9) => assert.ok(Math.abs(got - want) < eps, `${got} vs ${want}`);
const nearP = (got, want, eps = 1e-9) => { near(got[0], want[0], eps); near(got[1], want[1], eps); };
const rot = deg => { const r = deg * Math.PI / 180; return { a: Math.cos(r), b: Math.sin(r), c: -Math.sin(r), d: Math.cos(r), tx: 0, ty: 0 }; };
const scaleM = (sx, sy) => ({ a: sx, b: 0, c: 0, d: sy, tx: 0, ty: 0 });
const PIVOT = [100, 50];
const base = { pivot: PIVOT, parent: BONE_REST, unit: 1, start: NO_OFFSET };
const drag = (extra) => dragBone({ ...base, ...extra });

test('invertMatrix undoes a matrix and refuses a singular one', () => {
  const m = mulMatrix({ ...rot(30), tx: 5, ty: -7 }, scaleM(2, 3));
  const i = invertMatrix(m);
  const p = applyMatrix(i, ...applyMatrix(m, 12, 34));
  nearP(p, [12, 34]);
  assert.equal(invertMatrix(scaleM(0, 1)), null);
});

test('move in a root bone follows the pointer', () => {
  const o = drag({ tool: 'move', from: [10, 10], to: [25, 4] });
  assert.deepEqual([o.dx, o.dy], [15, -6]);
});

test('move through a rotated parent moves the pivot exactly with the pointer', () => {
  const parent = { ...rot(90), tx: 40, ty: 20 };
  const from = [60, 60], to = [75, 52];
  const o = drag({ tool: 'move', parent, from, to });
  const before = applyMatrix(boneWorld(parent, NO_OFFSET, PIVOT, 1), ...PIVOT);
  const after = applyMatrix(boneWorld(parent, o, PIVOT, 1), ...PIVOT);
  nearP([after[0] - before[0], after[1] - before[1]], [to[0] - from[0], to[1] - from[1]]);
});

test('move through a scaled parent divides the delta by the scale; unit is honoured', () => {
  const o = drag({ tool: 'move', parent: scaleM(2, 4), from: [0, 0], to: [10, 20] });
  nearP([o.dx, o.dy], [5, 5]);
  const u = drag({ tool: 'move', unit: 10, from: [0, 0], to: [10, 20] });
  nearP([u.dx, u.dy], [1, 2]);
});

test('move starts from the existing offset and axis handles constrain to the space', () => {
  const o = drag({ tool: 'move', start: off({ dx: 3, dy: 4 }), from: [0, 0], to: [10, 10], axis: 'x' });
  nearP([o.dx, o.dy], [13, 4]);
  // local x of a bone turned 90 degrees points down the canvas
  const l = drag({ tool: 'move', start: off({ rot: 90 }), from: [0, 0], to: [10, 10], axis: 'x', space: 'local' });
  nearP([l.dx, l.dy], [0, 10]);
  const w = drag({ tool: 'move', start: off({ rot: 90 }), from: [0, 0], to: [10, 10], axis: 'x', space: 'world' });
  nearP([w.dx, w.dy], [10, 0]);
});

test('rotate sweeps the pointer angle around the pivot', () => {
  const o = drag({ tool: 'rotate', from: [200, 50], to: [100, 150] });
  near(o.rot, 90);
  const back = drag({ tool: 'rotate', start: off({ rot: 10 }), from: [200, 50], to: [200 - 1, 50 - 1] });
  assert.ok(back.rot < 10);
});

test('rotate through a rotated and a scaled parent still reads the sweep in the parent space', () => {
  const parent = mulMatrix({ ...rot(37), tx: 11, ty: -5 }, scaleM(1.7, 1.7));
  const pivotWorld = applyMatrix(parent, ...PIVOT);
  const at = deg => [pivotWorld[0] + 80 * Math.cos((deg + 37) * Math.PI / 180), pivotWorld[1] + 80 * Math.sin((deg + 37) * Math.PI / 180)];
  const o = drag({ tool: 'rotate', parent, from: at(10), to: at(55) });
  near(o.rot, 45, 1e-7);
});

test('rotate around a pivot that has moved uses its current position', () => {
  const o = drag({ tool: 'rotate', start: off({ dx: 30 }), from: [230, 50], to: [130, 150] });
  near(o.rot, 90);
});

test('rotate in a mirrored parent keeps the pointer under the cursor', () => {
  const parent = scaleM(-1, 1);
  const pivotWorld = applyMatrix(parent, ...PIVOT);
  const o = drag({ tool: 'rotate', parent, from: [pivotWorld[0] + 50, pivotWorld[1]], to: [pivotWorld[0], pivotWorld[1] + 50] });
  // pointer went from +x to +y in the mirrored world; in the bone's own space that is -x to +y: a quarter turn the other way round
  near(o.rot, -90);
});

test('shift snaps the resulting rotation to 15 degrees', () => {
  const free = drag({ tool: 'rotate', from: [200, 50], to: [200, 50 + 100 * Math.tan(20 * Math.PI / 180)] });
  near(free.rot, 20, 1e-7);
  const snapped = drag({ tool: 'rotate', from: [200, 50], to: [200, 50 + 100 * Math.tan(20 * Math.PI / 180)], mods: { shift: true } });
  near(snapped.rot, 15);
  const s2 = drag({ tool: 'rotate', start: off({ rot: 4 }), from: [200, 50], to: [200, 50 + 100 * Math.tan(20 * Math.PI / 180)], mods: { shift: true } });
  near(s2.rot, 30); // 24 snaps up to 30
});

test('wrapDeg folds into (-180, 180]', () => {
  near(wrapDeg(190), -170);
  near(wrapDeg(-190), 170);
  near(wrapDeg(180), 180);
  near(wrapDeg(-180), 180);
  near(wrapDeg(720), 0);
});

test('scale from the pivot stretches by the pointer ratio, per axis', () => {
  const o = drag({ tool: 'scale', from: [200, 150], to: [300, 250] }); // vector (100,100) -> (200,200)
  nearP([o.sx, o.sy], [1, 1]);
  const stretch = drag({ tool: 'scale', from: [200, 150], to: [300, 200] }); // (100,100) -> (200,150)
  nearP([stretch.sx, stretch.sy], [1, 0.5]);
  nearP([stretch.dx, stretch.dy], [0, 0]); // pivot-anchored: no drift
});

test('scale axis handle touches one axis; shift ties the other to it', () => {
  const x = drag({ tool: 'scale', from: [200, 150], to: [300, 250], axis: 'x' });
  nearP([x.sx, x.sy], [1, 0]);
  const both = drag({ tool: 'scale', from: [200, 150], to: [300, 250], axis: 'x', mods: { shift: true } });
  nearP([both.sx, both.sy], [1, 1]);
});

test('shift keeps the ratio when stretching freely', () => {
  const o = drag({ tool: 'scale', from: [200, 150], to: [300, 200], mods: { shift: true } }); // (100,100) -> (200,150): projection 1.75
  near(o.sx, 0.75);
  near(o.sy, 0.75);
});

test('scale in a scaled and rotated parent measures in parent space', () => {
  const parent = mulMatrix({ ...rot(40), tx: 9, ty: 3 }, scaleM(2, 2));
  const pw = applyMatrix(parent, ...PIVOT);
  const dir = [Math.cos(40 * Math.PI / 180), Math.sin(40 * Math.PI / 180)];
  const at = k => [pw[0] + dir[0] * k, pw[1] + dir[1] * k];
  const o = drag({ tool: 'scale', parent, from: at(60), to: at(90), axis: 'x' });
  near(o.sx, 0.5, 1e-9);
});

test('scale along a rotated bone uses its own axes', () => {
  // bone turned 90 degrees: its local x runs down the canvas
  const o = drag({ tool: 'scale', start: off({ rot: 90 }), from: [100, 150], to: [100, 250], axis: 'x' });
  nearP([o.sx, o.sy], [1, 0]);
});

test('alt scales around the centre: that point stays fixed in world space', () => {
  const parent = { ...rot(25), tx: 7, ty: 8 };
  const centre = [140, 90];
  const start = off({ dx: 4, dy: -3, rot: 20, sx: 0.2 });
  const pw = applyMatrix(parent, PIVOT[0] + 4, PIVOT[1] - 3);
  const o = drag({ tool: 'scale', parent, start, from: [pw[0] + 40, pw[1] + 10], to: [pw[0] + 90, pw[1] + 60], mods: { alt: true }, center: centre });
  const worldOf = off2 => applyMatrix(boneWorld(parent, off2, PIVOT, 1), ...centre);
  nearP(worldOf(o), worldOf(start), 1e-7);
  assert.notEqual(o.sx, start.sx);
  // without alt the pivot is the one that stays
  const p = drag({ tool: 'scale', parent, start, from: [pw[0] + 40, pw[1] + 10], to: [pw[0] + 90, pw[1] + 60], center: centre });
  nearP(applyMatrix(boneWorld(parent, p, PIVOT, 1), ...PIVOT), applyMatrix(boneWorld(parent, start, PIVOT, 1), ...PIVOT), 1e-7);
});

test('scale ignores a zero-length start vector and a singular parent leaves the offset alone', () => {
  const o = drag({ tool: 'scale', from: PIVOT, to: [200, 200] });
  assert.ok(Number.isFinite(o.sx) && Number.isFinite(o.sy));
  const s = drag({ tool: 'move', parent: scaleM(0, 1), from: [0, 0], to: [5, 5], start: off({ dx: 2 }) });
  assert.deepEqual(s, off({ dx: 2 }));
});

test('gizmoFrame sits on the moved pivot and turns with parent and bone in local space', () => {
  const parent = { ...rot(90), tx: 10, ty: 0 };
  const f = gizmoFrame(parent, off({ dx: 5, rot: 30 }), PIVOT, 1);
  nearP(f.origin, applyMatrix(parent, 105, 50));
  nearP(f.x, [Math.cos(120 * Math.PI / 180), Math.sin(120 * Math.PI / 180)]);
  nearP(f.y, [-Math.sin(120 * Math.PI / 180), Math.cos(120 * Math.PI / 180)]);
  const w = gizmoFrame(parent, off({ rot: 30 }), PIVOT, 1, 'world');
  assert.deepEqual([w.x, w.y], [[1, 0], [0, 1]]);
});

// ---- viewport ----

test('screen and world conversions are inverses', () => {
  const v = { zoom: 2.5, panX: 30, panY: -12 };
  nearP(screenToWorld(v, worldToScreen(v, [17, 99])), [17, 99]);
  nearP(worldToScreen(v, [0, 0]), [30, -12]);
});

test('zoom toward the cursor keeps the point under it fixed', () => {
  let v = { zoom: 1, panX: 0, panY: 0 };
  const cursor = [320, 210];
  const under = screenToWorld(v, cursor);
  for (const f of [1.1, 1.1, 0.5, 3, 0.9]) {
    v = zoomViewAt(v, cursor, f);
    nearP(screenToWorld(v, cursor), under, 1e-9);
  }
  nearP(worldToScreen(v, under), cursor, 1e-9);
});

test('zoom is clamped and a clamped zoom still keeps the cursor point', () => {
  let v = { zoom: 20, panX: 5, panY: 5 };
  const cursor = [100, 100];
  const under = screenToWorld(v, cursor);
  v = zoomViewAt(v, cursor, 10);
  assert.equal(v.zoom, MAX_ZOOM);
  nearP(screenToWorld(v, cursor), under);
  v = zoomViewAt(v, cursor, 1e-9);
  assert.equal(v.zoom, MIN_ZOOM);
  nearP(screenToWorld(v, cursor), under);
});

test('wheel factor zooms in on a negative delta, out on a positive one, and cancels out', () => {
  assert.ok(wheelFactor(-100) > 1 && wheelFactor(100) < 1);
  near(wheelFactor(-50) * wheelFactor(50), 1);
});

test('pan moves the view by screen pixels', () => {
  const v = panBy({ zoom: 2, panX: 1, panY: 2 }, 10, -4);
  assert.deepEqual(v, { zoom: 2, panX: 11, panY: -2 });
  nearP(screenToWorld(v, [11, -2]), [0, 0]);
});

test('fitBounds centres the box with the margin and limits by the tighter side', () => {
  const box = { x: 100, y: 200, w: 400, h: 200 };
  const v = fitBounds(box, 800, 600, 50);
  near(v.zoom, 1.75); // width: 700 / 400, height: 500 / 200
  nearP(worldToScreen(v, [300, 300]), [400, 300]);
  const left = worldToScreen(v, [100, 300])[0], right = worldToScreen(v, [500, 300])[0];
  near(left - 50, 800 - 50 - right);
  const tall = fitBounds({ x: 0, y: 0, w: 100, h: 1000 }, 800, 600, 0);
  near(tall.zoom, 0.6);
  assert.ok(fitBounds({ x: 0, y: 0, w: 1, h: 1 }, 800, 600, 0).zoom === MAX_ZOOM);
});

test('fitBounds copes with an empty box and a tiny area', () => {
  const v = fitBounds({ x: 10, y: 20, w: 0, h: 0 }, 200, 100);
  assert.equal(v.zoom, 1);
  nearP(worldToScreen(v, [10, 20]), [100, 50]);
  assert.ok(Number.isFinite(fitBounds({ x: 0, y: 0, w: 10, h: 10 }, 10, 10, 24).zoom));
});

test('handles keep their on-screen size under zoom', () => {
  for (const zoom of [0.25, 1, 4, 16]) {
    const v = { zoom, panX: 0, panY: 0 };
    near(handleSize(v, 12) * zoom, 12);
    near(handleScale(v) * zoom, 1);
  }
});
