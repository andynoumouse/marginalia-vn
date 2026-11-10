// Renaming a bone (the Parts tree's Rename in the animation studio's Model mode): the pure half. A bone is named by its children's
// `parent`, the parts and mask shapes that sit on it, the keyforms that target it, animation keys (`part`), physics inputs (`bone`) and
// outputs (`part`), and the weights of skinned meshes (`weights`, `defaultBone`), so a rename has to reach all of them. The function
// takes the parts of the working copy that can name a bone (`BoneDoc`), returns a changed copy and leaves its input alone. A refusal
// is `{ error }` with a sentence for the author. Scripts are not in the document, so an `animate <char> <anim> part=<bone>` line is
// not followed (the note says so).

import { deleteBone, type Anims, type Bones, type PartBones } from './anim-edit.js';
import type { ShapeDef } from './masks.js';
import type { RigPhysicsChain } from './physics-rig.js';
import type { DeformerDef, KeyformDef } from './params.js';
import { boundBones, removeBoneWeights, renameWeightBone } from './skin-edit.js';
import { plural } from './util.js';

/** What can name a bone: the working copy's bones and everything that refers to one. */
export interface BoneDoc {
  bones: Bones;
  /** rig.json `parts`: which bone each image part sits on. */
  parts: PartBones;
  /** The mask shapes (imageless parts with a polygon); a shape's `bone` places it with that bone. */
  shapes: Record<string, ShapeDef>;
  keyforms: KeyformDef[];
  anims: Anims;
  deformers: DeformerDef[];
  physics: Record<string, RigPhysicsChain>;
}
export type BoneEdit = { doc: BoneDoc; note: string; name: string } | { error: string };

/** What a bone may be called: letters, digits, _ and -, starting with a letter or _ (a word a script's `animate ... part=<name>` can say). */
export const BONE_NAME = /^[A-Za-z_][\w-]*$/;


/**
 * Bone `from` renamed to `to` (trimmed) everywhere in `doc`; `partNames` are the image parts' names, which a bone may not take (nor a
 * shape's: `checkRig` warns about a bone named like a part, and the tree could not tell them apart). The bones keep their order; the
 * note counts what followed the name.
 */
export function renameBone(doc: BoneDoc, from: string, to: string, partNames: Iterable<string>): BoneEdit {
  const name = to.trim();
  if (!Object.hasOwn(doc.bones, from)) return { error: `There is no bone "${from}".` };
  if (name === from) return { error: `The bone is named "${from}" already.` };
  if (!BONE_NAME.test(name)) return { error: 'A bone name has letters, digits, _ and - only, and starts with a letter or _.' };
  if (Object.hasOwn(doc.bones, name)) return { error: `There is a bone named "${name}" already.` };
  if (Object.hasOwn(doc.shapes, name)) return { error: `"${name}" is a mask shape: a bone cannot take a part's name.` };
  for (const p of partNames) if (p === name) return { error: `"${name}" is a part: a bone cannot take a part's name.` };

  let children = 0, parts = 0, shapes = 0, keyforms = 0, keys = 0, inputs = 0, outputs = 0, meshes = 0;
  const animsTouched = new Set<string>();
  const bones: Bones = {};
  for (const [b, def] of Object.entries(doc.bones)) {
    const key = b === from ? name : b;
    if (def.parent === from) { children++; bones[key] = { ...def, parent: name }; } else bones[key] = def;
  }
  const partsOut: PartBones = Object.fromEntries(Object.entries(doc.parts).map(([p, def]) => {
    if (def?.bone !== from) return [p, def];
    parts++;
    return [p, { ...def, bone: name }];
  }));
  const shapesOut: Record<string, ShapeDef> = Object.fromEntries(Object.entries(doc.shapes).map(([s, def]) => {
    if (def.bone !== from) return [s, def];
    shapes++;
    return [s, { ...def, bone: name }];
  }));
  const keyformsOut = doc.keyforms.map(k => {
    if (k.target !== from) return k;
    keyforms++;
    return { ...k, target: name };
  });
  const anims: Anims = Object.fromEntries(Object.entries(doc.anims).map(([n, a]) => {
    if (!a?.keys?.some(k => k.part === from)) return [n, a];
    animsTouched.add(n);
    return [n, { ...a, keys: a.keys.map(k => { if (k.part !== from) return k; keys++; return { ...k, part: name }; }) }];
  }));
  const physics: Record<string, RigPhysicsChain> = Object.fromEntries(Object.entries(doc.physics).map(([id, c]) => {
    if (!(c.inputs ?? []).some(i => i.bone === from) && !(c.outputs ?? []).some(o => o.part === from)) return [id, c];
    return [id, {
      ...c,
      inputs: (c.inputs ?? []).map(i => { if (i.bone !== from) return i; inputs++; return { ...i, bone: name }; }),
      outputs: (c.outputs ?? []).map(o => { if (o.part !== from) return o; outputs++; return { ...o, part: name }; }),
    }];
  }));
  const deformers = doc.deformers.map(d => {
    if (!d.mesh || !boundBones(d.mesh).includes(from)) return d;
    meshes++;
    return { ...d, mesh: renameWeightBone(d.mesh, from, name) };
  });

  const followed = [
    children ? plural(children, 'child bone') : '',
    parts ? plural(parts, 'part') : '',
    shapes ? plural(shapes, 'mask shape') : '',
    keyforms ? plural(keyforms, 'keyform') : '',
    keys ? `${plural(keys, 'key')} in ${plural(animsTouched.size, 'animation')}` : '',
    inputs ? plural(inputs, 'physics input') : '',
    outputs ? plural(outputs, 'physics output') : '',
    meshes ? plural(meshes, 'skinned mesh', 'skinned meshes') : '',
  ].filter(Boolean);
  const note = `Renamed ${from} to ${name}${followed.length ? `; the name followed in ${followed.join(', ')}` : ''}. Script lines that say part=${from} are not changed.`;
  return { doc: { bones, parts: partsOut, shapes: shapesOut, keyforms: keyformsOut, anims, deformers, physics }, note, name };
}

/**
 * Bone `name` removed from `doc` (the Parts tree's Remove bone): its children, the parts and the mask shapes on it, and the weights of the
 * skinned meshes that name it go to its parent (or to the top, the weights then dropped); what only made sense for the bone goes with it:
 * the keyforms that target it, the animation keys that move it, and the physics inputs that read it and outputs that turn it. Before, those
 * stayed behind and the rig check flagged them as naming nothing. The note says what moved and what went; Ctrl+Z brings it all back.
 */
export function removeBone(doc: BoneDoc, name: string): BoneEdit {
  if (!Object.hasOwn(doc.bones, name)) return { error: `There is no bone "${name}".` };
  const parent = doc.bones[name].parent;
  const up = typeof parent === 'string' && parent !== name && Object.hasOwn(doc.bones, parent) ? parent : null;
  const children = Object.values(doc.bones).filter(b => b.parent === name).length;
  const moved = deleteBone(doc.bones, doc.parts, name);
  const parts = Object.values(doc.parts).filter(p => p?.bone === name).length;
  let shapes = 0, keys = 0, inputs = 0, outputs = 0;
  const shapesOut: Record<string, ShapeDef> = Object.fromEntries(Object.entries(doc.shapes).map(([s, def]) => {
    if (def.bone !== name) return [s, def];
    shapes++;
    const { bone: _, ...rest } = def;
    return [s, up === null ? rest : { ...rest, bone: up }];
  }));
  const keyformsOut = doc.keyforms.filter(k => k.target !== name), keyforms = doc.keyforms.length - keyformsOut.length;
  const animsTouched = new Set<string>();
  const anims: Anims = Object.fromEntries(Object.entries(doc.anims).map(([n, a]) => {
    if (!a?.keys?.some(k => k.part === name)) return [n, a];
    animsTouched.add(n);
    const kept = a.keys.filter(k => k.part !== name);
    keys += a.keys.length - kept.length;
    return [n, { ...a, keys: kept }];
  }));
  const physics: Record<string, RigPhysicsChain> = Object.fromEntries(Object.entries(doc.physics).map(([id, c]) => {
    const ins = (c.inputs ?? []).filter(i => i.bone !== name), outs = (c.outputs ?? []).filter(o => o.part !== name);
    inputs += (c.inputs ?? []).length - ins.length;
    outputs += (c.outputs ?? []).length - outs.length;
    return ins.length === (c.inputs ?? []).length && outs.length === (c.outputs ?? []).length ? [id, c] : [id, { ...c, inputs: ins, outputs: outs }];
  }));
  const deformers = removeBoneWeights(doc.deformers, name, up);
  const meshes = deformers.filter((d, i) => d !== doc.deformers[i]).length;

  const where = up ?? 'the top';
  const passed = [
    children ? plural(children, 'child bone') : '',
    parts ? plural(parts, 'part') : '',
    shapes ? plural(shapes, 'mask shape') : '',
    meshes && up !== null ? `the weights of ${plural(meshes, 'skinned mesh', 'skinned meshes')}` : '',
  ].filter(Boolean);
  const dropped = meshes && up === null ? `; its weights in ${plural(meshes, 'skinned mesh', 'skinned meshes')} were dropped (it had no parent to take them)` : '';
  const went = [
    keyforms ? plural(keyforms, 'keyform') : '',
    keys ? `${plural(keys, 'key')} in ${plural(animsTouched.size, 'animation')}` : '',
    inputs ? plural(inputs, 'physics input') : '',
    outputs ? plural(outputs, 'physics output') : '',
  ].filter(Boolean);
  const note = `Removed ${name}${passed.length ? `; ${passed.join(', ')} went to ${where}` : ''}${went.length ? `; ${went.join(', ')} that moved it went with it` : ''}${dropped}. Ctrl+Z brings it back.`;
  return { doc: { bones: moved.bones, parts: moved.parts, shapes: shapesOut, keyforms: keyformsOut, anims, deformers, physics }, note, name };
}
