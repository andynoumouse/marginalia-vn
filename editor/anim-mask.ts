// The animation studio's Mask section (Model mode): the clip of the chosen part (rig.json `masks`). It picks what the part is clipped to,
// another part's shape or a drawn polygon, and edits a polygon's points by number (the stage drags them: preview/studio-gizmo.ts, the
// Mask tool). The maths is in engine/src/mask-edit.ts and masks.ts; the studio keeps the working copy and this works through `MaskHost`.
// A polygon's keyforms (hand-written in rig.json) are kept across edits; the stage shows the shape they give.

import {
  checkMasks, defaultPolygon, edgeMidpoint, insertPolygonPoint, MASK_MAX_POINTS, MASK_MIN_POINTS, maskOf, maskSources, maskSummary, movePolygonPoint, removeMask, removePolygonPoint, setMask, setMaskOn,
  type CanvasBox, type MaskDef, type ParamDef,
} from '../engine/src/index.js';
import { el } from './anim-dom.js';

/** A polygon point drag in progress: `put` shows the masks it makes, `end` makes it one undo step. */
export interface MaskDrag { put(masks: MaskDef[]): void; end(): void }

export interface MaskHost {
  /** The chosen row of the tree. */
  part(): string | null;
  /** Is the name a part (a bone has no image to clip)? */
  isPart(name: string): boolean;
  parts(): string[];
  bones(): string[];
  masks(): MaskDef[];
  params(): ParamDef[];
  /** Replace the masks as one undo step. */
  set(next: MaskDef[]): void;
  /** Begin a drag. */
  drag(): MaskDrag;
  /** The Mask tool was asked for (a new drawn shape turns it on), or the chosen point changed. */
  useTool(): void;
  selected(): void;
  note(text: string): void;
}

const shown = (v: number) => String(Math.round(v * 100) / 100);

export class MaskPanel {
  /** The polygon point chosen on the stage or in the list. */
  point: number | null = null;
  private lastPart: string | null = null;
  private boxes = new Map<string, CanvasBox>();
  private dragging: { base: MaskDef; start: [number, number]; point: number; drag: MaskDrag } | null = null;
  private q: <T extends Element>(s: string) => T;

  constructor(private root: HTMLElement, private host: MaskHost) {
    this.root.innerHTML = `
      <p class="as-pivot-hint am-none"></p>
      <div class="am-kind"><span class="as-pivot-name">Clip to</span>
        <label>shape <select class="am-source" aria-label="What the part is clipped to">
          <option value="">(nothing: drawn whole)</option><option value="from">the shape of another part</option><option value="polygon">a drawn shape</option></select></label>
        <label class="am-fromwrap">part <select class="am-from" aria-label="Part whose shape clips this one"></select></label>
        <button type="button" class="am-remove" title="Draw the part whole again">Remove mask</button>
        <span class="as-pivot-hint am-hint"></span></div>
      <div class="am-poly"><span class="as-pivot-name">Drawn shape</span>
        <label>follows <select class="am-on" aria-label="Bone or part the shape follows"></select></label>
        <label>point <select class="am-pick" aria-label="Point of the shape"></select></label>
        <label>x <input type="number" class="am-x" step="1" aria-label="Point x, in pixels of the PSD canvas"></label>
        <label>y <input type="number" class="am-y" step="1" aria-label="Point y, in pixels of the PSD canvas"></label>
        <button type="button" class="am-add" title="Add a point halfway to the next one">Add point after</button>
        <button type="button" class="am-del" title="Remove the chosen point">Remove point</button>
        <span class="as-pivot-hint am-pthint"></span></div>
      <p class="as-pivot-hint am-problem" role="status"></p>`;
    this.q = <T extends Element>(s: string) => this.root.querySelector<T>(s)!;
    this.q('.am-source').addEventListener('change', e => this.source((e.target as HTMLSelectElement).value));
    this.q('.am-from').addEventListener('change', e => { const part = this.part(); const from = (e.target as HTMLSelectElement).value; if (part && from) this.host.set(setMask(this.host.masks(), part, { from })); });
    this.q('.am-remove').addEventListener('click', () => { const part = this.part(); if (part) { this.point = null; this.host.set(removeMask(this.host.masks(), part) as MaskDef[]); this.host.selected(); } });
    this.q('.am-on').addEventListener('change', e => this.change(def => setMaskOn(def, (e.target as HTMLSelectElement).value || null)));
    this.q<HTMLSelectElement>('.am-pick').addEventListener('change', e => { const v = (e.target as HTMLSelectElement).value; this.point = v === '' ? null : Number(v); this.show(); this.host.selected(); });
    for (const cls of ['.am-x', '.am-y']) this.q<HTMLInputElement>(cls).addEventListener('change', () => this.typed());
    this.q('.am-add').addEventListener('click', () => this.addAfter());
    this.q('.am-del').addEventListener('click', () => { if (this.point !== null) this.removePoint(this.point); });
  }

  /** A new opening of the studio. */
  reset() {
    this.point = null;
    this.lastPart = null;
    this.dragging = null;
    this.boxes.clear();
  }

  // ---- what is chosen ----
  private part(): string | null { const p = this.host.part(); return p !== null && this.host.isPart(p) ? p : null; }
  private def(): MaskDef | undefined { const p = this.part(); return p ? maskOf(this.host.masks(), p) : undefined; }

  /** The stage knows where a part's image lies in canvas pixels once its art has loaded. */
  box(part: string, b: CanvasBox) { this.boxes.set(part, b); }

  /** One line for the section header: the chosen part's mask, else how many parts have one. */
  summary(): string { return maskSummary(this.host.masks(), this.part()); }

  // ---- changes ----
  private source(kind: string) {
    const part = this.part();
    if (!part) return;
    const masks = this.host.masks();
    this.point = null;
    if (kind === '') { this.host.set(removeMask(masks, part) as MaskDef[]); this.host.selected(); return; }
    if (kind === 'from') {
      const first = maskSources(this.host.parts(), part)[0];
      if (!first) { this.host.note('This character has no other part to clip to.'); this.show(); return; }
      this.host.set(setMask(masks, part, { from: first }));
      return;
    }
    const box = this.boxes.get(part);
    if (!box) { this.host.note('The stage has not measured this part yet; try again in a moment.'); this.show(); return; }
    this.host.set(setMask(masks, part, { polygon: defaultPolygon(box) }));
    this.host.useTool();
  }
  /** Run `fn` on the chosen part's mask as one undo step. */
  private change(fn: (def: MaskDef) => MaskDef) {
    const def = this.def();
    if (!def) return;
    const next = fn(def);
    if (next === def) { this.show(); return; }
    this.host.set(this.host.masks().map(m => (m === def ? next : m)));
  }
  /** The chosen point's x or y was typed. */
  private typed() {
    const x = this.q<HTMLInputElement>('.am-x'), y = this.q<HTMLInputElement>('.am-y'), nx = Number(x.value), ny = Number(y.value);
    if (this.point === null || x.value.trim() === '' || y.value.trim() === '' || !Number.isFinite(nx) || !Number.isFinite(ny)) { this.show(); return; }
    this.change(def => movePolygonPoint(def, this.point!, [nx, ny]));
  }
  private addAfter() {
    const def = this.def(), i = this.point ?? (def?.polygon ? def.polygon.length - 1 : null);
    if (!def?.polygon || i === null) return;
    const mid = edgeMidpoint(def.polygon, i);
    if (!mid) return;
    const next = insertPolygonPoint(def, i + 1, mid);
    if (next === def) { this.host.note(`A shape has at most ${MASK_MAX_POINTS} points.`); return; }
    this.point = i + 1;
    this.host.set(this.host.masks().map(m => (m === def ? next : m)));
    this.host.selected();
  }
  private removePoint(i: number) {
    const def = this.def();
    if (!def) return;
    const next = removePolygonPoint(def, i);
    if (!next) { this.host.note(`A shape needs at least ${MASK_MIN_POINTS} points; remove the mask instead.`); return; }
    this.point = Math.min(i, next.polygon!.length - 1);
    this.host.set(this.host.masks().map(m => (m === def ? next : m)));
    this.host.selected();
  }

  // ---- edits from the stage ----
  /** A point was pressed (`start`), moved by `delta` canvas pixels since (`move`) or released (`end`). */
  dragged(phase: 'start' | 'move' | 'end', part: string, point: number, delta: [number, number]) {
    if (phase === 'start') {
      this.dragging = null;
      this.point = point;
      this.host.selected();
      const def = maskOf(this.host.masks(), part), start = def?.polygon?.[point];
      if (!def || !start) return;
      this.dragging = { base: def, start: [start[0], start[1]], point, drag: this.host.drag() };
      this.show();
      return;
    }
    const d = this.dragging;
    if (!d) return;
    const next = movePolygonPoint(d.base, d.point, [d.start[0] + delta[0], d.start[1] + delta[1]]);
    d.drag.put(this.host.masks().map(m => (m === d.base || m.id === d.base.id ? next : m)));
    if (phase === 'end') { this.dragging = null; d.drag.end(); }
  }
  /** A click on an edge of the outline: a point is added there, before point `index`. */
  added(part: string, index: number, at: [number, number]) {
    const def = maskOf(this.host.masks(), part);
    if (!def) return;
    const next = insertPolygonPoint(def, index, at);
    if (next === def) { this.host.note(`A shape has at most ${MASK_MAX_POINTS} points.`); return; }
    this.point = index;
    this.host.set(this.host.masks().map(m => (m === def ? next : m)));
    this.host.selected();
  }
  /** Alt-click on a point of the outline. */
  removed(part: string, point: number) {
    if (this.part() !== part) return;
    this.removePoint(point);
  }

  // ---- showing ----
  /** Redraw from the working copy: the chosen part, its mask and the chosen point. */
  show() {
    const part = this.part(), def = this.def(), q = this.q, chosen = this.host.part();
    if (part !== this.lastPart) { this.lastPart = part; this.point = null; }
    const none = !chosen ? 'Choose a part in the tree to clip it to a shape, or to edit its clip.'
      : !part ? `${chosen} is a bone. A mask clips a part: choose one of the parts on it.` : '';
    q<HTMLElement>('.am-none').textContent = none;
    q<HTMLElement>('.am-none').hidden = !none;
    q<HTMLElement>('.am-kind').hidden = !part;
    const kind = !def ? '' : def.from !== undefined ? 'from' : 'polygon';
    q<HTMLSelectElement>('.am-source').value = kind;
    q<HTMLElement>('.am-fromwrap').hidden = kind !== 'from';
    q<HTMLElement>('.am-remove').hidden = !def;
    q<HTMLElement>('.am-poly').hidden = kind !== 'polygon';
    const problem = q<HTMLElement>('.am-problem');
    const issues: string[] = [];
    if (def) checkMasks({ masks: this.host.masks(), parameters: this.host.params() }, new Set(this.host.parts()), new Set(this.host.bones()), (message, at) => { if (at === def.id || message.startsWith('masks: shapes form a loop')) issues.push(message); });
    problem.textContent = issues.join(' ');
    problem.hidden = !issues.length;
    q<HTMLElement>('.am-hint').textContent = !part ? '' : !def ? 'A mask clips the part to a shape (an iris to the eye, a mouth interior to the mouth); the stage draws it as a dashed outline.'
      : kind === 'from' ? `${part} is drawn only where ${def.from} has pixels, wherever ${def.from} moves or bends. A look that hides ${def.from} hides ${part} too.`
        : 'Choose the Mask tool (M): drag a point of the outline, click an edge to add one, Alt-click a point to remove it.';
    if (kind === 'from') {
      const sel = q<HTMLSelectElement>('.am-from');
      sel.replaceChildren(...maskSources(this.host.parts(), part!).map(p => el('option', { value: p, textContent: p })));
      sel.value = def!.from!;
    }
    if (kind !== 'polygon') return;
    const poly = def!.polygon ?? [], on = q<HTMLSelectElement>('.am-on');
    on.replaceChildren(el('option', { value: '', textContent: 'the character' }), ...this.host.bones().map(b => el('option', { value: b, textContent: `${b} (bone)` })), ...maskSources(this.host.parts(), part!).map(p => el('option', { value: p, textContent: p })));
    on.value = def!.on ?? '';
    if (this.point !== null && this.point >= poly.length) this.point = null;
    const pick = q<HTMLSelectElement>('.am-pick');
    if (pick.options.length !== poly.length + 1) pick.replaceChildren(el('option', { value: '', textContent: '(none chosen)' }), ...poly.map((_, i) => el('option', { value: String(i), textContent: String(i) })));
    pick.value = this.point === null ? '' : String(this.point);
    const n = this.point;
    for (const [cls, k] of [['.am-x', 0], ['.am-y', 1]] as const) {
      const i = q<HTMLInputElement>(cls);
      i.disabled = n === null;
      if (document.activeElement !== i) i.value = n === null ? '' : shown(poly[n][k]);
    }
    q<HTMLButtonElement>('.am-del').disabled = n === null || poly.length <= MASK_MIN_POINTS;
    const kfs = def!.keyforms?.length ?? 0;
    q<HTMLElement>('.am-pthint').textContent = (n === null ? 'Click a point on the stage (Mask tool, M), or choose one here. Points are in pixels of the PSD canvas.' : `Point ${n} of ${poly.length}.`)
      + (kfs ? ` ${kfs === 1 ? '1 keyform reshapes' : `${kfs} keyforms reshape`} this shape with parameters (written in rig.json).` : '');
  }
}
