# Animation studio, Model mode: one focus, and verbs that ask for their target

Status: built (2026-11-07). It replaced the earlier "parameter first" binding flow, where a click or a drag bound a part as a side effect; the places that
describe the result are [studio-ux.md](studio-ux.md) (Modes, and "Where the next panels go") and
[animation-studio-parameters.md](animation-studio-parameters.md). What follows is the design as decided, then "As built" at the end for where the build differs.

## The problem

Model mode keeps two selections at once: the **active parameter** (a highlighted row in the palette) and the **chosen part** (a row in the
Parts tree, or the part clicked on the stage). The Keyforms section on the right shows the properties of the *pair*, and several things happen
because of the pair without anyone asking for them:

- A click on the stage binds the part to the active parameter (`anim-studio.ts`, the `select` event), unless Shift is held.
- A gizmo drag writes the keyform of the active parameter at its value, binding the part first if need be.
- Keys, Pose and Add key here are blank or disabled until both selections exist, and nothing says which one is missing.
- The ticks in the tree are an action (bind) and a display (bound) at once.

So the same click means "choose" or "choose and bind" depending on a selection made somewhere else, and the right column's contents
depend on two things the user has to keep in mind. The Shift-click exception exists only to get out of that.

## The model

**One focus.** At any time the studio has one focus, and the left column and the right column both speak about it only.

| Focus | How you get it | The right column shows |
|---|---|---|
| **Parameter** (a slider or a pad) | a click on its name in the palette | its name, group, range, default, ease; **Bound parts** (kind, keys, posed, unbind); the verb **Bind parts…** |
| **Part or bone** (one, or several with Ctrl-click) | a click in the tree or on the stage | its pivot, bone and transform; **Keyed by** (each parameter that moves it, with the key count); the verb **Bind to parameter…**; Warp and Mask when their tool is on |
| **Keyform** (a part at the slider's value on one parameter; a key there or not yet) | a click on a row of Bound parts, or on a row of Keyed by | a breadcrumb `Arm_L › ArmAngle › 0.5` (each word goes up to that focus), the pose fields, the ease, **Remove key**, previous and next key |

Choosing in either list on the left changes the focus; there is no second highlighted row. The rule is the same from both sides: a part and a parameter are
paired (a keyform focus) only when the parameter moves the part, by pose, warp or mask; otherwise the new choice replaces the old one. The keyform is the only
place the two concepts meet, and it is a thing you select, with a name, instead of a consequence of two selections.

Sliders and pads preview. Moving one never changes the focus. With a keyform in focus the slider is held at its key (the Keys buttons and the
previous / next buttons move it between keys), so the pose fields and the stage agree.

**Verbs name their target after the verb.** A verb that joins two things is a button on the focus that starts a **pick**:

- **Bind parts…** (parameter focus): the stage and the tree show which parts can be picked; each pick binds that part and makes its keys at rest
  (slider: min, default, max; pad: the grid chosen beside the button). The pick stays on until **Done** or Esc, so binding twenty parts to one
  parameter is twenty clicks and one Esc, as in Cubism.
- **Bind to parameter…** (part focus): the palette shows which parameters can be picked; a pick binds the chosen part or parts to it. It ends
  after one pick (hold Shift to keep going).
- **Copy keys from…** (part focus, and the keyform's parameter): the tree or the Keyed by list picks the source; Mirror is a checkbox beside the verb (built as two: **mirror poses** and **reverse range**, since an arm lift wants the first alone and a look to the side both).

While a pick is on, a line over the stage says what it waits for ("Bind to… pick a part. Esc cancels."), the cursor changes, and a plain click
on the stage chooses nothing else. A verb with an obvious target needs no pick: **Unbind** and **Remove key** act on the row they sit on.

The tree's ticks stay as a **display**: with a parameter in focus, a bound part shows a dot. They are not a control any more.

## Choosing the part of a keyform

With a parameter or a keyform in focus, the part to pose is chosen in one of two ways, so there is no part-stepping button:

- **A click on the stage.** The click selects the keyform focus of the part at the slider's value. Only parts bound to the parameter count: if none of
  them is under the pointer, the frontmost part there becomes a plain part focus instead (it is not bound by this click).
- **A click on a row of Bound parts** (or a part's row in the tree, when it is bound to the parameter): the same keyform.

**Overlapping parts.** The stage today reports only the frontmost part with pixels under the pointer, so a part behind another can be reached
only from the tree. Clicks cycle instead: the page reports every part under the pointer, front to back (a new `studioHitAll` beside `studioHit` in
the renderer, sent in `studioSelect`), and a click on the same spot (within 4 px of the last click) takes the next one, wrapping to the first.
The candidates are the parts bound to the focused parameter, or every part when the focus is not a parameter. A line over the stage says where
you are in the cycle ("Arm_L, 2 of 3. Click again for the next."). Moving the pointer away, Esc, or any other change of focus ends the cycle.
Ctrl-click cycles the same way and adds or removes the part it lands on. The Warp and Mask tools pick the part or shape themselves and are not
changed.

**A click only selects.** It never moves the slider and never writes. The keyform focus is the part *at the slider's value* on the parameter:
the breadcrumb reads `Arm_L › ArmAngle @ 0.7`, and says whether a key is there ("key" or "no key here: a drag adds one"). The Keys row and the
previous / next buttons move the slider between keys, as before.

**A drag adds the key it needs.** The gizmo (W, E, R) or the Warp tool, used on a keyform focus at a value with no key, adds a key of that
part at the value and writes the drag into it, in one undo step. The drag is the verb, and its target is on screen in the breadcrumb, so
nothing is implicit that the user did not do. A part that is not bound to the parameter is not bound by a drag: it is not a keyform focus,
and Bind comes first. A pad has keys only at its grid corners, so a drag writes the corner nearest the dot, as today.

## What changes in the editing flow

- **Posing.** The gizmo (W, E, R) and the Warp tool write only into a **keyform focus** (a drag at a value with no key adds one, below); the stage shows its breadcrumb in a corner so the
  target is on screen where the hand is. In a part focus, a drag does nothing keyed and the hint line says "pick a key of this part to pose
  it" (decided 2026-11-07). The Pivot tool (Q) keeps working on a part.
- **Several parts.** A Ctrl-click set stays a focus of its own ("3 parts"). Its right column shows what the parts share; **Bind to
  parameter…** binds them all. A keyform focus may hold the set: one drag writes the same delta into each (today's `dragForms`).
- **Common job, in clicks.** Create a slider; click its name; **Bind parts…**; click the parts; Esc; click one in Bound parts; pose it at each
  key by moving between keys with next. Today the same job is: click name, click parts (binds), move the slider, drag. One extra click per part
  to start posing it, and no click whose meaning depends on something selected elsewhere.
- **Animate** is unchanged: its focus is the part (or bone), the parameter controls move values at the playhead and key them.
  The palette is there too (studio-ux.md), but no click in it changes the focus, because Animate has no verb that joins a part to a
  parameter.

## Where it touches the code

- `editor/anim-bind.ts`: the Bound block is rewritten as three views (parameter, part, keyform) over one `FocusView`, and `BindHost` gains
  `focus`, `startPick` and `endPick`.
- `editor/anim-studio.ts`: no new storage (the focus kind is derived from the active control and the chosen part, see the Plan); `choosePart` and `chooseControl`
  follow the new transitions, the stage `select` handler loses its `bindPart`, `keyformDrag` and `toggleKey` stop binding, and a `pick` state routes stage, tree and palette clicks.
- `preview/studio-gizmo.ts` and the renderer: `studioHitAll` (every part with pixels under the pointer, front to back) next to `studioHit`, and
  `studioSelect` carries the list; `editor/anim-stage.ts` types it. The cycle state (last point, index) lives in the studio, which owns the focus.
- `editor/anim-params.ts`: a palette click sets the focus, and only parameter-focus rows highlight; `paintName`'s tooltip changes.
- `editor/anim-tree.ts`: ticks become a read-only dot; a pick can highlight eligible rows.
- `engine/src/`: the focus kinds and the "what can this pick" rules are pure functions with tests, per the architecture rule.
- Tests that click the stage expecting a bind (the browser set) change to start a pick first; they are updated, not loosened.
- `docs/design/studio-ux.md` (Modes, the Parameters row, the Keyforms section), `animation-studio-parameters.md`, and the help text.

## Alternatives considered

- *Keep two selections, but name the pair in the panel* ("Arm_L at ArmAngle"), and show why a verb is disabled. Smaller, but a click
  still means different things by hidden state, which is the complaint.
- *Part first* (choose the part, then a parameter). Built once and removed, because it had to guess which control a drag meant
  (studio-ux.md). The keyform focus avoids that: the drag's target is the one thing in focus.
- *A modal "bind mode" toggle in the tool row* instead of a verb with a pick. A toggle is state the user must remember; a pick is started by the
  verb, shows what it waits for, and ends by itself or with Esc.

## Open questions

- Decided 2026-11-07: a gizmo drag writes only into a keyform focus; in a part focus it is inert, with a hint.
- Decided 2026-11-07: **Bind to parameter…** ends after one pick, and Shift keeps it going.
- Decided 2026-11-07: the previous / next key buttons of the keyform view move to the neighbouring key of the same part on the same parameter. The
  part is chosen by a click on the stage (cycling through overlapping parts) or a row of Bound parts, and keeps the key value.
- Decided 2026-11-07: a click only selects (no jump of the slider); a drag at a value with no key adds the key (one undo step).
- Whether a slider drag that adds a key by accident (scrub, then drag) needs more than undo, such as a brief "key added at 0.7" note over the stage.

## As built

Five steps, in this order: the pure rules (`engine/src/studio-focus.ts`), the stage hit list and cycling, the two pick verbs with the implicit binds removed,
the focus transitions with the breadcrumb and previous / next key, then these docs. Where the build differs from the design above:

- **No new storage.** The studio still keeps the active control and the chosen part; the focus kind is derived from them (`focusKind`). `choosePart` and `chooseControl`
  go through the transitions, except while Bind parts… is on, when the parameter stays so the pick can bind to it.
- **Pairing counts every kind.** A part is paired with a parameter if the parameter moves it in any way (pose, warp or mask), whichever tool is on, so choosing a part and then the
  parameter of its warp keeps the part. A first version dropped the part whenever a parameter was clicked; that broke the Warp and Mask flows and was replaced by the symmetric rule.
- **A fresh warp or mesh is not paired.** Generating a mesh or adding a warp does not bind it to a parameter, so to key one the author presses Bind parts… (the Warp tool binds
  warps) and clicks the part. The tests that did this by clicking the parameter first now bind explicitly.
- **Copy keys keeps its dropdown and button.** Its sources can be one part on several parameters, so a stage click would be ambiguous; a pick for it is open.
- **The breadcrumb is in the right column only**, not also over the stage. It reads `spine › wave @ 1 · key`, or `… · no key here: a drag adds one`.
- **Alt-click on a bone** in a Bind parts… pick binds the bone, the bones below it and their parts. Unbinding a subtree at once is gone with the tick that did it; the ✕ unbinds one part.
- **The previous / next buttons** step along the keys of the chosen part on the active slider; changing the part goes through Bound parts or a click.
- **Overlapping parts** cycle in Model mode only; Animate keeps its single frontmost pick.
- **Names.** The "Keyed by" list of the design is the existing **Moved by** row.
- **A drag with a part alone in focus** writes nothing and says to press Moved by or Bind to parameter…; a drag on an unbound part says to bind it first.

Left open: a pick for Copy keys; whether a drag that adds a key by accident needs more than Ctrl+Z; the over-stage copy of the breadcrumb. Three studio browser tests
(the Model | Animate keyboard-list test, the rectangle-selection warp test and the Mesh row test) failed before this work and still fail at the same places, so their later steps
are unchecked.

## Revised: the pick is a picker in the right column

The stage-and-tree pick above made the left lists answer a verb as well as choose the focus, which was confusing. Now the stage, the Parts tree and the palette only choose
the focus. **Bind parts…** and **Bind to parameter…** open a picker inside the Bind block (a filterable checklist of what the verb can take, from `pickTargets`, with a
**Bind** button; Esc or Cancel closes it, and it closes when the focus it was opened for changes). Bind parts… has a checkbox for "what hangs on a ticked bone" (the old Alt-click). The
parameter stays the focus after a bind, so a warp or mask bound under another name still pairs. Copy keys is unchanged.
