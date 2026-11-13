# AN report: Animate mode, script to animation and back (as returned by the tester)

Counts: S1 0, S2 7, S3 10.

Scripts and screenshots were in the session scratchpad under `kit/testers/AN/` and were not kept. A mid-session restart wiped s01-s24; findings
that rest only on those name the lost script and describe the step.

## Scope
- **Viewports:** 1600x900 (main) and 1280x800 (New-animation focus, layout).
- **Characters:** robo (keys, parameters, Length, Place, Try, undo) and mina (frame track on the mouth slot).
- **Covered:**
  - Opening the studio from the Files panel, right-click "Open in Animation Studio (F12)", F12, and Ctrl+P (`studio` and `>studio`).
  - New animation, keys with Auto-key on and off and the Key button (K).
  - Key select, drag, nudge (arrows / Shift+arrows), Delete, and a multi-select attempt.
  - Eases including `curve…` (bezier), parameter keys from the head_x slider and the head_turn pad.
  - Length 1 → 2 → 0.6 s with Stretch keys and Keep key times, Loop, Play, Space, scrubbing; the Properties values follow the playhead.
  - mina "Frames from this slot" with Loop them, Duplicate, block drag, nudge, Delete.
  - Place on stage + drag, Copy, Insert in script, Try in scene.
  - The new animation played in the editor preview as `animate robo wave2 2s` and `250ms`.
  - Undo and redo across two animations and the Model | Animate switch; Apply, Close and its guard, reopen.
- **Not covered:** Export…, Rename / Delete / Edit copy, preset-name override, Model-mode editing, a separate parameter curve view (only the curves drawn in the lanes were found), touch.
- **Errors:** no page or console errors in any run. The editor header shows "Problems: 3" from the start (pre-existing rig checks, ED-5).

## Task log
1. **Open the studio: done.**
   - Files panel → Animate: 74 ms.
   - F12 on `animate robo wave`: 87 ms.
   - Right-click "Open in Animation Studio (F12)": 110 ms, opens on the line's animation (`nod`).
   - Ctrl+P `studio` lists "Animation studio: mina / robo". `>studio` lists two commands that do the same thing (AN-12).
2. **Make an animation: done with friction.**
   - New animation takes 3 steps (⋯, New animation…, name + Enter), but focus lands in an Automatic field (AN-4).
   - First rotate key: one drag. After it the transport and timeline jump down 136 px, and the next click landed on the stage (AN-1).
   - Auto-key off: the preview drag says "Not keyed yet: press Key…"; K says "Keyed arm_r at the playhead (1 s)."
   - Key select (once the diamond is hit), drag, nudge (+0.01 s / +0.05 s / +0.5° per press), Delete and undo all work.
   - No multi-select (AN-13). A selected key looks unselected (AN-7). A slider move is never keyed and gives no notice (AN-5).
3. **Eases: done with friction.**
   - The ease select works: default inout, linear … elastic, `curve…`.
   - `curve…` is a text prompt with good error messages; `bezier(0.3,1.6,0.6,1)` overshoots in the lane. There is no graph (AN-11).
   - Length: the Stretch / Keep question is clear, and trimming to 0.6 s says "1 past the end removed; Ctrl+Z brings them back". Very good.
   - Loop, Play and Space work; the playhead time and Properties follow.
4. **mina frame track: done with friction.**
   - The Slot select defaults to `top` even with the mouth slot chosen (AN-3).
   - After picking `mouth`: "3 frames at 12 fps, looped: 12 blocks over 1 s."
   - Duplicate halves the block. Drag, nudge and Delete work. A dragged block can land on another block's time (AN-15).
5. **Place, Copy, Insert, Try in scene, script durations: done with friction.**
   - Place on stage + drag gives `show robo at 0.307`; Copy puts it on the clipboard.
   - Insert in script says "Inserted under line 12 of robo.vn." The studio stays open, and only the show line is inserted (AN-16).
   - Try in scene plays the line's animation, not the one on show (AN-2).
   - In the editor preview, `animate robo wave2 2s` plays its 3 keys over about 1.75–2 s and `250ms` over about 0.3 s, matching what was authored.
6. **Undo, Apply, Close: done with friction.**
   - Undo walks back across animations and from Model to Animate, with titles such as "Undo: nod: Length 0.9 s → 2 s" and "Undo: new animation wave2". Redo mirrors it.
   - One undo step shows an empty status line (AN-9).
   - Apply: "Applied to rig.json, which the editor saves at once…"
   - Close with changes turns the button into red "Discard and close". Esc then discards a whole new animation (AN-6).
   - The duplicate-name trap (AN-8) led to editing the original `wave` by accident.

## Findings
**AN-1 · S2 · usability · The transport and timeline jump by 136 px when the chosen part gains or loses keys**
- Steps: new animation, choose arm_r, one rotate drag.
- What happened: the stage bottom moves from y=542 to y=678, Play / scrub / Length move from y=566 to y=702, and the stage zoom changes from 38% to 49%. Choosing a part with no keys moves them back, and adding parameter lanes moves them again (to y=614).
- A click at the scrub bar's old place (807,600) chose `legs` on the stage, and a later drag chose `torso` instead of rotating arm_r.
- Expected: the transport stays put, and the folded lanes give their room to the timeline, not the stage.
- Reproduced twice. Known: no. (A side effect of the "folds to a thin row" change made for SA-8.)

**AN-2 · S2 · usability · "Try in scene" plays the script line's animation, not the one chosen in the studio**
- Steps: F12 on `animate robo shrug` (robo.vn:17), pick `dance` in the picker, press Try in scene.
- What happened: the preview plays `shrug`. In another run, a new `wave2` was applied but `wave` played. Nothing says so; the tooltip says "…play the script from the animate line you came from".
- Expected: play the animation on show, or ask "The line plays shrug. Change it to dance?" and edit the line.
- Reproduced twice. Known: no.

**AN-3 · S2 · bug · The Frames section's Slot select starts on `top`, not the chosen slot**
- Steps: mina, new animation, choose `mouth` (or `eyes`) in Parts, open Frames.
- What happened: the select reads `top` in both cases (options top, bottom, eyes, mouth). Properties lists mouth's variants just above it. Pressing "Frames from this slot" says "The 2 frames of top take 0.167 s…", so it builds a clothing track.
- Expected: the select follows the chosen slot ("this slot").
- Reproduced twice. Known: possibly a regression; SA's run made 3 mouth blocks straight away.

**AN-4 · S2 · bug · After "New animation…" the focus lands in the Automatic "to" field and eats the first shortcuts**
- Steps: ⋯ → New animation… → type a name → Enter, then press E and Space.
- What happened: focus is on INPUT "Longest wait in seconds after each run". E types `e` into it (the field shows "to e"). The Rotate tool does not turn on, and Space does not play. A digit would make the new animation start by itself.
- Expected: focus on the stage or the picker.
- Reproduced twice (also at 1280x800). Known: no (same as KL-6).

**AN-5 · S2 · usability · With Auto-key on, a parameter slider or pad move is never keyed and gives no notice, yet the value stays on the stage**
- Steps: wave2, playhead at 0.5, drag the head_x slider to 0.71, then scrub to 0.3 and back.
- What happened: no key is made, the status line stays empty and the ◆ stays unlit. head_x stays 0.71 at every time, so the head looks animated in the studio, but nothing is saved.
- By contrast, a gizmo drag with Auto-key off says "Not keyed yet: press Key…".
- Expected: Auto-key keys parameter moves too (as in Cubism / Spine), or the same "Not keyed yet" note, with the value dropped on scrub.
- Reproduced twice. Known: no.

**AN-6 · S2 · usability · Esc discards unapplied work after the close guard, and it cannot be undone**
- Steps: new animation with 3 keys, Rotate tool on, then Esc, Esc, Esc.
- What happened:
  - Esc 1: the tool goes back to Move.
  - Esc 2: the status line says "There are changes that were not applied. Apply them, or press Discard and close (or Esc) to discard them."
  - Esc 3: the studio closes. On reopen the animation is gone and Undo is disabled.
- From a field it takes only 2 Escs. The warning is one orange line at the bottom, not a dialog, and Esc normally means cancel.
- Expected: Esc cancels the close, and only the explicit button discards; or the discarded working copy can be restored on reopen.
- Reproduced twice. Known: partly (SA covered the guard and found it fine).

**AN-7 · S2 · usability · A clicked key gets no visible selection**
- Steps: click the rot key at 0.5 s.
- What happened: the key gets class `tl-on` and Properties shows "Key 0.5 s · rot 30.9203", but the diamond looks exactly like the others. Only after an arrow nudge does it turn into the large outlined diamond.
- Expected: the selection shows on click.
- Reproduced twice. Known: no.

**AN-8 · S2 · usability · New animation with a taken name closes the prompt and leaves the old animation chosen**
- Steps: ⋯ → New animation… → `wave` → Enter.
- What happened: the prompt closes, the bottom line says "wave exists already.", and the picker stays on the previous animation (`breathe`). The typed name is lost. In one run the tester then keyed what they thought was the new animation and changed the original `wave` (torso rotated -10°).
- Expected: keep the prompt open with the error.
- Reproduced twice. Known: no.

**AN-9 · S3 · bug · One undo step shows an empty status line**
- Steps: 3 keys on wave2, then undo repeatedly.
- What happened: the 3rd Ctrl+Z (the key at 0.5 s) leaves the status line blank even after 1.5 s; the steps before and after say "Undid: wave2: key added on arm_r". The same happens on redo 3.
- Reproduced twice.

**AN-10 · S3 · usability · The undo text for an ease change is vague**
- After setting a bezier, undo says "Undid: wave2: key on arm_r changed". It does not say "ease → bezier(…)".

**AN-11 · S3 · usability · `curve…` is a text prompt with no curve to drag**
- It asks for `bezier(0.25,0.1,0.25,1)` as text. The error messages are good (x out of range, bare numbers). A Spine / AE user expects handles to drag.

**AN-12 · S3 · usability · Ctrl+P `>studio` lists the same command twice**
- "Open in Animation Studio (F12)" and "Animation: Open the Animation on This Line in the Studio  F12" both appear.

**AN-13 · S3 · usability · No multi-select of keys**
- Shift-click and Ctrl-click replace the selection, and a box drag on the lane does nothing, so moving several keys at once is not possible.

**AN-14 · S3 · usability · Clicking a key leaves the playhead, but clicking a frame block moves it**
- After a key click the playhead stays at 1.00. After a frame-block click it moves to 0.54.

**AN-15 · S3 · bug · A dragged frame block can land exactly on a neighbour's time**
- The frames ended as `open@0.58` and `smile@0.58`, so smile lasts 0 s and is hidden until a nudge.

**AN-16 · S3 · usability · Insert in script inserts only the `show` line, and puts it after the `animate` line**
- `show robo at 0.307` goes under robo.vn:12, so robo waves and then jumps. There is no way to insert `animate robo wave2`.

**AN-17 · S3 · polish · Clipped controls and over-precise values at 1600 wide**
- The Key select reads "(none sele" and "0.5 s · rot 3", the ease select reads "(default: in". rot shows 4 decimals (`-82.5384`). The Files panel shows "rig.jsc" for mina.

**Outside the slice:** Try in scene and Preview from cursor in robo.vn show "Achievement unlocked · Into town · Leave the park behind." (seen twice; ED-4).

## What works well
- F12, right-click and the Files panel all open in about 0.1 s on the right animation.
- Properties "At the playhead" follows scrubbing and playback.
- The Length dialog: Stretch / Keep, with a count of trimmed keys and an undo hint.
- Auto-key off gives clear "Not keyed yet" feedback; K and Shift+K work.
- The bezier input checks what you type and gives exact error text, and the result shows in the lane.
- Undo moves you to the animation and mode it changes, and its tooltips name the step.
- Script durations `2s` and `250ms` play the authored keys at the asked length in the preview.
- Frames from this slot with Loop / Spread / Play once is a nice prompt.
