# Bone-weighted skinning of free meshes

Status: design, agreed 2026-11-08, nothing built. A free mesh ([free-mesh.md](free-mesh.md)) gets per-vertex bone weights, so one drawn
part (an arm, a ponytail, a tail, a scarf) bends along the skeleton instead of turning as a rigid piece. It joins two things that
exist today: the bone tree ([rig-hierarchy.md](rig-hierarchy.md), `engine/src/bones.ts`) and the triangle mesh. The survey in
[rig-formats.md](rig-formats.md) lists weighted meshes as missing, and rig-hierarchy.md left room for them.

## Decisions

- **Spine's rule.** A skinned part's vertices are moved by the weighted bones alone. The part's own `bone` does not transform
  them, and it does not change how they draw: it is only the part's place in the tree. A vertex that is not listed follows an
  explicit `mesh.defaultBone` (the studio fills it with the part's bone when skinning starts), so re-parenting the part or
  deleting its bone cannot silently change the result.
- **Free meshes only.** The weights live inside `mesh`. A lattice deformer cannot be skinned (the kinds stay side by side).
- **At most 4 influences per vertex**, normalized to a sum of 1. The skinning runs on the CPU, so the cost is not the reason; the
  reason is that a vertex pulled by five bones cannot be painted or read, 2D limbs need two or three, and 4 leaves a shoulder
  (torso, upper arm, neck, collar) room. It is also what a later vertex-shader path would take (one `vec4` of indices, one of weights).
- **A bone has a body.** The segment from its pivot to each child's pivot, plus an optional `tip` point (below). Auto-weights need it.
- **Weights survive topology edits.** Unlike keyforms, which the mesh tools drop after a confirm, weights are remapped or
  interpolated (Topology edits).
- **Keyforms stay.** Per-vertex keyforms are applied before the skin, so they work as corrective shapes on top of it.
- **Rest poses stay in canvas pixels.** What skinning needs from a bone, an extent, is added as `tip`; rest poses are not
  re-stored relative to the parent (see Not in this design).
- Backward compatibility of the `rig.json` format is not required (as for the rest of the rig), so nothing here keeps old files reading.

## Words

A bone's **pivot** is the point it turns about, which is where it joins its parent: `arm_l` has its pivot at the shoulder,
`forearm_l` (a child of `arm_l`) at the elbow. Turning `forearm_l` swings the forearm about the elbow and leaves the upper arm
alone. So a bone's **body** runs from its own pivot *out* to its children's pivots: the upper arm, shoulder to elbow, is the
body of `arm_l`. The studio already draws exactly these lines. The segment from a bone's parent pivot to the bone's own pivot is
the *parent's* body, which matters for auto-weights: a vertex on the upper arm belongs to `arm_l`, not to `forearm_l`.

A bone with no children has no body to measure, and a bone has no rest direction (its rest matrix is the identity, see
Maths), so a leaf bone may say where it ends: `"tip": [x, y]` in PSD canvas pixels, like `pivot`. A bone with neither children
nor a tip is a point at its pivot. `tip` is also allowed on a bone with children and adds one more segment (a hand bone whose
fingers are not bones). It moves nothing by itself; it only shapes auto-weights and the studio's drawing. Skinning itself never
reads it: weights can be painted by hand on a rig with no tips, and a rig without them loads and draws as before.

## Data

```json
{
  "bones": {
    "arm_l":     { "parent": "torso", "pivot": [330, 450] },
    "forearm_l": { "parent": "arm_l", "pivot": [380, 560] },
    "hand_l":    { "parent": "forearm_l", "pivot": [420, 650], "tip": [440, 710] }
  },
  "parts": { "sleeve_l": { "bone": "arm_l" } },
  "deformers": [
    { "id": "sleeve_l_mesh", "part": "sleeve_l",
      "mesh": { "verts": [ ... ], "tris": [ ... ], "detail": "medium",
        "defaultBone": "arm_l",
        "weights": {
          "14": { "arm_l": 0.65, "forearm_l": 0.35 },
          "15": { "forearm_l": 1 }
        } },
      "keyforms": [] }
  ]
}
```

- `mesh.weights`: vertex number (a string key, as `pts` has) to `{ bone name: weight }`. A vertex that is **not listed** binds
  100% to `mesh.defaultBone`, and stays at rest when the mesh has none, so a mostly rigid part stores only the vertices that
  bend. The part's own `bone` is never consulted. A mesh with no `weights` behaves exactly as it does today; a part with
  `weights` is a **skinned part**.
- Weights are read as relative and normalized per vertex (a sum of 0.998 from rounding is harmless; `checkRig` only warns
  when it is far from 1). The studio writes four decimals.
- A skinned part needs a deformer entry for its mesh, even with no `keyforms`.
- Vertices are numbered as in `verts` (vertex `k` is `verts[2k]`, `verts[2k+1]`).

## Maths (pure, `engine/src/skin.ts`)

Bones have no rest rotation: `world(bone)` in `bones.ts` is the identity at rest, and pivots are read in the canvas space of the
bind pose. So there are **no inverse bind matrices**. The skin matrix of a bone is its world matrix, and a vertex at canvas
position `p` (the part's rest vertex plus its `origin`, after the keyforms and after a key that names the part itself) goes to

```
p' = sum over the vertex's influences i of  w_i * world(bone_i) * p
```

in canvas pixels. The result is written back in the part's own frame (`p' - origin`), the frame the mesh buffer holds today.
Everything downstream that reads that buffer (the studio's click-to-pick, `warpMeshPoints` for masks that follow the part) keeps
working without knowing about skins.

- **World matrices already carry the ancestors.** A bone's matrix includes every offset above it, so a part weighted to
  `forearm_l` follows `torso` with no extra influence. A key that names a bone moves a vertex exactly when one of the vertex's
  influences (its listed bones, or `defaultBone` if it is not listed) is that bone or sits below it.
- **Linear blend.** The blend of affine matrices is affine, so any bone offset is fine, scale included. At a large bend the skin
  pulls in at the joint: two bones at 90 degrees blended half and half leave the vertex at about 70% of its distance from the
  joint. VN poses are small, and keyforms are the corrective; dual-quaternion skinning is not planned.
- **Invariant.** A mesh whose every vertex is 100% on the bone the part sits on (listed, or unlisted with `defaultBone` set to
  that bone) draws exactly as the unskinned part does, with or without a key on the part itself. This is the first test of the
  build.

### Order of stages for one frame

1. Animations, `animate` and physics give the offsets by name, as now.
2. `placeRig` gives the bone world matrices, and the matrix of each part. A skinned part's container gets the rest matrix (its
   bone is not applied). A key that names the part itself is not put on the container either: it is applied to the vertices
   **before** the skin, in the rest frame, about the part's *rest* pivot (its `pivot`, else its bone's rest pivot, else the middle
   of its box). So the bones carry the keyed shape along, exactly as they carry an unskinned part's keyed matrix (the bone
   matrix after the part's own), and a part key never turns about a point the bones have already moved. A test pins this with a
   part key and a moving bone at once.
3. `applyWarps` shapes the mesh from the parameters: own keyforms, then the group lattice sampled at each vertex's *rest*
   position. This is unchanged and runs only when the deformer's parameters changed. For a skinned part it writes a private
   buffer (the *shaped* positions).
4. New: **`applySkins`** puts the part's own key on the shaped positions, moves them by the bone matrices into the geometry
   buffer, and uploads it.

Bones and parameters change independently (a bone moves every frame of an animation while no parameter does), so steps 3 and 4
have separate dirty keys: the shaped buffer is redone when the parameter key changes (as now), the skin when the shaped buffer,
the part's own key or the six numbers of any bone matrix it reads changed. An idle pose costs nothing. The worst case is 500 vertices times 4
influences a frame for each skinned part.

Because the group lattice is sampled at rest positions and applied before the skin, a skinned member of a group warp keeps its
bend when the bones turn it: the warp rides along with the part instead of staying in place.

## What else it touches

- **Masks that follow a skinned part**, and the studio's click-to-pick: unchanged, they use the part's buffer as drawn.
- **`partsUnder` and the focus dimming** use the part's own `bone` (where it sits in the tree), not the weights. A skinned
  sleeve on `arm_l` is "under" `arm_l` for the tree, even if its weights also reach the torso.
- **Group warp members on different bones**: `checkDeformers` warns about those because a bone that turns relative to the others
  would skew the lattice. Skinned members are left out of that warning (the weights decide where their points go).
- **Frame tracks**: a frame track on a part with a deformer is already an error (the variants would need a mesh each). Variants of
  a slot share the mesh and its weights, so give them the same image size.
- **Reduced motion and skipping** need nothing: a skinned part follows whichever bone motion is shown.

## checkRig

Errors: `weights` keys that are not whole numbers inside the vertex count; a value that is not an object, or is empty (leave the
vertex out to bind it to `defaultBone`); a bone that does not exist, in `weights` or as `defaultBone`; a weight that is not a
finite number above 0; more than 4 bones on a vertex. A `tip` that is not `[x, y]` of finite numbers.

Warnings: a vertex whose weights do not sum to 1 within 0.01 (they are normalized when read).

## Topology edits

`engine/src/mesh-edit.ts` returns a new `{ verts, tris }` and the studio then asks before dropping keyforms. Weights never
ask and never drop:

| Edit | Effect on `weights` |
|---|---|
| Add vertex in a triangle | the new vertex (always last) blends its three corners' weights by barycentric position |
| Add vertex on an edge | blends the edge's two ends by position along it |
| Move vertex (rest position) | unchanged; the vertex keeps its weights wherever it now sits |
| Flip edge, Add edge, Remove edge | unchanged (vertex numbers do not move) |
| Delete vertex | its entry goes and every higher number moves down by one |
| Regenerate mesh, Replace lattice with mesh | each new vertex samples the old mesh at its position (`locateInMesh`, the nearest triangle clamped when it lies outside), so a finer or coarser mesh keeps the painted result |

After a blend or sample, the entry is pruned to the 4 largest influences and renormalized. A blend that comes out as "all on
`defaultBone`" is not stored. The pure functions go in `engine/src/skin-edit.ts` next to the others, with the random-sequence
test of `mesh-edit` extended to check the weights after every step.

## Authoring in the studio

Model mode, a **Weights** tool (icon, a key letter picked when the step is built, the letter free in the studio's tool keys) and
a section of its own after Warp, closed until the tool is on. It follows the studio's one-focus model
([studio-focus-and-verbs.md](studio-focus-and-verbs.md)): the focus is a part with a mesh; **Bind bones…** is a pick verb.

1. **Bind bones…** picks the bones that may influence the mesh, from the tree or by clicking a bone handle on the stage (the
   pick stays on until Done or Esc). The section lists them, each with a colour chip and an eye (show only this one), and the
   first bind of a mesh without weights offers **Auto-weights**.
2. **Active bone** (a row of that list). The stage shows its weight at every vertex as heat on the mesh (none: transparent, 1:
   solid), and draws the bone's body and tip. A click on a vertex also names its weights in a readout: `arm_l 0.65 · forearm_l 0.35`.
3. **Auto-weights** for the selection or the whole mesh, from the bound bones (below). The usual start.
4. **Brush**, the main way to weight: drag over the stage with a radius and a strength, in the modes **Add**, **Subtract**,
   **Replace** and **Smooth** on the active bone. Every stroke renormalizes the vertices it touches; a fifth influence replaces the
   smallest. One undo step per stroke.
5. **Precision**, the keyboard alternative to the brush and the way to fix single vertices: the selection tools the Warp tool has
   (rectangle, Shift-click, All / None / Invert, soft reach along the edges), then **Set**, **Add** or **Subtract** a typed value on
   the active bone, **Smooth** (a Laplacian step over the edge graph, `meshAdjacency`), **Prune** (drop weights below a limit)
   and **Reset to the default bone**. The vertex fields type exact numbers, so the whole job works from the keyboard.
6. **Mirror** the weights across the part's vertical middle, pairing vertices by nearest rest position (as the keyform mirror
   does) and bones by name: `_l` / `_r`, `.L` / `.R`, a leading or trailing `left` / `right`. An unpaired bone asks which bone
   is its partner; nothing is guessed.
7. **Test pose.** While the tool is on, the rotate and move gizmos on a bone pose it **without keying** and a Reset takes the
   skeleton back to rest, so the author can bend the elbow and look. Animate mode's key-less preview does the same job there.

**Editing keyforms of a skinned mesh.** A keyform stores displacements before the skin. The first version requires the bones that
influence the mesh to be at rest: with one posed, a Warp-tool drag on that mesh is refused and the hint says to reset the pose
(Test pose has a Reset). That is enough for shapes that do not depend on a bend. A corrective for a bent joint has to be authored
with the joint bent, though, and a parameter's keyform can itself pose the bone at the value being edited, so the optional last
step converts a drag on the posed mesh to the pre-skin space through the inverse of the vertex's blended 2 x 2 matrix (the
weights times the bones' linear parts); where it is singular the drag is refused with a hint. At rest that matrix is the identity.

**Bones in the tree.** Renaming a bone rewrites the names in `weights` and `defaultBone`. Deleting a bone gives its weights, and
`defaultBone` if it was that bone, to its parent (then renormalizes), as merging it would. Re-parenting the part in the tree
changes nothing about how it draws. Undo steps: one per paint stroke, per button press and per drag.

## Auto-weights

For each vertex `v` (rest position in canvas pixels) and each bound bone `b`, `d_b` is the distance to the bone's body: the
nearest point on any segment from its pivot to a child's pivot or to its `tip`, or the pivot itself for a bone with neither.

```
r_b = max(0, 1 - d_b / blend)
```

If every `r_b` is 0 the vertex goes 100% to the nearest bone. Otherwise the four largest `r_b` are normalized into weights.
`blend` is a distance in pixels, the radius of the soft zone around each joint. A vertex on a bone's body is half and half at
the joint, two thirds on its own bone and a third on the next when it is half of `blend` away, and all its own at `blend` or
more. It is a tool setting, defaulting to one eighth of
the mesh's longer side, and is not stored in `rig.json` (the weights are the data). Straight distance is used; a distance along
the mesh's edges (`meshGraphDistance` does hops) is a later option for parts whose strands lie close together.

Auto-weights are a start for painting, not the finish: a hand, a face or a hat should be 100% on one bone, and the author sets that.

Cases the tests pin: away from joints a vertex on a bone's body is all on that bone, and at a joint half and half; a sleeve lying
against the torso, with only the arm bones bound, gets nothing from the torso (the result is limited to the bound bones, which is
why binding comes first); a vertex just inside the reach of the only bone near it goes fully to that bone, and one outside every
reach goes to the nearest; the result never has more than 4 influences and always sums to 1.

## Physics

The payoff of the feature is a hair or tail chain that turns bones, so a skinned strand mesh bends with no parameters in between
(Mina's `hair_back` today goes through 15 parameters into a lattice). This already works with no engine change: a physics output
`{ "part": "<name>", "scale": ... }` adds a rotation to a part **or a bone**. `stepPhysics` returns it by name, the renderer adds
it to the pose, `placeRig` moves a name that is a bone as a bone, and `checkPhysics` accepts a bone name there. A chain with one
segment per strand bone writes each segment (`segment`) to that bone's rotation. What is left is small: the key is called `part`
even for a bone (an alias `bone` can be added if that reads badly), and the studio's Physics tab may list only parts as output
targets (not checked). The hair sample in step 4 proves the path.

## Not in this design

- **Rest poses stored relative to the parent** (Spine's setup pose: x, y, rotation and length per bone, the world pose derived).
  Considered and left out. Here a pivot is in PSD canvas pixels and the rest matrix is the identity, so only animated offsets
  accumulate. Changing that would touch the bone maths, the pivot tool and gizmos, the converter's skeleton, the schema, every
  `rig.json` and most of the rig tests, and it would give up three things: pivots equal the coordinates the author sees in the
  PSD; dragging a pivot leaves the children where they are; and skinning needs no inverse bind matrices.
- **A bone axis for stretching along a limb.** `sx` and `sy` scale along the canvas axes the bone carries, so a bone that points
  diagonally at rest cannot be lengthened along itself with one channel. An axis taken from the pivot-to-tip direction would fix
  that (the scale applied in the limb's frame, in `offsetMatrix`). It changes how scale acts on existing bones, so it is not part
  of this work; if it is ever built it is opt-in per bone. Skinning does not read it.
- **IK** needs only bone lengths, which the body and `tip` already give. Not planned.
- **Spine import and export** is a pure conversion between its local setup poses and canvas pivots plus directions, and would
  not change the engine's own model. Not planned.

## Implementation order

Each step ends with `npm test` green and is meant as a session of its own; the browser gate applies from step 2. The keys are not
documented in `rig-json.md` until a rig can show them: `weights` and `defaultBone` in step 2, `tip` in step 3.

1. **Core.** `DeformerMesh` (`params.ts`) gains `weights` and `defaultBone`. A new `engine/src/skin.ts` (compile the sparse weights
   to indices and normalized weights, skin a buffer) is exported from `index.ts`. The rules go in `checkDeformers` (`params.ts`).
   `placeRig` (`bones.ts`) leaves the bone out of a skinned part's container matrix and hands back the part's own key matrix
   separately, for the skin to apply first. The rig.json schema in `editor/json-schemas.ts` offers the keys (its pinned fixture is
   regenerated and the diff reviewed). Tests: a new `skin.test.mjs` (exact results for one bone, two bones, a pivot elsewhere,
   normalization and the cap of 4, the unskinned-equivalence invariant with and without a part key, and a part key with a moving
   bone at once), `placeRig` in `bones.test.mjs`, the new problems in `rig.test.mjs`. Done when nothing draws differently (no
   renderer change), a rig with weights checks clean and a bad one is reported.
2. **Renderer.** The shaped buffer and `applySkins` with the two dirty keys; the part's container matrix; click-to-pick and masks
   verified on a skinned part. A hand-weighted sample on a part of the demo's robot rig that spans two joints (chosen when the step
   starts), and a browser test that bends it and reads `vnStage()` bounds. `rig-json.md` gets `weights` and `defaultBone`. Done
   when the sample bends in the preview and the studio, and a click and a following mask land on the bent art.
3. **Edits (pure) and `tip`.** `BoneDef` gains `tip`, checked next to the pivot check in `checkRig` (`rig.ts`), offered by the
   schema and documented. `engine/src/skin-edit.ts`: Set / Add / Subtract, Smooth, Prune, auto-weights (the first reader of `tip`),
   mirror with bone pairing, remap on delete, interpolate on add, resample on regenerate; the hook into `mesh-edit`'s geometry
   setter. Done when each edit is a tested pure function and the random-sequence test passes on meshes that carry weights.
4. **Hair.** Mina's `hair_back` rebuilt as a skinned strand mesh, its weights made with step 3's auto-weights (a throwaway script)
   and checked by eye, its bones turned by a physics chain (see Physics); fix the studio's Physics tab here if it cannot pick a
   bone. This is the step that shows the feature earns its keep, and it comes before any studio work on purpose. Done when the hair
   sways from bone rotations with no parameter between.
5. **Studio, weighting.** The Weights section: bind list, heat overlay, vertex readout, Auto-weights, the brush (add, subtract,
   replace, smooth), Test pose. Done when an author can weight a mesh by brushing and try a pose without keying anything.
6. **Studio, precision.** The numeric Set / Add / Subtract on a selection, Prune, Reset to the default bone, Mirror, bone rename and
   delete, and the rest-pose rule for keyforms. Done when a mesh can be weighted from the keyboard alone.
7. **Docs.** A Skinning subsection in `rig-json.md`; the rig.json F1 help keys; the tutorial's layered-character page.
8. **Optional: keyforms under a pose.** The drag conversion described under Authoring. Decided after step 6, by whether correctives
   for bent joints turn out to be wanted.

A rough size, from the free-mesh build: steps 1 to 3 about a week, step 4 a few days, steps 5 and 6 a week and a half (the studio
is most of the cost), step 7 a couple of days, step 8 half a week if it is built.

## Risks and open points

- **Volume loss in linear blend** at large bends (above). Keyforms on a parameter that follows the bone are the repair; whether a
  parameter can be bound to a bone's rotation directly (physics inputs can read a bone channel) is not settled and is left for
  when a case needs it.
- **Stretched art.** Bending a raster pixel grid stretches the texture across the joint. Hands and faces should be 100% on one
  bone, and the PSD wants some overlap at the joints. The generator's margin around the art's outline gives the mesh some room to
  stretch into, but not past the image box ([free-mesh.md](free-mesh.md)).
- **Cost on a low-end phone** is unmeasured. It belongs with the stencil-mask measurement in `TODO.md`: both are per-frame work on
  the mesh path. The cap of 500 vertices bounds it.
- **A skinned part and `parts.<p>.bone`.** The bone stays as the tree position and nothing else (`defaultBone` carries the
  fallback), so a part that is skinned keeps the tree and the dimming it has today. If that proves confusing, the studio can mark
  the part in the tree.
- **Reconverting art** keeps the mesh and its weights in `rig.json`; art that changed shape under an old mesh is the existing
  problem of every mesh, not a new one.
