// The online demo's service worker: the dev server, in the browser. Registered by the project list (online/index.html) at the
// site's root folder (sw.js there imports this module), it serves each project under p/<id>/ from IndexedDB:
//   p/<id>/                 the preview page              p/<id>/editor/       the editor
//   p/<id>/dist|vendor|docs the engine code and docs (passed to the network: the static files at the root)
//   p/<id>/assets|locale|masters|script/...   the project's files     p/<id>/project.zip   the whole project, to download
//   /api/... and /__events  the dev server's API and live-reload stream (online/routes.ts), for the project of the page asking
// The editor and preview fetch /api/... from the origin root; a service worker sees those requests too, wherever it is scoped.
// sw.js imports ag-psd's browser bundle (vendor/ag-psd/bundle.js, a UMD script that sets self.agPsd) before this module.

import { handleApi, type RouteContext } from './routes.js';
import { projectStore, getProject, putProject } from './store.js';
import { writeZip } from '../engine/src/index.js';

interface FetchEvent extends Event { request: Request; clientId: string; resultingClientId: string; respondWith(r: Promise<Response> | Response): void; waitUntil(p: Promise<unknown>): void }
interface Worker {
  registration: { scope: string };
  clients: { get(id: string): Promise<{ url: string } | undefined>; claim(): Promise<void> };
  skipWaiting(): Promise<void>;
  addEventListener(type: string, fn: (e: any) => void): void;
  agPsd?: { readPsd(b: Uint8Array, o: object): any; initializeCanvas(a: () => never, b: (w: number, h: number) => object): void };
}
const sw = self as unknown as Worker;
const scope = new URL(sw.registration.scope);

const psd = sw.agPsd;
// Pixel arrays only (useImageData), so ag-psd needs no canvas, as in tools/psd-convert.mjs.
psd?.initializeCanvas(() => { throw new Error('canvas is not available'); }, (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }));

const pipe = async (bytes: Uint8Array, stream: TransformStream<Uint8Array, Uint8Array>) =>
  new Uint8Array(await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream)).arrayBuffer());
const deflate = (b: Uint8Array) => pipe(b, new CompressionStream('deflate') as unknown as TransformStream<Uint8Array, Uint8Array>);
const deflateRaw = (b: Uint8Array) => pipe(b, new CompressionStream('deflate-raw') as unknown as TransformStream<Uint8Array, Uint8Array>);
const sha1 = async (b: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-1', b as BufferSource))].map(x => x.toString(16).padStart(2, '0')).join('');

const MIME: Record<string, string> = {
  '.json': 'application/json', '.vn': 'text/plain; charset=utf-8', '.src': 'application/json', '.png': 'image/png', '.webp': 'image/webp',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.avif': 'image/avif', '.gif': 'image/gif',
  '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.flac': 'audio/flac',
  '.webm': 'video/webm', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.ogv': 'video/ogg',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.psd': 'image/vnd.adobe.photoshop',
};
const mimeOf = (p: string) => MIME[/\.[^./]*$/.exec(p)?.[0].toLowerCase() ?? ''] ?? 'application/octet-stream';

// ---- live reload: the dev server's Server-Sent Events, per project, debounced like its file watcher ----
const streams = new Set<{ project: string; push(s: string): void }>();
const pending = new Map<string, number>();
function changed(project: string, type: string, file: string) {
  const k = `${project}\n${type}`;
  clearTimeout(pending.get(k));
  pending.set(k, setTimeout(() => {
    pending.delete(k);
    const msg = `data: ${JSON.stringify({ type, file })}\n\n`;
    for (const s of streams) if (s.project === project) s.push(msg);
  }, 120) as unknown as number);
}
function events(project: string): Response {
  let entry: { project: string; push(s: string): void };
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      entry = { project, push: s => { try { c.enqueue(enc.encode(s)); } catch { streams.delete(entry); } } };
      streams.add(entry);
      c.enqueue(enc.encode('retry: 500\n\n')); // the browser may stop an idle worker; EventSource then reconnects
    },
    cancel() { streams.delete(entry); },
  });
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
}

const context = (project: string): RouteContext => ({
  store: projectStore(project),
  changed: (type, file) => changed(project, type, file),
  readPsd: psd ? b => psd.readPsd(b, { useImageData: true, skipThumbnail: true, skipLinkedFilesData: true }) : undefined,
  deflate, sha1,
  log: line => console.warn(`[${project}] ${line}`),
});

/** `p/<id>/rest` under the scope -> { id, rest }. */
function inProject(url: URL): { id: string; rest: string } | null {
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return null;
  const m = /^p\/([\w-]+)(?:\/(.*))?$/.exec(url.pathname.slice(scope.pathname.length));
  return m ? { id: m[1], rest: decodeURIComponent(m[2] ?? '') } : null;
}

const notFound = (what = 'Not found') => new Response(what, { status: 404, headers: { 'Content-Type': 'text/plain' } });
const html = (text: string) => new Response(text, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });

async function serveProject(id: string, rest: string): Promise<Response> {
  if (!(await getProject(id))) return Response.redirect(new URL(`./?missing=${encodeURIComponent(id)}`, scope).href, 302);
  if (rest === '' || rest === 'index.html') return fetch(new URL('preview/index.html', scope));
  if (rest === 'editor') return Response.redirect(new URL(`p/${id}/editor/`, scope).href, 302);
  if (rest === 'editor/' || rest === 'editor/index.html') {
    const meta = await getProject(id);
    if (meta) void putProject({ ...meta, opened: Date.now() });
    // The page's code and Monaco from the root, so the editor's Monaco worker (a blob: worker) finds them without this worker.
    const page = await (await fetch(new URL('editor/index.html', scope))).text();
    return html(page.replaceAll('"../vendor/', `"${scope.href}vendor/`).replaceAll('"../dist/', `"${scope.href}dist/`));
  }
  if (/^(dist|vendor|docs)\//.test(rest)) return fetch(new URL(rest, scope));
  if (rest === 'editor/help.html' || rest === 'editor/help.css') return fetch(new URL(rest, scope)); // F1 help's own window
  if (rest === 'project.zip') return zip(id);
  if (/^(assets|locale|masters|script)\//.test(rest)) {
    const bytes = await projectStore(id).read(rest);
    return bytes ? new Response(bytes as BlobPart, { headers: { 'Content-Type': mimeOf(rest), 'Cache-Control': 'no-cache' } }) : notFound();
  }
  return notFound();
}

/** The project as a zip with the project folder at its root (open it with Marginalia Studio, or `vn dev` in it). */
async function zip(id: string): Promise<Response> {
  const store = projectStore(id);
  const files = (await store.list()).filter(f => !f.path.startsWith('.trash/'));
  const entries = await Promise.all(files.map(async f => ({ path: `${id}/${f.path}`, bytes: (await store.read(f.path)) ?? new Uint8Array(0), mtime: f.mtime })));
  const bytes = await writeZip(entries, deflateRaw);
  return new Response(bytes as BlobPart, { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${id}.zip"` } });
}

/** The project of the page that sent a request (/api and /__events are not under p/<id>/). */
async function clientProject(e: FetchEvent): Promise<string | null> {
  const id = e.clientId || e.resultingClientId;
  const client = id ? await sw.clients.get(id) : undefined;
  return client ? inProject(new URL(client.url))?.id ?? null : null;
}

sw.addEventListener('install', () => { void sw.skipWaiting(); });
sw.addEventListener('activate', (e: FetchEvent) => e.waitUntil(sw.clients.claim()));
sw.addEventListener('fetch', (e: FetchEvent) => {
  const url = new URL(e.request.url);
  if (url.origin !== scope.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/__events') {
    e.respondWith((async () => {
      const project = await clientProject(e);
      if (!project) return notFound('No project: open one from the project list');
      if (url.pathname === '/__events') return events(project);
      const req = e.request;
      const res = await handleApi(context(project), req.method, url, async () => new Uint8Array(await req.arrayBuffer()));
      return res ?? notFound();
    })());
    return;
  }
  const where = inProject(url);
  if (where) e.respondWith(serveProject(where.id, where.rest).catch(err => new Response(String(err), { status: 500 })));
});
