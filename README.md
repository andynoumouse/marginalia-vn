# Marginalia VN Engine (v0.8)

- These couple of paragraphs are the only content I type manually in to this project
- Not yet stable. Subject to breaking changes.
- This is a very much vibe-coded project over the current weekend (starting on 2026-10-31) born out of frustration of having tried to work with some of the existing engines. This has been very much prompted to alive from fundamentals, but no doubt the claude has borrowed many of the concepts and syntax from Renpy in particular. This project has specific workflows in mind and is not yet fully finished or tested thoroughly. UX experience is not expected to be particularly great from two days of development.

--

TypeScript visual novel engine with its own script language, an editor with a hot-reloading live preview,
localization, a PSD art pipeline and a web export. The engine core has no dependencies; the preview uses
PixiJS, the editor Monaco and the art pipeline ag-psd (dev dependencies, no bundler).

**Try it in the browser:** [andynoumouse.github.io/marginalia-vn](https://andynoumouse.github.io/marginalia-vn/)
(the editor and the sample game, nothing to install; see [docs/online.md](docs/online.md)).

![The editor: the script on the left, the running game on the right](docs/tutorial/img/editor-hub.png)

**The editor is the main way to work.** Save a script and the game reloads on the line you were on, Ctrl+Enter plays from
any line, Ctrl+P jumps to files, labels and assets, and panels show your variables live and draw the story as a flowchart
([a tour with screenshots](docs/tutorial/00-the-editor.md)).

## Features

- Own script language with characters, choices, variables, calls, screens, animation, camera, weather and text effects
- Editor with live preview, quick fixes, rename refactoring, flowchart outline, translations and voice dialogs
- Game shell: title screen, saves, rollback, history, skip/auto, gamepad support, options, gallery and extras
- Localization with stable string ids, plus voice lines per language
- PSD art pipeline: layered characters and backgrounds converted to game-ready assets
- Playtest bot that plays every route and reports dead ends, unreachable lines and unused assets
- Web export, plus a desktop build; Marginalia Studio as a desktop editor for Windows

## Quick start

Needs Node.js 22 or newer.

```
npm install
npm run dev          # builds, watches, serves http://localhost:5173 (editor: /editor/) for games/sample/
npm test             # engine and shell tests
```

Edit `games/sample/script/park.vn` while the preview is open: it reloads and returns to the line you were on.
Without Node.js, use the [online demo](docs/online.md) or [Marginalia Studio](docs/studio.md) (Windows).

Start your own game:

```
node path/to/marginalia-vn/bin/vn.mjs init ../MyGame --title "My Game"
cd ../MyGame
npm install          # links the engine
npm run dev
```

Options include `--stage 1080x1920` and `--template classic-adv|portrait|kinetic-nvl|branching|mystery`
([what each template brings](docs/tutorial/05-templates.md)). More in [Making a game](docs/making-a-game.md).

## Script at a glance

```
define alice "Alice" color=#ff6fa5      # a character
set trust = 0                           # top-level lines run once before the story starts
label start:                            # entry point
  scene bg_park fade 0.5
  music play theme loop
  show alice smile at left fade 0.3     # one or more looks, then slot=variant overrides
  alice: Hello, [name].{pause=0.4}
  menu "Optional prompt line":
    "Be kind" if trust >= 0:
      set trust += 1
      jump other
    "Walk away":
      jump caught
  if trust >= 2:  ...  else:  ...
  call helper  /  return  /  jump label  /  end
```

Every command is in the [command reference](docs/commands.md); [docs/script-syntax.md](docs/script-syntax.md) has a
longer cheat sheet.

## Documentation

| | |
|---|---|
| [Tutorial](docs/tutorial/README.md) | Step by step: the editor, a first scene, choices, staging, screens, templates |
| [Making a game](docs/making-a-game.md) | Project folder, `vn` commands, all npm scripts, pinning the engine version |
| [Script syntax](docs/script-syntax.md) / [Commands](docs/commands.md) | Cheat sheet and the full command reference |
| [The editor](docs/editor.md) | Files panel, palette, refactoring, outline, help, build dialog |
| [game.json](docs/game-json.md) | Every option for menus, title screen, gallery, build checks |
| [Game shell](docs/game-shell.md) | Title screen, saves, options, audio, voice, flags, gallery, randomness |
| [Look and feel](docs/look-and-feel.md) | Character styles, text sounds, themes |
| [Art pipeline](docs/art-pipeline.md) / [rig.json](docs/rig-json.md) | PSD masters to assets, layered characters |
| [Checks and tools](docs/checks-and-tools.md) | Playtest bot, script statistics, art and audio checks |
| [Exporting](docs/exporting.md) / [Desktop](docs/desktop.md) | Web and desktop builds |
| [Marginalia Studio](docs/studio.md) / [Online demo](docs/online.md) | The desktop editor and the browser version |
| [Architecture](docs/architecture.md) / [Asset loading](docs/asset-loading.md) | Source layout and how the engine works |

## License

Code: [MIT](LICENSE). The sample game's art (`games/games/sample/assets`, `games/games/sample/masters`) was generated by Claude (Anthropic).
