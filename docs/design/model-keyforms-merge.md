# Plan: Model mode becomes the parameter-first flow, Keyforms mode goes

Goal: Cubism's two-mode split. **Model** = sliders keyed to transforms, parameter first (pick the active parameter in the
palette, then pick parts to bind them and make their keys). **Animate** = animations move slider values. One Parameters
palette, one bound-parts block, no "keyed target" guessing. Scope is structural only: no new features.

## Behaviour after the merge
- `StudioMode` is `'model' | 'animate'`. `studioMode('keyform')` still maps to `'model'` (old callers, stored links).
- Model keeps its other jobs: Pivot tool, bones/parts/looks, Warp and Mask tools, physics, By itself, Selection.
- The active parameter is explicit (a click on a row or name). It is never guessed from the last control used or from the
  part's drivers.
- Stage click: no active parameter -> only selects. Active parameter -> selects and binds (as Keyforms did). **Shift-click**
  only selects (the stage message `studioSelect` gains `shift`).
- Model now starts on the Move tool (it was Pivot): with Pivot on, a click on the stage moves the chosen part's pivot, which
  would fight picking parts to bind. The Pivot tool is still one click (Q) away.

## Files and functions
- `engine/src/studio-layout.ts`: drop `'keyform'` from `StudioMode`, `STUDIO_SECTIONS`, `studioMode`. Model sections:
  tree, params, sel, warp, mask, physics, auto (Parameters first, open; Selection open).
- `engine/src/keyform-edit.ts`: delete `removeSpot` and `keyedValues` (only the part-first flow used them). The rest
  (`writeForm`, `dragForm`, `snapSpot`, `formAt`, `padCorners`, `extendGrid`, `keyformDrivers`...) is the shared library.
- `editor/anim-studio.ts`: delete the `paramFirst` getter and every `!paramFirst` branch: `keyedControl` guess,
  `keyedInfo`, the part-first `keyformDrag`/`toggleKey` (the `...Active` versions take their names), `ticksOf` and
  `cornersOf` fallbacks, `modelHint` part-first lines, `chooseControl`'s non-first path, `setMode` activeControl juggling.
  `select` event: bind only when not shift. `setPicking`: only the Pivot tool picks. `bindView` returns the empty view
  outside Model. Remove imports that go unused.
- `editor/anim-params.ts`: delete the `paramFirst`, `keyedInfo`, `setField`, `resetForm` host members, `choose()` (the
  guess), `showTarget`, the `.ap-target` line and the `.ap-kf` Keyform row (the Pose fields in the bound-parts block are
  the one editor). `authoring()` takes `paramFirst()`'s place in the remaining branches.
- `editor/anim-warp.ts`: the Warp section's own parameter picker and slider (`.aw-paramsel`, `.aw-value`, `.aw-param`) go;
  the warp is always keyed to the active parameter. `paramFirst` host member removed.
- `editor/anim-gizmo.ts`: `setMode`/`setTool` lose the `keyform` cases; Model starts on Move.
- `editor/anim-bind.ts`, `editor/anim-tree.ts`: comments only (no longer "Keyforms mode").
- `editor/anim-stage.ts`, `preview/studio-gizmo.ts`: pass `shift` on select.
- `editor/sidebar.ts`: remove the "Keyforms" menu entry that opens the studio.
- `editor/studio.css`: remove every `[data-mode="keyform"]` rule; `.ab` shows in Model and is hidden in Animate; the
  Parameters section keeps `order: -1` in Model; drop `.ap-target`, `.ap-kf` rules.
- `index.html`/mode buttons: built in `anim-studio.ts` (the `data-mode="keyform"` button goes).

## Deleted
Keyforms mode and its button/menu entry, the keyed-target line, the Keyform row, the Warp section's parameter picker and
slider copy, `removeSpot`, `keyedValues`, all `paramFirst` plumbing.

## Docs
`docs/design/studio-ux.md` (modes table, Keyforms sections, Open questions), `docs/design/animation-studio-parameters.md`,
`docs/rig-json.md` (mode names, "Authoring keyforms" sections), `docs/architecture.md`, `docs/standalone-studio.md` only
where they name the mode, `TODO.md` (rewrite "Left in it").

## Tests
- `studio-layout.test.mjs`: two modes, new section lists/defaults.
- `keyform-edit.test.mjs`: drop the `removeSpot`/`keyedValues` cases.
- `browser.test.mjs`: the Keyforms test runs in Model (plus "no parameter: a click only selects", shift-click selects only);
  the Model part-first tests (keyed target, gizmo drag at the keyed parameter, pad grid by last control) are rewritten to
  pick the parameter first or removed where the parameter-first test already covers them; the Warp test picks the active
  parameter instead of the Warp section's picker.
- Gate: `npm test` green; `node scripts/browser-gate.mjs` once; screenshots of the flow on the sample robo rig.
