# TODO

Format: `- [ ]` open, `- [~]` partly done, `- [x]` done, `- [-]` deferred until much later (tagged **DEFERRED**).
Sub-bullets are details; "Left:" lists what remains.

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
- [~] Royalty-free audio for the demo project: CC0 `evening_theme` (music), `rain` loop and `page_flip1-3` are in
  `demo/assets/` (credits in `demo/CREDITS.md`), not in `sample/`, which stays the silent unit-test project; the page flips
  are played in the tour. Left: a `thunder` file (candidate: OpenGameArt
  "Rain + Long Thunder", CC0).

## Documentation

- [ ] Write tutorial and introduction. Do this last, after all the essential features are done, so refactors don't invalidate it.
  - An example project that introduces a lot of the tech (script language, menus, screens, art pipeline, export, ...).
    It is a separate demo project, not `sample/` (the unit-test project, whose scripts and choice order tests depend on).
  - Started: `demo/` ("Rainy Day Library", `vn dev --project demo`, or the `vn-demo` preview config on port 5174).
    One script (`script/start.vn`) with a short tour (scene/music/rain/sound, movement, variables, tint, a menu), generated
    placeholder bg and one character (`iris`), and the staged audio copied in. Left: grow it chapter by chapter as features
    land (screens, `animate`, layered PSD character, persistent/gallery unlocks, input, nvl), real art, scripted page flips,
    a thunder sound, a browser/playtest check in `npm test`, then the tutorial text and screenshots.
  - The tutorial walks through that project and includes screenshots of it.
  - Screenshots so far: `docs/tutorial/img/` (the editor on the demo, taken with a throwaway playwright script against
    `vn-demo`; retake them when the demo art or editor look changes), shown in `docs/tutorial/00-the-editor.md` and the README.
  - Started: `docs/tutorial/` has four text pages (first scene, choices and variables, staging and effects, screens and
    memory) that quote the demo scripts. Left: pages on the PSD art pipeline, localization and web export, screenshots, and
    a check that the quoted snippets still match `demo/` after the features settle.

## Presentation

- [~] Sprite/character positioning refinements
  - Left: no browser test of the rendered anchor bounds (the renderer exposes no handle; checked by screenshot), and anchors from `rig.json` (e.g. `head` at the real neck pixel).
  - Left: placing on top of a real scene background and several characters at once (the studio shows one character on black).
- [ ] **NEEDS PLANNING** Mesh-warp animation for layered characters (a Live2D-like look without Live2D): rig.json parts get warp
  deformers (e.g. hair sway, breathing, cloth) drawn with Pixi 8 `MeshPlane` / `MeshRope`, on top of the rigid-part animation
  above (pivots, `part` keys). Chosen over embedding Live2D because Cubism Core is a proprietary WASM runtime with licensing
  limits on bundling and redistribution, and the popular Pixi wrappers have targeted Pixi 6/7. Open questions for the plan:
  - Deformer model: grid size per part, which channels (control-point offsets? bend/sine/noise presets?), and whether keys
    animate control points or a few high-level parameters (`sway`, `bend`, `stretch`).
  - Data: where it lives in `rig.json`, validation in `checkRig` / `checkAssets`, and what persists in `SpriteState`
    (same constraint as the animation system: persistent motion lives in state, one-shots stay transient).
  - Editing: animation studio support (a lane per deformer, a way to see and drag control points), or hand-written first.
  - Rendering cost and reduced motion (loops off), and how a mesh part interacts with slot variants and `order`.
  - Whether Live2D import (a `live2d` character kind via a Pixi plugin) is still wanted later; check Pixi 8 plugin status and
    the Cubism license first.
- [~] Voice lines: `assets/voice/[<lang>/]<line id>.*` plays with the line (`voiceFile` in `engine/src/voice.ts`, `AudioSystem.voice` on its own bus with a Voice
  slider in the stock and custom options, `setting` `voice`); auto-advance waits for it, advancing/skipping/rollback cut it, a replay button on the stock quick bar
  (`action voice`, key V). Tests: `voice.test.mjs`, browser "voice:".
  Preload: a voiced `say` adds a `voice/<id>` task to the lookahead (`opAssets`, `AssetContext.hasVoice`, any language folder); the shell decodes the next 4 lines'
  recordings into a 12-entry LRU (`AudioSystem.prefetchVoice`, `VOICE_AHEAD` in `stage-ui.ts`), which also serves the replay button. `checkAssets` warns about a voice
  file whose id matches no line (reported against `assets/voice/...`, line 1). Left: no completions, no warning for lines that lack a recording, no ducking of music,
  no per-character volume, NVL lines voice each line as it is added, the prefetch and auto-advance wait are not covered by a browser test, not listened to with a real recording.


## Accessibility

- [~] Keyboard and gamepad navigation, tabbed options, on-screen keyboard for name prompts (Tab moves focus at choices).
  - Done: captions for sound effects (Options, off by default; game.json `captions`).
  - Left: text-to-speech.
  - Left: try with a real gamepad (only tested with a simulated one); non-standard pad mappings; the on-screen
    keyboard is Latin + å ö ä only.

## Tooling

- [~] Debug console in the dev preview (Debug button, `preview/debug.ts`, grammar in `engine/src/debug.ts`, `debug.test.mjs`): `vars`, `set`,
  expressions, `jump`, `labels`, `flags`/`unlock`/`lock`, `persistent`, `reset <target|progress|all>`.
  - Left: no browser test; a `set` or `jump` is not undoable; no completions or hover for the commands; no live variable table that
    updates while playing; no timers/skip-to-line/force-random utilities; `unlock` only affects the next playthrough.
- [~] Editor UX evaluation: go over the editor's usability as a whole and look for improvements to the overall experience.
  - First pass covered a browser walk-through of the sample at desktop and 800x500; not yet covered: export, adding art, keyboard-only
    flow, error markers, the studio's lower panels. Rank new findings by impact and turn each into its own TODO item.
  - Left: "Animate" and "Edit rig" are not separate palette commands; closing the studio leaves the rig.json tab open and focused; the studio's stacked narrow layout (under 900px) is not looked at in a browser.
  - [-] Problems appears in both the editor toolbar and the preview header: kept on purpose (the preview's opens its own list).
- [~] Story outline: the Outline button draws labels, jumps, calls and run-on edges as a flowchart.
  - Left: back edges still arc below the nodes and can pass through labels in the same columns; not looked at on a real large storyline.
- [~] Variable rename in the editor (F2 on a variable, `engine/src/var-refactor.ts`, tested in `var-refactor.test.mjs`).
  - Done: `[name]` in `locale/*.json` follows a rename (found through the line's `#id`; the editor rewrites the files on disk through
    `/api/locale`, so that part has no undo; HUD text lives in `.vn` screens and was already covered).
  - Left: game.json text is not scanned; no browser test for the locale rewrite.
- [~] Screens preview and built-in screen UX: the Files panel's "Built-in screens" rows preview the screen (title, pause,
  quick menu, options, saves, history, gallery, music, chapters). A stock row also shows its starter code read-only; a customized row opens
  its script override, and Customize makes one; the toolbar "Title screen" button is gone.
  - Left: custom `screen`s the project declares itself are not listed for preview; no browser test for the sidebar click yet.
- [ ] Translation: a side-by-side view of the source script and each locale (not necessary for now, later).
- [~] Character outfit variants in the PSD converter.
  - Left: not tried with a real PSD. Assets open in a viewer dialog (images, sounds, fonts); no PSD-layer preview.

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
  - Done: `[n:2]`, `[n:,]`, `[n:one|other]` (`interpolate` in `text.ts`, `text-format.test.mjs`).
  - Left: right-to-left text; plural categories beyond one/other (few/many); no editor completions or hover for the format.
- [ ] As a player, I want an achievements list with notifications and an endings page, kept apart from saves.
- [ ] As a player on a phone or tablet, I want touch gestures (swipe back, tap zones), safe-area insets and orientation
  handling; and a wrapper that ships the game to iOS/Android.
- [-] **DEFERRED (much later)** As a player, I want a high-contrast theme, a dyslexia-friendly font option and text-to-speech (also listed under
  Accessibility).
- [ ] As a translator, I want an export of all dialogue with context (speaker, scene) and the side-by-side view
  (see "Translation" under Tooling).
- [x] As a developer, I want saves to survive engine updates (a version field and migration), since saves hold only
  source position plus choices.
  - Decided against an engine-level save format: the engine stays optimistic and loads whatever it finds (saves replay
    choices from a source position, so script edits already work). The game's author decides when a release breaks old saves:
    game.json `saveVersion` is recorded in each save, and Continue/Load/quick load ask first for saves with a lower number.
