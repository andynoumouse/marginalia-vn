# Curve editor for parameter tracks

Status: steps 1 and 2 (engine, edit functions, docs) are built; the editor UI is not. Part of the [parameter-driven animation studio](animation-studio-parameters.md).

## What exists

An animation keys a parameter in a `params` track: `[{ "t", "v", "ease" }]` (`ParamKey` in `engine/src/anim.ts`). Between two keys the
value is `lerp(prev.v, key.v, easing(key.ease)(u))`, where `u` is the progress inside the segment and the ease is the one of the key being
reached. The ease is a name (`linear`, `in`, `out`, `inout`, `back`, `bounce`, `elastic`). The timeline draws each track as a lane with the
sampled curve and the key diamonds (`editor/anim-ptracks.ts`, `sampleTrack`); a key is moved by dragging, and its ease is a select in the key panel.

What is missing: seeing the shape of one segment, and shaping it freely (a slow start, a small overshoot, a settle) instead of picking the nearest name.

## The format: one cubic Bezier per segment

A key may carry `bezier: [x1, y1, x2, y2]`, the control points of a CSS-style `cubic-bezier` that eases the segment *ending at that key*.
The curve runs from (0, 0) to (1, 1) in the segment's own unit square, so moving or retiming a key keeps the shape. `x1` and `x2` stay in 0-1
(time must not run backwards); `y1` and `y2` may leave 0-1, which is an overshoot or an anticipation. `bezier` wins over `ease` when both are
present. Presets stay as they are; the editor starts a drag from the preset's closest Bezier (`out` is about `[0, 0, 0.58, 1]`) and the
named ones that are not Beziers (`bounce`, `elastic`) are replaced the first time a handle is touched.

Why this and not free tangent handles per key (Blender): a segment is independent, so there is no broken or smooth tangent state to
explain, the result is always a function of time, and the data stays small. The cost is that two segments meeting at a key need not join smoothly;
a "match the neighbour" button can cover it later if wanted.

## Build order (each a small session)

1. **Engine.** `bezierEase(x1, y1, x2, y2)` in `engine/src/anim.ts` (solve `x(s) = u` with Newton steps and a bisection fallback, return `y(s)`);
   `ParamKey.bezier`; `trackAt` uses it; the `params` check in `engine/src/rig.ts` rejects a bad length, non-numbers and `x` outside 0-1; `sampleTrack`
   needs no change. Tests: endpoints exact, the preset-like curves match their names within a tolerance, an overshoot leaves the key's range,
   `checkRig` messages. The game shell and the studio share `trackAt`, so both follow.
2. **Edit functions.** `setParamKey` takes a `bezier` patch (an undefined one removes it, like `ease`); a `presetBezier(name)` helper;
   `docs/rig-json.md` documents the field.
3. **Segment editor in the key panel.** Selecting a parameter key (the panel next to the timeline, where the ease select is now) shows a
   square plot of the segment into that key: the curve, the two handles as draggable dots, the preset select next to it, and a reset. Each drag is one undo step;
   the lane redraws live through the existing `sampleTrack`. Icon buttons, no text, in line with the rest of the Model/Animate panels.
4. **Taller lanes (optional, only if the segment editor is not enough).** A lane can expand to a graph height with a value axis, so keys can be dragged by
   value with a visible scale and the whole track's shape is readable. Zoom and pan for the timeline is its own open item in the TODO and should come first or together.
5. **Tests and docs.** A browser test that drags a handle and checks the track's JSON; update the Animate section of `docs/rig-json.md` and delete the TODO item.

## Open points

- Whether key panel or the lane itself is the better home for step 3; the key panel is cheaper and keeps the lanes as they are.
- Whether the keyform `ease` on slider keys (the Model side, linear by default) should get the same editor later. It would reuse step 1 unchanged.
- Script tweens (`animate robo look_x=0.5 ease=...`) keep the named eases; a Bezier there is not planned.
