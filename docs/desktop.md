# Desktop build

`vn export --desktop` writes an Electron app folder (default `build/desktop` in the project) that plays the game in
its own window, keeps saves as files and hides the assets. The engine repo does not depend on Electron: the
generated folder installs its own copy.

```
npm run export -- --desktop      # or: vn export --desktop [--out build/desktop]
cd build/desktop
npm install
npm start                        # run it (the first run downloads Electron itself, about 115 MB)
npm run dist                     # installer for the platform you are on, in build/desktop/release
```

The folder's own `dist/` holds the game's engine code; the installer goes to `release/` so it does not mix with it.

`npm run dist` uses electron-builder with a Windows (NSIS), Linux (AppImage) and macOS (dmg) target; an installer is
built on the platform it is for (a macOS dmg needs a Mac). Build options (icon, app id, signing) go in the `build`
section of the generated `package.json`, which is rewritten by every export, so set them in a copy or a CI script.

## What it does

- **Same game, different shell.** The export runs the usual checks (build, art conversion, no script errors). The
  game is served from a private `vn://game/` address by `main.cjs`; there is no dev bar and no devtools (F11 toggles
  fullscreen).
- **Hidden assets.** Everything under `assets/` goes into one `assets.pak`, scrambled with a key made for each export
  and stored in `config.json` (format and code: `engine/src/pak.ts`). The game asks for `assets/...` as usual and the
  main process answers from the pak, including `Range` requests, so music can seek. The compiled story
  (`project.json`) and the translation tables (`locale/<lang>.json`) are packed too, so the story text is not
  readable on disk. `assets.pak`, `config.json` and the main process files are not reachable from the game.
  This is obfuscation: it keeps players from browsing or replacing files, not from someone who unpacks the app and
  reads the key.
- **Saves as files.** Saves, settings and read-text tracking use the same keys as the browser build, stored as one
  file per key in the app's user data folder under `saves/` (Windows `%APPDATA%/<app name>/saves`, macOS
  `~/Library/Application Support/<app name>`, Linux `~/.config/<app name>`). Files are written to a temp file and
  renamed, so a crash cannot leave half a save. Delete the folder to reset a player. Code: `preview/storage.ts`
  (backend), `tools/desktop/` (`preload.cjs`, `save-files.cjs`, `main.cjs`).

Saves from the web build are not migrated.

## Not done

- Modifier scripts that override variables (see TODO.md).
- Verified only on Windows so far. Nothing in the code is Windows-specific.
