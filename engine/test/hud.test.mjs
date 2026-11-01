import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, Runtime, NullRenderer, buildOutline, getCompletions } from '../../dist/engine/src/index.js';

const errors = p => p.diagnostics.filter(d => d.severity === 'error').map(d => d.message);

const SCRIPT = `define a "Al"
screen bar:
  button bag at 0,0 "Bag" on click open_bag
  button info at 0,100 "Info"
  text at 10,10 "Bags: [n]"
set n = 0
label start:
  hud on bar
  a: one
  a: two
  a: three
  scene x
  a: four
  end
label open_bag:
  set n += 1
  a: bag [n]
  return
`;

/** A renderer whose lines wait until released, so a test can act while one is on screen. */
function harness(text = SCRIPT) {
  const p = compile([{ file: 't.vn', text }]);
  assert.deepEqual(errors(p), []);
  const r = new NullRenderer();
  const rt = new Runtime(p, r);
  const said = [];
  let release = null;
  r.say = async ev => { said.push(ev.text); await new Promise(res => { release = res; }); };
  r.interruptLine = () => { const f = release; release = null; f?.(); };
  const next = async () => { while (!release) await new Promise(res => setTimeout(res, 0)); const f = release; release = null; f(); await new Promise(res => setTimeout(res, 0)); };
  const waitLine = async () => { while (!release) await new Promise(res => setTimeout(res, 0)); };
  return { p, r, rt, said, next, waitLine };
}

test('hud: on click parses; unknown events, labels and screens are errors', () => {
  const p = compile([{ file: 't.vn', text: SCRIPT }]);
  assert.deepEqual(errors(p), []);
  assert.deepEqual(p.screens.bar.body[0].on, { click: 'open_bag' });
  assert.deepEqual(p.ops.find(o => o.op === 'hud'), { op: 'hud', mode: 'on', name: 'bar', keep: false, src: p.ops.find(o => o.op === 'hud').src });
  const bad = text => errors(compile([{ file: 't.vn', text }]));
  assert.match(bad('screen s:\n  button a at 0,0 "A" on hover nowhere\nlabel start:\n  end')[0], /Unknown event "hover"/);
  assert.match(bad('screen s:\n  button a at 0,0 "A" on click\nlabel start:\n  end')[0], /needs the label/);
  assert.match(bad('screen s:\n  button a at 0,0 "A" on click nowhere\nlabel start:\n  end')[0], /Unknown label "nowhere"/);
  assert.match(bad('label start:\n  hud on ghost')[0], /Unknown screen "ghost"/);
  for (const line of ['hud', 'hud on', 'hud up s', 'hud on s keep extra', 'hud off s keep']) assert.equal(bad(`screen s:\n  button a at 0,0 "A"\nlabel start:\n  ${line}`).length, 1, line);
});

test('hud: the HUD is pushed to the renderer, follows variables and resets on scene unless kept', async () => {
  const { r, rt, next, waitLine } = harness();
  const done = rt.start();
  await waitLine();
  const view = r.huds.at(-1)[0];
  assert.equal(view.name, 'bar');
  assert.deepEqual(view.parts.map(x => x.kind), ['button', 'button', 'text']);
  assert.equal(view.parts[0].on.click, 'open_bag');
  assert.deepEqual(rt.state.hud, [{ name: 'bar', keep: false }]);
  for (let i = 0; i < 3; i++) await next();
  assert.deepEqual(rt.state.hud, []); // scene x
  assert.deepEqual(r.huds.at(-1), []);
  await next();
  await done;
});

test('hud: an event ends the line, runs its label at the safe point and brings the line back', async () => {
  const { rt, said, next, waitLine } = harness();
  const done = rt.start();
  await waitLine();
  await next();                       // one -> two on screen
  assert.equal(rt.hudEvent('bag'), true);
  await waitLine();
  assert.deepEqual(said, ['one', 'two', 'bag 1']);
  await next();                       // bag 1 -> two again
  await waitLine();
  assert.deepEqual(said, ['one', 'two', 'bag 1', 'two']);
  assert.equal(rt.step, 2);           // the interrupted showing did not count
  assert.deepEqual(rt.choices, [{ hud: 'bag', on: 'click' }]);
  assert.equal(rt.hudEvent('bag'), true); // not running a label any more: allowed again
  await waitLine();
  assert.equal(said.at(-1), 'bag 2');
  assert.equal(rt.hudEvent('bag'), false, 're-entrancy: ignored while a HUD label runs');
  assert.equal(rt.hudEvent('info'), false, 'an element without a handler does nothing');
  rt.stop();
  void done;
});

test('hud: replay (restore, save, rollback) takes recorded events at the same safe points', async () => {
  const { rt, said, next, waitLine } = harness();
  void rt.start();
  await waitLine();
  await next();
  rt.hudEvent('bag');
  await waitLine();            // bag 1
  await next();                // two again
  await waitLine();
  await next();                // three
  await waitLine();
  const choices = [...rt.choices], step = rt.step, n = rt.vars.n;
  assert.equal(step, 3);
  assert.equal(said.at(-1), 'three');
  rt.stop();

  const again = harness();
  const back = again.rt.restore({ step }, choices);
  await again.waitLine();
  assert.equal(again.rt.vars.n, n);
  assert.equal(again.rt.step, step);
  assert.deepEqual(again.rt.stack, []);
  assert.deepEqual(again.rt.choices, choices);
  assert.deepEqual(again.said, ['three']);
  const saved = again.rt.save();
  assert.deepEqual(saved.choices, choices);
  again.rt.stop();
  void back;
});

test('hud: events are dropped while a menu is open and an unknown recorded event is skipped', async () => {
  const text = 'screen bar:\n  button b at 0,0 "B" on click go\nlabel start:\n  hud on bar\n  menu:\n    "x":\n      end\nlabel go:\n  end\n';
  const p = compile([{ file: 't.vn', text }]);
  assert.deepEqual(errors(p), []);
  const r = new NullRenderer();
  const rt = new Runtime(p, r);
  let release;
  r.menu = async () => new Promise(res => { release = () => res(0); });
  const done = rt.start();
  while (!release) await new Promise(res => setTimeout(res, 0));
  assert.equal(rt.hudEvent('b'), false);
  release();
  await done;
  assert.deepEqual(rt.choices, [0]);
  // a recorded event whose element is gone (the script changed) does not break the replay
  const r2 = new NullRenderer();
  const rt2 = new Runtime(p, r2);
  await rt2.restore({ step: 1 }, [{ hud: 'gone', on: 'click' }, 0]);
  assert.equal(r2.ended, true);
});

test('hud: focus and blur events run in order (quiet ones at once, the rest queued) and never overlap a running label', async () => {
  const text = `define a "Al"
screen bar:
  button x at 0,0 "X" on focus got_x on blur lost_x
  button y at 0,100 "Y" on focus got_y
set seen = 0
label start:
  hud on bar
  a: one
  a: two
  end
label got_x:
  set seen += 1
  a: x
  return
label lost_x:
  set seen += 10
  return
label got_y:
  set seen += 100
  return
`;
  const { p, rt, said, next, waitLine } = harness(text);
  assert.deepEqual(p.screens.bar.body[0].on, { focus: 'got_x', blur: 'lost_x' });
  void rt.start();
  await waitLine();
  assert.equal(rt.hudEvent('x', 'focus'), true);
  assert.equal(rt.hudEvent('x', 'blur'), true, 'a blur can follow a focus before the first is taken');
  assert.equal(rt.hudEvent('y', 'focus'), true);
  await waitLine();
  assert.deepEqual(said, ['one', 'x']);
  assert.equal(rt.hudEvent('y', 'focus'), false, 'ignored while a HUD label runs');
  await next();
  await waitLine();
  assert.deepEqual(said, ['one', 'x', 'one']);
  assert.equal(rt.vars.seen, 111);
  // lost_x and got_y only set variables: they ran on the spot, before the queued got_x
  assert.deepEqual(rt.choices, [{ hud: 'x', on: 'blur' }, { hud: 'y', on: 'focus' }, { hud: 'x', on: 'focus' }]);
  assert.equal(rt.hudEvent('y', 'blur'), false, 'no blur handler on y');
  const choices = [...rt.choices];
  rt.stop();

  const again = harness(text);
  void again.rt.restore({ step: 1 }, choices);
  await again.waitLine();
  assert.equal(again.rt.vars.seen, 111);
  assert.deepEqual(again.rt.choices, choices);
  again.rt.stop();
});

test('hud: a handler that only sets variables runs at once and leaves the line on screen alone', async () => {
  const text = `define a "Al"
screen bar:
  button x at 0,0 "X" on focus quiet on click loud on blur branchy
set n = 0
label start:
  hud on bar
  a: one
  a: two
  end
label quiet:
  set n += 1
  unlock seen_x
  return
label branchy:
  if n > 5:
    set n = 0
  else:
    set n += 10
  return
label loud:
  a: loud
  return
`;
  const { rt, said, next, waitLine } = harness(text);
  void rt.start();
  await waitLine();
  assert.equal(rt.hudEvent('x', 'focus'), true);
  assert.equal(rt.vars.n, 1);
  assert.deepEqual(said, ['one'], 'the line was not ended or shown again');
  assert.equal(rt.hudEvent('x', 'blur'), true);
  assert.equal(rt.vars.n, 11);
  assert.equal(rt.hudEvent('x', 'blur'), true);
  assert.equal(rt.vars.n, 0);
  assert.deepEqual(rt.choices.map(c => c.on), ['focus', 'blur', 'blur']);
  assert.equal(rt.step, 0);
  await next();
  await waitLine();
  assert.deepEqual(said, ['one', 'two']);
  assert.equal(rt.hudEvent('x', 'click'), true, 'a handler with a line is still queued');
  await waitLine();
  assert.equal(said.at(-1), 'loud');
  rt.stop();
});

test('hud: the outline shows the labels a HUD calls, and completions know hud and on', () => {
  const p = compile([{ file: 't.vn', text: SCRIPT }]);
  const o = buildOutline(p);
  assert.ok(o.edges.some(e => e.from === 'start' && e.to === 'open_bag' && e.kind === 'call'), 'start -> open_bag');
  const labels = prefix => getCompletions(p, prefix).map(s => s.label);
  assert.deepEqual(labels('hud '), ['on', 'off']);
  assert.deepEqual(labels('hud on '), ['bar']);
  assert.deepEqual(labels('hud on bar '), ['keep']);
  assert.ok(labels('  button x at 0,0 ').includes('on'));
  assert.deepEqual(labels('  button x at 0,0 "X" on '), ['click', 'focus', 'blur']);
  assert.ok(labels('  button x at 0,0 "X" on click ').includes('open_bag'));
});
