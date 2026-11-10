# UX test round, November 2026: summary

Nine testers each used a slice of the editor or the player the way a real person would, with real mouse and keyboard
input in headless Edge (and Electron for Studio), and wrote down where it was confusing, slow, inconsistent,
inaccessible or broken. This file ranks what they found; each tester's full report (steps to reproduce, evidence, what
worked well) is in the file named in the table. Finding ids are the tester's prefix and a number (`EP-3` is item 3 in
`ep.md`).

| Report | Slice | S1 | S2 | S3 |
|---|---|---|---|---|
| [ea.md](ea.md) | Editor: writing a story from nothing (completions, diagnostics, preview loop, F2, F1, keys) | 0 | 8 | 12 |
| [ep.md](ep.md) | Editor: Files panel, drops, trash, git, game.json, dialogs, Build and export | 0 | 11 | 19 |
| [es.md](es.md) | Animation studio, as a character artist new to it; adding a PSD | 0 | 10 | 11 (+1 known) |
| [el.md](el.md) | Editor frame: window sizes, keyboard, a11y, server failure, external edits, scale | 0 | 6 | 15 |
| [pc.md](pc.md) | Player: title to ending, saves, rollback, options (mouse and keyboard) | 0 | 5 | 18 |
| [pi.md](pi.md) | Player: phone and tablet, touch, keyboard-only, gamepad, accessibility | 1 | 8 | 8 |
| [px.md](px.md) | Exported web build on slow networks, persistence, failures, extras | 0 | 6 | 13 |
| [ob.md](ob.md) | Onboarding: README and tutorial chapters 1 to 5 followed literally | 1 | 8 | 7 |
| [st.md](st.md) | Marginalia Studio (Electron) and the online demo | 0 | 8 | 10 |
| | **Total (186)** | **2** | **70** | **113** (+1 known) |

S1 = blocks a task, S2 = real friction or a likely mistake, S3 = polish. Severities are the testers' own, except OB-1
(`vn init` on a fresh clone died with a raw `ERR_MODULE_NOT_FOUND`; the tester rated it S1, I would call it S2 because
the README's quick start builds first, but tutorial chapter 1's command-line route skips that).

## How far to trust it

Every finding is something a tester saw happen; most say "reproduced twice". I also read the code behind five of them
and each held: the label pattern is ASCII-only (EL-11, `engine/src/parser.ts:24`); Shift+F8 is Monaco's own action
while F8 is custom (EA-2, `editor/commands.ts:114-115`); the end-of-game text is hard-coded (PX-6,
`preview/preview.ts:772`); `robo.vn` still says "Rig mode" (ES-16); the preview page has no icon link (PX-7). I did
not re-run anything in a browser. Not verified: the cause the tester guessed for OB-3 (Preview from
cursor landing on a subroutine's first line) and for PX-3 (loading bar at 200%).

## Fix first

Ranked by how much harm it does, how many people it reaches, and how many testers hit it independently. Both S1s,
the first-hour docs and the quick bar's text halo are fixed, so the top is done. The rest is in `TODO.md`.

## Themes more than one tester hit

- **Adding assets and characters is hard to discover.** The "+" icons show only on heading hover (ES-3, EP-16, OB-6);
  Assets starts below the fold at 900 px (EP-5); a PSD dropped on Characters is refused with a hint naming a folder a
  fresh project does not show (ST-8).
- **The quick bar is hard to read.** About 7 px in the editor preview (EA-19), 8.7 px on a phone (PI-2), no backing, so
  contrast is 1.0 to 1.4:1 on light scenes (PI-4, PC-7), and it overlaps the text box edge.
- **Feedback is thin.** The status line is small, grey, truncated and stale (EA-9, EA-16, EP-15, EL-9); toggles, Reveal
  and view commands say nothing; the editor autosaves but the tutorial says press Ctrl+S (EA-9).
- **Names are ASCII only.** A Finnish label name such as `päivä_1` is refused (EL-11, confirmed); the message now names the
  character, but accepting accented letters in names is a language decision (see `TODO.md`).
- **Ending screen.** The short ending has no name of its own (PC-4); the "Turn your device" cover blocks a tablet that
  would fit the stage (PI-11).
- **Narrow windows.** Studio layout (ES-4), Outline's Close off-screen at 390 px (EL-20), online editor on a phone with
  no notice (ST-6).
- **Docs and product disagree.** Jargon the tutorial never explains (OB-15), the sample comment (ES-16) and "Rig mode"
  in two sample scripts.
- **Web export loading.** The modules are about 150 unbundled requests, 6 s on fast 3G and 20 s on slow (PX-1; the page now
  says it is loading meanwhile); title waits for the 2.9 MB music (PX-2, by design); first line about 27 s after New game on slow
  3G (PX-3; the bar's 200 % is fixed).

## Quick wins

The small ones (ES-16, EP-7, ES-11, ES-12, ST-1, ST-2, ST-3, PI-9, PX-4, the save confirmation of PI-7, the quick menu of PC-4) are
fixed, and so are PX-5 (Reset progress in Options), the bar of PX-3, the right-click and Ctrl+P routes of ES-2, ST-6 and ST-7, and the
names of the ♪ and `<` `>` buttons. Not as small as it looked: `labels.music_room` also renames Options' "Music volume" (PX-8), because the stock
screens are matched to their labels by English text; they would need to carry a label key.

## Needs a decision, not just a fix

- Follow preview (on by default) scrolls the editor back to the preview's line after every autosave, even when typing
  far away (EA-4).
- Autosave versus "save with Ctrl+S" in the docs (EA-9), and whether the editor should say it saved.
- Whether undo in the animation studio should switch to the animation it changed (ES-5), and whether key times should
  be seconds rather than fractions of Length (ES-7).
- What a first-time Studio user sees first: Open Folder is the only primary button (ST-5).
- Title-screen waits for audio on slow networks (PX-2, documented as intended).
- Whether the online demo should work offline (ST-15).

## What held up

No tester lost data in an edge case (undo past a save, tab closed right after typing, 3000-line paste, 6966-character
line, corrupt saves); the editor stays fast with 150 scripts, 1500 assets and a 5000-line script; reference-following
on rename and delete with Undo and Trash restore work well; completions and did-you-mean quick fixes are quick and
relevant; the preview returns to the line you were on after every reload; saves, Continue, rollback and History work as
documented; reduced motion, forced colours and the screen-reader dialogue live region work; touch gestures all work;
the web export is relative-path clean, makes no dev-server calls and survives missing assets and corrupt saves; the
animation studio opens in about 100 ms and keying is forgiving; the Studio app starts in about 1.2 s and its prompts
default to the safe choice. Each report ends with its own list.

## Caveats

- Headless Edge on a machine shared by up to six testers at once, with the art converter off (the kit starts the dev
  server with `--no-art`, so a dropped PSD was converted only through the palette's Reconvert). Timings are indicative.
- Not tested: real phones, a real screen reader, a real gamepad, audio, Safari and Firefox, macOS and Linux, native file
  dialogs and menu accelerators in Studio, Translate import, voice takes, a real project of useful size, git beyond the
  first commit.
- The online-demo findings are against `build/online`, which is engine 0.7.2 from 2026-11-04, 244 commits behind.
- `games/demo` had uncommitted work in progress during the run (a Feature index, `fx_*.vn`, edits to `start.vn`,
  `rooms.vn`, `game.json` and the locale file, last touched 13:36 to 14:06 on the day of the run). The testers copied it
  mid-session, so demo findings (PC-11 and PC-19, the demo parts of PX and ST) describe that in-progress version.
- Scripts and screenshots for each tester were left in the session's scratchpad and are not kept in the repository.
