# The character studio on its own

The animation studio ([rig-json.md](rig-json.md#the-studio)) also runs without a game: open the folder of one character, work in
**Model** and **Animate**, save, and export a movie. Nothing in it needs scripts, `game.json` or a project; it is for people who make
the characters and animations and never touch the game side.

## Opening it

- **Marginalia Studio:** on the projects screen press **Open Character...** and pick the character's folder. The window shows the
  studio; **File > Switch Project...** goes back to the projects screen.
- **In a browser:** run `vn character` (`node bin/vn.mjs character` in the engine repo; it needs no project) and open
  <http://localhost:5173/editor/studio.html>. `vn dev` serves the same page too, next to the editor and the preview. The page needs a
  Chromium-based browser (Chrome, Edge): it reads and writes the folder through the File System Access API, and asks once for the
  permission. Other browsers show a note instead of the button.

Both give the same page: press **Open character folder...** (in the Studio the folder dialog came first) and pick the folder.

## What the folder holds

A character folder is what [`assets/char/<name>/`](art-pipeline.md) is in a game project:

- **The PSD converter's output**: `sprite.json` and the part images (`body.png`, `eyes/open.png`, ...), usually with a `rig.json` beside
  them. Without a `rig.json` the studio starts from a generated skeleton (the part order and a bone for each PSD folder) and **Save**
  creates the file.
- **One image per pose** (`default.png`, `smile.png`, ...), with or without a `rig.json`: a *flat* character. There are no parts to pose;
  animations move the whole picture. The stage draws `default.png`, else `neutral.png`, else the first image by name.

The folder may also be a game project, or its `assets/char/` folder, holding several characters: the page then lists them and you
pick one. The character's name is its folder's name (anything but letters, digits, `_` and `-` becomes `_`).

The folder's name and files are the only thing read: the page opens `sprite.json`, `rig.json` and the images, and ignores the rest
(a PSD or notes beside them are not read). Hidden folders such as `.git` and `node_modules` are skipped.

## Working in it

The studio is the dialog of the editor, as a page. Everything that works there works here: the Parts tree, pivots, bones, the parameters,
keyforms, warps, masks, physics, poses, frame tracks, the timeline and **Export...** ([a PNG sequence with
transparency](rig-json.md#exporting-a-movie)). What differs is only what belongs to a game:

- **Save** (Ctrl+S, from anywhere on the page) writes `rig.json` in the character's folder. As in the editor it rewrites only the
  values the studio edits and keeps the rest of the file as it is, so a hand-written `rig.json` keeps its layout. It is the only file
  written (the images and `sprite.json` are never changed). Undo and Redo go back past a Save too; the changes then wait for the next one.
- **Open...** goes back to the start screen. Unsaved edits are not dropped: the first press says so, a second one leaves them.
  Closing the tab or window asks too.
- There is no **Close**, no **Try in scene** and no **Place in scene** section (where a character stands is a game's business; the
  Export dialog's framing options still choose how the character sits in the frames).

## Making a rig.json for a new character

1. Convert the PSD (`npm run art` in a game project: `masters/char/<name>.psd` becomes `assets/char/<name>/sprite.json` and its
   images) or put the pose images in a folder.
2. Open the folder. The status line of the start screen says what it found (`14 parts`, or `one image per pose`, and *no rig.json yet*).
3. In **Model** add bones or move pivots, add parameters and pose them (see [authoring keyforms](rig-json.md#authoring-keyforms-in-model-mode));
   in **Animate** make an animation and key it.
4. **Save**. `rig.json` is now in the folder, and the game picks it up when you copy the folder into a project's `assets/char/`.

A folder of loose layer images without a `sprite.json` is read as poses (the studio cannot tell a stack of layers from alternatives).
Turn it into layers by converting a PSD, or by writing a `sprite.json` by hand.

## Not built

webm and mp4 export (the PNG frames open in any video editor), converting a PSD inside the page, a recent-folders list, a
read-only fallback for browsers without the File System Access API, watching the folder for images that change under the
open page (reopen it), and the studio on the online demo's static site (its page and the stage page would need a route each).
