// State shared by the editor's parts (editor.ts and the modules split out of it): the open files, the project's
// assets and the dialogs. Parts read and write it as `S.<name>`; a field set at boot is typed for its use afterwards.

import { compile, FULL_CAPABILITIES, type Capabilities, type Program, type ProjectFile, type RigManifest, type TrashEntry, type UiScreen } from '../engine/src/index.js';
import type { AnimStudio } from './anim-studio.js';
import type { AssetViewer } from './asset-viewer.js';
import type { BuildDialog } from './build-dialog.js';
import type { FindDialog } from './find-dialog.js';
import type { GitPanel } from './git-dialog.js';
import type { HelpDialog } from './help-dialog.js';
import type { OutlineView } from './outline-view.js';
import type { Palette } from './palette.js';
import type { ThemeDialog } from './theme-dialog.js';
import type { TranslationsDialog } from './translations-dialog.js';
import type { VoiceDialog } from './voice-dialog.js';

export const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export const NOT_IN_DEMO = 'needs the local dev server (not available in the online demo)';
export const GAME = 'game.json';
export const GAME_URI = 'file:///game.json';
export const themeFileName = (theme: string) => `themes/${theme}.json`;
export const themeSheetName = (theme: string) => `themes/${theme}.css`;
export const rigName = (char: string) => `char/${char}/rig.json`;
export const norm = (s: string) => s.replace(/\r\n/g, '\n');

// kind 'rig' is a character's assets/char/<char>/rig.json (tab name char/<char>/rig.json)
export interface FileState {
  name: string; kind: 'script' | 'game' | 'rig' | 'theme' | 'themecss'; char?: string; model: any; saved: string; timer: number;
  /** Why the last save failed, until one goes through; `tries` counts the failures and `retry` is the timer of the next attempt. */
  failed?: string; tries?: number; retry?: number;
}
/** The open files by tab name. */
export const files = new Map<string, FileState>();

/** The project's files as the server lists them. */
export interface ProjectAssets { files: string[]; rigs: Record<string, RigManifest>; rigTexts: Record<string, string>; masters: { master: string; output: string | null }[]; dirs: string[] }

interface EditorState {
  /** What the server can do (`/api/capabilities`): the online demo has no git, file manager or node tools. Read at boot. */
  caps: Capabilities;
  assetNames: { bg: string[]; music: string[]; ui: string[]; fonts: string[]; sound: string[] };
  /** The tab name of the file on screen. */
  active: string;
  /** The compiled scripts. */
  program: Program;
  /** The Monaco editor, set at boot. */
  editor: any;
  decorations: any;
  previewPos: { file: string; line: number } | null;
  /** The built-in screen shown read-only in place of a file, if any. */
  stock: UiScreen | null;
  projectAssets: ProjectAssets;
  /** Folders under script/, empty ones included. */
  scriptDirs: string[];
  /** The file or folder being renamed in the palette. */
  renaming: { from: string; isDir: boolean } | null;
  trashEntries: TrashEntry[];
  /** Raw themes/<name>.json text by theme name, as of the last project load. */
  themeTexts: Record<string, string>;
  /** Raw themes/<name>.css text by theme name, as of the last project load. */
  themeSheets: Record<string, string>;
  // Set at boot:
  assetViewer: AssetViewer;
  palette: Palette;
  help: HelpDialog;
  outlineView: OutlineView;
  translations: TranslationsDialog;
  voiceDialog: VoiceDialog;
  buildDialog: BuildDialog;
  themeDialog: ThemeDialog;
  gitPanel: GitPanel;
  animStudio: AnimStudio;
  findDialog: FindDialog;
}

const later = undefined as never; // fields that boot() fills in before anything reads them

export const S: EditorState = {
  caps: FULL_CAPABILITIES,
  assetNames: { bg: [], music: [], ui: [], fonts: [], sound: [] },
  active: '',
  program: compile([]),
  editor: undefined,
  decorations: undefined,
  previewPos: null,
  stock: null,
  projectAssets: { files: [], rigs: {}, rigTexts: {}, masters: [], dirs: [] },
  scriptDirs: [],
  renaming: null,
  trashEntries: [],
  themeTexts: {},
  themeSheets: {},
  assetViewer: later,
  palette: later,
  help: later,
  outlineView: later,
  translations: later,
  voiceDialog: later,
  buildDialog: later,
  themeDialog: later,
  gitPanel: later,
  animStudio: later,
  findDialog: later,
};

declare const monaco: any;

export const setStatus = (s: string) => { $('status').textContent = s; };
/** Send a message to the preview iframe. */
export const postPreview = (msg: object) => $<HTMLIFrameElement>('preview').contentWindow?.postMessage(msg, location.origin);

// Closing a tab only hides it: the file stays loaded (scripts compile together, rig edits keep counting).
export const openTabs: string[] = [];
export const recentFiles: string[] = []; // most recently activated first (Ctrl+P ordering)
export const scripts = () => [...files.values()].filter(f => f.kind === 'script');
/** The files whose text the engine checks together (everything but rig.json). */
export const projectFiles = (): ProjectFile[] => [...files.values()].filter(f => f.kind !== 'rig').map(f => ({ name: f.name, text: f.model.getValue() }));

export const errorCount = (f: FileState) => (f.kind !== 'script'
  ? monaco.editor.getModelMarkers({ resource: f.model.uri }).filter((m: any) => m.severity === monaco.MarkerSeverity.Error).length
  : S.program.diagnostics.filter(d => d.file === f.name && d.severity === 'error').length);
/** Errors and warnings Monaco holds for a file (script diagnostics are published as markers too). */
export function problemCounts(f: FileState) {
  const marks = monaco.editor.getModelMarkers({ resource: f.model.uri }) as { severity: number }[];
  const errors = marks.filter(m => m.severity >= monaco.MarkerSeverity.Error).length;
  return { errors, warns: marks.filter(m => m.severity >= monaco.MarkerSeverity.Warning).length - errors };
}
export const isDirty = (f: FileState) => norm(f.model.getValue()) !== norm(f.saved);

// Palette prefixes of the fields that ask for a new name.
export const THEME_PICK = '#theme:';
export const NEW_ASSET_FOLDER = '#assetfolder:'; // the same for a folder under assets/
