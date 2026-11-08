# Design notes: themes (tokens, components, styles)

This is a plan, of which phases 1 and 2 are built, except the editor side of phase 2 (see "Phases"). The goal is to restyle every part of the built-in UI, from the
text box to dialogs, menus, sliders and toasts, from one theme file, so that changing a few colors gives a consistent
result and finer control is there when it is needed. The editor gets a visual panel on top of the same file.

## Where things stood before phase 1 (verified)

- **`game.json` `theme`** (then `engine/src/theme.ts`, documented in [../game-json.md](../game-json.md#theme)) styles the text box,
  name tag, text, choice buttons, hotspot highlight and tooltip, plus `accent` and `font`. `skins.<name>` overrides the
  text box, name tag and text while a character with `define ... box=<name>` speaks (`#stage[data-skin="<name>"]`).
- **Everything else is fixed CSS** in `preview/index.html`: about 50 hard-coded `rgba(...)` values, and `--accent` and
  `--vn-font` as the only variables. Title, pause, options, saves, history, gallery, music room, chapters, achievements,
  the confirm and save-name dialogs, the quick menu, the achievement toast and the loading bar follow `accent` and `font`
  and nothing else. Every button looks the same (`.screen button`), so a dialog has no primary action.
- **The preview page's own bar uses the same `:root` variables** as the stage (`--panel`, `--line`, `--accent`). Game
  theming must not reach the bar or the debug panel.
- **Values are filtered** (`safe()`, `color()` in `theme.ts`; `checkAssets` repeats part of it in `engine/src/assets.ts`)
  because projects in the online demo are shared and must not inject CSS. `color()` uses `CSS.supports`, so validation
  happens in the browser today, not in the engine.
- **Custom screens** (`screen ...` in scripts, the PSD pipeline) draw their own `.sc-btn` buttons and hotspots with the
  same stock look as the built-in screens, and `hover` on an element overrides the theme's highlight. Art-heavy screens
  stay a script feature; themes style the built-in UI and the stock look of screen elements.
- **Related items in `TODO.md`:** a font per language in `theme`, and (deferred) a high-contrast theme and a
  dyslexia-friendly font option. Both are cheap once the model below exists.

## The model: four layers

A value is looked up from the most specific layer down; the first layer that sets it wins.

| Layer | What it says | Who touches it |
|---|---|---|
| 1. **Tokens** | ~15 named values: palette, fonts, sizes, radius | Everyone. Enough for most games. |
| 2. **Components** | The look of each building block, defaulting to tokens, with variants and states | Authors who want a specific button or panel look |
| 3. **Screens** | Overrides inside one built-in screen (`options`, `saves`, `confirm`, ...) | Rare: one screen that should differ |
| 4. **Styles** | Named style classes used from the script or by a character (`box=`) | Writers, at a point in the story |

Below all four is the engine's base theme (today's look), so an empty theme looks exactly like the game does now.

### Tokens

| Token | Meaning | Default (today's look) |
|---|---|---|
| `text`, `muted` | Body text, secondary text | `#e6e9ef`, `#8b93a3` |
| `accent`, `onAccent` | Highlight color, and text drawn on it | `#5fd1c3`, `#0e1117` |
| `surface` | Panels, text box, buttons | `#0e1117` |
| `line` | Borders | `#fff` |
| `overlay` | Dimming behind dialogs and menus | (current `.screen.dim`) |
| `danger` | Destructive actions (delete a save) | `#f0707a` |
| `font`, `uiFont` | Story text font, menu font (default `font`) | Iowan Old Style stack |
| `textSize`, `uiSize` | Story text size, menu text size | 44, 40 |
| `radius`, `borderWidth`, `gap` | Corner radius, border width, spacing unit | 8, 2, 18 |

Tokens are written to CSS variables on `#stage` only (`--vn-accent`, ...), so the preview bar keeps its own look.
`surface` and `line` are base colors: each rule mixes them with transparency (a panel uses `surface` at 95%, a button at
86%, a border `line` at 18-25%), which is how today's slightly different values stay exactly as they were. A
`surface` given with its own alpha is mixed on top of that.

### Components

Every component takes the same small set of **appearance properties**:

`background`, `color`, `border` (color), `borderWidth`, `radius`, `padding`, `font`, `size`, `opacity`, `shadow`,
`image` + `slice` (9-slice frame, as now).

A few components also take **placement**: `x`, `y`, `width`, `height` (text box, name tag, panel), and `gap`
(choices, menu columns).

| Component | Covers today's |
|---|---|
| `textbox`, `namebox`, `text` | `#box`, `#name`, `#text` (the existing keys) |
| `choice` | `#menu button`, plus its timer bar |
| `panel` | `.panel` (options, saves, dialogs, crash box) |
| `button` | `.screen button`, the stock `.sc-btn` of custom screens |
| `tab` | options tabs |
| `slider`, `select`, `field` | range inputs, selects, the `input` text field and on-screen keyboard keys |
| `row` | save slots, history lines, chapter and achievement rows |
| `pager` | page number buttons |
| `quickmenu` | the quick menu bar and its buttons |
| `hotspot`, `tooltip` | hotspot highlight (`hotFill`, `hotBorder`, ...) and tooltip (`tip*`) |
| `toast` | achievement toast |
| `title` | the game title on the title screen |

**Variants** are separate keys with a dot: `button.primary`, `button.danger`, `choice.disabled`... A variant only lists
what differs from its component. The engine marks which buttons are which: the confirm dialog's Yes and the save-name
dialog's Save get `primary`, and Delete gets `danger`. This fixes dialogs having no primary action.

**States** are nested objects: `hover`, `focus`, `selected`, `pressed`, `disabled`, `seen` (choices already picked).
A state only lists what changes in that state.

**Token references** are strings starting with `$`: `"$accent"`. `"$accent/15"` means the token at 15% opacity, which is
what a tinted fill like the selected options tab needs. These are the only kinds of expression allowed.

### Screens

`"screens": { "options": { "panel": { "width": 1300 } } }` uses the same component keys, scoped to one built-in screen.
Valid screen names are the built-in screen ids (`title`, `pause`, `options`, `saves`, `history`, `gallery`, `music`,
`chapters`, `achievements`, `confirm`, `saveName`).

### Styles (named classes)

`"styles": { "whisper": { "text": { "color": "$muted" } } }` is a named set of component overrides.

- **Character skins become styles.** `define alice ... box=alice` applies style `alice` while Alice speaks. The old
  `theme.skins` is read as `styles`.
- **From the script** (a later phase): `menu style=urgent`, a `style=` on a dialogue line, and `style=` on screen
  elements (the screens design already reserves a skin name on every element).
- **Decided: styles change appearance only.** Placement properties are not allowed in `styles`, so a style used in the
  middle of a story cannot break a screen's layout. Placement belongs in components and screens.

## The file

- **Decided: a folder.** Themes move to **`themes/<name>.json`**; `game.json` says `"theme": "default"`. This keeps
  `game.json` about the game, lets a project keep several themes (and later let the player pick one), and lets authors
  copy a theme between projects. A single `theme.json` would cost the same plumbing (watching, export, schema, asset
  renames) and need a migration once a second theme is wanted.
- **`theme` is a name.** It picks `themes/<name>.json`; a missing file is a warning and the
  game uses the built-in `base` look.
- **`"extends"`** names another theme to start from: a project theme or a built-in one (`"base"`, later `"paper"`,
  `"high-contrast"`). Built-in themes ship as JSON inside the engine, so they double as examples. The chain is resolved
  once in the engine, with a cycle guard.
- **Later: a Theme option for the player.** `game.json` `"themes": ["default", "night"]` lists the themes the player may
  pick in Options; the choice is a player setting (`settings.ts`), not part of saves, since themes are cosmetic.
  Switching mid-scene re-lays out the text box (its size can differ, and pages are measured from it). Every skin and
  `style=` name a script uses must then exist in each listed theme; the check warns, and a missing one falls back to
  the stock look.
- **Sharing:** copy the file into another project; the check names any font or `ui/` image it refers to that the
  project lacks. A Studio "Import theme" that copies them along may come later.
- **Editor:** theme files show in the file tree and open in the theme panel, with the active one marked. A
  "Preview theme" choice in the preview bar switches the preview's theme without touching `game.json`.
- **New projects** get a `themes/default.json`.

Example:

```json
{
  "extends": "base",
  "tokens": { "accent": "#e0a050", "surface": "rgba(27,20,16,.94)", "radius": 4, "font": "Lora" },
  "components": {
    "button": { "padding": [12, 28], "hover": { "border": "$accent" } },
    "button.primary": { "background": "$accent", "color": "$onAccent" },
    "tab": { "selected": { "background": "$accent/15" } }
  },
  "screens": { "options": { "panel": { "width": 1300 } } },
  "styles": {
    "alice": { "textbox": { "image": "box_alice", "slice": 40 } },
    "urgent": { "choice": { "border": "$danger", "background": "$danger/20" } }
  }
}
```

## Implementation

### Engine (`engine/src/theme.ts`, pure, tested)

- `normalizeTheme(raw)`: maps a theme file's layered keys onto the flat `Theme`; `resolveTheme` resolves `extends` (with a cycle guard).
- `checkTheme(theme, assets)`: warnings with a JSON path (unknown key, placement in a style, a bad color, an unknown
  token, a missing font or `ui/` image). This replaces the theme part of `checkAssets`. Color checking moves into the
  engine, so node can do it (the color parser in `engine/src/colors.ts` gets extended to `rgb()`, `hsl()` and named colors).
- `themeCss(theme, assets)`: emits CSS rules. Values go through the same filter as the rest. It lives in
  `engine/src/theme.ts`; `preview/theme.ts` only puts the result into the page.
- `explainValue(theme, path)`: says which layer a value comes from ("inherited from `$accent`" or "set in
  `screens.options`"). The editor uses it for its markers.
- `contrast(a, b)`: WCAG contrast ratio, for editor warnings (text on `surface`, `onAccent` on `accent`).

### Stage CSS (`preview/index.html`)

- Every stage rule reads component variables, which fall back to tokens:
  `.screen button { background: var(--vn-button-bg, color-mix(in srgb, var(--vn-surface) 86%, transparent)); ... }`.
  The component variables are not given defaults on `#stage`: a variable set there would be worked out from the
  tokens on `#stage`, so a token changed in a narrower scope (one screen, a skin) would not reach the components
  inside it. The fallback in the rule is worked out where the rule applies. Variants and states are attributes
  (`data-variant="primary"`, `:hover`, `[aria-selected]`), and screens are scoped by their existing ids.
- This step on its own must change nothing visible: the base theme's values are today's values. Check it with
  screenshots before and after.
- These variable and class names become a documented, stable list in `docs/game-json.md` (later in a themes page),
  because `theme.css` will use them.

### Project files and tooling

- `project-data.ts` reads `themes/*.json`; the dev server watches `themes/` and sends `content` as it does for
  `game.json`; the web export, the desktop build and the online demo include the folder; `asset-refs.ts` follows
  `image` and `font` references in theme files (so renaming an asset updates them).
- The JSON schema for theme files is generated from one description in the engine, so Monaco's completions and the
  editor's theme panel cannot disagree.

### Editor: the theme panel

- Opened like `game.json`, with three tabs that follow the layers:
  - **Palette:** color and font pickers for the tokens.
  - **Components:** pick a component, then edit it, its variants and its states.
  - **Advanced:** the raw JSON (and later `theme.css`).
- **Screen gallery:** small live renderings of the text box with a sample line, choices, title, pause, options, saves,
  the confirm dialog, history and a toast. They render from fixed sample data, without playing the game to reach them.
  An edit updates all of them at once. This matters most: you can't judge a theme from one screen.
- **Click to inspect:** clicking an element in the gallery jumps to the component (and variant) that styles it.
- **Inherited vs overridden markers** on every field (from `explainValue`), with a reset button.
- **Contrast warnings** next to colors that make text hard to read.
- The editor's own look (Monaco's `vn-dark`, the editor and Studio pages) is a separate topic, not covered here.

### Escape hatch: `themes/<name>.css`

This comes last, once the class and variable names are stable enough to promise. The CSS is applied after the
generated rules and scoped to `#stage`. The online demo does not serve it (shared projects must not inject CSS), and the
editor says so when a project has one.

## Phases

Each phase ends usable, with tests (`engine/test/theme.test.mjs`; one browser test per phase that changes rendering).

1. **Tokens and button variants (built).** The stage CSS reads the `--vn-*` tokens (text, muted, accent, surface,
   line, danger, warn) on `#stage`, and buttons read `--vn-button-*` with `data-variant="primary"` / `"danger"`. Yes and
   Save in dialogs and "Return to title" on the error screen are primary; Yes on "Delete this save?" is danger.
   `themeCss` lives in `engine/src/theme.ts`, with a node-side `isCssColor` in place of `CSS.supports`. Today's
   `game.json` `theme` works unchanged; screenshots of the title, options, pause, saves and dialogs match pixel for
   pixel apart from the dialog buttons, and the selected options tab now follows a themed `accent` (it stayed teal before).
   Tokens other than `accent` and `font` are not settable yet; that comes with theme files. The text box, name tag,
   choices, custom-screen buttons and toasts keep their own colors until phase 3.
2. **Theme files.** `themes/<name>.json` picked by name in `game.json`, `extends` (project and built-in `base`), the
   `checkTheme`, the schema, watching, export and the online demo, asset renames inside
   theme files, and `themes/default.json` in new projects. No player Theme option yet.
3. **Full component set.** Every component in the table, with states and screen overrides; docs for all keys.
   *Started:* color tokens and `button`, `panel`, `tab`, `row`, `pager`, `toast` (variants and states) are emitted as
   direct `#stage <selector>` overrides from a selector table in `theme.ts`, so the stage CSS did not need to change.
4. **Editor panel (built).** Palette and component tabs, screen gallery (iframes of the preview's own stage with fixed sample data), inspect, markers, contrast.
5. **Styles from the script (built).** `define ... style=`, `style=` at the end of a
   dialogue or narration line (before the `#id`), `menu "..." style=` (the style's `choice`), and `style=` on screen
   `button` and `text` elements (the style's `button`, or `text` color and size). Styles drop placement keys (`x`, `y`,
   `width`, `height`). An unknown style name is a warning. Hotspots, images and sliders take no `style=`.
6. **Later.** `theme.css`; built-in presets (`paper`, `high-contrast`, which closes the deferred TODO item); a font per
   language (`tokens.font` per locale); a player-selectable theme in Options.

## Open questions

- **Should `button` also style custom-screen `.sc-btn`s**, or should they get their own `screenButton` component?
  Sharing is simpler and consistent; a separate component lets map screens look different from menus.
- **Token names:** `surface`/`overlay` or `panel`/`dim`. They should match the words the editor panel shows.
- **Per-language values:** a `locales: { "ja": { "tokens": { "font": ... } } }` layer, or plain styles chosen by
  language? This matters for the TODO item on CJK fonts.
- **How far the gallery's sample data goes:** fixed samples are cheap; the project's own saves, history and title art
  look truer but need the game state.
