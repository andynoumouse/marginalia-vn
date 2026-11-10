# Animation studio: undo that shows what it changed

Status: built 2026-11-10, with undo switching modes (decided the same day). From UX findings ES-5 (first round) and SA-9 (second round).

## The problem

The studio has one undo history: snapshots of the whole working copy (`anim-history.ts`, `edit()` / `restore()` in `anim-studio.ts`). It
covers both modes and every animation. Undo and redo restore a snapshot and redraw, but nothing else:

- **Undo changes things you can't see.** Set `wave`'s Length to 3 s, switch to `nod`, press Ctrl+Z: nothing visible happens, and `wave` is
  quietly back to 1.1 s. Key `arm_r` in Animate, switch to Model, Ctrl+Z: the Animate key is gone, without a word.
- **Redo doesn't follow either.** It brings back a deleted animation, but the view stays where it was.
- **Nothing names the step:** no message, and the Undo and Redo buttons have no tooltip.

The steps themselves are the right size; the testers praised that ("one step per drag, stroke or operation").

## Keep one history

Separate histories per mode or per animation look tidier, but the data is linked across them:
- deleting a parameter in Model removes its tracks from animations;
- a pose is made in Model and keyed in Animate;
- removing a bone changes weights, keyforms and keys.

Two histories would undo half of such an edit. So the history stays one list, and what changes is what undo **shows**.

## Proposal

1. **Every step gets a label when it is made.** `commit()` compares the snapshot before with the working copy after and describes the
   difference. This is a pure `describeChange(before, after)` in a new `engine/src/studio-history.ts`, with tests. It returns a phrase and
   a place:
   - **Animation edits:**
     - `wave: Length 1.1 s → 3 s`
     - `wave: 2 keys on arm_r`, or `wave: key on arm_r moved`
     - `wave: lean track`, `wave: frames of eyes`, `wave: Automatic`
     - `new animation icon_tools`, `deleted animation nod`, `renamed hop → hop2`
   - **Model edits:** `keyform of head on head_x`, `deformer upper_l_mesh`, `parameter lean added`, `bone forearm_l removed`,
     `pivot of face`, `physics chain hair`, `reaction smile`, `pose happy`, `look casual`, `mask shape visor`.
   - **Fallback:** a change it can't name more precisely becomes `edit in <area>`.
   - **Place:** the mode the change belongs to, the animation (for Animate data), and the part when one is clear.
2. **Undo and redo go to the change and say it.**
   - The status line reads `Undid: wave: Length 1.1 s → 3 s` or `Redid: …`.
   - If the change was in another animation, that animation is shown.
   - If it belongs to the other mode, the studio switches to that mode (see the question below).
   - If the change named a part that still exists, the part is chosen, so the stage and Properties show it.
3. **The buttons name their step:** tooltips like `Undo: wave: Length 1.1 s → 3 s (Ctrl+Z)` and `Redo: … (Ctrl+Y)`. The labels are stored
   with the snapshots in `UndoStack`, so they cost nothing at undo time.

## How it would be built

- **`studio-history.ts`:** `describeChange` compares the snapshot's top-level areas (`anims`, `keyforms`, `deformers`, `parameters`,
  `bones`, `pivots`, `physics` and the rest). Inside `anims` it compares animation by animation, and inside one animation it compares
  `dur`, `keys` by part, `params` by id, `frames` by slot, and `auto`. It has tests.
- **`UndoStack`:** holds `{ snap, label }` instead of bare snapshots, and reports the next label each way for the tooltips.
- **`anim-studio.ts`:** `commit()` labels the step. `undo()` and `redo()` restore it, move the view (mode, animation, part), write the note
  and set the tooltips.
- **Browser test:** ES-5's own two cases (Length in another animation; an Animate key undone from Model), plus the tooltips.
- **Size:** one session.

## Question

**When the change belongs to the other mode, should undo switch modes?**
- **Switch (my pick):** you see what was undone, as you do for an animation. The mode is a view choice, so switching loses nothing, and a
  second Ctrl+Z then works in the mode the history is in.
- **Stay and only name it:** the mode never changes under you, and the status line says `Undid (in Animate): …`. But the change stays out
  of sight, which is the complaint.

## Built

- **Decided:** undo switches modes.
- **The labeller:** `describeChange` in `engine/src/studio-history.ts`, tested in `studio-history.test.mjs`.
  - It names a change that spans areas by its cause: bones first, then parameters, then animations, then the rest of Model's data.
  - It gives no mode, so undo stays in the mode you are in, for parameters, pads, parameter groups, poses and looks. Both modes show
    them.
- **The history:** `UndoStack` keeps `{ state, label }`. A step's label moves to the redo side when it is undone.
- **The studio:** `showStep` runs after an undo or a redo. It switches mode, shows the animation, and writes `Undid: …` or `Redid: …`.
  - It chooses the part only when the view had to move, or nothing was chosen, and the part is still there.
  - An undo where you are working keeps your choice. A first version always chose the part: undoing a removed bone then took you from
    the mesh to the bone, and undoing on a Ctrl-click set broke up the set. Two studio browser tests caught it.
  - The Undo and Redo tooltips are set wherever the studio refreshes its buttons.
- **The browser test** (`undo and redo go to what they change`) covers ES-5's Length case with Redo, and SA-9's Animate key undone from
  Model.
