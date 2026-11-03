# Starting from a template

A new project does not have to start empty. **New project** in Marginalia Studio, `vn init --template <id>` and the
online demo's template select all offer the same starting points. Each one is a small, working game in one style: it
plays to an ending, so you can run it, then change it into your own.

| Template | `--template` | What you get |
|---|---|---|
| Blank | `blank` (the default) | a title screen and one scene |
| Classic ADV | `classic-adv` | text box at the bottom, the speaker in focus, a quick menu, a choice that sets a variable, two endings |
| Portrait (phone) | `portrait` | a 1080 x 1920 stage, larger text, a short quick menu |
| Kinetic novel (NVL) | `kinetic-nvl` | full-screen pages, no choices, lines that go on by themselves |
| Branching story / dating sim | `branching` | affection variables with a status HUD, chapters, three endings as achievements and gallery pictures, a play counter |
| Mystery / adventure | `mystery` | a room with clickable hotspots, an inventory list and a locked door you open by using an item on it |

```bash
vn init ../MyGame --title "My Game" --template branching
```

## Choosing

- Pick the style closest to your story; the differences are mostly in `game.json` and the first script, so switching
  later is a matter of copying the options you want from [game.json](../game-json.md).
- `--stage 1080x1920` makes any template portrait, not only Portrait.
- A template brings placeholder title backgrounds and a few sounds. They are there to run the game: replace them under
  `assets/`.
- The first script has no string ids yet. Add them with `npm run ids` (or the editor's palette) before you translate the game.
- Classic ADV and Branching show flat silhouette sprites (`assets/char/mina/neutral.png`, `ren`) so the speaker focus
  has something to work on. Paint your own over them with the same file names, or add poses beside them and `show` those.
