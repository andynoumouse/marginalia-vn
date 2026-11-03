# Script command reference

Every statement of the `.vn` script language, with examples. Scripts live in `script/*.vn`; all files are
compiled together, labels are global, and top-level lines (`define`, `set`, ...) of every file run once before
the story starts. The story begins at `label start:` (or the first label). Indent with spaces, never tabs.
Lines starting with `#` are comments. The sample `sample/script/demo.vn` uses most of what is below.

Durations are in seconds. Positions are `left` (0.2), `center` (0.5), `right` (0.8), a name from game.json `positions` (e.g. `farleft`) or a number from 0 (left edge) to 1 (right edge).
Visual commands (everything under "Stage") accept `nowait` to run in the background while the script goes on.

Contents: [Story](#story) · [Dialogue](#dialogue) · [Text tags](#text-tags) · [Stage](#stage) · [Effects](#effects) ·
[Audio](#audio) · [Logic](#logic) · [Flow](#flow) · [Player input](#player-input) · [Persistent flags](#persistent-flags) ·
[Editor keys](#editor-keys)

## Story

### define
`define <id> "<Name>" [options]` declares a character. Options: `color=` (name tag), `text=` (text color),
`font=`, `size=` and `speed=` (multipliers), `italic`, `blip=` (text sound), `box=` (text box skin), `focus=off` (always
lit under [speaker focus](#focus)), `side=` (a portrait in the text box, below).

```
define alice "Alice" color=#ff6fa5 text=#ffe6f0 font="Georgia" size=1.1 italic speed=0.8 blip=blip_hi box=alice
define narrator "" text=#d8d2c0 italic      # style of "quoted narration" lines
define thought "" italic                    # `thought: ...` lines show no name tag
```

**Side images**: with game.json `"sideImages"` on, a character defined with `side=<name>` has their portrait drawn in the
text box while they speak: `assets/side/<name>.png`, or `assets/side/<name>_<pose>.png` while they are on stage in that
pose (`show alice smile` makes Alice's lines use `alice_smile.png` when it exists). Portraits are off in NVL mode.

```
define alice "Alice" color=#ff6fa5 side=alice   # assets/side/alice.png, alice_smile.png, ...
```

`define item <id> "<Name>" [image=<file>]` declares an item for lists and screens: the name is localizable (`npm run ids` gives
it an id), and the image is a file under `assets/` (extension optional) that is checked and preloaded like other art.
`[bag]` in text shows the names of the items a list holds; in a screen's `each`, `item.name` and `item.image` give one entry's.

```
define item key "Brass key" image=ui/key.png
```

### label
`label <name>:` marks an entry point for `jump` and `call`. Label names are unique across all scripts.
`label <name>(<param>, ...):` also declares parameters, filled by `call <name>(<arguments>)` (see "jump / call / return / end").

```
label start:
  "It begins."
```

## Dialogue

### Speech and narration
`<character>: text` is spoken by a defined character; a bare `"text"` is narration. Lines get a trailing
localization id (`#a3f9`), added by `npm run ids`. `[variable]` inserts a variable's value.
`[n:2]` shows a number with 2 decimals, `[n:,]` groups thousands (`1,234`; `[n:,2]` does both), and
`[n:coin|coins]` picks a plural form (`[n:no coins|a coin|coins]` adds a form for 0; a list counts its length).
Languages with more forms name them by plural category: `[n:one=монета|few=монеты|many=монет|other=монеты]` uses
the plural rules of the language being played (`zero`, `one`, `two`, `few`, `many`, `other`); an exact count such as
`0=no coins` wins over the category, and a missing category falls back to `other`.
Write each translation's own forms in the locale file. An unknown format leaves the tag as written.

```
alice: Hello, [name]. #a3f9
"The park was nearly empty." #joce
```

### menu / on
A choice. Each option is a quoted string ending in `:` with an indented body. Add `if <condition>` to show an
option only when the condition holds. Bodies usually end with a `jump`.

```
menu "What do you say?" #pr01:
  "Sorry, I got lost." #qw64:
    set trust += 1
    jump bench_talk
  "Secret option" if trust >= 3:
    jump secret
  "Open the vault" #vl01 if has_key else "You need the key." #vl02:
    jump vault
```

- **Prompt line:** `menu "Text":` shows the text above the choices. It is a localizable string like dialogue (it gets an
  id by `npm run ids`); `{tags}` and `[variables]` work in it. Plain `menu:` has none.
- **Disabled options:** `"Text" if cond else "Reason":` is shown even when the condition fails, but greyed out with the
  reason under it, and it cannot be chosen. The reason is localizable (own id) and is read out by screen readers
  (`aria-disabled` plus a description; pad/keyboard focus skips the option, Tab still reaches it). Without `else` a failed
  condition hides the option, as before. A menu where nothing can be chosen (all options hidden or disabled) is skipped.
  The recorded answer is the index among the options shown (disabled ones count), the playtest bot only takes enabled ones.
  Like other conditions, `random()`, `pick()` and `chance()` are not allowed in it.
- **Timed choices:** `menu "Text" timeout 8:` gives the player that many seconds (an expression, evaluated once when the menu is
  shown, so `timeout 8 - difficulty` works and `random()` is allowed; 0 or less means no clock). It needs one `on timeout:`
  block as the last block of the menu. The block is never shown as an option; it is what the story does when the clock
  runs out, written as ordinary script:

  ```
  menu "The guard turns around!" timeout 8:
    "Run":
      jump chase
    "Hide behind the crates":
      jump hidden
    on timeout:
      "You freeze. He sees you."
      jump caught
  ```

  The stock menu draws a bar under the options that empties over the time (it turns to the warning colour in the last
  quarter) and announces "N seconds to choose" once to screen readers. The clock pauses while the pause menu, options,
  history or a save dialog is open, while the interface is hidden and while the tab is in the background. Players can
  change it in Options, Timed choices: *Normal*, *Extended* (three times the time) or *No time limit* (the clock never
  runs, so `on timeout` never runs for them). Write the story so it works for all three. A fixed timeout under 2
  seconds is a warning (too short to read). A timeout counts as an answer: it is recorded in saves like a chosen option
  (the clock is not saved, so loading a save made at a timed menu gives the menu its full time again), it marks no
  option as seen, and rollback, hot reload and Preview from cursor inside the block replay it. Menus only: `input` and
  `screen` have no timer. The playtest bot always follows the timeout (it ignores the player's setting) and reports the
  block as unreachable when the timeout is a fixed 0 or less. For a custom renderer, `Renderer.menu` gets a fourth
  argument `{ seconds }` and resolves `options.length` when time runs out.
- **Seen marker:** the engine remembers every option the player has taken, keyed by its id (else `file:line`). Options
  taken before are drawn dimmed with a check mark (`data-seen` on the button; `MenuItem.seen` for custom renderers). It is
  kept like unlock flags: it lasts across playthroughs, is saved with the save (`seenBase`/`seen`) and is rebuilt on
  rollback and load. Give options a stable `#id` so editing lines does not reset the marker.

### nvl
`nvl on` switches to full-screen narration: lines (spoken ones get the speaker's name in front) collect on one
page instead of replacing each other in the text box. `nvl clear` starts a new page, `nvl off` goes back to the
text box. A `scene` also starts a new page. When a page is full the oldest lines scroll off the top. Choices
appear over the page. It lasts until `nvl off`.

```
nvl on
"The rain had not stopped for three days."
"Even the crows had gone quiet."
nvl clear
alice: Did you hear that?
nvl off
```

## Text tags

Used inside dialogue and narration text.

| Tag | Effect |
|---|---|
| `{i}..{/i}`, `{b}..{/b}` | italic, bold |
| `{color=#ff6fa5}..{/color}` | text color |
| `{size=1.5}..{/size}` | size multiplier |
| `{wave}..{/wave}`, `{shake}..{/shake}` | animated text (still under Reduce motion) |
| `{ruby=reading}base{/ruby}` | small reading above the base text |
| `{pause=0.5}` | pause typing for that many seconds |
| `{wait}` | stop until the player clicks, then continue the same line |
| `{nw}` | go on to the next line without a click once the text is shown |

```
alice: A pause{pause=0.6} in the middle.
alice: {color=#ff6fa5}Pink{/color}, {size=1.5}big{/size}, {ruby=kan}漢{/ruby}.
alice: Wait for it...{wait} there.
alice: This line moves on by itself.{nw}
```

## Stage

### scene
`scene <background> [transition] [seconds]` replaces the background, removes all shown characters and resets
`tint`, `camera`, `weather` and `filter`. Transitions: `cut` (default), `fade`, `dissolve`,
`wipe <left|right|up|down>`, `iris` (a circle opening from the middle), `blinds` (twelve vertical slats) and
`pixelate` (the picture breaks into growing blocks, is swapped, and sharpens again). Background `<name>` is `assets/bg/<name>.png|webp|jpg`.

```
scene bg_park_evening fade 0.5
scene bg_park_night dissolve 1.2
scene bg_room wipe right 0.8
scene bg_attic iris 1.0
scene bg_hall pixelate 0.8
```

### show / hide
`show <char> [pose] [at <position>] [y=] [scale=] [flip=on|off] [anchor=] [order=front|back | behind=<char>] [fade <seconds>] [slot=variant ...]`. For layered
(PSD) characters a pose picks a variant per slot, and `slot=variant` overrides one slot (`glasses=none` empties it).
A pose-less show keeps the character's current pose. `y=`, `scale=` and `flip=` place the character in the same
units as [move](#move), without a slide; leave them out to keep what the character has. `anchor=` is the point it scales, turns and mirrors about (see [move](#move)). The animation studio's
Place mode (Character: Animation Studio) writes the whole line for you: drag the character where it should stand. The line includes the pose and slot variants chosen in the Parts tab, and "Insert in script" puts it under the line the cursor was on.
`hide <char> [fade <seconds>]`.

Characters are drawn in the order they were first shown, the newest in front. `order=front` or `order=back` moves a
character in front of or behind everyone on stage, and `behind=<char>` puts it just behind that character (nothing
changes when that character is not on stage). The order lasts until the next `order=` / `behind=`, a `hide` or a `scene`,
and saves and rollback keep it. A character shown without `at` stands at center, so give each one its own place when
several are on stage. The editor warns when a character shown without `at` would stand on top of someone already at
center (unless the `show` has `behind=` or `order=`, which say the overlap is meant).

```
show alice smile at left fade 0.3
show alice smile at 0.35 y=0.02 scale=1.1
show alice neutral eyes=closed
show bob at center behind=alice      # bob steps in, drawn behind alice
show alice order=back                # alice steps back behind everyone
hide alice fade 0.3
```

### move
`move <char> [to <position>] [y=] [scale=] [rot=] [alpha=] [flip=on|off] [anchor=] [seconds] [ease=]` slides a character and/or
changes how it is drawn, all together over the seconds (instant when omitted). The changes last until the next
`move` or until the character is hidden or the scene changes.

- `to <position>`: `left`, `center`, `right`, a game.json position name or a number 0-1 across the stage.
- `y=`: offset from the floor as a fraction of the stage height; negative lifts the character.
- `scale=`: size (1 = normal), grown about the anchor (the feet unless `anchor=` says otherwise).
- `rot=`: tilt in degrees, clockwise, about the anchor.
- `alpha=`: opacity 0-1.
- `flip=on|off`: mirrors the character. It is not tweened: it applies as the move starts.
- `anchor=`: the point `scale=`, `rot=` and `flip=` turn about: `feet` (default), `center`, `head`, `top`, or two fractions of the sprite like `0.5,0.3` (0,0 is its top left), or a name from game.json `anchors`. `y=` and `at` still say where the feet stand, so only the pivot changes. Not tweened: it applies as the move starts, and a `show` without `anchor=` keeps the character's current one.
- `ease=`: `linear`, `in`, `out`, `inout` (default), `back` (overshoots the end), `bounce`, `elastic`.

```
move alice to right 0.6 ease=out
move alice scale=1.15 y=-0.02 0.3 ease=back
move alice rot=-6 alpha=0.6 0.5
move alice flip=on
move alice rot=15 anchor=head 0.4
show alice at left anchor=center
```

### shake / hop
`shake <char|screen> [seconds] [strength=8]` and `hop <char> [seconds]`.

```
shake alice 0.3 strength=6
hop alice 0.25
```

On a character both are the `shake` and `hop` animations below.

### animate
`animate <char> <name> [seconds] [loop] [strength=1] [part=<part>]` plays a named animation on a character (a preset below, or a
keyframe animation from the character's `rig.json`, see [rig-json.md](rig-json.md)); `animate <char> stop` ends
its loop. The animation adds to where the character stands (`move`, `show at`), so the two combine. Without `loop`
it plays once for the seconds (a default for each name) and the script waits for it unless `nowait`. With `loop`
it repeats until `stop`, `hide` or the next `scene`, the seconds being one cycle; a loop is kept in saves and
rollback, and a new loop replaces the running one. With `part=` the animation moves just that part of a layered
character (about its pivot, see [rig-json.md](rig-json.md)) instead of the whole body; a rig.json group moves all its parts as one. `strength=` scales how far it moves. With reduce motion on,
animations do not play.

| name | default seconds | motion |
| --- | --- | --- |
| `breathe` | 3.5 | slow swell of the chest (a gentle stretch up) |
| `bob` | 1.2 | lifts and settles |
| `sway` | 3 | tilts side to side |
| `nod` | 0.5 | two quick dips |
| `shiver` | 0.6 | fast small tremble |
| `pulse` | 1 | grows and shrinks |
| `bounce` | 0.8 | bounces, settling down |
| `hop` | 0.25 | one jump |
| `shake` | 0.3 | shakes side to side |

```
animate alice breathe loop
animate alice nod
animate alice bounce 1.2 strength=1.5
animate alice stop
```

### wait
`wait <seconds>` pauses the script.

## Effects

### flash
`flash [#color] [seconds]` flashes the screen and fades it out (white, 0.4 s by default).

```
flash
flash #ff3030 0.8
```

### focus
`focus off` stops [speaker focus](#focus) from dimming anyone (a group scene, a cutscene), and `focus on` brings it back. It
lasts across scenes until the next `focus` line, and saves, rollback and hot reload keep it.

Speaker focus is on only when game.json has `"speakerFocus"` (see docs/game-json.md): while a character speaks, the
others on stage are drawn darker, fading over a moment (at once under reduce motion and while skipping). The speaker
stays lit until the next line, choice, input or screen; during narration or a line by someone not on stage everyone is
lit (or everyone dimmed, with `"offstage": "dim"`). With `"front": true` the speaker is also drawn in front of the others
for the line, and the order set with `order=` / `behind=` comes back after it. A character defined with `focus=off` is
never dimmed, and players can turn the whole thing off in Options (Game tab).

```
focus off
"Everyone talks at once."
focus on
```

### tint
`tint <#color> [strength 0-1] [seconds]` washes the scene in a color (strength 0.4 by default; the seconds are
the fade-in). It lasts until `tint off [seconds]` or the next `scene`.

```
tint #203060 0.5 1.5
tint off 1
```

### image
`image show <name> <file> [at x,y] [scale=] [rot=] [alpha=] [anchor=] [layer=] [fixed] [keep] [fade s]` shows a picture over
the scene (an item, a CG, a letter) under the name you give it. `<file>` is a path under `assets/` (extension optional),
so `cg/letter` is `assets/cg/letter.png`; a missing file is drawn as a placeholder and warned about once there are images.
`at x,y` is where its `anchor` sits, in stage pixels (1920x1080 unless game.json `stage` sets another size); the anchor is the picture's top left
unless you give `anchor=center` (or `feet`, `head`, `0.5,0.3`), and `scale=` and `rot=` turn about it. Showing a name
that is already up changes that picture (new file, and only the fields you name).

`layer=` is a whole number: below 0 draws behind the characters, 0 and up in front of them (higher is nearer, ties go to
the one shown last). The picture follows the camera and `filter` like the scene; `fixed` keeps it still on the screen.
Pictures disappear on `scene` unless shown with `keep`. They are kept in saves and rollback.

`image move <name> [to x,y] [scale=] [rot=] [alpha=] [anchor=] [seconds] [ease=...]` slides and fades like `move`;
`image hide <name> [fade s]` removes it. (Inside a `screen:` block, `image` is the screen element instead.)

```
image show letter cg/letter at 960,540 anchor=center scale=0.8 fade 0.4
image move letter to 960,300 scale=1 0.5 ease=out
image show frame ui/frame layer=-1 fixed keep
image hide letter fade 0.3
```

### camera
`camera zoom <factor> [at <position>] [y=0-1] [seconds] [ease=...]` zooms (factor 1 or more) about a point;
`camera pan <position> [y=0-1] [seconds] [ease=...]` moves that point while keeping the zoom, so the view slides
(it only shows while zoomed in); `camera reset [seconds]` goes back. Resets on `scene`.

```
camera zoom 1.6 at center y=0.4 1.0 ease=out
camera pan right 1.5
camera reset 0.6
```

### weather
`weather <rain|snow|petals|embers> [intensity 0-1] [seconds]` lets particles fall (embers rise) over the scene;
intensity is how many (0.6 by default) and the seconds are the fade-in. A new kind replaces the old one.
It lasts until `weather off [seconds]` or the next `scene`, and is kept in saves. Reduced motion shows none.

```
weather rain 0.8 2
weather snow
weather off 1.5
```

### filter
`filter <blur|grayscale|sepia|night|vignette> [strength 0-1] [seconds]` changes the look of the whole scene
(strength 1 by default; the seconds are the fade-in). One filter at a time: a new one replaces the old.
It lasts until `filter off [seconds]` or the next `scene`. It does not touch the text box.

```
filter sepia 1 0.8
filter night 0.7
filter off 1
```

## Audio

### music
`music play <name> [loop] [fade <seconds>]`, `music stop [fade <seconds>]`, `music pause [fade <seconds>]` and
`music resume [fade <seconds>]`. Tracks are `assets/music/<name>.ogg|mp3|wav|m4a|flac|opus`; music crossfades over
`fade` and loops only with `loop`. `pause` fades the track out and remembers where it was; `resume` carries on from there.
`play` and `stop` end a pause, and `pause` with no music playing does nothing. A pause survives saves, rollback and hot reload.

```
music play evening_theme loop
music stop fade 1
```

### voice lines
There is no command for them: a line plays `assets/voice/<id>.*` when it appears, where `<id>` is the line's localization id (the `#ab12` that
`npm run ids` adds), or `assets/voice/<id>.<lang>.*` (for example `ab12.fi.mp3`) when the player's voice language has its own recording. The default take
carries no language in its name, so game.json `language` never affects file names. Lines without a file stay silent.
Auto-advance waits for the recording to end; moving on, skipping, rollback and loading cut it. The Voice slider in Options (`slider voice`) sets its
volume, the quick bar shows a Voice button on voiced lines (`action voice` in a `screen quickmenu`), and `V` plays the line again.

A recording keeps its id when the line is reworded, so `npm run voice` (also run by `npm run export`) looks for recordings made for older
wording. It keeps `voice.lock.json` in the project folder (commit it): the checksum of each recording and the text of the line when the file was
first seen or last replaced. A file that is unchanged while its line's text differs is listed with the old and the new wording until you record it
again (a new file is adopted with the line's current text) or confirm it with `npm run voice -- accept <name>` / `accept all`, for a typo fix that
needs no new take. Nothing is judged while you type: only the check, or the editor's **Voice: Recordings per Line** command
(Ctrl+P), builds the list. Export only lists them as a warning (`build.checks` in game.json can make it an error). A recording `<id>.<lang>.*` is judged against that language's text. The game still
plays outdated recordings. A file added together with a rewording, or before the first run, is taken as matching, since the text it was made for
is unknown.

The **Voice** dialog lists every line that has an id, one language at a time (the picker offers the default take, labelled with game.json `language`,
and each language with a translation or a recording), with its state: no recording, recorded or outdated. Filter by text, "Missing only" or
"Outdated only"; the summary counts the lines voiced. Drop an audio file on a row to save it as that line's take
(`assets/voice/<id>[.<lang>].<ext>`, whatever the file was called), or use the row's **Add file…** button; an existing take is replaced only after you
confirm, and any older file of the same recording under another extension is removed. Files already named `<id>.<ext>` (or `<id>.<lang>.<ext>`
for a language) can be dropped on the list together and are matched by name; the others are listed to drag onto a row. **Play** hears a take. An
outdated row shows the recorded and the current wording with the changed words marked, and **Still fine** (or **Still fine: all**) keeps the
take. **Recording script (CSV)** downloads the lines shown (id, file, line, speaker, text, and the file name to deliver the take as, without
extension) for the voice actor; tick "Missing only" first to get just what is left to record.

### sound
`sound play <name> [duck]` plays `assets/sound/<name>.*` once. A cue without a file is shown as text in the corner.
`duck` dips the music under the sound while it plays and eases it back after.

`sound loop <name> [fade <seconds>]` starts a looping sound (rain, a crowd) on its own channel; any number can run
under the music, and looping the same name twice does nothing. `sound stop [<name>] [fade <seconds>]` ends one looping
sound, or all of them without a name. Looping sounds keep running across `scene` (stop them yourself), and are rebuilt
by saves, rollback and hot reload. While the player skips, fades finish at once and `sound play` stays silent.

```
sound loop rain fade 2
sound play thunder duck
sound stop rain fade 3
```

## Logic

### set
`set <variable> <op> <expression>` with `=`, `+=`, `-=`, `*=` or `/=`. Expressions have numbers, strings,
variables, lists, `+ - * / %`, comparisons, `and`, `or`, `not`, parentheses and the functions below. Unset variables
read as 0 / empty. `set persistent.<name> ...` stores a value for good (see Persistent data).

```
set trust = 0
set trust += 1
set title = "Mr. " + name
```

### random / pick / chance
Functions usable in any expression (`set`, `if`, `elif`):

- `random(a, b)` a whole number from `a` to `b` inclusive; `random(n)` is `random(1, n)`; `random()` is a decimal from 0 up to (not including) 1.
- `pick(a, b, ...)` one of its arguments, chosen at random (numbers, text or booleans); `pick(list)` one element of a list.
- `chance(percent)` is true that many times out of 100.

```
set roll = random(1, 6)
set greeting = pick("Hi!", "Hello!", "Hey!")
if chance(25):
  alice: Lucky you.
```

The generator is seeded: a new game picks a seed, saves keep it, and every restore, rollback or hot reload starts
again from the seed and takes the same steps, so a replay draws exactly the same numbers and takes the same branches
as the first time. Draw into a variable first and branch on it; `random`, `pick` and `chance` are not allowed in menu
option conditions (`"Option" if ...:`), because those are re-evaluated whenever the menu is built.

### lists
A variable can hold a list of numbers, text or booleans: an inventory, a party, the clues found. Write one in square
brackets and use `set` with `+=` and `-=` to change it. Nothing needs a new command, and lists work everywhere a
value does: `if`, menu conditions, `persistent.<name>`, saves and rollback.

```
set bag = []
set bag += "key"                 # add one
set bag += ["map", "lamp"]       # add several
set bag -= "lamp"                # remove the first match
if contains(bag, "key"):
  alice: You have the key.
"You carry: [bag]."              # You carry: key, map.
set first = item(bag, 1)
```

- `contains(list, x)` is true when the list has `x`.
- `count(list)` is the number of elements; `count(list, x)` how many equal `x`.
- `item(list, n)` is the n-th element, counting from 1 (empty text when there is none).
- `index(list, x)` is the position of the first `x`, counting from 1 (0 when absent).
- `pick(list)` is a random element (seeded, see above).
- `+` and `-` also work on lists inside an expression and give a new list; `==` and `!=` compare content and order.
- In text, `[bag]` shows the elements separated by commas.

A list keeps duplicates, so guard with `if not contains(bag, "key"):` to add something only once. Start a list with
`set bag = []` before you use it: `set bag += "key"` on a variable that was never a list gives text, and the compiler
warns about a variable used as a list that is never set to one. `contains`, `count`, `item` and `index` may be used in
menu option conditions; `pick` may not. Lists hold plain values only (no list inside a list). The Variables panel
shows a list as `["key", "map"]` and edits it in the same form.

### if / elif / else
```
if trust >= 2:
  alice: Fine.
elif trust >= 1:
  alice: Maybe.
else:
  alice: No.
```

## Flow

### jump / call / return / end
`jump <label>` continues there. `call <label>` runs a label as a subroutine and `return` comes back after the
`call`. `end` finishes the story.

```
call helper
jump bench_talk
end
```

**Parameters.** A label can declare names, and `call` gives them values, so one label serves every case instead of copies:

```
label start:
  call buy("sword", 10)
  call buy("shield", price + 2)   # arguments are expressions, read in the caller
  end

label buy(item, cost):
  "The [item] costs [cost] coins."
  set coins -= cost
  return
```

- The call needs exactly as many arguments as the label has parameters (`call helper` and `call helper()` for none): a wrong count, or an unknown label, is a compile error. `jump` to a label with parameters warns, since nothing fills them.
- A parameter is local to the call: it hides a variable of the same name and gives it back at `return`, and anything else the label sets is global as before. Recursion works (each call has its own values). Several arguments are all evaluated before any parameter is bound, so `call swap(b, a)` is safe. To hand a result back, set a global variable.
- Parameters are ordinary variables while the call runs, so `[item]`, conditions and the Variables panel see them. Saves, rollback and hot reload keep them; a Preview from cursor that starts inside a label body skips the call, so its parameters read as 0 (start from the `call` line to test a parameterised label).
- A `jump` out of the label leaves the call open, and `return` then restores the values; a HUD handler label (`on click`) is started without arguments.

## Player input

### input
`input <variable> "<Prompt>" [default="Name"] [max=24]` asks the player for text and stores it in the variable
(cut to `max`). The prompt and the default may hold `[variables]` (`default="[name]"` offers the last answer). Answers are replayed with menu choices when rolling back or loading. Pad users get an
on-screen keyboard. `npm run ids` gives the prompt a localization id (`... max=16 #ab12`), so it is
translated through `locale/<lang>.json` like dialogue.

```
input name "What's your name?" default="Alex" max=16
alice: Nice to meet you, [name].
```

## Screens

### screen / hotspot / button / each
`screen <name>:` declares a page of clickable things once (at the top level); `show screen <name> [as <variable>]` shows it
and waits. The id of the element the player chose is stored in the variable (`screen` by default) and recorded like a
menu answer, so save, load, rollback and Preview from cursor work. A screen never runs script code itself: the story
branches on the answer with `if` / `jump`, and loops back to the screen if it wants more.

Coordinates are **stage pixels**: 1920x1080 unless game.json `stage` sets another size (the examples assume the default), origin top left, y down. The screen scales with the window. Elements:

```
screen map:
  image "ui/map.png" at 0,0 size 1920,1080       # backdrop (omit to draw over the current scene); `at` and `size` are optional
  text at 80,48 "You carry: [bag]"               # [variables] work; lists show item names
  hotspot cafe at 300,300 size 360,200 "The cafe"            # a rectangle; the label is the tooltip
  hotspot lake ellipse at 900,600 size 440,240 "The lake"
  hotspot station poly 1300,300 1600,260 1680,520 "The station" if visited > 0   # hidden unless the condition holds
  hotspot closed at 700,150 size 260,120 "Library" enabled false                 # shown, not selectable
  hotspot region mask "ui/region.png" at 0,0 size 1920,1080 "Region" cursor help # opaque pixels of the PNG are the region
  button leave at 80,940 "Leave"                 # size is optional (fits the label)
  each bag as item at 120,200 step 0,130         # one copy of the body per list entry, moved by `step` each time (`limit n` draws at most n)
    button item at 200,0 size 640,100 "[item.name]"   # inside each, the id `item` stands for the entry
  default cafe                                   # answer when a replay has none (else the first enabled element)
  cancel                                         # the cancel key (Backspace, pad B) answers ""
```

`up <id>`, `down <id>`, `left <id>` and `right <id>` on a hotspot or button say where that arrow key goes instead of the nearest
element (`button play at 100,100 "Play" down options`); when the target is disabled or hidden the nearest one is used.

`hover "file.png"` on a hotspot or button draws that image over the element while it is hovered or has focus (mouse, arrows,
Tab and pad alike). It is stretched to the element's box, so for a `mask`, `poly` or `ellipse` hotspot give it a PNG the size
of that box (a `poly`'s box is its bounding rectangle); put a transparent border around the glow if you want one. While a
hover image is set, the stock highlight is not drawn, so the image is the whole look. It can use `[variables]` like an image
path, and a missing file just draws nothing.

```
hotspot door mask "ui/door_mask.png" at 800,300 size 200,300 "Door" hover "ui/door_glow.png"
button play at 100,100 size 300,90 "Play" hover "ui/play_lit.png"
```

`hover none` turns the highlight off for that element (it stays clickable and focusable; use it when the art already shows
the state, or the element is meant to be invisible). `tooltip off` on a hotspot drops its tooltip; the label is still read by
screen readers.

```
hotspot door at 800,300 size 200,300 "Door" hover none tooltip off
```

Without art, `hover tint <color>` fills the element with that color while it is active (no spaces in the color: `#ffcc6666`,
`gold`, `rgba(255,200,100,.35)`; it replaces the stock fill and border, and the theme's `hotFill`), and `hover scale <n>`
grows it about its centre (`1.08`; reduced motion makes it instant). They go well on a `mask`, `ellipse` or `poly` hotspot
and on a button, and cannot be combined with a `hover` image. `hover sound "name"` plays `assets/sound/<name>` when the
element becomes active (mouse, arrows, Tab or pad; not while it is disabled).

```
button play at 100,100 size 300,90 "Play" hover scale 1.08 hover sound "tick"
hotspot door mask "ui/door_mask.png" at 800,300 size 200,300 "Door" hover tint rgba(255,220,120,.35)
```

`on click <label>` is for a HUD (below); a blocking screen ignores it.

`action <name>` on a button or hotspot runs a built-in of the game shell instead of a label: `back`, `history`, `auto`, `skip`,
`qsave`, `qload`, `save`, `load`, `options`, `voice` (hear the current line again) or `hide`; on the title screen also `start`, `continue`, `gallery`, `music`, `chapters`, `achievements` and `quit`, and on the pause menu `resume` and `title` (back to the main menu, after the usual confirmation), and on the options screen `close`, `fullscreen`, `tab` and `cycle` (below). It is how the quick menu is drawn by a screen: declaring a screen named
`quickmenu` replaces the stock bar (game.json `quickMenu` is then ignored) and shows it while a game is being played. Nothing is
recorded in saves; Auto and Skip show `aria-pressed` while they are on, so a theme can style them. The screen is redrawn before
every line like a HUD, so `[variables]`, `if` and `enabled` work.

```
screen quickmenu:
  row anchor bottomright margin 24 gap 12:
    button back "Back" action back hover scale 1.08
    button hist "History" action history
    button auto "Auto" action auto
```

A screen named `title` likewise replaces the stock title screen (the game.json background and music still show behind it):
`start` begins a new game, `continue` loads the newest save (disabled without one), `load` and `options` open those screens,
`quit` closes the window (browsers only allow that for a window the page opened itself).

```
screen title:
  column anchor center gap 16:
    button go "New game" action start
    button more "Continue" action continue
    button opt "Options" action options
```

A screen named `pause` replaces the stock pause menu (Esc still opens and closes it; the dimmed stage stays behind it):

```
screen pause:
  column anchor center gap 16:
    button back "Resume" action resume
    button sv "Save" action save
    button ld "Load" action load
    button opt "Options" action options
    button menu "Main menu" action title
```

A screen named `options` replaces the stock options screen (Esc still closes it; opened from the title, the pause menu or the quick menu).
The settings are the screen's variables, so labels and conditions can show them:

- `slider <setting> at x,y [size w,h] [readout]` is a range bound to `master`, `music`, `sound`, `voice`, `text_speed`, `text_size` or `box_opacity`
  (400x48 without `size`). It shows its own position; `readout` adds the live value (`65%`, or the plain number for `text_speed`)
  16px to its right. `[master]` in a text is the value when the screen was last drawn.
- `button <setting> ... action cycle` steps a setting that has a few words: `text_sounds`, `reduce_motion` and `captions` (`on`/`off`), `speaker_focus` (`on`/`off`, `none` when game.json has no `speakerFocus`; cycling it then does nothing), `timed_choices` (`normal`/`extended`/`off`),
  `auto_speed` (`slow`/`normal`/`fast`), `skip` (`read`/`all`), `language` and `voice_language` (`text` = follow the text language, else a language that has recordings; does nothing when none do).
  The button id names the setting, and `[text_sounds]` in the label is its current word.
- `button <name> ... action tab` selects a tab: the variable `tab` becomes the button id (the first `action tab` button until one is picked), so
  `if tab == "audio"` shows an element on that tab only.
- `action close` goes back (the same as Esc) and `action fullscreen` toggles fullscreen.

```
screen options:
  row anchor top margin 60 gap 20:
    button audio "Audio" action tab
    button game "Game" action tab
    button done "Back" action close
  slider master at 700,300 if tab == "audio"
  slider music at 700,380 if tab == "audio"
  button text_sounds at 700,300 "Text sounds: [text_sounds]" action cycle if tab == "game"
  button auto_speed at 700,400 "Auto: [auto_speed]" action cycle if tab == "game"
```

A screen named `saves` replaces the stock save and load screen (Esc still closes it; opened from the title, the pause menu or the quick menu).
The shell fills in these variables, and two lists to draw with `each`:

- `mode` (`"save"` or `"load"`), `page` (the current page id) and `deleting` (true in delete mode).
- `pages`: the page ids, `page1`..`page9`, plus `pageauto`, `pagequick` and `pagechoice` in load mode. In `each pages as pg`, `[pg.name]` is the page's label.
- `slots`: the slot ids of the current page. In `each slots as slot`, `[slot.title]` ("Slot 3", "Quick"), `[slot.when]` (date and time, empty for an empty slot),
  `[slot.text]` (the saved line, or "Empty") and `slot.empty` (true/false) are filled from the save.
- `button <id> ... action slot` saves into that slot (asking before overwriting) or loads it (asking first while a game runs), as the mode says. In load mode an empty
  slot does nothing, so use `enabled mode == "save" or not slot.empty` to grey it out. In delete mode it asks to delete the slot instead (auto, quick and choice saves cannot be deleted).
- `button <id> ... action page` opens that page. `action delete` turns delete mode on and off, and `action close` goes back.

```
screen saves:
  each pages as pg at 100,50 step 140,0:
    button pg at 0,0 "[pg.name]" action page
  each slots as slot at 100,200 step 0,110:
    button slot at 0,0 size 1100,96 "[slot.title]  [slot.when]  [slot.text]" action slot enabled mode == "save" or not slot.empty
  button del at 1400,200 "Delete" action delete if mode == "save"
  button done at 1400,900 "Back" action close
```

A screen named `history` replaces the stock history panel (opened from the quick menu, `L` or the pad's Select; Esc still closes it).
The shell fills in these variables:

- `lines`: the ids of every line passed, oldest first (up to about 500). In `each lines as ln`, `[ln.name]` is the speaker (empty for narration) and `[ln.text]` the line.
- `total`: how many lines there are.
- `action close` goes back. Put the list in a `scroll` (below); `start bottom` opens it at the newest line.

```
screen history:
  scroll at 160,140 size 1500,760 start bottom:
    each lines as ln step 0,120:
      text at 0,0 "[ln.name]" if ln.name != ""
      text at 0,44 "[ln.text]"
  button done at 1500,960 "Back" action close
```

A screen named `gallery` replaces the stock gallery (Esc still closes it). Open it from a project title screen with `action gallery`
(disabled when `game.json` lists no gallery images). The shell fills in:

- `tiles`: one id per `gallery` entry of game.json, in order; `count` (unlocked) and `total`.
- In `each tiles as t`: `[t.title]` (the entry's title, or the locked word for a locked tile), `t.unlocked` (true/false) and `[t.file]` (the picture's file under
  `assets/`, empty for a locked tile or a missing file), so `image "[t.file]" size 320,180 if t.unlocked` draws the thumbnail.
- `button <id> ... action tile` opens the viewer on that tile (the stock one, or your `screen viewer` below; Esc returns, and focus comes back to the tile).
  A locked tile does nothing, so add `enabled t.unlocked`. `action close` goes back.

```
screen gallery:
  scroll at 160,160 size 1600,700:
    grid 4 gap 24:
      each tiles as t:
        button t size 360,240 "[t.title]" action tile enabled t.unlocked
  text at 160,60 "[count] / [total]"
  button done at 1500,960 "Back" action close
```

A screen named `viewer` replaces the stock picture viewer that a gallery tile opens (the stock one fills the stage with the picture and pages with the
arrow keys; with your screen the arrows move focus like on any screen, so give it buttons). It is drawn over a black backdrop, so draw the picture yourself.
The shell fills in `file` (the picture's file under `assets/`, empty when there is none), `title`, `position` (1-based) and `total` (the unlocked pictures).
`action next` and `action prev` show the neighbouring picture (wrapping around) and redraw the screen; `action close` (or Esc) returns to the gallery.

```
screen viewer:
  image "[file]" at 0,0 size 1920,1080
  text at 80,40 "[title]  [position] / [total]"
  button prev at 80,960 "<" action prev if total > 1
  button next at 1700,960 ">" action next if total > 1
  button done at 1500,960 "Back" action close
```

A screen named `music` replaces the stock music room and one named `chapters` the stock chapter select (Esc still closes them). Open them from a project
title screen with `action music` and `action chapters` (disabled when `game.json` has no `musicRoom` / `chapters` entries). The shell fills in:

- `music`: `tracks` (one id per `musicRoom` entry), `count` (unlocked), `total` and `now` (the title of the track playing, empty for none). In `each tracks as t`:
  `[t.title]` (the locked word for a locked track), `t.unlocked` and `t.playing`. `action track` plays that track, `action stop` goes back to the title music,
  `action close` leaves (the title music returns too). A locked track does nothing, so add `enabled t.unlocked`.
- `chapters`: `chapters` (one id per entry), `count` and `total`. In `each chapters as c`: `[c.title]` and `c.unlocked`. `action chapter` starts a new playthrough at
  that chapter's label, `action close` goes back.

A screen named `achievements` replaces the stock achievements list (open it from a project title screen with `action achievements`, disabled when
`game.json` has no `achievements`), and one named `achievement_toast` replaces the notice that pops up on an unlock. The shell fills in:

- `achievements`: `achievements` and `endings` (one id per entry of each kind), `count` / `total` (achievements unlocked / all) and `endings_count` /
  `endings_total`. In `each achievements as a` (or `each endings as e`): `[a.title]` (the hidden word, "???", for a hidden one still locked),
  `[a.description]` (empty while hidden), `a.icon` (the icon's file, for `image "[a.icon]"`; empty without one), `a.unlocked`, `a.hidden` and `a.ending`.
  `action close` goes back.
- `achievement_toast`: `title`, `description`, `icon` and `ending` for the one being shown. It takes no input and needs no buttons; place it with
  `at` (game.json's `achievementToast.position` only moves the stock toast). It stays for `achievementToast.seconds`.

```
screen achievement_toast:
  image "[icon]" at 1380,40 size 96,96 if icon != ""
  text at 1500,40 "Ending reached" if ending
  text at 1500,40 "Achievement unlocked" if not ending
  text at 1500,90 "[title]"
```

```
screen music:
  scroll at 160,160 size 1600,600:
    column gap 12:
      each tracks as t:
        button t size 800,72 "[t.title]" action track enabled t.unlocked
  text at 160,60 "[now]" if now != ""
  button s at 1200,960 "Stop" action stop
  button done at 1500,960 "Back" action close

screen chapters:
  column anchor center gap 16:
    each chapters as c:
      button c size 700,80 "[c.title]" action chapter enabled c.unlocked
    button done "Back" action close
```

`if <expr>` hides an element; `enabled <expr>` greys it out. Both read the story's variables (no `random()`). Labels and
`text` strings get localization ids from `npm run ids`. Mouse, arrow keys and the d-pad all work: arrows move to the
nearest enabled element in that direction, Enter or A chooses. A screen with nothing to choose returns `""` at once.
```
show screen map as place
if place == "cafe":
  jump cafe
```

### scroll
`scroll at x,y size w,h [start top|bottom] [bar off] [if <expr>]:` is a box that clips its children and scrolls them when they are
taller than the box. The children are placed from the box's top left (`at 0,0` is its corner), so a `column`, a `grid` or an `each`
inside it works as usual; the content height is where the lowest child ends (text counts about 48px a line), and a box
whose content fits does not scroll. The mouse wheel, touch, the scroll bar, Tab and the arrow keys or d-pad all work: focus moves
to an element and scrolls it into view, and a scroll area that has focus itself scrolls on up/down before focus moves on.
`start bottom` opens it at the end (a chat log), and a redraw keeps the position (a list that was at the end stays there).
`bar off` hides the scroll bar.

```
scroll at 100,200 size 900,600:
  grid 3 gap 20:
    each bag as item:
      button item "[item.name]"
```

A scroll goes directly in the screen (not inside `each`, `row`, `column`, `grid` or another scroll) and can hold `image`,
`text`, `button`, `rect` and `ellipse` hotspots, layouts and `each`; `poly` and `mask` hotspots and sliders cannot be inside one.
`each <list> as <name> limit n` draws at most n entries when you want a hard cap.

### row / column / grid
`row`, `column` and `grid <columns>` inside a screen place their children one after another, so buttons and text need no
`at`. The container goes at `at x,y` or pinned to the stage with `anchor <place> [margin m]` (`topleft top topright left center
right bottomleft bottom bottomright`). `margin` is the distance from the stage edges and `padding m` the room kept inside the container around its children;
each is one number for all sides, `v,h` or `top,right,bottom,left` (no spaces: `margin 20`, `padding 12,24`, `margin 0,0,60,0`). `gap n` spaces the children, `align start|center|end` sets how they line up across the
direction (in a grid, inside the cell), and a grid's `cell w,h` fixes the cell size (default: the biggest child). Containers nest
(an inner one is placed by its parent, so it takes no `at`/`anchor`) and an `each` inside spreads its entries, which makes an
inventory list. `if` hides a whole container or one child, and the rest close up.

```
screen shop:
  column at 80,160 gap 16:
    text "Your bag"
    each bag as item:
      button item "[item.name]"
  row anchor bottomright margin 40 gap 20:
    button buy "Buy"
    button leave "Leave"
```

Sizes: a button is its `size` or fits its label; `text` is guessed at 24px a character and 48px a line, so a layout keeps a
little extra room around long text; an `image` and a `hotspot` need `size w,h` (a hotspot may be a rectangle or an ellipse;
`poly` and `mask` keep absolute coordinates, so use them outside a container).

### hud
`hud on <screen> [keep]` puts a declared screen up beside the story, and `hud off <screen>` takes it down. It stays while
lines, effects and `scene`s go by (a `scene` clears it unless it was shown with `keep`), is redrawn before every line so
`[variables]`, `if` and `enabled` stay current, and is kept in saves, rollback and hot reload. It sits over the scene and
under the text box. A screen can be both: `show screen` (waits) and `hud on` (does not).

An element does something only through an `on click <label>` clause: choosing it (mouse, Enter, pad A) calls that label like
`call`, and `return` goes back to the line that was interrupted, which is shown again from the start. Elements without
one are drawn but inert, which is how readouts and decoration work.

```
screen status:
  text at 40,30 "Coins: [coins]"
  button purse at 1620,30 size 260,80 "Purse" on click open_purse

label start:
  hud on status
  alice: Click the purse whenever you like.

label open_purse:
  set coins += 1
  alice: You find a coin. Now you have [coins].
  return
```

The event is taken at a safe point, just before a line, menu, input or `show screen`: never in the middle of a sentence or a
menu. A click during a menu, an input, a blocking screen or the pause menu is dropped (the HUD does nothing then), and so is
one while another event's label is still running. The click is recorded with the other answers, so saves and rollback replay
it at the same point. After a click the HUD gives focus back to the story, so Space still advances. From the keyboard,
Shift+Tab focuses the HUD (arrows move, Enter chooses, Shift+Tab or Backspace leaves); on a pad, click the right stick, and
B leaves. `mask` hotspots work in a HUD too: only the opaque pixels of the PNG count (the image loads in the background, so it
hits nothing for a moment), and a click anywhere else goes on to the story.

`on focus <label>` and `on blur <label>` run when an element gains or loses focus. There is no separate "mouse enter":
pointing at an element focuses it, and so do Tab, the arrows and the pad, so one event serves every device. They are
taken and recorded like a click. A handler that only changes state (`set`, `unlock`, `hud on|off`, `if`/`else`, ending in
`return`) is *quiet*: it runs on the spot and the line on screen is left alone. Any other handler (a line, a menu, an
effect, a `jump`/`call`) ends the line first and brings it back after `return`, so keep those short. This holds for `click`
too. Moving from one element to another gives a `blur` then a `focus`. Handing focus
back to the story after a click is not a `blur`, and a redraw (a changed `[variable]`) is not a focus change.

```
button purse at 1620,30 size 260,80 "Purse" on click open_purse on focus purse_hint
```

## Persistent flags and data

### persistent
`set persistent.<name> <op> <expression>` stores a number, text or true/false across all playthroughs (counters,
names, per-route progress). Read it as `persistent.<name>` in expressions and as `[persistent.<name>]` in text; unset
values read as 0 in expressions (text shows `[persistent.<name>]` as written). It uses the ordinary `set` operators, so `set persistent.deaths += 1` just works.

Why a namespace instead of extending `unlock`: `unlock` can only say "this happened" (a boolean), while `set` already
has the operators and the expression language; a `persistent.` prefix next to `unlocked.` reuses both and needs no new
command. Same rule as the flags: a playthrough sees the values as they were when it started plus its own changes, and
saves remember that starting set, so loading or rolling back replays the same branches; changes are stored at once.

```
set persistent.deaths += 1
if persistent.deaths >= 3:
  "You have been here before. [persistent.deaths] times."
set persistent.playerName = name
```

### unlock
`unlock <flag>` stores a flag across all playthroughs (endings, extras). Read it as `unlocked.<flag>`; flags can
also unlock gallery images (see the README), and a flag listed in game.json's `achievements` unlocks that achievement
and pops up its toast.

```
unlock good_ending
if unlocked.good_ending:
  "You remember the other ending."
```

## Editor keys

Keys of the editor at `/editor/` (Ctrl+P, then `>`, lists every command with its key).

| Key | Does |
|---|---|
| Ctrl+P | palette: files; `@` labels, `:` lines, `#` assets, `>` commands (works with focus anywhere, also in the preview) |
| F1 | this reference, at the statement under the cursor |
| Ctrl+Enter | preview from the cursor line |
| Alt+1 / Alt+2 / Alt+3 | focus the editor / the preview (play the game with the keyboard) / the Files panel filter (work from anywhere) |
| Ctrl+M | Tab moves focus out of the script instead of indenting; Ctrl+M again makes Tab indent again |
| Ctrl+B | show or hide the Files panel (scripts as a folder tree; the hover icons on headings and folders make a script or folder or add files, drop files on the assets list too; right-click or Shift+F10 on a row for its menu, see the README; F2 renames or moves the row, Delete deletes it) |
| Ctrl+S | save (edits are also saved by themselves) |
| Alt+W | close the tab |
| F2 | rename the label or variable under the cursor everywhere |
| Shift+F12 | list every use of the label or variable under the cursor (the same set F2 renames) |
| Ctrl+Shift+F | find and replace in all files (starts from the selection, else the word under the cursor) |
| F12 | on an `animate <char> <name>` line: open that animation in the character's Animation studio (Esc returns to the line; its "Try in scene" button applies the changes, saves, and plays the game from that line) |
| Ctrl+. | quick fix ("did you mean") on a marked name |
| F8 / Shift+F8 | next / previous problem |
| Alt+Z | toggle word wrap |
