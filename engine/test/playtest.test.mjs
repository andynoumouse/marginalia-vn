import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compile, playtest, playtestDiagnostics } from '../../dist/engine/src/index.js';

const run = (text, opts) => {
  const program = compile([{ file: 't.vn', text }]);
  assert.deepEqual(program.diagnostics.filter(d => d.severity === 'error'), []);
  return playtest(program, opts);
};
const lines = r => r.unreachableLines.map(l => (l.from === l.to ? `${l.from}` : `${l.from}-${l.to}`));

test('every menu option is taken, endings come with the shortest route', () => {
  const r = run([
    'label start:',
    '  "Hi."',
    '  menu:',
    '    "Left":',
    '      "L"',
    '      end',
    '    "Right":',
    '      menu:',
    '        "Again":',
    '          end',
    '        "Stop":',
    '          return',
  ].join('\n'));
  assert.equal(r.complete, true);
  assert.deepEqual(r.unreachableLines, []);
  assert.deepEqual(r.unreachableLabels, []);
  assert.equal(r.endings.length, 3);
  assert.deepEqual(r.endings.map(e => e.kind), ['end', 'end', 'return']);
  assert.deepEqual(r.endings[0].route, ['Left']);
  assert.deepEqual(r.endings[2].route, ['Right', 'Stop']);
});

test('lines behind a condition that never holds are unreachable, as are unused labels', () => {
  const r = run([
    'set coins = 0',
    'label start:',
    '  set coins += 1',
    '  if coins > 5:',
    '    "Rich."',
    '  else:',
    '    "Poor."',
    '  menu:',
    '    "Go":',
    '      jump out',
    '    "Never" if coins > 9:',
    '      "Hidden."',
    '      jump out',
    'label out:',
    '  end',
    'label orphan:',
    '  "Nobody comes."',
    '  end',
  ].join('\n'));
  assert.deepEqual(lines(r), ['5', '11-13', '17-18']);
  assert.deepEqual(r.unreachableLabels, ['orphan']);
});

test('a counter that only grows does not make the search endless', () => {
  const r = run([
    'set n = 0',
    'label start:',
    '  menu:',
    '    "More":',
    '      set n += 1',
    '      jump start',
    '    "Done" if n >= 3:',
    '      end',
  ].join('\n'));
  assert.equal(r.complete, true);
  assert.deepEqual(r.unreachableLines, []);
  assert.equal(r.endings.length, 1);
  assert.deepEqual(r.endings[0].route, ['More', 'More', 'More', 'Done']);
  assert.ok(r.choices < 20);
});

test('a loop with no choice and no way out is reported', () => {
  const r = run(['label start:', '  "Round."', '  jump start'].join('\n'));
  assert.equal(r.loops.length, 1);
  assert.equal(r.loops[0].file, 't.vn');
  assert.deepEqual(r.endings, []);
});

test('call and return resume after the call; running off the script is an ending', () => {
  const r = run([
    'label start:',
    '  call sub',
    '  "After."',
    'label sub:',
    '  "Inside."',
    '  return',
  ].join('\n'));
  assert.deepEqual(r.endings.map(e => e.kind), ['return']);
  assert.deepEqual(r.unreachableLines, []);
  const fall = run('label start:\n  "Only."');
  assert.deepEqual(fall.endings.map(e => e.kind), ['fall']);
});

test('a condition that draws a random number is followed both ways', () => {
  const r = run([
    'label start:',
    '  if chance(50):',
    '    "Lucky."',
    '    end',
    '  "Unlucky."',
    '  end',
  ].join('\n'));
  assert.deepEqual(r.unreachableLines, []);
  assert.equal(r.endings.length, 2);
});

test('random values come from seeds, so a story that branches on one is covered by several seeds', () => {
  const text = [
    'label start:',
    '  set roll = random(3)',
    '  if roll == 1:',
    '    "One."',
    '  elif roll == 2:',
    '    "Two."',
    '  else:',
    '    "Three."',
    '  end',
  ].join('\n');
  assert.equal(run(text, { seeds: 1 }).unreachableLines.length > 0, true);
  assert.deepEqual(run(text, { seeds: 12 }).unreachableLines, []);
});

test('flags and persistent data carry into later playthroughs', () => {
  const r = run([
    'label start:',
    '  if unlocked.secret:',
    '    "Second time."',
    '    end',
    '  menu:',
    '    "Find it":',
    '      unlock secret',
    '      end',
    '    "Skip":',
    '      end',
  ].join('\n'));
  assert.deepEqual(r.unreachableLines, []);
  assert.equal(r.endings.some(e => e.unlocks.includes('secret')), true);
});

test('screens: every enabled element is an answer, `cancel` too; shell actions are not', () => {
  const r = run([
    'screen map:',
    '  button a at 10,10 "A"',
    '  button b at 10,100 "B" enabled false',
    '  button c at 10,200 "C" action options',
    '  cancel',
    'label start:',
    '  show screen map',
    '  if screen == "a":',
    '    "A."',
    '  elif screen == "b":',
    '    "B."',
    '  elif screen == "c":',
    '    "C."',
    '  else:',
    '    "Cancelled."',
    '  end',
  ].join('\n'));
  assert.deepEqual(lines(r), ['11', '13']);
  assert.deepEqual(r.endings.map(e => e.route), [['map: a']]); // the cancel answer reaches the same end, so one route is kept
});

test('variables set but never read, and read but never set', () => {
  const r = run([
    'set seen = 0',
    'label start:',
    '  set shown = 1',
    '  set mood = 2',
    '  input name "Name?"',
    '  "Hi [name], you are [shown]. [maybe] stays."',
    '  if ghost > 1:',
    '    "Boo."',
    '  end',
  ].join('\n'));
  assert.deepEqual(r.unusedVariables.map(v => v.name).sort(), ['mood', 'seen']);
  assert.deepEqual(r.unsetVariables.map(v => v.name), ['ghost']);
});

test('flags nothing checks, unless game.json names them', () => {
  const text = ['label start:', '  unlock a', '  unlock b', '  end'].join('\n');
  assert.deepEqual(run(text).unusedFlags.map(f => f.name), ['a', 'b']);
  assert.deepEqual(run(text, { game: { gallery: [{ image: 'x', unlock: 'a' }] } }).unusedFlags.map(f => f.name), ['b']);
});

test('unused assets: files no script, screen or game.json names', () => {
  const text = [
    'define alice "Alice"',
    'define rigged "Rigged"',
    'screen s:',
    '  image "ui/frame.png" at 0,0',
    '  button go at 0,0 "Go" hover "ui/lit.png"',
    'label start:',
    '  scene park',
    '  show alice smile',
    '  show rigged',
    '  music play theme',
    '  sound play door',
    '  image show it "item_[n]"',
    '  show screen s',
    '  end',
  ].join('\n');
  const files = [
    'bg/park.png', 'bg/unused.png', 'bg_title.png', 'char/alice/smile.png', 'char/alice/angry.png', 'char/ghost/x.png',
    'char/rigged/body/a.png', 'music/theme.ogg', 'music/old.ogg', 'sound/door.wav', 'sound/click.wav',
    'ui/frame.png', 'ui/lit.png', 'ui/orphan.png', 'item_1.png', 'item_2.png', 'fonts/x.woff2', 'char/alice/sprite.json',
  ];
  const program = compile([{ file: 't.vn', text }]);
  assert.deepEqual(program.diagnostics.filter(d => d.severity === 'error'), []);
  const r = playtest(program, { assets: { files }, game: { titleScreen: { background: 'bg_title' } } });
  // layers of a character that is shown count as used (poses are picked while playing); unshown characters' files do not
  assert.deepEqual(r.unusedAssets.sort(), ['bg/unused.png', 'char/ghost/x.png', 'music/old.ogg', 'sound/click.wav', 'ui/orphan.png']);
  assert.deepEqual(playtest(program).unusedAssets, []); // no asset list, no check
});

test('all-labels roots start scenes nothing links to', () => {
  const text = ['label start:', '  end', 'label side:', '  "Side."', '  menu:', '    "Again":', '      jump side', '    "Out":', '      end'].join('\n');
  assert.deepEqual(lines(run(text)), ['4-9']);
  assert.deepEqual(run(text, { allLabels: true }).unreachableLines, []);
  assert.deepEqual(run(text, { roots: ['side'] }).unreachableLines, []);
  assert.deepEqual(run(text, { game: { chapters: [{ label: 'side' }] } }).unreachableLines, []);
});

test('HUD handlers are explored from the state the HUD went up in', () => {
  const r = run([
    'screen bar:',
    '  button help at 10,10 "Help" on click show_help',
    'label start:',
    '  hud on bar',
    '  "Hello."',
    '  end',
    'label show_help:',
    '  "Help text."',
    '  return',
  ].join('\n'));
  assert.deepEqual(r.unreachableLines, []);
  assert.deepEqual(r.unreachableLabels, []);
});

test('the budget ends the search and says so', () => {
  const text = ['set a = 0', 'set b = 7', 'label start:', '  menu:', '    "x":', '      set a = a + 1', '      jump start', '    "y":', '      set a = a + 2', '      jump start', 'label never:', '  if a == b:', '    "Same."'].join('\n');
  const r = run(text, { maxStates: 200 });
  assert.equal(r.complete, false);
  assert.ok(r.notes.length > 0);
});

test('the sample game: park.vn plays to its endings and town.vn has its known dead lines', () => {
  const dir = new URL('../../games/sample/script/', import.meta.url);
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.vn')).map(f => ({ file: f, text: fs.readFileSync(new URL(f, dir), 'utf8') }));
  const program = compile(files);
  const r = playtest(program);
  assert.equal(r.complete, true);
  assert.deepEqual(r.endings.filter(e => e.src.file === 'park.vn').map(e => e.route), [['Sorry, I got lost.', 'Call it a night.']]);
  assert.ok(r.endings.some(e => e.src.file === 'town.vn' && e.unlocks.includes('town_finale')));
  assert.deepEqual(r.loops, []);
  const all = playtest(program, { allLabels: true });
  assert.equal(all.complete, true);
  assert.deepEqual(all.unreachableLabels, []);
  assert.deepEqual(all.unreachableLines.map(l => `${l.file}:${l.from}`), ['screens.vn:61', 'town.vn:139']);
  assert.ok(playtestDiagnostics(all).every(d => d.severity === 'warning'));
});

// A variable that is overwritten before anything reads it again must not split the situations at a menu.
const lastScript = (reads) => [
  'label start:',
  '  set last = "none"',
  'label hub:',
  ...(reads ? ['  if last == "p3":', '    "Three."'] : []),
  '  menu:',
  ...[0, 1, 2, 3, 4, 5, 6, 7].flatMap(i => [`    "Pick ${i}":`, `      set last = "p${i}"`, '      jump hub']),
  '    "Peek":',
  '      jump hub',
  '    "Done":',
  '      end',
].join('\n');

test('a variable overwritten before it is read again is left out of the state', () => {
  const dead = run([
    'label start:',
    '  set last = "none"',
    'label hub:',
    '  menu:',
    ...[0, 1, 2, 3, 4, 5, 6, 7].flatMap(i => [`    "Pick ${i}":`, `      set last = "p${i}"`, '      if last == "p3":', '        "Three."', '      jump hub']),
    '    "Done":',
    '      end',
  ].join('\n'), { maxPerChoice: 3 });
  assert.equal(dead.complete, true); // `last` is read right after it is set, never across the menu
  const live = run(lastScript(true), { maxPerChoice: 3 });
  assert.equal(live.complete, false); // read at the top of the loop: the value at the menu matters
});

test('only lists read by position are compared in order', () => {
  const r = run([
    'set a = []',
    'set b = []',
    'label start:',
    '  menu:',
    '    "x":',
    '      set a += "x"',
    '      set b += "x"',
    '    "y":',
    '      set a += "y"',
    '      set b += "y"',
    '  menu:',
    '    "x":',
    '      set a += "x"',
    '      set b += "x"',
    '    "y":',
    '      set a += "y"',
    '      set b += "y"',
    '  if item(a, 0) == "x":',
    '    "First x."',
    '  if contains(b, "y"):',
    '    "Has y."',
    '  end',
  ].join('\n'));
  assert.equal(r.complete, true);
  assert.equal(r.endings.length, 1);
});
