# Design notes: Marginalia Studio (the editor as a desktop app)

A plan, not a description of something built. The goal is that an author downloads one app and writes a game, with no
Node.js, npm, TypeScript or git on their machine. Code signing is left out for now: unsigned builds show Windows
SmartScreen's "More info → Run anyway", and the README says so.

## Shape

- The Studio is an Electron app whose `resources/app` holds the engine as it is today (`dist/`, `editor/`, `preview/`,
  `docs/`, `tools/`, `bin/`) plus the browser builds of Monaco and PixiJS and the ag-psd package.
- Its main process does three things: shows the projects screen, starts one **dev server child per open project**, and
  opens `/editor/` from that server in its window. Everything the editor does today keeps going through the dev server's
  `/api/...` routes; only things a web page cannot do (pick a folder, remember recent projects) go through a small preload
  bridge.
- The CLI (`vn ...` with Node and npm) keeps working as now. The Studio and the CLI share every file-writing step through
  engine functions, so a project made in one opens in the other.

Why a child process instead of loading the server into the main process: the server fixes its project at start
(`projectRoot()`, the watchers, `childEnv`, the PSD watcher). Making all of that switchable touches most of
`preview/dev-server.mjs`; killing a child and starting another touches none of it, and a crash in the server cannot take
the window down.

## What changes, by area

### 1. Running without Node (`ELECTRON_RUN_AS_NODE`)

Every child process is started with `process.execPath`: the dev server's tasks (`runTask`), the PSD watcher, the export's
`run()`, and `bin/vn.mjs`. Inside the Studio that path is the Studio exe, which without `ELECTRON_RUN_AS_NODE=1` opens a
second Studio window. The main process sets it in the env of the server child; all of the above inherit it (`childEnv`,
`process.env`), so no call site changes. A test checks that a task run from the Studio exits with output and no new window.

### 2. A prebuilt engine (no tsc)

The dev server builds with tsc unless `--no-build` is given, and `tools/export-web.mjs` resolves `typescript` with no
fallback, so an export from the Studio would crash. Change both to: build when TypeScript is installed, otherwise use the
`dist/` that is there (and fail clearly when there is none). The CLI keeps its behaviour in the repo; the Studio needs no
flag.

### 3. Origin, port and saved state

The editor keeps the sidebar state and recent commands in `localStorage`, and the preview keeps saves, settings and
read-text there (`preview/storage.ts`, namespaced by game id). Chromium keeps `localStorage` per origin, port included, so
a different port each launch would lose all of it.

- The Studio uses a **fixed port** (stored in its settings; first choice 5173, else the first free one, then kept), so
  the origin stays the same across launches and projects.
- Preview state is already per game id, so two projects do not share saves. Two projects with the same `id` would; the
  projects screen warns when opening a project whose id matches another recent one.
- A custom `studio://` protocol would avoid ports altogether, but `isLocalHost` / `isOwnOrigin`
  (`engine/src/request-guard.ts`) and every `postMessage(..., location.origin)` assume `http://localhost`. Not worth it
  until the fixed port causes trouble.

### 4. Window behaviour

- `window.open` (asset viewer "Open in tab", "Open Exported Game", the Build dialog's link): `setWindowOpenHandler`
  opens the Studio's own URLs in a child window and anything else with `shell.openExternal`. Navigation away from the
  server's origin is refused (`will-navigate`).
- Downloads (translation and recording-script CSVs): a `will-download` handler shows a save dialog defaulting to the
  project folder.
- **Unsaved edits on close.** The editor has no `beforeunload` guard; closing a tab was cheap, closing the Studio is not.
  Add the guard in the editor (it helps the browser too), and have the main process ask before closing or switching
  project while a tab is dirty.
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` for the editor window; the preview iframe gets
  nothing from the preload.
- An application menu with the usual Edit entries (so Ctrl+C/V work on macOS) and View → Reload / Toggle DevTools.

### 5. Projects screen

A local page served by the main process (not the dev server, which needs a project to start). Recent projects live in
the app's user data as JSON: folder, title (from game.json), engine version, last opened. A folder that no longer exists
stays in the list, marked missing, until removed. Actions: Open folder (native picker), New project, Remove from list,
Reveal in file manager. Opening one starts the server child on it and loads `/editor/`; a File → Switch Project item
comes back here.

As built (step 3): `studio/projects.html` is loaded from disk (`loadFile`), and its calls go through the preload
to `ipcMain` handlers that refuse any other page. The list file is `recent-projects.json` in the user data; its pure
parts (`touchRecent`, `sharedGameId`, `changesSince`, `withEngineVersion`) are in `engine/src/studio-projects.ts`.
Switch Project loads the projects page first, so the editor's unsaved-edits guard can keep the project open, and stops
the server only once the editor is gone; the next server waits for the same port.

### 6. New project

`vn init` writes its file set in `bin/vn.mjs`. Move that into a pure engine function
(`newProjectFiles({ title, stage, kind: 'npm' | 'studio' }) → { path: content }`) with a test; `vn init` and the Studio
both write its result. The Studio kind leaves out `package.json`, the `file:` engine link and the npm part of the README.
Optional `git init` with the LFS attributes for `masters/` when git is on the PATH; without git the option is greyed out
with a note, not an error.

### 7. Engine version per project

`checkEngineVersion` only prints a warning. Make it return `{ wanted, have, status: 'ok' | 'newer-game' | 'older-game' }`
and show it: on the projects screen (a mark on the row), and as a notice when opening. A newer game than the Studio says
"made with a newer Studio, update before editing"; an older one says what changed (from a short per-minor changelog kept
in the engine) and offers to bump `engine` in game.json. A project that also has the npm setup keeps it; the Studio says
it uses its own engine.

### 8. Paths

`findProject` falls back to the current folder and then the sample; in the Studio the current folder is usually the
install folder. The Studio always sets `VN_PROJECT`, and never writes inside its own install folder (read-only under
Program Files). The bundled demo opens from a copy in the user's documents ("Open the demo" makes the copy once), so the
tutorial works from the Studio too. The copy goes to `Documents/Marginalia Studio/<demo title>` without the demo's
`package.json` (an npm link to the engine repo), with game.json's `engine` set to the Studio's.

### 9. Git

Already copes: `/api/git` reports `git: false` when git is missing and the dialog says so. Nothing to bundle.

### 10. Packaging

- `asar: false` (or the whole engine unpacked): the server spawns with `cwd` inside the app folder, serves files from
  disk and watches `dist/`, none of which work inside an asar archive.
- Monaco, PixiJS and ag-psd move to `dependencies`. Ship only what is served or imported: `monaco-editor/min`
  (~14 MB), the PixiJS files the preview imports (the whole `pixi.js/dist` is ~54 MB), and ag-psd's runtime files.
  playwright-core and TypeScript stay dev-only.
- The Studio has the engine's version number (one release carries both), and `npm run package:studio` writes it to
  `release/Marginalia Studio-<version>-<platform>-<arch>/` and a zip next to it. The folder is Electron's runtime with
  the exe renamed and no `default_app.asar`; `resources/app` has its own `package.json` (`"type": "module"`, `main:
  studio/main.cjs`), the prebuilt `dist/` (JavaScript only), `studio/`, `editor/`, `preview/`, `tools/`, `bin/`, the
  public `docs/` (not `design/`), the demo, and `node_modules` with only `monaco-editor/min`, `pixi.js/dist/pixi.min.mjs`,
  ag-psd's CommonJS `dist/` (without the browser bundle and canvas helpers) and its dependencies base64-js and pako.
- Chromium's `locales/` keeps only `en-US.pak` (the others are 49 MB; the Studio's UI is English and Chromium falls back
  to en-US for any other system language). The licence files (`LICENSE`, `LICENSES.chromium.html`) stay.
- Size (Electron 45, engine 0.2.1): 329 MB unpacked (Electron 308 MB, the app 21 MB), a 147 MB zip. The zip is made
  with Windows' own `tar.exe` (bsdtar); a GNU tar from Git earlier on `PATH` cannot write zips.
- First release form: a portable zip (unzip, run `Marginalia Studio.exe`). An installer (electron-builder, NSIS) comes
  after, with the Windows-only verification that the game export already has.

### 11. Desktop export from the Studio

`vn export --desktop` writes an npm folder that downloads Electron. From the Studio, `vn export --desktop --portable`
(the Build dialog's "Desktop app" target, offered only inside the Studio) copies the runtime the export runs under: the
Studio starts tasks with its own exe as node, so that is `path.dirname(process.execPath)` when `process.versions.electron`
is set. It copies that folder without `resources/app`, `resources/app.asar`, `default_app.asar` and the locales other than
en-US (`keepRuntimeFile` in `engine/src/portable-app.ts`, which `package-studio.mjs` uses too), puts the exported game
(`main.cjs`, `preload.cjs`, `save-files.cjs`, the pak, `config.json`, `package.json`, `dist/`, `index.html`, `vendor/`) in
`resources/app`, renames the exe to the game's title (`safeFileName`), and zips it next to the folder
(`tools/zip-folder.mjs`, the same bsdtar call as the Studio's packaging): `build/portable/<title>-win-x64/` and
`<title>-win-x64.zip`. The demo: 311 MB unpacked, a 140 MB zip, about 12 s. The game then runs on the Studio's Electron
version, so a Studio update changes the runtime of the next export, which is the same as an engine update does today.
The npm folder export stays available (CLI and dialog) for authors who want electron-builder installers.

On Windows the renamed exe then gets the game's icon and version info (`tools/exe-info.mjs`, with resedit: pure JavaScript, so
the Studio ships no rcedit exe; @electron/packager uses the same library, but it would also need an Electron zip and 17 more
packages).

## Order of work

Each step is usable on its own and keeps the CLI working.

1. **Engine preparation** (no Electron): prebuilt mode for the server and export (2), `newProjectFiles` (6),
   `checkEngineVersion` returning a result (7), the editor's unsaved-edits guard (4). Node tests for each.
2. **Studio shell**: `studio/main.cjs` and a preload; the server child with `ELECTRON_RUN_AS_NODE` and a fixed port
   (1, 3); window, download and navigation handlers (4). Runs from the repo with `npx electron studio` for now.
3. **Projects screen and New project** (5, 6, 7, 8).
4. **Packaging**: trimmed vendor files and a portable zip (10).
5. **Desktop export from the Studio's runtime** (11).

## Testing

- The editor and preview pages are the same ones `engine/test/browser.test.mjs` already drives; they are not tested a
  second time inside the Studio.
- `engine/test/studio.test.mjs` uses playwright-core's Electron launcher (`_electron.launch`) against `studio/main.cjs`
  from the repo, or against a packaged exe given by `VN_STUDIO=<exe>`. It covers: the projects screen, opening a project
  and switching to another (the old server and its PSD watcher are gone afterwards), a task running without a second
  window, `window.open` and downloads going through the handlers, `localStorage` surviving a restart, a project without
  git. Native dialogs are behind the preload and replaced in tests (`VN_STUDIO_TEST_PICK=<folder>`), and `VN_STUDIO_DOCUMENTS` /
  `VN_STUDIO_USER_DATA` keep the demo copy, settings and recent list in a temp folder. Projects are temp
  copies of the demo; nothing writes to `sample/` or `demo/`.
- It runs as `npm run test:studio`, not in `npm test`, and before a release that changes the Studio. Before a release
  it also runs against the package, once as is and once with only System32 on `PATH` (no node, no git; the git test
  then skips and the no-git test sees New Project's git option greyed out):
  `VN_STUDIO="release/Marginalia Studio-<version>-win-x64/Marginalia Studio.exe" node --test engine/test/studio.test.mjs`,
  with node started by its full path for the second run. The first test checks that the app path is the package's
  `resources/app`.
- By hand, per release: the zip on a clean Windows (Windows Sandbox), and the installer once it exists.

## Open questions

- Updating the Studio: a "new version available" check against GitHub releases, or nothing at first.
- macOS and Linux builds: same deferral as the game export's installers.
- Whether the Studio should also offer a `vn` command line (Electron as node with `bin/vn.mjs`) for people who script
  their builds.
