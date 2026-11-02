// Title screen, pause menu, options, save/load and confirm dialogs: DOM screens over the stage, kept on a
// stack so Esc / Back return to the screen underneath. Labels can be translated with `ui.<key>` entries in
// locale/<lang>.json (keys are the data-ui attributes in index.html).

import type { Locale, MusicItem, ChapterItem, AchievementItem } from '../engine/src/index.js';
import type { LineInfo } from './stage-ui.js';
import { choiceSlotCount, choiceSlot, deleteSave, isChoiceSlot, manualSlot, PAGES, readSave, SLOTS_PER_PAGE, type SaveData } from './saves.js';
import { saveSettings, TEXT_INSTANT, type Settings } from './settings.js';
import { getItem, setItem } from './storage.js';
import { autoFocus } from './input.js';
import { $, hue } from './stage-ui.js';

/** The title-screen part of game.json. */
export interface TitleConfig {
  background?: string;
  music?: string;
  showTitle?: boolean;
  align?: 'left' | 'center' | 'right';
  buttons?: string[];
  /** Seconds of black between the title screen and the game (default 0.4). */
  fade?: number;
}
/** The three Auto speeds (seconds to wait after a line), in the order of the options. */
const TIMED_MODES: Settings['timedChoices'][] = ['normal', 'extended', 'off'];
const AUTO_SPEEDS = ['slow', 'normal', 'fast'], AUTO_DELAYS = [3, 1.5, 0.6];
const nearest = (list: number[], v: number) => list.reduce((best, x, i) => (Math.abs(x - v) < Math.abs(list[best] - v) ? i : best), 0);
const DEFAULT_BUTTONS = ['new_game', 'continue', 'load', 'gallery', 'music_room', 'chapters', 'achievements', 'options'];

/** A gallery entry as the gallery screen shows it. */
/** An achievement as the achievements screen shows it, with its icon's URL and file under assets/ (null and '' without one). */
export interface AchievementRow extends AchievementItem { iconUrl: string | null; iconFile: string }

export interface GalleryItem { name: string; title: string; url: string | null; /** the picture's file under assets/ ('' when there is none) */ file: string; unlocked: boolean }

export interface MenuActions {
  newGame(): void;
  continueGame(): void;
  toTitle(): void;
  isPlaying(): boolean;
  galleryItems(): GalleryItem[];
  musicItems(): MusicItem[];
  /** Play a music room track (null: back to the title screen's music). */
  playTrack(name: string | null): void;
  chapterItems(): ChapterItem[];
  startChapter(label: string): void;
  achievementItems(): AchievementRow[];
  /** Save the current moment into `slot`; false when it could not be stored. */
  save(slot: string): Promise<boolean>;
  load(slot: string): void;
  /** A setting changed; `lang` is true when the language did. */
  changed(lang: boolean): void;
  /** A screen opened or the last one closed. */
  screens(open: boolean): void;
}

const titleEl = $('title'), pauseEl = $('pause'), optionsEl = $('options'), savesEl = $('saves'), confirmEl = $('confirm');
const historyEl = $('history'), historyList = $('historyList');
const galleryEl = $('gallery'), galleryGrid = $('galleryGrid'), galleryCount = $('galleryCount');
const musicEl = $('musicRoom'), musicList = $('musicList'), musicCount = $('musicCount'), musicNow = $('musicNow');
const chaptersEl = $('chapters'), chapterList = $('chapterList'), chapterCount = $('chapterCount');
const achievementsEl = $('achievements'), achievementList = $('achievementList'), achievementCount = $('achievementCount');
const viewerEl = $('viewer'), viewerImg = $('viewerImg'), viewerTitle = $('viewerTitle');
const SCREENS = [titleEl, pauseEl, optionsEl, savesEl, confirmEl, historyEl, galleryEl, viewerEl, musicEl, chaptersEl, achievementsEl];
const gameTitle = $('gameTitle'), continueBtn = $<HTMLButtonElement>('continue'), continueInfo = $('continueInfo');
const titleNav = $('titleNav');
const titleButtons: Record<string, HTMLElement> = {
  new_game: $('newGame'), continue: continueBtn, load: $('titleLoad'), gallery: $('titleGallery'), music_room: $('titleMusic'), chapters: $('titleChapters'), achievements: $('titleAchievements'), options: $('titleOptions'),
};
const sliders = {
  master: $<HTMLInputElement>('optMaster'),
  music: $<HTMLInputElement>('optMusic'),
  sound: $<HTMLInputElement>('optSound'),
  voice: $<HTMLInputElement>('optVoice'),
  textSpeed: $<HTMLInputElement>('optText'),
  textSize: $<HTMLInputElement>('optSize'),
  boxOpacity: $<HTMLInputElement>('optBox'),
};
const blipsEl = $<HTMLSelectElement>('optBlips'), motionEl = $<HTMLSelectElement>('optMotion'), captionsEl = $<HTMLSelectElement>('optCaptions'), timedEl = $<HTMLSelectElement>('optTimed'), skipEl = $<HTMLSelectElement>('optSkip'), autoEl = $<HTMLSelectElement>('optAuto'), langEl = $<HTMLSelectElement>('optLang'), voiceLangEl = $<HTMLSelectElement>('optVoiceLang'), voiceLangLabel = $('optVoiceLangLabel'), fullBtn = $<HTMLButtonElement>('optFull');
const optTabs = [...document.querySelectorAll<HTMLButtonElement>('.opt-tabs [data-tab]')];
const optPages = [...document.querySelectorAll<HTMLElement>('.opt-page')];
const slotGrid = $('slotGrid'), pagesEl = $('savePages'), savesTitle = $('savesTitle'), savesNote = $('savesNote');

/** Same look as the renderer's placeholder backgrounds, for art that does not exist yet. */
const placeholder = (name: string) => {
  const h = hue(name);
  return `linear-gradient(165deg, hsl(${h} 32% 24%), hsl(${(h + 45) % 360} 38% 11%))`;
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

export class Menus {
  private stack: HTMLElement[] = [];
  private mode: 'save' | 'load' = 'load';
  private page = 0; // -1 = autosave, -2 = quick save (Load only)
  private onConfirm: (() => void) | null = null;
  private viewing: GalleryItem[] = [];
  private viewIndex = 0;
  private tab = 0;
  private langs: string[] = [];
  private voiceLangs: string[] = [];
  /** The tab of the project's `screen options` ('' = its first). */
  private customTab = '';
  private deleting = false; // the project's saves screen: the next slot picked is deleted
  /** The settings or the tab changed: the project's `screen options`, if it has one, redraws. */
  onValues: () => void = () => {};

  constructor(private settings: Settings, private act: MenuActions) {
    for (const s of SCREENS) {
      // Clicks on a screen must not reach the stage (which advances the story).
      s.addEventListener('click', e => e.stopPropagation());
      s.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); });
    }
    const on = (id: string, fn: () => void) => $(id).addEventListener('click', fn);
    on('newGame', () => act.newGame());
    on('continue', () => act.continueGame());
    on('titleLoad', () => this.showSaves('load'));
    on('titleOptions', () => this.openOptions());
    on('resume', () => this.hideAll());
    on('pauseSave', () => this.showSaves('save'));
    on('pauseLoad', () => this.showSaves('load'));
    on('pauseOptions', () => this.openOptions());
    on('toTitle', () => this.confirm('confirm_title', () => act.toTitle()));
    on('optBack', () => this.back());
    on('savesBack', () => this.back());
    on('historyBack', () => this.back());
    on('titleGallery', () => this.openGallery());
    on('galleryBack', () => this.back());
    on('titleMusic', () => this.openMusicRoom());
    on('musicBack', () => this.back());
    on('musicStop', () => this.playTrack(null));
    on('titleChapters', () => this.openChapters());
    on('chaptersBack', () => this.back());
    on('titleAchievements', () => this.openAchievements());
    on('achievementsBack', () => this.back());
    viewerEl.addEventListener('click', () => { if (viewerEl.dataset.custom !== 'true') this.back(); });
    viewerEl.addEventListener('keydown', e => {
      if (viewerEl.dataset.custom === 'true') return; // the project's screen takes the arrows as focus moves
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); this.showImage(this.viewIndex + (e.key === 'ArrowRight' ? 1 : -1)); }
    });
    on('confirmYes', () => { const fn = this.onConfirm; this.back(); fn?.(); });
    on('confirmNo', () => this.back());

    for (const [key, input] of Object.entries(sliders) as [keyof typeof sliders, HTMLInputElement][]) {
      input.value = String(settings[key]);
      input.addEventListener('input', () => { settings[key] = Number(input.value); this.commit(false); });
    }
    autoEl.value = String(settings.autoDelay);
    if (autoEl.value === '') autoEl.value = '1.5';
    blipsEl.value = settings.textSounds ? 'on' : 'off';
    blipsEl.addEventListener('change', () => { settings.textSounds = blipsEl.value === 'on'; this.commit(false); });
    motionEl.value = settings.reduceMotion ? 'on' : 'off';
    motionEl.addEventListener('change', () => { settings.reduceMotion = motionEl.value === 'on'; this.commit(false); });
    captionsEl.value = settings.captions ? 'on' : 'off';
    captionsEl.addEventListener('change', () => { settings.captions = captionsEl.value === 'on'; this.commit(false); });
    timedEl.value = settings.timedChoices;
    timedEl.addEventListener('change', () => { settings.timedChoices = timedEl.value as Settings['timedChoices']; this.commit(false); });
    skipEl.value = settings.skipAll ? 'all' : 'read';
    skipEl.addEventListener('change', () => { settings.skipAll = skipEl.value === 'all'; this.commit(false); });
    autoEl.addEventListener('change', () => { settings.autoDelay = Number(autoEl.value); this.commit(false); });
    langEl.addEventListener('change', () => { settings.lang = langEl.value; this.commit(true); });
    voiceLangEl.addEventListener('change', () => { settings.voiceLang = voiceLangEl.value; this.commit(false); });
    fullBtn.hidden = !document.fullscreenEnabled;
    fullBtn.addEventListener('click', () => this.toggleFullscreen());
    optTabs.forEach((b, n) => b.addEventListener('click', () => this.showTab(n)));
    this.showTab(0);
    this.page = Math.min(PAGES - 1, Math.max(0, Number(getItem('savePage')) || 0));
    this.showValues();
  }

  get open() { return this.stack.length > 0; }
  /** The screen on top (null while playing); where keyboard and pad focus moves. */
  get top(): HTMLElement | null { return this.stack.at(-1) ?? null; }

  private commit(lang: boolean, redraw = true) {
    saveSettings(this.settings);
    this.showValues();
    this.act.changed(lang);
    if (redraw) this.onValues();
  }

  toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  }

  /** The settings as the variables of a project's `screen options`: numbers for the sliders, a word for the others. */
  optionValues(): Record<string, string | number> {
    const s = this.settings, onOff = (b: boolean) => (b ? 'on' : 'off');
    return {
      master: s.master, music: s.music, sound: s.sound, voice: s.voice, text_speed: s.textSpeed, text_size: s.textSize, box_opacity: s.boxOpacity,
      text_sounds: onOff(s.textSounds), auto_speed: AUTO_SPEEDS[nearest(AUTO_DELAYS, s.autoDelay)], skip: s.skipAll ? 'all' : 'read',
      reduce_motion: onOff(s.reduceMotion), captions: onOff(s.captions), timed_choices: s.timedChoices, language: s.lang, voice_language: s.voiceLang || 'text', tab: this.customTab,
    };
  }

  /** A slider of the project's options screen moved (the screen is not redrawn: the slider is already where the player put it). */
  setNumber(setting: string, v: number) {
    const keys: Record<string, 'master' | 'music' | 'sound' | 'voice' | 'textSpeed' | 'textSize' | 'boxOpacity'> = {
      master: 'master', music: 'music', sound: 'sound', voice: 'voice', text_speed: 'textSpeed', text_size: 'textSize', box_opacity: 'boxOpacity',
    };
    const key = keys[setting];
    if (!key || !Number.isFinite(v)) return;
    this.settings[key] = v;
    this.commit(false, false);
  }

  /** `action cycle` on the project's options screen: the next value of a setting that has a few. */
  cycle(setting: string) {
    const s = this.settings;
    switch (setting) {
      case 'text_sounds': s.textSounds = !s.textSounds; break;
      case 'auto_speed': s.autoDelay = AUTO_DELAYS[(nearest(AUTO_DELAYS, s.autoDelay) + 1) % AUTO_DELAYS.length]; break;
      case 'skip': s.skipAll = !s.skipAll; break;
      case 'reduce_motion': s.reduceMotion = !s.reduceMotion; break;
      case 'captions': s.captions = !s.captions; break;
      case 'timed_choices': s.timedChoices = TIMED_MODES[(TIMED_MODES.indexOf(s.timedChoices) + 1) % TIMED_MODES.length]; break;
      case 'language': {
        if (this.langs.length < 2) return;
        s.lang = this.langs[(Math.max(0, this.langs.indexOf(s.lang)) + 1) % this.langs.length];
        this.commit(true);
        return;
      }
      case 'voice_language': {
        if (!this.voiceLangs.length) return;
        const all = ['', ...this.voiceLangs];
        s.voiceLang = all[(Math.max(0, all.indexOf(s.voiceLang)) + 1) % all.length];
        break;
      }
      default: return;
    }
    this.commit(false);
  }

  /** `action tab` on the project's options screen. */
  setTab(name: string) { this.customTab = name; this.onValues(); }

  /** `action close` on the project's options screen: the same as Back. */
  closeOptions() { if (this.stack.at(-1) === optionsEl) this.back(); }

  private showValues() {
    for (const k of ['master', 'music', 'sound', 'voice'] as const) $(`${sliders[k].id}Out`).textContent = `${Math.round(this.settings[k] * 100)}%`;
    $('optSizeOut').textContent = `${Math.round(this.settings.textSize * 100)}%`;
    $('optBoxOut').textContent = `${Math.round(this.settings.boxOpacity * 100)}%`;
    $('optTextOut').textContent = this.settings.textSpeed >= TEXT_INSTANT ? this.label('instant') : String(this.settings.textSpeed);
  }

  /** A translated word kept in a hidden [data-ui] element (see index.html). */
  private label(key: string): string {
    return document.querySelector(`[data-ui="${key}"]`)?.textContent ?? key;
  }

  /**
   * Translate every [data-ui] element. The source text is `labels[key]` from game.json, else the HTML text;
   * other languages use `ui.<key>` from their locale table.
   */
  translate(locale: Locale, labels: Record<string, string> = {}) {
    for (const e of document.querySelectorAll<HTMLElement>('[data-ui]')) {
      e.dataset.html ??= e.textContent ?? '';
      e.textContent = locale.t(`ui.${e.dataset.ui}`, labels[e.dataset.ui!] || e.dataset.html);
    }
    this.showValues();
    if (!savesEl.hidden) this.renderSaves();
  }

  /** Apply the title-screen layout from game.json; the extras buttons need entries (`has`, by button name). */
  configure(title: string, c: TitleConfig = {}, has: Record<string, boolean> = {}) {
    gameTitle.textContent = title;
    gameTitle.style.visibility = c.showTitle === false ? 'hidden' : '';
    titleEl.dataset.align = c.align ?? 'center';
    const wanted = (Array.isArray(c.buttons) && c.buttons.length ? c.buttons : DEFAULT_BUTTONS)
      .filter(b => titleButtons[b] && (!(b in has) || has[b]));
    titleNav.replaceChildren(...new Set(wanted.map(b => titleButtons[b])));
  }

  setLanguages(langs: string[], current: string) {
    this.langs = langs;
    langEl.replaceChildren(...langs.map(l => { const o = document.createElement('option'); o.value = o.textContent = l; return o; }));
    langEl.value = current;
  }

  /** The languages the game has voice recordings in; the option to pick one is shown only when there are some. */
  setVoiceLanguages(langs: string[], current: string) {
    this.voiceLangs = langs;
    const same = document.createElement('option');
    same.value = ''; same.textContent = 'Same as text'; same.dataset.ui = 'voice_same'; // translated by the translate() that follows
    voiceLangEl.replaceChildren(same, ...langs.map(l => { const o = document.createElement('option'); o.value = o.textContent = l; return o; }));
    voiceLangEl.value = langs.includes(current) ? current : '';
    voiceLangEl.hidden = voiceLangLabel.hidden = !langs.length;
  }

  // ---- screen stack ----
  private focusIn(screen: HTMLElement) {
    autoFocus(screen.querySelector<HTMLElement>('[autofocus], button:not(:disabled), input, select'));
  }
  private push(screen: HTMLElement) {
    const top = this.stack.at(-1);
    if (top) top.hidden = true;
    this.stack.push(screen);
    screen.hidden = false;
    this.focusIn(screen);
    this.act.screens(true);
  }
  private back() {
    const top = this.stack.pop();
    if (top) top.hidden = true;
    if (top === musicEl) this.act.playTrack(null); // back to the title music
    const prev = this.stack.at(-1);
    if (prev) {
      prev.hidden = false;
      if (prev === titleEl) this.refreshContinue();
      if (prev === savesEl) this.renderSaves();
      this.focusIn(prev);
    }
    this.act.screens(this.open);
  }
  hideAll() {
    for (const s of SCREENS) s.hidden = true;
    this.stack = [];
    this.act.screens(false);
  }

  private continueSave: () => SaveData | null = () => null;
  private refreshContinue() {
    const save = this.continueSave();
    continueBtn.disabled = !save;
    continueInfo.textContent = save?.text ?? '';
  }

  showTitle(newest: () => SaveData | null) {
    this.hideAll();
    this.continueSave = newest;
    this.refreshContinue();
    this.push(titleEl);
  }

  showPause() { this.hideAll(); this.push(pauseEl); }

  /** Esc: go back one screen, close the pause menu, or open it while playing. */
  escape() {
    const top = this.stack.at(-1);
    if (this.stack.length > 1) this.back();
    else if (top === pauseEl) this.hideAll();
    else if (top && top !== titleEl) this.back(); // history, saves or options opened over the game from the quick menu
    else if (!top && this.act.isPlaying()) this.showPause();
  }

  /** Ask a yes/no question (text from the hidden [data-ui=key] label); runs `yes` on Yes. */
  confirm(key: string, yes: () => void) {
    this.onConfirm = yes;
    $('confirmText').textContent = this.label(key);
    this.push(confirmEl);
  }

  // ---- opened from the quick menu (over the game; Back returns to it) ----
  openOptions() { this.showTab(0); this.customTab = ''; this.push(optionsEl); }

  private showTab(i: number) {
    this.tab = (i + optTabs.length) % optTabs.length;
    optTabs.forEach((b, n) => { b.setAttribute('aria-selected', String(n === this.tab)); b.tabIndex = n === this.tab ? 0 : -1; });
    optPages.forEach((p, n) => { p.toggleAttribute('inert', n !== this.tab); });
  }

  /** Switch the options tab (shoulder buttons, or Left/Right on a tab); false when the options are not on top. */
  cycleTab(step: number) {
    if (this.stack.at(-1) !== optionsEl) return false;
    this.showTab(this.tab + step);
    return true;
  }
  openSaves(mode: 'save' | 'load') { this.showSaves(mode); }

  private historyLines: LineInfo[] = [];

  /** The history as the variables and per-line data of a project's `screen history`. */
  historyValues(): { vars: Record<string, string | number | string[]>; entries: Record<string, Record<string, Record<string, string>>> } {
    const ids = this.historyLines.map((_, i) => String(i + 1));
    return {
      vars: { lines: ids, total: ids.length },
      entries: { lines: Object.fromEntries(ids.map(id => { const l = this.historyLines[Number(id) - 1]; return [id, { name: l.name ?? '', text: l.text }]; })) },
    };
  }
  /** `action close` on the project's history screen: the same as Back. */
  closeHistory() { if (this.stack.at(-1) === historyEl) this.back(); }

  openHistory(lines: LineInfo[]) {
    this.historyLines = lines;
    historyList.replaceChildren(...lines.map(l => {
      const li = el('li');
      if (l.name) {
        const who = el('span', 'who', l.name);
        who.style.color = l.color ?? '';
        li.append(who);
      }
      li.append(el('span', 'said', l.text));
      return li;
    }));
    if (!lines.length) historyList.append(el('li', 'empty', this.label('history_empty')));
    this.push(historyEl);
    historyList.scrollTop = historyList.scrollHeight;
  }

  // ---- gallery ----
  /** The tile last viewed on the project's gallery screen (focus returns to it). */
  lastTile = '';
  /** The gallery as the variables and per-tile data of a project's `screen gallery`; locked tiles show the locked word as their title. */
  galleryValues(): { vars: Record<string, string | number | string[]>; entries: Record<string, Record<string, Record<string, string | boolean>>> } {
    const items = this.act.galleryItems();
    const ids = items.map((_, i) => String(i + 1));
    return {
      vars: { tiles: ids, count: items.filter(i => i.unlocked).length, total: items.length },
      entries: { tiles: Object.fromEntries(items.map((item, i) => {
        const title = item.unlocked ? item.title : this.label('locked');
        return [ids[i], { name: title, title, unlocked: item.unlocked, file: item.unlocked ? item.file : '' }];
      })) },
    };
  }
  /** `action tile` on the project's gallery screen: opens the viewer on that tile (a locked one does nothing). */
  pickTile(id: string) {
    const items = this.act.galleryItems();
    const item = items[Number(id) - 1];
    if (!item?.unlocked) return;
    this.lastTile = id;
    const open = items.filter(i => i.unlocked);
    this.openViewer(open, open.indexOf(item));
  }
  /** `action close` on the project's gallery screen: the same as Back. */
  closeGallery() { if (this.stack.at(-1) === galleryEl) this.back(); }
  /** `action gallery` on a project's title screen. */
  showGallery() { this.openGallery(); }

  private openGallery() {
    const items = this.act.galleryItems();
    const open = items.filter(i => i.unlocked);
    galleryCount.textContent = `${open.length} / ${items.length}`;
    galleryGrid.replaceChildren(...items.map(item => {
      const b = el('button', 'tile');
      b.type = 'button';
      const thumb = el('div', 'thumb');
      if (!item.unlocked) { thumb.textContent = '?'; b.disabled = true; }
      else if (item.url) thumb.style.backgroundImage = `url("${item.url}")`;
      else { thumb.style.background = placeholder(item.name); thumb.textContent = item.name; thumb.classList.add('named'); }
      b.append(thumb, el('div', 'tile-title', item.unlocked ? item.title : this.label('locked')));
      b.addEventListener('click', () => this.openViewer(open, open.indexOf(item)));
      return b;
    }));
    this.push(galleryEl);
  }

  private openViewer(items: GalleryItem[], index: number) {
    this.viewing = items;
    this.push(viewerEl);
    this.showImage(index);
    viewerEl.focus();
  }

  private showImage(index: number) {
    if (!this.viewing.length) return;
    this.viewIndex = (index + this.viewing.length) % this.viewing.length;
    const item = this.viewing[this.viewIndex];
    viewerImg.style.background = item.url ? `#000 url("${item.url}") center / cover no-repeat` : placeholder(item.name);
    viewerTitle.textContent = this.viewing.length > 1 ? `${item.title}  ${this.viewIndex + 1} / ${this.viewing.length}` : item.title;
    this.onViewer();
  }

  /** The picture on show changed: the project's `screen viewer`, if it has one, redraws. */
  onViewer: () => void = () => {};
  /** The picture on show as the variables of a project's `screen viewer`. */
  viewerValues(): Record<string, string | number> {
    const item = this.viewing[this.viewIndex];
    return { file: item?.file ?? '', title: item?.title ?? '', position: this.viewIndex + 1, total: this.viewing.length };
  }
  /** `action next` / `action prev` on the project's viewer screen: the neighbouring unlocked picture, wrapping around like the arrow keys. */
  stepViewer(delta: number) { if (this.stack.at(-1) === viewerEl) this.showImage(this.viewIndex + delta); }
  /** `action close` on the project's viewer screen: back to the gallery. */
  closeViewer() { if (this.stack.at(-1) === viewerEl) this.back(); }

  // ---- music room and chapter select ----
  private nowPlaying: string | null = null;
  /** The music room's playing track changed: the project's `screen music`, if it has one, redraws. */
  onMusic: () => void = () => {};
  /** The track last picked on the project's music screen (focus returns to it). */
  lastTrack = '';
  private playTrack(name: string | null) {
    this.nowPlaying = name;
    this.act.playTrack(name);
    this.renderMusic();
  }

  /** The music room as the variables and per-track data of a project's `screen music`; locked tracks show the locked word as their title. */
  musicValues(): { vars: Record<string, string | number | string[]>; entries: Record<string, Record<string, Record<string, string | boolean>>> } {
    const items = this.act.musicItems();
    const ids = items.map((_, i) => String(i + 1));
    const playing = items.find(i => i.track === this.nowPlaying);
    return {
      vars: { tracks: ids, count: items.filter(i => i.unlocked).length, total: items.length, now: this.nowPlaying ? playing?.title ?? this.nowPlaying : '' },
      entries: { tracks: Object.fromEntries(items.map((item, i) => {
        const title = item.unlocked ? item.title : this.label('locked');
        return [ids[i], { name: title, title, unlocked: item.unlocked, playing: item.unlocked && item.track === this.nowPlaying }];
      })) },
    };
  }
  /** `action track` on the project's music screen: plays that track (a locked one does nothing). */
  pickTrack(id: string) {
    const item = this.act.musicItems()[Number(id) - 1];
    if (!item?.unlocked) return;
    this.lastTrack = id;
    this.playTrack(item.track);
  }
  /** `action stop` on the project's music screen: back to the title music. */
  stopMusic() { this.playTrack(null); }
  /** `action close` on the project's music screen: the same as Back. */
  closeMusic() { if (this.stack.at(-1) === musicEl) this.back(); }
  /** `action music` on a project's title screen. */
  showMusic() { this.openMusicRoom(); }

  private openMusicRoom() {
    this.nowPlaying = null;
    this.lastTrack = '';
    this.renderMusic();
    this.push(musicEl);
  }

  private renderMusic() {
    this.onMusic();
    const items = this.act.musicItems();
    musicCount.textContent = `${items.filter(i => i.unlocked).length} / ${items.length}`;
    musicNow.textContent = this.nowPlaying ? `${this.label('now_playing')}: ${items.find(i => i.track === this.nowPlaying)?.title ?? this.nowPlaying}` : '';
    musicList.replaceChildren(...items.map(item => {
      const b = el('button', 'row', item.unlocked ? item.title : this.label('locked'));
      b.type = 'button';
      b.disabled = !item.unlocked;
      if (item.track === this.nowPlaying) b.setAttribute('aria-current', 'true');
      b.addEventListener('click', () => this.playTrack(item.track));
      return b;
    }));
  }

  /** The chapter last picked on the project's chapter screen (focus returns to it). */
  lastChapter = '';
  /** The chapter select as the variables and per-chapter data of a project's `screen chapters`; locked chapters show the locked word as their title. */
  chaptersValues(): { vars: Record<string, string | number | string[]>; entries: Record<string, Record<string, Record<string, string | boolean>>> } {
    const items = this.act.chapterItems();
    const ids = items.map((_, i) => String(i + 1));
    return {
      vars: { chapters: ids, count: items.filter(i => i.unlocked).length, total: items.length },
      entries: { chapters: Object.fromEntries(items.map((item, i) => {
        const title = item.unlocked ? item.title : this.label('locked');
        return [ids[i], { name: title, title, unlocked: item.unlocked }];
      })) },
    };
  }
  /** `action chapter` on the project's chapter screen: starts the story at that chapter (a locked one does nothing). */
  pickChapter(id: string) {
    const item = this.act.chapterItems()[Number(id) - 1];
    if (!item?.unlocked) return;
    this.lastChapter = id;
    this.act.startChapter(item.label);
  }
  /** `action close` on the project's chapter screen: the same as Back. */
  closeChapters() { if (this.stack.at(-1) === chaptersEl) this.back(); }
  /** `action chapters` on a project's title screen. */
  showChapters() { this.openChapters(); }

  private openChapters() {
    const items = this.act.chapterItems();
    chapterCount.textContent = `${items.filter(i => i.unlocked).length} / ${items.length}`;
    chapterList.replaceChildren(...items.map(item => {
      const b = el('button', 'row', item.unlocked ? item.title : this.label('locked'));
      b.type = 'button';
      b.disabled = !item.unlocked;
      b.addEventListener('click', () => this.act.startChapter(item.label));
      return b;
    }));
    this.push(chaptersEl);
  }

  // ---- achievements and endings ----
  /**
   * The achievements list as the variables and per-entry data of a project's `screen achievements`: endings and achievements in two lists. A hidden
   * one that is still locked shows the hidden word as its title, with no description or icon.
   */
  achievementsValues(): { vars: Record<string, string | number | string[]>; entries: Record<string, Record<string, Record<string, string | boolean>>> } {
    const items = this.act.achievementItems();
    const endings = items.filter(i => i.ending), others = items.filter(i => !i.ending);
    const entry = (item: AchievementRow) => {
      const masked = item.hidden && !item.unlocked;
      const title = masked ? this.label('hidden_achievement') : item.title;
      return { name: title, title, description: masked ? '' : item.description, icon: masked ? '' : item.iconFile, unlocked: item.unlocked, hidden: item.hidden, ending: item.ending };
    };
    const ids = (list: AchievementRow[]) => list.map((_, i) => String(i + 1));
    return {
      vars: {
        achievements: ids(others), endings: ids(endings),
        count: others.filter(i => i.unlocked).length, total: others.length,
        endings_count: endings.filter(i => i.unlocked).length, endings_total: endings.length,
      },
      entries: {
        achievements: Object.fromEntries(others.map((item, i) => [String(i + 1), entry(item)])),
        endings: Object.fromEntries(endings.map((item, i) => [String(i + 1), entry(item)])),
      },
    };
  }
  /** `action close` on the project's achievements screen: the same as Back. */
  closeAchievements() { if (this.stack.at(-1) === achievementsEl) this.back(); }
  /** `action achievements` on a project's title screen. */
  showAchievements() { this.openAchievements(); }

  private openAchievements() {
    const items = this.act.achievementItems();
    const endings = items.filter(i => i.ending), others = items.filter(i => !i.ending);
    const count = (list: AchievementRow[]) => `${list.filter(i => i.unlocked).length} / ${list.length}`;
    achievementCount.textContent = [endings.length ? `${this.label('endings')} ${count(endings)}` : '', others.length ? `${this.label('achievements')} ${count(others)}` : ''].filter(Boolean).join(' · ');
    const row = (item: AchievementRow) => {
      const masked = item.hidden && !item.unlocked;
      const r = el('div', 'ach-row');
      r.dataset.locked = String(!item.unlocked);
      const icon = el('div', 'ach-icon');
      if (item.iconUrl && !masked) icon.style.backgroundImage = `url("${item.iconUrl}")`;
      const text = el('div');
      text.append(el('b', '', masked ? this.label('hidden_achievement') : item.title));
      if (item.description && !masked) text.append(el('span', '', item.description));
      r.append(icon, text);
      return r;
    };
    const section = (key: string, list: AchievementRow[]) => (list.length && endings.length && others.length ? [el('h3', '', this.label(key))] : []).concat(list.map(row));
    achievementList.replaceChildren(...section('endings', endings), ...section('achievements', others));
    this.push(achievementsEl);
  }

  // ---- save / load ----
  private showSaves(mode: 'save' | 'load') {
    this.mode = mode;
    this.deleting = false;
    if (mode === 'save' && this.page < 0) this.page = 0;
    savesNote.textContent = '';
    this.renderSaves();
    this.push(savesEl);
  }

  private savePages(): number[] {
    const numbered = Array.from({ length: PAGES }, (_, i) => i);
    return this.mode === 'load' ? [-1, -2, -3, ...numbered] : numbered;
  }
  private saveSlots(): string[] {
    return this.page === -1 ? ['auto'] : this.page === -2 ? ['quick']
      : this.page === -3 ? Array.from({ length: choiceSlotCount() }, (_, i) => choiceSlot(i)) : Array.from({ length: SLOTS_PER_PAGE }, (_, i) => manualSlot(this.page, i));
  }
  private slotTitle(slot: string): string {
    return slot === 'auto' || slot === 'quick' ? this.label(slot) : isChoiceSlot(slot) ? `${this.label('choice')} ${slot.slice(7)}` : `${this.label('slot')} ${slot}`;
  }
  /** Page ids are `page1`.., `pageauto`, `pagequick`, `pagechoice`: never equal to a slot id, so every element id on the screen stays unique. */
  private pageId(p: number): string { return `page${p === -1 ? 'auto' : p === -2 ? 'quick' : p === -3 ? 'choice' : p + 1}`; }

  /** The save/load screen as the variables and per-entry data of a project's `screen saves`. */
  savesValues(): { vars: Record<string, string | boolean | string[]>; entries: Record<string, Record<string, Record<string, string | boolean>>> } {
    const special: Record<number, string> = { [-1]: 'auto_short', [-2]: 'quick_short', [-3]: 'choice_short' };
    const pages = this.savePages(), slots = this.saveSlots();
    return {
      vars: { mode: this.mode, page: this.pageId(this.page), pages: pages.map(p => this.pageId(p)), slots, deleting: this.deleting },
      entries: {
        pages: Object.fromEntries(pages.map(p => [this.pageId(p), { name: p < 0 ? this.label(special[p]) : String(p + 1) }])),
        slots: Object.fromEntries(slots.map(slot => {
          const data = readSave(slot);
          return [slot, {
            title: this.slotTitle(slot),
            when: data ? new Date(data.time).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '',
            text: data ? (data.name ? `${data.name}: ${data.text}` : data.text) : this.label('empty_slot'),
            empty: !data,
          }];
        })),
      },
    };
  }

  /** `action page` on the project's saves screen: id is the page id. */
  setPage(id: string) {
    const p = this.savePages().find(q => this.pageId(q) === id);
    if (p === undefined) return;
    this.page = p;
    setItem('savePage', String(Math.max(p, 0)));
    this.renderSaves();
  }
  /** `action delete`: the next slot picked is deleted instead of saved or loaded. */
  toggleDelete() { this.deleting = !this.deleting; this.renderSaves(); }
  /** `action slot`: the same as clicking that slot on the stock screen (or deleting it, in delete mode). */
  pickSlot(slot: string) {
    if (this.deleting) {
      if (readSave(slot) && slot !== 'auto' && slot !== 'quick' && !isChoiceSlot(slot)) this.confirm('confirm_delete', () => { deleteSave(slot); this.renderSaves(); });
      return;
    }
    this.activateSlot(slot, readSave(slot));
  }
  /** `action close` on the project's saves screen: the same as Back. */
  closeSaves() { if (this.stack.at(-1) === savesEl) this.back(); }
  onSaves: () => void = () => {};

  private renderSaves() {
    savesTitle.textContent = this.label(this.mode === 'save' ? 'save' : 'load');
    this.onSaves();
    const pages = this.savePages();
    const special: Record<number, [string, string]> = { [-1]: ['auto_short', 'auto'], [-2]: ['quick_short', 'quick'], [-3]: ['choice_short', 'choice_saves'] };
    pagesEl.replaceChildren(...pages.map(p => {
      const b = el('button', '', p < 0 ? this.label(special[p][0]) : String(p + 1));
      b.type = 'button';
      if (p === this.page) b.setAttribute('aria-current', 'page');
      b.setAttribute('aria-label', p < 0 ? this.label(special[p][1]) : `${this.label('page')} ${p + 1}`);
      b.addEventListener('click', () => {
        this.page = p;
        setItem('savePage', String(Math.max(p, 0)));
        this.renderSaves();
      });
      return b;
    }));
    slotGrid.replaceChildren(...this.saveSlots().map(slot => this.slotCard(slot)));
  }

  /** Save into the slot (asking before overwriting) or load it (asking first while a game is running). */
  private activateSlot(slot: string, data: SaveData | null) {
    if (this.mode === 'save') {
      const write = async () => {
        const ok = await this.act.save(slot);
        savesNote.textContent = ok ? '' : this.label('save_failed');
        this.renderSaves();
      };
      if (data) this.confirm('confirm_overwrite', () => void write());
      else void write();
    } else if (data) {
      if (this.act.isPlaying()) this.confirm('confirm_load', () => this.act.load(slot));
      else this.act.load(slot);
    }
  }

  private slotCard(slot: string): HTMLElement {
    const data = readSave(slot);
    const card = el('div', 'slot');
    const main = el('button', 'slot-main');
    main.type = 'button';
    const thumb = el('div', 'thumb');
    if (data?.thumb) thumb.style.backgroundImage = `url("${data.thumb}")`;
    else thumb.textContent = data ? '' : this.label('empty_slot');
    const head = el('div', 'slot-head', this.slotTitle(slot));
    if (data) head.append(el('span', 'when', new Date(data.time).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })));
    const line = el('div', 'line', data ? (data.name ? `${data.name}: ${data.text}` : data.text) : '');
    main.append(thumb, head, line);
    main.disabled = this.mode === 'load' && !data;
    main.setAttribute('aria-label', `${head.textContent}. ${data ? line.textContent : this.label('empty_slot')}`);
    main.addEventListener('click', () => this.activateSlot(slot, data));
    card.append(main);
    if (data && slot !== 'auto' && slot !== 'quick' && !isChoiceSlot(slot)) {
      const del = el('button', 'del', '×');
      del.type = 'button';
      del.title = del.ariaLabel = this.label('delete');
      del.addEventListener('click', () => this.confirm('confirm_delete', () => { deleteSave(slot); this.renderSaves(); }));
      card.append(del);
    }
    return card;
  }
}
