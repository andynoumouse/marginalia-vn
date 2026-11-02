// The pre-build checks (engine/src/build-checks.ts) on a project folder: gathers the scripts, locale tables, snapshots and
// recordings from disk and returns the report. Shared by `vn export` and the editor's Build dialog.

import fs from 'node:fs';
import path from 'node:path';
import { assetIndex, projectData } from './project-data.mjs';
import { readLock, readLocale, readRecordings } from './voice-check.mjs';

const engine = await import(new URL('../dist/engine/src/index.js', import.meta.url).href);

/** `locale/<lang>.src` snapshots by language: the source text each translation was made against. */
export function readSnapshots(root) {
  const dir = path.join(root, 'locale');
  const snaps = {};
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.src'))) {
    try { snaps[f.slice(0, -4)] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { /* a broken snapshot judges nothing */ }
  }
  return snaps;
}

/**
 * Compiles the project and runs every check. Returns `{ project, program, report, languages }`; nothing is written. `include` is
 * `{ text?: string[], voice?: string[] }`: the languages the build ships (missing = all), the others are not checked.
 */
export function runBuildChecks(root, project = projectData(root), include = undefined) {
  const { compile, checkAssets, checkGame, namedPositions, namedAnchors, stageSize, stringRows, sourceLanguage, buildChecks, buildLanguages } = engine;
  const program = compile(project.scripts, namedPositions(project.game), namedAnchors(project.game), stageSize(project.game));
  const index = assetIndex(project);
  const diagnostics = [...program.diagnostics, ...checkAssets(program, index), ...checkGame(project.game, index, project.gameText ?? '')];
  const source = sourceLanguage(project.game);
  const locale = readLocale(root);
  const recordings = readRecordings(root);
  const report = buildChecks({
    diagnostics,
    scripts: project.scripts,
    rows: stringRows(program),
    source,
    locale,
    snapshots: readSnapshots(root),
    recordings,
    lock: readLock(root),
    game: project.game,
    include,
  });
  return { project, program, report, languages: { source, ...buildLanguages(project.game, source, Object.keys(locale), Object.keys(recordings)) } };
}
