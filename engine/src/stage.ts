// The stage size: one per project, from game.json `"stage": { "width": 1080, "height": 1920 }` (default 1920x1080).
// Screens, hotspots and `image` coordinates are in these pixels. The size is read from game.json every time the project
// is compiled or shown; nothing derived from it is ever saved (saves hold fractions of the stage and variables only).

export interface StageSize { width: number; height: number }

export const DEFAULT_STAGE: StageSize = { width: 1920, height: 1080 };

/** The biggest side accepted; keeps a typo like 192000 from allocating a huge canvas. */
export const MAX_STAGE_SIDE = 8192;
export const MIN_STAGE_SIDE = 64;

const validSide = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= MIN_STAGE_SIDE && v <= MAX_STAGE_SIDE;

/** Why game.json `stage` is unusable, or null when it is fine (or absent). */
export function stageProblem(value: unknown): string | null {
  if (value === undefined) return null;
  const v = value as { width?: unknown; height?: unknown } | null;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'stage needs { "width": number, "height": number } in pixels';
  for (const side of ['width', 'height'] as const) {
    if (!validSide(v[side])) return `stage.${side} needs a whole number of pixels from ${MIN_STAGE_SIDE} to ${MAX_STAGE_SIDE}`;
  }
  return null;
}

/** The project's stage size; the default when game.json has none or it is unusable (checkGame reports that). */
export function stageSize(game: unknown): StageSize {
  const s = (game as { stage?: unknown } | null | undefined)?.stage;
  if (s === undefined || stageProblem(s) !== null) return DEFAULT_STAGE;
  const { width, height } = s as StageSize;
  return { width, height };
}

/** "1920x1080": how messages name the stage. */
export const stageLabel = (s: StageSize): string => `${s.width}x${s.height}`;

/**
 * The length that animation offsets are fractions of: the stage's shorter side (its height on a landscape stage, so
 * existing projects are unchanged; its width on a portrait one). Pixel constants such as a 8 px shake are written
 * against the 1080 reference and therefore stay the same size relative to the screen on any stage.
 */
export const fxUnit = (s: StageSize): number => Math.min(s.width, s.height);
