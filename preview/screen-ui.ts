// Draws a blocking screen (engine/src/screens.ts) as DOM over the stage: images and texts, a button per hotspot or
// button, an SVG outline per polygon, and the shape tested against a PNG for `mask` hotspots. Everything is placed in
// stage pixels (the project's stage size) inside #screenui, so it scales with the stage. Mouse hover and keyboard/pad focus share one
// "active" element; directional focus uses the engine's focusMove on the shapes' centres.

import { W, H } from './stage-size.js';
import { autoFocus } from './input.js';
import { focusMove, parseRich, sliderReadout, sliceDecls, pickables, defaultAnswer, shiftPart, type FrameEdge, type ScreenLive, type ScreenView, type PartAnim, type Sides, type ViewItem, type ViewPart } from '../engine/src/index.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const px = (n: number) => `${n}px`;

/** Draws `url` as a 9-slice frame around the element (the same border-image the theme's `image` + `slice` makes). */
function frame(el: HTMLElement, url: string, slice: Sides, edge: FrameEdge) {
  for (const [k, v] of Object.entries(sliceDecls(url, slice.join(' '), edge))) el.style.setProperty(k, v);
}

/** Alpha channel of a mask image, as a lookup by stage point; null while it can't be read (the box is used then). */
interface Mask { w: number; h: number; alpha: Uint8ClampedArray }
const masks = new Map<string, Promise<Mask | null>>();
/** Masks that have been read (null: unreadable), for a redraw that needs them at once. */
const masksRead = new Map<string, Mask | null>();
function loadMask(url: string): Promise<Mask | null> {
  let p = masks.get(url);
  if (!p) {
    p = new Promise<Mask | null>(resolve => {
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth; c.height = img.naturalHeight;
          const g = c.getContext('2d', { willReadFrequently: true })!;
          g.drawImage(img, 0, 0);
          const d = g.getImageData(0, 0, c.width, c.height).data;
          const alpha = new Uint8ClampedArray(c.width * c.height);
          for (let i = 0; i < alpha.length; i++) alpha[i] = d[i * 4 + 3];
          resolve({ w: c.width, h: c.height, alpha });
        } catch { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
    masks.set(url, p);
    void p.then(m => masksRead.set(url, m));
  }
  return p;
}

export class ScreenLayer {
  private view: ScreenView | null = null;
  private items: ViewItem[] = [];
  private els: HTMLElement[] = [];
  /** The `hover` image of each element (null when it has none), shown while the element is active. */
  private hovers: (HTMLImageElement | null)[] = [];
  private maskData = new Map<number, Mask | null>();
  private cur = -1;
  /** The element the last pointer press landed on (see the pointerup listener of the root). */
  private down: { id: string | null; el: Node | null } = { id: null, el: null };
  /** Set by a redraw: the pointerenter the browser sends for the element now under a resting mouse is not the player's move (it would take focus back from the keyboard); a real one has some movement. */
  private quiet = false;
  private done: ((id: string) => void) | null = null;
  /** Set for a HUD (`mount`): choosing an element reports it here and the screen stays up. */
  private onChoose: ((id: string, on: string) => void) | null = null;
  private tip = document.createElement('div');
  /** A screen with local `state`: a handler's change goes through here and the screen is drawn again from the view it returns (`show`). */
  private live: ScreenLive | null = null;
  private urlOf: (file: string) => string | null = () => null;
  private viewKey = '';
  /** Keys of the `on enter` elements drawn last time: a redraw does not play their entry again, but one that left and came back does. */
  private entered = new Set<string>();
  /** The elements drawn last time that have an `on exit` (not those inside a scroll area): a redraw that drops one leaves a copy to play it. */
  private exitable = new Map<string, { nodes: HTMLElement[]; exit: NonNullable<PartAnim['exit']> }>();
  /** True while a redraw replaces the elements: the focus and blur that causes are not the player's. */
  private redrawing = false;
  /** A `slider` was moved (options screen): the setting it is bound to and its new value. */
  onSlider: (setting: string, value: number) => void = () => {};

  constructor(readonly root: HTMLElement, private playSound: (name: string) => void = () => {}) {
    this.tip.className = 'sc-tip';
    root.addEventListener('pointerdown', e => { this.down = { id: (e.target as Element | null)?.closest?.<HTMLElement>('[data-id]')?.dataset.id ?? null, el: e.target as Node }; }, true);
    // A press can focus an element whose `on focus set` handler redraws the screen: the pressed element is replaced, so the browser sends
    // no click. The release over the new copy of the same element counts as the click.
    root.addEventListener('pointerup', e => {
      const { id, el } = this.down;
      this.down = { id: null, el: null };
      if (!this.live || id === null || !el || el.isConnected) return;
      const i = this.itemAt(e.target);
      if (i >= 0 && this.items[i].id === id && this.items[i].enabled) this.pick(i);
    }, true);
    root.addEventListener('click', e => { e.stopPropagation(); const i = this.hoverMask; if (i >= 0) this.pick(i); });
    root.addEventListener('pointermove', e => {
      if (this.quiet && (e.movementX !== 0 || e.movementY !== 0)) { // a real move after a redraw: hover what the pointer is on now
        this.quiet = false;
        const i = this.itemAt(e.target);
        if (i >= 0 && i !== this.cur && this.items[i].enabled) this.setActive(i);
      }
      this.moveMask(e);
    });
    root.addEventListener('pointerleave', () => { if (this.hoverMask >= 0) { this.hoverMask = -1; this.setActive(-1); } });
  }

  get open() { return this.view !== null; }
  private hoverMask = -1;

  /** Show the screen and resolve with the id of the element picked ("" for cancel). `urlOf` maps an image file to a URL (null: not there). */
  async show(view: ScreenView, urlOf: (file: string) => string | null, live?: ScreenLive): Promise<string> {
    this.close();
    this.entered = new Set();
    this.items = pickables(view);
    // Mask images are read before the screen appears, so the first pointer move can already be tested.
    const maskUrls = this.items.map(it => (it.shape.k === 'mask' ? urlOf(it.shape.file) : null));
    const loaded = await Promise.all(maskUrls.map(u => (u ? loadMask(u) : Promise.resolve(null))));
    return new Promise<string>(resolve => {
      this.view = view;
      this.live = live ?? null;
      this.urlOf = urlOf;
      this.viewKey = live ? JSON.stringify(view) : '';
      this.done = resolve;
      this.cur = -1;
      this.hoverMask = -1;
      loaded.forEach((m, i) => this.maskData.set(i, m));
      this.root.replaceChildren(...this.draw(view, urlOf), this.tip);
      this.root.dataset.visible = 'true';
      this.tip.dataset.show = 'false';
      this.placeScroll(view, []);
    });
  }

  /**
   * Draw a HUD screen that stays up: choosing an element with an `on click` handler calls `onChoose(id)`, nothing resolves.
   * Elements without a handler are drawn but inert. The layer lets the pointer through, so `mask` hotspots are tested by HudLayer from the stage (hoverAt, pickAt).
   */
  mount(view: ScreenView, urlOf: (file: string) => string | null, onChoose: (id: string, on: string) => void) {
    const kept = this.items[this.cur]?.id; // a redraw (a variable changed) is not a focus change
    const scrolled = this.scrollSnapshot();
    const before = this.exitable;
    this.close();
    this.items = pickables(view);
    this.view = view;
    this.onChoose = onChoose;
    this.cur = this.items.findIndex(it => it.id === kept);
    this.hoverMask = -1;
    this.root.replaceChildren(...this.draw(view, urlOf), this.tip);
    this.leave(before);
    this.root.dataset.visible = 'true';
    this.tip.dataset.show = 'false';
    this.placeScroll(view, scrolled);
    this.paint();
    // Mask images are read in the background; until one is there it hits nothing. data-masks says when all are in (tests wait on it).
    const reads = this.items.map((it, i) => {
      const u = it.shape.k === 'mask' ? urlOf(it.shape.file) : null;
      return u ? loadMask(u).then(m => { if (this.view === view) this.maskData.set(i, m); }) : null;
    }).filter(p => p !== null);
    this.root.dataset.masks = reads.length ? 'loading' : 'ready';
    if (reads.length) void Promise.all(reads).then(() => { if (this.view === view) this.root.dataset.masks = 'ready'; });
  }

  /** HUD: the pointer is at this stage point (or -1,-1 for away). Moves the hover over `mask` hotspots; true while one is hovered. */
  hoverAt(x: number, y: number): boolean {
    const hit = this.maskIndex(x, y, it => !!(it.on.click || it.on.focus || it.on.blur || it.act));
    if (hit !== this.hoverMask) {
      const was = this.hoverMask;
      this.hoverMask = hit;
      if (hit >= 0) this.setActive(hit);
      else if (this.cur === was) this.setActive(-1);
    }
    return hit >= 0;
  }

  /**
   * HUD: the pointer moved over `target`. A redraw replaces the element under a resting pointer, and the new one may never
   * see a pointerleave, so a hovered element the pointer is no longer on is released here.
   */
  pointerOver(target: EventTarget | null) {
    if (this.cur < 0 || this.hoverMask >= 0) return;
    const group = this.chainOf(this.cur).map(k => this.els[k]);
    if (!group.some(el => el.contains(target as Node)) && !group.includes(document.activeElement as HTMLElement)) this.setActive(-1);
  }

  /** HUD: a click at this stage point lands on a `mask` hotspot with `on click`: choose it and say so. */
  pickAt(x: number, y: number): boolean {
    const hit = this.maskIndex(x, y, it => !!(it.on.click || it.act));
    if (hit < 0) return false;
    this.pick(hit);
    return true;
  }

  /** The cursor the hovered mask hotspot asks for, or ''. */
  get maskCursor(): string { return this.hoverMask >= 0 ? this.items[this.hoverMask].cursor ?? 'pointer' : ''; }

  private maskIndex(x: number, y: number, want: (it: ViewItem) => boolean): number {
    for (let i = this.items.length - 1; i >= 0; i--) if (this.items[i].enabled && want(this.items[i]) && this.maskHit(i, x, y)) return i;
    return -1;
  }

  /** The pictures a handler's new state needs have loaded: draw the screen once more. */
  refresh() {
    if (this.view && this.live) this.redraw(this.view);
  }

  /** The screen as it looks after local state changed. The active element, DOM focus and scroll positions stay where they were. */
  private redraw(view: ScreenView) {
    const kept = this.items[this.cur]?.id, hovered = this.items[this.hoverMask]?.id;
    const focused = this.root.contains(document.activeElement);
    const scrolled = this.scrollSnapshot();
    const before = this.exitable;
    this.redrawing = true;
    this.quiet = true;
    try {
      this.view = view;
      this.viewKey = JSON.stringify(view);
      this.items = pickables(view);
      this.els = [];
      this.hovers = [];
      this.cur = this.items.findIndex(it => it.id === kept && it.enabled);
      this.hoverMask = hovered === undefined ? -1 : this.items.findIndex(it => it.id === hovered);
      this.maskData.clear();
      this.items.forEach((it, i) => {
        const u = it.shape.k === 'mask' ? this.urlOf(it.shape.file) : null;
        if (!u) return;
        if (masksRead.has(u)) this.maskData.set(i, masksRead.get(u)!);
        else void loadMask(u).then(m => { if (this.view === view) this.maskData.set(i, m); });
      });
      this.root.replaceChildren(...this.draw(view, this.urlOf), this.tip);
      this.leave(before);
      this.placeScroll(view, scrolled);
      this.paint();
      if (focused && this.cur >= 0) this.els[this.cur].focus({ preventScroll: true });
    } finally {
      this.redrawing = false;
    }
  }

  /** An element's inline handler for `on` ran: set the local state and draw again if the screen came out different. */
  private local(id: string, on: string) {
    const set = this.items.find(it => it.id === id)?.sets?.[on as 'click' | 'focus' | 'blur'];
    if (!set || !this.live || this.redrawing) return;
    const next = this.live.set(set[0], set[1]);
    if (JSON.stringify(next) !== this.viewKey) this.redraw(next);
  }

  /**
   * Remove the screen. By default at once, without answering (a restore, a load, a rollback replaced what is on screen).
   * `leave`: the screen was dismissed, so the elements with an `on exit` play it on copies first; returns true while any are still playing, and `idle` runs when they are done.
   */
  close(leave = false, idle?: () => void): boolean {
    this.clearLinger();
    const before = this.exitable;
    this.view = null;
    this.done = null;
    this.onChoose = null;
    this.live = null;
    this.items = [];
    this.els = [];
    this.hovers = [];
    this.exitable = new Map();
    this.maskData.clear();
    this.root.dataset.visible = 'false';
    this.root.replaceChildren();
    if (!leave) return false;
    this.entered = new Set();
    const playing = this.leave(before, () => { if (!this.view) this.root.dataset.visible = 'false'; idle?.(); });
    if (playing) this.root.dataset.visible = 'true';
    return playing > 0;
  }

  /** The parts as nodes. A scroll area is a clipped box and its parts go inside it, moved to the box's own coordinates. */
  private draw(view: ScreenView, urlOf: (file: string) => string | null): Node[] {
    const kids: Node[] = [];
    const areas = new Map<number, { x: number; y: number; inner: HTMLElement }>();
    const drawn = new Set<string>();
    this.exitable = new Map();
    let n = 0;
    for (const part of view.parts) {
      if (part.kind === 'scroll') {
        const box = document.createElement('div');
        box.className = 'sc-scroll';
        box.dataset.area = String(part.index);
        if (!part.bar) box.dataset.bar = 'off';
        if (part.start === 'bottom') box.dataset.start = 'bottom';
        box.style.left = px(part.x); box.style.top = px(part.y); box.style.width = px(part.w); box.style.height = px(part.h);
        if (part.contentH > part.h) { box.tabIndex = 0; box.setAttribute('role', 'region'); box.setAttribute('aria-label', 'Scrollable list'); }
        box.addEventListener('wheel', e => e.stopPropagation(), { passive: true }); // not a rollback or advance of the story
        const inner = document.createElement('div');
        inner.className = 'sc-scroll-in';
        inner.style.height = px(part.contentH);
        box.append(inner);
        areas.set(part.index, { x: part.x, y: part.y, inner });
        this.animate([box], part.anim, drawn, false);
        kids.push(box);
        continue;
      }
      const owner = part.area === undefined ? undefined : areas.get(part.area);
      const p = owner ? shiftPart(part, -owner.x, -owner.y) as typeof part : part;
      const node = 'id' in p ? [this.item(p, n++, urlOf)] : this.decor(p, urlOf);
      this.animate(node, p.anim, drawn, !owner);
      (owner ? owner.inner : { append: (...x: Node[]) => kids.push(...x) }).append(...node);
    }
    this.entered = drawn;
    return kids;
  }

  /**
   * `on enter` / `loop` of a part, as attributes and custom properties the page's CSS animates (reduce motion switches them off there).
   * An element already drawn last time does not enter again; a loop is put back in phase with the shared clock, so a redraw does not restart it.
   */
  private animate(nodes: Node[], a: PartAnim | undefined, drawn: Set<string>, top: boolean) {
    if (!a) return;
    drawn.add(a.key);
    const enter = a.enter && !this.entered.has(a.key) ? a.enter : null;
    const els = nodes.flatMap(x => (x instanceof DocumentFragment ? [...x.children] : [x])).filter((x): x is HTMLElement | SVGElement => x instanceof HTMLElement || x instanceof SVGElement);
    if (a.exit && top) this.exitable.set(a.key, { nodes: els as HTMLElement[], exit: a.exit });
    if (!enter && !a.loop) return;
    for (const el of els) {
      if (enter) {
        el.dataset.scEnter = enter.fx;
        el.style.setProperty('--sc-dur', `${enter.dur}s`);
        el.style.setProperty('--sc-delay', `${enter.delay}s`);
        if (enter.fx === 'slide') {
          const from = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[enter.dir];
          el.style.setProperty('--sc-dx', px(from[0] * enter.dist));
          el.style.setProperty('--sc-dy', px(from[1] * enter.dist));
        }
      }
      if (a.loop) {
        el.dataset.scLoop = a.loop.fx;
        el.style.setProperty('--sc-cycle', `${a.loop.dur}s`);
        el.style.setProperty('--sc-str', String(a.loop.strength));
        el.style.setProperty('--sc-phase', `${-((performance.now() / 1000) % a.loop.dur)}s`);
      }
    }
  }

  /**
   * The elements `before` that a redraw dropped and that have an `on exit` stay as inert copies at their old place while the effect plays,
   * then go. With Reduce motion on they just go. The copies are cleared with the rest when the screen closes.
   */
  private leave(before: Map<string, { nodes: HTMLElement[]; exit: NonNullable<PartAnim['exit']> }>, idle?: () => void): number {
    if (this.root.closest('[data-reduce-motion="true"]')) return 0;
    let playing = 0;
    for (const [key, { nodes, exit }] of before) {
      if (this.entered.has(key)) continue;
      for (const src of nodes) {
        const ghost = src.cloneNode(true) as HTMLElement;
        for (const el of [ghost, ...ghost.querySelectorAll<HTMLElement>('*')]) {
          el.removeAttribute('data-id'); el.removeAttribute('data-act'); el.removeAttribute('id');
          el.removeAttribute('data-sc-enter'); el.removeAttribute('data-sc-loop');
          el.removeAttribute('tabindex');
        }
        ghost.setAttribute('aria-hidden', 'true');
        ghost.setAttribute('inert', '');
        ghost.dataset.scExit = exit.fx;
        ghost.style.pointerEvents = 'none';
        ghost.style.setProperty('--sc-dur', `${exit.dur}s`);
        ghost.style.setProperty('--sc-delay', `${exit.delay}s`);
        if (exit.fx === 'slide') {
          const to = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[exit.dir];
          ghost.style.setProperty('--sc-dx', px(to[0] * exit.dist));
          ghost.style.setProperty('--sc-dy', px(to[1] * exit.dist));
        }
        playing++;
        const drop = () => { if (!ghost.isConnected) return; ghost.remove(); if (--playing === 0) idle?.(); };
        ghost.addEventListener('animationend', drop);
        setTimeout(drop, (exit.dur + exit.delay) * 1000 + 300);
        if (this.tip.parentNode === this.root) this.root.insertBefore(ghost, this.tip); else this.root.append(ghost);
      }
    }
    return playing;
  }

  /** Where each scroll area is now (a redraw keeps it, and one that was at the end stays there), by area number. */
  private scrollSnapshot(): { top: number; end: boolean }[] {
    const out: { top: number; end: boolean }[] = [];
    for (const el of this.root.querySelectorAll<HTMLElement>('.sc-scroll')) out[Number(el.dataset.area)] = { top: el.scrollTop, end: el.scrollTop + el.clientHeight >= el.scrollHeight - 2 };
    return out;
  }
  private placeScroll(view: ScreenView, before: { top: number; end: boolean }[]) {
    for (const part of view.parts) {
      if (part.kind !== 'scroll') continue;
      const el = this.root.querySelector<HTMLElement>(`.sc-scroll[data-area="${part.index}"]`);
      const was = before[part.index];
      if (!el) continue;
      if (part.start === 'bottom' && (!was || was.end)) el.scrollTop = el.scrollHeight;
      else if (was) el.scrollTop = was.top;
    }
  }

  private decor(part: Exclude<ViewPart, { id: string }>, urlOf: (file: string) => string | null): Node[] {
    if (part.kind === 'scroll') return [];
    if (part.kind === 'slider') {
      const input = document.createElement('input');
      input.type = 'range';
      input.className = 'sc-slider';
      input.min = String(part.min); input.max = String(part.max); input.step = String(part.step);
      input.value = String(part.value);
      input.dataset.setting = part.setting;
      input.setAttribute('aria-label', part.setting.replace(/_/g, ' '));
      input.style.left = px(part.x); input.style.top = px(part.y); input.style.width = px(part.w); input.style.height = px(part.h);
      if (!part.readout) {
        input.addEventListener('input', () => this.onSlider(part.setting, Number(input.value)));
        return [input];
      }
      const out = document.createElement('div');
      out.className = 'sc-text sc-readout';
      out.style.left = px(part.x + part.w + 16); out.style.top = px(part.y); out.style.lineHeight = px(part.h);
      out.textContent = sliderReadout(part.setting, part.value);
      input.addEventListener('input', () => {
        out.textContent = sliderReadout(part.setting, Number(input.value));
        this.onSlider(part.setting, Number(input.value));
      });
      return [input, out];
    }
    if (part.kind === 'panel') {
      const d = document.createElement('div');
      d.className = 'sc-panel';
      d.style.left = px(part.x); d.style.top = px(part.y); d.style.width = px(part.w); d.style.height = px(part.h);
      const url = part.file ? urlOf(part.file) : null;
      if (url) { d.dataset.framed = 'true'; frame(d, url, part.slice, part.edge); }
      else if (part.color) { d.dataset.framed = 'true'; d.style.background = part.color; d.style.border = '0'; } // framed: no theme fill under it, and a plain color has no border
      return [d];
    }
    if (part.kind === 'bar') return [this.bar(part, urlOf)];
    if (part.kind === 'text') {
      const d = document.createElement('div');
      d.className = 'sc-text';
      d.style.left = px(part.x); d.style.top = px(part.y);
      if (part.style) d.dataset.style = part.style;
      if (part.font) d.style.fontSize = px(part.font);
      if (part.color) d.style.color = part.color;
      if (part.width) { d.style.width = px(part.width); d.style.textAlign = part.align ?? 'left'; }
      if (part.lines) { d.style.display = '-webkit-box'; d.style.setProperty('-webkit-line-clamp', String(part.lines)); d.style.setProperty('-webkit-box-orient', 'vertical'); d.style.overflow = 'hidden'; }
      d.textContent = parseRich(part.text).map(s => (s.kind === 'text' ? s.text : '')).join('');
      return [d];
    }
    const url = urlOf(part.file);
    if (!url) return [];
    const img = document.createElement('img');
    img.className = 'sc-img';
    img.alt = '';
    img.draggable = false;
    img.src = url;
    img.style.left = px(part.x); img.style.top = px(part.y);
    if (part.w !== null) img.style.width = px(part.w);
    if (part.h !== null) img.style.height = px(part.h);
    return [img];
  }

  /** A `bar`: the back (a plain or 9-slice image, else the stock track) with the fill growing inside it from the left. */
  private bar(part: Extract<ViewPart, { kind: 'bar' }>, urlOf: (file: string) => string | null): HTMLElement {
    const d = document.createElement('div');
    d.className = 'sc-bar';
    d.style.left = px(part.x); d.style.top = px(part.y); d.style.width = px(part.w); d.style.height = px(part.h);
    d.setAttribute('role', 'progressbar');
    d.setAttribute('aria-valuemin', String(part.min)); d.setAttribute('aria-valuemax', String(part.max)); d.setAttribute('aria-valuenow', String(part.value));
    if (part.readout) d.setAttribute('aria-valuetext', part.readout);
    const back = part.back ? urlOf(part.back) : null;
    if (back) {
      d.dataset.framed = 'true';
      if (part.slice) { d.dataset.sliced = 'true'; frame(d, back, part.slice, part.edge); }
      else d.style.background = `url("${back}") center / 100% 100% no-repeat`;
    }
    const inner = document.createElement('div');
    inner.className = 'sc-bar-in';
    const [pt, pr, pb, pl] = part.padding;
    inner.style.left = px(pl); inner.style.top = px(pt); inner.style.right = px(pr); inner.style.bottom = px(pb);
    if (part.fraction > 0) {
      const fill = document.createElement('div');
      fill.className = 'sc-bar-fill';
      fill.style.width = `${part.fraction * 100}%`;
      const art = part.fill ? urlOf(part.fill) : null;
      if (art && part.slice) { frame(fill, art, part.slice, part.edge); fill.style.minWidth = px(part.slice[1] + part.slice[3]); }
      else if (art) fill.style.background = `url("${art}") 0 0 / ${100 / part.fraction}% 100% no-repeat`;
      else if (part.color) fill.style.background = part.color;
      if (art) fill.dataset.art = 'true';
      inner.append(fill);
    }
    d.append(inner);
    if (part.readout) {
      const t = document.createElement('div');
      t.className = 'sc-bar-text';
      t.style.fontSize = px(Math.min(40, Math.round(part.h * 0.6)));
      t.textContent = part.readout;
      d.append(t);
    }
    return d;
  }

  private item(it: ViewItem, i: number, urlOf: (file: string) => string | null): Node {
    const s = it.shape;
    let el: HTMLElement | SVGElement;
    let host: Node;
    if (s.k === 'poly') {
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('class', 'sc-svg');
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      const poly = document.createElementNS(SVG_NS, 'polygon');
      poly.setAttribute('points', s.points.map(p => p.join(',')).join(' '));
      poly.setAttribute('class', 'sc-hot sc-poly');
      poly.setAttribute('role', 'button');
      poly.setAttribute('tabindex', it.enabled ? '0' : '-1');
      poly.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && it.enabled) { e.preventDefault(); e.stopPropagation(); this.pick(i); } });
      svg.append(poly);
      el = poly; host = svg;
    } else {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = it.kind === 'button' ? 'sc-btn' : `sc-hot sc-${s.k}`;
      b.style.left = px(s.x); b.style.top = px(s.y); b.style.width = px(s.w); b.style.height = px(s.h);
      if (it.kind === 'button') {
        b.textContent = it.label;
        if (it.sub) {
          // a smaller second line inside the button, centred under the label
          const sub = document.createElement('span');
          sub.className = 'sc-sub';
          sub.textContent = it.sub;
          b.append(sub);
        }
        if (it.style) b.dataset.style = it.style;
        if (it.font) b.style.fontSize = px(it.font);
      }
      if (s.k === 'mask') {
        const url = urlOf(s.file);
        if (url) { b.style.setProperty('--mask', `url("${url}")`); b.dataset.masked = 'true'; }
        b.classList.add('sc-hot');
      }
      el = b; host = b;
    }
    el.setAttribute('aria-label', (it.kind === 'button' && it.sub ? `${it.label}, ${it.sub}` : it.label) || it.id);
    el.dataset.id = it.id;
    el.dataset.kind = it.kind;
    if (it.act) el.dataset.act = it.act;
    if (it.role) { // a tab, toggle or radio: announced as what it is, lit while its state says so
      el.setAttribute('role', it.role === 'toggle' ? 'checkbox' : it.role === 'radio' ? 'radio' : 'tab');
      el.setAttribute(it.role === 'tab' ? 'aria-selected' : 'aria-checked', String(!!it.checked));
      el.dataset.bind = it.role;
      el.dataset.checked = String(!!it.checked);
    }
    if (!it.enabled) {
      el.setAttribute('aria-disabled', 'true');
      if (el instanceof HTMLButtonElement) el.tabIndex = -1;
    }
    if (it.cursor) el.style.setProperty('--cursor', it.cursor);
    el.dataset.on = it.enabled ? 'true' : 'false';
    this.els[i] = el as HTMLElement;
    const hoverUrl = it.hover ? urlOf(it.hover) : null;
    let hover: HTMLImageElement | null = null;
    if (hoverUrl) {
      hover = document.createElement('img');
      hover.className = 'sc-hover';
      hover.alt = '';
      hover.draggable = false;
      hover.src = hoverUrl;
      hover.style.left = px(it.bounds.x); hover.style.top = px(it.bounds.y); hover.style.width = px(it.bounds.w); hover.style.height = px(it.bounds.h);
      hover.hidden = true; // paint() shows it while the element is in the active chain
      el.dataset.hover = 'true'; // the image is the look: the stock highlight steps aside
    }
    if (it.plain) el.dataset.hover = 'none'; // no highlight at all
    if (it.fx.tint) { el.dataset.tint = 'true'; el.style.setProperty('--tint', it.fx.tint); }
    if (it.fx.scale) { el.dataset.scale = 'true'; el.style.setProperty('--scale', String(it.fx.scale)); }
    this.hovers[i] = hover;
    if (s.k !== 'mask') {
      el.addEventListener('click', e => { e.stopPropagation(); if (it.enabled) this.pick(i); });
      el.addEventListener('pointerenter', e => { if (it.enabled && !(this.quiet && (e as PointerEvent).movementX === 0 && (e as PointerEvent).movementY === 0)) this.setActive(i); });
      // moving onto another element of this screen (a child of the group, say) is not leaving: that element's pointerenter follows at once
      el.addEventListener('pointerleave', e => { if (this.cur === i && this.itemAt((e as PointerEvent).relatedTarget) < 0) this.setActive(-1); });
      if (this.onChoose || this.live) { // a HUD, or a screen with local state: keyboard focus (Tab) counts like hovering
        el.addEventListener('focus', () => { if (it.enabled && !this.redrawing) this.setActive(i); });
        el.addEventListener('blur', e => { if (!this.redrawing && this.cur === i && this.itemAt((e as FocusEvent).relatedTarget) < 0) this.setActive(-1); });
      }
    }
    return hover ? this.pair(hover, host) : host;
  }

  /** The hover image goes under its element, so a button's label stays on top. */
  private pair(hover: HTMLImageElement, host: Node): Node {
    const f = document.createDocumentFragment();
    f.append(hover, host);
    return f;
  }

  /** Stage pixels of a pointer event (the stage is scaled by CSS, so ask the layer for its box). */
  private stagePoint(e: PointerEvent): [number, number] {
    const r = this.root.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  }

  private maskHit(i: number, x: number, y: number): boolean {
    const it = this.items[i], s = it.shape;
    if (s.k !== 'mask' || x < s.x || y < s.y || x > s.x + s.w || y > s.y + s.h) return false;
    const m = this.maskData.get(i);
    if (m === undefined) return false; // not read yet (a HUD loads in the background)
    if (!m) return true; // the image could not be read: the whole box counts
    const mx = Math.min(m.w - 1, Math.floor(((x - s.x) / s.w) * m.w)), my = Math.min(m.h - 1, Math.floor(((y - s.y) / s.h) * m.h));
    return m.alpha[my * m.w + mx] > 16;
  }

  private moveMask(e: PointerEvent) {
    if (!this.items.some(it => it.shape.k === 'mask')) return;
    const [x, y] = this.stagePoint(e);
    let hit = -1;
    for (let i = this.items.length - 1; i >= 0; i--) if (this.items[i].enabled && this.maskHit(i, x, y)) { hit = i; break; }
    if (hit === this.hoverMask) return;
    this.hoverMask = hit;
    this.root.style.cursor = hit >= 0 ? this.items[hit].cursor ?? 'pointer' : '';
    this.setActive(hit);
  }

  /** The item whose element holds `node`, or -1. */
  private itemAt(node: EventTarget | null): number {
    return node instanceof Node ? this.els.findIndex(el => el.contains(node)) : -1;
  }

  /** Item `i` and its ancestors (a child of a `hotspot ...:` group), outermost first; empty for -1. */
  private chainOf(i: number): number[] {
    const out: number[] = [];
    while (i >= 0 && i < this.items.length && !out.includes(i)) {
      out.unshift(i);
      const parent = this.items[i].parent;
      i = parent === undefined ? -1 : this.items.findIndex(it => it.id === parent);
    }
    return out;
  }

  /** Mark the active chain (the item and its ancestors) and show their hover images. */
  private paint() {
    const on = new Set(this.chainOf(this.cur));
    this.els.forEach((el, k) => { el.dataset.active = String(on.has(k)); const h = this.hovers[k]; if (h) h.hidden = !on.has(k); });
  }

  /**
   * Make `i` the active item. The active state is the chain from its outermost group to it: a HUD hears `focus` for the
   * elements that join the chain (outermost first) and `blur` for those that leave it (innermost first), so moving from a
   * group onto one of its children blurs nothing.
   */
  private setActive(i: number) {
    const items = this.items;
    const before = this.cur;
    if (i >= items.length) i = -1;
    const was = this.chainOf(before).map(k => items[k]);
    this.cur = i;
    if (i !== before && items[i]?.enabled && items[i].fx.sound) this.playSound(items[i].fx.sound!);
    if (this.onChoose || this.live) {
      const now = this.chainOf(i).map(k => items[k]);
      const has = (it: ViewItem, on: 'focus' | 'blur') => !!(it.on[on] || it.sets?.[on]);
      const events: [string, string][] = [
        ...was.filter(it => !now.some(n => n.id === it.id) && has(it, 'blur')).reverse().map(it => [it.id, 'blur'] as [string, string]),
        ...now.filter(it => !was.some(w => w.id === it.id) && has(it, 'focus')).map(it => [it.id, 'focus'] as [string, string]),
      ];
      for (const [id, on] of events) { if (this.onChoose) this.onChoose(id, on); else this.local(id, on); } // by id: a handler may redraw the screen (a bar that closes), which replaces the indices
    }
    this.paint();
    const it = this.items[this.cur];
    if (!it) { this.tip.dataset.show = 'false'; return; }
    const el = this.els[this.cur];
    if (!this.onChoose && document.activeElement !== el && it.enabled) (el as HTMLElement).focus({ preventScroll: true }); // a HUD is only hovered: focus stays with the story
    const tipText = it.kind === 'hotspot' ? (it.tip ? it.label : '') : it.tooltip ?? '';
    if (tipText) {
      const b = it.bounds, below = b.y < 90;
      this.tip.textContent = tipText;
      this.tip.dataset.show = 'true';
      const half = this.tip.offsetWidth / 2 + 8; // keep the whole tip on the stage, whatever its size
      this.tip.style.left = px(Math.min(W - half, Math.max(half, b.x + b.w / 2)));
      this.tip.style.top = px(below ? b.y + b.h + 10 : b.y - 10);
      this.tip.style.transform = below ? 'translate(-50%, 0)' : 'translate(-50%, -100%)';
      this.tip.dataset.show = 'true';
    } else this.tip.dataset.show = 'false';
  }

  private pick(i: number) {
    const it = this.items[i];
    if (!it?.enabled) return;
    if (this.onChoose) { if (it.on.click || it.act) this.onChoose(it.id, 'click'); return; } // a HUD: report it, stay up
    if (this.live && it.sets?.click) { this.local(it.id, 'click'); return; } // sets local state: the screen stays up
    this.finish(it.id);
  }
  private finish(id: string) {
    const done = this.done;
    // A picture that covers the whole stage (a map of hotspots) stays up, inert, until the next scene change fades it out:
    // closing it at once would show the scene underneath for the length of that transition.
    const covers = [...this.root.querySelectorAll('img')].some(i => i.offsetWidth >= this.root.offsetWidth * .98 && i.offsetHeight >= this.root.offsetHeight * .98);
    const kids = covers ? [...this.root.children].filter(c => c !== this.tip) : [];
    this.close(true);
    if (kids.length) {
      this.root.append(...kids);
      this.root.dataset.visible = 'true';
      this.root.dataset.linger = 'true';
      this.lingering = true;
    }
    done?.(id);
  }

  private lingering = false;
  private lingerTimer = 0;

  private clearLinger() {
    if (!this.lingering) return;
    this.lingering = false;
    clearTimeout(this.lingerTimer);
    delete this.root.dataset.linger;
    this.root.style.transition = '';
    this.root.style.opacity = '';
    this.root.replaceChildren();
    this.root.dataset.visible = 'false';
  }

  /** Take down the picture a dismissed screen left up: at once, or fading out over `seconds` (the scene change underneath). */
  unlinger(seconds = 0) {
    if (!this.lingering) return;
    if (seconds <= 0 || this.view) { if (!this.view) this.clearLinger(); return; }
    this.root.style.transition = `opacity ${seconds}s linear`;
    requestAnimationFrame(() => { this.root.style.opacity = '0'; });
    this.lingerTimer = window.setTimeout(() => this.clearLinger(), seconds * 1000 + 50);
  }

  // ---- keyboard and pad ----

  /** Arrow keys and d-pad: the first press lands on the default element, the next ones move by direction. */
  move(dir: 'up' | 'down' | 'left' | 'right'): void {
    if (!this.view) return;
    const on = this.items.map((it, i) => (it.enabled ? i : -1)).filter(i => i >= 0);
    if (!on.length) return;
    if (this.cur < 0) {
      const d = defaultAnswer(this.view);
      this.setActive(this.items.findIndex(it => it.id === d && it.enabled));
      return;
    }
    const hint = this.items[this.cur].focus[dir]; // an explicit move wins when its target can be chosen
    const hinted = hint === undefined ? -1 : on.find(i => this.items[i].id === hint) ?? -1;
    if (hinted >= 0) { this.setActive(hinted); return; }
    const centers = on.map(i => this.items[i].center);
    const to = focusMove(centers, on.indexOf(this.cur), dir);
    if (to >= 0) this.setActive(on[to]);
  }

  /** Enter / A: choose the active element (the first press only lands on one). */
  confirm(): void {
    if (!this.view) return;
    if (this.cur < 0) this.move('down');
    else this.pick(this.cur);
  }

  /** Cancel key / B: answers "" when the screen declared `cancel`, else nothing. */
  cancel(): void {
    if (this.view?.cancel) this.finish('');
  }
}

/** The screens shown with `hud on`: one ScreenLayer each, redrawn only when the runtime's view of it changed. */
export class HudLayer {
  private layers = new Map<string, { layer: ScreenLayer; el: HTMLElement; key: string }>();

  /** `locked()`: a menu, input, blocking screen or pause is open; HUD choices are dropped then. */
  /** `menu`: a screen the player moves through with the keys (options): a click keeps the focus where it is instead of handing it back to the story. */
  constructor(readonly root: HTMLElement, private onEvent: (id: string, on: string) => void, private locked: () => boolean, private playSound: (name: string) => void = () => {}, private menu = false) {
    // The layer itself lets the pointer through to the story, so `mask` hotspots are tested from the stage.
    const stage = root.parentElement;
    if (!stage) return;
    const point = (e: PointerEvent | MouseEvent): [number, number] => {
      const r = root.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
    };
    const hover = (x: number, y: number) => {
      let over = '';
      for (const h of this.layers.values()) if (h.layer.hoverAt(x, y) && !over) over = h.layer.maskCursor;
      return over;
    };
    stage.addEventListener('pointermove', e => {
      for (const h of this.layers.values()) h.layer.pointerOver(e.target);
      if (!this.hasMasks) return;
      const over = this.locked() ? (hover(-1, -1), '') : hover(...point(e));
      stage.style.cursor = over;
    });
    stage.addEventListener('pointerleave', () => { if (this.hasMasks) { hover(-1, -1); stage.style.cursor = ''; } });
    stage.addEventListener('click', e => {
      if (!this.hasMasks || this.locked()) return;
      const [x, y] = point(e);
      for (const h of this.layers.values()) if (h.layer.pickAt(x, y)) { e.stopPropagation(); return; }
    }, true);
  }

  private get hasMasks() { return this.layers.size > 0; }

  /** A `slider` of any of the screens was moved. */
  onSlider: (setting: string, value: number) => void = () => {};

  get active() { return this.layers.size > 0; }
  get focused() { return this.root.contains(document.activeElement); }

  /** Layers that were taken down and are still playing their `on exit`s: the root stays visible for them. */
  private leaving = 0;

  update(views: ScreenView[], urlOf: (file: string) => string | null, leave = true) {
    const names = new Set(views.map(v => v.name));
    for (const [name, h] of this.layers) {
      if (names.has(name)) continue;
      this.layers.delete(name);
      const el = h.el;
      if (leave && h.layer.close(true, () => { el.remove(); this.leaving--; this.root.dataset.visible = this.layers.size || this.leaving ? 'true' : 'false'; })) { this.leaving++; continue; }
      h.layer.close();
      el.remove();
    }
    for (const v of views) {
      // a slider's own position is already on screen: moving it must not rebuild (and so drop) the element being dragged
      const key = JSON.stringify(v, function (k, val) { return k === 'value' && (this as { kind?: string }).kind === 'slider' ? undefined : val; });
      let h = this.layers.get(v.name);
      if (h?.key === key) continue;
      const focus = h && h.el.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.id : undefined;
      if (!h) {
        const el = document.createElement('div');
        this.root.append(el);
        h = { layer: new ScreenLayer(el, this.playSound), el, key };
        this.layers.set(v.name, h);
      }
      h.key = key;
      h.layer.onSlider = (setting, value) => this.onSlider(setting, value);
      h.layer.mount(v, urlOf, (id, on) => {
        if (this.locked() || (this.quiet && on === 'blur')) return;
        if (on === 'click' && !this.menu) this.blur(); // back to the story: Space and Enter advance the line, they do not press this button again
        this.onEvent(id, on);
      });
      if (focus) h.el.querySelector<HTMLElement>(`[data-id="${CSS.escape(focus)}"]`)?.focus({ preventScroll: true });
    }
    this.root.dataset.visible = this.layers.size || this.leaving ? 'true' : 'false';
  }

  /** Take every screen down at once (a restore or a load): no `on exit` plays. */
  clear() { this.update([], () => null, false); }

  /**
   * Move keyboard or pad focus onto the first enabled element that has a handler (the HUD is a passive group: nothing focuses it by itself). When that
   * element sits in a scroll area that `start bottom`, the last enabled one of that area gets it instead (the history opens on the newest line).
   */
  focusFirst(id = ''): boolean {
    const live = '[data-on="true"]:not([aria-disabled])';
    let el = (id ? this.root.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"][data-on="true"]`) : null) ?? this.root.querySelector<HTMLElement>(live);
    let wanted = !!id;
    const area = !id ? el?.closest<HTMLElement>('.sc-scroll[data-start="bottom"]') : null;
    if (area) { el = [...area.querySelectorAll<HTMLElement>(live)].at(-1) ?? el; wanted = true; }
    return autoFocus(el, { preventScroll: !wanted }); // a wanted element is scrolled into view; inside the editor an edit's replay must not steal focus
  }
  /** Hand focus back to the story. That is not a `blur` event for the script (the click that caused it is the event). */
  blur() {
    this.quiet = true;
    (document.activeElement as HTMLElement | null)?.blur();
    this.quiet = false;
  }
  private quiet = false;
}
