// Writes the placeholder art the project templates ship (templates/assets/): flat vertical gradients, so a new project
// has a title background until the author paints one. PNG written by hand (zlib only), no dependencies.
//   node scripts/make-placeholders.mjs

import fs from 'node:fs';
import path from 'node:path';
import { encodePng, RGB } from './png.mjs';
import { fileURLToPath } from 'node:url';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'assets', 'bg');
function png(width, height, top, bottom) {
  const row = y => {
    const t = y / (height - 1);
    const px = top.map((c, i) => Math.round(c + (bottom[i] - c) * t));
    return Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => px).flat())]);
  };
  const raw = Buffer.concat(Array.from({ length: height }, (_, y) => row(y)));
  return encodePng(width, height, raw, RGB);
}

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'bg_title.png'), png(1920, 1080, [34, 52, 64], [12, 18, 24]));
fs.writeFileSync(path.join(out, 'bg_title_portrait.png'), png(1080, 1920, [34, 52, 64], [12, 18, 24]));
console.log(`Wrote the placeholders to ${path.relative(process.cwd(), out)}`);
