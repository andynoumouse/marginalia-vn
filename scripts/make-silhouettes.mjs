// Writes the silhouette sprites the project templates show (templates/assets/char/): a head and shoulders in one flat
// colour per character, 540 x 1080 with a transparent background, antialiased. PNG written by hand (zlib only).
//   node scripts/make-silhouettes.mjs

import fs from 'node:fs';
import path from 'node:path';
import { encodePng, RGBA } from './png.mjs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'assets', 'char');
const W = 540, H = 1080;

// Signed distance (negative inside) to the shape: a head circle over a rounded torso that runs off the bottom edge.
function dist(x, y) {
  const head = Math.hypot(x - W / 2, y - 330) - 120;
  const neck = Math.max(Math.abs(x - W / 2) - 50, Math.abs(y - 500) - 80);
  // Rounded box, 400 wide, from y=560 down past the bottom edge.
  const r = 90, cy = (560 + H + 200) / 2;
  const qx = Math.abs(x - W / 2) - (200 - r), qy = Math.abs(y - cy) - ((H + 200 - 560) / 2 - r);
  const torso = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  return Math.min(head, neck, torso);
}

function png(color) {
  const rows = [];
  for (let y = 0; y < H; y++) {
    const row = Buffer.alloc(1 + W * 4);
    for (let x = 0; x < W; x++) {
      const a = Math.max(0, Math.min(1, 0.5 - dist(x + 0.5, y + 0.5)));
      row.set([...color, Math.round(a * 255)], 1 + x * 4);
    }
    rows.push(row);
  }
  return encodePng(W, H, rows, RGBA);
}

// The colours match the template scripts' `define ... color=`.
for (const [name, color] of Object.entries({ mina: [255, 158, 196], ren: [124, 196, 255] })) {
  fs.mkdirSync(path.join(root, name), { recursive: true });
  fs.writeFileSync(path.join(root, name, 'neutral.png'), png(color));
}
console.log(`Wrote the silhouettes to ${path.relative(process.cwd(), root)}`);
