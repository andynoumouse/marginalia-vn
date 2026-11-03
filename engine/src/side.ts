// Side images (game.json "sideImages"): the speaker's portrait inside the text box. Off unless the game turns it on; only
// characters defined with `side=<name>` get one. The art is assets/side/<name>.png, and assets/side/<name>_<pose>.png when
// the speaker is on stage in that pose (so the portrait follows `show alice smile`). Pure; the text box asks it per line.

export const SIDE_PLACES = ['left', 'right'] as const;
export type SidePlace = typeof SIDE_PLACES[number];
export const SIDE_WHEN = ['always', 'offstage'] as const;
export type SideWhen = typeof SIDE_WHEN[number];

/** `place`: which end of the text box; `size`: portrait height in stage pixels; `when`: always, or only while the speaker is not on stage. */
export interface SideImages { place: SidePlace; size: number; when: SideWhen }

const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);
const KEYS = ['place', 'size', 'when'];

/** game.json "sideImages" with defaults for missing or bad values; null when absent or false (no side images). */
export function sideImageSettings(raw: unknown): SideImages | null {
  if (raw === true) raw = {};
  const o = obj(raw);
  if (!o) return null;
  const place = (SIDE_PLACES as readonly string[]).includes(o.place as string) ? o.place as SidePlace : 'left';
  const size = typeof o.size === 'number' && Number.isFinite(o.size) && o.size > 0 ? Math.min(o.size, 2000) : 260;
  const when = (SIDE_WHEN as readonly string[]).includes(o.when as string) ? o.when as SideWhen : 'always';
  return { place, size, when };
}

/** Problems with game.json "sideImages", as warnings. */
export function sideImageProblems(raw: unknown): string[] {
  if (raw === undefined || typeof raw === 'boolean') return [];
  const o = obj(raw);
  if (!o) return ['sideImages needs true or an object like { "place": "left", "size": 260 }'];
  const out: string[] = [];
  if (o.place !== undefined && !(SIDE_PLACES as readonly string[]).includes(o.place as string)) out.push(`sideImages.place must be one of ${SIDE_PLACES.join(', ')}`);
  if (o.size !== undefined && !(typeof o.size === 'number' && Number.isFinite(o.size) && o.size > 0)) out.push('sideImages.size needs a height in stage pixels (above 0)');
  if (o.when !== undefined && !(SIDE_WHEN as readonly string[]).includes(o.when as string)) out.push(`sideImages.when must be one of ${SIDE_WHEN.join(', ')}`);
  for (const k of Object.keys(o)) if (!KEYS.includes(k)) out.push(`sideImages has no option "${k}" (use ${KEYS.join(', ')})`);
  return out;
}

/**
 * The asset key of the portrait to show with a line, or null for none. `side` is the speaker's `side=` name; `pose` is the
 * speaker's pose when they are on stage (null when shown without one), undefined when they are not on stage.
 */
export function sideImageKey(side: string | undefined, pose: string | null | undefined, settings: SideImages | null, has: (key: string) => boolean): string | null {
  if (!settings || !side) return null;
  if (settings.when === 'offstage' && pose !== undefined) return null;
  if (pose && has(`side/${side}_${pose}`)) return `side/${side}_${pose}`;
  return has(`side/${side}`) ? `side/${side}` : null;
}
