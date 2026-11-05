// Writes games/sample/masters/char/robo.psd: a small robot drawn from flat shapes, laid out as a puppet for the bone
// rig (+folders for the head, both arms and their forearms; eyes and mouth are slots). It is the sample's example of a
// PSD with several bones; the matching assets/char/robo/rig.json holds the bones, pivots and animations.
//   node scripts/make-sample-puppet.mjs && npm run art
// Pixels are written straight into ag-psd layers, so no canvas is needed.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writePsd } from 'ag-psd';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const W = 540, H = 1080;

// Signed distances (negative inside) for the shapes, and `layer` to rasterize one over its own bounding box.
const circle = (cx, cy, r) => (x, y) => Math.hypot(x - cx, y - cy) - r;
const ellipse = (cx, cy, rx, ry) => (x, y) => (Math.hypot((x - cx) / rx, (y - cy) / ry) - 1) * Math.min(rx, ry);
const capsule = (ax, ay, bx, by, r) => (x, y) => {
  const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x - ax - t * dx, y - ay - t * dy) - r;
};
const box = (x0, y0, x1, y1, r = 0) => (x, y) => {
  const qx = Math.abs(x - (x0 + x1) / 2) - ((x1 - x0) / 2 - r), qy = Math.abs(y - (y0 + y1) / 2) - ((y1 - y0) / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
/** An arc as a chain of capsules (a smile, a happy eye). */
const arc = (cx, cy, rx, ry, a0, a1, w) => {
  const pts = Array.from({ length: 13 }, (_, i) => { const a = (a0 + (a1 - a0) * i / 12) * Math.PI / 180; return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)]; });
  const parts = pts.slice(1).map((p, i) => capsule(pts[i][0], pts[i][1], p[0], p[1], w / 2));
  return (x, y) => Math.min(...parts.map(f => f(x, y)));
};
const union = (...fs) => (x, y) => Math.min(...fs.map(f => f(x, y)));

/** A layer from `shapes` ([distance function, [r, g, b]] bottom to top), cropped to the area [l, t, r, b]. */
function layer(name, [l, t, r, b], shapes) {
  const w = r - l, h = b - t, data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let px = [0, 0, 0, 0];
    for (const [d, c] of shapes) {
      const a = Math.max(0, Math.min(1, 0.5 - d(l + x + 0.5, t + y + 0.5)));
      if (a <= 0) continue;
      const out = px[3] / 255, na = a + out * (1 - a);
      px = [...[0, 1, 2].map(i => (c[i] * a + px[i] * out * (1 - a)) / na), na * 255];
    }
    data.set(px.map(Math.round), (y * w + x) * 4);
  }
  return { name, left: l, top: t, right: r, bottom: b, imageData: { width: w, height: h, data } };
}
const group = (name, children, hidden = false) => ({ name, children, opened: true, ...(hidden ? { hidden } : {}) });

const METAL = [150, 170, 190], DARK = [60, 74, 92], BLUE = [64, 132, 214], LIGHT = [210, 226, 240], EYE = [255, 226, 110], INK = [28, 34, 44], RED = [236, 84, 84];

// The arms hang from the shoulders at (200, 480) and (340, 480): upper arm, then a +forearm folder with forearm and hand.
const arm = (side, sx, sign) => {
  const elbow = [sx + sign * 40, 590], wrist = [sx + sign * 55, 690];
  return group(`+arm_${side}`, [
    group(`+forearm_${side}`, [
      layer(`hand_${side}`, [wrist[0] - 32, wrist[1] - 10, wrist[0] + 32, wrist[1] + 54], [[circle(wrist[0], wrist[1] + 20, 24), DARK]]),
      layer(`lower_${side}`, [elbow[0] - 30, elbow[1] - 30, wrist[0] + 30, wrist[1] + 20], [[capsule(...elbow, ...wrist, 19), METAL], [circle(...elbow, 17), DARK]]),
    ]),
    layer(`upper_${side}`, [Math.min(sx, elbow[0]) - 30, 450, Math.max(sx, elbow[0]) + 30, 620], [[capsule(sx, 480, ...elbow, 22), METAL], [circle(sx, 480, 25), DARK]]),
  ]);
};

const eyes = group('eyes', [
  layer('closed', [200, 300, 340, 340], [[capsule(222, 322, 258, 322, 4), INK], [capsule(282, 322, 318, 322, 4), INK]]),
  layer('happy', [200, 290, 340, 340], [[arc(240, 328, 17, 16, 200, 340, 8), INK], [arc(300, 328, 17, 16, 200, 340, 8), INK]]),
  layer('open', [200, 290, 340, 350], [[circle(240, 320, 22), LIGHT], [circle(300, 320, 22), LIGHT], [circle(244, 322, 11), INK], [circle(304, 322, 11), INK]]),
]);
const mouth = group('mouth', [
  layer('flat', [230, 372, 310, 392], [[capsule(244, 382, 296, 382, 4), INK]]),
  layer('open', [235, 365, 305, 405], [[ellipse(270, 384, 26, 16), INK], [ellipse(270, 392, 14, 7), RED]]),
  layer('smile', [225, 360, 315, 405], [[arc(270, 372, 36, 22, 25, 155, 8), INK]]),
]);

const psd = {
  width: W, height: H,
  children: [ // bottom to top
    layer('legs', [205, 720, 335, 1060], [[box(214, 720, 262, 1030, 10), DARK], [box(278, 720, 326, 1030, 10), DARK], [box(205, 1020, 266, 1058, 16), METAL], [box(274, 1020, 335, 1058, 16), METAL]]),
    layer('torso', [185, 430, 355, 750], [[box(190, 440, 350, 740, 44), BLUE], [box(222, 500, 318, 600, 14), LIGHT], [circle(270, 650, 14), EYE]]),
    layer('collar', [250, 405, 290, 455], [[box(255, 410, 285, 450, 6), DARK]]),
    arm('r', 200, -1),
    arm('l', 340, 1),
    group('+head', [
      layer('antenna', [255, 170, 305, 270], [[capsule(272, 260, 286, 195, 5), DARK], [circle(287, 186, 14), RED]]),
      mouth,
      eyes,
      layer('face', [190, 245, 350, 425], [[box(195, 250, 345, 420, 44), METAL], [box(210, 272, 330, 350, 26), DARK], [circle(196, 335, 12), DARK], [circle(344, 335, 12), DARK]]),
    ]),
  ],
};

const out = path.join(root, 'games', 'sample', 'masters', 'char', 'robo.psd');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.from(writePsd(psd, { generateThumbnail: false, noBackground: true })));
console.log(`Wrote ${path.relative(process.cwd(), out)}`);
