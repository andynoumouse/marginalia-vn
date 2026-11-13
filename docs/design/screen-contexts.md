# Screen elements across contexts

Status: re-evaluated 2026-11-04 (see Re-evaluation and Order below); steps 2 and 3 (local state and `inout` outputs, blocking screens) are built; step 4 is not scheduled. Written down so it can be weighed later. There is no compatibility constraint (no existing
projects), so anything below may replace current syntax.

## Problem

A screen element's behaviour depends on where the screen is shown. There are three contexts, and each has its own way of
turning a click into something:

- **Blocking `show screen`**: a click ends the screen with the element's id as the answer (recorded in `choices`).
- **HUD (`hud on`)**: a click does nothing unless the element has `on click <label>`; the runtime queues the event and runs
  the label at a safe point (just before a line, menu, input or blocking screen; dropped while a menu, input, blocking screen
  or the pause menu is open, while another event's label runs, or during a replay).
- **Reserved shell screens** (`title`, `pause`, `options`, `saves`, `history`, `gallery`, `viewer`, `music`, `chapters`,
  `achievements`, `quickmenu`, `achievement_toast`): the shell reacts to `action <name>`; each screen has its own valid actions and its own hidden
  variables (`tab`, `mode`, `page`, `slots` ...).

Availability differs by context:

| Element or feature | Blocking | HUD | Reserved shell screens |
|---|---|---|---|
| text, image, panel, bar, layouts, `each` over story lists, `if` / `enabled` | yes | yes | yes |
| `toggle`, `radio`, `tab` | yes (bound to local state or an `inout`) | no | no |
| `on click` / `on focus` / `on blur` | `set` on local state (step 2); labels ignored | yes | not used |
| `action <name>` | answers with its id; the action is ignored | yes | yes (set differs per screen) |
| `slider` | not documented | not documented | `options` only |
| `action tab` / `action cycle` | no | no | `options` only |
| `each` over shell lists | no | no | matching screen only |
| `default`, `cancel [keep]`, `textbox`, parameters, `inout` | yes | no | partly (no `inout`) |

The styling side of `hover` (image, tint, scale, sound) works everywhere; only the event handlers differ. `toggle`, `radio`
and `tab` were first added to blocking screens only, as an interim step, which made the unevenness more visible.

The cause is that a handler is a label: it may run any story code (lines, jumps, menus), so it must wait for a safe point and
be recorded. A blocking screen has no safe point, because the story is already waiting on it.

## Direction: a screen is a function

A screen owns its state. It takes inputs, keeps local state while it is up, and hands back outputs when it closes. Nothing
inside it touches the story in between.

```
screen settings(inout sound, inout mode):
  state tab = "audio"
  state tip = ""
  tab audio tab=audio at 80,60 "Audio"
  tab game  tab=game  at 400,60 "Game"
  toggle sound at 80,300 "Sound" on focus set tip = "Mutes everything" on blur set tip = ""
  radio easy mode=easy at 80,500 "Easy"
  text at 80,900 "[tip]"
  button done at 1500,900 "Done"
```

- **Parameters are the inputs.** They are the initial values of local state, so the screen opens showing the current settings.
- **`state` declares local variables.** `toggle`, `radio` and `tab` bind to local state. Binding straight to a story
  variable goes away; the only way out of a screen is its outputs.
- **`inout` parameters are the only outputs.** They copy a story variable in on entry and write it back on exit:
  `screen settings(inout sound, inout mode)`, called as `show screen settings(sound, mode) as pick`. The argument must be a
  plain variable name (a `persistent.` one is allowed). Cancelling the screen discards its changes, so it behaves as one
  transaction. The calling site is the only place that writes story variables. (An earlier draft had a separate `returns`
  list; dropped, see Re-evaluation.)
- **Handlers are small inline actions on local state only** (`on focus set tip = "..."`), not labels. They cannot jump, call,
  show a line or touch story state, so they are always "quiet": they run at once, with no queue and no safe point, and the
  screen redraws when local state changes. That makes `on focus` / `on blur` available on every screen, and gives tooltips,
  status lines and hover-reveal zones (all open under the Gameplay modes in TODO.md) for free.
- **Click behaviour is one path.** `action` becomes valid on any element on any screen, next to set-state. The shell's
  hidden variables (`tab`, `mode`, `page`, `slots` ...) become ordinary read-only variables and `action tab` is replaced by `tab`.
- **Lifecycle features stay where they make sense** (`default`, `cancel`, `textbox` and parameters apply to a screen that
  waits); the docs say so in one place instead of per element.

### Recording and replay

Because nothing inside a screen reaches the story, only what it returns needs recording:

- One entry per screen in `choices`: the answer plus the returned values (a list of scalars, e.g. `["done", true, "hard"]`).
  A screen is one step.
- Replaying past the screen applies the recorded return and skips the screen.
- Rolling back to the screen opens it fresh at its declared initial state.
- A stale return (an element or output that no longer exists) falls back to the screen's defaults, as a stale id does today.

Focus-driven state (a tooltip) is transient and needs no recording. The mid-screen replay problem of per-click recording
(a rollback target inside one screen) does not arise.

### Dialogs and nested screens

Today a blocking screen cannot open another: it never runs script, so the story must show the second screen and then show the
first again, rebuilding its state from story variables. Shell screens open each other through `action` (the title's
`action options`, a gallery tile opening the viewer), but only the fixed built-ins. With local state there are two ways to
nest, in order of preference:

1. **A dialog inside the same screen.** A confirm box is a `panel` shown while `state confirm = true`, with buttons that set
   it back. Nothing nests, and it needs no new mechanism beyond local state. This covers the then-open item "Modal / popup dialog
   over a screen, without leaving it" (now part of the TODO.md item on screen elements). While it is up, elements outside it should not take focus (a `modal` flag on the panel).
2. **A child screen.** A handler action such as `open pick_item(bag)` shows another screen on top and hands its returned
   value to the parent's local state, not to the story, so the rule that nothing inside a screen touches the story holds.
   The parent keeps its state while the child is up. Only the outermost screen is recorded (one entry with its final
   outputs); a child is part of that screen's internal flow and is never replayed. A saved snapshot keeps the stack of open
   screens with their local states. Nesting depth is capped at a small number.

### HUD and shell screens

The same model applies. A HUD keeps its local state while it is up, saved with the other HUD state; its outputs go to the
story through its `on click` handlers as today. Shell screens get local state for free, since they are never part of the
story's replay.

## Costs

- **Anything that restores reopens the screen fresh, unless its local state is saved.** A save made while a screen is up,
  a language change (which reloads) and a hot reload would lose the tab and toggles chosen so far. Decision: a save, and
  these reloads, carry a snapshot of the open screen's local state, so those restores keep it. Only a rollback to the screen
  opens it fresh.
- **A screen cannot make the story react to each click.** A self-contained screen (settings, an equipment arranger, a shop
  with simple rules) can edit copies of variables through `inout` and return them. A screen where the story must respond to
  a click (a line of dialogue, a sound, an unlock, `random()`, rules that live in the script) still returns to the story after
  that click and shows the screen again, as today. Rules a screen needs must be repeated inside it, because handlers only
  do small `set`s on local state. The docs should say which pattern to pick.
- **The playtest bot** can no longer treat a screen as a choice among elements: it has to explore the outputs. Toggles and
  radios are finite; a numeric output is not.
- **Tooling needs a notion of local scope**: rename, "unused variable" checks, completions and the debug console (which will
  not show local state) all know about `each` locals and would learn this one.
- **A small action language for handlers**, limited to `set` on local state (reusing the existing expression engine).

## Re-evaluation (2026-11-04)

The context table was checked against `docs/commands.md` and `engine/src/screen-syntax.ts`: the HUD / shell / `slider` /
`on click` rows hold. The `action` row for blocking screens ("no effect") rests on the docs only; check the renderer when
step 2 starts.

Findings that change the plan:

- **Local state does not need outputs.** State that is never returned (the open tab, a tooltip, a hover-reveal flag, a
  confirm box) touches nothing the story can see, so it needs no recording, no `returns`, no `inout` and no replay rule. It
  only needs a redraw when local state changes, which is new for the HUD (redrawn per line today) but small. That alone
  delivers tabs, tooltips / status line, hover-reveal and in-screen dialogs, most of the backlog items this note targets,
  and it works on blocking, HUD and shell screens at once. The restore cost also shrinks: a lost tab after a save or reload is
  cosmetic, so snapshotting local state can wait.
- **Outputs are the expensive half**, and only `toggle` / `radio` and self-contained editors (settings, equipment) need
  them. Do that as a second, separate step.
- **Drop `returns`; keep `inout` alone.** Two lists that can drift apart is the problem `inout` was meant to solve, and
  `inout` already covers an output that is also an input. One mechanism, no positional syntax after `as`, and the call site
  stays `show screen shop(coins, bag) as pick` with the parameters declared `inout`. A pure output (a chosen item) is the
  answer id, or an `inout` variable the story set first. This settles the call-site syntax question.
- **Handler language stays `set` on local state.** That is enough for tabs, tooltips, toggles and dialogs. Not enough for
  list editing (inventory add / remove); do not grow it for that. Such a screen keeps the round trip (return to the story,
  show again), which is the documented pattern.
- **Child screens are dropped from the plan** (a saved stack of screens with local states is a lot of machinery); the panel
  dialog covers the use. Revisit only if a real project needs one.
- **Playtest bot:** do not explore the product of all outputs (2^n). Per screen, try the initial state plus one change per
  toggle / radio / answer element, dedupe by state as today, and keep the existing per-screen state cap. A numeric `inout`
  (slider) is sampled at its initial value, minimum and maximum.
- **A local `state` name hides a story variable of the same name** (as a parameter does today). The editor should warn about
  the collision, since it is a quiet way to read the wrong value.
- **`cancel` on an `inout` screen discards its changes.** That differs from the stock options screen, where Esc keeps what was
  set. The screen chooses by declaring `cancel` or not (see Open questions); the docs must say so next to `inout`.

## Spike findings

Step 0 for blocking screens, read from `preview/screen-ui.ts`, `preview/stage-ui.ts`, `engine/src/runtime.ts` and
`engine/src/playtest.ts`.

**(a) Redraw on a local-state change.** A blocking screen is drawn once: `ScreenLayer.show(view)` builds the DOM, returns a
promise and never looks at the view again, and the runtime hands the renderer a finished, static `ScreenView`
(`Renderer.screen(view, src)`). `mount` (HUD) keeps the focused id (`items[cur].id`) and the scroll offsets
(`scrollSnapshot` / `placeScroll`) across a redraw; `show` has no such path, but nothing stops it from using the same
pieces, so a `redraw(view)` that re-runs `draw`, restores `cur` by id, re-focuses the element when the old one held DOM
focus and replays the scroll snapshot is small. Two things need care: removing a focused element can fire `blur` (guard the
listeners during the redraw), and `maskData` is indexed by item position, so it must be recomputed from the `loadMask`
cache. The view must come from the runtime (it owns the expressions), so the renderer needs a callback:
`screen(view, src, live?)` with `live.set(name, value)` returning the new view.

**(b) `action <name>` on a blocking screen.** The table's "no effect" is not quite right. Runtime: `case 'screen'` only
takes the answer id; `act` is never read there. Renderer: `pick(i)` ends the screen with the element's id whatever `act`
says (`act` only sets `data-act` on the DOM node). So a click on an `action` button answers the screen with its id and does
nothing else. The playtest bot differs: it drops elements with `act` from a blocking screen's choices
(`enabledItems(view).filter(p => !p.act)`), so it never takes a path the player can. That mismatch is older than this
work. The table should read "answers with its id; the action is ignored".

**(c) Hover and focus events.** `setActive(i)` emits `focus` / `blur` chain events only when `onChoose` is set, which only
`mount` does. `pointerenter` / `pointerleave` listeners exist on every screen, so a blocking screen tracks the active
element and its chain but reports nothing. Keyboard `focus` / `blur` listeners are registered for a HUD only; on a blocking
screen the arrow keys and pad go through `move()` -> `setActive`, which focuses the element, but Tab moves native focus
without touching `cur`. Reporting events needs a second callback next to `onChoose`, and the focus / blur listeners, only
on screens that have local state so existing screens behave as before.

**Verdict.** Step 2 is about the size the note says: a callback on the renderer interface, a redraw in `ScreenLayer`, and the
parse / resolve / runtime pieces. Nothing touches the recording format. Go ahead.

Decisions for the prototype:

- `state <name> = <expr>` at the top level of a screen; the initial value is evaluated on entry, in order, with the story
  variables, the parameters and the earlier states in scope. `random()` is not allowed there or in handlers.
- Handlers are `on click|focus|blur set <state> = <expr>` on a `hotspot` / `button`. The expression is evaluated when the
  view is resolved (not at click time) and carried in the view as a finished `[name, value]`, so a handler inside `each`
  can read the entry and the renderer needs no expressions. Every change redraws, so the value is never stale.
- An element with `on click set` keeps the screen up (a click that runs a handler does not also answer); `focus` / `blur`
  handlers leave the click alone. Such an element is not an answer, so `blocks`, `defaultAnswer`, `replayAnswer` and the
  playtest bot see only the answering elements.
- `tab <id> <state>=<word> at x,y "Label"` is a button that sets the state on click and is lit (`data-checked`,
  `aria-selected`) while the state holds that value. `toggle` / `radio` stay with step 3.

## Order

0. Before step 2: a short renderer spike. Check that a screen can redraw on a local-state change without losing focus or
   scroll position (`ScreenLayer.mount` keeps the focused id for a HUD; a blocking screen has no such path yet), and what
   `action` does on a blocking screen. Then fix nesting (a `hotspot` / `button` with indented children, and blur / focus
   computed over the chain of ancestors, as hover-reveal later did), because a tooltip or dialog with
   interactive content needs the same group rule.
1. Interim (built, not kept in the tree): `toggle`, `radio` and `tab` on blocking screens, each click recorded as an answer,
   with tests, docs and the DOM drawing. It was kept aside locally, outside the published history. It binds to story variables directly, which this design
   removes, so treat it as reference. Likely to carry over: the line syntax for `toggle` / `radio` / `tab`, the
   `data-checked` styling and the checkbox / radio marks, and the tests for them. Its per-click recording is what hung
   rollback and replay on a screen with several clicks; the one-entry-per-screen rule avoids that.
2. **Local `state` only** (no outputs), **blocking screens only**: `state` declarations, `tab` bound to local state, inline
   `on click` / `on focus` / `on blur` actions that `set` local state, redraw on change, dialogs as panels with a `modal`
   flag. State lives exactly as long as the screen is up, so there is no lifetime to define. A HUD keeps story variables
   through quiet handlers (each hover is recorded, which is noisy but replay-safe); revisit local state for a HUD only
   if that noise is a problem, and then decide when it resets (`hud off`, `scene`, never). Delivers tabs, tooltips,
   status line and in-screen dialogs.
3. **Outputs (built, see Step 3 as built):** `inout` parameters, one recorded entry per screen (answer plus
   returned values), `toggle` / `radio` bound to local state, a snapshot of local state in saves. Replaces the interim
   toggle form. Bot change as above. The round trip through the story covers the need until then.
4. Shell screens: `action` on any element, shell variables as read-only variables, `action tab` replaced by `tab`
   (a local `state tab` shadows the shell's). Independent of step 3; do it when a project needs it.

## Open questions

Settled:

- A screen may read story variables other than its parameters (it already does: `if visited > 0`), read-only. Replay is
  deterministic, so it stays rollback-safe.
- A change a shell screen makes goes to player settings only, never to a story variable. Shell screens have no `inout`.

Still open:

- Should `slider` be allowed on any screen, bound to a local numeric `inout` as well as a player setting? (Step 3.)
Settled (step 3):

- `cancel` stays bare by default and discards the `inout` changes. `cancel keep` is the opt-in form: Esc still answers `""`
  (the story can tell it was Esc), but the `inout` changes are applied, for a screen where Esc should just close it, like
  the stock options screen. `keep` becomes a reserved word there (it is not an element id in that position, so no clash).
  The word is a proposal; `cancel <id>` (Esc acts as pressing that element) was the alternative.

- The screen decides what Esc does. A screen without `cancel` ignores Esc; only its buttons end it, and they keep the
  `inout` changes. A screen that declares `cancel` answers `""` on Esc and discards its `inout` changes (one transaction),
  so a declared `cancel` always means cancel. This matches today's rule that Esc does nothing unless the screen asks for it.

## Step 2 as built

Blocking screens: `state`, `tab`, `on click|focus|blur set` (docs/commands.md, "state / tab / toggle / radio / inout"). The decisions above held, with
these details:

- The runtime keeps the local state in the `show screen` call and hands the renderer a `live.set(name, value)`; handlers are
  evaluated when the view is resolved and carried in it as `[name, value]`, so the renderer never sees an expression.
- `ScreenLayer.redraw` keeps the active element, DOM focus and scroll positions. Focus / blur listeners and chain events are
  only active on a screen with local state, so every other blocking screen behaves as before.
- An element with `on click set` is not an answer (`enabledItems` leaves it out), so `blocks`, `defaultAnswer`,
  `replayAnswer` and the bot ignore it. A rollback or replay reopens the screen at its initial state because the state was
  never recorded.
- Not done: the `modal` flag on a panel (a dialog works as a panel shown while a state is set, but elements behind it still
  take focus), local state on a HUD (an error today), and a bot that follows a click to the states it reaches.

## Step 3 as built

Blocking screens: `inout` parameters, `toggle` and `radio` (docs/commands.md, "state / tab / toggle / radio / inout"). Details that
the plan left open:

- **Write-back is the runtime's, at the call.** `compile` resolves each `inout` parameter to the story variable the call names
  (`Op.outs`; a `persistent.` name is stored for good) and rejects anything but a plain variable. The screen's local state
  starts as the parameter values, so a toggle on an `inout` parameter is an ordinary local-state change (the step 2 path).
- **Recording** is one `choices` entry per `inout` screen, `[answer, ...values]` in parameter order; an ordinary screen still
  records the bare answer. A value is stale when its type differs from the story value or no `radio` on that parameter sets
  it; each stale value stays as the story had it and a stale answer falls back to `default` independently.
- **Cancel:** no `cancel`: Esc ignored, buttons keep the changes. `cancel`: Esc answers `""` and the recorded values are the
  initial ones. `cancel keep`: Esc answers `""` with the changes. `keep` is the only argument.
- **Snapshots:** `Runtime.screenSnapshot()` is the open screen's name, source line and local values (`state`s and `inout`s).
  Saves carry it (`SaveData.screen`), `restore(target, choices, snapshot)` hands it to the first live showing of that screen,
  and hot reload / language change pass the current one. A rollback passes none, so it opens fresh.
- **Playtest bot:** per screen it tries the initial state plus one change per `toggle` / `radio`, each followed by the elements
  that answer the screen (and Esc when declared), deduplicated by answer and returned values, under the existing per-choice cap.
  A numeric `inout` stays at its initial value (no `slider` on local state yet).
- **Tooling:** rename and "unused" checks treat `inout` parameters, `state` names, the state a `toggle` / `radio` / `tab` names and
  the target of `on ... set` as local to their screen.

Left: step 4 (shell screens), `slider` bound to a numeric `inout`, list editing, the `modal` flag, local state on a HUD, and a bot
that follows tab changes.
