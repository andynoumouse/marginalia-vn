import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, Runtime, NullRenderer, parseExpr, evalExpr, formatExpr, interpolate, parseVarValue, usesRandom, valuesEqual, getCompletions } from '../../dist/engine/src/index.js';
import { seededDraw as makeRng } from './rng.mjs';
import { errors, warnings } from './helpers.mjs';

const ev = (src, vars = {}, rng) => evalExpr(parseExpr(src), vars, rng);

test('list literals, equality and formatting', () => {
  assert.deepEqual(ev('[]'), []);
  assert.deepEqual(ev('[1, "a", true, 1 + 1]'), [1, 'a', true, 2]);
  assert.equal(ev('["a", "b"] == ["a", "b"]'), true);
  assert.equal(ev('["a", "b"] == ["b", "a"]'), false);
  assert.equal(ev('[] != ["a"]'), true);
  assert.equal(ev('["a"] == "a"'), false);
  assert.equal(ev('["a"] < ["b"]'), false);
  assert.equal(formatExpr(parseExpr('["a",1]')), '["a", 1]');
  assert.throws(() => parseExpr('[1, 2'));
  assert.ok(valuesEqual([], []));
});

test('+ and - build new lists and never change the inputs', () => {
  const bag = Object.freeze(['key', 'map']);
  assert.deepEqual(ev('bag + "lamp"', { bag }), ['key', 'map', 'lamp']);
  assert.deepEqual(ev('bag + ["a", "b"]', { bag }), ['key', 'map', 'a', 'b']);
  assert.deepEqual(ev('bag - "key"', { bag }), ['map']);
  assert.deepEqual(ev('bag - "nope"', { bag }), ['key', 'map']);
  assert.deepEqual(ev('["a", "a", "b"] - "a"'), ['a', 'b']); // the first match only
  assert.deepEqual(ev('["a", "b", "c"] - ["c", "a"]'), ['b']);
  assert.deepEqual(bag, ['key', 'map']);
  assert.ok(Object.isFrozen(ev('bag + 1', { bag })));
  assert.deepEqual(ev('missing + ["a"]'), ['a']); // an unset variable counts as the empty list
  assert.ok(Number.isNaN(ev('bag * 2', { bag })));
});

test('list functions', () => {
  const v = { bag: ['key', 'map', 'key'], none: 0 };
  assert.equal(ev('contains(bag, "map")', v), true);
  assert.equal(ev('contains(bag, "lamp")', v), false);
  assert.equal(ev('contains(none, "x")', v), false); // not a list: empty
  assert.equal(ev('count(bag)', v), 3);
  assert.equal(ev('count(bag, "key")', v), 2);
  assert.equal(ev('count(none)', v), 0);
  assert.equal(ev('item(bag, 1)', v), 'key');
  assert.equal(ev('item(bag, 2)', v), 'map');
  assert.equal(ev('item(bag, 0)', v), '');
  assert.equal(ev('item(bag, 9)', v), '');
  assert.equal(ev('index(bag, "key")', v), 1);
  assert.equal(ev('index(bag, "map")', v), 2);
  assert.equal(ev('index(bag, "lamp")', v), 0);
  assert.throws(() => parseExpr('contains(bag)'));
});

test('pick(list) draws one element from the seeded generator; pick(a, b) is unchanged', () => {
  const v = { bag: ['a', 'b', 'c'] };
  const seen = new Set();
  const rng = makeRng(5);
  for (let i = 0; i < 60; i++) seen.add(ev('pick(bag)', v, rng));
  assert.deepEqual([...seen].sort(), ['a', 'b', 'c']);
  assert.equal(ev('pick([])', {}, makeRng(1)), '');
  assert.equal(ev('pick(7)', {}, makeRng(1)), 7);
  const draws = (src) => { const r = makeRng(9); ev(src, v, r); return r.next(); };
  assert.equal(draws('pick(bag)'), draws('pick("x", "y")')); // one draw either way
});

test('only random functions count as random', () => {
  assert.equal(usesRandom(parseExpr('pick(bag)')), true);
  assert.equal(usesRandom(parseExpr('contains(bag, "x")')), false);
  assert.equal(usesRandom(parseExpr('count(bag) + 1')), false);
  assert.equal(usesRandom(parseExpr('contains([pick(1, 2)], 1)')), true);
  assert.equal(usesRandom(parseExpr('[chance(5)]')), true);
});

test('lists show in text, and the variables panel parses them', () => {
  assert.equal(interpolate('You carry [bag].', { bag: ['key', 'map'] }), 'You carry key, map.');
  assert.equal(interpolate('Nothing:[bag]', { bag: [] }), 'Nothing:');
  assert.deepEqual(parseVarValue('["a", 2, true]'), ['a', 2, true]);
  assert.equal(parseVarValue('[1, [2]]'), '[1, [2]]'); // no nesting: kept as text
  assert.equal(parseVarValue('[broken'), '[broken');
});

const script = [
  'label start:',
  '  set bag = []',
  '  set bag += "key"',
  '  set bag += ["map", "lamp"]',
  '  set bag -= "map"',
  '  "Carrying [bag]."',
  '  if contains(bag, "key"):',
  '    "Has key."',
  '  if not contains(bag, "map"):',
  '    "No map."',
  '  set n = count(bag)',
  '  "N=[n]."',
  '  set persistent.seen = []',
  '  set persistent.seen += "ch1"',
  '  menu:',
  '    "Use the key" if contains(bag, "key"):',
  '      "Used."',
  '    "Wave":',
  '      "Waved."',
].join('\n');

test('set with lists compiles cleanly and runs', async () => {
  const p = compile([{ file: 'a.vn', text: script }]);
  assert.deepEqual(errors(p), []);
  assert.deepEqual(warnings(p), []);
  const r = new NullRenderer();
  const rt = new Runtime(p, r);
  const stored = {};
  rt.onPersist = (n, v) => { stored[n] = v; };
  await rt.start();
  assert.deepEqual(r.says.map(s => s.text), ['Carrying key, lamp.', 'Has key.', 'No map.', 'N=2.', 'Used.']);
  assert.deepEqual(rt.vars.bag, ['key', 'lamp']);
  assert.ok(Object.isFrozen(rt.vars.bag));
  assert.deepEqual(stored.seen, ['ch1']);
  assert.deepEqual(r.menus[0], ['Use the key', 'Wave']);
});

test('lists survive a save, a load and a restore into the middle of the story', async () => {
  const p = compile([{ file: 'a.vn', text: script }]);
  const rt = new Runtime(p, new NullRenderer());
  await rt.start();
  const save = JSON.parse(JSON.stringify(rt.save()));
  assert.deepEqual(save.vars.bag, ['key', 'lamp']);
  assert.deepEqual(save.persistent.seen, ['ch1']);
  const r2 = new NullRenderer();
  const rt2 = new Runtime(p, r2);
  await rt2.load(save);
  assert.deepEqual(rt2.vars.bag, ['key', 'lamp']);
  const r3 = new NullRenderer();
  const rt3 = new Runtime(p, r3);
  await rt3.restore({ file: 'a.vn', line: 12 }, []);
  assert.ok(r3.says.some(s => s.text === 'N=2.'));
  assert.deepEqual(rt3.vars.bag, ['key', 'lamp']);
});

test('persistent lists keep the playthrough start plus its own changes', async () => {
  const p = compile([{ file: 'a.vn', text: 'label start:\n  set persistent.seen += "x"\n  "Seen [persistent.seen]."' }]);
  const r = new NullRenderer();
  const rt = new Runtime(p, r);
  rt.persistentBase = { seen: ['a'] };
  await rt.start();
  assert.equal(r.says[0].text, 'Seen a, x.');
  assert.deepEqual(rt.persistent.seen, ['a', 'x']);
});

test('a menu condition may call list functions but not pick', () => {
  const ok = compile([{ file: 'a.vn', text: 'label start:\n  set bag = ["k"]\n  menu:\n    "A" if contains(bag, "k"):\n      end\n    "B":\n      end' }]);
  assert.deepEqual(errors(ok), []);
  const bad = compile([{ file: 'a.vn', text: 'label start:\n  set bag = ["k"]\n  menu:\n    "A" if pick(bag) == "k":\n      end\n    "B":\n      end' }]);
  assert.equal(errors(bad).length, 1);
});

test('warns when a variable is used as a list but never set to one', () => {
  const p = compile([{ file: 'a.vn', text: 'label start:\n  set bag += "key"\n  if contains(bag, "key"):\n    "x"' }]);
  assert.ok(warnings(p).some(m => m.includes('"bag" is used as a list but never set to one')));
  const fine = compile([{ file: 'a.vn', text: 'label start:\n  set bag += ["key"]\n  if contains(bag, "key"):\n    "x"' }]);
  assert.ok(!warnings(fine).some(m => m.includes('used as a list')));
  const num = compile([{ file: 'a.vn', text: 'label start:\n  set trust = 1\n  if count(trust) > 0:\n    "x"' }]);
  assert.ok(warnings(num).some(m => m.includes('"trust" is used as a list')));
});

test('list functions complete in expressions', () => {
  const p = compile([{ file: 'a.vn', text: 'label start:\n  set bag = []\n  "x"' }]);
  const labels = getCompletions(p, '  if ').map(s => s.label);
  for (const f of ['contains', 'count', 'item', 'index']) assert.ok(labels.some(l => l.startsWith(f)), f);
});
