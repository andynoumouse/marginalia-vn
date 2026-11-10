// Bone-weighted skinning of a free mesh, step 1 (docs/design/skinning.md): compileSkin / skinPoints, placeRig with a skinned part,
// and the weight rules of checkDeformers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileSkin, skinPoints, isSkinned, placeRig, placeParts, applyMatrix, checkDeformers, checkRig, NO_OFFSET, MAX_INFLUENCES } from '../../dist/engine/src/index.js';

const off = o => ({ ...NO_OFFSET, ...o });
const near = (got, want, eps = 1e-4) => got.forEach((g, i) => assert.ok(Math.abs(g - want[i]) < eps, `${JSON.stringify(got)} != ${JSON.stringify(want)}`));
const nearArr = (got, want) => near([...got], want);

const bones = { arm: { pivot: [100, 0] }, forearm: { parent: 'arm', pivot: [200, 0] } };
const box = { x: 0, y: 0, w: 300, h: 20 };
const world = (offsets, skinned, parts = { sleeve: { box, bone: 'arm' } }) => placeRig(bones, parts, new Map(Object.entries(offsets)), () => null, [0, 0], 1, skinned);
// four vertices of the part, in the part's frame (the part sits at the canvas origin unless a test moves it)
const rest = [0, 0, 100, 0, 200, 0, 300, 0];

test('isSkinned: only a mesh with weights', () => {
  assert.equal(isSkinned({ verts: [], tris: [] }), false);
  assert.equal(isSkinned({ weights: {} }), true);
  assert.equal(isSkinned(undefined), false);
});

test('skinPoints: one bone turns its vertices about its pivot; unlisted vertices follow the default bone', () => {
  const skin = compileSkin({ weights: { 3: { arm: 1 } }, defaultBone: 'arm' }, 4);
  const { bones: w } = world({ arm: off({ rot: 90 }) }, new Set(['sleeve']));
  const out = new Float32Array(8);
  skinPoints(skin, rest, [0, 0], w, out);
  // the arm turns 90 degrees about (100, 0): (200, 0) -> (100, 100)
  nearArr(out, [100, -100, 100, 0, 100, 100, 100, 200]);
});

test('skinPoints: no default bone leaves an unlisted vertex at rest', () => {
  const skin = compileSkin({ weights: { 0: { arm: 1 } } }, 2);
  const { bones: w } = world({ arm: off({ rot: 90 }) }, new Set());
  const out = new Float32Array(4);
  skinPoints(skin, [0, 0, 200, 0], [0, 0], w, out);
  nearArr(out, [100, -100, 200, 0]);
});

test('skinPoints: two bones blend by weight; a child bone carries the ones above it', () => {
  const skin = compileSkin({ weights: { 2: { arm: 0.5, forearm: 0.5 }, 3: { forearm: 1 } }, defaultBone: 'arm' }, 4);
  const { bones: w } = world({ forearm: off({ rot: 90 }) }, new Set(['sleeve']));
  const out = new Float32Array(8);
  skinPoints(skin, rest, [0, 0], w, out);
  // the forearm turns about the elbow (200, 0): (300, 0) -> (200, 100); the arm stays: (200, 0) is on the elbow, so it stays too
  nearArr(out.subarray(4), [200, 0, 200, 100]);
  // and when the arm turns as well, the forearm follows it
  const both = world({ arm: off({ rot: 90 }) }, new Set(['sleeve'])).bones;
  skinPoints(skin, rest, [0, 0], both, out);
  nearArr(out.subarray(6), [100, 200]);
  nearArr(out.subarray(4), [100, 100, 100, 200]);
});

test('skinPoints: a pivot elsewhere, a part that sits away from the canvas origin', () => {
  const skin = compileSkin({ weights: {}, defaultBone: 'arm' }, 1);
  const { bones: w } = world({ arm: off({ rot: 90 }) }, new Set(['sleeve']));
  const out = new Float32Array(2);
  // the vertex is at (0, 0) of a part whose origin is (200, 0): canvas (200, 0) -> (100, 100), written back minus the origin
  skinPoints(skin, [0, 0], [200, 0], w, out);
  nearArr(out, [-100, 100]);
});

test('compileSkin: weights are normalized, capped at 4 (the smallest dropped) and junk ignored', () => {
  const skin = compileSkin({ weights: { 0: { a: 2, b: 2 }, 1: { a: 5, b: 4, c: 3, d: 2, e: 1 }, 2: { a: -1, b: NaN, c: 0 } }, defaultBone: 'a' }, 3);
  assert.equal(MAX_INFLUENCES, 4);
  const sum = v => [...skin.weight.subarray(v * 4, v * 4 + 4)].reduce((s, x) => s + x, 0);
  near([sum(0), sum(1), sum(2)], [1, 1, 1]);
  const names = v => [...skin.index.subarray(v * 4, v * 4 + 4)].filter(i => i >= 0).map(i => skin.bones[i]).sort();
  assert.deepEqual(names(0), ['a', 'b']);
  assert.deepEqual(names(1), ['a', 'b', 'c', 'd']); // e is the smallest
  assert.deepEqual(names(2), ['a']); // nothing usable: the default bone
  near([skin.weight[0]], [0.5]);
});

test('skinPoints: a bone with no matrix is at rest', () => {
  const skin = compileSkin({ weights: { 0: { ghost: 1 } } }, 1);
  const out = new Float32Array(2);
  skinPoints(skin, [5, 6], [0, 0], {}, out);
  nearArr(out, [5, 6]);
});

test('placeRig: a skinned part gets the rest matrix and its own key separately', () => {
  const parts = { sleeve: { box, bone: 'arm' }, plain: { box, bone: 'arm' } };
  const offsets = { arm: off({ rot: 90 }), sleeve: off({ rot: 180 }), plain: off({ rot: 180 }) };
  const r = world(offsets, new Set(['sleeve']), parts);
  near(applyMatrix(r.parts.sleeve, 7, 8), [7, 8]);
  assert.deepEqual(Object.keys(r.keys), ['sleeve']);
  // the key turns about the rest pivot of the part's bone (100, 0), in the rest frame: the bone's own turn is not in it
  near(applyMatrix(r.keys.sleeve, 140, 0), [60, 0]);
  // an unskinned part is unchanged: bone, then its own key
  assert.deepEqual(r.parts.plain, placeParts(bones, parts, new Map(Object.entries(offsets)), () => null, [0, 0], 1).plain);
  assert.deepEqual(placeRig(bones, parts, new Map(Object.entries(offsets)), () => null, [0, 0], 1).keys, {});
});

test('invariant: a mesh 100% on the part\'s own bone draws as the unskinned part does, with and without a part key and a moving bone', () => {
  const parts = { sleeve: { box, bone: 'arm' } };
  const verts = [3, 4, 100, 10, 250, 17, 299, 2];
  for (const offsets of [{}, { arm: off({ rot: 40, dx: 5 }) }, { arm: off({ rot: 30, sx: 0.2 }), forearm: off({ rot: -20 }) }, { arm: off({ rot: 25 }), sleeve: off({ rot: 60, dy: 3 }) }]) {
    const flat = placeRig(bones, parts, new Map(Object.entries(offsets)), () => null, [0, 0], 1);
    const skinnedRig = placeRig(bones, parts, new Map(Object.entries(offsets)), () => null, [0, 0], 1, new Set(['sleeve']));
    for (const mesh of [{ weights: { 0: { arm: 1 }, 1: { arm: 1 }, 2: { arm: 1 }, 3: { arm: 1 } } }, { weights: {}, defaultBone: 'arm' }, { weights: { 1: { arm: 3 } }, defaultBone: 'arm' }]) {
      const out = new Float32Array(8);
      skinPoints(compileSkin(mesh, 4), verts, [0, 0], skinnedRig.bones, out, skinnedRig.keys.sleeve);
      const want = [];
      for (let i = 0; i < 8; i += 2) want.push(...applyMatrix(flat.parts.sleeve, verts[i], verts[i + 1]));
      nearArr(out, want);
    }
  }
});

test('a part key and a moving bone at once: the key shapes the vertices first, the bones carry the result', () => {
  const r = world({ arm: off({ rot: 90 }), sleeve: off({ dx: 10 }) }, new Set(['sleeve']));
  const skin = compileSkin({ weights: {}, defaultBone: 'arm' }, 1);
  const out = new Float32Array(2);
  skinPoints(skin, [200, 0], [0, 0], r.bones, out, r.keys.sleeve);
  // shifted 10 along x to (210, 0) first, then the arm turns 90 degrees about (100, 0): (100, 110)
  nearArr(out, [100, 110]);
});

// ---- checkDeformers ----
const quad = mesh => ({ id: 'm', part: 'sleeve', mesh: { verts: [0, 0, 10, 0, 0, 10, 10, 10], tris: [0, 1, 2, 2, 1, 3], ...mesh }, keyforms: [] });
const problems = (def, extra = []) => {
  const out = [];
  checkDeformers({ deformers: [def, ...extra], parameters: [] }, new Set(['sleeve', 'a', 'b']), new Set(['arm', 'forearm', 'x']), new Set(), m => out.push(m), new Map(), new Set(), new Map());
  return out;
};
const has = (list, text) => assert.ok(list.some(m => m.includes(text)), `${text} not in ${JSON.stringify(list)}`);

test('checkDeformers: a skinned mesh checks clean', () => {
  assert.deepEqual(problems(quad({ defaultBone: 'arm', weights: { 1: { arm: 0.6, forearm: 0.4 }, 3: { forearm: 1 } } })), []);
  assert.deepEqual(problems(quad({ weights: {} })), []);
});

test('checkDeformers: bad weights are reported', () => {
  has(problems(quad({ defaultBone: 'ghost' })), 'defaultBone');
  has(problems(quad({ weights: [] })), 'weights');
  has(problems(quad({ weights: { 4: { arm: 1 } } })), 'not a vertex');
  has(problems(quad({ weights: { '1.5': { arm: 1 } } })), 'not a vertex');
  has(problems(quad({ weights: { a: { arm: 1 } } })), 'not a vertex');
  has(problems(quad({ weights: { 0: 1 } })), 'needs { "<bone>": weight }');
  has(problems(quad({ weights: { 0: {} } })), 'is empty');
  has(problems(quad({ weights: { 0: { ghost: 1 } } })), 'no bone named "ghost"');
  has(problems(quad({ weights: { 0: { arm: 0 } } })), 'above 0');
  has(problems(quad({ weights: { 0: { arm: -1, forearm: 2 } } })), 'above 0');
  has(problems(quad({ weights: { 0: { arm: 'x' } } })), 'above 0');
  has(problems(quad({ weights: { 0: { arm: 1, forearm: 1, x: 1, ghost: 1, y: 1 } } })), 'at most 4');
});

test('checkDeformers: weights that do not add up to 1 are reported, a rounding error is not', () => {
  has(problems(quad({ weights: { 0: { arm: 0.5, forearm: 0.3 } } })), 'not 1');
  assert.deepEqual(problems(quad({ weights: { 0: { arm: 0.6, forearm: 0.395 } } })), []);
});

test('checkDeformers: a skinned member of a group warp is left out of the different-bones warning', () => {
  const group = { id: 'g', members: ['a', 'b'], box: [0, 0, 10, 10], keyforms: [] };
  const run = skinnedA => {
    const out = [], skinned = { id: 'ma', part: 'a', mesh: { verts: [0, 0, 10, 0, 0, 10, 10, 10], tris: [0, 1, 2, 2, 1, 3], weights: {} }, keyforms: [] };
    checkDeformers({ deformers: skinnedA ? [skinned, group] : [group], parameters: [] }, new Set(['a', 'b']), new Set(['arm', 'forearm']), new Set(), m => out.push(m), new Map([['a', 'arm'], ['b', 'forearm']]));
    return out;
  };
  has(run(false), 'different bones');
  assert.deepEqual(run(true), []);
});

test('checkRig: a leaf bone that a skinned mesh weights is not reported as moving nothing', () => {
  const rig = deformers => ({ width: 100, height: 100, parts: [{ name: 'a', file: 'a.png', x: 0, y: 0 }], rig: { bones: { root: { pivot: [1, 1] }, tail: { parent: 'root', pivot: [5, 5] } }, deformers } });
  const mesh = { verts: [0, 0, 10, 0, 0, 10], tris: [0, 1, 2] };
  const loose = checkRig(rig([])).filter(p => /moves nothing/.test(p.message));
  assert.equal(loose.length, 1); // nothing on tail
  assert.deepEqual(checkRig(rig([{ id: 'm', part: 'a', mesh: { ...mesh, weights: { 0: { tail: 1 } } }, keyforms: [] }])).filter(p => /moves nothing/.test(p.message)), []);
  assert.deepEqual(checkRig(rig([{ id: 'm', part: 'a', mesh: { ...mesh, defaultBone: 'tail' }, keyforms: [] }])).filter(p => /moves nothing/.test(p.message)), []);
});
