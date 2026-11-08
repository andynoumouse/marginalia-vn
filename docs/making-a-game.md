# Making a game

Real games live in their own folders and repositories and use the engine as a package. Needs Node.js 22 or newer
(or use [Marginalia Studio](studio.md), which needs neither Node.js nor git).

## Start a project

```
node path/to/marginalia-vn/bin/vn.mjs init ../MyGame --title "My Game"
cd ../MyGame
npm install          # links the engine: "marginalia-vn": "file:../marginalia-vn" in package.json
npm run dev          # the editor and preview, on this project
```

Options for `init`:

- `--stage 1080x1920` starts a project with another stage size (portrait here; the default is 1920x1080).
- `--template <name>` starts from a template with the `game.json` options and first script of that style: `blank`
  (the default), `classic-adv`, `portrait`, `kinetic-nvl`, `branching` or `mystery`. Marginalia Studio's New project
  dialog has the same list. See [tutorial/deeper/a-templates.md](tutorial/deeper/a-templates.md) for what each one brings.

## The project folder

The game folder holds only content:

| Path | Holds |
|---|---|
| `game.json` | Menus, theme, gallery and other options ([game-json.md](game-json.md)) |
| `script/` | The `.vn` scripts |
| `locale/` | Translations, one `<lang>.json` each |
| `assets/` | Game-ready art and audio |
| `masters/` | PSD masters (Git LFS) |
| `build/` | Export output (git-ignored) |

Its npm scripts call the `vn` command (`vn dev | export | art | ids | strings`), which runs the engine's tools on the
current folder. `vn character` needs no project: it serves only the [character studio](standalone-studio.md).

## Engine versions

Because the dependency is a link, not a copy, engine changes apply to the game right away; restart `npm run dev`
after pulling engine changes. To freeze the engine for a release, point the dependency at a tag
(`"marginalia-vn": "git+file:../marginalia-vn#v0.4.0"`) and update it on purpose. `"engine": "0.1"` in `game.json`
makes the tools warn when the engine is older than the game expects.

## npm scripts (engine repo)

These run on the sample game in `games/sample/`.

```
npm install
npm run dev          # builds, watches, serves http://localhost:5173 (editor: /editor/)
npm test             # type-check and engine and shell tests (node:test, no browser needed)
npm run test:browser # the browser tests (system Edge/Chrome); test:all runs both
npm run test:dock    # the docking layer on its own sandbox page (a browser)
npm run studio       # the editor as a desktop app (Marginalia Studio, early): projects screen, or -- --project <folder>
npm run test:studio  # the Studio tests (Electron)
npm run package:studio # the portable Studio in release/ (a folder and a zip)
npm run ids          # add localization ids (#abcd) to new dialogue/menu lines
npm run strings      # export locale/<source language>.json (en by default), report gaps in other languages
npm run playtest     # play every route: unreachable lines, endings, unused assets and variables
npm run stats        # words, lines and reading time per script, label and character
npm run art          # convert changed PSDs in masters/ to assets/ (--force: all; npm run dev also watches)
npm run export       # static web build in games/sample/build/web (upload it, or zip it for itch.io)
```

Edit `games/sample/script/park.vn` while the preview is open: it reloads and returns to the line you were on.
Editing engine code (`engine/src`, `preview/`, `editor/`) rebuilds and reloads the page automatically.
