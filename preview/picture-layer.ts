// The overlay pictures of the WebGL renderer (`image show`): their sprites in three layers (behind the characters, in
// front of them, and fixed on the screen), and the video textures of looping movie pictures.

import { Container, Sprite, Texture, VideoSource } from 'pixi.js';
import { imageKey, type AssetContext, type DisplayState, type ImageState } from '../engine/src/index.js';

/** What the layer needs from the renderer: the project's files, loaded art, placeholder textures and looping videos. */
export interface PictureHost {
  files(): AssetContext;
  art(key: string): Texture | undefined;
  canvasTexture(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): Texture;
  takeLoopVideo(key: string): HTMLVideoElement | null;
  releaseVideo(video: HTMLVideoElement): void;
}

export class PictureLayer {
  /** Overlay pictures behind the characters (layer below 0), in front of them, and still on the screen (`fixed`). */
  readonly behind = new Container();
  readonly front = new Container();
  readonly fixed = new Container();
  private pictures = new Map<string, Sprite>();
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
    this.layerOf(img).addChild(sp);
    this.place(sp, img);
    sp.alpha = img.alpha;
    return { sprite: sp, fresh: false };
  }

  rebuild(state: DisplayState) {
    for (const layer of [this.behind, this.front, this.fixed]) for (const c of layer.removeChildren()) this.destroy(c as Sprite);
    this.pictures.clear();
    for (const img of state.images ?? []) this.make(img);
  }

  /** Destroy a picture that is no longer drawn, freeing its video (also one that is still loading). */
  destroy(sp: Sprite) {
    const tex = sp.texture;
    this.videoWanted.delete(sp);
    sp.destroy();
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
    sp.zIndex = img.layer;
  }
  private layerOf(img: ImageState): Container {
    return img.fixed ? this.fixed : img.layer < 0 ? this.behind : this.front;
  }
  private make(img: ImageState): Sprite {
    const sp = new Sprite(Texture.EMPTY);
    this.setTexture(sp, img);
    sp.label = img.name;
    this.place(sp, img);
    sp.alpha = img.alpha;
    this.layerOf(img).addChild(sp);
    this.pictures.set(img.name, sp);
    return sp;
  }
}
