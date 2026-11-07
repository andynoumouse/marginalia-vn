// Where a standalone studio's character folder lives: a folder the browser may read and write (File System Access API) or the
// folder Marginalia Studio's main process holds for the window (its IPC bridge, studio/preload.cjs). The page asks a store
// for the folder's file paths, reads the files it needs and writes rig.json (and nothing else) back.

export interface StoredFile { bytes: Blob; /** Modification time in ms. */ mtime: number }

export interface CharacterStore {
  /** The picked folder's own name. */
  name: string;
  /** Every file below the folder as '/'-separated paths; hidden folders and node_modules are not entered. */
  list(): Promise<string[]>;
  read(path: string): Promise<StoredFile>;
  /** Replace the text file at `path` (it must end in rig.json or sprite.json); folders are made as needed. */
  write(path: string, text: string): Promise<void>;
}

/** The most paths a folder walk collects: a whole game project is a lot of files, and a character is not among thousands. */
export const MAX_LISTED = 20_000;
const hiddenName = (name: string) => name.startsWith('.') || name === 'node_modules';
export const writable = (path: string) => /(^|\/)(rig|sprite)\.json$/.test(path) && !path.split('/').includes('..');

// ---- the browser: a directory handle from showDirectoryPicker ----
interface FileHandle { kind: 'file'; name: string; getFile(): Promise<File>; createWritable(): Promise<{ write(d: string): Promise<void>; close(): Promise<void> }> }
interface DirHandle {
  kind: 'directory'; name: string;
  values(): AsyncIterable<FileHandle | DirHandle>;
  getFileHandle(name: string, o?: { create: boolean }): Promise<FileHandle>;
  getDirectoryHandle(name: string, o?: { create: boolean }): Promise<DirHandle>;
}
export type DirectoryHandle = DirHandle;
type Picker = (o: { mode: 'readwrite' }) => Promise<DirHandle>;

/** The browser's folder picker, or undefined where there is none (Firefox, Safari). */
export const directoryPicker = (): Picker | undefined => (window as unknown as { showDirectoryPicker?: Picker }).showDirectoryPicker?.bind(window);

export function directoryStore(root: DirectoryHandle): CharacterStore {
  const folder = async (parts: string[], create = false) => {
    let dir = root;
    for (const part of parts) dir = await dir.getDirectoryHandle(part, { create });
    return dir;
  };
  return {
    name: root.name,
    async list() {
      const out: string[] = [];
      const walk = async (dir: DirHandle, prefix: string): Promise<void> => {
        for await (const e of dir.values()) {
          if (out.length >= MAX_LISTED) return;
          if (hiddenName(e.name)) continue;
          if (e.kind === 'directory') await walk(e, `${prefix}${e.name}/`); else out.push(prefix + e.name);
        }
      };
      await walk(root, '');
      return out;
    },
    async read(path) {
      const parts = path.split('/');
      const file = await (await (await folder(parts.slice(0, -1))).getFileHandle(parts[parts.length - 1])).getFile();
      return { bytes: file, mtime: file.lastModified };
    },
    async write(path, text) {
      if (!writable(path)) throw new Error(`${path} is not a file the studio writes`);
      const parts = path.split('/');
      const w = await (await (await folder(parts.slice(0, -1), true)).getFileHandle(parts[parts.length - 1], { create: true })).createWritable();
      await w.write(text);
      await w.close();
    },
  };
}

// ---- Marginalia Studio: the folder its main process holds for this window ----
/** studio/preload.cjs `vnStudio.character`: the main process shows the folder dialog and reads and writes inside the one folder it chose. */
export interface StudioCharacterBridge {
  /** The folder this window was opened on, or null. */
  folder(): Promise<{ name: string } | null>;
  /** Show the native folder dialog; the chosen folder becomes the window's. */
  pick(title: string): Promise<{ name: string } | null>;
  list(): Promise<string[]>;
  read(path: string): Promise<{ bytes: Uint8Array; mtime: number }>;
  write(path: string, text: string): Promise<void>;
}
export const studioBridge = (): StudioCharacterBridge | undefined => (window as unknown as { vnStudio?: { character?: StudioCharacterBridge } }).vnStudio?.character;

export function bridgeStore(bridge: StudioCharacterBridge, name: string): CharacterStore {
  return {
    name,
    list: () => bridge.list(),
    async read(path) {
      const { bytes, mtime } = await bridge.read(path);
      return { bytes: new Blob([bytes as BlobPart]), mtime };
    },
    write: (path, text) => bridge.write(path, text),
  };
}
