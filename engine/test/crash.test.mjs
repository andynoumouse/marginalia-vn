import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, Runtime, NullRenderer, crashReport, errorText, CRASH_LINES } from '../../dist/engine/src/index.js';

const p = compile([{ file: 'a.vn', text: 'label start:\n  "One."\n  "Two."\n  "Three."' }]);

/** A renderer whose say() fails on the line with `text`. */
class FailingRenderer extends NullRenderer {
  constructor(text) { super(); this.failOn = text; }
  async say(ev) {
    if (ev.text === this.failOn) throw new TypeError('boom');
    return super.say(ev);
  }
}

test('an error in the story goes to onError with the line it was on, and the run stops', async () => {
  const rt = new Runtime(p, new FailingRenderer('Two.'));
  const seen = [];
  rt.onError = (e, at) => seen.push({ e, at });
  await rt.start(); // resolves: the error is handed over, not thrown
  assert.equal(seen.length, 1);
  assert.equal(seen[0].e.message, 'boom');
  assert.deepEqual(seen[0].at, { file: 'a.vn', line: 3 });
  // nothing after it ran, and a new start works
  const r = new NullRenderer();
  const rt2 = new Runtime(p, r);
  rt2.onError = () => assert.fail('no error');
  await rt2.start();
  assert.deepEqual(r.says.map(s => s.text), ['One.', 'Two.', 'Three.']);
});

test('without onError the error rejects the run as before', async () => {
  const rt = new Runtime(p, new FailingRenderer('One.'));
  await assert.rejects(rt.start(), /boom/);
});

test('a run replaced before it fails reports nothing', async () => {
  let release;
  class Slow extends NullRenderer {
    async say(ev) {
      if (ev.text === 'One.') { await new Promise(r => { release = r; }); throw new Error('late'); }
      return super.say(ev);
    }
  }
  const rt = new Runtime(p, new Slow());
  const errors = [];
  rt.onError = e => errors.push(e);
  const first = rt.start();
  await new Promise(r => setImmediate(r));
  rt.stop(); // the shell went back to the title meanwhile
  release();
  await first;
  assert.deepEqual(errors, []);
});

test('errorText names the error kind except for a plain Error', () => {
  assert.equal(errorText(new TypeError('x is undefined')), 'TypeError: x is undefined');
  assert.equal(errorText(new Error('Unknown label')), 'Unknown label');
  assert.equal(errorText('just text'), 'just text');
  assert.equal(errorText({ code: 1 }), '{"code":1}');
  assert.equal(errorText(new Error('')), '(no message)');
});

test('crashReport lists the facts, the last lines and the start of the stack', () => {
  const error = new TypeError('x is undefined');
  error.stack = 'TypeError: x is undefined\n    at a (preview.js:1:2)\n    at b (preview.js:3:4)';
  const lines = Array.from({ length: CRASH_LINES + 2 }, (_, i) => `Mina: line ${i}\n  wrapped`);
  const text = crashReport({
    error, at: { file: 'park.vn', line: 42 }, engine: '0.3.0', game: 'Rainy Day', gameVersion: '1.2', lines,
    agent: 'TestBrowser/1', time: new Date('2026-11-03T10:00:00Z'),
  });
  assert.equal(text, [
    'Game: Rainy Day 1.2',
    'Engine: Marginalia 0.3.0',
    'Where: park.vn:42',
    'Error: TypeError: x is undefined',
    'Browser: TestBrowser/1',
    'Time: 2026-11-03T10:00:00.000Z',
    '',
    'Last lines:',
    ...lines.slice(-CRASH_LINES).map(l => `  ${l.replace(/\s+/g, ' ')}`),
    '',
    'Stack:',
    '  at a (preview.js:1:2)',
    '  at b (preview.js:3:4)',
  ].join('\n'));
});

test('crashReport fills in what is unknown', () => {
  const text = crashReport({ error: 'bad', at: null });
  assert.equal(text, 'Game: Untitled\nEngine: Marginalia unknown\nWhere: before the first line\nError: bad');
});
