# Templates

A new project does not have to start empty. **New project** in Marginalia Studio, `vn init --template <id>` and the
online demo's template select all offer the same starting points. Each one is a small, working game in one style: it
plays to an ending, so you can run it, then change it into your own.

| Template | `--template` | What you get |
|---|---|---|
| Blank | `blank` (the default) | a title screen and one scene |
| Classic ADV | `classic-adv` | text box at the bottom, the speaker in focus, a quick menu, music, a camera zoom, a choice that sets a variable, two endings |
| Portrait (phone) | `portrait` | a 1080 x 1920 stage, larger text, a short quick menu |
| Kinetic novel (NVL) | `kinetic-nvl` | full-screen pages, no choices, lines that go on by themselves, looping rain with thunder and page-turn sounds |
| Branching story / dating sim | `branching` | affection variables with a status HUD, chapters, three endings as achievements and gallery pictures, a play counter |
| Mystery / adventure | `mystery` | a room with clickable hotspots, an inventory list and a locked door you open by using an item on it |

```bash
vn init ../MyGame --title "My Game" --template branching
```

## Choosing

- Pick the style closest to your story; the differences are mostly in `game.json` and the first script, so switching
  later is a matter of copying the options you want from [game.json](../../game-json.md).
- `--stage 1080x1920` makes Blank, Classic ADV and Kinetic novel portrait, not only Portrait. Branching and Mystery place
  their HUD and clickable areas in landscape pixels, so they refuse a portrait stage.
- A template brings placeholder title backgrounds and a few sounds. They are there to run the game: replace them under
  `assets/`.
- The first script has no string ids yet. Add them with `npm run ids` (or the editor's palette) before you translate the game.
- Classic ADV and Branching show flat silhouette sprites (`assets/char/mina/neutral.png`, `ren`) so the speaker focus
  has something to work on. Paint your own over them with the same file names, or add poses beside them and `show` those.

## One change to try in each

The fastest way to learn a template is to bend it. Each change below is small and uses what the template already has.
The first line of a block says where it goes: *replace label x* means delete that label from `script/start.vn` and
paste the block in its place, *add* means paste it at the end of the file (the first line is only a comment). Every
change is tested against its template.

### Classic ADV: a warmer ending

The ending uses a colour wash, a flash and a second pose. Paint `assets/char/mina/smile.png` for the pose; until then it
is a placeholder.

```vn
# template classic-adv: replace label warm_ending
label warm_ending:
  music stop fade 2s
  tint #402010 0.3 1.5s
  show mina smile at center
  flash #fff2c8 0.5s
  mina: Thank you for coming.
  "She smiles, and the evening feels a little warmer."
  end
```

`tint`, `flash`, `camera` and the other effects are in [staging and effects](b-staging.md).

### Branching: a route that remembers

Endings you have already seen can change the next playthrough. `unlocked.<flag>` reads the flags the template's
`unlock` lines store, so a hidden route opens only after the player has seen both main endings. Replace `route` and add
the new ending:

```vn
# template branching: replace label route
label route:
  if unlocked.mina_end and unlocked.ren_end:
    jump true_end
  if love_mina >= 2:
    jump mina_end
  elif love_ren >= 2:
    jump ren_end
  elif love_mina + love_ren == 0:
    jump alone_end
  else:
    jump friends_end
```

```vn
# template branching: add
label true_end:
  "You remember both of them. This time you ask them to walk with you together."
  end
```

Give it a title and a flag of its own (`unlock true_end`, plus an entry in `game.json`'s `achievements`) when you want it
in the Achievements screen. The playtest bot carries flags from one playthrough to the next, so it finds the hidden
route too.

### Mystery: a third clue

A new place to search is three small edits: a hotspot in the screen, a branch in `explore`, and a label that gives the
item. `define item` names the new item; give it a picture with `image=` when you have one (the letter's picture stands
in here).

```vn
# template mystery: replace screen room
screen room:
  textbox off
  text at 60,40 "You carry: [bag]"
  hotspot desk at 300,520 size 460,260 "The desk" hover tint rgba(255,220,120,.30)
  hotspot window ellipse at 1050,180 size 360,420 "The window" hover tint rgba(120,200,255,.30)
  hotspot door at 1480,380 size 320,580 "The locked door" hover tint rgba(200,255,160,.30)
  hotspot shelf at 80,260 size 200,500 "The bookshelf" hover tint rgba(255,160,120,.30)
  button bag at 60,960 "Bag"
```

```vn
# template mystery: replace label explore
label explore:
  show screen room as spot
  if spot == "desk":
    jump desk
  elif spot == "window":
    jump window
  elif spot == "shelf":
    jump shelf
  elif spot == "bag":
    jump bag_screen
  else:
    jump door
```

```vn
# template mystery: add
define item book "Red book" image=ui/letter.png

label shelf:
  if contains(bag, "book"):
    "Nothing else on the shelves."
  else:
    "A red book sticks out. A page is marked: 'Hide the key where the rain cannot reach.'"
    set bag += "book"
  jump explore
```

Move the hotspot to match your own room picture: coordinates are stage pixels. More screens are in
[screens and systems](c-screens.md).

### Kinetic novel: pacing

`{nw}` at the end of a line goes on by itself once the text has shown; a line without it waits for a click. Add a beat
with `{pause=}` inside a line, and let the picture change under the text with `tint`:

```vn
# template kinetic-nvl: replace label start
label start:
  scene bg_title fade 0.5s
  nvl on
  sound loop rain fade 2s
  "The rain had not stopped for three days.{nw}"
  "Even the crows had gone quiet.{nw}"
  sound play thunder duck
  "Then, somewhere below, a bell rang."
  sound play page_flip1
  nvl clear
  tint #203060 0.4 2s
  "The bell rang again.{pause=1.0s} Then again.{nw}"
  hero: Did you hear that?
  "Nobody answered. Edit script/start.vn to continue the story."
  sound stop fade 2s
  end
```

### Portrait: a character that fits the screen

On a 1080 x 1920 stage a character stands tall. Scale it up to fill the height, and keep choices short: the stage is
narrow.

```vn
# template portrait: replace label start
label start:
  scene bg_title fade 0.5s
  "The story begins."
  show hero neutral at center scale=1.2 fade 0.3s
  hero: Hello! The phone is held upright, so the character stands tall and the text is large.
  menu "What now?":
    "Wave":
      hero: Hello again.
    "Walk away":
      hide hero fade 0.3s
  end
```

Text size comes from the theme (`components.text.size` and `tokens.uiSize` in `themes/default.json`); see
[look and feel](../../look-and-feel.md).

### Blank

Nothing to change: it is a title screen and a scene. Start with [page 1](../01-first-scene.md) and add what you need.
