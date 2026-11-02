import type { Diagnostic } from './types.js';
import type { StringTable } from './locale.js';
import { assignIds, existingIds } from './ids.js';
import { outdatedIds, translationStatus, type SourceSnapshot, type StringRow } from './translation.js';
import { declaredVoiceLanguages, splitVoiceName, voiceRows, type BuildLanguages, type VoiceLock } from './voice.js';

/**
 * The checks run before a build, as rows the editor's Build dialog and `vn export` both report. Pure: the caller gathers the
 * project (diagnostics, strings, locale tables, recordings) and decides what to do with the findings.
 */

export type CheckId = 'script' | 'script-warnings' | 'ids' | 'untranslated' | 'translation-outdated' | 'voice-outdated' | 'voice-missing' | 'unused-locale' | 'unmatched-voice';
export type CheckLevel = 'error' | 'warning' | 'info';

/** What each check counts as unless game.json `build.checks` says otherwise. */
export const DEFAULT_LEVELS: Record<CheckId, CheckLevel> = {
  script: 'error',
  'script-warnings': 'warning',
  ids: 'warning',
  untranslated: 'warning',
  'translation-outdated': 'warning',
  'voice-outdated': 'warning',
  'voice-missing': 'info',
  'unused-locale': 'info',
  'unmatched-voice': 'info',
};

export const CHECK_TITLES: Record<CheckId, string> = {
  script: 'Script, asset and game.json errors',
  'script-warnings': 'Script, asset and game.json warnings',
  ids: 'Lines without an id',
  untranslated: 'Untranslated strings',
  'translation-outdated': 'Translations of reworded lines',
  'voice-outdated': 'Recordings of reworded lines',
  'voice-missing': 'Lines without a recording',
  'unused-locale': 'Unused locale entries',
  'unmatched-voice': 'Recordings that match no line',
};

export type CheckSettings = Partial<Record<CheckId, CheckLevel | 'off'>>;

/** The per-check levels of game.json `build.checks` (a check name -> "error" | "warning" | "info" | "off"), and what is wrong with it. */
export function buildCheckSettings(game: unknown): { levels: CheckSettings; problems: string[] } {
  const raw = (game as { build?: { checks?: unknown } } | null | undefined)?.build?.checks;
  const levels: CheckSettings = {};
  const problems: string[] = [];
  if (raw === undefined) return { levels, problems };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { levels, problems: ['build.checks: expected an object of check names, such as { "voice-missing": "off" }'] };
  for (const [name, level] of Object.entries(raw)) {
    if (!(name in DEFAULT_LEVELS)) problems.push(`build.checks: no check "${name}" (known: ${Object.keys(DEFAULT_LEVELS).join(', ')})`);
    else if (level !== 'error' && level !== 'warning' && level !== 'info' && level !== 'off') problems.push(`build.checks.${name}: expected "error", "warning", "info" or "off"`);
    else levels[name as CheckId] = level;
  }
  return { levels, problems };
}

export interface BuildFinding {
  check: CheckId;
  severity: CheckLevel;
  message: string;
  /** The language the finding is about (the source language for the default voice take). */
  lang?: string;
  /** Where to go to see it: the first affected line, when there is one. */
  file?: string;
  line?: number;
  /** How many strings, lines or files are affected, when the message summarizes them. */
  count?: number;
}

export interface BuildCheckInput {
  /** The diagnostics of compiling the scripts, plus the asset and game.json checks. */
  diagnostics: Diagnostic[];
  /** The script texts, to find lines without an id. */
  scripts: { file: string; text: string }[];
  /** `stringRows` of the compiled program. */
  rows: StringRow[];
  /** The language the scripts are written in. */
  source: string;
  /** `locale/<lang>.json` tables (the source language's export is ignored). */
  locale: Record<string, StringTable>;
  /** `locale/<lang>.src` snapshots. */
  snapshots: Record<string, SourceSnapshot>;
  /** Recordings under assets/voice: name -> checksum. */
  recordings: Record<string, string>;
  lock: VoiceLock;
  /** game.json, for `build.checks` and `voiceLanguages`. */
  game?: unknown;
  /** The languages this build ships; the ones left out are not checked. Missing = all. */
  include?: BuildLanguages;
}

export interface BuildReport {
  findings: BuildFinding[];
  errors: number;
  warnings: number;
}

const EXAMPLES = 3;

/** "ab12, cd34, ef56 and 9 more" */
function some(ids: string[]): string {
  const shown = ids.slice(0, EXAMPLES).map(id => `#${id}`).join(', ');
  return ids.length > EXAMPLES ? `${shown} and ${ids.length - EXAMPLES} more` : shown;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Runs every check that is not switched off and returns the findings, errors first, otherwise in check order. */
export function buildChecks(input: BuildCheckInput): BuildReport {
  const { levels } = buildCheckSettings(input.game);
  const found: BuildFinding[] = [];
  const add = (check: CheckId, f: Omit<BuildFinding, 'check' | 'severity'>) => {
    const level = levels[check] ?? DEFAULT_LEVELS[check];
    if (level !== 'off') found.push({ check, severity: level, ...f });
  };
  const where = (id: string) => { const r = input.rows.find(row => row.id === id); return r?.file !== undefined ? { file: r.file, line: r.line } : {}; };

  for (const d of input.diagnostics) add(d.severity === 'error' ? 'script' : 'script-warnings', { message: d.message, file: d.file, line: d.line });

  // Lines that would get an id from "npm run ids".
  const taken = existingIds(input.scripts.map(s => s.text));
  for (const s of input.scripts) {
    const { added } = assignIds(s.text, new Set(taken));
    if (added) add('ids', { message: `${s.file}: ${plural(added, 'line has', 'lines have')} no id, so ${added === 1 ? 'it' : 'they'} cannot be translated or voiced (run "npm run ids")`, file: s.file, count: added });
  }

  const langs = Object.keys(input.locale).filter(l => l !== input.source && (!input.include?.text || input.include.text.includes(l))).sort();
  for (const lang of langs) {
    const table = input.locale[lang];
    const st = translationStatus(input.rows, table);
    if (st.missing.length) add('untranslated', { lang, message: `${lang}: ${st.missing.length} of ${st.total} strings untranslated (${some(st.missing)})`, count: st.missing.length, ...where(st.missing[0]) });
    const old = outdatedIds(input.rows, table, input.snapshots[lang] ?? {});
    if (old.length) add('translation-outdated', { lang, message: `${lang}: ${plural(old.length, 'translation')} of reworded lines (${some(old)})`, count: old.length, ...where(old[0]) });
    if (st.unused.length) add('unused-locale', { lang, message: `${lang}: ${plural(st.unused.length, 'entry', 'entries')} in locale/${lang}.json match no line (${st.unused.slice(0, EXAMPLES).map(id => `#${id}`).join(', ')}${st.unused.length > EXAMPLES ? ', ...' : ''})`, count: st.unused.length });
  }

  // Voice: languages that have recordings, or that game.json "voiceLanguages" lists, are held to having them for every line.
  const voiced = new Set<string | null>(declaredVoiceLanguages(input.game as { voiceLanguages?: unknown } | null, input.source));
  const ids = new Set(input.rows.map(r => r.id));
  const strays: string[] = [];
  for (const name of Object.keys(input.recordings)) {
    const { id, lang } = splitVoiceName(name);
    if (!ids.has(id)) strays.push(name);
    else voiced.add(lang);
  }
  const label = (lang: string | null) => lang ?? input.source;
  const shipsVoice = (lang: string | null) => !input.include?.voice || input.include.voice.includes(label(lang));
  for (const lang of [...voiced].filter(shipsVoice).sort((a, b) => label(a).localeCompare(label(b)))) {
    const table = voiceRows(input.rows, lang, input.recordings, input.lock, input.locale);
    const outdated = table.rows.filter(r => r.status === 'outdated');
    if (outdated.length) add('voice-outdated', { lang: label(lang), message: `${label(lang)}: ${plural(outdated.length, 'recording')} of reworded lines (${some(outdated.map(r => r.row.id))})`, count: outdated.length, ...where(outdated[0].row.id) });
    const missing = voiceRows(input.rows, lang, input.recordings, input.lock, input.locale, { missing: true }).rows;
    if (missing.length) add('voice-missing', { lang: label(lang), message: `${label(lang)}: ${missing.length} of ${table.total} spoken lines have no recording (${some(missing.map(r => r.row.id))})`, count: missing.length, ...where(missing[0].row.id) });
  }
  if (strays.length) add('unmatched-voice', { message: `${plural(strays.length, 'recording')} in assets/voice match no line (${strays.slice(0, EXAMPLES).join(', ')}${strays.length > EXAMPLES ? ', ...' : ''})`, count: strays.length });

  const rank = { error: 0, warning: 1, info: 2 } as const;
  const findings = found.map((f, i) => ({ f, i })).sort((a, b) => rank[a.f.severity] - rank[b.f.severity] || a.i - b.i).map(x => x.f);
  return { findings, errors: findings.filter(f => f.severity === 'error').length, warnings: findings.filter(f => f.severity === 'warning').length };
}

/** The report as lines of text for the terminal and the Output panel: one per finding, then a summary. */
export function formatBuildReport(report: BuildReport): string[] {
  const lines = report.findings.map(f => `${f.severity} ${f.file !== undefined ? `${f.file}${f.line !== undefined ? `:${f.line}` : ''} ` : ''}${f.message}`);
  const infos = report.findings.length - report.errors - report.warnings;
  lines.push(`${plural(report.errors, 'error')}, ${plural(report.warnings, 'warning')}${infos ? `, ${plural(infos, 'note')}` : ''}`);
  return lines;
}
