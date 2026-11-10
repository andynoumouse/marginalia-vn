// The animation studio's Parameters section: a slider for each rig.json parameter and a 2D pad for each pair, grouped, with a
// key button per control, a reset, and poses (apply one, save the current values as one). It holds the values the animator
// sets by hand (`base`); `hold` are the ones being moved right now, which win over the animation's tracks until the
// playhead moves. What the stage shows is the same evaluation as the game (displayValues in engine/src/param-tracks.ts).
//
// The key button differs by mode, as the two modes do (docs/design/studio-ux.md). Animate: it writes a key of the control at the
// playhead into the animation. Model works as Live2D Cubism does, parameter first: the author picks the parameter, explicitly (a
// click on its row, which is then highlighted; nothing is guessed from the last control used or from the chosen part), and the
// active parameter is what the Bind block below (editor/anim-bind.ts), the stage and the Parts tree bind parts to and pose them on.
// The key button adds or removes a key of the chosen part at the value; a pad's corners are the keys, so its button is not drawn.
// Model mode also adds controls (the + menus: new parameter and pad) and deletes them (✕); a control's own properties (name, category,
// range, default, ease) are the right column's Parameter section (editor/anim-param-props.ts), shown when its name is clicked.

import {
  changedParams, controlGroups, displayValues, OTHER, paramKeys,
  type AnimDef, type FormValue, type KeySpot, type KeyTick, type PadDef, type ParamDef, type PadSpec, type PoseDef,
} from '../engine/src/index.js';
import { el } from './anim-dom.js';
import { ContextMenu } from './context-menu.js';

export type Corner = { x: number; y: number; authored: boolean };
export type FormField = keyof FormValue;

export interface ParamHost {
  defs(): ParamDef[];
  pads(): PadDef[];
  anim(): AnimDef | null;
  editable(): boolean;
  /** Animate mode: the controls key the animation (key buttons, the parameter key fields). */
  keying(): boolean;
  /** Model mode: the controls author keyforms (parameter first: the active parameter, the parts bound to it) and can be edited. */
  authoring(): boolean;
  /** The controls were redrawn from new values: whatever shows the keys at them (the Bind block) draws again. */
  synced(): void;
  time(): number;
  poses(): Record<string, PoseDef>;
  /** The hand-set values or the held ids changed: the stage draws them. */
  moved(): void;
  /** Key `values` at the playhead of the animation on show (one undo step). */
  key(values: Record<string, number>): void;
  note(text: string): void;
  // ---- Model mode: keyform authoring ----
  /** The control a drag writes to: a parameter id (a slider, or one axis of a pad) or `pad:<id>` (the pad's grid); the one the author picked, or null while none is. */
  keyedControl(): string | null;
  chooseControl(control: string): void;
  /** Where the chosen part or bone (every one when none is chosen) has keys of this parameter, and whether each holds a pose. */
  ticks(param: string): KeyTick[];
  corners(x: string, y: string): Corner[];
  /** Is there a keyform at `spot` on the chosen part or bone? Null while none is chosen. */
  isKeyed(spot: KeySpot): boolean | null;
  /** The ◆: make `control` the active parameter, keeping the chosen part, and key the part (or the bone it follows) at `spot` as it stands, or remove the key that is there; a part not bound yet is bound first. */
  keyFromControl(control: string, spot: KeySpot): void;
  addGridLine(params: [string, string], axis: 'x' | 'y', value: number): void;
  // ---- Model mode: the controls themselves; each returns the id the thing has afterwards, null when refused (the note says why) ----
  /** The categories, in order; each returns the name the category has afterwards (null: refused). `moveControlTo` puts a control (a parameter id or `pad:<id>`) in a category (null: Other), in front of `before` when that is given. */
  categories(): string[];
  addCategory(): string | null;
  renameCategory(from: string, to: string): string | null;
  deleteCategory(name: string): void;
  /** Category `name` in front of category `before`, or last when that is left out. */
  moveCategory(name: string, before?: string): void;
  moveControlTo(control: string, category: string | null, before?: string): void;
  /** A new parameter or pad, in `category` when one is given. */
  addParam(category?: string): string | null;
  addPad(category: string | undefined, spec: PadSpec): string | null;
  deleteParam(id: string): void;
  deletePad(id: string): void;
  /** A control was just made and is the focus: its Parameter section shows with the name ready to type. */
  created(control: string): void;
}

type View = (v: Record<string, number>, keyed: boolean, tracked: boolean) => void;
interface Entry { ids: string[]; spot(): KeySpot | null; view: View; row: HTMLElement; name: HTMLElement; axesHint?: HTMLElement }

const KEY_NEAR = 0.0015;
/** Model mode: a pad's dot jumps onto a grid corner this close (screen pixels). */
const CORNER_SNAP = 8;
/** More controls than this and only the first group starts open. */
const LONG = 8;
/** More parameters than this get a filter field (a Cubism rig has hundreds). */
const FILTER_MIN = 12;
const step = (d: ParamDef) => { const span = d.max - d.min; return span > 20 ? 1 : span > 2 ? 0.05 : 0.01; };
const shown = (v: number) => String(Math.round(v * 1000) / 1000);
/** A range or number input over the span of parameter `d`. */
function numberInput(type: 'range' | 'number', d: ParamDef): HTMLInputElement {
  const i = document.createElement('input');
  i.type = type;
  i.min = String(d.min); i.max = String(d.max); i.step = String(step(d));
  return i;
}
const clamp = (d: ParamDef, v: number) => Math.min(d.max, Math.max(d.min, v));
/** A category header's fold arrow occupies this many pixels from its left edge; a click further right is on the name. */
const ARROW_WIDTH = 18;
function textField(size: number): HTMLInputElement {
  const i = document.createElement('input');
  i.type = 'text'; i.size = size; i.spellcheck = false; i.autocomplete = 'off';
  return i;
}
function selectOf(options: [value: string, text: string][]): HTMLSelectElement {
  const s = document.createElement('select');
  for (const [value, text] of options) s.append(el('option', { value, textContent: text }));
  return s;
}

export class ParamPanel {
  /** The values set by hand; a parameter not in here is at its default. */
  base: Record<string, number> = {};
  /** Parameters being moved by hand: they win over the animation's tracks until the playhead moves. */
  hold = new Set<string>();
  private body: HTMLElement;
  private views = new Map<string, Entry>();
  private folded = new Map<string, boolean>();
  private filter: HTMLInputElement;

  constructor(private root: HTMLElement, private host: ParamHost) {
    this.root.innerHTML = `
      <div class="ap-bar">
        <input type="search" class="ap-filter" placeholder="Filter parameters" aria-label="Filter parameters by name" spellcheck="false" autocomplete="off" hidden>
      </div>
      <div class="ap-body"></div>`;
    const q = <T extends Element>(s: string) => this.root.querySelector<T>(s)!;
    this.body = q('.ap-body');
    this.filter = q('.ap-filter');
    this.filter.addEventListener('input', () => this.applyFilter());
  }

  /** Every parameter back to its default. */
  resetAll() { for (const d of this.host.defs()) this.set(d.id, d.default); this.commit(); }

  /** Key every parameter that differs from its default at the playhead (Animate). */
  keyChanged() {
    const values = changedParams(this.host.defs(), this.values());
    if (!Object.keys(values).length) { this.host.note('Nothing differs from the defaults yet; move a control first.'); return; }
    this.host.key(values);
  }

  /** Put the parameters a pose names at its values. */
  usePose(name: string) {
    const pose = this.host.poses()[name];
    if (!pose) return;
    for (const d of this.host.defs()) if (Object.hasOwn(pose, d.id)) this.set(d.id, clamp(d, pose[d.id]));
    this.commit();
  }

  /** Model mode: a + button's menu adds a slider or a pad (in `category`, when the button is a category's); it becomes the focus, its properties on show. */
  add(kind: 'param' | 'pad', category?: string) {
    if (kind === 'param') { this.drafting = null; this.created(this.host.addParam(category)); return; }
    this.drafting = { category }; // a pad is not made until its parameters are picked in the form
    this.build();
    this.body.querySelector<HTMLElement>('.ap-draft input')?.focus();
  }
  /** Model mode: the open "new pad" form, if any. */
  drafting: { category?: string } | null = null;

  /** The form for a new pad: a name, and for each axis an existing free parameter or a new one. Nothing is chosen for the author. */
  private padDraft(): HTMLElement {
    const form = el('div', { className: 'ap-editor ap-draft ap-model-only' });
    form.setAttribute('role', 'group'); form.setAttribute('aria-label', 'New pad');
    form.append(el('strong', { textContent: 'New pad' }), el('small', { className: 'ap-hint', textContent: 'A pad moves two parameters on one 2D control. Both start as new parameters; pick an existing one instead if you want.' }));
    const name = this.field(form, 'name', textField(12));
    name.placeholder = 'pad'; name.setAttribute('aria-label', 'Name of the new pad');
    name.addEventListener('input', () => { const at = name.selectionStart; const clean = name.value.replace(/\s/g, '_').replace(/\W/g, ''); if (clean !== name.value) { name.value = clean; name.setSelectionRange(at, at); } });
    const taken = new Set(this.host.pads().flatMap(p => [p.x, p.y]));
    const NEW = '+new';
    const axis = (text: string) => {
      const sel = selectOf([[NEW, '＋ New parameter'], ...this.host.defs().filter(p => !taken.has(p.id)).map((p): [string, string] => [p.id, p.id])]);
      sel.setAttribute('aria-label', `${text} parameter of the new pad`);
      return this.field(form, text, sel);
    };
    const x = axis('across'), y = axis('up');
    const create = el('button', { type: 'button', className: 'ap-apply', textContent: 'Create pad' });
    const cancel = el('button', { type: 'button', className: 'ap-cancel', textContent: 'Cancel' });
    const ready = () => {
      const dup = x.value !== '' && x.value !== NEW && x.value === y.value;
      create.disabled = dup;
      create.title = dup ? 'Across and up need two different parameters' : '';
    };
    x.addEventListener('change', ready); y.addEventListener('change', ready); ready();
    const done = () => { this.drafting = null; this.build(); };
    cancel.addEventListener('click', done);
    create.addEventListener('click', () => {
      const spec: PadSpec = { id: name.value.trim() || undefined, x: x.value === NEW ? null : x.value, y: y.value === NEW ? null : y.value };
      const id = this.host.addPad(this.drafting?.category, spec);
      if (id === null) return; // refused: the host said why, and the form stays
      this.drafting = null;
      this.created(id, 'pad:');
    });
    form.addEventListener('keydown', e => { if (e.key === 'Escape') done(); else if (e.key === 'Enter' && !create.disabled && e.target instanceof HTMLInputElement) create.click(); });
    form.append(el('div', { className: 'ap-draft-btns' }, create, cancel));
    return form;
  }

  /** Model mode: a new category, its name ready to type over. */
  addCategory() {
    const name = this.host.addCategory();
    if (name === null) return;
    this.build();
    this.renaming(name);
  }

  /** The values the stage shows now: the hand-set ones with the animation's tracks over them. */
  values(): Record<string, number> {
    return displayValues(this.host.defs(), this.base, this.host.anim(), this.host.time(), this.hold);
  }

  /** Where a keyform is written for control `ctl` (a parameter id, or `pad:<id>`) at the values shown now. */
  spotOf(ctl: string): KeySpot | null {
    const v = this.values();
    if (ctl.startsWith('pad:')) {
      const pad = this.host.pads().find(p => p.id === ctl.slice(4));
      return pad && Object.hasOwn(v, pad.x) && Object.hasOwn(v, pad.y) ? { params: [pad.x, pad.y], at: [v[pad.x], v[pad.y]] } : null;
    }
    return Object.hasOwn(v, ctl) ? { param: ctl, value: v[ctl] } : null;
  }

  private set(id: string, v: number) {
    this.base[id] = v;
    this.hold.add(id);
  }
  private commit() {
    this.host.moved();
    this.sync();
  }

  /** Move one parameter's control from elsewhere in the studio (the Warp tool's slider moves); clamped to its range. */
  setValue(id: string, v: number) {
    const d = this.host.defs().find(x => x.id === id);
    if (d && Number.isFinite(v)) { this.set(id, clamp(d, v)); this.commit(); }
  }

  /** The playhead moved or the animation changed: the hand-held values give way to the tracks. */
  release() { if (this.hold.size) { this.hold.clear(); this.host.moved(); } }

  /** A new opening of the studio: no hand-set values, nothing open. */
  reset() {
    this.base = {};
    this.hold.clear();
    this.folded.clear();
  }

  /** A parameter was renamed: its hand-set value moves with it. */
  rename(from: string, to: string) {
    if (Object.hasOwn(this.base, from)) { this.base[to] = this.base[from]; delete this.base[from]; }
    if (this.hold.delete(from)) this.hold.add(to);
  }

  /** The control just made: make it the focus, show it, and hand it to the Parameter section. */
  private created(id: string | null, prefix = '') {
    if (id === null) return;
    this.host.chooseControl(prefix + id);
    this.build();
    this.host.created(prefix + id);
    this.root.querySelector(`[data-ctl="${CSS.escape(prefix + id)}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  /** Rebuild the controls (once per opening, and whenever a parameter or pad was added, changed or deleted); hand-set values of what remains are kept. */
  build() {
    this.views.clear();
    const defs = this.host.defs();
    this.base = Object.fromEntries(defs.filter(d => Object.hasOwn(this.base, d.id)).map(d => [d.id, clamp(d, this.base[d.id])]));
    for (const id of [...this.hold]) if (!defs.some(d => d.id === id)) this.hold.delete(id);
    this.body.replaceChildren();
    if (!defs.length) this.body.append(el('p', { className: 'as-pivot-hint', textContent: this.host.authoring()
      ? "This character has no parameters yet. New parameter adds a slider and New pad a 2D control. Click a control's name to make it the active parameter, then pick the parts it moves on the stage or in the Parts tree."
      : 'This character has no parameters. Add them in Model mode (or "parameters" to its rig.json); see docs/rig-json.md.' }));
    if (this.drafting) this.body.append(this.padDraft());
    const groups = controlGroups(defs, this.host.pads(), this.host.categories());
    // A long list starts with its first category open; a short one is open throughout.
    const open = groups.reduce((n, g) => n + g.controls.length, 0) <= LONG ? groups.length : 1;
    const editKey = (c: { kind: 'slider'; param: ParamDef } | { kind: 'pad'; pad: PadDef }) => (c.kind === 'slider' ? c.param.id : `pad:${c.pad.id}`);
    groups.forEach((g, i) => {
      const real = g.name !== OTHER; // Other is where controls without a category show: it has no name to change and cannot be deleted or moved
      const fold = el('button', { type: 'button', className: 'ap-fold', textContent: g.name });
      const head = el('h4', {}, fold);
      const sec = el('section', { className: 'ap-group' }, head);
      sec.dataset.cat = g.name;
      const rows = el('div', { className: 'ap-rows' });
      const axes = new Set<string>(); // a pad's two sliders follow it, right under it, and do not move on their own
      for (const c of g.controls) {
        if (c.kind === 'pad') { axes.add(c.x.id); axes.add(c.y.id); }
        rows.append(...(c.kind === 'slider' ? this.slider(c.param, axes.has(c.param.id)) : this.pad(c.pad, c.x, c.y)));
      }
      if (!g.controls.length) rows.append(el('p', { className: 'as-pivot-hint ap-empty', textContent: 'Empty: drag parameters here, or use +.' }));
      const show = (on: boolean) => { rows.hidden = !on; fold.setAttribute('aria-expanded', String(on)); this.folded.set(g.name, on); };
      // Model mode: the arrow folds, the name of a real category starts its rename; elsewhere the whole header folds.
      fold.addEventListener('click', e => {
        if (real && this.host.authoring() && e.clientX - fold.getBoundingClientRect().left > ARROW_WIDTH) this.renaming(g.name);
        else show(rows.hidden);
      });
      if (real) fold.title = 'Click the arrow to fold, the name to rename (Model mode)';
      show((this.folded.get(g.name) ?? i < open) || g.controls.some(c => editKey(c) === this.host.keyedControl()));
      head.append(...this.categoryButtons(g.name, real));
      this.dropTarget(sec, g.name, real);
      if (real) this.dragSource(head, { kind: 'category', id: g.name });
      sec.append(rows);
      this.body.append(sec);
    });
    this.filter.hidden = defs.length <= FILTER_MIN;
    this.applyFilter();
    this.sync();
  }

  // ---- categories (Model mode) ----

  /** The + on a category's header, its only button: its menu adds a parameter or a pad here and, for a real category, renames or deletes it. */
  private categoryButtons(name: string, real: boolean): HTMLElement[] {
    const add = el('button', { type: 'button', className: 'ap-cat-btn ap-cat-add ap-model-only', textContent: '+', title: `Add to ${name}${real ? ', or rename or delete it' : ''}` });
    add.setAttribute('aria-label', add.title);
    add.setAttribute('aria-haspopup', 'menu');
    add.addEventListener('click', e => (this.menu ??= new ContextMenu(this.root)).open(e, add, [
      { label: 'New parameter', title: 'Add a parameter (a slider)', run: () => this.add('param', real ? name : undefined) },
      { label: 'New pad', title: 'Add a pad: two parameters on one 2D control', run: () => this.add('pad', real ? name : undefined) },
      ...(real ? [
        { label: 'Rename category', title: `Rename ${name}; its controls follow`, run: () => this.renaming(name) },
        { label: 'Delete category', title: `Delete ${name}; its controls move to Other`, run: () => this.host.deleteCategory(name) },
      ] : []),
    ]));
    return [add];
  }

  /** The header of category `name` becomes a text field: Enter or leaving it renames, Esc keeps the name. */
  private renaming(name: string) {
    const fold = this.body.querySelector<HTMLElement>(`.ap-group[data-cat="${CSS.escape(name)}"] .ap-fold`);
    if (!fold) return;
    const input = textField(14);
    input.className = 'ap-cat-name';
    input.value = name;
    input.setAttribute('aria-label', `Name of the category ${name}`);
    fold.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (keep: boolean) => {
      if (done) return;
      done = true;
      const to = input.value.trim();
      if (keep && to !== name) {
        if (this.folded.has(name)) this.folded.set(to, this.folded.get(name)!);
        if (this.host.renameCategory(name, to) !== null) return; // the studio redraws the panel
      }
      this.build();
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); });
    input.addEventListener('blur', () => finish(true));
  }

  /** What a drag in the panel carries: a control (a parameter id or `pad:<id>`) or a category. */
  private dragging: { kind: 'control' | 'category'; id: string } | null = null;
  private menu: ContextMenu | null = null;

  /** Make `handle` draggable in Model mode. */
  private dragSource(handle: HTMLElement, what: { kind: 'control' | 'category'; id: string }) {
    handle.draggable = true;
    handle.addEventListener('dragstart', e => {
      if (!this.host.authoring()) { e.preventDefault(); return; }
      this.dragging = what;
      e.dataTransfer?.setData('text/plain', what.id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      this.root.classList.add('ap-dragging');
    });
    handle.addEventListener('dragend', () => { this.dragging = null; this.root.classList.remove('ap-dragging'); for (const s of this.body.querySelectorAll('.ap-drop')) s.classList.remove('ap-drop'); });
  }

  /** A category's section takes the controls dropped on it (in front of the row under the pointer) and, for a real one, a category dropped to reorder. */
  private dropTarget(sec: HTMLElement, name: string, real: boolean) {
    const accepts = () => !!this.dragging && this.host.authoring() && (this.dragging.kind === 'control' || (real && this.dragging.id !== name));
    sec.addEventListener('dragover', e => { if (accepts()) { e.preventDefault(); sec.classList.add('ap-drop'); } });
    sec.addEventListener('dragleave', e => { if (!sec.contains(e.relatedTarget as Node | null)) sec.classList.remove('ap-drop'); });
    sec.addEventListener('drop', e => {
      sec.classList.remove('ap-drop');
      const what = this.dragging;
      if (!what || !accepts()) return;
      e.preventDefault();
      this.dragging = null;
      if (what.kind === 'category') {
        // The upper half of the target puts the category in front of it, the lower half after it.
        const r = sec.getBoundingClientRect(), cats = this.host.categories(), at = cats.indexOf(name);
        this.host.moveCategory(what.id, e.clientY < r.top + r.height / 2 ? name : cats[at + 1]);
        return;
      }
      const pad = what.id.startsWith('pad:');
      const rows = [...sec.querySelectorAll<HTMLElement>(pad ? '.ap-padrow' : '.ap-row:not(.ap-axisrow)')].filter(r => r.dataset.ctl !== what.id);
      const next = rows.find(r => { const b = r.getBoundingClientRect(); return e.clientY < b.top + b.height / 2; });
      this.host.moveControlTo(what.id, real ? name : null, next?.dataset.ctl);
    });
  }

  /** A long list is narrowed by the filter field: rows whose name has no match are hidden, and a group with none left. */
  private applyFilter() {
    const q = this.filter.hidden ? '' : this.filter.value.trim().toLowerCase();
    for (const group of this.body.querySelectorAll<HTMLElement>('.ap-group')) {
      let shown = 0;
      for (const row of group.querySelectorAll<HTMLElement>('.ap-row, .ap-padrow')) {
        const hide = q !== '' && !(row.dataset.ctl ?? '').toLowerCase().includes(q);
        row.classList.toggle('ap-filtered', hide);
        if (!hide) shown++;
      }
      group.classList.toggle('ap-filtered', q !== '' && shown === 0);
    }
  }

  /** Model mode: the author picked this control (a click on its row or its name) and it becomes the active parameter. Nothing is guessed. */
  private pick(ctl: string, e?: MouseEvent, viaName = false) {
    if (!this.host.authoring()) return;
    if (this.host.keyedControl() !== ctl) this.host.chooseControl(ctl);
  }

  /** The key and reset buttons every control has; `ids` are the parameters they act on, `ctl` the control key the key button writes keyforms for. */
  private buttons(ids: string[], label: string, ctl: () => string) {
    const key = el('button', { type: 'button', className: 'ap-key', textContent: '◆' });
    key.addEventListener('click', () => {
      if (this.host.authoring()) {
        const k = ctl(), spot = this.spotOf(k);
        if (spot) this.host.keyFromControl(k, spot); else this.host.chooseControl(k);
        return;
      }
      const v = this.values();
      this.host.key(Object.fromEntries(ids.map(id => [id, v[id]])));
    });
    const reset = el('button', { type: 'button', className: 'ap-reset', textContent: '↺', title: `Reset ${label} to its default` });
    reset.setAttribute('aria-label', `Reset ${label}`);
    reset.addEventListener('click', () => { for (const d of this.host.defs()) if (ids.includes(d.id)) this.set(d.id, d.default); this.commit(); });
    const paint = (keyed: boolean, tracked: boolean, model: boolean, hasTarget: boolean) => {
      key.classList.toggle('ap-keyed', keyed);
      key.classList.toggle('ap-tracked', tracked && !keyed);
      key.setAttribute('aria-pressed', String(keyed));
      key.title = model
        ? this.host.authoring()
          ? (keyed ? `Remove the key of the chosen part on ${label} at this value` : `Add a key for the chosen part on ${label} at this value (binds the part first when it is not bound)`)
          : (keyed ? `Unkey ${label}: remove the keyform of the chosen part at this value` : `Key ${label}: store the chosen part's pose as its keyform at this value`)
        : `Key ${label} at the playhead`;
      key.setAttribute('aria-label', key.title);
      key.disabled = model ? !hasTarget : !this.host.editable();
    };
    return { key, reset, paint };
  }

  /** Model mode: the ✕ on a row deletes the control (one undo step; the host's note says when it is refused). */
  private removeButton(label: string, title: string, run: () => void): HTMLButtonElement {
    const b = el('button', { type: 'button', className: 'ap-del-btn ap-model-only', textContent: '✕', title });
    b.setAttribute('aria-label', `Delete ${label}`);
    b.addEventListener('click', run);
    return b;
  }

  /** Add a labelled field to a form. */
  private field<T extends HTMLElement>(form: HTMLElement, text: string, input: T): T {
    form.append(el('label', {}, `${text} `, input));
    return input;
  }

  private slider(d: ParamDef, axis = false): HTMLElement[] {
    const range = numberInput('range', d);
    range.setAttribute('aria-label', d.id);
    const num = numberInput('number', d);
    num.className = 'ap-num';
    num.setAttribute('aria-label', `${d.id} value`);
    const ticks = el('span', { className: 'ap-ticks' });
    const { key, reset, paint } = this.buttons([d.id], d.id, () => d.id);
    const input = (raw: string) => { const v = Number(raw); if (raw !== '' && Number.isFinite(v)) { this.pick(d.id); this.set(d.id, clamp(d, v)); this.commit(); } };
    range.addEventListener('input', () => input(range.value));
    num.addEventListener('change', () => input(num.value));
    const label = el('label', { textContent: d.id, title: 'Make this the active parameter' });
    this.nameKeys(label, () => this.pick(d.id, undefined, true));
    if (!axis) this.dragSource(label, { kind: 'control', id: d.id });
    const row = el('div', { className: `ap-row${axis ? ' ap-axisrow' : ''}` }, label, el('div', { className: 'ap-track' }, range, ticks), num, key,
      el('span', { className: 'ap-tools' }, reset, this.removeButton(d.id, `Delete ${d.id} and the keyforms, pose values and tracks that use it`, () => this.host.deleteParam(d.id))));
    row.dataset.ctl = d.id;
    row.addEventListener('click', e => this.pick(d.id, e));
    const at =(v: number) => (v - d.min) / (d.max - d.min);
    this.views.set(d.id, {
      ids: [d.id], row, name: label,
      spot: () => this.spotOf(d.id),
      view: (v, keyed, tracked) => {
        const model = this.host.authoring();
        if (document.activeElement !== num) num.value = shown(v[d.id]);
        range.value = String(v[d.id]);
        paint(keyed, tracked, model, this.host.isKeyed({ param: d.id, value: v[d.id] }) !== null);
        const first = this.host.authoring();
        ticks.replaceChildren(...(model ? this.host.ticks(d.id) : []).map(({ at: t, posed }) => {
          const tick = el('button', { type: 'button', className: `ap-tick${first && !posed ? ' ap-rest' : ''}`, title: `${first ? (posed ? 'Posed' : 'At rest') : 'Keyed'} at ${shown(t)}: click to set ${d.id} to ${shown(t)}`, tabIndex: -1 });
          tick.style.setProperty('--f', String(at(t)));
          tick.addEventListener('mousedown', e => e.preventDefault()); // no focus: the row would be redrawn under the click
          tick.addEventListener('click', () => { this.set(d.id, clamp(d, t)); this.commit(); });
          return tick;
        }));
        const active = model && this.host.keyedControl() === d.id;
        row.classList.toggle('ap-active', active);
        this.paintName(label, active);
      },
    });
    return [row];
  }

  private pad(pad: PadDef, x: ParamDef, y: ParamDef): HTMLElement[] {
    const id = pad.id, gridKey = `pad:${id}`;
    const area = el('div', { className: 'ap-pad', tabIndex: 0 });
    area.setAttribute('role', 'application');
    area.setAttribute('aria-label', `${id}: ${x.id} across, ${y.id} up. Arrow keys nudge it`);
    const corners = el('span', { className: 'ap-corners' });
    const dot = el('div', { className: 'ap-dot' });
    area.append(corners, dot);
    // The key button writes the pad's grid, or one axis when that axis's slider row was picked instead.
    const own = () => { const k = this.host.keyedControl(); return k === x.id || k === y.id ? k : gridKey; };
    const { key, reset, paint } = this.buttons([x.id, y.id], id, own);
    const axes = el('span', { className: 'ap-axes ap-model-only' });
    for (const [axis, param, text] of [['x', x, 'column'], ['y', y, 'row']] as const) {
      const b = el('button', { type: 'button', className: 'ap-grid-add', textContent: `+ ${text}`, title: `Add a grid line at the dot's ${param.id} value, so a corner sits exactly there` });
      b.addEventListener('click', () => this.host.addGridLine([x.id, y.id], axis, this.values()[param.id]));
      axes.append(b);
    }
    const at = (px: number, py: number) => {
      const r = area.getBoundingClientRect(), fx = Math.min(1, Math.max(0, (px - r.left) / r.width)), fy = Math.min(1, Math.max(0, (py - r.top) / r.height));
      if (!this.owns(x.id, y.id, gridKey)) this.pick(gridKey);
      let vx = x.min + fx * (x.max - x.min), vy = y.max - fy * (y.max - y.min);
      if (this.host.authoring()) { // the corners are the keys: the dot snaps onto one within a few pixels
        const hit = this.host.corners(x.id, y.id).find(c => Math.hypot(((c.x - x.min) / (x.max - x.min) - fx) * r.width, ((1 - (c.y - y.min) / (y.max - y.min)) - fy) * r.height) <= CORNER_SNAP);
        if (hit) { vx = hit.x; vy = hit.y; }
      }
      this.set(x.id, vx);
      this.set(y.id, vy);
      this.commit();
    };
    area.addEventListener('pointerdown', e => {
      area.setPointerCapture(e.pointerId);
      at(e.clientX, e.clientY);
      const move = (m: PointerEvent) => at(m.clientX, m.clientY);
      const up = () => { area.removeEventListener('pointermove', move); area.removeEventListener('pointerup', up); };
      area.addEventListener('pointermove', move);
      area.addEventListener('pointerup', up);
    });
    area.addEventListener('keydown', e => {
      const dx = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0, dy = e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0;
      if (!dx && !dy) return;
      e.preventDefault();
      const v = this.values(), big = e.shiftKey ? 0.1 : 0.02;
      this.set(x.id, clamp(x, v[x.id] + dx * big * (x.max - x.min)));
      this.set(y.id, clamp(y, v[y.id] + dy * big * (y.max - y.min)));
      this.commit();
    });
    const label = el('label', { textContent: id, title: 'Make this the active parameter' });
    this.nameKeys(label, () => { if (!this.owns(x.id, y.id, gridKey)) this.pick(gridKey, undefined, true); });
    this.dragSource(label, { kind: 'control', id: gridKey });
    const row = el('div', { className: 'ap-padrow' }, label, area, el('span', { className: 'ap-btns' }, key, reset, this.removeButton(id, `Delete the pad ${id}; its parameters and their keyforms stay`, () => this.host.deletePad(id))), axes);
    row.dataset.ctl = gridKey;
    row.addEventListener('click', e => { if (!this.owns(x.id, y.id, gridKey)) this.pick(gridKey, e); });
    const fx = (v: number) => ((v - x.min) / (x.max - x.min)) * 100, fy = (v: number) => (1 - (v - y.min) / (y.max - y.min)) * 100;
    this.views.set(gridKey, {
      ids: [x.id, y.id], row, name: label,
      spot: () => this.spotOf(own()),
      view: (v, keyed, tracked) => {
        const model = this.host.authoring();
        dot.style.left = `${fx(v[x.id])}%`;
        dot.style.top = `${fy(v[y.id])}%`;
        const spot = this.spotOf(own());
        paint(keyed, tracked, model, !!spot && this.host.isKeyed(spot) !== null);
        const cs = model ? this.host.corners(x.id, y.id) : [];
        const near = cs.length ? cs.reduce((b, c) => (Math.hypot((c.x - v[x.id]) / (x.max - x.min), (c.y - v[y.id]) / (y.max - y.min)) < Math.hypot((b.x - v[x.id]) / (x.max - x.min), (b.y - v[y.id]) / (y.max - y.min)) ? c : b)) : null;
        axes.hidden = !cs.length; // the grid lines belong to the bound part: with none bound there is no grid to extend
        corners.replaceChildren(...cs.map(c => {
          const d = el('span', { className: `ap-corner${c.authored ? ' ap-authored' : ''}${near === c && this.host.keyedControl() === gridKey ? ' ap-near' : ''}` });
          d.style.left = `${fx(c.x)}%`;
          d.style.top = `${fy(c.y)}%`;
          d.title = `${x.id} ${shown(c.x)}, ${y.id} ${shown(c.y)}${c.authored ? ' (posed)' : ' (at rest)'}`;
          return d;
        }));
        const keyedCtl = this.host.keyedControl();
        const active = model && !!keyedCtl && [gridKey, x.id, y.id].includes(keyedCtl);
        row.classList.toggle('ap-active', active);
        this.paintName(label, active);
        key.hidden = this.host.authoring(); // a pad's keys are its grid corners: bound with the part, posed with the gizmo
      },
    });
    return [row];
  }
  private owns(x: string, y: string, grid: string): boolean { const k = this.host.keyedControl(); return k === x || k === y || k === grid; }

  /** Model mode: a control's name is a button (Tab reaches it, Enter or Space picks it); in Animate it is a plain label. */
  private nameKeys(label: HTMLElement, pick: () => void) {
    label.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && this.host.authoring()) { e.preventDefault(); pick(); } });
  }
  private paintName(label: HTMLElement, active: boolean) {
    const first = this.host.authoring();
    if (first) { label.tabIndex = 0; label.setAttribute('role', 'button'); label.setAttribute('aria-pressed', String(active)); } else { label.removeAttribute('tabindex'); label.removeAttribute('role'); label.removeAttribute('aria-pressed'); }
    label.title = first ? `${active ? 'The active parameter: parts picked on the stage or in the tree are bound to it' : 'Make this the active parameter'}. Drag to another category.` : '';
  }

  /** Redraw every control from the current values, the playhead and the animation's tracks (Animate), or the keyforms (Model). */
  sync() {
    const anim = this.host.anim(), v = this.values(), t = this.host.time(), model = this.host.authoring();
    this.root.classList.toggle('ap-nokey', !this.host.keying());
    this.root.classList.toggle('ap-model', model);
    const keyedAt = (id: string) => !!anim && paramKeys(anim, id).some(k => Math.abs(k.t - t) < KEY_NEAR);
    const has = (id: string) => !!anim && paramKeys(anim, id).length > 0;
    for (const e of this.views.values()) {
      const spot = model ? e.spot() : null;
      e.view(v, model ? !!spot && this.host.isKeyed(spot) === true : e.ids.every(keyedAt), model ? false : e.ids.some(has));
    }
    this.host.synced();
  }
}
