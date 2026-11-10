import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canDock, nudgePanel, dockMoveNote, defaultDock, dropTarget, fixDock, isDefaultDock, movePanel, panelsIn, readDock, resetDock, writeDock, zoneOf } from '../../dist/engine/src/index.js';

const spec = {
  zones: ['left', 'center', 'right'],
  panels: [
    { id: 'tree', zone: 'left' },
    { id: 'params', zone: 'left' },
    { id: 'stage', zone: 'center', zones: ['center'] },
    { id: 'sel', zone: 'right' },
    { id: 'warp', zone: 'right', zones: ['left', 'right'] },
  ],
};

test('the default layout puts each panel in its own zone in spec order', () => {
  assert.deepEqual(defaultDock(spec), { left: ['tree', 'params'], center: ['stage'], right: ['sel', 'warp'] });
  assert.ok(isDefaultDock(spec, defaultDock(spec)));
});

test('a panel moves within its zone, to another zone, and the index is where it ends up', () => {
  const d = defaultDock(spec);
  assert.deepEqual(movePanel(spec, d, 'params', 'left', 0).left, ['params', 'tree']);
  const m = movePanel(spec, d, 'sel', 'left', 1);
  assert.deepEqual(m, { left: ['tree', 'sel', 'params'], center: ['stage'], right: ['warp'] });
  assert.deepEqual(d.right, ['sel', 'warp'], 'the old layout is not changed');
  assert.deepEqual(movePanel(spec, d, 'sel', 'right', 99).right, ['warp', 'sel'], 'clamped to the end');
  assert.deepEqual(movePanel(spec, d, 'warp', 'right', -5).right, ['warp', 'sel'], 'clamped to the start');
});

test('a move that is not allowed or changes nothing gives the same layout object', () => {
  const d = defaultDock(spec);
  assert.equal(movePanel(spec, d, 'stage', 'left', 0), d, 'the stage may only be in the center');
  assert.equal(movePanel(spec, d, 'sel', 'nowhere', 0), d);
  assert.equal(movePanel(spec, d, 'ghost', 'left', 0), d);
  assert.equal(movePanel(spec, d, 'tree', 'left', 0), d, 'already first');
  assert.equal(movePanel(spec, d, 'warp', 'center', 0), d);
  assert.ok(canDock(spec, 'warp', 'left') && !canDock(spec, 'warp', 'center'));
});

test('fixDock drops unknown and repeated panels and misplaced ones, and adds new panels to their own zone', () => {
  const fixed = fixDock(spec, { left: ['params', 'ghost', 'stage', 'params'], right: ['warp'], bogus: ['tree'] });
  assert.deepEqual(fixed, { left: ['params', 'tree'], center: ['stage'], right: ['warp', 'sel'] });
  assert.deepEqual(fixDock(spec, null), defaultDock(spec));
  assert.deepEqual(fixDock(spec, { left: 'tree' }), defaultDock(spec));
});

test('every panel is in exactly one zone after any number of moves', () => {
  let d = defaultDock(spec);
  const zones = spec.zones;
  let seed = 7;
  const rnd = n => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
  for (let i = 0; i < 200; i++) d = movePanel(spec, d, spec.panels[rnd(5)].id, zones[rnd(3)], rnd(4));
  const all = zones.flatMap(z => d[z]).sort();
  assert.deepEqual(all, spec.panels.map(p => p.id).sort());
  assert.equal(zoneOf(d, 'stage'), 'center');
});

test('a stored layout survives a round trip, and junk reads as the default', () => {
  const moved = movePanel(spec, defaultDock(spec), 'sel', 'left', 0);
  assert.deepEqual(readDock(spec, writeDock(moved)), moved);
  for (const bad of [null, undefined, '', '{', '[]', '7', '"x"']) assert.deepEqual(readDock(spec, bad), defaultDock(spec), String(bad));
  assert.ok(!isDefaultDock(spec, moved));
  assert.ok(isDefaultDock(spec, resetDock(spec)));
});

test('panelsIn leaves out the panels a mode does not have', () => {
  const d = defaultDock(spec);
  assert.deepEqual(panelsIn(d, 'right', ['sel']), ['sel']);
  assert.deepEqual(panelsIn(d, 'right', new Set(['warp'])), ['warp']);
  assert.deepEqual(panelsIn(d, 'left'), ['tree', 'params']);
  assert.deepEqual(panelsIn(d, 'nowhere'), []);
});

test('dropTarget finds the zone under the pointer and the row to drop before', () => {
  const d = defaultDock(spec);
  const zones = { left: { x: 0, y: 0, w: 100, h: 400 }, center: { x: 100, y: 0, w: 200, h: 400 }, right: { x: 300, y: 0, w: 100, h: 400 } };
  const rows = { tree: { x: 0, y: 0, w: 100, h: 100 }, params: { x: 0, y: 100, w: 100, h: 100 }, stage: { x: 100, y: 0, w: 200, h: 400 }, sel: { x: 300, y: 0, w: 100, h: 100 }, warp: { x: 300, y: 100, w: 100, h: 100 } };
  assert.deepEqual(dropTarget(spec, d, 'sel', 50, 20, zones, rows), { zone: 'left', index: 0 }, 'upper half of the first row');
  assert.deepEqual(dropTarget(spec, d, 'sel', 50, 80, zones, rows), { zone: 'left', index: 1 }, 'lower half of the first row');
  assert.deepEqual(dropTarget(spec, d, 'sel', 50, 390, zones, rows), { zone: 'left', index: 2 }, 'below all rows');
  assert.deepEqual(dropTarget(spec, d, 'sel', 350, 120, zones, rows), { zone: 'right', index: 0 }, 'the dragged row is not counted');
  assert.deepEqual(dropTarget(spec, d, 'sel', 350, 150, zones, rows), { zone: 'right', index: 1 }, 'the middle of a row counts as after it');
  assert.deepEqual(dropTarget(spec, d, 'sel', 150, 50, zones, rows), { zone: 'center', index: 0 }, 'sel has no zone limit');
  assert.equal(dropTarget(spec, d, 'warp', 150, 50, zones, rows), null, 'warp may not enter the center');
  assert.equal(dropTarget(spec, d, 'sel', 500, 50, zones, rows), null, 'outside every zone');
});

test('nudgePanel moves a panel one step with the keyboard, over panels that are not shown, or to the next zone it may enter', () => {
  const d = defaultDock(spec);
  assert.deepEqual(nudgePanel(spec, d, 'tree', 0, 1).left, ['params', 'tree']);
  assert.equal(nudgePanel(spec, d, 'tree', 0, -1), d, 'already first');
  assert.equal(nudgePanel(spec, d, 'params', 0, 1), d, 'already last');
  const three = { zones: ['a'], panels: [{ id: 'x', zone: 'a' }, { id: 'y', zone: 'a' }, { id: 'z', zone: 'a' }] };
  assert.deepEqual(nudgePanel(three, defaultDock(three), 'x', 0, 1, ['x', 'z']).a, ['y', 'z', 'x'], 'steps over the hidden y');
  assert.deepEqual(nudgePanel(three, defaultDock(three), 'z', 0, -1, ['x', 'z']).a, ['z', 'x', 'y'], 'and back over it');
  assert.deepEqual(nudgePanel(spec, d, 'sel', -1, 0).center, ['sel', 'stage'], 'keeps index 0 in the center');
  assert.deepEqual(nudgePanel(spec, d, 'warp', -1, 0).left, ['tree', 'warp', 'params'], 'the center is skipped: warp may not enter it');
  assert.equal(nudgePanel(spec, d, 'stage', -1, 0), d, 'the stage has nowhere to go');
  assert.equal(nudgePanel(spec, d, 'tree', -1, 0), d, 'nothing left of the first zone');
});

test('dockMoveNote says which section moved and where, for the status line (SA-11)', () => {
  const title = id => ({ tree: 'Parts', params: 'Parameters', sel: 'Properties' })[id] ?? id, zone = z => `the ${z} column`;
  const before = { left: ['params', 'tree'], right: ['sel'] };
  assert.equal(dockMoveNote(before, { left: ['params'], right: ['sel', 'tree'] }, title, zone), 'Moved Parts to the right column.');
  const swapped = { left: ['tree', 'params'], right: ['sel'] };
  assert.equal(dockMoveNote(before, swapped, title, zone, 'params'), 'Moved Parameters to place 2 of 2 in the left column.', 'Alt+Down on Parameters');
  assert.equal(dockMoveNote(before, swapped, title, zone, 'tree'), 'Moved Parts to place 1 of 2 in the left column.', 'Alt+Up on Parts: the same layout');
  assert.equal(dockMoveNote(before, before, title, zone), null, 'nothing moved');
});
