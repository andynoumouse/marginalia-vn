// The renderer's built-in screen slots (quick menu, title, pause, options, saves, history, gallery, viewer, music room,
// chapters, achievements, achievement toast): one DOM layer each, what it currently shows, and the action callbacks the
// shell hooks in. `draw` puts a view into a slot once its images are loaded.

import { IMAGE_FILE, type ScreenView, type ViewItem } from '../engine/src/index.js';
import { HudLayer } from './screen-ui.js';
import { $ } from './stage-ui.js';

/** The `key` of every image the screen views draw (what `ensure` loads). */
export const imageKeys = (views: ScreenView[]) =>
  views.flatMap(v => v.parts.flatMap(p => (p.kind === 'image' && p.file ? [p.file.replace(IMAGE_FILE, '')] : [])));

export type ActionSlot = 'quick' | 'title' | 'pause' | 'options' | 'saves' | 'history' | 'gallery' | 'viewer' | 'music' | 'chapters' | 'achievements';
export type ScreenSlot = ActionSlot | 'achToast';
export type ActionHandler = (item: ViewItem | undefined) => void;

export interface SlotsHost {
  hoverSound(name: string): void;
  /** True while a menu covers the game (the quick menu is locked then). */
  paused(): boolean;
  /** Bumped when the renderer resets; a draw that began before it is dropped. */
  epoch(): number;
  isReady(key: string): boolean;
  ensure(keys: string[]): Promise<void>;
  imageUrl(file: string): string | null;
}

export interface DrawOptions {
  /** 'first' moves focus onto the screen on the first draw only (redraws keep it), 'always' on every draw. */
  focus?: 'first' | 'always';
  /** The element to focus, when focusing. */
  focusId?: string;
  /** Passed to the layer's `update`. */
  leave?: boolean;
  /** false lets the draw survive a reset. */
  guardEpoch?: boolean;
  /** Runs once the layer is drawn. */
  after?: () => void;
}

/** Layer element, `menu` layers take slider input. */
const ACTION_LAYERS: Record<ActionSlot, { dom: string; menu?: boolean; lockedWhenPaused?: boolean }> = {
  quick: { dom: 'quickui', lockedWhenPaused: true },
  title: { dom: 'titleui' },
  pause: { dom: 'pauseui' },
  options: { dom: 'optionsui', menu: true },
  saves: { dom: 'savesui', menu: true }, // a page tab or a save keeps the keyboard on the screen (UX round PI-7)
  history: { dom: 'historyui' },
  gallery: { dom: 'galleryui' },
  viewer: { dom: 'viewerui' },
  music: { dom: 'musicui', menu: true },
  chapters: { dom: 'chaptersui' },
  achievements: { dom: 'achievementsui' },
};

export class ScreenSlots {
  /** What each slot currently shows. */
  private views: Record<ScreenSlot, ScreenView | null> = { quick: null, title: null, pause: null, options: null, saves: null, history: null, gallery: null, viewer: null, music: null, chapters: null, achievements: null, achToast: null };
  /** What a click on an element with an `act` does, per slot: set by the shell. */
  readonly onAction: Record<ActionSlot, ActionHandler> = {
    quick: () => {}, title: () => {}, pause: () => {}, options: () => {}, saves: () => {}, history: () => {},
    gallery: () => {}, viewer: () => {}, music: () => {}, chapters: () => {}, achievements: () => {},
  };
  readonly layers: Record<ScreenSlot, HudLayer>;

  constructor(private host: SlotsHost) {
    const layers = {} as Record<ScreenSlot, HudLayer>;
    for (const slot of Object.keys(ACTION_LAYERS) as ActionSlot[]) {
      const { dom, menu, lockedWhenPaused } = ACTION_LAYERS[slot];
      // A click hands the element that has an `act` to the slot's handler.
      layers[slot] = new HudLayer($(dom), (id, on) => {
        if (on === 'click') this.onAction[slot](this.views[slot]?.parts.find(p => 'id' in p && p.id === id && p.act) as ViewItem | undefined);
      }, lockedWhenPaused ? () => host.paused() : () => false, n => host.hoverSound(n), menu);
    }
    /** The `achievement_toast` screen: shows one unlock, takes no input. */
    layers.achToast = new HudLayer($('achtoastui'), () => {}, () => true);
    this.layers = layers;
  }

  /** Draw `view` in a slot (null: hide it) once its images are loaded; a newer draw or a reset while loading wins. */
  async draw(slot: ScreenSlot, view: ScreenView | null, o: DrawOptions = {}) {
    const { host } = this;
    const fresh = !this.views[slot] && !!view;
    this.views[slot] = view;
    const ep = host.epoch();
    const keys = imageKeys(view ? [view] : []);
    const stale = () => (o.guardEpoch !== false && ep !== host.epoch()) || this.views[slot] !== view;
    if (keys.some(k => !host.isReady(k))) { await host.ensure(keys); if (stale()) return; }
    const layer = this.layers[slot];
    layer.update(view ? [view] : [], file => host.imageUrl(file), o.leave);
    if (view && (o.focus === 'always' || (o.focus === 'first' && fresh))) layer.focusFirst(o.focusId);
    o.after?.();
  }
}
