/**
 * The editor's git support: the Files panel shows the branch and the changed files, and Commit stages and commits everything
 * under the project folder (never outside it: the repository can start higher up). The dev server runs git and gathers the facts;
 * these read git's output, word the suggested message and decide what blocks a commit or deserves a warning.
 */

/** A changed path, relative to the project folder. `x`/`y` are git's index and work-tree codes; `from` is a rename's old path. */
export interface GitChange { path: string; x: string; y: string; from?: string }
export type GitChangeKind = 'added' | 'modified' | 'deleted' | 'renamed' | 'conflict';

/** Lines the Files panel offers to add to the project's .gitignore when git does not ignore those folders yet. */
export const GIT_IGNORE_LINES = ['/build/', '/.trash/'];
/** A file this big (or any PSD) should be in Git LFS: plain git keeps every version of it forever. */
export const LFS_WARN_BYTES = 10 * 1024 * 1024;
/** Hosts like GitHub refuse files over this without LFS. */
export const HOST_LIMIT_BYTES = 100 * 1024 * 1024;

/**
 * `git status --porcelain=v1 -z` output. Paths come relative to the repository root; `prefix` is the project's place in it
 * (`git rev-parse --show-prefix`, '' when the project is the root), and paths outside it are dropped.
 */
export function parseGitStatus(out: string, prefix = ''): GitChange[] {
  const parts = out.split('\0');
  const changes: GitChange[] = [];
  const local = (p: string) => (p.startsWith(prefix) ? p.slice(prefix.length) : null);
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (e.length < 4 || e[2] !== ' ') continue;
    const x = e[0], y = e[1], path = local(e.slice(3));
    const from = x === 'R' || x === 'C' ? parts[++i] : undefined; // the old path follows as its own field
    if (path === null || path === '') continue;
    const fromLocal = from === undefined ? undefined : local(from) ?? from;
    changes.push(fromLocal === undefined ? { path, x, y } : { path, x, y, from: fromLocal });
  }
  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

const CONFLICT = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);
export function changeKind(c: GitChange): GitChangeKind {
  const xy = c.x + c.y;
  if (CONFLICT.has(xy)) return 'conflict';
  if (c.x === 'R' || c.x === 'C') return 'renamed';
  if (xy === '??' || c.x === 'A') return 'added';
  if (c.x === 'D' || c.y === 'D') return 'deleted';
  return 'modified';
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const listOf = (items: string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

/** A first line for the commit: Add/Remove/Update, the scripts by name (up to three), then counts of the rest. */
export function suggestCommitMessage(changes: readonly GitChange[]): string {
  if (!changes.length) return '';
  const kinds = new Set(changes.map(changeKind));
  const verb = kinds.size === 1 && kinds.has('added') ? 'Add' : kinds.size === 1 && kinds.has('deleted') ? 'Remove' : 'Update';
  const base = (p: string) => p.slice(p.lastIndexOf('/') + 1);
  const scripts = changes.filter(c => c.path.startsWith('script/')).map(c => base(c.path));
  const count = (top: string) => changes.filter(c => c.path.startsWith(`${top}/`)).length;
  const assets = count('assets'), masters = count('masters'), locale = count('locale');
  const known = scripts.length + assets + masters + locale;
  const others = changes.filter(c => !/^(script|assets|masters|locale)\//.test(c.path)).map(c => c.path);
  const parts = [
    ...(scripts.length > 3 ? [plural(scripts.length, 'script')] : scripts),
    ...(assets ? [plural(assets, 'asset')] : []),
    ...(masters ? [plural(masters, 'PSD master')] : []),
    ...(locale ? [plural(locale, 'translation file')] : []),
    ...(others.length > 2 ? [plural(others.length, 'other file')] : others),
  ];
  return known + others.length ? `${verb} ${listOf(parts)}` : verb;
}

export interface GitFacts {
  changes: GitChange[];
  /** A merge, rebase, cherry-pick or revert the repository is in the middle of, or null. */
  operation: string | null;
  /** The checked-out branch, or null on a detached HEAD. */
  branch: string | null;
  /** Changed files that are PSDs or at least LFS_WARN_BYTES, with their size and whether Git LFS handles them. */
  large: { path: string; bytes: number; lfs: boolean }[];
  /** GIT_IGNORE_LINES folders git does not ignore yet. */
  unignored: string[];
}

const mb = (b: number) => `${(b / 1_048_576).toFixed(1)} MB`;

/** What stops Commit (blockers) and what the dialog shows before it (warnings). */
export function checkCommit(f: GitFacts): { blockers: string[]; warnings: string[] } {
  const blockers: string[] = [], warnings: string[] = [];
  if (f.operation) blockers.push(`The repository is in the middle of a ${f.operation}. Finish or abort it in your git tool first.`);
  const conflicts = f.changes.filter(c => changeKind(c) === 'conflict');
  if (conflicts.length) blockers.push(`${plural(conflicts.length, 'file')} with merge conflicts: ${listOf(conflicts.slice(0, 3).map(c => c.path))}${conflicts.length > 3 ? '...' : ''}. Resolve them in your git tool.`);
  if (!f.changes.length) blockers.push('Nothing to commit.');
  if (!f.branch) warnings.push('No branch is checked out (detached HEAD): a commit here is easy to lose. Switch to a branch in your git tool.');
  for (const l of f.large.filter(l => !l.lfs)) {
    warnings.push(l.bytes > HOST_LIMIT_BYTES
      ? `${l.path} is ${mb(l.bytes)} and not in Git LFS: GitHub and most hosts will refuse the push.`
      : `${l.path} (${mb(l.bytes)}) is not in Git LFS: every version stays in the history for good. Track it with "git lfs track".`);
  }
  if (f.unignored.length) warnings.push(`git does not ignore ${listOf(f.unignored)} yet: add ${f.unignored.length === 1 ? 'it' : 'them'} to .gitignore to keep exports and the trash out of the repository.`);
  return { blockers, warnings };
}
