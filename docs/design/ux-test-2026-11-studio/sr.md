# SR report: Model mode rigging (as returned by the tester)

Counts: S1 1, S2 10, S3 13. Scripts s01..s47 (helpers h.mjs, setup.mjs) and the screenshots are in scratchpad/ux/sr (paths below relative to it).

## Scope
1280x800 only. Characters mina (a fresh copy each run) and robo; tasks 1-9. mina has no arms (her 16 bones are the head and 15 hair strands), so arm
mirroring was tested on robo. Not covered: other viewports, Mask keying and Warp point editing (the Warp section was only opened on robo), Weights,
Physics Shake judged by eye, touch, screen readers, Animate mode. No page or console errors in any run.

## Task log
1 Orientation: done (about 2 min). The first screen gives three different first steps, one of them wrong (SR-14).
2 Make parameters: done with friction (about 8 min). New parameter, rename by Enter, range with validation, default, ease, category, pad, delete with
undo all work; each Tab or Enter commit throws keyboard focus out of the form (SR-9).
3 Bind and pose, parameter first: done with friction. Bind parts… on the head bone with "what hangs on it" bound 5 targets; W and E drags write keys.
A click on a key in the Keys row turns off W/E/R and Ctrl+Z (SR-2). Dragging the slider to 0.53 and then the part made a key at 0.53 (SR-18).
4 Part first: done with friction, partly blocked. Bind to parameter… and Moved by work. Ctrl-click works only on parts already bound, with no feedback
(SR-4); Alt-click follows the click cycle (SR-7); choosing a part drops the active parameter (SR-3); a bound part that hangs on a bone (eyes) cannot be
posed with the gizmo at all (SR-1).
5 Copy and mirror (robo's arms): done with friction. Mirror flips the parameter's range end for end (SR-11). Ctrl+Z did nothing after a key click; the
Undo and Redo buttons worked. Unbind and its undo are fine.
6 Bones and pivots: done. Pivot tool, Pick on stage / Done picking, Same pivot for…, rename, reparent, Remove bone, New bone all work; several say
nothing (SR-15); Remove bone leaves a physics reference behind (SR-5).
7 Poses, physics, reactions: done. Save as pose works; Physics is a JSON editor (known); the ribbon preset names parameters mina does not have
(SR-22); Add reaction pre-fills `speaking` and the saved pose.
8 Persistence: done. Parameters, 5 keyforms, the pose, the reaction and the bone edits survive Apply, Close and reopen. Problems 3 → 4 (a dangling
physics output). Apply reformats rig.json (SR-20).
9 Robo: done with friction. A head_x key at 1 with a rotate drag gave rot 8 → 23 cleanly. With breathe and the warp-bound torso the panel
contradicts itself (SR-8); the Warp section starts at y=726 (SR-10).

## Findings
SR-1 · S1 · usability · A part that hangs on a bone can be bound to a parameter but not posed with the gizmo. s43, s44 on mina with a new `eye_x`:
Bind parts… → eyes → key 1, then W, E and R drags. Each says "Nothing was written: head is not bound to eye_x yet. Use Bind parts… and tick it, then
pose again."; the gizmo sits on the head pivot (665,376), not on the eyes. Following the advice binds the head, which moves face, bangs and mouth too;
giving eyes a pivot of their own changes nothing; only typing in the Pose fields writes eyes' keyform (dx 0.02 stored, the stale "Nothing was written"
note stays). Same cause: s42, a pad bound to eyes ("then pose eyes with the gizmo (W, E, R)"); s40, robo torso under breathe ("spine is not bound").
rig-json.md says Move, Rotate and Scale pose the bone "and the line over the stage says so"; the only text over the stage is the zoom hint (s47).
Expected: for eyes, mouth or bangs moving on their own (the core Cubism case) the gizmo poses the bound part, or the bind offers to bind the bone.
Evidence: shots/s43-eyes-drag.png, s42-pad-bound.png. Reproduced twice (mina) and twice (robo). Known: partly (the bone rule is in rig-json.md
"Authoring keyforms"; the missing stage line and the dead end are not).

SR-2 · S2 · bug/a11y · A click on a key in the Keys row (or Enter on one) moves focus to the page body, outside the studio. s13: E and R ignored after a
key click (the tool stayed Move); s27, s28: Ctrl+Z after a key click did nothing (Redo stayed disabled), the Undo button worked; s45: Enter on key -1 →
`document.activeElement` = BODY. This breaks the flow the status bar teaches ("click a key and pose the part with the gizmo (W, E, R) · Ctrl+Z undo").
Reproduced 4 times. Known: no.

SR-3 · S2 · bug · The ◆ on a parameter row cannot add a key for the chosen part. s42, s43: choose top or mouth (stage or tree), click ◆ on
`mouth_open`/`eye_x`, whose title says "Add a key for the chosen part on X at this value (binds the part first when it is not bound)": "Choose a part or
bone first…". The click makes the parameter the focus, and the focus rule drops the part. Related, by design but felt (s19, s20): a stage click on an
unbound part sets Keyforms to "Active parameter none", and choosing the parameter again clears the part. rig-json.md step 4 promises the ◆ works.
Reproduced twice. Known: partly (the one-focus rule is documented; the ◆ break is not).

SR-4 · S2 · usability · Ctrl-click adds parts silently, and one unbound part makes the whole drag write nothing. s22, top bound to breath: Ctrl-click
bottom on the stage and legs in the tree: no note, the breadcrumb still "top › breath", no change in the tree highlight or the Bound list; only the
stage un-dims them. The drag then says "Nothing was written: bottom, legs are not bound to breath yet", and top is not written either. Bound first
(s23), the same drag works ("Wrote 3 parts…"). The status-bar hint does not say the parts must be bound. Evidence: shots/s22-multi.png. Reproduced
twice. Known: no.

SR-5 · S2 · bug · Remove bone leaves physics outputs pointing at the deleted bone, with no warning. s31, s38: Remove bone on hair_4_2: no note, no
confirmation. After Apply rig.json still has `physics.strand_4.outputs[2] {"part":"hair_4_2"}`; the rig.json tab warns "no part or bone named
"hair_4_2"" and Problems goes 3 → 4; the studio's Physics section shows nothing. Deformer weights were cleaned, and rename does follow physics ("the
name followed in … 1 physics output"), so remove is inconsistent with both. Reproduced twice. Known: no.

SR-6 · S2 · usability · The bind marks in the Parts tree look like checkboxes but do nothing. s41, s42: with a parameter active every row shows an
empty 18x18 bordered box; a click on it, or an Alt-click on head's, does nothing and says nothing. In code it is `span.as-bind role="img"`, a display
(read anim-tree.ts:128). A Cubism user will click it to bind. TODO.md line 187 still says Alt-clicking a bone's tick binds the subtree. Reproduced
twice. Known: no.

SR-7 · S2 · usability · Alt-click right after a click gives the bone of the *next* part in the cycle, not of the part on show. s23, s24: click face →
"face, 1 of 2"; Alt-click the same spot → hair_back (it has no bone, so the part itself), note "hair_back, 2 of 2". After choosing face from the tree,
Alt-click gives head (correct). Alt-click on the skirt (no bone) silently chooses the part. The note never says a bone was chosen or that the part has
none. Reproduced twice. Known: no.

SR-8 · S2 · usability · The breadcrumb says "no key here: a drag adds one" where that is false. s40, robo: breathe active, torso (bound by its warp,
keys at 0 and 1) chosen with Move: "torso › breathe @ 0 · no key here: a drag adds one", but the drag writes nothing ("spine is not bound"). s42,
mina: a pad with a 3x3 grid on eyes: "@ look_x 0, look_y 0 · no key here" while the Pose line says "eyes at the corner look_x 0, look_y 0" and the
Bound list shows 9 keys; the crumb wraps to a second line. Copy keys and the Pose fields are still shown for the warp-bound torso. Reproduced twice
each. Known: partly (studio-inspector.md fault 4; step 0 fixed the hint text, not the crumb).

SR-9 · S2 · a11y · Committing a field with Tab or Enter drops keyboard focus to the dialog card. s04, s05: after a change, Tab or Enter moves focus to
`DIV.as-card` (default, min, the name with Enter, the category name with Enter); only an unchanged min tabs on to Maximum. Entering name, range and
default from the keyboard needs a click per field. Reproduced 4 times. Known: no.

SR-10 · S2 · usability · The Keyforms section alone is taller than the window, and the gizmo's own block is below the fold. The scroll box
(`.as-inspect`) is 724 px. Keyform focus: mina head 1323 px (Keyforms 820); robo head 1255; robo with the Warp tool 1986, Warp starting at y=726;
Physics opened 3484 (Physics 2153 px of six JSON textareas; the column scrolls itself there). Copy keys, Moved by, Bind to parameter… and all of
Properties are below the fold in every keyform state. Known: yes (studio-inspector.md items 1-3; TODO physics JSON).

SR-11 · S2 · usability · Mirror copy flips the parameter range, so a one-sided parameter is posed at rest. s27, robo: a new `arm_l_lift` (0..1), arm_l
bound, Copy keys from "arm_r on arm_r_lift" with mirror: arm_l at 0 (the default) is rot -70 and at 1 rot 0, so the rest pose has the arm raised and it
lowers as the slider rises. Without mirror: at 1 rot +70 (the wrong side). No choice gives "lift at 1, mirrored"; the tooltip explains the flip "as for
the left and right of a face", but there is no values-only mirror. Reproduced twice. Known: no.

SR-12 · S3 · bug · A tool key followed at once by a stage action uses the old tool. s17: E, then a drag within about 0 ms ran as Move (dx 0.1448 →
0.9902, the head left the stage); with a 50 ms wait the drag rotates (rot 41.4). s30: Q, then an immediate click set no pivot; with 300 ms it worked.
Reproduced twice.

SR-13 · S3 · usability · Esc with focus in the stage does nothing (no deselect, no close guard), s25; elsewhere the first Esc shows the guard and the
second closes and discards. The status bar says "Esc close". Known: partly (ES-15).

SR-14 · S3 · usability · The first screen gives conflicting first steps (s01). Parameters says "Add them in Model mode" (you are in it); Keyforms says
"New parameter adds a slider" (the button is a + whose menu holds New parameter); the status bar says "Pick a parameter, press Bind parts…" with no
parameters yet; Properties says both "Click a part or a bone on the stage" and "Choose a part or a bone in the tree"; "Same pivot for…" is enabled with
nothing chosen (it answers "Choose a part in the tree first.") while "Pick on stage" next to it is disabled. Later, "Click the name of a parameter
above" points up, but the parameters are in the left column. Known: partly (ES-9).

SR-15 · S3 · usability · Several Model edits give no message or leave the old one (s31, s44). Same pivot for… applies on each tick with an empty status
line, and its list has no title or OK; Remove bone: empty status; Under (reparent): the old rename note stays; New bone makes "bone" with no pivot,
focus goes to the card, not the Name field, the old note stays; a value typed in a Pose field is written but "Nothing was written" stays. Undo and Redo
never update the note. Known: partly (ES-5).

SR-16 · S3 · usability · The Pose row and Properties use different units, explained only on hover: Pose x/y are a fraction of the stage (a 50 px drag
at 32 % zoom gives 0.1448), sx/sy are "added to 1" (0 means unchanged), the pivot in Properties is in PSD pixels. Known: partly (ES-7).

SR-17 · S3 · usability · A drag inside the rotate ring chooses a part instead of rotating (s15: "face, 1 of 2"); in Spine and Cubism a drag anywhere
rotates. Seen once.

SR-18 · S3 · usability · Scrubbing the slider lands on odd values, and a drag there makes a key (s18: a key at 0.53, head now has 4 keys); the crumb
does warn first. Seen once.

SR-19 · S3 · usability · The Bind parts… list order differs from the Parts tree: bones first, then parts in reverse draw order; it shows 9 of 25 rows
(196 px). Evidence: shots/s08-picker.png.

SR-20 · S3 · usability · Apply rewrites rig.json's formatting, and its note implies the file is not saved yet. s34, s38: removing one bone turned a
170-line file into 391 lines (mesh weights from one line to three per vertex: a 375-line diff). The note says "Ctrl+S saves", but the file on disk had
already changed. Reproduced twice.

SR-21 · S3 · bug · Ctrl+Z in a focused Pose number field does the browser's text undo, and leaving the field writes that as a new edit. s28: rot 12 →
Ctrl+Z showed 0 (Redo stayed disabled); after leaving the field the studio's undo brought back 12 and enabled Redo. Seen once.

SR-22 · S3 · usability · The physics preset "ribbon" names parameters mina does not have (inputs `angle_z`, output `ribbon_sway`); a JSON error shows
only in the status line, the textarea is not marked. Known: partly (TODO: number-field editor instead of JSON).

SR-23 · S3 · visual/a11y · The breadcrumb has 0 left padding (it touches the column edge at x=941) and wraps for pads; a disabled "Add key here" is
shown on the default key, where it cannot be removed and nothing says why; Keys ‹ › are 18x22 px; the tree's eye and bind marks are 18x18. Known:
partly (ES-19).

SR-24 · S3 · docs/consistency · Renaming is "name … Apply" for a parameter but "Name … Rename" for a bone, and the header has its own Apply.
rig-json.md says New pad has "nothing picked for you, and Create pad waits until both are chosen"; both default to "＋ New parameter" and Enter creates
the pad. TODO.md line 187: the tick claim (SR-6).

## The right column, state by state
1280x800; the scroll box is 724 px high; a folded header is 35 px.

| State | Open sections (px) | Total | Below the fold |
|---|---|---|---|
| mina open, nothing chosen | Keyforms 139, Properties 202 | 515 | nothing (blank pivot fields shown) |
| mina parameter active, nothing bound | Keyforms ~270, Properties 202 | ~650 | nothing |
| mina part chosen, no parameter (s19) | Keyforms 248, Properties 334 | 755 | Reactions header |
| mina head keyform, Move (s09) | Keyforms 820, Properties 330 | 1323 | Copy keys, Moved by, Bind to parameter…, all of Properties |
| mina pad on eyes (s42) | Keyforms 605, Properties 334 | 1113 | Properties |
| mina Pivot tool, face, Same pivot list (s30) | Keyforms ~230, Properties ~280 | ~690 | nothing (Keyforms says "none", not useful here) |
| robo head keyform (s39) | Keyforms 710, Properties 371 | 1255 | Copy keys onward, Properties |
| robo torso/breathe, Move (s39) | Keyforms 548, Properties 271 | 992 | Properties; Pose fields shown that do not apply |
| robo torso, Warp tool (s40) | Keyforms 450, Properties 229, Warp 1168 | 1986 | almost all of Warp (starts at y=726) |
| head keyform + Physics opened (s32) | Physics 2153 | 3484 | everything else; the column auto-scrolled |
| + Reactions opened | Reactions 258 | 3707 | — |

On studio-inspector.md. Supports the plan: verbs are spread out (Bind parts… mid-block, Bind to parameter… and Copy keys below the fold); Pose fields
show for a warp binding; Physics is a column of its own; a shown-but-useless "Same pivot for…" belongs in a Pivot tool bar. Not covered by the plan:
focus loss after a key click (SR-2); whether the gizmo poses the part or its bone (SR-1): the focus header should say what the gizmo writes to ("gizmo:
head"); the breadcrumb's wrong "no key" (SR-8).

## What worked well
- The Bind parts… picker: the filter has focus on open, "and what hangs on a ticked bone" is offered, the button says "Bind 1", the note says "Bound 5
  targets … (Ctrl+Z undoes it)".
- Specific notes: a rename lists everything that followed it and says script lines are unchanged; deleting a pad keeps its parameters; "Nothing was
  written: X is not bound" is explicit rather than silent; Save as pose gives the `show mina pose=look_right` line.
- The breadcrumb with Keys ‹ › (when correct) orients well, and the slider shows tick marks at keys.
- Range validation refuses min > max with a clear message.
- Undo is one step per drag; parameter delete, unbind and copy undo cleanly.
- Persistence: everything survived Apply, Close and reopen; no run had page or console errors.
- Copy keys offers parts on other parameters and maps ranges.
- The Pivot tool's hint ("Click the stage where the part should turn. The character is shown at rest.") and cycling overlapping parts (face ↔ hair_back) work.
