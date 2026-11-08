// studio.html: the animation studio with no game project. Open a character folder (the PSD converter's output with or without a
// rig.json, or one image per pose), edit it in Model and Animate modes, save rig.json back into the folder and export a movie.
// This page is the studio's second host (the first is the editor, editor.ts): it gives the studio what the folder holds through
// the same StudioHost, with the game side left out: no scripts, no compiler, no game.json, no /api routes. The stage page
// (preview/index.html in studio mode, `hosted`) gets its project from here by postMessage instead of from the dev server.

import {
  rigFile, scanFolder, standaloneChar, studioDocOf, studioWrites, writeRigText,
  type CharacterOption, type StandaloneChar, type StandaloneFile,
} from '../engine/src/index.js';
import { AnimStudio, type StageProject, type StudioHost } from './anim-studio.js';
import { bridgeStore, directoryPicker, directoryStore, studioBridge, type CharacterStore } from './character-store.js';
import { manifestHost } from './studio-host.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const IMAGE = /\.(png|webp|jpe?g|avif)$/i;
const MIME: Record<string, string> = { png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', avif: 'image/avif' };
const aborted = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

const openBtn = $<HTMLButtonElement>('open'), statusEl = $('status'), choose = $('choose'), hint = $('hint');
const studio = new AnimStudio(document.body);
const bridge = studioBridge();
/** What the page holds for the open character: the URL of each of its files (by path under its folder), kept until another opens. */
let urls = new Map<string, string>();

function say(text: string, bad = false) {
  statusEl.textContent = text;
  if (bad) statusEl.dataset.bad = ''; else delete statusEl.dataset.bad;
}

/** The stage page's project, in the shape /api/project has: the character's files (each with the URL to load it from) and its manifest. */
function stageProject(c: StandaloneChar): StageProject {
  return {
    assets: c.assets.map(a => ({ file: a.file, v: a.v, url: urls.get((a.from ?? a.file).slice(`char/${c.char}/`.length)) })),
    rigs: { [c.char]: c.manifest },
    game: {},
  };
}

/** Read the character's files (its two JSON files and its images; a PSD or notes beside them stay unread) and open the studio on it. */
async function openCharacter(store: CharacterStore, paths: string[], option: CharacterOption) {
  say(`Reading ${option.name}...`);
  const wanted = paths.filter(p => p.startsWith(option.base) && (IMAGE.test(p) || p === `${option.base}sprite.json` || p === `${option.base}rig.json`));
  const got = await Promise.all(wanted.map(async path => ({ path, ...(await store.read(path)) })));
  const texts = new Map<string, string>();
  for (const g of got) if (g.path.endsWith('.json')) texts.set(g.path, await g.bytes.text());
  const files: StandaloneFile[] = got.map(g => ({ path: g.path, mtime: g.mtime }));
  const c = standaloneChar(option, files, p => texts.get(p) ?? null);

  const rigPath = rigFile(c.base);
  const rigText = c.rigText ?? c.starter;
  let data: unknown;
  try { data = JSON.parse(rigText); } catch (e) { say(`${rigPath} has errors (${message(e)}); fix it in a text editor first.`, true); return; }
  for (const url of urls.values()) URL.revokeObjectURL(url);
  urls = new Map(got.filter(g => IMAGE.test(g.path)).map(g => [g.path.slice(option.base.length), URL.createObjectURL(new Blob([g.bytes], { type: MIME[g.path.split('.').pop()!.toLowerCase()] ?? '' }))]));

  const start = studioDocOf(data);
  const host: StudioHost = {
    ...manifestHost(c.manifest, data),
    image: file => urls.get(file),
    returnFocus: () => { document.title = 'Marginalia Studio · character'; say(''); openBtn.focus(); },
    apply: async change => {
      try {
        // The file as it is now (it may have been edited meanwhile; a character without one starts from the generated skeleton).
        let text = c.starter;
        try { text = await (await store.read(rigPath)).bytes.text(); } catch { /* none yet */ }
        try { JSON.parse(text); } catch { return false; }
        const out = writeRigText(text, studioWrites(change));
        if (out === null) return false;
        await store.write(rigPath, out);
        return true;
      } catch { return false; }
    },
    standalone: {
      stage: { url: '../', project: () => stageProject(c) },
      save: { label: 'Save', done: `Saved ${rigPath} (Ctrl+Z undoes edits here; Ctrl+S saves again).`, failed: `Could not write ${rigPath}: is the folder still there, and writable?` },
      open: () => studio.close(),
      without: ['place'],
    },
  };
  document.title = `${c.char} · Marginalia Studio`;
  say(c.problems.length ? c.problems.join(' ') : `${c.char}: ${c.manifest.flat ? 'one image per pose' : `${c.manifest.parts.length} parts`}${c.rigText === null ? ', no rig.json yet (Save creates it)' : ''}.`, c.problems.length > 0);
  choose.hidden = true;
  studio.open(c.char, start, host);
}

/** What a picked folder holds: one character opens at once, several are listed to choose from. */
async function openFolder(store: CharacterStore) {
  say(`Reading ${store.name}...`);
  const paths = await store.list();
  const scan = scanFolder(paths, store.name);
  if (scan.kind === 'empty') { choose.hidden = true; say(`There is no character in ${store.name}: it needs a sprite.json (the PSD converter's output), a rig.json, or images.`, true); return; }
  if (scan.kind === 'choose') {
    choose.replaceChildren(...scan.options.map(o => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = o.name;
      b.title = `${store.name}/${o.base}`;
      b.addEventListener('click', () => void run(() => openCharacter(store, paths, o)));
      return b;
    }));
    choose.hidden = false;
    say(`${store.name} holds ${scan.options.length} characters: choose one.`);
    (choose.firstElementChild as HTMLElement | null)?.focus();
    return;
  }
  await openCharacter(store, paths, scan);
}

async function run(job: () => Promise<void>) {
  try { await job(); } catch (e) { if (!aborted(e)) say(`Could not open the folder: ${message(e)}`, true); }
}

async function pick() {
  if (bridge) {
    const folder = await bridge.pick('Open a character folder');
    if (folder) await openFolder(bridgeStore(bridge, folder.name));
    return;
  }
  const picker = directoryPicker();
  if (picker) await openFolder(directoryStore(await picker({ mode: 'readwrite' })));
}

openBtn.addEventListener('click', () => void run(pick));
window.addEventListener('beforeunload', e => { if (studio.hasUnapplied) e.preventDefault(); });
// Ctrl+S saves rig.json wherever the focus is (the browser's own Save Page is never wanted here).
window.addEventListener('keydown', e => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== 's') return;
  e.preventDefault();
  if (studio.isOpen) void studio.save();
});

if (!bridge && !directoryPicker()) {
  openBtn.disabled = true;
  say('This browser cannot open folders for editing. Use Chrome or Edge, or Marginalia Studio.', true);
} else hint.textContent = bridge ? '' : 'The browser asks once to let this page read and change the folder you pick.';
// Marginalia Studio opens this page on the folder chosen in its projects screen.
if (bridge) void run(async () => { const folder = await bridge.folder(); if (folder) await openFolder(bridgeStore(bridge, folder.name)); });
