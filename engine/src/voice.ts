/**
 * The voice recording of a line is found from its localization id: `assets/voice/<lang>/<id>.<ext>` for the player's language,
 * else `assets/voice/<id>.<ext>`. `has` tells whether a name under `voice/` exists (without extension). Returns that name, or null
 * when the line has no recording (lines without an id never do).
 */
export function voiceFile(id: string | null | undefined, lang: string, has: (name: string) => boolean): string | null {
  if (!id) return null;
  for (const name of [`${lang}/${id}`, id]) if (has(name)) return name;
  return null;
}
