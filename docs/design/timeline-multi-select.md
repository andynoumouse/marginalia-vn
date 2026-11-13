# Choosing several keys on the timeline

Status: step 1 built (2026-11-11) for channel and parameter keys: `engine/src/key-group.ts` (not `anim-edit.ts` as "The model"
below planned; no `frame` key kind, and the box is hit-tested in the DOM), `editor/anim-keyset.ts`. Left:
frame blocks in the selection (their tracks may be a frame list with an fps rather than keys), and step 2, Copy and Paste. UX round 3 finding AN-13 ([ux-test-2026-11-studio-3/an.md](ux-test-2026-11-studio-3/an.md)):
Shift-click and Ctrl-click replace the selection and a box drag does nothing, so moving several keys at once is not possible.

## What exists

The Animate timeline has three kinds of key, each with a single selection of its own:

- **Channel keys** of the chosen part (or the whole character): `def.keys`, one entry per time with any of x, y, scale, rot and
  opacity; a diamond is drawn per channel, and all of an entry's diamonds share its index. `KeyEditor.sel` (`editor/anim-keys.ts`)
  is that index. A drag moves the entry in time and the dragged channel in value; arrows nudge, Delete removes.
- **Parameter keys**: `def.params[id]`, one lane per parameter; `ParamTracks.sel` (`editor/anim-ptracks.ts`) is `{ id, index }`.
- **Frame blocks**: `def.frames`, one row per slot; `FrameEditor.sel` (`editor/anim-frames.ts`) is `{ slot, index }`.

A plain drag on an empty part of a lane scrubs the playhead, as the ruler does; a double-click adds a key.

## What to build

One selection that can hold keys of all three kinds, and the edits a selection of several keys needs.

**Choosing.**
- A click on a key chooses it alone (as now). **Ctrl-click** (Cmd on a Mac) adds a key to the selection or takes it out.
  **Shift-click** adds every key between the last chosen one and the clicked one, in time, on the lanes between them (Spine,
  After Effects).
- **Box selection:** a drag that starts on an empty part of a lane *with Shift held* draws a rectangle and chooses every key
  inside it (Ctrl+Shift adds to the selection). A plain drag on a lane keeps scrubbing, which every existing user and test does.
- **Ctrl+A** with the focus on the timeline chooses every key of the animation on show (all lanes); **Esc** clears the selection
  before it does anything else (it joins the Esc ladder in `dialogEscape` after "a typed edit", before "leave the tool").
- The chosen keys are drawn as the chosen key is now (the accent fill and outline). The Properties "Key" row shows the one key
  when there is one, and "3 keys" with no fields when there are more.

**Editing several keys.**
- **Drag** any chosen key: all of them move in time by the same amount, clamped as a group so that none goes before 0 or past the
  end (the first and last keep their order: the group stops at the edge). Only the dragged channel's value moves, and only when
  one key is chosen; with several, a vertical drag does nothing (moving several values by one offset is rarely what is meant).
- **Arrow Left/Right** nudge them all in time (0.01 s, Shift 0.05 s), clamped the same way. Up/Down change a value only with one key.
- **Delete** removes them all.
- **Ease**: the Properties ease select, with several channel or parameter keys chosen, sets the ease of all of them (frame
  blocks have none).
- **Copy and Paste (Ctrl+C, Ctrl+V)**: copy the chosen keys with their times relative to the first; paste puts them at the playhead,
  on the same lanes (for channel keys, on the part chosen now, so a wave can be copied from one arm to the other). This is the one
  part that adds a new idea; if the session runs long it is the first to move to a later one.
- Each of these is one undo step, named for undo ("3 keys moved by 0.2 s", "3 keys removed").

## The model

A selection is a list of references, kept in the studio and handed to the three editors:

```ts
type KeyRef = { kind: 'key'; index: number }            // def.keys[index] (all its channels)
            | { kind: 'param'; id: string; index: number } // def.params[id][index]
            | { kind: 'frame'; slot: string; index: number } // a frame track's key
```

The three editors keep their single `sel` as "the key the fields show" (the last one clicked), so their fields, nudges and
focus code keep working; the set of references decides what is drawn as chosen and what the group edits act on. A redraw that
re-sorts keys maps the references to the new indices the same way `setKey` already returns the new index of one key.

**Engine (pure, with tests), in `engine/src/anim-edit.ts` beside `setKey` and `deleteKey`:**
- `moveKeys(def, refs, dt) → { def, refs }`: moves every referenced key by `dt` (a fraction of the length), clamped as a group
  to 0..1, re-sorts each list, and returns the references at their new places. Two keys of one list that would land on the same
  time keep their order a hair apart, as a dragged frame block does since AN-15.
- `deleteKeys(def, refs) → def`, `setKeysEase(def, refs, ease) → def`.
- `keysInBox(def, part, box) → KeyRef[]`, from the lane geometry the timeline already has (`drawnRows`), for box selection.
- `copyTimelineKeys` / `pasteTimelineKeys(def, clip, t, part) → { def, refs }` for Copy and Paste (`copyKeys` is taken: it copies a
  part's keyforms in Model mode).

## Build order (two sessions)

1. **Selection and group edits.** The `KeyRef` set in the studio; Ctrl-click, Shift-click, Shift+drag box, Ctrl+A, Esc; drawing;
   group drag, nudge, Delete and ease; the "3 keys" Properties row; undo names. Engine functions with tests; a browser test that
   box-selects three keys, drags them, checks the JSON and undoes it.
2. **Copy and Paste**, with its own browser test, and the docs: the Animate section of `docs/rig-json.md` lists the keys and
   mouse gestures. Delete AN-13 from TODO.md.

## Open points

- Whether a vertical drag of several keys should move their values by one offset after all (Spine does; After Effects does not).
- Box selection on a plain drag (After Effects) would be faster to reach, but it takes away scrubbing on the lanes; the ruler would
  then be the only place to scrub. Worth asking after the first build.
