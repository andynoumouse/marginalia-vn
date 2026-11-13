// Pure parts of the screen effects: `filter` colour matrices, `weather` particles and the shapes of the
// `iris` and `blinds` transitions. The Pixi renderer only draws what these return.

import { parseHex } from './colors.js';
import { windWave, type WorldWind } from './physics.js';

/** What the scene does to loose particles (weather, bursts): `gravity` scales their fall (1 as authored, 0 none, negative up), `windVx` is the air's sideways speed in px/s (positive right). */
export interface FxEnv { gravity?: number; windVx?: number }

/** Air speed (px/s) of a wind of strength 1. */
export const WIND_PX = 420;

/** The air's sideways speed now, for the script's `wind`: steady, or swelling and dying down with its gusts. */
export function windVelocity(wind: WorldWind | null | undefined, t: number): number {
  if (!wind || !wind.strength) return 0;
  const g = Math.min(1, Math.max(0, wind.gusts));
  return wind.strength * WIND_PX * (1 - g + g * (0.5 + 0.5 * windWave(t, 0.35, 0)));
}

/** In the order they are applied (`filterLooks` sorts by it): the blur, the color matrices, then the shaders; the vignette is a sprite drawn over them all. */
export const FILTER_NAMES = ['blur', 'grayscale', 'sepia', 'night', 'invert', 'vignette', 'glow', 'sunbeams', 'chromatic', 'wave', 'pixelate', 'crt', 'grain', 'glitch', 'speedlines'] as const;

/** The filters drawn by a shader of their own (preview/scene-effects.ts), not a color matrix or a blur. */
export const SHADER_FILTERS: readonly FilterName[] = ['glow', 'sunbeams', 'chromatic', 'wave', 'pixelate', 'crt', 'grain', 'glitch', 'speedlines'];
/** The filters that move by themselves: reduced motion holds `sunbeams`, `wave`, `grain` and `speedlines` still and drops `glitch`, whose look is the jumping. */
export const MOVING_FILTERS: readonly FilterName[] = ['sunbeams', 'wave', 'grain', 'glitch', 'speedlines'];
export type FilterName = typeof FILTER_NAMES[number];
export const isFilterName = (s: string): s is FilterName => (FILTER_NAMES as readonly string[]).includes(s);

/** A 4x5 colour matrix (row-major, as Pixi's ColorMatrixFilter takes it). */
export type ColorMatrix = number[];
export const IDENTITY: ColorMatrix = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];

const FULL: Partial<Record<FilterName, ColorMatrix>> = {
  grayscale: [0.299, 0.587, 0.114, 0, 0, 0.299, 0.587, 0.114, 0, 0, 0.299, 0.587, 0.114, 0, 0, 0, 0, 0, 1, 0],
  sepia: [0.393, 0.769, 0.189, 0, 0, 0.349, 0.686, 0.168, 0, 0, 0.272, 0.534, 0.131, 0, 0, 0, 0, 0, 1, 0],
  // Dark and blue: red and green dimmed, blue kept, a little blue added.
  night: [0.45, 0, 0, 0, 0, 0, 0.55, 0, 0, 0.01, 0, 0.05, 0.9, 0, 0.05, 0, 0, 0, 1, 0],
  // A photographic negative; half strength is a flat gray.
  invert: [-1, 0, 0, 0, 1, 0, -1, 0, 0, 1, 0, 0, -1, 0, 1, 0, 0, 0, 1, 0],
};

/** The matrix of a colour filter at a strength 0-1 (identity at 0), or null for a filter that is not a colour matrix. */
export function filterMatrix(name: FilterName, strength: number): ColorMatrix | null {
  const full = FULL[name];
  if (!full) return null;
  const k = Math.max(0, Math.min(1, strength));
  return IDENTITY.map((v, i) => v + (full[i] - v) * k);
}

/** One filter of the scene's look at a strength 0-1. */
export interface FilterLook { name: FilterName; strength: number }

/** The filters on the scene in the order they are drawn, from a state's `filter`: a list, or one look as saves from before filters stacked hold it. */
export function filterLooks(f: readonly FilterLook[] | FilterLook | null | undefined): FilterLook[] {
  const list = !f ? [] : Array.isArray(f) ? f : [f as FilterLook];
  return list.filter(l => isFilterName(l?.name) && l.strength > 0).sort((a, b) => FILTER_NAMES.indexOf(a.name) - FILTER_NAMES.indexOf(b.name));
}

/** The look after a `filter` line: with `merge` (`filter +` / `filter -`) only the named filters change and a strength of 0 takes one off; otherwise the line is the whole look. */
export function nextLooks(now: readonly FilterLook[], looks: readonly FilterLook[], merge: boolean): FilterLook[] {
  if (!merge) return filterLooks(looks);
  return filterLooks([...now.filter(l => !looks.some(n => n.name === l.name)), ...looks]);
}

/** The look part way (k 0-1) from one look to another: each filter goes from its old strength to its new one, 0 where a side lacks it. */
export function blendLooks(from: readonly FilterLook[], to: readonly FilterLook[], k: number): FilterLook[] {
  const names = [...new Set([...from, ...to].map(l => l.name))];
  const at = (side: readonly FilterLook[], name: FilterName) => side.find(l => l.name === name)?.strength ?? 0;
  return filterLooks(names.map(name => ({ name, strength: at(from, name) + (at(to, name) - at(from, name)) * k })));
}

/** `b` applied after `a`, as one matrix (the fifth column is an offset). */
function chainMatrix(a: ColorMatrix, b: ColorMatrix): ColorMatrix {
  const out: number[] = [];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 5; c++) {
      let v = c === 4 ? b[r * 5 + 4] : 0;
      for (let k = 0; k < 4; k++) v += b[r * 5 + k] * a[k * 5 + c];
      out.push(v);
    }
  }
  return out;
}

/** One colour matrix for all the colour filters of a look, in their drawing order, or null when it has none. */
export function lookMatrix(looks: readonly FilterLook[]): ColorMatrix | null {
  let m: ColorMatrix | null = null;
  for (const l of looks) {
    const f = filterMatrix(l.name, l.strength);
    if (f) m = m ? chainMatrix(m, f) : f;
  }
  return m;
}

/** `letterbox` with no height: each bar this share of the stage height, about a 2.39:1 film frame on a 16:9 stage. */
export const LETTERBOX_SIZE = 0.12;
/** The tallest a letterbox bar may be, as a share of the stage height. */
export const LETTERBOX_MAX = 0.4;

/** Blur radius in stage pixels for a strength 0-1. */
export const blurRadius = (strength: number) => 24 * Math.max(0, Math.min(1, strength));

// ---- weather ----

export const WEATHER_NAMES = ['rain', 'snow', 'petals', 'embers', 'leaves', 'fog', 'fireflies'] as const;
export type WeatherName = typeof WEATHER_NAMES[number];
export const isWeatherName = (s: string): s is WeatherName => (WEATHER_NAMES as readonly string[]).includes(s);

export interface WeatherSpec {
  /** Particles at intensity 1. */
  count: number;
  color: number;
  /** Fall speed in px/s (negative = rises), sideways drift in px/s, and size range in px. */
  vy: [number, number];
  vx: [number, number];
  size: [number, number];
  /** Rain is drawn as a streak along its velocity; the others as a soft dot or petal turning slowly. */
  streak: boolean;
  /** Sideways sway amplitude in px/s (snow, petals, embers wander). */
  sway: number;
  alpha: [number, number];
  /** How much of the scene's wind it feels (heavy rain less, petals more). */
  windy: number;
  /** Where new ones come in: over the top edge (under the bottom for things that rise; the default), from the side they drift from (fog), or anywhere on the screen (fireflies). */
  enter?: 'edge' | 'side' | 'anywhere';
  /** Drawn as a soft blob that fades out to its edge, not a solid dot. */
  soft?: boolean;
  /** Glows brighter and dimmer by itself (fireflies). */
  pulse?: boolean;
}

export const WEATHER: Record<WeatherName, WeatherSpec> = {
  rain: { count: 420, color: 0xbfd4ff, vy: [1500, 2000], vx: [-260, -200], size: [2, 3], streak: true, sway: 0, alpha: [0.25, 0.5], windy: 0.6 },
  snow: { count: 260, color: 0xffffff, vy: [70, 160], vx: [-20, 20], size: [3, 8], streak: false, sway: 40, alpha: [0.6, 0.95], windy: 1 },
  petals: { count: 70, color: 0xffb7d0, vy: [70, 130], vx: [60, 150], size: [8, 15], streak: false, sway: 90, alpha: [0.75, 1], windy: 1.3 },
  embers: { count: 90, color: 0xffa040, vy: [-150, -60], vx: [-30, 30], size: [2, 5], streak: false, sway: 50, alpha: [0.5, 1], windy: 0.8 },
  leaves: { count: 45, color: 0xc8702a, vy: [90, 170], vx: [30, 110], size: [12, 20], streak: false, sway: 120, alpha: [0.85, 1], windy: 1.4 },
  fog: { count: 34, color: 0xdde4ea, vy: [-4, 4], vx: [12, 36], size: [320, 600], streak: false, sway: 6, alpha: [0.22, 0.4], windy: 0.5, enter: 'side', soft: true },
  fireflies: { count: 40, color: 0xd8ff70, vy: [-18, 18], vx: [-18, 18], size: [16, 28], streak: false, sway: 25, alpha: [0.6, 1], windy: 0.3, enter: 'anywhere', soft: true, pulse: true },
};

export interface Particle {
  x: number; y: number; vx: number; vy: number; size: number; alpha: number; rot: number; spin: number; phase: number;
}

const between = ([a, b]: [number, number], r: number) => a + (b - a) * r;

/** A particle entering the screen (from the top, or the bottom for embers); `anywhere` places it at a random height instead. */
export function spawnParticle(kind: WeatherName, rand: () => number, w: number, h: number, anywhere: boolean, env: FxEnv = {}): Particle {
  const s = WEATHER[kind];
  const g = env.gravity ?? 1;
  const rising = s.vy[1] * g < 0;
  const pad = 60;
  // Rain and petals drift sideways, so they start left of the screen as often as above it; so does whatever the wind carries.
  const wind = (env.windVx ?? 0) * s.windy;
  const lead = wind ? Math.max(-w, Math.min(w, wind * ((h + pad) / Math.max(60, Math.abs((s.vy[0] + s.vy[1]) / 2 * g))))) : 0; // how far it drifts while it crosses the screen
  const x = rand() * (w + 2 * pad) - pad - (s.vx[1] > 40 ? w * 0.2 * rand() : 0) - (anywhere ? 0 : lead * rand());
  const y = anywhere ? rand() * h : rising ? h + pad * rand() : -pad * rand();
  const p = { x, y, vx: between(s.vx, rand()), vy: between(s.vy, rand()), size: between(s.size, rand()), alpha: between(s.alpha, rand()),
    rot: rand() * Math.PI * 2, spin: (rand() - 0.5) * 3, phase: rand() * Math.PI * 2 };
  if (s.enter === 'anywhere') { p.x = rand() * w; p.y = rand() * h; }
  else if (s.enter === 'side') {
    // In at a random height from the side the air carries it from, just out of sight (anywhere across the screen at the start).
    p.x = anywhere ? rand() * w : p.vx + wind >= 0 ? -p.size / 2 : w + p.size / 2;
    p.y = rand() * h;
  }
  return p;
}

/** Move a particle on by `dt` seconds at time `t`; false once it has left the screen (to be respawned). */
export function stepParticle(p: Particle, kind: WeatherName, dt: number, t: number, w: number, h: number, env: FxEnv = {}): boolean {
  const s = WEATHER[kind];
  const vx = p.vx + (s.sway ? Math.sin(t * 1.5 + p.phase) * s.sway : 0) + (env.windVx ?? 0) * s.windy, vy = p.vy * (env.gravity ?? 1);
  p.x += vx * dt;
  p.y += vy * dt;
  p.rot += p.spin * dt;
  // Gone once outside and not coming back: a particle that starts outside, upwind or against gravity, is on its way in.
  // A big one (fog) has to be its own half-size further out before none of it shows.
  const my = Math.max(80, p.size / 2 + 20), mx = Math.max(120, p.size / 2 + 20);
  return !(p.y > h + my && vy >= 0) && !(p.y < -my && vy <= 0) && !(p.x < -mx && vx <= 0) && !(p.x > w + mx && vx >= 0);
}

/** How bright a particle is drawn at time `t`: its own alpha, pulsing slowly for a kind that glows (fireflies). */
export function particleAlpha(kind: WeatherName, p: Particle, t: number): number {
  return WEATHER[kind].pulse ? p.alpha * (0.15 + 0.85 * (0.5 + 0.5 * Math.sin(t * 2.2 + p.phase))) : p.alpha;
}

/** How many of the spec's particles are alive at an intensity 0-1. */
export const weatherCount = (kind: WeatherName, intensity: number) => Math.round(WEATHER[kind].count * Math.max(0, Math.min(1, intensity)));

/** A small seeded random generator for the renderer's particles; weather is decoration, so it stays out of the story's RNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- transitions ----

export interface Rect { x: number; y: number; w: number; h: number }

/** The radius of an iris that is `k` (0-1) of the way open on a w x h screen: 0 shows nothing, 1 covers the corners. */
export const irisRadius = (k: number, w: number, h: number) => Math.hypot(w / 2, h / 2) * Math.max(0, Math.min(1, k));

/** Vertical blinds: `count` slats, each opening from its left edge as `k` (0-1) goes up. */
export function blindsRects(k: number, count: number, w: number, h: number): Rect[] {
  const slat = w / count, open = slat * Math.max(0, Math.min(1, k));
  return Array.from({ length: count }, (_, i) => ({ x: i * slat, y: 0, w: open, h }));
}

/** What a wipe, iris or blinds transition has revealed at progress `k` (0-1): the shapes of the new picture's mask. A wipe goes from `dir`'s side. */
export type RevealShape = { circle: { x: number; y: number; r: number } } | { rect: Rect };
export function revealShapes(transition: 'wipe' | 'iris' | 'blinds', dir: string, k: number, w: number, h: number): RevealShape[] {
  if (transition === 'iris') return [{ circle: { x: w / 2, y: h / 2, r: irisRadius(k, w, h) } }];
  if (transition === 'blinds') return blindsRects(k, 12, w, h).map(rect => ({ rect }));
  if (dir === 'right') return [{ rect: { x: w * (1 - k), y: 0, w: w * k, h } }];
  if (dir === 'up') return [{ rect: { x: 0, y: 0, w, h: h * k } }];
  if (dir === 'down') return [{ rect: { x: 0, y: h * (1 - k), w, h: h * k } }];
  return [{ rect: { x: 0, y: 0, w: w * k, h } }];
}

/** The sides a wipe or a push can come from. */
export const DIRECTIONS = ['left', 'right', 'up', 'down'] as const;

/** A push at progress `k` (0-1): how far (px) the old and the new picture sit from their place. The new one comes in from `dir`'s side and shoves the old one out the other way. */
export function pushOffsets(dir: string, k: number, w: number, h: number): { old: [number, number]; next: [number, number] } {
  const t = Math.max(0, Math.min(1, k));
  if (dir === 'right') return { old: [-w * t, 0], next: [w * (1 - t), 0] };
  if (dir === 'up') return { old: [0, h * t], next: [0, -h * (1 - t)] };
  if (dir === 'down') return { old: [0, -h * t], next: [0, h * (1 - t)] };
  return { old: [w * t, 0], next: [-w * (1 - t), 0] };
}

/** A zoom at progress `k` (0-1): the old picture rushes toward the viewer and fades, uncovering the new one as it settles from a little too close. */
export function zoomLook(k: number): { oldScale: number; oldAlpha: number; nextScale: number } {
  const t = Math.max(0, Math.min(1, k));
  return { oldScale: 1 + 0.6 * t, oldAlpha: 1 - t, nextScale: 1 + 0.15 * (1 - t) };
}

/** How strongly a ripple bends the picture at progress `k` (0-1): none at either end, most halfway, when the pictures cross. */
export const rippleAmount = (k: number) => Math.sin(Math.PI * Math.max(0, Math.min(1, k)));

/** The screen shake's horizontal offset at progress `k` (0-1): `s` pixels, swinging out and back in with fading swings. */
export function shakeOffset(s: number, k: number): number {
  const pts = [0, -s, s, -s * 0.6, s * 0.6, -s * 0.3, 0];
  const f = k * (pts.length - 1), i = Math.min(Math.floor(f), pts.length - 2);
  return pts[i] + (pts[i + 1] - pts[i]) * (f - i);
}

/** The pivot (stage fractions) a camera sits at, recovered from the world container's scale `z` and offset: at zoom 1 the pivot is not recoverable, so `fallback`. */
export function cameraPivot(z: number, x: number, y: number, w: number, h: number, fallback: { x: number; y: number }): { x: number; y: number } {
  return z === 1 ? { ...fallback } : { x: x / (w * (1 - z)), y: y / (h * (1 - z)) };
}

/** Softness of an image-mask edge: the share of the progress range a pixel takes to go from hidden to shown. */
export const MASK_SOFT = 0.08;

/** Image-mask dissolve: how much (0-1) of the new picture shows where the mask has brightness `m` (0-1) at progress `k` (0-1); dark pixels go first. */
export function maskReveal(k: number, m: number, soft = MASK_SOFT): number {
  return Math.max(0, Math.min(1, (Math.max(0, Math.min(1, k)) * (1 + soft) - m) / soft));
}

/** Pixelate transition: block size in px at progress `k`, growing to a peak at the middle where the picture is swapped, then shrinking. */
export const pixelBlock = (k: number, max = 96) => Math.max(1, Math.round(1 + (max - 1) * (1 - Math.abs(2 * Math.max(0, Math.min(1, k)) - 1))));

/** `#rgb` / `#rrggbb` (alpha ignored) as a 0xrrggbb number, white if it is not a color. */
export function rgbNumber(color: string | undefined): number {
  const c = color ? parseHex(color) : undefined;
  if (!c) return 0xffffff;
  const b = (v: number) => Math.round(v * 255);
  return (b(c.r) << 16) | (b(c.g) << 8) | b(c.b);
}

/** Two 0xrrggbb colors multiplied channel by channel (white is the identity). */
export function mulRgb(a: number, b: number): number {
  const ch = (shift: number) => Math.round((((a >> shift) & 255) * ((b >> shift) & 255)) / 255);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** 0xrrggbb colors blended channel by channel; `k` 0 is `a`, 1 is `b`. */
export function lerpRgb(a: number, b: number, k: number): number {
  const ch = (shift: number) => Math.round(((a >> shift) & 255) + ((((b >> shift) & 255) - ((a >> shift) & 255)) * k));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** The 4x5 color matrix that mixes the picture `amount` (0-1) of the way to a flat `color` (0xrrggbb), alpha kept: a hit flash. */
export function flashMatrix(color: number, amount: number): number[] {
  const k = Math.max(0, Math.min(1, amount)), r = ((color >> 16) & 255) / 255, g = ((color >> 8) & 255) / 255, b = (color & 255) / 255;
  return [1 - k, 0, 0, 0, k * r, 0, 1 - k, 0, 0, k * g, 0, 0, 1 - k, 0, k * b, 0, 0, 0, 1, 0];
}

/** Loudness (RMS, 0-1) above which a voice recording counts as the mouth being open, and how long (seconds) it stays open after a quiet moment, so the gaps between letters do not flutter it. */
export const MOUTH_ON = 0.02;
export const MOUTH_HOLD = 0.12;

/** Lip sync from a voice recording's `level`: the mouth is open while the voice is loud, and `hold` seconds after. `until` is the time (seconds) it stays open to, as returned last time. */
export function mouthOpen(level: number, now: number, until: number): { open: boolean; until: number } {
  const next = level >= MOUTH_ON ? now + MOUTH_HOLD : until;
  return { open: now < next, until: next };
}

// ---- bursts (`burst <kind> at <where>`): a puff of particles at a place, not kept in saves ----

export const BURST_NAMES = ['sparkle', 'smoke', 'confetti', 'dust'] as const;
export type BurstName = typeof BURST_NAMES[number];
export const isBurstName = (s: string): s is BurstName => (BURST_NAMES as readonly string[]).includes(s);

export interface BurstSpec {
  /** Particles and seconds they live, unless the script says otherwise. */
  count: number; life: number;
  /** Launch speed in px/s and direction in radians (0 right, -PI/2 up), both drawn from the range. */
  speed: [number, number]; angle: [number, number];
  /** Pull in px/s per second (positive down, negative up) and the share of speed lost per second. */
  gravity: number; drag: number;
  size: [number, number]; grow: number; colors: number[]; alpha: number;
  /** A soft round blob, or a small flat rectangle (confetti) that turns. */
  rect: boolean; spin: number;
  /** How much of the scene's wind it feels. */
  windy: number;
}

export const BURSTS: Record<BurstName, BurstSpec> = {
  sparkle: { count: 48, life: 1, speed: [120, 420], angle: [-Math.PI, Math.PI], gravity: 0, drag: 2.5, size: [8, 22], grow: 0, colors: [0xffffff, 0xffe9a0, 0xfff2c0], alpha: 1, rect: false, spin: 0, windy: 0.2 },
  smoke: { count: 14, life: 2.2, speed: [20, 70], angle: [-Math.PI * 0.75, -Math.PI * 0.25], gravity: -25, drag: 0.6, size: [40, 80], grow: 1.8, colors: [0x8a8a8a, 0xa4a4a4], alpha: 0.35, rect: false, spin: 0, windy: 1 },
  confetti: { count: 60, life: 2.2, speed: [300, 800], angle: [-Math.PI * 0.8, -Math.PI * 0.2], gravity: 900, drag: 0.8, size: [8, 14], grow: 0, colors: [0xff5a6e, 0xffd24a, 0x5ac8fa, 0x7be07b, 0xc07bff], alpha: 1, rect: true, spin: 8, windy: 0.5 },
  dust: { count: 18, life: 1.2, speed: [40, 160], angle: [-Math.PI * 0.6, -Math.PI * 0.4], gravity: 0, drag: 2, size: [20, 40], grow: 1.5, colors: [0xc9b79c], alpha: 0.4, rect: false, spin: 0, windy: 1 },
};

export interface BurstParticle {
  x: number; y: number; vx: number; vy: number; size: number; rot: number; spin: number; age: number; life: number; color: number;
}

/** `count` particles leaving (x, y) (stage pixels). `life` and `count` default to the kind's own. Dust leaves sideways along the ground, so its angle is mirrored at random. */
export function spawnBurst(kind: BurstName, rand: () => number, x: number, y: number, count?: number | null, life?: number | null): BurstParticle[] {
  const s = BURSTS[kind];
  return Array.from({ length: count ?? s.count }, () => {
    const speed = between(s.speed, rand());
    let a = between(s.angle, rand());
    if (kind === 'dust') a = rand() < 0.5 ? -0.12 * Math.PI * rand() : Math.PI + 0.12 * Math.PI * rand(); // flat, out to either side
    return {
      x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, size: between(s.size, rand()), rot: rand() * Math.PI * 2, spin: (rand() - 0.5) * s.spin,
      age: 0, life: (life ?? s.life) * (0.7 + 0.3 * rand()), color: s.colors[Math.floor(rand() * s.colors.length) % s.colors.length],
    };
  });
}

/** Move a burst particle on by `dt` seconds; false once its life is over. */
export function stepBurst(p: BurstParticle, kind: BurstName, dt: number, env: FxEnv = {}): boolean {
  const s = BURSTS[kind], keep = Math.max(0, 1 - s.drag * dt), air = (env.windVx ?? 0) * s.windy;
  p.vx = air + (p.vx - air) * keep; // drag pulls toward the air's own speed
  p.vy = p.vy * keep + s.gravity * (env.gravity ?? 1) * dt;
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.rot += p.spin * dt;
  p.age += dt;
  return p.age < p.life;
}

/** How a burst particle looks now: opacity (fading out over its life) and size in px (growing by the kind's `grow` over its life). */
export function burstLook(p: BurstParticle, kind: BurstName): { alpha: number; size: number } {
  const s = BURSTS[kind], k = Math.max(0, Math.min(1, p.age / p.life));
  const fade = kind === 'confetti' ? Math.min(1, (1 - k) / 0.3) : (1 - k) ** 1.5; // confetti stays solid, then goes
  return { alpha: s.alpha * fade, size: p.size * (1 + s.grow * k) };
}
