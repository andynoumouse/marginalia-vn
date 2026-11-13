import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, Runtime, NullRenderer, Locale, assignIds, existingIds, stringRows, scriptStats, getCompletions } from '../../dist/engine/src/index.js';

const script = (end) => `define e "Eve" color=#ffffff\nlabel start:\n  set name = "Eve"\n  e: Goodbye. #aaaa\n  ${end}\n`;
const play = async (text, locale) => {
  const p = compile([{ file: 'a.vn', text }]);
  assert.deepEqual(p.diagnostics.filter(d => d.severity === 'error'), []);
  const r = new NullRenderer();
  await new Runtime(p, r, locale).start();
  assert.equal(r.ended, true);
  return r.endTitle;
};

test('end "Name" hands the ending name to the renderer, formatted and translated; a bare end gives none', async () => {
  assert.equal(await play(script('end')), '');
  assert.equal(await play(script('end "The Quiet Ending" #ql01')), 'The Quiet Ending');
  assert.equal(await play(script('end "[name]\'s Ending"')), "Eve's Ending");
  assert.equal(await play(script('end "The Quiet Ending" #ql01'), new Locale({ fi: { ql01: 'Hiljainen loppu' } }, 'fi', 'en')), 'Hiljainen loppu');
  // Running off the end of the script is not a named ending.
  assert.equal(await play('label start:\n  "Hi" #hhhh\n'), '');
});

test('end takes one name and an id only with a name', () => {
  const err = text => compile([{ file: 'a.vn', text }]).diagnostics.filter(d => d.severity === 'error').map(d => d.message);
  assert.match(err('label start:\n  end "A" "B"\n')[0], /Use: end \["Ending name"\]/);
  assert.match(err('label start:\n  end #ab12\n')[0], /needs an ending name/);
  assert.match(err('label start:\n  "Hi" #ql01\n  end "Bye" #ql01\n')[0], /Duplicate localization id #ql01/);
});

test('npm run ids gives a named end an id, once; the name is a translation row and counts as read words', () => {
  const text = 'label start:\n  "Hi" #hhhh\n  end "The Quiet Ending"\n  end\n';
  const a = assignIds(text, existingIds([text]), () => 0.5);
  assert.equal(a.added, 1);
  assert.match(a.text, /end "The Quiet Ending" #[a-z][a-z0-9]{3}\n  end\n$/);
  assert.equal(assignIds(a.text, existingIds([a.text])).added, 0);
  const id = /#([a-z0-9]+)\n  end\n$/.exec(a.text)[1];
  assert.ok(existingIds([a.text]).has(id));
  const p = compile([{ file: 'a.vn', text: a.text }]);
  assert.deepEqual(stringRows(p).map(r => [r.id, r.kind, r.source, r.line]), [['hhhh', 'say', 'Hi', 2], [id, 'ending', 'The Quiet Ending', 3]]);
  assert.equal(scriptStats(p).total.words, 4);
});

test('the end completion shows the name form', () => {
  const p = compile([{ file: 'a.vn', text: 'label start:\n  end\n' }]);
  assert.ok(getCompletions(p, 'en').some(s => /end \["Ending name"\]/.test(s.detail ?? s.label ?? '')));
});
