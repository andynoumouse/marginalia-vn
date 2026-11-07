// localStorage keys, namespaced per game (game.json "id", else a slug of the title): web portals such as
// itch.io serve every HTML game from one origin, so saves and settings must not collide.
// In the desktop build the same keys are kept as files (see DesktopBridge).

let ns = 'vn.game.';

export function setGameId(id: string) {
  ns = `vn.${id}.`;
}

/** Stable id from game.json: its "id", else the title as a slug. */
export function gameId(game: { id?: string; title?: string }): string {
  const raw = game.id ?? game.title ?? 'game';
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'game';
}

/** Where values live. Keys are full, namespace included. */
export interface Backend {
  get(key: string): string | null;
  set(key: string, value: string): boolean;
  remove(key: string): void;
  keys(): string[];
}

const browserBackend: Backend = {
  get: key => localStorage.getItem(key),
  set: (key, value) => { localStorage.setItem(key, value); return true; },
  remove: key => localStorage.removeItem(key),
  keys: () => {
    const out: string[] = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k !== null) out.push(k); }
    return out;
  },
};

/** What the Electron preload exposes as window.vnDesktop (tools/desktop/preload.cjs). */
export interface DesktopBridge {
  /** Every stored value, read once at startup. */
  load(): Record<string, string>;
  /** Written through to a file by the main process. */
  set(key: string, value: string): void;
  remove(key: string): void;
}

/** Synchronous view over a desktop bridge: reads come from memory, writes also go to the files. */
export function desktopBackend(bridge: DesktopBridge): Backend {
  const data = new Map(Object.entries(bridge.load()));
  return {
    get: key => data.get(key) ?? null,
    set: (key, value) => { data.set(key, value); bridge.set(key, value); return true; },
    remove: key => { data.delete(key); bridge.remove(key); },
    keys: () => [...data.keys()],
  };
}

let backend: Backend = browserBackend;
const bridge = (globalThis as { vnDesktop?: DesktopBridge }).vnDesktop;
if (bridge) backend = desktopBackend(bridge);

export function getItem(key: string): string | null {
  try { return backend.get(ns + key); } catch { return null; }
}

/** Returns false when storage is unavailable or full. */
export function setItem(key: string, value: string): boolean {
  try { return backend.set(ns + key, value); } catch { return false; }
}

export function removeItem(key: string) {
  try { backend.remove(ns + key); } catch { /* storage unavailable */ }
}

/** All keys of this game that start with `prefix` (without the namespace). */
export function keysWith(prefix: string): string[] {
  try { return backend.keys().filter(k => k.startsWith(ns + prefix)).map(k => k.slice(ns.length)); } catch { return []; }
}
