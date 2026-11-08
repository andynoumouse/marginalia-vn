import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDeformer, checkDeformers, generateMesh, hasKeyforms, meshReplaces, meshUsable, setPartMesh, MESH_DETAIL_STEPS } from '../../dist/engine/src/index.js';

const quad = { verts: [0, 0, 10, 0, 10, 10, 0, 10], tris: [0, 1, 2, 0, 2, 3] };
const sway = { id: 'sway', min: 0, max: 1, default: 0 };
const problems = ds => { const out = []; checkDeformers({ deformers: ds, parameters: [sway] }, new Set(['p', 'q']), new Set(), new Set(), m => out.push(m)); return out; };

test('a part with no deformer gets a mesh deformer named after it, with the detail hint', () => {
  const next = setPartMesh([], 'p', quad, 'high');
  assert.deepEqual(next, [{ id: 'p_mesh', part: 'p', mesh: { ...quad, detail: 'high' }, keyforms: [] }]);
  assert.equal(meshReplaces([], 'p'), 'none');
  assert.deepEqual(problems(next), []);
});

test('the id avoids a taken one, and the input mesh is copied', () => {
  const next = setPartMesh([{ id: 'p_mesh', part: 'q', grid: [1, 1], keyforms: [] }], 'p', quad, 'low');
  assert.equal(next[1].id, 'p_mesh2');
  next[1].mesh.verts[0] = 99;
  assert.equal(quad.verts[0], 0);
});

test('a lattice is replaced (same id, no grid, no keyforms) and always needs confirming', () => {
  const lat = { id: 'w', part: 'p', grid: [2, 2], keyforms: [{ param: 'sway', keys: [{ at: 0 }, { at: 1, pts: { 4: [0.1, 0] } }] }] };
  const ds = [lat, { id: 'o', part: 'q', grid: [1, 1], keyforms: [] }];
  assert.equal(meshReplaces(ds, 'p'), 'lattice');
  const next = setPartMesh(ds, 'p', quad, 'medium');
  assert.deepEqual(next[0], { id: 'w', part: 'p', mesh: { ...quad, detail: 'medium' }, keyforms: [] });
  assert.equal(next[1], ds[1], 'other deformers are untouched');
  assert.equal(lat.keyforms.length, 1, 'the input is not touched');
  assert.deepEqual(problems(next), []);
});

test('regenerating a mesh drops its keyforms and only asks when it has some', () => {
  const bare = setPartMesh([], 'p', quad, 'low');
  assert.equal(meshReplaces(bare, 'p'), 'none');
  const keyed = [{ ...bare[0], keyforms: [{ param: 'sway', keys: [{ at: 0 }, { at: 1, pts: { 2: [0.1, 0] } }] }] }];
  assert.equal(hasKeyforms(keyed[0]), true);
  assert.equal(meshReplaces(keyed, 'p'), 'keyforms');
  const next = setPartMesh(keyed, 'p', { verts: [...quad.verts, 5, 5], tris: [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4] }, 'high');
  assert.equal(next[0].keyforms.length, 0);
  assert.equal(next[0].mesh.detail, 'high');
  assert.equal(next[0].mesh.verts.length, 10);
});

test('an empty or over-cap mesh changes nothing', () => {
  const ds = addDeformer([], 'p');
  assert.equal(meshUsable({ verts: [], tris: [] }), false);
  assert.deepEqual(setPartMesh(ds, 'p', { verts: [], tris: [] }, 'low'), ds);
  const big = { verts: new Array(1002).fill(1), tris: [0, 1, 2] };
  assert.equal(meshUsable(big), false);
});

test('a generated mesh from alpha passes the rig check; the detail steps cover the generator', () => {
  const w = 60, h = 80, a = new Uint8Array(w * h).fill(255);
  const counts = MESH_DETAIL_STEPS.map(s => generateMesh(a, w, h, { detail: s.id }).verts.length / 2);
  for (let i = 1; i < counts.length; i++) assert.ok(counts[i] >= counts[i - 1], `detail rises: ${counts}`);
  assert.ok(counts[3] > counts[0]);
  const next = setPartMesh([], 'p', generateMesh(a, w, h, { detail: 'high' }), 'high');
  assert.deepEqual(problems(next), []);
});

// ---- vertex editing in a keyform ----
import { dragWarpPoint, meshSoftWeights, softWeights, mirrorMeshWarp, smoothMeshWarp, transformMeshPoints, meshMirrorPartners, warpPreset, warpAllPoints, invertSelection, ownDisplacement, moveWarpPoints, checkDeformers as check } from '../../dist/engine/src/index.js';

// A 3x3 grid of vertices over a 20x20 image: index = row * 3 + col, rest x = col * 10, y = row * 10.
const gridMesh = () => {
  const verts = [], tris = [];
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) verts.push(i * 10, j * 10);
  for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) { const a = j * 3 + i; tris.push(a, a + 1, a + 4, a, a + 4, a + 3); }
  return { id: 'm', part: 'p', mesh: { verts, tris, detail: 'low' }, keyforms: [] };
};
const turn2 = { id: 'turn', min: -1, max: 1, default: 0 };

test('dragging a vertex writes a sparse key indexed by vertex, as a lattice point does', () => {
  const def = dragWarpPoint(gridMesh(), sway, 1, 4, [0.01, -0.02]);
  assert.deepEqual(def.keyforms[0].keys, [{ at: 0 }, { at: 1, pts: { 4: [0.01, -0.02] } }]);
  assert.deepEqual(problems([def]), []);
});

test('soft weights fade over hops along the edges, and a hard selection is the chosen vertices only', () => {
  const def = gridMesh();
  assert.deepEqual([...softWeights(def, [4]).keys()], [4]);
  const w = softWeights(def, [0], { radius: 2.5, curve: 'linear' });
  assert.equal(w.get(0), 1);
  assert.ok(Math.abs(w.get(1) - 0.6) < 1e-9, 'one hop away');
  assert.equal(w.get(4), w.get(1), 'the diagonal neighbour is one hop too: the fade counts hops, not distance');
  assert.ok(w.get(8) < w.get(1), 'two hops weigh less');
  const apart = meshSoftWeights(4, [0, 1, 2], [0], { radius: 5, curve: 'constant' }); // vertex 3 has no edge to the rest
  assert.equal(apart.has(3), false);
  assert.deepEqual(warpAllPoints(def), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(invertSelection(def, [0, 1, 2, 3]), [4, 5, 6, 7, 8]);
});

test('a soft drag moves the neighbours by their share', () => {
  const def = gridMesh(), weights = softWeights(def, [4], { radius: 2, curve: 'linear' });
  const next = moveWarpPoints(def, sway, 1, weights, [0.02, 0]);
  const own = ownDisplacement(next, sway, 1);
  assert.ok(Math.abs(own[8] - 0.02) < 1e-9 && own[2 * 1] > 0 && own[2 * 1] < 0.02);
});

test('mirror pairs vertices across the vertical middle by nearest rest position and reports the ones with no partner', () => {
  const def = gridMesh(), pairs = meshMirrorPartners(def.mesh.verts, [20, 20]);
  assert.deepEqual([...pairs], [2, 1, 0, 5, 4, 3, 8, 7, 6]);
  let d = dragWarpPoint(def, sway, 1, 0, [0.01, 0.02]);
  d = dragWarpPoint(d, sway, 1, 1, [0.005, 0]);
  const r = mirrorMeshWarp(d, sway, 1, 'left', [20, 20]);
  assert.deepEqual(r.unpaired, []);
  const own = ownDisplacement(r.def, sway, 1);
  assert.deepEqual([own[4], own[5]], [-0.01, 0.02], 'vertex 2 takes vertex 0 mirrored');
  assert.equal(own[2], 0, 'the vertex on the axis loses its sideways move');
  // A mesh that is not symmetric: the lone vertex is reported.
  const odd = { ...def, mesh: { verts: [...def.mesh.verts, 1, 15], tris: def.mesh.tris } };
  const bad = mirrorMeshWarp(odd, sway, 1, 'right', [20, 20]);
  assert.deepEqual(bad.unpaired, [9]);
});

test('mirror of a selection copies the chosen vertices onto their partners', () => {
  const d = dragWarpPoint(gridMesh(), sway, 1, 6, [0.03, 0.01]);
  const own = ownDisplacement(mirrorMeshWarp(d, sway, 1, 'left', [20, 20], [6]).def, sway, 1);
  assert.deepEqual([own[16], own[17]], [-0.03, 0.01]);
});

test('smooth pulls a vertex toward the average of its edge neighbours', () => {
  const d = dragWarpPoint(gridMesh(), sway, 1, 4, [0.08, 0]);
  const own = ownDisplacement(smoothMeshWarp(d, sway, 1, 0.5, [4]), sway, 1);
  assert.ok(Math.abs(own[8] - 0.04) < 1e-9, `${own[8]}`);
  assert.equal(smoothMeshWarp(d, sway, 1, 0.5, []), d, 'nothing chosen changes nothing');
});

test('scale and rotate act on the chosen vertices about the selection or the part centre', () => {
  const def = gridMesh(), box = { w: 0.2, h: 0.2 };
  const grown = ownDisplacement(transformMeshPoints(def, sway, 1, [0, 2], [20, 20], box, { scale: 2 }), sway, 1);
  assert.ok(Math.abs(grown[0] + 0.1) < 1e-9 && Math.abs(grown[4] - 0.1) < 1e-9, 'the pair spreads about its middle');
  const turned = ownDisplacement(transformMeshPoints(def, sway, 1, [0], [20, 20], box, { rotate: 90, about: 'lattice' }), sway, 1);
  // vertex 0 at (0,0) rotates 90 degrees clockwise about (0.1,0.1): to (0.2, 0)
  assert.ok(Math.abs(turned[0] - 0.2) < 1e-9 && Math.abs(turned[1]) < 1e-9, `${turned[0]},${turned[1]}`);
});

test('a preset writes one displacement per vertex', () => {
  const def = warpPreset(gridMesh(), sway, 'sway', { w: 0.2, h: 0.2 }, { pixels: [20, 20] });
  assert.deepEqual(def.keyforms[0].keys.map(k => k.at), [0, 1]);
  const pts = def.keyforms[0].keys[1].pts;
  assert.equal(pts[0], undefined, 'the top row stays');
  assert.ok(pts[6][0] > 0 && pts[8][0] === pts[6][0] && pts[3][0] < pts[6][0]);
  assert.deepEqual(check({ deformers: [def], parameters: [sway] }, new Set(['p']), new Set(), new Set(), () => { throw new Error('problem'); }), undefined);
  const noise = warpPreset(gridMesh(), turn2, 'noise', { w: 0.2, h: 0.2 }, { pixels: [20, 20], seed: 3 });
  assert.equal(Object.keys(noise.keyforms[0].keys.at(-1).pts).length, 9);
});
// ---- topology edits ----
import { addMeshVertex, deleteMeshVertex, moveMeshVertex, flipMeshEdge, addMeshEdge, removeMeshEdge, meshProblem, meshEdges, setMeshGeometry, locateInMesh } from '../../dist/engine/src/index.js';

const geo = () => { const m = gridMesh().mesh; return { verts: [...m.verts], tris: [...m.tris] }; };
const ok = r => { assert.ok('mesh' in r, r.error); return r.mesh; };
const bad = (r, re) => { assert.ok('error' in r, 'expected a refusal'); if (re) assert.match(r.error, re); };

test('a vertex added inside a triangle splits it in three; on an edge it splits the edge and its other triangle', () => {
  const m = geo(), inside = ok(addMeshVertex(m, 7, 3));
  assert.equal(inside.verts.length / 2, 10);
  assert.equal(inside.tris.length / 3, 8 + 2);
  assert.equal(meshProblem(inside.verts, inside.tris), null);
  assert.deepEqual(inside.verts.slice(18), [7, 3], 'the new vertex is last');
  const onEdge = ok(addMeshVertex(m, 5, 10 + 0.5)); // on the edge between vertices 3 and 4... snapped onto it
  assert.equal(onEdge.tris.length / 3, 8 + 2, 'an inner edge splits two triangles into four');
  assert.deepEqual(onEdge.verts.slice(18), [5, 10]);
  assert.equal(meshProblem(onEdge.verts, onEdge.tris), null);
  const rim = ok(addMeshVertex(m, 5, 0.4));
  assert.equal(rim.tris.length / 3, 8 + 1, 'an outline edge splits one');
  assert.equal(meshProblem(rim.verts, rim.tris), null);
  assert.equal(m.verts.length, 18, 'the input is not touched');
});

test('adding a vertex is refused outside the mesh, on a vertex, and past the cap', () => {
  const m = geo();
  bad(addMeshVertex(m, 40, 40), /inside the mesh/);
  bad(addMeshVertex(m, 10.3, 10.2), /vertex here/);
  bad(addMeshVertex(m, 3, 2, 2, 9), /at most 9/);
});

test('deleting an inner vertex fills the hole; an outline vertex closes its fan; the last triangle cannot go', () => {
  const m = geo(), inner = ok(deleteMeshVertex(m, 4));
  assert.equal(inner.verts.length / 2, 8);
  assert.equal(inner.tris.length / 3, 6, 'the hexagon-less square hole is two triangles... of the eight, four go and two come');
  assert.equal(meshProblem(inner.verts, inner.tris), null);
  const corner = ok(deleteMeshVertex(m, 0));
  assert.equal(meshProblem(corner.verts, corner.tris), null);
  assert.ok(corner.verts.length / 2 === 8);
  const one = { verts: [0, 0, 10, 0, 0, 10], tris: [0, 1, 2] };
  bad(deleteMeshVertex(one, 0), /at least three/);
  const two = { verts: [0, 0, 10, 0, 0, 10, 10, 10], tris: [0, 1, 2, 1, 3, 2] };
  const left = ok(deleteMeshVertex(two, 3));
  assert.deepEqual(left.tris.length, 3);
  bad(deleteMeshVertex(left, 0), /at least three|no triangle/);
});

test('moving a vertex is refused when it would flip or overlap, allowed otherwise', () => {
  const m = geo();
  const slid = ok(moveMeshVertex(m, 4, 6, 4));
  assert.deepEqual(slid.verts.slice(8, 10), [6, 4]);
  bad(moveMeshVertex(m, 4, 25, 5), /flat|flipped|overlap/);
  bad(moveMeshVertex(m, 4, -5, 5), /flat|flipped|overlap/);
  bad(moveMeshVertex(m, 99, 0, 0));
});

test('flip joins the other two vertices when the quad is convex, and refuses an outline edge or a dent', () => {
  const m = geo();
  const flipped = ok(flipMeshEdge(m, 4, 0));
  assert.equal(meshProblem(flipped.verts, flipped.tris), null);
  assert.equal(flipped.tris.length, m.tris.length);
  assert.ok(!meshEdges(flipped.tris).some(([a, b]) => a === 0 && b === 4), 'the old diagonal is gone');
  bad(flipMeshEdge(m, 0, 1), /outline/);
  const dent = { verts: [0, 0, 10, 0, 10, 10, 0, 10, 9, 9.5], tris: [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4] };
  assert.equal(meshProblem(dent.verts, dent.tris), null);
  const moved = ok(moveMeshVertex(dent, 4, 2, 8));
  bad(flipMeshEdge(moved, 4, 0), /flat|flipped|overlap/);
});

test('remove edge takes the triangle on an outline edge, never an inner edge or the last one; add edge closes it again', () => {
  const m = geo();
  bad(removeMeshEdge(m, 4, 0), /hole/);
  const cut = ok(removeMeshEdge(m, 0, 1));
  assert.equal(cut.tris.length / 3, 7);
  assert.equal(meshProblem(cut.verts, cut.tris), null);
  const back = ok(addMeshEdge(cut, 0, 1));
  assert.equal(back.tris.length / 3, 8);
  assert.equal(meshProblem(back.verts, back.tris), null);
  bad(addMeshEdge(m, 0, 1), /joined already/);
  bad(addMeshEdge(m, 0, 8));
  bad(addMeshEdge({ verts: [0, 0, 10, 0, 0, 10, 30, 0, 40, 0, 30, 10], tris: [0, 1, 2, 3, 4, 5] }, 0, 3), /neighbour in common/);
  const single = { verts: [0, 0, 10, 0, 0, 10, 10, 10], tris: [0, 1, 2, 1, 3, 2] };
  bad(removeMeshEdge(single, 0, 1), /no triangle|no vertex|uses/);
  bad(removeMeshEdge({ verts: [0, 0, 10, 0, 0, 10], tris: [0, 1, 2] }, 0, 1), /no triangle/);
});

test('setMeshGeometry swaps the geometry, keeps the detail hint and drops the keyforms', () => {
  const def = { ...gridMesh(), keyforms: [{ param: 'sway', keys: [{ at: 0 }, { at: 1, pts: { 4: [0.1, 0] } }] }] };
  const next = setMeshGeometry(def, ok(addMeshVertex(geo(), 7, 3)));
  assert.equal(next.mesh.verts.length, 20);
  assert.equal(next.mesh.detail, 'low');
  assert.deepEqual(next.keyforms, []);
  assert.equal(def.keyforms.length, 1);
  assert.deepEqual(problems([next]), []);
});

test('random edit sequences keep the mesh valid: no overlap, one winding, every vertex used, indices in range', () => {
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const kinds = { add: 0, delete: 0, move: 0, flip: 0, remove: 0, addEdge: 0, refused: 0 };
  for (const start of [geo(), generateMesh(Uint8Array.from({ length: 60 * 60 }, (_, k) => ((k % 60) - 30) ** 2 + (Math.floor(k / 60) - 30) ** 2 < 625 ? 255 : 0), 60, 60, { detail: 'medium' })]) {
    let mesh = { verts: [...start.verts], tris: [...start.tris] };
    assert.equal(meshProblem(mesh.verts, mesh.tris), null, 'the start is valid');
    for (let step = 0; step < 250; step++) {
      const n = mesh.verts.length / 2, edges = meshEdges(mesh.tris), e = edges[Math.floor(rnd() * edges.length)], v = Math.floor(rnd() * n), op = Math.floor(rnd() * 6);
      const xs = mesh.verts.filter((_, k) => k % 2 === 0), ys = mesh.verts.filter((_, k) => k % 2 === 1), W = Math.max(...xs) - Math.min(...xs), H = Math.max(...ys) - Math.min(...ys);
      const px = Math.min(...xs) + rnd() * W, py = Math.min(...ys) + rnd() * H;
      const r = op === 0 ? addMeshVertex(mesh, px, py) : op === 1 ? deleteMeshVertex(mesh, v) : op === 2 ? moveMeshVertex(mesh, v, mesh.verts[v * 2] + (rnd() - 0.5) * W * 0.2, mesh.verts[v * 2 + 1] + (rnd() - 0.5) * H * 0.2)
        : op === 3 ? flipMeshEdge(mesh, e[0], e[1]) : op === 4 ? removeMeshEdge(mesh, e[0], e[1]) : addMeshEdge(mesh, Math.floor(rnd() * n), Math.floor(rnd() * n));
      if ('error' in r) { kinds.refused++; continue; }
      kinds[['add', 'delete', 'move', 'flip', 'remove', 'addEdge'][op]]++;
      mesh = r.mesh;
      const problem = meshProblem(mesh.verts, mesh.tris);
      assert.equal(problem, null, `after op ${op} at step ${step}: ${problem}`);
    }
  }
  for (const k of ['add', 'delete', 'move', 'flip', 'remove', 'addEdge']) assert.ok(kinds[k] > 0, `${k} was never accepted: ${JSON.stringify(kinds)}`);
});
