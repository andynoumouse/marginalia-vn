# Rainy Day Library

A visual novel made with Marginalia VN Engine, and a tour of what the engine can do.

```
npm install        # once: links the engine (file: dependency, so engine updates apply immediately)
npm run dev        # editor + live preview: http://localhost:5173/editor/
npm run export     # web build in build/web
npm run art        # convert masters/*.psd to assets/ (npm run dev does this on save)
npm run ids        # add localization ids to new lines
npm run strings    # write locale/en.json
```

Content: script/ (scenes), game.json (title screen, menus, theme, gallery), locale/ (translations),
masters/ (layered PSDs: bg/, char/, ui/), assets/ (game-ready art and audio: bg/, char/, music/, sound/, fonts/).
See the engine README for the script language and the art pipeline.

## The feature index

New game opens the feature index (`script/index.vn`): seven pages (Stage, Effects, Text, Audio, Logic, Screens, Rigs) of
cards, one for each group of script commands. A card is a small playground. The stage is on the left and a panel is on the
right: pick an option, press Fire, watch the effect, change the option and fire it again. The panel shows the script
line that ran, so you can copy it. Back (or Esc) leaves the card.

Two buttons at the bottom of the index lead out of it: **Take the guided tour** plays the story of Iris and the rain
(`script/start.vn`) and **Explore the library** opens the map of rooms (`script/rooms.vn`). There is no button back. To
return to the index, press Esc and choose Leave the library, then New game, or pick "Feature index" in Chapters.

### Adding a card

A screen never runs script, so a card is a loop: show the panel, run a command when it answers "fire", show it again.
It takes two labels in an `fx_*.vn` script:

```
label fx_blink:                      # the setup, which runs on into the loop
  scene bg_reading_room fade 0.4s
  call fx_open("Blink", "A quick flash of colour over the scene.")
  set fx_a_label = "Colour"
  set fx_a1 = "White"
  set fx_a2 = "Red"

label fx_blink_loop:
  show screen fx_panel(fx_pa, fx_pb) as act
  if act == "fire":
    if fx_pa == 1:
      set fx_fired = "flash #ffffff 0.2s"
      flash #ffffff 0.2s
    else:
      set fx_fired = "flash #ff3030 0.2s"
      flash #ff3030 0.2s
    jump fx_blink_loop
  elif act == "reset":
    set fx_fired = "nothing yet"
    jump fx_blink_loop
  return                             # Back or Esc
```

The panel reads these variables, which `fx_open` clears:

- `fx_a_label` and `fx_a1` to `fx_a8`: row A, up to eight radio options in two columns; `fx_pa` is the chosen one (1, 2, ...).
- `fx_b_label` and `fx_b1` to `fx_b3`: row B, up to three options; `fx_pb` is the chosen one.
- `fx_fired`: the "Last fired" text. Set it to the command just before running it and keep the two the same.

Then wire the card into the index: a `button <id>` in the grid of its page in `screen feature_index` (a grid holds
twelve cards) and an `elif card == "<id>":` branch in `label index_loop` that does `call fx_<id>` and `call fx_close`.
`fx_close` switches off what a card may have left on (the letterbox, and through its `scene` the filter, tint, weather and camera), so a card does not need to. A card that needs a screen of its own,
such as a map, shows it in place of `fx_panel` (see `script/fx_screens.vn`). Run `npm run ids` and `npm run strings` after.

Nothing in the tour or the library may lead back to the index. The playtest bot (the editor's Playtest) tells situations
apart by their variables, and a way back from there multiplies every state of the tour by every state of the index until
the bot gives up.

The settings screen is a small example of its own: the map's "Reading preferences" button opens `script/settings.vn`, a
screen with a tab, a toggle, a radio group and two `inout` parameters (Done keeps the changes, Backspace or the pad B
button discards them).
