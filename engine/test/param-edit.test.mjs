import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addParam, updateParam, deleteParam, addPad, updatePad, deletePad, uniqueParamId, freeParams, fitAxis, checkParams, checkPoses, checkDeformers,
  addCategory, renameCategory, deleteCategory, moveCategory, moveControlTo, moveControl, controlGroups,
} from '../../dist/engine/src/index.js';

const doc = () => structuredClone({
  categories: ['Head', 'Arms', 'Body'],
  parameters: [
    { id: 'head_x', min: -1, max: 1, default: 0, group: 'Head' },
    { id: 'head_y', min: -1, max: 1, default: 0, group: 'Head' },
    { id: 'lift', min: 0, max: 1, default: 0 },
  ],
  pads: [{ id: 'head_turn', x: 'head_x', y: 'head_y', group: 'Head' }],
  keyforms: [
    { target: 'head', param: 'head_x', keys: [{ at: -1, rot: -8 }, { at: 0 }, { at: 1, rot: 8 }] },
    { target: 'eyes', params: ['head_x', 'head_y'], grid: { x: [-1, 0, 1], y: [0, 1] }, forms: [{ dx: -1 }, {}, { dx: 1 }, { dy: 1 }, {}, { dy: 2 }] },
    { target: 'arm', param: 'lift', keys: [{ at: 0 }, { at: 1, rot: 70 }] },
  ],
  poses: { turn: { head_x: 1, lift: 1 }, only_head: { head_x: -1 } },
  anims: { nod: { keys: [], params: { head_x: [{ t: 0, v: 0 }, { t: 1, v: 1 }], lift: [{ t: 0, v: 0 }] } } },
  deformers: [{ id: 'w', part: 'torso', keyforms: [{ param: 'head_x', keys: [{ at: 0 }, { at: 1, pts: { 0: [0.1, 0] } }] }, { param: 'lift', keys: [{ at: 0 }] }] }],
  shapes: { m: { polygon: [[0, 0], [1, 0], [1, 1]], keyforms: [{ param: 'head_x', keys: [{ at: 1, pts: { 1: [0.1, 0] } }] }] }, m2: { polygon: [[0, 0], [1, 0], [1, 1]] } },
  physics: { hair: { inputs: [{ param: 'head_x', weight: 1 }], segments: [{ length: 1 }], outputs: [{ param: 'lift', scale: 1 }] } },
});
const ok = r => { assert.ok(!('error' in r), r.error); return r; };
const problems = d => {
  const out = [];
  checkParams({ categories: d.categories, parameters: d.parameters, pads: d.pads, keyforms: d.keyforms }, new Set(['head', 'eyes', 'arm']), m => out.push(m));
  checkPoses({ poses: d.poses, parameters: d.parameters }, m => out.push(m));
  checkDeformers({ deformers: d.deformers, parameters: d.parameters }, new Set(['torso']), new Set(), new Set(), m => out.push(m));
  return out;
};

test('a new parameter gets a free id and a range of -1 to 1', () => {
  const r = ok(addParam(doc()));
  assert.equal(r.id, 'param');
  assert.deepEqual(r.doc.parameters.at(-1), { id: 'param', min: -1, max: 1, default: 0 });
  assert.equal(ok(addParam(r.doc)).id, 'param2');
  assert.equal(uniqueParamId(['a', 'a2'], 'a'), 'a3');
  assert.equal(ok(addParam(doc(), 'Body')).doc.parameters.at(-1).group, 'Body');
  assert.match(addParam(doc(), 'Nowhere').error, /no category/);
  assert.deepEqual(problems(r.doc), []);
});

test('renaming a parameter reaches the keyforms, pads, poses, tracks, deformers, masks and physics', () => {
  const r = ok(updateParam(doc(), 'head_x', { id: 'turn_x' }));
  assert.equal(r.id, 'turn_x');
  const d = r.doc;
  assert.deepEqual(d.parameters.map(p => p.id), ['turn_x', 'head_y', 'lift']);
  assert.equal(d.pads[0].x, 'turn_x');
  assert.equal(d.keyforms[0].param, 'turn_x');
  assert.deepEqual(d.keyforms[1].params, ['turn_x', 'head_y']);
  assert.deepEqual(Object.keys(d.poses.turn), ['turn_x', 'lift'], 'the pose keeps its order');
  assert.deepEqual(Object.keys(d.anims.nod.params), ['turn_x', 'lift']);
  assert.equal(d.deformers[0].keyforms[0].param, 'turn_x');
  assert.equal(d.shapes.m.keyforms[0].param, 'turn_x');
  assert.equal(d.physics.hair.inputs[0].param, 'turn_x');
  assert.deepEqual(problems(d), []);
  assert.match(r.note, /Script lines that name "head_x"/);
  assert.equal(doc().parameters[0].id, 'head_x');
});

test('a bad rename or range is refused with a sentence', () => {
  assert.match(updateParam(doc(), 'head_x', { id: 'lift' }).error, /already/);
  assert.match(updateParam(doc(), 'head_x', { id: '2fast' }).error, /letters, digits/);
  assert.match(updateParam(doc(), 'head_x', { id: 'a b' }).error, /letters, digits/);
  assert.match(updateParam(doc(), 'nope', { min: 0 }).error, /no parameter/);
  assert.match(updateParam(doc(), 'lift', { min: 2 }).error, /less than the maximum/);
  assert.match(updateParam(doc(), 'lift', { default: 5 }).error, /between 0 and 1/);
  assert.match(updateParam(doc(), 'lift', { ease: 'wobble' }).error, /Unknown ease/);
  assert.match(updateParam(doc(), 'lift', { max: NaN }).error, /numbers/);
});

test('the range grows without touching keys; the default follows a range that no longer holds it', () => {
  const d = doc();
  const grown = ok(updateParam(d, 'head_x', { min: -30, max: 30 }));
  assert.deepEqual(grown.doc.keyforms, d.keyforms);
  assert.deepEqual(grown.doc.parameters[0], { id: 'head_x', min: -30, max: 30, default: 0, group: 'Head' });
  const moved = ok(updateParam(d, 'lift', { min: 0.5, max: 2 }));
  assert.equal(moved.doc.parameters[2].default, 0.5);
  assert.match(moved.note, /default moved to 0.5/);
  const explicit = ok(updateParam(d, 'lift', { default: 0.25 }));
  assert.equal(explicit.doc.parameters[2].default, 0.25);
  assert.deepEqual(problems(explicit.doc), []);
});

test('a range that no longer holds the keys moves the nearest onto the edge, drops the rest, and clamps poses and tracks', () => {
  assert.deepEqual(fitAxis([-1, 0, 1], -0.5, 0.5), { values: [-0.5, 0, 0.5], keep: [0, 1, 2] });
  assert.deepEqual(fitAxis([-2, -1, 0, 1], -0.5, 5), { values: [-0.5, 0, 1], keep: [1, 2, 3] });
  assert.deepEqual(fitAxis([0, 1], 0, 0.5), { values: [0, 0.5], keep: [0, 1] });
  assert.deepEqual(fitAxis([-1, -0.5, 0.5, 1], -0.5, 0.5), { values: [-0.5, 0.5], keep: [1, 2] }, 'lines at the edge stay; none is moved on top of them');
  const r = ok(updateParam(doc(), 'head_x', { min: -0.5, max: 0.5 }));
  const d = r.doc;
  assert.deepEqual(d.keyforms[0].keys, [{ at: -0.5, rot: -8 }, { at: 0 }, { at: 0.5, rot: 8 }]);
  assert.deepEqual(d.keyforms[1].grid.x, [-0.5, 0, 0.5]);
  assert.equal(d.keyforms[1].forms.length, 6);
  assert.deepEqual(d.poses.turn, { head_x: 0.5, lift: 1 });
  assert.deepEqual(d.anims.nod.params.head_x.map(k => k.v), [0, 0.5]);
  assert.deepEqual(d.deformers[0].keyforms[0].keys.map(k => k.at), [0, 0.5]);
  assert.deepEqual(d.shapes.m.keyforms[0].keys.map(k => k.at), [0.5]);
  assert.match(r.note, /beyond the new range/);
  assert.deepEqual(problems(d), []);
  // A y range: the rows of the grid go (y is [0, 1] here), the columns stay.
  const rows = ok(updateParam(doc(), 'head_y', { min: -1, max: 0.5 })).doc.keyforms[1];
  assert.deepEqual(rows.grid, { x: [-1, 0, 1], y: [0, 0.5] });
  assert.deepEqual(rows.forms, [{ dx: -1 }, {}, { dx: 1 }, { dy: 1 }, {}, { dy: 2 }], 'the nearest row moved onto the edge');
});

test('category and ease can be set and cleared; a category must exist', () => {
  const a = ok(updateParam(doc(), 'lift', { group: 'Arms', ease: 'inout' })).doc.parameters[2];
  assert.deepEqual(a, { id: 'lift', min: 0, max: 1, default: 0, group: 'Arms', ease: 'inout' });
  const b = ok(updateParam(ok(updateParam(doc(), 'lift', { group: 'Arms', ease: 'inout' })).doc, 'lift', { group: null, ease: '' })).doc.parameters[2];
  assert.deepEqual(b, { id: 'lift', min: 0, max: 1, default: 0 });
  assert.match(updateParam(doc(), 'lift', { group: 'Nowhere' }).error, /no category "Nowhere"/);
});

test('categories: add, rename (members follow), delete (members go to Other), reorder', () => {
  const added = ok(addCategory(doc()));
  assert.equal(added.id, 'Category');
  assert.deepEqual(added.doc.categories, ['Head', 'Arms', 'Body', 'Category']);
  assert.equal(ok(addCategory(added.doc)).id, 'Category2');
  assert.equal(ok(addCategory(doc(), 'Other')).id, 'Other2', 'Other is taken: it is where the uncategorised show');
  const renamed = ok(renameCategory(doc(), 'Head', 'Face')).doc;
  assert.deepEqual(renamed.categories, ['Face', 'Arms', 'Body']);
  assert.deepEqual([renamed.parameters[0].group, renamed.parameters[1].group, renamed.pads[0].group], ['Face', 'Face', 'Face']);
  assert.match(renameCategory(doc(), 'Head', 'Arms').error, /already/);
  assert.match(renameCategory(doc(), 'Head', 'Other').error, /already/);
  assert.match(renameCategory(doc(), 'Head', '  ').error, /needs a name/);
  assert.match(renameCategory(doc(), 'Nope', 'x').error, /no category/);
  const gone = ok(deleteCategory(doc(), 'Head'));
  assert.deepEqual(gone.doc.categories, ['Arms', 'Body']);
  assert.deepEqual(gone.doc.parameters.map(p => p.group), [undefined, undefined, undefined]);
  assert.equal('group' in gone.doc.pads[0], false);
  assert.match(gone.note, /3 controls moved to Other/);
  assert.deepEqual(problems(gone.doc), []);
  assert.deepEqual(ok(moveCategory(doc(), 'Body', 'Head')).doc.categories, ['Body', 'Head', 'Arms']);
  assert.deepEqual(ok(moveCategory(doc(), 'Head')).doc.categories, ['Arms', 'Body', 'Head']);
  assert.deepEqual(ok(moveCategory(doc(), 'Arms', 'Body')).doc.categories, ['Head', 'Arms', 'Body']);
  assert.match(moveCategory(doc(), 'Head', 'Nope').error, /no category/);
});

test('controlGroups lists the categories in order, empty ones too, and Other last only when it has controls', () => {
  const d = doc();
  assert.deepEqual(controlGroups(d.parameters, d.pads, d.categories).map(g => g.name), ['Head', 'Arms', 'Body', 'Other']);
  const lone = controlGroups(d.parameters.filter(p => p.group), d.pads, d.categories);
  assert.deepEqual(lone.map(g => [g.name, g.controls.length]), [['Head', 3], ['Arms', 0], ['Body', 0]]);
});

test('moveControlTo puts a slider or pad in a category, in front of a mate or last, and Other is null', () => {
  const d = ok(addParam(ok(addParam(doc(), 'Arms')).doc, 'Arms')).doc; // lift, param, param2 after head_x, head_y
  const ids = (doc, cat) => controlGroups(doc.parameters, doc.pads, doc.categories).find(g => g.name === cat).controls.map(c => (c.kind === 'pad' ? `pad:${c.pad.id}` : c.param.id));
  assert.deepEqual(ids(d, 'Arms'), ['param', 'param2']);
  const into = ok(moveControlTo(d, 'lift', 'Arms', 'param2')).doc;
  assert.deepEqual(ids(into, 'Arms'), ['param', 'lift', 'param2']);
  assert.deepEqual(ids(ok(moveControlTo(d, 'lift', 'Arms')).doc, 'Arms'), ['param', 'param2', 'lift'], 'last when there is no mate to go before');
  assert.deepEqual(ids(ok(moveControlTo(d, 'lift', 'Arms', 'pad:head_turn')).doc, 'Arms'), ['param', 'param2', 'lift'], 'a mate of another kind does not place it');
  const pad = ok(moveControlTo(d, 'pad:head_turn', 'Body')).doc;
  assert.equal(pad.pads[0].group, 'Body');
  assert.deepEqual(ids(pad, 'Body'), ['pad:head_turn', 'head_x', 'head_y'], 'its axes come along');
  const other = ok(moveControlTo(d, 'pad:head_turn', null)).doc;
  assert.equal('group' in other.pads[0], false);
  assert.ok(ids(other, 'Other').includes('pad:head_turn'), 'a pad without a category shows in Other, whatever its x parameter says');
  assert.match(moveControlTo(d, 'lift', 'Nowhere').error, /no category/);
  assert.match(moveControlTo(d, 'nope', 'Arms').error, /no parameter/);
  assert.deepEqual(problems(into), []);
});

test('a pad keeps its two axis sliders under it, in its category, and they cannot be moved apart', () => {
  const d = doc();
  const names = (g, cat) => g.find(x => x.name === cat).controls.map(c => (c.kind === 'pad' ? `pad:${c.pad.id}` : c.param.id));
  // the axes show under the pad whatever their own group says
  const stray = { ...d, parameters: d.parameters.map(p => (p.id === 'head_y' ? { ...p, group: 'Body' } : p)) };
  const g = controlGroups(stray.parameters, stray.pads, stray.categories);
  assert.deepEqual(names(g, 'Head'), ['pad:head_turn', 'head_x', 'head_y']);
  assert.deepEqual(names(g, 'Body'), []);
  // nothing moves an axis alone
  assert.match(moveControlTo(d, 'head_x', 'Arms').error, /axis of the pad "head_turn"/);
  assert.match(updateParam(d, 'head_x', { group: 'Arms' }).error, /stays in its category/);
  assert.match(moveControl(d, 'head_y', 1).error, /stays under the pad/);
  assert.ok(!('error' in updateParam(d, 'head_x', { group: 'Head', min: -2 })), 'saying its own category again is no change');
  // the pad takes them along, and a pad made or changed puts them in its category
  const moved = ok(moveControlTo(d, 'pad:head_turn', 'Arms')).doc;
  assert.deepEqual(moved.parameters.filter(p => p.id.startsWith('head_')).map(p => p.group), ['Arms', 'Arms']);
  assert.deepEqual(names(controlGroups(moved.parameters, moved.pads, moved.categories), 'Arms'), ['pad:head_turn', 'head_x', 'head_y']);
  const out = ok(moveControlTo(d, 'pad:head_turn', null)).doc;
  assert.deepEqual(out.parameters.filter(p => p.id.startsWith('head_')).map(p => p.group), [undefined, undefined]);
  const made = ok(addPad(ok(addParam(ok(addParam(d, 'Body')).doc, 'Body')).doc, 'Body', { x: 'lift', y: 'param' })).doc;
  assert.deepEqual(made.parameters.filter(p => ['lift', 'param'].includes(p.id)).map(p => p.group), ['Body', 'Body']);
  // taking the pad away leaves the sliders where they were shown
  const gone = ok(deletePad(moved, 'head_turn')).doc;
  assert.deepEqual(names(controlGroups(gone.parameters, gone.pads, gone.categories), 'Arms'), ['head_x', 'head_y']);
});

test('checkParams: categories are a list of unique names, and a group names one of them', () => {
  const run = data => { const out = []; checkParams(data, new Set(), m => out.push(m)); return out; };
  const p = group => ({ id: 'a', min: 0, max: 1, default: 0, ...(group ? { group } : {}) });
  assert.deepEqual(run({ categories: ['A'], parameters: [p('A')] }), []);
  assert.match(run({ parameters: [p('A')] })[0], /group "A" is not in categories/);
  assert.match(run({ categories: 'A' })[0], /list of names/);
  assert.match(run({ categories: ['A', 'A'] })[0], /listed twice/);
  assert.match(run({ categories: ['Other'] })[0], /"Other"/);
  assert.match(run({ categories: [''] })[0], /each needs a name/);
  assert.match(run({ categories: [], parameters: [p()], pads: [{ id: 'q', x: 'a', y: 'a', group: 'Z' }] })[0], /pads\.q: group "Z"/);
});

test('deleting a parameter takes its keyforms, pads, pose values, tracks and warp keyforms; physics blocks it', () => {
  assert.match(deleteParam(doc(), 'head_x').error, /physics chain hair/);
  const noPhysics = { ...doc(), physics: {} };
  const r = ok(deleteParam(noPhysics, 'head_x'));
  const d = r.doc;
  assert.deepEqual(d.parameters.map(p => p.id), ['head_y', 'lift']);
  assert.deepEqual(d.pads, []);
  assert.deepEqual(d.keyforms.map(k => k.target), ['arm']);
  assert.deepEqual(d.poses, { turn: { lift: 1 } }, 'a pose left empty goes');
  assert.deepEqual(Object.keys(d.anims.nod.params), ['lift']);
  assert.deepEqual(d.deformers[0].keyforms.map(k => k.param), ['lift']);
  assert.equal('keyforms' in d.shapes.m, false);
  assert.deepEqual(d.shapes.m2.polygon, [[0, 0], [1, 0], [1, 1]]);
  assert.deepEqual(problems(d), []);
  assert.match(r.note, /2 bone or part keyforms, 1 pad, 2 pose values, 1 animation track, 2 warp or mask keyforms/);
  const last = ok(deleteParam({ ...noPhysics, anims: { nod: { keys: [], params: { lift: [{ t: 0, v: 0 }] } } } }, 'lift'));
  assert.equal('params' in last.doc.anims.nod, false, 'a track list left empty goes');
  assert.match(deleteParam(doc(), 'nope').error, /no parameter/);
});

test('pads: add over the parameters picked (or new ones), rename, change axes, delete', () => {
  assert.match(addPad(doc(), undefined, { x: 'head_x', y: 'lift' }).error, /on another pad already/);
  assert.match(addPad(doc(), undefined, { x: 'lift', y: 'lift' }).error, /two different/);
  assert.match(addPad(doc(), undefined, { x: 'nope', y: null }).error, /no parameter "nope"/);
  assert.match(addPad(doc(), undefined, { id: 'a b', x: null, y: null }).error, /letters, digits/);
  assert.match(addPad(doc(), undefined, { id: 'head_turn', x: null, y: null }).error, /already/);
  const fresh = ok(addPad(doc(), undefined, { id: 'eyes', x: null, y: 'lift' }));
  assert.deepEqual(fresh.doc.pads.at(-1), { id: 'eyes', x: 'eyes_x', y: 'lift' });
  assert.deepEqual(fresh.doc.parameters.at(-1), { id: 'eyes_x', min: -1, max: 1, default: 0 });
  assert.deepEqual(ok(addPad(doc(), undefined, { x: null, y: null })).doc.pads.at(-1), { id: 'pad', x: 'pad_x', y: 'pad_y' });
  const more = ok(addParam(ok(addParam(doc())).doc)).doc;
  assert.deepEqual(freeParams(more).map(p => p.id), ['lift', 'param', 'param2']);
  const added = ok(addPad(more, undefined, { x: 'lift', y: 'param' }));
  assert.equal(added.id, 'pad');
  assert.deepEqual(added.doc.pads.at(-1), { id: 'pad', x: 'lift', y: 'param' });
  assert.equal(ok(addPad(more, 'Arms', { x: 'lift', y: 'param' })).doc.pads.at(-1).group, 'Arms');
  assert.match(addPad(more, 'Nowhere', { x: 'lift', y: 'param' }).error, /no category/);
  const renamed = ok(updatePad(added.doc, 'pad', { id: 'arm_pad', y: 'param2', group: 'Arms' }));
  assert.deepEqual(renamed.doc.pads.at(-1), { id: 'arm_pad', x: 'lift', y: 'param2', group: 'Arms' });
  assert.match(updatePad(added.doc, 'pad', { x: 'head_x' }).error, /another pad/);
  assert.match(updatePad(added.doc, 'pad', { y: 'lift' }).error, /two different parameters/);
  assert.match(updatePad(added.doc, 'pad', { y: 'nope' }).error, /no parameter/);
  assert.match(updatePad(added.doc, 'pad', { id: 'head_turn' }).error, /already/);
  assert.match(updatePad(added.doc, 'pad', { id: '1' }).error, /letters, digits/);
  assert.deepEqual(ok(updatePad(renamed.doc, 'arm_pad', { group: null })).doc.pads.at(-1), { id: 'arm_pad', x: 'lift', y: 'param2' });
  const gone = ok(deletePad(renamed.doc, 'arm_pad'));
  assert.equal(gone.doc.pads.length, 1);
  assert.equal(gone.doc.parameters.length, renamed.doc.parameters.length, 'its parameters stay');
  assert.deepEqual(gone.doc.keyforms, renamed.doc.keyforms);
  assert.match(deletePad(doc(), 'nope').error, /no pad/);
});

test('editing never touches the input document', () => {
  const d = doc(), frozen = structuredClone(d);
  updateParam(d, 'head_x', { id: 'turn_x', min: -0.5 });
  deleteParam({ ...d, physics: {} }, 'head_x');
  addParam(d); addPad(d, undefined, { x: null, y: null }); updatePad(d, 'head_turn', { id: 'x' }); deletePad(d, 'head_turn');
  assert.deepEqual(d, frozen);
});

test('moveControl swaps a slider or pad with its neighbour in the same group, and refuses at the ends', async () => {
  const { moveControl } = await import('../../dist/engine/src/index.js');
  const p = (id, group) => ({ id, min: 0, max: 1, default: 0, ...(group ? { group } : {}) });
  const doc = { categories: ['G', 'H'], parameters: [p('a', 'G'), p('x', 'H'), p('b', 'G'), p('c', 'G')], pads: [{ id: 'p1', x: 'x', y: 'y' }], keyforms: [], poses: {}, anims: {}, deformers: [], shapes: {}, physics: {} };
  const order = d => controlGroups(d.parameters, d.pads, d.categories).find(g => g.name === 'G').controls.map(c => c.param.id);
  assert.deepEqual(order(doc), ['a', 'b', 'c']);
  const down = moveControl(doc, 'a', 1);
  assert.deepEqual(order(down.doc), ['b', 'a', 'c']);
  assert.deepEqual(doc.parameters.map(x => x.id), ['a', 'x', 'b', 'c'], 'the input is not changed');
  assert.deepEqual(order(moveControl(down.doc, 'c', -1).doc), ['b', 'c', 'a']);
  assert.match(moveControl(doc, 'a', -1).error, /already the first slider of G/);
  assert.match(moveControl(doc, 'c', 1).error, /already the last/);
  assert.match(moveControl(doc, 'nope', 1).error, /no parameter/);
  assert.match(moveControl(doc, 'pad:p1', 1).error, /no pad|already/);
});
