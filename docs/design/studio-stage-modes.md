# Animation studio: what a click on the stage does, by mode

Status: built 2026-11-08 (proposed the same day; see "Built" at the end for the decisions taken while building). It grew out of two complaints about Model mode: a click on the stage picks the
bone when the part was wanted, and a missed click with the Weights tool throws the tool's work away. Both come from the same
place, the stage's pointer-down handler in `preview/studio-gizmo.ts`, which tries each tool's hit test in turn and falls through
to ordinary selection when none applies. This note names the stage's **modes**, says what a click, a drag and a miss do in each,
and what a mode keeps when the author leaves it. The studio's two large modes (Model and Animate, [studio-ux.md](studio-ux.md))
and its one focus ([studio-focus-and-verbs.md](studio-focus-and-verbs.md)) stay as they are; this is about the stage inside them.

## The problem

**The tool decides what a click selects, and nothing says so.** In Model mode a part that sits on a bone resolves to the bone
when Move, Rotate, Scale or Pivot is on (`anim-studio.ts`, the `select` event: "a part on a bone selects the bone, the gizmo
moves what hangs on it"); only the Warp, Weights and Mask tools pick the part itself. So:

- With the default Move tool the part can never be chosen from the stage. The Warp section, where **Generate mesh** lives, then
  says "choose a part in the tree", and the Weights section says the chosen row "is not a part with art", while clicking the
  part on the stage again gives the bone again. The ways out (a row in the Parts tree, or switching to Warp first) are not
  mentioned anywhere the author is looking.
- The click cycle through overlapping parts (`cycleHit`) walks the parts under the pointer but resolves each to its bone, so
  two parts on one bone cycle without the selection changing.
- Pressing **B** with a bone chosen opens a Weights section that can only tell the author to choose something else.

**A miss with the Weights tool leaves the tool's subject.** The tool's default brush mode is *Read weights*. In it, a click on
a vertex reads the vertex out, and a click anywhere else falls through to ordinary selection: empty stage chooses nothing, a spot
within 10 px of a bone's pivot chooses that bone, another part chooses it. The Weights panel then sees a different chosen row and
resets its session state (the bones bound but not yet weighted, the active bone, the picked vertex, the vertex selection), and the
mesh overlay goes because the panel no longer has a mesh. Getting back means choosing the part again, binding each bone again and
reselecting. The paint modes and *Select* swallow every click and do not have this problem; a paint mode with no bone bound yet
behaves as *Read weights* and falls through too.

**Painting is hard to find.** The Brush row is hidden until a bone is bound and its mode list starts at *Read weights*, so the first
thing the tool shows is a tool that only reads. The stage shows no sign of the brush mode: the ring cursor appears only in the paint
modes and only once the pointer moves, the hint line over the stage has no Weights branch (it keeps the generic Model text about
binding parts), and the tool keys W, E, R and Q switch tool at once, dropping the test pose.

The thread through all three: the stage has modes already, but they are implicit, they leak into each other, and leaving one is
a side effect of a click rather than a choice.

## The model

**One stage mode at a time, named by the tool.** The stage's pointer handling is a dispatch on the mode, not a chain of hit tests.
Each mode says three things: what a press on its own handles does, what a press on *something else* does, and how the author leaves.
Everything a mode does not name is inert while it is on.

| Mode | Tool | A press on its handles | A press on art | A press on nothing | Leaves by |
|---|---|---|---|---|---|
| **Transform** | Move, Rotate, Scale (both studio modes) | drags the gizmo (none while it is locked: [studio-locked-gizmo.md](studio-locked-gizmo.md)) | chooses (see *What a click chooses*) | chooses nothing | another tool |
| **Pivot** | Pivot (Model) | drags the pivot | moves the chosen part's pivot there | the same | another tool |
| **Warp** | Warp (Model) | drags a lattice point, or a topology edit | chooses the part (its lattice shows) | clears the point selection, or starts a rectangle | another tool, or Esc with nothing selected |
| **Weights** | Weights (Model) | as the brush mode says (below) | chooses the part (its mesh shows) | as the brush mode says | another tool, or Esc with nothing selected |
| **Mask** | Mask (Model) | drags a polygon point, adds on an edge | chooses the shape or the part | chooses nothing | another tool |

Two rules fall out of the table:

1. **The deform tools never lose their subject to a miss.** With Warp, Weights or Mask on, a press on nothing acts on the tool's
   own selection (clears it, or starts a rectangle) and never changes the chosen row. The bone dots on the stage take no click
   in these modes: a bone has nothing to warp, weight or mask. This alone removes the Weights exit.
2. **Leaving is explicit.** The tool button, its key letter, or Esc pressed with nothing selected (back to Move). A tool key
   pressed during a brush stroke or a drag is ignored until the release.

### What a click chooses

In Model mode a click on art chooses **the part**. The bone is reached deliberately:

- a click on its **pivot dot** (the 10 px hit that exists today), in the Transform and Pivot modes;
- **Alt-click** on a part, which chooses the bone it sits on;
- the chosen part's Properties line *on bone X*, which is a link.

The gizmo then shows on what the tool moves: with the part chosen and the part on a bone, Move, Rotate and Scale pose the bone
in Model mode as they do now, and the hint line says so ("arm_l moves with its bone upper_l; Alt-click to choose the bone"). The
difference from today is only *which row is chosen*: the part, so the Warp, Weights and Mask sections have their subject, and
the gizmo keeps its behaviour. In Animate mode a click on a part keys the part (as today); Alt-click chooses its bone.

The click cycle through overlapping parts cycles parts, as its label already says.

### The Weights mode in detail

The tool's **brush mode** (Read weights, Select, Add, Subtract, Replace, Smooth) is a sub-mode of the stage, and the stage shows
it:

| Brush mode | Cursor | A press on a vertex | A press on nothing | A drag |
|---|---|---|---|---|
| Read weights | crosshair | reads it out | clears the readout | nothing |
| Select | cell | selects it (Shift toggles) | clears the selection (Shift keeps it) | a rectangle |
| Add, Subtract, Replace, Smooth | the brush ring, from the moment the pointer enters the stage | a dab | a dab that touches nothing | a stroke, one undo step |

Three changes beside the table:

- **The panel's state belongs to the mesh, not to the chosen row.** The bound-but-unweighted bones, the active bone, the picked vertex
  and the vertex selection are kept per deformer id for the opening, so a change of the chosen row (from the tree, say) and a return
  find them as they were. Today a row change resets them.
- **The first mode is the useful one.** With no bone bound the Brush row is shown anyway, disabled, with the hint "Bind a bone first";
  once one is bound the mode list stays where the author left it (per opening), starting at *Add*. *Read weights* remains the way to
  inspect, one entry down.
- **The hint line over the stage names the mode**: "Weights · Add on forearm_l: drag over the mesh; B or Esc leaves" and so on for
  each brush mode. **B** with a bone chosen picks the first part on that bone that has a mesh, and says which.

The test pose keeps its rule: it lives while the Weights tool is on and goes when the tool is left, by any of the explicit ways.

## What changes in the editing flow

- Adding a mesh to a part: click the part on the stage, open Warp, Generate. No detour through the tree or the Warp tool first.
- Weighting: click the part, press B, bind, Auto-weights, then paint at once; a click beside the mesh does nothing worse than a dab
  on air. Esc with nothing selected, or W, is the way out.
- Posing a bone in Model mode: as today, but the chosen row reads the part's name and the hint says which bone moves. Alt-click
  for the bone itself (to rename it, set its parent, remove it) or click its dot.

## Where it touches the code

- `preview/studio-gizmo.ts`: `onDown` becomes a dispatch on the mode (`cfg.tool`, and `skin` with its brush mode), with one handler
  per mode; the fall-through to `pick()` exists only in the Transform and Pivot modes. The bone-dot hit moves into those two. The brush
  ring is drawn from `pointerenter`, the cursor is set per brush mode, and tool keys are held during a stroke or drag.
- `editor/anim-studio.ts`: the `select` event no longer promotes a part to its bone; Alt-click does (`alt` joins `shift` and `ctrl` in
  the `studioSelect` message and `StageEvent`). `modelHint()` gets Weights and brush-mode branches. The Properties section's *on bone*
  line becomes a link. **B** with a bone chosen picks a part on it.
- `editor/anim-weights.ts`: the state reset at the top of `show()` goes; state is a map by deformer id. The Brush row is shown
  disabled before a bind; the default mode is *Add*.
- `editor/anim-gizmo.ts`: Esc with nothing selected in a deform tool returns to Move (today Esc in the dialog closes the studio, so
  the stage page handles it and reports it as a key).
- Pure functions, with tests in `engine/test/`: the choose rule (part or bone, by mode, modifiers and where the press landed) and
  the Weights state map. `cycleHit` already returns parts.
- Tests that pin the old rule: in `engine/test/browser.test.mjs` the free-mesh test chooses with the Move tool and expects the bone
  (`arm_l`) for a click on the arm's art; it would expect the part, and a second click on the pivot dot the bone. The Weights test
  binds and paints with a part chosen from the tree, which still works.
- Docs: `docs/rig-json.md` (Model mode, "Weighting a mesh in the studio"), `docs/studio.md` where it describes clicking the stage,
  and the tool-row tooltips.

## Alternatives considered

- **Keep bone promotion, make the sections' empty states actionable.** When the chosen row is a bone, the Warp and Weights sections
  list the parts on that bone as buttons, and B picks one. Smaller, and it fixes the Weights exit only if rule 1 is built too. It
  leaves the rule that the tool decides what a click selects, so the cycle label and the selection keep disagreeing. Worth building
  as a fallback if the choose rule turns out to be contested.
- **A modifier for the part, promotion by default.** Alt-click chooses the part, a plain click the bone. The common case in Model mode
  (a part to warp, weight, mask or bind) would need the modifier; the rare one (a bone to rename or re-parent, which the tree does
  well) would not.
- **A separate Select tool** (as in Cubism and Spine), where no transform tool is on until one is chosen. One more button and one more
  concept for a studio that opens on Move already; the table above gets the same effect by giving the Transform mode the only
  fall-through.
- **Locking the mode until Done.** A deform tool that only a Done button leaves (like **Bind parts…**'s pick). Stronger than needed:
  with rule 1 a miss is harmless, so the tool buttons and Esc are enough, and a locked tool would fight the W/E/R habit.

## Open questions

- Whether the Transform mode's miss should keep choosing nothing. It is how the author gets back to the whole character; a Fit-style
  "whole character" row in the tree would do as well and make a miss harmless there too.
- Whether the Weights panel's per-mesh state should survive switching to Animate mode and back within one opening (the test pose does
  not).
- Whether the hint line is enough to show the mode, or the stage wants a small mode badge in a corner (tool, brush mode, active
  bone), as paint programs have. A badge is cheap and would also carry the "Esc leaves" affordance.

## Built

The pure rules are `engine/src/studio-stage.ts` (`chooseOnStage`, `keepsSubject`, `escapeAction`, the brush helpers and the Weights sessions by
deformer id), tested in `engine/test/studio-stage.test.mjs`; the stage page's `onDown` is the dispatch above, the editor applies the choice.
Decisions taken while building, where the note left room:

- **A click on the chosen part's own art is work, not a choice**, with Warp or Weights on (`keepsSubject`): the cycle through overlapping parts
  does not run and the row stays, so a dab between the vertices or past the mesh's reach cannot slide to the part behind. A click on *another*
  part's art chooses it, in every brush mode; with a paint brush only a click that touched no vertex and did not move (a stroke that starts on a
  neighbour's art and crosses onto the mesh paints). The Mask tool keeps the table's rule: a press on nothing chooses nothing.
- **Alt-click chooses the bone in every mode**, deform tools included, and with Ctrl held it chooses rather than toggles. The bone dots take a
  click only in the Transform and Pivot modes. The chosen part's own bone dot sits under the gizmo's free handle, so there a press drags the
  gizmo; Alt-click or the Properties link reaches that bone.
- **The brush mode is per opening** (one value, starting on Add); the bound-but-unweighted bones, the active bone, the readout and the selection
  are per mesh for the opening, and they survive a switch to Animate mode and back (the test pose does not), which answers the second open
  question. A press on nothing in *Read weights* clears the readout (a pick of vertex -1).
- **The stage mode travels in the gizmo message** (`stage`, the tool row's tool) and the brush mode in the weights message (`mode`), so the stage
  knows the mode even when the tool has no mesh or lattice to show; a press on art chooses the part then, as the table says.
- No mode badge was built (the third open question): the hint line names the tool, the brush mode and the active bone, and says how to leave.
  Superseded since: the tool options bar's first item names the mode ([studio-inspector.md](studio-inspector.md) step 1).

## Revised after the second UX round (2026-11-09)

- **What the gizmo poses for a chosen part on a bone** (finding SR-1 in [ux-test-2026-11-studio](ux-test-2026-11-studio/summary.md)): the part
  itself when the active parameter is bound to the part by a pose of its own, else the bone, as before (`poseTarget` in `engine/src/studio-focus.ts`).
  Before, it was always the bone, so a part bound on its own (eyes keyed alone, the usual Cubism case) could be bound but not posed. The Keys row,
  the Pose fields, the ◆ and the active slider's marks speak about the same target, and the breadcrumb says "the gizmo poses spine, the bone torso
  sits on" when it is the bone.
- **Esc** pressed in the side columns with a deform tool on goes to the stage (`studioEscape`), which clears the selection or goes back to Move; the
  dialog closes only after that. An Esc the stage does not use (Transform, Pivot, a Mask tool with nothing to clear) goes back to the studio.
