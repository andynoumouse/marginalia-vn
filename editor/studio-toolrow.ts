// The markup of the tool row over the studio's stage: icon buttons in three groups, the transform tools, the deform tools and the
// view, and at the right end (Animate only) the keying pair. GizmoBar (anim-gizmo.ts) wires them; studio.css decides which of
// them a mode shows and draws the separators between the groups. The buttons keep their `data-gz` and `as-gz-*` hooks.

import { iconButton } from './studio-icons.js';

const group = (cls: string, label: string, buttons: string[]) => `<span class="as-gz-group ${cls}" role="group" aria-label="${label}">${buttons.join('')}</span>`;

export function toolRowHtml(): string {
  const tool = (gz: 'pivot' | 'move' | 'rotate' | 'scale' | 'warp' | 'mask', label: string, key: string, does = '') =>
    iconButton({ icon: gz, label, key, title: `${label} (${key.toUpperCase()})${does && ': ' + does}`, pressed: false, data: { gz } });
  return [
    group('as-gz-tools', 'Transform tools', [
      tool('pivot', 'Pivot', 'q', 'click or drag on the stage to place the pivot of the chosen part'),
      tool('move', 'Move', 'w'),
      tool('rotate', 'Rotate', 'e', 'shift snaps to 15 degrees'),
      tool('scale', 'Scale', 'r', 'shift keeps the ratio, alt scales from the middle'),
    ]),
    group('as-gz-deform', 'Deform tools', [
      tool('warp', 'Warp', 'd', 'drag the points of the lattice over the chosen part to shape it for the parameter value set in the Warp section'),
      tool('mask', 'Mask', 'm', "drag the points of the chosen part's drawn mask, click an edge to add a point, Alt-click a point to remove it"),
    ]),
    group('as-gz-view', 'View', [
      iconButton({ icon: 'world', label: 'World axes', key: 'x', pressed: false, className: 'as-gz-world',
        title: 'World axes (X): the gizmo axes stay the stage axes; off, they follow the bone' }),
      iconButton({ icon: 'fit', label: 'Fit', key: 'f', className: 'as-gz-fit',
        title: 'Fit (F): fit the character in view (wheel zooms, middle-drag or Space+drag pans)' }),
    ]),
    group('as-gz-anim as-gz-end', 'Keying', [
      iconButton({ icon: 'autokey', label: 'Auto-key', pressed: true, className: 'as-gz-auto',
        title: 'Auto-key: a drag writes a key at the playhead; off, it only previews until you press Key' }),
      iconButton({ icon: 'key', label: 'Key', className: 'as-gz-key', title: 'Key: write the previewed drags as keys at the playhead' }),
    ]),
  ].join('');
}
