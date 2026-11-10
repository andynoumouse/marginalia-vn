// A minimal PNG encoder for the make-* scripts (zlib only, no dependencies).
import zlib from 'node:zlib';

const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body));
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  return Buffer.concat([len, body, crc]);
};

/** Colour types: 0 grayscale, 2 RGB, 6 RGBA (8 bits per channel). */
export const GRAY = 0, RGB = 2, RGBA = 6;

/**
 * A PNG of `width` x `height` from `raw`: the scanlines one after another, each led by its filter byte (0 for none),
 * as one Buffer or a list of row Buffers.
 */
export function encodePng(width, height, raw, colorType) {
  const head = Buffer.alloc(13); head.writeUInt32BE(width, 0); head.writeUInt32BE(height, 4); head.set([8, colorType, 0, 0, 0], 8);
  const data = Array.isArray(raw) ? Buffer.concat(raw) : raw;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head),
    chunk('IDAT', zlib.deflateSync(data, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
