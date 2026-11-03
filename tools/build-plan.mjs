// Whether a tool builds the engine with TypeScript or uses the dist/ that is already there. The engine repo has TypeScript (a dev
// dependency) and builds; a packaged engine (Marginalia Studio ships a prebuilt dist/) has none and runs from dist/ as it is.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const requireHere = createRequire(import.meta.url);

/** The file that marks a usable build: every tool imports the engine through it. */
export const distEntry = root => path.join(root, 'dist', 'engine', 'src', 'index.js');

/**
 * { mode: 'build', tsc } when TypeScript resolves (and --no-build is off), { mode: 'prebuilt', note } when it does not but dist/ is
 * there (note is null for --no-build, which asked for it), { mode: 'missing', message } when there is nothing to run.
 * `resolve` stands in for require.resolve in tests.
 */
export function buildPlan(root, { noBuild = false, resolve = id => requireHere.resolve(id) } = {}) {
  let tsc = null;
  if (!noBuild) {
    try { tsc = resolve('typescript/bin/tsc'); } catch { /* not installed: fall back to dist/ */ }
  }
  if (tsc) return { mode: 'build', tsc };
  if (fs.existsSync(distEntry(root))) {
    return { mode: 'prebuilt', note: noBuild ? null : 'TypeScript not found; using the prebuilt engine in dist/.' };
  }
  return {
    mode: 'missing',
    message: noBuild
      ? `No built engine in ${path.join(root, 'dist')} (--no-build). Build it with "npm run build", or drop --no-build.`
      : `TypeScript not found and no built engine in ${path.join(root, 'dist')}. Run "npm install" in ${root} to build it.`,
  };
}
