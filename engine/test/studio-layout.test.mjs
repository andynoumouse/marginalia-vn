import { test } from 'node:test';
import assert from 'node:assert/strict';
import { studioDockSpec, readDock, studioPresent, defaultDock, NO_LAYOUT, readLayout, sectionIds, sectionOpen, STUDIO_SECTIONS, studioMode, withSection, withSize, LEFT_WIDTH, RIGHT_WIDTH, SPLIT, dragColumn, withCollapsed } from '../../dist/engine/src/index.js';

test('an entry point names the mode; Model also answers to its old name, anything else is Animate', () => {
  assert.equal(studioMode('model'), 'model');
  assert.equal(studioMode('animate'), 'animate');
  assert.equal(studioMode(undefined), 'animate');
  assert.equal(studioMode(null), 'animate');
  assert.equal(studioMode('Model'), 'animate');
});

test('each mode has the Parts tree first, and only its own other sections; Model puts the Parameters straight after the tree', () => {
  assert.deepEqual(sectionIds('animate'), ['tree', 'sel', 'poses', 'params', 'frames', 'place']);
  assert.deepEqual(sectionIds('model'), ['tree', 'poses', 'params', 'keyforms', 'sel', 'warp', 'mask', 'physics', 'reactions']);
  for (const mode of Object.keys(STUDIO_SECTIONS)) assert.equal(new Set(sectionIds(mode)).size, sectionIds(mode).length, `${mode} has no duplicate ids`);
});

test('defaults: the first jobs of a mode are open, the rest closed', () => {
  const open = mode => sectionIds(mode).filter(id => sectionOpen(NO_LAYOUT, mode, id));
  assert.deepEqual(open('animate'), ['tree', 'sel', 'params']);
  assert.deepEqual(open('model'), ['tree', 'params', 'keyforms', 'sel']); // the Parameters are where keyforms are authored
});

test('sizes the author dragged are kept, clamped, beside the open sections, and bad ones are dropped', () => {
  let layout = withSize(NO_LAYOUT, { left: 9999 });
  assert.deepEqual(layout.size, { left: LEFT_WIDTH.max });
  layout = withSize(layout, { split: 0.4 });
  assert.deepEqual(layout.size, { left: LEFT_WIDTH.max, split: 0.4 }, 'one size does not drop the other');
  assert.deepEqual(withSize(layout, { left: 1, split: 5 }).size, { left: LEFT_WIDTH.min, split: SPLIT.max });
  layout = withSection(layout, 'model', 'warp', true);
  assert.deepEqual(layout.size, { left: LEFT_WIDTH.max, split: 0.4 }, 'opening a section keeps the sizes');
  assert.deepEqual(readLayout(JSON.stringify(layout)), layout);
  assert.deepEqual(readLayout(JSON.stringify({ size: { left: 'wide', split: null } })), NO_LAYOUT);
  assert.deepEqual(readLayout(JSON.stringify({ size: { left: 100, split: 0.5 } })), { open: {}, size: { left: LEFT_WIDTH.min, split: 0.5 } });
  assert.deepEqual(NO_LAYOUT, { open: {} });
});

test('a phone-width window starts with the Parts block closed, and an empty section starts closed', () => {
  assert.equal(sectionOpen(NO_LAYOUT, 'animate', 'tree', { narrow: true }), false);
  assert.equal(sectionOpen(NO_LAYOUT, 'animate', 'sel', { narrow: true }), true);
  assert.equal(sectionOpen(NO_LAYOUT, 'animate', 'params', { empty: ['params'] }), false);
  assert.equal(sectionOpen(NO_LAYOUT, 'animate', 'sel', { empty: ['params'] }), true);
});

test('what the author chose beats the defaults, per mode', () => {
  let layout = withSection(NO_LAYOUT, 'animate', 'frames', true);
  layout = withSection(layout, 'animate', 'params', false);
  assert.equal(sectionOpen(layout, 'animate', 'frames'), true);
  assert.equal(sectionOpen(layout, 'animate', 'params'), false);
  assert.equal(sectionOpen(layout, 'model', 'params'), true, 'the other mode keeps its own default');
  assert.equal(sectionOpen(layout, 'animate', 'tree', { narrow: true }), false);
  layout = withSection(layout, 'animate', 'tree', true);
  assert.equal(sectionOpen(layout, 'animate', 'tree', { narrow: true }), true, 'a chosen state also beats the narrow default');
  assert.equal(sectionOpen(layout, 'animate', 'nope'), false, 'an unknown section is closed');
});

test('withSection leaves the layout it was given alone', () => {
  const base = withSection(NO_LAYOUT, 'model', 'physics', true);
  const next = withSection(base, 'model', 'reactions', true);
  assert.deepEqual(base.open.model, { physics: true });
  assert.deepEqual(next.open.model, { physics: true, reactions: true });
  assert.deepEqual(NO_LAYOUT, { open: {} });
});

test('readLayout takes what the browser kept, and defaults for anything else', () => {
  const saved = JSON.stringify(withSection(withSection(NO_LAYOUT, 'animate', 'frames', true), 'model', 'params', true));
  const layout = readLayout(saved);
  assert.equal(sectionOpen(layout, 'animate', 'frames'), true);
  assert.equal(sectionOpen(layout, 'model', 'params'), true);
  for (const bad of [null, undefined, '', 'not json', '42', 'null', '[]', '{"open":5}', '{"open":null}', '{"open":{"animate":"yes"}}']) {
    assert.deepEqual(readLayout(bad), NO_LAYOUT, String(bad));
  }
});

test('readLayout drops unknown modes and sections and values that are not true or false', () => {
  const layout = readLayout(JSON.stringify({ open: { animate: { frames: true, params: 'yes', nope: true }, bogus: { sel: false }, model: { auto: 1 } } }));
  assert.deepEqual(layout, { open: { animate: { frames: true }, model: {} } });
});

test('the studio dock holds every section of both modes once, Parameters over Parts on the left and the rest on the right', () => {
  const spec = studioDockSpec();
  const ids = spec.panels.map(p => p.id);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate panels');
  for (const mode of Object.keys(STUDIO_SECTIONS)) for (const id of sectionIds(mode)) assert.ok(ids.includes(id), `${mode} section ${id} is a panel`);
  assert.deepEqual(defaultDock(spec), {
    left: ['poses', 'params', 'tree'],
    left2: [],
    right: ['keyforms', 'sel', 'warp', 'mask', 'frames', 'physics', 'reactions', 'place'],
  });
  assert.ok(spec.panels.every(p => !p.zones), 'any section may go in any column');
});

test('a column dragged under 60% of its minimum folds away; otherwise the width is clamped', () => {
  assert.deepEqual(dragColumn('left', 300), { width: 300 });
  assert.deepEqual(dragColumn('left', LEFT_WIDTH.min - 10), { width: LEFT_WIDTH.min });
  assert.deepEqual(dragColumn('left', 100), { collapsed: true });
  assert.deepEqual(dragColumn('right', RIGHT_WIDTH.max + 500), { width: RIGHT_WIDTH.max });
  assert.deepEqual(dragColumn('right', 0), { collapsed: true });
});

test('folded columns and the right width are kept, read back and healed', () => {
  let layout = withCollapsed(withSize(NO_LAYOUT, { right: 9999 }), 'left', true);
  assert.deepEqual(layout, { open: {}, size: { right: RIGHT_WIDTH.max }, collapsed: { left: true } });
  assert.deepEqual(readLayout(JSON.stringify(layout)), layout);
  assert.deepEqual(readLayout(JSON.stringify({ collapsed: { left: 'yes', top: true } })), NO_LAYOUT);
  layout = withCollapsed(layout, 'left', false);
  assert.deepEqual(layout, { open: {}, size: { right: RIGHT_WIDTH.max } });
  assert.deepEqual(withCollapsed(NO_LAYOUT, 'right', false), NO_LAYOUT);
});

test('studioPresent is the mode\'s sections less what the host leaves out', () => {
  assert.deepEqual(studioPresent('animate'), ['tree', 'sel', 'poses', 'params', 'frames', 'place']);
  assert.deepEqual(studioPresent('animate', ['frames', 'place']), ['tree', 'sel', 'poses', 'params']);
  assert.deepEqual(studioPresent('model', ['ghost']), sectionIds('model'));
});

test('a dock layout saved before Poses existed still shows it, at the end of its default column', () => {
  const spec = studioDockSpec();
  const old = readDock(spec, JSON.stringify({ left: ['tree', 'params'], right: ['keyforms', 'sel', 'warp', 'mask', 'frames', 'physics', 'reactions', 'place'] }));
  assert.deepEqual(old.left, ['tree', 'params', 'poses']);
});
