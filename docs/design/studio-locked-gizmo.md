# Animation studio: a gizmo that cannot write shows no handles

Status: built 2026-11-10 (see "Built" at the end for where the build differs from the proposal). It grew out of one complaint: in some states of the studio the gizmo's handles can be dragged, the
part follows the pointer, and at the release it snaps back with a note saying nothing was written. The handles promised a drag
the studio was never going to keep. This note says when that happens, what the stage shows instead, and where the rule lives.
The stage modes of [studio-stage-modes.md](studio-stage-modes.md) stay as they are; this is about the Transform mode's gizmo
(Move, Rotate, Scale) inside them.

## The problem

**The stage asks whether to draw handles; only the editor knows whether a drag will be kept, and it answers at the release.**
The stage page (`preview/studio-gizmo.ts`) draws the gizmo whenever the `studioGizmo` message names a tool and a subject, and
a press on a handle starts a drag that the stage shows as it goes. The editor sees the drag once, at the end, and throws it
away in these cases:

| Studio mode | Case | Today's note |
|---|---|---|
| Model | The character has no parameters | "this character has no parameters yet. Add one in the Parameters section" |
| Model | No active parameter (nothing in Moved by is pressed, no slider or pad active) | "chosen without a parameter. Press one of the buttons in Moved by…" |
| Model | What the gizmo poses (the part, or the bone it sits on; and every part Ctrl-clicked with it) is not bound to the active parameter by a pose | "not bound to *param* yet. Use Bind parts…", or "bound … by its warp, not by a pose: drag its lattice points with the Warp tool" |
| Animate | No animation chosen | "Choose an animation first." |
| Animate | The animation is a preset | "*name* is a preset and cannot be keyed. Press Edit copy…" |

The notes are right, but they come after the work: the author has already lined up the pose, and loses it. In the Model cases
the studio also jumps to the Parameters section, so the stage and the side column both change under the pointer.

These are **not** refusals and keep their handles:

- the Weights tool's test pose (drags are kept as unkeyed offsets, never written);
- Animate with Auto-key off (the drag is shown and waits for Key);
- a Ctrl-click set where at least one part is bound (the bound ones are written, the note names the rest).

## The rule

**The gizmo shows handles only when a drag on them would be kept.** Otherwise it is *locked*: it says what is chosen and why it
cannot move it, and offers nothing to drag.

The verdict is one pure function, `gizmoLock`, in `engine/src/studio-focus.ts` beside `poseTarget` (which already decides what the
gizmo poses). It takes the studio mode, the tool, the animation in Animate (none, preset, editable), the active driver in Model, the
gizmo's subject and the Ctrl-click set, and the keyforms, and returns `null` (draggable) or `{ why, fix }`:

1. Animate: no animation → *Choose an animation*; a preset → *Edit copy to key it*.
2. Model, Weights tool: never locked (the test pose).
3. Model, Transform tools: no parameters → *New parameter*; no active driver → *Press a parameter in Moved by*; no pose binding
   for the subject or any part of the set → *Bind parts…*, or the Warp / Mask tool when the part is bound by its lattice or its points.

The `why` and `fix` texts are the ones the release notes give today (`unboundDragNote` included), so the words the author reads
do not change; they move from after the drag to before it.

## What the stage shows

A locked gizmo keeps a **passive mark** on the subject: the pivot dot and a faint outline of where the gizmo would stand, in the
muted colour the stage uses for things it does not act on. It draws:

- no axis arrows, rotate ring or scale boxes;
- no hover cursor over that area (the cursor stays the stage's ordinary one);
- nothing for a press there: a press is a press on the art beneath, so it chooses as the Transform mode's table says.

The mark matters: without it a chosen part on a locked parameter would look the same as nothing chosen.

The **hint line over the stage** carries the reason and the way out, in the same words: "upper_l is not bound to Smile by a pose:
Bind parts… to pose it", "Walk is a preset: Edit copy to key it". The tool row's Key button and Pose fields already disable
themselves in these states; they read the same verdict so the row and the stage agree.

The Move, Rotate and Scale buttons stay enabled while locked: choosing a tool is not a write, and the tool the author picked is
the one that shows handles once the lock goes.

## When the verdict changes

The editor computes `gizmoLock` whenever it builds the `studioGizmo` message and sends it as `lock: { why } | null`. The message is
only posted when it changes, so the cost is nil. It has to be rebuilt after everything that can flip the verdict:

- a change of the chosen row or the Ctrl-click set;
- a change of the active parameter or pad (Moved by, a slider, a pad);
- Bind parts…, unbinding, removing a parameter;
- choosing an animation, Edit copy, a change of studio mode or tool;
- undo and redo of any of these.

Most of these already end in `refreshView`, which resends the gizmo; each needs checking.

The release-time notes in `keyformDrag` and `GizmoBar.event` stay, as a backstop: if a case slips past `gizmoLock` the author
still gets a note rather than a silent snap-back. A drag that reaches them is a bug in the rule.

## Where it touches the code

- `engine/src/studio-focus.ts`: `gizmoLock`, with `engine/test/studio-focus.test.mjs` cases for each row of the table above and the
  three non-refusals.
- `editor/anim-gizmo.ts`: `send()` adds `lock`; `GizmoHost` gets a `lock()` the studio answers. `show()` reads it for the Key button.
- `editor/anim-studio.ts`: answers `lock()` from the same inputs `keyformDrag` uses; the hint line gets the locked branch; the
  verdict is resent after the changes listed above.
- `preview/studio-gizmo.ts`: with `cfg.lock` set, the handle hit tests (hover, cursor, `onDown`) are skipped and the gizmo is drawn
  as the passive mark.
- `preview/studio-queries.ts`: the gizmo query reports whether handles are drawn, so a browser test can assert it.
- Tests: a browser test where Model mode with no active parameter shows no handles, and pressing a Moved by button that binds the
  part brings them back; an Animate one with a preset.
- Docs: the gizmo paragraph of `docs/studio.md` and the Transform row of [studio-stage-modes.md](studio-stage-modes.md).

## Alternatives considered

- **Hide the gizmo entirely when locked.** Simpler to draw, but the stage then cannot tell "chosen, cannot move" from "nothing
  chosen", and the hint line alone is easy to miss.
- **Keep the handles, refuse at the press.** The press shows the note and no drag starts. Fixes the lost work but keeps the false
  promise: the handles still look live, and the hover cursor still says *grab*.
- **Disable the Move, Rotate and Scale buttons.** It reads as "these tools are gone" rather than "this subject is not ready", and
  it would fight the W/E/R keys.
- **Bind on the first drag.** A drag on an unbound part binds it to the active parameter and writes the keyform. Convenient, but
  binding is deliberately its own verb (Bind parts…), and an accidental drag would change what a parameter moves.

## Open questions

- Whether the passive mark should carry a small lock glyph by the pivot, or the muted colour is enough.
- Whether a press on the passive mark should also flash the hint line, for an author who did not read it.

## Built

- **The rule lives beside the bar's line**, not in `studio-focus.ts`: `gizmoLock` in `engine/src/studio-inspector.ts` takes the same
  `GizmoLineState` as `gizmoLine` (plus `setBound`, a Ctrl-clicked part that is bound) and returns a reason code (`noAnim`, `preset`,
  `noParams`, `noParam`, `unbound`) or null. The explanation is the tool options bar's line, which already said why a drag would not write;
  its wording for the two cases that read as if a drag still did something changed ("is a preset and cannot be keyed: Edit copy makes an
  editable version", "nothing to drag until it is (Bind parts…, …)"). The status line's hint did not get a locked branch: the bar's line sits
  right above the stage and is the one place that names what the gizmo poses.
- The editor builds the state once (`gizmoState` in `editor/anim-studio.ts`) for the line and the lock, and `showStatus` resends the gizmo
  message, so every change of tool, mode or focus carries the lock; the message is posted only when it changed.
- The stage draws the passive mark as a dashed square at the gizmo's centre (`data-gizmo-lock`), keeps the choice cue (outline and tag),
  and leaves `frame` unset, so the hover, cursor and press hit tests find no handle and a press there chooses as on the art.
- The release-time notes stay as the backstop.
