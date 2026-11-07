# Marginalia VN Engine: notes for Claude

TypeScript visual novel engine (script language, Monaco editor with live preview, PSD art pipeline, web export).
README.md describes the features; `docs/commands.md` is the script command reference; `TODO.md` is the backlog.

## Workflow

- `npm test` runs `tsc` and then the fast set (everything but `browser.test.mjs`, a few seconds); `npm run test:browser`
  runs only the browser file (~30 s) and `npm run test:all` both (`scripts/test.mjs`). `npm run test:dock` runs `dock-ui.test.mjs` (the docking layer on its own sandbox page, ~5 s, a browser; in neither the fast nor browser set). `npm run test:studio` runs
  `studio.test.mjs` (Marginalia Studio in Electron, ~15 s); it is in neither set, so run it after changing `studio/`. The browser set is costly: don't
  run it unless the user asks. For a change to `preview/`, `editor/` or the renderer, run `node scripts/browser-gate.mjs`
  once per such change; it keeps a counter in `.claude/browser-test-counter` and prints RUN on every 5th call (then run
  `npm run test:browser`) or SKIP (then don't, and say in the wrap-up that the browser set was skipped).
  Tests import from `dist/`, so a stale build gives misleading results.
  The browser run serves a temp copy of `dist/`, so `tsc` during it is safe (it only uses the build as of its start).
- Browser tests run `VN_BROWSER_JOBS` at a time (default 6, ~32 s; `VN_BROWSER_JOBS=1`
  runs them in order, ~150 s, to tell a real failure from a load flake). Each test needs its own context and must not write to the sample project (mock `/api/...` routes instead).
- `engine/test/browser.test.mjs` plays the sample in a real browser (system Edge/Chrome through playwright-core; skipped
  when none is found, `VN_BROWSER=<exe>` overrides). It starts its own dev server on a free port.
- A fresh git worktree (`.claude/worktrees/...`) has no `node_modules`. Run `npm install` there before `npm test`, or
  the browser tests have no PixiJS/Monaco to serve (node still finds `playwright-core` in the parent folder, so they
  don't skip). `browser.test.mjs` now fails at once with that message instead of timing out test by test.
- Start the dev server with the preview tools (`vn-dev` in `.claude/launch.json`), not Bash. Engine, editor and
  preview code rebuild and reload by themselves; restart it after editing `preview/dev-server.mjs`.
- Preview servers count against a per-folder limit (5) shared by all chats. Stop the one you started
  (`preview_stop`) when your task is done, and don't leave servers running for finished chats.
- To see a script change rendered, temporarily patch `games/sample/script/park.vn`, screenshot it with a throwaway
  playwright script (dev server with `--no-build --no-art` on your own port; two Space presses, with a wait, get past
  the first line), then `git checkout` the sample. The renderer exposes no handle to the pixi scene, so browser tests
  can't assert on sprite bounds without adding a debug hook first.
- Never kill node processes broadly: the dev server and the tsc watcher are node processes too.
- `games/demo/` is a second game project (Iris, the Studio's "Open the Demo"); the online demo's code is `online/`
  (docs/online.md). After changing `online/`, the editor's URLs or `/api` routes, check it with `npm run build:online`
  and the `vn-online` preview (http://localhost:5180/marginalia-vn/); `online.test.mjs` covers the routes in node.
  Editor and preview URLs stay relative (`../assets/`, `../docs/`): the demo serves them under `p/<id>/`.
- After adding or editing script lines run `npm run ids`, then `npm run strings`. The resulting changes to
  `games/sample/locale/en.json` and the scripts are expected.
- Commit only when asked.

## Branches and releases

- `dev` is the working branch: commit there (when asked), as small as you like. `main` tracks `origin/main` (GitHub,
  `andynoumouse/marginalia-vn`) and holds one squashed commit per release. `legacy` is the old private history; none of
  `dev` or `legacy` is ever pushed. Never force-push `main`. Push only when the user asks.
- Release when a milestone is done (a feature set, a tutorial chapter, a fix people want), not per change:
  1. On `dev`: `npm test` is green, `npm run test:browser` has run since the last release, `package.json` version bumped,
     README/docs match, `TODO.md` updated.
  2. `git switch main && git merge --squash dev`, then commit with a changelog-style message (what is new and fixed).
  3. `node scripts/sanitize-check.mjs` (local paths, personal email, tokens) must be clean.
  4. `git tag -a vX.Y.Z -m "..."`, then `git push origin main vX.Y.Z` (and `git lfs push --all origin main` when
     `games/sample/masters/` changed).
  5. `git switch dev && git merge main -s ours -m "Sync release vX.Y.Z"`, so the next squash holds only new work.
- Docs meant for public readers must not read as notes to Claude ("for a fresh session"), and must not cite commit hashes.

## Architecture

- `engine/src` has no DOM and runs in node. Put new logic there as pure functions with a test in
  `engine/test/`; the editor (`editor/`) and game shell (`preview/`) stay thin.
- All scripts in `script/` compile together: labels are global and `games/sample/script/park.vn` owns `start`. Other
  sample scripts (`demo.vn`) are entered with Preview from cursor. Tests hard-code park.vn's choice order, so
  don't reshuffle it.
- Adding a script command touches: `parser.ts`, `types.ts`, `runtime.ts` (and `compile.ts` if it has
  strings or targets), `editor-support.ts` (completions), `docs/commands.md`, the syntax block in the README,
  and a test. A new `SpriteState` field also needs the whole-state `deepEqual`s in `engine.test.mjs` and
  `assets.test.mjs` and the state built in `preview/studio.ts`.
- The F1 help is built from `docs/commands.md` headings (`engine/src/help.ts`): `### a / b` makes topics `a`
  and `b`, and the lookup uses the first word of the line. Rename those headings with care.
- Localizable strings (dialogue, menu options, `input` prompts) carry ids like `#ab12`; new string-bearing
  statements need support in `ids.ts` and `compile.ts` (`registerString`).

## Conventions

- `.gitattributes` forces LF; some working copies are CRLF, so git's CRLF warnings are harmless.
- `TODO.md` legend: `[ ]` open, `[~]` partly done, `[-]` deferred. When you finish a task, delete its item in the same
  change (no `[x]`); when you finish part of one, rewrite it to say only what is left. Don't add duplicates. Deliberately deferred: asset unloading (step 4) and verifying asset loading on real
  networks/devices. Don't start those unprompted.
- When editing regexes with backslashes, use the Edit tool; shell heredocs and template strings mangle them.
- `assignIds` grows ids past 4 characters when it keeps hitting taken ones, so a stuck `rng` no longer hangs it (still use a varying one in tests).
- A synchronous infinite loop is not stopped by `node --test --test-timeout`. Run a new test file alone under a limit first:
  `timeout 60 node --test engine/test/<file>.test.mjs` (`--test-name-pattern` narrows it to find the culprit).
