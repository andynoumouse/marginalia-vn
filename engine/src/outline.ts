/**
 * Story outline: the labels of a program as a flowchart (nodes = labels, edges = jumps, calls, menu options and
 * fall-through). Pure data with a layered layout, so the editor only has to draw it and it can be tested in node.
 */

import type { Program, Src } from './types.js';
import { successors } from './assets.js';
import { formatExpr } from './expr.js';
import { hudLabels } from './screens.js';

export type OutlineEdgeKind = 'jump' | 'call' | 'next';

export interface OutlineEdge {
  from: string;
  to: string;
  kind: OutlineEdgeKind;
  /** The menu option that leads here (a jump or call inside an option). */
  text?: string;
  /** The `if` conditions (and choice condition) that must hold to take this edge, joined with "and". */
  cond?: string;
  /** Where the edge starts in the source. */
  src: Src;
  /** For a forward edge spanning several columns: the rows it passes through in each column in between (free of labels). */
  via?: number[];
}

export interface OutlineNode {
  name: string;
  /** Source position of the label's first statement (the label line itself is not kept by the compiler). */
  src: Src;
  lines: number;       // dialogue lines in the body
  menus: number;       // choice menus in the body
  ends: boolean;       // contains `end`
  returns: boolean;    // contains `return`
  entry: boolean;
  reachable: boolean;  // from the entry, following jumps, calls, choices and fall-through
  layer: number;       // column, 0 = entry; unreachable labels share the last column
  row: number;         // position within the column
}

export interface Outline { nodes: OutlineNode[]; edges: OutlineEdge[]; layers: number }

export function buildOutline(program: Program): Outline {
  const { ops, labels } = program;
  // Labels by start pc; labels without statements share the pc of the next one and just fall through.
  const names = Object.keys(labels).sort((a, b) => labels[a] - labels[b]);
  if (!names.length) return { nodes: [], edges: [], layers: 0 };
  const succ = successors(program);
  const entryName = 'start' in labels ? 'start' : names[0];
  const labelAt = new Map<number, string>(); // first label name at a pc
  for (const n of names) if (!labelAt.has(labels[n])) labelAt.set(labels[n], n);

  const nodes: OutlineNode[] = [], edges: OutlineEdge[] = [];
  names.forEach((name, i) => {
    const start = labels[name];
    const next = names[i + 1];
    const end = next === undefined ? ops.length : labels[next];
    const node: OutlineNode = {
      name, src: ops[start]?.src ?? { file: '', line: 1 }, lines: 0, menus: 0, ends: false, returns: false,
      entry: name === entryName, reachable: false, layer: 0, row: 0,
    };
    nodes.push(node);
    if (start >= end) { // empty body: runs on into the next label
      if (next !== undefined) edges.push({ from: name, to: next, kind: 'next', src: node.src });
      return;
    }
    // Menu option block ranges, to name the choice a jump sits in.
    const optionAt = (pc: number): { text: string; cond: string | null } | undefined => {
      for (let m = start; m < end; m++) {
        const op = ops[m];
        if (op.op !== 'menu') continue;
        if (op.timeout && pc >= op.timeout.target && pc < op.end) return { text: 'timeout', cond: null };
        const t = op.options.map(o => o.target);
        for (let k = 0; k < t.length; k++) {
          const stop = k + 1 < t.length ? t[k + 1] : op.timeout?.target ?? Infinity;
          if (pc >= t[k] && pc < stop && pc > m) return { text: op.options[k].text, cond: op.options[k].cond ? formatExpr(op.options[k].cond!) : null };
        }
      }
      return undefined;
    };
    const seen = new Set<string>();
    // Conditions in force at each pc: `if` branches skip to their target when false; the part after a branch's closing
    // goto (elif / else) runs when that branch's condition was false.
    const active: { text: string; end: number; cond?: string }[] = [];
    const condAt = (pc: number, opt?: { cond: string | null }) =>
      [...active.map(a => a.text), ...(opt?.cond ? [opt.cond] : [])].join(' and ') || undefined;
    const add = (kind: OutlineEdgeKind, to: string | undefined, pc: number, opt?: { text: string; cond: string | null }) => {
      if (to === undefined) return;
      const text = opt?.text, cond = condAt(pc, opt);
      const key = `${kind}|${to}|${text ?? ''}|${cond ?? ''}`;
      if (seen.has(key)) return;
      seen.add(key);
      edges.push({ from: name, to, kind, text, cond, src: ops[pc].src });
    };
    for (let pc = start; pc < end; pc++) {
      const op = ops[pc];
      while (active.length && active[active.length - 1].end <= pc) {
        const done = active.pop()!;
        const closing = ops[done.end - 1];
        if (done.cond && closing.op === 'goto' && closing.target > done.end) {
          active.push({ text: `not (${done.cond})`, end: closing.target }); // the elif / else part
        }
      }
      switch (op.op) {
        case 'say': node.lines++; break;
        case 'end': node.ends = true; break;
        case 'ret': node.returns = true; break;
        case 'menu':
          node.menus++;
          break;
        case 'jump': case 'call':
          if (op.target >= 0) add(op.op, labelAt.get(op.target), pc, optionAt(pc));
          break;
        case 'hud': // the labels its elements call (shown as calls: the story returns from them)
          if (op.mode === 'on') for (const l of hudLabels(program.screens[op.name])) { const t = labels[l]; if (t !== undefined) add('call', labelAt.get(t), pc, optionAt(pc)); }
          break;
      }
      // Running off the end of the body: the last op, the end of a menu option or an if block, or a call returning.
      const after = next === undefined ? -1 : labels[next];
      const dead = pc > start && ['jump', 'end', 'ret'].includes(ops[pc - 1].op) && op.op === 'goto'; // the compiler's closing goto of a menu option
      if (!dead && after >= 0 && op.op !== 'jump' && op.op !== 'end' && op.op !== 'ret' && (op.op === 'call' ? pc + 1 === after : succ[pc].includes(after))) {
        add('next', next, pc, optionAt(pc));
      }
      if (op.op === 'branch') active.push({ text: formatExpr(op.cond), end: op.target, cond: formatExpr(op.cond) });
    }
  });

  // Layout: labels the entry reaches form one chart; labels it never reaches form charts of their own below it
  // (rooted at labels nothing else leads to, in definition order), so a second chapter reads as a chart too.
  const out = new Map<string, string[]>(), incoming = new Set<string>();
  for (const e of edges) { out.set(e.from, [...(out.get(e.from) ?? []), e.to]); if (e.to !== e.from) incoming.add(e.to); }
  const byName = new Map(nodes.map(n => [n.name, n]));
  const placed = new Set<string>();
  const routes = new Map<string, number[]>(); // "from>to" -> rows passed through in the layers between
  let rowBase = 0, layers = 0;
  const grow = (root: string, reachable: boolean) => {
    const members = [root];
    placed.add(root);
    for (let q = 0; q < members.length; q++) {
      for (const to of out.get(members[q]) ?? []) if (!placed.has(to)) { placed.add(to); members.push(to); }
    }
    const lay = layoutGroup(root, members, out);
    for (const name of members) {
      const n = byName.get(name)!;
      n.reachable = reachable;
      n.layer = lay.layer.get(name)!;
      n.row = rowBase + lay.row.get(name)!;
    }
    for (const [k, rows] of lay.routes) routes.set(k, rows.map(r => rowBase + r));
    layers = Math.max(layers, lay.layers);
    rowBase += lay.rows;
  };
  grow(entryName, true);
  for (const n of nodes) if (!placed.has(n.name) && !incoming.has(n.name)) grow(n.name, false);
  for (const n of nodes) if (!placed.has(n.name)) grow(n.name, false); // cycles with no way in
  for (const e of edges) {
    const a = byName.get(e.from)!, b = byName.get(e.to)!;
    if (b.layer - a.layer > 1) e.via = routes.get(`${e.from}>${e.to}`);
  }
  return { nodes, edges, layers };
}

interface GroupLayout { layer: Map<string, number>; row: Map<string, number>; routes: Map<string, number[]>; layers: number; rows: number }

/**
 * Layered layout of one connected group: back edges (found by a depth-first walk from the root) are ignored so
 * every label gets the longest-path layer, edges that span several layers are given a dummy slot in each layer they
 * cross (so nodes never sit on top of an edge), and the order within layers is improved by barycenter sweeps.
 */
function layoutGroup(root: string, members: string[], out: Map<string, string[]>): GroupLayout {
  const inGroup = new Set(members);
  // Depth-first walk: discovery order (initial ordering) and the back edges to leave out of the layering.
  const state = new Map<string, 1 | 2>(), order: string[] = [], post: string[] = [], back = new Set<string>();
  const stack: { n: string; i: number }[] = [{ n: root, i: 0 }];
  state.set(root, 1); order.push(root);
  while (stack.length) {
    const top = stack[stack.length - 1], targets = out.get(top.n) ?? [];
    if (top.i >= targets.length) { state.set(top.n, 2); post.push(top.n); stack.pop(); continue; }
    const to = targets[top.i++];
    if (!inGroup.has(to)) continue;
    if (!state.has(to)) { state.set(to, 1); order.push(to); stack.push({ n: to, i: 0 }); }
    else if (state.get(to) === 1) back.add(`${top.n}>${to}`); // includes self loops
  }
  for (const m of members) if (!state.has(m)) order.push(m); // not reachable by the walk (cannot happen), kept for safety
  const fwd = new Map<string, Set<string>>(); // forward edges, de-duplicated
  for (const n of order) {
    const set = new Set<string>();
    for (const to of out.get(n) ?? []) if (inGroup.has(to) && to !== n && !back.has(`${n}>${to}`)) set.add(to);
    fwd.set(n, set);
  }
  // Longest-path layers in topological order (reverse postorder).
  const layer = new Map<string, number>(order.map(n => [n, 0]));
  for (let i = post.length - 1; i >= 0; i--) {
    const n = post[i];
    for (const to of fwd.get(n)!) layer.set(to, Math.max(layer.get(to)!, layer.get(n)! + 1));
  }
  const count = Math.max(...layer.values()) + 1;
  // Layer contents with dummies (numbered strings that cannot be label names: they start with a space).
  const cols: string[][] = Array.from({ length: count }, () => []);
  const next = new Map<string, string[]>(), prev = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    (next.get(a) ?? next.set(a, []).get(a)!).push(b);
    (prev.get(b) ?? prev.set(b, []).get(b)!).push(a);
  };
  for (const n of order) cols[layer.get(n)!].push(n);
  const chains = new Map<string, string[]>();
  for (const n of order) {
    for (const to of fwd.get(n)!) {
      let at = n;
      const chain: string[] = [];
      for (let l = layer.get(n)! + 1; l < layer.get(to)!; l++) {
        const d = ` ${chains.size}.${l}`;
        cols[l].push(d); chain.push(d); link(at, d); at = d;
      }
      link(at, to);
      if (chain.length) chains.set(`${n}>${to}`, chain);
    }
  }
  const pos = new Map<string, number>();
  const reindex = (c: string[]) => c.forEach((n, i) => pos.set(n, i));
  cols.forEach(reindex);
  const sweep = (c: string[], nbrs: Map<string, string[]>) => {
    const bary = new Map<string, number>();
    c.forEach((n, i) => {
      const ns = nbrs.get(n);
      bary.set(n, ns?.length ? ns.reduce((s, x) => s + pos.get(x)!, 0) / ns.length : i);
    });
    c.sort((a, b) => bary.get(a)! - bary.get(b)! || pos.get(a)! - pos.get(b)!);
    reindex(c);
  };
  for (let it = 0; it < 6; it++) {
    for (let l = 1; l < count; l++) sweep(cols[l], prev);
    for (let l = count - 2; l >= 0; l--) sweep(cols[l], next);
  }
  const row = new Map<string, number>();
  for (const n of members) row.set(n, pos.get(n)!);
  const routes = new Map<string, number[]>();
  for (const [k, chain] of chains) routes.set(k, chain.map(d => pos.get(d)!));
  return { layer, row, routes, layers: count, rows: Math.max(...cols.map(c => c.length)) };
}

/** Number of pairs of edges that cross between two neighbouring columns (a measure of how readable the chart is). */
export function outlineCrossings(outline: Outline): number {
  const by = new Map(outline.nodes.map(n => [n.name, n]));
  const gaps = new Map<number, [number, number][]>(); // column gap -> [row at left, row at right]
  for (const e of outline.edges) {
    const a = by.get(e.from), b = by.get(e.to);
    if (!a || !b || b.layer <= a.layer) continue;
    const rows = [a.row, ...(e.via ?? []), b.row];
    for (let i = 0; i + 1 < rows.length && a.layer + i + 1 <= b.layer; i++) {
      const g = a.layer + i;
      (gaps.get(g) ?? gaps.set(g, []).get(g)!).push([rows[i], rows[i + 1]]);
    }
  }
  let total = 0;
  for (const segs of gaps.values()) {
    for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
      if ((segs[i][0] - segs[j][0]) * (segs[i][1] - segs[j][1]) < 0) total++;
    }
  }
  return total;
}

/**
 * Depth lane (0 = shallowest) for each edge that runs backwards or within one column, so back edges whose column
 * ranges overlap arc at different depths instead of on top of each other. Shorter spans get the shallower lanes.
 */
export function backEdgeLanes(outline: Outline): Map<OutlineEdge, number> {
  const by = new Map(outline.nodes.map(n => [n.name, n]));
  const spans: { e: OutlineEdge; lo: number; hi: number }[] = [];
  for (const e of outline.edges) {
    const a = by.get(e.from), b = by.get(e.to);
    if (a && b && a !== b && b.layer <= a.layer) spans.push({ e, lo: b.layer, hi: a.layer });
  }
  spans.sort((p, q) => (p.hi - p.lo) - (q.hi - q.lo));
  const placed: { lo: number; hi: number; lane: number }[] = [], lanes = new Map<OutlineEdge, number>();
  for (const s of spans) {
    const used = new Set(placed.filter(p => p.lo <= s.hi && s.lo <= p.hi).map(p => p.lane));
    let lane = 0;
    while (used.has(lane)) lane++;
    placed.push({ ...s, lane });
    lanes.set(s.e, lane);
  }
  return lanes;
}

/** A pan/zoom state: a point (wx, wy) of the chart is drawn at (wx * scale + x, wy * scale + y). */
export interface OutlineView { scale: number; x: number; y: number }
export const MIN_SCALE = 0.1, MAX_SCALE = 3;
const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

/** Scale and offset that show all of `content` centred in `viewport` (never enlarged past `maxScale`). */
export function fitView(content: { w: number; h: number }, viewport: { w: number; h: number }, maxScale = 1): OutlineView {
  if (content.w <= 0 || content.h <= 0 || viewport.w <= 0 || viewport.h <= 0) return { scale: 1, x: 0, y: 0 };
  const scale = clampScale(Math.min(viewport.w / content.w, viewport.h / content.h, maxScale));
  return { scale, x: (viewport.w - content.w * scale) / 2, y: (viewport.h - content.h * scale) / 2 };
}

/** Zoom by `factor` keeping the chart point under the screen point (px, py) in place. */
export function zoomAt(view: OutlineView, factor: number, px: number, py: number): OutlineView {
  const scale = clampScale(view.scale * factor), k = scale / view.scale;
  return { scale, x: px - (px - view.x) * k, y: py - (py - view.y) * k };
}

/** Pan so the chart point (wx, wy) is in the middle of `viewport`, keeping the zoom. */
export function centerOn(view: OutlineView, wx: number, wy: number, viewport: { w: number; h: number }): OutlineView {
  return { scale: view.scale, x: viewport.w / 2 - wx * view.scale, y: viewport.h / 2 - wy * view.scale };
}

/** Names of the labels that match `query` (case-insensitive): in the label name, its file, or the text of a choice leading out of it. */
export function searchOutline(outline: Outline, query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const texts = new Map<string, string[]>();
  for (const e of outline.edges) if (e.text) texts.set(e.from, [...(texts.get(e.from) ?? []), e.text]);
  return outline.nodes
    .filter(n => [n.name, n.src.file, ...(texts.get(n.name) ?? [])].some(s => s.toLowerCase().includes(q)))
    .map(n => n.name);
}
