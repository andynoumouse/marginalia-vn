import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, stringRows, uiLabelRows, translationStatus, translatorCsv, outdatedIds } from '../../dist/engine/src/index.js';

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

test('status counts empty entries as missing and flags stale ids', () => {
  const s = translationStatus(rows, { aaaa: 'Hei', bbbb: '', zzzz: 'old', 'ui.play': 'Pelaa' });
  assert.equal(s.total, 7);
  assert.equal(s.translated, 1);
  assert.deepEqual(s.missing, ['bbbb', 'cccc', 'dddd', 'eeee', 'ffff', 'gggg']);
  assert.deepEqual(s.unused, ['zzzz']);
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
