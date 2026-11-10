// Saving over a file that changed meanwhile (UX round EL-18). A save names the version of the file it started from, as a hash of
// the text the editor last read from disk or wrote there (`X-VN-Base`); the server refuses it with 409 when the file on disk is no
// longer that text (an edit in another editor, a git pull, a second editor tab), and the editor asks what to keep. A save without
// the header is not checked (the animation studio's rig writes, tools).

/** The request header that carries the base. */
export const SAVE_BASE_HEADER = 'X-VN-Base';

/** The text as compared: line endings do not count (a checkout may turn LF into CRLF). */
const normalize = (s: string) => s.replace(/\r\n/g, '\n');

/** A short hash of a file's text (FNV-1a over its UTF-16 code units, line endings normalized), as 8 hex digits. */
export function textHash(text: string): string {
  const s = normalize(text);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Does a save conflict with the file on disk? `base` is the header's value (null: not sent, no check); `disk` the file's text now, null
 * when there is no file (a new one: its base is the hash of "").
 */
export const saveConflicts = (base: string | null, disk: string | null): boolean => base !== null && base !== textHash(disk ?? '');
