// What one step of the animation studio's undo history changed, in words, and where it is (docs/design/studio-undo.md). The history
// keeps snapshots of the whole working copy (StudioDoc); this names the difference between two of them so undo and redo can go to the
// change and say it. Pure, no DOM.

import type { AnimDef } from './anim.js';
import type { StudioDoc } from './studio-doc.js';

/** Where a change shows: the mode (null: both modes show it), and the animation and part when there is one. */
export interface ChangePlace { mode: 'animate' | 'model' | null; anim?: string; part?: string }
export interface ChangeLabel extends ChangePlace { label: string }

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const fmtS = (s: number | undefined) => `${+(s ?? 1).toFixed(3)} s`;

/** The names a record gained, lost, and has in both but changed. */
function diffRecord<T>(a: Record<string, T> | undefined, b: Record<string, T> | undefined) {
  const x = a ?? {}, y = b ?? {};
  const added = Object.keys(y).filter(k => !Object.hasOwn(x, k)), removed = Object.keys(x).filter(k => !Object.hasOwn(y, k));
  const changed = Object.keys(y).filter(k => Object.hasOwn(x, k) && !same(x[k], y[k]));
  return { added, removed, changed };
}
/** A list by a key of its items, as a record (a later item with the same key wins). */
const byKey = <T>(list: readonly T[] | undefined, key: (t: T) => string) => Object.fromEntries((list ?? []).map(t => [key(t), t]));

/** `what` added, removed or changed for one name of a record diff; null when the diff is empty. */
function oneOf(d: ReturnType<typeof diffRecord>, what: string): { label: string; name: string } | null {
  const n = d.added.length + d.removed.length + d.changed.length;
  if (!n) return null;
  if (n > 1) return { label: `${n} ${what}s`, name: d.changed[0] ?? d.added[0] ?? d.removed[0] };
  if (d.added.length) return { label: `${what} ${d.added[0]} added`, name: d.added[0] };
  if (d.removed.length) return { label: `${what} ${d.removed[0]} removed`, name: d.removed[0] };
  return { label: `${what} ${d.changed[0]}`, name: d.changed[0] };
}

/** Keys of one part changed with none added or removed: `key on arm changed`, or for a group edit (AN-13) `3 keys moved on arm`. */
function several(a: unknown[] = [], b: unknown[] = [], who: string): string {
  const fresh = b.filter(x => !a.some(y => same(x, y)));
  if (fresh.length < 2) return `key on ${who} changed`;
  const timeless = (k: unknown) => JSON.stringify({ ...(k as object), t: 0 });
  const moved = fresh.every(x => a.some(y => !b.some(z => same(y, z)) && timeless(x) === timeless(y)));
  return `${fresh.length} keys ${moved ? 'moved' : 'changed'} on ${who}`;
}

/** What changed inside one animation. */
function describeAnim(name: string, a: AnimDef, b: AnimDef): ChangeLabel {
  const at = (label: string, part?: string): ChangeLabel => ({ label: `${name}: ${label}`, mode: 'animate', anim: name, ...(part ? { part } : {}) });
  if (!same(a.dur, b.dur)) return at(`Length ${fmtS(a.dur)} → ${fmtS(b.dur)}`);
  const parts = (d: AnimDef) => {
    const m: Record<string, unknown[]> = {};
    for (const k of d.keys ?? []) (m[k.part ?? ''] ??= []).push(k);
    return m;
  };
  const pa = parts(a), pb = parts(b), touched = [...new Set([...Object.keys(pa), ...Object.keys(pb)])].filter(p => !same(pa[p], pb[p]));
  if (touched.length === 1) {
    const p = touched[0], who = p || 'the whole character', na = pa[p]?.length ?? 0, nb = pb[p]?.length ?? 0;
    // A key whose only change is its ease says so (AN-10): `ease of the key at 0.5 s on arm_r`.
    const eased = nb === na ? (pa[p] ?? []).findIndex((k, i) => !same(k, pb[p]![i]) && same({ ...(k as object), ease: undefined }, { ...(pb[p]![i] as object), ease: undefined })) : -1;
    const at1 = eased >= 0 ? (pb[p]![eased] as { t?: number }).t : undefined;
    // One key added or removed says at what time, so steps in a row read apart (AN-9).
    const one = (from: unknown[] = [], to: unknown[] = []) => { const k = to.find(x => !from.some(y => same(x, y))) as { t?: number } | undefined; return k?.t === undefined ? '' : ` at ${+(k.t * ((nb > na ? b : a).dur ?? 1)).toFixed(2)} s`; };
    const what = nb > na ? `${nb - na === 1 ? `key${one(pa[p], pb[p])}` : `${nb - na} keys`} added on ${who}` : nb < na ? `${na - nb === 1 ? `key${one(pb[p], pa[p])}` : `${na - nb} keys`} removed on ${who}`
      : eased >= 0 ? `ease of the key${at1 === undefined ? '' : ` at ${+(at1 * (b.dur ?? 1)).toFixed(2)} s`} on ${who}` : several(pa[p], pb[p], who);
    return at(what, p || undefined);
  }
  if (touched.length > 1) return at(`keys on ${touched.length} parts`);
  const tracks = diffRecord(a.params, b.params);
  const t = oneOf(tracks, 'track');
  if (t) return at(tracks.added.length + tracks.removed.length + tracks.changed.length === 1 ? `${t.name} track` : t.label);
  if (!same(a.frames, b.frames)) {
    const fa = byKey(a.frames, f => f.slot), fb = byKey(b.frames, f => f.slot), d = diffRecord(fa, fb), slot = d.changed[0] ?? d.added[0] ?? d.removed[0];
    return at(slot ? `frames of ${slot}` : 'frames', slot);
  }
  if (!same(a.auto, b.auto)) return at('Automatic');
  return at('edited');
}

/** Model-mode areas, in the order a change spanning several is named by (the cause first: a bone removed also changes weights). */
const AREAS: { key: keyof StudioDoc; mode: ChangePlace['mode']; name: (a: StudioDoc, b: StudioDoc) => { label: string; part?: string } | null }[] = [
  { key: 'bones', mode: 'model', name: (a, b) => { const o = oneOf(diffRecord(a.bones, b.bones), 'bone'); return o && { label: o.label, part: o.name }; } },
  { key: 'parameters', mode: null, name: (a, b) => {
    const pa = byKey(a.parameters, p => p.id), pb = byKey(b.parameters, p => p.id), d = diffRecord(pa, pb);
    // A rename is one parameter gone and one come with the same fields (MR-8: "2 parameters" read like two removed).
    if (d.added.length === 1 && d.removed.length === 1 && !d.changed.length && same({ ...pa[d.removed[0]], id: '' }, { ...pb[d.added[0]], id: '' }))
      return { label: `parameter ${d.removed[0]} renamed ${d.added[0]}` };
    if (d.changed.length === 1 && !d.added.length && !d.removed.length) {
      const x = pa[d.changed[0]] as unknown as Record<string, unknown>, y = pb[d.changed[0]] as unknown as Record<string, unknown>;
      const fields = ['min', 'max', 'default', 'group', 'ease'].filter(f => !same(x[f], y[f]));
      if (fields.length === 1) return { label: `${d.changed[0]} ${fields[0] === 'group' ? 'group' : fields[0]} ${x[fields[0]] ?? '(none)'} → ${y[fields[0]] ?? '(none)'}` };
    }
    return oneOf(d, 'parameter');
  } },
  { key: 'deformers', mode: 'model', name: (a, b) => {
    const da = byKey(a.deformers, d => d.id), db = byKey(b.deformers, d => d.id), diff = diffRecord(da, db), o = oneOf(diff, 'deformer');
    if (!o) return null;
    const part = (db[o.name] ?? da[o.name])?.part;
    // One deformer changed: say how (MD-10), a key added or removed, its mesh, its members, or its points.
    if (diff.changed.length === 1 && !diff.added.length && !diff.removed.length) {
      const x = da[o.name], y = db[o.name], keys = (d: typeof x) => (d.keyforms ?? []).reduce((n, k) => n + (k.keys?.length ?? 0), 0);
      const label = keys(y) > keys(x) ? `key added to ${o.name}` : keys(y) < keys(x) ? `key removed from ${o.name}`
        : !same(x.mesh?.weights, y.mesh?.weights) ? `weights of ${o.name}` : !same(x.mesh, y.mesh) ? `mesh of ${o.name}`
        : !same(x.members, y.members) ? `members of ${o.name}` : `points of ${o.name}`;
      return { label, part };
    }
    return { label: o.label, part };
  } },
  { key: 'keyforms', mode: 'model', name: (a, b) => {
    const k = (f: StudioDoc['keyforms'][number]) => `${f.target} on ${f.param ?? (f.params ?? []).join(' and ')}`;
    const ka = byKey(a.keyforms, k), kb = byKey(b.keyforms, k), diff = diffRecord(ka, kb), o = oneOf(diff, 'keyform');
    if (!o) return null;
    const part = (kb[o.name] ?? ka[o.name])?.target;
    // One keyform changed: a key added, removed, or the pose at one key (MR-8: the three read the same).
    if (diff.changed.length === 1 && !diff.added.length && !diff.removed.length) {
      const x = ka[o.name], y = kb[o.name], xs = x.keys ?? [], ys = y.keys ?? [];
      if (ys.length > xs.length) { const n = ys.find(t => !xs.some(u => u.at === t.at)); return { label: `key of ${o.name}${n ? ` at ${n.at}` : ''} added`, part }; }
      if (ys.length < xs.length) { const n = xs.find(t => !ys.some(u => u.at === t.at)); return { label: `key of ${o.name}${n ? ` at ${n.at}` : ''} removed`, part }; }
      const i = ys.findIndex((t, j) => !same(t, xs[j]));
      if (i >= 0) return { label: `pose of ${o.name} at ${ys[i].at}`, part };
      if (!same(x.grid, y.grid)) return { label: `grid of ${o.name}`, part };
      return { label: `pose of ${o.name} at a corner`, part };
    }
    return { label: o.label.replace(/^keyform (.*) (added|removed)$/, 'keyform of $1 $2').replace(/^keyform (?!of )(.*)$/, 'keyform of $1'), part };
  } },
  { key: 'pivots', mode: 'model', name: (a, b) => { const o = oneOf(diffRecord(a.pivots, b.pivots), 'pivot'); return o && { label: o.label.replace(/^pivot (\S+)$/, 'pivot of $1'), part: o.name }; } },
  { key: 'parts', mode: 'model', name: (a, b) => { const o = oneOf(diffRecord(a.parts as Record<string, unknown>, b.parts as Record<string, unknown>), 'part'); return o && { label: `bone of ${o.name}`, part: o.name }; } },
  { key: 'physics', mode: 'model', name: (a, b) => oneOf(diffRecord(a.physics, b.physics), 'physics chain') },
  { key: 'reactions', mode: 'model', name: () => ({ label: 'reactions' }) },
  { key: 'poses', mode: null, name: (a, b) => oneOf(diffRecord(a.poses, b.poses), 'pose') },
  { key: 'looks', mode: null, name: (a, b) => oneOf(diffRecord(a.looks, b.looks), 'look') },
  { key: 'shapes', mode: 'model', name: (a, b) => oneOf(diffRecord(a.shapes, b.shapes), 'mask shape') },
  { key: 'clips', mode: 'model', name: (a, b) => { const o = oneOf(diffRecord(a.clips, b.clips), 'clip'); return o && { label: `clip of ${o.name}`, part: o.name }; } },
  { key: 'pads', mode: null, name: (a, b) => oneOf(diffRecord(byKey(a.pads, p => p.id), byKey(b.pads, p => p.id)), 'pad') },
  { key: 'categories', mode: null, name: () => ({ label: 'parameter groups' }) },
];

/** The change from `before` to `after`, named for undo and redo: `wave: Length 1.1 s → 3 s`, `bone forearm_l removed`. */
export function describeChange(before: StudioDoc, after: StudioDoc): ChangeLabel {
  for (const area of AREAS.slice(0, 2)) if (!same(before[area.key], after[area.key])) return named(area, before, after);
  if (!same(before.anims, after.anims)) {
    const d = diffRecord(before.anims, after.anims);
    if (d.added.length === 1 && d.removed.length === 1 && !d.changed.length && same(before.anims[d.removed[0]], after.anims[d.added[0]]))
      return { label: `animation ${d.removed[0]} renamed ${d.added[0]}`, mode: 'animate', anim: d.added[0] };
    if (d.added.length === 1 && !d.removed.length && !d.changed.length) return { label: `new animation ${d.added[0]}`, mode: 'animate', anim: d.added[0] };
    if (d.removed.length === 1 && !d.added.length && !d.changed.length) return { label: `deleted animation ${d.removed[0]}`, mode: 'animate', anim: d.removed[0] };
    if (d.changed.length === 1 && !d.added.length && !d.removed.length) return describeAnim(d.changed[0], before.anims[d.changed[0]], after.anims[d.changed[0]]);
    return { label: `${d.added.length + d.removed.length + d.changed.length} animations`, mode: 'animate' };
  }
  for (const area of AREAS.slice(2)) if (!same(before[area.key], after[area.key])) return named(area, before, after);
  return { label: 'an edit', mode: null };
}

function named(area: (typeof AREAS)[number], a: StudioDoc, b: StudioDoc): ChangeLabel {
  const n = area.name(a, b) ?? { label: `edit in ${String(area.key)}` };
  return { label: n.label, mode: area.mode, ...('part' in n && n.part ? { part: n.part } : {}) };
}
