// Characterization of parseCommand: every command form of docs/commands.md (and its usage errors) is compiled alone and the
// resulting ops and diagnostics are compared with fixtures/parse-command.json. It pins what the parser does today, right or
// not, so the handler-table refactor (REFACTOR-PLAN step 5.3) shows every change. After a deliberate change to the syntax:
//   UPDATE_SNAPSHOT=1 node --test engine/test/parse-command.test.mjs     and review the fixture diff.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compile } from '../../dist/engine/src/index.js';

const FIXTURE = new URL('./fixtures/parse-command.json', import.meta.url);

const CASES = [
  // scene
  'scene park', 'scene park fade 2', 'scene park dissolve 1.5', 'scene park slide left', 'scene park slide left 2', 'scene park mask=ui/m.png dissolve 1',
  'scene', 'scene park wobble', 'scene park fade x',
  // show / hide / move
  'show ann', 'show ann happy', 'show ann happy at left', 'show ann at right', 'show ann happy at 0.3', 'show ann happy at center y=0.1 scale=1.2',
  'show ann flip=on', 'show ann anchor=0.5,1', 'show ann behind bob', 'show ann front', 'show ann back', 'show ann happy eyes=closed', 'show ann pose=calm,blush',
  'show ann at nowhere', 'show ann scale=x', 'show', 'show ann happy at left nowait',
  'hide ann', 'hide ann fade 1', 'hide', 'hide ann nowait',
  'move ann to right', 'move ann to right 1.5', 'move ann y=0.2 scale=1.5 rot=10 alpha=0.5', 'move ann flip=off', 'move ann to left ease=out', 'move ann to left ease=wobble',
  'move ann', 'move ann to', 'move ann bogus', 'move ann to right nowait',
  // shake / animate / hop / flash
  'shake screen', 'shake screen 1', 'shake ann 0.5 strength=12', 'shake screen strength=x', 'shake', 'shake screen 1 2 3',
  'animate ann bob', 'animate ann bob 2 loop', 'animate ann bob loop strength=0.5 part=hair', 'animate ann stop', 'animate ann',
  'animate ann pose=calm', 'animate ann turn=10 over 2 ease=out', 'animate ann pose=calm,blush turn=5', 'animate ann turn=x', 'animate ann bob nowait',
  'hop ann', 'hop ann 0.5', 'hop', 'hop ann x',
  'flash', 'flash #ffffff', 'flash #ff0000 0.5', 'flash 0.5', 'flash red', 'flash #fff 1 2',
  // tint / camera / weather / filter
  'tint #ff8800', 'tint #ff8800 0.5', 'tint #ff8800 0.5 2', 'tint off', 'tint off 2', 'tint', 'tint red', 'tint #ff8800 2', 'tint off x',
  'camera zoom 1.5', 'camera zoom 2 at left', 'camera zoom 2 at left y=0.3 1', 'camera pan right', 'camera pan 0.3 y=0.4 2', 'camera reset', 'camera reset 1', 'camera', 'camera tilt', 'camera zoom',
  'weather rain', 'weather snow 0.5', 'weather petals 0.5 3', 'weather off', 'weather off 2', 'weather', 'weather fog', 'weather rain 2',
  'filter blur', 'filter sepia 0.5 2', 'filter off', 'filter off 1', 'filter', 'filter glitter', 'filter night x',
  'focus on', 'focus off', 'focus', 'focus maybe', 'focus on off', 'behaviors on', 'behaviors off', 'behaviors',
  // hud / image
  'hud on bar', 'hud on bar keep', 'hud off bar', 'hud on', 'hud on bar stay', 'hud toggle bar', 'hud on 1bad',
  'image show logo ui/logo.png', 'image show logo ui/logo.png at 10,20', 'image show logo ui/logo.png scale=2 rot=5 alpha=0.5 anchor=0.5,0.5 layer=2 fixed keep fade 1',
  'image move logo to 5,6', 'image move logo scale=2 1.5 ease=out', 'image move logo', 'image hide logo', 'image hide logo fade 1', 'image hide logo fade',
  'image', 'image show', 'image show logo', 'image dance logo', 'image show 1x f.png',
  // music / sound / movie
  'music play theme', 'music play theme loop', 'music play theme loop fade 2', 'music play theme fade 1', 'music stop', 'music stop fade 2', 'music pause', 'music resume fade 1',
  'music', 'music play', 'music rewind', 'music stop fade',
  'sound play click', 'sound play click duck', 'sound loop rain', 'sound loop rain fade 2', 'sound stop', 'sound stop rain', 'sound stop rain fade 1', 'sound', 'sound play', 'sound play a b', 'sound stop duck', 'sound play click fade 1',
  'movie play intro', 'movie play intro noskip', 'movie play intro loop', 'movie play intro noskip loop', 'movie play intro loop loop', 'movie', 'movie play', 'movie stop',
  // wait / call / jump / return / end
  'wait', 'wait 2', 'wait 0.5', 'wait x', 'wait 1 2',
  'call other', 'call other(1, "a")', 'call nowhere', 'call', 'call other(', 'jump other', 'jump nowhere', 'jump', 'jump other extra',
  'return', 'return 1', 'end', 'end now',
  // nvl / textbox / unlock / input
  'nvl on', 'nvl off', 'nvl clear', 'nvl', 'nvl maybe', 'nvl on off',
  'textbox hide', 'textbox', 'textbox show', 'textbox hide now',
  'unlock secret', 'unlock', 'unlock a-b', 'unlock a b',
  'input name "Your name?"', 'input name "Your name?" default="Ann"', 'input name "Your name?" max=8', 'input name "Your name?" default="Ann" max=8', 'input name', 'input 1x "p"', 'input name "p" max=x',
  // set / define / show screen / words that are not commands
  'set x = 1', 'set x += 1', 'set x -= 1', 'set x = random(1, 6)', 'set x', 'set x =', 'set 1x = 2',
  'show screen map', 'show screen map as pick', 'show screen room("hall", 2)', 'show screen room("hall") as pick', 'show screen',
  'wobble', 'Wobble up', 'scenery park',
];

const run = line => {
  const text = `define ann "Ann"\ndefine bob "Bob"\nlabel start:\n  ${line}\n  end\nlabel other:\n  end\nscreen map:\n  button go at 1,1 "Go"\nscreen bar:\n  text at 1,1 "x"\nscreen room(a, b):\n  button go at 1,1 "Go"\n`;
  const p = compile([{ file: 't.vn', text }]);
  const at = p.labels.start;
  return {
    ops: p.ops.slice(at, p.labels.other ?? p.ops.length).filter(o => o.op !== 'end' || line.split(' ')[0] === 'end').map(o => { const { src, ...rest } = o; return rest; }),
    diagnostics: p.diagnostics.filter(d => d.line === undefined || d.line === 4 || d.src?.line === 4).map(d => `${d.severity}: ${d.message}`),
  };
};

test('parseCommand: every command form compiles to what the fixture says', () => {
  const got = Object.fromEntries(CASES.map(c => [c, JSON.parse(JSON.stringify(run(c)))]));
  assert.equal(Object.keys(got).length, new Set(CASES).size, 'the cases are unique');
  if (process.env.UPDATE_SNAPSHOT) {
    fs.mkdirSync(new URL('./fixtures/', import.meta.url), { recursive: true });
    fs.writeFileSync(FIXTURE, JSON.stringify(got, null, 1) + '\n');
    return;
  }
  const want = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  for (const c of CASES) assert.deepEqual(got[c], want[c], `"${c}" changed`);
  assert.deepEqual(Object.keys(want).filter(k => !CASES.includes(k)), [], 'the fixture has cases the test no longer has');
});

test('parseCommand: the fixture exercises both successes and usage errors for most commands', () => {
  const want = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const failing = Object.values(want).filter(r => r.diagnostics.some(d => d.startsWith('error')));
  const passing = Object.values(want).filter(r => r.diagnostics.every(d => !d.startsWith('error')) && r.ops.length);
  assert.ok(failing.length > 80 && passing.length > 100, `${failing.length} failing, ${passing.length} passing`);
});
