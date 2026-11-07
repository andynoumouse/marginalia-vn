// The Files panel (Ctrl+B): the project's scripts, themes, built-in screens, characters and assets as a tree with
// right-click menus, rename/move/delete with a trash, drops and uploads, and the toasts that report them. editor.ts
// owns the tabs and the editor and hands the panel what it calls back into (see initSidebar).

import {
  buildFileTree, BUILTIN_THEMES, isUnder, matchMasters, movedPath, overriddenScreens, planMove, PROJECT_FOLDERS, renameAssetRefs, UI_SCREENS,
  type FileTreeFolder, type LabelEdit, type RigManifest, type UiScreen,
} from '../engine/src/index.js';
import { type Mode } from './anim-studio.js';
import { confirmAsk } from './ask.js';
import { canView } from './asset-viewer.js';
import { ContextMenu, type MenuEntry, type MenuItem } from './context-menu.js';
import { updateGameSchema } from './json-schemas.js';
import { $, errorCount, files, GAME, isDirty, NEW_ASSET_FOLDER, NOT_IN_DEMO, openTabs, postPreview, problemCounts, projectFiles, recentFiles, rigName, S, scripts, setStatus, THEME_PICK, themeFileName, type FileState } from './state.js';

/** What the panel calls back into editor.ts. */
export interface SidebarHost {
  showStock(u: UiScreen): void;
  activate(name: string, focus?: boolean): void;
  closeTab(name: string): void;
  recompile(): void;
  save(f: FileState): Promise<void>;
  previewScreen(name: string): void;
  previewFromCursor(): Promise<void>;
  newFile(given?: string, starter?: string, dir?: string): Promise<void>;
  newFolder(given?: string, parent?: string): Promise<void>;
  syncFromDisk(): Promise<void>;
  openRig(char: string): void;
  openTheme(theme: string): void;
  openThemeSheet(theme: string): void;
  openAnimStudio(char?: string, animation?: string, scene?: { file: string; line: number }, mode?: Mode): void;
  runTask(name: string, label: string, params?: string): Promise<{ ok: boolean; output: string }>;
  applyEdits(edits: LabelEdit[]): void;
}
let host: SidebarHost;
export function initSidebar(h: SidebarHost) { host = h; }
const showStock: SidebarHost['showStock'] = (...a) => host.showStock(...a);
const activate: SidebarHost['activate'] = (...a) => host.activate(...a);
const closeTab: SidebarHost['closeTab'] = (...a) => host.closeTab(...a);
const recompile: SidebarHost['recompile'] = (...a) => host.recompile(...a);
const save: SidebarHost['save'] = (...a) => host.save(...a);
const previewScreen: SidebarHost['previewScreen'] = (...a) => host.previewScreen(...a);
const previewFromCursor: SidebarHost['previewFromCursor'] = (...a) => host.previewFromCursor(...a);
const newFile: SidebarHost['newFile'] = (...a) => host.newFile(...a);
const newFolder: SidebarHost['newFolder'] = (...a) => host.newFolder(...a);
const syncFromDisk: SidebarHost['syncFromDisk'] = (...a) => host.syncFromDisk(...a);
const openRig: SidebarHost['openRig'] = (...a) => host.openRig(...a);
const openTheme: SidebarHost['openTheme'] = (...a) => host.openTheme(...a);
const openThemeSheet: SidebarHost['openThemeSheet'] = (...a) => host.openThemeSheet(...a);
const openAnimStudio: SidebarHost['openAnimStudio'] = (...a) => host.openAnimStudio(...a);
const runTask: SidebarHost['runTask'] = (...a) => host.runTask(...a);
const applyEdits: SidebarHost['applyEdits'] = (...a) => host.applyEdits(...a);

export interface Project {
  scripts: { file: string; text: string }[];
  scriptDirs?: string[];
  gameText: string | null;
  assets: { file: string }[];
  rigs?: Record<string, RigManifest>;
  rigTexts?: Record<string, string>;
  themeTexts?: Record<string, string>;
  themeSheets?: Record<string, string>;
  masters?: string[]; // PSDs under masters/, from the dev server
  assetDirs?: string[]; // top-level folders under assets/, empty ones included
}

// ---- files and assets panel (Ctrl+B) ----
export const sidebarEl = $('sidebar'), sbFilter = $<HTMLInputElement>('sbFilter');
const sbFilesEl = document.createElement('div'), sbAssetsEl = document.createElement('div');
$('sbList').append(sbFilesEl, sbAssetsEl);
export const SIDEBAR_KEY = 'vn.editor.sidebar';
const openDirs = new Set<string>(); // asset folders the user expanded (all open while filtering)
export const collapsedDirs = new Set<string>(); // script folders the user collapsed (the tree starts open)
/** `key` (the project path) lets a redraw put the focus back on the same row, so F2 and Delete keep working on it. */
function sbItem(label: string, o: { key?: string; meta?: string; title?: string; current?: boolean; errors?: boolean; problems?: { errors: number; warns: number }; run(e: MouseEvent): void }) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'item';
  if (o.key) b.dataset.key = o.key;
  b.title = o.title ?? label;
  if (o.current) b.setAttribute('aria-current', 'true');
  if (o.errors) b.dataset.errors = 'true';
  const name = document.createElement('span');
  name.textContent = label;
  const meta = document.createElement('span');
  meta.className = 'meta';
  meta.textContent = o.meta ?? '';
  b.append(name, meta);
  for (const [n, kind] of [[o.problems?.errors ?? 0, 'errors'], [o.problems?.warns ?? 0, 'warns']] as const) {
    if (!n) continue;
    const badge = document.createElement('span');
    badge.className = `badge ${kind}`;
    badge.textContent = String(n);
    badge.title = `${n} ${n === 1 ? kind.slice(0, -1) : kind}`;
    meta.append(' ', badge);
  }
  b.addEventListener('click', o.run);
  return b;
}

// Hover icons on section headings and folders: the same three everywhere.
const ICONS = {
  file: '<path d="M9.5 1.8H4.2a1 1 0 0 0-1 1v10.4a1 1 0 0 0 1 1h7.6a1 1 0 0 0 1-1V5.1z"/><path d="M9.5 1.8v3.3h3.3M8 7.6v3.6M6.2 9.4h3.6"/>',
  folder: '<path d="M1.8 4.2a1 1 0 0 1 1-1h3l1.4 1.6h5a1 1 0 0 1 1 1v6.2a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1z"/><path d="M8 7.3v3.4M6.3 9h3.4"/>',
  panel: '<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/><circle cx="6" cy="4.5" r="1.3"/><circle cx="10.5" cy="8" r="1.3"/><circle cx="5" cy="11.5" r="1.3"/>',
  add: '<path d="M8 10.5V2.2M4.8 5.4 8 2.2l3.2 3.2"/><path d="M2.2 10v2.8a1 1 0 0 0 1 1h9.6a1 1 0 0 0 1-1V10"/>',
};
type SbAction = [icon: keyof typeof ICONS, title: string, run: () => void];
function sbIcon([icon, title, run]: SbAction) {
  const b = Object.assign(document.createElement('button'), { type: 'button', className: 'add', title });
  b.setAttribute('aria-label', title);
  b.innerHTML = `<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${ICONS[icon]}</svg>`;
  b.addEventListener('click', e => { e.preventDefault(); run(); }); // preventDefault: a folder's icons do not fold it
  return b;
}

// Right-click menus: rows register a builder; one listener on the list finds the nearest one.
const ctxMenu = new ContextMenu(document.body);
const sbMenus = new WeakMap<Element, () => MenuEntry[]>();
function withMenu<T extends HTMLElement>(el: T, menu: () => MenuEntry[]): T { sbMenus.set(el, menu); return el; }
function menuAt(target: EventTarget | null): [HTMLElement, () => MenuEntry[]] | null {
  for (let el = target as HTMLElement | null; el && el.id !== 'sbList'; el = el.parentElement) {
    const menu = sbMenus.get(el);
    if (menu) return [el, menu];
  }
  return null;
}
$('sbList').addEventListener('contextmenu', e => {
  const hit = menuAt(e.target);
  if (hit) { ctxMenu.open(e, hit[0], hit[1]()); return; }
  // Empty space (or a row without a menu): what the section headings offer.
  ctxMenu.open(e, $('sbList'), [
    { label: 'New Script File…', run: () => void newFile() }, { label: 'New Folder under script/…', run: () => void newFolder() },
    null,
    { label: 'Add Files…', run: () => pickAssets('', `${ART},audio/*,.ogg,.mp3,.wav,.m4a,.flac,.opus,.woff2,.woff,.ttf,.otf`) },
    { label: 'New Folder under assets/…', run: () => void newAssetFolder() },
    null,
    revealItem('', 'Open Project Folder'),
  ]);
});
// A double-click on a script row goes on to the editor (a single click keeps the focus in the panel).
$('sbList').addEventListener('dblclick', e => {
  const key = (e.target as HTMLElement).closest<HTMLElement>('.item[data-key]')?.dataset.key;
  if (key === GAME || key?.startsWith('script/')) S.editor.focus();
});
// F2 renames and Delete deletes the focused row, when its menu offers that.
$('sbList').addEventListener('keydown', e => {
  const label = e.key === 'F2' ? 'Rename…' : e.key === 'Delete' ? 'Delete' : '';
  const hit = label && !e.ctrlKey && !e.altKey && !e.metaKey ? menuAt(e.target) : null;
  const item = hit?.[1]().find((x): x is MenuItem => !!x && x.label === label && !x.disabled);
  if (!item) return;
  e.preventDefault();
  item.run();
});

const SECTIONS_KEY = 'vn.editor.sections';
/** Sidebar sections the user folded, by heading text (they stay open while filtering). */
const foldedSections = new Set<string>((() => { try { return JSON.parse(localStorage.getItem(SECTIONS_KEY) ?? '[]') as string[]; } catch { return []; } })());
const sectionFolded = (text: string) => foldedSections.has(text) && sbFilter.value.trim() === '';
function toggleSection(text: string) {
  if (foldedSections.has(text)) foldedSections.delete(text); else foldedSections.add(text);
  try { localStorage.setItem(SECTIONS_KEY, JSON.stringify([...foldedSections])); } catch { /* ignore */ }
  renderSidebarFiles();
  renderSidebarAssets();
}

/** A section heading that folds and unfolds its rows (click, Enter or Space on the title). */
const sbHeading = (text: string, actions: SbAction[] = [], menu?: () => MenuEntry[]) => {
  const h = document.createElement('h3');
  const title = Object.assign(document.createElement('span'), { textContent: text, tabIndex: 0, className: 'fold' });
  title.setAttribute('role', 'button');
  title.setAttribute('aria-expanded', String(!sectionFolded(text)));
  title.title = sectionFolded(text) ? `Show ${text}` : `Hide ${text}`;
  title.addEventListener('click', () => toggleSection(text));
  title.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSection(text); } });
  h.append(title, ...actions.map(sbIcon));
  if (menu) withMenu(h, menu);
  return h;
};
/** A heading followed by its rows, unless the section is folded (`rows` is not even built then). */
const sbSection = (text: string, actions: SbAction[], menu: (() => MenuEntry[]) | undefined, rows: () => HTMLElement[]) =>
  [sbHeading(text, actions, menu), ...(sectionFolded(text) ? [] : rows())];

// File manager actions on project-relative paths (dev server: /api/reveal and /api/open).
const REVEAL = /Win/.test(navigator.platform) ? 'Reveal in File Explorer' : /Mac/.test(navigator.platform) ? 'Reveal in Finder' : 'Open Containing Folder';
async function showPath(how: 'reveal' | 'open', rel: string) {
  if (!S.caps.reveal) { setStatus(`opening files ${NOT_IN_DEMO}`); return; }
  try {
    const r = await fetch(`/api/${how}?path=${encodeURIComponent(rel)}`, { method: 'POST', headers: { 'X-VN-Editor': '1' } });
    if (r.status === 404) { setStatus('the dev server is older than the editor: restart it to open files'); return; }
    if (!r.ok) throw new Error(String(r.status));
  } catch { setStatus(how === 'open' ? `could not open ${rel}` : `could not show ${rel}`); }
}
const revealItem = (rel: string, label = REVEAL): MenuItem =>
  ({ label, title: S.caps.reveal ? rel || 'the project folder' : NOT_IN_DEMO, disabled: !S.caps.reveal, run: () => void showPath('reveal', rel) });
const copyItem = (label: string, text: string): MenuItem => ({
  label, title: text, run: () => void navigator.clipboard.writeText(text).then(() => setStatus(`copied ${text}`), () => setStatus('copy failed')),
});

// Rename/Move, Delete and Replace on project-relative paths (dev server: /api/move, /api/delete, PUT /api/asset?replace=).
// Rename asks for the new path in the palette, so a file moves to another folder by typing it.
export const RENAME = '#rename:'; // palette prefix of the Rename field (the text after it is the new path)
const inScript = (rel: string) => rel.startsWith('script/');
const scriptName = (rel: string) => rel.slice('script/'.length);

async function fileRequest(url: string, fail: string): Promise<Response | null> {
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'X-VN-Editor': '1' } });
    if (r.ok) return r;
    const text = await r.text();
    toastError(text === 'Not found' ? 'the dev server is older than the editor: restart it to rename or delete files' : `${fail}: ${text}`);
  } catch { toastError(fail); }
  return null;
}

// Delete and Replace move what they remove to the project's .trash/ folder (dev server: /api/trash...). The toast offers Undo
// for a while; Restore from Trash (palette, or the Project heading's menu) lists everything still there.
let toastTimer = 0;
function toast(text: string, undo?: () => void) {
  showToast(text, undo ? { label: 'Undo', run: undo } : undefined);
}

/** A refused action: red, wraps instead of cutting off, and stays until dismissed; also logged to the preview's debug console. */
function toastError(text: string) {
  postPreview({ type: 'log', kind: 'err', text });
  showToast(text, { label: 'Dismiss', run: () => {} }, true);
}

function showToast(text: string, action?: { label: string; run(): void }, error = false) {
  const el = $('toast'), button = el.querySelector('button')!;
  el.querySelector('span')!.textContent = text;
  if (error) el.dataset.kind = 'error'; else delete el.dataset.kind;
  el.setAttribute('role', error ? 'alert' : 'status');
  button.hidden = !action;
  button.textContent = action?.label ?? '';
  button.onclick = () => { el.hidden = true; action?.run(); };
  el.hidden = false;
  clearTimeout(toastTimer);
  if (!error) toastTimer = window.setTimeout(() => { el.hidden = true; }, 12_000);
  setStatus(text);
}

export const TRASH_PICK = '#trash:'; // palette prefix of the Restore from Trash list
export async function openTrash() {
  try { S.trashEntries = await (await fetch('/api/trash')).json(); } catch { setStatus('could not read the trash'); return; }
  S.palette.setText(TRASH_PICK);
}

export async function restoreTrash(id: string) {
  const r = await fileRequest(`/api/trash/restore?id=${encodeURIComponent(id)}`, 'could not restore');
  if (!r) return;
  const { paths, aside } = await r.json() as { paths: string[]; aside: string | null };
  toast(`restored ${paths.join(', ')}${aside ? ' (what was there went to the trash)' : ''}`, aside ? () => void restoreTrash(aside) : undefined);
  await syncFromDisk();
  renderSidebarFiles();
}

export async function emptyTrash() {
  if (!await confirmAsk('Delete everything in the project trash for good? This cannot be undone.', 'Delete')) return;
  const r = await fileRequest('/api/trash/empty', 'could not empty the trash');
  if (r) toast(`emptied the trash (${(await r.json() as { removed: number }).removed} entries)`);
}

/** Saves the scripts under `rel` now, so a move or delete never races their autosave. */
async function flushScripts(rel: string) {
  if (!inScript(rel)) return;
  await Promise.all(scripts().filter(f => isUnder(f.name, scriptName(rel))).map(f => { clearTimeout(f.timer); return save(f); }));
}

function startRename(from: string, isDir = false) {
  S.renaming = { from, isDir };
  S.palette.setText(RENAME + from);
}

export async function movePath(from: string, to: string, isDir: boolean) {
  const plan = planMove(from, to, isDir);
  if ('error' in plan) { setStatus(plan.error); return; }
  await flushScripts(from);
  if (!await fileRequest(`/api/move?from=${encodeURIComponent(from)}&to=${encodeURIComponent(plan.to)}${isDir ? '&dir=1' : ''}`, `could not rename ${from}`)) return;
  S.renaming = null;
  setStatus(`renamed ${from} to ${plan.to}`);
  if (from.startsWith('assets/')) {
    // Scripts and game.json that name the file follow it (one undo step per file, saved like typing).
    const { edits, stranded } = renameAssetRefs(projectFiles(), from, plan.to, isDir, S.projectAssets.files);
    applyEdits(edits);
    const changed = new Set(edits.map(e => e.file)).size;
    const notes = [
      edits.length ? `updated ${edits.length} mention${edits.length === 1 ? '' : 's'} in ${changed} file${changed === 1 ? '' : 's'}` : '',
      stranded.length ? `${stranded.length} mention${stranded.length === 1 ? '' : 's'} cannot name the new place (${stranded.slice(0, 3).map(r => `${r.file}:${r.line}`).join(', ')}${stranded.length > 3 ? ', …' : ''})` : '',
    ].filter(Boolean);
    if (notes.length) toast(`renamed ${from} to ${plan.to}: ${notes.join('; ')}`); // a toast, so the autosave's status does not hide it
  }
  if (!inScript(from)) {
    const [, top] = from.split('/'), [, newTop] = plan.to.split('/');
    if (isDir && openDirs.delete(top)) openDirs.add(newTop);
    void syncFromDisk();
    return;
  }
  // Open scripts follow: their tabs, the recent list and the preview position keep pointing at them.
  const a = scriptName(from), b = scriptName(plan.to), moved = new Map<string, string>();
  for (const f of scripts()) {
    const n = movedPath(f.name, a, b);
    if (!n) continue;
    moved.set(f.name, n);
    files.delete(f.name);
    f.name = n;
    files.set(n, f);
  }
  const follow = (n: string) => moved.get(n) ?? n;
  for (const list of [openTabs, recentFiles]) list.splice(0, list.length, ...list.map(follow));
  S.active = follow(S.active);
  if (S.previewPos) S.previewPos.file = follow(S.previewPos.file);
  const dirs = new Set(S.scriptDirs.map(d => movedPath(d, a, b) ?? d));
  for (let p = isDir ? b : b.slice(0, Math.max(b.lastIndexOf('/'), 0)); p; p = p.slice(0, Math.max(p.lastIndexOf('/'), 0))) dirs.add(p);
  S.scriptDirs = [...dirs];
  for (const d of [...collapsedDirs]) {
    const n = movedPath(d, a, b);
    if (n) { collapsedDirs.delete(d); collapsedDirs.add(n); }
  }
  recompile();
  renderSidebarFiles();
}

async function deletePath(rel: string, isDir = false, question?: string) {
  const count = !isDir ? 0 : inScript(rel) ? scripts().filter(f => isUnder(f.name, scriptName(rel))).length
    : rel.startsWith('masters/') ? S.projectAssets.masters.filter(m => isUnder(`masters/${m.master}`, rel)).length
    : S.projectAssets.files.filter(f => isUnder(`assets/${f}`, rel) && !f.endsWith('.gitkeep')).length;
  const what = isDir ? `the folder ${rel}/${count ? ` and the ${count} file${count === 1 ? '' : 's'} in it` : ''}` : rel;
  if (!await confirmAsk(question ?? `Delete ${what}?\n\nIt goes to the project trash (.trash/): Undo, or Restore from Trash, brings it back.`, 'Delete')) return;
  const r = await fileRequest(`/api/delete?path=${encodeURIComponent(rel)}${isDir ? '&dir=1' : ''}`, `could not delete ${rel}`);
  if (!r) return;
  const { trash } = await r.json() as { trash?: string };
  toast(`deleted ${rel}`, trash ? () => void restoreTrash(trash) : undefined);
  if (!inScript(rel)) { void syncFromDisk(); return; }
  const a = scriptName(rel);
  for (const f of scripts()) {
    if (!isUnder(f.name, a)) continue;
    clearTimeout(f.timer);
    f.saved = f.model.getValue(); // closing a tab saves it; this one is gone
    closeTab(f.name);
    files.delete(f.name);
    const seen = recentFiles.indexOf(f.name);
    if (seen >= 0) recentFiles.splice(seen, 1);
    f.model.dispose();
  }
  S.scriptDirs = S.scriptDirs.filter(d => !isUnder(d, a));
  recompile();
  renderSidebarFiles();
}

/** Overwrites an asset or master with a file of the same type picked with the system picker. */
function replaceFile(rel: string) {
  const ext = rel.slice(rel.lastIndexOf('.'));
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: ext });
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    if (!f) return;
    setStatus(`replacing ${rel}...`);
    try {
      const r = await fetch(`/api/asset?replace=${encodeURIComponent(rel)}&name=${encodeURIComponent(f.name)}`, { method: 'PUT', headers: { 'X-VN-Editor': '1' }, body: f });
      if (!r.ok) { toastError(`could not replace ${rel}: ${await r.text()}`); return; }
      const { trash } = await r.json() as { trash?: string };
      toast(`replaced ${rel}`, trash ? () => void restoreTrash(trash) : undefined);
    } catch { toastError(`could not replace ${rel}`); }
  });
  input.click();
}

/** Rename and Delete for a row's menu; `blocked` disables both and says why. F2 and Delete on the row run them too. */
const changeItems = (rel: string, isDir = false, blocked?: string): MenuEntry[] => [
  { label: 'Rename…', run: () => startRename(rel, isDir), disabled: !!blocked, title: blocked ?? `Rename or move ${rel} (type a new path)` },
  { label: 'Delete', run: () => void deletePath(rel, isDir), disabled: !!blocked, title: blocked ?? `Delete ${rel}${isDir ? '/ and everything in it' : ''}` },
];

/** Asks for files with the system picker and adds them like a drop on `folder` (PSDs on bg, char and ui go to masters/). */
function pickAssets(folder: string, accept = '') {
  const input = Object.assign(document.createElement('input'), { type: 'file', multiple: true, accept });
  input.addEventListener('change', () => { if (input.files?.length) void addAssets([...input.files], folder); });
  input.click();
}
const ART = '.png,.webp,.jpg,.jpeg,.avif,.svg';
const SOUND = '.ogg,.mp3,.wav,.m4a,.flac,.opus';
const MOVIE = '.webm,.mp4,.m4v,.ogv';
const acceptFor = (dir: string) => ['bg', 'char', 'ui'].includes(dir) ? `${ART},.psd` : dir === 'movie' ? MOVIE : ['music', 'sound', 'sfx', 'voice'].includes(dir) ? SOUND : '';
/**
 * What a script wants for an asset file: `scene`, `music play`, `sound play` and `movie play` take the bare name (`park`), the
 * parameters that name a file (`image "…"`, `mask`, `hover`) the path under assets/ with its extension (`ui/map.png`).
 * Never the `assets/` prefix of a project path.
 */
const assetRef = (file: string): string => {
  const m = /^(bg|music|sound|movie)\/([^/]+)\.[^./]+$/.exec(file);
  return m ? m[2] : file;
};
const masterOf = (asset: string) => S.projectAssets.masters.find(m => m.output === asset)?.master;

/** The focused row's key in `section`, and after a redraw, puts the focus back on the row with that key. */
const focusedKey = (section: HTMLElement) => (section.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.key : undefined);
function refocus(section: HTMLElement, key: string | undefined) {
  if (key) section.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus();
}
// A mouse click on a script row opens it and leaves the focus in the panel (so F2 and Delete work on the row);
// Enter (a click with detail 0) and a double-click go on to the editor.
const toEditor = (e: MouseEvent) => e.detail === 0;

const sbNone = (text: string) => Object.assign(document.createElement('div'), { className: 'none', textContent: text });
const sbMatch = (text: string) => text.toLowerCase().includes(sbFilter.value.trim().toLowerCase());

/** Script files and game.json: cheap, redrawn with the tabs so the dirty and error marks stay current. */
export function renderSidebarFiles() {
  if (sidebarEl.hidden) return;
  const over = overriddenScreens([...files.values()].filter(f => f.kind === 'script').map(f => ({ file: f.name, text: f.model.getValue() })));
  const overrideFiles = new Set(UI_SCREENS.filter(u => over[u.name] === u.file).map(u => u.file));
  const focused = focusedKey(sbFilesEl);
  const fileRow = (f: FileState, label: string) => withMenu(sbItem(label, {
    key: f.kind === 'game' ? GAME : `script/${f.name}`,
    title: f.name, current: f.name === S.active, errors: errorCount(f) > 0, problems: problemCounts(f),
    meta: [isDirty(f) ? '•' : '', overrideFiles.has(f.name) ? 'screen' : ''].filter(Boolean).join(' '),
    run: e => activate(f.name, toEditor(e)),
  }), () => f.kind === 'game' ? [{ label: 'Open', run: () => activate(f.name) }, null, copyItem('Copy Path', GAME), revealItem(GAME)] : [
    { label: 'Open', run: () => activate(f.name) },
    { label: 'Preview from Start of File', run: () => void previewFile(f.name) },
    null,
    { label: 'New Script File Here', run: () => void newFile(undefined, undefined, f.name.includes('/') ? f.name.slice(0, f.name.lastIndexOf('/')) : undefined) },
    null,
    ...changeItems(`script/${f.name}`),
    null,
    copyItem('Copy Path', `script/${f.name}`), revealItem(`script/${f.name}`),
  ]);
  const game = files.get(GAME);
  const scripts = [...files.values()].filter(f => f.kind === 'script');
  const tree = buildFileTree(scripts.map(f => f.name), S.scriptDirs, sbFilter.value);
  const folderNode = (d: FileTreeFolder): HTMLElement => {
    const el = document.createElement('details');
    el.open = !collapsedDirs.has(d.path);
    el.addEventListener('toggle', () => { if (el.open) collapsedDirs.delete(d.path); else collapsedDirs.add(d.path); });
    const newHere: SbAction = ['file', `New script file in ${d.path}/`, () => void newFile(undefined, undefined, d.path)];
    const folderHere: SbAction = ['folder', `New folder in ${d.path}/`, () => void newFolder(undefined, d.path)];
    const sum = withMenu(document.createElement('summary'), () => [
      { label: 'New Script File…', run: newHere[2] }, { label: 'New Folder…', run: folderHere[2] },
      null, ...changeItems(`script/${d.path}`, true),
      null, copyItem('Copy Path', `script/${d.path}`), revealItem(`script/${d.path}`),
    ]);
    sum.dataset.key = `script/${d.path}/`;
    sum.append(Object.assign(document.createElement('span'), { textContent: d.name }), sbIcon(newHere), sbIcon(folderHere));
    el.append(sum, ...d.folders.map(folderNode), ...d.files.map(n => fileRow(files.get(n)!, n.slice(n.lastIndexOf('/') + 1))));
    return el;
  };
  const scriptRows = tree.flat
    ? tree.files.map(n => fileRow(files.get(n)!, n))
    : [...tree.root.folders.map(folderNode), ...tree.root.files.map(n => fileRow(files.get(n)!, n))];
  const newScript: SbAction = ['file', 'New script file', () => void newFile()];
  const newScriptFolder: SbAction = ['folder', 'New folder under script/', () => void newFolder()];
  const themeNames = [...new Set([...Object.keys(S.themeTexts), ...[...files.values()].filter(f => f.kind === 'theme').map(f => f.char!)])].sort().filter(n => sbMatch(`theme ${n}`));
  const newTheme: SbAction = ['file', 'New theme file (themes/<name>.json)', () => S.palette.setText(THEME_PICK)];
  const openPanel: SbAction = ['panel', 'Theme panel: edit colors, fonts and components with a live preview', () => S.themeDialog.open(files.get(S.active)?.kind === 'theme' ? files.get(S.active)!.char! : null, () => S.editor.focus())];
  const builtInNames = Object.keys(BUILTIN_THEMES).filter(n => !themeNames.includes(n) && sbMatch(`theme ${n} built-in`));
  const builtInRows = builtInNames.map(n => withMenu(sbItem(n, {
    key: `theme-builtin/${n}`, title: `Built-in theme "${n}": view it in the theme panel, or duplicate it into a theme file`, meta: 'built-in',
    run: () => S.themeDialog.open(n, () => S.editor.focus()),
  }), () => [
    { label: 'View in Theme Panel', run: () => S.themeDialog.open(n, () => S.editor.focus()) },
    { label: 'Duplicate…', run: () => { S.themeDialog.open(n, () => S.editor.focus()); S.themeDialog.duplicate(); } },
  ]));
  const themeRows = (): HTMLElement[] => (themeNames.length ? themeNames.map(n => {
    const file = files.get(themeFileName(n));
    return withMenu(sbItem(n, {
      key: themeFileName(n), title: `Edit ${themeFileName(n)}`, current: !!file && file.name === S.active, errors: !!file && errorCount(file) > 0,
      meta: file && isDirty(file) ? '•' : '', run: () => openTheme(n),
    }), () => [
      { label: 'Open', run: () => openTheme(n) },
      { label: 'Open Stylesheet (CSS)', run: () => openThemeSheet(n) },
      { label: 'Edit in Theme Panel', run: () => S.themeDialog.open(n, () => S.editor.focus()) },
      { label: 'Duplicate…', run: () => { S.themeDialog.open(n, () => S.editor.focus()); S.themeDialog.duplicate(); } },
      null, copyItem('Copy Path', themeFileName(n)), revealItem(themeFileName(n)),
    ]);
  }) : builtInRows.length ? [] : [sbNone(sbFilter.value.trim() ? 'No matching themes' : 'No themes yet: use + to make one')]).concat(builtInRows);
  sbFilesEl.replaceChildren(
    ...(game && sbMatch(GAME) ? sbSection('Project', [], () => [
      revealItem('', 'Open Project Folder'), null, { label: 'Restore from Trash…', run: () => void openTrash() }, { label: 'Empty Trash…', run: () => void emptyTrash() },
    ], () => [fileRow(game, GAME)]) : []),
    ...sbSection('Scripts', [newScript, newScriptFolder], () => [
      { label: 'New Script File…', run: newScript[2] }, { label: 'New Folder…', run: newScriptFolder[2] }, null, revealItem('script'),
    ], () => scriptRows.length ? scriptRows : [sbNone(tree.flat ? 'No matching files' : 'No scripts yet')]),
    ...sbSection('Themes', [openPanel, newTheme], () => [
      { label: 'New Theme File…', run: newTheme[2] }, { label: 'Theme Panel…', run: () => S.themeDialog.open(null, () => S.editor.focus()) }, null, revealItem('themes'),
    ], themeRows));
  const screens = UI_SCREENS.filter(u => sbMatch(`${u.name} ${u.title}`));
  if (screens.length) sbFilesEl.append(...sbSection('Built-in screens', [], undefined, () => screens.map(u => {
    const file = over[u.name] ? files.get(over[u.name]) : undefined;
    const row = withMenu(document.createElement('div'), () => [
      { label: 'Preview Screen', run: () => previewScreen(u.name) },
      ...(file ? [
        { label: `Open ${file.name}`, run: () => activate(file.name) },
        {
          label: 'Revert to Default', title: `Delete script/${file.name} so the default screen is used again`,
          run: () => void deletePath(`script/${file.name}`, false, `Delete script/${file.name} and go back to the default ${u.title} screen?\n\nThe file goes to the project trash (.trash/).`),
        },
        null, copyItem('Copy Path', `script/${file.name}`), revealItem(`script/${file.name}`),
      ] : [
        { label: 'Show Default Code', run: () => showStock(u) },
        { label: 'Edit This Screen', title: `Create script/${u.file} with the default screen's code`, run: () => void newFile(u.file, u.starter) },
      ]),
    ]);
    row.className = 'row';
    row.append(sbItem(u.title, {
      title: file ? `Preview, and open ${file.name}, your edited copy of this screen (right-click, Revert to Default, to get the default back)` : 'Preview the default screen and show its code read-only',
      current: file ? file.name === S.active : S.stock?.name === u.name, errors: !!file && errorCount(file) > 0, problems: file ? problemCounts(file) : undefined,
      meta: file ? [isDirty(file) ? '•' : '', file.name].filter(Boolean).join(' ') : 'default',
      run: () => { previewScreen(u.name); if (file) activate(file.name); else showStock(u); },
    }));
    if (!file) {
      const custom = Object.assign(document.createElement('button'), {
        type: 'button', className: 'anim', textContent: 'Edit', title: `Edit this screen: create script/${u.file} with the default screen's code to change it`,
      });
      custom.addEventListener('click', () => void newFile(u.file, u.starter));
      row.append(custom);
    }
    return row;
  })));
  refocus(sbFilesEl, focused);
}

/** Characters (open their rig.json) and every other asset by folder (open in a browser tab). Redrawn when assets or the filter change. */
export function renderSidebarAssets() {
  if (sidebarEl.hidden) return;
  const focused = focusedKey(sbAssetsEl);
  const filtering = sbFilter.value.trim() !== '';
  const chars =Object.keys(S.projectAssets.rigs).sort().filter(c => sbMatch(`char/${c}`));
  const byDir = new Map<string, string[]>();
  for (const file of S.projectAssets.files) {
    if (file.endsWith('.gitkeep') || Object.entries(S.projectAssets.rigs).some(([c, r]) => !r.flat && file.startsWith(`char/${c}/`)) || !sbMatch(file)) continue;
    const [dir, ...rest] = file.split('/');
    byDir.set(dir, [...(byDir.get(dir) ?? []), rest.join('/')]);
  }
  if (!filtering) for (const dir of S.projectAssets.dirs) if (dir !== 'char' || byDir.has(dir)) byDir.set(dir, byDir.get(dir) ?? []); // empty folders too
  const groups = [...byDir.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([dir, names]) => {
    const d = document.createElement('details');
    d.open = filtering || openDirs.has(dir);
    d.dataset.dir = dir;
    const add: SbAction = ['add', `Add files to assets/${dir}/${acceptFor(dir) ? ' (a PSD goes to masters/)' : ''}`, () => pickAssets(dir, acceptFor(dir))];
    const s = withMenu(document.createElement('summary'), () => [
      { label: 'Add Files…', run: add[2] },
      null, ...changeItems(`assets/${dir}`, true, dir === 'char' ? 'char/ holds the characters; it keeps its name' : undefined),
      null, copyItem('Copy Path', `assets/${dir}`), revealItem(`assets/${dir}`),
    ]);
    s.dataset.key = `assets/${dir}/`;
    s.append(Object.assign(document.createElement('span'), { textContent: `${dir} (${names.length})` }), sbIcon(add));
    names.sort();
    d.append(s, ...names.map(n => {
      const file = `${dir}/${n}`, master = masterOf(file);
      // Converted art is rewritten from its master; a character's rig.json is edited from Characters.
      const fixed = master ? `made from masters/${master}: change the master instead`
        : /^char\/[^/]+\/rig\.json$/.test(file) ? 'the character\'s rig.json: edit it from Characters' : undefined;
      return withMenu(sbItem(n, {
        key: `assets/${file}`, title: master ? `${file} (converted from masters/${master})` : file, meta: master ? 'psd' : '',
        run: () => openAsset(file, names.map(x => `${dir}/${x}`), true),
      }), () => [
        { label: 'View', run: () => openAsset(file, names.map(x => `${dir}/${x}`), true) },
        ...(master ? [
          { label: 'Open Master in Default App', title: `masters/${master}`, run: () => void showPath('open', `masters/${master}`) },
          { label: 'Replace Master…', title: `Overwrite masters/${master} with another PSD (the converter remakes the art)`, run: () => replaceFile(`masters/${master}`) },
        ] : []),
        null,
        ...changeItems(`assets/${file}`, false, fixed),
        { label: 'Replace…', run: () => replaceFile(`assets/${file}`), disabled: !!fixed, title: fixed ?? `Overwrite ${file} with another ${file.slice(file.lastIndexOf('.'))} file` },
        null,
        copyItem('Copy Name', assetRef(file)),
        copyItem('Copy Path', `assets/${file}`),
        revealItem(`assets/${file}`),
        ...(master ? [revealItem(`masters/${master}`, `${REVEAL} (Master)`)] : []),
      ]);
    }));
    d.addEventListener('toggle', () => { if (!filtering) { if (d.open) openDirs.add(dir); else openDirs.delete(dir); } });
    return d;
  });
  // Masters the converter has not turned into art yet (it is off, still running, or the PSD failed): listed only while there are some.
  const waiting = S.projectAssets.masters.filter(m => !m.output && sbMatch(`masters/${m.master}`));
  const addChar: SbAction = ['add', 'Add a character PSD (masters/char/)', () => pickAssets('char', '.psd')];
  const newAssetDir: SbAction = ['folder', 'New folder under assets/', () => void newAssetFolder()];
  const addAny: SbAction = ['add', 'Add files (sorted by type: images to bg, sounds to music, fonts to fonts)', () => pickAssets('', `${ART},audio/*,.ogg,.mp3,.wav,.m4a,.flac,.opus,.woff2,.woff,.ttf,.otf`)];
  sbAssetsEl.replaceChildren(
    ...sbSection('Characters', [addChar], () => [{ label: 'Add Character PSD…', run: addChar[2] }, null, revealItem('masters/char', `${REVEAL} (Masters)`), revealItem('assets/char')], () => chars.length ? chars.map(c => {
      const master = S.projectAssets.masters.find(m => m.output === `char/${c}/sprite.json`)?.master;
      const flat = S.projectAssets.rigs[c]?.flat;
      const row = withMenu(document.createElement('div'), () => [
        { label: 'Edit rig.json', run: () => openRig(c) },
        { label: 'Model (parts, pivots, parameters and their keyforms, physics)', run: () => openAnimStudio(c, undefined, undefined, 'model') },
        { label: 'Animate', run: () => openAnimStudio(c) },
        null,
        ...(master ? [
          { label: 'Open Master in Default App', title: `masters/${master}`, run: () => void showPath('open', `masters/${master}`) },
          { label: 'Replace Master…', title: `Overwrite masters/${master} with another PSD (the converter remakes the art)`, run: () => replaceFile(`masters/${master}`) },
          { label: 'Reconvert All Art', run: () => void runTask('art', 'art') },
        ] : flat ? [{ label: 'Add Pose Images…', run: () => pickAssets(`char/${c}`, ART) }] : []),
        null,
        copyItem('Copy Name', c),
        ...(master ? [revealItem(`masters/${master}`, `${REVEAL} (Master)`)] : []),
        revealItem(`assets/char/${c}`, master ? `${REVEAL} (Art)` : REVEAL),
      ]);
      row.className = 'row';
      const anim = Object.assign(document.createElement('button'), { type: 'button', className: 'anim', textContent: 'Animate', title: `Open the animation studio for ${c} in Animate mode: animations on a timeline` });
      anim.addEventListener('click', () => openAnimStudio(c));
      const rig = Object.assign(document.createElement('button'), { type: 'button', className: 'anim', textContent: 'Model', title: `Open the animation studio for ${c} in Model mode: parts, bones, pivots, parameters, physics` });
      rig.addEventListener('click', () => openAnimStudio(c, undefined, undefined, 'model'));
      row.append(sbItem(c, {
        title: `Edit char/${c}/rig.json${master ? ` (art from masters/${master})` : ''}`, current: S.active === rigName(c),
        meta: [master ? 'psd' : '', files.has(rigName(c)) ? 'rig.json (open)' : c in S.projectAssets.rigTexts ? 'rig.json' : 'rig.json (new)'].filter(Boolean).join(' · '),
        run: () => openRig(c),
      }), rig, anim);
      return row;
    }) : [sbNone(filtering ? 'No matching characters' : 'No converted characters yet')]),
    ...sbSection('Assets', [addAny, newAssetDir], () => [{ label: 'Add Files…', run: addAny[2] }, { label: 'New Folder…', run: newAssetDir[2] }, null, revealItem('assets')],
      () => groups.length ? groups : [sbNone(filtering ? 'No matching assets' : 'No assets yet')]),
  );
  if (waiting.length) sbAssetsEl.append(
    ...sbSection('Masters not converted', [], () => [{ label: 'Reconvert All Art', run: () => void runTask('art', 'art') }, null, revealItem('masters')], () => waiting.map(m => withMenu(sbItem(m.master, {
      key: `masters/${m.master}`, title: `masters/${m.master}: no converted art yet (the converter is off, still working, or failed; see the dev server log). Click to open it.`, meta: 'psd',
      run: () => void showPath('open', `masters/${m.master}`),
    }), () => [
      { label: 'Open in Default App', run: () => void showPath('open', `masters/${m.master}`) },
      { label: 'Reconvert All Art', run: () => void runTask('art', 'art') },
      null, ...changeItems(`masters/${m.master}`), { label: 'Replace…', run: () => replaceFile(`masters/${m.master}`) },
      null, copyItem('Copy Path', `masters/${m.master}`), revealItem(`masters/${m.master}`),
    ]))));
  refocus(sbAssetsEl, focused);
}

/** A new top-level folder under assets/ (asked for in the palette without a name). */
export async function newAssetFolder(given?: string) {
  if (given === undefined) { S.palette.setText(NEW_ASSET_FOLDER); return; }
  const dir = given.trim().replace(/\/+$/, '');
  if (!/^[\w\-]+$/.test(dir)) { setStatus('invalid folder name'); return; }
  const r = await fetch(`/api/folder?in=assets&dir=${encodeURIComponent(dir)}`, { method: 'PUT', headers: { 'X-VN-Editor': '1' } });
  if (!r.ok) { setStatus('could not create folder'); return; }
  if (!S.projectAssets.dirs.includes(dir)) S.projectAssets.dirs.push(dir);
  openDirs.add(dir);
  renderSidebarAssets();
}

async function previewFile(name: string) {
  activate(name);
  S.editor.setPosition({ lineNumber: 1, column: 1 });
  await previewFromCursor();
}

// Files dragged from the desktop onto the Assets list are copied into the project; dropped on a folder they go in that folder,
// else the server routes them by type (engine/src/asset-drop.ts). The sidebar refreshes through the assets watcher.
const dropFolder = (e: DragEvent) => (e.target as HTMLElement).closest<HTMLElement>('details[data-dir]')?.dataset.dir ?? '';
const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
function markDropTarget(e: DragEvent | null) {
  sbAssetsEl.querySelectorAll('.drop').forEach(el => el.classList.remove('drop'));
  if (e) (e.target as HTMLElement).closest('details[data-dir]')?.classList.add('drop');
  sbAssetsEl.classList.toggle('dropping', !!e);
}
sbAssetsEl.addEventListener('dragover', e => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  e.dataTransfer!.dropEffect = 'copy';
  markDropTarget(e);
});
sbAssetsEl.addEventListener('dragleave', e => { if (!sbAssetsEl.contains(e.relatedTarget as Node | null)) markDropTarget(null); });
sbAssetsEl.addEventListener('drop', e => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  const folder = dropFolder(e), dropped = [...e.dataTransfer!.files];
  markDropTarget(null);
  void addAssets(dropped, folder);
});

async function addAssets(dropped: File[], folder: string) {
  const done: string[] = [], skipped: string[] = [];
  for (const f of dropped) {
    setStatus(`adding ${f.name}...`);
    try {
      const r = await fetch(`/api/asset?name=${encodeURIComponent(f.name)}&folder=${encodeURIComponent(folder)}`, { method: 'PUT', headers: { 'X-VN-Editor': '1' }, body: f });
      if (r.ok) done.push(((await r.json()) as { dest: string }).dest);
      else if (r.status === 409) skipped.push(`${((await r.json()) as { dest: string }).dest} exists`);
      else skipped.push(await r.text());
    } catch { skipped.push(`${f.name}: upload failed`); }
  }
  if (skipped.length) toastError([done.length ? `added ${done.join(', ')}` : '', ...skipped.map(s => `not added: ${s}`)].filter(Boolean).join('\n'));
  else toast(`added ${done.join(', ')}`);
}

/** Images, sounds and fonts open in the viewer dialog; anything else in a browser tab. Closing the viewer goes back to the
 * Files panel row when it was opened from there (`fromPanel`), else to the editor. */
export function openAsset(file: string, siblings: string[] = [file], fromPanel = false) {
  if (canView(file)) S.assetViewer.open(file, siblings, () => (fromPanel ? refocus(sbAssetsEl, `assets/${file}`) : S.editor.focus()));
  else window.open(`../assets/${encodeURI(file)}`, '_blank', 'noopener');
}

export function setSidebar(show: boolean) {
  sidebarEl.hidden = !show;
  try { localStorage.setItem(SIDEBAR_KEY, show ? '1' : '0'); } catch { /* ignore */ }
  renderSidebarFiles();
  renderSidebarAssets();
}


export function setAssets(proj: Project) {
  S.themeTexts = proj.themeTexts ?? {};
  S.themeSheets = proj.themeSheets ?? {};
  S.scriptDirs = proj.scriptDirs ?? [];
  renderSidebarFiles();
  const assetFiles = proj.assets.map(a => a.file);
  S.projectAssets = { files: assetFiles, rigs: proj.rigs ?? {}, rigTexts: proj.rigTexts ?? {}, masters: matchMasters(proj.masters ?? [], assetFiles), dirs: [...new Set([...(proj.assetDirs ?? []), ...PROJECT_FOLDERS.filter(d => d.startsWith('assets/')).map(d => d.slice('assets/'.length))])] };
  renderSidebarAssets();
  const assets = proj.assets;
  const pick = (dir: string) => assets.flatMap(a => {
    const [d, ...rest] = a.file.split('/');
    return d === dir && rest.length === 1 ? [rest[0].replace(/\.\w+$/, '')] : [];
  });
  S.assetNames = { bg: pick('bg'), music: pick('music'), ui: pick('ui'), fonts: pick('fonts'), sound: pick('sound') };
  updateGameSchema();
}
