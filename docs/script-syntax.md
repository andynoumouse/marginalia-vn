# Script syntax overview

A cheat sheet of the script language. Every command with examples is in [commands.md](commands.md).

Scripts live in `script/*.vn` and compile together: labels are global. In the sample, `park.vn` owns the `start` label.
Two other sample scripts are tours: `games/sample/script/demo.vn` shows input, flash, tint, camera, weather, filters and
text tags, and `games/sample/script/animations.vn` covers every animation feature. Open one in the editor and press
Ctrl+Enter (Preview from cursor) on a line or a label such as `label animation_showcase:`.

## Characters, scenes and staging

```
define alice "Alice" color=#ff6fa5      # character; optional style (see look-and-feel.md)
set trust = 0                           # top-level lines run once before the story starts
label start:                            # entry point is "start" (or the first label)
  scene bg_park fade 0.5                # transitions: cut | fade | dissolve | wipe <left|right|up|down> | iris | blinds | pixelate; dissolve mask=<image in assets/transitions>
  music play theme loop  /  music stop fade 1s  /  music pause  /  music resume
  show alice smile at left fade 0.3s     # look(s), at left|center|right|0-1|a game.json position, slot=variant overrides
  show alice smile at 0.35 y=0.02 scale=1.1 flip=on   # place without a slide (the animation studio's Place row writes it)
  show bob at right behind=alice  /  show alice order=front|back   # draw order (else the order of first show, newest in front)
  move alice to right 0.6s ease=out      # ease: linear | in | out | inout | back | bounce | elastic ; add `nowait` to run in background
  move alice scale=1.2 rot=-5 y=-0.03 0.4s   # size, tilt, lift, alpha=, flip=on|off, anchor=feet|center|head|0.5,0.3 (the pivot)
  shake alice 0.3s strength=6   hop alice 0.25s   wait 0.5s   sound play door duck   # duck: the music dips under it
  sound loop rain fade 2s  /  sound stop rain fade 3s   # looping ambience on its own channel (`sound stop` alone ends all)
  movie play opening noskip                           # a fullscreen cutscene, assets/movie/opening.webm|mp4 (loop: repeats until skipped)
  animate alice breathe loop  /  animate alice nod  /  animate alice stop   # breathe bob sway nod shiver pulse bounce hop shake, or a rig.json animation; part=hair moves one part
  animate robo pose=happy  /  animate robo look_x=0.6 mouth=0.8 over 0.4   # tween a rig's parameters or a pose (show robo pose=happy sets one)
  flash [#ffffff] [0.4]                 # screen flash that fades out
  tint #203060 0.4 1.5s  /  tint off      # colour wash over the scene: color, strength 0-1, seconds (lasts until `scene`)
  focus off  /  focus on                 # speaker focus (game.json "speakerFocus" dims who is not speaking): off for a group scene
  image show letter cg/letter at 960,540 anchor=center fade 0.4s  /  image move letter to 960,300 0.5s  /  image hide letter   # overlay pictures: assets/ path, stage pixels, layer=-1 behind characters, fixed, keep; a file in assets/movie plays as a looping video
  camera zoom 1.5 at left y=0.4 0.8 ease=out  /  camera pan right 1  /  camera reset 0.5   # zoom about a point, slide it, reset; resets on `scene`
  weather rain|snow|petals|embers [0.6] [1]  /  weather off      # falling particles: intensity 0-1, fade-in seconds
  wind right|left [0.5] [gusts=0.4] [1]  /  wind off   # blows on physics chains (hair, ribbons): strength 0-2, gustiness 0-1, build-up seconds
  gravity 0.3  /  gravity reset         # how hard weather and bursts fall: 1 normal, 0 none, negative up
  filter blur|grayscale|sepia|night|vignette [1] [0.8]  /  filter off   # a look over the scene: strength 0-1, seconds
  nvl on  /  nvl clear  /  nvl off      # full-screen narration pages instead of the text box; a new page on clear or scene
  textbox hide                          # hide the text box until the next line
```

## Dialogue and text

```
  alice: Hello.{pause=0.4s} [name]        # {i}{/i} {b}{/b} {pause=s}, [variable]
  alice: {color=#ff6fa5}Pink{/color}, {size=1.5}big{/size}, {wave}wavy{/wave}, {shake}shaky{/shake}, {ruby=kan}漢{/ruby}
  alice: Wait for it...{wait} there.{nw}   # {wait} stops until a click; {nw} goes on without one
  "Narration line."
```

## Choices and conditions

```
  menu "Optional prompt line" style=urgent timeout 8:   # style= (a theme style) and timeout are optional: seconds to answer; needs the on timeout block below
    "Option" if trust >= 1:             # optional condition; add  else "Reason shown"  to show it disabled instead of hiding it
      set trust += 1
      jump other
    on timeout:                         # what happens when time runs out (Options can extend or remove the clock)
      jump caught
  if trust >= 2:  ...  elif ...:  ...  else:  ...
  input name "What's your name?" default="Alex" max=16   # asks the player; stores text in [name]
```

## Screens and interface

```
  screen map:  /  hotspot cafe at 300,300 size 360,200 "Cafe"  /  button back at 80,940 "Back"   # declare a page
  column at 80,200 gap 20: / row anchor topright: / grid 3:   # inside a screen: place buttons without pixel maths
  toggle lamp_on lamp at 420,380 "Lamp"  /    if page == "light"  /    on focus set tip = "Warm"   # a long element line goes on over deeper-indented lines that start with a clause word (on, if, enabled, hover, ...)
  hotspot strip at 0,0 size 1920,40 on focus bar_open on blur bar_close:  # a trailing colon gives it child elements (stage coordinates) that share its focus: strip -> child is no blur
  panel at 560,200 padding 48 image "ui/frame.png" slice 40:   # a 9-slice framed box; its children sit inside it (no size: it fits them)
  bar hp max 100 at 80,90 size 480,44 back "ui/back.png" fill "ui/fill.png" readout   # a stat bar that follows a variable
  show screen map as place              # waits; the chosen element's id is stored in [place] (screens take parameters: show screen room("hall") as place)
  screen options:  /  slider master at 700,300  /  button text_sounds at 700,400 "Sounds: [text_sounds]" action cycle   # replaces the default options (also `saves`, `title`, `pause`, `history`, ... and `quickmenu`: the defaults are screens too); `action tab` switches the variable `tab`
  state page = "items"  /  tab items page=items at 80,60 "Items"  /  button tip at 80,200 "?" on focus set page = "help"   # local screen state (gone when the screen closes) that tabs and hover handlers change; the screen redraws
  screen settings(inout sound, inout mode):  /  toggle snd sound at 80,100 "Sound"  /  radio easy mode=easy at 80,200 "Easy"  /  cancel [keep]   # inout copies story variables in and writes them back on an answer: show screen settings(sound, mode) as pick
  hud on status  /  hud off status      # a screen that stays up while the story runs; its `on click label` elements call that label; `hover "img.png"` on a hotspot swaps in art while it is hovered
```

## Flow, variables and persistence

```
  define item key "Brass key"           # name for list entries (set bag += "key")
  call helper  /  return  /  jump label  /  end
  label shop(item, cost):  /  call shop("sword", 10)   # parameters are local to the call (restored at return); arguments are expressions
  unlock good_ending                     # persistent flag (all playthroughs); read it as unlocked.good_ending
  if unlocked.good_ending:  ...
  set persistent.deaths += 1             # persistent number/text/boolean (all playthroughs); read it as persistent.deaths
  set roll = random(1, 6)  /  set line = pick("Hi", "Hey")  /  if chance(30):  ...   # seeded; replays identically on load and rollback
  set bag = []  /  set bag += "key"  /  if contains(bag, "key"):  ...   # lists: contains, count, item, index, pick(list)
```

## Localization ids

Lines get a trailing id like `#a3f9` (menu options: `"text" #a3f9:`). `npm run ids` adds them.
The script is the source language; other languages live in `locale/<lang>.json` as `{ "a3f9": "..." }`.
In the editor, **Translations** (Ctrl+P, then `>`) lists every string with its speaker, file and line beside the chosen
language, saves what you type to `locale/<lang>.json`, starts a new language, filters to what is untranslated and exports a
CSV with that context for translators. The list is virtual, so it stays fast with tens of thousands of strings.
