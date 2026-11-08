// The animation studio's focus in Model mode (docs/design/studio-focus-and-verbs.md). The studio keeps two fields, the active control (a
// parameter id or `pad:<id>`) and the chosen part; the focus is what they make together: a control alone is a parameter focus, a part alone
// a part focus, both a keyform focus (the part at the slider's value on that parameter). Pure: the transitions between the three, what a pick
// may land on, the cycle through overlapping parts under repeated clicks, and the breadcrumb text. The studio (editor/) holds the state.

export type FocusKind = 'none' | 'param' | 'part' | 'keyform';
export interface FocusState { control: string | null; part: string | null }

export const focusKind = (s: FocusState): FocusKind => (s.control !== null ? (s.part !== null ? 'keyform' : 'param') : s.part !== null ? 'part' : 'none');

/**
 * A part was chosen (stage click, tree row, bound-parts row; null: nothing). A part bound to the active control stays under it, as a keyform
 * focus; any other part replaces the control, so there is never a second, unrelated selection. Nothing chosen keeps the control.
 */
export function afterChoosePart(s: FocusState, part: string | null, boundTo: (part: string, control: string) => boolean): FocusState {
  if (part === null) return { control: s.control, part: null };
  return s.control !== null && boundTo(part, s.control) ? { control: s.control, part } : { control: null, part };
}

/**
 * A control was chosen (a click on its name in the palette, or a "Moved by" button). The rule is the mirror of `afterChoosePart`: the part stays when it is
 * bound to the control (a keyform focus), otherwise the control replaces it. Null clears the control.
 */
export function afterChooseControl(s: FocusState, control: string | null, boundTo: (part: string, control: string) => boolean): FocusState {
  if (control === null) return { control: null, part: s.part };
  return s.part !== null && boundTo(s.part, control) ? { control, part: s.part } : { control, part: null };
}

/** A word of the breadcrumb was clicked: go up to the part alone or to the control alone. */
export const goUp = (s: FocusState, to: 'part' | 'param'): FocusState => (to === 'param' ? { control: s.control, part: null } : { control: null, part: s.part });

export interface Crumb { text: string; /** where a click goes; null: not a button */ up: 'part' | 'param' | null }
export interface Breadcrumb { crumbs: Crumb[]; /** After the crumbs: whether a key is at the value. */ status: string }

/** The line over the stage and above the right column. `keyed`: is there a key of the part at the value (null: not asked, a parameter or part focus). */
export function breadcrumb(s: FocusState, controlName: string, valueText: string, keyed: boolean | null): Breadcrumb {
  const kind = focusKind(s);
  if (kind === 'none') return { crumbs: [], status: '' };
  if (kind === 'param') return { crumbs: [{ text: controlName, up: null }], status: '' };
  if (kind === 'part') return { crumbs: [{ text: s.part!, up: null }], status: '' };
  return {
    crumbs: [{ text: s.part!, up: 'part' }, { text: controlName, up: 'param' }, { text: `@ ${valueText}`, up: null }],
    status: keyed === null ? '' : keyed ? 'key' : 'no key here: a drag adds one',
  };
}

export type PickVerb = 'bindParts' | 'bindToParam' | 'copyKeys';

/**
 * What a pick may land on, from `all` (the parts, or for `bindToParam` the controls). `bound`: the ones already bound (to the control, or to the
 * part); `withKeys`: the parts that have keys of the kind; `self`: the chosen part, which is no source for its own keys.
 */
export function pickTargets(verb: PickVerb, all: readonly string[], bound: ReadonlySet<string>, withKeys: ReadonlySet<string> = new Set(), self: string | null = null): string[] {
  if (verb === 'copyKeys') return all.filter(p => p !== self && withKeys.has(p));
  return all.filter(p => !bound.has(p));
}

/** The state of a run of clicks on one spot. */
export interface CycleState { point: [number, number]; list: string[]; index: number }
export interface CycleResult {
  /** The part this click takes; null when no candidate is under the pointer and nothing is hit at all. */
  part: string | null;
  /** The candidates were empty and the frontmost hit was taken instead. */
  fallback: boolean;
  /** Where in the cycle this is (1-based) out of how many; `count` 1 means there is nothing to cycle. */
  position: number;
  count: number;
  state: CycleState | null;
}

/**
 * Clicks on the same spot (within `tol` px of where the run began) walk through the parts under the pointer, front to back, wrapping. `hits` are
 * all the parts there; `candidates` limits them (the parts bound to the parameter in focus), null for every one. With no candidate under the
 * pointer the frontmost hit is taken as a plain part (`fallback`).
 */
export function cycleHit(hits: readonly string[], candidates: ReadonlySet<string> | null, last: CycleState | null, point: [number, number], tol = 4): CycleResult {
  const list = candidates ? hits.filter(h => candidates.has(h)) : [...hits];
  if (!list.length) return { part: hits[0] ?? null, fallback: hits.length > 0, position: 1, count: hits.length ? 1 : 0, state: null };
  const same = last !== null && Math.hypot(last.point[0] - point[0], last.point[1] - point[1]) <= tol && last.list.length === list.length && last.list.every((p, i) => p === list[i]);
  const index = same ? (last.index + 1) % list.length : 0;
  return { part: list[index]!, fallback: false, position: index + 1, count: list.length, state: { point: same ? last.point : point, list, index } };
}

/** The line over the stage while a cycle has more than one part: "Arm_L, 2 of 3. Click again for the next." */
export const cycleLabel = (r: CycleResult): string => (r.part !== null && r.count > 1 ? `${r.part}, ${r.position} of ${r.count}. Click again for the next.` : '');
