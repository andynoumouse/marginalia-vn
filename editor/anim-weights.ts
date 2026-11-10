// The animation studio's Weights tool (Model mode): bone weights of the chosen part's free mesh, so the part bends along the
// skeleton instead of turning as one piece (rig.json `deformers[].mesh.weights`, docs/design/skinning.md). The Skin sub-block of
// Properties binds bones to the mesh (Bind ▾ in its line; the list of bones that may influence it), reads a vertex out and fills the
// weights with Auto-weights; its line's Remove skin calls `unskin`. The tool options bar holds the brush, the active bone, the test pose
// and the selection's operations (studio-inspector.ts `weightsBar`). The maths is in
// engine/src/skin-edit.ts; the studio keeps the working copy of the deformers and this works through `WeightsHost`.

import {
  applyAutoWeights, applyNumeric, meshMirrorPartners, mirrorWeights, pairedBone, vertexWeights, cleanSelection, combineSelection, boneHeat, boundBones, paintWeights, startSkinning, weightsText, defaultBlend, deformerOf, isSkinned, resolvePivots, stopSkinning,
  BRUSH_RADIUS, BRUSH_STRENGTH, brushStep, weightsBar, DEFAULT_BRUSH, EMPTY_WEIGHTS_SESSION, effectiveBrush, isPaintBrush, patchWeightsSession, unbindBone, weightsSession,
  type Bones, type BrushMode, type NumericOp, type DeformerDef, type SkinState, type GizmoTool, type WeightsBrush, type WeightsSession, type WeightsSessions,
} from '../engine/src/index.js';
import { el, layoutRows } from './anim-dom.js';
import { confirmAsk, promptAsk } from './ask.js';
import { iconButton, type IconName } from './studio-icons.js';
import { Popover } from './studio-popover.js';
import type { WarpDrag } from './anim-warp.js';

export interface WeightsHost {
  /** The chosen row of the tree. */
  part(): string | null;
  /** Is the name a part (a bone has no image to weight)? */
  isPart(name: string): boolean;
  deformers(): DeformerDef[];
  /** rig.json `bones`. */
  bones(): Bones;
  /** The bone a part sits on, if any. */
  boneOf(part: string): string | undefined;
  /** The size of the canvas in pixels (the pivots of bones left without one are measured against it). */
  canvas(): [number, number];
  /** Where the part's image box sits on the canvas, in pixels. */
  origin(part: string): [number, number] | null;
  /** Replace the deformers as one undo step. */
  set(next: DeformerDef[]): void;
  /** Begin a brush stroke: the stage shows each dab as it goes, the release makes the whole stroke one undo step. */
  drag(): WarpDrag;
  /** The Weights tool was asked for. */
  useTool(): void;
  /** Is the Weights tool on (the stage shows the mesh's weights only then)? */
  toolOn(): boolean;
  /** What the stage shows has changed: send it again. */
  changed(): void;
  /** Is the skeleton in a test pose now? */
  posed(): boolean;
  /** Let go of the test pose. */
  resetPose(): void;
  /** The gizmo of the test pose changed: tell the stage. */
  poseChanged(): void;
  note(text: string): void;
}

export class WeightsPanel {
  /**
   * The panel's state per mesh (by deformer id), for the opening: the bones bound here that have no weight yet, the active bone (the one the
   * stage shows and the brush paints), the vertex read out and the vertex selection. A change of the chosen row and a return find a mesh as it was
   * (docs/design/studio-stage-modes.md); a miss on the stage never resets it.
   */
  private sessions: WeightsSessions = {};
  private busy = false;
  /** What a drag on the stage does: read a vertex's weights (pick), select, or paint with the brush; per opening, starting on Add. The brush radius is in screen pixels. */
  private mode: WeightsBrush = DEFAULT_BRUSH;
  private radius = 30;
  private strength = 0.25;
  private stroke: WarpDrag | null = null;
  /** The gizmo that poses the active bone without keying (null: none, a click on the stage works as the brush mode says). */
  private poseTool: GizmoTool | null = null;
  /** A mesh's image size in pixels by deformer id, once the stage has measured it (Mirror needs the middle). */
  private sizes = new Map<string, [number, number]>();
  /** The partner bones the author named for bones whose names say no side, kept for the next Mirror. */
  private pairs: Record<string, string> = {};
  private q: <T extends Element>(s: string) => T;
  private setValue: Popover;
  private mirrorPop: Popover;

  /**
   * `root` is the Skin sub-block's body (the bones bound, the vertex read out, Auto-weights), `pick` the place in its line where Bind ▾
   * stands (choosing a bone binds it), `bar` the Weights panel of the tool options bar (the brush, the active bone, the test pose, the selection).
   */
  constructor(private root: HTMLElement, pick: HTMLElement, private bar: HTMLElement, private host: WeightsHost) {
    pick.insertAdjacentHTML('beforeend', '<label class="as-lone"><select class="aw-bindpick" aria-label="Bind a bone to the mesh"></select></label>');
    this.root.innerHTML = `
      <p class="as-pivot-hint aww-none"></p>
      <div class="aw-bind"><span class="as-pivot-name">Bones</span>
        <span class="aw-bound" role="group" aria-label="Bones bound to the mesh"></span>
        <span class="as-pivot-hint aw-bindhint"></span></div>
      <div class="aw-read"><span class="as-pivot-name">Vertex</span>
        <span class="aww-readout" role="status"></span>
        <span class="aww-vfields" role="group" aria-label="Weight of each bone on the vertex"></span></div>
      <div class="aw-auto"><span class="as-pivot-name">Auto-weights</span>
        <label>blend <input type="number" class="aw-blend" min="1" step="1" placeholder="auto" aria-label="How far a bone's pull reaches past its body, in image pixels"></label>
        <button type="button" class="aw-autobtn">Auto-weights</button>
        <span class="as-pivot-hint aw-autohint"></span></div>`;
    layoutRows(this.root);
    const mode = (m: WeightsBrush, ic: IconName, label: string, does: string) =>
      iconButton({ icon: ic, label, pressed: false, className: 'aww-modebtn', data: { brush: m }, title: `${label}: ${does}` });
    this.bar.innerHTML = `
      <span class="atb-grp aww-brush">
        <span class="aww-modes" role="group" aria-label="What dragging on the stage does">${[
          mode('add', 'brush-add', 'Add', "drag over the mesh to add to the active bone's weight"),
          mode('subtract', 'brush-subtract', 'Subtract', "drag over the mesh to take from the active bone's weight"),
          mode('replace', 'brush-replace', 'Replace', "drag over the mesh to set the active bone's weight to the strength"),
          mode('smooth', 'brush-smooth', 'Smooth', "drag over the mesh to blur every bone's weights toward the neighbours"),
          mode('pick', 'pick', 'Read weights', 'click a vertex to read its weights (Properties › Skin, Vertex)'),
          mode('select', 'select', 'Select', 'drag a rectangle to select vertices (Shift adds, Shift-click toggles one, Esc clears)'),
        ].join('')}</span>
        <label class="aww-paint" title="Brush radius in screen pixels ([ and ])">radius <input type="number" class="aww-radius" min="${BRUSH_RADIUS[0]}" max="${BRUSH_RADIUS[1]}" step="1" value="30" aria-label="Brush radius in screen pixels"></label>
        <label class="aww-paint" title="How much of the active bone's weight one touch adds, 0.05 to 1 (Shift+[ and Shift+])">strength <input type="number" class="aww-strength" min="${BRUSH_STRENGTH[0]}" max="${BRUSH_STRENGTH[1]}" step="0.05" value="0.25" aria-label="How much of the active bone's weight one touch adds, from 0.05 to 1"></label>
        <select class="aww-bone" aria-label="Active bone: the one the stage shows and the brush paints" title="Active bone: the one the stage shows and the brush paints"></select></span>
      <span class="atb-grp aww-pose" role="group" aria-label="Test pose: pose the active bone to see the mesh bend; nothing is keyed">
        ${iconButton({ icon: 'rotate', label: 'Rotate the active bone', pressed: false, className: 'aww-posebtn', data: { pose: 'rotate' }, title: 'Test pose, Rotate: turn the active bone with a gizmo on the stage, to see the mesh bend. Nothing is keyed' })}
        ${iconButton({ icon: 'move', label: 'Move the active bone', pressed: false, className: 'aww-posebtn', data: { pose: 'move' }, title: 'Test pose, Move: move the active bone with a gizmo on the stage. Nothing is keyed' })}
        ${iconButton({ icon: 'reset', label: 'Reset pose', className: 'aww-posereset', title: 'Reset pose: back to the rest pose (leaving the tool does it too)' })}</span>
      <span class="atb-grp aww-sel" role="group" aria-label="Selection">
        ${iconButton({ icon: 'select-all', label: 'Select all', className: 'aww-all', title: 'All: select every vertex of the mesh (Ctrl+A on the stage)' })}
        ${iconButton({ icon: 'select-none', label: 'Select none', className: 'aww-none-btn', title: 'None: clear the selection (Esc on the stage)' })}
        ${iconButton({ icon: 'invert', label: 'Invert selection', className: 'aww-invert', title: 'Invert: select the vertices that are not selected' })}
        <span class="atb-pop">${iconButton({ icon: 'value', label: 'Set value…', className: 'aww-setvalue', title: 'Set value…: set, add, take, smooth or prune the weights of the selected vertices' })}
          <span class="atb-panel aww-num" role="group" aria-label="Weights of the selected vertices">
            <label>value <input type="number" class="aww-value" min="0" max="1" step="0.05" value="0.5" aria-label="A weight from 0 to 1 for the active bone"></label>
            <button type="button" class="aww-numbtn" data-op="set" title="Give the active bone this weight on the selected vertices">Set</button>
            <button type="button" class="aww-numbtn" data-op="add" title="Add this to the active bone's weight on the selected vertices">Add</button>
            <button type="button" class="aww-numbtn" data-op="subtract" title="Take this from the active bone's weight on the selected vertices">Subtract</button>
            <label>smooth <input type="number" class="aww-smooth" min="0.05" max="1" step="0.05" value="0.5" aria-label="How far each selected vertex moves toward its neighbours' weights, 0.05 to 1"></label>
            <button type="button" class="aww-numbtn" data-op="smooth" title="Blur the weights of the selected vertices toward their neighbours">Smooth</button>
            <label>limit <input type="number" class="aww-prune" min="0.01" max="1" step="0.01" value="0.05" aria-label="Weights below this are dropped, 0.01 to 1"></label>
            <button type="button" class="aww-numbtn" data-op="prune" title="Drop the weights below the limit on the selected vertices">Prune</button>
            <button type="button" class="aww-numbtn" data-op="reset" title="Bind the selected vertices to the default bone again">Reset to default bone</button>
            <span class="as-pivot-hint aww-numhint" role="status"></span></span></span>
        <span class="atb-pop">${iconButton({ icon: 'mirror', label: 'Mirror…', className: 'aww-mirror', title: 'Mirror…: copy the weights of one half of the image onto the other' })}
          <span class="atb-panel aww-mirpanel" role="group" aria-label="Mirror the weights">
            <button type="button" class="aww-mirbtn" data-from="left" title="Copy the weights of the left half of the image onto the right half">Left half to right</button>
            <button type="button" class="aww-mirbtn" data-from="right" title="Copy the weights of the right half of the image onto the left half">Right half to left</button>
            <span class="as-pivot-hint aww-mirhint" role="status"></span></span></span>
        <span class="aww-selhint" role="status"></span></span>`;
    this.setValue = new Popover(this.bar.querySelector('.aww-setvalue')!, this.bar.querySelector('.aww-num')!);
    this.mirrorPop = new Popover(this.bar.querySelector('.aww-mirror')!, this.bar.querySelector('.aww-mirpanel')!);
    this.q = <T extends Element>(s: string) => (this.root.querySelector<T>(s) ?? this.bar.querySelector<T>(s) ?? pick.querySelector<T>(s))!;
    this.q<HTMLSelectElement>('.aw-bindpick').addEventListener('change', e => { const s = e.target as HTMLSelectElement, bone = s.value; s.value = ''; if (bone) this.bind(bone); });
    for (const b of this.bar.querySelectorAll<HTMLButtonElement>('.aww-posebtn')) b.addEventListener('click', () => {
      const tool = b.dataset.pose as GizmoTool;
      this.poseTool = this.poseTool === tool ? null : tool;
      this.show();
      this.host.poseChanged();
    });
    this.q('.aww-posereset').addEventListener('click', () => { this.host.resetPose(); this.show(); });
    for (const b of this.bar.querySelectorAll<HTMLButtonElement>('.aww-modebtn')) b.addEventListener('click', () => { this.mode = b.dataset.brush as WeightsBrush; this.show(); this.host.changed(); });
    this.q('.aww-bone').addEventListener('change', () => { this.put({ active: this.q<HTMLSelectElement>('.aww-bone').value || null }); this.show(); this.host.useTool(); this.host.changed(); });
    this.q('.aww-radius').addEventListener('change', () => { const v = Number(this.q<HTMLInputElement>('.aww-radius').value); if (v >= BRUSH_RADIUS[0]) this.radius = Math.min(BRUSH_RADIUS[1], v); this.show(); this.host.changed(); });
    this.q('.aww-strength').addEventListener('change', () => { const v = Number(this.q<HTMLInputElement>('.aww-strength').value); if (v > 0) this.strength = Math.min(BRUSH_STRENGTH[1], v); this.show(); this.host.changed(); });
    this.q('.aww-all').addEventListener('click', () => { const n = this.count(); this.choose(this.def()?.id ?? '', Array.from({ length: n }, (_, i) => i), 'set'); });
    this.q('.aww-none-btn').addEventListener('click', () => this.choose(this.def()?.id ?? '', [], 'set'));
    this.q('.aww-invert').addEventListener('click', () => {
      const s = new Set(this.selected);
      this.choose(this.def()?.id ?? '', Array.from({ length: this.count() }, (_, i) => i).filter(i => !s.has(i)), 'set');
    });
    for (const b of this.bar.querySelectorAll<HTMLButtonElement>('.aww-numbtn')) b.addEventListener('click', () => this.numeric(b.dataset.op as NumericOp['kind']));
    for (const b of this.bar.querySelectorAll<HTMLButtonElement>('.aww-mirbtn')) b.addEventListener('click', () => void this.mirror(b.dataset.from as 'left' | 'right'));
    this.q('.aw-autobtn').addEventListener('click', () => void this.auto());
  }

  /** `[` and `]` (Shift: the strength) with the Weights tool on: true when the key was used. */
  brushKey(key: string, shift: boolean): boolean {
    if (!this.def() || !this.bound().length) return false;
    const next = brushStep(key, shift, this.radius, this.strength);
    if (!next) return false;
    const grew = next.radius !== this.radius;
    this.radius = next.radius;
    this.strength = next.strength;
    this.show();
    if (grew) this.host.changed();
    this.host.note(`Brush radius ${this.radius} px, strength ${this.strength}.`);
    return true;
  }
  /** The mode label's words for the bar: the brush mode the stage acts on and the active bone; null without a mesh to weight. */
  label(): { brush: WeightsBrush; bone: string | null } | null { return this.def() ? { brush: this.brush(), bone: this.active } : null; }

  /** A new opening: every mesh starts afresh, and the brush on Add. */
  reset() {
    this.sessions = {};
    this.mode = DEFAULT_BRUSH;
    this.sizes.clear();
    this.pairs = {};
  }

  /** The state of the chosen part's mesh (empty for none). */
  private get sess(): WeightsSession { const id = this.def()?.id; return id === undefined ? EMPTY_WEIGHTS_SESSION : weightsSession(this.sessions, id); }
  /** Change the state of the chosen part's mesh. */
  private put(patch: Partial<WeightsSession>) { const id = this.def()?.id; if (id !== undefined) this.sessions = patchWeightsSession(this.sessions, id, patch); }
  private get active(): string | null { return this.sess.active; }
  private get picked(): number | null { return this.sess.picked; }
  private get selected(): readonly number[] { return this.sess.selected; }

  /** The stage has measured the image of mesh `id` (pixels): Mirror can find the middle. */
  box(id: string, pw?: number, ph?: number) {
    if (!pw || !ph) return;
    const known = this.sizes.get(id);
    if (known && known[0] === pw && known[1] === ph) return;
    this.sizes.set(id, [pw, ph]);
    this.show();
  }

  /** Ask which bone mirrors `bone` (its name says no side); null when cancelled. The answer must be a bone of the rig, `bone` itself for one on the middle. */
  private async askPartner(bone: string, names: ReadonlySet<string>): Promise<string | null> {
    let note = '';
    for (let tries = 0; tries < 3; tries++) {
      const answer = await promptAsk(`${note}Which bone is the partner of "${bone}" on the other side? Type its name (the bone itself, if it sits on the middle).`, bone, 'Use');
      if (answer === null) return null;
      const name = answer.trim();
      if (names.has(name)) return name;
      note = `"${name}" is no bone of this rig. `;
    }
    return null;
  }

  /**
   * Mirror the weights of one half of the image onto the other, across its vertical middle: each vertex gives its weights to the vertex at the
   * mirrored spot, with every bone replaced by its partner (`_l` / `_r` and the like by name, else the one the author names). Nothing is guessed; one undo step.
   */
  private async mirror(from: 'left' | 'right') {
    const d = this.def(), part = this.part(), size = d ? this.sizes.get(d.id) : undefined;
    if (!d?.mesh || !part || !size || this.busy) return;
    if (!isSkinned(d.mesh)) { this.host.note('Weight the mesh first: there is nothing to mirror.'); return; }
    const names = new Set(Object.keys(this.host.bones())), pairs: Record<string, string> = {};
    this.busy = true;
    try {
      for (const b of boundBones(d.mesh)) {
        const guess = pairedBone(b), kept = this.pairs[b], known = kept !== undefined && names.has(kept) ? kept : guess !== null && names.has(guess) ? guess : null;
        if (known !== null) { pairs[b] = known; continue; }
        const answer = await this.askPartner(b, names);
        if (answer === null) { this.host.note(`Mirror cancelled: ${b} has no partner bone.`); return; }
        this.pairs[b] = pairs[b] = answer;
      }
    } finally { this.busy = false; }
    const now = this.def();
    if (!now?.mesh || now.id !== d.id) return;
    const r = mirrorWeights(now.mesh, now.mesh.verts, meshMirrorPartners(now.mesh.verts, size), size[0] / 2, from, pairs);
    const before = now.mesh.weights ?? {}, keys = new Set([...Object.keys(before), ...Object.keys(r.weights)]);
    const changed = [...keys].filter(k => JSON.stringify(before[k]) !== JSON.stringify(r.weights[k])).length;
    if (!changed) { this.host.note(r.lonely.length ? `Nothing to mirror: ${r.lonely.length} vertices have no partner across the middle.` : 'Nothing to mirror: the other half has these weights already.'); return; }
    this.host.set(this.host.deformers().map(x => (x === now ? { ...x, mesh: { ...now.mesh!, weights: r.weights } } : x)));
    this.host.note(`Mirrored the ${from} half of ${part}'s weights onto the ${from === 'left' ? 'right' : 'left'}: ${changed} ${changed === 1 ? 'vertex' : 'vertices'}${r.lonely.length ? `; ${r.lonely.length} had no partner across the middle` : ''}.`);
    this.show();
  }

  /** The mesh's vertex count (0 without a mesh). */
  private count(): number { return (this.def()?.mesh?.verts.length ?? 0) >> 1; }
  /** The selection cleaned against the vertex count. */
  private chosen(): number[] { return cleanSelection(this.selected, this.count()); }
  /** The vertex whose weights the vertex row shows: the picked one, else the one selected vertex. */
  private shown(): number | null { const s = this.chosen(); return s.length === 1 ? s[0] : this.picked; }

  /** The stage (or a button) changes the selection of mesh `id`. */
  choose(id: string, points: readonly number[], mode: 'set' | 'add' | 'toggle') {
    const d = this.def();
    if (!d?.mesh || (id && d.id !== id)) return;
    this.put({ selected: cleanSelection(combineSelection(this.selected, points, mode), this.count()) });
    this.show();
    this.host.changed();
  }

  /** A numeric edit of the selection (and the active bone, where the edit needs one): one undo step. */
  private numeric(kind: NumericOp['kind']) {
    const d = this.def(), part = this.part(), sel = this.chosen(), bone = this.active;
    if (!d?.mesh || !part || !sel.length) return;
    const num = (cls: string) => Number(this.q<HTMLInputElement>(cls).value);
    let op: NumericOp, what: string;
    if (kind === 'smooth') { op = { kind, amount: num('.aww-smooth') }; what = 'Smoothed'; }
    else if (kind === 'prune') { op = { kind, limit: num('.aww-prune') }; what = `Pruned below ${op.limit} on`; }
    else if (kind === 'reset') { op = { kind }; what = 'Reset to the default bone'; }
    else {
      if (!bone) return;
      const value = num('.aww-value');
      if (!Number.isFinite(value)) return;
      op = { kind, bone, value };
      what = kind === 'set' ? `Set ${bone} to ${value} on` : kind === 'add' ? `Added ${Math.abs(value)} of ${bone} on` : `Took ${Math.abs(value)} of ${bone} from`;
    }
    const mesh = applyNumeric(d.mesh, sel, op, this.count(), d.mesh.tris, this.host.boneOf(part));
    this.host.set(this.host.deformers().map(x => (x === d ? { ...x, mesh } : x)));
    this.host.note(`${what} ${sel.length} ${sel.length === 1 ? 'vertex' : 'vertices'}.`);
    this.show();
  }

  /** Typed weight of `bone` on vertex `v` (the vertex row): one undo step. */
  private typed(v: number, bone: string, input: HTMLInputElement) {
    const d = this.def(), part = this.part(), value = Number(input.value);
    if (!d?.mesh || !part || input.value === '' || !Number.isFinite(value)) { this.show(); return; }
    const mesh = applyNumeric(d.mesh, [v], { kind: 'set', bone, value }, this.count(), d.mesh.tris, this.host.boneOf(part));
    this.host.set(this.host.deformers().map(x => (x === d ? { ...x, mesh } : x)));
    this.host.note(`Set ${bone} to ${Math.min(1, Math.max(0, value))} on vertex ${v}.`);
    this.show();
  }

  /** The chosen row, if it is a part. */
  private part(): string | null { const p = this.host.part(); return p !== null && this.host.isPart(p) ? p : null; }
  /** The chosen part's deformer, if it has a free mesh. */
  private def(): DeformerDef | undefined { const p = this.part(); const d = p ? deformerOf(this.host.deformers(), p) : undefined; return d?.mesh ? d : undefined; }
  /** The bones bound to the mesh now. */
  bound(): string[] {
    const d = this.def(), names = new Set(Object.keys(this.host.bones()));
    return [...new Set([...(d?.mesh ? boundBones(d.mesh) : []), ...this.sess.extra])].filter(b => names.has(b));
  }
  /** The brush the stage acts on: the chosen mode once a bone is bound, Read weights before that (the brush modes in the bar are disabled then). */
  brush(): WeightsBrush { return effectiveBrush(this.mode, this.bound().length); }
  /** The test pose's gizmo and the bone it turns (the active one); none unless the Weights tool is on. */
  poseGizmo(): { tool: GizmoTool | null; bone: string | null } { return this.host.toolOn() ? { tool: this.poseTool, bone: this.active } : { tool: null, bone: null }; }

  /** The bone the stage and the brush work on (null: none yet). */
  activeBone(): string | null { return this.active; }
  /** The deformer's id for the stage, when the Weights tool has a mesh to show. */
  target(): string | null { return this.def()?.id ?? null; }

  /** What the stage draws with the Weights tool: the mesh, the active bone's weight at each vertex, its body and the picked vertex; and the brush `mode` (what a press does, so the stage sets its cursor). Null id: nothing. */
  message(): { type: 'studioWeights'; id: string | null; bone: string | null; heat: number[]; children: string[]; tip: [number, number] | null; picked: number | null; brush: number; selected: number[]; mode: WeightsBrush } {
    const d = this.host.toolOn() ? this.def() : undefined, bone = this.active;
    if (!d?.mesh) return { type: 'studioWeights', id: null, bone: null, heat: [], children: [], tip: null, picked: null, brush: 0, selected: [], mode: 'pick' };
    const bones = this.host.bones(), tip = bone ? bones[bone]?.tip : undefined, brush = this.brush();
    return {
      type: 'studioWeights', id: d.id, bone, picked: this.picked, brush: isPaintBrush(brush) ? this.radius : 0,
      selected: this.chosen(), mode: brush,
      heat: bone ? boneHeat(d.mesh, bone, d.mesh.verts.length >> 1) : [],
      children: bone ? Object.keys(bones).filter(b => bones[b].parent === bone) : [],
      tip: Array.isArray(tip) && tip.length === 2 ? [tip[0], tip[1]] : null,
    };
  }

  /** Does the brush mode need an active bone (Smooth blurs all of them)? */
  private needsBone(): boolean { return this.mode === 'add' || this.mode === 'subtract' || this.mode === 'replace'; }

  /** The stage reports a brush stroke: each dab changes the weights under the brush (the stage shows it at once), the release makes the stroke one undo step. */
  brushed(phase: 'start' | 'move' | 'end', id: string, hits: [number, number][]) {
    if (phase === 'end') { this.stroke?.end(); this.stroke = null; this.show(); return; }
    const d = this.def(), part = this.part(), brush = this.brush();
    if (!d?.mesh || !part || d.id !== id || !isPaintBrush(brush) || (this.needsBone() && !this.active)) return;
    if (phase === 'start') this.stroke = this.host.drag();
    if (!this.stroke || !hits.length) return;
    const n = d.mesh.verts.length >> 1, weights = paintWeights(d.mesh, hits, brush as BrushMode, this.active, this.strength, n, d.mesh.tris, this.host.boneOf(part));
    const mesh = startSkinning(d.mesh, this.host.boneOf(part));
    this.stroke.put(this.host.deformers().map(x => (x === d ? { ...x, mesh: { ...mesh, weights } } : x)));
  }

  /** A vertex of mesh `id` was clicked on the stage: read out its weights. A negative vertex (a press on nothing) clears the readout. */
  pick(id: string, vertex: number) {
    const d = this.def();
    if (!d?.mesh || d.id !== id || vertex >= d.mesh.verts.length >> 1) return;
    this.put({ picked: vertex < 0 ? null : vertex });
    this.show();
    this.host.changed();
  }

  /** What Skin's line says (studio-inspector.ts `propBlocks`): the mesh, the bones bound and still free, the weights; undefined for no part. */
  skinState(): SkinState | undefined {
    if (!this.part()) return undefined;
    const d = this.def(), bound = d ? this.bound() : [];
    return { mesh: !!d, bound: bound.length, free: Object.keys(this.host.bones()).filter(b => !bound.includes(b)).length, skinned: isSkinned(d?.mesh) };
  }

  /** Bind ▾: the bone may move the mesh from now on, and becomes the active one (Auto-weights gives it its share). */
  private bind(bone: string) {
    if (!this.def()) return;
    this.put({ extra: [...new Set([...this.sess.extra, bone])], active: bone });
    this.host.note(`${bone} is bound to ${this.part()}. Auto-weights gives the bones their share of the mesh.`);
    this.show();
    this.host.changed();
  }

  /** The ✕ on a bound bone: it leaves the list, and its weight (if any) goes to its parent as unbindBone says, one undo step. */
  private unbind(bone: string) {
    const d = this.def(), part = this.part();
    if (!d?.mesh || !part) return;
    const { mesh, to } = unbindBone(d.mesh, bone, this.host.bones());
    this.put({ extra: this.sess.extra.filter(b => b !== bone), ...(this.active === bone ? { active: null } : {}) }); // before set: it redraws the section's header from bound()
    if (mesh !== d.mesh) this.host.set(this.host.deformers().map(x => (x === d ? { ...x, mesh } : x)));
    this.host.note(mesh === d.mesh ? `${bone} is unbound from ${part}.`
      : !isSkinned(mesh) ? `${bone} is unbound from ${part}, and the skin went with it: the part follows ${this.host.boneOf(part) ?? 'no bone'} again. Ctrl+Z brings it back.`
        : `${bone} is unbound from ${part}: its weight went to ${to ?? 'no bone'}. Ctrl+Z brings it back.`);
    this.show();
    this.host.changed();
  }

  private tree() {
    const bones = this.host.bones(), [w, h] = this.host.canvas();
    return { bones, pivots: resolvePivots(bones, {}, [w / 2, h]) };
  }

  private async auto() {
    const d = this.def(), part = this.part(), origin = part ? this.host.origin(part) : null;
    if (!d?.mesh || !part || !origin || this.busy) return;
    const bound = this.bound();
    if (!bound.length) { this.host.note('Bind the bones that may move this mesh first.'); return; }
    if (d.mesh.weights && Object.keys(d.mesh.weights).length && !(await confirmAsk(`Auto-weights replaces the weights of ${part}'s mesh, painted ones too. Undo brings them back.`, 'Replace'))) return;
    const typed = Number(this.q<HTMLInputElement>('.aw-blend').value);
    const blend = typed > 0 ? typed : defaultBlend(d.mesh.verts);
    const next = applyAutoWeights(d.mesh, origin, this.tree(), bound, blend, this.host.boneOf(part));
    if (next === d.mesh) { this.host.note('None of the bound bones has a pivot to measure from.'); return; }
    this.busy = true;
    this.host.set(this.host.deformers().map(x => (x === d ? { ...x, mesh: next } : x)));
    this.busy = false;
    this.host.useTool();
    this.host.note(`Weighted ${part}'s mesh from ${bound.length} bone${bound.length === 1 ? '' : 's'} (blend ${Math.round(blend)} px).`);
  }

  /** Skin's Remove skin (after asking): the weights go, and the part follows its own bone again. */
  async unskin() {
    const d = this.def(), part = this.part();
    if (!d?.mesh || !part || !isSkinned(d.mesh)) return;
    if (!(await confirmAsk(`Remove the skin of ${part}'s mesh? Its weights go; the part then follows its own bone again.`, 'Remove'))) return;
    this.host.set(this.host.deformers().map(x => (x === d ? { ...x, mesh: stopSkinning(d.mesh!) } : x)));
    this.put({ extra: [], active: null });
  }

  show() {
    const chosen = this.host.part(), part = this.part(), d = this.def(), q = this.q;
    const bones = Object.keys(this.host.bones());
    const none = !chosen ? 'Choose a part in the tree, one with a mesh (Properties › Deform, Mesh row), to weight it to the bones.'
      : !part ? `${chosen} is not a part with art. Weights belong to a part: choose a part with a mesh.`
        : !d ? `${part} has no mesh yet: Generate mesh in Deform, above (its Mesh row), then come back.`
          : !bones.length ? 'This rig has no bones. Weights bind a mesh to bones: add some in the Parts tree.' : '';
    q<HTMLElement>('.aww-none').textContent = none;
    q<HTMLElement>('.aww-none').hidden = !none;
    const on = !none && !!d, bound = on ? this.bound() : [];
    const view = weightsBar({ hasMesh: on, bound: bound.length, brush: this.mode, skinned: isSkinned(d?.mesh), measured: !!d && this.sizes.has(d.id), selected: on ? this.chosen().length : 0, posed: this.host.posed() });
    q<HTMLElement>('.aw-bind').hidden = !on;
    q<HTMLElement>('.aw-read').hidden = !on;
    q<HTMLElement>('.aw-auto').hidden = !on;
    q<HTMLElement>('.aww-brush').hidden = !view.brush; // shown before a bind too, disabled: the brush is the first thing the tool is for
    q<HTMLElement>('.aww-pose').hidden = !view.pose;
    q<HTMLElement>('.aww-sel').hidden = !view.selection;
    if (!view.selection) { this.setValue.close(); this.mirrorPop.close(); }
    if (!on) return;
    if (this.picked !== null && this.picked >= (d!.mesh!.verts.length >> 1)) this.put({ picked: null });
    this.put({ selected: this.chosen() });
    const shown = this.shown();
    q<HTMLElement>('.aww-readout').textContent = shown === null ? 'Click a vertex on the stage to read its weights.' : `vertex ${shown}: ${weightsText(d!.mesh!, shown)}`;
    if (!this.active || !bound.includes(this.active)) this.put({ active: bound[0] ?? null });
    const fields = q<HTMLElement>('.aww-vfields'), fsig = `${shown}|${bound.join(',')}`;
    if (fields.dataset.sig !== fsig) {
      fields.dataset.sig = fsig;
      fields.replaceChildren(...(shown === null ? [] : bound.map(b => {
        const input = document.createElement('input');
        input.type = 'number'; input.className = 'aww-vw'; input.min = '0'; input.max = '1'; input.step = '0.05';
        input.dataset.bone = b;
        input.setAttribute('aria-label', `Weight of ${b} on vertex ${shown}, 0 to 1`);
        input.addEventListener('change', () => this.typed(shown, b, input));
        const label = document.createElement('label');
        label.append(`${b} `, input);
        return label;
      })));
    }
    if (shown !== null) {
      const own = vertexWeights(d!.mesh!, shown);
      for (const input of fields.querySelectorAll<HTMLInputElement>('.aww-vw')) if (document.activeElement !== input) input.value = String(Math.round((own[input.dataset.bone!] ?? 0) * 1e4) / 1e4);
    }
    // The bar: the brush modes, radius, strength and the active bone (one ▾, the one place it is chosen).
    for (const b of this.bar.querySelectorAll<HTMLButtonElement>('.aww-modebtn')) { b.setAttribute('aria-pressed', String(b.dataset.brush === this.mode)); b.disabled = !view.brushOn; }
    for (const c of ['.aww-radius', '.aww-strength']) q<HTMLInputElement>(c).disabled = !view.brushOn;
    for (const l of this.bar.querySelectorAll<HTMLElement>('.aww-paint')) l.hidden = !view.paint;
    if (document.activeElement !== q('.aww-radius')) q<HTMLInputElement>('.aww-radius').value = String(this.radius);
    if (document.activeElement !== q('.aww-strength')) q<HTMLInputElement>('.aww-strength').value = String(this.strength);
    const boneSel = q<HTMLSelectElement>('.aww-bone');
    if (boneSel.dataset.opts !== bound.join('|')) {
      boneSel.dataset.opts = bound.join('|');
      boneSel.replaceChildren(...(bound.length ? bound.map(b => el('option', { value: b, textContent: b })) : [el('option', { value: '', textContent: 'no bone bound' })]));
    }
    boneSel.value = this.active ?? '';
    boneSel.disabled = !bound.length;
    for (const b of this.bar.querySelectorAll<HTMLButtonElement>('.aww-posebtn')) b.setAttribute('aria-pressed', String(b.dataset.pose === this.poseTool));
    q<HTMLButtonElement>('.aww-posereset').disabled = !view.reset;
    // In Select mode: the selection and what acts on it.
    const sel = this.selected.length;
    q<HTMLElement>('.aww-selhint').textContent = sel ? `${sel} selected` : '';
    q<HTMLButtonElement>('.aww-none-btn').disabled = !view.none;
    q<HTMLButtonElement>('.aww-setvalue').disabled = !view.setValue;
    if (!view.setValue) this.setValue.close();
    for (const b of this.bar.querySelectorAll<HTMLButtonElement>('.aww-numbtn')) {
      const op = b.dataset.op;
      b.disabled = !sel || ((op === 'set' || op === 'add' || op === 'subtract') && !this.active);
    }
    q<HTMLElement>('.aww-numhint').textContent = !sel ? 'Select vertices first.' : `Works on the ${sel} selected ${sel === 1 ? 'vertex' : 'vertices'} and the active bone (${this.active ?? 'none'}). Each button is one undo step.`;
    q<HTMLButtonElement>('.aww-mirror').disabled = !view.mirror;
    q<HTMLButtonElement>('.aww-mirror').title = view.mirror ? 'Mirror…: copy the weights of one half of the image onto the other'
      : !isSkinned(d!.mesh!) ? 'Mirror…: weight the mesh first, there is nothing to mirror' : 'Mirror…: waiting for the stage to measure the image';
    if (!view.mirror) this.mirrorPop.close();
    q<HTMLElement>('.aww-mirhint').textContent = 'Copies one half of the image onto the other, pairing vertices by position and bones by name (arm_l with arm_r). One undo step.';
    // The section: the bones bound, each with the ✕ that unbinds it.
    const weighted = boundBones(d!.mesh!), rig = this.host.bones();
    const sig = bound.join(',') + '|' + weighted.join(',');
    const list = q<HTMLElement>('.aw-bound');
    if (list.dataset.sig !== sig) {
      list.dataset.sig = sig;
      list.replaceChildren(...bound.map(b => {
        const to = unbindBone(d!.mesh!, b, rig).to;
        const off = el('button', { type: 'button', className: 'aw-unbind', textContent: '✕', title: !weighted.includes(b) ? `Unbind ${b}: it has no weight yet, so it just leaves the list`
          : weighted.length === 1 ? `Unbind ${b}, the last bone: the skin goes with it and ${part} follows its own bone again (Ctrl+Z brings it back)`
            : `Unbind ${b}: its weight goes to ${to ?? 'no bone'} (Ctrl+Z brings it back)` });
        off.setAttribute('aria-label', `Unbind ${b} from the mesh`);
        off.addEventListener('click', () => this.unbind(b));
        const chip = el('span', { className: 'aw-bonechip' }, el('span', { className: 'aw-boundbone', textContent: b }), off);
        chip.dataset.bone = b;
        return chip;
      }));
      if (!bound.length) list.textContent = 'none yet';
    }
    // Bind ▾ in Skin's line: choosing a bone binds it (the line gives it its enabled state and tooltip).
    const pick = q<HTMLSelectElement>('.aw-bindpick'), free = bones.filter(b => !bound.includes(b));
    if (pick.dataset.opts !== free.join('|')) { pick.dataset.opts = free.join('|'); pick.replaceChildren(el('option', { value: '', textContent: 'Bind…' }), ...free.map(b => el('option', { value: b, textContent: b }))); }
    pick.value = '';
    const sits = this.host.boneOf(part!);
    q<HTMLElement>('.aw-bindhint').textContent = !isSkinned(d!.mesh!) ? `Bind the bones that may move ${part}. Until it is weighted it moves with ${sits ?? 'no bone'} as before.`
      : sits !== undefined && bound.includes(sits) ? `${part} bends with these bones; ${sits}, the bone it sits on, moves it only through its weights now.`
        : `${part} bends with these bones; the bone it sits on (${sits ?? 'none'}) no longer moves it.`;
    q<HTMLButtonElement>('.aw-autobtn').disabled = !bound.length;
    q<HTMLElement>('.aw-autohint').textContent = bound.length ? 'Weights each vertex by how near it is to each bound bone. A start for painting: a hand or a face should sit wholly on one bone.' : '';
  }
}
