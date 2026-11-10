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

Name layers for what they are, since you use the names in the script (letters, digits and `_`; the converter renames `Group 1` to `Group_1`, see [Names](../../art-pipeline.md#names)). Group parts that should move together into a
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
show mina smile at center fade 0.3s
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
  angle or mouth open, key forms, mesh warps, bone weights and physics for hair and cloth.
- **Animate**: a timeline of keys. An animation can also be **automatic** (`auto` in `rig.json`): a blink that repeats
  every few seconds, a mouth that moves *while speaking*, a breathing loop that is always on. **Reactions** hold a
  pose while a script condition is true (a blush while `affection > 3`). The **Place in scene** section drags the
  character where it should stand and writes the `show` line.

Animations you save in `rig.json` are played from the script by name:

```vn
animate mina wave
```

and the studio can export a movie as a PNG sequence with transparency.

### A part that bends

A bone turns its parts as stiff pieces, so a sleeve drawn over the elbow would crease. To make one part bend along the
bones instead (a sleeve, a tail, a lock of hair), give it a mesh and weights in Model mode:

1. Choose the part in the Parts tree and press **D** (the **Warp** tool): Properties opens **Deform**; press **Generate mesh** in its Mesh row.
2. Press **B** (the **Weights** tool). Properties opens **Skin**: choose the bones that may move the part from its **Bind ▾**, then press **Auto-weights**:
   every vertex gets a share of each bone by how near it is. The stage shows the active bone's share as heat on the mesh.
3. Fix it by hand with the brush in the tool options bar over the stage (**Add**, **Subtract**, **Replace**, **Smooth**; **[** and
   **]** size it) or by typing numbers for selected vertices (**Select**, then **Set value**).
   **Test pose** turns the bone with a gizmo without keying anything, so you can look at the bend while you paint.
4. **Apply**, as always. A `wave` that turns the forearm now bends the sleeve at the joint.

The demo's robot does this with its left sleeve; the sample's Mina wears her back hair as one weighted mesh on strand bones
that physics swings. The reference is [Skinning](../../rig-json.md#skinning).

## Where to look next

- `games/demo/` has a layered robot character (`assets/char/robo/`) with a rig, parameters, poses, a mesh warp on the
  torso, a skinned sleeve and animations to open in the studio. The Rigs page of its feature index (New game) plays them from the script.
- [rig-json.md](../../rig-json.md) is the full reference for looks, bones, parameters and animations.
- A flat-image character can use `animate` presets and `move`; see [staging](b-staging.md).
