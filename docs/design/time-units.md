# Time units: durations written with their unit, key times shown in seconds

Status: built 2026-11-10, both parts (see "Part 1, built" and "Part 2, built" at the end). Comes from UX findings ES-7 and SA-10 (key times are fractions of Length, shown as bare `t`), and the
author's wish that the script language say its unit (`animate robo wave 2s`).

## The problem

- **Scripts:** every duration is a bare number in seconds (`docs/commands.md`: "Durations are in seconds"). `tint #ffcc88 0.5 1`
  and `animate robo wave 2 loop` only read right if you already know which number is which.
- **The studio:** key times are fractions of Length and are shown that way. The key field says `t 0.6637` with no unit, the Key ▾
  lists `t=0.25`, and frame blocks read `from t=0.0833`. Meanwhile the ruler is in seconds. People coming from Spine, Live2D or
  After Effects expect seconds.

## Part 1: durations in scripts carry a unit (breaking)

- **Every duration slot requires a unit:** `2s`, `0.25s` or `250ms`; the value is stored as seconds. A bare number there is an error:
  `a duration needs its unit: write 2s (or 2000ms)`. The engine is alpha, so this is not phased in.
- **The slots:**
  - `scene`;
  - `show` and `hide` (`fade`);
  - `move`, `shake`, `hop`, `animate` (both its seconds and `over`);
  - `burst`, `flash`, `tint`, `camera`, `weather`, `wind`, `filter`;
  - `image show`, `image move` and `image hide`;
  - `music` (`fade`), `wait`;
  - transform steps;
  - choreography times (`0.6s alice: hop`);
  - the inline `{pause=0.6s}` text tag;
  - the menu `timeout`.
- **Numbers that are not durations stay bare:** strength, level, intensity, factor, count, and the like.
  `tint #ffcc88 0.5 1s` then reads as "strength 0.5, over 1 second" without the docs.
- **The menu `timeout` takes an expression.** A literal takes the unit (`timeout 8s`). An expression is wrapped and the unit put after
  it: `timeout (8 - difficulty)s`. The parser checks the unit; the expression itself stays unit-free.
- **Built:**
  - one helper in `parser.ts` (`durationArg`) used at every slot, with tests;
  - the slots' usage strings;
  - `editor-support.ts` completions and the highlighter;
  - `docs/commands.md`, the README's syntax block and the F1 help (it reads the commands doc).
- **Migration:** none for users; there are none yet. This repository's own scripts are rewritten once: the sample, the demo and the
  tutorial games (25 scripts, about 430 duration lines), the docs' examples, and the tests' script strings. A throwaway script finds
  every bare duration from the parser's error positions; it is not shipped.
- **Size:** one session for the parser, the editor and the docs; the rewrite is mechanical and can be checked by `npm test` plus the
  browser set (the sample plays through).

## Part 2: the studio shows and takes seconds

- **Storage does not change:** rig.json keys keep fractions of the animation. A script can play an animation at any length
  (`animate robo wave 2s`), so an animation is a shape over 0..1 and Length is only its default.
- **What the studio shows:** seconds wherever a time is shown or typed. That covers:
  - the key and parameter-key `t` fields, which become `at` with an `s` unit (two decimals, stepping 0.01 s; Shift-arrow 0.1 s);
  - the Key ▾ (`0.27 s · rot 135`);
  - frame blocks (`from 0.08 s`);
  - key tooltips and aria labels;
  - the hold-pose and fold-row hints.

  Conversion is `t = seconds / Length`, rounded the way `addKey` already rounds.
- **Built:** pure `timeLabel` and `toProgress` helpers in the engine with tests; the fields and labels in `anim-keys.ts`,
  `anim-ptracks.ts`, `anim-frames.ts` and `anim-timeline.ts`; the browser tests that read `t` values change with it.
- **Size:** one session.

## Changing Length asks

Decided 2026-11-10: when Length changes on an animation that has keys, the studio asks.

- **Stretch keys:** each key keeps its fraction, so it moves in seconds. This is how a script plays the animation at another length.
- **Keep key times:** each key keeps its second, and the new length adds or trims time at the end.
  - Shortening past keys says how many go ("2 keys are past 0.8 s and will be removed").
  - Parameter keys and frame keys follow the same choice.
- **Cancel:** puts the old Length back.

An animation with no keys changes without asking. Keep key times is a pure `retimeAnim(def, oldDur, newDur)` in `anim-edit.ts`, with
tests; Stretch changes only `dur`.

## Order

Part 1 first: it changes how every example in the docs is written. Then Part 2. They touch different files, so they could also run
as two sessions at the same time.

## Part 1, built

- **The rule:** `engine/src/duration.ts` holds it: `durationOf`, `readDuration` and the message. The parser, `transform.ts`,
  `screen-anim.ts` (`on enter`, `on exit`, `loop`, `delay`, `stagger`) and the `{pause=}` tag in `text.ts` use it. Tests are in
  `duration.test.mjs`, plus the changed cases in the existing tests.
- **Screens:** their animation clauses turned out to be duration slots too, so they take the unit as well. `distance=` stays in
  pixels.
- **`shake`:** `shake 0.4s` (a duration first) now shakes the screen. The tutorial had written `shake 0.4` for that, which named a
  character "0.4" and did nothing.
- **Arguments in either order:** a level and a duration can now come alone or together (`tint #ffcc88 2s` keeps the default
  strength), because the unit tells them apart.
- **The rewrite:**
  - It was done by throwaway scripts that asked the parser which numbers were durations: a candidate was kept only when it
    cleared that unit error and added no other one.
  - It covered the games, the built-in screens, the templates, the docs, and the tests' script strings.
  - The parse-command fixture was regenerated. All 255 cases compile to the same ops as before; only error texts changed.

## Part 2, built

- **The helpers:** `secondsOf`, `progressOf`, `timeLabel`, `retimeAnim` and `hasKeyTimes` in `anim-edit.ts`, with tests in
  `anim-edit.test.mjs`.
- **Fields:** the three time fields read `at (s)` and `from (s)`. The unit is in the label because the Properties rows lay out label then
  field, and a trailing `s` wrapped. Each field's `max` is the animation's length.
- **Labels:** the Key ▾ reads `0.5 s · rot 45`, and the timeline's key, rest, parameter-key and frame tooltips and aria labels give seconds.
- **Arrow keys** on a key, a parameter key or a frame block step 0.01 s (Shift 0.05 s), whatever the length.
- **Length:** a change asks with `choiceAsk` (`editor/ask.ts`, a three-button form of the editor's confirm). An animation without keys,
  or a cleared field (back to the 1 s default), does not ask. If the animation changed while the dialog was open, the answer is dropped.
- **The browser test** (the tool-row test) covers the seconds labels, Keep key times, typing seconds, Cancel, the shortening message and
  Stretch keys.
  - It used to name its new animation `icon tools`, which the name check refuses, so it had been editing the sample's `blink` in memory.
  - It now names it `icon_tools`.
