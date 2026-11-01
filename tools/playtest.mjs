// Playtest bot: plays every route of the game and reports what it found (engine/src/playtest.ts).
//   node tools/playtest.mjs [--json] [--strict] [--max-states <n>] [--seeds <n>] [--label <name>]...
// Run after "npm run build". Exit code 1 on script errors, or on any finding with --strict.

import path from 'node:path';
import { checkEngineVersion, projectRoot } from './paths.mjs';
import { assetIndex, projectData } from './project-data.mjs';

const root = projectRoot();
checkEngineVersion(root);
const { compile, namedAnchors, namedPositions, stageSize, playtest, playtestText } = await import(new URL('../dist/engine/src/index.js', import.meta.url).href)
  .catch(() => { console.error('Engine not built. Run "npm run build" first.'); process.exit(1); });

const args = process.argv.slice(2);
const flag = name => args.includes(name);
const values = name => args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]] : []));
const number = name => { const v = Number(values(name)[0]); return Number.isFinite(v) && v > 0 ? v : undefined; };

const project = projectData(root);
const program = compile(project.scripts, namedPositions(project.game), namedAnchors(project.game), stageSize(project.game));
const errors = program.diagnostics.filter(d => d.severity === 'error');
for (const d of errors) console.error(`error ${d.file}:${d.line} ${d.message}`);
if (errors.length) { console.error('Fix the script errors first; nothing was played.'); process.exit(1); }

const report = playtest(program, {
  maxStates: number('--max-states'), seeds: number('--seeds'), roots: values('--label'), allLabels: flag('--all-labels'),
  game: project.game, assets: assetIndex(project),
});

if (flag('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(playtestText(report, `Playtest of ${path.basename(root)}`));
}

const findings = report.unreachableLines.length + report.unreachableLabels.length + report.loops.length + report.stuck.length
  + report.unusedVariables.length + report.unsetVariables.length + report.unusedFlags.length + report.unusedAssets.length;
process.exit(flag('--strict') && (findings || !report.complete) ? 1 : 0);
