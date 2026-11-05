# Design notes: existing 2D character rig formats

Background for the part hierarchy and mesh-warp items in `TODO.md`; a survey, not a decision. Written from memory of
these projects, so check each one's current status and license before relying on it.

## Where the rig stands today

Layered characters (`sprite.json` from a PSD plus `rig.json`) have flat parts: slots with swappable variants, plain
layers, `order`, `groups` as lists of parts, per-part `pivots`, and keyframe animations whose keys can name a `part`.
A group moves its members as one piece, and a member's keys add to the group's. There is no parent/child transform
inheritance and no mesh deformation. Everything is rigid.

## Formats and runtimes

| Format | Openness | Model |
|---|---|---|
| **Spine** (Esoteric Software) | JSON and binary formats are documented; runtimes need a Spine editor license | Bone hierarchy, slots holding attachments, skins, weighted meshes, IK and other constraints, per-property timelines with curves. The de facto interchange format; an official PixiJS runtime exists. |
| **DragonBones** | MIT format and runtimes, Pixi included | The same bone and slot model as Spine. Development has largely stalled as far as I know. |
| **Inochi2D** | Open source (BSD), published `.inp` format | Live2D-style puppets: meshes with deformers driven by named parameters (head angle, mouth open). Editor: Inochi Creator; a Rust runtime (Inox2D). No mature Pixi runtime that I know of. |
| **Rive** | MIT runtimes; the editor is a hosted product | Vector bones plus state machines. A solid web runtime, but not built around PSD-sliced art. |
| **Spriter (SCML)**, **Creature** | Partly open, small ecosystems | Bone or mesh animation, less used now. |
| **Live2D Cubism** | Proprietary (`.moc3`; closed Core runtime with bundling limits) | Parametric mesh warp. Community Pixi wrappers lag Pixi's releases. |

Not rigs for this purpose: Lottie (an open spec, but vector motion graphics), glTF and VRM (3D).

No formal standard (ISO, W3C) covers 2D skeletal characters. Spine's data model is the closest thing to a common
vocabulary.

## Concepts they share, and how they map here

| Concept | In those formats | In this engine |
|---|---|---|
| Bone hierarchy | A child inherits its parent's transform | Missing (flat groups only) |
| Slots and attachments | A slot shows one of several attachments | Slots and variants |
| Skins | Named sets of attachments (outfits) | Poses and `rig.json` shorthands |
| Weighted meshes | One image bends under several bones | Missing (mesh-warp item) |
| Constraints | IK, sometimes physics for hair and cloth | Missing |
| Timelines | Per-property keys with easing | Keys with `t` and `ease` |
| Parameters | Named values driving several deformers (Live2D, Inochi2D) | Missing; a script could set one (`look=left`) |

## Considerations

- For the **hierarchy**, Spine's model is the best documented and the most imitated. The decision is that it replaces
  flat groups for moving parts together. Groups also serve as dressing sets (`outfit=casual` sets several slots), which
  Spine covers with skins, so that job moves to outfits: named maps from slot to variant.
- Three separate things, as in Spine: bones (transform nodes, no image needed), parts (drawn layers and slots, each on
  one bone, with a draw order independent of the tree) and outfits (which variant each slot shows). An outfit cuts
  across the tree, so it is neither a subtree nor a tag on parts.
- Outfits as an explicit map (`"casual": { "top": "tee", "bottom": "jeans" }`): variant names may differ per slot, an
  outfit may cover only some slots (the rest keep what they show, as a Spine skin falls back for slots it does not
  cover), `slot=variant` on the `show` line still wins, a slot may map to `none`, and unknown slots or variants are
  check-time errors. Poses and shorthands are already named slot-to-variant maps, so they merge with outfits into one
  concept (working name "look"): a map that covers every slot or only some, with one `rig.json` key replacing `poses`
  and the outfits. Stacking outfits (Spine 4 combines skins) is decided as expansion: applying an outfit writes
  its slot map into the slot overrides, so the last one applied wins per slot and no stack is kept; taking an outfit off
  (`+name` / `-name`, or `wear` / `unwear`, with a stack in state) is left for later. A slot shows one variant, so
  layered clothing is a second slot in the PSD.
- No migration path is planned: the engine is alpha, so `groups` can be removed outright, and the sample and demo
  characters and the tests are rebuilt for the new format.
- Bones with no image (a neck, an empty root) are how Spine-style rigs hang pivots and parents; a hierarchy here would
  need the same, since a part's pivot and its parent are otherwise tied to a drawn image.
- For a **Live2D-like look**, Inochi2D's parameter-driven deformers fit a visual novel, where a script wants to say
  "look left" or "smile" and not write keys.
- Mesh work in Pixi 8 uses `MeshPlane` and `MeshRope` (see the mesh-warp item).
- An **importer** for Spine or DragonBones is a separate question. DragonBones is permissive; Spine's license terms for
  shipping its runtime or data in another engine need reading first.
- To check before planning: Inochi2D's current Pixi or web support, Spine's license for third-party runtimes, whether
  DragonBones is still maintained, Cubism's current license terms.
