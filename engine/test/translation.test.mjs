import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, stringRows, uiLabelRows, translationStatus, dropUnused, translatorCsv, outdatedIds, parseCsv, importTranslatorCsv } from '../../dist/engine/src/index.js';

const script = `define e "Eve" color=#ffffff
label start:
    e: Hello, there. #aaaa
    "Narration." #bbbb
    menu "Which way?" #cccc:
        "Left, quick" #dddd:
            jump end
        "Right" #eeee if false else "Blocked" #ffff:
            jump end
label end:
    e: Bye. #gggg
`;
const program = compile([{ file: 'a.vn', text: script }]);
const rows = stringRows(program);

test('rows carry speaker, kind and place, in script order', () => {
  assert.deepEqual(rows.map(r => r.id), ['aaaa', 'bbbb', 'cccc', 'dddd', 'eeee', 'ffff', 'gggg']);
  assert.deepEqual(rows.map(r => r.kind), ['say', 'say', 'prompt', 'choice', 'choice', 'reason', 'say']);
  assert.equal(rows[0].who, 'e');
  assert.equal(rows[1].who, null);
  assert.deepEqual([rows[0].file, rows[0].line, rows[0].label], ['a.vn', 3, 'start']);
  assert.equal(rows[6].label, 'end');
  assert.equal(rows[3].line, 6);
});

test('screen and item strings come last, with the file and line they are written on', () => {
  const p = compile([{ file: 'b.vn', text: 'define item key "Brass key" #it01\nscreen s:\n    button go at 0,0 "Go" #sc01\nlabel start:\n    "Hi" #hhhh\n' }]);
  assert.deepEqual(stringRows(p).map(r => [r.id, r.kind, r.file, r.line]), [['hhhh', 'say', 'b.vn', 5], ['it01', 'other', 'b.vn', 1], ['sc01', 'other', 'b.vn', 3]]);
});

test('status counts empty entries as missing and flags stale ids', () => {
  const s = translationStatus(rows, { aaaa: 'Hei', bbbb: '', zzzz: 'old', 'ui.play': 'Pelaa' });
  assert.equal(s.total, 7);
  assert.equal(s.translated, 1);
  assert.deepEqual(s.missing, ['bbbb', 'cccc', 'dddd', 'eeee', 'ffff', 'gggg']);
  assert.deepEqual(s.unused, ['zzzz']);
});

test('dropUnused takes the stale ids out of the table and its snapshot, and keeps menu labels', () => {
  const table = { aaaa: 'Hei', zzzz: 'old', yyyy: '', 'ui.play': 'Pelaa' }, snapshot = { aaaa: 'Hi', zzzz: 'Old' };
  const out = dropUnused(rows, table, snapshot);
  assert.deepEqual(out, { table: { aaaa: 'Hei', 'ui.play': 'Pelaa' }, snapshot: { aaaa: 'Hi' }, removed: ['zzzz', 'yyyy'] });
  assert.equal(table.zzzz, 'old', 'the input is left alone');
});

test('csv quotes commas, quotes and newlines and adds a column per language', () => {
  const csv = translatorCsv(rows.slice(0, 4), { fi: { aaaa: 'Hei, siellä', bbbb: 'Hän sanoi "hei"' } }, ['fi']);
  const lines = csv.trimEnd().split('\r\n');
  assert.equal(lines[0], 'id,file,line,label,kind,speaker,source,fi');
  assert.equal(lines[1], 'aaaa,a.vn,3,start,say,e,"Hello, there.","Hei, siellä"');
  assert.match(lines[4], /"Left, quick"/);
  assert.match(lines[2], /"Hän sanoi ""hei"""$/);
});

test('a translation is outdated when its source text changed since the snapshot', () => {
  const table = { aaaa: 'Hei', bbbb: 'Kertoja', cccc: '' };
  const snap = { aaaa: 'Hello!', bbbb: 'Narration.', cccc: 'Which way?' };
  assert.deepEqual(outdatedIds(rows, table, snap), ['aaaa']); // bbbb is unchanged, cccc has no translation, the rest are unknown
});

test('csv shows the previous source of outdated translations for languages with a snapshot', () => {
  const csv = translatorCsv(rows.slice(0, 2), { fi: { aaaa: 'Hei', bbbb: 'Kertoja' } }, ['fi'], { fi: { aaaa: 'Hello!', bbbb: 'Narration.' } });
  const lines = csv.trimEnd().split('\r\n');
  assert.equal(lines[0], 'id,file,line,label,kind,speaker,source,fi,fi previous source');
  assert.equal(lines[1], 'aaaa,a.vn,3,start,say,e,"Hello, there.",Hei,Hello!');
  assert.equal(lines[2], 'bbbb,a.vn,4,start,say,,Narration.,Kertoja,');
});

test('menu labels are rows: the page text, replaced by game.json labels, keyed ui.<key>', () => {
  const rows = uiLabelRows({ options: 'Options', back: 'Back', new_game: 'New game' }, { new_game: 'Begin', back: '' });
  assert.deepEqual(rows.map(r => [r.id, r.source, r.kind]), [['ui.back', 'Back', 'label'], ['ui.new_game', 'Begin', 'label'], ['ui.options', 'Options', 'label']]);
  const st = translationStatus(rows, { 'ui.back': 'Takaisin', 'ui.gone': 'x' });
  assert.equal(st.translated, 1);
  assert.deepEqual(st.unused, []); // ui.* entries never count as unused
  assert.match(translatorCsv(rows, { fi: { 'ui.back': 'Takaisin' } }, ['fi']), /ui\.back,,,,label,,Back,Takaisin/);
});

test('parseCsv reads quoted cells with commas, quotes and line breaks, drops a BOM and finds a semicolon delimiter', () => {
  assert.deepEqual(parseCsv('\uFEFFid,fi\r\na,"Hei, ""sinä""\nrivi"\r\n\r\nb,x'), [['id', 'fi'], ['a', 'Hei, "sinä"\nrivi'], ['b', 'x']]);
  assert.deepEqual(parseCsv('id;fi\na;"x;y"\n'), [['id', 'fi'], ['a', 'x;y']]);
  assert.deepEqual(parseCsv('id\tfi\na\tb'), [['id', 'fi'], ['a', 'b']]);
});

test('an exported sheet reads back: new and changed translations, empty cells kept, snapshots of what the translator saw', () => {
  const tables = { fi: { aaaa: 'Hei', bbbb: 'Kertoja' } };
  const sheet = translatorCsv(rows, tables, ['fi', 'de'], { fi: {} })
    .replace('"Hello, there.",Hei,', '"Hello, there.","Hei, siellä",')
    .replace('Which way?,,', 'Which way?,Mihin?,')
    .replace('Bye.,,,', 'Bye.,,,Tschüss.');
  const out = importTranslatorCsv(sheet, rows, tables, { fi: { aaaa: 'Hello, there.' } });
  assert.deepEqual(out.unknown, []);
  assert.deepEqual(out.ignored, []);
  const [fi, de] = out.languages;
  assert.deepEqual([fi.lang, fi.added, fi.changed, fi.isNew], ['fi', ['cccc'], ['aaaa'], false]);
  assert.deepEqual(fi.table, { aaaa: 'Hei, siellä', bbbb: 'Kertoja', cccc: 'Mihin?' });
  assert.deepEqual(fi.snapshot, { aaaa: 'Hello, there.', cccc: 'Which way?' });
  assert.deepEqual([de.lang, de.added, de.isNew, de.table], ['de', ['gggg'], true, { gggg: 'Tschüss.' }]);
  assert.equal(tables.fi.aaaa, 'Hei', 'the inputs are left alone');
});

test('a sheet exported before a line was reworded imports as outdated; unknown ids, the source language and other columns are skipped', () => {
  const csv = 'ID;source;en;fi;notes;fi previous source\n#aaaa;Hello!;Hello!;Hei!;call back;\nzzzz;Gone;;Poissa;;\nbbbb;Narration.;;Kertoja;;\nbbbb;Narration.;;Kertoja 2;;\n';
  const out = importTranslatorCsv(csv, rows, {}, {}, 'en');
  assert.deepEqual(out.ignored, ['en', 'notes']);
  assert.deepEqual(out.unknown, ['zzzz']);
  const [fi] = out.languages;
  assert.deepEqual(fi.added, ['aaaa', 'bbbb'], 'a repeated id counts once, and its last cell wins');
  assert.deepEqual(fi.table, { aaaa: 'Hei!', bbbb: 'Kertoja 2' });
  assert.deepEqual(fi.outdated, ['aaaa']);
  assert.deepEqual(outdatedIds(rows, fi.table, fi.snapshot), ['aaaa']);
});

test('a sheet with no id or no language column says why', () => {
  assert.match(importTranslatorCsv('key,fi\na,b\n', rows, {}).error, /no "id" column/);
  assert.match(importTranslatorCsv('id,source,notes\naaaa,x,y\n', rows, {}).error, /no language column/);
});
