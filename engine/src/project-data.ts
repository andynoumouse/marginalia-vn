// The project as the game sees it (scripts, locale tables, the asset list and game.json), built from a file listing so it
// works on any file store: tools/project-data.mjs hands it the disk, the online demo's service worker (online/sw.ts) its
// IndexedDB. Served by the dev server as /api/project and written as project.json by the web export.

import type { RigManifest } from './assets.js';
import { resolveTheme, themeStylesheet } from './theme.js';

export interface ListedFile {
  /** Project-relative, '/'-separated ("script/park.vn", "assets/bg/park.png"). */
  path: string;
  /** Modification time in ms; the asset list's version stamp, so the renderer refetches files that changed. */
  mtime: number;
}

export interface ProjectListing {
  /** Every file under script/, locale/, themes/ and assets/, plus game.json (other paths are ignored). */
  files: readonly ListedFile[];
  /** Every folder under script/ and assets/ (project-relative), empty ones included. */
  dirs: readonly string[];
  /** The text of one of the files projectTextFiles names; null when it cannot be read. */
  text(path: string): string | null;
  warn?(message: string): void;
}

export interface ProjectData {
  scripts: { file: string; text: string }[];
  scriptDirs: string[];
  locales: Record<string, unknown>;
  assets: { file: string; v: number }[];
  rigs: Record<string, RigManifest>;
  rigTexts: Record<string, string>;
  /** Raw text of every themes/<name>.json, for the editor's theme tabs. */
  themeTexts: Record<string, string>;
  /** Raw text of every themes/<name>.css, for the editor's CSS tabs. */
  themeSheets: Record<string, string>;
  game: Record<string, unknown>;
  gameText: string | null;
}

const under = (dir: string, p: string) => (p.startsWith(`${dir}/`) ? p.slice(dir.length + 1) : null);
const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const KEEP = /(^|\/)\.gitkeep$/;

/** The files projectFromListing reads the text of: scripts, locale tables, sprite and rig manifests, game.json. */
export function projectTextFiles(paths: Iterable<string>): string[] {
  return [...paths].filter(p => p === 'game.json' || /^script\/.+\.vn$/.test(p) || /^locale\/[^/]+\.json$/.test(p) || /^themes\/[^/]+\.(json|css)$/.test(p)
    || /^assets\/char\/[^/]+\/(sprite|rig)\.json$/.test(p));
}

export function projectFromListing(listing: ProjectListing): ProjectData {
  const warn = listing.warn ?? (() => {});
  const files = [...listing.files].filter(f => !KEEP.test(f.path)).sort((a, b) => byName(a.path, b.path));
  const scripts = files.flatMap(f => {
    const file = under('script', f.path);
    return file?.endsWith('.vn') ? [{ file, text: listing.text(f.path) ?? '' }] : [];
  });
  const scriptDirs = listing.dirs.flatMap(d => under('script', d) ?? []).sort(byName);
  const locales: Record<string, unknown> = {};
  for (const f of files) {
    const m = /^locale\/([^/]+)\.json$/.exec(f.path);
    if (!m) continue;
    try { locales[m[1]] = JSON.parse(listing.text(f.path) ?? ''); } catch (e) { warn(`Bad locale file ${f.path}: ${(e as Error).message}`); }
  }
  const assets = files.flatMap(f => {
    const file = under('assets', f.path);
    return file === null ? [] : [{ file, v: Math.floor(f.mtime) }];
  });
  // Layered characters (PSD converter output), for checking poses and slots used in scripts.
  const rigs: Record<string, RigManifest> = {}, rigTexts: Record<string, string> = {}; // rigTexts: raw rig.json per character, for the editor
  const have = new Set(assets.map(a => a.file));
  for (const a of assets) {
    const m = /^char\/([^/]+)\/sprite\.json$/.exec(a.file);
    if (!m) continue;
    try { rigs[m[1]] = JSON.parse(listing.text(`assets/${a.file}`) ?? ''); } catch (e) { warn(`Bad ${a.file}: ${(e as Error).message}`); }
  }
  // A flat character (one image per pose) with a rig.json gets a manifest without parts, so its animations work.
  for (const a of assets) {
    const m = /^char\/([^/]+)\/rig\.json$/.exec(a.file);
    if (m && !rigs[m[1]]) rigs[m[1]] = { parts: [], flat: true } as unknown as RigManifest;
  }
  // Hand-written additions (z-order, groups, shorthands) next to a generated sprite.json: engine/src/rig.ts.
  for (const [char, manifest] of Object.entries(rigs)) {
    const file = `char/${char}/rig.json`;
    if (!have.has(file)) continue;
    const text = listing.text(`assets/${file}`);
    if (text === null) continue;
    try { rigTexts[char] = text; (manifest as { rig?: unknown }).rig = JSON.parse(text); } catch (e) { warn(`Bad ${file}: ${(e as Error).message}`); }
  }
  // game.json: parsed for the game, raw text for the editor (keeps the author's formatting).
  let game: Record<string, unknown> = {}, gameText: string | null = null;
  if (files.some(f => f.path === 'game.json')) {
    gameText = listing.text('game.json');
    try { game = JSON.parse(gameText ?? ''); } catch (e) { warn(`Bad game.json: ${(e as Error).message}`); }
  }
  // game.json "theme": "<name>" picks themes/<name>.json; the game gets the resolved theme object (game.theme.skins etc. work as before).
  const themeTexts: Record<string, string> = {}, themeSheets: Record<string, string> = {};
  for (const f of files) {
    const m = /^themes\/([^/]+)\.(json|css)$/.exec(f.path);
    if (m) (m[2] === 'json' ? themeTexts : themeSheets)[m[1]] = listing.text(f.path) ?? '';
  }
  const picks = Array.isArray(game.themes) ? game.themes.filter((n): n is string => typeof n === 'string') : [];
  if (typeof game.theme === 'string' || picks.length) {
    const themes: Record<string, unknown> = {};
    const sheets: Record<string, string> = {};
    for (const f of files) {
      const m = /^themes\/([^/]+)\.json$/.exec(f.path);
      if (m) {
        try { themes[m[1]] = JSON.parse(listing.text(f.path) ?? ''); } catch (e) { warn(`Bad ${f.path}: ${(e as Error).message}`); }
      } else {
        const c = /^themes\/([^/]+)\.css$/.exec(f.path);
        if (c) sheets[c[1]] = listing.text(f.path) ?? '';
      }
    }
    const look = (n: string) => {
      const css = themeStylesheet(n, themes, sheets);
      return { ...resolveTheme(n, themes, warn), ...(css ? { css } : {}) };
    };
    // game.json "themes": the ones the player may pick in Options, resolved by name (`themeLooks`).
    const themeLooks = Object.fromEntries(picks.map(n => [n, look(n)]));
    game = { ...game, ...(typeof game.theme === 'string' ? { theme: look(game.theme) } : {}), ...(picks.length ? { themes: picks, themeLooks } : {}) };
  }
  return { scripts, scriptDirs, locales, assets, rigs, rigTexts, themeTexts, themeSheets, game, gameText };
}

/** What the editor's files panel adds: the PSD masters (bg/, char/, ui/ only) and the top-level asset folders, empty ones included. */
export function editorExtras(paths: Iterable<string>, dirs: Iterable<string>): { masters: string[]; assetDirs: string[] } {
  const masters = [...paths].filter(p => /^masters\/(bg|char|ui)\/[^/]+\.psd$/i.test(p)).map(p => p.slice('masters/'.length)).sort(byName);
  const assetDirs = [...new Set([...dirs].flatMap(d => /^assets\/([^/]+)$/.exec(d)?.[1] ?? []))].sort(byName);
  return { masters, assetDirs };
}
