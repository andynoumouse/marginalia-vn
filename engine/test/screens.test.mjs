import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seededRng as rngFrom } from './rng.mjs';
import {
  compile, Runtime, NullRenderer, Locale, assignIds, existingIds, getCompletions, insideScreen, interpolate, checkAssets, attachPreloads,
  pointInPolygon, pointInEllipse, hitTest, shapeCenter, shapeBounds, focusMove, defaultAnswer, replayAnswer, blocks, resolveScreen, validateScreen, sliderReadout,
} from '../../dist/engine/src/index.js';

const errors = p => p.diagnostics.filter(d => d.severity === 'error').map(d => d.message);
const warnings = p => p.diagnostics.filter(d => d.severity === 'warning').map(d => d.message);
const build = text => compile([{ file: 's.vn', text }]);
const view = (p, name, vars = {}) => {
  const items = Object.fromEntries(Object.values(p.items).map(i => [i.id, { name: i.name, image: i.image }]));
  return resolveScreen(p.screens[name], vars, { items, text: (_id, raw, v) => interpolate(raw, v) });
};

const MAP = `
define item key "Brass key" image=ui/key.png
define item coin "Silver coin"
set bag = ["key", "coin"]
set seen = 0
screen map:
  image "ui/map.png" size 1920,1080
  text at 10,10 "Carrying [bag]"
  hotspot cafe at 100,100 size 200,100 "Cafe"
  hotspot lake ellipse at 500,500 size 200,100 "Lake" if seen > 0
  hotspot hill poly 800,100 900,100 850,200 "Hill" enabled seen > 1
  button leave at 1600,900 "Leave"
  default lake
label start:
  show screen map as place
  if place == "cafe":
    jump a
  "Left with [place]."
  end
label a:
  "Cafe."
  end
`;

// ---- geometry ----

test('point in polygon, ellipse and shapes', () => {
  const tri = [[0, 0], [100, 0], [50, 100]];
  assert.ok(pointInPolygon(tri, 50, 30));
  assert.ok(!pointInPolygon(tri, 5, 90));
  assert.ok(pointInEllipse({ x: 0, y: 0, w: 100, h: 50 }, 50, 25));
  assert.ok(!pointInEllipse({ x: 0, y: 0, w: 100, h: 50 }, 2, 2)); // the corner of the box is outside
  assert.ok(hitTest({ k: 'rect', x: 10, y: 10, w: 10, h: 10 }, 15, 15));
  assert.ok(!hitTest({ k: 'rect', x: 10, y: 10, w: 10, h: 10 }, 25, 15));
  assert.deepEqual(shapeBounds({ k: 'poly', points: tri }), { x: 0, y: 0, w: 100, h: 100 });
  const [cx, cy] = shapeCenter({ k: 'poly', points: tri });
  assert.ok(Math.abs(cx - 50) < 1e-9 && Math.abs(cy - 100 / 3) < 1e-9); // the centroid, not the box centre
  assert.deepEqual(shapeCenter({ k: 'rect', x: 0, y: 0, w: 10, h: 20 }), [5, 10]);
});

test('directional focus on a row, a grid and a ring', () => {
  const row = [[100, 100], [300, 100], [500, 100]];
  assert.equal(focusMove(row, 0, 'right'), 1);
  assert.equal(focusMove(row, 1, 'left'), 0);
  assert.equal(focusMove(row, 2, 'right'), -1); // nothing beyond the end
  assert.equal(focusMove(row, 0, 'down'), -1);
  const grid = [0, 1, 2].flatMap(r => [0, 1, 2].map(c => [100 + c * 200, 100 + r * 150])); // 3x3, row-major
  assert.equal(focusMove(grid, 4, 'up'), 1);
  assert.equal(focusMove(grid, 4, 'down'), 7);
  assert.equal(focusMove(grid, 4, 'left'), 3);
  assert.equal(focusMove(grid, 0, 'right'), 1);
  assert.equal(focusMove(grid, 5, 'down'), 8);
  // eight points on a circle: right from the top goes clockwise to the next one on the right side
  const ring = Array.from({ length: 8 }, (_, i) => [500 + 300 * Math.sin((i * Math.PI) / 4), 500 - 300 * Math.cos((i * Math.PI) / 4)]);
  assert.ok([3, 4, 5].includes(focusMove(ring, 0, 'down'))); // ahead is the bottom half, never the top
  assert.equal(focusMove(ring, 0, 'up'), -1);
  assert.equal(focusMove(ring, 2, 'left'), 6); // straight across
  assert.equal(focusMove(ring, 2, 'right'), -1);
  // a candidate outside the cone is still reachable when nothing else is ahead
  assert.equal(focusMove([[0, 0], [10, 400]], 0, 'right'), 1); // far off to the side, but the only one ahead
  assert.equal(focusMove([[0, 0], [-5, 400]], 0, 'right'), -1); // behind
});

// ---- parsing and validation ----

test('a screen parses into elements; ids, strings and conditions are kept', () => {
  const p = build(MAP);
  assert.deepEqual(errors(p), []);
  const def = p.screens.map;
  assert.equal(def.default, 'lake');
  assert.deepEqual(def.body.map(n => n.kind), ['image', 'text', 'hotspot', 'hotspot', 'hotspot', 'button']);
  assert.deepEqual(def.body[3].shape, { k: 'ellipse', x: 500, y: 500, w: 200, h: 100 });
  assert.equal(def.body[4].shape.points.length, 3);
  assert.ok(def.body[3].cond && def.body[4].enabled);
  assert.deepEqual(p.ops.find(o => o.op === 'screen'), { op: 'screen', name: 'map', as: 'place', src: { file: 's.vn', line: 15 } });
});

test('mask hotspots and cursors parse', () => {
  const p = build('screen s:\n  hotspot a mask "ui/a.png" at 10,20 size 30,40 "A" cursor help\n  hotspot b mask "ui/b.png" "B"\nlabel start:\n  show screen s\n');
  assert.deepEqual(errors(p), []);
  const [a, b] = p.screens.s.body;
  assert.deepEqual(a.shape, { k: 'mask', file: 'ui/a.png', x: 10, y: 20, w: 30, h: 40 });
  assert.equal(a.cursor, 'help');
  assert.equal(a.label, 'A');
  assert.deepEqual(b.shape, { k: 'mask', file: 'ui/b.png', x: 0, y: 0, w: 1920, h: 1080 }); // the whole stage by default
});

test('hover images parse, resolve with variables, and are rejected on other elements', () => {
  const src = 'screen s:\n  hotspot a mask "ui/a.png" at 10,20 size 30,40 "A" hover "ui/a_lit.png" cursor help\n  button go at 0,0 size 100,50 "Go" #ab12 hover "ui/[skin]_lit.png" on click start\nlabel start:\n  show screen s\n';
  const p = build(src);
  assert.deepEqual(errors(p), []);
  const [a, b] = p.screens.s.body;
  assert.equal(a.hover, 'ui/a_lit.png');
  assert.equal(a.label, 'A');
  assert.equal(a.cursor, 'help');
  assert.equal(b.hover, 'ui/[skin]_lit.png');
  assert.equal(b.label, 'Go');
  assert.deepEqual(view(p, 's', { skin: 'red' }).parts.map(x => x.hover), ['ui/a_lit.png', 'ui/red_lit.png']);
  assert.equal(build('screen s:\n  hotspot a at 0,0 size 5,5 "A"\nlabel start:\n  show screen s\n').screens.s.body[0].hover, null);
  assert.match(errors(build('screen s:\n  text at 0,0 "A" hover "x.png"\nlabel start:\n  end'))[0] ?? '', /hover/);
  assert.ok(getCompletions(p, '  button x at 0,0 "X" ').map(c => c.label).includes('hover'));
});

test('hover none and tooltip off', () => {
  const p = build('screen s:\n  hotspot a at 0,0 size 5,5 "A" hover none tooltip off\n  hotspot b at 9,0 size 5,5 "B"\n  button go at 0,9 size 50,20 "Go" hover none\nlabel start:\n  show screen s\n');
  assert.deepEqual(errors(p), []);
  assert.deepEqual(view(p, 's', {}).parts.map(x => [x.plain, x.tip]), [[true, false], [false, true], [true, false]]);
  assert.match(errors(build('screen s:\n  button go at 0,0 "Go" tooltip off\nlabel start:\n  end'))[0] ?? '', /tooltip/);
  assert.match(errors(build('screen s:\n  hotspot a at 0,0 size 5,5 "A" hover "x.png" hover none\nlabel start:\n  end'))[0] ?? '', /not both/);
  assert.match(errors(build('screen s:\n  text at 0,0 "A" hover none\nlabel start:\n  end'))[0] ?? '', /hover/);
});

test('hover tint, scale and sound parse, validate and are checked against assets', () => {
  const p = build('screen s:\n  hotspot a at 0,0 size 5,5 "A" hover tint rgba(255,200,100,.35) hover scale 1.1 hover sound "tick"\n  button go at 0,9 size 50,20 "Go" hover scale 1.05\n  hotspot c at 9,9 size 5,5 "C"\nlabel start:\n  show screen s\n');
  assert.deepEqual(errors(p), []);
  assert.deepEqual(view(p, 's', {}).parts.map(x => x.fx), [
    { tint: 'rgba(255,200,100,.35)', scale: 1.1, sound: 'tick' }, { tint: null, scale: 1.05, sound: null }, { tint: null, scale: null, sound: null }]);
  assert.equal(view(p, 's', {}).parts[0].label, 'A'); // the sound name is not mistaken for the label
  const bad = text => errors(build('screen s:\n  ' + text + '\nlabel start:\n  end'))[0] ?? '';
  assert.match(bad('hotspot a at 0,0 size 5,5 "A" hover tint red green'), /Unexpected/);
  assert.match(bad('hotspot a at 0,0 size 5,5 "A" hover tint ;x'), /color/);
  assert.match(bad('hotspot a at 0,0 size 5,5 "A" hover scale 0'), /scale/);
  assert.match(bad('hotspot a at 0,0 size 5,5 "A" hover "x.png" hover scale 2'), /hover image/);
  assert.match(bad('hotspot a at 0,0 size 5,5 "A" hover none hover tint red'), /not both/);
  assert.match(bad('text at 0,0 "A" hover sound "x"'), /hover/);
  const warns = checkAssets(p, { files: ['sound/other.ogg'] }).map(d => d.message);
  assert.ok(warns.some(m => /No sound "tick"/.test(m)));
});

test('action names a built-in the shell runs; quickView is the reserved quickmenu screen', () => {
  const p = build('screen quickmenu:\n  row anchor bottomright margin 20 gap 10:\n    button b "Back" action back\n    button a "Auto" action auto\n    button m "Menu"\nlabel start:\n  end\n');
  assert.deepEqual(errors(p), []);
  assert.deepEqual(view(p, 'quickmenu').parts.map(x => x.act), ['back', 'auto', null]);
  const bad = text => errors(build('screen s:\n  ' + text + '\nlabel start:\n  end'))[0] ?? '';
  assert.match(bad('button a at 0,0 "A" action fly'), /Unknown action "fly"/);
  assert.match(bad('text at 0,0 "A" action back'), /Unexpected/);
  const rt = new Runtime(p, new NullRenderer());
  assert.equal(rt.quickView().name, 'quickmenu');
  const bare = new Runtime(build('label start:\n  end\n'), new NullRenderer()); // the starter, filled in by the shell
  bare.quickMenu = { items: [{ id: 'back', label: 'Back' }, { id: 'hide', label: 'Hide' }], place: 'topright' };
  const q = bare.quickView();
  assert.deepEqual(q.parts.map(x => [x.act, x.label, x.bounds.y < 100, x.bounds.x > 1400]), [['back', 'Back', true, true], ['hide', 'Hide', true, true]]);
  assert.equal(q.parts[0].font, 28);
  bare.quickMenu.place = 'bottomleft';
  assert.deepEqual(bare.quickView().parts.map(x => [x.bounds.y > 900, x.bounds.x < 400]), [[true, true], [true, true]]);
});

test('anchor [name] and action [name] take their value from a variable', () => {
  const p = build('screen quickmenu:\n  row anchor [quick_place] margin 10 gap 5:\n    each quick_items as q:\n      button q "[q.label]" action [q]\nlabel start:\n  end\n');
  assert.deepEqual(errors(p), []);
  const rt = new Runtime(p, new NullRenderer());
  rt.quickMenu = { items: [{ id: 'auto', label: 'Auto' }, { id: 'nonsense', label: 'X' }], place: 'nowhere' };
  const v = rt.quickView();
  assert.deepEqual(v.parts.map(x => x.act), ['auto', null]); // an unknown action does nothing
  const left = v.parts[0].bounds.x, right = v.parts[1].bounds.x + v.parts[1].bounds.w;
  assert.ok(Math.abs((left + right) / 2 - 960) < 1); // an unknown place is the center
});

test('titleView is the reserved title screen; continue is disabled without a save', () => {
  const p = build('screen title:\n  column anchor center gap 12:\n    button s "Start" action start\n    button c "Continue" action continue\n    button q "Quit" action quit\nlabel start:\n  end\n');
  assert.deepEqual(errors(p), []);
  const rt = new Runtime(p, new NullRenderer());
  assert.deepEqual(rt.titleView(true).parts.map(x => [x.act, x.enabled]), [['start', true], ['continue', true], ['quit', true]]);
  assert.deepEqual(rt.titleView(false).parts.map(x => [x.act, x.enabled]), [['start', true], ['continue', false], ['quit', true]]);
  // with no `screen title` the shell draws the starter
  const stock = new Runtime(build('label start:\n  end\n'), new NullRenderer());
  const acts = v => v.parts.filter(x => x.act).map(x => [x.act, x.enabled]);
  assert.deepEqual(acts(stock.titleView(false, false, true, false, false, 'My Game')), [['start', true], ['continue', false], ['load', true], ['music', true], ['options', true]]);
  assert.ok(stock.titleView(true, true, true, true, true, 'My Game').parts.some(x => x.kind === 'text' && x.text === 'My Game' && x.font === 100 && x.fit === true), 'the stock title shrinks a long game title (fit)');
  assert.ok(!stock.titleView(true, true, true, true, true, 'My Game', false).parts.some(x => x.kind === 'text'), 'show_title false hides the game name');
  const info = (can, text) => stock.titleView(can, true, true, true, true, 'My Game', false, text).parts.filter(x => x.sub).map(x => x.sub);
  assert.deepEqual(info(true, 'Park, evening'), ['Park, evening']);
  assert.deepEqual(info(false, 'Park, evening'), [], 'no Continue text without a save');
});

test('a button takes tooltip "text" (worked out with its variables); other elements refuse it', () => {
  const p = build('screen s:\n  button a at 0,0 "Go" tooltip "Key [k]" action close\n  button b at 0,100 tooltip "T" "Plain"\nlabel start:\n  end\n');
  assert.deepEqual(errors(p), []);
  const view = resolveScreen(p.screens.s, { k: 'F5' }, { items: {}, text: (id, raw, vars) => raw.replace(/\[(\w+)\]/g, (_, n) => vars[n]) });
  assert.deepEqual(view.parts.map(x => [x.label, x.tooltip]), [['Go', 'Key F5'], ['Plain', 'T']]);
  assert.match(errors(build('screen s:\n  text at 0,0 "x" tooltip "T"\nlabel start:\n  end\n'))[0], /tooltip "text" goes on a button/);
});

test('select shows a setting and, while open, lists its values under it', () => {
  const p = build('screen options:\n  column at 100,100 gap 8 align stretch width 400:\n    select language size 400,60\n    button done "Back" action close\nlabel start:\n  end\n');
  assert.deepEqual(errors(p), []);
  const env = { items: {}, text: (id, raw) => raw, entries: { language_options: { en: { label: 'English' }, fi: { label: 'Suomi' } } } };
  const vars = open => ({ language: 'fi', language_options: ['en', 'fi'], select_open: open });
  const closed = resolveScreen(p.screens.options, vars(''), env);
  assert.deepEqual(closed.parts.map(x => [x.id, x.label, x.act]), [['language', 'Suomi ▾', 'select'], ['done', 'Back', 'close']]);
  const open = resolveScreen(p.screens.options, vars('language'), env);
  assert.deepEqual(open.parts.slice(3).map(x => [x.id, x.label, x.act, x.checked, x.bounds.y]), [['language.en', 'English', 'choose', false, 164], ['language.fi', 'Suomi', 'choose', true, 228]]);
  assert.deepEqual(open.parts.slice(0, 2).map(x => x.bounds.y), closed.parts.map(x => x.bounds.y), 'the open list does not move the layout');
  assert.match(errors(build('screen options:\n  select volume at 0,0\nlabel start:\n  end\n'))[0], /select needs a player setting/);
  assert.match(errors(build('screen options:\n  select language at 0,0 action close\nlabel start:\n  end\n'))[0], /opens its list itself/);
});

test('text color can be a [variable]; empty keeps the default colour', () => {
  const p = build('screen s:\n  text at 0,0 "A" color [c]\n  text at 0,50 "B" color [d]\nlabel start:\n  end\n');
  assert.deepEqual(errors(p), []);
  const view = resolveScreen(p.screens.s, { c: '#f00', d: '' }, { items: {}, text: (id, raw, vars) => raw.replace(/\[(\w+)\]/g, (_, n) => vars[n]) });
  assert.deepEqual(view.parts.map(x => x.color), ['#f00', undefined]);
});

test('align stretch makes a column of buttons one width; width sets its least size', () => {
  const view = (head, rows = '    button a "Go"\n    button b "A much longer label" \n    text "Hi" width 10\n') => {
    const p = build(`screen s:\n  ${head}:\n${rows}label start:\n  end\n`);
    assert.deepEqual(errors(p), []);
    return resolveScreen(p.screens.s, {}, { items: {}, text: (id, raw) => raw });
  };
  const widths = v => v.parts.filter(x => x.kind === 'button').map(x => x.bounds.w);
  const plain = widths(view('column at 0,0 gap 4'));
  assert.notEqual(plain[0], plain[1]);
  const stretched = view('column at 0,0 gap 4 align stretch');
  assert.deepEqual(widths(stretched), [plain[1], plain[1]]);
  assert.equal(stretched.parts.find(x => x.kind === 'text').width, plain[1]);
  assert.deepEqual(widths(view('column at 0,0 align stretch width 600')), [600, 600]);
  // a row stretches the heights; a grid stretches both to the cell
  assert.equal(new Set(view('row at 0,0', '    button a "A" size 50,40\n    button b "B" size 50,90\n').parts.map(x => x.bounds.h)).size, 2);
  assert.deepEqual(view('row at 0,0 align stretch', '    button a "A" size 50,40\n    button b "B" size 50,90\n').parts.map(x => x.bounds.h), [90, 90]);
  const g = view('grid 2 at 0,0 gap 10 align stretch', '    button a "A" size 50,40\n    button b "B" size 80,90\n');
  assert.deepEqual(g.parts.map(x => [x.bounds.x, x.bounds.w, x.bounds.h]), [[0, 80, 90], [90, 80, 90]]);
  // a part that cannot grow (a text line's height) is centred in the room left
  const lab = view('grid 2 at 0,0 gap 10 cell 200,60 align stretch', '    text "Name" font 30\n    button b "B" size 50,40\n');
  const t = lab.parts.find(x => x.kind === 'text');
  assert.deepEqual([t.y, t.width], [12, 200]);
  assert.deepEqual([lab.parts.find(x => x.kind === 'button').bounds.h], [60]);
  const bad = build('screen s:\n  column at 0,0 width 0:\n    button a "A"\nlabel start:\n  end\n');
  assert.match(errors(bad)[0], /width needs a number above 0/);
});

test('pauseView is the reserved pause screen', () => {
  const p = build('screen pause:\n  column anchor center gap 12:\n    button r "Resume" action resume\n    button t "Title" action title\nlabel start:\n  end\n');
  assert.deepEqual(errors(p), []);
  const rt = new Runtime(p, new NullRenderer());
  assert.deepEqual(rt.pauseView().parts.map(x => x.act), ['resume', 'title']);
  // with no `screen pause` the shell draws the starter: a dimmer behind the buttons
  const stock = new Runtime(build('label start:\n  end\n'), new NullRenderer()).pauseView();
  assert.deepEqual(stock.parts.filter(x => x.act).map(x => x.act), ['resume', 'save', 'load', 'options', 'title']);
  assert.deepEqual(stock.parts.filter(x => x.kind === 'panel').map(x => [x.w, x.h, x.color]), [[1920, 1080, 'rgba(4,6,10,.62)']]);
});

test('panel color and size full make a dimmer; text font, width and align place a heading', () => {
  const p = build('screen d:\n  panel size full color rgba(0,0,0,.5)\n  text at 10,10 "Big" font 100\nlabel start:\n  end\n');
  assert.deepEqual(errors(p), []);
  const body = p.screens.d.body;
  assert.deepEqual([body[0].kind, body[0].w, body[0].h, body[0].color], ['panel', 1920, 1080, 'rgba(0,0,0,.5)']);
  assert.equal(body[1].font, 100);
  const wide = build('screen d:\n  text at 0,5 "Hi" width full align center\nlabel start:\n  end\n');
  assert.deepEqual(errors(wide), []);
  assert.deepEqual([wide.screens.d.body[0].width, wide.screens.d.body[0].align], [1920, 'center']);
  assert.ok(errors(build('screen d:\n  text at 0,5 "Hi" align middle\nlabel start:\n  end\n')).length > 0);
  assert.ok(errors(build('screen d:\n  text at 1,1 "x" font 2\nlabel start:\n  end\n')).length > 0, 'font must be 8 to 400');
  assert.ok(errors(build('screen d:\n  panel size full color #zz\nlabel start:\n  end\n')).length > 0);
});

const OPTIONS = 'screen options:\n  button audio at 100,50 "Audio" action tab\n  button game at 400,50 "Game" action tab\n  slider master at 100,200 size 500,40 readout if tab == "audio"\n  button text_sounds at 100,300 "Text sounds: [text_sounds]" action cycle if tab == "game"\n  button done at 100,900 "Back" action close\nlabel start:\n  end\n';

test('optionsView is the reserved options screen: sliders carry the setting, labels and conditions see the values', () => {
  const p = build(OPTIONS);
  assert.deepEqual(p.diagnostics, []);
  const rt = new Runtime(p, new NullRenderer());
  const first = rt.optionsView({ master: 0.5, text_sounds: 'on', tab: '' });
  assert.deepEqual(first.parts.map(x => x.kind === 'slider' ? 'slider' : x.id), ['audio', 'game', 'slider', 'done']);
  assert.deepEqual(first.parts.find(x => x.kind === 'slider'), { kind: 'slider', setting: 'master', x: 100, y: 200, w: 500, h: 40, readout: true, min: 0, max: 1, step: 0.05, value: 0.5 });
  const game = rt.optionsView({ master: 0.5, text_sounds: 'off', tab: 'game' });
  assert.deepEqual(game.parts.map(x => x.kind === 'slider' ? 'slider' : x.id), ['audio', 'game', 'text_sounds', 'done']);
  assert.equal(game.parts.find(x => x.id === 'text_sounds').label, 'Text sounds: off');
  assert.equal(new Runtime(build('label start:\n  end\n'), new NullRenderer()).optionsView({}).name, 'options'); // the starter
});

const SAVES = `screen saves:
  each pages as pg at 100,50 step 160,0:
    button pg at 0,0 "[pg.name]" action page
  each slots as slot at 100,200 step 0,120:
    button slot at 0,0 size 800,100 "[slot.title] [slot.when] [slot.text]" action slot enabled mode == "save" or not slot.empty
  button del at 1000,200 "Delete" action delete if mode == "load"
  button done at 100,900 "Back" action close
label start:
  end
`;

test('savesView is the reserved saves screen: shell lists drive each, and the entry data fills the labels and conditions', () => {
  const p = build(SAVES);
  assert.deepEqual(p.diagnostics, []);
  const rt = new Runtime(p, new NullRenderer());
  const entries = {
    pages: { 1: { name: '1' }, auto: { name: 'Auto' } },
    slots: { 1: { title: 'Slot 1', when: '12:00', text: 'Hello', empty: false }, 2: { title: 'Slot 2', when: '', text: '', empty: true } },
  };
  const load = rt.savesView({ mode: 'load', page: '1', pages: ['auto', '1'], slots: ['1', '2'], deleting: false }, entries);
  assert.deepEqual(load.parts.map(x => x.id), ['auto', '1', '1', '2', 'del', 'done']);
  assert.deepEqual(load.parts.filter(x => x.act === 'page').map(x => x.label), ['Auto', '1']);
  const slots = load.parts.filter(x => x.act === 'slot');
  assert.deepEqual(slots.map(x => [x.label, x.enabled]), [['Slot 1 12:00 Hello', true], ['Slot 2  ', false]]); // an empty slot cannot be loaded
  const save = rt.savesView({ mode: 'save', page: '1', pages: ['1'], slots: ['1', '2'], deleting: false }, entries);
  assert.deepEqual(save.parts.filter(x => x.act === 'slot').map(x => x.enabled), [true, true]);
  assert.equal(save.parts.some(x => x.act === 'delete'), false);
  assert.equal(new Runtime(build('label start:\n  end\n'), new NullRenderer()).savesView({}, {}).name, 'saves'); // the starter
});

test('historyView is the reserved history screen: entries fill name and text, inside a scroll area that knows its content height', () => {
  const p = build(`screen history:
  scroll at 100,100 size 900,200 start bottom:
    each lines as ln step 0,60:
      button ln at 0,0 size 800,50 "[ln.name]: [ln.text]"
  text at 1100,300 "[total] lines" if total > 2
  button done at 1100,900 "Back" action close
label start:
  end
`);
  assert.deepEqual(p.diagnostics, []);
  const rt = new Runtime(p, new NullRenderer());
  const entries = { lines: { 1: { name: 'Al', text: 'a' }, 2: { name: '', text: 'b' }, 3: { name: 'Bo', text: 'c' }, 4: { name: 'Al', text: 'd' } } };
  const v = rt.historyView({ lines: ['1', '2', '3', '4'], total: 4 }, entries);
  const area = v.parts.find(x => x.kind === 'scroll');
  assert.deepEqual([area.index, area.x, area.y, area.w, area.h, area.start, area.bar, area.contentH], [0, 100, 100, 900, 200, 'bottom', true, 230]); // 3 steps of 60 plus a 50 button
  const rows = v.parts.filter(x => x.area === 0);
  assert.deepEqual(rows.map(x => [x.label, x.shape.y]), [['Al: a', 100], [': b', 160], ['Bo: c', 220], ['Al: d', 280]]); // stage coordinates
  assert.equal(v.parts.find(x => x.kind === 'text').text, '4 lines');
  assert.equal(v.parts.find(x => x.act === 'close').area, undefined);
  assert.equal(new Runtime(build('label start:\n  end\n'), new NullRenderer()).historyView({ lines: [], total: 0 }, {}).name, 'history'); // none of the project's own: the starter
});

test('history screen: `action line` buttons carry the line id, and `ln.current` marks the line on screen', () => {
  const p = build(`screen history:
  each lines as ln step 0,60:
    button ln at 0,0 size 800,50 "[ln.text]" action line enabled not ln.current
label start:
  end
`);
  assert.deepEqual(p.diagnostics, []);
  const v = new Runtime(p, new NullRenderer()).historyView({ lines: ['1', '2'], total: 2 }, { lines: { 1: { name: '', text: 'a', current: false }, 2: { name: '', text: 'b', current: true } } });
  assert.deepEqual(v.parts.filter(x => x.act === 'line').map(x => [x.id, x.label, x.enabled]), [['1', 'a', true], ['2', 'b', false]]);
});

test('history screen: a second `ln.voice` button per line takes `action voice` and shows only on a voiced line', () => {
  const p = build(`screen history:
  each lines as ln step 0,60:
    button ln at 0,0 size 700,50 "[ln.text]" action line
    button ln.voice at 710,0 size 90,50 "v" action voice if ln.voiced
label start:
  end
`);
  assert.deepEqual(p.diagnostics, []);
  const v = new Runtime(p, new NullRenderer()).historyView({ lines: ['1', '2'], total: 2 }, { lines: { 1: { name: '', text: 'a', current: false, voiced: true }, 2: { name: '', text: 'b', current: false, voiced: false } } });
  assert.deepEqual(v.parts.filter(x => x.act === 'voice').map(x => x.id), ['1.voice']);
});

test('musicView and chaptersView are the reserved music and chapter screens; the title buttons follow the entries', () => {
  const p = build(`screen music:
  each tracks as t step 0,100:
    button t at 0,0 "[t.title]" action track enabled t.unlocked
  text at 0,500 "[now] [count]/[total]"
  button s at 0,600 "Stop" action stop
  button done at 0,700 "Back" action close
screen chapters:
  each chapters as c step 0,100:
    button c at 0,0 "[c.title]" action chapter enabled c.unlocked
  button done at 0,700 "Back" action close
screen title:
  button m at 0,0 "Music" action music
  button c at 0,100 "Chapters" action chapters
label start:
  end
`);
  assert.deepEqual(p.diagnostics, []);
  const rt = new Runtime(p, new NullRenderer());
  const tracks = { 1: { name: 'Theme', title: 'Theme', unlocked: true, playing: true }, 2: { name: 'Locked', title: 'Locked', unlocked: false, playing: false } };
  const m = rt.musicView({ tracks: ['1', '2'], count: 1, total: 2, now: 'Theme' }, { tracks });
  assert.deepEqual(m.parts.filter(x => x.act === 'track').map(x => [x.id, x.label, x.enabled]), [['1', 'Theme', true], ['2', 'Locked', false]]);
  assert.equal(m.parts.find(x => x.kind === 'text').text, 'Theme 1/2');
  assert.deepEqual(m.parts.filter(x => x.act === 'stop' || x.act === 'close').map(x => x.act), ['stop', 'close']);
  const c = rt.chaptersView({ chapters: ['1'], count: 1, total: 1 }, { chapters: { 1: { name: 'Bench', title: 'Bench', unlocked: true } } });
  assert.deepEqual(c.parts.filter(x => x.act === 'chapter').map(x => [x.id, x.label, x.enabled]), [['1', 'Bench', true]]);
  const bare = new Runtime(build('label start:\n  end\n'), new NullRenderer());
  assert.equal(bare.musicView({ tracks: [], count: 0, total: 0, now: '' }, { tracks: {} }).name, 'music'); // the starters
  assert.equal(bare.chaptersView({ chapters: [], count: 0, total: 0 }, { chapters: {} }).name, 'chapters');
  assert.deepEqual(rt.titleView(true, true, false, true).parts.map(x => [x.act, x.enabled]), [['music', false], ['chapters', true]]);
  assert.deepEqual(rt.titleView(true, true, true, false).parts.map(x => [x.act, x.enabled]), [['music', true], ['chapters', false]]);
});

test('achievementsView and achievementToastView are the reserved achievement screens; a title button follows the entries', () => {
  const p = build(`screen achievements:
  each endings as e step 0,100:
    text at 0,0 "[e.title]" if e.unlocked
  each achievements as a step 0,100:
    text at 600,0 "[a.title] [a.description]" if a.unlocked or not a.hidden
  text at 0,900 "[count]/[total] [endings_count]/[endings_total]"
  button done at 0,1000 "Back" action close
screen achievement_toast:
  image "[icon]" at 0,0 size 96,96 if icon != ""
  text at 100,0 "[title]" if not ending
screen title:
  button a at 0,0 "Achievements" action achievements
label start:
  end
`);
  assert.deepEqual(p.diagnostics, []);
  const rt = new Runtime(p, new NullRenderer());
  const v = rt.achievementsView({ achievements: ['1', '2'], endings: ['1'], count: 1, total: 2, endings_count: 0, endings_total: 1 }, {
    achievements: { 1: { name: 'Key', title: 'Key', description: 'Found it', icon: '', unlocked: true, hidden: false, ending: false }, 2: { name: 'Secret', title: '???', description: '', icon: '', unlocked: false, hidden: true, ending: false } },
    endings: { 1: { name: 'Good', title: 'Good', description: '', icon: '', unlocked: false, hidden: false, ending: true } },
  });
  assert.deepEqual(v.parts.filter(x => x.kind === 'text').map(x => x.text), ['Key Found it', '1/2 0/1']);
  const t = rt.achievementToastView({ title: 'Key', description: 'Found it', icon: '', ending: false, position: 'topright' });
  assert.deepEqual(t.parts.map(x => x.kind === 'text' ? x.text : x.kind), ['Key']);
  const bare = new Runtime(build('label start:\n  end\n'), new NullRenderer());
  assert.equal(bare.achievementsView({ achievements: [], endings: [], count: 0, total: 0, endings_count: 0, endings_total: 0 }, { achievements: {}, endings: {} }).name, 'achievements'); // the starter
  const stock = bare.achievementToastView({ title: 'Key', description: 'Found it', icon: '', ending: true, position: 'bottom' }); // the starter
  assert.deepEqual(stock.parts.filter(x => x.kind === 'text').map(x => x.text), ['Ending reached', 'Key', 'Found it']);
  assert.deepEqual(rt.titleView(true, true, true, true, false).parts.map(x => [x.act, x.enabled]), [['achievements', false]]);
});

test('galleryView is the reserved gallery screen: tiles carry title, lock state and picture file; a title gallery button follows the entries', () => {
  const p = build(`screen gallery:
  each tiles as t step 0,100:
    image "[t.file]" at 0,0 size 80,60 if t.unlocked
    button t at 100,0 "[t.title]" action tile enabled t.unlocked
  text at 0,500 "[count]/[total]"
  button done at 0,600 "Back" action close
label start:
  end
`);
  assert.deepEqual(p.diagnostics, []);
  const rt = new Runtime(p, new NullRenderer());
  const entries = { tiles: { 1: { name: 'Park', title: 'Park', unlocked: true, file: 'bg/park.png' }, 2: { name: 'Locked', title: 'Locked', unlocked: false, file: '' } } };
  const v = rt.galleryView({ tiles: ['1', '2'], count: 1, total: 2 }, entries);
  assert.deepEqual(v.parts.filter(x => x.kind === 'image').map(x => x.file), ['bg/park.png']);
  assert.deepEqual(v.parts.filter(x => x.act === 'tile').map(x => [x.id, x.label, x.enabled]), [['1', 'Park', true], ['2', 'Locked', false]]);
  assert.equal(v.parts.find(x => x.kind === 'text').text, '1/2');
  assert.equal(new Runtime(build('label start:\n  end\n'), new NullRenderer()).galleryView({ tiles: [], count: 0, total: 0 }, { tiles: {} }).name, 'gallery'); // none of the project's own: the starter
  const title = new Runtime(build('screen title:\n  button g at 0,0 "Gallery" action gallery\n  button s at 0,100 "Go" action start\nlabel start:\n  end\n'), new NullRenderer());
  assert.deepEqual(title.titleView(true, false).parts.map(x => [x.act, x.enabled]), [['gallery', false], ['start', true]]);
  assert.deepEqual(title.titleView(true).parts.map(x => [x.act, x.enabled]), [['gallery', true], ['start', true]]);
});

test('viewerView is the reserved viewer screen: file, title, position and total are shell variables; next and prev are actions', () => {
  const p = build(`screen viewer:
  image "[file]" at 0,0 size 1920,1080
  text at 0,0 "[title] [position]/[total]"
  button prev at 0,100 "<" action prev if total > 1
  button next at 100,100 ">" action next if total > 1
  button done at 0,600 "Back" action close
label start:
  end
`);
  assert.deepEqual(p.diagnostics, []);
  const rt = new Runtime(p, new NullRenderer());
  const v = rt.viewerView({ file: 'bg/park.png', title: 'Park', position: 2, total: 3 });
  assert.deepEqual(v.parts.filter(x => x.kind === 'image').map(x => x.file), ['bg/park.png']);
  assert.equal(v.parts.find(x => x.kind === 'text').text, 'Park 2/3');
  assert.deepEqual(v.parts.filter(x => x.act).map(x => x.act), ['prev', 'next', 'close']);
  // a single picture hides the paging buttons
  assert.deepEqual(rt.viewerView({ file: 'bg/park.png', title: 'Park', position: 1, total: 1 }).parts.filter(x => x.act).map(x => x.act), ['close']);
  assert.equal(new Runtime(build('label start:\n  end\n'), new NullRenderer()).viewerView({ file: '', title: '', position: 1, total: 0 }).name, 'viewer');
});

test('each limit caps the entries and must be a whole number', () => {
  const capped = build('screen s:\n  each xs as x limit 2:\n    text at 0,0 "[x]"\n  cancel\nlabel start:\n  set xs = ["a", "b", "c"]\n  end\n');
  assert.deepEqual(capped.diagnostics, []);
  const def = capped.screens.s;
  const view = resolveScreen(def, { xs: ['a', 'b', 'c'] }, { items: {}, text: (id, raw, vars) => raw.replace('[x]', vars.x) });
  assert.deepEqual(view.parts.map(x => x.text), ['a', 'b']);
  const bad = build('screen s:\n  each xs as x limit 0:\n    button x at 0,0 "B"\nlabel start:\n  end\n');
  assert.ok(bad.diagnostics.some(d => /limit/.test(d.message)));
});

test('scroll areas: parse, and misuse is an error', () => {
  const ok = build('screen s:\n  scroll at 10,20 size 300,100 bar off:\n    button a at 0,0 size 100,40 "A"\n    text at 0,60 "T"\nlabel start:\n  end\n');
  assert.deepEqual(ok.diagnostics, []);
  assert.equal(ok.screens.s.body[0].bar, false);
  const bad = body => build(`screen s:\n${body}\nlabel start:\n  end\n`).diagnostics.map(d => d.message).join('\n');
  assert.match(bad('  scroll at 0,0 size 100,100:\n    scroll at 0,0 size 10,10:\n      button a at 0,0 "A"'), /inside another scroll/);
  assert.match(bad('  column at 0,0:\n    scroll at 0,0 size 100,100:\n      button a "A"'), /directly in the screen/);
  assert.match(bad('  scroll at 0,0 size 100,100:\n    hotspot h poly 0,0 10,0 10,10'), /poly or mask/);
  assert.match(bad('  scroll at 0,0 size 0,100:\n    button a at 0,0 "A"'), /size above zero/);
  assert.match(bad('  scroll size 10,10:\n    button a at 0,0 "A"'), /Use: scroll/);
  assert.match(bad('  scroll at 0,0 size 10,10 start middle:\n    button a at 0,0 "A"'), /top or bottom/);
});

test('a scroll area short enough to fit has contentH equal to its height', () => {
  const p = build('screen s:\n  scroll at 0,0 size 300,500:\n    button a at 0,0 size 100,40 "A"\nlabel start:\n  end\n');
  const view = resolveScreen(p.screens.s, {}, { items: {}, text: (id, raw) => raw });
  assert.equal(view.parts.find(x => x.kind === 'scroll').contentH, 500);
});

test('sliderReadout shows percentages, and the plain number for text speed', () => {
  assert.equal(sliderReadout('master', 0.65), '65%');
  assert.equal(sliderReadout('text_size', 1.2), '120%');
  assert.equal(sliderReadout('text_speed', 40), '40');
});

test('slider and action cycle are checked', () => {
  const bad = text => errors(build(text + '\nlabel start:\n  show screen s\n'));
  assert.match(bad('screen s:\n  slider volume at 1,1')[0], /slider needs a setting/);
  assert.match(bad('screen s:\n  slider master')[0], /needs a position/);
  assert.match(bad('screen s:\n  button mute at 1,1 "M" action cycle')[0], /id must be one of/);
  assert.deepEqual(bad('screen s:\n  column gap 4:\n    slider master size 300,30\n    slider music size 300,30\n'), []);
});

test('bad screens are reported', () => {
  const bad = text => errors(build(text + '\nlabel start:\n  show screen s\n'));
  assert.match(bad('screen s:\n  hotspot a poly 1,1 2,2 "A"')[0], /at least three points/);
  assert.match(bad('screen s:\n  hotspot a "A"')[0], /needs a shape/);
  assert.match(bad('screen s:\n  button a size 10,10 "A"')[0], /needs a position/);
  assert.match(bad('screen s:\n  button a at 1,1\n  button a at 2,2')[0], /Duplicate element id/);
  assert.match(bad('screen s:\n  button a at 1,1\n  default zzz')[0], /not an element/);
  assert.match(bad('screen s:\n  wobble a')[0], /Unknown screen element/);
  assert.match(bad('screen s:\n  button a at 1,1 if random() > 1')[0], /random/);
  assert.match(bad('set bag = []\nscreen s:\n  each bag as it:\n    button other at 1,1 "x"')[0], /must be "it"/);
  assert.match(errors(build('label start:\n  show screen nowhere\n'))[0], /Unknown screen "nowhere"/);
  assert.match(errors(build('label start:\n  show screen\n'))[0], /Use: show screen/);
  assert.match(errors(build('screen s:\n  button a at 1,1\nscreen s:\n  button a at 1,1'))[0], /defined twice/);
  assert.match(warnings(build('screen s:\n  button a at 99999,1 "A"'))[0], /outside/);
  assert.ok(warnings(build('screen s:\n  text at 1,1 "hi"')).some(w => /nothing to choose/.test(w)));
  assert.ok(warnings(build('screen s:\n  each ghost as g:\n    button g at 0,0 "x"')).some(w => /"ghost" is used as a list/.test(w)));
  assert.ok(warnings(build('screen s:\n  button a at 1,1 "A" if nothing_sets_this')).some(w => /never assigned/.test(w)));
  assert.deepEqual(validateScreen(build('screen s:\n  button a at 1,1').screens.s).map(x => x.severity), []);
});

test('define item: name, id, image; loop variables are not story variables', () => {
  const p = build('define item key "Brass key" #ab12 image=ui/key.png\ndefine item coin\nset bag = []\nscreen s:\n  each bag as it:\n    button it at 0,0 "[it.name]" if it.index > 0\nlabel start:\n  end');
  assert.deepEqual(p.items.key, { id: 'key', name: 'Brass key', nameId: 'ab12', image: 'ui/key.png', src: { file: 's.vn', line: 1 } });
  assert.equal(p.strings.ab12, 'Brass key');
  assert.equal(p.items.coin.name, 'coin');
  assert.ok(warnings(p).some(w => /Item coin has no display name/.test(w)));
  assert.deepEqual(errors(p), []);
  assert.ok(!warnings(p).some(w => /never assigned/.test(w)));
  assert.equal(build('define item key "A"\ndefine item key "B"').diagnostics.filter(d => /defined twice/.test(d.message)).length, 1);
  // a character called item is still a character
  assert.equal(build('define item "The Item"').characters.item.name, 'The Item');
});

// ---- resolution ----

test('resolveScreen applies conditions, enabled, each and item names', () => {
  const p = build(MAP);
  let v = view(p, 'map', { bag: ['key', 'coin'], seen: 0 });
  assert.deepEqual(v.parts.filter(x => 'id' in x).map(x => [x.id, x.enabled]), [['cafe', true], ['hill', false], ['leave', true]]);
  assert.equal(v.parts.find(x => x.kind === 'text').text, 'Carrying key, coin'); // interpolate; names need the runtime's table
  v = view(p, 'map', { bag: [], seen: 2 });
  assert.deepEqual(v.parts.filter(x => 'id' in x).map(x => [x.id, x.enabled]), [['cafe', true], ['lake', true], ['hill', true], ['leave', true]]);
  assert.equal(defaultAnswer(v), 'lake');
  assert.equal(defaultAnswer(view(p, 'map', { seen: 0 })), 'cafe'); // the declared default is hidden: the first enabled one
  const inv = build('define item key "Brass key" image=ui/key.png\nset bag = ["key", "rock"]\nscreen inv:\n  each bag as it at 100,200 step 0,50\n    image "[it.image]" at 0,0\n    button it at 10,0 size 300,40 "[it.name]"\nlabel start:\n  end');
  const iv = view(inv, 'inv', { bag: ['key', 'rock'] });
  const buttons = iv.parts.filter(x => x.kind === 'button');
  assert.deepEqual(buttons.map(b => [b.id, b.label, b.shape.x, b.shape.y]), [['key', 'Brass key', 110, 200], ['rock', 'rock', 110, 250]]);
  assert.deepEqual(iv.parts.filter(x => x.kind === 'image').map(i => [i.file, i.y]), [['ui/key.png', 200], ['', 250]]);
});

test('answers: defaults, stale replays and empty screens', () => {
  const p = build(MAP);
  const v = view(p, 'map', { seen: 0 });
  assert.equal(replayAnswer(v, 'leave'), 'leave');
  assert.equal(replayAnswer(v, 'lake'), 'cafe'); // no longer shown: falls back to the default
  assert.equal(replayAnswer(v, undefined), 'cafe');
  assert.equal(replayAnswer(v, ''), 'cafe'); // cancel is not declared
  const none = build('screen s:\n  button a at 1,1 "A" if false\nlabel start:\n  end');
  assert.ok(!blocks(view(none, 'infinite' in none.screens ? 'infinite' : 's')));
  assert.equal(defaultAnswer(view(none, 's')), '');
  assert.ok(blocks(view(build('screen s:\n  cancel\nlabel start:\n  end'), 's')));
  assert.equal(replayAnswer(view(build('screen s:\n  cancel\nlabel start:\n  end'), 's'), ''), '');
});

// ---- runtime ----

test('show screen stores the chosen id and the story branches on it', async () => {
  const p = build(MAP);
  const r = new NullRenderer();
  r.picker = v => (v.parts.some(x => x.id === 'cafe') ? 'cafe' : 'leave');
  const rt = new Runtime(p, r);
  await rt.start();
  assert.deepEqual(r.says.map(s => s.text), ['Cafe.']);
  assert.equal(rt.vars.place, 'cafe');
  assert.deepEqual(rt.choices, ['cafe']);
  assert.equal(r.screens.length, 1);
});

test('the default variable is "screen", and an empty screen returns "" at once without an answer', async () => {
  const p = build('screen s:\n  button a at 1,1 "A" if false\nlabel start:\n  show screen s\n  "Got [screen]."\n  end\n');
  const r = new NullRenderer();
  const rt = new Runtime(p, r);
  await rt.start();
  assert.equal(r.screens.length, 0); // never shown
  assert.deepEqual(r.says.map(s => s.text), ['Got .']);
  assert.deepEqual(rt.choices, []);
});

test('screen answers survive save, load, restore and rollback', async () => {
  const p = build(`
set bag = ["key"]
screen s:
  each bag as it
    button it at 0,0 "x"
  button done at 5,5 "Done"
label start:
  show screen s as pick
  "one [pick]"
  show screen s as pick
  "two [pick]"
  set bag += "coin"
  show screen s as pick
  "three [pick]"
  end
`);
  const r = new NullRenderer();
  const seq = ['key', 'done', 'coin'];
  r.picker = () => seq.shift();
  const rt = new Runtime(p, r);
  await rt.start();
  assert.deepEqual(r.says.map(s => s.text), ['one key', 'two done', 'three coin']);
  assert.deepEqual(rt.choices, ['key', 'done', 'coin']);
  const save = rt.save();
  // a fresh runtime restores to the last line by replaying the recorded answers
  const r2 = new NullRenderer();
  r2.say = () => new Promise(() => {}); // wait at the line instead of running on
  const rt2 = new Runtime(p, r2);
  void rt2.restore({ file: 's.vn', line: 11 }, save.choices);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(rt2.vars.pick, 'done');
  assert.deepEqual(rt2.choices, ['key', 'done']);
  // rollback by step: steps count lines and screens, so step 4 is the third screen; it is shown live, the first two were replayed
  const r3 = new NullRenderer();
  r3.screen = async v => { r3.screens.push(v); return new Promise(() => {}); };
  const rt3 = new Runtime(p, r3);
  void rt3.restore({ step: 4 }, save.choices);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(r3.screens.length, 1);
  assert.ok(r3.screens[0].parts.some(x => x.id === 'coin'));
  assert.equal(rt3.step, 4);
  assert.deepEqual(rt3.choices, ['key', 'done']);
  // load a save taken at a screen: it opens again
  const r4 = new NullRenderer();
  r4.picker = () => 'done';
  const rt4 = new Runtime(p, r4);
  await rt4.load({ ...save, pc: save.pc - 3, choices: save.choices.slice(0, 2) });
  assert.ok(r4.screens.length >= 1);
});

test('restore into a screen loop never hangs and uses the default answer', async () => {
  const p = build(`
screen s:
  button more at 0,0 "More"
  button stop at 0,200 "Stop"
  default more
label start:
  show screen s
  if screen == "stop":
    jump out
  jump start
label out:
  "Out."
  end
`);
  const r = new NullRenderer();
  const rt = new Runtime(p, r);
  const out = p.ops.findIndex(o => o.op === 'say');
  await rt.restore({ file: 's.vn', line: p.ops[out].src.line });
  assert.deepEqual(r.says.map(s => s.text), ['Out.']); // the loop never ends by itself: it jumped straight to the line
});

test('a stale recorded answer falls back to the default when the script changed', async () => {
  const p = build('screen s:\n  button a at 0,0 "A"\n  button b at 0,100 "B"\nlabel start:\n  show screen s\n  "[screen]"\n  end\n');
  const r = new NullRenderer();
  const rt = new Runtime(p, r);
  await rt.restore({ file: 's.vn', line: 6 }, ['gone']);
  assert.equal(rt.vars.screen, 'a');
});

test('[bag] shows item names, localized', async () => {
  const p = build('define item key "Brass key" #ab12\ndefine item coin "Coin"\nset bag = ["key", "coin", "rock"]\nlabel start:\n  "You have [bag]."\n  end');
  const r = new NullRenderer();
  await new Runtime(p, r).start();
  assert.equal(r.says[0].text, 'You have Brass key, Coin, rock.');
  const r2 = new NullRenderer();
  await new Runtime(p, r2, new Locale({ fi: { ab12: 'Messingavain' } }, 'fi')).start();
  assert.equal(r2.says[0].text, 'You have Messingavain, Coin, rock.');
  assert.equal(interpolate('[bag]', { bag: ['key'] }, { key: 'K' }), 'K');
});

// ---- ids, assets, completions ----

test('assignIds numbers labels, texts and item names, and leaves them alone afterwards', () => {
  const src = 'define item key "Brass key" image=ui/key.png\nscreen s:\n  image "ui/a.png"\n  text at 1,1 "Hi" if x == "a"\n  hotspot h mask "ui/m.png" at 0,0 size 5,5 "Hotspot" cursor help\n  hotspot g at 0,0 size 5,5 if y == "q"\n  button b at 1,1 "Go" enabled z\n';
  const once = assignIds(src, existingIds([src]), rngFrom(1));
  assert.equal(once.added, 4); // image, the unlabeled hotspot and the conditions get none
  const lines = once.text.split('\n');
  assert.match(lines[0], /^define item key "Brass key" #[a-z0-9]{4} image=ui\/key\.png$/);
  assert.match(lines[3], /^ {2}text at 1,1 "Hi" #[a-z0-9]{4} if x == "a"$/);
  assert.match(lines[4], /"Hotspot" #[a-z0-9]{4} cursor help$/);
  assert.equal(lines[5], '  hotspot g at 0,0 size 5,5 if y == "q"');
  const again = assignIds(once.text, existingIds([once.text]), rngFrom(2));
  assert.equal(again.added, 0);
  assert.equal(existingIds([once.text]).size, 4);
  assert.deepEqual(errors(build(once.text + '\nlabel start:\n  show screen s\n')), []);
});

test('checkAssets and preloads cover screen images, masks and item images', () => {
  const p = build('define item key "K" image=ui/key.png\nset bag = []\nscreen s:\n  image "ui/map.png"\n  image "[it.image]"\n  hotspot m mask "ui/mask.png" "M"\n  each bag as it\n    button it at 0,0 "x"\nscreen other:\n  image "ui/nope.png"\n  button b at 0,0 "B"\nlabel start:\n  "x"\n  show screen s\n  end\n');
  const index = { files: ['ui/map.png', 'ui/key.png', 'bg/park.png'] };
  const msgs = checkAssets(p, index).map(d => d.message);
  assert.ok(msgs.some(m => /No image "ui\/mask.png".*mask of hotspot m/.test(m)));
  assert.ok(msgs.some(m => /No image "ui\/nope.png".*screen other/.test(m)));
  assert.ok(!msgs.some(m => /ui\/map\.png|ui\/key\.png|\[it/.test(m)));
  assert.deepEqual(checkAssets(p, { files: [] }), []); // no images at all: a prototype stays quiet
  const pre = attachPreloads(p, index);
  const keys = Object.values(pre.tasks).flat().map(t => t.key);
  assert.ok(keys.includes('ui/map') && keys.includes('ui/key')); // the item image comes along because the screen lists items
  assert.ok(!keys.includes('ui/nope'));
});

test('completions know screens, elements and define item', () => {
  const p = build(MAP);
  const labels = (prefix) => getCompletions(p, prefix).map(s => s.label);
  assert.ok(labels('').includes('hotspot') && labels('').includes('screen'));
  assert.ok(labels('show ').includes('screen'));
  assert.deepEqual(labels('show screen '), ['map']);
  assert.deepEqual(labels('show screen map '), ['as']);
  assert.ok(labels('hotspot cafe ').includes('poly'));
  assert.deepEqual(labels('define '), ['item']);
  assert.ok(labels('define item key "K" ').includes('image='));
  assert.ok(labels('default ').includes('cafe'));
});

test('a new line offers screen elements inside a screen block and story commands outside it', () => {
  const p = build(MAP);
  const labels = (inScreen) => getCompletions(p, '  ', {}, [], inScreen).map(s => s.label);
  assert.ok(labels(true).includes('hotspot') && !labels(true).includes('show') && !labels(true).includes('jump'));
  assert.ok(labels(false).includes('show') && !labels(false).includes('hotspot'));
  assert.ok(labels(undefined).includes('show') && labels(undefined).includes('hotspot'));
  const above = ['screen map:', '  text at 0,0 "Hi"', '', '  # note'];
  assert.equal(insideScreen(above, true), true);
  assert.equal(insideScreen(above, false), false); // an unindented line is never an element
  assert.equal(insideScreen(['screen a:', '  text at 0,0 "x"', 'label start:', '  "Hi"'], true), false);
  assert.equal(insideScreen([], true), false);
});

test('inside a screen block `image` is the element, outside it the story command', () => {
  const p = build(MAP);
  const at = (prefix, inScreen) => getCompletions(p, prefix, {}, [], inScreen, ['ui/map.png']).map(s => s.label);
  assert.deepEqual(at('  image ', true), []); // the file is a quoted string
  assert.deepEqual(at('  image "a" ', true), ['at', 'size', 'if']);
  assert.deepEqual(at('  image "ui/', true), ['ui/map.png']); // typing the quote offers the paths
  assert.deepEqual(at('image ', false), ['show', 'move', 'hide']);
  assert.deepEqual(at('image ', undefined), ['show', 'move', 'hide']);
});

test('completions offer the project files for asset parameters', () => {
  const p = build(MAP);
  const files = ['bg/park.png', 'cafe.jpg', 'music/theme.ogg', 'sound/click.wav', 'movie/rain.webm', 'ui/map.png', 'char/alice/neutral.png'];
  const at = (prefix) => getCompletions(p, prefix, {}, [], undefined, files).map(s => s.label);
  assert.ok(at('scene ').includes('park') && at('scene ').includes('cafe'));
  assert.deepEqual(at('music play '), ['theme']);
  assert.ok(at('sound play ').includes('click') && at('movie play ').includes('rain'));
  assert.ok(at('image show lamp ').includes('ui/map.png'));
  assert.ok(at('  image "').includes('ui/map.png') && at('  image "').includes('char/alice/neutral.png'));
  assert.ok(at('hotspot a mask "u').includes('ui/map.png'));
  assert.deepEqual(at('button b hover sound "'), ['click']);
  assert.ok(at('define item key "K" image=').includes('ui/map.png'));
  assert.ok(getCompletions(p, '  image "', {}, [], undefined, files).every(s => s.path));
  assert.deepEqual(at('  text at 0,0 "Hi [').filter(l => l.includes('/')), []); // plain text is untouched
});

test('the sample screens script compiles clean', async () => {
  const fs = await import('node:fs');
  const files = fs.readdirSync('games/sample/script').filter(f => f.endsWith('.vn')).map(f => ({ file: f, text: fs.readFileSync(`games/sample/script/${f}`, 'utf8') }));
  const p = compile(files);
  assert.deepEqual(p.diagnostics.filter(d => d.severity === 'error'), []);
  assert.ok(p.screens.town_map && p.screens.inventory && p.items.key.image);
});

test('assignIds terminates with a degenerate (constant) rng: ids grow longer instead of looping', () => {
  const src = 'label a:\n  "one"\n  "two"\n  "three"\n';
  const r = assignIds(src, new Set(), () => 0.5);
  const ids = [...r.text.matchAll(/#([a-z0-9]+)/g)].map(m => m[1]);
  assert.equal(ids.length, 3);
  assert.equal(new Set(ids).size, 3);
  assert.deepEqual(ids.map(i => i.length), [4, 5, 6]);
});

test('focus hints: parse, resolve (also inside each) and validate', () => {
  const p = build('screen s:\n  button a at 1,1 "A" right c down b\n  button b at 1,1 "B"\n  button up at 2,2 "Up"\n  button c at 3,3 "C" up a if true\nlabel start:\n  show screen s\n');
  assert.deepEqual(errors(p), []);
  assert.deepEqual(p.screens.s.body.map(n => n.focus), [{ right: 'c', down: 'b' }, {}, {}, { up: 'a' }]); // an element may even be named like a direction
  const view = resolveScreen(p.screens.s, {}, { text: (_id, raw) => raw, items: {} });
  assert.deepEqual(view.parts.map(x => x.focus.right ?? null), ['c', null, null, null]);
  const q = build('set bag = ["x", "y"]\nscreen s:\n  each bag as it:\n    button it at 0,0 "[it]" right it\nlabel start:\n  show screen s\n');
  assert.deepEqual(errors(q), []);
  const each = resolveScreen(q.screens.s, { bag: ['x', 'y'] }, { text: (_id, raw) => raw, items: {} });
  assert.deepEqual(each.parts.map(x => x.focus.right), ['x', 'y']);
  const bad = text => errors(build(text + '\nlabel start:\n  show screen s\n'));
  assert.match(bad('screen s:\n  button a at 1,1 "A" left zzz')[0], /"a" moves focus to "zzz"/);
  assert.match(bad('screen s:\n  button a at 1,1 "A" left')[0], /left needs the id/);
});

// ---- layout containers ----

const boxes = (p, name, vars) => view(p, name, vars).parts.map(x => (x.id ? [x.id, x.bounds.x, x.bounds.y] : [x.kind, x.x, x.y]));

test('a column stacks its children with a gap and aligns them across', () => {
  const p = build(`screen s:
  column at 100,200 gap 20 align center:
    button a "Play"
    button b "Options"
label start:
  end
`);
  assert.deepEqual(errors(p), []);
  assert.deepEqual(boxes(p, 's'), [['a', 120, 200], ['b', 100, 304]]); // "Play" is 200 wide, "Options" 240: centred across
});

test('a row anchored to a corner sits inside the margin; a grid fills row by row in fixed cells', () => {
  const p = build(`screen s:
  row anchor topright margin 40 gap 16:
    button a "A"
    button b "B"
screen g:
  grid 2 at 0,0 cell 300,100 gap 10:
    button a "A"
    button b "B"
    button c "C"
label start:
  end
`);
  assert.deepEqual(errors(p), []);
  assert.deepEqual(boxes(p, 's'), [['a', 1464, 40], ['b', 1680, 40]]); // 2 x 200 + 16 wide, 40 from the right edge
  assert.deepEqual(boxes(p, 'g'), [['a', 0, 0], ['b', 310, 0], ['c', 0, 110]]);
});

test('each inside a layout spreads its entries; nested layouts are placed as one block; conditions drop children', () => {
  const p = build(`define item key "Brass key"
define item coin "Silver coin"
set bag = ["key", "coin"]
set hide = 1
screen s:
  column at 50,50 gap 10:
    text "Bag"
    each bag as item:
      button item "[item.name]"
    row gap 5:
      button x "X" if hide == 0
      button y "Y"
label start:
  end
`);
  assert.deepEqual(errors(p), []);
  // text is 3 chars (72 wide) x 48 high; buttons are 84 high; the row holds only Y
  assert.deepEqual(boxes(p, 's', { bag: ['key', 'coin'], hide: 1 }), [['text', 50, 50], ['key', 50, 108], ['coin', 50, 202], ['y', 50, 296]]);
  assert.deepEqual(boxes(p, 's', { bag: [], hide: 0 }).map(b => b[0]), ['text', 'x', 'y']);
});

test('layout syntax errors', () => {
  const msgs = text => errors(build(text + '\nlabel start:\n  end\n'));
  assert.match(msgs('screen s:\n  column:\n    button a at 1,1 "A"')[0], /remove "at"/);
  assert.match(msgs('screen s:\n  row:\n    image "x.png"')[0], /needs size/);
  assert.match(msgs('screen s:\n  row:\n    hotspot h poly 1,1 5,5 9,1 "H"')[0], /rectangle or ellipse/);
  assert.match(msgs('screen s:\n  row at 1,1 anchor top:\n    button a "A"')[0], /either/);
  assert.match(msgs('screen s:\n  column:\n    row at 1,1:\n      button a "A"')[0], /placed by it/);
  assert.match(msgs('screen s:\n  grid:\n    button a "A"')[0], /column count/);
  assert.match(msgs('screen s:\n  row anchor middle:\n    button a "A"')[0], /anchor needs/);
  assert.match(msgs('screen s:\n  row:\n    button a "A"\n  button a at 1,1 "A2"')[0], /Duplicate element id/);
});

test('layout children keep their ids for answers, focus and handlers', () => {
  const p = build(`screen s:
  row anchor bottom margin 20 gap 10:
    button a "A" right b
    button b "B" on click l
label l:
  return
label start:
  end
`);
  assert.deepEqual(errors(p), []);
  const v = view(p, 's');
  assert.equal(v.parts[0].focus.right, 'b');
  assert.deepEqual(v.parts.map(x => x.bounds.y), [976, 976]); // bottom: 1080 - 20 - 84
});

test('a screen with parameters: one layout, bound per show screen, checked at compile time', async () => {
  const p = build(`
screen room(name, locked):
  text at 0,0 "In the [name]"
  button exit at 5,5 "Leave" if not locked
  button knock at 5,50 "Knock" if locked
label start:
  show screen room("hall", false) as a
  "a [a]"
  set n = 1
  show screen room("attic", n > 0) as b
  "b [b]"
  end
`);
  assert.equal(p.diagnostics.filter(d => d.severity === 'error').length, 0);
  const r = new NullRenderer();
  const seq = ['exit', 'knock'];
  r.picker = () => seq.shift();
  r.screen = async v => { r.screens.push(v); return r.picker(v); };
  const rt = new Runtime(p, r);
  await rt.start();
  assert.deepEqual(r.says.map(s => s.text), ['a exit', 'b knock']);
  assert.deepEqual(r.screens[0].parts.map(x => x.id).filter(Boolean), ['exit']);
  assert.deepEqual(r.screens[1].parts.map(x => x.id).filter(Boolean), ['knock']);
  assert.ok(r.screens[0].parts.some(x => x.text === 'In the hall'));
  assert.ok(r.screens[1].parts.some(x => x.text === 'In the attic'));
  assert.equal(rt.vars.name, undefined, 'a parameter is not a story variable');

  const errs = src => build(src).diagnostics.filter(d => d.severity === 'error').map(d => d.message);
  assert.match(errs('screen s(a, b):\n  button x at 0,0 "x"\nlabel start:\n  show screen s(1) as c\n').join(), /takes 2 arguments \(a, b\), but show screen gives 1/);
  assert.match(errs('screen s:\n  button x at 0,0 "x"\nlabel start:\n  show screen s(1) as c\n').join(), /takes 0 arguments/);
  assert.match(errs('screen s(a):\n  button x at 0,0 "x"\nlabel start:\n  hud on s\n').join(), /takes parameters/);
  assert.match(errs('screen s(a):\n  button x at 0,0 "x"\nlabel start:\n  show screen s(random(1, 3)) as c\n').join(), /cannot be used in a screen argument/);
});

test('textbox off marks the screen view so the shell hides the text box; the default keeps it', async () => {
  const p = build(`
screen room:
  textbox off
  button go at 0,0 "Go"
screen ask:
  button yes at 0,0 "Yes"
label start:
  "Where to?"
  show screen room as a
  show screen ask as b
  end
`);
  assert.equal(p.diagnostics.filter(d => d.severity === 'error').length, 0);
  const r = new NullRenderer();
  r.screen = async v => { r.screens.push(v); return v.parts.find(x => x.id)?.id ?? ''; };
  await new Runtime(p, r).start();
  assert.equal(r.screens[0].hideBox, true);
  assert.equal(r.screens[1].hideBox, undefined);
  assert.match(build('screen s:\n  textbox maybe\n  button x at 0,0 "x"\n').diagnostics.map(d => d.message).join(), /Use: textbox off/);
});

test('a hotspot or button ending in a colon owns child elements: stage coordinates, parent ids, conditions', () => {
  const src = `
set open = false
screen bar:
  hotspot strip at 0,0 size 1920,40 hover none on focus o on blur c:
    button key at 100,60 size 200,80 "Key" if open
    button coin at 300,60 size 200,80 "Coin":
      hotspot tip at 300,160 size 50,50 "Tip"
label o:
  set open = true
  return
label c:
  set open = false
  return
label start:
  hud on bar
  end
`;
  const p = build(src);
  assert.deepEqual(errors(p), []);
  const closed = view(p, 'bar').parts;
  assert.deepEqual(closed.map(x => x.id), ['strip', 'coin', 'tip']);
  const open = view(p, 'bar', { open: true }).parts;
  assert.deepEqual(open.map(x => [x.id, x.parent]), [['strip', undefined], ['key', 'strip'], ['coin', 'strip'], ['tip', 'coin']]);
  assert.deepEqual(open[1].bounds, { x: 100, y: 60, w: 200, h: 80 }); // not shifted by the parent
  assert.equal(open[0].on.focus, 'o');
  // a handler label that does not exist inside a child is still found
  assert.match(errors(build('screen s:\n  hotspot a at 0,0 size 9,9:\n    button b at 0,0 "b" on click nope\n')).join(), /Unknown label "nope"/);
});

test('nested elements: a trailing colon needs a body, ids stay unique, and an each cannot repeat a group', () => {
  assert.match(errors(build('screen s:\n  hotspot a at 0,0 size 9,9:\n  button b at 0,0 "b"\n')).join(), /Expected an indented block/);
  assert.match(errors(build('screen s:\n  hotspot a at 0,0 size 9,9:\n    button a at 0,0 "b"\n')).join(), /Duplicate element id "a"/);
  assert.match(errors(build('set xs = ["a"]\nscreen s:\n  each xs as x:\n    button x at 0,0 "b":\n      button y at 0,0 "c"\n')).join(), /cannot repeat/);
  // localization ids are written for a child's label as for any other
  const r = assignIds('screen s:\n  hotspot a at 0,0 size 9,9 "A":\n    button b at 0,0 "B"\n', new Set(), rngFrom(1));
  assert.equal(r.added, 2);
});

test('text takes a color, and a bad one is an error', () => {
  const ok = build(['screen gallery:', '  text at 0,0 "Dim" color #6b7385', 'label start:', '  end', ''].join('\n'));
  assert.deepEqual(ok.diagnostics.filter(d => d.severity === 'error'), []);
  assert.equal(new Runtime(ok, new NullRenderer()).galleryView({ tiles: [], count: 0, total: 0 }, { tiles: {} }).parts.find(x => x.kind === 'text').color, '#6b7385');
  const bad = build(['screen gallery:', '  text at 0,0 "Dim" color', 'label start:', '  end', ''].join('\n'));
  assert.ok(bad.diagnostics.some(d => d.severity === 'error' && /color/.test(d.message)));
});

test('the starter options screen: a page at a time, optional settings only when the game offers them, words for showing', () => {
  const rt = new Runtime(build('label start:\n  end\n'), new NullRenderer());
  const base = { master: 1, music: 1, sound: 1, voice: 1, text_speed: 40, text_size: 1, box_opacity: 1, speaker_focus: 'none', has_languages: false, has_themes: false, has_voice_languages: false, has_fullscreen: true, tab: '',
    text_sounds_word: 'On', auto_speed_word: 'Normal', skip_word: 'Read text only', speaker_focus_word: 'On', language_word: 'en', theme_word: '', voice_language_word: 'Same as text', reduce_motion_word: 'Off', captions_word: 'Off', announce_lines_word: 'On', timed_choices_word: 'Normal' };
  const ids = view => view.parts.filter(x => x.kind === 'slider' || x.id).map(x => x.kind === 'slider' ? `slider:${x.setting}` : x.id);
  assert.deepEqual(ids(rt.optionsView(base)), ['audio', 'game', 'access', 'slider:master', 'slider:music', 'slider:sound', 'slider:voice', 'text_sounds', 'full', 'done']);
  assert.deepEqual(rt.optionsView(base).parts.filter(x => x.role === 'tab').map(x => [x.id, x.checked]), [['audio', true], ['game', false], ['access', false]]); // the shown tab is lit
  assert.equal(rt.optionsView(base).parts.find(x => x.id === 'text_sounds').label, 'On');
  assert.deepEqual(ids(rt.optionsView({ ...base, tab: 'game' })).slice(3), ['slider:text_speed', 'auto_speed', 'skip', 'reset', 'full', 'done']);
  assert.deepEqual(ids(rt.optionsView({ ...base, tab: 'game', has_languages: true, has_themes: true, has_voice_languages: true, speaker_focus: 'on' })).slice(3), ['slider:text_speed', 'auto_speed', 'skip', 'speaker_focus', 'language', 'theme', 'voice_language', 'reset', 'full', 'done']);
  assert.deepEqual(ids(rt.optionsView({ ...base, tab: 'access' })).slice(3), ['slider:text_size', 'slider:box_opacity', 'reduce_motion', 'captions', 'announce_lines', 'timed_choices', 'full', 'done']);
});

test('the starter saves screen: a card per slot with its own rename and delete buttons, only where they apply', () => {
  const rt = new Runtime(build('label start:\n  end\n'), new NullRenderer());
  const entries = {
    pages: { page1: { name: '1' } },
    slots: { 1: { title: 'Slot 1', heading: 'Slot 1', label: '', when: '', text: 'Empty', empty: true, thumb: '', removable: false, renamable: false },
      2: { title: 'Slot 2', heading: 'Bench', label: 'Bench', when: '12:00', text: 'Hi', empty: false, thumb: 'data:image/jpeg;base64,AAAA', removable: true, renamable: true } },
  };
  const vars = { mode: 'save', page: 'page1', pages: ['page1'], slots: ['1', '2'], deleting: false, note: '', can_rename: true };
  const view = rt.savesView(vars, entries);
  assert.deepEqual(view.parts.filter(x => x.id).map(x => x.id), ['page1', 'done', '1', '2', '2.rename', '2.remove']);
  assert.deepEqual(view.parts.filter(x => x.kind === 'image').map(x => x.file), ['data:image/jpeg;base64,AAAA']);
  assert.deepEqual(view.parts.filter(x => x.kind === 'text' && x.lines).map(x => [x.text, x.lines]), [['Slot 1', 1], ['Bench', 1], ['Hi', 1]]);
  assert.equal(rt.savesView({ ...vars, can_rename: false }, entries).parts.some(x => x.act === 'rename'), false);
});

test('inside an each an element id may be <entry>.<word>, and nothing else; text takes lines n', () => {
  const ok = build('screen s:\n  each slots as slot at 0,0 step 0,100:\n    button slot at 0,0 size 400,80 "x"\n    button slot.remove at 360,0 size 40,40 "x" action remove\n    text at 0,50 "x" width 300 lines 2\nlabel start:\n  end\n');
  assert.deepEqual(errors(ok), []);
  assert.equal(ok.screens.s.body[0].body[2].lines, 2);
  const bad = build('screen s:\n  each slots as slot at 0,0 step 0,100:\n    button other at 0,0 size 40,40 "x"\nlabel start:\n  end\n');
  assert.ok(errors(bad).length > 0);
  assert.ok(errors(build('screen s:\n  text at 0,0 "x" lines 0\nlabel start:\n  end\n')).length > 0);
  // `fit` shrinks the font to the box, so it needs both width and lines.
  const fit = build('screen s:\n  text at 0,0 "x" width 300 lines 2 fit\nlabel start:\n  end\n');
  assert.deepEqual(errors(fit), []);
  assert.equal(fit.screens.s.body[0].fit, true);
  assert.equal(new Runtime(fit, new NullRenderer()).viewOf('s', {}).parts[0].fit, true);
  assert.match(errors(build('screen s:\n  text at 0,0 "x" lines 2 fit\nlabel start:\n  end\n'))[0], /fit .*width and lines/);
});

test('a button takes sub "text": a second line inside it, worked out with variables, and a taller button', () => {
  const p = build('screen s:\n  column at 0,0 gap 10:\n    button a "Go" sub "Saved [k]" action close\n    button b "Plain" action close\nlabel start:\n  end\n');
  assert.deepEqual(errors(p), []);
  const view = resolveScreen(p.screens.s, { k: 'today' }, { items: {}, text: (id, raw, vars) => raw.replace(/\[(\w+)\]/g, (_, n) => vars[n]) });
  assert.deepEqual(view.parts.map(x => [x.label, x.sub]), [['Go', 'Saved today'], ['Plain', undefined]]);
  assert.ok(view.parts[0].shape.h > view.parts[1].shape.h);
  assert.match(errors(build('screen s:\n  text at 0,0 "x" sub "T"\nlabel start:\n  end\n'))[0], /sub "text" goes on a button/);
});
