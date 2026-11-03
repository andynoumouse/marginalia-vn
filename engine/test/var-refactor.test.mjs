import { test } from 'node:test';
import assert from 'node:assert/strict';
import { variableRefs, variableAt, variableUses, renameVariable, applyTextEdits } from '../../dist/engine/src/index.js';

const A = `define alice "Alice"
set trust = 0
set persistent.trust = 1
screen hud:
    text at 1,1 "Trust [trust] / [persistent.trust]" if trust > 0
    each bag as item at 1,1 step 0,10:
        text at 0,0 "[item.name] [trust]" if item.name != "trust"
label start:
    alice: Hello [trust], you have [bag]. #ab12
    set trust += 1
    "Narration [trust]."
    input name "Your trust [trust]?"
    menu "Pick [trust]" timeout trust * 2:
        "Option [trust]" if trust >= 2 and not unlocked.trust else "Locked: [name]":
            call buy("trust", trust + 1)
        "Other":
            jump start
    if contains(bag, "trust"):  # trust comment
        set item = 5
    show screen hud as trust
label buy(item, cost):
    "The [item] costs [cost]; trust [trust]."
    set trust -= cost
    return
`;
const files = [{ name: 'a.vn', text: A }];
const at = (line, word, nth = 0) => {
  const l = A.split('\n')[line - 1];
  let col = -1;
  for (let i = 0; i <= nth; i++) col = l.indexOf(word, col + 1);
  return { line, col };
};
const apply = res => { assert.ok(res.ok, res.error); return applyTextEdits(A, res.edits); };

test('variableRefs finds sets, conditions, text, call args and declarations, not strings or functions', () => {
  const t = variableRefs(files).filter(r => r.name === 'trust' && !r.persistent && !r.scope);
  assert.deepEqual(t.map(r => r.line), [2, 5, 5, 7, 9, 10, 11, 12, 13, 13, 14, 14, 15, 20, 22, 23]);
});

test('variableUses lists one variable only: the global, the persistent value and a local stay apart', () => {
  const g = variableUses(files, variableAt(files, 'a.vn', 2, 6));
  assert.deepEqual(g.map(r => r.line), [2, 5, 5, 7, 9, 10, 11, 12, 13, 13, 14, 14, 15, 20, 22, 23]);
  const p = variableUses(files, variableAt(files, 'a.vn', 3, 'set persistent.'.length));
  assert.ok(p.length && p.every(r => r.persistent));
  const local = variableUses(files, variableAt(files, 'a.vn', 21, 'label buy('.length));
  assert.ok(local.length && local.every(r => r.line >= 21 && r.scope));
});

test('renaming a global leaves persistent, locals and strings alone', () => {
  const out = apply(renameVariable(files, variableAt(files, 'a.vn', 2, 6), 'faith'));
  assert.match(out, /^set faith = 0$/m);
  assert.match(out, /set persistent\.trust = 1/);
  assert.match(out, /"Trust \[faith\] \/ \[persistent\.trust\]" if faith > 0/);
  assert.match(out, /alice: Hello \[faith\], you have/);
  assert.match(out, /timeout faith \* 2/);
  assert.match(out, /if faith >= 2 and not unlocked\.trust else "Locked: \[name\]"/);
  assert.match(out, /call buy\("trust", faith \+ 1\)/);
  assert.match(out, /contains\(bag, "trust"\):  # trust comment/);
  assert.match(out, /show screen hud as faith/);
  assert.match(out, /set faith -= cost/);
  assert.match(out, /"The \[item\] costs \[cost\]; trust \[faith\]\."/);
  assert.match(out, /item\.name != "trust"/);
});

test('persistent names are a separate namespace', () => {
  const r = variableAt(files, 'a.vn', 3, 'set persistent.'.length);
  assert.equal(r.persistent, true);
  const out = apply(renameVariable(files, r, 'karma'));
  assert.match(out, /set persistent\.karma = 1/);
  assert.match(out, /\[persistent\.karma\]/);
  assert.match(out, /^set trust = 0$/m);
});

test('label parameters and each names are local', () => {
  const p = variableAt(files, 'a.vn', 21, 'label buy('.length);
  assert.ok(p.scope);
  const out = apply(renameVariable(files, p, 'thing'));
  assert.match(out, /label buy\(thing, cost\)/);
  assert.match(out, /"The \[thing\] costs/);
  assert.match(out, /set item = 5/);
  assert.match(out, /each bag as item/);
  const e = variableAt(files, 'a.vn', 6, '    each bag as '.length);
  const out2 = apply(renameVariable(files, e, 'entry'));
  assert.match(out2, /each bag as entry/);
  assert.match(out2, /\[entry\.name\]/);
  assert.match(out2, /if entry\.name != "trust"/);
  assert.match(out2, /set item = 5/);
});

test('refuses invalid names, reserved words, merges and capture', () => {
  const g = variableAt(files, 'a.vn', 2, 6);
  for (const bad of ['2x', 'a b', 'and', 'random', 'persistent', 'tab', 'trust']) assert.equal(renameVariable(files, g, bad).ok, false, bad);
  assert.equal(renameVariable(files, g, 'name').ok, false, 'merge with the input variable');
  assert.equal(renameVariable(files, g, 'cost').ok, false, 'a local of that name would capture');
  const p = variableAt(files, 'a.vn', 21, 'label buy('.length);
  assert.equal(renameVariable(files, p, 'trust').ok, false, 'trust is used in that label');
  assert.equal(renameVariable(files, p, 'cost').ok, false);
  assert.equal(renameVariable(files, variableAt(files, 'a.vn', 3, 'set persistent.'.length), 'name').ok, true);
});

test('a shell variable is not renamable', () => {
  const f = [{ name: 'b.vn', text: 'screen options:\n    text at 0,0 "[tab]" if tab == "audio"\n' }];
  assert.equal(renameVariable(f, variableAt(f, 'b.vn', 2, 20), 'page').ok, false);
});

test('a rename also changes [name] in the translations of the lines that use it', () => {
  const vn = 'label start:\n    "Gold [coins:,] and [coins]. [persistent.coins]" #ab12\n    "Other [coins]" #cd34\n    set coins += 1\n';
  const de = '{\n  "ab12": "Gold [coins:,] und \\"[coins]\\". [persistent.coins]",\n  "cd34": "Anders [coins]",\n  "zz99": "[coins]"\n}\n';
  const fs = [{ name: 'start.vn', text: vn }, { name: 'locale/de.json', text: de }];
  const res = renameVariable(fs, variableAt(fs, 'start.vn', 4, 8), 'gold');
  assert.ok(res.ok, res.error);
  const loc = applyTextEdits(de, res.edits.filter(e => e.file === 'locale/de.json'));
  assert.equal(loc, '{\n  "ab12": "Gold [gold:,] und \\"[gold]\\". [persistent.coins]",\n  "cd34": "Anders [gold]",\n  "zz99": "[coins]"\n}\n');
  assert.equal(JSON.parse(loc).ab12, 'Gold [gold:,] und "[gold]". [persistent.coins]');
});

test('a rename changes [name] in the translations of character dialogue too, not only of quoted narration', () => {
  const vn = 'label start:\n    input player "Name?" #ab12\n    alice: Nice to meet you, [player]. #cd34\n';
  const fi = '{\n  "cd34": "Hauska tavata, [player]."\n}\n';
  const fs = [{ name: 'start.vn', text: vn }, { name: 'locale/fi.json', text: fi }];
  const res = renameVariable(fs, variableAt(fs, 'start.vn', 2, 11), 'hero');
  assert.ok(res.ok, res.error);
  assert.equal(applyTextEdits(fi, res.edits.filter(e => e.file === 'locale/fi.json')), '{\n  "cd34": "Hauska tavata, [hero]."\n}\n');
});

test('a local only changes in translations of its own lines', () => {
  const vn = 'label buy(item):\n    "The [item] costs." #ab12\nlabel other:\n    "The [item] is here." #cd34\n';
  const en = '{\n  "ab12": "The [item] costs.",\n  "cd34": "The [item] is here."\n}\n';
  const fs = [{ name: 'a.vn', text: vn }, { name: 'locale/en.json', text: en }];
  const res = renameVariable(fs, variableAt(fs, 'a.vn', 1, 12), 'thing');
  assert.ok(res.ok, res.error);
  assert.equal(applyTextEdits(en, res.edits.filter(e => e.file === 'locale/en.json')), '{\n  "ab12": "The [thing] costs.",\n  "cd34": "The [item] is here."\n}\n');
});
