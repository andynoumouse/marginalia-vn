# UX test round, animation studio (November 2026, second round): summary

Three testers used the animation studio on 2026-11-09 the way a real person would, with real mouse and keyboard input in headless Edge, each on its own
copy of the sample project. It follows the studio part of the first round ([../ux-test-2026-11/es.md](../ux-test-2026-11/es.md)), which mostly covered
Animate mode and finding the studio. Since then Model mode gained one focus with Bind verbs, the stage modes, the Weights tool and docking. Finding ids
are the tester's prefix and a number (`SR-3` is item 3 in `sr.md`).

| Report | Slice | S1 | S2 | S3 |
|---|---|---|---|---|
| [sr.md](sr.md) | Model mode rigging: parameters, binding, posing at keys, bones and pivots, poses, physics, persistence | 1 | 10 | 13 |
| [sd.md](sd.md) | Model mode deformers: Warp (lattice, mesh, group warp), Weights, Mask | 1 | 5 | 11 |
| [sa.md](sa.md) | Animate mode, window sizes, docking, keyboard only, accessibility; the first round's ES findings re-checked | 1 | 9 | 11 |
| | **Total (62)** | **3** | **24** | **35** |

S1 = blocks a task, S2 = real friction or a likely mistake, S3 = polish.

## How far to trust it

Every finding is something a tester saw happen; most say "reproduced twice". I read the code behind the three S1s and three S2s, and each held:

- **SA-1:** the stage frame runs the game's global keydown (`preview/preview.ts`, from line 987) unchanged. Esc goes to `menus.escape()`, Tab to
  `toggleSkip()` and Space to `renderer.advance()`, each with `preventDefault`.
- **SD-1:** Add warp, the group warp and Generate mesh are disabled by `!params.length` (`editor/anim-warp.ts`).
- **SR-1:** in Model mode `gizmoSubject()` gives the gizmo the bone of a part that sits on one, but Bind parts… binds the part itself.
- **SD-2:** the dialog's `onKeydown` closes on any Escape that reaches it.
- **SR-2, SD-3:** the Keys row and the bone chips are redrawn with `replaceChildren` while one of them has focus, so focus falls to `<body>`.

No page or console errors in about 90 runs.

## Fix first

Ranked by harm, how many testers hit it, and how much of the studio it touches. Each is about one session.

1. **Done (2026-11-09).** The fix:
   - the stage frame no longer runs the game's keys, and hands Esc and a plain Space press to the studio;
   - Esc in the side columns puts back a typed edit, then hands a deform tool's Esc to the stage, then closes;
   - Ctrl+Z from a field is the studio's undo unless an edit is typed and not committed;
   - a focus keeper (`editor/anim-focus.ts`, rules in `engine/src/studio-keys.ts`) gives focus back to a redrawn control's replacement;
   - a click on a timeline key or a frame block focuses it.

   A browser test covers it. What was found:

   **Keyboard focus is trapped, lost or misread** (11 findings from all three testers). This is the studio's widest problem:
   - The stage frame takes Tab, Shift+Tab, Esc and Space and gives none back (SA-1 S1, SA-3, SR-13).
   - Esc anywhere in the side columns closes the studio, even with points selected, or while typing in a field (SD-2, SA-16).
   - Redraws throw focus to `<body>` after a key click or a bone-chip click, so W/E/R and Ctrl+Z stop working (SR-2, SD-3).
   - Committing a field throws focus to the card (SR-9).
   - A click on a timeline key does not focus it, so Delete does nothing (SA-4).
   - Ctrl+Z is skipped in number fields, or does the browser's text undo there (SA-17, SD-8, SR-21).

   One rule set fixes most of them, and it is pure enough to test:
   - the stage forwards the studio's keys and lets Tab leave;
   - Esc clears or leaves a tool before it closes, and cancels a field edit first;
   - a redraw puts focus back on the matching element.

   The planned tool options bar (studio-inspector.md) has the same risk, so this comes before it.
2. **Done (2026-11-09).** The fix:
   - the gizmo poses a part bound by itself, else its bone (`poseTarget`), with the Keys row, the Pose fields and the ◆ following;
   - the breadcrumb names the bone when the gizmo poses it, and asks about keys only where a drag can write;
   - the ◆ keeps the chosen part and binds it first, as it promised;
   - a Ctrl-click set writes its bound parts and names the rest;
   - the hints say Bind parts… binds;
   - the Keyforms hint names the tool by binding kind;
   - the tree's marks lost their checkbox box.

   What was found: **Posing a bound part that sits on a bone** (SR-1 S1). Binding eyes, mouth or bangs to a parameter and posing them is the core Cubism job. Today the
   gizmo poses the bone, finds it unbound, and writes nothing. It needs a decision (below). The same dead ends:
   - the ◆ on a parameter row cannot key the chosen part, because choosing the parameter drops it (SR-3);
   - Ctrl-click adds unbound parts silently, and then the whole drag writes nothing (SR-4);
   - the Warp and Mask hints say a click binds, and it does not (SD-4);
   - the breadcrumb says "no key here: a drag adds one" where a drag adds nothing (SR-8);
   - Keyforms says to use W, E and R for a warp or mask binding (SD-11);
   - the tree's bind marks look like checkboxes and do nothing (SR-6).
3. **Done (2026-11-09).** The fix:
   - Generate mesh needs no parameter;
   - Add warp and the group warp still do (a lattice bends only with one), and their tooltips say so;
   - the section's message points to + in Parameters and to the Weights tool instead of rig.json.

   A browser test generates a mesh on mina and weights it. What was found: **A rig with no parameters cannot get a mesh** (SD-1 S1), so it cannot be skinned, and the Warp section's advice is to edit rig.json. Small:
   Generate mesh needs no parameter; Add warp can offer to make one.
4. **Done (2026-11-09).** The fix:
   - a point added to a keyed shape follows its edge at every key (`insertPolygonPoint`), and the click that adds it says so;
   - Remove bone is `removeBone`, beside `renameBone`. Mask shapes and weights go to the parent; keyforms, animation keys and physics that name the bone go with it, and the note lists them;
   - Copy keys has **mirror poses** and **reverse range** as separate checkboxes (the author's choice);
   - a group warp made from a bone says at once when its members sit on different bones (`groupBones`, shared with the rig check).

   What was found: **Edits that damage the rig without a word:**
   - adding a point to a keyed mask shape spikes its keyforms (SD-5), and a second click on a chosen outline adds a point;
   - Remove bone leaves physics outputs pointing at the removed bone (SR-5);
   - a mirrored Copy keys flips a one-sided parameter, so the rest pose is the raised one (SR-11);
   - a group warp from a bone makes a group the rig check warns about (SD-16).
5. **Done (2026-11-09).** **The right column** ([studio-inspector.md](../studio-inspector.md), steps 1 to 5, revised after a review in [studio-inspector-review.md](../studio-inspector-review.md)). It is confirmed by numbers from two testers:
   - Keyforms alone is 820 px in a 724 px column (SR-10);
   - with Warp on, the controls to key a warp sit from y=1113 to 1648 in a column that ends at 771 (SD-6);
   - Physics opened is 2153 px.

   The testers added three things to the plan:
   - the focus header should say what the gizmo will write to;
   - the test pose belongs in the Weights bar;
   - a bar's buttons must not make Esc close the studio (item 1).

   They also sorted every Warp, Weights and Mask control into bar or inspector (sd.md, "Where each tool's controls are").
6. **Animate mode:**
   - the "At the playhead" fields do not follow the playhead (SA-2);
   - a single pose key slides back to rest by t=1 while a parameter key holds, and the studio never says why (SA-5);
   - keyed parameter lanes and the ruler sit below five empty whole-character lanes (SA-8);
   - the transport row overflows at 1024 px and at phone width (SA-7);
   - in narrow layouts the wheel zooms the stage instead of scrolling the page (SA-6).

## Themes more than one tester hit

- **Focus and keys** (item 1): SA-1, 3, 4, 16, 17; SD-2, 3, 8; SR-2, 9, 13, 21.
- **The one-focus rule's dead ends.** Choosing a part or a parameter quietly drops the other one, and the text that should explain this promises
  something else (SR-1, 3, 4, 8; SD-4, 11; SR-6).
- **Stale or missing notes** (SA-12; SD-15; SR-15):
  - a note stays after the step it describes;
  - Remove bone, Same pivot for…, Mirror and Undo say nothing;
  - the hint line says Esc both leaves the tool and closes the studio (SD-10).
- **The right column** (item 5): SR-10, SD-6, SD-9, SR-14, SR-23.
- **Units and time.** Key times are fractions of Length (SA-10 = ES-7). Pose x and y are fractions of the stage, sx and sy are added to 1, and pivots
  are in PSD pixels (SR-16).

## The first round's findings, re-checked (from sa.md)

| Status | Findings |
|---|---|
| Fixed | ES-6 (the Automatic block in Model), ES-11 (Key's stale message; a new stale one is SA-12), ES-12 (a key on a grid line), ES-16 (the sample comment) |
| Mostly fixed | ES-2 (right-click and Ctrl+P reach the studio, and the Characters heading is at y=526; still nothing on hover, and at 900 px the Files panel is behind a button) |
| Looks fixed | ES-1 (the Problems count no longer jumps when the studio opens; sd.md) |
| Still there | ES-4, 5, 7, 9, 10, 13, 14, 15, 19, 20, 21 |

## Needs a decision, not just a fix

- **What the gizmo poses in a keyform focus when the part sits on a bone (SR-1).** The proposal: the keyform's target, the part, so a part keys on its
  own as in Cubism. The bone is reached by Alt-click or the breadcrumb, and the focus header names the target ("gizmo: eyes").
  - The alternative: the bind offers to bind the bone instead.
  - Either way, the line over the stage that docs/rig-json.md promises does not exist.
- **A single pose key: hold or return to rest (SA-5).** The engine's rule (every channel is 0 at t=0 and t=1 unless keyed) is documented. Parameter
  lanes hold. The studio could draw the implicit rest keys instead of changing the rule.
- **Mirror in Copy keys (SR-11).** Keep the face-style flip of the range, add a values-only mirror, or offer both.
- **Seconds or fractions for key times (ES-7)** and **undo that switches to what it changed (ES-5)**, both still open from the first round.
- **Apply rewrites rig.json's formatting (SR-20).** A mesh's weights go from one line per vertex to three, so one edit is a 375-line diff.
  *Fixed 2026-11-10:* `writeRigText` keeps the text of every unchanged list item as well as every unchanged property, and short flat
  objects are written on one line as by hand. Removing `forearm_l` from the demo's robo is now a diff of 2 added and 15 removed lines.
  The Apply note no longer says "Ctrl+S saves": the editor saves the file at once.

## What held up

- Persistence is solid: everything the testers made survived Apply, Close and reopen.
- Undo is one step per drag, stroke or operation, and redo works.
- The Bind parts… picker is quick and clear.
- Lattice selection and its operations give exact, symmetric results.
- The Weights tool matches its design: cursor and ring per brush mode, readouts, and per-mesh state that survives tool and row changes.
- F12 on an `animate` line opens the studio in 85 ms on the right animation, and Try in scene plays it.
- Docking works and survives reopen.
- Notes after a rename, Save as pose, New shape and Bind are specific.
- No page or console errors in about 90 runs.

## Caveats

- Headless Edge, three testers at once on one machine, with the art converter off (`--no-art`). Timings are indicative.
- Not tested:
  - real touch, a real screen reader, or browsers other than Edge;
  - Export…;
  - the standalone studio page and Electron Studio;
  - Flip, Add and Remove edge, Prune, and the Sine and Noise presets;
  - Weights on robo, and Animate on a skinned mesh.
- Scripts and screenshots stayed in the session's scratchpad and are not in the repository.
- The test kit was rebuilt from `engine/test/browser.test.mjs`'s setup:
  - a copy of `dist/` and of the sample per tester;
  - `preview/dev-server.mjs --no-build --no-art` on a free port with `VN_DIST_ROOT` and `VN_PROJECT`;
  - playwright-core's own Edge.
