// Tests for the game shell modules that don't need a real browser: storage, saves, settings, blips, theme,
// rollback history and the editor palette's fuzzy match. Browser APIs are replaced by small stubs.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

class FakeStorage {
  map = new Map();
  broken = false;
  quota = Infinity; // longest value that can be stored
  get length() { if (this.broken) throw new Error('unavailable'); return this.map.size; }
  key(i) { return [...this.map.keys()][i] ?? null; }
  getItem(k) { if (this.broken) throw new Error('unavailable'); return this.map.get(k) ?? null; }
  setItem(k, v) {
    if (this.broken || String(v).length > this.quota) throw new Error('quota');
    this.map.set(k, String(v));
  }
  removeItem(k) { if (this.broken) throw new Error('unavailable'); this.map.delete(k); }
}
const timers = [];
globalThis.localStorage = new FakeStorage();
globalThis.window = { setTimeout: fn => { timers.push(fn); return timers.length; } };

const storage = await import('../../dist/preview/storage.js');
const saves = await import('../../dist/preview/saves.js');
const { loadSettings, saveSettings } = await import('../../dist/preview/settings.js');
const { Blips, BLIP_PRESETS } = await import('../../dist/preview/blips.js');
const { Timeline } = await import('../../dist/preview/timeline.js');
const { spatialNext, PadMapper, pickPad, oskPress, oskCaps, OSK_ROWS } = await import('../../dist/preview/input.js');
const { fuzzy, rank } = await import('../../dist/editor/palette.js');
const fetched = [];
globalThis.fetch = async url => { fetched.push(url); return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; };
globalThis.AudioContext = class {
  currentTime = 0; destination = {}; state = 'running';
  createGain() { return { gain: { setTargetAtTime() {}, setValueAtTime() {}, value: 1 }, connect() { return this; } }; }
  async decodeAudioData() { return { decoded: true }; }
};
const { AudioSystem } = await import('../../dist/preview/audio.js');
const { compile, Runtime, NullRenderer } = await import('../../dist/engine/src/index.js');

beforeEach(() => {
  globalThis.localStorage = new FakeStorage();
  timers.length = 0;
  storage.setGameId('test');
});

const save = (over = {}) => ({ at: { file: 'a.vn', line: 3 }, choices: [0, 'Sam'], name: 'Alice', text: 'Hi', time: 100, ...over });

// ---- storage ----

test('game ids: explicit id, else a slug of the title', () => {
  assert.equal(storage.gameId({ id: 'My Game' }), 'my-game');
  assert.equal(storage.gameId({ title: 'Evening in the Park!' }), 'evening-in-the-park');
  assert.equal(storage.gameId({}), 'game');
  assert.equal(storage.gameId({ title: '***' }), 'game');
});

test('storage is namespaced per game and survives being unavailable', () => {
  storage.setItem('k', 'one');
  storage.setGameId('other');
  assert.equal(storage.getItem('k'), null);
  storage.setItem('k', 'two');
  storage.setGameId('test');
  assert.equal(storage.getItem('k'), 'one');
  assert.deepEqual(storage.keysWith('k'), ['k']);
  localStorage.broken = true;
  assert.equal(storage.getItem('k'), null);
  assert.equal(storage.setItem('k', 'x'), false);
  assert.deepEqual(storage.keysWith('k'), []);
  assert.doesNotThrow(() => storage.removeItem('k'));
});

// ---- saves ----

test('save slots: write, read, delete; garbage reads as empty', () => {
  assert.equal(saves.readSave('1'), null);
  assert.equal(saves.writeSave('1', save()), true);
  assert.deepEqual(saves.readSave('1').choices, [0, 'Sam']); // menu indexes and typed answers
  saves.deleteSave('1');
  assert.equal(saves.readSave('1'), null);
  storage.setItem('save.2', '{not json');
  assert.equal(saves.readSave('2'), null);
  storage.setItem('save.3', JSON.stringify({ at: null, choices: [] }));
  assert.equal(saves.readSave('3'), null);
});

test('a save too big for storage is retried without its thumbnail', () => {
  localStorage.quota = 400;
  const thumb = 'x'.repeat(1000);
  assert.equal(saves.writeSave('1', save({ thumb })), true);
  assert.equal(saves.readSave('1').thumb, undefined);
  localStorage.quota = 5;
  assert.equal(saves.writeSave('2', save({ thumb })), false);
});

test('Continue uses the newest save of any slot', () => {
  assert.equal(saves.newestSave(), null);
  saves.writeSave('1', save({ time: 10, text: 'old' }));
  saves.writeSave('auto', save({ time: 30, text: 'newest' }));
  saves.writeSave('quick', save({ time: 20, text: 'mid' }));
  assert.equal(saves.newestSave().text, 'newest');
});

test('manual slot numbers run across pages', () => {
  assert.equal(saves.manualSlot(0, 0), '1');
  assert.equal(saves.manualSlot(0, saves.SLOTS_PER_PAGE - 1), String(saves.SLOTS_PER_PAGE));
  assert.equal(saves.manualSlot(1, 0), String(saves.SLOTS_PER_PAGE + 1));
});

test('choice saves rotate newest first, capped, and a repeated moment replaces itself', () => {
  const at = n => save({ at: { file: 'a.vn', line: n }, choices: [] });
  let ring = [];
  for (const n of [1, 2, 3, 4, 5, 6]) ring = saves.rotateChoiceSaves(ring, at(n), 5);
  assert.deepEqual(ring.map(s => s.at.line), [6, 5, 4, 3, 2]);
  ring = saves.rotateChoiceSaves(ring, at(4), 5); // rolled back to choice 4 and reached it again
  assert.deepEqual(ring.map(s => s.at.line), [4, 6, 5, 3, 2]);
  assert.deepEqual(saves.rotateChoiceSaves([null, at(1)], at(2), 5).map(s => s.at.line), [2, 1]);
});

test('writeChoiceSave fills the choice slots and Continue still finds the newest', () => {
  for (const n of [1, 2, 3]) saves.writeChoiceSave(save({ at: { file: 'a.vn', line: n }, time: 500 + n }), 2);
  assert.equal(saves.readSave('choice.1').at.line, 3);
  assert.equal(saves.readSave('choice.2').at.line, 2);
  assert.equal(saves.readSave('choice.3'), null);
  assert.equal(saves.newestSave().time, 503);
});

test('saveVersion: saves under a lower version (or none) are outdated, unset means never', () => {
  assert.equal(saves.normalizeSaveVersion(3.7), 3);
  for (const bad of [undefined, 'x', -2, NaN, 0]) assert.equal(saves.normalizeSaveVersion(bad), 0);
  assert.equal(saves.isOutdatedSave({}, 0), false);
  assert.equal(saves.isOutdatedSave({}, 1), true);
  assert.equal(saves.isOutdatedSave({ saveVersion: 1 }, 2), true);
  assert.equal(saves.isOutdatedSave({ saveVersion: 2 }, 2), false);
  assert.equal(saves.isOutdatedSave({ saveVersion: 3 }, 2), false);
});

test('choiceSaves from game.json sets the ring size, clamped, and shrinking clears leftovers', () => {
  saves.setChoiceSlots(3);
  assert.equal(saves.choiceSlotCount(), 3);
  saves.setChoiceSlots(500);
  assert.equal(saves.choiceSlotCount(), saves.MAX_CHOICE_SLOTS);
  saves.setChoiceSlots('x');
  assert.equal(saves.choiceSlotCount(), saves.CHOICE_SLOTS);
  saves.setChoiceSlots(4);
  for (const n of [1, 2, 3, 4, 5]) saves.writeChoiceSave(save({ at: { file: 'a.vn', line: n }, time: 600 + n }));
  assert.equal(saves.readSave('choice.4').at.line, 2);
  assert.equal(saves.readSave('choice.5'), null);
  saves.setChoiceSlots(2);
  saves.writeChoiceSave(save({ at: { file: 'a.vn', line: 6 }, time: 606 }));
  assert.equal(saves.readSave('choice.3'), null);
  saves.setChoiceSlots(undefined);
});

test('read lines persist for skipping; keys fall back to file:line', () => {
  const key = saves.SeenLines.key;
  assert.equal(key({ id: 'ab12', src: { file: 'a.vn', line: 9 } }), 'ab12');
  assert.equal(key({ id: null, src: { file: 'a.vn', line: 9 } }), 'a.vn:9');
  const seen = new saves.SeenLines();
  assert.equal(seen.has('ab12'), false);
  seen.add('ab12');
  assert.equal(seen.has('ab12'), true);
  timers.at(-1)(); // the debounced write
  assert.equal(new saves.SeenLines().has('ab12'), true);
});

test('persistent sets (unlocks, gallery images) reload', () => {
  const a = new saves.PersistentSet('unlocks');
  a.add('good_ending');
  a.add('good_ending');
  assert.deepEqual(new saves.PersistentSet('unlocks').values(), ['good_ending']);
  storage.setItem('broken', 'nope');
  assert.deepEqual(new saves.PersistentSet('broken').values(), []);
});

test('a save carries typed answers: a fresh runtime resumes after an input', async () => {
  const text = 'label start:\n  input who "Name?"\n  menu:\n    "A":\n      "a [who]"\n    "B":\n      "b [who]"\n  "end"\n';
  const p = compile([{ file: 't.vn', text }]);
  const r = new NullRenderer();
  r.answerer = () => 'Sam';
  r.chooser = () => 1;
  const rt = new Runtime(p, r);
  await rt.start();
  saves.writeSave('1', save({ at: { file: 't.vn', line: 8 }, choices: rt.choices }));
  const loaded = saves.readSave('1');
  const r2 = new NullRenderer();
  const rt2 = new Runtime(p, r2);
  await rt2.restore(loaded.at, loaded.choices);
  assert.equal(r2.inputs.length, 0);
  assert.equal(rt2.vars.who, 'Sam');
  assert.equal(r2.says[0].text, 'end');
});

// ---- settings ----

test('settings: defaults, stored values win, bad data is ignored', () => {
  assert.equal(loadSettings().textSpeed, 45);
  saveSettings({ ...loadSettings(), textSpeed: 80, lang: 'fi' });
  assert.equal(loadSettings().textSpeed, 80);
  assert.equal(loadSettings().lang, 'fi');
  assert.equal(loadSettings().master, 0.8); // missing keys keep defaults
  storage.setItem('settings', JSON.stringify({ autoDelay: 0 }));
  assert.equal(loadSettings().autoDelay, 1.5); // 0 used to mean "off"
  storage.setItem('settings', '{oops');
  assert.equal(loadSettings().textSpeed, 45);
});

test('settings: accessibility defaults, and reduced motion follows the system until chosen', () => {
  const d = loadSettings();
  assert.deepEqual([d.textSize, d.boxOpacity, d.reduceMotion], [1, 1, false]);
  globalThis.matchMedia = q => ({ matches: q.includes('reduce') });
  assert.equal(loadSettings().reduceMotion, true);
  saveSettings({ ...loadSettings(), reduceMotion: false, textSize: 1.3 });
  assert.equal(loadSettings().reduceMotion, false); // the player's choice wins
  assert.equal(loadSettings().textSize, 1.3);
  delete globalThis.matchMedia;
});

// ---- blips ----

function blipRig(sounds = []) {
  const calls = [];
  const audio = {
    has: (_kind, name) => sounds.includes(name),
    sound: async (name, volume, rate) => { calls.push({ sample: name, volume, rate }); },
    tone: (synth, hz, len, volume) => { calls.push({ synth, hz, len, volume }); },
  };
  return { blips: new Blips(audio), calls };
}
let clock = 0;
performance.now = () => clock;
const type = (play, text, stepMs = 100) => { for (const ch of text) { clock += stepMs; play(ch); } };

test('blips: silent when disabled, "none" or unknown; custom voices beat presets', () => {
  const { blips } = blipRig();
  assert.equal(blips.forLine(undefined), null);
  assert.equal(blips.forLine('none'), null);
  const warn = console.warn;
  console.warn = () => {};
  assert.equal(blips.forLine('nonexistent'), null);
  console.warn = warn;
  blips.enabled = false;
  assert.equal(blips.forLine('high'), null);
  blips.enabled = true;
  blips.voices.high = { synth: 'sine', pitch: 100 };
  assert.equal(blips.voice('high').pitch, 100);
  assert.equal(blips.voice('low'), BLIP_PRESETS.low);
});

test('blips: letters and digits only, throttled by interval, every Nth letter', () => {
  const { blips, calls } = blipRig();
  blips.voices.t = { synth: 'square', pitch: 440, interval: 50, every: 2 };
  type(blips.forLine('t'), 'ab, 1!'); // letters and digits: a b 1 -> every 2nd: a, 1
  assert.equal(calls.length, 2);
  assert.ok(calls.every(c => c.hz === 440));
  calls.length = 0;
  blips.voices.fast = { synth: 'square', interval: 80 };
  type(blips.forLine('fast'), 'abcd', 30); // 30 ms apart, 80 ms minimum: the first, then one after 90 ms
  assert.equal(calls.length, 2);
});

test('blips: vowel mode skips consonants and steps pitch per vowel', () => {
  const { blips, calls } = blipRig();
  blips.voices.v = { synth: 'sine', pitch: 400, mode: 'vowels', interval: 0 };
  type(blips.forLine('v'), 'bad');
  assert.equal(calls.length, 1); // only the a
  type(blips.forLine('v'), 'e'); // e is 3 semitones above a
  assert.ok(Math.abs(calls[1].hz / 400 - 2 ** (3 / 12)) < 1e-9);
  type(blips.forLine('v'), 'ä');
  assert.equal(calls.length, 3); // accented vowels count
});

test('blips: samples play by name or per vowel; a sound asset works as a voice', () => {
  const { blips, calls } = blipRig(['beep']);
  type(blips.forLine('beep'), 'x');
  assert.equal(calls[0].sample, 'beep');
  blips.voices.s = { vowels: { a: 'va' }, sound: 'other', mode: 'letters', interval: 0 };
  type(blips.forLine('s'), 'ab');
  assert.equal(calls[1].sample, 'va');
  assert.equal(calls[1].rate, 1); // a dedicated sample plays as recorded
  assert.equal(calls[2].sample, 'other');
});

// ---- rollback history ----

test('rollback history: back returns the previous moment; the same step replaces itself', () => {
  const t = new Timeline();
  const m = (step, text) => ({ step, choices: [], line: { name: null, color: null, text } });
  assert.equal(t.back(), null);
  t.push(m(0, 'a'));
  assert.equal(t.back(), null); // nothing before the first line
  t.push(m(0, 'a')); t.push(m(1, 'b')); t.push(m(2, 'c'));
  assert.equal(t.back().step, 1); // drops c, returns b
  t.push(m(1, 'b')); // shown again after the rollback: not duplicated
  assert.deepEqual(t.lines().map(l => l.text), ['a', 'b']);
  t.push({ step: 2, choices: [1] }); // a choice has no line text
  assert.deepEqual(t.lines().map(l => l.text), ['a', 'b']);
  assert.equal(t.recent().length, 3);
  t.clear();
  assert.equal(t.recent().length, 0);
});

test('timeline backTo: a history line rolls back over every moment after it, choices included', () => {
  const t = new Timeline();
  const m = (step, text) => ({ step, choices: [], line: { name: null, color: null, text } });
  t.push(m(0, 'a')); t.push(m(1, 'b')); t.push({ step: 2, choices: [0] }); t.push(m(3, 'c')); t.push(m(4, 'd'));
  assert.equal(t.atLine(), true);
  assert.equal(t.backTo(3), null); // 'd' is on screen
  assert.equal(t.backTo(9), null);
  assert.equal(t.backTo(-1), null);
  assert.equal(t.backTo(1).step, 1); // 'b': the choice, 'c' and 'd' go too
  assert.deepEqual(t.lines().map(l => l.text), ['a']);
  t.push(m(1, 'b')); t.push({ step: 2, choices: [1] });
  assert.equal(t.atLine(), false); // a menu after 'b': going back to 'b' is a real step
  assert.equal(t.backTo(1).step, 1);
});

test('rollback history is capped', () => {
  const t = new Timeline();
  for (let i = 0; i < 700; i++) t.push({ step: i, choices: [] });
  assert.equal(t.recent().length, 150);
  assert.equal(t.back().step, 698);
});

// ---- editor palette ----

test('palette fuzzy match: in order, case-insensitive, prefers runs and word starts', () => {
  assert.equal(fuzzy('zz', 'park.vn'), null);
  assert.equal(fuzzy('pv', 'park.vn').hits.length, 2);
  assert.ok(fuzzy('park', 'park.vn').score > fuzzy('park', 'a_p_a_r_k.vn').score);
  assert.ok(fuzzy('gl', 'Go to Label').score > fuzzy('gl', 'xgxl').score);
  assert.notEqual(fuzzy('PARK', 'park.vn'), null);
});

test('palette rank: filters, sorts by score, keeps order on ties and for empty queries', () => {
  const files = ['scene2.vn', 'park.vn', 'game2.vn'];
  assert.deepEqual(rank(files, '', f => f).map(r => r.entry), files);
  assert.deepEqual(rank(files, 'park', f => f).map(r => r.entry), ['park.vn']);
  assert.deepEqual(rank(files, '2', f => f).map(r => r.entry), ['game2.vn', 'scene2.vn']); // shorter names first
  assert.deepEqual(rank(['b2.vn', 'a2.vn'], '2', f => f).map(r => r.entry), ['b2.vn', 'a2.vn']); // equal scores keep their order
});

// ---- keyboard and gamepad navigation ----

const box = (x, y, w = 100, h = 40) => ({ x, y, w, h });

test('spatial focus: a column moves up and down, a grid moves in four directions', () => {
  const column = [box(0, 0), box(0, 60), box(0, 120)];
  assert.equal(spatialNext(column, 0, 'down'), 1);
  assert.equal(spatialNext(column, 1, 'down'), 2);
  assert.equal(spatialNext(column, 2, 'down'), -1); // the end: stay
  assert.equal(spatialNext(column, 1, 'up'), 0);
  assert.equal(spatialNext(column, 1, 'left'), -1);
  const grid = [box(0, 0), box(150, 0), box(0, 60), box(150, 60)]; // 2 x 2
  assert.equal(spatialNext(grid, 0, 'right'), 1);
  assert.equal(spatialNext(grid, 0, 'down'), 2);
  assert.equal(spatialNext(grid, 3, 'left'), 2);
  assert.equal(spatialNext(grid, 3, 'up'), 1);
});

test('spatial focus: prefers the aligned neighbour, and finds the next row from a wide button', () => {
  const layout = [box(0, 0, 400), box(0, 60), box(300, 60), box(200, 120, 200)];
  assert.equal(spatialNext(layout, 0, 'down'), 1);       // roughly below the middle: the left one is nearer to the centre
  assert.equal(spatialNext(layout, 2, 'down'), 3);
  assert.equal(spatialNext(layout, 1, 'right'), 2);
  assert.equal(spatialNext(layout, 5, 'down'), -1);       // unknown start
  assert.equal(spatialNext([box(0, 0), box(500, 5)], 0, 'down'), -1); // off to the side is not "below"
});

const pad = (pressed = [], axes = [0, 0]) => {
  const buttons = Array(16).fill(false);
  for (const n of pressed) buttons[n] = true;
  return { buttons, axes };
};
const A = 0, B = 1, X = 2, Y = 3, LB = 4, RB = 5, SELECT = 8, START = 9, UP = 12, DOWN = 13, LEFT = 14, RIGHT = 15;

test('gamepad in a menu: d-pad and stick move, A confirms, B and Start cancel, shoulders switch tabs', () => {
  const m = new PadMapper();
  const menu = { menu: true };
  assert.deepEqual(m.update(pad(), 0, menu), []);
  assert.deepEqual(m.update(pad([DOWN]), 10, menu), ['down']);
  assert.deepEqual(m.update(pad([DOWN]), 20, menu), []); // held: not again yet
  assert.deepEqual(m.update(pad([]), 30, menu), []);
  assert.deepEqual(m.update(pad([], [0.9, 0]), 40, menu), ['right']);
  assert.deepEqual(m.update(pad([], [0.3, 0.3]), 50, menu), []); // dead zone
  assert.deepEqual(m.update(pad([A]), 60, menu), ['confirm']);
  assert.deepEqual(m.update(pad([B]), 70, menu), ['cancel']);
  assert.deepEqual(m.update(pad([START]), 80, menu), ['cancel']);
  assert.deepEqual(m.update(pad([LB, RB]), 90, menu), ['tabPrev', 'tabNext']);
});

test('gamepad: a held direction repeats after a delay, then steadily', () => {
  const m = new PadMapper();
  const menu = { menu: true };
  const times = [];
  for (let t = 0; t <= 1000; t += 16) if (m.update(pad([DOWN]), t, menu).length) times.push(t);
  assert.equal(times[0], 0);
  assert.ok(times[1] >= 400 && times[1] < 420, `first repeat at ${times[1]}`);
  assert.ok(times.length >= 5 && times.length <= 9, `${times.length} actions in 1 s`);
  assert.deepEqual(m.update(pad([]), 1100, menu), []);
  assert.deepEqual(m.update(pad([DOWN]), 1110, menu), ['down']); // a new press starts over
});

test('gamepad while playing: A advances, up or LB rolls back, X auto, Y hide, Select history, B pauses, RB skips while held', () => {
  const m = new PadMapper();
  const game = { menu: false };
  assert.deepEqual(m.update(pad([A]), 0, game), ['confirm']);
  assert.deepEqual(m.update(pad([]), 10, game), []);
  assert.deepEqual(m.update(pad([DOWN]), 20, game), ['confirm']);
  assert.deepEqual(m.update(pad([]), 30, game), []);
  assert.deepEqual(m.update(pad([UP]), 40, game), ['rollback']);
  assert.deepEqual(m.update(pad([LB]), 50, game), ['rollback']);
  assert.deepEqual(m.update(pad([X]), 60, game), ['auto']);
  assert.deepEqual(m.update(pad([Y]), 70, game), ['hide']);
  assert.deepEqual(m.update(pad([SELECT]), 80, game), ['history']);
  assert.deepEqual(m.update(pad([11]), 85, game), ['hud']); // right stick click focuses the HUD
  assert.deepEqual(m.update(pad([B]), 90, game), ['pause']);
  assert.deepEqual(m.update(pad([START]), 100, game), ['pause']);
  assert.deepEqual(m.update(pad([RB]), 110, game), ['skipOn']);
  assert.deepEqual(m.update(pad([RB]), 120, game), []);
  assert.deepEqual(m.update(pad([]), 130, game), ['skipOff']);
  assert.deepEqual(m.update(pad([LEFT]), 140, game), []); // nothing on left in the game
});

test('on-screen keyboard: the first key replaces the default, names start with a capital', () => {
  let k = { value: 'Sam', shift: false, fresh: true };
  assert.equal(oskCaps(k), true);
  k = oskPress(k, 'a', 12);
  assert.deepEqual(k, { value: 'A', shift: false, fresh: false });
  k = oskPress(k, 'n', 12);
  k = oskPress(k, 'n', 12);
  assert.equal(k.value, 'Ann'); // lower case after the first letter
  k = oskPress(k, 'shift', 12);
  k = oskPress(k, 'a', 12);
  assert.equal(k.value, 'AnnA'); // shift is one letter only
  assert.equal(oskCaps(k), false);
  k = oskPress(oskPress(k, 'space', 12), 'ä', 12);
  assert.equal(k.value, 'AnnA ä');
});

test('on-screen keyboard: backspace, clearing the default, and the length limit', () => {
  assert.equal(oskPress({ value: 'Sam', shift: false, fresh: true }, 'back', 12).value, ''); // clears the default at once
  let k = { value: 'Hi', shift: false, fresh: false };
  assert.equal(oskPress(k, 'back', 12).value, 'H');
  assert.equal(oskPress({ value: '', shift: false, fresh: false }, 'back', 12).value, '');
  k = { value: 'abc', shift: false, fresh: false };
  assert.equal(oskPress(k, 'd', 3).value, 'abc'); // full
  assert.equal(oskPress({ value: 'x', shift: false, fresh: false }, '\u{1F600}', 2).value, 'x\u{1F600}'); // counted by character, not UTF-16 unit
  assert.ok(OSK_ROWS.join('').includes('å') && OSK_ROWS.join('').includes('ö') && OSK_ROWS.join('').includes('ä'));
});

test('gamepad in a menu: X is backspace, Y is shift (on-screen keyboard)', () => {
  const m = new PadMapper();
  assert.deepEqual(m.update(pad([X]), 0, { menu: true }), ['backspace']);
  assert.deepEqual(m.update(pad([Y]), 10, { menu: true }), ['shift']);
});

// ---- audio loading ----

const audioFiles = [['music/theme.ogg', 1], ['music/battle.ogg', 1], ['sound/door.wav', 1], ['sound/step.wav', 1], ['sound/beep.wav', 1], ['bg/park.png', 1]]
  .map(([file, v]) => ({ file, v }));

test('audio: nothing is fetched until needed; prefetch loads a file once', async () => {
  fetched.length = 0;
  const audio = new AudioSystem();
  audio.setAssets(audioFiles);
  assert.deepEqual(fetched, []); // listing the files costs nothing
  assert.equal(audio.has('music', 'theme'), true);
  assert.equal(audio.has('music', 'park'), false); // images are not audio
  audio.prefetch('music', 'theme');
  audio.prefetch('music', 'theme');
  audio.prefetch('music', 'missing');
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(fetched, ['assets/music/theme.ogg?v=1']);
});

test('audio: sounds load in the background, the named ones first; a new asset list stops the old run', async () => {
  fetched.length = 0;
  const audio = new AudioSystem();
  audio.setAssets(audioFiles);
  audio.prefetchSounds(['beep', 'high']); // "high" is a synth preset, not a file
  await new Promise(r => setTimeout(r, 400));
  assert.deepEqual(fetched.map(u => u.split('/').pop().split('?')[0]), ['beep.wav', 'door.wav', 'step.wav']);
  assert.ok(!fetched.some(u => u.includes('music/')), 'music stays unloaded');
  fetched.length = 0;
  audio.prefetchSounds();
  audio.setAssets([]); // hot reload with a new list: the running prefetch ends
  await new Promise(r => setTimeout(r, 400));
  assert.ok(fetched.length <= 1);
});

test('audio: stale decoded files are dropped when the asset list changes', async () => {
  fetched.length = 0;
  const audio = new AudioSystem();
  audio.setAssets(audioFiles);
  audio.prefetch('music', 'theme');
  await new Promise(r => setTimeout(r, 0));
  audio.setAssets(audioFiles.map(a => (a.file === 'music/theme.ogg' ? { ...a, v: 2 } : a))); // the file was edited
  audio.prefetch('music', 'theme');
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(fetched, ['assets/music/theme.ogg?v=1', 'assets/music/theme.ogg?v=2']);
  assert.equal(audio.buffers.size, 1);
});

test('gamepad detection: prefers a connected pad with the standard layout, ignores empty slots', () => {
  const pad = (index, mapping, connected = true) => ({ index, mapping, connected, id: `pad${index}` });
  assert.equal(pickPad([null, null, null, null]), undefined);
  assert.equal(pickPad([pad(0, '', true), pad(1, 'standard')]).index, 1);
  assert.equal(pickPad([pad(0, 'standard', false), pad(1, '')]).index, 1);
  assert.equal(pickPad([null, pad(1, 'standard')]).index, 1);
});

test('settings: timed choices default to normal, persist, and cycle through normal, extended and off', () => {
  assert.equal(loadSettings().timedChoices, 'normal');
  saveSettings({ ...loadSettings(), timedChoices: 'extended' });
  assert.equal(loadSettings().timedChoices, 'extended');
  saveSettings({ ...loadSettings(), timedChoices: 'off' });
  assert.equal(loadSettings().timedChoices, 'off');
});
