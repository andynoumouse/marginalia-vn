// The stage as it stands just before a script line: what the animation studio draws behind the character being placed.
// It replays the story to the line the way Preview from cursor does (Runtime.restore, menus taking their defaults), on a
// renderer that records the state and then never answers, so nothing past the line runs.

import { NullRenderer } from './null-renderer.js';
import { emptyState, Runtime } from './runtime.js';
import type { DisplayState, Program } from './types.js';

const never = () => new Promise<never>(() => {});

class Probe extends NullRenderer {
  constructor(private got: (state: DisplayState) => void) { super(); }
  async prepare(state: DisplayState) { this.got(JSON.parse(JSON.stringify(state))); }
  say() { return never(); }
  menu() { return never(); }
  input() { return never(); }
  screen() { return never(); }
}

/** The display state when the story reaches `at` (the first op at or after that line); past the end, the state it ends with. */
export async function sceneAt(program: Program, at: { file: string; line: number }): Promise<DisplayState> {
  let found: (state: DisplayState) => void = () => {};
  const got = new Promise<DisplayState>(r => { found = r; });
  const rt = new Runtime(program, new Probe(found));
  const ended = rt.restore(at).then(() => emptyState(), () => emptyState());
  try { return await Promise.race([got, ended]); }
  finally { rt.stop(); }
}
