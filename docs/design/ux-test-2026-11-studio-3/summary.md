# UX test round, animation studio (November 2026, third round): summary

Five testers used the editor on 2026-11-11 the way a real person would, with real mouse and keyboard input in headless Edge, each on its own copy
of the sample project. The focus was the animation studio again, after the second round ([../ux-test-2026-11-studio/summary.md](../ux-test-2026-11-studio/summary.md))
was closed and the studio gained time units in seconds, bezier eases, rotating past half a turn, the locked gizmo and the narrow parameter rows.
Finding ids are the tester's prefix and a number (`AN-3` is item 3 in `an.md`).

| Report | Slice | S1 | S2 | S3 |
|---|---|---|---|---|
| [mr.md](mr.md) | Model mode rigging: parameters and pads from scratch on mina, editing robo's, bones, poses, looks, physics | 0 | 5 | 9 |
| [md.md](md.md) | Model mode deformers: lattice and group warps, the warp on a pad, mesh and weights, masks, the gizmo | 0 | 3 | 13 |
| [an.md](an.md) | Animate mode: from a script line to an animation and back, keys, eases, Length, frames, Try in scene | 0 | 7 | 10 |
| [kl.md](kl.md) | Window sizes, docking, keyboard only; the second round's S1s and S2s re-checked | 0 | 2 | 7 |
| [ed.md](ed.md) | The rest of the editor, lightly: endings, Outline, statistics, translations, dialogs, narrow windows | 0 | 4 | 9 |
| | **Total (69)** | **0** | **21** | **48** |

S1 = blocks a task, S2 = real friction or a likely mistake, S3 = polish.

## How far to trust it

- No S1 this time: every job in every slice could be finished. No page or console errors in about 150 runs.
- The second round holds: all three S1s and every S2 KL could check are fixed (table in kl.md). Not re-checked: SR-4, SR-7, SR-8, SR-11, SD-4, SD-5.
- Two findings were seen by two testers each, independently: the view re-fitting itself while posing (MR-5, MD-11) and the focus landing in
  "Longest wait" after New animation (AN-4, KL-6). The spurious achievement in the preview (ED-4) was also seen by AN.
- ED-5 ("Problems: 3" on a fresh sample) is the sample's own content: robo's `head_warp` takes in `eyes` and `mouth`, which have frame tracks,
  and the check (`engine/src/params.ts`) predates this round. The sample needs fixing, not the check.
- Three regressions from the latest commits: KL-1 and KL-2 (the change to the parameter row tools) and AN-1 (the SA-8 lane fold).

## Fix first

Ranked by harm, how many testers hit it, and whether it is a regression. Each group is about one session.

1. **Done (2026-11-11).** The fix (`editor/studio.css`):
   - the stacked layout's one column is `minmax(0, 1fr)`, so no row inside can widen the page;
   - a slider row in a narrow panel has a column for ↺, so an Animate row is one line again (Model's chosen row still drops its tools under it);
   - the timeline keeps one height (38 % of the window, 26 % in a short one) and its lanes scroll inside it.

   What was found: **Regressions in the latest layout work** (KL-1, KL-2, AN-1).
   - Model at 390 px scrolls sideways, because the pad row's hidden ◆ ↺ ✕ keep their width (KL-1).
   - Every Animate parameter row takes two lines at any width, with ↺ alone on the second (KL-2).
   - The transport and timeline jump 136 px when the chosen part gains or loses keys, so the next click lands on the stage (AN-1).

   KL-1 was not the pad row itself: the stacked column was a plain `1fr`, so the widest row's minimum set the page width.
2. **Done (2026-11-11).** The fix: every redraw of the stage (choosing a part draws it again) fitted a view that was fitted to the character to
   its posed bounds. Now `StageTools.settle` fits only until the art has been measured once; F, Shift+F, the mode switch and a resize still
   fit. A browser test poses robo, chooses a part and checks the view did not move.

   What was found: **The stage moves under the pointer** (MR-5, MD-11). A pose that changes the character's bounds re-fits the view, and the next click
   chooses the wrong part. The view should stay where the user left it; F fits on request.
3. **Done (2026-11-11).** The fix (`editor/anim-studio.ts`, `editor/anim-params.ts`):
   - a taken name keeps the name prompt open with the name selected and says to choose another (new, copy, rename);
   - the prompt closing gives the focus to the card and tells the focus keeper so, so the studio's keys work at once;
   - under Auto-key, letting go of a slider or a pad, a typed value, a tick or ↺ keys the parameter at the playhead (one undo step); with
     Auto-key off the status line says it is not keyed yet;
   - Esc with changes not applied warns, and the next Esc takes the warning back: only Discard and close discards;
   - Apply puts Close back (KL-4).

   A browser test covers it. What was found: **Work lost or written where the user did not mean it** (AN-6, AN-8, AN-5, AN-4/KL-6).
   - Esc, Esc, Esc after the close guard throws away a new animation, with no undo (AN-6).
   - New animation with a taken name closes the prompt and leaves the old animation chosen, so keys go into it (AN-8).
   - With Auto-key on, a parameter slider or pad move is never keyed and nothing says so (AN-5).
   - After naming a new animation, focus sits in "Longest wait", so the first shortcuts type into it (AN-4, KL-6).
4. **Done (2026-11-11).** The fix, in what the studio says (no new editing yet):
   - a warp keyed to the active pad's grid says so in the Warp bar and in Keyforms (shown, not editable here yet, see warp-pad-grid.md), and a
     key on one of the pad's sliders says it adds on top of the grid; a first key on a warp says it started the keyform (MD-5);
   - the Mask hint and Keyforms say a drag edits the rest outline and a shape's keys are written in rig.json, and a drag of a keyed shape says so;
   - Generate mesh from the Weights tool stays in Weights;
   - Rotate and Scale on a part with no pivot of its own say it turns about its bone's joint and that Q gives it its own. A part bound by itself
     on a bone now gets a pivot at the middle of its image (the stage sends every part's box when it is ready).

   What was found: **The studio's own advice leads somewhere wrong** (MD-1, MD-2, MD-3, MR-1).
   - On a pad, the Warp bar tells you to use one axis; doing so adds a second, additive keyform to a warp already keyed to the pad's grid (MD-1).
     Until warp-pad-grid.md lands, it should say the grid is shown but not editable yet.
   - Mask: Bind to parameter makes empty keys that the Mask tool can never fill, while the hint says to drag at each key (MD-2).
   - Generate mesh, offered by the Weights tool, switches the tool to Warp (MD-3).
   - A bound part on a bone scales about the bone's pivot, so a blink slides the eyes onto the neck; nothing suggests Q first (MR-1).
5. **Done (2026-11-11).** The fix:
   - with Move, a drag that starts on the art of the chosen part, or of a part on the chosen bone, poses it as the gizmo's centre does; a
     click there still chooses (`carries` in preview/studio.ts);
   - Bind parts… shows "Grid on the pad" for a pad, so the grid is chosen before the bind;
   - the crumb reads "corner" on a pad, and gives the dot as two values, so the names keep a few letters;
   - a press just outside the pad's edge takes the corner there;
   - a pad's axis rows show the rest of the name when it starts with the pad's (look_x as x).

   A browser test covers it; the full browser set ran (173/173). What was found: **Pads in Model mode** (MR-2, MR-3, MR-4, MR-6, MR-7, MR-12).
   - A drag on the art re-chooses a part instead of posing the chosen bone, and the pad keyform focus is lost (MR-2).
   - "Grid on a pad" is hidden until after binding, though the docs say to choose it before (MR-3).
   - The header says "no key here" on corners that binding made (MR-4); names shrink to one letter (MR-6); the top-right corner dot is covered by
     the row's buttons (MR-7); both axis rows read "head_turr" (MR-12).
6. **Done (2026-11-11).** The fix:
   - Try in scene, when the line animates another animation than the one on show, asks to name the one on show in the line (an undoable
     edit of the script) or keeps the studio open;
   - the Frames section's Slot starts on the chosen part when it is a slot;
   - a chosen key is drawn in the accent colour (`.tl-key` came after `.tl-on` and won).

   A browser test covers it. What was found: **Animate details** (AN-2, AN-3, AN-7).
   - Try in scene plays the script line's animation, not the one on show, and says nothing (AN-2).
   - The Frames Slot select starts on `top`, not the chosen slot (AN-3).
   - A clicked key looks unselected until it is nudged (AN-7).
7. **Done (2026-11-11).** The fix:
   - Ctrl+P lists the labels a typed name matches (`@bench_talk`, with its file and line) above "Create <name>.vn";
   - Script statistics (and `vn stats`) list the `end` lines no route from the start reaches, and the playtest report has them as
     `unreachedEndings`;
   - adding a language in Translations writes `locale/<code>.json` at once;
   - on the way to a script line (Preview from cursor, Try in scene) an `unlock` is kept for the story there but not reported, so no
     achievement toast and nothing stored; a save's replay reports unlocks as before.

   Tests cover each. What was found: **Editor, outside the studio** (ED-1 to ED-4).
   - Ctrl+P with a label name offers only "Create <name>.vn" (ED-1).
   - Script statistics leaves out endings the start cannot reach, without saying so (ED-2).
   - A language added in Translations is lost if no line is typed before closing (ED-3).
   - Preview from cursor pops "Achievement unlocked: Into town" on routes that never went there (ED-4, also seen by AN).

## Then (S3, by theme)

- **What the studio says: done (2026-11-11).** Undo names the operation (a key added or removed and at what time, the pose at a key, a
  rename, a range field, an ease, a deformer's points, mesh, weights or members), and a note that reads as the last one is still shown
  (AN-9); deleting a parameter, Save as look and Smooth say what they did; the stale notes are fixed (MR-10, MR-13, MD-7, MD-8, MD-15;
  MD-5 with group 4); the options bar's label and line take two lines before they are cut, and the Key and ease selects use shorter words.
- **Stage input: done (2026-11-11).** Letters typed in an open menu are no tool keys (MD-16); a rotation drag shows the turn so far by
  the ring, with whole turns counted (MD-14); the other parts dim to 40 %, so a dark chosen part keeps its surroundings (MD-12); Edit
  topology's status line names the topology tool, and the Weights tool tints each triangle by its weight (MD-13).
- **Timeline: done (2026-11-11), but for two features.** The scrub slider's arrows step 0.05 s (Shift 0.5 s, KL-3); a click on a key
  moves the playhead to it, as a click on a frame block does (AN-14); a dragged block never lands on another's time (AN-15). Built after: the curve dialog
  for `curve…` (AN-11) and several keys chosen and edited at once (AN-13; frame blocks and Copy/Paste are in TODO.md).
- **Frame and flow: done (2026-11-11).** Apply puts Close back (KL-4, with group 3); Animate's tool bar keeps one line down to 480 px,
  so no empty band sits over the stage (KL-5; the zoom label over the feet at 1024 px is left); the stage's frame lights while it has
  the keys and a grip reached by Tab shows a ring (KL-8); the docs say Space on a focused button presses it (KL-7); a show line goes
  above the animate line it was opened from, an "Insert animate line" button puts the animation in, and Try in scene follows the moved
  line (AN-16); `>studio` lists the command once (AN-12); a group warp from a Ctrl-click set is named after the chosen part (MD-9).
- **Editor: done (2026-11-11), but for two.** The preview's Problems tooltip says it counts the scripts only (ED-6); a misspelled
  game.json key gets "did you mean" (ED-8); the Build dialog no longer doubles the language (ED-7); Script statistics open at the top
  and their palette entry names routes and endings (ED-9); the Outline's header wraps under 760 px, so Close stays on screen (ED-10);
  the CSV import names the locale files, and Import and Remove unused say what they did, and the language field is wider (ED-11);
  robo.vn's header says how to open the studio now (ED-12); a warped part may take a frame track (the rule against it was stricter than
  the renderer: robo's blink plays under the turned `head_warp` with no slow frames), so robo's two warnings are gone (ED-5; mina's look
  `casual` is also a variant on purpose, mina.vn teaches it). Left: Tab into Monaco indents (ED-13, known as EL-6); the two counts of untranslated strings differ (EP-22).

## Method

Each tester ran its own dev server (`preview/dev-server.mjs --no-build --no-art`, `VN_DIST_ROOT` = a copy of dist, `VN_PROJECT` = a copy of the
sample without `build/`) and its own headless Edge through playwright-core, from a small kit in the session scratchpad (not kept). Each used about
210k to 270k tokens and 16 to 20 minutes. Three testers lost their early screenshots because the kit's restart cleared the whole tester folder;
their findings were re-run or rest on recorded output.
