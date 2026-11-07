// Weather, screen filters and the pixelate and image-mask transitions of the WebGL renderer (the pure parts are engine/src/fx.ts):
// the falling particles, the vignette, and the filters on the scene container.

import { BlurFilter, ColorMatrixFilter, Container, Filter, GlProgram, Graphics, Sprite, Texture } from 'pixi.js';
import { blurRadius, filterMatrix, MASK_SOFT, mulberry32, spawnParticle, stepParticle, weatherCount, WEATHER, type FilterName, type Particle, type WeatherName } from '../engine/src/index.js';
import { H, W } from './stage-ui.js';

export class SceneEffects {
  readonly weatherLayer = new Container();
  readonly vignette = new Sprite();
  weather: { kind: WeatherName; intensity: number } | null = null;
  filterNow: { name: FilterName; strength: number } | null = null; // the filter on screen now
  pixelate: Filter | null = null; // the mosaic of a running `pixelate` transition, on top of `filterNow`
  private particles: { p: Particle; sprite: Sprite }[] = [];
  private weatherRand = mulberry32(20240229); // decoration only: never the story's RNG
  private clock = 0;
  private dot = Texture.EMPTY;
  private blur = new BlurFilter();
  private matrix = new ColorMatrixFilter();

  /** `scene` carries the filters; reduced motion drops the falling things. */
  constructor(private scene: Container, private reduceMotion: () => boolean) {}

  /** The particle dot and the vignette texture; `generate` renders a graphic to a texture. */
  init(generate: (g: Graphics) => Texture) {
    const g = new Graphics().circle(16, 16, 16).fill(0xffffff);
    this.dot = generate(g);
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

  setWeather(w: { kind: WeatherName; intensity: number } | null) {
    const next = this.reduceMotion() ? null : w; // falling things are motion: reduced motion drops them
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
  stepWeather(dt: number) {
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
  setLook(f: { name: FilterName; strength: number } | null) {
    this.filterNow = f && f.strength > 0 ? f : null;
    const filters: Filter[] = [];
    const m = f ? filterMatrix(f.name, f.strength) : null;
    if (f && f.name === 'blur' && f.strength > 0) { this.blur.strength = blurRadius(f.strength); filters.push(this.blur); }
    else if (f && m && f.strength > 0) { this.matrix.matrix = m as ColorMatrixFilter['matrix']; filters.push(this.matrix); }
    if (this.pixelate) filters.push(this.pixelate);
    this.scene.filters = filters.length ? filters : null;
    this.vignette.alpha = f?.name === 'vignette' ? f.strength : 0;
  }

  /** The filter of an image-mask dissolve: shows the filtered picture where the mask's brightness is below the progress `uK` (same maths as `maskReveal`). */
  maskFilter(mask: Texture): Filter {
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
      uniform sampler2D uTexture; uniform sampler2D uMask; uniform float uK; uniform float uSoft;
      void main(void) {
        float m = texture(uMask, vTextureCoord).r;
        float show = clamp((uK * (1.0 + uSoft) - m) / uSoft, 0.0, 1.0);
        finalColor = texture(uTexture, vTextureCoord) * show;
      }`;
    return new Filter({
      glProgram: GlProgram.from({ vertex, fragment }),
      resources: { uMask: mask.source, maskUniforms: { uK: { value: 0, type: 'f32' }, uSoft: { value: MASK_SOFT, type: 'f32' } } },
    });
  }

  /** The mosaic filter of the `pixelate` transition. */
  pixelFilter(): Filter {
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
}
