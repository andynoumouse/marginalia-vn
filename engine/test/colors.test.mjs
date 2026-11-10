import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findColors, parseHex, formatHex } from '../../dist/engine/src/index.js';

test('parseHex reads 3, 4, 6 and 8 digit colors and rejects others', () => {
  assert.deepEqual(parseHex('#fff'), { r: 1, g: 1, b: 1, a: 1 });
  assert.deepEqual(parseHex('#0f08'), { r: 0, g: 1, b: 0, a: 8 * 17 / 255 });
  assert.deepEqual(parseHex('#ff0000'), { r: 1, g: 0, b: 0, a: 1 });
  assert.equal(parseHex('#ff000'), undefined);
  assert.equal(parseHex('red'), undefined);
});

test('formatHex writes #rrggbb, with alpha only when not opaque', () => {
  assert.equal(formatHex({ r: 1, g: 0.5, b: 0, a: 1 }), '#ff8000');
  assert.equal(formatHex({ r: 0, g: 0, b: 0, a: 0.5 }), '#00000080');
  assert.equal(formatHex(parseHex('#5fd1c3')), '#5fd1c3');
});

test('script colors: after =, tint and flash; never string ids or comments', () => {
  const text = [
    'define alice "Alice" color=#ff6fa5 text=#ffe6f0 #ab12',
    'alice: {color=#fff}Pink{/color} #cd34',
    '    tint #203060 0.5 2s',
    'flash #ffffff 0.4s',
    'button b at 1,1 "Go" hover tint #ffcc6666',
    '# tint #123456',
    '"Hello" #abcdef',
    'tint off',
  ].join('\n');
  const found = findColors(text, 'vn').map(c => [c.line, c.col, c.length]);
  assert.deepEqual(found, [[1, 27, 7], [1, 40, 7], [2, 14, 4], [3, 9, 7], [4, 6, 7], [5, 32, 9]]);
});

test('game.json colors: quoted hex values only', () => {
  const text = '{\n  "theme": { "accent": "#5fd1c3", "font": "Georgia", "tipColor": "#fff" },\n  "title": "#1 fan"\n}';
  const found = findColors(text, 'json').map(c => [c.line, c.col, c.length]);
  assert.deepEqual(found, [[2, 24, 7], [2, 66, 4]]);
});
