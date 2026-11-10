# rig.json reference

`assets/char/<name>/rig.json` is a hand-written addition to a layered character. The PSD converter writes
`sprite.json` next to it and never touches `rig.json`; the game reads both when it starts. Every key is optional.
In the editor open it from the Files panel (Characters) or Ctrl+P then `#`: a character without a file starts from
a generated skeleton that stays unsaved until you save. The tab completes part, slot and variant names, marks
mistakes as warnings, and **Character: Update Rig from Reconverted Art** (Ctrl+P, then `>`) adds new parts to `order`, and bones (with the new parts on them) for new PSD `+folders`; bones and parts you already have are left alone.

A flat character (one image per pose, no PSD) can have a `rig.json` too, without a `sprite.json`: only `animations`,
`animations` (automatic ones included) apply, and keys move the whole body (no `part`). Characters with a rig.json appear in
Characters and open in the animation studio.

```json
{
  "order": ["bottom", "top"],
  "bones": { "head": { "pivot": [270, 380] } },
  "parts": { "face": { "bone": "head" }, "bangs": { "bone": "head" }, "eyes": { "bone": "head" }, "mouth": { "bone": "head" } },
  "looks": {
    "shy": { "look": "smile", "mouth": "neutral" },
    "uniform": { "top": "school", "bottom": "school" },
    "casual": { "look": "happy", "top": "casual", "bottom": "casual" }
  }
}
```

In a script a `show` takes looks and `slot=variant` overrides: `show mina shy`, `show mina uniform`,
`show mina shy casual`, `show mina casual mouth=open`. A *part* is a slot (a PSD group of variants) or a plain layer, named by its file
name without `.png`. `sprite.json` lists the parts bottom to top.

## order

Part names, bottom to top. The listed parts swap among the positions they already hold in the PSD; parts you leave
out stay where they were. Use it to change what draws over what without touching the PSD, for example hanging a
shirt over a skirt (`["bottom", "top"]` when the PSD has `top` below `bottom`).

## bones

Moving parts as a tree: a child follows its parent, which replaced the old flat `groups`. An animation key
or `animate <char> <anim> part=<name>` may name a bone, which moves it and everything below it; naming a part moves just
that part, on top of its bone. A part turns about its own `pivot`, else its bone's.

```json
{
  "bones": {
    "root": { "pivot": [270, 700] },
    "torso": { "parent": "root", "pivot": [270, 640] },
    "neck": { "parent": "torso", "pivot": [270, 380] },
    "head": { "parent": "neck" }
  },
  "parts": { "face": { "bone": "head" }, "hair_back": { "bone": "neck", "pivot": [270, 380] } }
}
```

A bone has an optional `parent` (another bone; without one it hangs from the character) and an optional `pivot`,
`[x, y]` in pixels of the PSD canvas. A bone with no pivot uses its parent's; a root with none uses the middle of the
parts on it and below it, and the bottom middle of the canvas when it has none. A bone may have no image at all.

A bone may also have a `tip`, `[x, y]` like `pivot`, where it ends (a hand bone whose fingers are not bones). It moves nothing:
only auto-weights for [skinned meshes](#skinning) read it, to know how far a bone with no child reaches. `checkRig` rejects a bad tip.

A bone's world transform is its parent's, then its own offset about its own pivot, so only offsets add up down the tree
(`composeBones` in `engine/src/bones.ts`). `checkRig` rejects unknown parents, loops and bad pivots, and warns about a
bone with nothing on it and nothing below it, about a bone with nothing to turn about, and about a bone named like a part.

## parts

Which bone each part (a slot or plain layer) sits on: `{ "bone": "head" }`. A part may also give a `pivot` of its own,
for one that must turn about another point than its bone's. A part without an entry sits directly on the character.
`checkRig` rejects entries naming no part and bones that do not exist.

## looks

A look is a named map from slots to variants, used as `show <char> <name>`. It may cover every slot or only some:
`"uniform": { "top": "school", "bottom": "school" }` dresses, `"shy": { "mouth": "neutral" }` changes a face, and a
look with a whole set of slots is a pose. A variant of `none` hides the slot (`"naked": { "top": "none", "bottom": "none" }`).
A slot shows exactly one variant, so layered clothing means a second slot.

One key is reserved: `look` names another look that is applied first, then the other keys of this look
(`"shy": { "look": "smile", "mouth": "neutral" }`). A look that refers back to itself, directly or through others, is
an error. Every other key is a slot name; unknown slots and variants are reported.

A bare word on a `show` line is resolved in this order:

1. a `looks` entry of that name;
2. an **implicit look** from the art: the map over every slot that has a variant with that name, or a variant tagged
   with it in the PSD (`eyes/smile, happy` is also called `happy`). `show mina happy` picks `happy` in every slot that
   has one;
3. otherwise the line is reported as an unknown layer name.

A `looks` entry wins over an implicit look of the same name (`checkRig` points out the clash).

Several bare words apply left to right, and the last one wins per slot: `show mina shy casual` first shy, then
casual. A `slot=variant` on the line wins over every look: `show mina casual mouth=open`. Nothing is kept of the
looks themselves: they are expanded into the slot variants when the line runs, so a later `show` without a look
keeps what is on stage, and a `show` with a look starts again from the defaults. Taking one outfit off while keeping
the rest is not supported yet; write a look that sets those slots.

`poses`, which this replaced, is reported by `checkRig`: rename it to `looks` and its `"pose"` key to `"look"`. So is `groups`: give the members one bone (`parts.<name>.bone`) and key the bone instead.

## pivots

Where a part turns and scales from when an animation moves it by itself, in pixels of the PSD canvas, `[x, y]` from
the top left (the same numbers as a layer's position in `sprite.json`). A part is a slot or a plain layer. A bone takes its pivot
in `bones`; a part on a bone turns about that bone's pivot unless it has one here or in `parts`.

```json
"pivots": { "hair_back": [270, 380], "face": [270, 380] }
```

A part's pivot is the first of these that exists: its entry in `pivots`, its `pivot` in `parts`, its bone's pivot (see
`bones` for the fallback up the tree), the middle of its own image. `pivots` is the older, flat way to give a part its
own point, and it is still read and written by the studio; `parts.<name>.pivot` says the same next to the part's bone, so
prefer it in new rigs. The character as a whole (`show` and `animate` with no `part`) turns and scales about its feet,
the bottom middle of the canvas; no pivot changes that. Parts move in two ways: a keyframe with a `part` (see
`animations` below), or `animate <char> <name> part=<part>`, which plays any animation, presets included, on that
part instead of on the whole character. To move several parts together (a head is the face, bangs, eyes and mouth), put them
on a bone (see `bones`) and give the bone a pivot at the neck.

## auto

An animation of `animations` can start by itself: blinking, talking, breathing and fidgeting are all animations with an
`auto` key. Everything a clip can do (frame tracks, parameter tracks, bone and part keys) is available to them. Presets
cannot be automatic (they have no definition to hold `auto`): copy one into `animations` first (the studio's "Copy preset").

```json
"animations": {
  "blink":   { "dur": 0.12, "keys": [], "frames": [{ "slot": "eyes", "keys": [{ "t": 0, "frame": "closed" }] }],
               "auto": { "every": { "min": 3, "max": 6 } } },
  "talk":    { "dur": 0.286, "keys": [], "frames": [{ "slot": "mouth", "frames": ["open", "flat"], "fps": 7, "loop": true }],
               "auto": { "while": "speaking" } },
  "breathe": { "dur": 3.5, "keys": [ { "t": 0.5, "scale": 0.012, "ease": "inout" }, { "t": 1, "scale": 0 } ],
               "auto": { "while": "always" } }
}
```

- `every`: a wait in seconds after each run, either `{ "min": 3, "max": 6 }` (a random wait between them) or a plain number
  (a fixed wait). The animation plays once, waits, and plays again; the wait counts from the end of a run, so a long
  animation has a longer period than its `every`. The first wait is random too, so characters do not blink in step.
- `while`: a condition. The animation loops for as long as it holds. With `every` as well, the timer only runs while the
  condition holds (`{ "every": { "min": 4, "max": 9 }, "while": "affection > 3" }`: a fidget now and then, only when fond).
- At least one of the two is needed; `checkRig` reports both missing, a bad `every`, an expression that does not parse,
  a name that is no `param.<id>` of the rig, and unknown fields. With the project's variables known it also reports a
  name that is no script variable.

A condition is written in the script's own expression language (the one `if` uses). It sees the story's variables by name
(`affection >= 5 and not angry`), plus three built-ins:

- `speaking`: true while one of this character's lines is typing (false when the line is complete or skipped). On a voiced line
  (a recording in `assets/voice/`) it follows the recording instead: true while the voice is loud, with a short hold over the
  gaps between words, so the mouth moves with the voice, not the typing, and stops when the recording does;
- `always`: true;
- `param.<id>`: a rig parameter's base value, the one the script or the player set, before any animation's tracks or a
  reaction's pose, so a clip that writes a parameter cannot switch itself off and on.

Conditions are evaluated every step against the current state, so a save or a load needs nothing stored. A name that is
unknown, an unset variable (reads as 0) or an expression that cannot run (a random function) simply does not hold.

Rules:

- When two running animations drive the same slot, the later one in the file wins. An explicit `slot=variant` in the script
  beats an automatic frame track (a script that shows `eyes=closed` is not blinked over); an `animate` the script plays is
  not special-cased and plays as it always did. `checkRig` warns about two automatic animations with a frame track on the
  same slot.
- `behaviors off` in the script suspends every automatic animation (it stops the running ones and holds the timers);
  `behaviors on` re-rolls the `every` waits (see [commands](commands.md#behaviors)).
- Reduce motion keeps an automatic animation running only when it has frame tracks and nothing else (no `keys`, no
  `params`): blinking and the mouth carry on, motion does not.
- The variants of an automatic animation's frame tracks are loaded together with the character, so nothing flashes.
- The studio suspends them in both modes (Animate shows the animation under edit, Model a character at rest); Model mode
  does run the reactions, with the *Test variables* list standing in for the story's variables.
- A flat character (no PSD) can have automatic animations too, with keys moving the whole body.

## reactions

A condition can also hold a *pose* instead of playing a clip: while `affection` is high the character looks happy.
A reaction binds a condition to one of the file's `poses`:

```json
"reactions": [
  { "when": "affection >= 5", "pose": "happy", "over": 0.6, "ease": "out" },
  { "when": "affection < 0",  "pose": "sad",   "over": 1 }
]
```

- The list is ordered like `if` / `elif`: the first entry whose `when` holds is the target. When none holds, the
  parameters it touched go back to what the script set (or the defaults) over the `over` of the entry that stopped holding.
- `over` (seconds, default 0.4) and `ease` are the entry's move into its pose, the same tween `animate ... pose=<name> over
  <s> ease=<e>` makes. Reduce motion and skipping make the move snap.
- `when` is a condition as under `auto`, and sees the same names.
- A reaction holds a target and only the move into it is timed; an animation plays a clip on a clock. A reaction has no
  `auto`, and an automatic animation names no pose.
- Layer order for a parameter, bottom to top: its default, the reaction's pose, the script's value, an animation's
  track, the bone keys on top. A parameter counts as set by the script once it is away from its default, so an explicit
  `animate robo pose=...` wins over a reaction.

## animations

Keyframe animations of your own, played with `animate <char> <name>` (see the `animate` command in
[commands.md](commands.md)). They need a layered character, one with a `sprite.json`.

```json
"animations": {
  "wave": {
    "dur": 1.2,
    "keys": [
      { "t": 0.2, "rot": 7, "y": -0.01, "ease": "out" },
      { "t": 0.5, "rot": -5 },
      { "t": 0.8, "rot": 4 }
    ]
  }
}
```

`dur` is the default length in seconds (1 when left out); `animate mina wave 2s` stretches it, and `loop` repeats it.
Each key is at progress `t` from 0 to 1 (the studio shows and takes it in seconds) and sets any of these channels (offsets from where the character stands):

- `x`, `y`: sideways and vertical, as a fraction of the stage height (negative `y` is up).
- `scale`: added to the size, so `0.05` is 5% bigger.
- `rot`: tilt in degrees, clockwise, about the feet (about the pivot for a part).
- `opacity`: a factor on the alpha, `1` as drawn and `0` gone (never below 0). It rests at 1, not 0: with no key the channel is 1,
  and it eases back to 1 at the ends. An animation that never names it leaves the alpha alone. On a part or a bone it multiplies the
  keyform opacity of the same target; on the whole character it fades the body (the script's `alpha` is separate and multiplies on top).
  Use it to fade a layer in and out; a slot's `none` frame hides it without fading.
- `part`: not a channel but a target: a key with a `part` moves just that part (a slot or layer name; a bone name moves the bone and what hangs on it, see `bones`) with its
  `x`, `y`, `scale`, `rot` and `opacity`; keys without one move the whole character.
- `ease`: how the channels reach this key (`linear`, `in`, `out`, `inout` by default, `back`, `bounce`, `elastic`, or a curve
  `bezier(x1,y1,x2,y2)` as in a script's `ease=`; every `ease` in rig.json takes one, and the studio's ease selects end with
  **curve…**, which asks for one).

An animation can also key **parameters**: `params` holds a track per parameter, a list of `{ "t", "v", "ease" }`. `v` is the
parameter's own value (not an offset); it holds the first key before it and the last key after it, and `ease` is how the
value reaches that key. Instead of a named `ease` a key may give `"bezier": [x1, y1, x2, y2]`, the control points of a CSS-style
`cubic-bezier` over the segment into that key (`x1` and `x2` from 0 to 1; a `y` outside 0 to 1 overshoots); it wins over `ease`. While the animation plays the track replaces the script's value of that parameter and the keyforms
see it, with the bone keys on top (the studio's and the game's evaluation are the same code). An animation of tracks alone
writes `"keys": []`. `checkRig` rejects unknown parameters, values outside the range and unknown fields.

```json
"lookaround": { "dur": 2.4, "keys": [], "params": { "head_x": [{ "t": 0, "v": 0 }, { "t": 0.3, "v": -1 }, { "t": 1, "v": 0 }] } }
```

**Frame-by-frame animation**: `frames` holds stepped tracks over a slot's variants, for hand-drawn cycles (a walk, a hair
flick, a wave). A track is one of two forms, both stored as written:

```json
"walk": { "dur": 0.5, "keys": [], "frames": [
  { "slot": "legs", "frames": ["01", "02", "03", "04"], "fps": 12, "loop": true },
  { "slot": "hand", "keys": [{ "t": 0, "frame": "up" }, { "t": 0.5, "frame": "none" }] }
] }
```

- `keys`: each key shows a variant of the slot (or `none` to hide it) from progress `t` (0 to 1) until the next key; there is no
  blending or easing.
- `frames` / `fps` / `loop`: a clip, timed in seconds from the start of the animation (`fps` defaults to 12). Without `loop` the
  last frame holds; with it the frames repeat. The studio expands a clip to keys the first time you edit it.
- While the animation plays it owns the slot: before it starts and after it ends the script's `slot=variant` (or the look) shows
  again, and an automatic animation (`auto`) on the same slot gives way to the clip. The frame is a function of the animation's
  time, so instant mode and skip land on the right frame. A frame swap does not move anything: draw the frames in place and
  move the character or a bone with ordinary keys alongside.
- `checkRig` rejects an unknown slot or variant, two tracks on one slot, and a plain layer (only slots have variants). Every
  frame of a track is preloaded with the character. A mesh-warped part cannot take a frame track (`checkRig` rejects it).

In the studio the **Frames** section and a row of blocks under the timeline edit them: **Frames from this slot** fills a track with
every variant at the chosen fps (when they end before the animation does, it asks whether to loop them, spread them over the whole length, or play
them once and hold the last); click a block to select it, drag it to retime, double-click a row to add a frame, and use
Duplicate, Earlier / Later (swap the frame with its neighbour; the times stay) and Delete.

### The studio

To make or tune animations without writing the keys by hand, press **Animate** beside the character in the Files panel
(Ctrl+B), or open its rig.json tab and run **Character: Animation Studio** (Ctrl+P, then `>`). The **Model** button beside
it opens the same studio in Model mode. (The studio also runs [on its own](standalone-studio.md), on a character folder with no game
project: **Save** then writes rig.json in the folder, and there is no Place in scene.) The dialog has two modes, as in Live2D Cubism, and reads left to right in the order you
work: **Model | Animate** in the header.

- **Model** is what the character is: its parts, bones and pivots, the parameters (sliders and pads) and the keyforms that tie them to bones
  and parts, the physics chains, and what it does by itself. There is no animation, timeline or key; the stage shows the character at the
  parameter values (their defaults until you move one) with a cross on every pivot. Here **a slider is keyed to transforms**, and you work
  as Cubism does, **parameter first**: pick the parameter, pick the parts it moves, then pose them at its keys with the gizmo (**W** move,
  **E** rotate, **R** scale); the poses are stored as that parameter's keyforms (see [authoring keyforms](#authoring-keyforms-in-model-mode)).
  The **Pivot** tool (**Q**) places the chosen part's or bone's pivot by a click or a drag (one undo step). The **Warp** tool (**D**) shapes a
  part's mesh warp (see [deformers](#deformers)), the **Weights** tool (**B**) paints a mesh's bone weights (see [Skinning](#skinning)) and
  the **Mask** tool (**M**) the points of a drawn mask (see [masks](#masks)).
- **Animate** is what it does: an animation picker, the stage, a timeline of every channel, keys and playback. **Here an animation moves the
  slider values**: a drag with the gizmo writes a key of the bone's own channels at the playhead, and a parameter's key button keys its value on
  the timeline. Animate never edits keyforms, and Model never writes a key of an animation.

All modes share the stage, the working copy, undo and **Apply**. Which mode opens depends on how you got there: the buttons ask
for theirs (or use the switch in the header), the palette command and a script's `animate` line open Animate. The columns are:

- **Left, what you work on.** In Animate, the animation picker: one select with the character's animations and, in their own
  group, the presets, and a **⋯** menu with New, Copy (**Edit copy** for a preset: it turns the preset into keys you can change;
  give it a preset's name to replace that preset for this character), Rename and Delete. The studio opens on the animation a script line asked
  for (F12), else the one you were last on for this character, else its first animation that does not start by itself. The **Look** select dresses the stage in a look
  (in Model mode it also has **Save as look**). Under them the **Parts** tree: the whole character, each part, then the bones
  under their parents. A row is one line; click it (or click the part on the stage) to choose it. On the stage a click on art chooses the
  part; the bone it sits on is chosen by **Alt**-click, by its pivot dot (with Move, Rotate, Scale or Pivot on) or by the *On bone* link in
  Properties, and in Model mode the gizmo poses that bone for a chosen part anyway. With the Warp or Weights tool a click beside the mesh acts
  on the tool's own selection and never changes the chosen row; **Esc** (on the stage or in the side columns) clears the selection, and with
  nothing selected returns to Move. Everything about the chosen row
  is in the Properties section on the right, and the timeline shows its lanes. The block folds, and starts closed in a narrow window.
  The dot before a row is an **eye**: click it to hide that part (a bone: its parts) on the stage, so what lies behind is easy to click and
  work on; a hidden part takes no click on the stage. **Alt-click** shows only that row, and **Show all** under the Parts heading brings
  everything back. Hiding is a studio aid for the session only: it is not saved, survives switching animation or mode, and neither the
  game nor an export of the animation leaves anything out. From the keyboard the tree is one Tab stop: Up, Down, Home and End move between
  the rows, Enter chooses one, **H** hides or shows it, and on a bone Left folds the bones under it and Right opens them.
- **Centre, the stage and time.** The tool row, a row of icon buttons (hover one for its name and key letter): the transform tools
  (**Pivot** in Model, **Move**, **Rotate**, **Scale**), in Model the deform tools (**Warp**, **Weights**, **Mask**), the view (**Fit**)
  and, at the right end in Animate, **Auto-key** and **Key**. The pressed one is the tool in use; Auto-key is on or off.
  Under it, the **tool options bar** (Cubism calls it Tool Details) holds the options of the tool in use, one line that keeps its height
  whichever tool is on (two lines in a narrow window), so the stage never moves: with **Move**, **Rotate** and **Scale** it says what the
  gizmo poses and whether a drag will write (`poses spine, the bone torso sits on · spine is not bound to breathe: D keys torso's warp`;
  when a drag could not be kept, because no parameter is active, what the gizmo poses is not bound to it, or in Animate no animation is chosen
  or it is a preset, the gizmo is locked: a dashed square and no handles, and the line says what to do first)
  and has **World axes** (**X**: the gizmo's axes stay the stage's instead of following the bone); with **Pivot**, **Clear** and
  **Same pivot for…**; with **Weights**, the brush, the active bone, the test pose and the selection's operations
  ([below](#weighting-a-mesh-in-the-studio)); with **Warp**, **Edit topology** (a mesh only), its selection, operations and presets; with **Mask**, the shape it works on and **Add point after** and **Remove point**. Its ▾ buttons open a small
  panel under them. The status line under everything says what a press does and the keys, on one line (hover it for the rest).
  Then the stage,
  and in Animate the transport (Play, Loop, the scrub bar, the length) and the timeline; in Model, the **rig strip**: tabs for the setup
  of the whole rig, **Physics** and **Reactions** (below), each with its count. It starts folded to its tab row; a tab opens it on that tab
  at a fixed height (240 px; the stage gives up that height, never its width), a click on the open tab or the chevron at the end folds it,
  and the left and right arrow keys go along the tabs. Open or folded and the tab are remembered with the layout. Drag a key to move it in time and value,
  double-click a lane to add one. A hollow diamond at an end of a lane is the rest the channel eases to (or from) because no key is
  there; double-click it to hold the pose instead (a key there with the nearest key's value). Once anything is keyed, a channel lane
  with no key folds to a thin row, so the parameter lanes stay in view; double-click it to add a key at rest, which opens the lane. The
  times sit in a ruler over the lanes that stays put when they scroll, and a lane that appears scrolls into view; the ▾ at the end of the transport folds the timeline away so the stage takes its room (▸ brings it back). While an animation plays, the stage shows the whole character, not the chosen part alone. On the stage the wheel zooms toward the cursor (in a window 900 px wide or less, where the columns stack and scroll, the wheel scrolls past the stage and Ctrl+wheel or a pinch zooms), middle-drag (or Space and drag) pans and **F**
  fits the character (**Shift+F** the whole stage). In a script, a hover on an `animate` or `show` line of a rigged character links to the studio, as F12 does. Model opens fitted to the character and Animate to the stage, and a fit is kept when the stage's box changes size, until you zoom or pan. Click a part or a bone handle to choose it, then **W** moves, **E** rotates and **R** scales it with a gizmo
  (a rotation drag can start anywhere inside the ring, while a click there still chooses; shift snaps a rotation to 15 degrees; **X** switches between the bone's axes and the stage's). In Animate a drag writes a key at
  the playhead, or with **Auto-key** off only previews until you press **Key** (K; Shift+K turns Auto-key on or off). In Model a drag writes the keyform of the active parameter
  at its current value. The stage dims the other parts so the chosen one
  stands out. With Move, Rotate or Scale the stage also says which is chosen when a part sits on a bone (the gizmo then poses
  the bone either way): a chosen part has a dashed outline and its bone a plain dot, with a tag by the gizmo such as
  `upper_l · part — the gizmo poses its bone arm_l`; a chosen bone has its body drawn from its joint, its dot ringed around the
  gizmo, its parts faintly outlined and a tag such as `arm_l · bone · 3 parts`. An animation that keys only parts opens at the first of them.
  **Keys, wherever the focus is** (a click on the stage included): **Space** plays or pauses; **Tab** moves on from the stage to the
  transport; a click on a key or a frame block selects it and takes the focus, so **Delete** removes it and the arrow keys nudge it.
  **Esc** closes an open ▾ panel of the tool options bar first; then, in a field, it puts back what you typed; then, with Warp or Weights
  on, it clears the tool's selection; then any tool but Move goes back to Move (the focus goes to the Move button); on Move it closes the
  studio (asking first about changes not applied). **Ctrl+Z** undoes the studio's last step, except
  in a field with an edit not committed yet, where it undoes the typing. Undo and redo (**Ctrl+Y**) go to what they change: the mode, the
  animation and the part it was in. The status line says what was undone (`Undid: wave: Length 1.1 s → 3 s`), and the Undo and Redo
  buttons name their step in their tooltips.
- **Right, the properties of the selection, as sections** that fold (a header button with the count or a summary beside it;
  which are open is remembered in the browser). Animate has **Properties**, **Frames** and **Place in scene**; Model has **Keyforms**
  (or **Parameter**, for a parameter alone) and **Properties**. **Poses** and **Parameters** are in the left column in both modes, above
  the Parts tree. Any section moves to another column or place by its ⠿ grab handle, or with Alt and the arrow keys on it; **Reset layout** puts them back. Physics and Reactions are tabs of the rig
  strip under the stage. A section layout stored when those two were sections here drops them and keeps its order. The animation picker has an **Automatic** line (below) and marks the animations that start by themselves with ⟳. Properties is the chosen row's own controls (below).

Nothing is written until **Apply**, which puts the changes into the rig.json tab in one undo step. The studio sets the values it edits
(`animations`, `pivots`, `bones`, `parts`, `looks`, `parameters`, `pads`, `keyforms`, `poses`, `physics`, `deformers`, `reactions`) and
keeps everything else.

The file is written in one fixed layout, the same one used for a new rig.json and for updates from the art:
- two-space indent;
- lists of numbers or names on one line;
- short objects on one line (a bone, or a vertex's weights).

So once a file has been written, an edit changes only its own lines in a diff. A layout made by hand is replaced the first time the file
is written. Like any edit in the editor, it is saved to disk a moment later. The design and the reasons for this layout are in
[design/studio-ux.md](design/studio-ux.md).

In the tree the arrow keys move between rows (Home and End jump to the first and last), and Left and Right move
between a slot's variants. The tree shows what the character is made of, top layer first, as the PSD has it:

- each **slot** and each **layer** (a plain image that is always drawn) with its thumbnail and a mark when the animation keys it
  or the look hides it;
- the rig.json **bones**, indented under their parents. Drag a bone row onto another to hang it from there (Model mode).
  **New bone** (Model mode) adds an imageless bone under the chosen one, chosen and with its Name field ready to type. Model mode draws a dashed line from each bone's pivot
  to its children's.

**Properties** shows the chosen row:

- *Animate:* the values (x, y, scale, rot, opacity) at the playhead, which you can type to write a key; the selected key (its time in seconds, the
  four channels, the ease, **Delete key**, **Add key at playhead for** a channel); for a slot, its **variants** with thumbnails (`*` marks the
  default). Click a variant to dress the stage with it (click it again to go back to what the look picks), or `none` to hide the slot.
  The dress is only for looking and is not saved.
- *Model:* sub-blocks, each a line (a ▸ that folds it, its name, a summary and its verbs as icon buttons) over its controls, in the order a
  part is rigged in. A sub-block opens by itself when the tool in use has a next step there (Deform with the Warp tool on a part with no warp,
  Skin with the Weights tool on a mesh with no bone bound, Clip with the Mask tool), and folds again when the tool is left unless you opened or
  folded it meanwhile; which are open is remembered with the sections.
  - **Transform** (a part or a bone; never folded): the **pivot** (`pivots.<part>` or `bones.<bone>.pivot`): type x and y, or take the
    **Pivot** tool (**Q**) and click where it should turn (one without a pivot of its own shows its parent's; what the pivot does is the row's
    tooltip). With the Pivot tool the tool options bar has **Clear** and **Same pivot for…**, which lists the other parts as checkboxes (tick
    one to give it the pivot of the chosen part, untick it to remove that part's pivot; putting the parts on one bone does the same job and also
    moves them together). A part's **On bone** (`parts.<name>.bone`) with **Choose** for that bone. A bone's: what it moves, its **Name**
    (type a new one and press Enter or leave the field, as with a parameter's name: its children, the parts and mask shapes on it, its keyforms, animation keys, physics inputs
    and outputs and the weights of skinned meshes follow, in one undo step; a script line that says `part=<bone>` does not), its parent
    (**Under**), and **Remove bone**, the bin in the line (what hung on it goes to its parent, the weights of [skinned meshes](#skinning) too).
    When a parameter is off its default the stage shows that pose, and a note says pivots belong to the rest pose.
  - **Deform** (a part, a bone, a mask shape in a group warp): the warp that bends it, its own lattice or mesh or the group warp it is in, with
    the **Target ▾** in the line when there is a choice; **Add warp**, **Add group warp** and **Remove warp** are the line's icons. See
    [Editing a warp in the studio](#editing-a-warp-in-the-studio).
  - **Skin** (a part with a mesh; with the Weights tool, any part): the bones the mesh is bound to, **Bind ▾** in the line, the vertex read out
    and **Auto-weights**; **Remove skin** is the line's icon. See [Weighting a mesh in the studio](#weighting-a-mesh-in-the-studio).
  - **Clip** (a part or a mask shape): what the part is clipped to, or the shape itself; see [masks](#masks). A ⚠ in its line says that a group
    warp bends the part while the shape that clips it is not a member; Deform has the fix.
  - **Variants** (a slot): the variant on show in the line; open, its chips dress the stage as in Animate.
  - **A Ctrl-click set.** Ctrl-click parts on the stage or in the tree to add them to the chosen one (a dashed outline marks them in the tree;
    Ctrl-click one again to take it out, a plain click chooses one alone). The focus header and Properties' summary then say `3 parts` (the
    tooltip names them), and Properties shows what they share: Transform's **Pivot** and **On bone ▾**, Deform's group warp (the one they are all
    members of, else **Add group warp from 3 selected parts**), and Clip's **Clip to ▾**. A field is blank when the parts differ; a pivot typed,
    a bone or a clip chosen is set on all of them, as one undo step. Skin and Variants are each part's own, so a set does not show them, nor a
    part's own warp (choose that part alone). Keyforms still shows the first part chosen; a drag poses every part of the set that is bound to the
    active parameter. A bone or a mask shape among the rows makes no set: Properties then shows the first row.

The other sections, and the rig strip's tabs:

- **Parameters** (both modes): see [parameters / pads / keyforms](#parameters--pads--keyforms). Animate keys them on the timeline; Model keys the chosen part's keyforms and edits the parameters and pads (open by default there).
- **Physics** (Model, a tab of the rig strip): see [physics](#physics).
- **Automatic** (the line under the animation picker, Animate mode only): the [`auto`](#auto) of the animation on show. *Every* is a min and a max in seconds (empty for no timer; one end empty takes 3 or 6; equal ends make a fixed wait), *While* a condition (`always` and `speaking` are offered). It is written with the animation by Apply, as one undo step. A preset has no line to edit: **Edit copy** first. A copy of an automatic animation is not automatic.
- **Reactions** (Model, a tab of the rig strip) is the list of [`reactions`](#reactions): condition, pose, seconds and ease of the move, with add, remove and reorder (the first that holds wins). Under it the **Test variables** (name = value) stand in for the story's variables so a condition can be seen to hold; they are only for this preview, never saved and not in the undo history. Model mode runs the reactions with those values (automatic animations are suspended in the studio, so a blinking character can be rigged); Animate mode shows the animation under edit alone.
- **Place in scene** (Animate) shows where the character would stand in a scene. Press **Place on stage** and drag the character, or type x, y,
  scale and flip; the line below is the `show` command for it (`show mina at 0.35 y=0.02 scale=1.1`). **Copy** it into the script.
  When the studio is opened with a script in front, the stage shows that scene as the story has it at the cursor line:
  the background and the other characters where they stand (menus on the way take their first option, as in Preview
  from cursor). Saved scripts are used, and the scene is hidden while a pivot is being placed.

#### Exporting a movie

**Export...** in the header (Animate mode) renders the animation on show as a **PNG sequence with transparency**, for a video editor or
another engine. The stage draws it frame by frame in the browser at a fixed timestep, so the frames do not depend on how fast the
computer is, and the same animation gives the same files each time. The dialog asks for:

- **Frame rate** (4 to 120 fps) and **Length**: *Once* plays the animation and ends on its last pose (a frame for each step and one for the
  end pose, so a 3.5 s animation at 12 fps is 43 frames), or *Loop* a number of times as a seamless cycle (a 3.5 s loop at 30 fps is 105
  frames: no frame repeats the start, so the sequence repeats without a hitch). At most 3600 frames.
- **Size** (16 to 4096 px a side; presets for 1280 x 720, 1920 x 1080 and others) and **Framing**: *The whole stage, as placed* scales the stage as the game
  would show it (the character stands where **Place in scene** puts it) to fit the image; *The character, filling the image* fits the box
  the art covers over the whole animation, with a small margin, so the frame holds still and nothing is cut off.
- **Background**: transparent, or a colour (then every pixel is opaque).
- **Physics lead-in** (shown when the character has physics chains): seconds of the animation run unseen before frame 1. The chains start
  at rest, so a looping animation starts with the hair still; a lead-in of a few seconds has it already swinging at frame 1, as it would be
  in the middle of a loop.
- **File name** (`robo_breathe` gives `robo_breathe_0001.png`, `_0002`...) and **Save as**: *A folder of PNG files* (written one frame at a time:
  a folder you choose in Chromium-based browsers, which can write to a folder, and in Marginalia Studio, which has its own dialog) or *One zip
  file* (every browser; collected in memory, so for a long export choose a folder).

The frames show the character alone (no scene or other characters), dressed as the **Look** and the slot variants chosen on the left,
at the parameter values set in the Parameters section; the animation's own tracks win over those, and nothing blinks, talks or idles by
itself. Every part is at full strength (the dimming of the chosen part does not show). Frame tracks, parameters, mesh warps, masks, bones
and physics are all part of the picture. A progress bar and **Cancel** replace the form while it runs (Esc cancels too): a cancelled folder
export keeps the frames already written; a cancelled zip saves nothing. The options are remembered in the browser.

The studio also runs [with no game project](standalone-studio.md), on a character folder, and exports the same way there. Not built: webm and
mp4 (the frames can be turned into a video with any editor or ffmpeg) and a range of frames shorter than the animation.

A channel is eased between its own keys, so keys that name different channels overlap freely: one channel can sway
while another bounces. Every channel is 0 (opacity: 1) at `t=0` and `t=1` unless a key there says otherwise, which makes loops
repeat without a jump. `strength=` on `animate` scales all of it. An animation named like a preset (`bob`,
`nod`...) replaces that preset for this character, including `hop` and `shake`.

## parameters / pads / keyforms

Named scalars that pose the character. The format is read and checked (`engine/src/params.ts`). The game shell evaluates
the keyforms for the values a script sets (see [poses](#poses)); the studio's Model mode authors them (see below), so none of this has to be
written by hand.

```json
{
  "categories": ["Head", "Face"],
  "parameters": [
    { "id": "head_x", "min": -1, "max": 1, "default": 0, "group": "Head" },
    { "id": "head_y", "min": -1, "max": 1, "default": 0, "group": "Head" },
    { "id": "smile", "min": 0, "max": 1, "default": 0 }
  ],
  "pads": [{ "id": "head_turn", "x": "head_x", "y": "head_y", "group": "Head" }],
  "keyforms": [
    { "target": "head", "param": "head_x", "keys": [{ "at": -1, "rot": -8 }, { "at": 1, "rot": 8 }] },
    { "target": "eyes", "params": ["head_x", "head_y"], "grid": { "x": [-1, 1], "y": [-1, 1] },
      "forms": [{ "dx": -0.01 }, { "dx": 0.01 }, { "dx": -0.01, "dy": 0.01 }, { "dx": 0.01, "dy": 0.01 }] }
  ]
}
```

- `categories`: the Parameters panel's categories, in order. A category can be empty. "Other" is not a valid name: it is where controls
  without a `group` show.
- `parameters`: `id`, `min` < `max`, `default` inside the range, an optional `group` (one of the `categories`; `checkRig` reports any other)
  and an optional `ease` (anything `ease=` takes, `bezier(...)` too; `linear` when left out) for the script tweens of this parameter.
- `pads`: a 2D control over two parameters (`x`, `y`) with its own optional `group`. Only a UI grouping; both axes stay ordinary parameters.
- `keyforms`: authored poses of a bone or part. `param` + `keys` blends linearly between the keys (the ends hold); a key may carry an `ease`
  (anything `ease=` takes), the curve the pose follows on the way to that key from the previous one (the studio's **ease** select in the Pose row).
  `params` + `grid` + `forms` blends bilinearly; `forms` has one entry per grid point, a row of `x` after another
  (`y` outer). A form holds `dx`, `dy`, `sx`, `sy`, `rot` (the units of `animations` keys) and `opacity` (a factor);
  a missing field is the rest value.
- Several keyforms may drive one target. They combine, and the target's own animation or drag lands on top of them:
  rotation and translation add, scale and opacity multiply (`combineForms`, `applyLocal`).

`checkRig` rejects duplicate ids, bad ranges and defaults, pads or keyforms naming unknown parameters, targets or
fields, keys outside the parameter's range, and grids with unsorted axes or the wrong number of forms.

The studio's **Parameters** section shows the sliders and pads under their categories (a category folds; controls without one sit under **Other**), and a reset to the default for each (a filter field appears above 12 parameters). In Model mode a **+** in the section header adds a **New parameter**, a **New pad** or a **New category**, and a **✕** on the active control's row deletes it (its other properties are the right column's **Parameter** section). Each category's header has one **+**: its menu adds a new parameter or pad in it, **Rename category** (the controls in it follow; in Model mode clicking the name does the same, and the arrow folds) and **Delete category** (its controls move to Other). Drag a control by its name onto another category, or in front of a row, to move it; drag a category header onto another to reorder them. The separate **Poses** section (both modes, above Parameters) holds the poses: **Use pose** sets the controls from the chosen pose, **Save as pose** stores the values that differ from their defaults, **✕** deletes the chosen pose, **Reset all** sets every parameter to its default and, in Animate, **Key changed** keys them at the playhead. What the Parameters controls write depends on the mode:

- **Animate:** a control's **◆** key button writes a key of that parameter at the playhead into the animation's track, and **Key changed** keys every
  parameter that differs from its default. Keyed parameters get lanes under the channel lanes of the timeline; double-click one to add a key, drag a
  diamond to move it.
- **Model:** the controls are a palette. Clicking a control's name makes it the *active parameter*; the parts you pick are bound to it and posed at its
  keys, and the **◆** button, the gizmo and the **Pose** fields write the *keyform* of the chosen part or bone at that value (below). Nothing goes on a timeline.

### Authoring keyforms in Model mode

You do not have to write `keyforms` by hand. Model mode works in the order of Live2D Cubism: the parameter decides, not the part. All the sliders and
pads are in the one **Parameters** section, which is where they are viewed, created (**New parameter**, **New pad**) and deleted (**✕**); a click on a
control's name shows its properties (name, range, default) in the **Parameter** section of the right column. Then:

1. **Pick the parameter.** Click a control's name (or anywhere on its row): the row is highlighted and the **focus header** at the top of the right column
   names it. Nothing is guessed from the control you used last. A pad is a shortcut over two parameters, which keep a slider each right under it: click the
   pad's name for its grid, a slider's name for that parameter alone. A new parameter or pad becomes active. The studio has **one focus** at a time: a parameter,
   a part, or a part at a parameter's value (a *keyform*). The header shows it in one line, `spine ▾ › wave ▾ @ 1 · key` (`no part ▾ › wave` for the parameter
   alone, `spine › no parameter ▾` for the part alone); in a keyform each word is a button that goes up to it alone. Choosing a part that the active parameter
   moves, or a parameter that moves the chosen part, gives the keyform; choosing anything else replaces what was in focus. The header stays put when the
   sections under it scroll or are moved, and under the words it has the **action row**: the verbs that join the focus to something else (**Bind parts…** for
   a parameter; **Bind to parameter…** and **Copy keys from…** for a part; all three, shortened, for a keyform, with a **⋯** that holds **Copy form**,
   **Paste form** and **Paste mirrored**). A verb that cannot run is greyed out and its tooltip says why. What to do next is the hint on the status line
   under the stage. Under the header, a parameter alone shows the **Parameter** section (its properties, below) in place of **Keyforms** and **Properties**.
2. **Bind the parts it moves.** Press **Bind parts…** and tick the parts in the list that opens under the action row (it has a filter; a checkbox adds what hangs on a ticked bone), then **Bind**. Each ticked part is *bound* to the
   active parameter and makes its keys at once, all at rest, so the pose on show does not change: a slider gets keys at its minimum, default and maximum (the
   "3 points" of Cubism), a pad gets a grid of corners, **2 × 2** (the ends), **3 × 3** (the ends and the default) or **5 × 5** (and halfway between each two),
   chosen with **Grid on a pad** (in the Keyforms section while a pad is active) before binding. **Esc** closes the list. From the other side, choose a part, press **Bind to parameter…** and tick parameters in the list. The stage and the left lists only choose; several clicks on one spot walk through the parts
   under the pointer, and **Ctrl**-click adds a part to the chosen ones. The tree marks the parts bound to the active parameter (a display), and the
   **▾** after the part word of the header lists the parts bound to the active parameter, each with its kind, its keys and how many are posed: a click
   chooses one, and the **✕** beside it unbinds it (its keys go; Ctrl+Z brings them back). **Esc** closes the list. (A click on art chooses the **part**, with every tool but
   **Pivot**, where a click places the pivot instead. The bone a part sits on is chosen deliberately: **Alt**-click the part, click the bone's pivot dot (Move,
   Rotate, Scale or Pivot on), or press the *Choose* link after *On bone* in Properties' Transform. With a part on a bone chosen, Move, Rotate and Scale pose the part
   itself when the active parameter is bound to the part (eyes or a mouth keyed on their own, as in Cubism), and otherwise the bone it sits on, whose
   keyform the part follows; the status line under the stage and the breadcrumb say when it is the bone.) With the **Warp** tool on, binding binds the part's lattice to the (slider)
   parameter instead, with the **Mask** tool its drawn mask; a warp has no slider or parameter choice of its own, its keys are the active parameter's.
3. **Pose it at each key.** The **Keys** row of the **Keyforms** section lists the chosen part's keys on the slider: click one (or a mark on the slider's track, or a corner
   dot on the pad: the dot snaps onto a corner) to put the control there, then pose the part with the gizmo (**W** moves, **E** rotates, **R** scales; **Q**
   is the pivot) or, for a warped part, the Warp tool. The stage shows the pose as you drag, and the release writes it into that key: one undo step per
   drag. The **Pose** row shows the stored pose (x, y, sx, sy, rot, opacity) and takes exact numbers. Under it, **Copy** keeps the pose on show (a key's,
   or the blend between keys) in the studio's own clipboard; **Paste** writes it into the chosen part's key at the slider's value (a pad: the nearest
   corner), and **Paste mirrored** writes it flipped sideways (x moves and rotations change sign, as Copy keys' mirror), each one undo step; **Reset**
   puts the key back to rest. With the Warp tool the same row serves the part's warp: its keys, the Point row in place of the pose's fields, and copy
   and paste of the warp's shape (see *Editing a warp in the studio*); a mask shape's keys are listed to go to, but written in rig.json. A drag on a part
   that is not bound to the parameter is not written to (bind it first); in a Ctrl-click set the bound parts are written and the note names the others.
   A drag at a value with no key adds the key. A mark is filled where the key holds a pose and dim where it is still at rest. (Opacity multiplies the part's alpha, or
   its parts' for a bone; the game and the studio draw it.)
4. **Add or remove keys.** **Add key here** (or the **◆** of the control) adds a key of the chosen part at the slider's value, holding the pose on show
   (the ◆ makes its parameter the active one and binds the chosen part first when neither it nor its bone is bound);
   it becomes **Remove this key** on a key. The key at the default cannot be removed: it is the rest pose the others are posed against. A pad's keys are
   its grid corners; **+ column** / **+ row** add a grid line, and **Reset** puts a corner back to rest.
5. **See what moves a part.** Choose a part: the **▾** after the parameter word of the header lists the parameters (and pads) it is bound to, and the
   parameters its warp and mask are keyed to; click one to make it the active parameter.
6. **Copy keys.** With a part and a parameter in focus and Move, Rotate or Scale on, **Copy keys…** opens a list under the action row: pick one source and
   press **Copy** to replace the chosen part's keys on the active parameter with that binding's: another part on it, or any part on another
   parameter of the same kind (mapped min to min, default to default, max to max). **mirror poses** flips them sideways (x moves and rotations change
   sign: the arm on the other side); **reverse range** runs the parameter's range end for end (a key at the minimum lands at the maximum: a look to the
   left onto a look to the right). They are separate: an arm lift copied to the other arm mirrors only, so its raised pose stays at the top of the slider.

The rules the studio follows (`engine/src/keyform-edit.ts`, `engine/src/param-bind.ts`):

- A slider's value within 2% of its range of an existing key edits that key, and the slider then sits on the key; farther away a drag adds a key. A
  new key starts from the pose the keyform gives there now, so adding one never changes the pose elsewhere. A keyform's first key comes with an empty
  key at the parameter's default (the pose eases in from rest instead of holding everywhere).
- A **pad** writes a corner of a grid: the one nearest to its dot, and the dot then sits on the corner it wrote. The pad shows the grid of the chosen
  part as small circles (filled where a corner is posed). **+ column** and **+ row** add a grid line at the dot's value, with every new corner holding what
  the grid gave there, so a corner can sit exactly where you want it. The pad's name and the sliders of its two parameters choose what a key and a drag write: the pad's
  **grid**, or one of its two parameters alone as a one-parameter keyform, by choosing that parameter's own slider (the sample's head has those).
- Combination stays as in the list above: rotation and translation add, scale and opacity multiply across keyforms, and the bone's own animation
  lands on top. A drag adds its change to the pose on show, so where a target has other keyforms the scale part of the change is divided by what
  they contribute, and the pose after the write is exactly the pose before plus the drag.
- Binding writes a keyform whose keys are all at rest, which is a valid keyform that changes nothing, so a rig can hold bound parts that are not posed yet.
- Apply writes `parameters`, `pads` and `keyforms` (an empty list removes the key from the file) and the key of `deformers` (shapes and clips are written into `parts`), along with everything
  else the studio edits.

### Editing the parameters and pads themselves

**New parameter** adds a slider (-1 to 1, default 0) and **New pad** opens a form where you name the pad and pick, for across and up, a parameter no other pad uses or **＋ New parameter** (both start there); **Create pad**, or Enter in the name, makes it, unless across and up name the same parameter. A new control becomes the focus, with its name ready to
type. A control alone in focus (a click on its name) shows the **Parameter** section in the right column: its range (`-1 to 1, default 0`), then name,
category, min, max, default and ease, **▲** / **▼** for its place in its group and **Delete parameter**; for a pad, its name, category and **Delete pad**, and
its two parameters (across and up), each a button that shows that parameter's own fields (an axis keeps its pad's category). Each change is one undo step.

- A **rename** is carried through everything of the rig that names the parameter: keyforms, pads, poses, animation tracks, deformers, masks and physics
  chains. Script lines (`animate robo look_x=0.6`) are not changed; the note says so.
- A **range** that no longer holds the keys moves the nearest key (or grid line) beyond each end onto that end and drops the others; pose values and
  track values are clamped; the default follows into the range. The note says when keys were moved or dropped. A wider range changes nothing.
- **Delete parameter** (the ✕ on its row, or the button in its editor) also deletes its keyforms (bone, part, warp and mask), the pads on it, its values in poses and its animation tracks. It is
  refused while a physics chain reads or writes it (point the chain elsewhere first). Deleting a pad keeps its parameters and their keyforms.
- A parameter name has letters, digits and `_` and starts with a letter or `_` (what a script's `name=value` takes); names are unique.

## deformers

A **deformer** warps one part: a lattice of control points laid over the part's image, drawn as a mesh, so hair can sway or a
chest breathe without cutting the art into bones. The displacements are driven by ordinary [parameters](#parameters--pads--keyforms),
so poses, `animate` tracks and [physics](#physics) outputs move them like anything else.

```json
{
  "parameters": [{ "id": "breathe", "min": 0, "max": 1, "default": 0 }],
  "deformers": [
    { "id": "torso_warp", "part": "torso", "grid": [2, 3], "keyforms": [
      { "param": "breathe", "keys": [{ "at": 0 }, { "at": 1, "pts": { "3": [-0.006, 0], "5": [0.006, 0], "1": [0, -0.003] } }] }
    ] }
  ]
}
```

- `id`: unique. `part`: a part (not a bone); a part has at most one deformer of its own. A deformer with `members` instead of `part`
  warps a whole group of parts: see [Group warps](#group-warps).
- `grid`: `[cols, rows]` of cells (default `[4, 4]`, at most 12 each), so `(cols + 1) * (rows + 1)` points. Points are numbered
  row by row from the top left (`y` outer): in a `[2, 3]` grid point 0-2 is the top edge, 3-5 the next row.
  The rest positions are a regular grid over the part's image and are not written down.
- `mesh`: `{ "verts": [x0, y0, x1, y1, ...], "tris": [i, j, k, ...], "detail": "medium" }` instead of `grid`: a **free mesh**, a triangle mesh of any
  shape over one part (not a group warp), with up to 500 vertices. `verts` are rest positions in the part's own pixels (the image box at the
  origin), `tris` index triples wound the same way, each with some area. Vertices may reach a little past the image (100 pixels at most).
  `pts` in the keyforms then number the vertices. `detail` is only the generator's hint for Regenerate. A deformer has `grid` or `mesh`, not both. In the animation studio, the **Mesh** row of Properties' **Deform** makes one: choose a part, pick the **Detail**, press **Generate mesh** (it follows the art's outline; a part that has a lattice is asked first, since the mesh replaces it). While the pointer or the focus is on the Mesh row, the stage draws the mesh it would make, dashed over the part, and the vertex count beside Detail follows the detail and the margin. Its vertices are then edited like a lattice's points: with the Warp tool, drag a vertex at the active parameter's value (the keyform then holds `pts` indexed by vertex), choose several, soft-select over the mesh's edges, and use Scale, Rotate, Reset, Mirror, Smooth and the presets. **Edit topology** (the first icon in the Warp tool's options bar, for a mesh) puts its tools in the bar in place of the selection and the operations: add, delete and move vertices, and flip, add and remove edges; because vertex numbers change, that drops the mesh's keyforms (it asks first when there are any, and Undo brings them back).
- `mesh.weights` and `mesh.defaultBone` **skin** a free mesh to the bones, so one part (a sleeve, a tail) bends along the skeleton
  instead of turning as one piece: see [Skinning](#skinning), and the **Weights** tool that paints them.
- `keyforms`: like the [bone keyforms](#parameters--pads--keyforms): `param` + `keys` (each key `{ "at": value, "pts": {...} }`) blends linearly
  between keys, `params` + `grid` (`{ "x": [...], "y": [...] }`) + `forms` (`{ "pts": {...} }`, `x` row after row) blends bilinearly. `pts` maps a point
  number to `[dx, dy]`, in the unit of `animations` offsets (fractions of the stage); a point left out stays at rest. Several
  keyforms on one deformer add their displacements.
- All variants of a slot share the lattice, so give them the same image size. A slot with a warped part cannot have a frame track
  (`checkRig` rejects it).
- Reduced motion drops the automatic animations (idle, looping `animate`) but a pose or `param` set by the script still warps the part;
  skipping shows the final shape at once. The studio's preview draws the same mesh. A click in the studio lands on the art as it is
  drawn: the point is looked up on the deformed mesh, so a strongly bent part is picked where you see it.

The sample's robo also has a warp driven by a pad: `head_warp`, a group warp over `face`, `eyes` and `mouth` (3 x 3 cells, keyed to `head_x` / `head_y` with `params` + `grid` + `forms`), squeezes the face as the head turns and slides the features a little further than the outline, so the head reads
as turning in depth. Drag the `head_turn` pad in the studio, or `show robo pose=lookleft`.

`checkRig` rejects duplicate ids, parts that are missing or are bones, bad grids, unknown or out-of-range parameters and points
outside the grid (or the mesh), and for a free mesh too many vertices, bad or degenerate triangles and mixed winding, and bad weights
(a vertex outside the mesh, an unknown bone, a weight that is not above 0, more than 4 bones on a vertex); weights that do not add up to 1 are warned about.

### Group warps

One lattice can bend several parts together, so a head turn is one warp instead of one per part:

```json
{ "id": "head_warp", "members": ["face", "eyes", "mouth"], "grid": [3, 3], "keyforms": [ ... ] }
```

- `members`: a list of parts with art or [shape parts](#masks) (at least one, none twice, none a bone, no part with art that has a frame track).
  A part or shape is in at most one group warp, and a part may also have a warp of its own (`part`). `part` and `members` are not both allowed.
- `box` (optional): `[x, y, width, height]` in pixels of the PSD canvas, the area the lattice covers. Left out, it is the union of
  the **image** members' boxes: a shape does not widen it, so a group whose members are all shapes needs an explicit `box` (`checkRig` says so).
  Points and keyforms are as for any deformer; the displacements are in stage fractions.
- **Order**: each member is shaped by its own warp first, then every vertex of its mesh is moved by the group lattice, which is sampled
  (bilinear between the four surrounding points; outside the box the nearest edge holds) at the vertex's rest position in the group box.
  The two displacements add, so the group bends the member as it was drawn, not where its own warp moved it. A member without a warp of
  its own is drawn as a mesh of at least 8 x 8 cells so a coarse group lattice bends it smoothly; a member that has one keeps its own grid
  or 8 x 8, whichever is finer, with its own lattice sampled between its points.
- The displacement is in each member's own space (after its bone), so keep the members on one bone: `checkRig` warns when they sit on
  different bones, where a bone that turns relative to the others would skew the warp.
- Masks that follow a member, and the studio's click-to-pick, follow the member as drawn, with both warps.
- **A shape as a member.** The shape is shaped by its own `keyforms` first, then the group lattice is sampled at each polygon point's canvas
  position in the group box and the displacement (stage fractions times the stage unit, as for a part) is added, so the lid bends with the
  eyes it covers. A shape clipping several parts is drawn once per clipped part, each bent the same. **No double warp:** a shape that
  `follow`s a part of the *same* group is not bent by the lattice itself, since that part's mesh already holds the group and the shape rides
  on it; a shape that follows a part of another group, or a bone, is bent by its own group as usual.
- `checkRig` warns when a part in a group warp is clipped to a shape (or part) that is neither a member of that group nor a shape following
  a member ("eyes is bent by head_warp but its clip shape eyelids is not"): the art would bend and its clip would stay. It says nothing when neither is in a group.

### Editing a warp in the studio

In Model mode choose a part in the tree and press **D**, the Warp tool. Properties' **Deform** line says what warp the part has (*No warp*,
*Lattice 2×3*, *Mesh 212 vertices*); it opens by itself when there is none, and its icon **Add warp to <part>** gives the part the default
4x4 lattice, named `<part>_warp`, and turns the tool on. The stage then draws the lattice over the part: thin lines and a round handle at
every control point, the same size at any zoom. Deform holds the warp's structure (the Members, the Mesh row, the lattice size); the keyform
at the slider's value is in the **Keyforms** section, as a pose's is (its keys, the Point row in place of the pose's fields, copy and paste,
Reset); the tool options bar over the stage holds what acts on the chosen points (the selection, Soft, Mirror, Smooth, Scale, Rotate and the
presets), so they sit next to the lattice.

- **The active parameter** picks the keyform being edited: one slider at a time (a warp is not keyed to a pad), the one the focus header
  names, moved in the Parameters section. Keyforms' key strip lists its keys on this warp; click one, or ‹ and ›, to go to its value.
  A slider value on a key (within 2 % of the range) edits that key; anywhere else the first edit adds a key there, holding the
  shape the curve had, so nothing else changes. A parameter with no keys yet gets an empty key at its default first, so the shape
  eases in from rest. **Add key here** makes a key at the value holding the shape on show; on a key it reads **Remove this key**. The
  line over the Point row says which of these a drag will do.
- **Drag a handle** to move the point (one undo step for the whole drag; the point follows the pointer, the stage shows the part
  bending as you go). Other parameters keep their values, so the lattice shows everything that bends the part now, but only the
  chosen parameter's keyform is written. Keyforms' **Point** row picks a point from a list and edits its dx and dy in this keyform by number
  (stage units, as in `pts`), so the whole job works from the keyboard. Keyforms' **Reset** takes the chosen points back to rest in this keyform.
- **Copy**, **Paste** and **Paste mirrored** (Keyforms, or the header's ⋯) copy the shape on show (every point's move, a key's or the blend
  between keys) and write it at the slider's value of a warp with as many points: another key of the same warp, or a lattice of the same
  size. Mirrored, each column takes its partner's move with dx flipped; a mesh is not pasted mirrored (paste, then **Mirror** ▾). The
  clipboard holds a pose or a warp's shape, and each pastes only as what it is.
- **Select** several points to edit them together: drag a rectangle on empty stage (Shift adds), Shift-click a point to add or
  remove it, Ctrl+A / Esc on the stage, or use **All**, **None**, **Invert** and the row and column pickers in the bar (it counts
  the points chosen). Dragging a chosen point moves the whole selection by the same amount (one undo step); pressing an unchosen
  point chooses it alone. With **Soft** on (the bar's toggle), points near the selection follow too, fading over the **reach** (in
  lattice cells) by the chosen fall-off, both under its ▾; the stage tints them. The dx and dy fields show the selection's average,
  and typing moves every chosen point by the difference. Keyforms' **Reset** takes them back to rest; the bar's **Scale** and **Rotate**
  apply the factor and the angle set under their ▾ (about the selection's middle or the lattice's) to the chosen points.
- **Mirror** ▾ copies the left half of this keyform to the right, flipped in x (**Left to right**, or **Right to left**); with points
  chosen, **Chosen points** copies just those onto their partners across the middle. **Smooth** moves each point part of the way
  toward the average of its neighbours, and can be pressed again; with points chosen it moves only those. Both write the keyform of
  the active parameter, and wait for one.
- **Lattice** columns and rows resize the grid (1 to 12); the shape already authored is sampled onto the new lattice, so it survives.
  **Remove warp** (the struck-through lattice in Deform's line) deletes the deformer.
- **Group warps.** A part that is in a group warp has the **Target ▾** in Deform's line (its own warp, if it has one, and the group, `group <id>`);
  it defaults to the own warp, else the group. Choosing the group draws the group's lattice over all its members and edits it like any other (the
  presets and Scale / Rotate use the lattice's box). Choose a bone and **Add group warp from <bone>** (Deform's icon) makes one over every part on the
  bone and the bones below it, named after the bone (`<bone>_warp`); with two or more parts ticked in the tree (Ctrl-click) the icon is
  **Add group warp from N selected parts**. Deform's **Members** row lists the members, each with a ticked checkbox (untick one to take it
  out), then **Add…**, a list of the other parts and shapes, and **Use selected parts**: adding a part that is in another group moves it here (a part is in one group at most; a group left with no members goes). **Remove group warp** (the line's icon) deletes it.
  The first member is the one a drag is measured in. The group's `box` is not edited in the studio (it stays the union of the members' images).
- **Presets** ▾ (in the bar) writes explicit keys for the chosen parameter, replacing the keys it had on this warp: **Sway** bends sideways about
  the top edge, **Breathe** scales about the bottom middle, **Sine** is a wave down the part with the top fixed, **Noise** is a
  repeatable random jitter. The amount is a share of the part's width (Breathe: the scale gained). Each puts an empty key at the
  parameter's default and the shape at the far end; a range that reaches below the default also gets the opposite shape there. The
  game only ever sees the keys: there is no preset type in rig.json.

Edits are written by **Apply** like the rest. Small numbers are kept to five decimals and a point that moves nowhere is left out of
`pts`. The studio edits one-parameter keyforms (`param` + `keys`); a two-parameter `params` + `grid` + `forms` you wrote by hand is
kept and still shown, but not edited. If a parameter has several one-parameter keyforms on a deformer, the first is the one edited.

### Skinning

A free mesh can be **skinned**: each vertex follows one or more bones by weight, so one part bends along the skeleton instead of
turning as one piece (a sleeve over an elbow, a tail, a lock of hair). Only a `mesh` deformer can be skinned, not a lattice.

```json
{
  "bones": {
    "arm_l": { "parent": "torso", "pivot": [410, 300] },
    "forearm_l": { "parent": "arm_l", "pivot": [470, 420], "tip": [500, 540] }
  },
  "parts": { "upper_l": { "bone": "arm_l" } },
  "deformers": [{ "id": "upper_l_mesh", "part": "upper_l", "mesh": {
    "verts": [], "tris": [],
    "defaultBone": "arm_l",
    "weights": { "14": { "arm_l": 0.65, "forearm_l": 0.35 }, "15": { "forearm_l": 1 } }
  } }]
}
```

- `weights` maps a vertex number to `{ bone: weight }`: at most 4 bones on a vertex, read as relative and normalized to a sum of 1
  (`{ "a": 2, "b": 2 }` is half and half). A vertex that is not listed binds wholly to `defaultBone`, so only the vertices that bend need
  writing; without a `defaultBone` an unlisted vertex stays at rest. A mesh with a `weights` object, even an empty one, is skinned.
- A skinned part is moved by its weighted bones alone. Its own `bone` still places it in the tree (the Parts tree, the dimming, group
  warps) but no longer turns it, which is why the vertices that should follow the part's own bone are weighted to it. An animation or
  `animate` key that names the part itself is applied to the vertices before the skin, about the part's rest pivot, so the bones carry
  that shape along; keyforms (the mesh's own and a group warp's) shape the mesh before the skin too, so they work as corrections that
  ride along with the bend. A mesh whose every vertex is on the part's own bone draws exactly as an unskinned part does.
- `bones.<bone>.tip`, `[x, y]` like `pivot`, is where a bone ends when it has no child (a hand bone, the last bone of a strand). It moves
  nothing; only auto-weights read it, to know how far the bone reaches.
- Masks that follow a skinned part, and a click on it in the studio, use the mesh as drawn, so they land on the bent art. Edit topology
  keeps the weights (a vertex added on an edge blends its ends'), and Regenerate resamples them onto the new vertices.
- `checkRig` rejects a vertex number outside the mesh, an unknown bone, a weight that is not a number above 0 and more than 4 bones on a
  vertex, and warns about weights that do not add up to 1 (they are normalized anyway).

Two characters are skinned. The demo's robo bends its left sleeve: `upper_l_mesh` is weighted to `arm_l` above the elbow and blends to
`forearm_l` below it, so `wave` bends the sleeve at the joint. The sample's Mina wears her back hair as one skinned mesh, `hair_back_mesh`,
on five chains of three strand bones that [physics](#physics) chains swing, so the hair sways from bone rotations with no parameter between.

### Weighting a mesh in the studio

In Model mode click the part on the stage, or choose it in the tree; it needs a mesh (one without: **Generate mesh** in Deform's Mesh row first, which the Weights tool opens for it; that needs no parameter, so a rig with none can be skinned).
Press **B**, the Weights tool: Properties' **Skin** holds the bones bound, the vertex read out and Auto-weights (it opens by itself while no bone is bound,
and in *Read weights*), and the tool puts the brush,
the active bone, the test pose and the selection in the tool options bar over the stage (**B** with a bone chosen picks the first part on
that bone that has a mesh, and says which). The bar's label names the brush mode and the active bone (`Weights · Add on forearm_l`); Skin's
line counts the bones the mesh is bound to, or says *Not skinned*. While the tool is on, a
click beside the mesh never changes the chosen part: it acts as the brush mode says (clears the readout or the selection, or dabs on air),
so the bones you have bound and the bone you are painting stay. A click on another part's art chooses that part; its mesh takes over, and the
first part's bound bones and selection are kept for a return within the same opening. The tool is left with its button, **B**, another tool's
key, or **Esc** with nothing selected (back to Move).

- **Bones** (Skin) lists the bones **bound** to the mesh: those its weights name, and those you add with **Bind ▾** in Skin's line, which makes
  the bone it binds the **active bone**: the one the stage shows and the brush paints, chosen in the bar's bone ▾. With the tool on, the stage draws the mesh with the active bone's weight
  at every vertex as heat (transparent for none, solid for 1) and the bone's body, from its pivot to its children's pivots or its `tip`.
  The bound list is the studio's own: a bone with no weight yet is not saved. The first weights written to a mesh (by Auto-weights or the
  brush) make the part's own bone its `defaultBone`. The **✕** on a bone unbinds it: a bone with no weight yet just leaves the list; one
  with weights gives them, and `defaultBone` when it was that, to its parent bone (as Remove bone does; a bone without one drops them), and
  unbinding the last bone removes the skin, so the part follows its own bone again. Ctrl+Z brings the bone back.
- **Auto-weights** (Skin) gives every vertex a share of each bound bone by how near it is to the bone's body, blending over **blend** pixels
  (empty: an eighth of the mesh's longer side); a vertex outside every bone's reach goes wholly to the nearest bone. It replaces the
  weights the mesh has (it asks first) and is the usual start: a hand or a face should then be painted wholly onto one bone. **Remove
  skin** (the icon in Skin's line) drops the weights, and the part follows its own bone again.
- **Brush** (the bar): the **mode** icons say what a press and a drag on the stage do, and the stage's cursor shows it. They are disabled
  until a bone is bound (a click on a vertex reads it out meanwhile) and start on *Add*. *Add*, *Subtract* and *Replace* paint the
  active bone's weight under a brush of **radius** screen pixels (the ring is the cursor), fading toward its edge, by **strength** per
  touch (**[** and **]** change the radius, with Shift the strength; the two fields show only for the painting modes); *Smooth* blurs the weights of the vertices under the brush toward their neighbours'; *Read weights* (a crosshair) clicks a vertex to
  show its weights in the **Vertex** row (`vertex 14: arm_l 0.65 · forearm_l 0.35`; a click on nothing clears it); *Select* (a cell cursor)
  picks vertices (below). Every touch renormalizes the vertices it changes, and a fifth bone on a vertex replaces its smallest. One stroke
  is one undo step, and a tool key pressed during a stroke waits for the release.
- **Test pose** (the bar): **Rotate** or **Move** puts that gizmo on the active bone, and dragging it poses the bone without keying anything, so
  you can bend the elbow and watch the skin while you paint. **Reset pose** takes the skeleton back to rest; leaving the tool does too.
- **Selection** (the bar, in the *Select* mode): drag a rectangle on the stage to select the vertices in it (Shift adds), Shift-click
  toggles one; **All** (Ctrl+A on the stage), **None** (Esc) and **Invert**, the count, then **Set value** ▾ and **Mirror** ▾ (below).
  The selected vertices are ringed on the stage, and a single selected vertex is the one the Vertex row shows.
- **Vertex** (Skin): the readout of the picked (or single selected) vertex and one number field per bound bone; typing a weight sets it on that
  vertex and renormalizes the others. One undo step per field.
- **Set value** ▾ works on the selection and the active bone: **Set**, **Add** and **Subtract** the **value**; **Smooth** by the smooth
  amount (a step toward the neighbours over the mesh's edges); **Prune** drops weights below the **limit**; **Reset to default bone**
  binds the selected vertices to the `defaultBone` again. Each button is one undo step.
- **Mirror** ▾ copies the weights of one half of the image onto the other across its vertical middle (**Left half to right**, **Right half
  to left**), pairing vertices by position and bones by name: `arm_l` with `arm_r`, `.L` with `.R`, a leading or trailing `left` with
  `right`. The bones whose names say no side are asked for in one dialog, a choice of the rig's bones for each (the bone itself for one on
  the middle). Each starts at a guess from numbered names (`hair_0_0` with `hair_4_0`, `hair_2_0` its own) or at the bone itself; the answers
  are kept for the next press. The note counts the vertices changed and those with no partner. One undo step.

**Remove bone** (the bin in a bone's Transform line) gives a bone's weights, and `defaultBone` when it was that bone, to its parent on every skinned mesh,
in the same undo step as the bone. A keyform of a skinned mesh is a shape before the skin, so a Warp-tool drag on it waits while a bone
that moves the mesh is posed by a parameter: the hint names the bones and says to put their sliders back to the defaults (the Weights
tool's own test pose never gets in the way). Edits are written by **Apply** like the rest; weights are kept to four decimals, and a
vertex left wholly on the `defaultBone` is not written.

## masks

A **mask** clips one part to a shape: an iris stays inside the eye and a mouth interior inside the mouth, however the eye or the head
moves. The clip is a hard-edged stencil mask, drawn by the renderer from another part's pixels or from a drawn shape.

A **shape** is a named part with no image: an entry of `parts` with a `polygon`. **Clipping** is a link on the clipped part, `clip`,
which names a shape or a part with art.

```json
{
  "parameters": [{ "id": "eye_open", "min": 0, "max": 1, "default": 1 }],
  "parts": {
    "eyes": { "bone": "head", "clip": "eyelids" },
    "iris": { "clip": "eye_white" },
    "eyelids": { "bone": "head", "polygon": [[214, 294], [326, 294], [326, 346], [214, 346]], "keyforms": [
      { "param": "eye_open", "keys": [{ "at": 0, "pts": { "0": [0, 0.024], "1": [0, 0.024], "2": [0, -0.024], "3": [0, -0.024] } }, { "at": 1 }] }
    ] }
  }
}
```

- **A clipped part** has `clip: "<name>"`. A part has one clip (it may be mesh-warped); one shape may clip many parts. `clip` names a
  **shape part** (its polygon) or a **part with art**: the part is then drawn only where that part has pixels (its opaque pixels above
  half alpha, traced into an outline, so a part with two eyes clips to both), and the shape follows that part's bone, animation, keyforms
  and warp. A part cannot be clipped to itself. Holes in a traced shape are filled, and the edge is hard: a soft-edged source clips a pixel inside its art.
- **A shape part** has `polygon` (points `[x, y]` in pixels of the PSD canvas, 3 to 64, in order around it) and optionally `bone`, `follow`
  and `keyforms`. Its name is unique among parts and bones. It has no layer: it is never in `order`, and importing the PSD again leaves it alone.
- `bone`: the shape moves with that bone (the head). `follow`: a part with art; the shape hangs on that part's drawn mesh and bends
  with its warp and its group warp. With neither, the shape stays where it is drawn on the character.
- `keyforms`: the same as a [deformer's](#deformers), `param` + `keys` or `params` + `grid` + `forms` with `pts` mapping a
  point number (in the order of `polygon`) to `[dx, dy]` in stage fractions. The points are keyform targets, so a parameter can
  close the eyelid above, and poses, `animate` tracks and physics drive the shape like anything else.
- **Nesting.** A part clipped to a part with art that is itself clipped passes through both shapes (the iris is clipped to the eye white,
  which is clipped to the eyelids): one nested level, two shapes in all. `checkRig` rejects a loop (a clipped to b, b clipped to a), a chain of
  three, a `clip` that names nothing, a bone or the part itself, a shape that is also a part or bone name, a shape in `order`, a `follow` that
  is not a part with art, bad polygons and keyforms, and warns above 8 masks.
- **When the source is not drawn** (a look hides the part a clip or `follow` names with `none`), the clipped part is hidden too: it has
  nothing to be clipped to. Variants of a slot clip to the variant on show. A frame track on the clipped part is fine; on the source part
  every frame is traced once.
- **Cost.** Each mask is a stencil push and pop and a batch break every frame, plus one redraw of its shape when its parameters change.
  That has **not been measured on a low-end phone** (TODO: *Measure stencil masks on a low-end phone*), so keep masks few: the renderer logs a
  warning above 8 on one character, `checkRig` says so too, and the debug console's `memory` and the browser tests' `vnStage()` report how many
  are on stage. Soft (alpha) masks are not offered.

A shape can be a member of a [group warp](#group-warps) and then bends with its lattice (a shape on a bone does not otherwise follow a warp).

The sample's robo has a shape part: `eyelids` clips its eyes to a rectangle over them that `eye_open` squeezes shut
(`show robo pose=squint`, or move the slider in the studio). It is a member of `head_warp` with the face, eyes and mouth, so it follows
the head turn with them.

A top-level `masks` list, as the first build had it, is no longer read and `checkRig` reports it. To move one over: a `from` mask becomes
`"clip": "<that part>"` on the clipped part; a polygon mask becomes a shape part (an entry of `parts` with the `polygon`, `keyforms` and
`bone`, or `follow` for an `on` that named a part) and the clipped part gets `"clip": "<shape name>"`.

In the studio, Model mode has the **Clip** sub-block of Properties and the **Mask** tool (see [the studio](#the-studio)). Every shape part has a row of its own under **Shapes** in the
Parts tree (a diamond instead of a thumbnail, a *shape* badge, the bone it sits on and the parts it clips; no eye and no keys: nothing of it is drawn or
animated). Choosing the row chooses the shape: the stage outlines it with a dashed line and Properties' **Clip** edits it.

- **A shape row**: Clip's line reads `Shape on head, 4 points, clips 1`; its bin is **Delete shape** (the parts it clipped are drawn whole again and it
  leaves its groups; nothing is asked, the note under the stage says what changed, and Ctrl+Z brings it back). Open, it has the **name** (**Rename**
  changes every `clip` and group warp member that names it; the name must be new among the parts, bones and shapes), **on bone** and **follows** (the
  part whose drawn mesh bends it), the parts it clips, and its **points**.
- **A part row**: Clip's line reads *Not clipped*, or *Clipped to* with the **Clip to ▾** picker in the line: *nothing*, a shape, or another part (its
  drawn silhouette), with the same rules as `checkRig` (not itself, no loop, at most two shapes deep). Its icons: **New shape** draws a rectangle inside
  the part's image on the part's bone and clips the part to it; **Remove clip** draws the part whole again. The part's shape (if it is clipped to one) is
  the one the Mask tool then edits, and the one Clip shows open.
- **The Mask tool (M)** outlines every shape of the character (the chosen one stronger) and turns the points of the chosen shape into handles: drag one (one
  undo step), click its edge to add a point there, Alt-click a point to remove it. Clicking within a few pixels of another shape's outline chooses that shape
  (so does a click inside a shape where no part's art is under the pointer); a click on a part's art still chooses the part. Clip's **point** with **x** and **y**, and
  the tool options bar's **Add point after** and **Remove point** icons do the same from the keyboard. A shape needs 3 to 64 points. With the Mask tool on, **Bind parts…** binds a shape
  (or a part clipped to one) to the active parameter, like a warp; a click only chooses.
- The Warp tool works on a shape row: a shape has no warp of its own, so it offers the group warp it is a member of. In a group's **Members** list the shapes
  stand beside the parts, marked *(shape)*, and **Add group warp from &lt;bone&gt;** (or from the ticked tree rows, shape rows included) takes the shapes on that bone
  and below it. A clipped part that a group bends while its shape is not a member is flagged in Deform, with a button that adds the
  shape to the group, and by a ⚠ in Clip's line.
- A polygon's keyforms are written by hand in rig.json; the studio keeps them when it edits the points (their point numbers follow an added or
  removed point) and the stage shows the shape they give at the parameter values on show. Problems in the chosen mask (a loop, a chain of three) are
  listed in Clip.
- The studio edits shapes and clips as they are in the file: a shape that clips several parts is one shape, and Apply writes it once.

## poses

Named snapshots of some parameters; the animator saves them, the script uses the name (`show robo pose=happy`,
`animate robo pose=sad over 0.5s`, see [animate](commands.md#animate)).

```json
{ "poses": { "happy": { "smile": 1, "head_y": 0.2 }, "look_left": { "head_x": -1 } } }
```

A pose names only the parameters it changes, so poses layer: `pose=happy,look_left` applies both, later ones winning. Each
value must lie in its parameter's range, and `checkRig` rejects poses naming unknown parameters or none at all. The
pose names are not the `looks` (which swap slot variants); a character can use both.

## physics

Secondary motion: chains of damped pendulum segments that swing when their inputs change (hair when the head turns, a
ribbon, a hem). `physics` is an object of chain id to chain; the simulation is in `engine/src/physics.ts`.

```json
{
  "physics": {
    "hair": {
      "inputs": [{ "bone": "head", "channel": "rot", "weight": 1.6, "smoothing": 0.3 }],
      "segments": [
        { "length": 1, "mass": 1, "damping": 3, "stiffness": 90, "limit": 20 },
        { "length": 1.2, "mass": 1.2, "damping": 3, "stiffness": 70, "limit": 25 }
      ],
      "outputs": [{ "part": "hair_back", "scale": 0.6, "min": -25, "max": 25 }],
      "wind": { "strength": 4, "noise": 0.8, "frequency": 0.4, "seed": 1 }
    }
  }
}
```

- **inputs** are `{ "param": id }` or `{ "bone": name, "channel": "dx" | "dy" | "sx" | "sy" | "rot" }` (a part name works
  too; `rot` when the channel is left out), each with a `weight` and an optional `smoothing` (0 to under 1, how much the
  input lags). The chain reacts to the input *changing*: a head held at 30 degrees pulls the hair once, and it settles.
  A bone channel is the bone's offset after the parameters' keyforms and the animations, before physics.
- **segments** are the pendulum, first to last: `length` and `mass` (more of either moves it less), `damping` (1/s),
  `stiffness` and `limit` (largest swing, degrees).
- **outputs** are `{ "param": id }` (an ordinary parameter, so keyforms respond to it) or, until mesh deformers exist,
  `{ "part": name }`, which rotates that part or bone. `scale`, `min`, `max`, and `segment` (0-based, the last by default).
- **wind** is an optional push of the chain's own: `strength` (degrees/s²), `noise` (0 steady, 1 fully gusting), `frequency`, `seed`.
- **windScale** is how much of the scene's wind (the script's [`wind`](commands.md#wind) command) the chain feels: 1 by
  default, 0 for none, a negative number to mirror it (a chain whose output is flipped). A heavier or stiffer chain
  moves less in the same wind, as it does for any push. The script's right is a negative swing for something that hangs
  from its top, so a hair chain with a positive output `scale` streams to the right. The script's [`gravity`](commands.md#gravity)
does not reach chains (they spring back to rest rather than hang).

Physics is additive and last: the parameters and the animations pose the character, then each chain adds its outputs
on top (a parameter output is clamped to its range). An output may not feed an input of its own chain, directly or
through keyforms or other chains; `checkRig` reports that, unknown ids and bad ranges.

The chains step at a fixed 60 Hz, so the result does not depend on the frame rate. They are not saved or part of the
game state: after a sync (load, rollback, jumping) they start at rest, skip mode and reduced motion keep them at rest,
the pause menu freezes them, a character who is off stage is not stepped, and a scene change keeps the swing of a
character who stays. An animation can bypass chains while it plays: `"physicsOff": true` (all) or `["hair"]`.

In the studio the **Physics** tab of the rig strip under the stage (Model mode) lists the chains with their problems, adds one from a
preset (long hair, short hair, ribbon, cloth hem) and edits each chain as three small tables: inputs (a parameter, or a bone and its
channel, with weight and smoothing), segments and outputs (a parameter, or a part or bone to rotate, with the segment read, scale, min and
max), each with + and ✕, then the chain's own wind and its share of the scene's wind. A problem shows under its row. **Shake** swings the chain's first input
back and forth on the stage (until Stop, or until the tab is folded or left); the chains also run while an animation plays there (Animate mode) and in Model mode.
