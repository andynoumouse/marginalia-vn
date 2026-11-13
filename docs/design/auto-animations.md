# Automatic animations (`auto`) and poses held by conditions (`reactions`)

> Built. The studio's Reactions list and Test variables sit in the **Reactions** tab of Model mode's rig strip, beside Physics. A parameter counts as set by the script when it is away from its default, which is how a reaction's pose sits under the script's value. `param.<id>` parses as a dotted name in `expr.ts`; an `every` wait counts from the end of a run; stored dock layouts drop a section id they do not know.

Goal: blinking, talking and idling stop being three special mechanisms. An animation says when it runs on its own; the
engine has one scheduler for that. Everything the clip can do (frame tracks, parameter tracks, bone and part keys) is then
available to a behaviour, and the studio edits behaviours where it edits animations. Conditions are expressions over the
script's variables, so a character can also react to the story: an animation that runs while a condition holds, or a pose
it holds (`reactions`), which is a separate, state-based mechanism sharing the same condition language.

## The format

An animation may carry `auto`, which says when it starts by itself. Exactly one of two forms:

```json
"animations": {
  "blink":   { "dur": 0.12, "keys": [], "frames": [{ "slot": "eyes", "keys": [{ "t": 0, "frame": "closed" }] }],
               "auto": { "every": { "min": 3, "max": 6 } } },
  "talk":    { "dur": 0.25, "keys": [], "frames": [{ "slot": "mouth", "frames": ["open", "neutral"], "fps": 8 }],
               "auto": { "while": "speaking" } },
  "breathe": { "dur": 3, "keys": [ ... ], "auto": { "while": "always" } }
}
```

- `every: { "min": m, "max": M }` (seconds, `0 < m <= M`): the animation plays once, waits a random time between `min` and
  `max` after it ends, and plays again. A plain number (`"every": 5`) is a fixed wait. (Ren'Py has no such timer: its blink
  idiom is a looping image with `choice` branches that pick a pause, so named bounds are clearer than a `[min, max]` pair.) The first wait is also random, so characters do not blink in step.
- `while`: a condition (see Conditions). The animation loops for as long as it holds. With `every` as well, the timer only
  runs while the condition holds (`{ "every": { "min": 4, "max": 9 }, "while": "affection > 3" }`: a fidget now and then, only when fond).
- `autonomous` (all of it: `idle`, `speak`, `blink`) is removed. A character that wants an idle writes its own animation
  with `"auto": { "while": "always" }`; presets cannot be automatic (they have no definition to hold `auto`), copy one into
  `animations` if needed.
### Conditions

A condition is a **string in the script's own expression language** (`parseExpr` / `evalExpr`, engine/src/expr.ts, pure and
already used by `if`), so a writer has one syntax. It sees:

- the script's variables, by name (`affection >= 5 and not angry`);
- `speaking`: true while one of this character's lines is typing (false when the line is complete or skipped);
- `always`: true (a readable name for "no condition");
- `param.<id>`: a rig parameter's **base value**, the one the script or the player set, before any animation's tracks or the
  reactive poses below. A clip that writes a parameter therefore cannot switch itself off and on.

It is parsed when the rig loads (`checkRig` reports a syntax error and a name that is neither a script variable nor one of
the built-ins; the variable list comes from the project, as the editor's completions already know it; `checkRig` takes it, but the
editor does not pass it yet, see TODO.md) and evaluated each
step against the current variables. A condition is a function of the state, so a save or a load needs nothing stored:
the character is simply in the right state again.

### Reactions: a condition that holds a pose

Some conditions want a *state*, not a clip: "while affection is high the character looks happy". A pose already is that
(`poses` in rig.json: a named snapshot of some parameters, used by `show ... pose=` and `animate ... pose=<name> over <s>
ease=<e>`), and the script already tweens to one. A **reaction** binds a condition to a pose in the same file:

```json
"reactions": [
  { "when": "affection >= 5", "pose": "happy", "over": 0.6, "ease": "out" },
  { "when": "affection < 0",  "pose": "sad",   "over": 1 }
]
```

- The list is ordered like `if` / `elif`: the first entry whose `when` holds is the target. None holds: the parameters it
  touched go back to what the script set (or the defaults) over the `over` of the entry that just stopped holding.
- `over` (seconds, default 0.4) and `ease` are the entry's transition into its pose, using the same `lerpParams` and ease
  names as the script's `animate ... pose=`; a `bezier` can come later as it did for parameter keys. Nothing new is
  interpolated by hand.
- It is a different system from animations on purpose: an animation *plays* (a clip on a clock, loops, frame tracks), a
  reaction *holds a target* and only the move into it is timed. A reaction never has `auto`, an `auto` animation never names a
  pose; the two share only the condition language and the scheduler's inputs.
- Layer order for a parameter, bottom to top: its default, the reaction's pose, the script's value, an animation's track, the
  bone keys on top (the existing order plus one layer under the script, so an explicit `animate robo pose=...` wins).
- Reactions are edited in the studio's Model mode (a **Reactions** tab of the rig strip, beside Physics: condition, pose, over, ease).

### Rules

- **Priority.** When two running animations drive the same slot, the later one in the file wins. An explicit `slot=variant`
  in the script beats an automatic frame track (what `blink` does today); a script `animate` is not special-cased and plays
  as it always did. `checkRig` warns about two `auto` animations with a frame track on the same slot.
- **`behaviors off`** suspends every automatic animation (stops the running ones, holds the timers); `behaviors on`
  re-rolls the `every` waits. Exports run with `behaviors: false`, as now.
- **Reduce motion** keeps an automatic animation running only when it has frame tracks and nothing else (no `keys`, no `params`):
  blinking and the mouth carry on, motion does not. This replaces the per-trigger special cases.
- **Preloading.** The variants of every automatic animation's frame tracks load with the character (`framesNeeded`), so a
  blink never shows an empty part. This is the one new asset-loading path.
- **Unknown or invalid `auto`**: `checkRig` rejects both forms given, neither, a bad `every`, a `while` that does not
  parse or names an unknown variable, and unknown fields. An automatic animation with `dur` 0 or a frame-less, key-less body is a warning
  (it does nothing).

## Engine

New `engine/src/auto-anim.ts`, pure, with a test file:

- `autoAnimations(animations)`: the `{ name, auto }` entries of a rig, in file order.
- `AutoState`: per animation, a wait (for `every`) or a running flag. `startAuto(entries, rand)` gives the first state;
  `stepAuto(state, entries, dt, ctx, rand)` advances `dt` seconds and returns the new state plus what to start and stop.
  `ctx` is `{ speaking, behaviors, reduceMotion, vars, params }` (`vars`: the script's variables, `params`: the character's
  base parameter values). Randomness is injected, like `blinkWait` today. A condition is parsed once into an `Expr`
  (cached by source) and run with `evalExpr`.
- `reactionTarget(reactions, ctx)` in the same file: the first reaction whose `when` holds (or null); a small stepper keeps
  the transition (`from`, `to`, elapsed, entry) and returns the pose values to lay under the script's, using `lerpParams`.
- `reduceMotionSafe(def)`: true when the animation has only frame tracks.
- `idle.ts` goes (`stepBlink`, `mouthFrame`, `startBlink`, `blinkWait`); `idle.test.mjs` is replaced by the new test.
- `rig.ts`: `AutonomousData`, `blinkOf`, `speakOf`, the `autonomous` branch of `checkRig` and `AUTONOMOUS_KEYS` go;
  `checkRig` gets the `auto` checks above and reports a present `autonomous` with a message pointing to `auto`
  (the way `groups` is reported).
- `framesNeeded` is called for the automatic animations at load (assets.ts).

## Renderer

**The renderer gets no script variables today** (pixi-renderer.ts has none), so the game shell passes the current variables
in with each step (a snapshot, not a live reference), and the studio passes none (see Studio). Then
`stepLive` shrinks to: call `stepAuto`, then `makeFx` for each start (looping for `while`, one-shot for `every`) and drop
each stop from `a.fx`; the rest (the clip owning its slot, the loaded-art check before swapping) stays. The scheduler state
lives on the actor in place of `a.idle`, `a.talk`, `a.blink`, `a.talkStart`. A script override still filters an automatic
frame track's slot.

The studio preview: automatic animations are suspended in Animate mode (the animation under edit is what you see, and its
own `auto` would fight the scrubber), and run in Model mode as the blink and the idle do now.

## Studio

- The By itself section goes. In its place, the animation header (the Animation picker row) gets an **Automatic** line:
  *Every* with a min and a max in seconds (defaults 3 and 6, or empty for no timer) and *While* with a condition field
  (empty means no condition; `always` and `speaking` are completions beside the project's variables). One undo step,
  written with the animation by Apply.
- Variables do not exist in the studio, so a condition naming one is false there unless the author sets test values: a
  small **Test variables** list in Model mode (name = value, studio-only, never saved) feeds the preview, the same way the
  Look select does for slot variants. Without it a reaction or conditional animation could not be seen while authoring.
- The **Reactions** list (condition, pose, over, ease; add, remove, reorder), built as a tab of the rig strip.
- `RigSettings`, `readRigSettings`, `speakPart`, `blinkPart`, `autonomousValue` in `anim-edit.ts` and the `autonomous` write
  in `studio-doc.ts` go; a `setAuto(def, auto | null)` takes their place (pure, with the same "one-line stays one-line"
  formatting care as the other edits).
- The animation list marks automatic animations (a small badge), so "what does this character do by itself" is a glance.
- `STUDIO_SECTIONS` loses `auto` in `studio-layout.ts`; the stored dock layouts ignore an id they do not know (check this
  in `readLayout` when doing it).
