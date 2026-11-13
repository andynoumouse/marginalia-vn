// The studio's stage: the preview page in studio mode (preview/studio.ts) in an iframe, driven by postMessage.
// This owns the frame and turns the page's messages into typed events; what they change stays in the studio.

import type { GizmoTool, Offset } from '../engine/src/index.js';
import { el } from './anim-dom.js';

/** What the stage page reports. `picked` is a click on the stage (`drag` is set while a pivot is being dragged). */
export type StageEvent =
  | { type: 'ready' }
  | { type: 'picked'; x: number; y: number; drag?: string }
  | { type: 'placed'; x: number; y: number }
  | { type: 'select'; name: string | null; hits: string[]; at: [number, number]; shift: boolean; ctrl: boolean; alt: boolean }
  | { type: 'gizmo'; phase: 'start' | 'move' | 'end'; name: string; tool: GizmoTool; delta: Offset }
  | { type: 'key'; key: string; ctrl: boolean; shift: boolean }
  | { type: 'warpDrag'; phase: 'start' | 'move' | 'end'; id: string; point: number; delta: [number, number] }
  | { type: 'warpSelect'; id: string; points: number[]; mode: 'set' | 'add' | 'toggle' }
  | { type: 'warpBox'; id: string; w: number; h: number; pw?: number; ph?: number }
  | { type: 'meshTopo'; id: string; op: string; vertex?: number; a?: number; b?: number; at?: [number, number] }
  | { type: 'alpha'; id: number; part: string; w: number; h: number; alpha: Uint8Array | null }
  | { type: 'maskDrag'; phase: 'start' | 'move' | 'end'; shape: string; point: number; delta: [number, number] }
  | { type: 'maskAdd'; shape: string; index: number; at: [number, number] }
  | { type: 'maskRemove'; shape: string; point: number }
  | { type: 'weightsPick'; id: string; vertex: number }
  | { type: 'weightsSelect'; id: string; points: number[]; mode: 'set' | 'add' | 'toggle' }
  | { type: 'weightsBrush'; phase: 'start' | 'move' | 'end'; id: string; hits: [number, number][] }
  | { type: 'maskBox'; part: string; x: number; y: number; w: number; h: number }
  | { type: 'partBoxes'; boxes: Record<string, { x: number; y: number; w: number; h: number }> }
  | { type: 'time'; t: number; playing?: boolean }
  | { type: 'exportReady'; id: number; frames: number; width: number; height: number }
  | { type: 'exportData'; id: number; n: number; bytes: ArrayBuffer }
  | { type: 'exportError'; id: number; error: string }
  | { type: 'exportDone'; id: number };

const num = (v: unknown): v is number => typeof v === 'number';

/** A host with no game project (the standalone page): where the stage page is, and the project it draws instead of /api/project. */
export interface StageSource { url: string; project: () => unknown }

export class StageBridge {
  private frame: HTMLIFrameElement | null = null;
  private source: StageSource | null = null;

  /** The studio's narrow layout (studio.css): the columns stack and scroll, so the stage is in the way of a wheel that scrolls them. */
  private narrow = matchMedia('(max-width: 900px)');

  constructor(private slot: HTMLElement, private onEvent: (e: StageEvent) => void) {
    // The stage's frame lights while the keys go to it (KL-8). An iframe matches no :focus-visible, :has() does not follow its focus and it
    // fires no focus event of its own: the page's blur says the focus went into a frame, and any focusin here that it came back.
    const lit = () => this.slot.classList.toggle('as-stage-focus', !!this.frame && document.activeElement === this.frame);
    window.addEventListener('blur', () => setTimeout(lit));
    document.addEventListener('focusin', lit);
    window.addEventListener('message', e => this.onMessage(e));
    this.narrow.addEventListener('change', () => this.postScrolls());
  }

  /** Tell the stage whether a plain wheel scrolls the column (narrow) or zooms (SA-6). */
  private postScrolls() { this.post({ type: 'studioScrolls', on: this.narrow.matches }); }

  /** A wheel the stage passed on: scroll the nearest ancestor of the frame that scrolls, as the wheel would anywhere else in the column. */
  private scrollColumn(dy: number) {
    for (let p = this.frame?.parentElement; p; p = p.parentElement) {
      const o = getComputedStyle(p).overflowY;
      if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) { p.scrollBy({ top: dy }); return; }
    }
    document.scrollingElement?.scrollBy({ top: dy });
  }

  get mounted() { return this.frame !== null; }

  /** Load `char` on a fresh stage in the slot; the editor's stage is the game preview (`../`), the standalone page gives its own. */
  mount(char: string, source?: StageSource) {
    this.source = source ?? null;
    const url = source ? `${source.url}?studio=${encodeURIComponent(char)}&hosted` : `../?studio=${encodeURIComponent(char)}`;
    this.frame = el('iframe', { title: `${char} on the studio stage`, src: url });
    this.slot.replaceChildren(this.frame);
  }

  /** Remove the stage; that frees its WebGL context. */
  unmount() {
    this.frame?.remove();
    this.frame = null;
  }

  post(msg: object) { this.frame?.contentWindow?.postMessage(msg, location.origin); }

  private onMessage(e: MessageEvent) {
    if (e.origin !== location.origin || !this.frame || e.source !== this.frame.contentWindow) return;
    const m = e.data as { type?: string; x?: unknown; y?: unknown; t?: unknown; drag?: string; playing?: boolean } | null;
    if (m?.type === 'studioProjectRequest') { if (this.source) this.post({ type: 'studioProject', project: this.source.project() }); }
    else if (m?.type === 'studioReady') { this.postScrolls(); this.onEvent({ type: 'ready' }); }
    else if (m?.type === 'studioWheel' && num((m as { dy?: unknown }).dy)) this.scrollColumn((m as { dy: number }).dy);
    else if (m?.type === 'studioPicked' && num(m.x) && num(m.y)) this.onEvent({ type: 'picked', x: m.x, y: m.y, drag: m.drag });
    else if (m?.type === 'studioPlaced' && num(m.x) && num(m.y)) this.onEvent({ type: 'placed', x: m.x, y: m.y });
    else if (m?.type === 'studioSelect') this.onEvent({ type: 'select', name: typeof (m as { name?: unknown }).name === 'string' ? (m as { name: string }).name : null, hits: Array.isArray((m as { hits?: unknown }).hits) ? (m as { hits: unknown[] }).hits.filter((h): h is string => typeof h === 'string') : [], at: Array.isArray((m as { at?: unknown }).at) && num((m as { at: unknown[] }).at[0]) && num((m as { at: unknown[] }).at[1]) ? [(m as { at: number[] }).at[0]!, (m as { at: number[] }).at[1]!] : [0, 0], shift: (m as { shift?: unknown }).shift === true, ctrl: (m as { ctrl?: unknown }).ctrl === true, alt: (m as { alt?: unknown }).alt === true });
    else if (m?.type === 'studioGizmoDrag') {
      const g = m as unknown as { phase: 'start' | 'move' | 'end'; name: string; tool: GizmoTool; delta: Offset };
      this.onEvent({ type: 'gizmo', phase: g.phase, name: g.name, tool: g.tool, delta: g.delta });
    } else if (m?.type === 'studioKey') this.onEvent({ type: 'key', key: String((m as { key?: unknown }).key), ctrl: (m as { ctrl?: unknown }).ctrl === true, shift: (m as { shift?: unknown }).shift === true });
    else if (m?.type === 'studioWarpDrag') {
      const g = m as unknown as { phase: 'start' | 'move' | 'end'; id: string; point: number; delta: unknown };
      if (typeof g.id === 'string' && Number.isInteger(g.point) && Array.isArray(g.delta) && g.delta.every(num)) this.onEvent({ type: 'warpDrag', phase: g.phase, id: g.id, point: g.point, delta: [g.delta[0], g.delta[1]] });
    } else if (m?.type === 'studioWarpSelect') {
      const g = m as unknown as { id: string; points: unknown; mode: unknown };
      if (typeof g.id === 'string' && Array.isArray(g.points) && g.points.every(Number.isInteger) && (g.mode === 'set' || g.mode === 'add' || g.mode === 'toggle')) this.onEvent({ type: 'warpSelect', id: g.id, points: g.points as number[], mode: g.mode });
    } else if (m?.type === 'studioWarpBox') {
      const g = m as unknown as { id: string; w: unknown; h: unknown; pw: unknown; ph: unknown };
      if (typeof g.id === 'string' && num(g.w) && num(g.h)) this.onEvent({ type: 'warpBox', id: g.id, w: g.w, h: g.h, pw: num(g.pw) ? g.pw : undefined, ph: num(g.ph) ? g.ph : undefined });
    } else if (m?.type === 'studioMeshTopo') {
      const g = m as unknown as { id: unknown; op: unknown; vertex: unknown; a: unknown; b: unknown; at: unknown };
      if (typeof g.id === 'string' && typeof g.op === 'string') this.onEvent({ type: 'meshTopo', id: g.id, op: g.op, vertex: num(g.vertex) ? g.vertex : undefined, a: num(g.a) ? g.a : undefined, b: num(g.b) ? g.b : undefined, at: Array.isArray(g.at) && g.at.length === 2 && g.at.every(num) ? [g.at[0], g.at[1]] : undefined });
    } else if (m?.type === 'studioAlphaData') {
      const g = m as unknown as { id: unknown; part: unknown; w: unknown; h: unknown; alpha: unknown };
      if (num(g.id) && typeof g.part === 'string' && num(g.w) && num(g.h)) this.onEvent({ type: 'alpha', id: g.id, part: g.part, w: g.w, h: g.h, alpha: g.alpha instanceof Uint8Array ? g.alpha : null });
    } else if (m?.type === 'studioWeightsPick') {
      const g = m as unknown as { id: unknown; vertex: unknown };
      if (typeof g.id === 'string' && Number.isInteger(g.vertex)) this.onEvent({ type: 'weightsPick', id: g.id, vertex: g.vertex as number });
    } else if (m?.type === 'studioWeightsSelect') {
      const g = m as unknown as { id: unknown; points: unknown; mode: unknown };
      if (typeof g.id === 'string' && Array.isArray(g.points) && g.points.every(Number.isInteger) && (g.mode === 'set' || g.mode === 'add' || g.mode === 'toggle')) this.onEvent({ type: 'weightsSelect', id: g.id, points: g.points as number[], mode: g.mode });
    } else if (m?.type === 'studioWeightsBrush') {
      const g = m as unknown as { phase: unknown; id: unknown; hits: unknown };
      const hits = Array.isArray(g.hits) ? g.hits.filter((h): h is [number, number] => Array.isArray(h) && h.length === 2 && Number.isInteger(h[0]) && num(h[1])) : [];
      if (typeof g.id === 'string' && (g.phase === 'start' || g.phase === 'move' || g.phase === 'end')) this.onEvent({ type: 'weightsBrush', phase: g.phase, id: g.id, hits });
    } else if (m?.type === 'studioMaskDrag') {
      const g = m as unknown as { phase: 'start' | 'move' | 'end'; shape: string; point: number; delta: unknown };
      if (typeof g.shape === 'string' && Number.isInteger(g.point) && Array.isArray(g.delta) && g.delta.every(num)) this.onEvent({ type: 'maskDrag', phase: g.phase, shape: g.shape, point: g.point, delta: [g.delta[0], g.delta[1]] });
    } else if (m?.type === 'studioMaskAdd') {
      const g = m as unknown as { shape: string; index: number; at: unknown };
      if (typeof g.shape === 'string' && Number.isInteger(g.index) && Array.isArray(g.at) && g.at.length === 2 && g.at.every(num)) this.onEvent({ type: 'maskAdd', shape: g.shape, index: g.index, at: [g.at[0], g.at[1]] });
    } else if (m?.type === 'studioMaskRemove') {
      const g = m as unknown as { shape: string; point: number };
      if (typeof g.shape === 'string' && Number.isInteger(g.point)) this.onEvent({ type: 'maskRemove', shape: g.shape, point: g.point });
    } else if (m?.type === 'studioMaskBox') {
      const g = m as unknown as { part: string; x: unknown; y: unknown; w: unknown; h: unknown };
      if (typeof g.part === 'string' && num(g.x) && num(g.y) && num(g.w) && num(g.h)) this.onEvent({ type: 'maskBox', part: g.part, x: g.x, y: g.y, w: g.w, h: g.h });
    } else if (m?.type === 'studioPartBoxes') {
      const g = m as unknown as { boxes: unknown }, boxes: Record<string, { x: number; y: number; w: number; h: number }> = {};
      if (g.boxes && typeof g.boxes === 'object') for (const [k, b] of Object.entries(g.boxes as Record<string, Record<string, unknown>>)) if (b && num(b.x) && num(b.y) && num(b.w) && num(b.h)) boxes[k] = { x: b.x, y: b.y, w: b.w, h: b.h };
      this.onEvent({ type: 'partBoxes', boxes });
    } else if (m?.type === 'studioTime' && num(m.t)) this.onEvent({ type: 'time', t: m.t, playing: m.playing });
    else if (m?.type === 'studioExportReady') {
      const g = m as unknown as { id: unknown; frames: unknown; width: unknown; height: unknown };
      if (num(g.id) && num(g.frames) && num(g.width) && num(g.height)) this.onEvent({ type: 'exportReady', id: g.id, frames: g.frames, width: g.width, height: g.height });
    } else if (m?.type === 'studioExportData') {
      const g = m as unknown as { id: unknown; n: unknown; bytes: unknown };
      if (num(g.id) && num(g.n) && g.bytes instanceof ArrayBuffer) this.onEvent({ type: 'exportData', id: g.id, n: g.n, bytes: g.bytes });
    } else if (m?.type === 'studioExportError') {
      const g = m as unknown as { id: unknown; error: unknown };
      if (num(g.id)) this.onEvent({ type: 'exportError', id: g.id, error: typeof g.error === 'string' ? g.error : 'The stage could not draw the frame.' });
    } else if (m?.type === 'studioExportDone') {
      const g = m as unknown as { id: unknown };
      if (num(g.id)) this.onEvent({ type: 'exportDone', id: g.id });
    }
  }
}
