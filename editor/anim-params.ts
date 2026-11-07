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
// Model mode also edits the controls themselves: new parameter and pad, and a fold-out under each with name, group, range, default.

import {
  changedParams, controlGroups, displayValues, EASE_NAMES, OTHER, paramKeys,
  type AnimDef, type FormValue, type KeySpot, type KeyTick, type PadDef, type ParamDef, type ParamPatch, type PadPatch, type PoseDef,
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
  /** Key the chosen part at `spot` as it stands (the pose on show), or remove the key that is there. */
  toggleKey(spot: KeySpot): void;
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
  addPad(category?: string): string | null;
  editParam(id: string, patch: ParamPatch): string | null;
  editPad(id: string, patch: PadPatch): string | null;
  deleteParam(id: string): void;
  deletePad(id: string): void;
  /** One place up (-1) or down (1) inside its group; `control` is the parameter id or `pad:<id>`. */
  moveControl(control: string, dir: -1 | 1): void;
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
const shown4 = (v: number) => String(Math.round(v * 1e4) / 1e4);
/** A range or number input over the span of parameter `d`. */
function numberInput(type: 'range' | 'number', d: ParamDef): HTMLInputElement {
  const i = document.createElement('input');
  i.type = type;
  i.min = String(d.min); i.max = String(d.max); i.step = String(step(d));
  return i;
}
const clamp = (d: ParamDef, v: number) => Math.min(d.max, Math.max(d.min, v));
/** The plain inputs and selects of the fold-out editors. */
function textField(size: number): HTMLInputElement {
  const i = document.createElement('input');
  i.type = 'text'; i.size = size; i.spellcheck = false; i.autocomplete = 'off';
  return i;
}
function numField(value: number): HTMLInputElement {
  const i = document.createElement('input');
  i.type = 'number'; i.step = 'any'; i.value = shown4(value);
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
  /** The control whose fold-out editor is open (a parameter id or `pad:<id>`). */
  editing: string | null = null;
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

  /** Model mode: a + button's menu adds a slider or a pad (in `category`, when the button is a category's) and opens its editor. */
  add(kind: 'param' | 'pad', category?: string) {
    if (kind === 'param') this.created(this.host.addParam(category));
    else this.created(this.host.addPad(category), 'pad:');
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

  /** Move one parameter's control from elsewhere in the studio (the Warp section's slider); clamped to its range. */
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
    this.editing = null;
    this.folded.clear();
  }

  /** A parameter was renamed: its hand-set value and its open editor move with it. */
  rename(from: string, to: string) {
    if (Object.hasOwn(this.base, from)) { this.base[to] = this.base[from]; delete this.base[from]; }
    if (this.hold.delete(from)) this.hold.add(to);
    if (this.editing === from) this.editing = to;
  }

  /** The control just made: open its editor, make it the active parameter, and show it. */
  private created(id: string | null, prefix = '') {
    if (id === null) return;
    this.editing = prefix + id;
    this.host.chooseControl(prefix + id);
    this.build();
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
      fold.addEventListener('click', () => show(rows.hidden));
      show((this.folded.get(g.name) ?? i < open) || g.controls.some(c => editKey(c) === this.editing));
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

  /** The + (add a parameter or a pad here), and for a real category the ✎ (rename) and ✕ (delete) on its header. */
  private categoryButtons(name: string, real: boolean): HTMLElement[] {
    const btn = (cls: string, text: string, title: string) => {
      const b = el('button', { type: 'button', className: `ap-cat-btn ${cls} ap-model-only`, textContent: text, title });
      b.setAttribute('aria-label', title);
      return b;
    };
    const add = btn('ap-cat-add', '+', `Add a parameter or a pad to ${name}`);
    add.setAttribute('aria-haspopup', 'menu');
    add.addEventListener('click', e => (this.menu ??= new ContextMenu(this.root)).open(e, add, [
      { label: 'New parameter', title: 'Add a parameter (a slider)', run: () => this.add('param', real ? name : undefined) },
      { label: 'New pad', title: 'Add a pad: two parameters on one 2D control', run: () => this.add('pad', real ? name : undefined) },
    ]));
    if (!real) return [add];
    const rename = btn('ap-cat-rename', '✎', `Rename the category ${name}`);
    rename.addEventListener('click', () => this.renaming(name));
    const del = btn('ap-cat-del', '✕', `Delete the category ${name}; its controls move to Other`);
    del.addEventListener('click', () => this.host.deleteCategory(name));
    return [add, rename, del];
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

  /** A long list is narrowed by the filter field: rows whose name has no match (and their open editors) are hidden, and a group with none left. */
  private applyFilter() {
    const q = this.filter.hidden ? '' : this.filter.value.trim().toLowerCase();
    for (const group of this.body.querySelectorAll<HTMLElement>('.ap-group')) {
      let shown = 0;
      for (const row of group.querySelectorAll<HTMLElement>('.ap-row, .ap-padrow')) {
        const hide = q !== '' && !(row.dataset.ctl ?? '').toLowerCase().includes(q);
        row.classList.toggle('ap-filtered', hide);
        const editor = row.nextElementSibling;
        if (editor?.classList.contains('ap-editor')) editor.classList.toggle('ap-filtered', hide);
        if (!hide) shown++;
      }
      group.classList.toggle('ap-filtered', q !== '' && shown === 0);
    }
  }

  /** Model mode: the author picked this control (a click on its row or its name) and it becomes the active parameter. Nothing is guessed. */
  private pick(ctl: string) {
    if (this.host.authoring() && this.host.keyedControl() !== ctl) this.host.chooseControl(ctl);
  }

  /** The key, reset and (Model) edit buttons every control has; `ids` are the parameters they act on, `ctl` the control key the key button writes keyforms for. */
  private buttons(ids: string[], label: string, ctl: () => string, editKey: string) {
    const key = el('button', { type: 'button', className: 'ap-key', textContent: '◆' });
    key.addEventListener('click', () => {
      if (this.host.authoring()) {
        const k = ctl(), spot = this.spotOf(k);
        this.host.chooseControl(k);
        if (spot) this.host.toggleKey(spot);
        return;
      }
      const v = this.values();
      this.host.key(Object.fromEntries(ids.map(id => [id, v[id]])));
    });
    const reset = el('button', { type: 'button', className: 'ap-reset', textContent: '↺', title: `Reset ${label} to its default` });
    reset.setAttribute('aria-label', `Reset ${label}`);
    reset.addEventListener('click', () => { for (const d of this.host.defs()) if (ids.includes(d.id)) this.set(d.id, d.default); this.commit(); });
    const edit = el('button', { type: 'button', className: 'ap-edit-btn ap-model-only', textContent: '✎', title: `Edit ${label}: name, category, range, default` });
    edit.setAttribute('aria-label', `Edit ${label}`);
    edit.setAttribute('aria-expanded', String(this.editing === editKey));
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
    return { key, reset, edit, paint };
  }

  /** Model mode: the ✕ on a row deletes the control (one undo step; the host's note says when it is refused). */
  private removeButton(label: string, title: string, run: () => void): HTMLButtonElement {
    const b = el('button', { type: 'button', className: 'ap-del-btn ap-model-only', textContent: '✕', title });
    b.setAttribute('aria-label', `Delete ${label}`);
    b.addEventListener('click', run);
    return b;
  }

  /** The fold-out editor under a control. */
  private editor(key: string, build: (form: HTMLElement) => void): HTMLElement {
    const form = el('div', { className: 'ap-editor ap-model-only' });
    form.dataset.editor = key;
    form.hidden = this.editing !== key;
    if (!form.hidden) build(form);
    return form;
  }
  private toggleEditor(key: string) {
    this.editing = this.editing === key ? null : key;
    this.build();
    if (this.editing) this.root.querySelector<HTMLElement>(`[data-editor="${CSS.escape(key)}"] input`)?.focus();
  }

  /** Add a labelled field to an editor form. */
  private field<T extends HTMLElement>(form: HTMLElement, text: string, input: T): T {
    form.append(el('label', {}, `${text} `, input));
    return input;
  }
  /** An edit went through the host, which answers with the control's id afterwards (null: refused, so the fields show the old values again). */
  private applied(id: string | null, key: string) {
    if (id === null) { this.build(); return; }
    const next = key.startsWith('pad:') ? `pad:${id}` : id;
    if (this.editing === key && next !== key) { this.editing = next; this.build(); }
  }

  /** A select over the categories (and Other, the empty value). */
  private categorySelect(): HTMLSelectElement {
    return selectOf([['', OTHER], ...this.host.categories().map((c): [string, string] => [c, c])]);
  }

  private sliderEditor(d: ParamDef, axis: boolean): HTMLElement {
    return this.editor(d.id, form => {
      const name = this.field(form, 'name', textField(12));
      const group = this.field(form, 'category', this.categorySelect());
      if (axis) { group.disabled = true; group.title = "An axis of a pad stays in the pad's category"; }
      const min = this.field(form, 'min', numField(d.min)), max = this.field(form, 'max', numField(d.max)), dflt = this.field(form, 'default', numField(d.default));
      const ease = this.field(form, 'ease', selectOf([['', '(linear)'], ...EASE_NAMES.map((n): [string, string] => [n, n])]));
      name.value = d.id; group.value = d.group ?? ''; ease.value = d.ease ?? '';
      name.setAttribute('aria-label', `Name of ${d.id}`); group.setAttribute('aria-label', `Category of ${d.id}`);
      min.setAttribute('aria-label', `Minimum of ${d.id}`); max.setAttribute('aria-label', `Maximum of ${d.id}`); dflt.setAttribute('aria-label', `Default of ${d.id}`); ease.setAttribute('aria-label', `Ease of ${d.id}`);
      const send = (patch: ParamPatch) => this.applied(this.host.editParam(d.id, patch), d.id);
      name.addEventListener('change', () => send({ id: name.value }));
      group.addEventListener('change', () => send({ group: group.value }));
      ease.addEventListener('change', () => send({ ease: ease.value }));
      for (const [input, key] of [[min, 'min'], [max, 'max'], [dflt, 'default']] as const) input.addEventListener('change', () => {
        const v = Number(input.value);
        if (input.value.trim() === '' || !Number.isFinite(v)) { this.build(); return; }
        send({ [key]: v });
      });
      const del = el('button', { type: 'button', className: 'ap-delete', textContent: 'Delete parameter', title: `Delete ${d.id} and the keyforms, pose values and tracks that use it` });
      del.addEventListener('click', () => this.host.deleteParam(d.id));
      const up = el('button', { type: 'button', className: 'ap-move', textContent: '▲', title: 'Move up in its group' }), down = el('button', { type: 'button', className: 'ap-move', textContent: '▼', title: 'Move down in its group' });
      up.addEventListener('click', () => this.host.moveControl(d.id, -1));
      down.addEventListener('click', () => this.host.moveControl(d.id, 1));
      form.append(up, down, del);
    });
  }

  private padEditor(pad: PadDef): HTMLElement {
    const key = `pad:${pad.id}`;
    return this.editor(key, form => {
      const name = this.field(form, 'name', textField(12));
      const group = this.field(form, 'category', this.categorySelect());
      const axis = (text: string, cur: string) => {
        const sel = selectOf(this.host.defs().map((p): [string, string] => [p.id, p.id]));
        sel.value = cur;
        sel.setAttribute('aria-label', `${text} parameter of ${pad.id}`);
        return this.field(form, text, sel);
      };
      const x = axis('across', pad.x), y = axis('up', pad.y);
      name.value = pad.id; group.value = pad.group ?? '';
      name.setAttribute('aria-label', `Name of ${pad.id}`); group.setAttribute('aria-label', `Category of ${pad.id}`);
      const send = (patch: PadPatch) => this.applied(this.host.editPad(pad.id, patch), key);
      name.addEventListener('change', () => send({ id: name.value }));
      group.addEventListener('change', () => send({ group: group.value }));
      x.addEventListener('change', () => send({ x: x.value }));
      y.addEventListener('change', () => send({ y: y.value }));
      const del = el('button', { type: 'button', className: 'ap-delete', textContent: 'Delete pad', title: `Delete the pad ${pad.id}; its parameters and their keyforms stay` });
      del.addEventListener('click', () => this.host.deletePad(pad.id));
      const up = el('button', { type: 'button', className: 'ap-move', textContent: '▲', title: 'Move up in its group' }), down = el('button', { type: 'button', className: 'ap-move', textContent: '▼', title: 'Move down in its group' });
      up.addEventListener('click', () => this.host.moveControl(key, -1));
      down.addEventListener('click', () => this.host.moveControl(key, 1));
      form.append(up, down, del);
    });
  }

  private slider(d: ParamDef, axis = false): HTMLElement[] {
    const range = numberInput('range', d);
    range.setAttribute('aria-label', d.id);
    const num = numberInput('number', d);
    num.className = 'ap-num';
    num.setAttribute('aria-label', `${d.id} value`);
    const ticks = el('span', { className: 'ap-ticks' });
    const { key, reset, edit, paint } = this.buttons([d.id], d.id, () => d.id, d.id);
    edit.addEventListener('click', () => this.toggleEditor(d.id));
    const input = (raw: string) => { const v = Number(raw); if (raw !== '' && Number.isFinite(v)) { this.pick(d.id); this.set(d.id, clamp(d, v)); this.commit(); } };
    range.addEventListener('input', () => input(range.value));
    num.addEventListener('change', () => input(num.value));
    const label = el('label', { textContent: d.id, title: 'Make this the active parameter' });
    this.nameKeys(label, () => this.pick(d.id));
    if (!axis) this.dragSource(label, { kind: 'control', id: d.id });
    const row = el('div', { className: `ap-row${axis ? ' ap-axisrow' : ''}` }, label, el('div', { className: 'ap-track' }, range, ticks), num, key, reset, edit,
      this.removeButton(d.id, `Delete ${d.id} and the keyforms, pose values and tracks that use it`, () => this.host.deleteParam(d.id)));
    row.dataset.ctl = d.id;
    row.addEventListener('click', () => this.pick(d.id));
    const at = (v: number) => (v - d.min) / (d.max - d.min);
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
    return [row, this.sliderEditor(d, axis)];
  }

  private pad(pad: PadDef, x: ParamDef, y: ParamDef): HTMLElement[] {
    const id = pad.id, gridKey = `pad:${id}`;
    const area = el('div', { className: 'ap-pad', tabIndex: 0 });
    area.setAttribute('role', 'application');
    area.setAttribute('aria-label', `${id}: ${x.id} across, ${y.id} up. Arrow keys nudge it`);
    const corners = el('span', { className: 'ap-corners' });
    const dot = el('div', { className: 'ap-dot' });
    area.append(corners, dot);
    const read = el('span', { className: 'ap-read' });
    // The key button writes the pad's grid, or one axis when an axis button was chosen instead.
    const own = () => { const k = this.host.keyedControl(); return k === x.id || k === y.id ? k : gridKey; };
    const { key, reset, edit, paint } = this.buttons([x.id, y.id], id, own, gridKey);
    edit.addEventListener('click', () => this.toggleEditor(gridKey));
    const hintEl = el('span', { className: 'as-pivot-hint', textContent: 'Keys:' });
    const axes = el('span', { className: 'ap-axes ap-model-only' }, hintEl);
    const axisBtn = (ctl: string, text: string, title: string) => {
      const b = el('button', { type: 'button', className: 'ap-axis', textContent: text, title });
      b.dataset.axis = ctl;
      b.addEventListener('click', () => this.host.chooseControl(ctl));
      return b;
    };
    axes.append(axisBtn(gridKey, 'grid', `Key ${id}'s grid: a drag writes the corner of the grid nearest to the dot (${x.id} and ${y.id} have their own sliders below, to key one alone)`));
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
    this.nameKeys(label, () => { if (!this.owns(x.id, y.id, gridKey)) this.pick(gridKey); });
    this.dragSource(label, { kind: 'control', id: gridKey });
    const row = el('div', { className: 'ap-padrow' }, label, area, read, el('span', { className: 'ap-btns' }, key, reset, edit, this.removeButton(id, `Delete the pad ${id}; its parameters and their keyforms stay`, () => this.host.deletePad(id))), axes);
    row.dataset.ctl = gridKey;
    row.addEventListener('click', () => { if (!this.owns(x.id, y.id, gridKey)) this.pick(gridKey); });
    const fx = (v: number) => ((v - x.min) / (x.max - x.min)) * 100, fy = (v: number) => (1 - (v - y.min) / (y.max - y.min)) * 100;
    this.views.set(gridKey, {
      ids: [x.id, y.id], row, name: label,
      spot: () => this.spotOf(own()),
      view: (v, keyed, tracked) => {
        const model = this.host.authoring();
        dot.style.left = `${fx(v[x.id])}%`;
        dot.style.top = `${fy(v[y.id])}%`;
        read.textContent = `${x.id} ${shown(v[x.id])}, ${y.id} ${shown(v[y.id])}`;
        const spot = this.spotOf(own());
        paint(keyed, tracked, model, !!spot && this.host.isKeyed(spot) !== null);
        const cs = model ? this.host.corners(x.id, y.id) : [];
        const near = cs.length ? cs.reduce((b, c) => (Math.hypot((c.x - v[x.id]) / (x.max - x.min), (c.y - v[y.id]) / (y.max - y.min)) < Math.hypot((b.x - v[x.id]) / (x.max - x.min), (b.y - v[y.id]) / (y.max - y.min)) ? c : b)) : null;
        corners.replaceChildren(...cs.map(c => {
          const d = el('span', { className: `ap-corner${c.authored ? ' ap-authored' : ''}${near === c && this.host.keyedControl() === gridKey ? ' ap-near' : ''}` });
          d.style.left = `${fx(c.x)}%`;
          d.style.top = `${fy(c.y)}%`;
          d.title = `${x.id} ${shown(c.x)}, ${y.id} ${shown(c.y)}${c.authored ? ' (posed)' : ' (at rest)'}`;
          return d;
        }));
        const keyedCtl = this.host.keyedControl();
        for (const b of axes.querySelectorAll<HTMLButtonElement>('.ap-axis')) b.setAttribute('aria-pressed', String(b.dataset.axis === keyedCtl));
        const active = model && !!keyedCtl && [gridKey, x.id, y.id].includes(keyedCtl);
        row.classList.toggle('ap-active', active);
        this.paintName(label, active);
        key.hidden = this.host.authoring(); // a pad's keys are its grid corners: bound with the part, posed with the gizmo
        hintEl.textContent = this.host.authoring() ? 'Active:' : 'Keys:';
      },
    });
    return [row, this.padEditor(pad)];
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
