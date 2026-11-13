// Weather, screen filters and the pixelate and image-mask transitions of the WebGL renderer (the pure parts are engine/src/fx.ts):
// the falling particles, the vignette, and the filters on the scene container.

import { BlurFilter, ColorMatrixFilter, Container, Filter, GlProgram, Graphics, Sprite, Texture } from 'pixi.js';
import { blurRadius, filterLooks, lookMatrix, MASK_SOFT, MOVING_FILTERS, SHADER_FILTERS, mulberry32, particleAlpha, spawnParticle, stepParticle, weatherCount, WEATHER, type FilterLook, type FilterName, type FxEnv, type Particle, type WeatherName } from '../engine/src/index.js';
import { H, W } from './stage-ui.js';

export class SceneEffects {
  readonly weatherLayer = new Container();
  readonly vignette = new Sprite();
  weather: { kind: WeatherName; intensity: number } | null = null;
  looksNow: FilterLook[] = []; // the filters on screen now, in drawing order
  pixelate: Filter | null = null; // the mosaic of a running `pixelate` transition, on top of `looksNow`
  private particles: { p: Particle; sprite: Sprite }[] = [];
  private weatherRand = mulberry32(20240229); // decoration only: never the story's RNG
  private clock = 0;
  private dot = Texture.EMPTY;
  private soft = Texture.EMPTY; // a blob fading out to its edge: fog, fireflies
  private blur = new BlurFilter();
  private matrix = new ColorMatrixFilter();
  private shaderLooks = new Map<FilterName, Filter>(); // the shader filters (glow, chromatic, glitch), made when first used
  private lookClock = 0;

  /** `scene` carries the filters; reduced motion drops the falling things. */
  constructor(private scene: Container, private reduceMotion: () => boolean) {}

  /** The particle dot and the vignette texture; `generate` renders a graphic to a texture. */
  init(generate: (g: Graphics) => Texture) {
    const g = new Graphics().circle(16, 16, 16).fill(0xffffff);
    this.dot = generate(g);
    g.destroy();
    const b = document.createElement('canvas');
    b.width = b.height = 64;
    const bx = b.getContext('2d')!, blob = bx.createRadialGradient(32, 32, 0, 32, 32, 32);
    blob.addColorStop(0, 'rgba(255,255,255,1)');
    blob.addColorStop(0.4, 'rgba(255,255,255,0.55)');
    blob.addColorStop(1, 'rgba(255,255,255,0)');
    bx.fillStyle = blob;
    bx.fillRect(0, 0, 64, 64);
    this.soft = Texture.from(b);
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
      const sprite = new Sprite(WEATHER[next.kind].soft ? this.soft : this.dot);
      sprite.anchor.set(0.5);
      if (WEATHER[next.kind].pulse) sprite.blendMode = 'add'; // a firefly lights what is behind it
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
  stepWeather(dt: number, env: FxEnv = {}) {
    const w = this.weather;
    if (!w) return;
    this.clock += dt;
    for (const e of this.particles) {
      if (!stepParticle(e.p, w.kind, dt, this.clock, W, H, env)) e.p = spawnParticle(w.kind, this.weatherRand, W, H, false, env);
      const { p, sprite } = e;
      sprite.position.set(p.x, p.y);
      sprite.alpha = particleAlpha(w.kind, p, this.clock);
      if (w.kind === 'rain') {
        const vx = p.vx + (env.windVx ?? 0) * WEATHER.rain.windy, vy = p.vy * (env.gravity ?? 1); // the streak lies along where it is going now
        sprite.scale.set(p.size / 32, Math.hypot(vx, vy) * 0.03 / 32);
        sprite.rotation = Math.atan2(vy, vx) - Math.PI / 2;
      } else if (w.kind === 'petals' || w.kind === 'leaves') {
        sprite.scale.set(p.size / 32, p.size * 0.55 / 32 * (0.6 + 0.4 * Math.abs(Math.sin(p.rot * 2))));
        sprite.rotation = p.rot;
      } else sprite.scale.set(p.size / sprite.texture.width);
    }
  }

  /** Put the filters of a look on the scene, each at a strength 0-1: the blur first, then one color matrix for all the color filters, then the shaders. */
  setLook(looks: readonly FilterLook[] | FilterLook | null) {
    const list = this.looksNow = filterLooks(looks);
    const filters: Filter[] = [];
    const strength = (name: FilterName) => list.find(l => l.name === name)?.strength ?? 0;
    if (strength('blur') > 0) { this.blur.strength = blurRadius(strength('blur')); filters.push(this.blur); }
    const m = lookMatrix(list);
    if (m) { this.matrix.matrix = m as ColorMatrixFilter['matrix']; filters.push(this.matrix); }
    for (const l of list) {
      if (!SHADER_FILTERS.includes(l.name) || (l.name === 'glitch' && this.reduceMotion())) continue;
      const sh = this.shaderLook(l.name);
      sh.resources.lookUniforms.uniforms.uStrength = Math.max(0, Math.min(1, l.strength));
      filters.push(sh);
    }
    if (this.pixelate) filters.push(this.pixelate);
    this.scene.filters = filters.length ? filters : null;
    this.vignette.alpha = strength('vignette');
  }

  /** Advance the clock of the filters that move (wave, grain, glitch); called every frame. Reduced motion holds them still. */
  stepLook(dt: number) {
    if (this.reduceMotion()) return;
    this.lookClock += dt;
    for (const l of this.looksNow) if (MOVING_FILTERS.includes(l.name)) this.shaderLooks.get(l.name)!.resources.lookUniforms.uniforms.uTime = this.lookClock;
  }

  /** The shader filter for `glow` (a soft bloom of the bright parts), `sunbeams` (light shafts from the upper left), `chromatic` (red and blue pulled apart toward the edges), `wave` (a heat-haze or underwater bend),
   *  `pixelate` (a mosaic), `crt` (scanlines and dark corners), `grain` (film noise and flicker), `glitch` (bands of the picture torn sideways) or `speedlines` (manga focus lines). */
  private shaderLook(name: FilterName): Filter {
    let f = this.shaderLooks.get(name);
    if (f) return f;
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
    // `st` is the place on the stage, 0-1 either way, so a pattern is the same size at any resolution.
    const head = 'in vec2 vTextureCoord; out vec4 finalColor; uniform sampler2D uTexture; uniform highp vec4 uInputSize; uniform highp vec4 uOutputFrame; uniform float uStrength; uniform float uTime;';
    const body: Record<string, string> = {
      chromatic: `
        vec2 c = vTextureCoord - 0.5;
        vec2 off = c * length(c) * uStrength * 0.12;
        vec4 g = texture(uTexture, vTextureCoord);
        finalColor = vec4(texture(uTexture, vTextureCoord + off).r, g.g, texture(uTexture, vTextureCoord - off).b, g.a);`,
      glow: `
        vec4 base = texture(uTexture, vTextureCoord);
        vec3 acc = vec3(0.0);
        for (int ring = 0; ring < 2; ring++) {
          float radius = ring == 0 ? 0.006 : 0.016; // fractions of the picture width, so the glow looks the same at any resolution
          for (int i = 0; i < 8; i++) {
            float a = 6.2831853 * (float(i) + 0.5 * float(ring)) / 8.0;
            vec3 s = texture(uTexture, vTextureCoord + vec2(cos(a), sin(a) * uInputSize.x * uInputSize.w) * radius).rgb;
            acc += max(s - 0.55, 0.0) / 0.45;
          }
        }
        finalColor = vec4(base.rgb + acc / 16.0 * uStrength * 1.5, base.a);`,
      sunbeams: `
        // Soft warm beams fanning down from a light above the top left corner, swaying slowly and fading with distance.
        vec2 st = vTextureCoord * uInputSize.xy / uOutputFrame.zw;
        vec2 d = (st - vec2(-0.15, -0.35)) * vec2(uOutputFrame.z / uOutputFrame.w, 1.0);
        float a = atan(d.y, d.x);
        float beams = 0.5 + 0.5 * sin(a * 23.0 + uTime * 0.35) * sin(a * 37.0 - uTime * 0.23 + 1.3);
        beams = pow(beams, 3.0) * (0.6 + 0.4 * sin(a * 9.0 + uTime * 0.17));
        float fall = smoothstep(2.2, 0.3, length(d));
        vec4 c = texture(uTexture, vTextureCoord);
        c.rgb += vec3(1.0, 0.9, 0.7) * beams * fall * uStrength * 0.45 * c.a;
        finalColor = c;`,
      wave: `
        vec2 st = vTextureCoord * uInputSize.xy / uOutputFrame.zw;
        vec2 off = vec2(sin(st.y * 24.0 + uTime * 2.5), cos(st.x * 18.0 + uTime * 2.0) * 0.6) * uStrength * 0.006;
        vec2 edge = uOutputFrame.zw * uInputSize.zw;
        finalColor = texture(uTexture, clamp(vTextureCoord + off * edge, vec2(0.0), edge));`,
      pixelate: `
        float block = max(1.0, uStrength * 0.02 * uOutputFrame.z); // up to a fiftieth of the stage width
        vec2 px = vTextureCoord * uInputSize.xy;
        finalColor = texture(uTexture, (floor(px / block) + 0.5) * block * uInputSize.zw);`,
      crt: `
        vec2 st = vTextureCoord * uInputSize.xy / uOutputFrame.zw;
        vec4 c = texture(uTexture, vTextureCoord);
        float line = 0.5 + 0.5 * cos(st.y * 360.0 * 6.2831853); // 360 scanlines down the stage
        float corner = pow(length(st - 0.5) * 1.35, 3.0);
        c.rgb *= (1.0 - uStrength * 0.35 * line) * (1.0 - uStrength * 0.6 * corner) * (1.0 + uStrength * 0.15);
        finalColor = c;`,
      grain: `
        vec2 st = vTextureCoord * uInputSize.xy / uOutputFrame.zw;
        float frame = floor(uTime * 24.0);
        float n = fract(sin(dot(floor(st * vec2(960.0, 540.0)) + frame * 7.13, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
        vec4 c = texture(uTexture, vTextureCoord);
        c.rgb = (c.rgb + n * 0.22 * uStrength * c.a) * (1.0 + 0.04 * uStrength * sin(uTime * 37.0));
        finalColor = c;`,
      speedlines: `
        // Manga focus lines: thin streaks aimed at the middle, drawn anew about twelve times a second; more and longer as the strength goes up.
        vec2 st = vTextureCoord * uInputSize.xy / uOutputFrame.zw;
        vec2 d = (st - 0.5) * vec2(uOutputFrame.z / uOutputFrame.w, 1.0);
        float turn = (atan(d.y, d.x) + 3.14159265) / 6.2831853 * 180.0; // 180 slots around the middle
        float slot = floor(turn), frame = floor(uTime * 12.0);
        float r1 = fract(sin(slot * 12.9898 + frame * 78.233) * 43758.5453);
        float r2 = fract(sin(slot * 39.346 + frame * 11.135) * 24634.6345);
        float on = step(1.0 - 0.55 * uStrength, r1);
        float thin = 1.0 - smoothstep(0.0, 0.18 + 0.25 * r2, abs(fract(turn) - 0.5) * 2.0);
        float inner = mix(0.62, 0.3, uStrength) + 0.12 * r2;
        float reach = smoothstep(inner, inner + 0.25, length(d));
        vec4 c = texture(uTexture, vTextureCoord);
        c.rgb = mix(c.rgb, vec3(c.a), on * thin * reach * 0.9);
        finalColor = c;`,
      glitch: `
        float step_ = floor(uTime * 12.0);
        float band = floor(vTextureCoord.y * 22.0);
        float r1 = fract(sin(band * 91.345 + step_ * 12.9898) * 43758.5453);
        float r2 = fract(sin(band * 17.123 + step_ * 78.233) * 24634.6345);
        float torn = step(1.0 - 0.3 * uStrength, r1);
        float shift = (r2 - 0.5) * 0.16 * uStrength * torn;
        vec2 uv = vec2(fract(vTextureCoord.x + shift), vTextureCoord.y);
        float split = 0.012 * uStrength * torn;
        vec4 g = texture(uTexture, uv);
        finalColor = vec4(texture(uTexture, uv + vec2(split, 0.0)).r, g.g, texture(uTexture, uv - vec2(split, 0.0)).b, g.a);`,
    };
    f = new Filter({
      glProgram: GlProgram.from({ vertex, fragment: `${head}
void main(void) {${body[name]}
}` }),
      resources: { lookUniforms: { uStrength: { value: 1, type: 'f32' }, uTime: { value: 0, type: 'f32' } } },
    });
    this.shaderLooks.set(name, f);
    return f;
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

  /** The wavy bend of the `ripple` transition: `uAmp` 0-1 is how much, `uTime` moves the waves. */
  rippleFilter(): Filter {
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
      uniform sampler2D uTexture; uniform highp vec4 uInputSize; uniform highp vec4 uOutputFrame; uniform float uAmp; uniform float uTime;
      void main(void) {
        vec2 uv = vTextureCoord * uInputSize.xy / uOutputFrame.zw; // 0-1 over the stage, so the waves are the same size at any resolution
        vec2 off = vec2(sin(uv.y * 38.0 + uTime * 9.0), cos(uv.x * 26.0 + uTime * 7.0) * 0.6) * uAmp * 0.018;
        vec2 at = clamp(vTextureCoord + off * uOutputFrame.zw * uInputSize.zw, vec2(0.0), uOutputFrame.zw * uInputSize.zw);
        finalColor = texture(uTexture, at);
      }`;
    return new Filter({
      glProgram: GlProgram.from({ vertex, fragment }),
      resources: { rippleUniforms: { uAmp: { value: 0, type: 'f32' }, uTime: { value: 0, type: 'f32' } } },
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
