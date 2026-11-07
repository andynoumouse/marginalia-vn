// Copying the keys of one binding onto another, optionally mirrored: the left eye's blink onto the right eye, one parameter's poses onto
// a second parameter, the left half of a pad onto its right. Pose keyforms only (a slider's `keys`, a pad's `grid` + `forms`). Pure; the
// studio calls it and keeps the result as one undo step.

import type { FormValue, KeyformDef, ParamDef } from './params.js';
import type { BindDriver } from './param-bind.js';

export interface CopyOptions {
  /** Mirror the poses sideways: x moves and rotations change sign. Scale and opacity stay. */
  flip?: boolean;
  /** Mirror the parameter axis too (the pad's x axis, or a slider): a key at the minimum lands at the maximum. */
  reverse?: boolean;
}

export interface CopyEnd { target: string; driver: BindDriver }

const DECIMALS = 1e5;
const clean = (n: number): number => Math.round(n * DECIMALS) / DECIMALS + 0;
const defOf = (defs: readonly ParamDef[], id: string): ParamDef | undefined => defs.find(d => d.id === id);

/** A value of parameter `from` as the matching value of `to`: the same when they are one parameter, else side by side of the default (min, default and max line up). */
export function mapValue(from: ParamDef, to: ParamDef, v: number, reverse = false): number {
  const w = reverse ? from.min + from.max - v : v; // reflect across the middle of the range
  const line = (a: number, b: number, c: number, d: number) => (b === a ? c : c + ((w - a) / (b - a)) * (d - c));
  const out = from.id === to.id ? w : w <= from.default ? line(from.min, from.default, to.min, to.default) : line(from.default, from.max, to.default, to.max);
  return clean(Math.min(to.max, Math.max(to.min, out)));
}

const flipForm = (f: FormValue, flip: boolean): FormValue => {
  if (!flip) return { ...f };
  const o: FormValue = { ...f };
  if (o.dx) o.dx = -o.dx;
  if (o.rot) o.rot = -o.rot;
  return o;
};

const isPad = (d: BindDriver): d is { params: [string, string] } => 'params' in d;

/**
 * The keyforms with `to`'s pose keys replaced by `from`'s, mapped to the destination parameters and optionally mirrored. Any other keyform
 * of the destination target stays. `copied` is false (nothing changes) when the source is not bound, a parameter is unknown, the two ends are
 * not the same kind (slider and pad), or source and destination are one and the same binding without a mirror.
 */
export function copyKeys(kfs: readonly KeyformDef[], defs: readonly ParamDef[], from: CopyEnd, to: CopyEnd, opt: CopyOptions = {}): { keyforms: KeyformDef[]; copied: boolean } {
  const same = { keyforms: kfs as KeyformDef[], copied: false };
  if (isPad(from.driver) !== isPad(to.driver)) return same;
  const src = kfs.find(k => k.target === from.target && (isPad(from.driver)
    ? k.params?.[0] === from.driver.params[0] && k.params?.[1] === from.driver.params[1] && k.grid && k.forms
    : k.param === (from.driver as { param: string }).param && k.keys));
  if (!src) return same;
  const flip = !!opt.flip, reverse = !!opt.reverse;
  let made: KeyformDef;
  if (isPad(to.driver) && isPad(from.driver) && src.grid && src.forms && src.params) {
    const sx = defOf(defs, src.params[0]), sy = defOf(defs, src.params[1]), dx = defOf(defs, to.driver.params[0]), dy = defOf(defs, to.driver.params[1]);
    if (!sx || !sy || !dx || !dy || dx === dy) return same;
    if (from.target === to.target && from.driver.params[0] === to.driver.params[0] && from.driver.params[1] === to.driver.params[1] && !flip && !reverse) return same;
    const xs = src.grid.x, ys = src.grid.y, cells: { x: number; y: number; f: FormValue }[] = [];
    ys.forEach((y, j) => xs.forEach((x, i) => cells.push({ x: mapValue(sx, dx, x, reverse), y: mapValue(sy, dy, y), f: flipForm(src.forms![j * xs.length + i] ?? {}, flip) })));
    const gx = [...new Set(cells.map(c => c.x))].sort((a, b) => a - b), gy = [...new Set(cells.map(c => c.y))].sort((a, b) => a - b);
    const forms: FormValue[] = Array.from({ length: gx.length * gy.length }, () => ({}));
    for (const c of cells) forms[gy.indexOf(c.y) * gx.length + gx.indexOf(c.x)] = c.f;
    made = { target: to.target, params: [dx.id, dy.id], grid: { x: gx, y: gy }, forms };
  } else if (!isPad(to.driver) && !isPad(from.driver) && src.keys) {
    const sd = defOf(defs, src.param!), dd = defOf(defs, to.driver.param);
    if (!sd || !dd) return same;
    if (from.target === to.target && sd.id === dd.id && !flip && !reverse) return same;
    const byAt = new Map<number, FormValue>();
    // An ease belongs to the way a key is reached from the one before it, so a reversed axis drops it.
    for (const k of src.keys) { const { at, ease, ...f } = k; byAt.set(mapValue(sd, dd, at, reverse), { ...flipForm(f, flip), ...(ease && !reverse ? { ease } : {}) } as FormValue); }
    made = { target: to.target, param: dd.id, keys: [...byAt].sort((a, b) => a[0] - b[0]).map(([at, f]) => ({ at, ...f })) };
  } else return same;
  const isDest = (k: KeyformDef) => k.target === to.target && (isPad(to.driver)
    ? k.params?.[0] === to.driver.params[0] && k.params?.[1] === to.driver.params[1] && !!k.grid
    : k.param === (to.driver as { param: string }).param && !!k.keys);
  const out = (structuredClone(kfs) as KeyformDef[]);
  const at = out.findIndex(isDest);
  if (at >= 0) out[at] = made; else out.push(made);
  return { keyforms: out, copied: true };
}
