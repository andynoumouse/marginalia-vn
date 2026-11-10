// The command list (Ctrl+P, ">") and the palette's modes: files, commands, labels, lines, assets and the name pickers.
// editor.ts owns the tabs and dialogs and hands over what these call back into (CommandHost), as sidebar.ts does.

import { DEVICES, setPreviewDevice } from './preview-device.js';
import { previewVisible, showPreviewPane, togglePreviewPane } from './preview-pane.js';
import { planMove, describeTrashEntry } from '../engine/src/index.js';
import { confirmAsk } from './ask.js';
import { rank, type PaletteItem, type PaletteMode } from './palette.js';
import { openFind } from './rename.js';
import { emptyTrash, movePath, newAssetFolder, openAsset, openTrash, RENAME, restoreTrash, setSidebar, sidebarEl, toast, TRASH_PICK } from './sidebar.js';
import { $, errorCount, files, GAME, NEW_ASSET_FOLDER, norm, postPreview, recentFiles, rigName, S, scripts, setStatus, THEME_PICK, themeFileName, themeSheetName } from './state.js';

declare const monaco: any;

export const THEME_CSS_PICK = '#themecss:';
export const RIG_PICK = '#rig:', ANIM_PICK = '#anim:'; // palette prefixes of the character pickers
export const NEW_PICK = '#new:'; // palette prefix of the New Script File name field
export const NEW_FOLDER = '#folder:'; // palette prefix of the New Folder name field
const RECENT_COMMANDS = 'vn.editor.recentCommands';

const previewFrame = () => $<HTMLIFrameElement>('preview');
const isScript = () => files.get(S.active)?.kind === 'script';

/** What the commands and palette modes call back into; editor.ts implements it. */
export interface CommandHost {
  activate(name: string): void;
  goToLine(name: string, line: number, col?: number): void;
  closeTab(name: string): void;
  closeStock(): void;
  saveFile(f: import('./state.js').FileState | undefined): void;
  saveAllNow(): Promise<unknown>;
  backToProjects(): Promise<void>;
  newFile(given?: string, starter?: string, dir?: string): Promise<void>;
  newFolder(given?: string, parent?: string): Promise<void>;
  newFileBase(raw: string): string | null;
  openRig(char: string): void;
  openTheme(theme: string): void;
  openThemeSheet(theme: string): void;
  openAnimStudio(char?: string): void;
  openAnimationAtCursor(): void;
  updateRigFromArt(): void;
  addIds(): void;
  addIdsEverywhere(): number;
  runPlaytest(): void;
  showStats(): void;
  runTask(name: string, label: string): Promise<unknown>;
  toggleOutline(): void;
  toggleHelp(): void;
  toggleFollow(): void;
  toggleVars(): void;
  previewFromCursor(): Promise<void>;
  nextProblem(): void;
  prevProblem(): void;
  focusPane(pane: 'editor' | 'preview' | 'files'): void;
  /** Ctrl+M: makes Tab leave the code editor, or indent again; returns whether Tab now leaves. */
  toggleTabLeaves(): boolean;
}

// To add a command: add an entry to the list in buildCommands(). `key` binds it in the code editor and shows
// in the palette; `when` hides it where it does not apply.
export interface Command {
  title: string;
  key?: { code: number; label: string };
  when?: () => boolean;
  run(): void | Promise<void>;
}

export function buildCommands(h: CommandHost): Command[] {
  const K = monaco.KeyMod, C = monaco.KeyCode;
  return [
    { title: 'Go to File', key: { code: K.CtrlCmd | C.KeyP, label: 'Ctrl+P' }, run: () => S.palette.setText('') },
    { title: 'Go to Label', run: () => S.palette.setText('@') },
    { title: 'Go to Line', run: () => S.palette.setText(':') },
    { title: 'Rename Label or Variable (F2 on a name)', run: () => S.editor.getAction('editor.action.rename')?.run() },
    { title: 'Find and Replace in All Files', key: { code: K.CtrlCmd | K.Shift | C.KeyF, label: 'Ctrl+Shift+F' }, run: openFind },
    { title: 'Story: Show Outline (label flowchart)', run: h.toggleOutline },
    { title: 'Story: Playtest All Routes (unreachable lines, endings, unused assets and variables)', run: h.runPlaytest },
    { title: 'Story: Script Statistics (words, lines and reading time per script, label and character)', run: h.showStats },
    { title: 'Help: Command Reference (for the statement at the cursor)', key: { code: C.F1, label: 'F1' }, run: h.toggleHelp },
    { title: 'Preview from Cursor', key: { code: K.CtrlCmd | C.Enter, label: 'Ctrl+Enter' }, run: () => h.previewFromCursor() },
    { title: 'Preview: Splash (game.json splash cards)', run: () => { showPreviewPane(); postPreview({ type: 'splash' }); } },
    { title: 'Preview: Intro (game.json intro label)', run: () => { showPreviewPane(); postPreview({ type: 'intro' }); } },
    { title: 'Preview: New Game', run: () => { showPreviewPane(); postPreview({ type: 'restart' }); } },
    { title: 'Preview: Reload', run: () => previewFrame().contentWindow?.location.reload() },
    { title: 'Preview: Toggle Follow', run: () => h.toggleFollow() },
    { title: 'Preview: Show or Hide Variables', run: () => h.toggleVars() },
    { title: 'Preview: Show or Hide Pane', run: () => { togglePreviewPane(); setStatus(previewVisible() ? 'preview shown' : 'preview hidden'); } },
    { title: 'Preview: Reset Player Data (saves, settings, unlocks, read text)', run: async () => {
      if (!await confirmAsk('Delete all saves, settings, unlocks and read-text records of the preview in this browser?', 'Delete')) return;
      for (const k of Object.keys(localStorage)) if (k.startsWith('vn.') && !k.startsWith('vn.editor.')) localStorage.removeItem(k);
      previewFrame().contentWindow?.location.reload();
      setStatus('player data reset');
    } },
    { title: 'Add Localization IDs to This File', when: isScript, run: h.addIds },
    { title: 'Add Localization IDs to All Files', run: h.addIdsEverywhere },
    { title: 'New Script File', run: () => h.newFile() },
    { title: 'New Script Folder', run: () => h.newFolder() },
    { title: 'Files: Restore from Trash', run: () => void openTrash() },
    { title: 'Files: Empty Trash for good (no undo)', run: () => void emptyTrash() },
    { title: 'View: Show or Hide Files Panel', key: { code: K.CtrlCmd | C.KeyB, label: 'Ctrl+B' }, run: () => setSidebar(sidebarEl.hidden) },
    ...DEVICES.map(d => ({ title: `Preview: ${d.label}`, run: () => { showPreviewPane(); setPreviewDevice(d.name); } })),
    { title: 'Focus: Editor', key: { code: K.Alt | C.Digit1, label: 'Alt+1' }, run: () => h.focusPane('editor') },
    { title: 'Focus: Preview (play with the keyboard)', key: { code: K.Alt | C.Digit2, label: 'Alt+2' }, run: () => h.focusPane('preview') },
    { title: 'Focus: Files Panel (filter box)', key: { code: K.Alt | C.Digit3, label: 'Alt+3' }, run: () => h.focusPane('files') },
    { title: 'Editor: Make Tab Leave the Editor, or Indent Again', key: { code: K.CtrlCmd | C.KeyM, label: 'Ctrl+M' }, run: () => {
      const on = h.toggleTabLeaves();
      S.editor.focus();
      toast(on ? 'Tab now moves on to the next control. Ctrl+M makes it indent again.' : 'Tab indents again.');
    } },
    { title: 'Close Tab', key: { code: K.Alt | C.KeyW, label: 'Alt+W' }, when: () => S.active !== '' || !!S.stock, run: () => (S.stock ? h.closeStock() : h.closeTab(S.active)) },
    { title: 'Save', key: { code: K.CtrlCmd | C.KeyS, label: 'Ctrl+S' }, run: () => h.saveFile(files.get(S.active)) },
    { title: 'Save All', run: () => { for (const f of files.values()) h.saveFile(f); } },
    { title: 'Open game.json (title screen, menus, theme)', when: () => S.active !== GAME, run: () => h.activate(GAME) },
    { title: 'Theme: Panel (palette and components)', run: () => S.themeDialog.open(files.get(S.active)?.kind === 'theme' ? files.get(S.active)!.char! : null, () => S.editor.focus()) },
    { title: 'Theme: Open or Create a Theme File (themes/<name>.json)', run: () => S.palette.setText(THEME_PICK) },
    { title: 'Theme: Open or Create a Theme Stylesheet (themes/<name>.css)', run: () => S.palette.setText(THEME_CSS_PICK) },
    { title: 'Character: Edit Rig (z-order, bones, looks)', run: () => S.palette.setText(RIG_PICK) },
    { title: 'Character: Update Rig from Reconverted Art', when: () => files.get(S.active)?.kind === 'rig', run: h.updateRigFromArt },
    { title: 'Character: Animation Studio (play and inspect animations)', run: () => {
      if (files.get(S.active)?.kind === 'rig') h.openAnimStudio(); else S.palette.setText(ANIM_PICK); // no rig tab: pick a character first
    } },
    { title: 'Animation: Open the Animation on This Line in the Studio', key: { code: C.F12, label: 'F12' }, when: () => files.get(S.active)?.kind === 'script', run: h.openAnimationAtCursor },
    { title: 'Next Problem', key: { code: C.F8, label: 'F8' }, run: h.nextProblem },
    { title: 'Previous Problem', key: { code: K.Shift | C.F8, label: 'Shift+F8' }, run: h.prevProblem },
    { title: 'Toggle Word Wrap', key: { code: K.Alt | C.KeyZ, label: 'Alt+Z' }, run: () => {
      S.editor.updateOptions({ wordWrap: S.editor.getOption(monaco.editor.EditorOption.wordWrap) === 'on' ? 'off' : 'on' });
    } },
    { title: 'Toggle Minimap', run: () => S.editor.updateOptions({ minimap: { enabled: !S.editor.getOption(monaco.editor.EditorOption.minimap).enabled } }) },
    { title: 'Build: Checks and Export (web or desktop)', when: () => S.caps.tasks.includes('build'), run: () => void S.buildDialog.open(() => S.editor.focus()) },
    { title: 'Git: Commit All Changes (review, then stage and commit the project folder)', when: () => S.caps.git, run: () => void S.gitPanel.open(() => S.editor.focus()) },
    { title: 'Export Web Build (build/web)', when: () => S.caps.tasks.includes('export'), run: () => h.runTask('export', 'export') },
    { title: 'Open Exported Game', when: () => S.caps.tasks.includes('export'), run: () => { window.open('../build/web/', '_blank', 'noopener'); } },
    { title: 'Export Strings (locale/<source language>.json, report untranslated)', when: () => S.caps.tasks.includes('strings'), run: () => h.runTask('strings', 'strings') },
    { title: 'Translations: Edit Side by Side (and export CSV for translators)', run: () => void S.translations.open(() => S.editor.focus()) },
    { title: 'Voice: Recordings per Line (drop audio files, find outdated takes)', run: () => void S.voiceDialog.open(() => S.editor.focus()) },
    { title: 'Reconvert All Art (masters/ to assets/)', when: () => S.caps.tasks.includes('art'), run: () => h.runTask('art', 'art') },
    // The online demo keeps the project in this browser (online/sw.ts): a zip is the way to keep it or move it to the desktop tools.
    { title: 'Online: Download Project as .zip', when: () => S.caps.online, run: async () => { await h.saveAllNow(); location.assign('../project.zip'); } },
    { title: 'Online: Back to the Project List', when: () => S.caps.online, run: h.backToProjects },
  ];
}

/** The palette's modes, name pickers first (their prefixes start with '#'), and `ran` to record a command as recently used. */
export function paletteModes(h: CommandHost, commands: Command[]): PaletteMode[] {
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
      const order = (name: string) => (name === S.active ? 1e6 : recentFiles.includes(name) ? recentFiles.indexOf(name) : 1e5);
      const all = [...files.values()].sort((a, b) => order(a.name) - order(b.name));
      const items: PaletteItem[] = rank(all, q, f => f.name).map(({ entry: f, hits }) => ({
        label: f.name, hits,
        hint: [norm(f.model.getValue()) !== norm(f.saved) ? '•' : '', errorsIn(f) ? `${errorsIn(f)} error${errorsIn(f) > 1 ? 's' : ''}` : '',
          f.name === S.active ? 'current' : ''].filter(Boolean).join('  '),
        run: () => h.activate(f.name),
      }));
      // Plain "studio" (or a rigged character's name) reaches the animation studio from here too (UX round ES-2).
      const word = q.trim().toLowerCase();
      if (word) {
        const chars = Object.keys(S.projectAssets.rigs).sort();
        if (/^(studio|anim|model|rig)/.test(word)) for (const c of chars) items.push({ label: `Animation studio: ${c}`, detail: 'character', run: () => h.openAnimStudio(c) });
        else for (const { entry: c, hits } of rank(chars, q, c => c)) items.push({ label: c, hits, detail: 'Animation studio', run: () => h.openAnimStudio(c) });
      }
      const base = h.newFileBase(q);
      if (base && !files.has(`${base}.vn`) && !files.has(q.trim())) {
        items.push({ label: `Create ${base}.vn`, className: 'create', run: () => void h.newFile(base) });
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
      const editorActions: PaletteItem[] = (S.editor.getSupportedActions() as any[])
        .filter(a => q.trim() && a.id !== 'editor.action.quickCommand' && a.label)
        .sort((a, b) => a.label.localeCompare(b.label))
        .map(a => ({ label: a.label, detail: 'editor', run: () => { S.editor.focus(); void a.run(); } }));
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
        label: l.name, hits, detail: `${l.file}:${l.line}`, run: () => h.goToLine(l.file, l.line),
      }));
    },
  };

  const lineMode: PaletteMode = {
    prefix: ':', title: 'Go to line', placeholder: 'Go to line number',
    items: q => {
      const count = S.editor.getModel()?.getLineCount() ?? 0;
      const n = Number(q);
      if (!q || !Number.isInteger(n) || n < 1) return [{ label: `Type a line number (1-${count})`, className: 'empty', run: () => {} }];
      const line = Math.min(n, count);
      return [{ label: `Go to line ${line}`, detail: S.active, run: () => h.goToLine(S.active, line) }];
    },
  };

  // Assets: a character with art opens its rig.json; anything else opens in a browser tab (images, audio).
  const assetMode: PaletteMode = {
    prefix: '#', title: 'Go to asset', placeholder: 'Assets (characters open their rig.json, others open in a viewer)',
    items: q => {
      const chars = Object.keys(S.projectAssets.rigs).sort();
      const entries: PaletteItem[] = [
        ...chars.map(c => ({
          label: `char/${c}`, detail: files.has(rigName(c)) ? 'rig.json (open)' : c in S.projectAssets.rigTexts ? 'rig.json' : 'rig.json (new)',
          run: () => h.openRig(c),
        })),
        ...S.projectAssets.files
          .filter(file => !chars.some(c => file.startsWith(`char/${c}/`)) && !file.endsWith('.gitkeep'))
          .map(file => ({
            label: file, detail: file.split('/')[0],
            run: () => openAsset(file, S.projectAssets.files.filter(x => x.split('/')[0] === file.split('/')[0])),
          })),
      ];
      return rank(entries, q, e => e.label).map(({ entry, hits }) => ({ ...entry, hits }));
    },
  };

  // Character pickers for the Edit Rig and Animation Studio commands: characters only, so Enter never opens an image.
  const charMode = (prefix: string, title: string, run: (char: string) => void): PaletteMode => ({
    prefix, title, placeholder: `${title}: pick a character`,
    items: q => rank(Object.keys(S.projectAssets.rigs).sort(), q, c => c).map(({ entry: c, hits }) => ({ label: c, hits, detail: title, run: () => run(c) })),
  });
  const pickers = [charMode(RIG_PICK, 'Edit rig', h.openRig), charMode(ANIM_PICK, 'Animation studio', c => h.openAnimStudio(c))];
  const themeMode: PaletteMode = {
    prefix: THEME_PICK, title: 'Theme file', placeholder: 'Theme name (themes/<name>.json): pick one, or type a new name and press Enter',
    items: q => {
      const names = new Set([...Object.keys(S.themeTexts), ...[...files.values()].filter(f => f.kind === 'theme').map(f => f.char!)]);
      const found = rank([...names].sort(), q, n => n).map(({ entry: n, hits }): PaletteItem => ({ label: n, hits, detail: files.has(themeFileName(n)) ? 'theme (open)' : 'theme', run: () => h.openTheme(n) }));
      const name = q.trim();
      if (name && !names.has(name)) found.push(/^[\w-]+$/.test(name) ? { label: `Create themes/${name}.json`, className: 'create', run: () => h.openTheme(name) } : { label: 'Not a valid theme name', detail: 'letters, digits, _ and -', className: 'empty', run: () => {} });
      return found.length ? found : [{ label: 'Type a name for the new theme', className: 'empty', run: () => {} }];
    },
  };
  const themeCssMode: PaletteMode = {
    prefix: THEME_CSS_PICK, title: 'Theme stylesheet', placeholder: 'Theme name (themes/<name>.css): pick one, or type a new name and press Enter',
    items: q => {
      const names = new Set([...Object.keys(S.themeTexts), ...Object.keys(S.themeSheets), ...[...files.values()].filter(f => f.kind === 'theme' || f.kind === 'themecss').map(f => f.char!)]);
      const found = rank([...names].sort(), q, n => n).map(({ entry: n, hits }): PaletteItem => ({ label: n, hits, detail: files.has(themeSheetName(n)) ? 'stylesheet (open)' : n in S.themeSheets ? 'stylesheet' : 'new stylesheet', run: () => h.openThemeSheet(n) }));
      const name = q.trim();
      if (name && !names.has(name)) found.push(/^[\w-]+$/.test(name) ? { label: `Create themes/${name}.css`, className: 'create', run: () => h.openThemeSheet(name) } : { label: 'Not a valid theme name', detail: 'letters, digits, _ and -', className: 'empty', run: () => {} });
      return found.length ? found : [{ label: 'Type a name for the new stylesheet', className: 'empty', run: () => {} }];
    },
  };
  const newMode: PaletteMode = {
    prefix: NEW_PICK, title: 'New script file', placeholder: 'New script file name (e.g. chapter2), Enter creates it',
    items: q => {
      if (!q.trim()) return [{ label: 'Type a name for the new file', detail: 'folders with /, .vn is added', className: 'empty', run: () => {} }];
      const base = h.newFileBase(q);
      if (!base) return [{ label: 'Not a valid file name', detail: 'letters, digits, _ - . and / for folders', className: 'empty', run: () => {} }];
      if (files.has(`${base}.vn`)) return [{ label: `${base}.vn`, detail: 'exists: open it', run: () => h.activate(`${base}.vn`) }];
      return [{ label: `Create ${base}.vn`, className: 'create', run: () => void h.newFile(base) }];
    },
  };
  const newFolderMode: PaletteMode = {
    prefix: NEW_FOLDER, title: 'New folder', placeholder: 'New folder name under script/ (e.g. chapter2), Enter creates it',
    items: q => {
      if (!q.trim()) return [{ label: 'Type a name for the new folder', detail: 'nested with /', className: 'empty', run: () => {} }];
      const dir = q.trim().replace(/\/+$/, '');
      if (!/^[\w\-./]+$/.test(dir) || dir.includes('..')) return [{ label: 'Not a valid folder name', detail: 'letters, digits, _ - . and / for nesting', className: 'empty', run: () => {} }];
      if (S.scriptDirs.includes(dir)) return [{ label: `${dir}/`, detail: 'exists', className: 'empty', run: () => {} }];
      return [{ label: `Create folder ${dir}/`, className: 'create', run: () => void h.newFolder(dir) }];
    },
  };
  const newAssetFolderMode: PaletteMode = {
    prefix: NEW_ASSET_FOLDER, title: 'New asset folder', placeholder: 'New folder name under assets/ (e.g. sfx), Enter creates it',
    items: q => {
      const dir = q.trim().replace(/\/+$/, '');
      if (!dir) return [{ label: 'Type a name for the new folder', detail: 'one level: assets/<name>/', className: 'empty', run: () => {} }];
      if (!/^[\w\-]+$/.test(dir)) return [{ label: 'Not a valid folder name', detail: 'letters, digits, _ and -', className: 'empty', run: () => {} }];
      if (S.projectAssets.dirs.includes(dir)) return [{ label: `assets/${dir}/`, detail: 'exists', className: 'empty', run: () => {} }];
      return [{ label: `Create folder assets/${dir}/`, className: 'create', run: () => void newAssetFolder(dir) }];
    },
  };
  const renameMode: PaletteMode = {
    prefix: RENAME, title: 'Rename or move', placeholder: 'New path (another folder moves it), Enter renames',
    items: q => {
      if (!S.renaming) return [{ label: 'Pick a file or folder in the Files panel first', detail: 'right-click, Rename, or F2', className: 'empty', run: () => {} }];
      const { from, isDir } = S.renaming;
      const plan = planMove(from, q, isDir);
      if ('error' in plan) return [{ label: plan.error === 'same name' ? `Type a new name for ${from}` : plan.error, className: 'empty', run: () => {} }];
      return [{ label: `Rename to ${plan.to}`, detail: `from ${from}`, className: 'create', run: () => void movePath(from, plan.to, isDir) }];
    },
  };
  const trashMode: PaletteMode = {
    prefix: TRASH_PICK, title: 'Restore from trash', placeholder: 'Pick what to put back (filter by path)',
    items: q => {
      if (!S.trashEntries.length) return [{ label: 'The project trash is empty', className: 'empty', run: () => {} }];
      const now = Date.now();
      return rank(S.trashEntries, q, e => e.paths.join(' ')).map(({ entry: e, hits }) => ({
        ...describeTrashEntry(e, now), hits, run: () => void restoreTrash(e.id),
      }));
    },
  };
  pickers.push(themeMode, themeCssMode, newMode,newFolderMode, newAssetFolderMode, renameMode, trashMode);

  const modes = [fileMode, commandMode, labelMode, lineMode, assetMode];
  const helpMode: PaletteMode = {
    prefix: '?', title: 'Help', placeholder: 'Pick a mode',
    items: () => modes.map(m => ({ label: `${m.prefix || '(nothing)'}  ${m.title}`, run: () => S.palette.setText(m.prefix) })),
  };
  return [...pickers, ...modes, helpMode];
}
