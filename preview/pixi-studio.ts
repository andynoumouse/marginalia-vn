// The animation studio's stage (studio.ts, studio-gizmo.ts): the game renderer plus what the studio asks of it. Its working copy of the
// rig replaces the character's own piece by piece, it poses the character itself, and it asks about the stage (studio-queries.ts),
// hit-tests parts and captures frames for the movie export. The game page uses PixiRenderer alone.

import { Color, Matrix, Mesh, RenderTexture, type Sprite, type Texture } from 'pixi.js';
import {
  BONE_REST, NO_OFFSET, addOffset, compileSkin, displayValues, isGroupDeformer, isSkinned, maskView, partsUnder, resolveAnim, resolveParams, restStates,
  scaleOffset, unwarpMeshPoint, unwarpPoint, writeShapes,
  type AnimDef, type DeformerDef, type GizmoTarget, type KeyformDef, type Offset, type ParamDef, type ReactionDef, type Resolved, type RigData,
  type ShapeDef, type Value,
} from '../engine/src/index.js';
import { applyM } from './pixi-actor.js';
import { deformerShape, PixiRenderer } from './pixi-renderer.js';
import { StudioQueries } from './studio-queries.js';

export class StudioPixiRenderer extends PixiRenderer {
  private queries = new StudioQueries(this.actors, () => this.files);
  /** The studio's working copy of `parameters` and `keyforms` replaces the character's own, and the keyforms are evaluated again. */
  studioRig(char: string, parameters: ParamDef[], keyforms: KeyformDef[]) {
    const rig = this.files.rigs[char], a = this.actors.get(char);
    if (!rig) return;
    rig.rig = { ...rig.rig, parameters, keyforms };
    if (a) this.setParams(a, resolveParams(parameters, a.params));
  }
  // ---- the studio's questions about the stage (studio-queries.ts) ----
  studioMask(char: string, shape: string): { id: string; polygon: boolean; outlines: [number, number][][] } | null { return this.queries.studioMask(char, shape); }
  studioShapes(char: string): { name: string; outlines: [number, number][][] }[] { return this.queries.studioShapes(char); }
  studioMaskDelta(char: string, shape: string, from: [number, number], to: [number, number]): [number, number] | null { return this.queries.studioMaskDelta(char, shape, from, to); }
  studioPartBox(char: string, part: string): { x: number; y: number; w: number; h: number } | null { return this.queries.studioPartBox(char, part); }
  studioPartBoxes(char: string) { return this.queries.studioPartBoxes(char); }
  studioPartOutline(char: string, part: string): [[number, number], [number, number]][] | null { return this.queries.studioPartOutline(char, part); }
  /** For a bone of `char`: the parts that move with it (its own and its child bones'), its child bones, and its tip as a stage pixel. Null for a name that is not a bone. */
  studioBoneInfo(char: string, bone: string): { parts: string[]; children: string[]; tip: [number, number] | null } | null {
    const a = this.actors.get(char), data = this.files.rigs[char]?.rig, bones = data?.bones;
    if (!a || !bones || !Object.hasOwn(bones, bone) || a.parts.has(bone)) return null;
    const onBone = Object.fromEntries(Object.entries(data?.parts ?? {}).map(([p, d]) => [p, d?.bone]));
    const tip = bones[bone].tip;
    return { parts: partsUnder(bones, onBone, bone), children: Object.keys(bones).filter(b => bones[b].parent === bone), tip: Array.isArray(tip) ? this.studioBonePoint(char, bone, tip as [number, number]) : null };
  }
  studioCanvasPoint(char: string, p: [number, number]): [number, number] | null { return this.queries.studioCanvasPoint(char, p); }
  studioCanvasToStage(char: string, p: [number, number]): [number, number] | null { return this.queries.studioCanvasToStage(char, p); }
  /** A point at rest in canvas pixels (a bone's tip) where `bone` has carried it in the pose on show, as a stage pixel. */
  studioBonePoint(char: string, bone: string, p: [number, number]): [number, number] | null {
    const a = this.actors.get(char), rig = this.files.rigs[char];
    if (!a || !rig) return null;
    const m = this.placedBones.get(a)?.bones[bone] ?? BONE_REST, l = applyM(m, p[0] - (rig.width ?? 0) / 2, p[1] - (rig.height ?? 0)), g = a.body.toGlobal({ x: l[0], y: l[1] });
    return [g.x, g.y];
  }
  studioTarget(char: string, name: string, offsets?: ReadonlyMap<string, Offset>): (GizmoTarget & { ox: number; oy: number; unit: number }) | null { return this.queries.studioTarget(char, name, offsets); }
  studioSkeleton(char: string): { name: string; at: [number, number]; from?: [number, number] }[] { return this.queries.studioSkeleton(char); }
  studioSpace(char: string): { toStage(p: [number, number]): [number, number]; fromStage(p: [number, number]): [number, number] } | null { return this.queries.studioSpace(char); }
  studioPartPoints(char: string, part: string, pts: readonly number[]): [number, number][] | null { return this.queries.studioPartPoints(char, part, pts); }
  studioLattice(char: string, part: string): { cols: number; rows: number; points: [number, number][]; box: { w: number; h: number } } | null { return this.queries.studioLattice(char, part); }
  studioLatticeDelta(char: string, part: string, from: [number, number], to: [number, number]): [number, number] | null { return this.queries.studioLatticeDelta(char, part, from, to); }
  studioDeformerLattice(char: string, id: string) { return this.queries.studioDeformerLattice(char, id); }
  studioMesh(char: string, part: string) { return this.queries.studioMesh(char, part); }
  studioDeformerMesh(char: string, id: string) { return this.queries.studioDeformerMesh(char, id); }
  studioDeformerRestPoint(char: string, id: string, p: [number, number]) { return this.queries.studioDeformerRestPoint(char, id, p); }
  studioPartAlpha(char: string, part: string) { return this.queries.studioPartAlpha(char, part); }
  studioDeformerDelta(char: string, id: string, from: [number, number], to: [number, number]): [number, number] | null { return this.queries.studioDeformerDelta(char, id, from, to); }
  studioBounds(char: string): { x: number; y: number; w: number; h: number } | null { return this.queries.studioBounds(char); }
  /** The studio's working copy of `physics` replaces the character's own and the chains start at rest. */
  studioPhysics(char: string, chains: RigData['physics']) {
    const rig = this.files.rigs[char], a = this.actors.get(char);
    if (!rig) return;
    rig.rig = { ...rig.rig, physics: chains };
    if (a) a.physics = restStates(chains);
  }
  /**
   * The studio's working copy of `deformers` replaces the character's own. The meshes are built again only when a part gained,
   * lost or resized its warp; otherwise (a point dragged, a key added) the shapes are just worked out again.
   */
  studioDeformers(char: string, deformers: DeformerDef[]) {
    const rig = this.files.rigs[char], a = this.actors.get(char);
    if (!rig) return;
    const rebuild = deformerShape(rig.rig?.deformers) !== deformerShape(deformers);
    rig.rig = { ...rig.rig, deformers };
    if (!a) return;
    if (rebuild) { a.key = ''; this.dress(a, a.s); return; }
    for (const [part, w] of a.warps) {
      if (w.def) w.def = deformers.find(d => !isGroupDeformer(d) && d.part === part) ?? w.def;
      w.key = null;
      // The weights of a skinned mesh may have changed (or the skin come or gone): compile them again; the shaped vertices are worked out below.
      const mesh = w.tris ? w.def?.mesh : undefined;
      if (mesh && isSkinned(mesh)) w.skin = { skin: compileSkin(mesh, mesh.verts.length >> 1), shaped: w.skin?.shaped ?? Float32Array.from(w.rest), version: (w.skin?.version ?? 0) + 1, key: null };
      else if (mesh) w.skin = null;
    }
    for (const g of a.groups.values()) { g.def = deformers.find(d => d.id === g.def.id) ?? g.def; g.key = null; }
    this.posePartsOf(a, a.partPose); // a part that became skinned (or stopped being) is placed differently
    this.applyWarps(a, a.warpValues);
  }
  /** The studio's working copy of `animations`, `reactions` and `poses`, and its test variables, replaces the character's own (Model mode runs the reactions). */
  studioAuto(char: string, animations: Record<string, AnimDef>, reactions: ReactionDef[], poses: Record<string, Record<string, number>>, vars: Record<string, Value>) {
    const rig = this.files.rigs[char];
    if (!rig) return;
    rig.rig = { ...rig.rig, animations, reactions, poses };
    this.scriptVars = () => vars;
    const a = this.actors.get(char);
    if (a) { a.autoFx = []; a.auto = null; }
  }
  /**
   * The animation studio poses a character as animation `name` stands at progress `t` (0-1): `anims` is the working copy
   * of the character's `animations`, and `part` moves just that part. A null `name` is no animation at all (the studio's Model
   * mode): the character stands as its parameters, keyforms and physics make it. False when the character is not on stage or the name is unknown.
   */
  studioPose(char: string, anims: Record<string, AnimDef>, name: string | null, t: number, part: string | null = null, panel: { values: Record<string, number>; hold: string[] } | null = null, extra: ReadonlyMap<string, Offset> | null = null, physicsDt: number | null = null): boolean {
    const a = this.actors.get(char), r: Resolved | null = name === null ? { dur: 1, fn: () => ({}) } : resolveAnim(name, anims);
    if (!a || !r) return false;
    const defs = this.files.rigs[char]?.rig?.parameters;
    // The panel's values with the animation's tracks over them (but not over a slider the animator is holding): the game's evaluation.
    this.studioValues = panel?.values ?? null;
    this.autoRuns = false; // Animate mode shows the animation under edit alone, and Model mode a character at rest (reactions still hold their poses)
    const shown = defs?.length ? displayValues(defs, panel?.values ?? {}, null, t, panel?.hold ?? []) : null;
    if (shown && name === null) { const layer = this.reactionLayer(a, resolveParams(defs, panel?.values ?? {})); if (layer) Object.assign(shown, layer); }
    if (shown && r.params) for (const [id, v] of Object.entries(r.params(t))) if (!panel?.hold.includes(id) && Object.hasOwn(shown, id)) shown[id] = v;
    const anim = new Map<string, Offset>(); // the animation's own motion and an unkeyed drag; the parameters' go under it
    let o: Offset = NO_OFFSET;
    const body = scaleOffset(r.fn(t), 1);
    if (part) anim.set(part, body); else o = body;
    if (r.parts) for (const [p, off] of Object.entries(r.parts(t))) anim.set(p, addOffset(anim.get(p) ?? NO_OFFSET, scaleOffset(off, 1)));
    if (extra) for (const [n, e] of extra) anim.set(n, addOffset(anim.get(n) ?? NO_OFFSET, e)); // a gizmo drag not keyed (yet)
    const values = shown ? resolveParams(defs, shown) : {};
    const withParams = (base: Map<string, Offset>) => { const m = new Map(anim); for (const [n, p] of base) m.set(n, addOffset(p, anim.get(n) ?? NO_OFFSET)); return m; };
    let posed = withParams(shown ? this.keyformParts(char, values) : new Map());
    const chains = this.files.rigs[char]?.rig?.physics, swinging = !!chains && physicsDt !== null;
    if (!swinging) this.applyWarps(a, shown ? values : a.params);
    if (chains && swinging) posed = this.swing(a, chains, values, posed, physicsDt, r.physicsOff ?? false, withParams);
    this.poseBody(a, o);
    this.posePartsOf(a, posed);
    a.clip = r.frames ? r.frames(t, t * r.dur) : {};
    this.stepLive(a, 0);
    return true;
  }
  /** The animation studio shows `char` at rest (no animation offsets), to place pivots on. */
  studioRest(char: string) {
    const a = this.actors.get(char);
    if (!a) return;
    this.autoRuns = false; // pivots belong to the rest pose
    this.poseBody(a, NO_OFFSET);
    this.posePartsOf(a, new Map());
    a.clip = {};
    this.stepLive(a, 0);
  }
  /** The animation studio brings one part (or a group's parts) of `char` forward by dimming the rest; null shows all. */
  studioFocus(char: string, part: string | null, extra: string[] = []) {
    if (part) { this.focused.set(char, part); this.focusedExtra.set(char, extra); } else { this.focused.delete(char); this.focusedExtra.delete(char); }
    const a = this.actors.get(char);
    if (a) this.dimParts(a);
  }
  /** The animation studio hides these parts (a bone's: its parts) on its stage: they are not drawn and take no click. Not part of the character's state. */
  studioHidden(char: string, names: string[]) {
    if (names.length) this.hiddenParts.set(char, new Set(names)); else this.hiddenParts.delete(char);
    const a = this.actors.get(char);
    if (a) this.dimParts(a);
  }
  /** The studio's working copy of `pivots`, `bones` and `parts` replaces the character's own, and its layers are built again with them. */
  studioPivots(char: string, pivots: Record<string, [number, number]>, bones?: RigData['bones'], parts?: RigData['parts']) {
    const rig = this.files.rigs[char], a = this.actors.get(char);
    if (!rig) return;
    // The studio's `parts` hold bones and pivots only; its mask shapes and clips (studioMasks) go back in so they are not lost.
    const masks = this.studioMaskSet.get(char);
    rig.rig = { ...rig.rig, pivots, ...(bones ? { bones } : {}), ...(parts ? { parts: masks ? writeShapes(parts, masks.shapes, masks.clips) : parts } : {}) };
    if (a) { a.key = ''; this.dress(a, a.s); }
  }
  private studioShapeSig = new Map<string, string>();
  private studioMaskSet = new Map<string, { shapes: Record<string, ShapeDef>; clips: Record<string, string> }>();
  /** What decides whether the stencils are built again: the shapes' names, bones, follows and sizes, and the clip links (not the points). */
  private shapeSig(shapes: Record<string, ShapeDef>, clips: Record<string, string>): string {
    return JSON.stringify([Object.entries(shapes).map(([k, v]) => [k, v.bone ?? '', v.follow ?? '', v.polygon.length]), Object.entries(clips)]);
  }
  /**
   * The studio's working copy of the shapes and clips replaces the character's own. The parts are built again
   * when a shape or a clip came, went or changed its frame; when only a shape's points or keyforms changed, the shapes are just drawn again.
   */
  studioMasks(char: string, shapes: Record<string, ShapeDef>, clips: Record<string, string>) {
    const rig = this.files.rigs[char], a = this.actors.get(char);
    if (!rig) return;
    const sig = this.shapeSig(shapes, clips), rebuild = !this.studioChars.has(char) || this.studioShapeSig.get(char) !== sig;
    this.studioChars.add(char);
    this.studioShapeSig.set(char, sig);
    this.studioMaskSet.set(char, { shapes, clips });
    rig.rig = { ...rig.rig, parts: writeShapes(rig.rig?.parts ?? {}, shapes, clips) };
    if (!a) return;
    if (rebuild) { a.key = ''; this.dress(a, a.s); return; }
    const list = maskView(rig.rig, true);
    for (const m of a.masks) {
      const def = list.find(d => d.id === m.def.id);
      if (!def) continue;
      m.def = def;
      if (def.polygon) m.shapes = this.polygonShape(def, m.at);
      m.key = null;
    }
    this.applyMasks(a, a.warpValues);
  }
  // ---- the studio's gizmos ----
  private exportTarget: RenderTexture | null = null;
  /**
   * The studio's movie export: the stage as it is drawn now, `frame` (stage pixels, with the image's proportions) as a `width` x `height` image.
   * A null `background` leaves the image transparent; the stage's own black is never part of it. One render texture of exactly that size is kept
   * for the whole export (`studioCaptureEnd` frees it), so a long export does not allocate and free a GPU target per frame.
   */
  studioCapture(frame: { x: number; y: number; w: number; h: number }, width: number, height: number, background: string | null): HTMLCanvasElement {
    const renderer = this.app.renderer;
    if (!this.exportTarget || this.exportTarget.width !== width || this.exportTarget.height !== height) {
      this.exportTarget?.destroy(true);
      this.exportTarget = RenderTexture.create({ width, height, resolution: 1, antialias: true });
    }
    const scale = width / frame.w;
    renderer.render({ container: this.app.stage, target: this.exportTarget, transform: new Matrix().translate(-frame.x, -frame.y).scale(scale, scale), clearColor: background ? new Color(background).toArray() : [0, 0, 0, 0] });
    const { pixels } = renderer.extract.pixels(this.exportTarget);
    // What the GPU holds has each colour multiplied by its alpha (Pixi 8.22 hands it over as it is), and a PNG wants it straight: an edge
    // pixel left as it is would show a dark fringe over any other background.
    for (let i = 0; i < pixels.length; i += 4) {
      const a = pixels[i + 3];
      if (a === 0 || a === 255) continue;
      const k = 255 / a;
      pixels[i] = pixels[i] * k + 0.5;
      pixels[i + 1] = pixels[i + 1] * k + 0.5;
      pixels[i + 2] = pixels[i + 2] * k + 0.5;
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')!.putImageData(new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0);
    return canvas;
  }
  studioCaptureEnd() {
    this.exportTarget?.destroy(true);
    this.exportTarget = null;
  }
  /** The topmost part of `char` that has a non-transparent pixel under the stage point; null for none. */
  studioHit(char: string, x: number, y: number): string | null {
    return this.hitWalk(char, x, y, true)[0] ?? null;
  }
  /** Every part of `char` with a non-transparent pixel under the stage point, frontmost first (so `studioHit` is its first). */
  studioHitAll(char: string, x: number, y: number): string[] {
    return this.hitWalk(char, x, y, false);
  }
  private hitWalk(char: string, x: number, y: number, firstOnly: boolean): string[] {
    const out: string[] = [], a = this.actors.get(char);
    if (!a) return out;
    const kids = a.body.children, gone = this.hiddenIn(a);
    for (let i = kids.length - 1; i >= 0; i--) {
      const c = kids[i], sp = c.children[0] as Sprite | Mesh | undefined;
      if (!sp || !c.label || !a.parts.has(c.label) || !c.visible || gone.has(c.label)) continue;
      let l: { x: number; y: number } | null = sp.toLocal({ x, y });
      const tex = sp.texture, warp = a.warps.get(c.label);
      // A lattice mesh is drawn deformed: the point is looked up on the art it shows there, not on the undeformed box.
      if (warp && sp instanceof Mesh) {
        const pos = sp.geometry.getBuffer('aPosition').data as Float32Array, at = warp.tris ? unwarpMeshPoint(warp.rest, pos, warp.tris, l.x, l.y) : unwarpPoint(pos, warp.rest, warp.grid, l.x, l.y);
        l = at && { x: at[0], y: at[1] };
      }
      if (!l || l.x < 0 || l.y < 0 || l.x >= tex.width || l.y >= tex.height) continue;
      if (this.alphaAt(tex, l.x, l.y) > 8) { out.push(c.label); if (firstOnly) break; }
    }
    return out;
  }
  private hitCanvas: HTMLCanvasElement | null = null;
  private alphaAt(tex: Texture, x: number, y: number): number {
    try {
      const res = tex.source.resource as CanvasImageSource | undefined;
      if (!res) return 255;
      const c = (this.hitCanvas ??= document.createElement('canvas'));
      c.width = c.height = 1;
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(res, tex.frame.x + Math.floor(x), tex.frame.y + Math.floor(y), 1, 1, 0, 0, 1, 1);
      return g.getImageData(0, 0, 1, 1).data[3];
    } catch { return 255; } // a texture that cannot be read counts as solid: its box is hit
  }
}
