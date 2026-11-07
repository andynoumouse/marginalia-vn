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
- Studio hit test samples alpha at the un-warped position; warped hits are approximate.

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
- Left: keyforms driven by two parameters (a pad) are not editable; mirror and smooth work on the whole keyform, not on a
  selection of points; no soft selection (dragging a point and its neighbours together); no hit-test through the warp (clicking
  a strongly bent part picks by its un-warped pixels).

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
