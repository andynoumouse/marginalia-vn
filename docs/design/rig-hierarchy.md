# Design: bones and looks for layered characters

Plan for replacing flat `groups` in `rig.json` with a bone hierarchy, and for merging outfits and poses into one
concept, the **look**. Background and the survey of other formats: [rig-formats.md](rig-formats.md). Current format:
[../rig-json.md](../rig-json.md). Status: design, nothing implemented.

## Decisions already made

- **Bones** (transform nodes with a parent and a pivot, imageless ones allowed) replace flat `groups` as the way to
  move parts together. **Parts** (drawn layers and slots) each sit on one bone; draw order stays independent of the
  tree (`order`, as now).
- No migration: the engine is alpha, so `groups` is removed outright and the sample character, tests and docs are
  rebuilt.
- **Outfits and poses merge** into one concept, the look: a named map from slots to variants that may cover every slot
  or only some. One `rig.json` key replaces `poses`, the dressing job of `groups`, and outfits.
- A look is applied by expansion into the character's slot overrides: the last one applied wins per slot, and no stack
  lives in state. Taking an outfit off is left for later. `slot=variant` on a `show` line still wins. A slot may map to
  `none`. Unknown slots or variants are `checkRig` errors. A slot shows exactly one variant; layered clothing means a
  second slot.

## rig.json schema

```json
{
  "order": ["bottom", "top"],
  "bones": {
    "root":     { "pivot": [270, 700] },
    "torso":    { "parent": "root", "pivot": [270, 640] },
    "neck":     { "parent": "torso", "pivot": [270, 380] },
    "head":     { "parent": "neck" },
    "arm_l":    { "parent": "torso", "pivot": [330, 450] },
    "forearm_l":{ "parent": "arm_l", "pivot": [380, 560] }
  },
  "parts": {
    "face": { "bone": "head" },
    "bangs": { "bone": "head" },
    "eyes": { "bone": "head" },
    "mouth": { "bone": "head" },
    "hair_back": { "bone": "neck" },
    "top": { "bone": "torso" }
  },
  "looks": {
    "happy":   { "eyes": "happy", "mouth": "smile" },
    "shy":     { "look": "smile", "mouth": "neutral" },
    "school":  { "top": "school", "bottom": "school" },
    "casual":  { "top": "casual", "bottom": "casual" },
    "naked":   { "top": "none", "bottom": "none" }
  },
  "animations": {}, "autonomous": { "idle": "breathe", "speak": {}, "blink": { "slot": "eyes", "variant": "closed" } }
}
```

- **`bones`**: name to `{ parent?, pivot? }`. `parent` names another bone; a bone without one hangs from the
  character (the whole-body transform that `show` and `animate` without a `part` already move). `pivot` is `[x, y]` in
  PSD canvas pixels, like today's `pivots`. The `pivots` key goes away: every pivot belongs to a bone.
- **`parts`**: part name to `{ bone?, pivot? }` (`pivot` only for a part that must turn about a point other than its
  bone's; see Transform composition). A part without an entry (or without `bone`) sits directly on the character,
  so a character with no hierarchy keeps working with only `order`. Part names are slots and plain layers, as now.
- **`looks`**: look name to a map from slot name to variant name (or `none`). One reserved key, `look`, names another
  look applied first (replaces today's `"pose": "smile"` base). Everything else is a slot name.
- Bone names, part names and look names live in separate namespaces in the file. Where a script or an `animate` can
  name either a part or a bone (below), a part wins over a bone of the same name, as a real part wins over a group
  today; `checkRig` warns about the clash.

**Why a separate `parts` map and not `parent` on each part.** The tree then has one kind of node, and a bone with no
image (neck, root) needs no fake part. It matches Spine. The cost is one more key; for a rig with few bones it is
short anyway.

## The PSD converter

The converter writes `sprite.json` and never `rig.json`; that stays. Bones are authored, not extracted, because a PSD
layer group says "these layers belong together", not where the joint is.

Recommendation:

- The `+folder` groups the converter already supports (layers drawn like top-level layers) carry the folder name into
  `sprite.json` as a `group` string on each of their parts (`"group": "+head"` with the prefix removed: `"head"`).
  Nested folders give a path (`"arm/forearm"`). Nothing else about conversion changes.
- `rigSkeleton` (the generated starting `rig.json`, and **Update Rig from Reconverted Art**) turns each distinct folder
  path into a bone named after it, parented along the path, and puts the folder's parts on it. Pivots are left out, so
  the studio's Model mode is where they get placed. Existing bones are never changed by a reconvert; new folders add
  bones, as new parts are added to `order` today.
- **PSD pose tags become looks.** Variant names such as `"open, neutral"` keep meaning "this variant is also called
  `neutral`". For `show alice neutral` to keep working without a hand-written look, a name tagged on variants is treated
  as an **implicit look**: the map `{ slot: variant }` over every slot that has a variant with that name or tag.
  A `looks` entry of the same name wins (`checkRig` notes the clash as it does now for shorthands). The studio's
  Looks list shows both kinds, the implicit ones marked as coming from the art.
- The suggestion for slots like `outfit_back` + `outfit_front` that `rigSkeleton` makes today becomes a look
  skeleton: the common variants of those slots form one look each (`casual` sets both).

## Transform composition

Each bone has a rest transform (its pivot) and an animated offset `{ x, y, scale, rot }` (the channels animations use
today, with the same units: `x`/`y` as a fraction of stage height, `scale` added to 1, `rot` in degrees).

- The world transform of a bone is its parent's world transform composed with its own offset about its own pivot:
  `world(bone) = world(parent) ∘ T(pivot) ∘ offset ∘ T(-pivot)`, with pivots read in the **PSD canvas space** (the
  space of the bind pose). Parts are drawn from the rest pose, so a child at rest needs no knowledge of its parent: only
  offsets accumulate. This is Spine's setup pose with local offsets, and it means a pivot is the same numbers the
  author sees in the PSD and in `sprite.json`.
- In Pixi this is a container per bone, nested, each with `pivot` and `position` at the bone's pivot expressed in the
  parent container's rest coordinates (parent pivot subtracted). Part containers become children of their bone's
  container. Draw order is kept by not drawing through the tree: bone transforms are computed as plain matrices, and
  the part containers sit in one flat drawing layer in `order` order, each given its bone's **world matrix** every
  frame (`part.setFromMatrix`). A part keeps no extra transform of its own except its own offset when a key names
  it (below). This is what keeps `order` independent of the tree.
- **Part pivots.** Pivots belong to bones, but a key can name a part (below). A part on a bone turns and scales about
  its bone's pivot. A part that needs its own pivot (the sample's `hair_back` today) gets an optional `pivot` in its
  `parts` entry (`"hair_back": { "bone": "neck", "pivot": [270, 380] }`); the part's key offset is then composed about
  that pivot, below the bone's world transform. A part with no bone entry and no `pivot` keeps turning about the middle
  of its own image. Model mode's pivot tool edits the chosen node's pivot, bone or part.
- **Scale and flip.** A bone's `scale` multiplies its children's positions as well, like a normal transform
  hierarchy. The `scale` channel is a single number, so scale is always uniform and a rotated child never shears; if
  separate x and y scale channels are ever added, the shear question comes back with them. The character-level flip and
  scale remain above the root.
- **Pivot fallback.** A bone with no `pivot` uses its parent's; the first bone with none and no parent uses the middle
  of the bounding box of the parts on it and its descendants (computed at load from their images), and the character
  origin (bottom middle) if it has no parts at all. This replaces "the group's first part's pivot". A part with no
  bone entry keeps today's behaviour: it turns about the middle of its own image when a key names it directly.
- **Slot variants.** A variant swap does not change the bone or its transform; variants are positioned in the PSD
  canvas as today, so the pivot stays valid. A variant with its own `x`/`y` offset is just a different image position.

## Key semantics: `part=` in animations and keys

Recommendation: **keys target a bone or a part, and offsets compose down the tree.** That is the same as today's
behaviour minus the group special case.

- A key's `part` (and `animate ... part=`) accepts a **bone name or a part name**. Naming a bone moves that bone and
  everything below it: the head key carries the face, bangs, eyes and mouth, and the hair on the neck's other child
  stays put. Naming a part moves only that part, on top of whatever its bone does.
- Offsets are **additive within a target and compose down the tree**. Two keys on the same bone in one animation
  already blend by channel (that is how channels work); a key on `head` and a key on `face` both apply, `face` last,
  `head`'s first, in the order of the hierarchy. There is no "absolute" mode: a child never needs to cancel its
  parent's motion, since the parent's offset is its own channel.
- `animate <char> <name> part=<bone-or-part>` plays any animation, presets included, on that target instead of the whole
  character, as now. The whole character is the root: keys without a `part` move everything.
- A part that is in no bone entry behaves exactly like a top-level part today, so characters with no hierarchy lose
  nothing but `groups`.
- The old rule "a part's own keys add to the group's" is the same rule with a tree. No separate rule remains.

## `show` syntax for looks

- `show mina casual` : `casual` is looked up in `looks`, then in the implicit looks from PSD tags, then as a
  variant name. Anything matching none warns (the same warning as today for an unknown pose).
- A bare word that is today a pose therefore keeps working: `show mina smile` picks the `smile` variant in every slot
  that has one, either through a PSD tag or a `looks` entry of that name.
- A look is applied by expansion: its slots are written into the sprite's overrides in order, so a later look wins per
  slot, and a slot named explicitly on the line wins over every look: `show mina casual mouth=open`.
- Several looks on a line apply left to right: `show mina happy casual` (the last wins per slot). The first position
  is the old pose position; a second bare word is new and replaces `outfit=casual`.
- **`outfit=none`** becomes what it is: an author writes a look with `none` for each slot (`"naked"`), or sets one
  slot: `top=none`. A shared `outfit=` key no longer exists, since it was a group name. If authors want one word that
  covers the dressing slots, they name a look.
- **The base-pose reference inside a look** is `"look": "smile"` (was `"pose"`). It is expanded first, then the
  other keys. `checkRig` rejects cycles (`a` references `b` references `a`).
- `SpriteState` keeps its `pose` field for the first look name and its `overrides`; the expansion is done by
  `expandShow` as now, with its second output becoming the merged overrides (no separate `pose` any more). Because the
  `SpriteState` shape then changes, the whole-state `deepEqual`s in `engine.test.mjs` and `assets.test.mjs` and the
  state in `preview/studio.ts` need updating (see the test list).

## New `checkRig` errors and warnings

Errors (the file is wrong):

- `bones.<b>.parent`: names no bone; or forms a cycle (reported once, naming the loop).
- `bones.<b>.pivot`: not `[x, y]` finite numbers.
- `parts.<p>`: names no part (slot or plain layer); `bone` names no bone.
- `looks.<l>`: a key that is no slot (and not `look`); a variant the slot lacks (and not `none`); a `look` that names
  no look, or forms a cycle.
- `looks`: a value that is not a string.
- `animations...`: a key `part` that names neither a part nor a bone (the message lists both).
- `groups` present: "groups was replaced by bones; see rig-json.md" (a clear message, since the engine is alpha and
  nothing converts it). Same for `poses` and `pivots`.

Warnings (still loads):

- A bone and a part with the same name (the part wins).
- A look with the same name as a PSD variant or tag (the look wins).
- A bone with no parts and no children (it moves nothing).
- A bone with no pivot anywhere up its parent chain and no parts to measure (it has nothing to turn about).
- A slot named `look` (the key is reserved inside `looks`, so that slot cannot be set by a look).

## Editor impact

- **Model mode / Parts tree.** The Parts tree becomes the bone tree: bones as nodes, each with its parts under it
  (slots with their variant thumbnails, layers), and parts with no bone at the top. **Drag** a bone or a part onto a
  bone to re-parent it (one undo step, written to `bones` / `parts`); drag to the top level to detach. A **New bone**
  button adds an imageless bone under the selected one. The arrow keys that move between rows today keep working, with
  Left/Right collapsing and expanding a bone and still switching a slot's variants on a slot row.
- **Stage.** Model mode draws a line from each bone's pivot to its children's pivots and a cross on each pivot (one cross
  per distinct pivot, as now); the chosen bone is highlighted along with its subtree, and dimming covers everything
  outside it (the existing `focus`). Dragging a pivot moves the bone's `pivot` and keeps the children's world pivots
  fixed (their local numbers do not change, since pivots are canvas-space).
- **Same pivot for…** goes away: a head's parts share a pivot by sharing a bone.
- **Looks list** (replaces the Poses list): rig.json looks and art-tagged implicit ones, each with its picks; click to
  dress the stage. A button saves the current dress as a new look.
- **`editor-support.ts`**: `rigPartNames` returns parts then bones (what `part=` and keys accept); `rigPoseNames`
  becomes `rigLookNames` (looks, implicit looks, variant names); `rigSlotNames` loses the group names. Completions for
  `rig.json` itself list bone names after `"parent":` and `"bone":`, look names after `"look":`.
- **Docs and F1 help.** `docs/rig-json.md` loses `groups`, `poses`, `pivots` sections and gains `bones`, `parts`,
  `looks`. The section lookup in `help.ts` (`/^ {0,2}"(order|groups|poses|...)"/`) needs the new key names, so does the
  `rig-json.md` heading structure it reads. `docs/commands.md`: `show` (looks, several bare words) and `animate`
  (`part=` accepts bones); headings `### show / hide` and `### animate` stay as they are, so F1 topics do not change.
  The README syntax block that mentions `outfit=`/poses is updated.

## Tests and sample data to rebuild

- `games/sample/assets/char/mina/rig.json`: move `groups.head` to a `head` bone plus `parts`, add a `neck` bone parented
  to a `root`, turn `groups.outfit` and `poses.uniform` / `casual` into looks, move `pivots` into bones. Keep the
  existing animation names (`head_tilt`, `wave`, `giggle`) and the script `park.vn` choices untouched.
- The demo characters (`iris`, `theo`) are flat and have no `rig.json`: nothing to rebuild.
- `engine/test/rig.test.mjs`: replace group and pose tests with bone/look ones (composition, cycles, unknown names, look
  expansion order, `look` references, `none`, explicit override wins).
- `engine/test/engine.test.mjs` and `engine/test/assets.test.mjs`: the whole-state `deepEqual`s for sprites if the state
  shape changes; asset refs that used a pose name.
- `engine/test/psd-plan.test.mjs`: `group` carried into `sprite.json`.
- `engine/test/debug.test.mjs`, `engine/test/text-format.test.mjs`, `engine/test/idle.test.mjs`,
  `engine/test/asset-refs.test.mjs`, `engine/test/file-refs.test.mjs`, `engine/test/online.test.mjs`,
  `engine/test/anim-edit.test.mjs`: references to groups or poses in rig data; checked and updated one by one.
- `engine/test/browser.test.mjs` (not run during the fast phases): the head tilt and outfit tests.
- New: a test that a bone key carries its descendants and composes with a part key, with exact matrices.
- `preview/studio.ts` (state built for the studio) and `preview/pixi-renderer.ts` (`posePartsOf`, `look`, `dimParts`).
- `tools/exe-info.mjs`, `preview/storage.ts`, `editor/help-dialog.ts` and `editor/help.html`: grep hits to verify; most
  are likely unrelated uses of the word "group".

## Implementation phases

Each phase ends with `npm test` green.

1. **Looks.** `parser.ts` and `types.ts` accept several bare words on a `show` line (a `show` statement carries a list
   of looks, applied left to right). `rig.ts`: `looks` replaces `poses` (and the dressing half of `groups`); `expandShow` returns merged
   overrides, with the `look` reference, `none`, implicit looks from PSD tags, and left-to-right application of several
   looks. `rigLayers`, `checkRig`, `rig-outline`, completions, `docs/rig-json.md`, `docs/commands.md` and the mina
   rig are updated; the editor's Poses list is renamed Looks. `groups` still exists for movement in this phase.
2. **Bones in the data model.** `bones` and `parts` keys, composition maths as a pure function in `engine/src`
   (`composeBones`: rest pivots and offsets to per-bone matrices, with the pivot fallback), `checkRig` errors, tests with
   no renderer changes. `groups` still moves parts.
3. **Renderer and animation.** The largest phase; commit it in two steps (the renderer and animation path on bone
   matrices with `groups` still accepted, then the removal of `groups` from the format and the mina rig). `pixi-renderer.ts` and the animation path use bone matrices; `spreadPartOffsets` and
   `partGroups` are removed; `part=` accepts bones. `groups` removed from the format and from `checkRig` (with the
   replacement message); mina's rig moves fully to bones.
4. **Converter.** `group` carried into `sprite.json`, `rigSkeleton` and **Update Rig from Reconverted Art** create
   bones from folders and looks from slot families.
5. **Editor.** Model mode tree with drag to re-parent, parent-child lines on the stage, New bone, Looks list and save
   look, completions, F1 help keys. Run `npm run test:studio` and the browser gate after this phase.

## Settled and open questions

Settled: the name is **look**; several bare words on a `show` line apply left to right (the last wins per slot); bone
scale is uniform, so there is no shear (see Transform composition).

Open:

- **Taking an outfit off** (`+name` / `-name` or `wear` / `unwear`) is deliberately left out; revisit once a game needs it.
- **Mesh warp** (see the mesh-warp item in `TODO.md`) will want weights from bones to vertices; the format here leaves
  room (a later `mesh` entry on a part), but no part of this design depends on it.
