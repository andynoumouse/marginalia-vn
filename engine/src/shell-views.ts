// The built-in shell screens (title, pause, options, saves, ...) as views: which screen of the project (or starter)
// each one is, and the variables and entries the shell hands it. Runtime.viewOf resolves a screen against the story's
// variables; these functions only choose the screen and what is passed in. Runtime exposes them as `titleView` and so on.

import { ACHIEVEMENT_TOAST_SCREEN, ACHIEVEMENTS_SCREEN, CHAPTERS_SCREEN, firstTab, GALLERY_SCREEN, HISTORY_SCREEN, MUSIC_SCREEN, OPTIONS_SCREEN, PAUSE_SCREEN, QUICKMENU_SCREEN, SAVES_SCREEN, TITLE_SCREEN, VIEWER_SCREEN, type ScreenDef, type ScreenEnv, type ScreenView } from './screens.js';
import type { Vars } from './types.js';

type Entries = NonNullable<ScreenEnv['entries']>;

/** What the views need of the runtime: the program's screens, and a screen resolved against the story's variables plus `extra`. */
export interface ViewHost {
  screens: Record<string, ScreenDef>;
  viewOf(name: string, extra?: Vars, entries?: ScreenEnv['entries']): ScreenView;
}

/** What the shell tells the quick menu: the buttons to show (action name and label, in order) and where the bar goes (an anchor place, see `quickMenuSettings`). */
export interface QuickMenu { items: { id: string; label: string; /** the key that does the same, shown as a tooltip */ hint?: string }[]; place: string }

/** The screen `name` with `values` and `entries`, or null when the program has no such screen. */
const plain = (h: ViewHost, name: string, values?: Vars, entries?: Entries): ScreenView | null => (name in h.screens ? h.viewOf(name, values, entries) : null);

/** The `quickmenu` screen (the project's, else the starter) as it looks now, or null with no such screen. */
export function quickView(h: ViewHost, menu: QuickMenu): ScreenView | null {
  if (!(QUICKMENU_SCREEN in h.screens)) return null;
  const { items, place } = menu;
  return h.viewOf(QUICKMENU_SCREEN, { quick_items: items.map(i => i.id), quick_place: place }, { quick_items: Object.fromEntries(items.map(i => [i.id, { label: i.label, hint: i.hint ?? '' }])) });
}

/**
 * The `screen title` as it looks now (the project's, else the starter), or null with no such screen. Without `canContinue` the `action continue` elements are
 * disabled; the other flags are the screen's variables of the same names (`has_gallery`...), and the buttons for what is missing are disabled on a project's screen.
 */
export function titleView(h: ViewHost, canContinue: boolean, hasGallery = true, hasMusic = true, hasChapters = true, hasAchievements = true, gameTitle = '', showTitle = true, continueText = ''): ScreenView | null {
  if (!(TITLE_SCREEN in h.screens)) return null;
  const view = h.viewOf(TITLE_SCREEN, { game_title: gameTitle, show_title: showTitle, can_continue: canContinue, continue_text: canContinue ? continueText : '', has_gallery: hasGallery, has_music: hasMusic, has_chapters: hasChapters, has_achievements: hasAchievements });
  const off = (act: string | null) => (act === 'continue' && !canContinue) || (act === 'gallery' && !hasGallery) || (act === 'music' && !hasMusic) || (act === 'chapters' && !hasChapters)
    || (act === 'achievements' && !hasAchievements);
  return { ...view, parts: view.parts.map(p => ('act' in p && off(p.act) ? { ...p, enabled: false } : p)) };
}

/** The `screen pause` as it looks now (the project's, else the starter), or null with no such screen. */
export const pauseView = (h: ViewHost) => plain(h, PAUSE_SCREEN);

/**
 * The project's `screen options` as it looks now, or null with no such screen (the default is drawn in its place). `values` are the
 * player's settings as variables of the screen (the sliders' numbers, the words of the cycle settings, `tab`); an empty `tab` is the first tab.
 */
export function optionsView(h: ViewHost, values: Vars, entries?: Entries): ScreenView | null {
  const def = h.screens[OPTIONS_SCREEN];
  if (!def) return null;
  return h.viewOf(OPTIONS_SCREEN, { ...values, tab: values.tab || firstTab(def) }, entries);
}

/**
 * The project's `screen saves` as it looks now, or null with no such screen (the default is drawn in its place). `values` are
 * `mode`, `page`, `pages` (list), `slots` (list) and `deleting`; `entries` carry the data of each page and slot (`slot.title`, `slot.when`, `slot.text`, `slot.empty`, `pg.name`).
 */
export const savesView = (h: ViewHost, values: Vars, entries: Entries) => plain(h, SAVES_SCREEN, values, entries);

/**
 * The `screen history` as it looks now (the project's, else the starter). `values` are `lines` (list of line
 * ids, oldest first) and `total`; `entries` carry each line (`ln.name` the speaker, `ln.color` its colour, `ln.text`).
 */
export const historyView = (h: ViewHost, values: Vars, entries: Entries) => plain(h, HISTORY_SCREEN, values, entries);

/**
 * The project's `screen gallery` as it looks now, or null with no such screen (the default is drawn in its place). `values` are `tiles` (list of
 * tile ids), `count` (unlocked) and `total`; `entries` carry each tile (`t.title`, `t.unlocked`, `t.file`, the picture's asset file, '' without one).
 */
export const galleryView = (h: ViewHost, values: Vars, entries: Entries) => plain(h, GALLERY_SCREEN, values, entries);

/**
 * The `screen viewer` as it looks now (the project's, else the starter), or null with no such screen. `values` are `file` (the
 * picture's asset file, '' without one), `title`, `position` (1-based) and `total`.
 */
export const viewerView = (h: ViewHost, values: Vars) => plain(h, VIEWER_SCREEN, values);

/**
 * The project's `screen music` as it looks now, or null with no such screen (the default is drawn in its place). `values` are `tracks` (list of
 * track ids), `count` (unlocked), `total` and `now` (the title of the track playing, '' for none); `entries` carry each track (`t.title`, `t.unlocked`, `t.playing`).
 */
export const musicView = (h: ViewHost, values: Vars, entries: Entries) => plain(h, MUSIC_SCREEN, values, entries);

/**
 * The project's `screen chapters` as it looks now, or null with no such screen (the default is drawn in its place). `values` are `chapters`
 * (list of chapter ids), `count` (unlocked) and `total`; `entries` carry each chapter (`c.title`, `c.unlocked`).
 */
export const chaptersView = (h: ViewHost, values: Vars, entries: Entries) => plain(h, CHAPTERS_SCREEN, values, entries);

/**
 * The project's `screen achievements` as it looks now, or null with no such screen (the default is drawn in its place). `values` are `achievements`
 * and `endings` (lists of ids), `count` / `total` (achievements unlocked / all) and `endings_count` / `endings_total`; `entries` carry each one under
 * its list (`a.title`, `a.description`, `a.icon` the image's asset file or '', `a.unlocked`, `a.hidden`, `a.ending`).
 */
export const achievementsView = (h: ViewHost, values: Vars, entries: Entries) => plain(h, ACHIEVEMENTS_SCREEN, values, entries);

/**
 * The `achievement_toast` screen (the project's, else the starter) showing one unlock, or null with no such screen. `values` are
 * `title`, `description`, `icon` (the image's asset file or ''), `ending` and `position` (an anchor place).
 */
export const achievementToastView = (h: ViewHost, values: Vars) => plain(h, ACHIEVEMENT_TOAST_SCREEN, values);
