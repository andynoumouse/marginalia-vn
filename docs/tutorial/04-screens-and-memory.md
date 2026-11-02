# 4. Screens and memory

## A clickable map

A `screen` is a page of clickable things, declared once. `show screen` waits and stores the id of what was chosen:

```
screen library_map:
  image "bg/bg_library.png" size 1920,1080
  hotspot stacks at 160,300 size 420,380 "The stacks" hover tint rgba(255,220,120,.30)
  hotspot desk ellipse at 800,640 size 460,220 "The front desk" hover scale 1.06
  button leave at 80,940 "Find a seat" hover scale 1.08
  default stacks

label hub:
  show screen library_map
  if screen == "stacks":
    jump stacks
```

Coordinates are stage pixels (1920x1080, origin top left). A screen never runs script itself: the story branches on the
answer and loops back to the screen for more.

Hotspots can also be polygons, and screens can lay things out for you. The card catalogue in `catalogue.vn` is a
scrolling grid with one button per list entry:

```
hotspot catalogue poly 680,220 1180,200 1220,480 660,500 "The card catalogue" hover tint rgba(200,255,160,.30)

screen catalogue:
  scroll at 80,150 size 1140,620:
    grid 2 cell 540,100 gap 20:
      each shelf as entry:
        button entry size 540,100 "[entry.name]"
  row anchor bottomright margin 40 gap 20:
    button back "Back to the map"
```

`show screen catalogue as card` stores the answer in `card` instead of `screen`.

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
menu "Iris eyes the door. A dusty box sits on the shelf, and the lights flicker!" timeout 8:
  "Open the box" if archive_open == 1 else "You need the brass key.":
    iris: It's a stack of rain-stained postcards. {pause=0.4}Take one.
    ...
    unlock lamp_room
    set persistent.secrets += 1
  "Hold the lamp steady":
    iris: Thank you. The light steadies.
  on timeout:
    flash #000000 0.4
    iris: Too slow! The lamp went out. {pause=0.4}Never mind, it comes back.
```

An option with `else "reason"` is shown greyed out instead of hidden. Players can extend or remove the clock in Options, so
the story must work for all three settings.

## Things that outlive a playthrough

```
unlock lamp_room                   # a flag; read it as unlocked.lamp_room
set persistent.secrets += 1        # a counter across all playthroughs
if unlocked.explorer:
  iris: You're back! You've explored every corner before, so take your time.
```

In `game.json`, `"gallery": [{ "image": "bg_reading_room", "title": "The lamp room", "unlock": "lamp_room" }]` shows
the image in the gallery once the flag is set, and `"chapters"` lists labels the player can start from on the title screen.

## Endings and achievements

A flag listed under `"achievements"` in `game.json` pops up a notice when it is unlocked and appears on the
Achievements screen. The demo has two endings, chosen in `window_seat` (`start.vn`):

```
if contains(bag, "novel"):
  "You opened the rain novel and did not look up again until Iris turned the lamps off."
  unlock ending_book
else:
  "The rain kept falling. For once, nobody was in a hurry."
  unlock ending_rain
```

```json
{
  "unlock": "ending_book",
  "title": "Closing time",
  "description": "Lose track of time in a borrowed book.",
  "ending": true
}
```

`"ending": true` counts it as an ending, and `"hidden": true` keeps its title secret until it is unlocked. Add
`"achievements"` to the title screen's `buttons` to give players a way in.

## Your own menus

A screen named after a built-in one replaces it. `menus.vn` restyles the pause menu, and each button runs one of the
game's own actions instead of answering the screen:

```
screen pause:
  column anchor center gap 16 align center:
    text "{b}Bookmark{/b}"
    button resume size 440,90 "Back to reading" action resume hover scale 1.06
    button save size 440,90 "Save" action save hover scale 1.06
    ...
    button leave size 440,90 "Leave the library" action title hover scale 1.06
```

In the editor's Files panel, **Customize** next to a built-in screen writes such a starter for you.

You now have the main ideas. The details of every command are in [../commands.md](../commands.md).
