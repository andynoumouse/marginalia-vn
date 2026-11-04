# The online demo

The editor and live preview as a static website. There is no server and no install: projects are kept in the visitor's
browser (IndexedDB), and a service worker plays the part of the dev server.

```
npm run build:online          # writes build/online/ (about 20 MB)
npm run serve:online          # serves it at http://localhost:5180/marginalia-vn/, as GitHub Pages would
```

The code in `dist/` is bundled and minified with esbuild: one file per page (`editor.js`, `help-page.js`, `preview.js`,
`projects.js` and the service worker `sw.js`) instead of the roughly 100 modules `tsc` writes. PixiJS stays a separate
file in `vendor/`.

Upload `build/online/` to any static host that serves HTTPS, at the root or in a subfolder (GitHub Pages works:
`https://<user>.github.io/<repo>/`). Service workers need HTTPS (localhost counts as secure).

The repository's `.github/workflows/online-demo.yml` builds and publishes it to GitHub Pages whenever a release tag
(`v*`) is pushed, or by hand from the Actions tab. To turn it on once: Settings → Pages → Source: GitHub Actions.

## What visitors get

- **A project list** (the site's front page): start from the Iris demo or a blank project, import a project `.zip`,
  then open, play, rename, duplicate, download as `.zip`, or delete.
- **The editor**, the same one `npm run dev` serves, with live preview, completions, the outline, translations, voice,
  the animation studio, rename, find in files and the trash. The **‹ Projects** button at the left of the top bar saves
  and goes back to the project list.
- **The art pipeline in the browser**: drop a layered PSD on the Characters or Assets panel and it is converted on the
  spot (the same converter as `npm run art`). Reconvert All Art works too.
- **Download as .zip** (project list, or Ctrl+P → Online). The zip holds the project folder exactly as on disk, so it
  opens in Marginalia Studio or with `vn dev`.

## What it cannot do

These need the machine, so the editor hides or greys them out:

- git (the Files panel's branch and Commit);
- Reveal in File Explorer and Open in Default App;
- Build and Export (web or desktop), and Export Strings. Download the project and export it with the desktop tools.

## Storage

Each browser keeps its own projects, which other browsers and devices cannot see. Browsers may clear site data when
space runs low; the project list asks the browser to keep it and shows whether it agreed. Download projects you care
about as a zip.

It needs a browser with module service workers and `CompressionStream`: a current Chrome, Edge, Safari or Firefox.
Private windows may turn service workers off.

## How it works

- `online/sw.ts` (the service worker) serves each project under `p/<id>/`: the preview at `p/<id>/`, the editor at
  `p/<id>/editor/`, and the project's files at `p/<id>/assets/...` and so on. The engine code, Monaco and PixiJS come
  from the site's own static folders.
- The editor and preview call `/api/...` and `/__events` as they do with the dev server. The worker answers for the
  project of the page asking, with `online/routes.ts`: the dev server's file routes on an IndexedDB store
  (`online/store.ts`), with the same rules (no overwrites, a trash for deletes and replacements).
- `GET /api/capabilities` (`engine/src/capabilities.ts`) is how the editor learns what to hide. The dev server
  answers that it can do everything.
- Shared with the desktop tools: the project listing (`engine/src/project-data.ts`), the PSD converter
  (`engine/src/psd.ts`) and the zip reader and writer (`engine/src/zip.ts`).
