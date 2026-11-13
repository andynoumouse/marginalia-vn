// Edits of several timeline keys at once (docs/design/timeline-multi-select.md, UX round 3 AN-13): the channel keys of
// `animations.<name>.keys` and the parameter keys of `.params`, chosen together and moved, deleted or eased as one. Pure.

import type { AnimDef, KeyDef, ParamKey } from './anim.js';
import { byTime, clamp01, round4 } from './util.js';

/** A chosen key: a channel key (all its channels) by its index in `keys`, or a parameter key by its track and index. */
export type KeyRef = { kind: 'key'; index: number } | { kind: 'param'; id: string; index: number };

/** A key's reference as a string, for sets and the timeline's diamonds: `k:3`, `p:look_x:1`. */
export const refId = (r: KeyRef): string => (r.kind === 'key' ? `k:${r.index}` : `p:${r.id}:${r.index}`);

/** The keys `refs` point at that exist in `def`, each once. */
export function liveRefs(def: AnimDef, refs: readonly KeyRef[]): KeyRef[] {
  const seen = new Set<string>();
  return refs.filter(r => {
    const id = refId(r), ok = r.kind === 'key' ? !!def.keys?.[r.index] : !!def.params?.[r.id]?.[r.index];
    if (!ok || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

const timeOf = (def: AnimDef, r: KeyRef): number => (r.kind === 'key' ? def.keys[r.index].t : def.params![r.id][r.index].t);

/**
 * `dt` (a fraction of the animation) clamped so that every chosen key stays within 0..1: the group stops at an edge as one, and the
 * keys keep their spacing.
 */
export function groupShift(def: AnimDef, refs: readonly KeyRef[], dt: number): number {
  const ts = liveRefs(def, refs).map(r => timeOf(def, r));
  if (!ts.length) return 0;
  return Math.min(1 - Math.max(...ts), Math.max(-Math.min(...ts), dt));
}

/**
 * Every chosen key moved by `dt` in time, clamped as a group (`groupShift`). The lists are sorted again; the result's `refs` point at
 * the same keys in their new places, in the order given.
 */
export function moveKeys(def: AnimDef, refs: readonly KeyRef[], dt: number): { def: AnimDef; refs: KeyRef[] } {
  const live = liveRefs(def, refs), d = groupShift(def, live, dt);
  if (!live.length || d === 0) return { def, refs: live };
  const keys = [...(def.keys ?? [])], tracks: Record<string, ParamKey[]> = {};
  const moved = new Map<string, KeyDef | ParamKey>();
  for (const r of live) {
    if (r.kind === 'key') { const k = { ...keys[r.index], t: round4(clamp01(keys[r.index].t + d)) }; keys[r.index] = k; moved.set(refId(r), k); }
    else {
      const list = tracks[r.id] ??= [...def.params![r.id]];
      const k = { ...list[r.index], t: round4(clamp01(list[r.index].t + d)) };
      list[r.index] = k;
      moved.set(refId(r), k);
    }
  }
  const sortedKeys = byTime(keys), sortedTracks = Object.fromEntries(Object.entries(tracks).map(([id, l]) => [id, byTime(l)]));
  const out: AnimDef = { ...def, keys: sortedKeys, ...(Object.keys(sortedTracks).length ? { params: { ...def.params, ...sortedTracks } } : {}) };
  return {
    def: out,
    refs: live.map(r => (r.kind === 'key'
      ? { kind: 'key' as const, index: sortedKeys.indexOf(moved.get(refId(r)) as KeyDef) }
      : { kind: 'param' as const, id: r.id, index: sortedTracks[r.id].indexOf(moved.get(refId(r)) as ParamKey) })),
  };
}

/** `def` without the chosen keys; a parameter track left with none goes. */
export function deleteKeys(def: AnimDef, refs: readonly KeyRef[]): AnimDef {
  const live = liveRefs(def, refs);
  if (!live.length) return def;
  const gone = new Set(live.map(refId));
  const keys = (def.keys ?? []).filter((_, i) => !gone.has(`k:${i}`));
  const params: Record<string, ParamKey[]> = {};
  for (const [id, list] of Object.entries(def.params ?? {})) {
    const kept = list.filter((_, i) => !gone.has(`p:${id}:${i}`));
    if (kept.length) params[id] = kept;
  }
  const { params: _old, ...rest } = def;
  return { ...rest, keys, ...(Object.keys(params).length ? { params } : {}) };
}

/** `def` with every chosen key's ease set to `ease` (undefined: the default). */
export function setKeysEase(def: AnimDef, refs: readonly KeyRef[], ease: string | undefined): AnimDef {
  const live = liveRefs(def, refs);
  if (!live.length) return def;
  const set = <T extends { ease?: string }>(k: T): T => { const { ease: _e, ...rest } = k; return (ease === undefined ? rest : { ...rest, ease }) as T; };
  const keys = [...(def.keys ?? [])], params: Record<string, ParamKey[]> = { ...def.params };
  for (const r of live) {
    if (r.kind === 'key') keys[r.index] = set(keys[r.index]);
    else { params[r.id] = [...params[r.id]]; params[r.id][r.index] = set(params[r.id][r.index]); }
  }
  return { ...def, keys, ...(def.params ? { params } : {}) };
}
