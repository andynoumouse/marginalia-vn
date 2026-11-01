import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachPreloads, checkAssets, compile, VOICE_KEY, voiceFile } from '../../dist/engine/src/index.js';

const has = names => n => names.includes(n);

test('a voice file is found by line id, the language folder first', () => {
  assert.equal(voiceFile('ab12', 'en', has(['ab12'])), 'ab12');
  assert.equal(voiceFile('ab12', 'fi', has(['ab12', 'fi/ab12'])), 'fi/ab12');
  assert.equal(voiceFile('ab12', 'en', has(['fi/ab12'])), null);
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

test('a voiced line asks for its recording as a preload task, in any language folder', () => {
  const p = program();
  const index = { files: ['voice/aa11.ogg', 'voice/fi/bb22.mp3'] };
  const pre = attachPreloads(p, index);
  const keys = pre.tasks[0].map(t => t.key);
  assert.deepEqual(keys, [VOICE_KEY + 'aa11', VOICE_KEY + 'bb22']); // cc33 has no file
  assert.equal(pre.tasks[0].find(t => t.key === 'voice/bb22').lines, 1);
});

test('without voice files nothing is preloaded for lines', () => {
  assert.equal(attachPreloads(program(), { files: ['bg/park.png'] }).tasks[0], undefined);
});

test('a voice file that matches no line is reported', () => {
  const index = { files: ['voice/aa11.ogg', 'voice/fi/zz99.ogg', 'voice/notes.txt'] };
  const found = checkAssets(program(), index).filter(d => /Voice file/.test(d.message));
  assert.deepEqual(found.map(d => d.file), ['assets/voice/fi/zz99.ogg']);
});
