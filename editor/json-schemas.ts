// The JSON schemas behind completions, hover docs and validation in Monaco's JSON tabs: game.json, theme files and
// each open character's rig.json. Rebuilt from the compiled program and the project's assets (see updateGameSchema).

import { EASE_NAMES, partName, QUICK_ITEMS, UI_COMPONENTS, type RigManifest } from '../engine/src/index.js';
import { files, GAME_URI, S } from './state.js';

declare const monaco: any;

const LABEL_KEYS = ['new_game', 'continue', 'load', 'save', 'options', 'resume', 'main_menu', 'master_volume', 'music_volume',
  'sound_volume', 'voice_volume', 'text_speed', 'auto_advance', 'skip_mode', 'skip_read', 'skip_all', 'language', 'fullscreen', 'back',
  'yes', 'no', 'instant', 'slow', 'normal', 'fast', 'slot', 'page', 'auto', 'auto_short', 'quick', 'quick_short',
  'choice', 'choice_short', 'choice_saves', 'empty_slot', 'delete', 'save_failed', 'confirm_overwrite', 'confirm_load', 'confirm_old_save', 'confirm_delete', 'confirm_title', 'reset_progress', 'confirm_reset', 'toast_reset', 'crash_title', 'crash_text', 'crash_copy', 'crash_copied', 'crash_to_title',
  'confirm_qload', 'history', 'history_empty', 'save_name', 'cancel', 'rename', 'toast_qsaved', 'toast_saved', 'toast_no_qsave', 'toast_skip_unread', 'toast_pad_on', 'toast_pad_nonstandard', 'toast_pad_off', 'text_sounds', 'text_size', 'box_opacity', 'reduce_motion', 'speaker_focus', 'timed_choices', 'timed_extended', 'timed_off', 'timed_announce', 'tab_audio', 'tab_game', 'tab_access', 'on', 'off',
  'gallery', 'locked', 'music_room', 'chapters', 'stop', 'achievements', 'endings', 'achievement_unlocked', 'ending_reached', 'end_title', 'end_hint', 'hidden_achievement', 'rotate_device',
  'theme', 'voice_language', 'sound_captions', 'announce_lines', 'voice_same',
  ...QUICK_ITEMS.map(i => `q_${i}`)];

const used = (op: string, key: string) => S.program.ops.flatMap((o: any) => (o.op === op && o[key] ? [o[key] as string] : []));
const names = (a: string[]) => [...new Set(a)].sort();
const num = (description: string) => ({ type: 'number', description });

const box = (what: string, placed: boolean) => ({
  type: 'object',
  additionalProperties: false,
  description: what,
  properties: {
    ...(placed ? {
      x: num('Left edge in stage pixels.'), y: num('Top edge in stage pixels.'),
    } : {}),
    width: num('Width in pixels.'), height: num('Minimum height in pixels.'),
    padding: { description: 'Pixels: one number, or [top, right, bottom, left].', oneOf: [{ type: 'number' }, { type: 'array', items: { type: 'number' } }] },
    background: { type: 'string', description: 'CSS color, e.g. "rgba(10,13,19,.84)".' },
    border: { type: 'string', description: 'Border color.' },
    radius: num('Corner radius in pixels.'),
    image: { type: 'string', description: 'Frame art: assets/ui/<image>.png (from masters/ui/<image>.psd). Replaces background.', examples: S.assetNames.ui },
    slice: { description: 'Edge pixels of the image that do not stretch (9-slice): one number or [top, right, bottom, left].', oneOf: [{ type: 'number' }, { type: 'array', items: { type: 'number' } }] },
  },
});

function storyText() {
  return {
    type: 'object', additionalProperties: false, description: 'Story text.',
    properties: { size: num('Font size in pixels (44).'), color: { type: 'string' }, lineHeight: num('Line height multiplier (1.45).'),
      lines: { type: 'integer', minimum: 1, description: 'Lines the text box shows at once (3); a longer line is split into pages.' } },
  };
}

const skin = (what: string) => ({
  type: 'object', additionalProperties: false, description: what,
  properties: {
    textbox: box('The text box. Position with x/y/width/height.', true),
    namebox: { ...box('The name tag; x/y are relative to the text box.', true), properties: { ...box('', true).properties, size: num('Font size in pixels.') } },
    text: storyText(),
  },
});

/** A text sound voice (game.json "blips"). */
function voiceSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    description: 'A text sound voice. Use it with `define <char> ... blip=<name>`.',
    properties: {
      synth: { enum: ['square', 'triangle', 'sine', 'sawtooth'], description: 'Synthesized blip (no sound file needed).' },
      pitch: num('Synth pitch in Hz (440). Lower for deeper voices.'),
      sound: { type: 'string', description: 'Or a sample: assets/sound/<sound>.', examples: S.assetNames.sound },
      vowels: {
        type: 'object', additionalProperties: false, description: 'Vowel mode: a sample per vowel (assets/sound/<name>).',
        properties: Object.fromEntries(['a', 'e', 'i', 'o', 'u'].map(v => [v, { type: 'string', examples: S.assetNames.sound }])),
      },
      mode: { enum: ['letters', 'vowels'], default: 'letters', description: 'letters: a blip per letter. vowels: only on vowels, pitched per vowel.' },
      every: num('Blip on every Nth letter (1).'),
      interval: num('Minimum milliseconds between blips (55).'),
      variation: num('Random pitch spread in semitones (0).'),
      volume: num('0..1 (0.25 for synth, 0.8 for samples).'),
      length: num('Synth blip length in milliseconds (45).'),
    },
  };
}

/** Identity and stage size. */
function basicsProperties() {
  return {
    title: { type: 'string', description: 'Game name, shown on the title screen.' },
    icon: { type: 'string', description: 'The game\'s icon: assets/ui/<icon>.png, square, 256x256 or larger. The desktop app\'s exe and window icon and the web build\'s favicon.', examples: S.assetNames.ui },
    version: { type: 'string', pattern: '^\\d{1,5}(\\.\\d{1,5}){0,3}$', description: 'The game\'s version, like "1.0" or "1.2.3": the desktop app\'s version info. Separate from saveVersion.', examples: ['1.0'] },
    id: { type: 'string', description: 'Key for saves, settings and read-text tracking. Defaults to a slug of `title`. Changing it starts with fresh saves.' },
    engine: { type: 'string', description: 'Minimum engine version, e.g. "0.1". The tools warn when the engine is older.' },
    stage: {
      type: 'object',
      additionalProperties: false,
      description: 'The stage size in pixels (default 1920x1080). Screens, hotspots and image coordinates are in these pixels; reload the preview after changing it.',
      properties: { width: { type: 'integer', minimum: 64, maximum: 8192 }, height: { type: 'integer', minimum: 64, maximum: 8192 } },
      required: ['width', 'height'],
    },
  };
}

/** Title screen, intro, splash cards, anchors and positions. */
function startupProperties() {
  return {
    titleScreen: {
      type: 'object',
      additionalProperties: false,
      description: 'Title screen. Preview it from "Built-in screens" in the Files panel (or Ctrl+Enter in this tab).',
      properties: {
        background: {
          type: 'string', description: 'Scene name drawn behind the menu (assets/bg/<name>.png).',
          examples: names([...used('scene', 'bg'), ...S.assetNames.bg]),
        },
        music: {
          type: 'string', description: 'Looping track for the title screen (assets/music/<name>.*).',
          examples: names([...used('music', 'name'), ...S.assetNames.music]),
        },
        showTitle: { type: 'boolean', default: true, description: 'Show the game name (turn off when the background art has a logo).' },
        align: { enum: ['left', 'center', 'right'], default: 'center', description: 'Where the title and buttons sit.' },
        buttons: {
          type: 'array', uniqueItems: true,
          description: 'Buttons in order. Leave one out to hide it.',
          items: { enum: ['new_game', 'continue', 'load', 'gallery', 'music_room', 'chapters', 'achievements', 'options'] },
        },
        fade: { type: 'number', minimum: 0, maximum: 5, default: 0.4, description: 'Seconds of black between the title screen and the game, both ways (0 = cut).' },
      },
    },
    intro: {
      type: 'string',
      description: 'A script label played once when the game starts, before the title screen (a cutscene; finish it with `end`). Esc skips it. Preview with the "Intro" command.',
      examples: names(Object.keys(S.program.labels ?? {})),
    },
    splash: {
      type: 'array',
      description: 'Logo cards shown once when the game starts, before the title screen. Click or Enter skips a card. Preview with the "Splash" command.',
      items: {
        anyOf: [
          { type: 'string', description: 'Background name (assets/bg/<name>.png).', examples: names([...used('scene', 'bg'), ...S.assetNames.bg]) },
          {
            type: 'object', additionalProperties: false,
            properties: {
              image: { type: 'string', description: 'Background name, centered on black.', examples: names([...used('scene', 'bg'), ...S.assetNames.bg]) },
              text: { type: 'string', description: 'Text under the image (or alone).' },
              duration: { type: 'number', minimum: 0, default: 2.5, description: 'Seconds the card stays fully visible.' },
              fade: { type: 'number', minimum: 0, default: 0.6, description: 'Seconds to fade in, and again to fade out.' },
            },
          },
        ],
      },
    },
    anchors: {
      type: 'object',
      description: 'Extra named anchors for "anchor=<name>" on show and move: the point a character scales, turns and mirrors about, as [fx, fy] fractions of its sprite (0,0 top left, 1,1 bottom right). Built in: feet [0.5, 1], center [0.5, 0.5], head [0.5, 0.1], top [0.5, 0].',
      additionalProperties: {
        type: 'array', minItems: 2, maxItems: 2, items: { type: 'number' },
        description: '[fx, fy]: across (0 left, 1 right) and down (0 top, 1 bottom) the sprite.',
      },
    },
    positions: {
      type: 'object',
      description: 'Extra named stage positions for "show ... at <name>" and "move ... to <name>": 0 is the left edge, 1 the right edge. A position can also set a height ({ "x": 0.7, "y": -0.15 }; negative lifts) that a line\'s own y= overrides. Built in: left (0.2), center (0.5), right (0.8).',
      additionalProperties: {
        anyOf: [
          { type: 'number', description: 'Across the stage, 0 (left edge) to 1 (right edge).' },
          {
            type: 'object', additionalProperties: false, required: ['x'],
            properties: {
              x: { type: 'number', description: 'Across the stage, 0 (left edge) to 1 (right edge).' },
              y: { type: 'number', description: 'Height offset as a fraction of the stage height; negative lifts the character. Used by show and move unless the line has y=.' },
            },
          },
        ],
      },
      examples: [{ farleft: 0.08, leftcenter: 0.35, balcony: { x: 0.7, y: -0.15 } }],
    },
  };
}

/** Save and language settings. */
function saveProperties() {
  return {
    saveVersion: { type: 'integer', minimum: 0, default: 0, description: 'Raise this when a release breaks old saves: loading a save made under a lower number asks the player first.' },
    choiceSaves: { type: 'integer', minimum: 1, maximum: 20, default: 5, description: 'How many rotating choice autosaves to keep (the "C" page of the Load screen).' },
    saveNames: { type: 'boolean', default: false, description: 'The player names a save when making it in a numbered slot (the name shows on the save screen in place of "Slot 3"), and can rename it there. Auto, quick and choice saves are never asked for a name.' },
    voiceLanguages: { type: 'array', items: { type: 'string' }, description: 'Languages to record voice in (e.g. ["ja", "fi"]), listed in the Voice dialog and held to having a recording for every spoken line by the build checks, even before the first recording. Separate from the text translations in locale/<lang>.json. The source language is the default take and needs no entry.' },
    language: { type: 'string', default: 'en', description: 'The language the scripts are written in (default "en"). Other languages are translations in locale/<lang>.json. Players pick the text language, and separately the voice language, in the options.' },
    memoryBudgetMB: { type: 'number', exclusiveMinimum: 0, description: 'Memory budget for loaded images and audio, in MB (default 512, 256 on low-memory devices). The debug console command memory reports against it.' },
  };
}

/** Quick menu, gallery, music room, chapters and achievements. */
function extrasProperties() {
  return {
    quickMenu: {
      type: 'object',
      additionalProperties: false,
      description: 'The quick menu bar shown while playing.',
      properties: {
        items: {
          type: 'array', uniqueItems: true,
          description: 'Buttons in order; leave one out to hide it, use [] for no bar. Hotkeys work either way.',
          items: { enum: QUICK_ITEMS },
        },
        position: { enum: ['bottom', 'top'], default: 'bottom' },
        align: { enum: ['left', 'center', 'right'], default: 'center' },
      },
    },
    gallery: {
      type: 'array',
      description: 'Gallery entries (a Gallery button appears on the title screen). Each unlocks when its image has been shown while playing, or by "unlock <flag>".',
      items: {
        type: 'object', additionalProperties: false, required: ['image'],
        properties: {
          image: { type: 'string', description: 'Background name (assets/bg/<image>.png), e.g. a CG shown with "scene".', examples: names([...used('scene', 'bg'), ...S.assetNames.bg]) },
          title: { type: 'string' },
          unlock: { type: 'string', description: 'Unlock with this flag instead (script: unlock <flag>).', examples: names(used('unlock', 'name')) },
        },
      },
    },
    musicRoom: {
      type: 'array',
      description: 'Music room tracks (a Music button appears on the title screen). Each unlocks once it has played while playing, or by "unlock <flag>".',
      items: {
        anyOf: [
          { type: 'string', description: 'Track name (assets/music/<track>.*).', examples: names([...used('music', 'name'), ...S.assetNames.music]) },
          {
            type: 'object', additionalProperties: false, required: ['track'],
            properties: {
              track: { type: 'string', description: 'Track name (assets/music/<track>.*).', examples: names([...used('music', 'name'), ...S.assetNames.music]) },
              title: { type: 'string' },
              unlock: { type: 'string', description: 'Unlock with this flag instead (script: unlock <flag>).', examples: names(used('unlock', 'name')) },
            },
          },
        ],
      },
    },
    chapters: {
      type: 'array',
      description: 'Chapter select (a Chapters button appears on the title screen). Each starts a new playthrough at a label; it unlocks once the story has reached the label, or by "unlock <flag>".',
      items: {
        anyOf: [
          { type: 'string', description: 'Script label.', examples: names(Object.keys(S.program.labels ?? {})) },
          {
            type: 'object', additionalProperties: false, required: ['label'],
            properties: {
              label: { type: 'string', description: 'Script label to start at.', examples: names(Object.keys(S.program.labels ?? {})) },
              title: { type: 'string' },
              unlock: { type: 'string', description: 'Unlock with this flag instead (script: unlock <flag>).', examples: names(used('unlock', 'name')) },
            },
          },
        ],
      },
    },
    achievements: {
      type: 'array',
      description: 'Achievements and endings (an Achievements button appears on the title screen). Each unlocks when the script runs "unlock <flag>", and pops up a toast.',
      items: {
        anyOf: [
          { type: 'string', description: 'A flag (script: unlock <flag>), also the title.', examples: names(used('unlock', 'name')) },
          {
            type: 'object', additionalProperties: false, required: ['unlock'],
            properties: {
              unlock: { type: 'string', description: 'The flag that unlocks it (script: unlock <flag>).', examples: names(used('unlock', 'name')) },
              title: { type: 'string' },
              description: { type: 'string', description: 'What it is for; hidden ones show it only once unlocked.' },
              icon: { type: 'string', description: 'Image: assets/ui/<icon>.png, on the list and the toast.', examples: S.assetNames.ui },
              hidden: { type: 'boolean', description: 'Shown as "???" until unlocked.' },
              ending: { type: 'boolean', description: 'An ending: listed and counted apart from the achievements.' },
              toast: { type: 'boolean', description: 'false: unlock it quietly, with no toast.' },
            },
          },
        ],
      },
    },
    achievementToast: {
      type: 'object', additionalProperties: false,
      description: 'The stock toast an unlocked achievement pops up. Declare "screen achievement_toast" to draw your own (seconds and sound still apply).',
      properties: {
        position: { enum: ['topright', 'topleft', 'bottomright', 'bottomleft', 'top', 'bottom'], description: 'Where it shows (default topright).' },
        seconds: { type: 'number', exclusiveMinimum: 0, description: 'How long each one stays (default 4).' },
        sound: { type: 'string', description: 'Played as it appears: assets/sound/<sound>.', examples: S.assetNames.sound },
      },
    },
  };
}

/** Speaker focus, side images, text sound voices and menu labels. */
function dialogueProperties() {
  const characterBlips = names(Object.values(S.program.characters).flatMap((c: any) => (c.style?.blip ? [c.style.blip] : [])));
  return {
    speakerFocus: {
      description: 'Dim the characters who are not speaking. true for the defaults; players can turn it off in Options, scripts with "focus off", one character with "define ... focus=off".',
      oneOf: [{ type: 'boolean' }, {
        type: 'object', additionalProperties: false,
        properties: {
          dim: { type: 'number', minimum: 0, maximum: 1, description: 'How much darker the others get (default 0.35).' },
          fade: { type: 'number', minimum: 0, description: 'Seconds the change takes (default 0.2).' },
          front: { type: 'boolean', description: 'Draw the speaker in front of the others for the line (default false).' },
          offstage: { enum: ['lit', 'dim'], description: 'When the speaker is not on stage (narration): everyone lit (default) or everyone dimmed.' },
        },
      }],
    },
    sideImages: {
      description: 'The speaker portrait in the text box, for characters defined with "side=<name>" (assets/side/<name>.png, or <name>_<pose>.png while they are on stage in that pose). true for the defaults.',
      oneOf: [{ type: 'boolean' }, {
        type: 'object', additionalProperties: false,
        properties: {
          place: { enum: ['left', 'right'], description: 'Which end of the text box (default left).' },
          size: { type: 'number', exclusiveMinimum: 0, description: 'Portrait height in stage pixels (default 260).' },
          when: { enum: ['always', 'offstage'], description: 'always (default), or only while the speaker is not on stage.' },
        },
      }],
    },
    pwa: { type: 'boolean', description: 'The web export becomes an installable, offline app: a web manifest and a service worker that keeps the whole game on the player device (default false; it can be a lot of data).' },
    touch: {
      type: 'object', additionalProperties: false,
      description: 'Touch screens (docs/game-json.md). Players can still switch gestures off in Options.',
      properties: {
        gestures: { type: 'boolean', description: 'Swipe right = back, up = history, down = hide the interface; long press or two-finger tap = pause menu (default true). false for a game whose own screens need those swipes.' },
      },
    },
    blips: {
      type: 'object',
      description: 'Text sound voices by name. Built in: high, mid, low, soft, typewriter, robot (a voice here with the same name replaces it).',
      propertyNames: { examples: characterBlips },
      additionalProperties: voiceSchema(),
    },
    labels: {
      type: 'object',
      description: 'Menu label text in the source language. Other languages: "ui.<key>" in locale/<lang>.json.',
      additionalProperties: false,
      properties: Object.fromEntries(LABEL_KEYS.map(k => [k, { type: 'string' }])),
    },
  };
}

/** The look of the game: the name of a theme file. */
function themeProperty() {
  return {
    theme: { type: 'string', description: 'The name of a theme file: "night" uses themes/night.json.' },
  };
}

/** Install the schemas in Monaco; call when the program, the assets or the open files change. */
export function updateGameSchema() {
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      ...basicsProperties(),
      ...startupProperties(),
      ...saveProperties(),
      ...extrasProperties(),
      ...dialogueProperties(),
      ...themeProperty(),
    },
  };
  monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
    validate: true,
    schemas: [{ uri: 'vn://schema/game.json', fileMatch: [GAME_URI], schema }, ...rigSchemas(), ...themeSchemas()],
  });
}

/** The layered theme file (docs/game-json.md "theme"): tokens, components with states, screens, styles. */
function themeSchemas() {
  const num = (description: string) => ({ type: 'number', description });
  const str = (description: string) => ({ type: 'string', description });
  const look = {
    type: 'object',
    properties: {
      background: str('A CSS color.'), color: str('Text color.'), border: str('Border color.'), borderWidth: num('Pixels.'), radius: num('Corner radius in pixels.'),
      padding: { description: 'A number or a list of numbers, in pixels.', anyOf: [{ type: 'number' }, { type: 'array', items: { type: 'number' } }] },
      size: num('Font size in pixels.'), opacity: num('0 to 1.'), shadow: str('A CSS box-shadow.'), width: num('Pixels.'),
    },
  };
  const component = {
    ...look, properties: { ...look.properties, ...Object.fromEntries(['hover', 'focus', 'disabled', 'selected'].map(k => [k, { ...look, description: `What changes in the ${k} state.` }])) },
  };
  const keys = Object.entries(UI_COMPONENTS).flatMap(([k, c]) => [k, ...Object.keys(c.variants ?? {}).map(v => `${k}.${v}`)]);
  const components = Object.fromEntries(keys.map(k => [k, component]));
  const colorToken = (d: string) => str(d);
  const schema = {
    type: 'object',
    properties: {
      extends: str('Another theme file (its name) or the built-in "base"; values here win.'),
      tokens: {
        type: 'object',
        properties: {
          accent: colorToken('Highlight color.'), font: str('Story text and menu font.'), uiFont: str('Menu font (default: font).'),
          fonts: { type: 'object', description: 'A font per language code, e.g. {"ja": "Noto Sans JP"}; replaces font and uiFont in that language.', additionalProperties: { type: 'string' } },
          text: colorToken('Text color.'), muted: colorToken('Secondary text color.'), surface: colorToken('Panel and button background.'),
          line: colorToken('Border color.'), danger: colorToken('Destructive actions.'), warn: colorToken('Warnings.'),
          radius: num('Corner radius in pixels.'), borderWidth: num('Border width in pixels (default 2).'),
          gap: num('Spacing in menu columns (default 18).'), uiSize: num('Menu text size in pixels (default 40).'),
        },
      },
      components: { type: 'object', properties: { ...components, textbox: { type: 'object' }, namebox: { type: 'object' }, text: { type: 'object' }, choice: { type: 'object' }, hotspot: { type: 'object' }, tooltip: { type: 'object' } } },
      screens: { type: 'object', description: 'The same components inside one built-in screen.', additionalProperties: { type: 'object', properties: components } },
      styles: { type: 'object', description: 'Named styles (the old "skins"): define ... style=, style= on lines, menus and screen buttons.', additionalProperties: { type: 'object' } },
    },
  };
  return [...files.values()].filter(f => f.kind === 'theme').map(f => ({ uri: `vn://schema/theme/${f.char}`, fileMatch: [`file:///${f.name}`], schema }));
}

/** What the rig.json schema sections share: the character's parts and slots, the names to offer for bones and variants. */
interface RigSchemaContext { manifest: RigManifest; slots: RigManifest['parts']; variants: (slot: string) => string[]; everyVariant: string[]; boneNames: string[] }

const str = (description: string, examples: string[]) => ({ type: 'string', description, examples });

const rigOrder = ({ manifest }: RigSchemaContext) => (
  {
    type: 'array',
    description: 'Part names bottom to top. Listed parts swap among the positions they hold; the rest stay where the PSD had them.',
    items: str('A slot, or a plain layer\'s file name without .png.', manifest.parts.map(partName)),
  }
);

const rigBones = ({ boneNames }: RigSchemaContext) => (
  {
    type: 'object',
    description: 'The bone tree: transform nodes with a parent and a pivot. A key or `animate ... part=` naming a bone moves it and everything below it.',
    additionalProperties: {
      type: 'object',
      additionalProperties: false,
      properties: {
        parent: str('Another bone; without one the bone hangs from the character.', boneNames),
        pivot: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number' }, description: 'Where it turns, [x, y] in pixels of the PSD canvas. Without one: its parent\'s.' },
        tip: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number' }, description: 'Where the bone ends, [x, y] in pixels of the PSD canvas. Moves nothing: it shapes auto-weights for skinned meshes.' },
      },
    },
  }
);

const rigParts = ({ manifest, boneNames }: RigSchemaContext) => {
  const names = manifest.parts.map(partName);
  const entry = (what: string) => ({
    type: 'object',
    additionalProperties: false,
    properties: {
      bone: str(`The bone ${what} sits on.`, boneNames),
      pivot: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number' }, description: 'A pivot of its own, when it must turn about another point than its bone\'s.' },
      clip: str('The shape part or image part this part is clipped to.', names),
      polygon: { type: 'array', description: 'A shape part (it has no art): its outline, points [x, y] in pixels of the PSD canvas.', items: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number' } } },
      follow: str('A shape part: the image part whose drawn mesh bends it.', names),
      keyforms: { type: 'array', description: 'A shape part: per-vertex displacements driven by parameters.', items: { type: 'object' } },
    },
  });
  return {
    type: 'object',
    description: 'Which bone each part sits on (and a pivot of its own for a part that must turn about another point than its bone\'s). A name that is no part of the PSD is a shape part: give it a "polygon".',
    properties: Object.fromEntries(manifest.parts.map(p => [partName(p), entry(partName(p))])),
    additionalProperties: entry('this shape part'),
  };
};

/** A deformer's free mesh; `weights` and `defaultBone` skin it to the bones (at most 4 per vertex). */
const rigMesh = (boneNames: string[]) => ({
  type: 'object',
  description: 'A free mesh in place of a lattice: verts, tris, and optionally bone weights.',
  properties: {
    verts: { type: 'array', items: { type: 'number' } }, tris: { type: 'array', items: { type: 'number' } }, detail: { type: 'string' },
    defaultBone: str('The bone a vertex without weights binds to (a skinned mesh).', boneNames),
    weights: {
      type: 'object',
      description: 'Skinning: vertex number to { bone: weight }, at most 4 bones, normalized when read. A vertex not listed binds to defaultBone. The part\'s own bone does not move a skinned mesh.',
      additionalProperties: { type: 'object', additionalProperties: { type: 'number', exclusiveMinimum: 0 } },
    },
  },
});

/** The parameter model and secondary motion: what the animation studio writes. Their contents are checked by the engine (checkRig), not here. */
const rigModel = ({ boneNames }: RigSchemaContext) => ({
  categories: { type: 'array', description: "The Parameters panel's groups, in order: a parameter or pad names one in its \"group\".", items: { type: 'string' } },
  parameters: {
    type: 'array',
    description: 'Named scalars that drive keyforms and poses.',
    items: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string' }, min: { type: 'number' }, max: { type: 'number' }, default: { type: 'number' },
        group: { type: 'string', description: 'One of "categories".' }, ease: { type: 'string', enum: EASE_NAMES },
      },
    },
  },
  pads: { type: 'array', description: '2D controls over two parameters: a UI grouping only.', items: { type: 'object', properties: { id: { type: 'string' }, x: { type: 'string' }, y: { type: 'string' }, group: { type: 'string' } } } },
  poses: { type: 'object', description: 'Named snapshots of some parameters ({ "happy": { "mouth_smile": 1 } }), set with `show <char> pose=happy`.', additionalProperties: { type: 'object', additionalProperties: { type: 'number' } } },
  keyforms: { type: 'array', description: 'Authored poses of a bone or part at chosen parameter values, blended.', items: { type: 'object' } },
  deformers: { type: 'array', description: 'Lattices that warp a part\'s mesh (or a group of parts), driven by parameters.', items: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, mesh: rigMesh(boneNames) } } },
  physics: { type: 'object', description: 'Secondary motion: chains by id, reading parameters or bone channels and writing parameters or a part\'s rotation.', additionalProperties: { type: 'object' } },
});

const rigLooks = ({ slots, variants, everyVariant }: RigSchemaContext) => (
  {
    type: 'object',
    description: 'Named maps from slots to variants for `show` (`show mina shy casual`): later looks win per slot, and slot=variant on the show line wins over all. A variant of none hides the slot.',
    additionalProperties: {
      type: 'object',
      properties: {
        look: str('Another look, applied first: one of these looks, or a layer name or alias from the PSD.', everyVariant),
        ...Object.fromEntries(slots.map(p => [p.slot!, str(`Variant of ${p.slot}, or none.`, variants(p.slot!))])),
      },
      additionalProperties: { type: 'string' },
    },
  }
);

const rigPivots = ({ manifest }: RigSchemaContext) => (
  {
    type: 'object',
    description: 'Where a part turns and scales from, in pixels of the PSD canvas ([x, y] from the top left). Without one it is the middle of the part\'s image.',
    additionalProperties: false,
    properties: Object.fromEntries(manifest.parts.map(p => [partName(p), { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number' }, description: `Pivot of ${partName(p)}: [x, y].` }])),
  }
);

const rigReactions = ({ manifest }: RigSchemaContext) => (
  {
    type: 'array',
    description: 'Poses the character holds while a condition is true. The first entry whose "when" holds wins; none holds: the parameters return to what the script set.',
    items: {
      type: 'object',
      required: ['when', 'pose'],
      additionalProperties: false,
      properties: {
        when: { type: 'string', description: "A condition in the script's expression language: story variables, speaking, always, param.<id> (a parameter's base value)." },
        pose: str('The pose to hold (one of "poses").', Object.keys(manifest.rig?.poses ?? {})),
        over: { type: 'number', minimum: 0, description: 'Seconds the move into the pose takes (default 0.4).' },
        ease: { type: 'string', enum: EASE_NAMES, description: 'Easing of that move.' },
      },
    },
  }
);

const rigAuto = (
  {
    type: 'object',
    description: 'When the animation starts by itself: "every" (a random or fixed wait after each run) and/or "while" (it loops while the condition holds). "behaviors off" in the script suspends it.',
    additionalProperties: false,
    properties: {
      every: {
        description: 'Seconds to wait after each run: { "min", "max" } for a random wait, or one number for a fixed wait.',
        oneOf: [
          { type: 'number', exclusiveMinimum: 0 },
          { type: 'object', required: ['min', 'max'], additionalProperties: false, properties: { min: { type: 'number', exclusiveMinimum: 0 }, max: { type: 'number', exclusiveMinimum: 0 } } },
        ],
      },
      while: { type: 'string', description: "A condition in the script's expression language: story variables, speaking (one of its lines is typing), always, param.<id>.", examples: ['always', 'speaking'] },
    },
  }
);

const rigAnimations = ({ manifest }: RigSchemaContext) => (
  {
    type: 'object',
    description: 'Keyframe animations for `animate <char> <name>`. A name equal to a preset (bob, sway...) replaces it for this character.',
    additionalProperties: {
      type: 'object',
      required: ['keys'],
      additionalProperties: false,
      properties: {
        dur: { type: 'number', exclusiveMinimum: 0, description: 'Default length in seconds (1 when left out); `animate` can give another.' },
        auto: rigAuto,
        params: {
          type: 'object',
          description: 'Parameter tracks: a parameter id to its keys { t, v, ease }.',
          additionalProperties: { type: 'array', items: { type: 'object', required: ['t', 'v'], properties: { t: { type: 'number', minimum: 0, maximum: 1 }, v: { type: 'number' }, ease: { type: 'string', enum: EASE_NAMES } } } },
        },
        frames: { type: 'array', description: 'Frame tracks: a slot swapped between variants as the animation runs.', items: { type: 'object', required: ['slot'], properties: { slot: { type: 'string' } } } },
        physicsOff: { description: 'While it plays, the physics chains are bypassed: true for all, or the listed chain ids.', oneOf: [{ type: 'boolean' }, { type: 'array', items: { type: 'string' } }] },
        keys: {
          type: 'array',
          description: 'Keys at progress t (0-1), empty for an animation of parameters or frames only. Each channel is eased between its own keys and is 0 at both ends unless a key says otherwise.',
          items: {
            type: 'object',
            required: ['t'],
            additionalProperties: false,
            properties: {
              t: { type: 'number', minimum: 0, maximum: 1, description: 'Progress through the animation, 0 to 1.' },
              part: str('Move this part of the character (about its pivot) instead of the whole body.', manifest.parts.map(partName)),
              x: { type: 'number', description: 'Sideways offset, as a fraction of the stage height.' },
              y: { type: 'number', description: 'Vertical offset, as a fraction of the stage height (negative = up).' },
              scale: { type: 'number', description: 'Added to the size: 0.05 is 5% bigger.' },
              opacity: { type: 'number', minimum: 0, description: 'A factor on the alpha: 1 as drawn, 0 gone. Rests at 1 (not 0) at both ends.' },
              rot: { type: 'number', description: 'Tilt in degrees, clockwise.' },
              ease: { type: 'string', enum: EASE_NAMES, description: 'Easing of the way to this key (default inout).' },
            },
          },
        },
      },
    },
  }
);

/** One schema per open rig.json tab, so completions offer that character's parts, slots and variants. */
function rigSchemas() {
  return [...files.values()].flatMap(f => {
    const manifest = f.kind === 'rig' && f.char ? S.projectAssets.rigs[f.char] : undefined;
    if (!manifest) return [];
    const slots = manifest.parts.filter(p => p.slot && p.variants);
    let boneNames: string[] = [];
    try { boneNames = Object.keys(JSON.parse(f.model.getValue()).bones ?? {}); } catch { /* the file does not parse yet: no names to offer */ }
    const ctx: RigSchemaContext = {
      manifest, slots, boneNames,
      variants: slot => [...Object.keys(slots.find(p => p.slot === slot)?.variants ?? {}), 'none'],
      everyVariant: [...new Set(slots.flatMap(p => Object.entries(p.variants!).flatMap(([n, v]) => [n, ...(v.poses ?? [])])))],
    };
    return [{
      uri: `vn://schema/rig/${f.char}`,
      fileMatch: [`file:///${f.name}`],
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          order: rigOrder(ctx), bones: rigBones(ctx), parts: rigParts(ctx), looks: rigLooks(ctx),
          pivots: rigPivots(ctx), animations: rigAnimations(ctx), reactions: rigReactions(ctx), ...rigModel(ctx),
        },
      },
    }];
  });
}
