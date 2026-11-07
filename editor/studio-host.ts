// What both hosts of the animation studio tell it about a character, from its manifest (sprite.json with its rig.json attached)
// and the rig.json as parsed: the parts, looks, slots and canvas size, which parts a pose and slot variants draw, and the Parts
// tree's outline. The editor gets them from the project's assets, the standalone page from the character folder.

import { partName, rigLayers, rigLookNames, rigOutline, type RigManifest } from '../engine/src/index.js';
import type { StudioHost } from './anim-studio.js';

const object = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, never> : {});

export function manifestHost(manifest: RigManifest | undefined, rigData: unknown): Pick<StudioHost, 'parts' | 'looks' | 'slots' | 'width' | 'height' | 'shown' | 'outline'> {
  const slots: Record<string, string[]> = {};
  for (const part of manifest?.parts ?? []) if (part.slot && part.variants) slots[part.slot] = Object.keys(part.variants);
  return {
    parts: manifest ? (manifest.parts ?? []).map(partName) : [],
    looks: manifest ? rigLookNames(manifest) : [],
    slots,
    width: manifest?.width ?? 0,
    height: manifest?.height ?? 0,
    shown: manifest ? (pose, overrides) => rigLayers(manifest, pose ? [pose] : [], overrides).map(l => l.part) : undefined,
    outline: manifest ? (pose, overrides, looks) => rigOutline({ ...manifest, rig: { ...object(rigData), looks } }, pose ? [pose] : [], overrides) : undefined,
  };
}
