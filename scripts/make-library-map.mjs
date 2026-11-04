// Writes the demo's library map picture (games/demo/assets/bg/bg_library_map.png): a bookcase, a reading table, an archive
// door, a notice board and a card-catalogue cabinet sitting exactly under the hotspots of `screen library_map`
// (games/demo/script/rooms.vn). Flat shapes, 2x2 supersampled. PNG by hand (zlib only).
//   node scripts/make-library-map.mjs

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'games', 'demo', 'assets', 'bg');
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
const mix = (a, b, t) => a.map((c, i) => Math.round(c + (b[i] - c) * Math.min(1, Math.max(0, t))));
/** Inside a convex polygon given as [x, y] corners in order. */
const poly = pts => (px, py) => {
  let sign = 0;
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
    const s = Math.sign((bx - ax) * (py - ay) - (by - ay) * (px - ax));
    if (s && sign && s !== sign) return false;
    if (s) sign = s;
  }
  return true;
};

// Layers are drawn in order; a layer's colour may be a function of the pixel. Returns RGBA bytes.
function paint(W, H, layers, background) {
  const raw = Buffer.alloc(H * (1 + W * 4));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 4)] = 0;
    for (let x = 0; x < W; x++) {
      const sum = [0, 0, 0];
      for (const [sx, sy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
        let c = background(x + sx, y + sy);
        for (const [test, color] of layers) if (test(x + sx, y + sy)) c = typeof color === 'function' ? color(x + sx, y + sy) : color;
        sum[0] += c[0]; sum[1] += c[1]; sum[2] += c[2];
      }
      raw.set(sum.map(s => Math.round(s / 4)), y * (1 + W * 4) + 1 + x * 4);
      raw[y * (1 + W * 4) + 4 + x * 4] = 255;
    }
  }
  const head = Buffer.alloc(13); head.writeUInt32BE(W, 0); head.writeUInt32BE(H, 4); head.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const wood = [92, 58, 38], woodDark = [60, 38, 26], woodLight = [124, 84, 54], brass = [214, 172, 84], iron = [46, 46, 54];
const books = [[150, 62, 62], [62, 96, 132], [196, 164, 84], [84, 120, 92], [118, 76, 120], [200, 120, 70]];
const spine = (x, y, x0) => {
  const i = Math.floor((x - x0) / 14);
  const h = (i * 7919 + Math.floor(y / 150) * 104729) >>> 0;
  return (x - x0) % 14 < 2 ? [30, 22, 22] : books[h % books.length];
};
// the card catalogue: a skewed cabinet, 8 x 4 drawers found by walking its edges (top and bottom slope a little)
const cat = { l: y => 680 - (y - 220) * (20 / 280), r: y => 1180 + (y - 200) * (40 / 280), top: x => 220 - (x - 680) * 0.04, bot: x => 500 - (x - 660) * 0.036 };
const drawer = (x, y) => {
  const u = (x - cat.l(y)) / (cat.r(y) - cat.l(y)) * 8, v = (y - cat.top(x)) / (cat.bot(x) - cat.top(x)) * 4;
  const fu = u - Math.floor(u), fv = v - Math.floor(v);
  if (fu < 0.08 || fu > 0.92 || fv < 0.1 || fv > 0.9) return woodDark;
  if (Math.abs(fu - 0.5) < 0.1 && Math.abs(fv - 0.5) < 0.1) return brass;      // the knob
  if (Math.abs(fu - 0.5) < 0.28 && fv > 0.22 && fv < 0.38) return [226, 214, 184]; // the label card
  return woodLight;
};
const lamp = (cx, cy, r) => (x, y) => Math.max(0, 1 - Math.hypot(x - cx, y - cy) / r);

const map = paint(1920, 1080, [
  [rect(0, 820, 1920, 260), (x, y) => mix([58, 40, 32], [28, 19, 17], (y - 820) / 260)],                      // floor
  [rect(0, 800, 1920, 24), [38, 26, 22]],                                                                      // skirting
  // the bookcase (stacks), under hotspot 160,300 420x380
  [rect(160, 300, 420, 380), woodDark],
  ...[0, 1, 2].map(i => [rect(176, 316 + i * 120, 388, 104), (x, y) => spine(x, y, 176)]),
  ...[0, 1, 2].map(i => [rect(176, 420 + i * 120, 388, 16), wood]),
  [rect(160, 668, 420, 24), wood],
  // the reading table (front desk), under the ellipse hotspot 800,640 460x220
  [rect(1010, 800, 40, 170), woodDark],
  [ellipse(1030, 776, 150, 28), [38, 26, 22]],
  [ellipse(1030, 750, 236, 114), woodDark],
  [ellipse(1030, 744, 230, 108), woodLight],
  [ellipse(1030, 744, 190, 84), [112, 74, 48]],
  [rect(1020, 640, 8, 70), [40, 40, 44]],                                                                      // the lamp
  [either(rect(990, 612, 84, 14), rect(1002, 600, 60, 14)), [226, 190, 96]],
  [rect(1090, 730, 90, 40), [226, 214, 190]],                                                                  // papers
  [rect(900, 720, 70, 16), [150, 62, 62]],
  // the card catalogue, under the polygon 680,220 1180,200 1220,480 660,500
  [poly([[680, 220], [1180, 200], [1220, 480], [660, 500]]), drawer],
  // the archive: a tall arched door with iron bands and a lock, under hotspot 1300,280 420x360
  [either(rect(1300, 420, 420, 220), ellipse(1510, 420, 210, 140)), iron],
  [either(rect(1316, 424, 388, 216), ellipse(1510, 424, 194, 126)), (x, y) => mix([104, 68, 44], [76, 48, 34], (y - 300) / 340)],
  [rect(1316, 470, 388, 20), iron],
  [rect(1316, 570, 388, 20), iron],
  [circle(1510, 530, 26), brass],
  [rect(1504, 530, 12, 40), [30, 24, 20]],
  // the notice board, under hotspot 1380,740 360x200: cork on a frame, with notes pinned to it, and legs
  [rect(1410, 930, 22, 110), woodDark],
  [rect(1690, 930, 22, 110), woodDark],
  [rect(1380, 740, 360, 200), woodDark],
  [rect(1394, 754, 332, 172), [168, 124, 82]],
  [rect(1412, 772, 90, 62), [236, 230, 210]],
  [rect(1530, 768, 70, 90), [240, 214, 120]],
  [rect(1628, 780, 80, 56), [200, 224, 236]],
  [rect(1450, 860, 110, 50), [236, 200, 200]],
  [circle(1457, 776, 5), [190, 50, 50]],
  [circle(1565, 772, 5), [50, 110, 190]],
  [circle(1668, 784, 5), [190, 50, 50]],
], (x, y) => {
  // wall: warm, darker towards the floor, with two soft ceiling lights
  const base = mix([96, 72, 70], [58, 42, 46], y / 820);
  return mix(base, [255, 214, 140], Math.max(lamp(500, 60, 520)(x, y), lamp(1420, 40, 520)(x, y)) * 0.28);
});

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'bg_library_map.png'), map);
console.log(`Wrote the library map to ${path.relative(process.cwd(), out)}`);
