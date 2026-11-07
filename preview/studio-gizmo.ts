// The studio stage's viewport and bone gizmos (the page side of build step 3 in docs/design/animation-studio-parameters.md).
// The viewport zooms and pans the #stage element; the gizmo is an SVG overlay in screen pixels above it, so handles keep
// their size at any zoom. The maths is in engine/src/gizmo.ts and gizmo-rig.ts; this wires pointers to it and reports to
// the editor, which owns the working copy (a drag is only a delta here until the editor writes it: a key in Animate mode, a
// parameter's keyform in Model mode; the pivot is placed with the Pivot tool, not the gizmo).
// The Warp tool draws the lattice of the chosen part's mesh warp as an overlay too (constant-size handles at every control
// point) and reports a point dragged as the distance it moved in the part's own space; the editor writes it into a keyform.
// A part's mask (rig.json `masks`) is drawn as an outline over the stage (dashed, in the colour of the stencil it makes); with the Mask tool
// a polygon's points are handles too: drag one, click an edge to add a point, Alt-click a point to remove it. The editor owns the shape.
// Messages in (see studio.ts): studioGizmo { tool, name, space }, studioExtra { extra }, studioView { fit }, studioWarp { part, point },
// studioMask { part, tool, point }.
// Messages out: studioSelect { name, shift }, studioGizmoDrag { phase, name, tool, delta }, studioKey { key, ctrl, shift },
// studioWarpDrag { phase, part, point, delta }, studioWarpBox { part, w, h }, studioMaskDrag { phase, part, point, delta },
// studioMaskAdd { part, index, at }, studioMaskRemove { part, point }, studioMaskBox { part, x, y, w, h }.

import {
  dragBone, fitBounds, gizmoFrame, gizmoHandles, handleSize, IDENTITY_STAGE_VIEW, latticeEdges, nearestEdge, NO_OFFSET, offsetDelta, panBy, pickHandle, pickPoint, screenToWorld, sumOffset, wheelFactor, worldToScreen, zoomViewAt,
  type GizmoHandle, type GizmoPoint, type GizmoSpace, type GizmoTool, type Offset, type StageView,
} from '../engine/src/index.js';
import type { PixiRenderer } from './pixi-renderer.js';
import { H, stage, W } from './stage-ui.js';

export interface GizmoConfig { tool: GizmoTool | null; name: string | null; space: GizmoSpace }
/** The Warp tool: the part whose lattice is shown and the point the editor has selected. */
export interface WarpConfig { part: string; point: number | null }
/** The mask outline shown: the part it clips, whether its polygon points are live handles (the Mask tool) and the point the editor has selected. */
export interface MaskConfig { part: string; tool: boolean; point: number | null }

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
  private cfg: GizmoConfig = { tool: null, name: null, space: 'local' };
  private base = new Map<string, Offset>();   // pending offsets from the editor (a drag not keyed yet)
  private drag: { name: string; delta: Offset } | null = null;
  private overlay: SVGSVGElement;
  private label: HTMLElement;
  private frame: { origin: GizmoPoint; x: GizmoPoint; y: GizmoPoint } | null = null;
  private bones: { name: string; at: GizmoPoint }[] = [];
  private hover: GizmoHandle | null = null;
  private warp: WarpConfig | null = null;
  private lattice: GizmoPoint[] = [];       // the lattice points on screen, as drawn last
  private hoverPoint = -1;
  private reportedBox = '';
  private mask: MaskConfig | null = null;
  private maskPoints: GizmoPoint[] = [];      // a polygon mask's points on screen, as drawn last (only with the Mask tool)
  private maskLine: GizmoPoint[] = [];        // and its outline, for adding a point on an edge
  private reportedMask = '';
  private spaceDown = false;
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
    document.body.append(this.overlay, this.label);
    window.addEventListener('pointerdown', e => this.onDown(e), true);
    window.addEventListener('pointermove', e => this.onHover(e));
    window.addEventListener('wheel', e => this.onWheel(e), { passive: false });
    window.addEventListener('keydown', e => this.onKey(e));
    window.addEventListener('keyup', e => { if (e.key === ' ') this.spaceDown = false; });
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
    this.cfg = c;
    this.draw();
  }

  /** Show the lattice of `w.part` (null: no Warp tool). */
  setWarp(w: WarpConfig | null) {
    this.warp = w;
    this.hoverPoint = -1;
    this.reportedBox = '';
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
    this.label.textContent = `${Math.round(v.zoom * 100)}%  (wheel zooms, middle-drag or Space+drag pans, F fits)`;
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
    const { renderer, char } = this.deps, c = this.cfg;
    const space = renderer.studioSpace(char);
    if (this.mask && space) this.drawMask(this.mask); // an outline is only a drawing: it shows while a pivot is being picked too
    if (this.warp && space && !this.deps.suspended()) this.drawLattice(this.warp);
    if (!c.tool || !space || this.deps.suspended()) return;
    const screen = (p: GizmoPoint): GizmoPoint => worldToScreen(this.view, space.toStage(p));
    for (const b of renderer.studioSkeleton(char)) {
      const at = screen(b.at);
      this.bones.push({ name: b.name, at });
      if (b.from) { const f = screen(b.from); svg('line', { x1: f[0], y1: f[1], x2: at[0], y2: at[1], stroke: COLORS.bone, 'stroke-width': 2, 'stroke-opacity': 0.8 }, this.overlay); }
    }
    for (const b of this.bones) svg('circle', { cx: b.at[0], cy: b.at[1], r: b.name === c.name ? 6 : 5, fill: b.name === c.name ? COLORS.sel : 'none', stroke: b.name === c.name ? '#fff' : COLORS.bone, 'stroke-width': 2 }, this.overlay);
    const t = c.name ? renderer.studioTarget(char, c.name) : null;
    if (!t) return;
    const f = gizmoFrame(t.parent, t.offset, t.pivot, t.unit, c.space);
    const o = screen(f.origin);
    const dir = (v: GizmoPoint): GizmoPoint => { const p = screen([f.origin[0] + v[0], f.origin[1] + v[1]]); const l = Math.hypot(p[0] - o[0], p[1] - o[1]) || 1; return [(p[0] - o[0]) / l, (p[1] - o[1]) / l]; };
    this.frame = { origin: o, x: dir(f.x), y: dir(f.y) };
    for (const h of gizmoHandles(c.tool, this.frame)) this.drawHandle(h, h.axis === this.hover?.axis);
  }

  /** The warp lattice of the chosen part over the stage: thin lines and a round handle at each control point, all in screen pixels. */
  private drawLattice(w: WarpConfig) {
    const l = this.deps.renderer.studioLattice(this.deps.char, w.part);
    if (!l) return;
    this.lattice = l.points.map(p => worldToScreen(this.view, p));
    const box = `${w.part}|${l.box.w}|${l.box.h}`;
    if (box !== this.reportedBox) { this.reportedBox = box; this.deps.send({ type: 'studioWarpBox', part: w.part, w: l.box.w, h: l.box.h }); }
    const edges = latticeEdges([l.cols, l.rows]);
    for (const [stroke, width, opacity] of [['#000', 3.5, 0.45], [COLORS.lattice, 1.5, 0.95]] as const)
      for (const [a, b] of edges) svg('line', { x1: this.lattice[a][0], y1: this.lattice[a][1], x2: this.lattice[b][0], y2: this.lattice[b][1], stroke, 'stroke-width': width, 'stroke-opacity': opacity }, this.overlay);
    this.lattice.forEach((p, i) => {
      const sel = i === w.point, hot = i === this.hoverPoint;
      svg('circle', { cx: p[0], cy: p[1], r: sel ? 6.5 : 5, fill: sel ? COLORS.sel : hot ? '#fff' : COLORS.lattice, stroke: '#000', 'stroke-width': 1.5 }, this.overlay);
    });
  }

  /** The outline of the part's mask (every shape of it), and with the Mask tool on a polygon, a handle at each point. */
  private drawMask(m: MaskConfig) {
    const { renderer, char } = this.deps, info = renderer.studioMask(char, m.part);
    const box = renderer.studioPartBox(char, m.part), key = `${m.part}|${box ? [box.x, box.y, box.w, box.h].join(',') : ''}`;
    if (box && key !== this.reportedMask) { this.reportedMask = key; this.deps.send({ type: 'studioMaskBox', part: m.part, ...box }); }
    if (!info) return;
    const lines = info.outlines.map(o => o.map(p => worldToScreen(this.view, p)));
    for (const [stroke, width, opacity, dash] of [['#000', 3.5, 0.45, ''], [COLORS.mask, 2, 1, '7 5']] as const)
      for (const l of lines) svg('polygon', { points: l.map(p => p.join(',')).join(' '), fill: 'none', stroke, 'stroke-width': width, 'stroke-opacity': opacity, 'stroke-linejoin': 'round', ...(dash ? { 'stroke-dasharray': dash } : {}) }, this.overlay);
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
    if (e.key === ' ' && !e.repeat) { this.spaceDown = true; e.preventDefault(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) {
      if (['z', 'y', 's'].includes(e.key.toLowerCase())) { e.preventDefault(); this.deps.send({ type: 'studioKey', key: e.key.toLowerCase(), ctrl: true, shift: e.shiftKey }); }
      return;
    }
    const k = e.key.toLowerCase();
    if (k === 'f') this.fit(e.shiftKey);
    else if ('wersqdm'.includes(k) && k.length === 1) this.deps.send({ type: 'studioKey', key: k, ctrl: false, shift: false });
    else if (k === 'x') this.deps.send({ type: 'studioKey', key: k, ctrl: false, shift: false }); // local / world
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    this.fitted = false;
    this.view = zoomViewAt(this.view, [e.clientX, e.clientY], wheelFactor(e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY));
    this.applyView();
  }

  private onHover(e: PointerEvent) {
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

  private onDown(e: PointerEvent) {
    window.focus();
    if (e.button === 1 || (e.button === 0 && this.spaceDown)) { this.pan(e); return; }
    if (e.button !== 0 || (!this.cfg.tool && !this.warp && !this.maskPoints.length) || this.deps.suspended()) return;
    const p: GizmoPoint = [e.clientX, e.clientY];
    const point = this.lattice.length ? pickPoint(this.lattice, p) : -1;
    if (point >= 0) { this.stop(e); this.startWarpDrag(e, point); return; }
    if (this.maskPoints.length && this.mask) {
      const mp = pickPoint(this.maskPoints, p);
      if (mp >= 0) { this.stop(e); if (e.altKey) this.deps.send({ type: 'studioMaskRemove', part: this.mask.part, point: mp }); else this.startMaskDrag(e, mp); return; }
      const edge = nearestEdge(this.maskLine, p);
      if (edge && edge.dist <= 8) {
        this.stop(e);
        const at = this.deps.renderer.studioCanvasPoint(this.deps.char, this.toStage({ clientX: edge.at[0], clientY: edge.at[1] }));
        if (at) this.deps.send({ type: 'studioMaskAdd', part: this.mask.part, index: edge.index + 1, at });
        return;
      }
    }
    const h = this.frame && this.cfg.tool ? pickHandle(gizmoHandles(this.cfg.tool, this.frame), p) : null;
    if (h && this.cfg.name) { this.stop(e); this.startDrag(e, h); return; }
    this.stop(e);
    const bone = this.bones.find(b => Math.hypot(b.at[0] - p[0], b.at[1] - p[1]) <= 10);
    const [sx, sy] = this.toStage(e);
    this.deps.send({ type: 'studioSelect', name: bone ? bone.name : this.deps.renderer.studioHit(this.deps.char, sx, sy), shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey });
  }

  private stop(e: Event) { e.preventDefault(); e.stopPropagation(); }

  private pan(e: PointerEvent) {
    this.stop(e);
    this.fitted = false;
    let lx = e.clientX, ly = e.clientY;
    const move = (m: PointerEvent) => { this.view = panBy(this.view, m.clientX - lx, m.clientY - ly); lx = m.clientX; ly = m.clientY; this.applyView(); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /** A lattice point pressed: report how far the pointer has moved it, measured in the part's own space, until the release. */
  private startWarpDrag(e: PointerEvent, point: number) {
    const { renderer, char } = this.deps, part = this.warp!.part, from = this.toStage(e);
    const send = (phase: string, delta: [number, number]) => this.deps.send({ type: 'studioWarpDrag', phase, part, point, delta });
    send('start', [0, 0]);
    const step = (ev: PointerEvent, phase: 'move' | 'end') => send(phase, renderer.studioLatticeDelta(char, part, from, this.toStage(ev)) ?? [0, 0]);
    const move = (m: PointerEvent) => step(m, 'move');
    const up = (m: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      step(m, 'end');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  /** A mask polygon's point pressed: report how far the pointer has moved it, in canvas pixels, until the release. */
  private startMaskDrag(e: PointerEvent, point: number) {
    const { renderer, char } = this.deps, part = this.mask!.part, from = this.toStage(e);
    const send = (phase: string, delta: [number, number]) => this.deps.send({ type: 'studioMaskDrag', phase, part, point, delta });
    send('start', [0, 0]);
    const step = (ev: PointerEvent, phase: 'move' | 'end') => send(phase, renderer.studioMaskDelta(char, part, from, this.toStage(ev)) ?? [0, 0]);
    const move = (m: PointerEvent) => step(m, 'move');
    const up = (m: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
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
      step(m, 'end'); // the editor answers with studioExtra, which ends the drag here
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }
}
