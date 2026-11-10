// What the WebGL renderer keeps per character on stage (preview/pixi-renderer.ts), shared with the studio's queries.

import type { Container, Graphics, Mesh } from 'pixi.js';
import { fxUnit, type AutoState, type ReactionState, type ChainStates, type DeformerDef, type MeshSkin, type MaskDef, type Offset, type PhysicsOff, type SpriteState } from '../engine/src/index.js';
import { H, W } from './stage-ui.js';

/** The length animation offsets are fractions of (the stage's shorter side, see fxUnit). */
export const applyM = (m: { a: number; b: number; c: number; d: number; tx: number; ty: number }, x: number, y: number): [number, number] => [m.a * x + m.c * y + m.tx, m.b * x + m.d * y + m.ty];
export const FX = () => fxUnit({ width: W, height: H });

/** A named animation playing on a character (`engine/src/anim.ts`); a one-shot resolves `done` when it ends. */
export interface Fx { fn: (t: number) => Partial<Offset>; parts?: (t: number) => Record<string, Partial<Offset>>; params?: (t: number) => Record<string, number>; frames?: (t: number, seconds: number) => Record<string, string>; physicsOff?: PhysicsOff; part: string | null; dur: number; strength: number; loop: boolean; elapsed: number; done?: () => void; auto?: boolean; name?: string; order?: number }

/** A character on stage: `node` sits at the stage position (the feet), `turn` scales, turns and mirrors it about its anchor, `body` carries the animation offsets and the art. */
export interface Actor {
  node: Container; turn: Container; body: Container; size: { w: number; h: number } | null; key: string; fx: Fx[];
  s: SpriteState;                  // what the script says it looks like (slot overrides: `s.overrides`)
  auto: AutoState | null;          // the scheduler's state for the rig's automatic animations (rig.json `auto`)
  autoFx: Fx[];                    // the automatic animations running now, outside `fx` so `animate ... stop` leaves them be
  reaction: ReactionState;         // the pose a reaction holds, and the move into it
  live: Record<string, string>;    // slot variants swapped in by itself right now (frame tracks)
  clip: Record<string, string>;    // slot frames the running animations hold right now; they win over the script, blinking and talking
  speaking: boolean; posed: boolean;
  parts: Map<string, Container>;   // a layered character's parts (slots and plain layers) by name, each turning about its pivot
  partPose: Map<string, Offset>;   // what the parts are posed with now, kept so a swapped-in slot variant starts posed
  params: Record<string, number>;  // the rig's parameters as drawn now (a script tween moves them), every one of the rig's parameters set
  paramParts: Map<string, Offset>; // what the keyforms make of `params`, by part or bone; laid under the animations
  warpValues: Record<string, number>; // the parameters the warps were last shaped by
  warps: Map<string, Warp>;        // the parts drawn as a lattice mesh (rig.json `deformers`: their own warp or a group's), by part name
  groups: Map<string, GroupWarp>;  // the group warps of the parts on stage, by deformer id
  masks: MaskNode[];               // the stencil masks clipping parts (rig.json `masks`), one per clipped part
  holders: Map<string, Container>; // where polygon masks that follow a bone hang: by bone name ('' for the character), placed with the bone
  physics: ChainStates;            // the rig's physics chains' state; not in DisplayState or saves, so a sync starts them at rest
  hue: number;                     // the sprite's own tint (`move ... tint=`) as 0xrrggbb, multiplied into the focus grey; white = none
  lit: number;                     // speaker focus: 1 lit, lower dimmed (drawn as a grey tint), easing toward focusLevels
}

/**
 * A part drawn as a mesh: `def` is its own warp (null when it is only a member of a group warp), `group` the group warp that
 * bends it after that, `grid` the mesh's cells (the own lattice's, or finer inside a group), `rest` the mesh's undeformed vertices
 * (in the part's own pixels), `origin` where the part's image box sits on the canvas, and `key` the parameter values it was last
 * shaped by (null: not yet). A part with a free mesh (`def.mesh`) has `tris` (its triangle indices, `rest` its stored vertices) and a `grid` of [0, 0].
 */
export interface Warp { mesh: Mesh; def: DeformerDef | null; group: GroupWarp | null; grid: [number, number]; rest: Float32Array; tris: Uint32Array | null; origin: [number, number]; key: string | null; skin: SkinState | null }

/**
 * A skinned free mesh (its `mesh.weights`, docs/design/skinning.md): applyWarps writes the parameter-shaped vertices to `shaped`
 * (and bumps `version`), applySkins moves them by the bones into the mesh's buffer when `version`, the part's own key or the bones it
 * reads changed (`key`; null: not yet).
 */
export interface SkinState { skin: MeshSkin; shaped: Float32Array; version: number; key: string | null }

/** A group warp (rig.json `deformers` with `members`) as drawn: its lattice box on the canvas and its points' displacement as the parameters set it. */
export interface GroupWarp { def: DeformerDef; box: [number, number, number, number]; disp: Float32Array; key: string | null; members: string[] }

/**
 * A part's clip (rig.json `masks`): `g` is its stencil shape, hung in the container of the part it follows (or a holder placed with
 * a bone) so that it moves with it. `shapes` are the outlines before the parameters and the frame part's warp (flat [x, y, ...] in
 * the space `g` is drawn in); `key` is what the shape was last drawn for (null: not yet). `drawn` is what it came out as.
 */
export interface MaskNode { def: MaskDef; g: Graphics; shapes: Float32Array[]; frame: string | null; box: { w: number; h: number } | null; at: [number, number]; key: string | null; drawn: Float32Array[]; group: GroupWarp | null }
