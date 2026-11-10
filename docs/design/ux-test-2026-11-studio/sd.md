# SD report: deformers in Model mode (as returned by the tester)

Counts: S1 1, S2 5, S3 11. Scripts s01..s27 and the screenshots are in scratchpad/ux/sd (paths below relative to it). No page or console errors in any run.

## Scope
1280x800 for everything, 1440x900 for the layout measurements (the right column is 339 px wide in both, so control y positions are the same; only the
fold moves: the column ends at 771 px at 1280x800 and 871 px at 1440x900).
Characters: robo (torso warp on `breathe`, legs, arm_r group warp, eyelids/eyes, a new torso_mask) and mina (a new mesh on `bangs` with weights, the
skinned `hair_back`).
Covered: all five tasks. Warp selection, soft selection, Mirror, Smooth, Scale, Rotate, the Breathe preset with Write keys, lattice size, undo; adding a
warp and binding it; Generate, Replace and Regenerate mesh; topology (add and delete a vertex, leaving with Esc); a group warp from a bone. Weights:
Bind, Auto-weights, the six brush modes (cursor and ring), Read, Select with a typed value, Mirror, test pose, ✕ unbind, Remove skin, leaving and
returning. Mask: point drag, add and remove a point, keyed points, New shape, Clip to. Apply, Close, reopen; the Problems count.
Not covered: Flip edge, Add edge, Remove edge; Prune and Reset to default bone; the Sine and Noise presets; the curve and "about the lattice centre"
options; the Esc guard's wording; pads; touch; narrow layouts.

## Task log
1 Warp on robo: done with friction, about 12 actions to key a point. Selection works (click, Shift-click, a rectangle from empty stage or from the
part's own art, All, None, Invert, row and column pickers, Ctrl+A with the stage focused). Stalls: the Warp controls are below the fold (SD-6); Esc
from the right column closes the studio (SD-2).
2 Add a warp and a mesh: done with friction. Following the Warp hint ("click a part with a warp to bind it to the active parameter") drops the
active parameter instead (SD-4); the way out is Keyforms > Bind to parameter… > tick lean > Bind 1 (3 clicks, a clear note). Mesh, Replace (clear
modal), topology and the group warp work.
3 Weights on mina: blocked at first, then done. mina has no parameters, so Generate mesh is disabled and the section says to edit rig.json (SD-1).
After a dummy parameter (+) everything worked: Bind, Auto-weights, the paint modes, Read, Select, Set, Mirror, test pose, ✕, Remove skin. State
survives Warp↔Weights and a tree row change and back. Stall: a click on a bone chip loses focus, so tool keys stop working (SD-3).
4 Mask on robo: done, with one damaging slip. Dragging, adding and Alt-click removing points, New shape and Clip to work; following the Mask hint added
a point that spikes the closed-eye keyform (SD-5).
5 Persistence: done. Apply writes the rig; Close/reopen keeps everything (the lattice at key 1 identical, bangs still has 3 bones). The Problems count
does not jump as in ES-1: mina 3→3; robo 3→4, the extra one the group warp warning (SD-16).

## Findings
SD-1 · S1 · usability/docs · A rig with no parameters cannot get a mesh, so a part cannot be skinned. s14-weights.mjs: on mina, chose bangs, face,
body, legs or top and pressed D. The Warp section says "This rig has no parameters. A warp bends with a parameter: add "parameters" to its rig.json.";
Add warp is disabled and Generate mesh is disabled at every Detail level, with no tooltip. The Weights section sends you back: "bangs has no mesh yet:
generate one in the Warp section (Mesh row), then come back." Skinning needs no parameter (mina's own hair_back is skinned with none), and the
Parameters section has a + that makes one in the studio, so the rig.json advice is out of date. Confirmed in code: `editor/anim-warp.ts` gates Add warp,
the group warp and Generate on `params.length`. Workaround (s15-weights-flow.mjs): + in Parameters, Enter, then Generate is enabled ("24 vertices, 26
triangles"). rig-json.md "Weighting a mesh in the studio" says only "generate it in the Warp section first". Expected: Generate mesh without a
parameter, or at least a button that makes one. Evidence: shots/14-bangs-weights-empty.png. Reproduced on 5 parts. Known: no.

SD-2 · S2 · bug · Esc with focus in the right column closes the studio, even with a deform tool on and points or vertices selected. s03-esc.mjs,
s18-keys-focus.mjs: Warp tool, the All button (12 points selected), Esc: the studio closes at once (no unapplied changes, so no guard). Weights: All
(71 vertices), Esc: closes. Expected (hint line, docs, stage-modes note): the first Esc clears the selection, the second goes back to Move. It works only
with the stage iframe focused (s03: Esc #1 cleared, #2 went to Move, #3 stayed open); every right-column button used to select (All, Invert, the row
picker) puts focus where Esc means Close. Confirmed in code: `anim-studio.ts` `onKeydown` closes on any Escape that reaches the dialog root. Evidence:
s02 log. Reproduced 4 times (2 Warp, 2 Weights). Known: no (the stage-modes note covers only Esc on the stage).

SD-3 · S2 · bug/a11y · A click on a bone chip in Weights drops focus to `<body>`, so tool keys stop working. s18-keys-focus.mjs: Weights on hair_back,
click the chip hair_2_0: `document.activeElement` is BODY, outside `#animStudio`; D and W then do nothing (the tool stays `weights`); the same in s17.
A keyboard user loses their place too. Expected: focus stays on the chip (or the redrawn one), and D/W/E/R keep working. Reproduced twice. Known: no.

SD-4 · S2 · usability/docs · The Warp and Mask hints say a click on a part binds it to the active parameter; a click drops the active parameter instead.
Hints: "Warp tool: click a part with a warp to bind it to the active parameter…", "Mask tool: click the outline of a shape… to bind its shape…".
s08-add-bind.mjs, s09-bind-path.mjs. Run 1: legs chosen, "Add warp to legs", click lean's name: legs dropped (crumb "lean"); then a click on legs on
the stage: Keyforms "Active parameter: none", nothing bound. Run 2: lean active first, D, click legs: the same. A drag with no parameter says "Pick a
slider in the Parameters section first", which leads back into the loop. Confirmed in code: `bindPart` is called only from the Bind pickers, and
`afterChoosePart` (`engine/src/studio-focus.ts`) drops a control the part is not bound to. rig-json.md lines 775-776 make the same claim for the Mask
tool. Expected: the click binds as promised, or the hint names Keyforms > Bind to parameter… (which works: "Bound legs to lean: keys at -1, 0, 1, all
at rest…"). Reproduced twice. Known: partly (the hint was not updated with the focus rules).

SD-5 · S2 · bug · With the Mask tool, a second click on the chosen shape's outline adds a point, and the new point breaks the shape's keyforms.
s23-mask-hint.mjs, s22-mask-edit.mjs: eye_open active, M, click the eyelids outline (chooses eyelids, 4 points), click the outline again as the hint
suggests: a 5th point is added with no note, and at eye_open=0 the closed lid has a peak (`567,362 640,338 673,362 673,362 567,362`): the new point
keeps its rest position in the keyform, so the eye shows through a triangle. Expected: no point added by a click meant to choose or bind; a point added
to a keyed shape is interpolated from its neighbours in the keyforms. Evidence: shots/23-eyelid-spike.png. Reproduced twice. Known: no.

SD-6 · S2 · usability · Each deform tool's controls start below or at the fold, and the controls one task needs are 300 to 700 px apart. Warp at
1280x800 (s01-warp-open.mjs, s05-warp-ops.mjs), torso, breathe active: Keyforms (450 px) and Properties (229 px) stay open above Warp; the Warp header
is at y=726 in a column that ends at 771, its first control (Detail) at 790; key chips 1113, All 1199, dx/dy 1407, Mirror 1545, Scale 1648, Write
keys 1819; 4 wheel notches to bring key "1" into view; the "No key at 0.5: dragging a point adds one…" hint is beside the key chips, about 1000 px
below the breadcrumb. Weights on hair_back (s13-weights-open.mjs): brush mode at 879, below the fold at both sizes. Mask on eyelids (s21-mask.mjs): the
point row at 864. Step 0 works: Warp folded when switching to Weights (s15). Evidence: shots/01-warp-on-1280.png, 05-scrolled-to-keys.png. Reproduced.
Known: yes (studio-inspector.md, items 1 and 5).

SD-7 · S3 · usability · A drag between keys adds a key silently with Warp and Mask. s04-warp-drag.mjs: at breathe=0.5 a drag of point 3 took the keys
from "0, 1" to "0, 0.5, 1"; the breadcrumb only said "torso › breathe @ 0.5" (with Move it says "no key here: a drag adds one"). Reproduced twice.
Known: partly (the Keyform block of the inspector plan).

SD-8 · S3 · usability · Ctrl+Z does nothing while a number field in the right column has focus. s06-warp-size-preset.mjs: ArrowUp in Lattice rows (3→4,
15 points), Ctrl+Z: still 4 rows; after a click elsewhere it worked. Confirmed in code: `onKeydown` skips Ctrl+Z when `typing`. Reproduced once. Known: no.

SD-9 · S3 · usability · Empty states point at the tree, show inert controls, or say what is already done. Warp with nothing chosen: "Choose a part in
the tree…" with enabled Point, dx, dy and Reset point that do nothing (s07). Weights with nothing chosen: "Choose a part in the tree…" (s13). Mask:
"Choose the Mask tool (M): drag a point…" shown while the Mask tool is on (s21). Reproduced. Known: partly (ES-9).

SD-10 · S3 · usability · The hint line contradicts itself about Esc: every deform-tool hint ends "…Esc with no point selected goes back to Move · Ctrl+Z
undo · Esc close"; Weights "B or Esc (nothing selected) back to Move · … · Esc close". Reproduced (all tools). Known: no.

SD-11 · S3 · usability · Keyforms says to pose with the gizmo (W, E, R) when the binding is a warp or mask ("Click a key… then pose the chosen part with
the gizmo (W, E, R)" for torso/breathe and eyelids/eye_open); those keys would leave the tool. Reproduced. Known: partly (studio-inspector.md step 0).

SD-12 · S3 · usability · With a test pose and a paint brush, a press just outside the gizmo ring paints weights. s19-unbind.mjs: at 32 % zoom a drag
starting about 1 px outside the 64 px ring bent nothing, painted and marked mina dirty; on the ring (s20-testpose.mjs, 4 of 4) it rotates. Seen once. Known: no.

SD-13 · S3 · usability · Mirroring weights asks for each bound bone's partner in a text box, one dialog per bone. s16-paint.mjs: Mirror on bangs with 3
bones gave 3 dialogs ("Which bone is the partner of "hair_4_0"…? Type its name"), each prefilled with the bone itself, no list to pick from; the
panel says bones pair "by name (arm_l with arm_r)", which does not help names like hair_0_0/hair_4_0. Seen once. Known: no.

SD-14 · S3 · usability · The margin field behaves unexpectedly. s10-mesh.mjs, legs at Medium: auto 23 vertices; 0 → 197 (more than Very high's 160);
10 and 40 → 23. No preview of the mesh before Generate. Seen once. Known: no.

SD-15 · S3 · usability · Status notes go stale, and some actions say nothing. "Click inside the mesh to add a vertex." stayed after leaving topology and
choosing the head bone (s12); Remove skin left the previous ✕ note (s19); adding a group warp left "upper_r, 1 of 2. Click again for the next." (s12);
Mirror L→R on the lattice says nothing (s05). Seen once each. Known: partly (ES-11).

SD-16 · S3 · usability · "Add group warp from arm_r" makes a group the rig check warns about. s27-robo-problems.mjs: Problems 3→4 after Apply with
"deformers.arm_r_warp.members: the parts sit on different bones (arm_r, forearm_r)…"; the studio said nothing when the group was made. Seen once.
Known: partly (TODO.md, group warps).

SD-17 · S3 · visual · Lattice handles are tiny at the opening zoom: at 32 % torso's lattice points are 26 px apart and overlap the bone dots (s04); at
66 % they are 53 to 66 px apart. Evidence: shots/04-drag-at-half.png. Known: partly (ES-20).

Docs: rig-json.md says a click with the Mask tool binds (it does not, SD-4) and omits the parameter requirement for meshes (SD-1). skinning.md's design
describes "Bind bones…" as a pick verb with colour chips and an eye per bone; the build is a select and a Bind button, one bone at a time (rig-json.md
matches the build). skinning.md line 219 still says hair_back "goes through 15 parameters into a lattice"; mina has no parameters now and hair_back is skinned.

## Where each tool's controls are
Right column top 47; bottom 771 at 1280x800, 871 at 1440x900; width 339 at both, so y is the same at both sizes.

| Tool (subject) | Open above it | Section header y | First control y | Below the fold at 1280 / 1440 | Controls needed together (distance) |
|---|---|---|---|---|---|
| Warp (torso, breathe active) | Keyforms 450, Properties 229 | 726 | Detail 790 | everything / all but Detail | key chips 1113, All 1199, dx 1407, Mirror 1545, Scale 1648 (535 px); the slider is in the left column (y 456) |
| Warp (legs, no warp) | Keyforms 248, Properties 229 | 524 | Add warp 588 | none | — |
| Weights (hair_back, 15 bones) | Keyforms 248, Properties 212; Warp folded | 541 | bone chips 605 | brush mode 879 and later, at both | active bone 605 + mode 879 (274 px); Select mode to value/Set 529 px |
| Weights (bangs, 2 bones) | the same; Warp folded by step 0 | 530 | Bind 630 | test pose 870 and later | mode 734, All 1010, Set 1177, Auto-weights 1369 |
| Mask (eyelids) | Keyforms, Properties | 652 | name 715 | points 864 / partly | point list and x, y 864, next to the stage drag |
| Mask (torso part) | Keyforms 248, Properties 334 | 607–698 | Clip to and New shape 670 | Mask body below at 1280 (mouth: header 698) | — |

**Does this support the inspector plan?** Yes. The tool's controls are never at the top; keying a warp needs the key chips, the selection and dx/dy
together, about 300 px apart, and the operations another 400. The tool's hint line, which acts as the options bar today, is at y=785, at the bottom of
the window, far from the tool row (y=70).

**Tool options (bar), as the tester would sort them:** Warp: All, None, Invert, row and column pickers, Soft with reach and curve, Mirror, Smooth,
Scale and Rotate with their about-select, presets with Write keys, the topology tools while Edit topology is on. Weights: brush mode, radius, strength,
active bone, the test pose (Rotate, Move, Reset pose), which the plan leaves out but is stage state; numeric ops on the selection perhaps a popover
from the bar. Mask: Add point, Remove point.

**Properties and verbs (inspector):** Warp: lattice columns and rows; Detail, margin, Generate, Regenerate, Replace; Edit topology; Remove warp; group
members. Weights: bound bones with ✕, Bind, Auto-weights and blend, Remove skin. Mask: Clip to, New shape, name, Rename, on bone, follows, Delete
shape. Keyform: dx/dy, the shape's point x/y, key chips, Delete key.

**A risk for the plan:** buttons in a bar take focus outside the stage iframe, so Esc there must not close the studio (SD-2), and focus must not fall
to body (SD-3).

**Unintended results of stage clicks:** with a parameter active, a click on an unbound part dropped the parameter (SD-4); a second click on a chosen
mask outline added a point (SD-5); a press just off the test-pose ring painted (SD-12); Alt-click on arm_r showed a cycle note about upper_r while
choosing the bone.

## What worked well
- Lattice selection: a rectangle that starts on the part's own art selects points without changing the part; a click on empty stage clears the points
  and keeps the part; Esc on the stage clears first, then goes to Move; soft selection tints the points it will pull (reach 1.5 and 3) and the drag
  falls off as tinted; Mirror (L→R and selection), Smooth, Scale 1.1 and Rotate 10 give exact, symmetric results.
- Undo is one step per drag, stroke or operation, and Ctrl+Y redoes. The in-between at 0.5 is exactly halfway (396 → 381 → 366).
- A lattice resize keeps the shape (2→4 columns resamples the keyed lattice).
- Clear notes and dialogs: the Breathe preset's Write keys says "Breathe written as the keys of breathe (0, 1)"; Replace lattice with mesh and Remove
  skin ask in clear modal dialogs.
- The Weights tool's cursor and ring match the design (no cursor plus the ring for Add, Subtract, Replace, Smooth from the first hover; a crosshair for
  Read; a cell cursor for Select); the hint line names the brush mode and active bone; Read gives "vertex 5: hair_0_0 0.6377 · hair_4_0 0.3623" and Set
  "Set hair_4_0 to 0.8 on 12 vertices."; the per-mesh state survives Warp↔Weights and a tree round trip; the test pose bends the mesh with nothing keyed.
- Bind to parameter… and New shape say exactly what they did.
- Persistence is solid, and the Problems count no longer jumps when the studio opens (ES-1 looks fixed for these files).
