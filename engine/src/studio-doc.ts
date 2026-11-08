// What the animation studio edits of a rig.json: its working copy (`StudioDoc`), read from the parsed file, and the
// top-level properties to write back. Shared by the two hosts of the studio: the editor's rig.json tab and the standalone
// page's character folder (docs/design/animation-studio-parameters.md, Standalone mode).

import type { Anims, Bones, Looks, PartBones, Pivots, RigWrite } from './anim-edit.js';
import type { ReactionDef } from './auto-anim.js';
import type { DeformerDef, KeyformDef, PadDef, ParamDef, PoseDef } from './params.js';
import { normalizeMasks, stripMasks, writeShapes, type ShapeDef } from './masks.js';
import type { RigPhysicsChain } from './physics-rig.js';

/** What the studio edits: the character's `categories`, `parameters`, `pads` and `keyforms`, its `animations` (with their `auto`), `pivots`, `bones` and `parts`, `reactions`, its mesh warps (`deformers`), its mask `shapes` (imageless parts with a polygon) and the `clips` of its parts to them. */
export interface StudioDoc {
  categories: string[]; parameters: ParamDef[]; pads: PadDef[]; keyforms: KeyformDef[]; poses: Record<string, PoseDef>; physics: Record<string, RigPhysicsChain>;
  deformers: DeformerDef[]; shapes: Record<string, ShapeDef>; clips: Record<string, string>; anims: Anims; pivots: Pivots; bones: Bones; parts: PartBones; looks: Looks; reactions: ReactionDef[];
}

const object = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, never> : {});
const list = (v: unknown) => (Array.isArray(v) ? v : []);

/** The studio's working copy as a parsed rig.json states it (a missing section is empty). */
export function studioDocOf(data: unknown): StudioDoc {
  const d = object(data);
  const { shapes, clips } = normalizeMasks(d);
  return {
    categories: list(d.categories), parameters: list(d.parameters), pads: list(d.pads), keyforms: list(d.keyforms), poses: object(d.poses), physics: object(d.physics),
    deformers: list(d.deformers), shapes, clips, anims: object(d.animations), pivots: object(d.pivots), bones: object(d.bones),
    parts: stripMasks(object(d.parts)), looks: object(d.looks), reactions: list(d.reactions),
  };
}

/**
 * The properties of rig.json that `change` sets, for `writeRigText`. An empty list drops its key.
 */
export function studioWrites(change: StudioDoc): RigWrite[] {
  // The shapes go back as imageless entries of `parts` and the clips as `clip` links on the clipped parts (masks.ts).
  const parts = writeShapes(change.parts, change.shapes, change.clips);
  const writes: RigWrite[] = [
    { key: 'animations', value: change.anims }, { key: 'pivots', value: change.pivots }, { key: 'bones', value: change.bones },
    { key: 'parts', value: parts },{ key: 'looks', value: change.looks }, { key: 'poses', value: change.poses },
    { key: 'physics', value: change.physics },
    { key: 'categories', value: change.categories.length ? change.categories : null },
    { key: 'parameters', value: change.parameters.length ? change.parameters : null }, { key: 'pads', value: change.pads.length ? change.pads : null },
    { key: 'keyforms', value: change.keyforms.length ? change.keyforms : null }, { key: 'deformers', value: change.deformers.length ? change.deformers : null },
    { key: 'reactions', value: change.reactions.length ? change.reactions : null },
  ];
  return writes;
}
