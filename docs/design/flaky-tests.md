# Flaky browser tests

A record of browser tests (`engine/test/browser.test.mjs`) that fail in a full run and pass alone. The browser file runs its
tests `VN_BROWSER_JOBS` at a time (default 6), each in its own context. None of these has been a real bug in the product so
far: each was a test racing a page that was still busy (a late load, an async layout) on a loaded machine.

How to tell a flake from a failure: run the one test alone, serially, with
`VN_BROWSER_JOBS=1 node --test --test-name-pattern="<part of the name>" engine/test/browser.test.mjs`. If it passes there and
fails again in a full run on a second try, it is still a flake until a cause is found; if it fails alone, it is a real failure.

Add a row when a test fails only in a full run and passes alone. Delete a row when its cause is fixed and it has stayed green
for several full runs.

## What the flakes turned out to be (2026-11-07)

Reproduced by running the full set a few times (it failed 3 to 6 tests a run, a different set each time), and the timeout
message of `until` now says what the page looked like (visibility, toast, palette list, open dialogs). Four causes:

1. **The focus is taken from what the test is typing into.** The command palette closes when its input blurs, and Escape and
   F2 go to the focused element. On a loaded page the editor finishes loading a file, or the tree redraws a row after a
   restore, between a test's keystrokes: the rest of a query went to the editor, Enter ran the wrong item or none, an Escape
   missed its dialog. Fixes: `palette(page, query)` fills the query in one step, reopens the palette if it closed, waits for
   the selected item to be the command and only then presses Enter (all open-coded `Control+p` sites use it now); the tests
   click into a dialog's own field before an Escape meant for it; `cursorIn` jumps to the line again until it holds and the
   editor has the focus; `actAtCursor` repeats the placing when F2 or Shift+F12 finds no word.
2. **Space on a menu picks an option.** `toChoice` pressed Space on a timer until the menu was up; on a loaded page the menu
   opened between the check and the key, and Space on the focused first option chose it (the timed menus then never reached
   `on timeout`, and the pause test found the menu gone). `toChoice` now clicks the stage's corner, which is ignored while a
   menu is open. The pause-hold test also uses a 60 s clock: it never needs it to run out.
3. **An assertion right after an asynchronous step.** The dock test read the column order right after `setViewportSize` and
   a click (`columnBecomes` polls now); the group-warp drag read the lattice before it had settled to the `lean=1` pose (it is
   read until it holds still); the git dialog focuses its message field after the rows are drawn (`until`, not an assert).
4. **The editor is still loading when the test starts.** Pages that open `editor/` wait for `networkidle` after `goto` (a
   `page.goto` wrapper installed by `before`, so each of the 34 sites gets it).

## Watching

Rows stay until several more full runs are green. The five first recorded, then the ones the repeated runs added:

| Test (start of its name) | Cause above | Notes |
| --- | --- | --- |
| `files panel: a delete toast offers Undo, and Restore from Trash …` | 1 | the picker is reopened with `palette` before the second query |
| `timed menu: the bar shows and, when the time runs out …`, `timed menu: opening the pause menu holds the bar` | 2 | |
| `timed menu: with Timed choices off …` | 2 | only ever failed once, after 6 s |
| `build dialog: errors block, warnings need a tick …` | 1 | the Escape that closes Translations clicks into it first |
| `debug console: set, eval and vars …` | ? | not seen again in the repeated runs; probably the same load as the others |
| `voice dialog: …`, `git commit dialog: …`, `translations dialog: …` | 1, 3 | |
| `animation studio: a section is dragged …` | 3 | |
| `find all uses: …`, `variable rename: …` | 1 | |
| `files panel: renaming an asset rewrites the scripts …` | 1 | seen once after the palette fix and before the `networkidle` wait: the Enter on the rename item did not run |
| `animation studio: Model | Animate, Model hides the picker and timeline …` | ? | failed once in a full run (2026-11-08), passed alone |
| `animation studio: warp points are chosen by rectangle …` | 1 | failed once in a full run (2026-11-08) after the group-warp frame-track fix, passed alone twice; failed in one of two full runs later that day, passed alone and in the second |
| `touch: a long press opens the pause menu …`, `touch: a tap advances; swipe right rolls back …` | ? | each failed once in a full run (2026-11-08), passed alone; touch gestures time their pointer events, so a busy machine may stall them |

Earlier, a 4-job run once failed a single pointer/timing test (the test was not recorded).

## Things still worth trying

- Cap the jobs for the heavy studio tests (a second, serial `describe`) or lower the default: 3 jobs ran clean once at 146 s
  against 100 s for 6, and 4 jobs (136 s) still failed, so the cost of fewer jobs is large and the races above were the cure.
- The product takes the focus after a late load (a palette closed by a tree redraw): worth a look on its own, since a slow
  machine does the same to a person typing.
