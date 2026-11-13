import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, playtest, playtestText, scriptStats, statsText } from '../../dist/engine/src/index.js';

const run = text => {
  const p = compile([{ file: 'a.vn', text }]);
  assert.deepEqual(p.diagnostics.filter(d => d.severity === 'error'), []);
  return { p, report: playtest(p) };
};
const ending = (report, line) => report.endings.find(e => e.src.line === line);

const branch = `label start:
  "One two three."
  menu "Pick?":
    "Short":
      jump fin
    "Long way":
      "Four five six seven."
      jump fin
label fin:
  end "Done"
`;

test('words to an ending: the shortest route, and the most different lines a route reads (prompt, options shown, name included)', () => {
  const { report } = run(branch);
  // 3 + the menu (Pick? Short Long way: 4) + 1 for "Done" = 8; the long way adds 4 more.
  assert.deepEqual(ending(report, 10).words, { min: 8, max: 12 });
  assert.equal(ending(report, 10).title, 'Done');
});

test('going round a loop adds nothing to the longest: each line counts once, while the shortest counts what it rereads', () => {
  const { report } = run(`label start:
  "Hub line."
  menu:
    "Again" if n < 3:
      set n += 1
      jump start
    "Leave":
      end
`);
  // Hub line (2) and both options (2): leaving at once reads 4; going round again rereads the same lines.
  assert.deepEqual(ending(report, 8).words, { min: 4, max: 4 });
  const { report: twice } = run(`label start:
  "Hub line."
  menu:
    "Again" if n < 1:
      set n += 1
      "A side remark here."
      jump start
    "Leave":
      end
`);
  // The longest goes round once for the side remark (4 more); the hub it reads again counts once.
  assert.deepEqual(ending(twice, 9).words, { min: 4, max: 8 });
});

test('endings reached only from another label get no word counts', () => {
  const { report } = run('label start:\n  "Hi."\n  end\nlabel side:\n  "Elsewhere."\n  end\n');
  assert.deepEqual(ending(report, 3).words, { min: 1, max: 1 });
  const p = compile([{ file: 'a.vn', text: 'label start:\n  "Hi."\n  end\nlabel side:\n  "Elsewhere."\n  end\n' }]);
  assert.equal(playtest(p, { roots: ['side'] }).endings.find(e => e.src.line === 6).words, undefined);
});

test('the playtest report and the statistics show the words per route', () => {
  const { p, report } = run(branch);
  assert.match(playtestText(report), /end "Done" at a\.vn:10  8 to 12 words  via/);
  const text = statsText(scriptStats(p), 'Stats', report.endings);
  assert.match(text, /\nRoutes \(words read from the start/);
  assert.match(text, /\n  a\.vn:10 "Done"  8 to 12 words  \(under a minute\)/);
  assert.doesNotMatch(statsText(scriptStats(p)), /Routes/);
});

// UX round 3 ED-2: an ending no route reaches is named, so it does not just look missing from the routes.
test('the statistics name the endings no route reaches', () => {
  const { p, report } = run('label start:\n  "Hi."\n  end\nlabel cafe:\n  "Coffee."\n  end "Bitter Night"\n');
  assert.deepEqual(report.unreachedEndings, [{ src: report.unreachedEndings[0].src, title: 'Bitter Night' }]);
  assert.equal(report.unreachedEndings[0].src.line, 6);
  assert.match(statsText(scriptStats(p), 'Stats', report.endings, report.unreachedEndings), /\nNot reached from the start \(no route leads there, so no words are counted\): a\.vn:6 "Bitter Night"/);
});
