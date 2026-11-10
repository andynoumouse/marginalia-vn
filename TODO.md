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

- [~] Tutorial (docs/tutorial/, plan in docs/design/tutorial-plan.md). Pages 1-5 and Go deeper A-H are written; pages 1-5 follow
  `games/tutorial/` ("The Last Train"), and `engine/test/tutorial.test.mjs` keeps their snippets in step with it. Left:
  - The screenshots are of The Last Train (taken with a throwaway playwright script; none yet for the Translate and Voice dialogs
    or the animation studio). Pages 1-5 were walked through once in the dev-server editor (UX round,
    [docs/design/ux-test-2026-11/ob.md](docs/design/ux-test-2026-11/ob.md)); still to walk: Marginalia Studio and the online demo.
    That walk's fixes are in (page 2 ends with the whole script, page 4 says where each JSON piece goes, pages 1 and 3 say what the
    editor does with typing, warnings and drops); still open: localization id, flag, stage and persistent are never explained in pages
    1-5 (OB-15), and the second walk of the fixed pages has not been done.
  - Checkpoints per page (a copy of the game as it stands after each page), so a reader can start from any page.
  - Go deeper D (layered characters) needs a layered PSD character in `games/tutorial/` or the demo with real art; the demo
    has a robot rig only (with parameters, poses, a torso warp and a breathe animation now).
  - Go deeper B and C quote `games/demo/` (H shows The Last Train); C is already short recipes (the plan's inventory recipe is
    missing). B, C and D say the demo opens on a feature index with a card for each command.
  - Check the Ren'Py comparison page (F) with someone who knows Ren'Py.
  - Retake screenshots and re-check quoted snippets whenever the editor or the demo changes.

- [~] Demo feature index (`games/demo`: New game opens seven pages of playground cards; design in
  [docs/design/demo-feature-index.md](docs/design/demo-feature-index.md), checked by `engine/test/demo-index.test.mjs`). Left:
  - Cards for features that need new assets: `voice` lines, `movie`, wind and physics on a character such as the sample's Mina,
    side images (`assets/side/`).
  - A "tried" tick per card (a persistent flag, shown on the index).
  - A "Try it" link from the docs and the F1 help into a card of the hosted demo; needs a start-at-label URL for the preview
    and a seeded project.
  - Not checked: the keyboard and gamepad focus order of the index and of the card screens (map, scroll and grid, preferences,
    bars, HUD).
  - A way back to the index from the library that the playtest bot can survive (today: Esc, Leave the library, New game, or
    Chapters).

## Presentation

- [~] Screen UI elements missing from `screen` blocks. `panel` (a 9-slice framed container) and `bar` (a stat bar) are in
  (docs/commands.md); left of them: `style=` from the theme on both, a vertical or right-to-left bar, an eased fill, and no
  browser test of `bar` or of a 9-slice panel image (checked by hand in the preview). Still missing, roughly by payoff; when one is picked up, move it to "Next up":
  - [~] **NEEDS PLANNING** Make screen elements behave the same in every context (blocking screen, HUD, built-in-replacement
    screens), as a screen with its own local state, inputs and outputs. Design notes in [docs/design/screen-contexts.md](docs/design/screen-contexts.md).
    Built for blocking screens: `state`, `tab`, `on click|focus|blur set`, `toggle`, `radio`, `inout` parameters with one
    recorded entry per screen and `cancel keep`; a button `tooltip` and `sub` text; hover-reveal and a status line (`on focus
    set tip = ...` with a `text "[tip]"`); an in-screen dialog as a panel under `if` on a `state`.
    Left: step 4 (shell screens), `slider` on a numeric `inout`, list editing, the `modal` flag (a dialog from `state` and `if`
    works but does not dim or block what is under it), a touch tap-to-inspect step (first tap names the element, second acts;
    touch has no hover), a playtest bot that follows tab changes (it does not follow a `tab`, so cards on a tab other than the first look unreachable;
    the demo's feature index uses answering buttons for its pages for this reason), and local state on a HUD.
  - [ ] Text input field inside a screen (documented out of scope; use `input`).
  - [ ] **Verify** a redraw from `on focus set` can swallow a fast first click or tap: found with the feature index's panels, where a
    click right after the pointer moved onto a different element, or right after a dialogue line returned to a screen, was sometimes
    dropped (hover first, wait about a second, then click, works). The pointerup rule in `preview/screen-ui.ts` (a press whose element was
    replaced by the redraw counts as a click on the new copy) should cover the first case; try it with a real pointer and a touch
    device, since the browser tool presses and releases at once. Matters for touch most.
  - [~] Dropdown: `select <setting>` on the options screen is built (a button showing the value that opens a themed list over the screen; keys, Esc and
    pointer work; the default options use it for language, theme, voice language, skip, auto speed and timed choices). Left: a select bound to a screen's own
    `state` / `inout` (step 4 of the contexts design), the list
    opening with the current value focused, and a scrolling list for very many values.
  - [ ] Image-based slider (track and thumb from art, 9-slice or sprite); the bar already takes `back` / `fill` art.
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
- [~] Sprite/character positioning. Left: per-character anchors from `rig.json` (`head` is a fixed 0.5,0.1 of the sprite, and a game.json `anchors` entry overrides it for every character); no browser test of
  rendered anchor bounds (`window.vnStage()` now gives each character's bounds).
- [~] Several characters on stage. Draw order (`show ... order=front|back`, `behind=<char>`) and a two-character scene in
  the demo's archive (Iris and Theo) exist, and a `show` without `at` onto someone at center is warned about. The studio
  opened from a script shows the scene at the cursor line behind the character. The dev preview exposes
  `window.vnStage()` (draw order, lit level, bounds), and a browser test covers `behind=`, `order=front` and placement.
  Left: no browser test of the studio's scene.
- [~] Side images (game.json `sideImages`, opt-in; `define ... side=<name>`, art in `assets/side/<name>[_<pose>].png`
  following the speaker's pose on stage). Left: a rig pose drawn as the portrait (no separate art); a line naming its own
  expression; keeping the last pose after `hide` (an offstage speaker shows the plain portrait); a place in `theme`
  skins; side art not in the preload plan (the browser fetches all of `assets/side/` at start); no browser test; not in the demo.
- [-] **Script transforms, deferred parts** (`docs/design/script-transforms.md`, "Not built"): `pose=` as a transform step
  (poses are absolute, an animation's parameter tracks have no known start value, and they revert when it ends) and automatic
  transforms with parameters / `if` / `pick` (each restart would need the variables and random numbers again, and the
  arguments would need saving). `animate <char> pose=... over` and a `while` condition cover the realistic cases.
- [~] **2D animation feature gaps** (found by a docs-only review of `docs/commands.md`, since checked against the source).
  Transforms move `x`, `y`, `scale`, `rot`, `alpha` and the `tint=` / `flash=` colors of a character, a picture or the camera.
  What is left, most useful first:
  - [~] The camera as an animation target (`animate camera shake loop`, presets, transforms, `auto`) is built and was seen working in the preview (a steady shake, stopped by `animate camera stop`); parallax and `camera roll` likewise. A browser test ("camera shake, roll, tint, choreography, burst and the glitch filter") covers the shake, roll and zoom through `vnStage()`; nothing tests parallax. Left: parallax for `scene` background art (only pictures have it). The overscan (`overscanZoom`, a roll or shake zooms in just enough to hide the stage edge) is unit-tested and not seen in the preview.
  - [~] Per-sprite effects: `move`/`image` `tint=` (multiply, tweened) and `flash <char|picture>` (color-matrix hit flash) are built and were seen working in the preview on the flat sample character (not on a rig with stencil masks). `tint=` and `flash=` are also transform-step channels (browser-tested on the flat character, not on a masked rig; not in rig.json keys or the studio's lanes). Left: brightness, blur, silhouette.
  - [~] More filters: `glow`, `chromatic` and `glitch` are built (one-pass shaders in `preview/scene-effects.ts`), seen working in the preview; the browser test only checks that the glitch shader compiles without console errors. Left: filters on a single character or picture (needs a per-sprite filter slot, as `flash` uses), and a true multi-pass bloom if the one-pass glow looks too crude.
  - [~] Choreography: `choreography name:` with timed `<seconds> <actor>: <step>` lines and `perform name` is built (characters, pictures and the camera; a fixed timetable compiled into one padded transform per actor), seen working in the preview; the browser test plays one and checks the script compiles. Left: `perform` seconds-stretch and strength, `parallel` / `if` / `pick` / `repeat` inside a choreography, a choreography that loops or runs `auto`, relative start times (`after alice`), and keeping a running one in saves (a rollback during it shows only where the parts left things).
  - [~] Lip sync: `speaking` now follows a voice recording's loudness (open/closed, with a hold) on voiced lines; unit-tested for the gate only, not heard or seen in a browser. Left: phoneme or viseme shapes (several mouth shapes from the audio; see [animation-studio-parameters.md](docs/design/animation-studio-parameters.md)).
  - [~] Particle emitters: `burst <sparkle|smoke|confetti|dust> at <character|position>` is built (a transient puff, not kept in saves, seen working in the preview; the browser test fires one and checks for errors). Left: a continuous emitter that stays on a character or point and is kept in saves (`emit ... off`), kinds with other shapes (hearts, stars; needs textures), and a burst that follows a moving character.
  - [~] Custom easing: `ease=bezier(x1,y1,x2,y2)` is built for script commands, transform steps and every rig.json `ease` (parameter keys also take a `bezier` array). The studio's ease selects show one and pick one ("curve…"). Left: a spring curve.
- [ ] **Layered characters: look dependencies** (the part of Ren'Py's `layeredimage` that has no equivalent, see
  `docs/tutorial/deeper/f-from-renpy.md`): a variant that hides or changes another slot (a hat hides the loose hair, as
  `if_all` / `if_any` do), and taking one outfit off while keeping the rest of the look (`rig-json.md` says it is not
  supported yet; today write a look that sets those slots, or `slot=none` per slot). No design yet; `reactions` already cover
  the variable-driven version, so this would be a static rule in `rig.json` `looks`, set up with the art pipeline.
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
  - [~] Script ↔ studio links. Left: a hover link; a `show` line opens the studio on its character (F12, the right-click menu) but
    not at that placement; no browser test of F12, the right-click entry, Insert in script or Try in scene.
  - [~] Animation studio: **Model | Animate** modes in three columns (animation picker and Parts tree, stage and timeline,
    collapsible sections; [docs/design/studio-ux.md](docs/design/studio-ux.md), built). Model mode (parts, bones, pivots,
    parameter preview, physics, by itself) has a Model button in the Files panel and a draggable pivot. Left:
    - UX follow-ups: the narrow layout has no browser test beyond the dock and wheel ones, and the Look
      select shows what a look picks only in a tooltip. Sections can be dragged between the columns (a second left column opens beside the first; the side columns fold to a rail when dragged to the window edge) and reordered (grab button or
      Alt+arrows, Reset layout; [docs/design/dock-binding.md](docs/design/dock-binding.md), `editor/dock-ui.ts`, bench
      `editor/dock-sandbox.html`, `npm run test:dock`); left of that: dragging into the centre, touch polish, a layout per mode.
    - Model mode could add a draw-order / group overview.
    - Left of the two UX rounds on the studio ([summary](docs/design/ux-test-2026-11-studio/summary.md), "After the Fix-first list"; every
      batch and the leftovers are done): in a window only 600 px tall the stage is about 185 px tall unless the timeline is folded (ES-4).
      Screen reader support is out of scope for the editor and the studio (the player side keeps it).
  - [ ] Automatic animations, what is left ([docs/design/auto-animations.md](docs/design/auto-animations.md)): studio buttons that make
    a blink or a talk animation from a slot's variants, spring transitions for reactions, a condition syntax for parameters beyond
    `param.<id>`, and the rig tab's check of condition names against the project's script variables (`checkRig` takes them;
    the editor passes none yet).
  - [~] Mesh-warp deformers (hair sway, breathing, cloth; Pixi 8 `MeshPlane`, chosen over embedding Live2D, whose Cubism Core is a
    proprietary WASM runtime; other formats are surveyed in [docs/design/rig-formats.md](docs/design/rig-formats.md)). **Built**
    ([docs/design/mesh-warp.md](docs/design/mesh-warp.md) steps 1-8): pure core (`params.ts`, `warp.ts`, `checkDeformers`), the
    renderer (`MeshPlane` per warped part, redrawn only when the deformer's parameters change; the studio preview shares it), and
    the studio: a Warp tool (**D**) and section in Model mode with the lattice overlay, point drag into a keyform (one undo step),
    add / remove, grid-size editing, reset, mirror, smooth, exact point fields, multi-select (rectangle, Shift-click, rows / columns,
    all / invert; a soft falloff; scale / rotate, mirror and smooth on the selection) and the sway / breathe / sine / noise presets
    (`engine/src/warp-edit.ts`, `editor/anim-warp.ts`); hand-written sample on robo's torso (`breathe`, `animate robo breathe loop`);
    documented in rig-json.md; browser test. **Left:** editing keyforms driven by two parameters (a pad), the "variants differ in size" warning (the manifest has no sizes yet), the rope variant, and Live2D import (only if
    wanted later: check Pixi 8 plugin status and the Cubism license first).
    - [~] Group warps (one warp over a part hierarchy; built, robo's head uses one: [mesh-warp.md](docs/design/mesh-warp.md) "Group warps"). **Left:** nested
      groups, a bone whose members turn differently (skews), editing a group's `box`, and a warp row in the tree itself.
    - [~] Free meshes (a part on a triangle mesh of any shape, every vertex keyed; [docs/design/free-mesh.md](docs/design/free-mesh.md)).
      Built: data model, generator, renderer, studio Generate / vertex editing / topology tools. **Left:** the full browser set has not
      run on it (the gate said SKIP each time), and a mesh on a sample part for the tutorial.
    - [~] Bone-weighted skinning of a free mesh (one part bends along the skeleton: arms, ponytails, tails; per-vertex weights
      in `mesh.weights` with an explicit `defaultBone`, a bone's `tip`, Spine's rule that the part's own bone does not move a
      skinned mesh). Designed in [docs/design/skinning.md](docs/design/skinning.md); steps 1 to 7 are built (core, renderer, pure edits,
      Mina's hair, the studio's Weights tool with brush, test pose, selection, numeric tools and Mirror, Remove bone carrying weights, the
      rest-pose rule for keyforms, docs in rig-json.md "Skinning" and the tutorial). **Left:** the optional step 8, editing a skinned mesh's
      keyforms under a pose (a drag converted through the inverse of the vertex's blended matrix), decided by whether correctives for bent
      joints turn out to be wanted. Rest poses stay in canvas pixels and a bone axis for stretching is left out (the design says why).
  - [ ] Parameter-driven animation studio (more Live2D-like). Designed, with the main questions decided (only a
    low-end-phone check of stencil masks is open, see below): [docs/design/animation-studio-parameters.md](docs/design/animation-studio-parameters.md),
    which also has a suggested build order. The parameter model comes first; the mesh-warp item above then plugs into it
    (warp control points become parameter keyforms). Pieces:
    - [~] Parameters: built (rig.json `parameters`, `pads`, `keyforms`; `engine/src/params.ts` blends and combines, `checkRig`
      validates; the game shell evaluates keyforms under the bones' own motion; animations key parameters in `params` tracks,
      drawn as lanes under the channels, same evaluation in the studio and the game; see docs/rig-json.md). The studio splits
      the work as Cubism does: **Model mode authors keyforms, parameter first** (2026-11-07; it replaced a part-first flow and the interim Keyforms mode): the author
      picks the active parameter in the one palette, then the parts it moves (Bind parts… opens a picker in the right column, while repeated clicks on one spot of the stage cycle through overlapping parts; Ctrl-click adds a part to the chosen ones so one drag poses them all by the same delta; a click alone only chooses, and the studio has one focus: a parameter, a part, or a keyform);
      each pick binds the part and makes its keys at once at rest (slider: min, default, max; pad: a 2 × 2, 3 × 3 or 5 × 5 grid; a warp or a mask polygon with
      the Warp or Mask tool on), a click on a key or a pad corner puts the control there, the gizmo or Warp tool poses the part into that key (one undo step per drag),
      the block under the list shows the bound parts, the keys, the pose and which parameters move the chosen part, + column / + row grow a grid
      (`engine/src/keyform-edit.ts`, `engine/src/param-bind.ts`, `editor/anim-bind.ts`; docs/design/animation-studio-parameters.md) and Model
      **edits the parameters and pads** (new, rename through keyforms, poses, tracks, deformers, masks and physics, range, default,
      category, ease, delete; categories are their own list: add, rename, delete, reorder, drag controls between them; `engine/src/param-edit.ts`); **Animate mode keys the values on the timeline**. Copy keys (the Copy row of the bound list, with Mirror) takes over another part's keys on the same parameter or pad, or any part's on another parameter of the same kind (`copyKeys` in `engine/src/key-copy.ts` maps min to min, default to default). Bind parts… has a checkbox that also binds what hangs on a ticked bone (the bones below it and their parts); the Parts tree's marks only show what is bound. Left: a curve editor per track ([plan](docs/design/param-curve-editor.md)), part keys becoming
      parameters (both kinds of key exist side by side now), easing between keyforms for pad grids, warps and masks (a slider's pose keys have a per-key `ease`, set in the Pose row), a handle for keyform opacity (a field only), a rename that also follows script lines (`animate robo look_x=...`).
    - [~] Masking: **built** (shape parts and `clip` links in rig.json `parts`; the first build's `masks` list is no longer read;
      [docs/rig-json.md](docs/rig-json.md#masks), design in
      docs/design/animation-studio-parameters.md). A part, mesh-warped or not, is clipped by a Pixi 8 stencil mask to another
      part's traced silhouette or to a shape part that follows a bone or part; a shape's points are keyform targets, so a
      parameter closes an eyelid; one nested level; `checkRig` rejects unknown ids, loops and chains of three; the studio has a
      Mask tool (**M**) and section (outlines, point drag, shape and clip editing); sample: robo's `eyelids` on `eye_open` (pose
      `squint`). Left: soft alpha masks (render textures; only if a real case appears), inverse masks, holes in a traced
      silhouette are filled, no way to pose a polygon's points into a keyform in the studio (Bind parts… makes a shape's keys at rest; the points are hand-written and the stage shows them), clipping a whole bone's parts at once (give each part a mask), a part-shaped sample (iris in the eye) needs
      art with separate iris and eye-white layers (a browser test builds that case), the outline of a source drawn with soft edges
      sits a pixel inside the art. Shapes are parts in the studio too (tree rows under **Shapes**, selection by row or outline, rename, delete, New shape, clip
      picker, group members, one shape per Apply) and bend with a group warp they are members of (robo's `eyelids` in `head_warp`).
    - [ ] Measure stencil masks on a low-end phone. The cost is unmeasured (each mask is a stencil push and pop and a batch break
      every frame); until then the safeguards are `checkRig`'s warning above 8 masks and the renderer's console warning, and
      the count is in the debug console's `memory` and in `vnStage()`. If it is too much: bake the clip into the texture
      for parts that do not move relative to their source.
    - [~] Editor viewport: the studio stage zooms toward the cursor (wheel), pans (middle-drag or Space+drag) and fits (F, Fit
      button), and the pivot crosses, skeleton and gizmo keep their on-screen size (`preview/studio-gizmo.ts`; the warp lattice and the
      mask outlines are overlays on the same zoomed stage). Left: zoom and pan on the timeline.
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
      `hair_back` (a skinned mesh whose 15 strand bones, five chains of three, are turned by the strand chains' physics; no parameters); script `wind right|left` with per-chain `windScale`,
      also carrying weather and bursts, and `gravity` for weather and bursts, shown in animations.vn and demo.vn; see docs/rig-json.md). Left: a
      number-field editor instead of JSON, a `physicsOff` for poses and a script switch, wind in the studio's Shake preview (the strand
      amplitudes were set by estimate, not tuned by eye), no browser test of the Physics tab, `wind` or `gravity`, an opt-in gravity
      for chains (hair that hangs by weight), and Mina's hair redrawn in layers so strands read as separate locks.
    - [~] Frame tracks: thumbnails in the blocks, onion skinning and a packed spritesheet per slot (asset loading). A frame track on
      a warped part is a `checkRig` error (it would need a mesh per variant). The rest (format, evaluation, renderer, Frames tab) is done.
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
- [~] Video: `movie play <name> [noskip | loop]` plays a fullscreen cutscene (webm/mp4; skip by click, look-ahead buffering,
  desktop pak already serves ranges). `image show <name> movie/<file> layer=-1` keeps a looping video (with its
  sound) under the dialogue (a moving backdrop). Open: a browser test with a generated clip, captions (.vtt), ducking
  or muting it under dialogue or music, a video that survives `scene`/rollback without restarting, and custom text boxes placed around a video
  (a separate display element, instead of the say screen).

## Player experience

- [~] Saves: named saves exist (game.json `saveNames`; a project's `screen saves` renames with `action rename`). Left: export
  and import saves in the web build (a file download/upload), so a player can move between browsers or keep a backup before
  clearing site data.
  A restore at a choice puts the line before it back in the box in one piece, so a line long enough to page (it types page by page on the first visit) is not paged there and is untested.
- [ ] The end of the game: the words are now translatable labels (`end_title`, `end_hint`, `rotate_device`) over a dimmed stage. Left:
  a short ending has no name of its own (PC-4; the quick menu now goes down at the end).
- [~] The quick bar (the labels have 28 px text and a dark halo). Left: it still overlaps the text box edge, touch targets are
  under 44 px, a tap beside it advances the story (PI-2, PI-3), and the editor's preview pane shows it at about 8 px (EA-19). Belongs with the touch steps of [docs/design/mobile.md](docs/design/mobile.md).
- [ ] The exported game's first load (UX round, [docs/design/ux-test-2026-11/px.md](docs/design/ux-test-2026-11/px.md)): the page says
  "Loading…" now, but the modules are still about 150 unbundled requests (6 s on fast 3G, 20 s on slow: PX-1; a bundled export
  would fix it); the first line after New game takes about 27 s on slow 3G (PX-3; the bar no longer reports 200 %, the wait is
  the first scene's assets behind the title music).

## Accessibility

- [~] Keyboard and gamepad navigation. Left: a real gamepad (only a simulated one is tested); non-standard pad mappings (the
  player gets only a toast; no remapping); the on-screen keyboard is Latin + å ö ä only.
- [~] Screen readers hear the dialogue (Options, Accessibility, "Screen reader reads dialogue"; docs/game-json.md): a live region
  gets each line once it is shown in full. Known faults with Windows Narrator: when a screen closes with focus on a button,
  focus falls to the page and Narrator reads the page title; and with Narrator on, key and focus navigation break (arrows,
  Space, Enter, numbers). Left: find out why (try NVDA and a plain browser window first); NVL pages and history are not
  announced separately.
- [ ] Focus and structure in the stock screens (UX round, [docs/design/ux-test-2026-11/pi.md](docs/design/ux-test-2026-11/pi.md)): closing
  a screen puts focus on the first button, not the one that opened it (PI-7); Tab does nothing during narration (it is Skip) and no screen lists the keys (PI-8); no landmarks or headings, and the
  Options tabs have no tablist or tabpanel (PI-6, PI-12); switches read "Reduce motion: Off" but are not `role=switch`.
- [-] **DEFERRED (much later)** A dyslexia-friendly font option and text-to-speech (self-voicing). (A high-contrast theme is
  built in; a game offers it by listing `high-contrast` in game.json `themes`.)

## Tooling

- [~] Files panel. Left: an open asset folder draws a row for every file in it (fine at a few thousand; use `VirtualList` if
  a project has one far bigger: step 2.2 of [docs/design/editor-asset-scaling.md](docs/design/editor-asset-scaling.md),
  measure with `scripts/measure-big-project.mjs`); renamed images that are character poses are not followed (nor `show alice smile` when a pose
  file is renamed); no rename of characters (converted or flat); no drag-and-drop moves inside the tree; no Undo for Rename.
- [~] Story outline. Left: back edges arc below the nodes and can cross labels in the same columns; a 300-label story lays out in
  one long row and Fit shows a thin strip (UX round EL-12; the layout itself is unit-tested for 400 labels).
- [~] "Did you mean" quick fixes. Left: game.json names and rig.json keys.
- [~] Translations dialog. Left: no import of a translated CSV; no translator notes.
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
  - [-] **DEFERRED (later)** Updates: tell the author when a newer Studio is released (a version check against the GitHub
    releases, opt-in), then auto-update.
  - [-] **DEFERRED (much later)** Studio and the desktop export's installer build (`npm run dist`) on Linux and macOS (only
    Windows is built and verified: `npm start` and the NSIS installer, Electron 45 on Node 24).
- [~] Online demo (docs/online.md): the editor as a static site with projects in IndexedDB. Left: the first deploy
  (`.github/workflows/online-demo.yml` runs on release tags once Pages is set to GitHub Actions); a browser test that builds it and plays it under a subfolder (the routes have
  node tests; the worker was checked by hand in Chromium only); try it in Firefox and Safari; Build/Export (web) in the
  browser, writing a playable zip.
- [ ] First run of Marginalia Studio and the online demo (UX round, [docs/design/ux-test-2026-11/st.md](docs/design/ux-test-2026-11/st.md)):
  no Studio download is published, only a build from a clone (ST-4: the docs say so and
  link the demo; a GitHub release with the zip would fix it); the first-run screen's only primary button is Open Folder (ST-5).
- [~] Desktop app (Electron, `vn export --desktop`).
  - [ ] Maybe let users drop modifier scripts in the folder that override some variables (needs a definition first).
  - [-] **DEFERRED (later)** Steam: achievements from game.json `achievements` sent to Steamworks (steamworks.js or
    similar, only in the desktop build, only when an app id is set), and the Steam overlay. Unsigned exes and the
    SmartScreen warning matter less there.
- [~] Configurable stage size (one size per project; a portrait version is a duplicated project). A portrait stage (taller than
  wide) gets portrait layouts of Options, Save and Load, History, Gallery and its viewer, Music, Chapters, Achievements and the
  toast (`engine/src/ui-screens-portrait.ts`, also what the editor's "Edit This Screen" copies); title, pause and quick menu are
  anchored and shared. Left: any landscape stage other than 1920x1080 (1280x720, say) still gets the 1920 layouts, so its Back
  buttons are off-screen (the starters would have to be written against the stage size like the portrait ones); the stock text
  box and the on-screen keyboard are still sized for landscape, and the keyboard is wider than a portrait stage (UX round PI-15);
  the portrait layouts were checked in a phone-sized Edge window, not on a real phone, and the portrait title and pause buttons
  are about 30 CSS px tall on a 390 px phone (PI-3).
- [~] Web export as an installable offline app (game.json `pwa`: a manifest and a service worker caching the build; built, with a
  browser test that starts the export with the network off). Left: a fullscreen button for itch.io embeds outside the Options
  screen; an "Add to Home Screen" hint on iOS; not tried on a phone, nor with a very large game (the worker caches every file on
  the first visit; no progressive or per-chapter caching).
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

## Code health

Left from the code-pattern audit; none changes behavior, so pick them up when touching the code anyway.

- [~] Make the flaky browser tests reliable: the causes (focus taken mid-typing, Space on a menu, asserting right after an async step, the editor still loading) are fixed in `browser.test.mjs`; the full 6-job run went from 3-6 failures to 0-2. Left: several more green full runs, then delete the rows in [docs/design/flaky-tests.md](docs/design/flaky-tests.md); the product's palette closing when the tree redraws.
- [ ] Decide whether the renderer side of the tint/weather/filter (and now wind/gravity) shape, the handlers in `display-state.ts` and the `world*` tweens in `pixi-renderer.ts`, earns a table; the parser part is done with `parseLevel`.
- [ ] Types for units and meaning: `Secs`/`Ms` in renderer, audio, line-typer and achievements (start by giving `sleep`/`later`/`step` params unit suffixes); 1-based vs 0-based line numbers (`rigHelpTopicAt`); `hud` `keep` and `sound`/`music` fields as per-mode unions; `EaseName`, and `SlideDir` (it exists in `screen-anim.ts`) for `scene dir`.
- [ ] Split the god files by responsibility (these have no node tests, so the browser gate applies; some functions are long too: `Runtime.stepOp` is about 220 lines and `parseStatement` about 140): `AnimStudio` (about 190 members; for example `anim-layout`, `anim-stage-bridge`, `anim-bindings`), `PixiRenderer` (about 130 members; a `world-effects.ts` for the tween-driven world ops, and the rest of the `studio*` methods next to `studio-queries.ts`, which already holds some), `Menus`, `StageRenderer` (in `preview/stage-ui.ts`).
- [-] **DEFERRED (much later)** Testability of module state: `createStorage(ns, backend)` with choice slots in one store, a `StageSize` instance instead of `export let W, H`, the shell as `GameShell`, an `EditorState` instance. No user-visible payoff.
- [-] **DEFERRED (later)** The hidden-iframe `requestAnimationFrame` stalls asset uploads (`upload()` in pixi-renderer.ts, up to 20 s); needs a repro first.
- [-] **DEFERRED (later)** Dev-server child processes (tsc watch) are orphaned when the server dies.

## Gameplay modes beyond VN (ideas, TBD)

- [~] View/animation mode: click an element while playing to trigger a sound and affect its animation. A hotspot over it with
  `on click` does this today; left: hotspots tied to a sprite (see "Hotspots follow the scene" below) and rig-level click reactions.
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
  - [~] Item stacks and combining: quantities work as repeated list entries (`count(bag, x)`), but nothing groups them for
    display ("×3"). Left: that grouping, and a combine flow (pick item A, then item B) as a documented pattern or a built-in,
    with the Mystery template as the example.
  - [~] Playtest bot and screens: checked: the bot already takes every enabled non-`act` element of a blocking screen
    as a choice, and states are deduplicated, so a looping room does not spin. Left: report an element that no route
    could ever enable (today only its unreachable handler lines/labels show); the bot
    counts situations by their variables, so a way from one large state space into another (the demo's tour or library
    back to its index) multiplies them until it stops with "more than 500 different situations" and names only the label:
    say which variables differ, or let an author mark ones the story no longer reads (the demo resets its index variables by hand; the bot already ignores variables that no condition reads or that are overwritten
    before a read, `engine/src/playtest-abstraction.ts`).

## Known gaps (user stories)

Things a visual novel author or player would expect that the engine lacks. Not scheduled: when one is picked up, move it
to "Next up" as a task and leave a pointer here. Format: *As a ..., I want ... so that ...*

- [~] As a writer, I want rich choice menus. Left: custom `screen` data for the choice menu (menus are not screens yet), a
  seen marker in the editor preview; timers for `input`/`screen`, a `timeleft` variable, per-menu extended time, saving the clock.
- [~] As a writer, I want my game in any language (variable formatting exists). Left: right-to-left text; line breaking
  for Chinese and Japanese (no line may start with 。、」 and the like).
- [~] As a player on a phone or tablet, I want the game to fit and play well on a touch screen, and a wrapper that ships it to
  iOS/Android. Planned in [docs/design/mobile.md](docs/design/mobile.md); steps 1 (fit, safe areas, rotate cover), 2
  (swipes, long press, `touch` in game.json) and 6 (installable app, game.json `pwa`) are built, step 3 (touch targets, text floor, Phone preview) mostly, and step 4 partly
  (wake lock, audio resume). Left: tap zones, a Problems check for small buttons and tap-to-inspect (3); the virtual keyboard for
  `input` and a low-end Android memory check (4, both need a real device); portrait (5), the iOS hint, a fullscreen button outside Options and progressive caching for big games (6), native wrapper (7);
  nothing tried on a real phone.
- [ ] As a player, I want a map of the routes I have seen (the Outline's flowchart, limited to labels reached in any
  playthrough, with jumps to chapter starts), so that finding the last ending is not guesswork. Opt-in in game.json.
- [ ] As a writer, I want to check a route without clicking through it: "play to here" with chosen answers (the playtest
  bot already walks every route; let the author pick one and land in the preview at its end).
