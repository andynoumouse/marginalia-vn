# Desktop build

`vn export --desktop` writes an Electron app folder (default `build/desktop` in the project) that plays the game in
its own window, keeps saves as files and hides the assets. The engine does not depend on Electron (only the
Studio's dev dependency does): the generated folder installs its own copy.

```
npm run export -- --desktop      # or: vn export --desktop [--out build/desktop]
cd build/desktop
npm install
npm start                        # run it (the first run downloads Electron itself, about 115 MB)
npm run dist                     # installer for the platform you are on, in build/desktop/release
```

The folder's own `dist/` holds the game's engine code; the installer goes to `release/` so it does not mix with it.

## From Marginalia Studio: ready to run, no npm

In the Studio, the Build dialog's **Desktop app (ready to run, zipped)** target (`vn export --desktop --portable`, which
only works inside the Studio) builds the same app on the Studio's own Electron runtime, so nothing is downloaded:

```
build/portable/
  My Game-win-x64/          the runtime, with My Game.exe and the game in resources/app
  My Game-win-x64.zip       the folder zipped: share this
```

Players unzip it anywhere and run `My Game.exe`. The exe name comes from the game's title (characters Windows does not
allow in file names are dropped). The demo comes to about 311 MB unpacked and a 140 MB zip, nearly all of it Electron;
like the Studio, it keeps only Chromium's en-US locale. The game runs on the Electron version of the Studio that
exported it, so a Studio update changes the runtime of the next export.

On Windows the exe carries the game's own icon (game.json `icon`) and version info: the title as product name and
description, game.json `version` as file and product version (padded to four parts, `1.0.0.0` when unset), and none of
Electron's company or copyright strings. Without an `icon` it keeps Electron's icon. It is not code-signed, so Windows
SmartScreen may stop the first start ("More info", then "Run anyway"). For an installer, use the npm folder above
(`npm run dist`). Explorer caches icons, so a re-exported exe in the same place can show the old one for a while.

`npm run dist` uses electron-builder with a Windows (NSIS), Linux (AppImage) and macOS (dmg) target; an installer is
built on the platform it is for (a macOS dmg needs a Mac). The export sets the package's version from game.json `version`
and, with an `icon`, points electron-builder at `icon.png` (a macOS icon wants 512x512 or more). Other build options (app id,
signing) go in the `build` section of the generated `package.json`, which is rewritten by every export, so set them in a
copy or a CI script.

## The game's icon

game.json `"icon": "app_icon"` names `assets/ui/app_icon.png`: a square PNG, 256x256 or larger (the build checks warn
about anything else). It becomes the exe's icon (above), the desktop window's icon and the web build's favicon
(`icon.png` next to `index.html`). In the desktop app that copy is a loose file outside the pak, readable by anyone, so
use an image meant to be seen as the icon, not a piece of hidden art.

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
  `~/Library/Application Support/<app name>/saves`, Linux `~/.config/<app name>/saves`). Files are written to a temp file and
  renamed, so a crash cannot leave half a save. Delete the folder to reset a player. Code: `preview/storage.ts`
  (backend), `tools/desktop/` (`preload.cjs`, `save-files.cjs`, `main.cjs`).

Saves from the web build are not migrated.

## Not done

- Modifier scripts that override variables.
- Verified only on Windows so far. Nothing in the code is Windows-specific; the ready-to-run app is built for Windows
  and Linux only (macOS needs an .app bundle).
- The exe's icon is one 256 px PNG image that Windows scales down for small views; there are no hand-made 16/32/48 px
  sizes. A Linux ready-to-run app gets only the window icon.
