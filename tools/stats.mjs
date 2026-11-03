// Script statistics: words, lines and reading time per script, label and character (engine/src/stats.ts).
//   node tools/stats.mjs [--json] [--wpm <words a minute>]
// Run after "npm run build".

import path from 'node:path';
import { checkEngineVersion, projectRoot } from './paths.mjs';
import { projectData } from './project-data.mjs';

const root = projectRoot();
checkEngineVersion(root);
const { compile, namedAnchors, namedPositions, stageSize, scriptStats, statsText } = await import(new URL('../dist/engine/src/index.js', import.meta.url).href)
  .catch(() => { console.error('Engine not built. Run "npm run build" first.'); process.exit(1); });

const args = process.argv.slice(2);
const wpmAt = args.indexOf('--wpm');
const wpm = wpmAt >= 0 ? Number(args[wpmAt + 1]) : undefined;
if (wpm !== undefined && !(wpm > 0)) { console.error('--wpm wants a number of words a minute, like --wpm 250'); process.exit(2); }

const project = projectData(root);
const program = compile(project.scripts, namedPositions(project.game), namedAnchors(project.game), stageSize(project.game));
for (const d of program.diagnostics.filter(d => d.severity === 'error')) console.warn(`error ${d.file}:${d.line} ${d.message}`);

const stats = scriptStats(program, wpm);
console.log(args.includes('--json') ? JSON.stringify(stats, null, 2) : statsText(stats, `Script statistics of ${path.basename(root)}`));
