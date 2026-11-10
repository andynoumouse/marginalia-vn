// The markup of the tool row over the studio's stage: icon buttons in three groups, the transform tools, the deform tools and the
// view, and at the right end (Animate only) the keying pair. GizmoBar (anim-gizmo.ts) wires them; studio.css decides which of
// them a mode shows and draws the separators between the groups. The buttons keep their `data-gz` and `as-gz-*` hooks.
// Under it, the tool options bar (docs/design/studio-inspector.md): one panel per tool (engine/src/studio-inspector.ts `toolBar`),
// a fixed height and never empty. The Weights panel fills its own (anim-weights.ts); the others are here.

import { iconButton } from './studio-icons.js';

const group = (cls: string, label: string, buttons: string[]) => `<span class="as-gz-group ${cls}" role="group" aria-label="${label}">${buttons.join('')}</span>`;

export function toolRowHtml(): string {
  const tool = (gz: 'pivot' | 'move' | 'rotate' | 'scale' | 'warp' | 'weights' | 'mask', label: string, key: string, does = '') =>
    iconButton({ icon: gz, label, key, title: `${label} (${key.toUpperCase()})${does && ': ' + does}`, pressed: false, data: { gz } });
  return [
    group('as-gz-tools', 'Transform tools', [
      tool('pivot', 'Pivot', 'q', 'click or drag on the stage to place the pivot of the chosen part'),
      tool('move', 'Move', 'w', 'a click on art chooses the part, Alt-click or its pivot dot the bone; the gizmo poses what the part hangs on'),
      tool('rotate', 'Rotate', 'e', 'shift snaps to 15 degrees; a click chooses the part, Alt-click or its pivot dot the bone'),
      tool('scale', 'Scale', 'r', 'shift keeps the ratio, alt scales from the middle; a click chooses the part, Alt-click or its pivot dot the bone'),
    ]),
    group('as-gz-deform', 'Deform tools', [
      tool('warp', 'Warp', 'd', "drag the points of the lattice over the chosen part to shape it for the active parameter's value; a click beside it keeps the part, Esc with no point selected goes back to Move"),
      tool('weights', 'Weights', 'b', "paint the weights of the chosen part's mesh with the brush in the tool options bar, so the part bends along the skeleton (its bones are bound in Properties › Skin); a click beside the mesh keeps the part, Esc with nothing selected goes back to Move"),
      tool('mask', 'Mask', 'm', "drag the points of the chosen part's drawn mask, click an edge to add a point, Alt-click a point to remove it"),
    ]),
    group('as-gz-view', 'View', [
      iconButton({ icon: 'fit', label: 'Fit', key: 'f', className: 'as-gz-fit',
        title: 'Fit (F): fit the character in view (wheel zooms, middle-drag or Space+drag pans)' }),
    ]),
    group('as-gz-anim as-gz-end', 'Keying', [
      iconButton({ icon: 'autokey', label: 'Auto-key', key: 'Shift+K', pressed: true, className: 'as-gz-auto',
        title: 'Auto-key (Shift+K): a drag writes a key at the playhead; off, it only previews until you press Key' }),
      iconButton({ icon: 'key', label: 'Key', key: 'k', className: 'as-gz-key', title: 'Key (K): write the previewed drags as keys at the playhead' }),
    ]),
  ].join('');
}

/** The tool options bar: the mode label, then the panel of the tool in use (the studio shows one by `data-bar`). */
export function toolBarHtml(): string {
  return `<div class="as-toolbar" role="group" aria-label="Tool options">
    <span class="atb-mode" aria-live="polite"></span>
    <div class="atb" data-bar="gizmo">
      <span class="atb-line"></span>
      ${iconButton({ icon: 'world', label: 'World axes', key: 'x', pressed: false, className: 'as-gz-world',
        title: 'World axes (X): the gizmo axes stay the stage axes; off, they follow the bone' })}
    </div>
    <div class="atb" data-bar="pivot" hidden>
      ${iconButton({ icon: 'clear', label: 'Clear pivot', className: 'as-pivot-clear', title: 'Clear: the chosen part loses its own pivot and turns about the middle of its image again' })}
      <span class="atb-pop">${iconButton({ icon: 'share', label: 'Same pivot for…', className: 'as-pivot-share', title: 'Same pivot for…: tick the other parts that should turn about this pivot too' })}
        <span class="as-share atb-panel" role="group" aria-label="Parts with the same pivot"></span></span>
    </div>
    <div class="atb" data-bar="warp" hidden></div>
    <div class="atb atb-weights" data-bar="weights" hidden></div>
    <div class="atb" data-bar="mask" hidden>
      ${iconButton({ icon: 'point-add', label: 'Add point after', className: 'am-add', title: 'Add point after: a point halfway between the chosen point and the next (the last one when none is chosen). A click on an edge of the outline adds one there' })}
      ${iconButton({ icon: 'point-remove', label: 'Remove point', className: 'am-del', title: 'Remove point: the chosen point goes (Alt-click a point on the stage does the same)' })}
    </div>
  </div>`;
}
