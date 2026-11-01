// game.json "splash" (logo cards shown once when the game starts) and "titleScreen.fade" (curtain time in and out of
// the title screen), cleaned up so the game shell can trust the values.

export interface SplashCard {
  /** Background name (assets/bg/<name>.png), centered on black. */
  image: string | null;
  text: string;
  /** Seconds the card stays fully visible. */
  duration: number;
  /** Seconds to fade in, and again to fade out. */
  fade: number;
}

export const DEFAULT_SPLASH_DURATION = 2.5;
export const DEFAULT_SPLASH_FADE = 0.6;
export const DEFAULT_TITLE_FADE = 0.4;

const seconds = (v: unknown, fallback: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(0, v)) : fallback;

/** A string is an image name; an object may have image, text, duration and fade. Entries with neither image nor text are dropped. */
export function normalizeSplash(raw: unknown): SplashCard[] {
  if (!Array.isArray(raw)) return [];
  const cards: SplashCard[] = [];
  for (const r of raw) {
    const o: Record<string, unknown> = typeof r === 'string' ? { image: r } : r && typeof r === 'object' ? r as Record<string, unknown> : {};
    const image = typeof o.image === 'string' && o.image.trim() ? o.image.trim() : null;
    const text = typeof o.text === 'string' ? o.text : '';
    if (!image && !text) continue;
    cards.push({
      image, text,
      duration: seconds(o.duration, DEFAULT_SPLASH_DURATION, 60),
      fade: seconds(o.fade, DEFAULT_SPLASH_FADE, 10),
    });
  }
  return cards;
}

/** Seconds for the curtain between the title screen and the game (0 = cut). */
export const titleFade = (raw: unknown) => seconds(raw, DEFAULT_TITLE_FADE, 5);
