// The animation studio's Physics tab: the rig's physics chains (rig.json `physics`), a starting point from the presets, each
// chain's numbers as editable JSON with the problems checkRig would report, and a "Shake" preview that drives one of the
// chain's inputs back and forth on the stage so the animator sees the hair respond. Parameters and bone channels as
// inputs are the Params tab's own (the same ParamDef list); the stage steps the chains (PixiRenderer.studioPose).

import { checkPhysics, PHYSICS_PRESETS, type ParamDef, type RigPhysicsChain } from '../engine/src/index.js';
import { el } from './anim-dom.js';

/** What the stage drives while shaking: a parameter, or a bone's channel, as a sine of `amp` and `hz`. */
export interface Shake { param?: string; bone?: string; channel?: string; amp: number; hz: number }

export interface PhysicsHost {
  chains(): Record<string, RigPhysicsChain>;
  /** Replace the chains (one undo step); the note to show. */
  set(next: Record<string, RigPhysicsChain>, note: string): void;
  params(): ParamDef[];
  /** Part and bone names a chain may read or rotate. */
  targets(): string[];
  editable(): boolean;
  /** Start (a drive) or stop (null) the shake preview on the stage. */
  shake(drive: Shake | null): void;
  note(text: string): void;
}

/** The preset chain's inputs and outputs as they are, a name free in `taken` for it. */
function freshId(base: string, taken: Record<string, unknown>): string {
  const id = base.replace(/\W+/g, '_').replace(/^(\d)/, '_$1') || 'chain';
  for (let n = 1; ; n++) { const c = n === 1 ? id : `${id}_${n}`; if (!Object.hasOwn(taken, c)) return c; }
}

/** The chain's first input as something to drive, with a swing that reads on the stage. */
export function shakeOf(chain: RigPhysicsChain, defs: ParamDef[]): Shake | null {
  const i = chain.inputs?.[0];
  if (!i) return null;
  if (i.param !== undefined) {
    const d = defs.find(p => p.id === i.param);
    return d ? { param: d.id, amp: (d.max - d.min) * 0.4, hz: 1.2 } : null;
  }
  return i.bone !== undefined ? { bone: i.bone, channel: i.channel ?? 'rot', amp: (i.channel ?? 'rot') === 'rot' ? 15 : 0.02, hz: 1.2 } : null;
}

export class PhysicsPanel {
  private body: HTMLElement;
  private presetSel: HTMLSelectElement;
  private shaking: string | null = null;

  constructor(private root: HTMLElement, private host: PhysicsHost) {
    this.root.innerHTML = `
      <div class="ap-bar">
        <span class="ap-pose"><select class="ph-preset" aria-label="Preset"></select><button type="button" class="ph-add" title="Add a chain made from the preset; set its inputs and outputs to this rig's parameters and parts">Add chain</button></span>
        <span class="as-pivot-hint">Chains read how their inputs change, so a held head pulls the hair once. Shake drives the first input.</span>
      </div>
      <div class="ph-body"></div>`;
    this.body = this.root.querySelector('.ph-body')!;
    this.presetSel = this.root.querySelector('.ph-preset')!;
    this.presetSel.append(...Object.keys(PHYSICS_PRESETS).map(n => el('option', { value: n, textContent: n })));
    this.root.querySelector('.ph-add')!.addEventListener('click', () => this.add());
  }

  /** A chain made from the preset, its inputs pointed at the first parameters of this rig when it has any. */
  private add() {
    const name = this.presetSel.value, preset = PHYSICS_PRESETS[name];
    if (!preset) return;
    const chains = this.host.chains(), defs = this.host.params();
    const id = freshId(name, chains);
    const inputs = preset.inputs.map((i, n) => ({ param: defs[n]?.id ?? i.name, weight: i.weight, smoothing: i.smoothing }));
    const outputs = preset.outputs.map(o => ({ param: o.name, scale: o.scale, min: o.min, max: o.max }));
    const chain: RigPhysicsChain = { inputs, segments: structuredClone(preset.segments), outputs, ...(preset.wind ? { wind: { ...preset.wind } } : {}) };
    this.host.set({ ...chains, [id]: chain }, `Added chain "${id}" from the ${name} preset. Point its inputs and outputs at this rig's parameters or parts, then Shake.`);
  }

  /** Rebuild the list (the chains changed, or the studio opened). */
  build() {
    if (this.shaking !== null && !Object.hasOwn(this.host.chains(), this.shaking)) this.stop();
    const chains = this.host.chains();
    this.body.replaceChildren();
    const ids = Object.keys(chains);
    if (!ids.length) this.body.append(el('p', { className: 'as-pivot-hint', textContent: 'This character has no physics chains. Add one from a preset above; see docs/rig-json.md.' }));
    const targets = new Set(this.host.targets());
    for (const id of ids) this.body.append(this.card(id, chains[id], targets));
    this.root.querySelector<HTMLButtonElement>('.ph-add')!.disabled = !this.host.editable();
  }

  /** Stop any shake preview (the tab or the studio closes). */
  stop() {
    if (this.shaking === null) return;
    this.shaking = null;
    this.host.shake(null);
    this.build();
  }

  private card(id: string, chain: RigPhysicsChain, targets: Set<string>): HTMLElement {
    const problems: string[] = [];
    checkPhysics({ physics: { [id]: chain }, parameters: this.host.params() }, targets, m => problems.push(m));
    const shake = el('button', { type: 'button', className: 'ph-shake', textContent: this.shaking === id ? 'Stop' : 'Shake' });
    shake.setAttribute('aria-pressed', String(this.shaking === id));
    shake.addEventListener('click', () => {
      if (this.shaking === id) { this.stop(); return; }
      const drive = shakeOf(chain, this.host.params());
      if (!drive) { this.host.note(`Chain "${id}" has no input to drive (a parameter of this rig, or a bone).`); return; }
      this.shaking = id;
      this.host.shake(drive);
      this.build();
    });
    const del = el('button', { type: 'button', textContent: 'Delete' });
    del.disabled = !this.host.editable();
    del.addEventListener('click', () => {
      const { [id]: _gone, ...rest } = this.host.chains();
      this.host.set(rest, `Deleted chain "${id}".`);
    });
    const json = JSON.stringify(chain, null, 2), text = document.createElement('textarea');
    text.className = 'ph-json';
    text.value = json;
    text.spellcheck = false;
    text.rows = Math.min(18, json.split('\n').length);
    text.setAttribute('aria-label', `Chain ${id} as JSON`);
    text.disabled = !this.host.editable();
    text.addEventListener('change', () => {
      let next: unknown;
      try { next = JSON.parse(text.value); } catch (e) { this.host.note(`Chain "${id}": ${(e as Error).message}`); return; }
      if (!next || typeof next !== 'object' || Array.isArray(next)) { this.host.note(`Chain "${id}" needs an object with inputs, segments and outputs.`); return; }
      this.host.set({ ...this.host.chains(), [id]: next as RigPhysicsChain }, `Chain "${id}" changed.`);
    });
    const sum = `${chain.inputs?.length ?? 0} input${chain.inputs?.length === 1 ? '' : 's'}, ${chain.segments?.length ?? 0} segment${chain.segments?.length === 1 ? '' : 's'}, ${chain.outputs?.length ?? 0} output${chain.outputs?.length === 1 ? '' : 's'}`;
    const head = el('h4', { textContent: `${id} · ${sum}` }), btns = el('div', { className: 'ap-btns' }, shake, del);
    const notes: HTMLElement[] = problems.map(p => el('p', { className: 'as-pivot-hint ph-problem', textContent: p }));
    const sec = el('section', { className: 'ap-group ph-chain' });
    sec.append(head, btns, text, ...notes);
    return sec;
  }
}
