// The DOM side of the docking model (engine/src/dock.ts): puts each panel element in its zone element in layout order, lets a handle
// drag a panel to another place (with a drop line), and moves it with Alt+arrows from the keyboard. It knows nothing of the
// animation studio; editor/dock-sandbox.html is its test bench. The layout is kept by the caller (`onChange`).
import { dropTarget, movePanel, nudgePanel, defaultDock, fixDock, type Box, type DockLayout, type DockSpec } from '../engine/src/dock.js';

export interface DockOptions {
  spec: DockSpec;
  /** The element of each zone: panels are appended to it, in order. */
  zones: Record<string, HTMLElement>;
  /** The element of each panel. A panel not listed is not part of the dock. */
  panels: Record<string, HTMLElement>;
  /** The element of a panel that starts a drag (and takes Alt+arrows); the panel itself when left out. */
  handle?: (id: string, panel: HTMLElement) => HTMLElement | null;
  layout?: DockLayout;
  /** Called with the new layout after every move the author made (not after `setLayout`). */
  onChange?: (layout: DockLayout) => void;
  /** Called after the panels were placed (by the first mount, `setLayout`, `setPresent` and every move). */
  onRender?: () => void;
}

export interface Dock {
  readonly layout: DockLayout;
  /** Show this layout (fixed against the spec). */
  setLayout(layout: DockLayout): void;
  /** The panels a mode has: the others keep their place in the order but are `hidden`, still in the DOM. */
  setPresent(ids: readonly string[] | null): void;
  destroy(): void;
}

const DRAG_PX = 4;
const box = (el: Element): Box => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };

export function mountDock(opts: DockOptions): Dock {
  const { spec, zones, panels, onChange } = opts;
  let layout = fixDock(spec, opts.layout);
  let present: ReadonlySet<string> | null = null;
  let abort: (() => void) | null = null;
  const line = document.createElement('div');
  line.className = 'dock-drop-line';
  line.hidden = true;
  line.style.cssText = 'position:fixed;height:3px;background:var(--accent,#5fd1c3);pointer-events:none;z-index:1000;border-radius:2px';
  document.body.append(line);

  const shown = (id: string) => !!panels[id] && (!present || present.has(id));

  // Other elements may share a zone with the panels (a resize grip, say): the order is only the panels'.
  const isPanel = (n: Element | null) => n instanceof HTMLElement && n.dataset.dockPanel !== undefined;
  const nextPanel = (n: Element | null) => { while (n && !isPanel(n)) n = n.nextElementSibling; return n; };
  for (const id of Object.keys(panels)) panels[id].dataset.dockPanel = id;

  function render() {
    for (const z of spec.zones) {
      const host = zones[z];
      if (!host) continue;
      let prev: Element | null = null;
      for (const id of layout[z]) {
        const el = panels[id];
        if (!el) continue;
        // An absent panel stays in the DOM (the tool looks its controls up there), in its place, hidden.
        el.hidden = !shown(id);
        // Move only what is out of place, so a panel that stays put keeps its focus and scroll.
        const want: Element | null = nextPanel(prev ? prev.nextElementSibling : host.firstElementChild);
        if (el !== want || el.parentElement !== host) host.insertBefore(el, want);
        prev = el;
      }
    }
    opts.onRender?.();
  }

  function commit(next: DockLayout) {
    if (next === layout) return;
    layout = next;
    render();
    onChange?.(layout);
  }

  function startDrag(id: string, e: PointerEvent, handle: HTMLElement) {
    const x0 = e.clientX, y0 = e.clientY;
    let active = false, target: ReturnType<typeof dropTarget> = null;
    const panel = panels[id];
    const rects = () => {
      const zb: Record<string, Box> = {}, rb: Record<string, Box> = {};
      for (const z of spec.zones) if (zones[z]) zb[z] = box(zones[z]);
      for (const k of Object.keys(panels)) if (shown(k) && panels[k].isConnected) rb[k] = box(panels[k]);
      return { zb, rb };
    };
    const move = (ev: PointerEvent) => {
      if (!active) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < DRAG_PX) return;
        active = true;
        // A host may show an empty zone as a place to drop while a drag is on (the studio's second left column).
        for (const z of spec.zones) if (zones[z]) zones[z].dataset.dockDrag = '';
        panel.classList.add('dock-dragging');
        document.body.style.cursor = 'grabbing';
      }
      const { zb, rb } = rects();
      target = dropTarget(spec, layout, id, ev.clientX, ev.clientY, zb, rb);
      if (!target) { line.hidden = true; return; }
      // The line sits above the panel that would follow the dragged one, or under the last panel of the zone.
      const others = layout[target.zone].filter(k => k !== id && rb[k]);
      const z = zb[target.zone];
      const next = others[countShownBefore(layout[target.zone], id, target.index, rb)];
      const y = next ? rb[next].y : others.length ? rb[others[others.length - 1]].y + rb[others[others.length - 1]].h : z.y;
      line.style.left = `${z.x}px`; line.style.width = `${z.w}px`; line.style.top = `${y - 1}px`;
      line.hidden = false;
    };
    const end = (apply: boolean) => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key, true);
      try { handle.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      panel.classList.remove('dock-dragging');
      for (const z of spec.zones) if (zones[z]) delete zones[z].dataset.dockDrag;
      document.body.style.cursor = '';
      line.hidden = true;
      abort = null;
      if (apply && active && target) commit(movePanel(spec, layout, id, target.zone, target.index));
    };
    const up = () => end(true);
    const cancel = () => end(false);
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { ev.stopPropagation(); end(false); } };
    abort = cancel;
    handle.setPointerCapture(e.pointerId);
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key, true);
  }

  const cleanups: (() => void)[] = [];
  for (const id of Object.keys(panels)) {
    const handle = opts.handle?.(id, panels[id]) ?? panels[id];
    if (!handle) continue;
    handle.dataset.dockHandle = id;
    handle.tabIndex = handle.tabIndex < 0 ? 0 : handle.tabIndex;
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest('input,select,textarea,button:not([data-dock-handle])')) return;
      e.preventDefault();
      abort?.();
      startDrag(id, e, handle);
    };
    const keydown = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!d) return;
      e.preventDefault();
      commit(nudgePanel(spec, layout, id, d[0], d[1], present ?? undefined));
      handle.focus(); // the move may have re-parented it
    };
    handle.addEventListener('pointerdown', down);
    handle.addEventListener('keydown', keydown);
    cleanups.push(() => { handle.removeEventListener('pointerdown', down); handle.removeEventListener('keydown', keydown); });
  }

  render();
  return {
    get layout() { return layout; },
    setLayout(next) { layout = fixDock(spec, next); render(); },
    setPresent(ids) { present = ids ? new Set(ids) : null; render(); },
    destroy() { abort?.(); for (const c of cleanups) c(); line.remove(); },
  };
}

/** How many of the zone's other panels that have a box come before slot `index` (which counts all the other panels, shown or not). */
function countShownBefore(zoneIds: readonly string[], dragged: string, index: number, rows: Record<string, Box>): number {
  let shownBefore = 0, seen = 0;
  for (const k of zoneIds) {
    if (k === dragged) continue;
    if (seen >= index) break;
    seen++;
    if (rows[k]) shownBefore++;
  }
  return shownBefore;
}

export { defaultDock };
