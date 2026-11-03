// WebGL world renderer (PixiJS 8). Draws images from assets/ when present, placeholder art otherwise:
//   backgrounds  assets/bg/<name>.(png|webp|jpg)          (or assets/<name>.*)
//   characters   assets/char/<char>/sprite.json           layered, from tools/psd-convert.mjs
//                assets/char/<char>/<pose>.(png|webp)     one image per pose ("default" when none is given)
// Characters are anchored bottom-center at x * stage width; backgrounds are scaled to cover the stage.

import { Application, Assets, BlurFilter, ColorMatrixFilter, Container, Filter, GlProgram, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import { imageBytes, type Resident, addOffset, anchorOffset, type AnimDef, bgKey, imageKey, blinkOf, blindsRects, blurRadius, easing, EASES, filterMatrix, focusLevels, raisedSpeaker, fxUnit, irisRadius, mulberry32, pixelBlock, spawnParticle, stepParticle, weatherCount, WEATHER, type FilterName, type Particle, type WeatherName, lerp, mouthFrame, NO_OFFSET, resolveAnim, partGroups, rigLayers, scaleOffset, spreadPartOffsets, speakOf, spriteKeys, startBlink, stepBlink, type BlinkState, type Offset, type Camera, type DisplayState, type ImageState, type SpriteState } from '../engine/src/index.js';
import { $, H, hue, stage, StageRenderer, W, type AssetFile, type WorldOp } from './stage-ui.js';

const IMAGE = /\.(png|webp|jpe?g|avif)$/i;
const SPRITE_W = 420, SPRITE_H = 940;
/** The length animation offsets are fractions of (the stage's shorter side, see fxUnit). */
const FX = () => fxUnit({ width: W, height: H });

interface Tween { elapsed: number; dur: number; update: (k: number) => void; done: () => void }

/** A named animation playing on a character (`engine/src/anim.ts`); a one-shot resolves `done` when it ends. */
interface Fx { fn: (t: number) => Partial<Offset>; parts?: (t: number) => Record<string, Partial<Offset>>; part: string | null; dur: number; strength: number; loop: boolean; elapsed: number; done?: () => void }

/** A character on stage: `node` sits at the stage position (the feet), `turn` scales, turns and mirrors it about its anchor, `body` carries the animation offsets and the art. */
interface Actor {
  node: Container; turn: Container; body: Container; size: { w: number; h: number } | null; key: string; fx: Fx[];
  s: SpriteState;                  // what the script says it looks like (slot overrides: `s.overrides`)
  idle: Fx | null; talk: Fx | null; // rig.json idle / speak.anim loops, outside `fx` so `animate ... stop` leaves them be
  live: Record<string, string>;    // slot variants swapped in by itself right now (blinking, talking)
  blink: BlinkState | null;
  speaking: boolean; talkStart: number; posed: boolean;
  parts: Map<string, Container>;   // a layered character's parts (slots and plain layers) by name, each turning about its pivot
  partPose: Map<string, Offset>;   // what the parts are posed with now, kept so a swapped-in slot variant starts posed
  lit: number;                     // speaker focus: 1 lit, lower dimmed (drawn as a grey tint), easing toward focusLevels
}

/** A grey tint of brightness `v` (0-1). */
const grey = (v: number) => { const g = Math.round(Math.max(0, Math.min(1, v)) * 255); return (g << 16) | (g << 8) | g; };

export class PixiRenderer extends StageRenderer {
  private app = new Application();
  private world = new Container();
  private bgLayer = new Container();
  private spriteLayer = new Container();
  private imagesBehind = new Container(); // overlay pictures (`image show`): behind the characters (layer below 0), in front of them, and still on the screen (`fixed`)
  private imagesFront = new Container();
  private imagesFixed = new Container();
  private pictures = new Map<string, Sprite>();
  private shaker = new Container(); // screen shake moves this; the camera moves `world`
  private scene = new Container();  // the world and the weather: `filter` applies to this
  private weatherLayer = new Container();
  private vignette = new Sprite();
  private particles: { p: Particle; sprite: Sprite }[] = [];
  private weather: { kind: WeatherName; intensity: number } | null = null;
  private weatherRand = mulberry32(20240229); // decoration only: never the story's RNG
  private clock = 0;
  private dot = Texture.EMPTY;
  private filterNow: { name: FilterName; strength: number } | null = null; // the filter on screen now
  private blur = new BlurFilter();
  private matrix = new ColorMatrixFilter();
  private pixelate: Filter | null = null;
  private tintLayer = new Graphics();
  private flashLayer = new Graphics();
  private fade = new Graphics();
  private actors = new Map<string, Actor>();
  private shown: DisplayState | null = null;         // the state last synced or applied (speaker focus reads who is on stage)
  private raised: string | null = null;              // the speaker drawn in front for the line (speakerFocus.front)
  private focused = new Map<string, string>();       // the animation studio's chosen part, by character
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
    for (const c of [this.imagesBehind, this.imagesFront, this.imagesFixed, this.spriteLayer]) c.sortableChildren = true;
    this.world.addChild(this.bgLayer, this.imagesBehind, this.spriteLayer, this.imagesFront);
    this.makeEffectTextures();
    this.scene.addChild(this.world, this.imagesFixed, this.weatherLayer);
    this.shaker.addChild(this.scene, this.vignette, this.tintLayer, this.flashLayer);
    this.app.stage.addChild(this.shaker, this.fade);
    this.app.ticker.add(t => this.step(t.deltaMS));
  }

  protected indexArt(assets: AssetFile[]) {
    this.artFiles.clear();
    for (const a of assets) if (IMAGE.test(a.file)) this.artFiles.set(a.file.replace(IMAGE, ''), `assets/${a.file}?v=${a.v}`);
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
    this.stepWeather(ms / 1000);
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
    const blink = blinkOf(data), speak = speakOf(data), now = performance.now();
    const speaking = this.speaker === a.s.char && now < this.speakUntil;
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
    if (JSON.stringify(live) === JSON.stringify(a.live)) return;
    // Only swap to art that is loaded: a missing variant would show an empty part for a moment.
    const shown = { ...a.s, overrides: { ...a.s.overrides, ...live } };
    if (!spriteKeys(shown, this.files).every(k => this.art.has(k))) return;
    a.live = live;
    this.dress(a, a.s);
  }
  /** Advance an actor's animations and pose its body by their sum. */
  private stepFx(a: Actor, seconds: number) {
    const running = [...a.fx, ...(a.idle ? [a.idle] : []), ...(a.talk ? [a.talk] : [])];
    if (!running.length) {
      if (a.posed) { this.poseBody(a, NO_OFFSET); this.posePartsOf(a, new Map()); a.posed = false; }
      return;
    }
    let o: Offset = NO_OFFSET;
    const parts = new Map<string, Offset>();
    const addPart = (name: string, p: Offset) => parts.set(name, addOffset(parts.get(name) ?? NO_OFFSET, p));
    for (const f of running) {
      f.elapsed += seconds;
      const t = Math.min(1, f.loop ? (f.elapsed % f.dur) / f.dur : f.elapsed / f.dur);
      const body = scaleOffset(f.fn(t), f.strength);
      if (f.part) addPart(f.part, body); // `animate ... part=`: the animation moves that part instead of the body
      else o = addOffset(o, body);
      if (f.parts) for (const [name, p] of Object.entries(f.parts(t))) addPart(name, scaleOffset(p, f.strength));
    }
    a.fx = a.fx.filter(f => {
      if (f.loop || f.elapsed < f.dur) return true;
      f.done?.();
      return false;
    });
    a.posed = true;
    this.poseBody(a, o);
    this.posePartsOf(a, parts);
  }
  /**
   * The animation studio poses a character as animation `name` stands at progress `t` (0-1): `anims` is the working copy
   * of the character's `animations`, and `part` moves just that part. False when the character is not on stage or the name is unknown.
   */
  studioPose(char: string, anims: Record<string, AnimDef>, name: string, t: number, part: string | null = null): boolean {
    const a = this.actors.get(char), r = resolveAnim(name, anims);
    if (!a || !r) return false;
    const parts = new Map<string, Offset>();
    let o: Offset = NO_OFFSET;
    const body = scaleOffset(r.fn(t), 1);
    if (part) parts.set(part, body); else o = body;
    if (r.parts) for (const [p, off] of Object.entries(r.parts(t))) parts.set(p, addOffset(parts.get(p) ?? NO_OFFSET, scaleOffset(off, 1)));
    this.poseBody(a, o);
    this.posePartsOf(a, parts);
    return true;
  }
  /** The animation studio shows `char` at rest (no animation offsets), to place pivots on. */
  studioRest(char: string) {
    const a = this.actors.get(char);
    if (!a) return;
    this.poseBody(a, NO_OFFSET);
    this.posePartsOf(a, new Map());
  }
  /** The animation studio brings one part (or a group's parts) of `char` forward by dimming the rest; null shows all. */
  studioFocus(char: string, part: string | null) {
    if (part) this.focused.set(char, part); else this.focused.delete(char);
    const a = this.actors.get(char);
    if (a) this.dimParts(a);
  }
  private dimParts(a: Actor) {
    const part = this.focused.get(a.s.char), rig = this.files.rigs[a.s.char];
    const lit = part ? (rig ? partGroups(rig)[part] : undefined) ?? [part] : null;
    for (const [name, c] of a.parts) c.alpha = !lit || lit.includes(name) ? 1 : 0.2;
  }
  /** The studio's working copy of `pivots` replaces the character's own, and its layers are built again with them. */
  studioPivots(char: string, pivots: Record<string, [number, number]>) {
    const rig = this.files.rigs[char], a = this.actors.get(char);
    if (!rig) return;
    rig.rig = { ...rig.rig, pivots };
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
    return { fn: a.fn, parts: a.parts, part, dur: dur ?? a.dur, strength, loop, elapsed: 0 };
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
      const picks = rigLayers(rig, s.pose, s.overrides, msg => this.warnOnce(`${s.char}: ${msg}`));
      const dir = `char/${s.char}/`;
      return {
        key: `rig:${picks.map(p => p.file).join('|')}`,
        // Each layer sits in a container of its part that turns and scales about the part's pivot (see rig.json `pivots`).
        build: () => picks.map(p => {
          const sp = new Sprite(this.art.get(dir + p.file.replace(IMAGE, '')) ?? Texture.EMPTY);
          const left = p.x - (rig.width ?? 0) / 2, top = p.y - (rig.height ?? 0);
          sp.position.set(left, top);
          const pv = rig.rig?.pivots?.[p.part];
          const px = pv ? pv[0] - (rig.width ?? 0) / 2 : left + sp.texture.width / 2, py = pv ? pv[1] - (rig.height ?? 0) : top + sp.texture.height / 2;
          const part = new Container();
          part.label = p.part;
          part.pivot.set(px, py);
          part.position.set(px, py);
          part.addChild(sp);
          return part;
        }),
      };
    }
    const { tex, key } = this.spriteTexture(s);
    return { key, build: () => { const sp = new Sprite(tex); sp.anchor.set(0.5, 1); return [sp]; } };
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
    a.parts = new Map(nodes.filter(c => c.label).map(c => [c.label, c]));
    if (this.focused.size) this.dimParts(a);
    a.key = key;
    this.posePartsOf(a, a.partPose);
  }
  /** Turn the parts about their pivots: `o` has the offsets of those that move (by part or group name); the rest go back to rest. */
  private posePartsOf(a: Actor, o: Map<string, Offset>) {
    a.partPose = o;
    const rig = this.files.rigs[a.s.char];
    const pivot = (name: string): [number, number] | null => {
      const c = a.parts.get(name), pv = rig?.rig?.pivots?.[name];
      if (c) return [c.pivot.x, c.pivot.y];
      return pv ? [pv[0] - (rig!.width ?? 0) / 2, pv[1] - (rig!.height ?? 0)] : null; // a group's own pivot
    };
    const spread = o.size && rig ? spreadPartOffsets(o, partGroups(rig), pivot, FX()) : o;
    for (const [name, c] of a.parts) {
      const p = spread.get(name) ?? NO_OFFSET;
      c.position.set(c.pivot.x + p.dx * FX(), c.pivot.y + p.dy * FX());
      c.scale.set(1 + p.sx, 1 + p.sy);
      c.angle = p.rot;
    }
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
  private makeActor(s: SpriteState): Actor {
    const node = new Container(), turn = new Container(), body = new Container();
    node.addChild(turn);
    turn.addChild(body);
    const a: Actor = { node, turn, body, size: null, key: '', fx: [], s, idle: null, talk: null, live: {}, blink: null, speaking: false, talkStart: 0, posed: false, parts: new Map(), partPose: new Map(), lit: 1 };
    if (this.shown) { a.lit = this.focusNow(this.shown).levels.get(s.char) ?? 1; node.tint = grey(a.lit); } // a newcomer starts as lit or dimmed as they will be
    const data = this.files.rigs[s.char]?.rig, blink = blinkOf(data);
    if (data?.idle && !this.reduceMotion) a.idle = this.makeFx(s.char, data.idle, null, 1, true);
    if (blink) a.blink = startBlink(blink.every, Math.random);
    const loop = s.anim && !this.reduceMotion ? this.makeFx(s.char, s.anim.name, s.anim.dur, s.anim.strength, true, s.anim.part) : null;
    if (loop) a.fx.push(loop);
    this.dress(a, s);
    this.place(a, s);
    return a;
  }
  private rebuildSprites(state: DisplayState) {
    for (const a of this.actors.values()) this.clearFx(a);
    // Clear the layer, not just `actors`: a sprite mid-hide is no longer in the map.
    for (const c of this.spriteLayer.removeChildren()) c.destroy({ children: true });
    this.actors.clear();
    this.rebuildPictures(state);
    for (const s of state.sprites) {
      const a = this.makeActor(s);
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
        return { char: a.s.char, z: a.node.zIndex, lit: a.lit, tint: a.node.tint, alpha: a.node.alpha,
          bounds: [r.x, r.y, r.width, r.height].map(Math.round) };
      });
  }

  // ---- overlay pictures ----
  private pictureTexture(img: Pick<ImageState, 'file' | 'name'>): Texture {
    const key = imageKey(img.file, this.files);
    const art = key && this.art.get(key);
    if (art) return art;
    return this.canvasTexture(`image:${img.file}`, 480, 320, g => {
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
  private placePicture(sp: Sprite, img: ImageState) {
    sp.anchor.set(img.anchor[0], img.anchor[1]);
    sp.position.set(img.x, img.y);
    sp.scale.set(img.scale);
    sp.angle = img.rotation;
    sp.zIndex = img.layer;
  }
  private pictureLayer(img: ImageState): Container {
    return img.fixed ? this.imagesFixed : img.layer < 0 ? this.imagesBehind : this.imagesFront;
  }
  private makePicture(img: ImageState): Sprite {
    const sp = new Sprite(this.pictureTexture(img));
    sp.label = img.name;
    this.placePicture(sp, img);
    sp.alpha = img.alpha;
    this.pictureLayer(img).addChild(sp);
    this.pictures.set(img.name, sp);
    return sp;
  }
  private rebuildPictures(state: DisplayState) {
    for (const layer of [this.imagesBehind, this.imagesFront, this.imagesFixed]) for (const c of layer.removeChildren()) c.destroy();
    this.pictures.clear();
    for (const img of state.images ?? []) this.makePicture(img);
  }

  // ---- weather, filters and shader transitions (the pure parts are engine/src/fx.ts) ----
  private makeEffectTextures() {
    const g = new Graphics().circle(16, 16, 16).fill(0xffffff);
    this.dot = this.app.renderer.generateTexture({ target: g, resolution: 1 });
    g.destroy();
    const c = document.createElement('canvas');
    c.width = 256; c.height = 144;
    const x = c.getContext('2d')!;
    const grad = x.createRadialGradient(128, 72, 40, 128, 72, 150);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.85)');
    x.fillStyle = grad;
    x.fillRect(0, 0, 256, 144);
    this.vignette.texture = Texture.from(c);
    this.vignette.width = W; this.vignette.height = H;
    this.vignette.alpha = 0;
  }

  private setWeather(w: { kind: WeatherName; intensity: number } | null) {
    const next = this.reduceMotion ? null : w; // falling things are motion: reduced motion drops them
    if (this.weather?.kind !== next?.kind) this.clearParticles();
    this.weather = next;
    const n = next ? weatherCount(next.kind, next.intensity) : 0;
    while (this.particles.length > n) this.particles.pop()!.sprite.destroy();
    while (next && this.particles.length < n) {
      const sprite = new Sprite(this.dot);
      sprite.anchor.set(0.5);
      sprite.tint = WEATHER[next.kind].color;
      this.weatherLayer.addChild(sprite);
      this.particles.push({ p: spawnParticle(next.kind, this.weatherRand, W, H, true), sprite });
    }
    this.weatherLayer.alpha = 1;
    this.stepWeather(0);
  }
  private clearParticles() {
    for (const { sprite } of this.particles) sprite.destroy();
    this.particles = [];
  }
  private stepWeather(dt: number) {
    const w = this.weather;
    if (!w) return;
    this.clock += dt;
    for (const e of this.particles) {
      if (!stepParticle(e.p, w.kind, dt, this.clock, W, H)) e.p = spawnParticle(w.kind, this.weatherRand, W, H, false);
      const { p, sprite } = e;
      sprite.position.set(p.x, p.y);
      sprite.alpha = p.alpha;
      if (w.kind === 'rain') {
        sprite.scale.set(p.size / 32, Math.hypot(p.vx, p.vy) * 0.03 / 32);
        sprite.rotation = Math.atan2(p.vy, p.vx) - Math.PI / 2;
      } else if (w.kind === 'petals') {
        sprite.scale.set(p.size / 32, p.size * 0.55 / 32 * (0.6 + 0.4 * Math.abs(Math.sin(p.rot * 2))));
        sprite.rotation = p.rot;
      } else sprite.scale.set(p.size / 32);
    }
  }

  /** Put a filter on the scene at a strength 0-1. */
  private setLook(f: { name: FilterName; strength: number } | null) {
    this.filterNow = f && f.strength > 0 ? f : null;
    const filters: Filter[] = [];
    const m = f ? filterMatrix(f.name, f.strength) : null;
    if (f && f.name === 'blur' && f.strength > 0) { this.blur.strength = blurRadius(f.strength); filters.push(this.blur); }
    else if (f && m && f.strength > 0) { this.matrix.matrix = m as ColorMatrixFilter['matrix']; filters.push(this.matrix); }
    if (this.pixelate) filters.push(this.pixelate);
    this.scene.filters = filters.length ? filters : null;
    this.vignette.alpha = f?.name === 'vignette' ? f.strength : 0;
  }

  /** The mosaic filter of the `pixelate` transition. */
  private pixelFilter(): Filter {
    const vertex = `
      in vec2 aPosition; out vec2 vTextureCoord;
      uniform highp vec4 uInputSize; uniform highp vec4 uOutputFrame; uniform highp vec4 uOutputTexture;
      void main(void) {
        vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
        position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
        position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
        gl_Position = vec4(position, 0.0, 1.0);
        vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
      }`;
    const fragment = `
      in vec2 vTextureCoord; out vec4 finalColor;
      uniform sampler2D uTexture; uniform highp vec4 uInputSize; uniform float uBlock;
      void main(void) {
        vec2 px = vTextureCoord * uInputSize.xy;
        vec2 c = (floor(px / uBlock) + 0.5) * uBlock;
        finalColor = texture(uTexture, c * uInputSize.zw);
      }`;
    return new Filter({
      glProgram: GlProgram.from({ vertex, fragment }),
      resources: { pixelUniforms: { uBlock: { value: 1, type: 'f32' } } },
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
    this.pixelate = null;
    this.setWeather(state.weather ?? null);
    this.setLook(state.filter ?? null);
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
      if (op.op === 'weather') { this.setWeather(null); return; }
      if (op.op === 'filter') { this.setLook(state.filter ?? null); return; }
      if (op.op === 'scene' && ['wipe', 'iris', 'blinds', 'pixelate'].includes(op.transition)) op = { ...op, transition: 'dissolve' };
    }
    switch (op.op) {
      case 'scene': {
        if (op.transition === 'cut' || op.dur <= 0) { this.setBg(op.bg); this.rebuildSprites(state); return; }
        if (op.transition === 'fade') {
          await this.tween(op.dur / 2, k => { this.fade.alpha = k; });
          if (!alive()) return;
          this.setBg(op.bg); this.rebuildSprites(state);
          await this.tween(op.dur / 2, k => { this.fade.alpha = 1 - k; });
          return;
        }
        if (op.transition === 'pixelate') {
          const fx = this.pixelate = this.pixelFilter();
          this.setLook(this.filterNow);
          let swapped = false;
          await this.tween(op.dur, k => {
            fx.resources.pixelUniforms.uniforms.uBlock = pixelBlock(k);
            if (k >= 0.5 && !swapped) { swapped = true; this.setBg(op.bg); this.rebuildSprites(state); }
          });
          this.pixelate = null;
          if (!alive()) return;
          this.setLook(this.filterNow);
          return;
        }
        this.rebuildSprites(state);
        const next = this.makeBg(op.bg);
        this.bgLayer.addChild(next);
        if (op.transition === 'wipe' || op.transition === 'iris' || op.transition === 'blinds') {
          const mask = new Graphics();
          this.bgLayer.addChild(mask);
          next.mask = mask;
          const dir = op.dir ?? 'left';
          await this.tween(op.dur, t => {
            const k = EASES.inout(t);
            mask.clear();
            if (op.transition === 'iris') mask.circle(W / 2, H / 2, irisRadius(k, W, H));
            else if (op.transition === 'blinds') for (const r of blindsRects(k, 12, W, H)) mask.rect(r.x, r.y, r.w, r.h);
            else if (dir === 'right') mask.rect(W * (1 - k), 0, W * k, H);
            else if (dir === 'up') mask.rect(0, 0, W, H * k);
            else if (dir === 'down') mask.rect(0, H * (1 - k), W, H * k);
            else mask.rect(0, 0, W * k, H);
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
      case 'show': {
        const s = state.sprites.find(x => x.char === op.char);
        if (!s) return;
        const existing = this.actors.get(op.char);
        if (existing) {
          this.restack(state);
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
      case 'hide': {
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
      case 'move': {
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
      case 'image': {
        if (op.action === 'hide') {
          const sp = this.pictures.get(op.name);
          if (!sp) return;
          this.pictures.delete(op.name);
          const from = sp.alpha;
          if (op.fade > 0) { await this.tween(op.fade, k => { sp.alpha = from * (1 - k); }); if (!alive()) return; }
          sp.destroy();
          return;
        }
        const img = (state.images ?? []).find(i => i.name === op.name);
        if (!img) return;
        let sp = this.pictures.get(op.name);
        if (op.action === 'show') {
          const fresh = !sp;
          if (sp) { // an existing picture takes the new file and fields at once
            sp.texture = this.pictureTexture(img);
            this.pictureLayer(img).addChild(sp);
            this.placePicture(sp, img);
            sp.alpha = img.alpha;
          } else sp = this.makePicture(img);
          if (fresh && op.fade > 0) { sp.alpha = 0; await this.tween(op.fade, k => { sp!.alpha = k * img.alpha; }); }
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
      case 'shake': {
        if (op.target !== 'screen') { // a character's shake is the `shake` animation, 8 pixels being strength 1
          const a = this.actors.get(op.target);
          if (a && op.dur > 0) await this.playFx(a, op.target, 'shake', op.dur, op.strength / 8);
          return;
        }
        const s = op.strength * FX() / 1080; // pixels on a 1080 side
        const pts = [0, -s, s, -s * 0.6, s * 0.6, -s * 0.3, 0];
        await this.tween(op.dur, k => {
          const f = k * (pts.length - 1), i = Math.min(Math.floor(f), pts.length - 2);
          this.shaker.x = pts[i] + (pts[i + 1] - pts[i]) * (f - i);
        });
        return;
      }
      case 'flash': {
        this.flashLayer.tint = op.color;
        await this.tween(op.dur, k => { this.flashLayer.alpha = (1 - k) ** 2; });
        return;
      }
      case 'tint': {
        const from = this.tintLayer.alpha, to = op.color ? op.strength : 0;
        if (op.color) this.tintLayer.tint = op.color;
        await this.tween(op.dur, k => { this.tintLayer.alpha = from + (to - from) * k; });
        return;
      }
      case 'camera': {
        const w = this.world, ease = easing(op.ease);
        const z0 = w.scale.x, to = op, fix = state.camera ?? { zoom: op.zoom ?? 1, x: op.x, y: op.y };
        // Interpolate the zoom and the pivot together, so a zoom that also pans moves smoothly.
        const p0 = { x: z0 === 1 ? to.x : w.x / (W * (1 - z0)), y: z0 === 1 ? to.y : w.y / (H * (1 - z0)) };
        await this.tween(op.dur, t => {
          const k = ease(t);
          this.setCamera({ zoom: z0 + (fix.zoom - z0) * k, x: p0.x + (fix.x - p0.x) * k, y: p0.y + (fix.y - p0.y) * k });
        });
        return;
      }
      case 'weather': {
        if (op.kind) {
          const fadeIn = !this.weather;
          this.setWeather(state.weather ?? null);
          if (fadeIn) await this.tween(op.dur, k => { this.weatherLayer.alpha = k; });
        } else {
          const from = this.weatherLayer.alpha;
          await this.tween(op.dur, k => { this.weatherLayer.alpha = from * (1 - k); });
          if (alive()) this.setWeather(null);
        }
        return;
      }
      case 'filter': {
        const from = this.filterNow, to = op.name ? { name: op.name, strength: op.strength } : null;
        const name = (to ?? from)?.name;
        if (!name) return;
        const s0 = from && from.name === name ? from.strength : 0, s1 = to ? to.strength : 0;
        await this.tween(op.dur, k => { this.setLook({ name, strength: s0 + (s1 - s0) * k }); });
        if (alive()) this.setLook(state.filter ?? null);
        return;
      }
      case 'hop': {
        const a = this.actors.get(op.char);
        if (!a) return;
        if (op.dur > 0) await this.playFx(a, op.char, 'hop', op.dur, 1);
        return;
      }
      case 'animate': {
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
  }
}
