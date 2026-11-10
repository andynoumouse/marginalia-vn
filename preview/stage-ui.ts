// Shared by the preview renderers: the text box, choice menu, HUD and audio live here (DOM over the
// stage: crisp text, real buttons, any language), so a renderer subclass only draws the world.

import { announceLine, asOptionIndex, type OptionIndex, assetContext, captionFor, sideImageKey, stateAssets, type CaptionTable, type AssetContext, type CharacterDef, type DisplayState, type MenuItem, type PreloadTask, type ScreenLive, type Renderer, type Resident, type ScreenView,  type RigManifest, type SayEvent, type SideImages, type SpeakerFocus, type Src, type VisualOp } from '../engine/src/index.js';
import { AssetLoader, assetKey } from './asset-loader.js';
import { AudioSystem } from './audio.js';
import { Movies, type MovieOptions } from './movies.js';
import { HudLayer, ScreenLayer } from './screen-ui.js';
import { IMAGE_FILE, imageKeys, ScreenSlots } from './screen-slots.js';
import { Blips } from './blips.js';
import { autoFocus, oskBoard } from './input.js';
import { typeLine, type TypeHost } from './line-typer.js';
import { appendRuns } from './line-text.js';

export { W, H } from './stage-size.js';

/** Visual ops that change the picture; music, sound and wait are handled here. */
export type WorldOp = Exclude<VisualOp, { op: 'music' | 'sound' | 'movie' | 'wait' | 'perform' }>;
/** A file under assets/ as listed by the dev server; `v` changes when the file does. */
/** One file of the project's assets/ folder and its version stamp; `url` says where to load it from when that is not assets/<file> (the standalone studio's host hands over blob: URLs). */
export interface AssetFile { file: string; v: number; url?: string }
/** Where an asset is loaded from. */
export const assetUrl = (a: AssetFile) => a.url ?? `assets/${a.file}?v=${a.v}`;

export const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
export const hue = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export const stage = $('stage');

// A key must not pick for the player as the choices come up (UX round PC-1). Space or Enter pressed to read the line, tapped again
// or held (auto-repeat) as the menu appears, clicked the focused first option about 55 ms later. A click a Space or Enter made
// (detail 0, in the same moment as the key) is ignored for a moment after the choices show, and while a key is still repeating.
export const CHOICE_GUARD_MS = 300;
let lastRepeatAt = -Infinity, lastActivationKeyAt = -Infinity;
const noteKey = (e: KeyboardEvent) => {
  const now = performance.now();
  if (e.repeat) lastRepeatAt = now;
  if (e.key === ' ' || e.key === 'Enter') lastActivationKeyAt = now;
};
window.addEventListener('keydown', noteKey, true);
window.addEventListener('keyup', noteKey, true);
/** A gamepad's confirm is an activation like Space or Enter: it clicks the focused button, so the choices' guard sees it too (UX round PC-1). */
export const notePadConfirm = () => { lastActivationKeyAt = performance.now(); };
/** True for a click that came from Space or Enter too soon after the choices were shown at `shownAt`, or from a held key. */
const keyStrayedIn = (e: MouseEvent, shownAt: number) => {
  const now = performance.now();
  return e.detail === 0 && now - lastActivationKeyAt < 50 && (now - shownAt < CHOICE_GUARD_MS || now - lastRepeatAt < CHOICE_GUARD_MS);
};
const nvlEl = $('nvl'), nvlPage = $('nvl-page');
const box = $('box'), sideEl = $<HTMLImageElement>('side'), nameEl = $('name'), textEl = $('text'), menuEl = $('menu'), hud = $('hud'), endedEl = $('ended');

/** A line as the shell sees it (history, saves). */
export interface LineInfo { name: string | null; color: string | null; text: string; /** localization id, for the line's voice recording */ id?: string }

const lineInfoOf = (ev: SayEvent): LineInfo => ({ name: ev.name, color: ev.color, text: ev.segments.map(s => (s.kind === 'text' ? s.text : '')).join(''), ...(ev.id ? { id: ev.id } : {}) });


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
  /** A line was put back in the box without being played (showLine): it is the line on screen for a save, but not a moment of the history. */
  onLineShown: (line: LineInfo) => void = () => {};
  onEnded: () => void = () => {};
  /** The story reached its end: the shell takes the quick bar down before "The End" shows. */
  onEnd: () => void = () => {};
  /** The language of the voice recordings played (assets/voice/<id>.<lang>.*): the player's voice setting, which defaults to the text language. */
  lang = 'en';
  /** The line on screen has a voice recording (or no longer does): the shell shows or hides its replay button. */
  onVoice: (voiced: boolean) => void = () => {};
  private lineVoice: string | null = null; // id of the line on screen, while it has a recording
  /** Play the recording of the line on screen again (the replay button, key V). */
  replayVoice() { if (this.lineVoice) void this.audio.voice(this.lineVoice, this.lang); }
  /** Whether line `id` has a recording in the voice language, and playing it (the history screen's replay button). */
  hasVoice(id: string | undefined): boolean { return !!id && this.audio.hasVoice(id, this.lang); }
  playVoice(id: string | undefined) { if (id) void this.audio.voice(id, this.lang); }
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
  /** The built-in screens (quick menu, title, pause, options, ...): their layers, views and the shell's action callbacks. */
  readonly slots = new ScreenSlots({
    hoverSound: n => this.hoverSound(n), paused: () => this.paused, epoch: () => this.epoch,
    isReady: k => this.loader.isReady(k), ensure: k => this.ensure(k), imageUrl: f => this.imageUrl(f),
  });
  /** `hover sound "name"` on a screen or HUD element; a sound that is not there is silent. */
  private hoverSound(name: string) { if (this.audio.has('sound', name)) void this.audio.sound(name); }
  private endLine: (() => void) | null = null;
  /** The typing of a line (line-typer.ts) reaches the renderer's settings and shared hooks through this. */
  private readonly typeHost: TypeHost = ((r: StageRenderer): TypeHost => ({
    get skipping() { return r.skipping; }, set skipping(v) { r.skipping = v; },
    get autoOn() { return r.autoOn; }, set autoOn(v) { r.autoOn = v; },
    get autoDelay() { return r.autoDelay; }, set autoDelay(v) { r.autoDelay = v; },
    get textSpeed() { return r.textSpeed; }, set textSpeed(v) { r.textSpeed = v; },
    get paused() { return r.paused; }, set paused(v) { r.paused = v; },
    get lang() { return r.lang; }, set lang(v) { r.lang = v; },
    audio: r.audio,
    get advanceFn() { return r.advanceFn; }, set advanceFn(v) { r.advanceFn = v; },
    get endLine() { return r.endLine; }, set endLine(v) { r.endLine = v; },
    get lineKick() { return r.lineKick; }, set lineKick(v) { r.lineKick = v; },
    get lineVoice() { return r.lineVoice; }, set lineVoice(v) { r.lineVoice = v; },
    get typeTimer() { return r.typeTimer; }, set typeTimer(v) { r.typeTimer = v; },
    get settleTimer() { return r.settleTimer; }, set settleTimer(v) { r.settleTimer = v; },
    onVoice: v => r.onVoice(v),
    announce: (n, t) => r.announce(n, t),
    dropSkipping: () => r.dropSkipping(),
    speakTick: w => r.speakTick(w),
    fitPage: () => r.fitPage(),
  }))(this);
  private readonly movies = new Movies(this.audio, $('movie'));
  private imageUrls = new Map<string, string>();        // asset key -> URL of the image file, for the DOM layers
  /** What is loaded and loading, and the lookahead that fetches files early. */
  private readonly loader = new AssetLoader($('loading'), {
    fetch: key => this.fetchAsset(key),
    voice: id => this.audio.prefetchVoice(id, this.lang),
  }, () => this.skipping);

  /**
   * Take stock of the project's files; called before the runtime (re)starts, again on every hot reload. Nothing
   * big is fetched here: images and music load when the story gets near them (see ensure).
   */
  async preload(assets: AssetFile[], rigs: Record<string, RigManifest> = {}, uncued: string[] = []): Promise<void> {
    this.audio.setAssets(assets);
    // Text blip samples are needed by the first lines, and `uncued` sounds (uncuedSounds: screen hover sounds and the like)
    // can play at any moment; both load in the background. Other sounds and music come through the lookahead.
    const blips = [...Object.values(this.characters).map(c => c.style.blip), ...Object.values(this.blips.voices).flatMap(v => [v.sound, ...Object.values(v.vowels ?? {})])];
    this.audio.prefetchSounds([...blips.filter((b): b is string => !!b), ...uncued]);
    this.files = assetContext({ files: assets.map(a => a.file), rigs });
    // Files that changed or went away must load again.
    this.loader.setVersions(new Map(assets.map(a => [assetKey(a.file), a.v] as const)));
    this.imageUrls = new Map(assets.filter(a => IMAGE_FILE.test(a.file)).map(a => [assetKey(a.file), assetUrl(a)] as const));
    this.movies.setFiles(assets.map(a => ({ file: a.file, url: assetUrl(a) })));
    // Portraits are small and appear without warning (any line), so the browser fetches them all up front.
    if (this.sideImages) for (const [key, url] of this.imageUrls) if (key.startsWith('side/')) new Image().src = url;
    this.indexArt(assets);
  }
  /** Files the story had to wait for when it reached them; the lookahead should keep this at 0 (debug console: memory). */
  lateLoads = 0;
  /** Estimated memory of what is loaded: images from the renderer, decoded audio from the audio system. */
  resident(): Resident[] { return [...this.residentImages(), ...this.audio.resident()]; }
  protected residentImages(): Resident[] { return []; }
  /** Stencil masks drawn on stage now (rig.json `masks`); the debug console's `memory` reports it. */
  maskCount(): number { return 0; }
  /** The URL of an image a screen names: an asset, or a picture the shell hands over as a data: URL (a save slot's thumbnail). */
  private imageUrl(file: string): string | null { return file.startsWith('data:image/') ? file : this.imageUrls.get(file.replace(IMAGE_FILE, '')) ?? null; }
  /** The renderer learns which image files exist (and which changed). */
  protected indexArt(_assets: AssetFile[]): void {}
  /** Load one image into the renderer; never rejects (a missing or broken file is drawn as a placeholder). */
  protected async loadImage(_key: string): Promise<void> {}

  /** Load the files behind these asset keys (images, music, sounds, movies) and resolve once they are all ready. */
  ensure(keys: string[]): Promise<void> { return this.loader.ensure(keys); }
  /** Load one asset key for the loader: a movie is only buffered, audio is fetched, anything else is an image. */
  private fetchAsset(key: string): Promise<void> {
    const m = /^(music|sound)\/(.+)$/.exec(key);
    if (key.startsWith('movie/')) { this.movies.warmUp(key.slice(6)); return Promise.resolve(); }
    return m ? this.audio.prefetch(m[1] as 'music' | 'sound', m[2]) : this.loadImage(key);
  }
  /** A looping video of `movie/<name>` for an overlay picture (the warmed one when the story looked ahead); null without a file. */
  protected takeLoopVideo(key: string): HTMLVideoElement | null { return this.movies.takeLoop(key.slice(6)); }
  protected releaseVideo(video: HTMLVideoElement) { this.movies.release(video); }
  /** The volume sliders changed: the videos of looping pictures follow them. */
  syncMediaVolume() { this.movies.syncVolume(); }
  /** Play a movie over the stage and resolve when it ends or is skipped. */
  private async playMovie(name: string, opts: MovieOptions, ep: number): Promise<void> {
    if (!this.movies.has(name)) { // no file yet: a text cue, so the script can be followed before the footage exists
      hud.textContent = `movie: ${name}`;
      await sleep(900);
      if (ep === this.epoch && this.onStage) this.showMusic(this.onStage);
      return;
    }
    const musicWas = this.onStage?.music && !this.onStage.musicPaused;
    if (musicWas) this.audio.pauseMusic(0.3);
    await this.movies.play(name, opts);
    if (musicWas && ep === this.epoch) this.audio.resumeMusic(0.3);
  }

  /** The story came near these assets (nearest first; see Preload in the engine): fetch them a few at a time. */
  prefetch(tasks: PreloadTask[], always: string[]) { this.loader.prefetch(tasks, always); }
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
    if (this.movies.skip()) return;
    if (this.skipping) { this.setSkipping(false); return; }
    this.advanceFn?.();
  }

  setSkipping(on: boolean) {
    if (this.skipping === on) return;
    this.skipping = on;
    this.onModeChange();
    this.refresh();
  }

  /** Stop skipping because the story needs the player (unread text, a choice, a screen, a prompt); unlike setSkipping, the line on screen is left alone. */
  private dropSkipping() {
    if (!this.skipping) return;
    this.skipping = false;
    this.onModeChange();
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
    this.movies.stop();
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
      this.lateLoads += new Set(this.loader.pending(keys)).size;
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
        if (!this.skipping) await this.playMovie(op.name, { noskip: op.noskip, loop: op.loop }, ep);
        return;
      case 'wait':
        if (!this.skipping) await sleep(op.dur * 1000);
        return;
      case 'perform': // the runtime has already turned it into the actors' own `animate` ops
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
    const info = lineInfoOf(ev);
    const plain = info.text;
    this.onPosition(ev.src, info);
    const wasSeen = this.isSeen(ev);
    this.markSeen(ev);
    this.lineSpeaker = ev.who;
    const skippable = () => this.skipAll || wasSeen;
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
    this.dressText(ev, target);
    const blip = this.blips.forLine(ev.style.blip);
    return typeLine(this.typeHost, { ev, frame, target, plain, skippable, blip });
  }

  /** The speaker's style (define ... text= font= size= italic style=); theme skins are keyed by `box`. */
  private dressText(ev: SayEvent, target: HTMLElement) {
    const st = ev.style;
    stage.dataset.skin = ev.nvl ? '' : ev.look ?? st.box ?? '';
    target.style.color = st.textColor ?? '';
    target.style.fontFamily = st.font ? `"${st.font}", var(--vn-font)` : '';
    target.style.fontSize = st.size ? `calc(var(--text-size, 44px) * var(--text-scale, 1) * ${st.size})` : '';
    target.style.fontStyle = st.italic ? 'italic' : '';
  }

  /** A restore ended at a choice, prompt or screen: the line before it is in the box in full, as it was on the first visit. It is not announced or recorded again. */
  showLine(ev: SayEvent) {
    box.dataset.visible = 'true';
    box.dataset.done = 'true';
    nameEl.textContent = ev.name ?? '';
    nameEl.style.setProperty('--ncolor', ev.color ?? '#ffffff');
    this.showSide(ev);
    textEl.replaceChildren();
    appendRuns(textEl, ev.segments);
    this.dressText(ev, textEl);
    this.onLineShown(lineInfoOf(ev));
  }

  menu(options: MenuItem[], src: Src, prompt?: string, timer?: { seconds: number }, style?: string): Promise<OptionIndex> {
    this.onPosition(src);
    if (style) menuEl.dataset.style = style; else delete menuEl.dataset.style; // theme styles[style].choice
    this.lineSpeaker = null;
    this.dropSkipping(); // choices are always the player's
    return new Promise<OptionIndex>(resolve => {
      this.menuOpen = true;
      const shownAt = performance.now();
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
          if (keyStrayedIn(e, shownAt)) return;
          clearInterval(this.menuClock);
          menuEl.querySelector('.timer')?.remove();
          this.menuOpen = false;
          menuEl.dataset.visible = 'false';
          // Focus left on a button outside the choices (Tab went on to the quick menu's Back) would take the next Space or Enter.
          if (document.activeElement instanceof HTMLElement && !menuEl.contains(document.activeElement)) document.activeElement.blur();
          resolve(asOptionIndex(i));
        });
        return b;
      }));
      if (timer && this.timedChoices !== 'off') this.startClock(timer.seconds * (this.timedChoices === 'extended' ? 3 : 1), options.length, i => resolve(asOptionIndex(i)));
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
    const keys = imageKeys(views);
    if (keys.some(k => !this.loader.isReady(k))) { await this.ensure(keys); if (ep !== this.epoch || this.hudViews !== views) return; }
    this.hudLayer.update(views, file => this.imageUrl(file));
  }


  /** Draw the quick menu screen (null: hide it). Its view is pushed again with the HUD. */
  quickShown = true;
  quick(view: ScreenView | null) {
    return this.slots.draw('quick', this.quickShown ? view : null, { after: () => this.onModeChange() }); // a redraw drops the pressed state of Auto and Skip
  }

  /** Draw the project's pause screen (null: hide it). */
  pause(view: ScreenView | null) { return this.slots.draw('pause', view, { focus: 'always' }); }

  /** Draw the project's options screen (null: hide it). A redraw keeps the focus; only the first one moves it onto the screen. */
  options(view: ScreenView | null) { return this.slots.draw('options', view, { focus: 'first' }); }

  /** Draw the project's saves screen (null: hide it). A redraw keeps the focus; only the first one moves it onto the screen. */
  saves(view: ScreenView | null) { return this.slots.draw('saves', view, { focus: 'first' }); }

  /** Draw the project's history screen (null: hide it). A redraw (scrolling) keeps the focus; only the first one moves it onto the screen. */
  history(view: ScreenView | null) { return this.slots.draw('history', view, { focus: 'first' }); }

  /** Draw the project's gallery screen (null: hide it). The first draw puts focus on the element `focusId` (the tile last viewed) or the first one. */
  gallery(view: ScreenView | null, focusId = '') { return this.slots.draw('gallery', view, { focus: 'first', focusId }); }

  /** Draw the project's viewer screen (null: hide it). Paging redraws it; only the first draw moves focus onto it. */
  viewer(view: ScreenView | null) { return this.slots.draw('viewer', view, { focus: 'first' }); }

  /** Draw the project's music screen (null: hide it). The first draw puts focus on the element `focusId` or the first one; redraws keep the focus. */
  music(view: ScreenView | null, focusId = '') { return this.slots.draw('music', view, { focus: 'first', focusId }); }

  /** Draw the project's chapter select (null: hide it). */
  chapters(view: ScreenView | null, focusId = '') { return this.slots.draw('chapters', view, { focus: 'first', focusId }); }

  /** Draw the project's achievements list (null: hide it). */
  achievements(view: ScreenView | null) { return this.slots.draw('achievements', view, { focus: 'first' }); }

  /** Draw the achievement toast for one unlock (null: hide it). */
  achievementToast(view: ScreenView | null) { return this.slots.draw('achToast', view, { guardEpoch: false }); }

  /** Draw the project's title screen (null: hide it; `instant`: without its `on exit`, for when the curtain hides the change). */
  title(view: ScreenView | null, instant = false, focusId = '') { return this.slots.draw('title', view, { focus: 'always', leave: !instant, focusId }); }

  /** Show a custom screen: its images are loaded first, then it waits for the player to pick an element. */
  async screen(view: ScreenView, src: Src, live?: ScreenLive): Promise<string> {
    this.onPosition(src);
    this.lineSpeaker = null;
    this.dropSkipping(); // screens are always the player's
    const ep = this.epoch;
    const key = (file: string) => file.replace(IMAGE_FILE, '');
    await this.ensure([...imageKeys([view]), ...view.parts.flatMap(p => ('shape' in p && p.shape.k === 'mask' ? [key(p.shape.file)] : []))]);
    if (ep !== this.epoch) return ''; // replaced while loading: the runtime has moved on and ignores this
    this.menuOpen = true;
    // `textbox off` on the screen: the last line must not stay under it; the next line shows the box again. (An NVL page is not the box and stays.)
    if (view.hideBox) { box.dataset.visible = 'false'; delete box.dataset.side; }
    const id = await this.screens.show(view, file => this.imageUrl(file), live && {
      set: (name, value) => { // a page that shows new pictures: they load, then the screen is drawn once more with them
        const next = live.set(name, value);
        const missing = imageKeys([next]).filter(k => !this.loader.isReady(k));
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
    this.dropSkipping();
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
    this.onEnd();
    // The words are the translated hidden labels (game.json `labels`, `ui.end_title` / `ui.end_hint`); the editor's preview says what an author means.
    const dev = endedEl.dataset.dev === 'true';
    const word = (key: string, fallback: string) => document.querySelector(`[data-ui="${key}"]`)?.textContent ?? fallback;
    endedEl.querySelector('.end-title')!.textContent = dev ? 'End of script' : word('end_title', 'The End');
    endedEl.querySelector('.end-hint')!.textContent = dev ? 'Click to restart' : word('end_hint', 'Click to return to the title screen');
    endedEl.style.display = 'flex';
    this.advanceFn = () => { this.advanceFn = null; this.onEnded(); };
  }
}
