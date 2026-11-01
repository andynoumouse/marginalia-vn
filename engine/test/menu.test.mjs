import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, Runtime, NullRenderer, assignIds, existingIds, playtest } from '../../dist/engine/src/index.js';

const script = [
  'set key = 0',
  'label start:',
  '  menu "What now?" #pr01:',
  '    "Open the door" #op01 if key > 0 else "You need the key." #op02:',
  '      "Opened."',
  '      jump out',
  '    "Knock" #op03:',
  '      "Knocked."',
  '      jump out',
  '    "Hidden" #op04 if key > 5:',
  '      jump out',
  'label out:',
  '  "Done."',
].join('\n');
const build = text => {
  const p = compile([{ file: 't.vn', text }]);
  assert.deepEqual(p.diagnostics.filter(d => d.severity === 'error'), []);
  return p;
};

test('a prompt line and a disabled option with its reason reach the renderer', async () => {
  const p = build(script);
  assert.equal(p.strings.pr01, 'What now?');
  assert.equal(p.strings.op02, 'You need the key.');
  const r = new NullRenderer();
  r.chooser = opts => opts.findIndex(o => !o.disabled);
  const rt = new Runtime(p, r);
  await rt.start();
  assert.deepEqual(r.prompts, ['What now?']);
  assert.deepEqual(r.menus[0], ['Open the door', 'Knock']); // the failed option with no reason stays hidden
  assert.deepEqual(r.menuItems[0].map(o => !!o.disabled), [true, false]);
  assert.equal(r.menuItems[0][0].reason, 'You need the key.');
  assert.deepEqual(r.says.map(s => s.text), ['Knocked.', 'Done.']);
});

test('a renderer answering a disabled option gets the first enabled one instead', async () => {
  const r = new NullRenderer();
  r.chooser = () => 0;
  await new Runtime(build(script), r).start();
  assert.deepEqual(r.says.map(s => s.text), ['Knocked.', 'Done.']);
});

test('with the condition true the option is enabled', async () => {
  const r = new NullRenderer();
  const rt = new Runtime(build(script.replace('set key = 0', 'set key = 1')), r);
  await rt.start();
  assert.equal(r.menuItems[0][0].disabled, undefined);
  assert.deepEqual(r.says.map(s => s.text), ['Opened.', 'Done.']);
});

test('a menu with nothing choosable is skipped', async () => {
  const text = 'label start:\n  menu:\n    "A" if 1 > 2 else "No.":\n      "A."\n  "Done."';
  const r = new NullRenderer();
  await new Runtime(build(text), r).start();
  assert.equal(r.menus.length, 0);
  assert.deepEqual(r.says.map(s => s.text), ['Done.']);
});

test('taken options are marked seen, kept in saves and rebuilt by restore', async () => {
  const p = build(script);
  const r = new NullRenderer();
  const stored = [];
  const rt = new Runtime(p, r);
  rt.onSeen = k => stored.push(k);
  await rt.start();
  assert.deepEqual(rt.seen, ['op03']);
  assert.deepEqual(stored, ['op03']);
  assert.equal(r.menuItems[0][1].seen, false);
  const save = rt.save();
  assert.deepEqual(save.seen, ['op03']);
  // a later playthrough that starts with what was stored sees it marked
  const r2 = new NullRenderer();
  const rt2 = new Runtime(p, r2);
  rt2.seenBase = stored;
  await rt2.start();
  assert.equal(r2.menuItems[0][1].seen, true);
  assert.equal(r2.menuItems[0][0].seen, false);
  // load restores both parts
  const rt3 = new Runtime(p, new NullRenderer());
  await rt3.load(JSON.parse(JSON.stringify(rt2.save())));
  assert.deepEqual(rt3.seenBase, ['op03']);
  assert.deepEqual(rt3.seen, ['op03']);
  // a restore by replaying the answers rebuilds this playthrough's own set
  const rt4 = new Runtime(p, new NullRenderer());
  await rt4.restore({ step: 99 }, rt.choices);
  assert.deepEqual(rt4.seen, ['op03']);
});

test('options without an id are keyed by file and line', async () => {
  const rt = new Runtime(build('label start:\n  menu:\n    "A":\n      "x"'), new NullRenderer());
  await rt.start();
  assert.deepEqual(rt.seen, ['t.vn:3']);
});

test('assignIds gives the prompt and the reason ids, existingIds finds them', () => {
  const text = 'label start:\n  menu "Pick":\n    "A" if x > 1 else "No":\n      end\n    "B" #bbbb if x else "Nope" #cccc:\n      end';
  const taken = existingIds([text]);
  assert.deepEqual([...taken].sort(), ['bbbb', 'cccc']);
  const out = assignIds(text, taken);
  assert.equal(out.added, 3);
  assert.match(out.text, /menu "Pick" #\w{4}:/);
  assert.match(out.text, /"A" #\w{4} if x > 1 else "No" #\w{4}:/);
  assert.ok(out.text.includes('"B" #bbbb if x else "Nope" #cccc:'));
  const again = assignIds(out.text, existingIds([out.text]));
  assert.equal(again.added, 0);
  assert.deepEqual(build(out.text).diagnostics.filter(d => d.severity === 'error'), []);
});

test('the playtest bot never takes a disabled option', () => {
  const r = playtest(build(script));
  const taken = r.endings.flatMap(e => e.route);
  assert.ok(!taken.includes('Open the door'));
  assert.ok(taken.includes('Knock'));
  assert.ok(r.unreachableLines.some(l => l.from <= 5 && l.to >= 5)); // "Opened." can never run
});
