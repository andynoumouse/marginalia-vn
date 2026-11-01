import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, Runtime, NullRenderer, getCompletions, interpolate } from '../../dist/engine/src/index.js';

const script = [
  'label start:',
  '  if persistent.deaths > 0:',
  '    "Again, [persistent.deaths] deaths."',
  '  "Hello [persistent.name]."',
  '  set persistent.deaths += 1',
  '  set persistent.name = "Mina"',
  '  set persistent.seen = true',
  '  if persistent.deaths > 1:',
  '    "Many."',
  '  "Count [persistent.deaths]."',
  '  if persistent.ghost:',
  '    "Never."',
].join('\n');
const p = compile([{ file: 'a.vn', text: script }]);

test('compile warns about persistent values that are read but never written', () => {
  const msgs = p.diagnostics.map(d => d.message);
  assert.ok(msgs.some(m => m.includes('"persistent.ghost" is never written')));
  assert.ok(!msgs.some(m => m.includes('persistent.deaths')));
  assert.ok(!msgs.some(m => m.includes('Unknown name')));
  const bad = compile([{ file: 'a.vn', text: 'label start:\n  if foo.bar:\n    "x"' }]);
  assert.ok(bad.diagnostics.some(d => d.severity === 'error' && d.message.includes('persistent.<name>')));
});

test('a playthrough reads the values as they were when it began plus its own changes', async () => {
  const store = {};
  const play = async (base, restoreTo) => {
    const r = new NullRenderer();
    const rt = new Runtime(p, r);
    rt.persistentBase = { ...base };
    rt.onPersist = (n, v) => { store[n] = v; };
    await (restoreTo ? rt.restore(restoreTo, []) : rt.start());
    return r.says.map(s => s.text);
  };
  assert.deepEqual(await play({}), ['Hello [persistent.name].', 'Count 1.']);
  assert.deepEqual(store, { deaths: 1, name: 'Mina', seen: true });
  assert.deepEqual(await play({ ...store }), ['Again, 1 deaths.', 'Hello Mina.', 'Many.', 'Count 2.']);
  assert.equal(store.deaths, 2);
  // replaying the first playthrough (its own base) takes its branches and writes the same value again
  assert.equal((await play({}, { file: 'a.vn', line: 10 })).at(-1), 'Count 1.');
  assert.equal(store.deaths, 1);
});

test('saves remember the starting set and the playthrough own changes', async () => {
  const rt = new Runtime(p, new NullRenderer());
  rt.persistentBase = { deaths: 3 };
  await rt.start();
  const save = JSON.parse(JSON.stringify(rt.save()));
  assert.deepEqual(save.persistentBase, { deaths: 3 });
  assert.equal(save.persistent.deaths, 4);
  const rt2 = new Runtime(p, new NullRenderer());
  await rt2.load(save);
  assert.deepEqual(rt2.persistentBase, { deaths: 3 });
  assert.equal(rt2.persistent.deaths, 4);
});

test('persistent names complete in set, if and text', () => {
  const labels = prefix => getCompletions(p, prefix).map(s => s.label);
  assert.ok(labels('  set ').includes('persistent.deaths'));
  assert.ok(labels('  set ').includes('persistent.'));
  assert.equal(labels('  if ').filter(l => l === 'persistent.deaths').length, 1);
  assert.equal(interpolate('Hi [persistent.name] [x]', { 'persistent.name': 'Al' }), 'Hi Al [x]');
});
