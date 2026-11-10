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

## After the Fix-first list: the S3s

The S3s and the first round's ES findings still open are worked through in batches. Already closed by the items above or by later work:
SR-13, SR-20, SR-21, SD-8, SD-10, SD-11, SD-16, SA-16, SA-17, the JSON half of SR-22 (the Physics chains are fields now), ES-5 and ES-7.

- **A. What the studio says (done 2026-11-10).**
  - A status note goes once the mode, tool, focus, animation or working copy moves on, unless the action that moved it wrote its own
    (`keepNote`; SR-15, SD-15, SA-12).
  - Same pivot for…, reparenting a bone, New bone, Remove skin and the lattice Mirror say what they did. New bone puts the cursor in its
    Name field, and Same pivot for… is off with nothing chosen and has a title line.
  - The first-screen and empty-state texts agree ("on the stage or in the Parts tree", "+ in Parameters"), with the Mask hint aware of
    the tool (SR-14, SD-9).
  - Animate's Properties leaves out the playhead and key fields until a part or a key is chosen (ES-9).
  - K keys the previewed drags and Shift+K turns Auto-key on or off; Play's tooltip names Space (SA-20).
  - A bone renames on Enter or when its Name field is left, as a parameter does (SR-24); rig-json.md's New pad text matches the form.
- **B. Stage input (done 2026-11-10).**
  - A press right after a tool key typed on the stage waits for the editor's answer and then goes on with the new tool (SR-12).
  - With Rotate a drag that starts anywhere inside the ring turns the subject, and a click there still chooses; the ring also takes a press
    a few pixels outside its line (`ringAround`, `RING_OUTSIDE`; SR-17, SD-12).
  - In Model a scrubbed slider lands on a key near it, else on its step (`snapToTicks`; SR-18).
  - A key dragged on the timeline moves by how far the pointer went, so a sideways drag keeps its value (channel and parameter keys; SA-13).
  - A Warp drag between keys says it added a key; a mask's breadcrumb no longer promises one, since a mask drag moves the rest outline (SD-7).
- **C. Layout and sizes (done 2026-11-10).**
  - The stage shows the whole character while an animation plays, and dims all but the chosen part again on pause (ES-13).
  - The stage view remembers what it fits (the stage, the character, or nothing after a zoom or pan) and fits it again when its box
    changes; Model fits the character, Animate the stage, so Model opens at about 51 % instead of 32 % and its lattice handles are larger
    (ES-20, SD-17).
  - In a narrow column a parameter row is one line, the chosen row's ↺ and ✕ included (ES-10).
  - Every text field is themed, the tree's eye buttons and the Keys ‹ › are 24 px (ES-19, SR-23).
  - At 900 px and below the picker comes first, then the stage and timeline, then Look, Poses, Parameters and Parts (stage at y=313 in a
    700 px window, was 916), and the tree no longer scrolls the whole card to its chosen row on opening (ES-4).
  - The timeline folds to its transport row (▾ at the row's end, kept with the layout).
  - Also: the Parameters section is rebuilt on a mode switch, so Model no longer says "Add them in Model mode" (SR-14), and the Parameter
    key row hides its fields until a key is chosen (ES-9).
  - Left of these: a three-column window as small as 1000x600 still has a small stage (ES-4), the column grips are 6 px wide (ES-19).
- **D. Keyboard and screen readers (done 2026-11-10).**
  - The Parts tree is one Tab stop (a roving tabindex on its rows); H on a row hides or shows it, Left and Right fold and open a bone, so
    the eye and fold buttons leave the Tab order (SA-19).
  - What a screen reader gets (SA-11): the timeline is a labelled group whose keys are buttons, not an image; the scrub slider says
    "0.50 seconds of 1.10"; a fold button is named for what it does; At the playhead, Key and Parameter key are named groups; a section's
    heading reads its title before the Move button; moving a section is said in the status line (`dockMoveNote`).
  - Alt+Right from the left column still opens the second left column (the dock design), but the move is now announced, with where the
    next Alt+Right goes (ES-21).
  - While Close waits for a second press, the button reads "Discard and close" and the note stands out (ES-15).
  - SA-14 did not reproduce: a section dropped in the empty part of a column goes to its end, with the drop line shown.
  - Left: the tree is still a list of buttons, not an ARIA tree with levels.
- **E. Tool details (done 2026-11-10).**
  - Alt-click takes the bone of the part on show at that spot instead of stepping the click cycle on, and says which bone it chose or that
    the part has none (SR-7).
  - The Bind parts… list is in the Parts tree's order and taller (SR-19).
  - The studio opens on the animation it was last on for that character, else the first one that does not start by itself, not a 0.12 s
    automatic blink (SA-15, ES-14).
  - Mirror in Weights asks for the partners of side-less bones in one dialog with a choice of bones, starting at a guess from numbered
    names (`guessPartner`: hair_0_0 with hair_4_0) (SD-13).
  - A mesh margin below 2 px is taken as 2 (a margin of 0 made 197 vertices where Medium makes 23), and the field says the mesh stays inside
    the image, which is why 10 and 40 gave the same mesh (SD-14). No preview before Generate yet.
  - Frames from this slot asks, when the frames end before the animation, whether to loop them, spread them over Length or play once (SA-18).
  - The Pose row and At the playhead say their units under the fields; the Pivot row says PSD px (SR-16).
  - A physics chain added from a preset names the preset's parameters this rig lacks (SR-22).
  - Also fixed: two browser tests that the Model fit of batch C broke (a click spot on a bone dot, a zoom aimed on the whole-stage fit).
- **F. Docs (done 2026-11-10).**
  - The PSD converter makes a group's and a variant's name a script name the way it already named a part's PNG ("Group 1" is `Group_1`,
    "Layer 3" in it `Layer_3`), says so in the Output, and skips a name with no usable letters; art-pipeline.md has a Names section with the
    rules (ES-8).
  - rig-json.md's list of the right column's sections matches the build, and says how to move them; studio-ux.md marks its layout sketches
    as the first build and its palette proposal as built (SA-21).
  - skinning.md's line on Mina's hair says what it is now.

With batch F every batch is done. The leftovers, done after it (2026-11-10):

- A hover on an `animate` or `show` line of a rigged character links to the studio, and the Files panel starts with Themes folded, so the
  Characters list sits higher (ES-2).
- At 1100 px and below the side columns stop at 240 and 280 px, and a window under 700 px tall gives the timeline less height: at 1000x600
  the stage is 456x185, was 376x204 (ES-4). Still short at 600 px tall; folding the timeline gives it about 150 px more.
- The column grips take a press 12 px wide, mostly on the stage's side so the columns' scrollbars stay clickable (ES-19).
- Pointing at (or tabbing into) the Mesh row draws the mesh Generate would make, dashed over the part, and it follows the detail and
  margin (SD-14).
- Screen reader support (SA-11 and the ARIA parts of batch D) is out of scope for the editor and the studio, the author decided; what batch D
  built stays.

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
  *Fixed 2026-11-10,* first by keeping the text of unchanged parts. Then, since rig.json is mostly written by the editor, it was
  replaced by one fixed layout that every writer uses (`formatRig`): short objects such as a vertex's weights on one line, number lists
  on one line. The repository's rigs were rewritten in it once, and from then on an edit changes only its own lines. A layout made by
  hand is not kept. The Apply note no longer says "Ctrl+S saves": the editor saves the file at once.

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
