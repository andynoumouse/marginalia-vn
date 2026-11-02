/**
 * The project trash: what the editor's Files panel deletes, and what Replace overwrites, moves to `.trash/<id>/` in the project
 * folder instead of being lost. Each entry holds the paths at their project-relative places plus a `manifest.json`, so Restore
 * puts them back. The dev server does the moving; these decide the names, read the manifests and pick what to purge.
 */

import { checkProjectPath } from './file-ops.js';
import { formatBytes } from './residency.js';

export const TRASH_DIR = '.trash';
export const MANIFEST = 'manifest.json';
/** Entries older than this, then the oldest beyond the size cap, are deleted for good (the newest entry always stays). */
export const TRASH_LIMITS = { maxAgeDays: 30, maxBytes: 2_000_000_000 };

/** `delete` from the Files panel, `replace` (the old file before Replace or a new voice take), `restore` (what a restore pushed aside). */
export type TrashAction = 'delete' | 'replace' | 'restore';
export interface TrashManifest { action: TrashAction; paths: string[]; time: string }
export interface TrashEntry extends TrashManifest { id: string; bytes: number }

const pad = (n: number) => String(n).padStart(2, '0');

/** A new entry's folder name: the UTC time (so names sort by age), with -2, -3... when one made the same second exists. */
export function trashId(now: Date, taken: Iterable<string>): string {
  const base = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}_${pad(now.getUTCHours())}-${pad(now.getUTCMinutes())}-${pad(now.getUTCSeconds())}`;
  const used = new Set(taken);
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  return id;
}

/** Whether `id` is an entry folder name (anything else under .trash/ is left alone). */
export const isTrashId = (id: string) => /^\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d(-\d+)?$/.test(id);

/**
 * A manifest read from disk, or null when it is not one. Its paths must be ones the Files panel could have removed, so a
 * hand-edited manifest can never make Restore write outside script/, assets/ or masters/.
 */
export function readManifest(text: string): TrashManifest | null {
  let m: unknown;
  try { m = JSON.parse(text); } catch { return null; }
  if (!m || typeof m !== 'object') return null;
  const { action, paths, time } = m as Record<string, unknown>;
  if (!['delete', 'replace', 'restore'].includes(action as string) || typeof time !== 'string') return null;
  if (!Array.isArray(paths) || !paths.length || paths.some(p => typeof p !== 'string' || checkProjectPath(p) !== null)) return null;
  return { action: action as TrashAction, paths: paths as string[], time };
}

/** Ids of the entries to delete for good: older than `maxAgeDays`, then the oldest until the rest fit in `maxBytes`. */
export function planPurge(entries: readonly TrashEntry[], now: number, limits = TRASH_LIMITS): string[] {
  const sorted = [...entries].sort((a, b) => a.id.localeCompare(b.id)); // oldest first
  const newest = sorted.pop();
  if (!newest) return [];
  const cutoff = now - limits.maxAgeDays * 86_400_000;
  const out: string[] = [];
  let bytes = newest.bytes + sorted.reduce((n, e) => n + e.bytes, 0);
  for (const e of sorted) {
    const t = Date.parse(e.time);
    if ((Number.isFinite(t) && t < cutoff) || bytes > limits.maxBytes) { out.push(e.id); bytes -= e.bytes; }
  }
  return out;
}

const ago = (ms: number) => {
  const m = Math.round(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
};

/** One line for the Restore from Trash list: what happened to which paths, and when. */
export function describeTrashEntry(e: TrashEntry, now: number): { label: string; detail: string } {
  const verb = e.action === 'replace' ? 'replaced' : e.action === 'restore' ? 'pushed aside by a restore' : 'deleted';
  const what = e.paths.length === 1 ? e.paths[0] : `${e.paths[0]} and ${e.paths.length - 1} more`;
  const t = Date.parse(e.time);
  return { label: what, detail: `${verb} ${Number.isFinite(t) ? ago(now - t) : ''}, ${formatBytes(e.bytes)}`.replace(' ,', ',') };
}
