// sceneAt: the stage just before a script line, for the animation studio's backdrop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, sceneAt } from '../../dist/engine/src/index.js';

const p = compile([{ file: 't.vn', text: [
  'define al "Al"', 'define bo "Bo"',
  'label start:',          // 3
  '  scene park',
  '  show al at left',     // 5
  '  "a"',
  '  menu:',               // 7
  '    "x":',
  '      show bo at right',
  '    "y":',              // 10
  '      "no"',
  '  show al smile',
  '  "b"',                 // 13
].join('\n') }]);
const at = async line => {
  const s = await sceneAt(p, { file: 't.vn', line });
  return [s.bg, s.sprites.map(x => `${x.char}@${x.x}${x.pose ? ':' + x.pose : ''}`)];
};

test('the stage before the line: nothing yet, then the scene and who stands where', async () => {
  assert.deepEqual(await at(4), [null, []]);
  assert.deepEqual(await at(6), ['park', ['al@0.2']]);
  assert.deepEqual(await at(5), ['park', []]); // the line itself has not run
});

test('menus on the way take their first option, as Preview from cursor does', async () => {
  assert.deepEqual(await at(12), ['park', ['al@0.2', 'bo@0.8']]);
  assert.deepEqual(await at(13), ['park', ['al@0.2:smile', 'bo@0.8']]);
});

test('nothing past the line runs, and a line past the end gives the final stage', async () => {
  const q = compile([{ file: 't.vn', text: 'label start:\n  scene park\n  "a"\n  scene night\n  "b"\n' }]);
  assert.equal((await sceneAt(q, { file: 't.vn', line: 3 })).bg, 'park');
  assert.equal((await sceneAt(q, { file: 't.vn', line: 99 })).bg, 'night');
});
