// The animation studio's Clip sub-block of Properties (Model mode) and the Mask panel of the tool options bar: the mask shapes of the
// character (rig.json shape parts, see engine/src/masks.ts) and the `clip` link of the chosen part. A shape is an imageless part with its own
// row in the tree; the sub-block edits the chosen shape (its name, the bone it sits on, the part it follows, the parts it clips, its polygon
// by point number; the stage drags the points: preview/studio-gizmo.ts, the Mask tool; the bar adds and removes them) or, for a chosen part,
// what the part is clipped to. Its head line's verbs (New shape, Remove clip, Delete shape) call in here. The shape a part is clipped to
// is the one edited when the part row is chosen. The maths is in engine/src/mask-edit.ts and masks.ts; the studio keeps the working copy and
// this works through `MaskHost`. A shape's keyforms (hand-written in rig.json) are kept across edits of the polygon; the stage shows the shape they give.

import {
  addShape, checkMasks, clipTargets, clippedBy, defaultPolygon, deleteShape, edgeMidpoint, insertPolygonPoint, MASK_MAX_POINTS, MASK_MIN_POINTS, moveShape, movePolygonPoint,
  removePolygonPoint, renameShape, setClip, writeShapes,
  type CanvasBox, type DeformerDef, type ParamDef, type ShapeDef, type ShapeEdit, type ShapeSet,
} from '../engine/src/index.js';
import { el, layoutRows } from './anim-dom.js';

/** A polygon point drag in progress: `put` shows the shapes it makes, `end` makes it one undo step. */
export interface MaskDrag { put(shapes: Record<string, ShapeDef>): void; end(): void }

export interface MaskHost {
  /** The chosen row of the tree. */
  part(): string | null;
  /** A Ctrl-click set (the chosen part first), null for none: Clip to ▾ shows the clip they share and sets one on all of them. */
  setParts(): string[] | null;
  /** Is the name a part with art (a bone has no image to clip, a shape no art to be clipped)? */
  isPart(name: string): boolean;
  isShape(name: string): boolean;
  parts(): string[];
  bones(): string[];
  /** The bone a part sits on, if any. */
  boneOf(part: string): string | undefined;
  shapes(): Record<string, ShapeDef>;
  clips(): Record<string, string>;
  deformers(): DeformerDef[];
  params(): ParamDef[];
  /** Replace the shapes, clips and group members as one undo step; `choose` selects that row of the tree afterwards (null: the whole character). */
  set(next: ShapeSet, choose?: string | null): void;
  /** Begin a drag. */
  drag(): MaskDrag;
  /** The Mask tool was asked for (a new drawn shape turns it on), or the chosen point changed. */
  useTool(): void;
  /** Is the Mask tool the one in use? */
  toolOn(): boolean;
  selected(): void;
  note(text: string): void;
}

const shown = (v: number) => String(Math.round(v * 100) / 100);

export class MaskPanel {
  /** The polygon point chosen on the stage or in the list. */
  point: number | null = null;
  private lastShape: string | null = null;
  private boxes = new Map<string, CanvasBox>();
  private dragging: { name: string; base: ShapeDef; start: [number, number]; point: number; drag: MaskDrag } | null = null;
  private q: <T extends Element>(s: string) => T;

  private target: HTMLLabelElement;  // Clip to ▾: in the Clip row while the part is drawn whole, in the sub-block's head line once clipped
  private targetHome: HTMLElement;
  private addBtn: HTMLButtonElement;
  private delBtn: HTMLButtonElement;

  /**
   * `root` is the Clip sub-block's body, `pick` the place in its head line where Clip to ▾ stands once the part is clipped, and `bar` the
   * Mask panel of the tool options bar (Add point after, Remove point). New shape, Remove clip and Delete shape are the head line's verbs.
   */
  constructor(private root: HTMLElement, private pick: HTMLElement, bar: HTMLElement, private host: MaskHost) {
    this.root.innerHTML = `
      <div class="am-kind"><span class="as-pivot-name">Clip to</span>
        <label class="as-lone"><select class="am-target" aria-label="What the part is clipped to"></select></label></div>
      <p class="as-pivot-hint am-hint"></p>
      <div class="am-shape"><span class="as-pivot-name">Shape</span>
        <label>name <input type="text" class="am-name" spellcheck="false" aria-label="Name of the shape"></label>
        <button type="button" class="am-rename" title="Give the shape this name: every clip and group member that names it follows">Rename</button>
        <label>on bone <select class="am-bone" aria-label="Bone the shape sits on"></select></label>
        <label>follows <select class="am-follow" aria-label="Part whose drawn mesh the shape follows"></select></label>
        <span class="as-pivot-hint am-clips"></span></div>
      <div class="am-poly"><span class="as-pivot-name">Points</span>
        <label>point <select class="am-pick" aria-label="Point of the shape"></select></label>
        <label>x <input type="number" class="am-x" step="1" aria-label="Point x, in pixels of the PSD canvas"></label>
        <label>y <input type="number" class="am-y" step="1" aria-label="Point y, in pixels of the PSD canvas"></label>
        <span class="as-pivot-hint am-pthint"></span></div>
      <p class="as-pivot-hint am-problem" role="status"></p>`;
    layoutRows(this.root);
    this.q = <T extends Element>(s: string) => this.root.querySelector<T>(s)!;
    this.target = this.q<HTMLSelectElement>('.am-target').closest('label')!;
    this.targetHome = this.target.parentElement!;
    this.addBtn = bar.querySelector('.am-add')!;
    this.delBtn = bar.querySelector('.am-del')!;
    this.q('.am-target').addEventListener('change', e => this.clipTo((e.target as HTMLSelectElement).value));
    this.q('.am-rename').addEventListener('click', () => this.rename());
    this.q<HTMLInputElement>('.am-name').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); this.rename(); } });
    this.q('.am-bone').addEventListener('change', e => this.move({ bone: (e.target as HTMLSelectElement).value || null }));
    this.q('.am-follow').addEventListener('change', e => this.move({ follow: (e.target as HTMLSelectElement).value || null }));
    this.q<HTMLSelectElement>('.am-pick').addEventListener('change', e => { const v = (e.target as HTMLSelectElement).value; this.point = v === '' ? null : Number(v); this.show(); this.host.selected(); });
    for (const cls of ['.am-x', '.am-y']) this.q<HTMLInputElement>(cls).addEventListener('change', () => this.typed());
    this.addBtn.addEventListener('click', () => this.addAfter());
    this.delBtn.addEventListener('click', () => { if (this.point !== null) this.removePoint(this.point); });
  }

  /** A new opening of the studio. */
  reset() {
    this.point = null;
    this.lastShape = null;
    this.dragging = null;
    this.boxes.clear();
  }

  // ---- what is chosen ----
  /** The chosen row, if it is a part with art. */
  private part(): string | null { const p = this.host.part(); return p !== null && this.host.isPart(p) ? p : null; }
  /** The shape the section edits and the stage shows handles on: the chosen shape row, else the shape the chosen part is clipped to. */
  edited(): string | null {
    const p = this.host.part();
    if (p === null || this.host.setParts()) return null; // a set edits no shape: that is one part's

    if (this.host.isShape(p)) return p;
    const to = this.host.clips()[p];
    return to !== undefined && this.host.isShape(to) ? to : null;
  }
  private set(): ShapeSet { return { shapes: this.host.shapes(), clips: this.host.clips(), deformers: this.host.deformers() }; }
  private names() { return { parts: this.host.parts(), bones: this.host.bones() }; }

  /** The stage knows where a part's image lies in canvas pixels once its art has loaded. */
  box(part: string, b: CanvasBox) { this.boxes.set(part, b); }

  // ---- changes ----
  /** Apply an edit's answer: the working copy changes as one undo step and the note says what happened, or the refusal is the note. */
  private apply(r: ShapeEdit, choose?: string | null) {
    if ('error' in r) { this.host.note(r.error); this.show(); return; }
    if (r.set.shapes === this.host.shapes() && r.set.clips === this.host.clips() && r.set.deformers === this.host.deformers()) { if (r.note) this.host.note(r.note); this.show(); return; } // nothing changes
    this.host.set(r.set, choose);
    if (r.note) this.host.note(r.note);
  }
  private clipTo(target: string) {
    const part = this.part();
    if (!part) return;
    this.point = null;
    const set = this.host.setParts();
    if (set) this.clipAll(set, target || null);
    else this.apply(setClip(this.set(), new Set(this.host.parts()), part, target || null));
    this.host.selected();
  }
  /** A set: clip every part to `target` (null: draw them whole) as one undo step, or refuse with the first part that cannot be. */
  private clipAll(parts: string[], target: string | null) {
    const names = new Set(this.host.parts());
    let set = this.set();
    for (const p of parts) {
      const r = setClip(set, names, p, target);
      if ('error' in r) { this.host.note(`${p}: ${r.error}`); this.show(); return; }
      set = r.set;
    }
    this.apply({ set, note: target === null ? `The ${parts.length} parts are drawn whole again.` : `The ${parts.length} parts are clipped to ${target}.` });
  }
  /** The Clip line's verbs: Remove clip and Delete shape. */
  removeClip() { this.clipTo(''); }
  deleteShape() { this.remove(); }
  /** New shape: a shape drawn on the part's bone, the part clipped to it, and the Mask tool on to shape it. */
  newShape() {
    const part = this.part();
    if (!part) return;
    const box = this.boxes.get(part);
    if (!box) { this.host.note('The stage has not measured this part yet; try again in a moment.'); this.show(); return; }
    this.point = null;
    this.apply(addShape(this.set(), this.names(), { polygon: defaultPolygon(box), bone: this.host.boneOf(part), clipPart: part }));
    this.host.useTool();
  }
  private rename() {
    const shape = this.host.part() !== null && this.host.isShape(this.host.part()!) ? this.host.part()! : this.edited();
    if (!shape) return;
    const r = renameShape(this.set(), this.names(), shape, this.q<HTMLInputElement>('.am-name').value);
    this.apply(r, this.host.part() === shape && !('error' in r) ? r.name : undefined);
  }
  private remove() {
    const shape = this.edited();
    if (!shape) return;
    this.point = null;
    this.apply(deleteShape(this.set(), shape), this.host.part() === shape ? null : undefined);
    this.host.selected();
  }
  private move(to: { bone?: string | null; follow?: string | null }) {
    const shape = this.edited();
    if (!shape) return;
    this.apply(moveShape(this.set(), { parts: new Set(this.host.parts()), bones: new Set(this.host.bones()) }, shape, to));
  }
  /** Run `fn` on the edited shape as one undo step. */
  private change(fn: (def: ShapeDef) => ShapeDef) {
    const name = this.edited(), def = name ? this.host.shapes()[name] : undefined;
    if (!name || !def) return;
    const next = fn(def);
    if (next === def) { this.show(); return; }
    this.host.set({ ...this.set(), shapes: { ...this.host.shapes(), [name]: next } });
  }
  /** The chosen point's x or y was typed. */
  private typed() {
    const x = this.q<HTMLInputElement>('.am-x'), y = this.q<HTMLInputElement>('.am-y'), nx = Number(x.value), ny = Number(y.value);
    if (this.point === null || x.value.trim() === '' || y.value.trim() === '' || !Number.isFinite(nx) || !Number.isFinite(ny)) { this.show(); return; }
    this.change(def => movePolygonPoint(def, this.point!, [nx, ny]));
  }
  private addAfter() {
    const name = this.edited(), def = name ? this.host.shapes()[name] : undefined, i = this.point ?? (def ? def.polygon.length - 1 : null);
    if (!def || i === null) return;
    const mid = edgeMidpoint(def.polygon, i);
    if (!mid) return;
    const next = insertPolygonPoint(def, i + 1, mid);
    if (next === def) { this.host.note(`A shape has at most ${MASK_MAX_POINTS} points.`); return; }
    this.point = i + 1;
    this.change(() => next);
    this.host.selected();
  }
  private removePoint(i: number) {
    const name = this.edited(), def = name ? this.host.shapes()[name] : undefined;
    if (!def) return;
    const next = removePolygonPoint(def, i);
    if (!next) { this.host.note(`A shape needs at least ${MASK_MIN_POINTS} points; delete the shape instead.`); return; }
    this.point = Math.min(i, next.polygon.length - 1);
    this.change(() => next);
    this.host.selected();
  }

  // ---- edits from the stage ----
  /** A point was pressed (`start`), moved by `delta` canvas pixels since (`move`) or released (`end`). */
  dragged(phase: 'start' | 'move' | 'end', shape: string, point: number, delta: [number, number]) {
    if (phase === 'start') {
      this.dragging = null;
      this.point = point;
      this.host.selected();
      const def = this.host.shapes()[shape], start = def?.polygon[point];
      if (!def || !start) return;
      this.dragging = { name: shape, base: def, start: [start[0], start[1]], point, drag: this.host.drag() };
      this.show();
      return;
    }
    const d = this.dragging;
    if (!d) return;
    const next = movePolygonPoint(d.base, d.point, [d.start[0] + delta[0], d.start[1] + delta[1]]);
    d.drag.put({ ...this.host.shapes(), [d.name]: next });
    if (phase === 'end') {
      this.dragging = null;
      d.drag.end();
      // The drag moved the rest outline, whatever the parameters show: a shape's keys are written by hand (MD-2).
      if (d.base.keyforms?.length) this.host.note(`Moved point ${point} of ${d.name}'s rest outline. Its keys are not drawn here: write their points in rig.json (docs/rig-json.md, masks). Ctrl+Z undoes.`);
    }
  }
  /** A click on an edge of the outline: a point is added there, before point `index`. */
  added(shape: string, index: number, at: [number, number]) {
    const def = this.host.shapes()[shape];
    if (!def) return;
    const next = insertPolygonPoint(def, index, at);
    if (next === def) { this.host.note(`A shape has at most ${MASK_MAX_POINTS} points.`); return; }
    this.point = index;
    this.host.set({ ...this.set(), shapes: { ...this.host.shapes(), [shape]: next } });
    this.host.selected();
    this.host.note(`Added point ${index} to ${shape}${def.keyforms?.length ? '; at each key it sits on the edge it was put on' : ''}. Alt-click a point to remove it; Ctrl+Z undoes.`);
  }
  /** Alt-click on a point of the outline. */
  removed(shape: string, point: number) {
    if (this.edited() !== shape) return;
    this.removePoint(point);
  }

  // ---- showing ----
  /** Redraw from the working copy: the chosen row, its clip or shape and the chosen point. */
  show() {
    const part = this.part(), shape = this.edited(), q = this.q, chosen = this.host.part();
    const shapes = this.host.shapes(), clips = this.host.clips(), def = shape ? shapes[shape] : undefined;
    if (shape !== this.lastShape) { this.lastShape = shape; this.point = null; }
    // A set: the clip its parts share, or none shown (`mixed`) when they differ; Clip to ▾ is then in the line, blank.
    const set = part ? this.host.setParts() : null, shared = set ? new Set(set.map(p => clips[p] ?? '')) : null;
    const mixed = !!shared && shared.size > 1;
    const to = mixed ? '' : set ? [...shared!][0] : part ? clips[part] ?? '' : '';
    // Clip to ▾ stands in the head line once the part is clipped (the line then reads `Clipped to lid ▾`), in its own row before.
    const home = to || mixed ? this.pick : this.targetHome;
    if (this.target.parentElement !== home) home.append(this.target);
    q<HTMLElement>('.am-kind').hidden = !part || !!to || mixed;
    q<HTMLElement>('.am-hint').hidden = !part;
    q<HTMLElement>('.am-shape').hidden = !def;
    q<HTMLElement>('.am-poly').hidden = !def;
    // The Mask bar's point buttons: Add point after (the last point when none is chosen) and Remove point, for the shape edited.
    this.addBtn.disabled = !def || def.polygon.length >= MASK_MAX_POINTS;
    this.delBtn.disabled = !def || this.point === null || def.polygon.length <= MASK_MIN_POINTS;
    // What a part is clipped to: nothing, a shape, or another part (its drawn silhouette).
    if (part) {
      const sel = this.target.querySelector('select')!;
      const sig = `${Object.keys(shapes).join(',')}|${this.host.parts().join(',')}|${(set ?? [part]).join(',')}`;
      if (sel.dataset.sig !== sig) {
        sel.dataset.sig = sig;
        const group = (label: string, names: string[]) => { const g = document.createElement('optgroup'); g.label = label; g.append(...names.map(n => el('option', { value: n, textContent: n }))); return g; };
        const silhouettes = clipTargets(this.host.parts(), part).filter(p => !set?.includes(p)); // a part of the set cannot clip the set
        sel.replaceChildren(el('option', { value: '', textContent: '(nothing: drawn whole)' }), ...(Object.keys(shapes).length ? [group('Shapes', Object.keys(shapes))] : []), group('Parts (their drawn silhouette)', silhouettes));
      }
      sel.value = to;
      if (sel.value !== to) sel.value = ''; // a clip that names nothing real (checkRig says so)
      if (mixed) sel.selectedIndex = -1; // blank: they differ
      sel.setAttribute('aria-label', set ? `What the ${set.length} parts are clipped to` : 'What the part is clipped to');
      this.target.title = mixed ? `The ${set!.length} parts are clipped to different things (${set!.map(p => `${p}: ${clips[p] ?? 'none'}`).join(', ')}): a choice here is set on all of them` : set ? 'A choice here is set on all of them' : '';
      const text = set ? (mixed ? `The ${set.length} parts are clipped to different things: Clip to ▾ sets one on all of them.` : to ? `The ${set.length} parts are drawn only inside ${to}.` : `None of the ${set.length} parts is clipped: Clip to ▾ clips all of them to a shape or a part.`)
        : !to ? 'A mask clips the part to a shape (an iris to the eye, a mouth interior to the mouth); the stage draws it as a dashed outline. New shape draws one on the part\'s bone.'
        : def ? `${part} is drawn only inside ${to}${clippedBy({ clips }, to).length > 1 ? `, a shape that clips ${clippedBy({ clips }, to).join(', ')}` : ''}.`
          : `${part} is drawn only where ${to} has pixels, wherever ${to} moves or bends. A look that hides ${to} hides ${part} too.`;
      q<HTMLElement>('.am-hint').textContent = text;
    }
    const problem = q<HTMLElement>('.am-problem');
    const issues: string[] = [];
    if (shape || part) {
      const table = writeShapes({}, shapes, clips);
      checkMasks({ parts: table, parameters: this.host.params() }, new Set(this.host.parts()), new Set(this.host.bones()), (message, at) => { if (at === shape || at === part || message.startsWith('masks: shapes form a loop')) issues.push(message); });
    }
    problem.textContent = issues.join(' ');
    problem.hidden = !issues.length;
    if (!def || !shape) return;
    // The shape: name, bone, follow, what it clips.
    const name = q<HTMLInputElement>('.am-name');
    if (document.activeElement !== name) name.value = shape;
    const bone = q<HTMLSelectElement>('.am-bone'), follow = q<HTMLSelectElement>('.am-follow');
    bone.replaceChildren(el('option', { value: '', textContent: 'the character' }), ...this.host.bones().map(b => el('option', { value: b, textContent: b })));
    bone.value = def.bone ?? '';
    follow.replaceChildren(el('option', { value: '', textContent: '(nothing)' }), ...this.host.parts().map(p => el('option', { value: p, textContent: p })));
    follow.value = def.follow ?? '';
    const by = clippedBy({ clips }, shape);
    q<HTMLElement>('.am-clips').textContent = by.length ? `Clips ${by.join(', ')}.` : 'Clips nothing yet: choose a part and clip it to this shape.';
    // The polygon.
    const poly = def.polygon, pick = q<HTMLSelectElement>('.am-pick');
    if (this.point !== null && this.point >= poly.length) this.point = null;
    if (pick.options.length !== poly.length + 1) pick.replaceChildren(el('option', { value: '', textContent: '(none chosen)' }), ...poly.map((_, i) => el('option', { value: String(i), textContent: String(i) })));
    pick.value = this.point === null ? '' : String(this.point);
    const n = this.point;
    for (const [cls, k] of [['.am-x', 0], ['.am-y', 1]] as const) {
      const i = q<HTMLInputElement>(cls);
      i.disabled = n === null;
      if (document.activeElement !== i) i.value = n === null ? '' : shown(poly[n][k]);
    }
    this.delBtn.disabled = n === null || poly.length <= MASK_MIN_POINTS;
    const kfs = def.keyforms?.length ?? 0;
    q<HTMLElement>('.am-pthint').textContent = (n === null ? (this.host.toolOn() ? 'Drag' : 'With the Mask tool (M), drag') + ' a point of the outline, click an edge to add one, Alt-click a point to remove it. Points are in pixels of the PSD canvas.' : `Point ${n} of ${poly.length}.`)
      + (kfs ? ` ${kfs === 1 ? '1 keyform reshapes' : `${kfs} keyforms reshape`} this shape with parameters (written in rig.json).` : '');
  }
}
