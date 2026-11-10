// A small docking model with no DOM and no knowledge of any one tool: panels sit in zones (columns), in an order, and the author
// can move a panel to another place in its zone or to another zone. The animation studio will bind to this later; it is built and
// tested on its own first. See docs/design/dock.md.

export interface DockPanel {
  id: string;
  /** The zone the panel starts in, and the zone `resetDock` puts it back in. */
  zone: string;
  /** The zones it may be moved to (its own `zone` is always allowed); all zones when left out. */
  zones?: readonly string[];
  /** A panel new in this version goes right after this one (wherever the author put it) when a stored layout lacks it; else at the end of its zone. */
  after?: string;
}

export interface DockSpec { zones: readonly string[]; panels: readonly DockPanel[] }

/** Where the panels are: for each zone the ids in order, top to bottom. Every spec panel is in exactly one zone. */
export type DockLayout = Record<string, string[]>;

const panelOf = (spec: DockSpec, id: string) => spec.panels.find(p => p.id === id);
const mayGo = (p: DockPanel, zone: string) => zone === p.zone || !p.zones || p.zones.includes(zone);

/** The layout the spec describes: each panel in its own zone, in the order the spec lists them. */
export function defaultDock(spec: DockSpec): DockLayout {
  const out: DockLayout = {};
  for (const z of spec.zones) out[z] = [];
  for (const p of spec.panels) if (out[p.zone]) out[p.zone].push(p.id);
  return out;
}

/**
 * `layout` made valid for `spec`: unknown zones and panels, duplicates and panels in a zone they may not be in are dropped, and
 * panels the layout lacks (new in this version) are put after their `after` panel, or in their own zone after the ones it has, in spec order.
 */
export function fixDock(spec: DockSpec, layout: DockLayout | null | undefined): DockLayout {
  const out: DockLayout = {};
  for (const z of spec.zones) out[z] = [];
  const seen = new Set<string>();
  for (const z of spec.zones) {
    const ids = layout && Array.isArray(layout[z]) ? layout[z] : [];
    for (const id of ids) {
      const p = typeof id === 'string' ? panelOf(spec, id) : undefined;
      if (!p || seen.has(id) || !mayGo(p, z)) continue;
      seen.add(id);
      out[z].push(id);
    }
  }
  for (const p of spec.panels) {
    if (seen.has(p.id)) continue;
    const z = p.after !== undefined ? spec.zones.find(z => out[z].includes(p.after!) && mayGo(p, z)) : undefined;
    if (z !== undefined) out[z].splice(out[z].indexOf(p.after!) + 1, 0, p.id);
    else if (out[p.zone]) out[p.zone].push(p.id);
  }
  return out;
}

/** A stored layout (JSON text) read against `spec`; anything that is not one gives the default. */
export function readDock(spec: DockSpec, raw: string | null | undefined): DockLayout {
  let data: unknown;
  try { data = raw ? JSON.parse(raw) : null; } catch { return defaultDock(spec); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return defaultDock(spec);
  return fixDock(spec, data as DockLayout);
}

export const writeDock = (layout: DockLayout): string => JSON.stringify(layout);

/** The zone panel `id` is in, or undefined. */
export function zoneOf(layout: DockLayout, id: string): string | undefined {
  return Object.keys(layout).find(z => layout[z].includes(id));
}

/** Can panel `id` be dropped in `zone`? */
export function canDock(spec: DockSpec, id: string, zone: string): boolean {
  const p = panelOf(spec, id);
  return !!p && spec.zones.includes(zone) && mayGo(p, zone);
}

/**
 * The layout with panel `id` moved into `zone` at `index` (counted among the zone's other panels, so the index is where it ends
 * up; clamped). The same layout object when the move is not allowed or changes nothing.
 */
export function movePanel(spec: DockSpec, layout: DockLayout, id: string, zone: string, index: number): DockLayout {
  if (!canDock(spec, id, zone)) return layout;
  const from = zoneOf(layout, id);
  if (from === undefined) return layout;
  const rest = layout[zone].filter(x => x !== id);
  const at = Math.max(0, Math.min(rest.length, Math.round(Number.isFinite(index) ? index : rest.length)));
  const next = [...rest.slice(0, at), id, ...rest.slice(at)];
  if (from === zone && next.every((x, i) => x === layout[zone][i])) return layout;
  return { ...layout, [from]: layout[from].filter(x => x !== id), [zone]: next };
}

/** The panels of `zone` that are present now (a tool may leave some out for a mode), in layout order. */
export const panelsIn = (layout: DockLayout, zone: string, present?: ReadonlySet<string> | readonly string[]): string[] => {
  const ids = layout[zone] ?? [];
  if (!present) return ids;
  const has = Array.isArray(present) ? new Set(present) : (present as ReadonlySet<string>);
  return ids.filter(id => has.has(id));
};

export interface Box { x: number; y: number; w: number; h: number }

/** Where a drag at (`x`, `y`) would drop: the zone and the index among the zone's other panels, or null over no zone. */
export interface DropTarget { zone: string; index: number }

/**
 * Hit-test for a drag. `zones` are the zone boxes; `rows` the boxes of the panels now shown, by id (top to bottom within a zone).
 * Inside a zone the index is the number of other panels whose vertical middle is above the pointer, so dropping on the upper half
 * of a row puts the panel before it. A zone a panel may not enter gives null.
 */
export function dropTarget(spec: DockSpec, layout: DockLayout, dragged: string, x: number, y: number,
  zones: Record<string, Box>, rows: Record<string, Box>): DropTarget | null {
  const zone = spec.zones.find(z => { const b = zones[z]; return b && x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h; });
  if (zone === undefined || !canDock(spec, dragged, zone)) return null;
  let index = 0;
  for (const id of layout[zone] ?? []) {
    if (id === dragged) continue;
    const r = rows[id];
    if (!r) { index++; continue; } // not shown now: keep its place in the order
    if (y >= r.y + r.h / 2) index++;
    else break;
  }
  return { zone, index };
}

/** The default layout again. */
export const resetDock = (spec: DockSpec): DockLayout => defaultDock(spec);

/** Is `layout` the default? (To grey out a Reset button.) */
export function isDefaultDock(spec: DockSpec, layout: DockLayout): boolean {
  const d = defaultDock(spec);
  return spec.zones.every(z => d[z].length === (layout[z] ?? []).length && d[z].every((id, i) => id === layout[z][i]));
}

/**
 * The keyboard version of a drag: one step up or down (`dy` -1 / 1) among the panels shown (`present`, all when left out), or
 * to the nearest zone to the left or right (`dx` -1 / 1) that the panel may enter, keeping its index as far as that zone allows.
 * The same layout object when there is nowhere to go.
 */
export function nudgePanel(spec: DockSpec, layout: DockLayout, id: string, dx: number, dy: number,
  present?: ReadonlySet<string> | readonly string[]): DockLayout {
  const from = zoneOf(layout, id);
  if (from === undefined) return layout;
  if (dx) {
    const step = dx < 0 ? -1 : 1;
    const i = spec.zones.indexOf(from);
    for (let j = i + step; j >= 0 && j < spec.zones.length; j += step) {
      if (canDock(spec, id, spec.zones[j])) return movePanel(spec, layout, id, spec.zones[j], layout[from].indexOf(id));
    }
    return layout;
  }
  if (!dy) return layout;
  const shown = panelsIn(layout, from, present);
  const at = shown.indexOf(id), other = shown[at + (dy < 0 ? -1 : 1)];
  if (at < 0 || other === undefined) return layout;
  const rest = layout[from].filter(x => x !== id);
  return movePanel(spec, layout, id, from, rest.indexOf(other) + (dy < 0 ? 0 : 1));
}
