# KL report: the studio frame (sizes, docking, keyboard only) and a re-check of round 2 (as returned by the tester)

Counts: S1 0, S2 2, S3 7.

Scripts and screenshots were in the session scratchpad under `kit/testers/KL/` and were not kept.

## Scope
- **Viewports:** 1920x1080, 1440x900, 1280x800, 1024x700, 900x700 and 390x780, in both modes. Each mode was also resized live through all of them and back to 1280 and 1920. A 1000x600 check was added for the ES-4 leftover.
- **Characters:** robo (Model and Animate) and mina (Model: Warp, Weights, Remove bone).
- **Covered:** docking (mouse drag, Alt+arrows, Reset layout, persistence across close/reopen and a page reload); a keyboard-only job in each mode, from the editor to Apply and Esc; Esc in fields and tools; Ctrl+Z from fields.
- **Re-check:** every S1 and most S2s from sa.md, sr.md and sd.md, plus TODO's studio line.
- **Not covered:** touch, Export, the standalone and Electron Studio, real-time playback smoothness. Physics and Reactions were not tested beyond Remove bone. Not re-checked: SR-4, SR-7, SR-8 and SR-11, nor SD-4 and SD-5.
- **Errors:** no page or console errors in about 25 runs.
- **Evidence:** a mid-session restart wiped the shots from scripts s01 to s14; their numbers below come from the script output.

## Task log
1. **Sizes, both modes: done with friction.**
   - Nothing becomes unreachable at any size, and live resizing causes no errors or broken layout.
   - Stage (iframe) size, Model / Animate: 1254x879 / 1254x717 at 1920; 614x569 / 614x407 at 1280; 478x469 / 478x273 at 1024; 874x250 at 900 in both; 396x279 / 364x279 at 390; 454x174 at 1000x600 in Animate.
   - The transport wraps cleanly at 1024 and 390.
   - Stalls: KL-1 (phone width, Model), KL-2 (Animate parameter rows), KL-5 (empty band above the stage).
2. **Docking: done, no friction.**
   - Dragging Poses by ⠿ to the right column landed it at the end.
   - Alt+Right on Parameters went to the second left column, with the note "Moved Parameters to a second left column, beside the first (Alt+Right again moves it to the right column, Alt+Left back)." Alt+Right again went to the right column, and Alt+Down said "Moved Parameters to place 2 of 7 in the right column."
   - Focus stays on the grab handle throughout.
   - Reset layout appears only once the layout differs from the default.
   - The layout survives Close, reopening in the other mode, and a full page reload. Reset puts everything back.
3. **Keyboard only, Animate: done with friction. About 138 key presses, about 14 s scripted.**
   - Ctrl+P, `studio`, ArrowDown, Enter opens robo.
   - ⋯ menu, New animation, typing a name: focus then lands in "Longest wait" (KL-6).
   - 40 Tabs reach the tree; arrows and Enter choose upper_r; E switches to Rotate.
   - Typing rot 30 + Enter writes a key and focus stays in the field.
   - Esc after typing 99 puts back 30 and the studio stays open.
   - Ctrl+Z with no edit pending: "Undid: kb2: key added on upper_r". Ctrl+Z on an uncommitted edit undoes the typing only.
   - Scrubbing with the slider's arrow keys moves 1/1000 of Length per press (KL-3).
   - Space in the stage plays; Tab leaves the stage to Play and Shift+Tab leaves it to World axes.
   - Apply via Tab and Enter, then Esc closes. rig.json holds kb2.
   - Timeline keys are reached through Properties > Key select (pick a key, then Shift+Tab 8 times to it). Arrows nudge it and Delete removes it.
4. **Keyboard only, Model: done. 188 key presses, about 7 s scripted.**
   - The Model button, then 34 Tabs to the `arm_r_lift` name (a focusable label); Enter makes it active.
   - 37 more Tabs to Bind parts…; filter `lower_r`, Tab, Space, Tab Tab, Enter on "Bind 1". The note reads "Bound lower_r to arm_r_lift: keys at 0, 1…".
   - Tab 7 times to key chip "1", Enter (focus stays on the chip); Tab 4 times to Pose rot; 40 + Enter.
   - Esc then warns "There are changes that were not applied… press Discard and close (or Esc)".
   - Shift+Tab 79 times to Apply. rig.json gets `{target: lower_r, param: arm_r_lift, keys: [{at:0},{at:1, rot:40}]}`.
   - Stall: KL-4 (the Close button still reads "Discard and close" after Apply).
5. **Re-check: done** (table below).

## Findings
**KL-1 · S2 · bug · In Model at 390 px the whole card scrolls sideways and the right edge is cut off**
- Steps: robo, Model, nothing chosen, window 390x780.
- What happened:
  - `.as-card` scrollWidth is 422 against clientWidth 390.
  - Cut off at the right edge: "Save as look" (right edge at 412), the Poses count ("3 po"), the Parameters `+` (394 to 422), the category `+` buttons, and every row's ◆ (right edge at 398).
  - The cause is the head_turn pad row's `.ap-btns`: 206 px wide (◆ ↺ ✕ keep their space while hidden). After the pad is chosen it is 174 px and the overflow goes.
  - Animate at 390 does not overflow (390/390).
- Expected: no sideways scroll at phone width, as in Animate.
- Reproduced twice. Known: no. It looks like a regression from "parameter row tools wrap when narrow".

**KL-2 · S2 · usability · In Animate every parameter slider row takes two lines at every window size, with its ↺ alone on the second line**
- What happened:
  - Robo, Animate, 1920x1080, nothing chosen: head_x, head_y, eye_open, arm_r_lift, lean and breathe are each 62 px tall in a 275 px column.
  - The same rows in Model are 32 px.
  - The left column shows half as many parameters, and the Parts tree is pushed down (at 1000x600 Parts is just a header at the bottom).
- Expected: one line per row unless the column is really narrow, or wrap only the chosen row, as in Model.
- Reproduced twice. Known: no. Probably a side effect of ec91760 ("the chosen row's tools drop to a line of their own when narrow").

**KL-3 · S3 · usability · Arrow keys on the scrub slider move 1/1000 of Length per press, so keyboard keys end up on top of each other**
- On `sway` (3 s): Right left the time at 0.00; Shift+Right moved to 0.01; PageUp to 0.31; End and Home work.
- In a new 1 s animation, 5 presses of Right moved to t=0.005. A key typed there sits on top of the t=0 key: rig.json got `{t:0, rot:30}, {t:0.005, rot:-20}`.
- Expected: an arrow press of one frame or 0.01 to 0.05 s, and the step stated in the hint.
- Reproduced twice. Known: no.

**KL-4 · S3 · bug · After Apply the Close button still reads "Discard and close" (red), while the note says the work was applied**
- Steps: make a change, press Esc (it warns about unapplied changes, and Close becomes "Discard and close"), then Apply.
- What happened: the note says "Applied to rig.json, which the editor saves at once…", but the button still says "Discard and close" 1.5 s later. A following Esc closes without asking, which is correct.
- Expected: the button goes back to "Close" on Apply. As it is, it suggests the work will be thrown away.
- Reproduced twice. Known: no (an offshoot of the ES-15 fix).

**KL-5 · S3 · visual · At 1280 px and below an empty band about 30 px tall sits between the tool options line and the stage**
- The stage iframe starts at y=162 at 1280 and 1024 (y=132 at 1440 and above), while the options text sits at y≈107.
- At 1000x600 that is 30 of a 174 px stage.
- At 1024 and 1000 the zoom label ("25% (wheel zooms…)") also covers robo's feet.
- Probably the reserved second line of the options bar ("two lines in a narrow window"), even when the text fits on one.
- Known: partly (ES-4).

**KL-6 · S3 · a11y · After naming a new animation with Enter, focus lands in the Automatic "Longest wait" field**
- After ⋯ > New animation… > type a name > Enter, the active element is `input.as-every-max`. A keyboard user's next keys go into a timing field.
- Expected: focus on the animation select or on ⋯.
- Reproduced twice. Known: no.

**KL-7 · S3 · usability · Space on a focused studio button presses that button instead of playing, although the hint says "Space play or pause"**
- With focus on the timeline ▾ button, Space folds the timeline; with focus on Rotate, it does nothing visible.
- rig-json.md says Space plays "wherever the focus is". Native button behaviour is reasonable here, but the docs overpromise.
- Known: no.

**KL-8 · S3 · a11y · The stage iframe and the three resize grips show no focus indicator**
- Tab onto the stage (stop 57 of 70 in Animate) leaves no visible ring on the stage. The grips have no outline or shadow.
- Known: yes (sa.md task 7).

**KL-9 · S3 · visual · Text that is cut off or touches the edge**
- The right column's focus line reads "Nothing in focus: choose a parameter, or a part on the st…" at 1280 to 1920.
- The Warp options line reads "Warp · torso · click a sli…" at 1440.
- Mina's "This character has no parameters yet…" sits flush at x=0 with no padding.
- The status line is cut before "Esc close" at 1024.

## Re-check of round 2

### S1s

| Finding | Status | Evidence |
|---|---|---|
| SA-1 (stage traps the keyboard) | **Fixed** | Tab from the stage goes to Play; Shift+Tab goes to World axes; Space in the stage plays (Pause, 0.60 s); the 70-stop Tab cycle wraps inside the dialog. |
| SR-1 (a bound part on a bone cannot be posed) | **Fixed** | lower_r (on forearm_r) bound to arm_r_lift. The options line says "poses lower_r · a drag writes its keyform of arm_r_lift"; Pose rot 40 is saved as lower_r's keyform. |
| SD-1 (no mesh without parameters) | **Fixed** | Mina has no parameters; Warp on bangs offers Generate mesh, enabled. |

### S2s

| Finding | Status | Evidence |
|---|---|---|
| SA-2 (At the playhead does not follow the playhead) | Fixed | Scrubbing wave/arm_r: rot 135 at 0.28 s, 9.49 at 1.06 s; the fields update during play. |
| SA-3 (Space and Esc dead after a stage click) | Fixed | After a stage click Space plays and pauses, and Esc closes. |
| SA-4 (a clicked key does not take focus) | Fixed | A click on a key focuses it (label "rot key at 0.28 s…"). Delete removes it and focus moves to the next key; Ctrl+Z restores it. |
| SA-5 (a single pose key slides back to rest) | Fixed | A hollow rest diamond is drawn at the lane end. |
| SA-6 (wheel zooms instead of scrolling in narrow layouts) | Fixed | At 390 the wheel over the stage scrolls the page (stage y 197 → -638); the label says "Ctrl+wheel zooms". |
| SA-7 (transport row overflows) | Fixed | The row wraps at 1024 and 390. Model at 390 overflows for another reason (KL-1). |
| SA-8 (empty lanes push keyed lanes down) | Fixed | Empty lanes fold to thin rows once something is keyed; the ruler stays put when the lanes scroll. |
| SA-9 (undo edits what is not on screen) | Fixed | Undo while on `nod` switched back to `wave`. The note reads "Undid: wave: key on arm_r changed" and the Undo button's tooltip names its step. |
| SA-10 (times are fractions of Length) | Fixed | Times show in seconds: "1.5 s · rot 2", "rot key at 0.28 s". |
| SR-2 (Keys row drops focus) | Fixed | Enter on key chip "1" keeps focus on it. |
| SR-3 (◆ cannot key the chosen part) | Fixed | ◆ on arm_r_lift with upper_r chosen keeps upper_r and says the gizmo poses its bone arm_r. |
| SR-5 (Remove bone leaves physics outputs) | Fixed | The note: "Removed hair_4_2; the weights of 1 skinned mesh went to hair_4_1; 1 physics output that moved it went with it. Ctrl+Z brings it back." |
| SR-6 (tree bind marks look like checkboxes) | Fixed | Plain ✓ marks. |
| SR-9 (committing a field drops focus) | Fixed | Enter keeps focus in the field. |
| SR-10 (Keyforms taller than the window) | Fixed | The Pose block sits at y≈200. |
| SD-2 (Esc closes with points selected) | Fixed | With Warp on and 12 points chosen, Esc from the right column clears the selection; a second Esc goes to Move; a third closes. |
| SD-3 (bone chip drops focus) | Changed, could not check | The bone chips are now a select in the tool options bar. |
| SD-6 (deform tool controls below the fold) | Fixed | The Warp controls are in the options bar and the Pose and Warp blocks sit at the top. |
| SR-4, SR-7, SR-8, SR-11, SD-4, SD-5 | Could not check | Out of time. |

### Other items

| Item | Status | Evidence |
|---|---|---|
| ES-4 / TODO's studio line | Still there | The stage is 454x174 at 1000x600 in Animate. |
| S3 sample: SA-12, SR-24, ES-15 | Fixed | The status note clears when the focus moves on. ES-15's "Discard and close" works, but see KL-4. |
| S3 sample: SA-11 | Not assessed | Screen reader work is out of scope. |

## What works well
- Docking is solid: the moves are announced with where the next Alt+arrow goes, Reset layout is clear, and the layout persists across close, mode switch and reload.
- There are no keyboard traps; the stage hands Tab, Space and Esc back.
- Esc's ladder (cancel the typed edit, clear the selection, go back to Move, then a guarded close) is predictable, and the hint line says it.
- Ctrl+Z from fields does the right thing in both cases, and the undo notes are specific.
- The Bind parts… picker works well from the keyboard (filter, Tab, Space, "Bind 1").
- The narrow layouts stack sensibly, the wheel scrolls the page, and the transport wraps.
- No page or console errors.
