# Playtest bot, statistics and checks

## Playtest bot

`npm run playtest` (`vn playtest` in a game project) plays the compiled story by itself, taking every menu option
and every screen element. In the editor, the **Story: Playtest All Routes** command does the same on the unsaved
scripts. It reports:

- the **endings** it reaches (`end`, a `return` with nothing to return to, or running off the end of the scripts),
  each with the shortest route of choices that gets there and the flags (`unlock`) that route sets;
- **lines and labels no route reaches** (a branch whose condition never holds, an option that can never be offered);
- **possible endless loops** (a path that runs thousands of lines without a choice or an end), and screens that wait
  for a pick but offer nothing to pick;
- **variables** set but never read, or read but never set, and `unlock` flags nothing checks;
- **unused assets**: images, music and sounds that no script, screen, item or `game.json` names. Layers of a layered
  character count as used once the character is shown.

In the editor the unreachable lines, loops and unused variables also show up as problems (F8) until the next edit.

### Options

| Option | Effect |
|---|---|
| `--strict` | Exit code 1 when anything is found, for CI |
| `--json` | Machine-readable output |
| `--all-labels` | Also start from every label nothing jumps to, such as scenes you enter with Preview from cursor (the editor always does) |
| `--label <name>` | Start from that label too (repeatable) |
| `--max-states <n>` | Search budget |
| `--seeds <n>` | How many random seeds to try |

The `intro` and `chapters` labels from `game.json` are always played too.

### How it works, and what it does not do

The bot steps the compiled program like the runtime does and forks at each choice.

- A situation met twice (same place, call stack, variables, flags) is explored once, so loops end when they stop
  changing anything.
- To keep counters from running forever, a number that is only ever compared with fixed numbers counts as the same
  once it is a few steps beyond all of them. Variables no condition can see are ignored. Lists compare as sets,
  unless the story uses `item()`, `index()` or `count()`.
- Flags and persistent data left behind by one playthrough are available to the next, so content gated on
  `unlocked.x` after a first ending is found.
- Input answers are the default text.
- A condition that draws a random number is followed both ways. Other draws (`set x = random(3)`) come from a seeded
  generator, and the search repeats with a few seeds.
- Hotspot and button `on click` handlers of a HUD are played from the point the HUD went up.
- When the budget (`--max-states`) runs out the report says INCOMPLETE, and "unreachable" may be wrong.

It cannot know what the player does in the shell (save, load, rollback) or what the `intro` / `chapters` unlock
conditions mean. Assets named only in code it cannot see are handled on a best-effort basis (a dynamic
`image "item_[n]"` is matched as a pattern).

## Script statistics

`npm run stats` (`vn stats` in a game project) counts the text the player reads: dialogue and narration, menu
prompts, options and their `else` reasons, and `input` prompts. Text tags are left out and a `[variable]` counts as
one word. In the editor, **Story: Script Statistics** shows the same for the unsaved scripts in the Output panel.

It gives:

- words, lines and characters (without spaces) in all, per character (what a voice studio quotes by), per script
  file and per label;
- a reading time, at 200 words a minute by default, with every route read once;
- a "to translate" count of the localizable strings, each id once, including screen labels and item names.

Options: `--json` for the numbers, `--wpm 250` for another reading speed. Characters matter more than words for
languages written without spaces.

## Checking art and audio

The editor, the preview's Problems list and `npm run export` warn about names with no matching file:

- backgrounds, poses and slot variants of layered characters (from their `sprite.json`), and single-image poses;
- music and sounds;
- the names `game.json` uses: title screen background and music, gallery and splash images.

Art folders with no files at all are treated as "not made yet" and stay quiet, so a prototype running on
placeholders shows no art warnings. Audio has no placeholder, so a missing track or sound is always reported, as are
blip voices and text box skins.
