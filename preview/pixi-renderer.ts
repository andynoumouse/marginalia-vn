// WebGL world renderer (PixiJS 8). Draws images from assets/ when present, placeholder art otherwise:
//   backgrounds  assets/bg/<name>.(png|webp|jpg)          (or assets/<name>.*)
//   characters   assets/char/<char>/sprite.json           layered, from tools/psd-convert.mjs
//                assets/char/<char>/<pose>.(png|webp)     one image per pose ("default" when none is given)
// Characters are anchored bottom-center at x * stage width; backgrounds are scaled to cover the stage.

import { Application, Assets, Color, Container, Graphics, Matrix, MeshPlane, Rectangle, RenderTexture, Sprite, Texture } from 'pixi.js';
import { imageBytes, type Resident, applyDisplacement, deformerGrid, evalDeformer, paramsKey, restLattice, unwarpPoint, type DeformerDef, type KeyformDef, type ParamDef, BONE_REST, evalPointKeyforms, maskChain,  MASK_WARN_COUNT, partName, placeRig, pointKeyformKey, traceOutline, warpPoints, type MaskDef, type MaskPoint, addOffset, displayValues, evalAll, addPhysicsParams, restStates, stepPhysics, type ChainStates, type PhysicsOff, lerpParams, resolveParams, anchorOffset, type AnimDef, bgKey, blinkOf, cameraPivot, easing, EASES, focusLevels, raisedSpeaker, fxUnit, revealShapes, shakeOffset, maskKey, pixelBlock, lerp, mouthFrame, NO_OFFSET, resolveAnim, type Resolved, partsUnder, type GizmoTarget, rigLayers, showLooks, scaleOffset, speakOf, spriteKeys, startBlink, stepBlink, type BlinkState, type Offset, type RigData, type Camera, type DisplayState, type SpriteState } from '../engine/src/index.js';
import { FX, type Actor, type Fx, type MaskNode } from './pixi-actor.js';
import { PictureLayer } from './picture-layer.js';
import { SceneEffects } from './scene-effects.js';
import { rigGeometry, StudioQueries } from './studio-queries.js';
import { assetUrl, H, hue, stage, StageRenderer, W, type AssetFile, type WorldOp } from './stage-ui.js';

const IMAGE = /\.(png|webp|jpe?g|avif)$/i;
const SPRITE_W = 420, SPRITE_H = 940;

interface Tween { elapsed: number; dur: number; update: (k: number) => void; done: () => void }


/** A grey tint of brightness `v` (0-1). */
const grey = (v: number) => { const g = Math.round(Math.max(0, Math.min(1, v)) * 255); return (g << 16) | (g << 8) | g; };

export class PixiRenderer extends StageRenderer {
  private app = new Application();
  private world = new Container();
  private bgLayer = new Container();
  private spriteLayer = new Container();
  private pictures = new PictureLayer({ // overlay pictures (`image show`)
    files: () => this.files, art: key => this.art.get(key), canvasTexture: (...a) => this.canvasTexture(...a),
    takeLoopVideo: key => this.takeLoopVideo(key), releaseVideo: v => this.releaseVideo(v),
  });
  private shaker = new Container(); // screen shake moves this; the camera moves `world`
  private scene = new Container();  // the world and the weather: `filter` applies to this
  private effects = new SceneEffects(this.scene, () => this.reduceMotion); // weather, filters and the vignette
  private tintLayer = new Graphics();
  private flashLayer = new Graphics();
  private fade = new Graphics();
  private actors = new Map<string, Actor>();
  private queries = new StudioQueries(this.actors, () => this.files);
  private shown: DisplayState | null = null;         // the state last synced or applied (speaker focus reads who is on stage)
  private raised: string | null = null;              // the speaker drawn in front for the line (speakerFocus.front)
  private focused = new Map<string, string>();       // the animation studio's chosen part, by character
  private focusedExtra = new Map<string, string[]>(); // the parts chosen with it
  private hiddenParts = new Map<string, Set<string>>(); // the parts (bones: their parts) the animation studio hides on its stage, by character
  private tweens = new Set<Tween>();
  private art = new Map<string, Texture>();          // "bg/park" -> texture, from assets/
  private artUrl = new Map<string, string>();        // "bg/park" -> the url (with version) its texture came from
  private artFiles = new Map<string, string>();      // "bg/park" -> url of the file, whether loaded or not
  private pending = new Map<string, Promise<Texture | null>>(); // url -> load in progress
  private uploads = Promise.resolve();               // GPU uploads, one per frame
  private stale: string[] = [];                      // urls of replaced textures, released once nothing draws them
  private placeholders = new Map<string, Texture>(); // generated art, by key
  private warned = new Set<string>();

  async init() {
    await this.app.init({ width: W, height: H, background: '#000000', antialias: true, resolution: 1, preference: 'webgl' });
    this.app.canvas.id = 'canvas';
    stage.prepend(this.app.canvas);
    this.fade.rect(0, 0, W, H).fill(0x000000);
    this.fade.alpha = 0;
    for (const g of [this.tintLayer, this.flashLayer]) { g.rect(0, 0, W, H).fill(0xffffff); g.alpha = 0; }
    this.spriteLayer.sortableChildren = true;
    this.world.addChild(this.bgLayer, this.pictures.behind, this.spriteLayer, this.pictures.front);
    this.effects.init(g => this.app.renderer.generateTexture({ target: g, resolution: 1 }));
    this.scene.addChild(this.world, this.pictures.fixed, this.effects.weatherLayer);
    this.shaker.addChild(this.scene, this.effects.vignette, this.tintLayer, this.flashLayer);
    this.app.stage.addChild(this.shaker, this.fade);
    this.app.ticker.add(t => this.step(t.deltaMS));
  }

  protected indexArt(assets: AssetFile[]) {
    this.artFiles.clear();
    for (const a of assets) if (IMAGE.test(a.file)) this.artFiles.set(a.file.replace(IMAGE, ''), assetUrl(a));
    // A texture whose file changed or went away is dropped from the map now and freed at the next sync, when
    // nothing draws it any more (the Pixi Assets cache would otherwise keep every old version).
    for (const [key, url] of this.artUrl) {
      if (this.artFiles.get(key) === url) continue;
      this.art.delete(key); this.artUrl.delete(key);
      this.stale.push(url);
    }
  }

  protected residentImages(): Resident[] {
    return [...this.art].map(([key, tex]) => ({ key, kind: 'image' as const, bytes: imageBytes(tex.source.pixelWidth, tex.source.pixelHeight) }));
  }

  protected async loadImage(key: string) {
    const url = this.artFiles.get(key);
    if (!url || this.artUrl.get(key) === url) return;
    let p = this.pending.get(url);
    if (!p) {
      p = Assets.load<Texture>({ src: url, parser: 'texture' }).then(async tex => { await this.upload(tex); return tex; }, e => {
        console.warn('Could not load asset:', e);
        return null;
      });
      this.pending.set(url, p);
      void p.then(() => this.pending.delete(url));
    }
    const tex = await p;
    if (tex && this.artFiles.get(key) === url) { this.art.set(key, tex); this.artUrl.set(key, url); }
  }
  /**
   * Send a fresh texture to the GPU now, instead of at the first frame that draws it (a hitch for big images).
   * One per frame, so several images arriving together do not stall a transition that is playing.
   */
  private upload(tex: Texture): Promise<void> {
    this.uploads = this.uploads.then(() => new Promise<void>(next => requestAnimationFrame(() => {
      try { (this.app.renderer.texture as unknown as { initSource(s: unknown): void }).initSource(tex.source); }
      catch (e) { this.warnOnce(`Could not upload a texture ahead of time: ${e}`); }
      next();
    })));
    return this.uploads;
  }
  private releaseStale() {
    for (const url of this.stale.splice(0)) void Assets.unload(url).catch(() => {});
  }

  async snapshot(): Promise<string | undefined> {
    try {
      return await this.app.renderer.extract.base64({
        target: this.app.stage, frame: new Rectangle(0, 0, W, H), resolution: 256 / W, format: 'jpg', quality: 0.75,
      });
    } catch (e) {
      console.warn('Could not capture a save thumbnail:', e);
      return undefined;
    }
  }

  // ---- tweens (driven by the Pixi ticker; a sync() ends them all) ----
  private step(ms: number) {
    for (const t of this.tweens) {
      t.elapsed += ms;
      const k = Math.min(1, t.elapsed / t.dur);
      t.update(k);
      if (k >= 1) { this.tweens.delete(t); t.done(); }
    }
    for (const a of this.actors.values()) { this.stepFx(a, ms / 1000); this.stepLive(a, ms / 1000); }
    this.stepFocus(ms / 1000);
    this.effects.stepWeather(ms / 1000);
  }
  private speaker: string | null = null;
  private speakUntil = 0;
  protected override speakTick(who: string | null) {
    this.speaker = who;
    if (who) this.speakUntil = performance.now() + 350; // typing goes on: the mouth does too, until the characters stop coming
  }
  /** How bright each character on stage should be now (speaker focus), and the speaker to raise, if any. */
  private focusNow(state: DisplayState) {
    const focus = this.focusFor(state), chars = state.sprites.map(s => s.char);
    return {
      levels: focusLevels(chars, this.lineSpeaker, focus, c => this.characters[c]?.focus === false),
      raised: raisedSpeaker(chars, this.lineSpeaker, focus),
    };
  }
  /** Speaker focus: ease each character toward lit or dimmed (a snap under reduced motion and while skipping), and raise the speaker. */
  private stepFocus(seconds: number) {
    const state = this.shown;
    if (!state) return;
    const { levels, raised } = this.focusNow(state);
    const fade = this.speakerFocus?.fade ?? 0;
    const by = fade > 0 && !this.reduceMotion && !this.skipping ? (seconds / fade) * (this.speakerFocus?.dim || 1) : Infinity;
    for (const [c, a] of this.actors) {
      const to = levels.get(c) ?? 1;
      if (a.lit === to) continue;
      a.lit = a.lit < to ? Math.min(to, a.lit + by) : Math.max(to, a.lit - by);
      a.node.tint = grey(a.lit);
    }
    if (raised !== this.raised) { this.raised = raised; this.restack(state); }
  }
  /** Blinking and talking: swap slot variants in and out, and loop the speak animation, while the character is talking. */
  private stepLive(a: Actor, seconds: number) {
    const data = this.files.rigs[a.s.char]?.rig;
    if (!data) return;
    const off = this.shown?.behaviors === false; // `behaviors off`: idle, blink and talk are suspended until `behaviors on`
    const blink =off ? null : blinkOf(data), speak = off ? null : speakOf(data), now = performance.now();
    const idle = data.autonomous?.idle;
    if (idle && !this.reduceMotion) {
      if (off && a.idle) a.idle = null;
      else if (!off && !a.idle) a.idle = this.makeFx(a.s.char, idle, null, 1, true);
    }
    if (!off && !a.blink) { const def = blinkOf(data); if (def) a.blink = startBlink(def.every, Math.random); }
    const speaking = !off && this.speaker === a.s.char && now < this.speakUntil;
    if (speaking && !a.speaking) a.talkStart = now;
    a.speaking = speaking;
    if (speak?.anim && !this.reduceMotion) {
      if (speaking && !a.talk) a.talk = this.makeFx(a.s.char, speak.anim, null, 1, true);
      else if (!speaking && a.talk) a.talk = null;
    }
    const live: Record<string, string> = {};
    if (blink && a.blink) {
      a.blink = stepBlink(a.blink, seconds, blink, Math.random);
      if (a.blink.closed && !(blink.slot in a.s.overrides)) live[blink.slot] = blink.variant; // an explicit slot=variant wins
    }
    if (speak && speaking) {
      const frame = mouthFrame(speak.variants, (now - a.talkStart) / 1000, speak.rate);
      if (frame) live[speak.slot] = frame;
    }
    Object.assign(live, a.clip); // while a frame track plays it owns its slot: before and after, the script's value shows
    if (JSON.stringify(live) === JSON.stringify(a.live)) return;
    // Only swap to art that is loaded: a missing variant would show an empty part for a moment.
    const shown = { ...a.s, overrides: { ...a.s.overrides, ...live } };
    if (!spriteKeys(shown, this.files).every(k => this.art.has(k))) return;
    a.live = live;
    this.dress(a, a.s);
  }
  /** Draw the rig's parameters at `values`: the keyforms are evaluated again, and the next frame poses the parts by them. */
  private setParams(a: Actor, values: Record<string, number>) {
    a.params = values;
    a.paramParts = this.keyformParts(a.s.char, values);
    this.applyWarps(a, values);
    a.posed = true;
  }
  /** What the keyforms of `char`'s rig make of the parameter `values`, by part or bone. */
  private keyformParts(char: string, values: Record<string, number>): Map<string, Offset> {
    const rig = this.files.rigs[char]?.rig;
    return new Map(Object.entries(evalAll(rig?.keyforms, values)).map(([name, f]) => [name, { dx: f.dx, dy: f.dy, sx: f.sx, sy: f.sy, rot: f.rot, ...(f.opacity !== 1 ? { opacity: f.opacity } : {}) }]));
  }
  /** Advance an actor's animations and pose its body by their sum. */
  private stepFx(a: Actor, seconds: number) {
    // The studio poses actors itself (studioPose, on every change and while playing). Stepping them here would pose the parameters'
    // defaults over that on every frame, so a rig with keyforms never showed the pose the author had set.
    if (this.studio) return;
    const running = [...a.fx, ...(a.idle ? [a.idle] : []), ...(a.talk ? [a.talk] : [])];
    const chains = this.studio ? undefined : this.files.rigs[a.s.char]?.rig?.physics;
    if (!running.length && !a.paramParts.size && !chains) {
      if (a.posed) { this.poseBody(a, NO_OFFSET); this.posePartsOf(a, new Map()); this.applyWarps(a, a.params); a.posed = false; a.clip = {}; }
      return;
    }
    let o: Offset = NO_OFFSET;
    const tracked: Record<string, number> = {}; // parameters the running animations set; they replace the script's value while they play
    const clip: Record<string, string> = {};
    const parts = new Map<string, Offset>();
    const addPart = (name: string, p: Offset) => parts.set(name, addOffset(parts.get(name) ?? NO_OFFSET, p));
    for (const f of running) {
      f.elapsed += seconds;
      const t = Math.min(1, f.loop ? (f.elapsed % f.dur) / f.dur : f.elapsed / f.dur);
      const body = scaleOffset(f.fn(t), f.strength);
      if (f.part) addPart(f.part, body); // `animate ... part=`: the animation moves that part instead of the body
      else o = addOffset(o, body);
      if (f.parts) for (const [name, p] of Object.entries(f.parts(t))) addPart(name, scaleOffset(p, f.strength));
      if (f.params) Object.assign(tracked, f.params(t));
      if (f.frames) Object.assign(clip, f.frames(t, f.loop ? f.elapsed % f.dur : Math.min(f.elapsed, f.dur)));
    }
    a.clip = clip;
    // The parameters first (the script's, with the animations' tracks over them), the animations' own motion on top.
    const defs = this.files.rigs[a.s.char]?.rig?.parameters;
    const values = Object.keys(tracked).length ? resolveParams(defs, { ...a.params, ...tracked }) : a.params;
    const anim = parts; // the animations' own motion; the parameters' go under it
    const withParams = (base: Map<string, Offset>) => { const m = new Map(anim); for (const [name, p] of base) m.set(name, addOffset(p, anim.get(name) ?? NO_OFFSET)); return m; };
    let posed = withParams(Object.keys(tracked).length ? this.keyformParts(a.s.char, values) : a.paramParts);
    if (!chains) this.applyWarps(a, values); // with chains, swing applies them once the physics is in
    if (chains) {
      // Physics goes last and adds: a paused game holds the swing where it is, skipping and reduced motion leave the chains at rest.
      const off: PhysicsOff = this.skipping || this.reduceMotion ? true : running.some(f => f.physicsOff === true) ? true : running.flatMap(f => Array.isArray(f.physicsOff) ? f.physicsOff : []);
      posed = this.swing(a, chains, values, posed, this.paused ? 0 : seconds, off, withParams);
    }
    a.fx = a.fx.filter(f => {
      if (f.loop || f.elapsed < f.dur) return true;
      f.done?.();
      return false;
    });
    a.posed = true;
    this.poseBody(a, o);
    this.posePartsOf(a, posed);
  }
  /** Step the actor's chains by `dt` and lay their outputs over `posed` (parameters re-evaluated through `withParams`, rotations added). */
  private swing(a: Actor, chains: NonNullable<RigData['physics']>, values: Record<string, number>, posed: Map<string, Offset>, dt: number, off: PhysicsOff, withParams: (base: Map<string, Offset>) => Map<string, Offset>): Map<string, Offset> {
    const r = stepPhysics(chains, a.physics, values, posed, dt, off);
    a.physics = r.states;
    if (Object.keys(r.params).length) {
      const driven = addPhysicsParams(this.files.rigs[a.s.char]?.rig?.parameters, values, r.params);
      posed = withParams(this.keyformParts(a.s.char, driven));
      this.applyWarps(a, driven);
    } else this.applyWarps(a, values);
    for (const [name, rot] of Object.entries(r.rot)) posed.set(name, addOffset(posed.get(name) ?? NO_OFFSET, { ...NO_OFFSET, rot }));
    return posed;
  }
  /** The studio's working copy of `parameters` and `keyforms` replaces the character's own, and the keyforms are evaluated again. */
  studioRig(char: string, parameters: ParamDef[], keyforms: KeyformDef[]) {
    const rig = this.files.rigs[char], a = this.actors.get(char);
    if (!rig) return;
    rig.rig = { ...rig.rig, parameters, keyforms };
    if (a) this.setParams(a, resolveParams(parameters, a.params));
  }
  // ---- the studio's questions about the stage (studio-queries.ts) ----
  studioMask(char: string, part: string): { id: string; polygon: boolean; outlines: [number, number][][] } | null { return this.queries.studioMask(char, part); }
  studioMaskDelta(char: string, part: string, from: [number, number], to: [number, number]): [number, number] | null { return this.queries.studioMaskDelta(char, part, from, to); }
  studioPartBox(char: string, part: string): { x: number; y: number; w: number; h: number } | null { return this.queries.studioPartBox(char, part); }
  studioCanvasPoint(char: string, p: [number, number]): [number, number] | null { return this.queries.studioCanvasPoint(char, p); }
  studioTarget(char: string, name: string, offsets?: ReadonlyMap<string, Offset>): (GizmoTarget & { ox: number; oy: number; unit: number }) | null { return this.queries.studioTarget(char, name, offsets); }
  studioSkeleton(char: string): { name: string; at: [number, number]; from?: [number, number] }[] { return this.queries.studioSkeleton(char); }
  studioSpace(char: string): { toStage(p: [number, number]): [number, number]; fromStage(p: [number, number]): [number, number] } | null { return this.queries.studioSpace(char); }
  studioLattice(char: string, part: string): { cols: number; rows: number; points: [number, number][]; box: { w: number; h: number } } | null { return this.queries.studioLattice(char, part); }
  studioLatticeDelta(char: string, part: string, from: [number, number], to: [number, number]): [number, number] | null { return this.queries.studioLatticeDelta(char, part, from, to); }
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
    const shape = (list?: DeformerDef[]) => (list ?? []).map(d => `${d.part}:${d.id}:${deformerGrid(d).join('x')}`).sort().join('|');
    const rebuild = shape(rig.rig?.deformers) !== shape(deformers);
    rig.rig = { ...rig.rig, deformers };
    if (!a) return;
    if (rebuild) { a.key = ''; this.dress(a, a.s); return; }
    for (const [part, w] of a.warps) {
      const def = deformers.find(d => d.part === part);
      if (def) { w.def = def; w.key = null; }
    }
    this.applyWarps(a, a.warpValues);
  }
  /** Set by the animation studio's page: it poses actors itself (`studioPose`), so the game's own stepping stays out of the way. */
  studio = false;
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
    const shown = defs?.length ? displayValues(defs, panel?.values ?? {}, null, t, panel?.hold ?? []) : null;
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
  /** The parts of `a` the studio hides now. */
  private hiddenIn(a: Actor): Set<string> {
    const names = this.hiddenParts.get(a.s.char), out = new Set<string>();
    if (!names) return out;
    const rig = this.files.rigs[a.s.char]?.rig, bones = rig?.bones, onBone = Object.fromEntries(Object.entries(rig?.parts ?? {}).map(([p, d]) => [p, d?.bone]));
    for (const n of names) for (const p of bones && Object.hasOwn(bones, n) && !a.parts.has(n) ? partsUnder(bones, onBone, n) : [n]) out.add(p);
    return out;
  }
  private dimParts(a: Actor) {
    const part = this.focused.get(a.s.char), rig = this.files.rigs[a.s.char];
    const bones = rig?.rig?.bones, onBone = Object.fromEntries(Object.entries(rig?.rig?.parts ?? {}).map(([p, d]) => [p, d?.bone]));
    const under = (p: string) => bones && Object.hasOwn(bones, p) && !a.parts.has(p) ? partsUnder(bones, onBone, p) : [p];
    const lit = part ? [part, ...(this.focusedExtra.get(a.s.char) ?? [])].flatMap(under) : null;
    // A keyform's opacity multiplies the part's (a bone's: its parts') alpha, under the studio's dimming.
    const opacity = new Map<string, number>();
    for (const [name, o] of a.partPose) if (o.opacity !== undefined) for (const p of under(name)) opacity.set(p, (opacity.get(p) ?? 1) * o.opacity);
    const gone = this.hiddenIn(a);
    for (const [name, c] of a.parts) c.alpha = gone.has(name) ? 0 : (!lit || lit.includes(name) ? 1 : 0.2) * Math.min(1, opacity.get(name) ?? 1);
  }
  /** The studio's working copy of `pivots`, `bones` and `parts` replaces the character's own, and its layers are built again with them. */
  studioPivots(char: string, pivots: Record<string, [number, number]>, bones?: RigData['bones'], parts?: RigData['parts']) {
    const rig = this.files.rigs[char], a = this.actors.get(char);
    if (!rig) return;
    rig.rig = { ...rig.rig, pivots, ...(bones ? { bones } : {}), ...(parts ? { parts } : {}) };
    if (a) { a.key = ''; this.dress(a, a.s); }
  }
  private poseBody(a: Actor, o: Offset) {
    a.body.position.set(o.dx * FX(), o.dy * FX());
    a.body.scale.set(1 + o.sx, 1 + o.sy);
    a.body.angle = o.rot;
  }
  /** Stop every animation of an actor, ending one-shots so whoever awaits them goes on. */
  private clearFx(a: Actor) {
    for (const f of a.fx) f.done?.();
    a.fx = [];
    this.poseBody(a, NO_OFFSET);
    this.posePartsOf(a, new Map());
  }
  /** The animation `name` of character `char` (its rig.json one, else a preset) ready to play, or null for an unknown name. */
  private makeFx(char: string, name: string, dur: number | null, strength: number, loop: boolean, part: string | null = null): Fx | null {
    const a = resolveAnim(name, this.files.rigs[char]?.rig?.animations);
    if (!a) { this.warnOnce(`${char} has no animation "${name}"`); return null; }
    return { fn: a.fn, parts: a.parts, params: a.params, frames: a.frames, physicsOff: a.physicsOff, part, dur: dur ?? a.dur, strength, loop, elapsed: 0 };
  }
  private async playFx(a: Actor, char: string, name: string, dur: number | null, strength: number, part: string | null = null): Promise<void> {
    const fx = this.makeFx(char, name, dur, strength, false, part);
    if (fx) await new Promise<void>(done => a.fx.push({ ...fx, done }));
  }
  private tween(seconds: number, update: (k: number) => void): Promise<void> {
    if (seconds <= 0) { update(1); return Promise.resolve(); }
    return new Promise(done => this.tweens.add({ elapsed: 0, dur: seconds * 1000, update, done }));
  }

  // ---- textures ----
  private canvasTexture(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): Texture {
    let tex = this.placeholders.get(key);
    if (!tex) {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      draw(c.getContext('2d')!);
      tex = Texture.from(c);
      this.placeholders.set(key, tex);
    }
    return tex;
  }
  private bgTexture(name: string): Texture {
    const key = bgKey(name, this.files);
    const art = key && this.art.get(key);
    if (art) return art;
    return this.canvasTexture(`bg:${name}`, W, H, g => {
      const h = hue(name);
      const grad = g.createLinearGradient(W * 0.37, 0, W * 0.63, H); // ~165deg, like the DOM version
      grad.addColorStop(0, `hsl(${h} 32% 24%)`);
      grad.addColorStop(1, `hsl(${(h + 45) % 360} 38% 11%)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);
      g.fillStyle = 'rgba(255,255,255,.28)';
      g.font = '28px system-ui, sans-serif';
      g.textBaseline = 'top';
      g.fillText(name, 40, 32);
    });
  }
  private warnOnce(msg: string) {
    if (!this.warned.has(msg)) { this.warned.add(msg); console.warn(msg); }
  }
  /** The images a sprite state is drawn with, bottom to top, positioned relative to its bottom-center. */
  private look(s: SpriteState): { key: string; build: () => Container[] } {
    const rig = this.files.rigs[s.char];
    if (rig && !rig.flat) {
      const picks = rigLayers(rig, showLooks(s), s.overrides, msg => this.warnOnce(`${s.char}: ${msg}`));
      const dir = `char/${s.char}/`;
      const deformers = new Map((rig.rig?.deformers ?? []).map(d => [d.part, d] as const));
      return {
        key: `rig:${picks.map(p => p.file).join('|')}${[...deformers.values()].map(d => `|w:${d.id}:${deformerGrid(d).join('x')}`).join('')}${(rig.rig?.masks ?? []).map(m => `|m:${m?.id}:${m?.part}`).join('')}`,
        // Each layer sits in a container of its part that turns and scales about the part's pivot (see rig.json `pivots`).
        build: () => picks.map(p => {
          const tex = this.art.get(dir + p.file.replace(IMAGE, '')) ?? Texture.EMPTY, def = deformers.get(p.part);
          // A part with a deformer is a lattice mesh in place of its sprite; applyWarps shapes it.
          const sp = def ? this.warpMesh(tex, def) : new Sprite(tex);
          const left = p.x - (rig.width ?? 0) / 2, top = p.y - (rig.height ?? 0);
          sp.position.set(left, top);
          const part = new Container();
          part.label = p.part;
          part.addChild(sp); // posePartsOf gives the container its matrix: bone, then its own offset about its pivot

          return part;
        }),
      };
    }
    const { tex, key } = this.spriteTexture(s);
    return { key, build: () => { const sp = new Sprite(tex); sp.anchor.set(0.5, 1); return [sp]; } };
  }
  private warpMesh(tex: Texture, def: DeformerDef): MeshPlane {
    const [cols, rows] = deformerGrid(def), mesh = new MeshPlane({ texture: tex, verticesX: cols + 1, verticesY: rows + 1 });
    mesh.autoResize = false; // the lattice is ours: a texture update must not rebuild (and so reset) it
    return mesh;
  }
  /**
   * Shape the lattice meshes by the parameter `values`. A deformer is recomputed only when the parameters it reads changed;
   * then the position buffer is rewritten and uploaded.
   */
  private applyWarps(a: Actor, values: Record<string, number>) {
    a.warpValues = values;
    for (const w of a.warps.values()) {
      const key = paramsKey(w.def, values);
      if (key === w.key) continue;
      w.key = key;
      const buf = w.mesh.geometry.getBuffer('aPosition');
      applyDisplacement(w.rest, evalDeformer(w.def, values), FX(), FX(), buf.data as Float32Array);
      buf.update();
    }
    this.applyMasks(a, values);
  }
  // ---- masks (rig.json `masks`, engine/src/masks.ts) ----
  private outlines = new WeakMap<Texture, MaskPoint[][]>();
  /**
   * The outlines of the opaque shapes in a texture's art, in fractions of its box: traceOutline on its alpha, read at up to 256 pixels
   * and kept per texture. Null while the art is not loaded; a texture the browser will not let us read counts as its box.
   */
  private outlineOf(tex: Texture): MaskPoint[][] | null {
    if (tex === Texture.EMPTY || tex.width < 2 || tex.height < 2) return null;
    const known = this.outlines.get(tex);
    if (known) return known;
    let out: MaskPoint[][] = [[[0, 0], [1, 0], [1, 1], [0, 1]]];
    try {
      const res = tex.source.resource as CanvasImageSource | undefined;
      if (res) {
        const k = Math.min(1, 256 / Math.max(tex.width, tex.height)), w = Math.max(1, Math.round(tex.width * k)), h = Math.max(1, Math.round(tex.height * k));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const g = c.getContext('2d', { willReadFrequently: true })!;
        g.drawImage(res, tex.frame.x, tex.frame.y, tex.frame.width, tex.frame.height, 0, 0, w, h);
        const rgba = g.getImageData(0, 0, w, h).data, alpha = new Uint8Array(w * h);
        for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3];
        out = traceOutline(alpha, w, h);
      }
    } catch { /* unreadable art counts as solid: its box */ }
    this.outlines.set(tex, out);
    return out;
  }
  /** A polygon mask's points in the space its shape is drawn in: canvas pixels less `at`. Fewer than three points is no shape. */
  private polygonShape(def: MaskDef, at: [number, number]): Float32Array[] {
    const poly = def.polygon;
    return Array.isArray(poly) && poly.length >= 3 && poly.every(p => Array.isArray(p)) ? [Float32Array.from(poly.flatMap(p => [p[0] - at[0], p[1] - at[1]]))] : [];
  }
  /**
   * Clip the parts rig.json `masks` names. Each clipped part gets a stencil shape hung where it follows its source (see MaskNode);
   * a part whose source is not drawn (a look hides it, or its art is not loaded) is hidden too. A part clipped by a part that is
   * itself clipped passes through both shapes: the first on its container, the second on its image (nested stencils).
   */
  private buildMasks(a: Actor) {
    a.masks = [];
    a.holders = new Map();
    const rig = this.files.rigs[a.s.char], raw = rig?.rig?.masks;
    const list = Array.isArray(raw) ? raw.filter((m): m is MaskDef => !!m && typeof m === 'object' && typeof m.part === 'string') : [];
    if (!rig || rig.flat || !list.length) return;
    const names = new Set((rig.parts ?? []).map(partName)), ox = (rig.width ?? 0) / 2, oy = rig.height ?? 0;
    const art = (name: string) => a.parts.get(name)?.children[0] as Sprite | MeshPlane | undefined;
    const made = new Map<string, MaskNode>(), hide = new Set<string>();
    for (const def of list) {
      if (!a.parts.has(def.part)) continue; // the clipped part is not drawn: nothing to clip
      const frame = def.from ?? (def.on !== undefined && names.has(def.on) ? def.on : null), sp = frame !== null ? art(frame) : undefined;
      if (frame !== null && !sp) { hide.add(def.part); continue; } // the shape follows a part that is not drawn
      let shapes: Float32Array[], at: [number, number] = [ox, oy];
      if (sp) {
        at = [ox + sp.x, oy + sp.y];
        if (def.from !== undefined) {
          const outline = this.outlineOf(sp.texture);
          if (!outline) { hide.add(def.part); continue; }
          shapes = outline.map(poly => Float32Array.from(poly.flatMap(p => [p[0] * sp.texture.width, p[1] * sp.texture.height])));
        } else shapes = this.polygonShape(def, at);
      } else shapes = this.polygonShape(def, at);
      if (!shapes.length) continue; // a polygon that is no shape (checkRig says why): the part is drawn whole
      made.set(def.part, { def, g: new Graphics(), shapes, frame, box: sp ? { w: sp.texture.width, h: sp.texture.height } : null, at, key: null, drawn: [] });
    }
    const placed = new Set<MaskNode>();
    const hang = (n: MaskNode) => {
      if (placed.has(n)) return;
      placed.add(n);
      const sp = n.frame !== null ? art(n.frame) : undefined;
      if (n.frame !== null && sp) { a.parts.get(n.frame)!.addChild(n.g); n.g.position.set(sp.x, sp.y); return; }
      const bone = n.def.on ?? '';
      let h = a.holders.get(bone);
      if (!h) { h = new Container(); a.holders.set(bone, h); a.body.addChild(h); }
      h.addChild(n.g);
    };
    for (const [part, node] of made) {
      const chain = maskChain(list, part).slice(0, 2).map(m => made.get(m.part));
      if (chain.some(n => !n)) { hide.add(part); continue; }
      const nodes = chain as MaskNode[];
      for (const n of nodes) hang(n);
      a.parts.get(part)!.mask = nodes[0].g;
      if (nodes[1]) art(part)!.mask = nodes[1].g;
    }
    for (const part of hide) a.parts.get(part)!.visible = false;
    for (const n of made.values()) if (placed.has(n)) a.masks.push(n); else n.g.destroy();
    if (a.masks.length > MASK_WARN_COUNT) this.warnOnce(`${a.s.char}: ${a.masks.length} masks (more than ${MASK_WARN_COUNT}); each is stencil passes every frame, which has not been measured on weak phones`);
  }
  /** Draw the masks' shapes for the parameter `values`, again only where their own parameters or their frame part's warp changed. */
  private applyMasks(a: Actor, values: Record<string, number>) {
    for (const m of a.masks) {
      const warp = m.frame !== null ? a.warps.get(m.frame) : undefined, kf = m.def.keyforms;
      const key = `${pointKeyformKey(kf, values)}#${warp?.key ?? ''}`;
      if (key === m.key) continue;
      m.key = key;
      m.g.clear();
      m.drawn = m.shapes.map(rest => {
        let pts = rest;
        if (m.def.polygon && Array.isArray(kf) && kf.length) pts = applyDisplacement(pts, evalPointKeyforms(kf, rest.length / 2, values), FX(), FX());
        if (warp && m.box) pts = warpPoints(pts, m.box, deformerGrid(warp.def), warp.mesh.geometry.getBuffer('aPosition').data as Float32Array);
        m.g.poly(Array.from(pts)).fill(0xffffff);
        return pts;
      });
    }
  }
  /** How many stencil masks are on stage now (each is extra draw passes every frame; the debug console's `memory` reports it). */
  override maskCount(): number { let n = 0; for (const a of this.actors.values()) n += a.masks.length; return n; }
  /**
   * The studio's working copy of `masks` replaces the character's own. The parts are built again when a mask came, went or changed its
   * source; when only a polygon's points or keyforms changed, the shapes are just drawn again.
   */
  studioMasks(char: string, masks: MaskDef[]) {
    const rig = this.files.rigs[char], a = this.actors.get(char);
    if (!rig) return;
    const shape = (list?: MaskDef[]) => (list ?? []).map(m => `${m?.id}:${m?.part}:${m?.from ?? ''}:${m?.on ?? ''}:${m?.polygon?.length ?? 0}`).sort().join('|');
    const rebuild = shape(rig.rig?.masks) !== shape(masks);
    rig.rig = { ...rig.rig, masks };
    if (!a) return;
    if (rebuild) { a.key = ''; this.dress(a, a.s); return; }
    for (const m of a.masks) {
      const def = masks.find(d => d?.id === m.def.id);
      if (!def) continue;
      m.def = def;
      if (def.polygon) m.shapes = this.polygonShape(def, m.at);
      m.key = null;
    }
    this.applyMasks(a, a.warpValues);
  }
  private spriteTexture(s: SpriteState): { tex: Texture; key: string } {
    const artKey = `char/${s.char}/${s.pose ?? 'default'}`;
    const art = this.art.get(artKey);
    if (art) return { tex: art, key: artKey };
    const lines = [s.pose ?? '-', ...Object.entries(s.overrides).map(([k, v]) => `${k}=${v}`)];
    const key = `char:${s.char}:${lines.join('|')}`;
    const tex = this.canvasTexture(key, SPRITE_W, SPRITE_H, g => {
      g.globalAlpha = 0.92;
      g.fillStyle = this.spriteColor(s.char);
      g.beginPath();
      g.roundRect(0, 0, SPRITE_W, SPRITE_H, [18, 18, 0, 0]);
      g.fill();
      g.globalAlpha = 1;
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.textBaseline = 'top';
      g.shadowColor = 'rgba(0,0,0,.5)';
      g.shadowBlur = 4;
      g.shadowOffsetY = 1;
      g.font = '600 44px system-ui, sans-serif';
      g.fillText(this.characters[s.char]?.name ?? s.char, SPRITE_W / 2, 36);
      g.font = '28px system-ui, sans-serif';
      g.globalAlpha = 0.85;
      lines.forEach((l, i) => g.fillText(l, SPRITE_W / 2, 100 + i * 38));
    });
    return { tex, key };
  }

  // ---- world ----
  private makeBg(name: string): Sprite {
    const sp = new Sprite(this.bgTexture(name));
    sp.anchor.set(0.5);
    sp.position.set(W / 2, H / 2);
    sp.scale.set(Math.max(W / sp.texture.width, H / sp.texture.height));
    return sp;
  }
  private setBg(name: string | null) {
    for (const c of this.bgLayer.removeChildren()) c.destroy();
    if (name) this.bgLayer.addChild(this.makeBg(name));
  }
  private dress(a: Actor, s: SpriteState) {
    a.s = s;
    const rig = this.files.rigs[s.char];
    const size = rig && !rig.flat ? (rig.width && rig.height ? { w: rig.width, h: rig.height } : null) : (t => ({ w: t.width, h: t.height }))(this.spriteTexture(s).tex);
    if (size?.w !== a.size?.w || size?.h !== a.size?.h) { a.size = size; this.turnAbout(a, s); }
    const { key, build } = this.look(Object.keys(a.live).length ? { ...s, overrides: { ...s.overrides, ...a.live } } : s);
    if (key === a.key) return;
    for (const c of a.body.removeChildren()) c.destroy({ children: true });
    const nodes = build();
    a.body.addChild(...nodes);
    a.parts = new Map(nodes.filter(c => c.label && !(c instanceof Sprite)).map(c => [c.label, c]));
    a.warps = new Map();
    for (const [name, c] of a.parts) {
      const mesh = c.children[0], def = this.files.rigs[s.char]?.rig?.deformers?.find(d => d.part === name);
      if (mesh instanceof MeshPlane && def) a.warps.set(name, { mesh, def, rest: restLattice(mesh.texture.width, mesh.texture.height, deformerGrid(def)), key: null });
    }
    this.buildMasks(a);
    this.applyWarps(a, a.warpValues);
    if (this.focused.size || this.hiddenParts.size) this.dimParts(a);
    a.key = key;
    this.posePartsOf(a, a.partPose);
  }
  /** Turn the parts about their pivots: `o` has the offsets of those that move (by part or bone name); the rest go back to rest. */
  private posePartsOf(a: Actor, o: Map<string, Offset>) {
    a.partPose = o;
    const g = rigGeometry(this.files, a);
    // A name that is a bone (and no part) moves the bone and what hangs on it; a part name moves just that part.
    const placed = placeRig(g.bones, g.parts, new Map([...o].filter(([name]) => a.parts.has(name) || Object.hasOwn(g.bones, name))), g.pivotOf, [0, 0], g.unit), m = placed.parts;
    for (const [name, c] of a.parts) {
      const t = m[name];
      c.setFromMatrix(new Matrix(t.a, t.b, t.c, t.d, t.tx, t.ty));
    }
    for (const [bone, h] of a.holders) { const t = bone ? placed.bones[bone] ?? BONE_REST : BONE_REST; h.setFromMatrix(new Matrix(t.a, t.b, t.c, t.d, t.tx, t.ty)); }
    this.dimParts(a);
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
    const a = this.actors.get(char);
    if (!a) return null;
    const kids = a.body.children, gone = this.hiddenIn(a);
    for (let i = kids.length - 1; i >= 0; i--) {
      const c = kids[i], sp = c.children[0] as Sprite | MeshPlane | undefined;
      if (!sp || !c.label || !a.parts.has(c.label) || !c.visible || gone.has(c.label)) continue;
      let l: { x: number; y: number } | null = sp.toLocal({ x, y });
      const tex = sp.texture, warp = a.warps.get(c.label);
      // A lattice mesh is drawn deformed: the point is looked up on the art it shows there, not on the undeformed box.
      if (warp && sp instanceof MeshPlane) {
        const at = unwarpPoint(sp.geometry.getBuffer('aPosition').data as Float32Array, warp.rest, deformerGrid(warp.def), l.x, l.y);
        l = at && { x: at[0], y: at[1] };
      }
      if (!l || l.x < 0 || l.y < 0 || l.x >= tex.width || l.y >= tex.height) continue;
      if (this.alphaAt(tex, l.x, l.y) > 8) return c.label;
    }
    return null;
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
  /** Put an actor's node where `s` says: position, opacity, and scale, rotation and mirroring about its anchor. */
  private place(a: Actor, s: SpriteState) {
    a.node.position.set(s.x * W, H + s.y * H);
    a.node.alpha = s.alpha;
    this.turnAbout(a, s);
    a.turn.scale.set(s.scale * (s.flip ? -1 : 1), s.scale);
    a.turn.angle = s.rotation;
  }
  /** Move the turn container's origin to the anchor (a sprite of unknown size turns about its feet). */
  private turnAbout(a: Actor, s: SpriteState) {
    const o = a.size ? anchorOffset(s.anchor, a.size.w, a.size.h) : { x: 0, y: 0 };
    a.turn.position.set(o.x, o.y);
    a.body.position.set(-o.x, -o.y);
  }
  private makeActor(s: SpriteState, kept?: ChainStates): Actor {
    const node = new Container(), turn = new Container(), body = new Container();
    node.addChild(turn);
    turn.addChild(body);
    const a: Actor = { node, turn, body, size: null, key: '', fx: [], s, idle: null, talk: null, live: {}, clip: {}, blink: null, speaking: false, talkStart: 0, posed: false, parts: new Map(), partPose: new Map(), params: {}, paramParts: new Map(), warps: new Map(), masks: [], holders: new Map(), warpValues: {}, physics: kept ?? restStates(this.files.rigs[s.char]?.rig?.physics), lit: 1 };
    if (this.shown) { a.lit = this.focusNow(this.shown).levels.get(s.char) ?? 1; node.tint = grey(a.lit); } // a newcomer starts as lit or dimmed as they will be
    const data = this.files.rigs[s.char]?.rig, blink = blinkOf(data);
    if (data?.autonomous?.idle && !this.reduceMotion && this.shown?.behaviors !== false) a.idle = this.makeFx(s.char, data.autonomous.idle, null, 1, true);
    if (blink && this.shown?.behaviors !== false) a.blink = startBlink(blink.every, Math.random);
    const loop = s.anim && !this.reduceMotion ? this.makeFx(s.char, s.anim.name, s.anim.dur, s.anim.strength, true, s.anim.part) : null;
    if (loop) a.fx.push(loop);
    this.setParams(a, resolveParams(data?.parameters, s.params));
    this.dress(a, s);
    this.place(a, s);
    return a;
  }
  /** `keepPhysics`: a scene change, where a character who stays keeps the swing of her hair; a sync starts everyone at rest. */
  private rebuildSprites(state: DisplayState, keepPhysics = false) {
    const kept = new Map(keepPhysics ? [...this.actors].map(([c, a]) => [c, a.physics]) : []);
    for (const a of this.actors.values()) this.clearFx(a);
    // Clear the layer, not just `actors`: a sprite mid-hide is no longer in the map.
    for (const c of this.spriteLayer.removeChildren()) c.destroy({ children: true });
    this.actors.clear();
    this.pictures.rebuild(state);
    for (const s of state.sprites) {
      const a = this.makeActor(s, kept.get(s.char));
      this.actors.set(s.char, a);
      this.spriteLayer.addChild(a.node);
    }
    this.restack(state);
  }
  /** Draw the characters in the order of `state.sprites` (back to front), the raised speaker on top; one fading out keeps its place meanwhile. */
  private restack(state: DisplayState) {
    state.sprites.forEach((s, i) => { const a = this.actors.get(s.char); if (a) a.node.zIndex = s.char === this.raised ? state.sprites.length : i; });
  }

  /** The characters on stage back to front, for browser tests: where each is drawn (stage pixels) and how lit it is. */
  stageSnapshot() {
    return [...this.actors.values()].filter(a => a.node.parent === this.spriteLayer)
      .sort((a, b) => a.node.zIndex - b.node.zIndex)
      .map(a => {
        const r = a.node.getBounds();
        return { char: a.s.char, z: a.node.zIndex, lit: a.lit, tint: a.node.tint, alpha: a.node.alpha, masks: a.masks.length,
          bounds: [r.x, r.y, r.width, r.height].map(Math.round) };
      });
  }

  /** Zoom about the point (x, y) of the screen, which stays where it is. */
  private setCamera(c: Camera) {
    this.world.scale.set(c.zoom);
    this.world.position.set(c.x * W * (1 - c.zoom), c.y * H * (1 - c.zoom));
  }
  private setTint(t: { color: string; strength: number } | null) {
    if (t) this.tintLayer.tint = t.color;
    this.tintLayer.alpha = t ? t.strength : 0;
  }

  protected syncWorld(state: DisplayState) {
    for (const t of this.tweens) t.done();
    this.tweens.clear();
    this.shaker.position.set(0, 0);
    this.flashLayer.alpha = 0;
    this.setCamera(state.camera ?? { zoom: 1, x: 0.5, y: 0.5 });
    this.setTint(state.tint ?? null);
    this.effects.pixelate = null;
    this.effects.setWeather(state.weather ?? null);
    this.effects.setLook(state.filter ?? null);
    this.fade.alpha = 0;
    this.setBg(state.bg);
    this.shown = state;
    this.raised = null;
    this.rebuildSprites(state);
    this.releaseStale();
  }

  protected async applyWorld(op: WorldOp, state: DisplayState, alive: () => boolean): Promise<void> {
    this.shown = state; // `focus on/off` needs nothing more: stepFocus follows it
    if (this.reduceMotion) {
      // Anything that moves or flashes is dropped or shown as its result.
      if (op.op === 'shake' || op.op === 'hop' || op.op === 'animate' || op.op === 'flash') return;
      if (op.op === 'camera') { this.setCamera(state.camera ?? { zoom: 1, x: 0.5, y: 0.5 }); return; }
      if (op.op === 'weather') { this.effects.setWeather(null); return; }
      if (op.op === 'filter') { this.effects.setLook(state.filter ?? null); return; }
      if (op.op === 'scene' && ['wipe', 'iris', 'blinds', 'pixelate'].includes(op.transition)) op = { ...op, transition: 'dissolve' };
    }
    switch (op.op) {
      case 'scene': return this.worldScene(op, state, alive);
      case 'show': return this.worldShow(op, state);
      case 'hide': return this.worldHide(op, state, alive);
      case 'move': return this.worldMove(op, state);
      case 'image': return this.worldImage(op, state, alive);
      case 'shake': return this.worldShake(op);
      case 'flash': return this.worldFlash(op);
      case 'tint': return this.worldTint(op);
      case 'camera': return this.worldCamera(op, state);
      case 'weather': return this.worldWeather(op, state, alive);
      case 'filter': return this.worldFilter(op, state, alive);
      case 'hop': return this.worldHop(op);
      case 'param': return this.worldParam(op, state);
      case 'animate': return this.worldAnimate(op);
    }
  }

  private async worldScene(op: Extract<WorldOp, { op: 'scene' }>, state: DisplayState, alive: () => boolean): Promise<void> {
    if (op.transition === 'cut' || op.dur <= 0) { this.setBg(op.bg); this.rebuildSprites(state, true); return; }
    if (op.transition === 'fade') {
      await this.tween(op.dur / 2, k => { this.fade.alpha = k; });
      if (!alive()) return;
      this.setBg(op.bg); this.rebuildSprites(state, true);
      await this.tween(op.dur / 2, k => { this.fade.alpha = 1 - k; });
      return;
    }
    if (op.transition === 'pixelate') {
      const fx = this.effects.pixelate = this.effects.pixelFilter();
      this.effects.setLook(this.effects.filterNow);
      let swapped = false;
      await this.tween(op.dur, k => {
        fx.resources.pixelUniforms.uniforms.uBlock = pixelBlock(k);
        if (k >= 0.5 && !swapped) { swapped = true; this.setBg(op.bg); this.rebuildSprites(state, true); }
      });
      this.effects.pixelate = null;
      if (!alive()) return;
      this.effects.setLook(this.effects.filterNow);
      return;
    }
    this.rebuildSprites(state, true);
    const next = this.makeBg(op.bg);
    const maskArt = op.mask && !this.reduceMotion ? this.art.get(maskKey(op.mask, this.files) ?? '') : undefined;
    if (maskArt) {
      // The filter area is the stage, so the mask's coordinates are the stage's whatever the picture's cover scale.
      const holder = new Container(), fx = this.effects.maskFilter(maskArt);
      holder.filterArea = new Rectangle(0, 0, W, H);
      holder.filters = [fx];
      holder.addChild(next);
      this.bgLayer.addChild(holder);
      await this.tween(op.dur, t => { fx.resources.maskUniforms.uniforms.uK = EASES.inout(t); });
      if (!alive()) return;
      holder.filters = [];
      this.bgLayer.addChild(next);
      holder.destroy();
      for (const c of [...this.bgLayer.children]) if (c !== next) { this.bgLayer.removeChild(c); c.destroy(); }
      return;
    }
    this.bgLayer.addChild(next);
    if (op.transition === 'wipe' || op.transition === 'iris' || op.transition === 'blinds') {
      const transition = op.transition, mask = new Graphics();
      this.bgLayer.addChild(mask);
      next.mask = mask;
      const dir = op.dir ?? 'left';
      await this.tween(op.dur, t => {
        const k = EASES.inout(t);
        mask.clear();
        for (const sh of revealShapes(transition, dir, k, W, H)) {
          if ('circle' in sh) mask.circle(sh.circle.x, sh.circle.y, sh.circle.r);
          else mask.rect(sh.rect.x, sh.rect.y, sh.rect.w, sh.rect.h);
        }
        mask.fill(0xffffff);
      });
      if (!alive()) return;
      next.mask = null;
      mask.destroy();
    } else {
      next.alpha = 0;
      await this.tween(op.dur, t => { next.alpha = EASES.inout(t); });
      if (!alive()) return;
    }
    for (const c of [...this.bgLayer.children]) if (c !== next) { this.bgLayer.removeChild(c); c.destroy(); }
    return;
  }

  private async worldShow(op: Extract<WorldOp, { op: 'show' }>, state: DisplayState): Promise<void> {
    const s = state.sprites.find(x => x.char === op.char);
    if (!s) return;
    const existing = this.actors.get(op.char);
    if (existing) {
      this.restack(state);
      if (op.poses?.length) this.setParams(existing, resolveParams(this.files.rigs[op.char]?.rig?.parameters, s.params));
      this.dress(existing, s);
      existing.node.x = s.x * W;
      if (op.y !== undefined || op.scale !== undefined || op.flip !== undefined || op.anchor !== undefined) {
        existing.node.y = H + s.y * H;
        this.turnAbout(existing, s);
        existing.turn.scale.set(s.scale * (s.flip ? -1 : 1), s.scale);
      }
      return;
    }
    const a = this.makeActor(s);
    this.actors.set(s.char, a);
    this.spriteLayer.addChild(a.node);
    this.restack(state);
    if (op.fade > 0) { a.node.alpha = 0; await this.tween(op.fade, k => { a.node.alpha = k * s.alpha; }); }
    return;
  }

  private async worldHide(op: Extract<WorldOp, { op: 'hide' }>, state: DisplayState, alive: () => boolean): Promise<void> {
    const a = this.actors.get(op.char);
    if (!a) return;
    this.actors.delete(op.char);
    this.clearFx(a);
    if (op.fade > 0) {
      const from = a.node.alpha;
      await this.tween(op.fade, k => { a.node.alpha = from * (1 - k); });
      if (!alive()) return;
    }
    a.node.destroy({ children: true });
    return;
  }

  private async worldMove(op: Extract<WorldOp, { op: 'move' }>, state: DisplayState): Promise<void> {
    const a = this.actors.get(op.char);
    if (!a) return;
    const s = state.sprites.find(x => x.char === op.char);
    if (!s) return;
    const n = a.node, tn = a.turn, ease = easing(op.ease);
    this.turnAbout(a, s); // the anchor applies from the first frame, like mirroring
    const from = { x: n.x, y: n.y, scale: Math.abs(tn.scale.y), angle: tn.angle, alpha: n.alpha };
    const to = { x: s.x * W, y: H + s.y * H, scale: s.scale, angle: s.rotation, alpha: s.alpha };
    await this.tween(this.reduceMotion ? 0 : op.dur, t => { // reduced motion: the slide snaps to its end
      const k = ease(t);
      n.position.set(lerp(from.x, to.x, k), lerp(from.y, to.y, k));
      const sc = lerp(from.scale, to.scale, k);
      tn.scale.set(sc * (s.flip ? -1 : 1), sc); // mirroring is not tweened: it applies from the first frame
      tn.angle = lerp(from.angle, to.angle, k);
      n.alpha = lerp(from.alpha, to.alpha, k);
    });
    return;
  }

  private async worldImage(op: Extract<WorldOp, { op: 'image' }>, state: DisplayState, alive: () => boolean): Promise<void> {
    if (op.action === 'hide') {
      const sp = this.pictures.take(op.name);
      if (!sp) return;
      const from = sp.alpha;
      if (op.fade > 0) { await this.tween(op.fade, k => { sp.alpha = from * (1 - k); }); if (!alive()) return; }
      this.pictures.destroy(sp);
      return;
    }
    const img = (state.images ?? []).find(i => i.name === op.name);
    if (!img) return;
    let sp = this.pictures.get(op.name);
    if (op.action === 'show') {
      const shown = this.pictures.show(img);
      sp = shown.sprite;
      if (shown.fresh && op.fade > 0) { sp.alpha = 0; await this.tween(op.fade, k => { sp!.alpha = k * img.alpha; }); }
      return;
    }
    if (!sp) return;
    const target = sp, ease = easing(op.ease);
    target.anchor.set(img.anchor[0], img.anchor[1]); // like a character's anchor, applies from the first frame
    const from = { x: target.x, y: target.y, scale: target.scale.x, angle: target.angle, alpha: target.alpha };
    await this.tween(this.reduceMotion ? 0 : op.dur, t => {
      const k = ease(t);
      target.position.set(lerp(from.x, img.x, k), lerp(from.y, img.y, k));
      target.scale.set(lerp(from.scale, img.scale, k));
      target.angle = lerp(from.angle, img.rotation, k);
      target.alpha = lerp(from.alpha, img.alpha, k);
    });
    return;
  }

  private async worldShake(op: Extract<WorldOp, { op: 'shake' }>): Promise<void> {
    if (op.target !== 'screen') { // a character's shake is the `shake` animation, 8 pixels being strength 1
      const a = this.actors.get(op.target);
      if (a && op.dur > 0) await this.playFx(a, op.target, 'shake', op.dur, op.strength / 8);
      return;
    }
    const s = op.strength * FX() / 1080; // pixels on a 1080 side
    await this.tween(op.dur, k => { this.shaker.x = shakeOffset(s, k); });
    return;
  }

  private async worldFlash(op: Extract<WorldOp, { op: 'flash' }>): Promise<void> {
    this.flashLayer.tint = op.color;
    await this.tween(op.dur, k => { this.flashLayer.alpha = (1 - k) ** 2; });
    return;
  }

  private async worldTint(op: Extract<WorldOp, { op: 'tint' }>): Promise<void> {
    const from = this.tintLayer.alpha, to = op.color ? op.strength : 0;
    if (op.color) this.tintLayer.tint = op.color;
    await this.tween(op.dur, k => { this.tintLayer.alpha = from + (to - from) * k; });
    return;
  }

  private async worldCamera(op: Extract<WorldOp, { op: 'camera' }>, state: DisplayState): Promise<void> {
    const w = this.world, ease = easing(op.ease);
    const z0 = w.scale.x, to = op, fix = state.camera ?? { zoom: op.zoom ?? 1, x: op.x, y: op.y };
    // Interpolate the zoom and the pivot together, so a zoom that also pans moves smoothly.
    const p0 = cameraPivot(z0, w.x, w.y, W, H, to);
    await this.tween(op.dur, t => {
      const k = ease(t);
      this.setCamera({ zoom: z0 + (fix.zoom - z0) * k, x: p0.x + (fix.x - p0.x) * k, y: p0.y + (fix.y - p0.y) * k });
    });
    return;
  }

  private async worldWeather(op: Extract<WorldOp, { op: 'weather' }>, state: DisplayState, alive: () => boolean): Promise<void> {
    if (op.kind) {
      const fadeIn = !this.effects.weather;
      this.effects.setWeather(state.weather ?? null);
      if (fadeIn) await this.tween(op.dur, k => { this.effects.weatherLayer.alpha = k; });
    } else {
      const from = this.effects.weatherLayer.alpha;
      await this.tween(op.dur, k => { this.effects.weatherLayer.alpha = from * (1 - k); });
      if (alive()) this.effects.setWeather(null);
    }
    return;
  }

  private async worldFilter(op: Extract<WorldOp, { op: 'filter' }>, state: DisplayState, alive: () => boolean): Promise<void> {
    const from = this.effects.filterNow, to = op.name ? { name: op.name, strength: op.strength } : null;
    const name = (to ?? from)?.name;
    if (!name) return;
    const s0 = from && from.name === name ? from.strength : 0, s1 = to ? to.strength : 0;
    await this.tween(op.dur, k => { this.effects.setLook({ name, strength: s0 + (s1 - s0) * k }); });
    if (alive()) this.effects.setLook(state.filter ?? null);
    return;
  }

  private async worldHop(op: Extract<WorldOp, { op: 'hop' }>): Promise<void> {
    const a = this.actors.get(op.char);
    if (!a) return;
    if (op.dur > 0) await this.playFx(a, op.char, 'hop', op.dur, 1);
    return;
  }

  private async worldParam(op: Extract<WorldOp, { op: 'param' }>, state: DisplayState): Promise<void> {
    const a = this.actors.get(op.char), s = state.sprites.find(x => x.char === op.char);
    if (!a || !s) return;
    const defs = this.files.rigs[op.char]?.rig?.parameters;
    const from = a.params, to = resolveParams(defs, s.params);
    await this.tween(this.reduceMotion ? 0 : op.dur, t => this.setParams(a, lerpParams(defs, from, to, t, op.ease ?? undefined)));
    return;
  }

  private async worldAnimate(op: Extract<WorldOp, { op: 'animate' }>): Promise<void> {
    const a = this.actors.get(op.char);
    if (!a) return;
    if (op.name === null) { this.clearFx(a); return; }
    if (op.loop) {
      const fx = this.makeFx(op.char, op.name, op.dur, op.strength, true, op.part);
      if (fx) a.fx = [...a.fx.filter(f => !f.loop), fx]; // a new loop replaces the running one
    } else await this.playFx(a, op.char, op.name, op.dur, op.strength, op.part);
    return;
  }
}
