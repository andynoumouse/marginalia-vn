import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rgbNumber, mulRgb, lerpRgb, flashMatrix } from '../../dist/engine/src/index.js';

test('rgbNumber reads short and long hex, and is white for anything else', () => {
  assert.equal(rgbNumber('#ff8000'), 0xff8000);
  assert.equal(rgbNumber('#f80'), 0xff8800);
  assert.equal(rgbNumber('#12345678'), 0x123456);
  assert.equal(rgbNumber(undefined), 0xffffff);
  assert.equal(rgbNumber('red'), 0xffffff);
});

test('mulRgb: white is the identity, black wins, channels multiply', () => {
  assert.equal(mulRgb(0x808080, 0xffffff), 0x808080);
  assert.equal(mulRgb(0xffffff, 0x000000), 0);
  assert.equal(mulRgb(0xff8000, 0x80ff80), 0x808000);
});

test('lerpRgb goes from a to b', () => {
  assert.equal(lerpRgb(0x000000, 0xff00ff, 0), 0x000000);
  assert.equal(lerpRgb(0x000000, 0xff00ff, 1), 0xff00ff);
  assert.equal(lerpRgb(0x000000, 0xfefefe, 0.5), 0x7f7f7f);
});

test('flashMatrix: none is the identity, full is flat color with alpha kept', () => {
  assert.deepEqual(flashMatrix(0xff0000, 0), [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0]);
  assert.deepEqual(flashMatrix(0xff0000, 1), [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0]);
});

test('mouthOpen: loud opens it, a quiet moment keeps it open for the hold, then it closes', async () => {
  const { mouthOpen, MOUTH_ON, MOUTH_HOLD } = await import('../../dist/engine/src/index.js');
  let m = mouthOpen(0, 10, 0);
  assert.equal(m.open, false);
  m = mouthOpen(MOUTH_ON * 2, 10, m.until);
  assert.equal(m.open, true);
  assert.equal(mouthOpen(0, 10 + MOUTH_HOLD / 2, m.until).open, true, 'a gap shorter than the hold');
  assert.equal(mouthOpen(0, 10 + MOUTH_HOLD * 2, m.until).open, false, 'a longer one closes it');
});

test('ease=bezier(...): accepted in scripts and transforms, evaluated as a cubic Bezier, bad ones refused', async () => {
  const { parseBezierSpec, isEaseSpec, easing, easeProblem, bezierEase, compile } = await import('../../dist/engine/src/index.js');
  assert.deepEqual(parseBezierSpec('bezier(0.2,0,0.4,1)'), [0.2, 0, 0.4, 1]);
  assert.deepEqual(parseBezierSpec('cubic-bezier(0.2, 1.5, 0.4, 1)'), [0.2, 1.5, 0.4, 1]);
  for (const bad of ['bezier(2,0,0.4,1)', 'bezier(0.2,0,0.4)', 'bezier()', 'bezier(a,b,c,d)', 'bezier(0.2,0,0.4,1', 'wobble']) assert.equal(isEaseSpec(bad), false, bad);
  assert.equal(isEaseSpec('out') && isEaseSpec('bezier(0,0,1,1)'), true);
  const e = easing('bezier(0.25,0.1,0.25,1)'), ref = bezierEase([0.25, 0.1, 0.25, 1]);
  for (const t of [0, 0.3, 0.7, 1]) assert.equal(e(t), ref(t));
  const straight = easing('bezier(0,0,1,1)')(0.5);
  assert.ok(straight > 0.49 && straight < 0.51, 'a straight line is linear');
  assert.match(easeProblem('bezier(2,0,0.4,1)'), /x1 and x2 from 0 to 1/);
  assert.match(easeProblem('wobble'), /Unknown ease "wobble"/);
  const text = ['transform t:', '    x=0.1 0.5s ease=bezier(0.2,0,0.4,1)', '    x=0 0.5s ease=bezier(9,0,0,0)', 'label start:', '  "hi"', ''].join('\n');
  const p = compile([{ file: 't.vn', text }]);
  const errors = p.diagnostics.filter(d => d.severity === 'error');
  assert.equal(errors.length, 1, JSON.stringify(errors));
  assert.match(errors[0].message, /Unknown ease/);
});

test('the shader filters are named, parse, and have no color matrix', async () => {
  const { FILTER_NAMES, SHADER_FILTERS, isFilterName, filterMatrix } = await import('../../dist/engine/src/index.js');
  for (const n of ['glow', 'chromatic', 'glitch']) {
    assert.ok(FILTER_NAMES.includes(n) && isFilterName(n) && SHADER_FILTERS.includes(n), n);
    assert.equal(filterMatrix(n, 1), null, `${n} is drawn by a shader, not a matrix`);
  }
  assert.equal(isFilterName('glitter'), false);
});
