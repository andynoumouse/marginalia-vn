// Inline SVG icons for the studio's buttons: one 20 x 20 grid, a 1.6 stroke, round caps and joins, `currentColor`, so an icon takes the
// colour of its button (muted, text on hover, accent when pressed). No image files, no dependency. The stage tool row uses them
// (studio-toolrow.ts); to use one in another panel, call `icon()` or `iconButton()` and add a name below for a new one.
// The look of `.si` and `.si-btn` is in studio.css ("Icon buttons").

export type IconName =
  | 'pivot' | 'move' | 'rotate' | 'scale' | 'warp' | 'mask'
  | 'world' | 'fit' | 'autokey' | 'key';

/** The shapes of each icon, as the inside of an `<svg viewBox="0 0 20 20">`. Outlines only, except where a part has `fill="currentColor"`. */
const SHAPES: Record<IconName, string> = {
  // A target: a ring with four ticks.
  pivot: '<circle cx="10" cy="10" r="3.6"/><path d="M10 2v4.4M10 13.6V18M2 10h4.4M13.6 10H18"/>',
  // Four arrows from the middle.
  move: '<path d="M10 2.5v15M2.5 10h15M7.6 4.9 10 2.5l2.4 2.4M7.6 15.1 10 17.5l2.4-2.4M4.9 7.6 2.5 10l2.4 2.4M15.1 7.6 17.5 10l-2.4 2.4"/>',
  // A clockwise arc whose head turns back at the top right.
  rotate: '<path d="M16.5 10a6.5 6.5 0 1 1-2-4.7"/><path d="M14.5 2v3.3h-3.3"/>',
  // A small square and the arrow that takes its corner outward.
  scale: '<rect x="3" y="9" width="8" height="8" rx="1"/><path d="M11 9l6-6M12.5 3H17v4.5"/>',
  // A lattice bent out of shape.
  warp: '<path d="M3 5.5c3-2 5 2 7 0s5-2 7 0M3 10c3-2 5 2 7 0s5-2 7 0M3 14.5c3-2 5 2 7 0s5-2 7 0M5.5 3c-2 3 2 5 0 7s2 5 0 7M10 3c-2 3 2 5 0 7s2 5 0 7M14.5 3c-2 3 2 5 0 7s2 5 0 7"/>',
  // A frame with a round opening.
  mask: '<rect x="2.5" y="2.5" width="15" height="15" rx="2"/><circle cx="10" cy="10" r="4.2"/>',
  // A globe: gizmo axes in world space.
  world: '<circle cx="10" cy="10" r="7.5"/><ellipse cx="10" cy="10" rx="3.2" ry="7.5"/><path d="M2.5 10h15"/>',
  // Four corner brackets.
  fit: '<path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4"/>',
  // A keyframe diamond with a record dot: keys are written as you drag.
  autokey: '<path d="M10 2.5 17.5 10 10 17.5 2.5 10z"/><circle cx="10" cy="10" r="2" fill="currentColor" stroke="none"/>',
  // A keyframe diamond with a plus: write a key now.
  key: '<path d="M10 2.5 17.5 10 10 17.5 2.5 10z"/><path d="M10 7.3v5.4M7.3 10h5.4"/>',
};

/** The markup of one icon, for a button that carries its own name (the SVG is hidden from screen readers). `size` is in pixels. */
export function icon(name: IconName, size = 18): string {
  return `<svg class="si" viewBox="0 0 20 20" width="${size}" height="${size}" aria-hidden="true" focusable="false">${SHAPES[name]}</svg>`;
}

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export interface IconButtonOptions {
  icon: IconName;
  /** The accessible name (`aria-label`). The visible text of the tooltip is `title`. */
  label: string;
  /** The tooltip: the name and its key letter first, then what it does. */
  title: string;
  /** A single key that does the same, announced as `aria-keyshortcuts`. */
  key?: string;
  /** A toggle button: starts pressed or not and reports it as `aria-pressed`. A plain command leaves this out. */
  pressed?: boolean;
  /** Extra classes and data attributes of the button. */
  className?: string;
  data?: Record<string, string>;
}

/** A square icon button. The caller wires the click and, for a toggle, keeps `aria-pressed` current. */
export function iconButton(o: IconButtonOptions): string {
  const data = Object.entries(o.data ?? {}).map(([k, v]) => ` data-${k}="${attr(v)}"`).join('');
  return `<button type="button" class="si-btn${o.className ? ' ' + o.className : ''}"${data} aria-label="${attr(o.label)}" title="${attr(o.title)}"`
    + `${o.key ? ` aria-keyshortcuts="${attr(o.key.toUpperCase())}"` : ''}${o.pressed === undefined ? '' : ` aria-pressed="${o.pressed}"`}>${icon(o.icon)}</button>`;
}
