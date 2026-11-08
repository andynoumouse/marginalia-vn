# PC report: player core flow, mouse and keyboard (as returned by the tester)

23 findings: S1 0, S2 5, S3 18. Core loop (title, play, choices, saves, rollback, options) works and never threw a page error; only console error is the favicon 404. Scripts s01-s46 and ~130 screenshots in scratchpad/ux/pc (shots/).

## Scope
Player page (S.base) in headless Edge. `sample` for everything; `demo` for task 11, the timed choice, name prompt, captions, options. Viewports 1280x720 (main), 1920x1080, 1366x768, plus 4:3, ultrawide, 700x1000 and a resize mid-choice. Real mouse and keyboard; docs/game-shell.md read after the first unaided pass.
Not covered: real audio, gamepad and touch, slow networks, other browsers, an exported build, Skip "all text", Auto speed values, whether text speed 100 is instant, splash/intro (neither project has one).
Load time ~1.05 s on localhost, black stage and no loader. The dev server's "VN preview" bar sits on the player page and letterboxes 1920x1080 by 44 px. The sample's timed menu (demo.vn) can't be reached by playing; the demo's can.

## Task log
1 First impression: done. Title interactive in 1.05 s (sample and demo), 1.4 s on reload. Title hierarchy clear. No audio hint, no splash. Extras buttons empty on a first visit.
2 Play by click, then keys: done with friction. Route A 22 Space presses and 2 menu picks, ~6 s. Text reveals ~45 chars/s. First click completes the line, next advances. First line appears ~1 s after New game.
3 Choices and endings: done with friction. Mouse, 1-9, arrows+Enter and Tab all work. Route A ("Call it a night", short ending) 22 steps. Route B (good ending, 10 menus) 72 steps, 21 s. Demo's timed choice has a bar that turns amber and freezes while Esc or History is open. Endings unclear (PC-4).
4 Quick menu, all 10 buttons: done with friction. Back silent at line 1; Skip gives no sign when nothing read; Auto shows a teal checked box and stops at a choice; Hide returns on any click or H. Labels 15 px at 1280x720, 16 px at 1366x768, 23 px at 1920x1080.
5 Pause menu: done. Esc steps back one layer every time. Main menu guarded. A second right-click doesn't close it.
6 Saves: done with friction. Slots show thumbnail, time and line. Overwrite, delete, load each ask first. F5 and Q.Save toast "Quick saved". Empty F9 says "No quick save yet". A, Q, C pages fill as documented. Continue after a reload returned to the exact line.
7 Rollback and history: done. Back, PageUp and wheel work. Variables rewind. History click rolls back. Rollback works after a load.
8 Skip and Auto: done. Tab and Ctrl skip read text and stop at choices. Auto advanced 2 s after a 28-character line.
9 Options: done with friction. Everything applies at once and persists. No reset to defaults and no text-speed preview.
10 Robustness: done. Resizing clean. Double-click on a choice safe. Overlays don't leak input. Held Space runs through a choice (PC-1).
11 Demo: done with friction. New game opens a "Feature index" card screen, not the story. Index buttons collide with the quick menu.

## Findings
### S2
PC-1 · S2 · usability · Space/Enter, or a held Space, picks option 1 as soon as a menu appears. Repro s07-menu-guard.mjs, s06-holdspace.mjs, s36-focus-space.mjs: press Space to reach the first menu (park.vn:18), then Space or Enter again. Option 1 is picked ~55 ms after the menu's first frame. Holding Space for 1.5 s (auto-repeat) ran straight through the menu. A click on empty stage is ignored; a double-click on an option is safe. Expected a short input delay, or ignore auto-repeat keydown. Evidence shots/01-after-hold-space.png. Reproduced 4 times. Known: no. (CLAUDE.md/flaky-tests.md record this as a test-flake cause: "Space on a menu picks an option".)

PC-2 · S2 · a11y/usability (bug) · Tab at a choice leaves focus on the quick menu's Back, so the next Space undoes the pick. s46-tab-back.mjs: at the first menu press Tab twice, then 2, then Space. Log shows `focus = Back` after the pick, and Space rolls back to the menu. Reproduced twice. Known: no.

PC-3 · S2 · usability · New game is the focused default even when a save exists. Enter or one click starts over and replaces the autosave. s40-newgame-over-save.mjs, also s05-keys.mjs: park.vn:13 starts at once with no prompt. After a reload Continue's subtitle shows line 1. Manual saves survive. Evidence shots/01-newgame-over-save.png, 02-title-after-reload.png. Reproduced twice. Known: no.

PC-4 · S2 · usability · The ending reads as unfinished. s18-endings.mjs (short ending), s19-route-b.mjs (good ending). Only text is "End of script. Click to return to the title screen." in dim 18 px grey, crossed by the lamp or over Alice's torso. Short ending has no title or toast; good ending shows an "Ending reached" toast. Quick menu stays up. "Script" is author language. Evidence shots/02-ending-A-1.5s.png, 01-ending-B.png. Reproduced twice. Known: no.

PC-5 · S2 · a11y · Options and Save/Load controls have no usable accessible names. s45-a11y.mjs (ariaSnapshot): sliders named by raw setting key with raw value (`"master": "0.8"`, `"text size": "1"`, `"box opacity": "1"`); toggles just `"Off"`, `"On"`, `"Normal ▾"`, so the four Accessibility rows can't be told apart; save slots unnamed (`aria-label=" "`); Delete is `"×"`; page tabs `"A"`, `"Q"`, `"C"`. Reproduced twice. Known: no (TODO covers Narrator and dialogue only). (Same as PI-5/PI-6.)

### S3
PC-6 · S3 · bug (visual) · Rolling back to a choice shows the menu without the dialogue box. s44-verify2.mjs: first arrival shows "You're late..." under the options. After pick 2 then one Back, `#box` has data-visible=false. Evidence shots/01-one-back-at-choice.png. Reproduced 3 times.

PC-7 · S3 · a11y/visual · Quick menu has no backdrop. Labels are rgba .7; about 2:1 over Alice's pink body at 1920x1080 and about 3:1 over the pale path (estimated from colours); ~9 px in a 700 px wide window. Evidence shots/02-game-1920x1080.png, 04-quick-zoom.png, 06-game-tall.png. (Same as PI-4.)

PC-8 · S3 · usability · Confirm dialogs send mixed signals. Focus (and Enter) is on "No" but "Yes" is accent-styled. F9 needs F9, Right, Enter and shows no "loaded" toast. The main-menu text says progress will be lost although autosave exists. Evidence shots/01-after-f9.png, 01-main-menu-click.png.

PC-9 · S3 · usability · Skip with nothing read, and Back at line 1, are silent no-ops. Back button doesn't look disabled. Evidence shots/06-skip-on.png.

PC-10 · S3 · usability/taste · A first-time player sees four empty extras buttons. Chapters shows two anonymous "Locked" bars with no hint. Evidence shots/05-title-Chapters.png.

PC-11 · S3 · usability · Load page tabs "A", "Q" and "C" are bare letters. Evidence shots/06-load-page-C.png.

PC-12 · S3 · bug (polish) · Two `/favicon.ico` 404 console errors on every load. (Also seen by EA, PI.)

PC-13 · S3 · visual · The stage is black with no loader for ~0.8 s. The quick menu appears over the black during New game (curtain ~90% black, s43-verify.mjs). Evidence shots/01-after-newgame-300ms.png.

PC-14 · S3 · visual · Title buttons change width and position once Continue has a subtitle: 262 px to 548 px, and Continue becomes taller. Evidence shots/03-after-ending-click.png vs 03-title-1280x720.png.

PC-15 · S3 · visual · The achievement toast outlives the ending. It covers the title text and the Chapters "2 / 2" counter. Evidence shots/03-after-ending-click.png, 01-extras-Chapters.png.

PC-16 · S3 · bug (minor) · A second right-click doesn't close the pause menu. Seen in s24 and s42.

PC-17 · S3 · usability · Options has no reset, no text-speed preview and no unit ("45"). In-game the panel covers the text box, so Text size and Box opacity changes can't be seen. Evidence shots/02-game-with-big-text-low-opacity.png.

PC-18 · S3 · taste · History omits the picked option. Evidence shots/03-history-4-lines.png.

PC-19 · S3 · visual · Demo: "Explore the library" and "Take the guided tour" buttons overlap the quick menu. New game opens a developer "Feature index". Evidence shots/02-demo-after-newgame.png.

PC-20 · S3 · visual/taste · Captions show raw names ("[page flip1]") over the speaker's face. Looping ambience and music have none. Evidence shots/01-caption-visible.png. Partly known: docs say cues without a file show as text.

PC-21 · S3 · taste · Save time reads "11/8/26, 1:28 PM"; month/day order ambiguous.

PC-22 · S3 · visual · A character fading in shows layer seams for a few frames. Seen once. Evidence shots/film/alice-in-1.jpg.

PC-23 · S3 · taste · The player page carries the dev bar; its Restart drops to the title with no confirm (autosave keeps the position). By design for the dev preview.

## What worked well
- Saves and resume: Continue after a reload returned to the exact line; autosave (A), quick (Q) and choice (C) pages fill as documented; slots show thumbnail, time and line.
- Navigation: Esc steps back one layer every time; overlays never leak input; dropdowns close before their screen; hover (thin border) and keyboard focus (thick ring) are distinct.
- Safety and feedback: every destructive action asks first (delete "Yes" is red); quick save gives a clear toast; disabled options explain themselves ("You need the brass key.").
- Rollback and choices: rollback rewinds variables and survives a load; History click-to-roll-back works; click-to-complete then click-to-advance is consistent; double-clicking a choice is safe.
- Timed choice, skip, auto: the timed-choice bar is visible and freezes while Esc or History is open; Timed choices option offers Extended and No limit; Auto and Skip stop at choices; Hide returns on any click or H.
- Options and layout: options apply at once and persist; resizing to 4:3, ultrawide and tall letterboxes cleanly; transitions smooth; text wraps cleanly.
