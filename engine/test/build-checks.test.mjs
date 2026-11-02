import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCheckSettings, buildChecks, checkGame, compile, formatBuildReport, stringRows } from '../../dist/engine/src/index.js';

const scripts = [{
  file: 't.vn',
  text: ['label start:', '  "First." #aa11', '  "Second." #bb22', '  "Third." #cc33', '  "No id yet."'].join('\n'),
}];
const program = compile(scripts);
const rows = stringRows(program);
const base = { diagnostics: [], scripts, rows, source: 'en', locale: {}, snapshots: {}, recordings: {}, lock: {} };
const checks = (extra = {}) => buildChecks({ ...base, ...extra });
const only = (report, check) => report.findings.filter(f => f.check === check);

test('a clean project has no findings', () => {
  const clean = [{ file: 't.vn', text: scripts[0].text.replace('"No id yet."', '"No id yet." #dd44') }];
  const r = buildChecks({ ...base, scripts: clean });
  assert.deepEqual(r.findings, []);
  assert.deepEqual(formatBuildReport(r), ['0 errors, 0 warnings']);
});

test('script errors block, script warnings and lines without ids warn', () => {
  const r = checks({ diagnostics: [
    { file: 't.vn', line: 2, severity: 'warning', message: 'odd' },
    { file: 't.vn', line: 3, severity: 'error', message: 'broken' },
  ] });
  assert.deepEqual(r.findings.map(f => [f.check, f.severity]), [['script', 'error'], ['script-warnings', 'warning'], ['ids', 'warning']]);
  assert.equal(r.errors, 1);
  assert.equal(r.warnings, 2);
  assert.deepEqual(only(r, 'script')[0], { check: 'script', severity: 'error', message: 'broken', file: 't.vn', line: 3 });
  assert.equal(only(r, 'ids')[0].count, 1);
  assert.match(formatBuildReport(r)[0], /^error t\.vn:3 broken$/);
});

test('translations: untranslated, reworded and unused entries per language, the source language ignored', () => {
  const r = checks({
    locale: { en: { aa11: 'First.' }, fi: { aa11: 'Ensimmäinen.', bb22: 'Toinen.', zz99: 'Vanha.' } },
    snapshots: { fi: { aa11: 'First!', bb22: 'Second.' } },
  });
  const untranslated = only(r, 'untranslated');
  assert.equal(untranslated.length, 1);
  assert.equal(untranslated[0].lang, 'fi');
  assert.equal(untranslated[0].count, 1);
  assert.match(untranslated[0].message, /^fi: 1 of 3 strings untranslated \(#cc33\)$/);
  assert.equal(untranslated[0].file, 't.vn');
  assert.equal(untranslated[0].line, 4, 'points at the first untranslated line');
  assert.equal(only(r, 'translation-outdated')[0].count, 1);
  assert.match(only(r, 'translation-outdated')[0].message, /#aa11/);
  assert.match(only(r, 'unused-locale')[0].message, /#zz99/);
  assert.equal(only(r, 'unused-locale')[0].severity, 'info');
  assert.ok(!r.findings.some(f => f.lang === 'en'));
});

test('voice: reworded and missing takes are judged per language that has recordings; none at all means no findings', () => {
  assert.deepEqual(checks().findings.filter(f => f.check.startsWith('voice')), []);
  const r = checks({
    recordings: { aa11: 's1', bb22: 's2', 'aa11.fi': 's3' },
    lock: { aa11: { sum: 's1', text: 'First, once upon a time.' }, bb22: { sum: 's2', text: 'Second.' } },
    locale: { fi: { aa11: 'Ensimmäinen.', bb22: 'Toinen.', cc33: 'Kolmas.' } },
  });
  assert.match(only(r, 'voice-outdated')[0].message, /^en: 1 recording of reworded lines \(#aa11\)$/);
  const missing = only(r, 'voice-missing');
  assert.deepEqual(missing.map(f => [f.lang, f.count]), [['en', 1], ['fi', 2]]);
  assert.ok(missing.every(f => f.severity === 'info'));
});

test('voice: languages in game.json voiceLanguages are held to recordings before the first one; translations alone are not', () => {
  const r = checks({ game: { voiceLanguages: ['ja', 'en', ' ja '] }, locale: { fi: { aa11: 'Ensimmäinen.' } } });
  assert.deepEqual(only(r, 'voice-missing').map(f => [f.lang, f.count]), [['ja', 3]], 'the source language is the default take, fi has no voice');
});

test('languages left out of the build are not checked', () => {
  const extra = { locale: { fi: { aa11: 'Ensimmäinen.' }, de: {} }, recordings: { aa11: 's1', 'aa11.fi': 's2' }, lock: { aa11: { sum: 's1', text: 'First.' }, 'aa11.fi': { sum: 's2', text: 'Ensimmäinen.' } } };
  const all = checks(extra);
  assert.deepEqual(only(all, 'untranslated').map(f => f.lang), ['de', 'fi']);
  const r = checks({ ...extra, include: { text: ['fi'], voice: ['en'] } });
  assert.deepEqual(only(r, 'untranslated').map(f => f.lang), ['fi']);
  assert.deepEqual(only(r, 'voice-missing').map(f => f.lang), ['en'], 'fi recordings are not judged');
  assert.deepEqual(checks({ ...extra, include: { text: [], voice: [] } }).findings.filter(f => /untranslated|voice/.test(f.check)), []);
});

test('recordings of lines that no longer exist are reported once', () => {
  const r = checks({ recordings: { qq00: 'x', 'qq00.fi': 'y' } });
  const strays = only(r, 'unmatched-voice');
  assert.equal(strays.length, 1);
  assert.equal(strays[0].count, 2);
  assert.ok(!only(r, 'voice-missing').length, 'strays do not make a language count as voiced');
});

test('game.json build.checks changes a check level or turns it off', () => {
  const r = checks({
    game: { build: { checks: { ids: 'error', 'voice-missing': 'off', untranslated: 'info' } } },
    locale: { fi: {} },
    recordings: { aa11: 's1' },
  });
  assert.equal(only(r, 'ids')[0].severity, 'error');
  assert.equal(only(r, 'untranslated')[0].severity, 'info');
  assert.deepEqual(only(r, 'voice-missing'), []);
  assert.equal(r.errors, 1);
});

test('findings are ordered errors, then warnings, then notes', () => {
  const r = checks({ diagnostics: [{ file: 't.vn', line: 1, severity: 'error', message: 'x' }], locale: { fi: { zz99: 'a' } } });
  assert.deepEqual(r.findings.map(f => f.severity), ['error', 'warning', 'warning', 'info']);
  assert.equal(formatBuildReport(r).at(-1), '1 error, 2 warnings, 1 note');
});

test('bad build.checks settings are reported by checkGame and ignored', () => {
  const game = { build: { checks: { nope: 'error', ids: 'loud', 'voice-missing': 'off' } } };
  const { levels, problems } = buildCheckSettings(game);
  assert.deepEqual(levels, { 'voice-missing': 'off' });
  assert.equal(problems.length, 2);
  const index = { files: [], rigs: {}, blips: [], skins: [] };
  assert.equal(checkGame(game, index, '{}').filter(d => d.message.startsWith('build.checks')).length, 2);
  assert.deepEqual(buildCheckSettings({}).problems, []);
  assert.equal(buildCheckSettings({ build: { checks: [] } }).problems.length, 1);
});
