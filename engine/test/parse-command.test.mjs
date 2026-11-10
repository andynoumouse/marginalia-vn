// Characterization of parseCommand: every command form of docs/commands.md (and its usage errors) is compiled alone and the
// resulting ops and diagnostics are compared with fixtures/parse-command.json. It pins what the parser does today, right or
// not, so a refactor of the handler table shows every change. After a deliberate change to the syntax:
//   UPDATE_SNAPSHOT=1 node --test engine/test/parse-command.test.mjs     and review the fixture diff.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compile } from '../../dist/engine/src/index.js';

const FIXTURE = new URL('./fixtures/parse-command.json', import.meta.url);

const CASES = [
  // scene
  'scene park', 'scene park fade 2s', 'scene park dissolve 1.5s', 'scene park slide left', 'scene park slide left 2', 'scene park mask=ui/m.png dissolve 1s',
  'scene', 'scene park wobble', 'scene park fade x',
  // show / hide / move
  'show ann', 'show ann happy', 'show ann happy at left', 'show ann at right', 'show ann happy at 0.3', 'show ann happy at center y=0.1 scale=1.2',
  'show ann flip=on', 'show ann anchor=0.5,1', 'show ann behind bob', 'show ann front', 'show ann back', 'show ann happy eyes=closed', 'show ann pose=calm,blush',
  'show ann at nowhere', 'show ann scale=x', 'show', 'show ann happy at left nowait',
  'hide ann', 'hide ann fade 1s', 'hide', 'hide ann nowait',
  'move ann to right', 'move ann to right 1.5s', 'move ann y=0.2 scale=1.5 rot=10 alpha=0.5', 'move ann flip=off', 'move ann to left ease=out', 'move ann to left ease=wobble', 'move ann to left ease=bezier(0.2,0,0.4,1)', 'move ann to left ease=cubic-bezier(0.2,1.5,0.4,1)', 'move ann to left ease=bezier(2,0,0.4,1)', 'move ann to left ease=bezier(0.2,0,0.4)', 'camera zoom 2 ease=bezier(0.2,0,0.4,1)', 'image move logo scale=2 ease=bezier(0.2,0,0.4,1)',
  'move ann', 'move ann to', 'move ann bogus', 'move ann to right nowait',
  // shake / animate / hop / flash
  'shake screen', 'shake screen 1s', 'shake ann 0.5s strength=12', 'shake screen strength=x', 'shake', 'shake screen 1 2 3',
  'animate ann bob', 'animate ann bob 2s loop', 'animate ann bob loop strength=0.5 part=hair', 'animate ann stop', 'animate ann',
  'animate ann pose=calm', 'animate ann turn=10 over 2s ease=out', 'animate ann pose=calm,blush turn=5', 'animate ann turn=x', 'animate ann bob nowait',
  'hop ann', 'hop ann 0.5s', 'hop', 'hop ann x',
  'burst sparkle', 'burst sparkle at ann', 'burst confetti at center y=0.3 count=80 2s', 'burst smoke at 0.3 1.5s', 'burst dust at ann nowait', 'burst', 'burst rainbow', 'burst sparkle at', 'burst sparkle at ann y=0.2', 'burst sparkle count=0', 'burst sparkle count=501', 'burst sparkle at nowhere', 'burst sparkle 0',
  'flash', 'flash ann', 'flash ann #ff0000 0.2s', 'flash ann 0.5s', 'flash ann #fff 1 2', 'move ann tint=#ff8080', 'move ann tint=none 1s', 'move ann tint=red', 'image move logo tint=#80ff80 1s', 'image move logo tint=none', 'image show logo ui/logo.png tint=#ff0000', 'flash #ffffff', 'flash #ff0000 0.5s', 'flash 0.5s', 'flash red', 'flash #fff 1 2',
  // tint / camera / weather / filter
  'tint #ff8800', 'tint #ff8800 0.5', 'tint #ff8800 0.5 2s', 'tint off', 'tint off 2s', 'tint', 'tint red', 'tint #ff8800 2', 'tint off x',
  'camera zoom 1.5', 'camera zoom 2 at left', 'camera zoom 2 at left y=0.3 1s', 'camera pan right', 'camera pan 0.3 y=0.4 2s', 'camera roll 5', 'camera roll -8 1.5s ease=out', 'camera roll', 'camera roll x', 'camera roll 5 y=0.2', 'camera reset', 'camera reset 1s', 'camera', 'camera tilt', 'camera zoom',
  'weather rain', 'weather snow 0.5', 'weather petals 0.5 3s', 'weather off', 'weather off 2s', 'weather', 'weather fog', 'weather rain 2',
  'filter blur', 'filter glow', 'filter chromatic 0.6 1s', 'filter glitch 0.5', 'filter sepia 0.5 2s', 'filter off', 'filter off 1s', 'filter', 'filter glitter', 'filter night x',
  'focus on', 'focus off', 'focus', 'focus maybe', 'focus on off', 'behaviors on', 'behaviors off', 'behaviors',
  // hud / image
  'hud on bar', 'hud on bar keep', 'hud off bar', 'hud on', 'hud on bar stay', 'hud toggle bar', 'hud on 1bad',
  'image show logo ui/logo.png', 'image show sky sky.png layer=-2 parallax=0.4', 'image show sky sky.png parallax=-1', 'image show sky sky.png parallax=x', 'image show logo ui/logo.png at 10,20', 'image show logo ui/logo.png scale=2 rot=5 alpha=0.5 anchor=0.5,0.5 layer=2 fixed keep fade 1s',
  'image move logo to 5,6', 'image move logo scale=2 1.5s ease=out', 'image move logo', 'image hide logo', 'image hide logo fade 1s', 'image hide logo fade',
  'image', 'image show', 'image show logo', 'image dance logo', 'image show 1x f.png',
  // music / sound / movie
  'music play theme', 'music play theme loop', 'music play theme loop fade 2s', 'music play theme fade 1s', 'music stop', 'music stop fade 2s', 'music pause', 'music resume fade 1s',
  'music', 'music play', 'music rewind', 'music stop fade',
  'sound play click', 'sound play click duck', 'sound loop rain', 'sound loop rain fade 2s', 'sound stop', 'sound stop rain', 'sound stop rain fade 1s', 'sound', 'sound play', 'sound play a b', 'sound stop duck', 'sound play click fade 1',
  'movie play intro', 'movie play intro noskip', 'movie play intro loop', 'movie play intro noskip loop', 'movie play intro loop loop', 'movie', 'movie play', 'movie stop',
  // wait / call / jump / return / end
  'wait', 'wait 2s', 'wait 0.5s', 'wait x', 'wait 1 2',
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
