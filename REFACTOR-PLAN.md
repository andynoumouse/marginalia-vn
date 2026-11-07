# Code-pattern audit: ranked fix plan

Seven read-only passes over `engine/src`, `editor/`, `preview/`, `studio/`, `online/` and `scripts/`.
Items marked **(verified)** were re-checked against the code by hand; the rest are the audit agents' findings,
shown with file:line, and need a look before each fix. Phase 1 is mostly in (commits ef3b4fd, dc8836f, 1504307 and later); the table lists only what is left.

Rules for every step: one small change, `npm test` green, `npm run ids`/`strings` untouched unless scripts change.
`preview/`, `editor/` and renderer changes go through `node scripts/browser-gate.mjs`.

## Phase 1: real bugs (done)

All fourteen items are fixed.

## Phase 2: cheap hygiene (mostly done: unused exports, `util.ts`, `isClickable`, `saveBody`, `parseLevel`/`parseOnOff`, test.mjs header)

1. Shared `walkNodes` is in (`screens.ts`, four plain walks use it); the walks that carry scope or loop state (compile, screen-validate, static-use `walk` with `local`, the `assets.ts` lists walk) stay as they are.
2. Un-export file-local helpers (about 25 functions, about 90 types); cosmetic, do last or skip.

## Phase 3: make the compiler enforce lists that are kept in sync by hand

1. `LASTING_EFFECTS` descriptors for tint/weather/filter (the three share a shape in the parser, `display-state.ts` and the renderer; the parser part is done with `parseLevel`). Left: decide whether the renderer side earns a table. The `studio:*` IPC channels turned out to be one (`studio:info`), so no table is needed there.

## Phase 4: types for units and meaning

Add branded or discriminated types where a mixup compiles today:
- Seconds vs ms (`Secs`/`Ms`) in renderer, audio, line-typer, achievements; start by renaming `sleep`/`later`/`step` params with unit suffixes.
- 1-based vs 0-based line numbers (`rigHelpTopicAt`).
- `hud` `keep` and `sound`/`music` fields as per-mode unions; `EaseName`, `SlideDir` for `scene dir`.

## Phase 5: god files

Done: `Runtime.loop`, `PixiRenderer.applyWorld` (one method per op; reveal shapes, shake and camera pivot are pure in `fx.ts`), `Studio.handle`, `registerLanguage`, `setupPalette`, `boot`, `preview.ts` `load`, the `AnimStudio` constructor's wiring.
Left, no function is over about 70 lines now, so splits are by responsibility and have no node tests (browser gate applies):
- `AnimStudio` (about 200 members): the constructor still builds every panel in order; `anim-layout`, `anim-stage-bridge`, `anim-bindings` could take the rest.
- `PixiRenderer` (about 105 members): `world-effects.ts` for the tween-driven world ops; the studio* methods into their own module.
- `Menus`, `StageRenderer`.

## Phase 6: test gaps (add before refactoring the matching code)


## Phase 7: testability of module state (only if wanted)

`createStorage(ns, backend)` plus choice slots in one store; `StageSize` instance instead of `export let W, H`; shell as `GameShell`; `EditorState` instance. Medium refactors with no user-visible payoff, so lowest priority.

## Not worth doing

- Comments are accurate; no commented-out code, TODO/FIXME or `@ts-ignore`.
- About 20 empty `catch` blocks guard `localStorage` and are fine.
- `random.ts` `let seeds` already has an injection seam.

## Deferred / needs a decision

- Hidden-iframe `requestAnimationFrame` stalls asset uploads (pixi-renderer.ts:141, up to 20 s); needs a repro first.
- Dev-server child processes (tsc watch) orphaned when the server dies; fixed mostly by phase 1 items 1-2.
