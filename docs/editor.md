# The editor

The editor edits scripts and `game.json` next to the live preview. Open it at http://localhost:5173/editor/ (after
`npm run dev`), in [Marginalia Studio](studio.md) or in the [online demo](online.md). A tour with screenshots is in
[tutorial/deeper/h-editor-tour.md](tutorial/deeper/h-editor-tour.md).

Contents: [Palette](#palette-ctrlp) · [Files panel](#files-panel) · [Git](#git) · [Refactoring and search](#refactoring-and-search) ·
[Problems and quick fixes](#problems-and-quick-fixes) · [Preview from cursor](#preview-from-cursor) ·
[Variables](#variables) · [Outline](#outline) · [Help (F1)](#help-f1) · [Keys](#keys) · [Build](#build)

## Palette (Ctrl+P)

**Ctrl+P** opens the palette. It works with focus anywhere, including in the preview. What you type picks the mode:

| Type | Mode |
|---|---|
| (nothing) | Go to file, recently used first, so Ctrl+P, Enter flips between two files. A new name offers "Create" |
| `>` | Commands: preview from cursor / title screen / new game, add ids (file or all), save all, next problem, toggle follow / word wrap / minimap / preview pane, export web build, open exported game, export strings, reconvert all art, reset player data, plus every Monaco editor action |
| `@` | Go to label, across all scripts |
| `:` | Go to line |
| `#` | Go to asset. A character with a converted `sprite.json` opens its `rig.json` in a tab (a generated skeleton when it has none, unsaved until you save); other assets open in a viewer dialog |
| `?` | List the modes |

## Files panel

Open it with the button or **Ctrl+B**. It lists the scripts, `game.json`, the characters (click to open the
`rig.json`) and the assets by folder, with a filter box. Clicking an image, sound or font opens a viewer dialog;
Left/Right step through the folder. A click on a script opens it and leaves the focus on the row; Enter or a
double-click moves on to the editor.

**Adding files.** Drop image, sound or font files from the desktop onto the assets list. Onto a folder they go
there, if it takes that kind of file (`bg` and `ui` take images, `music` and `sound` sounds, `fonts` fonts, `movie`
movies, `char` only a character's own folder; a folder you made yourself takes any); elsewhere they go by type
(images to `bg`, sounds to `music`, fonts to `fonts`). A PSD must go on the `bg`, `char` or `ui` folder and lands in
`masters/`. Existing files are never overwritten. The icons on each heading and
folder (shown on hover) do the same without dragging: new script file or folder, add files through the file picker,
add a character PSD, new asset folder.

**Art from PSDs.** Converted art is marked `psd`. PSDs without converted art are listed under **Masters not
converted**. Converted art is changed through its master, not renamed. See [art-pipeline.md](art-pipeline.md).

**Row actions.** Right-click a row (or Shift+F10) to preview a script from its start, open a master in its default
app (Photoshop), copy a path, or reveal the file in Explorer or Finder.

- **Rename** (F2 on the row) takes a new path in the palette, so typing another folder moves the file or folder.
- **Delete** (the Delete key) asks first.
- **Replace** overwrites an asset or master with a file of the same type.
- An overridden built-in screen has **Revert to Default**.

**Trash.** Nothing these actions remove is lost: deleted files and the old version of a replaced one go to `.trash/`
in the project folder. The message that follows has **Undo**, and **Restore from Trash** (in the palette, or by
right-clicking the Project heading) lists everything still there. Entries older than 30 days, then the oldest past
2 GB, are emptied for good. **Empty Trash** does it at once, after a question that starts on Cancel.

**References follow renames.** Renaming or moving an asset file or folder rewrites the scripts and `game.json` that
name it: `scene`, `image show`, `music`, `sound`, `define ... image=` and `blip=`, screen `image`/`mask`/`hover`
files, and the title, gallery, splash, music room, blips and theme images in `game.json`. It is one undo step per
file. A mention that cannot reach the new place (`music play` only finds files directly in `assets/music/`, `scene` only
backgrounds in `assets/bg/` or at the root of `assets/`) is left as it is and listed in the message. Character poses (`show alice smile`) are not followed.

**Tabs** close with their × (or middle-click, or Alt+W). Closing only hides the tab; the script still compiles with
the rest.

## Git

When the project is in a git repository, the top of the Files panel shows the branch and the number of changed files.

**Commit…** saves every tab, lists the changes, suggests a message and commits everything under the project folder
(never files outside it, never the trash). It is blocked by a merge in progress or a conflict. It warns about:

- PSDs and big files that Git LFS does not track (the repository keeps every version of them),
- a detached HEAD,
- `build/` or `.trash/` not being ignored (**Add to .gitignore** fixes that).

It never pushes, pulls, switches branches or throws changes away; use your git tool for those.

## Refactoring and search

- **F2 on a label name** (its `label` line, a `jump`/`call`, an `on click|focus|blur`, or `intro`/`chapters` in
  `game.json`) renames the label and every reference to it in all scripts and `game.json`. An invalid or already
  taken name is refused.
- **F2 on a variable name** does the same for a story variable (`set`, conditions, `call` arguments, `[name]` in
  text, `input`, `show screen ... as`) and for `persistent.<name>`. A label parameter, a screen parameter or a screen
  `each ... as` name is renamed only inside its label, screen or loop. A reserved word, a name the game fills in, or
  a name that would merge with another variable is refused. Translations in `locale/*.json` keep the old `[name]`
  until you re-export or edit them.
- **Ctrl+Shift+F** (Find and Replace in All Files) searches every script and `game.json` (match case, whole word,
  regexp with `$1` in the replacement), lists the hits (click one to go there) and replaces them all.

The logic is in `engine/src/refactor.ts` and `engine/src/var-refactor.ts`.

**Colors.** Hex colors show a swatch; clicking it opens a color picker that rewrites the value (`#rrggbb`, or
`#rrggbbaa` when not opaque). In scripts this covers colors after `=` (`color=`, `text=`, `{color=#...}`) and after
`tint` / `flash`; in `game.json` any quoted hex string (the `theme`). Named colors and `rgba(...)` get no swatch.
The logic is in `engine/src/colors.ts`.

## Problems and quick fixes

A mistyped name is marked with the closest known names in the message, for example
`Unknown command "shwo" (did you mean "show"?)`, and **Ctrl+.** on it offers each one as a quick fix. This covers
commands, labels, characters, screens, and backgrounds, poses, tracks, sounds, animations and parts that have no
file. The matching is in `engine/src/suggest.ts`.

F8 / Shift+F8 jump to the next / previous problem. The `rig.json` tab (see [rig-json.md](rig-json.md)) completes
part, slot and variant names for that character, marks mistakes as warnings, and saves like `game.json`.
**Character: Update Rig from Reconverted Art** adds parts that are new in the art to `order` (and bones for their PSD folders) and reports ones that
are gone. `show alice ` completes `rig.json` shorthands and `slot=` names.

## Preview from cursor

**Ctrl+Enter** plays the game from the line under the cursor. The preview replays the story from `start` up to that
line, so a `show` before it is on stage. It stops in the label the cursor is in: a subroutine the story calls on the way,
even one written further down the file, does not catch the stop.

It also works on lines the story never reaches (a label nothing jumps to yet): the preview runs the top-level
setup, then plays that label from its start up to the line. When the label skips the line (an `if` that is false) or
never gets to it, the preview enters the code at the line itself.

## Phone and tablet preview

The palette commands **Preview: Phone, landscape**, **Phone, portrait**, **Tablet, landscape** and **Desktop** size the preview pane like
that device (as far as the pane has room) and make the game inside act as on a touch screen: the quick bar and the text are sized
for a finger, and the mouse stands in for one, so a drag is a swipe and a held click a long press (see `touch` in
[game-json.md](game-json.md)). The choice lasts until the editor is closed. It is a look at the layout, not a test on a device.

## Variables

The **Variables** button (or the command) shows the story variables, unlock flags and persistent values live while
the preview plays. Values that just changed are highlighted. Double-click a variable to edit it (`true`/`false`, a
number, or text; Enter applies, Esc cancels). Persistent values are stored at once; unlock flags are read-only.

## Outline

The **Outline** button (or the command Story: Show Outline) draws the labels as a flowchart: jumps, calls and labels
that run on into the next one, with unreachable labels dashed. Edges inside an `if` (or a choice with a condition)
show the condition. Click a label to go to its source.

- The mouse wheel zooms at the cursor; dragging pans (arrow keys and +/- too).
- **Fit** (or 0, or a double-click on the background) shows everything; **Start** centres on the start label.
- The search box (or /) finds labels by name, file or the text of a choice leading out of them; Enter steps through
  the matches.

The layout and the pan/zoom math are in `engine/src/outline.ts`.

## Help (F1)

**F1** (or the Help button) opens the command reference from [commands.md](commands.md) in a dialog, scrolled to
the statement under the cursor (a `{` in dialogue text opens the text tags). In the `game.json` tab it opens
[game-json.md](game-json.md), and in a `rig.json` tab [rig-json.md](rig-json.md) at the key (`order`, `groups`,
`looks`) the cursor is under. F1 or Esc closes it.

Ctrl+F (or the search box) highlights every match and lists only the topics that have one; Enter and Shift+Enter
step through them. **Open in window** moves the reference to a window of its own (`editor/help.html`) that stays
open beside the editor. F1 also lists all the editor's keys under "Editor keys".

## Keys

| Key | Action |
|---|---|
| Ctrl+Enter | Preview from cursor |
| Ctrl+S | Save |
| Ctrl+P | Palette |
| Ctrl+B | Files panel |
| Ctrl+Shift+F | Find and replace in all files |
| Ctrl+. | Quick fix |
| F2 | Rename (label, variable or file) |
| F8 / Shift+F8 | Next / previous problem |
| Alt+Z | Word wrap |
| Alt+W | Close tab |
| Alt+1 / Alt+2 / Alt+3 | Focus the editor / the preview (to play it with the keyboard) / the Files panel's filter, from anywhere |
| Ctrl+M | Make Tab (and Shift+Tab) leave the script for the next (previous) control instead of indenting; press it again to indent again |

Dialogs (Build, Translate, Voice, Outline, Theme, Commit, Help) keep Tab inside them, Esc closes them wherever the focus is,
and the focus goes back to the button that opened them.

## Narrow windows

Up to about 1160 px wide the top bar wraps onto a second row, so Problems and the status stay visible. At 900 px and below
there is no room for the preview beside the code: **Preview from cursor**, the palette's Preview commands and Alt+2 show
it over the code, and the **‹ Editor** button in the bar (or Alt+1) brings the code back. The Files panel covers the code
too, and goes away when you open a file. Under 600 px the bar scrolls sideways in one row.

## Build

The **Build** button (or "Build: Checks and Export" in the palette) opens the Build dialog. It saves your tabs and
lists the pre-build checks grouped by severity, each with a link to the line, the Translations dialog or the Voice
dialog. Errors block the build; with warnings you tick "I've seen these warnings" first. It then exports the web or
desktop build into a folder inside `build/`, showing its size and, for the web build, a link to play it. In
Marginalia Studio it also offers the desktop app ready to run (a zip to share). See [exporting.md](exporting.md).

## For developers

- Editor commands are one list in `buildCommands()` (`editor/commands.ts`): a title, an optional key (bound
  automatically and shown in the palette), an optional `when`, and `run`.
- Project tasks (export, strings, art) run in the dev server (`/api/task`, a fixed whitelist) and stream to the
  Output panel, where `file:line` references open that line.
- `window.postMessage({type:'goto', file, line})` jumps the preview to a line.
