import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  compile, Runtime, NullRenderer, Locale, assignIds, existingIds, parseExpr, evalExpr, parseRich, interpolate, getCompletions,
  COMMAND_WORDS, QUICK_ITEMS, checkAssets, checkGame, parseVarValue, parseHelp, helpTopicAt, rigHelpTopicAt, buildOutline, outlineCrossings, backEdgeLanes, fitView, zoomAt, centerOn, searchOutline, MIN_SCALE, MAX_SCALE, normalizeSplash, titleFade,
} from '../../dist/engine/src/index.js';

const raw = readFileSync(new URL('../../games/sample/script/park.vn', import.meta.url), 'utf8');
// park.vn jumps into town.vn, so single-file tests get a stand-in for that label
const townStub = '\nlabel town_square:\n  end\n';
// the sample ships with ids; strip them so the tests control id assignment
const sample =raw.replace(/ #[A-Za-z0-9]{4,8}(?=:?$)/gm, '') + townStub;
const errors = p => p.diagnostics.filter(d => d.severity === 'error');

test('expressions', () => {
  const v = { a: 3, name: 'Al' };
  assert.equal(evalExpr(parseExpr('a * 2 + 1'), v), 7);
  assert.equal(evalExpr(parseExpr('(a + 1) * 2 >= 8 and not false'), v), true);
  assert.equal(evalExpr(parseExpr('"Hi " + name'), v), 'Hi Al');
  assert.equal(evalExpr(parseExpr('missing + 1'), v), 1);
  assert.throws(() => parseExpr('1 +'));
  assert.throws(() => parseExpr('a $ b'));
});

test('rich text and interpolation', () => {
  const segs = parseRich('Hi {i}there{/i}{pause=0.5s} you');
  assert.deepEqual(segs.map(s => s.kind), ['text', 'text', 'pause', 'text']);
  assert.equal(segs[1].italic, true);
  assert.equal(interpolate('Hello [who], [nope]', { who: 'Al' }), 'Hello Al, [nope]');
});

test('sample script compiles cleanly', () => {
  const p = compile([{ file: 'park.vn', text: sample }]);
  assert.deepEqual(errors(p), []);
  assert.ok('start' in p.labels && 'bench_talk' in p.labels);
  assert.equal(p.characters.alice.name, 'Alice');
});

test('plays through choice 0 and branches on trust', async () => {
  const p = compile([{ file: 'park.vn', text: sample }]);
  const r = new NullRenderer();
  const rt = new Runtime(p, r);
  await rt.start();
  const lines = r.says.map(s => s.text);
  assert.ok(lines.includes('Fine. Sit down. I\'ll forgive you this once.'));
  assert.equal(rt.vars.trust, 1);
  assert.equal(r.ended, true);
  assert.equal(r.menus.length, 2); // the last menu offers a walk into town
});

test('plays through choice 1 (no trust)', async () => {
  const p = compile([{ file: 'park.vn', text: sample }]);
  const r = new NullRenderer();
  r.chooser = () => 1;
  await new Runtime(p, r).start();
  assert.ok(r.says.some(s => s.text.startsWith('Sit. We need to talk')));
  assert.ok(!r.says.some(s => s.text.startsWith('Fine.')));
});

test('restore jumps to a source line and rebuilds state', async () => {
  const p = compile([{ file: 'park.vn', text: sample }]);
  const r = new NullRenderer();
  const rt = new Runtime(p, r);
  const line = sample.split('\n').findIndex(l => l.includes('So, what did you want')) + 1;
  let bgAtTarget;
  r.say = async ev => { r.says.push(ev); bgAtTarget ??= rt.state.bg; };
  await rt.restore({ file: 'park.vn', line });
  // first line shown live is the target line, with the scene rebuilt (the story then runs on to the night scene)
  assert.equal(r.says[0].text, 'So, what did you want to say?');
  assert.equal(bgAtTarget, 'bg_park_evening');
  assert.equal(rt.state.bg, 'bg_park_night');
  assert.equal(rt.state.music, 'evening_theme');
});

test('restore into a menu branch picks that branch', async () => {
  const p = compile([{ file: 'park.vn', text: sample }]);
  const r = new NullRenderer();
  const rt = new Runtime(p, r);
  const line = sample.split('\n').findIndex(l => l.includes("Don't flatter yourself")) + 1;
  await rt.restore({ file: 'park.vn', line });
  assert.equal(r.says[0].text, "Don't flatter yourself.");
  assert.equal(rt.vars.trust, 0);
});

test('restore with saved choices resumes in a fresh runtime', async () => {
  const p = compile([{ file: 'park.vn', text: sample }]);
  const r = new NullRenderer();
  r.chooser = () => 1;
  const rt = new Runtime(p, r);
  await rt.start();
  const line = sample.split('\n').findIndex(l => l.includes('Sit. We need to talk')) + 1;
  const r2 = new NullRenderer();
  const rt2 = new Runtime(p, r2);
  await rt2.restore({ file: 'park.vn', line }, rt.choices);
  assert.equal(r2.says[0].text, 'Sit. We need to talk anyway.');
  assert.equal(rt2.vars.trust, 0);
  assert.deepEqual(rt2.choices, [1, 0]); // plus the last menu, which the default chooser answers
  assert.equal(rt2.state.musicLoop, true);
});

test('restore by step lands on that exact line (rollback)', async () => {
  const p = compile([{ file: 'park.vn', text: sample }]);
  const r = new NullRenderer();
  r.chooser = () => 1;
  const rt = new Runtime(p, r);
  const seen = [];
  r.say = async ev => { seen.push({ text: ev.text, step: rt.step, choices: [...rt.choices] }); };
  await rt.start();
  const target = seen[seen.length - 2]; // one line back from the last
  const r2 = new NullRenderer();
  const rt2 = new Runtime(p, r2);
  await rt2.restore({ step: target.step }, target.choices);
  assert.equal(r2.says[0].text, target.text);
  assert.equal(r2.says.length, 2);
  // stepping back onto a choice shows the menu again
  const menuStep = seen.find(s => s.choices.length === 1).step - 1;
  const r3 = new NullRenderer();
  await new Runtime(p, r3).restore({ step: menuStep }, []);
  assert.equal(r3.menus.length, 2); // the start menu, then the last one
  assert.equal(r3.says[0].text, 'Lost? In your own neighborhood?');
});

test('character styles from define, narrator style for narration', async () => {
  const p = compile([{ file: 'a.vn', text: [
    'define al "Al" color=#f0a text=#ffe font="Georgia" size=1.2 italic speed=0.5 blip=bip style=al',
    'define narrator "" text=#ccc',
    'define thought "" italic',
    'define bad "B" size=big wobble',
    'label start:',
    '  al: Hi.',
    '  "Narration."',
    '  thought: Hmm.',
  ].join('\n') }]);
  assert.deepEqual(p.characters.al.style, { textColor: '#ffe', font: 'Georgia', size: 1.2, italic: true, speed: 0.5, blip: 'bip', box: 'al' });
  assert.equal(p.characters.al.color, '#f0a');
  assert.equal(p.characters.thought.name, '');
  const warns = p.diagnostics.filter(d => d.severity === 'warning').map(d => d.message);
  assert.ok(warns.some(m => m.includes('size= needs a number')));
  assert.ok(warns.some(m => m.includes('Unknown define option "wobble"')));
  const r = new NullRenderer();
  await new Runtime(p, r).start();
  assert.equal(r.says[0].style.font, 'Georgia');
  assert.equal(r.says[1].style.textColor, '#ccc');
  assert.equal(r.says[1].name, null);
  assert.equal(r.says[2].name, '');
  assert.equal(r.says[2].style.italic, true);
});

test('asset checks: missing art, poses, slots, audio, voices, skins', () => {
  const p = compile([{ file: 'a.vn', text: [
    'define al "Al" blip=hihg style=al',
    'define bo "Bo" blip=high',
    'label start:',
    '  scene park',
    '  scene beach',
    '  show al smile eyes=closed mouth=wide',
    '  show al frown hat=none',
    '  show bo grin',
    '  music play theme',
    '  sound play door',
    '  bo: Hi.',
  ].join('\n') }]);
  const rig = { parts: [{ file: 'body.png' }, { slot: 'eyes', variants: { open: { poses: ['smile'] }, closed: {} } },
    { slot: 'mouth', variants: { neutral: {}, grin: {} } }] };
  const msgs = (index) => checkAssets(p, index).map(d => `${d.line}: ${d.message}`);

  // A prototype with no files at all: art stays quiet (placeholders), but audio, the typo'd voice and the unknown skin are reported.
  const bare = msgs({ files: [] });
  assert.deepEqual(bare.filter(m => !m.startsWith('1:')), ['9: No track "theme" in assets/music', '10: No sound "door" in assets/sound']);
  assert.ok(bare.some(m => m.startsWith('1: No blip voice "hihg"')) && bare.some(m => m.startsWith('1: No style "al"')));
  assert.equal(bare.length, 4);

  const full = msgs({
    files: ['bg/park.png', 'music/other.ogg', 'sound/door.wav', 'char/bo/smile.png'],
    rigs: { al: rig }, skins: ['al'], blips: [],
  });
  assert.ok(full.includes('5: No background "beach" in assets/bg (a placeholder is drawn)'));
  assert.ok(!full.some(m => m.startsWith('4:')));                           // park exists
  assert.ok(full.some(m => m.startsWith('6: Slot "mouth" of al has no variant "wide"')));
  assert.ok(!full.some(m => m.startsWith('6: al has no layer')));            // smile is an alias of eyes/open
  assert.ok(full.some(m => m.startsWith('7: al has no layer named or aliased "frown"')));
  assert.ok(full.some(m => m.startsWith('7: al has no slot "hat"')));
  assert.ok(full.includes('8: No image for bo "grin" in assets/char/bo'));
  assert.ok(full.includes('9: No track "theme" in assets/music'));
  assert.ok(!full.some(m => m.startsWith('10:')));                          // door exists
  assert.ok(!full.some(m => m.includes('skin')));
});

test('game.json references are checked against the files', () => {
  const text = ['{', '  "titleScreen": { "background": "title", "music": "theme" },', '  "gallery": [{ "image": "park" }, { "image": "gone" }],', '  "splash": ["logo", { "image": "park" }]', '}'].join('\n');
  const msgs = (files) => checkGame(JSON.parse(text), { files }, text).map(d => `${d.file}:${d.line} ${d.message}`);
  assert.deepEqual(msgs(['bg/park.png', 'logo.png', 'title.png', 'music/theme.ogg']), ['game.json:3 gallery: no image "gone" in assets/bg']);
  assert.deepEqual(msgs([]).map(m => m.split(' ')[0]), ['game.json:2', 'game.json:2', 'game.json:3', 'game.json:3', 'game.json:4', 'game.json:3']);
  assert.deepEqual(checkGame(null, { files: [] }), []);
});

test('unlock flags persist, and a playthrough reads them as they were when it began', async () => {
  const text = [
    'label start:',
    '  if unlocked.good:',
    '    "Welcome back."',
    '  "Hello."',
    '  unlock good',
    '  if unlocked.good:',
    '    "Now unlocked."',
    '  if unlocked.missing or ghost.x:',
    '    "Never."',
  ].join('\n');
  const p = compile([{ file: 'a.vn', text }]);
  const msgs = p.diagnostics.map(d => d.message);
  assert.ok(msgs.some(m => m.includes('Nothing unlocks "missing"')));
  assert.ok(msgs.some(m => m.includes('Unknown name "ghost.x"')));

  const store = new Set();
  const play = async (base, restoreTo) => {
    const r = new NullRenderer();
    const rt = new Runtime(p, r);
    rt.unlockedBase = base;
    rt.onUnlock = name => store.add(name);
    await (restoreTo ? rt.restore(restoreTo, []) : rt.start());
    return r.says.map(s => s.text);
  };
  assert.deepEqual(await play([]), ['Hello.', 'Now unlocked.']);
  assert.deepEqual([...store], ['good']);
  // second playthrough starts with the flag
  assert.deepEqual(await play([...store]), ['Welcome back.', 'Hello.', 'Now unlocked.']);
  // replaying a first-playthrough save (base without the flag) takes the first playthrough's branches
  assert.deepEqual(await play([], { file: 'a.vn', line: 4 }), ['Hello.', 'Now unlocked.']);
});

// UX round 3 ED-4: Preview from cursor guesses a route to the line; the unlocks on it are not the player's, so none is reported (and
// so none is toasted or stored), while the story there still reads them. A save's replay reports them again, as before.
test('a restore to a script line keeps its unlocks to itself', async () => {
  const p = compile([{ file: 'a.vn', text: 'label start:\n  unlock town_visit\n  "In town."\n  if unlocked.town_visit:\n    "Remembered."\n' }]);
  const reported = [];
  const rt = new Runtime(p, new NullRenderer());
  rt.onUnlock = name => reported.push(name);
  await rt.restore({ file: 'a.vn', line: 5 }, []);
  assert.deepEqual(reported, [], 'nothing reported on the way to the line');
  assert.deepEqual(rt.unlocks, ['town_visit'], 'the story there still has it');
  await rt.start();
  assert.deepEqual(reported, ['town_visit'], 'a playthrough reports it');
});

test('diagnostics for bad scripts', () => {
  const bad = [
    'label start:',
    '  frobnicate alice',
    '  jump nowhere',
    '  show alice at',
    '  set x = 1 +',
    '\tbad_tab',
    '  menu:',
    '    "oops"',
    '  if nope > 1:',
    '    "hi"',
  ].join('\n');
  const msgs = compile([{ file: 'bad.vn', text: bad }]).diagnostics.map(d => d.message);
  assert.ok(msgs.some(m => m.includes('Unknown command "frobnicate"')));
  assert.ok(msgs.some(m => m.includes('Unknown label "nowhere"')));
  assert.ok(msgs.some(m => m.includes('Expected a position')));
  assert.ok(msgs.some(m => m.includes('tabs')));
  assert.ok(msgs.some(m => m.includes('Menu options look like')));
  assert.ok(msgs.some(m => m.includes('never assigned')));
});

test('ids: assigned once, stable on rerun, unique', () => {
  const taken = existingIds([sample]);
  const a = assignIds(sample, taken);
  assert.ok(a.added > 5);
  const b = assignIds(a.text, existingIds([a.text]));
  assert.equal(b.added, 0);
  assert.equal(b.text, a.text);
  const p = compile([{ file: 'park.vn', text: a.text }]);
  assert.deepEqual(errors(p), []);
  assert.equal(Object.keys(p.strings).length, a.added);
});

test('narration over several lines: indented quoted lines continue it, one id for the whole', () => {
  const text = 'label start:\n  "The park was empty."\n    "A bench sat by the pond."\n    "Nobody came."\n  "Next."\n  end\n';
  const { text: withIds, added } = assignIds(text, new Set());
  assert.equal(added, 2);
  assert.match(withIds, /^ {2}"The park was empty\." #\w{4}\n {4}"A bench sat by the pond\."\n {4}"Nobody came\."\n {2}"Next\." #\w{4}$/m);
  assert.equal(assignIds(withIds, existingIds([withIds])).added, 0);
  const p = compile([{ file: 'a.vn', text: withIds }]);
  assert.deepEqual(errors(p), []);
  assert.deepEqual(Object.values(p.strings), ['The park was empty.\nA bench sat by the pond.\nNobody came.', 'Next.']);
  const bad = compile([{ file: 'a.vn', text: 'label start:\n  "One."\n    "Two." style=x #abcd\n  end\n' }]);
  assert.ok(errors(bad).some(e => /first line/.test(e.message)));
});

test('{speed=} scales typing speed for the text inside; bad values stay as text', () => {
  const segs = parseRich('a{speed=0.5}b{/speed}c');
  assert.deepEqual(segs.map(s => [s.text, s.speed]), [['a', undefined], ['b', 0.5], ['c', undefined]]);
  assert.equal(parseRich('{speed=0}x{speed}').map(s => s.text).join(''), '{speed=0}x{speed}');
});

test('commands refuse words they do not know instead of ignoring them', () => {
  const bad = [
    'shake iris strength=8 loop', 'shake iris 1 2', 'scene bg fadee', 'scene bg fade 1 2', 'hide iris fade 1 2', 'hide iris now', 'hop iris 1 2',
    'flash #fff 1 2', 'tint #123456 0.5 1s 2', 'tint off x', 'camera reset 1 2', 'camera zoom 2 at center 1 2', 'camera pan center 1 2',
    'weather rain 0.5 1s 2', 'weather off x', 'filter sepia 1 1s 2', 'music play a loop x', 'music stop fade 1 x', 'wait 1 2', 'jump a b', 'end now', 'return x',
  ];
  for (const line of bad) {
    const p = compile([{ file: 't.vn', text: `label start:\n  ${line}\n  end\nlabel a:\n  end\n` }]);
    assert.ok(errors(p).length > 0, `${line} should be an error`);
  }
  assert.match(errors(compile([{ file: 't.vn', text: 'label start:\n  shake iris loop\n  end\n' }]))[0].message, /animate <char> shake loop/);
  const good = ['shake iris', 'shake iris 1s strength=4', 'shake screen strength=2 0.5s', 'scene bg', 'scene bg wipe right 1s', 'hide iris fade 1s', 'hop iris 0.5s',
    'flash', 'flash #fff 1s', 'tint #123456', 'tint #123456 0.5 1s', 'tint off 1s', 'camera reset 1s', 'camera zoom 2 at center 1s', 'camera pan center 1s',
    'weather rain 0.5 1s', 'weather off 1s', 'filter sepia 1 1s', 'music play a loop fade 1s', 'music stop fade 1s', 'wait 1s', 'jump a'];
  for (const line of good) {
    const p = compile([{ file: 't.vn', text: `label start:\n  ${line}\n  end\nlabel a:\n  end\n` }]);
    assert.deepEqual(errors(p).map(d => d.message), [], line);
  }
});

test('localization with fallback and missing report', async () => {
  const text = assignIds(sample, new Set()).text;
  const p = compile([{ file: 'park.vn', text }]);
  const ids = Object.keys(p.strings);
  const en = { ...p.strings };
  const fi = { [ids[0]]: 'Suomennettu rivi' };
  const loc = new Locale({ en, fi }, 'fi');
  assert.equal(loc.missing(p).length, ids.length - 1);
  const r = new NullRenderer();
  await new Runtime(p, r, loc).start();
  assert.equal(r.says[0].text, 'Suomennettu rivi');
  assert.ok(r.says.length > 2); // the rest fell back to the original text

  // source language: the script text wins over a stale en.json entry
  const stale = new Locale({ en: { ...en, [ids[0]]: 'OLD TEXT' } }, 'en');
  const r2 = new NullRenderer();
  await new Runtime(p, r2, stale).start();
  assert.notEqual(r2.says[0].text, 'OLD TEXT');
});

test('save and load round trip', async () => {
  const p = compile([{ file: 'park.vn', text: sample }]);
  const r = new NullRenderer();
  let stopAt = 2; // pause on the 2nd say by never resolving it
  r.say = ev => { r.says.push(ev); return --stopAt > 0 ? Promise.resolve() : new Promise(() => {}); };
  const rt = new Runtime(p, r);
  rt.start();
  await new Promise(res => setTimeout(res, 20));
  const save = rt.save();
  rt.stop();
  const r2 = new NullRenderer();
  const rt2 = new Runtime(p, r2);
  await rt2.load(save);
  assert.equal(rt2.state.bg, 'bg_park_night'); // the loaded story ran on to the last scene
  assert.ok(r2.says.length > 0);
});

test('completions by context', () => {
  const p = compile([{ file: 'park.vn', text: sample }]);
  const labels = prefix => getCompletions(p, prefix).map(s => s.label);
  const first = labels('  ');
  assert.ok(first.includes('show') && first.includes('alice'));
  assert.equal(getCompletions(p, '  ali').find(s => s.label === 'alice').insertText, 'alice: ');
  assert.deepEqual(labels('  show '), ['alice', 'you', 'screen']);
  assert.ok(labels('  show alice ').includes('smile') && labels('  show alice ').includes('at'));
  assert.deepEqual(labels('  show alice smile at '), ['left', 'center', 'right']);
  assert.deepEqual(labels('  jump '), ['start', 'bench_talk', 'town_square']);
  assert.deepEqual(labels('  scene '), ['bg_park_evening', 'bg_park_night']);
  assert.ok(labels('  scene bg_park_evening ').includes('dissolve'));
  assert.deepEqual(labels('  scene bg x wipe '), ['left', 'right', 'up', 'down']);
  assert.ok(labels('  move alice ').includes('to') && labels('  move alice ').includes('scale=1'));
  assert.ok(labels('define bob "Bob" ').includes('blip='));
  assert.ok(labels('define bob "Bob" blip=').includes('high'));
  assert.ok(labels('  set ').includes('trust'));
  assert.ok(labels('  if ').includes('trust'));
  assert.deepEqual(labels('  alice: Hello wor'), []);
  assert.deepEqual(labels('  # a comment'), []);
  assert.deepEqual(labels('  "narration te'), []);
});

test('input stores text in a variable and replays on restore', async () => {
  const text = 'label start:\n  input who "Your name?" default="Sam" max=5\n  "Hi [who]."\n  "Bye [who]."\n';
  const p = compile([{ file: 't.vn', text }]);
  assert.deepEqual(errors(p), []);
  const r = new NullRenderer();
  r.answerer = () => 'Alexander';
  const rt = new Runtime(p, r);
  await rt.start();
  assert.deepEqual(r.inputs, ['Your name?']);
  assert.equal(rt.vars.who, 'Alexa'); // cut to max
  assert.equal(r.says[0].text, 'Hi Alexa.');
  const r2 = new NullRenderer();
  const rt2 = new Runtime(p, r2);
  await rt2.restore({ step: 2 }, rt.choices);
  assert.deepEqual(r2.inputs, []); // replayed, not asked again
  assert.equal(r2.says[0].text, 'Bye Alexa.');
  assert.equal(compile([{ file: 't.vn', text: 'label start:\n  input\n' }]).diagnostics.length, 1);
});

test('flash, tint and camera: parsing, lasting state, reset on scene', async () => {
  const text = [
    'label start:', '  scene a', '  tint #203060 0.5 1s', '  camera zoom 1.5 at left y=0.4 0.8s ease=out', '  flash', '  flash #ff0000 0.2s',
    '  "x"', '  scene b', '  "y"', '',
  ].join('\n');
  const p = compile([{ file: 't.vn', text }]);
  assert.deepEqual(errors(p), []);
  const camera = p.ops.find(o => o.op === 'camera');
  assert.deepEqual([camera.zoom, camera.x, camera.y, camera.dur, camera.ease], [1.5, 0.2, 0.4, 0.8, 'out']);
  const r = new NullRenderer();
  const rt = new Runtime(p, r);
  r.say = async ev => { if (ev.text === 'x') assert.deepEqual([rt.state.tint, rt.state.camera.zoom], [{ color: '#203060', strength: 0.5 }, 1.5]); };
  await rt.start();
  assert.equal(rt.state.tint, null);
  assert.equal(rt.state.camera.zoom, 1);
  for (const bad of ['tint red', 'camera zoom 0.5', 'camera spin', 'tint #fff 2']) {
    assert.equal(compile([{ file: 't.vn', text: `label start:\n  ${bad}\n` }]).diagnostics.filter(d => d.severity === 'error').length, 1, bad);
  }
});

test('flash <name>: a character or a picture shown anywhere is known, anything else is warned about', () => {
  const text = [
    'define alice "Alice"', 'label start:', '  flash alice', '  flash lamp #ff0000 0.2s', '  flash alcie', '  flash', '  "x"',
    '  image show lamp lamp.png', '',
  ].join('\n');
  const warnings = compile([{ file: 't.vn', text }]).diagnostics.filter(d => d.severity === 'warning');
  assert.deepEqual(warnings.map(d => [d.line, d.message.split(' (')[0]]), [[5, 'Unknown character "alcie"']]);
});

test('nvl: lines collect on a page; clear, scene and off end it; restore and save rebuild it', async () => {
  const text = [
    'define a "Al" color=#ff0000', 'label start:', '  "before"', '  nvl on', '  "one"', '  a: two', '  nvl clear', '  "three"', '  "four"',
    '  scene bg', '  "five"', '  nvl off', '  "after"', '',
  ].join('\n');
  const p = compile([{ file: 't.vn', text }]);
  assert.deepEqual(errors(p), []);
  const r = new NullRenderer();
  let clears = 0;
  r.clearPage = () => { clears++; };
  const rt = new Runtime(p, r);
  await rt.start();
  const view = r.says.map(s => [s.text, s.nvl ?? false, (s.page ?? []).map(x => x.text)]);
  assert.deepEqual(view, [
    ['before', false, []], ['one', true, []], ['two', true, ['one']], ['three', true, []], ['four', true, ['three']],
    ['five', true, []], ['after', false, []],
  ]);
  assert.equal(r.says[2].page[0].page, undefined); // pages do not nest
  assert.equal(r.says[2].name, 'Al');
  assert.equal(clears, 4); // nvl on, nvl clear, scene, nvl off
  assert.equal(rt.nvl, false);
  // a restore to the middle of a page gives the line the lines before it
  const r2 = new NullRenderer();
  const rt2 = new Runtime(p, r2);
  const hold = r2.say.bind(r2);
  r2.say = ev => { void hold(ev); return new Promise(() => {}); }; // stay on that line
  void rt2.restore({ step: 4 });
  await new Promise(res => setTimeout(res, 5));
  assert.equal(r2.says[0].text, 'four');
  assert.deepEqual(r2.says[0].page.map(x => x.text), ['three']);
  assert.equal(rt2.nvl, true);
  // saves keep the mode and the page
  const saved = rt2.save();
  assert.deepEqual(saved.page.map(x => x.text), ['three', 'four']);
  for (const bad of ['nvl', 'nvl maybe', 'nvl on off']) {
    assert.equal(compile([{ file: 't.vn', text: `label start:\n  ${bad}\n` }]).diagnostics.filter(d => d.severity === 'error').length, 1, bad);
  }
  assert.ok(getCompletions(p, 'nvl ').some(s => s.label === 'clear'));
});

test('textbox hide: asks the renderer to hide the box before the next line; bad forms are errors', async () => {
  const p = compile([{ file: 't.vn', text: 'label start:\n  "one"\n  textbox hide\n  wait 0s\n  "two"\n' }]);
  assert.deepEqual(errors(p), []);
  const r = new NullRenderer();
  const log = [];
  r.hideBox = () => log.push('hide');
  const say = r.say.bind(r);
  r.say = ev => { log.push(ev.text); return say(ev); };
  await new Runtime(p, r).start();
  assert.deepEqual(log, ['one', 'hide', 'two']);
  for (const bad of ['textbox', 'textbox show', 'textbox hide now']) {
    assert.equal(compile([{ file: 't.vn', text: `label start:\n  ${bad}\n` }]).diagnostics.filter(d => d.severity === 'error').length, 1, bad);
  }
  assert.ok(getCompletions(p, 'textbox ').some(s => s.label === 'hide'));
});

test('a restore that ends at a choice, prompt or screen puts the last line back in the box', async () => {
  const text = [
    'screen room:', '  textbox off', '  button go at 0,0 "Go"',
    'label start:',
    '  set gold = 5',
    '  "You have [gold] coins."',                  // step 0
    '  set gold = 9',
    '  menu:', '    "Take":', '      "Taken."',    // steps 1, 2
    '  "Next."',                                   // 3
    '  textbox hide',
    '  menu:', '    "A":', '      "a."',           // 4, 5
    '  nvl on',
    '  "page"',                                    // 6
    '  menu:', '    "B":', '      "b."',           // 7, 8
    '  nvl off',
    '  "Say."',                                    // 9
    '  show screen room as r',                     // 10
    '  "After."',                                  // 11
    '  input name "Name?"',                        // 12
    '',
  ].join('\n');
  const p = compile([{ file: 't.vn', text }]);
  assert.deepEqual(errors(p), []);
  const shown = async step => {
    const r = new NullRenderer();
    const lines = [];
    r.showLine = ev => lines.push(ev.text);
    r.sync = (sync => s => { sync(s); lines.length = 0; })(r.sync.bind(r)); // what sync() clears, showLine puts back: only a call after the last sync counts
    await new Runtime(p, r).restore({ step });
    return lines;
  };
  // at the menu the first visit shows the line before it; the text is as it was then, not as the variables are now
  assert.deepEqual(await shown(1), ['You have 5 coins.']);
  // a line types its own text; `textbox hide`, an NVL page and a screen with `textbox off` leave the box empty
  for (const step of [0, 2, 4, 7, 9, 10]) assert.deepEqual(await shown(step), [], `step ${step}`);
  // after the screen, the next line is the one under the prompt
  assert.deepEqual(await shown(12), ['After.']);
});

test('restore into an unreachable line in the middle of an nvl page starts with nvl on', async () => {
  const text = 'label start:\n  "a"\n  end\nlabel hidden:\n  nvl on\n  "x"\n  "y"\n';
  const p = compile([{ file: 't.vn', text }]);
  const r = new NullRenderer();
  const rt = new Runtime(p, r);
  const hold = r.say.bind(r);
  r.say = ev => { void hold(ev); return new Promise(() => {}); };
  void rt.restore({ file: 't.vn', line: 7 });
  await new Promise(res => setTimeout(res, 5));
  assert.equal(rt.jumped, true);
  assert.equal(r.says[0].text, 'y');
  assert.equal(rt.nvl, true);
  assert.equal(r.says[0].nvl, true);
});

test('restore to a line the story never reaches enters the code there', async () => {
  const text = 'set n = 5\nlabel start:\n  "a"\n  end\nlabel hidden:\n  "b"\n  "c"\n';
  const p = compile([{ file: 't.vn', text }]);
  const r = new NullRenderer();
  const rt = new Runtime(p, r);
  await rt.restore({ file: 't.vn', line: 7 });
  assert.equal(r.says[0].text, 'c');
  assert.equal(rt.vars.n, 5); // top-level setup still ran
  assert.equal(rt.jumped, true);
  const r2 = new NullRenderer();
  const rt2 = new Runtime(p, r2);
  await rt2.restore({ file: 't.vn', line: 3 });
  assert.equal(rt2.jumped, false); // reachable lines replay normally
  assert.equal(r2.says[0].text, 'a');
  const r3 = new NullRenderer();
  await new Runtime(p, r3).restore({ file: 't.vn', line: 99 });
  assert.equal(r3.ended, true); // past the end of the file: nothing to enter
});

test('rolling back after a direct entry stays in that code instead of replaying from start', async () => {
  const text = 'label start:\n  "a"\n  end\nlabel hidden:\n  "b"\n  "c"\n  "d"\n';
  const p = compile([{ file: 't.vn', text }]);
  const rt = new Runtime(p, new NullRenderer());
  await rt.restore({ file: 't.vn', line: 5 });
  assert.deepEqual(rt.jumpedFrom, { file: 't.vn', line: 5 });
  const r = new NullRenderer();
  const rt2 = new Runtime(p, r);
  await rt2.restore({ step: 0, from: rt.jumpedFrom });
  assert.equal(r.says[0].text, 'b'); // not 'a' from start
});

test('restore to a line the story never reaches replays its label from the start', async () => {
  const text = 'label start:\n  "a"\n  end\nlabel hidden:\n  set n = 2\n  "b"\n  "c"\n';
  const p = compile([{ file: 't.vn', text }]);
  const r = new NullRenderer();
  const rt = new Runtime(p, r);
  await rt.restore({ file: 't.vn', line: 7 });
  assert.equal(r.says[0].text, 'c');
  assert.equal(rt.vars.n, 2); // the label's earlier lines ran
  assert.equal(rt.jumped, true);
  assert.equal(rt.jumpedFrom.line, 5); // steps count from the label's start
  const r2 = new NullRenderer();
  const rt2 = new Runtime(p, r2);
  await rt2.restore({ step: 1, from: rt.jumpedFrom });
  assert.equal(r2.says[0].text, 'c');
  assert.equal(rt2.vars.n, 2);
});

test('a run of lines indented too far is one error, and the code after it still compiles', () => {
  // the first line of a label one level too deep: the rest of the label sits at the "wrong" depth
  const deep = compile([{ file: 't.vn', text: 'label start:\n    "a"\n  "b"\n  "c"\n  jump next\nlabel next:\n  "d"\n' }]);
  assert.deepEqual(errors(deep).map(d => [d.line, d.message]), [[3, 'Unexpected indentation']]);
  assert.ok(deep.labels.next !== undefined);
  // a menu option body and a screen with one stray line each
  const menu = compile([{ file: 't.vn', text: 'label start:\n  menu:\n    "x":\n      "a"\n        set b = 1\n        set c = 1\n    "y":\n        "d"\n          set e = 1\n' }]);
  assert.deepEqual(errors(menu).map(d => d.line), [5, 9]);
  const screen = compile([{ file: 't.vn', text: 'screen s:\n  text "a" at 10,10\n    text "b" at 10,10\n    text "c" at 10,10\n  text "d" at 10,10\nlabel start:\n  end\n' }]);
  assert.deepEqual(errors(screen).map(d => d.line), [3]);
});

test('restore into a label that skips or never gets to the line enters the line itself', async () => {
  const skipped = 'label start:\n  end\nlabel hidden:\n  set n = 1\n  if n == 2:\n    "x"\n  "y"\n';
  const r = new NullRenderer();
  const rt = new Runtime(compile([{ file: 't.vn', text: skipped }]), r);
  await rt.restore({ file: 't.vn', line: 6 });
  assert.equal(r.says[0].text, 'x'); // not 'y' after the false `if`
  assert.deepEqual(rt.jumpedFrom, { file: 't.vn', line: 6 });
  const loops = 'label start:\n  end\nlabel hidden:\n  "a"\n  jump hidden\n  "b"\n';
  const r2 = new NullRenderer();
  await new Runtime(compile([{ file: 't.vn', text: loops }]), r2).restore({ file: 't.vn', line: 6 });
  assert.equal(r2.says[0].text, 'b');
});

test('rich text tags: colour, size, effects, ruby, wait and next; unknown tags stay literal', () => {
  const segs = parseRich('a{color=#f00}b{size=1.5}c{/size}{/color}{wave}d{/wave}{ruby=kan}X{/ruby}{wait}e{nw}');
  const text = segs.filter(s => s.kind === 'text');
  assert.deepEqual(text.map(s => s.text), ['a', 'b', 'c', 'd', 'X', 'e']);
  assert.equal(text[1].color, '#f00');
  assert.equal(text[1].size, undefined);
  assert.equal(text[2].size, 1.5);
  assert.equal(text[2].color, '#f00');
  assert.equal(text[3].fx, 'wave');
  assert.equal(text[4].ruby, 'kan');
  assert.equal(text[5].color, undefined);
  assert.deepEqual(segs.filter(s => s.kind !== 'text').map(s => s.kind), ['wait', 'next']);
  const odd = parseRich('x {color=} {size=0} {foo} {shake=3} y');
  assert.equal(odd.length, 1);
  assert.equal(odd[0].text, 'x {color=} {size=0} {foo} {shake=3} y');
});

test('demo.vn compiles with park.vn and plays through', async () => {
  const demo = readFileSync(new URL('../../games/sample/script/demo.vn', import.meta.url), 'utf8');
  assert.deepEqual(errors(compile([{ file: 'park.vn', text: raw + townStub }, { file: 'demo.vn', text: demo }])), []);
  // park.vn owns "start"; enter demo.vn through a stand-in entry that borrows its characters
  const entry = 'define alice "Alice"\nlabel start:\n  jump demo\n';
  const p = compile([{ file: 'entry.vn', text: entry }, { file: 'demo.vn', text: demo }]);
  assert.deepEqual(errors(p), []);
  const r = new NullRenderer();
  r.answerer = () => 'Sam';
  r.chooser = () => 1; // "That's all, thanks."
  const rt = new Runtime(p, r);
  await rt.start();
  assert.deepEqual(r.inputs, ["What's your name?"]);
  assert.equal(rt.vars.player, 'Sam');
  assert.ok(r.says.at(-1).text.startsWith('See you around, Sam. (Visits: 1)'));
  assert.equal(r.ended, true);
});

test('input prompts are localizable: ids are assigned, exported and translated', async () => {
  const text = 'label start:\n  input who "Your name?" default="Sam" max=5\n  input nick ""\n  "Hi [who]."\n';
  const { text: withIds, added } = assignIds(text, new Set());
  assert.equal(added, 2); // the input prompt and the narration line; the empty prompt has nothing to translate
  const id = /^  input who .* #(\w+)$/m.exec(withIds)?.[1];
  assert.ok(id);
  assert.equal(assignIds(withIds, existingIds([withIds])).added, 0);
  assert.ok(existingIds([withIds]).has(id));
  const p = compile([{ file: 't.vn', text: withIds }]);
  assert.deepEqual(errors(p), []);
  assert.equal(p.strings[id], 'Your name?');
  const r = new NullRenderer();
  const rt = new Runtime(p, r, new Locale({ fi: { [id]: 'Nimesi?' } }, 'fi', 'en'));
  await rt.start();
  assert.deepEqual(r.inputs, ['Nimesi?', '']);
  assert.equal(compile([{ file: 't.vn', text: 'label start:\n  input x #abcd\n' }]).diagnostics.length, 1);
});

test('input fills [variables] in its prompt and default', async () => {
  const p = compile([{ file: 't.vn', text: 'label start:\n  set who = "Sam"\n  input nick "Nickname for [who]?" default="[who]y"\n' }]);
  assert.deepEqual(errors(p), []);
  const r = new NullRenderer();
  const rt = new Runtime(p, r);
  await rt.start();
  assert.deepEqual(r.inputs, ['Nickname for Sam?']);
  assert.equal(rt.vars.nick, 'Samy');
});

test('completions offer text tags after { in dialogue, narration and option text', () => {
  const p = compile([{ file: 't.vn', text: 'define al "Al"\nlabel start:\n  al: hi\n' }]);
  const labels = prefix => getCompletions(p, prefix).map(s => s.label);
  for (const prefix of ['  al: Hello {', '  al: Hello {co', '  "Narration {wa', '  "Option {']) {
    assert.ok(labels(prefix).includes('color') && labels(prefix).includes('wait'), prefix);
  }
  assert.ok(getCompletions(p, '  al: {i}x{/i} {').length > 0);
  assert.deepEqual(getCompletions(p, '  al: {color=#fff}closed{/color} plain'), []);
  assert.deepEqual(getCompletions(p, '  al: Hello {wait} there'), []);
});

test('completions offer variables after [ in text and formats after [variable:', () => {
  const p = compile([{ file: 't.vn', text: 'define al "Al"\nlabel start:\n  set gold = 3\n  set persistent.wins = 1\n  al: hi\n' }]);
  const labels = prefix => getCompletions(p, prefix).map(s => s.label);
  for (const prefix of ['  al: You have [', '  al: You have [go', '  "Wins: [']) {
    assert.ok(labels(prefix).includes('gold') && labels(prefix).includes('persistent.wins'), prefix);
  }
  assert.ok(labels('  al: [gold:').includes('one=|few=|many=|other='));
  assert.ok(labels('  al: [gold:').includes(','));
  assert.deepEqual(getCompletions(p, '  al: [gold:,'), []);
  assert.deepEqual(getCompletions(p, '  al: [gold] coins'), []);
  assert.deepEqual(getCompletions(p, '  al:'), []); // the `:` trigger after a speaker offers nothing
  assert.ok(labels('  ').includes('scene'));
  // Variables set by input and `show screen ... as`; any quoted text, such as an input's prompt and default.
  const q = compile([{ file: 't.vn', text: 'label start:\n  input name "Name?"\n  show screen s as pick\n  "x"\nscreen s:\n  button a at 0,0 "A"\n' }]);
  const qs = prefix => getCompletions(q, prefix).map(s => s.label);
  assert.ok(qs('  "Hello [').includes('name') && qs('  "Hello [').includes('pick'));
  assert.ok(qs('  input who "Give name [').includes('name'));
  assert.ok(qs('  input who "Name?" default="[').includes('name'));
  assert.ok(qs('  input who "Name?" default="{').includes('wait'));
  assert.ok(!qs('  input who "Name?" ').includes('name'));
});

test('help: commands.md renders, and every statement the parser knows has a topic', () => {
  const doc = parseHelp(readFileSync(new URL('../../docs/commands.md', import.meta.url), 'utf8'));
  assert.ok(doc.html.includes('<h3 id="scene">') && doc.html.includes('<table>') && doc.html.includes('<pre><code>'));
  assert.ok(!doc.html.includes('<{') && !/<(?!\/?(h[1-3]|p|a|table|thead|tbody|tr|th|td|pre|code|strong|ul|li)\b)/.test(doc.html), 'text is escaped');
  for (const cmd of ['label', 'menu', 'define', 'scene', 'show', 'hide', 'move', 'shake', 'hop', 'animate', 'wait', 'flash', 'tint', 'camera', 'weather', 'filter',
    'music', 'sound', 'set', 'if', 'elif', 'else', 'jump', 'call', 'return', 'end', 'input', 'unlock', 'text-tags', 'speech-and-narration']) {
    assert.ok(doc.find(cmd), `topic for ${cmd}`);
  }
  for (const w of COMMAND_WORDS) assert.ok(doc.find(w), `commands.md has a heading for the statement "${w}"`);
  assert.equal(doc.find('hide'), doc.find('show'));
  assert.equal(doc.find('elif'), doc.find('else'));
  assert.equal(doc.find('nope'), undefined);
  assert.ok(doc.outline.every(h => doc.html.includes(`id="${h.id}"`)));
});

test('game.json label schema lists exactly the data-ui keys of preview/index.html', () => {
  const schema = readFileSync(new URL('../../editor/json-schemas.ts', import.meta.url), 'utf8');
  const listed = schema.match(/const LABEL_KEYS = \[([\s\S]*?)\.\.\.QUICK_ITEMS/)[1];
  const keys = new Set([...listed.matchAll(/'([a-z_]+)'/g)].map(m => m[1]));
  for (const q of QUICK_ITEMS) keys.add(`q_${q}`);
  const html = readFileSync(new URL('../../preview/index.html', import.meta.url), 'utf8');
  const ui = new Set([...html.matchAll(/data-ui="([a-z_]+)"/g)].map(m => m[1]));
  assert.deepEqual([...ui].filter(k => !keys.has(k)), [], 'data-ui keys missing from LABEL_KEYS');
  assert.deepEqual([...keys].filter(k => !ui.has(k)), [], 'LABEL_KEYS entries with no data-ui element');
});

test('help: topic under the cursor', () => {
  assert.equal(helpTopicAt('  show alice smile at left'), 'show');
  assert.equal(helpTopicAt('    elif trust >= 1:'), 'elif');
  assert.equal(helpTopicAt('  alice: Hello.'), 'speech-and-narration');
  assert.equal(helpTopicAt('  "Narration." #ab12'), 'speech-and-narration');
  assert.equal(helpTopicAt('    "Sorry." #qw64:'), 'menu');
  assert.equal(helpTopicAt('    "Secret" if trust >= 3:'), 'menu');
  assert.equal(helpTopicAt('  alice: Hi {col', 15), 'text-tags');
  assert.equal(helpTopicAt('  alice: Hi {wait} there', 22), 'speech-and-narration');
  assert.equal(helpTopicAt('  # a comment'), null);
  assert.equal(helpTopicAt('   '), null);
  // Screen words without a heading of their own go to the section that explains them; `on timeout` stays the menu's.
  const doc = parseHelp(readFileSync(new URL('../../docs/commands.md', import.meta.url), 'utf8'));
  for (const [line, topic] of [['  text at 0,0 "Hi"', 'screen'], ['  slider music at 0,0', 'screen'], ['  select language at 0,0', 'screen'],
    ['  default stacks', 'screen'], ['  image "ui/a.png" at 0,0', 'screen'], ['      on enter fade 0.2s', 'screen'], ['  cancel keep', 'state'],
    ['    on timeout:', 'on'], ['  image show a cg/a', 'image']]) {
    assert.equal(helpTopicAt(line), topic, line);
    assert.ok(doc.find(topic), `${topic} is a help topic`);
  }
});

test('help: rig.json section under the cursor', () => {
  const lines = ['{', '  "order": ["a",', '    "b"],', '  "bones": {', '    "head": {}', '  },', '  "looks": { "shy": { "look": "smile" } },',
    '  "pads": [],', '  "deformers": [{', '    "id": "d", "part": "p",', '    "mesh": { "verts": [0, 0],', '      "defaultBone": "a",', '      "weights": {',
    '        "0": { "a": 1 }', '      }', '    },', '    "keyforms": [{ "param": "x", "keys": [] }]', '  }],', '  "physics": {},', '  "comment": 1', '}'];
  assert.equal(rigHelpTopicAt(lines, 0), null);
  assert.equal(rigHelpTopicAt(lines, 2), 'order');
  assert.equal(rigHelpTopicAt(lines, 4), 'bones');
  assert.equal(rigHelpTopicAt(lines, 6), 'looks');
  assert.equal(rigHelpTopicAt(lines, 7), 'parameters-pads-keyforms');
  assert.equal(rigHelpTopicAt(lines, 9), 'deformers', 'id and part');
  assert.equal(rigHelpTopicAt(lines, 10), 'deformers', 'verts before the skin keys');
  assert.equal(rigHelpTopicAt(lines, 11), 'skinning', 'defaultBone');
  assert.equal(rigHelpTopicAt(lines, 13), 'skinning', 'inside weights');
  assert.equal(rigHelpTopicAt(lines, 16), 'deformers', 'keyforms after the weights');
  assert.equal(rigHelpTopicAt(lines, 18), 'physics');
  assert.equal(rigHelpTopicAt(lines, 19), null, 'an unknown key');
  assert.equal(rigHelpTopicAt(lines, 99), null);
  // The skin's sections exist in the reference, so the keys resolve.
  const doc = parseHelp(readFileSync(new URL('../../docs/rig-json.md', import.meta.url), 'utf8'));
  for (const key of ['skinning', 'deformers', 'parameters-pads-keyforms', 'physics', 'poses', 'reactions', 'auto']) assert.equal(doc.find(key), key, key);
  // Links written for GitHub (a dash per slash) point at the heading id the help gives the section.
  assert.match(doc.html, /data-help="parameters-pads-keyforms"/);
  assert.doesNotMatch(doc.html, /data-help="[^"]*--/);
  const link = parseHelp('## a / b\n\nSee [it](#a--b) and [that](#a-b).\n');
  assert.equal((link.html.match(/data-help="a-b"/g) ?? []).length, 2);
});

test('outline: labels, edges, layers and unreachable labels', () => {
  const p = compile([{ file: 'o.vn', text: [
    'label start:', '  "Hi"', '  menu:', '    "Left":', '      jump a', '    "Right":', '      call b', '  "after"',
    'label a:', '  "A"', 'label b:', '  "B"', '  return', 'label c:', '  "C"', '  end', '',
  ].join('\n') }]);
  assert.deepEqual(errors(p), []);
  const o = buildOutline(p);
  const node = n => o.nodes.find(x => x.name === n);
  const has = (from, to, kind, text) => o.edges.some(e => e.from === from && e.to === to && e.kind === kind && e.text === text);
  assert.ok(node('start').entry && node('start').menus === 1 && node('start').layer === 0);
  assert.ok(has('start', 'a', 'jump', 'Left'));
  assert.ok(has('start', 'b', 'call', 'Right'));
  assert.ok(has('a', 'b', 'next', undefined));
  assert.ok(node('b').returns && node('c').ends);
  assert.equal(node('a').layer, 1);
  assert.equal(node('c').reachable, false);
  assert.equal(node('c').layer, 0);                 // its own tree, below the story from the start
  assert.ok(node('c').row > node('b').row);
  assert.deepEqual(buildOutline(compile([])).nodes, []);
});

test('outline: long edges get free slots and untangle by barycenter ordering', () => {
  // start branches to x then y; both lead on to a long chain, and start also jumps straight to the end (a long edge).
  const p = compile([{ file: 'o.vn', text: [
    'label start:', '  menu:', '    "1":', '      jump a', '    "2":', '      jump b', '    "3":', '      jump e',
    'label a:', '  "A"', '  jump c', 'label b:', '  "B"', '  jump d', 'label c:', '  "C"', '  jump e', 'label d:', '  "D"', '  jump e',
    'label e:', '  "E"', '  end', '',
  ].join('\n') }]);
  const o = buildOutline(p);
  const node = n => o.nodes.find(x => x.name === n);
  assert.equal(node('e').layer, 3);
  const long = o.edges.find(e => e.from === 'start' && e.to === 'e');
  assert.equal(long.via.length, 2);
  for (const [k, row] of long.via.entries()) { // no label sits in the slot the long edge passes through
    assert.ok(!o.nodes.some(n => n.layer === k + 1 && n.row === row));
  }
  assert.equal(outlineCrossings(o), 0);
});

test('outline: a generated story of hundreds of labels lays out fast, without overlaps', () => {
  const N = 400, lines = [];
  let seed = 12345;
  const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let i = 0; i < N; i++) {
    lines.push(i === 0 ? 'label start:' : `label l${i}:`, `  "Line ${i}"`);
    if (i === N - 1) { lines.push('  end'); continue; }
    lines.push('  menu:');
    for (let k = 0; k < 3; k++) {
      // first option runs on (all reachable); the others mostly forward by a few labels, sometimes far ahead, sometimes back (loops)
      const t = k === 0 ? i + 1 : k === 2 && rnd(4) === 0 ? rnd(i + 1) : Math.min(N - 1, i + 1 + (rnd(6) === 0 ? rnd(60) : rnd(4)));
      lines.push(`    "Opt ${i}.${k}":`, `      jump ${t === 0 ? 'start' : `l${t}`}`);
    }
  }
  const p = compile([{ file: 'big.vn', text: lines.join('\n') + '\n' }]);
  assert.deepEqual(errors(p), []);
  const t0 = Date.now();
  const o = buildOutline(p);
  const ms = Date.now() - t0;
  assert.ok(ms < 3000, `layout took ${ms} ms`);
  assert.equal(o.nodes.length, N);
  const slots = new Set();
  for (const n of o.nodes) {
    assert.ok(Number.isInteger(n.layer) && Number.isInteger(n.row) && n.layer < o.layers);
    const k = `${n.layer},${n.row}`;
    assert.ok(!slots.has(k), `two labels at ${k}`);
    slots.add(k);
  }
  for (const e of o.edges) { // a long forward edge never runs through a label, nor shares a slot with another edge's route
    const a = o.nodes.find(n => n.name === e.from), b = o.nodes.find(n => n.name === e.to);
    if (b.layer - a.layer > 1) {
      assert.equal(e.via?.length, b.layer - a.layer - 1, `${e.from}>${e.to} ${a.layer} ${b.layer} ${e.kind}`);
      e.via.forEach((row, i) => assert.ok(!slots.has(`${a.layer + 1 + i},${row}`)));
    }
  }
  assert.ok(Number.isFinite(outlineCrossings(o)));
});

test('outline: sample story has a reachable graph from start', () => {
  const o = buildOutline(compile([{ file: 'park.vn', text: sample }]));
  assert.ok(o.nodes.find(n => n.name === 'start').entry);
  assert.ok(o.nodes.every(n => n.reachable), 'every label of the sample is reachable');
});

test('outline: a menu option that jumps or ends does not also run on', () => {
  const p = compile([{ file: 'o.vn', text: 'label a:\n  menu:\n    "x":\n      jump b\n    "y":\n      end\nlabel b:\n  "B"\n' }]);
  assert.deepEqual(buildOutline(p).edges.map(e => `${e.from}>${e.to}:${e.kind}`), ['a>b:jump']);
});

test('outline view: fit centres and caps at 1, zoom keeps the point under the cursor, centerOn centres', () => {
  const vp = { w: 800, h: 400 };
  assert.deepEqual(fitView({ w: 400, h: 100 }, vp), { scale: 1, x: 200, y: 150 });
  const big = fitView({ w: 1600, h: 400 }, vp);
  assert.equal(big.scale, 0.5);
  assert.deepEqual([big.x, big.y], [0, 100]);
  assert.equal(fitView({ w: 1e6, h: 1e6 }, vp).scale, MIN_SCALE);
  const v = { scale: 1, x: 10, y: 20 };
  const z = zoomAt(v, 2, 300, 200);
  assert.equal(z.scale, 2);
  assert.equal(300 * 0 + (300 - v.x) * z.scale + z.x, 300); // chart point under (300,200) stays there
  assert.equal(zoomAt(v, 100, 0, 0).scale, MAX_SCALE);
  const c = centerOn({ scale: 2, x: 0, y: 0 }, 100, 50, vp);
  assert.deepEqual([100 * 2 + c.x, 50 * 2 + c.y], [400, 200]);
});

test('outline search: label name, file and the choices leading out of a label', () => {
  const p = compile([{ file: 'o.vn', text: 'label hub:\n  menu:\n    "Visit the Bakery":\n      jump shop\nlabel shop:\n  "hi"\n' }]);
  const o = buildOutline(p);
  assert.deepEqual(searchOutline(o, 'SHO'), ['shop']);
  assert.deepEqual(searchOutline(o, 'bakery'), ['hub']);
  assert.deepEqual(searchOutline(o, 'o.vn'), ['hub', 'shop']);
  assert.deepEqual(searchOutline(o, '  '), []);
});

test('outline: edges carry the if conditions and choice conditions that guard them', () => {
  const p = compile([{ file: 'o.vn', text: [
    'label a:', '  if trust > 2 and not met:', '    jump b', '  elif trust > 0:', '    jump c', '  else:', '    jump d',
    '  menu:', '    "Pay" if gold >= 5:', '      jump b', '    "Skip":', '      jump c',
    'label b:', '  end', 'label c:', '  end', 'label d:', '  end', '',
  ].join('\n') }]);
  assert.deepEqual(errors(p), []);
  const conds = buildOutline(p).edges.map(e => `${e.to}${e.text ? ` "${e.text}"` : ''}: ${e.cond ?? '-'}`);
  assert.deepEqual(conds, [
    'b: trust > 2 and not met',
    'c: not (trust > 2 and not met) and trust > 0',
    'd: not (trust > 2 and not met) and not (trust > 0)',
    'b "Pay": gold >= 5',
    'c "Skip": -',
  ]);
});

test('town.vn compiles with park.vn, which jumps into town_square from its last menu', () => {
  const town = readFileSync(new URL('../../games/sample/script/town.vn', import.meta.url), 'utf8');
  const p = compile([{ file: 'park.vn', text: raw }, { file: 'town.vn', text: town }]);
  assert.deepEqual(errors(p), []);
  const o = buildOutline(p);
  const sq = o.nodes.find(n => n.name === 'town_square');
  assert.ok(sq.reachable && sq.layer > o.nodes.find(n => n.name === 'bench_talk').layer);
  assert.ok(o.nodes.find(n => n.name === 'good_ending').layer >= 2);
  assert.ok(o.edges.some(e => e.from === 'finale_check' && e.cond === 'not (clue >= 3 and bread) and clue >= 2'));
});

test('parseVarValue reads booleans, numbers, quoted strings and falls back to raw text', () => {
  assert.equal(parseVarValue('true'), true);
  assert.equal(parseVarValue(' false '), false);
  assert.equal(parseVarValue('-3.5'), -3.5);
  assert.equal(parseVarValue('"Mina"'), 'Mina');
  assert.equal(parseVarValue('"say \\"hi\\""'), 'say "hi"');
  assert.equal(parseVarValue('Mina'), 'Mina');
  assert.equal(parseVarValue(''), '');
});

test('splash and title fade config', () => {
  assert.deepEqual(normalizeSplash(undefined), []);
  const cards = normalizeSplash(['logo', { text: 'Presents', duration: 1, fade: -3 }, {}, 5, { image: ' ' }, { image: 'x', duration: 'no' }]);
  assert.deepEqual(cards.map(c => [c.image, c.text, c.duration, c.fade]), [['logo', '', 2.5, 0.6], [null, 'Presents', 1, 0], ['x', '', 2.5, 0.6]]);
  assert.equal(titleFade(undefined), 0.4);
  assert.equal(titleFade(0), 0);
  assert.equal(titleFade(99), 5);
});

test('playLabel runs a label as a cutscene after the setup, without ending the game', async () => {
  const src = ['set seen = 0', 'label start:', '  "Main story."', '  end', 'label intro:', '  set seen += 1', '  "Once upon a time."', '  end', ''].join('\n');
  const p = compile([{ file: 'a.vn', text: src }]);
  const r = new NullRenderer();
  const rt = new Runtime(p, r);
  assert.equal(await rt.playLabel('intro'), true);
  assert.deepEqual(r.says.map(s => s.text), ['Once upon a time.']);
  assert.equal(rt.vars.seen, 1);
  assert.equal(r.ended, false);
  assert.equal(await rt.playLabel('nope'), false);
  await rt.start(); // a normal run afterwards still ends the game
  assert.equal(r.says.at(-1).text, 'Main story.');
  assert.equal(r.ended, true);
});

test('move: position, transforms and flip update the sprite state', async () => {
  const src = 'define alice "Alice"\nlabel start:\n  show alice at left\n  move alice to right y=-0.05 scale=1.2 rot=-8 alpha=0.5 flip=on 0.6s ease=back\n  move alice scale=1\n  end\n';
  const p = compile([{ file: 't.vn', text: src }]);
  assert.deepEqual(errors(p), []);
  const mv = p.ops.filter(o => o.op === 'move');
  assert.deepEqual({ ...mv[0], src: undefined }, { op: 'move', char: 'alice', x: 0.8, y: -0.05, scale: 1.2, rotation: -8, alpha: 0.5, flip: true, anchor: null, dur: 0.6, ease: 'back', src: undefined });
  assert.deepEqual([mv[1].x, mv[1].y, mv[1].scale, mv[1].dur], [null, null, 1, 0]);
  const rt = new Runtime(p, new NullRenderer());
  await rt.start();
  assert.deepEqual(rt.state.sprites, [{ char: 'alice', pose: null, more: [], overrides: {}, x: 0.8, y: -0.05, scale: 1, rotation: -8, alpha: 0.5, flip: true, anchor: [0.5, 1], anim: null, params: {} }]);
});

test('move: bad arguments are parse errors', () => {
  const run = line => compile([{ file: 't.vn', text: `define alice "Alice"\nlabel start:\n  ${line}\n  end\n` }]).diagnostics.map(d => d.message).join('|');
  assert.match(run('move alice'), /Use: move/);
  assert.match(run('move alice to right 1s ease=wobble'), /Unknown ease/);
  assert.match(run('move alice spin=3'), /Unknown property/);
  assert.match(run('move alice flip=maybe'), /on or off/);
  assert.match(run('move alice y=abc'), /number/);
});

test('camera: an unknown ease is a parse error', () => {
  const run = line => compile([{ file: 't.vn', text: `label start:\n  ${line}\n  end\n` }]).diagnostics.map(d => d.message).join('|');
  assert.match(run('camera zoom 1.5 1 ease=wobble'), /Unknown ease/);
  assert.equal(run('camera zoom 1.5 1s ease=back'), '');
});

test('define: "screen" is reserved for `shake screen`', () => {
  const p = compile([{ file: 't.vn', text: 'define screen "Screen"\nlabel start:\n  shake screen\n  end\n' }]);
  assert.match(p.diagnostics.map(d => d.message).join('|'), /not a valid character id/);
});

test('animate: one-shots leave no state, loops are kept on the sprite until stopped or hidden', async () => {
  const src = 'define alice "Alice"\nlabel start:\n  show alice\n  animate alice nod\n  animate alice bob 0.5s strength=2\n  animate alice breathe loop\n  animate alice sway 4s loop strength=0.5\n  "mid"\n  animate alice stop\n  "after"\n  end\n';
  const p = compile([{ file: 't.vn', text: src }]);
  assert.deepEqual(errors(p), []);
  const an = p.ops.filter(o => o.op === 'animate').map(o => [o.name, o.dur, o.loop, o.strength]);
  assert.deepEqual(an, [['nod', null, false, 1], ['bob', 0.5, false, 2], ['breathe', null, true, 1], ['sway', 4, true, 0.5], [null, null, false, 1]]);
  const r = new NullRenderer(), seen = [];
  const rt = new Runtime(p, r);
  const say = r.say.bind(r);
  r.say = async ev => { seen.push(rt.state.sprites[0].anim); return say(ev); };
  await rt.start();
  assert.deepEqual(seen, [{ name: 'sway', dur: 4, strength: 0.5, part: null }, null]); // the second loop replaced the first
});

test('animate: bad arguments are parse errors', () => {
  const run = line => compile([{ file: 't.vn', text: `define alice "Alice"\nlabel start:\n  ${line}\n  end\n` }]).diagnostics.map(d => d.message).join('|');
  assert.match(run('animate alice'), /needs an animation/);
  assert.match(run('animate alice 3x'), /not an animation name/);
  assert.match(run('animate alice bob fast'), /Use: animate/);
  assert.match(run('animate alice bob 0s'), /Use: animate/);
  assert.match(run('animate bob nod'), /Unknown character/);
});

test('restore to a line the story never reaches gives up on a story that loops through menus, and enters the line directly', async () => {
  const src = 'define a "A"\nlabel start:\n  menu:\n    "again":\n      jump start\n    "twice":\n      jump start\nlabel side:\n  a: Hello from the side.\n  end\n';
  const p = compile([{ file: 't.vn', text: src }]);
  const r = new NullRenderer();
  const rt = new Runtime(p, r);
  await rt.restore({ file: 't.vn', line: 9 });
  assert.equal(rt.jumped, true);
  assert.equal(r.says.at(-1)?.text, 'Hello from the side.');
});

test('show: y=, scale= and flip= place the sprite without a move, and are kept when left out', async () => {
  const src = 'define alice "Alice"\nlabel start:\n  show alice at 0.35 y=0.02 scale=1.1 flip=on\n  show alice at right\n  end\n';
  const p = compile([{ file: 't.vn', text: src }]);
  assert.deepEqual(errors(p), []);
  const sh = p.ops.filter(o => o.op === 'show');
  assert.deepEqual([sh[0].x, sh[0].y, sh[0].scale, sh[0].flip], [0.35, 0.02, 1.1, true]);
  assert.deepEqual([sh[1].y, sh[1].scale, sh[1].flip], [undefined, undefined, undefined]);
  const rt = new Runtime(p, new NullRenderer());
  await rt.start();
  assert.deepEqual(rt.state.sprites, [{ char: 'alice', pose: null, more: [], overrides: {}, x: 0.8, y: 0.02, scale: 1.1, rotation: 0, alpha: 1, flip: true, anchor: [0.5, 1], anim: null, params: {} }]);
  const run = line => compile([{ file: 't.vn', text: `define alice "Alice"\nlabel start:\n  ${line}\n  end\n` }]).diagnostics.map(d => d.message).join('|');
  assert.match(run('show alice flip=maybe'), /on or off/);
  assert.match(run('show alice y=abc'), /number/);
});

test('show: draw order follows first show; order= and behind= move a character, behind someone absent keeps it', async () => {
  const src = 'define alice "Alice"\ndefine bob "Bob"\ndefine cara "Cara"\nlabel start:\n'
    + '  show alice at left\n  show bob at center\n  show cara at right\n  "1"\n'
    + '  show cara order=back\n  "2"\n  show alice smile order=front\n  "3"\n  show bob behind=cara\n  "4"\n'
    + '  hide cara\n  show alice behind=cara\n  "5"\n  show cara\n  "6"\n  end\n';
  const p = compile([{ file: 't.vn', text: src }]);
  assert.deepEqual(errors(p), []);
  const r = new NullRenderer();
  const rt = new Runtime(p, r);
  const orders = [];
  r.say = async () => { orders.push(rt.state.sprites.map(s => s.char).join(' ')); };
  await rt.start();
  assert.deepEqual(orders, ['alice bob cara', 'cara alice bob', 'cara bob alice', 'bob cara alice', 'bob alice', 'bob alice cara']);
  assert.equal(rt.state.sprites.find(s => s.char === 'alice').pose, 'smile'); // the pose still applies alongside order=
  const run = line => compile([{ file: 't.vn', text: `define alice "Alice"\nlabel start:\n  ${line}\n  end\n` }]).diagnostics.map(d => d.message).join('|');
  assert.match(run('show alice order=top'), /front or back/);
  assert.match(run('show alice behind=alice'), /behind itself/);
  assert.match(run('show alice order=front behind=bob'), /not both/);
  assert.match(run('show alice behind=nobody'), /nobody/);
  assert.equal(getCompletions(p, '  show bob ').filter(s => s.label.startsWith('behind=') || s.label.startsWith('order=')).map(s => s.label).join(' '),
    'order=front order=back behind=alice behind=cara');
});

test('outline: back edges with overlapping column ranges get different lanes', () => {
  const text = [
    'label start:', '  jump b', 'label b:', '  jump c', 'label c:', '  jump d', 'label d:',
    '  menu:', '    "x":', '      jump b', '    "y":', '      jump c', '    "z":', '      jump start', '',
  ].join('\n');
  const o = buildOutline(compile([{ file: 't.vn', text }]));
  const lanes = [...backEdgeLanes(o)];
  assert.equal(lanes.length, 3);
  assert.equal(new Set(lanes.map(([, l]) => l)).size, 3);
});
