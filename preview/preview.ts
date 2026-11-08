// Live preview and game shell: title screen, quick menu, rollback, saves, options and pause menu around the
// engine runtime. The world is drawn with PixiJS (WebGL); text and menus are HTML over it.
// Inside the editor (an iframe) the title screen is skipped so edits show at once.
// The same page is the exported game (tools/export-web.mjs sets <html data-mode="game">): no dev bar,
// project data from project.json instead of the dev server, no live reload.

import { initDebug } from './debug.js';
import { attachPreloads, quickMenuSettings, crashReport, sceneAt, memoryBudget, sourceLanguage, voiceLanguages, resolveVoiceLanguage, residencyReport, captionTable, scriptsVersion, unpackProgram, type ProgramFile, type Program, checkAssets, checkGame, achievementItems, achievementProblems, achievementToastSettings, achievementToToast, speakerFocusSettings, sideImageSettings, normalizeAchievements, compile, Locale, musicItems, namedAnchors, namedPositions, normalizeSplash, Runtime, stageSize, titleFade, fitScale, stageInsets, needsRotate, touchSettings, barBoost, boostOrigin, resolveTouch, textFloor, TOUCH_MIN_CSS, classifyStroke, stillForLongPress, LONG_PRESS_MS, type Diagnostic, type MusicItem, type DisplayState, type RigManifest, type Src } from '../engine/src/index.js';
import { AchievementQueue } from './achievement-queue.js';
import { SaveCapture } from './save-capture.js';
import { QuickActions } from './quick-actions.js';
import { ScreenWake } from './wake-lock.js';
import { chapterList as chapterListOf, chapterDiagnostics } from './chapters.js';
import { initScreenSync } from './screen-sync.js';
import { Menus, type AchievementRow, type GalleryItem, type TitleConfig } from './menus.js';
import { PixiRenderer } from './pixi-renderer.js';
import { playSplash } from './splash.js';
import { isOutdatedSave, newestSave, normalizeSaveVersion, PersistentSet, PersistentValues, readSave, SeenLines, setChoiceSlots, writeSave,  type SaveData } from './saves.js';
import { adjustFocused, autoFocus, moveFocus, watchGamepad, type Action } from './input.js';
import { loadSettings, saveSettings } from './settings.js';
import type { Voice } from './blips.js';
import { $, H, notePadConfirm, sleep, stage, W, type AssetFile, type LineInfo } from './stage-ui.js';
import { setStageSize } from './stage-size.js';
import { gameId, setGameId } from './storage.js';
import { themeCss, type Theme } from '../engine/src/index.js';
import { Studio } from './studio.js';
import { Timeline } from './timeline.js';

/** The quick menu bar (game.json "quickMenu"). */
interface QuickConfig {
  items?: string[];
  position?: 'bottom' | 'top';
  align?: 'left' | 'center' | 'right';
}
/** game.json at the project root (editable in the editor, which also has its JSON schema). */
interface GameConfig {
  id?: string;
  title?: string;
  /** Themes the player may pick in Options, and their resolved looks by name (made by projectFromListing). */
  themes?: string[];
  themeLooks?: Record<string, Theme>;
  /** The language the scripts are written in (default "en"): the text language that needs no locale/<lang>.json. */
  language?: string;
  /** How many rotating choice autosaves to keep (1-20, default 5). */
  choiceSaves?: number;
  /** Raise it when a release breaks old saves: loading an older save then asks first. */
  saveVersion?: number;
  /** The player names a save when making it in a numbered slot (and can rename it); off by default. */
  saveNames?: boolean;
  /** Memory budget for loaded images and audio in MB (default 512, 256 on low-memory devices); the debug console's `memory` reports against it. */
  memoryBudgetMB?: number;
  titleScreen?: TitleConfig;
  /** Logo cards shown once before the title screen: image names, or { image, text, duration, fade }. */
  splash?: unknown;
  /** A script label played once at start, before the title screen (a cutscene; it must finish with `end`). */
  intro?: string;
  quickMenu?: QuickConfig;
  labels?: Record<string, string>;
  theme?: Theme;
  blips?: Record<string, Voice>;
  /** Touch screens: `gestures: false` turns the swipes and the long press off for the game. */
  touch?: unknown;
  /** Gallery entries: an image (background name) unlocked once shown, or by `unlock <flag>`. */
  gallery?: { image: string; title?: string; unlock?: string }[];
  /** Music room tracks (strings or { track, title, unlock }): unlocked once heard while playing, or by `unlock <flag>`. */
  musicRoom?: unknown;
  /** Chapter select entries (strings or { label, title, unlock }): unlocked once the story reaches the label. */
  chapters?: unknown;
  /** Achievements and endings ({ unlock, title, description, icon, hidden, ending, toast }): unlocked by `unlock <flag>`. */
  achievements?: unknown;
  /** The notice an unlocked achievement pops up: { position, seconds, sound }. */
  achievementToast?: unknown;
  /** Dim the characters who are not speaking: true or { dim, fade, front, offstage }. */
  speakerFocus?: unknown;
  sideImages?: unknown;
  /** The game's own version ("1.2"), shown in the error screen's report. */
  version?: unknown;
}
interface Project {
  scripts?: { file: string; text: string }[];
  /** An export ships the compiled program (engine/src/program-file.ts) instead of the scripts. */
  program?: ProgramFile;
  /** The engine version an export was made with (for the error screen's report). */
  engine?: string;
  locales: Record<string, Record<string, string>>;
  /** An export ships each translation as `locale/<lang>.json`, fetched when that language is picked; the dev server inlines `locales`. */
  localeFiles?: string[];
  assets: AssetFile[];
  rigs?: Record<string, RigManifest>;
  game: GameConfig;
  gameText?: string | null;
}

// ---- bootstrap ----
const devMode = document.documentElement.dataset.mode !== 'game';
const coarsePointer = window.matchMedia('(pointer: coarse)'); // touch mode below
let forceTouch = false;
const embedded = window.parent !== window;
// The editor's animation dialog embeds this page with ?studio=<char>: one character on a plain stage (studio.ts).
const studioChar = devMode && embedded ? new URLSearchParams(location.search).get('studio') : null;
if (studioChar !== null) document.documentElement.dataset.studio = '';
// `&hosted`: the standalone studio (editor/studio.html) has no game project; its page answers for the project and its files.
const hosted = studioChar !== null && new URLSearchParams(location.search).has('hosted');
let studio: Studio | null = null;
let studioProgram: Program | null = null; // the project's scripts, for the stage behind the studio's character
/** The standalone studio's project: the host page lists the character's files (with the URL of each) and its manifest (editor/anim-stage.ts). */
const hostProject = () => new Promise<Project>(resolve => {
  const on = (e: MessageEvent) => {
    const m = e.data as { type?: string; project?: Partial<Project> } | null;
    if (e.origin !== location.origin || e.source !== window.parent || m?.type !== 'studioProject' || !m.project) return;
    window.removeEventListener('message', on);
    resolve({ locales: {}, assets: [], game: {}, ...m.project });
  };
  window.addEventListener('message', on);
  window.parent.postMessage({ type: 'studioProjectRequest' }, location.origin);
});
const fetchProject = async (): Promise<Project> => (hosted ? hostProject() : (await fetch(devMode ? '/api/project' : 'project.json')).json());
const fetchedLocales = new Map<string, Record<string, string>>();
/** One exported translation table; a missing or damaged file leaves the language on the source text. */
async function fetchLocale(lang: string): Promise<Record<string, string>> {
  let table = fetchedLocales.get(lang);
  if (!table) {
    try { table = await (await fetch(`locale/${encodeURIComponent(lang)}.json`)).json() as Record<string, string>; }
    catch { return {}; }
    fetchedLocales.set(lang, table);
  }
  return table;
}
const statusEl = $('status'), langEl = $<HTMLSelectElement>('lang'), diagEl = $('diag'), diagBtn = $('diagBtn'), menuEl = $('menu');
const toastEl = $('toast'), errBanner = $('errBanner');

// The stage size comes from game.json and must be known before the canvas is made.
const firstProject = await fetchProject().catch(() => null);
setStageSize(stageSize(firstProject?.game));
const renderer = new PixiRenderer();
try {
  await renderer.init();
} catch (e) {
  statusEl.textContent = 'WebGL is not available in this browser';
  throw e;
}
// The dev preview lets browser tests read the stage (the characters' draw order, tint and bounds); an export does not.
if (devMode) (window as unknown as { vnStage: () => unknown }).vnStage = () => renderer.stageSnapshot();
// Saves and settings are kept per game, so the id must be known before anything reads them.
setGameId(gameId(firstProject?.game ?? {}));
const settings = loadSettings();
const seen = new SeenLines();
const unlocked = new PersistentSet('unlocked'); // `unlock <flag>` in scripts
const optionsTaken = new PersistentSet('options-taken'); // menu options the player has chosen (the "seen" marker)
const persistent = new PersistentValues('persistent'); // `set persistent.x = ...` in scripts
const imagesSeen = new PersistentSet('images'); // backgrounds shown while playing (gallery)
const tracksHeard = new PersistentSet('music'); // music started while playing (music room)
const labelsReached = new PersistentSet('chapters'); // labels entered while playing (chapter select)
let scriptVersion = '';
let saveVersion = 0; // game.json "saveVersion"
let assetFiles: AssetFile[] = [];
const timeline = new Timeline();
let runtime: Runtime | null = null;
/** What the shell is showing: the title screen, the intro cutscene, or a running game (never two at once). */
type Scene = 'title' | 'intro' | 'playing';
let scene: Scene = 'title';
let game: GameConfig = {};
let lastLine: LineInfo = { name: null, color: null, text: '' };

renderer.isSeen = ev => seen.has(SeenLines.key(ev));
renderer.markSeen = ev => seen.add(SeenLines.key(ev));

let toastTimer = 0;
function toast(key: string, detail = '') {
  const text = document.querySelector(`[data-ui="${key}"]`)?.textContent ?? key;
  toastEl.textContent = detail ? `${text}: ${detail}` : text;
  toastEl.dataset.show = 'true';
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toastEl.dataset.show = 'false'; }, 1600);
}

// ---- saves (see saves.ts) ----
const saveCapture = new SaveCapture({ runtime: () => runtime, lastLine: () => lastLine, scriptVersion: () => scriptVersion, saveVersion: () => saveVersion, timeline, renderer });
const capture = () => saveCapture.capture();
const autosave = (atChoice: boolean) => saveCapture.autosave(atChoice);

/** The languages the project has voice recordings in (set on each load; the voice language option offers these). */
let voiceAvailable: string[] = [];

function applySettings() {
  renderer.audio.setVolume('master', settings.master);
  renderer.audio.setVolume('music', settings.music);
  renderer.audio.setVolume('sound', settings.sound);
  renderer.audio.setVolume('voice', settings.voice);
  renderer.syncMediaVolume();
  renderer.lang = resolveVoiceLanguage(settings.voiceLang, settings.lang, voiceAvailable);
  renderer.textSpeed = settings.textSpeed;
  renderer.autoDelay = settings.autoDelay;
  renderer.skipAll = settings.skipAll;
  renderer.blips.enabled = settings.textSounds;
  renderer.reduceMotion = settings.reduceMotion;
  renderer.captions = settings.captions;
  renderer.announceLines = settings.announceLines;
  renderer.focusOn = settings.speakerFocus;
  renderer.timedChoices = settings.timedChoices;
  stage.style.setProperty('--text-scale', String(settings.textSize));
  stage.style.setProperty('--box-alpha', String(settings.boxOpacity));
  stage.dataset.reduceMotion = String(settings.reduceMotion);
  applyGestures();
  renderer.refresh();
}
applySettings();

// ---- screens ----
const titleState = (): DisplayState =>
  ({ bg: game.titleScreen?.background ?? null, sprites: [], music: game.titleScreen?.music ?? null, musicLoop: true });

/** The key that does what a quick menu button does, shown as its tooltip. */
const QUICK_KEYS: Record<string, string> = { back: 'Mouse wheel up / Page Up', history: 'L', auto: 'A', skip: 'Tab, or hold Ctrl', qsave: 'F5', qload: 'F9', voice: 'V', hide: 'H / middle click' };
/** Tells the quick menu screen which buttons to draw (game.json "quickMenu", labels in the player's language) and where; the replay button only on a voiced line. */
let lineVoiced = false;
let quickPlace = 'bottom';
function applyQuickMenu() {
  if (!runtime) return;
  const { items, place } = quickMenuSettings(game.quickMenu);
  quickPlace = place;
  runtime.quickMenu = { items: items.filter(i => i !== 'voice' || lineVoiced).map(id => ({ id, label: document.querySelector(`[data-ui="q_${id}"]`)?.textContent ?? id, hint: QUICK_KEYS[id] })), place };
}
renderer.onVoice = voiced => {
  lineVoiced = voiced;
  applyQuickMenu();
  if (renderer.quickShown) void renderer.quick(runtime?.quickView() ?? null);
};

const themeEl = document.head.appendChild(document.createElement('style'));

/** The file of a background image by name (in assets/bg or the root), if there is one. */
function bgFile(name: string): AssetFile | undefined {
  return assetFiles.find(a => new RegExp(`^(bg/)?${name.replace(/[^\w-]/g, '')}\.(png|webp|jpe?g|avif)$`, 'i').test(a.file));
}

/** URL of a background image by name, or null when no such file exists. */
function bgUrl(name: string): string | null {
  const file = bgFile(name);
  return file ? `assets/${file.file}?v=${file.v}` : null;
}

function galleryItems(): GalleryItem[] {
  const entries = Array.isArray(game.gallery) ? game.gallery.filter(g => g && typeof g.image === 'string') : [];
  return entries.map(g => {
    return {
      name: g.image,
      title: g.title ?? g.image,
      url: bgUrl(g.image),
      file: bgFile(g.image)?.file ?? '',
      unlocked: g.unlock ? unlocked.has(g.unlock) : imagesSeen.has(g.image),
    };
  });
}

/** An image in assets/ui by name. */
function uiFile(name: string): AssetFile | undefined {
  if (!name) return undefined;
  return assetFiles.find(a => new RegExp(`^ui/${name.replace(/[^\w-]/g, '')}\.(png|webp|jpe?g|avif)$`, 'i').test(a.file));
}
const uiUrl = (file: AssetFile | undefined) => (file ? `assets/${file.file}?v=${file.v}` : null);

const achievementRows = (): AchievementRow[] => achievementItems(game.achievements, f => unlocked.has(f)).map(a => {
  const file = uiFile(a.icon);
  return { ...a, iconUrl: uiUrl(file), iconFile: file?.file ?? '' };
});

/** Warnings for achievements no script unlocks and a bad "achievementToast", pointed at the line of game.json that names them. */
function achievementDiagnostics(program: Program, text: string): Diagnostic[] {
  const lines = text.split('\n');
  const unlocks = new Set(program.ops.flatMap(op => (op.op === 'unlock' ? [op.name] : [])));
  return achievementProblems(game.achievements, game.achievementToast, unlocks).map(message => {
    const name = /unlock (\w+)/.exec(message)?.[1];
    const at = lines.findIndex(l => (name ? l.includes(`"${name}"`) : l.includes('"achievementToast"')));
    return { file: 'game.json', line: Math.max(1, at + 1), severity: 'warning', message } as Diagnostic;
  });
}

const achievementQueue = new AchievementQueue({
  settings: () => achievementToastSettings(game.achievementToast),
  present(entry, cfg) {
    if (!entry) { void renderer.achievementToast(null); return; }
    if (cfg.sound && renderer.audio.has('sound', cfg.sound)) void renderer.audio.sound(cfg.sound);
    const file = uiFile(entry.icon);
    void renderer.achievementToast(runtime?.achievementToastView({ title: entry.title, description: entry.description, icon: file?.file ?? '', ending: entry.ending, position: cfg.position }) ?? null);
  },
});

const musicRoomItems = (): MusicItem[] => musicItems(game.musicRoom, t => tracksHeard.has(t), f => unlocked.has(f));
const chapterList = () => chapterListOf(game.chapters, l => labelsReached.has(l), f => unlocked.has(f));

let themeAssets: AssetFile[] = [];
/** The stage stylesheet: the theme the player picked in Options (game.json "themes"), else the game's own. */
function applyTheme() {
  const look = settings.theme && Array.isArray(game.themes) && game.themes.includes(settings.theme) ? game.themeLooks?.[settings.theme] : undefined;
  themeEl.textContent = themeCss(look ?? game.theme, themeAssets);
}

function applyGame(assets: AssetFile[]) {
  assetFiles = assets;
  setChoiceSlots(game.choiceSaves);
  saveVersion = normalizeSaveVersion(game.saveVersion);
  menus.setSaveNames(game.saveNames === true);
  screenSync.syncAll();
  applyQuickMenu();
  themeAssets = assets;
  const themes = Array.isArray(game.themes) ? game.themes.filter((n): n is string => typeof n === 'string' && !!game.themeLooks?.[n]) : [];
  menus.setThemes(themes);
  applyTheme();
  renderer.blips.voices = game.blips && typeof game.blips === 'object' ? game.blips : {};
  renderer.speakerFocus = speakerFocusSettings(game.speakerFocus);
  menus.setFocusOption(renderer.speakerFocus !== null);
  menus.setTouchOption(touchMode() && touchSettings(game.touch).gestures);
  applyGestures();
  renderer.sideImages = sideImageSettings(game.sideImages);
  document.title = embedded ? 'VN preview' : game.title ?? 'VN preview';
}

function stopModes() {
  renderer.setSkipping(false);
  renderer.setAuto(false);
}

// The curtain is a black layer that fades in before the game replaces the title screen (or the other way
// round) so neither is a hard cut. Reduced motion and `titleScreen.fade: 0` cut instead.
const curtainEl = $('curtain');
function curtain(black: boolean): Promise<void> {
  const ms = settings.reduceMotion ? 0 : titleFade(game.titleScreen?.fade) * 1000;
  curtainEl.style.transitionDuration = `${ms}ms`;
  curtainEl.dataset.show = String(black);
  return ms ? sleep(ms) : Promise.resolve();
}
let curtained = false; // a transition is under way; further clicks are ignored

async function showTitle() {
  if (curtained) return;
  const fromGame = scene !== 'title' && !embedded;
  if (fromGame) { curtained = true; await curtain(true); }
  runtime?.stop();
  scene = 'title';
  stopModes();
  setUiHidden(false);
  showQuick(false);
  renderer.paused = true;
  try {
    await renderer.prepare(titleState()); // the title art and music, so the screen is not drawn with a placeholder
  } catch (e) {
    if (fromGame) { curtained = false; void curtain(false); } // else the screen stays black and clicks are ignored
    throw e;
  }
  if (scene !== 'title') return; // the player started a game meanwhile
  renderer.sync(titleState());
  menus.showTitle();
  statusEl.textContent = 'title screen';
  if (fromGame) { curtained = false; void curtain(false); }
}

/** Play game.json's `intro` label as a cutscene, then the title screen. Esc skips it. Nothing is saved from it. */
async function runIntro() {
  const label = game.intro;
  if (!runtime || !label) { await showTitle(); return; }
  if (!(label in runtime.program.labels)) {
    statusEl.textContent = `intro label "${label}" not found`;
    await showTitle();
    return;
  }
  menus.hideAll();
  stopModes();
  setUiHidden(false);
  showQuick(false);
  runtime.unlockedBase = unlocked.values();
  runtime.seenBase = optionsTaken.values();
  runtime.persistentBase = persistent.values();
  timeline.set([]);
  renderer.paused = false;
  scene = 'intro';
  const finished = await runtime.playLabel(label);
  if (finished && scene === 'intro') await showTitle(); // else skipped, or replaced by another run
}

/** Start or continue a game: from the title screen through the curtain, otherwise at once. */
async function enterGame(run: (rt: Runtime) => Promise<void>, from?: SaveData) {
  if (curtained) return;
  if (scene === 'playing' || embedded) { play(run, from); return; }
  curtained = true;
  await curtain(true);
  void renderer.title(null, true); // the curtain is black: the title goes at once instead of playing its `on exit` as the curtain lifts
  play(run, from);
  curtained = false;
  await curtain(false);
}

/** Start playing: `from` is a save to continue (its unlock base and, for the same script version, its history). */
function play(run: (rt: Runtime) => Promise<void>, from?: SaveData) {
  if (!runtime) return;
  renderer.audio.unlock();
  menus.hideAll();
  stopModes();
  runtime.unlockedBase = from?.base ?? unlocked.values();
  runtime.seenBase = optionsTaken.values(); // taken options are never forgotten, unlike the flags a save began with
  runtime.persistentBase = from?.persistentBase ?? persistent.values();
  if (from?.seed !== undefined) runtime.seed = from.seed;
  timeline.set(from?.version === scriptVersion && from.history ? from.history : []);
  renderer.paused = false;
  scene = 'playing';
  showQuick(true);
  void run(runtime);
}

/** Runs `go`, after a warning when the save was made with an older game.json "saveVersion". */
function resumeSave(s: SaveData, go: () => void) {
  if (isOutdatedSave(s, saveVersion)) menus.confirm('confirm_old_save', go);
  else go();
}

const menus = new Menus(settings, {
  newGame: () => void enterGame(rt => rt.start()),
  continueGame: () => {
    const s = newestSave();
    if (s) resumeSave(s, () => void enterGame(rt => rt.restore(s.at, s.choices, s.screen), s));
  },
  toTitle: () => void showTitle(),
  isPlaying: () => scene === 'playing',
  save: async (slot, label) => {
    const data = await capture();
    return !!data && writeSave(slot, label ? { ...data, label } : data);
  },
  load: slot => {
    const s = readSave(slot);
    if (s) resumeSave(s, () => void enterGame(rt => rt.restore(s.at, s.choices, s.screen), s));
  },
  rollbackTo: n => rollbackTo(n),
  hasVoice: id => renderer.hasVoice(id),
  playVoice: id => renderer.playVoice(id),
  galleryItems,
  musicItems: musicRoomItems,
  playTrack: name => { void renderer.audio.music(name ?? game.titleScreen?.music ?? null, true, 0.5); },
  chapterItems: chapterList,
  achievementItems: achievementRows,
  startChapter: label => void enterGame(rt => rt.startAt(label).then(() => {})),
  screens: open => { renderer.paused = open || scene !== 'playing'; },
  changed: lang => {
    applySettings();
    applyTheme();
    if (lang) { langEl.value = settings.lang; void load(); }
  },
});

// ---- error screen ----
// In an exported game, an error that stops the story (a bad expression, a renderer failure) shows a message with a
// copyable report and Return to title, instead of leaving a frozen stage. The dev preview leaves it to the console.
const crashEl = $('crash'), crashReportEl = $('crashReport'), crashCopy = $('crashCopy');
let crashed = false;
let engineVersion = ''; // project.json "engine", written by the export
function showCrash(error: unknown, at: Src | null) {
  console.error(error);
  crashed = true;
  stopModes();
  scene = 'title';
  curtained = false;
  curtainEl.dataset.show = 'false';
  menus.hideAll();
  showQuick(false);
  renderer.paused = true;
  crashReportEl.textContent = crashReport({
    error, at, engine: engineVersion, game: game.title, gameVersion: typeof game.version === 'string' ? game.version : undefined,
    lines: timeline.lines().map(l => (l.name ? `${l.name}: ${l.text}` : l.text)), agent: navigator.userAgent, time: new Date(),
  });
  crashEl.hidden = false;
  autoFocus($('crashToTitle'));
}
crashCopy.addEventListener('click', () => {
  const text = crashReportEl.textContent ?? '';
  const done = () => {
    const label = crashCopy.textContent;
    crashCopy.textContent = document.querySelector('[data-ui="crash_copied"]')?.textContent ?? 'Copied';
    setTimeout(() => { crashCopy.textContent = label; }, 1500);
  };
  // No clipboard (an insecure origin, a desktop build without permission): select the report for Ctrl+C instead.
  navigator.clipboard?.writeText(text).then(done, () => getSelection()?.selectAllChildren(crashReportEl))
    ?? getSelection()?.selectAllChildren(crashReportEl);
});
$('crashToTitle').addEventListener('click', () => {
  crashEl.hidden = true;
  crashed = false;
  void showTitle();
});

// ---- quick menu actions ----
const canAct = () => scene === 'playing' && !menus.open;

const quick = new QuickActions({
  runtime: () => runtime, timeline, canAct, playing: () => scene === 'playing', stopModes: () => stopModes(), capture, toast: key => toast(key),
  confirm: (key, ok) => menus.confirm(key, ok), resumeSave: (s, go) => resumeSave(s, go), play: (run, from) => play(run, from),
});
const rollback = () => quick.rollback();
const rollbackTo = (n: number) => quick.rollbackTo(n);
const quickSave = () => quick.quickSave();
const quickLoad = () => quick.quickLoad();

function toggleSkip(on = !renderer.skipping) {
  if (!canAct()) return;
  renderer.setSkipping(on);
  if (on && !renderer.skipping) toast('toast_skip_unread'); // stopped at once: the line on screen is unread
}

function setUiHidden(hidden: boolean) { stage.dataset.uiHidden = String(hidden); }
const uiHidden = () => stage.dataset.uiHidden === 'true';

const quickActions: Record<string, () => void> = {
  back: rollback,
  history: () => { if (canAct()) menus.openHistory(timeline.lines(), timeline.atLine()); },
  auto: () => { if (canAct()) renderer.setAuto(!renderer.autoOn); },
  skip: () => toggleSkip(),
  qsave: () => void quickSave(),
  qload: quickLoad,
  save: () => { if (canAct()) menus.openSaves('save'); },
  load: () => { if (canAct()) menus.openSaves('load'); },
  options: () => { if (canAct()) menus.openOptions(); },
  voice: () => renderer.replayVoice(),
  hide: () => { if (canAct()) setUiHidden(true); },
};
/** Show or hide the quick menu (the project's `screen quickmenu`, else the default). */
function showQuick(on: boolean) {
  renderer.quickShown = on;
  applyQuickMenu();
  void renderer.quick(runtime?.quickView() ?? null);
}
renderer.slots.onAction.quick = item => {
  const act = item?.act;
  if (act) quickActions[act]?.();
};
const screenSync = initScreenSync({
  menus, renderer,
  runtime: () => runtime,
  game: () => game,
  counts: () => ({ gallery: Array.isArray(game.gallery) ? galleryItems().length : 0, music: musicRoomItems().length, chapters: chapterList().length, achievements: achievementRows().length }),
  showTitle: () => void showTitle(),
});
const { titleEl, pauseEl, optionsEl, savesEl, historyEl, galleryEl, viewerEl, musicEl, chaptersEl } = screenSync;
// A phone's screen stays on while auto-advance or a movie plays, and audio comes back when the tab does (iOS interrupts it).
const wake = new ScreenWake();
new MutationObserver(() => wake.set('movie', touchMode() && $('movie').dataset.show === 'true')).observe($('movie'), { attributes: true, attributeFilter: ['data-show'] });
// An exported game whose index.html links a manifest (game.json "pwa") installs and plays offline through its service worker.
if (!devMode && 'serviceWorker' in navigator && document.querySelector('link[rel="manifest"]')) void navigator.serviceWorker.register('sw.js').catch(() => {});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { wake.resume(); renderer.audio.unlock(); } });
renderer.onModeChange = () => {
  wake.set('auto', touchMode() && renderer.autoOn);
  const pressed = { auto: renderer.autoOn, skip: renderer.skipping };
  for (const [act, on] of Object.entries(pressed)) for (const el of document.querySelectorAll(`#quickui [data-act="${act}"]`)) el.setAttribute('aria-pressed', String(on));
};

// ---- project loading / hot reload ----
// The CSS safe-area insets (a notch, rounded corners) are read through a hidden probe, since env() has no JS API.
const insetProbe = document.createElement('div');
insetProbe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
document.body.append(insetProbe);
// The editor's Phone preview (a "device" message) makes the embedded preview behave as on a touch screen: touch layout and sizes
// on, and the mouse standing in for a finger. Declarations, since applySettings() and the screens run before this point.
/** The layout and size rules for a touch screen apply: a real touch device playing an exported game, or the editor's Phone preview. */
function touchMode(): boolean { return forceTouch || (!devMode && coarsePointer.matches); }
/** Touch gestures and near-miss taps are possible (they still need a touch pointer, or the Phone preview). */
function touchPlay(): boolean { return forceTouch || !devMode; }
function touchPointer(type: string): boolean { return type === 'touch' || forceTouch; }
let stageScale = 1; // the last scale fit() set
function fit() {
  if (studio) { studio.tools.layout(window.innerWidth, window.innerHeight); return; } // the studio's stage has a viewport of its own
  const vw = window.innerWidth, vh = window.innerHeight - (devMode && studioChar === null ? 44 : 0);
  const s = stageScale = fitScale(vw, vh, { width: W, height: H });
  stage.style.transform = `translate(-50%, -50%) scale(${s})`;
  const cs = getComputedStyle(insetProbe);
  const safe = stageInsets(vw, vh, { width: W, height: H }, { top: parseFloat(cs.paddingTop) || 0, right: parseFloat(cs.paddingRight) || 0, bottom: parseFloat(cs.paddingBottom) || 0, left: parseFloat(cs.paddingLeft) || 0 });
  const root = document.documentElement;
  for (const side of ['top', 'right', 'bottom', 'left'] as const) root.style.setProperty(`--safe-${side}`, `${safe[side]}px`);
  root.style.setProperty('--touch-text', touchMode() ? String(textFloor(s, 44)) : '1'); // dialogue text never under 16 CSS px on a phone
  root.toggleAttribute('data-touch', touchMode());
  if (!devMode && needsRotate(vw, vh, { width: W, height: H }, touchMode())) root.dataset.rotate = ''; else delete root.dataset.rotate;
  root.dataset.fitted = '';
}
window.addEventListener('resize', fit);
window.addEventListener('orientationchange', fit);
fit();

function showDiagnostics(list: Diagnostic[]) {
  const errors = list.filter(d => d.severity === 'error').length;
  const warns = list.length - errors;
  diagBtn.dataset.errors = String(errors);
  diagBtn.dataset.warns = String(warns);
  diagBtn.textContent = `Problems: ${list.length}`;
  const h = document.createElement('h2');
  h.textContent = list.length ? `${errors} errors, ${warns} warnings` : 'No problems found';
  const ul = document.createElement('ul');
  for (const d of list) {
    const li = document.createElement('li');
    const loc = document.createElement('span'); loc.className = 'loc'; loc.textContent = `${d.file}:${d.line} `;
    const msg = document.createElement('span'); msg.className = d.severity; msg.textContent = d.message;
    li.append(loc, msg);
    ul.append(li);
  }
  diagEl.replaceChildren(h, ul);
  const first = list.find(d => d.severity === 'error');
  bannerAt = first ?? null;
  if (first) {
    const b = document.createElement('b');
    b.textContent = errors > 1 ? `Script error (1 of ${errors}): ` : 'Script error: ';
    errBanner.replaceChildren(b, `${first.message} (${first.file}:${first.line})`);
  }
  errBanner.dataset.visible = String(!!first);
}
let bannerAt: Diagnostic | null = null;
// In the editor the banner jumps to the line; on its own page it opens the problem list instead.
errBanner.addEventListener('click', () => {
  if (embedded && bannerAt) window.parent.postMessage({ type: 'showLine', file: bannerAt.file, line: bannerAt.line }, location.origin);
  else diagEl.dataset.visible = 'true';
});

let loadSeq = 0;
async function load() {
  const seq = ++loadSeq;
  const stale = () => seq !== loadSeq; // a newer load() started: it has fresher data, so this one stops
  let proj: Project;
  try { proj = await fetchProject(); }
  catch { statusEl.textContent = devMode ? 'Cannot reach the dev server' : 'Could not load project.json'; return; }
  if (stale()) return;

  if (studioChar !== null) { await loadStudio(proj, studioChar, stale); return; }
  const size = stageSize(proj.game);
  if (size.width !== W || size.height !== H) { location.reload(); return; } // the canvas and the CSS box are sized once
  const built = buildProgram(proj, size);
  if (!built) return;
  const { program, precompiled } = built;
  engineVersion = proj.engine ?? '';
  const source = sourceLanguage(proj.game);
  const tables = { ...proj.locales };
  const langs = [...new Set([...Object.keys(tables), ...(proj.localeFiles ?? [])])];
  if (!langs.includes(source)) langs.unshift(source);
  if (!langs.includes(settings.lang)) settings.lang = source;
  if (settings.lang !== source && !tables[settings.lang]) tables[settings.lang] = await fetchLocale(settings.lang);
  if (stale()) return;
  voiceAvailable = voiceLanguages((proj.assets ?? []).map(a => a.file), source);
  menus.setVoiceLanguages(voiceAvailable);
  applySettings();
  langEl.replaceChildren(...langs.map(l => { const o = document.createElement('option'); o.value = o.textContent = l; return o; }));
  langEl.value = settings.lang;
  menus.setLanguages(langs);
  const locale = new Locale(tables, settings.lang, source);
  stage.lang = settings.lang;
  game = proj.game ?? {};
  renderer.captionTexts = captionTable(game);
  menus.translate(locale, game.labels);
  applyGame(proj.assets ?? []);

  renderer.characters = program.characters;
  await renderer.preload(proj.assets ?? [], proj.rigs);
  if (stale()) return;
  const index = {
    files: (proj.assets ?? []).map(a => a.file),
    rigs: proj.rigs,
    blips: Object.keys(game.blips ?? {}),
    skins: Object.keys(game.theme?.skins ?? {}),
    themeSkins: Object.fromEntries(Object.entries(game.themeLooks ?? {}).map(([n, t]: [string, any]) => [n, Object.keys(t?.skins ?? {})])),
  };
  if (!precompiled) { // an export checked all this, and baked the preloads in
    attachPreloads(program, index, { gallery: Array.isArray(game.gallery) ? game.gallery.map(g => g?.image).filter(n => typeof n === 'string') : [] });
    showDiagnostics([...program.diagnostics, ...checkAssets(program, index), ...checkGame(game, index, proj.gameText ?? ''), ...chapterDiagnostics(game.chapters, program.labels,proj.gameText ?? ''), ...achievementDiagnostics(program, proj.gameText ?? '')]);
  }

  if (!runtime) { await startRuntime(program, locale); return; }
  await reloadRuntime(runtime, program, locale, stale);
}

/** The studio frame (?studio=): the character on the stage, no game. */
async function loadStudio(proj: Project, char: string, stale: () => boolean) {
  renderer.reduceMotion = true; // no idle loop to fight the studio's pose
  await renderer.preload(proj.assets ?? [], proj.rigs);
  if (stale()) return;
  const scripts = compile(proj.scripts ?? [], namedPositions(proj.game), namedAnchors(proj.game), stageSize(proj.game));
  studioProgram = scripts;
  studio ??= new Studio(renderer, char, at => sceneAt(studioProgram!, at));
  await studio.loadScene(); // the scripts may have changed under the scene line
  await studio.show();
  return;
}

/** The program of a project: the exported one unpacked, or the scripts compiled. Null (and the status line says why) when the export is unreadable. */
function buildProgram(proj: Project, size: { width: number; height: number }): { program: Program; precompiled: boolean } | null {
  let program: Program, precompiled = false;
  if (proj.program) {
    try { const f = unpackProgram(proj.program); program = f.program; scriptVersion = f.version; precompiled = true; }
    catch (e) { statusEl.textContent = (e as Error).message; return null; }
  } else {
    program = compile(proj.scripts ?? [], namedPositions(proj.game), namedAnchors(proj.game), size);
    scriptVersion = scriptsVersion(proj.scripts ?? []);
  }
  return { program, precompiled };
}

/** The first load: the runtime is made and the game opens at its splash, intro or title. */
async function startRuntime(program: Program, locale: Locale) {
  runtime = new Runtime(program, renderer, locale);
  // the starter title and pause screens say "New game" in the game's language (game.json "labels", locale `ui.<key>`), through the hidden [data-ui] labels
  runtime.uiText = raw => menus.uiText(raw);
  runtime.onUnlock = name => {
    const fresh = achievementToToast(game.achievements, name, unlocked.has(name));
    unlocked.add(name);
    if (fresh) achievementQueue.add(fresh);
  };
  runtime.onSeen = key => optionsTaken.add(key);
  runtime.onPersist = (name, value) => persistent.set(name, value);
  runtime.onLabel = name => { if (scene === 'playing') labelsReached.add(name); };
  if (!devMode) runtime.onError = showCrash;
  if (embedded) play(rt => rt.start());
  else {
    const cards = normalizeSplash(game.splash);
    if (cards.length) {
      void renderer.prepare(titleState()); // the title art loads while the cards play
      await playSplash(cards, bgUrl, settings.reduceMotion);
    }
    await runIntro();
    runtime.warm();
  } // the first scene loads in the background while the title is up
}

/** A reload after an edit: the runtime takes the new program and the story picks up where it was. */
async function reloadRuntime(rt: Runtime, program: Program, locale: Locale, stale: () => boolean) {
  rt.setProgram(program, locale);
  screenSync.syncAll();
  if (scene === 'playing') {
    timeline.clear(); // step numbers may have shifted with the edit
    const pos = rt.current, open = rt.screenSnapshot(); // a screen that is up keeps its local state through the reload
    await renderer.prepare(rt.state); // edited images load now, so the restore below draws without a gap
    if (stale()) return;
    void (pos ? rt.restore(pos, undefined, open) : rt.start());
  } else if (scene !== 'intro') {
    await renderer.prepare(titleState());
    if (stale()) return;
    renderer.sync(titleState()); // refresh art/music behind the title; leave the menus as they are
    rt.warm();
  }
}

/** The story's variables with the unlocked./persistent. names: what an expression sees. */
function scriptVars() {
  if (!runtime) return {};
  const flags = [...runtime.unlockedBase, ...runtime.unlocks].map(f => [`unlocked.${f}`, true] as const);
  const data = Object.entries({ ...runtime.persistentBase, ...runtime.persistent }).map(([k, v]) => [`persistent.${k}`, v] as const);
  return { ...runtime.vars, ...Object.fromEntries(flags), ...Object.fromEntries(data) };
}
renderer.scriptVars = scriptVars; // the conditions of automatic animations and reactions read them each step

function postVars() {
  if (!runtime) return;
  window.parent.postMessage({ type: 'vars', vars: scriptVars() }, location.origin);
}

renderer.onHudEvent = (id, on) => {
  try { runtime?.hudEvent(id, on); } // a quiet handler runs on the spot, outside the story's run
  catch (e) { if (devMode || !runtime) throw e; runtime.stop(); showCrash(e, runtime.current); }
};
renderer.onPosition = (src, line) => {
  statusEl.textContent = `${src.file}:${src.line}`;
  if (line) lastLine = line;
  if (runtime) timeline.push({ step: runtime.step, choices: [...runtime.choices], line });
  if (embedded) {
    window.parent.postMessage({ type: 'position', file: src.file, line: src.line }, location.origin);
    postVars();
  }
  else if (scene === 'playing') void autosave(!line); // no line text means a choice or a prompt
};
renderer.onLineShown = line => { lastLine = line; };
renderer.onBackground = name => { if (scene === 'playing') imagesSeen.add(name); };
renderer.onMusic = name => { if (scene === 'playing') tracksHeard.add(name); };
if (embedded) $('ended').dataset.dev = 'true'; // the editor's preview: a click starts over, and the words are the author's
renderer.onEnded = () => { if (embedded) void runtime?.start(); else void showTitle(); };

// ---- input ----
// The first gesture anywhere unlocks audio (browsers block it until then).
// iOS Safari counts only touchend and click as a gesture for audio, and unlock() is a cheap state check, so these stay on.
for (const type of ['pointerdown', 'touchend', 'click']) window.addEventListener(type, () => renderer.audio.unlock(), { capture: true });
window.addEventListener('pointerdown', () => { stage.dataset.pad = 'false'; });
window.addEventListener('keydown', () => renderer.audio.unlock(), { once: true });

stage.addEventListener('click', () => {
  if (menus.open || crashed) return;
  if (uiHidden()) { setUiHidden(false); return; } // the first click only brings the interface back
  renderer.advance();
});
stage.addEventListener('contextmenu', e => {
  e.preventDefault();
  if (canAct()) menus.showPause();
});
stage.addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); }); // no autoscroll
stage.addEventListener('auxclick', e => {
  if (e.button === 1 && canAct()) setUiHidden(!uiHidden());
});
let wheelAt = 0;
stage.addEventListener('wheel', e => {
  if (!canAct() || performance.now() - wheelAt < 200) return;
  wheelAt = performance.now();
  if (e.deltaY < 0) rollback();
  else if (e.deltaY > 0) renderer.advance();
}, { passive: true });

// ---- touch targets (docs/design/mobile.md, step 3) ----
// The quick bar's buttons are ~40 stage pixels tall, a dozen CSS pixels on a phone: on a touch screen the bar is enlarged from the
// edge it sits on (CSS in index.html reads --quick-k and --quick-origin), as much as the stage has room for.
const quickUi = $('quickui');
function boostQuickBar() {
  const reset = () => { quickUi.style.removeProperty('--quick-k'); quickUi.style.removeProperty('--quick-origin'); };
  const buttons = [...quickUi.querySelectorAll<HTMLElement>('.sc-btn')];
  if (!touchMode() || !buttons.length) { reset(); return; }
  const extent = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
  let height = 0;
  for (const b of buttons) {
    extent.left = Math.min(extent.left, b.offsetLeft); extent.right = Math.max(extent.right, b.offsetLeft + b.offsetWidth);
    extent.top = Math.min(extent.top, b.offsetTop); extent.bottom = Math.max(extent.bottom, b.offsetTop + b.offsetHeight);
    height = Math.max(height, b.offsetHeight);
  }
  const origin = boostOrigin(quickPlace);
  quickUi.style.setProperty('--quick-k', String(barBoost(stageScale, height, extent, { width: W, height: H }, origin)));
  quickUi.style.setProperty('--quick-origin', `${origin[0] * 100}% ${origin[1] * 100}%`);
}
new MutationObserver(boostQuickBar).observe(quickUi, { childList: true, subtree: true });
window.addEventListener('resize', boostQuickBar);
window.addEventListener('orientationchange', boostQuickBar);

// ---- touch gestures (docs/design/mobile.md, step 2) ----
// Only touch pointers: a mouse keeps the wheel, the right click and the middle click. A touch that starts on a button, a
// hotspot or a scrolling list belongs to that; a swipe never advances the story (the tap does).
function gesturesOn(): boolean { return touchPlay() && settings.touchGestures && touchSettings(game.touch).gestures; } // a declaration: applySettings() runs before this point
const gestureReady = () => gesturesOn() && canAct() && !renderer.screens.open && !crashed;
/** With gestures on, the browser leaves the stage's touches to the page (scroll lists opt back in in index.html). */
function applyGestures() { document.documentElement.toggleAttribute('data-gestures', gesturesOn()); }
const GESTURE_SKIP = 'button, a, input, select, textarea, [data-id], .sc-scroll, [role="slider"], [role="button"]';
interface Touching { start: Map<number, { x: number; y: number }>; t: number; fingers: number; moved: number; timer: number; fired: boolean; dx: number; dy: number }
let touching: Touching | null = null;
let swallowClick = false;
const endTouch = () => { if (touching) clearTimeout(touching.timer); touching = null; };
stage.addEventListener('click', e => { // the click that follows a gesture that was not a tap
  if (!swallowClick) return;
  swallowClick = false;
  e.stopImmediatePropagation();
  e.preventDefault();
}, true);
stage.addEventListener('pointerdown', e => {
  if (!touchPointer(e.pointerType)) return;
  if (touching) { // a second finger: a two-finger tap, never a long press
    touching.start.set(e.pointerId, { x: e.clientX, y: e.clientY });
    touching.fingers = Math.max(touching.fingers, touching.start.size);
    clearTimeout(touching.timer);
    return;
  }
  if (!gestureReady() || (e.target as Element | null)?.closest?.(GESTURE_SKIP)) return;
  touching = { start: new Map([[e.pointerId, { x: e.clientX, y: e.clientY }]]), t: performance.now(), fingers: 1, moved: 0, dx: 0, dy: 0, fired: false,
    timer: window.setTimeout(() => {
      if (!touching || touching.fingers > 1 || !gestureReady()) return;
      touching.fired = true;
      swallowClick = true;
      if (uiHidden()) setUiHidden(false); else menus.showPause();
    }, LONG_PRESS_MS) };
});
stage.addEventListener('pointermove', e => {
  const s = touching?.start.get(e.pointerId);
  if (!touching || !s) return;
  const dx = e.clientX - s.x, dy = e.clientY - s.y;
  touching.moved = Math.max(touching.moved, Math.hypot(dx, dy));
  if (touching.start.size === 1) { touching.dx = dx; touching.dy = dy; }
  if (!stillForLongPress(dx, dy)) clearTimeout(touching.timer);
});
const liftTouch = (e: PointerEvent) => {
  if (!touching || !touching.start.has(e.pointerId)) return;
  const s = touching.start.get(e.pointerId)!;
  if (touching.fingers === 1) { touching.dx = e.clientX - s.x; touching.dy = e.clientY - s.y; }
  touching.start.delete(e.pointerId);
  if (touching.start.size > 0) return; // wait for the last finger
  const t = touching;
  endTouch();
  if (e.type === 'pointercancel' || t.fired) return;
  const gesture = classifyStroke(t.fingers > 1 ? { dx: t.moved, dy: 0, ms: performance.now() - t.t, fingers: t.fingers } : { dx: t.dx, dy: t.dy, ms: performance.now() - t.t, fingers: 1 });
  if (!gesture || gesture === 'tap' || !gestureReady()) return;
  swallowClick = true;
  setTimeout(() => { swallowClick = false; }, 400); // a click that never comes must not eat the next real one
  if (uiHidden() && gesture !== 'swipe-down') { setUiHidden(false); return; }
  switch (gesture) {
    case 'swipe-right': rollback(); break;
    case 'swipe-up': quickActions.history(); break;
    case 'swipe-down': setUiHidden(!uiHidden()); break;
    case 'two-finger-tap': menus.showPause(); break;
  }
};
stage.addEventListener('pointerup', liftTouch);
stage.addEventListener('pointercancel', liftTouch);

// Keyboard and gamepad share one set of actions (input.ts). With a menu or the choices on screen, directions
// move focus; otherwise the pad plays the game.
const choiceOpen = () => menuEl.dataset.visible === 'true';
const screenOpen = () => !crashed && !menus.top && renderer.screens.open; // a custom screen (show screen) is up, with no menu over it
// A menu's container element stays empty: the screen is drawn in its layer, so focus moves inside the layer, not the container.
const customRoot = (el: HTMLElement | null): HTMLElement | null =>
  el?.dataset.custom !== 'true' ? el : el === titleEl ? renderer.slots.layers.title.root : el === pauseEl ? renderer.slots.layers.pause.root : el === optionsEl ? renderer.slots.layers.options.root : el === savesEl ? renderer.slots.layers.saves.root : el === historyEl ? renderer.slots.layers.history.root : el === galleryEl ? renderer.slots.layers.gallery.root : el === viewerEl ? renderer.slots.layers.viewer.root : el === musicEl ? renderer.slots.layers.music.root : el === chaptersEl ? renderer.slots.layers.chapters.root : el;
const uiRoot = (): HTMLElement | null => crashed ? crashEl : customRoot(menus.top) ?? (renderer.screens.open ? renderer.screens.root : choiceOpen() ? menuEl : renderer.hudLayer.focused ? renderer.hudLayer.root : null);
// Near misses on a touch screen (docs/design/mobile.md, step 3): a tap beside a button of the screen that is up presses the nearest
// one within a 44 CSS px target, so small buttons need no bigger layout. A tap inside any button is left to the browser.
let lastPointer = 'mouse';
window.addEventListener('pointerdown', e => { lastPointer = e.pointerType; }, true);
stage.addEventListener('click', e => {
  if (!touchPlay() || !touchPointer(lastPointer)) return;
  const root = uiRoot();
  if (!root || (e.target as Element | null)?.closest?.('button, a, input, select, textarea, [data-id], [role="slider"]')) return;
  const found = [...root.querySelectorAll<HTMLElement>('button, .sc-btn')]
    .filter(b => !b.matches(':disabled, [aria-disabled="true"]'))
    .map(el => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ r }) => r.width > 0 && r.height > 0);
  const i = resolveTouch(e.clientX, e.clientY, found.map(({ r }) => ({ x: r.left, y: r.top, w: r.width, h: r.height })), TOUCH_MIN_CSS);
  if (i < 0) return;
  e.stopImmediatePropagation(); // not an advance of the story
  e.preventDefault();
  found[i].el.click();
}, true);
const isTab = (e: Element | null) => !!e?.matches('[role="tab"]');
/** Left/Right on a tab, or the shoulder buttons: click the next (or previous) tab of the row and keep the focus on the lit one. */
function stepTab(root: HTMLElement, from: Element | null, step: number): boolean {
  const tabs = [...root.querySelectorAll<HTMLElement>('[role="tab"]')];
  if (!tabs.length) return false;
  const at = Math.max(0, from ? tabs.indexOf(from as HTMLElement) : tabs.findIndex(t => t.getAttribute('aria-selected') === 'true'));
  tabs[(at + step + tabs.length) % tabs.length].click();
  requestAnimationFrame(() => root.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus());
  return true;
}

function handleAction(a: Action) {
  stage.dataset.pad = 'true'; // the on-screen keyboard of name prompts shows while the pad is in use
  if (uiHidden()) { setUiHidden(false); return; }
  if (screenOpen()) { // its own directional focus (shapes, not boxes); the other actions are ignored
    if (a === 'up' || a === 'down' || a === 'left' || a === 'right') renderer.screens.move(a);
    else if (a === 'confirm') renderer.screens.confirm();
    else if (a === 'cancel') renderer.screens.cancel();
    return;
  }
  const root = uiRoot();
  const focused = document.activeElement;
  if (root) {
    switch (a) {
      case 'up': case 'down': moveFocus(root, a); break;
      case 'left': case 'right':
        if (menus.top === viewerEl) menus.stepViewer(a === 'right' ? 1 : -1); // the arrows page through the pictures
        else if (isTab(focused)) stepTab(root, focused, a === 'right' ? 1 : -1);
        else if (!adjustFocused(a)) moveFocus(root, a);
        break;
      case 'confirm':
        if (focused instanceof HTMLInputElement && focused.type === 'text') moveFocus(root, 'down'); // name prompt: on to the keyboard (OK is below it)
        else if (focused && root.contains(focused)) { notePadConfirm(); (focused as HTMLElement).click(); }
        else moveFocus(root, 'down');
        break;
      case 'cancel': if (menus.open) menus.escape(); else if (renderer.hudLayer.focused) renderer.hudLayer.blur(); break;
      case 'backspace': case 'shift': root.querySelector<HTMLElement>(`[data-osk="${a === 'shift' ? 'shift' : 'back'}"]`)?.click(); break;
      case 'tabPrev': case 'tabNext':
        stepTab(root, null, a === 'tabNext' ? 1 : -1);
        break;
    }
    return;
  }
  switch (a) {
    case 'hud': renderer.hudLayer.focusFirst(); break; // the HUD is a passive group: nothing focuses it by itself
    case 'confirm': renderer.advance(); break;
    case 'rollback': rollback(); break;
    case 'auto': quickActions.auto(); break;
    case 'hide': quickActions.hide(); break;
    case 'history': quickActions.history(); break;
    case 'pause': menus.escape(); break;
    case 'skipOn': toggleSkip(true); break;
    case 'skipOff': toggleSkip(false); break;
  }
}
let padSeen = false; // no toast for "no gamepad" on page load, only after one has been connected
watchGamepad(handleAction, () => uiRoot() !== null, s => {
  const name = s.id.replace(/\s*\(.*$/, '').slice(0, 40); // "Xbox 360 Controller (STANDARD GAMEPAD Vendor: ...)"
  if (s.connected) { padSeen = true; toast(s.standard ? 'toast_pad_on' : 'toast_pad_nonstandard', name); }
  else if (padSeen) toast('toast_pad_off');
});

let ctrlSkip = false;
window.addEventListener('keydown', e => {
  const dir = ({ ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' } as Record<string, Action>)[e.key];
  // The on-screen keyboard hides once real typing starts; arrows, Enter, Space and modifiers (sent by pads that
  // emulate a keyboard, or used to drive the on-screen keys) leave it alone.
  if (e.key.length === 1 && e.key !== ' ' || e.key === 'Backspace') {
    if (!(e.target instanceof Element && e.target.closest('.osk'))) stage.dataset.pad = 'false';
  }
  // In a text field left/right move the caret, but up/down have no other use: they leave for the on-screen keys.
  const typing = e.target instanceof HTMLInputElement && e.target.type === 'text' && dir !== 'up' && dir !== 'down';
  if (dir && uiRoot() && !typing && !e.ctrlKey && !e.altKey && !e.metaKey) { e.preventDefault(); handleAction(dir); return; }
  if (crashed) return; // Tab, Enter and Space work the error screen's buttons as usual
  if (e.key === 'Escape') {
    e.preventDefault();
    if (uiHidden()) setUiHidden(false);
    else if (scene === 'intro' && !menus.open) void showTitle(); // skip the intro
    else menus.escape();
    return;
  }
  if (menus.open || e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement) return;
  if (e.key === 'Tab' && e.shiftKey && renderer.hudLayer.active && !choiceOpen() && !screenOpen()) { e.preventDefault(); if (renderer.hudLayer.focused) renderer.hudLayer.blur(); else renderer.hudLayer.focusFirst(); return; }
  if (e.key === 'Tab' && (choiceOpen() || screenOpen())) return;
  if (e.key === 'Backspace' && renderer.hudLayer.focused) { e.preventDefault(); renderer.hudLayer.blur(); return; }
  if (e.key === 'Backspace' && screenOpen()) { e.preventDefault(); renderer.screens.cancel(); return; } // Tab moves focus between the choices; skip is for reading
  if (uiHidden()) { setUiHidden(false); e.preventDefault(); return; }
  if (e.key === 'Control' && !e.repeat) { ctrlSkip = true; toggleSkip(true); return; }
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  const hotkeys: Record<string, () => void> = {
    Tab: () => toggleSkip(), a: quickActions.auto, F5: quickActions.qsave, F9: quickActions.qload,
    v: quickActions.voice, h: quickActions.hide, l: quickActions.history, PageUp: rollback, PageDown: () => renderer.advance(),
  };
  const fn = hotkeys[e.key.length === 1 ? e.key.toLowerCase() : e.key];
  if (fn) { e.preventDefault(); fn(); return; }
  if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') {
    if (e.target instanceof HTMLButtonElement && e.key !== 'ArrowRight') return; // let focused buttons activate normally
    e.preventDefault();
    renderer.advance();
  } else if (/^[1-9]$/.test(e.key)) {
    const btn = menuEl.querySelectorAll<HTMLButtonElement>(':scope > button')[Number(e.key) - 1];
    btn?.click();
  }
});
const endCtrlSkip = () => { if (ctrlSkip) { ctrlSkip = false; renderer.setSkipping(false); } };
window.addEventListener('keyup', e => { if (e.key === 'Control') endCtrlSkip(); });
window.addEventListener('blur', endCtrlSkip);

// Embedded in the editor, Restart replays from the top; on its own page it goes back to the title screen like a player would.
$('restart').addEventListener('click', () => { if (embedded) play(rt => rt.start()); else void showTitle(); });
const debugEl = $('debug');
diagBtn.addEventListener('click', () => { debugEl.dataset.visible = 'false'; diagEl.dataset.visible = diagEl.dataset.visible === 'true' ? 'false' : 'true'; });
let debugLog: ((text: string, kind: 'out' | 'err') => void) | null = null;
if (devMode) {
  debugLog = initDebug($('debugBtn'), debugEl, {
    runtime: () => runtime,
    jump: label => void enterGame(rt => rt.startAt(label).then(() => {})),
    sets: { gallery: imagesSeen, music: tracksHeard, chapters: labelsReached, flags: unlocked, options: optionsTaken },
    persistent, seen,
    memory: () => residencyReport(renderer.resident(), memoryBudget(game, (navigator as { deviceMemory?: number }).deviceMemory), { lateLoads: renderer.lateLoads, masks: renderer.maskCount() }),
  });
  $('debugBtn').addEventListener('click', () => { diagEl.dataset.visible = 'false'; });
}
langEl.addEventListener('change', () => { settings.lang = langEl.value; saveSettings(settings); void load(); });

/** Show a built-in screen (the default or the project's own) for the editor: the menus open over the title screen, the quick menu over the game. */
async function previewScreen(name: string) {
  if (name === 'title') { await showTitle(); return; }
  if (name === 'quickmenu') { play(rt => rt.start()); return; }
  if (name === 'achievement_toast') { // a sample notice: the first achievement, or a stand-in
    const first = normalizeAchievements(game.achievements)[0];
    achievementQueue.add(first ?? { unlock: 'example', title: 'Example', description: 'What it takes to unlock it.', icon: '', hidden: false, ending: false, toast: true });
    return;
  }
  if (!menus.open) await showTitle(); // a base to go back to; a screen already up is replaced
  switch (name) {
    case 'pause': menus.showPause(); break;
    case 'options': menus.openOptions(); break;
    case 'saves': menus.openSaves('load'); break;
    case 'history': menus.openHistory(timeline.lines(), timeline.atLine()); break;
    case 'gallery': case 'viewer': menus.showGallery(); break;
    case 'music': menus.showMusic(); break;
    case 'chapters': menus.showChapters(); break;
    case 'achievements': menus.showAchievements(); break;
  }
}

// Editor integration: postMessage({ type: 'goto', file, line }) jumps to a source line,
// { type: 'title' } opens the title screen, { type: 'screen', name } any built-in screen, { type: 'restart' } starts a new game.
window.addEventListener('message', e => {
  if (e.origin !== location.origin) return;
  const m = e.data as { type?: string; file?: string; line?: number; name?: string; value?: unknown; text?: unknown; kind?: unknown; touch?: unknown } | null;
  if (m?.type === 'log' && typeof m.text === 'string') { debugLog?.(m.text, m.kind === 'err' ? 'err' : 'out'); return; }
  if (m?.type === 'setVar' && runtime && typeof m.name === 'string' && /^(persistent\.)?[A-Za-z_]\w*$/.test(m.name)
    && (typeof m.value === 'number' || typeof m.value === 'string' || typeof m.value === 'boolean')) {
    if (m.name.startsWith('persistent.')) { // stored for good, and read by this playthrough from now on
      runtime.persistent[m.name.slice('persistent.'.length)] = m.value;
      persistent.set(m.name.slice('persistent.'.length), m.value);
    } else runtime.vars[m.name] = m.value;
    postVars();
    return;
  }
  if (m?.type === 'title' && runtime) { void showTitle(); return; }
  if (m?.type === 'screen' && runtime && typeof m.name === 'string') { void previewScreen(m.name); return; }
  if (m?.type === 'intro' && runtime) { void runIntro(); return; }
  if (m?.type === 'splash') { void playSplash(normalizeSplash(game.splash), bgUrl, settings.reduceMotion); return; }
  if (m?.type === 'device') { // the editor's Phone preview: act as a touch screen, with the mouse as the finger
    forceTouch = m.touch === true;
    fit();
    applyGestures();
    boostQuickBar();
    menus.setTouchOption(touchMode() && touchSettings(game.touch).gestures);
    return;
  }
  if (m?.type === 'restart') { play(rt => rt.start()); return; }
  if (m?.type === 'goto' && typeof m.file === 'string' && typeof m.line === 'number') {
    const at = { file: m.file, line: m.line };
    play(rt => rt.restore(at));
  }
});

if (devMode && !hosted) { // a standalone studio has no game to follow (and may be served by nothing that pushes events)
  const events = new EventSource('/__events');
  events.onmessage = e => {
    const msg = JSON.parse(e.data) as { type: string };
    if (msg.type === 'engine') location.reload();
    else if (msg.type === 'content') void load();
  };
}

void load();
