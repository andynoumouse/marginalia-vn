/**
 * Rename, move and delete in the editor's Files panel. Paths are project-relative ('script/ch1/intro.vn', 'assets/bg',
 * 'masters/bg/park.psd') and stay inside script/, assets/ or masters/; those three folders themselves are never touched.
 * The dev server checks every request with these; the editor uses them to word its prompts and to follow open tabs.
 */

const ROOTS = ['script', 'assets', 'masters'];
const PART = /^[\w\-][\w\-.]*$/; // a file or folder name: no leading dot, so no '..' and no hidden files

const extOf = (p: string) => {
  const base = p.slice(p.lastIndexOf('/') + 1), dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
};

/** Why `rel` may not be renamed, moved or deleted, or null when it may. */
export function checkProjectPath(rel: string): string | null {
  const parts = rel.split('/');
  if (!ROOTS.includes(parts[0])) return `${rel || '(empty)'}: only files under script/, assets/ and masters/`;
  if (parts.length < 2) return `${rel}: the ${parts[0]}/ folder itself cannot be changed`;
  if (!parts.slice(1).every(p => PART.test(p))) return `${rel}: not a valid path (letters, digits, _ - . and / only)`;
  return null;
}

export type MovePlan = { to: string } | { error: string };

/**
 * Checks renaming or moving `from` to `to` (a file, or a folder when `isDir`). Both stay under the same top folder; a script
 * keeps `.vn` (added when left out), other files keep their extension, and a folder cannot move into itself.
 */
export function planMove(from: string, to: string, isDir = false): MovePlan {
  const bad = checkProjectPath(from);
  if (bad) return { error: bad };
  let dest = to.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  const root = from.slice(0, from.indexOf('/'));
  if (!isDir && root === 'script' && !dest.endsWith('.vn')) dest += '.vn';
  const badTo = checkProjectPath(dest);
  if (badTo) return { error: badTo };
  if (!dest.startsWith(`${root}/`)) return { error: `${dest}: stay under ${root}/` };
  if (dest === from) return { error: 'same name' };
  if (isDir) {
    if (dest.startsWith(`${from}/`)) return { error: `${dest}: a folder cannot move into itself` };
  } else if (extOf(dest) !== extOf(from)) {
    return { error: `${dest}: keep the .${extOf(from) || '(none)'} extension` };
  }
  return { to: dest };
}

/** Where `name` ends up when `from` moves to `to`: the path itself, or one under it as a folder. Null when it is not affected. */
export function movedPath(name: string, from: string, to: string): string | null {
  if (name === from) return to;
  return name.startsWith(`${from}/`) ? to + name.slice(from.length) : null;
}

/** Whether `name` is `rel` or lies under it (so deleting `rel` removes it). */
export const isUnder = (name: string, rel: string) => name === rel || name.startsWith(`${rel}/`);
