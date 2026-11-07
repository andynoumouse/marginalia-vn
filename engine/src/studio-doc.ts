// What the animation studio edits of a rig.json: its working copy (`StudioDoc`), read from the parsed file, and the
// top-level properties to write back. Shared by the two hosts of the studio: the editor's rig.json tab and the standalone
// page's character folder (docs/design/animation-studio-parameters.md, Standalone mode).

import type { Anims, Bones, Looks, PartBones, Pivots, RigSettings, RigWrite } from './anim-edit.js';
import { autonomousValue, blinkPart, readRigSettings, speakPart } from './anim-edit.js';
import type { DeformerDef, KeyformDef, PadDef, ParamDef, PoseDef } from './params.js';
import type { MaskDef } from './masks.js';
import type { RigPhysicsChain } from './physics-rig.js';

/** What the studio edits: the character's `categories`, `parameters`, `pads` and `keyforms`, its `animations`, `pivots`, `bones` and `parts`, `idle`, the animation of `speak` and `blink`, its mesh warps (`deformers`) and the clips of its parts (`masks`). */
export interface StudioDoc {
  categories: string[]; parameters: ParamDef[]; pads: PadDef[]; keyforms: KeyformDef[]; poses: Record<string, PoseDef>; physics: Record<string, RigPhysicsChain>;
  deformers: DeformerDef[]; masks: MaskDef[]; anims: Anims; pivots: Pivots; bones: Bones; parts: PartBones; looks: Looks; rig: RigSettings;
}

const object = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, never> : {});
const list = (v: unknown) => (Array.isArray(v) ? v : []);

/** The studio's working copy as a parsed rig.json states it (a missing section is empty). */
export function studioDocOf(data: unknown): StudioDoc {
  const d = object(data);
  return {
    categories: list(d.categories), parameters: list(d.parameters), pads: list(d.pads), keyforms: list(d.keyforms), poses: object(d.poses), physics: object(d.physics),
    deformers: list(d.deformers), masks: list(d.masks), anims: object(d.animations), pivots: object(d.pivots), bones: object(d.bones),
    parts: object(d.parts), looks: object(d.looks), rig: readRigSettings(data),
  };
}

/**
 * The properties of rig.json that `change` sets, for `writeRigText`. An empty list drops its key. `applied` is the
 * settings the file had when the studio opened (or was last applied), `current` the file as parsed now: its own
 * `autonomous` is the base, so keys the studio does not edit (and unknown ones) survive.
 */
export function studioWrites(change: StudioDoc, applied: RigSettings, current: unknown): RigWrite[] {
  const writes: RigWrite[] = [
    { key: 'animations', value: change.anims }, { key: 'pivots', value: change.pivots }, { key: 'bones', value: change.bones },
    { key: 'parts', value: change.parts }, { key: 'looks', value: change.looks }, { key: 'poses', value: change.poses },
    { key: 'physics', value: change.physics },
    { key: 'categories', value: change.categories.length ? change.categories : null },
    { key: 'parameters', value: change.parameters.length ? change.parameters : null }, { key: 'pads', value: change.pads.length ? change.pads : null },
    { key: 'keyforms', value: change.keyforms.length ? change.keyforms : null }, { key: 'deformers', value: change.deformers.length ? change.deformers : null },
    { key: 'masks', value: change.masks.length ? change.masks : null },
  ];
  const now = change.rig;
  if (now.idle !== applied.idle || speakPart(now) !== speakPart(applied) || blinkPart(now) !== blinkPart(applied)) {
    writes.push({ key: 'autonomous', value: autonomousValue(object(current).autonomous, now) });
  }
  return writes;
}
