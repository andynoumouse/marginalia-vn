// Speaker focus (game.json "speakerFocus"): while someone speaks, the other characters on stage are dimmed, and the speaker
// may be brought to the front for the line. Pure; the renderer asks it who is lit whenever the speaker or the stage changes.
//
// It is on only when the game turns it on, the story has not turned it off (`focus off`, DisplayState.focus) and the
// player has not either (Options). A character defined with `focus=off` is always lit.

export const OFFSTAGE_MODES = ['lit', 'dim'] as const;
export type OffstageMode = typeof OFFSTAGE_MODES[number];

/**
 * `dim`: how much darker the others get (0-1); `fade`: seconds the change takes; `front`: raise the speaker for the line;
 * `offstage`: when the speaker is not on stage (narration, the player character), everyone is lit or everyone is dimmed.
 */
export interface SpeakerFocus { dim: number; fade: number; front: boolean; offstage: OffstageMode }

const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);

/** game.json "speakerFocus" with defaults for missing or bad values; null when absent or false (no focus). */
export function speakerFocusSettings(raw: unknown): SpeakerFocus | null {
  if (raw === true) raw = {};
  const o = obj(raw);
  if (!o) return null;
  const dim = typeof o.dim === 'number' && o.dim >= 0 && o.dim <= 1 ? o.dim : 0.35;
  const fade = typeof o.fade === 'number' && Number.isFinite(o.fade) && o.fade >= 0 ? Math.min(o.fade, 5) : 0.2;
  const offstage = (OFFSTAGE_MODES as readonly string[]).includes(o.offstage as string) ? o.offstage as OffstageMode : 'lit';
  return { dim, fade, front: o.front === true, offstage };
}

/** Problems with game.json "speakerFocus", as warnings. */
export function speakerFocusProblems(raw: unknown): string[] {
  if (raw === undefined || typeof raw === 'boolean') return [];
  const o = obj(raw);
  if (!o) return ['speakerFocus needs an object like { "dim": 0.35, "fade": 0.2 }'];
  const out: string[] = [];
  if (o.dim !== undefined && !(typeof o.dim === 'number' && o.dim >= 0 && o.dim <= 1)) out.push('speakerFocus.dim needs a number from 0 to 1');
  if (o.fade !== undefined && !(typeof o.fade === 'number' && o.fade >= 0)) out.push('speakerFocus.fade needs a number of seconds (0 or more)');
  if (o.front !== undefined && typeof o.front !== 'boolean') out.push('speakerFocus.front needs true or false');
  if (o.offstage !== undefined && !(OFFSTAGE_MODES as readonly string[]).includes(o.offstage as string)) out.push(`speakerFocus.offstage must be one of ${OFFSTAGE_MODES.join(', ')}`);
  for (const k of Object.keys(o)) if (!['dim', 'fade', 'front', 'offstage'].includes(k)) out.push(`speakerFocus has no option "${k}" (use dim, fade, front, offstage)`);
  return out;
}

/**
 * How bright each character on stage is (1 lit, 1 - dim dimmed). `speaker` is the character whose line is up (null for
 * narration or between lines); `focus` is null when the game, the story or the player has it off; `alwaysLit` are the
 * characters defined with `focus=off`.
 */
export function focusLevels(onStage: readonly string[], speaker: string | null, focus: SpeakerFocus | null, alwaysLit: (char: string) => boolean): Map<string, number> {
  const dimmed = 1 - (focus?.dim ?? 0);
  const speaking = speaker !== null && onStage.includes(speaker);
  return new Map(onStage.map(c => {
    if (!focus || alwaysLit(c)) return [c, 1];
    if (speaking) return [c, c === speaker ? 1 : dimmed];
    return [c, focus.offstage === 'dim' ? dimmed : 1];
  }));
}

/** The character to draw in front of the others for this line (`front`), if any; their place in the order comes back after it. */
export function raisedSpeaker(onStage: readonly string[], speaker: string | null, focus: SpeakerFocus | null): string | null {
  return focus?.front && speaker !== null && onStage.includes(speaker) ? speaker : null;
}
