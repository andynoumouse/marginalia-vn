# TODO

Format: `- [ ]` open, `- [~]` partly done, `- [-]` deferred (tagged **DEFERRED**).
When you finish an item, delete it from this file in the same change; never mark it `[x]` or leave it behind (git history has it; README and docs describe what exists). When you finish part of an item, rewrite it so it says only what is left. Each item says what is left.

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
  - [ ] **NEEDS PLANNING** Make screen elements behave the same in every context (blocking screen, HUD, built-in-replacement
    screens), as a screen with its own local state, inputs and outputs. Design notes in [docs/design/screen-contexts.md](docs/design/screen-contexts.md).
    What it should deliver: a modal / popup dialog over a screen without leaving it; a tooltip on buttons and `each` items
    (only hotspots have one) and badges or counters ("×3", "NEW"); hover-reveal and a status line showing the hovered
    element's label ("Use key on door"); and, for touch, where there is no hover, a tap-to-inspect step (first tap names the
    element, second acts).
    Staged: first local `state` with no outputs (tabs, tooltips, hover-reveal, in-screen dialogs; small, no recording),
    then `inout` outputs for toggle / radio, then shell screens. Steps 2 and 3 are built for blocking screens: `state`, `tab`,
    `on click|focus|blur set`, `toggle`, `radio`, `inout` parameters with one recorded entry per screen and `cancel keep`.
    Left of them: step 4 (shell screens), `slider` on a numeric `inout`, list editing, the `modal` flag for a panel dialog, a
    playtest bot that follows tab changes, and local state on a HUD.
  - [ ] Text input field inside a screen (documented out of scope; use `input`).
  - [~] Dropdown: `select <setting>` on the options screen is built (a button showing the value that opens a themed list over the screen; keys, Esc and
    pointer work; the default options use it for language, theme, voice language, skip, auto speed and timed choices). Left: a select bound to a screen's own
    `state` / `inout` (step 4 of the contexts design), the list
    opening with the current value focused, and a scrolling list for very many values.
  - [ ] Image-based slider and bar (track and thumb from art, 9-slice or sprite).
  - [~] Animated screen elements: `on enter fade|slide|pop|zoom`, `on exit` (inert copies of dropped elements) and
    `loop pulse|bob|sway|breathe|shiver|glow` are built (docs/commands.md, "Animating elements"). Plan:
    [docs/design/screen-animation.md](docs/design/screen-animation.md). Left:
    - [ ] Animate a change of state (a tab switch, a bar easing to its new value).
    - [ ] A browser test in `browser.test.mjs` (checked by hand once).
    - [ ] Animation inside screens (a flickering lamp, an idling NPC): a frame-sequence image element reusing the `frames` /
      `fps` / `loop` clip format of the studio's frame tracks. Screen images are plain `<img>` elements
      (`preview/screen-ui.ts`), so today only APNG/animated WebP moves. Rigs inside screens are not planned.
  - [ ] Fractional placement like Ren'Py's `xalign` / `yalign` / `xanchor` / `yanchor` on screen elements. Today only layout
    containers can be pinned (`anchor <nine places> [margin]`), and `at x,y` is always the element's top-left corner.
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
- [~] **Animation and rigs** (layered characters: `rig.json`, the Animation studio, `show` / `animate`). Build order of the
  planned work (from the design doc's suggested order): part hierarchy (built) → parameters and the timeline on them →
  poses and script surface → viewport and bone gizmos → mesh-warp deformers → masking → physics → standalone app. Backward
  compatibility of the rig.json / animation format is not required; it may change freely.
  - [~] Part hierarchy (bones, parts and looks; a child follows its parent's motion). All five phases are built (design,
    decisions and the survey of other formats: [docs/design/rig-hierarchy.md](docs/design/rig-hierarchy.md),
    [docs/design/rig-formats.md](docs/design/rig-formats.md)). Base for the mesh-warp item below. Left: no browser test of
    the Parts tree's folding, dragging or Save as look.
  - [~] Flat characters (rig.json without sprite.json). The standalone studio opens a folder of pose images with no rig.json and Save creates it
    (browser test). Left: the editor still cannot start a rig.json for a flat character that has none (its project data has no manifest for it
    until the file exists).
  - [~] Script ↔ studio links. Left: a hover link; opening the studio from a `show` line starts from that placement; no
    browser test.
  - [~] Animation studio: **Model | Animate** modes in three columns (animation picker and Parts tree, stage and timeline,
    collapsible sections; [docs/design/studio-ux.md](docs/design/studio-ux.md), built). Model mode (parts, bones, pivots,
    parameter preview, physics, by itself) has a Model button in the Files panel and a draggable pivot. Left:
    - UX follow-ups: the timeline cannot fold to its transport row, the narrow layout has no browser test beyond the dock one, and the Look
      select shows what a look picks only in a tooltip. Sections can be dragged between the columns (a second left column opens beside the first; the side columns fold to a rail when dragged to the window edge) and reordered (grab button or
      Alt+arrows, Reset layout; [docs/design/dock-binding.md](docs/design/dock-binding.md), `editor/dock-ui.ts`, bench
      `editor/dock-sandbox.html`, `npm run test:dock`); left of that: dragging into the centre, touch polish, a layout per mode.
    - Model mode could add a draw-order / group overview.
  - [~] Mesh-warp deformers (hair sway, breathing, cloth; Pixi 8 `MeshPlane`, chosen over embedding Live2D, whose Cubism Core is a
    proprietary WASM runtime; other formats are surveyed in [docs/design/rig-formats.md](docs/design/rig-formats.md)). **Built**
    ([docs/design/mesh-warp.md](docs/design/mesh-warp.md) steps 1-8): pure core (`params.ts`, `warp.ts`, `checkDeformers`), the
    renderer (`MeshPlane` per warped part, redrawn only when the deformer's parameters change; the studio preview shares it), and
    the studio: a Warp tool (**D**) and section in Model mode with the lattice overlay, point drag into a keyform (one undo step),
    add / remove, grid-size editing, reset, mirror, smooth, exact point fields and the sway / breathe / sine / noise presets
    (`engine/src/warp-edit.ts`, `editor/anim-warp.ts`); hand-written sample on robo's torso (`breathe`, `animate robo breathe loop`);
    documented in rig-json.md; browser test. **Left:** editing keyforms driven by two parameters (a pad), soft selection and
    mirror / smooth on chosen points only, hit-testing through the warp, the "variants differ in size" warning (the manifest has no sizes yet), the rope variant, and Live2D import (only if
    wanted later: check Pixi 8 plugin status and the Cubism license first).
  - [ ] Parameter-driven animation studio (more Live2D-like). Designed, with the main questions decided (only a
    low-end-phone check of stencil masks is open, see below): [docs/design/animation-studio-parameters.md](docs/design/animation-studio-parameters.md),
    which also has a suggested build order. The parameter model comes first; the mesh-warp item above then plugs into it
    (warp control points become parameter keyforms). Pieces:
    - [~] Parameters: built (rig.json `parameters`, `pads`, `keyforms`; `engine/src/params.ts` blends and combines, `checkRig`
      validates; the game shell evaluates keyforms under the bones' own motion; animations key parameters in `params` tracks,
      drawn as lanes under the channels, same evaluation in the studio and the game; see docs/rig-json.md). The studio splits
      the work as Cubism does: **Model mode authors keyforms, parameter first** (2026-11-07; it replaced a part-first flow and the interim Keyforms mode): the author
      picks the active parameter in the one palette, then the parts it moves (a click on the stage, Shift-click only selects, Ctrl-click, on the stage or a tree row, adds a part to the chosen ones so one drag poses them all by the same delta, or the tick on a row of the Parts tree);
      each pick binds the part and makes its keys at once at rest (slider: min, default, max; pad: a 2 × 2, 3 × 3 or 5 × 5 grid; a warp or a mask polygon with
      the Warp or Mask tool on), a click on a key or a pad corner puts the control there, the gizmo or Warp tool poses the part into that key (one undo step per drag),
      the block under the list shows the bound parts, the keys, the pose and which parameters move the chosen part, + column / + row grow a grid
      (`engine/src/keyform-edit.ts`, `engine/src/param-bind.ts`, `editor/anim-bind.ts`; docs/design/animation-studio-parameters.md) and Model
      **edits the parameters and pads** (new, rename through keyforms, poses, tracks, deformers, masks and physics, range, default,
      category, ease, delete; categories are their own list: add, rename, delete, reorder, drag controls between them; `engine/src/param-edit.ts`); **Animate mode keys the values on the timeline**. Copy keys (the Copy row of the bound list, with Mirror) takes over another part's keys on the same parameter or pad, or any part's on another parameter of the same kind (`copyKeys` in `engine/src/key-copy.ts` maps min to min, default to default). Alt-click on a bone's tick in the Parts tree binds (or unbinds) the bone, the bones below it and their parts at once. Left: a curve editor per track ([plan](docs/design/param-curve-editor.md)), part keys becoming
      parameters (both kinds of key exist side by side now), easing between keyforms for pad grids, warps and masks (a slider's pose keys have a per-key `ease`, set in the Pose row), a handle for keyform opacity (a field only), a rename that also follows script lines (`animate robo look_x=...`).
    - [~] Masking: **built** (rig.json `masks`; [docs/rig-json.md](docs/rig-json.md#masks), design in
      docs/design/animation-studio-parameters.md). A part, mesh-warped or not, is clipped by a Pixi 8 stencil mask to another
      part's traced silhouette or to a drawn polygon that follows a bone or part; a polygon's points are keyform targets, so a
      parameter closes an eyelid; one nested level; `checkRig` rejects unknown ids, loops and chains of three; the studio has a
      Mask tool (**M**) and section (outline on the stage, point drag, picker); sample: robo's `eyelids` on `eye_open` (pose
      `squint`). Left: soft alpha masks (render textures; only if a real case appears), inverse masks, holes in a traced
      silhouette are filled, no studio editor for a polygon's keyforms (hand-written; the stage shows them), the studio's hit test
      ignores masks, clipping a whole bone's parts at once (give each part a mask), a part-shaped sample (iris in the eye) needs
      art with separate iris and eye-white layers (a browser test builds that case), the outline of a source drawn with soft edges
      sits a pixel inside the art.
    - [ ] Measure stencil masks on a low-end phone. The cost is unmeasured (each mask is a stencil push and pop and a batch break
      every frame); until then the safeguards are `checkRig`'s warning above 8 masks and the renderer's console warning, and
      the count is in the debug console's `memory` and in `vnStage()`. If it is too much: bake the clip into the texture
      for parts that do not move relative to their source.
    - [~] Editor viewport: the studio stage zooms toward the cursor (wheel), pans (middle-drag or Space+drag) and fits (F, Fit
      button), and the pivot crosses, skeleton and gizmo keep their on-screen size (`preview/studio-gizmo.ts`). Left: zoom and
      pan on the timeline, and the same viewport on the standalone studio's other canvases (mesh and mask editing).
    - [~] Bone gizmos on the stage: built (click a part (opacity hit test in `PixiRenderer.studioHit`), a bone handle or the tree
      to select; W move, E rotate, R scale, Q pivot in Model mode, X local/world; `engine/src/gizmo-rig.ts` for targets, handles
      and keys; Animate drags write a key at the playhead (Auto-key) or preview until the Key button; Model drags write the keyform
      of the active parameter at its current value, keeping both scale axes; the pivot is the Q tool's; one undo step per drag;
      numeric x/y/scale/rot fields in Animate, the Pose fields in Model). Left: Animate keys scale evenly (the `scale` channel), so
      the scale tool's two axes are averaged there; gizmos while playing; touch input.
    - [~] Physics for hair and cloth: built (`engine/src/physics.ts` simulation; rig.json `physics` chains reading parameters or
      bone channels and writing parameters or, as the interim, a part's rotation; `checkRig` rules incl. cycles; the game shell
      steps them last and additive, paused with the pause menu, at rest after a sync, in skip and reduced motion, kept across
      scene changes; animation `physicsOff`; the studio's Physics tab with presets, JSON editing and Shake; sample: Mina's
      `hair_back`; see docs/rig-json.md). Left: a number-field editor instead of JSON, a `physicsOff` for poses and a script
      switch, wind from game input, no browser test of the Physics tab, and a sample where physics drives a warp parameter.
    - [ ] Frame tracks: thumbnails in the blocks, onion skinning, a packed spritesheet per slot (asset loading), and a check
      with warped parts. The rest (format, evaluation, renderer, Frames tab) is done.
    - [~] Standalone studio and movie export. **Built:** the studio runs with no game project ([docs/standalone-studio.md](docs/standalone-studio.md)):
      `editor/studio.html` (served by `vn dev` and `vn character`; Chromium's File System Access folder picker) and **Open Character...** on Marginalia
      Studio's projects screen open a character folder (the PSD converter's output with or without a rig.json, one image per pose, or a game
      project's characters to choose from), edit in Model and Animate, **Save** (Ctrl+S) writes rig.json into the folder, the unsaved-edits guard, and
      **Export...** to a PNG sequence with alpha (frame by frame at a fixed timestep; a folder or a zip). The same `AnimStudio` runs in both hosts
      (`StudioHost.standalone`; `engine/src/studio-doc.ts`, `character-folder.ts`; the stage page's `hosted` mode takes its project and `blob:` URLs from the
      host; a `vnStudio.character` bridge in the Studio); browser and Studio tests. **Left:** webm / mp4 (WebCodecs, or an ffmpeg the Studio bundles; the
      PNG frames work in any editor meanwhile); a frame range shorter than the animation; a preview of the framing in the export dialog; a variant that
      only a not-yet-applied frame track names is not preloaded, so it may not show in the export. Standalone: a folder of loose layer images (no
      sprite.json) is read as poses, so making a sprite.json from layers (equal-size PNGs, with a way to say layers or poses) is open, and so is
      converting a PSD inside the page (the converter runs in node and in the online demo's worker); a recent-characters list; a read-only fallback
      for browsers without the File System Access API (a download of rig.json on Save); reloading art that changes under the open page; the page on
      the online demo's static site (the stage page there is reached through a project's service-worker route).
- [~] Outfit variants in the PSD converter. Left: not tried with a real PSD; no PSD-layer preview in the asset viewer.
- [~] Voice lines. Left: not tried with real recordings or a large project; no completions, music ducking or per-character
  volume; NVL voices each line as it is added; no browser test of the prefetch and auto-advance wait.
- [ ] Replace the generated placeholder sample art (simple shapes) with real art when there is some.
- [~] Video: `movie play <name> [noskip]` plays a fullscreen cutscene (webm/mp4; skip by click, look-ahead buffering,
  desktop pak already serves ranges). `image show <name> movie/<file> layer=-1` keeps a looping video (with its
  sound) under the dialogue (a moving backdrop). Open: a browser test with a generated clip, captions (.vtt), ducking
  or muting it under dialogue or music, a video that survives `scene`/rollback without restarting, and custom text boxes placed around a video
  (a separate display element, instead of the say screen).

## Player experience

- [~] Saves: named saves exist (game.json `saveNames`). Left: no rename action for a project's `screen saves` (only the stock
  ✎ button); export and import saves in the web build (a file download/upload), so a player can move between browsers or
  keep a backup before clearing site data.

## Accessibility

- [~] Keyboard and gamepad navigation. Left: a real gamepad (only a simulated one is tested); non-standard pad mappings; the
  on-screen keyboard is Latin + å ö ä only.
- [~] Screen readers hear the dialogue (Options, Accessibility, "Screen reader reads dialogue"; docs/game-json.md): a live region
  gets each line once it is shown in full. Known faults with Windows Narrator: when a screen closes with focus on a button,
  focus falls to the page and Narrator reads the page title; and with Narrator on, key and focus navigation break (arrows,
  Space, Enter, numbers). Left: find out why (try NVDA and a plain browser window first); the option has no `screen options`
  cycle setting and no localized label; NVL pages and history are not announced separately.
- [-] **DEFERRED (much later)** A high-contrast theme, a dyslexia-friendly font option and text-to-speech (self-voicing).

## Tooling

- [~] Editor UX evaluation: go over the editor's usability as a whole. (Problems in both the editor and the preview header is on purpose.)
  Start with a fixed list of tasks (new project to first choice, add a character from a PSD, translate, export) timed
  on a fresh Studio install, and note where each one stalls.
- [~] Files panel. Left: renamed images that are character poses are not followed (nor `show alice smile` when a pose
  file is renamed); no rename of characters (converted or flat); no drag-and-drop moves inside the tree; no Undo for Rename.
- [~] Story outline. Left: back edges arc below the nodes and can cross labels in the same columns; not tried on a large storyline.
- [~] Variable rename. Left: game.json text is not scanned.
- [~] "Did you mean" quick fixes. Left: game.json names and rig.json keys.
- [~] Translations dialog. Left: no import of a translated CSV;
  no translator notes; stale ids are counted but not removable; screen/item strings show no file and line.
- [~] Script statistics (`vn stats`, the palette's **Story: Script Statistics**, `engine/src/stats.ts`). Left: words per
  route (the playtest bot's endings, shortest and longest way to each); counts in the Outline's label nodes.
- [ ] Brand icon in the editor header in place of the "Marginalia VN" text (the page title stays text).
- [ ] Spell check for dialogue and menu text only (not ids, tags, `[variables]` or commands), as Monaco warnings with
  "add to project dictionary" (a word list in the project); a dictionary per locale is a later step.
- [ ] Consider pipeline settings for asset preprocessing (a project-level resize/compression/format config per asset type).
- [ ] **NEEDS PLANNING** Extension points for authors who know JavaScript: custom text tags, effects or screen elements
  in a project file, without breaking the deterministic runtime (no state outside variables; replay must give the same
  result). Decide first whether this is wanted at all.

## Shipping

- [~] Editor as an Electron app ("Marginalia Studio"), so authors need no Node.js or npm. Steps 1-5 of
  [docs/design/studio.md](docs/design/studio.md) are done (engine preparation, shell, projects screen, portable
  packaging, desktop export from the Studio's runtime). Left:
  - [-] **DEFERRED (later)** The by-hand checks on a clean Windows: the Studio zip, including the SmartScreen prompt, and a
    zip exported from it. Windows Sandbox is not on Windows 10 Home; needs a VM or a second PC.
  - [ ] An installer for the Studio (electron-builder/NSIS), with a Start menu entry and file association for `game.json`.
  - [ ] The downloads handler is untested (it needs a native save dialog).
  - [ ] `ENGINE_CHANGES` (`engine/src/studio-projects.ts`) needs an entry with every minor release.
  - [-] **DEFERRED (later)** Updates: tell the author when a newer Studio is released (a version check against the GitHub
    releases, opt-in), then auto-update.
  - [-] **DEFERRED (much later)** Studio and the desktop export's installer build (`npm run dist`) on Linux and macOS (only
    Windows is built and verified: `npm start` and the NSIS installer, Electron 45 on Node 24).
- [~] Online demo (docs/online.md): the editor as a static site with projects in IndexedDB. Left: the first deploy
  (`.github/workflows/online-demo.yml` runs on release tags once Pages is set to GitHub Actions); a browser test that builds it and plays it under a subfolder (the routes have
  node tests; the worker was checked by hand in Chromium only); try it in Firefox and Safari; Build/Export (web) in the
  browser, writing a playable zip.
- [~] Desktop app (Electron, `vn export --desktop`).
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
  - Also verify asset loading beyond the synthetic project on localhost: real network, a low-end device, the web export
    (`npm run export`), the corrupted-PNG fallback, and that no placeholder ever flashes.

## Gameplay modes beyond VN (ideas, TBD)

- [ ] View/animation mode: click an element while playing to trigger a sound and affect its animation.
- [ ] Point and click adventure mode. Hotspots, inventory via `each` and a verb bar via `hud on` exist; left: using an item
  on a hotspot (drag and drop), cursor verbs.
  - [ ] Cursor changes: today a hotspot only takes a CSS cursor name (`cursor help`). Wanted: a custom cursor image (with
    a hotspot offset), a script command to set it (e.g. the held item or the active verb, kept in saves and replay), and
    a per-element override. Keep the touch/pad fallback (no cursor there: show the held item as text or an icon).
  - [ ] Popup next to the click: a verb/item menu placed where the player clicked. Today `at x,y` takes literal numbers
    and a screen answers only with an element id, so a popup can only sit at a fixed position per spot (one `if spot ==`
    group each). Needs the click position stored in variables (recorded like the answer, so replay and saves keep it) and
    `at` taking variables or expressions, with clamping to the stage edges. Keyboard/pad: use the focused element's centre.
  - [ ] Hotspots follow the scene: they are stage coordinates, not tied to sprites or props. Checked: they do not move
    with `camera` (screens are DOM layers over the stage, outside the pixi `world` that the camera scales). Decide on
    anchoring a hotspot to a shown sprite or to the camera (transform the layer by the camera state).
  - [ ] Item stacks and combining: lists hold plain entries, so no quantity. Add counts, and a combine flow (pick item A,
    then item B) as a documented pattern or a built-in, with the Mystery template as the example.
  - [~] Playtest bot and screens: checked: the bot already takes every enabled non-`act` element of a blocking screen
    as a choice, and states are deduplicated, so a looping room does not spin. Left: report an element that no route
    could ever enable (today only its unreachable handler lines/labels show); a test with a looping room screen.

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
