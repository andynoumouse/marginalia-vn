// WebGL world renderer (PixiJS 8). Draws images from assets/ when present, placeholder art otherwise:
//   backgrounds  assets/bg/<name>.(png|webp|jpg)          (or assets/<name>.*)
//   characters   assets/char/<char>/sprite.json           layered, from tools/psd-convert.mjs
//                assets/char/<char>/<pose>.(png|webp)     one image per pose ("default" when none is given)
// Characters are anchored bottom-center at x * stage width; backgrounds are scaled to cover the stage.

import { Application, Assets, ColorMatrixFilter, type ColorMatrix, Container, Graphics, Matrix, Mesh, MeshGeometry, MeshPlane, Rectangle, Sprite, Texture } from 'pixi.js';
import { IMAGE_FILE, AnimPlayer, overscanZoom, CAMERA_TARGET, mouthOpen, lerpRgb, mulRgb, rgbNumber, flashMatrix, imageBytes, type Resident, sampleLattice, warpFreeMesh, warpMeshPoints, type DeformerMesh, applyDisplacement, deformerGrid, deformerPoints, evalDeformer, isGroupDeformer, memberMeshGrid, paramsKey, restLattice, unionLatticeBox, warpMemberMesh, type DeformerDef, BONE_REST, compileSkin, isSkinned, skinPoints, evalPointKeyforms, maskChain, maskView, normalizeMasks, MASK_WARN_COUNT, partName, placeRig, pointKeyformKey, traceOutline, warpPoints, bendShapeByGroup, shapeBentByGroup, type MaskDef, type MaskPoint, addOffset, evalAll, addPhysicsParams, restStates, stepPhysics, windVelocity, type FxEnv, type WorldWind, type ChainStates, type PhysicsOff, lerpParams, autoAnimations, startAuto, stepAuto, everyBounds, reactionTarget, startReaction, stepReaction, type Value, resolveParams, anchorOffset, type AnimDef, bgKey, easing, EASES, focusLevels, raisedSpeaker, revealShapes, shakeOffset, maskKey, pixelBlock, lerp, NO_OFFSET, resolveAnim, partsUnder, rigLayers, showLooks, scaleOffset, spriteKeys, type Offset, type RigData, type Camera, type DisplayState, type SpriteState } from '../engine/src/index.js';
import { FX, type Actor, type Fx, type GroupWarp, type MaskNode } from './pixi-actor.js';
import { PictureLayer } from './picture-layer.js';
import { applyFlash } from './flash-filter.js';
import { Bursts } from './bursts.js';
import { SceneEffects } from './scene-effects.js';
import { rigGeometry } from './studio-queries.js';
import { assetUrl, H, hue, stage, StageRenderer, W, type AssetFile, type WorldOp } from './stage-ui.js';

const SPRITE_W = 420, SPRITE_H = 940;
/** What of a rig's deformers makes the meshes differ (who each warps, its lattice size and a group's box): the meshes are built again when it changes, not when only the points do. */
export const deformerShape = (list?: DeformerDef[]) => (list ?? []).map(d => `${d.id}:${d.part ?? ''}:${(d.members ?? []).join(',')}:${d.box?.join(',') ?? ''}:${d.mesh ? `m${d.mesh.verts.join(',')}/${d.mesh.tris.join(',')}` : deformerGrid(d).join('x')}`).sort().join('|');

interface Tween { elapsed: number; dur: number; update: (k: number) => void; done: () => void }


/** A grey tint of brightness `v` (0-1). */
const grey = (v: number) => { const g = Math.round(Math.max(0, Math.min(1, v)) * 255); return (g << 16) | (g << 8) | g; };

export class PixiRenderer extends StageRenderer {
  protected app = new Application();
  private world = new Container();
  /** The camera as last set (the world container's own transform cannot give back the pivot at zoom 1 or when rolled). */
  private camNow = { zoom: 1, x: 0.5, y: 0.5, roll: 0 };
  /** What `animate camera` is running (a sustained shake, a sway) and the offset it adds to the view now. */
  private camFx = new AnimPlayer(() => this.transforms);
  private camOffset: Offset = NO_OFFSET;
  private bgLayer = new Container();
  private spriteLayer = new Container();
  private transforms: Record<string, AnimDef> = {};
  /** The automatic transforms (`animate <target> <name> auto`) attached to a target, as animations for the scheduler; undefined when none. */
  private attachedAutos(names?: string[]): Record<string, AnimDef> | undefined {
    const out: Record<string, AnimDef> = {};
    for (const n of names ?? []) if (Object.hasOwn(this.transforms, n)) out[n] = this.transforms[n];
    return Object.keys(out).length ? out : undefined;
  }
  setTransforms(transforms: Record<string, AnimDef>) { this.transforms = transforms; this.pictures.transforms = transforms; }
  private bursts = new Bursts(); // `burst` puffs, in the world above the pictures
  private wind: WorldWind | null = null; // `wind`: what the physics chains feel right now (mid-ramp it is between the old and the new)
  private gravity = 1; // `gravity`: the factor on how hard weather and bursts fall
  private windClock = 0; // seconds, for the gusts the weather and bursts feel
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
  protected actors = new Map<string, Actor>();
  private shown: DisplayState | null = null;         // the state last synced or applied (speaker focus reads who is on stage)
  private raised: string | null = null;              // the speaker drawn in front for the line (speakerFocus.front)
  protected focused = new Map<string, string>();       // the animation studio's chosen part, by character
  protected focusedExtra = new Map<string, string[]>(); // the parts chosen with it
  protected hiddenParts = new Map<string, Set<string>>(); // the parts (bones: their parts) the animation studio hides on its stage, by character
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
    this.world.addChild(this.bgLayer, this.pictures.behind, this.spriteLayer, this.pictures.front, this.bursts.layer);
    this.effects.init(g => this.app.renderer.generateTexture({ target: g, resolution: 1 }));
    this.scene.addChild(this.world, this.pictures.fixed, this.effects.weatherLayer);
    this.shaker.addChild(this.scene, this.effects.vignette, this.tintLayer, this.flashLayer);
    this.app.stage.addChild(this.shaker, this.fade);
    this.app.ticker.add(t => this.step(t.deltaMS));
  }

  protected indexArt(assets: AssetFile[]) {
    this.artFiles.clear();
    for (const a of assets) if (IMAGE_FILE.test(a.file)) this.artFiles.set(a.file.replace(IMAGE_FILE, ''), assetUrl(a));
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
    this.pictures.step(ms / 1000, FX());
    this.stepCamera(ms / 1000);
    this.pictures.stepAutos(ms / 1000, { behaviors: this.shown?.behaviors !== false && this.autoRuns, reduceMotion: this.reduceMotion, vars: this.scriptVars() });
    this.stepFocus(ms / 1000);
    this.windClock += ms / 1000;
    const env: FxEnv = { gravity: this.gravity, windVx: windVelocity(this.wind, this.windClock) };
    this.effects.stepWeather(ms / 1000, env);
    this.effects.stepLook(ms / 1000);
    this.bursts.step(ms / 1000, env);
  }
  private speaker: string | null = null;
  private speakUntil = 0;
  /** Who spoke last, and until when (seconds) the voice recording keeps the mouth open: while a voice line plays its loudness moves that character's mouth, whatever the typing does. */
  private lastSpeaker: string | null = null;
  private mouthUntil = 0;
  private lipSync(): { who: string; open: boolean } | null {
    const level = this.lastSpeaker ? this.audio.voiceLevel() : null;
    if (level === null || !this.lastSpeaker) return null;
    const m = mouthOpen(level, performance.now() / 1000, this.mouthUntil);
    this.mouthUntil = m.until;
    return { who: this.lastSpeaker, open: m.open };
  }
  protected override speakTick(who: string | null) {
    this.speaker = who;
    if (who) this.lastSpeaker = who;
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
      this.paintActor(a);
    }
    if (raised !== this.raised) { this.raised = raised; this.restack(state); }
  }
  /** The story's variables (and unlocked./persistent. names) as a snapshot for the conditions of automatic animations and reactions; the game shell sets it. */
  scriptVars: () => Record<string, Value> = () => ({});
  /** False while the studio is open: automatic animations are suspended (Animate mode shows the animation under edit, Model mode a character being rigged). */
  autoRuns = true;
  /**
   * Automatic animations (rig.json `auto`) and reactions: run the scheduler, start and stop what it says, and lay the slot
   * variants of the automatic frame tracks over the script's (an explicit `slot=variant` beats them; a running `animate` beats them).
   */
  protected stepLive(a: Actor, seconds: number) {
    const data = this.files.rigs[a.s.char]?.rig;
    const attached = this.attachedAutos(a.s.autos);
    if (!data && !attached && !a.auto) return;
    const entries = autoAnimations({ ...attached, ...data?.animations }); // a rig's own animation of the same name wins over an attached transform
    const lip = this.lipSync();
    const speaking = lip ? lip.who === a.s.char && lip.open : this.speaker === a.s.char && performance.now() < this.speakUntil;
    a.speaking = speaking;
    const vars = this.scriptVars();
    const base = this.studio && this.studioValues ? resolveParams(data?.parameters, this.studioValues) : a.params; // the studio's panel stands for the script's values
    if (entries.length || a.auto) {
      const ctx = { speaking, behaviors: this.shown?.behaviors !== false && this.autoRuns, reduceMotion: this.reduceMotion, vars, params: base }; // `behaviors off` suspends them
      const step = stepAuto(a.auto ?? startAuto(entries, Math.random), entries, seconds, ctx, Math.random);
      a.auto = step.state;
      if (step.stop.length) a.autoFx = a.autoFx.filter(f => !step.stop.includes(f.name ?? ''));
      for (const name of step.start) {
        const order = entries.findIndex(e => e.name === name);
        const fx = this.makeFx(a.s.char, name, null, 1, everyBounds(entries[order].auto.every) === null);
        if (fx) a.autoFx.push({ ...fx, auto: true, name, order });
      }
    }
    if (data && (data.reactions?.length || a.reaction.entry !== null || Object.keys(a.reaction.now).length)) {
      const target = reactionTarget(data.reactions, { speaking, vars, params: base });
      const dt = this.reduceMotion || this.skipping ? 1e6 : seconds; // reduced motion: the move snaps
      const before = this.studio ? JSON.stringify(a.reaction.now) : '';
      a.reaction = stepReaction(a.reaction, data.reactions, target, dt, pose => data.poses?.[pose], data.parameters, base);
      if (this.studio && JSON.stringify(a.reaction.now) !== before) queueMicrotask(() => this.studioRefresh?.()); // the studio poses on request: ask for the move's next step
    }
    const live: Record<string, string> = {};
    for (const f of [...a.autoFx].sort((x, y) => (x.order ?? 0) - (y.order ?? 0))) { // the later one in the file wins a slot
      if (this.studio) f.elapsed += seconds; // the studio does not step actors (stepFx), so the clock runs here
      if (!f.frames) continue;
      const frames = f.frames(Math.min(1, f.loop ? (f.elapsed % f.dur) / f.dur : f.elapsed / f.dur), f.loop ? f.elapsed % f.dur : Math.min(f.elapsed, f.dur));
      for (const [slot, v] of Object.entries(frames)) if (!(slot in a.s.overrides)) live[slot] = v;
    }
    Object.assign(live, a.clip); // while a frame track plays it owns its slot: before and after, the script's value shows
    if (JSON.stringify(live) === JSON.stringify(a.live)) return;
    // Only swap to art that is loaded: a missing variant would show an empty part for a moment.
    const shown = { ...a.s, overrides: { ...a.s.overrides, ...live } };
    if (!spriteKeys(shown, this.files).every(k => this.art.has(k))) return;
    a.live = live;
    this.dress(a, a.s);
  }
  /** The parameters a reaction holds right now that the script has not set (still at their default): they go under the script's values. */
  protected reactionLayer(a: Actor, base: Record<string, number> = a.params): Record<string, number> | null {
    const now = a.reaction.now;
    if (!Object.keys(now).length) return null;
    const out: Record<string, number> = {};
    for (const d of this.files.rigs[a.s.char]?.rig?.parameters ?? []) if (Object.hasOwn(now, d.id) && base[d.id] === d.default) out[d.id] = now[d.id];
    return Object.keys(out).length ? out : null;
  }
  /** Draw the rig's parameters at `values`: the keyforms are evaluated again, and the next frame poses the parts by them. */
  protected setParams(a: Actor, values: Record<string, number>) {
    a.params = values;
    a.paramParts = this.keyformParts(a.s.char, values);
    this.applyWarps(a, values);
    a.posed = true;
  }
  /** What the keyforms of `char`'s rig make of the parameter `values`, by part or bone. */
  protected keyformParts(char: string, values: Record<string, number>): Map<string, Offset> {
    const rig = this.files.rigs[char]?.rig;
    return new Map(Object.entries(evalAll(rig?.keyforms, values)).map(([name, f]) => [name, { dx: f.dx, dy: f.dy, sx: f.sx, sy: f.sy, rot: f.rot, ...(f.opacity !== 1 ? { opacity: f.opacity } : {}) }]));
  }
  /** Advance an actor's animations and pose its body by their sum. */
  private stepFx(a: Actor, seconds: number) {
    // The studio poses actors itself (studioPose, on every change and while playing). Stepping them here would pose the parameters'
    // defaults over that on every frame, so a rig with keyforms never showed the pose the author had set.
    if (this.studio) return;
    const layer = this.reactionLayer(a);
    const running = [...a.fx, ...a.autoFx];
    const chains = this.studio ? undefined : this.files.rigs[a.s.char]?.rig?.physics;
    if (!running.length && !a.paramParts.size && !chains && !layer) {
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
      if (f.frames && !f.auto) Object.assign(clip, f.frames(t, f.loop ? f.elapsed % f.dur : Math.min(f.elapsed, f.dur))); // an automatic one's frames are laid by stepLive
    }
    a.clip = clip;
    // The parameters first (a reaction's pose under the script's values, the animations' tracks over them), the animations' own motion on top.
    const defs = this.files.rigs[a.s.char]?.rig?.parameters;
    const tweaked = !!layer || Object.keys(tracked).length > 0;
    const values = tweaked ? resolveParams(defs, { ...a.params, ...layer, ...tracked }) : a.params;
    const anim = parts; // the animations' own motion; the parameters' go under it
    const withParams = (base: Map<string, Offset>) => { const m = new Map(anim); for (const [name, p] of base) m.set(name, addOffset(p, anim.get(name) ?? NO_OFFSET)); return m; };
    let posed = withParams(tweaked ? this.keyformParts(a.s.char, values) : a.paramParts);
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
  protected swing(a: Actor, chains: NonNullable<RigData['physics']>, values: Record<string, number>, posed: Map<string, Offset>, dt: number, off: PhysicsOff, withParams: (base: Map<string, Offset>) => Map<string, Offset>): Map<string, Offset> {
    const r = stepPhysics(chains, a.physics, values, posed, dt, off, this.wind);
    a.physics = r.states;
    if (Object.keys(r.params).length) {
      const driven = addPhysicsParams(this.files.rigs[a.s.char]?.rig?.parameters, values, r.params);
      posed = withParams(this.keyformParts(a.s.char, driven));
      this.applyWarps(a, driven);
    } else this.applyWarps(a, values);
    for (const [name, rot] of Object.entries(r.rot)) posed.set(name, addOffset(posed.get(name) ?? NO_OFFSET, { ...NO_OFFSET, rot }));
    return posed;
  }
  /** The studio's panel values (what it poses with) and how the page asks for a repaint; automatic animations and reactions read them in the studio. */
  studioValues: Record<string, number> | null = null;
  studioRefresh: (() => void) | null = null;
  /** Set by the animation studio's page: it poses actors itself (`studioPose`), so the game's own stepping stays out of the way. */
  studio = false;
  /** The parts of `a` the studio hides now. */
  protected hiddenIn(a: Actor): Set<string> {
    const names = this.hiddenParts.get(a.s.char), out = new Set<string>();
    if (!names) return out;
    const rig = this.files.rigs[a.s.char]?.rig, bones = rig?.bones, onBone = Object.fromEntries(Object.entries(rig?.parts ?? {}).map(([p, d]) => [p, d?.bone]));
    for (const n of names) for (const p of bones && Object.hasOwn(bones, n) && !a.parts.has(n) ? partsUnder(bones, onBone, n) : [n]) out.add(p);
    return out;
  }
  protected dimParts(a: Actor) {
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
  protected poseBody(a: Actor, o: Offset) {
    a.body.position.set(o.dx * FX(), o.dy * FX());
    a.body.scale.set(1 + o.sx, 1 + o.sy);
    a.body.angle = o.rot;
    a.body.alpha = Math.min(1, o.opacity ?? 1); // an animation's opacity key; the script's alpha lives on the node
    a.body.tint = o.tint ?? 0xffffff; // a transform's tint= and flash= channels, over the sprite's own tint and the focus grey on the node
    applyFlash(a.node, o.flash);
  }
  /** Stop every animation of an actor, ending one-shots so whoever awaits them goes on. */
  private clearFx(a: Actor) {
    for (const f of a.fx) f.done?.();
    a.fx = [];
    this.poseBody(a, NO_OFFSET);
    this.posePartsOf(a, new Map());
  }
  /** The animation `name` of character `char` (its rig.json one, else a preset) ready to play, or null for an unknown name. */
  private makeFx(char: string, name: string, dur: number | null, strength: number, loop: boolean, part: string | null = null, def?: AnimDef): Fx | null {
    const a = resolveAnim(name, { ...this.transforms, ...(def ? { [name]: def } : {}), ...this.files.rigs[char]?.rig?.animations }); // a character's own animation beats a script transform
    if (!a) { this.warnOnce(`${char} has no animation "${name}"`); return null; }
    return { fn: a.fn, parts: a.parts, params: a.params, frames: a.frames, physicsOff: a.physicsOff, part, dur: dur ?? a.dur, strength, loop, elapsed: 0 };
  }
  private async playFx(a: Actor, char: string, name: string, dur: number | null, strength: number, part: string | null = null, def?: AnimDef): Promise<void> {
    const fx = this.makeFx(char, name, dur, strength, false, part, def);
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
      const list = rig.rig?.deformers ?? [], own = new Map(list.filter(d => !isGroupDeformer(d)).map(d => [d.part, d] as const)), grouped = new Map<string, DeformerDef>();
      for (const d of list) if (isGroupDeformer(d)) for (const m of d.members ?? []) if (!grouped.has(m)) grouped.set(m, d);
      return {
        key: `rig:${picks.map(p => p.file).join('|')}|w:${deformerShape(list)}${maskView(rig.rig).map(m => `|m:${m.id}:${m.part}`).join('')}`,
        // Each layer sits in a container of its part that turns and scales about the part's pivot (see rig.json `pivots`).
        build: () => picks.map(p => {
          const tex = this.art.get(dir + p.file.replace(IMAGE_FILE, '')) ?? Texture.EMPTY, def = own.get(p.part), group = grouped.get(p.part);
          // A part with a deformer, or in a group warp, is a lattice mesh in place of its sprite; applyWarps shapes it.
          const sp = def?.mesh ? this.freeMesh(tex, def.mesh) : def || group ? this.warpMesh(tex, memberMeshGrid(def ? deformerGrid(def) : null, !!group)) : new Sprite(tex);
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
  /** A part drawn on a free mesh (rig.json `deformers[].mesh`): its stored vertices, UVs over the image box, and its triangles. applyWarps shapes it. */
  private freeMesh(tex: Texture, m: DeformerMesh): Mesh {
    const w = Math.max(1, tex.width), h = Math.max(1, tex.height), positions = Float32Array.from(m.verts), uvs = new Float32Array(positions.length);
    for (let i = 0; i + 1 < uvs.length; i += 2) { uvs[i] = positions[i] / w; uvs[i + 1] = positions[i + 1] / h; }
    return new Mesh({ geometry: new MeshGeometry({ positions, uvs, indices: Uint32Array.from(m.tris) }), texture: tex });
  }
  private warpMesh(tex: Texture, grid: readonly [number, number]): MeshPlane {
    const [cols, rows] = grid, mesh = new MeshPlane({ texture: tex, verticesX: cols + 1, verticesY: rows + 1 });
    mesh.autoResize = false; // the lattice is ours: a texture update must not rebuild (and so reset) it
    return mesh;
  }
  /**
   * Shape the lattice meshes by the parameter `values`. A deformer is recomputed only when the parameters it reads changed;
   * then the position buffer is rewritten and uploaded.
   */
  protected applyWarps(a: Actor, values: Record<string, number>) {
    a.warpValues = values;
    for (const g of a.groups.values()) {
      const key = paramsKey(g.def, values);
      if (key === g.key) continue;
      g.key = key;
      g.disp = evalDeformer(g.def, values);
    }
    for (const w of a.warps.values()) {
      // A member is dirty when its own warp's or its group's parameter values changed.
      const key = `${w.def ? paramsKey(w.def, values) : ''}#${w.group?.key ?? ''}`;
      if (key === w.key) continue;
      w.key = key;
      const buf = w.mesh.geometry.getBuffer('aPosition');
      if (w.tris) {
        const gp = w.group;
        // A skinned part is shaped into a private buffer; applySkins moves that by the bones into the one that is drawn.
        warpFreeMesh(w.rest, w.def ? evalDeformer(w.def, values) : null, gp ? { box: gp.box, sample: (u, v) => sampleLattice(gp.disp, deformerGrid(gp.def), u, v) } : null, w.origin, FX(), w.skin ? w.skin.shaped : buf.data as Float32Array);
        if (w.skin) w.skin.version++; else buf.update();
        continue;
      }
      warpMemberMesh(w.rest, w.grid, w.def ? { grid: deformerGrid(w.def), disp: evalDeformer(w.def, values) } : null, w.group ? { box: w.group.box, grid: deformerGrid(w.group.def), disp: w.group.disp } : null, w.origin, FX(), buf.data as Float32Array);
      buf.update();
    }
    this.applySkins(a);
    this.applyMasks(a, values);
  }
  /** What posePartsOf last placed per actor: the bones' world matrices and the own key of each skinned part (docs/design/skinning.md). */
  protected placedBones = new WeakMap<Actor, { bones: ReturnType<typeof placeRig>['bones']; keys: ReturnType<typeof placeRig>['keys'] }>();
  /**
   * Move the skinned parts' shaped vertices by the bones into the buffers that are drawn, each only when its shaped vertices, its own key
   * or a bone it reads changed. The masks that follow a part whose skin changed are drawn again (they read that buffer).
   */
  private applySkins(a: Actor) {
    const placed = this.placedBones.get(a);
    if (!placed) return;
    let changed = false;
    for (const [name, w] of a.warps) {
      const s = w.skin;
      if (!s) continue;
      const mx = (m: { a: number; b: number; c: number; d: number; tx: number; ty: number } | undefined) => (m ? `${m.a},${m.b},${m.c},${m.d},${m.tx},${m.ty}` : '-');
      const key = `${s.version}#${mx(placed.keys[name])}#${s.skin.bones.map(b => mx(placed.bones[b])).join('|')}`;
      if (key === s.key) continue;
      s.key = key;
      const buf = w.mesh.geometry.getBuffer('aPosition');
      skinPoints(s.skin, s.shaped, [w.mesh.x, w.mesh.y], placed.bones, buf.data as Float32Array, placed.keys[name]);
      buf.update();
      for (const m of a.masks) if (m.frame === name) m.key = null;
      changed = true;
    }
    if (changed) this.applyMasks(a, a.warpValues);
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
  protected polygonShape(def: MaskDef, at: [number, number]): Float32Array[] {
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
    const rig = this.files.rigs[a.s.char];
    if (!rig || rig.flat) return;
    const names = new Set((rig.parts ?? []).map(partName)), list = maskView(rig.rig, this.studioChars.has(a.s.char)), { clips } = normalizeMasks(rig.rig); // shape parts and `clip` links; the studio also draws shapes that clip nothing
    if (!list.length) return;
    const ox = (rig.width ?? 0) / 2, oy = rig.height ?? 0, deformers = rig.rig?.deformers ?? [];
    const art =(name: string) => a.parts.get(name)?.children[0] as Sprite | Mesh | undefined;
    const made = new Map<string, MaskNode>(), hide = new Set<string>(), loose: MaskNode[] = [];
    for (const def of list) {
      const free = def.part === ''; // a shape that clips nothing (the studio only)
      if (!free && !a.parts.has(def.part)) continue; // the clipped part is not drawn: nothing to clip
      const frame = def.from ?? (def.on !== undefined && names.has(def.on) ? def.on : null), sp = frame !== null ? art(frame) : undefined;
      if (frame !== null && !sp) { if (!free) hide.add(def.part); continue; } // the shape follows a part that is not drawn
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
      // A shape listed in a group warp's members bends with that lattice, unless it follows a member of the same group (already in that part's mesh).
      const shapeName = def.shape ?? (def.polygon ? clips[def.part] : undefined), gd = shapeName !== undefined ? deformers.find(d => isGroupDeformer(d) && d.members?.includes(shapeName)) : undefined;
      const group = gd && shapeBentByGroup(def.on, gd.members) ? a.groups.get(gd.id) ?? null : null;
      const node: MaskNode = { def, g: new Graphics(), shapes, frame, box: sp ? { w: sp.texture.width, h: sp.texture.height } : null, at, key: null, drawn: [], group };
      if (free) { node.g.renderable = false; loose.push(node); } else made.set(def.part, node);
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
    for (const [part] of made) {
      const chain = maskChain(list, part).slice(0, 2).map(m => made.get(m.part));
      if (chain.some(n => !n)) { hide.add(part); continue; }
      const nodes = chain as MaskNode[];
      for (const n of nodes) hang(n);
      a.parts.get(part)!.mask = nodes[0].g;
      if (nodes[1]) art(part)!.mask = nodes[1].g;
    }
    for (const part of hide) a.parts.get(part)!.visible = false;
    for (const n of loose) hang(n);
    for (const n of [...made.values(), ...loose]) if (placed.has(n)) a.masks.push(n); else n.g.destroy();
    if (a.masks.length > MASK_WARN_COUNT) this.warnOnce(`${a.s.char}: ${a.masks.length} masks (more than ${MASK_WARN_COUNT}); each is stencil passes every frame, which has not been measured on weak phones`);
  }
  /** Draw the masks' shapes for the parameter `values`, again only where their own parameters or their frame part's warp changed. */
  protected applyMasks(a: Actor, values: Record<string, number>) {
    for (const m of a.masks) {
      const warp = m.frame !== null ? a.warps.get(m.frame) : undefined, kf = m.def.keyforms;
      const key = `${pointKeyformKey(kf, values)}#${warp?.key ?? ''}#${m.group?.key ?? ''}`;
      if (key === m.key) continue;
      m.key = key;
      m.g.clear();
      m.drawn = m.shapes.map(rest => {
        let pts = rest;
        if (m.def.polygon && Array.isArray(kf) && kf.length) pts = applyDisplacement(pts, evalPointKeyforms(kf, rest.length / 2, values), FX(), FX());
        const keyed = pts;
        // The mesh buffer holds the part as drawn (its own warp, then its group's), so the shape bends with both.
        if (warp?.tris && m.box) pts = warpMeshPoints(pts, warp.rest, warp.mesh.geometry.getBuffer('aPosition').data as Float32Array, warp.tris);
        else if (warp && m.box) pts = warpPoints(pts, m.box, warp.grid, warp.mesh.geometry.getBuffer('aPosition').data as Float32Array);
        // A shape that is itself a group member: the lattice is read at its (keyform-moved) canvas position and added on top.
        if (m.group) pts = bendShapeByGroup(keyed, m.at, { box: m.group.box, grid: deformerGrid(m.group.def), disp: m.group.disp }, FX(), pts);
        m.g.poly(Array.from(pts)).fill(0xffffff);
        return pts;
      });
    }
  }
  /** How many stencil masks are on stage now (each is extra draw passes every frame; the debug console's `memory` reports it). */
  override maskCount(): number { let n = 0; for (const a of this.actors.values()) n += a.masks.length; return n; }
  /** The characters whose shapes the studio edits: every shape is drawn there, also one that clips nothing. */
  protected studioChars = new Set<string>();
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
  protected dress(a: Actor, s: SpriteState) {
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
    a.groups = new Map();
    const defs = this.files.rigs[s.char]?.rig?.deformers ?? [], rigData = this.files.rigs[s.char];
    for (const [name, c] of a.parts) {
      const mesh = c.children[0], def = defs.find(d => !isGroupDeformer(d) && d.part === name) ?? null, inGroup = defs.some(d => isGroupDeformer(d) && d.members?.includes(name));
      if (!(mesh instanceof Mesh) || !(def || inGroup)) continue;
      const free = def?.mesh ? def.mesh : null, grid: [number, number] = free ? [0, 0] : memberMeshGrid(def ? deformerGrid(def) : null, inGroup);
      // The mesh sits at the part's box in the actor's space (the canvas shifted to its bottom middle): add that shift back for canvas pixels.
      a.warps.set(name, { mesh, def, group: null, grid, rest: free ? Float32Array.from(free.verts) : restLattice(mesh.texture.width, mesh.texture.height, grid), tris: free ? Uint32Array.from(free.tris) : null, origin: [mesh.x + (rigData?.width ?? 0) / 2, mesh.y + (rigData?.height ?? 0)], key: null, skin: free && isSkinned(free) ? { skin: compileSkin(free, free.verts.length >> 1), shaped: Float32Array.from(free.verts), version: 0, key: null } : null });
    }
    // A group warp's box is its own, or the union of its members' image boxes on the canvas; one with no member on stage has nothing to bend.
    for (const d of defs) {
      if (!isGroupDeformer(d)) continue;
      const members = (d.members ?? []).filter(m => a.warps.has(m));
      const box = d.box ?? unionLatticeBox(members.map(m => { const w = a.warps.get(m)!; return [w.origin[0], w.origin[1], w.mesh.texture.width, w.mesh.texture.height] as const; }));
      if (!box) continue; // a group of shapes only has an explicit box (checkDeformers); shapes do not widen the default one
      const g: GroupWarp = { def: d, box: [box[0], box[1], box[2], box[3]], disp: new Float32Array(deformerPoints(d) * 2), key: null, members };
      a.groups.set(d.id, g);
      for (const m of members) { const w = a.warps.get(m)!; if (!w.group) w.group = g; }
    }
    this.buildMasks(a);
    this.applyWarps(a, a.warpValues);
    if (this.focused.size || this.hiddenParts.size) this.dimParts(a);
    a.key = key;
    this.posePartsOf(a, a.partPose);
  }
  /** Turn the parts about their pivots: `o` has the offsets of those that move (by part or bone name); the rest go back to rest. */
  protected posePartsOf(a: Actor, o: Map<string, Offset>) {
    a.partPose = o;
    const g = rigGeometry(this.files, a);
    // A name that is a bone (and no part) moves the bone and what hangs on it; a part name moves just that part.
    const skinned = new Set([...a.warps].filter(([, w]) => w.skin).map(([name]) => name));
    const placed = placeRig(g.bones, g.parts, new Map([...o].filter(([name]) => a.parts.has(name) || Object.hasOwn(g.bones, name))), g.pivotOf, [0, 0], g.unit, skinned), m = placed.parts;
    for (const [name, c] of a.parts) {
      const t = m[name];
      c.setFromMatrix(new Matrix(t.a, t.b, t.c, t.d, t.tx, t.ty));
    }
    this.placedBones.set(a, { bones: placed.bones, keys: placed.keys });
    this.applySkins(a);
    for (const [bone, h] of a.holders) { const t = bone ? placed.bones[bone] ?? BONE_REST : BONE_REST; h.setFromMatrix(new Matrix(t.a, t.b, t.c, t.d, t.tx, t.ty)); }
    this.dimParts(a);
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
  /** The tint of a character: the speaker-focus grey times its own `tint=`. */
  private paintActor(a: Actor) { a.node.tint = mulRgb(grey(a.lit), a.hue); }
  private makeActor(s: SpriteState, kept?: ChainStates): Actor {
    const node = new Container(), turn = new Container(), body = new Container();
    node.addChild(turn);
    turn.addChild(body);
    const a: Actor = { node, turn, body, size: null, key: '', fx: [], s, auto: null, autoFx: [], reaction: startReaction(), live: {}, clip: {}, speaking: false, posed: false, parts: new Map(), partPose: new Map(), params: {}, paramParts: new Map(), warps: new Map(), groups: new Map(), masks: [], holders: new Map(), warpValues: {}, physics: kept ?? restStates(this.files.rigs[s.char]?.rig?.physics), lit: 1, hue: rgbNumber(s.tint) };
    if (this.shown) a.lit = this.focusNow(this.shown).levels.get(s.char) ?? 1; // a newcomer starts as lit or dimmed as they will be
    this.paintActor(a);
    const data = this.files.rigs[s.char]?.rig;
    const loop = s.anim && !this.reduceMotion ? this.makeFx(s.char, s.anim.name, s.anim.dur, s.anim.strength, true, s.anim.part, s.anim.def) : null;
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
    this.pictures.rebuild(state, this.reduceMotion);
    // A scene starts with the camera at rest (the state already says so): back to the normal view, and its animations ended.
    this.syncCameraFx(state);
    this.setCamera(state.camera ?? { zoom: 1, x: 0.5, y: 0.5 });
    this.bursts.clear();
    this.wind = state.wind ?? null; // a scene calms the wind and restores gravity (the state already says so)
    this.gravity = state.gravity ?? 1;
    // And clears the tint, the weather and the filter, which a live `scene` used to leave on (only a jump or a load cleared them).
    this.setTint(state.tint ?? null);
    this.effects.setWeather(state.weather ?? null);
    this.effects.setLook(state.filter ?? null);
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
  /** Each part of `char` as a box [x, y, w, h] in stage pixels, as it is drawn now (a skinned mesh as bent): a dev hook, `vnParts`, for tests. */
  partBounds(char: string): Record<string, [number, number, number, number]> {
    const a = this.actors.get(char), out: Record<string, [number, number, number, number]> = {};
    if (!a) return out;
    for (const [name, c] of a.parts) {
      const sp = c.children[0];
      if (sp) { const r = sp.getBounds(); out[name] = [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; }
    }
    // The stencils too, keyed mask:<shape>: the box of the points each was drawn at (in the space it hangs in, so a bent follower differs from its rest).
    for (const m of a.masks) {
      const pts = m.drawn.flatMap(d => Array.from(d)), xs = pts.filter((_, i) => i % 2 === 0), ys = pts.filter((_, i) => i % 2 === 1);
      if (xs.length) out[`mask:${m.def.shape ?? m.def.part}`] = [Math.round(Math.min(...xs)), Math.round(Math.min(...ys)), Math.round(Math.max(...xs) - Math.min(...xs)), Math.round(Math.max(...ys) - Math.min(...ys))];
    }
    return out;
  }
  /** What the world shows besides the characters, for the browser tests: the filter, the tint over the stage and the weather. */
  worldSnapshot() {
    return { filter: this.effects.filterNow?.name ?? null, tint: this.tintLayer.alpha > 0 ? this.tintLayer.alpha : 0, weather: this.effects.weather?.kind ?? null };
  }
  stageSnapshot() {
    return [...this.actors.values()].filter(a => a.node.parent === this.spriteLayer)
      .sort((a, b) => a.node.zIndex - b.node.zIndex)
      .map(a => {
        const r = a.node.getBounds();
        return { char: a.s.char, z: a.node.zIndex, lit: a.lit, tint: a.node.tint, alpha: a.node.alpha, fxTint: a.body.tint, flashing: Array.isArray(a.node.filters) ? a.node.filters.length : a.node.filters ? 1 : 0, masks: a.masks.length,
          bounds: [r.x, r.y, r.width, r.height].map(Math.round) };
      });
  }

  /** Run the camera's animations a frame and move the view by what they add. */
  private stepCamera(seconds: number) {
    this.camFx.stepAutos(seconds, { behaviors: this.shown?.behaviors !== false && this.autoRuns, reduceMotion: this.reduceMotion, vars: this.scriptVars() });
    const o = this.camFx.step(seconds);
    if (!o) return;
    this.camOffset = o;
    this.setCamera(this.camNow);
  }
  /** Start from the camera animations the state has (a load, a rollback, a scene): its loop and its automatic transforms. */
  private syncCameraFx(state: DisplayState) {
    this.camFx.clear();
    this.camOffset = NO_OFFSET;
    const c = state.camera;
    if (c?.anim && !this.reduceMotion) this.camFx.start(c.anim.name, c.anim.dur, c.anim.strength, true, undefined, c.anim.def);
    this.camFx.attach(c?.autos);
  }
  private async worldAnimateCamera(op: Extract<WorldOp, { op: 'animate' }>, state: DisplayState): Promise<void> {
    if (op.auto) { this.camFx.attach(state.camera?.autos); return; }
    if (op.name === null) {
      this.camFx.stop();
      if (!this.camFx.running) { this.camOffset = NO_OFFSET; this.setCamera(this.camNow); }
      return;
    }
    if (this.reduceMotion) return;
    if (op.loop) { if (!this.camFx.start(op.name, op.dur, op.strength, true, undefined, op.def)) this.warnOnce(`camera has no animation "${op.name}"`); return; }
    let known = true;
    await new Promise<void>(done => { known = this.camFx.start(op.name!, op.dur, op.strength, false, done, op.def); if (!known) done(); });
    if (!known) this.warnOnce(`camera has no animation "${op.name}"`);
  }

  /** Zoom about the point (x, y) of the screen, which stays where it is. */
  private setCamera(c: Camera) {
    const o = this.camOffset;
    const px = c.x * W, py = c.y * H, r = ((c.roll ?? 0) + o.rot) * Math.PI / 180;
    let z = c.zoom * (1 + o.sx);
    // Overscan: a roll or a shake at zoom 1 or more would show the stage edge, so zoom in just enough to hide it (a zoomed-out camera shows it on purpose).
    if (c.zoom >= 1 && (r !== 0 || o.dx !== 0 || o.dy !== 0)) z = Math.max(z, overscanZoom(W, H, px, py, r, o.dx * FX(), o.dy * FX()));
    const cos = Math.cos(r), sin = Math.sin(r);
    this.camNow = { zoom: c.zoom, x: c.x, y: c.y, roll: c.roll ?? 0 }; // the view the script set, without what `animate camera` adds
    this.world.scale.set(z);
    this.world.rotation = r;
    // Zoom and turn about the pivot, which stays where it is (at no roll: P * (1 - z)); the animation's shift on top.
    this.world.position.set(px - z * (cos * px - sin * py) + o.dx * FX(), py - z * (sin * px + cos * py) + o.dy * FX());
    this.pictures.followCamera(this.world, FX());
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
    this.syncCameraFx(state);
    this.setCamera(state.camera ?? { zoom: 1, x: 0.5, y: 0.5 });
    this.setTint(state.tint ?? null);
    this.effects.pixelate = null;
    this.effects.setWeather(state.weather ?? null);
    this.effects.setLook(state.filter ?? null);
    this.wind = state.wind ?? null;
    this.gravity = state.gravity ?? 1;
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
      if (op.op === 'shake' || op.op === 'hop' || op.op === 'animate' || op.op === 'flash' || op.op === 'burst') return;
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
      case 'burst': return this.worldBurst(op);
      case 'flash': return this.worldFlash(op);
      case 'tint': return this.worldTint(op);
      case 'camera': return this.worldCamera(op, state);
      case 'weather': return this.worldWeather(op, state, alive);
      case 'filter': return this.worldFilter(op, state, alive);
      case 'wind': return this.worldWind(op, state, alive);
      case 'gravity': this.gravity = state.gravity ?? 1; return;
      case 'hop': return this.worldHop(op);
      case 'param': return this.worldParam(op, state);
      case 'animate': return this.worldAnimate(op, state);
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
    const hue0 = a.hue, hue1 = rgbNumber(s.tint);
    await this.tween(this.reduceMotion ? 0 : op.dur, t => { // reduced motion: the slide snaps to its end
      const k = ease(t);
      if (op.tint !== undefined) { a.hue = lerpRgb(hue0, hue1, k); this.paintActor(a); }
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
    const hue0 = target.tint, hue1 = rgbNumber(img.tint);
    await this.tween(this.reduceMotion ? 0 : op.dur, t => {
      const k = ease(t);
      if (op.tint !== undefined) target.tint = lerpRgb(hue0, hue1, k);
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

  /** A puff of particles at a character (the middle of its body on screen) or at a point of the stage; it does not hold the script up. */
  private async worldBurst(op: Extract<WorldOp, { op: 'burst' }>): Promise<void> {
    let x = (op.x ?? 0.5) * W, y = (op.y ?? 0.5) * H;
    if (op.char !== undefined) {
      const a = this.actors.get(op.char);
      if (!a) return;
      const b = a.node.getBounds(), at = this.world.toLocal({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
      x = at.x; y = at.y;
    }
    this.bursts.add(op.kind, x, y, op.count, op.dur);
  }

  private async worldFlash(op: Extract<WorldOp, { op: 'flash' }>): Promise<void> {
    if (op.char) return this.flashSprite(op.char, rgbNumber(op.color), op.dur);
    this.flashLayer.tint = op.color;
    await this.tween(op.dur, k => { this.flashLayer.alpha = (1 - k) ** 2; });
    return;
  }

  /** A hit flash: the character or picture mixes to `color` and back, through a color matrix filter that lasts only as long as the flash. */
  private async flashSprite(name: string, color: number, dur: number): Promise<void> {
    const target = this.actors.get(name)?.node ?? this.pictures.get(name)?.parent;
    if (!target) return;
    const flash = new ColorMatrixFilter(), before = target.filters;
    target.filters = [...(Array.isArray(before) ? before : before ? [before] : []), flash];
    try {
      await this.tween(dur, k => { flash.matrix = flashMatrix(color, (1 - k) ** 2) as ColorMatrix; });
    } finally {
      if (!target.destroyed) target.filters = before ? [...(Array.isArray(before) ? before : [before])] : [];
      flash.destroy();
    }
  }

  private async worldTint(op: Extract<WorldOp, { op: 'tint' }>): Promise<void> {
    const from = this.tintLayer.alpha, to = op.color ? op.strength : 0;
    if (op.color) this.tintLayer.tint = op.color;
    await this.tween(op.dur, k => { this.tintLayer.alpha = from + (to - from) * k; });
    return;
  }

  private async worldCamera(op: Extract<WorldOp, { op: 'camera' }>, state: DisplayState): Promise<void> {
    const ease = easing(op.ease);
    const c0 = this.camNow, fix = state.camera ?? { zoom: op.zoom ?? 1, x: op.x ?? 0.5, y: op.y ?? 0.5, roll: op.roll ?? 0 };
    // Interpolate the zoom, the pivot and the roll together, so a zoom that also pans moves smoothly.
    await this.tween(op.dur, t => {
      const k = ease(t);
      this.setCamera({ zoom: c0.zoom + (fix.zoom - c0.zoom) * k, x: c0.x + (fix.x - c0.x) * k, y: c0.y + (fix.y - c0.y) * k, roll: c0.roll + ((fix.roll ?? 0) - c0.roll) * k });
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

  private async worldWind(op: Extract<WorldOp, { op: 'wind' }>, state: DisplayState, alive: () => boolean): Promise<void> {
    const s0 = this.wind?.strength ?? 0, s1 = op.strength, gusts = op.strength ? op.gusts : this.wind?.gusts ?? 0;
    await this.tween(op.dur, k => { this.wind = { strength: s0 + (s1 - s0) * k, gusts }; });
    if (alive()) this.wind = state.wind ?? null;
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

  /** `animate <image> ...`: a preset on a picture shown with `image show` (a rig's parts and animations do not apply). */
  private async worldAnimatePicture(op: Extract<WorldOp, { op: 'animate' }>, state: DisplayState): Promise<void> {
    const sp = this.pictures.get(op.char);
    if (!sp) return;
    if (op.auto) { this.pictures.attach(sp, state.images?.find(i => i.name === op.char)?.autos); return; }
    if (op.name === null) { this.pictures.stop(sp); return; }
    if (this.reduceMotion) return;
    if (op.loop) { if (!this.pictures.start(sp, op.name, op.dur, op.strength, true, undefined, op.def)) this.warnOnce(`${op.char} has no animation "${op.name}"`); return; }
    let known = true;
    await new Promise<void>(done => { known = this.pictures.start(sp, op.name!, op.dur, op.strength, false, done, op.def); if (!known) done(); });
    if (!known) this.warnOnce(`${op.char} has no animation "${op.name}"`);
    return;
  }

  private async worldAnimate(op: Extract<WorldOp, { op: 'animate' }>, state: DisplayState): Promise<void> {
    if (op.char === CAMERA_TARGET) return this.worldAnimateCamera(op, state);
    const a = this.actors.get(op.char);
    if (!a) return this.worldAnimatePicture(op, state);
    if (op.auto) return; // attached in the state: the scheduler picks it up on the next frame
    if (op.name === null) { this.clearFx(a); return; }
    if (op.loop) {
      const fx = this.makeFx(op.char, op.name, op.dur, op.strength, true, op.part, op.def);
      if (fx) a.fx = [...a.fx.filter(f => !f.loop), fx]; // a new loop replaces the running one
    } else await this.playFx(a, op.char, op.name, op.dur, op.strength, op.part, op.def);
    return;
  }
}
