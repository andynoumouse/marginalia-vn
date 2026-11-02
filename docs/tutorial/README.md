# Tutorial: make a visual novel with Marginalia VN Engine

This tutorial walks through `demo/` ("Rainy Day Library"), a small game that uses most of the engine.
Every snippet comes from its scripts, so you can open the file, run it and change it.

| Page | You learn |
|---|---|
| [The editor](00-the-editor.md) | a tour of the editor: live preview, Ctrl+P palette, variables, story outline, files, trash and git, refactoring |
| [1. Your first scene](01-first-scene.md) | project layout, running the editor, `scene`, `show`, narration and dialogue, `music` |
| [2. Choices and variables](02-choices-and-variables.md) | `menu`, `set`, `if`, `jump`, `input`, `[variables]` in text, lists, random |
| [3. Staging and effects](03-staging-and-effects.md) | `move`, `hop`, `shake`, `animate`, named positions, `tint`, `filter`, `camera`, `flash`, weather, sound, text tags |
| [4. Screens and memory](04-screens-and-memory.md) | clickable map, scrolling grid, HUD, `call` with parameters, timed menus, `unlock`, `persistent`, gallery and chapters, endings and achievements, a custom pause menu |

Planned: the PSD art pipeline, localization, and exporting for the web. The demo's art is placeholder shapes for now,
so the screenshots show those. The full command list is in [../commands.md](../commands.md), `game.json` is in [../game-json.md](../game-json.md).

## Set up

```bash
cd demo
npm install
npm run dev
```

Open http://localhost:5173/editor/. The script is on the left and the running game on the right. Saving a script
reloads the game and returns to the line you were on.
