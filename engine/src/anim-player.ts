// The animations running on one thing that is moved as a whole (a picture, the camera): `animate <it> <name> [loop]` plays
// a preset or transform, `animate <it> <name> auto` attaches an automatic one. It adds up their offsets each frame; the
// renderer applies the sum. Pure: the Pixi side only reads the Offset.

import { addOffset, NO_OFFSET, resolveAnim, scaleOffset, type AnimDef, type Offset } from './anim.js';
import { autoAnimations, everyBounds, startAuto, stepAuto, type AutoState } from './auto-anim.js';
import type { Value } from './expr.js';

/** One animation in progress: its offset function, its length in seconds, and how far along it is. */
interface Playing { fn: (t: number) => Partial<Offset>; dur: number; strength: number; loop: boolean; elapsed: number; done?: () => void; auto?: string }

export class AnimPlayer {
  private list: Playing[] = [];
  private autos: { names: string[]; state: AutoState | null } | null = null;

  /** `transforms`: the script's transforms by name, read when an animation starts (they can change on a hot reload). */
  constructor(private transforms: () => Record<string, AnimDef>) {}

  /** An animation is playing now (an attached automatic one that is waiting does not count): the offset is not at rest. */
  get running(): boolean { return this.list.length > 0; }

  /** Anything running or attached: false means the offset is rest and `step` has nothing to do. */
  get active(): boolean { return this.list.length > 0 || this.autos !== null; }

  /** Start animation `name` (a preset or transform): a loop replaces the running loop, not an automatic one. False for an unknown name. */
  start(name: string, dur: number | null, strength: number, loop: boolean, done?: () => void, def?: AnimDef): boolean {
    const t = this.transforms();
    const a = resolveAnim(name, def ? { ...t, [name]: def } : t);
    if (!a) return false;
    this.list = this.list.filter(f => !(loop && f.loop && !f.auto));
    this.list.push({ fn: a.fn, dur: dur ?? a.dur, strength, loop, elapsed: 0, done });
    return true;
  }

  /** `animate <it> stop`: end every animation but the automatic ones (the scheduler's); one-shots count as finished. */
  stop() {
    for (const f of this.list) if (!f.auto) f.done?.();
    this.list = this.list.filter(f => f.auto);
  }

  /** End everything, automatic ones too, without calling `done` of what was waiting (the owner is gone or being rebuilt). */
  clear() { this.list = []; this.autos = null; }

  /** `animate <it> <name> auto [off]`: the automatic transforms there are now (the state's list). */
  attach(names: string[] | undefined) {
    if (names?.length) this.autos = { names: [...names], state: this.autos?.state ?? null };
    else if (this.autos) this.autos = { names: [], state: this.autos.state }; // the scheduler stops what still runs, then forgets it
  }

  /** Run the scheduler for the attached automatic transforms: start and stop what its conditions and timers say. */
  stepAutos(seconds: number, ctx: { behaviors: boolean; reduceMotion: boolean; vars: Record<string, Value> }) {
    const a = this.autos;
    if (!a) return;
    const transforms = this.transforms();
    const entries = autoAnimations(Object.fromEntries(a.names.filter(n => Object.hasOwn(transforms, n)).map(n => [n, transforms[n]])));
    const step = stepAuto(a.state ?? startAuto(entries, Math.random), entries, seconds, { speaking: false, params: {}, ...ctx }, Math.random);
    a.state = step.state;
    if (step.stop.length) this.list = this.list.filter(f => !(f.auto && step.stop.includes(f.auto)));
    for (const name of step.start) {
      const entry = entries.find(e => e.name === name), def = resolveAnim(name, transforms);
      if (entry && def) this.list.push({ fn: def.fn, dur: def.dur, strength: 1, loop: everyBounds(entry.auto.every) === null, elapsed: 0, auto: name });
    }
    if (!entries.length) this.autos = null; // detached: its running animations were just stopped
  }

  /** Advance by `seconds` and return the summed offset, or null when nothing was running (rest). A finished one-shot calls its `done`. */
  step(seconds: number): Offset | null {
    if (!this.list.length) return null;
    let o: Offset = NO_OFFSET;
    for (const f of this.list) {
      f.elapsed += seconds;
      const t = Math.min(1, f.loop ? (f.elapsed % f.dur) / f.dur : f.elapsed / f.dur);
      o = addOffset(o, scaleOffset(f.fn(t), f.strength));
    }
    const left = this.list.filter(f => {
      if (f.loop || f.elapsed < f.dur) return true;
      f.done?.();
      return false;
    });
    const ended = left.length === 0;
    this.list = left;
    return ended ? NO_OFFSET : o;
  }

  /** The `done` callbacks of what is still running, called and dropped: for an owner that is destroyed while a `animate` waits. */
  finishAll() {
    for (const f of this.list) f.done?.();
    this.clear();
  }
}
