// The portable desktop export (`vn export --desktop --portable`, the Studio's Build dialog): the Electron runtime the export
// runs under (Marginalia Studio's own) is copied next to the game, with the exe named after the game. These are the parts that
// need no file system: the names, and which runtime files go along.

/** Characters Windows refuses in file names, and control characters. */
const BAD_CHARS = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;
/** Names Windows reserves for devices, with or without an extension. */
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
const MAX_NAME = 64;

/**
 * A file name made from a game title that is safe on Windows, macOS and Linux: forbidden characters become spaces, runs of
 * spaces collapse, trailing dots and spaces go (Windows drops them), device names get a suffix, and it is at most 64
 * characters. Letters of any script stay. An empty result is `fallback`.
 */
export function safeFileName(title: string, fallback = 'Game'): string {
  let name = title.normalize('NFC').replace(BAD_CHARS, ' ').replace(/\s+/g, ' ').trim();
  name = [...name].slice(0, MAX_NAME).join('').replace(/[. ]+$/, '').replace(/^[. ]+/, '');
  if (!name) return fallback;
  return RESERVED.test(name) ? `${name} game` : name;
}

/** The exe of the portable app: `<name>.exe` on Windows, the name in lower case with dashes elsewhere (no spaces in a command). */
export function portableExeName(name: string, platform: string): string {
  return platform === 'win32' ? `${name}.exe` : name.toLowerCase().replace(/\s+/g, '-');
}

/** The portable app's folder (and its zip without `.zip`): `<name>-<platform>-<arch>`, like the Studio's own release folder. */
export function portableFolderName(name: string, platform: string, arch: string): string {
  const short = ({ win32: 'win', darwin: 'mac', linux: 'linux' } as Record<string, string>)[platform] ?? platform;
  return `${name}-${short}-${arch}`;
}

/**
 * Whether a file or folder of an Electron install (a `/`-separated path relative to the folder of its exe) goes into an app built
 * on that runtime: not the app it carries (`resources/app`, `resources/app.asar`), not Electron's default app, and of Chromium's
 * UI translations only en-US (Chromium falls back to it; the others are ~49 MB). The licence files stay.
 */
export function keepRuntimeFile(rel: string): boolean {
  const r = rel.replace(/\\/g, '/').replace(/\/+$/, '');
  if (r === 'resources/app' || r.startsWith('resources/app/') || r === 'resources/app.asar' || r === 'resources/default_app.asar') return false;
  return !r.startsWith('locales/') || r === 'locales/en-US.pak';
}
