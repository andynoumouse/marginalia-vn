// Marginalia Studio's recent projects and the engine-version notice shown when one opens. Pure: the Studio's main process
// (studio/main.cjs) reads and writes the list file and game.json.

/** One row of the recent list, kept in the Studio's user data. title, id and engine are as last seen in game.json. */
export interface RecentProject {
  folder: string;
  title: string;
  id?: string;
  engine?: string;
  /** ISO time. */
  lastOpened: string;
}

/** The longest the recent list grows; the least recently opened rows go first. */
export const MAX_RECENT = 30;

const sameFolder = (a: string, b: string, caseInsensitive: boolean) =>
  caseInsensitive ? a.toLowerCase() === b.toLowerCase() : a === b;

/** The list with `entry` at the top (replacing the row for its folder), capped at MAX_RECENT. */
export function touchRecent(list: RecentProject[], entry: RecentProject, { caseInsensitive = false } = {}): RecentProject[] {
  return [entry, ...list.filter(r => !sameFolder(r.folder, entry.folder, caseInsensitive))].slice(0, MAX_RECENT);
}

export function removeRecent(list: RecentProject[], folder: string, { caseInsensitive = false } = {}): RecentProject[] {
  return list.filter(r => !sameFolder(r.folder, folder, caseInsensitive));
}

/** The recent list from its file's text: rows that lack a folder are dropped, a broken file is an empty list. */
export function parseRecent(text: string | null): RecentProject[] {
  let value: unknown;
  try { value = JSON.parse(text ?? '[]'); } catch { return []; }
  if (!Array.isArray(value)) return [];
  return value.filter((r): r is RecentProject => !!r && typeof r === 'object' && typeof r.folder === 'string' && r.folder !== '')
    .map(r => ({ ...r, title: typeof r.title === 'string' ? r.title : '', lastOpened: typeof r.lastOpened === 'string' ? r.lastOpened : '' }));
}

/**
 * The other recent folders whose game id is `id`. The preview keeps saves and settings per game id, so two such projects
 * share them.
 */
export function sharedGameId(list: RecentProject[], folder: string, id: string | undefined, { caseInsensitive = false } = {}): string[] {
  if (!id) return [];
  return list.filter(r => r.id === id && !sameFolder(r.folder, folder, caseInsensitive)).map(r => r.folder);
}

/**
 * What changed for game authors in each engine minor version ("0.2"): shown when a game made with an older engine opens.
 * Add an entry with every minor release.
 */
export const ENGINE_CHANGES: Record<string, string[]> = {
  '0.2': [
    'The export ships the compiled program and per-language translation files; voice files use an id.lang suffix.',
    'game.json names the source language, voice languages, achievements and endings.',
    'Flat characters can have a rig.json with animations.',
  ],
  '0.3': [
    'game.json can set an icon, a game version, speaker focus and side images (the last two are off when absent).',
    'Characters on stage have a draw order (show ... order=front|back, behind=<char>).',
    'Exported games show an error screen with a report to copy instead of stopping.',
  ],
  '0.4': [
    'game.json can hold a theme with named styles; speakers (define ... style=), lines (style=), menus and buttons use them.',
    'Screens have panel (a 9-slice framed container) and bar (a stat bar) elements.',
    'game.json "saveNames" lets the player name a save; history lines can roll the story back to them (action line).',
  ],
  '0.5': [
    'Screens take parameters (screen room(name, floor):, show screen room("hall", 2) as spot); F2 renames them inside the screen.',
    'textbox off hides the text box while a blocking screen is up.',
    'New projects start from a template (Blank, Classic ADV, Portrait, Kinetic/NVL, Branching, Mystery) with a shared asset pool.',
  ],
};

const minorKey = (v: string) => { const [maj, min = 0] = v.split('.').map(n => Number(n) || 0); return maj * 1000 + min; };

/** The ENGINE_CHANGES entries after `wanted` up to `have` (major.minor or longer), oldest first. */
export function changesSince(wanted: string, have: string, changes: Record<string, string[]> = ENGINE_CHANGES): { version: string; changes: string[] }[] {
  const from = minorKey(wanted), to = minorKey(have);
  return Object.keys(changes)
    .filter(v => minorKey(v) > from && minorKey(v) <= to)
    .sort((a, b) => minorKey(a) - minorKey(b))
    .map(version => ({ version, changes: changes[version] }));
}

/** game.json's text with its top-level "engine" set to `version` ("0.2"), the rest of the text kept as it is. */
export function withEngineVersion(gameText: string, version: string): string {
  const quoted = JSON.stringify(version);
  const re = /^(\s*"engine"\s*:\s*)"[^"]*"/m;
  if (re.test(gameText)) return gameText.replace(re, (_m, head: string) => head + quoted);
  // No engine yet: add it after the opening brace, indented like the next line.
  return gameText.replace(/^(\s*\{)(\r?\n)([ \t]*)/, (_m, brace: string, nl: string, indent: string) => `${brace}${nl}${indent}"engine": ${quoted},${nl}${indent}`);
}
