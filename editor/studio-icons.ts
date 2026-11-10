// Inline SVG icons for the studio's buttons: one 20 x 20 grid, a 1.6 stroke, round caps and joins, `currentColor`, so an icon takes the
// colour of its button (muted, text on hover, accent when pressed). No image files, no dependency. The stage tool row uses them
// (studio-toolrow.ts); to use one in another panel, call `icon()` or `iconButton()` and add a name below for a new one.
// The look of `.si` and `.si-btn` is in studio.css ("Icon buttons").

export type IconName =
  | 'pivot' | 'move' | 'rotate' | 'scale' | 'warp' | 'weights' | 'mask'
  | 'world' | 'fit' | 'autokey' | 'key'
  | 'brush-add' | 'brush-subtract' | 'brush-replace' | 'brush-smooth' | 'pick' | 'select'
  | 'select-all' | 'select-none' | 'invert' | 'value' | 'mirror' | 'reset' | 'clear' | 'share'
  | 'soft' | 'smooth' | 'preset'
  | 'shape-new' | 'unclip' | 'trash' | 'point-add' | 'point-remove'
  | 'warp-add' | 'warp-group' | 'unwarp' | 'unskin' | 'topology'
  | 'vertex-add' | 'vertex-delete' | 'vertex-move' | 'edge-flip' | 'edge-add' | 'edge-remove';

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
  // A bone with its weight fading along it: two joints and dots that thin out.
  weights: '<path d="M5.2 14.8 14.8 5.2"/><circle cx="4.4" cy="15.6" r="2"/><circle cx="15.6" cy="4.4" r="2"/><circle cx="11.6" cy="11.6" r="1" fill="currentColor" stroke="none"/><circle cx="8.4" cy="8.4" r=".6" fill="currentColor" stroke="none"/>',
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
  // The Weights brush modes: a brush ring with what it does to the weight inside it.
  'brush-add': '<circle cx="10" cy="10" r="7"/><path d="M10 6.5v7M6.5 10h7"/>',
  'brush-subtract': '<circle cx="10" cy="10" r="7"/><path d="M6.5 10h7"/>',
  'brush-replace': '<circle cx="10" cy="10" r="7"/><circle cx="10" cy="10" r="3.2" fill="currentColor" stroke="none"/>',
  'brush-smooth': '<circle cx="10" cy="10" r="7"/><path d="M5.5 10.8c1.5-2.2 3-2.2 4.5 0s3 2.2 4.5 0"/>',
  // An eyedropper: read a vertex's weights.
  pick: '<path d="M13 3.5 16.5 7M14.5 5 6.2 13.3 4 16l2.7-2.2L15 5.5"/><path d="M12 4.5l3.5 3.5"/>',
  // A dashed frame: select vertices with a rectangle.
  select: '<rect x="3" y="3" width="14" height="14" rx="1" stroke-dasharray="2.6 2.2"/>',
  'select-all': '<rect x="3" y="3" width="14" height="14" rx="1" stroke-dasharray="2.6 2.2"/><rect x="6.5" y="6.5" width="7" height="7" fill="currentColor" stroke="none"/>',
  'select-none': '<rect x="3" y="3" width="14" height="14" rx="1" stroke-dasharray="2.6 2.2"/><path d="M7 7l6 6M13 7l-6 6"/>',
  // A square, half of it filled: the other half of the vertices.
  invert: '<rect x="3" y="3" width="14" height="14" rx="1"/><path d="M10 3h6a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-6z" fill="currentColor" stroke="none"/>',
  // A slider with its knob: give the selection a value.
  value: '<path d="M3 10h14"/><circle cx="12" cy="10" r="2.6" fill="currentColor" stroke="none"/><path d="M5 6.5v7"/>',
  // Two halves across a dashed middle.
  mirror: '<path d="M10 2.5v15" stroke-dasharray="2 2"/><path d="M7.5 5.5 3 14.5h4.5zM12.5 5.5l4.5 9h-4.5z"/>',
  // An arc turning back: back to the rest pose.
  reset: '<path d="M3.5 10a6.5 6.5 0 1 0 2-4.7"/><path d="M5.5 2v3.3h3.3"/>',
  // A pivot target struck through: clear the pivot.
  clear: '<circle cx="10" cy="10" r="3.6"/><path d="M10 2v4.4M10 13.6V18M2 10h4.4M13.6 10H18"/><path d="M4 16 16 4"/>',
  // Two targets joined: give other parts the same pivot.
  share: '<circle cx="6" cy="10" r="3"/><circle cx="14" cy="10" r="3"/><path d="M9 10h2"/>',
  // A point with rings fading out: a soft selection pulls its neighbours too.
  soft: '<circle cx="10" cy="10" r="2" fill="currentColor" stroke="none"/><circle cx="10" cy="10" r="4.8"/><circle cx="10" cy="10" r="7.6" stroke-dasharray="2 2.4"/>',
  // A jagged line and the even one it becomes.
  smooth: '<path d="M2.5 8 5 4.5 7.5 9 10 5 12.5 9.5 15 5.5 17.5 8" stroke-dasharray="1.8 1.6"/><path d="M2.5 14c2.5-2.4 5-2.4 7.5 0s5 2.4 7.5 0"/>',
  // A lattice row bent into a ready-made shape, with a spark: a preset shape.
  preset: '<path d="M2.5 13c3-4 6 0 9-3.5"/><path d="M2.5 17c3-4 6 0 9-3.5"/><path d="M15 2.5v5M12.5 5h5"/>',
  // A dashed outline with a plus: draw a new mask shape.
  'shape-new': '<path d="M9 3 15 7.5 13 15H5L3 7.5z" stroke-dasharray="2.4 1.8"/><path d="M15.5 12v6M12.5 15h6"/>',
  // The mask frame struck through: draw the part whole again.
  unclip: '<rect x="2.5" y="2.5" width="15" height="15" rx="2"/><circle cx="10" cy="10" r="4.2"/><path d="M4 16 16 4"/>',
  // A bin: delete or remove for good (Ctrl+Z brings it back).
  trash: '<path d="M3.5 5.5h13M8 5.5v-2h4v2M5.5 5.5l1 11h7l1-11M8.5 8.5v5M11.5 8.5v5"/>',
  // An outline's corner with a plus, and with a minus: add a point after the chosen one, remove the chosen one.
  'point-add': '<path d="M2.5 14 7.5 5l5 2.5"/><circle cx="7.5" cy="5" r="1.8" fill="currentColor" stroke="none"/><path d="M15 11v6M12 14h6"/>',
  'point-remove': '<path d="M2.5 14 7.5 5l5 2.5"/><circle cx="7.5" cy="5" r="1.8" fill="currentColor" stroke="none"/><path d="M12 14h6"/>',
  // A small bent lattice with a plus: give the part a warp of its own.
  'warp-add': '<path d="M2.5 5c2-1.4 3.5 1.4 5 0s3.5-1.4 5 0M2.5 9.5c2-1.4 3.5 1.4 5 0s3.5-1.4 5 0M4.5 2.5c-1.4 2 1.4 3.5 0 5s1.4 3.5 0 5M10.5 2.5c-1.4 2 1.4 3.5 0 5s1.4 3.5 0 5"/><path d="M15.5 12v6M12.5 15h6"/>',
  // Three parts under one bent line, and a plus: a group warp over several parts.
  'warp-group': '<path d="M2.5 5c2.5-2 5 2 7.5 0s5-2 7.5 0"/><rect x="3" y="9" width="3.4" height="3.4" rx=".6"/><rect x="8.3" y="9" width="3.4" height="3.4" rx=".6"/><path d="M15.5 12v6M12.5 15h6"/>',
  // The bent lattice struck through: draw the part unbent again.
  unwarp: '<path d="M3 6c3-2 5 2 7 0s5-2 7 0M3 13c3-2 5 2 7 0s5-2 7 0M6 3c-2 3 2 5 0 7s2 5 0 7M14 3c-2 3 2 5 0 7s2 5 0 7"/><path d="M3.5 16.5 16.5 3.5"/>',
  // A bone struck through: the mesh's weights go.
  unskin: '<path d="M5.2 14.8 14.8 5.2"/><circle cx="4.4" cy="15.6" r="2"/><circle cx="15.6" cy="4.4" r="2"/><path d="M4 4l12 12"/>',
  // Three vertices and the triangle edges between them, one dashed: edit the mesh's topology.
  topology: '<path d="M3.5 16 10 3.5 16.5 16z"/><path d="M10 3.5v12.5" stroke-dasharray="2 1.8"/><circle cx="10" cy="3.5" r="1.6" fill="currentColor" stroke="none"/><circle cx="3.5" cy="16" r="1.6" fill="currentColor" stroke="none"/><circle cx="16.5" cy="16" r="1.6" fill="currentColor" stroke="none"/>',
  // The topology tools: a mesh triangle (its corners are the vertices) with a plus or a minus; a vertex in four arrows.
  'vertex-add': '<path d="M2.5 15 7 4.5l5 5z"/><circle cx="7" cy="4.5" r="1.6" fill="currentColor" stroke="none"/><circle cx="2.5" cy="15" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="9.5" r="1.6" fill="currentColor" stroke="none"/><path d="M15.5 11.5v6M12.5 14.5h6"/>',
  'vertex-delete': '<path d="M2.5 15 7 4.5l5 5z"/><circle cx="7" cy="4.5" r="1.6" fill="currentColor" stroke="none"/><circle cx="2.5" cy="15" r="1.6" fill="currentColor" stroke="none"/><path d="M12.5 14.5h6"/>',
  'vertex-move': '<circle cx="10" cy="10" r="2" fill="currentColor" stroke="none"/><path d="M10 2.5v4M10 13.5v4M2.5 10h4M13.5 10h4M8.3 4.2 10 2.5l1.7 1.7M8.3 15.8 10 17.5l1.7-1.7M4.2 8.3 2.5 10l1.7 1.7M15.8 8.3 17.5 10l-1.7 1.7"/>',
  // Two triangles making a quad: the dashed diagonal gives way to the solid one.
  'edge-flip': '<path d="M10 2.5 17.5 10 10 17.5 2.5 10z"/><path d="M4.5 10h11" stroke-dasharray="1 2.5"/><path d="M10 2.5v15"/>',
  // Two edges from a vertex and the dashed one that closes their triangle, with a plus; a whole triangle with a minus.
  'edge-add': '<path d="M2.5 16 7.5 4.5 12.5 16"/><path d="M5 16h5" stroke-dasharray="1 2"/><circle cx="2.5" cy="16" r="1.6" fill="currentColor" stroke="none"/><circle cx="12.5" cy="16" r="1.6" fill="currentColor" stroke="none"/><path d="M16 2.5v6M13 5.5h6"/>',
  'edge-remove': '<path d="M2.5 16 7.5 4.5 12.5 16z"/><circle cx="2.5" cy="16" r="1.6" fill="currentColor" stroke="none"/><circle cx="12.5" cy="16" r="1.6" fill="currentColor" stroke="none"/><path d="M13 5.5h6"/>',
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
