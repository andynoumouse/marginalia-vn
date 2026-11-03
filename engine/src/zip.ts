// Zip archives in memory, for the online demo's project download and import (online/). Pure: the caller passes raw
// deflate (CompressionStream('deflate-raw') in a browser); without one, entries are stored. Reads stored and deflated
// entries; no zip64, encryption or multi-disk archives (projects that need those come from the desktop tools anyway).

export type RawDeflate = (data: Uint8Array) => Promise<Uint8Array>;
export interface ZipEntry { path: string; bytes: Uint8Array; mtime?: number }

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
export function crc32(buf: Uint8Array): number { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }

/** MS-DOS time and date of `ms` (local time, 2-second steps, 1980 at the earliest). */
function dosTime(ms: number): [number, number] {
  const d = new Date(Math.max(ms, Date.UTC(1980, 0, 2)));
  return [(d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()];
}

/** A zip of `entries` (paths '/'-separated, UTF-8 names). A file deflate does not shrink is stored. */
export async function writeZip(entries: readonly ZipEntry[], deflate?: RawDeflate): Promise<Uint8Array> {
  const enc = new TextEncoder(), locals: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.path), crc = crc32(e.bytes);
    const packed = deflate && e.bytes.length > 64 ? await deflate(e.bytes) : null;
    const [data, method] = packed && packed.length < e.bytes.length ? [packed, 8] : [e.bytes, 0];
    const [time, date] = dosTime(e.mtime ?? Date.now());
    const head = new Uint8Array(30 + name.length), h = new DataView(head.buffer);
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, method, true);
    h.setUint16(10, time, true); h.setUint16(12, date, true); h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true); h.setUint32(22, e.bytes.length, true); h.setUint16(26, name.length, true);
    head.set(name, 30);
    const dir = new Uint8Array(46 + name.length), c = new DataView(dir.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint16(10, method, true); c.setUint16(12, time, true); c.setUint16(14, date, true); c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true); c.setUint32(24, e.bytes.length, true); c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    dir.set(name, 46);
    locals.push(head, data);
    central.push(dir);
    offset += head.length + data.length;
  }
  const dirSize = central.reduce((n, p) => n + p.length, 0);
  const end = new Uint8Array(22), v = new DataView(end.buffer);
  v.setUint32(0, 0x06054b50, true); v.setUint16(8, entries.length, true); v.setUint16(10, entries.length, true);
  v.setUint32(12, dirSize, true); v.setUint32(16, offset, true);
  const out = new Uint8Array(offset + dirSize + 22);
  let at = 0;
  for (const p of [...locals, ...central, end]) { out.set(p, at); at += p.length; }
  return out;
}

/** The files in a zip (folders left out), inflating with `inflate` (raw deflate). Throws on what it cannot read. */
export async function readZip(zip: Uint8Array, inflate: RawDeflate): Promise<ZipEntry[]> {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65535); i--) if (v.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error('not a zip file');
  const count = v.getUint16(end + 10, true);
  let p = v.getUint32(end + 16, true);
  const utf8 = new TextDecoder(), out: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('damaged zip directory');
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true), nameLen = v.getUint16(p + 28, true);
    const extra = v.getUint16(p + 30, true), note = v.getUint16(p + 32, true), local = v.getUint32(p + 42, true);
    const flags = v.getUint16(p + 8, true);
    if (flags & 1) throw new Error('encrypted zips are not supported');
    const path = utf8.decode(zip.subarray(p + 46, p + 46 + nameLen)).replace(/\\/g, '/');
    p += 46 + nameLen + extra + note;
    if (path.endsWith('/')) continue;
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const data = zip.subarray(start, start + size);
    if (method !== 0 && method !== 8) throw new Error(`${path}: compression method ${method} is not supported`);
    out.push({ path, bytes: method === 8 ? await inflate(data) : data.slice() });
  }
  return out;
}

/** The folder every entry sits in when there is exactly one ("my-game/script/a.vn" -> "my-game/"), else ''. */
export function commonRoot(paths: readonly string[]): string {
  const first = paths[0]?.split('/')[0];
  return first && paths.every(p => p.startsWith(`${first}/`)) ? `${first}/` : '';
}
