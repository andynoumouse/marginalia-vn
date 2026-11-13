# MD report: Model mode deformers and the stage gizmo (as returned by the tester)

Counts: S1 0, S2 3, S3 13.

Scripts and screenshots were in the session scratchpad under `kit/testers/MD/` and were not kept. A mid-session restart wiped s01-s27; all
findings were re-run afterwards except MD-5, -7, -8, -9, -13, -16, whose evidence is recorded console output.

## Scope
- **Viewport:** 1600x900 only.
- **Character:** robo only. Mina has no parameters, so her rig cannot test keyed deformers.
- **Covered:**
  - Lattice warp on `face`, keyed to a new slider `squash`, two keys, Mirror, Smooth and the in-between values. The same warp also tried on `lean`.
  - A group warp from 3 ticked parts (upper_l, lower_l, hand_l), keyed to `lean`.
  - `head_warp` with the `head_turn` pad, aiming at a group member and choosing the group target.
  - Generate mesh, Edit topology (add, move and delete a vertex, with undo), Bind ▾ for two bones, Auto-weights, the Add brush, and the Rotate test pose.
  - Mask: New shape on `mouth`, the clip, dragging a point, Bind to parameter, dragging at a key.
  - Gizmo: locked state, Rotate on a bone past a full turn, W and R, wheel zoom, middle-drag and Space+drag pan, F and Shift+F.
  - Apply, Close, reopen twice; undo and redo of a keyform drag, a warp drag, a mask point and a topology edit.
- **Not covered:** mina, Animate mode, other viewports, Soft selection, the presets, Scale/Rotate on points, Mirror and Set value for weights, the Subtract brush.
- **Errors:** no page or console errors in any run.

## Task log
1. **Warp a part, keyed to a slider: done with friction.** New parameter (+, Enter, type the name, Enter), choose face, D, open Deform, the add
   icon. Then a key at 1 (5 point drags; a row picker exists) and a key at -1 (5 drags). Scripted, about 8 s and about 16 actions.
   - In-betweens at 0.5 and -0.5 are exactly half. Mirror "Left to right" works and says "Mirrored the left half of the lattice onto the right." Smooth works.
   - The first attempt used `lean`, which also turns the body, so the lattice rotates under the pointer and drags at -1 missed (the tester's choice of slider, not a bug).
   - Stalls: MD-4, MD-5, MD-6, MD-7, MD-8, MD-10.
2. **Group warp over several parts: done.** Ctrl-click 3 parts, D, then "One lattice over the 3 selected parts…" (5 steps). A useful note warns
   that the members sit on different bones. A drag at lean=1 bends all three, and 0.5 gives half. Stall: MD-9.
   - **On the pad:** you can choose the group target, move the pad dot and see `head_warp` bend. A lattice drag is refused with a clear line. But the studio's own advice leads to a wrong result (MD-1).
3. **Free mesh and weights: done with friction.** Weights (B) on a part with no mesh opens Deform's Mesh row; Generate mesh gives 24 vertices.
   - Edit topology's six tools have clear tooltips. Add, move and delete work, and the undo count is right (24 → 25).
   - Generate mesh throws you into the Warp tool (MD-3). After B again: Bind ▾ arm_r and forearm_r, Auto-weights ("Weighted upper_r's mesh from 2 bones (blend 20 px)"), 3 Add strokes, Test pose Rotate.
   - The upper arm's lower end bends with forearm_r, and Apply saved the mesh with weights and `defaultBone` arm_r. About 12 steps. Stall: MD-13.
4. **Mask: clip done; keying blocked.**
   - Clip: mouth, M, the New shape icon gives "Added shape mouth_mask and clipped mouth to it." The ⚠ correctly flags that the shape is not in `head_warp`. Clipping shows correctly with "The whole character" chosen (MD-12). Dragging a point, undo ("Undo: mask shape mouth_mask") and Apply all work.
   - Keying: Bind to parameter… → breathe makes empty keys at 0 and 1. A drag at a key then moves the rest outline (MD-2).
5. **Gizmo and view: done with friction.**
   - Unbound part: the locked gizmo shows a dashed square with no handles, and the line says how to bind. Understandable, but the line is cut off (MD-6).
   - Bone arm_r at arm_r_lift=1: a 300° rotate drag gives rot 70 → 370.0351, with undo and redo exact. W and R tags read "poses arm_r · a drag writes its keyform of arm_r_lift".
   - Wheel, middle-drag, Space+drag (writes nothing), F and Shift+F all work.
   - Stalls: MD-11, MD-15, MD-4.
6. **Apply, Close, reopen: done.** `face_warp` survives two reopens with keys 0 and 1, and the Target reads "own warp face_warp". Closing after
   only moving a slider asks nothing (good). Undo exists in every tool, but the labels are generic (MD-10).

## Findings
**MD-1 · S2 · usability · On a pad, the warp message contradicts the sample and its advice silently adds a second, additive keyform**
- Steps: choose a member of `head_warp`, D, move the head_turn dot to a corner.
- What happened:
  - The bar says "Warp · eyes · head_turn is a pad, and a lattice drag keys one slider: click a slider's name".
  - Keyforms says "A warp is keyed to one slider, not to a pad: make head_x or head_y the active parameter." But this very warp is keyed to the pad, and the stage shows it bending.
  - Following the advice (click head_x, drag) gives "Added a key of head_x at 1 to head_warp: the drag was between keys." rig.json then holds `[{"params":["head_x","head_y"]},{"param":"head_x","keys":[0,1]}]`: a second layer that adds to the grid and also applies at head_y=-1. Nothing warns about this.
  - Keyforms never says that `head_warp` already has a `head_turn` grid that is shown but cannot be edited here.
  - An unlabelled "Grid on a pad 2×2 / 3×3 / 5×5" select sits above the warp text with no tooltip; it is unclear whether it acts on the pose or the warp.
- Expected, until the plan in warp-pad-grid.md lands: say "head_warp is keyed to head_turn's grid, which the studio shows but cannot edit yet", and don't recommend a single axis, or warn that a head_x key adds on top.
- Reproduced 3 times. Known: the missing editing is known (warp-pad-grid.md); the misleading advice is not.

**MD-2 · S2 · bug/usability · Mask keying is a dead end, and the hint line says the opposite of Keyforms**
- Steps: mouth, M, New shape, Bind to parameter… (dialog "Bind mouth to a parameter"), tick breathe, "Bind 1", breathe=1, drag a corner.
- What happened:
  - The status line says "Click the outline of a shape … (Bind parts… keys its points to the active parameter), then drag its points at each key".
  - Keyforms says "The keys of mouth_mask on breathe reshape it; they are written in rig.json. The Mask tool (M) edits its rest outline".
  - The drag moved the rest polygon. rig.json: `"polygon":[[242,380],[298,380],[309,404],[242,395]],"keyforms":[{"param":"breathe","keys":[{"at":0},{"at":1}]}]`, so the keys are empty and can never be filled in the studio.
  - The dialog says "mouth" although it binds the shape.
  - Without binding, a drag at breathe=1 did nothing and said nothing (seen once).
- Expected: either a drag at a key writes the key, or the hint, and Bind for shapes, say that shape keys are written by hand.
- Reproduced twice. Known: docs say polygon keyforms are hand-written; the misleading hint is new.

**MD-3 · S2 · usability · Generate mesh, offered by the Weights tool, switches the tool to Warp**
- Steps: choose upper_r (or upper_l), B (bar "Weights · no mesh chosen"), Generate mesh.
- What happened: the bar becomes "Warp · upper_l · click a slider's name in Parameters, then drag the points…". The Skin block stays folded and the brush is gone; you must press B again.
- Expected: stay in Weights, with the mesh ready to bind (the docs describe this as the Weights path).
- Reproduced 3 times. Known: no.

**MD-4 · S3 · usability · The active parameter and the chosen part keep dropping each other**
- Clicking `lean` then `face` gives "face › no parameter".
- Setting arm_r_lift's value (with upper_r chosen) gives "no part".
- So the Warp tool works only part first, then the parameter. The docs' "parameter first" order loses the parameter at the first click.
- Known: no.

**MD-5 · S3 · usability · Notes about keys are wrong**
- On a warp with no keys: "Added a key of lean at 1 to face_warp: the drag was between keys."
- At -1 with keys 0 and 1: "the warp of face at -1: between keys, a drag makes a key". Same pattern for head_x on head_warp.
- Known: no.

**MD-6 · S3 · usability · Key instructions are cut off at 1600 px wide**
- Tool bar: "Warp · face · click a slid…", "Warp · face · head_turn …", "Weights · no mesh chos…", "Weights · Add on forear…". The full text exists only as a tooltip.
- Breadcrumb: "fa… › le… @ 0 · no key here: a drag adds o…".
- Move/locked line: "…(a click on a name would choose the paramet…".
- Status: "…Esc again c…".
- Known: no.

**MD-7 · S3 · usability · A pose legend appears for warps and shapes**
- "x, y: fractions of the stage · rot: degrees · sx, sy: added to 1 … opacity: 0 to 1" shows under Keyforms › Warp and › Shape, where there are only dx/dy points. Known: no.

**MD-8 · S3 · usability · Deform is misleading for a part that has only a group warp**
- "face is bent by this group's lattice after its own warp." appears when face has no warp of its own.
- Target ▾ lists only the group.
- The add icon's tooltip, "A lattice over face's image: dragging its points…", describes the result instead of saying "Add warp to face" as the docs do.
- Known: no.

**MD-9 · S3 · usability · A group made from ticked parts is named after the last one ticked**
- The new group is `hand_l_warp`, though upper_l is the chosen part. The docs say the first member is the one a drag is measured in, yet the members list reads hand_l, lower_l, upper_l. Known: no.

**MD-10 · S3 · usability · Undo names the object, not the operation, and Smooth gives no note**
- "Undo: deformer face_warp" is the same for a point drag, Mirror and Smooth.
- "Undid: deformer upper_r_mesh" for a topology delete.
- Smooth left no status note, while Mirror does (seen once).
- Known: related to the "undo says what it changed" work.

**MD-11 · S3 · usability · The view re-fits by itself while posing**
- Robo's centre moved from x≈780 to 845 after arm_r_lift=1 and choosing a part, then from 845 to 795 after a rotate, at an unchanged 70%.
- The next click landed on lower_r instead of upper_r.
- Reproduced twice. Known: no (same as MR-5).

**MD-12 · S3 · usability · Dimming hides a dark chosen part**
- With mouth chosen (Move or Mask), the face behind it is dimmed, and the dark smile and its new clip become invisible. You can't see the clip while editing the mask.
- It shows only with "The whole character" chosen. Known: no.

**MD-13 · S3 · usability · Feedback for topology and weights is thin**
- In Edit topology the status line keeps the generic warp hint; the mode shows only in tooltips.
- The weight heat is coloured vertex dots only. After Auto-weights, forearm_r shows almost nothing, so it is hard to read where you have painted.
- Known: no.

**MD-14 · S3 · usability · Rotate gives no angle readout during a drag**
- The rot field updates only on release, to 370.0351 (4 decimals). On the stage, 370° looks the same as 10°. Known: no.

**MD-15 · S3 · usability · The locked gizmo does not point to the bone**
- On unbound upper_r, Rotate is locked with "upper_r is bound to no parameter…", although its bone arm_r is bound to arm_r_lift. The line does not suggest choosing the bone (Alt-click), which is the route that works. Known: no.

**MD-16 · S3 · bug · Keys typed while the Parameters + menu is open reach the stage shortcuts**
- Typing "squash" right after + turned on the Pivot tool (the q). Seen once. Known: no.

## What works well
- Lattice keying on a slider: an automatic rest key, exact in-betweens, key strip, ‹ › navigation, Remove this key; saved and reopened intact.
- Mirror note; Edit topology tooltips; Auto-weights note; the Rotate test pose bends the skin with nothing keyed.
- The group-warp warning about members on different bones; the clip ⚠ for a shape that is not a group member.
- Rotate past a full turn (+300° → 370) with exact undo and redo; Space+drag pans without writing anything; F and Shift+F.
- Close after only moving a slider asks nothing; Apply's note says it is undoable in the editor tab.
