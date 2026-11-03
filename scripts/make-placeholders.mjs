// Writes the placeholder art the project templates ship (templates/assets/): flat vertical gradients, so a new project
// has a title background until the author paints one. PNG written by hand (zlib only), no dependencies.
//   node scripts/make-placeholders.mjs

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'assets', 'bg');
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body));
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  return Buffer.concat([len, body, crc]);
};
function png(width, height, top, bottom) {
  const row = y => {
    const t = y / (height - 1);
    const px = top.map((c, i) => Math.round(c + (bottom[i] - c) * t));
    return Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => px).flat())]);
  };
  const raw = Buffer.concat(Array.from({ length: height }, (_, y) => row(y)));
  const head = Buffer.alloc(13); head.writeUInt32BE(width, 0); head.writeUInt32BE(height, 4); head.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'bg_title.png'), png(1920, 1080, [34, 52, 64], [12, 18, 24]));
fs.writeFileSync(path.join(out, 'bg_title_portrait.png'), png(1080, 1920, [34, 52, 64], [12, 18, 24]));
console.log(`Wrote the placeholders to ${path.relative(process.cwd(), out)}`);
