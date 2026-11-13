// What the animation studio's tool options bar shows (docs/design/studio-inspector.md): the bar under the tool row holds the options of
// the tool in use, so its controls sit next to the stage instead of below the right column's fold. Pure: the studio (editor/anim-studio.ts,
// editor/anim-weights.ts) builds the controls and asks these rules which of them show, what the mode label and the gizmo line say, and
// what the brush keys do; and what the focus header over the right column shows: its pickers and its verbs by focus kind (editor/anim-bind.ts
// draws it), with a keyform's per-key operations; and which of the right column's sections a focus shows (the Parameter section for a
// parameter alone); and the Properties section's sub-blocks (`propBlocks`). The rules grow with each step of the plan.

import { BRUSH_NAMES, isPaintBrush, type StageTool, type WeightsBrush } from './studio-stage.js';
import { focusKind, type FocusKind, type PickVerb } from './studio-focus.js';
import { plural } from './util.js';

/** Which of the bar's panels a tool shows: Move, Rotate and Scale share the gizmo line. */
export type ToolBar = 'gizmo' | 'pivot' | 'warp' | 'weights' | 'mask';
export const toolBar = (tool: StageTool): ToolBar => (tool === 'move' || tool === 'rotate' || tool === 'scale' ? 'gizmo' : tool);

const TOOL_NAMES: Record<StageTool, string> = { move: 'Move', rotate: 'Rotate', scale: 'Scale', pivot: 'Pivot', warp: 'Warp', weights: 'Weights', mask: 'Mask' };

/**
 * The mode label at the bar's left end: the tool and what it works on, `Warp · torso`, `Weights · Add on hair_1_0` (the brush mode and the
 * active bone), `Mask · lid_shape`. `target` is the chosen part (null: none); `brush` and `bone` are the Weights tool's.
 */
/**
 * What the Warp tool still needs before a lattice drag can be kept, for the bar's label ('' when nothing): a lattice drag keys the warp to the
 * active slider, so with none active, or a pad, the drag is refused. `active` is the active control (null: none); `grid` names the warp when
 * it is already keyed to that pad's grid, which the stage shows but the studio cannot edit yet (docs/design/warp-pad-grid.md; MD-1): a key on
 * one of the pad's sliders would add on top of the grid, so the hint does not send the user there.
 */
export function warpBarHint(hasWarp: boolean, active: { name: string; pad: boolean; grid?: string | null } | null): string {
  if (!hasWarp) return '';
  if (!active) return "click a slider's name in Parameters, then drag the points: the drag keys the warp to it";
  if (active.pad && active.grid) return `${active.grid} is keyed to ${active.name}'s grid: shown, not editable in the studio yet`;
  return active.pad ? `${active.name} is a pad, and a lattice drag keys one slider: click a slider's name` : '';
}

export function modeLabel(tool: StageTool, target: string | null, brush?: WeightsBrush, bone?: string | null): string {
  const name = TOOL_NAMES[tool];
  if (tool === 'weights') {
    if (target === null) return `${name} · no mesh chosen`;
    return brush ? `${name} · ${BRUSH_NAMES[brush]}${bone ? ` on ${bone}` : ''}` : `${name} · ${target}`;
  }
  return target === null ? `${name} · nothing chosen` : `${name} · ${target}`;
}

/** What the Weights tool knows when it fills the bar. */
export interface WeightsBarState {
  /** The chosen part has a free mesh, and the rig has bones to weight it to. */
  hasMesh: boolean;
  /** Bones bound to the mesh. */
  bound: number;
  /** The brush mode the author chose (the stage reads only until a bone is bound). */
  brush: WeightsBrush;
  /** Does the mesh have weights (Mirror copies them)? */
  skinned: boolean;
  /** Has the stage measured the image (Mirror needs its middle)? */
  measured: boolean;
  /** Vertices selected. */
  selected: number;
  /** Is the skeleton in a test pose? */
  posed: boolean;
}

/** Which of the Weights bar's groups show and which of them can be used. */
export interface WeightsBarView {
  /** The brush modes and the active bone: shown with a mesh, usable once a bone is bound. */
  brush: boolean;
  brushOn: boolean;
  /** The radius and the strength: for the painting modes only (Read weights and Select do not paint). */
  paint: boolean;
  /** The test pose (Rotate, Move, Reset): a bone to pose is needed. */
  pose: boolean;
  reset: boolean;
  /** In Select mode, the selection operations: All, Invert always; None and Set value ▾ with a selection; Mirror ▾ with weights the stage has measured. */
  selection: boolean;
  none: boolean;
  setValue: boolean;
  mirror: boolean;
}

export function weightsBar(s: WeightsBarState): WeightsBarView {
  const bound = s.hasMesh && s.bound > 0, selection = bound && s.brush === 'select';
  return {
    brush: s.hasMesh, brushOn: bound, paint: s.hasMesh && isPaintBrush(s.brush),
    pose: bound, reset: bound && s.posed,
    selection, none: selection && s.selected > 0, setValue: selection && s.selected > 0, mirror: selection && s.skinned && s.measured,
  };
}

/** What the Warp tool knows when it fills the bar. */
export interface WarpBarState {
  /** The chosen row has a warp to edit (its own, or a group it is in). */
  hasWarp: boolean;
  /** The warp is a free mesh (no rows or columns to pick). */
  mesh: boolean;
  /** The mesh's Topology mode is on: its tools replace the keyform ones. */
  topo: boolean;
  /** The warp is keyed to an active parameter (the operations write its keyform at the slider's value). */
  keyed: boolean;
  /** Points chosen. */
  selected: number;
  /** A drag of the selection also pulls the points near it. */
  soft: boolean;
}

/** Which of the Warp bar's groups show and which of their controls can be used. */
export interface WarpBarView {
  /** All, None, Invert, Soft (and, on a lattice, the row and column pickers). */
  selection: boolean;
  rows: boolean;
  none: boolean;
  /** Reach and curve of a soft selection. */
  reach: boolean;
  /** Mirror, Smooth and the presets write the keyform: they need the active parameter. */
  operations: boolean;
  keyed: boolean;
  /** Mirror selection, Scale and Rotate act on the chosen points. */
  onSelection: boolean;
  /** The topology tools of a free mesh, in place of the rest. */
  topology: boolean;
  /** The Edit topology toggle, first in the bar: a free mesh only (it swaps what the bar holds, a mode of the tool). */
  topoToggle: boolean;
}

export function warpBar(s: WarpBarState): WarpBarView {
  const keyform = s.hasWarp && !s.topo;
  return {
    selection: keyform, rows: keyform && !s.mesh, none: keyform && s.selected > 0, reach: keyform && s.soft,
    operations: keyform, keyed: keyform && s.keyed, onSelection: keyform && s.keyed && s.selected > 0,
    topology: s.hasWarp && s.mesh && s.topo, topoToggle: s.hasWarp && s.mesh,
  };
}

/** What the Move, Rotate and Scale bar says it knows: the mode, the chosen row and what the gizmo poses for it, and what a drag would write. */
export interface GizmoLineState {
  mode: 'model' | 'animate';
  /** The chosen row (a part or a bone), null for none. */
  chosen: string | null;
  /** What the gizmo poses: the chosen row, or the bone a chosen part sits on (studio-focus.ts `poseTarget`). */
  subject: string | null;
  /** Model: the active parameter's name, null while none is picked. */
  param?: string | null;
  /** Model: is the subject bound to the active parameter by a pose (a drag writes its keyform)? */
  bound?: boolean;
  /** Model: is a part Ctrl-clicked with the chosen one bound (a drag writes that one, so the gizmo is not locked)? */
  setBound?: boolean;
  /** Model: the other ways the chosen part is bound to the active parameter (its warp, its mask): the tool that keys them. */
  other?: readonly ('warp' | 'mask')[];
  /** Model, no parameter active: the parameters that move the chosen part already (a click on one keeps the part), and whether the rig has any. */
  movedBy?: readonly string[];
  /** Model, no parameter active, the part itself moved by none: its bone and the parameters that move the bone (MD-15: the line pointed nowhere). */
  boneMovedBy?: { bone: string; params: readonly string[] } | null;
  hasParams?: boolean;
  /** Animate: the animation on show (null: none), whether it is a preset, and whether Auto-key is on. */
  anim?: { name: string; preset: boolean } | null;
  autoKey?: boolean;
  /** Rotate or Scale on a part with no pivot of its own that sits on a bone: that bone, whose joint the part turns and scales about (MR-1). */
  pivotFrom?: string | null;
}

/**
 * The line in the bar for Move, Rotate and Scale: what the gizmo writes to and whether a drag will write, as rig-json.md promised
 * ("poses spine, the bone torso sits on · spine is not bound to breathe: D keys torso's warp").
 */
export function gizmoLine(s: GizmoLineState): string {
  if (s.chosen === null || s.subject === null) return 'Nothing chosen: click a part on the stage, or choose it in the Parts tree';
  // A blink squashed about the neck slides the eyes down: say where the part turns, and how to give it its own point, before the drag.
  const line = gizmoWrites(s as GizmoLineState & { chosen: string; subject: string });
  return s.pivotFrom && s.subject === s.chosen ? `${line} · about ${s.pivotFrom}'s joint: Q, then a click, gives ${s.chosen} a pivot of its own` : line;
}

function gizmoWrites(s: GizmoLineState & { chosen: string; subject: string }): string {
  const poses = s.subject === s.chosen ? `poses ${s.subject}` : `poses ${s.subject}, the bone ${s.chosen} sits on`;
  if (s.mode === 'animate') {
    if (!s.anim) return `${poses} · no animation: choose one to key`;
    if (s.anim.preset) return `${poses} · ${s.anim.name} is a preset and cannot be keyed: Edit copy makes an editable version`;
    return `${poses} · ${s.autoKey === false ? `a drag previews, Key writes it into ${s.anim.name}` : `a drag keys ${s.anim.name} at the playhead`}`;
  }
  // No parameter: a click on a parameter's name keeps the part only when the two are bound (studio-focus.ts), so name those, and the ways to bind.
  if (!s.param) {
    if (s.hasParams === false) return `${poses} · this character has no parameters: + in Parameters adds one`;
    const by = s.movedBy ?? [];
    if (by.length) return `${poses} · no parameter is active: ${by.join(', ')} ${by.length > 1 ? 'move' : 'moves'} ${s.chosen}, click ${by.length > 1 ? 'one' : 'it'} in Parameters; ◆ on another parameter binds ${s.chosen} to it`;
    const bb = s.boneMovedBy;
    if (bb?.params.length) return `${poses} · ${s.chosen} is bound to no parameter, its bone ${bb.bone} is (${bb.params.join(', ')}): Alt-click ${s.chosen} chooses ${bb.bone}, or Bind to parameter… binds ${s.chosen} itself`;
    return `${poses} · ${s.chosen} is bound to no parameter: Bind to parameter…, or ◆ on a parameter's row, binds it (a click on a name would choose the parameter alone)`;
  }
  if (s.bound) return `${poses} · a drag writes its keyform of ${s.param}`;
  const other = (s.other ?? []).map(k => (k === 'warp' ? `D keys ${s.chosen}'s warp` : `M keys ${s.chosen}'s mask`));
  // Bound another way (a warp, a mask): the gizmo has no pose to write, but the part is bound, so say which tool keys it rather than "not bound".
  if (other.length) return `${poses} · ${s.subject} has no pose on ${s.param}, ${other.join(', ')}`;
  return `${poses} · ${s.subject} is not bound to ${s.param}: nothing to drag until it is (Bind parts…, or ◆ on ${s.param}'s row, binds it)`;
}

/** Why the gizmo is locked (`gizmoLock`). */
export type GizmoLock = 'noAnim' | 'preset' | 'noParams' | 'noParam' | 'unbound';

/**
 * Why a drag of the Move, Rotate or Scale gizmo would be thrown away at the release, or null when it would be kept: a locked gizmo draws
 * no handles, and the line above (`gizmoLine`) says why and what to do (docs/design/studio-locked-gizmo.md). Animate with Auto-key off is
 * not locked (the drag waits for Key), nor is a Ctrl-click set with one part bound (that one is written); the Weights tool's test pose is
 * the caller's to leave out.
 */
export function gizmoLock(s: GizmoLineState): GizmoLock | null {
  if (s.chosen === null || s.subject === null) return null; // no gizmo to lock
  if (s.mode === 'animate') return !s.anim ? 'noAnim' : s.anim.preset ? 'preset' : null;
  if (!s.param) return s.hasParams === false ? 'noParams' : 'noParam';
  return s.bound || s.setBound ? null : 'unbound';
}

/**
 * The status line's note, as last looked at: `ctx` names what the note was about (the mode, the tool, the focus, the animation and the
 * working copy's revision), `text` is what it said then.
 */
export interface NoteSeen { ctx: string; text: string }
/**
 * Does the note stay? It describes the last thing done, so it goes once the context moved on, unless the action that moved it wrote a
 * note of its own since the last look (a note set and then a part chosen, or a part chosen and then a note set).
 */
export const keepNote = (last: NoteSeen, now: NoteSeen): boolean => now.ctx === last.ctx || now.text !== last.text;

/** What the focus header knows (Model mode): the focus, and how many things each of its pickers and verbs would offer. */
export interface FocusHeaderState {
  mode: 'model' | 'animate';
  /** The chosen part or bone, null for none. */
  part: string | null;
  /** The active parameter's name (a pad's too), null while none is picked. */
  param: string | null;
  /** Does the rig have any parameter or pad? */
  hasParams: boolean;
  /** Parts bound to the active parameter (the part word's ▾) and parts that could still be bound (Bind parts…). */
  bound: number;
  bindable: number;
  /** Parameters that move the chosen part (the parameter word's ▾) and parameters it is not bound to (Bind to parameter…). */
  movedBy: number;
  bindableParams: number;
  /** The kind of binding the tool works on: Copy keys from… copies pose keys only. */
  kind: 'pose' | 'warp' | 'mask';
  /** Pose keys of the same kind the chosen part could take over. */
  copySources: number;
  /**
   * The keyform: can it be written (a pose binding, the slider or pad at a spot; a warp and a slider), is a key stored at the spot, and what
   * Copy form holds, in words (`arm_l at arm_l_lift 1`; null: nothing copied yet). Left out: none of it.
   */
  form?: FormState;
  /** Every row chosen, the chosen part first, when Ctrl-click added some; `parts`: all of them are parts with art (a set). */
  set?: { names: readonly string[]; parts: boolean };
}

/**
 * What the keyform's copy and paste need beyond `can` and `keyed`: the clipboard's kind (a pose, or a warp's points) and, for a warp, whether
 * the copied points fit it (the same number of points), whether it can be mirrored (a lattice), and how many of its points are chosen (Reset
 * takes those back to rest).
 */
export interface FormState {
  can: boolean;
  keyed: boolean;
  clip: string | null;
  clipKind?: 'pose' | 'warp';
  fits?: boolean;
  lattice?: boolean;
  selected?: number;
}

/** A per-key operation of the keyform: Copy form, Paste form, Paste mirrored, Reset. */
export type FormOpId = 'copyForm' | 'pasteForm' | 'pasteMirrored' | 'resetForm';
/** `label` is the full name (the ⋯ menu, a button's accessible name); `short` what Keyforms' row shows, so the four fit one line at 340 px. */
export interface FormOp { id: FormOpId; label: string; short: string; enabled: boolean; title: string }

export type HeaderVerbId = Extract<PickVerb, 'bindParts' | 'bindToParam' | 'copyKeys'>;
/** A button of the action row: shown means it is in the row; a verb that cannot run is disabled, and its tooltip says why. */
export interface HeaderVerb { id: HeaderVerbId; label: string; /** The full name, for the button's accessible name when the label is short. */ name?: string; enabled: boolean; title: string }
const SHORT_VERB: Record<HeaderVerbId, string> = { bindParts: 'Bind parts…', bindToParam: 'Bind to…', copyKeys: 'Copy keys…' };
/** A ▾ picker of the breadcrumb: shown next to its word, disabled (with the reason) when its list would be empty. */
export interface HeaderPick { show: boolean; enabled: boolean; title: string }

export interface FocusHeaderView {
  kind: FocusKind;
  /** The line shown with nothing in focus. */
  empty: string;
  /** The words standing in for the missing half of the focus: `no part ▾ › breathe`, `torso › no parameter ▾`. */
  noPart: string;
  noParam: string;
  /** The part word's ▾ (the parts bound to the parameter) and the parameter word's ▾ (what moves the part). */
  partPick: HeaderPick;
  paramPick: HeaderPick;
  verbs: HeaderVerb[];
  /**
   * A keyform's per-key operations (empty for any other focus): Keyforms shows all four, the action row's ⋯ the three that copy and paste
   * (three verbs fill the row at 340 px, so these go in its menu rather than as more buttons).
   */
  formOps: FormOp[];
  /** What the Keyforms section says while it has no keyform to show ('' for a keyform focus). */
  keyformNote: string;
  /** Rows added with Ctrl-click: the part word reads `3 parts` (`3 chosen` when a bone or a shape is among them), its tooltip names them. Null: one row. */
  setWord: { text: string; title: string } | null;
}

/**
 * The focus header pinned at the top of the right column (docs/design/studio-inspector.md): the breadcrumb with a ▾ picker after each word,
 * and the action row, the verbs that join the focus to something else. A parameter in focus: Bind parts…; a part: Bind to parameter…,
 * Copy keys from…; a keyform has both. Null in Animate mode, whose Properties section names the chosen part already.
 */
export function focusHeader(s: FocusHeaderState): FocusHeaderView | null {
  if (s.mode !== 'model') return null;
  const kind = focusKind({ control: s.param, part: s.part });
  const verbs: HeaderVerb[] = [];
  if (s.param !== null) {
    verbs.push(s.bindable > 0
      ? { id: 'bindParts', label: 'Bind parts…', enabled: true, title: `Choose from a list the parts ${s.param} moves: each is bound at once, keys at its minimum, default and maximum, all at rest` }
      : { id: 'bindParts', label: 'Bind parts…', enabled: false, title: `Every part is bound to ${s.param} already` });
  }
  if (s.part !== null) {
    const p = s.part;
    verbs.push(!s.hasParams ? { id: 'bindToParam', label: 'Bind to parameter…', enabled: false, title: 'This character has no parameters yet: + in Parameters adds one' }
      : s.bindableParams > 0 ? { id: 'bindToParam', label: 'Bind to parameter…', enabled: true, title: `Choose from a list the parameters ${p} is bound to` }
      : { id: 'bindToParam', label: 'Bind to parameter…', enabled: false, title: `${p} is bound to every parameter already` });
    const why = s.param === null ? `Keys are copied onto the active parameter: choose one first (the ▾ after ${p} lists what moves it)`
      : s.kind !== 'pose' ? 'Only pose keys are copied: choose Move, Rotate or Scale (W, E, R)'
      : s.copySources === 0 ? `No other part has pose keys of this kind to copy onto ${p}` : '';
    verbs.push({ id: 'copyKeys', label: 'Copy keys from…', enabled: !why, title: why || `Replace ${p}'s keys on ${s.param} with another part's (a part on another parameter too, mapped min to min and max to max)` });
  }
  // Three verbs do not fit one line of a 340 px column by their full names: the part's two are shortened (the full name stays the button's name).
  for (const v of verbs) v.name = v.label;
  if (verbs.length > 2) for (const v of verbs) v.label = SHORT_VERB[v.id];
  return {
    formOps: kind === 'keyform' ? formOps(s) : [],
    kind,
    empty: 'Nothing in focus: choose a parameter or a part',
    noPart: 'no part',
    noParam: 'no parameter',
    partPick: {
      show: s.param !== null, enabled: s.bound > 0,
      title: s.bound > 0 ? `The parts bound to ${s.param} (${s.bound}): choose one, or unbind it with ✕` : `No parts are bound to ${s.param ?? 'the parameter'} yet: Bind parts… binds them`,
    },
    paramPick: {
      show: s.part !== null, enabled: s.movedBy > 0,
      title: s.movedBy > 0 ? `What moves ${s.part} (${s.movedBy}): choose one to make it the active parameter` : `Nothing moves ${s.part ?? 'the part'} yet: Bind to parameter… binds it`,
    },
    verbs,
    keyformNote: kind === 'keyform' ? ''
      : kind === 'param' ? `Choose a part bound to ${s.param} (the ▾ after "no part" lists them) to see its keys and pose.`
      : kind === 'part' ? `Choose a parameter that moves ${s.part} (the ▾ after "no parameter") to see its keys and pose.`
      : 'Choose a parameter and a part it moves to see the keys and the pose.',
    setWord: s.set && s.set.names.length > 1 && s.part !== null ? {
      text: s.set.parts ? plural(s.set.names.length, 'part') : `${s.set.names.length} chosen`,
      title: `${s.set.names.join(', ')}: Ctrl-click a row to add it or take it out, a plain click chooses one again. Keyforms shows ${s.part}${s.set.parts ? '; Properties sets a pivot, bone or clip on all of them' : ''}`,
    } : null,
  };
}

/**
 * Copy form, Paste form, Paste mirrored and Reset for a keyform focus; one that cannot run says why. A pose binding copies its pose; a warp
 * binding the shape of its keyform (every point's move), pasted on a warp with as many points, mirrored on a lattice only, and its Reset takes
 * the chosen points back to rest. A mask's keys are written in rig.json, so nothing of it is copied.
 */
function formOps(s: FocusHeaderState): FormOp[] {
  const f: FormState = s.form ?? { can: false, keyed: false, clip: null };
  if (s.kind === 'warp') return warpFormOps(s, f);
  const cant = s.kind === 'mask' ? 'A mask shape\'s keys are written in rig.json: choose Move, Rotate or Scale (W, E, R) to copy a pose, or the Warp tool (D) to copy a warp\'s points'
    : !f.can ? `${s.part} is not bound to ${s.param} by a pose: Bind parts… binds it` : '';
  const paste = cant || (f.clip === null ? 'Nothing copied yet: Copy form copies the pose shown at a key'
    : f.clipKind === 'warp' ? `${f.clip} is a warp's points: paste it with the Warp tool (D)` : '');
  return [
    { id: 'copyForm', label: 'Copy form', short: 'Copy', enabled: !cant, title: cant || `Copy the pose shown here (a key's, or the blend between keys), to paste at another key or on another part` },
    { id: 'pasteForm', label: 'Paste form', short: 'Paste', enabled: !paste, title: paste || `Paste ${f.clip} here, as a key (one undo step)` },
    { id: 'pasteMirrored', label: 'Paste mirrored', short: 'Paste mirrored', enabled: !paste, title: paste || `Paste ${f.clip} mirrored sideways (x moves and rotations change sign), as for the other side` },
    { id: 'resetForm', label: 'Reset', short: 'Reset', enabled: !cant && f.keyed, title: cant || (f.keyed ? 'Put the pose stored here back to rest (the key stays)' : 'No key here: nothing to reset') },
  ];
}

/** formOps for a warp binding: the keyform's shape at the slider's value is what is copied and pasted. */
function warpFormOps(s: FocusHeaderState, f: FormState): FormOp[] {
  const cant = !f.can ? `${s.part} has no warp to key on ${s.param}: Add warp in Properties › Deform, and make ${s.param} a slider's parameter (a warp is not keyed to a pad)` : '';
  const paste = cant || (f.clip === null ? 'Nothing copied yet: Copy form copies the shape of the warp shown here'
    : f.clipKind !== 'warp' ? `${f.clip} is a pose: paste it with Move, Rotate or Scale (W, E, R)`
    : f.fits === false ? `${f.clip} has a different number of points than this warp: it pastes only on a lattice of the same size, or the same mesh` : '');
  const mirror = paste || (f.lattice === false ? 'A mesh\'s vertices have no fixed partners across the middle: paste, then Mirror ▾ in the tool options bar' : '');
  const n = f.selected ?? 0;
  return [
    { id: 'copyForm', label: 'Copy form', short: 'Copy', enabled: !cant, title: cant || 'Copy the shape of the warp shown here (every point\'s move, a key\'s or the blend between keys), to paste at another key or on a warp of the same size' },
    { id: 'pasteForm', label: 'Paste form', short: 'Paste', enabled: !paste, title: paste || `Paste ${f.clip} here, as a key (one undo step)` },
    { id: 'pasteMirrored', label: 'Paste mirrored', short: 'Paste mirrored', enabled: !mirror, title: mirror || `Paste ${f.clip} mirrored sideways (each column takes its partner's move, dx changes sign)` },
    { id: 'resetForm', label: 'Reset points', short: 'Reset', enabled: !cant && n > 0,
      title: cant || (n ? `Take the ${n === 1 ? 'chosen point' : `${n} chosen points`} back to rest in this keyform` : 'No point chosen: click one on the stage (Warp tool, D) or choose it in the point ▾') },
  ];
}

/** Keyforms' key strip for a warp or a mask binding: each key (the one the slider is on pressed), the keys either side, and what the key button does. */
export interface PointKeyStrip {
  keys: { at: number; posed: boolean; here: boolean }[];
  prev: number | null;
  next: number | null;
  /** A warp adds a key at the slider's value or removes the one there (any key: its rest is the lattice, not a key); a mask's keys are written in rig.json. */
  action: 'add' | 'remove' | 'locked';
}

/**
 * The key strip of a warp's or a mask's keyform on a slider at `value`: the key within `tol` of it (the nearest; warp-edit.ts WARP_KEY_SNAP
 * of the range) is the one the slider is on.
 */
export function pointKeyStrip(ticks: readonly { at: number; posed: boolean }[], value: number, tol: number, kind: 'warp' | 'mask'): PointKeyStrip {
  let on: number | null = null;
  for (const t of ticks) if (Math.abs(t.at - value) <= tol && (on === null || Math.abs(t.at - value) < Math.abs(on - value))) on = t.at;
  const keys = [...ticks].sort((a, b) => a.at - b.at).map(t => ({ ...t, here: t.at === on }));
  return {
    keys,
    prev: keys.filter(k => k.at < value - tol).at(-1)?.at ?? null,
    next: keys.find(k => k.at > value + tol)?.at ?? null,
    action: kind === 'mask' ? 'locked' : on === null ? 'add' : 'remove',
  };
}

/**
 * The right column's sections a focus leaves out (Model mode): a parameter alone shows the Parameter section in place of Keyforms and
 * Properties; any other focus has no Parameter section. Animate mode has neither, so leaves nothing out.
 */
export function absentByFocus(mode: 'model' | 'animate', kind: FocusKind): string[] {
  if (mode !== 'model') return [];
  return kind === 'param' ? ['keyforms', 'sel'] : ['param'];
}

/**
 * The sub-blocks of the Properties section (Model mode), in the order a part is rigged in: where it turns, how it bends, what bends it,
 * what hides it, and a slot's variants.
 */
export const PROP_BLOCK_IDS = ['transform', 'deform', 'skin', 'clip', 'variants'] as const;
export type PropBlockId = (typeof PROP_BLOCK_IDS)[number];

/** What the Properties sub-blocks are drawn for. */
export interface PropBlocksState {
  /** The chosen row: a part with art, a mask shape, a bone, the parts ticked with Ctrl-click (a set), or nothing (null). */
  row: 'part' | 'shape' | 'bone' | 'set' | null;
  /** Its name (a set: the first part). */
  name: string | null;
  tool: StageTool;
  brush?: WeightsBrush;
  /** A part's clip: what it is clipped to (null: drawn whole), and whether that is a mask shape (else another part's drawn silhouette). */
  clip?: { to: string | null; shape: boolean };
  /** A shape: the bone it sits on (null: the character), its points, and how many parts it clips. */
  shape?: { bone: string | null; points: number; clips: number };
  /** A slot: the variant shown (null: nothing). Left out: the part is no slot. */
  slot?: { shown: string | null };
  /** The warp Deform edits, for a part, a bone or a shape. Left out: none is known (Deform is not shown). */
  deform?: DeformState;
  /** A part's mesh and skin. Left out: the row is no part. */
  skin?: SkinState;
  /** A clip-group issue of the chosen row, in words (a part a group warp bends while the shape that clips it stays): Deform has its fix, Clip's line a ⚠ saying it. */
  clipIssue?: string | null;
  /** A set (row 'set'): each part's bone, pivot and clip, in the order of `parts` (the chosen part first). */
  set?: SetState;
}

/** The parts of a Ctrl-click set and what Transform and Clip show of each. */
export interface SetState {
  parts: readonly string[];
  /** The bone each sits on (null: none). */
  bones: readonly (string | null)[];
  /** Each one's own pivot (null: none). */
  pivots: readonly (readonly [number, number] | null)[];
  /** What each is clipped to (null: drawn whole). */
  clips: readonly (string | null)[];
}

/** A field of a set: the value its parts share, or mixed (the field is blank; a value typed or chosen there is set on all of them). */
export type Shared<T> = { mixed: false; value: T } | { mixed: true; value: null };

/** The value every entry has (compared by content, so two pivots `[3, 4]` are the same), or mixed when they differ or there are none. */
export function sharedField<T>(values: readonly T[]): Shared<T> {
  if (!values.length) return { mixed: true, value: null };
  const first = JSON.stringify(values[0]);
  return values.every(v => JSON.stringify(v) === first) ? { mixed: false, value: values[0] } : { mixed: true, value: null };
}

/** What Transform and Clip show for a set: the count, and each shared field. */
export interface SetView {
  count: number;
  /** The focus header's word for it: `3 parts`. */
  label: string;
  bone: Shared<string | null>;
  pivot: Shared<readonly [number, number] | null>;
  clip: Shared<string | null>;
}

/** A Ctrl-click set's fields (docs/design/studio-inspector.md, step 4: "A Ctrl-click set"). */
export function setView(s: SetState): SetView {
  return { count: s.parts.length, label: plural(s.parts.length, 'part'), bone: sharedField(s.bones), pivot: sharedField(s.pivots), clip: sharedField(s.clips) };
}

/** What Deform knows of the chosen row's warps. */
export interface DeformState {
  /** The warp it edits (the Target ▾'s choice, else the part's own, else its group): none, the part's own lattice or mesh, or a group warp. */
  kind: 'none' | 'lattice' | 'mesh' | 'group';
  /** A lattice's (or a group's) columns and rows. */
  grid?: readonly [number, number];
  /** A mesh's vertices. */
  vertices?: number;
  /** A group warp: its id, and its members (parts and mask shapes). */
  group?: { id: string; parts: number; shapes: number };
  /** Warps the row could edit (its own and its group's): with two, or a group, the Target ▾ stands in the line. */
  candidates: number;
  /** The part has a warp of its own (no Add warp). */
  own: boolean;
  /** What Add group warp would be made from: the chosen bone (its name), or the parts ticked in the tree (two or more); null: nothing. */
  seed: { bone: string } | { parts: number } | null;
  /** The rig has a parameter (a lattice bends only with one). */
  params: boolean;
}

/** What Skin knows of the chosen part. */
export interface SkinState {
  /** The part has a free mesh of its own. */
  mesh: boolean;
  /** Bones bound to the mesh, and bones of the rig that could still be bound. */
  bound: number;
  free: number;
  /** The mesh has weights. */
  skinned: boolean;
}

export type PropVerbId = 'newShape' | 'removeClip' | 'deleteShape' | 'removeBone' | 'addWarp' | 'addGroupWarp' | 'removeWarp' | 'bind' | 'removeSkin';
/** A verb in a sub-block's head line, an icon button: `label` is its accessible name, `title` what it does or why it cannot. */
export interface PropVerb { id: PropVerbId; label: string; enabled: boolean; title: string }

export interface PropBlock {
  id: PropBlockId;
  title: string;
  shown: boolean;
  /** Never folds (Transform: two rows, no verbs of its own). */
  fixed: boolean;
  /** Opens by itself: the tool in use has a next step here. It folds again when the tool is left, unless the author opened or folded it. */
  auto: boolean;
  /** The head line's text, all there is to see while the sub-block is folded. */
  summary: string;
  /** A compact picker stands in the head line (Clip to ▾ once clipped, Deform's Target ▾, Skin's Bind ▾): `summary` is then the words before it. */
  pick?: boolean;
  /** A problem the line flags with a ⚠, this text its tooltip (Clip: the clip-group issue Deform fixes). */
  warn?: string;
  /** The verb that adds (New shape) and the one that takes away (Remove clip, Delete shape, Remove bone); null where there is none. */
  primary: PropVerb | null;
  destructive: PropVerb | null;
}

export interface PropBlocksView {
  /** Every sub-block step 4a draws, in order; `shown` says which the chosen row has. */
  blocks: PropBlock[];
  /** What the section says while nothing is chosen ('' otherwise). */
  empty: string;
  /** A set's shared fields (Transform's Pivot and On bone ▾, Clip to ▾); null for any other row. */
  set: SetView | null;
}

/**
 * The Properties sub-blocks of the chosen row (docs/design/studio-inspector.md, step 4): Transform (a part's pivot and bone; a bone's pivot,
 * name, parent and what it moves), Clip (a part's clip, a shape's outline) and Variants (a slot). Each says whether it shows, opens by
 * itself, its summary and its two verbs; the studio draws them and keeps their open flags with the sections'.
 */
export function propBlocks(s: PropBlocksState): PropBlocksView {
  const name = s.name ?? '', row = s.name === null ? null : s.row;
  const part = row === 'part' || row === 'set';
  const block = (id: PropBlockId, title: string, b: Partial<PropBlock>): PropBlock =>
    ({ id, title, shown: false, fixed: false, auto: false, summary: '', primary: null, destructive: null, ...b });

  const transform = block('transform', 'Transform', {
    shown: part || row === 'bone', fixed: true,
    summary: row === 'bone' ? 'Bone' : '',
    destructive: row === 'bone' ? { id: 'removeBone', label: 'Remove bone', enabled: true, title: `Remove ${name}: what is on it goes to its parent; the keyforms, keys and physics that move it go with it (Ctrl+Z brings them back)` } : null,
  });

  const deform = deformBlock(s, row, name, part, block);
  const skin = skinBlock(s, row, name, block);

  // A set shows the clip its parts share, or Clip to ▾ blank when they differ; a value chosen there is set on all of them. Drawing a
  // shape is one part's (New shape), so a set has none.
  const set = row === 'set' && s.set ? setView(s.set) : null;
  const to = set ? set.clip.value : s.clip?.to ?? null, mixed = !!set?.clip.mixed, sh = s.shape;
  const clipped = to !== null || mixed, whom = set ? `the ${set.label}` : name;
  const clip = block('clip', 'Clip', {
    shown: part || row === 'shape',
    ...(s.clipIssue ? { warn: `${s.clipIssue} Properties › Deform has the fix.` } : {}),
    // The Mask tool on a part opens it while there is a step to take there: choose a clip or draw a shape, or edit the shape it is clipped to.
    auto: s.tool === 'mask' && (row === 'shape' || (part && !mixed && (to === null || (!set && !!s.clip?.shape)))),
    summary: row === 'shape' ? (sh ? `Shape on ${sh.bone ?? 'the character'}, ${sh.points} points, ${sh.clips ? `clips ${sh.clips}` : 'clips nothing'}` : 'Shape')
      : mixed ? 'Clip to' : to === null ? 'Not clipped' : 'Clipped to',
    pick: part && clipped,
    primary: row === 'part' ? { id: 'newShape', label: 'New shape', enabled: true, title: `Draw a new shape on ${name}'s bone and clip ${name} to it` } : null,
    destructive: row === 'shape' ? { id: 'deleteShape', label: 'Delete shape', enabled: true, title: `Delete ${name}: the parts it clips are drawn whole again` }
      : part && clipped ? { id: 'removeClip', label: 'Remove clip', enabled: true, title: mixed ? `Draw ${whom} whole again (they are clipped to different things)` : `Draw ${whom} whole again (${set ? 'they are' : 'it is'} clipped to ${to})` } : null,
  });

  const variants = block('variants', 'Variants', {
    shown: row === 'part' && !!s.slot,
    summary: s.slot ? (s.slot.shown ?? 'nothing shown') : '',
  });

  return {
    blocks: [transform, deform, skin, clip, variants],
    empty: row === null ? 'Nothing chosen: choose a part, a shape or a bone in the Parts tree, or click a part on the stage.' : '',
    set,
  };
}

type BlockMaker = (id: PropBlockId, title: string, b: Partial<PropBlock>) => PropBlock;

/**
 * Deform: the warp of a part (its own lattice or mesh, or the group it is in), a bone's group warp, or the group that bends a shape. Opens by
 * itself when the Warp tool has nothing to edit yet (Add warp, Add group warp, Generate mesh), or the Weights tool a part with no mesh.
 */
function deformBlock(s: PropBlocksState, row: PropBlocksState['row'], name: string, part: boolean, block: BlockMaker): PropBlock {
  const given = s.deform;
  if (!given || row === null) return block('deform', 'Deform', {});
  // A set has only the group warp its parts all share (a part's own warp is that part's): any other is none here.
  const d: DeformState = row === 'set' && given.kind !== 'group' ? { ...given, kind: 'none', own: true, candidates: 0 } : given;
  const g = d.group, members = g ? (g.shapes ? `${plural(g.parts, 'part')}, ${plural(g.shapes, 'shape')}` : plural(g.parts, 'part')) : '';
  // A shape has no warp of its own: Deform shows the group that bends it, or, with the Warp tool on, says how one would.
  const shown = part || row === 'bone' || (row === 'shape' && (d.kind === 'group' || s.tool === 'warp'));
  // A group (always with the Target ▾ in the line, below) is named by the picker.
  const summary = d.kind === 'group' ? ''
    : row === 'shape' ? 'In no group warp'
    : d.kind === 'lattice' ? `Lattice ${d.grid?.[0] ?? 0}×${d.grid?.[1] ?? 0}`
    : d.kind === 'mesh' ? `Mesh ${plural(d.vertices ?? 0, 'vertex', 'vertices')}`
    : row === 'bone' || row === 'set' ? 'No group warp' : 'No warp';
  const noParam = d.params ? '' : 'A lattice bends only with a parameter: make one with + in the Parameters section first';
  const seed = d.seed, from = seed === null ? '' : 'bone' in seed ? seed.bone : `${seed.parts} selected parts`;
  // The line has one verb that adds: a group when there is something to make it from (a bone, or parts ticked), else the part's own warp.
  const primary: PropVerb | null = seed !== null && (row === 'bone' || 'parts' in seed)
    ? { id: 'addGroupWarp', label: `Add group warp from ${from}`, enabled: !noParam, title: noParam || `One lattice over ${'bone' in seed ? `the parts on ${from}` : `the ${from}`}, like a parent deformer: it bends them together, after each one's own warp` }
    : part && !d.own ? { id: 'addWarp', label: `Add warp to ${name}`, enabled: !noParam, title: noParam || `Add warp to ${name}: a lattice over its image; dragging its points in a parameter's keyform bends ${name} as the parameter moves (a mesh: Generate mesh below)` }
    : null;
  const destructive: PropVerb | null = row === 'shape' || d.kind === 'none' ? null
    : d.kind === 'group' ? { id: 'removeWarp', label: 'Remove group warp', enabled: true, title: `Remove the group warp ${g?.id ?? ''}: its members (${members}) are no longer bent by it; its keyforms go with it (Ctrl+Z brings them back)` }
    : { id: 'removeWarp', label: 'Remove warp', enabled: true, title: `Remove ${name}'s ${d.kind}: the part is drawn unbent again and its keyforms go (Ctrl+Z brings them back)` };
  const toAdd = part || (row === 'bone' && seed !== null);
  // With a group, or a warp of its own and a group, the Target ▾ stands in the line: it names the warp edited, so the summary gives it the room.
  const pick = shown && (d.candidates > 1 || d.kind === 'group');
  return block('deform', 'Deform', {
    shown, summary: pick ? '' : summary, primary, destructive, pick,
    auto: shown && ((s.tool === 'warp' && d.kind === 'none' && toAdd) || (s.tool === 'weights' && row === 'part' && !s.skin?.mesh)),
  });
}

/**
 * Skin: the bones bound to a part's mesh, Bind ▾, the vertex read out and Auto-weights. Shown for a part with a mesh, or with the Weights
 * tool on any part (to say where the mesh comes from); opens by itself with the Weights tool on a mesh with no bone bound, or in Read weights.
 */
function skinBlock(s: PropBlocksState, row: PropBlocksState['row'], name: string, block: BlockMaker): PropBlock {
  const k = s.skin;
  if (!k || row !== 'part') return block('skin', 'Skin', {});
  return block('skin', 'Skin', {
    shown: k.mesh || s.tool === 'weights',
    auto: s.tool === 'weights' && k.mesh && (k.bound === 0 || s.brush === 'pick'),
    summary: !k.mesh ? 'No mesh: Generate mesh in Deform' : k.skinned ? plural(k.bound, 'bone') : 'Not skinned',
    pick: k.mesh,
    primary: k.mesh ? { id: 'bind', label: 'Bind a bone', enabled: k.free > 0,
      title: k.free > 0 ? `Bind ▾: a bone that may move ${name} (Auto-weights then gives each bound bone its share)` : k.bound ? 'Every bone of the rig is bound already' : 'This rig has no bones: add some in the Parts tree' } : null,
    destructive: k.mesh && k.skinned ? { id: 'removeSkin', label: 'Remove skin', enabled: true, title: `Remove the skin of ${name}'s mesh: its weights go, and ${name} follows its own bone again (after asking)` } : null,
  });
}

/** The key a sub-block's open flag is kept under, with the sections' open flags of Model mode. */
export const subOpenKey = (id: PropBlockId): string => `sub:${id}`;

/** A parameter's range line in the Parameter section: `-1 to 1, default 0`. */
export function rangeLine(p: { min: number; max: number; default: number }): string {
  const n = (v: number) => String(Math.round(v * 1000) / 1000);
  return `${n(p.min)} to ${n(p.max)}, default ${n(p.default)}`;
}

/** The brush's limits: the radius in screen pixels, the strength as a share of the active bone's weight. */
export const BRUSH_RADIUS: readonly [number, number] = [4, 300];
export const BRUSH_STRENGTH: readonly [number, number] = [0.05, 1];

/**
 * `[` and `]` with the Weights tool, as in paint programs: the radius by a fifth smaller or larger (at least one pixel); with Shift the
 * strength by 0.05. Null for any other key.
 */
export function brushStep(key: string, shift: boolean, radius: number, strength: number): { radius: number; strength: number } | null {
  const dir = key === '[' || key === '{' ? -1 : key === ']' || key === '}' ? 1 : 0;
  if (!dir) return null;
  if (shift || key === '{' || key === '}') {
    const s = Math.round((strength + dir * 0.05) * 100) / 100;
    return { radius, strength: Math.min(BRUSH_STRENGTH[1], Math.max(BRUSH_STRENGTH[0], s)) };
  }
  const r = dir > 0 ? Math.max(radius + 1, Math.round(radius * 1.2)) : Math.min(radius - 1, Math.round(radius / 1.2));
  return { radius: Math.min(BRUSH_RADIUS[1], Math.max(BRUSH_RADIUS[0], r)), strength };
}

/** What the stage knows about the choice: the chosen row, the gizmo's target (a part's bone when the part sits on one), and for a bone how many parts move with it. */
export interface ChoiceCueState { chosen: string | null; target: string | null; bone: boolean; carries: number }
/** How the stage marks the choice: outline the part or the bone (with its parts), and the tag by the gizmo (null when there is nothing to tell apart). */
export interface ChoiceCue { outline: 'part' | 'bone' | null; tag: string | null }

/**
 * The stage's cue for what is chosen (docs/design/studio-choice-cue.md): with a part on a bone the gizmo stands on the bone's pivot either way,
 * so the outline and the tag say which of the two is chosen. A part on no bone is outlined without a tag.
 */
export function choiceCue(s: ChoiceCueState): ChoiceCue {
  if (s.chosen === null) return { outline: null, tag: null };
  if (s.bone) return { outline: 'bone', tag: `${s.chosen} · bone · ${s.carries === 1 ? '1 part' : `${s.carries} parts`}` };
  return { outline: 'part', tag: s.target !== null && s.target !== s.chosen ? `${s.chosen} · part — the gizmo poses its bone ${s.target}` : null };
}
