# Testing and quality

A branching game has more ways to go wrong than a linear one: a route that ends in nothing, a flag nobody reads, a
picture that was never made. This page collects the tools that find these. The full reference is
[checks and tools](../../checks-and-tools.md).

## While you write

- **Problem markers** appear as you type. F8 and Shift+F8 step through them, Ctrl+. offers a fix.
- **Preview from cursor** (Ctrl+Enter) starts from any line. Combine it with the **Variables** panel: edit a value
  there to enter the branch you want to test.
- **The Outline** draws the story as a flowchart. A label nothing can reach is marked, and you can search for a choice
  by its text.

## The playtest bot

Run it from the palette (*Story: Playtest All Routes*, which uses your unsaved scripts) or `npm run playtest`. It plays
every route of the compiled story and reports:

- each **ending** reached, with the shortest route of choices to it and the flags it sets;
- **lines and labels no route reaches**;
- **possible endless loops** and screens that wait for a pick but offer nothing;
- **variables** set but never read (or read but never set) and `unlock` flags nothing checks;
- **unused assets**.

Useful options: `--strict` returns a failing exit code, so a CI job can run it; `--all-labels` also starts from labels
nothing jumps to (scenes you enter with Preview from cursor); `--json` gives machine-readable output.

The bot takes every option and screen element it is offered, so it proves that routes *exist*; it does not judge
whether the story is good. It answers `input` with the default text, cannot see what a player does in the shell (save,
load, rollback), and says INCOMPLETE when its search budget runs out, in which case "unreachable" may be wrong. See
[how it works](../../checks-and-tools.md#how-it-works-and-what-it-does-not-do).

## Statistics

`npm run stats` (or *Story: Script Statistics* in the palette) counts the text the player reads: words, lines and
characters in all and per character, per file and per label, a reading time, and how many strings are left to translate.
Handy for estimating a translation or a voice session.

## Art and sound checks

The editor, the preview's Problems list and the Build dialog warn about names a script or `game.json` uses with no
matching file. An art folder with no files at all counts as "not made yet" and stays quiet, so a prototype running on
placeholders shows no art warnings; a missing music track or sound is always reported.

## A pre-release routine

1. `npm run ids`, then `npm run strings`, so no line is missing an id.
2. Playtest. Fix every unreachable line and dead end, or confirm each is intended.
3. Play each ending once by hand, from the title screen, including Load and Back.
4. Open the Build dialog, read every warning, build.
5. Play the build, not the preview, on the device you care about most.
