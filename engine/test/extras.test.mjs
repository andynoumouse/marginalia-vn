import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compile, Runtime, NullRenderer, normalizeMusicRoom, normalizeChapters, musicItems, chapterItems, chapterProblems, checkGame,
} from '../../dist/engine/src/index.js';

test('musicRoom and chapters normalize: strings, titles, repeats and junk', () => {
  assert.deepEqual(normalizeMusicRoom(['a', { track: 'b', title: 'B', unlock: 'f' }, 'a', {}, 3, null, { track: ' ' }]), [
    { track: 'a', title: 'a' }, { track: 'b', title: 'B', unlock: 'f' },
  ]);
  assert.deepEqual(normalizeChapters([{ label: 'start', title: 'One' }, 'two']), [
    { label: 'start', title: 'One' }, { label: 'two', title: 'two' },
  ]);
  assert.deepEqual(normalizeMusicRoom(undefined), []);
  assert.deepEqual(normalizeChapters({}), []);
});

test('entries unlock by being heard or reached, or by their own flag', () => {
  const heard = new Set(['a']), flags = new Set(['f']);
  const m = musicItems(['a', 'b', { track: 'c', unlock: 'f' }, { track: 'd', unlock: 'g' }], t => heard.has(t), f => flags.has(f));
  assert.deepEqual(m.map(i => i.unlocked), [true, false, true, false]);
  const c = chapterItems(['x', { label: 'y', unlock: 'f' }, 'z'], l => l === 'x', f => flags.has(f));
  assert.deepEqual(c.map(i => i.unlocked), [true, true, false]);
});

test('chapterProblems flags unknown labels; checkGame flags missing music room tracks', () => {
  const p = compile([{ file: 'a.vn', text: 'label start:\n  end\n' }]);
  assert.deepEqual(chapterProblems(['start', 'nope'], p.labels), ['chapters: no label "nope" in the scripts']);
  const index = { files: ['music/a.ogg', 'bg/x.png'] };
  const out = checkGame({ musicRoom: ['a', { track: 'gone' }] }, index);
  assert.equal(out.length, 1);
  assert.match(out[0].message, /musicRoom: no track "gone"/);
});

test('onLabel reports labels as the story enters them; startAt begins at a label; restore stays quiet', async () => {
  const src = 'set n = 0\nlabel start:\n  "one"\n  jump two\nlabel two:\n  set n += 1\n  "two"\n  end\nlabel three:\n  "three"\n  end\n';
  const p = compile([{ file: 'a.vn', text: src }]);
  const r = new NullRenderer();
  const rt = new Runtime(p, r);
  const seen = [];
  rt.onLabel = n => seen.push(n);
  await rt.start();
  assert.deepEqual(seen, ['start', 'two']);
  seen.length = 0;
  assert.equal(await rt.startAt('three'), true);
  assert.deepEqual(seen, ['three']);
  assert.equal(r.says.at(-1).text, 'three');
  assert.equal(await rt.startAt('nope'), false);
  seen.length = 0;
  await rt.restore({ step: 1 }, []);
  assert.deepEqual(seen.filter(n => n === 'start'), []); // replayed entries are not new
});
