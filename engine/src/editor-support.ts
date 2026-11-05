import { ANIM_NAMES, EASE_NAMES } from './anim.js';
import { BLIP_PRESETS, type RigManifest } from './assets.js';
import { rigAnimNames, rigPartNames, rigLookNames, rigSlotNames } from './rig.js';
import { FILTER_NAMES, WEATHER_NAMES } from './fx.js';
import { TRANSITIONS, type Program } from './types.js';
import { childNodes, SELECT_SETTINGS, SLIDER_SETTINGS, type ScreenNode } from './screens.js';
import { ANCHORS } from './anchor.js';
import { FUNCTIONS } from './expr.js';
import { SCREEN_CLAUSE_WORDS, startsWithClause } from './screen-syntax.js';
import { ENTER_EFFECTS, LOOP_EFFECTS, SLIDE_DIRS } from './screen-anim.js';

/** Editor-agnostic completion item; the Monaco glue maps `kind` to its own enum. */
export interface Suggestion {
  label: string;
  kind: 'command' | 'character' | 'label' | 'variable' | 'asset' | 'keyword';
  detail?: string;
  insertText?: string;
  /** A file path (it holds `/` and `.`): the editor replaces the whole run of characters before the cursor, not just the last word. */
  path?: boolean;
}

const IMAGE_FILE = /\.(png|webp|jpe?g|avif)$/i, AUDIO_FILE = /\.(ogg|mp3|wav|m4a|flac|opus)$/i, MOVIE_FILE = /\.(webm|mp4|m4v|ogv)$/i;
const stripExt = (f: string) => f.replace(/\.[^./]+$/, '');
/** Names of the files directly in `assets/<dir>` that match `ext`, without the extension (`scene park`, `music play theme`). */
const folderNames = (files: string[], dir: string, ext: RegExp, root = false): string[] =>
  files.flatMap(f => { const p = f.split('/'); return ext.test(f) && ((p.length === 2 && p[0] === dir) || (root && p.length === 1)) ? [stripExt(p[p.length - 1])] : []; });
/** Image paths under `assets/` with their extension, as a parameter that takes a file wants them (`image "ui/map.png"`). */
const imagePaths = (files: string[]): Suggestion[] => files.filter(f => IMAGE_FILE.test(f)).map(label => ({ label, kind: 'asset', detail: 'image', path: true }));
const soundNames = (files: string[]): Suggestion[] => folderNames(files, 'sound', AUDIO_FILE).map(label => ({ label, kind: 'asset', detail: 'sound' }));

const FUNCTION_SNIPPETS: Suggestion[] = Object.entries(FUNCTIONS).map(([name, f]) => ({ label: name, kind: 'keyword', detail: f.help, insertText: `${name}($0)` }));
const anchorWords = (program: Program) => Object.keys(program.anchors ?? ANCHORS).map(n => `anchor=${n}`);
const COMMANDS: [string, string][] = [
  ['label', 'label name:  |  label name(param, ...):'], ['menu', 'menu ["prompt"] [style=<name>] [timeout <seconds>]:'], ['on', 'on timeout:  (last block of a menu with a timeout: what happens when time runs out)'], ['if', 'if condition:'], ['elif', 'elif condition:'], ['else', 'else:'],
  ['scene', 'scene <background> [transition] [seconds]'], ['show', 'show <character> [look ...] [slot=variant] [at pos] [order=front|back | behind=<char>] [fade s]'],
  ['hide', 'hide <character> [fade s]'], ['move', 'move <character> [to <pos>] [y= scale= rot= alpha= flip= anchor=] <seconds>'],
  ['shake', 'shake <character|screen> [seconds]'], ['hop', 'hop <character> [seconds]'],
  ['animate', 'animate <character> <name|stop> [seconds] [loop]'],
  ['hud', 'hud on <screen> [keep] | hud off <screen>  (keep a screen up while the story runs)'],
  ['image', 'image show <name> <file> [at x,y] [layer=] | image move <name> ... | image hide <name>'],
  ['flash', 'flash [#color] [seconds]'], ['tint', 'tint <#color> [strength] [seconds] | tint off'],
  ['focus', 'focus on | focus off  (speaker focus: dim who is not speaking, game.json "speakerFocus")'],
  ['camera', 'camera zoom <factor> [at pos] [y=0-1] [seconds] | camera pan <pos> | camera reset'],
  ['weather', 'weather <rain|snow|petals|embers> [intensity] [seconds] | weather off'], ['filter', 'filter <blur|grayscale|sepia|night|vignette> [strength] [seconds] | filter off'],
   ['music', 'music play <name> [loop] [fade s] | music stop | music pause | music resume'], ['sound', 'sound play <name> [duck] | sound loop <name> [fade s] | sound stop [<name>] [fade s]'], ['movie', 'movie play <name> [noskip | loop]'], ['wait', 'wait <seconds>'],
  ['nvl', 'nvl on | nvl off | nvl clear  (full-screen narration pages)'], ['textbox', 'textbox hide  (hide the text box until the next line)'], ['set', 'set name = expression  (set persistent.name = ... keeps it across playthroughs)'], ['input', 'input <variable> "Prompt" [default="Name"] [max=16]'], ['jump', 'jump <label>'], ['call', 'call <label>  |  call <label>(arguments)  (the arguments fill the label parameters)'], ['return', 'return'],
  ['screen', 'screen name:  or  screen name(a, inout b):  (a page of hotspots and buttons; show it with show screen name or name(1, b); an inout parameter is copied in from the story variable the call names and written back when the screen answers)'],
  ['end', 'end'], ['unlock', 'unlock <flag>  (persistent; read as unlocked.<flag>)'], ['define', 'define id "Name" color=#rrggbb [text=# font="" size= italic speed= blip= style= focus=off side=]'],
];
// Text tags, offered right after a "{" (which is not part of the typed word, so labels leave it out).
// `$0` marks where the cursor goes; the editor inserts these as snippets.
const TEXT_TAGS: Suggestion[] = ([
  ['i', '{i}..{/i}  italic', 'i}$0{/i}'], ['b', '{b}..{/b}  bold', 'b}$0{/b}'],
  ['color', '{color=#rrggbb}..{/color}', 'color=#ff6fa5}$0{/color}'], ['size', '{size=1.5}..{/size}  size multiplier', 'size=1.5}$0{/size}'],
  ['wave', '{wave}..{/wave}  wavy text', 'wave}$0{/wave}'], ['shake', '{shake}..{/shake}  shaky text', 'shake}$0{/shake}'],
  ['ruby', '{ruby=reading}base{/ruby}', 'ruby=}$0{/ruby}'], ['speed', '{speed=0.5}..{/speed}  typing speed multiplier', 'speed=0.5}$0{/speed}'],
  ['pause', '{pause=0.5}  pause typing (seconds)', 'pause=0.5}'],
  ['wait', '{wait}  stop until a click, then continue the line', 'wait}'], ['nw', '{nw}  go on to the next line without a click', 'nw}'],
] as [string, string, string][]).map(([label, detail, insertText]) => ({ label, kind: 'keyword' as const, detail, insertText }));
// Formats after `[variable:` in text (`formatValue` in text.ts).
const TEXT_FORMATS: Suggestion[] = ([
  ['2', '[n:2]  2 decimals', '2'], [',', '[n:,]  group thousands (1,234)', ','], [',2', '[n:,2]  grouped, 2 decimals', ',2'],
  ['coin|coins', '[n:one|other]  plural form (a list counts its length)', '${1:coin}|${2:coins}$0'],
  ['none|one|other', '[n:zero|one|other]  plural form with one for 0', '${1:no coins}|${2:a coin}|${3:coins}$0'],
  ['one=|few=|many=|other=', '[n:one=..|few=..|other=..]  plural forms by the language\'s rules', 'one=$1|few=$2|many=$3|other=$0'],
] as [string, string, string][]).map(([label, detail, insertText]) => ({ label, kind: 'keyword' as const, detail, insertText }));
// Elements of a `screen` block (offered on any new line: the completion does not know the block).
const SCREEN_ELEMENTS: [string, string][] = [
  ['image', 'image "file.png" [at x,y] [size w,h]'], ['hotspot', 'hotspot <id> at x,y size w,h | ellipse ... | poly x,y x,y x,y | mask "file.png"  "Label"  (end the line with : to give it child elements that share its focus)'],
  ['button', 'button <id> at x,y [size w,h] "Label"  (end the line with : to give it child elements that share its focus)'], ['slider', 'slider <setting> at x,y [size w,h] [readout]  (options screen: master, music, sound, voice, text_speed, text_size, box_opacity)'], ['text', 'text at x,y "Text with [variables]"'],
  ['select', 'select <setting> at x,y [size w,h]  (options screen: shows a player setting and opens the list of its values; language, theme, voice_language, skip, ...)'],
  ['row', 'row [at x,y | anchor <place> [margin m]] [padding m] [gap n] [align start|center|end|stretch] [height n]:  (children need no "at")'], ['column', 'column [at x,y | anchor <place> [margin m]] [padding m] [gap n] [align start|center|end|stretch] [width n]:'],
  ['grid', 'grid <columns> [at x,y | anchor <place>] [gap n] [cell w,h] [align a]:'],
  ['scroll', 'scroll at x,y size w,h [start top|bottom] [bar off]:  (a box that scrolls its children; they are placed from its top left)'],
  ['panel', 'panel [at x,y] [size w,h] [image "frame.png" slice 32] [padding p]:  (a framed box; its children are placed from its top left plus the padding)'],
  ['bar', 'bar <variable> [max n] at x,y [size w,h] [back "file.png"] [fill "file.png"] [slice s] [color c] [readout]'],
  ['tab', 'tab <id> <state>=<word> at x,y [size w,h] "Label"  (sets a local state of the screen and stays up; lit while the state holds the word)'],
  ['radio', 'radio <id> <state>=<word> at x,y [size w,h] "Label"  (a tab drawn as a radio mark: sets the state to the word, lit while it holds it; the state is a state or an inout parameter)'],
  ['toggle', 'toggle <id> <state> at x,y [size w,h] "Label"  (flips a true/false state or inout parameter; drawn as a checkbox)'],
  ['state', 'state <name> = <value or expression>  (local to the screen while it is up; a parameter or story variable can start it)'],
  ['each', 'each <list> as <name> [at x,y] [step dx,dy] [limit n]:'], ['default', 'default <element id>'], ['cancel', 'cancel [keep]  (the cancel key answers "" and drops the inout changes; cancel keep applies them)'], ['textbox', 'textbox off  (hide the text box while the screen is up)'],
];
const elementIds = (nodes: ScreenNode[]): string[] => nodes.flatMap(n => (n.kind === 'hotspot' || n.kind === 'button' ? [n.id, ...elementIds(childNodes(n))] : childNodes(n).length ? elementIds(childNodes(n)) : []));
const DIRECTIONS = ['left', 'right', 'up', 'down'];
const EASES = EASE_NAMES.map(n => `ease=${n}`);

/** The screens the project declares (not the starter title and pause screens the shell adds when it has none). */
const projectScreens = (program: Program): string[] => Object.values(program.screens ?? {}).filter(sc => !sc.src.file.startsWith('stock/')).map(sc => sc.name);

const kw = (labels: readonly string[]): Suggestion[] => labels.map(label => ({ label, kind: 'keyword' }));
const assets = (labels: Iterable<string>, detail: string): Suggestion[] =>
  [...new Set(labels)].map(label => ({ label, kind: 'asset', detail }));

const CLAUSE_OWNER = /^(?:hotspot|button|tab|radio|toggle|text|image|slider|bar|panel|each|scroll|row|column|grid)\b/;

/** The screen element line that a new indented line would continue if it starts with a clause word, found from the lines above it. */
function continuationOwner(indent: number, above: string[]): string | null {
  for (let k = above.length - 1; k >= 0; k--) {
    const t = above[k].trim();
    if (!t || t.startsWith('#')) continue;
    const ai = above[k].length - above[k].trimStart().length;
    if (ai < indent) return CLAUSE_OWNER.test(t) ? t : null;
    if (ai === indent && startsWithClause(t)) continue; // another continuation line: its element is further up
    return null;
  }
  return null;
}

/** Whether a new line after `above` (every line above the cursor) belongs to a `screen` block: the nearest unindented line opens one. */
export function insideScreen(above: string[], indented: boolean): boolean {
  if (!indented) return false;
  for (let k = above.length - 1; k >= 0; k--) {
    const l = above[k];
    if (!l.trim() || l.trimStart().startsWith('#') || /^\s/.test(l)) continue;
    return /^screen\b/.test(l);
  }
  return false;
}

/**
 * Suggestions for the text on the current line before the cursor.
 * Names (backgrounds, poses, tracks) come from what the project already uses,
 * until asset manifests exist to supply them.
 * `above` is the text of the lines above the cursor's (nearest last): an indented line under a screen element
 * offers that element's clause words, which continue its line.
 * `inScreen` says whether the cursor sits in a `screen` block (see `insideScreen`): true offers only screen elements on a new line,
 * false only story commands; left out, both (the old behavior).
 * `files` are the paths under `assets/` (as the project lists them): parameters that name a background, track, sound, movie or image
 * complete from them as well as from what the scripts already use.
 */
export function getCompletions(program: Program, linePrefix: string, rigs: Record<string, RigManifest> = {}, above: string[] = [], inScreen?: boolean, files: string[] = []): Suggestion[] {
  const trimmed = linePrefix.trimStart();
  if (trimmed.startsWith('#')) return [];
  const owner = trimmed === linePrefix ? null : continuationOwner(linePrefix.length - trimmed.length, above);
  if (owner) {
    const first = /^\S*/.exec(trimmed)![0];
    if (first === trimmed) { // still typing the first word: the clauses, then the usual choices (a child element, if the line above ends in `:`)
      const clauses = SCREEN_CLAUSE_WORDS.map(label => ({ label, kind: 'keyword' as const, detail: `continues the element line above (${owner.split(/\s+/)[0]})` }));
      return [...clauses, ...getCompletions(program, linePrefix, rigs, [], undefined, files)];
    }
    if (startsWithClause(first)) { // inside a clause: complete it as if the line were written on the owner's line
      const placement = ['at', 'size', 'ellipse', 'poly', 'mask']; // these belong on the first line
      return getCompletions(program, `${owner.split(/\s+/)[0]} _ _ ${trimmed}`, rigs, [], undefined, files).filter(s => !placement.includes(s.label));
    }
  }
  const assigned = program.ops.flatMap(o => (o.op === 'set' && !o.name.startsWith('persistent.') ? [o.name] : o.op === 'input' ? [o.name] : o.op === 'screen' && o.as ? [o.as] : []));
  const states = [...new Set(Object.values(program.screens ?? {}).flatMap(sc => [...(sc.states ?? []).map(d => d.name), ...(sc.inout ?? [])]))];
  const variables: Suggestion[] = [...new Set([...assigned, ...Object.values(program.params ?? {}).flat(), ...states])]
    .map(label => ({ label, kind: 'variable' }));
  const flags: Suggestion[] = [...new Set(program.ops.flatMap(o => (o.op === 'unlock' ? [o.name] : [])))]
    .map(name => ({ label: `unlocked.${name}`, kind: 'variable', detail: 'persistent flag' }));
  const persistent: Suggestion[] = [...new Set(program.ops.flatMap(o => (o.op === 'set' && o.name.startsWith('persistent.') ? [o.name] : [])))]
    .map(label => ({ label, kind: 'variable', detail: 'persistent value' }));

  const inString = (trimmed.match(/"/g)?.length ?? 0) % 2 === 1; // e.g. an `input` prompt or a screen's text
  if (inString) { // a file parameter of a screen element: `image "…`, `mask "…`, `hover "…`, `back "…`, `fill "…`, `hover sound "…`
    if (/\bhover\s+sound\s+"[^"]*$/.test(trimmed)) return soundNames(files);
    if (/(?:^|\s)(?:image|mask|hover|back|fill)\s+"[^"]*$/.test(trimmed)) return imagePaths(files);
  }
  if (trimmed.startsWith('"') || /^[A-Za-z_]\w*:\s/.test(trimmed) || inString) { // inside dialogue, narration or option text
    const open = trimmed.lastIndexOf('{');
    if (open >= 0 && !trimmed.includes('}', open)) return TEXT_TAGS;
    const ref = /\[([A-Za-z_][\w.]*)?(:[^\][]*)?$/.exec(trimmed); // an unclosed [variable or [variable:format
    if (!ref) return [];
    return ref[2] !== undefined ? (ref[2] === ':' ? TEXT_FORMATS : []) : [...variables, ...persistent];
  }
  if (trimmed.endsWith(':')) return []; // a `:` typed after a speaker or block opener

  const endsWithSpace = /\s$/.test(trimmed);
  const toks = trimmed.split(/\s+/).filter(Boolean);
  const word = endsWithSpace ? '' : toks.pop() ?? ''; // the word being typed
  const prev = toks;

  const characters: Suggestion[] = Object.values(program.characters).map(c => ({ label: c.id, kind: 'character', detail: c.name }));
  const labels: Suggestion[] = Object.keys(program.labels).map(label => {
    const ps = program.params?.[label];
    return ps?.length ? { label, kind: 'label' as const, detail: '(' + ps.join(', ') + ')' } : { label, kind: 'label' as const };
  });
  if (prev.length === 0) {
    const elements = SCREEN_ELEMENTS.map(([label, detail]) => ({ label, kind: 'command' as const, detail }));
    if (inScreen === true) return elements; // inside a `screen` block only its own elements make sense
    return [
      ...(inScreen === false ? [] : elements),
      ...COMMANDS.map(([label, detail]) => ({ label, kind: 'command' as const, detail })),
      ...characters.map(c => ({ ...c, insertText: `${c.label}: ` })),
    ];
  }

  const cmd = prev[0];
  const arg = prev.length - 1;       // number of completed arguments
  const last = prev[prev.length - 1];

  switch (cmd) {
    case 'show': {
      if (arg === 0) return [...characters, { label: 'screen', kind: 'keyword' as const, detail: 'show screen <name> [(arguments)] [as <variable>]' }];
      if (prev[1] === 'screen') return arg === 1 ? projectScreens(program).map(label => ({ label, kind: 'keyword' as const, detail: 'screen' })) : arg === 2 ? kw(['as']) : [];
      if (last === 'at') return kw(Object.keys(program.positions));
      if (last === 'fade') return [];
      const rig = rigs[prev[1]];
      const looks = [...(rig ? rigLookNames(rig) : []), ...program.ops.flatMap(o => (o.op === 'show' && o.char === prev[1] && o.pose ? [o.pose, ...o.more] : []))];
      const slots = (rig ? rigSlotNames(rig) : []).map(s => ({ label: `${s}=`, kind: 'keyword' as const, detail: `slot of ${prev[1]}` }));
      const behind = characters.filter(c => c.label !== prev[1]).map(c => ({ label: `behind=${c.label}`, kind: 'keyword' as const, detail: 'draw order' }));
      return [...assets(looks, `look of ${prev[1]}`), ...slots, ...kw(['at', 'fade', 'y=0', 'scale=1', 'flip=on', 'flip=off', ...anchorWords(program), 'order=front', 'order=back', 'nowait']), ...behind];
    }
    case 'hide': return arg === 0 ? characters : kw(['fade', 'nowait']);
    case 'hop': return arg === 0 ? characters : kw(['nowait']);
    case 'animate':
      if (arg === 0) return characters;
      if (arg === 1) {
        const own = rigs[prev[1]] ? rigAnimNames(rigs[prev[1]]) : [];
        return [...new Set([...own, ...ANIM_NAMES, 'stop'])].map(label => ({ label, kind: 'keyword' as const, detail: label === 'stop' ? 'end the loop' : own.includes(label) ? `animation of ${prev[1]}` : 'animation' }));
      }
      return kw(['loop', 'strength=1', ...(rigs[prev[1]] ? rigPartNames(rigs[prev[1]]).map(p => `part=${p}`) : []), 'nowait']);
    case 'move':
      if (arg === 0) return characters;
      if (last === 'to') return kw(Object.keys(program.positions));
      return kw([...(prev.includes('to') ? [] : ['to']), 'y=0', 'scale=1', 'rot=0', 'alpha=1', 'flip=on', 'flip=off', ...anchorWords(program), ...EASES, 'nowait']);
    case 'shake':
      return arg === 0 ? [...characters, { label: 'screen', kind: 'keyword' as const }] : kw(['strength=8', 'nowait']);
    case 'scene': {
      if (arg === 0) return assets([...program.ops.flatMap(o => (o.op === 'scene' ? [o.bg] : [])), ...folderNames(files, 'bg', IMAGE_FILE, true)], 'background');
      if (last === 'wipe') return kw(DIRECTIONS);
      if (arg === 1) return kw(TRANSITIONS);
      return kw(['nowait']);
    }
    case 'image': {
      if (arg === 0) return kw(['show', 'move', 'hide']);
      const shown = [...new Set(program.ops.flatMap(o => (o.op === 'image' && o.action === 'show' ? [o.name] : [])))];
      if (arg === 1) return prev[1] === 'show' ? [] : shown.map(label => ({ label, kind: 'keyword' as const, detail: 'overlay image' }));
      if (prev[1] === 'hide') return kw(['fade']);
      if (prev[1] === 'move') return last === 'to' ? [] : kw([...(prev.includes('to') ? [] : ['to']), 'scale=1', 'rot=0', 'alpha=1', ...anchorWords(program), ...EASES, 'nowait']);
      if (arg === 2) {
        const used = new Set(program.ops.flatMap(o => (o.op === 'image' && o.action === 'show' ? [o.file] : [])));
        return [...[...used].map(label => ({ label, kind: 'asset' as const, detail: 'image', path: true })), ...imagePaths(files).filter(s => !used.has(s.label) && !used.has(stripExt(s.label)))];
      }
      return kw(['at', 'scale=1', 'rot=0', 'alpha=1', 'layer=-1', 'fixed', 'keep', 'fade', ...anchorWords(program), 'nowait']);
    }
    case 'tint': return arg === 0 ? kw(['off']) : [];
    case 'weather': return arg === 0 ? kw([...WEATHER_NAMES, 'off']) : kw(['nowait']);
    case 'filter': return arg === 0 ? kw([...FILTER_NAMES, 'off']) : kw(['nowait']);
    case 'nvl': return arg === 0 ? kw(['on', 'off', 'clear']) : [];
    case 'textbox': return arg === 0 ? kw(['hide']) : [];
    case 'focus': return arg === 0 ? kw(['on', 'off']) : [];
    case 'camera':
      if (arg === 0) return kw(['zoom', 'pan', 'reset']);
      if (last === 'at' || last === 'pan') return kw(Object.keys(program.positions));
      if (prev[1] === 'pan') return kw(['y=0.5', ...EASES, 'nowait']);
      return prev[1] === 'zoom' ? kw(['at', 'y=0.5', ...EASES, 'nowait']) : kw([...EASES, 'nowait']);
    case 'music': {
      if (arg === 0) return kw(['play', 'stop', 'pause', 'resume']);
      if (prev[1] === 'play' && arg === 1) return assets([...program.ops.flatMap(o => (o.op === 'music' && o.name ? [o.name] : [])), ...folderNames(files, 'music', AUDIO_FILE)], 'track');
      return kw(prev[1] === 'play' ? ['loop', 'fade', 'nowait'] : ['fade', 'nowait']);
    }
    case 'sound': {
      if (arg === 0) return kw(['play', 'loop', 'stop']);
      if (arg === 1) return [...(prev[1] === 'stop' ? kw(['fade', 'nowait']) : []), ...assets([...program.ops.flatMap(o => (o.op === 'sound' && o.name ? [o.name] : [])), ...folderNames(files, 'sound', AUDIO_FILE)], 'sound')];
      return kw(prev[1] === 'play' ? ['duck', 'nowait'] : ['fade', 'nowait']);
    }
    case 'movie': {
      if (arg === 0) return kw(['play']);
      if (arg === 1) return assets([...program.ops.flatMap(o => (o.op === 'movie' ? [o.name] : [])), ...folderNames(files, 'movie', MOVIE_FILE)], 'movie');
      return arg === 2 ? kw(['noskip', 'loop']) : [];
    }
    case 'define':
      if (arg === 0) return [{ label: 'item', kind: 'keyword', detail: 'define item <id> "Name" [image=file.png]' }];
      if (prev[1] === 'item') return word.startsWith('image=') ? imagePaths(files) : arg >= 3 ? kw(['image=']) : [];
      if (arg < 2) return [];
      if (word.startsWith('blip=')) return kw(BLIP_PRESETS); // "=" ends a word in the editor: complete the value only
      return kw(['color=', 'text=', 'font=""', 'size=1.1', 'italic', 'speed=0.8', 'blip=', 'style=', 'focus=off', 'side=']);
    case 'hud':
      if (arg === 0) return kw(['on', 'off']);
      if (arg === 1) return projectScreens(program).map(label => ({ label, kind: 'keyword' as const, detail: 'screen' }));
      return prev[1] === 'on' ? kw(['keep']) : [];
    case 'cancel': return arg === 0 ? kw(['keep']) : [];
    case 'hotspot': case 'button': case 'tab': case 'radio': case 'toggle':
      if (arg === 0) return [];
      if (cmd === 'toggle' && arg === 1) return states.map(label => ({ label, kind: 'variable' as const, detail: 'screen state' }));
      const bound = cmd === 'tab' || cmd === 'radio' ? (arg === 1 ? states.map(label => ({ label: `${label}=`, kind: 'variable' as const, detail: 'screen state' })) : []) : [];
      if (last === 'on') return kw(['click', 'focus', 'blur', 'enter', 'exit']);
      if ((last === 'enter' || last === 'exit') && prev[prev.length - 2] === 'on') return kw(ENTER_EFFECTS);
      if (last === 'loop') return kw(LOOP_EFFECTS);
      if (last === 'slide') return kw(SLIDE_DIRS);
      if (prev[prev.length - 2] === 'on' && last !== 'enter' && last !== 'exit') return [...kw(['set']), ...labels];
      if (last === 'set' && prev[prev.length - 3] === 'on') return states.map(label => ({ label, kind: 'variable' as const, detail: 'screen state' }));
      return [...bound, ...kw(cmd !== 'hotspot' ? ['at', 'size', 'style=', 'hover', 'tooltip', 'sub', 'up', 'down', 'left', 'right', 'on', 'loop', 'action', 'if', 'enabled'] : ['at', 'size', 'ellipse', 'poly', 'mask', 'cursor', 'hover', 'tooltip', 'up', 'down', 'left', 'right', 'on', 'loop', 'action', 'if', 'enabled'])];
    case 'image': return last === 'on' ? kw(['enter', 'exit']) : last === 'enter' || last === 'exit' ? kw(ENTER_EFFECTS) : last === 'loop' ? kw(LOOP_EFFECTS) : last === 'slide' ? kw(SLIDE_DIRS) : kw(['at', 'size', 'on', 'loop']);
    case 'slider': return arg === 0 ? kw(Object.keys(SLIDER_SETTINGS)) : kw(['at', 'size', 'readout', 'if']);
    case 'select': return arg === 0 ? kw([...SELECT_SETTINGS]) : kw(['at', 'size', 'font', 'if']);
    case 'text': return last === 'on' ? kw(['enter']) : last === 'enter' ? kw(ENTER_EFFECTS) : last === 'loop' ? kw(LOOP_EFFECTS) : last === 'slide' ? kw(SLIDE_DIRS) : last === 'align' ? kw(['left', 'center', 'right']) : last === 'width' ? kw(['full']) : kw(['at', 'style=', 'font', 'width', 'align', 'if', 'on', 'loop']);
    case 'scroll': return kw(['at', 'size', 'start', 'bar', 'if']);
    case 'panel': return last === 'edge' ? kw(['stretch', 'repeat', 'round']) : last === 'size' ? kw(['full']) : kw(['at', 'size', 'image', 'slice', 'edge', 'padding', 'color', 'if']);
    case 'bar': return arg === 0 ? variables : last === 'edge' ? kw(['stretch', 'repeat', 'round']) : kw(['max', 'min', 'at', 'size', 'back', 'fill', 'slice', 'edge', 'padding', 'color', 'readout', 'if']);
    case 'row': case 'column': case 'grid': return kw(['at', 'anchor', 'margin', 'padding', 'gap', 'align', 'width', 'height', 'if', ...(cmd === 'grid' ? ['cell'] : [])]);
    case 'each': return arg === 1 ? kw(['as']) : arg >= 3 ? kw(['at', 'step', 'limit', 'if']) : [];
    case 'default': return arg === 0 ? [...new Set(Object.values(program.screens ?? {}).flatMap(sc => elementIds(sc.body)))].map(label => ({ label, kind: 'keyword' as const })) : [];
    case 'menu': return prev.includes('timeout') ? [] : kw(prev.some(p => p.startsWith('style=')) ? ['timeout'] : ['style=', 'timeout']);
    case 'on': return arg === 0 ? kw(['timeout']) : [];
    case 'jump': case 'call': return arg === 0 ? labels : [];
    case 'set': return arg === 0 ? [...variables, ...persistent, { label: 'persistent.', kind: 'keyword', detail: 'kept across playthroughs' }]
      : arg >= 2 ? [...variables, ...persistent, ...flags, ...FUNCTION_SNIPPETS] : [];
    case 'input': return arg === 0 ? variables : arg >= 2 ? kw(['default=""', 'max=16']) : [];
    case 'if': case 'elif': return [...variables, ...persistent, ...flags, ...FUNCTION_SNIPPETS, ...kw(['and', 'or', 'not', 'true', 'false'])];
    case 'unlock': return arg === 0 ? assets(program.ops.flatMap(o => (o.op === 'unlock' ? [o.name] : [])), 'flag') : [];
    default: return [];
  }
}
