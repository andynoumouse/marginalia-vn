# Coming from Ren'Py

Marginalia VN Engine's script language borrows Ren'Py's shape: labels, `jump` and `call`, characters, menus, a
line of dialogue per line of text. If you have written Ren'Py, most of your habits carry over. This page lists the
differences that bite first, and what has no equivalent yet.

## Side by side

| Ren'Py | Marginalia | Notes |
|---|---|---|
| `define e = Character("Eileen", color="#c8ffc8")` | `define e "Eileen" color=#c8ffc8` | Options are `key=value` words. |
| `label start:` | `label start:` | Labels are global across all files. |
| `scene bg park` | `scene bg_park` | Names are file names under `assets/bg/`, without the extension. |
| `scene bg park with dissolve` | `scene bg_park dissolve 1.0s` | The transition and its seconds go on the same line. |
| `show eileen happy at left` | `show e happy at left` | The first word after the character is a pose or look. |
| `show eileen happy with dissolve` | `show e happy fade 0.3s` | |
| `hide eileen` | `hide e fade 0.3s` | |
| `e "Hello."` | `e: Hello.` | The text is not quoted. A bare `"text"` is narration. |
| `"Narration."` | `"Narration."` | |
| `menu:` with `"Choice":` | `menu:` with `"Choice":` | Options may have a prompt line: `menu "Prompt":`. |
| `"Option" if x > 1:` | `"Option" if x > 1:` | A disabled version: `"Option" if x > 1 else "Why not":`. |
| `$ x = 1` / `$ x += 1` | `set x = 1` / `set x += 1` | Expressions, not Python (below). |
| `default x = 0` | `set x = 0` at the top level of a file | Top-level lines run once before the story starts. |
| `if x:` / `elif` / `else` | `if x:` / `elif` / `else` | |
| `jump label` | `jump label` | |
| `call label` / `return` | `call label` / `return` | Labels can take parameters: `call buy("sword", 10)`. |
| `renpy.input(...)` or `$ n = renpy.input("Name?")` | `input n "Name?" default="Alex" max=16` | |
| `play music "x.ogg"` | `music play x loop` | Tracks are in `assets/music/`; `loop` is explicit. |
| `play sound "x.ogg"` | `sound play x` | `sound loop`, `sound stop` for ambience. |
| `pause 1.0` | `wait 1.0s` | |
| `with hpunch` / `vpunch` | `shake 0.3s` | |
| `persistent.x = 1` | `set persistent.x = 1` | Same name, a `set` statement. |
| `{w=0.5}` / `{i}` / `{b}` | `{pause=0.5s}` / `{i}` / `{b}` | [Text tags](../../commands.md#text-tags). |
| `[name]` interpolation | `[name]` | Number formats: `[n:2]`, plurals `[n:coin\|coins]`. |
| `renpy.random.randint(1, 6)` | `random(1, 6)` | Also `pick(...)` and `chance(25)`, seeded and replayed by rollback. |
| `image eileen happy = "..."` | a file at `assets/char/eileen/happy.png` | No `image` declarations; the folder is the declaration. |
| Screen language (`screen x():`) | `screen x:` blocks | Similar ideas (buttons, hotspots, loops); see [screens](c-screens.md). |
| Translations (`tl/` files, `_()`) | `locale/<lang>.json` with ids | [Localization](e-localization-and-voice.md). |
| `config.save_directory`, build | `game.json`, the Build dialog | |

## The differences that matter

- **The editor is the main tool.** There is no launcher and no separate text editor to configure: you write in the
  built-in editor, and saving reloads the game on the line you were on. Ctrl+Enter starts from the cursor, which
  replaces most uses of Ren'Py's `jump` shortcuts and developer console.
- **Names come from files.** `assets/bg/bg_park.png` is `bg_park`. Renaming a file with F2 rewrites the scripts that
  use it.
- **Indentation is spaces.** Tabs are an error.
- **No Python.** Expressions cover numbers, strings, lists, comparisons, `and`/`or`/`not` and a few functions. Anything you
  would write in a `python:` block has to be a script statement, a screen, or an addition to the engine.
- **Choices are remembered.** Rollback replays from choices, input and the random seed, so branches are repeatable.
- **Localization ids are in the script.** `npm run ids` appends `#ab12` to each line; do not renumber them.

## What has no equivalent yet

- **`python:` blocks, `init python`, and Python classes.** The most common reason a Ren'Py game cannot be ported as-is.
- **Most of ATL.** A [`transform`](../../commands.md#transform) block is a named sequence of tweens, waits and
  `repeat`, with `parallel:` and `choice:` blocks, played with `animate`, on a character or a picture. Marginalia has no
  events (`on show`) or per-frame transform language, and a transform's values are relative to where the sprite stands.
- **Layered images by attribute** (`layeredimage`). The nearest thing is a layered PSD character with slots and
  looks: [layered characters](d-layered-characters.md).
- **Ren'Py's ecosystem of add-ons.** Systems such as a phone UI, a battle system or a map are built from
  [screens](c-screens.md).

## Moving a project over

There is no importer. The practical route is to start a project from the nearest [template](a-templates.md), move
your art and audio into `assets/` using the names above, and port the script a scene at a time, running the
[playtest bot](g-testing.md) after each scene to catch dead ends. Keep the Ren'Py script open next to it: most lines change
in small, mechanical ways.
