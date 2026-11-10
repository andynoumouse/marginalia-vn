# Animation studio: the right column holds properties, the tool holds its options

Status: proposed 2026-11-09, revised the same day after a review by a second reader ([studio-inspector-review.md](studio-inspector-review.md)); the
open questions are decided (below). **Done**: steps 0 to 5 are built (2026-11-09); what is left of the UX round is under step 5. Follows [studio-ux.md](studio-ux.md) (layout, sections), [studio-focus-and-verbs.md](studio-focus-and-verbs.md)
(one focus, verbs that ask for their target) and [studio-stage-modes.md](studio-stage-modes.md) (what a click does per tool). Those notes fixed
*what is chosen*; this one is about *where the controls for it sit*.

## What the right column holds today

Measured in Model mode at 1440 x 900 (the right column is 340 x 824; 724 px high at 1280 x 800):

| State | Column content, px | Largest block |
|---|---|---|
| robo torso, `breathe`, Move | 1021 | Keyforms 619 |
| robo torso, `breathe`, Warp | 1986 | Warp 1168 (35 controls) |
| robo head, `head_x`, Move | 1248 | Keyforms 745 (28 controls) |
| robo eyelids, Mask | 1066 | Mask 392 |
| mina hair_back, Weights | 1819 | **Weights 1221 (57 controls)** |
| mina bangs, Warp (mesh) | 1141 | Warp 525 |

What goes wrong:

1. **The tool's controls start below the fold.** Choosing a tool opens its section, but the section sits after Keyforms and Properties: with Warp
   on, its first control is about 850 px down; on a skinned mesh the Weights brush row is at y=850, below the fold at 1280 x 800.
2. **Sections piled up** (fixed in step 0: a tool folds the section it opened when it is left).
3. **Four kinds of thing share one stack.** Properties of the focus (pivot, bone, pose fields, a warp's lattice size, a mask's clip), *verbs*
   (Bind parts…, Bind to parameter…, Copy keys, Same pivot for…, Replace lattice with mesh, Remove warp, Mirror, Smooth, Scale, Rotate, Write keys,
   New shape), *tool options* that are stage state (the Warp selection, Soft and reach; the Weights brush), and *rig-wide setup* that has nothing to
   do with the focus (Physics, Reactions).
4. **Nothing has a place.** The Properties header sits anywhere from y=186 to y=792 across the six states, Moved by from 208 to 692: a fixed order of
   blocks does not fix that while the top block's height changes with the focus.
5. **Most of Keyforms is repetition, not the keyform.** In the head / `head_x` keyform (745 px) the keys and pose are 264 px; the Active parameter
   block, its hint and Bound parts 248, Copy keys 99, Moved by 100. The column names `head` six times and `head_x` four.
6. **The Warp and Weights sections are six panels each**: structure, keys, a selection toolkit, values, operations on the selection, presets or a
   brush.
7. **The status line moves the stage.** With a part on a bone chosen its hint wraps to two lines, and the stage box loses 17 px each time.

And one measurement that decides the open questions: **the stage is limited by its width, not its height.** The art sits in a 16:9 canvas with 324
to 396 px of black above and below it at every size measured (1440 x 900: a 774 x 435 canvas in a 776 x 770 box).

## The model

Each control goes where its *kind* says, and each place changes for one reason only.

| Kind | Example | Where | Changes when |
|---|---|---|---|
| **Tool options** | brush mode, radius, strength; the selection (All, None, Invert, row, column); Soft and reach; Mirror, Smooth, Scale, Rotate *of the selection*; the test pose | the **tool options bar**: under the tool row, over the stage, a fixed height, never empty | the tool changes |
| **Focus** | what is in focus, what the gizmo writes to, and the verbs that join it to something else | the **focus header**, pinned at the top of the right column above its sections | the focus changes |
| **Focus properties** | a keyform's values and ease; the part's pivot, bone, warp structure, skin, clip | the **inspector** sections under the header, in a fixed order | the focus changes |
| **Rig-wide setup** | Physics, Reactions | a **strip under the stage** in Model mode (where Animate has its timeline), with tabs, folded by default | never by itself |

### The tool options bar

A fixed height (one line, two when the row is narrower than its content, as at 1024 px where the row is 424 px wide), left aligned under the tool
row. It is never empty, so the stage never changes height on a W / D switch. It costs no art: the stage box's letterbox is 324 to 396 px. It is
Cubism's *Tool Details* palette, and the docs and F1 call it that.

| Tool | Bar |
|---|---|
| Move, Rotate, Scale | what the gizmo writes to and whether a drag writes: `poses spine, the bone torso sits on · spine is not bound to breathe: D keys torso's warp` (the "line over the stage" rig-json.md promises, and the mode badge stage-modes left open) · World axes |
| Pivot | Clear · Same pivot for… (the tool is the pick, so Pick on stage goes) |
| Warp | the mode (`Warp · torso`) · All, None, Invert, row ▾, column ▾ · Soft ☐ reach · Mirror ▾ · Smooth · Scale and Rotate (icons that apply the last value, the value in their ▾) · Presets ▾ (shape, amount, Write keys); with Edit topology on, the topology tools instead |
| Weights | the mode (`Weights · Add on hair_1_0`) · brush mode icons · radius · strength · active bone ▾ (the one place it is chosen) · test pose (Rotate, Move, Reset); in Select mode also All, None, Invert, Set value ▾, Mirror |
| Mask | the mode · Add point · Remove point |

The tester's sorting of every Warp, Weights and Mask control into bar or inspector ([ux-test-2026-11-studio/sd.md](ux-test-2026-11-studio/sd.md),
"Where each tool's controls are") agrees with this table, except Auto-weights (in Skin: it rewrites the skin) and New shape (in Clip: it acts on a part).
Every button is an icon with a tooltip; rows, columns, bones and presets are ▾ pickers. `[` and `]` change the brush radius (Shift: strength), as
in paint programs. The status line loses its mode clause (the bar has it), stays one line (ellipsis) and never moves the stage.

**Esc and focus.** Fix 1 of the UX round hands Esc from anywhere in the dialog to the stage while a deform tool is on, so a bar button does not
close the studio. The order is: an open popover, then a typed field, then the stage selection, then Move, then close; every bar popover (and the
Pivot bar's Same pivot list) takes its own Esc first, as the Bind picker does. When Esc goes back to Move and removes the bar button that had the
focus, the focus goes to the pressed tool button (the focus keeper has no replacement there, so it would fall to the page). A browser test presses
Esc on the first button of each bar.

### The focus header

Pinned above the right column's dock zone, not inside a section, so docking or reordering cannot move it; a fixed ~64 px, the sections scroll under
it.

- **The breadcrumb's words are compact pickers**: `torso ▾ › breathe ▾ @ 0 · key`. The part word lists the other parts bound to the parameter (today's
  Bound parts, each with its kind, key count and the ✕ that unbinds it, so nothing of that list is lost); the parameter word lists what moves the
  part (today's Moved by, each choosing that parameter). One line replaces about 200 px and keeps the one-focus navigation where the focus is named.
- **The action row**, visible buttons, one line: only the verbs that join the focus to something else. A parameter: Bind parts…; a part: Bind to
  parameter…, Copy keys from…; a keyform: Copy form, Paste form. A verb that cannot run is disabled with the reason as its tooltip. A ⋯ at the end
  only if a fourth verb appears. The Bind picker stays inline, opening under the row (the testers liked it), not a popover.

### The inspector sections, top to bottom

1. **Keyform** (keyform focus): the key strip (‹ -1 0 1 ›, Add / Remove key), then the values for the binding kind (pose in two rows of three, x y rot
   / sx sy opacity; the selected lattice or mesh points' dx, dy; the shape's points), then the ease; **Copy form**, **Paste form** (mirrored too) and
   **Reset**, the per-key operations a Cubism user reaches for. A part bound in two ways shows a kind switch (pose | warp) instead of both.
2. **Parameter** (parameter focus, in place of 1 and 3): the parameter's properties, with the palette's ✎ editor moved here (name, group, range,
   default, ease), so the palette is a control surface again. The Active parameter block goes.
3. **Properties** of the part or bone, as sub-blocks: *Transform* (pivot, bone or parent), *Deform* (warp or mesh: lattice size, detail, margin, group
   members), *Skin* (bones bound and unbound, Auto-weights and blend), *Clip* (what it is clipped to, New shape; a shape's bone, follows, clips).
   - A sub-block opens by itself only when the tool in use has a next step there (no warp: Add warp, Generate mesh; no skin: Bind bones). Otherwise
     it is one summary line, and the column is never scrolled for the author.
   - Each folded line carries its primary verb (`No warp · Add warp`) and its destructive one (Remove warp, Remove skin, Delete shape), so neither is
     in the action row.
   - **A Ctrl-click set** shows "3 parts", the fields they share, and mixed values blank. **A bone** shows Rename, Parent, Remove bone, New bone
     (today in the tree's detail).

The Warp, Weights and Mask sections go; the dock loses three ids, which `fixDock` already drops from a stored layout. Projected: robo torso with Warp
about 550 px (1986 today), mina hair_back with Weights about 620 (1819 today); both fit 724 px, so neither scrolls at 1280 x 800.

### The rig strip

Model mode's space under the stage, where Animate has the timeline: a strip with tabs (Physics | Reactions; the two are never needed together, which
is the test studio-ux.md set for tabs), folded to its tab row by default; open, 240 px still leaves a 616 x 430 stage box for a 616 x 346 canvas at
1280 x 800. Poses stays with the palette. Replacing Physics' six JSON text areas (2153 px) with fields matters more than where they sit.

### What stays

The one focus, the click rules per tool, the dock and its movable sections, the left column (Look, Poses, Parameters, Parts). Animate mode's
inspector (Properties, Frames, Place in scene) changes only by gaining the focus header.

## Steps

Each is a small session, keeps `npm test` green, updates the browser tests that find controls by section (they move, they are not loosened),
updates the docs and tooltips it touches (several still say "the Warp section"), and re-measures the six states above at its end. The pure rules
(`engine/src/studio-inspector.ts`: what the bar, the header and the sections show by mode, focus kind, tool and the part's bindings) grow with each
step, tested, rather than being written whole first. Ordered by pixels removed per unit of risk:

0. **Fixes, no design change.** Built 2026-11-09: the property rows are `.as-prow` (the tree keeps `.as-row`) and `hidden` wins over their display
   rules; Keyforms names the binding a part has when it is not the tool's kind; a deform tool folds the section it opened when it is left.
1. **The bar**, with Weights' brush, test pose and selection operations (−756 px on a skinned mesh), the Move / Rotate / Scale line, and the Esc and
   focus rules above. Built 2026-11-09 (`engine/src/studio-inspector.ts`: `toolBar`, `modeLabel`, `weightsBar`, `gizmoLine`, `brushStep`;
   `dialogEscape` in studio-keys.ts). Choices made while building it:
   - The bar is one line from 780 px of width, else two, set by its width and never by the tool, so a W / B switch never moves the stage
     (at 1440 x 900 the stage box is 733 px high at every tool; it was 753 to 770 as the status line wrapped).
   - Radius and strength show only for the painting modes; in Select mode their place goes to the selection operations, which is what lets
     the widest panel fit one line at 1440. Set value and Mirror are ▾ panels (`editor/studio-popover.ts`); the count shows only with a
     selection.
   - The active bone ▾ is the one place it is chosen: the bound bones in the section are names with their ✕, no longer toggles.
   - Pick on stage went (the Pivot tool is the pick). Esc on Rotate, Scale and Pivot goes back to Move too, not only on the deform tools.
   - Measured after it, same method as before it (the right dock's scroll height at 1440 x 900, sections folded as a tool leaves them):

     | State | Before, px | After, px | Largest block after |
     |---|---|---|---|
     | robo torso, `breathe`, Move | 1071 | 1002 | Keyforms 619 |
     | robo torso, `breathe`, Warp | 2053 | 1984 | Warp 1185 |
     | robo head, `head_x`, Move | 1299 | 1212 | Keyforms 745 |
     | robo eyelids, Mask | 1133 | 1047 | Mask 392 |
     | mina hair_back, Weights | 1786 | 1110 | Keyforms 248 / Weights 547 (was 1188) |
     | mina bangs, Warp (mesh) | 1192 | 1122 | Warp 525 |

     Weights gives −676 px, not the −756 projected: what is left in its section (the 15 bound bones, 274 px; Vertex; Auto-weights) is the
     Skin sub-block of step 4. The −69 to −87 elsewhere is the Pivot row's three buttons.
2. **Warp's selection, operations and presets into the bar** (−584 px). Built 2026-11-09 (`warpBar` in studio-inspector.ts). The bar:
   All, None, Invert, row ▾, column ▾ (a lattice), the count, Soft (a toggle; reach and fall-off under its ▾); Mirror ▾ (left to right,
   right to left, chosen points), Smooth, Scale and Rotate (icons that apply the values under the ▾ next to them), Presets ▾. With Edit
   topology on, its six tools take the place of all that; the Edit topology toggle and the Point row (dx, dy, Reset) stay in the section,
   which step 4 sorts. The topology tools were text buttons until 2026-11-10; they are icons now (`vertex-add` to `edge-remove` in studio-icons.ts). Measured after it: robo torso with Warp 1399 px (1984 after step 1),
   the Warp section 600 (1185); the other five states did not change (mina bangs has no warp, so its section is the Mesh row).
3. **The pinned focus header** with the crumb pickers and the action row; the Active parameter block goes, the ✎ editor moves into Parameter, Copy keys
   becomes a verb (Keyforms 745 → about 230). Split in two:
   - **3a, built 2026-11-09** (`focusHeader` in studio-inspector.ts; `editor/anim-bind.ts` draws the header and Keyforms). The header sits in
     `.as-inspect` above the right dock zone, 64 px, and the dock scrolls under it. Line 1 `torso ▾ › breathe ▾ @ 0 · key`: in a keyform each word
     is still the way up to itself alone; with half the focus missing the other half is named (`no part ▾ › breathe`, `torso › no parameter ▾`), so
     the ▾ of the missing half (the bound parts, or what moves the part) is always one click away. The ▾ lists are `Popover`s (Esc closes, the
     focus goes back to the ▾); a choice closes the list, a ✕ leaves it open. Line 2, the action row: Bind parts… (a parameter), Bind to parameter…
     and Copy keys from… (a part); a keyform has all three, which fit one line at 340 px only as Bind parts…, Bind to…, Copy keys… (the full names
     are the buttons' accessible names). Disabled verbs say why in the tooltip (every part bound already; no parameters; Copy keys with no parameter,
     with the Warp or Mask tool, or with no source). Copy keys from… is the inline picker in single-choice mode with mirror poses and reverse range.
     Keyforms keeps the keys, Grid on a pad (its own row, for a pad), the pose as two rows of three (x y rot / sx sy opacity), the ease and Reset
     pose; with no keyform in focus it says what to choose. Its old hint is the status line's. The header is Model only: Animate's Properties
     section names the chosen part already. The active parameter's range ("-1 to 1, default 0") went with its block; 3b's Parameter section shows it.
     Measured after it (the right dock's content height at 1440 x 900, layout cleared; the 64 px header is above it, so the dock's own height is 761):

     | State | After step 2, px | After 3a, px | Largest block after |
     |---|---|---|---|
     | robo torso, `breathe`, Move | 1002 | 520 | Properties 210 / Keyforms 136 (619) |
     | robo torso, `breathe`, Warp | 1399 | 1035 | Warp 584 |
     | robo head, `head_x`, Move | 1212 | 699 | Properties 294 / Keyforms 231 (745) |
     | robo eyelids, Mask | 1047 | 850 | Mask 392 |
     | mina hair_back, Weights | 1110 | 923 | Weights 527 |
     | mina bangs, Warp (mesh) | 1122 | 955 | Warp 525 |

     Two of the six no longer scroll at 1440 x 900.
   - **3b, built 2026-11-09** (`absentByFocus`, `rangeLine` and the keyform's `formOps` in studio-inspector.ts; `pasteForm` in key-copy.ts;
     `editor/anim-param-props.ts` draws the section). A parameter alone in focus shows the **Parameter** section in place of Keyforms and Properties
     (a dock panel of its own, `param`; a stored dock layout without it gets it right after Keyforms): the range line, then name, category, min, max,
     default, ease, ▲ ▼ and Delete parameter, the palette's ✎ fold-out moved as it was. Its fields are made once and filled in place, so Tab after a
     changed field goes on to the next (the focus keeper now steps on from a field that stays, not only from its replacement). A pad shows its own
     name, category and Delete pad and its two parameters as buttons that make that axis the focus (an axis shows its fields, the category locked,
     and a way back to the pad). The palette's rows lost their ✎; a click on a name already makes the control the focus, and a new parameter or pad
     opens the section with its name ready to type. Adding (the + menus and the New pad form) stays in the palette: it makes a control, it is not
     a property of one. Keyforms has **Copy**, **Paste**, **Paste mirrored** and **Reset** under the pose (short labels so the four fit one line at
     340 px; Reset replaces Reset pose): Copy keeps the pose on show (a key's, or the blend between keys) in a studio-only clipboard, Paste writes
     it at the slider's spot of what the gizmo poses (snapped as a drag is: a pad's nearest corner) as one undo step, mirrored flips x moves and
     rotations as Copy keys' mirror does. Only a pose: copying a warp's points is left for later (the Warp section's selection would need a
     clipboard of its own). The action row keeps its three verbs and gains the **⋯** the plan allowed for a fourth: Copy form, Paste form, Paste
     mirrored, each disabled with the reason. Measured after it, as 3a was:

     | State | After 3a, px | After 3b, px | Largest block after |
     |---|---|---|---|
     | robo `breathe` alone (new) | – | 408 | Parameter 235 |
     | robo torso, `breathe`, Move | 520 | 520 | Properties 210 / Keyforms 136 |
     | robo torso, `breathe`, Warp | 1035 | 1035 | Warp 584 |
     | robo head, `head_x`, Move | 699 | 735 | Properties 294 / Keyforms 267 (+36: the Copy, Paste row) |
     | robo eyelids, Mask | 850 | 850 | Mask 392 |
     | mina hair_back, Weights | 923 | 923 | Weights 527 |
     | mina bangs, Warp (mesh) | 955 | 955 | Warp 525 |

     Three of the seven no longer scroll at 1440 x 900 (the dock is 761 px high under the header); the four that do are the Warp, Weights and Mask
     sections, which step 4 removes.
4. **The Properties sub-blocks**; the Warp, Weights and Mask sections go (built: 4a to 4d). Model mode only: Animate's Properties (At the playhead, the key fields,
   the parameter key) stays as it is. Sub-plan:
   - **Where each control goes.** Kept class names, so most selectors only change their section prefix.

     | Now | Goes to |
     |---|---|
     | Properties: the name row | goes in Model (the header names the focus); stays in Animate |
     | Properties: Pivot x, y, its hint, the rest note | *Transform* (the hint becomes the row's tooltip) |
     | Properties detail: On bone ▾, Choose bone | *Transform* |
     | Properties detail: a slot's Variants | *Variants*, a folded line under Clip (`Variants · eyes_open`), slots only |
     | Properties detail: a bone's Moves …, Name and Rename, Under ▾, Remove bone | the bone view (below) |
     | Warp: Target ▾ (own warp or group) | *Deform*'s summary line, as a compact picker: it decides what the rest and the bar edit |
     | Warp: Add warp, Add group warp | *Deform* (primary verb of its line) |
     | Warp: Members, Use selected parts, the clip issues and their fix | *Deform* (the issue shows once, here; Clip's line gets a ⚠ with it as tooltip) |
     | Warp: Mesh row (Detail, margin, vertex count, Generate / Regenerate / Replace lattice with mesh) | *Deform* |
     | Warp: Lattice columns, rows, mesh summary, Remove warp | *Deform* (Remove warp is the line's destructive verb) |
     | Warp: Edit topology | the **bar**, an icon toggle first in the Warp panel for a mesh: it swaps what the bar shows, a tool mode |
     | Warp: Keyform row (Keyed to …, Delete key, key chips) | **Keyforms**: its key strip, ‹ › and Add / Remove key serve a warp binding too (`warpTicks`); the note goes, the header names the parameter |
     | Warp: Point row (point ▾, dx, dy, Reset point) | **Keyforms**, the values of a warp binding (in place of the pose's six fields); Keyforms' Reset resets the chosen points |
     | Weights: Bones bound (names with ✕), Bind ▾ + Bind | *Skin* (Bind ▾ is the line's primary verb) |
     | Weights: Vertex (readout, per-bone fields) | *Skin*: weights are not keyforms, so they stay with the skin |
     | Weights: Auto-weights with blend, Remove skin | *Skin* (Remove skin is the line's destructive verb) |
     | Mask: Clip to ▾, New shape, Remove clip | *Clip* (Clip to ▾ in the line once clipped; New shape primary, Remove clip destructive) |
     | Mask: Shape name, Rename, Delete shape, on bone ▾, follows ▾, what it clips | *Clip* of a shape |
     | Mask: Points (point ▾, x, y) | *Clip* of a shape: the studio edits the shape's rest outline (its keyforms are written in rig.json), so it is not a keyform value |
     | Mask: Add point after, Remove point | the **bar**'s Mask panel, which is empty today |
     | the sections' "none" and problem hints | the sub-block's summary text, or its tooltip when the line is full |

   - **The sub-blocks.** Each is a head line (chevron, name, summary, then its verbs as icon buttons with tooltips) and a body. Order: Transform,
     Deform, Skin, Clip, Variants (the order a part is rigged in: where it turns, how it bends, what bends it, what hides it).

     | Sub-block | Shown for | Summary by state | Primary · destructive | Opens by itself |
     |---|---|---|---|---|
     | Transform | a part, a shape | never folded: two rows, Pivot and On bone (its verbs, Clear and Same pivot, are in the Pivot bar) | – | – |
     | Deform | a part; a bone or a set (a group warp only); a shape in a group | `No warp` · `Lattice 2×3` · `Mesh 212 vertices` · `Group face, 4 parts` · `Bent by group face` (a shape) | Add warp (none), Generate mesh in the body · Remove warp / Remove group warp | Warp tool with no warp to edit (Add warp, Add group warp, Generate mesh); Weights tool on a part with no mesh (Generate mesh) |
     | Skin | a part with a mesh; with the Weights tool, any part (`No mesh: Generate mesh in Deform`) | `Not skinned` · `2 bones` | Bind ▾ · Remove skin | Weights tool on a mesh with no bones bound (Bind), or in Read weights mode (the Vertex row is the readout) |
     | Clip | a part, a shape | `Not clipped` · `Clipped to lid ▾` · `Shape on head, 6 points, clips 2` | New shape · Remove clip / Delete shape | Mask tool on a part that is not clipped (Clip to, New shape), or on a shape (its points) |
     | Variants | a slot | the variant shown | – | never |

     An opened-by-itself sub-block folds again when the tool is left, unless the author opened or folded it meanwhile (step 0's rule for sections,
     now per sub-block); the author's choice is kept with the sections' open flags. Into `studio-inspector.ts`: `propBlocks(state)` giving, per
     sub-block, shown, opens-by-itself, the summary text and the two verbs (id, label, enabled, title); its state is the focus kind (part, shape,
     bone, set), the tool and brush mode, the warp kind (none, lattice, mesh, group, candidates), the mesh and bones bound, the clip and the shape.
     `shapeSummary` and the Warp and Weights `summary()` texts move into it.
   - **A Ctrl-click set** (the parts ticked in the tree): the header says `3 parts`; Transform shows On bone ▾ and Pivot, blank when the values
     differ, and a value typed or chosen is set on all of them as one undo step; Deform shows the group warp they all share, or Add group warp from
     the 3 parts; Clip shows Clip to ▾ (blank when mixed), set on all. Skin and Variants are per part and do not show. Rule in
     `studio-inspector.ts`: `sharedField(values)` (the value, or blank when mixed).
   - **A bone**: Transform is the bone's Pivot, Name and Rename, Under ▾ (its parent), Remove bone as the destructive verb, and the `Moves …` line;
     Deform is its group warp (`No group warp · Add group warp from torso`); no Skin or Clip. New bone stays at the foot of the Parts tree: like
     the palette's +, it makes a thing rather than being a property of one (3b's rule).
   - **Docking.** `warp`, `weights` and `mask` leave `STUDIO_SECTIONS.model` and the right zone's start; `fixDock` already drops unknown ids
     from a stored layout, so a stored layout keeps its order otherwise and one that was the default stays the default (Reset hides); stale open
     flags for the three are ignored. The right column is then Keyforms, Parameter, Properties, Physics, Reactions (the last two leave in step 5).
     `toolOpened` gives way to the per-sub-block rule above.
   - **Sessions**, each with `npm test` and the studio browser tests green, the docs, F1 and tooltips that say "the Warp / Weights / Mask
     section" updated, and the six states re-measured:
     - **4a, the frame and Clip**: `propBlocks` with Transform, Clip and Variants; the sub-block head line; the bone view; the Mask section goes
       (dock id `mask`); Add and Remove point move to the Mask bar. Moves: `.as-sect[data-sect="mask"]` (5: summary and open state become
       `.as-sub[data-sub="clip"]`'s), `.am-add` / `.am-del` (into `.atb[data-bar="mask"]`), the shape row's "Edit it in the Mask section" text,
       `.as-bone-*` (8, now under Transform).

       **Built 2026-11-09.** `propBlocks(state)` in studio-inspector.ts (`PROP_BLOCK_IDS` gives the order of all five, `subOpenKey`); the state is
       the row kind (`part`, `shape`, `bone`, and `set` ready for 4d), the tool and brush, a part's clip, a shape's bone, points and clips, a
       slot's variant on show; 4c adds the warp and skin fields and the Deform and Skin entries. `editor/anim-props.ts` draws the frames
       (`subBlockHtml`, `PropBlocksPanel`): a head line (chevron, name, summary, a pick slot, icon verbs) over a body the panels fill. The open
       flags are kept as `sub:<id>` with Model's section flags (`readLayout` keeps them); the studio opens a sub-block whose `auto` is true,
       remembers that it did, and folds it on the next tool change unless the author toggled it meanwhile (toggled, it is also not reopened by
       itself until the tool changes). `toolOpened` stays for the Warp and Weights sections until 4c. Choices made while building it:
       - **Transform is not shown for a shape**: a shape has no pivot, and its bone and `follows` sit with its outline in Clip, so Transform would
         be empty. A bone's Transform has the line `Transform · Bone` with a bin icon (Remove bone), then Pivot, `Moves …`, Name and Rename, Under ▾.
       - **Clip opens by itself also on a part clipped to a shape** (its points are what the Mask tool edits), not only on an unclipped part or a
         shape; a part clipped to another part's silhouette has nothing to edit, so Clip stays folded there.
       - Once clipped, **Clip to ▾ moves into the head line** (`Clip · Clipped to eyelids ▾`, then the New shape and Remove clip icons), so the clip can be changed while folded; the
         explanation (`eyes is drawn only inside eyelids.`) is the body's first line. The clip-group issue and its fix stay in Clip's body until
         4c gives them to Deform.
       - Rename stays a text button in the shape's row (the verbs in the line are icons: New shape, Remove clip, Delete shape, Remove bone).
       - The Pivot row's hint is its tooltip, and the row reads `Pivot x [ ] y [ ]` on one line at 340 px; the name row (`.as-sel-name`) is
         Animate only. Nothing chosen, Properties says so in one line (`.as-subs-empty`).
       - `shapeSummary` (mask-edit.ts) went: its texts are Clip's summaries now.

       Measured after it (as 3b was: the right dock's content at 1440 x 900, layout cleared, 761 px under the header). Every state loses the Mask
       section's folded 35 px header; robo's head is a bone, so that state shows the bone view.

       | State | After 3b, px | After 4a, px | Largest block after |
       |---|---|---|---|
       | robo `breathe` alone | 408 | 373 | Parameter 235 |
       | robo torso, `breathe`, Move | 520 | 448 | Properties 174 (Transform 107, Clip line 31) / Keyforms 136 |
       | robo torso, `breathe`, Warp | 1035 | 964 | Warp 584 |
       | robo head, `head_x`, Move | 735 | 630 | Keyforms 267 / Properties 225 (the bone view, 189) |
       | robo eyelids, Mask | 850 | 605 | Properties 386 (Clip open on the shape, 350) |
       | mina hair_back, Weights | 923 | 886 | Weights 527 |
       | mina bangs, Warp (mesh) | 955 | 884 | Warp 525 |

       Four of the seven no longer scroll at 1440 x 900 (eyelids with the Mask tool is new); the three that do are the Warp and Weights
       sections, which 4b and 4c take apart.
     - **4b, a warp's keyform in Keyforms**: the key strip, Add / Remove key and the Point row for a warp binding; the Warp section loses its
       Keyform and Point rows. Moves: `.aw-keys`, `.aw-delkey`, `.aw-keyhint`, `.aw-active`, `.aw-form`, `.aw-pick`, `.aw-dx`, `.aw-dy`,
       `.aw-reset`, `.aw-pthint` (about 25 uses, into the Keyforms section).

       **Built 2026-11-09.** With the Warp tool, Keyforms serves the warp the Warp section targets as it serves a pose: the key strip (its
       keys on the active slider, ‹ ›, **Add key here** / **Remove this key** at the slider's value; any warp key can go, as Delete key allowed),
       a `Warp` line saying what a drag will do (`the warp of torso at 1 (a key): a drag changes it`), then the **Point** row (point ▾, dx,
       dy) in place of the pose's six fields, then Copy, Paste, Paste mirrored, Reset. Rules in studio-inspector.ts: `pointKeyStrip` (the
       strip of a warp or a mask) and `formOps` for a warp (`FormState`: the clipboard's kind, whether it fits, a lattice, the points
       chosen); `addWarpKey` and `pasteWarpForm` in warp-edit.ts. The Point row is still drawn by `WarpPanel`, into Keyforms' `.ab-points`.
       Moves: `.aw-keys` → `.ab .ab-keybtns`, `.aw-delkey` → `.ab-keyhere`, `.aw-keyhint` → `.ab-formtext`, `.aw-active` → the header's
       parameter word, `.aw-reset` → `.ab-reset`; `.aw-pick`, `.aw-dx`, `.aw-dy`, `.aw-pthint` keep their names under `.ab-points`. Choices
       made while building it:
       - **Copy and paste a warp's shape.** Copy takes every point's move on show (a key's, or the blend between keys); Paste writes it at
         the slider's value as one undo step, on a warp with as many points (another key of the same warp, or a lattice of the same size);
         Paste mirrored flips it sideways on a lattice (column c takes column cols − c, dx changes sign) and is disabled on a mesh with the
         reason (its vertices have no fixed partners: paste, then Mirror ▾). The one clipboard holds a pose or a warp's shape; each pastes
         only as what it is, and the other kind says so in the tooltip.
       - **Reset** with the Warp tool takes the chosen points back to rest in this keyform (`Reset points`, disabled with no point chosen).
       - **The Point row's hint is its tooltip** (as 4a did for Pivot), so the row is one line: point ▾ | dx | dy.
       - **A mask binding** (a shape keyed in rig.json, as robo's eyelids on eye_open): before 4b Keyforms showed only a line pointing to the
         Mask section, which 4a removed. Now it shows the shape's keys to go to (no Add / Remove: the studio edits the rest outline, not its
         keyforms), a `Shape` line saying the keys are written in rig.json, and no copy or paste.
       - The row's name says the kind: Pose, Warp, Shape.
       - Fixed on the way: the Warp section's Point row showed, empty, for a part without a warp (mina bangs), 105 px.
       - Keyforms follows a point drag as it goes (the drag's steps redraw it, as they redrew the Warp section's key chips), and the
         Presets ▾ panel closes after Write keys: open, it covers Keyforms' key strip, where the new keys are.

       Measured after it (as 4a was):

       | State | After 4a, px | After 4b, px | Largest block after |
       |---|---|---|---|
       | robo `breathe` alone | 373 | 373 | Parameter 235 |
       | robo torso, `breathe`, Move | 448 | 448 | Properties 174 / Keyforms 136 |
       | robo torso, `breathe`, Warp | 964 | 783 | Warp 283 (584) / Keyforms 223 (key strip, Warp line, Point row, ops) |
       | robo head, `head_x`, Move | 630 | 630 | Keyforms 267 / Properties 225 |
       | robo eyelids, Mask | 605 | 605 | Properties 386 |
       | robo eyelids, `eye_open`, Mask (new) | – | 686 | Properties 386 / Keyforms 162 (the shape's keys) |
       | mina hair_back, Weights | 886 | 886 | Weights 527 |
       | mina bangs, Warp (mesh) | 884 | 779 | Warp 420 (the empty Point row went) |

       Five of the eight no longer scroll at 1440 x 900; the three that do are the Warp and Weights sections, which 4c takes apart.
     - **4c, Deform and Skin**: the Warp and Weights sections go (dock ids `warp`, `weights`), Edit topology into the bar. Moves:
       `.as-sect[data-sect="warp"]` (24, the summary is now Deform's, e.g. `mesh 212` → `Mesh 212 vertices`) and `[data-sect="weights"]` (11),
       `.aw-topoon` (4); the "choosing the tool opens its section" and "folded when the tool is left" checks become the opens-by-itself rules.

       **Built 2026-11-09.** `propBlocks` has Deform and Skin (`DeformState`, `SkinState`, the verbs `addWarp`, `addGroupWarp`, `removeWarp`,
       `bind`, `removeSkin`; a block's `warn`); `warpBar` has `topoToggle`. `WarpPanel` fills Deform's body and puts the Target ▾ in its line
       (`deformState`, `add`, `addGroup`, `removeTarget`); `WeightsPanel` fills Skin's and puts Bind ▾ in its line (`skinState`, `unskin`). The
       Warp and Weights sections, `toolOpened` and their summaries went; `fixDock` drops the two ids from a stored layout and `readLayout`
       their open flags (tested). Choices made while building it:
       - **Bind ▾ binds on choice**, as the bar's row ▾ and column ▾ choose on choice: the Bind button went. The verb `bind` is drawn as that
         picker (`inPick` in anim-props.ts' `VERBS`), and the line gives it the verb's enabled state and tooltip.
       - **The Target ▾ stands in for the summary**: a group (or an own warp beside a group) always brings the picker, which names the warp
         (`group head_warp (3 parts, 1 shape)`), so the line's summary is empty then rather than saying it twice; `Lattice 2×3`,
         `Mesh 212 vertices`, `No warp`, `No group warp` otherwise. The plan's `Group face, 4 parts` and `Bent by group face` are the picker's
         option instead.
       - **One adding verb**: a bone, or a part with two or more parts ticked, gets Add group warp; a part without a warp of its own Add warp
         (a group member too). The two used to show at once.
       - **Deform for a shape** shows while it is in a group, and with the Warp tool on also when it is in none (`In no group warp`, the body
         saying a shape has no warp of its own), so the tool on a lone shape is not met by nothing.
       - **The clip-group issue** shows in Deform's body for the chosen row and for the group edited (`.aw-clipissues`, its own row now, not
         inside Members); Clip's line has the ⚠ (`.as-sub-warn`), its tooltip the issue and "Properties › Deform has the fix". Clip's copy
         (`.am-groupnote`, `.am-fixgroup`) went.
       - **Edit topology** is an icon toggle in its own group first in the Warp bar for a mesh; the topology tool's hint is its tooltip while on.
       - **Choosing the tool in use again** (Add warp and Generate mesh call `useTool`) no longer counts as leaving it: it folded what the tool
         had opened (`subTool` in anim-studio.ts).
       - Skin opens by itself in Read weights too, so the studio redraws the sub-blocks when the brush changes (WeightsHost `changed`).
       - The focus header's pinned test made the column scroll with the Warp section; that state fits now, so the test shortens the window.

       Measured after it (as 4b was; 761 px under the header at 1440 x 900, 661 at 1280 x 800). Every state loses the two sections' folded
       35 px headers.

       | State | After 4b, px | After 4c, px | Largest block after |
       |---|---|---|---|
       | robo `breathe` alone | 373 | 304 | Parameter 235 |
       | robo torso, `breathe`, Move | 448 | 410 | Properties 205 (Transform 107, Deform and Clip lines) / Keyforms 136 |
       | robo torso, `breathe`, Warp | 783 | 497 | Keyforms 223 / Properties 205 (Deform folded: `Lattice 2×3`) |
       | robo head, `head_x`, Move | 630 | 592 | Keyforms 267 / Properties 256 (the bone view, `No group warp`) |
       | robo eyelids, Mask | 605 | 567 | Properties 417 (Clip open on the shape, 350) |
       | robo eyelids, `eye_open`, Mask | 686 | 648 | Properties 417 / Keyforms 162 |
       | mina hair_back, Weights | 886 | 386 | Properties 235 (Skin folded: `15 bones`) |
       | mina bangs, Warp (mesh) | 779 | 635 | Properties 485 (Deform open: `No warp`, the Mesh row) |

       None of the eight scrolls at 1440 x 900, nor at 1280 x 800, where eyelids / `eye_open` with the Mask tool comes closest (648 of 661).
       What the author opens still makes the column scroll: Skin on hair_back (its 15 bound bones), or Deform on a group member (a Members
       checkbox for every part of the character, then the Mesh and Lattice rows).
     - **4d, the Ctrl-click set**: `sharedField` and the set view; `.aw-groupbtn` (5) for a set moves to its Deform. New tests only otherwise.

       **Built 2026-11-09.** Rules in studio-inspector.ts: `sharedField(values)` (`{ mixed: false, value }`, or `{ mixed: true }` when they
       differ or there are none; compared by content, so two pivots `[3, 4]` are one), `setView(SetState)` (the count, `3 parts`, and the
       shared bone, pivot and clip), `PropBlocksState.set` and `PropBlocksView.set`; `focusHeader`'s `set` gives `setWord` (`3 parts`, its
       tooltip naming them). The studio's `setParts()` is the set; `setFields()` its view for the panels. Choices made while building it:
       - **A set is parts with art only.** The chosen part plus Ctrl-clicked rows makes a set when every row is a part with art; a bone or a
         mask shape among them makes none (Properties shows the first row, as before, and Deform's Add group warp from N selected parts still
         counts them all: the existing mouth + eyelids case). The header then says `2 chosen`, not `2 parts`.
       - **Deform shows only a group they all share** (any one, in the Target ▾ when there is), else `No group warp` with Add group warp from
         N selected parts. A part's own warp, the Mesh row and Add warp are that part's, so a set has none of them (`WarpPanel.part()` is null
         for a set, its candidates the groups with every part as a member).
       - **Clip to ▾** goes in the line once the set is clipped or mixed (blank: `selectedIndex` −1, its tooltip listing each part's clip), in
         the body while none is clipped; it lists no part of the set as a silhouette. New shape is one part's, so a set has no primary verb;
         Remove clip draws all of them whole. A set edits no shape (`MaskPanel.edited()` is null), so the stage shows no shape handles.
       - **Pivot**: blank when the pairs differ (the pair is one value; x alone is not shared); a pair typed, or a click with the Pivot tool,
         sets it on every part; Clear clears all of them; Same pivot… is off (typing it does that job). Fixed on the way: typing x into an empty
         row and moving to y wiped x (it waited for nothing); now the row waits for the second value, for one part too.
       - **On bone ▾** is blank when the bones differ; Choose <bone> shows only for a shared one. Variants and Skin do not show.
       - **The tree marks the added rows** with a dashed outline (`.as-extra`, their tooltip saying Ctrl-click takes them out), and Properties'
         section summary says `3 parts`. Going up from the header's `3 parts` word keeps the set.
       - **Deform's Members are the members only** (4c's note: a checkbox for every part of the character), each ticked, then **Add…**, a picker
         of the other parts and shapes; the long hint is the row's tooltip. On robo's head_warp the row is two lines and Add… in place of 14
         checkboxes over five; on a character with many parts it no longer grows with them.

       Measured after it (as 4c was; 761 px under the header at 1440 x 900, 661 at 1280 x 800):

       | State | After 4c, px | After 4d, px | Largest block after |
       |---|---|---|---|
       | robo `breathe` alone | 304 | 304 | Parameter 235 |
       | robo torso, `breathe`, Move | 410 | 410 | Properties 205 / Keyforms 136 |
       | robo torso, `breathe`, Warp | 497 | 497 | Keyforms 223 / Properties 205 |
       | robo head, `head_x`, Move | 592 | 592 | Keyforms 267 / Properties 256 |
       | robo eyelids, Mask | 567 | 567 | Properties 417 |
       | robo eyelids, `eye_open`, Mask | 648 | 648 | Properties 417 / Keyforms 162 |
       | mina hair_back, Weights | 386 | 386 | Properties 235 |
       | mina bangs, Warp (mesh) | 635 | 635 | Properties 485 |
       | robo face + eyes + antenna (a set), Move (new) | – | 355 | Properties 205 (Transform 107, Deform `No group warp`, Clip `Clip to ▾` blank) |
       | robo face, Warp, Deform opened (a group member, new) | – | 746 | Properties 596 (Deform 422: Members two lines, Mesh, Lattice) |

       None of the measured states scrolls at 1440 x 900 or 1280 x 800 except the last, which the author opens: Deform open on a group member
       is 746 px (fits 761, not 661), the Mesh row's hint and the Lattice row taking most of it. Step 5's rig strip takes Physics and Reactions
       (70 px folded) out of the column, which brings it to about 676.
   - **Expected** (the right dock's content at 1440 x 900, 761 px under the header; estimated from the parts' heights after 3b): `breathe` alone
     408 (unchanged); torso / `breathe` Move about 470 (Properties 210 → about 160: Transform 64, Deform and Clip lines); torso / `breathe` Warp
     about 480 (Deform folded on a lattice; Keyforms +72 for the warp's keys and Point row); head / `head_x` Move about 610; eyelids Mask about
     520 (Clip open on a shape); mina hair_back Weights about 400 (Skin and Deform folded); mina bangs Warp about 500 (Deform open: no warp).
     None scrolls at 1440 x 900; at 1280 x 800 (about 660 under the header) none does either, head / `head_x` being the closest.
   - **Where this differs from the plan above**, and why: Edit topology goes to the bar, not Deform (it changes what the bar holds; folded in
     Deform it would hide the way to the topology tools). The Mask Points row stays in Clip, not Keyform (the stage edits the rest outline, not a
     keyform). Transform never folds (two rows, no verbs of its own). New bone stays in the tree. Skin shows only for a mesh, or with the Weights
     tool on. The projections are lower than 550 and 620 because Skin and Deform fold where the plan counted them open.
5. **The rig strip.** **Built 2026-11-09.** Rules in `engine/src/studio-layout.ts`: `RIG_TABS`, `RIG_STRIP` (32 px folded, 240 open),
   `rigStrip(mode, state, without)` (shown in Model only, its tabs less the ones a host runs the studio without, the tab on show, the height),
   `rigTabClick` (a tab opens the strip on it, the open tab folds it), `rigStripOf` and `withRigStrip`; the state is kept in the studio layout
   as `rig` (`{ tab, open }`, absent when folded on Physics), beside the sections' open flags, and `readLayout` drops a bad one. `physics` and
   `reactions` left `STUDIO_SECTIONS.model` and the right zone's start, so `fixDock` drops them from a stored layout wherever they were
   (tested, with a stored layout that had moved one to the left column) and `readLayout` their open flags. The right column in Model is
   Keyforms, Parameter, Properties. The studio (`wireRig`, `showRig` in anim-studio.ts) puts the strip between the stage and Animate's
   transport; `PhysicsPanel` and `ReactionPanel` are unchanged, only their host element moved. Choices made while building it:
   - **The tabs are a tablist**: `role="tab"`, `aria-selected`, the selected tab the one in the Tab order. Left and right arrows, Home and End
     go along them; open, they switch the tab as they go, folded they only move the focus (Enter or Space opens). Esc is unchanged: the
     strip has no popovers, so Esc in it reverts a typed field, then steps the tool back, then closes, as from the columns.
   - **A chevron at the row's end** folds and opens the strip too (`aria-expanded`), so the fold is not only "click the open tab again".
   - **Each tab carries its count** (`Physics 6 chains`, `Reactions none`), the summaries the two sections had in their headers.
   - **Shake stops when the Physics tab is not on show** (folded, or Reactions chosen), as it stopped when the mode changed: its Stop button
     would be out of sight.
   - Animate shows no strip; the standalone page has both tabs (it runs without Place in scene only).

   Measured after it (the right dock's content as 4d was, 761 px under the header at 1440 x 900, 661 at 1280 x 800, layout cleared; the two
   folded sections were 35 px each and gave 70 everywhere, except 69 for `breathe` alone, where Parameter's border goes with them):

   | State | After 4d, px | After 5, px | Largest block after |
   |---|---|---|---|
   | robo `breathe` alone | 304 | 235 | Parameter 235 |
   | robo torso, `breathe`, Move | 410 | 341 | Properties 205 / Keyforms 136 |
   | robo torso, `breathe`, Warp | 497 | 427 | Keyforms 223 / Properties 205 |
   | robo head, `head_x`, Move | 592 | 523 | Keyforms 267 / Properties 256 |
   | robo eyelids, Mask | 567 | 498 | Properties 417 |
   | robo eyelids, `eye_open`, Mask | 648 | 579 | Properties 417 / Keyforms 162 |
   | mina hair_back, Weights | 386 | 316 | Properties 235 |
   | mina bangs, Warp (mesh) | 635 | 566 | Properties 485 |
   | robo face + eyes + antenna (a set), Move | 355 | 286 | Properties 205 |
   | robo face, Warp, Deform opened (a group member) | 746 | 677 | Properties 596 |

   The same numbers at 1280 x 800 (the column's content does not depend on the window's height). None scrolls at 1440 x 900; at 1280 x 800
   only Deform opened by the author on a group member does, by 16 px (677 of 661; 85 before).

   The stage box, mina in Model (the art is a 16:9 canvas in it):

   | Window | Before (no strip), px | Strip folded | Strip open |
   |---|---|---|---|
   | 1440 x 900 | 776 x 733 | 776 x 701, canvas 776 x 437 | 776 x 493, canvas 776 x 437 |
   | 1280 x 800 | 616 x 603 | 616 x 571, canvas 616 x 347 | 616 x 363, canvas 616 x 347 |

   The plan's 616 x 430 open at 1280 x 800 was counted before the tool options bar took its line; the box is 616 x 363, and the canvas still
   fits it whole (16 px of letterbox left), so opening the strip costs no art at either size. Folded, it costs 32 px of letterbox (733 is
   step 1's measurement; 603 is the folded box plus the strip, as the stage takes what the column leaves).

   **Physics' fields.** The tab still edits each chain as a JSON text area (mina's six chains are 2153 px of them; in the 208 px panel one chain's
   area shows at a time). Fields in their place are about one session, the size of 4c: a chain is inputs (parameter or bone ▾, channel ▾,
   weight, smoothing), segments (the simulation's per-segment numbers), outputs (parameter or part ▾, segment, scale, min, max) and an
   optional wind, so a row per input, segment and output with + and ✕; a pure `patchChain` / add and remove row in `physics-rig.ts` with
   tests, the panel (about 200 lines in place of the text area), a browser test, and the problems `checkPhysics` reports shown at their row.
   Laid out as three short tables across the strip's width, a chain would be about 150 px, so a few fit the open strip.
   *Done (2026-11-10):* `setChainRow`, `addChainRow`, `removeChainRow`, `setChainWind` and `problemRow` in `physics-rig.ts`; the panel
   keeps the focus on the edited field across its rebuild. At 1280 × 800 the strip is 625 px wide, so inputs and segments share a line and
   outputs take the next: mina's six chains are 1843 px (238 to 321 each), against 2153 for the text areas; a wider window fits all three
   tables on one line.

   **What is left of the second UX round** ([ux-test-2026-11-studio/summary.md](ux-test-2026-11-studio/summary.md)): Fix first items 1 to 5
   are done. Item 6, Animate mode: the At the playhead fields do not follow the playhead (SA-2); a single pose key slides back to rest by t=1
   and the studio never says why (SA-5, a decision: draw the implicit rest keys, or change the rule); keyed parameter lanes and the ruler sit
   under five empty lanes (SA-8); the transport row overflows at 1024 px and phone width (SA-7); in narrow layouts the wheel zooms the stage
   instead of scrolling the page (SA-6). Then the S3s (polish) of sa.md, sd.md and sr.md, and the decisions the summary still lists (seconds
   or fractions for key times, undo that shows what it changed, Apply's rig.json formatting).

## Decided (2026-11-09)

- **The bar goes over the stage**, not at the top of the inspector: it costs no art (the letterbox), and at the top of the inspector the brush mode
  would be 400 to 740 px from the brush, would vanish when the right column folds to its rail, and would move whenever a section is docked above it.
- **Physics and Reactions go in the strip under the stage**, not in the second left column: `left2` takes width, the one thing the stage lacks (at
  1280 x 800 the stage would go from 616 to 316 px wide and the canvas from 346 to 178 px high).
- **The action row is visible buttons**, not an Actions ▾ menu: with structural and destructive verbs in their sub-blocks it holds at most three, and a
  menu would hide Bind parts…, the second step of every rig.

## Alternatives considered

- *Keep the sections, auto-fold everything but the tool's and put it first.* Cheapest (step 0 did the folding), but the Warp and Weights sections stay
  1168 and 1221 px of mixed kinds and the verbs stay scattered.
- *Tabs in the right column (Properties | Tool | Rig).* Rejected for the reason studio-ux.md gave: keying a warp needs the keyform and the tool's
  selection at once.
- *Tool options at the top of the inspector.* See Decided.
- *A floating tool palette on the stage.* Covers art and needs placement rules; the bar costs no art.
- *Build the whole inspector table first (the first draft's step 1).* It fixes the design before any of it has been used; the rules now grow per step.

## Later: what a Cubism or Spine user will look for

From the review (section 4), not in the steps above: interpolate a key from its neighbours; a transform frame on selected lattice points (scale and
rotate on the stage instead of typing a factor and an angle); weight locks per bone (Smooth and Auto-weights leave a finished bone alone) and every
bone's weight for the selected vertices; a deformer hierarchy (which warp holds which part); a filter in the Parts tree; and the whole stage in Model
mode (robo shows at 40 % in a 435 px frame while 333 px of the stage box stay black), which is not the column's problem but the biggest single gain
for the stage.
