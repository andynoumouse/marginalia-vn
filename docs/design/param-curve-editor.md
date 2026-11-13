# Curve editor for eases

Status: built (2026-11-11): `editor/curve-dialog.ts`, the helpers `bezierSpec`, `curveStart` and `moveHandle` in `engine/src/anim.ts`. It
uses a native `<dialog>`, as `editor/ask.ts` does, rather than the modal frame: the prompt it replaces was one, and it works over the studio. UX round 3 finding AN-11
([ux-test-2026-11-studio-3/an.md](ux-test-2026-11-studio-3/an.md)): "`curve…` is a text prompt with no curve to drag".

## What exists

- **The format.** Every `ease` in rig.json, and `ease=` in a script, takes a name (`linear`, `in`, `out`, `inout`, `back`,
  `bounce`, `elastic`) or `bezier(x1,y1,x2,y2)`, the control points of a CSS `cubic-bezier` from (0, 0) to (1, 1). `x1` and `x2`
  stay in 0-1 (time does not run backwards); `y1` and `y2` may leave it (an overshoot, an anticipation). `parseBezierSpec`,
  `isEaseSpec`, `easeProblem` and `presetBezier(name)` (the Bezier nearest a named ease; none for `bounce` and `elastic`) are in
  `engine/src/anim.ts`.
- **One way in.** Every ease select in the studio ends with a "curve…" entry, and every one goes through `pickEase(select)` in
  `editor/anim-dom.ts`: a timeline key's ease, a parameter key's ease, a pose key's ease (Keyforms), a parameter's default ease
  (the Parameter section) and a reaction's ease. Before this change `pickEase` asked for the text in `promptAsk`, starting from the current
  curve or `bezier(0.25,0.1,0.25,1)`, and asks again with the reason when the text is not valid.
- The lane draws the result (the curve between the keys), so a typed curve can be seen, but only after it is typed.

(An earlier version of this plan stored a separate `bezier: [x1, y1, x2, y2]` field on parameter keys only. The `bezier(...)` ease
string replaced it and covers every kind of key, so this plan builds only the editor.)

## The change: a curve dialog in place of the prompt

`pickEase` opens a small dialog of its own (`editor/curve-dialog.ts`, a native `<dialog>` (see Status), so Tab stays
inside, Esc cancels and the focus goes back to the select). It returns the same thing the prompt returns: a `bezier(...)` spec, or
null when cancelled. None of the five callers changes.

What the dialog shows, left to right in one row:

1. **The graph.** An SVG square for the unit square, with room above and below for an overshoot (y from -0.5 to 1.5; the square
   itself drawn plainer than the margin). The curve, the two control points as round handles, and a line from each end to its
   handle. Time runs left to right, the value up.
2. **The presets.** A row of small icon buttons, one per named ease that has a Bezier (`linear`, `in`, `out`, `inout`, `back`),
   each drawing its own curve; a click puts that curve in the graph. `bounce` and `elastic` are not there (no Bezier makes them);
   the select keeps them.
3. **The numbers.** The four values as number fields (two decimals), for a curve copied from elsewhere or a value to type exactly.
   A typed value moves its handle, a dragged handle updates the fields. `x` is clamped to 0-1 as it is typed or dragged; `y` is
   clamped to -0.5..1.5, the graph's room.
4. **A preview.** A dot that runs along a line over and over with the curve's timing (1 s), so the feel of the curve shows, not
   only its shape. With Reduce motion it does not run.

Buttons: **Use curve** (Enter) and **Cancel** (Esc). The dialog starts from the select's current value: its Bezier when it is
one, `presetBezier(name)` for a named ease, `inout`'s for `bounce`, `elastic` or nothing.

The handles take the keyboard too: Tab to a handle, arrows move it by 0.01 (Shift: 0.1). Nothing else changes in the studio: the
dialog's result goes into the key as the prompt's did, one undo step.

## Why a dialog and not a graph in the key panel

The five places that take an ease are in four different panels; one dialog serves them all with one piece of code, and a panel
does not grow by a 200 px graph that is needed now and then. A graph that stays open beside the timeline (After Effects' speed
graph) is a bigger change: it would need the timeline's zoom and pan first (an open item in TODO.md) and a choice between per-key
and per-lane editing. If the dialog proves too slow to reach, that is the next step.

## Build order (one session)

1. **Engine:** `bezierSpec(b)` writes `[x1, y1, x2, y2]` back as `bezier(…)` with at most three decimals and no spaces (the
   counterpart of `parseBezierSpec`), with a test that the two round-trip. Nothing else in the engine changes.
2. **Editor:** `editor/curve-dialog.ts` (graph, handles, presets, fields, preview), `pickEase` calls it instead of `promptAsk`.
   Pure parts (handle position to control point and back, clamping) go in the engine with tests, as the studio's other maths do.
3. **Tests and docs:** a browser test that opens "curve…" on a timeline key, drags a handle, checks the fields and the key's
   `ease` after Use curve, and that Cancel leaves it; the Animate section of `docs/rig-json.md` says how the dialog works.
   Delete AN-11 from TODO.md.

## Open points

- Two segments meeting at a key need not join smoothly; a "match the neighbour" button is possible later.
- Script tweens keep taking the text (`ease=bezier(...)`); the script editor's completion already offers one.
