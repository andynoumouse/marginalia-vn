// What the WebGL renderer keeps per character on stage (preview/pixi-renderer.ts), shared with the studio's queries.

import type { Container, Graphics, MeshPlane } from 'pixi.js';
import { fxUnit, type BlinkState, type ChainStates, type DeformerDef, type MaskDef, type Offset, type PhysicsOff, type SpriteState } from '../engine/src/index.js';
import { H, W } from './stage-ui.js';

/** The length animation offsets are fractions of (the stage's shorter side, see fxUnit). */
export const applyM = (m: { a: number; b: number; c: number; d: number; tx: number; ty: number }, x: number, y: number): [number, number] => [m.a * x + m.c * y + m.tx, m.b * x + m.d * y + m.ty];
export const FX = () => fxUnit({ width: W, height: H });

/** A named animation playing on a character (`engine/src/anim.ts`); a one-shot resolves `done` when it ends. */
export interface Fx { fn: (t: number) => Partial<Offset>; parts?: (t: number) => Record<string, Partial<Offset>>; params?: (t: number) => Record<string, number>; frames?: (t: number, seconds: number) => Record<string, string>; physicsOff?: PhysicsOff; part: string | null; dur: number; strength: number; loop: boolean; elapsed: number; done?: () => void }

/** A character on stage: `node` sits at the stage position (the feet), `turn` scales, turns and mirrors it about its anchor, `body` carries the animation offsets and the art. */
export interface Actor {
  node: Container; turn: Container; body: Container; size: { w: number; h: number } | null; key: string; fx: Fx[];
  s: SpriteState;                  // what the script says it looks like (slot overrides: `s.overrides`)
  idle: Fx | null; talk: Fx | null; // rig.json idle / speak.anim loops, outside `fx` so `animate ... stop` leaves them be
  live: Record<string, string>;    // slot variants swapped in by itself right now (blinking, talking, frame tracks)
  clip: Record<string, string>;    // slot frames the running animations hold right now; they win over the script, blinking and talking
  blink: BlinkState | null;
  speaking: boolean; talkStart: number; posed: boolean;
  parts: Map<string, Container>;   // a layered character's parts (slots and plain layers) by name, each turning about its pivot
  partPose: Map<string, Offset>;   // what the parts are posed with now, kept so a swapped-in slot variant starts posed
  params: Record<string, number>;  // the rig's parameters as drawn now (a script tween moves them), every one of the rig's parameters set
  paramParts: Map<string, Offset>; // what the keyforms make of `params`, by part or bone; laid under the animations
  warpValues: Record<string, number>; // the parameters the warps were last shaped by
  warps: Map<string, Warp>;        // the parts drawn as a lattice mesh (rig.json `deformers`), by part name
  masks: MaskNode[];               // the stencil masks clipping parts (rig.json `masks`), one per clipped part
  holders: Map<string, Container>; // where polygon masks that follow a bone hang: by bone name ('' for the character), placed with the bone
  physics: ChainStates;            // the rig's physics chains' state; not in DisplayState or saves, so a sync starts them at rest
  lit: number;                     // speaker focus: 1 lit, lower dimmed (drawn as a grey tint), easing toward focusLevels
}

/** A part drawn as a mesh: `rest` is its undeformed lattice, `key` the deformer's parameter values it was last shaped by (null: not yet). */
export interface Warp { mesh: MeshPlane; def: DeformerDef; rest: Float32Array; key: string | null }

/**
 * A part's clip (rig.json `masks`): `g` is its stencil shape, hung in the container of the part it follows (or a holder placed with
 * a bone) so that it moves with it. `shapes` are the outlines before the parameters and the frame part's warp (flat [x, y, ...] in
 * the space `g` is drawn in); `key` is what the shape was last drawn for (null: not yet). `drawn` is what it came out as.
 */
export interface MaskNode { def: MaskDef; g: Graphics; shapes: Float32Array[]; frame: string | null; box: { w: number; h: number } | null; at: [number, number]; key: string | null; drawn: Float32Array[] }
