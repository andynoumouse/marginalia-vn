import { ANIM_NAMES, EASE_NAMES } from './anim.js';
import { BLIP_PRESETS, type RigManifest } from './assets.js';
import { rigAnimNames, rigPartNames, rigPoseNames, rigSlotNames } from './rig.js';
import { FILTER_NAMES, WEATHER_NAMES } from './fx.js';
import { TRANSITIONS, type Program } from './types.js';
import { childNodes, SLIDER_SETTINGS, type ScreenNode } from './screens.js';
import { ANCHORS } from './anchor.js';
import { FUNCTIONS } from './expr.js';

/** Editor-agnostic completion item; the Monaco glue maps `kind` to its own enum. */
export interface Suggestion {
  label: string;
  kind: 'command' | 'character' | 'label' | 'variable' | 'asset' | 'keyword';
  detail?: string;
  insertText?: string;
}

const FUNCTION_SNIPPETS: Suggestion[] = Object.entries(FUNCTIONS).map(([name, f]) => ({ label: name, kind: 'keyword', detail: f.help, insertText: `${name}($0)` }));
const anchorWords = (program: Program) => Object.keys(program.anchors ?? ANCHORS).map(n => `anchor=${n}`);
const COMMANDS: [string, string][] = [
  ['label', 'label name:  |  label name(param, ...):'], ['menu', 'menu ["prompt"] [timeout <seconds>]:'], ['on', 'on timeout:  (last block of a menu with a timeout: what happens when time runs out)'], ['if', 'if condition:'], ['elif', 'elif condition:'], ['else', 'else:'],
  ['scene', 'scene <background> [transition] [seconds]'], ['show', 'show <character> [pose] [at pos] [fade s]'],
  ['hide', 'hide <character> [fade s]'], ['move', 'move <character> [to <pos>] [y= scale= rot= alpha= flip= anchor=] <seconds>'],
  ['shake', 'shake <character|screen> [seconds]'], ['hop', 'hop <character> [seconds]'],
  ['animate', 'animate <character> <name|stop> [seconds] [loop]'],
  ['hud', 'hud on <screen> [keep] | hud off <screen>  (keep a screen up while the story runs)'],
  ['image', 'image show <name> <file> [at x,y] [layer=] | image move <name> ... | image hide <name>'],
  ['flash', 'flash [#color] [seconds]'], ['tint', 'tint <#color> [strength] [seconds] | tint off'],
  ['camera', 'camera zoom <factor> [at pos] [y=0-1] [seconds] | camera pan <pos> | camera reset'],
  ['weather', 'weather <rain|snow|petals|embers> [intensity] [seconds] | weather off'], ['filter', 'filter <blur|grayscale|sepia|night|vignette> [strength] [seconds] | filter off'],
   ['music', 'music play <name> [loop] [fade s] | music stop | music pause | music resume'], ['sound', 'sound play <name> [duck] | sound loop <name> [fade s] | sound stop [<name>] [fade s]'], ['wait', 'wait <seconds>'],
  ['nvl', 'nvl on | nvl off | nvl clear  (full-screen narration pages)'], ['set', 'set name = expression  (set persistent.name = ... keeps it across playthroughs)'], ['input', 'input <variable> "Prompt" [default="Name"] [max=16]'], ['jump', 'jump <label>'], ['call', 'call <label>  |  call <label>(arguments)  (the arguments fill the label parameters)'], ['return', 'return'],
  ['screen', 'screen name:  (a page of hotspots and buttons; show it with show screen name)'],
  ['end', 'end'], ['unlock', 'unlock <flag>  (persistent; read as unlocked.<flag>)'], ['define', 'define id "Name" color=#rrggbb [text=# font="" size= italic speed= blip= box=]'],
];
// Text tags, offered right after a "{" (which is not part of the typed word, so labels leave it out).
// `$0` marks where the cursor goes; the editor inserts these as snippets.
const TEXT_TAGS: Suggestion[] = ([
  ['i', '{i}..{/i}  italic', 'i}$0{/i}'], ['b', '{b}..{/b}  bold', 'b}$0{/b}'],
  ['color', '{color=#rrggbb}..{/color}', 'color=#ff6fa5}$0{/color}'], ['size', '{size=1.5}..{/size}  size multiplier', 'size=1.5}$0{/size}'],
  ['wave', '{wave}..{/wave}  wavy text', 'wave}$0{/wave}'], ['shake', '{shake}..{/shake}  shaky text', 'shake}$0{/shake}'],
  ['ruby', '{ruby=reading}base{/ruby}', 'ruby=}$0{/ruby}'], ['pause', '{pause=0.5}  pause typing (seconds)', 'pause=0.5}'],
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
  ['image', 'image "file.png" [at x,y] [size w,h]'], ['hotspot', 'hotspot <id> at x,y size w,h | ellipse ... | poly x,y x,y x,y | mask "file.png"  "Label"'],
  ['button', 'button <id> at x,y [size w,h] "Label"'], ['slider', 'slider <setting> at x,y [size w,h] [readout]  (options screen: master, music, sound, voice, text_speed, text_size, box_opacity)'], ['text', 'text at x,y "Text with [variables]"'],
  ['row', 'row [at x,y | anchor <place> [margin m]] [padding m] [gap n] [align start|center|end]:  (children need no "at")'], ['column', 'column [at x,y | anchor <place> [margin m]] [padding m] [gap n] [align start|center|end]:'],
  ['grid', 'grid <columns> [at x,y | anchor <place>] [gap n] [cell w,h] [align a]:'],
  ['scroll', 'scroll at x,y size w,h [start top|bottom] [bar off]:  (a box that scrolls its children; they are placed from its top left)'],
  ['each', 'each <list> as <name> [at x,y] [step dx,dy] [limit n]:'], ['default', 'default <element id>'], ['cancel', 'cancel  (the cancel key answers "")'],
];
const elementIds = (nodes: ScreenNode[]): string[] => nodes.flatMap(n => (n.kind === 'hotspot' || n.kind === 'button' ? [n.id] : childNodes(n).length ? elementIds(childNodes(n)) : []));
const DIRECTIONS = ['left', 'right', 'up', 'down'];
const EASES = EASE_NAMES.map(n => `ease=${n}`);

const kw = (labels: string[]): Suggestion[] => labels.map(label => ({ label, kind: 'keyword' }));
const assets = (labels: Iterable<string>, detail: string): Suggestion[] =>
  [...new Set(labels)].map(label => ({ label, kind: 'asset', detail }));

/**
 * Suggestions for the text on the current line before the cursor.
 * Names (backgrounds, poses, tracks) come from what the project already uses,
 * until asset manifests exist to supply them.
 */
export function getCompletions(program: Program, linePrefix: string, rigs: Record<string, RigManifest> = {}): Suggestion[] {
  const trimmed = linePrefix.trimStart();
  if (trimmed.startsWith('#')) return [];
  const assigned = program.ops.flatMap(o => (o.op === 'set' && !o.name.startsWith('persistent.') ? [o.name] : o.op === 'input' ? [o.name] : o.op === 'screen' && o.as ? [o.as] : []));
  const variables: Suggestion[] = [...new Set([...assigned, ...Object.values(program.params ?? {}).flat()])]
    .map(label => ({ label, kind: 'variable' }));
  const flags: Suggestion[] = [...new Set(program.ops.flatMap(o => (o.op === 'unlock' ? [o.name] : [])))]
    .map(name => ({ label: `unlocked.${name}`, kind: 'variable', detail: 'persistent flag' }));
  const persistent: Suggestion[] = [...new Set(program.ops.flatMap(o => (o.op === 'set' && o.name.startsWith('persistent.') ? [o.name] : [])))]
    .map(label => ({ label, kind: 'variable', detail: 'persistent value' }));

  const inString = (trimmed.match(/"/g)?.length ?? 0) % 2 === 1; // e.g. an `input` prompt or a screen's text
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
    return [
      ...SCREEN_ELEMENTS.map(([label, detail]) => ({ label, kind: 'command' as const, detail })),
      ...COMMANDS.map(([label, detail]) => ({ label, kind: 'command' as const, detail })),
      ...characters.map(c => ({ ...c, insertText: `${c.label}: ` })),
    ];
  }

  const cmd = prev[0];
  const arg = prev.length - 1;       // number of completed arguments
  const last = prev[prev.length - 1];

  switch (cmd) {
    case 'show': {
      if (arg === 0) return [...characters, { label: 'screen', kind: 'keyword' as const, detail: 'show screen <name> [as <variable>]' }];
      if (prev[1] === 'screen') return arg === 1 ? Object.keys(program.screens ?? {}).map(label => ({ label, kind: 'keyword' as const, detail: 'screen' })) : arg === 2 ? kw(['as']) : [];
      if (last === 'at') return kw(Object.keys(program.positions));
      if (last === 'fade') return [];
      const rig = rigs[prev[1]];
      const poses = [...(rig ? rigPoseNames(rig) : []), ...program.ops.flatMap(o => (o.op === 'show' && o.char === prev[1] && o.pose ? [o.pose] : []))];
      const slots = (rig ? rigSlotNames(rig) : []).map(s => ({ label: `${s}=`, kind: 'keyword' as const, detail: `slot of ${prev[1]}` }));
      return [...assets(poses, `pose of ${prev[1]}`), ...slots, ...kw(['at', 'fade', 'y=0', 'scale=1', 'flip=on', 'flip=off', ...anchorWords(program), 'nowait'])];
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
      if (arg === 0) return assets(program.ops.flatMap(o => (o.op === 'scene' ? [o.bg] : [])), 'background');
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
      if (arg === 2) return assets(program.ops.flatMap(o => (o.op === 'image' && o.action === 'show' ? [o.file] : [])), 'image');
      return kw(['at', 'scale=1', 'rot=0', 'alpha=1', 'layer=-1', 'fixed', 'keep', 'fade', ...anchorWords(program), 'nowait']);
    }
    case 'tint': return arg === 0 ? kw(['off']) : [];
    case 'weather': return arg === 0 ? kw([...WEATHER_NAMES, 'off']) : kw(['nowait']);
    case 'filter': return arg === 0 ? kw([...FILTER_NAMES, 'off']) : kw(['nowait']);
    case 'nvl': return arg === 0 ? kw(['on', 'off', 'clear']) : [];
    case 'camera':
      if (arg === 0) return kw(['zoom', 'pan', 'reset']);
      if (last === 'at' || last === 'pan') return kw(Object.keys(program.positions));
      if (prev[1] === 'pan') return kw(['y=0.5', ...EASES, 'nowait']);
      return prev[1] === 'zoom' ? kw(['at', 'y=0.5', ...EASES, 'nowait']) : kw([...EASES, 'nowait']);
    case 'music': {
      if (arg === 0) return kw(['play', 'stop', 'pause', 'resume']);
      if (prev[1] === 'play' && arg === 1) return assets(program.ops.flatMap(o => (o.op === 'music' && o.name ? [o.name] : [])), 'track');
      return kw(prev[1] === 'play' ? ['loop', 'fade', 'nowait'] : ['fade', 'nowait']);
    }
    case 'sound': {
      if (arg === 0) return kw(['play', 'loop', 'stop']);
      if (arg === 1) return [...(prev[1] === 'stop' ? kw(['fade', 'nowait']) : []), ...assets(program.ops.flatMap(o => (o.op === 'sound' && o.name ? [o.name] : [])), 'sound')];
      return kw(prev[1] === 'play' ? ['duck', 'nowait'] : ['fade', 'nowait']);
    }
    case 'define':
      if (arg === 0) return [{ label: 'item', kind: 'keyword', detail: 'define item <id> "Name" [image=file.png]' }];
      if (prev[1] === 'item') return arg >= 3 ? kw(['image=']) : [];
      if (arg < 2) return [];
      if (word.startsWith('blip=')) return kw(BLIP_PRESETS); // "=" ends a word in the editor: complete the value only
      return kw(['color=', 'text=', 'font=""', 'size=1.1', 'italic', 'speed=0.8', 'blip=', 'box=']);
    case 'hud':
      if (arg === 0) return kw(['on', 'off']);
      if (arg === 1) return Object.keys(program.screens ?? {}).map(label => ({ label, kind: 'keyword' as const, detail: 'screen' }));
      return prev[1] === 'on' ? kw(['keep']) : [];
    case 'hotspot': case 'button':
      if (arg === 0) return [];
      if (last === 'on') return kw(['click', 'focus', 'blur']);
      if (prev[prev.length - 2] === 'on') return labels;
      return kw(cmd === 'button' ? ['at', 'size', 'hover', 'up', 'down', 'left', 'right', 'on', 'action', 'if', 'enabled'] : ['at', 'size', 'ellipse', 'poly', 'mask', 'cursor', 'hover', 'tooltip', 'up', 'down', 'left', 'right', 'on', 'action', 'if', 'enabled']);
    case 'image': return kw(['at', 'size']);
    case 'slider': return arg === 0 ? kw(Object.keys(SLIDER_SETTINGS)) : kw(['at', 'size', 'readout', 'if']);
    case 'text': return kw(['at', 'if']);
    case 'scroll': return kw(['at', 'size', 'start', 'bar', 'if']);
    case 'row': case 'column': case 'grid': return kw(['at', 'anchor', 'margin', 'padding', 'gap', 'align', 'if', ...(cmd === 'grid' ? ['cell'] : [])]);
    case 'each': return arg === 1 ? kw(['as']) : arg >= 3 ? kw(['at', 'step', 'limit', 'if']) : [];
    case 'default': return arg === 0 ? [...new Set(Object.values(program.screens ?? {}).flatMap(sc => elementIds(sc.body)))].map(label => ({ label, kind: 'keyword' as const })) : [];
    case 'menu': return prev.includes('timeout') ? [] : kw(['timeout']);
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
