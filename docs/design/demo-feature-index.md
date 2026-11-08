# The demo's feature index

The demo game ("Rainy Day Library", `games/demo/`) used to show the engine only as a story. To see what `filter glitch` or
`burst confetti` looks like, a visitor had to find the right room and sit through it, and much of the engine was not shown
at all. New game now opens a **feature index** instead: seven pages (Stage, Effects, Text, Audio, Logic, Screens, Rigs, named
like the groups in [commands.md](../commands.md)) with 39 cards. The guided tour (`start.vn`, `label tour_start`) and the
library map (`rooms.vn`, `label hub`) are two buttons at the bottom of the index. It is game content only: scripts and
`game.json`, no engine change. How to add a card is in `games/demo/README.md`.

## A card is a playground

One click opens a stage on the left and a panel on the right (`fx_panel`, 560 px wide so the stage stays in view). The
panel names the effect, offers up to eight options in row A and three in row B, and has Fire, Reset and Back. Fire runs the
command, and the panel shows the script line that ran ("Last fired"). Change an option and fire again.

A screen never runs script, so a card is a loop: `show screen fx_panel(fx_pa, fx_pb) as act`, then on `fire` run the
command and show the screen again. Each card is two labels, `fx_<id>` (set the stage up, fill the panel's variables) and
`fx_<id>_loop`, which ends in a `return`. The index calls the first and then `fx_close`. Four of the five Screens cards have
a screen of their own on the left instead of a stage (the map, the scrolling grid, the reading preferences, the bars), with
a title, a blurb and Back on the right.

**Stepping on after a fire.** On cards whose options are toggles (left / right, show / hide, front / back), a fire ends
with `call fx_step_a(n)` or `fx_step_b(n)` (`index.vn`), which moves that row's radio to the next option (wrapping), so the
next Fire shows something new instead of repeating itself. Cards where firing the same thing again is still worth seeing
(strength, speed, looks) keep the choice.

**Ladders of literal commands.** The arguments of commands such as `shake`, `filter` and `weather` are literals, so a choice
in the panel is an `if` / `elif` ladder of real lines, two to eight options, never a slider. The text shown as fired is
written right above the command it shows; `engine/test/demo-index.test.mjs` checks that the two stay the same.

**Showing a tag.** A tag inside a variable is obeyed when the panel shows it, so the Text cards could not display `{i}`. In
those strings every opening brace is followed by a zero-width space, which makes the panel print the tag as written.

## Why the page buttons are plain buttons

A `tab` would keep the page in the screen's own state, as `settings.vn` does. But the playtest bot does not follow a `tab`,
so every card on another page would be reported as unreachable. The page buttons (`go_stage` ...) answer the screen like a
card does; the loop sets `index_page` and shows the screen again, and the underlines and grids read `index_page`.

## What the playtest bot needs

The bot tells situations apart by their variables and gives up on a place with more than 500 of them. Playing the whole
demo takes it about 3 s with one seed (the test), 12 s with the editor's four. Three rules keep it there:

- Every card leaves the story in the same state. `fx_open` clears the panel's variables and the ones cards keep for
  themselves, `fx_close` calls it once more, and a card with a counter keeps it in a few values (the bars card clamps both).
- The index puts `index_page` back to `"stage"` before it jumps to the tour or the library, so those places do not
  multiply their states by the seven pages.
- Nothing in the tour or the library leads back to the index. A way back multiplied every state of the tour by every state
  of the index and the bot stopped with "more than 500 different situations". The way home is Esc, Leave the library,
  New game, or Chapters.

## Leaving a card

`fx_close` runs when a card returns: `filter off`, `tint off`, `weather off`, `gravity reset`, `camera reset`,
`animate camera stop`, `focus on`, `nvl off` and `hud off fx_coins_hud`, then a fade back to the library backdrop. It turns
effects off by name because `scene` does not clear everything: a running `glitch` filter survived a `scene` in the preview.
A HUD ignores clicks while a blocking screen is up, so the HUD card puts its HUD up and has Iris say a line to click against.

## Left out

Cards that need assets the demo does not have (voice lines, `movie`, wind and physics on a character, side images), a
"tried" tick per card, and links from the docs into a card of the hosted demo are listed in [TODO.md](../../TODO.md).
