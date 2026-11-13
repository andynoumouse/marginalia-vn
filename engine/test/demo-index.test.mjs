// The demo game's feature index (games/demo/script/index.vn and fx_*.vn): it compiles cleanly, the screen, the loop and the
// card labels agree with each other, the line a panel shows is the line that runs, and the playtest bot can walk all of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile, playtest, namedPositions, namedAnchors, stageSize } from '../../dist/engine/src/index.js';

const project = join(fileURLToPath(new URL('../..', import.meta.url)), 'games/demo');
const game = JSON.parse(readFileSync(join(project, 'game.json'), 'utf8'));
const sources = readdirSync(join(project, 'script')).filter(f => f.endsWith('.vn')).sort()
  .map(file => ({ file, text: readFileSync(join(project, 'script', file), 'utf8') }));
const source = name => sources.find(s => s.file === name).text;
const linesOf = text => text.split(/\r?\n/);
const fxFiles = sources.filter(s => /^fx_.*\.vn$/.test(s.file));
const indent = line => line.length - line.trimStart().length;

// The positions go in as the dev server passes them: without game.json's farleft and farright catalogue.vn has two errors.
const build = () => compile(sources, namedPositions(game), namedAnchors(game), stageSize(game));

// Labels that belong to the index and its cards but are not cards themselves: no button, no `_loop` twin, no branch in index_loop.
const HELPERS = ['fx_open', 'fx_close', 'fx_show_bag', 'fx_serve', 'fx_purse', 'fx_step_a', 'fx_step_b'];
const PAGE_CARDS = 12; // a grid is 4 columns by 3 rows

/** The lines of the block under the first line matching `header`: everything indented, comments and blank lines left out. */
const blockOf = (text, header) => {
  const lines = linesOf(text);
  const at = lines.findIndex(l => header.test(l));
  assert.ok(at >= 0, `${header} not found`);
  const block = [];
  for (const line of lines.slice(at + 1)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (indent(line) === 0) break;
    block.push(line);
  }
  return block;
};

// index.vn: the screen's page buttons, underlines and grids
const index = source('index.vn');
const screen = blockOf(index, /^screen feature_index:/);
const pages = screen.map(l => /^\s*button go_(\w+) /.exec(l)?.[1]).filter(Boolean);
const underlines = screen.map(l => /^\s*panel at \S+ size 230,8 .* if index_page == "(\w+)"\s*$/.exec(l)?.[1]).filter(Boolean);
const cards = {}; // page -> card ids, in the order of the grid
{
  let page = null;
  for (const line of screen) {
    const grid = /^  grid 4 at \S+ gap \d+ cell \S+ if index_page == "(\w+)":\s*$/.exec(line);
    if (grid) { page = grid[1]; cards[page] = []; continue; }
    if (indent(line) <= 2) { page = null; continue; }
    const button = /^\s*button (\w+) /.exec(line);
    if (page && button) cards[page].push(button[1]);
  }
}
const allCards = Object.values(cards).flat();

// index.vn: the branches of index_loop, id -> the statements in it
const branches = {};
{
  let id = null;
  for (const line of blockOf(index, /^label index_loop:/)) {
    const head = /^  (?:el)?if card == "(\w+)":\s*$/.exec(line);
    if (head) { id = head[1]; branches[id] = []; } else if (id && indent(line) >= 4) branches[id].push(line.trim());
  }
}

// every fx_* label: the cards (setup label, `_loop` twin) and the helpers
const labelsIn = text => linesOf(text).map(l => /^label (fx_\w+)/.exec(l)?.[1]).filter(Boolean);
const fxLabels = [...labelsIn(index), ...fxFiles.flatMap(s => labelsIn(s.text))];
const loopCards = fxLabels.filter(l => l.endsWith('_loop')).map(l => l.slice(3, -5));

test('the demo compiles with no diagnostics at all', () => {
  const program = build();
  assert.deepEqual(program.diagnostics, []);
  // the playtest silently skips a chapter label it does not know
  for (const c of game.chapters) assert.ok(c.label in program.labels, `chapter "${c.title}" starts at an unknown label ${c.label}`);
});

test('every page of the index has a button, an underline and a grid of at most twelve cards', () => {
  assert.deepEqual(pages, ['stage', 'effects', 'text', 'audio', 'logic', 'screens', 'rigs']);
  assert.deepEqual(underlines, pages);
  assert.deepEqual(Object.keys(cards), pages);
  assert.match(index, /^set index_page = "stage"$/m);
  for (const page of pages) {
    assert.deepEqual(branches[`go_${page}`], [`set index_page = "${page}"`], `go_${page} must open the page ${page}`);
    assert.ok(cards[page].length > 0, `page ${page} has no cards`);
    assert.ok(cards[page].length <= PAGE_CARDS, `page ${page} has ${cards[page].length} cards, a grid holds ${PAGE_CARDS}`);
  }
});

test('every card button runs its fx_<id> label and then fx_close, and every card label has a button', () => {
  assert.deepEqual(allCards.filter((id, i) => allCards.indexOf(id) !== i), [], 'a card is in two places');
  for (const id of allCards) {
    assert.deepEqual(branches[id], [`call fx_${id}`, 'call fx_close'], `index_loop: the branch for ${id}`);
    assert.ok(fxLabels.includes(`fx_${id}`), `label fx_${id} is missing`);
    assert.ok(fxLabels.includes(`fx_${id}_loop`), `label fx_${id}_loop is missing`);
  }
  // no branch without a button (the page buttons and the two links at the bottom are the others)
  const links = ['tour', 'library', ...pages.map(p => `go_${p}`)];
  assert.deepEqual(Object.keys(branches).filter(id => !allCards.includes(id) && !links.includes(id)), []);
  // no card label without a button: whatever has a `_loop` twin is a card, and what has not is a listed helper
  assert.deepEqual(loopCards.filter(id => !allCards.includes(id)), [], 'a fx_<id>_loop label has no button');
  const bare = fxLabels.filter(l => !l.endsWith('_loop') && !loopCards.includes(l.slice(3)));
  assert.deepEqual(bare.sort(), [...HELPERS].sort(), 'a label starting with fx_ is neither a card nor a listed helper');
});

test('a card sets its panel up with fx_open, falls through into its loop, and the loop ends in a return', () => {
  const texts = [index, ...fxFiles.map(s => s.text)];
  for (const id of allCards) {
    const text = texts.find(t => new RegExp(`^label fx_${id}_loop:`, 'm').test(t));
    assert.ok(text, `fx_${id}_loop is not in index.vn or an fx_ script`);
    const setup = blockOf(text, new RegExp(`^label fx_${id}:`));
    assert.ok(setup.some(l => l.includes('call fx_open(')), `fx_${id} never calls fx_open`);
    // the setup label is directly above its loop and neither jumps nor returns, so it runs on into the loop
    const lines = linesOf(text);
    const head = lines.findIndex(l => l === `label fx_${id}:`);
    const loop = lines.findIndex(l => l === `label fx_${id}_loop:`);
    assert.ok(loop > head, `fx_${id}_loop must come after fx_${id}`);
    assert.doesNotMatch(setup.at(-1).trim(), /^(return|jump|end)\b/, `fx_${id} ends before it reaches its loop`);
    const body = blockOf(text, new RegExp(`^label fx_${id}_loop:`));
    assert.match(body.at(-1), /^  return\s*$/, `fx_${id}_loop does not end in a return`);
  }
});

// What the panel shows as "Last fired" must be the line that runs. A card writes `set fx_fired = "<line>"` and the line itself
// right below it (a few lines below when it runs inside a branch), so each such text is looked up in the lines after it. Texts
// that are not a script line are skipped: prose and formats ("nothing yet", "You have [fx_n] coins."), the tag strings of the
// Text cards (they hold a zero-width space after each `{` so the tag is shown and not applied), and the three that summarise
// several lines of a Reset button. A text of several commands lists them joined by "  /  ", in the order they run.
const COMMANDS = new Set(['shake', 'hop', 'scene', 'show', 'move', 'animate', 'perform', 'flash', 'tint', 'filter', 'letterbox', 'camera', 'weather', 'gravity',
  'burst', 'music', 'sound', 'image', 'call', 'focus', 'nvl', 'hide', 'set', 'hud', 'unlock']);
const SUMMARIES = ['hide both, show iris, then theo', 'set fx_lamp = false, set fx_paper = cream', 'set fx_hp = 50, set fx_charm = 4'];
const WINDOW = 10;

test('the line a card shows as fired is the line it runs', () => {
  let checked = 0;
  for (const { file, text } of fxFiles) {
    const lines = linesOf(text);
    lines.forEach((raw, i) => {
      const m = /^\s*set fx_fired = (?:"(.*)"|'(.*)')\s*$/.exec(raw);
      if (!m) return;
      const shown = m[1] ?? m[2];
      if (shown.includes('​') || !COMMANDS.has(shown.split(/\s/)[0]) || SUMMARIES.includes(shown)) return;
      let from = i + 1;
      for (const part of shown.split('  /  ')) {
        const hit = lines.slice(from, from + WINDOW).findIndex(l => l.trim() === part);
        assert.ok(hit >= 0, `${file}:${i + 1}: "${part}" does not follow the fx_fired line that shows it`);
        from += hit + 1;
      }
      checked++;
    });
  }
  assert.ok(checked > 100, `only ${checked} fired lines were checked`);
});

test('nothing in the tour or the library leads back to the index, and the links out of it reset the page', () => {
  // The playtest bot tells situations apart by their variables: a way back from the tour or the library multiplied every state of
  // those by every state of the index until the bot gave up. The way home is Esc, Leave the library, New game (see label start).
  const ownLabels = new Set(['start', 'index_loop', ...fxLabels]);
  for (const { file, text } of sources.filter(s => s.file !== 'index.vn' && !fxFiles.includes(s))) {
    for (const [n, line] of linesOf(text).entries()) {
      const target = /^\s*(?:jump|call)\s+(\w+)/.exec(line)?.[1];
      assert.ok(!ownLabels.has(target), `${file}:${n + 1}: ${line.trim()} leads back to the index`);
      assert.doesNotMatch(line, /\bscreen feature_index\b/, `${file}:${n + 1} shows the index`);
    }
  }
  // and the index puts its page back before it jumps away, so those jumps do not carry the page into the tour
  assert.deepEqual(branches.tour, ['set index_page = "stage"', 'jump tour_start']);
  assert.deepEqual(branches.library, ['set index_page = "stage"', 'jump hub']);
});

// The bot gives up ("more than 500 different situations") when a way leads from a big state space into another one: the tour or the
// library back to the index, or the index page left set when it jumps away. One random seed finds that in about 3 s and sees every
// line too; the editor's Playtest tries four seeds (about 12 s), which VN_DEMO_PLAYTEST_SEEDS=4 does here.
test('the playtest bot walks the whole demo: complete, nothing unreachable, at least one ending', () => {
  const seeds = Number(process.env.VN_DEMO_PLAYTEST_SEEDS) || 1;
  const report = playtest(build(), { game, allLabels: true, seeds });
  assert.deepEqual(report.notes, []); // "more than N different situations", "stopped after ... steps"
  assert.equal(report.complete, true);
  assert.deepEqual(report.unreachableLines, []);
  assert.deepEqual(report.unreachableLabels, []);
  assert.deepEqual([report.loops, report.stuck], [[], []]);
  assert.ok(report.endings.length >= 1);
});
