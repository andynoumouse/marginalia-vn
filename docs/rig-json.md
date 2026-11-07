# rig.json reference

`assets/char/<name>/rig.json` is a hand-written addition to a layered character. The PSD converter writes
`sprite.json` next to it and never touches `rig.json`; the game reads both when it starts. Every key is optional.
In the editor open it from the Files panel (Characters) or Ctrl+P then `#`: a character without a file starts from
a generated skeleton that stays unsaved until you save. The tab completes part, slot and variant names, marks
mistakes as warnings, and **Character: Update Rig from Reconverted Art** (Ctrl+P, then `>`) adds new parts to `order`, and bones (with the new parts on them) for new PSD `+folders`; bones and parts you already have are left alone.

A flat character (one image per pose, no PSD) can have a `rig.json` too, without a `sprite.json`: only `animations`,
`autonomous.idle` and `autonomous.speak.anim` apply, and keys move the whole body (no `part`). Characters with a rig.json appear in
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

A part without a pivot turns about the middle of its image. Parts move in two ways: a keyframe with a `part` (see
`animations` below), or `animate <char> <name> part=<part>`, which plays any animation, presets included, on that
part instead of on the whole character. To move several parts together (a head is the face, bangs, eyes and mouth), put them
on a bone (see `bones`) and give the bone a pivot at the neck.

## autonomous

Things the character does by itself, with no line in the script. All of them need a layered character, and an animation
named here is a preset or one of the character's own `animations`. Slots and variants are written out; there is no
`true` shorthand, and `checkRig` reports an unknown key (a typo such as `blnik`), a missing slot or variant, and the old
top-level `idle` / `speak` / `blink`, which moved under `autonomous`.

```json
"autonomous": {
  "idle": "breathe",
  "speak": { "slot": "mouth", "variants": ["open", "neutral"], "anim": "bob", "rate": 8 },
  "blink": { "slot": "eyes", "variant": "closed", "every": [3, 6], "dur": 0.12 }
}
```

- `idle`: an animation that loops for as long as the character is on stage. `animate <char> ... loop` adds to it
  and `animate <char> stop` leaves it running.
- `speak`: while one of this character's lines types, cycle `slot` through `variants` at `rate` changes a second
  (default 8), and/or loop `anim`. `variants` needs its `slot`. The mouth stops when the line is complete or skipped.
- `blink`: every `every` seconds ([min, max], default [3, 6]) the `variant` of `slot` is swapped in for `dur` seconds
  (default 0.12). `slot` and `variant` are required. A slot the script has set itself (`show mina eyes=closed`) is
  left alone.

The script can suspend all of it with `behaviors off` and resume with `behaviors on` (see [commands](commands.md#behaviors)).

The swapped-in variants are loaded together with the character, so nothing flashes. Reduce motion switches `idle` and
the `speak` animation off; blinking and the mouth carry on.

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

`dur` is the default length in seconds (1 when left out); `animate mina wave 2` stretches it, and `loop` repeats it.
Each key is at progress `t` from 0 to 1 and sets any of these channels (offsets from where the character stands):

- `x`, `y`: sideways and vertical, as a fraction of the stage height (negative `y` is up).
- `scale`: added to the size, so `0.05` is 5% bigger.
- `rot`: tilt in degrees, clockwise, about the feet (about the pivot for a part).
- `part`: not a channel but a target: a key with a `part` moves just that part (a slot or layer name; a bone name moves the bone and what hangs on it, see `bones`) with its
  `x`, `y`, `scale` and `rot`; keys without one move the whole character.
- `ease`: how the channels reach this key (`linear`, `in`, `out`, `inout` by default, `back`, `bounce`, `elastic`).

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
  again, and `autonomous` blinking and talking on the same slot give way to the clip. The frame is a function of the animation's
  time, so instant mode and skip land on the right frame. A frame swap does not move anything: draw the frames in place and
  move the character or a bone with ordinary keys alongside.
- `checkRig` rejects an unknown slot or variant, two tracks on one slot, and a plain layer (only slots have variants). Every
  frame of a track is preloaded with the character. A mesh-warped part cannot take a frame track (`checkRig` rejects it).

In the studio the **Frames** section and a row of blocks under the timeline edit them: **Frames from this slot** fills a track with
every variant at the chosen fps; click a block to select it, drag it to retime, double-click a row to add a frame, and use
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
  part's mesh warp (see [deformers](#deformers)) and the **Mask** tool (**M**) the points of a drawn mask (see [masks](#masks)).
- **Animate** is what it does: an animation picker, the stage, a timeline of every channel, keys and playback. **Here an animation moves the
  slider values**: a drag with the gizmo writes a key of the bone's own channels at the playhead, and a parameter's key button keys its value on
  the timeline. Animate never edits keyforms, and Model never writes a key of an animation.

All modes share the stage, the working copy, undo and **Apply**. Which mode opens depends on how you got there: the buttons ask
for theirs (or use the switch in the header), the palette command and a script's `animate` line open Animate. The columns are:

- **Left, what you work on.** In Animate, the animation picker: one select with the character's animations and, in their own
  group, the presets, and a **⋯** menu with New, Copy (**Edit copy** for a preset: it turns the preset into keys you can change;
  give it a preset's name to replace that preset for this character), Rename and Delete. The **Look** select dresses the stage in a look
  (in Model mode it also has **Save as look**). Under them the **Parts** tree: the whole character, each part, then the bones
  under their parents. A row is one line; click it (or click the part on the stage) to choose it. Everything about the chosen row
  is in the Selection section on the right, and the timeline shows its lanes. The block folds, and starts closed in a narrow window.
  The dot before a row is an **eye**: click it to hide that part (a bone: its parts) on the stage, so what lies behind is easy to click and
  work on; a hidden part takes no click on the stage. **Alt-click** shows only that row, and **Show all** under the Parts heading brings
  everything back. Hiding is a studio aid for the session only: it is not saved, survives switching animation or mode, and neither the
  game nor an export of the animation leaves anything out.
- **Centre, the stage and time.** The tool row, a row of icon buttons (hover one for its name and key letter): the transform tools
  (**Pivot** in Model, **Move**, **Rotate**, **Scale**), in Model the deform tools (**Warp**, **Mask**), the view (**World axes**, **Fit**)
  and, at the right end in Animate, **Auto-key** and **Key**. The pressed one is the tool in use; World axes and Auto-key are on or off.
  Then the stage,
  and in Animate the transport (Play, Loop, the scrub bar, the length) and the timeline. Drag a key to move it in time and value,
  double-click a lane to add one. On the stage the wheel zooms toward the cursor, middle-drag (or Space and drag) pans and **F**
  fits the character. Click a part or a bone handle to choose it, then **W** moves, **E** rotates and **R** scales it with a gizmo
  (shift snaps a rotation to 15 degrees; **X** switches between the bone's axes and the stage's). In Animate a drag writes a key at
  the playhead, or with **Auto-key** off only previews until you press **Key**. In Model a drag writes the keyform of the active parameter
  at its current value. The stage dims the other parts so the chosen one
  stands out. An animation that keys only parts opens at the first of them.
- **Right, the properties of the selection, as sections** that fold (a header button with the count or a summary beside it;
  which are open is remembered in the browser). Animate has **Selection**, **Parameters**, **Frames** and **Place in scene**; Model
  has **Selection**, **Warp**, **Mask**, **Parameters**, **Physics** and **By itself**. Selection is the chosen row's own controls (below).

Nothing is written until **Apply**, which puts the changes into the rig.json tab in one undo step: only the values the studio edits are
rewritten (`animations`, `pivots`, `bones`, `parts`, `looks`, `parameters`, `pads`, `keyforms`, `poses`, `physics`, `deformers`, `masks`, `autonomous`), the rest of the file keeps its layout. Like any edit
in the editor it is saved to disk a moment later. The design and the reasons for this layout are in
[design/studio-ux.md](design/studio-ux.md).

In the tree the arrow keys move between rows (Home and End jump to the first and last), and Left and Right move
between a slot's variants. The tree shows what the character is made of, top layer first, as the PSD has it:

- each **slot** and each **layer** (a plain image that is always drawn) with its thumbnail and a mark when the animation keys it
  or the look hides it;
- the rig.json **bones**, indented under their parents. Drag a bone row onto another to hang it from there (Model mode).
  **New bone** (Model mode) adds an imageless bone under the chosen one. Model mode draws a dashed line from each bone's pivot
  to its children's.

**Selection** shows the chosen row:

- *Animate:* the values (x, y, scale, rot) at the playhead, which you can type to write a key; the selected key (`t`, the
  four channels, the ease, **Delete key**, **Add key at playhead for** a channel); for a slot, its **variants** with thumbnails (`*` marks the
  default). Click a variant to dress the stage with it (click it again to go back to what the look picks), or `none` to hide the slot.
  The dress is only for looking and is not saved.
- *Model:* the **pivot** (`pivots.<part>` or `bones.<bone>.pivot`): type x and y, or press **Pick on stage** and click where it
  should turn (one without a pivot of its own shows its parent's); **Same pivot for…** lists the other parts as checkboxes (tick one to
  give it the pivot of the chosen part, untick it to remove that part's pivot; putting the parts on one bone does the same job and also
  moves them together); a part's **bone** (`parts.<name>.bone`); a bone's **parent** and **Remove bone** (what hung on it goes to its parent); and the variants. When a
  parameter is off its default the stage shows that pose, and a note says pivots belong to the rest pose.

The other sections:

- **Parameters** (both modes): see [parameters / pads / keyforms](#parameters--pads--keyforms). Animate keys them on the timeline; Model keys the chosen part's keyforms and edits the parameters and pads (open by default there).
- **Warp** (Model): see [deformers](#deformers).
- **Mask** (Model): see [masks](#masks).
- **Physics** (Model): see [physics](#physics).
- **By itself** (Model) sets `autonomous`: `idle`, `speak` (animation, mouth slot, variants, rate) and `blink` (slot, variant, interval, duration). The slot and variant are always written out (`mouth`, `eyes` / `closed` unless set); the other empty fields use the defaults; keys it does not know are kept.
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
while another bounces. Every channel is 0 at `t=0` and `t=1` unless a key there says otherwise, which makes loops
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
  and an optional `ease` (a name from `ease=`, `linear` when left out) for the script tweens of this parameter.
- `pads`: a 2D control over two parameters (`x`, `y`) with its own optional `group`. Only a UI grouping; both axes stay ordinary parameters.
- `keyforms`: authored poses of a bone or part. `param` + `keys` blends linearly between the keys (the ends hold); a key may carry an `ease`
  (a name from `ease=`), the curve the pose follows on the way to that key from the previous one (the studio's **ease** select in the Pose row).
  `params` + `grid` + `forms` blends bilinearly; `forms` has one entry per grid point, a row of `x` after another
  (`y` outer). A form holds `dx`, `dy`, `sx`, `sy`, `rot` (the units of `animations` keys) and `opacity` (a factor);
  a missing field is the rest value.
- Several keyforms may drive one target. They combine, and the target's own animation or drag lands on top of them:
  rotation and translation add, scale and opacity multiply (`combineForms`, `applyLocal`).

`checkRig` rejects duplicate ids, bad ranges and defaults, pads or keyforms naming unknown parameters, targets or
fields, keys outside the parameter's range, and grids with unsorted axes or the wrong number of forms.

The studio's **Parameters** section shows the sliders and pads under their categories (a category folds; controls without one sit under **Other**), and a reset to the default for each (a filter field appears above 12 parameters). In Model mode a **+** in the section header adds a **New parameter**, a **New pad** or a **New category**, and a **✕** next to each control's ✎ deletes it. Each category's header has its own **+** (a new parameter or pad in it), a **✎** to rename it (the controls in it follow) and a **✕** to delete it (its controls move to Other). Drag a control by its name onto another category, or in front of a row, to move it; drag a category header onto another to reorder them. The separate **Poses** section (both modes, above Parameters) holds the poses: **Use pose** sets the controls from the chosen pose, **Save as pose** stores the values that differ from their defaults, **✕** deletes the chosen pose, **Reset all** sets every parameter to its default and, in Animate, **Key changed** keys them at the playhead. What the Parameters controls write depends on the mode:

- **Animate:** a control's **◆** key button writes a key of that parameter at the playhead into the animation's track, and **Key changed** keys every
  parameter that differs from its default. Keyed parameters get lanes under the channel lanes of the timeline; double-click one to add a key, drag a
  diamond to move it.
- **Model:** the controls are a palette. Clicking a control's name makes it the *active parameter*; the parts you pick are bound to it and posed at its
  keys, and the **◆** button, the gizmo and the **Pose** fields write the *keyform* of the chosen part or bone at that value (below). Nothing goes on a timeline.

### Authoring keyforms in Model mode

You do not have to write `keyforms` by hand. Model mode works in the order of Live2D Cubism: the parameter decides, not the part. All the sliders and
pads are in the one **Parameters** section, which is where they are viewed, created (**New parameter**, **New pad**), renamed, re-ranged and deleted (the
✎ button). Then:

1. **Pick the parameter.** Click a control's name (or anywhere on its row): the row is highlighted and the block under the list names it as the **Active
   parameter**. Nothing is guessed from the control you used last or from the chosen part. A pad is a shortcut over two parameters, which keep a
   slider each right under it: click the pad's name for its grid, a slider's name for that parameter alone. A new parameter or pad becomes active.
2. **Pick the parts it moves.** Click a part on the stage, or tick its row in the **Parts** tree. Each pick *binds* the part to the active parameter and makes
   its keys at once, all at rest, so the pose on show does not change: a slider gets keys at its minimum, default and maximum (the "3 points" of Cubism), a pad
   gets a grid of corners, **2 × 2** (the ends), **3 × 3** (the ends and the default) or **5 × 5** (and halfway between each two), chosen with **Grid on a pad**
   before binding. A part that is bound already is only chosen; a second tick, or the **✕** beside it in the **Bound parts** list, unbinds it (its keys
   go; Ctrl+Z brings them back). With no parameter active, a click on the stage only selects the part, and so does a **Shift**-click while one is. (The stage
   picks parts with the **Move**, **Rotate**, **Scale**, **Warp** or **Mask** tool; with **Pivot** a click on the stage places the pivot instead.) With the
   **Warp** tool on, a pick binds the part's lattice to the (slider) parameter instead, with the **Mask** tool its drawn mask; the Warp section has no
   slider or parameter choice of its own, its keys are the active parameter's.
3. **Pose it at each key.** The **Keys** row of the block lists the chosen part's keys on the slider: click one (or a mark on the slider's track, or a corner
   dot on the pad: the dot snaps onto a corner) to put the control there, then pose the part with the gizmo (**W** moves, **E** rotates, **R** scales; **Q**
   is the pivot) or, for a warped part, the Warp tool. The stage shows the pose as you drag, and the release writes it into that key: one undo step per
   drag. The **Pose** row shows the stored pose (x, y, sx, sy, rot, opacity) and takes exact numbers; **Reset pose** puts it back to rest. A drag on a part
   that is not bound yet binds it first (the same undo step). A mark is filled where the key holds a pose and dim where it is still at rest. (Opacity multiplies the part's alpha, or
   its parts' for a bone; the game and the studio draw it.)
4. **Add or remove keys.** **Add key here** (or the **◆** of the control) adds a key of the chosen part at the slider's value, holding the pose on show;
   it becomes **Remove this key** on a key. The key at the default cannot be removed: it is the rest pose the others are posed against. A pad's keys are
   its grid corners; **+ column** / **+ row** add a grid line, and **Reset pose** puts a corner back to rest.
5. **See what moves a part.** Choose a part: **Moved by** lists the parameters (and pads) it is bound to, and the parameters its warp and mask are keyed to; click
   one to make it the active parameter.

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
- Apply writes `parameters`, `pads` and `keyforms` (an empty list removes the key from the file) and the keys of `deformers` and `masks`, along with everything
  else the studio edits.

### Editing the parameters and pads themselves

**New parameter** adds a slider (-1 to 1, default 0) and **New pad** a pad over the first two parameters no other pad uses. The **✎** button of a
control opens its editor: name, category, min, max, default and ease for a parameter; name, the two parameters (across and up) and category for a pad;
**Delete parameter** / **Delete pad**. Each change is one undo step.

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

- `id`: unique. `part`: a part (not a bone); a part has at most one deformer.
- `grid`: `[cols, rows]` of cells (default `[4, 4]`, at most 12 each), so `(cols + 1) * (rows + 1)` points. Points are numbered
  row by row from the top left (`y` outer): in a `[2, 3]` grid point 0-2 is the top edge, 3-5 the next row.
  The rest positions are a regular grid over the part's image and are not written down.
- `keyforms`: like the [bone keyforms](#parameters--pads--keyforms): `param` + `keys` (each key `{ "at": value, "pts": {...} }`) blends linearly
  between keys, `params` + `grid` (`{ "x": [...], "y": [...] }`) + `forms` (`{ "pts": {...} }`, `x` row after row) blends bilinearly. `pts` maps a point
  number to `[dx, dy]`, in the unit of `animations` offsets (fractions of the stage); a point left out stays at rest. Several
  keyforms on one deformer add their displacements.
- All variants of a slot share the lattice, so give them the same image size. A slot with a warped part cannot have a frame track
  (`checkRig` rejects it).
- Reduced motion drops the automatic animations (idle, looping `animate`) but a pose or `param` set by the script still warps the part;
  skipping shows the final shape at once. The studio's preview draws the same mesh. Hit-testing in the studio samples the un-warped
  art, so clicks on a strongly bent edge are approximate.

`checkRig` rejects duplicate ids, parts that are missing or are bones, bad grids, unknown or out-of-range parameters and points
outside the grid.

### Editing a warp in the studio

In Model mode choose a part in the tree and open the **Warp** section (or press **D**, the Warp tool, which opens it). A part
without a warp offers **Add warp to <part>**: it gets the default 4x4 lattice, named `<part>_warp`, and the tool turns on. The
stage then draws the lattice over the part: thin lines and a round handle at every control point, the same size at any zoom.

- **The parameter and its slider** pick the keyform being edited: one parameter at a time, the slider being the same control as in the
  Parameters section (moving one moves the other). The chips under it are the parameter's keys on this warp; click one to go to its
  value. A slider value on a key (within 2 % of the range) edits that key; anywhere else the first edit adds a key there, holding the
  shape the curve had, so nothing else changes. A parameter with no keys yet gets an empty key at its default first, so the shape
  eases in from rest. **Delete key** removes the key at the value. The hint under the slider says which of these will happen.
- **Drag a handle** to move the point (one undo step for the whole drag; the point follows the pointer, the stage shows the part
  bending as you go). Other parameters keep their values, so the lattice shows everything that bends the part now, but only the
  chosen parameter's keyform is written. The **Point** row picks a point from a list and edits its dx and dy in this keyform by number
  (stage units, as in `pts`), so the whole job works from the keyboard. **Reset point** takes it back to rest in this keyform.
- **Mirror** copies the left half of this keyform to the right, flipped in x (or right to left); **Smooth** moves each point part of
  the way toward the average of its neighbours, and can be pressed again.
- **Lattice** columns and rows resize the grid (1 to 12); the shape already authored is sampled onto the new lattice, so it survives.
  **Remove warp** deletes the deformer.
- **Preset** writes explicit keys for the chosen parameter, replacing the keys it had on this warp: **Sway** bends sideways about
  the top edge, **Breathe** scales about the bottom middle, **Sine** is a wave down the part with the top fixed, **Noise** is a
  repeatable random jitter. The amount is a share of the part's width (Breathe: the scale gained). Each puts an empty key at the
  parameter's default and the shape at the far end; a range that reaches below the default also gets the opposite shape there. The
  game only ever sees the keys: there is no preset type in rig.json.

Edits are written by **Apply** like the rest. Small numbers are kept to five decimals and a point that moves nowhere is left out of
`pts`. The studio edits one-parameter keyforms (`param` + `keys`); a two-parameter `params` + `grid` + `forms` you wrote by hand is
kept and still shown, but not edited. If a parameter has several one-parameter keyforms on a deformer, the first is the one edited.

## masks

A **mask** clips one part to a shape: an iris stays inside the eye and a mouth interior inside the mouth, however the eye or the head
moves. The clip is a hard-edged stencil mask, drawn by the renderer from another part's pixels or from a polygon.

```json
{
  "parameters": [{ "id": "eye_open", "min": 0, "max": 1, "default": 1 }],
  "masks": [
    { "id": "iris_clip", "part": "iris", "from": "eye_white" },
    { "id": "eyelids", "part": "eyes", "on": "head", "polygon": [[214, 294], [326, 294], [326, 346], [214, 346]], "keyforms": [
      { "param": "eye_open", "keys": [{ "at": 0, "pts": { "0": [0, 0.024], "1": [0, 0.024], "2": [0, -0.024], "3": [0, -0.024] } }, { "at": 1 }] }
    ] }
  ]
}
```

- `id`: unique. `part`: the part that is clipped (a slot or layer, not a bone); a part has at most one mask. It may be mesh-warped.
- **The shape is one of two.** `from` names another part: the part is drawn only where that part has pixels (its opaque pixels above
  half alpha, traced into an outline, so a part with two eyes clips to both), and the shape follows that part's bone, animation, keyforms
  and warp. `polygon` is a drawn shape, points `[x, y]` in pixels of the PSD canvas (3 to 64, in order around it).
  Give exactly one of them. Holes in a traced shape are filled, and the edge is hard: a soft-edged source clips a pixel inside its art.
- `on` (a polygon only): the bone or part the shape follows, so it moves with the head or the eye white. Without it the shape stays
  where it is drawn on the character. A polygon on a warped part bends with that part's lattice.
- `keyforms` (a polygon only): the same as a [deformer's](#deformers), `param` + `keys` or `params` + `grid` + `forms` with `pts` mapping a
  point number (in the order of `polygon`) to `[dx, dy]` in stage fractions. The points are keyform targets, so a parameter can
  close the eyelid above, and poses, `animate` tracks and physics drive the shape like anything else.
- **Nesting.** A part whose `from` part is itself clipped passes through both shapes (the iris is clipped to the eye white, which is clipped
  to the eyelids): one nested level, two shapes in all. `checkRig` rejects a loop (a clipped to b, b clipped to a), a chain of three,
  unknown ids, `from` with `on` or `keyforms`, bad polygons and keyforms, and warns above 8 masks.
- **When the source is not drawn** (a look hides the `from` part with `none`, or the `on` part), the clipped part is hidden too: it has
  nothing to be clipped to. Variants of a slot clip to the variant on show. A frame track on the clipped part is fine; on the source part
  every frame is traced once.
- **Cost.** Each mask is a stencil push and pop and a batch break every frame, plus one redraw of its shape when its parameters change.
  That has **not been measured on a low-end phone** (TODO: *Measure stencil masks on a low-end phone*), so keep masks few: the renderer logs a
  warning above 8 on one character, `checkRig` says so too, and the debug console's `memory` and the browser tests' `vnStage()` report how many
  are on stage. Soft (alpha) masks are not offered.

The sample's robo has a mask of the second kind: `eyelids` clips its eyes to a rectangle over them that `eye_open` squeezes shut
(`show robo pose=squint`, or move the slider in the studio).

In the studio, Model mode has a **Mask** section and tool (see [the studio](#the-studio)): choose a part and pick what it is clipped to; the stage draws the
outline of the chosen part's mask as a dashed line.

- **Clip to** is *nothing*, *the shape of another part* (with a list of the other parts) or *a drawn shape*, which starts as a rectangle inside the
  part's image. **Remove mask** draws the part whole again.
- **The Mask tool (M)** turns the points of a drawn shape into handles: drag one (one undo step), click an edge to add a point there, Alt-click a
  point to remove it. **Follows** picks the bone or part the shape sits on; **Point** with **x**, **y**, **Add point after** and **Remove point** do the
  same from the keyboard. A shape needs 3 to 64 points.
- A polygon's keyforms are written by hand in rig.json; the studio keeps them when it edits the points (their point numbers follow an added or
  removed point) and the stage shows the shape they give at the parameter values on show. Problems in the chosen mask (a loop, a chain of three) are
  listed in the section.

## poses

Named snapshots of some parameters; the animator saves them, the script uses the name (`show robo pose=happy`,
`animate robo pose=sad over 0.5`, see [animate](commands.md#animate)).

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
- **wind** is an optional push: `strength` (degrees/s²), `noise` (0 steady, 1 fully gusting), `frequency`, `seed`.

Physics is additive and last: the parameters and the animations pose the character, then each chain adds its outputs
on top (a parameter output is clamped to its range). An output may not feed an input of its own chain, directly or
through keyforms or other chains; `checkRig` reports that, unknown ids and bad ranges.

The chains step at a fixed 60 Hz, so the result does not depend on the frame rate. They are not saved or part of the
game state: after a sync (load, rollback, jumping) they start at rest, skip mode and reduced motion keep them at rest,
the pause menu freezes them, a character who is off stage is not stepped, and a scene change keeps the swing of a
character who stays. An animation can bypass chains while it plays: `"physicsOff": true` (all) or `["hair"]`.

In the studio the **Physics** section (Model mode) lists the chains with their problems, adds one from a preset (long hair,
short hair, ribbon, cloth hem), edits a chain as JSON and has a **Shake** button that swings the chain's first input back
and forth on the stage; the chains also run while an animation plays there (Animate mode) and in Model mode.
