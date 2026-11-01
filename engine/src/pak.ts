// Asset pack for the desktop build: every file under assets/ in one `assets.pak`, lightly scrambled so players
// don't browse or edit the art and audio. This is obfuscation, not protection: the key ships with the game.
//
// Layout: "VNPAK1\0\0" (8) | index length u32 LE (4) | reserved (4) | index JSON | file data.
// The index maps a path to [offset, length], offsets counted from the start of the data. Everything after the
// 16-byte preamble is XORed with a keystream that depends only on the absolute position in the file, so any
// range can be read and unscrambled on its own (audio seeking) without touching the rest.

const MAGIC = 'VNPAK1\0\0';
export const PAK_PREAMBLE = 16;

/** Hash a key string to the keystream seed. */
export function pakSeed(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

function mix(x: number): number {
  x ^= x >>> 16; x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

/** XOR `buf` in place as if it started at absolute file position `pos`. Applying it twice restores the data. */
export function scramble(buf: Uint8Array, pos: number, seed: number): Uint8Array {
  let word = -1;
  let w = 0;
  for (let i = 0; i < buf.length; i++) {
    const p = pos + i;
    const wi = Math.floor(p / 4);
    if (wi !== word) { word = wi; w = mix((seed ^ Math.imul(wi, 0x9e3779b1)) >>> 0); }
    buf[i] ^= (w >>> ((p & 3) * 8)) & 255;
  }
  return buf;
}

export interface PakEntry { offset: number; length: number }
export interface PakFile { path: string; size: number }

/** The preamble and scrambled index for files that will follow in this order, plus where each one starts. */
export function pakHeader(files: PakFile[], key: string): { header: Uint8Array; offsets: Map<string, number>; total: number } {
  const index: Record<string, [number, number]> = {};
  const offsets = new Map<string, number>();
  let at = 0;
  for (const f of files) {
    if (f.path in index) throw new Error(`Duplicate path in pak: ${f.path}`);
    index[f.path] = [at, f.size];
    at += f.size;
  }
  const json = new TextEncoder().encode(JSON.stringify(index));
  const header = new Uint8Array(PAK_PREAMBLE + json.length);
  for (let i = 0; i < 8; i++) header[i] = MAGIC.charCodeAt(i);
  new DataView(header.buffer).setUint32(8, json.length, true);
  header.set(json, PAK_PREAMBLE);
  scramble(header.subarray(PAK_PREAMBLE), PAK_PREAMBLE, pakSeed(key));
  const dataStart = header.length;
  for (const f of files) offsets.set(f.path, dataStart + index[f.path][0]);
  return { header, offsets, total: dataStart + at };
}

/** Whole pak in memory (tests, small games). Large builds stream with pakHeader + scramble instead. */
export function packAssets(files: { path: string; data: Uint8Array }[], key: string): Uint8Array {
  const { header, offsets, total } = pakHeader(files.map(f => ({ path: f.path, size: f.data.length })), key);
  const out = new Uint8Array(total);
  out.set(header, 0);
  const seed = pakSeed(key);
  for (const f of files) {
    const pos = offsets.get(f.path)!;
    out.set(f.data, pos);
    scramble(out.subarray(pos, pos + f.data.length), pos, seed);
  }
  return out;
}

/** Reads `length` bytes at absolute position `pos` of the pak file (fs.read, a Blob slice, a buffer). */
export type PakReader = (pos: number, length: number) => Uint8Array | Promise<Uint8Array>;

export interface Pak {
  has(path: string): boolean;
  paths(): string[];
  size(path: string): number | undefined;
  /** Bytes [start, end) of the file at `path` (whole file by default), or undefined when it is not in the pak. */
  read(path: string, start?: number, end?: number): Promise<Uint8Array | undefined>;
}

export async function openPak(read: PakReader, key: string): Promise<Pak> {
  const pre = await read(0, PAK_PREAMBLE);
  if (pre.length < PAK_PREAMBLE || String.fromCharCode(...pre.subarray(0, 8)) !== MAGIC) throw new Error('Not an asset pack.');
  const indexLen = new DataView(pre.buffer, pre.byteOffset, pre.byteLength).getUint32(8, true);
  const seed = pakSeed(key);
  const raw = scramble(Uint8Array.from(await read(PAK_PREAMBLE, indexLen)), PAK_PREAMBLE, seed);
  let index: Record<string, [number, number]>;
  try { index = JSON.parse(new TextDecoder().decode(raw)); } catch { throw new Error('Asset pack key does not match.'); }
  const dataStart = PAK_PREAMBLE + indexLen;
  return {
    has: path => path in index,
    paths: () => Object.keys(index),
    size: path => index[path]?.[1],
    async read(path, start = 0, end = Infinity) {
      const e = index[path];
      if (!e) return undefined;
      const from = Math.max(0, Math.min(start, e[1]));
      const to = Math.max(from, Math.min(end, e[1]));
      const pos = dataStart + e[0] + from;
      return scramble(Uint8Array.from(await read(pos, to - from)), pos, seed);
    },
  };
}
