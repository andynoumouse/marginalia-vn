# Layered characters and animation

A flat sprite is one image per pose. A **layered character** is a Photoshop (PSD) file whose layers the engine keeps
apart: eyes, mouth, hair, clothes. You choose a variant for each, and the animation studio can bend and move the
parts. This page is the route from a PSD to a character that blinks, in four steps. The references are the
[art pipeline](../../art-pipeline.md) and [rig.json](../../rig-json.md).

## 1. Lay out the PSD

Save the file as `masters/char/<name>.psd`. The canvas height becomes the 1080 pixel stage height; keep the feet near the
bottom. Top-level layers are always drawn. A top-level **group** is a *slot*, and each layer in it is a *variant* of it:

```
eyes/                     a slot
  open, closed, happy     variants; the visible one is the default
mouth/
  neutral, smile
hair
body
_sketch                   names starting with _ are skipped
```

Name layers for what they are, since you use the names in the script. Group parts that should move together into a
folder that starts with `+` (`+head/`, `+arm/`), which becomes a bone. Save with *Maximize compatibility*.

## 2. Convert it

```bash
npm run art
```

(`npm run dev` does this by itself when a master changes.) The converter writes `assets/char/<name>/`: one trimmed
PNG per part and a `sprite.json` describing them. The editor's palette has *Reconvert All Art*, and the online demo
converts a PSD you drop on it on the spot.

## 3. Show it

Variants are chosen by name in `show`:

```vn
show mina smile at center fade 0.3
show mina smile eyes=closed
show mina glasses=none
```

A bare word picks the variant of that name in every slot that has one. `slot=variant` overrides one slot, and
`glasses=none` empties it. To name a combination, add it to a hand-written `rig.json` next to `sprite.json`:

```json
{
  "looks": {
    "shy": { "eyes": "happy", "mouth": "smile" }
  }
}
```

then `show mina shy`. The converter never touches `rig.json`.

## 4. Animate it

Presets work on any character, flat or layered:

```vn
animate mina breathe loop
animate mina nod
animate mina stop
```

For a layered one, open the **animation studio** from the editor (the Character: Animation Studio command in the
palette), or open a character folder on its own with *Open Character...* in Marginalia Studio, which needs no game
project: [standalone studio](../../standalone-studio.md). It has two modes:

- **Model**: set up the character: bones and their pivots, which parts hang on which bone, parameters such as head
  angle or mouth open, key forms, mesh warps and physics for hair and cloth.
- **Animate**: a timeline of keys. An animation can also be **automatic** (`auto` in `rig.json`): a blink that repeats
  every few seconds, a mouth that moves *while speaking*, a breathing loop that is always on. **Reactions** hold a
  pose while a script condition is true (a blush while `affection > 3`). The **Place in scene** section drags the
  character where it should stand and writes the `show` line.

Animations you save in `rig.json` are played from the script by name:

```vn
animate mina wave
```

and the studio can export a movie as a PNG sequence with transparency.

## Where to look next

- `games/demo/` has a layered robot character (`assets/char/robo/`) with a rig, parameters, poses, a mesh warp on the
  torso and animations to open in the studio. The Rigs page of its feature index (New game) plays them from the script.
- [rig-json.md](../../rig-json.md) is the full reference for looks, bones, parameters and animations.
- A flat-image character can use `animate` presets and `move`; see [staging](b-staging.md).
