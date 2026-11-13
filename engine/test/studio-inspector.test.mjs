import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toolBar, modeLabel, weightsBar, warpBar, gizmoLine, gizmoLock, choiceCue, brushStep, focusHeader, propBlocks, subOpenKey, PROP_BLOCK_IDS, keepNote } from '../../dist/engine/src/index.js';

test('the bar shows one panel per tool: Move, Rotate and Scale share the gizmo line', () => {
  for (const t of ['move', 'rotate', 'scale']) assert.equal(toolBar(t), 'gizmo');
  for (const t of ['pivot', 'warp', 'weights', 'mask']) assert.equal(toolBar(t), t);
});

test('the mode label names the tool and what it works on, the Weights brush and its active bone', () => {
  assert.equal(modeLabel('warp', 'torso'), 'Warp · torso');
  assert.equal(modeLabel('mask', null), 'Mask · nothing chosen');
  assert.equal(modeLabel('weights', 'hair_back', 'add', 'hair_1_0'), 'Weights · Add on hair_1_0');
  assert.equal(modeLabel('weights', 'hair_back', 'pick', null), 'Weights · Read weights');
  assert.equal(modeLabel('weights', null, 'add', null), 'Weights · no mesh chosen');
});

const ws = o => weightsBar({ hasMesh: true, bound: 2, brush: 'add', skinned: true, measured: true, selected: 0, posed: false, ...o });

test('the Weights bar: the brush shows with a mesh and works once a bone is bound; the test pose wants a bone', () => {
  assert.deepEqual(weightsBar({ hasMesh: false, bound: 0, brush: 'add', skinned: false, measured: false, selected: 0, posed: false }),
    { brush: false, brushOn: false, paint: false, pose: false, reset: false, selection: false, none: false, setValue: false, mirror: false });
  const unbound = ws({ bound: 0 });
  assert.equal(unbound.brush, true, 'shown before a bind, disabled: the brush is the first thing the tool is for');
  assert.equal(unbound.brushOn, false);
  assert.equal(unbound.pose, false);
  assert.equal(ws({}).brushOn, true);
  assert.equal(ws({}).pose, true);
  assert.equal(ws({}).reset, false, 'nothing posed: nothing to reset');
  assert.equal(ws({ posed: true }).reset, true);
  assert.equal(ws({}).paint, true, 'radius and strength for a painting brush');
  for (const brush of ['pick', 'select']) assert.equal(ws({ brush }).paint, false, brush + ' does not paint: no radius or strength');
});

test('the Weights bar: the selection operations show in Select mode only, and wait for what they need', () => {
  assert.equal(ws({}).selection, false);
  const sel = ws({ brush: 'select' });
  assert.equal(sel.selection, true);
  assert.equal(sel.none, false);
  assert.equal(sel.setValue, false, 'Set value works on a selection');
  assert.equal(sel.mirror, true, 'Mirror copies a half, selection or not');
  assert.equal(ws({ brush: 'select', selected: 3 }).setValue, true);
  assert.equal(ws({ brush: 'select', selected: 3 }).none, true);
  assert.equal(ws({ brush: 'select', skinned: false }).mirror, false, 'no weights: nothing to mirror');
  assert.equal(ws({ brush: 'select', measured: false }).mirror, false, 'the stage has not measured the image yet');
  assert.equal(ws({ brush: 'select', bound: 0 }).selection, false, 'before a bind the stage only reads');
});

test('the gizmo line says what the gizmo poses and whether a drag writes', () => {
  assert.match(gizmoLine({ mode: 'model', chosen: null, subject: null }), /^Nothing chosen/);
  assert.equal(gizmoLine({ mode: 'model', chosen: 'torso', subject: 'spine', param: 'breathe', bound: false, other: ['warp'] }),
    "poses spine, the bone torso sits on · spine has no pose on breathe, D keys torso's warp");
  assert.equal(gizmoLine({ mode: 'model', chosen: 'head', subject: 'head', param: 'head_x', bound: true }), 'poses head · a drag writes its keyform of head_x');
  // UX round 3 MD-15: a part bound to nothing whose bone is bound points to the bone.
  assert.equal(gizmoLine({ mode: 'model', chosen: 'upper_r', subject: 'arm_r', param: null, movedBy: [], boneMovedBy: { bone: 'arm_r', params: ['arm_r_lift'] } }),
    'poses arm_r, the bone upper_r sits on · upper_r is bound to no parameter, its bone arm_r is (arm_r_lift): Alt-click upper_r chooses arm_r, or Bind to parameter… binds upper_r itself');
  // UX round 3 MR-1: a part with no pivot of its own turns and scales about its bone's joint.
  assert.equal(gizmoLine({ mode: 'model', chosen: 'eyes', subject: 'eyes', param: 'eye_open', bound: true, pivotFrom: 'head' }),
    "poses eyes · a drag writes its keyform of eye_open · about head's joint: Q, then a click, gives eyes a pivot of its own");
  assert.doesNotMatch(gizmoLine({ mode: 'model', chosen: 'eyes', subject: 'head', param: 'eye_open', bound: true, pivotFrom: 'head' }), /joint/, 'only when the part itself is posed');
  assert.match(gizmoLine({ mode: 'model', chosen: 'head', subject: 'head', param: 'blink', bound: false }), /head is not bound to blink: nothing to drag until it is \(Bind parts…, or ◆ on blink's row, binds it\)$/);
});

test('the gizmo is locked exactly when a drag would be thrown away at the release', () => {
  const model = o => gizmoLock({ mode: 'model', chosen: 'head', subject: 'head', param: 'head_x', bound: true, hasParams: true, ...o });
  assert.equal(model({}), null, 'bound to the active parameter: a drag writes its keyform');
  assert.equal(model({ param: null }), 'noParam');
  assert.equal(model({ param: null, hasParams: false }), 'noParams');
  assert.equal(model({ bound: false }), 'unbound');
  assert.equal(model({ bound: false, other: ['warp'] }), 'unbound', 'bound by its warp only: the gizmo poses nothing there');
  assert.equal(model({ bound: false, setBound: true }), null, 'a Ctrl-clicked part is bound: the drag writes that one');
  assert.equal(model({ chosen: null, subject: null }), null, 'nothing chosen: no gizmo to lock');
  const animate = o => gizmoLock({ mode: 'animate', chosen: 'head', subject: 'head', anim: { name: 'nod', preset: false }, autoKey: true, ...o });
  assert.equal(animate({}), null);
  assert.equal(animate({ autoKey: false }), null, 'Auto-key off: the drag waits for Key');
  assert.equal(animate({ anim: null }), 'noAnim');
  assert.equal(animate({ anim: { name: 'idle', preset: true } }), 'preset');
});

test('with no parameter active the gizmo line names the ways to bind, since a click on an unbound parameter drops the part', () => {
  assert.equal(gizmoLine({ mode: 'model', chosen: 'mouth', subject: 'head', param: null, movedBy: [], hasParams: true }),
    "poses head, the bone mouth sits on · mouth is bound to no parameter: Bind to parameter…, or ◆ on a parameter's row, binds it (a click on a name would choose the parameter alone)");
  assert.match(gizmoLine({ mode: 'model', chosen: 'head', subject: 'head', param: null, movedBy: ['head_x'], hasParams: true }),
    /no parameter is active: head_x moves head, click it in Parameters; ◆ on another parameter binds head to it$/);
  assert.match(gizmoLine({ mode: 'model', chosen: 'head', subject: 'head', param: null, movedBy: ['head_x', 'head_y'] }), /head_x, head_y move head, click one in Parameters/);
  assert.match(gizmoLine({ mode: 'model', chosen: 'hair', subject: 'hair', param: null, hasParams: false }), /no parameters: \+ in Parameters adds one$/);
  assert.match(gizmoLine({ mode: 'model', chosen: 'lid', subject: 'lid', param: 'blink', bound: false, other: ['warp', 'mask'] }), /D keys lid's warp, M keys lid's mask$/);
});

test('in Animate the gizmo line says where a drag keys', () => {
  assert.equal(gizmoLine({ mode: 'animate', chosen: 'head', subject: 'head', anim: { name: 'nod', preset: false }, autoKey: true }), 'poses head · a drag keys nod at the playhead');
  assert.match(gizmoLine({ mode: 'animate', chosen: 'head', subject: 'head', anim: { name: 'nod', preset: false }, autoKey: false }), /Key writes it into nod$/);
  assert.match(gizmoLine({ mode: 'animate', chosen: 'head', subject: 'head', anim: { name: 'idle', preset: true } }), /idle is a preset/);
  assert.match(gizmoLine({ mode: 'animate', chosen: 'head', subject: 'head', anim: null }), /no animation/);
});

test('[ and ] change the brush radius by a fifth, with Shift the strength by 0.05, within their limits', () => {
  assert.deepEqual(brushStep(']', false, 30, 0.25), { radius: 36, strength: 0.25 });
  assert.deepEqual(brushStep('[', false, 30, 0.25), { radius: 25, strength: 0.25 });
  assert.deepEqual(brushStep(']', false, 4, 0.25), { radius: 5, strength: 0.25 }, 'a small radius still grows');
  assert.deepEqual(brushStep('[', false, 4, 0.25), { radius: 4, strength: 0.25 });
  assert.deepEqual(brushStep(']', false, 290, 0.25), { radius: 300, strength: 0.25 });
  assert.deepEqual(brushStep(']', true, 30, 0.25), { radius: 30, strength: 0.3 });
  assert.deepEqual(brushStep('{', false, 30, 0.25), { radius: 30, strength: 0.2 }, 'Shift+[ arrives as { on most layouts');
  assert.deepEqual(brushStep('}', false, 30, 1), { radius: 30, strength: 1 });
  assert.deepEqual(brushStep('[', true, 30, 0.05), { radius: 30, strength: 0.05 });
  assert.equal(brushStep('x', false, 30, 0.25), null);
});

const wb = o => warpBar({ hasWarp: true, mesh: false, topo: false, keyed: true, selected: 0, soft: false, ...o });

test('the Warp bar: the selection and the operations show with a warp; the operations write only with an active parameter', () => {
  assert.deepEqual(warpBar({ hasWarp: false, mesh: false, topo: false, keyed: false, selected: 0, soft: false }),
    { selection: false, rows: false, none: false, reach: false, operations: false, keyed: false, onSelection: false, topology: false, topoToggle: false });
  const v = wb({});
  assert.equal(v.selection, true);
  assert.equal(v.rows, true, 'a lattice has rows and columns to pick');
  assert.equal(wb({ mesh: true }).rows, false, 'a free mesh has none');
  assert.equal(v.none, false, 'nothing chosen: nothing to clear');
  assert.equal(wb({ selected: 4 }).none, true);
  assert.equal(v.reach, false);
  assert.equal(wb({ soft: true }).reach, true, 'reach and curve with a soft selection');
  assert.equal(v.operations, true);
  assert.equal(wb({ keyed: false }).keyed, false, 'no active parameter: Mirror, Smooth and the presets wait');
  assert.equal(v.onSelection, false, 'Scale and Rotate act on chosen points');
  assert.equal(wb({ selected: 4 }).onSelection, true);
  assert.equal(wb({ selected: 4, keyed: false }).onSelection, false);
});

test('the Warp bar: with Edit topology on, the topology tools take the place of the rest', () => {
  const v = wb({ mesh: true, topo: true, selected: 3 });
  assert.equal(v.topology, true);
  for (const k of ['selection', 'rows', 'none', 'operations', 'onSelection']) assert.equal(v[k], false, k);
  assert.equal(wb({ topo: true }).topology, false, 'a lattice has no topology mode');
  assert.equal(wb({ mesh: true }).topoToggle, true, 'Edit topology is in the bar for a mesh, on or off');
  assert.equal(v.topoToggle, true);
  assert.equal(wb({}).topoToggle, false, 'a lattice has none');
  assert.equal(wb({ hasWarp: false, mesh: true }).topoToggle, false);
});

const fh = o => focusHeader({ mode: 'model', part: null, param: null, hasParams: true, bound: 0, bindable: 5, movedBy: 0, bindableParams: 3, kind: 'pose', copySources: 0, ...o });
const verbs = v => v.verbs.map(x => `${x.id}${x.enabled ? '' : ' (off)'}`);

test('the focus header: nothing in Animate, a line with nothing in focus, no verbs and no pickers', () => {
  assert.equal(fh({ mode: 'animate', part: 'torso' }), null);
  const none = fh({});
  assert.equal(none.kind, 'none');
  assert.deepEqual(none.verbs, []);
  assert.equal(none.partPick.show, false);
  assert.equal(none.paramPick.show, false);
  assert.match(none.empty, /^Nothing in focus/);
});

test('the focus header by focus kind: a parameter binds parts, a part binds to a parameter and copies keys, a keyform does both', () => {
  const param = fh({ param: 'breathe', bound: 2 });
  assert.equal(param.kind, 'param');
  assert.deepEqual(verbs(param), ['bindParts']);
  assert.deepEqual([param.partPick.show, param.partPick.enabled, param.paramPick.show], [true, true, false]);
  assert.match(param.partPick.title, /^The parts bound to breathe \(2\)/);
  const part = fh({ part: 'torso', movedBy: 1, copySources: 4 });
  assert.equal(part.kind, 'part');
  assert.deepEqual(verbs(part), ['bindToParam', 'copyKeys (off)'], 'keys are copied onto the active parameter: none is in focus');
  assert.match(part.verbs[1].title, /choose one first/);
  assert.deepEqual([part.partPick.show, part.paramPick.show, part.paramPick.enabled], [false, true, true]);
  const kf = fh({ part: 'torso', param: 'breathe', bound: 2, movedBy: 1, copySources: 4 });
  assert.equal(kf.kind, 'keyform');
  assert.deepEqual(verbs(kf), ['bindParts', 'bindToParam', 'copyKeys'], 'in workflow order');
  assert.deepEqual(kf.verbs.map(x => x.name), ['Bind parts…', 'Bind to parameter…', 'Copy keys from…']);
  assert.deepEqual(kf.verbs.map(x => x.label), ['Bind parts…', 'Bind to…', 'Copy keys…'], 'three verbs in one line: shortened');
  assert.deepEqual(part.verbs.map(x => x.label), ['Bind to parameter…', 'Copy keys from…'], 'two keep their names');
  assert.deepEqual([kf.partPick.show, kf.paramPick.show], [true, true]);
  assert.equal(kf.keyformNote, '', 'Keyforms shows the keyform itself');
  assert.match(param.keyformNote, /^Choose a part bound to breathe/);
  assert.match(part.keyformNote, /^Choose a parameter that moves torso/);
});

test('the focus header: a verb that cannot run is disabled and says why; an empty picker too', () => {
  const full = fh({ param: 'breathe', bindable: 0 });
  assert.deepEqual(verbs(full), ['bindParts (off)']);
  assert.equal(full.verbs[0].title, 'Every part is bound to breathe already');
  assert.equal(full.partPick.enabled, false);
  assert.match(full.partPick.title, /^No parts are bound to breathe yet/);
  assert.match(fh({ part: 'torso', hasParams: false }).verbs[0].title, /no parameters yet/);
  assert.equal(fh({ part: 'torso', bindableParams: 0 }).verbs[0].title, 'torso is bound to every parameter already');
  const lone = fh({ part: 'torso' });
  assert.equal(lone.paramPick.enabled, false);
  assert.match(lone.paramPick.title, /^Nothing moves torso yet/);
  const warp = fh({ part: 'torso', param: 'breathe', kind: 'warp', copySources: 4 });
  assert.deepEqual(verbs(warp).at(-1), 'copyKeys (off)');
  assert.match(warp.verbs.at(-1).title, /^Only pose keys are copied/);
  assert.match(fh({ part: 'torso', param: 'breathe' }).verbs.at(-1).title, /^No other part has pose keys/);
});

import { absentByFocus, rangeLine, pointKeyStrip } from '../../dist/engine/src/index.js';
const ops = v => v.formOps.map(x => `${x.id}${x.enabled ? '' : ' (off)'}`);

test('a keyform has Copy form, Paste form, Paste mirrored and Reset; any other focus none', () => {
  assert.deepEqual(fh({ param: 'breathe' }).formOps, []);
  assert.deepEqual(fh({ part: 'torso' }).formOps, []);
  const kf = o => fh({ part: 'torso', param: 'breathe', bound: 1, movedBy: 1, ...o });
  assert.deepEqual(ops(kf({ form: { can: true, keyed: true, clip: null } })), ['copyForm', 'pasteForm (off)', 'pasteMirrored (off)', 'resetForm']);
  assert.match(kf({ form: { can: true, keyed: true, clip: null } }).formOps[1].title, /^Nothing copied yet/);
  const full = kf({ form: { can: true, keyed: false, clip: 'arm_l at arm_lift 1' } });
  assert.deepEqual(ops(full), ['copyForm', 'pasteForm', 'pasteMirrored', 'resetForm (off)'], 'between keys: nothing stored to reset');
  assert.match(full.formOps[2].title, /^Paste arm_l at arm_lift 1 mirrored sideways/);
  assert.equal(full.formOps[3].title, 'No key here: nothing to reset');
  const mask = kf({ kind: 'mask', form: { can: false, keyed: false, clip: 'x' } });
  assert.deepEqual(ops(mask), ['copyForm (off)', 'pasteForm (off)', 'pasteMirrored (off)', 'resetForm (off)']);
  assert.match(mask.formOps[0].title, /^A mask shape's keys are written in rig\.json/);
  assert.match(kf({}).formOps[1].title, /^torso is not bound to breathe by a pose/, 'no form state: nothing can be written');
  assert.deepEqual(kf({ form: { can: true, keyed: true, clip: 'x' } }).formOps.map(x => x.label), ['Copy form', 'Paste form', 'Paste mirrored', 'Reset']);
  assert.deepEqual(kf({}).formOps.map(x => x.short), ['Copy', 'Paste', 'Paste mirrored', 'Reset'], "Keyforms' row: one line at 340 px");
  const warpClip = kf({ form: { can: true, keyed: true, clip: 'torso at breathe 1', clipKind: 'warp' } });
  assert.deepEqual(ops(warpClip), ['copyForm', 'pasteForm (off)', 'pasteMirrored (off)', 'resetForm'], 'a warp\'s points do not paste as a pose');
  assert.match(warpClip.formOps[1].title, /^torso at breathe 1 is a warp's points: paste it with the Warp tool/);
});

test('a warp binding copies and pastes its keyform\'s shape; Reset takes the chosen points back to rest', () => {
  const kf = form => fh({ part: 'torso', param: 'breathe', bound: 1, movedBy: 1, kind: 'warp', form });
  const none = kf({ can: false, keyed: false, clip: null });
  assert.deepEqual(ops(none), ['copyForm (off)', 'pasteForm (off)', 'pasteMirrored (off)', 'resetForm (off)']);
  assert.match(none.formOps[0].title, /^torso has no warp to key on breathe/);
  const fresh = kf({ can: true, keyed: true, clip: null, lattice: true, selected: 0 });
  assert.deepEqual(ops(fresh), ['copyForm', 'pasteForm (off)', 'pasteMirrored (off)', 'resetForm (off)']);
  assert.match(fresh.formOps[1].title, /^Nothing copied yet: Copy form copies the shape of the warp/);
  assert.match(fresh.formOps[3].title, /^No point chosen/);
  assert.equal(fresh.formOps[3].label, 'Reset points');
  const pose = kf({ can: true, keyed: true, clip: 'arm_l at lift 1', clipKind: 'pose', lattice: true, selected: 1 });
  assert.deepEqual(ops(pose), ['copyForm', 'pasteForm (off)', 'pasteMirrored (off)', 'resetForm']);
  assert.match(pose.formOps[1].title, /^arm_l at lift 1 is a pose: paste it with Move/);
  assert.equal(pose.formOps[3].title, 'Take the chosen point back to rest in this keyform');
  const lattice = kf({ can: true, keyed: false, clip: 'torso at breathe 1', clipKind: 'warp', fits: true, lattice: true, selected: 3 });
  assert.deepEqual(ops(lattice), ['copyForm', 'pasteForm', 'pasteMirrored', 'resetForm'], 'between keys too: a paste or a reset makes a key there');
  assert.match(lattice.formOps[2].title, /dx changes sign/);
  assert.match(lattice.formOps[3].title, /^Take the 3 chosen points back to rest/);
  const mesh = kf({ can: true, keyed: true, clip: 'bangs at sway 1', clipKind: 'warp', fits: true, lattice: false, selected: 0 });
  assert.deepEqual(ops(mesh), ['copyForm', 'pasteForm', 'pasteMirrored (off)', 'resetForm (off)']);
  assert.match(mesh.formOps[2].title, /^A mesh's vertices have no fixed partners/);
  const other = kf({ can: true, keyed: true, clip: 'head at breathe 1', clipKind: 'warp', fits: false, lattice: true, selected: 0 });
  assert.deepEqual(ops(other), ['copyForm', 'pasteForm (off)', 'pasteMirrored (off)', 'resetForm (off)']);
  assert.match(other.formOps[1].title, /different number of points/);
});

test('the key strip of a warp or a mask: the key the slider is on, its neighbours, and what the key button does', () => {
  const ticks = [{ at: 1, posed: true }, { at: 0, posed: false }, { at: 0.5, posed: true }];
  const s = pointKeyStrip(ticks, 0.51, 0.02, 'warp');
  assert.deepEqual(s.keys.map(k => `${k.at}${k.here ? '*' : ''}`), ['0', '0.5*', '1'], 'sorted; the nearest key within reach is pressed');
  assert.deepEqual([s.prev, s.next, s.action], [0, 1, 'remove']);
  const between = pointKeyStrip(ticks, 0.7, 0.02, 'warp');
  assert.deepEqual([between.keys.some(k => k.here), between.prev, between.next, between.action], [false, 0.5, 1, 'add']);
  assert.deepEqual([pointKeyStrip(ticks, 0, 0.02, 'warp').action, pointKeyStrip(ticks, 0, 0.02, 'warp').prev], ['remove', null], 'a warp\'s key at the default can go too');
  assert.equal(pointKeyStrip(ticks, 0.5, 0.02, 'mask').action, 'locked', 'a mask\'s keys are written in rig.json');
  assert.deepEqual(pointKeyStrip([], 0.3, 0.02, 'warp'), { keys: [], prev: null, next: null, action: 'add' });
});

test('a parameter alone shows the Parameter section in place of Keyforms and Properties', () => {
  assert.deepEqual(absentByFocus('model', 'param'), ['keyforms', 'sel']);
  for (const k of ['none', 'part', 'keyform']) assert.deepEqual(absentByFocus('model', k), ['param'], k);
  assert.deepEqual(absentByFocus('animate', 'param'), []);
  assert.equal(rangeLine({ min: -1, max: 1, default: 0 }), '-1 to 1, default 0');
  assert.equal(rangeLine({ min: 0, max: 1 / 3, default: 0.25 }), '0 to 0.333, default 0.25');
});

const blocks = o => Object.fromEntries(propBlocks({ row: 'part', name: 'eyes', tool: 'move', clip: { to: null, shape: false }, ...o }).blocks.map(b => [b.id, b]));

test('propBlocks: a part has Transform (never folded), Clip, and Variants when it is a slot; nothing chosen shows none', () => {
  const b = blocks({});
  assert.deepEqual(Object.keys(b), ['transform', 'deform', 'skin', 'clip', 'variants'], 'in rigging order');
  assert.equal(b.transform.shown, true);
  assert.equal(b.transform.fixed, true);
  assert.equal(b.transform.destructive, null, 'a part\'s pivot verbs are in the Pivot bar');
  assert.equal(b.clip.shown, true);
  assert.equal(b.variants.shown, false, 'not a slot');
  const slot = blocks({ slot: { shown: 'eyes_open' } }).variants;
  assert.deepEqual([slot.shown, slot.summary, slot.auto, slot.primary, slot.destructive], [true, 'eyes_open', false, null, null]);
  assert.equal(blocks({ slot: { shown: null } }).variants.summary, 'nothing shown');
  const none = propBlocks({ row: null, name: null, tool: 'move' });
  assert.ok(none.blocks.every(x => !x.shown));
  assert.match(none.empty, /^Nothing chosen/);
  assert.equal(propBlocks({ row: 'part', name: 'eyes', tool: 'move' }).empty, '');
});

test('propBlocks: Clip of a part says what it is clipped to, with New shape and Remove clip', () => {
  const free = blocks({}).clip;
  assert.deepEqual([free.summary, free.pick, free.primary.id, free.primary.enabled, free.destructive], ['Not clipped', false, 'newShape', true, null]);
  const clipped = blocks({ clip: { to: 'lid', shape: true } }).clip;
  assert.deepEqual([clipped.summary, clipped.pick, clipped.destructive.id], ['Clipped to', true, 'removeClip'], 'once clipped, the Clip to picker stands in the line');
  assert.match(clipped.destructive.title, /clipped to lid/);
  assert.equal(blocks({ row: 'set', clip: { to: null, shape: false } }).clip.shown, true, 'a set (step 4d) has the part\'s Clip');
});

test('propBlocks: Clip of a shape names its bone, its points and what it clips, and deletes it', () => {
  const s = blocks({ row: 'shape', name: 'lid', clip: undefined, shape: { bone: 'head', points: 6, clips: 2 } });
  assert.equal(s.transform.shown, false, 'a shape has no pivot: its bone and what it follows are in Clip');
  assert.equal(s.variants.shown, false);
  assert.deepEqual([s.clip.shown, s.clip.summary, s.clip.primary, s.clip.destructive.id], [true, 'Shape on head, 6 points, clips 2', null, 'deleteShape']);
  assert.equal(blocks({ row: 'shape', name: 'lid', shape: { bone: null, points: 3, clips: 0 } }).clip.summary, 'Shape on the character, 3 points, clips nothing');
});

test('propBlocks: Clip opens by itself with the Mask tool where there is a step to take, never with another tool', () => {
  assert.equal(blocks({}).clip.auto, false, 'Move');
  assert.equal(blocks({ tool: 'mask' }).clip.auto, true, 'not clipped: Clip to, New shape');
  assert.equal(blocks({ tool: 'mask', clip: { to: 'lid', shape: true } }).clip.auto, true, 'clipped to a shape: its points');
  assert.equal(blocks({ tool: 'mask', clip: { to: 'face', shape: false } }).clip.auto, false, 'clipped to a part\'s silhouette: nothing to edit');
  assert.equal(blocks({ tool: 'mask', row: 'shape', name: 'lid', shape: { bone: null, points: 3, clips: 0 } }).clip.auto, true);
  assert.equal(blocks({ tool: 'warp' }).clip.auto, false);
  assert.ok(Object.values(blocks({ tool: 'mask', slot: { shown: 'a' } })).every(b => b.id === 'clip' || !b.auto), 'Transform and Variants never open by themselves');
});

test('propBlocks: a bone has the bone view in Transform, Remove bone as its verb, and no Clip or Variants', () => {
  const b = blocks({ row: 'bone', name: 'head', clip: undefined });
  assert.deepEqual([b.transform.shown, b.transform.summary, b.transform.destructive.id, b.transform.destructive.enabled], [true, 'Bone', 'removeBone', true]);
  assert.match(b.transform.destructive.title, /^Remove head: /);
  assert.equal(b.clip.shown, false);
  assert.equal(b.variants.shown, false);
  assert.equal(subOpenKey('clip'), 'sub:clip');
  assert.deepEqual([...PROP_BLOCK_IDS], ['transform', 'deform', 'skin', 'clip', 'variants']);
});

const dfm = o => ({ kind: 'none', candidates: 0, own: false, seed: null, params: true, ...o });
const skn = o => ({ mesh: true, bound: 0, free: 3, skinned: false, ...o });

test('propBlocks: Deform of a part says what warp it has, adds one, and removes it', () => {
  const none = blocks({ deform: dfm({}) }).deform;
  assert.deepEqual([none.shown, none.summary, none.pick, none.primary.id, none.primary.label, none.primary.enabled, none.destructive], [true, 'No warp', false, 'addWarp', 'Add warp to eyes', true, null]);
  const noParam = blocks({ deform: dfm({ params: false }) }).deform.primary;
  assert.equal(noParam.enabled, false, 'a lattice needs a parameter');
  assert.match(noParam.title, /make one with \+ in the Parameters section/);
  const lat = blocks({ deform: dfm({ kind: 'lattice', grid: [2, 3], candidates: 1, own: true }) }).deform;
  assert.deepEqual([lat.summary, lat.pick, lat.primary, lat.destructive.id, lat.destructive.label], ['Lattice 2×3', false, null, 'removeWarp', 'Remove warp']);
  assert.equal(blocks({ deform: dfm({ kind: 'mesh', vertices: 212, candidates: 1, own: true }) }).deform.summary, 'Mesh 212 vertices');
  assert.equal(blocks({ deform: dfm({ kind: 'mesh', vertices: 1, candidates: 1, own: true }) }).deform.summary, 'Mesh 1 vertex');
  const grp = blocks({ deform: dfm({ kind: 'group', grid: [3, 3], group: { id: 'face', parts: 4, shapes: 0 }, candidates: 1 }) }).deform;
  assert.deepEqual([grp.summary, grp.pick, grp.primary.id, grp.destructive.label], ['', true, 'addWarp', 'Remove group warp'], 'a member of a group: the Target ▾ in the line names it, and the part can still get its own warp');
  assert.match(grp.destructive.title, /^Remove the group warp face: its members \(4 parts\)/);
  const two = blocks({ deform: dfm({ kind: 'lattice', grid: [2, 2], candidates: 2, own: true }) }).deform;
  assert.deepEqual([two.pick, two.summary], [true, ''], 'its own warp and a group: the Target ▾ chooses, and names the one edited');
  assert.match(blocks({ deform: dfm({ kind: 'group', group: { id: 'face', parts: 3, shapes: 1 }, candidates: 1 }) }).deform.destructive.title, /\(3 parts, 1 shape\)/);
});

test('propBlocks: Deform adds a group warp from a bone or from the parts ticked, and shows for a shape only in a group', () => {
  const bone = blocks({ row: 'bone', name: 'head', clip: undefined, deform: dfm({ seed: { bone: 'head' } }) });
  assert.deepEqual([bone.deform.shown, bone.deform.summary, bone.deform.primary.id, bone.deform.primary.label], [true, 'No group warp', 'addGroupWarp', 'Add group warp from head']);
  assert.equal(bone.skin.shown, false, 'a bone has no skin');
  const bare = blocks({ row: 'bone', name: 'root', clip: undefined, deform: dfm({}) }).deform;
  assert.deepEqual([bare.shown, bare.primary], [true, null], 'no parts on it: nothing to add');
  const ticked = blocks({ deform: dfm({ seed: { parts: 3 } }) }).deform.primary;
  assert.deepEqual([ticked.id, ticked.label], ['addGroupWarp', 'Add group warp from 3 selected parts'], 'parts ticked: the group comes first');
  const shape = { row: 'shape', name: 'lid', clip: undefined, shape: { bone: null, points: 3, clips: 1 } };
  assert.equal(blocks({ ...shape, deform: dfm({}) }).deform.shown, false, 'a shape has no warp of its own');
  const lone = blocks({ ...shape, tool: 'warp', deform: dfm({}) }).deform;
  assert.deepEqual([lone.shown, lone.summary, lone.primary, lone.auto], [true, 'In no group warp', null, false], 'with the Warp tool it says so, and has nothing to add');
  const bent = blocks({ ...shape, deform: dfm({ kind: 'group', group: { id: 'face', parts: 2, shapes: 1 }, candidates: 1 }) }).deform;
  assert.deepEqual([bent.shown, bent.summary, bent.pick, bent.primary, bent.destructive], [true, '', true, null, null], 'a shape in a group: the Target ▾ names it; the group is removed from a member part or the bone');
  assert.equal(blocks({}).deform.shown, false, 'no deform state: not drawn');
});

test('propBlocks: Deform opens by itself when the Warp tool has nothing to edit, or the Weights tool a part with no mesh', () => {
  assert.equal(blocks({ tool: 'warp', deform: dfm({}) }).deform.auto, true, 'Add warp, Generate mesh');
  assert.equal(blocks({ tool: 'warp', deform: dfm({ kind: 'lattice', grid: [2, 2], candidates: 1, own: true }) }).deform.auto, false, 'a warp to edit: the bar and the stage have it');
  assert.equal(blocks({ tool: 'move', deform: dfm({}) }).deform.auto, false);
  assert.equal(blocks({ tool: 'warp', row: 'bone', name: 'head', clip: undefined, deform: dfm({ seed: { bone: 'head' } }) }).deform.auto, true);
  assert.equal(blocks({ tool: 'warp', row: 'bone', name: 'root', clip: undefined, deform: dfm({}) }).deform.auto, false, 'a bone with nothing on it');
  assert.equal(blocks({ tool: 'weights', deform: dfm({}), skin: skn({ mesh: false }) }).deform.auto, true, 'Generate mesh');
  assert.equal(blocks({ tool: 'weights', deform: dfm({ kind: 'mesh', vertices: 9, candidates: 1, own: true }), skin: skn({}) }).deform.auto, false);
});

test('propBlocks: Skin shows for a part with a mesh, or any part with the Weights tool, and binds and unskins', () => {
  assert.equal(blocks({}).skin.shown, false, 'no skin state: not drawn');
  assert.equal(blocks({ skin: skn({ mesh: false }) }).skin.shown, false, 'no mesh, Move: nothing to say');
  const nomesh = blocks({ tool: 'weights', skin: skn({ mesh: false }) }).skin;
  assert.deepEqual([nomesh.shown, nomesh.summary, nomesh.pick, nomesh.primary, nomesh.destructive], [true, 'No mesh: Generate mesh in Deform', false, null, null]);
  const fresh = blocks({ skin: skn({}) }).skin;
  assert.deepEqual([fresh.shown, fresh.summary, fresh.pick, fresh.primary.id, fresh.primary.enabled, fresh.destructive], [true, 'Not skinned', true, 'bind', true, null], 'Bind ▾ stands in the line');
  const done = blocks({ skin: skn({ bound: 2, free: 0, skinned: true }) }).skin;
  assert.deepEqual([done.summary, done.primary.enabled, done.destructive.id], ['2 bones', false, 'removeSkin']);
  assert.match(done.primary.title, /bound already/);
  assert.equal(blocks({ skin: skn({ bound: 1, skinned: true }) }).skin.summary, '1 bone');
  assert.match(blocks({ skin: skn({ bound: 0, free: 0 }) }).skin.primary.title, /no bones/);
  assert.equal(blocks({ row: 'shape', name: 'lid', clip: undefined, skin: skn({}) }).skin.shown, false, 'parts only');
});

test('propBlocks: Skin opens by itself with the Weights tool on a mesh with no bone bound, or in Read weights', () => {
  assert.equal(blocks({ tool: 'weights', brush: 'add', skin: skn({}) }).skin.auto, true, 'Bind');
  assert.equal(blocks({ tool: 'weights', brush: 'add', skin: skn({ bound: 2, skinned: true }) }).skin.auto, false, 'painting: the bar and the stage have it');
  assert.equal(blocks({ tool: 'weights', brush: 'pick', skin: skn({ bound: 2, skinned: true }) }).skin.auto, true, 'the Vertex row is the readout');
  assert.equal(blocks({ tool: 'warp', skin: skn({}) }).skin.auto, false);
  assert.equal(blocks({ tool: 'weights', skin: skn({ mesh: false }) }).skin.auto, false, 'no mesh: Deform opens instead');
});

test('propBlocks: a clip-group issue puts a ⚠ on Clip\'s line, its fix being in Deform', () => {
  assert.equal(blocks({}).clip.warn, undefined);
  const c = blocks({ clipIssue: 'eyes is bent by the group warp face, but its shape lid is not a member.' }).clip;
  assert.match(c.warn, /^eyes is bent by the group warp face.*Properties › Deform has the fix\.$/);
});

import { sharedField, setView } from '../../dist/engine/src/index.js';

test('sharedField: the value every entry has, compared by content, or mixed', () => {
  assert.deepEqual(sharedField(['head', 'head']), { mixed: false, value: 'head' });
  assert.deepEqual(sharedField([null, null]), { mixed: false, value: null }, 'none of them has one: shared, and blank because it is none');
  assert.deepEqual(sharedField([[3, 4], [3, 4]]), { mixed: false, value: [3, 4] }, 'two pivots at the same spot are the same');
  assert.deepEqual(sharedField([[3, 4], [3, 5]]), { mixed: true, value: null });
  assert.deepEqual(sharedField(['head', null]), { mixed: true, value: null });
  assert.deepEqual(sharedField([]), { mixed: true, value: null }, 'nothing to share');
});

const trio = o => ({ parts: ['eyes', 'mouth', 'face'], bones: ['head', 'head', 'head'], pivots: [[1, 2], [1, 2], null], clips: [null, null, null], ...o });

test('setView: a set counts its parts and gives each field shared or mixed', () => {
  const v = setView(trio({}));
  assert.deepEqual([v.count, v.label, v.bone, v.pivot.mixed, v.clip], [3, '3 parts', { mixed: false, value: 'head' }, true, { mixed: false, value: null }]);
});

test('propBlocks: a set has Transform, Deform and Clip with its shared fields; Skin and Variants are per part', () => {
  const s = o => propBlocks({ row: 'set', name: 'eyes', tool: 'move', clip: { to: null, shape: false }, slot: { shown: 'open' }, skin: skn({}), set: trio({}), deform: dfm({ seed: { parts: 3 } }), ...o });
  const v = s({}), by = Object.fromEntries(v.blocks.map(b => [b.id, b]));
  assert.deepEqual(v.blocks.filter(b => b.shown).map(b => b.id), ['transform', 'deform', 'clip']);
  assert.deepEqual([v.set.label, v.set.bone.value, v.set.pivot.mixed], ['3 parts', 'head', true]);
  assert.equal(propBlocks({ row: 'part', name: 'eyes', tool: 'move' }).set, null, 'one part: no set');
  // Clip: none clipped, all clipped to the same, or mixed (Clip to ▾ blank in the line); a set draws no shape of its own.
  assert.deepEqual([by.clip.summary, by.clip.pick, by.clip.primary, by.clip.destructive], ['Not clipped', false, null, null]);
  const same = Object.fromEntries(s({ set: trio({ clips: ['lid', 'lid', 'lid'] }) }).blocks.map(b => [b.id, b]));
  assert.deepEqual([same.clip.summary, same.clip.pick, same.clip.destructive.id], ['Clipped to', true, 'removeClip']);
  assert.match(same.clip.destructive.title, /^Draw the 3 parts whole again \(they are clipped to lid\)/);
  const mixed = Object.fromEntries(s({ set: trio({ clips: ['lid', null, null] }) }).blocks.map(b => [b.id, b]));
  assert.deepEqual([mixed.clip.summary, mixed.clip.pick, mixed.clip.destructive.id], ['Clip to', true, 'removeClip']);
  assert.match(mixed.clip.destructive.title, /clipped to different things/);
  assert.equal(Object.fromEntries(s({ tool: 'mask', set: trio({ clips: ['lid', null, null] }) }).blocks.map(b => [b.id, b])).clip.auto, false, 'mixed: Clip to ▾ is in the line already');
  assert.equal(Object.fromEntries(s({ tool: 'mask' }).blocks.map(b => [b.id, b])).clip.auto, true, 'none clipped: the Mask tool opens Clip to choose one');
  // Deform: the group they all share, or Add group warp from them; a part's own warp is that part's.
  assert.deepEqual([by.deform.summary, by.deform.primary.label, by.deform.destructive], ['No group warp', 'Add group warp from 3 selected parts', null]);
  const own = Object.fromEntries(s({ deform: dfm({ kind: 'lattice', grid: [2, 2], candidates: 1, own: true, seed: { parts: 3 } }) }).blocks.map(b => [b.id, b])).deform;
  assert.deepEqual([own.summary, own.pick, own.destructive], ['No group warp', false, null], "the first part's own lattice is not the set's");
  const grp = Object.fromEntries(s({ deform: dfm({ kind: 'group', grid: [3, 3], group: { id: 'face', parts: 3, shapes: 0 }, candidates: 1, seed: { parts: 3 } }) }).blocks.map(b => [b.id, b])).deform;
  assert.deepEqual([grp.pick, grp.destructive.label], [true, 'Remove group warp']);
});

test('the focus header names a set by its count, and its tooltip the rows', () => {
  assert.equal(fh({ part: 'eyes' }).setWord, null);
  assert.equal(fh({ part: 'eyes', set: { names: ['eyes'], parts: true } }).setWord, null, 'one row is no set');
  const w = fh({ part: 'eyes', param: 'blink', set: { names: ['eyes', 'mouth', 'face'], parts: true } }).setWord;
  assert.equal(w.text, '3 parts');
  assert.match(w.title, /^eyes, mouth, face: Ctrl-click a row.*Keyforms shows eyes; Properties sets a pivot, bone or clip on all of them$/);
  assert.equal(fh({ part: 'mouth', set: { names: ['mouth', 'lid'], parts: false } }).setWord.text, '2 chosen', 'a shape among them');
});

test('choiceCue tells a part on a bone from its bone (studio-choice-cue.md)', () => {
  assert.deepEqual(choiceCue({ chosen: 'upper_l', target: 'arm_l', bone: false, carries: 0 }), { outline: 'part', tag: 'upper_l · part — the gizmo poses its bone arm_l' });
  assert.deepEqual(choiceCue({ chosen: 'arm_l', target: 'arm_l', bone: true, carries: 3 }), { outline: 'bone', tag: 'arm_l · bone · 3 parts' });
  assert.equal(choiceCue({ chosen: 'arm_l', target: 'arm_l', bone: true, carries: 1 }).tag, 'arm_l · bone · 1 part');
  assert.deepEqual(choiceCue({ chosen: 'face', target: 'face', bone: false, carries: 0 }), { outline: 'part', tag: null }, 'a part on no bone: nothing to tell apart');
  assert.deepEqual(choiceCue({ chosen: 'face', target: null, bone: false, carries: 0 }), { outline: 'part', tag: null });
  assert.deepEqual(choiceCue({ chosen: null, target: null, bone: false, carries: 0 }), { outline: null, tag: null });
});

test('a status note goes once the context moves on, unless the action that moved it wrote a new note (SR-15, SD-15, SA-12)', () => {
  const seen = { ctx: 'animate|move|arm_r||wave|3', text: 'Keyed arm_r at the playhead (0 s).' };
  assert.equal(keepNote(seen, { ...seen }), true, 'nothing moved on: the note stays');
  assert.equal(keepNote(seen, { ...seen, ctx: 'animate|move|||wave|3' }), false, 'the whole character chosen: the key note is stale');
  assert.equal(keepNote(seen, { ...seen, ctx: 'animate|move|arm_r||wave|4' }), false, 'an edit with no note of its own (a key dragged, Length changed)');
  assert.equal(keepNote(seen, { ctx: 'model|move|bone||null|4', text: 'Added the bone bone: type its name, then Enter.' }), true, 'the action wrote its own note');
  assert.equal(keepNote({ ctx: 'a', text: '' }, { ctx: 'b', text: '' }), false, 'an empty note has nothing to keep (the hint shows)');
});
