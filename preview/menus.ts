// The menu stack (title, pause, options, save/load, the lists) and the confirm and save-name dialogs, over the stage, kept on a
// stack so Esc / Back return to the screen underneath. Labels can be translated with `ui.<key>` entries in
// locale/<lang>.json (keys are the data-ui attributes in index.html).

import { SELECT_SETTINGS, SLIDER_SETTINGS, type CycleSetting, type Locale, type MusicItem, type ChapterItem, type AchievementItem } from '../engine/src/index.js';
import type { LineInfo } from './stage-ui.js';
import { choiceSlotCount, choiceSlot, deleteSave, isChoiceSlot, manualSlot, PAGES, readSave, SAVE_NAME_MAX, SLOTS_PER_PAGE, writeSave, type SaveData } from './saves.js';
import { saveSettings, type Settings } from './settings.js';
import { getItem, setItem } from './storage.js';
import { autoFocus, oskBoard } from './input.js';
import { $ } from './stage-ui.js';

/** The title-screen part of game.json. */
export interface TitleConfig {
  background?: string;
  music?: string;
  showTitle?: boolean;
  /** The optional buttons the starter title screen shows (`gallery`, `music_room`, `chapters`, `achievements`, `continue`); all when left out. */
  buttons?: string[];
  /** Seconds of black between the title screen and the game (default 0.4). */
  fade?: number;
}
/** The three Auto speeds (seconds to wait after a line), in the order of the options. */
/** The Settings field behind each slider of SLIDER_SETTINGS. */
const SLIDER_KEYS: Record<keyof typeof SLIDER_SETTINGS, 'master' | 'music' | 'sound' | 'voice' | 'textSpeed' | 'textSize' | 'boxOpacity'> = {
  master: 'master', music: 'music', sound: 'sound', voice: 'voice', text_speed: 'textSpeed', text_size: 'textSize', box_opacity: 'boxOpacity',
};
/** One cycle setting's behaviour (see Menus.cycleOps). */
interface CycleOp { choices(): { value: string; label: string }[]; cycle(): boolean; pick(value: string): void }
const TIMED_MODES: Settings['timedChoices'][] = ['normal', 'extended', 'off'];
const AUTO_SPEEDS = ['slow', 'normal', 'fast'], AUTO_DELAYS = [3, 1.5, 0.6];
const nearest = (list: number[], v: number) => list.reduce((best, x, i) => (Math.abs(x - v) < Math.abs(list[best] - v) ? i : best), 0);

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
  /** Save the current moment into `slot` under the player's `label` (game.json "saveNames"); false when it could not be stored. */
  save(slot: string, label?: string): Promise<boolean>;
  load(slot: string): void;
  /** Show a short status toast: the `data-ui` label `key`, with `: detail` after it when given. */
  toast(key: string, detail?: string): void;
  /** Clear what the player earned (gallery, music room, chapters, unlocks, read text, persistent values); saves stay. */
  resetProgress(): void;
  /** Roll back to the `n`th line of the history (0-based); the history screen is already closed. */
  rollbackTo(n: number): void;
  /** A history line's recording (by the line's localization id): whether it exists, and play it. */
  hasVoice(id: string | undefined): boolean;
  playVoice(id: string | undefined): void;
  /** A setting changed; `lang` is true when the language did. */
  changed(lang: boolean): void;
  /** A screen opened or the last one closed. */
  screens(open: boolean): void;
}

const titleEl = $('title'), pauseEl = $('pause'), optionsEl = $('options'), savesEl = $('saves'), confirmEl = $('confirm');
const historyEl = $('history');
const galleryEl = $('gallery'), musicEl = $('musicRoom'), chaptersEl = $('chapters'), achievementsEl = $('achievements');
const viewerEl = $('viewer');
const saveNameEl = $('saveName'), saveNameInput = $<HTMLInputElement>('saveNameInput');
const SCREENS = [titleEl, pauseEl, optionsEl, savesEl, confirmEl, saveNameEl, historyEl, galleryEl, viewerEl, musicEl, chaptersEl, achievementsEl];

/** A screen under a dialog, with the layer a project's own version of it is drawn in (`#savesui` for `#saves`). */
const setInert = (screen: HTMLElement, on: boolean) => {
  screen.inert = on;
  const layer = document.getElementById(`${screen.id}ui`);
  if (layer) layer.inert = on;
};

export class Menus {
  private stack: HTMLElement[] = [];
  /** What had focus on each screen when another screen covered it: Back returns there, not to the first button (UX round PI-7). */
  private openers = new Map<HTMLElement, { el: HTMLElement | null; id: string }>();
  /** The element just pressed on a screen whose clicks hand focus back to the story (title, pause), so nothing is focused when it opens the next. */
  private pressedOn: { screen: HTMLElement; id: string } | null = null;
  private mode: 'save' | 'load' = 'load';
  private page = 0; // -1 = autosave, -2 = quick save (Load only)
  private onConfirm: (() => void) | null = null;
  private viewing: GalleryItem[] = [];
  private viewIndex = 0;
  private langs: string[] = [];
  private hasFocus = false;
  private hasTouch = false;
  private voiceLangs: string[] = [];
  private themes: string[] = [];
  /** The tab of the project's `screen options` ('' = its first). */
  private customTab = '';
  private deleting = false; // the project's saves screen: the next slot picked is deleted
  /** The settings or the tab changed: the project's `screen options`, if it has one, redraws. */
  onValues: () => void = () => {};

  constructor(private settings: Settings, readonly act: MenuActions) {
    for (const s of SCREENS) {
      // Clicks on a screen must not reach the stage (which advances the story).
      s.addEventListener('click', e => e.stopPropagation());
      s.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); });
    }
    const on = (id: string, fn: () => void) => $(id).addEventListener('click', fn);
    on('confirmYes', () => { const fn = this.onConfirm; this.back(); fn?.(); });
    on('confirmNo', () => this.back());
    on('saveNameCancel', () => this.back());
    saveNameEl.querySelector('form')!.addEventListener('submit', e => {
      e.preventDefault();
      const fn = this.onName, label = saveNameInput.value.trim();
      this.back();
      fn?.(label);
    });

    this.page = Math.min(PAGES - 1, Math.max(0, Number(getItem('savePage')) || 0));
  }

  get open() { return this.stack.length > 0; }
  /** The screen on top (null while playing); where keyboard and pad focus moves. */
  get top(): HTMLElement | null { return this.stack.at(-1) ?? null; }

  private commit(lang: boolean, redraw = true) {
    saveSettings(this.settings);
    this.act.changed(lang);
    if (redraw) this.onValues();
  }

  toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(e => console.warn('Fullscreen refused:', e));
  }

  /**
   * The settings as the variables of the `screen options`: numbers for the sliders, a word for the others (stable, for conditions), and for each of
   * those a `_word` variable with the same value in the player's language, for showing.
   */
  optionValues(): Record<string, string | number | boolean> {
    const s = this.settings, onOff = (b: boolean) => (b ? 'on' : 'off');
    const auto = nearest(AUTO_DELAYS, s.autoDelay);
    const words: Record<string, string> = {
      text_sounds: this.label(onOff(s.textSounds)), auto_speed: this.label(AUTO_SPEEDS[auto]), skip: this.label(s.skipAll ? 'skip_all' : 'skip_read'),
      reduce_motion: this.label(onOff(s.reduceMotion)), captions: this.label(onOff(s.captions)), announce_lines: this.label(onOff(s.announceLines)), touch_gestures: this.label(onOff(s.touchGestures)),
      speaker_focus: this.label(onOff(s.speakerFocus)), timed_choices: this.label(s.timedChoices === 'normal' ? 'normal' : s.timedChoices === 'extended' ? 'timed_extended' : 'timed_off'),
      language: s.lang, theme: s.theme || this.themes[0] || '', voice_language: s.voiceLang || this.label('voice_same'),
    };
    return {
      master: s.master, music: s.music, sound: s.sound, voice: s.voice, text_speed: s.textSpeed, text_size: s.textSize, box_opacity: s.boxOpacity,
      text_sounds: onOff(s.textSounds), auto_speed: AUTO_SPEEDS[auto], skip: s.skipAll ? 'all' : 'read',
      reduce_motion: onOff(s.reduceMotion), captions: onOff(s.captions), announce_lines: onOff(s.announceLines), touch_gestures: onOff(s.touchGestures), speaker_focus: this.hasFocus ? onOff(s.speakerFocus) : 'none', timed_choices: s.timedChoices, language: s.lang, voice_language: s.voiceLang || 'text', theme: s.theme || this.themes[0] || '', tab: this.customTab,
      ...Object.fromEntries(Object.entries(words).map(([k, v]) => [`${k}_word`, v])),
      has_languages: this.langs.length > 1, has_themes: this.themes.length > 1, has_voice_languages: this.voiceLangs.length > 0, has_fullscreen: document.fullscreenEnabled, has_touch: this.hasTouch,
    };
  }

  /** A slider of the project's options screen moved (the screen is not redrawn: the slider is already where the player put it). */
  setNumber(setting: string, v: number) {
    const key = Object.hasOwn(SLIDER_KEYS, setting) ? SLIDER_KEYS[setting as keyof typeof SLIDER_KEYS] : undefined;
    if (!key || !Number.isFinite(v)) return;
    this.settings[key] = v;
    this.commit(false, false);
  }

  /**
   * What each cycle setting does, one table so the compiler notices a setting added to CYCLE_SETTINGS: `choices` are the values a `select` offers
   * (empty when the game does not offer the setting), `cycle` steps to the next one (false: nothing to step through), `pick` sets a value.
   */
  private cycleOps(): Record<CycleSetting, CycleOp> {
    const s = this.settings;
    const on = () => [{ value: 'on', label: this.label('on') }, { value: 'off', label: this.label('off') }];
    const flag = (key: 'textSounds' | 'reduceMotion' | 'captions' | 'announceLines' | 'touchGestures' | 'speakerFocus', offered = true): CycleOp => ({
      choices: () => (offered ? on() : []),
      cycle: () => { if (!offered) return false; s[key] = !s[key]; return true; },
      pick: v => { s[key] = v === 'on'; },
    });
    return {
      text_sounds: flag('textSounds'), reduce_motion: flag('reduceMotion'), captions: flag('captions'), announce_lines: flag('announceLines'), touch_gestures: flag('touchGestures', this.hasTouch),
      speaker_focus: flag('speakerFocus', this.hasFocus),
      auto_speed: {
        choices: () => AUTO_SPEEDS.map(v => ({ value: v, label: this.label(v) })),
        cycle: () => { s.autoDelay = AUTO_DELAYS[(nearest(AUTO_DELAYS, s.autoDelay) + 1) % AUTO_DELAYS.length]; return true; },
        pick: v => { s.autoDelay = AUTO_DELAYS[AUTO_SPEEDS.indexOf(v)]; },
      },
      skip: {
        choices: () => [{ value: 'read', label: this.label('skip_read') }, { value: 'all', label: this.label('skip_all') }],
        cycle: () => { s.skipAll = !s.skipAll; return true; },
        pick: v => { s.skipAll = v === 'all'; },
      },
      timed_choices: {
        choices: () => [{ value: 'normal', label: this.label('normal') }, { value: 'extended', label: this.label('timed_extended') }, { value: 'off', label: this.label('timed_off') }],
        cycle: () => { s.timedChoices = TIMED_MODES[(TIMED_MODES.indexOf(s.timedChoices) + 1) % TIMED_MODES.length]; return true; },
        pick: v => { s.timedChoices = v as Settings['timedChoices']; },
      },
      language: {
        choices: () => (this.langs.length > 1 ? this.langs.map(v => ({ value: v, label: v })) : []),
        cycle: () => { if (this.langs.length < 2) return false; s.lang = this.langs[(Math.max(0, this.langs.indexOf(s.lang)) + 1) % this.langs.length]; return true; },
        pick: v => { s.lang = v; },
      },
      theme: {
        choices: () => (this.themes.length > 1 ? this.themes.map(v => ({ value: v, label: v })) : []),
        cycle: () => { if (this.themes.length < 2) return false; s.theme = this.themes[(Math.max(0, this.themes.indexOf(s.theme || this.themes[0])) + 1) % this.themes.length]; return true; },
        pick: v => { s.theme = v; },
      },
      voice_language: {
        choices: () => (this.voiceLangs.length ? [{ value: 'text', label: this.label('voice_same') }, ...this.voiceLangs.map(v => ({ value: v, label: v }))] : []),
        cycle: () => {
          if (!this.voiceLangs.length) return false;
          const all = ['', ...this.voiceLangs];
          s.voiceLang = all[(Math.max(0, all.indexOf(s.voiceLang)) + 1) % all.length];
          return true;
        },
        pick: v => { s.voiceLang = v === 'text' ? '' : v; },
      },
    };
  }

  /** `action cycle` on the project's options screen: the next value of a setting that has a few. */
  cycle(setting: string) {
    const ops = this.cycleOps();
    if (!Object.hasOwn(ops, setting) || !ops[setting as CycleSetting].cycle()) return;
    this.commit(setting === 'language'); // a new language reloads the texts
  }

  /** The setting whose list is open on the project's options screen ('' = none). */
  private selectOpen = '';

  /** The setting whose list is open ('' = none). */
  get openSelect(): string { return this.selectOpen; }

  /** The values a `select` of this setting offers, in order (`value` is what the screen's variable holds, `label` its words). */
  selectChoices(setting: string): { value: string; label: string }[] {
    const ops = this.cycleOps();
    return Object.hasOwn(ops, setting) ? ops[setting as CycleSetting].choices() : [];
  }

  /** The lists of every `select` as the entries of the options screen (`<setting>_options`), and which one is open. */
  optionLists(): { vars: Record<string, string | string[]>; entries: Record<string, Record<string, Record<string, string>>> } {
    const vars: Record<string, string | string[]> = { select_open: this.selectOpen }, entries: Record<string, Record<string, Record<string, string>>> = {};
    for (const setting of SELECT_SETTINGS) {
      const choices = this.selectChoices(setting);
      vars[`${setting}_options`] = choices.map(c => c.value);
      entries[`${setting}_options`] = Object.fromEntries(choices.map(c => [c.value, { label: c.label }]));
    }
    return { vars, entries };
  }

  /** `action select` on the project's options screen: open this setting's list, or close it when it is the one open. */
  toggleSelect(setting: string) { this.selectOpen = this.selectOpen === setting ? '' : setting; this.onValues(); }

  /** Esc over an open list closes the list; true when it did (the screen stays). */
  closeSelect(): boolean {
    if (!this.selectOpen) return false;
    this.selectOpen = '';
    this.onValues();
    return true;
  }

  /** `action choose` on a `select`'s list: the id is `<setting>.<value>`. */
  choose(id: string) {
    const dot = id.indexOf('.'), setting = id.slice(0, dot), value = id.slice(dot + 1);
    if (!this.selectChoices(setting).some(c => c.value === value)) return;
    this.selectOpen = '';
    this.cycleOps()[setting as CycleSetting].pick(value);
    this.commit(setting === 'language');
  }

  /** `action tab` on the project's options screen. */
  setTab(name: string) { this.customTab = name; this.selectOpen = ''; this.onValues(); }

  /** `action close` on the project's options screen: the same as Back. */
  closeOptions() { if (this.stack.at(-1) === optionsEl) this.back(); }
  /** `action reset` on the options screen (UX round PX-5): asks first, then clears the progress and says so. */
  resetProgress() { this.confirm('confirm_reset', () => { this.act.resetProgress(); this.act.toast('toast_reset'); this.onValues(); }, true); }

  /** A translated word kept in a hidden [data-ui] element (see index.html). */
  private label(key: string): string {
    return document.querySelector(`[data-ui="${key}"]`)?.textContent ?? key;
  }

  /**
   * Translate every [data-ui] element. The source text is `labels[key]` from game.json, else the HTML text;
   * other languages use `ui.<key>` from their locale table.
   */
  translate(locale: Locale, labels: Record<string, string> = {}) {
    this.uiLabels = null;
    for (const e of document.querySelectorAll<HTMLElement>('[data-ui]')) {
      e.dataset.html ??= e.textContent ?? '';
      e.textContent = locale.t(`ui.${e.dataset.ui}`, labels[e.dataset.ui!] || e.dataset.html);
    }
    if (!savesEl.hidden) this.onSaves();
    if (!optionsEl.hidden) this.onValues();
  }

  /** Source text (as the default screens write it) to its translated label; built once per `translate`, not per text drawn. */
  private uiLabels: Map<string, string> | null = null;
  /** The translated label of a default screen's English text ("New game", "Back"), or the text itself when no hidden label has it. */
  uiText(raw: string): string {
    if (!this.uiLabels) {
      this.uiLabels = new Map();
      // "Music" is both a volume row and the title button: the button's label wins
      for (const e of [...document.querySelectorAll<HTMLElement>('[data-ui]')].sort((a, b) => Number(b.dataset.ui === 'music_room') - Number(a.dataset.ui === 'music_room'))) {
        const src = e.dataset.html ?? e.textContent ?? '';
        if (!this.uiLabels.has(src)) this.uiLabels.set(src, e.textContent ?? src);
      }
    }
    return this.uiLabels.get(raw) ?? raw;
  }

  setLanguages(langs: string[]) { this.langs = langs; }

  /** The themes the player may pick (game.json "themes"); the options offer the choice only when there are two or more. */
  setThemes(names: string[]) { this.themes = names; }

  /** The game dims who is not speaking (game.json "speakerFocus"): only then do the options offer to turn it off. */
  setFocusOption(has: boolean) { this.hasFocus = has; }
  /** Whether the Touch gestures switch is offered: a touch screen, and a game that has not turned gestures off. */
  setTouchOption(has: boolean) { this.hasTouch = has; }

  /** The languages the game has voice recordings in; the option to pick one is shown only when there are some. */
  setVoiceLanguages(langs: string[]) { this.voiceLangs = langs; }

  // ---- screen stack ----
  private focusIn(screen: HTMLElement) {
    autoFocus(screen.querySelector<HTMLElement>('[autofocus], button:not(:disabled), input, select'));
  }
  /** The element id (in the screen's layer) that had focus when `screen` was covered: a redraw that brings the screen back focuses it. */
  returnId(screen: HTMLElement) { return this.openers.get(screen)?.id ?? ''; }
  /** An element `id` of `screen`'s layer was pressed: what it opens returns to it. */
  pressed(screen: HTMLElement, id: string) { this.pressedOn = { screen, id }; }
  /** Focus what opened the screen covering `screen` (its element, or the element with its id after a redraw), else the first button. */
  private refocus(screen: HTMLElement) {
    const was = this.openers.get(screen);
    // A screen is drawn in its layer, the element after it (#saves, #savesui).
    const layer = document.getElementById(`${screen.id}ui`);
    const el = was?.el?.isConnected && !was.el.closest('[data-leaving]') ? was.el : was?.id ? layer?.querySelector<HTMLElement>(`:scope > :not([data-leaving]) [data-id="${CSS.escape(was.id)}"][data-on="true"]`) : null;
    if (!autoFocus(el)) this.focusIn(screen);
  }
  private push(screen: HTMLElement) {
    const top = this.stack.at(-1);
    const active = document.activeElement;
    if (top && active instanceof HTMLElement && active !== document.body) this.openers.set(top, { el: active, id: active.dataset.id ?? '' });
    else if (top && this.pressedOn?.screen === top) this.openers.set(top, { el: null, id: this.pressedOn.id });
    else if (top) this.openers.delete(top);
    this.pressedOn = null;
    // A dialog (yes/no, a save's name) leaves the screen it was asked from in sight, just out of reach.
    const dialog = screen === confirmEl || screen === saveNameEl;
    screen.dataset.over = String(dialog && !!top);
    if (top && dialog) setInert(top, true);
    else if (top) top.hidden = true;
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
      setInert(prev, false);
      prev.hidden = false;
      if (prev === savesEl) this.renderSaves();
      this.refocus(prev);
    }
    this.act.screens(this.open);
  }
  hideAll() {
    for (const s of SCREENS) { s.hidden = true; setInert(s, false); }
    this.stack = [];
    this.openers.clear();
    this.pressedOn = null;
    this.act.screens(false);
  }

  showTitle() {
    this.hideAll();
    this.push(titleEl);
  }

  showPause() { this.hideAll(); this.push(pauseEl); }

  /** Esc: go back one screen, close the pause menu, or open it while playing. */
  escape() {
    const top = this.stack.at(-1);
    if (top === optionsEl && this.closeSelect()) return;
    if (this.stack.length > 1) this.back();
    else if (top === pauseEl) this.hideAll();
    else if (top && top !== titleEl) this.back(); // history, saves or options opened over the game from the quick menu
    else if (!top && this.act.isPlaying()) this.showPause();
  }

  /** Ask a yes/no question (text from the hidden [data-ui=key] label); runs `yes` on Yes. `danger`: Yes deletes something. */
  confirm(key: string, yes: () => void, danger = false) {
    this.onConfirm = yes;
    $('confirmText').textContent = this.label(key);
    $('confirmYes').dataset.variant = danger ? 'danger' : 'primary';
    this.push(confirmEl);
  }

  private onName: ((label: string) => void) | null = null;
  /** Ask the player for a save's name (empty: none), starting from `current`; runs `done` on Save, nothing on Cancel or Esc. */
  private askName(current: string, placeholder: string, done: (label: string) => void) {
    this.onName = done;
    saveNameInput.value = current;
    saveNameInput.placeholder = placeholder;
    saveNameInput.maxLength = SAVE_NAME_MAX;
    saveNameEl.querySelector('.osk')?.remove();
    saveNameInput.after(oskBoard(saveNameInput, SAVE_NAME_MAX)); // built anew: its first key replaces the old name
    this.push(saveNameEl);
    if (autoFocus(saveNameInput)) saveNameInput.select();
  }

  /** game.json "saveNames": the player names a save when making it, and can rename it on the save screen. */
  private saveNames = false;
  setSaveNames(on: boolean) { this.saveNames = on; }
  /** Only the numbered slots take names (auto, quick and choice saves are made without asking). */
  private nameable(slot: string) { return this.saveNames && slot !== 'auto' && slot !== 'quick' && !isChoiceSlot(slot); }

  // ---- opened from the quick menu (over the game; Back returns to it) ----
  openOptions() { this.customTab = ''; this.selectOpen = ''; this.push(optionsEl); }

  openSaves(mode: 'save' | 'load') { this.showSaves(mode); }

  private historyLines: LineInfo[] = [];
  /** The newest line is the one on screen (no choice after it): going back to it does nothing. */
  private historyAtLine = false;
  private isCurrentLine(i: number) { return this.historyAtLine && i === this.historyLines.length - 1; }

  /** The history as the variables and per-line data of the `screen history`. */
  historyValues(): { vars: Record<string, string | number | string[]>; entries: Record<string, Record<string, Record<string, string | boolean>>> } {
    const ids = this.historyLines.map((_, i) => String(i + 1));
    return {
      vars: { lines: ids, total: ids.length },
      entries: { lines: Object.fromEntries(ids.map((id, i) => { const l = this.historyLines[i]; return [id, { name: l.name ?? '', color: l.color ?? '', text: l.text, current: this.isCurrentLine(i), voiced: this.act.hasVoice(l.id) }]; })) },
    };
  }
  /** `action voice` on a history line's own button (`button ln.voice`): play that line's recording again (id is 1-based). */
  replayLine(id: string) { this.act.playVoice(this.historyLines[Number(id) - 1]?.id); }
  /** `action close` on the project's history screen: the same as Back. */
  closeHistory() { if (this.stack.at(-1) === historyEl) this.back(); }
  /** `action line` on the history screen: roll back to that line (id is 1-based). */
  pickLine(id: string) {
    const i = Number(id) - 1;
    if (!Number.isInteger(i) || i < 0 || i >= this.historyLines.length || this.isCurrentLine(i)) return;
    this.hideAll();
    this.act.rollbackTo(i);
  }

  /** `atLine`: the newest line is still on screen (no choice or prompt after it). */
  openHistory(lines: LineInfo[], atLine: boolean) {
    this.historyLines = lines;
    this.historyAtLine = atLine;
    this.push(historyEl);
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

  private openGallery() { this.push(galleryEl); }

  private openViewer(items: GalleryItem[], index: number) {
    this.viewing = items;
    this.push(viewerEl);
    this.showImage(index);
  }

  private showImage(index: number) {
    if (!this.viewing.length) return;
    this.viewIndex = (index + this.viewing.length) % this.viewing.length;
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

  private renderMusic() { this.onMusic(); }

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

  private openChapters() { this.push(chaptersEl); }

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

  private openAchievements() { this.push(achievementsEl); }

  // ---- save / load ----
  private note = '';
  private showSaves(mode: 'save' | 'load') {
    this.mode = mode;
    this.deleting = false;
    if (mode === 'save' && this.page < 0) this.page = 0;
    this.note = '';
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
  /** Auto, quick and choice saves are made by the game: they cannot be deleted by hand. */
  private manual(slot: string) { return slot !== 'auto' && slot !== 'quick' && !isChoiceSlot(slot); }

  /** The save/load screen as the variables and per-entry data of the `screen saves`. */
  savesValues(): { vars: Record<string, string | boolean | string[]>; entries: Record<string, Record<string, Record<string, string | boolean>>> } {
    const special: Record<number, string> = { [-1]: 'auto_short', [-2]: 'quick_short', [-3]: 'choice_short' };
    /** What a page tab is called in full: the tab itself says only "3" or "A". */
    const pageTitle = (p: number) => (p < 0 ? this.label(p === -1 ? 'auto' : p === -2 ? 'quick' : 'choice_saves') : `${this.label('page')} ${p + 1}`);
    const pages = this.savePages(), slots = this.saveSlots();
    return {
      vars: { mode: this.mode, page: this.pageId(this.page), pages: pages.map(p => this.pageId(p)), slots, deleting: this.deleting, note: this.note, can_rename: this.saveNames },
      entries: {
        pages: Object.fromEntries(pages.map(p => [this.pageId(p), { name: p < 0 ? this.label(special[p]) : String(p + 1), title: pageTitle(p) }])),
        slots: Object.fromEntries(slots.map(slot => {
          const data = readSave(slot);
          return [slot, {
            title: this.slotTitle(slot),
            heading: data?.label || this.slotTitle(slot),
            label: data?.label ?? '',
            when: data ? new Date(data.time).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '',
            text: data ? (data.name ? `${data.name}: ${data.text}` : data.text) : this.label('empty_slot'),
            empty: !data,
            thumb: data?.thumb ?? '',
            removable: !!data && this.manual(slot),
            renamable: !!data && this.nameable(slot),
          }];
        })),
      },
    };
  }

  /** `action page` on the saves screen: id is the page id. */
  setPage(id: string) {
    const p = this.savePages().find(q => this.pageId(q) === id);
    if (p === undefined) return;
    this.page = p;
    setItem('savePage', String(Math.max(p, 0)));
    this.renderSaves();
  }
  /** `action delete`: the next slot picked is deleted instead of saved or loaded. */
  toggleDelete() { this.deleting = !this.deleting; this.renderSaves(); }
  /** `action slot`: save into the slot or load it (or delete it, in delete mode). */
  pickSlot(slot: string) {
    if (this.deleting) { this.removeSlot(slot); return; }
    this.activateSlot(slot, readSave(slot));
  }
  /** `action remove` (id `<slot>.<anything>` inside an `each slots`) and the delete mode: ask, then delete a manual save. */
  removeSlot(slot: string) {
    if (readSave(slot) && this.manual(slot)) this.confirm('confirm_delete', () => { deleteSave(slot); this.renderSaves(); }, true);
  }
  /** `action rename`: ask for a new name for the save (game.json "saveNames"). */
  renameSlot(slot: string) {
    const data = readSave(slot);
    if (!data || !this.nameable(slot)) return;
    this.askName(data.label ?? '', this.slotTitle(slot), label => {
      this.note = writeSave(slot, { ...data, label: label || undefined }) ? '' : this.label('save_failed');
      this.renderSaves();
    });
  }
  /** `action close` on the saves screen: the same as Back. */
  closeSaves() { if (this.stack.at(-1) === savesEl) this.back(); }
  onSaves: () => void = () => {};

  private renderSaves() { this.onSaves(); }

  /** Save into the slot (asking before overwriting) or load it (asking first while a game is running). */
  private activateSlot(slot: string, data: SaveData | null) {
    if (this.mode === 'save') {
      const write = async (label?: string) => {
        const ok = await this.act.save(slot, label || undefined);
        this.note = ok ? '' : this.label('save_failed');
        if (ok) this.act.toast('toast_saved', this.slotTitle(slot)); // "Saved: Slot 4", also for a screen reader (the toast is a status region)
        this.renderSaves();
      };
      // Overwriting offers the old name again.
      const go = () => this.nameable(slot) ? this.askName(data?.label ?? '', this.slotTitle(slot), label => void write(label)) : void write();
      if (data) this.confirm('confirm_overwrite', go);
      else go();
    } else if (data) {
      if (this.act.isPlaying()) this.confirm('confirm_load', () => this.act.load(slot));
      else this.act.load(slot);
    }
  }
}
