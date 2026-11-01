# The editor

`npm run dev` opens a browser editor made for visual novels: your script on the left, the running game on the right.
You never need to leave it to write, test and fix a story. The screenshots show the demo project.

![The editor with rooms.vn open and the game running beside it](img/editor-hub.png)

## Write and see it at once

Save a script and the game reloads and returns to the line you were on. **Ctrl+Enter** (Preview from cursor) starts the
game from any line, even one the story never reaches yet, so you can test the last scene without playing through the
first ten. Completions, hover help and problem markers know your labels, characters, variables and asset names, and hex
colours show a swatch that opens a colour picker.

![The stacks scene previewed from the cursor, with text tags and a colour swatch in the script](img/editor-stacks.png)

## Jump anywhere with Ctrl+P

One palette does it all: type a file name, `@` for a label across all scripts, `:` for a line number, `#` for an asset,
or `>` for every command (add ids, export, playtest, reconvert art and more).

![The palette finding the stacks label after typing @stacks](img/palette-labels.png)

## See your variables live

**Variables** shows story variables, unlock flags and persistent values while the preview plays. Changed values are
highlighted, and a double-click edits one, handy for jumping straight to the branch that needs `trust >= 3`.

![The live Variables panel under the script](img/variables.png)

## The story as a flowchart

**Outline** draws every label with its jumps and calls, marks unreachable labels, and takes you to the source with a
click. Choices with conditions show the condition on the arrow.

![The story outline of the demo: start, tour, the hub and its rooms](img/outline.png)

## Files, assets and refactoring

The **Files** panel lists scripts, built-in screens, characters and assets. Click an image, a sound or a font to preview
it. **F2** renames a label or variable everywhere at once, **Ctrl+Shift+F** finds and replaces across all files, **F1**
opens the command reference at the statement under the cursor, and **F8** steps through problems. `game.json` has its
own tab with completions and validation.

![The Files panel and the game.json tab](img/files.png)

The full reference is in the [README's Editor section](../../README.md#editor).
