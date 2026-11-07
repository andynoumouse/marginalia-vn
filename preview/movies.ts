// Movies for the stage renderer: the `movie` command's full-stage player, the videos buffered ahead of it, and the
// looping videos behind overlay pictures. Movies are named as in the script (`movie/<name>.mp4` is `<name>`).

import type { AudioSystem } from './audio.js';

const MOVIE_FILE = /^movie\/[^/]+\.(webm|mp4|m4v|ogv)$/i;
/** Movies warmed up ahead of `movie play` (each buffers a few seconds, so only the nearest few are kept). */
const WARM_MOVIES = 2;

/** How a `movie` plays: `noskip` ignores the player's skip, `loop` repeats it until the player skips. */
export interface MovieOptions { noskip: boolean; loop: boolean }

export class Movies {
  private urls = new Map<string, string>();               // movie name -> URL of the video file
  private warm = new Map<string, HTMLVideoElement>();     // movie name -> video element buffering ahead of its `movie play`
  private loops = new Set<HTMLVideoElement>();            // videos of looping overlay pictures, which follow the volume sliders
  private end: (() => void) | null = null;                // ends the movie on screen (skip, rollback, load); null when none plays
  private skippable = false;

  constructor(private audio: AudioSystem, private el: HTMLElement) {}

  /** The project's movie files (`file` is relative to assets/, `url` where the page fetches it); buffers of changed or removed files are dropped. */
  setFiles(assets: { file: string; url: string }[]) {
    this.urls = new Map(assets.filter(a => MOVIE_FILE.test(a.file)).map(a => [a.file.replace(/\.[^./]+$/, '').slice(6), a.url] as const));
    for (const [name, video] of this.warm) if (video.getAttribute('src') !== this.urls.get(name)) { this.drop(video); this.warm.delete(name); }
  }
  has(name: string) { return this.urls.has(name); }

  /** Player input while a movie plays: skips it when it may be skipped. False when no movie plays. */
  skip(): boolean {
    if (!this.end) return false;
    if (this.skippable) this.end();
    return true;
  }
  /** End the movie on screen at once (the story was synced, rolled back or loaded). */
  stop() { this.end?.(); }

  private make(url: string): HTMLVideoElement {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.playsInline = true;
    video.src = url;
    return video;
  }
  private drop(video: HTMLVideoElement) { video.pause(); video.removeAttribute('src'); video.load(); }

  /** Start buffering a movie the story is about to reach; it is not waited for here (a movie is too big to hold the story for). */
  warmUp(name: string) {
    const url = this.urls.get(name);
    if (!url || this.warm.has(name)) return;
    this.warm.set(name, this.make(url));
    while (this.warm.size > WARM_MOVIES) { // the oldest goes first
      const [oldest] = this.warm.keys();
      this.drop(this.warm.get(oldest)!);
      this.warm.delete(oldest);
    }
  }

  /** A looping video of the movie for an overlay picture (the warmed one when the story looked ahead); null without a file. */
  takeLoop(name: string): HTMLVideoElement | null {
    const url = this.urls.get(name);
    if (!url) return null;
    const video = this.warm.get(name) ?? this.make(url);
    this.warm.delete(name);
    video.loop = true;
    video.volume = this.audio.mediaVolume();
    this.loops.add(video);
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
  release(video: HTMLVideoElement) { this.loops.delete(video); this.drop(video); }
  /** The volume sliders changed: the videos of looping pictures follow them. */
  syncVolume() { for (const v of this.loops) v.volume = this.audio.mediaVolume(); }

  /** Play a movie over the stage and resolve when it ends or is skipped; starts once the browser can play it without stalling. The movie must have a file. */
  async play(name: string, { noskip, loop }: MovieOptions): Promise<void> {
    const video = this.warm.get(name) ?? this.make(this.urls.get(name)!);
    this.warm.delete(name);
    video.volume = this.audio.mediaVolume();
    video.loop = loop; // a looping movie ends only when the player skips it
    video.className = '';
    this.el.replaceChildren(video);
    this.el.dataset.show = 'true';
    this.skippable = !noskip;
    await new Promise<void>(resolve => {
      const end = () => { video.removeEventListener('ended', end); video.removeEventListener('error', end); this.end = null; resolve(); };
      this.end = end;
      video.addEventListener('ended', end);
      video.addEventListener('error', end);
      // An autoplay block (no click yet) or a decode failure skips the movie rather than stalling the story.
      const start = () => { void video.play().catch(end); };
      if (video.readyState >= 3) start(); else video.addEventListener('canplay', start, { once: true });
    });
    this.drop(video);
    this.el.replaceChildren();
    this.el.dataset.show = 'false';
  }
}
