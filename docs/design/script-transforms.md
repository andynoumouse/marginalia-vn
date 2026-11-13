# Script transforms: named staging sequences (proposal)

> Built, except two parts left out on purpose (see "Not built" at the end). Phase 0 (images as animation targets), phase 1 (sequences), phase 2 (`parallel:`,
> `if` / `elif` / `else`, `pick:` / `choice:`, parameters and expressions; the last three are worked out when `animate` runs)
> and phase 3 (`every` / `while`, attached with `animate <target> <name> auto`) are in. Where the built syntax differs from
> the sketches below (values are relative offsets, so no `move to`), `docs/commands.md` is authoritative; the sketches also predate [time units](time-units.md), so their bare numbers are durations
> that now carry a unit (`0.4s`). Closes the largest gap in [From Ren'Py](../tutorial/deeper/f-from-renpy.md): a writer cannot compose
> their own motion in the script. Revisits the "ATL is not planned" note in [screen-animation.md](screen-animation.md).

## The gap today

A writer can do one motion at a time (`move`, `shake`, `hop`, `camera`, `image move`) or play a *named* animation
(`animate <char> <name>`), but the names come only from the nine presets or from a layered character's `rig.json`. So:

- A sequence ("slide in, pause, shiver, settle") is several script lines, each blocking, with no way to run them in
  parallel or to reuse them under one name. Writers copy-paste.
- A bespoke or looping motion (a lantern swaying, a character pacing) needs a rig animation, so an artist and the
  animation studio, even for a flat sprite or an `image`.
- `move` tweens to a target and stops; there is no `repeat`, no "back and forth", no random choice.
- Nothing is parameterised: `shake` has `strength=`, a writer's own sequence cannot.

What writers use ATL for is mostly this, not per-frame math. The proposal covers that and nothing more.

## Why this is not "a second animation system"

The objection in screen-animation.md is fair for a full transform language. This proposal adds **no new animation
engine**. A script transform *compiles to the keyframe animation the rig already plays* (`dur`, `keys` with `t`, `ease`
and the channels `x`, `y`, `scale`, `rot`, `alpha`), so it runs through the same `makeFx`, the same ease names, the same
save and rollback handling and the same reduce-motion rule. The writer-facing difference is only where it is defined:
the script, not `rig.json`.

It also reuses what the character-animation work already settled:

| Existing piece | Reused for |
| --- | --- |
| `animate <char> <name> [seconds] [loop] [strength=] [nowait]`, `animate <char> stop` | The only way to *play* a transform. No new verb. |
| Ease names of `move` (`linear in out inout back bounce elastic`) | Per-step `ease=`. |
| `pose=` / parameter tweens (`animate robo pose=sad over 0.5`) | A step may set a pose on a layered character. |
| The expression language (`parseExpr`/`evalExpr`) | `if` and `while` inside a transform. |
| `auto` (`every` / `while`) and `reactions` | Phase 3: a transform can run by itself under a condition. |
| `behaviors off`, reduce motion | Apply unchanged. |

## Proposed syntax

A top-level definition, like `define` and `label`. Every script compiles together, so names are global.

```
transform nervous(strength=1):
    rot=-2 0.15
    rot=2 0.3 ease=inout
    rot=0 0.15

transform enter_left:
    alpha=0 x=-0.1                      # instant start state
    parallel:
        move to left 0.6 ease=out       # same grammar as `move`, minus the character
        alpha=1 0.4

transform pace:
    move to 0.3 1.2
    wait 0.4
    move to 0.7 1.2
    wait 0.4
    repeat                              # `repeat` alone loops forever, `repeat 3` three times

transform fidget:
    pick:                               # one branch at random each time round
        hop 0.25
        nod 0.5
        wait 1.5
```

Playing one:

```
show alice smile at left
animate alice enter_left                # plays once, script waits (as any animate)
animate alice nervous 1.0 strength=1.5  # seconds rescales the whole sequence, strength= the amplitude
animate alice pace loop nowait
animate alice stop
image show lantern prop/lantern at 400,300
animate lantern sway loop               # works on `image` names too
```

### Step grammar

Each line is one of, and nothing else:

- **A tween**: the `move` fields without the character (`to`, `y=`, `scale=`, `rot=`, `alpha=`, `anchor=`, seconds,
  `ease=`). Changes are *relative to where the character stands* when the transform starts (`animate` already adds to
  `move`/`show at`), so one transform works for any character and any position.
- **`wait <seconds>`**.
- **A preset by name** (`hop`, `shake`, `nod`, ...) with seconds and `strength=`; a transform may call another
  transform (recursion is an error).
- **`pose=<name>[,<name>] [over <s>] [ease=]`** for a layered character.
- **`parallel:`** with indented branches that start together; it ends when the longest ends.
- **`repeat [n]`** as the last line of a block; `pick:` for a random branch; `if <expr>:` / `else:` using script variables.

No per-frame math, no `function`, no events (`on show`, `on hide`), no arbitrary properties: these are the parts of ATL
that are really programming, and are what the Ren'Py page keeps pointing people to Python for.

## Compilation

At compile time a transform is flattened to the rig's animation shape: sequential steps accumulate time, `parallel`
branches merge their channel keys, `repeat n` unrolls (or sets `loop` when unbounded), `strength` multiplies amplitudes.
`pick` and `if` cannot be flattened, so a transform that uses them is kept as a small tree and resolved each time it
starts (condition evaluated, branch chosen with the same injected `rand` the auto scheduler uses, so tests are
deterministic).

Lookup order for `animate <target> <name>`: the character's own `rig.json` animation, then a script transform, then a
preset. A script transform that shadows a preset name is a warning. A script transform of the same name as a rig animation
loses to the rig, with an editor warning, so an artist's animation is never silently replaced.

## Editor support

- Completions: `transform` names after `animate`; the step keywords inside a block; parameters of the transform.
- Checks: unknown step or argument (the existing "refuse what we don't know" rule), unknown name in `animate`, recursion,
  `parallel:` or `pick:` with no body, a transform that does nothing, `repeat` not last, an infinite loop with no `wait`
  or tween in it (would spin).
- F1 help from a new `### transform` heading in `docs/commands.md`.
- Preview from cursor already plays whatever line is under the cursor.

## Phasing

0. **Images as animation targets.** Useful on its own, and a prerequisite for `image`s in phase 1. Today `makeFx` is tied
   to characters: it looks the animation up in `files.rigs[char]`, pushes it on an `Actor`'s `fx` list and applies it with
   `poseBody` (`a.body.position/scale/angle/alpha`). An `image show` picture is a bare sprite in `PictureLayer` that
   `worldImage` tweens directly, with no `fx` list, no per-frame stepping and nothing saved for a running loop. So:
   - Separate *what an animation is* (time to an offset: `dx`, `dy`, `sx`, `sy`, `rot`, `opacity`; `resolveAnim` already
     returns this) from *what it is applied to*. Characters keep `poseBody`.
   - Give each picture an `fx` list, stepped in the same per-frame loop and applied as an offset on top of the sprite's
     base position, scale, rotation and alpha (the values `image move` sets), so `animate` and `image move` combine as
     they do for characters.
   - Pictures take only the body-level channels. `part=`, `params`, `frames` and physics are rig concepts; `animate`
     on a picture with one of them is an editor error.
   - Keep a running loop in the image's saved state (like a character's `anim`), so rollback and loading restore it.
     This is the largest part of the work. `scene` drops it with the picture unless the picture was shown with `keep`.
   - Result: `animate lantern sway loop` with the existing presets, before any `transform` syntax exists.
1. **Sequences.** `transform` blocks of tweens, `wait`, presets, `repeat`; played with `animate`; characters and `image`s.
   Covers the nervous / pace / enter-and-settle cases, which is most of what writers copy-paste today.
2. **Structure.** `parallel:`, `pick:`, `if:`, parameters, calling other transforms.
3. **Behaviours.** Run a transform by itself under a condition, sharing the `auto` scheduler:
   `transform fidget every 4s..9s while affection > 3:`, started with `animate alice fidget auto` (or declared once on the
   character). This is where the layered-character conditions meet script staging.
4. **Maybe, only on demand:** transforms inside `screen:` blocks (`on enter alice_pop`), which would replace the
   `uianims` idea in screen-animation.md with the same mechanism.

## Layered images, the smaller gap (separate, not part of this change)

`show` already stacks looks left to right, keeps the current looks when none is given, and takes `slot=variant`, so
"same look, now blushing" is `show mina blush`. What Ren'Py has beyond that is `if_all` / `if_any` (a layer that depends on
another attribute), and `always` defaults. The `reactions` mechanism covers the *dynamic* version (variable-driven poses).
A static "this variant hides that slot" rule belongs in `rig.json` `looks`, with the art pipeline, and is a separate item.

## Files touched (per the new-command checklist)

`parser.ts` (block + step grammar), `types.ts`, a new pure `engine/src/transform.ts` (flatten, resolve, with
`engine/test/transform.test.mjs`), `runtime.ts` (resolve the name in `animate`), `compile.ts` (names are global; check
targets), `editor-support.ts`, `docs/commands.md` and the README syntax block, `docs/tutorial/deeper/f-from-renpy.md`
(move ATL from "no equivalent" to "partial"), `TODO.md`. The renderer should need nothing if the output is the rig
animation shape for characters. Images need phase 0 first: `preview/pixi-renderer.ts` (`makeFx`, `playFx`, `worldImage`),
`preview/picture-layer.ts` (an `fx` list per picture), the image entry of `DisplayState` (the saved loop), and the runtime
that routes `animate <name>` to a character or an image, plus tests for save, rollback and `scene` handling.

## Open questions

1. **Relative or absolute.** Relative (above) makes transforms reusable but cannot say "go to the left edge"; `move to`
   inside a transform would then be absolute for that channel. Is the mix confusing? *Decided: relative only, no `move to`.*
2. **`seconds` on `animate`.** Rescaling a whole sequence is handy, but with `wait`s and `pick` inside it is ambiguous.
   Maybe only `strength=` and a `speed=` multiplier. *Decided: the seconds stretch the whole sequence, waits too.*
3. **Files.** All in `script/*.vn`, or also a `transforms.vn` convention. Probably the first. *Decided: any script.*
4. **Screens.** Whether phase 4 is wanted, or presets stay enough there.
5. **Flat characters.** Confirm they take whole-body animations the same way a rig does. *Decided: they do.*
6. **Name clashes** (decided). `animate <name>` targets a character or an image, so a name used by both is a
   compile-time error rather than a precedence rule: either winner would silently animate the wrong thing, and
   tightening a rule later breaks existing games while relaxing an error does not.
   - The editor reports it once, at the later definition, naming the earlier one ("`lantern` is also a character"),
     not on every `animate` line.
   - Only an image name that some `image show` actually uses counts.
   - No qualifier syntax (`animate image:lantern`): the fix is to rename one of the two.
   - Verify while implementing that `image show` names are resolved statically. If some can come from a variable or a
     `call`, the check is incomplete: add a runtime warning naming both and let the character win.

## Not built

Two parts of the sketch above were left out on purpose.

- **`pose=` as a step.** Poses are absolute snapshots of rig parameters, while every other step is relative to where the
  sprite stands. A rig animation's parameter tracks start at their first key, so a pose step would snap in instead of easing
  from the current value (which the engine does not know when it works the animation out), and the parameters go back to the
  script's values when the animation ends, unlike `animate <char> pose=<name> over <s>`, which keeps the pose. Use that line
  before or after the transform.
- **Automatic transforms with parameters, `if` or `pick`.** Those are worked out once, when `animate` runs, from the variables
  and random numbers then. An automatic transform restarts by itself, so each restart would need the story's variables and
  random numbers in the renderer, and the arguments would need a saved field. A `while` condition on a plain automatic
  transform already reads the variables live, and two transforms with different `while` conditions give the branching.
