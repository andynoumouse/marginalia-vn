import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile, playtest, checkAssets, checkGame, stageSize, newProjectFiles } from '../../dist/engine/src/index.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const project = join(root, 'games/tutorial');
const pages = join(root, 'docs/tutorial');

const script = readFileSync(join(project, 'script/start.vn'), 'utf8');
const game = JSON.parse(readFileSync(join(project, 'game.json'), 'utf8'));

const walk = dir => readdirSync(dir).flatMap(f => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const assetFiles = walk(join(project, 'assets')).map(p => relative(join(project, 'assets'), p).replace(/\\/g, '/')).filter(f => !f.endsWith('.gitkeep'));

const strip = line => line.trim().replace(/\s+#[a-z0-9]{4,}(?=\s|:|$)/g, '');
const finished = new Set(script.split('\n').map(strip));

test('the tutorial game compiles, plays to three endings and has every file it names', () => {
  const stage = stageSize(game.stage);
  const program = compile([{ file: 'script/start.vn', text: script }], undefined, undefined, stage);
  assert.deepEqual(program.diagnostics, []);
  const report = playtest(program, { game });
  assert.ok(report.complete);
  assert.deepEqual([report.unreachableLabels, report.loops], [[], []]);
  assert.deepEqual(report.endings.flatMap(e => e.unlocks).sort(), ['alone_end', 'stay_end', 'together_end']);
  const index = { files: assetFiles };
  const problems = [...checkAssets(program, index).map(d => d.message), ...checkGame(game, index).map(p => p.message)];
  assert.deepEqual(problems, []);
});

test('every achievement and gallery flag in game.json is unlocked by the script', () => {
  const flags = [...script.matchAll(/^\s*unlock (\w+)/gm)].map(m => m[1]);
  for (const a of game.achievements) assert.ok(flags.includes(a.unlock), a.unlock);
  for (const g of game.gallery) assert.ok(flags.includes(g.unlock), g.unlock);
});

test('every script snippet on pages 1 to 5 is a line of the finished game, unless it says otherwise', () => {
  const files = readdirSync(pages).filter(f => /^0[1-5]-.*\.md$/.test(f));
  assert.equal(files.length, 5);
  let checked = 0;
  for (const file of files) {
    const text = readFileSync(join(pages, file), 'utf8');
    for (const m of text.matchAll(/```vn\n([\s\S]*?)```/g)) {
      const lines = m[1].split('\n');
      // A block that starts with "# from the Classic" or "# extra" is not part of the finished script.
      if (/^# (from the Classic|extra)/.test(lines[0])) continue;
      for (const raw of lines) {
        const line = strip(raw);
        if (!line || line.startsWith('#')) continue;
        assert.ok(finished.has(line), `${file}: "${line}" is not in games/tutorial/script/start.vn`);
        checked++;
      }
    }
  }
  assert.ok(checked > 40, `checked ${checked} lines`);
});

test('the whole script on page 2 is the finished game, line for line', () => {
  const text = readFileSync(join(pages, '02-a-story-with-choices.md'), 'utf8');
  const section = text.slice(text.indexOf('## The whole script'));
  const block = section.match(/```vn\n([\s\S]*?)```/);
  assert.ok(block, 'no vn block under "The whole script"');
  const lines = s => s.split('\n').map(strip).filter(Boolean);
  assert.deepEqual(lines(block[1]), lines(script));
});

test('every worked change on the templates page applies to its template and still plays', () => {
  const doc = readFileSync(join(pages, 'deeper/a-templates.md'), 'utf8');
  const changes = [...doc.matchAll(/```vn\n# template ([\w-]+): (add|replace (label|screen) (\w+))\n([\s\S]*?)```/g)];
  assert.ok(changes.length >= 8, `found ${changes.length} blocks`);
  const byTemplate = {};
  for (const m of changes) (byTemplate[m[1]] ??= []).push(m);
  for (const [id, blocks] of Object.entries(byTemplate)) {
    const files = newProjectFiles({ title: 'Rain Park', engineVersion: '0.9.0', kind: 'studio', template: id });
    const tgame = JSON.parse(files['game.json']);
    let lines = files['script/start.vn'].split('\n');
    for (const [, , action, kind, name, body] of blocks) {
      const text = body.replace(/\n$/, '').split('\n');
      if (action === 'add') { lines = [...lines.filter((l, i) => i < lines.length - 1 || l !== ''), '', ...text, '']; continue; }
      const at = lines.findIndex(l => new RegExp(`^${kind} ${name}\\b`).test(l));
      assert.ok(at >= 0, `${id}: no ${kind} ${name}`);
      let end = lines.findIndex((l, i) => i > at && /^(label|screen) /.test(l));
      if (end < 0) end = lines.length;
      while (end > at + 1 && (lines[end - 1] === '' || lines[end - 1].startsWith('#'))) end--;
      lines = [...lines.slice(0, at), ...text, ...lines.slice(end)];
    }
    const program = compile([{ file: 'script/start.vn', text: lines.join('\n') }], undefined, undefined, stageSize(tgame.stage));
    assert.deepEqual(program.diagnostics, [], `${id}: compile`);
    const report = playtest(program, { game: tgame });
    assert.ok(report.complete, `${id}: playtest finished`);
    assert.deepEqual([report.unreachableLabels, report.loops], [[], []], `${id}: no dead labels or loops`);
  }
});
