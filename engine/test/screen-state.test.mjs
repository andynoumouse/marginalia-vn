import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seededRng } from './rng.mjs';
import { compile, Runtime, NullRenderer, assignIds, getCompletions, playtest, defaultAnswer, blocks } from '../../dist/engine/src/index.js';

const errors = p => p.diagnostics.filter(d => d.severity === 'error').map(d => d.message);
const warnings = p => p.diagnostics.filter(d => d.severity === 'warning').map(d => d.message);
const build = text => compile([{ file: 's.vn', text }]);
const button = (v, id) => v.parts.find(p => p.id === id);
const textOf = v => v.parts.find(p => p.kind === 'text').text;

const SHOP = `
set coins = 7
screen shop(start):
  state page = start
  state tip = ""
  state gold = coins * 2
  tab items page=items at 80,60 "Items"
  tab notes page=notes at 400,60 "Notes"
  button sword at 80,200 "Sword" on focus set tip = "Sharp" on blur set tip = "" if page == "items"
  text at 80,500 "Tip: [tip] / gold [gold]"
  button done at 1500,900 "Done"
label start:
  show screen shop("items") as pick
  "Picked [pick]."
  end
`;

test('state and tab parse; the view carries the handlers and what is lit', async () => {
  const p = build(SHOP);
  assert.deepEqual(errors(p), []);
  assert.deepEqual(p.screens.shop.states.map(d => d.name), ['page', 'tip', 'gold']);
  const r = new NullRenderer();
  r.picker = view => {
    assert.equal(button(view, 'items').role, 'tab');
    assert.equal(button(view, 'items').checked, true);
    assert.equal(button(view, 'notes').checked, false);
    assert.deepEqual(button(view, 'notes').sets, { click: ['page', 'notes'] });
    assert.deepEqual(button(view, 'sword').sets, { focus: ['tip', 'Sharp'], blur: ['tip', ''] });
    assert.equal(textOf(view), 'Tip:  / gold 14');
    return 'done';
  };
  const rt = new Runtime(p, r);
  await rt.start();
  assert.equal(rt.vars.pick, 'done');
});

test('a handler through live.set redraws from local state, hides what is gone, and records only the answer', async () => {
  const r = new NullRenderer();
  const rt = new Runtime(build(SHOP), r);
  const seen = [];
  r.picker = (view, live) => {
    assert.ok(live);
    const [n, val] = button(view, 'sword').sets.focus;
    seen.push(textOf(live.set(n, val)));
    const b = live.set('page', 'notes');
    seen.push(!!button(b, 'sword'), button(b, 'notes').checked, button(b, 'items').checked);
    live.set('nonsense', 1); // not a state: ignored
    return 'done';
  };
  await rt.start();
  assert.deepEqual(seen, ['Tip: Sharp / gold 14', false, true, false]);
  assert.deepEqual(rt.choices, ['done']); // nothing but the answer
  assert.equal('page' in rt.vars || 'tip' in rt.vars, false); // local state never reaches the story
});

test('every showing opens at the initial state', async () => {
  const text = `
screen pick:
  state n = 1
  tab a n=1 at 0,0 "A"
  tab b n=2 at 200,0 "B"
  button go at 400,0 "Go"
label start:
  show screen pick as first
  show screen pick as second
  end
`;
  const r = new NullRenderer();
  const lit = [];
  r.picker = (view, live) => { lit.push(button(view, 'a').checked); live.set('n', 2); return 'go'; };
  await new Runtime(build(text), r).start();
  assert.deepEqual(lit, [true, true]);
});

test('a replay answers from the initial view and skips the screen', async () => {
  const p = build(SHOP);
  const r = new NullRenderer();
  const rt = new Runtime(p, r);
  const say = p.ops.find(o => o.op === 'say');
  await rt.restore({ file: 's.vn', line: say.src.line }, ['sword']);
  assert.equal(rt.vars.pick, 'sword');
  assert.equal(r.screens.length, 0); // not shown: replayed
});

test('an element with on click set is not an answer; a screen of only such elements does not block', async () => {
  const p = build('screen s:\n  state x = 0\n  tab a x=1 at 0,0 "A"\n  button b at 0,100 "B" on click set x = x + 1\nlabel start:\n  show screen s as r\n  end\n');
  assert.deepEqual(errors(p), []);
  const r = new NullRenderer();
  const rt = new Runtime(p, r);
  await rt.start();
  assert.equal(r.screens.length, 0); // nothing to answer: returns at once, as a screen with no elements does
  assert.equal(rt.vars.r, '');
});

test('focus and blur handlers leave the click alone', async () => {
  const p = build('screen s:\n  state x = 0\n  button hov at 0,0 "H" on focus set x = 1\n  button inc at 0,100 "I" on click set x = x + 1\nlabel start:\n  show screen s as r\n  end\n');
  const r = new NullRenderer();
  r.picker = view => {
    assert.equal(defaultAnswer(view), 'hov'); // inc is not an answer
    assert.equal(blocks(view), true);
    return 'hov';
  };
  const rt = new Runtime(p, r);
  await rt.start();
  assert.equal(rt.vars.r, 'hov');
});

test('expressions see story variables, parameters and earlier states; a handler in each reads the entry', async () => {
  const p = build('set base = 5\nset list = ["a", "b"]\nscreen s(k):\n  state a = base + k\n  state b = a * 2\n  state pick = ""\n  each list as item at 0,0 step 0,100\n    button item at 0,0 "[item]" on focus set pick = item\n  text at 0,500 "[a] [b] [pick]"\nlabel start:\n  show screen s(3) as r\n  end\n');
  assert.deepEqual(errors(p), []);
  const r = new NullRenderer();
  const out = [];
  r.picker = (view, live) => {
    out.push(textOf(view));
    const [n, v] = button(view, 'b').sets.focus;
    out.push(textOf(live.set(n, v)));
    return 'a';
  };
  await new Runtime(p, r).start();
  assert.deepEqual(out, ['8 16 ', '8 16 b']);
});

test('errors: undeclared state, random(), duplicates, a parameter clash, misplaced state, a HUD', () => {
  const e = body => errors(build(`screen s(p):\n${body}\n  button ok at 0,0 "Ok"\nlabel start:\n  show screen s(1)\n  end\n`)).join('|');
  assert.match(e('  button b at 0,0 "B" on click set nope = 1'), /nope is not a state/);
  assert.match(e('  state x = random()'), /random/);
  assert.match(e('  state x = 1\n  state x = 2'), /declared twice/);
  assert.match(e('  state p = 1'), /already a parameter/);
  assert.match(e('  state x = 1\n  button b at 0,0 "B" on click set x = random()'), /random/);
  assert.match(e('  state x = 1\n  tab t y=1 at 0,0 "T"'), /y is not a state/);
  assert.match(e('  state x = 1\n  tab t at 0,0 "T"'), /Use: tab/);
  assert.match(e('  state x = 1\n  tab t x=1 at 0,0 "T" on click set x = 2'), /sets its state itself/);
  assert.match(e('  state x = 1\n  panel at 0,0:\n    state y = 2'), /belongs directly in the screen/);
  assert.match(e('  state x = 1\n  text at 0,0 "T" on click set x = 2'), /goes on a hotspot, button, tab/);
  assert.match(e('  state'), /Use: state/);
  assert.match(errors(build('screen s:\n  state x = 1\n  button b at 0,0 "B"\nlabel start:\n  hud on s\n  end\n')).join('|'), /local state/);
});

test('a state that hides a story variable warns; names used only in the screen are fine', () => {
  const p = build('set tip = 3\nscreen s:\n  state tip = ""\n  button b at 0,0 "B" on focus set tip = "x"\n  text at 0,50 "[tip]"\nlabel start:\n  show screen s\n  end\n');
  assert.deepEqual(errors(p), []);
  assert.deepEqual(warnings(p), ['state tip hides the story variable tip inside this screen']);
  const q = build('screen s:\n  state open = false\n  button b at 0,0 "B" on click set open = not open\n  text at 0,50 "x" if open\nlabel start:\n  show screen s\n  end\n');
  assert.deepEqual(q.diagnostics, []);
});

test('ids go on the label, not on the string a handler sets', () => {
  const src = 'screen s:\n  state tip = ""\n  button a at 0,0 "Hi" on focus set tip = "Mutes everything"\n  tab t tip=x at 0,50 "Tab"\n';
  const out = assignIds(src, new Set(), seededRng(3)).text.split('\n');
  assert.match(out[2], /^  button a at 0,0 "Hi" #\w{4} on focus set tip = "Mutes everything"$/);
  assert.match(out[3], /^  tab t tip=x at 0,50 "Tab" #\w{4}$/);
  assert.equal(assignIds(out.join('\n'), new Set(), () => 0.6).added, 0);
});

test('completions: set after on <event>, then the screen states; tab and state are offered', () => {
  const p = build('screen s:\n  state tip = ""\n  button b at 0,0 "B"\nlabel start:\n  end\n');
  const labels = prefix => getCompletions(p, prefix).map(s => s.label);
  assert.ok(labels('  button b at 0,0 "B" on click ').includes('set'));
  assert.ok(labels('  button b at 0,0 "B" on click set ').includes('tip'));
  assert.ok(labels('  ').includes('tab') && labels('  ').includes('state'));
  assert.ok(labels('  tab t ').includes('at'));
});

test('the playtest bot treats such a screen as a choice among its answering elements', () => {
  const p = build('screen s:\n  state x = 0\n  tab a x=1 at 0,0 "A"\n  button one at 0,100 "One" on focus set x = 1\n  button two at 0,200 "Two"\n  button inc at 0,300 "I" on click set x = x + 1\nlabel start:\n  show screen s as r\n  if r == "one":\n    "One."\n    end\n  "Two."\n  end\n');
  assert.deepEqual(errors(p), []);
  const r = playtest(p);
  assert.deepEqual(r.unreachableLines, []);
  assert.equal(r.stuck.length, 0);
});
