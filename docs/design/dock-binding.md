# Binding the animation studio's sections to the dock

Status: built (spec, dock-ui, markup, wiring, reset, narrow); the split grip sits between Parameters and Parts only while they are neighbours on the left. Left: touch polish, a per-mode layout, dragging into the centre. The pieces it uses exist and are tested on their own: the model (`engine/src/dock.ts`, `engine/test/dock.test.mjs`),
the DOM layer (`editor/dock-ui.ts`) and its bench (`editor/dock-sandbox.html`, `npm run test:dock`). Context: [studio-ux.md](studio-ux.md).

## What becomes movable

*Since changed:* the sections are now tree, poses, params, keyforms, param, sel (titled Properties), frames and place; Warp,
Mask, Physics and By itself are gone from the dock (see [studio-inspector.md](studio-inspector.md)), and the defaults are
`START` in `engine/src/studio-layout.ts`. The timeline folds to its transport row (built later).

The sections: Parts (`tree`), Parameters (`params`), Keyforms, Selection (`sel`), Warp, Mask, Physics, By itself (`auto`), Frames, Place in
scene (`place`). Not the stage, its tool row, the transport row or the timeline: the centre stays as it is (folding the timeline to its
transport row is a separate item).

Two zones, `left` (`.as-side`) and `right` (`.as-inspect`), no limits on where a section goes. Defaults are today's columns:
`params` over `tree` on the left, everything else on the right, in the order of the markup (the spec lists them explicitly and a test checks that every section of both modes is covered). One layout serves both modes: a section
moved in Model is where it was left in Animate, and a mode only decides which sections are *present* (`setPresent`).

## Pieces

1. **Spec (pure, `engine/src/studio-layout.ts`).** `studioDockSpec()` builds the `DockSpec` from `STUDIO_SECTIONS` (the union of both
   modes' ids, zone as above). `studioPresent(mode, without)` gives the ids a mode shows, replacing the filter in `showSections`.
   Node test: the union has no duplicates, the defaults equal today's two columns, `without` leaves panels out.
2. **Markup.** Each column gets a `div.as-dock` that holds only sections; the picker, the name form, the Look select and the split grip
   stay above it. Each section head gains a grab button (`⠿`, `data-dock-handle`, label "Move <title>; Alt+arrows also move it"). The
   head's own button still folds the section. `mountDock` gets `zones: {left, right}`, `panels` from `.as-sect` by `data-sect`,
   `handle` the grab button.
3. **CSS.** The rules that name `.as-side > .as-sect` become `.as-dock > .as-sect`; the `params` height cap (`--as-split`) and the
   `tree` fill stay keyed by `data-sect`, but apply only when they are the left zone's first two sections. The split grip is shown only
   when `params` is directly followed by `tree` in the left zone; otherwise both just share the column by content, each scrolling inside its
   own body. The right column keeps scrolling as a whole.
4. **dock-ui change: hide, do not detach.** Much of the studio finds its controls with `this.root.querySelector(...)`, so a section
   removed from the DOM would break those lookups. `setPresent` therefore sets `hidden` on absent panels and leaves them in their zone.
   `showSections` already does this; the dock takes over only the position. Drop-target hit-testing skips hidden panels (it already
   skips panels with no box). Update `dock-ui.test.mjs` (hidden stays in the DOM, `hidden` attribute set).
5. **Studio wiring (`editor/anim-studio.ts`).** Mount once, after the markup. Keep the dock layout under its own key
   (`vn-studio-dock`, written with `writeDock`, read with `readDock`), not inside `StudioLayout`: `fixDock` already heals a layout from
   another version, and the open/closed and size parts of `StudioLayout` stay unchanged. `setMode` calls `dock.setPresent` next to
   `showSections`. A **Reset layout** button in the header calls `dock.setLayout(defaultDock(...))` and clears the key.
6. **Narrow windows (max-width 900 px).** One column in the order Parts, Parameters, then the rest, as today. On entering narrow the
   studio shows the default layout (`setLayout`, which does not save) and hides the grab buttons; on leaving it shows the stored one
   again. A `matchMedia` change listener does both.
7. **Tests.**
   - Node: item 1.
   - `npm run test:dock`: item 4.
   - Studio in a real browser (a test in `browser.test.mjs` beside the existing studio tests, mocked `/api/...` routes, no writes to
     the sample): drag Selection to the left column; the stored key has it; reopen and it is there; Reset layout restores; Alt+Down
     moves it; narrow viewport ignores the layout; Model/Animate switch still shows the right sections; a control inside a moved
     section still works (add a key with the Key button).
   - Run `node scripts/browser-gate.mjs`, `npm run test:dock`, and `npm run test:studio` (the Electron Studio loads the same page).

## Risks

- **Detached lookups** (item 4) are the main one; the hide-not-detach rule removes it. Moving a node keeps its listeners, but loses
  focus and resets scroll inside it; `dock-ui` refocuses the grab button, and only the moved section is touched.
- **Canvases and observers** inside sections (the pad, the physics preview): a move should not rebuild them. Check the Physics tab
  keeps running after a move.
- **Split grip** semantics change (item 3); the saved `split` size still applies when the pair is adjacent.
- **Tab trap** (`trapTab`) reads the DOM order, so tabbing follows the new layout; check it with a moved section.

## Not in this step

Dragging into the centre column, a per-mode layout, touch-drag polish, a timeline that folds to its transport row, and dock-aware
default layouts for narrow windows.

## Order of work

1 (spec and test) → 4 (dock-ui change and tests) → 2 and 3 (markup and CSS, no behaviour change yet: the dock mounts with the default
layout and the studio must look and test exactly as before) → 5 and 6 (wiring, reset, narrow) → 7 (studio tests). Each step leaves
`npm test` green.

## Added later: a second left column and folding

Three zones in screen order: `left`, `left2`, `right`. `left2` starts empty and only exists while it holds a shown section; during a drag an
empty one shows as a 56 px dashed strip to drop in (`dock-ui` sets `data-dock-drag` on every zone while a drag runs). The left area is as
wide as its columns together (`--as-left` = column width x 1 or 2). The Parameters/Parts split grip goes in the first left column that has
the pair.

The side columns fold: dragging a column's grip to under 60% of its minimum width (`dragColumn`), double-clicking it or Enter on it folds the
column into a 24 px rail; the rail's button, or dragging the grip back out, restores it. The right column got a grip and a width of its own
(`size.right`); folds are kept in `StudioLayout.collapsed`. A folded column is not a drop target; narrow windows ignore both features.
