// Editing the keys of the animation on show: the selected key, field and nudge edits, adding and removing keys, and
// dragging a diamond on the timeline. The studio keeps the working copy and the undo stack; this works through `KeysHost`.

import { addKey, CHANNEL_REST, deleteKey, keysOf, progressOf, sampleChannel, setKey, type AnimDef, type KeyChannel, type KeyDef } from '../engine/src/index.js';
import { channelAt, LABEL, localPoint, NUDGE, valueAt } from './anim-timeline.js';
import { followPointer } from './pointer.js';

export interface KeysEntry { name: string; preset: boolean; def: AnimDef; dur: number }

export interface KeysHost {
  tl: SVGSVGElement;
  current(): KeysEntry | null;
  editable(): boolean;
  /** The part being shown (new keys are made for it), the playhead and the channel of the add row. */
  part(): string | null;
  time(): number;
  addChannel(): KeyChannel;
  ranges(): Record<KeyChannel, number>;
  /** Put a changed definition of animation `name` into the working copy (no refresh). */
  setAnim(name: string, def: AnimDef): void;
  /** Change the working copy with `fn` as one undo step. */
  edit(fn: () => void): void;
  /** A drag step: store the definition, rebuild the entries and refresh the stage and view. */
  dragStep(name: string, def: AnimDef): void;
  /** Start a drag (returns a function ending it: an undo step if anything changed, else a refresh). */
  beginDrag(): () => void;
  seek(t: number): void;
  note(text: string): void;
  refreshView(): void;
}

export class KeyEditor {
  /** Index into the animation's keys. */
  sel: number | null = null;
  /** Lane ranges held still while a key is dragged. */
  frozen: Partial<Record<KeyChannel, number>> | null = null;

  constructor(private host: KeysHost) {
    const { tl } = host;
    tl.addEventListener('pointerdown', e => this.pointerDown(e));
    tl.addEventListener('dblclick', e => this.addAtPointer(e));
    tl.addEventListener('keydown', e => this.diamondKey(e));
  }

  selectedKey(): KeyDef | null { return this.sel === null ? null : this.host.current()?.def.keys[this.sel] ?? null; }

  /** Forget the selection when the key it pointed at is gone. */
  clamp() { if (this.sel !== null && !this.host.current()?.def.keys[this.sel]) this.sel = null; }

  /** Change the selected key; the key keeps its place in the selection even when `t` moves it past another. */
  patchSelected(patch: Partial<KeyDef>) {
    const c = this.host.current();
    if (!c || c.preset || this.sel === null) return;
    this.host.edit(() => {
      const r = setKey(c.def, this.sel!, patch);
      this.host.setAnim(c.name, r.def);
      this.sel = r.index;
    });
  }
  fieldChanged(name: 't' | KeyChannel, raw: string) {
    if (name === 't') { // typed in seconds, kept as a fraction of the animation
      const s = Number(raw);
      if (raw !== '' && Number.isFinite(s)) this.patchSelected({ t: progressOf(s, this.host.current()?.dur ?? 1) }); else this.host.refreshView();
      return;
    }
    const v = Number(raw);
    this.patchSelected({ [name]: raw === '' || !Number.isFinite(v) ? undefined : v });
  }
  removeSelected() {
    const c = this.host.current();
    if (!c || c.preset || this.sel === null) return;
    this.host.edit(() => { this.host.setAnim(c.name, deleteKey(c.def, this.sel!)); this.sel = null; });
  }
  /** Add a key of one channel at `t`, with `value` (and for the part being shown, its `part`). */
  private addKeyAt(ch: KeyChannel, t: number, value: number) {
    const c = this.host.current();
    if (!c || c.preset) return;
    this.host.edit(() => {
      const key: KeyDef = { t, [ch]: Math.round(value * 10000) / 10000 };
      const part = this.host.part();
      if (part) key.part = part;
      const r = addKey(c.def, key);
      this.host.setAnim(c.name, r.def);
      this.sel = r.index;
    });
  }
  addAtPlayhead() {
    const c = this.host.current();
    if (!c || c.preset) return;
    const ch = this.host.addChannel(), t = this.host.time();
    const v = sampleChannel(c.def, ch, this.host.part(), 120)[Math.round(t * 120)] ?? 0;
    this.addKeyAt(ch, t, v);
  }

  // ---- pointer and keyboard on the timeline ----
  private pointerDown(e: PointerEvent) {
    const { host } = this, { tl } = host;
    if ((e.target as Element).closest('[data-pkey]')) return; // a parameter key: ParamTracks handles it
    const key = (e.target as Element).closest<SVGElement>('[data-key]');
    tl.setPointerCapture(e.pointerId);
    let move: (m: PointerEvent) => void;
    if (key && host.editable()) {
      const ch = key.dataset.ch as KeyChannel;
      this.sel = Number(key.dataset.key);
      this.frozen = { ...host.ranges() };
      const end = host.beginDrag();
      // The key moves by how far the pointer went, not to where it is: a sideways drag keeps the value, an upward one keeps the time (SA-13).
      const range = this.frozen[ch] ?? host.ranges()[ch], start = localPoint(tl, e), k0 = host.current()!.def.keys[this.sel];
      const t0 = k0?.t ?? start.t, v0 = k0?.[ch] ?? valueAt(tl, ch, start.y, range), y0 = valueAt(tl, ch, start.y, range);
      move = m => {
        const p = localPoint(tl, m), c = host.current()!;
        const r = setKey(c.def, this.sel!, { t: Math.min(1, Math.max(0, t0 + p.t - start.t)), [ch]: v0 + valueAt(tl, ch, p.y, range) - y0 });
        this.sel = r.index;
        host.dragStep(c.name, r.def);
      };
      followPointer(tl, move, () => {
        this.frozen = null;
        end();
        this.focusSel(ch);
      });
      host.refreshView();
      this.focusSel(ch);
      return;
    }
    const c = host.current();
    if (c?.preset) host.note(`${c.name} is a preset and cannot be changed. Press "Edit copy" to make an editable version.`);
    else if (key) this.sel = Number(key.dataset.key);
    host.seek(localPoint(tl, e).t);
    followPointer(tl, m => host.seek(localPoint(tl, m).t));
  }

  /** The selected key takes the focus after a click (the timeline redraws its keys), so Delete and the arrows work on it at once. */
  private focusSel(ch: KeyChannel) {
    if (this.sel !== null) this.host.tl.querySelector<SVGElement>(`[data-key="${this.sel}"][data-ch="${ch}"]`)?.focus({ preventScroll: true });
  }

  private addAtPointer(e: MouseEvent) {
    const { host } = this;
    if (!host.editable() || (e.target as Element).closest('[data-key]')) return;
    const rest = (e.target as Element).closest<SVGElement>('[data-rest]'), c = host.current();
    if (rest && c) {
      // A hollow rest at an end: a key there with the nearest key's value holds the pose instead of easing to rest.
      const ch = rest.dataset.ch as KeyChannel, end = Number(rest.dataset.rest);
      const vals = keysOf(c.def, host.part()).flatMap(k => (Number.isFinite(k.key[ch]) ? [k.key[ch]!] : []));
      if (vals.length) this.addKeyAt(ch, end, end ? vals[vals.length - 1] : vals[0]);
      return;
    }
    const p = localPoint(host.tl, e), lane = channelAt(host.tl, p.y);
    if (p.x < LABEL || !lane) return;
    const { ch } = lane, t = Math.round(p.t * 100) / 100;
    // A folded lane (no key yet) has no height to read a value from: the first key is at rest, and the lane opens for dragging it.
    if (lane.folded) { this.addKeyAt(ch, t, CHANNEL_REST[ch]); return; }
    // A click lands anywhere on the lane: round to the step a nudge uses so the value reads cleanly.
    const step = ch === 'rot' ? 0.1 : 0.001;
    this.addKeyAt(ch, t, Math.round(valueAt(host.tl, ch, p.y, this.frozen?.[ch] ?? host.ranges()[ch]) / step) * step);
  }

  private diamondKey(e: KeyboardEvent) {
    const key = (e.target as Element).closest<SVGElement>('[data-key]');
    if (!key || !this.host.editable() || this.sel === null) return;
    const ch = key.dataset.ch as KeyChannel, big = e.shiftKey ? 5 : 1, k = this.selectedKey();
    let patch: Partial<KeyDef> | null = null;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') patch = { t: (k?.t ?? 0) + (e.key === 'ArrowRight' ? 1 : -1) * 0.01 * big / (this.host.current()?.dur ?? 1) }; // 0.01 s a press
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') patch = { [ch]: Math.max(ch === 'opacity' ? 0 : -Infinity, (k?.[ch] ?? CHANNEL_REST[ch]) + (e.key === 'ArrowUp' ? 1 : -1) * NUDGE[ch] * big) };
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.removeSelected(); return; }
    if (!patch) return;
    e.preventDefault();
    this.patchSelected(patch);
    this.host.tl.querySelector<SVGElement>(`[data-key="${this.sel}"][data-ch="${ch}"]`)?.focus();
  }
}
