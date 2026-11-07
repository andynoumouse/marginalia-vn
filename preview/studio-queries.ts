// The studio's read-only questions about the characters on stage: where a mask, lattice or bone is, in which space. They only read the
// actors the renderer keeps and the rig files; nothing here draws.

import { Texture, type MeshPlane, type Sprite } from 'pixi.js';
import { deformerGrid, gizmoTarget, type AssetContext, type GizmoTarget, type Offset, type PlacedPart, type RigGeometry } from '../engine/src/index.js';
import { FX, applyM, type Actor } from './pixi-actor.js';

/** The rig in the actor's container space: the PSD canvas shifted so the origin is the bottom middle (`ox`, `oy` is the shift). */
export function rigGeometry(files: AssetContext, a: Actor): RigGeometry & { ox: number; oy: number } {
  const rig = files.rigs[a.s.char], data = rig?.rig;
  const ox = (rig?.width ?? 0) / 2, oy = rig?.height ?? 0;
  const legacy = (name: string): [number, number] | null => { const pv = data?.pivots?.[name]; return pv ? [pv[0] - ox, pv[1] - oy] : null; };
  // Bone pivots are PSD pixels like part pivots; part boxes are already local, so shift them the same way.
  const bones = Object.fromEntries(Object.entries(data?.bones ?? {}).map(([b, d]) => [b, Array.isArray(d.pivot) ? { ...d, pivot: [d.pivot[0] - ox, d.pivot[1] - oy] as [number, number] } : d]));
  const parts: Record<string, PlacedPart> = {};
  for (const [name, c] of a.parts) {
    const sp = c.children[0] as Sprite | MeshPlane, pv = data?.parts?.[name]?.pivot;
    parts[name] = { box: { x: sp.x, y: sp.y, w: sp.texture.width, h: sp.texture.height }, bone: data?.parts?.[name]?.bone, pivot: pv ? [pv[0] - ox, pv[1] - oy] : undefined };
  }
  return { bones, parts, pivotOf: legacy, unit: FX(), origin: [0, 0], ox, oy };
}

export class StudioQueries {
  constructor(private actors: Map<string, Actor>, private files: () => AssetContext) {}

  /**
   * The mask clipping `part` as drawn now, in stage pixels: its outlines, and whether it is a polygon (which has points to drag). Null for
   * a part with no mask in the pose on show.
   */
  studioMask(char: string, part: string): { id: string; polygon: boolean; outlines: [number, number][][] } | null {
    const m = this.actors.get(char)?.masks.find(n => n.def.part === part);
    if (!m) return null;
    return { id: m.def.id, polygon: !!m.def.polygon, outlines: m.drawn.map(pts => { const o: [number, number][] = []; for (let i = 0; i + 1 < pts.length; i += 2) { const g = m.g.toGlobal({ x: pts[i], y: pts[i + 1] }); o.push([g.x, g.y]); } return o; }) };
  }
  /** How far stage pixel `to` lies from `from` in the space of `part`'s mask shape (canvas pixels, whatever its bone or animation does); a polygon point dragged between the two has moved so far. */
  studioMaskDelta(char: string, part: string, from: [number, number], to: [number, number]): [number, number] | null {
    const m = this.actors.get(char)?.masks.find(n => n.def.part === part);
    if (!m) return null;
    const p = m.g.toLocal({ x: from[0], y: from[1] }), q = m.g.toLocal({ x: to[0], y: to[1] });
    return [q.x - p.x, q.y - p.y];
  }
  /** A part's image box in canvas pixels (where a new drawn mask starts); null when the part is not drawn. */
  studioPartBox(char: string, part: string): { x: number; y: number; w: number; h: number } | null {
    const a = this.actors.get(char), rig = this.files().rigs[char], sp = a?.parts.get(part)?.children[0] as Sprite | MeshPlane | undefined;
    if (!a || !rig || !sp || sp.texture === Texture.EMPTY) return null;
    return { x: sp.x + (rig.width ?? 0) / 2, y: sp.y + (rig.height ?? 0), w: sp.texture.width, h: sp.texture.height };
  }
  /** A stage pixel in canvas pixels, the space a polygon's points are written in, as the character stands now. */
  studioCanvasPoint(char: string, p: [number, number]): [number, number] | null {
    const a = this.actors.get(char), rig = this.files().rigs[char];
    if (!a || !rig) return null;
    const l = a.body.toLocal({ x: p[0], y: p[1] });
    return [l.x + (rig.width ?? 0) / 2, l.y + (rig.height ?? 0)];
  }
  /** The gizmo target for a part or bone of `char` in the pose on show (or with `offsets`, by name). */
  studioTarget(char: string, name: string, offsets?: ReadonlyMap<string, Offset>): (GizmoTarget & { ox: number; oy: number; unit: number }) | null {
    const a = this.actors.get(char);
    if (!a) return null;
    const g = rigGeometry(this.files(), a), t = gizmoTarget(g, offsets ?? a.partPose, name);
    return t ? { ...t, ox: g.ox, oy: g.oy, unit: g.unit } : null;
  }
  /** Where each bone's pivot is in the pose on show (actor space), with its parent's, for drawing the skeleton. */
  studioSkeleton(char: string): { name: string; at: [number, number]; from?: [number, number] }[] {
    const a = this.actors.get(char);
    if (!a) return [];
    const g = rigGeometry(this.files(), a), out: { name: string; at: [number, number]; from?: [number, number] }[] = [];
    const where = (n: string) => { const t = gizmoTarget(g, a.partPose, n); return t ? applyM(t.parent, t.pivot[0] + t.offset.dx * g.unit, t.pivot[1] + t.offset.dy * g.unit) : null; };
    for (const [n, d] of Object.entries(g.bones)) {
      const at = where(n), from = typeof d.parent === 'string' && Object.hasOwn(g.bones, d.parent) ? where(d.parent) : null;
      if (at) out.push({ name: n, at, from: from ?? undefined });
    }
    return out;
  }
  /** Converts between the actor's container space (where pivots live) and stage pixels. */
  studioSpace(char: string): { toStage(p: [number, number]): [number, number]; fromStage(p: [number, number]): [number, number] } | null {
    const a = this.actors.get(char);
    if (!a) return null;
    return {
      toStage: p => { const g = a.body.toGlobal({ x: p[0], y: p[1] }); return [g.x, g.y]; },
      fromStage: p => { const l = a.body.toLocal({ x: p[0], y: p[1] }); return [l.x, l.y]; },
    };
  }
  /**
   * The lattice of `part`'s warp as drawn now: the control points in stage pixels (row-major), and the part's image box in
   * animation units (the unit a displacement is in). Null when the part has no warp.
   */
  studioLattice(char: string, part: string): { cols: number; rows: number; points: [number, number][]; box: { w: number; h: number } } | null {
    const w = this.actors.get(char)?.warps.get(part);
    if (!w) return null;
    const [cols, rows] = deformerGrid(w.def), pos = w.mesh.geometry.getBuffer('aPosition').data as Float32Array, points: [number, number][] = [];
    for (let i = 0; i + 1 < pos.length; i += 2) { const g = w.mesh.toGlobal({ x: pos[i], y: pos[i + 1] }); points.push([g.x, g.y]); }
    return { cols, rows, points, box: { w: w.mesh.texture.width / FX(), h: w.mesh.texture.height / FX() } };
  }
  /**
   * How far stage pixel `to` lies from `from` in `part`'s own space (before its bone, the animation and the placement move
   * it), in animation units: what a lattice point dragged between the two has moved.
   */
  studioLatticeDelta(char: string, part: string, from: [number, number], to: [number, number]): [number, number] | null {
    const mesh = this.actors.get(char)?.warps.get(part)?.mesh;
    if (!mesh) return null;
    const a = mesh.toLocal({ x: from[0], y: from[1] }), b = mesh.toLocal({ x: to[0], y: to[1] });
    return [(b.x - a.x) / FX(), (b.y - a.y) / FX()];
  }
  /** The stage-pixel box the character's art covers. */
  studioBounds(char: string): { x: number; y: number; w: number; h: number } | null {
    const a = this.actors.get(char);
    if (!a || !a.parts.size) return null;
    const b = a.body.getBounds();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  }
}
