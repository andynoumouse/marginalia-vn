# 3. Staging and effects

The tour in `start.vn` and the stacks room in `rooms.vn` use these.

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

Music and looping ambience have their own channels. Files come from `assets/music/` and `assets/sound/`.

## Text effects

```
iris: Text can be {i}italic{/i}, {b}bold{/b}, {color=#ff9f7c}coloured{/color}, {size=1.4}big{/size}, {wave}wavy{/wave}.
iris: It can wait for a click{wait} in the middle, and move on by itself.{nw}
```

`nvl on` / `nvl clear` / `nvl off` switch to full-screen narration pages (the notice board in `rooms.vn`).

Next: [screens and memory](04-screens-and-memory.md).
