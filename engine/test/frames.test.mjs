import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, interpolate, checkAssets, attachPreloads, resolveScreen, sliceDecls, themeCss } from '../../dist/engine/src/index.js';

const errors = p => p.diagnostics.filter(d => d.severity === 'error').map(d => d.message);
const warnings = p => p.diagnostics.filter(d => d.severity === 'warning').map(d => d.message);
const build = text => compile([{ file: 's.vn', text }]);
const view = (p, name, vars = {}) => resolveScreen(p.screens[name], vars, { items: {}, text: (_id, raw, v) => interpolate(raw, v) });
const screen = body => `screen s:\n${body.split('\n').map(l => '  ' + l).join('\n')}\n  button go at 0,0 "Go"\nlabel start:\n  "x"\n  end\n`;
const bad = body => errors(build(screen(body))).join('\n');

test('panel places its children from its top left plus the padding, and fits them without a size', () => {
  const p = build(screen('panel at 100,50 padding 20,30 image "ui/frame.png" slice 16:\n  text at 0,0 "Hello"\n  button ok at 0,60 size 200,80 "Ok"'));
  assert.deepEqual(errors(p), []);
  const [panel, text, ok] = view(p, 's').parts;
  assert.equal(panel.kind, 'panel');
  assert.deepEqual([panel.x, panel.y], [100, 50]);
  assert.deepEqual([text.x, text.y], [130, 70]);
  assert.deepEqual([ok.bounds.x, ok.bounds.y], [130, 130]);
  assert.deepEqual([panel.slice, panel.edge, panel.file], [[16, 16, 16, 16], 'stretch', 'ui/frame.png']);
  // width: 30 + widest child (the button, 200) + 30; height: 20 + 140 + 20
  assert.deepEqual([panel.w, panel.h], [260, 180]);
});

test('a panel with a size keeps it, and a fitted one is never smaller than its corners', () => {
  const p = build(screen('panel at 0,0 size 640,360:\n  text at 0,0 "Hi"\npanel at 0,0 image "ui/f.png" slice 40,20,40,20:\n  text at 0,0 "x"'));
  assert.deepEqual(errors(p), []);
  const panels = view(p, 's').parts.filter(x => x.kind === 'panel');
  assert.deepEqual([panels[0].w, panels[0].h, panels[0].file], [640, 360, null]);
  assert.deepEqual([panels[1].w, panels[1].h], [40, 80]); // 20+20 and 40+40: the corners
});

test('the slice and the edge take one, two or four numbers and a name', () => {
  const p = build(screen('panel at 0,0 size 10,10 image "f.png" slice 4,8 edge round'));
  const panel = view(p, 's').parts[0];
  assert.deepEqual([panel.slice, panel.edge], [[4, 8, 4, 8], 'round']);
  assert.match(bad('panel at 0,0 size 10,10 slice 8'), /need the panel's image/);
  assert.match(bad('panel at 0,0 size 10,10 image "f.png" edge wavy'), /edge needs one of/);
  assert.match(bad('panel at 0,0 size 10,10 image "f.png" slice -4'), /negative/);
  assert.match(bad('panel at 0,0 size 0,10'), /size above zero/);
  assert.match(bad('panel at 0,0 size 10,10 colour red'), /Unexpected "colour"/);
});

test('a panel sits in a layout without at, and its children move with it', () => {
  const p = build(screen('row at 100,100 gap 10:\n  panel padding 10:\n    button a at 0,0 size 80,40 "A"\n  panel size 50,50\n'));
  assert.deepEqual(errors(p), []);
  const parts = view(p, 's').parts;
  const [p1, a, p2] = parts;
  assert.deepEqual([p1.x, p1.w, p1.h], [100, 100, 60]); // 10 + 80 + 10, 10 + 40 + 10
  assert.deepEqual([a.bounds.x, a.bounds.y], [110, 110]);
  assert.equal(p2.x, 210); // after the first panel and the gap
  assert.match(bad('row at 0,0:\n  panel at 5,5 size 10,10'), /remove "at"/);
});

test('a scroll area can sit in a panel, and a panel in a scroll area scrolls with it', () => {
  const p = build(screen('panel at 100,100 size 600,400 padding 20:\n  scroll at 0,0 size 500,300:\n    button b at 0,0 size 100,50 "B"\nscroll at 0,500 size 300,200:\n  panel at 0,0 size 100,100:\n    button c at 10,10 size 50,50 "C"'));
  assert.deepEqual(errors(p), []);
  const parts = view(p, 's').parts;
  const area = parts.find(x => x.kind === 'scroll');
  assert.deepEqual([area.x, area.y], [120, 120]);
  const inner = parts.filter(x => x.area !== undefined && x.kind === 'panel');
  assert.equal(inner.length, 1);
  assert.equal(parts.find(x => x.id === 'c').area, parts.filter(x => x.kind === 'scroll')[1].index);
});

test('bar shows the fraction of value between min and max, clamped', () => {
  const p = build(screen('bar hp max 100 at 10,20 size 300,30 readout\nbar mana max top min 10 at 0,100\nbar hp max 0 at 0,200'));
  assert.deepEqual(errors(p), []);
  const [a, b, c] = view(p, 's', { hp: 37, mana: 60, top: 110 }).parts;
  assert.deepEqual([a.kind, a.x, a.y, a.w, a.h, a.fraction, a.readout], ['bar', 10, 20, 300, 30, 0.37, '37 / 100']);
  assert.equal(b.fraction, 0.5); // (60 - 10) / (110 - 10)
  assert.equal(c.fraction, 0); // an empty range
  const [over, under] = view(p, 's', { hp: 250, mana: -5, top: 110 }).parts;
  assert.deepEqual([over.fraction, over.value, over.readout], [1, 100, '100 / 100']);
  assert.equal(view(p, 's', { hp: -5, mana: 0, top: 110 }).parts[0].fraction, 0);
  assert.equal(under.fraction, 0);
  assert.equal(view(p, 's', {}).parts[0].fraction, 0); // an unset variable is 0
});

test('bar takes expressions of one word, a size by default, and art', () => {
  const p = build(screen('bar hp*2 max total+1 at 0,0 back "ui/back.png" fill "ui/fill.png" slice 6 edge repeat padding 4,8 color #ff6688\nbar love at 0,0'));
  assert.deepEqual(errors(p), []);
  const [a, b] = view(p, 's', { hp: 30, total: 99 }).parts;
  assert.equal(a.fraction, 0.6);
  assert.deepEqual([a.back, a.fill, a.slice, a.edge, a.padding, a.color], ['ui/back.png', 'ui/fill.png', [6, 6, 6, 6], 'repeat', [4, 8, 4, 8], '#ff6688']);
  assert.deepEqual([b.w, b.h, b.back, b.slice], [400, 40, null, null]); // the default size and the stock look
});

test('bar needs a variable and a place, and the bad words are told apart', () => {
  assert.match(bad('bar at 0,0'), /bar needs a number or variable/);
  assert.match(bad('bar hp'), /needs a position/);
  assert.match(bad('bar hp at 0,0 slice 4'), /needs a back or fill image/);
  assert.match(bad('bar hp at 0,0 color "red"'), /color needs a color/);
  assert.match(bad('bar hp at 0,0 enabled true'), /cannot be disabled/);
  assert.match(bad('bar hp at 0,0 size 0,5'), /size above zero/);
  assert.match(bad('bar hp at 0,0 blink'), /Unexpected "blink"/);
  assert.match(bad('column at 0,0:\n  bar hp at 1,1'), /remove "at"/);
  const p = build(screen('column at 0,0 gap 10:\n  bar hp size 200,20\n  bar hp size 200,20'));
  assert.deepEqual(errors(p), []);
  const [x, y] = view(p, 's', { hp: 1 }).parts;
  assert.deepEqual([y.y - x.y], [30]);
});

test('a bar reads its variables, so an unset list or unknown one is checked like any expression', () => {
  const p = build('set hp = 5\n' + screen('bar hp max 10 at 0,0 if hp > 0'));
  assert.deepEqual(errors(p), []);
  assert.deepEqual(warnings(p).filter(m => /hp/.test(m)), []);
  assert.deepEqual(errors(build(screen('bar hp max 10 at 0,0 if'))).length > 0, true);
});

test('checkAssets and preloads cover panel frames and bar art', () => {
  const p = build('set hp = 1\n' + screen('panel size 10,10 image "ui/frame.png"\nbar hp at 0,0 back "ui/back.png" fill "ui/gone.png"').replace('  "x"\n', '  show screen s\n  "x"\n'));
  const index = { files: ['ui/frame.png', 'ui/back.png', 'bg/park.png'] };
  const msgs = checkAssets(p, index).map(d => d.message);
  assert.ok(msgs.some(m => /No image "ui\/gone.png".*fill of a bar/.test(m)));
  assert.ok(!msgs.some(m => /frame\.png|back\.png/.test(m)));
  const keys = Object.values(attachPreloads(p, index).tasks).flat().map(t => t.key);
  assert.ok(keys.includes('ui/frame') && keys.includes('ui/back'));
});

test('sliceDecls is the theme frame: the same declarations for a number and a list', () => {
  assert.deepEqual(sliceDecls('assets/ui/box.png', '32'), { 'border-style': 'solid', 'border-width': '32px', 'border-image': 'url("assets/ui/box.png") 32 fill / 32px stretch' });
  assert.equal(sliceDecls('a.png', '1 2 3 4', 'round')['border-image'], 'url("a.png") 1 2 3 4 fill / 1px 2px 3px 4px round');
  assert.match(themeCss({ textbox: { image: 'box', slice: [1, 2, 3, 4] } }), /border-image: url\("assets\/ui\/box.png"\) 1 2 3 4 fill \/ 1px 2px 3px 4px stretch/);
});
