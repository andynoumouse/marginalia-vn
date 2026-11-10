# SA report: Animate mode and the studio frame (as returned by the tester)

Counts: S1 1, S2 9, S3 11. Scripts s01..s30, a helper, the a11y dump and the screenshots are in scratchpad/ux/sa (paths below relative to it).

## Scope
Viewports 1920x1080, 1440x900, 1280x800 (main), 1024x700, 900x700, 390x780, plus resizing 1280 → 1024 → 900 → 390 → 1280 with the studio open.
Characters robo (most tasks) and mina (frames, Tab order).
Covered: opening from the Files panel, a script line (right-click, F12) and Ctrl+P; play, loop, scrub; a new animation; gizmo keys with Auto-key on
and off, and Key; key select, drag, nudge, delete; ease; Length; parameter slider and pad keys; Save as pose; a frame track on mina's mouth slot; Place
on stage, Copy, Try in scene; Apply, Close (and its guard), reopen; undo/redo across animations and across the Model | Animate switch; six window sizes;
docking by drag and Alt+arrows, Reset layout, reopen, narrow with a moved section; Tab order, the a11y tree (ariaSnapshot), contrast samples, target sizes.
Not covered: Export..., Model-mode editing beyond the mode switch, touch, a real screen reader, "Insert in script" with no script open.
No page or console errors in any run.

## Task log
1 Look at an animation: done with friction. Files panel → Animate about 2 s including the page load; F12 on `animate robo wave` 85 ms;
right-click → "Open in Animation Studio (F12)" 0.7 s; both script routes open on `wave` with Try in scene. Picking, Play, Loop and scrubbing work.
Stalls: the Properties values do not follow the playhead (SA-2); Space does nothing after a click on the stage (SA-3).
2 Make an animation: done with friction. New animation in 3 steps (⋯, New animation…, type + Enter); the first key is one gizmo drag; Auto-key off →
"Not keyed yet…" → Key → "Keyed arm_r at the playhead (0 s)."; key drag, ease and Length work; the lean slider ◆ makes a lane, a pad drag + ◆ makes
head_x and head_y lanes; Save as pose says how to use the pose; mina "Frames from this slot" on mouth makes 3 blocks, Duplicate works; Place on stage +
drag gives `show robo at 0.288`, Copy puts it on the clipboard; Try in scene applied, closed and played robo.vn:13 in the preview; Apply, Close,
reopen work (reopen lands on `blink`). Stalls: Delete after clicking a key or block (SA-4); a one-key pose drifts back to rest (SA-5); keyed parameter
lanes hidden below the timeline's visible area (SA-8).
3 Undo/redo: done. Steps are small and redo works; undo still changes animations that are not on screen, and Animate data from Model, silently (SA-9, ES-5).
4 Window sizes: done. Stage box 1920x1080: 1256x629; 1440x900: 776x449; 1280x800: 616x328..349; 1024x700: 400x266 (character at 21 %); 900x700:
876x252 starting at y=839 (below the fold); 390x780: 366x281 at y=911 (below the fold). The transport row overflows at 1024 and 390 (SA-7); the wheel
zooms the stage instead of scrolling the narrow layout (SA-6).
5 Docking: done with friction. Alt+arrows work, Reset layout appears after a change; a drag onto a section works, into a column's empty part does not
(SA-14); the layout survives close/reopen; narrow windows show the default layout as designed.
6 Keyboard only: blocked forward, workaround backward. Ctrl+P → `studio` → Enter opens mina (first row), ArrowDown + Enter robo; 48 Tabs to robo's
tree, arrows + Enter choose arm_r. Tab enters the stage iframe (stop 104) and never leaves; Esc and Space do nothing there (SA-1). The only way on is
Shift+Tab past the top (about 87 presses), wrapping to the end, then backward to Properties. Keys can be nudged and deleted only after choosing one in
the Properties "Key" select and pressing Shift+Tab 8 times (SA-4).
7 Accessibility basics: done (SA-11, ES-19). Muted text measures 5.6:1. Focus rings on everything but the three resize separators and the iframe.
8 November re-check: done (below).

## Findings
SA-1 · S1 · a11y/bug · The stage traps the keyboard: Tab, Shift+Tab and Esc cannot leave it. s12-taborder.mjs, s13-iframe-trap.mjs, s14-kbflow.mjs,
s15-kbflow2.mjs. From Auto-key, Tab moves focus into the stage iframe (stop 104 of the dialog); the next 156 Tabs and any Shift+Tab leave
`document.activeElement` on the iframe (inside it, its BODY stays focused). Esc does not close the studio and Space does not play while there. Play,
Loop, scrub, Length, the timeline, Properties, Frames, Place and Apply all come after the stage in Tab order, so they are unreachable going forward.
Cause (read the code): the stage page runs the game's global keydown (`preview/preview.ts`, about line 987), whose hotkeys map `Tab` to
`toggleSkip()` with `preventDefault` (Shift+Tab too); the gizmo's `onKey` (`preview/studio-gizmo.ts`) takes Space for panning and forwards Esc only
for the deform tools. Expected: Tab moves on to Play, Esc closes as the hint says (WCAG 2.1.2 No Keyboard Trap). Evidence: s12 output. Reproduced
twice. Known: no.

SA-2 · S2 · bug · Properties "At the playhead" values do not follow scrubbing or playback. s06-playhead.mjs, robo `wave`, arm_r chosen (rot keys 135
at t 0.25 and 0.85). Dragging the scrub to 0.27, 0.55 and 0.94 s left the fields at x 0, y 0, scale 0, rot 0, opacity 1; after a click on a key they
showed rot 134.9987 and kept it during Play (0.26, 0.52, 0.78 s). In s05 a one-key animation showed rot 44.89 at t=1 while the stage and curve were
at rest. Expected: the value under the playhead; a Spine or AE user types into them believing they show it. Evidence: shots/06-wave-scrub-1.png,
05-one-key-curve.png. Reproduced twice. Known: no.

SA-3 · S2 · usability · After a click on the stage, Space and Esc stop working although the hint says "Space play or pause · Esc close". s07-timeline.mjs:
a click on the stage (the usual way to choose a part) leaves focus in the iframe; Space leaves the time at 0.00 and the button on Play; Esc leaves
the studio open. Tool letters (W/E/R/X/F) still work (the stage forwards them). Expected: Space and Esc work wherever the pointer last clicked, or
the hint says otherwise. Reproduced twice. Known: no. Same cause as SA-1.

SA-4 · S2 · usability · A mouse click on a key or frame block does not focus it, so Delete and the arrows do nothing. s07-timeline.mjs,
s25-frames.mjs, s28-keykb.mjs. The key's own label says "Arrows move it, Delete removes it"; after a click focus is on the dialog DIV and Delete
leaves the key list unchanged; the same for a mouth block after Duplicate. Only the selected key has `tabindex=0`, so with nothing selected no key is
in the Tab order. Working path: choose the key in the Properties "Key" select, Shift+Tab 8 times to the diamond, then ArrowRight (t 0.25 → 0.26) or
Delete; after Delete focus falls back to the dialog. Expected: click a key, press Delete (Spine, AE). Evidence: shots/28-key-kbfocus.png. Reproduced
twice. Known: no.

SA-5 · S2 · usability · A single pose key slides back to rest; bone channels and parameter lanes behave differently. s05-key2.mjs: new animation,
arm_r rotated 45° at t=0 with Auto-key: the rot curve eases from 45 to 0 by t=1 and the stage shows the arm at rest at the end; a parameter key
(lean 0.64 at t=0, s08) holds flat to the end. The rule is in docs/rig-json.md ("Every channel is 0 … at t=0 and t=1 unless a key there says
otherwise"); nothing in the studio says it, and the "At the playhead" fields (SA-2) claim 44.89 all along. Expected: a held pose, or a visible
implicit rest key or note at the ends. Evidence: shots/05-one-key-curve.png. Seen in s04 (x key) and s05 (rot). Known: no.

SA-6 · S2 · usability · In the narrow layouts the wheel stops scrolling at the stage and zooms the character. s19-phone.mjs at 390x780, pointer at
(200,600), wheel 200 per step: the column scrolls until the stage reaches the pointer (stage top 911 → 511), then 30 wheel steps zoom the stage from
30 % to 5 % and the page no longer scrolls. The 900 px layout has the stage in the same scrolling column. Expected: the page scrolls past the stage,
or zoom needs a modifier while the column scrolls. Evidence: shots/19-phone-stage-1.png. Reproduced twice. Known: no (ES-4 covers the narrow layout
in general).

SA-7 · S2 · visual · The transport row overflows at 1024 px and at phone width; Length is covered or off screen. s17-sizes.mjs, s17b-sizes-narrow.mjs,
s30-1024.mjs. At 1024x700 the Length input spans x 707–771 but its row ends at 724 and the Properties column starts at 725: 17 px of the field
show, `elementFromPoint` on its right part hits the column, the "s" unit is hidden; the row's scrollWidth is 483 against 424. At 390x780 the card
scrolls sideways (483 vs 390) and Length sits at x 407–471, off screen. Expected: studio-ux.md principle 6 (holds at a 1024 px window and at phone
width). Evidence: shots/17-size-1024x700.png. Seen at both widths (1024 measured twice). Known: no.

SA-8 · S2 · usability · The five whole-character lanes always take the timeline's top, so keyed parameter lanes and the ruler sit below its visible
area. s09-frames-place.mjs, s10-lanes-scroll.mjs, a new animation with 5 parameters keyed: the lanes x, y, scale, rot, opacity of the whole
character are empty, 52 px each; at 1280x800 the timeline viewport is 304 of 536 px, so only `lean` shows, and head_x, head_y, eye_open, breathe and
the ruler (y=988) need scrolling. At 1920x1080 410 of 536 px show and the ruler is again out of view; the ruler scrolls away with the lanes.
Expected: empty lanes fold, or new keys scroll into view, with a sticky ruler. Evidence: shots/09-many-lanes.png, 10-lanes-1280.png. Reproduced at
two sizes. Known: no.

SA-9 · S2 · usability · Undo still edits animations and modes that are not on screen, without a word. s22-undo.mjs: `wave` Length 3, switch to `nod`,
Undo button: the view stays on nod, the status shows only the hint; wave is back to 1.1 when you look. Type rot 20 on arm_r in Animate, switch to
Model, Ctrl+Z: the Animate key is gone, no message. The Undo and Redo buttons have empty titles. Reproduced twice. Known: yes (ES-5).

SA-10 · S2 · usability · Times are fractions of Length throughout. s07-timeline.mjs, s25-frames.mjs, s28-keykb.mjs. Length 1 → 2: "rot key at t
0.25" stays at t 0.25 (moves from 0.25 s to 0.5 s); the Key select lists "t=0.25 rot 135"; frame blocks read "from t=0.0833"; the ruler of the 1.1 s
`wave` reads 0.28s / 0.55s / 0.83s; scale reads 0 at rest. Evidence: shots/07-length2-1.png, 28-key-kbfocus.png. Reproduced twice. Known: yes (ES-7).

SA-11 · S3 · a11y · What a screen reader gets for the tree, the timeline and Properties. s16-a11y.mjs, a11y-wave.yaml. The timeline is `role="img"`
(its key buttons become presentational), its label says "one lane for each of x, y, scale and rotation" while opacity, parameter and frame lanes are
there too; the scrub slider runs 0–1000 with no valuetext; the stage iframe has no name. Tree: bone fold buttons are named "▾" (the title "Hide the
bones under root" is not the name); a flat list of buttons with no level; each row costs 2–3 Tab stops (eye, fold, row): 50 for robo, about 100 for
mina, 103 Tabs from the dialog to Auto-key. Properties: "At the playhead" and "Key" give two sets of spinbuttons named x / y / scale / rot / opacity,
two "t" and two "Delete key", no group names. Section headings read "Move Poses: drag, or use Alt and the arrow keys Poses 3 poses". Moving a section
announces nothing. Reproduced (static). Known: partly (ES-19 for target sizes).

SA-12 · S3 · usability · The status line keeps its last message. "Keyed arm_r at the playhead (0 s)." stays after choosing the whole character,
dragging the key to t 0.25, changing the ease to back and changing Length. s07. Reproduced twice. Known: partly (ES-11 is the opposite case).

SA-13 · S3 · usability · A horizontal key drag also changes the value. A 139 px drag with no vertical movement moved the key t 0 → 0.25 and its value
rot 44.8949 → 45.4015. s07. Reproduced twice. Known: no.

SA-14 · S3 · usability · Dropping a section in the empty part of a column does nothing. Dragging the Parts grip to 40 px below Place in scene showed
no drop line and left the layout unchanged; onto the Frames head or the Properties body it worked. s20-dock.mjs, s21-dockdrag.mjs,
shots/21-dock-dragging-empty.png. Reproduced twice. Known: no.

SA-15 · S3 · usability · Reopening forgets the animation you were on: after Apply + Close on the new `look`, reopening robo shows `blink`. s09. Seen
once. Known: partly (ES-14).

SA-16 · S3 · usability · Esc inside a field closes the whole studio: typed 2 in Length without Enter, pressed Esc, the studio closed (no guard, since
nothing was committed). Expected: Esc cancels the field edit first. s27-keyfocus.mjs. Reproduced twice. Known: no.

SA-17 · S3 · usability · Ctrl+Z does nothing while focus is in a number field; Length keeps focus after Enter, so the hint's "Ctrl+Z undo" does not
apply until you click elsewhere. s22. Reproduced twice. Known: no.

SA-18 · S3 · usability · "Frames from this slot" ignores Length: mina's mouth slot gives 3 frames at 12 fps (open 0–0.083, smile to 0.167), then
neutral holds the remaining 0.83 s of a 1 s animation; no option to loop the frames or fit them to Length. Before any track exists the Frame editor
already shows enabled Duplicate / Earlier / Later / Delete. shots/25-frames-filled.png. Seen once. Known: no.

SA-19 · S3 · usability · The tree is not one Tab stop although arrows already move through it (arrows move focus without choosing, Enter chooses);
every eye and fold button is its own stop, the main reason the stage sits 103 stops in. s11-keyboard.mjs, s12. Reproduced on mina and robo. Known: no.

SA-20 · S3 · usability · Auto-key and Key have no key letters, and Play's tooltip does not mention Space (the transform tool tooltips give letters).
s29-titles.mjs. Known: no.

SA-21 · S3 · docs · docs/rig-json.md "The studio" lists Animate's right column as Properties, Parameters, Frames and Place in scene; by default Poses
and Parameters are in the left column (studio-ux.md line 264 says so, but its ASCII Layout diagram still shows Parameters on the right). Neither doc
mentions the return to rest at t=1 in the studio's text (only in the animations section) or that the stage swallows Tab, Space and Esc. Known: no.

## November findings, re-checked
- ES-2 · changed (mostly fixed). Right-click on `animate robo wave` starts with "Open in Animation Studio (F12)"; Ctrl+P `studio` lists "Animation
  studio: mina / robo"; the CHARACTERS heading is at y=526 at 1280x800 (was 802). Still: hover on the line shows nothing; at 900 px the Files panel is
  behind a Files button.
- ES-4 · still. 900x700: stage at y=839 (card scroll 1950); 390x780: y=911; 1024x700: 400x266, character at 21 %.
- ES-5 · still (SA-9).
- ES-6 · fixed. Model mode no longer shows the Automatic block.
- ES-7 · still (SA-10).
- ES-9 · still. At first open "Click a part or a bone on the stage" sits above 5 blank "At the playhead" fields, a blank Key row and a disabled Parameter key row.
- ES-10 · still. A parameter takes 3 lines in the 300 px column: name + value + ◆, the slider, then a full-width ↺ bar.
- ES-11 · fixed. Key says "Keyed arm_r at the playhead (0 s).", but that message then sticks (SA-12).
- ES-12 · fixed. `elementFromPoint` at the centre of a key at t 0.5 is the key, and a centre click selects it (2 runs).
- ES-13 · still. With arm_r chosen the rest of robo is near-black while playing (shots/26-playing-armr-1.png).
- ES-14 · still. robo opens on the 0.12 s `blink`, also after Apply, Close and reopen.
- ES-15 · still. The guard is a 12 px status line in rgb(139,147,163); the Close button does not change; Esc then discards.
- ES-19 · still. The While input and Model's bone Name input still have the grey fill. Small targets: 21 eye buttons 18x18, fold buttons 26x22, the
  Loop checkbox 13x13, keys 14x14, column grips 6 px wide.
- ES-20 · still. In Model the stage grows to 616x670 while the character stays at 32 % (shots/22-model-1.png).
- ES-21 · still. Alt+Left on Properties opens a second left column ("left2") and the stage shrinks from 616 to 316 px wide; Alt+Right from the left
  column also goes to left2, not to the right column; nothing is announced.
- Also seen: ES-16 fixed (robo.vn's comment says "switch to Model mode").

## What worked well
- Script line to studio and back: F12 opens in 85 ms on the right animation with Try in scene; Try in scene applied, closed and played the scene from robo.vn:13.
- New animation: the inline name form (default "anim" pre-selected, Enter) is quick; the ⋯ menu works from the keyboard.
- Auto-key off is clear ("Not keyed yet: press Key…", then "Keyed arm_r at the playhead (0 s).").
- Gizmo handles are easy to grab; the tree's "◆ keyed" badge appears at once; opening `wave` chooses the part it keys.
- Slider and pad keying each make a visible lane; Save as pose names the script line to use.
- Place in scene: a drag writes the `show` line, Copy confirms with "Copied the show line."
- On a selected key, arrows nudge (Shift for bigger steps) and Delete removes it, with a clear teal focus ring. Tooltips give tool letters; focus
  rings on all buttons and fields; the action menu works with arrows.
- Docking: Alt+arrows and Reset layout work, the layout survives reopen, narrow windows fall back to the default layout as designed.
- No document scroll bars and no page or console errors in about 30 runs.
