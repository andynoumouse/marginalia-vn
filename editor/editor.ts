// Scene editor: Monaco + the engine's own parser for live diagnostics and completions,
// next to the live preview. Files are saved to disk through the dev server, which is what
// triggers the preview's hot reload. game.json (title screen and menus) is a JSON tab with a schema.

import {
  sourceLanguage, declaredVoiceLanguages, stringRows, ANIM_NAMES, EASE_NAMES, animateRef, wordSpan, applyTextEdits, compile, namedAnchors, namedPositions, stageSize, parseVarValue, assignIds, existingIds, getCompletions, playtest, playtestDiagnostics, playtestText, scriptStats, statsText, readingTime, checkAssets, checkGame, helpTopicAt, rigHelpTopicAt, buildOutline, labelAt, variableAt, variableUses, labelRefs, renameVariable, renameLabel, rigLayers, checkRig, mergeRig, partName, rigPartNames, partGroups, rigSkeleton, rigOutline, rigPoseNames, UI_SCREENS, type UiScreen, overriddenScreens, writeRigText, textChange, type RigWrite, readRigSettings, speakValue, blinkValue, speakPart, blinkPart, findColors, formatHex, findFileRefs, resolveFileRef, buildFileTree, type FileTreeFolder, matchMasters, planMove, movedPath, isUnder, renameAssetRefs, describeTrashEntry, type TrashEntry, readCapabilities, FULL_CAPABILITIES, type Capabilities,
  UI_COMPONENTS, BUILTIN_THEMES, moveInlineTheme, themeCss, themeStylesheet, resolveTheme, type Program, type RigManifest, type LabelEdit, type ProjectFile,
} from '../engine/src/index.js';
import { AssetViewer, canView } from './asset-viewer.js';
import { AnimStudio } from './anim-studio.js';
import { HelpDialog } from './help-dialog.js';
import { FindDialog } from './find-dialog.js';
import { TranslationsDialog } from './translations-dialog.js';
import { VoiceDialog } from './voice-dialog.js';
import { BuildDialog, langQuery } from './build-dialog.js';
import { ThemeDialog } from './theme-dialog.js';
import { GitPanel } from './git-dialog.js';
import { OutlineView } from './outline-view.js';
import { Palette, rank, type PaletteItem, type PaletteMode } from './palette.js';
import { ContextMenu, type MenuEntry, type MenuItem } from './context-menu.js';

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
/** What the server can do (`/api/capabilities`): the online demo has no git, file manager or node tools. Read at boot. */
let caps: Capabilities = FULL_CAPABILITIES;
const NOT_IN_DEMO = 'needs the local dev server (not available in the online demo)';

// kind 'rig' is a character's assets/char/<char>/rig.json (tab name char/<char>/rig.json)
interface FileState { name: string; kind: 'script' | 'game' | 'rig' | 'theme' | 'themecss'; char?: string; model: any; saved: string; timer: number }
const files = new Map<string, FileState>();
/** The "did you mean" names of the current markers, by fixKey(). */
const quickFixes = new Map<string, string[]>();
const fixKey = (uri: { toString(): string }, line: number, message: string) => `${uri.toString()}|${line}|${message}`;
const GAME = 'game.json';
const themeFileName = (theme: string) => `themes/${theme}.json`;
const themeSheetName = (theme: string) => `themes/${theme}.css`;
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
    // Where the page loaded Monaco's loader from: /vendor/monaco on the dev server, the site's root folder in the online demo.
    const loader = document.querySelector<HTMLScriptElement>('script[src$="/vs/loader.js"]')?.src;
    const base = loader ? loader.slice(0, -'/vs/loader.js'.length) : `${location.origin}/vendor/monaco`;
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
      'scene', 'show', 'hide', 'move', 'shake', 'hop', 'animate', 'flash', 'tint', 'focus', 'camera', 'weather', 'filter', 'music', 'sound', 'wait', 'nvl', 'screen', 'hotspot', 'button', 'text', 'image', 'each', 'scroll', 'row', 'column', 'grid', 'cancel'],
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
    triggerCharacters: [' ', '{', '[', ':'],
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
  // Quick fixes (Ctrl+.) for the markers with a "did you mean": replace the unknown word with a close name.
  monaco.languages.registerCodeActionProvider('vn', {
    provideCodeActions(model: any, _range: any, context: any) {
      const actions = (context.markers as any[]).flatMap(m => {
        const options = quickFixes.get(fixKey(model.uri, m.startLineNumber, m.message)) ?? [];
        return options.map((o, i) => ({
          title: `Change to "${o}"`,
          kind: 'quickfix',
          diagnostics: [m],
          isPreferred: i === 0,
          edit: { edits: [{ resource: model.uri, versionId: model.getVersionId(), textEdit: {
            range: { startLineNumber: m.startLineNumber, endLineNumber: m.endLineNumber, startColumn: m.startColumn, endColumn: m.endColumn },
            text: o,
          } }] },
        }));
      });
      return { actions, dispose() {} };
    },
  });
  monaco.editor.registerCommand('vn.moveThemeToFile', () => moveThemeToFile());
  monaco.languages.registerCodeActionProvider('json', {
    provideCodeActions(model: any, _range: any, context: any) {
      const m = (context.markers as any[]).find(x => x.owner === 'vn-theme' || x.message?.startsWith('The theme is inline'));
      const actions = m ? [{ title: 'Move the theme to a theme file (themes/default.json)', kind: 'quickfix', diagnostics: [m], isPreferred: true,
        command: { id: 'vn.moveThemeToFile', title: 'Move the theme to a theme file' } }] : [];
      return { actions: model.uri.toString() === GAME_URI ? actions : [], dispose() {} };
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
  revealSelectedTab();
  renderSidebarFiles();
}

// Scrolls the strip (only it, not the page) so the selected tab is wholly visible.
function revealSelectedTab() {
  const tab = tabsEl.querySelector<HTMLElement>('.tab[data-selected="true"]');
  if (!tab) return;
  const r = tab.getBoundingClientRect();
  const left = r.left - tabsEl.getBoundingClientRect().left - tabsEl.clientLeft + tabsEl.scrollLeft;
  const right = left + r.width;
  const pad = 8;
  if (left - pad < tabsEl.scrollLeft) tabsEl.scrollLeft = left - pad;
  else if (right + pad > tabsEl.scrollLeft + tabsEl.clientWidth) tabsEl.scrollLeft = right + pad - tabsEl.clientWidth;
}

// A vertical wheel scrolls the strip sideways (a mouse has no horizontal wheel to reach the hidden tabs).
tabsEl.addEventListener('wheel', e => {
  if (e.deltaY === 0 || e.deltaX !== 0 || tabsEl.scrollWidth <= tabsEl.clientWidth) return;
  e.preventDefault();
  tabsEl.scrollLeft += e.deltaY;
}, { passive: false });

const recentFiles: string[] = []; // most recently activated first (Ctrl+P ordering)

/** Shows `name` in the editor; `focus` false leaves the keyboard where it is (a click in the Files panel). */
function activate(name: string, focus = true) {
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
  if (focus) editor.focus();
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
  inlineThemeMarkers();
  for (const f of files.values()) if (f.kind === 'rig') monaco.editor.setModelMarkers(f.model, 'vn', rigMarkers(f));
  outlineView?.update(buildOutline(program));
  quickFixes.clear();
  for (const f of [...scripts(), ...(gameFile ? [gameFile] : [])]) {
    const markers = program.diagnostics.filter(d => d.file === f.name).map(d => {
      const line = Math.min(Math.max(d.line, 1), f.model.getLineCount());
      const text: string = f.model.getLineContent(line);
      // A "did you mean" marks just the unknown word, and Ctrl+. offers the close names in its place.
      const span = d.fix ? wordSpan(text, d.fix.word) : null;
      if (d.fix && span) quickFixes.set(fixKey(f.model.uri, line, d.message), d.fix.options);
      return {
        severity: d.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
        message: d.message,
        startLineNumber: line, endLineNumber: line,
        startColumn: span ? span[0] + 1 : text.length - text.trimStart().length + 1,
        endColumn: span ? span[1] + 1 : f.model.getLineMaxColumn(line),
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
  // A rig.json that is not open has no markers yet; count its checks anyway so the total does not depend on which tabs are open.
  const rigs = liveRigs();
  const unopened = Object.keys(rigs).reduce((n, char) => (files.has(rigName(char)) ? n : n + checkRig(rigs[char]).length), 0);
  const warns = marks.length - errors + unopened;
  problemsEl.dataset.errors = String(errors);
  problemsEl.dataset.warns = String(warns);
  problemsEl.textContent = `Problems: ${errors + warns}`;
  problemsEl.title = 'Problems in all files, rig.json checks included (the preview header counts the script and game.json only)';
}

async function save(f: FileState) {
  const text: string = f.model.getValue();
  if (norm(text) === norm(f.saved)) return;
  if (f.kind !== 'script' && f.kind !== 'themecss') {
    try { JSON.parse(text); } catch { setStatus(`${f.name} has errors; not saved`); return; }
  }
  setStatus('saving...');
  try {
    const url = f.kind === 'game' ? '/api/game'
      : f.kind === 'rig' ? `/api/rig?char=${encodeURIComponent(f.char ?? '')}`
      : f.kind === 'theme' ? `/api/theme?name=${encodeURIComponent(f.char ?? '')}`
      : f.kind === 'themecss' ? `/api/theme?name=${encodeURIComponent(f.char ?? '')}&ext=css`
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
    : kind === 'rig' || kind === 'theme'
      ? monaco.editor.createModel(text, 'json', monaco.Uri.parse(`file:///${name}`))
      : kind === 'themecss'
        ? monaco.editor.createModel(text, 'css', monaco.Uri.parse(`file:///${name}`))
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

/**
 * What would be lost by leaving the page: tabs not on disk (a pending autosave, JSON that does not parse, a failed save)
 * and the animation studio's unapplied edits. A generated rig.json skeleton nobody edited does not count.
 */
function unsavedWork(): string[] {
  const names = [...files.values()]
    .filter(f => isDirty(f) && !(f.saved === '' && f.model.getAlternativeVersionId() === 1))
    .map(f => f.name);
  if (animStudio?.hasUnapplied) names.push('animation studio');
  return names;
}

// Leaving with unsaved edits: start the pending saves now and ask (the browser, or Marginalia Studio, shows the question).
window.addEventListener('beforeunload', e => {
  const unsaved = unsavedWork();
  if (!unsaved.length) return;
  for (const f of files.values()) if (isDirty(f) && f.saved !== '') { clearTimeout(f.timer); void save(f); }
  e.preventDefault();
  e.returnValue = '';
});

// ---- game.json schema (completions, hover docs and validation in the JSON tab) ----
interface Project {
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
let projectAssets: { files: string[]; rigs: Record<string, RigManifest>; rigTexts: Record<string, string>; masters: { master: string; output: string | null }[]; dirs: string[] } =
  { files: [], rigs: {}, rigTexts: {}, masters: [], dirs: [] };

// ---- files and assets panel (Ctrl+B) ----
const sidebarEl = $('sidebar'), sbFilter = $<HTMLInputElement>('sbFilter');
const sbFilesEl = document.createElement('div'), sbAssetsEl = document.createElement('div');
$('sbList').append(sbFilesEl, sbAssetsEl);
const SIDEBAR_KEY = 'vn.editor.sidebar';
const openDirs = new Set<string>(); // asset folders the user expanded (all open while filtering)
const collapsedDirs = new Set<string>(); // script folders the user collapsed (the tree starts open)
let scriptDirs: string[] = []; // folders under script/, empty ones included

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
  if (key === GAME || key?.startsWith('script/')) editor.focus();
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
  if (!caps.reveal) { setStatus(`opening files ${NOT_IN_DEMO}`); return; }
  try {
    const r = await fetch(`/api/${how}?path=${encodeURIComponent(rel)}`, { method: 'POST', headers: { 'X-VN-Editor': '1' } });
    if (r.status === 404) { setStatus('the dev server is older than the editor: restart it to open files'); return; }
    if (!r.ok) throw new Error(String(r.status));
  } catch { setStatus(how === 'open' ? `could not open ${rel}` : `could not show ${rel}`); }
}
const revealItem = (rel: string, label = REVEAL): MenuItem =>
  ({ label, title: caps.reveal ? rel || 'the project folder' : NOT_IN_DEMO, disabled: !caps.reveal, run: () => void showPath('reveal', rel) });
const copyItem = (label: string, text: string): MenuItem => ({
  label, title: text, run: () => void navigator.clipboard.writeText(text).then(() => setStatus(`copied ${text}`), () => setStatus('copy failed')),
});

// Rename/Move, Delete and Replace on project-relative paths (dev server: /api/move, /api/delete, PUT /api/asset?replace=).
// Rename asks for the new path in the palette, so a file moves to another folder by typing it.
const RENAME = '#rename:'; // palette prefix of the Rename field (the text after it is the new path)
let renaming: { from: string; isDir: boolean } | null = null;
const inScript = (rel: string) => rel.startsWith('script/');
const scriptName = (rel: string) => rel.slice('script/'.length);

async function fileRequest(url: string, fail: string): Promise<Response | null> {
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'X-VN-Editor': '1' } });
    if (r.ok) return r;
    const text = await r.text();
    setStatus(text === 'Not found' ? 'the dev server is older than the editor: restart it to rename or delete files' : `${fail}: ${text}`);
  } catch { setStatus(fail); }
  return null;
}

// Delete and Replace move what they remove to the project's .trash/ folder (dev server: /api/trash...). The toast offers Undo
// for a while; Restore from Trash (palette, or the Project heading's menu) lists everything still there.
let toastTimer = 0;
function toast(text: string, undo?: () => void) {
  const el = $('toast'), button = el.querySelector('button')!;
  el.querySelector('span')!.textContent = text;
  button.hidden = !undo;
  button.onclick = () => { el.hidden = true; undo?.(); };
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { el.hidden = true; }, 12_000);
  setStatus(text);
}

let trashEntries: TrashEntry[] = [];
const TRASH_PICK = '#trash:'; // palette prefix of the Restore from Trash list
async function openTrash() {
  try { trashEntries = await (await fetch('/api/trash')).json(); } catch { setStatus('could not read the trash'); return; }
  palette.setText(TRASH_PICK);
}

async function restoreTrash(id: string) {
  const r = await fileRequest(`/api/trash/restore?id=${encodeURIComponent(id)}`, 'could not restore');
  if (!r) return;
  const { paths, aside } = await r.json() as { paths: string[]; aside: string | null };
  toast(`restored ${paths.join(', ')}${aside ? ' (what was there went to the trash)' : ''}`, aside ? () => void restoreTrash(aside) : undefined);
  await syncFromDisk();
  renderSidebarFiles();
}

async function emptyTrash() {
  if (!window.confirm('Delete everything in the project trash for good? This cannot be undone.')) return;
  const r = await fileRequest('/api/trash/empty', 'could not empty the trash');
  if (r) toast(`emptied the trash (${(await r.json() as { removed: number }).removed} entries)`);
}

/** Saves the scripts under `rel` now, so a move or delete never races their autosave. */
async function flushScripts(rel: string) {
  if (!inScript(rel)) return;
  await Promise.all(scripts().filter(f => isUnder(f.name, scriptName(rel))).map(f => { clearTimeout(f.timer); return save(f); }));
}

function startRename(from: string, isDir = false) {
  renaming = { from, isDir };
  palette.setText(RENAME + from);
}

async function movePath(from: string, to: string, isDir: boolean) {
  const plan = planMove(from, to, isDir);
  if ('error' in plan) { setStatus(plan.error); return; }
  await flushScripts(from);
  if (!await fileRequest(`/api/move?from=${encodeURIComponent(from)}&to=${encodeURIComponent(plan.to)}${isDir ? '&dir=1' : ''}`, `could not rename ${from}`)) return;
  renaming = null;
  setStatus(`renamed ${from} to ${plan.to}`);
  if (from.startsWith('assets/')) {
    // Scripts and game.json that name the file follow it (one undo step per file, saved like typing).
    const { edits, stranded } = renameAssetRefs(projectFiles(), from, plan.to, isDir, projectAssets.files);
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
  active = follow(active);
  if (previewPos) previewPos.file = follow(previewPos.file);
  const dirs = new Set(scriptDirs.map(d => movedPath(d, a, b) ?? d));
  for (let p = isDir ? b : b.slice(0, Math.max(b.lastIndexOf('/'), 0)); p; p = p.slice(0, Math.max(p.lastIndexOf('/'), 0))) dirs.add(p);
  scriptDirs = [...dirs];
  for (const d of [...collapsedDirs]) {
    const n = movedPath(d, a, b);
    if (n) { collapsedDirs.delete(d); collapsedDirs.add(n); }
  }
  recompile();
  renderSidebarFiles();
}

async function deletePath(rel: string, isDir = false, question?: string) {
  const count = !isDir ? 0 : inScript(rel) ? scripts().filter(f => isUnder(f.name, scriptName(rel))).length
    : rel.startsWith('masters/') ? projectAssets.masters.filter(m => isUnder(`masters/${m.master}`, rel)).length
    : projectAssets.files.filter(f => isUnder(`assets/${f}`, rel) && !f.endsWith('.gitkeep')).length;
  const what = isDir ? `the folder ${rel}/${count ? ` and the ${count} file${count === 1 ? '' : 's'} in it` : ''}` : rel;
  if (!window.confirm(question ?? `Delete ${what}?\n\nIt goes to the project trash (.trash/): Undo, or Restore from Trash, brings it back.`)) return;
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
  scriptDirs = scriptDirs.filter(d => !isUnder(d, a));
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
      if (!r.ok) { setStatus(`could not replace ${rel}: ${await r.text()}`); return; }
      const { trash } = await r.json() as { trash?: string };
      toast(`replaced ${rel}`, trash ? () => void restoreTrash(trash) : undefined);
    } catch { setStatus(`could not replace ${rel}`); }
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
const ART = 'image/*,.png,.webp,.jpg,.jpeg,.avif,.svg';
const acceptFor = (dir: string) => ['bg', 'char', 'ui'].includes(dir) ? `${ART},.psd` : '';
const masterOf = (asset: string) => projectAssets.masters.find(m => m.output === asset)?.master;

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
function renderSidebarFiles() {
  if (sidebarEl.hidden) return;
  const over = overriddenScreens([...files.values()].filter(f => f.kind === 'script').map(f => ({ file: f.name, text: f.model.getValue() })));
  const overrideFiles = new Set(UI_SCREENS.filter(u => over[u.name] === u.file).map(u => u.file));
  const focused = focusedKey(sbFilesEl);
  const fileRow = (f: FileState, label: string) => withMenu(sbItem(label, {
    key: f.kind === 'game' ? GAME : `script/${f.name}`,
    title: f.name, current: f.name === active, errors: errorCount(f) > 0, problems: problemCounts(f),
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
  const tree = buildFileTree(scripts.map(f => f.name), scriptDirs, sbFilter.value);
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
  const themeNames = [...new Set([...Object.keys(themeTexts), ...[...files.values()].filter(f => f.kind === 'theme').map(f => f.char!)])].sort().filter(n => sbMatch(`theme ${n}`));
  const newTheme: SbAction = ['file', 'New theme file (themes/<name>.json)', () => palette.setText(THEME_PICK)];
  const openPanel: SbAction = ['panel', 'Theme panel: edit colors, fonts and components with a live preview', () => themeDialog.open(files.get(active)?.kind === 'theme' ? files.get(active)!.char! : null, () => editor.focus())];
  const builtInNames = Object.keys(BUILTIN_THEMES).filter(n => !themeNames.includes(n) && sbMatch(`theme ${n} built-in`));
  const builtInRows = builtInNames.map(n => withMenu(sbItem(n, {
    key: `theme-builtin/${n}`, title: `Built-in theme "${n}": view it in the theme panel, or duplicate it into a theme file`, meta: 'built-in',
    run: () => themeDialog.open(n, () => editor.focus()),
  }), () => [
    { label: 'View in Theme Panel', run: () => themeDialog.open(n, () => editor.focus()) },
    { label: 'Duplicate…', run: () => { themeDialog.open(n, () => editor.focus()); themeDialog.duplicate(); } },
  ]));
  const themeRows = (): HTMLElement[] => (themeNames.length ? themeNames.map(n => {
    const file = files.get(themeFileName(n));
    return withMenu(sbItem(n, {
      key: themeFileName(n), title: `Edit ${themeFileName(n)}`, current: !!file && file.name === active, errors: !!file && errorCount(file) > 0,
      meta: file && isDirty(file) ? '•' : '', run: () => openTheme(n),
    }), () => [
      { label: 'Open', run: () => openTheme(n) },
      { label: 'Open Stylesheet (CSS)', run: () => openThemeSheet(n) },
      { label: 'Edit in Theme Panel', run: () => themeDialog.open(n, () => editor.focus()) },
      { label: 'Duplicate…', run: () => { themeDialog.open(n, () => editor.focus()); themeDialog.duplicate(); } },
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
      { label: 'New Theme File…', run: newTheme[2] }, { label: 'Theme Panel…', run: () => themeDialog.open(null, () => editor.focus()) }, null, revealItem('themes'),
    ], themeRows));
  const screens = UI_SCREENS.filter(u => sbMatch(`${u.name} ${u.title}`));
  if (screens.length) sbFilesEl.append(...sbSection('Built-in screens', [], undefined, () => screens.map(u => {
    const file = over[u.name] ? files.get(over[u.name]) : undefined;
    const row = withMenu(document.createElement('div'), () => [
      { label: 'Preview Screen', run: () => previewScreen(u.name) },
      ...(file ? [
        { label: `Open ${file.name}`, run: () => activate(file.name) },
        {
          label: 'Revert to Stock', title: `Delete script/${file.name} so the stock screen is used again`,
          run: () => void deletePath(`script/${file.name}`, false, `Delete script/${file.name} and go back to the stock ${u.title} screen?\n\nThe file goes to the project trash (.trash/).`),
        },
        null, copyItem('Copy Path', `script/${file.name}`), revealItem(`script/${file.name}`),
      ] : [
        { label: 'Show Starter Code', run: () => showStock(u) },
        { label: 'Customize', title: `Create script/${u.file} with the starter code`, run: () => void newFile(u.file, u.starter) },
      ]),
    ]);
    row.className = 'row';
    row.append(sbItem(u.title, {
      title: file ? `Preview, and open ${file.name}, which overrides this screen (right-click, Revert to Stock, to get the stock one back)` : 'Preview the stock screen and show its starter code read-only',
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
  })));
  refocus(sbFilesEl, focused);
}

/** Characters (open their rig.json) and every other asset by folder (open in a browser tab). Redrawn when assets or the filter change. */
function renderSidebarAssets() {
  if (sidebarEl.hidden) return;
  const focused = focusedKey(sbAssetsEl);
  const filtering = sbFilter.value.trim() !== '';
  const chars =Object.keys(projectAssets.rigs).sort().filter(c => sbMatch(`char/${c}`));
  const byDir = new Map<string, string[]>();
  for (const file of projectAssets.files) {
    if (file.endsWith('.gitkeep') || Object.entries(projectAssets.rigs).some(([c, r]) => !r.flat && file.startsWith(`char/${c}/`)) || !sbMatch(file)) continue;
    const [dir, ...rest] = file.split('/');
    byDir.set(dir, [...(byDir.get(dir) ?? []), rest.join('/')]);
  }
  if (!filtering) for (const dir of projectAssets.dirs) if (dir !== 'char' || byDir.has(dir)) byDir.set(dir, byDir.get(dir) ?? []); // empty folders too
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
        copyItem('Copy Path', `assets/${file}`),
        revealItem(`assets/${file}`),
        ...(master ? [revealItem(`masters/${master}`, `${REVEAL} (Master)`)] : []),
      ]);
    }));
    d.addEventListener('toggle', () => { if (!filtering) { if (d.open) openDirs.add(dir); else openDirs.delete(dir); } });
    return d;
  });
  // Masters the converter has not turned into art yet (it is off, still running, or the PSD failed): listed only while there are some.
  const waiting = projectAssets.masters.filter(m => !m.output && sbMatch(`masters/${m.master}`));
  const addChar: SbAction = ['add', 'Add a character PSD (masters/char/)', () => pickAssets('char', '.psd')];
  const newAssetDir: SbAction = ['folder', 'New folder under assets/', () => void newAssetFolder()];
  const addAny: SbAction = ['add', 'Add files (sorted by type: images to bg, sounds to music, fonts to fonts)', () => pickAssets('', `${ART},audio/*,.ogg,.mp3,.wav,.m4a,.flac,.opus,.woff2,.woff,.ttf,.otf`)];
  sbAssetsEl.replaceChildren(
    ...sbSection('Characters', [addChar], () => [{ label: 'Add Character PSD…', run: addChar[2] }, null, revealItem('masters/char', `${REVEAL} (Masters)`), revealItem('assets/char')], () => chars.length ? chars.map(c => {
      const master = projectAssets.masters.find(m => m.output === `char/${c}/sprite.json`)?.master;
      const flat = projectAssets.rigs[c]?.flat;
      const row = withMenu(document.createElement('div'), () => [
        { label: 'Edit rig.json', run: () => openRig(c) },
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
      const anim = Object.assign(document.createElement('button'), { type: 'button', className: 'anim', textContent: 'Animate', title: `Open the animation studio for ${c}` });
      anim.addEventListener('click', () => openAnimStudio(c));
      row.append(sbItem(c, {
        title: `Edit char/${c}/rig.json${master ? ` (art from masters/${master})` : ''}`, current: active === rigName(c),
        meta: [master ? 'psd' : '', files.has(rigName(c)) ? 'rig.json (open)' : c in projectAssets.rigTexts ? 'rig.json' : 'rig.json (new)'].filter(Boolean).join(' · '),
        run: () => openRig(c),
      }), anim);
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
async function newAssetFolder(given?: string) {
  if (given === undefined) { palette.setText(NEW_ASSET_FOLDER); return; }
  const dir = given.trim().replace(/\/+$/, '');
  if (!/^[\w\-]+$/.test(dir)) { setStatus('invalid folder name'); return; }
  const r = await fetch(`/api/folder?in=assets&dir=${encodeURIComponent(dir)}`, { method: 'PUT', headers: { 'X-VN-Editor': '1' } });
  if (!r.ok) { setStatus('could not create folder'); return; }
  if (!projectAssets.dirs.includes(dir)) projectAssets.dirs.push(dir);
  openDirs.add(dir);
  renderSidebarAssets();
}

async function previewFile(name: string) {
  activate(name);
  editor.setPosition({ lineNumber: 1, column: 1 });
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
  setStatus([done.length ? `added ${done.join(', ')}` : '', ...skipped].filter(Boolean).join('; '));
}

let assetViewer: AssetViewer;
/** Images, sounds and fonts open in the viewer dialog; anything else in a browser tab. Closing the viewer goes back to the
 * Files panel row when it was opened from there (`fromPanel`), else to the editor. */
function openAsset(file: string, siblings: string[] = [file], fromPanel = false) {
  if (canView(file)) assetViewer.open(file, siblings, () => (fromPanel ? refocus(sbAssetsEl, `assets/${file}`) : editor.focus()));
  else window.open(`../assets/${encodeURI(file)}`, '_blank', 'noopener');
}

function setSidebar(show: boolean) {
  sidebarEl.hidden = !show;
  try { localStorage.setItem(SIDEBAR_KEY, show ? '1' : '0'); } catch { /* ignore */ }
  renderSidebarFiles();
  renderSidebarAssets();
}

/** Raw themes/<name>.json text by theme name, as of the last project load. */
let themeTexts: Record<string, string> = {};
/** Raw themes/<name>.css text by theme name, as of the last project load. */
let themeSheets: Record<string, string> = {};

function setAssets(proj: Project) {
  themeTexts = proj.themeTexts ?? {};
  themeSheets = proj.themeSheets ?? {};
  scriptDirs = proj.scriptDirs ?? [];
  renderSidebarFiles();
  const assetFiles = proj.assets.map(a => a.file);
  projectAssets = { files: assetFiles, rigs: proj.rigs ?? {}, rigTexts: proj.rigTexts ?? {}, masters: matchMasters(proj.masters ?? [], assetFiles), dirs: proj.assetDirs ?? [] };
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
  'choice', 'choice_short', 'choice_saves', 'empty_slot', 'delete', 'save_failed', 'confirm_overwrite', 'confirm_load', 'confirm_old_save', 'confirm_delete', 'confirm_title', 'crash_title', 'crash_text', 'crash_copy', 'crash_copied', 'crash_to_title',
  'confirm_qload', 'history', 'history_empty', 'history_return', 'save_name', 'cancel', 'rename', 'toast_qsaved', 'toast_no_qsave', 'toast_skip_unread', 'toast_pad_on', 'toast_pad_nonstandard', 'toast_pad_off', 'text_sounds', 'text_size', 'box_opacity', 'reduce_motion', 'speaker_focus', 'timed_choices', 'timed_extended', 'timed_off', 'timed_announce', 'tab_audio', 'tab_game', 'tab_access', 'on', 'off',
  'gallery', 'locked', 'music_room', 'chapters', 'stop', 'now_playing', 'achievements', 'endings', 'achievement_unlocked', 'ending_reached', 'hidden_achievement',
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
    properties: { size: num('Font size in pixels (44).'), color: { type: 'string' }, lineHeight: num('Line height multiplier (1.45).'),
      lines: { type: 'integer', minimum: 1, description: 'Lines the text box shows at once (3); a longer line is split into pages.' } },
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
      icon: { type: 'string', description: 'The game\'s icon: assets/ui/<icon>.png, square, 256x256 or larger. The desktop app\'s exe and window icon and the web build\'s favicon.', examples: assetNames.ui },
      version: { type: 'string', pattern: '^\\d{1,5}(\\.\\d{1,5}){0,3}$', description: 'The game\'s version, like "1.0" or "1.2.3": the desktop app\'s version info. Separate from saveVersion.', examples: ['1.0'] },
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
            items: { enum: ['new_game', 'continue', 'load', 'gallery', 'music_room', 'chapters', 'achievements', 'options'] },
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
      saveNames: { type: 'boolean', default: false, description: 'The player names a save when making it in a numbered slot (the name shows on the save screen in place of "Slot 3"), and can rename it there. Auto, quick and choice saves are never asked for a name.' },
      voiceLanguages: { type: 'array', items: { type: 'string' }, description: 'Languages to record voice in (e.g. ["ja", "fi"]), listed in the Voice dialog and held to having a recording for every spoken line by the build checks, even before the first recording. Separate from the text translations in locale/<lang>.json. The source language is the default take and needs no entry.' },
      language: { type: 'string', default: 'en', description: 'The language the scripts are written in (default "en"). Other languages are translations in locale/<lang>.json. Players pick the text language, and separately the voice language, in the options.' },
      memoryBudgetMB: { type: 'number', exclusiveMinimum: 0, description: 'Memory budget for loaded images and audio, in MB (default 512, 256 on low-memory devices). The debug console command memory reports against it.' },
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
      achievements: {
        type: 'array',
        description: 'Achievements and endings (an Achievements button appears on the title screen). Each unlocks when the script runs "unlock <flag>", and pops up a toast.',
        items: {
          anyOf: [
            { type: 'string', description: 'A flag (script: unlock <flag>), also the title.', examples: names(used('unlock', 'name')) },
            {
              type: 'object', additionalProperties: false, required: ['unlock'],
              properties: {
                unlock: { type: 'string', description: 'The flag that unlocks it (script: unlock <flag>).', examples: names(used('unlock', 'name')) },
                title: { type: 'string' },
                description: { type: 'string', description: 'What it is for; hidden ones show it only once unlocked.' },
                icon: { type: 'string', description: 'Image: assets/ui/<icon>.png, on the list and the toast.', examples: assetNames.ui },
                hidden: { type: 'boolean', description: 'Shown as "???" until unlocked.' },
                ending: { type: 'boolean', description: 'An ending: listed and counted apart from the achievements.' },
                toast: { type: 'boolean', description: 'false: unlock it quietly, with no toast.' },
              },
            },
          ],
        },
      },
      achievementToast: {
        type: 'object', additionalProperties: false,
        description: 'The stock toast an unlocked achievement pops up. Declare "screen achievement_toast" to draw your own (seconds and sound still apply).',
        properties: {
          position: { enum: ['topright', 'topleft', 'bottomright', 'bottomleft', 'top', 'bottom'], description: 'Where it shows (default topright).' },
          seconds: { type: 'number', exclusiveMinimum: 0, description: 'How long each one stays (default 4).' },
          sound: { type: 'string', description: 'Played as it appears: assets/sound/<sound>.', examples: assetNames.sound },
        },
      },
      speakerFocus: {
        description: 'Dim the characters who are not speaking. true for the defaults; players can turn it off in Options, scripts with "focus off", one character with "define ... focus=off".',
        oneOf: [{ type: 'boolean' }, {
          type: 'object', additionalProperties: false,
          properties: {
            dim: { type: 'number', minimum: 0, maximum: 1, description: 'How much darker the others get (default 0.35).' },
            fade: { type: 'number', minimum: 0, description: 'Seconds the change takes (default 0.2).' },
            front: { type: 'boolean', description: 'Draw the speaker in front of the others for the line (default false).' },
            offstage: { enum: ['lit', 'dim'], description: 'When the speaker is not on stage (narration): everyone lit (default) or everyone dimmed.' },
          },
        }],
      },
      sideImages: {
        description: 'The speaker portrait in the text box, for characters defined with "side=<name>" (assets/side/<name>.png, or <name>_<pose>.png while they are on stage in that pose). true for the defaults.',
        oneOf: [{ type: 'boolean' }, {
          type: 'object', additionalProperties: false,
          properties: {
            place: { enum: ['left', 'right'], description: 'Which end of the text box (default left).' },
            size: { type: 'number', exclusiveMinimum: 0, description: 'Portrait height in stage pixels (default 260).' },
            when: { enum: ['always', 'offstage'], description: 'always (default), or only while the speaker is not on stage.' },
          },
        }],
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
      theme: { anyOf: [{ type: 'string', description: 'The name of a theme file: "night" uses themes/night.json.' }, {
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
            description: 'Named styles: `define alice ... style=alice`, `style=name` on a line, a menu or a screen button or text.',
            propertyNames: { examples: characterBoxes },
            additionalProperties: skin('Overrides while this style is used (appearance only).'),
          },
        },
      }] },
    },
  };
  monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
    validate: true,
    schemas: [{ uri: 'vn://schema/game.json', fileMatch: [GAME_URI], schema }, ...rigSchemas(), ...themeSchemas()],
  });
}

/** The layered theme file (docs/game-json.md "theme"): tokens, components with states, screens, styles. */
function themeSchemas() {
  const num = (description: string) => ({ type: 'number', description });
  const str = (description: string) => ({ type: 'string', description });
  const look = {
    type: 'object',
    properties: {
      background: str('A CSS color.'), color: str('Text color.'), border: str('Border color.'), borderWidth: num('Pixels.'), radius: num('Corner radius in pixels.'),
      padding: { description: 'A number or a list of numbers, in pixels.', anyOf: [{ type: 'number' }, { type: 'array', items: { type: 'number' } }] },
      size: num('Font size in pixels.'), opacity: num('0 to 1.'), shadow: str('A CSS box-shadow.'), width: num('Pixels.'),
    },
  };
  const component = {
    ...look, properties: { ...look.properties, ...Object.fromEntries(['hover', 'focus', 'disabled', 'selected'].map(k => [k, { ...look, description: `What changes in the ${k} state.` }])) },
  };
  const keys = Object.entries(UI_COMPONENTS).flatMap(([k, c]) => [k, ...Object.keys(c.variants ?? {}).map(v => `${k}.${v}`)]);
  const components = Object.fromEntries(keys.map(k => [k, component]));
  const colorToken = (d: string) => str(d);
  const schema = {
    type: 'object',
    properties: {
      extends: str('Another theme file (its name) or the built-in "base"; values here win.'),
      tokens: {
        type: 'object',
        properties: {
          accent: colorToken('Highlight color.'), font: str('Story text and menu font.'), uiFont: str('Menu font (default: font).'),
          fonts: { type: 'object', description: 'A font per language code, e.g. {"ja": "Noto Sans JP"}; replaces font and uiFont in that language.', additionalProperties: { type: 'string' } },
          text: colorToken('Text color.'), muted: colorToken('Secondary text color.'), surface: colorToken('Panel and button background.'),
          line: colorToken('Border color.'), danger: colorToken('Destructive actions.'), warn: colorToken('Warnings.'),
          radius: num('Corner radius in pixels.'), borderWidth: num('Border width in pixels (default 2).'),
          gap: num('Spacing in menu columns (default 18).'), uiSize: num('Menu text size in pixels (default 40).'),
        },
      },
      components: { type: 'object', properties: { ...components, textbox: { type: 'object' }, namebox: { type: 'object' }, text: { type: 'object' }, choice: { type: 'object' }, hotspot: { type: 'object' }, tooltip: { type: 'object' } } },
      screens: { type: 'object', description: 'The same components inside one built-in screen.', additionalProperties: { type: 'object', properties: components } },
      styles: { type: 'object', description: 'Named styles (the old "skins"): define ... style=, style= on lines, menus and screen buttons.', additionalProperties: { type: 'object' } },
    },
  };
  return [...files.values()].filter(f => f.kind === 'theme').map(f => ({ uri: `vn://schema/theme/${f.char}`, fileMatch: [`file:///${f.name}`], schema }));
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

/** The file name `raw` asks for, without `.vn`, or null when it is not a valid script path. */
function newFileBase(raw: string): string | null {
  const base = raw.trim().replace(/\.vn$/, '');
  return base && /^[\w\-./]+$/.test(base) && !base.includes('..') ? base : null;
}

// Without a name, ask in the palette (window.prompt is dismissed silently by some hosts).
async function newFile(given?: string, starter?: string, dir?: string) {
  if (given === undefined) { palette.setText(NEW_PICK + (dir ? `${dir}/` : '')); return; }
  const base = newFileBase(given);
  if (!base) { setStatus('invalid file name'); return; }
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

/** A new folder under script/ (made on disk so it stays when empty). Without a name, asks in the palette, inside `parent`. */
async function newFolder(given?: string, parent?: string) {
  if (given === undefined) { palette.setText(NEW_FOLDER + (parent ? `${parent}/` : '')); return; }
  const dir = given.trim().replace(/\/+$/, '');
  if (!dir || !/^[\w\-./]+$/.test(dir) || dir.includes('..')) { setStatus('invalid folder name'); return; }
  const r = await fetch(`/api/folder?dir=${encodeURIComponent(dir)}`, { method: 'PUT', headers: { 'X-VN-Editor': '1' } });
  if (!r.ok) { setStatus('could not create folder'); return; }
  for (let p = dir; p; p = p.slice(0, Math.max(p.lastIndexOf('/'), 0))) if (!scriptDirs.includes(p)) scriptDirs.push(p);
  collapsedDirs.delete(dir);
  renderSidebarFiles();
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
  for (const [theme, text] of Object.entries(proj.themeTexts ?? {})) {
    const f = files.get(themeFileName(theme));
    if (!f || norm(text) === norm(f.saved) || norm(f.model.getValue()) !== norm(f.saved)) continue;
    f.saved = text;
    f.model.pushEditOperations([], [{ range: f.model.getFullModelRange(), text }], () => null);
    changed = true;
  }
  for (const [theme, text] of Object.entries(proj.themeSheets ?? {})) {
    const f = files.get(themeSheetName(theme));
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
let translations: TranslationsDialog;
let voiceDialog: VoiceDialog;
let buildDialog: BuildDialog;
let themeDialog: ThemeDialog;
let gitPanel: GitPanel;
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

/** Give every string line of every script an id; returns how many were added. */
function addIdsEverywhere(): number {
  let total = 0;
  for (const f of scripts()) {
    const taken = existingIds(scripts().map(x => x.model.getValue()));
    const { text, added } = assignIds(f.model.getValue(), taken);
    if (!added) continue;
    f.model.pushEditOperations([], [{ range: f.model.getFullModelRange(), text }], () => null);
    total += added;
  }
  setStatus(total ? `added ${total} ids` : 'every line already has an id');
  return total;
}

/** How many string lines in the scripts have no id yet (what addIdsEverywhere would add). */
function missingIdCount(): number {
  const taken = existingIds(scripts().map(x => x.model.getValue()));
  let n = 0;
  for (const f of scripts()) n += assignIds(f.model.getValue(), new Set(taken)).added;
  return n;
}

/** Open `name` at `line` (clamped to the file), at column `col` if given, else at the line's first non-blank character. */
function goToLine(name: string, line: number, col?: number) {
  activate(name);
  line = Math.min(Math.max(line, 1), editor.getModel().getLineCount());
  editor.revealLineInCenter(line);
  editor.setPosition({ lineNumber: line, column: col ?? 1 + (editor.getModel().getLineContent(line).match(/^\s*/)?.[0].length ?? 0) });
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

/** Open themes/<name>.json in a tab; a name that has no file yet starts one that extends `base` (saved on the first edit). */
function openTheme(theme: string) {
  const name = themeFileName(theme);
  if (files.has(name)) { activate(name); return; }
  const onDisk = themeTexts[theme];
  const f = addFile(name, onDisk ?? `${JSON.stringify({ extends: 'base', tokens: {}, components: {} }, null, 2)}
`, 'theme', theme);
  if (onDisk === undefined) { f.saved = ''; setStatus(`${name} is new: Ctrl+S saves it`); }
  recompile();
  activate(name);
}

/** Open themes/<name>.css in a tab; a theme without a stylesheet starts an empty one (saved on the first edit). */
function openThemeSheet(theme: string) {
  const name = themeSheetName(theme);
  if (files.has(name)) { activate(name); return; }
  const onDisk = themeSheets[theme];
  const f = addFile(name, onDisk ?? `/* Extra CSS for the "${theme}" theme, added after the generated theme styles. */\n`, 'themecss', theme);
  if (onDisk === undefined) { f.saved = ''; setStatus(`${name} is new: Ctrl+S saves it`); }
  activate(name);
}

/** Every theme file parsed (open tabs as edited, the rest as loaded), by name. */
function themeDialogFiles(): Record<string, unknown> {
  const names = new Set([...Object.keys(themeTexts), ...[...files.values()].filter(f => f.kind === 'theme').map(f => f.char!)]);
  const own = Object.fromEntries([...names].flatMap(n => { try { return [[n, JSON.parse(files.get(themeFileName(n))?.model.getValue() ?? themeTexts[n] ?? '')]]; } catch { return []; } }));
  return { ...BUILTIN_THEMES, ...own }; // a theme file replaces a built-in one of the same name
}

/** The quick fix for an inline `theme` object in game.json: it becomes themes/<name>.json and game.json names it. */
function moveThemeToFile() {
  const g = files.get(GAME);
  if (!g) return;
  const taken = [...new Set([...Object.keys(themeTexts), ...[...files.values()].filter(f => f.kind === 'theme').map(f => f.char!)])];
  const moved = moveInlineTheme(g.model.getValue(), taken);
  if (!moved) { setStatus('game.json has no inline theme object to move'); return; }
  const f = addFile(themeFileName(moved.name), '', 'theme', moved.name);
  f.saved = '';
  f.model.pushEditOperations([], [{ range: f.model.getFullModelRange(), text: moved.themeText }], () => null);
  g.model.pushEditOperations([], [{ range: g.model.getFullModelRange(), text: moved.gameText }], () => null);
  recompile();
  setStatus(`Moved the inline theme to ${themeFileName(moved.name)} and set "theme": "${moved.name}" in game.json`);
}

/** An Info marker on the `"theme"` line of game.json while the theme is still an inline object (Ctrl+. offers the move). */
function inlineThemeMarkers() {
  const g = files.get(GAME);
  if (!g) return;
  let inline = false;
  try { const game = JSON.parse(g.model.getValue()); inline = !!game && typeof game.theme === 'object' && game.theme !== null && !Array.isArray(game.theme); } catch { /* the JSON tab shows its own errors */ }
  const marks: any[] = [];
  if (inline) {
    const lines: string[] = g.model.getValue().split('\n');
    const i = lines.findIndex(l => /^\s*"theme"\s*:/.test(l));
    if (i >= 0) {
      const col = lines[i].indexOf('"theme"');
      marks.push({ severity: monaco.MarkerSeverity.Info, message: 'The theme is inline in game.json. Ctrl+. moves it to a theme file (themes/default.json).',
        startLineNumber: i + 1, endLineNumber: i + 1, startColumn: col + 1, endColumn: col + 8 });
    }
  }
  monaco.editor.setModelMarkers(g.model, 'vn-theme', marks);
}

const THEME_PICK = '#theme:', THEME_CSS_PICK = '#themecss:';

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
const RIG_PICK = '#rig:', ANIM_PICK = '#anim:'; // palette prefixes of the character pickers (setupPalette)
const NEW_PICK = '#new:'; // palette prefix of the New Script File name field
const NEW_FOLDER = '#folder:'; // palette prefix of the New Folder name field
const NEW_ASSET_FOLDER = '#assetfolder:'; // the same for a folder under assets/
/** game.json as the tab holds it (unsaved edits count); null while it does not parse. */
function openGame(): unknown {
  try { return JSON.parse(files.get(GAME)?.model.getValue() ?? '{}'); } catch { return null; }
}

/** Open the animation studio for `char` (opening its rig.json tab) or else for the character of the active rig.json tab; unsaved text counts. */
function openAnimStudio(char?: string, animation?: string, scene?: { file: string; line: number }) {
  const wasOpen = char ? openTabs.includes(rigName(char)) : true; // a rig tab opened only for the studio goes away with it
  const before = active;
  const cursor = editor.getPosition();
  const target = files.get(before)?.kind === 'script' && cursor ? { file: before, line: cursor.lineNumber } : null; // where Insert in script puts the show line
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
    returnFocus: () => {
      const rigTab = char ? rigName(char) : '';
      // A generated skeleton (saved === '') stays: closing a tab autosaves it, which would create a rig.json nobody asked for.
      if (rigTab && !wasOpen && active === rigTab && files.get(rigTab)?.saved !== '') {
        closeTab(rigTab);
        if (before && openTabs.includes(before)) {
          activate(before);
          if (cursor) { editor.setPosition(cursor); editor.revealPositionInCenterIfOutsideViewport(cursor); }
        }
      }
      editor.focus();
    },
    insertLine: target ? (line => {
      const m = files.get(target.file)!.model;
      const at = Math.min(target.line, m.getLineCount());
      const text: string = m.getLineContent(at);
      const indent = /^\s*/.exec(text)![0];
      m.pushEditOperations([], [{ range: new monaco.Range(at, text.length + 1, at, text.length + 1), text: `\n${indent}${line}` }], () => null);
      target.line = at + 1; // the next insert goes under this one
      return `Inserted under line ${at} of ${target.file}.`;
    }) : undefined,
    tryInScene: scene && (() => {
      // The saved rig.json makes the preview reload its game; wait for that, or the jump would run on the old rig.
      void (async () => {
        await save(f);
        const script = files.get(scene.file);
        if (script) await save(script);
        setTimeout(() => postPreview({ type: 'goto', file: scene.file, line: scene.line }), 600);
      })();
    }),
    scene: scene ?? target ?? undefined,
    positions: namedPositions(openGame()),
    anchors: namedAnchors(openGame()),
    parts: manifest ? rigPartNames({ ...manifest, rig: object(data) }) : [], // groups from the file as it is now
    groups: manifest ? partGroups({ ...manifest, rig: object(data) }) : {},
    poses: manifest ? rigPoseNames(manifest) : [],
    slots,
    width: manifest?.width ?? 0,
    height: manifest?.height ?? 0,
    shown: manifest ? (pose, overrides) => rigLayers(manifest, pose, overrides).map(l => l.part) : undefined,
    outline: manifest ? (pose, overrides) => rigOutline({ ...manifest, rig: object(data) }, pose, overrides) : undefined,
    image: file => `../assets/char/${encodeURIComponent(f.char!)}/${encodeURI(file)}`,
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
  }, animation);
}

/** The animation a script line plays, opened in the studio (F12 on an `animate` line); other lines get the normal Go to Definition. */
function openAnimationAtCursor() {
  const pos = editor.getPosition();
  const ref = files.get(active)?.kind === 'script' && pos ? animateRef(editor.getModel().getLineContent(pos.lineNumber)) : null;
  if (!ref) { editor.trigger('vn', 'editor.action.revealDefinition', null); return; }
  if (!projectAssets.rigs[ref.char]) { setStatus(`${ref.char} has no rig (sprite.json) to open ${ref.name} in`); return; }
  openAnimStudio(ref.char, ref.name, { file: active, line: pos!.lineNumber });
}

/**
 * Put values for top-level properties of the rig.json tab (what the studio edits) in as one undo step.
 * Only what changed is rewritten (`writeRigText`); the rest of the file keeps its layout.
 */
function writeRigProperties(f: FileState, writes: RigWrite[]): boolean {
  const text = f.model.getValue();
  const out = writeRigText(text, writes);
  if (out === null) { setStatus(`${f.name} has errors or is not a JSON object; fix it first`); return false; }
  const edit = textChange(text, out);
  if (edit) {
    const from = f.model.getPositionAt(edit.start), to = f.model.getPositionAt(edit.end);
    f.model.pushStackElement();
    f.model.pushEditOperations([], [{ range: new monaco.Range(from.lineNumber, from.column, to.lineNumber, to.column), text: edit.insert }], () => null);
    f.model.pushStackElement();
  }
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
  showOutput(playtestText(report));
  setStatus(`playtest: ${report.endings.length} endings, ${found.length} problem${found.length === 1 ? '' : 's'}${report.complete ? '' : ' (incomplete)'}`);
}
/** Words, lines and reading time of the scripts as they are in the editor, in the Output panel. */
function showStats() {
  const stats = scriptStats(program);
  showOutput(statsText(stats));
  setStatus(`${stats.total.words} words, reading time ${readingTime(stats.minutes)}`);
}
/** Fill the Output panel; `file.ext:line[:col]` references to open files become links. Stays scrolled to the end if it was there. */
function showOutput(text: string) {
  const atEnd = outputText.scrollTop + outputText.clientHeight >= outputText.scrollHeight - 4;
  const names = [...files.keys()];
  outputText.replaceChildren();
  for (const [i, row] of text.replace(/\r\n?/g, '\n').split('\n').entries()) {
    if (i) outputText.append('\n');
    let at = 0;
    for (const ref of findFileRefs(row)) {
      const name = resolveFileRef(ref.path, names);
      if (!name) continue;
      const a = document.createElement('a');
      a.href = '#';
      a.textContent = row.slice(ref.start, ref.end);
      a.title = `Open ${name} at line ${ref.line}`;
      a.addEventListener('click', e => { e.preventDefault(); goToLine(name, ref.line, ref.col); });
      outputText.append(row.slice(at, ref.start), a);
      at = ref.end;
    }
    outputText.append(row.slice(at));
  }
  outputEl.hidden = false;
  if (atEnd) outputText.scrollTop = outputText.scrollHeight;
}

/** Writes every open file now (pending autosaves included). */
const saveAllNow = () => Promise.all([...files.values()].map(f => { clearTimeout(f.timer); return save(f); }));

/** Run a dev-server task; its output streams in as NDJSON (`{"out"}` chunks, then `{"ok"}`), see runTask in preview/dev-server.mjs. */
async function runTask(name: string, label: string, params = ''): Promise<{ ok: boolean; output: string }> {
  if (!caps.tasks.includes(name)) { setStatus(`${label} ${NOT_IN_DEMO}`); return { ok: false, output: '' }; }
  setStatus(`${label}...`);
  let output = '', ok = false, frame = 0;
  const show = () => { frame = 0; showOutput(output.trim() || '(running...)'); };
  try {
    const r = await fetch(`/api/task?name=${encodeURIComponent(name)}${params}`, { method: 'POST', headers: { 'X-VN-Editor': '1' } });
    if (!r.body) throw new Error('no body');
    const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
    let pending = '';
    show();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const rows = (pending + value).split('\n');
      pending = rows.pop() ?? '';
      for (const row of rows) {
        if (!row) continue;
        const m = JSON.parse(row) as { out?: string; ok?: boolean };
        if (typeof m.out === 'string') output += m.out;
        if (typeof m.ok === 'boolean') ok = m.ok;
      }
      if (!frame) frame = requestAnimationFrame(show);
    }
  } catch {
    cancelAnimationFrame(frame);
    if (output) showOutput(output.trim());
    setStatus(`${label}: could not reach the dev server`);
    return { ok: false, output };
  }
  cancelAnimationFrame(frame);
  showOutput(output.trim() || '(no output)');
  setStatus(`${label}: ${ok ? 'done' : 'failed'} (see Output)`);
  return { ok, output };
}

/** Move keyboard focus between the three panes (Alt+1/2/3), showing the pane first when it is hidden. */
function focusPane(pane: 'editor' | 'preview' | 'files') {
  if (pane === 'editor') { editor.focus(); return; }
  if (pane === 'preview') {
    document.body.classList.remove('no-preview');
    preview.focus();
    preview.contentWindow?.focus(); // the game listens for keys on its own window
    setStatus('preview focused: Alt+1 returns to the editor');
    return;
  }
  if (sidebarEl.hidden) setSidebar(true);
  $<HTMLInputElement>('sbFilter').focus();
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
    { title: 'Story: Script Statistics (words, lines and reading time per script, label and character)', run: showStats },
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
    { title: 'New Script Folder', run: () => newFolder() },
    { title: 'Files: Restore from Trash (deleted and replaced files)', run: () => void openTrash() },
    { title: 'Files: Empty Trash', run: () => void emptyTrash() },
    { title: 'View: Show or Hide Files Panel', key: { code: K.CtrlCmd | C.KeyB, label: 'Ctrl+B' }, run: () => setSidebar(sidebarEl.hidden) },
    { title: 'Focus: Editor', key: { code: K.Alt | C.Digit1, label: 'Alt+1' }, run: () => focusPane('editor') },
    { title: 'Focus: Preview (play with the keyboard)', key: { code: K.Alt | C.Digit2, label: 'Alt+2' }, run: () => focusPane('preview') },
    { title: 'Focus: Files Panel (filter box)', key: { code: K.Alt | C.Digit3, label: 'Alt+3' }, run: () => focusPane('files') },
    { title: 'Close Tab', key: { code: K.Alt | C.KeyW, label: 'Alt+W' }, when: () => active !== '' || !!stock, run: () => (stock ? closeStock() : closeTab(active)) },
    { title: 'Save', key: { code: K.CtrlCmd | C.KeyS, label: 'Ctrl+S' }, run: () => saveFile(files.get(active)) },
    { title: 'Save All', run: () => { for (const f of files.values()) saveFile(f); } },
    { title: 'Open game.json (title screen, menus, theme)', when: () => active !== GAME, run: () => activate(GAME) },
    { title: 'Theme: Panel (palette and components)', run: () => themeDialog.open(files.get(active)?.kind === 'theme' ? files.get(active)!.char! : null, () => editor.focus()) },
    { title: 'Theme: Open or Create a Theme File (themes/<name>.json)', run: () => palette.setText(THEME_PICK) },
    { title: 'Theme: Open or Create a Theme Stylesheet (themes/<name>.css)', run: () => palette.setText(THEME_CSS_PICK) },
    { title: 'Theme: Move the Inline Theme of game.json to a Theme File', run: () => moveThemeToFile() },
    { title: 'Character: Edit Rig (z-order, groups, shorthands)', run: () => palette.setText(RIG_PICK) },
    { title: 'Character: Update Rig from Reconverted Art', when: () => files.get(active)?.kind === 'rig', run: updateRigFromArt },
    { title: 'Character: Animation Studio (play and inspect animations)', run: () => {
      if (files.get(active)?.kind === 'rig') openAnimStudio(); else palette.setText(ANIM_PICK); // no rig tab: pick a character first
    } },
    { title: 'Animation: Open the Animation on This Line in the Studio', key: { code: C.F12, label: 'F12' }, when: () => files.get(active)?.kind === 'script', run: openAnimationAtCursor },
    { title: 'Next Problem', key: { code: C.F8, label: 'F8' }, run: nextProblem },
    { title: 'Previous Problem', key: { code: K.Shift | C.F8, label: 'Shift+F8' }, run: () => editor.trigger('vn', 'editor.action.marker.prevInFiles', null) },
    { title: 'Toggle Word Wrap', key: { code: K.Alt | C.KeyZ, label: 'Alt+Z' }, run: () => {
      editor.updateOptions({ wordWrap: editor.getOption(monaco.editor.EditorOption.wordWrap) === 'on' ? 'off' : 'on' });
    } },
    { title: 'Toggle Minimap', run: () => editor.updateOptions({ minimap: { enabled: !editor.getOption(monaco.editor.EditorOption.minimap).enabled } }) },
    { title: 'Build: Checks and Export (web or desktop)', when: () => caps.tasks.includes('build'), run: () => void buildDialog.open(() => editor.focus()) },
    { title: 'Git: Commit All Changes (review, then stage and commit the project folder)', when: () => caps.git, run: () => void gitPanel.open(() => editor.focus()) },
    { title: 'Export Web Build (build/web)', when: () => caps.tasks.includes('export'), run: () => runTask('export', 'export') },
    { title: 'Open Exported Game', when: () => caps.tasks.includes('export'), run: () => { window.open('../build/web/', '_blank', 'noopener'); } },
    { title: 'Export Strings (locale/<source language>.json, report untranslated)', when: () => caps.tasks.includes('strings'), run: () => runTask('strings', 'strings') },
    { title: 'Translations: Edit Side by Side (and export CSV for translators)', run: () => void translations.open(() => editor.focus()) },
    { title: 'Voice: Recordings per Line (drop audio files, find outdated takes)', run: () => void voiceDialog.open(() => editor.focus()) },
    { title: 'Reconvert All Art (masters/ to assets/)', when: () => caps.tasks.includes('art'), run: () => runTask('art', 'art') },
    // The online demo keeps the project in this browser (online/sw.ts): a zip is the way to keep it or move it to the desktop tools.
    { title: 'Online: Download Project as .zip', when: () => caps.online, run: async () => { await saveAllNow(); location.assign('../project.zip'); } },
    { title: 'Online: Back to the Project List', when: () => caps.online, run: async () => { await saveAllNow(); location.assign('../../../'); } },
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
      const base = newFileBase(q);
      if (base && !files.has(`${base}.vn`) && !files.has(q.trim())) {
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

  // Character pickers for the Edit Rig and Animation Studio commands: characters only, so Enter never opens an image.
  const charMode = (prefix: string, title: string, run: (char: string) => void): PaletteMode => ({
    prefix, title, placeholder: `${title}: pick a character`,
    items: q => rank(Object.keys(projectAssets.rigs).sort(), q, c => c).map(({ entry: c, hits }) => ({ label: c, hits, detail: title, run: () => run(c) })),
  });
  const pickers = [charMode(RIG_PICK, 'Edit rig', openRig), charMode(ANIM_PICK, 'Animation studio', c => openAnimStudio(c))];
  const themeMode: PaletteMode = {
    prefix: THEME_PICK, title: 'Theme file', placeholder: 'Theme name (themes/<name>.json): pick one, or type a new name and press Enter',
    items: q => {
      const names = new Set([...Object.keys(themeTexts), ...[...files.values()].filter(f => f.kind === 'theme').map(f => f.char!)]);
      const found = rank([...names].sort(), q, n => n).map(({ entry: n, hits }): PaletteItem => ({ label: n, hits, detail: files.has(themeFileName(n)) ? 'theme (open)' : 'theme', run: () => openTheme(n) }));
      const name = q.trim();
      if (name && !names.has(name)) found.push(/^[\w-]+$/.test(name) ? { label: `Create themes/${name}.json`, className: 'create', run: () => openTheme(name) } : { label: 'Not a valid theme name', detail: 'letters, digits, _ and -', className: 'empty', run: () => {} });
      return found.length ? found : [{ label: 'Type a name for the new theme', className: 'empty', run: () => {} }];
    },
  };
  const themeCssMode: PaletteMode = {
    prefix: THEME_CSS_PICK, title: 'Theme stylesheet', placeholder: 'Theme name (themes/<name>.css): pick one, or type a new name and press Enter',
    items: q => {
      const names = new Set([...Object.keys(themeTexts), ...Object.keys(themeSheets), ...[...files.values()].filter(f => f.kind === 'theme' || f.kind === 'themecss').map(f => f.char!)]);
      const found = rank([...names].sort(), q, n => n).map(({ entry: n, hits }): PaletteItem => ({ label: n, hits, detail: files.has(themeSheetName(n)) ? 'stylesheet (open)' : n in themeSheets ? 'stylesheet' : 'new stylesheet', run: () => openThemeSheet(n) }));
      const name = q.trim();
      if (name && !names.has(name)) found.push(/^[\w-]+$/.test(name) ? { label: `Create themes/${name}.css`, className: 'create', run: () => openThemeSheet(name) } : { label: 'Not a valid theme name', detail: 'letters, digits, _ and -', className: 'empty', run: () => {} });
      return found.length ? found : [{ label: 'Type a name for the new stylesheet', className: 'empty', run: () => {} }];
    },
  };
  const newMode: PaletteMode = {
    prefix: NEW_PICK, title: 'New script file', placeholder: 'New script file name (e.g. chapter2), Enter creates it',
    items: q => {
      if (!q.trim()) return [{ label: 'Type a name for the new file', detail: 'folders with /, .vn is added', className: 'empty', run: () => {} }];
      const base = newFileBase(q);
      if (!base) return [{ label: 'Not a valid file name', detail: 'letters, digits, _ - . and / for folders', className: 'empty', run: () => {} }];
      if (files.has(`${base}.vn`)) return [{ label: `${base}.vn`, detail: 'exists: open it', run: () => activate(`${base}.vn`) }];
      return [{ label: `Create ${base}.vn`, className: 'create', run: () => void newFile(base) }];
    },
  };
  const newFolderMode: PaletteMode = {
    prefix: NEW_FOLDER, title: 'New folder', placeholder: 'New folder name under script/ (e.g. chapter2), Enter creates it',
    items: q => {
      if (!q.trim()) return [{ label: 'Type a name for the new folder', detail: 'nested with /', className: 'empty', run: () => {} }];
      const dir = q.trim().replace(/\/+$/, '');
      if (!/^[\w\-./]+$/.test(dir) || dir.includes('..')) return [{ label: 'Not a valid folder name', detail: 'letters, digits, _ - . and / for nesting', className: 'empty', run: () => {} }];
      if (scriptDirs.includes(dir)) return [{ label: `${dir}/`, detail: 'exists', className: 'empty', run: () => {} }];
      return [{ label: `Create folder ${dir}/`, className: 'create', run: () => void newFolder(dir) }];
    },
  };
  const newAssetFolderMode: PaletteMode = {
    prefix: NEW_ASSET_FOLDER, title: 'New asset folder', placeholder: 'New folder name under assets/ (e.g. sfx), Enter creates it',
    items: q => {
      const dir = q.trim().replace(/\/+$/, '');
      if (!dir) return [{ label: 'Type a name for the new folder', detail: 'one level: assets/<name>/', className: 'empty', run: () => {} }];
      if (!/^[\w\-]+$/.test(dir)) return [{ label: 'Not a valid folder name', detail: 'letters, digits, _ and -', className: 'empty', run: () => {} }];
      if (projectAssets.dirs.includes(dir)) return [{ label: `assets/${dir}/`, detail: 'exists', className: 'empty', run: () => {} }];
      return [{ label: `Create folder assets/${dir}/`, className: 'create', run: () => void newAssetFolder(dir) }];
    },
  };
  const renameMode: PaletteMode = {
    prefix: RENAME, title: 'Rename or move', placeholder: 'New path (another folder moves it), Enter renames',
    items: q => {
      if (!renaming) return [{ label: 'Pick a file or folder in the Files panel first', detail: 'right-click, Rename, or F2', className: 'empty', run: () => {} }];
      const { from, isDir } = renaming;
      const plan = planMove(from, q, isDir);
      if ('error' in plan) return [{ label: plan.error === 'same name' ? `Type a new name for ${from}` : plan.error, className: 'empty', run: () => {} }];
      return [{ label: `Rename to ${plan.to}`, detail: `from ${from}`, className: 'create', run: () => void movePath(from, plan.to, isDir) }];
    },
  };
  const trashMode: PaletteMode = {
    prefix: TRASH_PICK, title: 'Restore from trash', placeholder: 'Pick what to put back (filter by path)',
    items: q => {
      if (!trashEntries.length) return [{ label: 'The project trash is empty', className: 'empty', run: () => {} }];
      const now = Date.now();
      return rank(trashEntries, q, e => e.paths.join(' ')).map(({ entry: e, hits }) => ({
        ...describeTrashEntry(e, now), hits, run: () => void restoreTrash(e.id),
      }));
    },
  };
  pickers.push(themeMode, themeCssMode, newMode,newFolderMode, newAssetFolderMode, renameMode, trashMode);

  const modes = [fileMode, commandMode, labelMode, lineMode, assetMode];
  const helpMode: PaletteMode = {
    prefix: '?', title: 'Help', placeholder: 'Pick a mode',
    items: () => modes.map(m => ({ label: `${m.prefix || '(nothing)'}  ${m.title}`, run: () => palette.setText(m.prefix) })),
  };
  palette = new Palette($('left'), [...pickers, ...modes, helpMode], () => editor.focus()); // pickers first: their prefixes start with '#'
  help = new HelpDialog(document.body);
  assetViewer = new AssetViewer(document.body);
  animStudio = new AnimStudio(document.body);
  outlineView = new OutlineView(document.body, goToLine);
  voiceDialog = new VoiceDialog(document.body, {
    rows: () => { recompile(); return stringRows(program); },
    reveal: goToLine,
    source: () => sourceLanguage(openGame() as { language?: unknown } | null),
    declared: () => declaredVoiceLanguages(openGame() as { voiceLanguages?: unknown } | null, sourceLanguage(openGame() as { language?: unknown } | null)),
  });
  const saveAll = async () => { await saveAllNow(); };
  themeDialog = new ThemeDialog(document.body, {
    themes: () => [...new Set([...Object.keys(themeTexts), ...[...files.values()].filter(f => f.kind === 'theme').map(f => f.char!)])].sort(),
    text: n => files.get(themeFileName(n))?.model.getValue() ?? themeTexts[n] ?? null,
    parsed: themeDialogFiles,
    apply: (n, text) => {
      const name = themeFileName(n);
      const f = files.get(name) ?? addFile(name, themeTexts[n] ?? '', 'theme', n);
      f.model.pushEditOperations([], [{ range: f.model.getFullModelRange(), text }], () => null);
    },
    builtIns: () => Object.keys(BUILTIN_THEMES),
    duplicate: (from, to) => {
      const text = files.get(themeFileName(from))?.model.getValue() ?? themeTexts[from]
        ?? `${JSON.stringify({ extends: 'base', ...(from === 'base' ? { tokens: {}, components: {} } : BUILTIN_THEMES[from]) }, null, 2)}
`;
      const name = themeFileName(to);
      const f = files.get(name) ?? addFile(name, '', 'theme', to);
      f.model.pushEditOperations([], [{ range: f.model.getFullModelRange(), text }], () => null);
      recompile();
    },
    openJson: n => openTheme(n),
    fonts: () => projectAssets.files.filter(x => x.startsWith('fonts/')).map(x => x.slice(6)),
    css: n => {
      const themes = themeDialogFiles();
      // The theme's own stylesheet (open tabs as edited, the rest as loaded), like the preview adds it after the generated CSS.
      const sheets = { ...themeSheets, ...Object.fromEntries([...files.values()].filter(f => f.kind === 'themecss').map(f => [f.char!, f.model.getValue() as string])) };
      const sheet = themeStylesheet(n, themes, sheets);
      return themeCss({ ...resolveTheme(n, themes), ...(sheet ? { css: sheet } : {}) }, projectAssets.files.map(file => ({ file, v: 0 })));
    },
    stage: () => {
      let game: unknown = null;
      try { game = JSON.parse(files.get(GAME)?.model.getValue() ?? '{}'); } catch { /* keep the default size */ }
      return stageSize(game);
    },
  });
  buildDialog = new BuildDialog(document.body, {
    reveal: goToLine,
    openTranslations: () => void translations.open(() => editor.focus()),
    openVoice: () => void voiceDialog.open(() => editor.focus()),
    saveAll,
    build: (target, out, langs) => runTask('build', 'build', `&target=${target}&out=${encodeURIComponent(out)}${langQuery(langs)}`),
    portable: 'vnStudio' in window, // studio/preload.cjs
  });
  gitPanel = new GitPanel($('sbGit'), document.body, { saveAll, done: setStatus });
  if (caps.git) void gitPanel.refresh();
  translations = new TranslationsDialog(document.body, {
    rows: () => { recompile(); return stringRows(program); },
    reveal: goToLine,
    missingIds: missingIdCount,
    addIds: addIdsEverywhere,
    source: () => sourceLanguage(openGame() as { language?: unknown } | null),
  });

  // Ctrl+P, F1 and Alt+1/2/3 work wherever focus is (capture phase beats Monaco and the browser's print shortcut),
  // including inside the preview, which is same-origin. Ctrl+P is the palette (type > for commands); F1 is help;
  // Alt+1/2/3 focus the editor, the preview and the Files panel.
  const panes = { Digit1: 'editor', Digit2: 'preview', Digit3: 'files' } as const;
  const onKey = (e: KeyboardEvent) => {
    const pane = e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey ? panes[e.code as keyof typeof panes] : undefined;
    if (pane && !(palette.isOpen || help.isOpen || assetViewer.isOpen || animStudio.isOpen || translations.isOpen || voiceDialog.isOpen || buildDialog.isOpen || themeDialog.isOpen || gitPanel.isOpen)) {
      e.preventDefault();
      e.stopPropagation();
      focusPane(pane);
      return;
    }
    const ctrlP = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'p';
    const f1 = e.key === 'F1' && !e.ctrlKey && !e.altKey && !e.metaKey;
    if (!(ctrlP || f1)) return;
    if (f1) { e.preventDefault(); e.stopPropagation(); if (!palette.isOpen) toggleHelp(); return; }
    if (palette.isOpen || help.isOpen || assetViewer.isOpen || animStudio.isOpen || translations.isOpen || voiceDialog.isOpen || buildDialog.isOpen || themeDialog.isOpen || gitPanel.isOpen) return;
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
  // Shift+F12: every use of the label or variable under the cursor, the same set F2 would rename.
  const references = {
    provideReferences(model: any, pos: { lineNumber: number; column: number }) {
      const ref = target(model, pos);
      if (!ref) return [];
      const all = projectFiles();
      const uses = 'kind' in ref ? labelRefs(all).filter(r => r.name === ref.name) : variableUses(all, ref);
      return uses.filter(r => files.has(r.file)).map(r => ({
        uri: files.get(r.file)!.model.uri, range: new monaco.Range(r.line, r.col + 1, r.line, r.col + 1 + r.length),
      }));
    },
  };
  monaco.languages.registerReferenceProvider('vn', references);
  monaco.languages.registerReferenceProvider('json', references);
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
  const word = model && sel?.isEmpty() ? model.getWordAtPosition(sel.getPosition())?.word : undefined;
  findDialog.open(sel && model && !sel.isEmpty() ? model.getValueInRange(sel) : word ?? '');
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
  try { caps = readCapabilities(await (await fetch('/api/capabilities')).json()); } catch { /* an older dev server: it can do everything */ }
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
  setStatus(caps.online ? 'ready (online demo: the project is kept in this browser; Ctrl+P > Online to download it as a zip)' : 'ready');

  let sidebarShown = true;
  try { sidebarShown = localStorage.getItem(SIDEBAR_KEY) !== '0'; } catch { /* default: shown */ }
  setSidebar(sidebarShown);
  sbFilter.addEventListener('input', () => { renderSidebarFiles(); renderSidebarAssets(); });
  $('filesBtn').addEventListener('click', () => setSidebar(sidebarEl.hidden));
  $('playHere').addEventListener('click', () => void previewFromCursor());
    $('commands').addEventListener('click', () => palette.open('>'));
  $('helpBtn').addEventListener('click', toggleHelp);
  $('outlineBtn').addEventListener('click', toggleOutline);
  $('translateBtn').addEventListener('click', () => void translations.open(() => editor.focus()));
  $('buildBtn').addEventListener('click', () => void buildDialog.open(() => editor.focus()));
  $('buildBtn').hidden = !caps.tasks.includes('build');
  $('voiceBtn').addEventListener('click', () => void voiceDialog.open(() => editor.focus()));
  $('varsBtn').addEventListener('click', () => { varsEl.hidden = !varsEl.hidden; if (!varsEl.hidden) showVars(lastVars); });
  $('varsClose').addEventListener('click', () => { varsEl.hidden = true; });
  $('taskOutputClose').addEventListener('click', () => { outputEl.hidden = true; });
  followEl.addEventListener('change', showPreviewLine);
  problemsEl.addEventListener('click', nextProblem);
  setupSplitter();

  const events = new EventSource('/__events');
  events.onmessage = e => {
    if (!['content', 'masters'].includes((JSON.parse(e.data) as { type: string }).type)) return;
    void syncFromDisk();
    if (caps.git) gitPanel.refreshSoon();
  };
}

void boot();
