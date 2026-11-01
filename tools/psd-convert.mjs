// Art pipeline: layered PSD masters -> game-ready PNGs + sprite manifests in assets/.
//   node tools/psd-convert.mjs [--force] [--watch]          (npm run art)
//
//   masters/bg/<name>.psd    -> assets/bg/<name>.png             flattened, scaled to cover the stage (game.json "stage", 1920x1080 by default)
//   masters/char/<char>.psd  -> assets/char/<char>/sprite.json   + one trimmed PNG per part
//   masters/ui/<name>.psd    -> assets/ui/<name>.png             flattened at 1:1 (text box / button frames)
//
// Character PSDs: the canvas height is the stage height (scaled to it, 1080 by default), feet near the bottom.
//   top-level layer          always drawn (body, outfit...)
//   top-level group = slot   e.g. "eyes"; each child (layer or group) is one variant, flattened to one PNG
//   "open, neutral"          variant "open" that pose "neutral" also uses
//   visible child            the slot's default (none visible = slot empty unless a pose picks it)
//   hidden layers, and names starting with _, are skipped (the visibility of slot children only sets the default)
//   "+folder"                a top-level group starting with game.json's "psdPrefix" (default "+") is not a slot: its
//                            layers are drawn like top-level layers (see psd-plan.mjs)
// `show alice smile` takes, per slot, the variant named or aliased "smile", else the default;
// `show alice smile eyes=closed` overrides one slot. Blend modes apply inside a part; parts stack with
// normal blending. Layer effects (shadows, strokes) are not rendered: rasterize them in Photoshop.
// Only PSDs newer than their output are converted, unless --force.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { projectRoot } from './paths.mjs';
import { fileSafe, planCharacter, prefixFrom } from './psd-plan.mjs';

const root = projectRoot(); // masters/ and assets/ belong to the game project (tools/paths.mjs)
const mastersDir = path.join(root, 'masters');
const assetDir = path.join(root, 'assets');
const { stageSize } = await import(new URL('../dist/engine/src/index.js', import.meta.url).href);
const readGame = () => {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'game.json'), 'utf8')); } catch { return {}; }
};
const { width: STAGE_W, height: STAGE_H } = stageSize(readGame()), CHAR_H = STAGE_H;

const lib = await import('ag-psd').catch(() => { console.error('ag-psd not found. Run "npm install" first.'); process.exit(1); });
const { readPsd, initializeCanvas } = lib.readPsd ? lib : lib.default;
// We only read pixel arrays (useImageData), so no canvas package is needed: hand ag-psd plain buffers.
initializeCanvas(
  () => { throw new Error('canvas is not available'); },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
);

// ---- images: premultiplied float RGBA in a box {x, y, w, h} (document coordinates) ----
const newImage = (x, y, w, h) => ({ x, y, w: Math.max(0, w), h: Math.max(0, h), d: new Float32Array(Math.max(0, w) * Math.max(0, h) * 4) });
const unit = data => data instanceof Uint16Array ? 1 / 65535 : data instanceof Float32Array ? 1 : 1 / 255;

function fromPixels(px, x, y) {
  const out = newImage(x, y, px.width, px.height), k = unit(px.data), s = px.data, d = out.d;
  for (let i = 0; i < d.length; i += 4) {
    const a = s[i + 3] * k;
    d[i] = s[i] * k * a; d[i + 1] = s[i + 1] * k * a; d[i + 2] = s[i + 2] * k * a; d[i + 3] = a;
  }
  return out;
}

function applyMask(im, mask) {
  if (!mask || mask.disabled || !mask.imageData) return;
  const m = mask.imageData, k = unit(m.data), def = (mask.defaultColor ?? 0) / 255;
  const ml = mask.left ?? 0, mt = mask.top ?? 0;
  for (let y = 0; y < im.h; y++) {
    const my = im.y + y - mt;
    for (let x = 0; x < im.w; x++) {
      const mx = im.x + x - ml;
      const v = mx >= 0 && my >= 0 && mx < m.width && my < m.height ? m.data[(my * m.width + mx) * 4] * k : def;
      const i = (y * im.w + x) * 4;
      im.d[i] *= v; im.d[i + 1] *= v; im.d[i + 2] *= v; im.d[i + 3] *= v;
    }
  }
}

// Separable blend functions on straight (non-premultiplied) color, src over backdrop.
const BLEND = {
  normal: (s) => s,
  multiply: (s, b) => s * b,
  screen: (s, b) => s + b - s * b,
  overlay: (s, b) => (b <= 0.5 ? 2 * s * b : 1 - 2 * (1 - s) * (1 - b)),
  'hard light': (s, b) => (s <= 0.5 ? 2 * s * b : 1 - 2 * (1 - s) * (1 - b)),
  'soft light': (s, b) => (s <= 0.5 ? b - (1 - 2 * s) * b * (1 - b) : b + (2 * s - 1) * ((b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b)) - b)),
  darken: Math.min,
  lighten: Math.max,
  'linear dodge': (s, b) => Math.min(1, s + b),
  'color dodge': (s, b) => (b === 0 ? 0 : s >= 1 ? 1 : Math.min(1, b / (1 - s))),
  'color burn': (s, b) => (b >= 1 ? 1 : s <= 0 ? 0 : 1 - Math.min(1, (1 - b) / s)),
  difference: (s, b) => Math.abs(s - b),
  exclusion: (s, b) => s + b - 2 * s * b,
};

/** Composite `src` onto `dst` (dst's box). `alpha` scales src; `clip` (same box as dst) limits src to its alpha. */
function composite(dst, src, alpha, mode, clip) {
  const fn = BLEND[mode] ?? BLEND.normal;
  const x0 = Math.max(dst.x, src.x), y0 = Math.max(dst.y, src.y);
  const x1 = Math.min(dst.x + dst.w, src.x + src.w), y1 = Math.min(dst.y + dst.h, src.y + src.h);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const si = ((y - src.y) * src.w + (x - src.x)) * 4, di = ((y - dst.y) * dst.w + (x - dst.x)) * 4;
      let k = alpha;
      if (clip) k *= clip.d[di + 3];
      const sa = src.d[si + 3] * k;
      if (sa <= 0) continue;
      const da = dst.d[di + 3];
      for (let c = 0; c < 3; c++) {
        const sc = src.d[si + c] * k, dc = dst.d[di + c];
        const mix = da > 0 ? fn(sc / sa, dc / da) : sc / sa;
        dst.d[di + c] = sc * (1 - da) + dc * (1 - sa) + sa * da * mix;
      }
      dst.d[di + 3] = sa + da - sa * da;
    }
  }
}

// ---- layer tree ----
const skipped = l => l.name?.startsWith('_');
const isGroup = l => Array.isArray(l.children);

function bounds(layers, onlyVisible = true) {
  let b = null;
  for (const l of layers) {
    if (skipped(l) || (onlyVisible && l.hidden)) continue;
    const lb = isGroup(l) ? bounds(l.children) : (l.right > l.left && l.bottom > l.top ? { l: l.left, t: l.top, r: l.right, b: l.bottom } : null);
    if (!lb) continue;
    b = b ? { l: Math.min(b.l, lb.l), t: Math.min(b.t, lb.t), r: Math.max(b.r, lb.r), b: Math.max(b.b, lb.b) } : lb;
  }
  return b;
}

/** Flatten layers (bottom to top) into one image; null when nothing is visible. */
function flatten(layers, warn, b = bounds(layers)) {
  if (!b) return null;
  const out = newImage(b.l, b.t, b.r - b.l, b.b - b.t);
  let base = null; // the layer clipping masks attach to
  for (const l of layers) {
    if (skipped(l) || l.hidden) continue;
    if (l.adjustment) { warn(`adjustment layer "${l.name}" is ignored`); continue; }
    if (l.effects && !l.effects.disabled) warn(`layer effects on "${l.name}" are not rendered; rasterize them`);
    let src = isGroup(l) ? flatten(l.children, warn) : l.imageData ? fromPixels(l.imageData, l.left ?? 0, l.top ?? 0) : null;
    if (!src) { if (!l.clipping) base = null; continue; }
    applyMask(src, l.mask);
    const mode = l.blendMode === 'pass through' ? 'normal' : l.blendMode ?? 'normal';
    if (!BLEND[mode]) warn(`blend mode "${mode}" on "${l.name}" is drawn as normal`);
    const alpha = (l.opacity ?? 1) * (l.fillOpacity ?? 1);
    if (l.clipping && base) {
      const clip = newImage(out.x, out.y, out.w, out.h);
      composite(clip, base, 1, 'normal');
      composite(out, src, alpha, mode, clip);
    } else {
      composite(out, src, alpha, mode);
      if (!l.clipping) { base = newImage(src.x, src.y, src.w, src.h); composite(base, src, alpha, 'normal'); }
    }
  }
  return out;
}

// ---- resampling: area (box) filter with a fractional offset, so parts stay aligned after scaling ----
function axisWeights(srcLen, offset, s) {
  const d0 = Math.floor(offset), d1 = Math.ceil(offset + srcLen * s);
  const taps = [];
  for (let d = d0; d < d1; d++) {
    const a = Math.max(0, (d - offset) / s), b = Math.min(srcLen, (d + 1 - offset) / s);
    const list = [];
    for (let i = Math.floor(a); i < b; i++) {
      const w = (Math.min(b, i + 1) - Math.max(a, i)) * s;
      if (w > 0) list.push(i, w);
    }
    taps.push(list);
  }
  return { start: d0, taps };
}

function resample(im, s) {
  if (s === 1) return im;
  const H = axisWeights(im.w, im.x * s, s), V = axisWeights(im.h, im.y * s, s);
  const w = H.taps.length, h = V.taps.length;
  const tmp = new Float32Array(w * im.h * 4);
  for (let y = 0; y < im.h; y++) {
    for (let x = 0; x < w; x++) {
      const t = H.taps[x], o = (y * w + x) * 4;
      for (let j = 0; j < t.length; j += 2) {
        const i = (y * im.w + t[j]) * 4, wt = t[j + 1];
        tmp[o] += im.d[i] * wt; tmp[o + 1] += im.d[i + 1] * wt; tmp[o + 2] += im.d[i + 2] * wt; tmp[o + 3] += im.d[i + 3] * wt;
      }
    }
  }
  const out = newImage(H.start, V.start, w, h);
  for (let y = 0; y < h; y++) {
    const t = V.taps[y];
    for (let j = 0; j < t.length; j += 2) {
      const row = t[j] * w * 4, wt = t[j + 1], o = y * w * 4;
      for (let x = 0; x < w * 4; x++) out.d[o + x] += tmp[row + x] * wt;
    }
  }
  return out;
}

function crop(im, l, t, r, b) {
  const x0 = Math.max(l, im.x), y0 = Math.max(t, im.y), x1 = Math.min(r, im.x + im.w), y1 = Math.min(b, im.y + im.h);
  const out = newImage(x0, y0, x1 - x0, y1 - y0);
  for (let y = 0; y < out.h; y++) {
    const from = ((y0 - im.y + y) * im.w + (x0 - im.x)) * 4;
    out.d.set(im.d.subarray(from, from + out.w * 4), y * out.w * 4);
  }
  return out;
}

/** Crop to the pixels that are not fully transparent (after 8-bit rounding); null when empty. */
function trim(im) {
  let l = im.w, t = im.h, r = -1, b = -1;
  for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) {
    if (im.d[(y * im.w + x) * 4 + 3] < 0.5 / 255) continue;
    if (x < l) l = x; if (x > r) r = x; if (y < t) t = y; if (y > b) b = y;
  }
  return r < 0 ? null : crop(im, im.x + l, im.y + t, im.x + r + 1, im.y + b + 1);
}

// ---- PNG (RGBA8, adaptive filters) ----
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(buf) { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function encodePng(im) {
  const { w, h, d } = im, stride = w * 4;
  const px = new Uint8Array(stride * h);
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a <= 0) continue;
    px[i] = Math.round(Math.min(1, d[i] / a) * 255); px[i + 1] = Math.round(Math.min(1, d[i + 1] / a) * 255);
    px[i + 2] = Math.round(Math.min(1, d[i + 2] / a) * 255); px[i + 3] = Math.round(Math.min(1, a) * 255);
  }
  const raw = Buffer.alloc((stride + 1) * h), cand = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const row = px.subarray(y * stride, (y + 1) * stride), up = y ? px.subarray((y - 1) * stride, y * stride) : new Uint8Array(stride);
    let best = Infinity;
    for (let f = 0; f < 5; f++) {
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= 4 ? row[i - 4] : 0, b = up[i], c = i >= 4 ? up[i - 4] : 0;
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        const v = (row[i] - pred) & 255;
        cand[i] = v;
        sum += v < 128 ? v : 256 - v;
      }
      if (sum < best) { best = sum; raw[y * (stride + 1)] = f; cand.copy(raw, y * (stride + 1) + 1); }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- converters ----
function load(file) {
  const psd = readPsd(fs.readFileSync(file), { useImageData: true, skipThumbnail: true, skipLinkedFilesData: true });
  if (psd.colorMode !== undefined && psd.colorMode !== 3) console.warn(`  ${path.basename(file)}: not an RGB document; colors may be off`);
  return psd;
}

/** True when every pixel is the same color (a blank composite). */
function isFlat(px) {
  const d = px.data;
  for (let i = 4; i < d.length; i++) if (d[i] !== d[i & 3]) return false;
  return true;
}

/** The whole document as one image (document-sized box). */
function documentImage(psd, warn) {
  // Photoshop's own composite is exact (all blend modes, effects), but without "Maximize compatibility"
  // it is saved blank: then flatten the layers ourselves.
  const useComposite = psd.imageData && !(psd.children?.length && isFlat(psd.imageData));
  const im = useComposite ? fromPixels(psd.imageData, 0, 0) : flatten(psd.children ?? [], warn, { l: 0, t: 0, r: psd.width, b: psd.height });
  if (!im) throw new Error('nothing visible');
  if (!useComposite) warn('no usable composite image (save with "Maximize compatibility" for an exact match); flattened the layers');
  return im;
}

function convertUi(file, outFile, warn) {
  const im = documentImage(load(file), warn);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, encodePng(im));
  return `${im.w}x${im.h}`;
}

function convertBackground(file, outFile, warn) {
  const psd = load(file);
  let im = documentImage(psd, warn);
  if (Math.abs(psd.width / psd.height - STAGE_W / STAGE_H) > 0.01) warn(`${psd.width}x${psd.height} does not match the ${STAGE_W}x${STAGE_H} stage; edges are cropped`);
  const s = Math.max(STAGE_W / psd.width, STAGE_H / psd.height);
  const ox = (STAGE_W - psd.width * s) / 2, oy = (STAGE_H - psd.height * s) / 2;
  im = resample({ ...im, x: 0, y: 0 }, s);
  im = crop({ ...im, x: im.x + Math.round(ox), y: im.y + Math.round(oy) }, 0, 0, STAGE_W, STAGE_H);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, encodePng(im));
  return `${im.w}x${im.h}`;
}

function convertCharacter(file, outDir, warn) {
  const psd = load(file);
  const s = CHAR_H / psd.height;
  if (s > 1) warn(`canvas is only ${psd.height}px tall; parts are upscaled to ${CHAR_H}`);
  const written = [];
  const writePart = (im, rel) => {
    if (!im) return null;
    const scaled = trim(crop(resample(im, s), 0, 0, Math.round(psd.width * s), CHAR_H));
    if (!scaled) return null;
    fs.mkdirSync(path.dirname(path.join(outDir, rel)), { recursive: true });
    fs.writeFileSync(path.join(outDir, rel), encodePng(scaled));
    written.push(rel);
    return { file: rel, x: scaled.x, y: scaled.y };
  };

  // Clear what the previous conversion wrote (and only that).
  const manifestFile = path.join(outDir, 'sprite.json');
  if (fs.existsSync(manifestFile)) {
    try { for (const f of JSON.parse(fs.readFileSync(manifestFile, 'utf8')).files ?? []) fs.rmSync(path.join(outDir, f), { force: true }); }
    catch { /* unreadable manifest: overwrite */ }
  }

  const parts = [];
  for (const entry of planCharacter(psd.children ?? [], { prefix: prefixFrom(readGame()), warn })) {
    if (entry.type === 'part') {
      const p = writePart(flatten(entry.layers, warn), `${fileSafe(entry.name)}.png`);
      if (p) parts.push(p);
      continue;
    }
    const variants = {};
    for (const { name, aliases, layer: v } of entry.variants) {
      const im = isGroup(v) ? flatten(v.children, warn) : flatten([{ ...v, hidden: false }], warn);
      const p = writePart(im, `${fileSafe(entry.slot)}/${fileSafe(name)}.png`);
      variants[name] = { ...(p ?? {}), ...(aliases.length ? { poses: aliases } : {}) };
    }
    parts.push({ slot: entry.slot, default: entry.default, variants });
  }
  const manifest = { generator: 'psd-convert', width: Math.round(psd.width * s), height: CHAR_H, parts, files: written };
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  const slots = parts.filter(p => p.slot).map(p => `${p.slot}(${Object.keys(p.variants).length})`);
  return `${manifest.width}x${manifest.height}, ${written.length} images${slots.length ? `, slots: ${slots.join(' ')}` : ''}`;
}

// ---- driver ----
const listPsds = dir => fs.existsSync(dir)
  ? fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile() && /\.psd$/i.test(e.name)).map(e => path.join(dir, e.name)).sort()
  : [];
const mtime = f => (fs.existsSync(f) ? fs.statSync(f).mtimeMs : -1);

function convertAll(force) {
  const jobs = [
    ...listPsds(path.join(mastersDir, 'bg')).map(f => ({ f, kind: 'bg', out: path.join(assetDir, 'bg', `${path.basename(f, path.extname(f))}.png`) })),
    ...listPsds(path.join(mastersDir, 'char')).map(f => ({ f, kind: 'char', out: path.join(assetDir, 'char', path.basename(f, path.extname(f))) })),
    ...listPsds(path.join(mastersDir, 'ui')).map(f => ({ f, kind: 'ui', out: path.join(assetDir, 'ui', `${path.basename(f, path.extname(f))}.png`) })),
  ];
  let done = 0, failed = 0;
  for (const { f, kind, out } of jobs) {
    const stamp = kind === 'char' ? path.join(out, 'sprite.json') : out;
    if (!force && mtime(stamp) >= mtime(f)) continue;
    const rel = path.relative(root, f).split(path.sep).join('/');
    const warned = new Set();
    const warn = m => { if (!warned.has(m)) { warned.add(m); console.warn(`  ${rel}: ${m}`); } };
    const t0 = Date.now();
    try {
      const convert = { bg: convertBackground, char: convertCharacter, ui: convertUi }[kind];
      const info = convert(f, out, warn);
      console.log(`${rel} -> ${path.relative(root, out).split(path.sep).join('/')} (${info}, ${Date.now() - t0} ms)`);
      done++;
    } catch (e) {
      console.error(`${rel}: ${e.message}`);
      failed++;
    }
  }
  if (!jobs.length) console.log('No PSDs in masters/bg, masters/char or masters/ui.');
  else if (!done && !failed) console.log('Art is up to date.');
  return failed;
}

const args = process.argv.slice(2);
const failed = convertAll(args.includes('--force'));
if (args.includes('--watch')) {
  fs.mkdirSync(mastersDir, { recursive: true });
  let timer;
  fs.watch(mastersDir, { recursive: true }, (_ev, f) => {
    if (f && !/\.psd$/i.test(f)) return;
    clearTimeout(timer);
    timer = setTimeout(() => convertAll(false), 300); // Photoshop writes in several steps
  });
  console.log('Watching masters/ for PSD changes...');
} else if (failed) process.exitCode = 1;
