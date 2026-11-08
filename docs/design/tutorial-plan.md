# Tutorial plan (draft)

The current tutorial (`docs/tutorial/`) is organised by feature and walks through the demo game. It is to be
rewritten from scratch, organised by what the reader wants to finish. This is the outline for that rewrite.

## Principles

- **Outcome first.** Every page ends with something the reader has made or can see: a running scene, a branching
  story, a build they can send to a friend.
- **One short main path, then pick-and-mix.** "Start here" (pages 1-5) takes a newcomer from nothing to a shipped game
  and is read in order. "Go deeper" pages are independent and can be read in any order.
- **One small tutorial game for the main path.** A 2-3 scene story the reader builds across pages 2-5 (working title
  "The Last Train"). It lives in its own folder (`games/tutorial/`), with a finished copy per page so any page can be
  started from its checkpoint. The demo (`games/demo/`) stays the showcase used by "Go deeper".
- **No install in the first ten minutes.** Page 1 starts in Marginalia Studio or the online demo. `npm` is the
  alternative, not the default.
- **Placeholders are a feature.** The story is written before the art exists; art is swapped in on page 4.
- **Every snippet is tested.** Snippets are extracted from the tutorial game's scripts (as today from the demo), and a
  test compiles each checkpoint, so the pages cannot drift from the engine again.
- **Public voice.** Pages speak to readers, with no notes-to-Claude phrasing and no commit hashes.

## Start here

### 1. Your first scene (about 10 minutes)

Goal: change a running game and see it change.

- Open Marginalia Studio and choose New project > Classic ADV (or the online demo's template select). `npm` route in a
  boxed aside: `vn init`, `npm install`, `npm run dev`.
- The editor in four parts: script left, game right, Files panel, status line.
- Edit a line, save, the game reloads on that line. Ctrl+Enter plays from the cursor.
- Problem markers and the "did you mean" quick fix (Ctrl+.). F1 for help on the line.
- Ctrl+P: files, `@` labels, `#` assets.
- Ends with: the reader has changed a line of dialogue and a background by name.

### 2. A story with choices (about 20 minutes)

Goal: a branching scene with consequences.

- `define` a character, `label`, `scene`, `show`, dialogue and narration.
- `menu`, `set`, `if`, `jump`; a variable shown in text with `[name]`.
- The Variables panel (edit a value to reach a branch); Ctrl+Enter to test just the new branch.
- The Outline flowchart: see the shape of the story, spot an unreachable label.
- `npm run playtest` / the palette's playtest command: the bot plays every route and reports dead ends.
- Ends with: "The Last Train" has two endings and passes the playtest.

### 3. Your own art and sound (about 20 minutes)

Goal: replace placeholders with real files.

- What a placeholder is, and why the story ran without art.
- Drag a background and a character image into the Files panel; naming rules (`assets/bg/`, `assets/char/<name>/<pose>.png`).
- Music and sound: `music play`, `sound`, looping and fades.
- Rename an asset with F2 and watch the scripts follow.
- Aside: layered PSDs are covered in "Go deeper: Layered characters".
- Ends with: the story plays with the reader's own pictures.

### 4. Make it feel like a game (about 20 minutes)

Goal: title screen, menus, endings.

- `game.json`: title, title background, menu entries, theme basics.
- Endings as achievements and gallery entries; chapters.
- Saves, rollback, history, skip/auto: what the player gets for free.
- Checking the game on a phone: touch play works with no setup (aside on `touch` in `game.json`).
- Ends with: the game has a title screen, two achievements and a gallery.

### 5. Ship it (about 10 minutes)

Goal: a game someone else can play.

- Build dialog: the pre-build checks and how to read them.
- Web build: what is in `build/web`, where to host it (a static host, itch.io).
- Desktop build: the zip with the exe (Studio) and what it contains.
- Saves and the game id (why not to change it after release).
- Ends with: a link or a zip to send.

## Go deeper

Independent pages; each starts from a checkpoint of the tutorial game or from the demo.

### A. Choosing a template

Pick a genre and bend it. One worked change per template, in place of the current table:

- Branching / dating sim: add a character and an affection variable that unlocks a scene.
- Mystery / adventure: add a hotspot and an item that opens a new room.
- Kinetic novel: pacing, auto-advance and page breaks.
- Portrait (phone): stage size, larger text, touch targets.

### B. Staging and effects

`move`, `hop`, `shake`, named positions, `tint`, `filter`, `camera`, `flash`, weather, text tags, audio ducking.
Today's page 3, regrouped around "directing a scene" with before/after pictures.

### C. Screens and systems

Clickable map, HUD, inventory, timed and disabled choices, `call` with parameters, persistent values, a custom pause
menu. Today's page 4, split into three or four short recipes ("a map", "a stat HUD", "an inventory", "your own menus")
instead of one long page.

### D. Layered characters

PSD layout, `npm run art`, `rig.json`, `show` with looks and slot overrides, then the animation studio: Model and
Animate modes, automatic animations and reactions, `animate` in the script, exporting a movie.
Needs real layered art in a checkpoint first (the demo's art is placeholder shapes).

### E. Localization and voice

String ids (`npm run ids`), `npm run strings`, the Translate panel, adding a language, voice lines per language.

### F. Coming from Ren'Py

Side by side: common Ren'Py statements and their Marginalia form; what has no equivalent (Python blocks, ATL, layered
images by attribute). Meant for people deciding whether to try the engine, so it is linked from the README, not only
the tutorial.

### G. Testing and quality

Playtest bot options, script statistics, art and audio checks, the Errors-in-exported-game report. Short; extends page 2.

## Open decisions

- Studio is Windows-only today. The main path leads with Studio and the online demo, with `npm` as the aside;
  confirm that is the positioning wanted.
- The tutorial game's genre: a short mystery on a train (hotspots would come in "Go deeper C") or a plain
  choice-driven story. The sketch above assumes the second, to keep page 2 clean.
- Whether screenshots are retaken by a script (a playwright pass over the tutorial game's checkpoints) so they can be
  regenerated with every editor change.

## Writing order

1. The tutorial game and its checkpoints, with the snippet-extraction test.
2. Pages 1, 2 and 5 first: they depend only on stable features.
3. Pages 3 and 4, then Go deeper A, F and G.
4. Go deeper B, C, then D and E (D waits for real layered art).
5. Retire `docs/tutorial/00-05` and update the README table and `TODO.md` in the same change.
