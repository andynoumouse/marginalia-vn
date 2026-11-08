# Exporting the game

## Web build

```
npm run export
```

This builds the code, converts changed art, runs the pre-build checks and writes `build/web/`: `index.html`, the
engine and game shell, PixiJS, the assets and a `project.json`. There is no dev bar, editor or live reload. All URLs
are relative, so the build runs from any folder:

- Upload it to a static host, or
- zip the folder's contents for itch.io (HTML project, `index.html` at the root).

Browsers do not run it from `file://`; serve it, for example with `npx serve build/web`. From the editor, the Build
dialog does the same (see [editor.md](editor.md#build)).

### Pre-build checks

Script errors refuse the export. Untranslated or reworded lines, missing ids and recordings are listed as warnings.

| Option | Effect |
|---|---|
| `--strict` | Refuse the export on warnings too |
| `--check` | Only print the report, build nothing |
| `--locales fi,ja` | Ship only these translations. The other languages are not checked |
| `--voice en,ja` | Ship only these voice languages. Name the source language for the default takes |

The Build dialog has a tick for each language. `build.checks` in `game.json` sets each check's level; see
[game-json.md](game-json.md). Art and audio checks are described in [checks-and-tools.md](checks-and-tools.md).

### What is in the build

The scripts are compiled at export: `project.json` holds the compiled program (as JSON, with the preloads worked
out) instead of the `.vn` text, so the game starts without parsing and your script files are not shipped. This is
not encryption; the dialogue is still readable in `project.json`.

Each translation is its own `locale/<lang>.json`, fetched only when the player picks that language (the source
language needs no file). A game exported by another engine version refuses to start and asks for a new export.

### Errors in an exported game

When the story stops on an error (a bad expression, a failing renderer call), the player sees an error screen
instead of a frozen stage. It shows a short message, **Return to title**, and **Copy report**. The report holds the
game and engine version, the script `file:line`, the error, the last lines shown and the start of the stack trace
(`engine/src/crash.ts`), for the player to send you. Its texts are `ui.crash_*` strings, translated like the other
menu labels. The dev preview leaves such errors to the browser console.

### Installable offline app

Set `"pwa": true` in game.json (see [game-json.md](game-json.md#pwa)) and the export also writes `manifest.webmanifest` and `sw.js`. Players
can then install the game from the browser (Add to Home Screen on a phone) and play it offline after the first visit. It needs the
folder served over https, or from localhost.

## Desktop build

```
npm run export -- --desktop
```

writes an Electron app folder with packed, scrambled assets and saves stored as files; see
[desktop.md](desktop.md). From Marginalia Studio the same app comes ready to run and zipped, with no npm
([studio.md](studio.md)).

## Saves and game id

Saves, settings and read-text tracking are stored per game under the game's id (`"id"` in `game.json`, else a slug
of the title), so games on one site (itch.io serves all HTML games from one origin) don't collide. Changing the id
or title starts with fresh saves.
