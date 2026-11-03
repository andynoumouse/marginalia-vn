// Art pipeline: layered PSD masters -> game-ready PNGs + sprite manifests in assets/ (the conversion: engine/src/psd.ts).
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

const root = projectRoot(); // masters/ and assets/ belong to the game project (tools/paths.mjs)
const mastersDir = path.join(root, 'masters');
const assetDir = path.join(root, 'assets');
// The conversion itself is engine/src/psd.ts (shared with the online demo); this file reads the masters and writes assets/.
const { stageSize, convertMaster, previousParts, prefixFrom } = await import(new URL('../dist/engine/src/index.js', import.meta.url).href);
const readGame = () => {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'game.json'), 'utf8')); } catch { return {}; }
};

const lib = await import('ag-psd').catch(() => { console.error('ag-psd not found. Run "npm install" first.'); process.exit(1); });
const { readPsd, initializeCanvas } = lib.readPsd ? lib : lib.default;
// We only read pixel arrays (useImageData), so no canvas package is needed: hand ag-psd plain buffers.
initializeCanvas(
  () => { throw new Error('canvas is not available'); },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
);
const deflate = async raw => zlib.deflateSync(raw, { level: 9 });

async function convert(file, kind, warn) {
  const name = path.basename(file, path.extname(file));
  const psd = readPsd(fs.readFileSync(file), { useImageData: true, skipThumbnail: true, skipLinkedFilesData: true });
  const game = readGame();
  const out = await convertMaster(`${kind}/${name}.psd`, psd, { stage: stageSize(game), prefix: prefixFrom(game), deflate, warn });
  if (kind === 'char') { // clear what the previous conversion wrote (and only that)
    const manifest = path.join(assetDir, 'char', name, 'sprite.json');
    const old = fs.existsSync(manifest) ? fs.readFileSync(manifest, 'utf8') : null;
    for (const f of previousParts(name, old)) fs.rmSync(path.join(assetDir, ...f.split('/')), { force: true });
  }
  for (const f of out.files) {
    const dest = path.join(assetDir, ...f.path.split('/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, f.bytes);
  }
  return out.info;
}

// ---- driver ----
const listPsds = dir => fs.existsSync(dir)
  ? fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile() && /\.psd$/i.test(e.name)).map(e => path.join(dir, e.name)).sort()
  : [];
const mtime = f => (fs.existsSync(f) ? fs.statSync(f).mtimeMs : -1);

async function convertAll(force) {
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
      const info = await convert(f, kind, warn);
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
const failed = await convertAll(args.includes('--force'));
if (args.includes('--watch')) {
  fs.mkdirSync(mastersDir, { recursive: true });
  let timer, queue = Promise.resolve();
  fs.watch(mastersDir, { recursive: true }, (_ev, f) => {
    if (f && !/\.psd$/i.test(f)) return;
    clearTimeout(timer);
    timer = setTimeout(() => { queue = queue.then(() => convertAll(false)); }, 300); // Photoshop writes in several steps; one run at a time
  });
  console.log('Watching masters/ for PSD changes...');
} else if (failed) process.exitCode = 1;
