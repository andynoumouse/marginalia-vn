// What a layered character is made of, for the animation studio's Parts tree: its parts (slots with their variants,
// plain layers) top layer first, the rig.json bones, and the looks with the variants each one picks.

import { rigLayers, type RigManifest } from './assets.js';
import { orderedParts, partName } from './rig.js';
import { boneOrder, partsUnder } from './bones.js';

export interface OutlineVariant {
  name: string;
  /** The image under assets/char/<char>/ (null when the variant has none). */
  file: string | null;
  /** The pose names the PSD tags this variant with (`show mina happy` picks it). */
  poses: string[];
  isDefault: boolean;
}
export interface OutlinePart {
  name: string;
  /** A slot shows one of its variants at a time; a layer is one image, always drawn. */
  kind: 'slot' | 'layer';
  /** The image drawn for it with the given pose and overrides; null when nothing is (a slot set to none, or no variant fits). */
  file: string | null;
  variants: OutlineVariant[];
  /** The variant shown with the given pose and overrides (slots only). */
  shown: string | null;
  /** The bone it sits on (rig.json `parts`), if any. */
  bone: string | null;
}
export interface OutlineBone {
  name: string;
  /** Its parent bone, if any. */
  parent: string | null;
  /** The parts on it and on the bones below it. */
  parts: string[];
}
export interface OutlineLook {
  name: string;
  /** A rig.json `looks` entry, or a pose tag on PSD variants (an implicit look). */
  from: 'rig' | 'art';
  /** The slot variants it shows that differ from the default look. */
  picks: Record<string, string>;
}
export interface RigOutline { parts: OutlinePart[]; bones: OutlineBone[]; looks: OutlineLook[] }

/** The character `rig` as the studio lists it, with what the `looks` (applied left to right) and the slot `overrides` put on stage. */
export function rigOutline(rig: RigManifest, looks: string[], overrides: Record<string, string>): RigOutline {
  const bones = rig.rig?.bones ?? {}, onBone = Object.fromEntries(Object.entries(rig.rig?.parts ?? {}).map(([n, d]) => [n, d?.bone]));
  const drawn = (p: string[], o: Record<string, string>) => new Map(rigLayers(rig, p, o).map(l => [l.part, l.file]));
  const now = drawn(looks, overrides);
  const parts: OutlinePart[] = orderedParts(rig).slice().reverse().map(p => {
    const name = partName(p), file = now.get(name) ?? null;
    if (!p.slot || !p.variants) return { name, kind: 'layer', file, variants: [], shown: null, bone: typeof onBone[name] === 'string' && Object.hasOwn(bones, onBone[name]!) ? onBone[name]! : null };
    const variants = Object.entries(p.variants).map(([v, x]) => ({ name: v, file: x.file ?? null, poses: x.poses ?? [], isDefault: v === p.default }));
    return { name, kind: 'slot', file, variants, shown: variants.find(v => v.file !== null && v.file === file)?.name ?? null, bone: typeof onBone[name] === 'string' && Object.hasOwn(bones, onBone[name]!) ? onBone[name]! : null };
  });
  const base = drawn([], {});
  const picks = (p: string): Record<string, string> => {
    const look = drawn([p], {}), out: Record<string, string> = {};
    for (const part of parts) {
      if (part.kind !== 'slot' || look.get(part.name) === base.get(part.name)) continue;
      out[part.name] = part.variants.find(v => v.file === look.get(part.name))?.name ?? 'none';
    }
    return out;
  };
  const tags = [...new Set(parts.flatMap(p => p.variants.flatMap(v => v.poses)))];
  const lookList: OutlineLook[] = [
    ...Object.keys(rig.rig?.looks ?? {}).map(name => ({ name, from: 'rig' as const, picks: picks(name) })),
    ...tags.filter(t => !Object.hasOwn(rig.rig?.looks ?? {}, t)).map(name => ({ name, from: 'art' as const, picks: picks(name) })),
  ];
  return {
    parts,
    bones: boneOrder(bones).map(name => ({ name, parent: typeof bones[name].parent === 'string' ? bones[name].parent! : null, parts: partsUnder(bones, onBone, name) })),
    looks: lookList,
  };
}
