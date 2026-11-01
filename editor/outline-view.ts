// Story outline: a modal flowchart of the labels (engine/src/outline.ts). Click a label to jump to its source.
// Wheel zooms at the cursor, dragging pans, Fit / Start recentre, the search box finds labels (Enter: next match).

import { backEdgeLanes, centerOn, fitView, searchOutline, zoomAt, type Outline, type OutlineEdge, type OutlineNode, type ViewState } from '../engine/src/index.js';

const NODE_W = 176, NODE_H = 54, GAP_X = 140, GAP_Y = 22, PAD = 24;
const NS = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, text?: string) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text !== undefined) el.textContent = text;
  return el;
}

export class OutlineView {
  private root: HTMLDivElement;
  private body: HTMLElement;
  private stage: SVGGElement;
  private search: HTMLInputElement;
  private count: HTMLElement;
  private info: HTMLElement;
  private returnFocus: (() => void) | null = null;
  private outline: Outline | null = null;
  private view: ViewState = { scale: 1, x: 0, y: 0 };
  private content = { w: 0, h: 0 };
  private spots = new Map<string, { x: number; y: number }>();
  private nodeEls = new Map<string, SVGGElement>();
  private matches: string[] = [];
  private current = -1;
  private dragged = false;

  constructor(host: HTMLElement, private goTo: (file: string, line: number) => void) {
    this.root = document.createElement('div');
    this.root.id = 'outline';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="outline-card" role="dialog" aria-modal="true" aria-label="Story outline">
        <header><strong>Story outline</strong>
          <input type="search" class="ol-search" placeholder="Find label or choice (/)" aria-label="Find a label or choice text">
          <span class="ol-count" aria-live="polite"></span>
          <span class="ol-tools">
            <button type="button" data-act="out" aria-label="Zoom out" title="Zoom out (-)">-</button>
            <button type="button" data-act="in" aria-label="Zoom in" title="Zoom in (+)">+</button>
            <button type="button" data-act="fit" title="Fit everything (0, or double-click the background)">Fit</button>
            <button type="button" data-act="start" title="Centre on the start label at 100%">Start</button>
          </span>
          <span class="hint">Wheel: zoom. Drag: pan. Solid: jump, dashed: call, dotted: runs on. Esc: close</span>
          <button type="button" class="close" aria-label="Close outline">Close</button></header>
        <div class="outline-body" tabindex="-1"></div>
        <footer class="ol-info" aria-live="polite">Hover a label or an arrow for details.</footer>
      </div>`;
    host.append(this.root);
    this.body = this.root.querySelector('.outline-body')!;
    this.search = this.root.querySelector('.ol-search')!;
    this.count = this.root.querySelector('.ol-count')!;
    this.info = this.root.querySelector('.ol-info')!;
    const canvas = svg('svg', { role: 'img', 'aria-label': 'Story flowchart' });
    const marker = svg('marker', { id: 'ol-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto' });
    marker.append(svg('path', { d: 'M0 0 L10 5 L0 10 z', fill: 'context-stroke' }));
    const defs = svg('defs');
    defs.append(marker);
    this.stage = svg('g');
    canvas.append(defs, this.stage);
    this.body.append(canvas);

    this.root.addEventListener('mousedown', e => { if (e.target === this.root) this.close(); });
    this.root.querySelector('.close')!.addEventListener('click', () => this.close());
    this.root.addEventListener('keydown', e => this.onKey(e));
    this.root.querySelector('.ol-tools')!.addEventListener('click', e => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act) this.act(act);
    });
    this.search.addEventListener('input', () => this.runSearch());
    this.body.addEventListener('wheel', e => {
      e.preventDefault();
      const r = this.body.getBoundingClientRect();
      this.setView(zoomAt(this.view, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)), e.clientX - r.left, e.clientY - r.top));
    }, { passive: false });
    this.body.addEventListener('pointerdown', e => this.startDrag(e));
    // Hovering (or focusing) a label lights up its arrows and shows their conditions; hovering an arrow does the same for it.
    const hover = (e: Event, on: boolean) => {
      const el = (e.target as Element).closest<SVGElement>('.ol-node, .ol-edge');
      if (!el) return;
      const name = el.dataset.name;
      this.body.classList.toggle('focusing', on);
      for (const g of this.stage.querySelectorAll<SVGElement>('.ol-edge')) {
        g.classList.toggle('hot', on && (el === g || (name !== undefined && (g.dataset.from === name || g.dataset.to === name))));
      }
      const lit = [...this.stage.querySelectorAll<SVGElement>('.ol-edge.hot')].map(g => g.dataset.info ?? '');
      this.info.textContent = !on ? 'Hover a label or an arrow for details.'
        : [el.dataset.info ?? '', ...(el.classList.contains('ol-node') ? lit.slice(0, 8) : [])].join('\n');
    };
    this.body.addEventListener('pointerover', e => hover(e, true));
    this.body.addEventListener('pointerout', e => hover(e, false));
    this.body.addEventListener('focusin', e => hover(e, true));
    this.body.addEventListener('focusout', e => hover(e, false));
    this.body.addEventListener('dblclick', e => { if (!(e.target as Element).closest('.ol-node')) this.act('fit'); });
  }

  get isOpen() { return !this.root.hidden; }

  open(outline: Outline, returnFocus?: () => void) {
    this.returnFocus = returnFocus ?? null;
    this.root.hidden = false;
    this.render(outline);
    this.act('fit');
    this.body.focus({ preventScroll: true });
  }

  close() {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.returnFocus?.();
  }

  toggle(outline: Outline, returnFocus?: () => void) {
    if (this.isOpen) this.close(); else this.open(outline, returnFocus);
  }

  /** Redraw after the story changed (only while open); the pan and zoom stay where they are. */
  update(outline: Outline) {
    if (this.isOpen) this.render(outline);
  }

  private get viewport() { return { w: this.body.clientWidth, h: this.body.clientHeight }; }

  private setView(v: ViewState) {
    this.view = v;
    this.stage.setAttribute('transform', `translate(${v.x} ${v.y}) scale(${v.scale})`);
  }

  private act(name: string) {
    const vp = this.viewport, mid = { x: vp.w / 2, y: vp.h / 2 };
    if (name === 'fit') this.setView(fitView(this.content, vp));
    else if (name === 'in') this.setView(zoomAt(this.view, 1.25, mid.x, mid.y));
    else if (name === 'out') this.setView(zoomAt(this.view, 0.8, mid.x, mid.y));
    else if (name === 'start') {
      const entry = this.outline?.nodes.find(n => n.entry) ?? this.outline?.nodes[0];
      if (entry) this.centreOn(entry.name, 1);
    }
  }

  private centreOn(name: string, minScale = 0.7) {
    const p = this.spots.get(name);
    if (!p) return;
    this.setView(centerOn({ ...this.view, scale: Math.max(this.view.scale, minScale) }, p.x + NODE_W / 2, p.y + NODE_H / 2, this.viewport));
  }

  private onKey(e: KeyboardEvent) {
    const inSearch = e.target === this.search;
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      if (inSearch && this.search.value) { this.search.value = ''; this.runSearch(); } else this.close();
      return;
    }
    if (inSearch) {
      if (e.key === 'Enter') { e.preventDefault(); this.step(e.shiftKey ? -1 : 1); }
      return;
    }
    const pan = (dx: number, dy: number) => { e.preventDefault(); this.setView({ ...this.view, x: this.view.x + dx, y: this.view.y + dy }); };
    switch (e.key) {
      case '+': case '=': e.preventDefault(); this.act('in'); break;
      case '-': case '_': e.preventDefault(); this.act('out'); break;
      case '0': e.preventDefault(); this.act('fit'); break;
      case '/': e.preventDefault(); this.search.focus(); this.search.select(); break;
      case 'ArrowLeft': pan(80, 0); break;
      case 'ArrowRight': pan(-80, 0); break;
      case 'ArrowUp': pan(0, 80); break;
      case 'ArrowDown': pan(0, -80); break;
    }
  }

  private startDrag(e: PointerEvent) {
    if (e.button !== 0) return;
    const sx = e.clientX, sy = e.clientY, v0 = this.view;
    this.dragged = false;
    const move = (m: PointerEvent) => {
      if (!this.dragged && Math.hypot(m.clientX - sx, m.clientY - sy) < 4) return;
      this.dragged = true;
      this.body.classList.add('panning');
      this.setView({ ...v0, x: v0.x + m.clientX - sx, y: v0.y + m.clientY - sy });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      this.body.classList.remove('panning');
      setTimeout(() => { this.dragged = false; }); // after the click that ends a drag
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  private runSearch() {
    this.matches = this.outline ? searchOutline(this.outline, this.search.value) : [];
    this.current = -1;
    this.markMatches();
    if (this.matches.length) this.step(1);
  }

  private step(dir: number) {
    if (!this.matches.length) return;
    this.current = (this.current + dir + this.matches.length) % this.matches.length;
    this.markMatches();
    this.centreOn(this.matches[this.current]);
  }

  private markMatches() {
    const q = this.search.value.trim() !== '';
    for (const [name, el] of this.nodeEls) {
      el.classList.toggle('dim', q && !this.matches.includes(name));
      el.classList.toggle('hit', q && this.matches.includes(name));
      el.classList.toggle('current', q && name === this.matches[this.current]);
    }
    this.count.textContent = !q ? '' : this.matches.length ? `${this.current + 1}/${this.matches.length}` : 'no match';
  }

  private render(outline: Outline) {
    this.outline = outline;
    this.stage.replaceChildren();
    this.nodeEls.clear();
    this.spots.clear();
    if (!outline.nodes.length) {
      this.content = { w: 0, h: 0 };
      const t = svg('text', { x: 24, y: 40, class: 'meta' }, 'No labels yet.');
      this.stage.append(t);
      return;
    }
    const pos = (n: OutlineNode) => ({ x: PAD + n.layer * (NODE_W + GAP_X), y: PAD + n.row * (NODE_H + GAP_Y) });
    const rows = Math.max(...outline.nodes.map(n => n.row)) + 1;
    this.content = {
      w: PAD * 2 + outline.layers * NODE_W + (outline.layers - 1) * GAP_X,
      h: PAD * 2 + rows * NODE_H + (rows - 1) * GAP_Y,
    };
    for (const n of outline.nodes) this.spots.set(n.name, pos(n));

    const byName = new Map(outline.nodes.map(n => [n.name, n]));
    // Parallel edges between the same two labels fan out a little so they stay distinguishable.
    const pair = new Map<string, number>();
    const edgeLayer = svg('g'), lanes = backEdgeLanes(outline);
    for (const e of outline.edges) {
      const a = byName.get(e.from), b = byName.get(e.to);
      if (!a || !b) continue;
      const k = `${e.from}>${e.to}`, i = pair.get(k) ?? 0;
      pair.set(k, i + 1);
      edgeLayer.append(this.edge(e, pos(a), pos(b), a === b, i, lanes.get(e) ?? 0, (e.via ?? []).map((row, k) => ({ x: PAD + (a.layer + 1 + k) * (NODE_W + GAP_X), y: PAD + row * (NODE_H + GAP_Y) }))));
    }
    const nodeLayer = svg('g');
    for (const n of outline.nodes) {
      const g = this.node(n, pos(n));
      this.nodeEls.set(n.name, g);
      nodeLayer.append(g);
    }
    this.stage.append(edgeLayer, nodeLayer);
    this.matches = searchOutline(outline, this.search.value);
    this.current = Math.min(this.current, this.matches.length - 1);
    this.markMatches();
  }

  private edge(e: OutlineEdge, from: { x: number; y: number }, to: { x: number; y: number }, self: boolean, i: number, lane: number, via: { x: number; y: number }[] = []) {
    const g = svg('g', { class: `ol-edge ${e.kind}`, 'data-from': e.from, 'data-to': e.to });
    const what = [e.text ? `"${e.text}"` : '', e.cond ? `if ${e.cond}` : ''].filter(Boolean).join(' ');
    g.dataset.info = `${e.from} -> ${e.to}  (${{ jump: 'jump', call: 'call', next: 'runs on' }[e.kind]})${what ? `  ${what}` : ''}`;
    const y1 = from.y + NODE_H / 2 + i * 6, y2 = to.y + NODE_H / 2 + i * 6;
    // Cubic bezier: start, two control points, end.
    let c: [number, number][];
    let d = '';
    if (via.length && to.x > from.x) { // long edge: runs straight through the free slot it was given in each column between
      const pts: [number, number][] = [[from.x + NODE_W, y1]];
      for (const v of via) { const y = v.y + NODE_H / 2 + i * 6; pts.push([v.x, y], [v.x + NODE_W, y]); }
      pts.push([to.x, y2]);
      d = `M${pts[0]}`;
      for (let k = 0; k + 1 < pts.length; k++) {
        const [p, q] = [pts[k], pts[k + 1]], h = Math.max(20, (q[0] - p[0]) / 2);
        d += k % 2 === 1 ? ` L${q}` : ` C${[p[0] + h, p[1]]} ${[q[0] - h, q[1]]} ${q}`;
      }
      const m = pts[Math.floor(pts.length / 2)];
      c = [[m[0], m[1]], [m[0], m[1]], [m[0], m[1]], [m[0], m[1]]];
    } else if (self) {
      const x = from.x + NODE_W;
      c = [[x, y1], [x + 50, y1 - 40], [x + 50, y1 + 40], [x, y1 + 8]];
    } else if (to.x > from.x) {
      const x1 = from.x + NODE_W, x2 = to.x, dx = Math.max(40, (x2 - x1) / 2);
      c = [[x1, y1], [x1 + dx, y1], [x2 - dx, y2], [x2, y2]];
    } else { // back edge or same column: leave right, arc round below the nodes, enter left
      const x1 = from.x + NODE_W, x2 = to.x, low = Math.max(from.y, to.y) + NODE_H + 18 + lane * 14 + i * 6;
      c = [[x1, y1], [x1 + 60, low], [x2 - 60, low], [x2, y2]];
    }
    if (!d) d = `M${c[0]} C${c[1]} ${c[2]} ${c[3]}`;
    g.append(svg('path', { d, 'marker-end': 'url(#ol-arrow)' }), svg('path', { d, class: 'hit' }));
    if (e.cond) { // a dot marks a conditional arrow; the condition itself appears on hover
      const mid = (k: 0 | 1) => (c[0][k] + 3 * c[1][k] + 3 * c[2][k] + c[3][k]) / 8;
      g.append(svg('circle', { cx: mid(0), cy: mid(1), r: 4, class: 'badge' }));
      const text = e.cond.length > 60 ? `${e.cond.slice(0, 59)}…` : e.cond; // shown while the arrow is lit
      g.append(svg('text', { x: mid(0), y: mid(1) - 9, class: 'cond', 'text-anchor': 'middle' }, `if ${text}`));
    }
    return g;
  }

  private node(n: OutlineNode, p: { x: number; y: number }) {
    const g = svg('g', {
      class: `ol-node${n.entry ? ' entry' : ''}${n.reachable ? '' : ' orphan'}`, transform: `translate(${p.x} ${p.y})`,
      tabindex: 0, role: 'button', 'aria-label': `Label ${n.name}`, 'data-name': n.name,
    });
    g.dataset.info = `${n.name}  (${n.src.file}:${n.src.line})  ${n.lines} lines${n.menus ? `, ${n.menus} choice menu` : ''}${n.ends ? ', ends the story' : ''}${n.returns ? ', returns' : ''}${n.reachable ? '' : '  - never reached from the start'}`;
    const go = () => { this.close(); this.goTo(n.src.file, n.src.line); };
    g.addEventListener('click', () => { if (!this.dragged) go(); });
    g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    const flags = [n.menus ? `${n.menus} choice${n.menus > 1 ? 's' : ''}` : '', n.ends ? 'ends' : '', n.returns ? 'returns' : '']
      .filter(Boolean).join(' · ');
    g.append(
      svg('rect', { width: NODE_W, height: NODE_H, rx: 6 }),
      svg('text', { x: 10, y: 22, class: 'name' }, n.name.length > 22 ? `${n.name.slice(0, 21)}…` : n.name),
      svg('text', { x: 10, y: 41, class: 'meta' }, `${n.lines} line${n.lines === 1 ? '' : 's'}${flags ? ` · ${flags}` : ''}`),
    );
    return g;
  }
}
