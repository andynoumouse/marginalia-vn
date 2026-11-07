// Scene editor: Monaco + the engine's own parser for live diagnostics and completions,
// next to the live preview. Files are saved to disk through the dev server, which is what
// triggers the preview's hot reload. game.json (title screen and menus) is a JSON tab with a schema.

import {
  COMMAND_WORDS, sourceLanguage, declaredVoiceLanguages, stringRows, animateRef, wordSpan, compile, namedAnchors, namedPositions, stageSize, assignIds, existingIds, getCompletions, insideScreen, playtest, playtestDiagnostics, playtestText, scriptStats, statsText, readingTime, checkAssets, checkGame, helpTopicAt, rigHelpTopicAt, buildOutline, checkRig, mergeRig, studioDocOf, studioWrites, rigSkeleton, type UiScreen, writeRigText, textChange, type RigWrite, findFileRefs, resolveFileRef, readCapabilities, 
  BUILTIN_THEMES, themeCss, themeStylesheet, resolveTheme, type RigManifest,
} from '../engine/src/index.js';
import { AssetViewer } from './asset-viewer.js';
import { AnimStudio, type Mode } from './anim-studio.js';
import { manifestHost } from './studio-host.js';
import { HelpDialog } from './help-dialog.js';
import { FindDialog } from './find-dialog.js';
import { TranslationsDialog } from './translations-dialog.js';
import { VoiceDialog } from './voice-dialog.js';
import { BuildDialog, langQuery, playtestQuery } from './build-dialog.js';
import { ThemeDialog } from './theme-dialog.js';
import { GitPanel } from './git-dialog.js';
import { OutlineView } from './outline-view.js';
import { Palette } from './palette.js';
import { updateGameSchema } from './json-schemas.js';
import { initPreviewLink, previewFromCursor, previewScreen, showPreviewLine, toggleFollow, toggleVars } from './preview-link.js';
import { applyEdits, registerColors, registerRename } from './rename.js';
import { buildCommands, NEW_FOLDER, NEW_PICK, paletteModes, type CommandHost } from './commands.js';
import { collapsedDirs, initSidebar, renderSidebarAssets, renderSidebarFiles, sbFilter, setAssets, setSidebar, SIDEBAR_KEY, sidebarEl, type Project } from './sidebar.js';
import { $, errorCount, files, GAME, GAME_URI, isDirty, norm, NOT_IN_DEMO, openTabs, postPreview, projectFiles, recentFiles, rigName, S, scripts, setStatus, themeFileName, themeSheetName, type FileState } from './state.js';

declare const require: any;
declare const monaco: any;

// Monaco cancels its own pending requests (hover, highlights, ...) when the model changes, e.g. when a tab opens, and
// the cancelled promise rejects with a plain "Canceled" error nobody catches. It is not a failure; keep it out of the console.
window.addEventListener('unhandledrejection', e => {
  if (e.reason?.name === 'Canceled' && e.reason?.message === 'Canceled') e.preventDefault();
});

const tabsEl = $('tabs'), problemsEl = $('problems');
const preview = $<HTMLIFrameElement>('preview');

/** The "did you mean" names of the current markers, by fixKey(). */
const quickFixes = new Map<string, string[]>();
const fixKey = (uri: { toString(): string }, line: number, message: string) => `${uri.toString()}|${line}|${message}`;
const GAME_TEMPLATE = `{
  "title": "Untitled",
  "titleScreen": {
    "background": "",
    "music": "",
    "buttons": ["new_game", "continue", "load", "options"]
  }
}
`;


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
  registerLanguageConfig();
  registerTokenizer();
  defineTheme();
  registerCompletions();
  registerQuickFixes();
}

/** Comments, brackets, auto-closing pairs and the indent after a line that ends in a colon. */
function registerLanguageConfig() {
  monaco.languages.setLanguageConfiguration('vn', {
    comments: { lineComment: '#' },
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
    autoClosingPairs: [{ open: '"', close: '"' }, { open: '{', close: '}' }, { open: '[', close: ']' }, { open: '(', close: ')' }],
    onEnterRules: [{
      beforeText: /^\s*(label\s+\w+\s*(\([^()]*\))?\s*:|menu\s*:|if\s.+:|elif\s.+:|else\s*:|".*"[^:]*:)\s*$/,
      action: { indentAction: monaco.languages.IndentAction.Indent },
    }],
  });
}

/** Syntax colouring: dialogue, quoted menu options and command lines. */
function registerTokenizer() {
  monaco.languages.setMonarchTokensProvider('vn', {
    // Every statement word comes from the parser; the rest start the elements of a screen block.
    keywords: [...COMMAND_WORDS, 'hotspot', 'button', 'text', 'each', 'scroll', 'row', 'column', 'grid', 'cancel'],
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
}

function defineTheme() {
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
}

/** Ctrl+Space and the trigger characters: the engine's completions for the line, with paths replacing everything typed since the quote. */
function registerCompletions() {
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
      const typed = /[^\s"=]*$/.exec(prefix)![0].length;
      const pathRange = { ...range, startColumn: position.column - typed };
      const above = model.getLinesContent().slice(Math.max(0, position.lineNumber - 13), position.lineNumber - 1);
      const inScreen = insideScreen(model.getLinesContent().slice(0, position.lineNumber - 1), /^\s/.test(prefix));
      return {
        suggestions: getCompletions(S.program, prefix, liveRigs(), above, inScreen, S.projectAssets.files).map((s, i) => ({
          label: s.label,
          kind: kinds[s.kind] ?? K.Text,
          detail: s.detail,
          insertText: s.insertText ?? s.label,
          insertTextRules: s.insertText?.includes('$0') ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
          sortText: String(i).padStart(3, '0'),
          range: s.path ? pathRange : range, // a path holds `/` and `.`, which end a word: replace everything typed since the quote, space or `=`
        })),
      };
    },
  });
}

function registerQuickFixes() {
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
}


// ---- files, tabs, diagnostics ----
const stockModels = new Map<string, any>();

function showStock(u: UiScreen) {
  let model = stockModels.get(u.name);
  if (!model) { model = monaco.editor.createModel(u.starter, 'vn', monaco.Uri.parse(`inmemory:///stock/${u.name}.vn`)); stockModels.set(u.name, model); }
  S.stock = u;
  S.active = '';
  S.editor.setModel(model);
  S.editor.updateOptions({ readOnly: true });
  renderTabs();
  showPreviewLine();
}

function leaveStock() {
  if (!S.stock) return;
  S.stock = null;
  S.editor.updateOptions({ readOnly: false });
}

function closeStock() {
  leaveStock();
  const next = recentFiles.find(n => openTabs.includes(n)) ?? openTabs.at(-1);
  if (next) { activate(next); return; }
  S.editor.setModel(null);
  renderTabs();
}

function renderTabs() {
  const stockTab = S.stock ? [(() => {
    const tab = document.createElement('div');
    tab.className = 'tab';
    tab.dataset.selected = 'true';
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', 'true');
    b.textContent = `${S.stock!.title} (default, read-only)`;
    b.title = "The default screen's code. Use Edit in the Files panel to get a copy you can change.";
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'close';
    x.textContent = '×';
    x.setAttribute('aria-label', 'Close the default screen');
    x.addEventListener('click', closeStock);
    tab.append(b, x);
    return tab;
  })()] : [];
  tabsEl.replaceChildren(...openTabs.flatMap(name => {
    const f = files.get(name);
    if (!f) return [];
    const tab = document.createElement('div');
    tab.className = 'tab';
    tab.dataset.selected = String(name === S.active);
    tab.dataset.errors = String(errorCount(f) > 0);
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(name === S.active));
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


/** Shows `name` in the editor; `focus` false leaves the keyboard where it is (a click in the Files panel). */
function activate(name: string, focus = true) {
  const f = files.get(name);
  if (!f) return;
  leaveStock();
  S.active = name;
  if (!openTabs.includes(name)) openTabs.push(name);
  const seenAt = recentFiles.indexOf(name);
  if (seenAt >= 0) recentFiles.splice(seenAt, 1);
  recentFiles.unshift(name);
  S.editor.setModel(f.model);
  renderTabs();
  showPreviewLine();
  if (focus) S.editor.focus();
}

function closeTab(name: string) {
  const at = openTabs.indexOf(name);
  if (at < 0) return;
  const f = files.get(name);
  if (f) saveFile(f); // edits are autosaved anyway; do it now so closing never leaves a pending write
  openTabs.splice(at, 1);
  if (name !== S.active) { renderTabs(); return; }
  const next = recentFiles.find(n => n !== name && openTabs.includes(n)) ?? openTabs[Math.min(at, openTabs.length - 1)];
  if (next) { activate(next); return; }
  S.active = '';
  S.editor.setModel(null);
  showPreviewLine();
  renderTabs();
}

let compileTimer = 0;

/** Files, rigs, blip voices and skins for checkAssets; game.json is read from its tab (unsaved edits count). */
function assetIndex() {
  let game: any = {};
  try { game = JSON.parse(files.get(GAME)?.model.getValue() ?? '{}'); } catch { /* the JSON tab shows its own errors */ }
  return {
    files: S.projectAssets.files, rigs: liveRigs(),
    blips: Object.keys(game?.blips ?? {}), skins: Object.keys(game?.theme?.skins ?? {}),
  };
}

/** The rigs with the rig.json tabs' text (saved or not) in place of what is on disk. */
function liveRigs(): Record<string, RigManifest> {
  const out = { ...S.projectAssets.rigs };
  for (const f of files.values()) {
    if (f.kind !== 'rig' || !f.char || !out[f.char]) continue;
    let rig;
    try { rig = JSON.parse(f.model.getValue()); } catch { continue; } // mid-typing: keep the last good rig; the JSON tab shows its own errors
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
  S.program = compile(scripts().map(f => ({ file: f.name, text: f.model.getValue() })), namedPositions(game), namedAnchors(game), stageSize(game));
  monaco.editor.removeAllMarkers('vn-playtest'); // the playtest describes the script as it was; edits make it stale
  S.program.diagnostics.push(...checkAssets(S.program, assetIndex()));
  const gameFile = files.get(GAME);
  if (gameFile) {
    let game: unknown = null;
    try { game = JSON.parse(gameFile.model.getValue()); } catch { /* the JSON tab shows its own errors */ }
    S.program.diagnostics.push(...checkGame(game, assetIndex(), gameFile.model.getValue()));
  }
  updateGameSchema();
  for (const f of files.values()) if (f.kind === 'rig') monaco.editor.setModelMarkers(f.model, 'vn', rigMarkers(f));
  S.outlineView?.update(buildOutline(S.program));
  quickFixes.clear();
  for (const f of [...scripts(), ...(gameFile ? [gameFile] : [])]) {
    const markers = S.program.diagnostics.filter(d => d.file === f.name).map(d => {
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

// Counted so syncFromDisk can tell that a save landed while its GET was in flight (its text is then older than the model's).
let saving = 0, saveEpoch = 0;

const saveChains = new WeakMap<FileState, Promise<void>>();

/** One PUT per file at a time, in order: the timer, Ctrl+S, leaving and Preview-from-cursor can all ask at once. */
function save(f: FileState): Promise<void> {
  const run = (saveChains.get(f) ?? Promise.resolve()).then(() => saveNow(f));
  saveChains.set(f, run);
  return run;
}

async function saveNow(f: FileState) {
  if (f.model.isDisposed()) return; // the file was deleted while its save waited its turn
  const text: string = f.model.getValue(); // read when its turn comes, so a queued save writes the latest text
  if (norm(text) === norm(f.saved)) return;
  if (f.kind !== 'script' && f.kind !== 'themecss') {
    try { JSON.parse(text); } catch { setStatus(`${f.name} has errors; not saved`); return; }
  }
  setStatus('saving...');
  saving++;
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
  } catch (e) {
    console.warn(`saving ${f.name} failed:`, e);
    setStatus('save failed');
  } finally {
    saving--;
    saveEpoch++;
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
  if (S.animStudio?.hasUnapplied) names.push('animation studio');
  return names;
}

// Leaving with unsaved edits: start the pending saves now and ask (the browser, or Marginalia Studio, shows the question).
window.addEventListener('beforeunload', e => {
  S.translations?.flushPending(); // the translations table debounces its own writes, and is not a tab
  const unsaved = unsavedWork();
  if (!unsaved.length) return;
  for (const f of files.values()) if (isDirty(f) && f.saved !== '') { clearTimeout(f.timer); void save(f); }
  e.preventDefault();
  e.returnValue = '';
});

// ---- preview link ----

// ---- toolbar actions ----
function addIds() {
  const f = files.get(S.active);
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
  S.editor.executeEdits('vn-ids', edits);
  setStatus(`added ${added} ids`);
}

/** The file name `raw` asks for, without `.vn`, or null when it is not a valid script path. */
function newFileBase(raw: string): string | null {
  const base = raw.trim().replace(/\.vn$/, '');
  return base && /^[\w\-./]+$/.test(base) && !base.includes('..') ? base : null;
}

// Without a name, ask in the palette (window.prompt is dismissed silently by some hosts).
async function newFile(given?: string, starter?: string, dir?: string) {
  if (given === undefined) { S.palette.setText(NEW_PICK + (dir ? `${dir}/` : '')); return; }
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
  if (given === undefined) { S.palette.setText(NEW_FOLDER + (parent ? `${parent}/` : '')); return; }
  const dir = given.trim().replace(/\/+$/, '');
  if (!dir || !/^[\w\-./]+$/.test(dir) || dir.includes('..')) { setStatus('invalid folder name'); return; }
  const r = await fetch(`/api/folder?dir=${encodeURIComponent(dir)}`, { method: 'PUT', headers: { 'X-VN-Editor': '1' } });
  if (!r.ok) { setStatus('could not create folder'); return; }
  for (let p = dir; p; p = p.slice(0, Math.max(p.lastIndexOf('/'), 0))) if (!S.scriptDirs.includes(p)) S.scriptDirs.push(p);
  collapsedDirs.delete(dir);
  renderSidebarFiles();
}

// Pick up edits made outside the editor (for example in VS Code) when the file is not dirty here.
async function syncFromDisk() {
  let proj: Project;
  const epoch = saveEpoch;
  try { proj = await (await fetch('/api/project')).json(); } catch { return; }
  if (saving || epoch !== saveEpoch) return; // a save finished meanwhile: this disk text may be older than the model; the watcher fires again
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
const toggleOutline = () => S.outlineView.toggle(buildOutline(S.program), () => S.editor.focus());

/** F1 / Help button: the command reference at the statement under the cursor; a game.json tab shows docs/game-json.md,
 *  a rig.json tab docs/rig-json.md at the key (order, bones, looks) the cursor is under. */
function toggleHelp() {
  const kind = files.get(S.active)?.kind;
  let key: string | null = null;
  if (isScript()) {
    const pos = S.editor.getPosition();
    key = helpTopicAt(S.editor.getModel().getLineContent(pos.lineNumber), pos.column - 1);
  } else if (kind === 'rig') {
    key = rigHelpTopicAt(S.editor.getModel().getLinesContent(), S.editor.getPosition().lineNumber - 1);
  }
  S.help.toggle(key, () => S.editor.focus(), isScript() ? 'commands' : kind === 'rig' ? 'rig-json' : 'game-json');
}

const isScript = () => files.get(S.active)?.kind === 'script';

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
  line = Math.min(Math.max(line, 1), S.editor.getModel().getLineCount());
  S.editor.revealLineInCenter(line);
  S.editor.setPosition({ lineNumber: line, column: col ?? 1 + (S.editor.getModel().getLineContent(line).match(/^\s*/)?.[0].length ?? 0) });
  S.editor.focus();
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
  const pos = S.editor.getPosition();
  const here = key(S.active, pos?.lineNumber ?? 0, pos?.column ?? 0);
  const next = all.find(p => cmp(key(p.name, p.m.startLineNumber, p.m.startColumn), here) > 0) ?? all[0];
  activate(next.name);
  S.editor.setPosition({ lineNumber: next.m.startLineNumber, column: next.m.startColumn });
  S.editor.revealLineInCenter(next.m.startLineNumber);
  S.editor.focus();
}

/** Open a character's rig.json in a tab. Without a file yet the tab starts from a generated skeleton and stays unsaved. */
function openRig(char: string) {
  const name = rigName(char);
  if (files.has(name)) { activate(name); return; }
  const manifest = S.projectAssets.rigs[char];
  if (!manifest) { setStatus(`${char} has no sprite.json (convert its PSD first)`); return; }
  const onDisk = S.projectAssets.rigTexts[char];
  const f = addFile(name, onDisk ?? `${JSON.stringify(rigSkeleton(manifest), null, 2)}\n`, 'rig', char);
  if (onDisk === undefined) { f.saved = ''; setStatus(`${name} is new: Ctrl+S saves the generated skeleton`); }
  recompile();
  activate(name);
}

/** Open themes/<name>.json in a tab; a name that has no file yet starts one that extends `base` (saved on the first edit). */
function openTheme(theme: string) {
  const name = themeFileName(theme);
  if (files.has(name)) { activate(name); return; }
  const onDisk = S.themeTexts[theme];
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
  const onDisk = S.themeSheets[theme];
  const f = addFile(name, onDisk ?? `/* Extra CSS for the "${theme}" theme, added after the generated theme styles. */\n`, 'themecss', theme);
  if (onDisk === undefined) { f.saved = ''; setStatus(`${name} is new: Ctrl+S saves it`); }
  activate(name);
}

/** Every theme file parsed (open tabs as edited, the rest as loaded), by name. */
function themeDialogFiles(): Record<string, unknown> {
  const names = new Set([...Object.keys(S.themeTexts), ...[...files.values()].filter(f => f.kind === 'theme').map(f => f.char!)]);
  const own = Object.fromEntries([...names].flatMap(n => { try { return [[n, JSON.parse(files.get(themeFileName(n))?.model.getValue() ?? S.themeTexts[n] ?? '')]]; } catch { return []; } }));
  return { ...BUILTIN_THEMES, ...own }; // a theme file replaces a built-in one of the same name
}

/** Add parts that are new in the converted art to the open rig.json's order (and bones for their PSD folders); report ones that disappeared. */
function updateRigFromArt() {
  const f = files.get(S.active);
  const manifest = f?.kind === 'rig' && f.char ? S.projectAssets.rigs[f.char] : undefined;
  if (!f || !manifest) return;
  let data;
  try { data = JSON.parse(f.model.getValue()); } catch { setStatus(`${f.name} has errors; fix them first`); return; }
  const { rig, added, missing, bonesAdded } = mergeRig(data, manifest);
  if (added.length) f.model.pushEditOperations([], [{ range: f.model.getFullModelRange(), text: `${JSON.stringify(rig, null, 2)}\n` }], () => null);
  setStatus([added.length ? `added to order: ${added.join(', ')}` : 'order already has every part',
    bonesAdded.length ? `new bones from PSD folders: ${bonesAdded.join(', ')}` : '',
    missing.length ? `no longer in the art: ${missing.join(', ')}` : ''].filter(Boolean).join('; '));
}

/** game.json as the tab holds it (unsaved edits count); null while it does not parse. */
function openGame(): unknown {
  try { return JSON.parse(files.get(GAME)?.model.getValue() ?? '{}'); } catch { return null; }
}

/** Open the animation studio for `char` (opening its rig.json tab) or else for the character of the active rig.json tab; unsaved text counts. */
function openAnimStudio(char?: string, animation?: string, scene?: { file: string; line: number }, mode?: Mode) {
  const wasOpen = char ? openTabs.includes(rigName(char)) : true; // a rig tab opened only for the studio goes away with it
  const before = S.active;
  const cursor = S.editor.getPosition();
  const target = files.get(before)?.kind === 'script' && cursor ? { file: before, line: cursor.lineNumber } : null; // where Insert in script puts the show line
  if (char) openRig(char);
  const f = files.get(S.active);
  if (f?.kind !== 'rig' || !f.char) return;
  let data;
  try { data = JSON.parse(f.model.getValue()); } catch { setStatus(`${f.name} has errors; fix them first`); return; }
  const manifest = S.projectAssets.rigs[f.char];
  const start = studioDocOf(data);
  let applied = start.rig;
  S.animStudio.open(f.char, start, {
    ...manifestHost(manifest, data),
    returnFocus: () => {
      const rigTab = char ? rigName(char) : '';
      // A generated skeleton (saved === '') stays: closing a tab autosaves it, which would create a rig.json nobody asked for.
      if (rigTab && !wasOpen && S.active === rigTab && files.get(rigTab)?.saved !== '') {
        closeTab(rigTab);
        if (before && openTabs.includes(before)) {
          activate(before);
          if (cursor) { S.editor.setPosition(cursor); S.editor.revealPositionInCenterIfOutsideViewport(cursor); }
        }
      }
      S.editor.focus();
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
    image: file => `../assets/char/${encodeURIComponent(f.char!)}/${encodeURI(file)}`,
    apply: change => {
      let current: unknown = {};
      try { current = JSON.parse(f.model.getValue()); } catch { /* the write below reports it */ }
      const ok = writeRigProperties(f, studioWrites(change, applied, current));
      if (ok) applied = change.rig;
      return ok;
    },
  }, animation, mode);
}

/** The animation a script line plays, opened in the studio (F12 on an `animate` line); other lines get the normal Go to Definition. */
function openAnimationAtCursor() {
  const pos = S.editor.getPosition();
  const ref = files.get(S.active)?.kind === 'script' && pos ? animateRef(S.editor.getModel().getLineContent(pos.lineNumber)) : null;
  if (!ref) { S.editor.trigger('vn', 'editor.action.revealDefinition', null); return; }
  if (!S.projectAssets.rigs[ref.char]) { setStatus(`${ref.char} has no rig (sprite.json) to open ${ref.name} in`); return; }
  openAnimStudio(ref.char, ref.name, { file: S.active, line: pos!.lineNumber });
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
  const report = playtest(S.program, { game, assets: assetIndex(), allLabels: true });
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
  const stats = scriptStats(S.program);
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
/** Online demo: save everything, then leave for the project list (the site's front page, three levels up from `p/<id>/editor/`). */
async function backToProjects() { await saveAllNow(); location.assign('../../../'); }

/** Run a dev-server task; its output streams in as NDJSON (`{"out"}` chunks, then `{"ok"}`), see runTask in preview/dev-server.mjs. */
async function runTask(name: string, label: string, params = ''): Promise<{ ok: boolean; output: string }> {
  if (!S.caps.tasks.includes(name)) { setStatus(`${label} ${NOT_IN_DEMO}`); return { ok: false, output: '' }; }
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
  if (pane === 'editor') { S.editor.focus(); return; }
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

function setupPalette() {
  const host: CommandHost = {
    activate, goToLine, closeTab, closeStock, saveFile, saveAllNow, backToProjects, newFile, newFolder, newFileBase,
    openRig, openTheme, openThemeSheet, openAnimStudio, openAnimationAtCursor, updateRigFromArt,
    addIds, addIdsEverywhere, runPlaytest, showStats, runTask, toggleOutline, toggleHelp, previewFromCursor, nextProblem, focusPane,
    toggleFollow, toggleVars,
  };
  const commands = buildCommands(host);
  for (const c of commands) if (c.key) S.editor.addCommand(c.key.code, () => void c.run());
  S.palette = new Palette($('left'), paletteModes(host, commands), () => S.editor.focus());
  S.help = new HelpDialog(document.body);
  S.assetViewer = new AssetViewer(document.body);
  S.animStudio = new AnimStudio(document.body);
  S.outlineView = new OutlineView(document.body, goToLine);
  S.voiceDialog = new VoiceDialog(document.body, {
    rows: () => { recompile(); return stringRows(S.program); },
    reveal: goToLine,
    source: () => sourceLanguage(openGame() as { language?: unknown } | null),
    declared: () => declaredVoiceLanguages(openGame() as { voiceLanguages?: unknown } | null, sourceLanguage(openGame() as { language?: unknown } | null)),
  });
  setupThemeDialog();
  setupBuildAndGit();
  setupTranslations();
  setupGlobalKeys();
}

function setupThemeDialog() {
  S.themeDialog = new ThemeDialog(document.body, {
    themes: () => [...new Set([...Object.keys(S.themeTexts), ...[...files.values()].filter(f => f.kind === 'theme').map(f => f.char!)])].sort(),
    text: n => files.get(themeFileName(n))?.model.getValue() ?? S.themeTexts[n] ?? null,
    parsed: themeDialogFiles,
    apply: (n, text) => {
      const name = themeFileName(n);
      const f = files.get(name) ?? addFile(name, S.themeTexts[n] ?? '', 'theme', n);
      f.model.pushEditOperations([], [{ range: f.model.getFullModelRange(), text }], () => null);
    },
    builtIns: () => Object.keys(BUILTIN_THEMES),
    duplicate: (from, to) => {
      const text = files.get(themeFileName(from))?.model.getValue() ?? S.themeTexts[from]
        ?? `${JSON.stringify({ extends: 'base', ...(from === 'base' ? { tokens: {}, components: {} } : BUILTIN_THEMES[from]) }, null, 2)}
`;
      const name = themeFileName(to);
      const f = files.get(name) ?? addFile(name, '', 'theme', to);
      f.model.pushEditOperations([], [{ range: f.model.getFullModelRange(), text }], () => null);
      recompile();
    },
    openJson: n => openTheme(n),
    fonts: () => S.projectAssets.files.filter(x => x.startsWith('fonts/')).map(x => x.slice(6)),
    css: n => {
      const themes = themeDialogFiles();
      // The theme's own stylesheet (open tabs as edited, the rest as loaded), like the preview adds it after the generated CSS.
      const sheets = { ...S.themeSheets, ...Object.fromEntries([...files.values()].filter(f => f.kind === 'themecss').map(f => [f.char!, f.model.getValue() as string])) };
      const sheet = themeStylesheet(n, themes, sheets);
      return themeCss({ ...resolveTheme(n, themes), ...(sheet ? { css: sheet } : {}) }, S.projectAssets.files.map(file => ({ file, v: 0 })));
    },
    stage: () => {
      let game: unknown = null;
      try { game = JSON.parse(files.get(GAME)?.model.getValue() ?? '{}'); } catch { /* keep the default size */ }
      return stageSize(game);
    },
  });
}

function setupBuildAndGit() {
  const saveAll = async () => { await saveAllNow(); };
  S.buildDialog = new BuildDialog(document.body, {
    reveal: goToLine,
    openTranslations: () => void S.translations.open(() => S.editor.focus()),
    openVoice: () => void S.voiceDialog.open(() => S.editor.focus()),
    saveAll,
    build: (target, out, langs, playtest) => runTask('build', 'build', `&target=${target}&out=${encodeURIComponent(out)}${langQuery(langs)}${playtestQuery(playtest)}`),
    portable: 'vnStudio' in window, // studio/preload.cjs
  });
  S.gitPanel = new GitPanel($('sbGit'), document.body, { saveAll, done: setStatus });
  if (S.caps.git) void S.gitPanel.refresh();
}

function setupTranslations() {
  S.translations = new TranslationsDialog(document.body, {
    rows: () => { recompile(); return stringRows(S.program); },
    reveal: goToLine,
    missingIds: missingIdCount,
    addIds: addIdsEverywhere,
    source: () => sourceLanguage(openGame() as { language?: unknown } | null),
    labels: () => {
      const l = (openGame() as { labels?: unknown } | null)?.labels;
      return l && typeof l === 'object' ? Object.fromEntries(Object.entries(l).filter(([, v]) => typeof v === 'string')) as Record<string, string> : {};
    },
  });
}

/** Ctrl+P, F1 and Alt+1/2/3 work wherever focus is, the preview included. */
function setupGlobalKeys() {
  // Ctrl+P, F1 and Alt+1/2/3 work wherever focus is (capture phase beats Monaco and the browser's print shortcut),
  // including inside the preview, which is same-origin. Ctrl+P is the palette (type > for commands); F1 is help;
  // Alt+1/2/3 focus the editor, the preview and the Files panel.
  const panes = { Digit1: 'editor', Digit2: 'preview', Digit3: 'files' } as const;
  const onKey = (e: KeyboardEvent) => {
    const pane = e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey ? panes[e.code as keyof typeof panes] : undefined;
    if (pane && !(S.palette.isOpen || S.help.isOpen || S.assetViewer.isOpen || S.animStudio.isOpen || S.translations.isOpen || S.voiceDialog.isOpen || S.buildDialog.isOpen || S.themeDialog.isOpen || S.gitPanel.isOpen)) {
      e.preventDefault();
      e.stopPropagation();
      focusPane(pane);
      return;
    }
    const ctrlP = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'p';
    const f1 = e.key === 'F1' && !e.ctrlKey && !e.altKey && !e.metaKey;
    if (!(ctrlP || f1)) return;
    if (f1) { e.preventDefault(); e.stopPropagation(); if (!S.palette.isOpen) toggleHelp(); return; }
    if (S.palette.isOpen || S.help.isOpen || S.assetViewer.isOpen || S.animStudio.isOpen || S.translations.isOpen || S.voiceDialog.isOpen || S.buildDialog.isOpen || S.themeDialog.isOpen || S.gitPanel.isOpen) return;
    e.preventDefault();
    e.stopPropagation();
    S.palette.open('');
  };
  window.addEventListener('keydown', onKey, true);
  const hookPreview = () => preview.contentWindow?.addEventListener('keydown', onKey, true);
  preview.addEventListener('load', hookPreview);
  if (preview.contentDocument?.readyState === 'complete') hookPreview();
}

// ---- boot ----
async function boot() {
  initPreviewLink({ activate, goToLine, save });
  initSidebar({
    showStock, activate, closeTab, recompile, save, previewScreen, previewFromCursor, newFile, newFolder, syncFromDisk,
    openRig, openTheme, openThemeSheet, openAnimStudio, runTask, applyEdits,
  });
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
  createEditor();
  try { S.caps = readCapabilities(await (await fetch('/api/capabilities')).json()); } catch { /* an older dev server: it can do everything */ }
  setupPalette();
  await loadProject();
  wireToolbar();
  watchDisk();
}

/** The Monaco instance and the find-in-project dialog. */
function createEditor() {
  S.editor = monaco.editor.create($('editor'), {
    theme: 'vn-dark', language: 'vn', model: null, automaticLayout: true, minimap: { enabled: false },
    fontSize: 15, lineHeight: 24, wordWrap: 'on', scrollBeyondLastLine: false, renderWhitespace: 'none',
    tabSize: 2, insertSpaces: true, quickSuggestions: { other: true, comments: false, strings: false },
    padding: { top: 10 },
  });
  S.decorations = S.editor.createDecorationsCollection([]);

  S.findDialog = new FindDialog({
    files: projectFiles, apply: applyEdits,
    reveal: m => {
      goToLine(m.file, m.line);
      S.editor.setSelection({ startLineNumber: m.line, startColumn: m.col + 1, endLineNumber: m.line, endColumn: m.col + 1 + m.length });
    },
  });
}

/** The project's scripts, game.json and assets as tabs, the first one open. */
async function loadProject() {
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
  setStatus(S.caps.online ? 'ready (online demo: the project is kept in this browser; Ctrl+P > Online to download it as a zip)' : 'ready');
}

/** The sidebar, the toolbar buttons and the splitter. */
function wireToolbar() {
  let sidebarShown = true;
  try { sidebarShown = localStorage.getItem(SIDEBAR_KEY) !== '0'; } catch { /* default: shown */ }
  setSidebar(sidebarShown);
  sbFilter.addEventListener('input', () => { renderSidebarFiles(); renderSidebarAssets(); });
  $('filesBtn').addEventListener('click', () => setSidebar(sidebarEl.hidden));
  $('playHere').addEventListener('click', () => void previewFromCursor());
  $('commands').addEventListener('click', () => S.palette.open('>'));
  $('helpBtn').addEventListener('click', toggleHelp);
  $('outlineBtn').addEventListener('click', toggleOutline);
  $('translateBtn').addEventListener('click', () => void S.translations.open(() => S.editor.focus()));
  $('buildBtn').addEventListener('click', () => void S.buildDialog.open(() => S.editor.focus()));
  $('buildBtn').hidden = !S.caps.tasks.includes('build');
  $('projectsBtn').hidden = !S.caps.online;
  $('projectsBtn').addEventListener('click', () => void backToProjects());
  $('voiceBtn').addEventListener('click', () => void S.voiceDialog.open(() => S.editor.focus()));
  $('taskOutputClose').addEventListener('click', () => { outputEl.hidden = true; });
  problemsEl.addEventListener('click', nextProblem);
  setupSplitter();
}

/** Files changed on disk (an art edit, a git checkout) reach the editor. */
function watchDisk() {
  const events = new EventSource('/__events');
  events.onmessage = e => {
    if (!['content', 'masters'].includes((JSON.parse(e.data) as { type: string }).type)) return;
    void syncFromDisk();
    if (S.caps.git) S.gitPanel.refreshSoon();
  };
}

void boot();
