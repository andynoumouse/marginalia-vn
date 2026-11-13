// The custom-screen wiring of the game shell: for each menu screen (title, pause, options, saves, history, gallery,
// viewer, music room, chapters, achievements) the project's `screen` view is rebuilt whenever the screen's element is
// shown or hidden or its menu values change, and the renderer's action callbacks are routed to `Menus`.

import type { Runtime } from '../engine/src/index.js';
import type { Menus } from './menus.js';
import type { PixiRenderer } from './pixi-renderer.js';
import { newestSave } from './saves.js';
import { $ } from './stage-ui.js';
import type { TitleConfig } from './menus.js';

/** The part of game.json the title screen reads. */
interface TitleGame { title?: string; titleScreen?: TitleConfig }

export interface ScreenSyncHost {
  menus: Menus;
  renderer: PixiRenderer;
  runtime(): Runtime | null;
  game(): TitleGame;
  /** How many entries each optional title button would open (0 hides the button). */
  counts(): { gallery: number; music: number; chapters: number; achievements: number };
  showTitle(): void;
}

export function initScreenSync(host: ScreenSyncHost) {
  const { menus, renderer } = host;
  const watch = (el: HTMLElement, sync: () => void) => new MutationObserver(sync).observe(el, { attributes: true, attributeFilter: ['hidden'] });

  /** The title screen (the project's `screen title`, else the starter) is drawn while its menu is up (hidden behind the saves or options opened over it). */
  const titleEl = $('title');
  /** game.json `titleScreen.buttons`, when it lists some: the optional buttons (gallery, music room, chapters, achievements, continue) the starter shows. */
  const titleWants = (button: string) => {
    const buttons = host.game().titleScreen?.buttons;
    return !Array.isArray(buttons) || !buttons.length || buttons.includes(button);
  };
  function syncTitle() {
    const game = host.game();
    const counts = host.counts();
    const has = (button: string, entries: number) => titleWants(button) && entries > 0;
    const newest = newestSave();
    const view = host.runtime()?.titleView(!!newest && titleWants('continue'), has('gallery', counts.gallery), has('music_room', counts.music),
      has('chapters', counts.chapters), has('achievements', counts.achievements), game.title ?? 'Untitled', game.titleScreen?.showTitle !== false, newest?.text ?? '') ?? null;
    titleEl.dataset.custom = String(!!view);
    // Back from a screen the title opened lands on its button (UX round PI-7). Otherwise, with a save to go on from, Enter lands on
    // Continue, not on New game, which starts over (UX round PC-3).
    const goOn = view?.parts.find(p => 'act' in p && p.act === 'continue' && p.enabled);
    void renderer.title(view && !titleEl.hidden ? view : null, false, menus.returnId(titleEl) || (goOn && 'id' in goOn ? goOn.id : ''));
  }
  watch(titleEl, syncTitle);
  const titleActions: Record<string, () => void> = {
    start: () => menus.act.newGame(),
    continue: () => menus.act.continueGame(),
    load: () => menus.openSaves('load'),
    options: () => menus.openOptions(),
    gallery: () => menus.showGallery(),
    music: () => menus.showMusic(),
    chapters: () => menus.showChapters(),
    achievements: () => menus.showAchievements(),
    quit: () => window.close(),
  };

  /** The pause menu (the project's `screen pause`, else the starter), the same way. */
  const pauseEl = $('pause');
  function syncPause() {
    const view = host.runtime()?.pauseView() ?? null;
    pauseEl.dataset.custom = String(!!view);
    void renderer.pause(view && !pauseEl.hidden ? view : null, menus.returnId(pauseEl));
  }
  watch(pauseEl, syncPause);
  const pauseActions: Record<string, () => void> = {
    resume: () => menus.hideAll(),
    save: () => menus.openSaves('save'),
    load: () => menus.openSaves('load'),
    options: () => menus.openOptions(),
    title: () => menus.confirm('confirm_title', () => host.showTitle()),
  };

  /** The project's `screen options` replaces the default options: redrawn whenever the screen opens or a setting or the tab changes. */
  const optionsEl = $('options');
  function syncOptions() {
    const lists = menus.optionLists();
    const view = host.runtime()?.optionsView({ ...menus.optionValues(), ...lists.vars }, lists.entries) ?? null;
    optionsEl.dataset.custom = String(!!view);
    void renderer.options(view && !optionsEl.hidden ? view : null);
  }
  watch(optionsEl, syncOptions);
  menus.onValues = syncOptions;

  /** The project's `screen saves` replaces the default save/load screen: redrawn whenever the screen opens or its page, mode or slots change. */
  const savesEl = $('saves');
  function syncSaves() {
    const { vars, entries } = menus.savesValues();
    const view = host.runtime()?.savesView(vars, entries) ?? null;
    savesEl.dataset.custom = String(!!view);
    void renderer.saves(view && !savesEl.hidden ? view : null);
  }
  watch(savesEl, syncSaves);
  menus.onSaves = syncSaves;
  renderer.slots.onAction.saves = item => {
    const act = item?.act;
    if (act === 'close') menus.closeSaves();
    else if (act === 'page') menus.setPage(item!.id);
    else if (act === 'slot') menus.pickSlot(item!.id);
    else if (act === 'delete') menus.toggleDelete();
    else if (act === 'remove') menus.removeSlot(item!.id.slice(0, item!.id.lastIndexOf('.')));
    else if (act === 'rename') menus.renameSlot(item!.id.slice(0, item!.id.lastIndexOf('.')));
  };

  /** The history screen (the project's `screen history`, else the starter): redrawn when it opens. */
  const historyEl = $('history');
  function syncHistory() {
    const { vars, entries } = menus.historyValues();
    const view = host.runtime()?.historyView(vars, entries) ?? null;
    historyEl.dataset.custom = String(!!view);
    void renderer.history(view && !historyEl.hidden ? view : null);
  }
  watch(historyEl, syncHistory);
  renderer.slots.onAction.history = item => {
    if (item?.act === 'close') menus.closeHistory();
    else if (item?.act === 'line') menus.pickLine(item.id);
    else if (item?.act === 'voice') menus.replayLine(item.id.slice(0, item.id.lastIndexOf('.')));
  };

  /** The project's `screen gallery` replaces the default gallery: drawn when it opens (and again when the viewer closes). */
  const galleryEl = $('gallery');
  function syncGallery() {
    const { vars, entries } = menus.galleryValues();
    const view = host.runtime()?.galleryView(vars, entries) ?? null;
    galleryEl.dataset.custom = String(!!view);
    void renderer.gallery(view && !galleryEl.hidden ? view : null, menus.lastTile);
  }
  watch(galleryEl, syncGallery);
  renderer.slots.onAction.gallery = item => {
    const act = item?.act;
    if (act === 'close') menus.closeGallery();
    else if (act === 'tile') menus.pickTile(item!.id);
  };

  /** The viewer screen (the project's `screen viewer`, else the starter) opened from a gallery tile: redrawn when it opens and whenever the picture changes. */
  const viewerEl = $('viewer');
  function syncViewer() {
    const view = host.runtime()?.viewerView(menus.viewerValues()) ?? null;
    viewerEl.dataset.custom = String(!!view);
    void renderer.viewer(view && !viewerEl.hidden ? view : null);
  }
  watch(viewerEl, syncViewer);
  menus.onViewer = syncViewer;
  renderer.slots.onAction.viewer = item => {
    const act = item?.act;
    if (act === 'close') menus.closeViewer();
    else if (act === 'next') menus.stepViewer(1);
    else if (act === 'prev') menus.stepViewer(-1);
  };

  /** The project's `screen music` replaces the default music room: redrawn when it opens and whenever the playing track changes. */
  const musicEl = $('musicRoom');
  function syncMusic() {
    const { vars, entries } = menus.musicValues();
    const view = host.runtime()?.musicView(vars, entries) ?? null;
    musicEl.dataset.custom = String(!!view);
    void renderer.music(view && !musicEl.hidden ? view : null, menus.lastTrack);
  }
  watch(musicEl, syncMusic);
  menus.onMusic = syncMusic;
  renderer.slots.onAction.music = item => {
    const act = item?.act;
    if (act === 'close') menus.closeMusic();
    else if (act === 'stop') menus.stopMusic();
    else if (act === 'track') menus.pickTrack(item!.id);
  };

  /** The project's `screen chapters` replaces the default chapter select. */
  const chaptersEl = $('chapters');
  function syncChapters() {
    const { vars, entries } = menus.chaptersValues();
    const view = host.runtime()?.chaptersView(vars, entries) ?? null;
    chaptersEl.dataset.custom = String(!!view);
    void renderer.chapters(view && !chaptersEl.hidden ? view : null, menus.lastChapter);
  }
  watch(chaptersEl, syncChapters);
  renderer.slots.onAction.chapters = item => {
    const act = item?.act;
    if (act === 'close') menus.closeChapters();
    else if (act === 'chapter') menus.pickChapter(item!.id);
  };

  /** The project's `screen achievements` replaces the default achievements list. */
  const achievementsEl = $('achievements');
  function syncAchievements() {
    const { vars, entries } = menus.achievementsValues();
    const view = host.runtime()?.achievementsView(vars, entries) ?? null;
    achievementsEl.dataset.custom = String(!!view);
    void renderer.achievements(view && !achievementsEl.hidden ? view : null);
  }
  watch(achievementsEl, syncAchievements);
  renderer.slots.onAction.achievements = item => {
    if (item?.act === 'close') menus.closeAchievements();
  };

  renderer.slots.layers.options.onSlider = (setting, value) => menus.setNumber(setting, value);
  renderer.slots.onAction.options = item => {
    const act = item?.act;
    if (act === 'close') menus.closeOptions();
    else if (act === 'fullscreen') menus.toggleFullscreen();
    else if (act === 'reset') menus.resetProgress();
    else if (act === 'tab') menus.setTab(item!.id);
    else if (act === 'cycle') menus.cycle(item!.id);
    else if (act === 'select') menus.toggleSelect(item!.id);
    else if (act === 'choose') menus.choose(item!.id);
  };
  // a click that leaves the open list as it was (the backdrop, another button) closes it; opening, choosing or toggling changes it
  optionsEl.addEventListener('click', () => {
    const before = menus.openSelect;
    if (before) setTimeout(() => { if (menus.openSelect === before) menus.closeSelect(); });
  }, true);
  renderer.slots.onAction.pause = item => {
    const act = item?.act;
    if (item) menus.pressed(pauseEl, item.id);
    if (act) pauseActions[act]?.();
  };
  renderer.slots.onAction.title = item => {
    const act = item?.act;
    if (item) menus.pressed(titleEl, item.id);
    if (act) titleActions[act]?.();
  };

  return {
    titleEl, pauseEl, optionsEl, savesEl, historyEl, galleryEl, viewerEl, musicEl, chaptersEl, achievementsEl,
    syncTitle,
    /** Redraw every custom screen (after a (re)load changed the project's screens). */
    syncAll() {
      syncTitle(); syncPause(); syncOptions(); syncSaves(); syncHistory(); syncGallery(); syncMusic(); syncChapters(); syncAchievements();
    },
  };
}
