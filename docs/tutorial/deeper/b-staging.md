# Staging and effects

Directing a scene: moving characters, the camera, weather, sound and text effects. The snippets come from the demo
game "Rainy Day Library" (`games/demo/`; in a clone of the engine run `npm run dev -- --project games/demo`): the tour in
`start.vn`, the stacks room in `rooms.vn` and the listening corner in `catalogue.vn` use these. You can paste any of
them into The Last Train as well. The demo opens on a feature index (New game), whose Stage, Effects, Text and Audio
pages have a card for each command below: fire it, change it and fire it again.

## Moving characters

```
move iris to left 0.6 ease=out
hop iris 0.25
shake iris 0.3 strength=6
animate iris breathe loop
animate iris stop
```

`move` slides to a place over the given seconds (`ease`: linear, in, out, inout, back, bounce, elastic; add `nowait` to
carry on while it moves). `animate` plays presets such as `breathe`, `nod` and `bounce`, or animations from a character's
`rig.json`. With `loop` it repeats until `stop`.

Places other than `left`, `center` and `right` can be named in `game.json`. The demo adds two:

```
"positions": {
  "farleft": 0.12,
  "farright": 0.88
}
```

so the card catalogue can say `show iris smile at farright fade 0.3`.

## Your own animations

When the presets are not quite it, write a `transform`: a short, named sequence of steps that you play with `animate`, on a
character or on a picture shown with `image show`. (These snippets are not in the demo; paste them into any script.)

```
transform nervous:
    rot=-2 0.15
    rot=2 0.3
    rot=0 0.15

transform arrive:
    parallel:
        x=0.1 0.6 ease=out
    parallel:
        alpha=0.4 0.2
        alpha=1 0.4
    hop 0.25

animate iris nervous
animate iris arrive
```

Every value is relative to where the sprite stands, so the same transform works for anyone anywhere: `x=` and `y=` shift,
`scale=1.1` is ten percent bigger, `rot=` is degrees and `alpha=` fades. `wait 0.3` holds, a preset name (`hop`, `nod`) plays
that preset, `parallel:` blocks run together, and `repeat` at the end plays the steps again (alone, it loops forever).

A transform can also react to the story. Give it parameters and conditions, or let it run by itself:

```
transform react(strength=1):
    if trust > 2:
        y=-0.03*strength 0.2 ease=out
        y=0 0.3 ease=bounce
    else:
        rot=-3*strength 0.15
        rot=0 0.15

transform glance every 4..9 while trust > 0:
    rot=4 0.15
    rot=0 0.25

animate iris react(2)       # once, worked out from `trust` right now
animate iris glance auto    # now and then, as long as trust is above 0
animate iris glance auto off
```

The full list of steps is in the [command reference](../../commands.md#transform).

## The whole scene

```
tint #402010 0.3 1.5       # colour wash, strength, fade-in seconds
filter sepia 0.8 1         # blur, grayscale, sepia, night, vignette
camera zoom 1.6 at center y=0.35 1.2 ease=out
camera pan right 1
camera reset 0.8
flash #ffffff 0.5
weather rain 0.8 2         # rain, snow, petals, embers
weather off 2
```

Tint, filter, camera and weather last until you switch them off or the next `scene`.

```
image show postcard bg/cg_window_seat at 960,500 anchor=center scale=0.35 fade 0.4
image hide postcard fade 0.4
```

`image show` puts a picture over the scene; `image hide` removes it.

## Sound

```
music play evening_theme loop fade 2
sound loop rain fade 2
sound play page_flip1
sound stop rain fade 3
music stop fade 3
```

Music and looping ambience have their own channels. Files come from `assets/music/` and `assets/sound/`. The
listening corner in `catalogue.vn` goes further:

```
sound play page_flip1 duck
music pause
music resume
```

`duck` dips the music while the sound plays, and `music pause` / `music resume` hold the track where it is.

## Text effects

```
iris: Welcome to the stacks. Text can be {i}italic{/i}, {b}bold{/b}, {color=#ff9f7c}coloured{/color}, {size=1.4}big{/size}, {wave}wavy{/wave} or {shake}nervous{/shake}.
iris: It can wait for a click{wait} in the middle of a line, and move on by itself.{nw}
```

`{ruby=shizuka}静か{/ruby}` puts a small reading above the text (the listening corner uses it).

`nvl on` / `nvl clear` / `nvl off` switch to full-screen narration pages (the notice board in `rooms.vn`).

Next: [screens and systems](c-screens.md).
