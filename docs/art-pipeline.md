# Art pipeline (PSD masters)

PSD files in `masters/` are converted to game-ready art in `assets/`. `npm run art` converts the changed ones
(`--force`: all), and `npm run dev` also watches `masters/`. Hand-made images work too: see
[Plain images](#plain-images-without-psds).

```
masters/bg/<name>.psd     ->  assets/bg/<name>.png              (scene <name>) flattened, scaled to cover 1920x1080
masters/char/<char>.psd   ->  assets/char/<char>/sprite.json    + one trimmed PNG per part
masters/ui/<name>.psd     ->  assets/ui/<name>.png              (theme frames) flattened at 1:1
```

Save backgrounds with "Maximize compatibility" so Photoshop's own composite is used. A missing converted file is
drawn as a placeholder, and changed files hot-reload.

## Character PSD layout

The canvas height becomes the 1080 px stage height; keep the feet near the bottom.

```
eyes/                     top-level group = a slot
  smile, happy            a variant; extra names are tags: `show alice happy` picks it (an implicit look)
  open, neutral, annoyed  the visible child is the slot's default
  closed
mouth/  ...
shading  (clipped)        top-level layers are always drawn; clipping masks merge into their base
+body/                    a "+" group is a folder, not a slot: its layers are drawn like top-level layers
  arms
  torso
body
_sketch                   names starting with _ (and hidden top-level layers) are skipped
```

- `show alice smile` picks, per slot, the variant named or aliased `smile`, else the slot's default.
- `show alice smile eyes=closed` overrides one slot; `glasses=none` empties one.
- A variant may be a group. It is flattened, and masks, clipping, opacity and common blend modes inside it are
  honoured. Layer effects are not rendered, so rasterize them.
- The folder prefix is `"psdPrefix"` in `game.json` (default `"+"`; `""` turns folders off).
- The converter writes the folders a part sat in to `sprite.json` as its `group` (`"head"`, or `"arm/forearm"` for nested
  folders). The generated starting `rig.json` makes a bone of each folder, parented along the path, with the folder's
  parts on it; pivots are left for you to place in the studio's Model mode.
- Unknown poses and variants are reported in the preview's console.

## rig.json

Z-order tweaks, looks and groups go in a hand-written `assets/char/<name>/rig.json` next to the generated
`sprite.json`. The converter never touches it, and it is read when the game starts. The full reference is
[rig-json.md](rig-json.md) (also F1 in the `rig.json` tab).

```json
{
  "order": ["body", "outfit_back", "hair", "outfit_front"],
  "bones": { "head": { "pivot": [270, 380] } },
  "parts": { "hair": { "bone": "head" } },
  "looks": { "shy": { "look": "smile", "blush": "on" }, "casual": { "outfit_back": "casual", "outfit_front": "casual" } }
}
```

- `order` lists part names (a slot, or a plain layer's file name without `.png`) bottom to top. The listed parts
  swap among the positions they already hold; the rest stay put.
- `bones` and `parts` put parts on a tree so an animation can move them as one piece (a key naming a bone carries what hangs on it).
- `show alice shy` expands to the look's slot variants, and `show alice shy blush=none` lets the line win over the
  look. Several looks apply left to right: `show alice shy casual`.
- A bare word that is no look still works when a PSD variant is named or tagged with it (`show alice smile` picks
  `smile` in every slot that has one). A look wins over a PSD name of the same word.

## Plain images (without PSDs)

- Backgrounds: `assets/bg/<name>.png|webp|jpg`.
- Unlayered characters: `assets/char/<char>/<pose>.png|webp` (pose `default` when omitted).

Missing art is checked as described in [checks-and-tools.md](checks-and-tools.md#checking-art-and-audio).
