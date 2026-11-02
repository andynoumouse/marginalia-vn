// Studio mode of the preview page (`preview/index.html?studio=<char>`): the animation dialog of the editor embeds it
// to show one character on a plain stage. The editor drives it with postMessage; the page answers with `studioTime`
// while an animation plays. Messages from the editor:
//   { type: 'studioShow', pose, overrides }               dress the character
//   { type: 'studioAnims', anims }                        the working copy of the character's `animations`
//   { type: 'studioSeek', name, t, part }                 stop and pose at progress t (0-1)
//   { type: 'studioPlay', name, dur, loop, part }         play from the start; `studioPause` stops where it is
//   { type: 'studioPivots', pivots, width, height }       the working copy of rig.json `pivots` and the PSD canvas size
//   { type: 'studioFocus', part }                         dim every part but this one (or a group's parts); null shows all
//   { type: 'studioPick', part }                          show the character at rest with that part's pivot; a click
//                                                         answers { type: 'studioPicked', part, x, y } in PSD pixels; null ends it
//   { type: 'studioPlace', on, x, y, scale, flip, anchor: [fx, fy] }        where the character stands; with `on` a drag on the stage moves it and
//                                                         answers { type: 'studioPlaced', x, y } (stage fractions, as `show` takes them)

import { psdToStage, stageToPsd, type AnimDef, type DisplayState, type PivotFrame, type Pivots } from '../engine/src/index.js';
import type { PixiRenderer } from './pixi-renderer.js';
import { H, stage, W } from './stage-ui.js';

interface Run { name: string; dur: number; loop: boolean; part: string | null; start: number }
type Msg = { type?: string; on?: unknown; x?: unknown; y?: unknown; scale?: unknown; flip?: unknown; anchor?: unknown; pivots?: unknown; width?: unknown; height?: unknown; pose?: unknown; overrides?: unknown; anims?: unknown; name?: unknown; t?: unknown; dur?: unknown; loop?: unknown; part?: unknown };

const str = (v: unknown) => (typeof v === 'string' ? v : null);
const num = (v: unknown, or: number) => (typeof v === 'number' && Number.isFinite(v) ? v : or);

export class Studio {
  private anims: Record<string, AnimDef> = {};
  private pose: string | null = null;
  private overrides: Record<string, string> = {};
  private last: { name: string; t: number; part: string | null } | null = null;
  private run: Run | null = null;
  private pivots: Pivots = {};
  private size = { width: 0, height: 0 };
  private pick: string | null = null;     // the part whose pivot is being placed
  private place = { x: 0.5, y: 0, scale: 1, flip: false, anchor: [0.5, 1] as [number, number] };
  private placing = false;                // a drag on the stage moves the character
  private showing = false;                // a sync is under way
  private again = false;                  // and the placement changed meanwhile
  private marker = document.createElement('div');
  private others: HTMLElement[] = [];     // dim crosses for the other parts' pivots, shown while picking

  constructor(private renderer: PixiRenderer, readonly char: string) {
    this.marker.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none;z-index:30;display:none';
    const bar = (css: string) => `<div style="position:absolute;background:#ff3b6b;box-shadow:0 0 0 2px #000;${css}"></div>`;
    this.marker.innerHTML = bar('left:-30px;top:-1.5px;width:60px;height:3px') + bar('left:-1.5px;top:-30px;width:3px;height:60px');
    stage.append(this.marker);
    stage.addEventListener('click', e => this.onClick(e), true);
    stage.addEventListener('pointerdown', e => this.onDrag(e));
    window.addEventListener('message', e => {
      if (e.origin !== location.origin || e.source !== window.parent) return;
      void this.handle(e.data as Msg | null);
    });
  }

  /** Put the character on stage with the current pose (again after a hot reload of the project). */
  async show(announce = true) {
    // Pivots are placed in PSD pixels from a character standing bottom-centre, so picking ignores the placement.
    const at = this.pick ? { x: 0.5, y: 0, scale: 1, flip: false, anchor: [0.5, 1] as [number, number] } : this.place;
    const state: DisplayState = {
      bg: null, music: null, musicLoop: false,
      sprites: [{ char: this.char, pose: this.pose, overrides: this.overrides, ...at, rotation: 0, alpha: 1, anim: null }],
    };
    await this.renderer.prepare(state);
    this.renderer.sync(state);
    if (this.size.width) this.renderer.studioPivots(this.char, this.pivots); // the editor's working copy, not the file's
    if (this.last) this.poseAt(this.last.name, this.last.t, this.last.part);
    if (this.pick) this.renderer.studioRest(this.char);
    if (announce) window.parent.postMessage({ type: 'studioReady' }, location.origin);
  }

  /** Redraw after the placement or pick mode changed; changes that arrive during a redraw are drawn once it is done. */
  private redraw() {
    if (this.showing) { this.again = true; return; }
    this.showing = true;
    void this.show(false).finally(() => {
      this.showing = false;
      if (this.again) { this.again = false; this.redraw(); }
    });
  }

  private onDrag(e: PointerEvent) {
    if (!this.placing || this.pick) return;
    e.preventDefault();
    stage.setPointerCapture(e.pointerId);
    let lx = e.clientX, ly = e.clientY;
    const move = (m: PointerEvent) => {
      const r = stage.getBoundingClientRect();
      this.place = { ...this.place, x: this.place.x + (m.clientX - lx) / r.width, y: this.place.y + (m.clientY - ly) / r.height };
      lx = m.clientX; ly = m.clientY;
      window.parent.postMessage({ type: 'studioPlaced', x: this.place.x, y: this.place.y }, location.origin);
      this.redraw();
    };
    const up = () => { stage.removeEventListener('pointermove', move); stage.removeEventListener('pointerup', up); };
    stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerup', up);
  }

  private get frame(): PivotFrame { return { stageW: W, stageH: H, ...this.size }; }

  /** Pick mode: the character at rest and a cross where the part's pivot is. */
  private showPick() {
    const at = this.pick ? this.pivots[this.pick] : undefined;
    const [x, y] = at ? psdToStage(this.frame, at[0], at[1]) : [0, 0];
    this.marker.style.display = at ? 'block' : 'none';
    this.marker.style.left = `${x}px`;
    this.marker.style.top = `${y}px`;
    // The other pivots, so a group sharing one point shows as one cross with every part's name.
    const rest = this.pick && at ? Object.entries(this.pivots).filter(([n]) => n !== this.pick) : [];
    const spots = new Map<string, string[]>();
    for (const [n, p] of rest) {
      const k = psdToStage(this.frame, p[0], p[1]).map(Math.round).join(',');
      spots.set(k, [...(spots.get(k) ?? []), n]);
    }
    while (this.others.length < spots.size) {
      const d = document.createElement('div');
      d.style.cssText = 'position:absolute;width:10px;height:10px;margin:-5px 0 0 -5px;border:2px solid #ffd23b;border-radius:50%;box-shadow:0 0 0 1px #000;pointer-events:none;z-index:29';
      stage.append(d);
      this.others.push(d);
    }
    this.others.forEach((d, i) => {
      const e = [...spots.entries()][i];
      d.style.display = e ? 'block' : 'none';
      if (!e) return;
      const [px, py] = e[0].split(',');
      d.style.left = `${px}px`;
      d.style.top = `${py}px`;
      d.title = e[1].join(', ');
    });
    stage.style.cursor = this.pick ? 'crosshair' : '';
    if (this.pick) this.renderer.studioRest(this.char);
    else if (this.last) this.poseAt(this.last.name, this.last.t, this.last.part);
  }

  private onClick(e: MouseEvent) {
    if (!this.pick) return;
    e.stopPropagation();
    const r = stage.getBoundingClientRect();
    const [x, y] = stageToPsd(this.frame, ((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H);
    window.parent.postMessage({ type: 'studioPicked', part: this.pick, x, y }, location.origin);
  }

  private poseAt(name: string, t: number, part: string | null) {
    this.last = { name, t, part };
    if (this.pick) return;
    this.renderer.studioPose(this.char, this.anims, name, Math.min(1, Math.max(0, t)), part);
  }

  private async handle(m: Msg | null) {
    switch (m?.type) {
      case 'studioShow': {
        this.pose = str(m.pose);
        const o = m.overrides && typeof m.overrides === 'object' ? Object.entries(m.overrides) : [];
        this.overrides = Object.fromEntries(o.filter((p): p is [string, string] => typeof p[1] === 'string'));
        await this.show(false);
        break;
      }
      case 'studioPlace':
        this.placing = m.on === true;
        this.place = { x: num(m.x, 0.5), y: num(m.y, 0), scale: Math.max(0.05, num(m.scale, 1)), flip: m.flip === true, anchor: Array.isArray(m.anchor) && m.anchor.length === 2 ? [num(m.anchor[0], 0.5), num(m.anchor[1], 1)] : [0.5, 1] };
        stage.style.cursor = this.placing ? 'move' : '';
        this.redraw();
        break;
      case 'studioAnims':
        if (m.anims && typeof m.anims === 'object') this.anims = m.anims as Record<string, AnimDef>;
        if (this.last && !this.run) this.poseAt(this.last.name, this.last.t, this.last.part);
        break;
      case 'studioSeek': {
        const name = str(m.name);
        this.run = null;
        if (name) this.poseAt(name, num(m.t, 0), str(m.part));
        break;
      }
      case 'studioPlay': {
        const name = str(m.name);
        if (!name) break;
        this.run = { name, dur: Math.max(0.05, num(m.dur, 1)), loop: m.loop === true, part: str(m.part), start: performance.now() };
        requestAnimationFrame(this.tick);
        break;
      }
      case 'studioPivots': {
        const o = m.pivots && typeof m.pivots === 'object' ? Object.entries(m.pivots) : [];
        this.pivots = Object.fromEntries(o.filter((p): p is [string, [number, number]] => Array.isArray(p[1]) && p[1].length === 2 && p[1].every(Number.isFinite)));
        this.size = { width: num(m.width, 0), height: num(m.height, 0) };
        this.renderer.studioPivots(this.char, this.pivots);
        this.showPick();
        break;
      }
      case 'studioPick':
        this.pick = str(m.part);
        this.run = null;
        this.showPick();
        this.redraw();
        break;
      case 'studioPause':
        this.run = null;
        break;
      case 'studioFocus':
        this.renderer.studioFocus(this.char, str(m.part));
        break;
    }
  }

  private tick = (now: number) => {
    const r = this.run;
    if (!r) return;
    const k = (now - r.start) / 1000 / r.dur;
    const done = !r.loop && k >= 1;
    const t = done ? 1 : r.loop ? k % 1 : k;
    this.poseAt(r.name, t, r.part);
    if (done) this.run = null;
    window.parent.postMessage({ type: 'studioTime', t, playing: !done }, location.origin);
    if (!done) requestAnimationFrame(this.tick);
  };
}
