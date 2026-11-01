// Captions for sound effects (accessibility): the text shown when `sound play` runs, e.g. [door slams].

export type CaptionTable = Record<string, string>;

/** Why a game.json `captions` entry is unusable, or null when it is fine. An empty string is allowed: it silences the caption. */
export function captionProblem(name: string, value: unknown): string | null {
  return typeof value === 'string' ? null : `captions: "${name}" needs a text like "[door slams]"`;
}

/** The valid entries of `game.captions` (sound name -> text). */
export function captionTable(game: unknown): CaptionTable {
  const out: CaptionTable = {};
  const own = (game as { captions?: unknown } | null | undefined)?.captions;
  if (own && typeof own === 'object' && !Array.isArray(own)) {
    for (const [name, value] of Object.entries(own)) if (captionProblem(name, value) === null) out[name] = value as string;
  }
  return out;
}

/** "sfx/door_slam.ogg" -> "[door slam]". */
export function humanizeSoundName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const words = base.replace(/\.[A-Za-z0-9]{2,4}$/, '').replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/[_\-.]+/g, ' ').trim().toLowerCase();
  return words ? `[${words}]` : '';
}

/** The caption for sound `name`: the table entry, else the humanized name. Null when there is nothing to show. */
export function captionFor(name: string, table: CaptionTable = {}): string | null {
  const text = Object.hasOwn(table, name) ? table[name] : humanizeSoundName(name);
  return text.trim() === '' ? null : text.trim();
}
