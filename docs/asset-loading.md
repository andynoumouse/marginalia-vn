# Asset loading: findings and recommendation

Answers the TODO "Performance" item. Sections 1-4 describe the code as investigated, before the changes; steps 1-3 of section 5 are now implemented (see [architecture.md](architecture.md#asset-loading)). Measured on a synthetic project (24 backgrounds 1920x1080, 6 characters x 10 layers, 4 tracks, 3 sounds; 97 files, 114 MB; localhost): before, all 97 files were requested before the title screen; now 5 (the title background, the title music and 3 short sounds, about 6.4 MB), and the first scene's files load behind the title.

> The `file:line` references in sections 1-4 point at the code as investigated. Files have been split since (for example `pixi-renderer.ts`, `stage-ui.ts` and `preview.ts`), and `preloadArt` is gone, so the line numbers no longer match; search for the named symbol instead.

## 1. How assets load today: everything, at boot, and nothing is ever unloaded

`load()` in `preview/preview.ts:298` fetches the project, compiles it, then calls `renderer.preload(proj.assets)` (`preview.ts:317`) and only then shows the title (`:329`). `proj.assets` is the full file list of `assets/` (`tools/project-data.mjs:37`; the web export ships the same list in `project.json`, and `preview.ts:48` reads it). `StageRenderer.preload` (`preview/stage-ui.ts:64`) does two things, and both walk the whole list:

| Kind | Where | Behaviour |
|---|---|---|
| Images (bg, char, ui) | `PixiRenderer.preloadArt`, `preview/pixi-renderer.ts:62-72` | `Promise.allSettled` over **every** png/webp/jpg/avif: fetch, decode (`createImageBitmap`), `Assets.load`, kept in `this.art`. |
| Rigs | `pixi-renderer.ts:73-79` | Fetches every `char/*/sprite.json`, after the images finish (sequential). |
| Music and sounds | `AudioSystem.setAssets`, `preview/audio.ts:39-48` | Every file is fetched and `decodeAudioData`-ed up front (`void this.buffer(url)`, comment: "decode ahead"). Not awaited, so it does not hold up the title screen, but it still downloads and holds everything. Decoded buffers are 32-bit float PCM, so memory is far above file size (a 3 minute stereo 44.1 kHz track is about 63 MB decoded; an mp3 or ogg of it is about 3 MB). |
| Fonts | `engine/src/theme.ts` (`themeCss`) | `@font-face` rules for every font file. The browser fetches a face only when text uses it, so this is lazy already. |
| UI skin images | `engine/src/theme.ts` (`border-image: url(...)`) | CSS, so fetched only when a rule matches (skins scoped by `data-skin` load on first use). Lazy already. |
| Gallery thumbnails | `preview.ts:134`, `menus.ts:292,312` | Full-size backgrounds used as CSS images; fetched again by the browser (the dev server sends `no-store`). |
| Blips | `preview/blips.ts` | Synthesized; samples go through the audio list above. |

Nothing is ever released: no `Assets.unload`, and no `texture.destroy` anywhere in `preview/`. Sprite and background `destroy()` calls (`pixi-renderer.ts:207-227,300,326`) leave the shared textures alone. On every hot reload `preloadArt` clears the `art` map but the Pixi `Assets` cache keeps the textures (keyed by `?v=` mtime, so every edited image leaves a stale copy in an editing session).

## 2. Measurements

At the time, `games/sample/assets` was **empty** (only `.gitkeep`), so the sample game ran entirely on placeholders and loaded nothing. To get numbers I generated a synthetic project (kept outside the repo): 30 backgrounds 1920x1080 PNG (about 4 MB each, a pessimistic noisy case), 10 characters with 20 PNG layers each (500x700, 240 KB each, `sprite.json` rig), 10 music tracks (20 s stereo WAV, 3.4 MB each), 5 sounds, and a 3-chapter script. Dev server on port 5180, built-in browser, localhost, so no network latency.

- Boot requests: 27 code/API requests, 255 asset requests (230 images, 10 `sprite.json`, 10 music, 5 sounds), about **204 MB** of assets; all of them requested before the title appeared. (The browser tool's network list and `performance` resource timing do not show Pixi's image fetches; the count comes from the asset list and the request ordering.)
- Time to the title screen: **about 1.0 s** on localhost (page load to "title screen"). The synthetic script only ever shows the first chapter's few backgrounds early on, yet all 30 are loaded. On a real connection the download dominates: 204 MB at 50 Mbit/s is about 33 s before the title appears, because `await renderer.preload()` gates `showTitle()`.
- JS heap at the title: 5 MB. The cost is not on the JS heap: decoded images and audio sit in the GPU and native audio memory, which the browser tools here cannot read, so these are estimates.
  - Backgrounds: 30 x 1920 x 1080 x 4 B = about 250 MB.
  - Character layers: 200 x 500 x 700 x 4 B = about 280 MB (real PSD layers are often cropped, so this is a mid estimate; full-canvas layers at 1920x1080 would be about 1.6 GB).
  - Audio: this test, 10 x 20 s = 70 MB. Ten real 3-minute tracks decode to about 630 MB.
  - Total: roughly 0.6 GB for this small game, up to well over 2 GB for a plausible full game. Mobile browsers and low-end devices kill tabs at around 1 to 2 GB; a desktop wrapper (Electron) has a similar per-process limit for the renderer GPU memory.
- Web export (`tools/export-web.mjs`, run with `--no-build` on the synthetic project): 282 files, 203.8 MB, copies all of `assets/` (`:53`). It runs the identical preload path against `project.json`, so shipped games behave exactly like the dev server, and over a real network the boot cost is worst there.

Conclusion for the TODO: **the engine loads all images and all audio at boot, before the title, and never unloads anything.** It is fine for the current sample (nothing) and for a small prototype, and it will not scale.

## 3. What the script tells us statically

The compiled `Program` (`engine/src/types.ts:59`) is a flat `ops[]` with resolved targets: `jump`/`call` carry `label` and `target` pc (`ControlBody`, `types.ts:48`), menus carry per-option `target` pcs, `branch`/`goto` are pc targets, and `labels` maps name to pc. There are no computed jumps, so the control-flow graph is exact, with conditions over-approximated (take both sides of a `branch` or menu option; a `menu` option with `cond` is still reachable). `ret` returns to the call site, so reachability by pc is just a graph walk that follows `call` fall-through.

Per op, the asset it needs is already extracted by `checkAssets` (`engine/src/assets.ts:62-89`): `scene` gives a background (`bg/<name>` or a root image), `show` gives character + pose + slot overrides (resolved through the rig to concrete layer files using the same lookup as `PixiRenderer.look`, `pixi-renderer.ts:139-166`; a character without a rig uses `char/<c>/<pose>`), `music` and `sound` give audio. Things the walk cannot see and must treat as always-needed: character `blip=` sounds, theme skins and fonts (CSS handles those lazily), `game.json` gallery/extras entries that name backgrounds, and a `show` with no pose (uses the rig defaults, so the default variants of every slot).

Feasibility: **good**. Roughly 150 to 250 lines for a pure function `assetsByLabel(program, rigs) -> Map<label, {images, audio}>` plus reachability (labels reachable from a label in N hops through jump/call/menu). The data is exact except `show` without explicit slot values (defaults) and persisted state, which we handle conservatively.

What it could drive:
1. **Boot set**: title screen state plus everything reachable from `start` within the first scene (or the first K ops / first label), preloaded behind a loading bar; the rest loads in the background.
2. **Prefetch**: when entering a label (or showing a menu), start loading the assets of the labels it can jump or call to, so they are ready by the time the player gets there.
3. **Unload**: drop textures and buffers no label reachable from the current position needs. Reachability collapses early in a linear game and stays wide in a branchy one, so unloading is the least valuable and riskiest part (see below).
4. **Loading screen**: a progress bar for the first scene, since the engine already knows its size.

## 4. Risks and constraints

- **Hot reload**: `load()` re-runs on each edit and then `runtime.restore(pos)` replays from the start in instant mode (`preview.ts:325-340`, `runtime.ts:143`). With demand loading, the restore target scene may use assets that are not loaded yet; the renderer must be able to wait for them (or draw the placeholder and refresh). In the editor, lazy loading is needed anyway, because the current load-everything on every change is a stale cache leak. The analysis has to be re-run on each recompile, which is cheap.
- **Replay and rollback**: `restore` and rollback replay from the start with `instant = true`; `sync(state)` then draws only the final `DisplayState`, so intermediate backgrounds are never drawn (good: they need not load). But `sync()` is synchronous (`Renderer.sync`, `types.ts:94`) and `bgTexture`/`look` read `this.art` synchronously (`pixi-renderer.ts:119,161`). Demand loading means either `sync` becomes async (it is called from many places) or the final-state assets are loaded first with `await` before the sync. A rollback to a much earlier scene whose assets were unloaded needs the same path.
- **Saves**: a save stores `DisplayState` (`bg`, `sprites`, `music`), so on load we know exactly what the screen needs; load before `sync`, then prefetch from the pc. Cheap. Old saves referencing missing assets already fall back to placeholders.
- **Audio**: `AudioSystem.music()` already awaits its buffer (`audio.ts:79`), so lazy-loading music is nearly free: just remove the eager decode. Sounds should be decoded on first need but the first play may lag; prefetching by label solves that. Decode on demand is the biggest win, since music is the largest memory item.
- **Skip/auto and fast-forward**: skip mode runs through lines quickly (`SKIP_MS = 45`); the prefetch must stay ahead of it, or `scene` must wait for the image (a short stall is better than a placeholder flash).
- **Placeholders**: missing art already draws generated placeholders, so loading failure degrades gracefully (`Promise.allSettled` today).
- **Memory budget**: unloading has to destroy textures the sprites still hold (`pixi-renderer.ts:161,327`) and not just drop the map entry; a texture in use on screen or in the shaker/tint layers must not be freed. The `Assets` cache and the renderer's `art` map must both release.
- **Low-end and desktop wrapper**: the memory table above is the real driver. A cheap LRU (keep the last N backgrounds and the characters currently on stage) captures most of the benefit without full route analysis.
- **Web**: lazy loads show up as network fetches during play; offline desktop builds have none of that latency, so the wrapper mostly needs the memory cap, not the prefetch.

## 5. Recommendation

Do **not** build the full optimizer yet; do the small version, in this order. It fixes the actual problems (time to the title and the audio memory) and makes the full thing an incremental step later if wanted.

1. **Stop eager audio** (small, about half a day). Remove `void this.buffer(url)` in `audio.ts:46`; decode on first use, plus `audio.prefetch(names)`. Biggest memory win for the least risk.
2. **Lazy images with a "required first" set** (medium, 1 to 2 days). Replace `preloadArt` with `ensure(keys): Promise<void>` that loads missing textures (de-duplicated through the `Assets` cache); `preload()` only loads the UI, the title screen and the first-scene set. Make `sync(state)` callers `await renderer.ensure(neededBy(state))` first (Runtime restore and load, `preview.ts`), and have the live `scene`/`show` path call it before drawing, with the placeholder as fallback. Keep the rig JSONs (tiny) loaded eagerly.
3. **Static asset-by-label table and prefetch** (medium, 2 to 3 days). `assetsByLabel` next to `checkAssets` in `engine/src/assets.ts` (shares its rig/pose logic; unit tests with `npm test`), then prefetch at label entry and menus, and a loading bar for the first scene. This is the "optimizer", sized as an analysis pass and not a framework.
4. **Optional later: unload** (1 to 2 days). Free what is neither on screen nor reachable (or an LRU with a memory budget), mainly for mobile and the desktop wrapper. Only worth doing once a real game has memory trouble; reachability goes wide quickly in branchy games.

Order: 1, 2, 3, then 4 if needed. Steps 1 and 2 alone remove the pre-title download of everything and most of the audio memory; step 3 removes the stalls. The full analyze-and-unload optimizer is the last and least valuable piece.

Caveats: measurements are from a synthetic project on localhost; GPU and audio memory are estimated from dimensions and sample rates, not read from the browser. No real network or low-end device was tried.
