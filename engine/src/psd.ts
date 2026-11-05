// Art pipeline core: a parsed layered PSD (ag-psd's readPsd with `useImageData`) -> game-ready PNGs and sprite manifests.
// Pure: the caller reads the PSD, passes a deflate (node's zlib, or the browser's CompressionStream) and writes the files.
// tools/psd-convert.mjs runs it on masters/ on disk, the online demo's service worker (online/sw.ts) on a dropped PSD.
//
//   masters/bg/<name>.psd    -> assets/bg/<name>.png             flattened, scaled to cover the stage
//   masters/char/<char>.psd  -> assets/char/<char>/sprite.json   + one trimmed PNG per part
//   masters/ui/<name>.psd    -> assets/ui/<name>.png             flattened at 1:1 (text box / button frames)
//
// Character PSDs: the canvas height is the stage height (scaled to it), feet near the bottom.
//   top-level layer          always drawn (body, outfit...)
//   top-level group = slot   e.g. "eyes"; each child (layer or group) is one variant, flattened to one PNG
//   "open, neutral"          variant "open" that pose "neutral" also uses
//   visible child            the slot's default (none visible = slot empty unless a pose picks it)
//   hidden layers, and names starting with _, are skipped (the visibility of slot children only sets the default)
//   "+folder"                a top-level group starting with game.json's "psdPrefix" (default "+") is not a slot: its
//                            layers are drawn like top-level layers
// Blend modes apply inside a part; parts stack with normal blending. Layer effects (shadows, strokes) are not rendered.

export const DEFAULT_PREFIX = '+';

/** The ag-psd layer fields used here. */
export interface PsdPixels { width: number; height: number; data: Uint8ClampedArray | Uint8Array | Uint16Array | Float32Array }
export interface PsdLayer {
  name?: string; hidden?: boolean; clipping?: boolean; children?: PsdLayer[];
  left?: number; top?: number; right?: number; bottom?: number;
  imageData?: PsdPixels; opacity?: number; fillOpacity?: number; blendMode?: string;
  mask?: { disabled?: boolean; imageData?: PsdPixels; defaultColor?: number; left?: number; top?: number };
  adjustment?: unknown; effects?: { disabled?: boolean };
}
export interface Psd { width: number; height: number; colorMode?: number; imageData?: PsdPixels; children?: PsdLayer[] }

export const fileSafe = (s: string) => s.replace(/[^\w\-]+/g, '_');
export const parseName = (raw: string) => {
  const [name, ...aliases] = raw.split(',').map(s => s.trim()).filter(Boolean);
  return { name: name ?? '', aliases };
};
export const isIdent = (s: string) => /^[A-Za-z_]\w*$/.test(s);

const skipped = (l: PsdLayer) => !!l.name?.startsWith('_');
const isGroup = (l: PsdLayer): l is PsdLayer & { children: PsdLayer[] } => Array.isArray(l.children);

/** The folder prefix from game.json's `psdPrefix`: a string ("" turns folders off), else "+". */
export const prefixFrom = (game: unknown) => {
  const p = (game as { psdPrefix?: unknown } | null)?.psdPrefix;
  return typeof p === 'string' ? p : DEFAULT_PREFIX;
};

// ---- character layer tree -> a plan of parts ----
//   { type: 'part', name, layers }                        always drawn: a layer plus the layers clipped to it
//   { type: 'slot', slot, default, variants: [{ name, aliases, layer }] }
// Entries come bottom to top, each with `group`: the folders it sat in, prefix removed and joined by `/` ("arm/forearm"), when it sat in any. A top-level group is a slot, unless its name starts with `prefix`: then it is only a folder
// for organizing the PSD, and its layers are processed as if they sat beside it.
export type PlanEntry =
  | { type: 'part'; name: string; layers: PsdLayer[]; group?: string }
  | { type: 'slot'; slot: string; default: string | null; variants: { name: string; aliases: string[]; layer: PsdLayer }[]; group?: string };

export function planCharacter(top: PsdLayer[], { prefix = DEFAULT_PREFIX, warn = (_m: string) => {} } = {}): PlanEntry[] {
  const plan: PlanEntry[] = [];
  const partFiles = new Map<string, string>(); // file-safe part name -> layer name, to catch two layers writing one PNG
  const isFolder = (l: PsdLayer) => isGroup(l) && prefix !== '' && (l.name ?? '').trim().startsWith(prefix);

  const planSlot = (l: PsdLayer & { children: PsdLayer[] }): PlanEntry => {
    const slot = l.name?.trim() ?? '';
    if (!isIdent(slot)) warn(`slot "${slot}" is not a valid script name (letters, digits, _)`);
    const variants: { name: string; aliases: string[]; layer: PsdLayer }[] = [], seen = new Set<string>();
    let def: string | null = null;
    for (const v of [...l.children].reverse()) { // top-most first, so the top visible child is the default
      if (skipped(v)) continue;
      const { name, aliases } = parseName(v.name ?? '');
      if (!isIdent(name)) { warn(`variant "${v.name}" in "${slot}" is not a valid script name; skipped`); continue; }
      if (seen.has(name)) warn(`"${slot}" has two variants named "${name}"; using the upper one`);
      else { seen.add(name); variants.push({ name, aliases, layer: v }); }
      if (!v.hidden && def === null) def = name;
    }
    return { type: 'slot', slot, default: def, variants };
  };

  const walk = (layers: PsdLayer[], path: string[] = []) => {
    const group = path.length ? { group: path.join('/') } : {};
    for (let i = 0; i < layers.length; i++) {
      const l = layers[i];
      if (skipped(l) || l.clipping) continue; // clipped layers are merged into their base
      if (isFolder(l)) {
        const folder = (l.name ?? '').trim().slice(prefix.length).trim();
        if (!l.hidden) walk(l.children!, folder ? [...path, folder] : path);
        continue;
      }
      if (!isGroup(l)) {
        const stack = [l];
        while (layers[i + 1]?.clipping) stack.push(layers[++i]);
        if (l.hidden) continue;
        const name = l.name ?? 'layer', file = fileSafe(name);
        if (partFiles.has(file)) warn(`layers "${partFiles.get(file)}" and "${name}" write the same image; the upper one wins`);
        else partFiles.set(file, name);
        plan.push({ type: 'part', name, layers: stack, ...group });
        continue;
      }
      plan.push({ ...planSlot(l), ...group });
    }
  };

  walk(top);
  return plan;
}

// ---- images: premultiplied float RGBA in a box {x, y, w, h} (document coordinates) ----
interface Image { x: number; y: number; w: number; h: number; d: Float32Array }
const newImage = (x: number, y: number, w: number, h: number): Image =>
  ({ x, y, w: Math.max(0, w), h: Math.max(0, h), d: new Float32Array(Math.max(0, w) * Math.max(0, h) * 4) });
const unit = (data: PsdPixels['data']) => (data instanceof Uint16Array ? 1 / 65535 : data instanceof Float32Array ? 1 : 1 / 255);

function fromPixels(px: PsdPixels, x: number, y: number): Image {
  const out = newImage(x, y, px.width, px.height), k = unit(px.data), s = px.data, d = out.d;
  for (let i = 0; i < d.length; i += 4) {
    const a = s[i + 3] * k;
    d[i] = s[i] * k * a; d[i + 1] = s[i + 1] * k * a; d[i + 2] = s[i + 2] * k * a; d[i + 3] = a;
  }
  return out;
}

function applyMask(im: Image, mask: PsdLayer['mask']) {
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
const BLEND: Record<string, (s: number, b: number) => number> = {
  normal: s => s,
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
function composite(dst: Image, src: Image, alpha: number, mode: string, clip?: Image) {
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
interface Box { l: number; t: number; r: number; b: number }
function bounds(layers: PsdLayer[], onlyVisible = true): Box | null {
  let b: Box | null = null;
  for (const l of layers) {
    if (skipped(l) || (onlyVisible && l.hidden)) continue;
    const lb = isGroup(l) ? bounds(l.children)
      : (l.right ?? 0) > (l.left ?? 0) && (l.bottom ?? 0) > (l.top ?? 0) ? { l: l.left!, t: l.top!, r: l.right!, b: l.bottom! } : null;
    if (!lb) continue;
    b = b ? { l: Math.min(b.l, lb.l), t: Math.min(b.t, lb.t), r: Math.max(b.r, lb.r), b: Math.max(b.b, lb.b) } : lb;
  }
  return b;
}

/** Flatten layers (bottom to top) into one image; null when nothing is visible. */
function flatten(layers: PsdLayer[], warn: (m: string) => void, b = bounds(layers)): Image | null {
  if (!b) return null;
  const out = newImage(b.l, b.t, b.r - b.l, b.b - b.t);
  let base: Image | null = null; // the layer clipping masks attach to
  for (const l of layers) {
    if (skipped(l) || l.hidden) continue;
    if (l.adjustment) { warn(`adjustment layer "${l.name}" is ignored`); continue; }
    if (l.effects && !l.effects.disabled) warn(`layer effects on "${l.name}" are not rendered; rasterize them`);
    const src = isGroup(l) ? flatten(l.children, warn) : l.imageData ? fromPixels(l.imageData, l.left ?? 0, l.top ?? 0) : null;
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
function axisWeights(srcLen: number, offset: number, s: number) {
  const d0 = Math.floor(offset), d1 = Math.ceil(offset + srcLen * s);
  const taps: number[][] = [];
  for (let d = d0; d < d1; d++) {
    const a = Math.max(0, (d - offset) / s), b = Math.min(srcLen, (d + 1 - offset) / s);
    const list: number[] = [];
    for (let i = Math.floor(a); i < b; i++) {
      const w = (Math.min(b, i + 1) - Math.max(a, i)) * s;
      if (w > 0) list.push(i, w);
    }
    taps.push(list);
  }
  return { start: d0, taps };
}

function resample(im: Image, s: number): Image {
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

function crop(im: Image, l: number, t: number, r: number, b: number): Image {
  const x0 = Math.max(l, im.x), y0 = Math.max(t, im.y), x1 = Math.min(r, im.x + im.w), y1 = Math.min(b, im.y + im.h);
  const out = newImage(x0, y0, x1 - x0, y1 - y0);
  for (let y = 0; y < out.h; y++) {
    const from = ((y0 - im.y + y) * im.w + (x0 - im.x)) * 4;
    out.d.set(im.d.subarray(from, from + out.w * 4), y * out.w * 4);
  }
  return out;
}

/** Crop to the pixels that are not fully transparent (after 8-bit rounding); null when empty. */
function trim(im: Image): Image | null {
  let l = im.w, t = im.h, r = -1, b = -1;
  for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) {
    if (im.d[(y * im.w + x) * 4 + 3] < 0.5 / 255) continue;
    if (x < l) l = x; if (x > r) r = x; if (y < t) t = y; if (y > b) b = y;
  }
  return r < 0 ? null : crop(im, im.x + l, im.y + t, im.x + r + 1, im.y + b + 1);
}

// ---- PNG (RGBA8, adaptive filters) ----
/** zlib-wrapped deflate (RFC 1950), as node's zlib.deflateSync and the browser's CompressionStream('deflate') write it. */
export type Deflate = (data: Uint8Array) => Promise<Uint8Array>;

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(buf: Uint8Array) { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length), view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

async function encodePng(im: Image, deflate: Deflate): Promise<Uint8Array> {
  const { w, h, d } = im, stride = w * 4;
  const px = new Uint8Array(stride * h);
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a <= 0) continue;
    px[i] = Math.round(Math.min(1, d[i] / a) * 255); px[i + 1] = Math.round(Math.min(1, d[i + 1] / a) * 255);
    px[i + 2] = Math.round(Math.min(1, d[i + 2] / a) * 255); px[i + 3] = Math.round(Math.min(1, a) * 255);
  }
  const raw = new Uint8Array((stride + 1) * h), cand = new Uint8Array(stride), zero = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const row = px.subarray(y * stride, (y + 1) * stride), up = y ? px.subarray((y - 1) * stride, y * stride) : zero;
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
      if (sum < best) { best = sum; raw[y * (stride + 1)] = f; raw.set(cand, y * (stride + 1) + 1); }
    }
  }
  const ihdr = new Uint8Array(13), view = new DataView(ihdr.buffer);
  view.setUint32(0, w); view.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 6;
  return concat([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', await deflate(raw)), chunk('IEND', new Uint8Array(0)),
  ]);
}

// ---- converters ----
export type MasterKind = 'bg' | 'char' | 'ui';
export interface ConvertOptions {
  /** The stage size (game.json "stage", engine/src/stage.ts stageSize). */
  stage: { width: number; height: number };
  /** game.json's psdPrefix (prefixFrom). */
  prefix?: string;
  deflate: Deflate;
  warn?(message: string): void;
}
export interface Converted {
  /** Paths relative to assets/ ("bg/park.png", "char/mina/eyes/open.png", "char/mina/sprite.json"), with their bytes. */
  files: { path: string; bytes: Uint8Array }[];
  /** A one-line summary for the log ("1920x1080", "540x1080, 12 images, slots: eyes(3)"). */
  info: string;
}

/** True when every pixel is the same color (a blank composite). */
function isFlat(px: PsdPixels) {
  const d = px.data;
  for (let i = 4; i < d.length; i++) if (d[i] !== d[i & 3]) return false;
  return true;
}

/** The whole document as one image (document-sized box). */
function documentImage(psd: Psd, warn: (m: string) => void): Image {
  // Photoshop's own composite is exact (all blend modes, effects), but without "Maximize compatibility"
  // it is saved blank: then flatten the layers ourselves.
  const useComposite = psd.imageData && !(psd.children?.length && isFlat(psd.imageData));
  const im = useComposite ? fromPixels(psd.imageData!, 0, 0) : flatten(psd.children ?? [], warn, { l: 0, t: 0, r: psd.width, b: psd.height });
  if (!im) throw new Error('nothing visible');
  if (!useComposite) warn('no usable composite image (save with "Maximize compatibility" for an exact match); flattened the layers');
  return im;
}

/** The assets a master makes: `bg/park.psd` -> bg/park.png, `char/mina.psd` -> char/mina/sprite.json (and its parts). */
export const masterKind = (master: string): { kind: MasterKind; name: string } | null => {
  const m = /^(bg|char|ui)\/([^/]+)\.psd$/i.exec(master);
  return m ? { kind: m[1].toLowerCase() as MasterKind, name: m[2] } : null;
};

/** Converts the parsed master `master` (relative to masters/, e.g. "char/mina.psd"). Throws when nothing is visible. */
export async function convertMaster(master: string, psd: Psd, opts: ConvertOptions): Promise<Converted> {
  const what = masterKind(master);
  if (!what) throw new Error(`${master} is not under masters/bg, masters/char or masters/ui`);
  const warn = opts.warn ?? (() => {});
  if (psd.colorMode !== undefined && psd.colorMode !== 3) warn('not an RGB document; colors may be off');
  const { width: W, height: H } = opts.stage;
  if (what.kind === 'ui') {
    const im = documentImage(psd, warn);
    return { files: [{ path: `ui/${what.name}.png`, bytes: await encodePng(im, opts.deflate) }], info: `${im.w}x${im.h}` };
  }
  if (what.kind === 'bg') {
    let im = documentImage(psd, warn);
    if (Math.abs(psd.width / psd.height - W / H) > 0.01) warn(`${psd.width}x${psd.height} does not match the ${W}x${H} stage; edges are cropped`);
    const s = Math.max(W / psd.width, H / psd.height);
    const ox = (W - psd.width * s) / 2, oy = (H - psd.height * s) / 2;
    im = resample({ ...im, x: 0, y: 0 }, s);
    im = crop({ ...im, x: im.x + Math.round(ox), y: im.y + Math.round(oy) }, 0, 0, W, H);
    return { files: [{ path: `bg/${what.name}.png`, bytes: await encodePng(im, opts.deflate) }], info: `${im.w}x${im.h}` };
  }
  return convertCharacter(what.name, psd, H, opts.prefix ?? DEFAULT_PREFIX, opts.deflate, warn);
}

async function convertCharacter(char: string, psd: Psd, charH: number, prefix: string, deflate: Deflate, warn: (m: string) => void): Promise<Converted> {
  const s = charH / psd.height;
  if (s > 1) warn(`canvas is only ${psd.height}px tall; parts are upscaled to ${charH}`);
  const files: Converted['files'] = [], written: string[] = [];
  const writePart = async (im: Image | null, rel: string) => {
    if (!im) return null;
    const scaled = trim(crop(resample(im, s), 0, 0, Math.round(psd.width * s), charH));
    if (!scaled) return null;
    files.push({ path: `char/${char}/${rel}`, bytes: await encodePng(scaled, deflate) });
    written.push(rel);
    return { file: rel, x: scaled.x, y: scaled.y };
  };

  const parts: unknown[] = [];
  for (const entry of planCharacter(psd.children ?? [], { prefix, warn })) {
    if (entry.type === 'part') {
      const p = await writePart(flatten(entry.layers, warn), `${fileSafe(entry.name)}.png`);
      if (p) parts.push({ ...p, ...(entry.group ? { group: entry.group } : {}) });
      continue;
    }
    const variants: Record<string, unknown> = {};
    for (const { name, aliases, layer: v } of entry.variants) {
      const im = isGroup(v) ? flatten(v.children, warn) : flatten([{ ...v, hidden: false }], warn);
      const p = await writePart(im, `${fileSafe(entry.slot)}/${fileSafe(name)}.png`);
      variants[name] = { ...(p ?? {}), ...(aliases.length ? { poses: aliases } : {}) };
    }
    parts.push({ slot: entry.slot, default: entry.default, variants, ...(entry.group ? { group: entry.group } : {}) });
  }
  const manifest = { generator: 'psd-convert', width: Math.round(psd.width * s), height: charH, parts, files: written };
  files.push({ path: `char/${char}/sprite.json`, bytes: new TextEncoder().encode(JSON.stringify(manifest, null, 2) + '\n') });
  const slots = (parts as { slot?: string; variants?: object }[]).filter(p => p.slot).map(p => `${p.slot}(${Object.keys(p.variants!).length})`);
  return { files, info: `${manifest.width}x${manifest.height}, ${written.length} images${slots.length ? `, slots: ${slots.join(' ')}` : ''}` };
}

/** The part images an earlier conversion of `char` wrote (its sprite.json's `files`), relative to assets/, to clear before a new one. */
export function previousParts(char: string, manifestText: string | null): string[] {
  if (!manifestText) return [];
  try {
    const files = (JSON.parse(manifestText) as { files?: unknown }).files;
    return Array.isArray(files) ? files.filter((f): f is string => typeof f === 'string' && !f.includes('..')).map(f => `char/${char}/${f}`) : [];
  } catch { return []; }
}
