# Marginalia Studio

The editor as a desktop app that needs neither Node.js nor git: a projects screen (recent projects, New Project, Open
Folder, Open the Demo) and the same editor and live preview as `npm run dev`. It is early and portable only, with no
installer yet.

1. Get `Marginalia Studio-<version>-win-x64.zip` (`npm run package:studio` builds it in `release/`; about 150 MB).
2. Unzip it anywhere and run `Marginalia Studio.exe` in the folder.
3. The exe is not code-signed, so Windows SmartScreen may stop the first start: choose **More info**, then **Run
   anyway**.

**Open Character...** on the projects screen opens the animation studio on a character folder with no game project (see
[standalone-studio.md](standalone-studio.md)); **File > Switch Project...** goes back.

The animation studio's **Export...** (a PNG sequence with transparency, see [rig-json.md](rig-json.md#exporting-a-movie)) can save
its frames straight into a folder you pick in the Studio's own dialog; a zip goes through the usual save dialog.

New projects go to `Documents/Marginalia Studio` by default, and so does the copy of the demo. The Studio carries the
engine's version number; a project made with an older engine version is offered an update when opened.

The Build dialog's **Desktop app** target makes the game ready to run without npm: the Studio's own Electron runtime
with the game inside, the exe named after the game, and a zip to share (about 140 MB). See
[desktop.md](desktop.md).
