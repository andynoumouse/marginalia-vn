# Parameter-driven animation studio

Status: proposed 2026-11-05, not started. The model below is designed (parameters, poses, physics, frame tracks, gizmos);
the Open questions still need answers before any code. Backward compatibility is not required: the rig.json and
animation formats may change freely.

The goal is a more Live2D-like animation studio for layered characters: named parameters (sliders and 2D pads) drive
morphs, mesh warps, transitions and part transforms, and the timeline keys those parameters. The studio can also run on
its own, outside the game editor.

It builds on the rigid-part rigs and the studio (now Model | Animate, see [studio-ux.md](studio-ux.md)) described in [rig-formats.md](rig-formats.md),
[rig-hierarchy.md](rig-hierarchy.md) and [studio.md](studio.md), and on the mesh-warp item in `TODO.md`.

## Goals

1. Parameters as the main way to pose a character: 1D sliders and 2D pads, each with a name, range and default.
2. Keyframing parameters on the timeline, with easing.
3. Mesh-warp deformers (hair sway, breathing, cloth) driven by parameters, drawn with Pixi 8 `MeshPlane` / `MeshRope`.
4. Masking of parts and morphs (an iris clipped to the eye, a mouth interior), with animatable mask shapes.
5. A viewport with zoom and pan, on the stage and the timeline, and bone gizmos to pose a bone directly on the stage.
6. Named poses (snapshots of some parameters) and script control: set or tween parameters and poses from a script.
7. Secondary motion: physics chains for hair and cloth that read and write parameters.
8. Frame-by-frame animation: stepped tracks over a slot's variants.
9. A standalone studio with no script or game logic, able to export movies, so animators never meet the game side.

## Non-goals

- Embedding Live2D (Cubism Core is a proprietary WASM runtime; the Pixi wrappers target Pixi 6/7).
- Compatibility with existing rig.json files or `animate` data. Existing sample rigs get converted by hand or by a
  one-off script.
- Importing or exporting Live2D files.

## Model

### Parameters

- A parameter is a scalar with `id`, `min`, `max` and `default`, optionally grouped (Eyes, Mouth, Body).
- A **slider** is the 1D control for one parameter. A **pad** is a 2D control bound to two parameters (head turn X/Y,
  eye look X/Y, mouth shape). A pad is only a UI grouping: both axes stay ordinary parameters, so timeline tracks and
  the file format need no 2D type, and a key on a pad is a key on each axis.
- Parameters can be bound to runtime input later (pointer, a scripted target), which is how an eye-look pad follows the
  mouse in the game.

### Keyforms

- A target (a part transform, a mesh's vertices, an opacity, a mask) stores authored poses at chosen parameter values
  and blends between them: linearly for a slider, bilinearly on the grid for a pad (the 3x3 head-turn case).
- The same part may be affected by several parameters. Open question: how those combine (see below).
- A part key in the old sense (rotate this part to 30 degrees at 0.5 s) becomes a key on an auto-generated parameter for
  that part's transform. One animation channel, one keyframe format, one kind of timeline track. Leaning this way
  because compatibility is not a constraint; the cost is a larger rewrite of the studio, `animate` and rig.json.

### Poses and script control

- A **pose** is a named snapshot of parameter values stored in the rig (`happy = {mouth_smile: 1, brow: 0.7}`). A pose
  may cover only some parameters (a face pose leaves the body alone), so poses layer. Animators author one by posing and
  saving it; scripters use the name and never see slider values.
- Scripts can set parameters directly or through a pose, and either one can be tweened:

  ```
  show robo pose=happy
  animate robo look_x=0.6 mouth=0.8 over 0.4
  animate robo pose=sad over 0.5
  ```

  Each parameter interpolates linearly (with its easing) from its current value to the target; parameters not named
  stay where they are. Because keyform blending is itself linear, a straight tween between two parameter sets always
  gives a sensible in-between pose. The exact syntax is settled at planning time.
- A straight blend is not always right (a rotation swinging the long way round, a mouth shape that looks wrong halfway).
  Per-parameter easing handles most cases; a transition can also pass through an intermediate pose.
- Poses double as expression presets.

### Mesh warp and masks

- Warp deformers attach to a part: a lattice (`MeshPlane`) or a chain (`MeshRope`). Their control points are keyform
  targets of parameters.
- A mask clips one part to the shape of another (or to a drawn polygon). The mask shape can itself be a keyform target.
  Built as stencil masks (see **Masks, as built** below); the cost per frame is the one open question.
- Draw order and visibility can also be keyform targets (an arm passing in front of the body).

#### Masks, as built (2026-11-07)

The format and the reference are in [rig-json.md](../rig-json.md#masks); the pure parts are `engine/src/masks.ts` (types, `checkMasks`,
the silhouette trace, bending a shape with a warp) and `mask-edit.ts` (the studio's edits), the renderer is `preview/pixi-renderer.ts`
(`buildMasks`, `applyMasks`), the studio `editor/anim-mask.ts`. What was decided and why:

- **Shapes are named parts (changed after the first build).** The first build kept a `masks` list in rig.json, in the style of
  `deformers`: `{ id, part, from | polygon, on?, keyforms? }`, one mask per part. A polygon on a bone was never warped, so it could not follow
  a head warp, and a shape had no name to select, reuse or put in a group warp. Now a shape is an imageless entry of `parts`
  (`eyelids: { bone?, follow?, polygon, keyforms? }`) and a clip is a link on the clipped part (`eyes: { clip: "eyelids" }`; `clip` names a
  shape or a part with art, which replaces `from`). `follow` takes the place of `on` a part; a shape on a `bone` follows only that bone.
  Shapes are not in `order` and have no layer, so a PSD re-import (`mergeRig`) never lists them missing or adds them. The `masks` list is gone (alpha: no
  compatibility reader; `checkRig` reports a leftover one): `normalizeMasks` (engine/src/masks.ts) reads shapes and clips from `parts`, `maskView` gives them as
  the one-MaskDef-per-clipped-part list the renderer works with (`shape` names the shape it was read from), and `writeShapes` puts the studio's shapes and
  clips back as shape parts and `clip` links. The studio edits the shapes and clips directly (see **Studio** below), so a shape that clips several
  parts is one shape. Shapes are members of group warps (built): the lattice is added to the shape's keyform-shaped points at their canvas position, a shape that follows a
  member of the same group is not bent twice, and `checkRig` warns when a clipped group member's clip source is outside the group
  (docs/design/mesh-warp.md, Group warps). Robo's `eyelids` is in `head_warp`.
- **Two shape sources.** A `from` part gives its silhouette: the renderer reads the part's alpha (at most 256 px on the long side, once
  per texture), keeps the opaque blobs above half alpha, traces their outer outline and simplifies it to at most 64 points
  (`traceOutline`). A stencil mask drawn from a Sprite would be its whole quad, so the outline has to be a polygon; Sprite alpha masks
  are avoided as the task asked, since they need render textures. A drawn `polygon` is in PSD canvas pixels like pivots.
- **"The shape is a keyform target" means its points.** A polygon's vertices take `DeformerKeyform`s (`pts` per vertex, the unit and the
  evaluation of a lattice: `evalPointKeyforms`, which `evalDeformer` now shares), so a parameter reshapes it (the eyelids close on
  `eye_open`). Where the shape sits comes from what it follows: a `from` part's whole transform and warp, or a polygon's `on` bone or part
  (a bone's world matrix from `placeRig`; a part's container; a warped part bends the polygon through its lattice with `warpPoints`).
  A mask is not a keyform target of its own transform: put the polygon `on` a bone and key the bone.
- **Where a stencil lives.** Pixi 8 masks any container with a `Graphics`: the shape hangs in the container of the part it follows (or a holder
  placed with a bone) and is `mask` of the clipped part's container, so draw order, bones and animation need no new code and the shape is
  redrawn only when its own parameters or its frame part's warp changed. A part clipped by a clipped part gets the second shape on its image
  (`container.mask` and `sprite.mask`: nested stencils, one level). Variants are rebuilt by `dress()` like everything else; a `from` part's
  outline is traced per variant texture and cached.
- **Hidden source, hidden part.** When a look hides the `from` part (or the `on` part) there is nothing to clip to, so the clipped part is
  hidden: an iris beside no eye should not float.
- **Studio (shapes as parts).** The working copy holds `shapes` (name to `{ bone?, follow?, polygon, keyforms? }`) and `clips` (clipped part to its
  shape or part) in place of the old one-mask-per-part list (`StudioDoc`, engine/src/studio-doc.ts); `studioWrites` writes them with `writeShapes` into `parts`. The pure edits are in `engine/src/mask-edit.ts` on a `ShapeSet` (shapes, clips and the deformers, since a group lists shapes as
  members): `addShape`, `renameShape` (every clip and group member follows; the name is unique among parts, bones and shapes), `deleteShape` (clipped parts are
  freed, the shape leaves its groups, the note says so, nothing is asked), `setClip` (the `checkMasks` rules), `moveShape` (bone, follow), `clipGroupIssues` and
  `addToGroup` (the group warp warning and its fix). A shape has a row in the Parts tree (editor/anim-tree.ts, under **Shapes**); choosing it, or a part clipped
  to it, makes the Mask section (editor/anim-mask.ts) and the Mask tool edit it. The stage (`studioMasks { shapes, clips }`, `studioMask { shape, part, tool, point }`)
  draws a shape that clips nothing too (the renderer's `maskView(..., unclipped)`: a node that is never a mask), outlines every shape with the Mask tool, and picks
  one on a click within 8 screen pixels of its outline (`shapeAtEdge`), or inside it where no part's art is hit (`shapeAtInside`); the answer is the ordinary
  `studioSelect`. The renderer keeps the studio's shapes and clips and puts them back whenever `studioPivots` replaces `parts`. The bone gizmo and the pivot tool
  ignore shape rows. Binding a shape's points to a parameter (Mask tool) is keyed by shape name (`bindMask`, `unbindMask`; a part clipped to a shape binds that
  shape). The keyforms of a polygon are hand-written for now.
- **The cost is a guess.** Nobody has measured stencil masks on a low-end phone, which this design wanted before committing to them. The
  safeguards are cheap ones: `checkRig` warns above 8 masks on a character, the renderer logs the same, the count is in the debug console's
  `memory`, in `vnStage()` and in the browser tests, and the shapes are drawn only when dirty. TODO.md has *Measure stencil masks on a low-end phone*;
  if the result is bad, the fallback is to bake a clip into the part's texture when it does not move against its source, or to keep the first
  nested level only.
- **Not built:** soft alpha masks, inverse masks, holes in a traced shape, a studio editor for a polygon's keyforms, a shape's own transform as a keyform target.

#### Keyform authoring, as built (2026-11-07)

The pure parts are `engine/src/keyform-edit.ts` (writing a pose into a keyform, ticks, pad grids) and `param-edit.ts` (creating, renaming,
re-ranging and deleting parameters and pads); the studio side is `editor/anim-params.ts` (the controls, the editors) and `editor/anim-studio.ts` (the drag
handler); the user-facing description is in [rig-json.md](../rig-json.md#authoring-keyforms-in-model-mode). This section is the data side and what holds for any
authoring flow; the flow itself (the parameter is picked first) is the next section. What was decided and why:

- **Cubism's split, kept strict.** Model writes `keyforms` (and `parameters`, `pads`); Animate writes `animations`. A gizmo drag in Model mode never
  writes an animation key and a drag in Animate mode never writes a keyform, so the same gesture means the same thing as in Cubism: Model "this
  parameter at this value looks like this", Animate "this parameter moves to this value at this time".
- **The pose on show plus the drag.** The stage reports a drag as a change (`Offset`) on top of the pose it showed. The write adds that change to the
  form stored at the spot, or, where no key is, to what the keyform gives there now, so the first drag at a new value starts from the pose the
  author saw and a new key never changes the curve elsewhere. Scale multiplies across keyforms (the Decisions below), so the scale part of the change
  is divided by what the target's *other* keyforms contribute; then `pose after = pose before + drag` holds with several keyforms on one target
  (a node test checks it).
- **Snapping, not exact matching.** A slider within 2% of its range of a key edits that key, and the slider then moves onto the key; a new keyform
  near the default writes at the default. Exact matching would make a drag at 0.99 create a key beside the one at 1 on most real slider positions.
  A pad always writes the nearest grid corner (a drag that hit "nothing" would be useless on a 2D control), and its dot moves onto that corner, which
  is why **+ column** / **+ row** exist (a corner exactly where the author wants one).
- **A new keyform comes with a rest key at the parameter's default** (as the warp editor's does): a lone key would hold its pose at every value.
  A new pad keyform is a grid of min / default / max on each axis, every corner at rest.
- **Which parameter a drag writes to is explicit**: the active parameter (next section), which stays while the author moves from part to part, as in the Cubism
  workflow (set head_x to 1, then pose the head, the hair, the eyes). A first version guessed it (the control used last, else the one that drives the chosen part);
  that is gone. A pad's axes can be made the active control alone (the sample's head has one-parameter keyforms on
  both axes of its pad), because a pad is only a UI grouping.
- **Parameters are a document, not a list.** A name is used by keyforms, pads, poses, animation tracks, deformers, masks and physics chains, so
  `param-edit.ts` takes all of them (`ParamDoc`) and a rename or delete reaches every one; scripts are not part of the document and are only warned
  about. A shrunk range moves or drops what it no longer holds rather than leaving rig.json with keys `checkRig` rejects. A parameter a physics chain
  uses cannot be deleted (a chain would silently lose an input).
- **A renderer fix found on the way.** The game's per-frame stepping (`PixiRenderer.stepFx`) also ran in the studio and posed every part from the
  *default* parameter values each frame, over what the studio had posed, for any rig with keyforms: a pose the author set (a slider, a drag) was
  drawn for one frame and then replaced. The studio now poses actors only through `studioPose`.
- **Not built:** curves between keys other than linear (the blend is linear, as it is in the game), mirror / copy of keyforms between parameters or parts,
  editing opacity with a handle (it is a field), keyforms of a target other than a bone or part (mesh points are the Warp section's), and selecting several
  parts to pose at once.

#### Parameter-first authoring in Model mode (as built, 2026-11-07)

The authoring flow is parameter first, as in Live2D Cubism: pick the **parameter**, then the parts it moves, and each part gets its keys at once ([studio-ux.md](studio-ux.md) has the two modes). The pure parts are `engine/src/param-bind.ts` (binding, unbinding, which parts are bound to a parameter, which parameters move a part, key
ticks) with its tests; the studio side is `editor/anim-bind.ts` (the block under the controls), the Model branches of `editor/anim-params.ts` (the active row, the ticks, the pad's
corner snap), `editor/anim-tree.ts` (the bind ticks) and `editor/anim-studio.ts` (picking, binding, the drag). The user-facing description is in
[rig-json.md](../rig-json.md#authoring-keyforms-in-model-mode). What was decided and why:

- **The active parameter is the only target.** `activeControl` is set by a click on a row (or on a name, by keyboard) and by nothing else: not by the last control used, not by
  the parts' drivers. The row is highlighted and a block under the list names it. A part-first convenience stays as a *view*, not a decision: choosing a part lists the
  parameters that move it (**Moved by**), and a click on one makes it active. That is the only place the part leads to a parameter.
- **A pick binds, and binding makes the keys.** A bound part has a keyform of its own for that parameter, with a key at the minimum, default and maximum (the "Add 3 points" of Cubism),
  or, for a pad, a grid of 2 × 2 (the ends), 3 × 3 (and the default) or 5 × 5 (and halfway between each two), every key at rest. At rest is deliberate: binding changes nothing on the
  stage, so it cannot hurt, and the keyform is valid data (a rig may hold bound parts that were never posed; `checkRig` is happy with it). The default is a line on every grid but
  2 × 2, because the rest pose there is what the ends are posed against.
- **What a pick binds depends on the tool.** With Move, Rotate or Scale on, a pick binds the part's *pose* (the bone it sits on, as when a click
  chooses it); with the Warp tool on, its lattice (`deformers`); with Mask, its drawn polygon (`masks`). The three have the same keys and the same list; only a slider can be the
  parameter of a warp or a mask, as in their own data. A pick on something already bound is a plain choose, so a second click does not unbind; the ✕ in the **Bound parts**
  list and Ctrl+Z are the ways back (the tree's mark is a display). A drag with the gizmo on a part that is not bound writes nothing and says to bind it: binding is its own verb.
- **A click only selects; binding is a verb.** A click on the stage or a row never binds. **Bind parts…** (with a parameter in focus) opens a checklist of the parts in the right column and binds the ticked ones;
  **Bind to parameter…** (with a part in focus) opens a checklist of parameters. Esc closes it. The stage and the left lists only choose the focus.
- **One focus.** The studio keeps the active parameter and the chosen part, and reads them as one focus (`engine/src/studio-focus.ts`): a parameter alone, a part alone, or both
  when the parameter moves the part (by pose, warp or mask, whichever tool is on): the keyform, shown as a breadcrumb at the top of the block. Choosing a part or a parameter keeps the other
  only when they are paired like that, and otherwise replaces it. A gizmo or Warp / Mask point drag writes
  only into a keyform (a part with no parameter writes nothing and says what to do); a drag at a value with no key adds the key.
- **Overlapping parts.** The stage reports every part under the pointer (`studioHitAll`), and clicks on one spot (within 4 px) walk through them front to back, wrapping; the status line says
  "Arm_L, 2 of 3. Click again for the next."
- **Keys are removed, the keyform stays.** The keyform is the binding, so **Remove this key** only takes the key out (a pad corner goes back to rest), and the key at the default goes
  back to rest instead of out. **Unbind** ends the binding and takes every key of it.
- **One palette.** Every slider and pad is in the Parameters section. The Warp section has no parameter select or slider of its own: its keys are
  the active parameter's, and its key buttons put that parameter's slider on the key. The list of controls scrolls inside its own box so the block under it stays in view.
- **Animate and Model are the two modes.** `StudioMode` is `model | animate`. Pivots, bone
  editing, the Pivot tool, physics and "By itself" are Model's; the Warp and Mask tools and the gizmo drag work parameter first.
- **Not built:** posing several parts at once (a pick adds one part), copy / mirror of a part's keys to another
  part or the other half of a pad, binding a whole bone subtree with one pick, and the corner buttons a pad could list the way a slider lists its keys.

### Physics (secondary motion)

Most of what reads as alive in a Live2D model is secondary motion: hair and ribbons swinging when the head turns,
cloth settling, a body that breathes. Rigid parts on bones cannot fake it, so physics is a planned part of the model,
built after parameters and mesh deformers (see Suggested order). It adds no new kind of data to the rest of the model:
a physics chain reads parameters and writes parameters.

- A **physics chain** lives in the rig next to the parameters. It has **inputs** (parameters or bone channels, such as
  head angle X, head angle Z, body sway, each with a weight and an optional smoothing), a pendulum of 1 to N **segments**
  (length, mass or inertia, damping, stiffness, a limit on the swing angle) and one or more **outputs** (a parameter such
  as `hair_sway`, with a scale and a range). The output parameter is an ordinary parameter, so keyforms, mesh warps
  and bones respond to it as they do to a slider.
- Input motion drives the simulation, not the input value: a head held at 30 degrees pulls the hair once and then it
  settles. The simulation sees the change per step, plus an optional wind term (a constant or noisy force) for hair that
  never rests.
- Physics is **additive and last**: the pose and animation set the parameters, the chains then add their outputs on
  top, and the result goes to the deformers. An animator can still key an output parameter by hand; a chain flagged
  `off` in a pose or animation is bypassed, for a scripted effect that needs the hair still.
- The simulation is a **pure function** in `engine/src`: `stepChain(chain, state, inputs, dt) -> state`, run at a fixed
  timestep (for example 60 Hz) with the remainder carried over, so the result does not depend on the frame rate. No
  DOM, no randomness (wind noise is a function of time and the game seed), so a node test can step a chain and assert
  the swing, the decay and that two runs agree.
- **Instant mode, skip, rollback and loading:** these jump the story without drawing the frames in between, so physics
  state is not part of `DisplayState` and is not saved. After a sync the chains start at rest with their outputs at the
  input's current rest value, and settle in the first few frames if the pose is off-center. Game state and saves stay
  independent of the simulation, and the same scene always looks the same once it has settled. In skip mode the
  simulation is paused and the chains rest.
- **Studio:** a Physics panel lists the chains. It shows the inputs, the pendulum and the outputs, with a preview mode
  that lets the animator shake the head parameter (a slider drag, or a button that plays a back-and-forth) and watch the
  hair respond. Presets (long hair, short hair, ribbon, cloth hem) give a starting point; the numbers are tuned by eye.
- **Cost:** a chain of a few segments is a handful of multiplications per step, so the cost is dominated by the mesh
  deformation it drives, not the simulation. Chains of a character that is off stage are not stepped.
- **Not planned:** collision between chains or with the body, cloth as a 2D grid and any solver heavier than a damped
  pendulum or spring chain. A hem or sleeve is a short chain driving a warp, which is what Live2D's physics does too.
- **Interim:** until deformers exist, a chain's output can drive a **bone rotation** directly (a hair part on a bone, as in
  rig-hierarchy.md). It looks stiff, but it settles the format and the studio panel in advance; the mesh warp then
  improves the look without changing the data.

### Timeline

- Tracks are parameters. Keys carry a value and an easing; a curve editor view per track is wanted.
- Named animations keep playing from scripts (`animate`); parameter and pose control from scripts is described under
  Poses and script control.

### Frame-by-frame animation

Hand-drawn frames (a walk cycle, a hair flick, a hand wave) are a slot whose variants are the frames. The slot model
already supports this (see rig-hierarchy.md: `speak` cycles a mouth slot's variants, `blink` swaps one in), so the
studio only needs a way to key it on the timeline.

- **A frame track is a stepped track.** It targets a slot and its keys carry a variant name instead of a number. The
  variant holds until the next key; there is no blending and no easing. A key with `none` hides the slot for a while.
- **Not a parameter.** Parameters are scalars that keyforms blend, and a variant has no in-between. Keeping frame
  tracks a separate kind avoids inventing an integer parameter whose "in-between" values mean nothing. The timeline
  shows them as a row of blocks (one per held frame, with a thumbnail) instead of a curve.
- **Clip shorthand.** Besides single keys, a track may be a sequence: `{ "slot": "walk", "frames": ["01", "02", "03",
  "04"], "fps": 12, "loop": true }`. The studio expands it to keys on edit, and the runtime plays it as is. Order and
  timing live in the clip, not in the variant names, so a frame can be held, repeated or played ping-pong.
- **Authoring.** Frames come from the PSD as variants of one group (`walk/01`, `walk/02`, ...). The studio offers
  "frames from this slot": it fills the track with every variant at a chosen fps, and the animator then drags blocks to
  retime, duplicates a frame or reorders. Onion skinning (see Later) shows the neighbouring frames faintly.
- **Position.** A variant swap does not move the bone (variants are placed in the PSD), so frames must be drawn in
  place. Travel (a walk across the stage) comes from keys on a bone or the character, running beside the frame track.
- **Precedence.** While a clip plays it owns the slot. The same rule as `speak` and `blink` applies in reverse for
  script overrides: an explicit `slot=variant` on a `show` line is the slot's value before the clip starts and after it
  ends, and the clip wins in between. Two frame tracks on one slot are an error.
- **Loading.** Every frame is a texture and all of a clip's frames load with the character. Long sequences need a
  packed spritesheet per slot (the asset-loading work, TODO.md); until then keep clips short.
- **Instant mode and skip:** the frame shown is a function of the clip time, so a sync lands on the right frame with no
  state to save.

## Studio

- **Viewport:** wheel zooms toward the cursor, middle-drag or space-drag pans, a key fits the view. Pivot handles, mesh
  points and mask outlines keep a constant on-screen size when zoomed. The timeline zooms and pans too.
- **Bone gizmos:** today the stage only places a pivot (a click or a drag of the pivot handle). Bones and parts should
  also be posed directly on the stage, as in Spine and Inochi Creator:
  - Select a bone by clicking its handle or its part (the hit test picks the topmost part whose pixels are opaque
    under the cursor, then maps it to its bone), or in the bone tree; the selection is shared between both.
  - A bone draws as a line from its pivot to its children's pivots, with a handle at the pivot. Three tools, switched by
    keys (for example W move, E rotate, R scale): **move** drags the bone in its parent's space, **rotate** turns it around its
    pivot with a ring handle (shift snaps to 15 degrees), **scale** stretches it from the pivot with axis handles
    (shift keeps the ratio, alt scales from the center).
  - In Model mode (Rig, then) a drag on a bone that a parameter drives edits that parameter's keyform at its current value, and the
    panel says which one; the pivot is placed with its own tool. In Animate mode a drag writes a key (or updates the key
    under the playhead) on that bone's transform channels; with auto-key off, the drag only previews and a key button
    commits it, so a stray drag cannot ruin an animation. (Both are built, see Keyform authoring, as built.)
  - Children move with the parent through the tree (see rig-hierarchy.md, Transform composition), and the gizmo is drawn
    in the bone's own space so a rotated parent gives a rotated gizmo. Local space and world space are a toggle.
  - Handles keep a constant on-screen size under viewport zoom (see above), and the cursor and handle highlight
    show which tool and axis a drag will use.
  - Every drag is one undo step, numeric fields beside the stage show and accept the exact values, and the stage
    redraws as the drag goes so the result is the real render, not an outline.
  - Needs: the hit test (an opacity lookup on the part texture, in the editor and not in the engine), the gizmo drawing
    (an overlay above the Pixi stage), and one pure function in `engine/src` that turns a pointer movement into a
    bone's new local transform given its parent's world matrix, which node tests can cover.
- **Parameter panel:** sliders and pads, grouped, with a key button per control and a reset to default (built; in Model mode it also
  authors keyforms and edits the controls, see below).
- **Mesh and mask editing:** edit control points on the stage, with the active parameter shown so a keyform is authored
  at a known value.
- **Undo/redo, copy/paste of keys and poses** across the whole studio.

## Standalone mode

- The studio runs without a game project: open a character folder (PSD output, rig.json), edit, save. Built (see **Standalone, as built** below).
- Export a movie (webm or mp4; a PNG sequence with alpha as the lossless option) of a chosen animation, with fixed
  frame rate, size and background. The PNG sequence is built (see **Movie export, as built** below); webm / mp4 are not.
- The game editor embeds the same studio. Nothing in the studio may depend on scripts, the compiler or game state.
- Packaging: both. A page of its own, served by the dev server, and Marginalia Studio's **Open Character...** that opens that page on a chosen folder.

#### Standalone, as built (2026-11-07)

The user-facing description is [standalone-studio.md](../standalone-studio.md); the code is `editor/studio.html`, `studio-page.ts`, `character-store.ts`
and `studio-host.ts`, `engine/src/character-folder.ts` and `studio-doc.ts`, the `hosted` mode of the stage page (`preview/preview.ts`), the dev
server's studio-only mode and the Studio's `character:*` bridge (`studio/main.cjs`, `preload.cjs`). What was decided and why:

- **One studio, two hosts.** The studio (`AnimStudio`) never reached for scripts through anything but `StudioHost`, and most of that was already
  optional (`scene`, `tryInScene`, `insertLine`, `positions`, `anchors`, `outline`, `image`). What was left became one optional member,
  `StudioHost.standalone`: the stage's source (see below), the Save button's name and messages, an `open` action (which also means "no Close, Esc
  does not leave") and the sections the host has no use for (`place`). `apply` may return a promise, since a folder write is asynchronous.
  The two things the editor did inline with its rig.json tab are shared: `studioDocOf` (parsed rig.json to the studio's working copy) and
  `studioWrites` (working copy to the properties `writeRigText` rewrites, keeping the file's layout and unknown keys), and `manifestHost` (parts,
  looks, slots, outline from a manifest). The editor and the page build the same `Snap` and the same writes, so they cannot drift.
- **A page, not a second app.** `editor/studio.html` follows `help.html` (a page of the editor folder with its own script), so it needs no new served
  prefix, keeps relative URLs, and the studio's CSS moved from `index.html` to `studio.css` that both pages link. Marginalia Studio does not
  get its own copy of the code: **Open Character...** picks a folder, starts the dev server with `VN_STUDIO_ONLY=1` (no project, no watchers, no
  PSD converter, every `/api` route answers 404) and shows `/editor/studio.html`; `vn character` does the same in a terminal.
- **The stage draws from the host's files.** The stage is still the preview page in studio mode in an iframe, so the renderer code is the same.
  With `&hosted` it does not fetch `/api/project` and does not listen for `/__events`: it asks its parent (`studioProjectRequest`) and gets
  `studioProject`: the asset list, each file with a `url` (`AssetFile.url` overrides `assets/<file>?v=`; the page makes `blob:` URLs from the
  folder's files) and the manifest. A folder the browser picked has no server route, and the same-origin iframe can load its parent's blob URLs.
- **Reading a folder is pure logic.** `scanFolder` decides what the folder holds (a layered character, a flat one, several to choose from, nothing)
  from its paths; `standaloneChar` builds the manifest and asset list by presenting the files as `assets/char/<id>/...` to the game's own
  `projectFromListing`, so the manifest, the `rig.json` attachment and the flat-character rule are the game's, not a copy. A flat character with no
  `default` image gets an alias asset for its first pose, so the stage has something to draw.
- **A store per kind of folder.** `CharacterStore` lists paths, reads a file (a blob, so a File System Access file stays on disk until the renderer
  asks) and writes `rig.json` or `sprite.json`. One implementation wraps a `FileSystemDirectoryHandle` (`showDirectoryPicker({ mode: 'readwrite' })`),
  the other Marginalia Studio's bridge: `vnStudio.character.folder / pick / list / read / write`, allowed from `/editor/studio.html` only, working inside
  the one folder the main process holds for the window (never a path the page names), reading images and JSON, writing the two JSON names. The
  browser test stubs the picker with an OPFS directory, which is a real directory handle.
- **Creating the first rig.json.** A character with no rig.json starts from `rigSkeleton` (part order and a bone for each PSD folder, as the
  editor's generated tab does); Save writes it. Opening a flat character (images only) is the same path. A folder of loose layer images is read as
  poses, not layers: nothing in it says which, and guessing wrong would paint a stack of alternatives.
- **Save is Apply that writes.** The button, Ctrl+S (a window listener on the page; the stage page forwards its own Ctrl+S) and the unsaved-edits
  guard (`beforeunload`, and **Open...** warns once before it leaves) take the place of the editor's tab, its undo step and autosave. Save re-reads
  `rig.json` first, so edits made to the file meanwhile are not overwritten for keys the studio does not touch.
- **Not built:** webm / mp4, converting a PSD or reading layer images as parts inside the page, a recent-folders list, a read-only fallback for
  browsers without the File System Access API (a download of rig.json on Save), reloading art that changes under the open page, and the page on the
  online demo's static site (the stage page there is only reachable through a project's service-worker route).

#### Movie export, as built (2026-11-07)

The user-facing description is in [rig-json.md](../rig-json.md#exporting-a-movie); the code is `engine/src/movie-export.ts` (the plan, frame times,
framing, file names, the run loop, stored options), `ZipStream` in `zip.ts`, the stage page's `studioExportBegin / Frame / End`
messages (`preview/studio.ts`, `PixiRenderer.studioCapture`), the dialog `editor/anim-export.ts` and the Studio's `movie` bridge
(`studio/preload.cjs`, `main.cjs`). What was decided and why:

- **Time is arithmetic, not a clock.** Frame N is at N / fps seconds (`frameTime`); a looped export wraps by time, a single play holds the last
  pose and has one frame more than its length in frames, so its end pose is drawn. A loop of whole frames repeats no end frame. Physics is
  stepped once per frame by 1 / fps from rest (`stepChain` carries the remainder of its own 1/60 s steps), after an optional lead-in that is
  posed and not drawn; the lead-in of a loop wraps backwards from its end, so the chains are already swinging at frame 1. Automatic animations
  are off for the export (`behaviors: false` in its state), the hand-set parameter values stay, drags and the shake do not count. Two runs give
  byte-identical PNGs (the browser test and a throwaway script compared them).
- **The editor asks, the stage page draws, one frame at a time.** The editor sends `studioExportBegin` (the page replies `Ready` with the frame
  count), then `studioExportFrame` for frame 0, 1, 2 and so on, and gets each PNG back as a transferred buffer. One frame in flight is the
  back-pressure (a slow disk slows the stage, nothing piles up) and makes Cancel a flag read between frames. The character framing needs the
  box of the art over the whole animation, so the page poses the animation once, unseen, to measure it before frame 1.
- **Drawn with `extract.pixels`, un-premultiplied by hand.** Pixi 8.22's read-back leaves the colours multiplied by alpha (the un-premultiply
  in its source is compiled out), which would put a dark fringe on every edge over any other background. `studioCapture` divides them out
  before the canvas encodes the PNG. A transparent export composited over a colour matches the export made over that colour to within one level
  per channel.
- **Delivery.** A folder of files where the browser can write to one (`showDirectoryPicker`, asked for first because it needs the click) and in
  Marginalia Studio (a `movie:pick` / `movie:write` bridge allowed from the editor page only, writing plain `name.png` files into the one folder
  the user picked); otherwise one zip. `ZipStream` is a store-only writer that hands back the bytes for each file as it is added (PNG is
  already compressed), so the frames can sit in a Blob instead of one buffer. Classic zip limits (4 GB, 65534 files) are refused, and the dialog
  stops at 3600 frames.
- **Not built:** webm / mp4, a shorter frame range, a framing preview.

## Decisions

Decided 2026-11-06:

- **Combining keyforms and direct transforms: additive.** Evaluation order: parameter keyforms, then the bone's local
  transform on top, then physics added last. Rotation and translation add; scale and opacity multiply. A blink therefore
  plays over any pose.
- **File layout: one rig.json with sections** (`parts`, `parameters`, `deformers`, `physics`, `poses`, `animations`).
  Splitting later is cheap since compatibility is not required; split out `animations` only if size or merge conflicts
  become a real problem.
- **Keyform evaluation: on the CPU, only when a parameter changed** (a dirty flag per target). No baked mesh cache unless
  profiling a real character shows a need.
- **Masks: stencil masks** for the hard-edged cases (an iris in the eye, a mouth interior), nested one level at most. Soft
  alpha masks need render textures and are allowed only if a real case appears.
- **Physics:** chains get their own `physics` section; inputs may be bone channels as well as parameters (the interim
  bone-rotation mode needs that); a chain does not step while the game is paused (the hair freezes with the scene); across
  a scene change where the character stays, the chain state is kept, not reset. Only "inputs / pendulum / outputs" is
  taken from the Live2D vocabulary.
- **Frame tracks:** `frames` sequences are stored as written and expanded in memory. A frame track on a mesh-warped part
  is a `checkRig` error for now (it would need a mesh per variant).
- **Movie export:** render in the browser, frame by frame with a fixed timestep (not MediaRecorder, which captures in
  real time and drops frames; not node, which would need a headless GL renderer). A PNG sequence with alpha first;
  webm / mp4 later through WebCodecs or an ffmpeg the Electron Studio bundles.

## Open questions

- Mask cost: the stencil masks are built (see Masks, as built) but still unmeasured on a low-end phone. They are guarded by a warning above
  8 masks per character and a `maskCount` figure; measure once a device is at hand.

## Later

Ideas that fit the model but can be added without changing the format:

- Lip sync from audio or phonemes mapped to a mouth parameter (ties in with the voice-line work).
- Onion skinning.
- Live link between the standalone studio and a running game preview.

## Suggested order

1. Parameter model, keyforms and the timeline on parameters, replacing direct part keys. Stepped frame tracks can
   come with it, as they need only the slot model and the timeline.
2. Poses and the script surface (`pose=`, `param=value`, tweens).
3. Viewport zoom and pan, then the bone gizmos (they share the constant-size handles; a bone drag works without the
   parameter model, so this can also come before step 1 on the rigid rigs).
4. Mesh-warp deformers.
5. Masking (built, 2026-11-07).
6. Physics chains (the pure simulation and its tests first, then the studio panel). A chain driving a bone rotation
   can ship before step 4 if secondary motion is wanted early; its outputs move to warp parameters later.
7. Standalone packaging and movie export (the PNG-sequence export and the standalone studio are built, 2026-11-07; webm / mp4 are not).
8. Items under Later.
