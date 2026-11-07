# Design notes: custom screens and hotspots

The original design for screens, hotspots and the HUD, kept for the reasoning and the open questions at the end. Much of it
is built since (screens, hotspots, lists, the HUD, layout helpers, built-in screens); the current behaviour is in
[../commands.md](../commands.md), so where the two differ, the command reference wins.

## Goal

One declarative mechanism for the interactive pages a story needs besides dialogue and menus: an inventory, a map with
clickable places, a stats page, a phone UI, and the point-and-click mode. All of them are backed by story variables, and
all of them hand control back to the script. The script, not the screen, owns the story.

```
screen map
    image "ui/map.png"
    hotspot cafe     at 595,454 size 230,108   "Café"     if met_alice
    hotspot station  poly 1300,560 1420,540 1440,650 1310,670 "Station"
    button  leave    at 1700,960               "Back"

label town
    show screen map                # blocks until a hotspot or button is chosen
    if screen == "cafe": jump cafe
    if screen == "station": jump station
```

(Exact syntax is the first decision below; this is only the shape.)

## Constraints from the current engine (verified)

- **A save is a source position plus `choices`.** `SaveData` holds `pc`, `stack`, `vars`, `state` and `choices: Answer[]`;
  `Runtime.restore()` replays recorded answers in order at each `menu` and `input`
  (`runtime.ts`: `this.choices.push(idx)` after `renderer.menu`, same for `input`). Rollback and "Preview from cursor"
  rely on the same replay. So a screen must be **one blocking op that resolves to one recorded `Answer`**, exactly like
  `menu`. Anything the player does *inside* a screen that is not that final answer must be either a script-visible
  variable change (saved in `vars`) or purely cosmetic.
- **`restore()` guesses unrecorded answers** (default option, capped at `RESTORE_GUESS_LIMIT` = 200). A screen needs a
  defined default answer, or "Preview from cursor" into a loop through a screen hangs again.
- **`engine/src/` has no DOM.** The screen description, validation, focus order and hit-testing (rectangles, polygons) are pure functions there,
  with tests in `engine/test/`. `preview/` draws.
- **`Renderer` is an interface** (`types.ts`), with `null-renderer.ts` for node tests. A screen adds one method,
  `screen(def, scope, src): Promise<Answer>`, next to `menu` and `input`.
- Localizable strings carry ids (`#ab12`), assigned by `npm run ids` and registered in `compile.ts`
  (`registerString`). Screen labels and tooltips are such strings.
- Keyboard and gamepad focus already exist for menus and the game shell (`preview/` focus navigation, simulated-pad
  tests in `browser.test.mjs`). Screens must plug into that, not invent a second system.
- Asset side: `attachPreloads` walks the program and `checkAssets` warns about missing files. Screen images must appear
  in both, or they will flash in.

## Design

### 1. Screens are declared once, shown from the script

A `screen <name>` block at top level (like `define`) declares the layout; `show screen <name>` is the statement that
blocks. Reasons for splitting declaration from use: the same screen is reused from many places (the map is opened from
every location), and declarations can be compiled, checked for unknown variables and preloaded without running the
story.

Elements, kept deliberately few for v1:

| Element | Purpose | Notes |
|---|---|---|
| `image "file" [at x,y] [size w,h]` | backdrop or decoration | stage pixels |
| `hotspot <id> <shape> "label"` | clickable region | shape: `at x,y size w,h`, `poly x,y x,y x,y ...`, `ellipse`, or `mask "file"`; hover highlight, tooltip = label |
| `button <id> at x,y "label"` | clickable themed button | same answer mechanism as a hotspot |
| `text at x,y "..."` | label with `[var]` interpolation | reuses the existing text interpolation and tags |
| `each <list> as item` | repeat a block per entry | needs the list type, which is built first (see "Lists first") |

### Lists first

Decided: list variables land **before** screens, as their own task (inventory, `each`, and the "Known gaps" list item).
Sketch to settle in its own mini-plan: `set bag = []`, `add bag "key"`, `remove bag "key"`, `contains(bag, "key")`,
`count(bag)`, `bag[0]`, `[bag]` in text; stored in `vars` (so saves and rollback work), compared by value, and shown in
the Variables panel. Screens then use `each bag as item` to make one button per entry, with the entry as the answer.

Every interactive element has an `id`, an optional `if <expr>` (shown at all) and an optional `enabled <expr>` (shown,
greyed, not selectable).

**Coordinates: stage pixels, 1920x1080, origin top left, y down.** This is what the stage already is: `#stage` in
`preview/index.html` is a fixed 1920x1080 element that the shell scales to the window, `theme.ts` already speaks
"stage pixels (1920x1080)", and the Pixi canvas is created at that size. So a screen scales with the window for free,
and a map drawn at 1920x1080 can be measured in any image editor and typed straight in. (Characters use fractions of
the width for `x`, but those are positions *on a changing set*; screen art is authored at a fixed size, so pixels
are less error-prone.) Rectangles are `at x,y size w,h`. An `image` without `size` is drawn at its natural size.

### 2. Returning control: the answer is the element id

`show screen map` resolves to the id of the chosen element and stores it in a variable, named `screen` by default or by
`show screen map as place`. That value is the recorded `Answer` (a string, which `Answer` already allows for `input`).
The script branches with ordinary `if`/`jump`. Consequences:

- Saving, rollback and replay come for free: the answer list holds `"cafe"`.
- A screen **always returns**; it never runs script code itself. No callbacks, no actions attached to elements in v1.
  If a button should change a variable (a toggle on a stats page), the script loop does it:
  `show screen phone` → `if screen == "silent": set silent = not silent` → `jump phone_loop`. Slightly verbose but one
  rule, fully rollbackable, and every state change is visible in the story.
- A screen may be declared **non-blocking** later (an HUD that sits over dialogue). That is a different feature
  (persistent overlay, closer to overlay images) and is out of scope here.

### 3. Point-and-click mode is a screen over a scene

Point-and-click is not a separate mode: it is a screen whose backdrop is the current scene (`show screen room`
with no `image`, hotspots over the live background) plus an inventory screen. "Inventory" is a screen that lists items
by variables (`if has_key`). This keeps the plan to one mechanism, as the TODO asks. Two small additions make it work:

- `hotspot ... cursor "magnifier"` to change the pointer (cosmetic).
- Using an item on a hotspot is a script concern: pick an item on the inventory screen, store it in a variable, then
  `show screen room` again and compare. No drag and drop in v1.

### 4. Saves, rollback, hot reload

- The open screen is **not** saved state: a save is only possible at a line, menu or input boundary today, and a screen
  is a boundary like a menu. Saving "on" a screen stores `pc` at the `show screen` op; loading reopens it.
- Rollback steps back over a screen the way it steps back over a menu: restore to the previous op, replaying answers.
- Hover and focus highlight are never saved.
- Hot reload in the editor re-renders the open screen from the new declaration; if the element the player was on is gone,
  focus resets to the first element.
- `Runtime.restore()` default answer for an unrecorded screen: the first enabled element, or a declared
  `default <id>`. An empty screen (all hidden) resolves immediately with `""` rather than blocking forever (and warns
  at compile time if it is statically empty).

### 5. Keyboard and gamepad focus

- Focus order is **declaration order** by default; `focus` hints can override with `up/down/left/right <id>`.
  Without hints, directional navigation picks the nearest element in that direction by centre distance (a pure
  function in `engine/src/screen-geometry.ts`, unit-tested on grids, rings and rows). That is enough for a map; explicit hints
  are only for awkward layouts.
- Confirm picks the focused element; cancel returns `""` if the screen declares `cancel` (otherwise it is ignored, so a
  required choice cannot be skipped).
- Mouse hover and keyboard focus show the same highlight; the tooltip appears for both. Touch: tap selects.
- Reuse the shell's focus-navigation code; screens register their elements as the focus set while open.

### 6. Localization

- Labels and `text` strings are `#id` strings, extracted by `npm run strings` like menu options.
- Positions are not localized. If a translation needs a bigger label, the button grows from its anchor, not the other
  way round (open question 6 covers per-locale layout).
- `image` file names are not translated in v1 (a locale-specific map image is the same problem as translated
  graphics elsewhere; defer).

### 7. Themes, assets, preload

- Elements use the existing theme tokens (box colour, font, focus ring). `docs/game-json.md` gets no new keys in v1
  except an optional `screens` table of per-screen overrides if needed later.
- `attachPreloads` treats `show screen X` as using every `image` in X; `checkAssets` warns about missing files and
  about hotspots outside 0..1.

## Build steps (after the list type exists and the open questions are settled)

1. **Types and pure core.** `engine/src/screens.ts` (definition types), `screen-validate.ts` (validation: unknown ids, duplicate ids,
   out-of-range rectangles, empty screens), directional focus, hit-testing, the default answer. Tested first, no runtime.
2. **Parser, compile, ids.** `screen` blocks (indented body, like `menu`) and `show screen`. `ids.ts` and
   `compile.ts` (`registerString`) for labels. Variables referenced by `if`/`enabled` are checked like elsewhere.
3. **Runtime op.** `{ op: 'screen' }` in `types.ts`; `runtime.ts` awaits `renderer.screen(...)`, pushes the answer to
   `choices`, assigns the variable. Extend `restore()` guessing, `null-renderer.ts`, and the whole-state `deepEqual`
   tests only if `SpriteState` is touched (it should not be).
4. **Renderer.** `preview/` draws images, hotspots and buttons in the Pixi stage or as DOM over it. Decide below. Hover,
   focus ring, tooltip, disabled look, pointer cursor, reduced-motion (no pulsing highlights).
5. **Focus and input.** Plug into the shell's keyboard and gamepad navigation; add browser tests with the fake gamepad.
6. **Editor.** Completions for the new elements and attributes (`editor-support.ts`), outline edges for
   `show screen` (a screen is a node with the labels its answers jump to, which `buildOutline` can only guess at; list
   as "unknown" in v1), a Problems entry for unknown screens, `docs/commands.md` section (mind the `### a / b`
   heading rule), README syntax block.
7. **Sample.** A small `games/sample/script/` demo (map with three places, an inventory) entered with Preview from cursor,
   like `demo.vn`. Do not touch `park.vn`'s choice order. Then `npm run ids`, `npm run strings`.
8. **Tests.** Parser, validation, focus movement, answer replay (save, load, rollback, restore into a screen loop without
   hanging), preload coverage, and a browser test that clicks a hotspot and checks the story branch.
9. **TODO.md.** Mark the item done, link this plan, and unblock "Point and click adventure mode" and "View/animation
   mode" with what is left.

## Decisions

0. **HUD events call a script label.** Decided. Choosing a HUD element `call`s its label at the next safe point and
   `return` resumes the interrupted line.
1. **Syntax: script block.** Decided.
2. **Rendering: DOM over the canvas.** Decided. The stage is already a 1920x1080 DOM element with the Pixi canvas as
   its first child (`stage.prepend(canvas)`), and the menus, panels and quick menu are DOM siblings above it. Screen
   elements are absolutely positioned children of `#stage` in stage pixels, so they sit exactly over the art, scale with
   the window and get real focus, tab order, text wrapping, hover and ARIA. Pixi is used only for the scene behind.
3. **Lists first.** Decided (see "Lists first"). Screens wait for them.
4. **Coordinates: stage pixels, 1920x1080.** Proposed above; confirm.
5. **Custom hover shapes: yes, via an SVG layer.** Rectangles and ellipses are plain elements. Polygons (`poly`) go in
   one absolutely positioned `<svg viewBox="0 0 1920 1080">` over the stage, with a `<polygon>` per hotspot: the browser
   hit-tests the exact outline, `:hover`/`:focus` styles and `tabindex` work, and clicks reach only the shape (the SVG
   root has `pointer-events: none`, each shape `pointer-events: all`). Irregular regions drawn in an image editor use
   `mask "file"`: a PNG whose opaque pixels are the region, tested on pointer move against a canvas copy of the mask
   (`getImageData`, cached per file, region bounding box first for speed). Keyboard focus ring for any shape is its
   bounding box or its outline stroked, in the theme's focus colour. Directional focus uses the shape's centroid.
   The pure side (`engine/src/screen-geometry.ts`) holds point-in-polygon, bounding box and centroid, tested without a DOM.

## Persistent HUD (planned for, built after blocking screens)

Decided: the design must leave room for a screen that stays up while the story runs (an inventory button, a stats strip,
a phone icon, a point-and-click verb bar). It is built *after* the blocking screen, but nothing in v1 may rule it out.

- **Two modes of one declaration.** A `screen` can be shown blocking (`show screen map`) or as a HUD
  (`hud on inventory` / `hud off inventory`). The same elements, conditions and focus code serve both; only the
  lifecycle differs. Declare with the same `screen` block, so a screen can be both (a map that is also a pinned minimap).
- **A HUD never blocks the script.** Choosing a HUD element does not resume a `show screen`; it queues an *event*
  the script handles at its next safe point. Proposal: `on hud` handlers are labels the engine `call`s when an element
  is chosen (`hud inventory button bag -> label open_bag`), with `return` going back to the interrupted line. This is
  the one place a screen starts script code, so keep it to "call a label", nothing more.
- **State lives in the display state.** Which HUDs are on is part of `DisplayState` (like sprites), so save, rollback,
  restore and hot reload rebuild it; reset by `scene` unless marked `keep`. One-line rule: *what is on screen is saved,
  what the player did is the answer list.* The chosen-element event is recorded as an answer so replay is exact.
- **Safe points.** Events are taken at a line or menu boundary, never mid-typing, never during a transition, and
  not at all while a blocking screen, menu, pause or history panel is open. Skipping and auto mode pause while an event
  is pending.
- **v1 prerequisites that keep this open:** (a) the screen renderer takes a *mount* (modal layer vs HUD layer) rather
  than assuming it owns the stage; (b) element ids and the answer type are plain strings, usable as event names;
  (c) the screen definition has no assumption that something awaits it; (d) focus code supports a second, passive focus
  group (HUD reachable by a key such as Tab or a pad button without stealing confirm from dialogue).
- **Relation to overlay images.** A HUD `image` element is an overlay in screen space; overlay layers (named layers,
  z-order, fades) are the shared image pipeline, so build HUD on top of them, not beside.

## Later phase: author-designable built-in UI and layout helpers

Not part of v1, but the v1 design must not block it. Today `game.json` `theme` only restyles the text box, name box and
choices (position, size, frame image); the quick menu, title, save, options, history and gallery screens use fixed CSS
layouts in `preview/index.html`, and `quickMenu`, `titleScreen` and the like choose *what* appears, not *where*.

- **Layout helpers.** Containers that place children without pixel arithmetic: `row`, `column` (gap, padding, align
  start/center/end, spread) and `grid <columns>`, plus `at x,y` to place a whole container, and `anchor <edge|corner>`
  to pin it to the stage (top-right corner with a margin, bottom centre). Children of a container may omit `at`.
  Absolute `at x,y` stays for maps and art-driven layouts. Containers nest, and an `each` inside a `column` makes an
  inventory list. Implemented with CSS flex and grid in the DOM layer, so focus order follows layout order.
- **Built-ins as screens.** Re-express the title screen, quick menu, pause/options, saves, history, gallery, music room
  and chapter select as default `screen` definitions shipped with the engine. A project overrides one by declaring a
  screen of the same reserved name (`screen title`, `screen quickmenu`, ...), or keeps the default. Built-in actions the
  elements trigger (`start`, `load`, `save`, `options`, `quit`) become element kinds (`action start "New game"`), since
  these are the one case where an element does something other than return an id.
- **Why later.** It needs the blocking screen, the HUD (the quick menu is a HUD) and the layout containers to exist and
  be stable first, and it rewrites shell code that is covered by `browser.test.mjs`. Take it one built-in at a time,
  quick menu first, keeping the old CSS path as the fallback until each is covered by tests.
- **v1 rules that keep it open:** element kinds are an extensible set; every element can carry a theme skin name; the
  screen renderer does not assume absolute positions; and the reserved screen names are not used by user screens.

## Item display names

Decided: items are declared in a `define item <id> "Name" [image=<file>]` table, like `define` for characters. The name is a
localizable string with an id; the image is an asset checked by `checkAssets` and preloaded when a screen that lists the
item is shown. Lists hold plain ids; `each bag as item` gives `item.name` and `item.image`, and `[bag]` in text shows
names. A missing name or image is a compile warning. Build this together with `each`.

## Overlay images: option C

Decided: screens, the HUD and overlay images share **stage-pixel coordinates (1920x1080) and one asset path** (one image
folder, one preload and `checkAssets` path), but render separately. Overlays draw in Pixi, so a "world" overlay can follow
the camera and filters. Screen and HUD images draw in DOM, which keeps focus, hover and ARIA. Neither feature blocks the
other, and a HUD may later use either. The overlay item in TODO.md should reuse this coordinate system and asset kind.

## Still open

None. Remaining detail (list syntax, exact `screen` grammar) belongs to the build steps and the lists mini-plan.

## Out of scope for this feature

- Building the persistent HUD in v1 (planned for above; built afterwards).
- Per-locale layout and right-to-left layout: decided out of scope. Positions are the same in every language.
- Time-limited screens (a countdown that auto-answers): deferred to much later, together with timed choices on `menu`
  (a shared `timeout` would be the model).
- Drag and drop, scrolling lists, text fields inside screens (use `input` for text).
- Scripted element actions or callbacks.
- Animated elements (`animate` targets characters only today).
- A visual screen editor in the editor app.

## Acceptance

- A script can show the map and the inventory sample screens, branch on the chosen element, and loop back.
- Save, load, rollback and Preview from cursor into a screen loop all work; no hang.
- Mouse, keyboard and simulated gamepad can reach and pick every enabled element; disabled ones cannot be picked.
- Strings appear in `games/sample/locale/en.json` and are translatable; missing images and bad rectangles show in Problems.
- `npm test` is green; docs, help topics and completions mention screens.
