// The online demo's /api: the dev server's file routes (preview/dev-server.mjs) on a FileStore instead of the disk, so the
// editor and preview run unchanged from a static host. online/sw.ts answers with these inside a service worker, over an
// IndexedDB store (online/store.ts); the tests use a Map. What needs the machine (git, the file manager, node tools other
// than the art converter) answers like a server without it, and /api/capabilities tells the editor to hide it.

import {
  projectFromListing, projectTextFiles, editorExtras, planMove, checkProjectPath, planDrop, trashId, isTrashId, readManifest,
  planPurge, MANIFEST, convertMaster, masterKind, previousParts, stageSize, prefixFrom,
  type Capabilities, type TrashEntry, type TrashAction, type Psd, type Deflate,
} from '../engine/src/index.js';

export interface StoredFile { path: string; mtime: number; size: number }

/** One project's files, by project-relative '/'-separated path. Folders exist through their files (an empty one holds a .gitkeep). */
export interface FileStore {
  list(): Promise<StoredFile[]>;
  read(path: string): Promise<Uint8Array | null>;
  write(path: string, bytes: Uint8Array): Promise<void>;
  remove(paths: readonly string[]): Promise<void>;
  /** Moves files (not folders): each `[from, to]`. */
  move(pairs: readonly (readonly [string, string])[]): Promise<void>;
}

export interface RouteContext {
  store: FileStore;
  /** A file changed (the dev server's live-reload event): 'content' for script/, locale/, assets/ and game.json, else 'masters'. */
  changed(type: 'content' | 'masters', file: string): void;
  /** ag-psd's readPsd with pixel arrays; without it PSDs are stored but not converted. */
  readPsd?(bytes: Uint8Array): Psd;
  deflate: Deflate;
  sha1(bytes: Uint8Array): Promise<string>;
  now?(): Date;
  log?(line: string): void;
}

export const ONLINE_CAPABILITIES: Capabilities = { git: false, reveal: false, tasks: ['art'], buildCheck: false, online: true };

const enc = new TextEncoder(), dec = new TextDecoder();
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const text = (body: string, status: number) => new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
const OK = () => json({ ok: true });
const forbidden = () => text('Forbidden', 403);
const VOICE_AUDIO = /\.(ogg|mp3|wav|m4a|flac|opus)$/i;
const TRASH = '.trash';
const ext = (s: string) => /\.[^./]*$/.exec(s)?.[0].toLowerCase() ?? '';
/** No empty, '.' or '..' segments, no backslashes: what path.resolve would have normalized away on disk. */
const clean = (p: string) => p !== '' && !p.includes('\\') && p.split('/').every(s => s !== '' && s !== '.' && s !== '..');
const isUnder = (p: string, dir: string) => p === dir || p.startsWith(`${dir}/`);
const changeType = (p: string) => (p.startsWith('masters/') ? 'masters' : 'content') as 'content' | 'masters';

/** Every folder that holds a file, without the files' own names ("script/a/b.vn" -> "script", "script/a"). */
export function foldersOf(paths: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const p of paths) {
    const parts = p.split('/');
    for (let i = 1; i < parts.length; i++) out.add(parts.slice(0, i).join('/'));
  }
  return [...out].sort();
}

/** The project as /api/project serves it to the editor (the game's data plus the masters and asset folders). */
export async function readProject(store: FileStore, warn: (m: string) => void = () => {}) {
  const all = (await store.list()).filter(f => !isUnder(f.path, TRASH));
  const files = all.filter(f => f.path === 'game.json' || /^(script|locale|assets)\//.test(f.path));
  const texts = new Map<string, string>();
  await Promise.all(projectTextFiles(files.map(f => f.path)).map(async p => {
    const b = await store.read(p);
    if (b) texts.set(p, dec.decode(b));
  }));
  const dirs = foldersOf(all.map(f => f.path)).filter(d => /^(script|assets)\//.test(d));
  return {
    ...projectFromListing({ files, dirs, text: p => texts.get(p) ?? null, warn }),
    ...editorExtras(all.map(f => f.path), dirs),
  };
}

export async function handleApi(ctx: RouteContext, method: string, url: URL, body: () => Promise<Uint8Array>): Promise<Response | null> {
  const r = new Routes(ctx);
  const q = (k: string) => url.searchParams.get(k);
  const route = `${method} ${url.pathname}`;
  try {
    switch (route) {
      case 'GET /api/capabilities': return json(ONLINE_CAPABILITIES);
      case 'GET /api/project': return json(await readProject(ctx.store, m => ctx.log?.(m)));
      case 'PUT /api/script': return await r.saveScript(q('file') ?? '', body);
      case 'PUT /api/folder': return await r.saveFolder(q('dir') ?? '', q('in') === 'assets');
      case 'POST /api/move': return await r.move(q('from') ?? '', q('to') ?? '', q('dir') === '1');
      case 'POST /api/delete': return await r.delete(q('path') ?? '', q('dir') === '1');
      case 'GET /api/trash': return json(await r.readTrash());
      case 'POST /api/trash/restore': return await r.restore(q('id') ?? '');
      case 'POST /api/trash/empty': return await r.emptyTrash(q('id'));
      case 'GET /api/git': return json({ repo: false, git: false });
      case 'PUT /api/game': return await r.saveJson('game.json', body);
      case 'GET /api/locales': return json(await r.readLocales());
      case 'PUT /api/locale': return LOCALE.test(q('file') ?? '') ? await r.saveJson(`locale/${q('file')}`, body) : forbidden();
      case 'GET /api/voice': return json(await r.readVoice());
      case 'PUT /api/voice': return await r.saveVoice(body);
      case 'PUT /api/rig': return await r.saveRig(q('char') ?? '', body);
      case 'PUT /api/theme': return await r.saveTheme(q('name') ?? '', body, q('ext') === 'css');
      case 'PUT /api/asset': return await r.saveAsset(url.searchParams, body);
      case 'POST /api/task': return q('name') === 'art' ? await r.convertAll() : forbidden();
    }
    if (url.pathname.startsWith('/api/')) return forbidden(); // git commit, reveal/open, build checks: not here
    return null;
  } catch (e) { return text(String((e as Error).message), 500); }
}

const LOCALE = /^[\w\-]+\.(json|src)$/;

class Routes {
  constructor(private ctx: RouteContext) {}
  private get store() { return this.ctx.store; }

  private async write(path: string, bytes: Uint8Array) {
    await this.store.write(path, bytes);
    this.ctx.changed(changeType(path), path);
  }
  private async paths() { return (await this.store.list()).map(f => f.path); }
  /** A file at `rel` (dir false), or a folder holding files (dir true). */
  private async isKind(rel: string, dir: boolean) {
    const all = await this.paths();
    return dir ? all.some(p => p.startsWith(`${rel}/`)) : all.includes(rel);
  }
  /** After files left, keep the folders they were in (as on disk) with a .gitkeep where nothing else is left. */
  private async keepFolders(gone: readonly string[]) {
    const all = await this.paths();
    for (const dir of foldersOf(gone)) {
      if (isUnder(dir, TRASH) || !dir.includes('/') && !['script', 'locale', 'assets', 'masters'].includes(dir)) continue;
      if (!all.some(p => p.startsWith(`${dir}/`))) await this.store.write(`${dir}/.gitkeep`, new Uint8Array(0));
    }
  }

  async saveScript(file: string, body: () => Promise<Uint8Array>) {
    if (!/^[\w\-./]+\.vn$/.test(file) || !clean(file)) return forbidden();
    await this.write(`script/${file}`, await body());
    return OK();
  }

  async saveFolder(dir: string, inAssets: boolean) {
    if (!(inAssets ? /^[\w\-]+$/ : /^[\w\-./]+$/).test(dir) || !clean(dir)) return forbidden();
    const target = `${inAssets ? 'assets' : 'script'}/${dir}`;
    if (!(await this.isKind(target, true))) await this.write(`${target}/.gitkeep`, new Uint8Array(0));
    return OK();
  }

  async saveJson(path: string, body: () => Promise<Uint8Array>) {
    const bytes = await body();
    try { JSON.parse(dec.decode(bytes)); } catch (e) { return text(`Invalid JSON: ${(e as Error).message}`, 400); }
    await this.write(path, bytes);
    return OK();
  }

  async saveRig(char: string, body: () => Promise<Uint8Array>) {
    if (!/^[\w\-]+$/.test(char) || !(await this.isKind(`assets/char/${char}`, true))) return forbidden();
    return this.saveJson(`assets/char/${char}/rig.json`, body);
  }

  async saveTheme(name: string, body: () => Promise<Uint8Array>, css = false) {
    if (!/^[\w\-]+$/.test(name)) return forbidden();
    if (css) { await this.write(`themes/${name}.css`, await body()); return OK(); }
    return this.saveJson(`themes/${name}.json`, body);
  }

  async move(from: string, to: string, dir: boolean) {
    const plan = planMove(from, to, dir);
    if ('error' in plan) return text(plan.error, 400);
    if (!(await this.isKind(from, dir))) return text(`${from} not found`, 404);
    const all = await this.paths();
    const caseOnly = from.toLowerCase() === plan.to.toLowerCase(); // a case-only rename is fine
    if (!caseOnly && all.some(p => isUnder(p, plan.to))) return text(`${plan.to} exists`, 409);
    const pairs = all.filter(p => isUnder(p, from)).map(p => [p, plan.to + p.slice(from.length)] as const);
    await this.store.move(pairs);
    await this.keepFolders(pairs.map(p => p[0]));
    for (const [a, b] of pairs) { this.ctx.changed(changeType(a), a); this.ctx.changed(changeType(b), b); }
    return json({ ok: true, to: plan.to });
  }

  async delete(rel: string, dir: boolean) {
    const bad = checkProjectPath(rel);
    if (bad) return text(bad, 400);
    if (!(await this.isKind(rel, dir))) return text(`${rel} not found`, 404);
    return json({ ok: true, trash: await this.toTrash([rel], 'delete') });
  }

  // ---- project trash: .trash/<id>/<path> plus .trash/<id>/manifest.json, as the dev server keeps it on disk ----
  async readTrash(): Promise<TrashEntry[]> {
    const files = (await this.store.list()).filter(f => isUnder(f.path, TRASH));
    const ids = [...new Set(files.map(f => f.path.split('/')[1]).filter(isTrashId))];
    const out: TrashEntry[] = [];
    for (const id of ids) {
      const raw = await this.store.read(`${TRASH}/${id}/${MANIFEST}`);
      const m = raw && readManifest(dec.decode(raw));
      if (m) out.push({ id, ...m, bytes: files.filter(f => f.path.startsWith(`${TRASH}/${id}/`)).reduce((n, f) => n + f.size, 0) });
    }
    return out.sort((a, b) => b.time.localeCompare(a.time) || b.id.localeCompare(a.id)); // newest first
  }

  private async removeEntries(ids: readonly string[]) {
    const all = await this.paths();
    await this.store.remove(all.filter(p => ids.some(id => p.startsWith(`${TRASH}/${id}/`))));
  }

  /** Moves project-relative `rels` (files or folders) into a new trash entry; returns its id. */
  async toTrash(rels: readonly string[], action: TrashAction, keep?: string): Promise<string> {
    const now = this.ctx.now?.() ?? new Date();
    const all = await this.paths();
    const taken = all.filter(p => isUnder(p, TRASH)).map(p => p.split('/')[1]);
    const id = trashId(now, taken);
    const pairs = all.filter(p => rels.some(r => isUnder(p, r))).map(p => [p, `${TRASH}/${id}/${p}`] as const);
    await this.store.move(pairs);
    await this.store.write(`${TRASH}/${id}/${MANIFEST}`, enc.encode(JSON.stringify({ action, paths: [...rels], time: now.toISOString() }, null, 2)));
    await this.keepFolders(pairs.map(p => p[0]));
    for (const [p] of pairs) this.ctx.changed(changeType(p), p);
    const purge = planPurge((await this.readTrash()).filter(e => e.id !== keep && e.id !== id), now.getTime());
    if (purge.length) await this.removeEntries(purge);
    return id;
  }

  async restore(id: string) {
    const entry = (await this.readTrash()).find(e => e.id === id);
    if (!entry) return text(`${id || '(no id)'} is not in the trash`, 404);
    const all = await this.paths();
    const inTheWay = entry.paths.filter(rel => all.some(p => isUnder(p, rel)));
    const aside = inTheWay.length ? await this.toTrash(inTheWay, 'restore', id) : null;
    const prefix = `${TRASH}/${id}/`;
    const pairs = (await this.paths()).filter(p => p.startsWith(prefix) && p !== prefix + MANIFEST).map(p => [p, p.slice(prefix.length)] as const);
    await this.store.move(pairs);
    await this.removeEntries([id]);
    for (const [, p] of pairs) this.ctx.changed(changeType(p), p);
    return json({ ok: true, paths: entry.paths, aside });
  }

  async emptyTrash(one: string | null) {
    if (one !== null && !isTrashId(one)) return text('Not a trash entry', 400);
    const ids = (await this.readTrash()).map(e => e.id).filter(id => one === null || id === one);
    await this.removeEntries(ids);
    return json({ ok: true, removed: ids.length });
  }

  // ---- locales and voice ----
  async readLocales() {
    const out: Record<string, string> = {};
    for (const p of await this.paths()) {
      const name = /^locale\/([^/]+)$/.exec(p)?.[1];
      if (!name || !LOCALE.test(name)) continue;
      const b = await this.store.read(p);
      if (b) out[p] = dec.decode(b);
    }
    return out;
  }

  /** The take per recording name directly under assets/voice/ (the first by file name). */
  private async voiceFiles() {
    const files: Record<string, string> = {};
    for (const p of (await this.paths()).sort()) {
      const f = /^assets\/voice\/([^/]+)$/.exec(p)?.[1];
      if (!f || !VOICE_AUDIO.test(f)) continue;
      const name = f.replace(VOICE_AUDIO, '');
      if (!(name in files)) files[name] = f;
    }
    return files;
  }

  async readVoice() {
    const files = await this.voiceFiles(), recordings: Record<string, string> = {};
    for (const [name, f] of Object.entries(files)) {
      const b = await this.store.read(`assets/voice/${f}`);
      if (b) recordings[name] = await this.ctx.sha1(b);
    }
    let lock = {};
    try { lock = JSON.parse(dec.decode((await this.store.read('voice.lock.json')) ?? enc.encode('{}'))); } catch { /* none yet */ }
    return { recordings, files, lock };
  }

  async saveVoice(body: () => Promise<Uint8Array>) {
    let lock: unknown;
    try { lock = JSON.parse(dec.decode(await body())); } catch { return text('Not a voice lock', 400); }
    if (!lock || typeof lock !== 'object' || Array.isArray(lock)
      || Object.values(lock).some(e => typeof e?.sum !== 'string' || typeof e?.text !== 'string')) return text('Not a voice lock', 400);
    await this.store.write('voice.lock.json', enc.encode(JSON.stringify(lock, null, 2) + '\n'));
    return OK();
  }

  // ---- assets: a drop, a Replace, or a voice take (see saveAsset in preview/dev-server.mjs) ----
  async saveAsset(q: URLSearchParams, body: () => Promise<Uint8Array>) {
    const voice = q.get('voice');
    const replacing = voice === null ? q.get('replace') : null;
    let dest: string, replaceVoice = false;
    if (replacing !== null) {
      const bad = checkProjectPath(replacing) ?? (replacing.startsWith('script/') ? 'replace assets and masters only' : null)
        ?? (ext(replacing) !== ext(q.get('name') ?? '') ? `pick a ${ext(replacing) || 'same-type'} file` : null);
      if (bad) return text(bad, 400);
      if (!(await this.isKind(replacing, false))) return text(`${replacing} not found`, 404);
      dest = replacing;
    } else if (voice !== null) {
      const e = VOICE_AUDIO.exec(q.get('name') ?? '')?.[0].toLowerCase();
      if (!/^[\w\-]+(\.[\w\-]+)?$/.test(voice) || !e) return text('Not a voice recording name', 400);
      dest = `assets/voice/${voice}${e}`;
      replaceVoice = q.get('replace') === '1';
    } else {
      const plan = planDrop(q.get('name') ?? '', q.get('folder') ?? '');
      if ('error' in plan) return text(plan.error, 400);
      dest = plan.dest;
    }
    if (!clean(dest)) return text('Bad path', 400);
    const all = await this.paths();
    // Takes of the same recording under another extension would make the name ambiguous (the first by file name wins).
    const siblings = voice === null ? [] : all.filter(p => /^assets\/voice\/[^/]+$/.test(p) && VOICE_AUDIO.test(p) && p.slice(13).replace(VOICE_AUDIO, '') === voice).sort();
    if (replacing === null && (voice === null ? all.includes(dest) : siblings.length && !replaceVoice)) {
      return json({ dest: voice === null ? dest : siblings[0] }, 409);
    }
    const bytes = await body();
    const old = replacing !== null ? [replacing] : siblings;
    const trash = old.length ? await this.toTrash(old, 'replace') : undefined;
    await this.write(dest, bytes);
    const art = dest.startsWith('masters/') ? await this.convert(dest.slice('masters/'.length)) : undefined;
    return json({ ok: true, dest, trash, ...(art ? { art } : {}), ...(voice === null ? {} : { sum: await this.ctx.sha1(bytes) }) });
  }

  // ---- art: the PSD converter (engine/src/psd.ts) on one master, or all of them ----
  /** Converts `master` (relative to masters/); returns the log line. */
  async convert(master: string): Promise<string> {
    const what = masterKind(master);
    if (!what) return '';
    if (!this.ctx.readPsd) return `masters/${master}: the PSD converter is not loaded`;
    const t0 = Date.now(), warnings: string[] = [];
    try {
      const bytes = await this.store.read(`masters/${master}`);
      if (!bytes) throw new Error('not found');
      let game: unknown = {};
      try { game = JSON.parse(dec.decode((await this.store.read('game.json')) ?? enc.encode('{}'))); } catch { /* defaults */ }
      const out = await convertMaster(master, this.ctx.readPsd(bytes), {
        stage: stageSize(game as Parameters<typeof stageSize>[0]), prefix: prefixFrom(game), deflate: this.ctx.deflate,
        warn: m => { if (!warnings.includes(m)) warnings.push(m); },
      });
      if (what.kind === 'char') { // clear what the previous conversion wrote (and only that)
        const old = await this.store.read(`assets/char/${what.name}/sprite.json`);
        const stale = previousParts(what.name, old && dec.decode(old)).map(f => `assets/${f}`);
        if (stale.length) await this.store.remove(stale);
      }
      for (const f of out.files) await this.write(`assets/${f.path}`, f.bytes);
      const line = `masters/${master} -> assets/${what.kind === 'char' ? `char/${what.name}` : out.files[0].path} (${out.info}, ${Date.now() - t0} ms)`;
      return [line, ...warnings.map(w => `  masters/${master}: ${w}`)].join('\n');
    } catch (e) { return `masters/${master}: ${(e as Error).message}`; }
  }

  async convertAll() {
    const masters = (await this.paths()).filter(p => masterKind(p.replace(/^masters\//, '')) && p.startsWith('masters/')).sort();
    const lines: string[] = [];
    let ok = true;
    for (const m of masters) {
      const line = await this.convert(m.slice('masters/'.length));
      if (!line.includes(' -> ')) ok = false;
      lines.push(line);
    }
    if (!masters.length) lines.push('No PSDs in masters/bg, masters/char or masters/ui.');
    const ndjson = `${JSON.stringify({ out: lines.join('\n') + '\n' })}\n${JSON.stringify({ ok })}\n`;
    return new Response(ndjson, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' } });
  }
}
