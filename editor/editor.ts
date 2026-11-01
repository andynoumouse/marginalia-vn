// Scene editor: Monaco + the engine's own parser for live diagnostics and completions,
// next to the live preview. Files are saved to disk through the dev server, which is what
// triggers the preview's hot reload. game.json (title screen and menus) is a JSON tab with a schema.

import {
  ANIM_NAMES, EASE_NAMES, applyTextEdits, compile, namedAnchors, namedPositions, stageSize, parseVarValue, assignIds, existingIds, getCompletions, playtest, playtestDiagnostics, playtestText, checkAssets, checkGame, helpTopicAt, rigHelpTopicAt, buildOutline, labelAt, variableAt, renameVariable, renameLabel, rigLayers, checkRig, mergeRig, partName, rigPartNames, rigSkeleton, rigPoseNames, UI_SCREENS, type UiScreen, overriddenScreens, setTopLevelProperty, removeTopLevelProperty, readRigSettings, speakValue, blinkValue, speakPart, blinkPart, findColors, formatHex,
  type Program, type RigManifest, type LabelEdit, type ProjectFile,
} from '../engine/src/index.js';
import { AssetViewer, canView } from './asset-viewer.js';
import { AnimStudio } from './anim-studio.js';
import { HelpDialog } from './help-dialog.js';
import { FindDialog } from './find-dialog.js';
import { OutlineView } from './outline-view.js';
import { Palette, rank, type PaletteItem, type PaletteMode } from './palette.js';

declare const require: any;
declare const monaco: any;

// Monaco cancels its own pending requests (hover, highlights, ...) when the model changes, e.g. when a tab opens, and
// the cancelled promise rejects with a plain "Canceled" error nobody catches. It is not a failure; keep it out of the console.
window.addEventListener('unhandledrejection', e => {
  if (e.reason?.name === 'Canceled' && e.reason?.message === 'Canceled') e.preventDefault();
});

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const statusEl = $('status'), tabsEl = $('tabs'), problemsEl = $('problems'), followEl = $<HTMLInputElement>('follow');
const preview = $<HTMLIFrameElement>('preview');

// kind 'rig' is a character's assets/char/<char>/rig.json (tab name char/<char>/rig.json)
interface FileState { name: string; kind: 'script' | 'game' | 'rig'; char?: string; model: any; saved: string; timer: number }
const files = new Map<string, FileState>();
const GAME = 'game.json';
const rigName = (char: string) => `char/${char}/rig.json`;
const GAME_URI = 'file:///game.json';
const GAME_TEMPLATE = `{
  "title": "Untitled",
  "titleScreen": {
    "background": "",
    "music": "",
    "buttons": ["new_game", "continue", "load", "options"]
  }
}
`;
let assetNames = { bg: [] as string[], music: [] as string[], ui: [] as string[], fonts: [] as string[], sound: [] as string[] };
let active = '';
let program: Program = compile([]);
let editor: any;
let decorations: any;
let previewPos: { file: string; line: number } | null = null;

const norm = (s: string) => s.replace(/\r\n/g, '\n');
const setStatus = (s: string) => { statusEl.textContent = s; };

// ---- Monaco loading ----
function loadMonaco(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof require === 'undefined' || !require.config) {
      reject(new Error('Monaco was not found. Run "npm install" in the project folder, then reload this page.'));
      return;
    }
    const base = `${location.origin}/vendor/monaco`;
    // A blob: worker keeps the page's origin (a data: worker gets an opaque one and cannot importScripts from localhost).
    const workerUrl = URL.createObjectURL(new Blob([
      `self.MonacoEnvironment={baseUrl:'${base}/'};importScripts('${base}/vs/base/worker/workerMain.js');`,
    ], { type: 'text/javascript' }));
    (window as any).MonacoEnvironment = { getWorkerUrl: () => workerUrl };
    require.config({ paths: { vs: `${base}/vs` } });
    require(['vs/editor/editor.main'], () => resolve(), reject);
  });
}

// ---- language: highlighting, indentation, completions ----
function registerLanguage() {
  monaco.languages.register({ id: 'vn' });
  monaco.languages.setLanguageConfiguration('vn', {
    comments: { lineComment: '#' },
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
    autoClosingPairs: [{ open: '"', close: '"' }, { open: '{', close: '}' }, { open: '[', close: ']' }, { open: '(', close: ')' }],
    onEnterRules: [{
      beforeText: /^\s*(label\s+\w+\s*(\([^()]*\))?\s*:|menu\s*:|if\s.+:|elif\s.+:|else\s*:|".*"[^:]*:)\s*$/,
      action: { indentAction: monaco.languages.IndentAction.Indent },
    }],
  });

  monaco.languages.setMonarchTokensProvider('vn', {
    keywords: ['label', 'menu', 'if', 'elif', 'else', 'jump', 'call', 'return', 'end', 'set', 'define', 'unlock', 'input',
      'scene', 'show', 'hide', 'move', 'shake', 'hop', 'animate', 'flash', 'tint', 'camera', 'weather', 'filter', 'music', 'sound', 'wait', 'nvl', 'screen', 'hotspot', 'button', 'text', 'image', 'each', 'scroll', 'row', 'column', 'grid', 'cancel'],
    modifiers: ['at', 'fade', 'to', 'loop', 'nowait', 'play', 'stop', 'on', 'off', 'clear', 'cut', 'dissolve', 'wipe', 'iris', 'blinds', 'pixelate', 'pan', 'zoom', 'reset',
      'left', 'right', 'center', 'up', 'down', 'size', 'poly', 'ellipse', 'mask', 'step', 'cursor', 'enabled', 'anchor', 'margin', 'padding', 'gap', 'align', 'cell', 'as', 'and', 'or', 'not', 'true', 'false', 'screen'],
    tokenizer: {
      root: [
        [/^\s*#.*$/, 'comment'],
        [/^(\s*)(label)(\s+)([A-Za-z_]\w*)/, ['', 'keyword', '', 'type.identifier']],
        [/^(\s*)([A-Za-z_]\w*)(:)(?=\s)/, ['', 'type', 'delimiter'], '@dialogue'],
        [/^\s*(?=")/, '', '@quoted'],
        [/^\s*(?=[A-Za-z_])/, '', '@command'],
        [/\s+/, ''],
      ],
      dialogue: [
        [/\s#[A-Za-z0-9]{4,8}(?=\s*$)/, 'meta.id'],
        [/\{[^}]*\}/, 'tag'],
        [/\[[A-Za-z_]\w*\]/, 'variable'],
        [/[^{\[\s]+/, 'string'],
        [/\s+/, 'string'],
        [/./, 'string'],
        [/$/, '', '@pop'],
      ],
      quoted: [
        [/"(?:[^"\\]|\\.)*"/, 'string'],
        [/\s#[A-Za-z0-9]{4,8}(?=\s*:?\s*$)/, 'meta.id'],
        [/\bif\b/, 'keyword'],
        [/[0-9]+(\.[0-9]+)?/, 'number'],
        [/[A-Za-z_]\w*/, 'identifier'],
        [/[<>=!+\-*\/%():]+/, 'delimiter'],
        [/\s+/, ''],
        [/$/, '', '@pop'],
      ],
      command: [
        [/[A-Za-z_]\w*(?==)/, 'attribute.name'],
        [/[A-Za-z_]\w*/, { cases: { '@keywords': 'keyword', '@modifiers': 'keyword.other', '@default': 'identifier' } }],
        [/#[0-9a-fA-F]{3,8}/, 'number.hex'],
        [/[0-9]+(\.[0-9]+)?/, 'number'],
        [/"(?:[^"\\]|\\.)*"/, 'string'],
        [/[<>=!+\-*\/%():]+/, 'delimiter'],
        [/\s+/, ''],
        [/$/, '', '@pop'],
      ],
    },
  });

  monaco.editor.defineTheme('vn-dark', {
    base: 'vs-dark', inherit: true,
    rules: [
      { token: 'comment', foreground: '6b7385', fontStyle: 'italic' },
      { token: 'meta.id', foreground: '4a5163' },
      { token: 'type', foreground: '5fd1c3', fontStyle: 'bold' },
      { token: 'type.identifier', foreground: '5fd1c3' },
      { token: 'keyword', foreground: '9db8ff' },
      { token: 'keyword.other', foreground: 'c1a6ff' },
      { token: 'string', foreground: 'e3d9b4' },
      { token: 'tag', foreground: 'e8b64c' },
      { token: 'variable', foreground: 'f0a1c0' },
      { token: 'number', foreground: 'b5e08f' },
      { token: 'number.hex', foreground: 'b5e08f' },
      { token: 'attribute.name', foreground: '8fc7e8' },
    ],
    colors: { 'editor.background': '#0e1117', 'editor.lineHighlightBackground': '#171b2380' },
  });

  const K = monaco.languages.CompletionItemKind;
  const kinds: Record<string, number> = {
    command: K.Keyword, keyword: K.EnumMember, character: K.Class, label: K.Reference, variable: K.Variable, asset: K.Value,
  };
  monaco.languages.registerCompletionItemProvider('vn', {
    triggerCharacters: [' ', '{'],
    provideCompletionItems(model: any, position: any) {
      const prefix = model.getValueInRange({
        startLineNumber: position.lineNumber, startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column,
      });
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber, endLineNumber: position.lineNumber,
        startColumn: word.startColumn, endColumn: word.endColumn,
      };
      return {
        suggestions: getCompletions(program, prefix, liveRigs()).map((s, i) => ({
          label: s.label,
          kind: kinds[s.kind] ?? K.Text,
          detail: s.detail,
          insertText: s.insertText ?? s.label,
          insertTextRules: s.insertText?.includes('$0') ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
          sortText: String(i).padStart(3, '0'),
          range,
        })),
      };
    },
  });
}

// ---- files, tabs, diagnostics ----
const errorCount = (f: FileState) => (f.kind !== 'script'
  ? monaco.editor.getModelMarkers({ resource: f.model.uri }).filter((m: any) => m.severity === monaco.MarkerSeverity.Error).length
  : program.diagnostics.filter(d => d.file === f.name && d.severity === 'error').length);
/** Errors and warnings Monaco holds for a file (script diagnostics are published as markers too). */
function problemCounts(f: FileState) {
  const marks = monaco.editor.getModelMarkers({ resource: f.model.uri }) as { severity: number }[];
  const errors = marks.filter(m => m.severity >= monaco.MarkerSeverity.Error).length;
  return { errors, warns: marks.filter(m => m.severity >= monaco.MarkerSeverity.Warning).length - errors };
}
const isDirty = (f: FileState) => norm(f.model.getValue()) !== norm(f.saved);

// Closing a tab only hides it: the file stays loaded (scripts compile together, rig edits keep counting).
const openTabs: string[] = [];

// A stock built-in screen shown read-only (its starter code): not a project file, so it is never saved or compiled.
let stock: UiScreen | null = null;
const stockModels = new Map<string, any>();

function showStock(u: UiScreen) {
  let model = stockModels.get(u.name);
  if (!model) { model = monaco.editor.createModel(u.starter, 'vn', monaco.Uri.parse(`inmemory:///stock/${u.name}.vn`)); stockModels.set(u.name, model); }
  stock = u;
  active = '';
  editor.setModel(model);
  editor.updateOptions({ readOnly: true });
  renderTabs();
  showPreviewLine();
}

function leaveStock() {
  if (!stock) return;
  stock = null;
  editor.updateOptions({ readOnly: false });
}

function closeStock() {
  leaveStock();
  const next = recentFiles.find(n => openTabs.includes(n)) ?? openTabs.at(-1);
  if (next) { activate(next); return; }
  editor.setModel(null);
  renderTabs();
}

function renderTabs() {
  const stockTab = stock ? [(() => {
    const tab = document.createElement('div');
    tab.className = 'tab';
    tab.dataset.selected = 'true';
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', 'true');
    b.textContent = `${stock!.title} (stock, read-only)`;
    b.title = 'The starter code of the stock screen. Customize it from the Files panel to edit a copy.';
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'close';
    x.textContent = '×';
    x.setAttribute('aria-label', 'Close the stock screen');
    x.addEventListener('click', closeStock);
    tab.append(b, x);
    return tab;
  })()] : [];
  tabsEl.replaceChildren(...openTabs.flatMap(name => {
    const f = files.get(name);
    if (!f) return [];
    const tab = document.createElement('div');
    tab.className = 'tab';
    tab.dataset.selected = String(name === active);
    tab.dataset.errors = String(errorCount(f) > 0);
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(name === active));
    b.textContent = isDirty(f) ? `${name} •` : name;
    b.addEventListener('click', () => activate(name));
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'close';
    x.textContent = '×';
    x.title = 'Close (middle-click on the tab also closes)';
    x.setAttribute('aria-label', `Close ${name}`);
    x.addEventListener('click', () => closeTab(name));
    tab.addEventListener('auxclick', e => { if (e.button === 1) { e.preventDefault(); closeTab(name); } });
    tab.append(b, x);
    return [tab];
  }).concat(stockTab));
  renderSidebarFiles();
}

const recentFiles: string[] = []; // most recently activated first (Ctrl+P ordering)

function activate(name: string) {
  const f = files.get(name);
  if (!f) return;
  leaveStock();
  active = name;
  if (!openTabs.includes(name)) openTabs.push(name);
  const seenAt = recentFiles.indexOf(name);
  if (seenAt >= 0) recentFiles.splice(seenAt, 1);
  recentFiles.unshift(name);
  editor.setModel(f.model);
  renderTabs();
  showPreviewLine();
  editor.focus();
}

function closeTab(name: string) {
  const at = openTabs.indexOf(name);
  if (at < 0) return;
  const f = files.get(name);
  if (f) saveFile(f); // edits are autosaved anyway; do it now so closing never leaves a pending write
  openTabs.splice(at, 1);
  if (name !== active) { renderTabs(); return; }
  const next = recentFiles.find(n => n !== name && openTabs.includes(n)) ?? openTabs[Math.min(at, openTabs.length - 1)];
  if (next) { activate(next); return; }
  active = '';
  editor.setModel(null);
  showPreviewLine();
  renderTabs();
}

let compileTimer = 0;
const scripts = () => [...files.values()].filter(f => f.kind === 'script');

/** Files, rigs, blip voices and skins for checkAssets; game.json is read from its tab (unsaved edits count). */
function assetIndex() {
  let game: any = {};
  try { game = JSON.parse(files.get(GAME)?.model.getValue() ?? '{}'); } catch { /* the JSON tab shows its own errors */ }
  return {
    files: projectAssets.files, rigs: liveRigs(),
    blips: Object.keys(game?.blips ?? {}), skins: Object.keys(game?.theme?.skins ?? {}),
  };
}

/** The rigs with the rig.json tabs' text (saved or not) in place of what is on disk. */
function liveRigs(): Record<string, RigManifest> {
  const out = { ...projectAssets.rigs };
  for (const f of files.values()) {
    if (f.kind !== 'rig' || !f.char || !out[f.char]) continue;
    let rig;
    try { rig = JSON.parse(f.model.getValue()); } catch { /* the JSON tab shows its own errors */ }
    out[f.char] = { ...out[f.char], rig };
  }
  return out;
}

function rigMarkers(f: FileState) {
  const manifest = f.char ? liveRigs()[f.char] : undefined;
  const text: string = f.model.getValue();
  const lines = text.split('\n');
  const mark = (message: string, at?: string) => {
    const i = at ? lines.findIndex(l => l.includes(`"${at}"`)) : -1;
    const line = i >= 0 ? i + 1 : 1;
    return {
      severity: monaco.MarkerSeverity.Warning, message,
      startLineNumber: line, endLineNumber: line, startColumn: 1, endColumn: f.model.getLineMaxColumn(line),
    };
  };
  if (!manifest) return [mark(`${f.char} has no sprite.json yet (convert its PSD first); nothing here is checked`)];
  return checkRig(manifest).map(p => mark(p.message, p.at));
}

function recompile() {
  let game: unknown = null;
  try { game = JSON.parse(files.get(GAME)?.model.getValue() ?? '{}'); } catch { /* the JSON tab shows its own errors */ }
  program = compile(scripts().map(f => ({ file: f.name, text: f.model.getValue() })), namedPositions(game), namedAnchors(game), stageSize(game));
  monaco.editor.removeAllMarkers('vn-playtest'); // the playtest describes the script as it was; edits make it stale
  program.diagnostics.push(...checkAssets(program, assetIndex()));
  const gameFile = files.get(GAME);
  if (gameFile) {
    let game: unknown = null;
    try { game = JSON.parse(gameFile.model.getValue()); } catch { /* the JSON tab shows its own errors */ }
    program.diagnostics.push(...checkGame(game, assetIndex(), gameFile.model.getValue()));
  }
  updateGameSchema();
  for (const f of files.values()) if (f.kind === 'rig') monaco.editor.setModelMarkers(f.model, 'vn', rigMarkers(f));
  outlineView?.update(buildOutline(program));
  for (const f of [...scripts(), ...(gameFile ? [gameFile] : [])]) {
    const markers = program.diagnostics.filter(d => d.file === f.name).map(d => {
      const line = Math.min(Math.max(d.line, 1), f.model.getLineCount());
      const text: string = f.model.getLineContent(line);
      return {
        severity: d.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
        message: d.message,
        startLineNumber: line, endLineNumber: line,
        startColumn: text.length - text.trimStart().length + 1,
        endColumn: f.model.getLineMaxColumn(line),
      };
    });
    monaco.editor.setModelMarkers(f.model, 'vn', markers);
  }
  updateProblemCount();
  renderTabs();
}

/** Counts every marker on a project file, including the JSON schema ones Monaco adds to game.json and rigs. */
function updateProblemCount() {
  const known = new Set([...files.values()].map(f => f.model.uri.toString()));
  const marks = (monaco.editor.getModelMarkers({}) as { severity: number; resource: { toString(): string } }[])
    .filter(m => m.severity >= monaco.MarkerSeverity.Warning && known.has(m.resource.toString()));
  const errors = marks.filter(m => m.severity >= monaco.MarkerSeverity.Error).length;
  problemsEl.dataset.errors = String(errors);
  problemsEl.dataset.warns = String(marks.length - errors);
  problemsEl.textContent = `Problems: ${marks.length}`;
}

async function save(f: FileState) {
  const text: string = f.model.getValue();
  if (norm(text) === norm(f.saved)) return;
  if (f.kind !== 'script') {
    try { JSON.parse(text); } catch { setStatus(`${f.name} has errors; not saved`); return; }
  }
  setStatus('saving...');
  try {
    const url = f.kind === 'game' ? '/api/game'
      : f.kind === 'rig' ? `/api/rig?char=${encodeURIComponent(f.char ?? '')}`
      : `/api/script?file=${encodeURIComponent(f.name)}`;
    const r = await fetch(url, {
      method: 'PUT', headers: { 'X-VN-Editor': '1', 'Content-Type': 'text/plain' }, body: text,
    });
    if (!r.ok) throw new Error(String(r.status));
    f.saved = text;
    setStatus('saved');
  } catch {
    setStatus('save failed');
  }
  renderTabs();
}

function addFile(name: string, text: string, kind: FileState['kind'] = 'script', char?: string) {
  const model = kind === 'game'
    ? monaco.editor.createModel(text, 'json', monaco.Uri.parse(GAME_URI))
    : kind === 'rig'
      ? monaco.editor.createModel(text, 'json', monaco.Uri.parse(`file:///${name}`))
      : monaco.editor.createModel(text, 'vn');
  const f: FileState = { name, kind, char, model, saved: text, timer: 0 };
  files.set(name, f);
  openTabs.push(name);
  model.onDidChangeContent(() => {
    // Scripts recompile; game.json changes re-run the asset checks (blip voices, skins).
    clearTimeout(compileTimer);
    compileTimer = window.setTimeout(recompile, kind === 'script' ? 150 : 400);
    clearTimeout(f.timer);
    f.timer = window.setTimeout(() => void save(f), 400);
    renderTabs();
  });
  return f;
}

// ---- game.json schema (completions, hover docs and validation in the JSON tab) ----
interface Project {
  scripts: { file: string; text: string }[];
  gameText: string | null;
  assets: { file: string }[];
  rigs?: Record<string, RigManifest>;
  rigTexts?: Record<string, string>;
}
let projectAssets: { files: string[]; rigs: Record<string, RigManifest>; rigTexts: Record<string, string> } = { files: [], rigs: {}, rigTexts: {} };

// ---- files and assets panel (Ctrl+B) ----
const sidebarEl = $('sidebar'), sbFilter = $<HTMLInputElement>('sbFilter');
const sbFilesEl = document.createElement('div'), sbAssetsEl = document.createElement('div');
$('sbList').append(sbFilesEl, sbAssetsEl);
const SIDEBAR_KEY = 'vn.editor.sidebar';
const openDirs = new Set<string>(); // asset folders the user expanded (all open while filtering)

function sbItem(label: string, o: { meta?: string; title?: string; current?: boolean; errors?: boolean; problems?: { errors: number; warns: number }; run(): void }) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'item';
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

const sbHeading = (text: string) => Object.assign(document.createElement('h3'), { textContent: text });
const sbNone = (text: string) => Object.assign(document.createElement('div'), { className: 'none', textContent: text });
const sbMatch = (text: string) => text.toLowerCase().includes(sbFilter.value.trim().toLowerCase());

/** Script files and game.json: cheap, redrawn with the tabs so the dirty and error marks stay current. */
function renderSidebarFiles() {
  if (sidebarEl.hidden) return;
  const over = overriddenScreens([...files.values()].filter(f => f.kind === 'script').map(f => ({ file: f.name, text: f.model.getValue() })));
  // A screen's own override file (ui/<name>.vn) is reached from its Built-in screens row, so it is not listed twice.
  const ownFiles = new Set(UI_SCREENS.filter(u => over[u.name] === u.file).map(u => u.file));
  const list = [...files.values()].filter(f => f.kind !== 'rig' && !ownFiles.has(f.name) && sbMatch(f.name))
    .sort((a, b) => Number(a.kind === 'game') - Number(b.kind === 'game') || a.name.localeCompare(b.name));
  sbFilesEl.replaceChildren(sbHeading('Scripts'), ...(list.length ? list.map(f => sbItem(f.name, {
    current: f.name === active, errors: errorCount(f) > 0, problems: problemCounts(f),
    meta: [isDirty(f) ? '•' : '', f.kind === 'game' ? 'game' : ''].filter(Boolean).join(' '),
    run: () => activate(f.name),
  })) : [sbNone('No matching files')]));
  const screens = UI_SCREENS.filter(u => sbMatch(`${u.name} ${u.title}`));
  if (screens.length) sbFilesEl.append(sbHeading('Built-in screens'), ...screens.map(u => {
    const file = over[u.name] ? files.get(over[u.name]) : undefined;
    const row = document.createElement('div');
    row.className = 'row';
    row.append(sbItem(u.title, {
      title: file ? `Preview, and open ${file.name}, which overrides this screen (delete the screen to get the stock one back)` : 'Preview the stock screen and show its starter code read-only',
      current: file ? file.name === active : stock?.name === u.name, errors: !!file && errorCount(file) > 0, problems: file ? problemCounts(file) : undefined,
      meta: file ? [isDirty(file) ? '•' : '', file.name].filter(Boolean).join(' ') : 'stock',
      run: () => { previewScreen(u.name); if (file) activate(file.name); else showStock(u); },
    }));
    if (!file) {
      const custom = Object.assign(document.createElement('button'), {
        type: 'button', className: 'anim', textContent: 'Customize', title: `Create script/${u.file} with this screen's starter code to restyle it`,
      });
      custom.addEventListener('click', () => void newFile(u.file, u.starter));
      row.append(custom);
    }
    return row;
  }));
}

/** Characters (open their rig.json) and every other asset by folder (open in a browser tab). Redrawn when assets or the filter change. */
function renderSidebarAssets() {
  if (sidebarEl.hidden) return;
  const filtering = sbFilter.value.trim() !== '';
  const chars = Object.keys(projectAssets.rigs).sort().filter(c => sbMatch(`char/${c}`));
  const byDir = new Map<string, string[]>();
  for (const file of projectAssets.files) {
    if (file.endsWith('.gitkeep') || Object.keys(projectAssets.rigs).some(c => file.startsWith(`char/${c}/`)) || !sbMatch(file)) continue;
    const [dir, ...rest] = file.split('/');
    byDir.set(dir, [...(byDir.get(dir) ?? []), rest.join('/')]);
  }
  const groups = [...byDir.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([dir, names]) => {
    const d = document.createElement('details');
    d.open = filtering || openDirs.has(dir);
    const s = document.createElement('summary');
    s.textContent = `${dir} (${names.length})`;
    names.sort();
    d.append(s, ...names.map(n => sbItem(n, {
      title: `${dir}/${n}`,
      run: () => openAsset(`${dir}/${n}`, names.map(x => `${dir}/${x}`)),
    })));
    d.addEventListener('toggle', () => { if (!filtering) { if (d.open) openDirs.add(dir); else openDirs.delete(dir); } });
    return d;
  });
  sbAssetsEl.replaceChildren(
    sbHeading('Characters'),
    ...(chars.length ? chars.map(c => {
      const row = document.createElement('div');
      row.className = 'row';
      const anim = Object.assign(document.createElement('button'), { type: 'button', className: 'anim', textContent: 'Animate', title: `Open the animation studio for ${c}` });
      anim.addEventListener('click', () => openAnimStudio(c));
      row.append(sbItem(c, {
        title: `Edit char/${c}/rig.json`, current: active === rigName(c),
        meta: files.has(rigName(c)) ? 'rig.json (open)' : c in projectAssets.rigTexts ? 'rig.json' : 'rig.json (new)',
        run: () => openRig(c),
      }), anim);
      return row;
    }) : [sbNone(filtering ? 'No matching characters' : 'No converted characters yet')]),
    sbHeading('Assets'),
    ...(groups.length ? groups : [sbNone(filtering ? 'No matching assets' : 'No assets yet')]),
  );
}

let assetViewer: AssetViewer;
/** Images, sounds and fonts open in the viewer dialog; anything else in a browser tab. */
function openAsset(file: string, siblings: string[] = [file]) {
  if (canView(file)) assetViewer.open(file, siblings, () => editor.focus());
  else window.open(`/assets/${encodeURI(file)}`, '_blank', 'noopener');
}

function setSidebar(show: boolean) {
  sidebarEl.hidden = !show;
  try { localStorage.setItem(SIDEBAR_KEY, show ? '1' : '0'); } catch { /* ignore */ }
  renderSidebarFiles();
  renderSidebarAssets();
}

function setAssets(proj: Project) {
  projectAssets = { files: proj.assets.map(a => a.file), rigs: proj.rigs ?? {}, rigTexts: proj.rigTexts ?? {} };
  renderSidebarAssets();
  const assets = proj.assets;
  const pick = (dir: string) => assets.flatMap(a => {
    const [d, ...rest] = a.file.split('/');
    return d === dir && rest.length === 1 ? [rest[0].replace(/\.\w+$/, '')] : [];
  });
  assetNames = { bg: pick('bg'), music: pick('music'), ui: pick('ui'), fonts: pick('fonts'), sound: pick('sound') };
  updateGameSchema();
}

const QUICK_ITEMS = ['back', 'history', 'auto', 'skip', 'qsave', 'qload', 'save', 'load', 'options', 'voice', 'hide'];
const LABEL_KEYS = ['new_game', 'continue', 'load', 'save', 'options', 'resume', 'main_menu', 'master_volume', 'music_volume',
  'sound_volume', 'voice_volume', 'text_speed', 'auto_advance', 'skip_mode', 'skip_read', 'skip_all', 'language', 'fullscreen', 'back',
  'yes', 'no', 'instant', 'slow', 'normal', 'fast', 'slot', 'page', 'auto', 'auto_short', 'quick', 'quick_short',
  'choice', 'choice_short', 'choice_saves', 'empty_slot', 'delete', 'save_failed', 'confirm_overwrite', 'confirm_load', 'confirm_old_save', 'confirm_delete', 'confirm_title',
  'confirm_qload', 'history', 'history_empty', 'toast_qsaved', 'toast_no_qsave', 'toast_skip_unread', 'toast_pad_on', 'toast_pad_nonstandard', 'toast_pad_off', 'text_sounds', 'text_size', 'box_opacity', 'reduce_motion', 'timed_choices', 'timed_extended', 'timed_off', 'timed_announce', 'tab_audio', 'tab_game', 'tab_access', 'on', 'off',
  'gallery', 'locked', 'music_room', 'chapters', 'stop', 'now_playing',
  ...QUICK_ITEMS.map(i => `q_${i}`)];

function updateGameSchema() {
  const used = (op: string, key: string) => program.ops.flatMap((o: any) => (o.op === op && o[key] ? [o[key] as string] : []));
  const names = (a: string[]) => [...new Set(a)].sort();
  const num = (description: string) => ({ type: 'number', description });
  const box = (what: string, placed: boolean) => ({
    type: 'object',
    additionalProperties: false,
    description: what,
    properties: {
      ...(placed ? {
        x: num('Left edge in stage pixels.'), y: num('Top edge in stage pixels.'),
      } : {}),
      width: num('Width in pixels.'), height: num('Minimum height in pixels.'),
      padding: { description: 'Pixels: one number, or [top, right, bottom, left].', oneOf: [{ type: 'number' }, { type: 'array', items: { type: 'number' } }] },
      background: { type: 'string', description: 'CSS color, e.g. "rgba(10,13,19,.84)".' },
      border: { type: 'string', description: 'Border color.' },
      radius: num('Corner radius in pixels.'),
      image: { type: 'string', description: 'Frame art: assets/ui/<image>.png (from masters/ui/<image>.psd). Replaces background.', examples: assetNames.ui },
      slice: { description: 'Edge pixels of the image that do not stretch (9-slice): one number or [top, right, bottom, left].', oneOf: [{ type: 'number' }, { type: 'array', items: { type: 'number' } }] },
    },
  });
  const text = {
    type: 'object', additionalProperties: false, description: 'Story text.',
    properties: { size: num('Font size in pixels (44).'), color: { type: 'string' }, lineHeight: num('Line height multiplier (1.45).') },
  };
  const skin = (what: string) => ({
    type: 'object', additionalProperties: false, description: what,
    properties: {
      textbox: box('The text box. Position with x/y/width/height.', true),
      namebox: { ...box('The name tag; x/y are relative to the text box.', true), properties: { ...box('', true).properties, size: num('Font size in pixels.') } },
      text,
    },
  });
  const voice = {
    type: 'object',
    additionalProperties: false,
    description: 'A text sound voice. Use it with `define <char> ... blip=<name>`.',
    properties: {
      synth: { enum: ['square', 'triangle', 'sine', 'sawtooth'], description: 'Synthesized blip (no sound file needed).' },
      pitch: num('Synth pitch in Hz (440). Lower for deeper voices.'),
      sound: { type: 'string', description: 'Or a sample: assets/sound/<sound>.', examples: assetNames.sound },
      vowels: {
        type: 'object', additionalProperties: false, description: 'Vowel mode: a sample per vowel (assets/sound/<name>).',
        properties: Object.fromEntries(['a', 'e', 'i', 'o', 'u'].map(v => [v, { type: 'string', examples: assetNames.sound }])),
      },
      mode: { enum: ['letters', 'vowels'], default: 'letters', description: 'letters: a blip per letter. vowels: only on vowels, pitched per vowel.' },
      every: num('Blip on every Nth letter (1).'),
      interval: num('Minimum milliseconds between blips (55).'),
      variation: num('Random pitch spread in semitones (0).'),
      volume: num('0..1 (0.25 for synth, 0.8 for samples).'),
      length: num('Synth blip length in milliseconds (45).'),
    },
  };
  const characterBlips = names(Object.values(program.characters).flatMap((c: any) => (c.style?.blip ? [c.style.blip] : [])));
  const characterBoxes = names(Object.values(program.characters).flatMap((c: any) => (c.style?.box ? [c.style.box] : [])));
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: { type: 'string', description: 'Game name, shown on the title screen.' },
      id: { type: 'string', description: 'Key for saves, settings and read-text tracking. Defaults to a slug of `title`. Changing it starts with fresh saves.' },
      engine: { type: 'string', description: 'Minimum engine version, e.g. "0.1". The tools warn when the engine is older.' },
      stage: {
        type: 'object',
        additionalProperties: false,
        description: 'The stage size in pixels (default 1920x1080). Screens, hotspots and image coordinates are in these pixels; reload the preview after changing it.',
        properties: { width: { type: 'integer', minimum: 64, maximum: 8192 }, height: { type: 'integer', minimum: 64, maximum: 8192 } },
        required: ['width', 'height'],
      },
      titleScreen: {
        type: 'object',
        additionalProperties: false,
        description: 'Title screen. Preview it from "Built-in screens" in the Files panel (or Ctrl+Enter in this tab).',
        properties: {
          background: {
            type: 'string', description: 'Scene name drawn behind the menu (assets/bg/<name>.png).',
            examples: names([...used('scene', 'bg'), ...assetNames.bg]),
          },
          music: {
            type: 'string', description: 'Looping track for the title screen (assets/music/<name>.*).',
            examples: names([...used('music', 'name'), ...assetNames.music]),
          },
          showTitle: { type: 'boolean', default: true, description: 'Show the game name (turn off when the background art has a logo).' },
          align: { enum: ['left', 'center', 'right'], default: 'center', description: 'Where the title and buttons sit.' },
          buttons: {
            type: 'array', uniqueItems: true,
            description: 'Buttons in order. Leave one out to hide it.',
            items: { enum: ['new_game', 'continue', 'load', 'gallery', 'music_room', 'chapters', 'options'] },
          },
          fade: { type: 'number', minimum: 0, maximum: 5, default: 0.4, description: 'Seconds of black between the title screen and the game, both ways (0 = cut).' },
        },
      },
      intro: {
        type: 'string',
        description: 'A script label played once when the game starts, before the title screen (a cutscene; finish it with `end`). Esc skips it. Preview with the "Intro" command.',
        examples: names(Object.keys(program.labels ?? {})),
      },
      splash: {
        type: 'array',
        description: 'Logo cards shown once when the game starts, before the title screen. Click or Enter skips a card. Preview with the "Splash" command.',
        items: {
          anyOf: [
            { type: 'string', description: 'Background name (assets/bg/<name>.png).', examples: names([...used('scene', 'bg'), ...assetNames.bg]) },
            {
              type: 'object', additionalProperties: false,
              properties: {
                image: { type: 'string', description: 'Background name, centered on black.', examples: names([...used('scene', 'bg'), ...assetNames.bg]) },
                text: { type: 'string', description: 'Text under the image (or alone).' },
                duration: { type: 'number', minimum: 0, default: 2.5, description: 'Seconds the card stays fully visible.' },
                fade: { type: 'number', minimum: 0, default: 0.6, description: 'Seconds to fade in, and again to fade out.' },
              },
            },
          ],
        },
      },
      anchors: {
        type: 'object',
        description: 'Extra named anchors for "anchor=<name>" on show and move: the point a character scales, turns and mirrors about, as [fx, fy] fractions of its sprite (0,0 top left, 1,1 bottom right). Built in: feet [0.5, 1], center [0.5, 0.5], head [0.5, 0.1], top [0.5, 0].',
        additionalProperties: {
          type: 'array', minItems: 2, maxItems: 2, items: { type: 'number' },
          description: '[fx, fy]: across (0 left, 1 right) and down (0 top, 1 bottom) the sprite.',
        },
      },
      positions: {
        type: 'object',
        description: 'Extra named stage positions for "show ... at <name>" and "move ... to <name>": 0 is the left edge, 1 the right edge. A position can also set a height ({ "x": 0.7, "y": -0.15 }; negative lifts) that a line\'s own y= overrides. Built in: left (0.2), center (0.5), right (0.8).',
        additionalProperties: {
          anyOf: [
            { type: 'number', description: 'Across the stage, 0 (left edge) to 1 (right edge).' },
            {
              type: 'object', additionalProperties: false, required: ['x'],
              properties: {
                x: { type: 'number', description: 'Across the stage, 0 (left edge) to 1 (right edge).' },
                y: { type: 'number', description: 'Height offset as a fraction of the stage height; negative lifts the character. Used by show and move unless the line has y=.' },
              },
            },
          ],
        },
        examples: [{ farleft: 0.08, leftcenter: 0.35, balcony: { x: 0.7, y: -0.15 } }],
      },
      saveVersion: { type: 'integer', minimum: 0, default: 0, description: 'Raise this when a release breaks old saves: loading a save made under a lower number asks the player first.' },
      choiceSaves: { type: 'integer', minimum: 1, maximum: 20, default: 5, description: 'How many rotating choice autosaves to keep (the "C" page of the Load screen).' },
      quickMenu: {
        type: 'object',
        additionalProperties: false,
        description: 'The quick menu bar shown while playing.',
        properties: {
          items: {
            type: 'array', uniqueItems: true,
            description: 'Buttons in order; leave one out to hide it, use [] for no bar. Hotkeys work either way.',
            items: { enum: QUICK_ITEMS },
          },
          position: { enum: ['bottom', 'top'], default: 'bottom' },
          align: { enum: ['left', 'center', 'right'], default: 'center' },
        },
      },
      gallery: {
        type: 'array',
        description: 'Gallery entries (a Gallery button appears on the title screen). Each unlocks when its image has been shown while playing, or by "unlock <flag>".',
        items: {
          type: 'object', additionalProperties: false, required: ['image'],
          properties: {
            image: { type: 'string', description: 'Background name (assets/bg/<image>.png), e.g. a CG shown with "scene".', examples: names([...used('scene', 'bg'), ...assetNames.bg]) },
            title: { type: 'string' },
            unlock: { type: 'string', description: 'Unlock with this flag instead (script: unlock <flag>).', examples: names(used('unlock', 'name')) },
          },
        },
      },
      musicRoom: {
        type: 'array',
        description: 'Music room tracks (a Music button appears on the title screen). Each unlocks once it has played while playing, or by "unlock <flag>".',
        items: {
          anyOf: [
            { type: 'string', description: 'Track name (assets/music/<track>.*).', examples: names([...used('music', 'name'), ...assetNames.music]) },
            {
              type: 'object', additionalProperties: false, required: ['track'],
              properties: {
                track: { type: 'string', description: 'Track name (assets/music/<track>.*).', examples: names([...used('music', 'name'), ...assetNames.music]) },
                title: { type: 'string' },
                unlock: { type: 'string', description: 'Unlock with this flag instead (script: unlock <flag>).', examples: names(used('unlock', 'name')) },
              },
            },
          ],
        },
      },
      chapters: {
        type: 'array',
        description: 'Chapter select (a Chapters button appears on the title screen). Each starts a new playthrough at a label; it unlocks once the story has reached the label, or by "unlock <flag>".',
        items: {
          anyOf: [
            { type: 'string', description: 'Script label.', examples: names(Object.keys(program.labels ?? {})) },
            {
              type: 'object', additionalProperties: false, required: ['label'],
              properties: {
                label: { type: 'string', description: 'Script label to start at.', examples: names(Object.keys(program.labels ?? {})) },
                title: { type: 'string' },
                unlock: { type: 'string', description: 'Unlock with this flag instead (script: unlock <flag>).', examples: names(used('unlock', 'name')) },
              },
            },
          ],
        },
      },
      blips: {
        type: 'object',
        description: 'Text sound voices by name. Built in: high, mid, low, soft, typewriter, robot (a voice here with the same name replaces it).',
        propertyNames: { examples: characterBlips },
        additionalProperties: voice,
      },
      labels: {
        type: 'object',
        description: 'Menu label text in the source language. Other languages: "ui.<key>" in locale/<lang>.json.',
        additionalProperties: false,
        properties: Object.fromEntries(LABEL_KEYS.map(k => [k, { type: 'string' }])),
      },
      theme: {
        ...skin('Look of the text box, name tag, text and choices. Fonts in assets/fonts/ can be used by file name.'),
        properties: {
          accent: { type: 'string', description: 'Highlight color for menus and sliders, e.g. "#5fd1c3".' },
          hotFill: { type: 'string', description: 'Fill of a hovered or focused hotspot or button in screens and HUDs, e.g. "rgba(255,255,255,.18)".' },
          hotBorder: { type: 'string', description: 'Border color of that highlight (default: accent).' },
          hotBorderWidth: num('Border width of that highlight in stage pixels (default 2).'),
          tipBackground: { type: 'string', description: 'Background color of hotspot tooltips.' },
          tipColor: { type: 'string', description: 'Text color of hotspot tooltips.' },
          tipFont: { type: 'string', description: 'Font of hotspot tooltips (a font in assets/fonts/ or an installed one); default: the theme font.', examples: assetNames.fonts },
          font: { type: 'string', description: 'Font for story text and menus: a font in assets/fonts/ (file name) or an installed one.', examples: assetNames.fonts },
          ...skin('').properties,
          choices: {
            ...box('Choice buttons.', false),
            properties: { ...box('', false).properties, size: num('Font size in pixels.'), gap: num('Space between buttons.') },
          },
          skins: {
            type: 'object',
            description: 'Per-character looks: `define alice ... box=alice` uses skins.alice while Alice speaks.',
            propertyNames: { examples: characterBoxes },
            additionalProperties: skin('Overrides while a character with this box= speaks.'),
          },
        },
      },
    },
  };
  monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
    validate: true,
    schemas: [{ uri: 'vn://schema/game.json', fileMatch: [GAME_URI], schema }, ...rigSchemas()],
  });
}

/** One schema per open rig.json tab, so completions offer that character's parts, slots and variants. */
function rigSchemas() {
  return [...files.values()].flatMap(f => {
    const manifest = f.kind === 'rig' && f.char ? projectAssets.rigs[f.char] : undefined;
    if (!manifest) return [];
    const slots = manifest.parts.filter(p => p.slot && p.variants);
    const variants = (slot: string) => [...Object.keys(slots.find(p => p.slot === slot)?.variants ?? {}), 'none'];
    const everyVariant = [...new Set(slots.flatMap(p => Object.entries(p.variants!).flatMap(([n, v]) => [n, ...(v.poses ?? [])])))];
    const str = (description: string, examples: string[]) => ({ type: 'string', description, examples });
    return [{
      uri: `vn://schema/rig/${f.char}`,
      fileMatch: [`file:///${f.name}`],
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          order: {
            type: 'array',
            description: 'Part names bottom to top. Listed parts swap among the positions they hold; the rest stay where the PSD had them.',
            items: str('A slot, or a plain layer\'s file name without .png.', manifest.parts.map(partName)),
          },
          groups: {
            type: 'object',
            description: 'One name that sets several slots at once: "outfit": ["outfit_back", "outfit_front"] makes outfit=school set both.',
            additionalProperties: { type: 'array', items: str('A slot.', slots.map(p => p.slot!)) },
          },
          poses: {
            type: 'object',
            description: 'Named shorthands for `show`: a pose plus slot or group overrides. Overrides on the show line win.',
            additionalProperties: {
              type: 'object',
              properties: {
                pose: str('The base pose: a layer name or alias from the PSD.', everyVariant),
                ...Object.fromEntries(slots.map(p => [p.slot!, str(`Variant of ${p.slot}, or none.`, variants(p.slot!))])),
              },
              additionalProperties: { type: 'string' },
            },
          },
          pivots: {
            type: 'object',
            description: 'Where a part turns and scales from, in pixels of the PSD canvas ([x, y] from the top left). Without one it is the middle of the part\'s image.',
            additionalProperties: false,
            properties: Object.fromEntries(manifest.parts.map(p => [partName(p), { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number' }, description: `Pivot of ${partName(p)}: [x, y].` }])),
          },
          idle: {
            type: 'string',
            description: 'An animation (a preset or one of "animations") that loops while the character is on stage.',
            examples: [...ANIM_NAMES],
          },
          speak: {
            type: 'object',
            description: 'What the character does while one of its lines types: cycle a slot through variants and/or loop an animation.',
            additionalProperties: false,
            properties: {
              variants: { type: 'array', description: 'Variants of the slot, shown in turn while talking (say open, then neutral).', items: str('A variant of the slot.', variants('mouth')) },
              slot: str('The slot to cycle (default mouth).', slots.map(p => p.slot!)),
              rate: { type: 'number', exclusiveMinimum: 0, description: 'Variant changes per second (default 8).' },
              anim: { type: 'string', description: 'An animation to loop while talking (a preset or one of "animations").', examples: [...ANIM_NAMES] },
            },
          },
          blink: {
            description: 'Blink by itself: true, or an object. The slot variant is swapped in briefly at random intervals; an explicit slot=variant in the script wins.',
            oneOf: [
              { type: 'boolean' },
              {
                type: 'object',
                additionalProperties: false,
                properties: {
                  slot: str('The eyes slot (default eyes).', slots.map(p => p.slot!)),
                  variant: str('The closed-eyes variant (default closed).', variants('eyes')),
                  every: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number', exclusiveMinimum: 0 }, description: '[min, max] seconds between blinks (default [3, 6]).' },
                  dur: { type: 'number', exclusiveMinimum: 0, description: 'Seconds the eyes stay shut (default 0.12).' },
                },
              },
            ],
          },
          animations: {
            type: 'object',
            description: 'Keyframe animations for `animate <char> <name>`. A name equal to a preset (bob, sway...) replaces it for this character.',
            additionalProperties: {
              type: 'object',
              required: ['keys'],
              additionalProperties: false,
              properties: {
                dur: { type: 'number', exclusiveMinimum: 0, description: 'Default length in seconds (1 when left out); `animate` can give another.' },
                keys: {
                  type: 'array',
                  minItems: 1,
                  description: 'Keys at progress t (0-1). Each channel is eased between its own keys and is 0 at both ends unless a key says otherwise.',
                  items: {
                    type: 'object',
                    required: ['t'],
                    additionalProperties: false,
                    properties: {
                      t: { type: 'number', minimum: 0, maximum: 1, description: 'Progress through the animation, 0 to 1.' },
                      part: str('Move this part of the character (about its pivot) instead of the whole body.', manifest.parts.map(partName)),
                      x: { type: 'number', description: 'Sideways offset, as a fraction of the stage height.' },
                      y: { type: 'number', description: 'Vertical offset, as a fraction of the stage height (negative = up).' },
                      scale: { type: 'number', description: 'Added to the size: 0.05 is 5% bigger.' },
                      rot: { type: 'number', description: 'Tilt in degrees, clockwise.' },
                      ease: { type: 'string', enum: EASE_NAMES, description: 'Easing of the way to this key (default inout).' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }];
  });
}

// ---- preview link ----
function showPreviewLine() {
  decorations?.clear();
  if (!previewPos || previewPos.file !== active) return;
  const { line } = previewPos;
  decorations.set([{
    range: new monaco.Range(line, 1, line, 1),
    options: { isWholeLine: true, className: 'vn-preview-line', linesDecorationsClassName: 'vn-preview-gutter' },
  }]);
  if (followEl.checked) editor.revealLineInCenterIfOutsideViewport(line);
}

window.addEventListener('message', e => {
  if (e.origin !== location.origin || e.source !== preview.contentWindow) return;
  const m = e.data as { type?: string; file?: string; line?: number } | null;
  if (m?.type !== 'position' || typeof m.file !== 'string' || typeof m.line !== 'number') return;
  // Follow only when the story moves: a hot reload reports the same position again, and must not pull
  // you away from the file you are editing. Following never leaves game.json either.
  const moved = previewPos?.file !== m.file || previewPos.line !== m.line;
  previewPos = { file: m.file, line: m.line };
  if (followEl.checked && moved && m.file !== active && files.has(m.file) && files.get(active)?.kind === 'script') activate(m.file);
  else showPreviewLine();
});

// The preview's error banner asks to jump to the line of a problem.
window.addEventListener('message', e => {
  if (e.origin !== location.origin || e.source !== preview.contentWindow) return;
  const m = e.data as { type?: string; file?: string; line?: number } | null;
  if (m?.type !== 'showLine' || typeof m.file !== 'string' || typeof m.line !== 'number' || !files.has(m.file)) return;
  if (m.file !== active) activate(m.file);
  const line = Math.min(Math.max(m.line, 1), files.get(m.file)!.model.getLineCount());
  editor.setPosition({ lineNumber: line, column: 1 });
  editor.revealLineInCenter(line);
  editor.focus();
});

// Live story variables, sent by the preview with every line; values that just changed are highlighted.
const varsEl = $('vars'), varsList = $('varsList');
let lastVars: Record<string, unknown> = {};
function showVars(vars: Record<string, unknown>) {
  const names = Object.keys(vars).sort();
  varsList.replaceChildren(...(names.length ? names.flatMap(n => {
    const dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = n;
    dd.textContent = typeof vars[n] === 'string' || Array.isArray(vars[n]) ? JSON.stringify(vars[n]) : String(vars[n]);
    if (!n.includes('.') || n.startsWith('persistent.')) { // unlocked.<flag> entries are read-only
      dd.title = 'Double-click to edit (true/false, a number, text, or a list like ["a", "b"])';
      dd.addEventListener('dblclick', () => editVar(n, dd));
    }
    if (n in lastVars && JSON.stringify(lastVars[n]) !== JSON.stringify(vars[n]) || !(n in lastVars) && Object.keys(lastVars).length) dd.className = 'changed';
    return [dt, dd];
  }) : [Object.assign(document.createElement('div'), { className: 'none', textContent: 'No variables set yet.' })]));
  lastVars = vars;
}
function editVar(name: string, dd: HTMLElement) {
  const input = document.createElement('input');
  input.value = dd.textContent ?? '';
  input.className = 'varEdit';
  let done = false;
  const finish = (commit: boolean) => {
    if (done) return;
    done = true;
    if (commit) preview.contentWindow?.postMessage({ type: 'setVar', name, value: parseVarValue(input.value) }, location.origin);
    else showVars(lastVars);
  };
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(false));
  dd.replaceChildren(input);
  input.focus();
  input.select();
}
window.addEventListener('message', e => {
  if (e.origin !== location.origin || e.source !== preview.contentWindow) return;
  const m = e.data as { type?: string; vars?:Record<string, unknown>; file?: string; line?: number } | null;
  if (m?.type === 'goto-error' && typeof m.file === 'string' && typeof m.line === 'number') goToLine(m.file, m.line);
  else if (m?.type === 'vars' && m.vars && !varsEl.hidden) showVars(m.vars);
  else if (m?.type === 'vars' && m.vars) lastVars = m.vars;
});

function previewTitle() {
  preview.contentWindow?.postMessage({ type: 'title' }, location.origin);
}

function previewScreen(name: string) {
  preview.contentWindow?.postMessage({ type: 'screen', name }, location.origin);
}

async function previewFromCursor() {
  const f = files.get(active);
  if (!f) return;
  clearTimeout(f.timer);
  await save(f);
  if (f.kind !== 'script') { previewTitle(); return; }
  const pos = editor.getPosition();
  preview.contentWindow?.postMessage({ type: 'goto', file: active, line: pos.lineNumber }, location.origin);
}

// ---- toolbar actions ----
function addIds() {
  const f = files.get(active);
  if (!f) return;
  if (f.kind !== 'script') { setStatus('ids are only for script files'); return; }
  const taken = existingIds(scripts().map(x => x.model.getValue()));
  const lines: string[] = f.model.getLinesContent();
  const { text, added } = assignIds(lines.join('\n'), taken);
  if (!added) { setStatus('every line in this file already has an id'); return; }
  const out = text.split('\n');
  const edits: any[] = [];
  out.forEach((l, i) => {
    if (l !== lines[i]) edits.push({ range: new monaco.Range(i + 1, 1, i + 1, lines[i].length + 1), text: l });
  });
  editor.executeEdits('vn-ids', edits);
  setStatus(`added ${added} ids`);
}

async function newFile(given?: string, starter?: string) {
  const raw = given ?? window.prompt('New script file name (e.g. chapter2):');
  if (!raw) return;
  const base = raw.trim().replace(/\.vn$/, '');
  if (!/^[\w\-./]+$/.test(base) || base.includes('..')) { setStatus('invalid file name'); return; }
  const name = `${base}.vn`;
  if (files.has(name)) { activate(name); return; }
  const text = starter ?? `# ${name}\n`;
  const r = await fetch(`/api/script?file=${encodeURIComponent(name)}`, {
    method: 'PUT', headers: { 'X-VN-Editor': '1', 'Content-Type': 'text/plain' }, body: text,
  });
  if (!r.ok) { setStatus('could not create file'); return; }
  addFile(name, text);
  recompile();
  activate(name);
}

// Pick up edits made outside the editor (for example in VS Code) when the file is not dirty here.
async function syncFromDisk() {
  let proj: Project;
  try { proj = await (await fetch('/api/project')).json(); } catch { return; }
  setAssets(proj);
  const list = [...proj.scripts];
  if (proj.gameText !== null) list.push({ file: GAME, text: proj.gameText });
  let changed = false;
  for (const s of list) {
    const f = files.get(s.file);
    if (!f) { addFile(s.file, s.text); changed = true; continue; }
    if (norm(s.text) === norm(f.saved)) continue;
    if (norm(f.model.getValue()) !== norm(f.saved)) continue; // unsaved local edits win
    f.saved = s.text;
    f.model.pushEditOperations([], [{ range: f.model.getFullModelRange(), text: s.text }], () => null);
    changed = true;
  }
  // Open rig.json tabs follow the disk the same way (they are never opened here: see openRig).
  for (const [char, text] of Object.entries(proj.rigTexts ?? {})) {
    const f = files.get(rigName(char));
    if (!f || norm(text) === norm(f.saved) || norm(f.model.getValue()) !== norm(f.saved)) continue;
    f.saved = text;
    f.model.pushEditOperations([], [{ range: f.model.getFullModelRange(), text }], () => null);
    changed = true;
  }
  if (changed) { recompile(); renderTabs(); }
}

function setupSplitter() {
  const split = $('split');
  split.addEventListener('pointerdown', e => {
    split.setPointerCapture(e.pointerId);
    split.classList.add('drag');
    preview.style.pointerEvents = 'none';
    const move = (ev: PointerEvent) => {
      const px = Math.min(Math.max(window.innerWidth - ev.clientX, 280), window.innerWidth - 320 - sidebarEl.offsetWidth);
      document.documentElement.style.setProperty('--right', `${px}px`);
    };
    const up = () => {
      split.classList.remove('drag');
      preview.style.pointerEvents = '';
      split.removeEventListener('pointermove', move);
      split.removeEventListener('pointerup', up);
    };
    split.addEventListener('pointermove', move);
    split.addEventListener('pointerup', up);
  });
}

// ---- commands and the Ctrl+P palette ----
// To add a command: add an entry to the list in buildCommands(). `key` binds it in the code editor and shows
// in the palette; `when` hides it where it does not apply.
interface Command {
  title: string;
  key?: { code: number; label: string };
  when?: () => boolean;
  run(): void | Promise<void>;
}

let palette: Palette;
let help: HelpDialog;
let outlineView: OutlineView;
const toggleOutline = () => outlineView.toggle(buildOutline(program), () => editor.focus());

/** F1 / Help button: the command reference at the statement under the cursor; a game.json tab shows docs/game-json.md,
 *  a rig.json tab docs/rig-json.md at the key (order, groups, poses) the cursor is under. */
function toggleHelp() {
  const kind = files.get(active)?.kind;
  let key: string | null = null;
  if (isScript()) {
    const pos = editor.getPosition();
    key = helpTopicAt(editor.getModel().getLineContent(pos.lineNumber), pos.column - 1);
  } else if (kind === 'rig') {
    key = rigHelpTopicAt(editor.getModel().getLinesContent(), editor.getPosition().lineNumber - 1);
  }
  help.toggle(key, () => editor.focus(), isScript() ? 'commands' : kind === 'rig' ? 'rig-json' : 'game-json');
}
const RECENT_COMMANDS = 'vn.editor.recentCommands';

const isScript = () => files.get(active)?.kind === 'script';
const postPreview = (msg: object) => preview.contentWindow?.postMessage(msg, location.origin);

function saveFile(f: FileState | undefined) {
  if (f) { clearTimeout(f.timer); void save(f); }
}

function addIdsEverywhere() {
  let total = 0;
  for (const f of scripts()) {
    const taken = existingIds(scripts().map(x => x.model.getValue()));
    const { text, added } = assignIds(f.model.getValue(), taken);
    if (!added) continue;
    f.model.pushEditOperations([], [{ range: f.model.getFullModelRange(), text }], () => null);
    total += added;
  }
  setStatus(total ? `added ${total} ids` : 'every line already has an id');
}

function goToLine(name: string, line: number) {
  activate(name);
  editor.revealLineInCenter(line);
  editor.setPosition({ lineNumber: line, column: 1 + (editor.getModel().getLineContent(line).match(/^\s*/)?.[0].length ?? 0) });
  editor.focus();
}

/** Jump to the next error or warning in any file, game.json and rigs included, activating that file's tab. */
function nextProblem() {
  interface Found { m: { startLineNumber: number; startColumn: number }; name: string }
  const all: Found[] = (monaco.editor.getModelMarkers({}) as { severity: number; resource: { toString(): string }; startLineNumber: number; startColumn: number }[])
    .filter(m => m.severity >= monaco.MarkerSeverity.Warning)
    .map(m => ({ m, name: [...files.values()].find(f => f.model.uri.toString() === m.resource.toString())?.name ?? '' }))
    .filter(p => p.name);
  if (!all.length) return;
  const order = [...files.keys()];
  const key = (name: string, line: number, col: number) => [order.indexOf(name), line, col];
  const cmp = (a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  all.sort((a, b) => cmp(key(a.name, a.m.startLineNumber, a.m.startColumn), key(b.name, b.m.startLineNumber, b.m.startColumn)));
  const pos = editor.getPosition();
  const here = key(active, pos?.lineNumber ?? 0, pos?.column ?? 0);
  const next = all.find(p => cmp(key(p.name, p.m.startLineNumber, p.m.startColumn), here) > 0) ?? all[0];
  activate(next.name);
  editor.setPosition({ lineNumber: next.m.startLineNumber, column: next.m.startColumn });
  editor.revealLineInCenter(next.m.startLineNumber);
  editor.focus();
}

/** Open a character's rig.json in a tab. Without a file yet the tab starts from a generated skeleton and stays unsaved. */
function openRig(char: string) {
  const name = rigName(char);
  if (files.has(name)) { activate(name); return; }
  const manifest = projectAssets.rigs[char];
  if (!manifest) { setStatus(`${char} has no sprite.json (convert its PSD first)`); return; }
  const onDisk = projectAssets.rigTexts[char];
  const f = addFile(name, onDisk ?? `${JSON.stringify(rigSkeleton(manifest), null, 2)}\n`, 'rig', char);
  if (onDisk === undefined) { f.saved = ''; setStatus(`${name} is new: Ctrl+S saves the generated skeleton`); }
  recompile();
  activate(name);
}

/** Add parts that are new in the converted art to the open rig.json's order; report ones that disappeared. */
function updateRigFromArt() {
  const f = files.get(active);
  const manifest = f?.kind === 'rig' && f.char ? projectAssets.rigs[f.char] : undefined;
  if (!f || !manifest) return;
  let data;
  try { data = JSON.parse(f.model.getValue()); } catch { setStatus(`${f.name} has errors; fix them first`); return; }
  const { rig, added, missing } = mergeRig(data, manifest);
  if (added.length) f.model.pushEditOperations([], [{ range: f.model.getFullModelRange(), text: `${JSON.stringify(rig, null, 2)}\n` }], () => null);
  setStatus([added.length ? `added to order: ${added.join(', ')}` : 'order already has every part',
    missing.length ? `no longer in the art: ${missing.join(', ')}` : ''].filter(Boolean).join('; '));
}

let animStudio: AnimStudio;
/** Open the animation studio for `char` (opening its rig.json tab) or else for the character of the active rig.json tab; unsaved text counts. */
/** game.json as the tab holds it (unsaved edits count); null while it does not parse. */
function openGame(): unknown {
  try { return JSON.parse(files.get(GAME)?.model.getValue() ?? '{}'); } catch { return null; }
}

function openAnimStudio(char?: string) {
  if (char) openRig(char);
  const f = files.get(active);
  if (f?.kind !== 'rig' || !f.char) return;
  let data;
  try { data = JSON.parse(f.model.getValue()); } catch { setStatus(`${f.name} has errors; fix them first`); return; }
  const object = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, never> : {});
  const manifest = projectAssets.rigs[f.char];
  let applied = readRigSettings(data);
  const slots: Record<string, string[]> = {};
  for (const part of manifest?.parts ?? []) if (part.slot && part.variants) slots[part.slot] = Object.keys(part.variants);
  animStudio.open(f.char, { anims: object(data?.animations), pivots: object(data?.pivots), rig: applied }, {
    returnFocus: () => editor.focus(),
    positions: namedPositions(openGame()),
    anchors: namedAnchors(openGame()),
    parts: manifest ? rigPartNames(manifest) : [],
    poses: manifest ? rigPoseNames(manifest) : [],
    slots,
    width: manifest?.width ?? 0,
    height: manifest?.height ?? 0,
    shown: manifest ? (pose, overrides) => rigLayers(manifest, pose, overrides).map(l => l.part) : undefined,
    apply: change => {
      const writes: RigWrite[] = [{ key: 'animations', value: change.anims }, { key: 'pivots', value: change.pivots }];
      const now = change.rig;
      if (now.idle !== applied.idle) writes.push({ key: 'idle', value: now.idle });
      // The file's own `speak` and `blink` are the base, so keys the studio does not edit (and unknown ones) survive.
      let current: Record<string, unknown> = {};
      try { current = JSON.parse(f.model.getValue()); } catch { /* the write below reports it */ }
      if (speakPart(now) !== speakPart(applied)) writes.push({ key: 'speak', value: speakValue(current.speak, now) });
      if (blinkPart(now) !== blinkPart(applied)) writes.push({ key: 'blink', value: blinkValue(current.blink, now) });
      const ok = writeRigProperties(f, writes);
      if (ok) applied = now;
      return ok;
    },
  });
}

/** A top-level property of rig.json to put in; a null value removes the property. */
interface RigWrite { key: string; value: unknown }

/**
 * Put values for top-level properties of the rig.json tab (what the studio edits) in as one undo step.
 * Only those values change, the rest of the file keeps its layout; an empty `animations` or `pivots` is not added to a file that lacks it.
 */
function writeRigProperties(f: FileState, writes: RigWrite[]): boolean {
  try { JSON.parse(f.model.getValue()); } catch { setStatus(`${f.name} has errors; fix them first`); return false; }
  f.model.pushStackElement();
  for (const { key, value } of writes) {
    const text = f.model.getValue();
    const has = new RegExp(`"${key}"\s*:`).test(text);
    const empty = value === null || (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value as object).length);
    if (empty && !has) continue;
    const edit = value === null ? removeTopLevelProperty(text, key) : setTopLevelProperty(text, key, value);
    if (!edit) { if (value === null) continue; setStatus(`${f.name} is not a JSON object`); return false; }
    const from = f.model.getPositionAt(edit.start), to = f.model.getPositionAt(edit.end);
    f.model.pushEditOperations([], [{ range: new monaco.Range(from.lineNumber, from.column, to.lineNumber, to.column), text: edit.insert }], () => null);
  }
  f.model.pushStackElement();
  setStatus(`studio changes of ${f.char} applied to ${f.name}`);
  return true;
}

const outputEl = $('taskOutput'), outputText = $('taskOutputText');

/** Play every route of the story as it is in the editor (unsaved edits count); the findings go to the Output panel and the scripts as problems. */
function runPlaytest() {
  setStatus('playtest...');
  let game: unknown = null;
  try { game = JSON.parse(files.get(GAME)?.model.getValue() ?? '{}'); } catch { /* the JSON tab shows its own errors */ }
  const report = playtest(program, { game, assets: assetIndex(), allLabels: true });
  monaco.editor.removeAllMarkers('vn-playtest');
  const found = playtestDiagnostics(report);
  for (const f of scripts()) {
    const marks = found.filter(d => d.file === f.name).map(d => {
      const line = Math.min(Math.max(d.line, 1), f.model.getLineCount());
      return {
        severity: monaco.MarkerSeverity.Warning, message: `Playtest: ${d.message}`,
        startLineNumber: line, endLineNumber: line, startColumn: 1, endColumn: f.model.getLineMaxColumn(line),
      };
    });
    monaco.editor.setModelMarkers(f.model, 'vn-playtest', marks);
  }
  outputText.textContent = playtestText(report);
  outputEl.hidden = false;
  setStatus(`playtest: ${report.endings.length} endings, ${found.length} problem${found.length === 1 ? '' : 's'}${report.complete ? '' : ' (incomplete)'}`);
}
async function runTask(name: string, label: string) {
  setStatus(`${label}...`);
  try {
    const r = await fetch(`/api/task?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'X-VN-Editor': '1' } });
    const res = await r.json() as { ok: boolean; output: string };
    setStatus(`${label}: ${res.ok ? 'done' : 'failed'} (see Output)`);
    outputText.textContent = res.output.trim() || '(no output)';
    outputEl.hidden = false;
  } catch {
    setStatus(`${label}: could not reach the dev server`);
  }
}

function buildCommands(): Command[] {
  const K = monaco.KeyMod, C = monaco.KeyCode;
  return [
    { title: 'Go to File', key: { code: K.CtrlCmd | C.KeyP, label: 'Ctrl+P' }, run: () => palette.setText('') },
    { title: 'Go to Label', run: () => palette.setText('@') },
    { title: 'Go to Line', run: () => palette.setText(':') },
    { title: 'Rename Label or Variable (F2 on a name)', run: () => editor.getAction('editor.action.rename')?.run() },
    { title: 'Find and Replace in All Files', key: { code: K.CtrlCmd | K.Shift | C.KeyF, label: 'Ctrl+Shift+F' }, run: openFind },
    { title: 'Story: Show Outline (label flowchart)', run: toggleOutline },
    { title: 'Story: Playtest All Routes (unreachable lines, endings, unused assets and variables)', run: runPlaytest },
    { title: 'Help: Command Reference (for the statement at the cursor)', key: { code: C.F1, label: 'F1' }, run: toggleHelp },
    { title: 'Preview from Cursor', key: { code: K.CtrlCmd | C.Enter, label: 'Ctrl+Enter' }, run: () => previewFromCursor() },
    { title: 'Preview: Splash (game.json splash cards)', run: () => postPreview({ type: 'splash' }) },
    { title: 'Preview: Intro (game.json intro label)', run: () => postPreview({ type: 'intro' }) },
    { title: 'Preview: New Game', run: () => postPreview({ type: 'restart' }) },
    { title: 'Preview: Reload', run: () => preview.contentWindow?.location.reload() },
    { title: 'Preview: Toggle Follow', run: () => { followEl.checked = !followEl.checked; showPreviewLine(); setStatus(`follow preview ${followEl.checked ? 'on' : 'off'}`); } },
    { title: 'Preview: Show or Hide Variables', run: () => { varsEl.hidden = !varsEl.hidden; if (!varsEl.hidden) showVars(lastVars); } },
    { title: 'Preview: Show or Hide Pane', run: () => { document.body.classList.toggle('no-preview'); } },
    { title: 'Preview: Reset Player Data (saves, settings, unlocks, read text)', run: () => {
      if (!window.confirm('Delete all saves, settings, unlocks and read-text records of the preview in this browser?')) return;
      for (const k of Object.keys(localStorage)) if (k.startsWith('vn.') && !k.startsWith('vn.editor.')) localStorage.removeItem(k);
      preview.contentWindow?.location.reload();
      setStatus('player data reset');
    } },
    { title: 'Add Localization IDs to This File', when: isScript, run: addIds },
    { title: 'Add Localization IDs to All Files', run: addIdsEverywhere },
    { title: 'New Script File', run: () => newFile() },
    { title: 'View: Show or Hide Files Panel', key: { code: K.CtrlCmd | C.KeyB, label: 'Ctrl+B' }, run: () => setSidebar(sidebarEl.hidden) },
    { title: 'Close Tab', key: { code: K.Alt | C.KeyW, label: 'Alt+W' }, when: () => active !== '' || !!stock, run: () => (stock ? closeStock() : closeTab(active)) },
    { title: 'Save', key: { code: K.CtrlCmd | C.KeyS, label: 'Ctrl+S' }, run: () => saveFile(files.get(active)) },
    { title: 'Save All', run: () => { for (const f of files.values()) saveFile(f); } },
    { title: 'Open game.json (title screen, menus, theme)', when: () => active !== GAME, run: () => activate(GAME) },
    { title: 'Character: Edit Rig (z-order, groups, shorthands)', run: () => palette.setText('#char/') },
    { title: 'Character: Update Rig from Reconverted Art', when: () => files.get(active)?.kind === 'rig', run: updateRigFromArt },
    { title: 'Character: Animation Studio (play and inspect animations)', run: () => {
      if (files.get(active)?.kind === 'rig') openAnimStudio(); else palette.setText('#char/'); // no rig tab: pick a character first
    } },
    { title: 'Next Problem', key: { code: C.F8, label: 'F8' }, run: nextProblem },
    { title: 'Previous Problem', key: { code: K.Shift | C.F8, label: 'Shift+F8' }, run: () => editor.trigger('vn', 'editor.action.marker.prevInFiles', null) },
    { title: 'Toggle Word Wrap', key: { code: K.Alt | C.KeyZ, label: 'Alt+Z' }, run: () => {
      editor.updateOptions({ wordWrap: editor.getOption(monaco.editor.EditorOption.wordWrap) === 'on' ? 'off' : 'on' });
    } },
    { title: 'Toggle Minimap', run: () => editor.updateOptions({ minimap: { enabled: !editor.getOption(monaco.editor.EditorOption.minimap).enabled } }) },
    { title: 'Export Web Build (build/web)', run: () => runTask('export', 'export') },
    { title: 'Open Exported Game', run: () => { window.open('/build/web/', '_blank', 'noopener'); } },
    { title: 'Export Strings (locale/en.json, report untranslated)', run: () => runTask('strings', 'strings') },
    { title: 'Reconvert All Art (masters/ to assets/)', run: () => runTask('art', 'art') },
  ];
}

function setupPalette() {
  const commands = buildCommands();
  for (const c of commands) if (c.key) editor.addCommand(c.key.code, () => void c.run());

  let recentCommands: string[] = [];
  try { recentCommands = JSON.parse(localStorage.getItem(RECENT_COMMANDS) ?? '[]'); } catch { /* none yet */ }
  const ran = (title: string) => {
    recentCommands = [title, ...recentCommands.filter(t => t !== title)].slice(0, 20);
    try { localStorage.setItem(RECENT_COMMANDS, JSON.stringify(recentCommands)); } catch { /* ignore */ }
  };

  const errorsIn = errorCount;

  const fileMode: PaletteMode = {
    prefix: '', title: 'Go to file', placeholder: 'Go to file (type > for commands, @ for labels, : for a line, ? for help)',
    items: q => {
      // Recently used first, the current file last: Ctrl+P, Enter flips between the last two files.
      const order = (name: string) => (name === active ? 1e6 : recentFiles.includes(name) ? recentFiles.indexOf(name) : 1e5);
      const all = [...files.values()].sort((a, b) => order(a.name) - order(b.name));
      const items: PaletteItem[] = rank(all, q, f => f.name).map(({ entry: f, hits }) => ({
        label: f.name, hits,
        hint: [norm(f.model.getValue()) !== norm(f.saved) ? '•' : '', errorsIn(f) ? `${errorsIn(f)} error${errorsIn(f) > 1 ? 's' : ''}` : '',
          f.name === active ? 'current' : ''].filter(Boolean).join('  '),
        run: () => activate(f.name),
      }));
      const base = q.trim().replace(/\.vn$/, '');
      if (base && /^[\w\-./]+$/.test(base) && !base.includes('..') && !files.has(`${base}.vn`) && !files.has(q.trim())) {
        items.push({ label: `Create ${base}.vn`, className: 'create', run: () => void newFile(base) });
      }
      return items;
    },
  };

  const commandMode: PaletteMode = {
    prefix: '>', title: 'Commands', placeholder: 'Run a command',
    items: q => {
      const ours = commands.filter(c => !c.when || c.when());
      const order = (t: string) => (recentCommands.includes(t) ? recentCommands.indexOf(t) : 1e5);
      const own: PaletteItem[] = [...ours].sort((a, b) => order(a.title) - order(b.title)).map(c => ({
        label: c.title, hint: c.key?.label, run: () => { ran(c.title); void c.run(); },
      }));
      // Everything Monaco can do (comment lines, find, change case, ...), after ours.
      // They only appear once something is typed, so the bare list shows the project's own commands.
      const editorActions: PaletteItem[] = (editor.getSupportedActions() as any[])
        .filter(a => q.trim() && a.id !== 'editor.action.quickCommand' && a.label)
        .sort((a, b) => a.label.localeCompare(b.label))
        .map(a => ({ label: a.label, detail: 'editor', run: () => { editor.focus(); void a.run(); } }));
      return rank([...own, ...editorActions], q, i => i.label).map(({ entry, hits }) => ({ ...entry, hits }));
    },
  };

  const labelMode: PaletteMode = {
    prefix: '@', title: 'Go to label', placeholder: 'Go to label',
    items: q => {
      const labels = scripts().flatMap(f => (f.model.getLinesContent() as string[]).flatMap((text, i) => {
        const m = /^\s*label\s+([A-Za-z_]\w*)\s*(?:\([^()]*\))?\s*:/.exec(text);
        return m ? [{ name: m[1], file: f.name, line: i + 1 }] : [];
      }));
      return rank(labels, q, l => l.name).map(({ entry: l, hits }) => ({
        label: l.name, hits, detail: `${l.file}:${l.line}`, run: () => goToLine(l.file, l.line),
      }));
    },
  };

  const lineMode: PaletteMode = {
    prefix: ':', title: 'Go to line', placeholder: 'Go to line number',
    items: q => {
      const count = editor.getModel()?.getLineCount() ?? 0;
      const n = Number(q);
      if (!q || !Number.isInteger(n) || n < 1) return [{ label: `Type a line number (1-${count})`, className: 'empty', run: () => {} }];
      const line = Math.min(n, count);
      return [{ label: `Go to line ${line}`, detail: active, run: () => goToLine(active, line) }];
    },
  };

  // Assets: a character with art opens its rig.json; anything else opens in a browser tab (images, audio).
  const assetMode: PaletteMode = {
    prefix: '#', title: 'Go to asset', placeholder: 'Assets (characters open their rig.json, others open in a viewer)',
    items: q => {
      const chars = Object.keys(projectAssets.rigs).sort();
      const entries: PaletteItem[] = [
        ...chars.map(c => ({
          label: `char/${c}`, detail: files.has(rigName(c)) ? 'rig.json (open)' : c in projectAssets.rigTexts ? 'rig.json' : 'rig.json (new)',
          run: () => openRig(c),
        })),
        ...projectAssets.files
          .filter(file => !chars.some(c => file.startsWith(`char/${c}/`)) && !file.endsWith('.gitkeep'))
          .map(file => ({
            label: file, detail: file.split('/')[0],
            run: () => openAsset(file, projectAssets.files.filter(x => x.split('/')[0] === file.split('/')[0])),
          })),
      ];
      return rank(entries, q, e => e.label).map(({ entry, hits }) => ({ ...entry, hits }));
    },
  };

  const modes = [fileMode, commandMode, labelMode, lineMode, assetMode];
  const helpMode: PaletteMode = {
    prefix: '?', title: 'Help', placeholder: 'Pick a mode',
    items: () => modes.map(m => ({ label: `${m.prefix || '(nothing)'}  ${m.title}`, run: () => palette.setText(m.prefix) })),
  };
  palette = new Palette($('left'), [...modes, helpMode], () => editor.focus());
  help = new HelpDialog(document.body);
  assetViewer = new AssetViewer(document.body);
  animStudio = new AnimStudio(document.body);
  outlineView = new OutlineView(document.body, goToLine);

  // Ctrl+P and F1 work wherever focus is (capture phase beats Monaco and the browser's print shortcut),
  // including inside the preview, which is same-origin. Ctrl+P is the palette (type > for commands); F1 is help.
  const onKey = (e: KeyboardEvent) => {
    const ctrlP = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'p';
    const f1 = e.key === 'F1' && !e.ctrlKey && !e.altKey && !e.metaKey;
    if (!(ctrlP || f1)) return;
    if (f1) { e.preventDefault(); e.stopPropagation(); if (!palette.isOpen) toggleHelp(); return; }
    if (palette.isOpen || help.isOpen || assetViewer.isOpen || animStudio.isOpen) return;
    e.preventDefault();
    e.stopPropagation();
    palette.open('');
  };
  window.addEventListener('keydown', onKey, true);
  const hookPreview = () => preview.contentWindow?.addEventListener('keydown', onKey, true);
  preview.addEventListener('load', hookPreview);
  if (preview.contentDocument?.readyState === 'complete') hookPreview();
}

// ---- label rename (F2) and find in files ----
/** The scripts and game.json as plain text, for the engine's refactoring functions (unsaved edits count). */
const projectFiles = (): ProjectFile[] => [...files.values()].filter(f => f.kind !== 'rig').map(f => ({ name: f.name, text: f.model.getValue() }));

/** Apply engine edits to the open models, one undo step per file. */
function applyEdits(edits: LabelEdit[]) {
  for (const f of files.values()) {
    const mine = edits.filter(e => e.file === f.name);
    if (!mine.length) continue;
    f.model.pushEditOperations([], mine.map(e => ({
      range: { startLineNumber: e.line, startColumn: e.col + 1, endLineNumber: e.line, endColumn: e.col + 1 + e.length }, text: e.text,
    })), () => null);
  }
}

function registerRename() {
  const fileOf = (model: any) => [...files.values()].find(f => f.model === model);
  /** The label, else the variable, named at the cursor. */
  const target = (model: any, pos: { lineNumber: number; column: number }) => {
    const f = fileOf(model);
    if (!f || f.kind === 'rig') return undefined;
    return labelAt(projectFiles(), f.name, pos.lineNumber, pos.column - 1) ?? variableAt(projectFiles(), f.name, pos.lineNumber, pos.column - 1);
  };
  const provider = {
    resolveRenameLocation(model: any, pos: { lineNumber: number; column: number }) {
      const ref = target(model, pos);
      if (!ref) return { rejectReason: 'Put the cursor on a label or variable name to rename it', range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column), text: '' };
      return { range: new monaco.Range(ref.line, ref.col + 1, ref.line, ref.col + 1 + ref.length), text: ref.name };
    },
    async provideRenameEdits(model: any, pos: { lineNumber: number; column: number }, newName: string) {
      const ref = target(model, pos);
      if (!ref) return { edits: [], rejectReason: 'Put the cursor on a label or variable name to rename it' };
      let locales: ProjectFile[] = [];
      if (!('kind' in ref)) {
        try { locales = Object.entries(await (await fetch('/api/locales')).json() as Record<string, string>).map(([name, text]) => ({ name, text })); } catch { /* no translations to keep in step */ }
      }
      const res = 'kind' in ref ? renameLabel(projectFiles(), ref.name, newName) : renameVariable([...projectFiles(), ...locales], ref, newName);
      if (!res.ok) return { edits: [], rejectReason: res.error };
      // The translation tables are not editor tabs: rewrite them on disk (no undo), the scripts go through the models.
      for (const l of locales) {
        const mine = res.edits.filter(e => e.file === l.name);
        if (mine.length) void fetch(`/api/locale?file=${encodeURIComponent(l.name.replace(/^locale\//, ''))}`, { method: 'PUT', headers: { 'X-VN-Editor': '1', 'Content-Type': 'text/plain' }, body: applyTextEdits(l.text, mine) });
      }
      return {
        edits: res.edits.filter(e => files.has(e.file)).map(e => ({
          resource: files.get(e.file)!.model.uri, versionId: undefined,
          textEdit: { range: new monaco.Range(e.line, e.col + 1, e.line, e.col + 1 + e.length), text: e.text },
        })),
      };
    },
  };
  monaco.languages.registerRenameProvider('vn', provider);
  monaco.languages.registerRenameProvider('json', provider);
}

/** Color swatches and the picker for hex colors in scripts and game.json (`findColors` decides where one is valid). */
function registerColors() {
  for (const lang of ['vn', 'json'] as const) {
    monaco.languages.registerColorProvider(lang, {
      provideDocumentColors(model: any) {
        return findColors(model.getValue(), lang).map(c => ({
          color: { red: c.r, green: c.g, blue: c.b, alpha: c.a },
          range: new monaco.Range(c.line, c.col + 1, c.line, c.col + 1 + c.length),
        }));
      },
      provideColorPresentations(_model: any, info: any) {
        const label = formatHex({ r: info.color.red, g: info.color.green, b: info.color.blue, a: info.color.alpha });
        return [{ label, textEdit: { range: info.range, text: label } }];
      },
    });
  }
}

let findDialog: FindDialog;
function openFind() {
  const sel = editor.getSelection(), model = editor.getModel();
  findDialog.open(sel && model && !sel.isEmpty() ? model.getValueInRange(sel) : '');
}

// ---- boot ----
async function boot() {
  try { await loadMonaco(); }
  catch (e) {
    const d = document.createElement('div');
    d.id = 'fatal';
    d.textContent = e instanceof Error ? e.message : String(e);
    $('editor').replaceChildren(d);
    setStatus('Monaco missing');
    return;
  }
  registerLanguage();
  registerRename();
  registerColors();
  editor = monaco.editor.create($('editor'), {
    theme: 'vn-dark', language: 'vn', model: null, automaticLayout: true, minimap: { enabled: false },
    fontSize: 15, lineHeight: 24, wordWrap: 'on', scrollBeyondLastLine: false, renderWhitespace: 'none',
    tabSize: 2, insertSpaces: true, quickSuggestions: { other: true, comments: false, strings: false },
    padding: { top: 10 },
  });
  decorations = editor.createDecorationsCollection([]);

  findDialog = new FindDialog({
    files: projectFiles, apply: applyEdits,
    reveal: m => {
      goToLine(m.file, m.line);
      editor.setSelection({ startLineNumber: m.line, startColumn: m.col + 1, endLineNumber: m.line, endColumn: m.col + 1 + m.length });
    },
  });
  setupPalette();

  const proj = await (await fetch('/api/project')).json() as Project;
  for (const s of proj.scripts) addFile(s.file, s.text);
  if (files.size === 0) await newFile();
  // Without a game.json the tab starts from a template; the file is written on the first edit.
  addFile(GAME, proj.gameText ?? GAME_TEMPLATE, 'game');
  setAssets(proj);
  monaco.editor.onDidChangeMarkers(() => { updateProblemCount(); renderTabs(); });
  recompile();
  const first = files.keys().next().value as string | undefined;
  if (first) activate(first);
  setStatus('ready');

  let sidebarShown = true;
  try { sidebarShown = localStorage.getItem(SIDEBAR_KEY) !== '0'; } catch { /* default: shown */ }
  setSidebar(sidebarShown);
  sbFilter.addEventListener('input', () => { renderSidebarFiles(); renderSidebarAssets(); });
  $('filesBtn').addEventListener('click', () => setSidebar(sidebarEl.hidden));
  $('newFile').addEventListener('click', () => void newFile());
  $('playHere').addEventListener('click', () => void previewFromCursor());
    $('commands').addEventListener('click', () => palette.open('>'));
  $('helpBtn').addEventListener('click', toggleHelp);
  $('outlineBtn').addEventListener('click', toggleOutline);
  $('varsBtn').addEventListener('click', () => { varsEl.hidden = !varsEl.hidden; if (!varsEl.hidden) showVars(lastVars); });
  $('varsClose').addEventListener('click', () => { varsEl.hidden = true; });
  $('taskOutputClose').addEventListener('click', () => { outputEl.hidden = true; });
  followEl.addEventListener('change', showPreviewLine);
  problemsEl.addEventListener('click', nextProblem);
  setupSplitter();

  const events = new EventSource('/__events');
  events.onmessage = e => { if ((JSON.parse(e.data) as { type: string }).type === 'content') void syncFromDisk(); };
}

void boot();
