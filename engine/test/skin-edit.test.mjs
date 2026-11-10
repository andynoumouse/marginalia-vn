// Bone-weight edits, step 3 (docs/design/skinning.md): set / add / subtract, smooth, prune, auto-weights, mirror, and what topology edits,
// Regenerate and bone rename / delete do to the weights.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  vertexWeights, setBoneWeight, addBoneWeight, resetWeights, pruneWeights, smoothWeights, autoWeights, defaultBlend, boneBody, pairedBone, mirrorWeights,
  removeVertexWeights, addVertexWeights, resampleWeights, renameWeightBone, deleteWeightBone, meshMirrorPartners, addMeshVertex, deleteMeshVertex, setMeshGeometry,
  setPartMesh, checkDeformers, resolvePivots, checkRig,
} from '../../dist/engine/src/index.js';

const near = (got, want, eps = 1e-3) => assert.ok(Math.abs(got - want) < eps, `${got} != ${want}`);
const sumOf = e => Object.values(e).reduce((s, w) => s + w, 0);

// a 3 x 3 grid of vertices, 10 apart: vertex k is at (10 * (k % 3), 10 * floor(k / 3))
const grid = () => {
  const verts = [], tris = [];
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) verts.push(x * 10, y * 10);
  for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) { const a = y * 3 + x; tris.push(a, a + 1, a + 3, a + 1, a + 4, a + 3); }
  return { verts, tris };
};

test('vertexWeights: a listed vertex is normalized, an unlisted one binds to the default bone, none at all stays at rest', () => {
  assert.deepEqual(vertexWeights({ weights: { 0: { a: 2, b: 2 } }, defaultBone: 'a' }, 0), { a: 0.5, b: 0.5 });
  assert.deepEqual(vertexWeights({ weights: {}, defaultBone: 'a' }, 4), { a: 1 });
  assert.deepEqual(vertexWeights({}, 4), {});
});

test('setBoneWeight: the other bones share the rest in proportion; with no other bone the default takes it', () => {
  const m = { weights: { 0: { a: 0.6, b: 0.4 } }, defaultBone: 'a' };
  const w = setBoneWeight(m, [0], 'b', 0.8);
  near(w[0].b, 0.8); near(w[0].a, 0.2);
  const d = setBoneWeight(m, [1], 'b', 0.25); // vertex 1 is on the default bone alone
  near(d[1].b, 0.25); near(d[1].a, 0.75);
  assert.deepEqual(setBoneWeight(m, [0], 'b', 1)[0], { b: 1 });
  assert.deepEqual(setBoneWeight(m, [0], 'a', 1)[0], undefined); // all on the default bone: not stored
  assert.deepEqual(m.weights, { 0: { a: 0.6, b: 0.4 } }); // the input is untouched
});

test('setBoneWeight: a fifth influence replaces the smallest, sums stay 1', () => {
  const m = { weights: { 0: { a: 0.4, b: 0.3, c: 0.2, d: 0.1 } } };
  const w = setBoneWeight(m, [0], 'e', 0.2)[0];
  assert.equal(Object.keys(w).length, 4);
  assert.ok(!('d' in w));
  near(sumOf(w), 1);
});

test('addBoneWeight adds and subtracts, kept between 0 and 1', () => {
  const m = { weights: { 0: { a: 0.5, b: 0.5 } } };
  near(addBoneWeight(m, [0], 'b', 0.25)[0].b, 0.75);
  near(addBoneWeight(m, [0], 'b', -0.25)[0].b, 0.25);
  assert.deepEqual(addBoneWeight(m, [0], 'b', 5)[0], { b: 1 });
  assert.deepEqual(addBoneWeight(m, [0], 'b', -5)[0], { a: 1 });
});

test('resetWeights, pruneWeights', () => {
  const m = { weights: { 0: { a: 0.7, b: 0.3 }, 1: { a: 0.95, b: 0.04, c: 0.01 }, 2: { b: 0.5, c: 0.5 } }, defaultBone: 'a' };
  assert.deepEqual(Object.keys(resetWeights(m, [0, 2])), ['1']);
  const p = pruneWeights(m, 0.05);
  assert.deepEqual(p[1], undefined); // only a is left: the default bone
  assert.deepEqual(p[0], { a: 0.7, b: 0.3 });
  assert.deepEqual(Object.keys(p[2]).sort(), ['b', 'c']);
  assert.deepEqual(pruneWeights({ weights: { 0: { a: 0.03, b: 0.02 } } }, 0.5, [0])[0], { a: 1 }); // all below: the largest stays
});

test('smoothWeights: a vertex moves toward the average of its neighbours', () => {
  const { tris } = grid();
  const m = { weights: { 4: { b: 1 } }, defaultBone: 'a' }; // the middle vertex is on b, everything else on a
  const w = smoothWeights(m, 9, tris, 0.5, [4]);
  const e = vertexWeights({ ...m, weights: w }, 4);
  assert.ok(e.a > 0.4 && e.a < 0.6, JSON.stringify(e));
  near(sumOf(e), 1);
  assert.deepEqual(smoothWeights(m, 9, tris, 0, [4])[4], { b: 1 });
});

// ---- auto-weights ----
const arm = { bones: { arm: { pivot: [100, 0] }, forearm: { parent: 'arm', pivot: [200, 0] }, hand: { parent: 'forearm', pivot: [300, 0], tip: [340, 0] } }, pivots: { arm: [100, 0], forearm: [200, 0], hand: [300, 0] } };

test('boneBody: segments to the children and the tip; a point for a bone with neither', () => {
  assert.deepEqual(boneBody(arm, 'arm'), [[100, 0, 200, 0]]);
  assert.deepEqual(boneBody(arm, 'hand'), [[300, 0, 340, 0]]);
  assert.deepEqual(boneBody({ bones: { x: {} }, pivots: { x: [5, 6] } }, 'x'), [[5, 6, 5, 6]]);
});

test('autoWeights: on a body it is one bone, at a joint half and half, in the soft zone a blend, far away the nearest bone', () => {
  const blend = 40;
  const w = autoWeights([150, 0, 200, 0, 220, 0, 250, 0, 150, 500], [0, 0], arm, ['arm', 'forearm'], blend);
  // (150, 0): 50 from the forearm's pivot (out of reach), on the arm's body: all arm
  assert.deepEqual(w[0], { arm: 1 });
  // the elbow: both bodies start here
  near(w[1].arm, 0.5); near(w[1].forearm, 0.5);
  // 20 along the forearm: the arm is 20 away (r 0.5), the forearm on its body (r 1)
  near(w[2].forearm, 1 / 1.5); near(w[2].arm, 0.5 / 1.5);
  // (250, 0) is on the forearm's body (100 long); (150, 500) is outside every reach, so the nearest bone takes it all: the arm
  assert.deepEqual(w[3], { forearm: 1 });
  assert.deepEqual(w[4], { arm: 1 });
  for (const e of Object.values(w)) near(sumOf(e), 1);
});

test('autoWeights: only the bound bones can get weight, at most 4, and the origin shifts the vertices', () => {
  const only = autoWeights([0, 0], [150, 0], arm, ['forearm'], 40);
  assert.deepEqual(only[0], { forearm: 1 });
  const many = { bones: { r: {}, a: { parent: 'r' }, b: { parent: 'r' }, c: { parent: 'r' }, d: { parent: 'r' }, e: { parent: 'r' } }, pivots: { r: [0, 0], a: [1, 0], b: [0, 1], c: [-1, 0], d: [0, -1], e: [1, 1] } };
  const w = autoWeights([0, 0], [0, 0], many, ['r', 'a', 'b', 'c', 'd', 'e'], 50);
  assert.ok(Object.keys(w[0]).length <= 4);
  near(sumOf(w[0]), 1);
  assert.deepEqual(autoWeights([0, 0], [0, 0], arm, ['ghost'], 40), {});
});

test('autoWeights: a vertex that comes out as the default bone alone is not stored; defaultBlend is an eighth of the longer side', () => {
  const w = autoWeights([150, 0, 200, 0], [0, 0], arm, ['arm', 'forearm'], 40, 'arm');
  assert.equal(w[0], undefined);
  assert.ok(w[1]);
  assert.equal(defaultBlend([0, 0, 80, 20]), 10);
});

// ---- mirror ----
test('pairedBone: _l/_r, .L/.R, left/right words, no side', () => {
  assert.equal(pairedBone('arm_l'), 'arm_r');
  assert.equal(pairedBone('arm_R'), 'arm_L');
  assert.equal(pairedBone('Arm.L'), 'Arm.R');
  assert.equal(pairedBone('left_hand'), 'right_hand');
  assert.equal(pairedBone('Hand-Right'), 'Hand-Left');
  assert.equal(pairedBone('Left.Hand'), 'Right.Hand');
  assert.equal(pairedBone('head'), null);
  assert.equal(pairedBone('hall'), null);
});

test('mirrorWeights: one side onto the other with the bones paired; an unpaired bone changes nothing and is named', () => {
  const { verts } = grid();
  const partner = meshMirrorPartners(verts, [20, 20]);
  const m = { weights: { 0: { arm_l: 0.7, torso_c: 0.3 }, 3: { arm_l: 1 } }, defaultBone: 'torso_c' };
  const r = mirrorWeights(m, verts, partner, 10, 'left', { torso_c: 'torso_c' });
  assert.deepEqual(r.unpaired, []);
  assert.deepEqual(r.weights[2], { arm_r: 0.7, torso_c: 0.3 });
  assert.deepEqual(r.weights[5], { arm_r: 1 });
  assert.deepEqual(r.weights[0], m.weights[0]); // the source stays
  const bad = mirrorWeights(m, verts, partner, 10, 'left');
  assert.deepEqual(bad.unpaired, ['torso_c']);
  assert.deepEqual(bad.weights, m.weights);
  const back = mirrorWeights({ weights: { 2: { arm_r: 1 } } }, verts, partner, 10, 'right');
  assert.deepEqual(back.weights[0], { arm_l: 1 });
});

// ---- topology ----
test('removeVertexWeights: the entry goes and higher numbers move down', () => {
  assert.deepEqual(removeVertexWeights({ 1: { a: 1 }, 3: { b: 1 }, 5: { c: 1 } }, 3), { 1: { a: 1 }, 4: { c: 1 } });
  assert.deepEqual(removeVertexWeights(undefined, 0), {});
});

test('addVertexWeights: the new vertex blends its corners by position; an edge split blends the edge ends', () => {
  const { verts, tris } = grid();
  const m = { weights: { 0: { a: 1 }, 1: { b: 1 } }, defaultBone: 'a' };
  const w = addVertexWeights(m, verts, tris, 5, 0); // the middle of edge 0-1
  near(w[9].a, 0.5); near(w[9].b, 0.5);
  near(addVertexWeights(m, verts, tris, 1, 1)[9].b, 0.1, 0.05); // inside triangle 0-1-3, close to vertex 0
  assert.equal(addVertexWeights({ weights: {}, defaultBone: 'a' }, verts, tris, 5, 5)[9], undefined);
});

test('resampleWeights: a finer mesh keeps the painted result; a vertex outside takes the nearest triangle', () => {
  const { verts, tris } = grid();
  const m = { weights: { 0: { b: 1 }, 3: { b: 1 }, 6: { b: 1 } }, defaultBone: 'a' }; // the left column is on b
  const w = resampleWeights(m, verts, tris, [0, 5, 20, 5, 10, 10, -5, 10]);
  near(vertexWeights({ ...m, weights: w }, 0).b, 1);
  assert.equal(vertexWeights({ ...m, weights: w }, 1).b, undefined);
  near(vertexWeights({ ...m, weights: w }, 2).a, 1); // the right edge: a
  near(vertexWeights({ ...m, weights: w }, 3).b, 1); // left of the mesh: clamped onto its left edge
});

test('setPartMesh keeps the weights and the default bone on Regenerate; setMeshGeometry keeps them unless told', () => {
  const { verts, tris } = grid();
  const def = { id: 'm', part: 'p', mesh: { verts, tris, defaultBone: 'a', weights: { 0: { b: 1 }, 3: { b: 1 }, 6: { b: 1 } } }, keyforms: [{ param: 'x', keys: [{ at: 0 }] }] };
  const finer = { verts: [0, 0, 20, 0, 0, 20, 20, 20], tris: [0, 1, 2, 1, 3, 2] };
  const [d] = setPartMesh([def], 'p', finer, 'high');
  assert.equal(d.mesh.defaultBone, 'a');
  near(d.mesh.weights[0].b, 1);
  assert.equal(d.keyforms.length, 0); // the keyforms still go
  const moved = setMeshGeometry(def, { verts: verts.map(v => v + 1), tris });
  assert.deepEqual(moved.mesh.weights, def.mesh.weights);
  assert.equal(moved.mesh.defaultBone, 'a');
  assert.deepEqual(setMeshGeometry(def, { verts, tris }, { 2: { b: 1 } }).mesh.weights, { 2: { b: 1 } });
});

// ---- bones in the tree ----
test('renameWeightBone and deleteWeightBone', () => {
  const m = { verts: [], tris: [], weights: { 0: { arm: 0.5, fore: 0.5 }, 1: { fore: 1 } }, defaultBone: 'fore' };
  const r = renameWeightBone(m, 'fore', 'forearm');
  assert.deepEqual(r.weights[1], { forearm: 1 });
  assert.equal(r.defaultBone, 'forearm');
  const d = deleteWeightBone(m, 'fore', 'arm');
  assert.deepEqual(d.weights[1], undefined); // all on arm now, which is the default bone from here on: not stored
});

test('deleteWeightBone gives the weight to the parent and moves the default up', () => {
  const m = { weights: { 0: { arm: 0.25, fore: 0.75 }, 1: { fore: 0.5, hand: 0.5 } }, defaultBone: 'fore' };
  const d = deleteWeightBone(m, 'fore', 'arm');
  assert.equal(d.weights[0], undefined); // all on arm, the new default bone: not stored
  assert.deepEqual(d.weights[1], { arm: 0.5, hand: 0.5 });
  assert.equal(d.defaultBone, 'arm');
  const gone = deleteWeightBone(m, 'fore', null);
  assert.deepEqual(gone.weights[0], { arm: 1 });
  assert.deepEqual(gone.weights[1], { hand: 1 });
  assert.equal(gone.defaultBone, undefined);
});

// ---- a bone's tip in checkRig ----
test('checkRig: a tip must be [x, y]', () => {
  const rig = tip => ({ width: 10, height: 10, parts: [{ name: 'a', file: 'a.png', x: 0, y: 0 }], rig: { bones: { b: { pivot: [1, 1], tip } }, parts: { a: { bone: 'b' } } } });
  assert.deepEqual(checkRig(rig([3, 4])).filter(p => /tip/.test(p.message)), []);
  assert.ok(checkRig(rig([3])).some(p => /bones\.b\.tip/.test(p.message)));
  assert.ok(checkRig(rig('x')).some(p => /bones\.b\.tip/.test(p.message)));
});

// ---- random sequences ----
test('random add / delete sequences keep every entry valid and in range', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  let { verts, tris } = grid();
  const bones = ['a', 'b', 'c'];
  let mesh = { defaultBone: 'a', weights: { 0: { b: 1 }, 2: { b: 0.5, c: 0.5 }, 4: { c: 1 }, 7: { a: 0.2, b: 0.8 } } };
  let applied = 0;
  for (let step = 0; step < 150; step++) {
    const n = verts.length / 2;
    if (rnd() < 0.55 && n < 60) {
      const x = rnd() * 20, y = rnd() * 20, r = addMeshVertex({ verts, tris }, x, y);
      if (!('mesh' in r)) continue;
      mesh = { ...mesh, weights: addVertexWeights(mesh, verts, tris, x, y) };
      ({ verts, tris } = r.mesh);
    } else {
      const i = Math.floor(rnd() * n), r = deleteMeshVertex({ verts, tris }, i);
      if (!('mesh' in r)) continue;
      mesh = { ...mesh, weights: removeVertexWeights(mesh.weights, i) };
      ({ verts, tris } = r.mesh);
    }
    applied++;
    const count = verts.length / 2;
    for (const [k, e] of Object.entries(mesh.weights)) {
      assert.ok(Number.isInteger(+k) && +k >= 0 && +k < count, `vertex ${k} of ${count}`);
      assert.ok(Object.keys(e).length >= 1 && Object.keys(e).length <= 4);
      assert.ok(Object.keys(e).every(b => bones.includes(b)));
      near(sumOf(e), 1);
    }
    const def = { id: 'm', part: 'p', mesh: { verts, tris, defaultBone: 'a', weights: mesh.weights }, keyforms: [] };
    const out = [];
    checkDeformers({ deformers: [def], parameters: [] }, new Set(['p']), new Set(bones), new Set(), m => out.push(m));
    assert.deepEqual(out, []);
  }
  assert.ok(applied > 30, `only ${applied} edits applied`);
});

// ---- binding ----
import { boundBones, startSkinning, stopSkinning, applyAutoWeights } from '../../dist/engine/src/index.js';

test('boundBones: the default bone first, then those the weights name', () => {
  assert.deepEqual(boundBones({ defaultBone: 'arm', weights: { 0: { fore: 1 }, 1: { arm: 0.5, hand: 0.5 } } }), ['arm', 'fore', 'hand']);
  assert.deepEqual(boundBones({}), []);
});

test('startSkinning gives the part\'s bone as the default, keeps an existing skin; stopSkinning removes it', () => {
  assert.deepEqual(startSkinning({ verts: [] }, 'arm'), { verts: [], weights: {}, defaultBone: 'arm' });
  assert.deepEqual(startSkinning({ verts: [], defaultBone: 'x' }, 'arm'), { verts: [], weights: {}, defaultBone: 'x' });
  assert.deepEqual(startSkinning({ verts: [] }, undefined), { verts: [], weights: {} });
  const skinned = { verts: [], weights: { 0: { a: 1 } }, defaultBone: 'a' };
  assert.equal(startSkinning(skinned, 'arm'), skinned);
  assert.deepEqual(stopSkinning(skinned), { verts: [] });
});

test('applyAutoWeights: starts skinning, fills the mesh; only the chosen vertices when asked; nothing without a bound bone in the tree', () => {
  const mesh = { verts: [150, 0, 200, 0, 250, 0], tris: [0, 1, 2] };
  const w = applyAutoWeights(mesh, [0, 0], arm, ['arm', 'forearm'], 40, 'arm');
  assert.equal(w.defaultBone, 'arm');
  assert.equal(w.weights[0], undefined); // all on the default bone: not stored
  near(w.weights[1].forearm, 0.5);
  assert.deepEqual(w.weights[2], { forearm: 1 });
  const some = applyAutoWeights({ ...w, weights: { 0: { forearm: 1 }, 1: { forearm: 1 } } }, [0, 0], arm, ['arm', 'forearm'], 40, 'arm', [1]);
  assert.deepEqual(some.weights[0], { forearm: 1 }); // untouched
  near(some.weights[1].arm, 0.5);
  assert.equal(applyAutoWeights(mesh, [0, 0], arm, ['ghost'], 40, 'arm'), mesh);
});

import { boneHeat, weightsText } from '../../dist/engine/src/index.js';

test('boneHeat and weightsText: a bone\'s weight per vertex, and a vertex as text', () => {
  const m = { weights: { 1: { arm: 0.65, fore: 0.35 }, 2: { fore: 1 } }, defaultBone: 'arm' };
  assert.deepEqual(boneHeat(m, 'fore', 4), [0, 0.35, 1, 0]);
  assert.deepEqual(boneHeat(m, 'arm', 4), [1, 0.65, 0, 1]);
  assert.equal(weightsText(m, 1), 'arm 0.65 · fore 0.35');
  assert.equal(weightsText(m, 0), 'arm 1');
  assert.equal(weightsText({}, 0), 'at rest');
});

import { paintWeights } from '../../dist/engine/src/index.js';

test('paintWeights: Add, Subtract and Replace move the bone\'s weight by the dab\'s falloff; the others share the rest', () => {
  const { tris } = grid();
  const m = { weights: { 0: { a: 0.5, b: 0.5 } }, defaultBone: 'a' };
  const add = paintWeights(m, [[0, 1], [1, 0.5]], 'add', 'b', 0.4, 9, tris);
  near(add[0].b, 0.9); near(add[0].a, 0.1);
  near(add[1].b, 0.2); near(add[1].a, 0.8); // an unlisted vertex was on the default bone alone
  assert.equal(add[2], undefined, 'a vertex that was not hit is untouched');
  const sub = paintWeights(m, [[0, 1]], 'subtract', 'b', 0.3, 9, tris);
  near(sub[0].b, 0.2);
  assert.equal(paintWeights(m, [[0, 1]], 'subtract', 'b', 1, 9, tris)[0], undefined, 'all of it taken away: back to the default bone');
  assert.deepEqual(paintWeights(m, [[0, 1]], 'replace', 'b', 1, 9, tris)[0], { b: 1 });
  near(paintWeights(m, [[0, 0.5]], 'replace', 'b', 1, 9, tris)[0].b, 0.75);
  assert.deepEqual(m.weights, { 0: { a: 0.5, b: 0.5 } }, 'the input is untouched');
});

test('paintWeights: smooth blurs toward the neighbours, a fifth bone replaces the smallest, bad hits and no bone do nothing, an unskinned mesh starts skinning', () => {
  const { tris } = grid();
  const m = { weights: { 4: { b: 1 } }, defaultBone: 'a' };
  const smooth = paintWeights(m, [[4, 1]], 'smooth', null, 0.5, 9, tris);
  const e = vertexWeights({ ...m, weights: smooth }, 4);
  assert.ok(e.a > 0.4 && e.a < 0.6 && Math.abs(sumOf(e) - 1) < 1e-3, JSON.stringify(e));
  const four = { weights: { 0: { a: 0.4, b: 0.3, c: 0.2, d: 0.1 } } };
  const five = paintWeights(four, [[0, 1]], 'add', 'e', 0.3, 9, tris)[0];
  assert.equal(Object.keys(five).length, 4);
  assert.ok(!('d' in five));
  assert.deepEqual(paintWeights(m, [[99, 1], [-1, 1], [0, 0]], 'add', 'b', 1, 9, tris), { 4: { b: 1 } });
  assert.deepEqual(paintWeights(m, [[0, 1]], 'add', null, 1, 9, tris), { 4: { b: 1 } });
  const fresh = paintWeights({}, [[0, 1]], 'replace', 'b', 1, 9, tris, 'a');
  assert.deepEqual(fresh, { 0: { b: 1 } });
});

import { applyNumeric } from '../../dist/engine/src/index.js';

test('applyNumeric: set / add / subtract / smooth / prune / reset work on the selection only, the input is untouched', () => {
  const { tris } = grid();
  const m = { weights: { 0: { a: 0.5, b: 0.5 }, 4: { b: 1 } }, defaultBone: 'a' };
  const before = JSON.stringify(m);
  const set = applyNumeric(m, [0, 1, 99], { kind: 'set', bone: 'b', value: 0.8 }, 9, tris);
  near(vertexWeights(set, 0).b, 0.8);
  near(vertexWeights(set, 1).b, 0.8);
  assert.deepEqual(vertexWeights(set, 4), { b: 1 }, 'a vertex outside the selection is as it was');
  near(vertexWeights(applyNumeric(m, [0], { kind: 'add', bone: 'b', value: 0.25 }, 9, tris), 0).b, 0.75);
  near(vertexWeights(applyNumeric(m, [0], { kind: 'subtract', bone: 'b', value: 0.25 }, 9, tris), 0).b, 0.25);
  const smooth = applyNumeric(m, [4], { kind: 'smooth', amount: 0.5 }, 9, tris);
  assert.ok(vertexWeights(smooth, 4).a > 0.3);
  const lop = { weights: { 0: { a: 0.7, b: 0.25, c: 0.05 } }, defaultBone: 'a' };
  assert.deepEqual(vertexWeights(applyNumeric(lop, [0], { kind: 'prune', limit: 0.1 }, 9, tris), 0), { a: 0.7368, b: 0.2632 });
  assert.deepEqual(vertexWeights(applyNumeric(m, [4], { kind: 'reset' }, 9, tris), 4), { a: 1 });
  assert.equal(applyNumeric(m, [99], { kind: 'reset' }, 9, tris), m, 'nothing to edit returns the mesh');
  assert.equal(JSON.stringify(m), before);
  const fresh = applyNumeric({}, [2], { kind: 'set', bone: 'b', value: 1 }, 9, tris, 'a');
  assert.equal(fresh.defaultBone, 'a');
  assert.deepEqual(fresh.weights, { 2: { b: 1 } });
});

import { removeBoneWeights, posedInfluences } from '../../dist/engine/src/index.js';

import { unbindBone } from '../../dist/engine/src/index.js';

test('unbindBone: the weight goes to the parent in the rig, is dropped for a root or a parent the rig lacks, and a bone the mesh does not name changes nothing', () => {
  const mesh = { verts: [0, 0, 1, 0, 0, 1], tris: [0, 1, 2], defaultBone: 'fore', weights: { 0: { arm: 0.25, fore: 0.75 }, 1: { fore: 0.5, hand: 0.5 } } };
  const bones = { arm: {}, fore: { parent: 'arm' }, hand: { parent: 'fore' }, stray: { parent: 'gone' } };
  const up = unbindBone(mesh, 'fore', bones);
  assert.equal(up.to, 'arm');
  assert.equal(up.mesh.defaultBone, 'arm');
  assert.deepEqual(up.mesh.weights, { 1: { arm: 0.5, hand: 0.5 } });
  const root = unbindBone(mesh, 'arm', bones);
  assert.equal(root.to, null);
  assert.equal(root.mesh.defaultBone, 'fore');
  assert.equal(root.mesh.weights[0], undefined, 'all on fore, the default: not stored');
  assert.equal(unbindBone({ ...mesh, weights: { 0: { stray: 1 } } }, 'stray', bones).to, null, 'a parent the rig lacks counts as none');
  const same = unbindBone(mesh, 'hand', { ...bones, hand: {} });
  assert.equal(same.to, null);
  assert.equal(same.mesh.weights[1], undefined, 'all on the default again');
  assert.equal(unbindBone(mesh, 'stray', bones).mesh, mesh, 'not bound: the same object');
  const last = unbindBone({ verts: mesh.verts, tris: mesh.tris, defaultBone: 'fore', weights: { 0: { fore: 1 } } }, 'fore', bones);
  assert.equal(last.mesh.weights, undefined, 'the last bone takes the skin with it, parent or not');
  assert.equal(last.mesh.defaultBone, undefined);
  assert.equal(last.to, null);
  assert.equal(mesh.defaultBone, 'fore', 'the input is untouched');
});

test('removeBoneWeights: skinned meshes give the bone\'s weight to its parent; others are untouched', () => {
  const skinned = { id: 's', part: 'p', mesh: { verts: [0, 0, 1, 0, 0, 1], tris: [0, 1, 2], defaultBone: 'fore', weights: { 0: { arm: 0.25, fore: 0.75 }, 1: { fore: 0.5, hand: 0.5 } } }, keyforms: [] };
  const other = { id: 'o', part: 'q', mesh: { verts: [0, 0, 1, 0, 0, 1], tris: [0, 1, 2], defaultBone: 'arm', weights: { 0: { arm: 1 } } }, keyforms: [] };
  const lattice = { id: 'l', part: 'r', grid: [2, 2], keyforms: [] };
  const out = removeBoneWeights([skinned, other, lattice], 'fore', 'arm');
  assert.equal(out[1], other);
  assert.equal(out[2], lattice);
  assert.equal(out[0].mesh.defaultBone, 'arm');
  assert.equal(out[0].mesh.weights[0], undefined); // all on arm, the new default: not stored
  assert.deepEqual(out[0].mesh.weights[1], { arm: 0.5, hand: 0.5 });
  assert.equal(out[0].id, 's');
  assert.equal(skinned.mesh.defaultBone, 'fore', 'the input is untouched');
  const orphan = removeBoneWeights([skinned], 'fore', null)[0].mesh;
  assert.equal(orphan.defaultBone, undefined);
  assert.deepEqual(orphan.weights[1], { hand: 1 });
});

test('posedInfluences: the posed bones that move a skinned mesh, with those above them in the tree', () => {
  const bones = { torso: {}, arm: { parent: 'torso' }, fore: { parent: 'arm' }, head: { parent: 'torso' } };
  const mesh = { defaultBone: 'arm', weights: { 0: { fore: 1 } } };
  assert.deepEqual(posedInfluences(mesh, bones, {}), []);
  assert.deepEqual(posedInfluences(mesh, bones, { head: { rot: 20 } }), [], 'a bone that does not move the mesh does not count');
  assert.deepEqual(posedInfluences(mesh, bones, { fore: { rot: 30 }, torso: { dx: 0.01 } }), ['fore', 'torso'], 'a bone above an influencing one does');
  assert.deepEqual(posedInfluences(mesh, bones, { arm: { rot: 0, dx: 0, sx: 0 } }), [], 'a form at rest is not a pose');
  assert.deepEqual(posedInfluences({ weights: {} }, bones, { arm: { rot: 5 } }), [], 'no bone is bound');
  const loop = { a: { parent: 'b' }, b: { parent: 'a' } };
  assert.deepEqual(posedInfluences({ defaultBone: 'a' }, loop, { b: { rot: 1 } }), ['b'], 'a loop in the tree does not hang it');
});
