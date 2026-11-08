import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRig, defaultPolygon, edgeMidpoint, insertPolygonPoint, movePolygonPoint, nearestEdge, removePolygonPoint, MASK_MAX_POINTS, addShape, renameShape, deleteShape, setClip, moveShape, clipGroupIssues, addToGroup, shapeSummary, clippedBy, clipTargets, shapeAtEdge, shapeAtInside, pointInOutline } from '../../dist/engine/src/index.js';

const tri = [[10, 10], [60, 10], [30, 50]];
const poly = { id: 'm', part: 'iris', polygon: tri, on: 'head', keyforms: [{ param: 'open', keys: [{ at: 0, pts: { 0: [0, 0.1], 2: [0.1, 0] } }, { at: 1 }] }] };

test('defaultPolygon is an inset rectangle in whole pixels, clockwise from the top left', () => {
  assert.deepEqual(defaultPolygon({ x: 100, y: 200, w: 100, h: 50 }, 0.1), [[110, 205], [190, 205], [190, 245], [110, 245]]);
  assert.equal(defaultPolygon({ x: 0, y: 0, w: 10, h: 10 }).length, 4);
});

test('movePolygonPoint rounds, and ignores a missing point or no move', () => {
  const moved = movePolygonPoint(poly, 1, [64.6, 12.2]);
  assert.deepEqual(moved.polygon, [[10, 10], [65, 12], [30, 50]]);
  assert.deepEqual(poly.polygon, tri, 'the old mask is not touched');
  assert.equal(movePolygonPoint(poly, 1, [60, 10]), poly);
  assert.equal(movePolygonPoint(poly, 9, [1, 1]), poly);
  assert.equal(movePolygonPoint(poly, 0, [NaN, 1]), poly);
  assert.equal(movePolygonPoint({ id: 'a', part: 'x', from: 'y' }, 0, [1, 1]).polygon, undefined);
});

test('insertPolygonPoint adds a point and shifts the keyforms\' point numbers up', () => {
  const next = insertPolygonPoint(poly, 1, [35.4, 8]);
  assert.deepEqual(next.polygon, [[10, 10], [35, 8], [60, 10], [30, 50]]);
  assert.deepEqual(next.keyforms[0].keys[0].pts, { 0: [0, 0.1], 3: [0.1, 0] }, 'point 2 became point 3, point 0 stayed');
  assert.deepEqual(insertPolygonPoint(poly, 3, [0, 0]).polygon.at(-1), [0, 0], 'appends at the count');
  assert.equal(insertPolygonPoint(poly, 9, [0, 0]), poly);
  const full = { id: 'f', part: 'p', polygon: Array.from({ length: MASK_MAX_POINTS }, (_, i) => [i, 0]) };
  assert.equal(insertPolygonPoint(full, 0, [1, 1]), full, 'at the cap nothing is added');
});

test('removePolygonPoint drops a point, its keyform entries and shifts the rest down; three points stay three', () => {
  const four = insertPolygonPoint(poly, 1, [35, 8]);
  const next = removePolygonPoint(four, 0);
  assert.deepEqual(next.polygon, [[35, 8], [60, 10], [30, 50]]);
  assert.deepEqual(next.keyforms[0].keys[0].pts, { 2: [0.1, 0] }, 'point 0 is gone, point 3 became 2');
  assert.equal(removePolygonPoint(poly, 0), null);
  assert.equal(removePolygonPoint(four, 9), null);
  const bare = removePolygonPoint({ id: 'a', part: 'p', polygon: [[0, 0], [1, 0], [1, 1], [0, 1]] }, 3);
  assert.equal(bare.keyforms, undefined);
});

test('an edited polygon still passes checkRig, keyforms included', () => {
  const m = insertPolygonPoint(poly, 1, [35, 8]);
  const msgs = checkRig({ width: 100, height: 100, parts: [{ file: 'iris.png' }, { file: 'face.png' }], rig: { parameters: [{ id: 'open', min: 0, max: 1, default: 1 }], bones: { head: { pivot: [0, 0] } }, parts: { face: { bone: 'head' }, iris: { clip: 'lid' }, lid: { bone: 'head', polygon: m.polygon, ...(m.keyforms ? { keyforms: m.keyforms } : {}) } } } }).map(p => p.message);
  assert.deepEqual(msgs, []);
});

test('nearestEdge finds the closest side of the closed polygon', () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const top = nearestEdge(sq, [5, -2]);
  assert.equal(top.index, 0);
  assert.deepEqual(top.at, [5, 0]);
  assert.equal(top.dist, 2);
  assert.equal(nearestEdge(sq, [-3, 5]).index, 3, 'the closing edge from the last point to the first');
  assert.equal(nearestEdge(sq, [15, 15]).dist, Math.hypot(5, 5));
  assert.equal(nearestEdge([[1, 1]], [0, 0]), null);
  assert.deepEqual(edgeMidpoint(sq, 3), [0, 5]);
  assert.equal(edgeMidpoint(sq, 4), null);
});

const base = () => ({
  shapes: { lids: { bone: 'head', polygon: tri, keyforms: [{ param: 'open', keys: [{ at: 0 }] }] }, spare: { polygon: tri } },
  clips: { eyes: 'lids', iris: 'eyes' },
  deformers: [{ id: 'head_warp', members: ['face', 'lids'], keyforms: [] }, { id: 'torso_warp', part: 'torso', keyforms: [] }],
});
const names = { parts: ['face', 'eyes', 'iris', 'shine', 'torso'], bones: ['head', 'body'] };
const sets = { parts: new Set(names.parts), bones: new Set(names.bones) };

test('addShape makes a unique name, copies the polygon, and clips the part when asked', () => {
  const set = base();
  const a = addShape(set, names, { polygon: tri, bone: 'head' });
  assert.equal(a.name, 'shape');
  assert.deepEqual(a.set.shapes.shape, { bone: 'head', polygon: tri });
  assert.notEqual(a.set.shapes.shape.polygon, tri);
  assert.deepEqual(a.set.clips, set.clips, 'no clip without a part');
  assert.equal(addShape(a.set, names, { polygon: tri }).name, 'shape_2');
  const b = addShape(set, names, { polygon: tri, clipPart: 'shine' });
  assert.equal(b.name, 'shine_mask');
  assert.equal(b.set.clips.shine, 'shine_mask');
  assert.equal(addShape(set, names, { polygon: tri, name: 'face' }).name, 'face_2', 'a part name is taken');
  assert.equal(addShape(set, names, { polygon: tri, name: 'head' }).name, 'head_2', 'a bone name too');
  assert.equal(addShape(set, names, { polygon: tri, clipPart: 'eyes', name: 'lids' }).name, 'lids_2', 'and another shape name');
  assert.ok(addShape(set, names, { polygon: [[0, 0], [1, 1]] }).error);
  assert.deepEqual(Object.keys(set.shapes), ['lids', 'spare'], 'the old set is not touched');
});

test('renameShape follows every clip and group member, and refuses a taken or empty name', () => {
  const set = base();
  const r = renameShape(set, names, 'lids', 'eyelids');
  assert.deepEqual(Object.keys(r.set.shapes), ['eyelids', 'spare'], 'same place in the list');
  assert.equal(r.set.clips.eyes, 'eyelids');
  assert.equal(r.set.clips.iris, 'eyes');
  assert.deepEqual(r.set.deformers[0].members, ['face', 'eyelids']);
  assert.deepEqual(set.deformers[0].members, ['face', 'lids']);
  for (const to of ['', '  ', 'face', 'head', 'spare', 'lids']) assert.ok(renameShape(set, names, 'lids', to).error, `"${to}" is refused`);
  assert.ok(renameShape(set, names, 'nope', 'x').error);
  assert.equal(renameShape(set, names, 'lids', ' lids2 ').name, 'lids2', 'trimmed');
});

test('deleteShape frees the clipped parts, leaves the groups, and says what changed', () => {
  const set = base();
  const d = deleteShape(set, 'lids');
  assert.deepEqual(Object.keys(d.set.shapes), ['spare']);
  assert.deepEqual(d.set.clips, { iris: 'eyes' }, 'eyes is drawn whole; iris still clips to the part eyes');
  assert.deepEqual(d.set.deformers[0].members, ['face']);
  assert.match(d.note, /eyes is drawn whole again/);
  assert.match(d.note, /removed from head_warp/);
  const alone = deleteShape({ ...set, deformers: [{ id: 'g', members: ['lids'], keyforms: [] }] }, 'lids');
  assert.deepEqual(alone.set.deformers, [], 'a group left with no member goes');
  assert.equal(deleteShape(set, 'spare').note, 'Deleted shape spare.');
  assert.ok(deleteShape(set, 'nope').error);
});

test('setClip links a part to a shape or a part, and enforces the rules of checkMasks', () => {
  const set = base();
  assert.deepEqual(setClip(set, sets.parts, 'shine', 'spare').set.clips, { eyes: 'lids', iris: 'eyes', shine: 'spare' });
  assert.deepEqual(setClip(set, sets.parts, 'eyes', null).set.clips, { iris: 'eyes' });
  assert.equal(setClip(set, sets.parts, 'shine', null).set, set, 'nothing to clear');
  assert.ok(setClip(set, sets.parts, 'shine', 'shine').error, 'not itself');
  assert.ok(setClip(set, sets.parts, 'shine', 'head').error, 'not a bone');
  assert.ok(setClip(set, sets.parts, 'shine', 'nope').error);
  assert.ok(setClip(set, sets.parts, 'lids', 'spare').error, 'a shape is not clipped');
  assert.ok(setClip(set, sets.parts, 'shine', 'iris').error, 'shine > iris > eyes > lids is three shapes');
  assert.ok(setClip(set, sets.parts, 'eyes', 'iris').error, 'a loop');
  assert.equal(setClip(set, sets.parts, 'torso', 'eyes').set.clips.torso, 'eyes', 'two levels are fine');
});

test('moveShape changes the bone and the part it follows', () => {
  const set = base();
  assert.equal(moveShape(set, sets, 'lids', { bone: 'body' }).set.shapes.lids.bone, 'body');
  assert.equal('bone' in moveShape(set, sets, 'lids', { bone: null }).set.shapes.lids, false);
  const f = moveShape(set, sets, 'lids', { follow: 'face' });
  assert.deepEqual([f.set.shapes.lids.bone, f.set.shapes.lids.follow], ['head', 'face']);
  assert.deepEqual(f.set.shapes.lids.keyforms, set.shapes.lids.keyforms, 'keyforms are kept');
  assert.equal(moveShape(set, sets, 'lids', { bone: 'head' }).set, set, 'no change');
  assert.ok(moveShape(set, sets, 'lids', { bone: 'face' }).error);
  assert.ok(moveShape(set, sets, 'lids', { follow: 'head' }).error);
  assert.ok(moveShape(set, sets, 'nope', { bone: 'head' }).error);
});

test('clipGroupIssues finds a clipped part in a group whose shape is not, and addToGroup fixes it', () => {
  const set = base();
  assert.deepEqual(clipGroupIssues(set), [], 'eyes is not in a group');
  const bent = { ...set, deformers: [{ id: 'head_warp', members: ['face', 'eyes'], keyforms: [] }] };
  assert.deepEqual(clipGroupIssues(bent), [{ part: 'eyes', shape: 'lids', group: 'head_warp' }]);
  const fixed = addToGroup(bent.deformers, 'head_warp', 'lids');
  assert.deepEqual(fixed[0].members, ['face', 'eyes', 'lids']);
  assert.deepEqual(clipGroupIssues({ ...bent, deformers: fixed }), []);
  const follows = { ...bent, shapes: { ...bent.shapes, lids: { ...bent.shapes.lids, follow: 'face' } } };
  assert.deepEqual(clipGroupIssues(follows), [], 'a shape that follows a member is bent with it');
  assert.deepEqual(addToGroup([{ id: 'a', members: ['x', 'lids'], keyforms: [] }, { id: 'b', members: ['y'], keyforms: [] }], 'b', 'lids').map(d => d.members), [['x'], ['y', 'lids']], 'a member is in one group at most');
});

test('shapeSummary, clippedBy and clipTargets', () => {
  const set = base();
  assert.equal(shapeSummary(set, 'lids'), 'shape, 3 points, clips 1');
  assert.equal(shapeSummary(set, 'spare'), 'shape, 3 points');
  assert.equal(shapeSummary(set, 'iris'), 'to eyes');
  assert.equal(shapeSummary(set, 'face'), '2 shapes');
  assert.equal(shapeSummary({ shapes: {}, clips: {} }, null), 'none');
  assert.deepEqual(clippedBy(set, 'lids'), ['eyes']);
  assert.deepEqual(clipTargets(['a', 'b', 'c'], 'b'), ['a', 'c']);
});

test('the point edits work on a shape as on a mask', () => {
  const shape = base().shapes.lids;
  assert.deepEqual(insertPolygonPoint(shape, 1, [35, 8]).polygon, [[10, 10], [35, 8], [60, 10], [30, 50]]);
  assert.equal(movePolygonPoint(shape, 0, [1, 2]).bone, 'head');
});

test('shapeAtEdge picks the nearest outline within the tolerance; shapeAtInside the smallest shape around the point', () => {
  const big = { name: 'big', outlines: [[[0, 0], [100, 0], [100, 100], [0, 100]]] };
  const small = { name: 'small', outlines: [[[40, 40], [60, 40], [60, 60], [40, 60]]] };
  assert.equal(shapeAtEdge([big, small], [50, 2], 8), 'big');
  assert.equal(shapeAtEdge([big, small], [50, 43], 8), 'small');
  assert.equal(shapeAtEdge([big, small], [50, 50], 8), null, 'in the middle of both, far from the edges');
  assert.equal(shapeAtEdge([big, small], [50, 52], 8), 'small', 'near an edge of the small one');
  assert.equal(shapeAtEdge([big, small], [50, 20], 8), null);
  assert.equal(shapeAtInside([big, small], [50, 50]), 'small');
  assert.equal(shapeAtInside([big, small], [10, 10]), 'big');
  assert.equal(shapeAtInside([big, small], [150, 10]), null);
  assert.equal(pointInOutline([[0, 0], [10, 0], [10, 10]], [8, 2]), true);
  assert.equal(pointInOutline([[0, 0], [10, 0], [10, 10]], [2, 8]), false);
});
