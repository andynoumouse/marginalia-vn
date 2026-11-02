// What a layered character is made of, for the animation studio's Parts tree: its parts (slots with their variants,
// plain layers) top layer first, the rig.json groups, and the poses with the variants each one picks.

import { rigLayers, type RigManifest } from './assets.js';
import { orderedParts, partGroups, partName } from './rig.js';

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
  /** The rig.json groups it belongs to. */
  groups: string[];
}
export interface OutlineGroup {
  name: string;
  parts: string[];
  /** It has a slot, so `show mina <group>=<variant>` dresses it (else it only moves its parts). */
  dresses: boolean;
}
export interface OutlinePose {
  name: string;
  /** A rig.json `poses` shorthand, or a pose tag on PSD variants. */
  from: 'rig' | 'art';
  /** The slot variants it shows that differ from the default look. */
  picks: Record<string, string>;
}
export interface RigOutline { parts: OutlinePart[]; groups: OutlineGroup[]; poses: OutlinePose[] }

/** The character `rig` as the studio lists it, with what `pose` and the slot `overrides` put on stage. */
export function rigOutline(rig: RigManifest, pose: string | null, overrides: Record<string, string>): RigOutline {
  const groups = partGroups(rig);
  const drawn = (p: string | null, o: Record<string, string>) => new Map(rigLayers(rig, p, o).map(l => [l.part, l.file]));
  const now = drawn(pose, overrides);
  const parts: OutlinePart[] = orderedParts(rig).slice().reverse().map(p => {
    const name = partName(p), file = now.get(name) ?? null;
    const inGroups = Object.keys(groups).filter(g => groups[g].includes(name));
    if (!p.slot || !p.variants) return { name, kind: 'layer', file, variants: [], shown: null, groups: inGroups };
    const variants = Object.entries(p.variants).map(([v, x]) => ({ name: v, file: x.file ?? null, poses: x.poses ?? [], isDefault: v === p.default }));
    return { name, kind: 'slot', file, variants, shown: variants.find(v => v.file !== null && v.file === file)?.name ?? null, groups: inGroups };
  });
  const slots = new Set(parts.filter(p => p.kind === 'slot').map(p => p.name));

  const base = drawn(null, {});
  const picks = (p: string): Record<string, string> => {
    const look = drawn(p, {}), out: Record<string, string> = {};
    for (const part of parts) {
      if (part.kind !== 'slot' || look.get(part.name) === base.get(part.name)) continue;
      out[part.name] = part.variants.find(v => v.file === look.get(part.name))?.name ?? 'none';
    }
    return out;
  };
  const tags = [...new Set(parts.flatMap(p => p.variants.flatMap(v => v.poses)))];
  const poses: OutlinePose[] = [
    ...Object.keys(rig.rig?.poses ?? {}).map(name => ({ name, from: 'rig' as const, picks: picks(name) })),
    ...tags.filter(t => !Object.hasOwn(rig.rig?.poses ?? {}, t)).map(name => ({ name, from: 'art' as const, picks: picks(name) })),
  ];
  return {
    parts,
    groups: Object.entries(groups).map(([name, members]) => ({ name, parts: members, dresses: members.some(m => slots.has(m)) })),
    poses,
  };
}
