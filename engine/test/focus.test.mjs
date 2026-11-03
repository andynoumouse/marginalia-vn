// Speaker focus: who is lit while someone speaks, game.json "speakerFocus", `focus on/off` and `define ... focus=off`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyToState, checkGame, compile, emptyState, focusLevels, raisedSpeaker, speakerFocusProblems, speakerFocusSettings } from '../../dist/engine/src/index.js';

const FOCUS = { dim: 0.4, fade: 0.2, front: false, offstage: 'lit' };
const levels = (onStage, speaker, focus = FOCUS, alwaysLit = () => false) => Object.fromEntries(focusLevels(onStage, speaker, focus, alwaysLit));

test('speakerFocus settings: off when absent, defaults for true and bad values', () => {
  assert.equal(speakerFocusSettings(undefined), null);
  assert.equal(speakerFocusSettings(false), null);
  assert.equal(speakerFocusSettings('yes'), null);
  assert.deepEqual(speakerFocusSettings(true), { dim: 0.35, fade: 0.2, front: false, offstage: 'lit' });
  assert.deepEqual(speakerFocusSettings({ dim: 0.5, fade: 0, front: true, offstage: 'dim' }), { dim: 0.5, fade: 0, front: true, offstage: 'dim' });
  assert.deepEqual(speakerFocusSettings({ dim: 2, fade: -1, front: 'yes', offstage: 'dark' }), { dim: 0.35, fade: 0.2, front: false, offstage: 'lit' });
});

test('speakerFocus problems are warned about in game.json', () => {
  assert.deepEqual(speakerFocusProblems(undefined), []);
  assert.deepEqual(speakerFocusProblems(true), []);
  assert.deepEqual(speakerFocusProblems({ dim: 0.3 }), []);
  assert.deepEqual(speakerFocusProblems(3), ['speakerFocus needs an object like { "dim": 0.35, "fade": 0.2 }']);
  assert.deepEqual(speakerFocusProblems({ dim: 1.5, fade: 'x', front: 1, offstage: 'dark', fast: true }), [
    'speakerFocus.dim needs a number from 0 to 1', 'speakerFocus.fade needs a number of seconds (0 or more)',
    'speakerFocus.front needs true or false', 'speakerFocus.offstage must be one of lit, dim',
    'speakerFocus has no option "fast" (use dim, fade, front, offstage)',
  ]);
  const text = '{\n  "title": "T",\n  "speakerFocus": { "dim": 3 }\n}';
  assert.deepEqual(checkGame(JSON.parse(text), { files: [] }, text).map(d => `${d.line} ${d.message}`), ['3 speakerFocus.dim needs a number from 0 to 1']);
});

test('the speaker is lit and the others dimmed', () => {
  assert.deepEqual(levels(['al', 'bo', 'cy'], 'bo'), { al: 0.6, bo: 1, cy: 0.6 });
  assert.deepEqual(levels(['al'], 'al'), { al: 1 });
  assert.deepEqual(levels([], 'al'), {});
});

test('a speaker off stage (or narration) lights or dims everyone as offstage says', () => {
  assert.deepEqual(levels(['al', 'bo'], null), { al: 1, bo: 1 });
  assert.deepEqual(levels(['al', 'bo'], 'me'), { al: 1, bo: 1 });
  assert.deepEqual(levels(['al', 'bo'], null, { ...FOCUS, offstage: 'dim' }), { al: 0.6, bo: 0.6 });
  assert.deepEqual(levels(['al', 'bo'], 'me', { ...FOCUS, offstage: 'dim' }), { al: 0.6, bo: 0.6 });
});

test('focus off (null) lights everyone; focus=off characters are always lit', () => {
  assert.deepEqual(levels(['al', 'bo'], 'al', null), { al: 1, bo: 1 });
  assert.deepEqual(levels(['al', 'bo', 'cy'], 'al', FOCUS, c => c === 'bo'), { al: 1, bo: 1, cy: 0.6 });
  assert.deepEqual(levels(['al', 'bo'], null, { ...FOCUS, offstage: 'dim' }, c => c === 'bo'), { al: 0.6, bo: 1 });
});

test('front raises a speaker who is on stage, only when asked', () => {
  assert.equal(raisedSpeaker(['al', 'bo'], 'al', FOCUS), null);
  assert.equal(raisedSpeaker(['al', 'bo'], 'al', { ...FOCUS, front: true }), 'al');
  assert.equal(raisedSpeaker(['al', 'bo'], 'me', { ...FOCUS, front: true }), null);
  assert.equal(raisedSpeaker(['al', 'bo'], null, { ...FOCUS, front: true }), null);
  assert.equal(raisedSpeaker(['al', 'bo'], 'al', null), null);
});

const program = text => compile([{ file: 't.vn', text }]);

test('focus on/off parse to a visual op and are kept in the display state across scenes', () => {
  const p = program('label start:\n  focus off\n  scene park\n  focus on nowait\n');
  assert.deepEqual(p.diagnostics, []);
  const ops = p.ops.filter(o => o.op === 'focus');
  assert.deepEqual(ops.map(({ op, on, nowait }) => ({ op, on, nowait })), [{ op: 'focus', on: false, nowait: undefined }, { op: 'focus', on: true, nowait: true }]);
  const s = emptyState();
  applyToState(s, ops[0]);
  assert.equal(s.focus, false);
  applyToState(s, p.ops.find(o => o.op === 'scene'));
  assert.equal(s.focus, false);
  applyToState(s, ops[1]);
  assert.equal('focus' in s, false);
  assert.match(program('label start:\n  focus maybe\n').diagnostics[0].message, /Use: focus on {2}\| {2}focus off/);
  assert.match(program('label start:\n  focus\n').diagnostics[0].message, /Use: focus on/);
});

test('define ... focus=off opts a character out', () => {
  const p = program('define al "Al" focus=off\ndefine bo "Bo" focus=on\nlabel start:\n  "x"\n');
  assert.deepEqual(p.diagnostics, []);
  assert.equal(p.characters.al.focus, false);
  assert.equal('focus' in p.characters.bo, false);
  assert.match(program('define al "Al" focus=dim\nlabel start:\n  "x"\n').diagnostics[0].message, /focus= is on or off/);
});
