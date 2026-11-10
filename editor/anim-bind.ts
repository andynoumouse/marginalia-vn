// The animation studio's Model mode: the focus header pinned at the top of the right column, and the Keyforms section under it
// (docs/design/studio-inspector.md). The header names the focus, `torso ▾ › breathe ▾ @ 0 · key`: each word goes up to itself alone, the
// part's ▾ lists the parts bound to the active parameter (choose one, ✕ unbinds it), the parameter's ▾ lists what moves the chosen part
// (choose one to make it the active parameter). Under the words, the action row: the verbs that join the focus to something else (Bind
// parts…, Bind to parameter…, Copy keys from…), each opening the inline picker under the row, and for a keyform a ⋯ with Copy form, Paste
// form and Paste mirrored. Keyforms shows the keyform itself: the keys of the chosen part, the pose stored at the slider's value and its
// ease (a warp binding: its keys and, in `.ab-points`, the Warp panel's Point row; a mask: its keys, to go to), and the per-key operations
// (the ⋯'s three and Reset). The studio computes everything shown (`BindView`; which
// pickers and verbs by engine/src/studio-inspector.ts `focusHeader`) and carries out what is pressed (`BindHost`); this only draws.

import { EASE_NAMES, PAD_SIZES, type Breadcrumb, type BindKind, type FocusHeaderView, type FormOpId, type FullForm, type FormValue, type PadSize, type PickVerb } from '../engine/src/index.js';
import { ContextMenu } from './context-menu.js';
import { el, layoutRows, pickEase, showEase } from './anim-dom.js';
import { Popover } from './studio-popover.js';

export type FormField = keyof FormValue;

export interface BindRow { target: string; kind: BindKind; keys: number; posed: number; chosen: boolean }
export interface BindKeyButton { at: number; posed: boolean; here: boolean }
export interface BindView {
  /** The active parameter: its control key, its name, what it spans; null while none is picked. */
  active: { control: string; name: string; span: string; pad: boolean } | null;
  /** The chosen part or bone, null for none. */
  chosen: string | null;
  bound: BindRow[];
  /** The focus in words: the part, the parameter and the value, each word that can be a way up a button. */
  crumb: Breadcrumb;
  /** The header's pickers and verbs (null in Animate mode: no header). */
  header: FocusHeaderView | null;
  /** The neighbouring keys of the chosen part either side of the slider's value (null: none, or not a slider). */
  prevKey: number | null;
  nextKey: number | null;
  /**
   * What a slider key does for the chosen part at the slider's value: add one, remove the one there, or nothing (the default key of a pose
   * stays; a mask's keys are written in rig.json, so the button goes). Null for a pad or while not bound: no key strip.
   */
  keyAction: 'add' | 'remove' | 'default' | 'locked' | null;
  keys: BindKeyButton[];
  size: PadSize;
  /**
   * The keyform at the keyed spot: what is said about it, the pose's values, and whether it can be written. `points`: a warp binding, whose
   * values are the chosen points' move (the Point row the Warp panel draws) in place of the pose's six fields.
   */
  form: { text: string; values: FullForm | null; can: boolean; ease?: string | null; points?: boolean; /** The row's name: Pose (the default), Warp, Shape. */ name?: string };
  affecting: { control: string; name: string; kind: BindKind; active: boolean }[];
  /** Pose keys of the same kind the chosen part can take over: other parts on the active parameter, and any part on another parameter (empty: nothing to copy from). */
  copyFrom: { target: string; control: string; label: string }[];
  /** What to do next, for the status line (the studio shows it there). */
  hint: string;
}

export type BindVerb = Extract<PickVerb, 'bindParts' | 'bindToParam'>;
export interface PickItem { id: string; label: string; note?: string }

export interface BindHost {
  view(): BindView;
  /** A row of the bound list was chosen: the studio chooses that part (and the tool that edits its kind). */
  focus(target: string, kind: BindKind): void;
  unbind(target: string, kind: BindKind): void;
  /** What the picker of a verb offers (parts not bound to the parameter yet, or parameters the chosen part is not bound to). */
  candidates(verb: BindVerb): PickItem[];
  /** The picker's button was pressed with these ids ticked; `subtree`: a ticked bone takes the bones below it and their parts along. */
  commit(verb: BindVerb, ids: string[], subtree: boolean): void;
  setSize(size: PadSize): void;
  /** A word of the breadcrumb was pressed: go up to the part alone or to the parameter alone. */
  goUp(to: 'part' | 'param'): void;
  /** The slider goes to the key at `at` (clicking a key). */
  jump(at: number): void;
  keyHere(): void;
  setField(field: FormField, value: number): void;
  /** Copy form, Paste form, Paste mirrored or Reset on the keyform at the slider's value. */
  formOp(id: FormOpId): void;
  /** The curve the slider key at the spot is reached along from the key before it. */
  setEase(ease: string): void;
  /** A parameter of the "moved by" list was chosen. */
  activate(control: string): void;
  /** Give the chosen part the keys of `from`. `flip`: mirror the poses sideways; `reverse`: run the parameter's range end for end. Independent: an arm lift mirrors only, a look-left onto a look-right does both. */
  copyKeys(from: string, control: string, how: { flip: boolean; reverse: boolean }): void;
}

type HeaderVerb = PickVerb;

const shown = (v: number) => String(Math.round(v * 1000) / 1000);
const shown4 = (v: number) => String(Math.round(v * 1e4) / 1e4);
/** The units of the pose fields, said under them rather than only on hover (SR-16); Animate's "At the playhead" fields share them. */
export const UNITS = 'x, y: fractions of the stage · rot: degrees · sx, sy: added to 1 (0 is as drawn) · opacity: 0 to 1';
const FORM_INPUTS: { field: FormField; label: string; step: string; title: string }[] = [
  { field: 'dx', label: 'x', step: '0.005', title: 'Sideways move, as a fraction of the stage' },
  { field: 'dy', label: 'y', step: '0.005', title: 'Vertical move, as a fraction of the stage' },
  { field: 'rot', label: 'rot', step: '0.5', title: 'Rotation in degrees' },
  { field: 'sx', label: 'sx', step: '0.01', title: 'Width, added to 1' },
  { field: 'sy', label: 'sy', step: '0.01', title: 'Height, added to 1' },
  { field: 'opacity', label: 'opacity', step: '0.05', title: 'Opacity, a factor from 0 to 1' },
];
const KIND_TITLE: Record<BindKind, string> = {
  pose: 'Its pose: where the part or bone sits, how it turns and scales',
  warp: 'Its mesh warp (Warp tool, D)',
  mask: 'Its drawn mask (Mask tool, M)',
};
/** The per-key operations in Keyforms, in the order the rules give them. */
const OPS: { id: FormOpId; cls: string }[] = [{ id: 'copyForm', cls: 'ab-copyform' }, { id: 'pasteForm', cls: 'ab-pasteform' }, { id: 'pasteMirrored', cls: 'ab-pastemirror' }, { id: 'resetForm', cls: 'ab-reset' }];
const slot = (cls: string, label: string) =>
  `<span class="ab-slot ${cls}"><button type="button" class="ab-crumbbtn"></button><span class="ab-crumbword"></span><button type="button" class="ab-crumbpick" aria-label="${label}"></button></span>`;

export class BindPanel {
  private drawn: Record<string, string> = {};
  private prev: number | null = null;
  private next: number | null = null;
  private note: HTMLElement;
  private list: HTMLElement;
  private gridRow: HTMLElement;
  private keysRow: HTMLElement;
  private keyBtns: HTMLElement;
  private keyHere: HTMLButtonElement;
  private formRow: HTMLElement;
  private formText: HTMLElement;
  private inputs: Record<string, HTMLInputElement>;
  private affect: HTMLElement;
  private sizeSel: HTMLSelectElement;
  private verbBtns: Record<HeaderVerb, HTMLButtonElement>;
  private crumbEl: HTMLElement;
  private partPop: Popover;
  private paramPop: Popover;
  private prevBtn: HTMLButtonElement;
  private nextBtn: HTMLButtonElement;
  private picker: HTMLElement;
  private open: { verb: HeaderVerb; sig: string } | null = null;
  private menu: ContextMenu | null = null;
  private ticked = new Set<string>();

  /** `root` is the Keyforms section's body, `header` the focus header over the right column's dock. */
  constructor(private root: HTMLElement, private header: HTMLElement, private host: BindHost) {
    this.header.innerHTML = `
      <div class="ab-crumb" role="group" aria-label="What is in focus">${slot('ab-partslot', 'Parts bound to the parameter')}<span class="ab-sep"> › </span>${slot('ab-paramslot', 'What moves the part')}<span class="ab-value"></span><span class="as-muted ab-crumbstatus"></span><span class="as-muted ab-empty"></span></div>
      <div class="ab-pop ab-partpop" role="dialog" aria-label="Parts bound to the parameter"><ul class="ab-list"></ul></div>
      <div class="ab-pop ab-parampop" role="dialog" aria-label="What moves the chosen part"><span class="ab-affbtns" role="group" aria-label="Parameters that move the chosen part: click one to make it the active parameter"></span></div>
      <div class="ab-acts" role="group" aria-label="What to join the focus to"><button type="button" class="ab-bind" data-verb="bindParts"></button><button type="button" class="ab-bindto" data-verb="bindToParam"></button><button type="button" class="ab-copykeys" data-verb="copyKeys"></button><button type="button" class="ab-more" aria-haspopup="menu" aria-label="More for this keyform: Copy form, Paste form, Paste mirrored" title="Copy form, Paste form, Paste mirrored">⋯</button></div>
      <div class="ab-picker" role="dialog" aria-label="Choose what to bind" hidden>
        <div class="ab-pickhead"><strong class="ab-picktitle"></strong><button type="button" class="ab-pickx" aria-label="Close the picker" title="Close (Esc)">✕</button></div>
        <input type="search" class="ab-pickfilter" placeholder="Filter" aria-label="Filter the list">
        <ul class="ab-picklist"></ul>
        <label class="ab-picksub" title="A ticked bone also takes the bones below it and their parts"><input type="checkbox" class="ab-picksubbox"> and what hangs on a ticked bone</label>
        <span class="ab-pickhow"><label title="Mirror the poses sideways: x moves and rotations change sign, as for the arm on the other side"><input type="checkbox" class="ab-mirror"> mirror poses</label>
          <label title="Run the parameter's range end for end: a key at the minimum lands at the maximum, as for a look to the left copied to a look to the right"><input type="checkbox" class="ab-reverse"> reverse range</label></span>
        <div class="ab-pickbtns"><button type="button" class="ab-pickgo"></button><button type="button" class="ab-pickcancel">Cancel</button></div>
      </div>`;
    this.root.innerHTML = `
      <p class="as-pivot-hint ab-note"></p>
      <div class="ab-keys"><span class="as-pivot-name">Keys</span><button type="button" class="ab-prev" aria-label="Previous key" title="Put the slider on the key before">‹</button><span class="ab-keybtns" role="group" aria-label="Keys of the chosen part: click one to put the slider there"></span><button type="button" class="ab-next" aria-label="Next key" title="Put the slider on the key after">›</button>
        <button type="button" class="ab-keyhere"></button></div>
      <div class="ab-grid"><label class="ab-size">Grid on a pad <select aria-label="Grid of a pad's keys when a part is bound to it">${PAD_SIZES.map(n => `<option value="${n}">${n} × ${n}</option>`).join('')}</select></label></div>
      <div class="ab-form"><span class="as-pivot-name">Pose</span><span class="ab-formtext"></span>
        ${FORM_INPUTS.map(f => `<label title="${f.title}">${f.label} <input type="number" data-bf="${f.field}" step="${f.step}"${f.field === 'opacity' ? ' min="0"' : ''}></label>`).join('')}
        <label class="ab-easelabel" title="How the slider moves from the key before this one to this key (linear: straight)">ease <select class="ab-ease" aria-label="Curve into this key from the previous one">${EASE_NAMES.map(n => `<option value="${n}">${n}</option>`).join('')}</select></label>
        <span class="as-pivot-hint ab-units">${UNITS}</span></div>
      <div class="ab-points"></div>
      <div class="ab-ops" role="group" aria-label="This key's pose">${OPS.map(o => `<button type="button" class="${o.cls}" data-op="${o.id}"></button>`).join('')}</div>`;
    layoutRows(this.root);
    const q = <T extends Element>(s: string) => this.root.querySelector<T>(s)!;
    const h = <T extends Element>(s: string) => this.header.querySelector<T>(s)!;
    this.note = q('.ab-note');
    this.gridRow = q('.ab-grid');
    this.sizeSel = q<HTMLSelectElement>('.ab-size select');
    this.keysRow = q('.ab-keys');
    this.keyBtns = q('.ab-keybtns');
    this.keyHere = q('.ab-keyhere');
    this.formRow = q('.ab-form');
    this.formText = q('.ab-formtext');
    this.inputs = Object.fromEntries(FORM_INPUTS.map(f => [f.field, q<HTMLInputElement>(`[data-bf="${f.field}"]`)]));
    this.prevBtn = q<HTMLButtonElement>('.ab-prev');
    this.nextBtn = q<HTMLButtonElement>('.ab-next');
    this.list = h('.ab-list');
    this.affect = h('.ab-affbtns');
    this.crumbEl = h('.ab-crumb');
    this.picker = h('.ab-picker');
    this.verbBtns = { bindParts: h('.ab-bind'), bindToParam: h('.ab-bindto'), copyKeys: h('.ab-copykeys') };
    for (const [verb, b] of Object.entries(this.verbBtns) as [HeaderVerb, HTMLButtonElement][]) b.addEventListener('click', () => this.toggle(verb));
    for (const [cls, up] of [['.ab-partslot', 'part'], ['.ab-paramslot', 'param']] as const) h(`${cls} .ab-crumbbtn`).addEventListener('click', () => this.host.goUp(up));
    // The ▾ after each word: its list is drawn whether it is open or not, so a redraw never needs it open.
    this.partPop = new Popover(h('.ab-partslot .ab-crumbpick'), h('.ab-partpop'), () => this.header.querySelector<HTMLElement>('.ab-partpop button')?.focus());
    this.paramPop = new Popover(h('.ab-paramslot .ab-crumbpick'), h('.ab-parampop'), () => this.header.querySelector<HTMLElement>('.ab-parampop button')?.focus());
    this.prevBtn.addEventListener('click', () => { if (this.prev !== null) this.host.jump(this.prev); });
    this.nextBtn.addEventListener('click', () => { if (this.next !== null) this.host.jump(this.next); });
    h('.ab-pickx').addEventListener('click', () => this.close());
    h('.ab-pickcancel').addEventListener('click', () => this.close());
    h('.ab-pickgo').addEventListener('click', () => {
      const verb = this.open?.verb, ids = [...this.ticked];
      if (!verb || !ids.length) return;
      const subtree = h<HTMLInputElement>('.ab-picksubbox').checked;
      const how = { flip: h<HTMLInputElement>('.ab-mirror').checked, reverse: h<HTMLInputElement>('.ab-reverse').checked };
      this.close();
      if (verb === 'copyKeys') {
        const [target, control] = ids[0].split('\n');
        if (target && control) this.host.copyKeys(target, control, how);
      } else this.host.commit(verb, ids, subtree);
    });
    h<HTMLInputElement>('.ab-pickfilter').addEventListener('input', () => this.drawList());
    this.picker.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); } });
    this.sizeSel.addEventListener('change', () => this.host.setSize(Number(this.sizeSel.value) as PadSize));
    this.keyHere.addEventListener('click', () => this.host.keyHere());
    for (const f of FORM_INPUTS) this.inputs[f.field].addEventListener('change', () => {
      const input = this.inputs[f.field], v = Number(input.value);
      if (input.value.trim() !== '' && Number.isFinite(v)) this.host.setField(f.field, v); else this.show();
    });
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('.ab-ops button')) b.addEventListener('click', () => this.host.formOp(b.dataset.op as FormOpId));
    // The action row's ⋯: the keyform's copy and paste (three verbs fill the row, so these are a menu); one that cannot run says why.
    const more = h<HTMLButtonElement>('.ab-more');
    more.addEventListener('click', e => {
      const ops = (this.host.view().header?.formOps ?? []).filter(o => o.id !== 'resetForm');
      (this.menu ??= new ContextMenu(this.header.closest<HTMLElement>('#animStudio') ?? document.body)).open(e, more, ops.map(o => ({ label: o.label, title: o.title, disabled: !o.enabled, run: () => this.host.formOp(o.id) })));
    });
    q<HTMLSelectElement>('.ab-ease').addEventListener('change', async e => { const ease = await pickEase(e.target as HTMLSelectElement); if (ease !== null) this.host.setEase(ease); });
  }

  /** Draw again from the studio's state. A part of the block whose content did not change is left as it is, so a focused button keeps focus. */
  show() {
    const v = this.host.view(), act = v.active, hv = v.header;
    if (this.open && this.open.sig !== this.sigOf(this.open.verb, v)) this.close(); // the picker belongs to the focus it was opened for
    this.showHeader(v);
    this.prev = v.prevKey;
    this.next = v.nextKey;
    this.prevBtn.disabled = v.prevKey === null;
    this.nextBtn.disabled = v.nextKey === null;
    this.note.textContent = hv?.keyformNote ?? '';
    this.note.hidden = !hv?.keyformNote;
    this.sizeSel.value = String(v.size);
    this.gridRow.hidden = !act?.pad;
    // The keys of the chosen part on a slider: one button each, the one the slider is on pressed.
    this.keysRow.hidden = !act || !v.chosen || v.keyAction === null;
    this.redraw('keys', [v.keys, v.keyAction], () => {
      this.keyBtns.replaceChildren(...v.keys.map(k => {
        const b = el('button', { type: 'button', className: `ab-key${k.posed ? ' ab-posed' : ''}`, textContent: shown(k.at), title: `${k.posed ? 'Posed' : 'At rest'}: click to put ${act?.name} at ${shown(k.at)}` });
        b.setAttribute('aria-pressed', String(k.here));
        b.addEventListener('click', () => this.host.jump(k.at));
        return b;
      }));
    });
    const warp = !!v.form.points;
    this.keyHere.hidden = v.keyAction === 'locked';
    this.keyHere.textContent = v.keyAction === 'remove' ? 'Remove this key' : 'Add key here';
    this.keyHere.disabled = v.keyAction === 'default' || v.keyAction === null;
    this.keyHere.title = v.keyAction === 'remove' ? `Remove the ${warp ? 'warp\'s ' : ''}key at the slider's value` : v.keyAction === 'default' ? 'The key at the default stays: it is the rest pose the others are posed against'
      : warp ? 'Add a key at the slider\'s value, holding the shape on show' : 'Add a key at the slider\'s value, holding the pose on show';
    // The keyform at the keyed spot: a pose's six fields, or (a warp) the Point row under the text.
    this.formRow.hidden = !act || !v.chosen;
    this.formRow.querySelector<HTMLElement>('.as-pivot-name')!.textContent = v.form.name ?? 'Pose';
    this.formText.textContent = v.form.text;
    const fields = v.form.can && !warp;
    for (const f of FORM_INPUTS) {
      const input = this.inputs[f.field];
      input.disabled = !fields;
      if (document.activeElement !== input) input.value = v.form.values ? shown4(v.form.values[f.field]) : '';
      input.placeholder = fields && !v.form.values ? 'no key' : '';
    }
    for (const part of this.formRow.querySelectorAll<HTMLElement>('label')) part.hidden = !fields; // a warp, a mask or an unbound part has no pose fields: the text says why
    this.root.querySelector<HTMLElement>('.ab-points')!.hidden = !act || !v.chosen || !warp;
    // Copy form, Paste form, Paste mirrored, Reset: shown with the pose fields; one that cannot run is disabled and says why.
    const ops = hv?.formOps ?? [], opsRow = this.root.querySelector<HTMLElement>('.ab-ops')!;
    opsRow.hidden = !v.form.can || !ops.length;
    for (const b of opsRow.querySelectorAll<HTMLButtonElement>('button')) {
      const o = ops.find(x => x.id === b.dataset.op);
      b.textContent = o?.short ?? '';
      if (o && o.short !== o.label) b.setAttribute('aria-label', o.label); else b.removeAttribute('aria-label');
      b.disabled = !o?.enabled;
      b.title = o?.title ?? '';
    }
    const easeSel = this.formRow.querySelector<HTMLSelectElement>('.ab-ease')!, hasEase = v.form.ease !== undefined && v.form.ease !== null;
    this.formRow.querySelector<HTMLElement>('.ab-easelabel')!.hidden = !fields || !hasEase; // only a pose's slider key reaches its pose along a curve
    if (hasEase) showEase(easeSel, v.form.ease!);
  }

  /** The focus header: the words and their ▾ lists, then the action row. */
  private showHeader(v: BindView) {
    const hv = v.header, act = v.active;
    this.header.hidden = !hv;
    this.header.dataset.kind = hv?.kind ?? '';
    this.header.dataset.param = act?.name ?? '';
    if (!hv) { this.partPop.close(); this.paramPop.close(); return; }
    // Line 1: `part ▾ › parameter ▾ @ value · status`; a hidden word holds no text, so the line reads as it shows.
    const words = v.crumb.crumbs, keyform = hv.kind === 'keyform';
    const fill = (cls: string, word: string | null, up: boolean, pick: typeof hv.partPick, placeholder: string) => {
      const s = this.header.querySelector<HTMLElement>(cls)!, btn = s.querySelector<HTMLButtonElement>('.ab-crumbbtn')!, span = s.querySelector<HTMLElement>('.ab-crumbword')!;
      const p = s.querySelector<HTMLButtonElement>('.ab-crumbpick')!;
      s.hidden = !pick.show && word === null;
      btn.hidden = !up;
      btn.textContent = up ? word : '';
      span.hidden = up;
      span.textContent = up || s.hidden ? '' : word ?? placeholder;
      span.classList.toggle('ab-placeholder', word === null);
      p.hidden = !pick.show;
      p.disabled = !pick.enabled;
      p.title = pick.title;
      return btn;
    };
    // A Ctrl-click set reads `3 parts` in place of the part's name, its tooltip naming them (Keyforms still shows the first).
    const part = hv.kind === 'part' || keyform ? hv.setWord?.text ?? words[0]?.text ?? v.chosen : null;
    const param = hv.kind === 'param' ? words[0]?.text ?? act?.name ?? null : keyform ? words[1]?.text ?? null : null;
    const partBtn = fill('.ab-partslot', part, keyform, hv.partPick, hv.noPart);
    partBtn.title = `Go up to ${part} alone`;
    const partSlot = this.header.querySelector<HTMLElement>('.ab-partslot')!;
    partSlot.querySelector<HTMLElement>('.ab-crumbword')!.title = hv.setWord?.title ?? '';
    if (hv.setWord) partBtn.title = `${hv.setWord.title}. Click: go up to the ${hv.setWord.text} alone`;
    partSlot.dataset.set = hv.setWord ? String(hv.setWord.text) : '';
    fill('.ab-paramslot', param, keyform, hv.paramPick, hv.noParam).title = `Go up to ${param} alone, with the parts it moves`;
    if (!hv.partPick.enabled) this.partPop.close();
    if (!hv.paramPick.enabled) this.paramPop.close();
    this.header.querySelector<HTMLElement>('.ab-sep')!.textContent = hv.kind === 'none' ? '' : ' › ';
    this.header.querySelector<HTMLElement>('.ab-value')!.textContent = keyform ? ` ${words[2]?.text ?? ''}` : '';
    this.header.querySelector<HTMLElement>('.ab-crumbstatus')!.textContent = keyform && v.crumb.status ? ` · ${v.crumb.status}` : '';
    this.header.querySelector<HTMLElement>('.ab-empty')!.textContent = hv.kind === 'none' ? hv.empty : '';
    this.crumbEl.title = this.crumbEl.textContent ?? '';
    // The part's ▾: the parts bound to the parameter, each a button that chooses it, and its ✕.
    this.redraw('list', [v.bound, v.chosen, act?.control], () => {
      this.list.replaceChildren(...v.bound.map(b => {
        const pick = el('button', { type: 'button', className: 'ab-part' },
          el('span', { className: 'ab-pname', textContent: b.target }),
          el('span', { className: 'as-badge', textContent: b.kind, title: KIND_TITLE[b.kind] }),
          el('span', { className: 'as-muted', textContent: `${b.keys} key${b.keys === 1 ? '' : 's'}${b.posed ? ` · ${b.posed} posed` : ''}` }));
        pick.setAttribute('aria-pressed', String(b.chosen));
        pick.title = `Choose ${b.target} to pose it${b.kind === 'pose' ? '' : ` (switches to the ${b.kind === 'warp' ? 'Warp' : 'Mask'} tool)`}`;
        pick.addEventListener('click', () => { this.partPop.close(); this.host.focus(b.target, b.kind); });
        const off = el('button', { type: 'button', className: 'ab-unbind', textContent: '✕', title: `Unbind ${b.target} from ${act?.name ?? 'the parameter'}: its keys here are removed` });
        off.setAttribute('aria-label', `Unbind ${b.target} from ${act?.name ?? 'the parameter'}`);
        off.addEventListener('click', () => this.host.unbind(b.target, b.kind));
        return el('li', { className: 'ab-item' }, pick, off);
      }));
    });
    // The parameter's ▾: what moves the chosen part, each making that parameter the active one.
    this.redraw('affect', [v.affecting, v.chosen], () => {
      this.affect.replaceChildren(...v.affecting.map(a => {
        const b = el('button', { type: 'button', className: 'ab-aff', textContent: a.name, title: `${v.chosen} is moved by ${a.name} (${a.kind}): click to make it the active parameter` });
        if (a.kind !== 'pose') b.append(el('span', { className: 'as-badge', textContent: a.kind }));
        b.setAttribute('aria-pressed', String(a.active));
        b.addEventListener('click', () => { this.paramPop.close(); this.host.activate(a.control); });
        return b;
      }));
    });
    const more = this.header.querySelector<HTMLButtonElement>('.ab-more')!;
    more.hidden = !hv.formOps.length;
    // Line 2: the verbs of this focus kind; one that cannot run is disabled and its tooltip says why.
    for (const [id, b] of Object.entries(this.verbBtns) as [HeaderVerb, HTMLButtonElement][]) {
      const verb = hv.verbs.find(x => x.id === id);
      b.hidden = !verb;
      if (!verb) continue;
      b.textContent = verb.label;
      if (verb.name && verb.name !== verb.label) b.setAttribute('aria-label', verb.name); else b.removeAttribute('aria-label');
      b.disabled = !verb.enabled;
      b.title = verb.title;
      b.setAttribute('aria-pressed', String(this.open?.verb === id));
    }
  }

  private sigOf(verb: HeaderVerb, v: BindView): string {
    return verb === 'bindParts' ? `${v.active?.control ?? ''}` : verb === 'bindToParam' ? `${v.chosen ?? ''}` : `${v.chosen ?? ''}\n${v.active?.control ?? ''}`;
  }
  private toggle(verb: HeaderVerb) {
    if (this.open?.verb === verb) { this.close(); return; }
    const v = this.host.view();
    this.open = { verb, sig: this.sigOf(verb, v) };
    this.ticked.clear();
    const q = <T extends Element>(s: string) => this.picker.querySelector<T>(s)!;
    q('.ab-picktitle').textContent = verb === 'bindParts' ? `Bind parts to ${v.active?.name ?? 'the parameter'}`
      : verb === 'bindToParam' ? `Bind ${v.chosen ?? 'the chosen part'} to a parameter` : `Copy keys onto ${v.chosen ?? 'the chosen part'} from`;
    this.picker.setAttribute('aria-label', verb === 'copyKeys' ? 'Choose the keys to copy' : 'Choose what to bind');
    q<HTMLInputElement>('.ab-pickfilter').value = '';
    q<HTMLInputElement>('.ab-picksubbox').checked = false;
    q<HTMLElement>('.ab-picksub').hidden = verb !== 'bindParts';
    q<HTMLElement>('.ab-pickhow').hidden = verb !== 'copyKeys';
    this.picker.hidden = false;
    this.drawList();
    q<HTMLInputElement>('.ab-pickfilter').focus();
    this.show();
  }
  private close() {
    if (!this.open) return;
    const verb = this.open.verb;
    this.open = null;
    this.picker.hidden = true;
    this.show();
    const b = this.verbBtns[verb];
    if (!b.hidden && !b.disabled) b.focus();
  }
  private drawList() {
    const open = this.open;
    if (!open) return;
    const q = <T extends Element>(s: string) => this.picker.querySelector<T>(s)!;
    const f = q<HTMLInputElement>('.ab-pickfilter').value.trim().toLowerCase();
    // Copy keys from… takes one source (a radio list); the binds take any number (ticks).
    const verb = open.verb, one = verb === 'copyKeys';
    const all: PickItem[] = verb === 'copyKeys' ? this.host.view().copyFrom.map(c => ({ id: `${c.target}\n${c.control}`, label: c.label })) : this.host.candidates(verb);
    const items = all.filter(i => !f || i.label.toLowerCase().includes(f));
    const go = q<HTMLButtonElement>('.ab-pickgo');
    const count = () => {
      go.textContent = one ? 'Copy' : this.ticked.size ? `Bind ${this.ticked.size}` : 'Bind';
      go.title = one ? 'Replace the chosen part\'s keys on this parameter with the picked ones' : '';
      go.disabled = !this.ticked.size;
    };
    q('.ab-picklist').replaceChildren(...(items.length ? items.map(i => {
      const box = document.createElement('input');
      box.type = one ? 'radio' : 'checkbox';
      if (one) box.name = 'ab-copyfrom';
      box.checked = this.ticked.has(i.id);
      box.addEventListener('change', () => {
        if (one) this.ticked.clear();
        if (box.checked) this.ticked.add(i.id); else this.ticked.delete(i.id);
        count();
      });
      const label = document.createElement('label'), li = document.createElement('li');
      label.append(box, el('span', { textContent: i.label }));
      if (i.note) label.append(el('span', { className: 'as-muted', textContent: i.note }));
      li.append(label);
      return li;
    }) : [Object.assign(el('li'), { className: 'as-muted', textContent: f ? 'Nothing matches.' : open.verb === 'bindParts' ? 'Every part is bound already.' : open.verb === 'copyKeys' ? 'No keys to copy.' : 'No parameter is left to bind to.' })]));
    count();
  }

  private redraw(part: string, sig: unknown, draw: () => void) {
    const s = JSON.stringify(sig);
    if (this.drawn[part] === s) return;
    this.drawn[part] = s;
    draw();
  }
}
