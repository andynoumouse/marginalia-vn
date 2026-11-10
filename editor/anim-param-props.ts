// The animation studio's Parameter section (Model mode, docs/design/studio-inspector.md): shown in the right column when a parameter
// alone is in focus, in place of Keyforms and Properties. It holds the parameter's properties, which used to be the palette's ✎ fold-out:
// its name, category, range, default and ease, its place in its group and Delete; for a pad, the pad's name, category and Delete, and its
// two parameters, each a button that makes that axis the focus (its own fields show then). The fields are made once per control and
// filled in place afterwards, so Tab after a changed field goes on to the next one although the studio redraws.

import { EASE_NAMES, OTHER, rangeLine, type PadDef, type PadPatch, type ParamDef, type ParamPatch } from '../engine/src/index.js';
import { el } from './anim-dom.js';

export type ParamPropsView =
  | { kind: 'slider'; def: ParamDef; /** The pad this parameter is an axis of. */ pad: string | null }
  | { kind: 'pad'; pad: PadDef }
  | null;

export interface ParamPropsHost {
  view(): ParamPropsView;
  categories(): string[];
  /** Each returns the id the thing has afterwards, null when refused (the studio's note says why). */
  editParam(id: string, patch: ParamPatch): string | null;
  editPad(id: string, patch: PadPatch): string | null;
  deleteParam(id: string): void;
  deletePad(id: string): void;
  /** One place up (-1) or down (1) inside its group; `control` is the parameter id or `pad:<id>`. */
  moveControl(control: string, dir: -1 | 1): void;
  /** Make a control the focus (a pad's axis, or the pad itself). */
  choose(control: string): void;
}

const shown4 = (v: number) => String(Math.round(v * 1e4) / 1e4);
/** Letters, digits and _ only: a space becomes _ as you type and anything else is dropped. */
function nameInput(input: HTMLInputElement) {
  input.addEventListener('input', () => {
    const at = input.selectionStart;
    const clean = input.value.replace(/\s/g, '_').replace(/\W/g, '');
    if (clean !== input.value) { input.value = clean; input.setSelectionRange(at, at); }
  });
}

export class ParamProps {
  /** The control the fields were made for (a parameter id or `pad:<id>`); '' for none. */
  private made = '';
  private cats = '';

  constructor(private root: HTMLElement, private host: ParamPropsHost) {
    root.innerHTML = `
      <p class="as-pivot-hint apm-none">Choose a parameter in Parameters to see its properties.</p>
      <div class="apm-slider" role="group" aria-label="The parameter's properties">
        <p class="apm-range"></p>
        <p class="as-pivot-hint apm-axis"><span></span> <button type="button" class="apm-topad"></button></p>
        <div class="apm-fields">
          <label class="apm-wide">name <input type="text" class="apm-name" size="12" spellcheck="false" autocomplete="off" title="Letters, digits and _ only (a space becomes _), starting with a letter or _"></label>
          <label class="apm-wide">category <select class="apm-cat"></select></label>
          <label>min <input type="number" class="apm-min" step="any"></label>
          <label>max <input type="number" class="apm-max" step="any"></label>
          <label>default <input type="number" class="apm-default" step="any"></label>
          <label>ease <select class="apm-ease"><option value="">(linear)</option>${EASE_NAMES.map(n => `<option value="${n}">${n}</option>`).join('')}</select></label>
        </div>
        <div class="apm-btns"><button type="button" class="apm-up" title="Move up in its group" aria-label="Move up in its group">▲</button><button type="button" class="apm-down" title="Move down in its group" aria-label="Move down in its group">▼</button><button type="button" class="apm-delete">Delete parameter</button></div>
      </div>
      <div class="apm-pad" role="group" aria-label="The pad's properties">
        <p class="apm-range apm-padaxes"><button type="button" class="apm-axisbtn" data-axis="x"></button> across, <button type="button" class="apm-axisbtn" data-axis="y"></button> up</p>
        <div class="apm-fields">
          <label class="apm-wide">name <input type="text" class="apm-name" size="12" spellcheck="false" autocomplete="off" title="Letters, digits and _ only (a space becomes _), starting with a letter or _"></label>
          <label class="apm-wide">category <select class="apm-cat"></select></label>
        </div>
        <div class="apm-btns"><button type="button" class="apm-delete">Delete pad</button></div>
      </div>`;
    this.wireSlider(root.querySelector<HTMLElement>('.apm-slider')!);
    this.wirePad(root.querySelector<HTMLElement>('.apm-pad')!);
  }

  /** The control on show, as its key: a parameter id or `pad:<id>`. */
  private key(): string { const v = this.host.view(); return !v ? '' : v.kind === 'pad' ? `pad:${v.pad.id}` : v.def.id; }

  private wireSlider(box: HTMLElement) {
    const q = <T extends Element>(s: string) => box.querySelector<T>(s)!;
    const id = () => { const v = this.host.view(); return v?.kind === 'slider' ? v.def.id : null; };
    const send = (patch: ParamPatch) => { const p = id(); if (p !== null && this.host.editParam(p, patch) === null) this.show(true); };
    const name = q<HTMLInputElement>('.apm-name');
    nameInput(name);
    const rename = () => { const p = id(), to = name.value.trim(); if (p !== null && to !== p) send({ id: to }); };
    name.addEventListener('change', rename);
    name.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); rename(); } });
    q<HTMLSelectElement>('.apm-cat').addEventListener('change', e => send({ group: (e.target as HTMLSelectElement).value }));
    q<HTMLSelectElement>('.apm-ease').addEventListener('change', e => send({ ease: (e.target as HTMLSelectElement).value }));
    for (const [cls, field] of [['.apm-min', 'min'], ['.apm-max', 'max'], ['.apm-default', 'default']] as const) {
      const input = q<HTMLInputElement>(cls);
      input.addEventListener('change', () => {
        const v = Number(input.value);
        if (input.value.trim() === '' || !Number.isFinite(v)) { this.show(true); return; }
        send({ [field]: v });
      });
    }
    q('.apm-up').addEventListener('click', () => { const p = id(); if (p !== null) this.host.moveControl(p, -1); });
    q('.apm-down').addEventListener('click', () => { const p = id(); if (p !== null) this.host.moveControl(p, 1); });
    q('.apm-delete').addEventListener('click', () => { const p = id(); if (p !== null) this.host.deleteParam(p); });
    q('.apm-topad').addEventListener('click', () => { const v = this.host.view(); if (v?.kind === 'slider' && v.pad) this.host.choose(`pad:${v.pad}`); });
  }

  private wirePad(box: HTMLElement) {
    const q = <T extends Element>(s: string) => box.querySelector<T>(s)!;
    const pad = () => { const v = this.host.view(); return v?.kind === 'pad' ? v.pad : null; };
    const send = (patch: PadPatch) => { const p = pad(); if (p && this.host.editPad(p.id, patch) === null) this.show(true); };
    const name = q<HTMLInputElement>('.apm-name');
    nameInput(name);
    const rename = () => { const p = pad(), to = name.value.trim(); if (p && to !== p.id) send({ id: to }); };
    name.addEventListener('change', rename);
    name.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); rename(); } });
    q<HTMLSelectElement>('.apm-cat').addEventListener('change', e => send({ group: (e.target as HTMLSelectElement).value }));
    q('.apm-delete').addEventListener('click', () => { const p = pad(); if (p) this.host.deletePad(p.id); });
    for (const b of box.querySelectorAll<HTMLButtonElement>('.apm-axisbtn')) b.addEventListener('click', () => { const p = pad(); if (p) this.host.choose(b.dataset.axis === 'x' ? p.x : p.y); });
  }

  /** Put the name field in focus (a new parameter or pad: its name is the first thing to type). */
  focusName() {
    const box = this.root.querySelector<HTMLElement>(this.host.view()?.kind === 'pad' ? '.apm-pad' : '.apm-slider')!;
    const name = box.querySelector<HTMLInputElement>('.apm-name')!;
    name.focus();
    name.select();
  }

  /** Fill the fields from the studio's state; a field being typed in is left alone unless `force` (a refused edit shows the old value again). */
  show(force = false) {
    const v = this.host.view(), key = this.key();
    const slider = this.root.querySelector<HTMLElement>('.apm-slider')!, padBox = this.root.querySelector<HTMLElement>('.apm-pad')!;
    this.root.querySelector<HTMLElement>('.apm-none')!.hidden = !!v;
    slider.hidden = v?.kind !== 'slider';
    padBox.hidden = v?.kind !== 'pad';
    const fresh = force || key !== this.made;
    this.made = key;
    // The category lists, when the categories changed.
    const cats = this.host.categories(), sig = JSON.stringify(cats);
    if (sig !== this.cats) {
      this.cats = sig;
      for (const sel of this.root.querySelectorAll<HTMLSelectElement>('.apm-cat')) sel.replaceChildren(el('option', { value: '', textContent: OTHER }), ...cats.map(c => el('option', { value: c, textContent: c })));
    }
    const put = (input: HTMLInputElement | HTMLSelectElement, value: string) => { if (fresh || document.activeElement !== input) input.value = value; };
    if (v?.kind === 'slider') {
      const d = v.def, q = <T extends Element>(s: string) => slider.querySelector<T>(s)!;
      q('.apm-range').textContent = rangeLine(d);
      q<HTMLElement>('.apm-axis').hidden = !v.pad;
      q('.apm-axis > span').textContent = v.pad ? `An axis of the pad ${v.pad}: it keeps the pad's category.` : '';
      q('.apm-topad').textContent = v.pad ? `Show ${v.pad}` : '';
      put(q<HTMLInputElement>('.apm-name'), d.id);
      const cat = q<HTMLSelectElement>('.apm-cat');
      put(cat, d.group ?? '');
      cat.disabled = !!v.pad;
      cat.title = v.pad ? "An axis of a pad stays in the pad's category" : '';
      put(q<HTMLInputElement>('.apm-min'), shown4(d.min));
      put(q<HTMLInputElement>('.apm-max'), shown4(d.max));
      put(q<HTMLInputElement>('.apm-default'), shown4(d.default));
      put(q<HTMLSelectElement>('.apm-ease'), d.ease ?? '');
      for (const [cls, what] of [['.apm-name', 'Name'], ['.apm-cat', 'Category'], ['.apm-min', 'Minimum'], ['.apm-max', 'Maximum'], ['.apm-default', 'Default'], ['.apm-ease', 'Ease']]) q(cls).setAttribute('aria-label', `${what} of ${d.id}`);
      const del = q<HTMLButtonElement>('.apm-delete');
      del.title = `Delete ${d.id} and the keyforms, pose values and tracks that use it`;
    } else if (v?.kind === 'pad') {
      const p = v.pad, q = <T extends Element>(s: string) => padBox.querySelector<T>(s)!;
      const [bx, by] = padBox.querySelectorAll<HTMLButtonElement>('.apm-axisbtn');
      bx.textContent = p.x; bx.title = `Show ${p.x}, the pad's across parameter: its range, default and ease`;
      by.textContent = p.y; by.title = `Show ${p.y}, the pad's up parameter: its range, default and ease`;
      put(q<HTMLInputElement>('.apm-name'), p.id);
      put(q<HTMLSelectElement>('.apm-cat'), p.group ?? '');
      q('.apm-name').setAttribute('aria-label', `Name of ${p.id}`);
      q('.apm-cat').setAttribute('aria-label', `Category of ${p.id}`);
      q<HTMLButtonElement>('.apm-delete').title = `Delete the pad ${p.id}; its parameters and their keyforms stay`;
    }
  }
}
