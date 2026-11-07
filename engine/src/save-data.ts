// The saved form of a playthrough: what a save slot holds, how it is taken from a Runtime and put back. The
// Runtime keeps the parts of loading that are about running (stopping, the renderer, hints, continuing).

import type { Value } from './expr.js';
import type { Runtime } from './runtime.js';
import type { Answer, DisplayState, SayEvent, Vars } from './types.js';

export interface SaveData {
  pc: number;
  stack: number[];
  /** Saved values of the callee's parameters, one per stack entry (null: none; see Runtime.frames). */
  frames?: (Record<string, Value | null> | null)[];
  vars: Vars;
  state: DisplayState;
  choices: Answer[];
  unlocks?: string[];
  unlockedBase?: string[];
  /** Menu options taken (see Runtime.seen): the ones from before the playthrough, and its own. */
  seenBase?: string[];
  seen?: string[];
  /** Persistent data: the values when the playthrough began, and its own changes (see Runtime.persistentBase). */
  persistentBase?: Record<string, Value>;
  persistent?: Record<string, Value>;
  /** Random generator: the playthrough's seed and the current state (see Runtime.seed). */
  seed?: number;
  rng?: number;
  nvl?: boolean;
  page?: SayEvent[];
}

/** The runtime's state as a save: a deep copy, so later play does not change it. */
export function takeSave(rt: Runtime): SaveData {
  return JSON.parse(JSON.stringify({
    pc: rt.pc, stack: rt.stack, frames: rt.frames, vars: rt.vars, state: rt.state, choices: rt.choices,
    unlocks: rt.unlocks, unlockedBase: rt.unlockedBase, seenBase: rt.seenBase, seen: rt.seen, persistentBase: rt.persistentBase, persistent: rt.persistent,
    seed: rt.seed, rng: rt.rng, nvl: rt.nvl, page: rt.page,
  }));
}

/** Put a save's state into the runtime (copies, so playing on does not change `data`). Saves from older versions lack some fields: the runtime's own stay. */
export function putSave(rt: Runtime, data: SaveData) {
  rt.pc = data.pc;
  rt.stack = [...data.stack];
  rt.frames = data.stack.map((_, i) => data.frames?.[i] ?? null);
  rt.vars = { ...data.vars };
  rt.state = JSON.parse(JSON.stringify(data.state));
  rt.choices = [...data.choices];
  rt.unlocks = [...(data.unlocks ?? [])];
  if (data.unlockedBase) rt.unlockedBase = [...data.unlockedBase];
  if (data.seenBase) rt.seenBase = [...data.seenBase];
  rt.seen = [...(data.seen ?? [])];
  if (data.persistentBase) rt.persistentBase = { ...data.persistentBase };
  rt.persistent = { ...data.persistent };
  if (data.seed !== undefined) rt.seed = data.seed;
  rt.rng = data.rng ?? rt.seed;
  rt.nvl = data.nvl ?? false;
  rt.page = data.page ?? [];
}
