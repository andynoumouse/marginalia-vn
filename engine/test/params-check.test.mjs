import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkParams } from '../../dist/engine/src/index.js';

const defs = [{ id: 'a', min: -1, max: 1, default: 0 }, { id: 'b', min: 0, max: 10, default: 5 }];
const targets = new Set(['head', 'arm']);
const run = data => { const out = []; checkParams({ parameters: defs, ...data }, targets, (m, at) => out.push([m, at])); return out.map(([m]) => m); };
const has = (data, re) => { const out = run(data); assert.ok(out.some(m => re.test(m)), `${re} in\n${out.join('\n')}`); };
const twoD = over => ({ target: 'head', params: ['a', 'b'], grid: { x: [-1, 1], y: [0, 10] }, forms: [{ at: [0, 0] }, {}, {}, {}], ...over });

test('a clean parameters, pads and keyforms section has no problems', () => {
  assert.deepEqual(run({
    categories: ['Face'], parameters: [{ ...defs[0], group: 'Face' }, defs[1]], pads: [{ id: 'look', x: 'a', y: 'b', group: 'Face' }],
    keyforms: [{ target: 'head', param: 'a', keys: [{ at: -1, rot: 5 }, { at: 1, rot: -5, ease: 'out' }] }, twoD()],
  }), []);
});

test('an ease in rig.json may be a bezier(...) as well as a name', () => {
  assert.deepEqual(run({
    parameters: [{ ...defs[0], ease: 'bezier(0.25,0.1,0.25,1)' }, defs[1]],
    keyforms: [{ target: 'head', param: 'a', keys: [{ at: -1, rot: 5 }, { at: 1, rot: -5, ease: 'cubic-bezier(0.5,0,0.5,1)' }] }],
  }), []);
});

test('sections of the wrong type', () => {
  has({ categories: 'x' }, /categories: needs a list of names/);
  has({ parameters: 3 }, /parameters: needs a list of \{ id, min, max, default \}/);
  has({ pads: {} }, /pads: needs a list of \{ id, x, y \}/);
  has({ keyforms: {} }, /keyforms: needs a list of targets/);
  has({ parameters: [null] }, /parameters\[0\]: needs an object with id, min, max and default/);
  has({ keyforms: [null] }, /keyforms\[0\]: not a keyform/);
});

test('parameter definitions: numbers, order of min and max, default range, group', () => {
  has({ parameters: [{ id: 'p', min: 'x', max: 1, default: 0 }] }, /parameters\.p: min and max must be numbers/);
  has({ parameters: [{ id: 'p', min: 1, max: 1, default: 1 }] }, /parameters\.p: min must be less than max/);
  has({ parameters: [{ id: 'p', min: 0, max: 1, default: 2 }] }, /parameters\.p: default must be a number from 0 to 1/);
  has({ parameters: [{ id: 'p', min: 0, max: 1, default: 0, ease: 'wobble' }] }, /parameters\.p: unknown ease "wobble"/);
  has({ parameters: [{ id: 'p', min: 0, max: 1, default: 0, group: 3 }] }, /parameters\.p: group must be a string/);
  has({ parameters: [{ id: 'p', min: 0, max: 1, default: 0, group: 'Nope' }] }, /group "Nope" is not in categories/);
  has({ parameters: [{ min: 0, max: 1, default: 0 }] }, /parameters\[0\]: needs an id/);
});

test('pads: id, both axes, distinct axes', () => {
  has({ pads: [{ x: 'a', y: 'b' }] }, /pads\[0\]: needs an id, x and y/);
  has({ pads: [{ id: 'p', x: 'a', y: 'ghost' }] }, /pads\.p\.y: no parameter "ghost"/);
  has({ pads: [{ id: 'p', x: 'a', y: 'a' }] }, /pads\.p: x and y are the same parameter/);
  has({ pads: [{ id: 'p', x: 'a', y: 'b' }, { id: 'p', x: 'b', y: 'a' }] }, /pads: "p" is defined twice/);
});

test('one-dimensional keyforms: keys, their positions, the parameter and its range', () => {
  const kf = over => ({ keyforms: [{ target: 'head', param: 'a', keys: [{ at: 0 }, { at: 1 }], ...over }] });
  has(kf({ target: 'ghost' }), /keyforms\[0\]: no part or bone named "ghost"/);
  has(kf({ keys: [] }), /keys: needs at least one key/);
  has(kf({ keys: [{ at: 0 }, {}] }), /every key needs a numeric "at"/);
  has(kf({ keys: [{ at: 0 }, { at: 0 }] }), /two keys at the same value/);
  has(kf({ param: 'ghost' }), /keyforms\[0\]\.param: no parameter "ghost"/);
  has(kf({ keys: [{ at: 0 }, { at: 3 }] }), /values 0 to 3 lie outside "a" \(-1 to 1\)/);
  has(kf({ keys: [{ at: 0, rot: 'x' }] }), /keys\[0\]\.rot: must be a number/);
  has(kf({ keys: [{ at: 0, opacity: -1 }] }), /opacity: must not be negative/);
  has(kf({ keys: [{ at: 0, wobble: 1 }] }), /keys\[0\]: unknown field "wobble"/);
  has(kf({ keys: [{ at: 0, ease: 'wobble' }] }), /keys\[0\]\.ease: unknown ease "wobble"/);
  has(kf({ keys: [{ at: 0, ease: 'bezier(2,0,1,1)' }] }), /keys\[0\]\.ease: unknown ease "bezier\(2,0,1,1\)": a bezier is/);
  has(kf({ keys: [5] }), /keys\[0\]: not a form/);
  has({ keyforms: [{ target: 'head' }] }, /use either param \+ keys, or params \+ grid \+ forms/);
});

test('two-dimensional keyforms: two different parameters, an ascending grid, one form per cell', () => {
  const kf = over => ({ keyforms: [twoD(over)] });
  has(kf({ params: ['a'] }), /params: needs two parameter ids/);
  has(kf({ params: ['a', 'a'] }), /the two parameters must differ/);
  has(kf({ grid: { x: [1, -1], y: [0, 10] } }), /grid: needs x and y lists of numbers in ascending order/);
  has(kf({ grid: { x: [], y: [0, 10] } }), /grid: needs x and y lists/);
  has(kf({ grid: undefined }), /grid: needs x and y lists/);
  has(kf({ grid: { x: [-1, 5], y: [0, 10] } }), /params\[0\]: values -1 to 5 lie outside "a"/);
  has(kf({ params: ['a', 'ghost'] }), /params\[1\]: no parameter "ghost"/);
  has(kf({ forms: [{}] }), /forms: needs 4 forms \(2 x 2, one row of x after another\), has 1/);
  has(kf({ forms: undefined }), /forms: needs 4 forms .*has 0/);
  has(kf({ forms: [{}, {}, { rot: 'x' }, {}] }), /forms\[2\]\.rot: must be a number/);
});
