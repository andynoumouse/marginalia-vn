# ST report: Marginalia Studio (Electron) and the online demo (as returned by the tester)

Counts: S1 0 · S2 8 · S3 10. Scripts and screenshots were in the tester's scratchpad folder (`ux/st`), which is not kept.

## Scope
- **Studio:** the repo's `electron studio`, launched through `_electron` with the isolation copied from `studio.test.mjs` (own user-data dir, documents dir, port). Covered: first-run projects screen; New Project (all 6 templates, stage, name and location errors); Open the Demo; editing and saving; menu bar; close and reload with unsaved edits; second instance; project list (marks, Remove, engine notices); Build dialog (all 3 targets, timed); standalone character studio; adding a character PSD. The packaged 0.2.1 exe was used only for first launch and version.
- **Online:** `build/online` served with `serve-online.mjs`, headless Edge at 1280x800, 1024, 800 and a 390x844 touch/mobile context.
- **Stale build:** `build/online` says engine 0.7.2 and is dated 2026-11-04; HEAD is 2026-11-08, 244 commits later, several touching `online/`, `editor/`, `preview/`. The tester could not build its own copy (`build-online.mjs --out` must be inside the repo's `build/`). Online findings are against that older build.
- **Not testable:** native dialogs (Open Folder, Browse, save), SmartScreen/installer; real menu accelerators (CDP key events do not trigger them; View > Zoom In by menu click worked); the git-repo option; real DPI scaling; Translate and export-and-play of the new project (covered by the in-browser editor testers).

## Task log
- Studio first launch: done. 1.2 s to projects screen (repo Electron), 1.7 s packaged 0.2.1.
- First-run screen: done with friction (ST-5).
- New project, Blank or Classic ADV, to editor and preview: done, 4 clicks plus the title; Classic ADV 1.66 s to editor, 1.69 s to preview canvas.
- Template choice: done with friction (ST-2).
- Bad names and locations: messages good for bad characters (`< > : " / \ | ? *`), a non-empty folder, a template/stage mismatch. Stuck on ST-1.
- Open the Demo: done. Second open 1.7 s, edit kept. Opens mid-file (`index.vn:99`, 9 tabs) with no "start here" hint. First-open time not captured.
- Edit script, save, preview: done. Autosave reached disk in ~0.5 s. Ctrl+S showed "saved".
- Project list: done with friction. Order is most-recent-opened. No rename in the list or the Studio (the title lives in `game.json`). Remove keeps the folder.
- Window and menu: done. Title "<game> - Marginalia Studio". Menus: File (Switch Project, Exit), Edit, View (Reload, Toggle Developer Tools, zoom, full screen), Window. No Help menu (ST-10).
- Close and reload with unsaved edits: done. Prompt "Some edits are not saved yet. / Leave anyway and lose them?" with Leave/Stay, Stay default. View > Reload asks the same.
- Engine mismatch: done. Newer game gets a clear Cancel / Open Anyway notice. Older game gets Update / Open Without Changing / Cancel (ST-13).
- Build, web: 0.5 s, "202 files, 6.7 MB", "Open the game" link. Desktop zip: 19.2 s, 315 MB folder, 143.8 MB zip, 3 clicks (ST-12). npm folder: 0.8 s.
- Standalone character studio: done. 1.8 s to ready. Empty folder gives a clear red message.
- Add a character from a PSD: Studio 0.8 s, online 0.4 s via the "+" button. Drop route is ST-8.
- Online first visit: 28 ms to the page, service worker active and controlling within 2.5 s, front page 53 KB. "Open in editor" to Monaco ready 0.54 s; "Play" to canvas 0.31 s.
- Online edit, save, reload: done. Edit survived a reload (IndexedDB `marginalia-online`). Download .zip 0.2 s for 3.8 MB. Import 2.5 s. Delete asks for confirmation.

## Findings
ST-1 · S2 · bug · New Project with an unusable Location fails silently. New Project…, set Location to a file path (e.g. `…\user-data\settings.json`) or `Z:\does\not\exist`, give a Title, Create. Expected a message in the dialog's `#newError`, as for other errors. Actual: nothing; dialog stays open, Create re-enables. Cause: the main process throws ENOTDIR/ENOENT, which only appears as an unhandled rejection in the console ("Error invoking remote method 'projects:new'"). Reproduced twice (file path and `Z:`). Known: no.

ST-2 · S2 · usability · The stage size select keeps the previous template's value. Click the "Portrait (phone)" card (stage becomes 1080x1920), then "Mystery / adventure" (or Kinetic, Branching, Blank): the select stays on 1080x1920. Create with Mystery is then refused ("…template is laid out for a landscape stage; pick a landscape size or another template." — a good message, but the cause is the sticky select). Blank after Portrait silently creates a portrait project. Expected: the select resets to the default size when the new card has no `stage`. Reproduced twice. Known: no.

ST-3 · S2 · a11y · Recent projects cannot be opened with the keyboard. Rows are `<li>` with a click handler only (tabindex -1, no role). Tab reaches Reveal and Remove but never "open". Clicking a "missing" row does nothing and says nothing; only the strikethrough and a tooltip hint. studio/projects.js. Seen in DOM and code (Tab not driven with a real keyboard). Known: no.

ST-4 · S2 · docs · A no-Node newcomer cannot find the downloads. README says "Without Node.js, use the online demo or Marginalia Studio" with no links. docs/studio.md step 1 is "Get …-win-x64.zip (`npm run package:studio` builds it)", which needs Node. docs/online.md gives only `https://<user>.github.io/<repo>/` and `npm run build:online`. The only workflow, `online-demo.yml`, publishes the demo; none publishes a Studio zip. Local `release/` is 0.2.1 (its screen lacks Open Character), repo is 0.9.0. Expected a URL for the demo and a release link for the zip. Known: no.

ST-5 · S2 · usability · The first-run screen points at the wrong first step. The only filled/primary button is "Open Folder…", which needs an existing project. Empty-state says "Open a folder, start a new project or open the demo", demo last. No sentence says what Studio is; "engine 0.9.0" next to the title means nothing to a newcomer. The online front page does this better (one intro sentence, demo card first with Play, then templates). Seen once per build. Known: no.

ST-6 · S2 · usability · The online editor on a phone viewport has no "needs a larger screen" notice. At 390x844 (touch, mobile) the desktop layout is squeezed: toolbar clipped at "Preview from c…", code wraps at ~10 characters, preview off-screen, no notice. The player (Play) works on the phone. At 1024 px the toolbar's Help is cut off; at 800 px Translate/Voice/Commands/Help and the preview pane are unreachable (the editor testers' domain; Studio minimum window is 900x600). Seen once at phone size. Known: no. (Related: EL-1, EL-2.)

ST-7 · S2 · usability · The online editor hides Build instead of explaining it. No Build or Export button. The only cue is the status line "ready (online demo: the project is kept in this browser; Ctrl+P > Online to download it as a zip)", clipped at 1280 px to "ready (online de…". Ctrl+P > ">export" or ">build" finds only "Online: Download Project as .zip", the project, not a playable game. The docs say to download and export with desktop tools, which a no-Node person only has via Studio. Reproduced twice. Known: no.

ST-8 · S2 · usability · A PSD dropped on the Characters section is refused with a misleading hint. New project (online or Studio), drop `robo.psd` on "No converted characters yet". Actual "not added: robo.psd: drop a PSD on the bg, char or ui folder"; a fresh project's assets tree lists only bg, fonts, movie, music, sound, ui — no `char` row. The working route is the "+ Add a character PSD (masters/char/)" button on the CHARACTERS heading (converts in 0.4 s online, 0.8 s in the Studio). Expected: accept the drop on the Characters section, or the empty-state text names the "+" button. The drop was a synthetic DragEvent. Reproduced twice. Known: no. (Related: ES-3, EP-5, EP-16, OB-6.)

ST-9 · S3 · bug · New Project location and name validation gaps. Title "CON" creates a folder named `CON` (Windows reserved device name; seen once). A relative Location (`games`) silently creates the project under the app's working directory (seen once). Folder name `..` is refused only because the grandparent is not empty, and the message names that grandparent folder. A missing Location chain is silently created (taste).

ST-10 · S3 · usability · The Studio has no Help, About or update path. No Help menu. Version visible only on the projects screen as "engine 0.9.0", never in the editor window. View > Toggle Developer Tools is exposed (taste). Known: no.

ST-11 · S3 · taste · A second launch of the exe is silent and ignores its argument. With the same user data it exits in ~100 ms with code 0 and `--project B` is ignored; the first window stays on A. Fine for double-click.

ST-12 · S3 · usability · Build dialog feedback in the Studio. The 19 s desktop-zip build shows only "Building…" with no progress or elapsed time. The result gives a relative path with no Show in folder (the web result has "Open the game"). "Desktop npm folder (Electron, for installers)" is a dead end without Node and nothing warns before building; the result then says "Run npm install && npm start". The web result says "Upload the folder or zip its contents", with no zip made and no hint where to upload. Seen once.

ST-13 · S3 · usability · The older-engine notice is one very long native message box. For 0.1 to 0.9 it holds 20+ bullets. "Update to 0.9" only rewrites `game.json`'s `engine` field; the last line says so. The "newer" notice is good.

ST-14 · S3 · usability · Online project-list rough edges. Import of a non-zip shows "not a zip file" in small red text between the templates and the list, far from the Import button, not naming the file. "New project" with an empty name is a silent no-op. Importing the same zip twice gives two identically titled rows, told apart only by the small id (`rainy-day-library-2`). The slug drops non-ASCII letters (title `Ünï <b>Tést</b> / "x"` becomes id `n-b-t-st-b-x`). Template cards sit under the New project button, so it is not obvious that clicking a card only selects it.

ST-15 · S3 · usability · The online demo does not work offline, and the docs do not say so. Nothing is cached (Cache Storage empty). Offline, the front page fails (net error), and the editor and player return raw "TypeError: Failed to fetch" bodies. The page says it runs "entirely in your browser", which suggests offline use. Reproduced twice (emulated offline).

ST-16 · S3 · usability · Online URL and data-loss states. After clearing site data, a bookmarked `p/<id>/editor/` gives a bare "Not found" (the static host's 404) with no way back. Once the service worker is reinstalled, unknown project paths silently show the project list with no "that project is not in this browser" message. The storage notice itself is good. Seen once.

ST-17 · S3 · visual · The online Play page is the dev preview. It shows the "VN preview / Language / Restart / Problems / Debug" bar and has no way back to the project list or editor. No favicon (`/favicon.ico` 404, console error on first visit).

ST-18 · S3 · taste · The demo is called two things. Titled "Rainy Day Library", described as "the Iris demo". In the Studio, Open the Demo copies once, so there is no "reset the demo" if you break it (the repo test expects this, but docs/studio.md does not say so).

## What worked well
- Studio starts in ~1.2 s with no Node, shows the project name in the title bar; dev server and user data stay isolated per sandbox.
- The projects screen's marks (older/newer engine, missing, not a project, shared id) all carry tooltips. The not-a-project error ends with a next step ("Use New Project to start one"). The newer-engine notice defaults to Cancel.
- New project dialog: folder name follows the title, template cards have good descriptions, non-empty-folder and bad-character messages are clear. The git checkbox is disabled with an honest explanation when git is missing.
- Autosave to disk in ~0.5 s with a "saved" status, plus a Stay-by-default prompt on close or reload with unsaved edits.
- The web build is instant and its summary readable. The desktop zip result gives the zip name and size; the exe is named after the game.
- Adding a character PSD gives immediate "adding…" then "added" feedback, and the character appears in under a second in both hosts.
- The online front page explains where data lives and how to keep it, puts the demo first, shows live storage usage. Editor opens in 0.5 s; zip download and import round trip works. Delete warns that it cannot be undone and suggests downloading first. The standalone character studio's empty-folder error is clear.
