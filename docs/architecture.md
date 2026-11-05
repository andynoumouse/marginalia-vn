# Architecture and layout

## Layout

```
engine/src/   expr, text, parser, compile, runtime, locale, ids, assets, theme (game.json theme -> CSS)   (no DOM, runs anywhere)
engine/test/  node:test suite
preview/      dev-server.mjs (static + /api/project + live reload), index.html, preview.ts (game shell), saves.ts, blips.ts,
              stage-ui.ts (HTML text box, skip/auto), pixi-renderer.ts (world, WebGL), audio.ts (Web Audio),
              menus.ts (the menu stack and dialogs), settings.ts,
              storage.ts (per-game storage: browser or desktop files), input.ts (keyboard/gamepad navigation), timeline.ts (rollback history)
editor/       Monaco scene editor with the live preview beside it; palette.ts (Ctrl+P), help-dialog.ts (F1), asset-viewer.ts
tools/        paths.mjs (engine vs project folder), vn-tool.mjs (ids, strings), psd-convert.mjs (art pipeline),
              export-web.mjs, project-data.mjs
online/       the online demo: sw.ts (service worker: the dev server's API on IndexedDB), routes.ts, store.ts, projects.ts
bin/vn.mjs    the vn command
games/        the sample game (sample/) and the Iris demo (demo/), each: script/ (*.vn scenes), locale/ (<lang>.json), game.json (menus, theme, gallery),
              masters/ (big PSDs, Git LFS), assets/ (game-ready art and audio)
```

The engine core in `engine/src` has no DOM and runs in node; the editor and the game shell stay thin on top of it.

## Design notes

- **Runtime.** It is a deterministic state machine (pc, call stack, variables, display state). Hot reload replays in
  instant mode to the source line, then continues live.
- **Renderer.** `Renderer` (`engine/src/types.ts`) is the seam. The world (backgrounds, sprites, transitions, effects)
  is drawn with PixiJS and needs WebGL. Text and the screens (menus, quick menu, achievement toast) are HTML over the
  canvas (`stage-ui.ts`, `screen-ui.ts`).
- **Stage size.** The stage is 1920x1080 unless `game.json` sets `"stage": {"width", "height"}` (for example
  1080x1920 for a portrait game); see [game-json.md](game-json.md). The size is read from `game.json` on every run and
  is never stored in saves.
- **Art.** It reaches the Pixi renderer through `assets/`. Anything missing is drawn as a placeholder, and changed
  files hot-reload. See [art-pipeline.md](art-pipeline.md).

### Asset loading

Nothing is fetched at boot except the title screen's background and music.

- `attachPreloads` (`engine/src/assets.ts`) walks the story's control flow (jumps, calls with their returns, every
  menu option, both sides of an `if`) and attaches preload tasks to the program start and to every label, line, menu
  and input: the images and audio met within the next 40 lines, nearest first.
- The shell (`prefetch` in `stage-ui.ts`) loads them four at a time, so a scene's background and sprites are usually
  ready long before it is shown, and the first scene loads behind the title screen.
- A `scene`, `show` or `music` whose files are not ready yet holds until they are (a loading bar appears after a
  quarter of a second) instead of drawing a placeholder. Skipping cannot outrun this.
- Restoring a save, rolling back and hot reload load the final state's files before drawing it.
- Not seen by the walk, and loaded anyway: `blip=` samples and the default layers of a `show` without a pose. Gallery
  backgrounds are fetched by the gallery.
- Nothing is unloaded yet. The debug console's `memory` shows what is resident against a budget.

Details and measurements: [asset-loading.md](asset-loading.md).
