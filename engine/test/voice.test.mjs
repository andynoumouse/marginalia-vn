import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptVoice, attachPreloads, checkAssets, checkVoice, compile, VOICE_KEY, voiceFile, splitVoiceName, voiceText, changedSpan } from '../../dist/engine/src/index.js';

const has = names => n => names.includes(n);

test('a voice file is found by line id, the language suffix first', () => {
  assert.equal(voiceFile('ab12', 'en', has(['ab12'])), 'ab12');
  assert.equal(voiceFile('ab12', 'fi', has(['ab12', 'ab12.fi'])), 'ab12.fi');
  assert.equal(voiceFile('ab12', 'en', has(['ab12.fi'])), null);
});

test('a recording name splits into the line id and the optional language', () => {
  assert.deepEqual(splitVoiceName('ab12'), { id: 'ab12', lang: null });
  assert.deepEqual(splitVoiceName('ab12.fi'), { id: 'ab12', lang: 'fi' });
  assert.deepEqual(splitVoiceName('ab12.pt-BR'), { id: 'ab12', lang: 'pt-BR' });
});

test('lines without an id have no voice', () => {
  assert.equal(voiceFile(null, 'en', () => true), null);
  assert.equal(voiceFile('', 'en', () => true), null);
});

const script = [
  'label start:',
  '  "First." #aa11',
  '  "Second." #bb22',
  '  "Third." #cc33',
].join('\n');
const program = () => compile([{ file: 't.vn', text: script }]);

test('a voiced line asks for its recording as a preload task, in any language', () => {
  const p = program();
  const index = { files: ['voice/aa11.ogg', 'voice/bb22.fi.mp3'] };
  const pre = attachPreloads(p, index);
  const keys = pre.tasks[0].map(t => t.key);
  assert.deepEqual(keys, [VOICE_KEY + 'aa11', VOICE_KEY + 'bb22']); // cc33 has no file
  assert.equal(pre.tasks[0].find(t => t.key === 'voice/bb22').lines, 1);
});

test('without voice files nothing is preloaded for lines', () => {
  assert.equal(attachPreloads(program(), { files: ['bg/park.png'] }).tasks[0], undefined);
});

test('a voice file that matches no line is reported', () => {
  const index = { files: ['voice/aa11.ogg', 'voice/zz99.fi.ogg', 'voice/notes.txt'] };
  const found = checkAssets(program(), index).filter(d => /Voice file/.test(d.message));
  assert.deepEqual(found.map(d => d.file), ['assets/voice/zz99.fi.ogg']);
});

const texts = t => name => t[name];

test('a recording seen for the first time is adopted with the current text', () => {
  const { lock, outdated } = checkVoice({ aa11: 'h1' }, texts({ aa11: 'First.' }), {});
  assert.deepEqual(lock, { aa11: { sum: 'h1', text: 'First.' } });
  assert.deepEqual(outdated, []);
});

test('an unchanged file under reworded text is outdated, and stays so until it is dealt with', () => {
  const old = { aa11: { sum: 'h1', text: 'First.' } };
  const first = checkVoice({ aa11: 'h1' }, texts({ aa11: 'First line.' }), old);
  assert.deepEqual(first.outdated, ['aa11']);
  assert.deepEqual(first.lock, old);
  assert.deepEqual(checkVoice({ aa11: 'h1' }, texts({ aa11: 'First line.' }), first.lock).outdated, ['aa11']);
});

test('a new checksum is a re-recording: adopted with the current text', () => {
  const old = { aa11: { sum: 'h1', text: 'First.' } };
  const { lock, outdated } = checkVoice({ aa11: 'h2' }, texts({ aa11: 'First line.' }), old);
  assert.deepEqual(lock.aa11, { sum: 'h2', text: 'First line.' });
  assert.deepEqual(outdated, []);
});

test('restoring the recorded wording clears the outdated mark', () => {
  const old = { aa11: { sum: 'h1', text: 'First.' } };
  assert.deepEqual(checkVoice({ aa11: 'h1' }, texts({ aa11: 'First.' }), old).outdated, []);
});

test('deleted files and recordings of removed lines leave the lock', () => {
  const old = { aa11: { sum: 'h1', text: 'First.' }, bb22: { sum: 'h2', text: 'Second.' }, 'cc33.fi': { sum: 'h3', text: 'x' } };
  const { lock } = checkVoice({ aa11: 'h1', 'cc33.fi': 'h3' }, texts({ aa11: 'First.' }), old);
  assert.deepEqual(Object.keys(lock), ['aa11']);
});

test('accepting a recording refreshes its text and nothing else', () => {
  const lock = { aa11: { sum: 'h1', text: 'First.' }, bb22: { sum: 'h2', text: 'Second.' } };
  const next = acceptVoice(lock, ['aa11', 'zz99'], texts({ aa11: 'First!', bb22: 'Changed.' }));
  assert.deepEqual(next, { aa11: { sum: 'h1', text: 'First!' }, bb22: { sum: 'h2', text: 'Second.' } });
  assert.equal(lock.aa11.text, 'First.');
});

test('voice.lock.json follows recordings on disk: adopt, flag a reworded line, accept it', async () => {
  const { checkVoiceFiles } = await import('../../tools/voice-check.mjs');
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-voice-'));
  try {
    fs.mkdirSync(path.join(dir, 'assets', 'voice'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'assets', 'voice', 'aa11.ogg'), 'take one');
    fs.writeFileSync(path.join(dir, 'assets', 'voice', 'aa11.fi.ogg'), 'otto yksi');
    const prog = text => ({ strings: { aa11: text } });
    const fi = { fi: { aa11: 'Ensimmäinen.' } };

    assert.deepEqual(checkVoiceFiles(dir, prog('First.'), fi).outdated, []); // adopted
    const lockFile = path.join(dir, 'voice.lock.json');
    assert.equal(JSON.parse(fs.readFileSync(lockFile, 'utf8'))['aa11.fi'].text, 'Ensimmäinen.'); // the language's own text

    assert.deepEqual(checkVoiceFiles(dir, prog('First!'), fi).outdated.map(o => o.name), ['aa11']); // only the English line was reworded
    assert.deepEqual(checkVoiceFiles(dir, prog('First!'), fi).outdated, [{ name: 'aa11', recorded: 'First.', current: 'First!' }]); // and it stays flagged
    assert.deepEqual(checkVoiceFiles(dir, prog('First!'), fi, ['aa11']).outdated, []);

    fs.writeFileSync(path.join(dir, 'assets', 'voice', 'aa11.ogg'), 'take two'); // re-recorded
    assert.deepEqual(checkVoiceFiles(dir, prog('First again.'), fi).outdated, []);
    assert.equal(checkVoiceFiles(path.join(dir, 'nowhere'), prog('x'), {}).recordings, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('voiceText: the named language\'s own text, else the source', () => {
  const strings = { aa11: 'First.' };
  assert.equal(voiceText('aa11', strings, { fi: { aa11: 'Eka.' } }), 'First.');
  assert.equal(voiceText('aa11.fi', strings, { fi: { aa11: 'Eka.' } }), 'Eka.');
  assert.equal(voiceText('aa11.sv', strings, { fi: { aa11: 'Eka.' } }), 'First.');
  assert.equal(voiceText('aa11.fi', strings, { fi: { aa11: '' } }), 'First.');
  assert.equal(voiceText('zz99', strings, {}), undefined);
});

test('changedSpan isolates what differs between two wordings', () => {
  assert.deepEqual(changedSpan('Hello wrold.', 'Hello world.'), ['Hello w', 'ro', 'or', 'ld.']);
  assert.deepEqual(changedSpan('Same.', 'Same.'), ['Same.', '', '', '']);
  assert.deepEqual(changedSpan('Hi.', 'Hi there.'), ['Hi', '', ' there', '.']);
  assert.deepEqual(changedSpan('', 'New'), ['', '', 'New', '']);
});

test('the source language is game.json language, en by default', async () => {
  const { sourceLanguage } = await import('../../dist/engine/src/index.js');
  assert.equal(sourceLanguage({ language: 'fi' }), 'fi');
  assert.equal(sourceLanguage({ language: ' pt-BR ' }), 'pt-BR');
  for (const bad of [undefined, null, {}, { language: '' }, { language: 3 }]) assert.equal(sourceLanguage(bad), 'en');
});

test('voice languages are the suffixes of recordings, plus the source label for default ones', async () => {
  const { voiceLanguages, resolveVoiceLanguage } = await import('../../dist/engine/src/index.js');
  assert.deepEqual(voiceLanguages(['voice/aa11.ogg', 'voice/bb22.fi.mp3', 'voice/cc33.fi.mp3', 'bg/x.png', 'voice/dd44.ja.ogg', 'voice/notes.txt'], 'en'), ['en', 'fi', 'ja']);
  assert.deepEqual(voiceLanguages(['voice/bb22.fi.mp3'], 'en'), ['fi']);
  assert.deepEqual(voiceLanguages([], 'en'), []);
  const { declaredVoiceLanguages } = await import('../../dist/engine/src/index.js');
  assert.deepEqual(declaredVoiceLanguages({ voiceLanguages: ['ja', ' fi ', 'ja', 'en', 3, ''] }, 'en'), ['ja', 'fi']);
  assert.deepEqual(declaredVoiceLanguages({ voiceLanguages: 'ja' }, 'en'), []);
  assert.deepEqual(declaredVoiceLanguages(null, 'en'), []);
  assert.equal(resolveVoiceLanguage('ja', 'fi', ['en', 'ja']), 'ja');
  assert.equal(resolveVoiceLanguage('', 'fi', ['en', 'ja']), 'fi'); // follows the text
  assert.equal(resolveVoiceLanguage('de', 'fi', ['en', 'ja']), 'fi'); // no recordings in it: back to the text language
});

import { voiceRows, matchVoiceDrops, recordingScriptCsv, stringRows } from '../../dist/engine/src/index.js';

const vrows = () => stringRows(program());

test('voice rows: missing, recorded and outdated per language, with counts', () => {
  const rows = vrows();
  const rec = { aa11: 's1', bb22: 's2', 'aa11.fi': 'f1' };
  const lock = { aa11: { sum: 's1', text: 'First.' }, bb22: { sum: 's2', text: 'Was second.' }, 'aa11.fi': { sum: 'f1', text: 'Eka.' } };
  const t = voiceRows(rows, null, rec, lock, { fi: { aa11: 'Eka.' } });
  assert.deepEqual(t.rows.map(r => [r.name, r.status]), [['aa11', 'recorded'], ['bb22', 'outdated'], ['cc33', 'missing']]);
  assert.equal(t.rows[1].recorded, 'Was second.');
  assert.deepEqual([t.total, t.voiced, t.outdated], [3, 2, 1]);
  const fi = voiceRows(rows, 'fi', rec, lock, { fi: { aa11: 'Eka.' } });
  assert.deepEqual(fi.rows.map(r => [r.name, r.status, r.text]), [['aa11.fi', 'recorded', 'Eka.'], ['bb22.fi', 'missing', 'Second.'], ['cc33.fi', 'missing', 'Third.']]);
  assert.equal(voiceRows(rows, 'fi', rec, lock, { fi: { aa11: 'Ensimmäinen.' } }).rows[0].status, 'outdated'); // the translation was reworded
});

test('voice rows: a recording without a lock entry counts as recorded; filters narrow the list but not the counts', () => {
  const rows = vrows();
  const t = voiceRows(rows, null, { aa11: 'x' }, {}, {}, { missing: true });
  assert.deepEqual(t.rows.map(r => r.name), ['bb22', 'cc33']);
  assert.deepEqual([t.total, t.voiced], [3, 1]);
  assert.deepEqual(voiceRows(rows, null, {}, {}, {}, { query: 'THIRD' }).rows.map(r => r.name), ['cc33']);
  assert.deepEqual(voiceRows(rows, null, { aa11: 'x' }, { aa11: { sum: 'x', text: 'Old.' } }, {}, { outdated: true }).rows.map(r => r.name), ['aa11']);
});

test('dropped files are matched by name for the chosen language, the rest is left for a row', () => {
  const ids = ['aa11', 'bb22'];
  const m = matchVoiceDrops(['take/aa11.wav', 'bb22.fi.mp3', 'zz99.ogg', 'notes.txt', 'aa11.mp3', 'bb22.ogg'], null, ids);
  assert.deepEqual(m.matched, [{ name: 'aa11', file: 'take/aa11.wav' }, { name: 'bb22', file: 'bb22.ogg' }]);
  assert.deepEqual(m.rest, ['bb22.fi.mp3', 'zz99.ogg', 'notes.txt', 'aa11.mp3']);
  assert.deepEqual(matchVoiceDrops(['bb22.fi.mp3', 'bb22.mp3'], 'fi', ids).matched, [{ name: 'bb22.fi', file: 'bb22.fi.mp3' }]);
});

test('the recording script lists id, speaker, text and the file name to deliver', () => {
  const csv = recordingScriptCsv(voiceRows(vrows(), 'fi', {}, {}, { fi: { aa11: 'Eka, "hei".' } }).rows);
  const lines = csv.trim().split('\r\n');
  assert.equal(lines[0], 'id,file,line,speaker,text,filename');
  assert.equal(lines[1], 'aa11,t.vn,2,,"Eka, ""hei"".",aa11.fi');
  assert.equal(lines.length, 4);
});

test('a build can leave voice languages out: only voice files of other languages are dropped', async () => {
  const { shipsAsset, buildLanguages } = await import('../../dist/engine/src/index.js');
  assert.equal(shipsAsset('voice/aa11.fi.ogg', undefined, 'en'), true);
  assert.equal(shipsAsset('voice/aa11.fi.ogg', ['en'], 'en'), false);
  assert.equal(shipsAsset('voice/aa11.ogg', ['en'], 'en'), true, 'the default takes ship under the source label');
  assert.equal(shipsAsset('voice/aa11.ogg', ['fi'], 'en'), false);
  assert.equal(shipsAsset('voice/aa11.fi.txt', [], 'en'), true, 'not an audio file');
  assert.equal(shipsAsset('bg/park.png', [], 'en'), true);
  assert.deepEqual(buildLanguages({ voiceLanguages: ['ja'] }, 'en', ['en', 'fi', 'de'], ['aa11', 'bb22.fi']), { text: ['de', 'fi'], voice: ['en', 'fi', 'ja'] });
});
