# Review: the right column restructure (studio-inspector.md)

Status: review of [studio-inspector.md](studio-inspector.md), 2026-11-09, by a reader who did not write it. Measured on the dev server with robo and
mina in Model mode, at 1440 x 900, 1280 x 800 and 1024 x 768, by a script that chose parts, parameters and tools and read the boxes (nothing applied).

## What I measured

| Window | Right column | Stage box | 16:9 canvas inside it | Tool row used |
|---|---|---|---|---|
| 1440 x 900 | 340 x 824 | 776 x 770 | 774 x 435 (**333 px of letterbox**) | 320 of 800 px |
| 1280 x 800 | 340 x 724 | 616 x 670 | 616 x 346 (324 px) | 320 of 640 px |
| 1024 x 768 | 300 x 675 | 400 x 621 | 400 x 225 (396 px) | 320 of 424 px |

| State (1440 x 900) | Column content | Largest block |
|---|---|---|
| robo torso, breathe, Move | 1021 | Keyforms 619 |
| robo torso, breathe, Warp | 1986 | Warp 1168 (35 controls) |
| robo head, head_x, Move | 1248 | Keyforms 745 (28 controls) |
| robo eyelids, Mask | 1066 | Mask 392 |
| mina hair_back, Weights | 1819 | **Weights 1221 (57 controls)** |
| mina bangs, Warp (mesh) | 1141 | Warp 525 |

## 1. The problem, and where I read it differently

The diagnosis holds: tool controls below the fold, four kinds in one stack, the Warp section as six panels. Four things it understates or misses:

- **Nothing has a place.** The Properties header sits anywhere from y=186 to y=792 across the six states, Moved by and Bind to parameter… from 208 to 692.
  A fixed order of blocks does not fix this while the top block's height changes with the focus kind.
- **Most of Keyforms is repetition, not the keyform.** In the head/head_x keyform (745 px), Keys and Pose are 264 px. The Active parameter block, its hint
  and Bound parts take 248, Copy keys 99, Moved by 100. The column names head six times and head_x four. The plan keeps most of this and drops Moved by
  without saying where the part-to-keyform route goes.
- **Weights is the biggest section, not the smallest.** The plan measured it on robo, which has no mesh (85 px). On a skinned mesh it is 1221 px, and the
  brush row is at y=850, below the fold at 1280 x 800.
- **The status line is part of it.** With a part on a bone chosen, the hint wraps to two lines at 1440 and 1280, and the stage box shrinks by 17 px each
  time that happens. It still says "Pick a parameter, press Bind parts…" while one is picked.

Most important for the open questions: **stage height is not scarce.** The stage is limited by its width. At every size measured, the art sits in a
16:9 canvas with 324 to 396 px of black above and below it.

## 2. The model

**Tool options bar: yes, with four changes.**
1. **Constant height, never empty.** If the line came and went with the tool, the stage box would change height and the centred canvas would jump about
   19 px on every W/D switch. For Move, Rotate and Scale it shows what the gizmo writes to and whether a drag will write: `poses spine, the bone torso
   sits on · spine is not bound to breathe: D keys torso's warp`. That is the line over the stage that rig-json.md promises (SR-1), and the mode badge
   the stage-modes note left open. Its first item names the mode (`Weights · Add on hair_1_0`), so the status line loses that clause, stays one line
   (ellipsis) and never moves the stage. Where the bar does not fit on one line (at 1024 x 768 the row is 424 px wide), it wraps to two. That still
   costs no art: two bar lines leave a 545 px box for a 225 px canvas.
2. **Fix the per-tool table.**
   - Warp: add the topology tools while Edit topology is on. Scale and Rotate are icons that apply the last value, with the value in their ▾.
   - Weights: add the test pose (as the plan's notes say) and, in Select mode, All / None / Invert, Set value ▾ and Mirror. That is the plan's own Warp
     rule ("operations on the stage selection") applied the same way. Take **Auto-weights** out: it is in both the bar and Skin. It rewrites the
     skin, so it belongs in Skin.
   - Mask: take **New shape** out: it is in both the bar and the action row. It acts on a part, so it belongs in Clip.
   - Pivot: drop Pick on stage, since the tool is the pick.
   - The Weights active bone is chosen in one place, the bar's ▾. The Skin list highlights it and binds or unbinds.
3. **Icons with tooltips** for every button, and ▾ pickers for row, column, bone and preset. Add `[` and `]` for brush radius (Shift for strength), as
   paint programs do.
4. **Focus and Esc (SD-2, SD-3).** Fix 1 already hands Esc from anywhere in the dialog to the stage while a deform tool is on, so a bar button no longer
   closes the studio. Three gaps remain:
   - Every bar popover, and the Pivot bar's Same pivot list, must take its own Esc first, as the Bind picker does. The order is: popover, typed field,
     stage selection, Move, close.
   - The Esc that goes back to Move removes the focused bar button, and the focus keeper has no replacement for it, so focus falls to `<body>` (SD-3 again).
     Rule: focus falls to the pressed tool button.
   - A browser test should press Esc on the first button of each bar.

**The inspector: pin the header, make the crumb do the navigating.**
1. **Pin the focus header above the dock zone**, not inside the Keyforms section. It is a fixed ~64 px (the crumb line, then one line of verbs), and the rest
   scrolls under it. A docked or reordered section cannot move it.
2. **The crumb's words are compact pickers:** `torso ▾ › breathe ▾ @ 0 · key`.
   - The part word lists the other parts bound to the parameter. That is today's Bound parts in keyform focus.
   - The parameter word lists what moves the part. That is today's Moved by, which the plan drops.
   - Together they replace about 200 px with one line, and keep the one-focus navigation where the focus is named.
3. **Drop the Active parameter block.** In parameter focus, the Parameter block is the parameter's properties. Move the palette's ✎ editor there; otherwise
   block 4 duplicates it (range, default, ease). The palette goes back to being a control surface.
4. **Keyform block:**
   - the key strip (‹ -1 0 1 ›, Add or Remove key), then the values for the binding kind, then the ease;
   - the pose in two rows of three (x y rot / sx sy opacity);
   - **Copy form, Paste form (mirrored) and Reset**: per-key operations a Cubism user reaches for constantly.
5. **Properties sub-blocks:**
   - The tool's sub-block opens only when it has a next step (no warp: Add warp, Generate mesh; no skin: Bind bones). Otherwise it stays one summary line,
     and the column is never scrolled for the user.
   - Each folded line carries its primary verb (`No warp · Add warp`) and its destructive one (Remove warp, Remove skin, Delete shape), so neither is
     in the action row.
6. **Say what a Ctrl-click set and a bone focus show.** A set: "3 parts", the shared fields, and mixed values left blank. A bone: Rename, Parent, Remove
   bone, New bone (today these are in the tree's detail). The plan says nothing about either.

Projected: robo torso with Warp is about 550 px (1986 today), and mina hair_back with Weights about 620 (1819 today). Both fit 724 px, so neither scrolls
at 1280 x 800.

**Steps.** Do not build the whole table first (step 1): that fixes the design before it has been used. Instead, grow `studio-inspector.ts` with each step,
still pure and tested. Order the steps by pixels removed per unit of risk, update the docs and tooltips in each step (today's tooltips still say "the Warp
section"), and re-run the same measured states at the end of every step:

1. The bar line, with Weights' brush, test pose and selection ops (−756 px on a skinned mesh), and the Esc and focus rules.
2. Warp's selection, operations and presets into the bar (−584 px).
3. The pinned header with crumb pickers. Active parameter goes, and Copy keys becomes a verb (Keyforms 745 → about 230).
4. The Properties sub-blocks; the three sections go.
5. The rig strip.

## 3. The open questions

- **Bar over the stage.** It costs 0 px of art at every measured size, because 333 / 324 / 396 px of the stage box are letterbox. Tool options at the top
  of the inspector would:
  - put the brush mode 400 to 740 px from the brush;
  - vanish when the right column is folded to its rail;
  - move whenever a section is docked above them.
  If Model mode later drops the 16:9 frame (see 4), the bar costs 38 px of a 770 px stage, which is still worth paying.
- **Physics and Reactions: bottom strip.** left2 takes width, the one thing the stage lacks: at 1280 x 800 it would narrow the stage from 616 to 316 px, and
  the canvas from 346 to 178 px high. A 240 px strip leaves a 616 x 430 box for a 616 x 346 canvas: no loss.
  - Use tabs in the strip (Physics | Reactions). The two are never needed together, which is the test studio-ux.md set for tabs.
  - Fold it to its tab row by default, and keep Poses with the palette.
  - Replacing Physics' six JSON textareas (2153 px) matters more than where they sit; no placement holds them.
- **Action row: visible buttons.** With structural and destructive verbs in their sub-blocks, the row holds only the verbs that join the focus to something
  else:
  - a parameter: Bind parts…;
  - a part: Bind to parameter…, Copy keys from…;
  - a keyform: Copy form, Paste form.

  That is at most three, one line at 340 px. An Actions ▾ menu would hide Bind parts…, which is step 2 of every rig. Add a ⋯ at the end of the line only
  if a fourth verb appears. Keep the inline Bind picker the testers praised, opening under the row, rather than rebuilding it as a popover.

## 4. What a Cubism or Spine user will look for

- **Cubism's Tool Details palette** is the bar's precedent; name it that way in the docs and F1.
- **Copy and paste a form between keys, mirrored, and interpolate a key from its neighbours.** Today only Copy keys exists, from part to part.
- **A transform frame on selected lattice points**, to scale and rotate on the stage, rather than typing a factor and an angle.
- **Weight locks per bone** (Spine), so Smooth and Auto-weights leave a finished bone alone, and a readout of every bone's weight for the selected
  vertices.
- **A deformer hierarchy** (Cubism's Deformer palette) that shows which warp holds which part. The Deform sub-block shows one warp at a time.
- **A filter in the Parts tree** (the palette has one above 12 parameters). Cubism models have a hundred art meshes and more.
- **The whole stage in Model mode.** Robo shows at 40 % in a 435 px frame while 333 px of the stage box stay black, whereas Cubism's canvas fills its view.
  This is not the column's problem, but it is the biggest single gain for the stage.
