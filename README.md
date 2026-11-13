# Marginalia VN Engine

- These couple of paragraphs are the only content I type manually in to this project
- Not yet stable. Subject to breaking changes.
- This is a very much vibe-coded project born out of frustration of having tried to work with some of the existing engines. This has been very much prompted up from the fundamentals, but no doubt the claude has borrowed many of the concepts and syntax from Renpy in particular. This has some opinionated workflows and is not yet fully finished or tested thoroughly. UX experience is not yet polished

--

TypeScript visual novel engine with its own script language, an editor with a hot-reloading live preview,
localization, a PSD art pipeline and a web export. The engine core has no dependencies; the preview uses
PixiJS, the editor Monaco and the art pipeline ag-psd (dev dependencies, no bundler).

**Try it in the browser:** [andynoumouse.github.io/marginalia-vn](https://andynoumouse.github.io/marginalia-vn/)
(the editor and the sample game, nothing to install; see [docs/online.md](docs/online.md)).

![The editor: the script on the left, the running game on the right](docs/tutorial/img/editor-hub.png)

**The editor is the main way to work.** Save a script and the game reloads on the line you were on, Ctrl+Enter plays from
any line, Ctrl+P jumps to files, labels and assets, and panels show your variables live and draw the story as a flowchart
([a tour with screenshots](docs/tutorial/deeper/h-editor-tour.md)).

## Features

- Own script language with characters, choices, variables, calls, screens, animation (including your own `transform` sequences), camera, weather, stacking screen filters, letterbox bars and text effects
- Editor with live preview, quick fixes, rename refactoring, flowchart outline, translations and voice dialogs
- Game shell: title screen, saves, rollback, history, skip/auto, gamepad support, options, gallery and extras
- Localization with stable string ids, plus voice lines per language
- PSD art pipeline: layered characters and backgrounds converted to game-ready assets
- Playtest bot that plays every route and reports dead ends, unreachable lines and unused assets
- Animation studio (Model and Animate modes: bones, parameters, keyforms, mesh warps, free meshes and bone-weighted skinning, masks, physics, automatic animations and reactions, a timeline, PNG-sequence movie export), also [on its own](docs/standalone-studio.md) on a character folder with no game
- Web export, plus a desktop build; Marginalia Studio as a desktop editor for Windows

## Quick start

Needs Node.js 22 or newer.

```
npm install
npm run dev          # builds, watches, serves http://localhost:5173 (editor: /editor/) for games/sample/
npm test             # engine and shell tests
```

Edit `games/sample/script/park.vn` while the preview is open: it reloads and returns to the line you were on.
Without Node.js, open the [online demo](https://andynoumouse.github.io/marginalia-vn/) in a browser ([what it can and
cannot do](docs/online.md)). [Marginalia Studio](docs/studio.md), the same editor as a Windows desktop app, is built from
this repository with `npm run package:studio`; no download is published yet.

Start your own game (from a clone of this repository with `npm install` run in it; the first `vn` command builds the engine):

```
node path/to/marginalia-vn/bin/vn.mjs init ../MyGame --title "My Game"
cd ../MyGame
npm install          # links the engine
npm run dev
```

With no `--template` you get **Blank**: one scene and one line. The [tutorial](docs/tutorial/README.md) starts from
`--template classic-adv`. Other options include `--stage 1080x1920` and `--template portrait|kinetic-nvl|branching|mystery`
([what each template brings](docs/tutorial/deeper/a-templates.md)). More in [Making a game](docs/making-a-game.md).

## Script at a glance

```
define alice "Alice" color=#ff6fa5      # a character
set trust = 0                           # top-level lines run once before the story starts
label start:                            # entry point
  scene bg_park fade 0.5s
  music play theme loop
  show alice smile at left fade 0.3s     # one or more looks, then slot=variant overrides
  alice: Hello, [name].{pause=0.4s}
  menu "Optional prompt line":
    "Be kind" if trust >= 0:
      set trust += 1
      jump other
    "Walk away":
      jump caught
  if trust >= 2:  ...  else:  ...
  call helper  /  return  /  jump label  /  end  /  end "The Quiet Ending"   # a named ending replaces "The End"
```

Every command is in the [command reference](docs/commands.md); [docs/script-syntax.md](docs/script-syntax.md) has a
longer cheat sheet.

## Documentation

| | |
|---|---|
| [Tutorial](docs/tutorial/README.md) | Make a small game from first scene to a build, then pick-and-mix pages (templates, staging, screens, layered art, localization, Ren'Py) |
| [Making a game](docs/making-a-game.md) | Project folder, `vn` commands, all npm scripts, pinning the engine version |
| [Script syntax](docs/script-syntax.md) / [Commands](docs/commands.md) | Cheat sheet and the full command reference |
| [The editor](docs/editor.md) | Files panel, palette, refactoring, outline, help, build dialog |
| [game.json](docs/game-json.md) | Every option for menus, title screen, gallery, build checks |
| [Game shell](docs/game-shell.md) | Title screen, saves, options, audio, voice, flags, gallery, randomness |
| [Look and feel](docs/look-and-feel.md) | Character styles, text sounds, themes |
| [Art pipeline](docs/art-pipeline.md) / [rig.json](docs/rig-json.md) | PSD masters to assets, layered characters |
| [Character studio on its own](docs/standalone-studio.md) | Animate a character from its folder, with no game project |
| [Checks and tools](docs/checks-and-tools.md) | Playtest bot, script statistics, art and audio checks |
| [Exporting](docs/exporting.md) / [Desktop](docs/desktop.md) | Web and desktop builds |
| [Marginalia Studio](docs/studio.md) / [Online demo](docs/online.md) | The desktop editor and the browser version |
| [Architecture](docs/architecture.md) / [Asset loading](docs/asset-loading.md) | Source layout and how the engine works |

## License

Code: [MIT](LICENSE). The sample game's art (`games/sample/assets`, `games/sample/masters`) was generated by Claude (Anthropic).
