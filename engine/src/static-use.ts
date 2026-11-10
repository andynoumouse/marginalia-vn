// Static analysis for the playtest report: which variables and assets nothing in the program uses.

import { collectVars, type Expr } from './expr.js';
import { assetContext, imageKey, opAssets, screenAssets, type AssetIndex } from './assets.js';
import { isClickable, shellEntryFields, walkNodes, shellVars, type ScreenNode } from './screens.js';
import type { Program, Src } from './types.js';
import { AUDIO_FILE, IMAGE_FILE } from './asset-kinds.js';

const TEXT_VAR = /\[([\p{L}_][\p{L}\p{N}\p{M}_]*(?:\.[\p{L}_][\p{L}\p{N}\p{M}_]*)?)(?::[^\][]+)?\]/gu;

/** Variables each statement reads and writes, with the first place each is met. */
export function variableUse(program: Program): { reads: Map<string, Src>; exprReads: Map<string, Src>; writes: Map<string, Src>; unlocks: Map<string, Src> } {
  const reads = new Map<string, Src>(), exprReads = new Map<string, Src>(), writes = new Map<string, Src>(), unlocks = new Map<string, Src>();
  const read = (name: string, src: Src, inText = false) => {
    if (!reads.has(name)) reads.set(name, src);
    if (!inText && !exprReads.has(name)) exprReads.set(name, src); // "[name]" in text that is no variable is shown as written, so it proves nothing
  };
  const write = (name: string, src: Src) => { if (!writes.has(name)) writes.set(name, src); };
  const expr = (e: Expr | null | undefined, src: Src, local?: Set<string>) => {
    if (e) for (const v of collectVars(e)) if (!local?.has(v)) read(v, src);
  };
  const text = (s: string | undefined, src: Src, local?: Set<string>) => {
    for (const m of (s ?? '').matchAll(TEXT_VAR)) if (!local?.has(m[1])) read(m[1], src, true);
  };
  for (const op of program.ops) {
    switch (op.op) {
      case 'say': text(op.text, op.src); break;
      case 'input': write(op.name, op.src); text(op.prompt, op.src); break;
      case 'screen': write(op.as, op.src); for (const a of op.args ?? []) expr(a, op.src); for (const o of op.outs ?? []) if (o) write(o, op.src); break;
      case 'set': write(op.name, op.src); expr(op.expr, op.src); break;
      case 'call': // the arguments are read at the call, the parameters are written by it
        for (const a of op.args ?? []) expr(a, op.src);
        for (const n of program.params?.[op.label] ?? []) write(n, op.src);
        break;
      case 'branch': expr(op.cond, op.src); break;
      case 'unlock': if (!unlocks.has(op.name)) unlocks.set(op.name, op.src); break;
      case 'menu':
        if (op.prompt) text(op.prompt, op.src);
        if (op.timeout) expr(op.timeout.seconds, op.src);
        for (const o of op.options) { expr(o.cond, op.src); text(o.text, op.src); if (o.reason) text(o.reason, op.src); }
        break;
    }
  }
  let screen = '';
  const walk = (nodes: ScreenNode[], local: Set<string>) => {
    for (const n of nodes) {
      expr(n.cond, n.src, local);
      if (isClickable(n)) { expr(n.enabled, n.src, local); text(n.label, n.src, local); for (const h of Object.values(n.sets ?? {})) expr(h.expr, n.src, local); if (n.body) walk(n.body, local); }
      else if (n.kind === 'text') text(n.text, n.src, local);
      else if (n.kind === 'layout' || n.kind === 'scroll' || n.kind === 'panel') walk(n.body, local);
      else if (n.kind === 'bar') { expr(n.value, n.src, local); expr(n.min, n.src, local); expr(n.max, n.src, local); }
      else if (n.kind === 'each') {
        if (!local.has(n.list)) read(n.list, n.src);
        walk(n.body, new Set([...local, n.as, `${n.as}.name`, `${n.as}.image`, `${n.as}.index`, ...shellEntryFields(screen).map(f => `${n.as}.${f}`)]));
      }
    }
  };
  for (const def of Object.values(program.screens ?? {})) {
    // the shell fills these in on the options and saves screens: they are not story variables
    screen = def.name;
    for (const d of def.states ?? []) expr(d.expr, d.src, new Set([...shellVars(def.name), ...(def.params ?? []), ...(def.states ?? []).map(o => o.name)]));
    walk(def.body, new Set([...shellVars(def.name), ...(def.params ?? []), ...(def.states ?? []).map(d => d.name)]));
  }
  return { reads, exprReads, writes, unlocks };
}

// ---- static analysis: assets ----

const stem = (f: string) => f.replace(/\.[^./]+$/, '');

/** Every string anywhere in a JSON value. */
export function strings(v: unknown, out: Set<string> = new Set()): Set<string> {
  if (typeof v === 'string') out.add(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.add(k); strings(x, out); }
  return out;
}

/** Asset files (images, music, sounds) that nothing in the program or game.json names. */
export function unusedAssets(program: Program, index: AssetIndex, game: unknown = null): string[] {
  const ctx = assetContext(index);
  const used = new Set<string>(); // asset keys: file path without extension
  const wild: RegExp[] = [];      // dynamic names ("item_[n]") match like a glob
  const addFile = (file: string | null | undefined) => {
    if (!file) return;
    if (file.includes('[')) {
      wild.push(new RegExp(`^${file.replace(IMAGE_FILE, '').split(/\[[^\]]*\]/).map(s => s.replace(/[.*+?^${}()|\\]/g, '\\$&')).join('.*')}$`));
      return;
    }
    const k = imageKey(file, ctx);
    if (k) used.add(k);
  };
  const shown = new Set<string>();
  for (const op of program.ops) {
    for (const k of opAssets(op, ctx, program)) used.add(k);
    if (op.op === 'image' && op.action === 'show') addFile(op.file);
    if (op.op === 'show') shown.add(op.char);
  }
  for (const name of Object.keys(program.screens ?? {})) for (const k of screenAssets(program, name, ctx)) used.add(k);
  const visit = (n: ScreenNode) => {
    if (n.kind === 'image') addFile(n.file);
    if (n.kind === 'panel' && n.file) addFile(n.file);
    if (n.kind === 'bar') { if (n.back) addFile(n.back); if (n.fill) addFile(n.fill); }
    if (isClickable(n) && n.fx.sound && ctx.has(`sound/${n.fx.sound}`)) used.add(`sound/${n.fx.sound}`);
  };
  for (const def of Object.values(program.screens ?? {})) if (!def.src.file.startsWith('stock/')) walkNodes(def.body, visit); // a starter's "[file]" would match everything
  for (const it of Object.values(program.items ?? {})) addFile(it.image);
  for (const c of Object.values(program.characters)) if (c.style.blip && ctx.has(`sound/${c.style.blip}`)) used.add(`sound/${c.style.blip}`);

  // game.json names assets as bare strings (title background, gallery images, music room tracks...): any string that
  // is a file's name, key or stem counts, which errs on the side of calling a file used.
  const named = strings(game);

  return index.files.filter(f => {
    const parts = f.split('/');
    const image = IMAGE_FILE.test(f), audio = AUDIO_FILE.test(f);
    if (!image && !audio) return false;
    const key = stem(f);
    if (used.has(key) || wild.some(w => w.test(key))) return false;
    if (parts[0] === 'char' && parts.length >= 3) return !shown.has(parts[1]); // layers of a character that is shown are used as it poses
    if (audio && parts.length !== 2) return false;
    const name = parts[parts.length - 1];
    return !(named.has(f) || named.has(key) || named.has(name) || named.has(stem(name)));
  });
}
