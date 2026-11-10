import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compile, Runtime, NullRenderer, interpolate, resolveScreen, validateScreen, checkGame, stageSize, stageProblem, stageLabel, fxUnit,
  DEFAULT_STAGE, namedPositions, namedAnchors, ANIMS,
} from '../../dist/engine/src/index.js';
import { errors, warnings } from './helpers.mjs';

const PORTRAIT = { width: 1080, height: 1920 };
const build = (text, stage) => compile([{ file: 's.vn', text }], namedPositions(null), namedAnchors(null), stage);
const view = (p, name) => resolveScreen(p.screens[name], {}, { items: {}, stage: p.stage, text: (_id, raw, v) => interpolate(raw, v) });
const boxes = (p, name) => view(p, name).parts.map(x => (x.id ? [x.id, x.bounds.x, x.bounds.y] : [x.kind, x.x, x.y]));

test('stageSize reads game.json and falls back to 1920x1080', () => {
  assert.deepEqual(stageSize(null), DEFAULT_STAGE);
  assert.deepEqual(stageSize({}), { width: 1920, height: 1080 });
  assert.deepEqual(stageSize({ stage: PORTRAIT }), PORTRAIT);
  assert.deepEqual(stageSize({ stage: { width: 10, height: 1080 } }), DEFAULT_STAGE); // unusable: default (checkGame reports it)
  assert.deepEqual(stageSize({ stage: 'big' }), DEFAULT_STAGE);
  assert.equal(stageLabel(PORTRAIT), '1080x1920');
});

test('stageProblem and checkGame report an unusable stage', () => {
  assert.equal(stageProblem(undefined), null);
  assert.equal(stageProblem(PORTRAIT), null);
  assert.match(stageProblem({ width: 1080 }), /stage\.height/);
  assert.match(stageProblem({ width: 1080.5, height: 1920 }), /stage\.width/);
  assert.match(stageProblem({ width: 1080, height: 99999 }), /stage\.height/);
  assert.match(stageProblem([1080, 1920]), /needs/);
  const text = '{\n  "stage": { "width": 0, "height": 1080 }\n}';
  const out = checkGame(JSON.parse(text), { files: [] }, text);
  assert.equal(out.length, 1);
  assert.equal(out[0].severity, 'error');
  assert.equal(out[0].line, 2);
  assert.deepEqual(checkGame({ stage: PORTRAIT }, { files: [] }, ''), []);
});

test('the compiled program carries the stage, and messages print its size', () => {
  assert.deepEqual(build('label start:\n  end\n').stage, { width: 1920, height: 1080 });
  const bad = 'label start:\n  image show a cg/a at nowhere\n  end\n';
  assert.ok(errors(build(bad)).some(m => m.includes('the stage is 1920x1080')));
  const p = build(bad, PORTRAIT);
  assert.deepEqual(p.stage, PORTRAIT);
  assert.ok(errors(p).some(m => m.includes('the stage is 1080x1920')));
  assert.ok(!errors(p).some(m => m.includes('1920x1080')));
});

test('off-stage warnings use the project size', () => {
  const text = 'screen s:\n  button a at 1500,100 "A"\n  hotspot h at 1200,100 size 50,50 "H"\nlabel start:\n  end\n';
  assert.deepEqual(warnings(build(text)), []); // on a 1920 stage both fit
  const w = warnings(build(text, PORTRAIT));
  assert.equal(w.length, 2);
  assert.ok(w.every(m => m.includes('outside the 1080x1920 stage')));
  assert.deepEqual(validateScreen(build(text).screens.s, PORTRAIT).length, 2);
});

test('anchored layouts sit against the edges of the project stage', () => {
  const text = 'screen s:\n  row anchor bottomright margin 20 gap 10:\n    button a "A"\n    button b "B"\nlabel start:\n  end\n';
  assert.deepEqual(boxes(build(text), 's'), [['a', 1490, 976], ['b', 1700, 976]]);
  assert.deepEqual(boxes(build(text, PORTRAIT), 's'), [['a', 650, 1816], ['b', 860, 1816]]);
  const centered = 'screen s:\n  column anchor center:\n    button a "A"\nlabel start:\n  end\n';
  assert.deepEqual(boxes(build(centered, PORTRAIT), 's'), [['a', 440, 918]]);
});

test('a mask hotspot without a size covers the stage', () => {
  const text = 'screen s:\n  hotspot r mask "ui/r.png" "R"\nlabel start:\n  end\n';
  const shape = p => p.screens.s.body[0].shape;
  assert.deepEqual([shape(build(text)).w, shape(build(text)).h], [1920, 1080]);
  assert.deepEqual([shape(build(text, PORTRAIT)).w, shape(build(text, PORTRAIT)).h], [1080, 1920]);
});

test('margin and padding take one, two or four numbers', () => {
  const at = (extra, stage) => boxes(build(`screen s:\n  row anchor topleft ${extra}:\n    button a "A"\nlabel start:\n  end\n`, stage), 's')[0];
  assert.deepEqual(at('margin 30'), ['a', 30, 30]);
  assert.deepEqual(at('margin 10,40'), ['a', 40, 10]); // vertical, horizontal
  assert.deepEqual(at('margin 1,2,3,4'), ['a', 4, 1]); // top, right, bottom, left
  assert.deepEqual(at('padding 8'), ['a', 8, 8]);
  assert.deepEqual(at('margin 10 padding 5,6,7,8'), ['a', 18, 15]);
  // padding grows the box, so it moves a bottom-right container in as well
  const br = boxes(build('screen s:\n  row anchor bottomright margin 0,0,0,0 padding 10:\n    button a "A"\nlabel start:\n  end\n'), 's')[0];
  assert.deepEqual(br, ['a', 1920 - 10 - 200, 1080 - 10 - 84]);
  // a centred container with an uneven margin shifts away from the larger side
  const c = boxes(build('screen s:\n  row anchor center margin 0,0,0,100:\n    button a "A"\nlabel start:\n  end\n'), 's')[0];
  assert.deepEqual(c, ['a', (1920 - 200 + 100) / 2, (1080 - 84) / 2]);
});

test('bad margin or padding is a script error', () => {
  for (const extra of ['margin', 'margin x', 'margin 1,2,3', 'padding 1,2,3,4,5', 'padding 1, 2']) {
    const p = build(`screen s:\n  row anchor topleft ${extra}:\n    button a "A"\nlabel start:\n  end\n`);
    assert.ok(errors(p).length > 0, extra);
  }
});

test('saves do not depend on the stage size', async () => {
  const text = 'define c "C"\nlabel start:\n  show c at left\n  c "Hi"\n  image show a cg/a at 100,100\n  menu:\n    "A":\n      end\n    "B":\n      end\n';
  const run = async stage => {
    const r = new NullRenderer();
    const rt = new Runtime(build(text, stage), r);
    r.chooser = () => { throw new Error('stop'); };
    await rt.start().catch(() => {});
    const { seed, rng, ...rest } = rt.save(); // the random seed differs per run
    return JSON.stringify(rest);
  };
  const a = await run(undefined), b = await run(PORTRAIT);
  assert.equal(a, b);
  assert.ok(!a.includes('1080') && !a.includes('1920'));
});

test('animation offsets are fractions of the shorter side', () => {
  assert.equal(fxUnit(DEFAULT_STAGE), 1080);
  assert.equal(fxUnit(PORTRAIT), 1080);
  assert.equal(fxUnit({ width: 720, height: 1280 }), 720);
  // an 8 px shake and a 44 px hop on a 1080 side, whatever the stage's other side is
  assert.ok(Math.abs(ANIMS.shake.fn(1 / 6).dx * 1080 + 8) < 1e-9);
  assert.ok(Math.abs(ANIMS.hop.fn(1).dy) < 1e-9);
  const peak = Math.max(...Array.from({ length: 101 }, (_, i) => -ANIMS.hop.fn(i / 100).dy * 1080));
  assert.ok(Math.abs(peak - 44) < 0.5);
});
