// Pure parts of the screen effects: `filter` colour matrices, `weather` particles and the shapes of the
// `iris` and `blinds` transitions. The Pixi renderer only draws what these return.

export const FILTER_NAMES = ['blur', 'grayscale', 'sepia', 'night', 'vignette'] as const;
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
};

/** The matrix of a colour filter at a strength 0-1 (identity at 0), or null for a filter that is not a colour matrix. */
export function filterMatrix(name: FilterName, strength: number): ColorMatrix | null {
  const full = FULL[name];
  if (!full) return null;
  const k = Math.max(0, Math.min(1, strength));
  return IDENTITY.map((v, i) => v + (full[i] - v) * k);
}

/** Blur radius in stage pixels for a strength 0-1. */
export const blurRadius = (strength: number) => 24 * Math.max(0, Math.min(1, strength));

// ---- weather ----

export const WEATHER_NAMES = ['rain', 'snow', 'petals', 'embers'] as const;
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
}

export const WEATHER: Record<WeatherName, WeatherSpec> = {
  rain: { count: 420, color: 0xbfd4ff, vy: [1500, 2000], vx: [-260, -200], size: [2, 3], streak: true, sway: 0, alpha: [0.25, 0.5] },
  snow: { count: 260, color: 0xffffff, vy: [70, 160], vx: [-20, 20], size: [3, 8], streak: false, sway: 40, alpha: [0.6, 0.95] },
  petals: { count: 70, color: 0xffb7d0, vy: [70, 130], vx: [60, 150], size: [8, 15], streak: false, sway: 90, alpha: [0.75, 1] },
  embers: { count: 90, color: 0xffa040, vy: [-150, -60], vx: [-30, 30], size: [2, 5], streak: false, sway: 50, alpha: [0.5, 1] },
};

export interface Particle {
  x: number; y: number; vx: number; vy: number; size: number; alpha: number; rot: number; spin: number; phase: number;
}

const between = ([a, b]: [number, number], r: number) => a + (b - a) * r;

/** A particle entering the screen (from the top, or the bottom for embers); `anywhere` places it at a random height instead. */
export function spawnParticle(kind: WeatherName, rand: () => number, w: number, h: number, anywhere: boolean): Particle {
  const s = WEATHER[kind];
  const rising = s.vy[1] < 0;
  const pad = 60;
  // Rain and petals drift sideways, so they start left of the screen as often as above it.
  const x = rand() * (w + 2 * pad) - pad - (s.vx[1] > 40 ? w * 0.2 * rand() : 0);
  const y = anywhere ? rand() * h : rising ? h + pad * rand() : -pad * rand();
  return {
    x, y, vx: between(s.vx, rand()), vy: between(s.vy, rand()), size: between(s.size, rand()), alpha: between(s.alpha, rand()),
    rot: rand() * Math.PI * 2, spin: (rand() - 0.5) * 3, phase: rand() * Math.PI * 2,
  };
}

/** Move a particle on by `dt` seconds at time `t`; false once it has left the screen (to be respawned). */
export function stepParticle(p: Particle, kind: WeatherName, dt: number, t: number, w: number, h: number): boolean {
  const s = WEATHER[kind];
  p.x += (p.vx + (s.sway ? Math.sin(t * 1.5 + p.phase) * s.sway : 0)) * dt;
  p.y += p.vy * dt;
  p.rot += p.spin * dt;
  return p.y < h + 80 && p.y > -80 && p.x > -120 && p.x < w + 120;
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
