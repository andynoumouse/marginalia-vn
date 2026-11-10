import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, Runtime, NullRenderer, assignIds, successors, buildOutline, playtest, getCompletions } from '../../dist/engine/src/index.js';

const SCRIPT = [
  'label start:',                      // 1
  '  menu "Quick!" timeout 5s:',        // 2
  '    "Run":',                        // 3
  '      "You run."',                  // 4
  '      jump done',                   // 5
  '    "Hide":',                       // 6
  '      "You hide."',                 // 7
  '      jump done',                   // 8
  '    on timeout:',                   // 9
  '      "You freeze."',               // 10
  '      set frozen = 1',              // 11
  '      jump done',                   // 12
  'label done:',                       // 13
  '  "The end."',                      // 14
  '  end',                             // 15
].join('\n');

const build = text => compile([{ file: 't.vn', text }]);
const errors = p => p.diagnostics.filter(d => d.severity === 'error').map(d => d.message);
const warnings = p => p.diagnostics.filter(d => d.severity === 'warning').map(d => d.message);
const texts = r => r.says.map(s => s.text);
const timesOut = r => { r.chooser = options => options.length; return r; };

test('parser: the timeout form compiles to a menu op with a timeout block', () => {
  const p = build(SCRIPT);
  assert.deepEqual(errors(p), []);
  const menu = p.ops.find(o => o.op === 'menu');
  assert.equal(menu.options.length, 2);
  assert.equal(menu.timeout.from, 9);
  assert.equal(menu.timeout.to, 12);
  assert.ok(menu.timeout.target > menu.options[1].target);
  assert.ok(menu.end > menu.timeout.target);
  // without a prompt, and with an expression
  assert.deepEqual(errors(build('label start:\n  menu timeout (8 - 2)s:\n    "A":\n      end\n    on timeout:\n      end\n')), []);
  assert.deepEqual(errors(build('label start:\n  set d = 3\n  menu "Go" #ab12 timeout (8 - d)s:\n    "A":\n      end\n    on timeout:\n      end\n')), []);
  // a plain menu has no timeout
  assert.equal(build('label start:\n  menu:\n    "A":\n      end\n').ops.find(o => o.op === 'menu').timeout, null);
});

test('parser: the broken forms are errors', () => {
  const opt = '    "A":\n      end\n';
  const block = '    on timeout:\n      end\n';
  const bad = (menu, rest = '') => errors(build(`label start:\n${menu}${rest}`));
  assert.ok(bad('  menu timeout 5s:\n', opt).some(m => /needs an "on timeout:"/.test(m)));
  assert.ok(bad('  menu:\n', opt + block).some(m => /needs the menu to have a clock/.test(m)));
  assert.ok(bad('  menu timeout 5s:\n', opt + block + block).some(m => /only one/.test(m)));
  assert.ok(bad('  menu timeout 5s:\n', opt + block + opt).some(m => /last block/.test(m)));
  assert.ok(bad('  menu timeout 5s:\n', block).some(m => /at least one option/.test(m)));
  assert.ok(bad('  menu timeout (5 +)s:\n', opt + block).length > 0); // a bad expression
  assert.ok(bad('  menu timeout 5:\n', opt + block).some(m => /needs its unit: write 5s/.test(m)), 'a bare number is refused');
  assert.ok(bad('  menu timeout t:\n', opt + block).some(m => /\(8 - difficulty\)s/.test(m)), 'an expression needs brackets and its unit');
  assert.deepEqual(bad('  menu timeout 1500ms:\n', opt + block), [], 'ms works too');
  assert.ok(bad('  on timeout:\n      end\n').some(m => /only belongs inside/.test(m)));
});

test('compile: a fixed timeout under 2 seconds warns, 0 (no clock) and variable ones do not', () => {
  const make = t => build(`label start:\n  set d = 1\n  menu timeout ${t}:\n    "A":\n      end\n    on timeout:\n      end\n`);
  assert.ok(warnings(make('1s')).some(m => /too short/.test(m)));
  assert.deepEqual(warnings(make('2s')), []);
  assert.deepEqual(warnings(make('0s')), []);
  assert.deepEqual(warnings(make('(d)s')), []);
});

test('ids: assigning a prompt id keeps the timeout', () => {
  const { text } = assignIds('label start:\n  menu "Quick!" timeout (8 - 1)s:\n    "A":\n      end\n    on timeout:\n      end\n', new Set(), () => 0.3);
  assert.match(text, /menu "Quick!" #\w{4} timeout \(8 - 1\)s:/);
  assert.deepEqual(errors(build(text)), []);
});

test('runtime: the renderer gets the seconds; an answer past the last option runs the timeout block', async () => {
  const p = build(SCRIPT);
  const r = timesOut(new NullRenderer());
  const rt = new Runtime(p, r);
  await rt.start();
  assert.deepEqual(r.timers, [{ seconds: 5 }]);
  assert.deepEqual(texts(r), ['You freeze.', 'The end.']);
  assert.equal(rt.vars.frozen, 1);
  assert.deepEqual(rt.choices, [2]);
  assert.deepEqual(rt.seen, []); // a timeout is not an option
  // an ordinary answer still takes its option
  const r2 = new NullRenderer();
  r2.chooser = () => 1;
  await new Runtime(p, r2).start();
  assert.deepEqual(texts(r2), ['You hide.', 'The end.']);
});

test('runtime: seconds are evaluated when the menu is shown; 0 or less means no clock', async () => {
  const mk = t => build(`label start:\n  set d = 3\n  menu timeout ${t}:\n    "A":\n      end\n    on timeout:\n      end\n`);
  for (const [t, want] of [['(8 - d)s', { seconds: 5 }], ['0s', undefined], ['(0 - 4)s', undefined]]) {
    const r = new NullRenderer();
    await new Runtime(mk(t), r).start();
    assert.deepEqual(r.timers[0] ?? undefined, want, t);
  }
});

test('runtime: an answer past the last option without a timeout block is still the first option', async () => {
  const p = build('label start:\n  menu:\n    "A":\n      "first"\n      end\n    "B":\n      "second"\n      end\n');
  const r = timesOut(new NullRenderer());
  await new Runtime(p, r).start();
  assert.deepEqual(texts(r), ['first']);
  assert.deepEqual(r.timers, [null]);
});

test('replay: save/load, rollback and hot reload take the timeout answer again', async () => {
  const p = build(SCRIPT);
  const r = timesOut(new NullRenderer());
  const rt = new Runtime(p, r);
  const steps = [];
  r.say = async ev => { r.says.push(ev); steps.push({ text: ev.text, step: rt.step, choices: [...rt.choices] }); };
  await rt.start();

  // save/load: after the menu, the saved choices rebuild the same state
  const r2 = new NullRenderer();
  const rt2 = new Runtime(p, r2);
  await rt2.load(JSON.parse(JSON.stringify(rt.save())));
  assert.deepEqual(rt2.choices, [2]);
  assert.equal(rt2.vars.frozen, 1);

  // rollback to the line after the menu
  const back = steps.find(s => s.text === 'You freeze.');
  const r3 = new NullRenderer();
  const rt3 = new Runtime(p, r3);
  await rt3.restore({ step: back.step }, back.choices);
  assert.equal(r3.says[0].text, 'You freeze.');
  assert.deepEqual(rt3.choices, [2, ]);
  assert.deepEqual(r3.timers, []); // answered by the replay, never shown

  // hot reload: restore to a line of the block with the choices so far, in an edited program
  const edited = build(SCRIPT.replace('You freeze.', 'You freeze up.'));
  const r4 = new NullRenderer();
  const rt4 = new Runtime(edited, r4);
  await rt4.restore({ file: 't.vn', line: 10 }, [2]);
  assert.equal(r4.says[0].text, 'You freeze up.');
  assert.equal(rt4.vars.frozen, 1);
});

test('replay: with no recorded answer the menu defaults to the first option, never the timeout', async () => {
  const p = build(SCRIPT);
  const r = new NullRenderer();
  const rt = new Runtime(p, r);
  await rt.restore({ file: 't.vn', line: 14 }, []);
  assert.deepEqual(rt.choices.slice(0, 1), [0]);
  assert.equal(rt.vars.frozen, undefined);
});

test('Preview from cursor inside the timeout block takes the timeout answer', async () => {
  const p = build(SCRIPT);
  for (const line of [9, 10, 11, 12]) {
    const r = new NullRenderer();
    const rt = new Runtime(p, r);
    await rt.restore({ file: 't.vn', line });
    if (line <= 10) assert.equal(r.says[0].text, 'You freeze.', `line ${line}`);
    assert.deepEqual(rt.choices.slice(0, 1), [2], `line ${line}`);
  }
  // inside an option it still picks that option
  const r = new NullRenderer();
  await new Runtime(p, r).restore({ file: 't.vn', line: 7 });
  assert.equal(r.says[0].text, 'You hide.');
});

test('successors: a menu also leads to its timeout block', () => {
  const p = build(SCRIPT);
  const at = p.ops.findIndex(o => o.op === 'menu');
  const menu = p.ops[at];
  const next = successors(p)[at];
  assert.ok(next.includes(menu.timeout.target));
  assert.deepEqual(next, [at + 1, ...menu.options.map(o => o.target), menu.timeout.target]);
});

test('outline: a jump in the timeout block is an edge labelled timeout', () => {
  const o = buildOutline(build(SCRIPT));
  const e = o.edges.filter(x => x.from === 'start' && x.to === 'done');
  assert.deepEqual(e.map(x => x.text).sort(), ['Hide', 'Run', 'timeout']);
});

test('playtest: the bot takes the timeout; a fixed 0 leaves the block unreachable', () => {
  const r = playtest(build(SCRIPT));
  assert.deepEqual(r.unreachableLines, []);

  const zero = playtest(build(SCRIPT.replace('timeout 5s', 'timeout 0s')));
  assert.deepEqual(zero.unreachableLines.map(l => [l.from, l.to]), [[9, 12]]);

  // a variable clock may expire, so its block is reachable
  const dyn = playtest(build(SCRIPT.replace('menu "Quick!" timeout 5s', 'set t = 4\n  menu "Quick!" timeout (t)s')));
  assert.deepEqual(dyn.unreachableLines, []);
});

test('editor: timeout is offered after menu, on timeout after on', () => {
  const p = build(SCRIPT);
  const labels = s => getCompletions(p, s).map(x => x.label);
  assert.ok(labels('  menu "Quick!" ').includes('timeout'));
  assert.ok(!labels('  menu "Quick!" timeout ').includes('timeout'));
  assert.ok(labels('    on ').includes('timeout'));
  assert.ok(labels('').includes('on'));
});
