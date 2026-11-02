import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compile, Runtime, NullRenderer, normalizeMusicRoom, normalizeChapters, musicItems, chapterItems, chapterProblems, checkGame,
  normalizeAchievements, achievementItems, achievementToToast, achievementToastSettings, achievementProblems,
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

test('achievements normalize: flags, defaults, repeats and junk', () => {
  assert.deepEqual(normalizeAchievements(['a', { unlock: 'b', title: 'B', description: 'Do b.', icon: 'ic', hidden: true, ending: true, toast: false }, 'a', {}, 3, null, { title: 'no flag' }]), [
    { unlock: 'a', title: 'a', description: '', icon: '', hidden: false, ending: false, toast: true },
    { unlock: 'b', title: 'B', description: 'Do b.', icon: 'ic', hidden: true, ending: true, toast: false },
  ]);
  assert.deepEqual(normalizeAchievements({}), []);
  const flags = new Set(['b']);
  assert.deepEqual(achievementItems(['a', 'b'], f => flags.has(f)).map(i => i.unlocked), [false, true]);
});

test('achievementToToast: only a new, toasting achievement pops up', () => {
  const list = ['a', { unlock: 'quiet', toast: false }];
  assert.equal(achievementToToast(list, 'a', false).unlock, 'a');
  assert.equal(achievementToToast(list, 'a', true), null); // held already
  assert.equal(achievementToToast(list, 'quiet', false), null);
  assert.equal(achievementToToast(list, 'other', false), null);
});

test('achievementToast settings fall back to defaults; problems name unknown flags and bad settings', () => {
  assert.deepEqual(achievementToastSettings(undefined), { position: 'topright', seconds: 4, sound: '' });
  assert.deepEqual(achievementToastSettings({ position: 'bottom', seconds: 2.5, sound: 'ding' }), { position: 'bottom', seconds: 2.5, sound: 'ding' });
  assert.deepEqual(achievementToastSettings({ position: 'middle', seconds: -1 }), { position: 'topright', seconds: 4, sound: '' });
  assert.deepEqual(achievementProblems(['a', 'b'], undefined, new Set(['a'])), ['achievements: no script runs "unlock b"']);
  assert.equal(achievementProblems([], { position: 'middle', seconds: 0 }, new Set()).length, 2);
  assert.equal(achievementProblems([], 'loud', new Set()).length, 1);
});

test('checkGame flags missing achievement icons and toast sound', () => {
  const index = { files: ['ui/ic_key.png', 'sound/ding.ogg'] };
  assert.deepEqual(checkGame({ achievements: [{ unlock: 'a', icon: 'ic_key' }], achievementToast: { sound: 'ding' } }, index), []);
  const out = checkGame({ achievements: [{ unlock: 'a', icon: 'gone' }, 'b'], achievementToast: { sound: 'boom' } }, index).map(d => d.message);
  assert.deepEqual(out, ['achievements: no icon "gone" in assets/ui', 'achievementToast.sound: no sound "boom" in assets/sound']);
});
