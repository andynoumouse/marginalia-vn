// Layout rules of the animation studio (editor/anim-studio.ts) that need no DOM: its two modes, the collapsible sections of
// its right-hand column, which of them each mode has and which start open, and the layout the browser keeps between
// openings. See docs/design/studio-ux.md.
import type { DockSpec } from './dock.js';

/**
 * Model: what the character is (parts, bones, pivots, parameters, physics), with the keyforms authored parameter-first as in Live2D
 * Cubism (pick a parameter, pick the parts it moves, pose them at its keys). Animate: what it does (animations on a timeline).
 */
export type StudioMode = 'model' | 'animate';

export interface SectionSpec { id: string; title: string; /** Open the first time the studio shows it. */ open: boolean }

/** The sections of the inspector, in order, for each mode. The Parts tree on the left is a section too (`tree`). */
export const STUDIO_SECTIONS: Record<StudioMode, SectionSpec[]> = {
  // The palette and the tree are the left column (the palette first: it decides what a pick of a part binds); the right column
  // starts with the Keyforms of the active parameter and the chosen part.
  model: [
    { id: 'tree', title: 'Parts', open: true },
    { id: 'poses', title: 'Poses', open: false },
    { id: 'params', title: 'Parameters', open: true },
    { id: 'keyforms', title: 'Keyforms', open: true },
    { id: 'sel', title: 'Properties', open: true },
    { id: 'warp', title: 'Warp', open: false },
    { id: 'mask', title: 'Mask', open: false },
    { id: 'physics', title: 'Physics', open: false },
    { id: 'reactions', title: 'Reactions', open: false },
  ],
  animate: [
    { id: 'tree', title: 'Parts', open: true },
    { id: 'sel', title: 'Properties', open: true },
    { id: 'poses', title: 'Poses', open: false },
    { id: 'params', title: 'Parameters', open: true },
    { id: 'frames', title: 'Frames', open: false },
    { id: 'place', title: 'Place in scene', open: false },
  ],
};

/** The mode an entry point asks for (Model or Animate); Animate when it does not say. */
export const studioMode = (entry?: string | null): StudioMode => (entry === 'model' ? 'model' : 'animate');

/** The width of a left column (each one, when there are two) and of the right one in px, and the share of the left's height the Parameters block takes; what the author dragged. */
export interface StudioSizes { left?: number; right?: number; split?: number }
export const LEFT_WIDTH = { min: 220, max: 520, default: 300 };
export const RIGHT_WIDTH = { min: 240, max: 560, default: 340 };
export const SPLIT = { min: 0.15, max: 0.85, default: 0.5 };
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const clampLeft = (px: number) => Math.round(clamp(px, LEFT_WIDTH.min, LEFT_WIDTH.max));
export const clampRight = (px: number) => Math.round(clamp(px, RIGHT_WIDTH.min, RIGHT_WIDTH.max));
export const clampSplit = (f: number) => Math.round(clamp(f, SPLIT.min, SPLIT.max) * 1000) / 1000;

export type StudioSide = 'left' | 'right';
/** A column dragged narrower than this share of its smallest width folds away (to a thin rail) instead of stopping at the minimum. */
export const COLLAPSE_SHARE = 0.6;
/** What a drag of a column's edge asks for at width `px`: fold the column, or this width. */
export function dragColumn(side: StudioSide, px: number): { collapsed: true } | { width: number } {
  const range = side === 'left' ? LEFT_WIDTH : RIGHT_WIDTH;
  return px < range.min * COLLAPSE_SHARE ? { collapsed: true } : { width: Math.round(clamp(px, range.min, range.max)) };
}

/** What is kept: for each mode, the sections the author opened (true) or closed (false), the sizes the author dragged (both modes) and the columns folded away. */
export interface StudioLayout { open: Partial<Record<StudioMode, Record<string, boolean>>>; size?: StudioSizes; collapsed?: Partial<Record<StudioSide, true>> }
export const NO_LAYOUT: StudioLayout = { open: {} };

/** The layout with a column folded away or brought back. */
export function withCollapsed(layout: StudioLayout, side: StudioSide, collapsed: boolean): StudioLayout {
  const { collapsed: was, ...rest } = layout;
  const next = { ...was };
  if (collapsed) next[side] = true; else delete next[side];
  return Object.keys(next).length ? { ...rest, collapsed: next } : rest;
}

/** A stored layout (JSON text); anything that is not one gives the defaults, and unknown modes, sections and values are dropped. */
export function readLayout(raw: string | null | undefined): StudioLayout {
  let data: unknown;
  try { data = raw ? JSON.parse(raw) : null; } catch { return NO_LAYOUT; }
  if (!data || typeof data !== 'object') return NO_LAYOUT;
  const stored = (data as { open?: unknown }).open, sz = (data as { size?: unknown }).size;
  const open: StudioLayout['open'] = {};
  if (stored && typeof stored === 'object') {
    for (const mode of Object.keys(STUDIO_SECTIONS) as StudioMode[]) {
      const m = (stored as Record<string, unknown>)[mode];
      if (!m || typeof m !== 'object') continue;
      const kept: Record<string, boolean> = {};
      for (const s of STUDIO_SECTIONS[mode]) { const v = (m as Record<string, unknown>)[s.id]; if (typeof v === 'boolean') kept[s.id] = v; }
      open[mode] = kept;
    }
  }
  const size: StudioSizes = {};
  if (sz && typeof sz === 'object') {
    const { left, right, split } = sz as Record<string, unknown>;
    if (typeof left === 'number' && Number.isFinite(left)) size.left = clampLeft(left);
    if (typeof right === 'number' && Number.isFinite(right)) size.right = clampRight(right);
    if (typeof split === 'number' && Number.isFinite(split)) size.split = clampSplit(split);
  }
  const folded = (data as { collapsed?: unknown }).collapsed;
  const collapsed: StudioLayout['collapsed'] = {};
  if (folded && typeof folded === 'object') for (const s of ['left', 'right'] as const) if ((folded as Record<string, unknown>)[s] === true) collapsed[s] = true;
  const hasSize = size.left !== undefined || size.right !== undefined || size.split !== undefined, hasFold = Object.keys(collapsed).length > 0;
  if (!Object.keys(open).length && !hasSize && !hasFold) return NO_LAYOUT;
  return { open, ...(hasSize ? { size } : {}), ...(hasFold ? { collapsed } : {}) };
}

/** The layout with the sizes `size` put over the ones kept (each clamped to its range). */
export function withSize(layout: StudioLayout, size: StudioSizes): StudioLayout {
  const next: StudioSizes = { ...layout.size };
  if (size.left !== undefined) next.left = clampLeft(size.left);
  if (size.right !== undefined) next.right = clampRight(size.right);
  if (size.split !== undefined) next.split = clampSplit(size.split);
  return { ...layout, size: next };
}

export interface SectionContext {
  /** A phone-width window: the Parts block starts closed so the picker, the stage and the timeline are what shows. */
  narrow?: boolean;
  /** Sections with nothing to show (a rig without parameters): they start closed unless the author opened them. */
  empty?: readonly string[];
}

/** Is section `id` open in `mode`: what the author chose, else the default. */
export function sectionOpen(layout: StudioLayout, mode: StudioMode, id: string, ctx: SectionContext = {}): boolean {
  const chosen = layout.open[mode]?.[id];
  if (chosen !== undefined) return chosen;
  const spec = STUDIO_SECTIONS[mode].find(s => s.id === id);
  if (!spec) return false;
  if (ctx.narrow && id === 'tree') return false;
  if (ctx.empty?.includes(id)) return false;
  return spec.open;
}

/** The layout with section `id` of `mode` opened or closed. */
export function withSection(layout: StudioLayout, mode: StudioMode, id: string, open: boolean): StudioLayout {
  return { ...layout, open: { ...layout.open, [mode]: { ...layout.open[mode], [id]: open } } };
}

/** The ids of the sections `mode` has, in order. */
export const sectionIds = (mode: StudioMode): string[] => STUDIO_SECTIONS[mode].map(s => s.id);

/**
 * The dock (engine/src/dock.ts) the studio's sections sit in: three zones in screen order, the left column, a second column beside it
 * (empty at first) and the right one, and every section of either mode as a panel that may be in any. See docs/design/dock-binding.md.
 */
export const STUDIO_ZONES = ['left', 'left2', 'right'] as const;
/** Where each section starts, top to bottom: the order of the markup in editor/anim-studio.ts. A test checks that every section of both modes is here. */
const START: Record<(typeof STUDIO_ZONES)[number], string[]> = {
  left: ['poses', 'params', 'tree'],
  left2: [],
  right: ['keyforms', 'sel', 'warp', 'mask', 'frames', 'physics', 'reactions', 'place'],
};

export function studioDockSpec(): DockSpec {
  return { zones: STUDIO_ZONES, panels: STUDIO_ZONES.flatMap(zone => START[zone].map(id => ({ id, zone }))) };
}

/** The panels `mode` shows: its sections, less the ones a host runs the studio without. */
export const studioPresent = (mode: StudioMode, without: readonly string[] = []): string[] => sectionIds(mode).filter(id => !without.includes(id));
