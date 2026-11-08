import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UI_SCREENS, compile, resolveScreen, interpolate, screenStarter, DEFAULT_STAGE } from '../../dist/engine/src/index.js';

// What a screen reader is told about the built-in screens' controls (PI-5, PI-6, PC-5 of the November 2026 UX round).

const resolve = (name, vars, entries = {}, stage = DEFAULT_STAGE) => {
  const text = screenStarter(name, stage);
  const p = compile([{ file: 'park.vn', text: 'label start:\n  end\n' }, { file: `ui/${name}.vn`, text }]);
  return resolveScreen(p.screens[name], vars, { items: {}, entries, stage, text: (_id, raw, v) => interpolate(raw, v) });
};
const named = view => Object.fromEntries(view.parts.filter(p => p.kind === 'button' || p.kind === 'slider').map(p => [p.id ?? p.setting, p.name ?? null]));

const OPTIONS = { tab: 'audio', master: 0.8, music: 1, sound: 1, voice: 1, text_speed: 40, text_size: 1, box_opacity: 1, has_touch: true, has_fullscreen: false, text_sounds_word: 'On', reduce_motion_word: 'Off', captions_word: 'Off', announce_lines_word: 'Off', touch_gestures_word: 'On' };

test('options: a slider is named by the text beside it, a switch by its row and value', () => {
  const audio = named(resolve('options', OPTIONS));
  assert.equal(audio.master, 'Master volume');
  assert.equal(audio.music, 'Music');
  assert.equal(audio.voice, 'Voice');
  assert.equal(audio.text_sounds, 'Text sounds: On');
  const access = named(resolve('options', { ...OPTIONS, tab: 'access' }));
  assert.equal(access.text_size, 'Text size');
  assert.equal(access.box_opacity, 'Text box opacity');
  assert.equal(access.reduce_motion, 'Reduce motion: Off');
  assert.equal(access.captions, 'Sound captions: Off');
  assert.equal(access.announce_lines, 'Screen reader reads dialogue: Off');
  assert.equal(access.touch_gestures, 'Touch gestures: On');
  assert.equal(access.audio, null, 'a tab keeps its own label');
});

test('options: a select is named by its row and shows its value without the arrow', () => {
  const view = resolve('options', { ...OPTIONS, tab: 'game', auto_speed: 'normal', auto_speed_options: ['slow', 'normal'], skip: 'read', skip_options: ['read', 'all'], speaker_focus: 'none', has_languages: false, has_themes: false, has_voice_languages: false },
    { auto_speed_options: { slow: { label: 'Slow' }, normal: { label: 'Normal' } }, skip_options: { read: { label: 'Read text only' }, all: { label: 'All text' } } });
  const names = named(view);
  assert.equal(names.auto_speed, 'Auto speed: Normal');
  assert.equal(names.skip, 'Skip: Read text only');
});

test('portrait options: the label is above the control', () => {
  const view = resolve('options', { ...OPTIONS, tab: 'access' }, {}, { width: 1080, height: 1920 });
  const names = named(view);
  assert.equal(names.text_size, 'Text size');
  assert.equal(names.reduce_motion, 'Reduce motion: Off');
});

const slots = { 1: { title: 'Slot 1', heading: 'Slot 1', when: '', text: 'Empty', empty: true, thumb: '', removable: false, renamable: false },
  2: { title: 'Slot 2', heading: 'Slot 2', when: '11/8/26, 1:41 PM', text: 'Alice: Hello there', empty: false, thumb: '', removable: true, renamable: true } };
const SAVES = { mode: 'save', page: 'page1', pages: ['page1', 'pageauto'], slots: ['1', '2'], deleting: false, note: '', can_rename: true };
const pages = { page1: { name: '1', title: 'Page 1' }, pageauto: { name: 'A', title: 'Autosave' } };

for (const [label, stage] of [['landscape', DEFAULT_STAGE], ['portrait', { width: 1080, height: 1920 }]]) {
  test(`saves (${label}): slots say what is in them, delete and rename say whose, pages say what they are`, () => {
    const names = named(resolve('saves', SAVES, { slots, pages }, stage));
    assert.equal(names['1'], 'Slot 1, Empty');
    assert.equal(names['2'], 'Slot 2, 11/8/26, 1:41 PM, Alice: Hello there');
    assert.equal(names['2.remove'], 'Delete save: Slot 2');
    assert.equal(names['2.rename'], 'Rename save: Slot 2');
    assert.equal(names.page1, 'Page 1');
    assert.equal(names.pageauto, 'Autosave');
    assert.equal(names.done, null, 'Back already says what it is');
  });
}

test('a button with a long enough label keeps it, and a glyph button without a tooltip is left alone', () => {
  const p = compile([{ file: 's.vn', text: 'screen s:\n  button a at 0,0 size 200,80 "Go" tooltip "G"\n  button b at 0,100 size 200,80 "×"\n  button c at 0,200 size 200,80 "OK" tooltip "Confirm and go on"\nlabel start:\n  end\n' }]);
  const view = resolveScreen(p.screens.s, {}, { items: {}, text: (_id, raw, v) => interpolate(raw, v) });
  assert.deepEqual(named(view), { a: null, b: null, c: 'Confirm and go on' });
});

test('every built-in screen still resolves with names added', () => {
  for (const u of UI_SCREENS) {
    const p = compile([{ file: 'park.vn', text: 'label start:\n  end\n' }, { file: u.file, text: u.starter }]);
    assert.doesNotThrow(() => resolveScreen(p.screens[u.name], {}, { items: {}, text: (_id, raw, v) => interpolate(raw, v) }), u.name);
  }
});
