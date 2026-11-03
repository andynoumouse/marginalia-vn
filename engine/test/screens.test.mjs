import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seededRng as rngFrom } from './rng.mjs';
import {
  compile, Runtime, NullRenderer, Locale, assignIds, existingIds, getCompletions, interpolate, checkAssets, attachPreloads,
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
  assert.equal(new Runtime(build('label start:\n  end\n'), new NullRenderer()).quickView(), null);
});

test('titleView is the reserved title screen; continue is disabled without a save', () => {
  const p = build('screen title:\n  column anchor center gap 12:\n    button s "Start" action start\n    button c "Continue" action continue\n    button q "Quit" action quit\nlabel start:\n  end\n');
  assert.deepEqual(errors(p), []);
  const rt = new Runtime(p, new NullRenderer());
  assert.deepEqual(rt.titleView(true).parts.map(x => [x.act, x.enabled]), [['start', true], ['continue', true], ['quit', true]]);
  assert.deepEqual(rt.titleView(false).parts.map(x => [x.act, x.enabled]), [['start', true], ['continue', false], ['quit', true]]);
  assert.equal(new Runtime(build('label start:\n  end\n'), new NullRenderer()).titleView(true), null);
});

test('pauseView is the reserved pause screen', () => {
  const p = build('screen pause:\n  column anchor center gap 12:\n    button r "Resume" action resume\n    button t "Title" action title\nlabel start:\n  end\n');
  assert.deepEqual(errors(p), []);
  const rt = new Runtime(p, new NullRenderer());
  assert.deepEqual(rt.pauseView().parts.map(x => x.act), ['resume', 'title']);
  assert.equal(new Runtime(build('label start:\n  end\n'), new NullRenderer()).pauseView(), null);
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
  assert.equal(new Runtime(build('label start:\n  end\n'), new NullRenderer()).optionsView({}), null);
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
  assert.equal(new Runtime(build('label start:\n  end\n'), new NullRenderer()).savesView({}, {}), null);
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
  assert.equal(new Runtime(build('label start:\n  end\n'), new NullRenderer()).historyView({}, {}), null);
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
  assert.equal(bare.musicView({}, {}), null);
  assert.equal(bare.chaptersView({}, {}), null);
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
  const t = rt.achievementToastView({ title: 'Key', description: 'Found it', icon: '', ending: false });
  assert.deepEqual(t.parts.map(x => x.kind === 'text' ? x.text : x.kind), ['Key']);
  const bare = new Runtime(build('label start:\n  end\n'), new NullRenderer());
  assert.equal(bare.achievementsView({}, {}), null);
  assert.equal(bare.achievementToastView({}), null);
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
  assert.equal(new Runtime(build('label start:\n  end\n'), new NullRenderer()).galleryView({}, {}), null);
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
  assert.equal(new Runtime(build('label start:\n  end\n'), new NullRenderer()).viewerView({}), null);
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
