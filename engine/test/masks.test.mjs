import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRig, maskOf, maskChain, maskCycles, maskFrame, warpPoints, traceOutline, simplifyOutline, evalPointKeyforms, pointKeyformKey, placeRig, placeParts, NO_OFFSET, MASK_MAX_SHAPES, MASK_WARN_COUNT, restLattice, normalizeMasks, maskView, stripMasks, writeShapes, shapePartNames, studioDocOf, studioWrites } from '../../dist/engine/src/index.js';

const part = file => ({ file });
const manifest = rig => ({
  width: 100, height: 100,
  parts: [part('face.png'), part('eye_white.png'), part('iris.png'), part('shine.png'), part('mouth.png'), part('tongue.png'), { slot: 'lids', default: 'open', variants: { open: part('l_open.png'), shut: part('l_shut.png') } }],
  rig,
});
const msgs = rig => checkRig(manifest({ parameters: [{ id: 'open', min: 0, max: 1, default: 1 }], bones: { head: { pivot: [50, 40] } }, parts: { face: { bone: 'head' } }, ...rig })).map(p => p.message);
const tri = [[10, 10], [60, 10], [30, 50]];

test('checkRig: the old masks list is an error that points at shape parts and clips', () => {
  assert.ok(msgs({ masks: [{ id: 'm', part: 'iris', from: 'eye_white' }] }).some(m => m.includes('masks was replaced by shape parts and clip links')));
  assert.ok(msgs({ masks: [] }).some(m => m.includes('masks was replaced')), 'the key itself, even empty');
});

test('maskOf, maskChain and maskCycles follow from links', () => {
  const masks = [{ id: 'a', part: 'iris', from: 'eye_white' }, { id: 'b', part: 'eye_white', polygon: tri }, { id: 'c', part: 'shine', from: 'iris' }];
  assert.equal(maskOf(masks, 'iris').id, 'a');
  assert.equal(maskOf(masks, 'face'), undefined);
  assert.deepEqual(maskChain(masks, 'iris').map(m => m.id), ['a', 'b']);
  assert.deepEqual(maskChain(masks, 'shine').map(m => m.id), ['c', 'a', 'b']);
  assert.deepEqual(maskChain(masks, 'face'), []);
  assert.deepEqual(maskCycles(masks), []);
  const loop = [{ id: 'a', part: 'x', from: 'y' }, { id: 'b', part: 'y', from: 'z' }, { id: 'c', part: 'z', from: 'x' }];
  assert.deepEqual(maskCycles(loop), [['x', 'y', 'z']]);
  assert.equal(maskChain(loop, 'x').length, 3, 'a chain stops when it comes back to a part it has seen');
  assert.equal(maskFrame(masks[0]), 'eye_white');
  assert.equal(maskFrame({ id: 'p', part: 'a', polygon: tri, on: 'head' }), 'head');
  assert.equal(maskFrame({ id: 'p', part: 'a', polygon: tri }), undefined);
});

test('warpPoints carries points along a deformed lattice', () => {
  const box = { w: 100, h: 50 }, rest = restLattice(100, 50, [2, 1]);
  const pts = [25, 25, 75, 10, 100, 50];
  assert.deepEqual([...warpPoints(pts, box, [2, 1], rest)], pts, 'a lattice at rest changes nothing');
  const moved = Float32Array.from(rest);
  for (let i = 0; i < moved.length; i += 2) moved[i] += 10; // every point 10 right
  assert.deepEqual([...warpPoints(pts, box, [2, 1], moved)], [35, 25, 85, 10, 110, 50]);
  const shear = Float32Array.from(rest);
  shear[1] -= 20; shear[3] -= 20; shear[5] -= 20; // the top row 20 up: points move by how near the top they are
  const out = warpPoints([50, 0, 50, 25, 50, 50], box, [2, 1], shear);
  assert.deepEqual([...out], [50, -20, 50, 15, 50, 50]);
  const far = warpPoints([-10, 60], box, [2, 1], moved);
  assert.ok(Math.abs(far[0]) < 1e-4 && Math.abs(far[1] - 60) < 1e-4, 'a point outside the box keeps its place in the edge cell, so a shift of the lattice shifts it too');
  const reuse = new Float32Array(2);
  assert.equal(warpPoints([1, 1], box, [2, 1], rest, reuse), reuse);
});

// An ellipse and a ring on a w x h alpha grid, for the tracing tests.
const grid = (w, h, f) => Uint8Array.from({ length: w * h }, (_, i) => (f(i % w, Math.floor(i / w)) ? 255 : 0));
const area = poly => Math.abs(poly.reduce((a, p, i) => { const q = poly[(i + 1) % poly.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);

test('traceOutline: a full image traces to its box, an empty one to nothing', () => {
  const full = traceOutline(grid(8, 4, () => true), 8, 4);
  assert.equal(full.length, 1);
  assert.deepEqual([...full[0]].sort((a, b) => a[0] - b[0] || a[1] - b[1]), [[0, 0], [0, 1], [1, 0], [1, 1]]);
  assert.deepEqual(traceOutline(grid(8, 4, () => false), 8, 4), []);
  assert.deepEqual(traceOutline(new Uint8Array(3), 8, 4), [], 'a too short buffer is not read past its end');
});

test('traceOutline: an ellipse gives one simple outline close to its area', () => {
  const w = 64, h = 32, cx = 32, cy = 16, rx = 28, ry = 10;
  const a = grid(w, h, (x, y) => ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1);
  const out = traceOutline(a, w, h);
  assert.equal(out.length, 1);
  assert.ok(out[0].length >= 8 && out[0].length <= 64, `${out[0].length} points`);
  const truth = (Math.PI * rx * ry) / (w * h);
  assert.ok(Math.abs(area(out[0]) - truth) / truth < 0.05, `area ${area(out[0])} vs ${truth}`);
  for (const [x, y] of out[0]) assert.ok(x >= 0 && x <= 1 && y >= 0 && y <= 1);
});

test('traceOutline: two blobs give two outlines (biggest first), specks and holes are ignored', () => {
  const w = 40, h = 20;
  const a = grid(w, h, (x, y) => (x >= 2 && x < 16 && y >= 4 && y < 16 && !(x >= 6 && x < 10 && y >= 8 && y < 12)) || (x >= 24 && x < 34 && y >= 4 && y < 14) || (x === 20 && y === 0));
  const out = traceOutline(a, w, h);
  assert.equal(out.length, 2, 'the speck at (20, 0) is dropped');
  assert.ok(area(out[0]) > area(out[1]));
  // The left blob has a hole; its outline is the outer square only: 14 x 12 px of 800.
  assert.ok(Math.abs(area(out[0]) - (14 * 12) / (w * h)) < 1e-9, `${area(out[0])}`);
  assert.ok(Math.abs(area(out[1]) - (10 * 10) / (w * h)) < 1e-9);
  assert.equal(traceOutline(a, w, h, { maxShapes: 1 }).length, 1);
});

test('traceOutline: the threshold picks the soft edge, the point cap thins the outline', () => {
  const w = 30, h = 30;
  const soft = Uint8Array.from({ length: w * h }, (_, i) => { const x = i % w, y = Math.floor(i / w), d = Math.hypot(x + 0.5 - 15, y + 0.5 - 15); return d < 8 ? 255 : d < 12 ? 100 : 0; });
  const inner = traceOutline(soft, w, h, { threshold: 128 }), outer = traceOutline(soft, w, h, { threshold: 50 });
  assert.ok(area(outer[0]) > area(inner[0]) * 1.5);
  const capped = traceOutline(soft, w, h, { threshold: 50, maxPoints: 12 });
  assert.ok(capped[0].length <= 12, `${capped[0].length}`);
  assert.ok(area(capped[0]) > area(outer[0]) * 0.8);
});

test('simplifyOutline drops points that lie on the line and keeps the corners', () => {
  const line = [[0, 0], [1, 0], [2, 0], [3, 0], [3, 1], [3, 2], [3, 3], [0, 3]];
  assert.deepEqual(simplifyOutline(line, 0.1).map(p => p.join(',')).sort(), ['0,0', '0,3', '3,0', '3,3']);
  assert.equal(simplifyOutline([[0, 0], [1, 0], [0, 1]], 5).length, 3);
});

test('mask keyforms reuse the deformer point maths', () => {
  const kfs = [{ param: 'open', keys: [{ at: 0, pts: { 1: [0, 0.2] } }, { at: 1 }] }];
  assert.deepEqual([...evalPointKeyforms(kfs, 3, { open: 0 })].map(n => Math.round(n * 1000) / 1000), [0, 0, 0, 0.2, 0, 0]);
  assert.deepEqual([...evalPointKeyforms(kfs, 3, { open: 1 })], [0, 0, 0, 0, 0, 0]);
  assert.equal(evalPointKeyforms(undefined, 2, {}).length, 4);
  assert.equal(pointKeyformKey(kfs, { open: 0.5, other: 3 }), '0.5', 'only the parameters the keyforms read');
  assert.equal(pointKeyformKey(undefined, { open: 0.5 }), '');
});

test('placeRig also gives the bones\' world matrices; placeParts is unchanged', () => {
  const bones = { head: { pivot: [0, 0] } };
  const parts = { face: { box: { x: 0, y: 0, w: 10, h: 10 }, bone: 'head' } };
  const offsets = new Map([['head', { ...NO_OFFSET, dx: 0.5 }]]);
  const rig = placeRig(bones, parts, offsets, () => null, [0, 0], 100);
  assert.equal(rig.bones.head.tx, 50);
  assert.equal(rig.parts.face.tx, 50);
  assert.deepEqual(placeParts(bones, parts, offsets, () => null, [0, 0], 100), rig.parts);
});

// ---- shape parts ----

const kf = [{ param: 'open', keys: [{ at: 0, pts: { 1: [0, 0.01] } }, { at: 1 }] }];
const lid = { bone: 'head', polygon: tri, keyforms: kf };

test('checkRig: shape parts and clip links are clean', () => {
  assert.deepEqual(msgs({ parts: { face: { bone: 'head' }, tongue: { bone: 'head', clip: 'lid' }, iris: { clip: 'eye_white' }, lid } }), []);
});

test('checkRig: shape part rules', () => {
  const p = parts => msgs({ parts: { face: { bone: 'head' }, ...parts } });
  assert.ok(p({ lid: { polygon: [[0, 0], [1, 1]] } }).some(m => m.includes('parts.lid.polygon: needs 3 to 64 points')));
  assert.ok(p({ lid: { polygon: [[0, 0], [1, 1], ['a', 2]] } }).some(m => m.includes('parts.lid.polygon[2]')));
  assert.ok(p({ iris: { polygon: tri } }).some(m => m.includes('is a part with art')));
  assert.ok(p({ head: { polygon: tri } }).some(m => m.includes('has the name of a bone')));
  assert.ok(p({ lid: { polygon: tri, follow: 'nope' } }).some(m => m.includes('parts.lid.follow: no part with art named "nope"')));
  assert.deepEqual(p({ lid: { polygon: tri, follow: 'face' } }), []);
  assert.ok(p({ lid: { polygon: tri, bone: 'nope' } }).some(m => m.includes('parts.lid.bone: no bone')));
  assert.ok(p({ lid: { polygon: tri, clip: 'face' } }).some(m => m.includes('not itself clipped')));
  assert.ok(p({ lid: { polygon: tri, keyforms: [{ param: 'open', keys: [{ at: 0, pts: { 9: [0, 0] } }, { at: 1 }] }] } }).some(m => m.includes('keyforms')));
  assert.ok(p({ iris: { clip: 'nope' } }).some(m => m.includes('parts.iris.clip: no shape or part named "nope"')));
  assert.ok(p({ iris: { clip: 'head' } }).some(m => m.includes('"head" is a bone')));
  assert.ok(p({ iris: { clip: 'iris' } }).some(m => m.includes('its own shape')));
  assert.ok(p({ lid: { polygon: Array.from({ length: 65 }, (_, i) => [i, i % 7]) } }).some(m => m.includes('needs 3 to 64 points')));
  assert.ok(p({ lid: { polygon: tri, keyforms: [{ param: 'ghost', keys: [{ at: 0 }] }] } }).some(m => m.includes('no parameter "ghost"')));
  assert.ok(p({ lid: { polygon: tri, keyforms: 'x' } }).some(m => m.includes('parts.lid.keyforms: needs a list')));
  assert.equal(MASK_MAX_SHAPES, 2);
  const loop = p({ iris: { clip: 'tongue' }, tongue: { clip: 'iris' } });
  assert.ok(loop.some(m => m.includes('form a loop')), loop.join('\n'));
  assert.ok(!loop.some(m => m.includes('would be clipped through')), 'a loop is reported once, not also as a deep chain');
  assert.ok(p({ iris: { clip: 'tongue' }, tongue: { clip: 'mouth' }, mouth: { clip: 'face' } }).some(m => m.includes('through 3 shapes')));
  assert.deepEqual(p({ iris: { clip: 'tongue' }, tongue: { clip: 'lid' }, lid }), [], 'a part clipped to a clipped part, which is clipped to a shape: two shapes');
  assert.ok(msgs({ order: ['face', 'lid'], parts: { lid } }).some(m => m.includes('"lid" is a shape part')));
});

test('checkRig: one shape may clip many parts, and many clips draw a warning', () => {
  assert.deepEqual(msgs({ parts: { face: { bone: 'head' }, iris: { clip: 'lid' }, tongue: { clip: 'lid' }, lid } }), []);
  const many = { lid };
  for (const n of ['face', 'eye_white', 'iris', 'shine', 'mouth', 'tongue']) many[n] = { clip: 'lid' };
  assert.ok(!msgs({ parts: { ...many, face: { bone: 'head', clip: 'lid' } } }).some(m => m.includes('masks on one character')));
  const nine = { lid };
  for (const n of ['face', 'eye_white', 'iris', 'shine', 'mouth', 'tongue', 'bg1', 'bg2', 'bg3']) nine[n] = { clip: 'lid' };
  assert.ok(msgs({ parts: { ...nine, face: { bone: 'head', clip: 'lid' } } }).some(m => m.includes('9 masks on one character')));
});

test('normalizeMasks reads shape parts and clip links, and skips what is not usable', () => {
  const now = normalizeMasks({ parts: { eyes: { bone: 'head', clip: 'lid' }, iris: { clip: 'eyes' }, lid } });
  assert.deepEqual(now, { shapes: { lid: { bone: 'head', polygon: tri, keyforms: kf } }, clips: { eyes: 'lid', iris: 'eyes' } });
  const odd = normalizeMasks({ parts: { a: { polygon: [[0, 0]] }, b: { clip: 'b' }, c: null, d: { clip: '' } } });
  assert.deepEqual(odd, { shapes: {}, clips: {} }, 'a short polygon, a clip to itself, a null and an empty clip are skipped');
  assert.deepEqual(normalizeMasks(undefined), { shapes: {}, clips: {} });
});

test('maskView gives one MaskDef per clipped part', () => {
  const parts = { tongue: { bone: 'head', clip: 'lid' }, iris: { clip: 'eye_white' }, lid };
  const list = maskView({ parts });
  const byId = (x, y) => x.id.localeCompare(y.id);
  assert.deepEqual([...list].sort(byId), [
    { id: 'iris_mask', part: 'iris', from: 'eye_white' },
    { id: 'lid', part: 'tongue', polygon: tri, on: 'head', keyforms: kf, shape: 'lid' },
  ]);
  assert.deepEqual(maskView({ parts: { a: { clip: 'lid' }, b: { clip: 'lid' }, lid } }).map(m => [m.id, m.part, m.on]), [['lid', 'a', 'head'], ['lid:b', 'b', 'head']], 'a shape clipping several parts');
  assert.deepEqual(maskView({ parts: { x: { clip: 'f' }, f: { follow: 'face', bone: 'head', polygon: tri } } }).map(m => m.on), ['face'], 'follow wins over bone');
  assert.deepEqual(maskView(undefined), []);
});

test('stripMasks and writeShapes: the shapes and clips of the studio go back as shape parts and clip links', () => {
  const parts = { tongue: { bone: 'head', clip: 'lid' }, iris: { clip: 'eye_white' }, face: { bone: 'head' }, lid };
  assert.deepEqual(stripMasks(parts), { tongue: { bone: 'head' }, face: { bone: 'head' } });
  const { shapes, clips } = normalizeMasks({ bones: { head: {} }, parts });
  assert.deepEqual(writeShapes(stripMasks(parts), shapes, clips), parts, 'a round trip');
  const w = writeShapes({ face: { bone: 'head' } }, { face_2: { follow: 'face', polygon: tri } }, { tongue: 'face_2', iris: 'face' });
  assert.deepEqual(w, { face: { bone: 'head' }, face_2: { follow: 'face', polygon: tri }, tongue: { clip: 'face_2' }, iris: { clip: 'face' } });
  assert.deepEqual(shapePartNames(w), ['face_2']);
});

test('maskView with unclipped lists a shape that clips nothing, with no part', () => {
  const view = maskView({ bones: { head: {} }, parts: { a: { clip: 'lid' }, lid, spare: { bone: 'head', polygon: tri } } }, true);
  assert.deepEqual(view.map(m => [m.id, m.part, m.shape]), [['lid', 'a', 'lid'], ['spare', '', 'spare']]);
  assert.equal(maskView({ parts: { spare: { polygon: tri } } }).length, 0, 'not without the flag');
});

test('the studio reads a rig with a shape part as its mask list and writes it back as parts', () => {
  const data = { bones: { head: { pivot: [1, 1] } }, parts: { tongue: { bone: 'head', clip: 'lid' }, lid } };
  const doc = studioDocOf(data);
  assert.deepEqual(doc.shapes, { lid: { bone: 'head', polygon: tri, keyforms: kf } });
  assert.deepEqual(doc.clips, { tongue: 'lid' });
  assert.deepEqual(doc.parts, { tongue: { bone: 'head' } });
  const writes = studioWrites(doc);
  assert.deepEqual(writes.find(w => w.key === 'parts').value, data.parts);
  assert.equal(writes.find(w => w.key === 'masks'), undefined, 'the old list is not written');
});

test('the sample robo keeps its eyelid mask in the shape-part form: the same list as the old masks entry gave', async () => {
  const { readFileSync } = await import('node:fs');
  const rig = JSON.parse(readFileSync(new URL('../../games/sample/assets/char/robo/rig.json', import.meta.url), 'utf8'));
  assert.equal(rig.masks, undefined);
  assert.deepEqual(checkRig({ parts: [{ file: 'eyes.png' }], rig }).filter(p => /mask|clip|eyelids/.test(p.message)), []);
  const [m, ...rest] = maskView(rig);
  assert.equal(rest.length, 0);
  assert.deepEqual({ ...m, keyforms: undefined }, { id: 'eyelids', part: 'eyes', shape: 'eyelids', on: 'head', polygon: [[214, 294], [326, 294], [326, 346], [214, 346]], keyforms: undefined });
  assert.deepEqual(m.keyforms, [{ param: 'eye_open', keys: [{ at: 0, pts: { 0: [0, 0.0241], 1: [0, 0.0241], 2: [0, -0.0241], 3: [0, -0.0241] } }, { at: 1 }] }]);
  assert.ok(!rig.order.includes('eyelids'));
});

// ---- shapes in group warps ----

const group = { box: [10, 20, 100, 50], grid: [1, 1], disp: Float32Array.from([0, 0, 0.01, 0, 0, 0.02, 0.01, 0.02]) };

test('bendShapeByGroup reads the lattice at each point\'s canvas position and adds displacement times unit', async () => {
  const { bendShapeByGroup } = await import('../../dist/engine/src/index.js');
  // drawn space = canvas - at; at = (10, 20) puts drawn (0,0) on the box corner and drawn (100, 50) on the far corner.
  const out = bendShapeByGroup([0, 0, 100, 0, 0, 50, 100, 50, 50, 25], [10, 20], group, 1000);
  assert.deepEqual([...out], [0, 0, 110, 0, 0, 70, 110, 70, 55, 35]);
  const base = bendShapeByGroup([0, 0], [10, 20], group, 1000, [5, 5]);
  assert.deepEqual([...base], [5, 5], 'zero displacement at the corner leaves the base alone');
  const outside = bendShapeByGroup([-500, 0], [10, 20], group, 1000);
  assert.deepEqual([...outside], [-500, 0], 'a point left of the box takes the edge value (0 there)');
});

test('shapeBentByGroup: a shape that follows a member of its own group is not bent twice', async () => {
  const { shapeBentByGroup } = await import('../../dist/engine/src/index.js');
  assert.equal(shapeBentByGroup(undefined, ['face', 'lid']), true);
  assert.equal(shapeBentByGroup('face', ['face', 'lid']), false);
  assert.equal(shapeBentByGroup('other', ['face', 'lid']), true);
  assert.equal(shapeBentByGroup('head', ['face', 'lid']), true, 'a bone is never a member');
});

const grp = (members, extra = {}) => ({ deformers: [{ id: 'g', members, grid: [1, 1], keyforms: [], ...extra }] });
const shapeRig = { eyes: { bone: 'head', clip: 'lid' }, lid: { bone: 'head', polygon: tri } };

test('checkRig: a group warp may list shape parts; box and name rules', () => {
  const base = { parts: { face: { bone: 'head' }, eye_white: { bone: 'head' }, ...shapeRig } };
  assert.deepEqual(msgs({ ...base, ...grp(['face', 'eye_white', 'lid']) }).filter(m => /members|box/.test(m)), []);
  assert.match(msgs({ ...base, ...grp(['lid']) }).join('\n'), /deformers\.g\.box: a group of shapes only/);
  assert.deepEqual(msgs({ ...base, ...grp(['lid'], { box: [0, 0, 50, 50] }) }).filter(m => /box/.test(m)), []);
  assert.match(msgs({ ...base, ...grp(['face', 'nope']) }).join('\n'), /no part or shape named "nope"/);
  assert.match(msgs({ ...base, ...grp(['face', 'head']) }).join('\n'), /"head" is a bone, a group warp needs parts or shapes/);
  assert.match(msgs({ ...base, deformers: [{ id: 'a', members: ['face', 'lid'], keyforms: [] }, { id: 'b', members: ['lid'], box: [0, 0, 5, 5], keyforms: [] }] }).join('\n'), /part "lid" is already in group warp "a"/);
});


test('checkRig: warns when a part in a group warp is clipped to something the group does not bend', () => {
  const parts = { iris: { bone: 'head', clip: 'lid' }, face: { bone: 'head' }, lid: { bone: 'head', polygon: tri } };
  const warn = (members, p = parts) => msgs({ parts: p, ...grp(members) }).filter(m => /is bent by/.test(m));
  assert.deepEqual(warn(['face']), [], 'neither in a group');
  assert.deepEqual(warn(['iris', 'lid']), [], 'both in the group');
  assert.match(warn(['iris'])[0], /^masks: iris is bent by g but its clip shape lid is not/);
  assert.deepEqual(warn(['iris', 'face'], { ...parts, lid: { bone: 'head', follow: 'face', polygon: tri } }), [], 'a shape that follows a member counts');
  assert.match(warn(['iris'], { ...parts, iris: { bone: 'head', clip: 'face' } })[0], /clip part face is not/);
  assert.deepEqual(warn(['lid'], { ...parts }), [], 'a bent shape with an unbent clipped part is not this warning');
});
