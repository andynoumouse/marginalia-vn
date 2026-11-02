# game.json reference

`game.json` sits in the game folder and configures everything that is not script: the title screen, menus, text
sounds, the gallery and the look of the text box. Every key is optional. In the editor's **game.json** tab it has
completions, hover help and validation (the schema is `updateGameSchema()` in editor/editor.ts); JSON with syntax
errors is not saved. Pixel values are on the stage, 1920x1080 unless `stage` says otherwise.

```json
{
  "id": "evening-in-the-park",
  "engine": "0.1",
  "title": "Evening in the Park",
  "splash": ["studio_logo", { "text": "A game by someone", "duration": 2 }],
  "titleScreen": { "background": "bg_park_evening", "music": "evening_theme", "showTitle": true,
                   "align": "center", "buttons": ["new_game", "continue", "load", "gallery", "options"], "fade": 0.4 },
  "quickMenu": { "items": ["back", "history", "auto", "skip"], "position": "bottom", "align": "center" },
  "gallery": [ { "image": "cg_epilogue", "title": "Epilogue", "unlock": "good_ending" } ],
  "musicRoom": [ { "track": "evening_theme", "title": "Evening Theme" } ],
  "chapters": [ { "label": "start", "title": "The bench" } ],
  "blips": { "alice": { "synth": "square", "pitch": 760 } },
  "labels": { "new_game": "Begin" },
  "theme": { "accent": "#5fd1c3", "font": "Georgia" }
}
```

## Stage size

One size per project: `"stage": { "width": 1080, "height": 1920 }`. Both are whole pixels from 64 to 8192; a missing or invalid
`stage` means 1920x1080 (an invalid one is reported as a problem). It sets the canvas and the box the game scales to fit the
window, the pixels of screens, hotspots, `image` and layout anchors, and the messages that name the stage size. A portrait
version of a game is a copy of the project with its own art and screens, not a responsive layout.

What follows the size and what does not:

- Sprite `x`/`y` positions are fractions of the stage, so characters keep their place. Backgrounds are scaled to cover the stage
  (centred, edges cropped). The camera and screen wipes follow the size.
- Animation offsets (`shake`, `hop`, `animate`, rig `x`/`y` keys) are fractions of the stage's **shorter side** (its height on a
  landscape stage, so existing projects are unchanged), and the built-in 8 px shake and 44 px hop are written against 1080.
- Pixel coordinates in `screen` blocks and `image` lines are yours to place; nothing rescales them. The stock text box, title,
  pause and options screens are laid out for a landscape stage: on a portrait one, supply `screen title`, `screen options` and the
  rest yourself.
- Nothing derived from the size is stored in saves (they hold the story position and variables), so a save loads at any stage size.
- Editing `stage` in the dev preview reloads the page.

## Top level

| Key | Meaning |
|---|---|
| `title` | Game name, shown on the title screen. |
| `id` | Key for saves, settings and read-text tracking. Defaults to a slug of `title`. Changing it starts with fresh saves. |
| `language` | The language the scripts are written in (default `"en"`, e.g. `"fi"` or `"pt-BR"`). It is the text language that needs no `locale/<lang>.json`; the Translations dialog and the language option treat it as the source. It only labels the default: unmarked files such as `assets/voice/<id>.*` are the default take, and file names never contain it. |
| `voiceLanguages` | Languages to record voice in, e.g. `["ja", "fi"]`. Separate from the text translations: the Voice dialog lists these, the languages that already have recordings and the source language's default take, not every `locale/<lang>.json`. Build checks hold a listed language to a recording for every spoken line even before it has one. The player's voice option still offers only languages with recordings. |
| `engine` | Minimum engine version, e.g. `"0.1"`. The tools warn when the engine is older. |
| `stage` | The stage size in pixels, `{ "width": 1080, "height": 1920 }` (default 1920x1080), below. |
| `positions` | Extra named stage positions for scripts, below. |
| `anchors` | Extra named anchors for `anchor=`, below. |
| `captions` | Text shown for sound effects when the player turns on Sound captions, below. |
| `choiceSaves` | How many rotating choice autosaves to keep, 1 to 20 (default 5). |
| `memoryBudgetMB` | Memory budget for loaded images and audio, in MB (default 512, or 256 when the browser reports 2 GB of device memory or less). Nothing is unloaded yet; the debug console's `memory` command compares what is resident against it. |
| `saveVersion` | A whole number (default 0). Raise it when a release breaks old saves: Continue, Load and quick load then ask "made with an older version, load anyway?" for saves made under a lower number (saves from before the field count as 0). The engine itself loads any save it finds. |
| `psdPrefix` | Character PSDs: a top-level group whose name starts with this is a folder, not a slot (default `"+"`; `""` turns it off). Used by `npm run art`. |
| `build` | `{ "checks": { "<check>": "error" \| "warning" \| "info" \| "off" } }`: how serious each pre-build check is, below. |
| `intro` | A script label played once at start, below. |
| `splash` | Logo cards shown once at start, below. |
| `titleScreen` | The title screen, below. |
| `quickMenu` | The bar shown while playing, below. |
| `gallery` | Gallery entries, below. |
| `musicRoom` | Music room tracks, below. |
| `chapters` | Chapter select entries, below. |
| `achievements` | Achievements and endings, below. |
| `achievementToast` | The notice an unlocked achievement pops up, below. |
| `blips` | Text sound voices, below. |
| `labels` | Menu text overrides, below. |
| `theme` | Look of the text box, text and choices, below. |

## build

Before an export, `npm run export` runs the pre-build checks and prints a report (`npm run export -- --check` prints it and stops).
Each check has a level: an `error` refuses the export, a `warning` is listed (and refuses it with `--strict`), an `info` is a note,
and `off` hides it. `build.checks` changes the defaults:

```json
{ "build": { "checks": { "untranslated": "error", "voice-missing": "off" } } }
```

| Check | Default | Finds |
|---|---|---|
| `script` | error | Script, asset and game.json errors. |
| `script-warnings` | warning | Their warnings. |
| `ids` | warning | Dialogue, choice and prompt lines with no `#id` (`npm run ids` adds them). |
| `untranslated` | warning | Strings with no entry in a `locale/<lang>.json` table, per language. |
| `translation-outdated` | warning | Translations made against older source text (the Translations dialog's "source changed"). |
| `voice-outdated` | warning | Recordings of lines that were reworded since (see the Voice section of commands.md). |
| `voice-missing` | info | Spoken lines with no recording, in each language that has any recordings. |
| `unused-locale` | info | Locale entries that match no line. |
| `unmatched-voice` | info | Files in `assets/voice` whose id matches no line. |

## positions

```json
"positions": { "farleft": 0.08, "leftcenter": 0.35, "balcony": { "x": 0.7, "y": -0.15 } }
```

Names for places on the stage (0 is the left edge, 1 the right edge), usable wherever a script takes a position:
`show alice at farleft`, `move bob to leftcenter 0.5`, `camera pan rightcenter`. An entry is a number (`x`) or
`{ "x", "y" }`; `y` is a height offset as a fraction of the stage height (negative lifts), the same as `y=` on `show`
and `move`. `show alice at balcony` stands her at that height, `move bob to balcony 1` slides him there, and a `y=`
on the line wins (`show alice at balcony y=0`). `camera` uses only the `x`. A move to a position without `y` leaves
the height alone. They are added to the built-in
`left` (0.2), `center` (0.5) and `right` (0.8); an entry with one of those names replaces it. A name is letters,
digits and `_`, must not start with a digit and must not be a script keyword (`fade`, `nowait`...); other entries
are ignored with a warning. The scripts are compiled with this table, so changing it in the editor's game.json tab
re-checks them at once.

## anchors

```json
"anchors": { "waist": [0.5, 0.6], "hand": [0.8, 0.5] }
```

Names for the point a character scales, turns and mirrors about, usable wherever a script takes `anchor=`:
`show alice anchor=waist`, `move bob rot=15 anchor=hand 0.4`. An entry is `[fx, fy]`, two fractions of the sprite
(0,0 is its top left, 1,1 its bottom right). They are added to the built-in `feet` (0.5, 1), `center`, `head` and `top`;
an entry with one of those names replaces it. A name is letters, digits and `_`, not starting with a digit; other
entries are ignored with a warning. Like `positions`, the scripts are compiled with this table.

## captions

```json
"captions": { "door": "[door slams]", "bell": "[distant church bell]", "click": "" }
```

An accessibility option (Options, Sound captions; off by default). When on, `sound play <name>` shows a short caption
for a moment at the top of the stage. The text is the entry for that sound name here; without an entry it is the name
made readable (`glass_break` shows `[glass break]`). An empty string gives that sound no caption. Entries that are not
text are ignored with a warning. Only `sound play` is captioned, not music or text blips.

## intro

`"intro": "opening"` plays `label opening:` from your scripts as a cutscene when the game starts, then the title screen
appears (through a fade, see `titleScreen.fade`). It is ordinary script: scenes, music, dialogue, NVL pages, even
menus. Rules:

- Finish it with `end` (or `return`). Running off the label into the next one would keep playing that.
- Top-level setup (`define`, `set`) runs first, as for any game; the intro's variables do not carry into New game.
- Esc skips it. Nothing is autosaved, and backgrounds shown do not count towards the gallery.
- It plays only on first load of the page, not when returning to the title. Unknown labels are ignored (the status bar says so).
- Order at start: `splash` cards, then `intro`, then the title. The editor's **Preview: Intro** command plays it on demand.

## splash

Cards shown once when the game starts (not when returning to the title), on black, before the title screen. Each is
a background name (`assets/bg/<name>.png`, drawn centered) or an object:

| Key | Meaning |
|---|---|
| `image` | Background name. |
| `text` | Text under the image, or on its own. At least one of `image` and `text` is needed. |
| `duration` | Seconds fully visible (default 2.5). |
| `fade` | Seconds to fade in, and again out (default 0.6). |

A click, Enter, Space or Esc skips the card on screen. Reduced motion cuts instead of fading. The title screen's
art and music load while the cards play. The editor's **Preview: Splash** command plays them on demand.

## titleScreen

| Key | Meaning |
|---|---|
| `background` | Scene name drawn behind the menu (`assets/bg/<name>.png`). |
| `music` | Looping track (`assets/music/<name>.*`). |
| `showTitle` | Show the game name (default true; turn off when the background has a logo). |
| `align` | `left`, `center` (default) or `right`: where the title and buttons sit. |
| `buttons` | Buttons in order, from `new_game`, `continue`, `load`, `gallery`, `music_room`, `chapters`, `achievements`, `options`. Leave one out to hide it. |
| `fade` | Seconds of black between the title screen and the game, in both directions (default 0.4; 0 cuts). Reduced motion also cuts. Menu screens always fade in briefly. |

To design the title screen yourself, declare `screen title:` in a script with buttons that use `action start`, `continue`, `load`,
`options` or `quit` (see "Screens" in commands.md); it replaces the stock buttons and the `buttons` list is then ignored (the
`background`, `music` and `fade` keys still apply). `continue` is greyed out until there is a save. Gallery, music room and
chapters have no action yet, so they are not reachable from a custom title screen.

## quickMenu

| Key | Meaning |
|---|---|
| `items` | Buttons in order, from `back`, `history`, `auto`, `skip`, `qsave`, `qload`, `save`, `load`, `options`, `hide`. `[]` shows no bar; hotkeys keep working. A `voice` replay button is added by itself and shows only on voiced lines. |
| `position` | `bottom` (default) or `top`. |
| `align` | `left`, `center` (default) or `right`. |

To design the bar yourself, declare `screen quickmenu:` in a script with buttons that use `action <name>` (see "Screens" in
commands.md); it replaces this bar and these keys are then ignored.

## gallery

A list of `{ "image", "title", "unlock" }`. `image` is a background name (`assets/bg/<image>.png`), usually a CG
shown with `scene`. An entry unlocks once its image has been shown while playing, or, with `unlock`, when the script
runs `unlock <flag>`. A Gallery button shows on the title screen when `gallery` is in `titleScreen.buttons`.

## musicRoom

A list of tracks, each a name (`assets/music/<name>.*`) or `{ "track", "title", "unlock" }`. A track unlocks once it has
started playing while a game is on (`music play`), or, with `unlock`, when the script runs `unlock <flag>`. The Music
button on the title screen opens the list; clicking an unlocked track plays it on loop, and Stop or Back returns to the
title music. The button shows when `musicRoom` has entries (keep `"music_room"` in `titleScreen.buttons`). The title
screen's own music does not count as heard.

## chapters

A list of script labels, each a name or `{ "label", "title", "unlock" }`. A chapter unlocks once the story has entered its
label while playing (by `jump`, `call` or falling through; rebuilding state from a save does not count), or, with
`unlock`, by a flag. The Chapters button (`"chapters"` in `titleScreen.buttons`) lists them, and picking one starts a new
playthrough at that label: variables begin empty, the top-level setup runs first, and persistent flags are as they are
now. Use it for chapter select and scene replay. A label no script defines is reported as a warning.

## achievements

A list of achievements and endings, each a flag name or an object:

```json
"achievements": [
  { "unlock": "good_ending", "title": "Sunshine", "description": "Reach the good ending.", "ending": true },
  { "unlock": "found_key", "title": "Locksmith", "description": "Find the key.", "icon": "ach_key", "hidden": true },
  { "unlock": "all_routes", "title": "Completionist", "toast": false }
]
```

| Key | Meaning |
|---|---|
| `unlock` | The flag that unlocks it: the script runs `unlock <flag>`. Required; also its id. |
| `title` | The name shown (default: the flag). |
| `description` | What it is for. |
| `icon` | An image in `assets/ui/<icon>.*`, shown on the list and the toast. |
| `hidden` | Shown as "???" with no description or icon until unlocked. |
| `ending` | An ending: listed and counted apart from the achievements. |
| `toast` | `false` unlocks it quietly, with no toast. |

Unlocks are stored for good, apart from saves, like every `unlock` flag. The Achievements button (`"achievements"` in
`titleScreen.buttons`) shows when the list has entries; it lists endings and achievements in two parts, each with a count.
An entry whose flag no script unlocks, and an icon with no file, are reported as warnings.

## achievementToast

How the notice that pops up when an achievement unlocks looks and lasts. Unlocks that happen together queue up and show
one after another. Every key is optional.

| Key | Meaning |
|---|---|
| `position` | `topright` (default), `topleft`, `bottomright`, `bottomleft`, `top` or `bottom`. |
| `seconds` | How long each one stays (default 4). |
| `sound` | A sound (`assets/sound/<sound>.*`) played as it appears. |

The stock toast says "Achievement unlocked" or "Ending reached" (`ui.achievement_unlocked`, `ui.ending_reached` in the
locale files) over the title, description and icon. To draw your own, declare `screen achievement_toast` (see the screens
section of docs/commands.md); `seconds` and `sound` still apply, `position` is up to the screen.

## blips

Text sound voices by name, used as `define <char> ... blip=<name>`. Built in (no files needed): `high`, `mid`, `low`,
`soft`, `typewriter`, `robot`; a voice here with the same name replaces it. Any `assets/sound/<name>` sample also works
as a `blip=` value, and `blip=none` silences a character.

| Key | Meaning |
|---|---|
| `synth` | `square`, `triangle`, `sine` or `sawtooth`. |
| `pitch` | Synth pitch in Hz (440). |
| `sound` | A sample instead of a synth: `assets/sound/<sound>`. |
| `vowels` | In vowel mode, a sample per vowel: `{ "a": "kiki_a", "e": ... }`. |
| `mode` | `letters` (default) blips per letter; `vowels` only on vowels, each at its own pitch or sample. |
| `every` | Blip on every Nth letter (1). |
| `interval` | Minimum milliseconds between blips (55). |
| `variation` | Random pitch spread in semitones (0). |
| `volume` | 0 to 1 (0.25 for synth, 0.8 for samples). |
| `length` | Synth blip length in milliseconds (45). |

## labels

Menu text in the source language, e.g. `"new_game": "Begin"`. Other languages use `ui.<key>` entries in
`locale/<lang>.json` (`npm run strings` leaves them alone). The keys are the `data-ui` attributes in
`preview/index.html`, and the quick menu buttons as `q_<item>` (`q_skip`). The editor completes the full list.

## theme

| Key | Meaning |
|---|---|
| `accent` | Highlight color for menus and sliders, e.g. `"#5fd1c3"`. |
| `hotFill`, `hotBorder`, `hotBorderWidth` | Highlight of a hovered or focused hotspot or button in screens and HUDs: fill color (default `rgba(255,255,255,.18)`), border color (default `accent`) and border width in stage pixels (default 2). `hover none` and `hover "file"` on an element override it (docs/commands.md "Screens"). |
| `tipBackground`, `tipColor`, `tipFont` | Hotspot tooltip: background and text color, and font (a file name in `assets/fonts/` or an installed font; default the theme `font`). |
| `font` | Font for story text and menus: a file name in `assets/fonts/` (woff2, woff, ttf, otf) or an installed font. |
| `textbox` | The dialogue box. |
| `namebox` | The name tag; `x` and `y` are relative to the text box. Also takes `size` (font size). |
| `text` | `size` (44), `color`, `lineHeight` (1.45). |
| `choices` | Choice buttons. Like a box but without `x`/`y`; also `size` and `gap` (space between buttons). |
| `skins` | Per-character overrides: `{ "alice": { "textbox": {...}, "namebox": {...}, "text": {...} } }`. A character with `define alice ... box=alice` uses `skins.alice` while speaking. |

A box (`textbox`, `namebox`, `choices`) takes:

| Key | Meaning |
|---|---|
| `x`, `y` | Top-left corner in stage pixels (not for `choices`). |
| `width`, `height` | Width, and minimum height. |
| `padding` | One number, or `[top, right, bottom, left]`. |
| `background` | A CSS color, e.g. `"rgba(10,13,19,.84)"`. |
| `border` | Border color. |
| `radius` | Corner radius. |
| `image` | Frame art `assets/ui/<image>.png`, from `masters/ui/<image>.psd` converted 1:1. Replaces `background`. |
| `slice` | 9-slice edge size that does not stretch: one number or `[top, right, bottom, left]`. |

The text box opacity option in the player's Options fades the box's `background` color too (themed or default); an `image` frame
keeps its own look.
