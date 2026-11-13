// What a program needs from the project's files.
//  - checkAssets cross-checks a compiled program against them: backgrounds, character poses and slots
//    (from the PSD converter's sprite.json), music, sounds, blip voices and text box skins. Missing art and
//    audio are only reported once a folder has files at all, so a prototype running on placeholders stays
//    quiet; typos in blip voices and skins are always reported.
//  - planPreloads walks the story's control flow and attaches preload tasks to it, so the shell can load
//    art and audio shortly before the ops that use them.
// Asset keys: images are the file path without extension ("bg/park", "char/bo/grin", or "park" at the root),
// audio is "music/<name>" or "sound/<name>".

import type { CharacterDef, Diagnostic, DisplayState, FallThroughOp, ImageState, Op, Preload, PreloadTask, Program, SpriteState, Src } from './types.js';
import { ANIM_NAMES, resolveAnim } from './anim.js';
import { anchorProblem } from './anchor.js';
import { captionProblem } from './captions.js';
import { positionProblem } from './positions.js';
import { stageProblem } from './stage.js';
import { speakerFocusProblems } from './focus.js';
import { sideImageProblems } from './side.js';
import { touchProblems } from './gesture.js';
import { pwaProblem } from './pwa.js';
import { iconAsset, versionProblem } from './app-info.js';
import { hudLabels, isClickable, walkNodes, type ScreenNode } from './screens.js';
import { expandShow, showLooks, liveOverrides, orderedParts, partName, rigPartNames, rigLookNames, type RigData } from './rig.js';
import { closest, didYouMean, withFix } from './suggest.js';
import { splitVoiceName } from './voice.js';
import { buildCheckSettings } from './build-checks.js';
import { isCssColor } from './colors.js';
import { expandTokenRefs } from './theme.js';
import { AUDIO_FILE, FONT_FILE, IMAGE_FILE, MOVIE_FILE } from './asset-kinds.js';

/** One image of a layered character, or a slot with its variants (bottom to top in `parts`). */
export interface RigPart {
  file?: string;
  x?: number;
  y?: number;
  slot?: string;
  default?: string | null;
  variants?: Record<string, { file?: string; x?: number; y?: number; poses?: string[] }>;
  /** The `+folders` of the PSD it sat in, outermost first, joined by `/` (the converter writes it; rigSkeleton makes bones of it). */
  group?: string;
}
/** assets/char/<char>/sprite.json, written by tools/psd-convert.mjs. */
export interface RigManifest {
  width?: number;
  height?: number;
  parts: RigPart[];
  /** A flat character (one image per pose) that has a rig.json but no sprite.json: only its animations, idle and speak apply. */
  flat?: boolean;
  /** assets/char/<char>/rig.json, attached by tools/project-data.mjs (see rig.ts). */
  rig?: RigData;
}

export interface AssetIndex {
  files: string[];                     // paths under assets/, e.g. "bg/park.png"
  rigs?: Record<string, RigManifest>;  // by character id
  blips?: string[];                    // voice names from game.json "blips"
  skins?: string[];                    // game.json theme.skins names
  /** Style names of each theme the player can pick (game.json `themes`), by theme name. */
  themeSkins?: Record<string, string[]>;
}

/** Built-in text sound voices (preview/blips.ts). */
export const BLIP_PRESETS = ['high', 'mid', 'low', 'soft', 'typewriter', 'robot', 'none'];


type Warn = (src: Src, message: string, word?: string, known?: Iterable<string>, otherwise?: string) => void;

/** The asset names the checks look things up in: by folder, and the slots of each layered character. */
function assetNames(index: AssetIndex) {
  // Names by folder: "bg/park.png" -> bg: park; images at the root also count as backgrounds.
  const names = (dir: string, ext: RegExp) => new Set(index.files.flatMap(f => {
    const parts = f.split('/');
    return parts.length === 2 && parts[0] === dir && ext.test(f) ? [parts[1].replace(/\.[^.]+$/, '')] : [];
  }));
  const bgs = names('bg', IMAGE_FILE);
  for (const f of index.files) if (!f.includes('/') && IMAGE_FILE.test(f)) bgs.add(f.replace(/\.[^.]+$/, ''));
  const masks = names('transitions', IMAGE_FILE);
  const music = names('music', AUDIO_FILE), sounds = names('sound', AUDIO_FILE), movies = names('movie', MOVIE_FILE);
  const charImages = (char: string) => new Set(index.files.flatMap(f => {
    const parts = f.split('/');
    return parts.length === 3 && parts[0] === 'char' && parts[1] === char && IMAGE_FILE.test(f) ? [parts[2].replace(/\.[^.]+$/, '')] : [];
  }));

  // Layered characters: which slot variants exist.
  const rigs = new Map<string, { slots: Map<string, Set<string>> }>();
  for (const [char, rig] of Object.entries(index.rigs ?? {})) {
    if (rig.flat) continue;
    const slots = new Map<string, Set<string>>();
    for (const p of rig.parts ?? []) {
      if (!p.slot || !p.variants) continue;
      slots.set(p.slot, new Set(Object.keys(p.variants)));
    }
    rigs.set(char, { slots });
  }

  return { bgs, masks, music, sounds, movies, charImages, rigs };
}
type AssetNames = ReturnType<typeof assetNames>;

/** Backgrounds, masks, characters, poses, animations, music, sounds and movies the ops name. */
function checkOps(program: Program, index: AssetIndex, names: AssetNames, warn: Warn) {
  const { bgs, masks, music, sounds, movies, charImages, rigs } = names;
  /** `pose=` names and `animate <char> p=v` parameters against the character's rig.json (a character without a rig is not checked). */
  const checkPoseOp = (src: Src, char: string, poses: string[], values: Record<string, number>) => {
    const rig = index.rigs?.[char]?.rig;
    if (!rig || (!poses.length && !Object.keys(values).length)) return;
    const own = Object.keys(rig.poses ?? {}), ids = (rig.parameters ?? []).map(p => p.id);
    for (const p of poses) if (!own.includes(p)) warn(src, `${char} has no pose "${p}"`, p, own, ` (${own.join(', ') || 'none: add poses to its rig.json'})`);
    for (const [id, v] of Object.entries(values)) {
      const def = (rig.parameters ?? []).find(p => p.id === id);
      if (!def) warn(src, `${char} has no parameter "${id}"`, id, ids, ` (${ids.join(', ') || 'none: add parameters to its rig.json'})`);
      else if (v < def.min || v > def.max) warn(src, `${id} of ${char} runs from ${def.min} to ${def.max}, not ${v} (it is clamped)`);
    }
  };

  for (const op of program.ops) {
    switch (op.op) {
      case 'scene':
        if (bgs.size && !bgs.has(op.bg)) warn(op.src, `No background "${op.bg}" in assets/bg`, op.bg, bgs, ' (a placeholder is drawn)');
        if (op.mask && !masks.has(op.mask)) warn(op.src, `No mask "${op.mask}" in assets/transitions`, op.mask, masks, ' (a plain dissolve is used)');
        break;
      case 'show': {
        const rig = rigs.get(op.char);
        if (rig) {
          const shown = expandShow(index.rigs![op.char], showLooks(op), op.overrides); // rig.json looks and PSD tags
          for (const problem of shown.problems) warn(op.src, `${op.char}: ${problem}`);
          for (const word of shown.unknown) warn(op.src, `${op.char} has no layer named or aliased "${word}"`, word, rigLookNames(index.rigs![op.char]), ' (see its PSD)');
          for (const [slot, value] of Object.entries(shown.overrides)) {
            const variants = rig.slots.get(slot);
            if (!variants) warn(op.src, `${op.char} has no slot "${slot}" (slots: ${[...rig.slots.keys()].join(', ') || 'none'})`);
            else if (value !== 'none' && !variants.has(value)) warn(op.src, `Slot "${slot}" of ${op.char} has no variant "${value}" (${[...variants].join(', ')})`);
          }
        } else if (op.pose) {
          const images = charImages(op.char);
          if (images.size && !images.has(op.pose)) warn(op.src, `No image for ${op.char} "${op.pose}" in assets/char/${op.char}`, op.pose, images);
        }
        checkPoseOp(op.src, op.char, op.poses ?? [], {});
        break;
      }
      case 'param':
        checkPoseOp(op.src, op.char, op.poses, op.params);
        break;
      case 'animate': {
        const rigOf = index.rigs?.[op.char], parts = rigOf ? rigPartNames(rigOf) : [];
        if (op.part && !parts.includes(op.part)) warn(op.src, `${op.char} has no part "${op.part}"`, op.part, parts, ` (parts: ${parts.join(', ') || 'none: only layered characters have parts'})`);
        if (op.name !== null && Object.hasOwn(index.rigs?.[op.char]?.rig?.animations ?? {}, op.name) && (Object.hasOwn(program.transforms ?? {}, op.name) || Object.hasOwn(program.dynamicTransforms ?? {}, op.name))) {
          warn(op.src, `${op.char} has its own "${op.name}" animation in rig.json, which wins over the script's transform of that name`);
        }
        if (op.name === null || resolveAnim(op.name, { ...program.transforms, ...Object.fromEntries(Object.keys(program.dynamicTransforms ?? {}).map(k => [k, { keys: [] }])), ...index.rigs?.[op.char]?.rig?.animations })) break;
        const own = [...Object.keys(program.transforms ?? {}), ...Object.keys(program.dynamicTransforms ?? {}), ...Object.keys(index.rigs?.[op.char]?.rig?.animations ?? {})];
        warn(op.src, `${op.char} has no animation "${op.name}"`, op.name, [...ANIM_NAMES, ...own], ` (${[...ANIM_NAMES, ...own].join(', ')})`);
        break;
      }
      case 'music':
        if (op.name && !music.has(op.name)) warn(op.src, `No track "${op.name}" in assets/music`, op.name, music);
        break;
      case 'sound':
        if (op.name && !sounds.has(op.name)) warn(op.src, `No sound "${op.name}" in assets/sound`, op.name, sounds);
        break;
      case 'movie':
        if (!movies.has(op.name)) warn(op.src, `No movie "${op.name}" in assets/movie`, op.name, movies);
        break;
    }
  }
}

/** Recordings named after no line: the id was edited or the line removed, so the file never plays. */
function checkVoiceFiles(program: Program, index: AssetIndex, out: Diagnostic[]) {
  const lineIds = new Set<string>();
  for (const op of program.ops) if (op.op === 'say' && op.id) lineIds.add(op.id);
  for (const f of index.files) {
    const v = voiceId(f);
    if (v && !lineIds.has(v)) out.push({ file: `assets/${f}`, line: 1, severity: 'warning', message: `Voice file matches no dialogue line id "${v}" (it never plays)` });
  }
}

/** A style the script uses that the theme, or a theme the player can pick, does not define. */
function styleChecker(index: AssetIndex, warn: Warn) {
  const skins = new Set(index.skins ?? []);
  return (src: Src, style: string) => {
    if (style === 'title') return; // the default title screen's game name: the theme's `title` component reaches it
    if (!skins.has(style)) return warn(src, `No style "${style}" (add it to the theme's styles)`);
    const lacking = Object.entries(index.themeSkins ?? {}).filter(([, names]) => !names.includes(style)).map(([n]) => n);
    if (lacking.length) warn(src, `Style "${style}" is missing from the selectable theme${lacking.length > 1 ? 's' : ''} ${lacking.join(', ')}`);
  };
}

/** Screens and items: images that do not exist (only reported once there are images at all, like backgrounds), hover sounds and styles. */
function checkImages(program: Program, index: AssetIndex, sounds: Set<string>, warn: Warn, styleProblem: (src: Src, style: string) => void) {
  const imageKeys = new Set(index.files.filter(f => IMAGE_FILE.test(f)).map(f => f.replace(IMAGE_FILE, '')));
  for (const f of index.files) if (MOVIE_FILE.test(f) && f.split('/').length === 2) imageKeys.add(f.replace(MOVIE_FILE, ''));
  const imageProblem = (src: Src, file: string, what: string) => {
    if (imageKeys.size && !file.includes('[') && !imageKeys.has(file.replace(IMAGE_FILE, '').replace(MOVIE_FILE, ''))) warn(src, `No image "${file}" in assets (${what})`);
  };
  for (const op of program.ops) if (op.op === 'image' && op.action === 'show') imageProblem(op.src, op.file, `image ${op.name}`);
  for (const it of Object.values(program.items ?? {})) if (it.image) imageProblem(it.src, it.image, `image of item ${it.id}`);
  for (const def of Object.values(program.screens ?? {})) {
    walkNodes(def.body, n => {
      if (n.kind === 'image') imageProblem(n.src, n.file, `screen ${def.name}`);
      else if (n.kind === 'hotspot' && n.shape.k === 'mask') imageProblem(n.src, n.shape.file, `mask of hotspot ${n.id}`);
      else if (n.kind === 'panel' && n.file) imageProblem(n.src, n.file, `frame of a panel in screen ${def.name}`);
      else if (n.kind === 'bar') {
        if (n.back) imageProblem(n.src, n.back, `back of a bar in screen ${def.name}`);
        if (n.fill) imageProblem(n.src, n.fill, `fill of a bar in screen ${def.name}`);
      }
      if (isClickable(n) && n.hover) imageProblem(n.src, n.hover, `hover image of ${n.id}`);
      if (isClickable(n) && n.fx.sound && !sounds.has(n.fx.sound)) warn(n.src, `No sound "${n.fx.sound}" in assets/sound (hover sound of ${n.id})`);
      if ((n.kind === 'button' || n.kind === 'text') && n.style) styleProblem(n.src, n.style);
    });
  }
}

/** Characters: blip voices, text box styles and side portraits; lines and menus with a look. */
function checkCharacters(program: Program, index: AssetIndex, sounds: Set<string>, warn: Warn, styleProblem: (src: Src, style: string) => void) {
  const voices = new Set([...BLIP_PRESETS, ...(index.blips ?? []), ...sounds]);
  const sides = new Set(index.files.flatMap(f => (IMAGE_FILE.test(f) && /^side\/[^/]+$/.test(f) ? [f.slice(5).replace(IMAGE_FILE, '')] : [])));
  for (const op of program.ops) {
    if ((op.op === 'say' || op.op === 'menu') && op.look) styleProblem(op.src, op.look);
  }
  for (const c of Object.values(program.characters) as CharacterDef[]) {
    if (c.style.blip && !voices.has(c.style.blip)) {
      warn(c.src, `No blip voice "${c.style.blip}" (built in: ${BLIP_PRESETS.join(', ')}; or game.json "blips", or assets/sound)`);
    }
    if (c.style.box) styleProblem(c.src, c.style.box);
    if (c.side && !sides.has(c.side)) warn(c.src, `No portrait "${c.side}" in assets/side (side=)`);
  }
}

export function checkAssets(program: Program, index: AssetIndex): Diagnostic[] {
  const out: Diagnostic[] = [];
  const seen = new Set<string>();
  /** With `word` and `known`, the message offers the closest known names ("did you mean") instead of `otherwise`. */
  const warn = (src: Src, message: string, word?: string, known?: Iterable<string>, otherwise = '') => {
    const key = `${src.file}:${src.line}:${message}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(word !== undefined && known ? withFix(src, 'warning', message, word, known, otherwise) : { file: src.file, line: src.line, severity: 'warning', message: message + otherwise });
  };

  const names = assetNames(index);
  checkOps(program, index, names, warn);
  checkVoiceFiles(program, index, out);
  const styleProblem = styleChecker(index, warn);
  checkImages(program, index, names.sounds, warn, styleProblem);
  checkCharacters(program, index, names.sounds, warn, styleProblem);
  return out;
}

/** A problem in game.json; `line` is where the name appears in the text (1 when unknown). */
export type GameProblem = Diagnostic;

/**
 * Names game.json refers to that have no file: title screen art and music, gallery images and splash cards.
 * `text` is game.json's source, used to point each warning at the line that mentions the name.
 */
export function checkGame(game: unknown, index: AssetIndex, text = ''): GameProblem[] {
  const out: GameProblem[] = [];
  if (!game || typeof game !== 'object') return out;
  const g = game as Record<string, any>;
  const lines = text.split('\n');
  const lineOf = (name: string) => Math.max(1, lines.findIndex(l => l.includes(`"${name}"`)) + 1);
  const seen = new Set<string>();
  /** With `known`, the message offers the closest of those names ("did you mean"), and the editor a quick fix. */
  const warn = (name: string, message: string, known?: Iterable<string>) => {
    if (seen.has(message)) return;
    seen.add(message);
    const options = known ? closest(name, known) : [];
    out.push({ file: 'game.json', line: lineOf(name), severity: 'warning', message: message + didYouMean(options), ...(options.length ? { fix: { word: name, options } } : {}) });
  };
  const stem = (f: string) => f.replace(/\.[^.]+$/, '');
  const images = new Set(index.files.flatMap(f => {
    const parts = f.split('/');
    return IMAGE_FILE.test(f) && (parts.length === 1 || (parts.length === 2 && parts[0] === 'bg')) ? [stem(parts[parts.length - 1])] : [];
  }));
  const tracks = new Set(index.files.flatMap(f => {
    const parts = f.split('/');
    return AUDIO_FILE.test(f) && parts.length === 2 && parts[0] === 'music' ? [stem(parts[1])] : [];
  }));
  const image = (name: unknown, where: string) => {
    if (typeof name === 'string' && name && !images.has(name)) warn(name, `${where}: no image "${name}" in assets/bg`, images);
  };
  const title = g.titleScreen;
  if (title && typeof title === 'object') {
    image(title.background, 'titleScreen.background');
    if (typeof title.music === 'string' && title.music && !tracks.has(title.music)) {
      warn(title.music, `titleScreen.music: no track "${title.music}" in assets/music`, tracks);
    }
  }
  for (const problem of buildCheckSettings(g).problems) warn('build', problem);
  const stage = stageProblem(g.stage);
  if (stage) out.push({ file: 'game.json', line: lineOf('stage'), severity: 'error', message: stage });
  if (g.positions && typeof g.positions === 'object' && !Array.isArray(g.positions)) {
    for (const [name, value] of Object.entries(g.positions)) {
      const problem = positionProblem(name, value);
      if (problem) warn(name, problem);
    }
  }
  if (g.anchors && typeof g.anchors === 'object' && !Array.isArray(g.anchors)) {
    for (const [name, value] of Object.entries(g.anchors)) {
      const problem = anchorProblem(name, value);
      if (problem) warn(name, problem);
    }
  }
  const theme: any = g.theme && typeof g.theme === 'object' && !Array.isArray(g.theme) ? expandTokenRefs(g.theme) : undefined; // $token references count as the color they name
  if (theme) {
    for (const key of ['hotFill', 'hotBorder', 'tipBackground', 'tipColor', 'tipFont']) {
      const v = theme[key];
      if (v !== undefined && (typeof v !== 'string' || !v.trim() || /[;{}<>\\]|url\(/i.test(v))) warn(key, `theme.${key} needs a plain CSS ${key === 'tipFont' ? 'font name' : 'color'} like "rgba(255,255,255,.2)"`);
    }
    const w = theme.hotBorderWidth;
    if (w !== undefined && (typeof w !== 'number' || !Number.isFinite(w) || w < 0)) warn('hotBorderWidth', 'theme.hotBorderWidth needs a number of stage pixels, 0 or more');
  }
  if (Array.isArray(g.musicRoom)) {
    for (const e of g.musicRoom) {
      const t = typeof e === 'string' ? e : e?.track;
      if (typeof t === 'string' && t && !tracks.has(t)) warn(t, `musicRoom: no track "${t}" in assets/music`, tracks);
    }
  }
  if (g.captions && typeof g.captions === 'object' && !Array.isArray(g.captions)) {
    for (const [name, value] of Object.entries(g.captions)) {
      const problem = captionProblem(name, value);
      if (problem) warn(name, problem);
    }
  }
  if (Array.isArray(g.gallery)) for (const e of g.gallery) image(e?.image, 'gallery');
  const uiImages = new Set(index.files.flatMap(f => {
    const parts = f.split('/');
    return IMAGE_FILE.test(f) && parts.length === 2 && parts[0] === 'ui' ? [stem(parts[1])] : [];
  }));
  const sounds = new Set(index.files.flatMap(f => {
    const parts = f.split('/');
    return AUDIO_FILE.test(f) && parts.length === 2 && parts[0] === 'sound' ? [stem(parts[1])] : [];
  }));
  if (theme) {
    // Boxes of the theme and of its skins (a theme file's problems land here too, as the game sees it resolved).
    const boxes = [theme, ...Object.values(theme.skins ?? {}) as any[]].flatMap(t => t && typeof t === 'object'
      ? (['textbox', 'namebox', 'choices'] as const).flatMap(k => (t[k] && typeof t[k] === 'object' ? [[k, t[k]] as const] : [])) : []);
    for (const [k, b] of boxes) {
      if (typeof b.image === 'string' && b.image && !uiImages.has(b.image)) warn(b.image, `theme.${k}.image: no image "${b.image}" in assets/ui`, uiImages);
      for (const c of ['background', 'border'] as const) {
        if (b[c] !== undefined && (typeof b[c] !== 'string' || !isCssColor(b[c]))) warn(String(b[c]), `theme.${k}.${c} needs a CSS color like "#112233", not ${JSON.stringify(b[c])}`);
      }
    }
    for (const key of ['accent', 'hotFill', 'hotBorder', 'tipBackground', 'tipColor'] as const) {
      const v = theme[key];
      if (key === 'accent' && v !== undefined && (typeof v !== 'string' || !isCssColor(v))) warn(String(v), `theme.accent needs a CSS color like "#5fd1c3", not ${JSON.stringify(v)}`);
    }
    const f = theme.font;
    if (typeof f === 'string' && FONT_FILE.test(f) && !index.files.includes(`fonts/${f}`)) warn(f, `theme.font: no font file "${f}" in assets/fonts (use the name without the extension for an installed font)`);
  }
  if (Array.isArray(g.achievements)) {
    for (const e of g.achievements) {
      const icon = e && typeof e === 'object' ? e.icon : undefined;
      if (typeof icon === 'string' && icon && !uiImages.has(icon)) warn(icon, `achievements: no icon "${icon}" in assets/ui`, uiImages);
    }
  }
  const toastSound = g.achievementToast && typeof g.achievementToast === 'object' ? g.achievementToast.sound : undefined;
  if (typeof toastSound === 'string' && toastSound && !sounds.has(toastSound)) warn(toastSound, `achievementToast.sound: no sound "${toastSound}" in assets/sound`, sounds);
  for (const message of speakerFocusProblems(g.speakerFocus)) warn('speakerFocus', message);
  for (const message of sideImageProblems(g.sideImages)) warn('sideImages', message);
  for (const message of touchProblems(g.touch)) warn('touch', message);
  const pwaMessage = pwaProblem(g.pwa);
  if (pwaMessage) warn('pwa', pwaMessage);
  if (Array.isArray(g.splash)) for (const e of g.splash) image(typeof e === 'string' ? e : e?.image, 'splash');
  if (g.icon !== undefined && (typeof g.icon !== 'string' || !g.icon)) warn('icon', 'icon needs the name of a PNG in assets/ui');
  const icon = iconAsset(g);
  if (icon && !index.files.includes(icon)) warn(g.icon, `icon: no PNG "${g.icon}" in assets/ui (an icon must be a .png)`);
  const version = versionProblem(g.version);
  if (version) warn('version', version);
  return out;
}

// ---- what each op needs, and when to load it ----

/** The project's files by asset key, plus the character rigs. */
export interface AssetContext {
  has: (key: string) => boolean;
  /** Whether line `id` has a recording in any language (assets/voice/<id>.* or assets/voice/<id>.<lang>.*). */
  hasVoice: (id: string) => boolean;
  rigs: Record<string, RigManifest>;
}

export function assetContext(index: AssetIndex): AssetContext {
  const keys = new Set<string>(), voices = new Set<string>();
  for (const f of index.files) {
    if (IMAGE_FILE.test(f)) keys.add(f.replace(IMAGE_FILE, ''));
    else if (AUDIO_FILE.test(f) && f.split('/').length === 2) keys.add(f.replace(AUDIO_FILE, ''));
    else if (MOVIE_FILE.test(f) && f.split('/').length === 2) keys.add(f.replace(MOVIE_FILE, ''));
    const v = voiceId(f);
    if (v) voices.add(v);
  }
  return { has: k => keys.has(k), hasVoice: id => voices.has(id), rigs: index.rigs ?? {} };
}

/** The line id of a voice recording path under assets/ (`voice/ab12.ogg`, `voice/ab12.fi.ogg`); null for any other file. */
const voiceId = (file: string): string | null => {
  const parts = file.split('/');
  return parts.length === 2 && parts[0] === 'voice' && AUDIO_FILE.test(file) ? splitVoiceName(parts[1].replace(AUDIO_FILE, '')).id : null;
};

/** The asset key under which a line's recording is preloaded (the language is picked by the shell when it loads it). */
export const VOICE_KEY = 'voice/';

/** The image a `scene` draws: assets/bg/<name>, or <name> at the root; null when there is none (a placeholder is drawn). */
export const bgKey = (name: string, ctx: AssetContext): string | null =>
  ctx.has(`bg/${name}`) ? `bg/${name}` : ctx.has(name) ? name : null;

/** The grayscale image of a `scene ... mask=<name>` transition: assets/transitions/<name>; null when there is none (a plain dissolve is used). */
export const maskKey = (name: string, ctx: AssetContext): string | null =>
  ctx.has(`transitions/${name}`) ? `transitions/${name}` : null;

/** The image an overlay `image show` draws: its path under assets/ (extension optional); null when there is none (a placeholder is drawn). */
export const imageKey = (file: string, ctx: AssetContext): string | null => {
  const k = file.replace(IMAGE_FILE, '').replace(MOVIE_FILE, ''); // a movie (`movie/<name>`) is an overlay picture that plays on a loop
  return ctx.has(k) ? k : null;
};

/** One layer of a layered character: its file, its position in the PSD canvas and the part (slot or plain layer) it belongs to. */
export interface RigLayer { file: string; x: number; y: number; part: string }

/**
 * The layers of a layered character that show `looks` (applied left to right) with the slot `overrides`, bottom to top.
 * The one lookup both the renderer (to draw) and the preload plan (to know which files) use; `warn` hears about names
 * the rig does not have.
 */
export function rigLayers(rig: RigManifest, looks: string[], overrides: Record<string, string>, warn: (msg: string) => void = () => {}): RigLayer[] {
  const picks: RigLayer[] = [];
  let part = '';
  const add = (p?: { file?: string; x?: number; y?: number }) => { if (p?.file) picks.push({ file: p.file, x: p.x ?? 0, y: p.y ?? 0, part }); };
  const shown = expandShow(rig, looks, overrides);
  shown.problems.forEach(warn);
  for (const word of shown.unknown) warn(`no layer is named or aliased "${word}"`);
  overrides = shown.overrides;
  for (const p of orderedParts(rig)) {
    part = partName(p);
    if (!p.slot || !p.variants) { add(p); continue; }
    const want = overrides[p.slot];
    let v = want !== undefined ? p.variants[want] : undefined;
    if (want !== undefined && !v && want !== 'none') warn(`slot "${p.slot}" has no variant "${want}"`);
    if (want === undefined && !v && p.default) v = p.variants[p.default];
    add(v);
  }
  return picks;
}

/** The image keys a sprite is drawn with (only files that exist: the rest is a placeholder). */
export function spriteKeys(s: Pick<SpriteState, 'char' | 'pose' | 'more' | 'overrides'>, ctx: AssetContext): string[] {
  const rig = ctx.rigs[s.char]?.flat ? undefined : ctx.rigs[s.char];
  const layerKeys = (overrides: Record<string, string>) => rigLayers(rig!, showLooks(s), overrides).map(p => `char/${s.char}/${p.file.replace(IMAGE_FILE, '')}`);
  // A character that blinks or talks by itself also needs those variants loaded, or the swap would flash.
  const keys = rig
    ? [...new Set([...layerKeys(s.overrides), ...liveOverrides(rig.rig).flatMap(o => layerKeys({ ...s.overrides, ...o }))])]
    : [`char/${s.char}/${s.pose ?? 'default'}`];
  return keys.filter(ctx.has);
}

/** Everything that must be loaded before `state` can be drawn and heard. */
export function stateAssets(state: Pick<DisplayState, 'bg' | 'sprites' | 'music' | 'ambience'> & { images?: Pick<ImageState, 'file'>[] }, ctx: AssetContext): string[] {
  const out: string[] = [];
  const bg = state.bg ? bgKey(state.bg, ctx) : null;
  if (bg) out.push(bg);
  for (const s of state.sprites) out.push(...spriteKeys(s, ctx));
  for (const i of state.images ?? []) { const k = imageKey(i.file, ctx); if (k) out.push(k); }
  if (state.music && ctx.has(`music/${state.music}`)) out.push(`music/${state.music}`);
  for (const n of state.ambience ?? []) if (ctx.has(`sound/${n}`)) out.push(`sound/${n}`);
  return [...new Set(out)];
}

/** The image keys a screen draws that are known without running it: fixed images and masks, and every item image when it lists items. */
export function screenAssets(program: Pick<Program, 'screens' | 'items'>, name: string, ctx: AssetContext): string[] {
  const out: string[] = [];
  const add = (file: string | null | undefined) => { const k = file && !file.includes('[') ? file.replace(IMAGE_FILE, '') : null; if (k && ctx.has(k)) out.push(k); };
  let lists = false;
  const walk = (nodes: ScreenNode[]) => {
    for (const n of nodes) {
      if (n.kind === 'image') add(n.file);
      else if (n.kind === 'hotspot' && n.shape.k === 'mask') add(n.shape.file);
      else if (n.kind === 'panel') add(n.file);
      else if (n.kind === 'bar') { add(n.back); add(n.fill); }
      if (isClickable(n) && n.hover) add(n.hover);
      if (isClickable(n) && n.body) walk(n.body);
      if (n.kind === 'layout' || n.kind === 'scroll' || n.kind === 'panel') walk(n.body);
      else if (n.kind === 'each') { lists = true; walk(n.body); }
    }
  };
  walk(program.screens?.[name]?.body ?? []);
  if (lists) for (const it of Object.values(program.items ?? {})) add(it.image);
  return [...new Set(out)];
}

/** Ops of a HUD handler label that are looked at for assets (straight on from the label, to its `return`). */
const HUD_HANDLER_OPS = 40;

/** What a HUD needs up front: its own images, and the assets of the first ops of every label its elements call. */
export function hudAssets(program: Pick<Program, 'screens' | 'items' | 'ops' | 'labels'>, name: string, ctx: AssetContext): string[] {
  const out = screenAssets(program, name, ctx);
  for (const label of hudLabels(program.screens?.[name])) {
    const start = program.labels?.[label];
    if (start === undefined) continue;
    for (let pc = start; pc < Math.min(program.ops.length, start + HUD_HANDLER_OPS); pc++) {
      const op = program.ops[pc];
      if (op.op === 'ret' || op.op === 'end' || op.op === 'hud') break;
      if (op.op !== 'screen') out.push(...opAssets(op, ctx));
    }
  }
  return [...new Set(out)];
}

/** What running one op needs, as asset keys. A `show` without a pose gets the rig defaults (the pose it had before was loaded then). */
export function opAssets(op: Op, ctx: AssetContext, program?: Pick<Program, 'screens' | 'items' | 'ops' | 'labels'>): string[] {
  switch (op.op) {
    case 'hud': return op.mode === 'on' && program ? hudAssets(program, op.name, ctx) : [];
    case 'screen': return program ? screenAssets(program, op.name, ctx) : [];
    case 'scene': { const k = bgKey(op.bg, ctx), m = op.mask ? maskKey(op.mask, ctx) : null; return [...(k ? [k] : []), ...(m ? [m] : [])]; }
    case 'show': return spriteKeys({ char: op.char, pose: op.pose, more: op.more, overrides: op.overrides }, ctx);
    case 'image': { const k = op.action === 'show' ? imageKey(op.file, ctx) : null; return k ? [k] : []; }
    case 'say': return op.id && ctx.hasVoice(op.id) ? [VOICE_KEY + op.id] : [];
    case 'music': return op.action === 'play' && op.name && ctx.has(`music/${op.name}`) ? [`music/${op.name}`] : [];
    case 'sound': return op.name && op.action !== 'stop' && ctx.has(`sound/${op.name}`) ? [`sound/${op.name}`] : [];
    case 'movie': return ctx.has(`movie/${op.name}`) ? [`movie/${op.name}`] : [];
    default: op satisfies AssetFreeOp; return [];
  }
}

/** The ops that name no asset: `opAssets` ends with a check against this, so a new op that does has to get a case or be listed here. */
type AssetFreeOp = Extract<Op, { op: 'hide' | 'move' | 'shake' | 'hop' | 'animate' | 'param' | 'perform' | 'burst' | 'flash' | 'tint' | 'camera' | 'weather' | 'filter' | 'letterbox' | 'wind' | 'gravity' | 'focus' | 'behaviors' | 'wait'
  | 'menu' | 'input' | 'set' | 'jump' | 'call' | 'ret' | 'end' | 'nvl' | 'textbox' | 'unlock' | 'branch' | 'goto' }>;

/** How far ahead, in lines of the story (says, menus, inputs), preload tasks reach. */
export const PRELOAD_LINES = 40;

const isLine = (op: Op) => op.op === 'say' || op.op === 'menu' || op.op === 'input' || op.op === 'screen';

/**
 * The control flow graph of a program: where each op can go next. Jumps, calls and menu options are resolved,
 * conditions are over-approximated (both sides of a branch, every menu option) and `ret` goes back to the op
 * after any call of its label, so the graph is a superset of what can run.
 */
export function successors(program: Program): number[][] {
  const { ops, labels } = program;
  const starts = [...new Set(Object.values(labels))].sort((a, b) => a - b);
  const labelOf = (pc: number) => { let r = -1; for (const s of starts) { if (s <= pc) r = s; else break; } return r; };
  const callers = new Map<number, number[]>(); // label start -> the ops that follow a call to it
  ops.forEach((op, pc) => { if (op.op === 'call' && op.target >= 0) callers.set(op.target, [...(callers.get(op.target) ?? []), pc + 1]); });
  return ops.map((op, pc): number[] => {
    switch (op.op) {
      case 'menu': return [pc + 1, ...op.options.map(o => o.target), ...(op.timeout ? [op.timeout.target] : [])];
      case 'branch': return [pc + 1, op.target];
      case 'goto': return [op.target];
      case 'jump': case 'call': return op.target >= 0 ? [op.target] : [pc + 1];
      case 'ret': return callers.get(labelOf(pc)) ?? [];
      case 'end': return [];
      default: op satisfies FallThroughOp; return [pc + 1];
    }
  });
}

/**
 * Build the preload tasks of `program` and attach them (`program.preload`). From the program start, every label,
 * and every line, menu and input, the story is walked forward for `lookahead` lines, and the assets met on the way
 * become tasks, nearest first. They are asked for as soon as such an op runs, so on any path an asset is requested
 * almost `lookahead` lines before its first use.
 */
/**
 * Sounds that play with no script line ahead of them, so the lookahead never sees them coming: a screen button's
 * hover or click sound, and game.json's achievementToast sound. Names as `sound <name>` takes them; files may be missing.
 */
export function uncuedSounds(program: Program, game: unknown = null): string[] {
  const out = new Set<string>();
  for (const def of Object.values(program.screens ?? {})) walkNodes(def.body, n => { if (isClickable(n) && n.fx.sound) out.add(n.fx.sound); });
  const toast = game && typeof game === 'object' ? (game as Record<string, unknown>).achievementToast : null;
  const sound = toast && typeof toast === 'object' ? (toast as Record<string, unknown>).sound : null;
  if (typeof sound === 'string' && sound) out.add(sound);
  return [...out].sort();
}

export function attachPreloads(program: Program, index: AssetIndex, opts: { gallery?: string[]; lookahead?: number } = {}): Preload {
  const ctx = assetContext(index);
  const lookahead = opts.lookahead ?? PRELOAD_LINES;
  const { ops } = program;
  const next = successors(program);
  const needs = ops.map(op => opAssets(op, ctx, program));

  const tasks: Record<number, PreloadTask[]> = {};
  const anchors = new Set<number>(ops.length ? [0] : []);
  for (const pc of Object.values(program.labels)) if (pc < ops.length) anchors.add(pc);
  ops.forEach((op, pc) => { if (isLine(op)) anchors.add(pc); });
  for (const from of anchors) {
    const best = new Map<string, number>(), dist = new Map<number, number>([[from, 0]]);
    const buckets: number[][] = Array.from({ length: lookahead + 1 }, () => []);
    buckets[0].push(from);
    for (let d = 0; d <= lookahead; d++) {
      for (let i = 0; i < buckets[d].length; i++) { // the bucket grows while it is walked: ops that cost no line
        const pc = buckets[d][i];
        if (dist.get(pc) !== d) continue;
        for (const k of needs[pc]) if (!best.has(k)) best.set(k, d);
        const nd = d + (isLine(ops[pc]) ? 1 : 0);
        if (nd > lookahead) continue;
        for (const n of next[pc]) {
          if (n < 0 || n >= ops.length || nd >= (dist.get(n) ?? Infinity)) continue;
          dist.set(n, nd);
          buckets[nd].push(n);
        }
      }
    }
    if (best.size) tasks[from] = [...best].map(([key, lines]) => ({ key, lines }));
  }

  // What the walk cannot see: blip samples named by characters, the rig defaults of `show` without a pose.
  const always = new Set<string>();
  for (const c of Object.values(program.characters) as CharacterDef[]) {
    if (c.style.blip && ctx.has(`sound/${c.style.blip}`)) always.add(`sound/${c.style.blip}`);
  }
  for (const op of ops) if (op.op === 'show' && !op.pose) for (const k of spriteKeys({ char: op.char, pose: null, more: [], overrides: {} }, ctx)) always.add(k);
  const gallery = (opts.gallery ?? []).map(n => bgKey(n, ctx)).filter((k): k is string => !!k);

  const poses: NonNullable<Program['rigPoses']> = {};
  for (const [char, rig] of Object.entries(index.rigs ?? {})) if (rig.rig?.poses) poses[char] = rig.rig.poses;
  program.rigPoses = poses;
  return (program.preload = { lookahead, tasks, always: [...always], gallery });
}
