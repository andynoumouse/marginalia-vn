# Animated screen elements

Status: proposed 2026-11-04; phases 1 and 2 (`on enter`, `loop`, `on exit`) built. Screens are a DOM layer over the stage, so this is CSS animation driven by new
clauses on an element line. It is separate from the character `animate` command, which moves Pixi sprites.

## Today

- Screen elements have a hover look (`hover tint`, `hover scale`, `hover` image) and nothing else. `hover scale` is a CSS
  transition (`#screenui [data-scale]`, 0.12 s).
- A whole screen fades in over 0.22 s (`screen-in` in `preview/index.html`). Elements inside it do not animate.
- `ScreenLayer` redraws the screen with `replaceChildren` whenever a live screen's view changes (a local `state` flips, a
  HUD variable changes). The DOM is rebuilt from scratch each time.
- Reduce motion is `#stage[data-reduce-motion="true"]`, and the existing screen CSS already switches its animations off there.

The redraw is the main constraint. A CSS animation on a freshly built element plays at once, so a naive entry effect would
replay on every redraw (every tab click, every HUD variable change). Entry has to be remembered across redraws, and an
element that disappears is already gone from the DOM before it could animate out.

## Syntax

Three clauses, valid on any element line, written with the other clauses:

```
on enter <effect> [seconds] [delay seconds] [stagger seconds] [distance=80]
on exit  <effect> [seconds] [delay seconds] [distance=80] [cascade]
loop <effect> [seconds] [strength=1]
```

`distance=` (stage pixels, `slide` only) is a keyword like `strength=` so it cannot be mistaken for the seconds, as in
`on enter slide left 0.4 distance=200`. `cascade` (`on exit` on a container only) is described under Behaviour.

`on enter` and `on exit` sit beside the existing `on click|focus|blur` events. `on` is already a clause-start word, so the
parser needs no new one: it looks at the word after `on`. Unlike `click`, `focus` and `blur`, these two take an effect and
not a label or a `set`. `loop` is a standing state, not an event, so it is not under `on`.

```
screen journal:
    panel at 400,200 size 1120,680 image "ui/frame.png" slice 40 on enter fade 0.3 on exit fade 0.2
        text at 40,40 "Journal" on enter slide down 0.4 delay 0.1
        each notes as n at 40,120 step 0,64 on enter slide right 0.25 stagger 0.06:
            text at 0,0 "[n]"
    button close at 1500,60 "Close" on enter pop 0.2 delay 0.4
    image "ui/new.png" at 1700,90 loop pulse 1.2
```

### Effects for `on enter` and `on exit`

| effect | on enter | on exit | default |
| --- | --- | --- | --- |
| `fade` | opacity 0 to 1 | opacity 1 to 0 | 0.3 s |
| `slide <left\|right\|up\|down>` | comes in from that side by `distance` and fades | leaves toward that side and fades | 0.35 s, 80 px of stage unless `distance=` says otherwise |
| `pop` | scales up from 0.8 with a small overshoot, fading in | scales down to 0.8, fading out | 0.25 s |
| `zoom` | scales down from 1.2 while fading in | scales up to 1.2 while fading out | 0.4 s |

`delay` holds the element invisible first (on exit: keeps it fully shown first). `stagger` is for an element that repeats
(`each`): entry *i* is delayed by *i* times the stagger, so a list cascades in. Without `each`, `stagger` is an error, and
it is not offered on `on exit`.

### `loop` effects

Reuse the character animation names so one vocabulary covers both: `pulse` (grows and shrinks), `bob` (lifts and settles),
`sway` (tilts), `breathe`, `shiver`, plus `glow` (opacity and a soft brightness swell, for a "new" marker). The seconds are
one cycle, with the same defaults as `animate`.

## Phases

1. **`on enter` and `loop`.** Needs only the entered-keys set and CSS. Ships on its own.
2. **`on exit`.** Needs ghost elements (below). Built after phase 1 works.
3. Later, if wanted: animating a change (a tab switch cross-fading, a bar easing to a new value, an element moving when a
   list reorders), custom keyframes (a `uianims` map in `game.json`, like a character's `rig.json` animations), and a
   screen-wide `on enter` that staggers every top-level element. Ren'Py-style ATL (`linear 1.0 xpos 100`, `parallel`,
   `choice`) is not planned: the presets cover what screens need, and a transform language is a second animation system.

## Behaviour

- **Visual only.** Animations are never saved, recorded in `choices`, or waited for by the script. A click during an entry
  animation works at once, and keyboard focus is not delayed.
- **`on enter` plays once per appearance.** `ScreenLayer` keeps a set of keys for the elements it has already shown, cleared
  when a screen opens or closes. The key is the element's path in the screen plus its `each` index, which is stable across
  redraws. `draw()` adds `data-enter` only for keys not in the set. A `HudLayer` entry is the same: `hud off` then
  `hud on` replays it, a variable change does not. An element hidden by `if` and shown again counts as a new appearance and
  replays.
- **`on exit` uses ghosts.** When a redraw drops a key that has an `on exit`, the layer keeps a clone of that element's old
  DOM at its old place, marked inert (`pointer-events: none`, out of the focus order, `aria-hidden`), plays the exit, and
  removes it on `animationend`. Ghosts are cleared at once when the screen closes with Reduce motion on, and when a new
  screen opens over the old one.
- **A blocking screen's exit does not delay the answer.** The screen resolves on the click as today and the next line
  starts. Its ghosts fade out over the story, so the exit is cosmetic and the game stays responsive. A screen that closes
  runs the `on exit` of its elements (the game does not wait for them); a screen without any just disappears as before.
- **Loops stay in phase across redraws.** A rebuilt element would restart its loop. `draw()` gives it a negative
  `animation-delay` of `now mod cycle`, from one clock per layer, so a redraw does not make a glow jump.
- **Reduce motion, skipping and auto mode.** With Reduce motion on, `on enter` shows the element at once, `on exit` removes
  it at once and `loop` does not run, the same as `animate`. No other mode changes it.
- **No clash with hover.** Hover scale uses `transform`. The new animations use the individual `translate`, `scale` and
  `opacity` properties (the page already uses `translate`), so the two compose. `animation-fill-mode: backwards` keeps a
  delayed element hidden until it starts without holding any state afterwards.
- **Hit areas do not move.** Mask hotspots and the HUD pointer test use stage coordinates, and polygons are an SVG layer.
  So on a `hotspot` only `fade` and `loop glow` are allowed; a slide, pop or zoom on one is a syntax error, worded like the
  existing "hover tint goes on a hotspot or button" messages. A `button` can use any effect (its hit area is the element).
- **A container hands its clauses to its elements.** Screens are resolved into a flat list of positioned parts (`each`, `row`,
  `column`, `grid` and a `panel`'s children are placed by the engine, so there is no DOM element for the container to
  animate). So `on enter` and `loop` on a container apply to every part it holds, including the panel's own frame; a child's
  own clause replaces the container's for that effect. `stagger` on an `each` delays entry *i* by *i* times it, for every part
  of that entry. A part's key is its source line plus the `each` entries it sits in, so a list that gains an entry does not
  replay the others. A hotspot inside an animated container keeps only what a hotspot may use (`fade`, `glow`).
  For `on exit` (phase 2) this means the ghost is a clone of each part that went away, not of a container; `cascade` then
  has no separate meaning (every part of a container runs its own exit, and the container's `delay`s order them), so it
  can be dropped from the plan unless a use for it turns up.
- **Built-in screens.** The clauses are parsed on every screen, so a project's `screen title` can use them. The built-in
  CSS-drawn screens (the options and saves defaults) are left alone.

## Parsing and view

- `screen-syntax.ts`: parse `on enter`, `on exit` and `loop` into an `ElementAnim`
  (`{ enter?: {fx, dur, delay, stagger, dir}, exit?: {fx, dur, delay, dir}, loop?: {fx, dur, strength} }`); `loop` joins the
  clause-start list, and the `on` clause learns two more events beside `click|focus|blur`. Reject unknown effects with a
  message listing the names, `stagger` outside an `each` line, a displacing effect on a hotspot, numbers that are not positive, `distance=`
  on anything but `slide`, `cascade` outside an `on exit` on a container, and the same event given twice. `on enter` / `on exit` do not take the `set` form that `on click` does.
- `screens.ts`: add `anim?: ElementAnim` to the node types and carry it into the view items. Seconds are numbers, not
  expressions in v1.
- `preview/screen-ui.ts`: the entered-key set, the `data-enter` / `data-loop` attributes and the `--dur`, `--delay`, `--dist`
  custom properties on the element; for phase 2 the ghost list.
- `preview/index.html`: one `@keyframes` per effect and direction, a rule per `data-enter` / `data-exit` value, and the
  reduce-motion override.
- `editor-support.ts`: completions for the clause words and effect names. `docs/commands.md`: a section under the screen
  elements. `TODO.md`: tick the item.

## Tests

- `engine/test`: parsing (each effect, defaults, `delay`, `stagger` inside and outside `each`, a bad effect, a slide on a
  hotspot, a repeated event, the clauses on a continuation line, `on click` still parsing beside them) and the view
  carrying `anim`.
- Browser: an `on enter` element has `data-enter` on first draw and not after a redraw caused by a `state` change; a `loop`
  element keeps the same phase across a redraw; Reduce motion removes both. Phase 2 adds: a dropped element leaves an inert
  ghost that is gone after `animationend`, and a ghost cannot be clicked or focused. This changes `preview/`, so it goes
  through `scripts/browser-gate.mjs` like any renderer change.

## Open questions

Decided:

- `slide` takes `distance=<px>`; the default is 80.
- A container's `on exit` plays only its own effect unless `cascade` is given.
- A screen shown over another is drawn on top of the old one's ghosts, with no coordination between them. The two overlap
  for the length of the shorter effect, which is fine for short effects; a full-screen backdrop with a long exit is the
  case to look at once it is built.
- `cascade` has no stagger of its own: children leave one after another by giving each its `delay`. A stagger can be added
  later without changing what is written now.

Open: nothing.
