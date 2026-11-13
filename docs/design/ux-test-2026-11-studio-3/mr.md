# MR report: animation studio, Model mode rigging (as returned by the tester)

Counts: S1 0, S2 5, S3 9.

Scripts (`sNN-*.mjs`) and screenshots (`shots/`) were in the session scratchpad under `kit/testers/MR/` and were not kept.

## Scope
- **Viewports:** 1600x900 for everything; one check at 1280x800 (s32).
- **mina:** eye_open blink; head_tilt slider; mouth_open bind; head_turn pad with a 3x3 grid and posed corners; reparenting a hair bone; part pivots with Q.
- **robo:** renamed head_x, changed its range, undo/redo; on arm_r_lift: re-posed a key, added a key, removed a key, deleted the parameter, undo; rotated past half a turn (70° → 289.5°); Save as pose / Use pose / Reset all; Save as look; added a physics chain (long hair preset), set its output to antenna and watched it swing; Apply, Close, reopen; read rig.json.
- **Not covered:** removing a bone (the trash icon); moving a bone's pivot (only part pivots were moved); Reactions; warp and mask binding; Copy keys; posing the mouth key (it was bound, but not posed after the view shift, MR-5).
- **Errors:** no page or console errors in any run.
- **Method note:** a persistent driver server was refused by the sandbox, so every script replays from a fresh studio open.

## Task log
1. **Rig mina from scratch: done with friction.**
   - New parameter: + → New parameter, type the name, Enter, 1.5 s; the name field is focused and selected (good).
   - Range: set min 0 and default 1 in the Parameter section.
   - Bind: Bind parts…, tick eyes, Bind, 0.5 s.
   - Blink: key 0, R, drag the vertical handle. It went wrong the first time: the eyes slid down to the neck (MR-1). Fixed by setting the pivot first: Q, click the eyes at rest, then key 0 and R-drag (1.8 s). The eyes then close in place.
   - head_tilt: bind the head bone, then rotate at -1 and at 1, 3.6 s in all. The hair strand bones stay behind because they are not under head; reparenting fixed that (task 3).
   - mouth_open: bound. Posing stalled when the stage reframed itself (MR-5).
   - Pad: + → New pad, type `head_turn`, Enter, 1.2 s, which creates head_turn_x and head_turn_y.
   - Pad binding: Bind parts… gives a 3x3 grid by default, but the "Grid on a pad" choice cannot be reached before binding (MR-3).
   - Corners: posing them stalled on drags that re-chose parts instead of moving (MR-2), the top-right corner dot not taking clicks (MR-7), and a header that read "no key here" on corners and shrank names to "h" (MR-4, MR-6).
   - Saved result (s32, at 1280): rig.json holds `parameters`, `pads` and a 3x3 `keyforms` grid.
2. **Edit robo's parameters: done with friction.**
   - Rename head_x → look_x: 0.7 s.
   - Range max 1 → 0.5: shows a note, but the note gives no count.
   - Key work: Add key here / Remove this key / re-pose work, and the status notes are clear.
   - Delete: the row's ✕ deletes at once, with no note (MR-9). Undo restores it.
   - Undo wording problems: MR-8.
3. **Bones and pivots: partly done.**
   - Part pivot with Q works. Its value then shows in the Pivot fields.
   - Reparent hair_0_0 → head with the "Under" select: 0.3 s. Note "hair_0_0 now hangs from head: it follows head's motion."; the tree re-nests.
   - Rotate past half a turn on a keyform: works (70 → 289.465).
   - With no parameters, Rotate on a bone hides the ring and says "+ in Parameters adds one". That is consistent, but a rest-pose rotate is not offered.
   - Bone removal: not tested.
4. **Poses and Looks: done.**
   - Save as pose: 0.85 s. Note: `Saved pose "glance" (head_x, head_y)… show robo pose=glance` (good).
   - Use pose and Reset all work, with no note.
   - Save as look: 0.35 s and it is in the list, but there is no status note and the select stays on "(default)" (MR-11).
5. **Physics: done.**
   - Add chain (long hair) shows clear fields and a marked bad output: `hair_sway is not a parameter of this rig…` (good).
   - Setting writes = antenna, then moving head_x: the antenna visibly swings and settles.
   - Survives Apply and reopen; rig.json `physics.long_hair` is correct.
6. **Apply, close, reopen and undo: done.**
   - Apply note: "Applied to rig.json, which the editor saves at once (Ctrl+Z in its tab undoes it)."
   - Close → reopen: 4.9 s with waits.
   - Undo texts were read throughout (MR-8).

## Findings
**MR-1 · S2 · usability · Scaling a bound part uses the bone's pivot, so a blink slides the eyes to the neck**
- Steps: on mina, bind eyes to eye_open, click key 0, press R, drag the vertical handle up.
- What happened: the gizmo sits at the head bone's pivot (neck, 270,380), and the eyes' Pivot fields are empty. Squashing to sy -0.865 moves the eyes about 65 px down onto the neck line.
- Expected: a part posed on its own scales about its own centre, or the studio says "set a pivot first (Q)". A Cubism user expects a blink to close in place.
- Workaround: Q, then click the eyes at rest. The same gizmo-at-neck shows for the eyes at 1280.
- Reproduced twice. Known: no.

**MR-2 · S2 · usability · Dragging on the art re-chooses a part instead of posing the chosen bone**
- Steps: head bone chosen and bound to the pad, a corner chosen, Move tool. Drag on the face (800,300 → 760,280).
- What happened: no pose is written. Status: "face, 1 of 2. Click again for the next."; the focus becomes "face › no parameter" and the pad keyform is lost.
- Expected: a drag starting on the chosen thing (or a part on the chosen bone) moves it, and only a click walks through the parts. Only the small gizmo handles pose.
- Reproduced twice. Known: no.

**MR-3 · S2 · usability/docs · "Grid on a pad" cannot be reached before binding**
- Steps: create a pad. The pad alone shows only the Parameter section.
- What happened: the 2×2 / 3×3 / 5×5 select exists but is hidden (0×0). It appears in Keyforms only after a part is bound, by which time the grid is already 3x3.
- Expected (docs/rig-json.md): "chosen with **Grid on a pad** … before binding". Offer it in the Bind parts list or the pad's Parameter section.
- Reproduced twice. Known: no.

**MR-4 · S2 · bug/usability · The header says "no key here: a drag adds one" on pad corners that are keys**
- Steps: bind a part to a pad (3x3), then click a corner dot or leave the dot at 0,0.
- What happened: the header reads `head › head_turn @ head_turn_x 0, head_turn_y 0 · no key here: a drag adds one`, while the Pose block says "head at the corner head_turn_x 0, head_turn_y 0". Same at (-1,1) before the first drag. After a drag it says "· key".
- Expected: corners created by binding count as keys (they are in rig.json as 9 forms).
- Reproduced 3 times. Known: no.

**MR-5 · S2 · usability · The stage reframes itself when a pose changes the character's bounds**
- Steps: pose head_tilt at 1 (36°), or raise robo's arm_r at arm_r_lift = 1.
- What happened: mina's view went 65% → 64% and the character moved about 38 px left. Robo moved about 65 px right, then back when the arm went to rest. A click aimed at the mouth for its pivot landed elsewhere (pivot 329,323 instead of the mouth), and in another run a click chose "face".
- Expected: the view stays where the user left it (F fits on request).
- Reproduced twice. Known: no.

**MR-6 · S3 · usability · The focus header shrinks names to single letters for a pad keyform**
- Steps: a bone bound to a pad, at 1600 and at 1280.
- What happened: the header shows `h ▾ › h ▾ @ head_turn_x -1, head_turn_y 1 · …` and at 1280 `e. › l.. @ look_x 0, look_y 0 · no key here: a dr…`. The two values hog the line.
- Known: no.

**MR-7 · S3 · bug · The pad's top-right corner dot does not take clicks**
- What happened: a click at (123,298) does nothing. elementFromPoint there is `DIV.ap-padrow ap-active` (the active row with ↺ ✕), which covers the corner. The same corner works 2 px inside, and (123,408) works.
- Known: no.

**MR-8 · S3 · usability · Undo texts are vague or misleading**
- Undoing a rename of head_x says "Undid: 2 parameters", which reads like two parameters were removed.
- A range change says "Undid: parameter look_x".
- Re-pose, Add key and Remove key all read the same "keyform of arm_r on arm_r_lift", so the next undo cannot be told apart.
- Undoing the rename also drops the focus to "Nothing chosen".
- A min change shows only `Changed "eye_open".`
- Good: "Undid: parameter arm_r_lift removed" and "physics chain long_hair added" are clear.
- Known: no.

**MR-9 · S3 · usability · Delete parameter (row ✕) acts silently**
- One click removes arm_r_lift with its keyforms. The status only falls back to the generic hint, and no "Deleted arm_r_lift (1 keyform)" note appears. It is undoable, which saves it.

**MR-10 · S3 · text · Stale or noisy notes after New parameter**
- After New parameter: "Rename it and set its range under **Edit**…". There is no "Edit"; the section is "Parameter".
- Naming a brand-new parameter shows the full rename note ("Renamed to "eye_open" in the keyforms, pads, poses, animation tracks, deformers, masks and physics… Script lines that name "param" are not changed."), which is noise for a fresh control.

**MR-11 · S3 · usability · Save as look gives no confirmation**
- The look list gains "mylook", but there is no status note, the select stays on "(default)" and the name field clears.

**MR-12 · S3 · usability · Pad axis slider names are truncated so they cannot be told apart**
- Under pad `head_turn` both axis rows read "head_turr" (head_turn_x / head_turn_y clipped) at 1600.

**MR-13 · S3 · text · "No parts are bound to head_turn yet" on robo, whose head moves with the pad**
- The head is keyed on head_x and head_y separately, so the hint is technically right but suggests the pad is unrigged.

**MR-14 · S3 · polish · Layout nits**
- The empty-state text in Parameters on mina is flush against the left edge (x=0, no padding).
- The active row's name is clipped at x=10.
- The bind list shows 18 of 28 rows and needs a scroll; fine but not obvious.

## What works well
- New parameter / New pad focus and select the name; a pad creates its two axis parameters in one step with a clear note.
- The status line after Bind tells exactly what to do next ("Click a key … then pose eyes with the gizmo (W, E, R) there").
- Bind parts list: filter, "and what hangs on a ticked bone", and a "Bind 1" count on the button.
- Rotating past half a turn works (70 → 289.5°).
- The physics chain fields are readable, a bad output is flagged inline, and the antenna swings visibly when head_x moves.
- Save as pose names the script line to use it. Reparenting gives a one-line explanation.
- Apply, close and reopen kept everything; rig.json matched what was made.
- Undo messages for add/remove of poses, looks and chains are clear.
- The layout holds at 1280x800.
