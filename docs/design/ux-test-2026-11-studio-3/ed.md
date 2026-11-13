# ED report: the editor outside the studio (as returned by the tester)

Counts: S1 0, S2 4, S3 9.

Slice: scene writing, diagnostics, Outline and Statistics, Translations, dialogs, the studio handoff, narrow windows. Scripts (s01-s29) and
screenshots were in the session scratchpad under `kit/testers/ED/` and were not kept.

## Scope
Edge (playwright-core) at 1600x900; 900x800 and 600x800 for the narrow pass. Game: sample (a copy; demo not used). Characters: robo for the
handoff. All six jobs covered. Not covered: the studio's own editing (other testers), Voice beyond focus handling, the Theme panel, git, the
desktop build target. No page or console errors in any of 29 scripts.

## Task log
1. **Branching scene, two named endings, typos: done.** New script, a 21-line paste, Ctrl+Enter, and both routes played to the end screen in
   about 7 s of interaction. The end screen shows "Bitter Night" / "Quiet Leaf" with "Click to restart". Script typos all gave clear messages:
   - "menu" needs a colon at the end of the line: menu:
   - Unknown label "cafe_ned" (did you mean "cafe_end"?)
   - Unknown character "robbo"
   - background `bg_park_evning`
   - layer "cheerfull"
   - animation "wavee"

   rig.json typos also say "did you mean" (`no bone named "spien" ... (did you mean "spine"?)`). game.json has friction (ED-6, ED-8). (Errors from
   a first attempt with playwright `insertText` were an artefact; a real Ctrl+V paste indents correctly.)
2. **Outline and Script statistics: done with friction.** Outline nodes read "cafe 5 words · 1 choice" and "cafe_end 8 words · ends". Hovering a
   node gives "1 line, 5 words, 1 choice menu - never reached from the start". Script statistics is only in Ctrl+P (`>stat`, second hit); no
   toolbar button or link from the Outline. The new endings are missing from it (ED-2), and the Output panel opens scrolled to the bottom (ED-9).
3. **Translations: done with friction.** "Add ids to all files", added `fi`, typed 2 lines; the position link `cafe.vn:6` jumped to the line.
   Export CSV downloaded `translations.csv`. Importing an edited CSV gave the confirm "3 new, 1 changed ... Skipped an id no line of the script
   has (#zzzz)". After a line was deleted, "1 unused entry in locale/fi.json · Remove unused" appeared and its confirm named `#ppjl`. The preview
   in fi showed "Kahvi!", "Tee" and the ending "Katkera yö". The stall: the added language vanished (ED-3).
4. **Dialogs, Build, Ctrl+P: done.** Translate, Outline, Build, Voice and Help trap Tab (0 of 26 stops outside), close on Esc, and return focus
   to the opening toolbar button. EL-5 and EP-9 are fixed. A web Build took 1.0 s ("Built into build/web ... 223 files, 6.9 MB"). Typing a label
   name in Ctrl+P creates a file (ED-1).
5. **Studio handoff: done.**
   - Hovering `animate robo wave` gives "Open robo's wave in the animation studio (F12)"; on `show robo`, "Open robo in the animation studio (F12)".
   - The right-click menu's first item is "Open in Animation Studio (F12)".
   - The studio opens in Animate mode with that animation selected (about 3 s).
   - "Insert in script" (under Place in scene) wrote `show robo at center` under line 12 and showed "Inserted under line 12 of robo.vn".
   - "Try in scene" applied, closed the studio and played from robo.vn:15.
   - Opened from the Files panel instead, "Try in scene" is hidden, as it should be.
6. **Narrow windows: done with friction.** At 900 px nothing scrolls sideways and the toolbar wraps to two rows. At 600 px a banner says "This
   editor needs a wider window (about 900 px or more)", the toolbar is clipped after "Variables", and the Outline's Close is cut off (ED-10).
   Translate and Build fit.

## Findings
**ED-1 · S2 · usability · Typing a label name in Ctrl+P creates a new empty script file**
- Steps: Ctrl+P, type `cafe_end` (or `bench_talk`), Enter.
- What happened: the only option is "Create cafe_end.vn". Enter creates `script/cafe_end.vn` with the content `# cafe_end.vn` and opens it.
  Labels need the `@` prefix, but nothing in the list hints at that once you type.
- Expected: offer the matching label ("@cafe_end, cafe.vn:15") above Create, or at least a "Go to label cafe_end" row.
- Reproduced twice. Known: no (related to EP-8, where Create is the fallback).

**ED-2 · S2 · usability · Script statistics silently leaves out endings the start cannot reach**
- cafe.vn has `end "Bitter Night"` and `end "Quiet Leaf"`. The Routes section lists only park.vn:50 "An Early Night" and three town.vn endings.
  Nothing says that 2 endings are not reachable from the start (the Outline does, on hover). An author checking "words to each ending" for a new
  chapter sees their endings missing and doesn't know why.
- Also: unnamed endings show as a bare `town.vn:154`. The heading "shortest route, then the most different lines one route reads" is hard to parse.
- Expected: a line such as "Not reached from the start: cafe.vn:18 "Bitter Night", cafe.vn:21 "Quiet Leaf"".
- Reproduced twice. Known: no.

**ED-3 · S2 · bug · A language added in Translations is lost if you close the dialog before typing a translation**
- Steps: Translate, type `fi` in "new language", Enter. The dialog shows "fi" and "0 of 324 translated". Esc, then open Translate again.
- What happened: "No translations yet: add a language code above to start one." A page reload does the same. No locale/fi.json is written until
  a line is typed.
- Expected: create locale/fi.json (`{}`) on Add, or say "fi is kept once you translate a line".
- Reproduced twice (close and reopen, and reload). Known: no.

**ED-4 · S2 · bug · Preview from cursor pops "Achievement unlocked: Into town" for a story that never went to town**
- Steps: Preview from cursor on `label cafe:` (cafe.vn) or on robo.vn line 15 (via Try in scene).
- What happened: the toast "Achievement unlocked · Into town · Leave the park behind." appears top right. `unlock town_visit` is only in
  town.vn's `town_square`. It appears in English even with the preview language set to fi.
- Likely cause (not verified): the fast-forward to the cursor runs a route through town_square and keeps its unlocks.
- Why it matters: an author testing achievements would conclude the unlock is wired wrong, and the unlock persists in the preview's player data.
- Reproduced 4 times. Known: no.

**ED-5 · S3 · bug · The fresh sample opens with "Problems: 3"**
- Three rig.json warnings, otherwise clean (the preview says "Problems: 0"): robo `rig.json:123 deformers.head_warp.members: "eyes" has a frame
  track in an animation; a warped part cannot swap frames`, the same for "mouth", and one in mina/rig.json.
- The first click on the orange "Problems: 3" opens mina/rig.json, not a list.
- Could be a regression from the warp changes, or the sample needs updating. Reproduced on every fresh copy. Known: no.

**ED-6 · S3 · bug · The preview's "Problems" ignores game.json schema warnings although its tooltip says it counts game.json**
- With `"galery"`, `"histroy"` and `"theem"` in game.json, the header says "Problems: 15" and the preview says "Problems: 9" (script only). The
  preview list has no game.json rows. The tooltip reads "the preview header counts the script and game.json only".
- The quick bar silently drops "History".
- Reproduced twice. Known: no.

**ED-7 · S3 · bug · Build warning text repeats the language, and its counts differ from the Translations dialog**
- The warning reads "Untranslated strings fi fi: 213 of 217 strings untranslated", while Translations says "4 of 323 translated".
- Known: partly (EP-22, differing counts); the doubled "fi fi" is new.

**ED-8 · S3 · usability · A misspelled game.json key gives no "did you mean"**
- `"theem"` gives "Property theem is not allowed.". Enum values do list the valid choices. Script and rig.json typos suggest a fix; game.json
  keys do not. Known: no.

**ED-9 · S3 · usability · Script statistics opens in the Output panel scrolled to the end**
- You first see the bottom of the Labels table; the totals and Routes are above the fold.
- The palette description "(words, lines and reading time per script, label and character)" doesn't mention routes or endings, so `>ending`
  and `>route` don't find it. Known: no.

**ED-10 · S3 · usability · Outline at 600 px: Close is cut off and the hint text wraps into a 9-line column**
- The Close box starts at x=568 with width 56 in a 600 px window. Esc still works.
- Known: yes (EL-20, which was at 390 px; it now also happens at 600).

**ED-11 · S3 · usability · Small text details**
- The Import confirm says "overwritten in locale/<lang>.json" instead of locale/fi.json.
- The "new language, e.g. fi" placeholder is clipped at 1600 px.
- Remove unused and Import give no "done" message; only the counts change.
- "Inserted under line 12 of robo.vn" appears only in the studio's small grey footer.

**ED-12 · S3 · docs · robo.vn's header comment is out of date**
- It says "Open the character in the animation studio (Animate in the Files panel) and switch to Model mode". There is now a Model button beside
  Animate, and F12 or hover works from the script.

**ED-13 · S3 · a11y · Tabbing with no dialog open walks into Monaco and indents the script, which is autosaved**
- Focus Variables (a panel, so it doesn't trap focus) and press Tab 25 times. 14 Tabs landed in the editor and park.vn line 1 gained 28 spaces,
  saved with no notice.
- Known: yes (EL-6).

## What works well
- Diagnostics: every script and rig.json typo tried had a precise message with "did you mean".
- Named endings work end to end: the end screen title, the outline, the CSV (`kind = ending`) and the translated ending in the preview.
- Translations: string positions jump to the line, the CSV round trip is clean, the import confirm names skipped ids, and Remove unused names
  the id and warns there is no undo.
- The shared modal frame traps Tab, closes on Esc and returns focus to its toolbar button in Translate, Outline, Build, Voice and Help.
- Build checks plus export took about 1 s, with a clear result line.
- The studio handoff is smooth: hover link, F12, the right-click first item, the right animation preselected, "Insert in script" with
  confirmation, and "Try in scene" playing from the line you came from.
- At 900 px there is no sideways scroll and the toolbar wraps. At 600 px the "needs a wider window" banner is honest.
