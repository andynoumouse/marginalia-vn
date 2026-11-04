// Web Audio playback: a master bus with a music bus and a sound bus under it.
//   music play <name>   assets/music/<name>.(ogg|mp3|wav|m4a|flac|opus)
//   sound play <name>   assets/sound/<name>.(same)
//   sound loop <name>   a looping sound on its own channel (ambience), any number at once
//   voice lines         assets/voice/<line id>[.<lang>].(same), found from each line's localization id (engine/src/voice.ts)
//   music pause/resume  keeps the position; `duck` dips the music bus while a sound plays
// Browsers keep the context suspended until a user gesture: call unlock() from one (click, key).

import { audioBytes, type Resident } from '../engine/src/residency.js';
import { voiceFile } from '../engine/src/voice.js';
import type { AssetFile } from './stage-ui.js';

const AUDIO = /^(music|sound|voice)\/(.+)\.(ogg|mp3|wav|m4a|flac|opus)$/i;
/** Decoded voice lines kept for the lookahead; a recording is a few hundred KB of PCM per line. */
const VOICE_CACHE = 12;
export type Bus = 'master' | 'music' | 'sound' | 'voice';

interface Track { name: string; source: AudioBufferSourceNode; gain: GainNode; buffer: AudioBuffer; loop: boolean; startedAt: number; offset: number }
/** Music held by `music pause`: where to carry on. */
interface Paused { name: string; buffer: AudioBuffer; loop: boolean; offset: number }

const DUCK_LEVEL = 0.3; // music gain while a `duck` sound plays

export class AudioSystem {
  readonly ctx = new AudioContext();
  private buses: Record<Bus, GainNode>;
  private files = new Map<string, string>();                         // "music/theme" -> url
  private buffers = new Map<string, Promise<AudioBuffer | null>>();  // url -> decoded audio
  private sizes = new Map<string, number>();                         // url -> estimated bytes once decoded
  private prefetching = 0; // generation of the background sound prefetch
  private track: Track | null = null;
  private wanted: string | null = null; // last requested track; loads are async, so this decides who wins
  private paused: Paused | null = null;
  private ambience = new Map<string, Track>(); // looping sounds (`sound loop`) by name
  private ambienceWanted = new Set<string>();   // names that should be looping; loads are async
  private duckGain: GainNode;
  private duckUntil = 0;
  private voiceRun = 0; // bumped to cancel a voice that is still loading
  private voiceCache = new Map<string, Promise<AudioBuffer | null>>(); // decoded recordings by URL, least recently used first
  private voiceSource: AudioBufferSourceNode | null = null;

  constructor() {
    const master = this.ctx.createGain();
    master.connect(this.ctx.destination);
    const music = this.ctx.createGain(), sound = this.ctx.createGain(), voice = this.ctx.createGain();
    const duck = this.ctx.createGain();
    music.connect(duck).connect(master);
    sound.connect(master);
    voice.connect(master);
    this.duckGain = duck;
    this.buses = { master, music, sound, voice };
  }

  private levels: Record<Bus, number> = { master: 1, music: 1, sound: 1, voice: 1 };
  /** Volume for a movie's own sound track (a media element, outside the buses): the master and sound sliders together. */
  mediaVolume() { return (this.levels.master * this.levels.sound) ** 2; }

  unlock() {
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** 0..1 slider value; squared so the slider feels even to the ear. */
  setVolume(bus: Bus, value: number) {
    this.levels[bus] = value;
    this.buses[bus].gain.setTargetAtTime(value * value, this.ctx.currentTime, 0.02);
  }

  /**
   * Remember which audio files exist. Nothing is fetched or decoded here: decoded audio is large (a 3 minute
   * track is about 60 MB), so files load when first needed, or when prefetch() asks.
   */
  setAssets(assets: AssetFile[]) {
    this.files.clear();
    this.prefetching++; // ends a background prefetch started for the previous list
    for (const a of assets) {
      const m = AUDIO.exec(a.file);
      if (m) this.files.set(`${m[1].toLowerCase()}/${m[2]}`, `assets/${a.file}?v=${a.v}`);
    }
    const current = new Set(this.files.values());
    for (const url of [...this.buffers.keys()]) if (!current.has(url)) { this.buffers.delete(url); this.sizes.delete(url); } // edited or removed files
  }

  /** Estimated memory of the decoded music and sounds (the voice cache is small and not counted). */
  resident(): Resident[] {
    return [...this.files].flatMap(([key, url]) => {
      const bytes = this.sizes.get(url);
      return bytes === undefined || !this.buffers.has(url) ? [] : [{ key, kind: 'audio' as const, bytes }];
    });
  }

  /** Start loading and decoding one file now, so a later play starts on time; resolves when it is ready (or failed). */
  async prefetch(kind: 'music' | 'sound', name: string): Promise<void> {
    const url = this.files.get(`${kind}/${name}`);
    if (url) await this.buffer(url);
  }

  /**
   * Load every sound effect in the background, one at a time while the browser is idle (they are short), the
   * `first` ones before the rest. Music is not included: it is large and is loaded when it starts.
   */
  prefetchSounds(first: string[] = []) {
    const run = ++this.prefetching;
    const names = [...new Set([...first, ...[...this.files.keys()].filter(k => k.startsWith('sound/')).map(k => k.slice(6))])];
    const idle = (fn: () => void) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn) : setTimeout(fn, 50));
    const next = () => {
      const name = names.shift();
      if (name === undefined || run !== this.prefetching) return;
      const url = this.files.get(`sound/${name}`);
      if (!url) { next(); return; }
      void this.buffer(url).then(() => idle(next));
    };
    next(); // the first ones start at once, the rest wait for idle time
  }

  has(kind: 'music' | 'sound', name: string) { return this.files.has(`${kind}/${name}`); }

  /** Whether line `id` has a recording in the language `lang`. */
  hasVoice(id: string | null, lang: string): boolean { return voiceFile(id, lang, n => this.files.has(`voice/${n}`)) !== null; }

  /**
   * Play the recording of line `id`, replacing any voice still playing. Null when the line has none; otherwise a promise that settles when the
   * recording has finished, was stopped or could not be loaded. Voices are decoded for the moment only (a whole game's would not fit in memory).
   */
  voice(id: string | null, lang: string): Promise<void> | null {
    const name = voiceFile(id, lang, n => this.files.has(`voice/${n}`));
    const url = name === null ? undefined : this.files.get(`voice/${name}`);
    if (!url) return null;
    this.stopVoice();
    const run = this.voiceRun;
    return this.voiceBuffer(url)
      .then(buf => new Promise<void>(resolve => {
        if (!buf || run !== this.voiceRun) { resolve(); return; }
        const source = this.ctx.createBufferSource();
        source.buffer = buf;
        source.connect(this.buses.voice);
        source.onended = () => { if (this.voiceSource === source) this.voiceSource = null; resolve(); };
        this.voiceSource = source;
        source.start();
      }));
  }

  /** Decode a recording, keeping the last few (the lines just prefetched, and the one to replay) rather than a whole game's. */
  private voiceBuffer(url: string): Promise<AudioBuffer | null> {
    let p = this.voiceCache.get(url);
    if (p) { this.voiceCache.delete(url); this.voiceCache.set(url, p); return p; } // most recently used last
    p = fetch(url)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })
      .then(data => this.ctx.decodeAudioData(data))
      .catch(e => { console.warn(`Could not load voice ${url}:`, e); this.voiceCache.delete(url); return null; });
    this.voiceCache.set(url, p);
    while (this.voiceCache.size > VOICE_CACHE) this.voiceCache.delete(this.voiceCache.keys().next().value!);
    return p;
  }

  /** Load and decode the recording of line `id` ahead of its line, so the voice starts with the text. */
  async prefetchVoice(id: string, lang: string): Promise<void> {
    const name = voiceFile(id, lang, n => this.files.has(`voice/${n}`));
    const url = name === null ? undefined : this.files.get(`voice/${name}`);
    if (url) await this.voiceBuffer(url);
  }

  /** Cut the voice line that is playing (or loading). */
  stopVoice() {
    this.voiceRun++;
    try { this.voiceSource?.stop(); } catch { /* already ended */ }
    this.voiceSource = null;
  }

  private buffer(url: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(url);
    if (!p) {
      p = fetch(url)
        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })
        .then(data => this.ctx.decodeAudioData(data))
        .then(buf => { this.sizes.set(url, audioBytes(buf.duration, buf.sampleRate, buf.numberOfChannels)); return buf; })
        .catch(e => { console.warn(`Could not load audio ${url}:`, e); return null; });
      this.buffers.set(url, p);
    }
    return p;
  }

  private fadeOut(t: Track, seconds: number) {
    const now = this.ctx.currentTime, end = now + Math.max(seconds, 0.03);
    t.gain.gain.cancelScheduledValues(now);
    t.gain.gain.setValueAtTime(t.gain.gain.value, now);
    t.gain.gain.linearRampToValueAtTime(0, end);
    t.source.stop(end + 0.02);
  }

  private startTrack(name: string, buffer: AudioBuffer, loop: boolean, fade: number, offset: number, bus: GainNode): Track {
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    const gain = this.ctx.createGain();
    source.connect(gain).connect(bus);
    if (fade > 0) {
      gain.gain.setValueAtTime(0, this.ctx.currentTime);
      gain.gain.linearRampToValueAtTime(1, this.ctx.currentTime + fade);
    }
    source.start(0, offset);
    return { name, source, gain, buffer, loop, startedAt: this.ctx.currentTime, offset };
  }

  private playMusic(name: string, buffer: AudioBuffer, loop: boolean, fade: number, offset: number) {
    const track = this.startTrack(name, buffer, loop, fade, offset, this.buses.music);
    track.source.onended = () => {
      if (this.track?.source !== track.source) return;
      this.track = null;
      this.wanted = null; // a one-shot track finished: playing it again should restart it
    };
    this.track = track;
  }

  /**
   * Switch the music to `name` (null = silence), crossfading over `fade` seconds. The same track keeps playing.
   * `paused` holds the track at its start (a restored state); for the same track it pauses or resumes it.
   */
  async music(name: string | null, loop: boolean, fade: number, paused = false) {
    if (name === this.wanted) {
      if (name && paused !== (this.paused !== null)) { if (paused) this.pauseMusic(fade); else this.resumeMusic(fade); }
      return;
    }
    this.wanted = name;
    this.paused = null;
    if (this.track) { this.fadeOut(this.track, fade); this.track = null; }
    const url = name && this.files.get(`music/${name}`);
    if (!url) return;
    const buf = await this.buffer(url);
    if (!buf || this.wanted !== name) return;
    if (paused) this.paused = { name, buffer: buf, loop, offset: 0 };
    else this.playMusic(name, buf, loop, fade, 0);
  }

  /** `music pause`: fade out and remember the position. */
  pauseMusic(fade: number) {
    const t = this.track;
    if (!t) return;
    const pos = this.ctx.currentTime - t.startedAt + t.offset;
    this.paused = { name: t.name, buffer: t.buffer, loop: t.loop, offset: pos };
    this.fadeOut(t, fade);
    this.track = null;
  }

  /** `music resume`: carry on from where `music pause` stopped. */
  resumeMusic(fade: number) {
    const p = this.paused;
    if (!p) return;
    this.paused = null;
    if (p.loop) this.playMusic(p.name, p.buffer, true, fade, p.offset % p.buffer.duration);
    else if (p.offset < p.buffer.duration) this.playMusic(p.name, p.buffer, false, fade, p.offset);
    else this.wanted = null; // it would have ended meanwhile
  }

  /** Make the looping sounds match `names` (the state's ambience): fade out the others, start the new ones. */
  async syncAmbience(names: string[], fade: number) {
    this.ambienceWanted = new Set(names);
    for (const [n, t] of [...this.ambience]) if (!this.ambienceWanted.has(n)) { this.fadeOut(t, fade); this.ambience.delete(n); }
    await Promise.all(names.map(async n => {
      if (this.ambience.has(n)) return;
      const url = this.files.get(`sound/${n}`);
      const buf = url ? await this.buffer(url) : null;
      if (!buf || !this.ambienceWanted.has(n) || this.ambience.has(n)) return;
      this.ambience.set(n, this.startTrack(n, buf, true, fade, 0, this.buses.sound));
    }));
  }

  /** Dip the music for `seconds` while a sound plays, easing back after. */
  private duck(seconds: number) {
    const g = this.duckGain.gain, now = this.ctx.currentTime;
    const end = Math.max(this.duckUntil, now + seconds);
    this.duckUntil = end;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(DUCK_LEVEL, now + 0.08);
    g.setValueAtTime(DUCK_LEVEL, end);
    g.linearRampToValueAtTime(1, end + 0.4);
  }

  /** Play assets/sound/<name>; `rate` changes speed and pitch together (1 = as recorded). */
  async sound(name: string, volume = 1, rate = 1, duck = false) {
    const url = this.files.get(`sound/${name}`);
    const buf = url ? await this.buffer(url) : null;
    if (!buf) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buf;
    source.playbackRate.value = rate;
    if (volume === 1) source.connect(this.buses.sound);
    else {
      const gain = this.ctx.createGain();
      gain.gain.value = volume;
      source.connect(gain).connect(this.buses.sound);
    }
    if (duck) this.duck(buf.duration / rate);
    source.start();
  }

  /** A short synthesized tone on the sound bus (text blips): quick attack, exponential decay. */
  tone(wave: OscillatorType, freq: number, seconds: number, volume: number) {
    const t = this.ctx.currentTime, osc = this.ctx.createOscillator(), gain = this.ctx.createGain();
    osc.type = wave;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    osc.connect(gain).connect(this.buses.sound);
    osc.start(t);
    osc.stop(t + seconds + 0.02);
  }
}
