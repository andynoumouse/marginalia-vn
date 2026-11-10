import { ANCHORS, parseAnchor, type Anchor, type Anchors } from './anchor.js';
import { ANIM_NAMES, DEFAULT_EASE, easeProblem, isEaseSpec } from './anim.js';
import { parseCondition, type AutoDef } from './auto-anim.js';
import { parseTransformLine, type ChoreographyDef, type ChoreographyLine, type TransformDef, type TransformParam, type TransformRepeat, type TransformStep } from './transform.js';
import { BUILTIN_POSITIONS, type Position, type Positions } from './positions.js';
import { parseExpr, parseExprList, usesRandom, ExprError, type Expr } from './expr.js';
import { durationOf, isBareNumber, isDuration, readDuration, unitMessage } from './duration.js';
import { BURST_NAMES, FILTER_NAMES, WEATHER_NAMES, isBurstName, isFilterName, isWeatherName, type BurstName, type FilterName, type WeatherName } from './fx.js';
import type { LocalSets, ScreenDef, ScreenNode } from './screens.js';
import { DEFAULT_STAGE, stageLabel, type StageSize } from './stage.js';
import { withFix } from './suggest.js';
import { ElementSyntaxError, startsWithClause, parseEachHeader, parseElementLine, parseLayoutHeader, parsePanelHeader, parseScrollHeader } from './screen-syntax.js';
import { TRANSITIONS, UNRESOLVED, type CharacterDef, type Diagnostic, type ItemDef, type OpBody, type Src, type Transition, type VisualBody } from './types.js';

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
/** What each block opener looks like, for a line that starts with one but is not written right (see FileParser.slip). */
const OPENER_USAGE: Record<string, string> = {
  label: 'Use: label <name>:  or  label <name>(<parameters>):',
  menu: 'Use: menu:  or  menu "Prompt":  (with timeout 8s before the colon for a clock)',
  if: 'Use: if <condition>:',
  elif: 'Use: elif <condition>:',
  else: 'Use: else:',
  transform: 'Use: transform <name>:  or  transform <name>(<parameters>):',
  choreography: 'Use: choreography <name>:',
};
/** The line without a trailing `# comment`: a # with a space before and after it, outside quotes (`#ff6fa5` and `#ab12` are a colour and an id). */
function withoutComment(t: string): string {
  let quoted = false;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '\\') i++;
    else if (t[i] === '"') quoted = !quoted;
    else if (t[i] === '#' && !quoted && i > 0 && /\s/.test(t[i - 1]) && (i + 1 === t.length || /\s/.test(t[i + 1]))) return t.slice(0, i).trimEnd();
  }
  return t;
}
// `menu ["Prompt" [#id]] [timeout <seconds>]:`
export const RE_MENU = /^menu(?:[ \t]+"((?:[^"\\]|\\.)+)"(?:[ \t]+#([A-Za-z0-9]{4,8}))?)?(?:[ \t]+style=(\w+))?(?:[ \t]+timeout[ \t]+(.+?))?[ \t]*:$/;
const RE_ON_TIMEOUT = /^on[ \t]+timeout[ \t]*:$/;
const RE_TRANSFORM = /^transform[ \t]+([A-Za-z_][A-Za-z0-9_]*)[ \t]*(?:\(([^()]*)\))?(?:[ \t]+((?:every|while)\b.*?))?[ \t]*:$/;
const RE_CHOREO = /^choreography[ \t]+([A-Za-z_][A-Za-z0-9_]*)[ \t]*:$/;
const RE_CHOREO_LINE = /^((?:\d+(?:\.\d+)?|\.\d+)(?:ms|s)?)[ \t]+([A-Za-z_][A-Za-z0-9_]*)[ \t]*:[ \t]*(\S.*)$/;
const RE_TRANSFORM_AUTO = /^(?:every[ \t]+((?:\d+(?:\.\d+)?|\.\d+)(?:ms|s)?)(?:\.\.((?:\d+(?:\.\d+)?|\.\d+)(?:ms|s)?))?)?(?:[ \t]*while[ \t]+(.+))?$/;
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

export interface ParsedFile { file: string; nodes: Node[]; characters: CharacterDef[]; items: ItemDef[]; screens: ScreenDef[]; transforms: TransformDef[]; choreographies: ChoreographyDef[] }

class ParseError extends Error {}
/** The first word of a line is not a command; `word` gets "did you mean" fixes from COMMAND_WORDS. */
class UnknownCommand extends ParseError {
  word: string;
  constructor(cmd: string) { super(`Unknown command "${cmd}"`); this.word = cmd.replace(/:$/, ''); } // `mnue:` is `menu:` mistyped
}
/** Every word a statement can start with (for "did you mean" on an unknown one). */
export const COMMAND_WORDS = ['label', 'menu', 'if', 'elif', 'else', 'set', 'define', 'transform', 'choreography', 'screen', 'scene', 'show', 'hide', 'move', 'shake',
  'animate', 'hop', 'perform', 'burst', 'flash', 'tint', 'focus', 'behaviors', 'camera', 'weather', 'wind', 'gravity', 'filter', 'hud', 'image', 'music', 'sound', 'movie', 'wait', 'call', 'jump', 'nvl',
  'textbox', 'unlock', 'input', 'return', 'end'] as const;
export type CommandWord = (typeof COMMAND_WORDS)[number];
/** `parts`: the physical lines of a screen element written over several (this line first, then its clause continuations); `text` is then all of them joined. */
interface RawLine { no: number; indent: number; text: string; parts?: RawLine[] }

export function unescapeText(s: string): string {
  return s.replace(/\\(["\\n])/g, (_, c: string) => (c === 'n' ? '\n' : c));
}

const COLOR = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
export const DEFINE_ATTRS = ['color=', 'text=', 'font=', 'size=', 'italic', 'speed=', 'blip=', 'style=','focus=off', 'side='];

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
    case 'style': if (!/^\w+$/.test(val)) return 'style= needs a style name'; def.style.box = val; return null;
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

/** The names of a `pose=a,b` token. */
function poseNames(t: string): string[] {
  const names = t.slice(5).split(',');
  if (!names.every(n => /^[A-Za-z_]\w*$/.test(n))) throw new ParseError('pose= takes a pose name, or names separated by commas');
  return names;
}

function num(tok: string | undefined, what: string): number {
  const n = Number(tok);
  if (tok === undefined || tok === '' || !Number.isFinite(n)) throw new ParseError(`Expected a number for ${what}`);
  return n;
}
/** A duration with its unit (`0.5s`, `500ms`) in seconds; a bare number there says to add the unit. */
const durArg = (tok: string | undefined, what = 'a duration') => readDuration(tok, what, m => new ParseError(m));
/** A token in a run of optional trailing arguments that is a bare number: in a duration's place it is an error (it lacks its unit). */
const bareDur = (tok: string | undefined) => { if (isBareNumber(tok)) throw new ParseError(unitMessage(tok!)); };
/** An optional duration argument: null when absent, its seconds when it has its unit, the unit message for a bare number, else `usage`. */
const optDur = (tok: string | undefined, usage: string): number | null => {
  if (tok === undefined) return null;
  bareDur(tok);
  const d = durationOf(tok);
  if (d === null) throw new ParseError(usage);
  return d;
};
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

/** One command line being parsed: its words after the command (`a`, without `nowait`) and the helpers that read them. */
class Cmd {
  readonly cmd: string;
  a: string[];
  nowait = false;
  constructor(readonly text: string, readonly positions: Positions, readonly anchors: Anchors, readonly stage: StageSize) {
    const toks = tokenizeArgs(text);
    this.cmd = toks[0];
    this.a = toks.slice(1);
    if (this.a.includes('nowait')) { this.nowait = true; this.a = this.a.filter(t => t !== 'nowait'); }
  }
  visual = <T extends VisualBody>(b: T): OpBody => (this.nowait ? { ...b, nowait: true } : b);
  need = (i: number, what: string) => { if (this.a[i] === undefined) throw new ParseError(`"${this.cmd}" needs ${what}`); return this.a[i]; };
  /** The command takes `n` arguments (and nowait): anything after them is a mistake, not something to ignore. */
  extra = (n: number, hint = '') => { if (this.a.length > n) throw new ParseError(`Unexpected "${this.a[n]}" in ${this.cmd}${hint ? ` (${hint})` : ''}`); };
  /** `<cmd> <name> [level 0-1] [duration]`: the level (a bare number) and the duration (with its unit), either one optional. */
  parseLevel = (usage: string, what: string, dflt: number) => {
    const rest = this.a.slice(1);
    let i = 0;
    const level = isNum(rest[0]) ? Number(rest[i++]) : dflt;
    if (level < 0 || level > 1) throw new ParseError(`${what} is 0 to 1`);
    const d = optDur(rest[i], usage);
    if (d !== null) i++;
    if (rest.length > i) throw new ParseError(isBareNumber(rest[i]) ? unitMessage(rest[i]) : usage);
    return { level, dur: d ?? 0 };
  };
  /** `<cmd> off [duration]`. */
  offDur = (usage: string) => { if (this.a.length > 2) throw new ParseError(usage); return optDur(this.a[1], usage) ?? 0; };
  /** `<cmd> on` or `<cmd> off`. */
  parseOnOff = () => {
    if ((this.a[0] !== 'on' && this.a[0] !== 'off') || this.a.length > 1) throw new ParseError(`Use: ${this.cmd} on  |  ${this.cmd} off`);
    return this.a[0] === 'on';
  };
}

function parseSceneCommand(c: Cmd): OpBody {
  const { need, extra, visual } = c;
  let a = c.a;
  const bg = need(0, 'a background name');
  let mask: string | null = null;
  const maskTok = a.find(t => t.startsWith('mask='));
  if (maskTok) {
    mask = maskTok.slice(5);
    if (!mask) throw new ParseError('mask= needs the name of an image in assets/transitions');
    a = c.a = a.filter(t => t !== maskTok);
  }
  let i = 1, dir: string | null = null;
  let transition = (mask ? 'dissolve' : 'cut') as Transition;
  if (TRANSITIONS.includes(a[i] as Transition)) transition = a[i++] as Transition;
  if (mask && transition !== 'dissolve') throw new ParseError(`mask= works with dissolve, not ${transition}`);
  if (transition === 'wipe') dir = !isNum(a[i]) && !isDuration(a[i]) && a[i] !== undefined ? a[i++] : 'left';
  bareDur(a[i]);
  const d = durationOf(a[i]);
  if (d !== null) i++;
  extra(i, `transitions: ${TRANSITIONS.join(', ')}`);
  const dur = d ?? (transition === 'cut' ? 0 : 0.5);
  return visual({ op: 'scene', bg, transition, dir, mask, dur });
}

function parseShowCommand(c: Cmd): OpBody {
  const { need, visual, text, positions, anchors } = c;
  const a = c.a;
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
  const poses: string[] = []; // pose=a,b: rig.json poses, laid over each other
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
    else if (t === 'fade') { fade = durArg(a[i + 1], 'a fade duration'); i += 2; }
    else if (t.startsWith('y=')) { place.y = num(t.slice(2), 'y'); i++; }
    else if (t.startsWith('scale=')) { place.scale = num(t.slice(6), 'scale'); i++; }
    else if (t.startsWith('flip=')) {
      const v = t.slice(5);
      if (v !== 'on' && v !== 'off') throw new ParseError('flip= takes on or off');
      place.flip = v === 'on'; i++;
    }
    else if (t.startsWith('anchor=')) { place.anchor = anchorArg(t, anchors); i++; }
    else if (t.startsWith('pose=')) { poses.push(...poseNames(t)); i++; }
    else if (t.includes('=')) { const [k, v] = t.split('='); overrides[k] = v; i++; }
    else if (pose === null) { pose = t; i++; }
    else { more.push(t); i++; }
  }
  if (place.y === undefined && posY !== undefined) place.y = posY;
  if (place.order && place.behind) throw new ParseError('Use either order= or behind=, not both');
  return visual({ op: 'show', char, pose, more, overrides, x, fade, ...place, ...(poses.length ? { poses } : {}) });
}

function parseHideCommand(c: Cmd): OpBody {
  const { need, extra, visual } = c;
  const a = c.a;
  const char = need(0, 'a character');
  const fade = a[1] === 'fade' ? durArg(a[2], 'a fade duration') : 0;
  extra(a[1] === 'fade' ? 3 : 1, 'use: hide <char> [fade <duration>]');
  return visual({ op: 'hide', char, fade });
}

function parseMoveCommand(c: Cmd): OpBody {
  const { need, visual, positions, anchors } = c;
  const a = c.a;
  const char = need(0, 'a character');
  const usage = 'Use: move <char> [to <position>] [y=] [scale=] [rot=] [alpha=] [tint=<#rrggbb|none>] [flip=on|off] [anchor=] [duration like 0.5s] [ease=]';
  let x: number | null = null, dur = 0, ease = DEFAULT_EASE, tint: string | null | undefined;
  const props: Record<string, number> = {};
  let flip: boolean | null = null, anchor: Anchor | null = null, posY: number | undefined;
  for (let i = 1; i < a.length;) {
    const t = a[i];
    if (t === 'to') { const p = parsePos(a[i + 1], positions); x = p.x; posY = p.y; i += 2; }
    else if (t.startsWith('ease=')) {
      ease = t.slice(5);
      if (!isEaseSpec(ease)) throw new ParseError(easeProblem(ease));
      i++;
    }
    else if (t.startsWith('flip=')) {
      const v = t.slice(5);
      if (v !== 'on' && v !== 'off') throw new ParseError('flip= takes on or off');
      flip = v === 'on'; i++;
    }
    else if (t.startsWith('anchor=')) { anchor = anchorArg(t, anchors); i++; }
    else if (t.startsWith('tint=')) { tint = tintArg(t); i++; }
    else if (t.includes('=')) {
      const [k, v] = t.split('=');
      if (!['y', 'scale', 'rot', 'alpha'].includes(k)) throw new ParseError(`Unknown property "${k}" in move`);
      props[k] = num(v, k); i++;
    }
    else if (isDuration(t)) { dur = durationOf(t)!; i++; }
    else { bareDur(t); throw new ParseError(usage); }
  }
  if (x === null && flip === null && anchor === null && tint === undefined && Object.keys(props).length === 0) throw new ParseError(usage);
  return visual({ op: 'move', char, x, y: props.y ?? posY ?? null, scale: props.scale ?? null, rotation: props.rot ?? null, alpha: props.alpha ?? null, flip, anchor, ...(tint !== undefined ? { tint } : {}), dur, ease });
}

/** `tint=#rrggbb` (a color to multiply by) or `tint=none` (back to the art's own colors, null). */
function tintArg(t: string): string | null {
  const v = t.slice(5);
  if (v === 'none') return null;
  if (!COLOR.test(v)) throw new ParseError('tint= takes a color like #ff8080, or none');
  return v;
}

function parseShakeCommand(c: Cmd): OpBody {
  const { need, visual } = c;
  // `shake 0.4s` (a duration first) shakes the screen, as `shake screen 0.4s` does; a bare number there is a missing unit, not a name.
  bareDur(c.a[0]);
  const a = isDuration(c.a[0]) ? ['screen', ...c.a] : c.a;
  const target = a === c.a ? need(0, 'a character or "screen"') : 'screen';
  let dur = 0.3, strength = 8, gotDur = false;
  for (const t of a.slice(1)) {
    if (t.startsWith('strength=')) strength = num(t.slice(9), 'strength');
    else if (isDuration(t) && !gotDur) { dur = durationOf(t)!; gotDur = true; }
    else {
      if (!gotDur) bareDur(t);
      throw new ParseError(t === 'loop'
        ? 'shake is a single shake and has no loop: use animate <char> shake loop for a continuous one'
        : 'Use: shake <char|screen> [duration like 0.3s] [strength=8]');
    }
  }
  return visual({ op: 'shake', target, dur, strength });
}

function parseAnimateCommand(c: Cmd): OpBody {
  const { need, visual } = c;
  const a = c.a;
  const char = need(0, 'a character');
  let name = need(1, `an animation (${ANIM_NAMES.join(', ')}), pose=<name>, a parameter=value, or stop`);
  let argsAt = 2, args: Expr[] | undefined; // `animate alice nervous(2, trust)`: a transform's arguments
  const open = name.indexOf('(');
  if (open > 0 && !name.includes('=')) {
    let text = name;
    while ((text.match(/\(/g) ?? []).length > (text.match(/\)/g) ?? []).length && argsAt < a.length) text += ' ' + a[argsAt++];
    const close = text.lastIndexOf(')');
    if (close !== text.length - 1 || (text.match(/\(/g) ?? []).length !== (text.match(/\)/g) ?? []).length) throw new ParseError('Use: animate <char> name(arguments) [duration] [loop] [strength=1]');
    try { args = parseExprList(text.slice(open + 1, close)); } catch (e) { throw new ParseError(e instanceof ExprError ? e.message : String(e)); }
    name = text.slice(0, open);
  }
  if (name.includes('=')) { // animate <char> pose=<name> / <param>=<value> ... [over <seconds>] [ease=<name>]
    const usage = 'Use: animate <char> [pose=<name>[,<name>]] [<parameter>=<value> ...] [over <duration>] [ease=<name>]';
    const poses: string[] = [], params: Record<string, number> = {};
    let dur = 0, ease: string | null = null;
    for (let i = 1; i < a.length;) {
      const t = a[i];
      if (t === 'over') { dur = durArg(a[i + 1], 'a duration after over'); i += 2; }
      else if (t.startsWith('pose=')) { poses.push(...poseNames(t)); i++; }
      else if (t.startsWith('ease=')) {
        ease = t.slice(5);
        if (!isEaseSpec(ease)) throw new ParseError(easeProblem(ease));
        i++;
      } else if (t.includes('=')) {
        const [k, v] = t.split('=');
        if (!/^[A-Za-z_]\w*$/.test(k)) throw new ParseError(`"${k}" is not a parameter name`);
        params[k] = num(v, k); i++;
      } else throw new ParseError(usage);
    }
    if (!poses.length && !Object.keys(params).length) throw new ParseError(usage);
    return visual({ op: 'param', char, poses, params, dur, ease });
  }
  if (name === 'stop') return visual({ op: 'animate', char, name: null, dur: null, loop: false, strength: 1, part: null });
  if (!/^[A-Za-z_]\w*$/.test(name)) throw new ParseError(`"${name}" is not an animation name (presets: ${ANIM_NAMES.join(', ')}; a character's rig.json can add more)`);
  let dur: number | null = null, loop = false, strength = 1, part: string | null = null, auto: 'on' | 'off' | undefined;
  for (const t of a.slice(argsAt)) {
    if (t === 'loop') loop = true;
    else if (t === 'auto' && !auto) auto = 'on';
    else if (t === 'off' && auto === 'on') auto = 'off';
    else if (t.startsWith('strength=')) strength = num(t.slice(9), 'strength');
    else if (t.startsWith('part=') && t.length > 5) part = t.slice(5);
    else if (isDuration(t) && durationOf(t)! > 0) dur = durationOf(t)!;
    else { bareDur(t); throw new ParseError('Use: animate <char> <name> [duration like 2s] [loop] [strength=1] [part=name], animate <char> <name> auto [off], or animate <char> stop'); }
  }
  if (auto && (loop || dur !== null || strength !== 1 || part !== null || args)) throw new ParseError('animate <target> <name> auto [off] attaches or detaches an automatic transform: it takes no duration, loop, strength, part or arguments');
  return visual({ op: 'animate', char, name, dur, loop, strength, part, ...(args ? { args } : {}), ...(auto ? { auto } : {}) });
}

function parseHopCommand(c: Cmd): OpBody {
  const { need, visual } = c;
  const a = c.a, usage = 'Use: hop <char> [duration like 0.25s]';
  const char = need(0, 'a character');
  if (a.length > 2) throw new ParseError(usage);
  return visual({ op: 'hop', char, dur: optDur(a[1], usage) ?? 0.25 });
}

function parsePerformCommand(c: Cmd): OpBody {
  const { need, extra, visual } = c;
  const name = need(0, 'a choreography');
  extra(1, 'Use: perform <choreography>');
  return visual({ op: 'perform', name });
}

function parseBurstCommand(c: Cmd): OpBody {
  const { visual, positions } = c;
  const a = c.a;
  const usage = `Use: burst <${BURST_NAMES.join('|')}> [at <character|position>] [y=0-1] [count=] [duration like 1s]`;
  if (!isBurstName(a[0] ?? '')) throw new ParseError(usage);
  let char: string | undefined, x: number | undefined, y: number | undefined, count: number | null = null, dur: number | null = null;
  for (let i = 1; i < a.length;) {
    const t = a[i];
    if (t === 'at' && a[i + 1] !== undefined) {
      const where = a[i + 1];
      if (Object.hasOwn(positions, where) || isNum(where)) x = parsePos(where, positions).x; else char = where; // not a position: a character, checked by compile
      i += 2;
    }
    else if (t.startsWith('y=')) { y = num(t.slice(2), 'y'); i++; }
    else if (t.startsWith('count=')) {
      count = num(t.slice(6), 'count');
      if (!Number.isInteger(count) || count < 1 || count > 500) throw new ParseError('count= is a whole number from 1 to 500');
      i++;
    }
    else if (isDuration(t) && dur === null && durationOf(t)! > 0) { dur = durationOf(t)!; i++; }
    else { bareDur(t); throw new ParseError(usage); }
  }
  if (char !== undefined && y !== undefined) throw new ParseError('y= places a burst at a point; at a character it comes from the character');
  return visual({ op: 'burst', kind: a[0] as BurstName, ...(char !== undefined ? { char } : {}), ...(x !== undefined ? { x } : {}), ...(y !== undefined ? { y } : {}), count, dur });
}

function parseFlashCommand(c: Cmd): OpBody {
  const { visual } = c;
  const a = c.a;
  // A first word that is neither a color nor a duration names the character or picture to flash instead of the screen.
  const char = a[0] !== undefined && !COLOR.test(a[0]) && !isNum(a[0]) && !isDuration(a[0]) ? a[0] : undefined;
  const args = char ? a.slice(1) : a;
  const color = args.find(t => COLOR.test(t)) ?? '#ffffff';
  const rest = args.filter(t => t !== color);
  const usage = 'Use: flash [<character or picture>] [#rrggbb] [duration like 0.4s]';
  if (rest.length > 1) throw new ParseError(usage);
  return visual({ op: 'flash', color, dur: optDur(rest[0], usage) ?? 0.4, ...(char ? { char } : {}) });
}

function parseTintCommand(c: Cmd): OpBody {
  const { need, parseLevel, offDur, visual } = c;
  const a = c.a;
  const usage = 'Use: tint <#rrggbb> [strength 0-1] [duration like 1s]  or  tint off [duration]';
  if (a[0] === 'off') return visual({ op: 'tint', color: null, strength: 0, dur: offDur(usage) });
  const color = need(0, 'a color like #203060, or "off"');
  if (!COLOR.test(color)) throw new ParseError(usage);
  const { level: strength, dur } = parseLevel(usage, 'Tint strength', 0.4);
  return visual({ op: 'tint', color, strength, dur });
}

function parseFocusCommand(c: Cmd): OpBody {
  const { parseOnOff, visual } = c;
  return visual({ op: 'focus', on: parseOnOff() });
}

function parseBehaviorsCommand(c: Cmd): OpBody {
  const { parseOnOff, visual } = c;
  return visual({ op: 'behaviors', on: parseOnOff() });
}

function parseCameraCommand(c: Cmd): OpBody {
  const { visual, positions } = c;
  const a = c.a;
  const easeArg = a.find(t => t.startsWith('ease=')), yArg = a.find(t => t.startsWith('y='));
  const rest = a.filter(t => !t.startsWith('ease=') && !t.startsWith('y='));
  const ease = easeArg ? easeArg.slice(5) : 'inout';
  if (!isEaseSpec(ease)) throw new ParseError(easeProblem(ease));
  const usage = 'Use: camera zoom <factor> [at <pos>] [y=0-1] [duration like 1s], camera pan <pos> [y=0-1] [duration], camera roll <degrees> [duration], or camera reset [duration]';
  /** The optional duration at `from`, and nothing after it. */
  const tail = (from: number) => { if (rest.length > from + 1) throw new ParseError(usage); return optDur(rest[from], usage) ?? 0; };
  if (rest[0] === 'reset') return visual({ op: 'camera', zoom: 1, x: 0.5, y: 0.5, roll: 0, dur: tail(1), ease });
  if (rest[0] === 'roll') {
    // Turns the view about the current pivot, keeping zoom and pan.
    if (yArg) throw new ParseError(usage);
    const roll = num(rest[1], 'roll angle');
    return visual({ op: 'camera', zoom: null, x: null, y: null, roll, dur: tail(2), ease });
  }
  if (rest[0] === 'pan') {
    // Moves the point the zoom is about, keeping the zoom: only visible while zoomed in.
    const x = parsePos(rest[1], positions).x;
    const y = yArg ? num(yArg.slice(2), 'y') : 0.5;
    return visual({ op: 'camera', zoom: null, x, y, dur: tail(2), ease });
  }
  if (rest[0] !== 'zoom') throw new ParseError(usage);
  const zoom = num(rest[1], 'zoom factor');
  if (zoom < 1) throw new ParseError('Zoom is 1 (normal) or more');
  let i = 2, x = 0.5;
  const y = yArg ? num(yArg.slice(2), 'y') : 0.5;
  if (rest[i] === 'at') { x = parsePos(rest[i + 1], positions).x; i += 2; }
  return visual({ op: 'camera', zoom, x, y, dur: tail(i), ease });
}

function parseWeatherCommand(c: Cmd): OpBody {
  const { parseLevel, offDur, visual } = c;
  const a = c.a;
  const usage = `Use: weather <${WEATHER_NAMES.join('|')}> [intensity 0-1] [duration like 2s], or weather off [duration]`;
  if (a[0] === 'off') return visual({ op: 'weather', kind: null, intensity: 0, dur: offDur(usage) });
  if (!isWeatherName(a[0] ?? '')) throw new ParseError(usage);
  const { level: intensity, dur } = parseLevel(usage, 'Weather intensity', 0.6);
  return visual({ op: 'weather', kind: a[0] as WeatherName, intensity, dur });
}

function parseWindCommand(c: Cmd): OpBody {
  const { offDur, visual } = c;
  const usage = 'Use: wind <right|left> [strength 0-2] [gusts=0-1] [duration like 2s], or wind off [duration]';
  const gustArg = c.a.find(t => t.startsWith('gusts='));
  const a = c.a.filter(t => t !== gustArg);
  if (a[0] === 'off') {
    if (gustArg) throw new ParseError(usage);
    return visual({ op: 'wind', strength: 0, gusts: 0, dur: offDur(usage) });
  }
  if (a[0] !== 'right' && a[0] !== 'left') throw new ParseError(usage);
  let i = 1;
  const level = isNum(a[i]) ? Number(a[i++]) : 0.5;
  if (level < 0 || level > 2) throw new ParseError('Wind strength is 0 to 2');
  const d = optDur(a[i], usage);
  if (d !== null) i++;
  if (a.length > i) throw new ParseError(isBareNumber(a[i]) ? unitMessage(a[i]) : usage);
  const gusts = gustArg ? Number(gustArg.slice(6)) : 0.4;
  if (!isNum(gustArg ? gustArg.slice(6) : '0') || gusts < 0 || gusts > 1) throw new ParseError('Wind gusts are 0 (steady) to 1 (fully gusting)');
  return visual({ op: 'wind', strength: a[0] === 'right' ? level : -level, gusts, dur: d ?? 0 });
}

function parseGravityCommand(c: Cmd): OpBody {
  const usage = 'Use: gravity <factor -3 to 3> (1 = normal, 0 = none, negative = things rise), or gravity reset';
  c.extra(1, usage);
  if (c.a[0] === 'reset') return c.visual({ op: 'gravity', factor: 1 });
  if (!isNum(c.a[0])) throw new ParseError(usage);
  const factor = Number(c.a[0]);
  if (factor < -3 || factor > 3) throw new ParseError('Gravity is -3 to 3');
  return c.visual({ op: 'gravity', factor });
}

function parseFilterCommand(c: Cmd): OpBody {
  const { parseLevel, offDur, visual } = c;
  const a = c.a;
  const usage = `Use: filter <${FILTER_NAMES.join('|')}> [strength 0-1] [duration like 1s], or filter off [duration]`;
  if (a[0] === 'off') return visual({ op: 'filter', name: null, strength: 0, dur: offDur(usage) });
  if (!isFilterName(a[0] ?? '')) throw new ParseError(usage);
  const { level: strength, dur } = parseLevel(usage, 'Filter strength', 1);
  return visual({ op: 'filter', name: a[0] as FilterName, strength, dur });
}

function parseHudCommand(c: Cmd): OpBody {
  const a = c.a;
  const word = /^[A-Za-z_]\w*$/;
  if ((a[0] !== 'on' && a[0] !== 'off') || !word.test(a[1] ?? '') || a.length > (a[0] === 'on' && a[2] === 'keep' ? 3 : 2)) throw new ParseError('Use: hud on <screen> [keep]  or  hud off <screen>');
  return { op: 'hud', mode: a[0], name: a[1], keep: a[2] === 'keep' };
}

function parseImageCommand(c: Cmd): OpBody {
  const { visual, anchors, stage } = c;
  const a = c.a;
  const usage = 'Use: image show <name> <file> [at x,y] [scale=] [rot=] [alpha=] [anchor=] [tint=] [layer=] [parallax=] [fixed] [keep] [fade <duration>], image move <name> [to x,y] [scale=] [rot=] [alpha=] [anchor=] [tint=] [duration like 0.5s] [ease=], or image hide <name> [fade <duration>]';
  const verb = a[0], name = a[1];
  if (!name || !/^[A-Za-z_]\w*$/.test(name)) throw new ParseError(usage);
  const xy = (tok: string | undefined) => {
    const m = /^(-?\d*\.?\d+),(-?\d*\.?\d+)$/.exec(tok ?? '');
    if (!m) throw new ParseError('A position is stage pixels like 960,540 (the stage is ' + stageLabel(stage) + ')');
    return { x: Number(m[1]), y: Number(m[2]) };
  };
  if (verb === 'hide') {
    if (a.length > 2 && (a[2] !== 'fade' || a.length > 4)) throw new ParseError(usage);
    return visual({ op: 'image', action: 'hide', name, fade: a[2] ? durArg(a[3], 'a fade duration') : 0 });
  }
  if (verb !== 'show' && verb !== 'move') throw new ParseError(usage);
  const props: Record<string, number> = {};
  let pos: { x: number; y: number } | null = null, anchor: Anchor | null = null, dur = 0, fade = 0, ease = DEFAULT_EASE;
  let layer: number | undefined, fixed = false, keep = false, parallax: number | undefined, file: string | null = null, tint: string | null | undefined;
  for (let i = 2; i < a.length;) {
    const t = a[i];
    if (t === (verb === 'show' ? 'at' : 'to')) { pos = xy(a[i + 1]); i += 2; }
    else if (verb === 'show' && t === 'fade') { fade = durArg(a[i + 1], 'a fade duration'); i += 2; }
    else if (verb === 'show' && t === 'fixed') { fixed = true; i++; }
    else if (verb === 'show' && t === 'keep') { keep = true; i++; }
    else if (verb === 'show' && t.startsWith('parallax=')) {
      parallax = num(t.slice(9), 'parallax');
      if (parallax < 0) throw new ParseError('parallax= is 0 (stays on the screen) to 1 (moves with the camera), or more for a nearer picture');
      i++;
    }
    else if (verb === 'show' && t.startsWith('layer=')) {
      layer = num(t.slice(6), 'layer');
      if (!Number.isInteger(layer)) throw new ParseError('layer= is a whole number (below 0 draws behind the characters)');
      i++;
    }
    else if (verb === 'move' && t.startsWith('ease=')) {
      ease = t.slice(5);
      if (!isEaseSpec(ease)) throw new ParseError(easeProblem(ease));
      i++;
    }
    else if (t.startsWith('anchor=')) { anchor = anchorArg(t, anchors); i++; }
    else if (t.startsWith('tint=')) { tint = tintArg(t); i++; }
    else if (t.includes('=')) {
      const [k, v] = t.split('=');
      if (!['scale', 'rot', 'alpha'].includes(k)) throw new ParseError(`Unknown property "${k}" in image ${verb}`);
      props[k] = num(v, k); i++;
    }
    else if (verb === 'move' && isDuration(t)) { dur = durationOf(t)!; i++; }
    else if (verb === 'show' && file === null) { file = t; i++; }
    else { if (verb === 'move') bareDur(t); throw new ParseError(`Unexpected "${t}" in image ${verb}`); }
  }
  if (props.scale !== undefined && props.scale <= 0) throw new ParseError('scale= must be above 0');
  if (props.alpha !== undefined && (props.alpha < 0 || props.alpha > 1)) throw new ParseError('alpha= is 0 to 1');
  if (verb === 'move') {
    if (!pos && !anchor && tint === undefined && Object.keys(props).length === 0) throw new ParseError(usage);
    return visual({ op: 'image', action: 'move', name, x: pos?.x ?? null, y: pos?.y ?? null, scale: props.scale ?? null, rotation: props.rot ?? null, alpha: props.alpha ?? null, anchor, ...(tint !== undefined ? { tint } : {}), dur, ease });
  }
  if (file === null) throw new ParseError(usage);
  return visual({
    op: 'image', action: 'show', name, file, fade,
    ...(pos ? { x: pos.x, y: pos.y } : {}), ...(props.scale !== undefined ? { scale: props.scale } : {}),
    ...(props.rot !== undefined ? { rotation: props.rot } : {}), ...(props.alpha !== undefined ? { alpha: props.alpha } : {}),
    ...(anchor ? { anchor } : {}), ...(layer !== undefined ? { layer } : {}), ...(fixed ? { fixed } : {}), ...(keep ? { keep } : {}),
    ...(parallax !== undefined ? { parallax } : {}),
    ...(typeof tint === 'string' ? { tint } : {}),
  });
}

function parseMusicCommand(c: Cmd): OpBody {
  const { need, visual } = c;
  const a = c.a;
  const action = need(0, '"play", "stop", "pause" or "resume"');
  if (action !== 'play' && action !== 'stop' && action !== 'pause' && action !== 'resume') throw new ParseError('Use: music play <name> [loop] [fade 2s], music stop [fade 2s], music pause [fade 2s] or music resume [fade 2s]');
  const fi = a.indexOf('fade');
  const fade = fi >= 0 ? durArg(a[fi + 1], 'a fade duration') : 0;
  const rest = fi >= 0 ? [...a.slice(0, fi), ...a.slice(fi + 2)] : a;
  if (action !== 'play') {
    if (rest.length > 1) throw new ParseError(`Unexpected "${rest[1]}" in music ${action} (use: music ${action} [fade <duration>])`);
    return visual({ op: 'music', action, name: null, loop: false, fade });
  }
  const name = need(1, 'a track name');
  if (rest.length > 3 || (rest[2] !== undefined && rest[2] !== 'loop')) throw new ParseError(`Unexpected "${rest[2] === 'loop' ? rest[3] : rest[2]}" in music play (use: music play <name> [loop] [fade <duration>])`);
  return visual({ op: 'music', action, name, loop: rest[2] === 'loop', fade });
}

function parseSoundCommand(c: Cmd): OpBody {
  const { need, visual } = c;
  const a = c.a;
  const usage = 'Use: sound play <name> [duck], sound loop <name> [fade 1s] or sound stop [<name>] [fade 1s]';
  const action = need(0, '"play", "loop" or "stop"');
  if (action !== 'play' && action !== 'loop' && action !== 'stop') throw new ParseError(usage);
  const fi = a.indexOf('fade');
  const fade = fi >= 0 ? durArg(a[fi + 1], 'a fade duration') : 0;
  const rest = a.slice(1).filter((t, i) => !(fi >= 1 && (i + 1 === fi || i + 1 === fi + 1)));
  const duck = action === 'play' && rest.includes('duck');
  const names = rest.filter(t => t !== 'duck');
  if (names.length > 1 || (action === 'play' && fi >= 0) || (action !== 'play' && rest.includes('duck'))) throw new ParseError(usage);
  if (action === 'stop') return visual({ op: 'sound', action, name: names[0] ?? null, fade });
  if (!names[0]) throw new ParseError(usage);
  return visual({ op: 'sound', action, name: names[0], fade, ...(duck ? { duck } : {}) });
}

function parseMovieCommand(c: Cmd): OpBody {
  const { visual, nowait } = c;
  const a = c.a;
  const usage = 'Use: movie play <name> [noskip | loop]';
  if (nowait) throw new ParseError('A movie always plays to its end (or until the player skips it), so it has no nowait');
  const flags = a.slice(2);
  if (a[0] !== 'play' || !a[1] || flags.some((f, i) => (f !== 'noskip' && f !== 'loop') || flags.indexOf(f) !== i)) throw new ParseError(usage);
  const noskip = flags.includes('noskip'), loop = flags.includes('loop');
  if (noskip && loop) throw new ParseError('A looping movie only ends when the player skips it, so loop cannot be combined with noskip');
  return visual({ op: 'movie', name: a[1], noskip, loop });
}

function parseWaitCommand(c: Cmd): OpBody {
  const { extra, visual } = c;
  const a = c.a;
  const dur = durArg(a[0], 'a duration');
  extra(1, 'use: wait <duration>, like wait 1s');
  return visual({ op: 'wait', dur });
}

function parseCallCommand(c: Cmd): OpBody {
  const { text } = c;
  // call label  |  call label(expr, expr, ...): the arguments are expressions, bound to the label's parameters
  const m = RE_CALL.exec(text.trim());
  if (!m) throw new ParseError('Use: call <label>  or  call <label>(arguments)');
  let args: Expr[] = [];
  try { args = parseExprList(m[2] ?? ''); } catch (e) { throw new ParseError(e instanceof ExprError ? e.message : String(e)); }
  return { op: 'call', label: m[1], target: UNRESOLVED, ...(args.length ? { args } : {}) };
}

function parseJumpCommand(c: Cmd): OpBody {
  const { need, extra } = c;
  const label = need(0, 'a label name');
  extra(1, 'use: jump <label>');
  return { op: 'jump', label, target: UNRESOLVED };
}

function parseNvlCommand(c: Cmd): OpBody {
  const a = c.a;
  const mode = a[0];
  if ((mode !== 'on' && mode !== 'off' && mode !== 'clear') || a.length > 1) throw new ParseError('Use: nvl on  |  nvl off  |  nvl clear');
  return { op: 'nvl', mode };
}

function parseTextboxCommand(c: Cmd): OpBody {
  const a = c.a;
  if (a[0] !== 'hide' || a.length > 1) throw new ParseError('Use: textbox hide  (the next line shows the text box again)');
  return { op: 'textbox', mode: 'hide' };
}

function parseUnlockCommand(c: Cmd): OpBody {
  const { need } = c;
  const a = c.a;
  const name = need(0, 'a flag name');
  if (!/^[A-Za-z_]\w*$/.test(name) || a.length > 1) throw new ParseError('Use: unlock <name> (letters, digits, _)');
  return { op: 'unlock', name };
}

function parseInputCommand(c: Cmd): OpBody {
  const { need } = c;
  const a = c.a;
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

function parseReturnCommand(c: Cmd): OpBody {
  const { extra } = c;
  extra(0); return { op: 'ret' };
}

function parseEndCommand(c: Cmd): OpBody {
  const { extra } = c;
  extra(0); return { op: 'end' };
}

/** One parser per command word; the words that are not here are unknown commands (or belong to the file parser). */
const COMMAND_PARSERS: Record<string, (c: Cmd) => OpBody> = {
  scene: parseSceneCommand,
  show: parseShowCommand,
  hide: parseHideCommand,
  move: parseMoveCommand,
  shake: parseShakeCommand,
  animate: parseAnimateCommand,
  hop: parseHopCommand,
  perform: parsePerformCommand,
  burst: parseBurstCommand,
  flash: parseFlashCommand,
  tint: parseTintCommand,
  focus: parseFocusCommand,
  behaviors: parseBehaviorsCommand,
  camera: parseCameraCommand,
  weather: parseWeatherCommand,
  wind: parseWindCommand,
  gravity: parseGravityCommand,
  filter: parseFilterCommand,
  hud: parseHudCommand,
  image: parseImageCommand,
  music: parseMusicCommand,
  sound: parseSoundCommand,
  movie: parseMovieCommand,
  wait: parseWaitCommand,
  call: parseCallCommand,
  jump: parseJumpCommand,
  nvl: parseNvlCommand,
  textbox: parseTextboxCommand,
  unlock: parseUnlockCommand,
  input: parseInputCommand,
  return: parseReturnCommand,
  end: parseEndCommand,
};

function parseCommand(text: string, positions: Positions, anchors: Anchors, stage: StageSize): OpBody {
  const c = new Cmd(text, positions, anchors, stage);
  if (!Object.hasOwn(COMMAND_PARSERS, c.cmd)) throw new UnknownCommand(c.cmd);
  return COMMAND_PARSERS[c.cmd](c);
}

/** Parses one script file: the indented lines become a tree of statements, with definitions collected on the side. */
class FileParser {
  private i = 0;
  private depth = 0;
  private lines: RawLine[] = [];
  private characters: CharacterDef[] = [];
  private items: ItemDef[] = [];
  private screens: ScreenDef[] = [];
  private transforms: TransformDef[] = [];
  private choreographies: ChoreographyDef[] = [];

  constructor(private file: string, private diags: Diagnostic[], private positions: Positions, private anchors: Anchors, private stage: StageSize) {}

  run(text: string): ParsedFile {
    text.split(/\r?\n/).forEach((raw, idx) => {
      const no = idx + 1;
      if (/^\s*$/.test(raw) || /^\s*#/.test(raw)) return;
      if (/^ *\t/.test(raw)) { this.diags.push({ file: this.file, line: no, severity: 'error', message: 'Use spaces for indentation, not tabs' }); return; }
      this.lines.push({ no, indent: raw.length - raw.trimStart().length, text: raw.trim() });
    });
    const top = this.parseBlock(0);
    return { file: this.file, nodes: top.nodes, characters: this.characters, items: this.items, screens: this.screens, transforms: this.transforms, choreographies: this.choreographies };
  }

  private err(ln: RawLine, message: string) { this.diags.push({ file: this.file, line: ln.no, severity: 'error', message }); }
  private warn(ln: RawLine, message: string) { this.diags.push({ file: this.file, line: ln.no, severity: 'warning', message }); }
  private src(ln: RawLine): Src { return { file: this.file, line: ln.no }; }
  private exprOf(ln: RawLine, s: string): Expr | null {
    try { return parseExpr(s); } catch (e) { this.err(ln, e instanceof ExprError ? e.message : String(e)); return null; }
  }
  /** A `{pause=…}` tag in a line of text takes a duration with its unit (`{pause=0.5s}`); without one it would show as text. */
  private checkPauses(ln: RawLine, text: string) {
    for (const p of text.matchAll(/\{pause=([^{}]*)\}/g)) if (durationOf(p[1]) === null) this.err(ln, isBareNumber(p[1]) ? `${unitMessage(p[1])} in {pause=${p[1]}s}` : `{pause=} takes a duration like {pause=0.5s}`);
  }
  /** A menu's `timeout`: a duration (`8s`, `500ms`), or an expression in brackets with the unit after it (`(8 - difficulty)s`). In seconds. */
  private timeoutOf(ln: RawLine, s: string): Expr | null {
    const d = durationOf(s);
    if (d !== null) return { t: 'num', v: d } as Expr;
    const m = /^(\(.*\))(ms|s)$/.exec(s);
    if (m) return this.exprOf(ln, m[2] === 'ms' ? `${m[1]} / 1000` : m[1]);
    this.err(ln, isBareNumber(s) ? unitMessage(s) : `timeout takes a duration: timeout 8s, or an expression in brackets with its unit, like timeout (8 - difficulty)s`);
    return null;
  }

  private parseBlock(indent: number): { nodes: Node[]; endLine: number } {
    const nodes: Node[] = [];
    const startNo = this.lines[this.i]?.no ?? 0;
    while (this.i < this.lines.length) {
      const ln = this.lines[this.i];
      if (ln.indent < indent) break;
      if (ln.indent > indent) { // a run of this.lines indented too far: reported once, then read as a block of its own
        this.err(ln, 'Unexpected indentation');
        nodes.push(...this.parseBlock(ln.indent).nodes);
        continue;
      }
      const node = this.parseStatement(ln);
      if (node) nodes.push(node);
    }
    return { nodes, endLine: this.lines[this.i - 1]?.no ?? startNo };
  }

  private parseChild(header: RawLine): { nodes: Node[]; endLine: number } {
    const next = this.lines[this.i];
    if (!next || next.indent <= header.indent) {
      this.err(header, 'Expected an indented block after this line');
      return { nodes: [], endLine: header.no };
    }
    this.depth++;
    const r = this.parseBlock(next.indent);
    this.depth--;
    return r;
  }

  /** The body of a `screen name:` block (or of an `each` inside it), one element per line. */
  private parseScreenBody(header: RawLine, def: ScreenDef, inEach: boolean, inLayout = false): ScreenNode[] {
    const first = this.lines[this.i];
    if (!first || first.indent <= header.indent) { this.err(header, 'Expected an indented block after this line'); return []; }
    const indent = first.indent, nodes: ScreenNode[] = [];
    /** The physical line of a multi-line element that holds `frag`, for a diagnostic. */
    const part = (l: RawLine, frag: string | null) => (l.parts && frag ? l.parts.find(p => p.text.includes(frag)) ?? l : l);
    const cond = (l: RawLine, e: string | null) => (e === null ? null : this.exprOf(part(l, e), e));
    while (this.i < this.lines.length && this.lines[this.i].indent >= indent) {
      let l = this.lines[this.i++];
      if (l.indent > indent) { // reported once for the whole run of this.lines indented too far
        this.err(l, 'Unexpected indentation');
        while (this.i < this.lines.length && this.lines[this.i].indent > indent) this.i++;
        continue;
      }
      // indented this.lines that start with a clause word (on, if, enabled, ...) continue this element's line
      const conts: RawLine[] = [];
      while (this.i < this.lines.length && this.lines[this.i].indent > l.indent && startsWithClause(this.lines[this.i].text)) {
        const c = this.lines[this.i++];
        if (conts.length && c.indent !== conts[0].indent) this.err(c, 'The continuation lines of one element must be indented the same');
        else conts.push(c);
      }
      if (conts.length && /:[ \t]*$/.test(l.text)) this.err(l, 'An element written over several lines ends with ":" on its last line (the one that owns child elements), not on the first');
      if (conts.length) l = { ...l, text: [l, ...conts].map(p => p.text).join(' '), parts: [l, ...conts] };
      try {
        const word = /^[^\s:]+/.exec(l.text)?.[0] ?? '';
        if (startsWithClause(l.text)) throw new ElementSyntaxError(`"${word}" continues the element line above it: indent it deeper than that element, before any child lines`);
        if (l.parts && ['default', 'cancel', 'state', 'textbox'].includes(word)) { this.err(l.parts[1], `"${word}" is a single line: it takes no continuation lines`); continue; }
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
          const e = this.exprOf(l, m[2]);
          if (e && usesRandom(e)) throw new ElementSyntaxError('A state cannot use random(): a screen redraws and replays, and would draw again');
          if (e) (def.states ??= []).push({ name: m[1], expr: e, src: this.src(l) });
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
          const body = this.parseScreenBody(l, def, true, inLayout);
          nodes.push({ kind: 'each', list: h.list, as: h.as, x: h.x, y: h.y, dx: h.dx, dy: h.dy, limit: h.limit, body, src: this.src(l), cond: cond(l, h.cond), ...(h.anim ? { anim: h.anim } : {}) });
          continue;
        }
        if (word === 'scroll') {
          const h = parseScrollHeader(l.text.replace(/[ \t]*:$/, ''));
          if (!h) continue;
          const body = this.parseScreenBody(l, def, inEach, inLayout);
          nodes.push({ kind: 'scroll', x: h.x, y: h.y, w: h.w, h: h.h, start: h.start, bar: h.bar, body, src: this.src(l), cond: cond(l, h.cond), ...(h.anim ? { anim: h.anim } : {}) });
          continue;
        }
        if (word === 'row' || word === 'column' || word === 'grid') {
          const h = parseLayoutHeader(l.text.replace(/[ \t]*:$/, ''), inLayout);
          if (!h) continue;
          const body = this.parseScreenBody(l, def, inEach, true);
          nodes.push({ kind: 'layout', type: h.type, columns: h.columns, at: h.at, anchor: h.anchor, ...(h.anchorVar ? { anchorVar: h.anchorVar } : {}), margin: h.margin, padding: h.padding, gap: h.gap, align: h.align, cell: h.cell, ...(h.width ? { width: h.width } : {}), ...(h.height ? { height: h.height } : {}), body, src: this.src(l), cond: cond(l, h.cond), ...(h.anim ? { anim: h.anim } : {}) });
          continue;
        }
        if (word === 'panel') {
          const h = parsePanelHeader(l.text.replace(/[ \t]*:$/, ''), inLayout, this.stage);
          if (!h) continue;
          // a panel's children sit inside it, so `at` is relative to it; a bare frame (no colon) has none
          const body = /:[ \t]*$/.test(l.text) ? this.parseScreenBody(l, def, inEach, false) : [];
          nodes.push({ kind: 'panel', x: h.x, y: h.y, w: h.w, h: h.h, file: h.file, slice: h.slice, edge: h.edge, padding: h.padding, ...(h.color ? { color: h.color } : {}), body, src: this.src(l), cond: cond(l, h.cond), ...(h.anim ? { anim: h.anim } : {}) });
          continue;
        }
        // a hotspot or button ending in `:` owns the indented this.lines below it, placed in stage coordinates like its siblings
        const owns = (word === 'hotspot' || word === 'button') && /:[ \t]*$/.test(l.text);
        const p = parseElementLine(owns ? l.text.replace(/[ \t]*:[ \t]*$/, '') : l.text, inLayout, this.stage);
        if (p.el.kind === 'bar') {
          const { value, min, max, ...rest } = p.el;
          const [v, lo, hi] = [this.exprOf(part(l, value), value), this.exprOf(part(l, min), min), this.exprOf(part(l, max), max)];
          if (v && lo && hi) nodes.push({ ...rest, value: v, min: lo, max: hi, src: this.src(l), cond: cond(l, p.cond), ...(p.anim ? { anim: p.anim } : {}) });
          continue;
        }
        const node = { ...p.el, src: this.src(l), cond: cond(l, p.cond), ...(p.anim ? { anim: p.anim } : {}) } as ScreenNode;
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
            const e = this.exprOf(part(l, h.expr), h.expr);
            if (e && usesRandom(e)) throw new ElementSyntaxError('on ... set cannot use random(): it is worked out whenever the screen redraws');
            if (e) sets[event as keyof LocalSets] = { name: h.name, expr: e };
          }
          if (Object.keys(sets).length) node.sets = sets;
          if (p.bind && node.kind === 'button') { declared(p.bind.name); node.bind = p.bind; }
          if (owns) node.body = this.parseScreenBody(l, def, inEach, false);
        }
        nodes.push(node);
      } catch (e) {
        this.err((e as { line?: RawLine }).line ?? (e instanceof ElementSyntaxError ? this.failLine(l, inLayout) : l), e instanceof ElementSyntaxError || e instanceof ParseError ? e.message : String(e));
        while (this.i < this.lines.length && this.lines[this.i].indent > l.indent) this.i++; // the body of a bad each
      }
    }
    return nodes;
  }

  /** The physical line of a multi-line element whose clause is the first to fail when the this.lines are read one more at a time. */
  private failLine(l: RawLine, inLayout: boolean): RawLine {
    if (!l.parts) return l;
    for (let k = 0; k < l.parts.length; k++) {
      const t = l.parts.slice(0, k + 1).map(p => p.text).join(' ').replace(/[ \t]*:[ \t]*$/, '');
      try {
        const word = /^[^\s:]+/.exec(t)?.[0] ?? '';
        if (word === 'each') parseEachHeader(t);
        else if (word === 'scroll') parseScrollHeader(t);
        else if (word === 'row' || word === 'column' || word === 'grid') parseLayoutHeader(t, inLayout);
        else if (word === 'panel') parsePanelHeader(t, inLayout, this.stage);
        else parseElementLine(t, inLayout, this.stage);
      } catch { return l.parts[k]; }
    }
    return l;
  }

  private parseScreen(ln: RawLine, name: string, paramText: string | undefined): ScreenDef {
    const written = (paramText ?? '').split(',').map(s => s.trim()).filter((s, idx, all) => s !== '' || all.length > 1);
    const inout: string[] = [];
    const params = written.map(s => { const m = /^inout[ \t]+(\S.*)$/.exec(s); if (m) inout.push(m[1].trim()); return m ? m[1].trim() : s; });
    for (const [idx, p] of params.entries()) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(p) || RESERVED_WORDS.includes(p)) this.err(ln, `"${p}" is not a valid parameter name (letters, digits and _)`);
      else if (params.indexOf(p) !== idx) this.err(ln, `Parameter "${p}" is listed twice`);
    }
    const def: ScreenDef = { name, src: this.src(ln), body: [], default: null, cancel: false, ...(params.length ? { params } : {}), ...(inout.length ? { inout } : {}) };
    def.body = this.parseScreenBody(ln, def, false);
    return def;
  }

  /** The body of a `choreography name:` block: lines `<time> <target>: <step>` (`0.6s alice: hop`) (the step is a tween, a wait or a preset, as in a transform). */
  private parseChoreography(header: RawLine, name: string): ChoreographyDef {
    const def: ChoreographyDef = { name, src: this.src(header), lines: [] };
    const first = this.lines[this.i];
    if (!first || first.indent <= header.indent) { this.err(header, 'Expected an indented block after this line'); return def; }
    while (this.i < this.lines.length && this.lines[this.i].indent >= first.indent) {
      const l = this.lines[this.i++];
      if (l.indent > first.indent) { this.err(l, 'Unexpected indentation (a choreography line is <time> <target>: <step>)'); continue; }
      const m = RE_CHOREO_LINE.exec(l.text);
      if (!m) { this.err(l, 'Use: <time> <character, picture or camera>: <step>   (for example: 0.6s alice: hop)'); continue; }
      const at = durationOf(m[1]);
      if (at === null) { this.err(l, unitMessage(m[1])); continue; }
      let step: ReturnType<typeof parseTransformLine>;
      try { step = parseTransformLine(m[3], this.src(l)); } catch (e) { this.err(l, e instanceof Error ? e.message : String(e)); continue; }
      if (!('kind' in step) || (step.kind !== 'tween' && step.kind !== 'wait' && step.kind !== 'preset')) { this.err(l, 'A choreography step is a tween, wait or preset (no parallel, if, pick or repeat: give two actors two lines)'); continue; }
      def.lines.push({ at, target: m[2], step, src: this.src(l) } as ChoreographyLine);
    }
    return def;
  }

  /** The body of a `transform name:` block: tween and wait lines, and `repeat` last. */
  private parseTransform(header: RawLine, name: string, paramText: string | undefined, autoText: string | undefined): TransformDef {
    const params: TransformParam[] = [];
    for (const raw of (paramText ?? '').split(',').map(x => x.trim()).filter(Boolean)) {
      const pm = /^([A-Za-z_]\w*)(?:\s*=\s*(-?\d+(?:\.\d+)?|-?\.\d+))?$/.exec(raw);
      if (!pm || RESERVED_WORDS.includes(pm[1])) this.err(header, `"${raw}" is not a parameter (a name, optionally = a number: transform nervous(amount=1):)`);
      else if (params.some(q => q.name === pm[1])) this.err(header, `Parameter "${pm[1]}" is listed twice`);
      else params.push({ name: pm[1], def: pm[2] === undefined ? 0 : Number(pm[2]) });
    }
    const def: TransformDef = { name, src: this.src(header), params, steps: [], repeat: null };
    if (autoText) {
      const am = RE_TRANSFORM_AUTO.exec(autoText.trim());
      if (!am) this.err(header, 'Use: transform name every <duration>[..<duration>] [while <condition>]:  (like every 3s..6s, or while <condition>: alone)');
      else {
        const auto: AutoDef = {};
        const unitless = [am[1], am[2]].find(t => t !== undefined && durationOf(t) === null);
        if (unitless !== undefined) this.err(header, unitMessage(unitless));
        else if (am[1] !== undefined) {
          const lo = durationOf(am[1])!, hi = am[2] === undefined ? lo : durationOf(am[2])!;
          if (!(lo > 0) || hi < lo) this.err(header, 'every needs a duration above 0, and the second one of a range cannot be shorter than the first');
          else auto.every = am[2] === undefined ? lo : { min: lo, max: hi };
        }
        if (am[3] !== undefined) {
          if (!parseCondition(am[3])) this.err(header, `"${am[3]}" is not a condition`);
          else auto.while = am[3].trim();
        }
        if (auto.every !== undefined || auto.while !== undefined) def.auto = auto;
      }
    }
    def.repeat = this.parseTransformSteps(header, def.steps, true);
    return def;
  }

  /**
   * The indented lines under `header` as steps appended to `steps`. A `parallel:` line with its block is one branch, and
   * `parallel:` lines that follow each other at one level are the branches of one step; `if` / `elif` / `else` chain the
   * same way, and `pick:` holds `choice:` blocks. Returns the `repeat` (top level only).
   */
  private parseTransformSteps(header: RawLine, steps: TransformStep[], top: boolean): TransformRepeat {
    const first = this.lines[this.i];
    if (!first || first.indent <= header.indent) { this.err(header, 'Expected an indented block after this line'); return null; }
    const indent = first.indent;
    let repeat: TransformRepeat = null, group: Extract<TransformStep, { kind: 'parallel' }> | null = null, chain: Extract<TransformStep, { kind: 'if' }> | null = null;
    while (this.i < this.lines.length && this.lines[this.i].indent >= indent) {
      const l = this.lines[this.i++];
      if (l.indent > indent) { // reported once for the whole run of lines indented too far
        this.err(l, 'Unexpected indentation (indent only under parallel:, if, elif, else, pick: and choice:)');
        while (this.i < this.lines.length && this.lines[this.i].indent > indent) this.i++;
        continue;
      }
      if (repeat !== null) { this.err(l, 'repeat must be the last line of the transform'); continue; }
      let step: ReturnType<typeof parseTransformLine>;
      try { step = parseTransformLine(l.text, this.src(l)); } catch (e) { this.err(l, e instanceof Error ? e.message : String(e)); group = chain = null; continue; }
      if ('block' in step) {
        const kind = step.block;
        if (kind === 'parallel') {
          chain = null;
          const branch: TransformStep[] = [];
          this.parseTransformSteps(l, branch, false);
          if (!group) { group = { kind: 'parallel', branches: [], src: this.src(l) }; steps.push(group); }
          group.branches.push(branch);
        } else if (kind === 'if' || kind === 'elif' || kind === 'else') {
          group = null;
          const cond = 'cond' in step ? step.cond : null;
          const branch: TransformStep[] = [];
          if (kind === 'if') { chain = { kind: 'if', branches: [], src: this.src(l) }; steps.push(chain); }
          else if (!chain || chain.branches[chain.branches.length - 1].cond === null) { this.err(l, `${kind} needs an if before it`); this.parseTransformSteps(l, branch, false); continue; }
          chain.branches.push({ cond, steps: branch });
          this.parseTransformSteps(l, branch, false);
        } else if (kind === 'pick') {
          group = chain = null;
          const branches: TransformStep[][] = [];
          const inner = this.lines[this.i];
          if (!inner || inner.indent <= l.indent) { this.err(l, 'Expected choice: blocks after pick:'); continue; }
          while (this.i < this.lines.length && this.lines[this.i].indent >= inner.indent) {
            const c = this.lines[this.i++];
            if (c.indent > inner.indent || c.text !== 'choice:') {
              this.err(c, 'pick: holds choice: blocks (each is one possible branch)');
              while (this.i < this.lines.length && this.lines[this.i].indent > inner.indent) this.i++;
              continue;
            }
            const branch: TransformStep[] = [];
            this.parseTransformSteps(c, branch, false);
            branches.push(branch);
          }
          steps.push({ kind: 'pick', branches, src: this.src(l) });
        } else {
          group = chain = null;
          this.err(l, 'choice: belongs inside pick:');
          this.parseTransformSteps(l, [], false);
        }
        continue;
      }
      group = chain = null;
      if ('repeat' in step) {
        if (!top) this.err(l, 'repeat belongs at the end of the transform, not inside a block');
        else repeat = step.repeat;
      } else steps.push(step);
    }
    return repeat;
  }

  /**
   * A line that would read as `Unknown command` but is a known slip: a block opener without its colon, a label name with a character
   * the language does not allow, `$ x = 1`, a `set` that is not `name = value`, or `hero "text"`. Says what to write. Where the line
   * can be read as meant (the colon, `$`), it is read that way, so its block does not add errors of its own. Null: not a slip.
   */
  private slip(ln: RawLine, t: string, word: string): { node: Node | null } | null {
    const reread = (text: string) => { ln.text = text; this.i--; return { node: this.parseStatement(ln) }; };
    if (t.startsWith('$')) {
      const body = t.slice(1).trim();
      if (!RE_SET.test(`set ${body}`)) { this.err(ln, 'Use: set <name> = <value>  ($ is not used)'); return { node: null }; }
      this.err(ln, `Use set instead of $: set ${body}`);
      return reread(`set ${body}`);
    }
    if (word === 'set') { this.err(ln, 'Use: set <name> = <value>  (also +=, -=, *= and /=)'); return { node: null }; }
    if (word === 'label') {
      const name = /^label[ \t]+([^\s(:]+)/.exec(withoutComment(t))?.[1];
      if (!name) { this.err(ln, OPENER_USAGE.label); return { node: null }; }
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        const bad = [...name].find((c, i) => !(i ? /\w/ : /[A-Za-z_]/).test(c))!;
        this.err(ln, `Label names use the letters a-z, digits and _, and do not start with a digit: "${name}" has "${bad}"`);
        if (withoutComment(t).endsWith(':')) this.parseChild(ln); // its block is read, not reported as stray indentation
        return { node: null };
      }
    }
    if (Object.hasOwn(OPENER_USAGE, word)) {
      const bare = withoutComment(t);
      if (bare === t && t.endsWith(':')) { this.err(ln, OPENER_USAGE[word]); return { node: null }; }
      return reread(this.repairOpener(ln, word));
    }
    if (/^[A-Za-z_]\w*$/.test(word) && /^[ \t]*"/.test(t.slice(word.length))) {
      this.err(ln, `Dialogue is written ${word}: text  (a colon after the name, no quotes); a quoted "text" on its own line is narration`);
      return { node: null };
    }
    return null;
  }

  /** Dialogue text with an `#id` and more words after it, or a `# comment`: all of it is shown to the player. */
  private warnLeak(ln: RawLine, text: string) {
    const id = /[ \t](#(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{4,8})[ \t]+\S/.exec(text);
    if (id) this.warn(ln, `The text goes on after the id ${id[1]}, and the player sees it: the #id is the last thing on the line`);
    else if (/[ \t]#(?:[ \t]+\S|$)/.test(text)) this.warn(ln, 'Everything after the colon is dialogue, so the player sees this "#" and what follows it: a # comment goes on a line of its own');
  }

  /** A block opener with no colon at its end, or a # comment after it: says so, and returns the line as it should be written. */
  private repairOpener(ln: RawLine, word: string): string {
    const bare = withoutComment(ln.text), fixed = bare.endsWith(':') ? bare : `${bare}:`;
    const note = bare === ln.text ? '' : '  (a # comment goes on a line of its own)';
    this.err(ln, bare.endsWith(':') ? `A # comment goes on a line of its own, not after "${word}...:"` : `"${word}" needs a colon at the end of the line: ${fixed}${note}`);
    return fixed;
  }

  private parseStatement(ln: RawLine): Node | null {
    const t = ln.text;
    this.i++;
    let m: RegExpExecArray | null;

    if ((m = RE_LABEL.exec(t))) {
      if (this.depth > 0) this.err(ln, 'Labels must be at the top level');
      const params = (m[2] ?? '').split(',').map(s => s.trim()).filter((s, idx, all) => s !== '' || all.length > 1);
      for (const [idx, p] of params.entries()) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(p) || RESERVED_WORDS.includes(p)) this.err(ln, `"${p}" is not a valid parameter name (letters, digits and _)`);
        else if (params.indexOf(p) !== idx) this.err(ln, `Parameter "${p}" is listed twice`);
      }
      return { k: 'label', src: this.src(ln), name: m[1], params, body: this.parseChild(ln).nodes };
    }
    if ((m = RE_MENU.exec(t))) {
      const prompt = m[1] !== undefined ? unescapeText(m[1]) : null, promptId = m[2] ?? null;
      const first = this.lines[this.i];
      const options: Extract<Node, { k: 'menu' }>['options'] = [];
      if (!first || first.indent <= ln.indent) { this.err(ln, 'Expected options after "menu:"'); return null; }
      const optIndent = first.indent;
      const seconds = m[4] !== undefined ? this.timeoutOf(ln, m[4].trim()) ?? { t: 'num', v: 0 } as Expr : null;
      let timeout: Extract<Node, { k: 'menu' }>['timeout'] = null, lateOptions = false;
      while (this.i < this.lines.length && this.lines[this.i].indent >= optIndent) {
        const ol = this.lines[this.i];
        if (ol.indent > optIndent) { // reported once for the whole run of this.lines indented too far
          this.err(ol, 'Unexpected indentation');
          while (this.i < this.lines.length && this.lines[this.i].indent > optIndent) this.i++;
          continue;
        }
        if (RE_ON_TIMEOUT.test(ol.text)) {
          this.i++;
          const child = this.parseChild(ol);
          if (timeout) this.err(ol, 'A menu has only one "on timeout:" block');
          else if (seconds === null) this.err(ol, '"on timeout:" needs the menu to have a clock: menu ... timeout <seconds>:');
          else timeout = { seconds, src: this.src(ol), to: child.endLine, body: child.nodes };
          continue;
        }
        const om = RE_OPT.exec(ol.text);
        this.i++;
        if (timeout && !lateOptions) { this.err(ol, '"on timeout:" must be the last block of the menu'); lateOptions = true; }
        if (!om) { this.err(ol, 'Menu options look like: "Option text":'); continue; }
        const cond = om[3] ? this.exprOf(ol, om[3]) : null;
        const child = this.parseChild(ol);
        options.push({ text: unescapeText(om[1]), id: om[2] ?? null, cond, reason: om[4] !== undefined ? unescapeText(om[4]) : null, reasonId: om[5] ?? null,
          src: this.src(ol), to: child.endLine, body: child.nodes });
      }
      if (seconds !== null && !timeout && !lateOptions) this.err(ln, 'A menu with "timeout" needs an "on timeout:" block (the story says what happens when time runs out)');
      return { k: 'menu', src: this.src(ln), prompt, promptId, look: m[3] ?? null, options, timeout };
    }
    if (RE_ON_TIMEOUT.test(t)) { this.err(ln, '"on timeout:" only belongs inside a "menu ... timeout <seconds>:" block'); return null; }
    if ((m = RE_IF.exec(t))) {
      const branches: Extract<Node, { k: 'if' }>['branches'] = [];
      const cond = this.exprOf(ln, m[1]);
      branches.push({ cond: cond ?? { t: 'bool', v: false }, src: this.src(ln), body: this.parseChild(ln).nodes });
      for (;;) {
        const nx = this.lines[this.i];
        if (!nx || nx.indent !== ln.indent) break;
        const bareWord = /^(?:elif(?=[ \t])|else(?=[ \t:]|$))/.exec(nx.text)?.[0];
        if (bareWord) { // no colon, or a comment after it: read as if it were written right
          const bare = withoutComment(nx.text);
          if (bare.includes(':') ? bare.endsWith(':') && bare !== nx.text : true) nx.text = this.repairOpener(nx, bareWord);
        }
        let em: RegExpExecArray | null;
        if ((em = RE_ELIF.exec(nx.text))) {
          this.i++;
          const c = this.exprOf(nx, em[1]);
          branches.push({ cond: c ?? { t: 'bool', v: false }, src: this.src(nx), body: this.parseChild(nx).nodes });
        } else if (RE_ELSE.test(nx.text)) {
          this.i++;
          branches.push({ cond: null, src: this.src(nx), body: this.parseChild(nx).nodes });
          break;
        } else break;
      }
      return { k: 'if', src: this.src(ln), branches };
    }
    if (RE_ELIF.test(t) || RE_ELSE.test(t)) { this.err(ln, 'This "elif/else" has no matching "if"'); return null; }
    if (RE_OPT.test(t)) { this.err(ln, 'Options only belong inside a "menu:" block'); return null; }

    if ((m = RE_NARR.exec(t))) {
      // indented this.lines that are a bare quoted string continue the narration: each starts a new line of the text
      let text = unescapeText(m[1]);
      while (this.i < this.lines.length && this.lines[this.i].indent > ln.indent) {
        const c = RE_NARR.exec(this.lines[this.i].text);
        if (!c) break;
        if (c[2] || c[3]) this.err(this.lines[this.i], 'Put style= and the #id on the first line of narration written over several lines');
        text += `\n${unescapeText(c[1])}`;
        this.i++;
      }
      this.checkPauses(ln, text);
      return { k: 'op', src: this.src(ln), body: { op: 'say', who: null, text, id: m[3] ?? null, ...(m[2] ? { look: m[2] } : {}) } };
    }
    if ((m = RE_SAY.exec(t))) {
      this.warnLeak(ln, m[2]);
      this.checkPauses(ln, m[2]);
      return { k: 'op', src: this.src(ln), body: { op: 'say', who: m[1], text: unescapeText(m[2]), id: m[4] ?? null, ...(m[3] ? { look: m[3] } : {}) } };
    }
    if ((m = RE_SET.exec(t))) {
      const e = this.exprOf(ln, m[3]);
      if (!e) return null;
      return { k: 'op', src: this.src(ln), body: { op: 'set', name: m[1], assign: m[2] as '=', expr: e } };
    }
    if ((m = RE_TRANSFORM.exec(t))) {
      if (this.depth > 0) this.err(ln, 'Transforms must be at the top level');
      this.transforms.push(this.parseTransform(ln, m[1], m[2], m[3]));
      return null;
    }
    if ((m = RE_CHOREO.exec(t))) {
      if (this.depth > 0) this.err(ln, 'Choreographies must be at the top level');
      this.choreographies.push(this.parseChoreography(ln, m[1]));
      return null;
    }
    if ((m = RE_SCREEN.exec(t))) {
      if (this.depth > 0) this.err(ln, 'Screens must be at the top level');
      this.screens.push(this.parseScreen(ln, m[1], m[2]));
      return null;
    }
    if (RE_DEFINE_ITEM.test(t)) {
      const a = tokenizeArgs(t).slice(2);
      const hasName = /^"/.test(t.slice(t.indexOf(a[0], 11) + a[0].length).trimStart());
      const item: ItemDef = { id: a[0], name: hasName ? a[1] : a[0], nameId: null, image: null, src: this.src(ln) };
      if (!hasName) this.warn(ln, `Item ${a[0]} has no display name: use define item ${a[0]} "Name"`);
      for (const tok of a.slice(hasName ? 2 : 1)) {
        if (/^#[A-Za-z0-9]{4,8}$/.test(tok)) item.nameId = tok.slice(1);
        else if (tok.startsWith('image=') && tok.length > 6) item.image = tok.slice(6);
        else this.warn(ln, `Unknown define item option "${tok}" (use image=<file>)`);
      }
      this.items.push(item);
      return null;
    }
    if (t.startsWith('define ') || t === 'define') {
      const a = tokenizeArgs(t).slice(1);
      if (!a[0] || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(a[0])) { this.err(ln, 'Use: define <id> "Display name" color=#rrggbb'); return null; }
      if (a[0] === 'screen') { this.err(ln, '"screen" is not a valid character id: `shake screen` shakes the whole stage'); return null; }
      const hasName = a[1] !== undefined && /^"/.test(t.slice(t.indexOf(a[0]) + a[0].length).trimStart());
      const name = hasName ? a[1] : a[0];
      const def: CharacterDef = { id: a[0], name, color: null, style: {}, src: this.src(ln) };
      for (const attr of a.slice(hasName ? 2 : 1)) {
        const problem = defineAttr(def, attr);
        if (problem) this.warn(ln, problem);
      }
      this.characters.push(def);
      return null;
    }
    if (t.startsWith('"')) {
      // Not narration and not an option: say so, not `Unknown command "The rain falls."` (a missing or doubled closing quote).
      const quotes = t.replace(/\\./g, '').split('"').length - 1;
      this.err(ln, quotes % 2 === 1 ? 'Missing or extra quote: narration is "text" with one closing quote' : 'Narration is one "quoted text" per line, then an optional style= and #id');
      return null;
    }
    try {
      return { k: 'op', src: this.src(ln), body: parseCommand(t, this.positions, this.anchors, this.stage) };
    } catch (e) {
      if (e instanceof UnknownCommand) {
        const slip = this.slip(ln, t, e.word);
        if (slip) return slip.node;
        this.diags.push(withFix(this.src(ln), 'error', e.message, e.word, COMMAND_WORDS));
      } else this.err(ln, e instanceof ParseError ? e.message + (withoutComment(t) !== t ? ' (a # comment goes on a line of its own)' : '') : String(e));
      return null;
    }
  }
}

export function parseFile(file: string, text: string, diags: Diagnostic[], positions: Positions = BUILTIN_POSITIONS, anchors: Anchors = ANCHORS, stage: StageSize = DEFAULT_STAGE): ParsedFile {
  return new FileParser(file, diags, positions, anchors, stage).run(text);
}
