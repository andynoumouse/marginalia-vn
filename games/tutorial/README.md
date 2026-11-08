# The Last Train

A visual novel made with Marginalia VN Engine. It is the game built step by step in the [tutorial](../../docs/tutorial/README.md).

```
npm install        # once: links the engine (file: dependency, so engine updates apply immediately)
npm run dev        # editor + live preview: http://localhost:5173/editor/
npm run export     # web build in build/web
npm run art        # convert masters/*.psd to assets/ (npm run dev does this on save)
npm run ids        # add localization ids to new lines
npm run strings    # write locale/<source language>.json (en.json by default)
```

Content: script/ (scenes), game.json (title screen, menus, gallery), themes/ (look of the game), locale/ (translations),
masters/ (layered PSDs: bg/, char/, ui/), assets/ (game-ready art and audio: bg/, char/, music/, sound/, fonts/).
See the engine README for the script language and the art pipeline.
