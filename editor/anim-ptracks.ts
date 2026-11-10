// Editing the parameter tracks of the animation on show: selecting, dragging, nudging and deleting a key diamond on a
// parameter lane of the timeline, and adding a key with a double click. Same shape as KeyEditor (anim-keys.ts), for
// `animations.<name>.params`; the studio keeps the working copy and the undo stack and this works through `TrackHost`.

import { addParamKey, deleteParamKey, setParamKey, type AnimDef } from '../engine/src/index.js';
import { LABEL, localPoint, paramLaneAt, paramValueAt } from './anim-timeline.js';

export interface TrackHost {
  tl: SVGSVGElement;
  current(): { name: string; preset: boolean; def: AnimDef } | null;
  editable(): boolean;
  /** The lanes drawn, in order: the parameter ids with their ranges. */
  lanes(): { id: string; min: number; max: number }[];
  setAnim(name: string, def: AnimDef): void;
  edit(fn: () => void): void;
  dragStep(name: string, def: AnimDef): void;
  beginDrag(): () => void;
  seek(t: number): void;
  refreshView(): void;
}

export class TrackEditor {
  sel: { id: string; index: number } | null = null;

  constructor(private host: TrackHost) {
    const { tl } = host;
    tl.addEventListener('pointerdown', e => this.pointerDown(e));
    tl.addEventListener('dblclick', e => this.addAtPointer(e));
    tl.addEventListener('keydown', e => this.diamondKey(e));
  }

  /** Forget the selection when its key is gone. */
  clamp() {
    const c = this.host.current();
    if (this.sel && !c?.def.params?.[this.sel.id]?.[this.sel.index]) this.sel = null;
  }

  private range(id: string) { return this.host.lanes().find(l => l.id === id); }

  private pointerDown(e: PointerEvent) {
    const { host } = this, { tl } = host;
    const key = (e.target as Element).closest<SVGElement>('[data-pkey]');
    if (!key) return;
    const id = key.dataset.param!, index = Number(key.dataset.pkey), r = this.range(id), lane = host.lanes().findIndex(l => l.id === id);
    this.sel = { id, index };
    if (!host.editable() || !r) { host.seek(localPoint(tl, e).t); host.refreshView(); this.focusSel(); return; }
    tl.setPointerCapture(e.pointerId);
    const end = host.beginDrag();
    const move = (m: PointerEvent) => {
      const p = localPoint(tl, m), c = host.current()!;
      const out = setParamKey(c.def, id, this.sel!.index, { t: p.t, v: paramValueAt(tl, lane, p.y, r.min, r.max) });
      this.sel = { id, index: out.index };
      host.dragStep(c.name, out.def);
    };
    const up = () => { tl.removeEventListener('pointermove', move); tl.removeEventListener('pointerup', up); end(); this.focusSel(); };
    tl.addEventListener('pointermove', move);
    tl.addEventListener('pointerup', up);
    host.refreshView();
    this.focusSel();
  }
  /** The selected key takes the focus after a click (the timeline redraws its keys), so Delete and the arrows work on it at once. */
  private focusSel() {
    if (this.sel) this.host.tl.querySelector<SVGElement>(`[data-pkey="${this.sel.index}"][data-param="${CSS.escape(this.sel.id)}"]`)?.focus({ preventScroll: true });
  }

  private addAtPointer(e: MouseEvent) {
    const { host } = this;
    if (!host.editable() || (e.target as Element).closest('[data-pkey]')) return;
    const p = localPoint(host.tl, e), lanes = host.lanes(), i = paramLaneAt(host.tl, p.y);
    const c = host.current();
    if (i < 0 || p.x < LABEL || !c) return;
    const { id, min, max } = lanes[i];
    host.edit(() => {
      const r = addParamKey(c.def, id, { t: Math.round(p.t * 100) / 100, v: paramValueAt(host.tl, i, p.y, min, max) });
      host.setAnim(c.name, r.def);
      this.sel = { id, index: r.index };
    });
  }

  private diamondKey(e: KeyboardEvent) {
    const key = (e.target as Element).closest<SVGElement>('[data-pkey]'), c = this.host.current();
    if (!key || !c || !this.host.editable() || !this.sel) return;
    const { id, index } = this.sel, r = this.range(id), k = c.def.params?.[id]?.[index];
    if (!r || !k) return;
    const big = e.shiftKey ? 5 : 1;
    let patch: { t?: number; v?: number } | null = null;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') patch = { t: k.t + (e.key === 'ArrowRight' ? 1 : -1) * 0.01 * big / (c.def.dur ?? 1) }; // 0.01 s a press
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') patch = { v: Math.min(r.max, Math.max(r.min, k.v + (e.key === 'ArrowUp' ? 1 : -1) * ((r.max - r.min) / 100) * big)) };
    else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      this.host.edit(() => { this.host.setAnim(c.name, deleteParamKey(c.def, id, index)); this.sel = null; });
      return;
    }
    if (!patch) return;
    e.preventDefault();
    this.host.edit(() => {
      const out = setParamKey(c.def, id, index, patch!);
      this.host.setAnim(c.name, out.def);
      this.sel = { id, index: out.index };
    });
    this.host.tl.querySelector<SVGElement>(`[data-pkey="${this.sel?.index}"][data-param="${id}"]`)?.focus();
  }

  /** Change the selected key's ease (the Parameters tab's field). */
  patchSelected(patch: { t?: number; v?: number; ease?: string }) {
    const c = this.host.current();
    if (!c || c.preset || !this.sel) return;
    const { id, index } = this.sel;
    this.host.edit(() => {
      const out = setParamKey(c.def, id, index, patch);
      this.host.setAnim(c.name, out.def);
      this.sel = { id, index: out.index };
    });
  }
}
