// The studio stage's viewport and bone gizmos (the page side of build step 3 in docs/design/animation-studio-parameters.md).
// The viewport zooms and pans the #stage element; the gizmo is an SVG overlay in screen pixels above it, so handles keep
// their size at any zoom. The maths is in engine/src/gizmo.ts and gizmo-rig.ts; this wires pointers to it and reports to
// the editor, which owns the working copy (a drag is only a delta here until the editor writes it: a key in Animate mode, a
// parameter's keyform in Model mode; the pivot is placed with the Pivot tool, not the gizmo).
// The Warp tool draws the lattice of the chosen part's mesh warp as an overlay too (constant-size handles at every control
// point) and reports a point dragged as the distance it moved in the part's own space; the editor writes it into a keyform.
// A mask shape (a shape part of rig.json) is drawn as an outline over the stage (dashed, in the colour of the stencil it makes); with the Mask tool
// every shape is outlined (a click near an outline picks it) and the chosen shape's polygon points are handles: drag one, click an edge to add a point,
// Alt-click a point to remove it. The editor owns the shape.
// Messages in (see studio.ts): studioGizmo { tool, name, space, stage (the tool row's tool, which names the stage mode) }, studioExtra { extra }, studioView { fit }, studioWarp { id, points, radius, curve },
// studioMask { shape, part, tool, point }, studioWeights { id, bone, heat, children, tip, picked, brush, selected, mode }.
// A press is one dispatch on the stage mode (docs/design/studio-stage-modes.md): the transform tools and Pivot pick parts and bone dots, the deform tools (Warp, Weights, Mask)
// work on their own handles, choose a part on its art and keep their subject through a miss; a tool key during a stroke or drag waits for the release.
// Messages out: studioSelect { name, hits (every part under the pointer, front to back; one name for a bone or mask shape), at (the click in screen px), shift, ctrl, alt }, studioGizmoDrag { phase, name, tool, delta }, studioKey { key, ctrl, shift } (escape: an Esc the stage did not use, which leaves a deform tool or closes the studio; ' ': Space pressed with no pan, play or pause),
// studioWarpDrag { phase, id, point, delta }, studioWarpSelect { id, points, mode } (a click with Shift, a rectangle, Ctrl+A, Esc), studioWarpBox { id, w, h, pw?, ph? } (pw, ph: a free mesh's image size in pixels), studioMeshTopo { id, op, vertex | a, b | at } (topology mode: op add / delete / flip / removeEdge / addEdge / cancel; a Move is a studioWarpDrag), studioMaskDrag { phase, shape, point, delta },
// studioMaskAdd { shape, index, at }, studioMaskRemove { shape, point }, studioMaskBox { part, x, y, w, h }, studioWeightsPick { id, vertex } (-1: a press on nothing clears the readout), studioWeightsSelect { id, points, mode } (the Weights tool's Select mode: a click, Shift-click, a rectangle, Ctrl+A, Esc; mode set / add / toggle), studioWeightsBrush { phase, id, hits } (a brush stroke: phase start / move / end, hits the vertices under the brush as [vertex, falloff]).
// The Weights tool draws the free mesh of the chosen part with each vertex coloured by how much of it the active bone moves (blue: none, red: all), the
// bone's body (its pivot to its children's pivots and its tip) over it, and a click on a vertex reports it; the editor shows its weights.

import {
  dragBone, fitBounds, gizmoFrame, gizmoHandles, GIZMO_RING, handleSize, IDENTITY_STAGE_VIEW, latticeEdges, nearestEdge, NO_OFFSET, shapeAtEdge, shapeAtInside, offsetDelta, panBy, pickHandle, pickPoint, screenToWorld, sumOffset, wheelFactor, worldToScreen, zoomViewAt,
  softWeights, meshSoftWeights, isPaintBrush, brushCursor, escapeAction, choiceCue,
  type GizmoHandle, type GizmoPoint, type GizmoSpace, type GizmoTool, type Offset, type StageView, type WarpFalloff, type StageMode, type WeightsBrush,
} from '../engine/src/index.js';
import type { PixiRenderer } from './pixi-renderer.js';
import { H, stage, W } from './stage-ui.js';

/**
 * The gizmo: the transform tool drawn (null: none) on `name`, in local or world axes; and the stage `mode` the editor's tool row is in
 * (null: no tool, nothing on the stage takes a click), which decides what a press does (docs/design/studio-stage-modes.md).
 */
export interface GizmoConfig { tool: GizmoTool | null; name: string | null; space: GizmoSpace; mode: StageMode | null }
/**
 * The Warp tool: the deformer (by id) whose lattice is shown, the points the editor has selected and how far a soft selection reaches. With a
 * free mesh in topology mode `topo` is the tool (add, delete, move, flip, addEdge, removeEdge) and `anchor` the vertex an Add edge started from.
 */
export interface WarpConfig { id: string; points: number[]; falloff: WarpFalloff; topo?: string | null; anchor?: number | null }
/**
 * The mask outlines shown: the shape the editor works on (null: none), the part row chosen (its image box is reported, for a new shape to start from),
 * whether the Mask tool is on (every shape is outlined and picks on a click; the chosen shape's polygon points are live handles) and the point the editor has selected.
 */
/**
 * The Weights tool: the deformer (by id) whose mesh is shown, the active bone's weight at each vertex (`heat`, 0-1), the bone's `children` (its body runs to them)
 * and its `tip` (canvas pixels, at rest), the vertex the editor shows the weights of, the brush `mode` (what a press does: read a vertex out, select, or paint) and
 * the brush radius in screen pixels (0 outside the paint modes).
 */
export interface WeightsConfig { id: string; bone: string | null; heat: number[]; children: string[]; tip: [number, number] | null; picked: number | null; brush: number; selected: number[]; mode: WeightsBrush }
export interface MaskConfig { shape: string | null; part: string | null; tool: boolean; point: number | null }

const NS = 'http://www.w3.org/2000/svg';
const COLORS = { x: '#ff5d5d', y: '#59d96a', free: '#ffffff', ring: '#4aa3ff', bone: '#ffd23b', sel: '#ff3b6b', lattice: '#3be0c8', mask: '#ff9f1c' };

const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element): SVGElementTagNameMap[K] => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.append(e);
  return e;
};

export class StageTools {
  view: StageView = { ...IDENTITY_STAGE_VIEW };
  private fitted = true;                 // the view still follows the window; a zoom or pan of the user's ends that
  /** The studio stacks its columns and scrolls them (a narrow window): a plain wheel scrolls that column, Ctrl+wheel (or a pinch) zooms. */
  private scrollsPage = false;
  private cfg: GizmoConfig = { tool: null, name: null, space: 'local', mode: null };
  private busy = false;                        // a drag, stroke or rectangle is under way: tool keys wait for the release
  private pointer: GizmoPoint | null = null;   // where the pointer is while it is over the page (the brush ring starts there)
  private base = new Map<string, Offset>();   // pending offsets from the editor (a drag not keyed yet)
  private drag: { name: string; delta: Offset } | null = null;
  private overlay: SVGSVGElement;
  private label: HTMLElement;
  private tag: HTMLElement;                    // by the gizmo: whether the part or its bone is chosen (studio-choice-cue.md)
  private chosen: string | null = null;       // the chosen row (a part or a bone), as the studio's focus says
  private frame: { origin: GizmoPoint; x: GizmoPoint; y: GizmoPoint } | null = null;
  private bones: { name: string; at: GizmoPoint }[] = [];
  private hover: GizmoHandle | null = null;
  private warp: WarpConfig | null = null;
  private skin: WeightsConfig | null = null;
  private reportedSkinBox = '';
  private brushAt: GizmoPoint | null = null;   // where the pointer is, for the brush ring
  private skinVerts: GizmoPoint[] = [];        // the weighted mesh's vertices on screen, as drawn last
  private lattice: GizmoPoint[] = [];       // the lattice points on screen, as drawn last
  private hoverPoint = -1;
  private meshEdgeList: [number, number][] = [];   // the free mesh's edges as vertex pairs, as drawn last
  private hoverEdge: [number, number] | null = null;
  private ghost: GizmoPoint | null = null;      // topology Add: where the new vertex would go, in screen pixels
  private marquee: { x0: number; y0: number; x1: number; y1: number } | null = null;   // a selection rectangle being dragged, in screen pixels
  private reportedBox = '';
  private mask: MaskConfig | null = null;
  private maskPoints: GizmoPoint[] = [];      // a polygon mask's points on screen, as drawn last (only with the Mask tool)
  private maskLine: GizmoPoint[] = [];        // and its outline, for adding a point on an edge
  private shapeLines: { name: string; outlines: GizmoPoint[][] }[] = []; // every shape's outlines on screen (only with the Mask tool), for picking one
  private reportedMask = '';
  private spaceDown = false;
  private spacePanned = false;                 // a pan started while Space was held: its release is not a press for the studio
  private vw = window.innerWidth;
  private vh = window.innerHeight;

  constructor(private deps: {
    renderer: PixiRenderer;
    char: string;
    send: (msg: object) => void;
    /** Pose again (the extra offsets changed). */
    repose: () => void;
    /** Pivots / placing own the pointer, or an animation plays: no gizmo. */
    suspended: () => boolean;
  }) {
    stage.style.left = '0';
    stage.style.top = '0';
    stage.style.transformOrigin = '0 0';
    this.overlay = svg('svg', { style: 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:40' }) as SVGSVGElement;
    this.label = document.createElement('div');
    this.label.style.cssText = 'position:fixed;left:8px;bottom:6px;z-index:41;font:12px system-ui,sans-serif;color:#cfd6e4;background:rgba(0,0,0,.55);padding:2px 6px;border-radius:3px;pointer-events:none';
    this.tag = document.createElement('div');
    this.tag.className = 'studio-choice-tag';
    this.tag.style.cssText = `position:fixed;z-index:41;font:12px system-ui,sans-serif;color:#fff;background:rgba(0,0,0,.7);border:1px solid ${COLORS.sel};padding:2px 6px;border-radius:3px;pointer-events:none;white-space:nowrap`;
    this.tag.hidden = true;
    document.body.append(this.overlay, this.label, this.tag);
    window.addEventListener('pointerdown', e => this.onDown(e), true);
    window.addEventListener('pointermove', e => this.onHover(e));
    // The brush ring shows from the moment the pointer enters the page, and goes when it leaves.
    document.documentElement.addEventListener('pointerenter', e => { this.pointer = [e.clientX, e.clientY]; this.onHover(e); });
    document.documentElement.addEventListener('pointerleave', () => { this.pointer = null; if (this.brushAt) { this.brushAt = null; document.body.style.cursor = ''; this.draw(); } });
    window.addEventListener('wheel', e => this.onWheel(e), { passive: false });
    window.addEventListener('keydown', e => this.onKey(e));
    // Space held is a pan with the pointer; Space pressed and let go with no pan is the studio's (play or pause).
    window.addEventListener('keyup', e => {
      if (e.key !== ' ') return;
      if (this.spaceDown && !this.spacePanned) this.deps.send({ type: 'studioKey', key: ' ', ctrl: false, shift: false });
      this.spaceDown = false;
    });
    this.layout(window.innerWidth, window.innerHeight);
  }

  /** The window changed size: keep the whole stage in view unless the user has moved the view. */
  layout(vw: number, vh: number) {
    if (this.fitted) this.view = fitBounds({ x: 0, y: 0, w: W, h: H }, vw, vh, 0);
    else this.view = panBy(this.view, (vw - this.vw) / 2, (vh - this.vh) / 2); // what was in the middle stays there
    this.vw = vw; this.vh = vh;
    this.applyView();
  }

  /** F: the character fills the window (the whole stage when there is none to measure). */
  fit(whole = false) {
    const b = whole ? null : this.deps.renderer.studioBounds(this.deps.char);
    this.fitted = !b;
    this.view = fitBounds(b ?? { x: 0, y: 0, w: W, h: H }, this.vw, this.vh, b ? 40 : 0);
    this.applyView();
  }

  configure(c: GizmoConfig) {
    const was = this.cfg.mode;
    this.cfg = c;
    // The Weights tool's cursor follows the brush mode as soon as the mode is on (the weights message may have come first); leaving it clears the cursor.
    if (!this.busy && c.mode !== was && (c.mode === 'weights' || was === 'weights')) document.body.style.cursor = c.mode === 'weights' && this.skin ? (this.brushAt ? 'none' : brushCursor(this.skin.mode)) : '';
    this.draw();
  }

  /** Show the lattice of the deformer `w.id` (null: no Warp tool). */
  setWarp(w: WarpConfig | null) {
    this.warp = w;
    this.hoverPoint = -1;
    this.hoverEdge = null;
    this.ghost = null;
    this.reportedBox = '';
    this.draw();
  }

  /** Show the weights of the mesh `w.id` (null: no Weights tool). */
  setWeights(w: WeightsConfig | null) {
    this.skin = w;
    // The brush mode the stage acts on, for tests: a press right after a mode change must wait until the stage has it.
    document.documentElement.dataset.weightsMode = w?.mode ?? '';
    // A paint brush shows its ring where the pointer is already; the other modes have a cursor instead.
    this.brushAt = w && isPaintBrush(w.mode) && w.brush > 0 ? this.pointer : null;
    if (!this.busy) document.body.style.cursor = w && this.cfg.mode === 'weights' ? (this.brushAt ? 'none' : brushCursor(w.mode)) : '';
    this.draw();
  }

  /** Show the outline of `m.part`'s mask (null: none). */
  setMask(m: MaskConfig | null) {
    this.mask = m;
    this.hoverPoint = -1;
    this.reportedMask = '';
    this.draw();
  }

  setExtra(extra: Record<string, Offset>) {
    this.base = new Map(Object.entries(extra));
    this.drag = null;
    this.deps.repose();
    this.draw();
  }

  /** The offsets laid over the pose: the editor's pending ones and the drag under way. */
  extraMap(): Map<string, Offset> {
    if (!this.drag) return this.base;
    const m = new Map(this.base);
    m.set(this.drag.name, sumOffset(m.get(this.drag.name) ?? NO_OFFSET, this.drag.delta));
    return m;
  }

  private applyView() {
    const v = this.view;
    stage.style.transform = `translate(${v.panX}px, ${v.panY}px) scale(${v.zoom})`;
    document.documentElement.dataset.fitted = '';
    this.label.textContent = `${Math.round(v.zoom * 100)}%  (${this.scrollsPage ? 'Ctrl+wheel' : 'wheel'} zooms, middle-drag or Space+drag pans, F fits)`;
    // The pivot crosses and the skeleton lines are in the stage and scale with it: undo that so they keep their size.
    const k = handleSize(v, 1);
    stage.style.setProperty('--cross-scale', String(k));
    this.draw();
  }

  /** Stage pixels under a pointer. */
  private toStage(e: { clientX: number; clientY: number }): GizmoPoint { return screenToWorld(this.view, [e.clientX, e.clientY]); }

  // ---- drawing ----
  draw() {
    this.overlay.replaceChildren();
    this.frame = null;
    this.bones = [];
    this.lattice = [];
    this.maskPoints = [];
    this.maskLine = [];
    this.shapeLines = [];
    this.skinVerts = [];
    const { renderer, char } = this.deps, c = this.cfg;
    const space = renderer.studioSpace(char);
    if (this.mask && space) this.drawMask(this.mask); // an outline is only a drawing: it shows while a pivot is being picked too
    if (this.warp && space && !this.deps.suspended()) this.drawLattice(this.warp);
    if (this.skin && space && !this.deps.suspended()) this.drawWeights(this.skin);
    this.tag.hidden = true;
    if (!c.tool || !space || this.deps.suspended()) return;
    const screen = (p: GizmoPoint): GizmoPoint => worldToScreen(this.view, space.toStage(p));
    // What is chosen, told apart from its bone (studio-choice-cue.md): the part's outline, or the bone's body and its parts' faint outlines.
    // Only with Move, Rotate and Scale: the deform tools draw their own subject, and the Weights tool's gizmo is its test pose's.
    const chosen = c.mode === 'transform' ? this.chosen : null;
    const info = chosen ? renderer.studioBoneInfo(char, chosen) : null;
    const cue = choiceCue({ chosen, target: c.name, bone: !!info, carries: info?.parts.length ?? 0 });
    const outline = (part: string, strong: boolean) => {
      for (const [a, b] of renderer.studioPartOutline(char, part) ?? []) {
        const p = worldToScreen(this.view, a), q = worldToScreen(this.view, b);
        if (strong) svg('line', { x1: p[0], y1: p[1], x2: q[0], y2: q[1], stroke: '#000', 'stroke-width': 3.5, 'stroke-opacity': 0.5 }, this.overlay);
        svg('line', { x1: p[0], y1: p[1], x2: q[0], y2: q[1], stroke: strong ? COLORS.sel : '#fff', 'stroke-width': strong ? 1.75 : 1, 'stroke-opacity': strong ? 1 : 0.45, 'stroke-dasharray': strong ? '6 4' : '3 3', 'data-outline': part }, this.overlay);
      }
    };
    if (cue.outline === 'part') outline(chosen!, true);
    else if (info) for (const p of info.parts) outline(p, false);
    for (const b of renderer.studioSkeleton(char)) {
      const at = screen(b.at);
      this.bones.push({ name: b.name, at });
      if (b.from) { const f = screen(b.from); svg('line', { x1: f[0], y1: f[1], x2: at[0], y2: at[1], stroke: COLORS.bone, 'stroke-width': 2, 'stroke-opacity': 0.8 }, this.overlay); }
    }
    const joint = info ? this.bones.find(b => b.name === chosen)?.at : undefined;
    if (info && joint) {
      const ends: GizmoPoint[] = info.children.flatMap(n => { const at = this.bones.find(b => b.name === n)?.at; return at ? [at] : []; });
      if (info.tip) ends.push(worldToScreen(this.view, info.tip));
      for (const [stroke, width] of [['#000', 8], [COLORS.sel, 4.5]] as const)
        for (const e of ends) svg('line', { x1: joint[0], y1: joint[1], x2: e[0], y2: e[1], stroke, 'stroke-width': width, 'stroke-linecap': 'round', 'data-bone-body': chosen! }, this.overlay);
    }
    // A chosen bone's dot is a ring around the gizmo's centre square, so the square does not hide it; a part's bone keeps a plain dot.
    for (const b of this.bones) {
      if (info && b.name === chosen) {
        svg('circle', { cx: b.at[0], cy: b.at[1], r: 11, fill: 'none', stroke: 'rgba(0,0,0,.5)', 'stroke-width': 5 }, this.overlay);
        svg('circle', { cx: b.at[0], cy: b.at[1], r: 11, fill: 'none', stroke: COLORS.sel, 'stroke-width': 2.5, 'data-bone': b.name, 'data-chosen': 'true' }, this.overlay);
      } else svg('circle', { cx: b.at[0], cy: b.at[1], r: 5, fill: 'none', stroke: COLORS.bone, 'stroke-width': 2, 'data-bone': b.name }, this.overlay);
    }
    const t = c.name ? renderer.studioTarget(char, c.name) : null;
    if (!t) return;
    const f = gizmoFrame(t.parent, t.offset, t.pivot, t.unit, c.space);
    const o = screen(f.origin);
    const dir = (v: GizmoPoint): GizmoPoint => { const p = screen([f.origin[0] + v[0], f.origin[1] + v[1]]); const l = Math.hypot(p[0] - o[0], p[1] - o[1]) || 1; return [(p[0] - o[0]) / l, (p[1] - o[1]) / l]; };
    this.frame = { origin: o, x: dir(f.x), y: dir(f.y) };
    for (const h of gizmoHandles(c.tool, this.frame)) this.drawHandle(h, h.axis === this.hover?.axis);
    if (cue.tag) this.placeTag(cue.tag, o, this.frame.x, this.frame.y);
  }

  /** The choice tag by the gizmo: on the side away from both axis handles, past the rotate ring, kept inside the window. */
  private placeTag(text: string, o: GizmoPoint, x: GizmoPoint, y: GizmoPoint) {
    this.tag.textContent = text;
    this.tag.hidden = false;
    const d0: GizmoPoint = [-(x[0] + y[0]), -(x[1] + y[1])], l = Math.hypot(d0[0], d0[1]) || 1, d: GizmoPoint = [d0[0] / l, d0[1] / l];
    const at: GizmoPoint = [o[0] + d[0] * (GIZMO_RING + 12), o[1] + d[1] * (GIZMO_RING + 12)], w = this.tag.offsetWidth, h = this.tag.offsetHeight;
    const left = d[0] < 0 ? at[0] - w : at[0], top = d[1] < 0 ? at[1] - h : at[1];
    this.tag.style.left = `${Math.round(Math.min(Math.max(4, left), this.vw - w - 4))}px`;
    this.tag.style.top = `${Math.round(Math.min(Math.max(4, top), this.vh - h - 28))}px`; // above the zoom label
  }

  /** The warp lattice of the chosen deformer over the stage: thin lines and a round handle at each control point, all in screen pixels. */
  private drawLattice(w: WarpConfig) {
    const l = this.deps.renderer.studioDeformerLattice(this.deps.char, w.id);
    if (!l) { this.drawMesh(w); return; }
    this.lattice = l.points.map(p => worldToScreen(this.view, p));
    const box = `${w.id}|${l.box.w}|${l.box.h}`;
    if (box !== this.reportedBox) { this.reportedBox = box; this.deps.send({ type: 'studioWarpBox', id: w.id, w: l.box.w, h: l.box.h }); }
    const edges = latticeEdges([l.cols, l.rows]);
    for (const [stroke, width, opacity] of [['#000', 3.5, 0.45], [COLORS.lattice, 1.5, 0.95]] as const)
      for (const [a, b] of edges) svg('line', { x1: this.lattice[a][0], y1: this.lattice[a][1], x2: this.lattice[b][0], y2: this.lattice[b][1], stroke, 'stroke-width': width, 'stroke-opacity': opacity }, this.overlay);
    // A soft selection tints the points it will drag along, stronger the nearer they are.
    const weights = softWeights({ grid: [l.cols, l.rows] }, w.points, w.falloff);
    this.lattice.forEach((p, i) => {
      const sel = w.points.includes(i), hot = i === this.hoverPoint, soft = sel ? 0 : weights.get(i) ?? 0;
      svg('circle', { cx: p[0], cy: p[1], r: sel ? 6.5 : 5, fill: sel ? COLORS.sel : hot ? '#fff' : COLORS.lattice, stroke: soft ? COLORS.sel : '#000', 'stroke-width': soft ? 1.5 + 2 * soft : 1.5 }, this.overlay);
    });
    const m = this.marquee;
    if (m) svg('rect', { x: Math.min(m.x0, m.x1), y: Math.min(m.y0, m.y1), width: Math.abs(m.x1 - m.x0), height: Math.abs(m.y1 - m.y0), fill: 'rgba(255,59,107,.12)', stroke: COLORS.sel, 'stroke-width': 1, 'stroke-dasharray': '4 3' }, this.overlay);
  }

  /**
   * The free mesh of the chosen deformer: triangle edges and a dot at each vertex, all in screen pixels. The vertices are the handles, as
   * the lattice's points are (`this.lattice`): pick, Shift-click, rectangle, drag and the soft tint work the same, with the fade over edge hops.
   */
  private drawMesh(w: WarpConfig) {
    const m = this.deps.renderer.studioDeformerMesh(this.deps.char, w.id);
    if (!m) return;
    this.lattice = m.verts.map(p => worldToScreen(this.view, p));
    const at = this.lattice, box = `${w.id}|${m.box.w}|${m.box.h}|${m.size.w}|${m.size.h}`;
    if (box !== this.reportedBox) { this.reportedBox = box; this.deps.send({ type: 'studioWarpBox', id: w.id, w: m.box.w, h: m.box.h, pw: m.size.w, ph: m.size.h }); }
    for (const [stroke, width, opacity] of [['#000', 3, 0.4], [COLORS.lattice, 1, 0.85]] as const)
      for (const [a, b] of m.edges) svg('line', { x1: at[a][0], y1: at[a][1], x2: at[b][0], y2: at[b][1], stroke, 'stroke-width': width, 'stroke-opacity': opacity }, this.overlay);
    this.meshEdgeList = m.edges;
    const topo = w.topo ?? null, weights = meshSoftWeights(at.length, m.tris, topo ? [] : w.points, w.falloff);
    if (topo && this.hoverEdge) { const [a, b] = this.hoverEdge; svg('line', { x1: at[a][0], y1: at[a][1], x2: at[b][0], y2: at[b][1], stroke: '#fff', 'stroke-width': 3.5, 'stroke-linecap': 'round' }, this.overlay); }
    if (topo && w.anchor != null && at[w.anchor]) svg('circle', { cx: at[w.anchor][0], cy: at[w.anchor][1], r: 9, fill: 'none', stroke: COLORS.sel, 'stroke-width': 2.5 }, this.overlay);
    at.forEach((p, i) => {
      const sel = !topo && w.points.includes(i), hot = i === this.hoverPoint, soft = sel ? 0 : weights.get(i) ?? 0;
      svg('circle', { cx: p[0], cy: p[1], r: sel ? 5.5 : hot ? 4.5 : 3, fill: sel ? COLORS.sel : hot ? '#fff' : COLORS.lattice, stroke: soft ? COLORS.sel : '#000', 'stroke-width': soft ? 1 + 2 * soft : 1 }, this.overlay);
    });
    if (topo === 'add' && this.ghost) svg('circle', { cx: this.ghost[0], cy: this.ghost[1], r: 5, fill: 'rgba(255,255,255,.35)', stroke: '#fff', 'stroke-width': 1.5, 'stroke-dasharray': '3 2' }, this.overlay);
    const mq = this.marquee;
    if (mq) svg('rect', { x: Math.min(mq.x0, mq.x1), y: Math.min(mq.y0, mq.y1), width: Math.abs(mq.x1 - mq.x0), height: Math.abs(mq.y1 - mq.y0), fill: 'rgba(255,59,107,.12)', stroke: COLORS.sel, 'stroke-width': 1, 'stroke-dasharray': '4 3' }, this.overlay);
  }

  /**
   * The mesh of the Weights tool: its edges, a dot at each vertex coloured by the active bone's weight there, and the bone's body: a line from its
   * pivot to each child's pivot and to its tip (a ring at the pivot when it has neither).
   */
  private drawWeights(w: WeightsConfig) {
    const { renderer, char } = this.deps, m = renderer.studioDeformerMesh(char, w.id), space = renderer.studioSpace(char);
    if (!m || !space) return;
    // The mesh's image size in pixels is what Mirror needs (as the Warp tool's box message gives Deform its).
    const sig = `${w.id}|${m.box.w}|${m.box.h}|${m.size.w}|${m.size.h}`;
    if (sig !== this.reportedSkinBox) { this.reportedSkinBox = sig; this.deps.send({ type: 'studioWarpBox', id: w.id, w: m.box.w, h: m.box.h, pw: m.size.w, ph: m.size.h }); }
    const at = this.skinVerts = m.verts.map(p => worldToScreen(this.view, p));
    for (const [stroke, width, opacity] of [['#000', 3, 0.35], ['#fff', 1, 0.55]] as const)
      for (const [a, b] of m.edges) svg('line', { x1: at[a][0], y1: at[a][1], x2: at[b][0], y2: at[b][1], stroke, 'stroke-width': width, 'stroke-opacity': opacity }, this.overlay);
    at.forEach((p, i) => {
      const k = Math.min(1, Math.max(0, w.heat[i] ?? 0)), picked = i === w.picked;
      svg('circle', { cx: p[0], cy: p[1], r: picked ? 7 : 4.5, fill: `hsl(${Math.round(240 * (1 - k))} 90% 55%)`, 'fill-opacity': 0.3 + 0.7 * k, stroke: picked ? '#fff' : '#000', 'stroke-width': picked ? 2.5 : 1 }, this.overlay);
    });
    for (const i of w.selected) {
      const p = at[i];
      if (p) svg('circle', { cx: p[0], cy: p[1], r: 8, fill: 'none', stroke: COLORS.sel, 'stroke-width': 2.5 }, this.overlay);
    }
    const mq = this.marquee;
    if (mq) svg('rect', { x: Math.min(mq.x0, mq.x1), y: Math.min(mq.y0, mq.y1), width: Math.abs(mq.x1 - mq.x0), height: Math.abs(mq.y1 - mq.y0), fill: 'rgba(255,59,107,.12)', stroke: COLORS.sel, 'stroke-width': 1, 'stroke-dasharray': '4 3' }, this.overlay);
    if (w.brush > 0 && this.brushAt) {
      svg('circle', { cx: this.brushAt[0], cy: this.brushAt[1], r: w.brush, fill: 'rgba(255,255,255,.06)', stroke: '#000', 'stroke-width': 3, 'stroke-opacity': 0.5 }, this.overlay);
      svg('circle', { cx: this.brushAt[0], cy: this.brushAt[1], r: w.brush, fill: 'none', stroke: '#fff', 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }, this.overlay);
    }
    if (!w.bone) return;
    const pos = new Map(renderer.studioSkeleton(char).map(b => [b.name, b.at])), from = pos.get(w.bone);
    if (!from) return;
    const screen = (p: GizmoPoint): GizmoPoint => worldToScreen(this.view, space.toStage(p)), a = screen(from);
    const ends: GizmoPoint[] = [];
    for (const c of w.children) { const p = pos.get(c); if (p) ends.push(screen(p)); }
    const tip = w.tip ? renderer.studioBonePoint(char, w.bone, w.tip) : null, tipAt = tip ? worldToScreen(this.view, tip) : null;
    if (tipAt) ends.push(tipAt);
    for (const [stroke, width] of [['#000', 6], [COLORS.bone, 3.5]] as const)
      for (const e of ends) svg('line', { x1: a[0], y1: a[1], x2: e[0], y2: e[1], stroke, 'stroke-width': width, 'stroke-linecap': 'round' }, this.overlay);
    svg('circle', { cx: a[0], cy: a[1], r: 7, fill: ends.length ? COLORS.bone : 'none', stroke: '#000', 'stroke-width': 2 }, this.overlay);
    if (tipAt) svg('circle', { cx: tipAt[0], cy: tipAt[1], r: 4, fill: '#000', stroke: COLORS.bone, 'stroke-width': 2 }, this.overlay);
  }

  /** The outline of the chosen mask shape, with the Mask tool every other shape's too, and on the chosen polygon a handle at each point. */
  private drawMask(m: MaskConfig) {
    const { renderer, char } = this.deps;
    const box = m.part ? renderer.studioPartBox(char, m.part) : null, key = `${m.part}|${box ? [box.x, box.y, box.w, box.h].join(',') : ''}`;
    if (m.part && box && key !== this.reportedMask) { this.reportedMask = key; this.deps.send({ type: 'studioMaskBox', part: m.part, ...box }); }
    const outline = (lines: GizmoPoint[][], stroke: string, width: number, opacity: number, dash: string) => {
      for (const l of lines) svg('polygon', { points: l.map(p => p.join(',')).join(' '), fill: 'none', stroke, 'stroke-width': width, 'stroke-opacity': opacity, 'stroke-linejoin': 'round', ...(dash ? { 'stroke-dasharray': dash } : {}) }, this.overlay);
    };
    if (m.tool) {
      // Every shape of the character, the chosen one stronger below: a click near an outline picks it.
      this.shapeLines = renderer.studioShapes(char).map(s => ({ name: s.name, outlines: s.outlines.map(o => o.map(p => worldToScreen(this.view, p))) }));
      for (const s of this.shapeLines) if (s.name !== m.shape) { outline(s.outlines, '#000', 3, 0.35, ''); outline(s.outlines, COLORS.mask, 1.5, 0.7, '3 4'); }
    }
    const info = m.shape ? renderer.studioMask(char, m.shape) : null;
    if (!info) return;
    const lines = info.outlines.map(o => o.map(p => worldToScreen(this.view, p)));
    outline(lines, '#000', 3.5, 0.45, '');
    outline(lines, COLORS.mask, 2, 1, '7 5');
    if (!m.tool || !info.polygon || !lines.length) return;
    this.maskLine = lines[0];
    this.maskPoints = lines[0];
    lines[0].forEach((p, i) => {
      const sel = i === m.point, hot = i === this.hoverPoint;
      svg('circle', { cx: p[0], cy: p[1], r: sel ? 6.5 : 5, fill: sel ? COLORS.sel : hot ? '#fff' : COLORS.mask, stroke: '#000', 'stroke-width': 1.5 }, this.overlay);
    });
  }

  private drawHandle(h: GizmoHandle, hot: boolean) {
    const color = h.kind === 'ring' ? COLORS.ring : COLORS[h.axis], w = hot ? 4 : 2.5;
    if (h.kind === 'ring') { svg('circle', { cx: h.at[0], cy: h.at[1], r: h.radius, fill: 'none', stroke: hot ? '#fff' : color, 'stroke-width': w }, this.overlay); return; }
    if (h.to && h.axis !== 'free') svg('line', { x1: h.to[0], y1: h.to[1], x2: h.at[0], y2: h.at[1], stroke: color, 'stroke-width': w }, this.overlay);
    if (h.kind === 'arrow' && h.to) {
      const dx = h.at[0] - h.to[0], dy = h.at[1] - h.to[1], l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l;
      svg('polygon', { points: `${h.at[0] + ux * 10},${h.at[1] + uy * 10} ${h.at[0] - ux * 4 - uy * 6},${h.at[1] - uy * 4 + ux * 6} ${h.at[0] - ux * 4 + uy * 6},${h.at[1] - uy * 4 - ux * 6}`, fill: color }, this.overlay);
    } else {
      const s = h.axis === 'free' ? 6 : 5;
      svg('rect', { x: h.at[0] - s, y: h.at[1] - s, width: s * 2, height: s * 2, fill: hot ? '#fff' : color, stroke: '#000', 'stroke-width': 1 }, this.overlay);
    }
  }

  // ---- pointers ----
  private onKey(e: KeyboardEvent) {
    if (e.key === ' ') { if (!e.repeat) { this.spaceDown = true; this.spacePanned = false; } e.preventDefault(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) {
      if (e.key.toLowerCase() === 'a' && this.skin?.mode === 'select' && this.skinVerts.length) { e.preventDefault(); this.deps.send({ type: 'studioWeightsSelect', id: this.skin.id, points: this.skinVerts.map((_, i) => i), mode: 'set' }); return; }
      if (e.key.toLowerCase() === 'a' && this.lattice.length && !this.warp?.topo) { e.preventDefault(); this.deps.send({ type: 'studioWarpSelect', id: this.warp!.id, points: this.lattice.map((_, i) => i), mode: 'set' }); return; }
      if (['z', 'y', 's'].includes(e.key.toLowerCase())) { e.preventDefault(); this.deps.send({ type: 'studioKey', key: e.key.toLowerCase(), ctrl: true, shift: e.shiftKey }); }
      return;
    }
    const k = e.key.toLowerCase();
    if (this.busy && (k === 'escape' || ('wersqdbm'.includes(k) && k.length === 1))) return; // a tool change waits for the release of a stroke or drag
    if (k === 'escape') { e.preventDefault(); this.escape(); }
    else if (k === 'f') this.fit(e.shiftKey);
    else if ('wersqdbm'.includes(k) && k.length === 1) this.deps.send({ type: 'studioKey', key: k, ctrl: false, shift: false });
    else if (k === 'x') this.deps.send({ type: 'studioKey', key: k, ctrl: false, shift: false }); // local / world
    else if (k.length === 1 && '[]{}'.includes(k)) { e.preventDefault(); this.deps.send({ type: 'studioKey', key: k, ctrl: false, shift: e.shiftKey }); } // the Weights brush's radius and strength
  }

  /**
   * Esc, pressed on the stage or handed over by the studio (`studioEscape`): a topology edit is cancelled, a deform tool clears its selection;
   * anything else goes to the studio, which leaves a deform tool for Move or else closes, as Esc does in its side columns.
   */
  escape() {
    const mode = this.cfg.mode;
    if (mode === 'warp' && this.warp?.topo) { this.deps.send({ type: 'studioMeshTopo', id: this.warp.id, op: 'cancel' }); return; }
    const selected = mode === 'weights' ? this.skin?.selected.length ?? 0 : mode === 'warp' ? this.warp?.points.length ?? 0 : 0;
    if (mode && escapeAction(mode, selected) === 'clear') {
      if (mode === 'weights' && this.skin) this.deps.send({ type: 'studioWeightsSelect', id: this.skin.id, points: [], mode: 'set' });
      else if (mode === 'warp' && this.warp) this.deps.send({ type: 'studioWarpSelect', id: this.warp.id, points: [], mode: 'set' });
    } else this.deps.send({ type: 'studioKey', key: 'escape', ctrl: false, shift: false });
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    if (this.scrollsPage && !e.ctrlKey && !e.metaKey) { this.deps.send({ type: 'studioWheel', dy }); return; }
    this.fitted = false;
    this.view = zoomViewAt(this.view, [e.clientX, e.clientY], wheelFactor(dy));
    this.applyView();
  }

  /** The studio's chosen row (a part or a bone): the stage outlines it and says by the gizmo which of the two it is. */
  setChosen(name: string | null) {
    this.chosen = name;
    this.draw();
  }

  /** Whether a plain wheel scrolls the studio's column (its narrow layout) instead of zooming. */
  setScrollsPage(on: boolean) {
    this.scrollsPage = on;
    this.applyView(); // the hint names the zoom gesture
  }

  /** The mesh edge (vertex pair) nearest the pointer within `reach` screen pixels, with the nearest point on it. */
  private edgeAt(p: GizmoPoint, reach = 8): { edge: [number, number]; at: GizmoPoint } | null {
    let best: { edge: [number, number]; at: GizmoPoint } | null = null, bd = reach;
    for (const [a, b] of this.meshEdgeList) {
      const A = this.lattice[a], B = this.lattice[b], dx = B[0] - A[0], dy = B[1] - A[1], l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? Math.min(1, Math.max(0, ((p[0] - A[0]) * dx + (p[1] - A[1]) * dy) / l2)) : 0, q: GizmoPoint = [A[0] + dx * t, A[1] + dy * t], d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (d < bd) { bd = d; best = { edge: [a, b], at: q }; }
    }
    return best;
  }
  /** Where a topology Add would put its vertex under screen point `p` (snapped onto a near edge), as a screen point and as the rest position in the part's pixels. */
  private addSpot(p: GizmoPoint): { screen: GizmoPoint; rest: [number, number] } | null {
    const snap = this.edgeAt(p, 7), screen = snap ? snap.at : p, rest = this.deps.renderer.studioDeformerRestPoint(this.deps.char, this.warp!.id, this.toStage({ clientX: screen[0], clientY: screen[1] }));
    return rest ? { screen, rest } : null;
  }

  private onHover(e: PointerEvent) {
    this.pointer = [e.clientX, e.clientY];
    if (this.cfg.mode === 'weights' && this.skin && this.skinVerts.length) {
      if (e.buttons) return;
      // The test pose's gizmo (when on) keeps its handle cursors; otherwise the cursor says what the brush does, and a paint brush shows its ring in place of the pointer.
      const h = this.frame && this.cfg.tool ? pickHandle(gizmoHandles(this.cfg.tool, this.frame), this.pointer) : null;
      if (h?.axis !== this.hover?.axis || (h === null) !== (this.hover === null)) this.hover = h;
      const paint = isPaintBrush(this.skin.mode) && this.skin.brush > 0;
      if (paint) this.brushAt = this.pointer;
      document.body.style.cursor = h ? (this.cfg.tool === 'rotate' ? 'grab' : this.cfg.tool === 'scale' ? 'nesw-resize' : 'move') : paint ? 'none' : brushCursor(this.skin.mode);
      this.draw();
      return;
    }
    if (this.warp?.topo && this.lattice.length) {
      if (e.buttons) return;
      const tool = this.warp.topo, p: GizmoPoint = [e.clientX, e.clientY];
      const i = tool === 'add' || tool === 'flip' || tool === 'removeEdge' ? -1 : pickPoint(this.lattice, p);
      const edge = tool === 'flip' || tool === 'removeEdge' ? this.edgeAt(p)?.edge ?? null : null, spot = tool === 'add' ? this.addSpot(p) : null;
      const same = (a: [number, number] | null, b: [number, number] | null) => a === b || (!!a && !!b && a[0] === b[0] && a[1] === b[1]);
      if (i !== this.hoverPoint || !same(edge, this.hoverEdge) || (spot?.screen[0] ?? null) !== (this.ghost?.[0] ?? null) || (spot?.screen[1] ?? null) !== (this.ghost?.[1] ?? null)) {
        this.hoverPoint = i; this.hoverEdge = edge; this.ghost = spot ? spot.screen : null;
        this.draw();
      }
      document.body.style.cursor = i >= 0 || edge || spot ? (tool === 'move' ? 'move' : 'pointer') : '';
      return;
    }
    const points = this.lattice.length ? this.lattice : this.maskPoints;
    if (points.length) {
      if (e.buttons) return;
      const i = pickPoint(points, [e.clientX, e.clientY]);
      if (i !== this.hoverPoint) { this.hoverPoint = i; this.draw(); }
      document.body.style.cursor = i >= 0 ? 'move' : '';
      return;
    }
    if (e.buttons || !this.frame || !this.cfg.tool) { if (this.hover) { this.hover = null; this.draw(); } return; }
    const h = pickHandle(gizmoHandles(this.cfg.tool, this.frame), [e.clientX, e.clientY]);
    if (h?.axis !== this.hover?.axis || (h === null) !== (this.hover === null)) { this.hover = h; this.draw(); }
    document.body.style.cursor = h ? (this.cfg.tool === 'rotate' ? 'grab' : this.cfg.tool === 'scale' ? 'nesw-resize' : 'move') : '';
  }

  /**
   * A press on the stage: one dispatch on the stage mode (docs/design/studio-stage-modes.md). Every mode drags the gizmo it shows (the transform
   * gizmo, or the Weights tool's test pose); then the mode says what a press on its own handles, on art and on nothing does. Only the Transform
   * and Pivot modes fall through to the generic pick with the bone dots; the deform modes keep their subject through a miss.
   */
  private onDown(e: PointerEvent) {
    window.focus();
    if (e.button === 1 || (e.button === 0 && this.spaceDown)) { if (this.spaceDown) this.spacePanned = true; this.pan(e); return; }
    const mode = this.cfg.mode;
    if (e.button !== 0 || !mode || this.deps.suspended()) return;
    const p: GizmoPoint = [e.clientX, e.clientY];
    const h = this.frame && this.cfg.tool && this.cfg.name ? pickHandle(gizmoHandles(this.cfg.tool, this.frame), p) : null;
    if (h) { this.stop(e); this.startDrag(e, h); return; }
    if (mode === 'weights') this.weightsDown(e, p);
    else if (mode === 'warp') this.warpDown(e, p);
    else if (mode === 'mask') this.maskDown(e, p);
    else this.transformDown(e, p);
  }

  /** The parts under the pointer, front to back (the stage's own hit test). */
  private hitsAt(e: PointerEvent): string[] { const [sx, sy] = this.toStage(e); return this.deps.renderer.studioHitAll(this.deps.char, sx, sy); }

  /** Report a choice to the editor, which applies the choose rule (the part; Alt: its bone; Ctrl: added to the chosen ones). */
  private select(e: PointerEvent, p: GizmoPoint, name: string | null, hits: string[]) {
    this.deps.send({ type: 'studioSelect', name, hits, at: [p[0], p[1]], shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey });
  }

  /** Transform (Move, Rotate, Scale) and Pivot: a bone's pivot dot chooses the bone, art the part under the pointer, nothing clears the row. */
  private transformDown(e: PointerEvent, p: GizmoPoint) {
    this.stop(e);
    const bone = this.bones.find(b => Math.hypot(b.at[0] - p[0], b.at[1] - p[1]) <= 10);
    if (bone) { this.select(e, p, bone.name, [bone.name]); return; }
    const hits = this.hitsAt(e);
    this.select(e, p, hits[0] ?? null, hits);
  }

  /**
   * Weights: the brush mode says what a press does. A vertex under the pointer is read out, selected or painted; art of another part chooses it
   * (a click, not a drag); nothing clears the readout, starts a rectangle or dabs on air. Bone dots take no click: a bone has nothing to weight.
   */
  private weightsDown(e: PointerEvent, p: GizmoPoint) {
    this.stop(e);
    const w = this.skin;
    if (!w || !this.skinVerts.length) { const hits = this.hitsAt(e); if (hits.length) this.select(e, p, hits[0], hits); return; }
    const id = w.id;
    if (isPaintBrush(w.mode) && w.brush > 0) { this.startPaint(e); return; }
    const v = pickPoint(this.skinVerts, p);
    if (w.mode === 'select') {
      if (v >= 0) { this.deps.send({ type: 'studioWeightsSelect', id, points: [v], mode: e.shiftKey ? 'toggle' : 'set' }); return; }
      this.startMarquee(e, () => {
        if (!e.shiftKey) this.deps.send({ type: 'studioWeightsSelect', id, points: [], mode: 'set' });
        const hits = this.hitsAt(e);
        if (hits.length) this.select(e, p, hits[0], hits);
      });
      return;
    }
    if (v >= 0) { this.deps.send({ type: 'studioWeightsPick', id, vertex: v }); return; }
    const hits = this.hitsAt(e);
    if (hits.length) this.select(e, p, hits[0], hits);
    else this.deps.send({ type: 'studioWeightsPick', id, vertex: -1 });
  }

  /** Warp: a lattice point drags (Shift toggles it), topology mode edits, art of a part chooses it, nothing clears the point selection or draws a rectangle. */
  private warpDown(e: PointerEvent, p: GizmoPoint) {
    const w = this.warp;
    if (w?.topo && this.lattice.length) { this.topoDown(e, p, w); return; }
    this.stop(e);
    if (!w || !this.lattice.length) { const hits = this.hitsAt(e); if (hits.length) this.select(e, p, hits[0], hits); return; }
    const point = pickPoint(this.lattice, p);
    if (point >= 0) {
      if (e.shiftKey) this.deps.send({ type: 'studioWarpSelect', id: w.id, points: [point], mode: 'toggle' });
      else this.startWarpDrag(e, point);
      return;
    }
    this.startMarquee(e, () => {
      const hits = this.hitsAt(e);
      if (hits.length) this.select(e, p, hits[0], hits);
      else if (!e.shiftKey) this.deps.send({ type: 'studioWarpSelect', id: w.id, points: [], mode: 'set' });
    });
  }

  /** Mask: the chosen polygon's points are handles (Alt-click removes one, an edge adds one); near an outline picks that shape, else the part under the pointer, else a shape the pointer is inside. */
  private maskDown(e: PointerEvent, p: GizmoPoint) {
    this.stop(e);
    if (this.maskPoints.length && this.mask?.shape) {
      const mp = pickPoint(this.maskPoints, p);
      if (mp >= 0) { if (e.altKey) this.deps.send({ type: 'studioMaskRemove', shape: this.mask.shape, point: mp }); else this.startMaskDrag(e, mp); return; }
      const edge = nearestEdge(this.maskLine, p);
      if (edge && edge.dist <= 8) {
        const at = this.deps.renderer.studioCanvasPoint(this.deps.char, this.toStage({ clientX: edge.at[0], clientY: edge.at[1] }));
        if (at) this.deps.send({ type: 'studioMaskAdd', shape: this.mask.shape, index: edge.index + 1, at });
        return;
      }
    }
    const outlines = this.shapeLines.map(s => ({ name: s.name, outlines: s.outlines as [number, number][][] }));
    const near = shapeAtEdge(outlines, p, 8);
    const hits = near ? [] : this.hitsAt(e);
    const hit = hits[0] ?? null;
    const inside = near || hit ? null : shapeAtInside(outlines, p);
    this.select(e, p, near ?? hit ?? inside, near ? [near] : hits);
  }

  /** The vertices of the weighted mesh under a brush of `radius` screen pixels at `at`, each with its falloff (1 in the middle, 0 at the rim, smoothed). */
  private brushHits(at: GizmoPoint, radius: number): [number, number][] {
    const out: [number, number][] = [];
    this.skinVerts.forEach((p, i) => {
      const t = 1 - Math.hypot(p[0] - at[0], p[1] - at[1]) / radius;
      if (t > 0) out.push([i, t * t * (3 - 2 * t)]);
    });
    return out;
  }

  /**
   * A press with the weight brush: report the vertices under it as it moves (the editor paints them), until the release. A click (no move) that
   * touched no vertex is a press on whatever is under it: another part's art chooses that part; air is a dab on air.
   */
  private startPaint(e: PointerEvent) {
    const w = this.skin!, id = w.id, radius = w.brush, p: GizmoPoint = [e.clientX, e.clientY];
    let touched = false, moved = false;
    const send = (phase: string, at: GizmoPoint | null) => {
      const hits = at ? this.brushHits(at, radius) : [];
      if (hits.length) touched = true;
      this.deps.send({ type: 'studioWeightsBrush', phase, id, hits });
    };
    this.busy = true;
    this.brushAt = p;
    send('start', this.brushAt);
    const move = (m: PointerEvent) => { this.brushAt = [m.clientX, m.clientY]; if (Math.hypot(m.clientX - p[0], m.clientY - p[1]) >= 4) moved = true; send('move', this.brushAt); };
    const up = (m: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      this.busy = false;
      send('end', null);
      if (m.type === 'pointerup' && !touched && !moved) { const hits = this.hitsAt(e); if (hits.length) this.select(e, p, hits[0], hits); }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  /** A press in topology mode: the tool acts on the vertex, edge or spot under it (the editor does the edit and may refuse); nothing else is picked. */
  private topoDown(e: PointerEvent, p: GizmoPoint, w: WarpConfig) {
    this.stop(e);
    const tool = w.topo!, send = (m: object) => this.deps.send({ type: 'studioMeshTopo', id: w.id, ...m });
    if (tool === 'add') { const spot = this.addSpot(p); send({ op: 'add', at: spot ? spot.rest : null }); return; }
    if (tool === 'flip' || tool === 'removeEdge') { const hit = this.edgeAt(p); if (hit) send({ op: tool, a: hit.edge[0], b: hit.edge[1] }); return; }
    const point = pickPoint(this.lattice, p);
    if (point < 0) return;
    if (tool === 'move') this.startWarpDrag(e, point);
    else send({ op: tool, vertex: point });
  }

  /**
   * Empty space pressed with a lattice shown: a click picks what is under it as ever, a drag draws a rectangle and selects the
   * lattice points inside it (Shift adds them to the selection).
   */
  private startMarquee(e: PointerEvent, click: () => void) {
    const skin = this.cfg.mode === 'weights' && this.skin?.mode === 'select' ? this.skin : null, id = skin ? skin.id : this.warp!.id, add = e.shiftKey, x0 = e.clientX, y0 = e.clientY;
    let dragged = false;
    this.busy = true;
    const move = (m: PointerEvent) => {
      if (!dragged && Math.hypot(m.clientX - x0, m.clientY - y0) < 4) return;
      dragged = true;
      this.marquee = { x0, y0, x1: m.clientX, y1: m.clientY };
      this.draw();
    };
    const up = (m: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      this.busy = false;
      this.marquee = null;
      if (m.type === 'pointerup' && Math.hypot(m.clientX - x0, m.clientY - y0) >= 4) dragged = true; // a press and a release far apart are a drag even if no move was seen
      if (!dragged || m.type === 'pointercancel') { this.draw(); if (m.type !== 'pointercancel') click(); return; }
      const [ax, bx] = [Math.min(x0, m.clientX), Math.max(x0, m.clientX)], [ay, by] = [Math.min(y0, m.clientY), Math.max(y0, m.clientY)];
      const pts = skin ? this.skinVerts : this.lattice;
      const points = pts.flatMap((q, i) => (q[0] >= ax && q[0] <= bx && q[1] >= ay && q[1] <= by ? [i] : []));
      this.deps.send({ type: skin ? 'studioWeightsSelect' : 'studioWarpSelect', id, points, mode: add ? 'add' : 'set' });
      this.draw();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  private stop(e: Event) { e.preventDefault(); e.stopPropagation(); }

  private pan(e: PointerEvent) {
    this.stop(e);
    this.fitted = false;
    this.busy = true;
    let lx = e.clientX, ly = e.clientY;
    const move = (m: PointerEvent) => { this.view = panBy(this.view, m.clientX - lx, m.clientY - ly); lx = m.clientX; ly = m.clientY; this.applyView(); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); this.busy = false; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /** A lattice point pressed: report how far the pointer has moved it, measured in the deformer's own space, until the release. */
  private startWarpDrag(e: PointerEvent, point: number) {
    const { renderer, char } = this.deps, id = this.warp!.id, from = this.toStage(e);
    const send = (phase: string, delta: [number, number]) => this.deps.send({ type: 'studioWarpDrag', phase, id, point, delta });
    this.busy = true;
    send('start', [0, 0]);
    const step = (ev: PointerEvent, phase: 'move' | 'end') => send(phase, renderer.studioDeformerDelta(char, id, from, this.toStage(ev)) ?? [0, 0]);
    const move = (m: PointerEvent) => step(m, 'move');
    const up = (m: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      this.busy = false;
      step(m, 'end');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  /** A mask polygon's point pressed: report how far the pointer has moved it, in canvas pixels, until the release. */
  private startMaskDrag(e: PointerEvent, point: number) {
    const { renderer, char } = this.deps, shape = this.mask!.shape!, from = this.toStage(e);
    const send = (phase: string, delta: [number, number]) => this.deps.send({ type: 'studioMaskDrag', phase, shape, point, delta });
    this.busy = true;
    send('start', [0, 0]);
    const step = (ev: PointerEvent, phase: 'move' | 'end') => send(phase, renderer.studioMaskDelta(char, shape, from, this.toStage(ev)) ?? [0, 0]);
    const move = (m: PointerEvent) => step(m, 'move');
    const up = (m: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      this.busy = false;
      step(m, 'end');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  private startDrag(e: PointerEvent, h: GizmoHandle) {
    const { renderer, char } = this.deps, c = this.cfg, name = c.name!, tool = c.tool!;
    const t = renderer.studioTarget(char, name), sp = renderer.studioSpace(char);
    if (!t || !sp) return;
    const local = (ev: PointerEvent): GizmoPoint => sp.fromStage(this.toStage(ev));
    const from = local(e);
    const send = (phase: string, delta: Offset) => this.deps.send({ type: 'studioGizmoDrag', phase, name, tool, delta });
    this.busy = true;
    send('start', NO_OFFSET);
    let last = NO_OFFSET;
    const step = (ev: PointerEvent, phase: 'move' | 'end') => {
      const next = dragBone({ tool, start: t.offset, pivot: t.pivot, parent: t.parent, unit: t.unit, from, to: local(ev), mods: { shift: ev.shiftKey, alt: ev.altKey }, space: c.space, axis: h.axis, center: t.center });
      last = offsetDelta(t.offset, next);
      this.drag = { name, delta: last }; // the pose shows the drag as it goes, in either mode; the editor decides what a finished drag becomes
      this.deps.repose();
      this.draw();
      send(phase, last);
    };
    const move = (m: PointerEvent) => step(m, 'move');
    const up = (m: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      this.busy = false;
      step(m, 'end'); // the editor answers with studioExtra, which ends the drag here
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }
}
