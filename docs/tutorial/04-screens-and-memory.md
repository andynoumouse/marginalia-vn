# 4. Screens and memory

## A clickable map

A `screen` is a page of clickable things, declared once. `show screen` waits and stores the id of what was chosen:

```
screen library_map:
  image "bg/bg_library.png" size 1920,1080
  hotspot stacks at 160,300 size 420,380 "The stacks" hover tint rgba(255,220,120,.30)
  hotspot desk ellipse at 800,640 size 460,220 "The front desk" hover scale 1.06
  button leave at 80,940 "Find a seat"
  default stacks

label hub:
  show screen library_map
  if screen == "stacks":
    jump stacks
```

Coordinates are stage pixels (1920x1080, origin top left). A screen never runs script itself: the story branches on the
answer and loops back to the screen for more.

## A HUD

```
screen status:
  text at 40,30 "Pages: [pages]"
  button peek at 1620,30 size 260,80 "Bag" on click look_in_bag

hud on status keep
```

The HUD stays up while the story runs. Clicking `Bag` runs the label `look_in_bag`; its `return` goes back to the line that
was interrupted.

## Subroutines with parameters

```
label borrow(book):
  if contains(bag, book):
    iris: You already have the [book].
    return
  set bag += book
  return

call borrow("novel")
```

Parameters are local to the call, and `return` restores any variable they hid.

## Timed and disabled choices

```
menu "The lights flicker!" timeout 8:
  "Open the box" if archive_open == 1 else "You need the brass key.":
    unlock lamp_room
  "Hold the lamp steady":
    iris: Thank you.
  on timeout:
    iris: Too slow! The lamp went out.
```

An option with `else "reason"` is shown greyed out instead of hidden. Players can extend or remove the clock in Options, so
the story must work for all three settings.

## Things that outlive a playthrough

```
unlock lamp_room                   # a flag; read it as unlocked.lamp_room
set persistent.secrets += 1        # a counter across all playthroughs
if unlocked.explorer:
  iris: You're back!
```

In `game.json`, `"gallery": [{ "image": "bg_reading_room", "title": "The lamp room", "unlock": "lamp_room" }]` shows
the image in the gallery once the flag is set, and `"chapters"` lists labels the player can start from on the title screen.

You now have the main ideas. The details of every command are in [../commands.md](../commands.md).
