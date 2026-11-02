import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachPreloads, compile, opAssets, Runtime, NullRenderer, assetContext, bgKey, rigLayers, spriteKeys, checkAssets, stateAssets, successors } from '../../dist/engine/src/index.js';

const rig = {
  width: 500, height: 700,
  parts: [
    { file: 'body.png', x: 10, y: 20 },
    { slot: 'eyes', default: 'open', variants: { open: { file: 'eyes_open.png', x: 1, y: 2, poses: ['smile'] }, closed: { file: 'eyes_closed.png' } } },
    { slot: 'mouth', default: null, variants: { grin: { file: 'mouth_grin.png' } } },
  ],
};
const files = [
  'bg/park.png', 'bg/park_night.webp', 'cover.jpg', 'music/theme.ogg', 'sound/door.wav',
  'char/al/body.png', 'char/al/eyes_open.png', 'char/al/eyes_closed.png', 'char/al/mouth_grin.png', 'char/bo/default.png', 'char/bo/grin.png',
];
const ctx = assetContext({ files, rigs: { al: rig } });

test('asset keys: backgrounds resolve to bg/<name> or a root image, missing ones to null', () => {
  assert.equal(bgKey('park', ctx), 'bg/park');
  assert.equal(bgKey('park_night', ctx), 'bg/park_night');
  assert.equal(bgKey('cover', ctx), 'cover');
  assert.equal(bgKey('beach', ctx), null);
});

test('rig layers follow the slot, pose alias and default rules of the renderer', () => {
  const files = (pose, overrides) => rigLayers(rig, pose, overrides).map(p => p.file);
  assert.deepEqual(files(null, {}), ['body.png', 'eyes_open.png']);                       // defaults; mouth has none
  assert.deepEqual(files('smile', {}), ['body.png', 'eyes_open.png']);                    // alias of eyes/open
  assert.deepEqual(files('grin', {}), ['body.png', 'eyes_open.png', 'mouth_grin.png']);   // pose named like a variant
  assert.deepEqual(files(null, { eyes: 'closed', mouth: 'grin' }), ['body.png', 'eyes_closed.png', 'mouth_grin.png']);
  assert.deepEqual(files(null, { eyes: 'none' }), ['body.png']);
  assert.deepEqual(rigLayers(rig, null, {})[1], { file: 'eyes_open.png', x: 1, y: 2, part: 'eyes' });
  const warned = [];
  rigLayers(rig, 'frown', { eyes: 'wide' }, m => warned.push(m));
  assert.equal(warned.length, 2);
});

test('sprites and display states list only files that exist', () => {
  assert.deepEqual(spriteKeys({ char: 'al', pose: 'grin', overrides: {} }, ctx), ['char/al/body', 'char/al/eyes_open', 'char/al/mouth_grin']);
  assert.deepEqual(spriteKeys({ char: 'bo', pose: 'grin', overrides: {} }, ctx), ['char/bo/grin']);   // no rig: one image per pose
  assert.deepEqual(spriteKeys({ char: 'bo', pose: null, overrides: {} }, ctx), ['char/bo/default']);
  assert.deepEqual(spriteKeys({ char: 'bo', pose: 'sad', overrides: {} }, ctx), []);                  // placeholder
  const state = {
    bg: 'park', music: 'theme', musicLoop: true,
    sprites: [{ char: 'bo', pose: 'grin', overrides: {}, x: 0.5, y: 0, scale: 1, rotation: 0, alpha: 1, flip: false, anchor: [0.5, 1], anim: null }, { char: 'al', pose: null, overrides: { eyes: 'closed' }, x: 0.2, y: 0, scale: 1, rotation: 0, alpha: 1, flip: false, anchor: [0.5, 1], anim: null }],
  };
  assert.deepEqual(stateAssets(state, ctx), ['bg/park', 'char/bo/grin', 'char/al/body', 'char/al/eyes_closed', 'music/theme']);
  assert.deepEqual(stateAssets({ bg: 'beach', music: 'nope', sprites: [] }, ctx), []);
});

test('the runtime loads the final state before drawing it, after a restore and a load', async () => {
  const p = compile([{ file: 't.vn', text: ['label start:', '  scene park', '  "a"', '  scene cover', '  "b"'].join('\n') }]);
  const log = [];
  class Slow extends NullRenderer {
    sync(state) { log.push(`sync ${state.bg}`); super.sync(state); }
    async prepare(state) { log.push(`prepare ${state.bg}`); await new Promise(r => setTimeout(r, 5)); log.push(`ready ${state.bg}`); }
  }
  const rt = new Runtime(p, new Slow());
  await rt.restore({ file: 't.vn', line: 5 });
  assert.deepEqual(log, ['sync null', 'prepare cover', 'ready cover', 'sync cover']);
  log.length = 0;
  const save = rt.save();
  await new Runtime(p, new Slow()).load(save);
  assert.deepEqual(log, ['prepare cover', 'ready cover', 'sync cover']);
  // A restore that is superseded while loading never draws.
  log.length = 0;
  const again = new Runtime(p, new Slow());
  const first = again.restore({ file: 't.vn', line: 5 });
  await again.restore({ file: 't.vn', line: 3 });
  await first;
  assert.deepEqual(log.filter(l => l.startsWith('sync') && l !== 'sync null'), ['sync park']);
});

// ---- preload plan ----

const lines = (n, who = 'ann') => Array.from({ length: n }, (_, i) => `  ${who}: line ${i}`);
const story = [
  'define ann "Ann" blip=door',
  'define bo "Bo"',
  'set flag = 0',
  'label start:',
  '  scene park',
  '  show al smile',
  '  music play theme',
  ...lines(12),
  '  menu:',
  '    "A":',
  '      jump a',
  '    "B":',
  '      call c',
  '      jump b',
  'label a:',
  '  scene night',        // not in the files: a placeholder, so no task
  ...lines(45),
  '  scene cover',
  '  show bo grin',
  '  sound play door',
  ...lines(5),
  '  jump end',
  'label b:',
  '  "in b"',
  '  if flag:',
  '    jump b',            // a loop
  '  jump end',
  'label c:',
  '  music play theme2',
  '  show al',             // no pose: the rig defaults
  ...lines(3),
  '  return',
  'label end:',
  '  scene park_night',
  '  end',
].join('\n');
const program = () => compile([{ file: 't.vn', text: story }]);
const index = { files: [...files, 'music/theme2.ogg'], rigs: { al: rig } };
const at = (p, pc) => Object.fromEntries((p.preload.tasks[pc] ?? []).map(t => [t.key, t.lines]));

test('preload tasks hang on the program start, labels and lines, nearest first', () => {
  const p = program();
  const pre = attachPreloads(p, index, { gallery: ['park_night', 'cover', 'nope'] });
  assert.equal(p.preload, pre);
  const start = at(p, p.labels.start);
  assert.deepEqual(Object.keys(start).slice(0, 4), ['bg/park', 'char/al/body', 'char/al/eyes_open', 'music/theme']);
  assert.equal(start['music/theme2'], 13);  // 12 lines and the menu away, through "B" into `call c`
  assert.equal(start['bg/park_night'], 17); // ... and back out of c, through b, to the end label
  assert.ok(!('cover' in start));        // in `a`, 58 lines away
  assert.ok(Object.values(start).every(l => l <= pre.lookahead));
  const order = pre.tasks[p.labels.start].map(t => t.lines);
  assert.deepEqual(order, [...order].sort((x, y) => x - y)); // nearest first
  assert.deepEqual(at(p, 0), start);        // the program start sees through the setup code and the entry jump
  // `a` is `scene night` (a placeholder) and 45 lines, then scene cover: the 6th line is the first to see it
  assert.equal(at(p, p.labels.a + 1 + 5).cover, 40);
  assert.ok(!('cover' in at(p, p.labels.a + 1 + 4)));
});

test('the walk follows both menu options, calls with their returns, and terminates on loops', () => {
  const p = program();
  attachPreloads(p, index);
  const menu = p.ops.findIndex(o => o.op === 'menu');
  const here = at(p, menu);
  assert.equal(here['music/theme2'], 1);    // through "B" into `call c`
  assert.equal(here['bg/park_night'], 5);   // the menu, c's three lines and b's line before the end label
  // `ret` leads back to the op after the call: the lines after `call c` reach b's and end's assets
  const lastC = p.ops.findIndex((o, i) => o.op === 'say' && p.ops[i + 1].op === 'ret');
  assert.ok('bg/park_night' in at(p, lastC));
  // a program that only loops, and one that calls itself
  const loops = ['label start:\n  jump start', 'label start:\n  scene park\n  call start\n  "x"', 'label start:\n  scene park\n  "x"\n  jump start'];
  for (const text of loops) {
    const q = compile([{ file: 'l.vn', text }]);
    assert.doesNotThrow(() => attachPreloads(q, index));
  }
  const empty = compile([{ file: 'e.vn', text: '' }]);
  assert.deepEqual(attachPreloads(empty, index).tasks, {});
});

test('what the walk cannot see goes to the always list; the gallery is kept apart', () => {
  const p = program();
  const pre = attachPreloads(p, index, { gallery: ['park_night', 'cover', 'nope'] });
  assert.deepEqual([...pre.always].sort(), ['char/al/body', 'char/al/eyes_open', 'sound/door']);  // blip= voice sample, rig defaults of `show al`
  assert.deepEqual(pre.gallery, ['bg/park_night', 'cover']);
});

test('every asset is requested at least `lookahead` lines before its use, on every path', () => {
  for (const lookahead of [10, 40]) {
    const p = program();
    const pre = attachPreloads(p, index, { lookahead });
    const ctx = assetContext(index);
    const next = successors(p);
    const isLine = op => op.op === 'say' || op.op === 'menu' || op.op === 'input';
    let paths = 0, uses = 0;
    const walk = (path, seen) => {
      const pc = path[path.length - 1];
      if (pc >= p.ops.length || !next[pc].length || path.length > 400) { check(path); return; }
      for (const n of next[pc]) {
        if ((seen.get(n) ?? 0) >= 2) { check(path); continue; } // a loop: once around is enough
        walk([...path, n], new Map(seen).set(n, (seen.get(n) ?? 0) + 1));
      }
    };
    const check = path => {
      paths++;
      const before = []; let n = 0;
      for (const pc of path) { before.push(n); if (isLine(p.ops[pc])) n++; }
      path.forEach((pc, u) => {
        for (const key of opAssets(p.ops[pc], ctx)) {
          uses++;
          const need = Math.min(lookahead, before[u]);
          const early = path.slice(0, u + 1).some((q, i) => before[u] - before[i] >= need && (pre.tasks[q] ?? []).some(t => t.key === key && t.lines <= lookahead));
          assert.ok(early, `${key} at op ${pc} (line ${before[u]}) is not requested ${need} lines ahead, lookahead ${lookahead}`);
        }
      });
    };
    walk([0], new Map([[0, 1]]));
    assert.ok(paths >= 4 && uses > 20, `${paths} paths, ${uses} uses`);
  }
});

test('the runtime hands tasks to the renderer as the story reaches them, and warm() starts at the beginning', async () => {
  const p = program();
  attachPreloads(p, index);
  const asked = [];
  class Spy extends NullRenderer { prefetch(tasks, always) { asked.push([tasks[0]?.key, always.length]); } }
  const r = new Spy();
  const rt = new Runtime(p, r);
  rt.warm();
  assert.equal(asked.length, 1);
  assert.deepEqual(asked[0], ['bg/park', 3]);
  asked.length = 0;
  r.chooser = () => 0;
  await rt.start();
  assert.ok(asked.length > 10, 'one call per line, menu and label entry');
  // an instant restore does not ask on the way, only from where it lands
  asked.length = 0;
  await rt.restore({ file: 't.vn', line: 30 });
  assert.ok(asked.length > 0);
  const cover = asked.map(a => a[0]);
  assert.ok(!cover.includes(undefined));
});

test('a HUD preloads its images and what the labels it calls show, up to their return', () => {
  const p = compile([{ file: 't.vn', text: `screen bar:
  image "bg/park.png" size 100,100
  button b at 0,0 "B" on click open
label start:
  hud on bar
  end
label open:
  scene park_night
  music play theme
  return
  scene cover
` }]);
  const op = p.ops.find(o => o.op === 'hud');
  assert.deepEqual(opAssets(op, ctx, p).sort(), ['bg/park', 'bg/park_night', 'music/theme']);
  assert.deepEqual(opAssets({ ...op, mode: 'off' }, ctx, p), []);
});

test('a flat character with a rig.json keeps its image per pose and gets its own animations', () => {
  const flat = { parts: [], flat: true, rig: { animations: { nod: { dur: 1, keys: [{ t: 0, dy: 0 }, { t: 1, dy: 5 }] } } } };
  const flatFiles = ['char/bo/default.png', 'char/bo/grin.png'];
  const c = assetContext({ files: flatFiles, rigs: { bo: flat } });
  assert.deepEqual(spriteKeys({ char: 'bo', pose: 'grin', overrides: {} }, c), ['char/bo/grin']);
  const p = compile([{ file: 'a.vn', text: 'label start:\n  show bo grin\n  animate bo nod\n  animate bo wobble\n  end' }]);
  const msgs = checkAssets(p, { files: flatFiles, rigs: { bo: flat } }).map(d => d.message);
  assert.equal(msgs.length, 1);
  assert.match(msgs[0], /no animation "wobble"/);
});
