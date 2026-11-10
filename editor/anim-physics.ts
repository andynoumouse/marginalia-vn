// The animation studio's Physics tab (of the rig strip under the stage, Model mode): the rig's physics chains (rig.json `physics`), a starting point from the presets, each
// chain's inputs, segments and outputs as rows of fields (▾ for what a row reads or writes) with the problems checkRig would report at their row, and a "Shake" preview that drives one of the
// chain's inputs back and forth on the stage so the animator sees the hair respond. Parameters and bone channels as
// inputs are the Params tab's own (the same ParamDef list); the stage steps the chains (PixiRenderer.studioPose).

import { addChainRow, checkPhysics, PHYSICS_CHANNELS, PHYSICS_PRESETS, problemRow, removeChainRow, setChainRow, setChainWind, type ChainList, type ParamDef, type RigPhysicsChain } from '../engine/src/index.js';
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
    // A change rebuilds the list: the field that had the focus (or the + just pressed) gets it back, so Tab goes on from there.
    const focused = this.body.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.phk : undefined;
    this.body.replaceChildren();
    const ids = Object.keys(chains);
    if (!ids.length) this.body.append(el('p', { className: 'as-pivot-hint', textContent: 'This character has no physics chains. Add one from a preset above; see docs/rig-json.md.' }));
    const targets = new Set(this.host.targets());
    for (const id of ids) this.body.append(this.card(id, chains[id], targets));
    this.root.querySelector<HTMLButtonElement>('.ph-add')!.disabled = !this.host.editable();
    if (focused) this.body.querySelector<HTMLElement>(`[data-phk="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
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
    const sum = `${chain.inputs?.length ?? 0} input${chain.inputs?.length === 1 ? '' : 's'}, ${chain.segments?.length ?? 0} segment${chain.segments?.length === 1 ? '' : 's'}, ${chain.outputs?.length ?? 0} output${chain.outputs?.length === 1 ? '' : 's'}`;
    const head = el('h4', { textContent: `${id} · ${sum}` }), btns = el('div', { className: 'ap-btns' }, shake, del);
    // Problems of a row show under that row; the rest (the chain as a whole, its wind, a cycle) under the heading.
    const atRow = new Map<string, string[]>(), general: string[] = [];
    for (const p of problems) { const r = problemRow(p), k = r && `${id}.${r.list}.${r.index}`; if (k) atRow.set(k, [...(atRow.get(k) ?? []), p]); else general.push(p); }
    const sec = el('section', { className: 'ap-group ph-chain' });
    sec.append(el('div', { className: 'ph-head' }, head, btns), ...general.map(p => el('p', { className: 'as-pivot-hint ph-problem', textContent: p })),
      el('div', { className: 'ph-tables' }, this.inputsTable(id, chain, targets, atRow), this.segmentsTable(id, chain, atRow), this.outputsTable(id, chain, targets, atRow)),
      this.windRow(id, chain));
    return sec;
  }

  // ---- the fields of a chain ----

  private commit(id: string, next: RigPhysicsChain, note: string) { this.host.set({ ...this.host.chains(), [id]: next }, note); }

  /**
   * A number field. An empty `optional` field removes its value; an empty required one, or text that is not a number, puts the
   * old value back. `key` names the field across rebuilds, so the focus stays on it after a change.
   */
  private num(key: string, label: string, value: number | undefined, write: (v: number | undefined) => void, optional = false, step = 0.1): HTMLInputElement {
    const input = document.createElement('input');
    Object.assign(input, { type: 'number', step: String(step), value: value === undefined ? '' : String(value), disabled: !this.host.editable() });
    input.dataset.phk = key;
    input.setAttribute('aria-label', label);
    if (optional) input.placeholder = '–';
    input.addEventListener('change', () => {
      const raw = input.value.trim(), v = Number(raw);
      if (raw === '' && optional) write(undefined);
      else if (raw !== '' && Number.isFinite(v)) write(v);
      else { input.value = value === undefined ? '' : String(value); this.host.note(`${label} needs a number.`); }
    });
    return input;
  }

  /** A ▾ of `options` ([value, text] pairs, grouped); a current value not among them stays, marked missing. */
  private pick(key: string, label: string, value: string, groups: [string, [string, string][]][], write: (v: string) => void): HTMLSelectElement {
    const sel = document.createElement('select');
    sel.disabled = !this.host.editable();
    sel.dataset.phk = key;
    sel.setAttribute('aria-label', label);
    for (const [name, opts] of groups) {
      if (!opts.length) continue;
      const g = el('optgroup', { label: name });
      g.append(...opts.map(([v, t]) => el('option', { value: v, textContent: t })));
      sel.append(g);
    }
    if (![...sel.options].some(o => o.value === value)) sel.prepend(el('option', { value, textContent: `${value.slice(2) || '(none)'} (missing)` }));
    sel.value = value;
    sel.addEventListener('change', () => write(sel.value));
    return sel;
  }

  /** The ✕ of a row (off when it is the list's only row: a chain needs one of each) and the + under a table. */
  private rowButtons(id: string, chain: RigPhysicsChain, list: ChainList, index: number, what: string): HTMLElement {
    const x = el('button', { type: 'button', className: 'ph-x', textContent: '✕', title: `Remove this ${what}` });
    x.setAttribute('aria-label', `Remove ${what} ${index + 1}`);
    x.disabled = !this.host.editable() || (chain[list]?.length ?? 0) <= 1;
    x.addEventListener('click', () => this.commit(id, removeChainRow(chain, list, index), `Removed ${what} ${index + 1} of chain "${id}".`));
    return el('td', {}, x);
  }
  private addButton(id: string, chain: RigPhysicsChain, list: ChainList, what: string, param?: string): HTMLButtonElement {
    const b = el('button', { type: 'button', className: 'ph-plus', textContent: `+ ${what}`, disabled: !this.host.editable() });
    b.dataset.phk = `${id}.${list}.add`;
    b.addEventListener('click', () => this.commit(id, addChainRow(chain, list, param), `Added ${what === 'segment' ? 'a' : 'an'} ${what} to chain "${id}".`));
    return b;
  }

  /** A table with its + button in the caption, its header, and its rows (each followed by its problems). */
  private table(cls: string, title: string, heads: string[], rows: [HTMLTableRowElement, string[]][], add: HTMLButtonElement): HTMLElement {
    const t = el('table', { className: `ph-table ${cls}` });
    t.append(el('caption', {}, el('span', { textContent: title }), add), el('thead', {}, el('tr', {}, ...heads.map(h => el('th', { textContent: h })), el('th', {}))));
    const body = el('tbody');
    for (const [tr, probs] of rows) {
      body.append(tr);
      if (probs.length) { tr.classList.add('ph-bad'); body.append(el('tr', { className: 'ph-problem-row' }, el('td', { colSpan: heads.length + 1, className: 'ph-problem', textContent: probs.join(' ') }))); }
    }
    t.append(body);
    return t;
  }

  private inputsTable(id: string, chain: RigPhysicsChain, targets: Set<string>, atRow: Map<string, string[]>): HTMLElement {
    const params = this.host.params(), names = [...targets];
    const rows = (chain.inputs ?? []).map((i, n): [HTMLTableRowElement, string[]] => {
      const k = `${id}.inputs.${n}`, set = (patch: Record<string, unknown>, what: string) => this.commit(id, setChainRow(chain, 'inputs', n, patch), `Chain "${id}": input ${n + 1} ${what}.`);
      const src = this.pick(`${k}.src`, `Input ${n + 1} reads`, i.bone !== undefined ? `b:${i.bone}` : `p:${i.param ?? ''}`,
        [['Parameter', params.map(p => [`p:${p.id}`, p.id])], ['Bone or part', names.map(b => [`b:${b}`, b])]],
        v => set(v.startsWith('b:') ? { bone: v.slice(2) } : { param: v.slice(2) }, `reads ${v.slice(2)}`));
      const ch = i.bone !== undefined
        ? this.pick(`${k}.channel`, `Input ${n + 1} channel`, `c:${i.channel ?? 'rot'}`, [['Channel', PHYSICS_CHANNELS.map(c => [`c:${c}`, c])]], v => set({ channel: v.slice(2) }, `reads ${v.slice(2)}`))
        : el('span', { className: 'ph-na', textContent: '–' });
      return [el('tr', {}, el('td', {}, src), el('td', {}, ch),
        el('td', {}, this.num(`${k}.weight`, `Input ${n + 1} weight`, i.weight, v => set({ weight: v }, `weight ${v}`))),
        el('td', {}, this.num(`${k}.smoothing`, `Input ${n + 1} smoothing (0 up to 1)`, i.smoothing, v => set({ smoothing: v }, v === undefined ? 'no smoothing' : `smoothing ${v}`), true, 0.05)),
        this.rowButtons(id, chain, 'inputs', n, 'input')), atRow.get(k) ?? []];
    });
    return this.table('ph-inputs', 'Inputs', ['reads', 'channel', 'weight', 'smoothing'], rows, this.addButton(id, chain, 'inputs', 'input', params[0]?.id));
  }

  private segmentsTable(id: string, chain: RigPhysicsChain, atRow: Map<string, string[]>): HTMLElement {
    const fields = [['length', 0.1], ['mass', 0.1], ['damping', 0.5], ['stiffness', 5], ['limit', 1]] as const;
    const rows = (chain.segments ?? []).map((s, n): [HTMLTableRowElement, string[]] => {
      const k = `${id}.segments.${n}`;
      return [el('tr', {}, el('td', { className: 'ph-n', textContent: String(n + 1) }),
        ...fields.map(([f, step]) => el('td', {}, this.num(`${k}.${f}`, `Segment ${n + 1} ${f}`, s[f], v => this.commit(id, setChainRow(chain, 'segments', n, { [f]: v }), `Chain "${id}": segment ${n + 1} ${f} ${v}.`), false, step))),
        this.rowButtons(id, chain, 'segments', n, 'segment')), atRow.get(k) ?? []];
    });
    return this.table('ph-segments', 'Segments', ['#', ...fields.map(f => f[0])], rows, this.addButton(id, chain, 'segments', 'segment'));
  }

  private outputsTable(id: string, chain: RigPhysicsChain, targets: Set<string>, atRow: Map<string, string[]>): HTMLElement {
    const params = this.host.params(), names = [...targets], segs = chain.segments?.length ?? 0;
    const rows = (chain.outputs ?? []).map((o, n): [HTMLTableRowElement, string[]] => {
      const k = `${id}.outputs.${n}`, set = (patch: Record<string, unknown>, what: string) => this.commit(id, setChainRow(chain, 'outputs', n, patch), `Chain "${id}": output ${n + 1} ${what}.`);
      const dst = this.pick(`${k}.dst`, `Output ${n + 1} writes`, o.part !== undefined ? `r:${o.part}` : `p:${o.param ?? ''}`,
        [['Parameter', params.map(p => [`p:${p.id}`, p.id])], ['Rotation of', names.map(b => [`r:${b}`, b])]],
        v => set(v.startsWith('r:') ? { part: v.slice(2) } : { param: v.slice(2) }, `writes ${v.slice(2)}`));
      const seg = this.pick(`${k}.segment`, `Output ${n + 1} reads segment`, o.segment === undefined ? 's:' : `s:${o.segment}`,
        [['Segment', [['s:', 'last'], ...Array.from({ length: segs }, (_, i): [string, string] => [`s:${i}`, String(i + 1)])]]],
        v => set({ segment: v === 's:' ? undefined : Number(v.slice(2)) }, v === 's:' ? 'reads the last segment' : `reads segment ${Number(v.slice(2)) + 1}`));
      return [el('tr', {}, el('td', {}, dst), el('td', {}, seg),
        el('td', {}, this.num(`${k}.scale`, `Output ${n + 1} scale`, o.scale, v => set({ scale: v }, `scale ${v}`))),
        el('td', {}, this.num(`${k}.min`, `Output ${n + 1} min`, o.min, v => set({ min: v }, v === undefined ? 'no min' : `min ${v}`), true, 1)),
        el('td', {}, this.num(`${k}.max`, `Output ${n + 1} max`, o.max, v => set({ max: v }, v === undefined ? 'no max' : `max ${v}`), true, 1)),
        this.rowButtons(id, chain, 'outputs', n, 'output')), atRow.get(k) ?? []];
    });
    return this.table('ph-outputs', 'Outputs', ['writes', 'segment', 'scale', 'min', 'max'], rows, this.addButton(id, chain, 'outputs', 'output', params[0]?.id));
  }

  /** The chain's own wind (a box and its numbers) and how much of the scene's wind reaches it. */
  private windRow(id: string, chain: RigPhysicsChain): HTMLElement {
    const w = chain.wind, k = `${id}.wind`;
    const on = document.createElement('input');
    Object.assign(on, { type: 'checkbox', checked: !!w, disabled: !this.host.editable() });
    on.dataset.phk = `${k}.on`;
    on.addEventListener('change', () => this.commit(id, setChainWind(chain, on.checked ? {} : null), `Chain "${id}": ${on.checked ? 'its own wind on' : 'no wind of its own'}.`));
    const set = (f: string) => (v: number | undefined) => this.commit(id, setChainWind(chain, { [f]: v }), `Chain "${id}": wind ${f} ${v ?? 'default'}.`);
    const own = document.createElement('label');
    own.append(on, ' Own wind');
    const row = el('div', { className: 'ph-wind' }, own);
    if (w) row.append(
      el('label', {}, 'strength ', this.num(`${k}.strength`, 'Wind strength', w.strength, v => set('strength')(v), false, 0.5)),
      el('label', {}, 'gusts ', this.num(`${k}.noise`, 'Wind gusts (0 steady to 1 gusting)', w.noise, v => set('noise')(v), true, 0.05)),
      el('label', {}, 'per s ', this.num(`${k}.frequency`, 'Gusts per second', w.frequency, v => set('frequency')(v), true, 0.1)),
      el('label', {}, 'seed ', this.num(`${k}.seed`, 'Wind seed', w.seed, v => set('seed')(v), true, 1)));
    row.append(el('label', { title: "How much of the scene's wind (the script's wind) reaches this chain: 1 all of it, 0 none, negative mirrored" }, 'scene wind × ',
      this.num(`${id}.windScale`, 'Share of the scene wind', chain.windScale, v => { const { windScale: _old, ...rest } = chain; this.commit(id, v === undefined ? rest : { ...rest, windScale: v }, `Chain "${id}": scene wind × ${v ?? 1}.`); }, true, 0.1)));
    return row;
  }
}
