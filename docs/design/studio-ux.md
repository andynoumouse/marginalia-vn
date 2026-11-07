# Animation studio: workflows, modes and layout

Status: proposed 2026-11-07, implemented in the same change (see Migration). Not to be confused with
[studio.md](studio.md), which is Marginalia Studio, the desktop app. "The studio" here is the character studio the editor
opens over itself (`editor/anim-studio.ts`, stage in `preview/studio.ts`).

The studio grew one tab at a time: Key, Params, Frames, Physics, Parts, Character, Stage on the right, an animation list
on the left, an Animate | Rig toggle on top. Each piece was reasonable alone; together they make a cluttered screen
where the same thing is chosen in three places and nothing reads in the order an author works. This note goes through what
the author does, decides what must be on screen for each job, and proposes a structure that the coming Warp tab, keyform
editing and presets can join without a new tab each. The parameter model itself is in
[animation-studio-parameters.md](animation-studio-parameters.md).

## What the studio is today

| Area | Contents | Problem |
|---|---|---|
| Header | title, Animate / Rig toggle, a key hint, Undo, Redo, Apply, Try in scene, Close | The hint is one long line of text; the toggle puts the mode that comes second in the workflow first. |
| Left (Animate only) | New / Copy / Rename / Delete and a button for every animation and preset (18 buttons for the sample's robo) | The biggest block on screen holds what is chosen once per session. Hidden in Rig mode, so the stage jumps sideways when the mode changes. |
| Centre | stage; a tool row (4 tools, World axes, Auto-key, Key, Fit, the chosen name, 4 number fields); a transport row (Play, Loop, slider, time, Length, **Lanes of**); the timeline | The chosen part is set in "Lanes of", the Parts tab and by clicking the stage: three selectors for one thing. The tool row mixes stage tools, key commands and a form. |
| Right | seven tabs: Key, Params, Frames, Physics, Parts, Character, Stage | Tabs hide everything but one panel, so an author keys a parameter in Params, then has to switch to Key to see the key. Physics and Character are rig setup but share the strip with timing tools. The part tree, the most-used selector, is behind the 5th tab. |
| Rig mode | hides the list, transport, timeline and four tabs; the stage stands at rest with pivot crosses | Physics (a setup job) and parameter sliders are not available there, although they belong to the model. |

Counted at 1280 x 800: the animation list takes 200 px of width for a choice made once; the right column offers 7 tab
targets of which 1 is visible; the stage gets about 45 % of the window.

## Workflows

What each job needs on screen, in the order a character is made. "Needs" is what is shown while doing it; everything else
should be one click away at most, and closed by default.

| # | Job | How often | Needs |
|---|---|---|---|
| 1 | **Look at an animation** (from a script's `animate` line, or to check a preset) | most openings | animation picker, stage, play / scrub, loop. Nothing else. |
| 2 | **Pose and key a part** (nod the head, lift an arm): select a part, drag it with the gizmo, key it | main animating job | what is chosen (tree), stage with gizmo, the keys of that part on the timeline, exact values and the key's ease |
| 3 | **Animate with parameters** (head turn pad, mouth slider): move a control at the playhead, key it, see the lane | main animating job with a parameterised rig | parameter controls with key buttons, the parameter lanes of the timeline, the selected parameter key |
| 4 | **Time it**: move keys, change ease and length, play and loop | after 2 and 3 | timeline, transport, the selected key |
| 5 | **Frame by frame** (a walk cycle from slot variants) | some characters | frame rows on the timeline, the slot's frames |
| 6 | **Dress and place**: pick a look or variant to see the animation in; place the character as the script line does and copy the `show` line | now and then | look picker, variant chips, Place fields |
| 7 | **Set up the model**: bones, which part sits on which bone, pivots, looks | once per character, then rarely | the part/bone tree with editing, the chosen node's pivot and bone, stage at rest with pivot crosses, no timeline |
| 8 | **Author parameters** (today hand-written; planned: keyform editing and Warp): set a slider to a value, pose a part or move mesh points, store that as the keyform at that value | once per control | parameter controls, tree, stage with gizmo, and later a lattice; no timeline |
| 9 | **Set up secondary motion and behaviour**: physics chains, idle / talking / blink | once per character | the chain list with Shake, the stage posed by the parameters (so the hair can swing), the autonomous fields |
| 10 | **Save a pose** (a named set of parameter values for scripts) | now and then | the parameter controls and a name field |
| 11 | **Try it in the game**: Apply, close, play from the script line the studio was opened from | when opened from a script | header button |

Two observations drive the structure. Jobs 7 to 9 need no timeline and no animation, and jobs 1 to 6 need no pivots, bone
editing or physics. And every job starts with the same question, "what am I working on", which is a tree selection.

## Principles

1. **Left to right is workflow order.** What you work on (left), the stage where you see and manipulate it (centre), the
   properties and parameters of the selection (right); the timeline is under the stage because time is a property of the
   whole scene, not of one column.
2. **One place per thing.** A part is chosen in the tree (or by clicking the stage), nowhere else. The timeline follows the
   selection. A number is edited in one field.
3. **The stage is the largest thing on screen** and keeps its place across modes; modes change what is around it.
4. **Show what the current job needs.** Sections that a mode does not use are not there; sections that a mode uses are
   collapsed unless they are what that mode is mostly for. Counts and one-line summaries in collapsed headers say what is
   inside.
5. **Selection drives properties.** The tree is a plain list of rows; everything about the chosen row (bone, pivot,
   variants, key values) is one section on the right, not inline under every row.
6. **Everything works from the keyboard**, and the layout holds at a 1024 px window and at phone width.

## Modes

Two modes, as in Live2D Cubism: **Model** (what the character is, including what its parameters do) and **Animate** (what it does). They share the stage,
the tree, the parameter controls, the working copy, undo and Apply. They differ in what the controls write. The split is the one
Cubism makes: in Model a slider is *keyed to transforms* (the author picks the parameter, picks the parts it moves, and poses them at its keys;
the poses become that parameter's keyforms), in Animate *an animation moves the slider values* (a key says "this parameter is 0.7 at 0.4 s"). Neither mode writes the
other's data, and the panel says which it is doing: the Parameters section's **Active parameter** block in Model, the timeline's lanes in Animate.

**Parameter first.** Model's keyform authoring works in the order of Cubism: the parameter is picked first (a click on its row; nothing is guessed from the
control used last or from the chosen part), the parts it moves are picked from the preview or the Parts tree, and each pick binds the part and makes its keys.
Picking a part with *no* active parameter only selects it, and so does a Shift-click on the stage while one is active. A Ctrl-click (stage or tree row) *adds* the part to the chosen ones, or takes it off: the picks bind each added part, the stage dims all but the chosen set, and one gizmo drag writes the same delta into every chosen part's keyform at the key (`dragForms`, one undo step). An earlier part-first flow (choose a part, then
the control; a "keyed target" line and a Keyform row in the Parameters section) was built first and has been removed: it had to guess which control a drag meant.
For a while the parameter-first flow lived in a third mode, Keyforms, beside Model, so the old flow stayed available while the new one was tried; it was folded into Model once it had been.
Model keeps its other jobs: pivots, bones, looks, physics, "By itself", and the Warp and Mask tools.

| | **Model** | **Animate** |
|---|---|---|
| A parameter control | a palette: a click on its name makes it the *active parameter*; ticks mark the chosen part's keys (filled: posed, dim: at rest); its key button adds or removes a key of the chosen part at the value (a pad has none: its corners are the keys) | moves the value at the playhead, and its key button writes a key on the timeline |
| Picking a part (stage click, tree tick) | with an active parameter, **binds** the part to it and makes its keys at rest (slider: min, default, max; pad: a 2 × 2, 3 × 3 or 5 × 5 grid); a part bound already is only chosen. With none, or with Shift held, only chooses | chooses it |
| A gizmo drag (W, E, R) | writes the keyform of the **active** parameter at its value (the pad's grid corner nearest the dot, binding the part first if need be), one undo step; the pivot is the Pivot tool's (Q) | writes a key at the playhead (Auto-key), or previews until Key |
| Stage shows | the model at the parameter values (the defaults until a slider moves), pivot crosses and the skeleton | the animation at the playhead, with the parameters and the physics |
| Timeline, animation picker | none | yes |
| Writes to | `parameters`, `pads`, `keyforms`, `pivots`, `bones`, `parts`, `looks`, `physics`, `autonomous`, `poses`, `deformers`, `masks` | `animations` (and `poses`) |

**Names.** *Model*, not *Rig*: Cubism's word, no clash with the editor's "Edit rig", which opens the rig.json file, and
it says what the mode is about. Docs keep "rig.json" for the file.

**Order and default.** The switch reads **Model | Animate**, left to right in workflow order (a character is modelled, then it is animated). The Files panel's buttons are Model and Animate. The studio does not open in the first one: it opens in the
mode the entry point asks for (the Files panel's Model and Animate buttons, the character menu), and in Animate for every
entry that does not say (a script's `animate` line, the command palette), because most openings
are to look at or key an animation. Model is where a character is set up once, so it is the one a button asks for by name.
The mode is not remembered across page loads; the sections' open and closed state is.

**Alternatives considered.**

- *Keep Animate | Rig and fix only the list.* Leaves Physics and parameter work in Animate with no place in Rig, and gives
  the planned keyform and Warp editing no home, so the next job would be a new tab again.
- *Three modes (Model, Animate, Scene).* Placing a character in a scene is a few fields, needed only in Animate (the stage
  shows the scene there). A mode for it would be mostly empty. It stays a section.
- *A layout per workflow (posing, timing, rigging) or free docking.* (The part of this that is *movable sections in fixed columns* was taken up later; see the proposal under "Where the next panels go".) Posing and timing are the same screen (the gizmo and
  the timeline are used together), so two modes cover rigging and the rest. Dockable panels need a layout engine and a
  persistence model for little gain over collapsible sections in a fixed order.

## Layout

```
Animate
+---------------------------------------------------------------------------------------------------+
| robo •   [Model|Animate]                                        Undo Redo  Apply  Try in scene Close |
+--------------+----------------------------------------------+-------------------------------------+
| Animation    | [Move][Rotate][Scale] World  Fit      Auto-key Key | v Selection: head                    |
| [breathe v][⋯]|                                              |   At playhead  x y scale rot        |
| Look [dflt v]| +------------------------------------------+ |   Key  [t=0.5 v] t ease  Delete key |
| v Parts      | |                                          | |   Variants  (slots only)            |
|  whole char. | |                 stage                    | | > Parameters (6)                    |
|  > head      | |                                          | | > Frames                            |
|    face      | +------------------------------------------+ | > Place in scene                    |
|    bangs     | Play Loop |----o------------| 0.4 / 3.2 s Length |                                     |
|  arm_l       | x    ..........◆.......◆....                    |                                     |
|  ...         | rot  ..                                         |                                     |
|              | breathe ◆.......◆.......◆                       |                                     |
+--------------+----------------------------------------------+-------------------------------------+
| status line: the last message, or the keys: Space play · Ctrl+Z undo · Esc close                   |
+---------------------------------------------------------------------------------------------------+

Model
+---------------------------------------------------------------------------------------------------+
| robo •   [Model|Animate]                                        Undo Redo  Apply          Close   |
+--------------+----------------------------------------------+-------------------------------------+
| Look [dflt v]| [Pivot][Move][Rotate][Scale][Warp][Mask] Fit | v Parameters (6)                    |
| v Parts      |                                              |   Reset all  New parameter  New pad |
|  whole char. | +------------------------------------------+ |   Head   head_turn [pad]  ↺ ✎       |
|  [x] eyes    | |                                          | |   Arms ▌ arm_r_lift ──o── 0 ◆ ↺ ✎   |
|  [ ] mouth   | |                 stage                    | |          (the active row)           |
|  ...         | |   (at the parameter values; click a      | |   Active parameter: arm_r_lift      |
| Bones        | |    part: it is bound to the active       | |   Bound parts (2)  arm_r  pose  ✕   |
|  [ ] spine   | |    parameter, keys at rest; Shift-click  | |   Keys  [0] [1]  Add key here       |
|  [x] arm_r   | |    only selects)                         | |   Pose  x y sx sy rot opacity       |
|  [New bone]  | +------------------------------------------+ |   Moved by  [arm_r_lift]            |
|              |                                              | v Selection: head (bone)            |
|              |                                              |   Pivot x y  Pick on stage  Clear   |
|              |                                              | > Warp  > Mask  > Physics > By itself|
+--------------+----------------------------------------------+-------------------------------------+
```

### Left: what you are working on

- **Animation picker** (Animate only): a select with the character's animations and, under their own group, the presets,
  and a `⋯` menu with New, Copy (Edit copy for a preset), Rename and Delete. One line instead of an 18-button list.
- **Look**: a select of the looks (the dress the stage shows; not saved), in both modes, because the animation is checked
  in a look. In Model mode a name field and **Save as look** sit under it (the looks are rig data).
- **Parts**: the tree, one line per row (thumbnail, name, a mark for keyed in this animation, dimmed when the look hides it).
  Parts first as the PSD has them, then the bones indented under their parents. The row for the whole character is first.
  Rows hold no controls; bones fold. Dragging a bone row onto another still re-parents it, **New bone** is under the tree
  in Model mode.
- The Parts block folds on its own (closed by default at phone width).

### Centre: the stage and time

- **Tool row** (over the stage): the stage tools (Pivot, Move in Model; Move, Rotate, Scale in Animate), World axes, Fit;
  in Animate, at its right end, Auto-key and Key. It holds commands for the stage only; no form fields.
  The buttons are **icons**, not words (`editor/studio-icons.ts` holds the set, `editor/studio-toolrow.ts` the row): one 20 x 20 grid, a
  1.6 stroke, `currentColor`, so an icon takes the button's colour and the page's theme variables. In three groups with a hairline
  between them: the *transform tools* (Pivot, Move, Rotate, Scale), the *deform tools* (Warp, Mask; Model only) and the *view* (World
  axes, Fit), then the *keying* pair at the right (Animate only). A button is 30 px square (38 px on a touch screen) with the icon at
  18 px, so the whole row (8 buttons in Model) is about 280 px and stays on one line down to a 320 px window with no menu. Each
  button has an accessible name (`aria-label`, the tool's name), a tooltip that starts with the name and its key letter (`Rotate (E):
  shift snaps to 15 degrees`) and `aria-keyshortcuts`. The tool in use, World axes and Auto-key are toggles and report
  `aria-pressed`; pressed is drawn in the accent colour with a tinted background and a border. Key is a command, disabled until a
  drag is waiting. The keys and what each button does are unchanged; only the drawing is. Other panels use the same module
  (`icon()`, `iconButton()`) when they need an icon button.
- **Stage** takes all the remaining height. It does not move when the mode changes.
- **Transport** (Animate): Play, Loop, the scrub bar, the time and the animation's length. "Lanes of" is gone: the
  timeline shows the lanes of the chosen tree row.
- **Timeline** (Animate): channel lanes of the selection, parameter lanes, frame rows, as now. A click on a key opens the
  section that edits it.

### Right: properties of the selection, as collapsible sections

Every section is a header button (a chevron, the title, a count or summary) and a body. Several can be open at once; the
column scrolls. Which are open is remembered (in the browser, per mode). A section that does not apply to the mode is not
drawn. Defaults in bold.

| Section | Mode | Holds (from today's tab) |
|---|---|---|
| **Selection** | both | the chosen row's name and kind. Animate: the x, y, scale, rot at the playhead (was in the tool row; typing writes a key), the selected key (t, x, y, scale, rot, ease, Delete, Add key for a channel; was the Key tab), the variants of a slot. Model: the pivot (x, y, Pick on stage, Clear, Same pivot for), the bone of a part or the parent of a bone and Remove, the variants of a slot. |
| **Parameters** | all (open in Animate when the rig has parameters; open in Model always, so a rig can be started there; first in the column in Model) | sliders and pads in collapsible groups, a reset; a **+** in the header (Model) adds a parameter or a pad, and a ✕ on each row deletes it. Animate shows the key buttons (they write timeline keys), "Key changed" and the selected parameter key. Model shows the key buttons (they write keyforms), the **active parameter** highlighted, a mark on each slider's track at every key of the chosen part (filled where it is posed), the grid corners on a pad, a ✎ editor under each control, and under the list the **Bound parts** block (bound parts, keys, pose, moved by). |
| **Poses** | all (closed until opened; left column above Parameters) | the pose picker with Use pose and ✕ (delete), a name field with Save as pose, Reset all and, in Animate, Key changed; the summary counts the poses |
| Frames | Animate | the frame track of a slot (was the Frames tab) |
| Place in scene | Animate | x, y, scale, flip, anchor, the `show` line, Copy, Insert (was the Stage tab) |
| Warp | Model | the mesh warp of the chosen part: add / remove, lattice size, the parameter and its keys, point fields, reset, mirror, smooth, presets. Closed until the Warp tool is chosen. |
| Mask | Model | the clip of the chosen part: nothing / the shape of another part / a drawn shape, what a drawn shape follows, its points by number, add and remove a point, the problems of the mask. The stage outlines the mask of the chosen part. Closed until the Mask tool is chosen. |
| Physics | Model | the chains, presets, Shake (was the Physics tab) |
| By itself | Model | idle, talking, blink, and the mouth and blink fields (was the Character tab) |

The column is always at least a Selection section, so "what do I do with the thing I picked" has one answer. An empty
rig (no parameters, no frames) shows the section header with "none" and a line saying how to add one, as today's tabs do.

### Where the next panels go

- **Keyform editing, parameter first** (Model), built, in the order of Live2D Cubism: the parameter is picked first and decides, the parts follow. No section of
  its own: it is the Parameters section's second job, *binding*. All sliders and pads are in that one palette (viewed, created, renamed, re-ranged and deleted
  there, as in Model). A click on a name makes the row the **active parameter** (highlighted; nothing is guessed from the control used last or from the chosen part).
  Under the list a block holds, in the order of the work: the **Active parameter** and what it spans; the **Bound parts** list (each a button that chooses the
  part, with its kind (pose, warp or mask), how many keys it has and how many are posed, and a ✕ that unbinds it); **Bind** and, for a pad, the grid size (2 × 2, 3 × 3, 5 × 5);
  the **Keys** of the chosen part on a slider (click one to put the slider there; **Add key here** / **Remove this key**); the **Pose** fields stored at the slider's value;
  and **Moved by**, the reverse lookup (the parameters and pads that move the chosen part, each a button that makes that one active). **Picking** a part binds it and
  makes its keys at once, all at rest: a click on the stage (the tool says what it binds: a pose with Move, Rotate or Scale, a lattice with Warp, a drawn mask with Mask) or
  the **tick** on its row in the Parts tree (a checkbox beside the row: the row itself only chooses). **Posing** is the gizmo (W, E, R) or the Warp tool at a key, which
  writes into that key; a drag on a part that is not bound yet binds it first. Why a block under the list rather than a section of its own: it is the properties
  of the one active row, so it stays next to the list it belongs to; the list scrolls inside its own box (40 % of the window height) so the block stays in view. Why a tick in
  the tree and not a button per row: the tree is a flat list of rows with nothing else on them, and binding is a property of a row, as the bone fold arrow is. The Warp section
  has no slider and no parameter choice of its own here: its keys are the active parameter's, so every slider is in the one palette.
  See [animation-studio-parameters.md](animation-studio-parameters.md), Model mode, as built.
- **Parameters and pads** (Model), built: **New parameter**, **New pad** and a ✎ fold-out under each control (name, group, min, max, default, ease;
  a pad's two parameters), so a rig can be authored without editing JSON.
- **Warp** (Model), built: a tool beside Pivot and Move (the lattice overlay and point drag on the stage, key **D**) and a Warp
  section of its own after Selection, closed until the tool is chosen (grid size, parameter and keys, point fields, mirror,
  smooth, presets; see [mesh-warp.md](mesh-warp.md)). A section rather than a block inside Selection, because Selection in
  Model mode already carries the pivot and bone controls, and the warp has as many controls again. Mesh points are keyform
  targets exactly like a bone's transform.
- **Masks** (built): the same pattern as Warp, a tool beside it (**M**, the points of a drawn shape as handles on the stage) and a Mask section of its own after Warp, closed
  until the tool is chosen; the chosen part's mask is outlined on the stage in Model mode whichever tool is on. A section rather than a block in Selection, for the
  reason Warp's is one (see [animation-studio-parameters.md](animation-studio-parameters.md), Masks, as built).
- **Presets**: a preset picker in the section header it belongs to (physics presets in Physics, pose presets in Parameters).
- **Curve editor**: a Dope sheet | Curves switch on the transport row.

None of these needs a tab or a mode.

### Proposal: the parameter palette on the left (2026-11-07, not built)

**Why.** Model authoring is parameter first, as in Cubism, and Cubism keeps the Parameters palette on the left beside the part list, with the
properties of the selection elsewhere. Here the palette sits in the right column's Parameters section, above Selection, Warp, Mask and
Physics, so the one control that decides what a click on the stage means shares a scrolling column with unrelated forms. In the sample (robo,
1297 x 1214) the palette is 529 px of the 339 px column, the tree is 705 px of the 199 px one, and the stage 713 px.

**Workflows, by what must be on screen at once** (the studio's own jobs 3, 8 and 10, split by what the hand is doing):

| Step | Needs in view together |
|---|---|
| A. Create and set up a slider (name, group, range, default, ease) | the palette and its editor; nothing else |
| B. Choose which parts a slider moves (bind) | **the palette** (the active row says what a pick binds), **the part list** (ticks: bound or not, the whole bone subtree later), the stage (click to pick, Ctrl-click to add) |
| C. Pose at the keys | the palette (the slider, the key marks), the stage with the gizmo, **the chosen part's keys and pose fields** (Bound block: Keys, Pose) |
| D. Check the result (scrub a slider, look at the model) | the palette and the stage; the part list only to see what moves |
| E. Pose several parts together (Ctrl-click) | the part list or the stage, the palette, the stage |
| F. Pads: two sliders as one 2D control | the palette (the pad), the stage; the corner grid is the keys |
| G. Animate: move a slider at the playhead and key it | the palette, the stage, the timeline; the chosen part's own lanes |
| H. Save a pose | the Poses section (picker, name field) |

B and E are the reason **the part list and the palette must be on screen together**; a tab that swaps one for the other would make binding
a back and forth between two views for every part. C needs the stage, the palette and the keys block at once, which is the current
arrangement; D and G do not need the part list, so it may shrink then.

**Proposal.**

1. **Left column, both modes, top to bottom:** Look (and, in Animate, the animation picker above it); **Parameters**, the palette; **Parts**, the tree
   with its ticks. The two blocks share the column's height and have a draggable divider (stored in the layout); each scrolls inside its own box,
   so neither pushes the other off screen. The palette takes the height of its content up to half the column, then scrolls. Default width
   about 300 px (the sample's 6 parameters and 1 pad take about 300 px of height today; one-line rows will make that less), a drag handle on the column's right edge, stored. The
   right column loses about 40 px of width it did not need.
2. **A palette row** is one line: group fold, name, slider, number; the key button (◆, Animate and Model), reset (↺) and the editor (✎)
   show on the row that is active, hovered or focused, not on all rows at once. A pad keeps its square (about 110 px) with the two
   readouts beside it, not under it. Rows group as now; New parameter and New pad are in the **+** menu of the section header, and poses (picker, Save as pose, Reset all) are their own **Poses** section; the only bar left on top of the block is the filter.
   A filter field appears when there are more than 12 parameters (Cubism rigs have hundreds).
3. **Right column, Model:** a **Keyforms** section first, open, holding what is the properties of the active parameter and the chosen part:
   Bound parts (kind, keys, posed, unbind), Keys, Pose, Moved by. Then Selection, Warp, Mask, Physics, By itself as now. The block moves because it is
   the properties of a pair (the active row and the chosen row), not part of the palette; the palette stays a clean control surface. The tree's ticks already
   show which parts are bound, so the list in Keyforms is for unbinding and for the warp and mask kinds, and stays compact (one line per part).
4. **Right column, Animate:** unchanged, minus Parameters (its key buttons are on the palette rows and its selected parameter key goes under
   Selection, next to the channel key).
5. **Narrow windows:** unchanged order, the palette block before the Parts block, both closed.

**Alternatives considered.**

- *Tabs in the left column (Parts | Parameters).* Rejected for steps B and E above.
- *A fourth column, or a floating palette.* Costs 200 to 300 px of stage on a 1280 px window, or needs a window manager (see "A layout per workflow" above).
- *Palette on the left, the tree moved to the right column.* The tree answers "what am I working on", which is the left column's job (principle 1), and the
  part list is used with the palette in steps B and E, so splitting them across the stage costs eye travel. Rejected.
- *The Bound list inside the palette block (as built).* Kept as a fallback if the right column feels thin; the cost is the left column's height.

**Open questions for the author.**

- Decided 2026-11-07: the palette is on the left in **Animate** too (one place for a thing).
- Decided 2026-11-07: Keys and Pose go in a **Keyforms** section on the right (option A), not under the palette; movable sections make it cheap to move if that feels wrong.
- Decided 2026-11-07: the left column is about 300 px by default, with a drag handle (the stage drops to about 640 px at 1280 px width).

**Steps** (each keeps `npm test` green; browser tests that assert the DOM position of the palette are updated, not loosened):
1. **Built (2026-11-07):** the palette is in the left column in both modes, above the Parts tree; a grip between them (the share of the height the palette may take, default 0.5) and one on the column's right edge (width, 220 to 520 px, default 300) resize them, with the arrow keys too; the sizes are kept in `vn.editor.studioLayout` (`size`, `engine/src/studio-layout.ts`). The Bind block moved to a **Keyforms** section, first in the right column in Model (the DOM half of step 3), and the Animate parameter-key fields moved into Selection. The palette code (`editor/anim-params.ts`) is unchanged, so its rows are still the two-line ones of step 2.
2. **Built (2026-11-07):** the one-line row (a 68 px name, the slider with its key marks, a 52 px number and the ◆); in Model the reset and edit buttons show only on the active row, the row with focus, or the one whose editor is open (not on hover: a button that appears under the pointer moves the slider under it). A filter field appears above 12 parameters. The pad keeps its 112 px square with the readout beside it (it already was); its second line of axis buttons stays.
3. The Keyforms section (the Bound block, `editor/anim-bind.ts`, moves to the right) and the layout rules in `engine/src/studio-layout.ts`.
4. Animate: the same, and the selected parameter key under Selection.
5. **Movable sections** (the user's workspace; see below). Built after the defaults above, so the first layout is one worth keeping.

**A layout the user can change (proposed 2026-11-07).** The free docking rejected under "Alternatives considered" is still out (floating windows,
tab groups, splits inside the stage area need a layout engine). A narrower form is in: every block is a *section* with a header (Look, Parameters,
Parts, Keyforms, Selection, Warp, Mask, Physics, Frames, Place in scene, By itself), and the **columns are fixed** (left, right, and a bottom strip under the stage for the
timeline). The author drags a section header into any column, or to another place in the same column; column widths and the divider between two stacked sections are
dragged too. A section menu (and Alt+Up / Down / Left / Right on a focused header) does the same without a pointer. **Reset layout** sits in the header's menu.

- *Data.* A layout is `{ left: string[]; right: string[]; widths: { left: number; right: number }; split: { left: number } }` per mode (section ids in order; the divider
  as a fraction), stored in `vn.editor.studioLayout` beside the open / closed state, and read and repaired by pure functions in `engine/src/studio-layout.ts`:
  an unknown id is dropped, a section the stored layout does not mention is put where the default layout has it (so a section added later appears), a section the
  mode does not use stays out, and a layout with nothing in a column leaves the stage wider.
- *Sections must not assume a width.* The same section may land in a 260 px or a 420 px column, so rows wrap or shrink by container width (`container-type: inline-size`),
  not by window breakpoints. The one-line palette row is the first of these; the pad, the key buttons and the Bound list follow.
- *Not stored:* narrow windows (900 px and below) keep the stacked accordion in reading order and ignore the stored layout.
- *Why it is worth it despite the cost:* the defaults become a data table, so trying the palette on the left (this proposal) and going back is a one-line change, and users with
  other workflows (a second monitor's worth of space, a tall window) can arrange the studio instead of asking for another mode.

### Narrow windows

At 900 px and below the columns stack in reading order: header (wrapping), picker, stage (36 vh), tool row, transport
and timeline, the Parts block (closed), then the right column's sections as an accordion. The workspace scrolls
vertically, as it does today, but what is above the fold is the picker, the stage and the timeline.

## State

- Mode: the entry point's, default Animate; not stored.
- Selection, playhead, hand-set parameter values, Look: this opening only.
- Open and closed sections, the Parts block included: stored in `localStorage` under `vn.editor.studioLayout` (guarded; the studio works without it). The rules (modes, sections, defaults, reading a stored layout) are pure functions in `engine/src/studio-layout.ts`.
- Working copy, undo, Apply: unchanged.

## Migration

Done in one change, in steps that each keep `npm test` green (as built; the Model-mode preview needed one stage-page change: `studioPose` takes a null animation name and poses the character from its parameters, keyforms and physics alone):

1. This document.
2. Rename the mode `rig` to `model` (type, entry points, sidebar button and menu, tests) and reorder the switch.
3. Three-column frame: header with the switch, left column (picker and tree), centre (tool row, stage, transport,
   timeline), right column of sections replacing the tabs; the status line takes the key hint.
4. The tree's per-row controls move to the Selection section; `Lanes of` goes; the number fields leave the tool row.
5. Model mode gets Parameters and Physics (the stage page poses the model at the parameter values and steps the chains
   in rest mode too), Animate keeps Frames and Place.
6. Narrow layout, stored section state, tests (browser tests updated for the new structure: mode switch order, the
   picker, sections instead of tabs, the tree's selection details), docs (`rig-json.md`, `art-pipeline.md`, README if it
   names the toggle), TODO.

Tests that asserted tab order or tab visibility are rewritten for sections, deliberately: what they protect (a control
exists in the mode that needs it, focus starts inside, the studio fits 1280 x 720 without scrolling, keyboard reaches
everything) stays.

## Open questions

- Whether Looks deserve their own section once there are more than a handful (the select scales; chips did not).
- Whether the timeline should become collapsible to its transport row, for a stage-only review of an animation.
- Model now opens on the Move tool, not Pivot (decided with the fold of Keyforms into Model): with Pivot on, a click on the stage moves the chosen part's pivot, which would
  fight picking parts to bind. The Pivot tool (Q, or Pick on stage) is one click away; whether setting a rig up deserves a first-run nudge toward pivots is open.
- Whether a stage click should bind at once, as built (the tool says what a pick binds; Shift-click, the ✕ and Ctrl+Z are the way back), or whether picking and binding should be
  separate, with a Bind button or a toggle instead of a modifier key.
- Keyform authoring's undo granularity is decided: one gizmo drag is one keyform written and one undo step; a field edit, a key / unkey and a
  parameter edit are one step each.
