// The animation studio's stage modes (docs/design/studio-stage-modes.md): what a press on the stage chooses, by the tool that is on and
// the modifiers held, what Esc does in a deform tool, the Weights tool's brush as the stage shows it, and the Weights panel's state kept
// per mesh for the opening. Pure: the stage page (preview/studio-gizmo.ts) decides what is under the pointer, the studio (editor/) holds
// the state and applies the choice.

/** The tools of the tool row over the stage. */
export type StageTool = 'move' | 'rotate' | 'scale' | 'pivot' | 'warp' | 'weights' | 'mask';
/** One stage mode at a time, named by the tool: Move, Rotate and Scale share the Transform mode. */
export type StageMode = 'transform' | 'pivot' | 'warp' | 'weights' | 'mask';

export const stageMode = (tool: StageTool): StageMode => (tool === 'move' || tool === 'rotate' || tool === 'scale' ? 'transform' : tool);
/** The modes that work on a chosen part's own handles (lattice points, vertices, mask points) and keep their subject through a miss. */
export const isDeformMode = (mode: StageMode): boolean => mode === 'warp' || mode === 'weights' || mode === 'mask';

export interface StagePress {
  mode: StageMode;
  /** What the press landed on: a part (the pick of the cycle through overlapping parts), a bone's pivot dot, a mask shape; null for nothing. */
  hit: string | null;
  /** The bone the hit part sits on (a bone of the rig), null for none or when the hit is itself a bone or a shape. */
  boneOf: string | null;
  alt: boolean;
  ctrl: boolean;
  /** Model mode (Ctrl adds the part to the chosen ones there). */
  model: boolean;
}

export type StageChoice = { kind: 'choose'; name: string | null } | { kind: 'toggle'; name: string } | { kind: 'none' };

/**
 * What a press chooses. A click on art chooses the part; the bone is reached deliberately, by Alt-click on the part or by its pivot dot
 * (which only the Transform and Pivot modes report). A press on nothing clears the chosen row in the Transform, Pivot and Mask modes; with
 * Warp or Weights it acts on the tool's own selection instead and leaves the row alone (`none`).
 */
export function chooseOnStage(p: StagePress): StageChoice {
  if (p.hit === null) return p.mode === 'warp' || p.mode === 'weights' ? { kind: 'none' } : { kind: 'choose', name: null };
  const name = p.alt && p.boneOf !== null ? p.boneOf : p.hit;
  return p.ctrl && p.model && !p.alt ? { kind: 'toggle', name } : { kind: 'choose', name };
}

/**
 * Does a press on art keep the deform tool's subject? With Warp or Weights on, a click on the chosen part's own art (between the vertices, or
 * past the mesh's reach) is part of working on it, not a choice: the cycle through overlapping parts does not run and the row stays.
 */
export const keepsSubject = (mode: StageMode, hits: readonly string[], current: string | null): boolean =>
  (mode === 'warp' || mode === 'weights') && current !== null && hits.includes(current);

/** Esc in a mode: clears the tool's selection when it has one, leaves a deform tool for Move when it has none, does nothing in the others. */
export const escapeAction = (mode: StageMode, selected: number): 'clear' | 'leave' | 'none' =>
  (mode === 'warp' || mode === 'weights' ? (selected > 0 ? 'clear' : 'leave') : 'none');

// ---- the Weights tool ----

/** What a press and a drag on the stage do with the Weights tool: read a vertex out, select vertices, or paint the active bone's weight. */
export type WeightsBrush = 'pick' | 'select' | 'add' | 'subtract' | 'replace' | 'smooth';
/** The brush the Weights tool starts on: the useful one. Read weights stays one entry down. */
export const DEFAULT_BRUSH: WeightsBrush = 'add';
export const isPaintBrush = (b: WeightsBrush): boolean => b === 'add' || b === 'subtract' || b === 'replace' || b === 'smooth';
/** The brush the stage acts on: until a bone is bound the brush modes are disabled and a press only reads a vertex out. */
export const effectiveBrush = (mode: WeightsBrush, bound: number): WeightsBrush => (bound > 0 ? mode : 'pick');
/** The stage's cursor by brush: a crosshair reads, a cell selects, the paint brushes draw their ring and hide the pointer. */
export const brushCursor = (b: WeightsBrush): 'crosshair' | 'cell' | 'none' => (b === 'pick' ? 'crosshair' : b === 'select' ? 'cell' : 'none');

export const BRUSH_NAMES: Record<WeightsBrush, string> = { pick: 'Read weights', select: 'Select', add: 'Add', subtract: 'Subtract', replace: 'Replace', smooth: 'Smooth' };

/** The status line with the Weights tool on: what a press does and the keys; the mode and the bone are the tool options bar's (studio-inspector.ts `modeLabel`). `leave` is the studio's own leaving key text (Esc close, Ctrl+S save). */
export function weightsHint(brush: WeightsBrush, bone: string | null, hasMesh: boolean, leave: string): string {
  const out = 'B or Esc (nothing selected) back to Move · Ctrl+Z undo · ' + leave;
  if (!hasMesh) return 'Click a part with a mesh on the stage, or choose it in the Parts tree, to weight it to the bones · ' + out;
  if (brush === 'pick') return 'Click a vertex to read its weights, Alt-click a part for its bone · ' + out;
  if (brush === 'select') return 'Drag a rectangle over the mesh (Shift adds, Shift-click toggles one), Esc clears · ' + out;
  return `Drag over the mesh to ${brush === 'smooth' ? 'blur the weights' : `${brush} ${bone ?? 'the active bone'}'s weight`}, one stroke is one undo step · [ ] radius, Shift strength · ` + out;
}

/** B with a bone chosen: the first part on that bone with a mesh, which is what the tool wants; null when none has one. */
export function meshPartOnBone(bone: string, parts: readonly string[], boneOf: (part: string) => string | undefined, hasMesh: (part: string) => boolean): string | null {
  return parts.find(p => boneOf(p) === bone && hasMesh(p)) ?? null;
}

/** The Weights panel's state for one mesh: the bones bound but not weighted yet, the active bone, the vertex read out and the vertex selection. */
export interface WeightsSession { extra: readonly string[]; active: string | null; picked: number | null; selected: readonly number[] }
export const EMPTY_WEIGHTS_SESSION: WeightsSession = { extra: [], active: null, picked: null, selected: [] };
/** The sessions by deformer id, for the opening: a change of the chosen row and a return find a mesh as it was left. */
export type WeightsSessions = Readonly<Record<string, WeightsSession>>;

export const weightsSession = (s: WeightsSessions, id: string): WeightsSession => s[id] ?? EMPTY_WEIGHTS_SESSION;

export function patchWeightsSession(s: WeightsSessions, id: string, patch: Partial<WeightsSession>): WeightsSessions {
  const next = { ...weightsSession(s, id), ...patch };
  const cur = s[id];
  if (cur && cur.active === next.active && cur.picked === next.picked && cur.extra.join('\0') === next.extra.join('\0') && cur.selected.join(',') === next.selected.join(',')) return s;
  return { ...s, [id]: next };
}
