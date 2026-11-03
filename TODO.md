# TODO

Format: `- [ ]` open, `- [~]` partly done, `- [-]` deferred (tagged **DEFERRED**).
Finished items are removed (git history has them; README and docs describe what exists). Each item says what is left.

Phasing (a rough order, not a schedule; sections below are by topic, so use the tags):
1. **Now**: "Next up", then other untagged open items (`[ ]`, `[~]`), picked by value and size. Tutorial and docs come
   after the features they describe.
2. **DEFERRED (later)**: wanted, but needs a design or outside assets first.
3. **DEFERRED (much later)**: only once measurements or real hardware show a need, or as nice-to-haves after everything else.

Items tagged **NEEDS PLANNING** get a short design (in `docs/design/`) before any code.

## Next up

Small, concrete, and each finishes something already started.

Nothing open right now; pick from the topic sections below.

## Documentation

- [ ] Write tutorial and introduction. Do this last, after all the essential features are done, so refactors don't invalidate it.
  - It walks through the demo project `games/demo/` ("Rainy Day Library", `vn dev --project games/demo`, or `vn-demo` on port 5174), not `games/sample/`.
  - Demo has: map/inventory/HUD screens, a scrolling catalogue (scroll, grid, row, column, poly hotspot), a custom pause
    menu, named positions, random/chance, audio ducking and pausing, two endings with achievements, chapters, gallery,
    two characters on stage with draw order (the archive).
    Demo left: a layered PSD character (and more `animate`), real art, a browser/playtest check in `npm test`.
  - Tutorial left: a layered-character chapter (PSD layout, `npm run art`, rig.json, the Animate studio, `show` / `animate`),
    localization and web export, a Marginalia Studio chapter (projects screen, New project, Build dialog's desktop
    target), and more screenshots (`docs/tutorial/img/`). Retake the screenshots and re-check quoted snippets against
    `games/demo/` whenever the editor or the demo changes.
- [ ] A "coming from Ren'Py" page: the common Ren'Py statements side by side with their Marginalia form, and what has no
  equivalent yet (Python blocks, ATL, layered images by attribute). Lowers the cost of trying the engine.

## Presentation

- [~] Screen UI elements missing from `screen` blocks. `panel` (a 9-slice framed container) and `bar` (a stat bar) are in
  (docs/commands.md); left of them: `style=` from the theme on both, a vertical or right-to-left bar, an eased fill, and no
  browser test yet (checked by hand in the preview). Still missing, roughly by payoff; when one is picked up, move it to "Next up":
  - [ ] Tabs / tab bar for custom screens (a journal with Items / Notes / Map pages); only the options tabs exist, as a theme
    component.
  - [ ] Toggle / checkbox and radio group (today a boolean needs a jump per click through the answer loop).
  - [ ] Text input field inside a screen (documented out of scope; use `input`), and a dropdown / select (the theme has
    `select`, screens can't declare one).
  - [ ] Modal / popup dialog over a screen, without leaving it.
  - [ ] Tooltip on buttons and `each` items (only hotspots have one); badges and counters ("×3", "NEW") on items and buttons.
  - [ ] Image-based slider and bar (track and thumb from art, 9-slice or sprite).
  - [ ] Animated screen elements (fade in, slide in, a pulsing "new" glow); `animate` targets characters only.
- [~] Sprite/character positioning. Left: anchors from `rig.json` (e.g. `head` at the real neck pixel); no browser test of
  rendered anchor bounds (`window.vnStage()` now gives each character's bounds).
- [~] Several characters on stage. Draw order (`show ... order=front|back`, `behind=<char>`) and a two-character scene in
  the demo's archive (Iris and Theo) exist, and a `show` without `at` onto someone at center is warned about. The studio
  opened from a script shows the scene at the cursor line behind the character. The dev preview exposes
  `window.vnStage()` (draw order, lit level, bounds), and a browser test covers `behind=`, `order=front` and placement.
  Left: no browser test of the studio's scene.
- [~] Speaker focus (game.json `speakerFocus`, `focus on|off`, `define ... focus=off`, an Options switch; on in the demo).
  A browser test covers the dimming, `front` and offstage narration. Left: `front` not tried in the demo; the
  starter `screen options` button sits at y=940, below the others, and may need a better place.
- [~] Side images (game.json `sideImages`, opt-in; `define ... side=<name>`, art in `assets/side/<name>[_<pose>].png`
  following the speaker's pose on stage). Left: a rig pose drawn as the portrait (no separate art); a line naming its own
  expression; keeping the last pose after `hide` (an offstage speaker shows the plain portrait); a place in `theme`
  skins; side art not in the preload plan (the browser fetches all of `assets/side/` at start); no browser test; not in the demo.
- [ ] Image-mask transitions: `scene bg dissolve mask=wipe_clock 0.8` reveals the next scene by a grayscale image's
  brightness (the Ren'Py ImageDissolve look); masks in `assets/transitions/`, checked like other assets, a dissolve under
  reduce motion.
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
- [ ] Replace the generated placeholder sample art (simple shapes) with real art when there is some.
- [-] **DEFERRED (later)** Video: a `movie` command for cutscenes and animated backgrounds (format support, skipping,
  captions, preload and desktop pak handling).

## Player experience

- [~] History: a click on a line rolls back to it (`action line` on a project screen). Left: a button to replay its voice
  line.
- [ ] Skip to the next choice (a quick-menu item and a key), stopping at unread text unless Options says otherwise.
- [~] Saves: named saves exist (game.json `saveNames`). Left: no rename action for a project's `screen saves` (only the stock
  ✎ button); export and import saves in the web build (a file download/upload), so a player can move between browsers or
  keep a backup before clearing site data.

## Accessibility

- [~] Keyboard and gamepad navigation. Left: a real gamepad (only a simulated one is tested); non-standard pad mappings; the
  on-screen keyboard is Latin + å ö ä only.
- [-] **DEFERRED (much later)** Screen readers hear the dialogue: the text box is not a live region (only menus, captions
  and toasts are), so a blind player hears the choices but not the story. Announce each line once it is shown in full
  (speaker, then text, tags stripped), not letter by letter; an Accessibility option to turn it off; a browser test.
- [-] **DEFERRED (much later)** A high-contrast theme, a dyslexia-friendly font option and text-to-speech (self-voicing).

## Tooling

- [~] Editor UX evaluation: go over the editor's usability as a whole. (Problems in both the editor and the preview header is on purpose.)
  Start with a fixed list of tasks (new project to first choice, add a character from a PSD, translate, export) timed
  on a fresh Studio install, and note where each one stalls.
- [~] Debug console. Left: `set` / `jump` are not undoable; no completions or hover; no live variable table
  (the editor's Variables panel has one); no timers/skip-to-line/force-random utilities; `unlock` only affects the next playthrough.
- [~] Files panel. Left: renamed images that are character poses are not followed (nor `show alice smile` when a pose
  file is renamed); no rename of characters (converted or flat); no drag-and-drop moves inside the tree; no Undo for Rename.
- [~] Git in the Files panel. Left: no "set up git" for a project outside a repository (it only says so); no per-file
  selection, diff view or push.
- [~] Story outline. Left: back edges arc below the nodes and can cross labels in the same columns; not tried on a large storyline.
- [~] Variable rename. Left: game.json text is not scanned.
- [~] "Did you mean" quick fixes. Left: game.json names and rig.json keys.
- [~] Screens preview. Left: the project's own `screen`s are not listed.
- [~] Translations dialog. Left: `ui.*` menu labels are not editable there; no import of a translated CSV;
  no translator notes; stale ids are counted but not removable; screen/item strings show no file and line.
- [~] Script statistics (`vn stats`, the palette's **Story: Script Statistics**, `engine/src/stats.ts`). Left: words per
  route (the playtest bot's endings, shortest and longest way to each); counts in the Outline's label nodes.
- [ ] Brand icon in the editor header in place of the "Marginalia VN" text (the page title stays text).
- [ ] Spell check for dialogue and menu text only (not ids, tags, `[variables]` or commands), as Monaco warnings with
  "add to project dictionary" (a word list in the project); a dictionary per locale is a later step.
- [ ] Playtest bot in the Build dialog: its findings (unreachable labels, stuck loops, unused variables and assets) as an
  `info` check with a level in `build.checks`, since today they show only after running the bot by hand.
- [ ] Consider pipeline settings for asset preprocessing (a project-level resize/compression/format config per asset type).
- [ ] **NEEDS PLANNING** Project templates for different game styles: New project (Studio and `engine/src/new-project.ts`)
  offers a few starters, each with game.json engine options set for its style instead of one generic starter. Candidates:
  classic ADV (text box, speaker focus, quick menu), NVL/kinetic novel (full-screen text, no choices, auto-forward),
  dating sim / branching (affection variables, chapters, gallery and achievements on), mystery/adventure (map and
  inventory screens, hotspots), portrait/mobile (portrait stage size, larger text). Open questions: which options and
  screens each template turns on, how much sample script and placeholder art each ships, whether templates are folders or
  overlays on one base, and how they stay in step with the engine as game.json options change (a test that builds each).
- [ ] **NEEDS PLANNING** Extension points for authors who know JavaScript: custom text tags, effects or screen elements
  in a project file, without breaking the deterministic runtime (no state outside variables; replay must give the same
  result). Decide first whether this is wanted at all.

## Shipping

- [~] Editor as an Electron app ("Marginalia Studio"), so authors need no Node.js or npm. Steps 1-5 of
  [docs/design/studio.md](docs/design/studio.md) are done (engine preparation, shell, projects screen, portable
  packaging, desktop export from the Studio's runtime). Left (besides the two items in "Next up"):
  - [-] **DEFERRED (later)** The by-hand checks on a clean Windows: the Studio zip, including the SmartScreen prompt, and a
    zip exported from it. Windows Sandbox is not on Windows 10 Home; needs a VM or a second PC.
  - [ ] An installer for the Studio (electron-builder/NSIS), with a Start menu entry and file association for `game.json`.
  - [ ] The downloads handler is untested (it needs a native save dialog).
  - [ ] `ENGINE_CHANGES` (`engine/src/studio-projects.ts`) needs an entry with every minor release.
  - [ ] Git features without a system `git`: say so plainly (they are greyed out today), and maybe ship a portable git later.
  - [-] **DEFERRED (later)** Updates: tell the author when a newer Studio is released (a version check against the GitHub
    releases, opt-in), then auto-update.
  - [-] **DEFERRED (much later)** Studio on Linux and macOS (only Windows is built and verified).
- [~] Online demo (docs/online.md): the editor as a static site with projects in IndexedDB. Left: the first deploy
  (`.github/workflows/online-demo.yml` runs on release tags once Pages is set to GitHub Actions); a browser test that builds it and plays it under a subfolder (the routes have
  node tests; the worker was checked by hand in Chromium only); try it in Firefox and Safari; Build/Export (web) in the
  browser, writing a playable zip.
- [~] Desktop app (Electron, `vn export --desktop`).
  - [-] **DEFERRED (much later)** Run the installer build (`npm run dist`) on Linux and macOS; only Windows is verified
    (`npm start` and the NSIS installer, Electron 45 on Node 24).
  - [ ] Maybe let users drop modifier scripts in the folder that override some variables (needs a definition first).
  - [-] **DEFERRED (later)** Steam: achievements from game.json `achievements` sent to Steamworks (steamworks.js or
    similar, only in the desktop build, only when an app id is set), and the Steam overlay. Unsigned exes and the
    SmartScreen warning matter less there.
- [~] Configurable stage size (one size per project; a portrait version is a duplicated project). Left: the stock text box,
  title, pause and options screens and the editor's "Built-in screens" starters are laid out for 1920x1080 landscape.
- [ ] Web export as an installable offline app (a web manifest and a service worker caching the build), with a fullscreen
  button for itch.io embeds. Pairs with the phone/tablet story below.
- [-] Precompiled script in exports: `src` stays in the ops, because the runtime keys seen options and saves on `file:line`
  when a line has no id.
- [~] Per-language translation files in exports. Left: not tried on a real large project.
  - [-] Possible later: split the program and tables per chapter/script so a large game loads only what it reaches (labels
    are the only cross-chunk reference; pc, call stack and saves would need a chunk id). Only if script text reaches several MB.
- [-] **DEFERRED (much later)** Asset unloading (step 4 of docs/asset-loading.md; steps 1-3 are done)
  - Size accounting, the `memoryBudgetMB` budget and the debug console's `memory` readout exist (`engine/src/residency.ts`); no
    eviction yet. Look at those numbers on real art before starting. Only evict over budget, never what is on screen, preloaded
    within the lookahead or in the rollback window, furthest next use first, at safe moments; stream long music; thumbnails for
    the gallery. Order: music streaming, then image/sound eviction, then tuning with a real network.
- [-] **DEFERRED (much later)** Verify asset loading beyond the synthetic project on localhost: real network, a low-end
  device, the web export (`npm run export`), the corrupted-PNG fallback, and that no placeholder ever flashes.

## Gameplay modes beyond VN (ideas, TBD)

- [ ] View/animation mode: click an element while playing to trigger a sound and affect its animation.
- [ ] Point and click adventure mode. Hotspots, inventory via `each` and a verb bar via `hud on` exist; left: using an item
  on a hotspot (drag and drop), cursor verbs.

## Known gaps (user stories)

Things a visual novel author or player would expect that the engine lacks. Not scheduled: when one is picked up, move it
to "Next up" as a task and leave a pointer here. Format: *As a ..., I want ... so that ...*

- [~] As a writer, I want rich choice menus. Left: custom `screen` data for the choice menu (menus are not screens yet), a
  seen marker in the editor preview; timers for `input`/`screen`, a `timeleft` variable, per-menu extended time, saving the clock.
- [~] As a writer, I want my game in any language (variable formatting exists). Left: right-to-left text; line breaking
  for Chinese and Japanese (no line may start with 。、」 and the like); no hover for the format.
- [ ] As a player on a phone or tablet, I want touch gestures (swipe back, tap zones), safe-area insets and orientation
  handling; and a wrapper that ships the game to iOS/Android.
- [ ] As a player, I want a map of the routes I have seen (the Outline's flowchart, limited to labels reached in any
  playthrough, with jumps to chapter starts), so that finding the last ending is not guesswork. Opt-in in game.json.
- [ ] As a writer, I want to check a route without clicking through it: "play to here" with chosen answers (the playtest
  bot already walks every route; let the author pick one and land in the preview at its end).
