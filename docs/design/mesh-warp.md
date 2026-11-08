# Mesh-warp deformers

Status: steps 1-8 built (2026-11-07; see Studio below for what was built and what is left); proposed 2026-11-06. Planning pass for the mesh-warp item in `TODO.md`; it builds on the parameter
model in [animation-studio-parameters.md](animation-studio-parameters.md) (`engine/src/params.ts`).

## Model

- A **deformer** is a lattice over one part: `{ "id": "hair_warp", "part": "hair_front", "grid": [4, 5], "keyforms": [...] }`.
  `grid` is [cols, rows] of cells, so `(cols+1)*(rows+1)` control points; default [4, 4], cap 12x12. A part has at most
  one deformer. Chains (`MeshRope`) are the same data with grid `[1, n]`; add `kind: "rope"` only if quad strips look bad.
- Rest positions are a regular grid over the part's image box and are not stored. Only displacements are authored, in the
  unit of the animation `Offset` (stage fractions), one `{dx, dy}` per point.
- Keyforms reuse the `params.ts` shapes: a 1D form is `param` + `keys: [{ at, pts }]`, a 2D form is `params` + `grid` +
  `forms: [{ pts }]`. `pts` may be sparse (`{ "7": [dx, dy] }`; missing points are 0). Several keyforms on one deformer
  add their points.
- Warp parameters are ordinary parameters, so poses, `animate`, timeline lanes and physics drive them with no new
  `SpriteState` field.
- Variants of a slot share the lattice (the PSD places them in one image box). A frame track on a warped part is a
  `checkRig` error, and a slot whose variants differ in size is a warning.

## Group warps (a lattice over several parts)

Built: the engine and renderer, and the studio (see below). A deformer has `part` or `members: string[]` (not both) and,
for a group, an optional `box: [x, y, w, h]` in canvas pixels, else the union of the members' image boxes (the renderer measures them;
the manifest has no sizes). `checkDeformers` takes a `boneOf` map for the "different bones" warning. Decisions:

- **Composition**: own warp first, then the group lattice sampled at the vertex's REST position in the group box, the two displacements
  adding (`warpMemberMesh` in `engine/src/warp.ts`). Sampling at the rest position keeps the group's shape independent of how a member's
  own warp reshaped it, and makes the group stage one more addend, so a part with no group is bit-for-bit as before.
- **Units**: a part's mesh is in the part's own pixels with its box at the origin; its canvas pixels are that plus the box origin
  (`Warp.origin`, the layer's position in the PSD). Displacements are stage fractions times `FX()` on both axes, as for a part warp.
- **Subdivision**: a member's mesh is cut to at least `MEMBER_MIN_GRID` (8) cells each way (`memberMeshGrid`); an own lattice coarser
  than that is sampled bilinearly onto the finer mesh.
- **One mesh buffer**: the member's mesh holds the part as drawn, own and group together, so `unwarpPoint` (click-to-pick) and
  `warpPoints` (a mask that follows the part) work on it unchanged, with the mesh's grid (`Warp.grid`) in place of the own lattice's.
- **Dirty key**: a member is redrawn when its own deformer's parameter values or its group's changed (`paramsKey` of each).
- **Studio queries**: `studioLattice(char, part)` is the part's own lattice (drawn with the group displacement included so it sits on the
  art; null for a part that is only a member); `studioDeformerLattice(char, id)` and `studioDeformerDelta(char, id, from, to)` do the same by
  deformer id, for a group warp too (its points are in stage pixels, its drag delta measured in the first member's space).
- **Studio**: the Warp tool and panel are keyed by deformer id (`studioWarp { id, ... }`, `studioWarpDrag`, `studioWarpSelect`, `studioWarpBox`), the overlay
  draws `studioDeformerLattice` and a drag uses `studioDeformerDelta`. A row with an own warp and/or a group shows a target choice (own
  first, else the group); a bone offers "Add group warp from this bone" (`membersFromBone`: the parts on it and its descendants); the members
  are checkboxes plus "Use selected parts" (the tree's Ctrl-click multi-select). A part moves between groups instead of being refused
  (`addGroupDeformer`, `setMembers`). Pick-to-bind and the slider marks follow the chosen target; a group's row in the bound list is its first member.
- **Robo**: `face_warp`, `eyes_warp` and `mouth_warp` became one 3 x 3 `head_warp` over face, eyes and mouth. The old three were three
  *different* fields on overlapping areas (the face centre moves the opposite way to the eyes), which one smooth lattice cannot reproduce,
  so the forms were fitted by least squares, the features weighted 30 times the face.
- **Shapes as members** (mask shapes, see Masks in rig.json): a shape part may be listed in `members`. Its polygon points (canvas px) are
  sampled in the group box after the shape's own keyforms and the displacement is added (`bendShapeByGroup`, engine/src/masks.ts); the
  shape stays on its bone holder, so the displacement is in the same space as for parts (canvas px, then the bone). Shapes do not widen the default box
  (a group of only shapes needs `box`). A shape that `follow`s a part of the same group is not bent again (`shapeBentByGroup`): that part's
  mesh buffer already holds the group. `applyMasks` redraws on the group's `paramsKey`. `checkClipGroups` warns on a clipped group member
  whose clip source is not bent with it.
- **Left**: nested groups, a bone with differently turning members (skews), editing a group's `box`, editing pad (two-parameter) keyforms,
  and a warp row in the tree itself (the Warp section's summary and the bound list show it).

## Evaluation and rendering

- `params.ts`: export `segment`, add `blendVec(a, b, t)`, `evalDeformer(def, params) -> Float32Array` (per-point
  displacement) and `paramsKey(def, params)` (the deformer's own parameter values joined, the dirty key). A small pure
  `engine/src/warp.ts` makes the rest points for (width, height, grid) and applies displacements to a vertex array.
- Renderer: in `look()`, a part with a deformer gets a Pixi 8 `MeshPlane` (`verticesX = cols+1`, `verticesY = rows+1`) in
  place of its Sprite, inside the same part container, so bones, animation and draw order are unchanged. The actor keeps
  `warps: Map<part, { mesh, rest, key }>`; after the part matrices are placed, `applyWarps` recomputes a deformer only
  when its key changed, writes `rest + displacement` into the position buffer and calls `buffer.update()`.
  Verify partial buffer updates in the Pixi version in use.
- Reduced motion: state-driven warp (script params, poses) still applies; auto animation (idle sway) is dropped. Skip
  mode applies the final parameters without tweening.
- Cost: a 5x5 lattice is 36 vertices with one upload only when dirty; idle characters cost nothing.
- Studio hit test: the point is mapped back through the deformed mesh (`unwarpPoint`) and alpha is sampled on the art at that rest position, so a click lands on the art as drawn.

## Checks (`checkRig`, none in `checkAssets`)

Unique deformer id; `part` exists and is not a bone; grid two integers within the cap; parameter ids and ranges as in
`checkParams`; point indices in range; at most one deformer per part; the frame-track conflict above.

## Studio

1. Hand-written JSON plus validation (and a starter generator).
2. A Warp tool and section: lattice overlay with constant on-screen handles (`studio-gizmo`); the active parameter's value
   selects the keyform; dragging a point writes a displacement to the nearest key or creates one at the current value, one
   undo step. Grid size field, reset point, mirror and smooth tools.
3. Presets that write explicit keyforms for a parameter: sway (bend about the top edge), breathe (scale about a
   pivot), sine / noise. No runtime preset type.

As built (steps 2 and 3), in the layout of [studio-ux.md](studio-ux.md): the **Warp** tool (key **D**, Model mode only) sits
beside Pivot and Move and the **Warp** section (Model mode, closed until the tool is chosen) holds everything else, so there is
no tab. The pure part is `engine/src/warp-edit.ts`; `preview/studio-gizmo.ts` draws the lattice; `editor/anim-warp.ts` is the
section. Decisions:

- **One parameter at a time.** The section picks a parameter (default: the first one this warp is keyed to) and edits its
  one-parameter keyform, `param` + `keys`. The slider in the section is the Parameters section's own control, so the value
  selects the keyform without a second source of truth. Hand-written two-parameter forms are kept and shown but not edited.
- **A drag is a displacement, not a position.** The stage reports how far the pointer moved, measured in the part's own space
  (the mesh's local space, in animation units), so a rotated bone or a zoomed view does not matter. `dragWarpPoint` adds that to
  what the keyform gives the point at the slider value and writes it back: a key within 2 % of the parameter's range takes it (solved
  so the point lands under the pointer at the slider value, not only at the key); with no key near, one is inserted holding the
  curve's value, so the rest of the curve does not change; a keyform's first key brings an empty key at the default. The drag is
  always computed from the keyform as it was when the pointer went down, and the release makes it one undo step.
- **Sparse and tidy.** `pts` stores only points that moved, to five decimals; an emptied key is `{ "at": v }`.
- **Resizing keeps the shape.** The displacement field is sampled (bilinear) onto the new lattice, so a 4x4 shape survives 6x6.
- **Presets** need the part's size in animation units, which only the stage knows (the manifest has no image sizes yet): the
  page reports it with the lattice (`studioWarpBox`), and the preset is written from that.
- The lattice is drawn at the shape the parameters give now, so it shows every parameter that bends the part, not only the one
  being edited.
- **Selections.** The panel keeps a list of chosen points (`selection`); the stage reports a Shift-click, a rectangle, Ctrl+A or
  Esc as `studioWarpSelect { points, mode }` and the panel sends the selection and the soft reach back with `studioWarp`. A drag
  still reports only the pressed point and a delta: the panel makes the weights (`softWeights`: 1 on the selection, fading with
  the distance in lattice cells to the nearest chosen point by a linear, smooth or constant curve) and writes the whole move with
  one `setWarpOwn`, so key snapping and insertion work as for a single point. Scale and rotate use the part's box (the rest
  positions and the displacements need one unit). Mirror and smooth take an optional point list: smooth moves just those, mirror
  treats them as sources and writes their partners.
- Left: keyforms driven by two parameters (a pad) are not editable.

## Implementation order

1. `params.ts`: `segment` export, `blendVec`, `evalDeformer`, `paramsKey`, types; tests in `params.test.mjs`.
2. `checkDeformers` and `RigData.deformers`, called from `checkRig`; tests in `rig.test.mjs`.
3. `engine/src/warp.ts` (rest lattice, apply displacement) with tests; export from the index.
4. Renderer: `MeshPlane` in `look()`, `applyWarps` with the dirty key; a hand-written sway on a sample rig.
5. Reduced motion and skip rules.
6. Studio lattice overlay and point drag writing keyforms (plus a pure helper for the drag-to-keyform write). Done.
7. Studio presets and grid-size editing. Done.
8. Docs and a browser test. Done for the studio part (`browser.test.mjs`, the Warp tool test).
9. Later: rope variant; Live2D import is not wanted now (read the Cubism license first).

Risks: a mesh may change the part's pixel snapping or filtering; a mask on a mesh-warped part works (it clips the container, the mesh is inside it), and a mask shape taken from or placed on a warped part bends with its lattice (`warpPoints`; see Masks, as built in [animation-studio-parameters.md](animation-studio-parameters.md)).
