# Warps keyed to a pad's grid: editing on the stage

Status: planned 2026-11-13, not started.

A warp (a part's lattice or free mesh, or a group warp over several parts) can be keyed to one slider (`param` + `keys`) or to
a pad's two parameters on a grid (`params` + `grid` + `forms`, row-major like a pose keyform). Both are evaluated and shown
(`evalDeformerForm` in `engine/src/params.ts`), and robo's `head_warp` is keyed to the `head_turn` pad that way. But the
studio edits only the one-slider form: every edit in `engine/src/warp-edit.ts` takes `(def, param: ParamDef, value)`, and
the Warp tool refuses a drag while a pad is active (its bar says so). This plan adds the grid form to the same edits.

## What already works, and is reused

- Evaluation of a grid keyform on a deformer, bilinear between corners, held at the edges.
- Pose keyforms on a pad (`engine/src/keyform-edit.ts`): `snapSpot` takes the pad's dot to the nearest corner of the grid
  (or of the grid it would be made with), `writeForm` stores that corner, and the studio's `followSpot` puts the dot on
  the corner the write took. `padCorners` says which corners are authored, for the pad's corner marks.
- Binding a part's pose to a pad: a grid of 2×2, 3×3 or 5×5 rest forms (`PAD_SIZES`, `axisLines`).
- `warpBound` and the Warp tool's focus rule (a part with a warp keeps the active control).

## Decisions

1. **A drag edits a corner, never a point between corners.** As with poses on a pad, the edit lands on the grid corner
   nearest the pad's dot, and the dot moves onto that corner first, so the shape on show is the one being edited. (A
   slider keyform instead solves the edit so the shape at the slider's value changes; on a grid that would have to pick
   a split between four corners, which no author can see or predict.)
2. **The grid is made on the first edit or by binding.** A first drag on a pad the warp has no keyform for makes the grid
   the way a pose's first write does (`axisOf`: each axis's min, default and max, so 3×3 unless a default sits at an end),
   all corners at rest, then writes the corner. "Bind to parameter…" offers pads for a
   warp too, with the grid size choice poses have.
3. **A pad and one of its axes are different drivers.** A warp keyed to `head_x` alone and one keyed to `head_turn`'s grid
   both apply and add up, as two pose keyforms do. Nothing converts one into the other.
4. **A grid line is added on purpose, as for poses.** A drag never adds one (decision 1); a warp version of `extendGrid`
   adds a line at the dot's value on one axis, every new corner holding what the grid gave there, so the shape does not change.
5. **Mask polygons stay on one slider.** The same change could reach them later; they are not part of this work.

## Engine (`engine/src/warp-edit.ts`, `param-bind.ts`)

- A `WarpSpot`, the warp's version of `KeySpot`: a slider (`param`, `value`) or a pad (`params`, `at`). `warpSpot(def,
  defs, spot)` snaps it: the slider rule that exists today (`WARP_KEY_SNAP`), or the nearest corner of the def's grid
  keyform for that pad (the default grid when there is none).
- The two functions everything else goes through take a spot: `ownDisplacement(def, defs, spot)` reads a key or a corner,
  `setWarpOwn(def, defs, spot, edits)` writes one (a corner is stored as is; the slider branch keeps its solve). The
  `(def, param, value)` forms of these and the functions below stay as thin wrappers over the spot forms. The
  functions built on them follow without their own pad branch: `dragWarpPoint`, `moveWarpPoints`, `resetWarpPoint`,
  `averageDisplacement`, `transformWarpPoints`, `pasteWarpForm`, `mirrorWarp`, `smoothWarp`.
- With their own pad branch: `warpKeyAt` (the corner, or null when the dot is not on one), `deleteWarpKey` (the corner
  goes back to rest; a grid line is not removed, as for poses), `addWarpKey` (sets the corner from what is shown there).
- `bindDeformer` / `unbindDeformer` take a `BindDriver`, so a pad makes or drops a grid. `boundParts` lists a warp bound
  to a pad. `extendWarpGrid(def, defs, params, axis, value)` mirrors `extendGrid`. `warpTicks` stays per slider; a `warpCorners(def, params)` mirrors `padCorners` for the corner marks.
- `warpPreset` stays per slider (its presets sweep one value range). On a pad its menu is disabled and says so.
- The rig.json shape does not change, so `checkRig`, saving and the game need nothing.

## Studio

- The warp panel's `active()` becomes the active driver (slider or pad) and `value()` its spot. On a drag's start with a
  pad, the dot goes to the corner the drag edits (`followSpot`), then the drag runs as now. The skinned-mesh check stays.
- The Warp bar's pad refusal (`warpBarHint`) goes; with a pad it names the corner: `Warp · face · head_turn at (1, 0)`.
- Keyforms: for a pad, the pad shows the warp's authored corners with the marks poses use, the key buttons read "Remove
  this corner" (back to rest), the Point row edits the corner, and the add-grid-line action poses have adds a line to the
  warp's grid. The key strip stays for sliders.
- Bind to parameter… lists the pads for a warp, with the grid size choice.

## Phases (each a session of its own)

1. Engine: `WarpSpot`, the spot-taking core and the functions above, binding, `warpCorners`, `extendWarpGrid`, node tests
   (a corner write, snapping, a first drag making the grid, delete back to rest, transform and paste on a corner, a grid
   line that keeps the shape, the slider path unchanged). The existing warp-edit tests must pass without edits; the
   `warpBarHint` cases in `param-bind.test.mjs` change with the bar in phase 2.
2. Studio: the drag with a pad, the dot following, the bar, the Keyforms corner marks and buttons, Bind to parameter…
   for pads; a browser test that drags `head_warp` at a `head_turn` corner on robo and checks the shape at the corner,
   then one undo step.
3. Docs: `docs/rig-json.md` (no format change, a line on editing), the studio section of `docs/design/mesh-warp.md`, and
   the Warp tool's F1 help.

## Settled

- A drag snaps to the nearest corner (decision 1); a grid line comes from the add-line action (decision 4), not a drag.
- The first drag on a pad makes the grid on its own (decision 2), as a pose's first drag does; Bind to parameter… is there
  for choosing the size first.
