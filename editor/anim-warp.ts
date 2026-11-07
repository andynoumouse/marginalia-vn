// The animation studio's Warp section (Model mode): the mesh warp of the chosen part (rig.json `deformers`). It adds, resizes
// and removes the warp, picks the parameter whose keyform is edited (its slider is the one in Parameters), turns a lattice
// point dragged on the stage into a key of that keyform, and offers reset, mirror, smooth and the shape presets. The maths is
// in engine/src/warp-edit.ts; the stage draws the lattice and reports drags (preview/studio-gizmo.ts). The studio keeps the
// working copy; this works through `WarpHost`.

import {
  addDeformer, deformerGrid, deformerOf, deformerPoints, deleteWarpKey, DEFORMER_MAX_GRID, dragWarpPoint, mirrorWarp, ownDisplacement, removeDeformer, replaceDeformer,
  resetWarpPoint, resizeWarp, setWarpOwn, smoothWarp, warpKeyAt, warpKeyValues, warpPreset, WARP_PRESETS, type DeformerDef, type ParamDef, type PartBox, type WarpPreset,
} from '../engine/src/index.js';
import { el } from './anim-dom.js';

/** A drag in progress: `put` shows the deformers it makes, `end` makes it one undo step. */
export interface WarpDrag { put(deformers: DeformerDef[]): void; end(): void }

export interface WarpHost {
  /** The chosen row of the tree. */
  part(): string | null;
  /** The warp is keyed to the parameter active in the Parameters section (null while none or a pad is). */
  activeParam(): string | null;
  /** Is the name a part (a bone has no image to warp)? */
  isPart(name: string): boolean;
  deformers(): DeformerDef[];
  params(): ParamDef[];
  /** The parameter values the stage shows now. */
  values(): Record<string, number>;
  /** Move a parameter's slider (the one in the Parameters section). */
  setValue(id: string, value: number): void;
  /** Replace the deformers as one undo step. */
  set(next: DeformerDef[]): void;
  /** Begin a drag. */
  drag(): WarpDrag;
  /** The Warp tool was asked for (Add warp turns it on), or its lattice should show another point. */
  useTool(): void;
  selected(): void;
  /** The name of an animation with a frame track on slot `part`, if any (a warped part cannot swap frames). */
  framedIn(part: string): string | null;
  note(text: string): void;
}

const shown = (v: number) => String(Math.round(v * 100000) / 100000);

export class WarpPanel {
  /** The lattice point chosen on the stage, for Reset point. */
  point: number | null = null;
  private param: string | null = null;
  private lastPart: string | null = null;
  private boxes = new Map<string, PartBox>();
  private dragging: { base: DeformerDef; param: ParamDef; value: number; drag: WarpDrag } | null = null;
  private q: <T extends Element>(s: string) => T;

  constructor(private root: HTMLElement, private host: WarpHost) {
    this.root.innerHTML = `
      <p class="as-pivot-hint aw-none"></p>
      <div class="aw-add"><span class="as-pivot-name">Warp</span><button type="button" class="aw-addbtn"></button>
        <span class="as-pivot-hint">A lattice over the part's image. Dragging its points in a parameter's keyform bends the part as the parameter moves.</span></div>
      <div class="aw-grid"><span class="as-pivot-name">Lattice</span>
        <label>columns <input type="number" class="aw-cols" min="1" max="${DEFORMER_MAX_GRID}" step="1"></label>
        <label>rows <input type="number" class="aw-rows" min="1" max="${DEFORMER_MAX_GRID}" step="1"></label>
        <button type="button" class="aw-remove">Remove warp</button></div>
      <div class="aw-form"><span class="as-pivot-name">Keyform</span>
        <span class="aw-active"></span>
        <button type="button" class="aw-delkey" title="Remove the key at this value">Delete key</button>
        <span class="aw-keys" role="group" aria-label="Keys of this parameter"></span>
        <span class="as-pivot-hint aw-keyhint"></span></div>
      <div class="aw-pt"><span class="as-pivot-name">Point</span>
        <label><select class="aw-pick" aria-label="Lattice point"></select></label>
        <label>dx <input type="number" class="aw-dx" step="0.005" aria-label="Sideways move of the point in this keyform"></label>
        <label>dy <input type="number" class="aw-dy" step="0.005" aria-label="Vertical move of the point in this keyform"></label>
        <button type="button" class="aw-reset" title="Take the chosen point back to rest in this keyform">Reset point</button>
        <span class="as-pivot-hint aw-pthint"></span></div>
      <div class="aw-tools"><span class="as-pivot-name">Tools</span>
        <button type="button" class="aw-mirror-lr" title="Copy the left half of this keyform to the right, mirrored">Mirror left to right</button>
        <button type="button" class="aw-mirror-rl" title="Copy the right half of this keyform to the left, mirrored">Mirror right to left</button>
        <button type="button" class="aw-smooth" title="Even out the points of this keyform; press again for more">Smooth</button></div>
      <div class="aw-presets"><span class="as-pivot-name">Preset</span>
        <label>Shape <select class="aw-preset" aria-label="Shape"></select></label>
        <label>amount <input type="number" class="aw-amount" min="0" step="0.01"></label>
        <button type="button" class="aw-write" title="Write the shape as the keys of the chosen parameter, replacing the ones it has">Write keys</button>
        <span class="as-pivot-hint aw-presethint"></span></div>`;
    this.q = <T extends Element>(s: string) => this.root.querySelector<T>(s)!;
    this.q<HTMLSelectElement>('.aw-preset').append(...WARP_PRESETS.map(p => el('option', { value: p.id, textContent: p.label })));
    this.setAmount();
    this.q<HTMLSelectElement>('.aw-preset').addEventListener('change', () => { this.setAmount(); this.show(); });
    this.q('.aw-addbtn').addEventListener('click', () => this.add());
    this.q('.aw-remove').addEventListener('click', () => { const p = this.part(); if (p) { this.point = null; this.host.set(removeDeformer(this.host.deformers(), p)); } });
    for (const cls of ['.aw-cols', '.aw-rows']) this.q<HTMLInputElement>(cls).addEventListener('change', () => this.resize());
    this.q('.aw-delkey').addEventListener('click', () => this.change(def => deleteWarpKey(def, this.active()!, this.value()), 'There is no key at this value.'));
    this.q<HTMLSelectElement>('.aw-pick').addEventListener('change', e => { const v = (e.target as HTMLSelectElement).value; this.point = v === '' ? null : Number(v); for (const cls of ['.aw-dx', '.aw-dy']) this.q<HTMLInputElement>(cls).blur(); this.show(); this.host.selected(); });
    for (const cls of ['.aw-dx', '.aw-dy']) this.q<HTMLInputElement>(cls).addEventListener('change', () => this.typed());
    this.q('.aw-reset').addEventListener('click', () => { if (this.point !== null) this.change(def => resetWarpPoint(def, this.active()!, this.value(), this.point!), 'The point is at rest in this keyform already.'); });
    this.q('.aw-mirror-lr').addEventListener('click', () => this.change(def => mirrorWarp(def, this.active()!, this.value(), 'left'), 'The right half already mirrors the left.'));
    this.q('.aw-mirror-rl').addEventListener('click', () => this.change(def => mirrorWarp(def, this.active()!, this.value(), 'right'), 'The left half already mirrors the right.'));
    this.q('.aw-smooth').addEventListener('click', () => this.change(def => smoothWarp(def, this.active()!, this.value()), 'Nothing to smooth: the points of this keyform are even.'));
    this.q('.aw-write').addEventListener('click', () => this.write());
  }

  /** A new opening of the studio. */
  reset() {
    this.point = null;
    this.param = null;
    this.lastPart = null;
    this.dragging = null;
    this.boxes.clear();
  }

  // ---- what is chosen ----
  private part(): string | null { const p = this.host.part(); return p !== null && this.host.isPart(p) ? p : null; }
  private def(): DeformerDef | undefined { const p = this.part(); return p ? deformerOf(this.host.deformers(), p) : undefined; }
  private active(): ParamDef | null { return this.host.params().find(p => p.id === this.param) ?? null; }
  private value(): number { const p = this.active(); return p ? (this.host.values()[p.id] ?? p.default) : 0; }

  /** The stage knows the size of a part's image once its art has loaded. */
  box(part: string, w: number, h: number) { this.boxes.set(part, { w, h }); }

  /** One line for the section header: the chosen part's lattice, else how many parts have a warp. */
  summary(): string {
    const d = this.def(), all = this.host.deformers().length;
    if (d) { const [c, r] = deformerGrid(d); return `${c}×${r}`; }
    return all ? `${all} part${all === 1 ? '' : 's'}` : 'none';
  }

  // ---- changes ----
  private add() {
    const part = this.part();
    if (!part) return;
    const clash = this.host.framedIn(part);
    if (clash) { this.host.note(`${part} has a frame track in ${clash}; a warped part cannot swap frames. Remove the track first.`); return; }
    this.point = null;
    this.host.set(addDeformer(this.host.deformers(), part));
    this.host.useTool();
  }
  private resize() {
    const def = this.def();
    if (!def) return;
    const next = resizeWarp(def, [Number(this.q<HTMLInputElement>('.aw-cols').value), Number(this.q<HTMLInputElement>('.aw-rows').value)]);
    if (next === def) { this.show(); return; }
    if (this.point !== null && this.point >= deformerPoints(next)) this.point = null;
    this.host.set(replaceDeformer(this.host.deformers(), next));
  }
  /** Run `fn` on the chosen part's deformer as one undo step; `same` is the note when it changes nothing. */
  private change(fn: (def: DeformerDef) => DeformerDef, same: string) {
    const def = this.def(), param = this.active();
    if (!def || !param) return;
    const next = fn(def);
    if (next === def) { this.host.note(same); return; }
    this.host.set(replaceDeformer(this.host.deformers(), next));
  }
  /** The point's displacement was typed: sets what this keyform moves it by. */
  private typed() {
    const dx = this.q<HTMLInputElement>('.aw-dx'), dy = this.q<HTMLInputElement>('.aw-dy'), x = Number(dx.value), y = Number(dy.value);
    if (this.point === null || dx.value.trim() === '' || dy.value.trim() === '' || !Number.isFinite(x) || !Number.isFinite(y)) { this.show(); return; }
    this.change(def => setWarpOwn(def, this.active()!, this.value(), [[this.point!, [x, y]]]), 'That is what the point has already.');
  }
  private write() {
    const def = this.def(), param = this.active(), part = this.part();
    if (!def || !param || !part) return;
    const box = this.boxes.get(part);
    if (!box) { this.host.note('The stage has not measured this part yet; choose the Warp tool and try again in a moment.'); return; }
    const kind = this.q<HTMLSelectElement>('.aw-preset').value as WarpPreset, amount = Number(this.q<HTMLInputElement>('.aw-amount').value);
    this.host.set(replaceDeformer(this.host.deformers(), warpPreset(def, param, kind, box, Number.isFinite(amount) && amount >= 0 ? { amount } : {})));
    this.host.note(`${WARP_PRESETS.find(p => p.id === kind)!.label} written as the keys of ${param.id} (${warpKeyValues(this.def() ?? def, param.id).join(', ')}).`);
  }
  private setAmount() {
    const p = WARP_PRESETS.find(x => x.id === this.q<HTMLSelectElement>('.aw-preset').value);
    if (p) this.q<HTMLInputElement>('.aw-amount').value = String(p.amount);
  }

  // ---- drags from the stage ----
  /** A lattice point was pressed (`start`), moved by `delta` since (`move`) or released (`end`). */
  dragged(phase: 'start' | 'move' | 'end', part: string, point: number, delta: [number, number]) {
    if (phase === 'start') {
      this.dragging = null;
      this.point = point;
      this.host.selected();
      const def = deformerOf(this.host.deformers(), part), param = this.active();
      if (!def) return;
      if (!param) { this.host.note('Pick a slider in the Parameters section first (click its name): the warp is keyed to the active parameter.'); this.show(); return; }
      this.dragging = { base: def, param, value: this.value(), drag: this.host.drag() };
      this.show();
      return;
    }
    const d = this.dragging;
    if (!d) return;
    d.drag.put(replaceDeformer(this.host.deformers(), dragWarpPoint(d.base, d.param, d.value, point, delta)));
    if (phase === 'end') { this.dragging = null; d.drag.end(); }
  }

  // ---- showing ----
  /** Redraw from the working copy: the chosen part, its warp, the parameter and its value. */
  show() {
    const part = this.part(), def = this.def(), params = this.host.params(), q = this.q;
    if (part !== this.lastPart) { this.lastPart = part; this.point = null; this.param = null; }
    if (def && this.point !== null && this.point >= deformerPoints(def)) this.point = null;
    this.param = this.host.activeParam();
    const chosen = this.host.part();
    const none = !chosen ? 'Choose a part in the tree to give it a warp, or to edit the one it has.'
      : !part ? `${chosen} is a bone. A warp belongs to a part: choose one of the parts on it.`
        : !params.length ? 'This rig has no parameters. A warp bends with a parameter: add "parameters" to its rig.json.' : '';
    q<HTMLElement>('.aw-none').textContent = none;
    q<HTMLElement>('.aw-none').hidden = !none;
    const add = q<HTMLElement>('.aw-add');
    add.hidden = !part || !!def;
    q<HTMLButtonElement>('.aw-addbtn').disabled = !params.length;
    q<HTMLElement>('.aw-addbtn').textContent = part ? `Add warp to ${part}` : 'Add warp';
    for (const cls of ['.aw-grid', '.aw-form', '.aw-tools', '.aw-presets']) q<HTMLElement>(cls).hidden = !def;
    if (!def) return;
    const note = q<HTMLElement>('.aw-active');

    note.textContent = this.param ? `Keyed to ${this.param}, the active parameter: move its slider in Parameters.` : 'Pick a slider in Parameters (click its name): the warp is keyed to the active parameter.';
    const [cols, rows] = deformerGrid(def);
    for (const [cls, v] of [['.aw-cols', cols], ['.aw-rows', rows]] as const) { const i = q<HTMLInputElement>(cls); if (document.activeElement !== i) i.value = String(v); }
    const p = this.active();
    for (const cls of ['.aw-delkey', '.aw-reset', '.aw-mirror-lr', '.aw-mirror-rl', '.aw-smooth', '.aw-preset', '.aw-amount', '.aw-write']) q<HTMLInputElement>(cls).disabled = !p;
    const keys = q<HTMLElement>('.aw-keys');
    if (!p) { keys.replaceChildren(); q<HTMLElement>('.aw-keyhint').textContent = ''; q<HTMLElement>('.aw-pthint').textContent = ''; return; }
    const v = this.value(), at = warpKeyAt(def, p, v);
    keys.replaceChildren(...warpKeyValues(def, p.id).map(k => {
      const b = el('button', { type: 'button', className: 'aw-key', textContent: shown(k), title: `Go to the key at ${shown(k)}` });
      b.setAttribute('aria-pressed', String(k === at));
      b.addEventListener('click', () => this.host.setValue(p.id, k));
      return b;
    }));
    q<HTMLButtonElement>('.aw-delkey').disabled = at === null;
    q<HTMLElement>('.aw-keyhint').textContent = at !== null ? `On the key at ${shown(at)}: a dragged point changes it.`
      : warpKeyValues(def, p.id).length ? `No key at ${shown(v)}: dragging a point adds one there, keeping the curve as it is.` : `${p.id} has no keys on this warp yet: dragging a point makes the first, with rest at ${shown(p.default)}.`;
    const own = ownDisplacement(def, p, v), n = this.point, pick = q<HTMLSelectElement>('.aw-pick');
    const where = (i: number) => `${i} (column ${i % (cols + 1)}, row ${Math.floor(i / (cols + 1))})`;
    if (pick.options.length !== deformerPoints(def) + 1 || pick.dataset.cols !== String(cols)) {
      pick.dataset.cols = String(cols);
      pick.replaceChildren(el('option', { value: '', textContent: '(none chosen)' }), ...Array.from({ length: deformerPoints(def) }, (_, i) => el('option', { value: String(i), textContent: where(i) })));
    }
    pick.value = n === null ? '' : String(n);
    for (const [cls, k] of [['.aw-dx', 0], ['.aw-dy', 1]] as const) {
      const i = q<HTMLInputElement>(cls);
      i.disabled = n === null;
      if (document.activeElement !== i) i.value = n === null ? '' : shown(own[n * 2 + k]);
    }
    q<HTMLButtonElement>('.aw-reset').disabled = n === null;
    q<HTMLElement>('.aw-pthint').textContent = n === null ? 'Click a point on the stage (Warp tool, D), or choose one here.' : `Point ${where(n)}: how far this keyform moves it, in stage units.`;
    q<HTMLElement>('.aw-presethint').textContent = WARP_PRESETS.find(x => x.id === q<HTMLSelectElement>('.aw-preset').value)?.hint ?? '';
  }
}
