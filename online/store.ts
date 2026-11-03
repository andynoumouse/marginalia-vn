// The online demo's projects in IndexedDB, shared by the project list (online/projects.ts) and the service worker (online/sw.ts).
//   projects   { id, title, created, opened }
//   files      [project, path] -> { project, path, mtime, size }    the listing, read without the bytes
//   blobs      [project, path] -> Uint8Array
// What a page stores here lives only in this browser (and the browser may clear it under storage pressure, unless
// navigator.storage.persist() was granted): the project list offers a zip download for that reason.

import type { FileStore, StoredFile } from './routes.js';

export interface ProjectMeta { id: string; title: string; created: number; opened: number }

const DB = 'marginalia-online';
let opening: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      d.createObjectStore('projects', { keyPath: 'id' });
      d.createObjectStore('files', { keyPath: ['project', 'path'] }).createIndex('project', 'project');
      d.createObjectStore('blobs');
    };
    req.onsuccess = () => {
      req.result.onversionchange = () => { req.result.close(); opening = null; };
      resolve(req.result);
    };
    req.onerror = () => { opening = null; reject(req.error); };
  });
  return opening;
}

const done = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
});
const result = <T>(req: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

export async function listProjects(): Promise<ProjectMeta[]> {
  const tx = (await db()).transaction('projects');
  const all = await result(tx.objectStore('projects').getAll() as IDBRequest<ProjectMeta[]>);
  return all.sort((a, b) => b.opened - a.opened);
}

export async function getProject(id: string): Promise<ProjectMeta | undefined> {
  return result((await db()).transaction('projects').objectStore('projects').get(id) as IDBRequest<ProjectMeta | undefined>);
}

export async function putProject(meta: ProjectMeta): Promise<void> {
  const tx = (await db()).transaction('projects', 'readwrite');
  tx.objectStore('projects').put(meta);
  await done(tx);
}

/** Deletes a project and all its files. */
export async function deleteProject(id: string): Promise<void> {
  const keys = (await projectStore(id).list()).map(f => [id, f.path]);
  const tx = (await db()).transaction(['projects', 'files', 'blobs'], 'readwrite');
  tx.objectStore('projects').delete(id);
  for (const k of keys) { tx.objectStore('files').delete(k); tx.objectStore('blobs').delete(k); }
  await done(tx);
}

/** A new id, unique among `taken`: the title's slug, then -2, -3... */
export function freeId(slug: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(slug)) return slug;
  for (let n = 2; ; n++) if (!used.has(`${slug}-${n}`)) return `${slug}-${n}`;
}

/** One project's files as the routes' FileStore. */
export function projectStore(project: string): FileStore {
  const key = (path: string) => [project, path];
  return {
    async list(): Promise<StoredFile[]> {
      const tx = (await db()).transaction('files');
      const rows = await result(tx.objectStore('files').index('project').getAll(project) as IDBRequest<(StoredFile & { project: string })[]>);
      return rows.map(({ path, mtime, size }) => ({ path, mtime, size }));
    },
    async read(path) {
      const v = await result((await db()).transaction('blobs').objectStore('blobs').get(key(path)));
      return v instanceof Uint8Array ? v : v ? new Uint8Array(v as ArrayBuffer) : null;
    },
    async write(path, bytes) {
      const tx = (await db()).transaction(['files', 'blobs'], 'readwrite');
      tx.objectStore('files').put({ project, path, mtime: Date.now(), size: bytes.length });
      tx.objectStore('blobs').put(bytes, key(path));
      await done(tx);
    },
    async remove(paths) {
      const tx = (await db()).transaction(['files', 'blobs'], 'readwrite');
      for (const p of paths) { tx.objectStore('files').delete(key(p)); tx.objectStore('blobs').delete(key(p)); }
      await done(tx);
    },
    async move(pairs) {
      if (!pairs.length) return;
      const tx = (await db()).transaction(['files', 'blobs'], 'readwrite');
      const files = tx.objectStore('files'), blobs = tx.objectStore('blobs');
      // Read everything first, then delete and write, so a rename that swaps or nests paths cannot lose a file.
      const rows = await Promise.all(pairs.map(async ([from]) => [await result(files.get(key(from))), await result(blobs.get(key(from)))] as const));
      for (const [from] of pairs) { files.delete(key(from)); blobs.delete(key(from)); }
      pairs.forEach(([, to], i) => {
        const [row, bytes] = rows[i];
        if (!row) return;
        files.put({ ...(row as object), project, path: to });
        blobs.put(bytes, key(to));
      });
      await done(tx);
    },
  };
}

/** Writes many files in one transaction (a new project, an import). */
export async function writeFiles(project: string, entries: readonly { path: string; bytes: Uint8Array; mtime?: number }[]): Promise<void> {
  const tx = (await db()).transaction(['files', 'blobs'], 'readwrite');
  for (const e of entries) {
    tx.objectStore('files').put({ project, path: e.path, mtime: e.mtime ?? Date.now(), size: e.bytes.length });
    tx.objectStore('blobs').put(e.bytes, [project, e.path]);
  }
  await done(tx);
}
