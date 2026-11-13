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
  '0.6': [
    'Blocking screens can keep local state (state, tab, on click/focus/blur set), take inout parameters, and have toggle and radio elements.',
    'Screen hotspots and buttons can hold child elements; the active state follows the ancestor chain.',
    'movie play shows a fullscreen cutscene; multi-line narration and the {speed=} text tag are new. Command arguments are now checked strictly, so a misspelled argument is an error.',
  ],
  '0.7': [
    'Screen elements animate: on enter / on exit (fade, slide, pop, zoom) and loop (pulse, bob, sway, breathe, shiver, glow). The default screens use them.',
    'Every built-in menu (title, pause, options, saves, history, gallery, music, chapters, achievements, quick menu) is a screen you can override; layout containers take align stretch and width/height, and select <setting> shows a dropdown for a player setting.',
    'textbox hide takes the text box away until the next line. The Translations dialog lists the built-in menu labels (ui.<key>).',
  ],
  '0.8': [
    'rig.json has bones (a parent and a pivot each) and parts that sit on a bone, so a child follows its parent: moving an upper arm carries the forearm. part= and animation keys accept bone names. The animation studio edits bones in the Parts tab (parent, fold, drag to re-parent, pivots).',
    'rig.json looks replace poses and the dressing half of groups (show mina happy casual applies looks left to right); the studio can save the current dress as a look. Old rig.json files are not converted: groups and poses are reported as errors, so move them to bones and looks.',
    'PSD folders named +folder become bones when you run Update Rig after Reconverted Art.',
  ],
  '0.9': [
    'rig.json has parameters, pads and keyforms, mesh-warp deformers, physics chains and stencil masks; animations can key parameters. The animation studio has Model and Animate modes, and can open a character folder with no game project.',
    'scene <bg> dissolve mask=<name> transitions through an image mask.',
  ],
  '0.10': [
    'Transforms are named staging sequences (transform blocks with parallel branches, parameters, if and pick); animate ... auto runs one by itself, and choreography / perform play a timetable for several actors.',
    'The camera can be animated (shake, roll, parallax on pictures), characters and pictures take tint= and flash, ease=bezier(...) works in script, and screens can glow, chromatic or glitch.',
    'burst puffs particles, a voiced line moves the mouth with the recording, and wind and gravity act on physics chains, weather and bursts. scene now resets the camera view.',
    'game.json "theme" is the name of a theme file (an inline object is no longer read), and theme files use the layered keys (tokens, components, styles): move old flat keys such as textbox, choices and skins into components and styles.',
  ],
  '0.11': [
    'Durations carry their unit: write wait 1s, move alice to left 0.5s, fade 0.3s, {pause=0.5s}, 0.6s alice: hop in a choreography, every 3s..6s, on enter fade 0.3s, and timeout 8s or timeout (8 - difficulty)s. A bare number where a duration goes is now an error that says how to write it; shake 0.4s on its own shakes the screen.',
    'Free meshes can be skinned to bones (bone weights in rig.json, painted with the studio\'s Weights tool), and Mina\'s hair is a skinned strand turned by physics.',
    'The animation studio shows key times in seconds and asks whether keys stretch when Length changes; undo and redo go to what they change; Apply keeps rig.json\'s own layout.',
  ],
  '0.12': [
    'rig.json is written in one fixed layout by every writer (the studio, the art update, new skeletons); a hand layout is no longer kept. Every ease in rig.json takes bezier(x1,y1,x2,y2).',
    'Labels, variables, screens and their parameters take names in any alphabet; file and rig names stay ASCII.',
    'Group and variant names from a PSD that scripts cannot say are made script names ("Group 1" becomes Group_1), as part names already were.',
    'flash <name> warns when the name is neither a character nor a picture, and an .svg dropped on the Assets panel is refused.',
  ],
  '0.13': [
    'A new step ease holds the previous value and switches at the key; scene transitions add push, zoom, ripple and fade through a color.',
    'filter takes several looks at once (filter sepia + grain), and filter + / filter - change one; saves holding a single filter still load.',
    'A frame track on a warped part (lattice, free mesh or group member) is no longer a rig.json error.',
    'end "Name" names an ending for the end screen; game.json titleScreen.align, unread since the title became a screen, is marked deprecated.',
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
