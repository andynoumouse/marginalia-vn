# 1. Your first scene

## Project layout

```
demo/
  game.json      title screen, menus, theme, gallery, chapters, achievements
  script/        the story, in .vn files
  assets/        bg/, char/<name>/, music/, sound/ (ready to use)
  masters/       layered PSDs; `npm run art` converts them into assets/
  locale/        translations (en.json is written by `npm run strings`)
  build/         web and desktop builds, made by the editor's Build button
```

All files in `script/` are compiled together. The story starts at the label `start`.

## Characters

At the top of `script/start.vn`, characters are declared once:

```
define narrator "" text=#d8d2c0
define iris "Iris" color=#7cc4ff blip=mid
define you "You" color=#ffd27c
```

`color` tints the name tag, `text` the words, and `blip` is the typing sound. `narrator` styles quoted narration lines.

## A scene

```
label start:
  scene bg_library fade 0.8
  music play evening_theme loop fade 2
  sound loop rain fade 2
  weather rain 0.5 2

  "Rain had been falling since morning, and the only open door on the street was the library's."

  show iris neutral at center fade 0.4
  iris: Oh. A visitor. {pause=0.4}We close in an hour, but the rain doesn't seem to mind.
  you: I was hoping to wait it out.
```

- `scene <background>` replaces the backdrop. The name is the file in `assets/bg/` without its extension.
  Transitions: `cut`, `fade`, `dissolve`, `wipe`, `iris`, `blinds`, `pixelate`.
- `show <character> <pose> at <place>` puts a sprite on stage (`assets/char/iris/neutral.png`). `left`, `center`, `right`
  or a number from 0 to 1 work as places.
- A bare quoted line is narration. `name: text` is spoken. `{pause=0.4}` pauses typing.

Anything you leave out is drawn as a placeholder, so you can write the story before the art exists.

## Try it

Change Iris's first line, save, and watch the preview jump back to it. Put the cursor on any line and press Ctrl+Enter
(Preview from cursor) to start from there. After adding lines, run `npm run ids` (or **Add Localization IDs to All
Files** in the Ctrl+P palette), which gives them ids like `#hg4r` for translation. The demo's scripts show these ids;
the snippets in this tutorial leave them out.

Next: [choices and variables](02-choices-and-variables.md).
