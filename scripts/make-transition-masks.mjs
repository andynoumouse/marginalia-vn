// Writes the sample image masks for `scene <bg> dissolve mask=<name>` (games/sample/assets/transitions/): grayscale 320x180
// pictures, stretched to the stage; dark pixels show the new picture first. PNG by hand (zlib only).
//   node scripts/make-transition-masks.mjs

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'games', 'sample', 'assets', 'transitions');
const W = 320, H = 180;
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body));
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  return Buffer.concat([len, body, crc]);
};
function png(f) {
  const raw = Buffer.alloc(H * (1 + W));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) raw[y * (1 + W) + 1 + x] = Math.round(255 * Math.min(1, Math.max(0, f(x / (W - 1), y / (H - 1)))));
  const head = Buffer.alloc(13); head.writeUInt32BE(W, 0); head.writeUInt32BE(H, 4); head[8] = 8; head[9] = 0; // 8-bit grayscale
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const hash = (x, y) => { let h = Math.imul(x * 374761393 + y * 668265263, 1274126177); h ^= h >>> 13; return (Math.imul(h, 1103515245) >>> 0) / 4294967296; };
const noise = (u, v, cells) => { // bilinear value noise
  const x = u * cells, y = v * cells, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const s = t => t * t * (3 - 2 * t), a = hash(x0, y0), b = hash(x0 + 1, y0), c = hash(x0, y0 + 1), d = hash(x0 + 1, y0 + 1);
  return (a + (b - a) * s(fx)) * (1 - s(fy)) + (c + (d - c) * s(fx)) * s(fy);
};

const masks = {
  wipe_clock: (u, v) => { const a = Math.atan2((v - 0.5) * H, (u - 0.5) * W); return ((a + Math.PI / 2 + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI); },
  radial: (u, v) => Math.hypot((u - 0.5) * W, (v - 0.5) * H) / Math.hypot(W / 2, H / 2),
  diagonal: (u, v) => (u + v) / 2,
  noise: (u, v) => (noise(u, v, 8) * 0.7 + noise(u, v, 20) * 0.3),
};

fs.mkdirSync(out, { recursive: true });
for (const [name, f] of Object.entries(masks)) {
  // Rescale so the darkest pixel is 0 and the brightest 1: the transition then fills the whole progress range.
  let lo = 1, hi = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const m = f(x / (W - 1), y / (H - 1)); lo = Math.min(lo, m); hi = Math.max(hi, m); }
  fs.writeFileSync(path.join(out, `${name}.png`), png((u, v) => (f(u, v) - lo) / (hi - lo)));
}
console.log(`wrote ${Object.keys(masks).length} masks to ${out}`);
