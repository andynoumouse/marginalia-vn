import { ANCHORS, parseAnchor, type Anchor, type Anchors } from './anchor.js';
import { ANIM_NAMES, DEFAULT_EASE, EASE_NAMES } from './anim.js';
import { BUILTIN_POSITIONS, type Position, type Positions } from './positions.js';
import { parseExpr, parseExprList, usesRandom, ExprError, type Expr } from './expr.js';
import { FILTER_NAMES, WEATHER_NAMES, isFilterName, isWeatherName, type FilterName, type WeatherName } from './fx.js';
import type { LocalSets, ScreenDef, ScreenNode } from './screens.js';
import { DEFAULT_STAGE, stageLabel, type StageSize } from './stage.js';
import { withFix } from './suggest.js';
import { ElementSyntaxError, startsWithClause, parseEachHeader, parseElementLine, parseLayoutHeader, parsePanelHeader, parseScrollHeader } from './screen-syntax.js';
import { TRANSITIONS, type CharacterDef, type Diagnostic, type ItemDef, type OpBody, type Src, type Transition, type VisualBody } from './types.js';

// Line shapes shared with the id tool (ids.ts).
// A line may end in `style=<name>` (a theme style for this line) before its `#id`.
export const RE_SAY = /^([A-Za-z_][A-Za-z0-9_]*):[ \t]+(.*?)(?:[ \t]+style=(\w+))?(?:[ \t]+#([A-Za-z0-9]{4,8}))?$/;
export const RE_NARR = /^"((?:[^"\\]|\\.)*)"(?:[ \t]+style=(\w+))?(?:[ \t]+#([A-Za-z0-9]{4,8}))?$/;
// `input name "Prompt" [options] [#id]`: the prompt is a localizable string when it has an id.
export const RE_INPUT = /^input[ \t]+[A-Za-z_]\w*[ \t]+"((?:[^"\\]|\\.)+)"/;
export const RE_INPUT_ID = /[ \t]#([A-Za-z0-9]{4,8})$/;
// `"Text" [#id] [if cond [else "Reason" [#id]]]:`; with an `else` an option whose condition fails is shown disabled, with the reason.
export const RE_OPT = /^"((?:[^"\\]|\\.)*)"(?:[ \t]+#([A-Za-z0-9]{4,8}))?(?:[ \t]+if[ \t]+(.+?)(?:[ \t]+else[ \t]+"((?:[^"\\]|\\.)*)"(?:[ \t]+#([A-Za-z0-9]{4,8}))?)?)?[ \t]*:$/;

const RE_LABEL = /^label[ \t]+([A-Za-z_][A-Za-z0-9_]*)[ \t]*(?:\(([^()]*)\))?[ \t]*:$/;
const RE_CALL = /^call[ \t]+([A-Za-z_][A-Za-z0-9_]*)[ \t]*(?:\((.*)\))?[ \t]*(?:#.*)?$/;
const RESERVED_WORDS = ['true', 'false', 'and', 'or', 'not'];
// `menu ["Prompt" [#id]] [timeout <seconds>]:`
export const RE_MENU = /^menu(?:[ \t]+"((?:[^"\\]|\\.)+)"(?:[ \t]+#([A-Za-z0-9]{4,8}))?)?(?:[ \t]+style=(\w+))?(?:[ \t]+timeout[ \t]+(.+?))?[ \t]*:$/;
const RE_ON_TIMEOUT = /^on[ \t]+timeout[ \t]*:$/;
const RE_SCREEN = /^screen[ \t]+([A-Za-z_][A-Za-z0-9_]*)[ \t]*(?:\(([^()]*)\))?[ \t]*:?$/;
const RE_SHOW_SCREEN = /^show[ \t]+screen[ \t]+([A-Za-z_]\w*)[ \t]*(?:\((.*)\))?(?:[ \t]+as[ \t]+([A-Za-z_]\w*))?[ \t]*(?:#.*)?$/;
export const RE_DEFINE_ITEM = /^define[ \t]+item[ \t]+[A-Za-z_]\w*(?=[ \t]|$)/;
const RE_IF = /^if[ \t]+(.+?)[ \t]*:$/;
const RE_ELIF = /^elif[ \t]+(.+?)[ \t]*:$/;
const RE_ELSE = /^else[ \t]*:$/;
const RE_SET = /^set[ \t]+((?:persistent\.)?[A-Za-z_][A-Za-z0-9_]*)[ \t]*(=|\+=|-=|\*=|\/=)[ \t]*(.+)$/;

export type Node =
  | { k: 'op'; src: Src; body: OpBody }
  | { k: 'label'; src: Src; name: string; params: string[]; body: Node[] }
  | { k: 'if'; src: Src; branches: { cond: Expr | null; src: Src; body: Node[] }[] }
  | { k: 'menu'; src: Src; prompt: string | null; promptId: string | null; look: string | null;
      options: { text: string; id: string | null; cond: Expr | null; reason: string | null; reasonId: string | null; src: Src; to: number; body: Node[] }[];
      /** `timeout <seconds>` on the header together with the `on timeout:` block; null: no clock. */
      timeout: { seconds: Expr; src: Src; to: number; body: Node[] } | null };

export interface ParsedFile { file: string; nodes: Node[]; characters: CharacterDef[]; items: ItemDef[]; screens: ScreenDef[] }

class ParseError extends Error {}
/** The first word of a line is not a command; `word` gets "did you mean" fixes from COMMAND_WORDS. */
class UnknownCommand extends ParseError {
  word: string;
  constructor(cmd: string) { super(`Unknown command "${cmd}"`); this.word = cmd.replace(/:$/, ''); } // `mnue:` is `menu:` mistyped
}
/** Every word a statement can start with (for "did you mean" on an unknown one). */
export const COMMAND_WORDS = ['label', 'menu', 'if', 'elif', 'else', 'set', 'define', 'screen', 'scene', 'show', 'hide', 'move', 'shake',
  'animate', 'hop', 'flash', 'tint', 'focus', 'camera', 'weather', 'filter', 'hud', 'image', 'music', 'sound', 'movie', 'wait', 'call', 'jump', 'nvl',
  'textbox', 'unlock', 'input', 'return', 'end'];
/** `parts`: the physical lines of a screen element written over several (this line first, then its clause continuations); `text` is then all of them joined. */
interface RawLine { no: number; indent: number; text: string; parts?: RawLine[] }

export function unescapeText(s: string): string {
  return s.replace(/\\(["\\n])/g, (_, c: string) => (c === 'n' ? '\n' : c));
}

const COLOR = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
export const DEFINE_ATTRS = ['color=', 'text=', 'font=', 'size=', 'italic', 'speed=', 'blip=', 'style=', 'box=', 'focus=off', 'side='];

/** Apply one `key=value` (or flag) of a define line; returns a problem message, if any. */
function defineAttr(def: CharacterDef, attr: string): string | null {
  if (attr === 'italic') { def.style.italic = true; return null; }
  const eq = attr.indexOf('=');
  const key = eq > 0 ? attr.slice(0, eq) : attr, val = eq > 0 ? attr.slice(eq + 1) : '';
  const positive = () => (Number(val) > 0 ? Number(val) : null);
  switch (key) {
    case 'color': if (!COLOR.test(val)) return `color= needs a color like #ff6fa5`; def.color = val; return null;
    case 'text': if (!COLOR.test(val)) return `text= needs a color like #ffe6f0`; def.style.textColor = val; return null;
    case 'font': if (!val) return 'font= needs a font name, e.g. font="Georgia"'; def.style.font = val; return null;
    case 'size': { const n = positive(); if (!n) return 'size= needs a number like 1.1'; def.style.size = n; return null; }
    case 'speed': { const n = positive(); if (!n) return 'speed= needs a number like 0.8'; def.style.speed = n; return null; }
    case 'blip': if (!/^\w+$/.test(val)) return 'blip= needs a sound name'; def.style.blip = val; return null;
    case 'style': case 'box': if (!/^\w+$/.test(val)) return `${key}= needs a style name`; def.style.box = val; return null; // box= is the old name
    case 'focus': if (val !== 'on' && val !== 'off') return 'focus= is on or off'; if (val === 'off') def.focus = false; else delete def.focus; return null;
    case 'side': if (!/^\w+$/.test(val)) return 'side= needs a portrait name (assets/side/<name>.png)'; def.side = val; return null;
    default: return `Unknown define option "${attr}" (use ${DEFINE_ATTRS.join(' ')})`;
  }
}

function tokenizeArgs(s: string): string[] {
  const out: string[] = [];
  const re = /(\w+=)?"((?:[^"\\]|\\.)*)"|(\S+)/g; // "quoted", key="quoted value", or bare
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out.push(m[2] !== undefined ? (m[1] ?? '') + unescapeText(m[2]) : m[3]);
  return out;
}

function num(tok: string | undefined, what: string): number {
  const n = Number(tok);
  if (tok === undefined || tok === '' || !Number.isFinite(n)) throw new ParseError(`Expected a number for ${what}`);
  return n;
}
function anchorArg(tok: string, anchors: Anchors): Anchor {
  try { return parseAnchor(tok.slice(7), anchors); } catch (e) { throw new ParseError((e as Error).message); }
}
const isNum = (t: string | undefined) => t !== undefined && t !== '' && Number.isFinite(Number(t));

function parsePos(tok: string | undefined, positions: Positions): Position {
  if (tok === undefined) throw new ParseError(`Expected a position (${Object.keys(positions).join(', ')} or a number 0-1)`);
  if (Object.hasOwn(positions, tok)) return positions[tok];
  if (isNum(tok)) return { x: Number(tok) };
  throw new ParseError(`Unknown position "${tok}" (${Object.keys(positions).join(', ')}; more in game.json "positions")`);
}

function parseCommand(text: string, positions: Positions, anchors: Anchors, stage: StageSize): OpBody {
  const toks = tokenizeArgs(text);
  const cmd = toks[0];
  let a = toks.slice(1);
  let nowait = false;
  if (a.includes('nowait')) { nowait = true; a = a.filter(t => t !== 'nowait'); }
  const visual = <T extends VisualBody>(b: T): OpBody => (nowait ? { ...b, nowait: true } : b);
  const need = (i: number, what: string) => { if (a[i] === undefined) throw new ParseError(`"${cmd}" needs ${what}`); return a[i]; };
  /** The command takes `n` arguments (and nowait): anything after them is a mistake, not something to ignore. */
  const extra = (n: number, hint = '') => { if (a.length > n) throw new ParseError(`Unexpected "${a[n]}" in ${cmd}${hint ? ` (${hint})` : ''}`); };
  /** Optional trailing numbers (`[strength] [seconds]`) at `from`: at most `max`, each a number. */
  const numbers = (from: number, max: number, usage: string) => {
    if (a.length > from + max || a.slice(from).some(t => !isNum(t))) throw new ParseError(usage);
  };

  switch (cmd) {
    case 'scene': {
      const bg = need(0, 'a background name');
      let i = 1, dir: string | null = null;
      let transition = 'cut' as Transition;
      if (TRANSITIONS.includes(a[i] as Transition)) transition = a[i++] as Transition;
      if (transition === 'wipe') dir = !isNum(a[i]) && a[i] !== undefined ? a[i++] : 'left';
      const dur = isNum(a[i]) ? Number(a[i]) : transition === 'cut' ? 0 : 0.5;
      if (isNum(a[i])) i++;
      extra(i, `transitions: ${TRANSITIONS.join(', ')}`);
      return visual({ op: 'scene', bg, transition, dir, dur });
    }
    case 'show': {
      if (a[0] === 'screen') {
        const m = RE_SHOW_SCREEN.exec(text.trim());
        if (!m) throw new ParseError('Use: show screen <name> [(arguments)] [as <variable>]');
        let args: Expr[] = [];
        try { args = parseExprList(m[2] ?? ''); } catch (e) { throw new ParseError(e instanceof ExprError ? e.message : String(e)); }
        return { op: 'screen', name: m[1], as: m[3] ?? 'screen', ...(args.length ? { args } : {}) };
      }
      const char = need(0, 'a character');
      let pose: string | null = null, x: number | null = null, fade = 0;
      const more: string[] = []; // bare words after the first: further looks, applied left to right
      const overrides: Record<string, string> = {};
      const place: { y?: number; scale?: number; flip?: boolean; anchor?: Anchor; order?: 'front' | 'back'; behind?: string } = {};
      let posY: number | undefined; // the named position's height, used unless the line has its own y=
      for (let i = 1; i < a.length;) {
        const t = a[i];
        if (t === 'at') { const p = parsePos(a[i + 1], positions); x = p.x; posY = p.y; i += 2; }
        else if (t.startsWith('order=')) {
          const v = t.slice(6);
          if (v !== 'front' && v !== 'back') throw new ParseError('order= takes front or back');
          place.order = v; i++;
        }
        else if (t.startsWith('behind=')) {
          const v = t.slice(7);
          if (!/^[A-Za-z_]\w*$/.test(v)) throw new ParseError('behind= takes a character name');
          if (v === char) throw new ParseError(`"${char}" cannot stand behind itself`);
          place.behind = v; i++;
        }
        else if (t === 'fade') { fade = num(a[i + 1], 'fade duration'); i += 2; }
        else if (t.startsWith('y=')) { place.y = num(t.slice(2), 'y'); i++; }
        else if (t.startsWith('scale=')) { place.scale = num(t.slice(6), 'scale'); i++; }
        else if (t.startsWith('flip=')) {
          const v = t.slice(5);
          if (v !== 'on' && v !== 'off') throw new ParseError('flip= takes on or off');
          place.flip = v === 'on'; i++;
        }
        else if (t.startsWith('anchor=')) { place.anchor = anchorArg(t, anchors); i++; }
        else if (t.includes('=')) { const [k, v] = t.split('='); overrides[k] = v; i++; }
        else if (pose === null) { pose = t; i++; }
        else { more.push(t); i++; }
      }
      if (place.y === undefined && posY !== undefined) place.y = posY;
      if (place.order && place.behind) throw new ParseError('Use either order= or behind=, not both');
      return visual({ op: 'show', char, pose, more, overrides, x, fade, ...place });
    }
    case 'hide': {
      const char = need(0, 'a character');
      const fade = a[1] === 'fade' ? num(a[2], 'fade duration') : 0;
      extra(a[1] === 'fade' ? 3 : 1, 'use: hide <char> [fade seconds]');
      return visual({ op: 'hide', char, fade });
    }
    case 'move': {
      const char = need(0, 'a character');
      const usage = 'Use: move <char> [to <position>] [y=] [scale=] [rot=] [alpha=] [flip=on|off] [anchor=] [seconds] [ease=]';
      let x: number | null = null, dur = 0, ease = DEFAULT_EASE;
      const props: Record<string, number> = {};
      let flip: boolean | null = null, anchor: Anchor | null = null, posY: number | undefined;
      for (let i = 1; i < a.length;) {
        const t = a[i];
        if (t === 'to') { const p = parsePos(a[i + 1], positions); x = p.x; posY = p.y; i += 2; }
        else if (t.startsWith('ease=')) {
          ease = t.slice(5);
          if (!EASE_NAMES.includes(ease)) throw new ParseError(`Unknown ease "${ease}" (${EASE_NAMES.join(', ')})`);
          i++;
        }
        else if (t.startsWith('flip=')) {
          const v = t.slice(5);
          if (v !== 'on' && v !== 'off') throw new ParseError('flip= takes on or off');
          flip = v === 'on'; i++;
        }
        else if (t.startsWith('anchor=')) { anchor = anchorArg(t, anchors); i++; }
        else if (t.includes('=')) {
          const [k, v] = t.split('=');
          if (!['y', 'scale', 'rot', 'alpha'].includes(k)) throw new ParseError(`Unknown property "${k}" in move`);
          props[k] = num(v, k); i++;
        }
        else if (isNum(t)) { dur = Number(t); i++; }
        else throw new ParseError(usage);
      }
      if (x === null && flip === null && anchor === null && Object.keys(props).length === 0) throw new ParseError(usage);
      return visual({ op: 'move', char, x, y: props.y ?? posY ?? null, scale: props.scale ?? null, rotation: props.rot ?? null, alpha: props.alpha ?? null, flip, anchor, dur, ease });
    }
    case 'shake': {
      const target = need(0, 'a character or "screen"');
      let dur = 0.3, strength = 8, gotDur = false;
      for (const t of a.slice(1)) {
        if (t.startsWith('strength=')) strength = num(t.slice(9), 'strength');
        else if (isNum(t) && !gotDur) { dur = Number(t); gotDur = true; }
        else throw new ParseError(t === 'loop'
          ? 'shake is a single shake and has no loop: use animate <char> shake loop for a continuous one'
          : 'Use: shake <char|screen> [seconds] [strength=8]');
      }
      return visual({ op: 'shake', target, dur, strength });
    }
    case 'animate': {
      const char = need(0, 'a character');
      const name = need(1, `an animation (${ANIM_NAMES.join(', ')}) or stop`);
      if (name === 'stop') return visual({ op: 'animate', char, name: null, dur: null, loop: false, strength: 1, part: null });
      if (!/^[A-Za-z_]\w*$/.test(name)) throw new ParseError(`"${name}" is not an animation name (presets: ${ANIM_NAMES.join(', ')}; a character's rig.json can add more)`);
      let dur: number | null = null, loop = false, strength = 1, part: string | null = null;
      for (const t of a.slice(2)) {
        if (t === 'loop') loop = true;
        else if (t.startsWith('strength=')) strength = num(t.slice(9), 'strength');
        else if (t.startsWith('part=') && t.length > 5) part = t.slice(5);
        else if (isNum(t) && Number(t) > 0) dur = Number(t);
        else throw new ParseError('Use: animate <char> <name> [seconds] [loop] [strength=1] [part=name], or animate <char> stop');
      }
      return visual({ op: 'animate', char, name, dur, loop, strength, part });
    }
    case 'hop': {
      const char = need(0, 'a character');
      numbers(1, 1, 'Use: hop <char> [seconds]');
      return visual({ op: 'hop', char, dur: isNum(a[1]) ? Number(a[1]) : 0.25 });
    }
    case 'flash': {
      const color = a.find(t => COLOR.test(t)) ?? '#ffffff';
      const rest = a.filter(t => t !== color);
      if (rest.length > 1) throw new ParseError('Use: flash [#rrggbb] [seconds]');
      return visual({ op: 'flash', color, dur: rest.length ? num(rest[0], 'duration') : 0.4 });
    }
    case 'tint': {
      const usage = 'Use: tint <#rrggbb> [strength 0-1] [seconds]  or  tint off [seconds]';
      if (a[0] === 'off') { numbers(1, 1, usage); return visual({ op: 'tint', color: null, strength: 0, dur: isNum(a[1]) ? Number(a[1]) : 0 }); }
      const color = need(0, 'a color like #203060, or "off"');
      if (!COLOR.test(color)) throw new ParseError(usage);
      numbers(1, 2, usage);
      const strength = isNum(a[1]) ? Number(a[1]) : 0.4;
      if (strength < 0 || strength > 1) throw new ParseError('Tint strength is 0 to 1');
      return visual({ op: 'tint', color, strength, dur: isNum(a[2]) ? Number(a[2]) : 0 });
    }
    case 'focus': {
      if ((a[0] !== 'on' && a[0] !== 'off') || a.length > 1) throw new ParseError('Use: focus on  |  focus off');
      return visual({ op: 'focus', on: a[0] === 'on' });
    }
    case 'camera': {
      const easeArg = a.find(t => t.startsWith('ease=')), yArg = a.find(t => t.startsWith('y='));
      const rest = a.filter(t => !t.startsWith('ease=') && !t.startsWith('y='));
      const ease = easeArg ? easeArg.slice(5) : 'inout';
      const usage = 'Use: camera zoom <factor> [at <pos>] [y=0-1] [seconds], camera pan <pos> [y=0-1] [seconds], or camera reset [seconds]';
      const tail = (from: number) => { if (rest.length > from + 1 || (rest[from] !== undefined && !isNum(rest[from]))) throw new ParseError(usage); };
      if (rest[0] === 'reset') { tail(1); return visual({ op: 'camera', zoom: 1, x: 0.5, y: 0.5, dur: isNum(rest[1]) ? Number(rest[1]) : 0, ease }); }
      if (rest[0] === 'pan') {
        // Moves the point the zoom is about, keeping the zoom: only visible while zoomed in.
        const x = parsePos(rest[1], positions).x;
        const y = yArg ? num(yArg.slice(2), 'y') : 0.5;
        tail(2);
        return visual({ op: 'camera', zoom: null, x, y, dur: isNum(rest[2]) ? Number(rest[2]) : 0, ease });
      }
      if (rest[0] !== 'zoom') throw new ParseError(usage);
      const zoom = num(rest[1], 'zoom factor');
      if (zoom < 1) throw new ParseError('Zoom is 1 (normal) or more');
      let i = 2, x = 0.5;
      const y = yArg ? num(yArg.slice(2), 'y') : 0.5;
      if (rest[i] === 'at') { x = parsePos(rest[i + 1], positions).x; i += 2; }
      tail(i);
      return visual({ op: 'camera', zoom, x, y, dur: isNum(rest[i]) ? Number(rest[i]) : 0, ease });
    }
    case 'weather': {
      const usage = `Use: weather <${WEATHER_NAMES.join('|')}> [intensity 0-1] [seconds], or weather off [seconds]`;
      if (a[0] === 'off') { numbers(1, 1, usage); return visual({ op: 'weather', kind: null, intensity: 0, dur: isNum(a[1]) ? Number(a[1]) : 0 }); }
      if (!isWeatherName(a[0] ?? '')) throw new ParseError(usage);
      numbers(1, 2, usage);
      const intensity = isNum(a[1]) ? Number(a[1]) : 0.6;
      if (intensity < 0 || intensity > 1) throw new ParseError('Weather intensity is 0 to 1');
      return visual({ op: 'weather', kind: a[0] as WeatherName, intensity, dur: isNum(a[2]) ? Number(a[2]) : 0 });
    }
    case 'filter': {
      const usage = `Use: filter <${FILTER_NAMES.join('|')}> [strength 0-1] [seconds], or filter off [seconds]`;
      if (a[0] === 'off') { numbers(1, 1, usage); return visual({ op: 'filter', name: null, strength: 0, dur: isNum(a[1]) ? Number(a[1]) : 0 }); }
      if (!isFilterName(a[0] ?? '')) throw new ParseError(usage);
      numbers(1, 2, usage);
      const strength = isNum(a[1]) ? Number(a[1]) : 1;
      if (strength < 0 || strength > 1) throw new ParseError('Filter strength is 0 to 1');
      return visual({ op: 'filter', name: a[0] as FilterName, strength, dur: isNum(a[2]) ? Number(a[2]) : 0 });
    }
    case 'hud': {
      const word = /^[A-Za-z_]\w*$/;
      if ((a[0] !== 'on' && a[0] !== 'off') || !word.test(a[1] ?? '') || a.length > (a[0] === 'on' && a[2] === 'keep' ? 3 : 2)) throw new ParseError('Use: hud on <screen> [keep]  or  hud off <screen>');
      return { op: 'hud', mode: a[0], name: a[1], keep: a[2] === 'keep' };
    }
    case 'image': {
      const usage = 'Use: image show <name> <file> [at x,y] [scale=] [rot=] [alpha=] [anchor=] [layer=] [fixed] [keep] [fade s], image move <name> [to x,y] [scale=] [rot=] [alpha=] [anchor=] [seconds] [ease=], or image hide <name> [fade s]';
      const verb = a[0], name = a[1];
      if (!name || !/^[A-Za-z_]\w*$/.test(name)) throw new ParseError(usage);
      const xy = (tok: string | undefined) => {
        const m = /^(-?\d*\.?\d+),(-?\d*\.?\d+)$/.exec(tok ?? '');
        if (!m) throw new ParseError('A position is stage pixels like 960,540 (the stage is ' + stageLabel(stage) + ')');
        return { x: Number(m[1]), y: Number(m[2]) };
      };
      if (verb === 'hide') {
        if (a.length > 2 && (a[2] !== 'fade' || !isNum(a[3]) || a.length > 4)) throw new ParseError(usage);
        return visual({ op: 'image', action: 'hide', name, fade: a[2] ? Number(a[3]) : 0 });
      }
      if (verb !== 'show' && verb !== 'move') throw new ParseError(usage);
      const props: Record<string, number> = {};
      let pos: { x: number; y: number } | null = null, anchor: Anchor | null = null, dur = 0, fade = 0, ease = DEFAULT_EASE;
      let layer: number | undefined, fixed = false, keep = false, file: string | null = null;
      for (let i = 2; i < a.length;) {
        const t = a[i];
        if (t === (verb === 'show' ? 'at' : 'to')) { pos = xy(a[i + 1]); i += 2; }
        else if (verb === 'show' && t === 'fade') { fade = num(a[i + 1], 'fade duration'); i += 2; }
        else if (verb === 'show' && t === 'fixed') { fixed = true; i++; }
        else if (verb === 'show' && t === 'keep') { keep = true; i++; }
        else if (verb === 'show' && t.startsWith('layer=')) {
          layer = num(t.slice(6), 'layer');
          if (!Number.isInteger(layer)) throw new ParseError('layer= is a whole number (below 0 draws behind the characters)');
          i++;
        }
        else if (verb === 'move' && t.startsWith('ease=')) {
          ease = t.slice(5);
          if (!EASE_NAMES.includes(ease)) throw new ParseError(`Unknown ease "${ease}" (${EASE_NAMES.join(', ')})`);
          i++;
        }
        else if (t.startsWith('anchor=')) { anchor = anchorArg(t, anchors); i++; }
        else if (t.includes('=')) {
          const [k, v] = t.split('=');
          if (!['scale', 'rot', 'alpha'].includes(k)) throw new ParseError(`Unknown property "${k}" in image ${verb}`);
          props[k] = num(v, k); i++;
        }
        else if (verb === 'move' && isNum(t)) { dur = Number(t); i++; }
        else if (verb === 'show' && file === null) { file = t; i++; }
        else throw new ParseError(`Unexpected "${t}" in image ${verb}`);
      }
      if (props.scale !== undefined && props.scale <= 0) throw new ParseError('scale= must be above 0');
      if (props.alpha !== undefined && (props.alpha < 0 || props.alpha > 1)) throw new ParseError('alpha= is 0 to 1');
      if (verb === 'move') {
        if (!pos && !anchor && Object.keys(props).length === 0) throw new ParseError(usage);
        return visual({ op: 'image', action: 'move', name, x: pos?.x ?? null, y: pos?.y ?? null, scale: props.scale ?? null, rotation: props.rot ?? null, alpha: props.alpha ?? null, anchor, dur, ease });
      }
      if (file === null) throw new ParseError(usage);
      return visual({
        op: 'image', action: 'show', name, file, fade,
        ...(pos ? { x: pos.x, y: pos.y } : {}), ...(props.scale !== undefined ? { scale: props.scale } : {}),
        ...(props.rot !== undefined ? { rotation: props.rot } : {}), ...(props.alpha !== undefined ? { alpha: props.alpha } : {}),
        ...(anchor ? { anchor } : {}), ...(layer !== undefined ? { layer } : {}), ...(fixed ? { fixed } : {}), ...(keep ? { keep } : {}),
      });
    }
    case 'music': {
      const action = need(0, '"play", "stop", "pause" or "resume"');
      if (action !== 'play' && action !== 'stop' && action !== 'pause' && action !== 'resume') throw new ParseError('Use: music play <name> [loop] [fade n], music stop [fade n], music pause [fade n] or music resume [fade n]');
      const fi = a.indexOf('fade');
      const fade = fi >= 0 ? num(a[fi + 1], 'fade duration') : 0;
      const rest = fi >= 0 ? [...a.slice(0, fi), ...a.slice(fi + 2)] : a;
      if (action !== 'play') {
        if (rest.length > 1) throw new ParseError(`Unexpected "${rest[1]}" in music ${action} (use: music ${action} [fade seconds])`);
        return visual({ op: 'music', action, name: null, loop: false, fade });
      }
      const name = need(1, 'a track name');
      if (rest.length > 3 || (rest[2] !== undefined && rest[2] !== 'loop')) throw new ParseError(`Unexpected "${rest[2] === 'loop' ? rest[3] : rest[2]}" in music play (use: music play <name> [loop] [fade seconds])`);
      return visual({ op: 'music', action, name, loop: rest[2] === 'loop', fade });
    }
    case 'sound': {
      const usage = 'Use: sound play <name> [duck], sound loop <name> [fade n] or sound stop [<name>] [fade n]';
      const action = need(0, '"play", "loop" or "stop"');
      if (action !== 'play' && action !== 'loop' && action !== 'stop') throw new ParseError(usage);
      const fi = a.indexOf('fade');
      const fade = fi >= 0 ? num(a[fi + 1], 'fade duration') : 0;
      const rest = a.slice(1).filter((t, i) => !(fi >= 1 && (i + 1 === fi || i + 1 === fi + 1)));
      const duck = action === 'play' && rest.includes('duck');
      const names = rest.filter(t => t !== 'duck');
      if (names.length > 1 || (action === 'play' && fi >= 0) || (action !== 'play' && rest.includes('duck'))) throw new ParseError(usage);
      if (action === 'stop') return visual({ op: 'sound', action, name: names[0] ?? null, fade });
      if (!names[0]) throw new ParseError(usage);
      return visual({ op: 'sound', action, name: names[0], fade, ...(duck ? { duck } : {}) });
    }
    case 'movie': {
      const usage = 'Use: movie play <name> [noskip | loop]';
      if (nowait) throw new ParseError('A movie always plays to its end (or until the player skips it), so it has no nowait');
      const flags = a.slice(2);
      if (a[0] !== 'play' || !a[1] || flags.some((f, i) => (f !== 'noskip' && f !== 'loop') || flags.indexOf(f) !== i)) throw new ParseError(usage);
      const noskip = flags.includes('noskip'), loop = flags.includes('loop');
      if (noskip && loop) throw new ParseError('A looping movie only ends when the player skips it, so loop cannot be combined with noskip');
      return visual({ op: 'movie', name: a[1], noskip, loop });
    }
    case 'wait': {
      const dur = num(a[0], 'seconds');
      extra(1, 'use: wait <seconds>');
      return visual({ op: 'wait', dur });
    }
    case 'call': {
      // call label  |  call label(expr, expr, ...): the arguments are expressions, bound to the label's parameters
      const m = RE_CALL.exec(text.trim());
      if (!m) throw new ParseError('Use: call <label>  or  call <label>(arguments)');
      let args: Expr[] = [];
      try { args = parseExprList(m[2] ?? ''); } catch (e) { throw new ParseError(e instanceof ExprError ? e.message : String(e)); }
      return { op: 'call', label: m[1], target: -1, ...(args.length ? { args } : {}) };
    }
    case 'jump': {
      const label = need(0, 'a label name');
      extra(1, 'use: jump <label>');
      return { op: 'jump', label, target: -1 };
    }
    case 'nvl': {
      const mode = a[0];
      if ((mode !== 'on' && mode !== 'off' && mode !== 'clear') || a.length > 1) throw new ParseError('Use: nvl on  |  nvl off  |  nvl clear');
      return { op: 'nvl', mode };
    }
    case 'textbox': {
      if (a[0] !== 'hide' || a.length > 1) throw new ParseError('Use: textbox hide  (the next line shows the text box again)');
      return { op: 'textbox', mode: 'hide' };
    }
    case 'unlock': {
      const name = need(0, 'a flag name');
      if (!/^[A-Za-z_]\w*$/.test(name) || a.length > 1) throw new ParseError('Use: unlock <name> (letters, digits, _)');
      return { op: 'unlock', name };
    }
    case 'input': {
      const name = need(0, 'a variable name');
      if (!/^[A-Za-z_]\w*$/.test(name)) throw new ParseError('Use: input <variable> "Prompt" [default="Name"] [max=16]');
      let prompt = '', def = '', max = 24, id: string | null = null;
      for (const t of a.slice(1)) {
        if (/^#[A-Za-z0-9]{4,8}$/.test(t)) { id = t.slice(1); continue; }
        if (t.startsWith('default=')) def = t.slice(8);
        else if (t.startsWith('max=')) { max = num(t.slice(4), 'max'); if (max < 1) throw new ParseError('max= needs a length of at least 1'); }
        else if (!prompt) prompt = t;
        else throw new ParseError(`Unexpected "${t}" in input`);
      }
      if (id && !prompt) throw new ParseError('An input id needs a prompt to translate');
      return { op: 'input', name, prompt, id, default: def, max: Math.floor(max) };
    }
    case 'return': extra(0); return { op: 'ret' };
    case 'end': extra(0); return { op: 'end' };
    default:
      throw new UnknownCommand(cmd);
  }
}

export function parseFile(file: string, text: string, diags: Diagnostic[], positions: Positions = BUILTIN_POSITIONS, anchors: Anchors = ANCHORS, stage: StageSize = DEFAULT_STAGE): ParsedFile {
  const characters: CharacterDef[] = [];
  const items: ItemDef[] = [];
  const screens: ScreenDef[] = [];
  const lines: RawLine[] = [];
  text.split(/\r?\n/).forEach((raw, idx) => {
    const no = idx + 1;
    if (/^\s*$/.test(raw) || /^\s*#/.test(raw)) return;
    if (/^ *\t/.test(raw)) { diags.push({ file, line: no, severity: 'error', message: 'Use spaces for indentation, not tabs' }); return; }
    lines.push({ no, indent: raw.length - raw.trimStart().length, text: raw.trim() });
  });

  let i = 0, depth = 0;
  const err = (ln: RawLine, message: string) => diags.push({ file, line: ln.no, severity: 'error', message });
  const warn = (ln: RawLine, message: string) => diags.push({ file, line: ln.no, severity: 'warning', message });
  const src = (ln: RawLine): Src => ({ file, line: ln.no });
  const exprOf = (ln: RawLine, s: string): Expr | null => {
    try { return parseExpr(s); } catch (e) { err(ln, e instanceof ExprError ? e.message : String(e)); return null; }
  };

  function parseBlock(indent: number): { nodes: Node[]; endLine: number } {
    const nodes: Node[] = [];
    const startNo = lines[i]?.no ?? 0;
    while (i < lines.length) {
      const ln = lines[i];
      if (ln.indent < indent) break;
      if (ln.indent > indent) { // a run of lines indented too far: reported once, then read as a block of its own
        err(ln, 'Unexpected indentation');
        nodes.push(...parseBlock(ln.indent).nodes);
        continue;
      }
      const node = parseStatement(ln);
      if (node) nodes.push(node);
    }
    return { nodes, endLine: lines[i - 1]?.no ?? startNo };
  }

  function parseChild(header: RawLine): { nodes: Node[]; endLine: number } {
    const next = lines[i];
    if (!next || next.indent <= header.indent) {
      err(header, 'Expected an indented block after this line');
      return { nodes: [], endLine: header.no };
    }
    depth++;
    const r = parseBlock(next.indent);
    depth--;
    return r;
  }

  /** The body of a `screen name:` block (or of an `each` inside it), one element per line. */
  function parseScreenBody(header: RawLine, def: ScreenDef, inEach: boolean, inLayout = false): ScreenNode[] {
    const first = lines[i];
    if (!first || first.indent <= header.indent) { err(header, 'Expected an indented block after this line'); return []; }
    const indent = first.indent, nodes: ScreenNode[] = [];
    /** The physical line of a multi-line element that holds `frag`, for a diagnostic. */
    const part = (l: RawLine, frag: string | null) => (l.parts && frag ? l.parts.find(p => p.text.includes(frag)) ?? l : l);
    const cond = (l: RawLine, e: string | null) => (e === null ? null : exprOf(part(l, e), e));
    while (i < lines.length && lines[i].indent >= indent) {
      let l = lines[i++];
      if (l.indent > indent) { // reported once for the whole run of lines indented too far
        err(l, 'Unexpected indentation');
        while (i < lines.length && lines[i].indent > indent) i++;
        continue;
      }
      // indented lines that start with a clause word (on, if, enabled, ...) continue this element's line
      const conts: RawLine[] = [];
      while (i < lines.length && lines[i].indent > l.indent && startsWithClause(lines[i].text)) {
        const c = lines[i++];
        if (conts.length && c.indent !== conts[0].indent) err(c, 'The continuation lines of one element must be indented the same');
        else conts.push(c);
      }
      if (conts.length && /:[ \t]*$/.test(l.text)) err(l, 'An element written over several lines ends with ":" on its last line (the one that owns child elements), not on the first');
      if (conts.length) l = { ...l, text: [l, ...conts].map(p => p.text).join(' '), parts: [l, ...conts] };
      try {
        const word = /^[^\s:]+/.exec(l.text)?.[0] ?? '';
        if (startsWithClause(l.text)) throw new ElementSyntaxError(`"${word}" continues the element line above it: indent it deeper than that element, before any child lines`);
        if (l.parts && ['default', 'cancel', 'state', 'textbox'].includes(word)) { err(l.parts[1], `"${word}" is a single line: it takes no continuation lines`); continue; }
        if (word === 'default' || word === 'cancel') {
          if (inEach || inLayout) throw new ElementSyntaxError(`"${word}" belongs directly in the screen, not inside each, row, column or grid`);
          if (word === 'cancel') {
            if (l.text !== 'cancel' && l.text !== 'cancel keep') throw new ElementSyntaxError('Use: cancel  (Esc answers "" and discards the inout changes)  or  cancel keep  (Esc answers "" and keeps them)');
            def.cancel = true;
            if (l.text === 'cancel keep') def.cancelKeep = true;
          } else if (!/^default[ \t]+[A-Za-z_]\w*$/.test(l.text)) throw new ElementSyntaxError('Use: default <element id>');
          else def.default = l.text.split(/\s+/)[1];
          continue;
        }
        if (word === 'state') {
          if (inEach || inLayout || !RE_SCREEN.test(header.text)) throw new ElementSyntaxError('"state" belongs directly in the screen, not inside each, row, column, grid or an element');
          const m = /^state[ \t]+([A-Za-z_]\w*)[ \t]*=(?!=)[ \t]*(\S.*)$/.exec(l.text);
          if (!m) throw new ElementSyntaxError('Use: state <name> = <value or expression>');
          if (RESERVED_WORDS.includes(m[1])) throw new ElementSyntaxError(`"${m[1]}" is not a valid state name`);
          if (def.params?.includes(m[1])) throw new ElementSyntaxError(`"${m[1]}" is already a parameter of this screen`);
          if (def.states?.some(d => d.name === m[1])) throw new ElementSyntaxError(`state ${m[1]} is declared twice`);
          const e = exprOf(l, m[2]);
          if (e && usesRandom(e)) throw new ElementSyntaxError('A state cannot use random(): a screen redraws and replays, and would draw again');
          if (e) (def.states ??= []).push({ name: m[1], expr: e, src: src(l) });
          continue;
        }
        if (word === 'textbox') {
          if (inEach || inLayout) throw new ElementSyntaxError('"textbox" belongs directly in the screen, not inside each, row, column or grid');
          const m = /^textbox[ \t]+(on|off)[ \t]*(?:#.*)?$/.exec(l.text);
          if (!m) throw new ElementSyntaxError('Use: textbox off  (hide the text box while the screen is up) or textbox on (the default)');
          if (m[1] === 'off') def.hideBox = true; else delete def.hideBox;
          continue;
        }
        if (word === 'each') {
          const h = parseEachHeader(l.text.replace(/[ \t]*:$/, ''));
          if (!h) continue;
          const body = parseScreenBody(l, def, true, inLayout);
          nodes.push({ kind: 'each', list: h.list, as: h.as, x: h.x, y: h.y, dx: h.dx, dy: h.dy, limit: h.limit, body, src: src(l), cond: cond(l, h.cond), ...(h.anim ? { anim: h.anim } : {}) });
          continue;
        }
        if (word === 'scroll') {
          const h = parseScrollHeader(l.text.replace(/[ \t]*:$/, ''));
          if (!h) continue;
          const body = parseScreenBody(l, def, inEach, inLayout);
          nodes.push({ kind: 'scroll', x: h.x, y: h.y, w: h.w, h: h.h, start: h.start, bar: h.bar, body, src: src(l), cond: cond(l, h.cond), ...(h.anim ? { anim: h.anim } : {}) });
          continue;
        }
        if (word === 'row' || word === 'column' || word === 'grid') {
          const h = parseLayoutHeader(l.text.replace(/[ \t]*:$/, ''), inLayout);
          if (!h) continue;
          const body = parseScreenBody(l, def, inEach, true);
          nodes.push({ kind: 'layout', type: h.type, columns: h.columns, at: h.at, anchor: h.anchor, ...(h.anchorVar ? { anchorVar: h.anchorVar } : {}), margin: h.margin, padding: h.padding, gap: h.gap, align: h.align, cell: h.cell, ...(h.width ? { width: h.width } : {}), ...(h.height ? { height: h.height } : {}), body, src: src(l), cond: cond(l, h.cond), ...(h.anim ? { anim: h.anim } : {}) });
          continue;
        }
        if (word === 'panel') {
          const h = parsePanelHeader(l.text.replace(/[ \t]*:$/, ''), inLayout, stage);
          if (!h) continue;
          // a panel's children sit inside it, so `at` is relative to it; a bare frame (no colon) has none
          const body = /:[ \t]*$/.test(l.text) ? parseScreenBody(l, def, inEach, false) : [];
          nodes.push({ kind: 'panel', x: h.x, y: h.y, w: h.w, h: h.h, file: h.file, slice: h.slice, edge: h.edge, padding: h.padding, ...(h.color ? { color: h.color } : {}), body, src: src(l), cond: cond(l, h.cond), ...(h.anim ? { anim: h.anim } : {}) });
          continue;
        }
        // a hotspot or button ending in `:` owns the indented lines below it, placed in stage coordinates like its siblings
        const owns = (word === 'hotspot' || word === 'button') && /:[ \t]*$/.test(l.text);
        const p = parseElementLine(owns ? l.text.replace(/[ \t]*:[ \t]*$/, '') : l.text, inLayout, stage);
        if (p.el.kind === 'bar') {
          const { value, min, max, ...rest } = p.el;
          const [v, lo, hi] = [exprOf(part(l, value), value), exprOf(part(l, min), min), exprOf(part(l, max), max)];
          if (v && lo && hi) nodes.push({ ...rest, value: v, min: lo, max: hi, src: src(l), cond: cond(l, p.cond), ...(p.anim ? { anim: p.anim } : {}) });
          continue;
        }
        const node = { ...p.el, src: src(l), cond: cond(l, p.cond), ...(p.anim ? { anim: p.anim } : {}) } as ScreenNode;
        if (node.kind === 'hotspot' || node.kind === 'button') {
          node.enabled = cond(l, p.enabled);
          const at = (name: string, message: string) => Object.assign(new ElementSyntaxError(message), { line: part(l, `set ${name}`) });
          const declared = (name: string) => {
            if (def.params?.includes(name) && !def.inout?.includes(name)) throw at(name, `${name} is a read-only parameter: declare it  inout ${name}  to change it here`);
            if (!def.states?.some(d => d.name === name) && !def.inout?.includes(name)) throw at(name, `${name} is not a state of this screen: declare it above with  state ${name} = ...  (or as an inout parameter)`);
          };
          const sets: LocalSets = {};
          for (const [event, h] of Object.entries(p.sets)) {
            declared(h.name);
            const e = exprOf(part(l, h.expr), h.expr);
            if (e && usesRandom(e)) throw new ElementSyntaxError('on ... set cannot use random(): it is worked out whenever the screen redraws');
            if (e) sets[event as keyof LocalSets] = { name: h.name, expr: e };
          }
          if (Object.keys(sets).length) node.sets = sets;
          if (p.bind && node.kind === 'button') { declared(p.bind.name); node.bind = p.bind; }
          if (owns) node.body = parseScreenBody(l, def, inEach, false);
        }
        nodes.push(node);
      } catch (e) {
        err((e as { line?: RawLine }).line ?? (e instanceof ElementSyntaxError ? failLine(l, inLayout) : l), e instanceof ElementSyntaxError || e instanceof ParseError ? e.message : String(e));
        while (i < lines.length && lines[i].indent > l.indent) i++; // the body of a bad each
      }
    }
    return nodes;
  }

  /** The physical line of a multi-line element whose clause is the first to fail when the lines are read one more at a time. */
  function failLine(l: RawLine, inLayout: boolean): RawLine {
    if (!l.parts) return l;
    for (let k = 0; k < l.parts.length; k++) {
      const t = l.parts.slice(0, k + 1).map(p => p.text).join(' ').replace(/[ \t]*:[ \t]*$/, '');
      try {
        const word = /^[^\s:]+/.exec(t)?.[0] ?? '';
        if (word === 'each') parseEachHeader(t);
        else if (word === 'scroll') parseScrollHeader(t);
        else if (word === 'row' || word === 'column' || word === 'grid') parseLayoutHeader(t, inLayout);
        else if (word === 'panel') parsePanelHeader(t, inLayout, stage);
        else parseElementLine(t, inLayout, stage);
      } catch { return l.parts[k]; }
    }
    return l;
  }

  function parseScreen(ln: RawLine, name: string, paramText: string | undefined): ScreenDef {
    const written = (paramText ?? '').split(',').map(s => s.trim()).filter((s, idx, all) => s !== '' || all.length > 1);
    const inout: string[] = [];
    const params = written.map(s => { const m = /^inout[ \t]+(\S.*)$/.exec(s); if (m) inout.push(m[1].trim()); return m ? m[1].trim() : s; });
    for (const [idx, p] of params.entries()) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(p) || RESERVED_WORDS.includes(p)) err(ln, `"${p}" is not a valid parameter name (letters, digits and _)`);
      else if (params.indexOf(p) !== idx) err(ln, `Parameter "${p}" is listed twice`);
    }
    const def: ScreenDef = { name, src: src(ln), body: [], default: null, cancel: false, ...(params.length ? { params } : {}), ...(inout.length ? { inout } : {}) };
    def.body = parseScreenBody(ln, def, false);
    return def;
  }

  function parseStatement(ln: RawLine): Node | null {
    const t = ln.text;
    i++;
    let m: RegExpExecArray | null;

    if ((m = RE_LABEL.exec(t))) {
      if (depth > 0) err(ln, 'Labels must be at the top level');
      const params = (m[2] ?? '').split(',').map(s => s.trim()).filter((s, idx, all) => s !== '' || all.length > 1);
      for (const [idx, p] of params.entries()) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(p) || RESERVED_WORDS.includes(p)) err(ln, `"${p}" is not a valid parameter name (letters, digits and _)`);
        else if (params.indexOf(p) !== idx) err(ln, `Parameter "${p}" is listed twice`);
      }
      return { k: 'label', src: src(ln), name: m[1], params, body: parseChild(ln).nodes };
    }
    if ((m = RE_MENU.exec(t))) {
      const prompt = m[1] !== undefined ? unescapeText(m[1]) : null, promptId = m[2] ?? null;
      const first = lines[i];
      const options: Extract<Node, { k: 'menu' }>['options'] = [];
      if (!first || first.indent <= ln.indent) { err(ln, 'Expected options after "menu:"'); return null; }
      const optIndent = first.indent;
      const seconds = m[4] !== undefined ? exprOf(ln, m[4]) ?? { t: 'num', v: 0 } as Expr : null;
      let timeout: Extract<Node, { k: 'menu' }>['timeout'] = null, lateOptions = false;
      while (i < lines.length && lines[i].indent >= optIndent) {
        const ol = lines[i];
        if (ol.indent > optIndent) { // reported once for the whole run of lines indented too far
          err(ol, 'Unexpected indentation');
          while (i < lines.length && lines[i].indent > optIndent) i++;
          continue;
        }
        if (RE_ON_TIMEOUT.test(ol.text)) {
          i++;
          const child = parseChild(ol);
          if (timeout) err(ol, 'A menu has only one "on timeout:" block');
          else if (seconds === null) err(ol, '"on timeout:" needs the menu to have a clock: menu ... timeout <seconds>:');
          else timeout = { seconds, src: src(ol), to: child.endLine, body: child.nodes };
          continue;
        }
        const om = RE_OPT.exec(ol.text);
        i++;
        if (timeout && !lateOptions) { err(ol, '"on timeout:" must be the last block of the menu'); lateOptions = true; }
        if (!om) { err(ol, 'Menu options look like: "Option text":'); continue; }
        const cond = om[3] ? exprOf(ol, om[3]) : null;
        const child = parseChild(ol);
        options.push({ text: unescapeText(om[1]), id: om[2] ?? null, cond, reason: om[4] !== undefined ? unescapeText(om[4]) : null, reasonId: om[5] ?? null,
          src: src(ol), to: child.endLine, body: child.nodes });
      }
      if (seconds !== null && !timeout && !lateOptions) err(ln, 'A menu with "timeout" needs an "on timeout:" block (the story says what happens when time runs out)');
      return { k: 'menu', src: src(ln), prompt, promptId, look: m[3] ?? null, options, timeout };
    }
    if (RE_ON_TIMEOUT.test(t)) { err(ln, '"on timeout:" only belongs inside a "menu ... timeout <seconds>:" block'); return null; }
    if ((m = RE_IF.exec(t))) {
      const branches: Extract<Node, { k: 'if' }>['branches'] = [];
      const cond = exprOf(ln, m[1]);
      branches.push({ cond: cond ?? { t: 'bool', v: false }, src: src(ln), body: parseChild(ln).nodes });
      for (;;) {
        const nx = lines[i];
        if (!nx || nx.indent !== ln.indent) break;
        let em: RegExpExecArray | null;
        if ((em = RE_ELIF.exec(nx.text))) {
          i++;
          const c = exprOf(nx, em[1]);
          branches.push({ cond: c ?? { t: 'bool', v: false }, src: src(nx), body: parseChild(nx).nodes });
        } else if (RE_ELSE.test(nx.text)) {
          i++;
          branches.push({ cond: null, src: src(nx), body: parseChild(nx).nodes });
          break;
        } else break;
      }
      return { k: 'if', src: src(ln), branches };
    }
    if (RE_ELIF.test(t) || RE_ELSE.test(t)) { err(ln, 'This "elif/else" has no matching "if"'); return null; }
    if (RE_OPT.test(t)) { err(ln, 'Options only belong inside a "menu:" block'); return null; }

    if ((m = RE_NARR.exec(t))) {
      // indented lines that are a bare quoted string continue the narration: each starts a new line of the text
      let text = unescapeText(m[1]);
      while (i < lines.length && lines[i].indent > ln.indent) {
        const c = RE_NARR.exec(lines[i].text);
        if (!c) break;
        if (c[2] || c[3]) err(lines[i], 'Put style= and the #id on the first line of narration written over several lines');
        text += `\n${unescapeText(c[1])}`;
        i++;
      }
      return { k: 'op', src: src(ln), body: { op: 'say', who: null, text, id: m[3] ?? null, ...(m[2] ? { look: m[2] } : {}) } };
    }
    if ((m = RE_SAY.exec(t))) {
      return { k: 'op', src: src(ln), body: { op: 'say', who: m[1], text: unescapeText(m[2]), id: m[4] ?? null, ...(m[3] ? { look: m[3] } : {}) } };
    }
    if ((m = RE_SET.exec(t))) {
      const e = exprOf(ln, m[3]);
      if (!e) return null;
      return { k: 'op', src: src(ln), body: { op: 'set', name: m[1], assign: m[2] as '=', expr: e } };
    }
    if ((m = RE_SCREEN.exec(t))) {
      if (depth > 0) err(ln, 'Screens must be at the top level');
      screens.push(parseScreen(ln, m[1], m[2]));
      return null;
    }
    if (RE_DEFINE_ITEM.test(t)) {
      const a = tokenizeArgs(t).slice(2);
      const hasName = /^"/.test(t.slice(t.indexOf(a[0], 11) + a[0].length).trimStart());
      const item: ItemDef = { id: a[0], name: hasName ? a[1] : a[0], nameId: null, image: null, src: src(ln) };
      if (!hasName) warn(ln, `Item ${a[0]} has no display name: use define item ${a[0]} "Name"`);
      for (const tok of a.slice(hasName ? 2 : 1)) {
        if (/^#[A-Za-z0-9]{4,8}$/.test(tok)) item.nameId = tok.slice(1);
        else if (tok.startsWith('image=') && tok.length > 6) item.image = tok.slice(6);
        else warn(ln, `Unknown define item option "${tok}" (use image=<file>)`);
      }
      items.push(item);
      return null;
    }
    if (t.startsWith('define ') || t === 'define') {
      const a = tokenizeArgs(t).slice(1);
      if (!a[0] || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(a[0])) { err(ln, 'Use: define <id> "Display name" color=#rrggbb'); return null; }
      const hasName = a[1] !== undefined && /^"/.test(t.slice(t.indexOf(a[0]) + a[0].length).trimStart());
      const name = hasName ? a[1] : a[0];
      const def: CharacterDef = { id: a[0], name, color: null, style: {}, src: src(ln) };
      for (const attr of a.slice(hasName ? 2 : 1)) {
        const problem = defineAttr(def, attr);
        if (problem) warn(ln, problem);
      }
      characters.push(def);
      return null;
    }
    try {
      return { k: 'op', src: src(ln), body: parseCommand(t, positions, anchors, stage) };
    } catch (e) {
      if (e instanceof UnknownCommand) diags.push(withFix(src(ln), 'error', e.message, e.word, COMMAND_WORDS));
      else err(ln, e instanceof ParseError ? e.message : String(e));
      return null;
    }
  }

  const top = parseBlock(0);
  return { file, nodes: top.nodes, characters, items, screens };
}
