import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampParam, paramDefaults, resolveParams, blend1D, blendGrid, evalKeyform, evalTarget, evalAll,
  combineForms, applyLocal, checkRig,
} from '../../dist/engine/src/index.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
const defs = [
  { id: 'head_x', min: -1, max: 1, default: 0, group: 'Head' },
  { id: 'head_y', min: -1, max: 1, default: 0, group: 'Head' },
  { id: 'smile', min: 0, max: 1, default: 0.5 },
];

test('defaults, clamping and resolving', () => {
  assert.deepEqual(paramDefaults(defs), { head_x: 0, head_y: 0, smile: 0.5 });
  assert.equal(clampParam(defs[0], 5), 1);
  assert.equal(clampParam(defs[0], -5), -1);
  assert.equal(clampParam(defs[0], NaN), 0);
  assert.deepEqual(resolveParams(defs, { head_x: 3, nope: 1, smile: 0.2 }), { head_x: 1, head_y: 0, smile: 0.2 });
  assert.deepEqual(paramDefaults(undefined), {});
});

test('1D blending is linear, holds at the ends and ignores key order', () => {
  const keys = [{ at: 1, rot: 20, opacity: 0 }, { at: -1, rot: -10 }, { at: 0, rot: 0 }];
  close(blend1D(keys, -1).rot, -10);
  close(blend1D(keys, -0.5).rot, -5);
  close(blend1D(keys, 0.5).rot, 10);
  close(blend1D(keys, 0.5).opacity, 0.5);
  close(blend1D(keys, 9).rot, 20);
  close(blend1D(keys, -9).rot, -10);
  assert.deepEqual(blend1D([], 0), { dx: 0, dy: 0, sx: 0, sy: 0, rot: 0, opacity: 1 });
  close(blend1D([{ at: 0, dx: 3 }], 7).dx, 3);
});

test('bilinear grid blending: corners, centre, edges', () => {
  const xs = [-1, 0, 1], ys = [-1, 0, 1];
  const forms = ys.flatMap(y => xs.map(x => ({ dx: x * 10, dy: y * 4 })));
  const g = (x, y) => blendGrid(xs, ys, forms, x, y);
  close(g(-1, -1).dx, -10); close(g(1, 1).dy, 4); close(g(0, 0).dx, 0);
  close(g(0.5, -0.25).dx, 5); close(g(0.5, -0.25).dy, -1);
  close(g(5, 5).dx, 10);
  // a non-linear corner shows bilinear interpolation inside a cell
  const cell = blendGrid([0, 1], [0, 1], [{ rot: 0 }, { rot: 10 }, { rot: 20 }, { rot: 0 }], 0.5, 0.5);
  close(cell.rot, 7.5);
});

test('evalKeyform and evalTarget combine several keyforms on one target', () => {
  const kfs = [
    { target: 'head', param: 'head_x', keys: [{ at: -1, rot: -10 }, { at: 1, rot: 10 }] },
    { target: 'head', param: 'smile', keys: [{ at: 0, sx: 0 }, { at: 1, sx: 0.2, opacity: 0.5 }] },
    { target: 'eye', params: ['head_x', 'head_y'], grid: { x: [-1, 1], y: [-1, 1] }, forms: [{ dx: 1 }, { dx: 2 }, { dx: 3 }, { dx: 4 }] },
  ];
  const p = { head_x: 0.5, head_y: 0, smile: 1 };
  close(evalKeyform(kfs[0], p).rot, 5);
  const head = evalTarget(kfs, 'head', p);
  close(head.rot, 5); close(head.sx, 0.2); close(head.opacity, 0.5);
  close(evalTarget(kfs, 'eye', p).dx, 2.75);
  assert.deepEqual(evalTarget(kfs, 'none', p), { dx: 0, dy: 0, sx: 0, sy: 0, rot: 0, opacity: 1 });
  assert.deepEqual(Object.keys(evalAll(kfs, p)).sort(), ['eye', 'head']);
});

test('combining: rotation and translation add, scale and opacity multiply', () => {
  const c = combineForms([{ dx: 0.1, rot: 10, sx: 0.5, opacity: 0.5 }, { dx: 0.2, rot: -4, sx: 1, opacity: 0.5 }]);
  close(c.dx, 0.3); close(c.rot, 6); close(c.sx, 2); close(c.opacity, 0.25);
  const top = applyLocal({ rot: 10, sy: 0.1 }, { rot: 5, sy: 0.1, opacity: 0.5 });
  close(top.rot, 15); close(top.sy, 1.1 * 1.1 - 1); close(top.opacity, 0.5);
});

const rig = rigData => ({ parts: [{ file: 'a.png' }, { file: 'b.png' }], rig: rigData });
const msgs = rigData => checkRig(rig(rigData)).map(p => p.message);

test('checkRig accepts a sound parameter section', () => {
  assert.deepEqual(msgs({
    bones: { head: { pivot: [1, 1] } }, parts: { a: { bone: 'head' } },
    categories: ['Head'], parameters: defs,
    pads: [{ id: 'turn', x: 'head_x', y: 'head_y', group: 'Head' }],
    keyforms: [
      { target: 'head', param: 'head_x', keys: [{ at: -1, rot: -5 }, { at: 1, rot: 5 }] },
      { target: 'a', params: ['head_x', 'head_y'], grid: { x: [-1, 0, 1], y: [-1, 1] }, forms: Array(6).fill({ dx: 1 }) },
    ],
  }), []);
});

test('checkRig reports bad parameters, pads and keyforms', () => {
  const has = (rigData, text) => assert.ok(msgs(rigData).some(m => m.includes(text)), `${text} in ${msgs(rigData).join(' | ')}`);
  has({ parameters: [defs[0], defs[0]] }, 'defined twice');
  has({ parameters: [{ id: 'x', min: 1, max: 1, default: 1 }] }, 'min must be less');
  has({ parameters: [{ id: 'x', min: 0, max: 1, default: 2 }] }, 'default must be');
  has({ parameters: [{ id: 'x', min: 'a', max: 1, default: 0 }] }, 'min and max');
  has({ parameters: {} }, 'needs a list');
  has({ parameters: defs, pads: [{ id: 'p', x: 'head_x', y: 'zzz' }] }, 'no parameter "zzz"');
  has({ parameters: defs, pads: [{ id: 'p', x: 'head_x', y: 'head_x' }] }, 'same parameter');
  has({ parameters: defs, keyforms: [{ target: 'nobody', param: 'smile', keys: [{ at: 0 }] }] }, 'no part or bone');
  has({ parameters: defs, keyforms: [{ target: 'a', param: 'ghost', keys: [{ at: 0 }] }] }, 'no parameter "ghost"');
  has({ parameters: defs, keyforms: [{ target: 'a', param: 'smile', keys: [{ at: 0 }, { at: 2 }] }] }, 'outside "smile"');
  has({ parameters: defs, keyforms: [{ target: 'a', param: 'smile', keys: [{ at: 0 }, { at: 0 }] }] }, 'same value');
  has({ parameters: defs, keyforms: [{ target: 'a', param: 'smile', keys: [{ at: 0, spin: 1 }] }] }, 'unknown field "spin"');
  has({ parameters: defs, keyforms: [{ target: 'a', param: 'smile', keys: [{ at: 0, opacity: -1 }] }] }, 'negative');
  has({ parameters: defs, keyforms: [{ target: 'a', param: 'smile', keys: [] }] }, 'at least one key');
  has({ parameters: defs, keyforms: [{ target: 'a' }] }, 'either param');
  has({ parameters: defs, keyforms: [{ target: 'a', param: 'smile', keys: [{ at: 0 }], params: ['head_x', 'head_y'] }] }, 'either param');
  const grid = { x: [-1, 1], y: [-1, 1] };
  has({ parameters: defs, keyforms: [{ target: 'a', params: ['head_x', 'head_y'], grid, forms: [{}, {}, {}] }] }, 'needs 4 forms');
  has({ parameters: defs, keyforms: [{ target: 'a', params: ['head_x', 'head_x'], grid, forms: Array(4).fill({}) }] }, 'must differ');
  has({ parameters: defs, keyforms: [{ target: 'a', params: ['head_x', 'head_y'], grid: { x: [1, -1], y: [-1, 1] }, forms: Array(4).fill({}) }] }, 'ascending');
  has({ parameters: defs, keyforms: [{ target: 'a', params: ['head_x', 'smile'], grid: { x: [-1, 1], y: [-1, 2] }, forms: Array(4).fill({}) }] }, 'outside "smile"');
});

// ---- mesh-warp deformers ----
import { segment, blendVec, evalDeformer, paramsKey, deformerParams, deformerPoints } from '../../dist/engine/src/index.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} vs ${b}`);
const sway = { id: 'hair_warp', part: 'hair', grid: [2, 1], keyforms: [{ param: 'head_x', keys: [{ at: -1, pts: { 0: [-0.1, 0] } }, { at: 0 }, { at: 1, pts: { 0: [0.1, 0], 5: [0, 0.2] } }] }] };

test('segment finds the span and clamps; blendVec lerps', () => {
  assert.deepEqual(segment([0, 1, 3], 2), [1, 0.5]);
  assert.deepEqual(segment([0, 1], -5), [0, 0]);
  assert.deepEqual(segment([0, 1], 5), [0, 1]);
  assert.deepEqual([...blendVec([0, 2], [4, 2], 0.25)], [1, 2]);
});

test('evalDeformer: 1D keys blend sparse points, missing points are 0', () => {
  assert.equal(deformerPoints(sway), 6);
  const d = evalDeformer(sway, { head_x: 0.5 });
  assert.equal(d.length, 12);
  near(d[0], 0.05); near(d[10], 0); near(d[11], 0.1);
  near(evalDeformer(sway, { head_x: -1 })[0], -0.1);
  near(evalDeformer(sway, { head_x: 9 })[0], 0.1); // clamped to the end key
  assert.equal(evalDeformer({ id: 'x', part: 'p', keyforms: [] }, {}).length, 50); // default 4x4 grid
});

test('evalDeformer: 2D grid blends bilinearly and keyforms add', () => {
  const g = {
    id: 'g', part: 'p', grid: [1, 1], keyforms: [
      { params: ['head_x', 'head_y'], grid: { x: [0, 1], y: [0, 1] }, forms: [{}, { pts: { 0: [1, 0] } }, {}, { pts: { 0: [0, 1] } }] },
      { param: 'smile', keys: [{ at: 0.5, pts: { 3: [0.3, 0] } }] },
    ],
  };
  const d = evalDeformer(g, { head_x: 0.5, head_y: 0.5, smile: 0 });
  near(d[0], 0.25); near(d[1], 0.25); near(d[6], 0.3);
});

test('paramsKey joins the deformer\'s own parameter values', () => {
  assert.deepEqual(deformerParams(sway), ['head_x']);
  assert.equal(paramsKey(sway, { head_x: 0.5, smile: 1 }), '0.5');
  assert.notEqual(paramsKey(sway, { head_x: 0.5 }), paramsKey(sway, { head_x: 0.6 }));
});
