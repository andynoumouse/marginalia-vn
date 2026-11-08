import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TEMPLATES, DEFAULT_TEMPLATE, templateById, newProjectFiles, compile, playtest, resolveTheme, checkGame, checkAssets, templateAssets, stageSize, assignIds, existingIds,
} from '../../dist/engine/src/index.js';

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pool = fileURLToPath(new URL('../../templates/assets', import.meta.url));
const build = (template, kind = 'studio') => newProjectFiles({ title: 'Rain Park', engineVersion: '0.4.0', kind, template });

test('the registry: unique ids, the default exists, every template has a title, a description and a script', () => {
  assert.equal(new Set(TEMPLATES.map(t => t.id)).size, TEMPLATES.length);
  assert.ok(templateById(DEFAULT_TEMPLATE));
  assert.equal(templateById('nope'), undefined);
  for (const t of TEMPLATES) assert.ok(t.title && t.description && t.start.some(l => l.startsWith('label start:')), t.id);
});

test('no template changes the base files, and the default is the blank one', () => {
  assert.deepEqual(newProjectFiles({ title: 'Rain Park', engineVersion: '0.4.0', kind: 'studio' }), build('blank'));
  for (const t of TEMPLATES) {
    const files = build(t.id), base = build('blank');
    for (const f of Object.keys(base)) assert.ok(f in files, `${t.id} keeps ${f}`);
    assert.equal(files['README.md'], base['README.md']);
  }
  assert.throws(() => build('nope'), /Unknown template "nope"/);
});

test('every template builds a game that compiles, plays through and resolves its theme', () => {
  for (const t of TEMPLATES) {
    const files = build(t.id);
    const game = JSON.parse(files['game.json']);
    assert.equal(game.id, 'rain-park');
    const stage = stageSize(game.stage);
    const program = compile([{ file: 'script/start.vn', text: files['script/start.vn'] }], undefined, undefined, stage);
    assert.deepEqual(program.diagnostics, [], `${t.id}: compile diagnostics`);
    const report = playtest(program, { game });
    assert.ok(report.complete, `${t.id}: playtest finished`);
    assert.deepEqual([report.unreachableLabels, report.loops], [[], []], `${t.id}: no dead labels or loops`);
    assert.ok(report.endings.length >= 1, `${t.id}: reaches an ending`);
    const warnings = [];
    resolveTheme(game.theme, { default: JSON.parse(files['themes/default.json']) }, m => warnings.push(m));
    assert.deepEqual(warnings, [], `${t.id}: theme warnings`);
  }
});

test('every template ships all it references: the asset check finds nothing missing, and the pool has each file', () => {
  for (const t of TEMPLATES) {
    const files = build(t.id);
    const game = JSON.parse(files['game.json']);
    const stage = stageSize(game.stage);
    const assets = templateAssets(t.id, stage);
    for (const a of assets) assert.ok(existsSync(join(pool, a.from)), `${t.id}: the pool has ${a.from}`);
    const program = compile([{ file: 'script/start.vn', text: files['script/start.vn'] }], undefined, undefined, stage);
    const index = { files: assets.map(a => a.to.replace(/^assets\//, '')) };
    const problems = [...checkAssets(program, index).map(d => d.message), ...checkGame(game, index).map(p => p.message)];
    assert.deepEqual(problems, [], t.id);
  }
});

test('assignIds marks every string of every template, a second pass adds none, and the result still compiles', () => {
  for (const t of TEMPLATES) {
    const files = build(t.id), game = JSON.parse(files['game.json']);
    const first = assignIds(files['script/start.vn'], existingIds([files['script/start.vn']]));
    assert.ok(first.added > 0, `${t.id}: has strings to mark`);
    assert.equal(assignIds(first.text, existingIds([first.text])).added, 0, `${t.id}: nothing left unmarked`);
    const program = compile([{ file: 'script/start.vn', text: first.text }], undefined, undefined, stageSize(game.stage));
    assert.deepEqual(program.diagnostics, [], `${t.id}: compiles with ids`);
  }
});

test('the title background follows the stage: a portrait stage gets the portrait file, whatever the template', () => {
  assert.equal(templateAssets('blank')[0].from, 'bg/bg_title.png');
  assert.equal(templateAssets('portrait')[0].from, 'bg/bg_title_portrait.png');
  assert.equal(templateAssets('blank', { width: 1080, height: 1920 })[0].from, 'bg/bg_title_portrait.png');
  assert.equal(templateAssets('blank', { width: 1080, height: 1920 })[0].to, 'assets/bg/bg_title.png');
  assert.deepEqual(templateAssets('nope'), []);
});

test('the sample and the demo hold the same bytes as the pool wherever they share a file (the pool is the source)', () => {
  let shared = 0;
  for (const rel of readdirSync(pool, { recursive: true }).map(f => f.replaceAll('\\', '/')).filter(f => statSync(join(pool, f)).isFile())) {
    for (const game of ['sample', 'demo']) {
      const copy = new URL(`../../games/${game}/assets/${rel}`, import.meta.url);
      if (!existsSync(copy)) continue;
      shared++;
      assert.ok(readFileSync(copy).equals(readFileSync(join(pool, rel))), `games/${game}/assets/${rel} differs from templates/assets/${rel}`);
    }
  }
  assert.ok(shared >= 6, 'the audio is shared');
});

test('the portrait template sets a portrait stage; a stage given by the caller wins', () => {
  assert.deepEqual(JSON.parse(build('portrait')['game.json']).stage, { width: 1080, height: 1920 });
  const wide = newProjectFiles({ title: 'P', engineVersion: '0.4.0', kind: 'studio', template: 'portrait', stage: { width: 1920, height: 1080 } });
  assert.equal(JSON.parse(wide['game.json']).stage, undefined);
});

test('templates that place things in landscape pixels refuse a portrait stage; the others accept it', () => {
  const portrait = { width: 1080, height: 1920 };
  for (const t of TEMPLATES) {
    const make = () => newProjectFiles({ title: 'P', engineVersion: '0.4.0', kind: 'studio', template: t.id, stage: portrait });
    if (t.landscapeOnly) assert.throws(make, /landscape/, t.id);
    else assert.doesNotThrow(make, t.id);
  }
  assert.deepEqual(TEMPLATES.filter(t => t.landscapeOnly).map(t => t.id), ['branching', 'mystery']);
});

test('each style does what it says: endings, choices, NVL pages, the HUD and the clickable room', () => {
  const run = id => {
    const files = build(id), game = JSON.parse(files['game.json']);
    const program = compile([{ file: 'script/start.vn', text: files['script/start.vn'] }], undefined, undefined, stageSize(game.stage));
    return { game, program, report: playtest(program, { game, allLabels: true }), text: files['script/start.vn'] };
  };
  assert.equal(run('classic-adv').report.endings.length, 2);
  assert.equal(run('branching').report.endings.length, 4, 'one ending per route, plus walking alone');
  assert.deepEqual(run('branching').game.achievements.map(a => a.unlock).sort(), ['friends_end', 'mina_end', 'ren_end']);
  assert.equal(run('branching').game.gallery.length, 3, 'a CG per ending');
  assert.ok(run('branching').program.screens.status, 'a status HUD');
  for (const [id, who] of [['classic-adv', ['mina']], ['branching', ['mina', 'ren']]]) {
    for (const w of who) assert.match(run(id).text, new RegExp(`show ${w} neutral`), `${id} shows ${w}`);
  }
  assert.ok(run('mystery').program.screens.room, 'a room screen');
  assert.ok(run('mystery').program.screens.inventory, 'an inventory screen');
  assert.match(run('mystery').text, /^\s*input name /m, 'asks for a name');
  assert.equal(run('mystery').report.endings.length, 2, 'the door and the window');
  const nvl = run('kinetic-nvl');
  assert.match(nvl.text, /nvl on/);
  assert.ok(!nvl.program.ops.some(op => op.op === 'menu'), 'a kinetic novel has no choices');
  assert.ok(!nvl.game.titleScreen.buttons.includes('gallery'));
});
