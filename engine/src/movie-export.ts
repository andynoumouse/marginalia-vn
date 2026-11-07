// Movie export from the animation studio: which moment of the animation each exported frame shows, how the frame is cut out of
// the stage, what the files are called. Pure, so a node test can check the arithmetic; the studio's stage page does the drawing
// (preview/studio.ts) and the editor the delivery (editor/anim-export.ts).
//
// Nothing here reads a clock. Frame N is at N / fps seconds, the physics chains are stepped once per frame by 1 / fps (they
// start at rest, after an optional lead-in that is run and not drawn), so the same animation gives the same frames on any
// machine and at any speed of export.

import type { Box } from './bones.js';

export const EXPORT_MIN_FPS = 4;       // below 4 a frame is longer than the physics' longest step (0.25 s), which would clamp
export const EXPORT_MAX_FPS = 120;
export const EXPORT_MAX_FRAMES = 3600;
export const EXPORT_MIN_SIDE = 16;
export const EXPORT_MAX_SIDE = 4096;
export const EXPORT_MAX_LOOPS = 50;
export const EXPORT_MAX_LEAD_IN = 60;  // seconds

/** What the animator asks for. `loop` repeats the animation `loops` times as a seamless cycle; otherwise it plays once and ends on its last pose. */
export interface MovieSpec {
  /** The animation's length in seconds. */
  dur: number;
  fps: number;
  loop?: boolean;
  loops?: number;
  /** Seconds of animation run unseen before frame 1, so physics chains are already swinging (a loop wraps around, a single play holds its first pose). */
  leadIn?: number;
}

export interface MoviePlan {
  dur: number;
  fps: number;
  loop: boolean;
  loops: number;
  /** Frames drawn. */
  frames: number;
  /** Frames stepped before the first drawn one. */
  lead: number;
}

const whole = (v: number, lo: number, hi: number, or: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : or);

/** Round the spec's numbers into range and work out how many frames it makes. A loop of whole frames has no repeated end frame (frame N would equal frame 0); a single play has one more frame than its length in frames, so the last pose is drawn. */
export function planMovie(spec: MovieSpec): MoviePlan {
  const dur = Number.isFinite(spec.dur) && spec.dur > 0 ? spec.dur : 1;
  const fps = whole(spec.fps, EXPORT_MIN_FPS, EXPORT_MAX_FPS, 30);
  const loop = spec.loop === true;
  const loops = loop ? whole(spec.loops ?? 1, 1, EXPORT_MAX_LOOPS, 1) : 1;
  const frames = loop ? Math.max(1, Math.round(dur * fps * loops)) : Math.ceil(dur * fps - 1e-6) + 1;
  const lead = Number.isFinite(spec.leadIn) && spec.leadIn! > 0 ? Math.round(Math.min(spec.leadIn!, EXPORT_MAX_LEAD_IN) * fps) : 0;
  return { dur, fps, loop, loops, frames, lead };
}

/** Seconds into the animation that frame `n` shows. `n` runs from `-lead` (the first unseen frame) to `frames - 1`. */
export function frameTime(plan: MoviePlan, n: number): number {
  const raw = n / plan.fps;
  if (!plan.loop) return Math.min(plan.dur, Math.max(0, raw));
  const t = ((raw % plan.dur) + plan.dur) % plan.dur;
  return plan.dur - t < 1e-9 ? 0 : t;
}

/** The progress (0-1) `studioPose` takes for frame `n`. */
export function frameProgress(plan: MoviePlan, n: number): number {
  return Math.min(1, frameTime(plan, n) / plan.dur);
}

/** How long a physics step covers: one frame. */
export const frameStep = (plan: MoviePlan): number => 1 / plan.fps;

/** Seconds the finished movie lasts. */
export const movieSeconds = (plan: MoviePlan): number => plan.frames / plan.fps;

/** What stops an export before it starts (too many frames, a size that is not drawable), or null. */
export function movieProblem(plan: MoviePlan, width: number, height: number): string | null {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < EXPORT_MIN_SIDE || height < EXPORT_MIN_SIDE || width > EXPORT_MAX_SIDE || height > EXPORT_MAX_SIDE) return `The size must be whole pixels from ${EXPORT_MIN_SIDE} to ${EXPORT_MAX_SIDE} on each side.`;
  if (plan.frames > EXPORT_MAX_FRAMES) return `That is ${plan.frames} frames; the most is ${EXPORT_MAX_FRAMES}. Lower the frame rate or the loop count.`;
  return null;
}

/** The smallest box holding both. */
export function unionBox(a: Box | null, b: Box | null): Box | null {
  if (!a || !b) return a ?? b;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/**
 * The piece of the stage that becomes a `width` x `height` image and the scale it is drawn at: `box` centred, as large as fits with
 * `margin` (a fraction of its size) to spare on every side. The piece has the image's proportions, so it may reach past `box`.
 */
export function fitFrame(box: Box, width: number, height: number, margin = 0.05): Box & { resolution: number } {
  const bw = Math.max(1, box.w) * (1 + 2 * margin), bh = Math.max(1, box.h) * (1 + 2 * margin);
  const resolution = Math.min(width / bw, height / bh);
  const w = width / resolution, h = height / resolution;
  return { x: box.x + box.w / 2 - w / 2, y: box.y + box.h / 2 - h / 2, w, h, resolution };
}

/** `#rrggbb` as given (lower-cased), or null for anything else (a transparent background). */
export function exportBackground(v: unknown): string | null {
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null;
}

/** A file name stem from what was typed: letters, digits, `_` and `-`, else `fallback`. */
export function exportStem(v: string, fallback: string): string {
  return v.trim().replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || fallback;
}

/** `walk_0007.png` for frame index `n` (0-based) of `count`: numbering starts at 1 and has at least four digits, so the files sort in order. */
export function frameFile(stem: string, n: number, count: number): string {
  return `${stem}_${String(n + 1).padStart(Math.max(4, String(count).length), '0')}.png`;
}

/** One export run: where the frames come from and where they go. Everything is injected, so the loop itself needs no browser. */
export interface MovieJob {
  frames: number;
  stem: string;
  /** Ask the stage for frame `n` (always in order, starting at 0); resolves with the PNG. */
  frame(n: number): Promise<Uint8Array>;
  /** Hand one finished file over: a write into a folder, or an entry of a zip. */
  write(name: string, bytes: Uint8Array): Promise<void> | void;
  /** After each frame is written: how many are done. */
  progress?(done: number): void;
  /** Checked before every frame; true stops the run cleanly. */
  cancelled?(): boolean;
}

/**
 * Run a job one frame at a time: ask for it, write it, report, and look at the cancel flag before the next. One frame in flight at
 * a time is also the back-pressure: a slow disk slows the stage, and nothing piles up in memory. A failing frame or write rejects.
 */
export async function runMovieExport(job: MovieJob): Promise<{ written: number; cancelled: boolean }> {
  let written = 0;
  for (let n = 0; n < job.frames; n++) {
    if (job.cancelled?.()) return { written, cancelled: true };
    const bytes = await job.frame(n);
    await job.write(frameFile(job.stem, n, job.frames), bytes);
    written++;
    job.progress?.(written);
  }
  return { written, cancelled: false };
}

/** What the Export dialog asks for, kept between openings. */
export interface ExportOptions {
  fps: number;
  loop: boolean;
  loops: number;
  leadIn: number;
  width: number;
  height: number;
  /** `stage`: the whole stage as the game would show it, scaled to fit; `character`: the art over the whole animation, scaled to fill the image. */
  framing: 'stage' | 'character';
  /** `#rrggbb`, or null for a transparent background. */
  background: string | null;
  /** `folder`: one PNG file after another into a folder; `zip`: one archive. */
  save: 'folder' | 'zip';
}
export const DEFAULT_EXPORT: Readonly<ExportOptions> = { fps: 30, loop: false, loops: 1, leadIn: 0, width: 1280, height: 720, framing: 'stage', background: null, save: 'folder' };

/** Stored options (JSON text) put in range, a field at a time: a value that is missing or wrong is the default. */
export function readExportOptions(raw: string | null | undefined): ExportOptions {
  let v: Record<string, unknown> = {};
  try { const p: unknown = raw ? JSON.parse(raw) : null; if (p && typeof p === 'object' && !Array.isArray(p)) v = p as Record<string, unknown>; } catch { /* the defaults */ }
  const d = DEFAULT_EXPORT;
  const n = (k: string, lo: number, hi: number, or: number) => (typeof v[k] === 'number' && Number.isFinite(v[k]) ? Math.min(hi, Math.max(lo, Math.round(v[k] as number))) : or);
  return {
    fps: n('fps', EXPORT_MIN_FPS, EXPORT_MAX_FPS, d.fps),
    loop: v.loop === true,
    loops: n('loops', 1, EXPORT_MAX_LOOPS, d.loops),
    leadIn: n('leadIn', 0, EXPORT_MAX_LEAD_IN, d.leadIn),
    width: n('width', EXPORT_MIN_SIDE, EXPORT_MAX_SIDE, d.width),
    height: n('height', EXPORT_MIN_SIDE, EXPORT_MAX_SIDE, d.height),
    framing: v.framing === 'character' ? 'character' : 'stage',
    background: exportBackground(v.background),
    save: v.save === 'zip' ? 'zip' : 'folder',
  };
}
