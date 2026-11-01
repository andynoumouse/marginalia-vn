import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findInFiles, replaceInFiles, compile, labelRefs, labelAt, renameLabel, applyTextEdits } from '../../dist/engine/src/index.js';

const A = `screen hud:
    hotspot door at 1,1 size 5,5 "on click cafe" #ab12 on click cafe on focus other
    button b at 1,1 "Go" on blur cafe
label start:
    "Say jump cafe in a string."
    menu:
        "Go to cafe jump cafe":
            jump cafe
        "Call it":
            call cafe   # trailing comment
label cafe:
    jump start
`;
const B = `label other:
    jump cafe
    jump cafe2
`;
const GAME = `{
  "title": "cafe",
  "intro": "cafe",
  "chapters": [
    { "label": "cafe", "title": "cafe" },
    "start",
    "cafe"
  ],
  "labels": { "cafe": "cafe" }
}
`;
const files = [{ name: 'a.vn', text: A }, { name: 'b.vn', text: B }, { name: 'game.json', text: GAME }];

test('labelRefs finds definitions and every reference kind, not words in strings or similar names', () => {
  const refs = labelRefs(files).filter(r => r.name === 'cafe');
  assert.deepEqual(refs.map(r => `${r.file}:${r.line}:${r.kind}`), [
    'a.vn:2:on', 'a.vn:3:on', 'a.vn:8:jump', 'a.vn:10:call', 'a.vn:11:label',
    'b.vn:2:jump', 'game.json:3:intro', 'game.json:5:chapter', 'game.json:7:chapter',
  ]);
});

test('renameLabel rewrites all of them and the result still compiles', () => {
  const r = renameLabel(files, 'cafe', 'bistro');
  assert.ok(r.ok);
  const out = files.map(f => ({ name: f.name, text: applyTextEdits(f.text, r.edits.filter(e => e.file === f.name)) }));
  assert.match(out[0].text, /call bistro {3}# trailing/);
  assert.match(out[0].text, /"Go to cafe jump cafe"/);
  assert.match(out[0].text, /"on click cafe" #ab12 on click bistro on focus other/);
  assert.match(out[0].text, /label bistro:/);
  assert.match(out[1].text, /jump bistro\n {4}jump cafe2/);
  const game = JSON.parse(out[2].text);
  assert.equal(game.intro, 'bistro');
  assert.deepEqual(game.chapters, [{ label: 'bistro', title: 'cafe' }, 'start', 'bistro']);
  assert.equal(game.title, 'cafe');
  assert.deepEqual(game.labels, { cafe: 'cafe' });
  const prog = compile(out.filter(f => f.name.endsWith('.vn')).map(f => ({ file: f.name, text: f.text.replace('jump cafe2', 'jump start') })));
  assert.deepEqual(prog.diagnostics.filter(d => d.severity === 'error'), []);
});

test('renameLabel rejects collisions, bad names and unknown labels', () => {
  assert.equal(renameLabel(files, 'cafe', 'other').ok, false);
  assert.equal(renameLabel(files, 'cafe', '9x').ok, false);
  assert.equal(renameLabel(files, 'cafe', 'a b').ok, false);
  assert.equal(renameLabel(files, 'nope', 'x').ok, false);
  assert.equal(renameLabel(files, 'cafe', 'cafe').ok, false);
});

test('labelAt finds the label under the cursor', () => {
  assert.equal(labelAt(files, 'a.vn', 8, 18)?.name, 'cafe');
  assert.equal(labelAt(files, 'a.vn', 11, 8)?.name, 'cafe');
  assert.equal(labelAt(files, 'a.vn', 8, 3), undefined);
  assert.equal(labelAt(files, 'game.json', 3, 14)?.name, 'cafe');
});

test('CRLF scripts keep their columns', () => {
  const crlf = [{ name: 'c.vn', text: 'label x:\r\n    jump x\r\n' }];
  const r = renameLabel(crlf, 'x', 'yy');
  assert.ok(r.ok);
  assert.equal(applyTextEdits(crlf[0].text, r.edits), 'label yy:\r\n    jump yy\r\n');
});

test('findInFiles and replaceInFiles: plain, case, whole word and regexp', () => {
  const fs = [{ name: 'a.vn', text: 'Cafe cafe cafeteria\nthe cafe' }, { name: 'b.vn', text: 'no\r\ncafe' }];
  const hits = o => findInFiles(fs, o).matches.map(m => `${m.file}:${m.line}:${m.col}`);
  assert.deepEqual(hits({ find: 'cafe' }), ['a.vn:1:0', 'a.vn:1:5', 'a.vn:1:10', 'a.vn:2:4', 'b.vn:2:0']);
  assert.deepEqual(hits({ find: 'cafe', matchCase: true }), ['a.vn:1:5', 'a.vn:1:10', 'a.vn:2:4', 'b.vn:2:0']);
  assert.deepEqual(hits({ find: 'cafe', wholeWord: true, matchCase: true }), ['a.vn:1:5', 'a.vn:2:4', 'b.vn:2:0']);
  assert.ok(findInFiles(fs, { find: '(' , regex: true }).error);
  assert.ok(findInFiles(fs, { find: '' }).error);
  const r = replaceInFiles(fs, { find: '(c)afe', regex: true, matchCase: true, wholeWord: true }, '$1ake$$');
  assert.equal(applyTextEdits(fs[0].text, r.edits.filter(e => e.file === 'a.vn')), 'Cafe cake$ cafeteria\nthe cake$');
  const p = replaceInFiles(fs, { find: 'cafe' }, '$1');
  assert.equal(applyTextEdits(fs[1].text, p.edits.filter(e => e.file === 'b.vn')), 'no\r\n$1');
});
