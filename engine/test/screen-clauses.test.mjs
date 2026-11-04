import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, getCompletions, renameVariable, variableAt, renameLabel, applyTextEdits, assignIds, existingIds, buildOutline, SCREEN_CLAUSE_WORDS } from '../../dist/engine/src/index.js';

const errors = p => p.diagnostics.filter(d => d.severity === 'error').map(d => `${d.line}: ${d.message}`);
const build = text => compile([{ file: 's.vn', text }]);
const strip = def => JSON.parse(JSON.stringify(def, (k, v) => (k === 'src' ? undefined : v)));

const TAIL = `
label start:
  show screen s
  end
label tip_label:
  "Tip"
  return
`;
const ONE = `
screen s:
  state page = "light"
  state tip = ""
  toggle lamp_on tip at 420,380 "Reading lamp" #hgir if page == "light" on focus set tip = "A warm lamp." on blur set tip = ""
  button done at 10,10 "Done" #abcd on click tip_label enabled page == "light"
  default done
`;
const MANY = `
screen s:
  state page = "light"
  state tip = ""
  toggle lamp_on tip at 420,380 "Reading lamp" #hgir
    if page == "light"
    on focus set tip = "A warm lamp."
    on blur set tip = ""
  button done at 10,10 "Done" #abcd
    on click tip_label
    enabled page == "light"
  default done
`;

test('a screen element over several lines parses like its one-line form', () => {
  const a = build(ONE + TAIL), b = build(MANY + TAIL);
  assert.deepEqual(errors(a), []);
  assert.deepEqual(errors(b), []);
  assert.deepEqual(strip(b.screens.s), strip(a.screens.s));
  assert.equal(b.screens.s.body[0].src.line, 5); // the element's source is its first physical line
  assert.ok(SCREEN_CLAUSE_WORDS.includes('on') && SCREEN_CLAUSE_WORDS.includes('style='));
});

test('a clause word under a ":" parent is a continuation, an element keyword is a child', () => {
  const p = build(`
screen s:
  state n = 0
  button b at 10,10 "B" #ab12
    on click tip_label
    if n == 0:
    text at 5,5 "child" #cd34
  default b
` + TAIL);
  assert.deepEqual(errors(p), []);
  const b = p.screens.s.body[0];
  assert.equal(b.body.length, 1);
  assert.ok(b.cond && b.on?.click === 'tip_label' || b.on !== undefined);
});

test('element keyword under an element that does not end in ":" is still unexpected indentation', () => {
  const p = build(`
screen s:
  button b at 10,10 "B" #ab12
    text at 5,5 "child" #cd34
` + TAIL);
  assert.deepEqual(errors(p), ['4: Unexpected indentation']);
});

test('a ... ":" belongs at the end of the last continuation line', () => {
  const p = build(`
screen s:
  button b at 1,1 "B" #ab12:
    on click tip_label
    text at 5,5 "child" #cd34
` + TAIL);
  assert.match(errors(p)[0], /^3: .*":" on its last line/);
});

test('errors point at the physical line of the offending clause', () => {
  const noSuch = build(`
screen s:
  text at 10,10 "Hello" #ab12
    hover none
` + TAIL);
  assert.deepEqual(errors(noSuch), ['4: hover goes on a hotspot or button, not on text']);
  const undeclared = build(`
screen s:
  state a = 1
  button b at 1,1 "B" #ab12
    on click tip_label
    on focus set zzz = 1
` + TAIL);
  assert.deepEqual(errors(undeclared).map(e => e.slice(0, 2)), ['6:']);
  const badExpr = build(`
screen s:
  button b at 1,1 "B" #ab12
    on click tip_label
    if 1 +
` + TAIL);
  assert.equal(errors(badExpr)[0].slice(0, 2), '5:');
});

test('continuation lines must be indented the same, and single-line statements take none', () => {
  const p = build(`
screen s:
  state a = 1
  button b at 1,1 "B" #ab12
    on click tip_label
      if a == 1
` + TAIL);
  assert.deepEqual(errors(p), ['6: The continuation lines of one element must be indented the same']);
  const q = build(`
screen s:
  state a = 1
  button b at 1,1 "B" #ab12
  default b
    if a == 1
` + TAIL);
  assert.deepEqual(errors(q), ['6: "default" is a single line: it takes no continuation lines']);
});

test('a clause line after a child, or at the element level, says where it belongs', () => {
  const p = build(`
screen s:
  button b at 1,1 "B" #ab12:
    text at 5,5 "child" #cd34
    if true
` + TAIL);
  assert.equal(errors(p).length, 1);
  assert.match(errors(p)[0], /^5: "if" continues the element line above it/);
});

test('assignIds puts the #id on the first physical line and leaves continuation lines alone', () => {
  const src = `screen s:\n  state tip = ""\n  toggle t tip at 1,1 "Lamp"\n    on focus set tip = "Warm"\n    if true\n`;
  const out = assignIds(src, new Set(), () => 0.5);
  assert.equal(out.added, 1);
  const lines = out.text.split('\n');
  assert.match(lines[2], /^ {2}toggle t tip at 1,1 "Lamp" #[a-z0-9]{4}$/);
  assert.equal(lines[3], '    on focus set tip = "Warm"');
  assert.equal(existingIds([out.text]).size, 1);
  assert.deepEqual(errors(build(out.text + TAIL.replace('show screen s', 'show screen s'))), []);
});

test('renaming a state or a label inside a continuation line edits that physical line', () => {
  const text = MANY + TAIL;
  const files = [{ name: 's.vn', text }];
  const r = renameVariable(files, variableAt(files, 's.vn', 4, 8), 'hint');
  assert.ok(r.ok, r.error);
  const out = applyTextEdits(text, r.edits);
  assert.match(out, /toggle lamp_on hint at 420,380/);
  assert.match(out, /^ {4}on focus set hint = "A warm lamp\."$/m);
  assert.match(out, /^ {4}on blur set hint = ""$/m);
  const q = renameVariable(files, variableAt(files, 's.vn', 3, 8), 'section');
  assert.ok(q.ok, q.error);
  const out2 = applyTextEdits(text, q.edits);
  assert.match(out2, /^ {4}if section == "light"$/m);
  assert.match(out2, /^ {4}enabled section == "light"$/m);
  const l = renameLabel(files, 'tip_label', 'hint_label');
  assert.ok(l.ok, l.error);
  assert.match(applyTextEdits(text, l.edits), /^ {4}on click hint_label$/m);
});

test('the outline sees a label called from a continuation line of a hud button', () => {
  const p = build(`
screen hud:
  button b at 1,1 "B" #ab12
    on click tip_label
label start:
  hud on hud
  "Hi"
  end
label tip_label:
  "Tip"
  return
`);
  assert.deepEqual(errors(p), []);
  const o = buildOutline(p);
  assert.ok(o.edges.some(e => e.from === 'start' && e.to === 'tip_label' && e.kind === 'call'));
});

test('completions on a continuation start offer the clause words, and continue a clause', () => {
  const p = build(MANY + TAIL);
  const above = ['screen s:', '  toggle lamp_on tip at 1,1 "Lamp" #hgir', '    if page == "light"'];
  const labels = getCompletions(p, '    ', {}, above).map(s => s.label);
  for (const w of ['on', 'if', 'enabled', 'hover', 'tooltip', 'cursor', 'up', 'style=']) assert.ok(labels.includes(w), w);
  assert.deepEqual(getCompletions(p, '    on ', {}, above).map(s => s.label).sort(), ['blur', 'click', 'focus']);
  assert.ok(getCompletions(p, '    on focus set ', {}, above).some(s => s.label === 'tip'));
  // not under an element: the usual lists
  assert.ok(!getCompletions(p, '    ', {}, ['label x:', '  "hi"']).some(s => s.label === 'enabled'));
});
