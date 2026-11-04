// Shared by the preview renderers: the text box, choice menu, HUD and audio live here (DOM over the
// stage: crisp text, real buttons, any language), so a renderer subclass only draws the world.

import { announceLine, assetContext, captionFor, sideImageKey, stateAssets, VOICE_KEY, type CaptionTable, type AssetContext, type CharacterDef, type DisplayState, type MenuItem, type PreloadTask, type ScreenLive, type Renderer, type Resident, type ScreenView, type ViewItem, type RigManifest, type SayEvent, type SideImages, type SpeakerFocus, type Src, type VisualOp } from '../engine/src/index.js';
import { AudioSystem } from './audio.js';
import { HudLayer, ScreenLayer } from './screen-ui.js';
import { Blips } from './blips.js';
import { autoFocus, oskBoard } from './input.js';
import { TEXT_INSTANT } from './settings.js';

export { W, H } from './stage-size.js';

/** Visual ops that change the picture; music, sound and wait are handled here. */
export type WorldOp = Exclude<VisualOp, { op: 'music' | 'sound' | 'movie' | 'wait' }>;
/** A file under assets/ as listed by the dev server; `v` changes when the file does. */
export interface AssetFile { file: string; v: number }

export const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
export const hue = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

type TextRun = Extract<SayEvent['segments'][number], { kind: 'text' }>;
/** Class and inline style of a styled run of text (italic, bold, effect, color, size). */
const look = (el: HTMLElement, r: TextRun) => {
  el.className = `${r.italic ? 'i ' : ''}${r.bold ? 'b ' : ''}${r.fx ? `fx fx-${r.fx}` : ''}`.trim();
  if (r.color) el.style.color = r.color;
  if (r.size) el.style.fontSize = `${r.size}em`;
};
/** Where a typed character sits: a range of a text node, or a whole element (`at` -1) for ruby and animated text. */
type Spot = { node: Node; at: number; len: number };
/**
 * The item indexes where a new page of the text box starts, for a line laid out in full in `box`. A page holds
 * `--text-lines` lines (theme text.lines, default 3) and breaks only at the start of a line. `spots` has null for items
 * that cannot start a line (pauses, spaces).
 */
function pageStarts(box: HTMLElement, spots: (Spot | null)[]): number[] {
  const cs = getComputedStyle(box);
  if (!box.offsetWidth) return [];
  const scale = box.getBoundingClientRect().width / box.offsetWidth; // the stage is scaled to fit the window
  const line = (parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.45) * scale;
  const room = ((Number(cs.getPropertyValue('--text-lines')) || 3) + 0.5) * line;
  const range = document.createRange(), starts: number[] = [];
  let top = NaN, bottom = -Infinity;
  spots.forEach((s, i) => {
    if (!s) return;
    let r: DOMRect | undefined;
    if (s.at < 0) r = (s.node as Element).getBoundingClientRect();
    else { range.setStart(s.node, s.at); range.setEnd(s.node, s.at + s.len); r = range.getClientRects()[0]; }
    if (!r?.height) return;
    if (Number.isNaN(top)) { top = r.top; bottom = r.bottom; return; }
    if (r.top < bottom - 1) { bottom = Math.max(bottom, r.bottom); return; } // same line
    if (r.bottom - top > room) { starts.push(i); top = r.top; }
    bottom = r.bottom;
  });
  return starts;
}
/** Show a finished line at once (the earlier lines of an NVL page). */
function appendRuns(target: HTMLElement, segments: SayEvent['segments']) {
  for (const seg of segments) {
    if (seg.kind !== 'text') continue;
    const pieces = seg.ruby ? [seg.text] : seg.fx ? Array.from(seg.text) : [seg.text];
    pieces.forEach((text, i) => {
      const el = document.createElement(seg.ruby ? 'ruby' : 'span');
      el.textContent = text;
      if (seg.ruby) { const rt = document.createElement('rt'); rt.textContent = seg.ruby; el.append(rt); }
      look(el, seg);
      if (seg.fx) el.style.animationDelay = `${(i % 24) * 0.07}s`;
      target.append(el);
    });
  }
}

export const stage = $('stage');
const nvlEl = $('nvl'), nvlPage = $('nvl-page');
const box = $('box'), sideEl = $<HTMLImageElement>('side'), nameEl = $('name'), textEl = $('text'), menuEl = $('menu'), hud = $('hud'), endedEl = $('ended');

/** A line as the shell sees it (history, saves). */
export interface LineInfo { name: string | null; color: string | null; text: string }

const SKIP_MS = 45; // time each line stays on screen while skipping
const LOADING_BAR_MS = 250; // a wait for files shows the loading bar only after this long
const PREFETCH_PARALLEL = 4;   // files fetched ahead at once (8 while skipping); a file the story is waiting for never queues
const HOLD_MAX_MS = 20000;  // a wait never lasts longer than this; the placeholder is drawn instead
const IMAGE_FILE = /\.(png|webp|jpe?g|avif)$/i;
const MOVIE_FILE = /^movie\/[^/]+\.(webm|mp4|m4v|ogv)$/i;
const assetKey = (file: string) => file.replace(/\.[^./]+$/, '');
const loadingEl = $('loading');
const movieEl = $('movie');
/** Movies warmed up ahead of `movie play` (each buffers a few seconds, so only the nearest few are kept). */
const WARM_MOVIES = 2;
/** How many lines ahead voice recordings are decoded (the cache holds a dozen; the rest of the lookahead is only for images and audio files). */
const VOICE_AHEAD = 4;

export abstract class StageRenderer implements Renderer {
  characters: Record<string, CharacterDef> = {};
  readonly audio = new AudioSystem();
  readonly blips = new Blips(this.audio);
  /** Characters per second; TEXT_INSTANT or more shows lines at once. */
  textSpeed = 45;
  /** Auto-advance: on/off, and seconds to wait after a line is shown. */
  autoOn = false;
  autoDelay = 1.5;
  /** Skip mode fast-forwards through lines; unread lines stop it unless skipAll. Choices always stop it. */
  skipping = false;
  skipAll = false;
  /** Accessibility: no shake, hop, flash or wipes; the camera snaps. Set from the player's options. */
  reduceMotion = false;
  /** game.json "speakerFocus" (null: the game has none), and the player's Options switch for it. */
  speakerFocus: SpeakerFocus | null = null;
  focusOn = true;
  /** game.json "sideImages" (null: the game has none): the speaker's portrait in the text box. */
  sideImages: SideImages | null = null;
  /** The state last synced or applied: who is on stage, in which pose (side images). */
  private onStage: DisplayState | null = null;
  /**
   * Whose line is up, for speaker focus: set when a line starts and held until the next line, choice, input or screen
   * (null for narration and while nothing is said). Unlike speakTick, it does not stop when the letters do.
   */
  protected lineSpeaker: string | null = null;
  /** The player's setting for timed menus: the written time, three times as long, or no clock. */
  timedChoices: 'normal' | 'extended' | 'off' = 'normal';
  private menuClock = 0;
  /** Accessibility: caption sound effects (text from game.json `captions`, else the humanized name). */
  captions = false;
  captionTexts: CaptionTable = {};
  private captionTimer = 0;
  /** Accessibility: tell screen readers each line once it is shown in full (a live region, not the typing box). */
  announceLines = true;
  private announceTimer = 0;

  /** Put a line into the live region; cleared first so an identical line is read again. */
  private announce(name: string | null | undefined, text: string) {
    const el = document.getElementById('lineLive');
    const said = this.announceLines ? announceLine(name, text) : null;
    if (!el || !said) return;
    el.textContent = '';
    clearTimeout(this.announceTimer);
    this.announceTimer = window.setTimeout(() => { el.textContent = said; }, 60);
  }
  /** True while a menu screen covers the game: auto-advance and skipping hold. */
  paused = false;
  /** Read tracking, supplied by the shell. `seen` is asked before `markSeen` for the same line. */
  isSeen: (ev: SayEvent) => boolean = () => false;
  markSeen: (ev: SayEvent) => void = () => {};
  /** Skip or auto stopped on its own (unread line, choice, click). */
  onModeChange: () => void = () => {};
  /** A background came on screen (gallery unlocks). */
  onBackground: (name: string) => void = () => {};
  /** A music track started (music room unlocks). */
  onMusic: (name: string) => void = () => {};
  /** Called for every line and choice; `line` is the line shown (none for choices). */
  onPosition: (src: Src, line?: LineInfo) => void = () => {};
  onEnded: () => void = () => {};
  /** The language of the voice recordings played (assets/voice/<id>.<lang>.*): the player's voice setting, which defaults to the text language. */
  lang = 'en';
  /** The line on screen has a voice recording (or no longer does): the shell shows or hides its replay button. */
  onVoice: (voiced: boolean) => void = () => {};
  private lineVoice: string | null = null; // id of the line on screen, while it has a recording
  /** Play the recording of the line on screen again (the replay button, key V). */
  replayVoice() { if (this.lineVoice) void this.audio.voice(this.lineVoice, this.lang); }
  protected epoch = 0;
  private advanceFn: (() => void) | null = null;
  private typeTimer = 0;
  private settleTimer = 0;
  private lineKick: (() => void) | null = null; // re-evaluates skip/auto for the line on screen
  private sfxTimer = 0;
  private menuOpen = false;
  /** The project's files and rigs (keys: see engine/src/assets.ts). */
  protected files: AssetContext = assetContext({ files: [] });
  /** Custom screens (`show screen`), drawn in DOM over the stage. */
  readonly screens = new ScreenLayer($('screenui'), n => this.hoverSound(n));
  /** Screens shown with `hud on`, over the scene and under the text box. A choice is reported to the runtime through `onHudEvent`. */
  readonly hudLayer = new HudLayer($('hudui'), (id, on) => this.onHudEvent(id, on), () => this.menuOpen || this.paused, n => this.hoverSound(n));
  onHudEvent: (id: string, on: string) => void = () => {};
  /** The `quickmenu` screen (the project's, else the starter), drawn like a HUD above the text box; its elements run built-in actions through `onQuickAction`. */
  readonly quickLayer = new HudLayer($('quickui'), (id, on) => { if (on === 'click') this.onQuickAction(this.quickView?.parts.find(p => 'id' in p && p.id === id && p.act) as ViewItem | undefined); }, () => this.paused, n => this.hoverSound(n));
  onQuickAction: (item: ViewItem | undefined) => void = () => {};
  /** The project's `screen title`, drawn over the title screen's place; its elements run built-in actions through `onTitleAction`. */
  readonly titleLayer = new HudLayer($('titleui'), (id, on) => { if (on === 'click') this.onTitleAction(this.titleView?.parts.find(p => 'id' in p && p.id === id && p.act) as ViewItem | undefined); }, () => false, n => this.hoverSound(n));
  onTitleAction: (item: ViewItem | undefined) => void = () => {};
  private titleView: ScreenView | null = null;
  /** The project's `screen pause`, drawn over the dimmed stage while the pause menu is up; actions go to `onPauseAction`. */
  readonly pauseLayer = new HudLayer($('pauseui'), (id, on) => { if (on === 'click') this.onPauseAction(this.pauseView?.parts.find(p => 'id' in p && p.id === id && p.act) as ViewItem | undefined); }, () => false, n => this.hoverSound(n));
  onPauseAction: (item: ViewItem | undefined) => void = () => {};
  private pauseView: ScreenView | null = null;
  /** The project's `screen options`, drawn over the dimmed stage in place of the default options; actions go to `onOptionsAction`, slider moves to `onSlider`. */
  readonly optionsLayer = new HudLayer($('optionsui'), (id, on) => { if (on === 'click') this.onOptionsAction(this.optionsView?.parts.find(p => 'id' in p && p.id === id && p.act) as ViewItem | undefined); }, () => false, n => this.hoverSound(n), true);
  onOptionsAction: (item: ViewItem | undefined) => void = () => {};
  private optionsView: ScreenView | null = null;
  /** The project's `screen saves`, drawn over the dimmed stage in place of the default save/load screen; actions go to `onSavesAction`. */
  readonly savesLayer = new HudLayer($('savesui'), (id, on) => { if (on === 'click') this.onSavesAction(this.savesView?.parts.find(p => 'id' in p && p.id === id && p.act) as ViewItem | undefined); }, () => false, n => this.hoverSound(n));
  onSavesAction: (item: ViewItem | undefined) => void = () => {};
  private savesView: ScreenView | null = null;
  /** The project's `screen history`, drawn over the dimmed stage (the project's, else the starter); actions go to `onHistoryAction`. */
  readonly historyLayer = new HudLayer($('historyui'), (id, on) => { if (on === 'click') this.onHistoryAction(this.historyView?.parts.find(p => 'id' in p && p.id === id && p.act) as ViewItem | undefined); }, () => false, n => this.hoverSound(n));
  onHistoryAction: (item: ViewItem | undefined) => void = () => {};
  private historyView: ScreenView | null = null;
  /** The project's `screen gallery`, drawn over the dimmed stage in place of the default gallery; actions go to `onGalleryAction`. */
  readonly galleryLayer = new HudLayer($('galleryui'), (id, on) => { if (on === 'click') this.onGalleryAction(this.galleryView?.parts.find(p => 'id' in p && p.id === id && p.act) as ViewItem | undefined); }, () => false, n => this.hoverSound(n));
  onGalleryAction: (item: ViewItem | undefined) => void = () => {};
  private galleryView: ScreenView | null = null;
  /** The project's `screen viewer`, drawn over the black viewer backdrop (the project's, else the starter); actions go to `onViewerAction`. */
  readonly viewerLayer = new HudLayer($('viewerui'), (id, on) => { if (on === 'click') this.onViewerAction(this.viewerView?.parts.find(p => 'id' in p && p.id === id && p.act) as ViewItem | undefined); }, () => false, n => this.hoverSound(n));
  onViewerAction: (item: ViewItem | undefined) => void = () => {};
  private viewerView: ScreenView | null = null;
  /** The project's `screen music`, drawn over the dimmed stage in place of the default music room; actions go to `onMusicAction`. */
  readonly musicLayer = new HudLayer($('musicui'), (id, on) => { if (on === 'click') this.onMusicAction(this.musicView?.parts.find(p => 'id' in p && p.id === id && p.act) as ViewItem | undefined); }, () => false, n => this.hoverSound(n));
  onMusicAction: (item: ViewItem | undefined) => void = () => {};
  private musicView: ScreenView | null = null;
  /** The project's `screen chapters`, drawn over the dimmed stage in place of the default chapter select; actions go to `onChaptersAction`. */
  readonly chaptersLayer = new HudLayer($('chaptersui'), (id, on) => { if (on === 'click') this.onChaptersAction(this.chaptersView?.parts.find(p => 'id' in p && p.id === id && p.act) as ViewItem | undefined); }, () => false, n => this.hoverSound(n));
  onChaptersAction: (item: ViewItem | undefined) => void = () => {};
  private chaptersView: ScreenView | null = null;
  /** The project's `screen achievements`, drawn over the dimmed stage in place of the default list; actions go to `onAchievementsAction`. */
  readonly achievementsLayer = new HudLayer($('achievementsui'), (id, on) => { if (on === 'click') this.onAchievementsAction(this.achievementsView?.parts.find(p => 'id' in p && p.id === id && p.act) as ViewItem | undefined); }, () => false, n => this.hoverSound(n));
  onAchievementsAction: (item: ViewItem | undefined) => void = () => {};
  private achievementsView: ScreenView | null = null;
  /** The `achievement_toast` screen (the project's, else the starter): shows one unlock, takes no input. */
  readonly achToastLayer = new HudLayer($('achtoastui'), () => {}, () => true);
  private achToastView: ScreenView | null = null;
  private quickView: ScreenView | null = null;
  /** `hover sound "name"` on a screen or HUD element; a sound that is not there is silent. */
  private hoverSound(name: string) { if (this.audio.has('sound', name)) void this.audio.sound(name); }
  private endLine: (() => void) | null = null;
  private movieUrls = new Map<string, string>();        // movie name -> URL of the video file
  private warm = new Map<string, HTMLVideoElement>();    // asset key -> video element buffering ahead of its `movie play`
  private movieEnd: (() => void) | null = null;         // ends the movie on screen (skip, rollback, load); null when none plays
  private movieSkippable = false;
  private imageUrls = new Map<string, string>();        // asset key -> URL of the image file, for the DOM layers
  private versions = new Map<string, number>();     // asset key -> file version it was loaded from
  private ready = new Set<string>();                // asset keys that are loaded
  private loading = new Map<string, Promise<void>>();
  private queue: PreloadTask[] = [];                // preload tasks not started yet, nearest first
  private running = 0;                              // preload tasks in flight
  private waiting = 0;                              // waits in progress (the loading bar is shown while any is slow)
  private barTimer = 0;
  private barDone = 0;
  private barTotal = 0;

  /**
   * Take stock of the project's files; called before the runtime (re)starts, again on every hot reload. Nothing
   * big is fetched here: images and music load when the story gets near them (see ensure).
   */
  async preload(assets: AssetFile[], rigs: Record<string, RigManifest> = {}): Promise<void> {
    this.audio.setAssets(assets);
    // Text blip samples are needed by the first lines; other sounds load in the background. Music loads when it plays.
    const blips = [...Object.values(this.characters).map(c => c.style.blip), ...Object.values(this.blips.voices).flatMap(v => [v.sound, ...Object.values(v.vowels ?? {})])];
    this.audio.prefetchSounds(blips.filter((b): b is string => !!b));
    this.files = assetContext({ files: assets.map(a => a.file), rigs });
    // Files that changed or went away must load again.
    const versions = new Map(assets.map(a => [assetKey(a.file), a.v] as const));
    for (const [key, v] of this.versions) {
      if (versions.get(key) !== v) { this.ready.delete(key); this.loading.delete(key); }
    }
    this.versions = versions;
    this.imageUrls = new Map(assets.filter(a => IMAGE_FILE.test(a.file)).map(a => [assetKey(a.file), `assets/${a.file}?v=${a.v}`] as const));
    this.movieUrls = new Map(assets.filter(a => MOVIE_FILE.test(a.file)).map(a => [assetKey(a.file).slice(6), `assets/${a.file}?v=${a.v}`] as const));
    for (const [key, video] of this.warm) if (video.getAttribute('src') !== this.movieUrls.get(key.slice(6))) { this.dropVideo(video); this.warm.delete(key); }
    // Portraits are small and appear without warning (any line), so the browser fetches them all up front.
    if (this.sideImages) for (const [key, url] of this.imageUrls) if (key.startsWith('side/')) new Image().src = url;
    this.indexArt(assets);
  }
  /** Files the story had to wait for when it reached them; the lookahead should keep this at 0 (debug console: memory). */
  lateLoads = 0;
  /** Estimated memory of what is loaded: images from the renderer, decoded audio from the audio system. */
  resident(): Resident[] { return [...this.residentImages(), ...this.audio.resident()]; }
  protected residentImages(): Resident[] { return []; }
  /** The URL of an image a screen names: an asset, or a picture the shell hands over as a data: URL (a save slot's thumbnail). */
  private imageUrl(file: string): string | null { return file.startsWith('data:image/') ? file : this.imageUrls.get(file.replace(IMAGE_FILE, '')) ?? null; }
  /** The renderer learns which image files exist (and which changed). */
  protected indexArt(_assets: AssetFile[]): void {}
  /** Load one image into the renderer; never rejects (a missing or broken file is drawn as a placeholder). */
  protected async loadImage(_key: string): Promise<void> {}

  /** Load the files behind these asset keys (images, music, sounds) and resolve once they are all ready. */
  ensure(keys: string[]): Promise<void> {
    const todo = [...new Set(keys)].filter(k => !this.ready.has(k) && this.versions.has(k));
    if (!todo.length) return Promise.resolve();
    this.barTotal += todo.length;
    if (++this.waiting === 1) this.barTimer = window.setTimeout(() => { loadingEl.dataset.show = 'true'; }, LOADING_BAR_MS);
    const bar = () => { (loadingEl.firstElementChild as HTMLElement).style.width = `${(this.barDone / this.barTotal) * 100}%`; };
    const all = Promise.all(todo.map(k => this.fetchKey(k).then(() => { this.barDone++; bar(); })));
    let cap = 0;
    return Promise.race([all, new Promise<void>(r => { cap = window.setTimeout(r, HOLD_MAX_MS); })]).then(() => {
      clearTimeout(cap);
      if (--this.waiting === 0) {
        clearTimeout(this.barTimer);
        loadingEl.dataset.show = 'false';
        this.barDone = this.barTotal = 0;
      }
    });
  }
  private makeVideo(url: string): HTMLVideoElement {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.playsInline = true;
    video.src = url;
    return video;
  }
  private dropVideo(video: HTMLVideoElement) { video.pause(); video.removeAttribute('src'); video.load(); }
  /** Start buffering a movie the story is about to reach; it is not waited for here (a movie is too big to hold the story for). */
  private async warmMovie(key: string): Promise<void> {
    const url = this.movieUrls.get(key.slice(6));
    if (!url || this.warm.has(key)) return;
    this.warm.set(key, this.makeVideo(url));
    while (this.warm.size > WARM_MOVIES) { // the oldest goes first
      const [oldest] = this.warm.keys();
      this.dropVideo(this.warm.get(oldest)!);
      this.warm.delete(oldest);
    }
  }
  private loopVideos = new Set<HTMLVideoElement>(); // videos of looping overlay pictures, which follow the volume sliders
  /** A looping video of `movie/<name>` for an overlay picture (the warmed one when the story looked ahead); null without a file. */
  protected takeLoopVideo(key: string): HTMLVideoElement | null {
    const url = this.movieUrls.get(key.slice(6));
    if (!url) return null;
    const video = this.warm.get(key) ?? this.makeVideo(url);
    this.warm.delete(key);
    video.loop = true;
    video.volume = this.audio.mediaVolume();
    this.loopVideos.add(video);
    // The browser refuses sound before the player has clicked anything: play muted then, and turn the sound on at the first click or key.
    const start = () => { void video.play().catch(() => {
      video.muted = true;
      void video.play().catch(() => {});
      const unmute = () => { video.muted = false; };
      addEventListener('pointerdown', unmute, { once: true, capture: true });
      addEventListener('keydown', unmute, { once: true, capture: true });
    }); };
    if (video.readyState >= 3) start(); else video.addEventListener('canplay', start, { once: true });
    return video;
  }
  protected releaseVideo(video: HTMLVideoElement) { this.loopVideos.delete(video); this.dropVideo(video); }
  /** The volume sliders changed: the videos of looping pictures follow them. */
  syncMediaVolume() { for (const v of this.loopVideos) v.volume = this.audio.mediaVolume(); }
  /** Play a movie over the stage and resolve when it ends or is skipped; starts once the browser can play it without stalling. */
  private async playMovie(name: string, noskip: boolean, loop: boolean, ep: number): Promise<void> {
    const url = this.movieUrls.get(name);
    if (!url) { // no file yet: a text cue, so the script can be followed before the footage exists
      hud.textContent = `movie: ${name}`;
      await sleep(900);
      if (ep === this.epoch && this.onStage) this.showMusic(this.onStage);
      return;
    }
    const key = `movie/${name}`;
    const warmed = this.warm.get(key);
    this.warm.delete(key);
    const video = warmed ?? this.makeVideo(url);
    video.volume = this.audio.mediaVolume();
    video.loop = loop; // a looping movie ends only when the player skips it
    video.className = '';
    movieEl.replaceChildren(video);
    movieEl.dataset.show = 'true';
    this.movieSkippable = !noskip;
    const musicWas = this.onStage?.music && !this.onStage.musicPaused;
    if (musicWas) this.audio.pauseMusic(0.3);
    await new Promise<void>(resolve => {
      const end = () => { video.removeEventListener('ended', end); video.removeEventListener('error', end); this.movieEnd = null; resolve(); };
      this.movieEnd = end;
      video.addEventListener('ended', end);
      video.addEventListener('error', end);
      // An autoplay block (no click yet) or a decode failure skips the movie rather than stalling the story.
      const start = () => { void video.play().catch(end); };
      if (video.readyState >= 3) start(); else video.addEventListener('canplay', start, { once: true });
    });
    this.dropVideo(video);
    movieEl.replaceChildren();
    movieEl.dataset.show = 'false';
    if (musicWas && ep === this.epoch) this.audio.resumeMusic(0.3);
  }

  private fetchKey(key: string): Promise<void> {
    let p = this.loading.get(key);
    if (!p) {
      const m = /^(music|sound)\/(.+)$/.exec(key);
      p = (key.startsWith('movie/') ? this.warmMovie(key) : m ? this.audio.prefetch(m[1] as 'music' | 'sound', m[2]) : this.loadImage(key)).then(() => { this.ready.add(key); });
      this.loading.set(key, p);
    }
    return p;
  }
  /**
   * The story came near these assets (nearest first; see Preload in the engine): fetch them in order, a few at a
   * time. Each call replaces the list of what is still waiting, since the newest view of what is ahead is the
   * best; files the story already waits for are loaded by ensure() at once, not queued here.
   */
  prefetch(tasks: PreloadTask[], always: string[]) {
    this.queue = [...tasks, ...always.map(key => ({ key, lines: Infinity }))];
    this.pump();
  }
  private pump() {
    const limit = this.skipping ? PREFETCH_PARALLEL * 2 : PREFETCH_PARALLEL;
    while (this.running < limit && this.queue.length) {
      const { key, lines } = this.queue.shift()!;
      if (key.startsWith(VOICE_KEY)) { // recordings are decoded only for the next few lines; the cache is small
        if (lines <= VOICE_AHEAD) { this.running++; void this.audio.prefetchVoice(key.slice(VOICE_KEY.length), this.lang).then(() => { this.running--; this.pump(); }); }
        continue;
      }
      if (this.ready.has(key) || this.loading.has(key) || !this.versions.has(key)) continue;
      this.running++;
      void this.fetchKey(key).then(() => { this.running--; this.pump(); });
    }
  }
  /** Load everything `state` shows and plays, ahead of sync(). */
  prepare(state: DisplayState): Promise<void> {
    return this.ensure(stateAssets(state, this.files));
  }
  /** A small JPEG data URL of the scene for save slots; undefined when the renderer can't capture. */
  async snapshot(): Promise<string | undefined> { return undefined; }
  /** Replace the world (background, sprites, effects) with `state` instantly. */
  protected abstract syncWorld(state: DisplayState): void;
  /** A character is speaking: called for each character typed (with `who`) and with null when the line is complete. */
  protected speakTick(_who: string | null): void {}
  /** Animate a world op; stop early when `alive()` turns false (a sync happened). */
  protected abstract applyWorld(op: WorldOp, state: DisplayState, alive: () => boolean): Promise<void>;

  /** Speaker focus as it applies to `state` now: off when the game has none, the story said `focus off` or the player turned it off. */
  protected focusFor(state: DisplayState): SpeakerFocus | null {
    return this.focusOn && state.focus !== false ? this.speakerFocus : null;
  }

  protected spriteColor(char: string) {
    return this.characters[char]?.color ?? `hsl(${hue(char)} 45% 45%)`;
  }

  /** Player input (click, Space...): finish the line, or go to the next one. A click while skipping stops skipping. */
  advance() {
    if (this.menuOpen) return;
    if (this.movieEnd) { if (this.movieSkippable) this.movieEnd(); return; }
    if (this.skipping) { this.setSkipping(false); return; }
    this.advanceFn?.();
  }

  setSkipping(on: boolean) {
    if (this.skipping === on) return;
    this.skipping = on;
    this.onModeChange();
    this.refresh();
  }

  setAuto(on: boolean) {
    if (this.autoOn === on) return;
    this.autoOn = on;
    this.onModeChange();
    this.refresh();
  }

  /** Apply changed skip/auto settings to the line already on screen. */
  refresh() {
    clearTimeout(this.settleTimer);
    this.lineKick?.();
  }

  // Cues without an audio file are shown as text, so the script can be followed before the sound exists.
  private showMusic(state: DisplayState) {
    hud.textContent = state.music && !this.audio.has('music', state.music) ? `music: ${state.music}` : '';
  }

  // ---- Renderer ----
  sync(state: DisplayState) {
    this.epoch++;
    this.movieEnd?.();
    clearTimeout(this.typeTimer);
    clearTimeout(this.settleTimer);
    clearTimeout(this.sfxTimer);
    this.advanceFn = null;
    this.lineKick = null;
    this.lineSpeaker = null;
    this.audio.stopVoice();
    this.lineVoice = null;
    this.onVoice(false);
    this.menuOpen = false;
    clearInterval(this.menuClock);
    this.screens.close();
    this.hudLayer.clear();
    this.endLine = null;
    box.dataset.visible = 'false';
    delete box.dataset.side;
    this.clearPage();
    menuEl.dataset.visible = 'false';
    endedEl.style.display = 'none';
    stage.dataset.skin = '';
    if (state.bg) this.onBackground(state.bg);
    this.showMusic(state);
    if (state.music) this.onMusic(state.music);
    void this.audio.music(state.music, state.musicLoop, 0.5, !!state.musicPaused);
    void this.audio.syncAmbience(state.ambience ?? [], 0.5);
    this.onStage = state;
    this.syncWorld(state);
  }

  /** Show the caption of a sound effect for a moment, when captions are on. */
  private showCaption(name: string) {
    const el = document.getElementById('caption');
    const text = this.captions ? captionFor(name, this.captionTexts) : null;
    if (!el || !text) return;
    el.textContent = text;
    el.dataset.show = 'true';
    clearTimeout(this.captionTimer);
    this.captionTimer = window.setTimeout(() => { el.dataset.show = 'false'; }, 2200);
  }

  async apply(op: VisualOp, state: DisplayState): Promise<void> {
    const ep = this.epoch;
    this.onStage = state;
    // Wait for the files of what is about to appear or play: a short hold, never a placeholder.
    if (op.op === 'scene' || op.op === 'show' || (op.op === 'image' && op.action === 'show') || (op.op === 'music' && op.action === 'play') || (op.op === 'sound' && op.action === 'loop')) {
      const keys = stateAssets(state, this.files);
      this.lateLoads += new Set(keys.filter(k => !this.ready.has(k) && this.versions.has(k))).size;
      await this.ensure(keys);
      if (ep !== this.epoch) return;
    }
    // A full-stage screen picture left up by the last screen fades with a scene change, and goes at once for anything else.
    // (Sound and hide ops change nothing under the picture: the map screen is followed by `hide iris` before the jump to the next room's scene.)
    if (op.op === 'scene') this.screens.unlinger(this.skipping ? 0 : op.dur);
    else if (op.op !== 'hide' && op.op !== 'music' && op.op !== 'sound') this.screens.unlinger();
    switch (op.op) {
      case 'music':
        this.showMusic(state);
        if (op.action === 'play' && op.name) this.onMusic(op.name);
        if (op.action === 'pause') this.audio.pauseMusic(this.skipping ? 0 : op.fade);
        else if (op.action === 'resume') this.audio.resumeMusic(this.skipping ? 0 : op.fade);
        else void this.audio.music(op.action === 'play' ? op.name : null, op.loop, this.skipping ? 0 : op.fade);
        return;
      case 'sound':
        if (op.action !== 'play') { void this.audio.syncAmbience(state.ambience ?? [], this.skipping ? 0 : op.fade); return; }
        if (this.skipping || !op.name) return;
        this.showCaption(op.name);
        if (this.audio.has('sound', op.name)) { void this.audio.sound(op.name, 1, 1, op.duck); return; }
        hud.textContent = `sound: ${op.name}`;
        clearTimeout(this.sfxTimer);
        this.sfxTimer = window.setTimeout(() => this.showMusic(state), 900);
        return;
      case 'movie':
        if (!this.skipping) await this.playMovie(op.name, op.noskip, op.loop, ep);
        return;
      case 'wait':
        if (!this.skipping) await sleep(op.dur * 1000);
        return;
      default:
        if (op.op === 'scene') this.onBackground(op.bg);
        // While skipping, jump straight to the result instead of animating.
        if (this.skipping) { this.syncWorld(state); return; }
        return this.applyWorld(op, state, () => ep === this.epoch);
    }
  }

  /** The speaker's portrait in the text box (game.json "sideImages"), following their pose on stage; none in NVL mode. */
  private showSide(ev: SayEvent) {
    const sprite = ev.who ? this.onStage?.sprites.find(s => s.char === ev.who) : undefined;
    const key = ev.nvl || !ev.who ? null : sideImageKey(this.characters[ev.who]?.side, sprite ? sprite.pose : undefined, this.sideImages, k => this.imageUrls.has(k));
    const url = key ? this.imageUrls.get(key) : undefined;
    if (!url || !this.sideImages) { delete box.dataset.side; return; }
    if (sideEl.getAttribute('src') !== url) sideEl.src = url;
    box.dataset.side = this.sideImages.place;
    box.style.setProperty('--side-size', `${this.sideImages.size}px`);
  }

  clearPage() {
    nvlEl.dataset.visible = 'false';
    nvlEl.dataset.done = 'false';
    nvlPage.replaceChildren();
  }

  /** `textbox hide`: the box goes away until the next line (say) shows it again. */
  hideBox() {
    box.dataset.visible = 'false';
    delete box.dataset.side;
  }

  /** Fill the NVL page with the lines already on it, in full, and add a row for the new line; returns that row. */
  private openPage(ev: SayEvent): HTMLElement {
    const row = (e: SayEvent) => {
      const r = document.createElement('div');
      if (e.name) {
        const who = document.createElement('span');
        who.className = 'who';
        who.textContent = `${e.name}:`;
        who.style.setProperty('--ncolor', e.color ?? '#ffffff');
        r.append(who);
      }
      return r;
    };
    const rows = (ev.page ?? []).map(p => {
      const r = row(p);
      const t = document.createElement('span');
      appendRuns(t, p.segments);
      r.append(t);
      return r;
    });
    const cur = row(ev);
    const text = document.createElement('span');
    cur.append(text);
    nvlPage.replaceChildren(...rows, cur);
    nvlEl.dataset.visible = 'true';
    nvlEl.dataset.done = 'false';
    return text;
  }
  /** Drop the oldest lines off the top while the page is taller than the screen. */
  private fitPage() {
    while (nvlPage.childElementCount > 1 && nvlPage.scrollHeight > nvlPage.clientHeight) nvlPage.firstElementChild!.remove();
  }

  say(ev: SayEvent): Promise<void> {
    this.screens.unlinger();
    const plain = ev.segments.map(s => (s.kind === 'text' ? s.text : '')).join('');
    this.onPosition(ev.src, { name: ev.name, color: ev.color, text: plain });
    const wasSeen = this.isSeen(ev);
    this.markSeen(ev);
    this.lineSpeaker = ev.who;
    const skippable = () => this.skipAll || wasSeen;
    return new Promise<void>(resolve => {
      clearTimeout(this.typeTimer);
      clearTimeout(this.settleTimer);
      // NVL lines type into a row of the full-screen page, others into the text box.
      const frame = ev.nvl ? nvlEl : box;
      const target = ev.nvl ? this.openPage(ev) : textEl;
      if (ev.nvl) box.dataset.visible = 'false';
      else { this.clearPage(); box.dataset.visible = 'true'; nameEl.textContent = ev.name ?? ''; nameEl.style.setProperty('--ncolor', ev.color ?? '#ffffff'); }
      this.showSide(ev);
      frame.dataset.done = 'false';
      target.replaceChildren();
      // The speaker's style (define ... text= font= size= italic box=); theme skins are keyed by `box`.
      const st = ev.style;
      stage.dataset.skin = ev.nvl ? '' : ev.look ?? st.box ?? '';
      target.style.color = st.textColor ?? '';
      target.style.fontFamily = st.font ? `"${st.font}", var(--vn-font)` : '';
      target.style.fontSize = st.size ? `calc(var(--text-size, 44px) * var(--text-scale, 1) * ${st.size})` : '';
      target.style.fontStyle = st.italic ? 'italic' : '';
      const blip = this.blips.forLine(st.blip);

      type Run = Extract<SayEvent['segments'][number], { kind: 'text' }>;
      type Item = { ch: string; run: Run } | { pause: number } | { wait: true };      const items: Item[] = [];
      for (const seg of ev.segments) {
        if (seg.kind === 'pause') items.push({ pause: seg.seconds });
        else if (seg.kind === 'wait') items.push({ wait: true });
        else if (seg.kind === 'text') {
          // Ruby text is shown as one piece; wavy and shaking text animates per character.
          if (seg.ruby) items.push({ ch: seg.text, run: seg });
          else for (const ch of Array.from(seg.text)) items.push({ ch, run: seg });
        }
      }
      const autoNext = ev.segments.some(s => s.kind === 'next');
      const isText = (it: Item): it is { ch: string; run: Run } => 'ch' in it;

      let idx = 0, done = false, waiting = false, told = false, span: HTMLSpanElement | null = null, key = '';
      // The whole line is read once, when its first page is complete (a long line is not held back until its last page).
      const tell = () => { if (!told && !(this.skipping && skippable())) { told = true; this.announce(ev.name, plain); } };
      /** Show one character (or ruby piece); returns where it landed, for measuring pages. */
      const put = (it: { ch: string; run: Run }): Spot => {
        const r = it.run;
        if (r.ruby || r.fx) {
          const el = document.createElement(r.ruby ? 'ruby' : 'span');
          el.textContent = it.ch;
          if (r.ruby) { const rt = document.createElement('rt'); rt.textContent = r.ruby; el.append(rt); }
          look(el, r);
          if (r.fx) el.style.animationDelay = `${(target.childElementCount % 24) * 0.07}s`;
          target.append(el);
          span = null;
          if (ev.nvl) this.fitPage();
          return { node: el, at: -1, len: 0 };
        }
        const k = `${r.italic}${r.bold}${r.color ?? ''}${r.size ?? ''}`;
        if (!span || k !== key) {
          span = document.createElement('span');
          look(span, r);
          span.append(document.createTextNode(''));
          target.append(span);
          key = k;
        }
        const t = span.firstChild as Text;
        t.appendData(it.ch);
        if (ev.nvl) this.fitPage();
        return { node: t, at: t.length - it.ch.length, len: it.ch.length };
      };
      // A line too long for the text box is split into pages: lay it all out once, find where each page starts, clear it.
      const pages = ev.nvl ? [] : pageStarts(target, items.map(it => (isText(it) ? (s => (it.ch.trim() ? s : null))(put(it)) : null)));
      if (!ev.nvl) { target.replaceChildren(); span = null; }
      let page = 0;
      const pageEnd = () => pages[page] ?? items.length;
      // The recording starts with the line; auto-advance waits for it to end, and moving on (or skipping) cuts it.
      let voicePlaying = false, over = false;
      const voiced = this.audio.hasVoice(ev.id, this.lang);
      this.lineVoice = voiced ? ev.id : null;
      this.onVoice(voiced);
      if (voiced && !(this.skipping && skippable())) {
        voicePlaying = true;
        void this.audio.voice(ev.id, this.lang)?.then(() => { voicePlaying = false; if (done && !over) settle(); });
      } else this.audio.stopVoice();
      const next = () => {
        over = true;
        this.audio.stopVoice();
        clearTimeout(this.settleTimer);
        this.endLine = null;
        this.advanceFn = null;
        this.lineKick = null;
        resolve();
      };
      // The line is fully shown: skip on, auto-advance, or wait for the player.
      const settle = () => {
        clearTimeout(this.settleTimer);
        const later = (ms: number) => { this.settleTimer = window.setTimeout(() => (this.paused ? settle() : next()), ms); };
        if (this.skipping) {
          if (skippable()) { later(SKIP_MS); return; }
          this.skipping = false; // unread text: stop here
          this.onModeChange();
        }
        if (autoNext) { later(this.skipping ? SKIP_MS : 250); return; }
        if (this.autoOn && !voicePlaying) later((this.autoDelay + items.length * 0.02) * 1000);
      };
      // The box is full and the line goes on: wait like at {w}, then clear the box and type the next page.
      const pageFull = () => {
        clearTimeout(this.typeTimer);
        clearTimeout(this.settleTimer);
        this.speakTick(null);
        frame.dataset.done = 'true';
        tell();
        waiting = true;
        const turn = () => {
          if (!waiting) return;
          waiting = false;
          clearTimeout(this.settleTimer);
          page++;
          target.replaceChildren();
          span = null;
          frame.dataset.done = 'false';
          this.advanceFn = () => (done ? next() : finishTyping());
          if (this.skipping && skippable()) finishTyping(); else step();
        };
        this.advanceFn = turn;
        if (this.skipping) {
          if (skippable()) { this.settleTimer = window.setTimeout(turn, SKIP_MS); return; }
          this.skipping = false; // unread text: stop here
          this.onModeChange();
        }
        if (this.autoOn) this.settleTimer = window.setTimeout(turn, (this.autoDelay + (pageEnd() - (pages[page - 1] ?? 0)) * 0.02) * 1000);
      };
      const finishTyping = () => {
        clearTimeout(this.typeTimer);
        waiting = false;
        while (idx < pageEnd()) { const it = items[idx++]; if (isText(it)) put(it); }
        if (idx < items.length) { pageFull(); return; }
        this.speakTick(null);
        this.advanceFn = () => (done ? next() : finishTyping());
        done = true;
        frame.dataset.done = 'true';
        tell();
        settle();
      };
      const instant = this.textSpeed >= TEXT_INSTANT;
      const cps = this.textSpeed * (st.speed ?? 1);
      const step = () => {
        if (idx >= pageEnd()) { if (idx < items.length) pageFull(); else finishTyping(); return; }
        const it = items[idx++];
        if ('pause' in it) { this.typeTimer = window.setTimeout(step, it.pause * 1000); return; }
        if ('wait' in it) {
          if (this.skipping && skippable()) { step(); return; }
          // Stop here until the player clicks (or, in auto mode, for a moment); finishing the line still shows everything.
          waiting = true;
          const resume = () => {
            if (!waiting) return;
            waiting = false;
            clearTimeout(this.settleTimer);
            this.advanceFn = () => (done ? next() : finishTyping());
            step();
          };
          this.advanceFn = resume;
          if (this.autoOn) this.settleTimer = window.setTimeout(resume, this.autoDelay * 1000);
          return;
        }
        put(it);
        if (instant) { step(); return; } // pauses still wait
        blip?.(it.ch);
        this.speakTick(ev.who);
        this.typeTimer = window.setTimeout(step, 1000 / (cps * (it.run.speed ?? 1))); // {speed=} scales this run
      };
      this.endLine = () => { clearTimeout(this.typeTimer); next(); };
      this.lineKick = () => {
        if (done) settle();
        else if (this.skipping && skippable()) finishTyping();
      };
      this.advanceFn = () => (done ? next() : finishTyping());
      if (this.skipping && skippable()) finishTyping();
      else step();
    });
  }

  menu(options: MenuItem[], src: Src, prompt?: string, timer?: { seconds: number }, style?: string): Promise<number> {
    this.onPosition(src);
    if (style) menuEl.dataset.style = style; else delete menuEl.dataset.style; // theme styles[style].choice
    this.lineSpeaker = null;
    if (this.skipping) { this.skipping = false; this.onModeChange(); } // choices are always the player's
    return new Promise<number>(resolve => {
      this.menuOpen = true;
      const head: HTMLElement[] = [];
      if (prompt) {
        const p = document.createElement('div');
        p.className = 'prompt';
        p.id = 'menu-prompt';
        p.textContent = prompt;
        head.push(p);
      }
      menuEl.setAttribute('role', 'group');
      if (prompt) menuEl.setAttribute('aria-labelledby', 'menu-prompt'); else menuEl.removeAttribute('aria-labelledby');
      menuEl.replaceChildren(...head, ...options.map((o, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = o.text;
        if (o.seen) b.dataset.seen = 'true';
        if (o.disabled) {
          // aria-disabled, not disabled: a screen reader can still reach it and read the reason; pad/keyboard focus
          // moves (input.ts focusables) skip it, and a click does nothing.
          b.setAttribute('aria-disabled', 'true');
          b.dataset.disabled = 'true';
          if (o.reason) {
            const r = document.createElement('span');
            r.className = 'reason';
            r.id = `menu-reason-${i}`;
            r.textContent = o.reason;
            b.append(r);
            b.setAttribute('aria-describedby', r.id);
          }
        }
        b.addEventListener('click', e => {
          e.stopPropagation();
          if (o.disabled) return;
          clearInterval(this.menuClock);
          menuEl.querySelector('.timer')?.remove();
          this.menuOpen = false;
          menuEl.dataset.visible = 'false';
          resolve(i);
        });
        return b;
      }));
      if (timer && this.timedChoices !== 'off') this.startClock(timer.seconds * (this.timedChoices === 'extended' ? 3 : 1), options.length, resolve);
      menuEl.dataset.visible = 'true';
      autoFocus(menuEl.querySelector<HTMLElement>(':scope > button:not([aria-disabled="true"])'));
    });
  }

  /**
   * The clock of a timed menu: a bar that empties under the options. It runs on real time and holds while a screen is open
   * (`paused`), the interface is hidden or the tab is in the background. When it runs out the menu answers `timeoutAnswer`.
   */
  private startClock(total: number, timeoutAnswer: number, resolve: (i: number) => void) {
    const bar = document.createElement('div'), fill = document.createElement('i');
    bar.className = 'timer';
    bar.setAttribute('aria-hidden', 'true');
    bar.append(fill);
    menuEl.append(bar);
    const live = $('menuLive');
    live.textContent = '';
    const word = document.querySelector('[data-ui="timed_announce"]')?.textContent ?? '{n} seconds to choose';
    window.setTimeout(() => { live.textContent = word.replace('{n}', String(Math.ceil(total))); }, 50); // after the menu is on screen, so it is read
    let left = total, last = performance.now();
    const ep = this.epoch;
    clearInterval(this.menuClock);
    this.menuClock = window.setInterval(() => {
      const now = performance.now(), dt = (now - last) / 1000;
      last = now;
      if (ep !== this.epoch || !this.menuOpen) { clearInterval(this.menuClock); return; }
      if (!this.paused && !document.hidden && stage.dataset.uiHidden !== 'true') left -= Math.min(dt, 0.5);
      const frac = Math.max(0, left / total);
      fill.style.transform = `scaleX(${frac})`;
      bar.dataset.low = String(frac <= 0.25);
      if (left > 0) return;
      clearInterval(this.menuClock);
      bar.remove();
      this.menuOpen = false;
      menuEl.dataset.visible = 'false';
      resolve(timeoutAnswer);
    }, 50);
  }

  /** A HUD event is waiting: end the line on screen now (the runtime shows it again after the event). */
  interruptLine() { this.endLine?.(); }

  /** Draw the HUD screens (the runtime pushes them again before every line, so variables stay live). */
  hudViews: ScreenView[] = [];
  async hud(views: ScreenView[]) {
    this.hudViews = views;
    const ep = this.epoch;
    const key = (file: string) => file.replace(IMAGE_FILE, '');
    const parts = views.flatMap(v => v.parts);
    const keys = parts.flatMap(p => (p.kind === 'image' ? [key(p.file)] : []));
    if (keys.some(k => !this.ready.has(k))) { await this.ensure(keys); if (ep !== this.epoch || this.hudViews !== views) return; }
    this.hudLayer.update(views, file => this.imageUrl(file));
  }

  /** Draw the quick menu screen (null: hide it). Its view is pushed again with the HUD. */
  quickShown = true;
  async quick(view: ScreenView | null) {
    const shown = this.quickShown ? view : null;
    this.quickView = shown;
    const ep = this.epoch;
    const key = (file: string) => file.replace(IMAGE_FILE, '');
    const keys = (shown?.parts ?? []).flatMap(p => (p.kind === 'image' ? [key(p.file)] : []));
    if (keys.some(k => !this.ready.has(k))) { await this.ensure(keys); if (ep !== this.epoch || this.quickView !== shown) return; }
    this.quickLayer.update(shown ? [shown] : [], file => this.imageUrl(file));
    this.onModeChange(); // a redraw drops the pressed state of Auto and Skip
  }

  /** Draw the project's pause screen (null: hide it). */
  async pause(view: ScreenView | null) {
    this.pauseView = view;
    const ep = this.epoch;
    const key = (file: string) => file.replace(IMAGE_FILE, '');
    const keys = (view?.parts ?? []).flatMap(p => (p.kind === 'image' ? [key(p.file)] : []));
    if (keys.some(k => !this.ready.has(k))) { await this.ensure(keys); if (ep !== this.epoch || this.pauseView !== view) return; }
    this.pauseLayer.update(view ? [view] : [], file => this.imageUrl(file));
    if (view) this.pauseLayer.focusFirst();
  }

  /** Draw the project's options screen (null: hide it). A redraw keeps the focus; only the first one moves it onto the screen. */
  async options(view: ScreenView | null) {
    const fresh = !this.optionsView && !!view;
    this.optionsView = view;
    const ep = this.epoch;
    const key = (file: string) => file.replace(IMAGE_FILE, '');
    const keys = (view?.parts ?? []).flatMap(p => (p.kind === 'image' ? [key(p.file)] : []));
    if (keys.some(k => !this.ready.has(k))) { await this.ensure(keys); if (ep !== this.epoch || this.optionsView !== view) return; }
    this.optionsLayer.update(view ? [view] : [], file => this.imageUrl(file));
    if (fresh) this.optionsLayer.focusFirst();
  }

  /** Draw the project's saves screen (null: hide it). A redraw keeps the focus; only the first one moves it onto the screen. */
  async saves(view: ScreenView | null) {
    const fresh = !this.savesView && !!view;
    this.savesView = view;
    const ep = this.epoch;
    const key = (file: string) => file.replace(IMAGE_FILE, '');
    const keys = (view?.parts ?? []).flatMap(p => (p.kind === 'image' ? [key(p.file)] : []));
    if (keys.some(k => !this.ready.has(k))) { await this.ensure(keys); if (ep !== this.epoch || this.savesView !== view) return; }
    this.savesLayer.update(view ? [view] : [], file => this.imageUrl(file));
    if (fresh) this.savesLayer.focusFirst();
  }

  /** Draw the project's history screen (null: hide it). A redraw (scrolling) keeps the focus; only the first one moves it onto the screen. */
  async history(view: ScreenView | null) {
    const fresh = !this.historyView && !!view;
    this.historyView = view;
    const ep = this.epoch;
    const key = (file: string) => file.replace(IMAGE_FILE, '');
    const keys = (view?.parts ?? []).flatMap(p => (p.kind === 'image' ? [key(p.file)] : []));
    if (keys.some(k => !this.ready.has(k))) { await this.ensure(keys); if (ep !== this.epoch || this.historyView !== view) return; }
    this.historyLayer.update(view ? [view] : [], file => this.imageUrl(file));
    if (fresh) this.historyLayer.focusFirst();
  }

  /** Draw the project's gallery screen (null: hide it). The first draw puts focus on the element `focusId` (the tile last viewed) or the first one. */
  async gallery(view: ScreenView | null, focusId = '') {
    const fresh = !this.galleryView && !!view;
    this.galleryView = view;
    const ep = this.epoch;
    const key = (file: string) => file.replace(IMAGE_FILE, '');
    const keys = (view?.parts ?? []).flatMap(p => (p.kind === 'image' && p.file ? [key(p.file)] : []));
    if (keys.some(k => !this.ready.has(k))) { await this.ensure(keys); if (ep !== this.epoch || this.galleryView !== view) return; }
    this.galleryLayer.update(view ? [view] : [], file => this.imageUrl(file));
    if (fresh) this.galleryLayer.focusFirst(focusId);
  }

  /** Draw the project's viewer screen (null: hide it). Paging redraws it; only the first draw moves focus onto it. */
  async viewer(view: ScreenView | null) {
    const fresh = !this.viewerView && !!view;
    this.viewerView = view;
    const ep = this.epoch;
    const key = (file: string) => file.replace(IMAGE_FILE, '');
    const keys = (view?.parts ?? []).flatMap(p => (p.kind === 'image' && p.file ? [key(p.file)] : []));
    if (keys.some(k => !this.ready.has(k))) { await this.ensure(keys); if (ep !== this.epoch || this.viewerView !== view) return; }
    this.viewerLayer.update(view ? [view] : [], file => this.imageUrl(file));
    if (fresh) this.viewerLayer.focusFirst();
  }

  /** Draw the project's music screen (null: hide it). The first draw puts focus on the element `focusId` or the first one; redraws keep the focus. */
  async music(view: ScreenView | null, focusId = '') {
    const fresh = !this.musicView && !!view;
    this.musicView = view;
    const ep = this.epoch;
    const key = (file: string) => file.replace(IMAGE_FILE, '');
    const keys = (view?.parts ?? []).flatMap(p => (p.kind === 'image' && p.file ? [key(p.file)] : []));
    if (keys.some(k => !this.ready.has(k))) { await this.ensure(keys); if (ep !== this.epoch || this.musicView !== view) return; }
    this.musicLayer.update(view ? [view] : [], file => this.imageUrl(file));
    if (fresh) this.musicLayer.focusFirst(focusId);
  }

  /** Draw the project's chapter select (null: hide it). */
  async chapters(view: ScreenView | null, focusId = '') {
    const fresh = !this.chaptersView && !!view;
    this.chaptersView = view;
    const ep = this.epoch;
    const key = (file: string) => file.replace(IMAGE_FILE, '');
    const keys = (view?.parts ?? []).flatMap(p => (p.kind === 'image' && p.file ? [key(p.file)] : []));
    if (keys.some(k => !this.ready.has(k))) { await this.ensure(keys); if (ep !== this.epoch || this.chaptersView !== view) return; }
    this.chaptersLayer.update(view ? [view] : [], file => this.imageUrl(file));
    if (fresh) this.chaptersLayer.focusFirst(focusId);
  }

  /** Draw the project's achievements list (null: hide it). */
  async achievements(view: ScreenView | null) {
    const fresh = !this.achievementsView && !!view;
    this.achievementsView = view;
    const ep = this.epoch;
    const key = (file: string) => file.replace(IMAGE_FILE, '');
    const keys = (view?.parts ?? []).flatMap(p => (p.kind === 'image' && p.file ? [key(p.file)] : []));
    if (keys.some(k => !this.ready.has(k))) { await this.ensure(keys); if (ep !== this.epoch || this.achievementsView !== view) return; }
    this.achievementsLayer.update(view ? [view] : [], file => this.imageUrl(file));
    if (fresh) this.achievementsLayer.focusFirst();
  }

  /** Draw the achievement toast for one unlock (null: hide it). */
  async achievementToast(view: ScreenView | null) {
    this.achToastView = view;
    const key = (file: string) => file.replace(IMAGE_FILE, '');
    const keys = (view?.parts ?? []).flatMap(p => (p.kind === 'image' && p.file ? [key(p.file)] : []));
    if (keys.some(k => !this.ready.has(k))) { await this.ensure(keys); if (this.achToastView !== view) return; }
    this.achToastLayer.update(view ? [view] : [], file => this.imageUrl(file));
  }

  /** Draw the project's title screen (null: hide it; `instant`: without its `on exit`, for when the curtain hides the change). */
  async title(view: ScreenView | null, instant = false) {
    this.titleView = view;
    const ep = this.epoch;
    const key = (file: string) => file.replace(IMAGE_FILE, '');
    const keys = (view?.parts ?? []).flatMap(p => (p.kind === 'image' ? [key(p.file)] : []));
    if (keys.some(k => !this.ready.has(k))) { await this.ensure(keys); if (ep !== this.epoch || this.titleView !== view) return; }
    this.titleLayer.update(view ? [view] : [], file => this.imageUrl(file), !instant);
    if (view) this.titleLayer.focusFirst();
  }

  /** Show a custom screen: its images are loaded first, then it waits for the player to pick an element. */
  async screen(view: ScreenView, src: Src, live?: ScreenLive): Promise<string> {
    this.onPosition(src);
    this.lineSpeaker = null;
    if (this.skipping) { this.skipping = false; this.onModeChange(); } // screens are always the player's
    const ep = this.epoch;
    const key = (file: string) => file.replace(IMAGE_FILE, '');
    await this.ensure(view.parts.flatMap(p => (p.kind === 'image' ? [key(p.file)] : 'shape' in p && p.shape.k === 'mask' ? [key(p.shape.file)] : [])));
    if (ep !== this.epoch) return ''; // replaced while loading: the runtime has moved on and ignores this
    this.menuOpen = true;
    // `textbox off` on the screen: the last line must not stay under it; the next line shows the box again. (An NVL page is not the box and stays.)
    if (view.hideBox) { box.dataset.visible = 'false'; delete box.dataset.side; }
    const id = await this.screens.show(view, file => this.imageUrl(file), live && {
      set: (name, value) => { // a page that shows new pictures: they load, then the screen is drawn once more with them
        const next = live.set(name, value);
        const missing = next.parts.flatMap(p => (p.kind === 'image' ? [key(p.file)] : [])).filter(k => !this.ready.has(k));
        if (missing.length) void this.ensure(missing).then(() => { if (ep === this.epoch) this.screens.refresh(); });
        return next;
      },
    });
    if (ep === this.epoch) this.menuOpen = false;
    return id;
  }

  input(prompt: string, def: string, max: number, src: Src): Promise<string> {
    this.onPosition(src);
    this.lineSpeaker = null;
    if (this.skipping) { this.skipping = false; this.onModeChange(); }
    return new Promise<string>(resolve => {
      this.menuOpen = true;
      const label = document.createElement('div');
      label.className = 'prompt';
      label.textContent = prompt;
      const field = document.createElement('input');
      field.type = 'text';
      field.maxLength = max;
      field.value = def;
      field.autocomplete = 'off';
      field.spellcheck = false;
      const ok = document.createElement('button');
      ok.type = 'button';
      ok.textContent = 'OK';
      ok.dataset.ok = 'true';
      const board = oskBoard(field, max);
      // In the editor the field waits for the player to enter the preview (a click or Alt+2) before taking focus.
      const takeFocus = () => { if (autoFocus(field)) { field.select(); window.removeEventListener('focus', takeFocus); } };
      const submit = () => {
        window.removeEventListener('focus', takeFocus);
        this.menuOpen = false;
        menuEl.dataset.visible = 'false';
        resolve(field.value.trim() || def);
      };
      ok.addEventListener('click', e => { e.stopPropagation(); submit(); });
      field.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
      menuEl.replaceChildren(label, field, board, ok);
      menuEl.dataset.visible = 'true';
      window.addEventListener('focus', takeFocus);
      takeFocus();
    });
  }

  end() {
    box.dataset.visible = 'false';
    this.clearPage();
    endedEl.style.display = 'block';
    this.advanceFn = () => { this.advanceFn = null; this.onEnded(); };
  }
}
