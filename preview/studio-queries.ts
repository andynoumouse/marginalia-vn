// The studio's read-only questions about the characters on stage: where a mask, lattice or bone is, in which space. They only read the
// actors the renderer keeps and the rig files; nothing here draws.

import { Texture, type MeshPlane, type Sprite } from 'pixi.js';
import { deformerGrid, evalDeformer, gizmoTarget, meshEdges, restLattice, unwarpMeshPoint, warpMemberMesh, type AssetContext, type GizmoTarget, type Offset, type PlacedPart, type RigGeometry } from '../engine/src/index.js';
import { FX, applyM, type Actor } from './pixi-actor.js';

/** The rig in the actor's container space: the PSD canvas shifted so the origin is the bottom middle (`ox`, `oy` is the shift). */
export function rigGeometry(files: AssetContext, a: Actor): RigGeometry & { ox: number; oy: number } {
  const rig = files.rigs[a.s.char], data = rig?.rig;
  const ox = (rig?.width ?? 0) / 2, oy = rig?.height ?? 0;
  const partPivot = (name: string): [number, number] | null => { const pv = data?.pivots?.[name]; return pv ? [pv[0] - ox, pv[1] - oy] : null; };
  // Bone pivots are PSD pixels like part pivots; part boxes are already local, so shift them the same way.
  const bones = Object.fromEntries(Object.entries(data?.bones ?? {}).map(([b, d]) => [b, Array.isArray(d.pivot) ? { ...d, pivot: [d.pivot[0] - ox, d.pivot[1] - oy] as [number, number] } : d]));
  const parts: Record<string, PlacedPart> = {};
  for (const [name, c] of a.parts) {
    const sp = c.children[0] as Sprite | MeshPlane, pv = data?.parts?.[name]?.pivot;
    parts[name] = { box: { x: sp.x, y: sp.y, w: sp.texture.width, h: sp.texture.height }, bone: data?.parts?.[name]?.bone, pivot: pv ? [pv[0] - ox, pv[1] - oy] : undefined };
  }
  return { bones, parts, pivotOf: partPivot, unit: FX(), origin: [0, 0], ox, oy };
}

export class StudioQueries {
  constructor(private actors: Map<string, Actor>, private files: () => AssetContext) {}

  /** The stage node drawing mask shape `shape` (one per part it clips; they draw the same outline). */
  private maskNode(char: string, shape: string) { return this.actors.get(char)?.masks.find(n => n.def.shape === shape); }
  /**
   * Mask shape `shape` as drawn now, in stage pixels: its outlines, and whether it is a polygon (which has points to drag). Null for a shape
   * that is not on stage in the pose on show.
   */
  studioMask(char: string, shape: string): { id: string; polygon: boolean; outlines: [number, number][][] } | null {
    const m = this.maskNode(char, shape);
    if (!m) return null;
    return { id: m.def.id, polygon: !!m.def.polygon, outlines: m.drawn.map(pts => { const o: [number, number][] = []; for (let i = 0; i + 1 < pts.length; i += 2) { const g = m.g.toGlobal({ x: pts[i], y: pts[i + 1] }); o.push([g.x, g.y]); } return o; }) };
  }
  /** Every mask shape on stage with its outlines in stage pixels (each shape once): what the Mask tool draws and picks from. */
  studioShapes(char: string): { name: string; outlines: [number, number][][] }[] {
    const out: { name: string; outlines: [number, number][][] }[] = [], seen = new Set<string>();
    for (const m of this.actors.get(char)?.masks ?? []) {
      const name = m.def.shape;
      if (name === undefined || seen.has(name)) continue;
      seen.add(name);
      const info = this.studioMask(char, name);
      if (info) out.push({ name, outlines: info.outlines });
    }
    return out;
  }
  /** How far stage pixel `to` lies from `from` in the space of shape `shape` (canvas pixels, whatever its bone or animation does); a polygon point dragged between the two has moved so far. */
  studioMaskDelta(char: string, shape: string, from: [number, number], to: [number, number]): [number, number] | null {
    const m = this.maskNode(char, shape);
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
    const a = this.actors.get(char), w = a?.warps.get(part);
    if (!w?.def || w.tris) return null; // a free mesh has no lattice: see studioMesh; a part that is only in a group warp has no lattice of its own: see studioDeformerLattice
    const grid = deformerGrid(w.def), [cols, rows] = grid, own = restLattice(w.mesh.texture.width, w.mesh.texture.height, grid), points: [number, number][] = [];
    // The control points as drawn: the own lattice's displacement, then the group's at each point's rest position.
    const pos = warpMemberMesh(own, grid, { grid, disp: evalDeformer(w.def, a!.warpValues) }, w.group ? { box: w.group.box, grid: deformerGrid(w.group.def), disp: w.group.disp } : null, w.origin, FX());
    for (let i = 0; i + 1 < pos.length; i += 2) { const g = w.mesh.toGlobal({ x: pos[i], y: pos[i + 1] }); points.push([g.x, g.y]); }
    return { cols, rows, points, box: { w: w.mesh.texture.width / FX(), h: w.mesh.texture.height / FX() } };
  }
  /**
   * The free mesh of `part` as drawn now: its vertices in stage pixels (own displacement, then the group's), the unique triangle edges as
   * vertex index pairs, the triangle indices, the part's image box in animation units (as studioLattice) and its size in pixels (the unit of `mesh.verts`). Null when the part has no free mesh on stage.
   * Vertices are in `mesh.verts` order, so a keyform `pts` index addresses `verts[index]`; studioLatticeDelta measures a drag.
   */
  studioMesh(char: string, part: string): { verts: [number, number][]; edges: [number, number][]; tris: number[]; box: { w: number; h: number }; size: { w: number; h: number } } | null {
    const w = this.actors.get(char)?.warps.get(part);
    if (!w?.tris) return null;
    const pos = w.mesh.geometry.getBuffer('aPosition').data as Float32Array, verts: [number, number][] = [];
    for (let i = 0; i + 1 < pos.length; i += 2) { const g = w.mesh.toGlobal({ x: pos[i], y: pos[i + 1] }); verts.push([g.x, g.y]); }
    return { verts, edges: meshEdges(w.tris), tris: Array.from(w.tris), box: { w: w.mesh.texture.width / FX(), h: w.mesh.texture.height / FX() }, size: { w: w.mesh.texture.width, h: w.mesh.texture.height } };
  }
  /** As studioMesh, for the deformer `id` (the part that has it): what the Warp tool draws for a free mesh. Null for a lattice or an id not on stage. */
  studioDeformerMesh(char: string, id: string) {
    const part = [...(this.actors.get(char)?.warps ?? [])].find(([, w]) => w.def?.id === id)?.[0];
    return part ? this.studioMesh(char, part) : null;
  }
  /**
   * Where stage pixel `p` lies on the undeformed art of the free mesh `id`: the rest position, in the part's image pixels, of whatever the
   * mesh draws there in the pose on show. Null outside the mesh (or for an id that has no free mesh on stage).
   */
  studioDeformerRestPoint(char: string, id: string, p: [number, number]): [number, number] | null {
    const w = [...(this.actors.get(char)?.warps ?? [])].find(([, x]) => x.def?.id === id)?.[1];
    if (!w?.tris) return null;
    const l = w.mesh.toLocal({ x: p[0], y: p[1] });
    return unwarpMeshPoint(w.rest, w.mesh.geometry.getBuffer('aPosition').data as Float32Array, w.tris, l.x, l.y);
  }
  /**
   * The alpha channel of `part`'s image (one byte per pixel, rows top to bottom, `w` x `h` the texture size): what the mesh generator
   * reads. Null when the part is not drawn or its pixels cannot be read.
   */
  studioPartAlpha(char: string, part: string): { w: number; h: number; alpha: Uint8Array } | null {
    const sp = this.actors.get(char)?.parts.get(part)?.children[0] as Sprite | MeshPlane | undefined;
    if (!sp || sp.texture === Texture.EMPTY) return null;
    const t = sp.texture, res = t.source.resource as CanvasImageSource | undefined, w = t.width, h = t.height;
    if (!res || !(w >= 1) || !(h >= 1)) return null;
    try {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      const r = t.source.resolution || 1, f = t.frame;
      ctx.drawImage(res, f.x * r, f.y * r, f.width * r, f.height * r, 0, 0, w, h);
      const px = ctx.getImageData(0, 0, w, h).data, alpha = new Uint8Array(w * h);
      for (let i = 0; i < alpha.length; i++) alpha[i] = px[i * 4 + 3];
      return { w, h, alpha };
    } catch { return null; }
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
  /**
   * The lattice of the deformer `id` as drawn now: a part warp's (as studioLattice) or a group warp's. The control points are in stage
   * pixels (row-major); `box` is the lattice's size in animation units (the unit a displacement is in) and `canvas` its box [x, y, w, h]
   * in PSD canvas pixels; `part` or `members` say what it warps (the members that are on stage). Null for an id with no mesh on stage.
   */
  studioDeformerLattice(char: string, id: string): { id: string; part?: string; members?: string[]; cols: number; rows: number; points: [number, number][]; box: { w: number; h: number }; canvas: [number, number, number, number] } | null {
    const a = this.actors.get(char);
    if (!a) return null;
    const g = a.groups.get(id);
    if (!g) {
      const part = [...a.warps].find(([, w]) => w.def?.id === id)?.[0], l = part ? this.studioLattice(char, part) : null, w = part ? a.warps.get(part) : undefined;
      return part && l && w ? { id, part, ...l, canvas: [w.origin[0], w.origin[1], w.mesh.texture.width, w.mesh.texture.height] } : null;
    }
    const anchor = a.warps.get(g.members[0]);
    if (!anchor) return null;
    const grid = deformerGrid(g.def), [cols, rows] = grid, [bx, by, bw, bh] = g.box, points: [number, number][] = [];
    for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
      const k = j * (cols + 1) + i;
      // Rest plus displacement on the canvas, then into the first member's mesh space (its box origin taken off) and out to the stage.
      const p = anchor.mesh.toGlobal({ x: (i / cols) * bw + bx + g.disp[k * 2] * FX() - anchor.origin[0], y: (j / rows) * bh + by + g.disp[k * 2 + 1] * FX() - anchor.origin[1] });
      points.push([p.x, p.y]);
    }
    return { id, members: [...g.members], cols, rows, points, box: { w: bw / FX(), h: bh / FX() }, canvas: [bx, by, bw, bh] };
  }
  /** As studioLatticeDelta, for the deformer `id` (a group warp's delta is measured in its first member's space; a part warp's in the part's). */
  studioDeformerDelta(char: string, id: string, from: [number, number], to: [number, number]): [number, number] | null {
    const a = this.actors.get(char), g = a?.groups.get(id), part = g ? g.members[0] : [...(a?.warps ?? [])].find(([, w]) => w.def?.id === id)?.[0];
    return part ? this.studioLatticeDelta(char, part, from, to) : null;
  }
  /** The stage-pixel box the character's art covers. */
  studioBounds(char: string): { x: number; y: number; w: number; h: number } | null {
    const a = this.actors.get(char);
    if (!a || !a.parts.size) return null;
    const b = a.body.getBounds();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  }
}
