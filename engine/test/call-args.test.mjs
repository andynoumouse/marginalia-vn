import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, Runtime, NullRenderer, playtest, labelRefs, renameLabel, applyTextEdits, getCompletions } from '../../dist/engine/src/index.js';

const build = text => compile([{ file: 't.vn', text }]);
const problems = (p, severity = 'error') => p.diagnostics.filter(d => d.severity === severity).map(d => d.message);
const play = async text => {
  const r = new NullRenderer(), rt = new Runtime(build(text), r);
  await rt.start();
  return { r, rt, lines: r.says.map(s => s.text) };
};

const SHOP = `label start:
  set price = 99
  call shop("sword", 10)
  call shop("shield", price - 90 + 1)
  "done, price [price]"
  end
label shop(item, cost):
  "buy [item] for [cost]"
  set cost += 5
  "now [cost]"
  return
`;

test('call label(args): parameters hold the arguments, then the caller values come back', async () => {
  const p = build(SHOP);
  assert.deepEqual(problems(p), []);
  assert.deepEqual(p.params, { shop: ['item', 'cost'] });
  const { lines, rt } = await play(SHOP);
  assert.deepEqual(lines, ['buy sword for 10', 'now 15', 'buy shield for 10', 'now 15', 'done, price 99']);
  assert.equal('item' in rt.vars, false); // never existed outside the call
  assert.equal('cost' in rt.vars, false);
  assert.deepEqual(rt.frames, []);
});

test('a parameter shadows a variable of the same name and gives it back', async () => {
  const { lines } = await play(`label start:
  set n = 7
  call show(1)
  "n is [n]"
  end
label show(n):
  "arg [n]"
  set n = 50
  return
`);
  assert.deepEqual(lines, ['arg 1', 'n is 7']);
});

test('arguments are expressions evaluated before any parameter is bound', async () => {
  const { lines } = await play(`label start:
  set a = 1
  set b = 2
  call swap(b, a)
  end
label swap(a, b):
  "[a] [b]"
  return
`);
  assert.deepEqual(lines, ['2 1']);
});

test('recursion keeps one set of parameters per call', async () => {
  const { lines } = await play(`label start:
  call down(3)
  end
label down(n):
  if n > 0:
    "in [n]"
    call down(n - 1)
    "out [n]"
  return
`);
  assert.deepEqual(lines, ['in 3', 'in 2', 'in 1', 'out 1', 'out 2', 'out 3']);
});

test('a plain call and a call with () still work for labels without parameters', async () => {
  const { lines } = await play(`label start:
  call hi
  call hi()
  end
label hi:
  "hi"
  return
`);
  assert.deepEqual(lines, ['hi', 'hi']);
});

test('saves keep the locals of a call in progress', async () => {
  const text = `label start:
  set n = 7
  call inner(3)
  "back [n]"
  end
label inner(n):
  "first [n]"
  "second [n]"
  return
`;
  const p = build(text);
  const r = new NullRenderer(), rt = new Runtime(p, r);
  let saved = null;
  const say = r.say.bind(r);
  r.say = async ev => { await say(ev); if (ev.text === 'first 3') saved = rt.save(); };
  await rt.start();
  assert.ok(saved);
  assert.equal(saved.frames.length, 1);
  const r2 = new NullRenderer(), rt2 = new Runtime(p, r2);
  await rt2.load(saved);
  const rest = r2.says.map(s => s.text);
  assert.ok(rest.includes('second 3'));
  assert.equal(rest[rest.length - 1], 'back 7');
});

test('rollback and hot reload (restore) rebuild the locals by replay', async () => {
  const text = `label start:
  call ask("tea")
  "end of start"
  end
label ask(drink):
  "want [drink]?"
  menu:
    "yes":
      "[drink] it is"
    "no":
      "no [drink]"
  return
`;
  const p = build(text);
  const r = new NullRenderer(), rt = new Runtime(p, r);
  await rt.start();
  const choices = [...rt.choices];
  const r2 = new NullRenderer(), rt2 = new Runtime(p, r2);
  await rt2.restore({ file: 't.vn', line: 9 }, choices);
  assert.equal(r2.says[0].text, 'tea it is'); // the replay rebuilt drink = tea, then the story played on live
  assert.equal('drink' in rt2.vars, false);   // and the call returned
  assert.deepEqual(rt2.frames, []);
  const r3 = new NullRenderer();
  await new Runtime(p, r3).restore({ step: 0 }, []);
  assert.equal(r3.says[0].text, 'want tea?');
});

test('compile checks: argument count, unknown label, bad parameter names', () => {
  const base = 'label shop(item, cost):\n  "x [item] [cost]"\n';
  assert.match(problems(build(`label start:\n  call shop("a")\n${base}`))[0], /takes 2 arguments .* gives 1/);
  assert.match(problems(build(`label start:\n  call shop\n${base}`))[0], /takes 2 arguments/);
  assert.match(problems(build('label start:\n  call plain(1)\nlabel plain:\n  "x"\n'))[0], /takes 0 arguments, but the call gives 1/);
  assert.match(problems(build('label start:\n  call nowhere(1)\n'))[0], /Unknown label "nowhere"/);
  assert.ok(problems(build('label start:\n  call x(\nlabel x(a):\n  "x"\n')).length > 0);
  assert.match(problems(build('label x(a, a):\n  "x"\n'))[0], /twice/);
  assert.match(problems(build('label x(1a):\n  "x"\n'))[0], /not a valid parameter/);
  assert.match(problems(build('label x(true):\n  "x"\n'))[0], /not a valid parameter/);
  assert.match(problems(build(`label start:\n  jump shop\n${base}`), 'warning')[0], /takes parameters/);
  // parameters are assigned by the call: no "never assigned" warning for them, but unknown arguments warn
  assert.deepEqual(problems(build(`label start:\n  call shop("a", 1)\n${base}`), 'warning'), []);
  assert.match(problems(build(`label start:\n  call shop("a", ghost)\n${base}`), 'warning')[0], /"ghost" is never assigned/);
});

test('playtest follows arguments into the label (branches on a parameter)', () => {
  const p = build(`label start:
  call check(3)
  call check(0)
  end
label check(n):
  if n > 1:
    "big"
  else:
    "small"
  return
`);
  const r = playtest(p);
  assert.deepEqual(r.unreachableLines, []);
  assert.equal(r.complete, true);
  assert.deepEqual(r.unusedVariables, []);
  assert.deepEqual(r.unsetVariables, []);
});

test('playtest tells apart calls that differ only in their arguments', () => {
  const p = build(`label start:
  set door = 2
  call open(door)
  call open(5)
  end
label open(d):
  if d == 5:
    "five"
  else:
    "other"
  if d == 7:
    "never"
  return
`);
  const r = playtest(p);
  assert.deepEqual(r.unreachableLines.map(l => l.from), [12]);
});

test('rename label and find references handle the parameter list and call arguments', () => {
  const files = [{ name: 't.vn', text: 'label start:\n  call shop("a (b)", 2)  # note\nlabel shop(item, cost):\n  jump start\n' }];
  const refs = labelRefs(files).filter(r => r.name === 'shop');
  assert.deepEqual(refs.map(r => [r.kind, r.line]), [['call', 2], ['label', 3]]);
  const res = renameLabel(files, 'shop', 'store');
  assert.ok(res.ok);
  assert.equal(applyTextEdits(files[0].text, res.edits), 'label start:\n  call store("a (b)", 2)  # note\nlabel store(item, cost):\n  jump start\n');
});

test('completions: labels show their parameters, parameters count as variables', () => {
  const p = build(SHOP);
  const labels = getCompletions(p, 'call ').filter(s => s.kind === 'label');
  assert.equal(labels.find(s => s.label === 'shop').detail, '(item, cost)');
  assert.ok(getCompletions(p, 'if ').some(s => s.label === 'cost' && s.kind === 'variable'));
});
