// Writes the placeholder art of the Mystery template (templates/assets/ui/): a study with a desk, a window and a
// door where the template's hotspots are, and an icon for each item. Flat shapes, 2x2 supersampled. PNG by hand (zlib only).
//   node scripts/make-room.mjs

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'assets', 'ui');
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body));
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  return Buffer.concat([len, body, crc]);
};
const rect = (x, y, w, h) => (px, py) => px >= x && px < x + w && py >= y && py < y + h;
const ellipse = (cx, cy, rx, ry) => (px, py) => ((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2 <= 1;
const circle = (cx, cy, r) => ellipse(cx, cy, r, r);
const either = (...tests) => (px, py) => tests.some(t => t(px, py));
const mix = (a, b, t) => a.map((c, i) => Math.round(c + (b[i] - c) * t));

// Layers are drawn in order; a layer's colour may be a function of the pixel. Returns RGBA bytes.
function paint(W, H, layers, background) {
  const raw = Buffer.alloc(H * (1 + W * 4));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 4)] = 0;
    for (let x = 0; x < W; x++) {
      const sum = [0, 0, 0, 0];
      for (const [sx, sy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
        let c = background ? background(x + sx, y + sy) : null;
        for (const [test, color] of layers) if (test(x + sx, y + sy)) c = typeof color === 'function' ? color(x + sx, y + sy) : color;
        if (c) { sum[0] += c[0]; sum[1] += c[1]; sum[2] += c[2]; sum[3] += 1; }
      }
      const n = sum[3] || 1;
      raw.set([sum[0] / n, sum[1] / n, sum[2] / n, (sum[3] / 4) * 255].map(Math.round), y * (1 + W * 4) + 1 + x * 4);
    }
  }
  const head = Buffer.alloc(13); head.writeUInt32BE(W, 0); head.writeUInt32BE(H, 4); head.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// The study. The desk, the window and the door sit exactly under the template's hotspots (script/start.vn).
const wood = [92, 58, 38], woodDark = [60, 38, 26], brass = [214, 172, 84];
const room = paint(1920, 1080, [
  [rect(0, 780, 1920, 300), (x, y) => mix([58, 40, 32], [30, 20, 18], (y - 780) / 300)],                // floor
  [rect(0, 760, 1920, 24), [38, 26, 22]],                                                                  // skirting
  // the window: a night sky behind a frame with a cross
  [ellipse(1230, 390, 196, 226), [74, 52, 40]],
  [ellipse(1230, 390, 180, 210), (x, y) => mix([30, 52, 98], [96, 132, 178], (y - 180) / 420)],
  [circle(1170, 300, 26), [236, 242, 255]],
  [rect(1224, 180, 12, 420), [74, 52, 40]],
  [rect(1050, 384, 360, 12), [74, 52, 40]],
  [rect(1030, 600, 400, 26), [104, 72, 52]],                                                               // the sill
  // the door: frame, two panels, a brass knob
  [rect(1466, 366, 348, 604), woodDark],
  [rect(1480, 380, 320, 580), wood],
  [rect(1510, 420, 260, 200), [78, 48, 32]],
  [rect(1510, 660, 260, 250), [78, 48, 32]],
  [circle(1760, 690, 16), brass],
  [rect(1750, 724, 20, 26), [30, 24, 20]],                                                                 // the keyhole
  // the desk: top, body, drawers, legs, a lamp
  [rect(280, 516, 500, 44), [112, 74, 48]],
  [rect(310, 560, 440, 220), wood],
  [rect(330, 580, 190, 80), [78, 48, 32]],
  [rect(330, 680, 190, 80), [78, 48, 32]],
  [circle(425, 620, 9), brass],
  [circle(425, 720, 9), brass],
  [rect(560, 580, 160, 200), [70, 44, 30]],
  [rect(620, 470, 8, 48), [40, 40, 44]],
  [either(rect(572, 430, 84, 14), rect(584, 418, 60, 14)), [226, 190, 96]],
  [rect(500, 500, 90, 16), [226, 214, 190]],                                                               // papers
], (x, y) => mix([70, 54, 62], [44, 32, 40], y / 780));

// Item icons: 128 x 128, transparent.
const key = paint(128, 128, [
  [either(circle(40, 40, 26), rect(56, 36, 62, 12)), brass],
  [circle(40, 40, 12), null],
  [rect(88, 48, 12, 24), brass],
  [rect(106, 48, 12, 32), brass],
]);
const letter = paint(128, 128, [
  [rect(14, 30, 100, 70), [232, 222, 196]],
  [(x, y) => y >= 30 && y <= 30 + 40 && Math.abs(x - 64) <= (40 - (y - 30)) * 1.2 + 0, [200, 186, 156]],
  [rect(14, 96, 100, 4), [196, 182, 150]],
  [circle(64, 70, 9), [168, 48, 48]],
]);

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'room.png'), room);
fs.writeFileSync(path.join(out, 'key.png'), key);
fs.writeFileSync(path.join(out, 'letter.png'), letter);
console.log(`Wrote the Mystery art to ${path.relative(process.cwd(), out)}`);
