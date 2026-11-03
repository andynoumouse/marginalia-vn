// The exported game's own face: game.json `icon` (a PNG in assets/ui, the exe and window icon and the web build's favicon) and
// `version` (the exe's version info and the desktop package's version). These are the parts that need no file system: reading a
// PNG's size, wrapping it in an .ico, and the checks.

/** The PNG file signature. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The smallest icon that stays sharp on a Windows desktop (Explorer's largest view). */
export const ICON_MIN_SIZE = 256;

/** A PNG's pixel size from its header, or null when the bytes are not a PNG. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) return null;
  // The first chunk is IHDR: length (4), type (4), then width and height, big-endian.
  if (String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]) !== 'IHDR') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16), height = view.getUint32(20);
  return width && height ? { width, height } : null;
}

/**
 * An .ico holding one PNG image as it is (the form Windows has read since Vista; it scales it down for small views). The
 * directory entry's width and height bytes are 0 for 256 pixels or more, as the format has it.
 */
export function icoFromPng(png: Uint8Array): Uint8Array {
  const size = pngSize(png);
  if (!size) throw new Error('Not a PNG image');
  const out = new Uint8Array(6 + 16 + png.length);
  const view = new DataView(out.buffer);
  view.setUint16(2, 1, true); // type: icon
  view.setUint16(4, 1, true); // one image
  out[6] = size.width >= 256 ? 0 : size.width;
  out[7] = size.height >= 256 ? 0 : size.height;
  view.setUint16(10, 1, true); // colour planes
  view.setUint16(12, 32, true); // bits per pixel
  view.setUint32(14, png.length, true);
  view.setUint32(18, 22, true); // offset of the image data
  out.set(png, 22);
  return out;
}

/** What is wrong with an icon of this size (null when nothing): it must be square and at least 256 pixels. */
export function iconSizeProblem(size: { width: number; height: number } | null): string | null {
  if (!size) return 'icon: the file is not a PNG image';
  if (size.width !== size.height) return `icon: the image is ${size.width}x${size.height}; an icon needs a square one (256x256 or larger)`;
  if (size.width < ICON_MIN_SIZE) return `icon: the image is ${size.width}x${size.height}; use ${ICON_MIN_SIZE}x${ICON_MIN_SIZE} or larger so it stays sharp`;
  return null;
}

/** The asset path of game.json's `icon` (`ui/<icon>.png`), or null when it names none. */
export function iconAsset(game: unknown): string | null {
  const icon = game && typeof game === 'object' ? (game as Record<string, unknown>).icon : undefined;
  return typeof icon === 'string' && icon ? `ui/${icon}.png` : null;
}

/** game.json `version`: one to four whole numbers with dots between ("1", "1.2", "1.2.3", "1.2.3.4"), each at most 65535. */
const VERSION = /^\d{1,5}(\.\d{1,5}){0,3}$/;

/** What is wrong with game.json's `version` (null when it is missing or fine). */
export function versionProblem(version: unknown): string | null {
  if (version === undefined) return null;
  if (typeof version !== 'string' || !VERSION.test(version) || version.split('.').some(n => Number(n) > 65535)) {
    return 'version needs one to four whole numbers with dots between, like "1.0" or "1.2.3"';
  }
  return null;
}

/** game.json's `version` padded to the four parts Windows version info holds ("1.2" -> "1.2.0.0"); "1.0.0.0" when unset or bad. */
export function windowsVersion(version: unknown): string {
  if (versionProblem(version) || typeof version !== 'string') return '1.0.0.0';
  const parts = version.split('.').map(n => String(Number(n)));
  while (parts.length < 4) parts.push('0');
  return parts.join('.');
}

/** game.json's `version` as a three-part semver for the desktop package.json ("1.2" -> "1.2.0", "1.2.3.4" -> "1.2.3"). */
export function packageVersion(version: unknown): string {
  return windowsVersion(version).split('.').slice(0, 3).join('.');
}
