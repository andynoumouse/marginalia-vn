# Phone and tablet play

Plan for playing an exported game on a touch device. Steps 1 and 2 are built, step 3 mostly, step 4 partly (see their notes); the rest is not.

## Where the game stands

- The stage is a fixed `W x H` box (1920x1080 by default) that `fit()` in `preview/preview.ts` scales to `window.innerWidth/innerHeight`
  and centres. On a phone that is a scale of about 0.2 to 0.45, so every stage pixel is small.
- A tap already advances (the stage `click` handler), and screens, choices and menus are DOM buttons, so they work under a finger.
- The viewport meta is `width=device-width, initial-scale=1`: no `viewport-fit=cover`, no safe-area insets, nothing that stops
  double-tap zoom, pull-to-refresh or text selection.
- Several actions exist only for a mouse or keyboard: rollback is the wheel, the pause menu is the right click (`contextmenu`),
  hide-UI is the middle click, and the quick-action bar is the only button route to history, auto and skip.
- Hover-only features: hotspot and button tooltips, `hover` images, hover-reveal. They have no touch route yet (the screen
  contexts design already plans a tap-to-inspect step, see [screen-contexts.md](screen-contexts.md)).
- `audio.unlock()` runs on `pointerdown`; iOS Safari only counts `touchend` / `click` as a user activation for audio.
- The Fullscreen API is missing on iPhone Safari; `has_fullscreen` already hides the button there.
- A project's stage size is configurable, so a portrait game is possible. The list and settings screens have portrait layouts
  (step 5); the title, pause menu, quick menu and text box are still the landscape ones, and a landscape stage other than
  1920x1080 gets the 1920 layouts.

## Decisions

- **Same page, no second UI.** Touch is an input mode of the existing shell, not a separate build. Behaviour that differs is
  keyed on `(pointer: coarse)` / `(hover: none)` or on the last input used (the way `stage.dataset.pad` works for a gamepad).
- **Pure logic in `engine/src`.** The gesture classifier (a pointer path to an action) and the touch-target scale are pure
  functions with node tests; `preview/` only feeds them events.
- **Gestures are opt-out per project** in game.json (`touch`), with the player's own switch in Options, because a swipe
  can clash with a game's own screens (a scroll list, a slider).
- **Desktop must not change.** Every touch behaviour is gated on `(pointer: coarse)`, `(hover: none)` or the last input being
  touch. The shared parts are checked on desktop after each step: `fit()` (with `visualViewport` it must equal
  `innerWidth/innerHeight` on a desktop window), the stock text box, quick bar and title (the padding is 0 without insets),
  and the Electron app, which uses the same shell. The page-wide CSS is scoped to `(pointer: coarse)`, so mouse users can still
  select and copy text (the history screen); `user-select: none` is never global. The service worker (step 6) is off in dev mode.
- **Landscape first.** Portrait play came later and rests on the stock screens' portrait layouts (step 5).

## Steps

1. **Display and safe areas.** (small, do first; fixes most of the "feels broken" problems)
   - `viewport-fit=cover`; fit to `visualViewport` (or `100dvh`) so the URL bar showing and hiding does not leave a gap or a
     scroll; refit on `visualViewport` resize and on `orientationchange`.
   - Expose the notch insets as `--safe-top/right/bottom/left`, converted to stage pixels (`inset / scale`), and have the stock
     text box, quick bar and title use them as padding. The letterbox background keeps filling the whole window.
   - `touch-action: manipulation`, `user-select: none`, `-webkit-touch-callout: none`, `overscroll-behavior: none` on the page
     (no double-tap zoom, no pull-to-refresh, no long-press selection or callout).
   - Portrait window on a landscape game: a "rotate your device" cover, and `screen.orientation.lock('landscape')` where allowed.
   - Audio unlock on `touchend` / `click` as well as `pointerdown`; `playsinline` on movies.
   - **Built, with these differences:** `fit()` keeps `innerWidth/innerHeight` (a pinch-zoomed `visualViewport` would refit the
     stage, and desktop must not change) and the page is `100dvh` on coarse pointers; the helpers are `fitScale`, `stageInsets` and
     `needsRotate` in `engine/src/stage-fit.ts`; the insets pad the stock text box only (the quick bar and title are the
     author's screens: left to do, with the touch-target work); `user-select: none` was not added (the stage already has it); no
     orientation lock (it needs fullscreen) and no `playsinline` yet (movies); the rotate cover shows only in an exported game, not
     in the editor preview. Browser set skipped by the gate (4/5); not tried on a real phone.
2. **Gestures.** (`engine/src/gesture.ts`)
   - Tap advances (as now). Swipe right: rollback. Swipe left: forward only if the line is fully shown (the same as a tap, so a
     stray swipe never skips text). Swipe up: history. Long press or two-finger tap: pause menu (replaces `contextmenu`, which
     iOS never fires). Swipe down: hide / show the UI.
   - Thresholds in CSS pixels, not stage pixels (so they do not change with the scale); ignore a path that starts on a button, a
     scroll list, a slider or a hotspot; cancel on a second pointer.
   - Optional tap zones (left edge = back), off by default.
   - game.json `touch: { gestures, tapZones }` and an Options switch ("Touch gestures").
   - **Built, with these differences:** swipe left does nothing (the tap advances; a swipe never skips); `touch` has only
     `gestures` (tap zones are not built); the stage takes `touch-action: none` while gestures are on and scroll lists opt back
     in; a long press while the UI is hidden brings it back; the switch (`touch_gestures`, `has_touch`) is in the starter options
     screen's Accessibility tab, shown on touch screens only. Classifier and `touch` checks: `engine/src/gesture.ts`. The full
     browser set ran: 3 animation-studio tests fail, and they fail the same on a clean checkout. Three browser tests
     (`touch:` in `browser.test.mjs`, an emulated phone and DevTools touch events) cover the swipes, the long press, the
     two-finger tap and `gestures: false`; not tried on a real phone.
3. **Touch targets and text.**
   - A minimum target size: the quick bar and the stock buttons are given a stage-pixel size of at least `44 CSS px / scale`, so
     they stay tappable at any window size. Same for the text size: a floor in CSS pixels, overridable in Options.
   - Custom `screen` elements are the author's; add a check to the editor's Problems list for a button smaller than 44 CSS px at the
     smallest supported scale, and a "Phone preview" button in the editor that resizes the preview to a phone size and sets touch mode.
   - Hover-only features: the tap-to-inspect step (first tap names the element, second acts) from the screen contexts design,
     enabled when the last input was touch; tooltips show on tap and hide on the next tap.
   - **Built so far:** (1) the stock quick bar (`barBoost` in `engine/src/touch-target.ts` enlarges it from its edge to a 32 CSS px
     minimum, at most twice and only as far as the stage has room; `boostQuickBar` in `preview/preview.ts`); (2) near-miss taps on
     any open screen or menu (`resolveTouch`: a tap beside a button presses the nearest one within a 44 CSS px target, a direct hit is
     never stolen; a capture-phase click handler in `preview/preview.ts`). Layouts stay as the author drew them, so this covers custom
     screens too. Browser tests for both. (3) dialogue text is never under 16 CSS px (`textFloor`, up to 1.5 times, as `--touch-text` on coarse pointers; the player's own text size comes on top). (4) the editor's Phone preview: palette commands that size the preview pane and post a `device` message that puts the game in touch mode (`editor/preview-device.ts`; a browser test). Left: the Problems check (less pressing now that taps are forgiving; a
     warning for a button under about 20 CSS px at the phone scale), and tap-to-inspect (waits for the screen
     contexts design). The near-miss handler does not apply during plain play, so a tap beside the quick bar still advances.
4. **Device quirks.**
   - **Built so far:** the screen wake lock while auto-advance or a movie plays on a touch screen (`preview/wake-lock.ts`, a browser test
     with a fake API), audio resumed when the tab comes back (`unlock()` now resumes from any state but running, which covers iOS's
     `interrupted`). Movies already had `playsinline`. Left, and needing a real device to do properly: the virtual keyboard for `input` prompts
     (modern Chrome and iOS pan the visual viewport on their own; check that the field stays visible and the stage does not refit), and the
     low-end Android memory check.
   - Virtual keyboard for `input` prompts: the page moves with `visualViewport` so the field stays visible; the on-screen pad
     keyboard stays off in touch mode.
   - Wake lock while auto-advance, voice or a movie plays; resume audio and movies when the tab comes back.
   - Memory: phones are where `memoryBudgetMB` and the asset-loading checks matter (see "verify asset loading on real devices" in
     the Shipping section of TODO.md); measure on one low-end Android before calling this step done.
5. **Portrait and other aspect ratios.** Stock screens and the "Built-in screens" starters get variants chosen by the stage size;
   a project can pick a landscape or portrait size per orientation, or stay locked. Needs real art and a design.
   - **Built so far (portrait only):** a stage taller than wide draws Options, Save and Load, History, Gallery and its viewer, Music,
     Chapters, Achievements and the achievement toast from `engine/src/ui-screens-portrait.ts` (`screenStarter(name, stage)` in
     `engine/src/ui-screens.ts` picks; the editor's Show Default Code and Edit This Screen use it too). They are written for a
     1080-wide stage about 9:16 or taller and every length scales with the width. Settings are a label over a full-width control, list
     rows are 110 px, Back is a 120 px button at the bottom. The words are the landscape screens' words, so translations still apply.
     `engine/test/ui-screens-portrait.test.mjs` resolves every one with long data on three portrait sizes and fails for anything
     outside the stage or touching Back. Checked in an emulated phone window only. Left: other landscape sizes (1280x720 still gets
     the 1920 layouts), near-square stages, the title, pause and quick menus at phone size, the on-screen keyboard (wider than the
     stage).
6. **Installable web app.** (pairs with the offline-app item in TODO.md) Manifest with `display: fullscreen` and `orientation`,
   service worker, an "Add to Home Screen" hint on iOS (no install prompt exists there).
   - **Built, with these differences:** opt-in with game.json `"pwa": true` (`engine/src/pwa.ts`, written by `tools/export-web.mjs`, registered
     by the shell only when index.html links the manifest). The worker caches every file of the export on the first visit under a name
     taken from the build and answers cache first, so a large game costs its whole size at once. A browser test exports the demo and
     starts it with the network off. Left: the iOS hint, a fullscreen button outside Options, progressive caching for big games.
7. **Native wrapper.** (much later) Capacitor around the web export for iOS and Android: safe areas, the file-based saves of the
   desktop app, store icons. Only after steps 1-4 hold up in a browser.

## Testing

- Browser tests: playwright-core device emulation (`hasTouch`, `isMobile`, a phone viewport) for the fit, safe-area variables,
  gestures (dispatched touch events) and the minimum target size. Gate as usual (`scripts/browser-gate.mjs`).
- Node tests for `gesture.ts` (swipe versus tap, ignored starts, cancel) and the target-scale function.
- By hand, once per step: one iPhone (Safari) and one Android (Chrome). Emulation does not reproduce the URL bar, audio unlock or
  the virtual keyboard.

## Open questions

- Is swipe-left meant to advance? (Leaning no: advance is the tap, and a swipe must never skip.)
- Do gestures need to be rebindable in game.json, or is on / off enough?
- Does Studio's export need a "mobile" check in the Build dialog (target size, orientation, asset budget)?
