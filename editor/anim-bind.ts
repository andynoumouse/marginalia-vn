// The animation studio's Model mode, under the Parameters list: what the active parameter is bound to. The author picks one parameter
// (a highlighted row above), picks the parts it moves (a click on the stage, or the tick in the Parts tree) and this block lists them,
// with the keys of the chosen one and the pose stored at the slider's value. It also answers the other way round: which parameters move
// the chosen part, each a button that makes that parameter the active one. The studio computes everything shown (`BindView`) and
// carries out what is pressed (`BindHost`); this only draws. Order of the work, top to bottom: bound parts, keys of the chosen part,
// its pose, what moves it.

import { EASE_NAMES, PAD_SIZES, type BindKind, type FullForm, type FormValue, type PadSize } from '../engine/src/index.js';
import { el } from './anim-dom.js';

export type FormField = keyof FormValue;

export interface BindRow { target: string; kind: BindKind; keys: number; posed: number; chosen: boolean }
export interface BindKeyButton { at: number; posed: boolean; here: boolean }
export interface BindView {
  /** The active parameter: its control key, its name, what it spans; null while none is picked. */
  active: { control: string; name: string; span: string; pad: boolean } | null;
  /** The chosen part or bone, null for none. */
  chosen: string | null;
  bound: BindRow[];
  /** Pressing "Bind" would bind the chosen part now (it is not bound to the active parameter yet, and can be). */
  canBind: boolean;
  /** What a slider key does for the chosen part at the slider's value: add one, remove the one there, or nothing (the default key stays). Null for a pad or while not bound. */
  keyAction: 'add' | 'remove' | 'default' | null;
  keys: BindKeyButton[];
  size: PadSize;
  /** The pose stored at the keyed spot: what is said about it, the values, and whether they can be written. */
  form: { text: string; values: FullForm | null; can: boolean; ease?: string | null };
  affecting: { control: string; name: string; kind: BindKind; active: boolean }[];
  /** Pose keys of the same kind the chosen part can take over: other parts on the active parameter, and any part on another parameter (empty: nothing to copy from). */
  copyFrom: { target: string; control: string; label: string }[];
  hint: string;
}

export interface BindHost {
  view(): BindView;
  /** A row of the bound list was chosen: the studio chooses that part (and the tool that edits its kind). */
  focus(target: string, kind: BindKind): void;
  unbind(target: string, kind: BindKind): void;
  bindChosen(): void;
  setSize(size: PadSize): void;
  /** The slider goes to the key at `at` (clicking a key). */
  jump(at: number): void;
  keyHere(): void;
  setField(field: FormField, value: number): void;
  resetForm(): void;
  /** The curve the slider key at the spot is reached along from the key before it. */
  setEase(ease: string): void;
  /** A parameter of the "keyed by" list was chosen. */
  activate(control: string): void;
  /** Give the chosen part the keys of `from`, mirrored sideways when `mirror`. */
  copyKeys(from: string, control: string, mirror: boolean): void;
}

const shown = (v: number) => String(Math.round(v * 1000) / 1000);
const shown4 = (v: number) => String(Math.round(v * 1e4) / 1e4);
const FORM_INPUTS: { field: FormField; label: string; step: string; title: string }[] = [
  { field: 'dx', label: 'x', step: '0.005', title: 'Sideways move, as a fraction of the stage' },
  { field: 'dy', label: 'y', step: '0.005', title: 'Vertical move, as a fraction of the stage' },
  { field: 'sx', label: 'sx', step: '0.01', title: 'Width, added to 1' },
  { field: 'sy', label: 'sy', step: '0.01', title: 'Height, added to 1' },
  { field: 'rot', label: 'rot', step: '0.5', title: 'Rotation in degrees' },
  { field: 'opacity', label: 'opacity', step: '0.05', title: 'Opacity, a factor from 0 to 1' },
];
const KIND_TITLE: Record<BindKind, string> = {
  pose: 'Its pose: where the part or bone sits, how it turns and scales',
  warp: 'Its mesh warp (Warp tool, D)',
  mask: 'Its drawn mask (Mask tool, M)',
};

export class BindPanel {
  private drawn: Record<string, string> = {};
  private head: HTMLElement;
  private hint: HTMLElement;
  private list: HTMLElement;
  private bindRow: HTMLElement;
  private keysRow: HTMLElement;
  private keyBtns: HTMLElement;
  private keyHere: HTMLButtonElement;
  private formRow: HTMLElement;
  private formText: HTMLElement;
  private inputs: Record<string, HTMLInputElement>;
  private affect: HTMLElement;
  private sizeSel: HTMLSelectElement;
  private bindBtn: HTMLButtonElement;

  constructor(private root: HTMLElement, private host: BindHost) {
    this.root.innerHTML = `
      <div class="ab-head"><span class="as-pivot-name">Active parameter</span><strong class="ab-name"></strong><span class="ab-span as-pivot-hint"></span></div>
      <p class="as-pivot-hint ab-hint"></p>
      <div class="ab-bound"><h4 class="ab-h">Bound parts</h4><ul class="ab-list"></ul></div>
      <div class="ab-bindrow"><button type="button" class="ab-bind"></button>
        <label class="ab-size">Grid on a pad <select aria-label="Grid of a pad's keys when a part is bound to it">${PAD_SIZES.map(n => `<option value="${n}">${n} × ${n}</option>`).join('')}</select></label></div>
      <div class="ab-keys"><span class="as-pivot-name">Keys</span><span class="ab-keybtns" role="group" aria-label="Keys of the chosen part: click one to put the slider there"></span>
        <button type="button" class="ab-keyhere"></button></div>
      <div class="ab-form"><span class="as-pivot-name">Pose</span><span class="ab-formtext"></span>
        ${FORM_INPUTS.map(f => `<label title="${f.title}">${f.label} <input type="number" data-bf="${f.field}" step="${f.step}"${f.field === 'opacity' ? ' min="0"' : ''}></label>`).join('')}
        <label class="ab-easelabel" title="How the slider moves from the key before this one to this key (linear: straight)">ease <select class="ab-ease" aria-label="Curve into this key from the previous one">${EASE_NAMES.map(n => `<option value="${n}">${n}</option>`).join('')}</select></label>
        <button type="button" class="ab-reset" title="Put the pose stored here back to rest (the key stays)">Reset pose</button></div>
      <div class="ab-copy"><span class="as-pivot-name">Copy keys</span>
        <select class="ab-copyfrom" aria-label="Part whose keys the chosen part takes over"></select>
        <label title="Flip the poses sideways (x and rotation change sign) and the parameter's range end for end, as for the left and right of a face"><input type="checkbox" class="ab-mirror"> mirror</label>
        <button type="button" class="ab-copybtn" title="Replace the chosen part's keys on this parameter with the picked ones (a part on another parameter too, mapped min to min and max to max)">Copy</button></div>
      <div class="ab-affect"><span class="as-pivot-name">Moved by</span><span class="ab-affbtns" role="group" aria-label="Parameters that move the chosen part: click one to make it the active parameter"></span></div>`;
    const q = <T extends Element>(s: string) => this.root.querySelector<T>(s)!;
    this.head = q('.ab-head');
    this.hint = q('.ab-hint');
    this.list = q('.ab-list');
    this.bindRow = q('.ab-bindrow');
    this.bindBtn = q('.ab-bind');
    this.sizeSel = q<HTMLSelectElement>('.ab-size select');
    this.keysRow = q('.ab-keys');
    this.keyBtns = q('.ab-keybtns');
    this.keyHere = q('.ab-keyhere');
    this.formRow = q('.ab-form');
    this.formText = q('.ab-formtext');
    this.affect = q('.ab-affbtns');
    this.inputs = Object.fromEntries(FORM_INPUTS.map(f => [f.field, q<HTMLInputElement>(`[data-bf="${f.field}"]`)]));
    this.bindBtn.addEventListener('click', () => this.host.bindChosen());
    this.sizeSel.addEventListener('change', () => this.host.setSize(Number(this.sizeSel.value) as PadSize));
    this.keyHere.addEventListener('click', () => this.host.keyHere());
    for (const f of FORM_INPUTS) this.inputs[f.field].addEventListener('change', () => {
      const input = this.inputs[f.field], v = Number(input.value);
      if (input.value.trim() !== '' && Number.isFinite(v)) this.host.setField(f.field, v); else this.show();
    });
    q('.ab-reset').addEventListener('click', () => this.host.resetForm());
    q<HTMLSelectElement>('.ab-ease').addEventListener('change', e => this.host.setEase((e.target as HTMLSelectElement).value));
    q('.ab-copybtn').addEventListener('click', () => {
      const [target, control] = q<HTMLSelectElement>('.ab-copyfrom').value.split('\n');
      if (target && control) this.host.copyKeys(target, control, q<HTMLInputElement>('.ab-mirror').checked);
    });
  }

  /** Draw again from the studio's state. A part of the block whose content did not change is left as it is, so a focused button keeps focus. */
  show() {
    const v = this.host.view(), act = v.active;
    this.head.querySelector<HTMLElement>('.ab-name')!.textContent = act ? act.name : 'none';
    this.head.querySelector<HTMLElement>('.ab-span')!.textContent = act ? act.span : '';
    this.hint.textContent = v.hint;
    this.redraw('list', [v.bound, v.chosen, act?.control], () => {
      this.list.replaceChildren(...v.bound.map(b => {
        const pick = el('button', { type: 'button', className: 'ab-part' },
          el('span', { className: 'ab-pname', textContent: b.target }),
          el('span', { className: 'as-badge', textContent: b.kind, title: KIND_TITLE[b.kind] }),
          el('span', { className: 'as-muted', textContent: `${b.keys} key${b.keys === 1 ? '' : 's'}${b.posed ? ` · ${b.posed} posed` : ''}` }));
        pick.setAttribute('aria-pressed', String(b.chosen));
        pick.title = `Choose ${b.target} to pose it${b.kind === 'pose' ? '' : ` (switches to the ${b.kind === 'warp' ? 'Warp' : 'Mask'} tool)`}`;
        pick.addEventListener('click', () => this.host.focus(b.target, b.kind));
        const off = el('button', { type: 'button', className: 'ab-unbind', textContent: '✕', title: `Unbind ${b.target} from ${act?.name ?? 'the parameter'}: its keys here are removed` });
        off.setAttribute('aria-label', `Unbind ${b.target} from ${act?.name ?? 'the parameter'}`);
        off.addEventListener('click', () => this.host.unbind(b.target, b.kind));
        return el('li', { className: 'ab-item' }, pick, off);
      }));
    });
    this.root.querySelector<HTMLElement>('.ab-h')!.textContent = act ? `Bound parts (${v.bound.length})` : 'Bound parts';
    this.root.querySelector<HTMLElement>('.ab-bound')!.hidden = !act;
    this.bindRow.hidden = !act || (!v.canBind && !act.pad);
    this.bindBtn.hidden = !v.chosen || !v.canBind;
    this.bindBtn.textContent = v.chosen ? `Bind ${v.chosen}` : 'Bind';
    this.bindBtn.disabled = !v.canBind;
    this.bindBtn.title = v.chosen ? (v.canBind ? `Bind ${v.chosen} to ${act?.name}: keys at its minimum, default and maximum, all at rest` : `${v.chosen} is bound to ${act?.name}, or cannot be (a warp or a mask must exist first)`) : '';
    this.sizeSel.value = String(v.size);
    this.root.querySelector<HTMLElement>('.ab-size')!.hidden = !act?.pad;
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
    this.keyHere.textContent = v.keyAction === 'remove' ? 'Remove this key' : 'Add key here';
    this.keyHere.disabled = v.keyAction === 'default' || v.keyAction === null;
    this.keyHere.title = v.keyAction === 'remove' ? 'Remove the key at the slider\'s value' : v.keyAction === 'default' ? 'The key at the default stays: it is the rest pose the others are posed against' : 'Add a key at the slider\'s value, holding the pose on show';
    // The pose stored at the keyed spot.
    this.formRow.hidden = !act || !v.chosen;
    this.formText.textContent = v.form.text;
    for (const f of FORM_INPUTS) {
      const input = this.inputs[f.field];
      input.disabled = !v.form.can;
      if (document.activeElement !== input) input.value = v.form.values ? shown4(v.form.values[f.field]) : '';
      input.placeholder = v.form.can && !v.form.values ? 'no key' : '';
    }
    this.root.querySelector<HTMLButtonElement>('.ab-reset')!.disabled = !v.form.can || !v.form.values;
    for (const part of this.formRow.querySelectorAll<HTMLElement>('label, .ab-reset')) part.hidden = !v.form.can; // a warp or an unbound part has no fields: the text says why
    const easeSel = this.formRow.querySelector<HTMLSelectElement>('.ab-ease')!, hasEase = v.form.ease !== undefined && v.form.ease !== null;
    this.formRow.querySelector<HTMLElement>('.ab-easelabel')!.hidden = !v.form.can || !hasEase; // only a slider key reaches its pose along a curve
    if (hasEase) easeSel.value = v.form.ease!;
    // What moves the chosen part.
    const copy = this.root.querySelector<HTMLElement>('.ab-copy')!, from = copy.querySelector<HTMLSelectElement>('.ab-copyfrom')!;
    copy.hidden = !act || !v.chosen || !v.copyFrom.length;
    this.redraw('copy', [v.copyFrom, v.chosen], () => { from.replaceChildren(...v.copyFrom.map(c => el('option', { value: `${c.target}\n${c.control}`, textContent: c.label }))); });
    this.affect.parentElement!.hidden = !v.chosen;
    this.redraw('affect', [v.affecting, v.chosen], () => {
      this.affect.replaceChildren(...(v.affecting.length ? v.affecting.map(a => {
        const b = el('button', { type: 'button', className: 'ab-aff', textContent: a.name, title: `${v.chosen} is moved by ${a.name} (${a.kind}): click to make it the active parameter` });
        if (a.kind !== 'pose') b.append(el('span', { className: 'as-badge', textContent: a.kind }));
        b.setAttribute('aria-pressed', String(a.active));
        b.addEventListener('click', () => this.host.activate(a.control));
        return b;
      }) : [el('span', { className: 'as-muted', textContent: `nothing yet: ${v.chosen} is not bound to a parameter` })]));
    });
  }

  private redraw(part: string, sig: unknown, draw: () => void) {
    const s = JSON.stringify(sig);
    if (this.drawn[part] === s) return;
    this.drawn[part] = s;
    draw();
  }
}
