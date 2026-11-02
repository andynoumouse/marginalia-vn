# rig.json reference

`assets/char/<name>/rig.json` is a hand-written addition to a layered character. The PSD converter writes
`sprite.json` next to it and never touches `rig.json`; the game reads both when it starts. Every key is optional.
In the editor open it from the Files panel (Characters) or Ctrl+P then `#`: a character without a file starts from
a generated skeleton that stays unsaved until you save. The tab completes part, slot and variant names, marks
mistakes as warnings, and **Character: Update Rig from Reconverted Art** (Ctrl+P, then `>`) adds new parts to `order`.

```json
{
  "order": ["bottom", "top"],
  "groups": { "outfit": ["top", "bottom"] },
  "poses": {
    "shy": { "pose": "smile", "mouth": "neutral" },
    "casual": { "pose": "happy", "outfit": "casual" }
  }
}
```

In a script a `show` takes a pose and `slot=variant` overrides: `show mina shy`, `show mina outfit=school`,
`show mina casual mouth=open`. A *part* is a slot (a PSD group of variants) or a plain layer, named by its file
name without `.png`. `sprite.json` lists the parts bottom to top.

## order

Part names, bottom to top. The listed parts swap among the positions they already hold in the PSD; parts you leave
out stay where they were. Use it to change what draws over what without touching the PSD, for example hanging a
shirt over a skirt (`["bottom", "top"]` when the PSD has `top` below `bottom`).

## groups

One name for several parts. In a `show`, it sets several slots at once: `"outfit": ["top", "bottom"]` makes
`outfit=casual` set the `casual` variant of both slots. A slot of the group that lacks the variant is skipped with a
warning, and so are plain layers in the group. `outfit=none` empties every slot of the group. A real part with the same
name as a group wins over the group.

In an animation, a key's `part` or `animate ... part=` can name a group, and it moves all its parts as one piece: a head
made of the face, bangs, eyes and mouth is keyed once with `"head": ["face", "bangs", "eyes", "mouth"]`. The group turns
and scales about its own pivot (see `pivots`), or about its first part's when it has none. A part's own keys add to
the group's.

## poses

Shorthands for a pose plus overrides, used as `show <char> <name>`. `pose` is the base pose (a PSD variant name or
alias, which picks that variant in every slot that has one); every other key is a slot or group name with its
variant. A shorthand wins over a PSD variant of the same name. Explicit overrides on the `show` line beat what the
shorthand sets: `show mina casual mouth=open`.

## pivots

Where a part turns and scales from when an animation moves it by itself, in pixels of the PSD canvas, `[x, y]` from
the top left (the same numbers as a layer's position in `sprite.json`). A part is a slot or a plain layer; a group
can have a pivot too.

```json
"pivots": { "hair_back": [270, 380], "face": [270, 380] }
```

A part without a pivot turns about the middle of its image. Parts move in two ways: a keyframe with a `part` (see
`animations` below), or `animate <char> <name> part=<part>`, which plays any animation, presets included, on that
part instead of on the whole character. To move several parts together (a head is the face, bangs, eyes and mouth), make
them a group (see `groups`) and give the group a pivot at the neck.

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
- `part`: not a channel but a target: a key with a `part` moves just that part (a slot or layer name, or a group, see `pivots`) with its
  `x`, `y`, `scale` and `rot`; keys without one move the whole character.
- `ease`: how the channels reach this key (`linear`, `in`, `out`, `inout` by default, `back`, `bounce`, `elastic`).

To make or tune animations without writing the keys by hand, press **Animate** beside the character in the Files panel
(Ctrl+B), or open its rig.json tab and run **Character: Animation Studio** (Ctrl+P, then `>`). The dialog plays the character's animations and the presets on a stage of their own, with a timeline
of every channel. Drag a key to move it in time and value, double-click a lane to add one, and use the fields under the
timeline for exact values and the ease. **Edit copy** turns a preset into keys you can change (give it a preset's name to
replace that preset for this character). Pick a part or group in **Lanes of** (or in the **Parts** tab) to see and add the keys that move just that part, and to
place its pivot: type x and y, or press **Pick on stage** and click where the part should turn. The stage dims the
other parts so the chosen one stands out, and an animation that keys only parts opens at the first of them. Nothing is written until
**Apply**, which puts the changes into the rig.json tab in one undo step: only the values the studio edits are rewritten
(`animations`, `pivots`, `idle`, `speak` and `blink`), the rest of the file keeps its layout. Like any edit
in the editor it is saved to disk a moment later.

The **Parts** tab shows what the character is made of, top layer first, as the PSD has it:

- each **slot** with a thumbnail of every variant (`*` marks the default). Click a variant to dress the stage with it (click
  it again to go back to what the pose picks), or `none` to hide the slot. The dress is only for looking and is not saved;
- each **layer** (a plain image that is always drawn) with its thumbnail;
- the rig.json **groups** with their parts, and a mark on every part or group the current animation keys;
- the **poses** `show` takes: rig.json shorthands and the pose tags on PSD variants, each with the variants it picks. Click
  one to dress the stage in it.

Click a row to choose that part, like **Lanes of**. Under the tree:

- **Same pivot for…** lists the other parts as checkboxes: tick one to give it the pivot of the chosen part
  (a head of several parts turns about one point), untick it to remove that part's pivot.

The other tabs:

- **By itself** sets `idle`, `speak` (animation, mouth slot, variants, rate) and `blink` (slot, variant, interval, duration). Empty fields use the defaults; keys it does not know are kept.
- **Place** shows where the character would stand in a scene. Press **Place on stage** and drag the character, or type x, y,
  scale and flip; the line below is the `show` command for it (`show mina at 0.35 y=0.02 scale=1.1`). **Copy** it into the script.

A channel is eased between its own keys, so keys that name different channels overlap freely: one channel can sway
while another bounces. Every channel is 0 at `t=0` and `t=1` unless a key there says otherwise, which makes loops
repeat without a jump. `strength=` on `animate` scales all of it. An animation named like a preset (`bob`,
`nod`...) replaces that preset for this character, including `hop` and `shake`.
