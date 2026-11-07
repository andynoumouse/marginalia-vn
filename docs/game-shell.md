# Game shell, saves and extras

The game shell is everything around the story: the title screen, menus, saves, options, audio and extras. Opening
http://localhost:5173 shows the title screen (New game / Continue / Load / Options). The preview inside the editor
skips it. While playing, **Esc** or right-click opens the pause menu (Resume / Save / Load / Options / Main menu);
Esc and Back always return to the previous screen.

Contents: [Title screen and game.json](#title-screen-and-gamejson) · [Controls](#controls) · [Rollback, skip and auto](#rollback-skip-and-auto) ·
[Saves](#saves) · [Options](#options) · [Audio and voice](#audio-and-voice) · [Translating the menus](#translating-the-menus) ·
[Persistent flags and data](#persistent-flags-and-data) · [Gallery and extras](#gallery-and-extras) · [Randomness](#randomness) ·
[Debug console](#debug-console)

## Title screen and game.json

`game.json` sets up the title screen and menus (every option: [game-json.md](game-json.md)). Edit it in the editor's
**game.json** tab, which offers completions (scene and track names from the script and assets), hover help and
validation. JSON with syntax errors is not saved. Ctrl+Enter in that tab (or a row under **Built-in screens** in the
Files panel) shows the title in the preview, and edits then appear live.

```json
{ "title": "Evening in the Park",
  "titleScreen": { "background": "bg_park_evening", "music": "evening_theme", "showTitle": true,
                   "align": "center", "buttons": ["new_game", "continue", "options"] },
  "labels": { "new_game": "Begin" },
  "theme": { "accent": "#5fd1c3", "font": "Georgia" } }
```

- `buttons` sets the order and visibility of the title buttons.
- `labels` overrides menu text in the source language.
- `theme.font` applies to story text and menus.
- `intro` names a script label played as a cutscene before the title screen (Esc skips).
- `splash` lists logo cards shown once at start (a click skips).
- `titleScreen.fade` is the black fade between title and game.

## Controls

**Quick menu** (while playing): Back, History, Auto, Skip, Q.Save, Q.Load, Save, Load, Options, Hide. Which buttons
show, in what order, and where:
`"quickMenu": { "items": [...], "position": "bottom" | "top", "align": "left" | "center" | "right" }`.

| Key | Action |
|---|---|
| Wheel up / Page Up | Back |
| Wheel down | Advance |
| L | History |
| A | Auto |
| Tab (or hold Ctrl) | Skip |
| F5 / F9 | Quick save / quick load |
| H or middle click | Hide the interface |
| V | Hear the current voice line again |

**Keyboard and gamepad in menus.** In any menu, or at a choice, the arrow keys (or d-pad / left stick) move between
buttons, sliders and selects. Left/Right changes a slider or select, or switches the Options tab when a tab is
focused. Enter / Space (gamepad A) presses, Esc (B) goes back, and Tab moves focus as usual at a choice. The numbers
1-9 still pick a choice. Inside menus LB / RB switch the Options tab.

**Gamepad while playing** (standard-layout pads; the mapping is `PadMapper` in `preview/input.ts`):

| Button | Action |
|---|---|
| A, d-pad down or right | Advance |
| d-pad up, LB | Back |
| X | Auto |
| Y | Hide the interface |
| Select | History |
| B, Start | Pause menu |
| Hold RB | Skip |

Name prompts (`input`) show an on-screen keyboard while a pad is the last thing used (a key press or click hides it
again). A types the focused key, X is backspace, Y is shift, and A on the text field presses OK.

## Rollback, skip and auto

- **Back** (rollback) returns to the previous line or choice exactly and lets you choose differently. It replays to
  that step (`Runtime.restore({ step })`). Saves carry the last 150 steps, so Back and History also reach past a
  load, unless the script changed since the save (then they start at the loaded line). Clicking a line in History
  rolls back to it in one step (`action line` on a project's `screen history`).
- **Skip** fast-forwards through lines read before (in any playthrough, kept per browser) and stops at choices and at
  unread text. Options can make it skip everything.
- **Auto** advances by itself; its speed is in Options, and A toggles it.

## Saves

- 9 pages of 6 slots, plus an autosave (written on every line, page "A" in Load). Each slot shows a thumbnail, the
  time and the line on screen. Overwriting, deleting and loading mid-game ask first.
- Load also has the quick save page ("Q") and a "C" page with the last 5 choice autosaves (`"choiceSaves"` in
  `game.json`, 1-20), written whenever a choice or name prompt appears, so players can return to just before a
  decision.
- With `"saveNames": true` in `game.json` the player names a save when making it (and can rename it), and the name
  shows in place of "Slot 3".
- Continue loads the newest save of any kind.
- A save stores the source position and the choices made, not engine internals, so saves keep working after the
  script is edited (`preview/saves.ts`).

Saves, settings and read-text tracking are stored per game; see [exporting.md](exporting.md#saves-and-game-id).

## Options

Master / music / sound volume, text speed (up to instant), auto speed, text sounds, skip read / all text, text size,
text box opacity, reduce motion, sound captions, screen reader dialogue, language and fullscreen, grouped in Audio,
Game and Accessibility tabs. They are saved per browser in localStorage.

- **Reduce motion** (on by default when the system asks for it) drops shake, hop, flash and weather, makes wipes,
  iris, blinds, pixelate and image-mask transitions into dissolves, snaps `camera` and stops wavy/shaking text.
- **Box opacity** fades the default box; a `theme` background or image keeps its own look.

## Audio and voice

- `music play <name>` plays `assets/music/<name>.ogg|mp3|wav|m4a|flac|opus`, and `sound play <name>` plays
  `assets/sound/<name>.*`.
- Music crossfades over `fade n`, keeps playing through hot reloads when the track is unchanged, and loops only with
  `loop`. `music pause` / `resume` hold and continue it, `sound loop` / `sound stop` run ambience beside it, and
  `sound play ... duck` dips the music under a sound.
- Cues without a file show as text in the corner.

**Voice lines.** A recording named after a line's localization id plays when the line appears; no script command is
needed. The file is `assets/voice/<id>.<ext>` (same formats as music). `assets/voice/<id>.<lang>.<ext>` is the take
for the player's language and wins over the default take, which has no language in its name.

- Auto-advance waits for the recording to finish; advancing or skipping cuts it.
- Players get a Voice volume slider, a Voice button on the quick bar (only on voiced lines) and key `V` to hear the
  line again.
- `npm run voice` (and export) warns about recordings whose line was reworded after they were made.
- The editor's Voice dialog (Ctrl+P) shows each line's recording state per language, takes audio files dropped on a
  row or on the list, plays them, and exports a recording script CSV.

## Translating the menus

Menu labels translate through `ui.<key>` entries in `locale/<lang>.json`. The keys are the `data-ui` attributes in
`preview/index.html`, for example `"ui.new_game": "Uusi peli"`. `npm run strings` leaves these entries alone.

## Persistent flags and data

`unlock <flag>` stores a flag for good (endings reached, extras, achievements). Conditions read it as
`unlocked.<flag>`. A playthrough sees the flags as they were when it started plus its own unlocks, and saves remember
that starting set, so loading or rolling back always replays the same branches. New unlocks are stored immediately
anyway. The compiler warns about a flag that is read but never unlocked.

`set persistent.<name> = ...` does the same for numbers, text and true/false (counters, names, route progress). Read
it as `persistent.<name>` (or `[persistent.<name>]` in text). The same start-plus-own-changes rule applies, and the
values are saved with each save. The compiler warns about a value that is read but never written. "Reset player
data" clears it too.

## Gallery and extras

`"gallery"` in `game.json` lists images. A Gallery button appears on the title screen (keep `"gallery"` in
`titleScreen.buttons`). An entry unlocks once its background has been shown while playing, or by a flag:

```json
"gallery": [
  { "image": "cg_park_kiss", "title": "Under the lamps" },
  { "image": "cg_epilogue", "title": "Epilogue", "unlock": "good_ending" }
]
```

The viewer shows one image at a time (arrow keys to browse, Back or Esc to close).

Extras work the same way:

- `"musicRoom"` lists tracks, unlocked once they have played.
- `"chapters"` lists script labels, unlocked once reached; picking one starts a new playthrough there.
- `"achievements"` lists achievements and endings unlocked by `unlock <flag>`. Each pops up a toast;
  `"achievementToast"` sets its corner, time and sound.

Each extra gets a title-screen button (`"music_room"`, `"chapters"` and `"achievements"` in `titleScreen.buttons`).
The toast, quick menu, gallery, music room, chapters and achievements are default screens too: declare
`screen achievement_toast`, `quickmenu`, `gallery`, `music`, `chapters` or `achievements` to change one. See
[game-json.md](game-json.md).

## Randomness

`random(a, b)`, `random(n)`, `random()`, `pick(a, b, ...)` and `chance(percent)` work in any expression. They draw
from a seeded generator whose state is part of the runtime state (the seed is kept in saves and rewound on every
restore), so load, rollback and hot reload replay the same draws and branches. See [commands.md](commands.md).

## Debug console

The dev preview's **Debug** button opens a console (not in exported games).

| Command | Does |
|---|---|
| `vars` | List the running story's variables |
| `set <name> = <expr>` | Change a variable now |
| `trust + 1` (any expression) | Print its value |
| `jump <label>` | Start a new playthrough there |
| `unlock <flag>` / `lock <flag>` | Edit the flags |
| `reset <gallery\|music\|chapters\|flags\|options\|persistent\|seen\|saves\|progress\|all>` | Clear what persists (`progress` is everything but saves) |
| `memory` | Estimated size of the loaded images and audio against the budget (`"memoryBudgetMB"` in `game.json`), and how many files the story had to wait for |
| `help` | List the commands |

Up/Down recall earlier commands.
