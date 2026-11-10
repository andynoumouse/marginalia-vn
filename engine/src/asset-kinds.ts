// The file types the engine plays, one list per kind, for every place that sorts asset files by kind: the asset index and
// checks, references and completions, the Assets panel's drops and file pickers, and the game shell's loaders.

export const IMAGE_EXTS = ['png', 'webp', 'jpg', 'jpeg', 'avif'];
export const AUDIO_EXTS = ['ogg', 'mp3', 'wav', 'm4a', 'flac', 'opus'];
export const MOVIE_EXTS = ['webm', 'mp4', 'm4v', 'ogv'];
export const FONT_EXTS = ['woff2', 'woff', 'ttf', 'otf'];

/** `a|b|c` for building a pattern around the extensions, e.g. `^voice/(.+)\.(?:${extAlternatives(AUDIO_EXTS)})$`. */
export const extAlternatives = (exts: readonly string[]): string => exts.join('|');
const endsWith = (exts: readonly string[]) => new RegExp(`\\.(${extAlternatives(exts)})$`, 'i');

/** A file name ending in an extension of its kind (case ignored); `.replace(IMAGE_FILE, '')` strips it. */
export const IMAGE_FILE = endsWith(IMAGE_EXTS);
export const AUDIO_FILE = endsWith(AUDIO_EXTS);
export const MOVIE_FILE = endsWith(MOVIE_EXTS);
export const FONT_FILE = endsWith(FONT_EXTS);

/** An `accept` list for a file picker: `.png,.webp,...`. */
export const acceptList = (...kinds: (readonly string[])[]): string => kinds.flat().map(e => `.${e}`).join(',');
