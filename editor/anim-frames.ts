// Editing the frame tracks of the animation on show (`animations.<name>.frames`): a row of blocks per slot on the
// timeline, a block per held frame. Select, drag (retime), nudge and delete a block, double-click a row to add a
// frame; the Frames tab's buttons fill a track from a slot, duplicate and reorder blocks. Same shape as TrackEditor
// (anim-ptracks.ts): the studio keeps the working copy and the undo stack and this works through `FrameHost`.
// A clip written as `{ slot, frames, fps }` is expanded to keys on the first edit.

import {
  addFrameKey, asKeys, deleteFrame, duplicateFrame, framesFromSlot, reorderFrame, retimeFrame, retimeFrameAt, setFrame, trackOfSlot, withFrameTrack,
  type AnimDef, type FrameTrackDef,
} from '../engine/src/index.js';
import { LABEL, frameLaneAt, localPoint } from './anim-timeline.js';

export interface FrameHost {
  tl: SVGSVGElement;
  current(): { name: string; preset: boolean; def: AnimDef; dur: number } | null;
  editable(): boolean;
  /** The variants of each slot of the character, in PSD order. */
  slots(): Record<string, string[]>;
  /** The frame rows drawn, in order, and how many parameter lanes sit above them. */
  rows(): string[];
  paramLanes(): number;
  setAnim(name: string, def: AnimDef): void;
  edit(fn: () => void): void;
  dragStep(name: string, def: AnimDef): void;
  beginDrag(): () => void;
  seek(t: number): void;
  refreshView(): void;
  note(text: string): void;
}

export class FrameEditor {
  sel: { slot: string; index: number } | null = null;

  constructor(private host: FrameHost) {
    const { tl } = host;
    tl.addEventListener('pointerdown', e => this.pointerDown(e));
    tl.addEventListener('dblclick', e => this.addAtPointer(e));
    tl.addEventListener('keydown', e => this.blockKey(e));
  }

  /** Forget the selection when its block is gone. */
  clamp() {
    const c = this.host.current();
    if (this.sel && !(c && this.keysOf(c, this.sel.slot)[this.sel.index])) this.sel = null;
  }

  /** The keys of the track for `slot` as the studio edits them (a clip expanded for the animation's length). */
  private keysOf(c: { def: AnimDef; dur: number }, slot: string) {
    const tr = trackOfSlot(c.def, slot);
    return tr ? asKeys(tr, c.dur).keys! : [];
  }

  /** `fn` applied to the track for `slot` (as plain keys); the new definition and, from `index`, where the block ended up. */
  private change(c: { def: AnimDef; dur: number }, slot: string, fn: (t: FrameTrackDef) => FrameTrackDef): AnimDef {
    const tr = trackOfSlot(c.def, slot);
    return tr ? withFrameTrack(c.def, slot, fn(asKeys(tr, c.dur))) : c.def;
  }

  /** Apply an edit to the selected block's track and keep the selection on `follow(index)`. */
  apply(fn: (t: FrameTrackDef, index: number) => FrameTrackDef, follow: (index: number) => number = i => i) {
    const c = this.host.current(), sel = this.sel;
    if (!c || c.preset || !sel) return;
    this.host.edit(() => {
      this.host.setAnim(c.name, this.change(c, sel.slot, t => fn(t, sel.index)));
      this.sel = { slot: sel.slot, index: follow(sel.index) };
    });
  }

  /** Fill (or replace) the track for `slot` with every variant of it, `fps` frames a second. */
  fillFromSlot(slot: string, fps: number) {
    const c = this.host.current(), variants = this.host.slots()[slot];
    if (!c || c.preset || !variants?.length) return;
    const track = framesFromSlot(slot, variants, fps, c.dur);
    this.host.edit(() => {
      this.host.setAnim(c.name, withFrameTrack(c.def, slot, track));
      this.sel = { slot, index: 0 };
    });
    const cut = variants.length - (track.keys?.length ?? 0);
    this.host.note(cut > 0 ? `${track.keys!.length} of ${variants.length} frames fit in ${c.dur}s at ${fps} fps; lengthen the animation to fit the rest.` : `${variants.length} frames at ${fps} fps over ${c.dur}s.`);
  }

  removeTrack(slot: string) {
    const c = this.host.current();
    if (!c || c.preset) return;
    this.host.edit(() => { this.host.setAnim(c.name, withFrameTrack(c.def, slot, null)); if (this.sel?.slot === slot) this.sel = null; });
  }

  duplicate() { this.apply((t, i) => duplicateFrame(t, i), i => i + 1); }
  /** Move the selected block's frame one place earlier (-1) or later (+1) in the order; the times stay. */
  reorder(by: -1 | 1) { this.apply((t, i) => reorderFrame(t, i, i + by), i => i + by); }
  setFrame(frame: string) { this.apply((t, i) => setFrame(t, i, frame)); }
  setTime(t: number) { this.apply((tr, i) => retimeFrame(tr, i, t)); }
  deleteSelected() {
    const c = this.host.current();
    this.apply((t, i) => deleteFrame(t, i));
    if (c) this.sel = null;
  }

  private pointerDown(e: PointerEvent) {
    const { host } = this, { tl } = host;
    const block = (e.target as Element).closest<SVGElement>('[data-fkey]');
    if (!block) return;
    const slot = block.dataset.fslot!, index = Number(block.dataset.fkey);
    this.sel = { slot, index };
    const c0 = host.current();
    const start = c0 ? this.keysOf(c0, slot)[index] : undefined;
    if (!host.editable() || !c0 || !start) { host.refreshView(); return; }
    host.seek(start.t); // clicking a block shows its frame on the stage
    tl.setPointerCapture(e.pointerId);
    const end = host.beginDrag();
    let moved = false;
    const move = (m: PointerEvent) => {
      const p = localPoint(tl, m), c = host.current()!;
      if (!moved && Math.abs(m.clientX - e.clientX) < 3) return;
      moved = true;
      const tr = trackOfSlot(c.def, slot);
      if (!tr) return;
      const out = retimeFrameAt(asKeys(tr, c.dur), this.sel!.index, Math.round(p.t * c.dur * 24) / 24 / c.dur); // snapped to 1/24 s
      this.sel = { slot, index: out.index };
      host.dragStep(c.name, withFrameTrack(c.def, slot, out.track));
    };
    const up = () => { tl.removeEventListener('pointermove', move); tl.removeEventListener('pointerup', up); end(); };
    tl.addEventListener('pointermove', move);
    tl.addEventListener('pointerup', up);
    host.refreshView();
  }

  private addAtPointer(e: MouseEvent) {
    const { host } = this;
    if (!host.editable() || (e.target as Element).closest('[data-fkey]')) return;
    const p = localPoint(host.tl, e), rows = host.rows(), i = frameLaneAt(p.y, host.paramLanes(), rows.length), c = host.current();
    if (i < 0 || p.x < LABEL || !c) return;
    const slot = rows[i], keys = this.keysOf(c, slot);
    const before = [...keys].reverse().find(k => k.t <= p.t) ?? keys[0];
    const frame = before?.frame ?? host.slots()[slot]?.[0] ?? 'none';
    const t = Math.round(p.t * 100) / 100;
    host.edit(() => {
      const out = this.change(c, slot, tr => addFrameKey(tr, t, frame));
      host.setAnim(c.name, out);
      this.sel = { slot, index: this.keysOf({ def: out, dur: c.dur }, slot).findIndex(k => Math.abs(k.t - t) < 0.0006) };
    });
  }

  private blockKey(e: KeyboardEvent) {
    const el = (e.target as Element).closest<SVGElement>('[data-fkey]'), c = this.host.current();
    if (!el || !c || !this.host.editable() || !this.sel) return;
    const { slot, index } = this.sel, k = this.keysOf(c, slot)[index];
    if (!k) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.deleteSelected(); return; }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const t = k.t + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 0.05 : 0.01);
    this.host.edit(() => {
      const moved = retimeFrameAt(asKeys(trackOfSlot(c.def, slot)!, c.dur), index, t);
      this.host.setAnim(c.name, withFrameTrack(c.def, slot, moved.track));
      this.sel = { slot, index: moved.index };
    });
    this.host.tl.querySelector<SVGElement>(`[data-fkey="${this.sel?.index}"][data-fslot="${slot}"]`)?.focus();
  }
}
