// Copies the shared asset pool's files into a new project (templates/assets/ in the engine folder; the list comes from
// templateAssets in engine/src/templates.ts). Used by `vn init` and Marginalia Studio's New project.

import fs from 'node:fs';
import path from 'node:path';
import { engineRoot } from './paths.mjs';

export const poolRoot = path.join(engineRoot, 'templates', 'assets');

/** Copy each { from, to } into the project folder; a file the pool lacks is an error. */
export function copyTemplateAssets(assets, folder) {
  for (const { from, to } of assets) {
    const source = path.join(poolRoot, from);
    if (!fs.existsSync(source)) throw new Error(`the template asset ${from} is missing from ${poolRoot}`);
    const target = path.join(folder, to);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
}
