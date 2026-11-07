import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateScreen } from '../../dist/engine/src/index.js';

const src = { file: 's.vn', line: 1 };
const node = (kind, rest) => ({ kind, src, cond: null, ...rest });
const fx = { tint: null, scale: null, sound: null };
const button = (id, over = {}) => node('button', { id, x: 10, y: 10, w: null, h: null, label: id, labelId: null, enabled: null, hover: null, plain: false, fx, focus: {}, on: {}, act: null, ...over });
const hotspot = (id, shape, over = {}) => node('hotspot', { id, shape, label: id, labelId: null, enabled: null, cursor: null, hover: null, plain: false, fx, tip: true, focus: {}, on: {}, act: null, ...over });
const rect = (x, y, w, h) => ({ k: 'rect', x, y, w, h });
const scroll = (body, over = {}) => node('scroll', { x: 0, y: 0, w: 100, h: 100, start: 'top', bar: true, body, ...over });
const each = body => node('each', { list: 'bag', as: 'it', x: 0, y: 0, dx: 0, dy: 0, limit: null, body });
const panel = (over = {}) => node('panel', { x: 0, y: 0, w: 50, h: 50, file: null, slice: [1, 1, 1, 1], edge: 'stretch', padding: [0, 0, 0, 0], body: [], ...over });
const layout = (body, over = {}) => node('layout', { type: 'row', columns: 1, at: null, anchor: null, margin: [0, 0, 0, 0], padding: [0, 0, 0, 0], gap: 0, align: 'start', cell: null, body, ...over });
const def = (body, over = {}) => ({ name: 's', src, body, default: null, cancel: false, ...over });
const check = (body, over, stage) => validateScreen(def(body, over), stage).map(p => `${p.severity}: ${p.message}`);
const has = (list, re) => assert.ok(list.some(m => re.test(m)), `${re} in\n${list.join('\n')}`);
const ok = button('ok');

test('a plain screen with one button has no problems', () => {
  assert.deepEqual(check([ok]), []);
});

test('scroll areas: not nested, not inside layouts or each, with a size', () => {
  has(check([ok, scroll([scroll([])])]), /cannot be inside another scroll area/);
  has(check([ok, each([scroll([])])]), /goes directly in the screen/);
  has(check([ok, layout([scroll([])])]), /goes directly in the screen/);
  has(check([ok, scroll([], { w: 0 })]), /scroll area needs a size above zero/);
  has(check([ok, scroll([hotspot('p', { k: 'poly', points: [[0, 0], [5, 0], [5, 5]] })])]), /poly or mask hotspot cannot be inside a scroll area/);
  has(check([ok, scroll([node('slider', { setting: 'music', x: 0, y: 0, w: 10, h: 5, readout: false })])]), /slider cannot be inside a scroll area/);
});

test('panels and bars need a size; an empty unsized panel warns; slices are not negative', () => {
  has(check([ok, panel({ w: 0 })]), /panel needs a size above zero/);
  has(check([ok, panel({ w: null, h: null })]), /warning: An empty panel without a size/);
  assert.deepEqual(check([ok, panel({ w: null, h: null, file: 'ui/frame.png' })]), []);
  has(check([ok, panel({ slice: [1, -1, 1, 1] })]), /slice cannot be negative/);
  const bar = over => node('bar', { x: 0, y: 0, w: 10, h: 5, value: null, min: null, max: null, back: null, fill: null, slice: null, edge: 'stretch', padding: [0, 0, 0, 0], color: null, readout: false, ...over });
  has(check([ok, bar({ h: 0 })]), /bar needs a size above zero/);
  assert.deepEqual(check([ok, bar({})]), []);
  has(check([ok, layout([], { type: 'grid', columns: 2, cell: [0, 10] })]), /grid cell needs a size above zero/);
});

test('element ids: unique, not empty, and in an each tied to the entry name', () => {
  has(check([ok, button('ok')]), /Duplicate element id "ok"/);
  has(check([button('')]), /id cannot be empty/);
  has(check([each([button('other')])]), /Inside "each", the element id must be "it"/);
  assert.deepEqual(check([each([button('it'), button('it.rename')])]), []);
  has(check([each([button('it', { body: [button('inner')] })])]), /has child elements, which "each" cannot repeat/);
  assert.deepEqual(check([button('a', { body: [button('b')] })]), []);
});

test('hotspots: a poly needs three points and a rect a size; off-stage ones warn, stock screens do not', () => {
  has(check([hotspot('p', { k: 'poly', points: [[0, 0], [5, 5]] })]), /poly needs at least three points/);
  has(check([hotspot('h', rect(0, 0, 0, 5))]), /hotspot needs a size above zero/);
  has(check([hotspot('h', rect(5000, 0, 10, 10))]), /warning: Hotspot "h" is outside the/);
  has(check([button('b', { x: -5 })]), /warning: Button "b" is outside the/);
  assert.deepEqual(check([hotspot('h', rect(5000, 0, 10, 10))].map(n => n), { src: { file: 'stock/title.vn', line: 1 } }), []);
  assert.deepEqual(check([each([button('it', { x: 99999 })])]), [], 'positions in an each are relative to the entry');
});

test('focus hints must name elements of the screen, unless an each makes the ids dynamic', () => {
  has(check([button('a', { focus: { down: 'ghost' } })]), /"a" moves focus to "ghost", which is not an element of screen s/);
  assert.deepEqual(check([button('a', { focus: { down: 'b' } }), button('b')]), []);
  assert.deepEqual(check([button('a', { focus: { down: 'ghost' } }), each([button('it')])]), []);
});

test('a screen with nothing to choose warns unless it can be cancelled; a default must exist', () => {
  has(check([node('text', { x: 0, y: 0, text: 'hi', id: null })]), /warning: Screen s has nothing to choose/);
  assert.deepEqual(check([node('text', { x: 0, y: 0, text: 'hi', id: null })], { cancel: true }), []);
  has(check([ok], { default: 'ghost' }), /Default "ghost" is not an element of screen s/);
  assert.deepEqual(check([ok], { default: 'ok' }), []);
  assert.deepEqual(check([each([button('it')])], { default: 'anything' }), []);
});
