# Animation studio: showing on the stage whether a part or its bone is chosen

Status: built 2026-11-10, all three cues, in both studio modes (see "Built" at the end). From the `TODO.md` item of the same name.

## The problem

In Model mode a click on art chooses **the part**, and Alt-click or the bone's dot chooses **the bone** it sits on
([studio-stage-modes.md](studio-stage-modes.md), "What a click chooses"). With a part on a bone chosen, Move, Rotate and Scale pose
the bone, so the gizmo stands on the bone's pivot in both cases. Two stage screenshots from the skinning browser test, robo with
`upper_l` chosen and then its bone `arm_l`, differ in one thing only: with the part chosen the forearm is dimmed, with the bone
chosen it is bright. Everything drawn on top is the same:

- the gizmo, on the same pivot, in the same colours;
- the bone dot, filled in the selection colour in both cases, and covered by the gizmo's centre square in both;
- the skeleton lines.

The dimming is the only cue, and it is a weak one: it reads as "something changed", not as "the bone is chosen". It is also no cue at
all when the bone carries just the one part. The Properties header and the tool options bar name the target ("poses arm_l, the bone
upper_l sits on"), but they are away from where the author is looking.

## What the stage knows

The studio already sends the stage everything needed:

- the chosen row (`studioFocus`, which drives the dimming);
- the gizmo's target (`studioGizmo`'s `name`).

They differ exactly when a part on a bone is chosen.

The renderer can give the overlay what it needs to draw:

- a mesh part's posed vertices and edges (`studioMesh`, already in stage pixels via `toGlobal`);
- a sprite's posed corners (the same `toGlobal` on its four corners: a new query of a few lines);
- every bone's joint and its parent's (`studioSkeleton`).

## Proposal

Three cues, drawn by the stage overlay (`preview/studio-gizmo.ts`), in the Transform and Pivot modes only. Warp, Weights and Mask
already draw their subject.

1. **What is chosen is outlined.**
   - **A part:** a dashed line in the selection colour around its art, drawn as it is posed. For a mesh part this is the mesh's outer
     edges; for a sprite, its four corners, so a rotated part gets a rotated box. Its bone keeps the plain dot.
   - **A bone:** its body drawn as a thick line in the selection colour, from its joint to each child joint (or its tip when it has
     none), over the thin skeleton line. The parts it carries get a faint outline each, so "these move together" is visible.
2. **A tag at the gizmo**, in the corner of the stage view nearest the pivot, clear of the handles. Same style as the zoom label:
   - for a part on a bone: `upper_l · part — the gizmo poses its bone arm_l`;
   - for a bone: `arm_l · bone · 3 parts`;
   - for a part on no bone: nothing (there is nothing to tell apart).
3. **The bone dot stays visible.** When the chosen bone's dot is under the gizmo, it is drawn as a ring (radius 11) around the centre
   square instead of a filled dot under it. When a part is chosen the dot is plain.

Not proposed: **a bone-coloured gizmo.** The handles' colours mean the axes (red x, green y, blue ring); a second meaning for the
same colours would muddy both.

## How it would be built

- **Pure rule** in `engine/src/studio-inspector.ts` (where `gizmoLine` lives), with tests: `choiceCue({ chosen, target, kind,
  carries })` gives the tag text and what to outline (the part, or the bone and its parts).
- **Stage:** one renderer query for a sprite's posed corners, plus `draw()` drawing the outlines, the ring and the tag. A
  `studioFocus` change already redraws.
- **Browser test:** with a part chosen, then its bone, the overlay has a dashed outline or the bone's thick line, and the matching
  tag.- **Size:** one session.

## Questions

1. All three cues, or only some? The outline does most of the work and the tag spells it out; the ring is small. My recommendation is
   all three.
2. Should Animate mode show them as well? There a click keys the part, and Alt-click chooses the bone, so the same ambiguity exists.
   My recommendation is yes, with the same code.

## Built

- **The rule:** `choiceCue` in `engine/src/studio-inspector.ts`, with tests in `studio-inspector.test.mjs`.
- **The stage:**
  - The renderer has `studioPartOutline` (a mesh's outer edges, or a sprite's posed corners) and `studioBoneInfo` (the parts that move
    with a bone, its child bones and its tip).
  - `StageTools.setChosen` is fed from `studioFocus`. `draw()` draws the cues only in the Transform mode: with the Weights tool the gizmo
    belongs to the test pose, so the cues would name the wrong thing.
- **Bone dots** carry `data-bone` (and `data-chosen` on the ring), so tests find them without depending on their colours. The skinning
  browser test checks:
  - both tags;
  - the part's outline and its plain bone dot;
  - the bone's body, which must end at its child joint (a first version drew it to the corner of the stage, and the test now catches that);
  - the ring and the faint outlines;
  - that the tag stays inside the stage and off the handles.
- **Where the tag goes:** on the side away from both axis handles, past the rotate ring, held inside the window. With the pivot near the
  top of the view it ends up at the top edge.
