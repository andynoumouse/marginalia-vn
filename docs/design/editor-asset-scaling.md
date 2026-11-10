# Editor scaling with many assets

The editor is comfortable with the sample's few hundred files. Reading the code shows several places where its cost grows
with the number of files in the project (not their size). A game with thousands of backgrounds, CGs, sprites and voice
lines would feel it on every save. This plan measures that first and then fixes the costs from the cheapest up. Each step
is its own change and can ship alone.

## What happens today

Every change on disk under `script/`, `locale/`, `themes/` or `assets/` makes the dev server send a `content` event,
after a 120 ms pause that groups changes together (`watch()` in `preview/dev-server.mjs`). That covers the editor's own
autosave of a script, each file the PSD converter writes, and a `git checkout`. Two pages listen:

- **The editor** (`syncFromDisk`, `editor/editor.ts`) fetches `/api/project` and calls `setAssets`, which redraws
  the Files panel and the Assets panel (`editor/sidebar.ts`) and refreshes the game.json schema.
- **The preview** (`load()`, `preview/preview.ts`) fetches `/api/project` as well, recompiles and restarts the story.
  Images and music are not fetched again; `preload()` only takes stock of the file list.

`/api/project` (`tools/project-data.mjs`, `engine/src/project-data.ts`) does this each time:

1. walks `script/`, `locale/`, `themes/` and `assets/` recursively and reads every file's modification time;
2. reads all script, locale, sprite.json, rig.json, theme and game.json text and parses the JSON files;
3. sends all of it, script text included, as one JSON object.

So one autosave means two full walks of the project, two copies of every script sent to the browser, and a full
redraw of the sidebar. On top of that the sidebar has slowdowns of its own:

- `renderSidebarAssets` adds a file to its folder's list by copying the whole list (`[...old, name]`). With n files in
  one folder that is about n²/2 copies, roughly 12 million for 5,000 files.
- For every file it scans every character (`Object.entries(rigs).some(...)`).
- It builds a row element, with its menu, for every file, **including files in closed folders**: `<details>`
  hides its children but they are still created.

There is one more small leak. The asset viewer adds a new font to `document.fonts` each time a font is viewed and never
removes it.

## Step 0: measure (done)

`scripts/make-big-project.mjs <count>` makes a synthetic project in a temp folder: a copy of the sample plus `count`
files, half 1x1 PNGs in `assets/bg/`, 30% in `assets/cg/` and 20% dummy sounds in `assets/sound/`.
`scripts/measure-big-project.mjs [<count>...]` starts the dev server on each such project, opens the editor in Edge or
Chrome, and prints a table. `VN_PROFILE=1` also prints a CPU profile of the editor's load. What it measures:

- **/api/project**: requested from node, the median of 5, and the response size.
- **Editor load**: from navigation until the network is idle.
- **Elements, JS heap**: after loading.
- **Redraw**: both panels redrawn through the filter's input handler, either with folders closed or filtered to
  `bg_` so the bg folder is open.
- **Save**: `park.vn` rewritten unchanged, as an autosave does. The time is from the reload event to the last change
  in the panel, plus the editor's and the preview's `/api/project` request times.

First run (Windows 10 desktop, Edge, `dist/` as of this plan; the 20,000 row was run with `VN_PROFILE=1`):

| Extra assets | /api/project | Size | Editor load | Elements | JS heap | Redraw, closed | Redraw, bg open | Save: event → panel done | Editor fetch | Preview fetch |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 500 | 41 ms | 108 KB | 1.9 s | 3,292 | 31 MB | 3 ms | 2 ms | 627 ms | 79 ms | 40 ms |
| 5,000 | 283 ms | 311 KB | 8.0 s | 16,792 | 44 MB | 37 ms | 26 ms | 738 ms | 592 ms | 292 ms |
| 20,000 | 1,107 ms | 988 KB | 29.3 s | 61,792 | 63 MB | 278 ms | 148 ms | 2,881 ms | 2,268 ms | 1,165 ms |

What the numbers say:

- **Saving gets slow.** Each request takes about a second at 20,000 files, and the editor's own request takes twice as long
  (2.3 s), because it waits behind the preview's, which runs at the same time. One autosave takes about 3 s to settle. At
  this size, steps 3 and 4 matter most.
- **Loading is mostly network, not CPU.** The profile shows about 24 s of the 29 s idle, waiting on requests. The preview
  fetches and decodes **every file in `assets/sound/`** in the background at start (`prefetchSounds`,
  `preview/audio.ts`): 4,000 requests here. It also keeps every decoded buffer, and decoded audio is roughly ten times the
  size of the file. This project's dummy sounds fail to decode, so the JS heap above understates what real sounds would
  cost. See step 1b.
- **The sidebar is costly but not the main problem.** About 3 elements per file, closed folders included, which is why
  "closed" is slower than "bg open" (20,000 rows against 10,000). Its 0.15 to 0.28 s per redraw still lands on every
  save and every filter keystroke.
- **The response size is fine.** 1 MB at 20,000 files. Step 5 isn't needed for size alone.

## Step 1b: don't prefetch every sound (done)

`prefetchSounds` (`preview/audio.ts`) now loads only the names it is given. Those are the text blips, and
`uncuedSounds(program, game)` (`engine/src/assets.ts`): screen button hover sounds and game.json's
`achievementToast.sound`. These can play with no script line ahead of them. `sound play` and `sound loop` were
already in the lookahead (`attachPreloads`), so they still load ahead of their lines. Any other sound loads when it
first plays. Decoded sounds still stay in memory once loaded. Limiting that belongs with asset unloading, which is
deferred in TODO.md.

After the change:

| Extra assets | Editor load | JS heap | Save: event → panel done |
|---:|---:|---:|---:|
| 500 | 1.5 s (was 1.9 s) | 31 MB | 624 ms |
| 5,000 | 2.2 s (was 8.0 s) | 35 MB | 685 ms |
| 20,000 | 4.9 s (was 29.3 s) | 47 MB | 2,868 ms |

Saves are unchanged, as expected; steps 3 and 4 address them.

## Step 1: build the asset groups in one pass (done)

Done as planned: `groupAssetFiles(files, layered, keep)` in `engine/src/file-tree.ts`, tested in `file-tree.test.mjs`.

Move the grouping out of `renderSidebarAssets` into a pure function in `engine/src/`, for example
`groupAssetFiles(files, rigs, match)`, which returns `{ dir, names }[]`. It pushes onto each folder's array instead of
copying it, and builds a set of the layered characters' `char/<c>/` prefixes once instead of scanning every character
per file. A test in `engine/test/` covers the grouping and the hidden character files. The sidebar keeps its current
look.

## Step 2: create rows only for open folders (done), and only the visible ones (not started)

Part 1 is done: a folder's rows are made the first time it opens (`renderSidebarAssets`), and they stay until the next
redraw. The page now has the same ~1,745 elements at every project size, against 61,787 at 20,000 assets before. A
redraw with folders closed takes 10 ms instead of 113 ms. Part 2 (`VirtualList` for one huge open folder) waits until a
project needs it. Opening bg/ with 10,000 files through the filter takes 27 ms to draw.

1. A closed folder gets its summary line only. Its rows are created on the `toggle` event when it opens and removed
   when it closes. This alone makes most renders cheap, because most folders are closed.
2. An open folder with more than about 200 files shows its rows through `VirtualList` (`editor/virtual-list.ts`,
   already used by the translation and voice dialogs) inside a fixed-height scroll area.

What must keep working: keyboard navigation through the panel, `focusedKey` / `refocus` (focus coming back to the
row after the viewer closes, from the keyboard-focus fixes of the November UX round), the row menus, the filter (a
filter opens every matching folder, so virtual rows matter most there), and drag and drop.

Check it with the browser tests that touch the sidebar, and add one that opens a folder of 2,000 mocked files
(a mocked `/api/project`, not files written to the sample) and checks that only a screenful of rows exists.

## Step 3: skip work when nothing changed (done)

- **Reload events name their files.** The dev server (`watch()` in `preview/dev-server.mjs`) and the online demo's
  service worker (`online/sw.ts`) collect every path changed during their 120 ms pause. The event is now
  `{ type, files: ['script/park.vn', ...] }`, with project-relative paths. `''` stands for a change the watcher
  couldn't name.
- **Saves from this tab.** `OwnSaves` (`engine/src/own-saves.ts`) records each script this tab saves. When an event
  names only scripts saved in the last 2 s, the editor skips `syncFromDisk`, and each recorded save counts for one
  event only. An event without names, or one that names any other file, still syncs. The preview still reloads,
  since it needs the new script. Other kinds of tab (game.json, rig.json, themes) still sync after a save: a rig.json
  save changes the asset list, and the others are rare.
- **No redraw when nothing changed.** `setAssets` keeps a signature of what it last drew from: the asset list with
  versions, masters, asset and script folders, and theme names. When a sync brings the same signature, it skips both
  sidebar renders and the schema update.

The measuring script now has two save cases. The first is a change from outside the editor: park.vn rewritten
unchanged on disk. The second is the editor's own autosave: a character typed into park.vn. For each, it reports the
time from the reload event until the editor settled, meaning its last `/api/project` answer or panel change:

| Extra assets | Typed save: settled | Editor `/api/project` requests | Outside change: settled | Editor fetch | Preview fetch |
|---:|---:|---:|---:|---:|---:|
| 500 | 627 ms | 0 (was 1) | 625 ms | 81 ms | 40 ms |
| 5,000 | 626 ms | 0 (was 1) | 623 ms | 576 ms | 289 ms |
| 20,000 | 1,314 ms (was ~2,900) | 0 (was 1) | 2,349 ms (was ~2,900) | 2,336 ms | 1,172 ms |

The ~620 ms floor comes from the git status refresh. It waits 600 ms after each change (`refreshSoon` in
`editor/git-dialog.ts`), then calls `/api/git`, and its bar sits in the sidebar. At 20,000 files that request takes
longer. A change from outside still makes the editor fetch the whole project, and the preview fetches it on every
change: step 4 addresses both.

## Step 4: an in-memory index on the server (done)

`projectIndex(root)` (`tools/project-data.mjs`) keeps what `projectListing` returns in memory: path → modification
time, the folders, and each text file's contents as last read. `/api/project` in the dev server reads from it, and
`projectFromListing` is unchanged.

- **Updates.** Each raw `fs.watch` callback for the content folders, plus the game.json poll, calls
  `touch([path])` at once, not after the 120 ms pause. So a request that beats the broadcast still sees the change.
  The next `listing()` re-checks only those paths: it forgets everything at or under each one, then re-adds what is on
  disk now, so a renamed or deleted folder is handled too.
- **Full scans.** `stale()` asks for a full scan at the next request. That happens when the watcher reports a change
  without a name, when a watched folder appears late (themes/), and after every API write except a script save,
  which touches its own file. A move, delete, upload, trash restore or task is in the index before its answer goes out
  (`res.on('finish')`). If a content folder can't be watched, every request scans, as before. As a safety net
  against events the watcher drops, a listing older than `FULL_SCAN_MS` (60 s) is re-scanned at the next request.
- **Tests.** `engine/test/project-index.test.mjs` compares the index with a fresh `projectListing` after edits,
  additions, a deleted folder and a renamed one, and checks the full-scan triggers.

The web export and the other tools still scan, once per run. The online demo (`online/routes.ts`) reads its
in-browser store on every request. Demo projects are small, so it keeps doing that.

After the change (the first request after start still scans):

| Extra assets | /api/project | Editor load | Outside change: settled | Editor fetch | Preview fetch | Typed save: settled |
|---:|---:|---:|---:|---:|---:|---:|
| 500 | 2 ms (was 40) | 1.4 s | 630 ms | 5 ms | 3 ms | 630 ms |
| 5,000 | 5 ms (was 279) | 1.5 s (was 2.2) | 634 ms | 13 ms | 7 ms | 621 ms |
| 20,000 | 18 ms (was 1,135) | 1.8 s (was 5.2) | 630 ms (was 2,349) | 30 ms | 16 ms | 634 ms (was 1,314) |

Every save now settles at the git refresh's ~630 ms floor, whatever the project's size.

## Step 5 (only if step 0 says so): send only what changed

If, after steps 1 to 4, the size of the response is still a problem (thousands of assets plus megabytes of script),
the server keeps a revision number. The editor then asks for `/api/project?since=<rev>` and gets only the files added,
changed or removed. This changes how the editor and the preview apply the project, and the online demo's routes too, so
it's the most invasive step. Leave it out unless measurements call for it.

## Step 6: the font leak (done)

The asset viewer keeps the font it added and removes it with `document.fonts.delete()` when it shows another file or
closes.

## Order

Steps 0, 1, 1b, 2 (part 1), 3, 4 and 6 are done, and step 5 isn't needed. Saves, loading and the panel no longer grow
with the asset count:

| Extra assets | /api/project | Editor load | Elements | Redraw, closed | Every save settles |
|---:|---:|---:|---:|---:|---:|
| 500 | 2 ms | 1.5 s | 1,745 | 1 ms | ~630 ms |
| 5,000 | 5 ms | 1.4 s | 1,745 | 3 ms | ~630 ms |
| 20,000 | 17 ms | 1.6 s | 1,745 | 10 ms | ~635 ms |

Still open:
- **Step 2, part 2:** `VirtualList` for one very large open folder (TODO.md, Files panel).
- **Real art and sound.** These numbers come from dummy files. Memory over a long playtest depends on the deferred
  asset unloading. Also check whether the watcher keeps up with a PSD conversion burst; if it drops events, the
  index catches up at its 60 s full scan. Step 2 needs the most care around keyboard focus. Step 5 isn't needed for size (see step 0).
After each step, run `node scripts/measure-big-project.mjs` again and compare it with the table in step 0. After each step, run
`npm test` again, and run `node scripts/browser-gate.mjs` for changes to `editor/` or `preview/`.
