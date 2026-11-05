# Look and feel

## Character styles

`define` takes style options after the name:

```
define alice "Alice" color=#ff6fa5 text=#ffe6f0 font="Georgia" size=1.1 italic speed=0.8 blip=blip_hi style=alice
define cat "Cat" focus=off               # never dimmed by speaker focus
define mina "Mina" side=mina             # portrait in the text box (game.json "sideImages"; assets/side/mina.png)
define narrator "" text=#d8d2c0 italic   # style for "quoted narration" lines
define thought "" italic                 # thought: ... shows no name tag
```

| Option | Meaning |
|---|---|
| `color` | Name tag color |
| `text` | Text color |
| `size`, `speed` | Multipliers for text size and typing speed |
| `font` | A font name, or a file from `assets/fonts/` |
| `italic` | Italic text |
| `focus=off` | Never dimmed by speaker focus |
| `blip` | A text sound voice (see below) |
| `style` | A style from the theme's `styles` (`box` is the old name) |
| `side` | A portrait shown in the text box while the character speaks. Opt in with `"sideImages": true` in `game.json`; `assets/side/<name>_<pose>.png` follows their pose on stage |

## Text sounds (blips)

Blips are optional sounds while a line types, as in courtroom games. `blip=` takes:

- a built-in synthesized voice (`high`, `mid`, `low`, `soft`, `typewriter`, `robot`; no files needed),
- a voice from `"blips"` in `game.json`, or
- any `assets/sound/<name>` sample.

`blip=none` silences a character. Players can turn text sounds off in Options; they play on the Sound volume.
Skipping and instant text are silent.

```json
"blips": {
  "alice":  { "synth": "square", "pitch": 760, "variation": 1, "every": 2 },
  "bob":    { "sound": "blip_bob", "interval": 70 },
  "kiki":   { "mode": "vowels", "vowels": { "a": "kiki_a", "e": "kiki_e", "i": "kiki_i", "o": "kiki_o", "u": "kiki_u" } },
  "droid":  { "synth": "sawtooth", "pitch": 150, "mode": "vowels" }
}
```

| Key | Meaning |
|---|---|
| `mode` | `letters` (default) blips per letter; `vowels` blips only on vowels, each at its own pitch or with its own sample |
| `synth`, `pitch` | Synthesized waveform and its pitch |
| `sound` | A sample from `assets/sound/` |
| `every` | Blip on every Nth letter |
| `interval` | Minimum milliseconds between blips (default 55) |
| `variation` | Random pitch spread in semitones |
| `volume` | 0-1 |
| `length` | Synth blip length in milliseconds |

## Theme

`theme` in `game.json` is all optional. Sizes are pixels on the stage (1920x1080 by default; see `stage` in
[game-json.md](game-json.md)). The editor completes and checks it.

```json
"theme": {
  "accent": "#5fd1c3", "font": "Georgia",
  "textbox": { "x": 160, "y": 774, "width": 1600, "height": 250, "padding": [44, 56, 36, 56],
               "background": "rgba(10,13,19,.84)", "border": "#ffffff24", "radius": 8,
               "image": "textbox", "slice": 32 },
  "namebox": { "x": 40, "y": -26, "size": 34, "background": "#20252f" },
  "text":    { "size": 44, "color": "#e6e9ef", "lineHeight": 1.45, "lines": 3 },
  "choices": { "width": 1000, "size": 40, "gap": 22, "radius": 8, "image": "button", "slice": 24 },
  "skins":   { "alice": { "textbox": { "image": "textbox_alice" }, "text": { "color": "#ffe6f0" } } }
}
```

`image` frames come from `masters/ui/<name>.psd` (converted 1:1 to `assets/ui/<name>.png`) and stretch as 9-slice:
`slice` pixels of each edge keep their size. Fonts in `assets/fonts/` (woff2, woff, ttf, otf) can be used by file
name in `font` and in `define ... font=`.
