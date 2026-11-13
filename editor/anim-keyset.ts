// Several timeline keys chosen at once (docs/design/timeline-multi-select.md, UX round 3 AN-13): channel keys and parameter keys.
// Ctrl-click adds or takes one away, Shift-click adds the keys between, Shift+drag on a lane draws a box, Ctrl+A takes every key
// on show, Esc lets go. With two or more chosen, a drag of one moves them all in time, the arrows nudge them, Delete removes them
// and the ease select sets them all. It listens on the timeline before the one-key editors (anim-keys.ts, anim-ptracks.ts), which
// keep doing everything else, and it works through the same host they do.

import { deleteKeys, liveRefs, moveKeys, refId, setKeysEase, type AnimDef, type KeyRef } from '../engine/src/index.js';
import { LABEL, localPoint } from './anim-timeline.js';
import { followPointer } from './pointer.js';

export interface KeySetHost {
  tl: SVGSVGElement;
  current(): { name: string; preset: boolean; def: AnimDef; dur: number } | null;
  editable(): boolean;
  /** What the timeline shows (the animation and the part): a change lets go of the chosen keys. */
  view(): string;
  /** The key the one-key editors show (their fields, their nudges), and setting it. */
  single(): KeyRef | null;
  setSingle(r: KeyRef | null): void;
  setAnim(name: string, def: AnimDef): void;
  edit(fn: () => void): void;
  dragStep(name: string, def: AnimDef): void;
  beginDrag(): () => void;
  refreshView(): void;
  note(text: string): void;
}

const DIAMONDS = '[data-key], [data-pkey]';
const NS = 'http://www.w3.org/2000/svg';
const stop = (e: Event) => { e.preventDefault(); e.stopImmediatePropagation(); };

export class KeySet {
  refs: KeyRef[] = [];
  private shown = '';

  constructor(private host: KeySetHost) {
    // Capture: before the one-key editors' own pointer and key handlers on the timeline.
    host.tl.addEventListener('pointerdown', e => this.down(e), true);
    host.tl.addEventListener('keydown', e => this.key(e), true);
  }

  /** Two or more keys chosen: the group edits apply. */
  get many() { return this.refs.length > 1; }
  clear() { this.refs = []; }

  /** After the timeline is drawn: forget keys of another view, and draw the chosen ones as chosen. */
  paint() {
    const c = this.host.current(), view = this.host.view();
    if (view !== this.shown) { this.shown = view; this.refs = []; }
    this.refs = c ? liveRefs(c.def, this.refs) : [];
    const on = new Set(this.refs.map(refId));
    for (const d of this.host.tl.querySelectorAll<SVGElement>(DIAMONDS)) if (on.has(this.idOf(d))) d.classList.add('tl-on');
  }

  private refOf(d: Element): KeyRef | null {
    const e = d as SVGElement;
    if (e.dataset.key !== undefined) return { kind: 'key', index: Number(e.dataset.key) };
    if (e.dataset.pkey !== undefined) return { kind: 'param', id: e.dataset.param!, index: Number(e.dataset.pkey) };
    return null;
  }
  private idOf(d: Element) { const r = this.refOf(d); return r ? refId(r) : ''; }
  private has(r: KeyRef) { return this.refs.some(x => refId(x) === refId(r)); }
  /** A set starts from the key the editors show, so a Ctrl-click after a plain click makes two. */
  private seed() { if (!this.refs.length) { const s = this.host.single(); if (s) this.refs = [s]; } }

  private changed(focus?: KeyRef | null) {
    if (focus !== undefined) this.host.setSingle(focus);
    this.host.refreshView();
    const n = this.refs.length;
    if (n > 1) this.host.note(`${n} keys chosen: drag one to move them all, arrows nudge them, Delete removes them, the ease select sets them all; Esc lets go.`);
  }

  private down(e: PointerEvent) {
    if (e.button !== 0 || !this.host.current() || !this.host.editable()) return;
    const d = (e.target as Element).closest(DIAMONDS), r = d ? this.refOf(d) : null;
    if (r) {
      if (e.ctrlKey || e.metaKey) { // add or take away
        stop(e);
        this.seed();
        this.refs = this.has(r) ? this.refs.filter(x => refId(x) !== refId(r)) : [...this.refs, r];
        this.changed(this.has(r) ? r : this.refs.at(-1) ?? null);
        return;
      }
      if (e.shiftKey) { // the keys between the last chosen one and this one, on the lanes between
        stop(e);
        this.seed();
        const from = this.refs.at(-1), a = from ? this.diamondOf(from) : null;
        const box = a ? spanOf(a.getBoundingClientRect(), d!.getBoundingClientRect()) : d!.getBoundingClientRect();
        this.addInside(box);
        if (!this.has(r)) this.refs.push(r);
        this.changed(r);
        return;
      }
      if (this.many && this.has(r)) { stop(e); this.dragGroup(e); return; }
      this.refs = []; // a plain click on another key: one key again, and the editors take it
      return;
    }
    if (e.shiftKey && localPoint(this.host.tl, e).x > LABEL) { stop(e); this.box(e); } // a plain drag on a lane still scrubs
  }

  private diamondOf(r: KeyRef) {
    return this.host.tl.querySelector<SVGElement>(r.kind === 'key' ? `[data-key="${r.index}"]` : `[data-pkey="${r.index}"][data-param="${CSS.escape(r.id)}"]`);
  }
  /** Every key whose diamond's middle is inside `box` (client pixels) joins the set. */
  private addInside(box: { left: number; right: number; top: number; bottom: number }) {
    for (const d of this.host.tl.querySelectorAll<SVGElement>(DIAMONDS)) {
      const b = d.getBoundingClientRect(), x = (b.left + b.right) / 2, y = (b.top + b.bottom) / 2, r = this.refOf(d);
      if (r && x >= box.left && x <= box.right && y >= box.top && y <= box.bottom && !this.has(r)) this.refs.push(r);
    }
  }

  /** Shift+drag on a lane: a rectangle; the keys inside are chosen (with Ctrl too, added to the ones chosen). */
  private box(e: PointerEvent) {
    const { tl } = this.host, r0 = tl.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY, add = e.ctrlKey || e.metaKey;
    tl.setPointerCapture(e.pointerId);
    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('class', 'tl-box');
    tl.append(rect);
    const span = (m: PointerEvent) => ({ left: Math.min(x0, m.clientX), right: Math.max(x0, m.clientX), top: Math.min(y0, m.clientY), bottom: Math.max(y0, m.clientY) });
    const sx = tl.viewBox.baseVal.width / Math.max(1, r0.width) || 1, sy = tl.viewBox.baseVal.height / Math.max(1, r0.height) || 1;
    const draw = (m: PointerEvent) => {
      const b = span(m);
      rect.setAttribute('x', String((b.left - r0.left) * sx)); rect.setAttribute('y', String((b.top - r0.top) * sy));
      rect.setAttribute('width', String((b.right - b.left) * sx)); rect.setAttribute('height', String((b.bottom - b.top) * sy));
    };
    draw(e);
    followPointer(tl, draw, m => {
      rect.remove();
      if (!add) this.refs = [];
      this.addInside(span(m));
      this.changed(this.refs.at(-1) ?? null);
    });
  }

  /** A drag of one chosen key: all of them move in time by the pointer's way, clamped as a group; one undo step. */
  private dragGroup(e: PointerEvent) {
    const { tl } = this.host, c = this.host.current()!, base = c.def, baseRefs = [...this.refs], t0 = localPoint(tl, e).t;
    tl.setPointerCapture(e.pointerId);
    const end = this.host.beginDrag();
    followPointer(tl, m => {
      const out = moveKeys(base, baseRefs, localPoint(tl, m).t - t0);
      this.refs = out.refs;
      this.host.dragStep(c.name, out.def);
    }, () => end());
  }

  private key(e: KeyboardEvent) {
    const c = this.host.current();
    if (!c || !this.host.editable()) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { // every key on show
      stop(e);
      this.refs = [];
      this.addInside({ left: -Infinity, right: Infinity, top: -Infinity, bottom: Infinity });
      this.changed(this.refs.at(-1) ?? null);
      return;
    }
    if (!this.many) return;
    if (e.key === 'Escape') { stop(e); this.refs = []; this.host.note('Let go of the chosen keys.'); this.host.refreshView(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      stop(e);
      const n = this.refs.length;
      this.host.edit(() => { this.host.setAnim(c.name, deleteKeys(c.def, this.refs)); this.refs = []; this.host.setSingle(null); });
      this.host.note(`Removed ${n} keys. Ctrl+Z brings them back.`);
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      stop(e);
      const dt = (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 0.05 : 0.01) / Math.max(0.001, c.dur); // 0.01 s a press, as one key
      this.host.edit(() => { const out = moveKeys(c.def, this.refs, dt); this.host.setAnim(c.name, out.def); this.refs = out.refs; });
      this.diamondOf(this.refs.at(-1)!)?.focus();
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') stop(e); // a value is nudged one key at a time
  }

  /** The ease select, with several keys chosen: every one of them takes it (one undo step). */
  setEase(ease: string | undefined) {
    const c = this.host.current();
    if (!c || !this.many) return;
    const n = this.refs.length;
    this.host.edit(() => this.host.setAnim(c.name, setKeysEase(c.def, this.refs, ease)));
    this.host.note(`Set the ease of ${n} keys to ${ease ?? 'the default'}.`);
  }
}

/** The client rectangle spanning two elements' rectangles. */
function spanOf(a: DOMRect, b: DOMRect) {
  return { left: Math.min(a.left, b.left), right: Math.max(a.right, b.right), top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom) };
}
