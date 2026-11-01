// Tiny, safe expression language: numbers, strings, lists, variables, arithmetic,
// comparisons, and / or / not. No eval, so state stays serializable.

import type { Rng } from './random.js';

export type Scalar = number | string | boolean;
/** A variable's value: a scalar, or a list of scalars. Lists are never changed in place (see `arith`). */
export type Value = Scalar | Scalar[];

export type Expr =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'list'; items: Expr[] }
  | { t: 'var'; name: string }
  | { t: 'un'; op: '-' | 'not'; e: Expr }
  | { t: 'bin'; op: string; l: Expr; r: Expr }
  | { t: 'call'; name: string; args: Expr[] };

/** Functions usable in expressions, with their argument counts. `random` ones draw from the runtime's seeded generator. */
export const FUNCTIONS: Record<string, { min: number; max: number; help: string; random?: boolean }> = {
  random: { min: 0, max: 2, random: true, help: 'random() is 0 to <1; random(n) a whole number 1..n; random(a, b) a whole number a..b' },
  pick: { min: 1, max: Infinity, random: true, help: 'pick(a, b, ...) one of its arguments, chosen at random; pick(list) one of its elements' },
  chance: { min: 1, max: 1, random: true, help: 'chance(percent) is true that often' },
  contains: { min: 2, max: 2, help: 'contains(list, x) is true when the list has x' },
  count: { min: 1, max: 2, help: 'count(list) is the number of elements; count(list, x) how many equal x' },
  item: { min: 2, max: 2, help: 'item(list, n) is the n-th element, counting from 1 ("" when there is none)' },
  index: { min: 2, max: 2, help: 'index(list, x) is the position of the first x, counting from 1 (0 when absent)' },
};

export class ExprError extends Error {}

interface Tok { t: 'num' | 'str' | 'id' | 'op'; v: string }

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    const rest = src.slice(i);
    let m: RegExpExecArray | null;
    if ((m = /^[0-9]*\.?[0-9]+/.exec(rest))) { out.push({ t: 'num', v: m[0] }); i += m[0].length; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1, s = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\' && j + 1 < src.length) j++;
        s += src[j++];
      }
      if (j >= src.length) throw new ExprError('Unterminated string');
      out.push({ t: 'str', v: s }); i = j + 1; continue;
    }
    // Names; `unlocked.<flag>` and `persistent.<name>` are the dotted forms (persistent data, see Runtime).
    if ((m = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?/.exec(rest))) { out.push({ t: 'id', v: m[0] }); i += m[0].length; continue; }
    if ((m = /^(==|!=|<=|>=)/.exec(rest))) { out.push({ t: 'op', v: m[0] }); i += 2; continue; }
    if ('+-*/%<>(),[]'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
    throw new ExprError(`Unexpected character "${c}"`);
  }
  return out;
}

export function parseExpr(src: string): Expr {
  return parseExprs(src, false)[0];
}

/** A comma-separated list of expressions (the arguments of `call label(...)`); an empty text gives none. */
export function parseExprList(src: string): Expr[] {
  return src.trim() === '' ? [] : parseExprs(src, true);
}

function parseExprs(src: string, list: boolean): Expr[] {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.t === 'op' && peek().v === v;
  const isKw = (v: string) => peek()?.t === 'id' && peek().v === v;

  function orExpr(): Expr {
    let l = andExpr();
    while (isKw('or')) { p++; l = { t: 'bin', op: 'or', l, r: andExpr() }; }
    return l;
  }
  function andExpr(): Expr {
    let l = notExpr();
    while (isKw('and')) { p++; l = { t: 'bin', op: 'and', l, r: notExpr() }; }
    return l;
  }
  function notExpr(): Expr {
    if (isKw('not')) { p++; return { t: 'un', op: 'not', e: notExpr() }; }
    return cmpExpr();
  }
  function cmpExpr(): Expr {
    let l = addExpr();
    while (peek()?.t === 'op' && ['==', '!=', '<', '<=', '>', '>='].includes(peek().v)) {
      const op = toks[p++].v;
      l = { t: 'bin', op, l, r: addExpr() };
    }
    return l;
  }
  function addExpr(): Expr {
    let l = mulExpr();
    while (isOp('+') || isOp('-')) { const op = toks[p++].v; l = { t: 'bin', op, l, r: mulExpr() }; }
    return l;
  }
  function mulExpr(): Expr {
    let l = unary();
    while (isOp('*') || isOp('/') || isOp('%')) { const op = toks[p++].v; l = { t: 'bin', op, l, r: unary() }; }
    return l;
  }
  function unary(): Expr {
    if (isOp('-')) { p++; return { t: 'un', op: '-', e: unary() }; }
    return primary();
  }
  function primary(): Expr {
    const t = toks[p++];
    if (!t) throw new ExprError('Unexpected end of expression');
    if (t.t === 'num') return { t: 'num', v: Number(t.v) };
    if (t.t === 'str') return { t: 'str', v: t.v };
    if (t.t === 'id') {
      if (isOp('(') && !t.v.includes('.')) {
        const fn = FUNCTIONS[t.v];
        if (!fn) throw new ExprError(`Unknown function "${t.v}" (${Object.keys(FUNCTIONS).join(', ')})`);
        p++;
        const args: Expr[] = [];
        if (!isOp(')')) {
          args.push(orExpr());
          while (isOp(',')) { p++; args.push(orExpr()); }
        }
        if (!isOp(')')) throw new ExprError('Missing closing parenthesis');
        p++;
        if (args.length < fn.min || args.length > fn.max) throw new ExprError(fn.help);
        return { t: 'call', name: t.v, args };
      }
      if (t.v === 'true') return { t: 'bool', v: true };
      if (t.v === 'false') return { t: 'bool', v: false };
      if (['and', 'or', 'not'].includes(t.v)) throw new ExprError(`Unexpected "${t.v}"`);
      return { t: 'var', name: t.v };
    }
    if (t.v === '[') {
      const items: Expr[] = [];
      if (!isOp(']')) {
        items.push(orExpr());
        while (isOp(',')) { p++; items.push(orExpr()); }
      }
      if (!isOp(']')) throw new ExprError('Missing closing bracket');
      p++;
      return { t: 'list', items };
    }
    if (t.v === '(') {
      const e = orExpr();
      if (!isOp(')')) throw new ExprError('Missing closing parenthesis');
      p++;
      return e;
    }
    throw new ExprError(`Unexpected "${t.v}"`);
  }

  if (toks.length === 0) throw new ExprError('Empty expression');
  const out = [orExpr()];
  while (list && isOp(',')) { p++; out.push(orExpr()); }
  if (p < toks.length) throw new ExprError(`Unexpected "${toks[p].v}"`);
  return out;
}

export function collectVars(e: Expr, out: Set<string> = new Set()): Set<string> {
  switch (e.t) {
    case 'var': out.add(e.name); break;
    case 'un': collectVars(e.e, out); break;
    case 'bin': collectVars(e.l, out); collectVars(e.r, out); break;
    case 'call': for (const a of e.args) collectVars(a, out); break;
    case 'list': for (const a of e.items) collectVars(a, out); break;
  }
  return out;
}

/** True when evaluating the expression draws a random number. */
export function usesRandom(e: Expr): boolean {
  switch (e.t) {
    case 'call': return FUNCTIONS[e.name]?.random === true || e.args.some(usesRandom);
    case 'list': return e.items.some(usesRandom);
    case 'un': return usesRandom(e.e);
    case 'bin': return usesRandom(e.l) || usesRandom(e.r);
    default: return false;
  }
}

const asList = (v: Value): readonly Scalar[] => (Array.isArray(v) ? v : []);
const scalar = (v: Value): Scalar => (Array.isArray(v) ? v.join(', ') : v);

/** Lists are equal when they hold the same scalars in the same order. */
export function valuesEqual(l: Value, r: Value): boolean {
  if (Array.isArray(l) || Array.isArray(r)) return Array.isArray(l) && Array.isArray(r) && l.length === r.length && l.every((v, i) => v === r[i]);
  return l === r;
}

/**
 * `l op r` for the arithmetic operators, also behind `set x += ...`. With a list on either side `+` appends a scalar or
 * concatenates a list, and `-` removes the first match of each element on the right; a non-list left side counts as the
 * empty list. The result is a new frozen array: stored lists are never changed in place.
 */
export function arith(op: string, l: Value, r: Value): Value {
  if (Array.isArray(l) || Array.isArray(r)) {
    const left = asList(l);
    if (op === '+') return Object.freeze([...left, ...(Array.isArray(r) ? r : [r])]) as Scalar[];
    if (op === '-') {
      const out = [...left];
      for (const x of Array.isArray(r) ? r : [r]) { const i = out.indexOf(x); if (i >= 0) out.splice(i, 1); }
      return Object.freeze(out) as Scalar[];
    }
    return NaN;
  }
  switch (op) {
    case '+': return typeof l === 'string' || typeof r === 'string' ? String(l) + String(r) : Number(l) + Number(r);
    case '-': return Number(l) - Number(r);
    case '*': return Number(l) * Number(r);
    case '/': return Number(l) / Number(r);
    case '%': return Number(l) % Number(r);
  }
  throw new ExprError(`Unknown operator ${op}`);
}

/** Evaluates `e`. Functions draw from `rng`; without one they cannot run (the runtime always supplies it). */
export function evalExpr(e: Expr, vars: Record<string, Value>, rng?: Rng): Value {
  switch (e.t) {
    case 'num': case 'str': case 'bool': return e.v;
    case 'list': return Object.freeze(e.items.map(i => scalar(evalExpr(i, vars, rng)))) as Scalar[];
    case 'var': return vars[e.name] ?? 0; // unset variables read as 0 (the compiler warns about them)
    case 'un': {
      const v = evalExpr(e.e, vars, rng);
      return e.op === 'not' ? !v : -Number(v);
    }
    case 'call': {
      if (FUNCTIONS[e.name]?.random && !rng) throw new ExprError(`${e.name}() needs a running story`);
      switch (e.name) {
        case 'contains': return asList(evalExpr(e.args[0], vars, rng)).some(v => v === scalar(evalExpr(e.args[1], vars, rng)));
        case 'count': {
          const list = asList(evalExpr(e.args[0], vars, rng));
          if (e.args.length === 1) return list.length;
          const x = scalar(evalExpr(e.args[1], vars, rng));
          return list.filter(v => v === x).length;
        }
        case 'item': return asList(evalExpr(e.args[0], vars, rng))[Math.floor(Number(evalExpr(e.args[1], vars, rng))) - 1] ?? '';
        case 'index': return asList(evalExpr(e.args[0], vars, rng)).indexOf(scalar(evalExpr(e.args[1], vars, rng))) + 1;
        case 'random': {
          const u = rng!.next();
          if (e.args.length === 0) return u;
          let lo = 1, hi = Math.floor(Number(evalExpr(e.args[0], vars, rng)));
          if (e.args.length === 2) { lo = Math.ceil(Number(evalExpr(e.args[0], vars, rng))); hi = Math.floor(Number(evalExpr(e.args[1], vars, rng))); }
          if (!(hi >= lo)) return Number.isFinite(lo) ? lo : 0;
          return lo + Math.floor(u * (hi - lo + 1));
        }
        case 'pick': {
          const u = rng!.next();
          if (e.args.length === 1) {
            const only = evalExpr(e.args[0], vars, rng);
            return Array.isArray(only) ? only[Math.floor(u * only.length)] ?? '' : only;
          }
          return evalExpr(e.args[Math.floor(u * e.args.length)], vars, rng);
        }
        case 'chance': return rng!.next() * 100 < Number(evalExpr(e.args[0], vars, rng));
      }
      throw new ExprError(`Unknown function ${e.name}`);
    }
    case 'bin': {
      if (e.op === 'and') return Boolean(evalExpr(e.l, vars, rng)) && Boolean(evalExpr(e.r, vars, rng));
      if (e.op === 'or') return Boolean(evalExpr(e.l, vars, rng)) || Boolean(evalExpr(e.r, vars, rng));
      const l = evalExpr(e.l, vars, rng), r = evalExpr(e.r, vars, rng);
      switch (e.op) {
        case '+': case '-': case '*': case '/': case '%': return arith(e.op, l, r);
        case '==': return valuesEqual(l, r);
        case '!=': return !valuesEqual(l, r);
        case '<': case '<=': case '>': case '>=': {
          if (Array.isArray(l) || Array.isArray(r)) return false;
          return e.op === '<' ? l < r : e.op === '<=' ? l <= r : e.op === '>' ? l > r : l >= r;
        }
      }
      throw new ExprError(`Unknown operator ${e.op}`);
    }
  }
}

const PREC: Record<string, number> = { or: 1, and: 2, '==': 3, '!=': 3, '<': 3, '>': 3, '<=': 3, '>=': 3, '+': 4, '-': 4, '*': 5, '/': 5, '%': 5 };

/** Source-like text for an expression (for display); parentheses only where precedence needs them. */
export function formatExpr(e: Expr, parent = 0): string {
  switch (e.t) {
    case 'num': return String(e.v);
    case 'str': return JSON.stringify(e.v);
    case 'bool': return String(e.v);
    case 'list': return `[${e.items.map(a => formatExpr(a)).join(', ')}]`;
    case 'var': return e.name;
    case 'call': return `${e.name}(${e.args.map(a => formatExpr(a)).join(', ')})`;
    case 'un': return e.op === 'not' ? `not ${formatExpr(e.e, 6)}` : `-${formatExpr(e.e, 6)}`;
    case 'bin': {
      const p = PREC[e.op] ?? 3;
      const text = `${formatExpr(e.l, p)} ${e.op} ${formatExpr(e.r, p + 1)}`;
      return p < parent ? `(${text})` : text;
    }
  }
}

/** Parses text typed into the editor's variables panel: true/false, a number, a quoted string, else the raw text. */
export function parseVarValue(text: string): Value {
  const t = text.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t !== '' && /^-?(?:[0-9]*\.)?[0-9]+$/.test(t)) return Number(t);
  if (t.startsWith('[')) {
    try {
      const v: unknown = JSON.parse(t);
      if (Array.isArray(v) && v.every(x => ['number', 'string', 'boolean'].includes(typeof x))) return v as Scalar[];
    } catch { /* not JSON: falls through to the raw text */ }
  }
  const q = /^(["'])([\s\S]*)\1$/.exec(t);
  return q ? q[2].replace(/\\([\s\S])/g, '$1') : text;
}

/** Functions whose first argument must be a list. */
const LIST_FUNCTIONS = new Set(['contains', 'count', 'item', 'index']);

/** Names of variables used directly as the list argument of `contains`, `count`, `item` or `index`. */
export function listArgs(e: Expr, out: Set<string> = new Set()): Set<string> {
  switch (e.t) {
    case 'call':
      if (LIST_FUNCTIONS.has(e.name) && e.args[0]?.t === 'var') out.add(e.args[0].name);
      for (const a of e.args) listArgs(a, out);
      break;
    case 'list': for (const a of e.items) listArgs(a, out); break;
    case 'un': listArgs(e.e, out); break;
    case 'bin': listArgs(e.l, out); listArgs(e.r, out); break;
  }
  return out;
}
