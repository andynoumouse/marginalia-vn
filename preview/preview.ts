// Live preview and game shell: title screen, quick menu, rollback, saves, options and pause menu around the
// engine runtime. The world is drawn with PixiJS (WebGL); text and menus are HTML over it.
// Inside the editor (an iframe) the title screen is skipped so edits show at once.
// The same page is the exported game (tools/export-web.mjs sets <html data-mode="game">): no dev bar,
// project data from project.json instead of the dev server, no live reload.

import { initDebug } from './debug.js';
import { attachPreloads, memoryBudget, sourceLanguage, voiceLanguages, resolveVoiceLanguage, residencyReport, captionTable, scriptsVersion, unpackProgram, type ProgramFile, type Program, checkAssets, checkGame, chapterItems, chapterProblems, achievementItems, achievementProblems, achievementToastSettings, achievementToToast, normalizeAchievements, type AchievementEntry, compile, Locale, musicItems, namedAnchors, namedPositions, normalizeChapters, normalizeMusicRoom, normalizeSplash, Runtime, stageSize, titleFade, type ChapterItem, type Diagnostic, type MusicItem, type DisplayState, type RigManifest } from '../engine/src/index.js';
import { Menus, type AchievementRow, type GalleryItem, type TitleConfig } from './menus.js';
import { PixiRenderer } from './pixi-renderer.js';
import { playSplash } from './splash.js';
import { isOutdatedSave, newestSave, normalizeSaveVersion, PersistentSet, PersistentValues, readSave, SeenLines, setChoiceSlots, writeChoiceSave, writeSave, type Moment, type SaveData } from './saves.js';
import { adjustFocused, moveFocus, watchGamepad, type Action } from './input.js';
import { loadSettings, saveSettings } from './settings.js';
import type { Voice } from './blips.js';
import { $, H, sleep, stage, W, type AssetFile, type LineInfo } from './stage-ui.js';
import { setStageSize } from './stage-size.js';
import { gameId, setGameId } from './storage.js';
import { themeCss, type Theme } from './theme.js';
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
  /** The language the scripts are written in (default "en"): the text language that needs no locale/<lang>.json. */
  language?: string;
  /** How many rotating choice autosaves to keep (1-20, default 5). */
  choiceSaves?: number;
  /** Raise it when a release breaks old saves: loading an older save then asks first. */
  saveVersion?: number;
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
}
interface Project {
  scripts?: { file: string; text: string }[];
  /** An export ships the compiled program (engine/src/program-file.ts) instead of the scripts. */
  program?: ProgramFile;
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
const embedded = window.parent !== window;
// The editor's animation dialog embeds this page with ?studio=<char>: one character on a plain stage (studio.ts).
const studioChar = devMode && embedded ? new URLSearchParams(location.search).get('studio') : null;
if (studioChar !== null) document.documentElement.dataset.studio = '';
let studio: Studio | null = null;
const fetchProject = async (): Promise<Project> => (await fetch(devMode ? '/api/project' : 'project.json')).json();
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
const quickEl = $('quick'), toastEl = $('toast'), errBanner = $('errBanner');

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
let playing = false;
let introRunning = false; // the intro cutscene is on screen
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
/** The moment on screen, as a save; null before the story has shown anything. */
async function capture(): Promise<SaveData | null> {
  const at = runtime?.current;
  if (!runtime || !at) return null;
  const data: SaveData = {
    at, choices: [...runtime.choices], name: lastLine.name, text: lastLine.text, time: Date.now(),
    base: [...runtime.unlockedBase], persistentBase: { ...runtime.persistentBase }, seed: runtime.seed, version: scriptVersion, saveVersion, history: timeline.recent(),
  };
  return { ...data, thumb: await renderer.snapshot() };
}
let autosaveSeq = 0;
async function autosave(atChoice: boolean) {
  const seq = ++autosaveSeq;
  const data = await capture();
  if (!data || seq !== autosaveSeq) return; // a newer line may have finished capturing first
  writeSave('auto', data);
  if (atChoice) writeChoiceSave(data);
}

/** The languages the project has voice recordings in (set on each load; the voice language option offers these). */
let voiceAvailable: string[] = [];

function applySettings() {
  renderer.audio.setVolume('master', settings.master);
  renderer.audio.setVolume('music', settings.music);
  renderer.audio.setVolume('sound', settings.sound);
  renderer.audio.setVolume('voice', settings.voice);
  renderer.lang = resolveVoiceLanguage(settings.voiceLang, settings.lang, voiceAvailable);
  renderer.textSpeed = settings.textSpeed;
  renderer.autoDelay = settings.autoDelay;
  renderer.skipAll = settings.skipAll;
  renderer.blips.enabled = settings.textSounds;
  renderer.reduceMotion = settings.reduceMotion;
  renderer.captions = settings.captions;
  renderer.timedChoices = settings.timedChoices;
  stage.style.setProperty('--text-scale', String(settings.textSize));
  stage.style.setProperty('--box-alpha', String(settings.boxOpacity));
  stage.dataset.reduceMotion = String(settings.reduceMotion);
  renderer.refresh();
}
applySettings();

// ---- screens ----
const titleState = (): DisplayState =>
  ({ bg: game.titleScreen?.background ?? null, sprites: [], music: game.titleScreen?.music ?? null, musicLoop: true });

const QUICK_ITEMS = ['back', 'history', 'auto', 'skip', 'qsave', 'qload', 'save', 'load', 'options', 'voice', 'hide'];
const quickButtons = Object.fromEntries([...quickEl.querySelectorAll<HTMLElement>('[data-q]')].map(b => [b.dataset.q!, b]));

renderer.onVoice = voiced => { quickButtons.voice.hidden = !voiced; }; // the stock bar offers a replay only on voiced lines

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

// ---- achievement toasts: one at a time, each for achievementToast.seconds ----
const achToastEl = $('achToast');
const achQueue: AchievementEntry[] = [];
let achShowing = false;
function queueAchievement(entry: AchievementEntry) {
  achQueue.push(entry);
  if (!achShowing) void nextAchievement();
}
async function nextAchievement() {
  const entry = achQueue.shift();
  if (!entry) { achShowing = false; return; }
  achShowing = true;
  const cfg = achievementToastSettings(game.achievementToast);
  if (cfg.sound && renderer.audio.has('sound', cfg.sound)) void renderer.audio.sound(cfg.sound);
  const file = uiFile(entry.icon);
  const view = runtime?.achievementToastView({ title: entry.title, description: entry.description, icon: file?.file ?? '', ending: entry.ending }) ?? null;
  if (view) void renderer.achievementToast(view);
  else {
    const url = uiUrl(file);
    (achToastEl.querySelector('.ach-icon') as HTMLElement).style.backgroundImage = url ? `url("${url}")` : '';
    $('achToastHead').textContent = document.querySelector(`[data-ui="${entry.ending ? 'ending_reached' : 'achievement_unlocked'}"]`)?.textContent ?? '';
    $('achToastTitle').textContent = entry.title;
    $('achToastText').textContent = entry.description;
    achToastEl.dataset.position = cfg.position;
    achToastEl.dataset.show = 'true';
  }
  await sleep(cfg.seconds * 1000);
  achToastEl.dataset.show = 'false';
  void renderer.achievementToast(null);
  await sleep(300); // the fade out
  void nextAchievement();
}

const musicRoomItems = (): MusicItem[] => musicItems(game.musicRoom, t => tracksHeard.has(t), f => unlocked.has(f));
const chapterList = (): ChapterItem[] => chapterItems(game.chapters, l => labelsReached.has(l), f => unlocked.has(f));

/** Warnings for chapters whose label no script defines, pointed at the line of game.json that names it. */
function chapterDiagnostics(labels: Record<string, number>, text: string): Diagnostic[] {
  const lines = text.split('\n');
  return chapterProblems(game.chapters, labels).map(message => {
    const label = /"(.*)"/.exec(message)?.[1] ?? '';
    return { file: 'game.json', line: Math.max(1, lines.findIndex(l => l.includes(`"${label}"`)) + 1), severity: 'warning', message } as Diagnostic;
  });
}

function applyGame(assets: AssetFile[]) {
  assetFiles = assets;
  setChoiceSlots(game.choiceSaves);
  saveVersion = normalizeSaveVersion(game.saveVersion);
  menus.configure(game.title ?? 'Untitled', game.titleScreen, {
    gallery: Array.isArray(game.gallery) && game.gallery.length > 0,
    music_room: normalizeMusicRoom(game.musicRoom).length > 0,
    chapters: normalizeChapters(game.chapters).length > 0,
    achievements: normalizeAchievements(game.achievements).length > 0,
  });
  const q = game.quickMenu ?? {};
  // The replay button joins any listed bar; it stays hidden except on voiced lines.
  const listed = Array.isArray(q.items) ? [...q.items, ...(q.items.includes('voice') ? [] : ['voice'])] : QUICK_ITEMS;
  const items = listed.filter(i => quickButtons[i]);
  quickEl.replaceChildren(...new Set(items.map(i => quickButtons[i])));
  quickEl.dataset.position = q.position ?? 'bottom';
  quickEl.dataset.align = q.align ?? 'center';
  themeEl.textContent = themeCss(game.theme, assets);
  renderer.blips.voices = game.blips && typeof game.blips === 'object' ? game.blips : {};
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
  const fromGame = (playing || introRunning) && !embedded;
  if (fromGame) { curtained = true; await curtain(true); }
  runtime?.stop();
  playing = false;
  introRunning = false;
  stopModes();
  setUiHidden(false);
  showQuick(false);
  renderer.paused = true;
  await renderer.prepare(titleState()); // the title art and music, so the screen is not drawn with a placeholder
  if (playing) return; // the player started a game meanwhile
  renderer.sync(titleState());
  menus.showTitle(newestSave);
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
  playing = false;
  introRunning = true;
  const finished = await runtime.playLabel(label);
  if (finished && introRunning) await showTitle(); // else skipped, or replaced by another run
}

/** Start or continue a game: from the title screen through the curtain, otherwise at once. */
async function enterGame(run: (rt: Runtime) => Promise<void>, from?: SaveData) {
  if (curtained) return;
  if (playing || embedded) { play(run, from); return; }
  curtained = true;
  await curtain(true);
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
  playing = true;
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
    if (s) resumeSave(s, () => void enterGame(rt => rt.restore(s.at, s.choices), s));
  },
  toTitle: () => void showTitle(),
  isPlaying: () => playing,
  save: async slot => {
    const data = await capture();
    return !!data && writeSave(slot, data);
  },
  load: slot => {
    const s = readSave(slot);
    if (s) resumeSave(s, () => void enterGame(rt => rt.restore(s.at, s.choices), s));
  },
  galleryItems,
  musicItems: musicRoomItems,
  playTrack: name => { void renderer.audio.music(name ?? game.titleScreen?.music ?? null, true, 0.5); },
  chapterItems: chapterList,
  achievementItems: achievementRows,
  startChapter: label => void enterGame(rt => rt.startAt(label).then(() => {})),
  screens: open => { renderer.paused = open || !playing; },
  changed: lang => {
    applySettings();
    if (lang) { langEl.value = settings.lang; void load(); }
  },
});

// ---- quick menu actions ----
const canAct = () => playing && !menus.open;

function rollback() {
  if (!canAct() || !runtime) return;
  const prev = timeline.back();
  if (!prev) return;
  stopModes();
  void runtime.restore({ step: prev.step, from: runtime.jumpedFrom ?? undefined }, prev.choices); // steps count from a direct entry
}

async function quickSave() {
  if (!canAct()) return;
  const data = await capture();
  toast(data && writeSave('quick', data) ? 'toast_qsaved' : 'save_failed');
}

function quickLoad() {
  if (!canAct()) return;
  const s = readSave('quick');
  if (!s) { toast('toast_no_qsave'); return; }
  menus.confirm('confirm_qload', () => resumeSave(s, () => play(rt => rt.restore(s.at, s.choices), s)));
}

function toggleSkip(on = !renderer.skipping) {
  if (!canAct()) return;
  renderer.setSkipping(on);
  if (on && !renderer.skipping) toast('toast_skip_unread'); // stopped at once: the line on screen is unread
}

function setUiHidden(hidden: boolean) { stage.dataset.uiHidden = String(hidden); }
const uiHidden = () => stage.dataset.uiHidden === 'true';

const quickActions: Record<string, () => void> = {
  back: rollback,
  history: () => { if (canAct()) menus.openHistory(timeline.lines()); },
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
/** Show or hide the quick menu: the project's `screen quickmenu` when it declares one, else the stock bar. */
function showQuick(on: boolean) {
  const custom = on && !!runtime?.quickView();
  quickEl.hidden = !on || custom;
  renderer.quickShown = on;
  void renderer.quick(custom ? runtime!.quickView() : null);
}
renderer.onQuickAction = item => {
  const act = item?.act;
  if (act) quickActions[act]?.();
};
quickEl.addEventListener('click', e => {
  e.stopPropagation(); // not a click on the story
  const q = (e.target as HTMLElement).closest<HTMLElement>('[data-q]')?.dataset.q;
  if (q) quickActions[q]?.();
});
/** The project's `screen title` replaces the stock title screen: drawn while the stock one is up (hidden behind the saves or options opened over it). */
const titleEl = $('title');
function syncTitle() {
  const view = runtime?.titleView(!!newestSave(), galleryItems().length > 0, musicRoomItems().length > 0, chapterList().length > 0, achievementRows().length > 0) ?? null;
  titleEl.dataset.custom = String(!!view);
  void renderer.title(view && !titleEl.hidden ? view : null);
}
new MutationObserver(syncTitle).observe(titleEl, { attributes: true, attributeFilter: ['hidden'] });
const titleActions: Record<string, () => void> = {
  start: () => void enterGame(rt => rt.start()),
  continue: () => { const s = newestSave(); if (s) void enterGame(rt => rt.restore(s.at, s.choices), s); },
  load: () => menus.openSaves('load'),
  options: () => menus.openOptions(),
  gallery: () => menus.showGallery(),
  music: () => menus.showMusic(),
  chapters: () => menus.showChapters(),
  achievements: () => menus.showAchievements(),
  quit: () => window.close(),
};
/** The project's `screen pause` replaces the stock pause menu, the same way. */
const pauseEl = $('pause');
function syncPause() {
  const view = runtime?.pauseView() ?? null;
  pauseEl.dataset.custom = String(!!view);
  void renderer.pause(view && !pauseEl.hidden ? view : null);
}
new MutationObserver(syncPause).observe(pauseEl, { attributes: true, attributeFilter: ['hidden'] });
const pauseActions: Record<string, () => void> = {
  resume: () => menus.hideAll(),
  save: () => menus.openSaves('save'),
  load: () => menus.openSaves('load'),
  options: () => menus.openOptions(),
  title: () => menus.confirm('confirm_title', () => void showTitle()),
};
/** The project's `screen options` replaces the stock options: redrawn whenever the screen opens or a setting or the tab changes. */
const optionsEl = $('options');
function syncOptions() {
  const view = runtime?.optionsView(menus.optionValues()) ?? null;
  optionsEl.dataset.custom = String(!!view);
  void renderer.options(view && !optionsEl.hidden ? view : null);
}
new MutationObserver(syncOptions).observe(optionsEl, { attributes: true, attributeFilter: ['hidden'] });
menus.onValues = syncOptions;
/** The project's `screen saves` replaces the stock save/load screen: redrawn whenever the screen opens or its page, mode or slots change. */
const savesEl = $('saves');
function syncSaves() {
  const { vars, entries } = menus.savesValues();
  const view = runtime?.savesView(vars, entries) ?? null;
  savesEl.dataset.custom = String(!!view);
  void renderer.saves(view && !savesEl.hidden ? view : null);
}
new MutationObserver(syncSaves).observe(savesEl, { attributes: true, attributeFilter: ['hidden'] });
menus.onSaves = syncSaves;
renderer.onSavesAction = item => {
  const act = item?.act;
  if (act === 'close') menus.closeSaves();
  else if (act === 'page') menus.setPage(item!.id);
  else if (act === 'slot') menus.pickSlot(item!.id);
  else if (act === 'delete') menus.toggleDelete();
};
/** The project's `screen history` replaces the stock history panel: redrawn when it opens. */
const historyEl = $('history');
function syncHistory() {
  const { vars, entries } = menus.historyValues();
  const view = runtime?.historyView(vars, entries) ?? null;
  historyEl.dataset.custom = String(!!view);
  void renderer.history(view && !historyEl.hidden ? view : null);
}
new MutationObserver(syncHistory).observe(historyEl, { attributes: true, attributeFilter: ['hidden'] });
renderer.onHistoryAction = item => { if (item?.act === 'close') menus.closeHistory(); };
/** The project's `screen gallery` replaces the stock gallery: drawn when it opens (and again when the viewer closes). */
const galleryEl = $('gallery');
function syncGallery() {
  const { vars, entries } = menus.galleryValues();
  const view = runtime?.galleryView(vars, entries) ?? null;
  galleryEl.dataset.custom = String(!!view);
  void renderer.gallery(view && !galleryEl.hidden ? view : null, menus.lastTile);
}
new MutationObserver(syncGallery).observe(galleryEl, { attributes: true, attributeFilter: ['hidden'] });
renderer.onGalleryAction = item => {
  const act = item?.act;
  if (act === 'close') menus.closeGallery();
  else if (act === 'tile') menus.pickTile(item!.id);
};
/** The project's `screen viewer` replaces the stock picture viewer opened from a gallery tile: redrawn when it opens and whenever the picture changes. */
const viewerEl = $('viewer');
function syncViewer() {
  const view = runtime?.viewerView(menus.viewerValues()) ?? null;
  viewerEl.dataset.custom = String(!!view);
  void renderer.viewer(view && !viewerEl.hidden ? view : null);
}
new MutationObserver(syncViewer).observe(viewerEl, { attributes: true, attributeFilter: ['hidden'] });
menus.onViewer = syncViewer;
renderer.onViewerAction = item => {
  const act = item?.act;
  if (act === 'close') menus.closeViewer();
  else if (act === 'next') menus.stepViewer(1);
  else if (act === 'prev') menus.stepViewer(-1);
};
/** The project's `screen music` replaces the stock music room: redrawn when it opens and whenever the playing track changes. */
const musicEl = $('musicRoom');
function syncMusic() {
  const { vars, entries } = menus.musicValues();
  const view = runtime?.musicView(vars, entries) ?? null;
  musicEl.dataset.custom = String(!!view);
  void renderer.music(view && !musicEl.hidden ? view : null, menus.lastTrack);
}
new MutationObserver(syncMusic).observe(musicEl, { attributes: true, attributeFilter: ['hidden'] });
menus.onMusic = syncMusic;
renderer.onMusicAction = item => {
  const act = item?.act;
  if (act === 'close') menus.closeMusic();
  else if (act === 'stop') menus.stopMusic();
  else if (act === 'track') menus.pickTrack(item!.id);
};
/** The project's `screen chapters` replaces the stock chapter select. */
const chaptersEl = $('chapters');
function syncChapters() {
  const { vars, entries } = menus.chaptersValues();
  const view = runtime?.chaptersView(vars, entries) ?? null;
  chaptersEl.dataset.custom = String(!!view);
  void renderer.chapters(view && !chaptersEl.hidden ? view : null, menus.lastChapter);
}
new MutationObserver(syncChapters).observe(chaptersEl, { attributes: true, attributeFilter: ['hidden'] });
renderer.onChaptersAction = item => {
  const act = item?.act;
  if (act === 'close') menus.closeChapters();
  else if (act === 'chapter') menus.pickChapter(item!.id);
};
/** The project's `screen achievements` replaces the stock achievements list. */
const achievementsEl = $('achievements');
function syncAchievements() {
  const { vars, entries } = menus.achievementsValues();
  const view = runtime?.achievementsView(vars, entries) ?? null;
  achievementsEl.dataset.custom = String(!!view);
  void renderer.achievements(view && !achievementsEl.hidden ? view : null);
}
new MutationObserver(syncAchievements).observe(achievementsEl, { attributes: true, attributeFilter: ['hidden'] });
renderer.onAchievementsAction = item => {
  if (item?.act === 'close') menus.closeAchievements();
};
renderer.optionsLayer.onSlider =(setting, value) => menus.setNumber(setting, value);
renderer.onOptionsAction = item => {
  const act = item?.act;
  if (act === 'close') menus.closeOptions();
  else if (act === 'fullscreen') menus.toggleFullscreen();
  else if (act === 'tab') menus.setTab(item!.id);
  else if (act === 'cycle') menus.cycle(item!.id);
};
renderer.onPauseAction = item => {
  const act = item?.act;
  if (act) pauseActions[act]?.();
};
renderer.onTitleAction = item => {
  const act = item?.act;
  if (act) titleActions[act]?.();
};
renderer.onModeChange = () => {
  quickButtons.auto.setAttribute('aria-pressed', String(renderer.autoOn));
  quickButtons.skip.setAttribute('aria-pressed', String(renderer.skipping));
  const pressed = { auto: renderer.autoOn, skip: renderer.skipping };
  for (const [act, on] of Object.entries(pressed)) for (const el of document.querySelectorAll(`#quickui [data-act="${act}"]`)) el.setAttribute('aria-pressed', String(on));
};

// ---- project loading / hot reload ----
function fit() {
  const vw = window.innerWidth, vh = window.innerHeight - (devMode && studioChar === null ? 44 : 0);
  const s = Math.min(vw / W, vh / H);
  stage.style.transform = `translate(-50%, -50%) scale(${s})`;
}
window.addEventListener('resize', fit);
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

async function load() {
  let proj: Project;
  try { proj = await fetchProject(); }
  catch { statusEl.textContent = devMode ? 'Cannot reach the dev server' : 'Could not load project.json'; return; }

  if (studioChar !== null) {
    renderer.reduceMotion = true; // no idle loop to fight the studio's pose
    await renderer.preload(proj.assets ?? [], proj.rigs);
    studio ??= new Studio(renderer, studioChar);
    await studio.show();
    return;
  }
  const size = stageSize(proj.game);
  if (size.width !== W || size.height !== H) { location.reload(); return; } // the canvas and the CSS box are sized once
  let program: Program, precompiled = false;
  if (proj.program) {
    try { const f = unpackProgram(proj.program); program = f.program; scriptVersion = f.version; precompiled = true; }
    catch (e) { statusEl.textContent = (e as Error).message; return; }
  } else {
    program = compile(proj.scripts ?? [], namedPositions(proj.game), namedAnchors(proj.game), size);
    scriptVersion = scriptsVersion(proj.scripts ?? []);
  }
  const source = sourceLanguage(proj.game);
  const tables = { ...proj.locales };
  const langs = [...new Set([...Object.keys(tables), ...(proj.localeFiles ?? [])])];
  if (!langs.includes(source)) langs.unshift(source);
  if (!langs.includes(settings.lang)) settings.lang = source;
  if (settings.lang !== source && !tables[settings.lang]) tables[settings.lang] = await fetchLocale(settings.lang);
  voiceAvailable = voiceLanguages((proj.assets ?? []).map(a => a.file), source);
  menus.setVoiceLanguages(voiceAvailable, settings.voiceLang);
  applySettings();
  langEl.replaceChildren(...langs.map(l => { const o = document.createElement('option'); o.value = o.textContent = l; return o; }));
  langEl.value = settings.lang;
  menus.setLanguages(langs, settings.lang);
  const locale = new Locale(tables, settings.lang, source);
  game = proj.game ?? {};
  renderer.captionTexts = captionTable(game);
  menus.translate(locale, game.labels);
  applyGame(proj.assets ?? []);

  renderer.characters = program.characters;
  await renderer.preload(proj.assets ?? [], proj.rigs);
  const index = {
    files: (proj.assets ?? []).map(a => a.file),
    rigs: proj.rigs,
    blips: Object.keys(game.blips ?? {}),
    skins: Object.keys(game.theme?.skins ?? {}),
  };
  if (!precompiled) { // an export checked all this, and baked the preloads in
    attachPreloads(program, index, { gallery: Array.isArray(game.gallery) ? game.gallery.map(g => g?.image).filter(n => typeof n === 'string') : [] });
    showDiagnostics([...program.diagnostics, ...checkAssets(program, index), ...checkGame(game, index, proj.gameText ?? ''), ...chapterDiagnostics(program.labels, proj.gameText ?? ''), ...achievementDiagnostics(program, proj.gameText ?? '')]);
  }

  if (!runtime) {
    runtime = new Runtime(program, renderer, locale);
    runtime.onUnlock = name => {
      const fresh = achievementToToast(game.achievements, name, unlocked.has(name));
      unlocked.add(name);
      if (fresh) queueAchievement(fresh);
    };
    runtime.onSeen = key => optionsTaken.add(key);
    runtime.onPersist = (name, value) => persistent.set(name, value);
    runtime.onLabel = name => { if (playing) labelsReached.add(name); };
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
    return;
  }
  runtime.setProgram(program, locale);
  syncTitle();
  syncPause();
  syncOptions();
  syncSaves();
  syncHistory();
  syncGallery();
  syncMusic();
  syncChapters();
  syncAchievements();
  if (playing) {
    timeline.clear(); // step numbers may have shifted with the edit
    const pos = runtime.current;
    await renderer.prepare(runtime.state); // edited images load now, so the restore below draws without a gap
    void (pos ? runtime.restore(pos) : runtime.start());
  } else if (!introRunning) {
    await renderer.prepare(titleState());
    renderer.sync(titleState()); // refresh art/music behind the title; leave the menus as they are
    runtime.warm();
  }
}

function postVars() {
  if (!runtime) return;
  const flags = [...runtime.unlockedBase, ...runtime.unlocks].map(f => [`unlocked.${f}`, true] as const);
  const data = Object.entries({ ...runtime.persistentBase, ...runtime.persistent }).map(([k, v]) => [`persistent.${k}`, v] as const);
  window.parent.postMessage({ type: 'vars', vars: { ...runtime.vars, ...Object.fromEntries(flags), ...Object.fromEntries(data) } }, location.origin);
}

renderer.onHudEvent = (id, on) => { runtime?.hudEvent(id, on); };
renderer.onPosition = (src, line) => {
  statusEl.textContent = `${src.file}:${src.line}`;
  if (line) lastLine = line;
  if (runtime) timeline.push({ step: runtime.step, choices: [...runtime.choices], line });
  if (embedded) {
    window.parent.postMessage({ type: 'position', file: src.file, line: src.line }, location.origin);
    postVars();
  }
  else if (playing) void autosave(!line); // no line text means a choice or a prompt
};
renderer.onBackground = name => { if (playing) imagesSeen.add(name); };
renderer.onMusic = name => { if (playing) tracksHeard.add(name); };
if (!embedded) $('ended').textContent = 'End of script. Click to return to the title screen.';
renderer.onEnded = () => { if (embedded) void runtime?.start(); else void showTitle(); };

// ---- input ----
// The first gesture anywhere unlocks audio (browsers block it until then).
window.addEventListener('pointerdown', () => renderer.audio.unlock(), { once: true });
window.addEventListener('pointerdown', () => { stage.dataset.pad = 'false'; });
window.addEventListener('keydown', () => renderer.audio.unlock(), { once: true });

stage.addEventListener('click', () => {
  if (menus.open) return;
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

// Keyboard and gamepad share one set of actions (input.ts). With a menu or the choices on screen, directions
// move focus; otherwise the pad plays the game.
const choiceOpen = () => menuEl.dataset.visible === 'true';
const screenOpen = () => !menus.top && renderer.screens.open; // a custom screen (show screen) is up, with no menu over it
// A project screen (title, pause, options) replaces a stock menu's contents; focus then moves inside its layer, not the hidden stock element.
const customRoot = (el: HTMLElement | null): HTMLElement | null =>
  el?.dataset.custom !== 'true' ? el : el === titleEl ? renderer.titleLayer.root : el === pauseEl ? renderer.pauseLayer.root : el === optionsEl ? renderer.optionsLayer.root : el === savesEl ? renderer.savesLayer.root : el === historyEl ? renderer.historyLayer.root : el === galleryEl ? renderer.galleryLayer.root : el === viewerEl ? renderer.viewerLayer.root : el === musicEl ? renderer.musicLayer.root : el === chaptersEl ? renderer.chaptersLayer.root : el;
const uiRoot = (): HTMLElement | null => customRoot(menus.top) ?? (renderer.screens.open ? renderer.screens.root : choiceOpen() ? menuEl : renderer.hudLayer.focused ? renderer.hudLayer.root : null);
const isTab = (e: Element | null) => !!e?.matches('.opt-tabs [data-tab]');

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
        if (isTab(focused)) menus.cycleTab(a === 'right' ? 1 : -1);
        else if (!adjustFocused(a)) moveFocus(root, a);
        if (isTab(focused)) root.querySelector<HTMLElement>('.opt-tabs [aria-selected="true"]')?.focus();
        break;
      case 'confirm':
        if (focused instanceof HTMLInputElement && focused.type === 'text') moveFocus(root, 'down'); // name prompt: on to the keyboard (OK is below it)
        else if (focused && root.contains(focused)) (focused as HTMLElement).click();
        else moveFocus(root, 'down');
        break;
      case 'cancel': if (menus.open) menus.escape(); else if (renderer.hudLayer.focused) renderer.hudLayer.blur(); break;
      case 'backspace': case 'shift': root.querySelector<HTMLElement>(`[data-osk="${a === 'shift' ? 'shift' : 'back'}"]`)?.click(); break;
      case 'tabPrev': case 'tabNext':
        if (menus.cycleTab(a === 'tabNext' ? 1 : -1)) root.querySelector<HTMLElement>('.opt-tabs [aria-selected="true"]')?.focus();
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
  if (e.key === 'Escape') {
    e.preventDefault();
    if (uiHidden()) setUiHidden(false);
    else if (introRunning && !menus.open) void showTitle(); // skip the intro
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
if (devMode) {
  initDebug($('debugBtn'), debugEl, {
    runtime: () => runtime,
    jump: label => void enterGame(rt => rt.startAt(label).then(() => {})),
    sets: { gallery: imagesSeen, music: tracksHeard, chapters: labelsReached, flags: unlocked, options: optionsTaken },
    persistent, seen,
    memory: () => residencyReport(renderer.resident(), memoryBudget(game, (navigator as { deviceMemory?: number }).deviceMemory), { lateLoads: renderer.lateLoads }),
  });
  $('debugBtn').addEventListener('click', () => { diagEl.dataset.visible = 'false'; });
}
langEl.addEventListener('change', () => { settings.lang = langEl.value; saveSettings(settings); void load(); });

/** Show a built-in screen (stock or the project's override) for the editor: the menus open over the title screen, the quick menu over the game. */
async function previewScreen(name: string) {
  if (name === 'title') { await showTitle(); return; }
  if (name === 'quickmenu') { play(rt => rt.start()); return; }
  if (name === 'achievement_toast') { // a sample notice: the first achievement, or a stand-in
    const first = normalizeAchievements(game.achievements)[0];
    queueAchievement(first ?? { unlock: 'example', title: 'Example', description: 'What it takes to unlock it.', icon: '', hidden: false, ending: false, toast: true });
    return;
  }
  if (!menus.open) await showTitle(); // a base to go back to; a screen already up is replaced
  switch (name) {
    case 'pause': menus.showPause(); break;
    case 'options': menus.openOptions(); break;
    case 'saves': menus.openSaves('load'); break;
    case 'history': menus.openHistory(timeline.lines()); break;
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
  const m = e.data as { type?: string; file?: string; line?: number; name?: string; value?: unknown } | null;
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
  if (m?.type === 'restart') { play(rt => rt.start()); return; }
  if (m?.type === 'goto' && typeof m.file === 'string' && typeof m.line === 'number') {
    const at = { file: m.file, line: m.line };
    play(rt => rt.restore(at));
  }
});

if (devMode) {
  const events = new EventSource('/__events');
  events.onmessage = e => {
    const msg = JSON.parse(e.data) as { type: string };
    if (msg.type === 'engine') location.reload();
    else if (msg.type === 'content') void load();
  };
}

void load();
