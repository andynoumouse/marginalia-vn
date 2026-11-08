// The overlay pictures of the WebGL renderer (`image show`): their sprites in three layers (behind the characters, in
// front of them, and fixed on the screen), and the video textures of looping movie pictures.

import { Container, Sprite, Texture, VideoSource } from 'pixi.js';
import { AnimPlayer, imageKey, NO_OFFSET, rgbNumber, type AnimDef, type AssetContext, type DisplayState, type ImageState, type Offset, type Value } from '../engine/src/index.js';
import { applyFlash } from './flash-filter.js';

/** What the layer needs from the renderer: the project's files, loaded art, placeholder textures and looping videos. */
export interface PictureHost {
  files(): AssetContext;
  art(key: string): Texture | undefined;
  canvasTexture(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): Texture;
  takeLoopVideo(key: string): HTMLVideoElement | null;
  releaseVideo(video: HTMLVideoElement): void;
}

/**
 * Each picture is a sprite inside a holder container. The sprite carries what the script says (`image show`, `image move`
 * tweens); the holder carries the running animations' offset about the sprite's position, so the two never fight.
 */
export class PictureLayer {
  /** Overlay pictures behind the characters (layer below 0), in front of them, and still on the screen (`fixed`). */
  readonly behind = new Container();
  readonly front = new Container();
  readonly fixed = new Container();
  private pictures = new Map<string, Sprite>();
  /** The animations running on a picture and the automatic transforms attached to it (`animate <image> ...`), by picture. */
  private players = new Map<Sprite, AnimPlayer>();
  /** The script's transforms, which a picture can play besides the presets. */
  transforms: Record<string, AnimDef> = {};
  private videoTextures = new Map<Texture, HTMLVideoElement>(); // the textures of looping movie pictures, with the video each plays
  private videoWanted = new WeakMap<Sprite, HTMLVideoElement>(); // a movie picture whose video has not loaded yet

  constructor(private host: PictureHost) {
    for (const c of [this.behind, this.front, this.fixed]) c.sortableChildren = true;
  }

  get(name: string): Sprite | undefined { return this.pictures.get(name); }

  /** Forget a picture by name (for a hide that fades it first: `destroy` it afterwards). */
  take(name: string): Sprite | undefined {
    const sp = this.pictures.get(name);
    this.pictures.delete(name);
    return sp;
  }

  /** `image show`: an existing picture takes the new file and fields at once, else a new one is made. */
  show(img: ImageState): { sprite: Sprite; fresh: boolean } {
    const sp = this.pictures.get(img.name);
    if (!sp) return { sprite: this.make(img), fresh: true };
    this.setTexture(sp, img);
    this.layerOf(img).addChild(sp.parent!);
    this.place(sp, img);
    sp.alpha = img.alpha;
    return { sprite: sp, fresh: false };
  }

  rebuild(state: DisplayState, reduceMotion = false) {
    for (const layer of [this.behind, this.front, this.fixed]) for (const h of layer.removeChildren()) for (const c of [...h.children]) this.destroy(c as Sprite);
    this.pictures.clear();
    this.parallax.clear();
    this.players.clear();
    for (const img of state.images ?? []) {
      const sp = this.make(img);
      this.attach(sp, img.autos);
      if (img.anim && !reduceMotion) this.start(sp, img.anim.name, img.anim.dur, img.anim.strength, true, undefined, img.anim.def);
    }
  }

  private player(sp: Sprite): AnimPlayer {
    let p = this.players.get(sp);
    if (!p) this.players.set(sp, p = new AnimPlayer(() => this.transforms));
    return p;
  }

  /** Start animation `name` (a preset or transform) on a picture: a loop replaces the running loop. Returns false for an unknown name. */
  start(sp: Sprite, name: string, dur: number | null, strength: number, loop: boolean, done?: () => void, def?: AnimDef): boolean {
    const p = this.player(sp), ok = p.start(name, dur, strength, loop, done, def);
    if (!p.active) this.players.delete(sp);
    return ok;
  }

  /** `animate <image> stop`: end every animation on a picture (one-shots count as finished). */
  stop(sp: Sprite) {
    const p = this.players.get(sp);
    if (!p) return;
    p.stop();
    if (!p.active) this.players.delete(sp);
    if (!p.running) this.pose(sp, NO_OFFSET, 1); // the automatic ones are the scheduler's, so they go on
  }

  /** `animate <image> <name> auto [off]`: the automatic transforms a picture has now (the state's list). */
  attach(sp: Sprite, names: string[] | undefined) {
    if (!names?.length && !this.players.has(sp)) return;
    this.player(sp).attach(names);
  }

  /** Run the scheduler for the attached automatic transforms: start and stop what its conditions and timers say. */
  stepAutos(seconds: number, ctx: { behaviors: boolean; reduceMotion: boolean; vars: Record<string, Value> }) {
    for (const [sp, p] of this.players) {
      if (sp.destroyed) { this.players.delete(sp); continue; }
      const was = p.running;
      p.stepAutos(seconds, ctx);
      if (was && !p.running) this.pose(sp, NO_OFFSET, 1);
      if (!p.active) this.players.delete(sp);
    }
  }

  /** Advance the running animations by `seconds`; `unit` is the stage unit offsets are fractions of (fxUnit). */
  step(seconds: number, unit: number) {
    for (const [sp, p] of this.players) {
      if (sp.destroyed) { this.players.delete(sp); continue; }
      const o = p.step(seconds);
      if (o) this.pose(sp, o, unit);
      if (!p.active) this.players.delete(sp);
    }
    // A moving picture (`image move`) with parallax changes the shift each frame, whether or not an animation runs.
    for (const sp of this.parallax.keys()) if (!this.players.get(sp)?.running) this.pose(sp, this.posed.get(sp) ?? NO_OFFSET, unit);
  }

  /** The camera (the renderer's world container) and the stage unit, as last given to `followCamera`. */
  private cam: { world: Container; unit: number } | null = null;
  /** Pictures that follow the camera by some other share than all of it (`parallax=`), and the animation offset each stands at. */
  private parallax = new Map<Sprite, number>();
  private posed = new WeakMap<Sprite, Offset>();

  /** The camera moved: shift the pictures that follow it by a share (`parallax=`) so they cover less or more of the way than the world does. */
  followCamera(world: Container, unit: number) {
    this.cam = { world, unit };
    for (const sp of this.parallax.keys()) this.pose(sp, this.posed.get(sp) ?? NO_OFFSET, unit);
  }

  /** Where a picture with parallax `q` must stand, relative to its place in the world, so that the camera moves it `q` times as far as it moves the world. */
  private parallaxShift(sp: Sprite): { x: number; y: number } {
    const q = this.parallax.get(sp);
    if (q === undefined || !this.cam || sp.parent?.parent === this.fixed) return { x: 0, y: 0 };
    const { world } = this.cam, z = world.scale.x, r = world.rotation, cos = Math.cos(r), sin = Math.sin(r);
    const px = sp.x, py = sp.y;
    const tx = world.x + z * (cos * px - sin * py), ty = world.y + z * (sin * px + cos * py); // where the world puts the picture
    const sx = px + q * (tx - px), sy = py + q * (ty - py); // where it should be on the screen
    const vx = sx - world.x, vy = sy - world.y;
    return { x: (cos * vx + sin * vy) / z - px, y: (-sin * vx + cos * vy) / z - py };
  }

  private pose(sp: Sprite, o: Offset, unit: number) {
    const h = sp.parent;
    if (!h) return;
    this.posed.set(sp, o);
    const d = this.parallaxShift(sp);
    h.pivot.set(sp.x, sp.y); // turn and scale about the picture's anchor point
    h.position.set(sp.x + o.dx * unit + d.x, sp.y + o.dy * unit + d.y);
    h.scale.set(1 + o.sx, 1 + o.sy);
    h.angle = o.rot;
    h.alpha = Math.min(1, o.opacity ?? 1);
    h.tint = o.tint ?? 0xffffff; // a transform's tint= and flash= channels, over the picture's own tint
    applyFlash(h, o.flash);
  }

  /** Destroy a picture that is no longer drawn, freeing its video (also one that is still loading). */
  destroy(sp: Sprite) {
    const tex = sp.texture;
    const holder = sp.parent;
    this.videoWanted.delete(sp);
    this.players.get(sp)?.finishAll();
    this.players.delete(sp);
    this.parallax.delete(sp);
    sp.destroy();
    holder?.destroy();
    this.freeVideo(tex);
  }

  private texture(img: Pick<ImageState, 'file' | 'name'>): Texture {
    const key = imageKey(img.file, this.host.files());
    const art = key && this.host.art(key);
    if (art) return art;
    return this.host.canvasTexture(`image:${img.file}`, 480, 320, g => {
      g.fillStyle = 'rgba(40,50,80,.85)';
      g.fillRect(0, 0, 480, 320);
      g.strokeStyle = 'rgba(255,255,255,.5)';
      g.lineWidth = 4;
      g.strokeRect(2, 2, 476, 316);
      g.fillStyle = '#fff';
      g.font = '28px system-ui, sans-serif';
      g.textBaseline = 'top';
      g.fillText(img.file, 20, 20);
    });
  }
  /** Stop and free the video behind a picture's texture, if it has one. */
  private freeVideo(tex: Texture) {
    const video = this.videoTextures.get(tex);
    if (!video) return;
    this.videoTextures.delete(tex);
    tex.destroy(true);
    this.host.releaseVideo(video);
  }
  /**
   * Give a picture the texture of its file. A movie is empty until its video has loaded: a video texture made
   * earlier would be 1x1 and the frames would not fit into it.
   */
  private setTexture(sp: Sprite, img: ImageState) {
    const old = sp.texture;
    const key = imageKey(img.file, this.host.files());
    const video = key?.startsWith('movie/') ? this.host.takeLoopVideo(key) : null;
    this.videoWanted.delete(sp);
    if (!video) { sp.texture = this.texture(img); this.freeVideo(old); return; }
    sp.texture = Texture.EMPTY;
    this.freeVideo(old);
    this.videoWanted.set(sp, video);
    // takeLoopVideo plays the video (with its sound), so the source does not try to start it itself
    const source = new VideoSource({ resource: video, autoPlay: false, loop: true });
    void source.load().then(() => {
      if (sp.destroyed || this.videoWanted.get(sp) !== video) { source.destroy(); this.host.releaseVideo(video); return; }
      this.videoWanted.delete(sp);
      const tex = new Texture({ source });
      this.videoTextures.set(tex, video);
      sp.texture = tex;
    }, () => { source.destroy(); this.host.releaseVideo(video); });
  }
  private place(sp: Sprite, img: ImageState) {
    sp.anchor.set(img.anchor[0], img.anchor[1]);
    sp.position.set(img.x, img.y);
    sp.scale.set(img.scale);
    sp.angle = img.rotation;
    sp.tint = rgbNumber(img.tint);
    if (sp.parent) sp.parent.zIndex = img.layer;
    const q = img.parallax ?? 1;
    if (q === 1) this.parallax.delete(sp); else this.parallax.set(sp, q);
    if (this.cam && (q !== 1 || this.posed.has(sp))) this.pose(sp, this.posed.get(sp) ?? NO_OFFSET, this.cam.unit);
  }
  private layerOf(img: ImageState): Container {
    return img.fixed ? this.fixed : img.layer < 0 ? this.behind : this.front;
  }
  private make(img: ImageState): Sprite {
    const sp = new Sprite(Texture.EMPTY);
    const holder = new Container();
    holder.addChild(sp);
    this.setTexture(sp, img);
    sp.label = img.name;
    this.place(sp, img);
    sp.alpha = img.alpha;
    this.layerOf(img).addChild(holder);
    this.pictures.set(img.name, sp);
    return sp;
  }
}
