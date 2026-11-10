import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, Runtime, NullRenderer, getCompletions, playtest, renameVariable, variableAt, applyTextEdits } from '../../dist/engine/src/index.js';
import { errors } from './helpers.mjs';

const build = text => compile([{ file: 's.vn', text }]);
const button = (v, id) => v.parts.find(p => p.id === id);

const SETTINGS = `
set sound = false
set mode = "easy"
screen settings(inout sound, inout mode):
  toggle snd sound at 80,100 "Sound"
  radio easy mode=easy at 80,200 "Easy"
  radio hard mode=hard at 80,300 "Hard"
  button done at 1500,900 "Done"
  cancel
label start:
  show screen settings(sound, mode) as pick
  "Picked [pick], sound [sound], mode [mode]."
  end
`;

test('inout parameters, toggle and radio parse; the view says what is lit and what a click sets', async () => {
  const p = build(SETTINGS);
  assert.deepEqual(errors(p), []);
  assert.deepEqual(p.screens.settings.params, ['sound', 'mode']);
  assert.deepEqual(p.screens.settings.inout, ['sound', 'mode']);
  const r = new NullRenderer();
  r.picker = view => {
    assert.equal(button(view, 'snd').role, 'toggle');
    assert.equal(button(view, 'snd').checked, false);
    assert.deepEqual(button(view, 'snd').sets, { click: ['sound', true] });
    assert.equal(button(view, 'easy').role, 'radio');
    assert.equal(button(view, 'easy').checked, true);
    assert.equal(button(view, 'hard').checked, false);
    assert.deepEqual(button(view, 'hard').sets, { click: ['mode', 'hard'] });
    return 'done';
  };
  await new Runtime(p, r).start();
});

test('write-back: the changes reach the story variables when the screen answers, and only then', async () => {
  const r = new NullRenderer();
  const rt = new Runtime(build(SETTINGS), r);
  let during;
  r.picker = (view, live) => {
    live.set('sound', true);
    const v = live.set('mode', 'hard');
    assert.equal(button(v, 'snd').checked, true);
    assert.equal(button(v, 'hard').checked, true);
    assert.equal(button(v, 'easy').checked, false);
    during = { sound: rt.vars.sound, mode: rt.vars.mode };
    return 'done';
  };
  await rt.start();
  assert.deepEqual(during, { sound: false, mode: 'easy' }); // untouched while the screen is up
  assert.equal(rt.vars.sound, true);
  assert.equal(rt.vars.mode, 'hard');
  assert.equal(rt.vars.pick, 'done');
  assert.deepEqual(rt.choices, [['done', true, 'hard']]);
});

test('a persistent variable can be the argument; a plain parameter stays read-only', async () => {
  const text = `
set persistent.loud = false
screen s(inout loud, label):
  toggle t loud at 0,0 "Loud"
  button done at 0,100 "[label]"
label start:
  show screen s(persistent.loud, "Ok") as pick
  end
`;
  const p = build(text);
  assert.deepEqual(errors(p), []);
  const r = new NullRenderer();
  const stored = [];
  const rt = new Runtime(p, r);
  rt.onPersist = (k, v) => stored.push([k, v]);
  r.picker = (view, live) => { assert.equal(button(view, 'done').label, 'Ok'); live.set('loud', true); live.set('label', 'changed'); return 'done'; };
  await rt.start();
  assert.equal(rt.persistent.loud, true);
  assert.deepEqual(stored.at(-1), ['loud', true]);
  assert.deepEqual(rt.choices, [['done', true]]);
  const e = src => errors(build(src)).join('|');
  assert.match(e('screen s(label):\n  toggle t label at 0,0 "T"\n  button b at 0,0 "B"\n'), /read-only parameter/);
});

test('the call must give a plain variable for an inout parameter', () => {
  const head = 'screen s(inout a, b):\n  toggle t a at 0,0 "T"\n  button d at 0,100 "D"\nlabel start:\n';
  assert.match(errors(build(head + '  show screen s(a + 1, 2)\n  end\n')).join('|'), /plain variable name/);
  assert.match(errors(build(head + '  show screen s(5, 2)\n  end\n')).join('|'), /plain variable name/);
  assert.deepEqual(errors(build(head + '  set a = false\n  show screen s(a, a + 2)\n  end\n')), []);
  assert.match(errors(build(head + '  show screen s(a)\n  end\n')).join('|'), /takes 2 arguments/);
  assert.match(errors(build('screen s(inout a):\n  button d at 0,0 "D"\nlabel start:\n  hud on s\n  end\n')).join('|'), /takes parameters/);
});

test('toggle and radio need a state or an inout parameter, in the right form', () => {
  const e = body => errors(build(`screen s(inout a):\n  state x = 1\n${body}\n  button b at 0,100 "B"\n`)).join('|');
  assert.equal(e('  toggle t a at 0,0 "T"'), '');
  assert.equal(e('  toggle t x at 0,0 "T"'), '');
  assert.match(e('  toggle t nope at 0,0 "T"'), /not a state/);
  assert.match(e('  toggle t at 0,0 "T"'), /Use: toggle/);
  assert.match(e('  radio r a at 0,0 "R"'), /Use: radio/);
  assert.match(e('  radio r a=1 at 0,0 "R" on click set a = 2'), /sets its state itself/);
});

test('recording: one entry per screen, in parameter order; replay applies it and skips the screen', async () => {
  const p = build(SETTINGS);
  const say = p.ops.find(o => o.op === 'say');
  const r = new NullRenderer();
  const rt = new Runtime(p, r);
  await rt.restore({ file: 's.vn', line: say.src.line }, [['done', true, 'hard']]);
  assert.equal(r.screens.length, 0);
  assert.equal(rt.vars.pick, 'done');
  assert.equal(rt.vars.sound, true);
  assert.equal(rt.vars.mode, 'hard');
  assert.deepEqual(rt.choices, [['done', true, 'hard']]);
});

test('a stale return falls back to the screen defaults', async () => {
  const p = build(SETTINGS);
  const line = p.ops.find(o => o.op === 'say').src.line;
  const run = async choices => { const rt = new Runtime(p, new NullRenderer()); await rt.restore({ file: 's.vn', line }, choices); return rt; };
  let rt = await run([['gone', true, 'extreme']]); // no such element, no radio sets that word
  assert.equal(rt.vars.pick, 'done'); // the default answer: the first enabled element
  assert.equal(rt.vars.mode, 'easy');
  assert.equal(rt.vars.sound, true);
  rt = await run([['done', 'yes', 'hard']]); // the toggle's value is the wrong type
  assert.equal(rt.vars.sound, false);
  assert.equal(rt.vars.mode, 'hard');
  rt = await run(['done']); // a plain answer from before the screen had inout
  assert.equal(rt.vars.pick, 'done');
  assert.equal(rt.vars.sound, false);
  assert.deepEqual(rt.choices, [['done', false, 'easy']]);
});

test('rollback to a screen with several toggles reopens it fresh and does not hang', async () => {
  const text = `
set a = false
set b = false
set c = false
screen many(inout a, inout b, inout c):
  toggle ta a at 0,0 "A"
  toggle tb b at 0,100 "B"
  toggle tc c at 0,200 "C"
  button done at 0,300 "Done"
label start:
  "Before."
  show screen many(a, b, c) as pick
  "After [a][b][c]."
  end
`;
  const p = build(text);
  assert.deepEqual(errors(p), []);
  const r = new NullRenderer();
  const rt = new Runtime(p, r);
  let at = 0;
  r.picker = (view, live) => { at = rt.step; live.set('a', true); live.set('b', true); live.set('b', false); live.set('c', true); return 'done'; };
  await rt.start();
  assert.deepEqual(rt.choices, [['done', true, false, true]]);
  const step = rt.step;
  // back to the screen: its answer is not replayed, the screen opens at its initial state
  const shown = [];
  r.picker = view => { shown.push(['ta', 'tb', 'tc'].map(id => button(view, id).checked)); return 'done'; };
  await rt.restore({ step: at }, []);
  assert.deepEqual(shown, [[false, false, false]]);
  assert.equal(rt.vars.a, false);
  // forward again with the recorded return
  await rt.restore({ step }, [['done', true, false, true]]);
  assert.deepEqual([rt.vars.a, rt.vars.b, rt.vars.c], [true, false, true]);
});

test('cancel discards the inout changes, cancel keep applies them, no cancel ignores Esc', async () => {
  const mk = cancel => `
set a = false
screen s(inout a):
  toggle t a at 0,0 "T"
  button done at 0,100 "Done"
${cancel}
label start:
  show screen s(a) as pick
  end
`;
  const run = async text => {
    const r = new NullRenderer();
    const rt = new Runtime(build(text), r);
    r.picker = (view, live) => { live.set('a', true); return view.cancel ? '' : 'done'; };
    await rt.start();
    return rt;
  };
  let rt = await run(mk('  cancel'));
  assert.equal(rt.vars.pick, '');
  assert.equal(rt.vars.a, false);
  assert.deepEqual(rt.choices, [['', false]]);
  rt = await run(mk('  cancel keep'));
  assert.equal(rt.vars.pick, '');
  assert.equal(rt.vars.a, true);
  assert.deepEqual(rt.choices, [['', true]]);
  const none = build(mk(''));
  assert.equal(none.screens.s.cancel, false);
  rt = await run(mk(''));
  assert.equal(rt.vars.pick, 'done'); // the button answered; the screen offered no cancel
  assert.equal(rt.vars.a, true);
  assert.match(errors(build(mk('  cancel nope'))).join('|'), /Use: cancel/);
  assert.equal(build(mk('  cancel keep')).screens.s.cancelKeep, true);
});

test('a save while the screen is up keeps its local state; a rollback does not', async () => {
  const p = build(SETTINGS);
  const r = new NullRenderer();
  const rt = new Runtime(p, r);
  let snap = null;
  r.picker = (view, live) => {
    live.set('sound', true);
    live.set('mode', 'hard');
    snap = rt.screenSnapshot();
    return 'done';
  };
  await rt.start();
  assert.deepEqual(snap.local, { sound: true, mode: 'hard' });
  assert.equal(snap.name, 'settings');
  assert.equal(rt.screenSnapshot(), null); // nothing is up now
  // restore to the screen's line with the snapshot: it opens as the player left it
  const r2 = new NullRenderer();
  const rt2 = new Runtime(p, r2);
  const lit = [];
  r2.picker = view => { lit.push([button(view, 'snd').checked, button(view, 'hard').checked]); return 'done'; };
  await rt2.restore(snap.at, [], JSON.parse(JSON.stringify(snap)));
  assert.deepEqual(lit, [[true, true]]);
  assert.equal(rt2.vars.mode, 'hard');
  // without the snapshot (a rollback) it is fresh
  const r3 = new NullRenderer();
  const rt3 = new Runtime(p, r3);
  r3.picker = view => { lit.push([button(view, 'snd').checked, button(view, 'hard').checked]); return 'done'; };
  await rt3.restore(snap.at, []);
  assert.deepEqual(lit.at(-1), [false, false]);
  // a snapshot of another screen or line is ignored
  const r4 = new NullRenderer();
  const rt4 = new Runtime(p, r4);
  r4.picker = view => { lit.push([button(view, 'snd').checked]); return 'done'; };
  await rt4.restore(snap.at, [], { ...snap, name: 'other' });
  assert.deepEqual(lit.at(-1), [false]);
});

test('the playtest bot tries the initial state and one change per toggle or radio, not the product', () => {
  const text = `
set a = false
set b = false
set c = false
screen many(inout a, inout b, inout c):
  toggle ta a at 0,0 "A"
  toggle tb b at 0,100 "B"
  toggle tc c at 0,200 "C"
  button done at 0,300 "Done" enabled a or b or c
  cancel
label start:
  show screen many(a, b, c) as pick
  if pick == "":
    "Cancelled."
    end
  if a and b:
    "Both."
    end
  "Some [a] [b] [c]."
  end
`;
  const p = build(text);
  assert.deepEqual(errors(p), []);
  const r = playtest(p);
  // "Both." needs two toggles changed together: the bot changes one at a time, so only the text lines of the other routes are reached
  const lines = text.split('\n');
  const unreached = r.unreachableLines.flatMap(l => { const out = []; for (let n = l.from; n <= (l.to ?? l.from); n++) out.push(lines[n - 1].trim()); return out; });
  assert.deepEqual(unreached, ['"Both."', 'end']);
  assert.equal(r.stuck.length, 0);
});


test('rename and completions understand inout parameters and the states they bind', () => {
  const text = SETTINGS.trim() + '\n';
  const files = [{ name: 's.vn', text }];
  const line = text.split('\n').findIndex(l => l.startsWith('screen settings')) + 1;
  const target = variableAt(files, 's.vn', line, text.split('\n')[line - 1].indexOf('sound'));
  assert.ok(target.scope, 'the inout parameter belongs to its screen');
  const out = renameVariable(files, target, 'volume');
  assert.equal(out.ok, true, JSON.stringify(out));
  const renamed = applyTextEdits(text, out.edits.filter(e => e.file === 's.vn'));
  assert.match(renamed, /screen settings\(inout volume, inout mode\)/);
  assert.match(renamed, /toggle snd volume at/);
  assert.match(renamed, /^set sound = false$/m); // the story variable is another one
  assert.match(renamed, /show screen settings\(sound, mode\)/);
  const st = 'screen s:\n  state open = false\n  toggle t open at 0,0 "T"\n  button b at 0,0 "B" on click set open = not open\n  text at 0,0 "x" if open\n';
  const sf = [{ name: 's.vn', text: st }];
  const r2 = renameVariable(sf, variableAt(sf, 's.vn', 2, 8), 'shown');
  assert.equal(applyTextEdits(st, r2.edits), st.replace(/open/g, 'shown'));
  const p = build(SETTINGS);
  const labels = prefix => getCompletions(p, prefix).map(s => s.label);
  assert.ok(labels('  ').includes('toggle') && labels('  ').includes('radio'));
  assert.ok(labels('  toggle t ').includes('sound'));
  assert.ok(labels('  radio r ').includes('mode='));
  assert.deepEqual(labels('  cancel '), ['keep']);
});
