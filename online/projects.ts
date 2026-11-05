// The online demo's project list (online/index.html): registers the service worker (online/sw.ts) that serves the projects, and
// makes, imports, renames, duplicates and deletes projects in IndexedDB (online/store.ts). The editor opens at p/<id>/editor/.

import { newProjectFiles, templateAssets, TEMPLATES, DEFAULT_TEMPLATE, projectSlug, readZip, commonRoot } from '../engine/src/index.js';
import { confirmAsk, promptAsk } from '../editor/ask.js';
import { listProjects, putProject, deleteProject, freeId, projectStore, writeFiles, type ProjectMeta } from './store.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const listEl = $('list'), errorEl = $('error');
const enc = new TextEncoder(), dec = new TextDecoder();

/** seed/index.json (scripts/build-online.mjs): the engine version and the bundled games, their files under seed/<id>/. */
interface SeedGame { id: string; title: string; description: string; files: string[] }
interface Seed { engine: string; games: SeedGame[] }
let seed: Seed | null = null;
const loadSeed = async () => (seed ??= await (await fetch('seed/index.json', { cache: 'no-cache' })).json() as Seed);

const showError =(e: unknown) => { errorEl.textContent = e instanceof Error ? e.message : String(e); };
async function busy<T>(work: () => Promise<T>): Promise<T | undefined> {
  document.body.classList.add('busy');
  errorEl.textContent = '';
  try { return await work(); } catch (e) { showError(e); return undefined; } finally { document.body.classList.remove('busy'); }
}

// ---- the service worker ----
async function startWorker(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) { showError('This browser has no service workers (or they are off in a private window), so the editor cannot run here.'); return false; }
  try {
    await navigator.serviceWorker.register('sw.js', { type: 'module', scope: './' });
    await navigator.serviceWorker.ready;
    return true;
  } catch (e) {
    showError(`The editor's service worker did not start (${e instanceof Error ? e.message : e}). It needs a browser with module service workers: a current Chrome, Edge, Safari or Firefox.`);
    return false;
  }
}

// ---- making projects ----
const file = (path: string, text: string) => ({ path, bytes: enc.encode(text) });

async function create(title: string, files: { path: string; bytes: Uint8Array; mtime?: number }[], open: 'editor' | 'play' | false = 'editor') {
  const id = freeId(projectSlug(title), (await listProjects()).map(p => p.id));
  const now = Date.now();
  await writeFiles(id, files);
  await putProject({ id, title, created: now, opened: now });
  if (open === 'editor') location.assign(`p/${id}/editor/`);
  else if (open === 'play') location.assign(`p/${id}/`);
  else await render();
}

async function newFromGame(g: SeedGame, open: 'editor' | 'play' | false) {
  const files = await Promise.all(g.files.map(async path => {
    const r = await fetch(`seed/${g.id}/${path.split('/').map(encodeURIComponent).join('/')}`, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`could not load ${g.title}'s ${path}`);
    return { path, bytes: new Uint8Array(await r.arrayBuffer()) };
  }));
  await create(g.title, files, open);
}

async function newEmpty() {
  const title = $<HTMLInputElement>('title').value.trim();
  if (!title) { $('error').textContent = 'Give the new game a title first.'; return; }
  const s = await loadSeed();
  const template = document.querySelector<HTMLInputElement>('#template input:checked')?.value;
  const files = Object.entries(newProjectFiles({ title, engineVersion: s.engine, kind: 'studio', template })).map(([p, t]) => file(p, t));
  for (const { from, to } of templateAssets(template)) {
    const r = await fetch(`templates/assets/${from.split('/').map(encodeURIComponent).join('/')}`);
    if (!r.ok) throw new Error(`could not load the template asset ${from}`);
    files.push({ path: to, bytes: new Uint8Array(await r.arrayBuffer()) });
  }
  await create(title, files);
}

// A zip from the download here, from Marginalia Studio or of any project folder. What the editor never reads stays out.
const SKIP = /^(\.git|\.trash|node_modules|build|dist|release)(\/|$)/;

async function importZip(f: File) {
  const inflate = async (b: Uint8Array) => new Uint8Array(await new Response(new Blob([b as BlobPart]).stream()
    .pipeThrough(new DecompressionStream('deflate-raw') as unknown as TransformStream<Uint8Array, Uint8Array>)).arrayBuffer());
  const entries = await readZip(new Uint8Array(await f.arrayBuffer()), inflate);
  const root = commonRoot(entries.map(e => e.path));
  const files = entries.map(e => ({ ...e, path: e.path.slice(root.length) }))
    .filter(e => e.path && !SKIP.test(e.path) && e.path.split('/').every(s => s && s !== '.' && s !== '..'));
  if (!files.some(e => e.path === 'game.json' || e.path.startsWith('script/'))) throw new Error(`${f.name} has no game.json or script/ folder: it does not look like a Marginalia project.`);
  let title = (root.slice(0, -1) || f.name.replace(/\.zip$/i, '')).replace(/[-_]+/g, ' ');
  const game = files.find(e => e.path === 'game.json');
  try { const t = (JSON.parse(dec.decode(game?.bytes)) as { title?: unknown }).title; if (typeof t === 'string' && t.trim()) title = t.trim(); } catch { /* the folder name */ }
  await create(title, files, false);
}

async function duplicate(p: ProjectMeta) {
  const store = projectStore(p.id);
  const files = await Promise.all((await store.list()).filter(f => !f.path.startsWith('.trash/'))
    .map(async f => ({ path: f.path, bytes: (await store.read(f.path)) ?? new Uint8Array(0), mtime: f.mtime })));
  await create(`${p.title} (copy)`, files, false);
}

// ---- the list ----
const when = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const button = (label: string, run: () => unknown, title = '') => {
  const b = Object.assign(document.createElement('button'), { type: 'button', textContent: label, title });
  b.addEventListener('click', () => void run());
  return b;
};

async function render() {
  const projects = await listProjects();
  listEl.replaceChildren(...await Promise.all(projects.map(async p => {
    const li = document.createElement('li');
    const files = await projectStore(p.id).list();
    const scripts = files.filter(f => f.path.startsWith('script/') && f.path.endsWith('.vn')).length;
    const bytes = files.reduce((n, f) => n + f.size, 0);
    const what = document.createElement('div');
    what.className = 'what';
    what.append(
      Object.assign(document.createElement('div'), { className: 'title', textContent: p.title }),
      Object.assign(document.createElement('div'), { className: 'meta', textContent: `${p.id} · ${scripts} script${scripts === 1 ? '' : 's'}, ${(bytes / 1e6).toFixed(1)} MB · opened ${when(p.opened)}` }),
    );
    const actions = document.createElement('div');
    actions.className = 'row-actions';
    const open = button('Open', () => location.assign(`p/${p.id}/editor/`));
    open.classList.add('primary');
    actions.append(
      open,
      button('Play', () => window.open(`p/${p.id}/`, '_blank', 'noopener'), 'Play the game in a new tab'),
      button('Download .zip', () => location.assign(`p/${p.id}/project.zip`), 'The project folder as a zip: for Marginalia Studio, vn dev, or a backup'),
      button('Rename…', () => busy(async () => {
        const title = (await promptAsk('New name:', p.title, 'Rename'))?.trim();
        if (title && title !== p.title) { await putProject({ ...p, title }); await render(); }
      })),
      button('Duplicate', () => busy(() => duplicate(p))),
      button('Delete…', () => busy(async () => {
        if (!await confirmAsk(`Delete "${p.title}" from this browser? This cannot be undone. Download it as a zip first to keep a copy.`, 'Delete')) return;
        await deleteProject(p.id);
        await render();
      })),
    );
    li.append(what, actions);
    return li;
  })));
  const est = await navigator.storage?.estimate?.().catch(() => undefined);
  const persisted = await navigator.storage?.persisted?.().catch(() => false);
  $('storage').textContent = est?.usage !== undefined
    ? `This site uses ${(est.usage / 1e6).toFixed(1)} MB of browser storage${persisted ? ' (kept: the browser will not clear it on its own)' : ' (the browser may clear it when space runs low)'}.`
    : '';
}

async function main() {
  const missing = new URLSearchParams(location.search).get('missing');
  if (missing) $('note').textContent = `There is no project "${missing}" in this browser (it may have been deleted, or made in another browser).`;
  if (!(await startWorker())) { for (const b of document.querySelectorAll<HTMLButtonElement>('#actions button')) b.disabled = true; return; }
  void navigator.storage?.persist?.().catch(() => false);
  void loadSeed().then(s => {
    $('version').textContent = `engine ${s.engine}`;
    for (const g of s.games) {
      const card = Object.assign(document.createElement('div'), { className: 'game' });
      const play = button('Play', () => busy(() => newFromGame(g, 'play')), 'Add it to your projects and play it right away');
      play.classList.add('primary');
      const edit = button('Open in editor', () => busy(() => newFromGame(g, 'editor')), 'Add it to your projects and open it in the editor');
      const actions = Object.assign(document.createElement('div'), { className: 'game-actions' });
      actions.append(play, edit);
      card.append(Object.assign(document.createElement('strong'), { textContent: g.title }), Object.assign(document.createElement('small'), { textContent: g.description }), actions);
      $('games').append(card);
    }
  }, () => {});
  for (const t of TEMPLATES) {
    const radio = Object.assign(document.createElement('input'), { type: 'radio', name: 'template', value: t.id, checked: t.id === DEFAULT_TEMPLATE });
    const title = Object.assign(document.createElement('strong'), { textContent: t.title });
    const text = Object.assign(document.createElement('small'), { textContent: t.description });
    const card = document.createElement('label');
    card.append(radio, title, text);
    $('template').append(card);
  }
  $('newEmpty').addEventListener('click', () => void busy(newEmpty));
  const input = $<HTMLInputElement>('importFile');
  $('import').addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    input.value = '';
    if (f) void busy(() => importZip(f));
  });
  await render();
}

void main();
