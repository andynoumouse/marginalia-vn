// Writes the three placeholder CGs the Branching template unlocks in its gallery (templates/assets/bg/): a dusk
// landscape each, with a glowing sun or moon, stars and layered hills in the ending's colour. PNG written by hand (zlib only).
//   node scripts/make-cgs.mjs

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'assets', 'bg');
const W = 1920, H = 1080;
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body));
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  return Buffer.concat([len, body, crc]);
};
const mix = (a, b, t) => a.map((c, i) => c + (b[i] - c) * Math.max(0, Math.min(1, t)));
// A cheap deterministic hash for the stars.
const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) >>> 0; h = ((h ^ (h >>> 13)) * 1274126177) >>> 0; return (h ^ (h >>> 16)) / 4294967296; };

function scene({ top, horizon, sun, glow, hills, sunAt }) {
  const ridge = (x, i) => H * (0.58 + i * 0.1) + Math.sin(x / (260 - i * 50) + i * 2) * (46 - i * 6) + Math.sin(x / (95 + i * 20) + i) * (14 + i * 2);
  const rows = [];
  for (let y = 0; y < H; y++) {
    const row = Buffer.alloc(1 + W * 3);
    for (let x = 0; x < W; x++) {
      let c = mix(top, horizon, Math.pow(y / (H * 0.7), 1.3));
      const d = Math.hypot(x - sunAt[0], y - sunAt[1]);
      c = mix(c, glow, (1 - d / 520) * 0.55);
      if (d < 70) c = mix(c, sun, (70 - d) / 2);
      if (y < H * 0.4 && hash(x, y) > 0.9993) c = mix(c, [255, 255, 255], 0.9 * (1 - y / (H * 0.4)));
      for (let i = 0; i < hills.length; i++) {
        if (y > ridge(x, i)) c = mix(hills[i], horizon, 0.0 + (y - ridge(x, i)) / -4000);
      }
      row.set(c.map(Math.round), 1 + x * 3);
    }
    rows.push(row);
  }
  const head = Buffer.alloc(13); head.writeUInt32BE(W, 0); head.writeUInt32BE(H, 4); head.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows), { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const cgs = {
  cg_mina_end: { top: [52, 28, 84], horizon: [255, 150, 160], sun: [255, 236, 214], glow: [255, 170, 190], sunAt: [1290, 560], hills: [[110, 54, 98], [76, 36, 78], [46, 22, 58]] },
  cg_ren_end: { top: [10, 22, 58], horizon: [90, 150, 210], sun: [232, 244, 255], glow: [140, 190, 255], sunAt: [560, 400], hills: [[34, 62, 110], [22, 42, 84], [12, 26, 56]] },
  cg_friends_end: { top: [60, 52, 96], horizon: [255, 196, 110], sun: [255, 244, 200], glow: [255, 204, 120], sunAt: [960, 600], hills: [[118, 82, 96], [80, 56, 78], [48, 34, 54]] },
};
fs.mkdirSync(out, { recursive: true });
for (const [name, def] of Object.entries(cgs)) fs.writeFileSync(path.join(out, `${name}.png`), scene(def));
console.log(`Wrote the CGs to ${path.relative(process.cwd(), out)}`);
