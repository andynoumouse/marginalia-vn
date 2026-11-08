# PX report: exported web build as shipped, plus extras (as returned by the tester)

S1: 0 | S2: 6 | S3: 13 (19 findings). Scripts t1..t9, lib.mjs, play.mjs and shots in scratchpad/ux/px (numeric prefixes restart per script run).

## Scope
Exported `sample` and `demo` with the real `tools/export-web.mjs --no-build --no-playtest`, once per variant: plain, `pwa:true`, long title with `labels` and `locale/fi.json`. The export wrote `build/web` into each project copy; copied to <px>/site/{sample,demo,sample-pwa,sample-long}. Served with own static host at http://localhost:<port>/marginalia-vn/<game>/ (gzip, 10-minute cache, Range, 301 for folders, like GitHub Pages). Headless Edge, 1280x720 unless noted. CDP throttling: fast 3G = 1.6 Mbit/s, 150 ms; slow 3G = 400 kbit/s, 400 ms. Request/byte counts from own server log (CDP does not see Pixi's image fetches).
Not tested: touch (PI), real phone, Safari/Firefox, real audio, SW update path, scene-change hitches on slow 3G beyond first scene, demo with missing audio, New game with an existing save (storageState attempt failed on the port change).

## Task log
1 Cold load: done. Local: first-paint 136 ms (just the dark page), interactive title 0.8-0.9 s, 169 requests, 4.9 MB (147 are `.js` modules, music 2.9 MB). Demo: 1.1 s, 182 requests, 4.8 MB. Page title is the game title. No favicon for sample. Fast 3G: title at 26 s. Slow 3G: title at 41.6 s and 41.9 s (twice). Continue is `aria-disabled` and dimmed on a fresh browser. Player cannot click New game early because buttons don't exist until assets arrive. Stalled: black page, then the title wait.
2 Dev leakage: done, mostly clean (PX-15). Offline reload without `pwa` gives the browser's own error page. With `pwa:true` the offline reload loaded the title in 0.9 s and played a few lines offline, but nothing in the game says it works offline.
3 Persistence: done. Save in slot 1 took 1 click, immediate thumbnail, time and line. Continue after reload resumed the right line. Settings tracking not exercised. A second context started clean. Different ids (sample and demo) don't collide; same id (sample and sample-pwa) shares saves (as documented). Start-over or clear data not findable (PX-5).
4 Failure behaviour: done. 404'd bg, sprite and music: game kept playing. Corrupt saves: no crash. Missing locale file: silent.
5 Window: done, no clipping or scrollbars. 4:3 (1024x768) stage 1024x576; ultrawide 2560x1080 1920x1080 pillarboxed; tall 600x1000 600x338 band; 800x400 711x400. Mid-game resize refits. Fullscreen works.
6 Extras: done. Sample and demo configure all four, title shows all four buttons. Unlocking by play worked: 2 of 2 gallery images, the music track, 2 chapters and both achievements in the sample. ~12 steps per script.
7 Endings: done. Sample good ending ~12 choices; demo: New game, Take the guided tour, Just a quiet corner.
8 Title: done with friction (PX-4, PX-8, PX-9).

## Findings
PX-1 · S2 · perf · Black page with no loader until about 150 requests finish. `node <px>/t1.mjs sample fast3g` (also slow3g). First-paint 212 ms shows only the dark background; the stage is `visibility:hidden` until `fit()` runs. Stage and the 8 px loading bar appear at 6.2 s (fast 3G) and 20.4 s (slow 3G), after all `dist/**/*.js` modules (147, unbundled) have been fetched one after another. index.html holds no text or spinner. Evidence shots/px01-sample-fast3g-early.png (pure black). Reproduced (fast 3G once, slow 3G twice). Known: no (TODO.md only lists "verify asset loading on real networks").

PX-2 · S2 · perf · Title waits for the 2.9 MB title music and three SFX. Title interactive at 26.1 s (fast 3G) and 41.6 / 41.9 s (slow 3G). Bg and music finish ~25 s, then the buttons appear. A player can't start before the music is downloaded though audio can't play before a click anyway. Documented as intended (docs/asset-loading.md, README "Loading"), so a design call. Reproduced. Known: by design.

PX-3 · S2 · bug · First line after New game takes 26.7 s on slow 3G, and the loading bar overflows. `node <px>/t1b.mjs slow3g` (also t1.mjs slow3g). Black stage plus quick menu, no text. The bar is thin and grey (low visibility, over the quick-menu row) and reports width `200%` for 19 s. First line appears at about the 20 s cap (`HOLD_MAX_MS`) after the second wait begins. Suspected cause (not verified): in asset-loader.js, overlapping `ensure()` calls add the same in-flight keys to `barTotal` twice, and counters reset while earlier completions still fire. Fast 3G fine (1.7 s). Also no "Loading" text for the player or screen reader beyond the progressbar role. Evidence <px>/t1b-slow.log, shots/px04-sample-slow3g-play3.png. Reproduced twice. Known: no (TODO lists the "placeholder never flashes" check as unverified).

PX-4 · S2 · visual · Long game title runs over the menu buttons. `node <px>/t8c.mjs` (edits a copy of the exported project.json). 38 chars: 1 line, fine. 50 chars: title bottom at y=220 against first button top at y=176 (720p). 90 chars: 3 lines, covering "New game" and "Continue". Also with `sample-long`: the disabled Continue label unreadable under the title. Expected: title shrinks or buttons move down. Evidence shots/px01-long-title-1280.png, px02-long-title-tall.png. Reproduced. Known: no.

PX-5 · S2 · usability · No way to reset progress or clear data in the shipped game. Options (Audio, Game, Accessibility tabs) and the pause menu have no reset or clear. Only deletion is the × on a save slot. Page markup contains no "reset", "clear" or "erase" text. Gallery, achievements, chapters and read-text flags (`images`, `unlocked`, `chapters`, `music`, `seen`, `options-taken`) can only be cleared by clearing browser site data. "Reset player data" exists only as an editor command (docs/editor.md) and in the dev Debug console. No save export or import either. Known: partly (TODO.md "export and import saves in the web build").

PX-6 · S2 · usability/i18n · The end screen is dev wording, hard-coded and low-contrast. Both games show only "End of script. Click to return to the title screen." in small grey text in the middle of the stage, over Alice and the art, no dim. String hard-coded at dist/preview/preview.js:780 (and index.html:387, "Click to restart", overwritten). Not a `ui.*` label, so can't be translated or set through `labels`. Code reading; not re-run in fi. `Turn your device to play.` likewise literal in index.html. No recap and no "replay / other endings" shortcut. Demo's last story line says "Open the editor to see how each of these lines was written" (demo content). Wording is the weak part: the single click back to the title works, Continue then offers the last line, the ending toast shows ("Ending reached / A thank-you note"). Evidence shots/px01-end-screen.png (t6b.mjs). Reproduced (sample and demo). Known: no. (Same as PC-4.)

PX-7 · S3 · bug · Favicon 404 and console error on every load of a game without `icon`. Sample has no `<link rel=icon>`, so `/favicon.ico` is requested twice per load (404 + console error). Demo, with `icon` set, ships icon.png and a link, no 404. Reproduced. Known: no. (Explains the 404 seen by EA, PI, PC, OB.)

PX-8 · S3 · bug · A `labels.music_room` override also renames Options "Music volume". `labels: { "music_room": "Listen to the Soundtrack" }` makes the Audio tab row read "Listen to the Soundtrack 70%". `uiText` in menus.js maps by English source text; comment says "the button's label wins". `ui.music_room` and `ui.music_volume` can therefore never differ. Reproduced once in t8.mjs, plus code reading.

PX-9 · S3 · usability/a11y · Language control. Reads "en ▾" / "fi ▾" (raw codes, aria-label the same), and `<html lang>` stays "en" after switching to fi. With `locale/fi.json` missing (still listed in project.json): Options shows "fi ▾", all text stays English, no message, and locale/fi.json is re-requested (404) on every load. With the file present, fi works and persists across reload. Evidence t8b.mjs, t4.mjs.

PX-10 · S3 · usability · Missing assets are silent, and the placeholder shows the raw asset key. A 404'd bg draws a purple gradient with "bg_park_night" top-left; game continues. Missing music gives only a console warning; a missing alice/smile.png sprite didn't stop the game (frame not inspected). Title still opened in 0.4 s with title music missing. Nothing tells the player or author in-page. Evidence shots/px03-broken-night-missing.png.

PX-11 · S3 · usability · Corrupt saves look like empty slots. Garbage in `save.auto`, `save.1`, `save.quick`: title loads, Continue disabled, Load shows "Empty". Raw data kept under `corrupt-save.N` and a console warning logged; player sees nothing. `save.2` with `{"v":99,"step":3}` also showed Empty. Clicking an empty slot in Load does nothing, no crash. Evidence shots/px06-corrupt-load.png.

PX-12 · S3 · usability · Locked entries give no unlock hint. Gallery "? Locked", Music room "Locked", Chapters "Locked" (names hidden). Only achievements show a description; `hidden` ones show "???". All four show counters ("0 / 2", "Endings 0 / 1"). The locked Gallery's dim backdrop is gallery image 1 itself (the title background). Evidence shots/px01-locked-Gallery.png.

PX-13 · S3 · usability · Chapters starts a new playthrough with no warning. Picking a chapter in the sample or demo ran straight in. Demo's autosave changed (8760 to 8549 bytes), so Continue no longer points at the old position (not verified that Continue resumes the chapter). Chapter variables start empty as documented; demo's hub didn't crash.

PX-14 · S3 · usability · `pwa:true` hygiene. With no `icon`, manifest has `"icons": []` (not installable in Chrome) and export reports 0 warnings. `short_name` cut mid-phrase ("Evening in"). Offline works but isn't announced. Evidence <px>/site/sample-pwa/manifest.webmanifest.

PX-15 · S3 · taste · Dev code and markup ship. `dist/engine/src/editor-support.js` (completions) is fetched by the exported game, and hidden dev bar markup (`#bar`, `#debugBtn`, "VN preview") is in the DOM with display:none. No `/api` or SSE calls. `EventSource` and `/api/project` are behind `devMode`. Source `src` stays in project.json (known, TODO "Precompiled script").

PX-16 · S3 · usability · Fullscreen exists only in Options. After the click the label stays "Fullscreen"; no pressed state or "exit". The `f` key does nothing. Known: partly (TODO.md "fullscreen button outside the Options screen").

PX-17 · S3 · visual/taste · High-DPI and portrait. Canvas fixed at 1920x1080 internal pixels, so at DPR 2 art edges show slight stair-stepping while DOM text stays crisp (shots/px06-dpr2-sprite.png). A portrait window gives a 338 px band with text ~13.8 px effective. Known (TODO "configurable stage size").

PX-18 · S3 · visual · Gallery viewer: "Back" sits flush against ">" at the bottom right (mis-click risk). Arrows wrap around; counter ("1 / 2") clear. Evidence shots/px04-viewer.png.

PX-19 · S3 · docs · Same-id collision. Two folders exported from the same title share saves. Documented in exporting.md, but nothing warns an author who uploads a test copy beside the release.

## What worked well
- Title in under 1 s on a fast link, progressbar before the title; code, art and audio are relative-path clean and work in a `/marginalia-vn/sample/` subfolder.
- Page title is the game title. `/api` and `/__events` never called; a missing music file does not block the title.
- Saves, settings and read-text flags persist after a reload and stay separate per browser context. Different game ids on one origin don't collide.
- Missing art falls back to placeholders and the story keeps going; corrupt data is preserved, not deleted.
- Language switch works and survives reload. Finnish title labels replaced the `labels` overrides correctly.
- Offline PWA reload works and plays offline.
- Achievement toast top-right, readable, ~3 s. Counters "0 / 2" on every extra, hidden achievements show "???", gallery viewer has counter, arrows and Esc.
- Save slots give immediate feedback (thumbnail, time, line) and a ×. Continue disabled when there is no save. Stage refits on every resize without scrollbars; DOM text crisp at DPR 2.
