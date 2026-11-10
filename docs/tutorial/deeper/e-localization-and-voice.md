# Localization and voice

Translating a game and recording voice lines both hang on one idea: every line of dialogue, every menu option and every
`input` prompt has a short **id** (`#ab12`) that stays the same when its words change. Translations and recordings are
matched to the id, so you can reword a line without losing them.

## 1. Add the ids

After adding or editing lines, run:

```bash
npm run ids
npm run strings
```

or *Add Localization IDs to All Files* in the palette (Ctrl+P). The first adds an id to each line that lacks one:

```vn
  mina: You're waiting for the {i}last{/i} train too? #j3oe
```

The second writes the source text of every string to `locale/en.json` (the file is named for `"language"` in
`game.json`, `en` by default). The ids are in your scripts and are meant to be committed. Do not renumber them.

## 2. Translate

Open **Translate** in the editor. It lists every string with the source on the left and an editable cell for the language
you choose on the right. Add a language from the dropdown; it creates `locale/<lang>.json`. The dialog also shows
which strings are missing, and which translations were made against older source text (*source changed*). Entries whose
line was deleted (its id is gone from the scripts) are counted as *unused*, and **Remove unused** deletes them from the file.

The menus (New game, Load, Options) translate through `ui.<key>` entries in the same file; the dialog lists them too.
Fonts per language are set in the theme (`tokens.fonts`), for scripts such as Japanese.

The player picks a language in Options. A translation file is only loaded when it is picked.

## 3. Check it

The Build dialog warns about *untranslated* strings and about translations made for older wording, per language. Ship
only some languages with the dialog's ticks (or `--locales fi,ja` on the command line); the rest are not checked.
Conditions, `[variables]` and `{tags}` inside strings are part of the translation: keep them in the translated text.

## 4. Voice

A recording named after a line's id plays when the line appears:

```
assets/voice/j3oe.ogg          the default take
assets/voice/j3oe.fi.ogg       a Finnish take, for players who chose Finnish voice
```

There is no script command. The **Voice** dialog lists every line, one voice language at a time, with its state
(no recording, recorded, outdated). Drop an audio file on a row, or press *Add file...*. *Recording script (CSV)*
downloads the lines to record for a voice actor, with the file name to deliver each take as. Auto-advance waits for a
recording to finish, and the Options menu has a Voice volume slider.

If you reword a line after recording it, the dialog marks the take **outdated** and shows what changed. *Still fine*
keeps it. The list of voice languages is `voiceLanguages` in `game.json`.

## More

- Plural forms, number formats and per-language rules: [commands](../../commands.md#speech-and-narration) (see
  `[n:coin|coins]`).
- Menu labels and `labels` overrides: [game.json](../../game-json.md#labels).
- `language`, `voiceLanguages` and the build check levels: [game.json](../../game-json.md).
