// Secondary motion (hair, ribbons, cloth hems): a chain of damped pendulum segments driven by how its inputs change,
// not by their value. A pure function of (chain, state, inputs, dt): no DOM, no Math.random, so a node test can step
// a chain and assert the swing. The simulation runs at a fixed PHYSICS_HZ with the remainder carried in the state,
// so the result does not depend on the frame rate. Angles are in degrees, time in seconds.

export const PHYSICS_HZ = 60;
const STEP = 1 / PHYSICS_HZ;
/** Frames longer than this are clipped (a tab that was hidden must not run thousands of steps). */
const MAX_FRAME = 0.25;
const MIN_PART = 1e-3;

export interface PhysicsInput {
  /** Parameter (or bone channel) read each step; a missing value counts as 0. */
  name: string;
  /** How much of this input's change per step reaches the first segment. */
  weight: number;
  /** 0 = follow the input at once, towards 1 = lag behind it (the fraction kept per step). */
  smoothing?: number;
}

export interface PhysicsSegment {
  /** Pendulum length: longer swings slower and is pushed less. */
  length: number;
  /** Inertia: heavier is pushed less. */
  mass: number;
  /** Velocity lost per second (1/s). */
  damping: number;
  /** Pull back to rest (1/s² at length 1). */
  stiffness: number;
  /** Largest swing either way, in degrees. */
  limit: number;
}

export interface PhysicsOutput {
  /** Parameter written. */
  name: string;
  /** Segment read, 0-based; the last one when omitted. */
  segment?: number;
  scale: number;
  min?: number;
  max?: number;
}

export interface PhysicsWind {
  /** Push (degrees/s² at mass and length 1). */
  strength: number;
  /** 0 = constant, 1 = fully gusting (a deterministic wave of time and seed). */
  noise?: number;
  /** Gusts per second. */
  frequency?: number;
  seed?: number;
}

export interface PhysicsChain {
  inputs: PhysicsInput[];
  segments: PhysicsSegment[];
  outputs: PhysicsOutput[];
  wind?: PhysicsWind;
}

export interface PhysicsState {
  /** Swing angle of each segment, relative to its parent. */
  angles: number[];
  /** Angular velocity of each segment (deg/s). */
  velocities: number[];
  /** Smoothed value of each input at the previous step. */
  smoothed: number[];
  /** False until the first step has seen the inputs, so a pose that is already off-center does not kick the chain. */
  primed: boolean;
  /** Time not yet consumed by a fixed step. */
  remainder: number;
  /** Simulated time, for the wind. */
  time: number;
  /** Output values after the last step, in `chain.outputs` order. */
  outputs: number[];
}

/** A chain at rest. The first `stepChain` adopts its inputs as the rest values. */
export function restState(chain: PhysicsChain): PhysicsState {
  return {
    angles: chain.segments.map(() => 0),
    velocities: chain.segments.map(() => 0),
    smoothed: chain.inputs.map(() => 0),
    primed: false,
    remainder: 0,
    time: 0,
    outputs: chain.outputs.map(o => clampOut(o, 0)),
  };
}

function clampOut(o: PhysicsOutput, v: number): number {
  const lo = o.min ?? -Infinity, hi = o.max ?? Infinity;
  return Math.min(hi, Math.max(lo, v)) + 0; // + 0 turns -0 into 0
}

/** Deterministic gust in [-1, 1]: two sines at unrelated rates with phases from the seed. */
export function windWave(t: number, frequency: number, seed: number): number {
  const p1 = ((seed * 0.6180339887) % 1) * Math.PI * 2;
  const p2 = ((seed * 0.4142135623) % 1) * Math.PI * 2;
  const w = t * frequency * Math.PI * 2;
  return (Math.sin(w + p1) + Math.sin(w * 1.618 + p2)) / 2;
}

function tick(chain: PhysicsChain, s: PhysicsState, inputs: Readonly<Record<string, number>>): PhysicsState {
  const smoothed = s.smoothed.slice();
  let push = 0;
  chain.inputs.forEach((inp, i) => {
    const target = inputs[inp.name] ?? 0;
    const keep = Math.min(0.999, Math.max(0, inp.smoothing ?? 0));
    const next = s.primed ? smoothed[i] + (target - smoothed[i]) * (1 - keep) : target;
    if (s.primed) push += (next - smoothed[i]) * inp.weight;
    smoothed[i] = next;
  });
  const angles = s.angles.slice(), velocities = s.velocities.slice();
  const w = chain.wind;
  const noise = w?.noise ?? 0;
  const gust = w ? w.strength * (1 - noise + noise * windWave(s.time, w.frequency ?? 0.5, w.seed ?? 0)) : 0;
  let anchor = push; // how far the point this segment hangs from just moved
  chain.segments.forEach((seg, i) => {
    const len = Math.max(MIN_PART, seg.length), mass = Math.max(MIN_PART, seg.mass);
    const before = angles[i];
    let a = before - anchor / (mass * len); // the anchor moved one way, the segment lags the other
    let v = velocities[i];
    v += (-seg.stiffness / len * a - seg.damping * v + gust / (mass * len)) * STEP;
    a += v * STEP;
    const lim = Math.abs(seg.limit);
    if (a > lim) { a = lim; if (v > 0) v = 0; }
    else if (a < -lim) { a = -lim; if (v < 0) v = 0; }
    angles[i] = a;
    velocities[i] = v;
    anchor = a - before;
  });
  const outputs = chain.outputs.map(o => {
    const idx = Math.min(angles.length - 1, Math.max(0, o.segment ?? angles.length - 1));
    return clampOut(o, (angles[idx] ?? 0) * o.scale);
  });
  return { angles, velocities, smoothed, primed: true, remainder: s.remainder, time: s.time + STEP, outputs };
}

/**
 * Advance a chain by `dt` seconds with the current `inputs` (parameter name to value). Runs as many fixed steps as
 * fit and carries the rest, so any sequence of frame times that adds up to the same total gives the same result
 * (for inputs that are constant between frames).
 */
export function stepChain(chain: PhysicsChain, state: PhysicsState, inputs: Readonly<Record<string, number>>, dt: number): PhysicsState {
  let s = state;
  let left = state.remainder + Math.min(MAX_FRAME, Math.max(0, dt));
  if (!s.primed) s = tick(chain, s, inputs); // adopt the inputs as the rest values
  while (left >= STEP - 1e-9) {
    s = tick(chain, s, inputs);
    left -= STEP;
  }
  return { ...s, remainder: Math.max(0, left) };
}

const HEAD_INPUTS: PhysicsInput[] = [{ name: 'angle_x', weight: 1, smoothing: 0.3 }, { name: 'angle_z', weight: 0.5, smoothing: 0.3 }];

/** Starting points for the Physics panel; the numbers are tuned by eye. */
export const PHYSICS_PRESETS: Readonly<Record<string, PhysicsChain>> = {
  'long hair': {
    inputs: HEAD_INPUTS,
    segments: [
      { length: 1, mass: 1, damping: 3, stiffness: 90, limit: 25 },
      { length: 1.2, mass: 1.2, damping: 3, stiffness: 70, limit: 30 },
      { length: 1.4, mass: 1.4, damping: 3.5, stiffness: 50, limit: 35 },
    ],
    outputs: [{ name: 'hair_sway', scale: 1, min: -40, max: 40 }],
  },
  'short hair': {
    inputs: HEAD_INPUTS,
    segments: [{ length: 0.7, mass: 0.8, damping: 6, stiffness: 160, limit: 15 }],
    outputs: [{ name: 'hair_sway', scale: 1, min: -20, max: 20 }],
  },
  'ribbon': {
    inputs: HEAD_INPUTS,
    segments: [
      { length: 0.8, mass: 0.6, damping: 2, stiffness: 110, limit: 35 },
      { length: 1, mass: 0.5, damping: 2, stiffness: 80, limit: 45 },
    ],
    outputs: [{ name: 'ribbon_sway', scale: 1, min: -60, max: 60 }],
    wind: { strength: 6, noise: 0.8, frequency: 0.4, seed: 1 },
  },
  'cloth hem': {
    inputs: [{ name: 'body_x', weight: 1, smoothing: 0.4 }, { name: 'body_z', weight: 0.5, smoothing: 0.4 }],
    segments: [{ length: 1, mass: 2, damping: 5, stiffness: 60, limit: 12 }],
    outputs: [{ name: 'hem_sway', scale: 1, min: -15, max: 15 }],
  },
};
