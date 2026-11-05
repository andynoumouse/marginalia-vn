# rig.json reference

`assets/char/<name>/rig.json` is a hand-written addition to a layered character. The PSD converter writes
`sprite.json` next to it and never touches `rig.json`; the game reads both when it starts. Every key is optional.
In the editor open it from the Files panel (Characters) or Ctrl+P then `#`: a character without a file starts from
a generated skeleton that stays unsaved until you save. The tab completes part, slot and variant names, marks
mistakes as warnings, and **Character: Update Rig from Reconverted Art** (Ctrl+P, then `>`) adds new parts to `order`, and bones (with the new parts on them) for new PSD `+folders`; bones and parts you already have are left alone.

A flat character (one image per pose, no PSD) can have a `rig.json` too, without a `sprite.json`: only `animations`,
`idle` and `speak.anim` apply, and keys move the whole body (no `part`). Characters with a rig.json appear in
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

## idle / speak / blink

Things the character does by itself, with no line in the script. All three need a layered character, and an animation
named here is a preset or one of the character's own `animations`.

```json
"idle": "breathe",
"speak": { "variants": ["open", "neutral"], "anim": "bob", "rate": 8 },
"blink": true
```

- `idle`: an animation that loops for as long as the character is on stage. `animate <char> ... loop` adds to it
  and `animate <char> stop` leaves it running.
- `speak`: while one of this character's lines types, cycle `slot` (default `mouth`) through `variants` at `rate`
  changes a second (default 8), and/or loop `anim`. The mouth stops when the line is complete or skipped.
- `blink`: `true`, or an object. Every `every` seconds ([min, max], default [3, 6]) the `variant` (default
  `closed`) of `slot` (default `eyes`) is swapped in for `dur` seconds (default 0.12). A slot the script has set
  itself (`show mina eyes=closed`) is left alone.

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

To make or tune animations without writing the keys by hand, press **Animate** beside the character in the Files panel
(Ctrl+B), or open its rig.json tab and run **Character: Animation Studio** (Ctrl+P, then `>`). The dialog plays the character's animations and the presets on a stage of their own, with a timeline
of every channel. Drag a key to move it in time and value, double-click a lane to add one, and use the fields under the
timeline for exact values and the ease. **Edit copy** turns a preset into keys you can change (give it a preset's name to
replace that preset for this character). Pick a part or bone in **Lanes of** (or in the **Parts** tab) to see and add the keys that move just that part, and to
place its pivot: type x and y, or press **Pick on stage** and click where the part should turn. The stage dims the
other parts so the chosen one stands out, and an animation that keys only parts opens at the first of them. Nothing is written until
**Apply**, which puts the changes into the rig.json tab in one undo step: only the values the studio edits are rewritten
(`animations`, `pivots`, `idle`, `speak` and `blink`), the rest of the file keeps its layout. Like any edit
in the editor it is saved to disk a moment later.

To look at the rig without the animation, switch the header's **Animate | Rig** toggle to **Rig**. The animation list, timeline
and Key tab go away, the stage grows, and the character stands at rest with a cross on every pivot (parts that share a pivot
share one cross; hover it for their names). Choose a part in the Parts tab and click or drag on the stage to move its pivot at once (a
drag is one undo step), no **Pick on stage** needed. The **Rig** button beside **Animate** in the Files panel (or **Inspect
Rig** in the character's context menu) opens the studio straight in this mode. The Parts and Character tabs work as before, the working copy and Apply are shared, and switching
back to **Animate** keeps everything.

In the **Parts** tab the arrow keys move between rows (Home and End jump to the first and last), and Left and Right move
between a slot's variants.

The **Parts** tab shows what the character is made of, top layer first, as the PSD has it:

- each **slot** with a thumbnail of every variant (`*` marks the default). Click a variant to dress the stage with it (click
  it again to go back to what the look picks), or `none` to hide the slot. The dress is only for looking and is not saved;
- each **layer** (a plain image that is always drawn) with its thumbnail;
- under every part a **bone** choice (`parts.<name>.bone`);
- the rig.json **bones**, indented under their parents, each with the parts on it and below it, a choice of **parent**, and
  **Remove** (what hung on it goes to its parent). **New bone** adds an imageless bone under the chosen one. Choosing a bone
  and clicking the stage (or typing x and y) sets its pivot (`bones.<name>.pivot`); one without a pivot of its own shows its
  parent's. Rig mode draws a dashed line from each bone's pivot to its children's. A mark on every part or bone the current
  animation keys;
- the **looks** `show` takes: rig.json `looks` and the names tagged on PSD variants (implicit looks, marked as coming
  from the art), each with the variants it picks. Click one to dress the stage in it.

Click a row to choose that part, like **Lanes of**. Under the tree:

- **Same pivot for…** lists the other parts as checkboxes: tick one to give it the pivot of the chosen part, untick it to
  remove that part's pivot. Putting the parts on one bone does the same job and also moves them together.

The other tabs:

- **By itself** sets `idle`, `speak` (animation, mouth slot, variants, rate) and `blink` (slot, variant, interval, duration). Empty fields use the defaults; keys it does not know are kept.
- **Place** shows where the character would stand in a scene. Press **Place on stage** and drag the character, or type x, y,
  scale and flip; the line below is the `show` command for it (`show mina at 0.35 y=0.02 scale=1.1`). **Copy** it into the script.
  When the studio is opened with a script in front, the stage shows that scene as the story has it at the cursor line:
  the background and the other characters where they stand (menus on the way take their first option, as in Preview
  from cursor). Saved scripts are used, and the scene is hidden while a pivot is being placed.

A channel is eased between its own keys, so keys that name different channels overlap freely: one channel can sway
while another bounces. Every channel is 0 at `t=0` and `t=1` unless a key there says otherwise, which makes loops
repeat without a jump. `strength=` on `animate` scales all of it. An animation named like a preset (`bob`,
`nod`...) replaces that preset for this character, including `hop` and `shake`.
