// Bone-weighted skinning of a free mesh (docs/design/skinning.md): pure maths from sparse per-vertex weights and the bones' world
// matrices to moved vertices. Bones have no rest rotation, so there are no inverse bind matrices: a vertex at canvas position p goes to
//
//   p' = sum over its influences i of  w_i * world(bone_i) * p
//
// Nothing here draws; the renderer feeds it.

import { applyMatrix, type Matrix } from './bones.js';
import { MAX_INFLUENCES, type DeformerMesh } from './params.js';

/** The weights of a mesh compiled for skinning: up to MAX_INFLUENCES bone indices and normalized weights per vertex. */
export interface MeshSkin {
  bones: string[];
  /** Per vertex, MAX_INFLUENCES slots: an index into `bones`, or -1 for an unused slot. A vertex with no bone at all keeps slot 0 at -1 with weight 1 (it stays at rest). */
  index: Int16Array;
  weight: Float32Array;
}

/** Is the mesh skinned (does it carry `weights`)? */
export const isSkinned = (mesh: Pick<DeformerMesh, 'weights'> | undefined | null): boolean => !!mesh && mesh.weights !== undefined && mesh.weights !== null;

/**
 * Compile `mesh.weights` for `n` vertices. A vertex that is not listed binds 100% to `defaultBone` (at rest when there is none).
 * Weights are read as relative: entries that are not a finite number above 0 are ignored, the 4 largest are kept and the rest
 * normalized to a sum of 1. A listed vertex with nothing usable falls back to the default like an unlisted one.
 */
export function compileSkin(mesh: Pick<DeformerMesh, 'weights' | 'defaultBone'>, n: number): MeshSkin {
  const bones: string[] = [], at = new Map<string, number>();
  const slot = (b: string) => { let i = at.get(b); if (i === undefined) { i = bones.length; bones.push(b); at.set(b, i); } return i; };
  const index = new Int16Array(n * MAX_INFLUENCES).fill(-1), weight = new Float32Array(n * MAX_INFLUENCES);
  const fallback = typeof mesh.defaultBone === 'string' ? slot(mesh.defaultBone) : -1;
  for (let v = 0; v < n; v++) {
    const own = mesh.weights && Object.hasOwn(mesh.weights, String(v)) ? mesh.weights[String(v)] : undefined;
    const picks = own && typeof own === 'object'
      ? Object.entries(own).filter(([, w]) => typeof w === 'number' && Number.isFinite(w) && w > 0).sort((p, q) => q[1] - p[1]).slice(0, MAX_INFLUENCES)
      : [];
    const o = v * MAX_INFLUENCES;
    if (!picks.length) { index[o] = fallback; weight[o] = 1; continue; }
    const sum = picks.reduce((s, [, w]) => s + w, 0);
    picks.forEach(([b, w], k) => { index[o + k] = slot(b); weight[o + k] = w / sum; });
  }
  return { bones, index, weight };
}

/**
 * Skin `rest` (interleaved x, y in the part's own frame, `origin` being where that frame sits on the canvas) into `out`, in the same
 * frame. `key` is the part's own animated matrix, put on the vertices in canvas pixels before the bones. A bone without a matrix
 * is at rest. `out` may be `rest` itself.
 */
export function skinPoints(skin: MeshSkin, rest: ArrayLike<number>, origin: readonly [number, number], bones: Readonly<Record<string, Matrix>>, out: { [i: number]: number; length: number }, key?: Matrix): void {
  const mats = skin.bones.map(b => (Object.hasOwn(bones, b) ? bones[b] : undefined));
  const n = Math.min(rest.length, out.length) >> 1;
  for (let v = 0; v < n; v++) {
    let x = rest[v * 2] + origin[0], y = rest[v * 2 + 1] + origin[1];
    if (key) [x, y] = applyMatrix(key, x, y);
    let sx = 0, sy = 0;
    for (let k = 0; k < MAX_INFLUENCES; k++) {
      const o = v * MAX_INFLUENCES + k, w = skin.weight[o];
      if (w === 0) continue;
      const m = skin.index[o] >= 0 ? mats[skin.index[o]] : undefined;
      if (m) { const [px, py] = applyMatrix(m, x, y); sx += w * px; sy += w * py; } else { sx += w * x; sy += w * y; }
    }
    out[v * 2] = sx - origin[0];
    out[v * 2 + 1] = sy - origin[1];
  }
}
