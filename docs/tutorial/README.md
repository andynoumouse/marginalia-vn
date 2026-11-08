# Tutorial: make a visual novel with Marginalia VN Engine

You will make **The Last Train**, a short story about two strangers on a rainy platform, and finish with a game
someone else can play. The finished project is in `games/tutorial/`.

No programming experience is needed. You can follow the first five pages in Marginalia Studio, in the
[online demo](https://andynoumouse.github.io/marginalia-vn/) (everything except the last page's build), or with Node.js.

## Start here

Read these in order. Each takes 10 to 20 minutes and ends with something you can play.

| Page | You make |
|---|---|
| [1. Your first scene](01-first-scene.md) | a project from a template, a changed line, and the loop of type, save, see it |
| [2. A story with choices](02-a-story-with-choices.md) | a branching scene with a typed name, a variable and three endings, checked by the playtest bot |
| [3. Your own art and sound](03-your-own-art-and-sound.md) | your pictures, characters and music in place of the placeholders |
| [4. Make it feel like a game](04-make-it-a-game.md) | a title screen, achievements, a gallery picture and chapters |
| [5. Ship it](05-ship-it.md) | a web build to host, or a desktop zip to send |

## Go deeper

Read any of these, in any order, when you need them.

| Page | For |
|---|---|
| [A. Templates](deeper/a-templates.md) | the six project templates and what each brings |
| [B. Staging and effects](deeper/b-staging.md) | moving characters, camera, tint, weather, sound, text effects |
| [C. Screens and systems](deeper/c-screens.md) | a clickable map, a HUD, timed choices, persistent data, your own menus |
| [D. Layered characters](deeper/d-layered-characters.md) | PSD characters, looks, and the animation studio |
| [E. Localization and voice](deeper/e-localization-and-voice.md) | translating the game and recording lines |
| [F. Coming from Ren'Py](deeper/f-from-renpy.md) | statements side by side, and what has no equivalent |
| [G. Testing and quality](deeper/g-testing.md) | the playtest bot, statistics, checks, a release routine |
| [H. The editor tour](deeper/h-editor-tour.md) | every editor feature, with screenshots |

The full command list is in [../commands.md](../commands.md) and `game.json` is in [../game-json.md](../game-json.md).
Pages B, C and D quote the larger demo game in `games/demo/`, which opens on a feature index with a playable card for each
group of commands (`npm run dev -- --project games/demo`, then New game).

The snippets on pages 1 to 5 come from `games/tutorial/script/start.vn`, and a test keeps them in step with it.
