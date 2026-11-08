// The animation studio's Mask section (Model mode): the mask shapes of the character (rig.json shape parts, see engine/src/masks.ts) and the
// `clip` link of the chosen part. A shape is an imageless part with its own row in the tree; the section edits the chosen shape (its name,
// the bone it sits on, the part it follows, the parts it clips, its polygon by point number; the stage drags the points: preview/studio-gizmo.ts,
// the Mask tool) or, for a chosen part, what the part is clipped to, with a button that draws a new shape on its bone. A part's own shape
// is the one edited when the part row is chosen. The maths is in engine/src/mask-edit.ts and masks.ts; the studio keeps the working copy and
// this works through `MaskHost`. A shape's keyforms (hand-written in rig.json) are kept across edits of the polygon; the stage shows the shape they give.

import {
  addShape, addToGroup, checkMasks, clipGroupIssues, clipTargets, clippedBy, defaultPolygon, deleteShape, edgeMidpoint, insertPolygonPoint, MASK_MAX_POINTS, MASK_MIN_POINTS, moveShape, movePolygonPoint,
  removePolygonPoint, renameShape, setClip, shapeSummary, writeShapes,
  type CanvasBox, type DeformerDef, type ParamDef, type ShapeDef, type ShapeEdit, type ShapeSet,
} from '../engine/src/index.js';
import { el } from './anim-dom.js';

/** A polygon point drag in progress: `put` shows the shapes it makes, `end` makes it one undo step. */
export interface MaskDrag { put(shapes: Record<string, ShapeDef>): void; end(): void }

export interface MaskHost {
  /** The chosen row of the tree. */
  part(): string | null;
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

  constructor(private root: HTMLElement, private host: MaskHost) {
    this.root.innerHTML = `
      <p class="as-pivot-hint am-none"></p>
      <div class="am-kind"><span class="as-pivot-name">Clip to</span>
        <label><select class="am-target" aria-label="What the part is clipped to"></select></label>
        <button type="button" class="am-new" title="Draw a new shape on this part's bone and clip the part to it">New shape</button>
        <button type="button" class="am-remove" title="Draw the part whole again">Remove clip</button>
        <span class="as-pivot-hint am-hint"></span></div>
      <div class="am-shape"><span class="as-pivot-name">Shape</span>
        <label>name <input type="text" class="am-name" spellcheck="false" aria-label="Name of the shape"></label>
        <button type="button" class="am-rename" title="Give the shape this name: every clip and group member that names it follows">Rename</button>
        <button type="button" class="am-delete" title="Delete the shape: the parts it clips are drawn whole again">Delete shape</button>
        <label>on bone <select class="am-bone" aria-label="Bone the shape sits on"></select></label>
        <label>follows <select class="am-follow" aria-label="Part whose drawn mesh the shape follows"></select></label>
        <span class="as-pivot-hint am-clips"></span></div>
      <div class="am-poly"><span class="as-pivot-name">Points</span>
        <label>point <select class="am-pick" aria-label="Point of the shape"></select></label>
        <label>x <input type="number" class="am-x" step="1" aria-label="Point x, in pixels of the PSD canvas"></label>
        <label>y <input type="number" class="am-y" step="1" aria-label="Point y, in pixels of the PSD canvas"></label>
        <button type="button" class="am-add" title="Add a point halfway to the next one">Add point after</button>
        <button type="button" class="am-del" title="Remove the chosen point">Remove point</button>
        <span class="as-pivot-hint am-pthint"></span></div>
      <div class="am-groupnote"></div>
      <p class="as-pivot-hint am-problem" role="status"></p>`;
    this.q = <T extends Element>(s: string) => this.root.querySelector<T>(s)!;
    this.q('.am-target').addEventListener('change', e => this.clipTo((e.target as HTMLSelectElement).value));
    this.q('.am-new').addEventListener('click', () => this.newShape());
    this.q('.am-remove').addEventListener('click', () => this.clipTo(''));
    this.q('.am-rename').addEventListener('click', () => this.rename());
    this.q<HTMLInputElement>('.am-name').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); this.rename(); } });
    this.q('.am-delete').addEventListener('click', () => this.remove());
    this.q('.am-bone').addEventListener('change', e => this.move({ bone: (e.target as HTMLSelectElement).value || null }));
    this.q('.am-follow').addEventListener('change', e => this.move({ follow: (e.target as HTMLSelectElement).value || null }));
    this.q<HTMLSelectElement>('.am-pick').addEventListener('change', e => { const v = (e.target as HTMLSelectElement).value; this.point = v === '' ? null : Number(v); this.show(); this.host.selected(); });
    for (const cls of ['.am-x', '.am-y']) this.q<HTMLInputElement>(cls).addEventListener('change', () => this.typed());
    this.q('.am-add').addEventListener('click', () => this.addAfter());
    this.q('.am-del').addEventListener('click', () => { if (this.point !== null) this.removePoint(this.point); });
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
    if (p === null) return null;
    if (this.host.isShape(p)) return p;
    const to = this.host.clips()[p];
    return to !== undefined && this.host.isShape(to) ? to : null;
  }
  private set(): ShapeSet { return { shapes: this.host.shapes(), clips: this.host.clips(), deformers: this.host.deformers() }; }
  private names() { return { parts: this.host.parts(), bones: this.host.bones() }; }

  /** The stage knows where a part's image lies in canvas pixels once its art has loaded. */
  box(part: string, b: CanvasBox) { this.boxes.set(part, b); }

  /** One line for the section header: the chosen row's shape or clip, else how many shapes there are. */
  summary(): string { return shapeSummary({ shapes: this.host.shapes(), clips: this.host.clips() }, this.host.part()); }

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
    this.apply(setClip(this.set(), new Set(this.host.parts()), part, target || null));
    this.host.selected();
  }
  private newShape() {
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
    if (phase === 'end') { this.dragging = null; d.drag.end(); }
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
    const none = !chosen ? 'Choose a part in the tree to clip it to a shape, or a shape to edit it.'
      : !part && !shape ? `${chosen} is a bone. A mask clips a part: choose one of the parts on it.` : '';
    q<HTMLElement>('.am-none').textContent = none;
    q<HTMLElement>('.am-none').hidden = !none;
    q<HTMLElement>('.am-kind').hidden = !part;
    q<HTMLElement>('.am-shape').hidden = !def;
    q<HTMLElement>('.am-poly').hidden = !def;
    // What a part is clipped to: nothing, a shape, or another part (its drawn silhouette).
    if (part) {
      const sel = q<HTMLSelectElement>('.am-target'), to = clips[part] ?? '';
      const sig = `${Object.keys(shapes).join(',')}|${this.host.parts().join(',')}|${part}`;
      if (sel.dataset.sig !== sig) {
        sel.dataset.sig = sig;
        const group = (label: string, names: string[]) => { const g = document.createElement('optgroup'); g.label = label; g.append(...names.map(n => el('option', { value: n, textContent: n }))); return g; };
        sel.replaceChildren(el('option', { value: '', textContent: '(nothing: drawn whole)' }), ...(Object.keys(shapes).length ? [group('Shapes', Object.keys(shapes))] : []), group('Parts (their drawn silhouette)', clipTargets(this.host.parts(), part)));
      }
      sel.value = to;
      if (sel.value !== to) sel.value = ''; // a clip that names nothing real (checkRig says so)
      q<HTMLElement>('.am-remove').hidden = !to;
      const text = !to ? 'A mask clips the part to a shape (an iris to the eye, a mouth interior to the mouth); the stage draws it as a dashed outline. New shape draws one on the part\'s bone.'
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
    // A clipped part that a group warp bends while its shape is not bent with it.
    const gn = q<HTMLElement>('.am-groupnote'), found = clipGroupIssues(this.set()).filter(i => i.part === part || i.shape === shape);
    gn.replaceChildren(...found.map(i => {
      const b = el('button', { type: 'button', className: 'am-fixgroup', textContent: `Add ${i.shape} to ${i.group}`, title: 'Make the shape a member of the group warp, so it bends with the part it clips' });
      b.addEventListener('click', () => this.host.set({ ...this.set(), deformers: addToGroup(this.host.deformers(), i.group, i.shape) }));
      return el('span', { className: 'as-pivot-hint am-groupissue' }, `${i.part} is bent by the group warp ${i.group}, but its shape ${i.shape} is not a member: the lid would stay while the part moves. `, b);
    }));
    gn.hidden = !found.length;
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
    q<HTMLButtonElement>('.am-del').disabled = n === null || poly.length <= MASK_MIN_POINTS;
    const kfs = def.keyforms?.length ?? 0;
    q<HTMLElement>('.am-pthint').textContent = (n === null ? 'Choose the Mask tool (M): drag a point of the outline, click an edge to add one, Alt-click a point to remove it. Points are in pixels of the PSD canvas.' : `Point ${n} of ${poly.length}.`)
      + (kfs ? ` ${kfs === 1 ? '1 keyform reshapes' : `${kfs} keyforms reshape`} this shape with parameters (written in rig.json).` : '');
  }
}
