# TODO

Format: `- [ ]` open, `- [~]` partly done, `- [-]` deferred until much later (tagged **DEFERRED**).
Finished items are removed (git history has them). Sub-bullets are details; "Left:" lists what remains.

Phasing (a rough order, not a schedule; sections below are by topic, so use the tags):
1. **Now**: untagged open items (`[ ]`, `[~]`), picked by value and size. Tutorial and docs come after the features they describe.
2. **DEFERRED (later)**: wanted, but needs a design or outside assets first.
3. **DEFERRED (much later)**: only once measurements or real hardware show a need, or as nice-to-haves after everything else
   (high-contrast theme, dyslexia font, text-to-speech).

## Next up

- [-] **DEFERRED (later)** Video: a `movie` command for cutscenes and animated backgrounds (format support, skipping,
  captions, preload and desktop pak handling).
- [-] **DEFERRED (much later)** Asset unloading (step 4 of docs/asset-loading.md; steps 1-3 are done)
  - Start with (a) only once the verification item below shows memory is a real problem.
  - Only when over a memory budget (estimated bytes: images w*h*4, decoded audio duration*rate*channels*4;
    defaults ~512 MB desktop/web, ~256 MB low deviceMemory, overridable in game.json), so most games never unload.
  - Never evict: what the current DisplayState shows (incl. the outgoing bg of a running transition), assets named
    by preload tasks within the lookahead, the always-needed list, and assets of the last ~10 lines (rollback).
  - Evict by furthest next use: attachPreloads' forward walk gives each asset's distance to its next use from the
    current pc (unreachable = infinity); ties go to least recently used.
  - Evict only at safe moments (after a scene change settles, like `releaseStale`); destroy the texture, not just
    the map entry; a missing file is always awaited by `ensure()`, so the worst case is a short hold, never a placeholder.
  - Stream long music through a media element instead of holding decoded PCM (~60 MB per 3 min track); keep
    decoded buffers for sound effects and short loops (mp3 loops are not gapless when streamed).
  - Write the chooser as a pure function (resident assets with size/lastUsed/nextUse, protected set, budget -> keys)
    and unit-test it; add an editor readout: resident vs budget, evictions, "late loads" (needed while not ready;
    should be 0 when playing straight through).
  - Gallery images load through CSS outside the Pixi cache: generate thumbnails at export time.
  - Order: (a) size accounting + budget + readout, no eviction; (b) music streaming; (c) image/sound eviction;
    (d) tune lookahead, budget and rollback window with real art and a real network. Do (a) first and look at the numbers.
  - Watch out: hot reload in the editor must keep working; unloading must destroy textures that sprites still hold
    and must not free anything on screen or needed by the lookahead; the Pixi Assets cache keeps old `?v=` copies
    of edited files (replaced textures are released at the next sync, the cache entry is not).
- [-] **DEFERRED (much later)** Verify asset loading beyond the synthetic project on localhost: real network, a low-end
  device, the web export (`npm run export`), the corrupted-PNG fallback, and that no placeholder ever flashes.
- [ ] Replace the generated placeholder sample art (simple shapes) with real art when there is some.
- [~] Royalty-free audio for the demo project: CC0 files are in `demo/assets/` (credits in `demo/CREDITS.md`), not in
  `sample/`, which stays the silent unit-test project. Left: a `thunder` file (candidate: OpenGameArt "Rain + Long Thunder", CC0).

## Documentation

- [ ] Write tutorial and introduction. Do this last, after all the essential features are done, so refactors don't invalidate it.
  - The tutorial walks through the separate demo project `demo/` ("Rainy Day Library", `vn dev --project demo`, or the
    `vn-demo` preview config on port 5174), not `sample/` (the unit-test project).
  - Demo left: grow it chapter by chapter as features land (screens, `animate`, layered PSD character, persistent/gallery
    unlocks, input, nvl), real art, scripted page flips, a thunder sound, a browser/playtest check in `npm test`.
  - Tutorial left: pages on the PSD art pipeline (a layered-character chapter: PSD layout, `npm run art`, rig.json, the Animate
    studio, `show` / `animate`; today only the README and docs/rig-json.md cover it), localization and web export, more
    screenshots (`docs/tutorial/img/`; retake them when the demo art or editor look changes), and a check that the quoted
    snippets still match `demo/` after the features settle.

## Presentation

- [~] Sprite/character positioning refinements
  - Left: no browser test of the rendered anchor bounds (the renderer exposes no handle; checked by screenshot), and anchors from `rig.json` (e.g. `head` at the real neck pixel).
  - Left: placing on top of a real scene background and several characters at once (the studio shows one character on black).
- [ ] **NEEDS PLANNING** Mesh-warp animation for layered characters (a Live2D-like look without Live2D): rig.json parts get warp
  deformers (e.g. hair sway, breathing, cloth) drawn with Pixi 8 `MeshPlane` / `MeshRope`, on top of the rigid-part animation
  (pivots, `part` keys). Chosen over embedding Live2D because Cubism Core is a proprietary WASM runtime with licensing
  limits on bundling and redistribution, and the popular Pixi wrappers have targeted Pixi 6/7. Open questions for the plan:
  - Deformer model: grid size per part, which channels (control-point offsets? bend/sine/noise presets?), and whether keys
    animate control points or a few high-level parameters (`sway`, `bend`, `stretch`).
  - Data: where it lives in `rig.json`, validation in `checkRig` / `checkAssets`, and what persists in `SpriteState`
    (same constraint as the animation system: persistent motion lives in state, one-shots stay transient).
  - Editing: animation studio support (a lane per deformer, a way to see and drag control points), or hand-written first.
  - Rendering cost and reduced motion (loops off), and how a mesh part interacts with slot variants and `order`.
  - Whether Live2D import (a `live2d` character kind via a Pixi plugin) is still wanted later; check Pixi 8 plugin status and
    the Cubism license first.
- [ ] Keyframe animations for flat characters (one image per pose, like alice): whole-body keys need no parts, but only
  characters with a `sprite.json` get a rig.json, appear under Characters and open in the studio.
- [~] Link the script and the studio (F12 on `animate`, "Try in scene", "Insert in script" exist; no browser test).
  - Left: a hover link; opening the studio from a `show` line starts from that placement.
- [~] Studio stage: the pivot of the part chosen in "Lanes of" is only shown while picking, and after Apply the stage shows
  the rest pose while the playhead sits on a key.
- [~] Parts tree in the animation studio. Left: no keyboard arrows (Tab moves through its buttons).
- [~] Character outfit variants in the PSD converter.
  - Left: not tried with a real PSD. Assets open in a viewer dialog (images, sounds, fonts); no PSD-layer preview.
- [~] Voice lines (`assets/voice/[<lang>/]<line id>.*`, see `engine/src/voice.ts`).
  - Left: no completions, no warning for lines that lack a recording, no ducking of music, no per-character volume, NVL lines
    voice each line as it is added, the prefetch and auto-advance wait are not covered by a browser test, not listened to
    with a real recording.

## Accessibility

- [~] Keyboard and gamepad navigation, tabbed options, on-screen keyboard for name prompts.
  - Left: try with a real gamepad (only tested with a simulated one); non-standard pad mappings; the on-screen
    keyboard is Latin + å ö ä only.
  - Left: text-to-speech (**DEFERRED (much later)**, with a high-contrast theme and a dyslexia-friendly font option).

## Tooling

- [~] Debug console in the dev preview (`preview/debug.ts`, grammar in `engine/src/debug.ts`).
  - Left: no browser test; a `set` or `jump` is not undoable; no completions or hover for the commands; no live variable table that
    updates while playing; no timers/skip-to-line/force-random utilities; `unlock` only affects the next playthrough.
- [~] Editor UX evaluation: go over the editor's usability as a whole and look for improvements to the overall experience.
  - Kept on purpose: Problems appears in both the editor toolbar and the preview header (the preview's opens its own list).
- [~] Problem counts differ between the editor (includes every character's rig.json) and the preview header (script and
  game.json only).
  - Left: the fresh sample opens with 6 missing-audio warnings; consider a short silent placeholder track/sound for the sample.
- [ ] Adding art from the editor (drop files on the Assets panel); today files are copied into `assets/` or `masters/` by hand
  (the sidebar picks them up live).
- [~] Files panel as a tree. Left: rename, delete and move for files and folders (right-click menu).
- [~] Browser tests: make the timing-sensitive ones (polygon hotspot, HUD, gamepad) wait on state instead of fixed presses.
- [~] Task output panel (`/api/task` streaming, clickable `file:line` references). Left: no browser test.
- [~] Story outline: the Outline button draws labels, jumps, calls and run-on edges as a flowchart.
  - Left: back edges still arc below the nodes and can pass through labels in the same columns; not looked at on a real large storyline.
- [~] Variable rename in the editor (F2, `engine/src/var-refactor.ts`).
  - Left: game.json text is not scanned; no browser test for the locale rewrite.
- [~] Find all uses of a variable or label (Shift+F12, `variableUses`; Ctrl+Shift+F seeds the word under the cursor).
  Left: not tried in the browser, no browser test.
- [~] "Did you mean" quick fixes: not yet for game.json names or rig.json keys.
- [~] Screens preview and built-in screen UX.
  - Left: custom `screen`s the project declares itself are not listed for preview; no browser test for the sidebar click yet.
- [ ] Translation: a side-by-side view of the source script and each locale, plus an export of all dialogue with context
  (speaker, scene) for translators. Not necessary for now.

## Shipping

- [~] Desktop app: Electron wrapper (`vn export --desktop`, docs/desktop.md) with saves stored as files.
  - [-] **DEFERRED (much later)** Run the installer build (`npm run dist`) and try it on Linux and macOS; only Windows `npm start` is verified.
  - [ ] Maybe let users drop modifier scripts in the folder that override some variables (needs a definition first).
- [~] Configurable stage size (portrait / mobile targets). One size per project; a portrait version is a duplicated project
  with its own art and presentation, not a responsive layout.
  - [ ] Not done: the stock text box, title, pause and options screens are still laid out for landscape (a portrait project
    supplies its own `screen`s; the editor's "Built-in screens" starters are positioned for 1920x1080 too).

## Gameplay modes beyond VN (ideas, TBD)

- [ ] View/animation mode: an interactive element with animations; click on element X while playing to trigger a
  sound and affect the animation. Needs the persistent HUD / animated screen elements (not in screens v1).
- [ ] Point and click adventure mode: inventory, hotspots. Blocking screens and a HUD exist (hotspots over the live scene with no `image`, inventory via `each`, a verb bar via `hud on`); left: using an item on a hotspot (drag and drop), cursor verbs.

## Known gaps (user stories)

Things a visual novel author or player would expect that the engine lacks. Not scheduled: when one is picked up, move it
to "Next up" as a task and leave a pointer here. Format: *As a ..., I want ... so that ...*

- [~] As a writer, I want options that are visible but disabled (with a reason), a marker on choices already taken,
  a prompt line above a menu and timed choices.
  - Left: custom `screen` data for the choice menu (menus are not screens yet), seen marker in the editor preview.
  - Left, by plan: timers for `input`/`screen`, a `timeleft` variable, per-menu extended time, saving the clock.
- [~] As a writer, I want variables formatted in text and right-to-left text.
  - Left: right-to-left text; no hover for the format.
- [ ] As a player, I want an achievements list with notifications and an endings page, kept apart from saves.
- [ ] As a player on a phone or tablet, I want touch gestures (swipe back, tap zones), safe-area insets and orientation
  handling; and a wrapper that ships the game to iOS/Android.
- [-] **DEFERRED (much later)** As a player, I want a high-contrast theme, a dyslexia-friendly font option and text-to-speech.
