# TODO

Format: `- [ ]` open, `- [~]` partly done, `- [-]` deferred until much later (tagged **DEFERRED**).
Finished items are removed (git history has them; README and docs describe what exists). Each item says what is left.

Phasing (a rough order, not a schedule; sections below are by topic, so use the tags):
1. **Now**: untagged open items (`[ ]`, `[~]`), picked by value and size. Tutorial and docs come after the features they describe.
2. **DEFERRED (later)**: wanted, but needs a design or outside assets first.
3. **DEFERRED (much later)**: only once measurements or real hardware show a need, or as nice-to-haves after everything else
   (high-contrast theme, dyslexia font, text-to-speech).

## Next up

- [-] **DEFERRED (later)** Video: a `movie` command for cutscenes and animated backgrounds (format support, skipping,
  captions, preload and desktop pak handling).
- [-] **DEFERRED (much later)** Asset unloading (step 4 of docs/asset-loading.md; steps 1-3 are done)
  - Size accounting, the `memoryBudgetMB` budget and the debug console's `memory` readout exist (`engine/src/residency.ts`); no
    eviction yet. Look at those numbers on real art before starting. Only evict over budget, never what is on screen, preloaded
    within the lookahead or in the rollback window, furthest next use first, at safe moments; stream long music; thumbnails for
    the gallery. Order: music streaming, then image/sound eviction, then tuning with a real network.
- [-] **DEFERRED (much later)** Verify asset loading beyond the synthetic project on localhost: real network, a low-end
  device, the web export (`npm run export`), the corrupted-PNG fallback, and that no placeholder ever flashes.
- [ ] Replace the generated placeholder sample art (simple shapes) with real art when there is some.
- [~] Demo audio (CC0, in `demo/assets/`, credits in `demo/CREDITS.md`; `sample/` stays silent). Left: a `thunder` file
  (candidate: OpenGameArt "Rain + Long Thunder", CC0).

## Documentation

- [ ] Write tutorial and introduction. Do this last, after all the essential features are done, so refactors don't invalidate it.
  - It walks through the demo project `demo/` ("Rainy Day Library", `vn dev --project demo`, or `vn-demo` on port 5174), not `sample/`.
  - Demo has: map/inventory/HUD screens, a scrolling catalogue (scroll, grid, row, column, poly hotspot), a custom pause
    menu, named positions, random/chance, audio ducking and pausing, two endings with achievements, chapters, gallery.
    Demo left: a layered PSD character (and more `animate`), real art, a thunder sound, a browser/playtest check in `npm test`.
  - Tutorial left: a layered-character chapter (PSD layout, `npm run art`, rig.json, the Animate studio, `show` / `animate`),
    localization and web export, and more screenshots (`docs/tutorial/img/`). Retake the screenshots and re-check quoted
    snippets against `demo/` whenever the editor or the demo changes.

## Presentation

- [~] Sprite/character positioning. Left: anchors from `rig.json` (e.g. `head` at the real neck pixel); placing on a real
  background with several characters at once (the studio shows one on black); no browser test of rendered anchor bounds
  (the renderer exposes no handle).
- [ ] **NEEDS PLANNING** Mesh-warp animation for layered characters (a Live2D-like look without Live2D): rig.json parts get warp
  deformers (hair sway, breathing, cloth) drawn with Pixi 8 `MeshPlane` / `MeshRope`, on top of the rigid-part animation.
  Chosen over embedding Live2D (Cubism Core is a proprietary WASM runtime with bundling limits; Pixi wrappers target Pixi 6/7).
  Open questions:
  - Deformer model: grid size per part, channels (control points? bend/sine/noise presets?), keys on points or on a few
    parameters (`sway`, `bend`, `stretch`).
  - Data: place in `rig.json`, validation in `checkRig` / `checkAssets`, what persists in `SpriteState` (persistent motion in
    state, one-shots transient).
  - Editing: a studio lane per deformer and draggable control points, or hand-written first.
  - Rendering cost, reduced motion, interaction with slot variants and `order`.
  - Whether Live2D import is still wanted later (check Pixi 8 plugin status and the Cubism license first).
- [~] Flat characters (rig.json without sprite.json). Left: create the first rig.json from the editor; no browser test.
- [~] Script ↔ studio links. Left: a hover link; opening the studio from a `show` line starts from that placement; no browser test.
- [~] Animation studio. Left: the "Lanes of" part's pivot shows only while picking; after Apply the stage shows the rest pose
  while the playhead sits on a key; no arrow keys in the Parts tree.
- [~] Outfit variants in the PSD converter. Left: not tried with a real PSD; no PSD-layer preview in the asset viewer.
- [~] Voice lines. Left: not tried with real recordings or a large project; no completions, music ducking or per-character
  volume; NVL voices each line as it is added; no browser test of the prefetch and auto-advance wait.

## Accessibility

- [~] Keyboard and gamepad navigation. Left: a real gamepad (only a simulated one is tested); non-standard pad mappings; the
  on-screen keyboard is Latin + å ö ä only.

## Tooling

- [~] Debug console. Left: no browser test; `set` / `jump` are not undoable; no completions or hover; no live variable table;
  no timers/skip-to-line/force-random utilities; `unlock` only affects the next playthrough.
- [~] Editor UX evaluation: go over the editor's usability as a whole. (Problems in both the editor and the preview header is on purpose.)
- [~] Problem counts differ between the editor (includes every rig.json) and the preview header (script and game.json only).
  Left: the fresh sample opens with 6 missing-audio warnings; maybe a short silent placeholder track for the sample.
- [~] Adding art from the editor. Left: no browser test for the drop.
- [~] Files panel. Left: renamed images that are character poses are not followed; no rename of characters (converted or
  flat); no drag-and-drop moves inside the tree; no Undo for Rename.
- [~] Git in the Files panel. Left: no "set up git" for a project outside a repository (it only says so); no per-file
  selection, diff view or push.
- [~] Browser tests: make the timing-sensitive ones (polygon hotspot, HUD, gamepad) wait on state instead of fixed presses.
- [~] Task output panel. Left: no browser test.
- [~] Story outline. Left: back edges arc below the nodes and can cross labels in the same columns; not tried on a large storyline.
- [~] Variable rename. Left: game.json text is not scanned; no browser test for the locale rewrite.
- [~] Find all uses (Shift+F12). Left: not tried in the browser, no browser test.
- [~] "Did you mean" quick fixes. Left: game.json names and rig.json keys.
- [~] Screens preview. Left: the project's own `screen`s are not listed; no browser test for the sidebar click.
- [~] Translations dialog. Left: no browser test; `ui.*` menu labels are not editable there; no import of a translated CSV;
  no translator notes; stale ids are counted but not removable; screen/item strings show no file and line.
- [ ] Consider pipeline settings for asset preprocessing (a project-level resize/compression/format config per asset type).

## Shipping

- [~] Desktop app (Electron, `vn export --desktop`).
  - [-] **DEFERRED (much later)** Run the installer build (`npm run dist`) on Linux and macOS; only Windows is verified (`npm start` and the NSIS installer, Electron 45 on Node 24).
  - [ ] Maybe let users drop modifier scripts in the folder that override some variables (needs a definition first).
- [ ] Editor as an Electron app ("Marginalia Studio"), so authors need no Node.js or npm. The main process starts the dev
  server and opens `/editor/` in its own window. Child scripts already run through `process.execPath`, so they would need
  `ELECTRON_RUN_AS_NODE=1` in their env. Ship a prebuilt `dist/` (no tsc or watcher) and move Monaco, PixiJS and ag-psd
  to `dependencies`. Projects then find the engine from the app instead of the `file:` npm link. The desktop export
  reuses the Studio's own Electron (copy, rename, pack the game) instead of `npm install`; an installer still needs
  electron-builder/NSIS, so it starts with a portable folder or zip. Git features must cope with no system `git`.
  Unsigned exes get SmartScreen warnings (signing costs a yearly certificate).
- [~] Configurable stage size (one size per project; a portrait version is a duplicated project). Left: the stock text box,
  title, pause and options screens and the editor's "Built-in screens" starters are laid out for 1920x1080 landscape.
- [-] Precompiled script in exports: `src` stays in the ops, because the runtime keys seen options and saves on `file:line`
  when a line has no id.
- [~] Per-language translation files in exports. Left: not tried on a real large project.
  - [-] Possible later: split the program and tables per chapter/script so a large game loads only what it reaches (labels
    are the only cross-chunk reference; pc, call stack and saves would need a chunk id). Only if script text reaches several MB.

## Gameplay modes beyond VN (ideas, TBD)

- [ ] View/animation mode: click an element while playing to trigger a sound and affect its animation.
- [ ] Point and click adventure mode. Hotspots, inventory via `each` and a verb bar via `hud on` exist; left: using an item
  on a hotspot (drag and drop), cursor verbs.

## Known gaps (user stories)

Things a visual novel author or player would expect that the engine lacks. Not scheduled: when one is picked up, move it
to "Next up" as a task and leave a pointer here. Format: *As a ..., I want ... so that ...*

- [~] As a writer, I want rich choice menus. Left: custom `screen` data for the choice menu (menus are not screens yet), a
  seen marker in the editor preview; timers for `input`/`screen`, a `timeleft` variable, per-menu extended time, saving the clock.
- [~] As a writer, I want right-to-left text (variable formatting exists). Left: right-to-left text; no hover for the format.
- [ ] As a player on a phone or tablet, I want touch gestures (swipe back, tap zones), safe-area insets and orientation
  handling; and a wrapper that ships the game to iOS/Android.
- [-] **DEFERRED (much later)** As a player, I want a high-contrast theme, a dyslexia-friendly font option and text-to-speech.
