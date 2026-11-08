// Theme panel: the palette (tokens) and the components of a theme file as form fields. Every edit rewrites the theme's
// JSON through the host (the theme's tab), so the file, the preview and the raw JSON stay one thing. A field shows where
// an unset value comes from (an extended theme) and has a reset button.

import { ThemeGallery } from './theme-gallery.js';
import { trapModal } from './modal.js';
import { TOKEN_FIELDS, componentKeys, componentStates, componentFields, setThemeValue, themeValueSource, contrastNote, COMMON_FONTS, fontNote, type ThemeField } from '../engine/src/index.js';
import { esc } from '../engine/src/util.js';

export interface ThemeHost {
  /** Names of the theme files. */
  themes(): string[];
  /** Names of the built-in themes (read-only: view them, or duplicate one into a theme file). */
  builtIns(): string[];
  /** Create themes/<to>.json from the theme `from` (a file or a built-in one); the new tab is saved with the next save. */
  duplicate(from: string, to: string): void;
  /** The text of a theme file as the editor has it; null if there is none yet. */
  text(name: string): string | null;
  /** Every theme file parsed (for `extends` lookups). */
  parsed(): Record<string, unknown>;
  /** Write new text into the theme's tab (opening it) and save. */
  apply(name: string, text: string): void;
  /** Show the raw JSON tab. */
  openJson(name: string): void;
  /** Font files in assets/fonts/. */
  fonts(): string[];
  /** The stage stylesheet (`themeCss`) of a theme file with its `extends` chain resolved, for the screen gallery. */
  css(name: string): string;
  /** The game's stage size (game.json `stage`), which the gallery tiles are drawn at. */
  stage(): { width: number; height: number };
}


export class ThemeDialog {
  private readonly root: HTMLDivElement;
  private readonly body: HTMLElement;
  private readonly nameSel: HTMLSelectElement;
  private tab: 'palette' | 'components' = 'palette';
  private comp = 'button';
  private state = '';
  private duplicating = false;
  private returnFocus: (() => void) | null = null;
  private readonly gallery: ThemeGallery;

  constructor(host: HTMLElement, private readonly h: ThemeHost) {
    this.root = document.createElement('div');
    this.root.id = 'themePanel';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="td-card" role="dialog" aria-modal="true" aria-label="Theme">
        <header><strong>Theme</strong><select class="td-name" aria-label="Theme file"></select>
          <span class="td-tabs"><button type="button" data-tab="palette">Palette</button><button type="button" data-tab="components">Components</button><button type="button" class="td-json">Advanced (JSON)</button><button type="button" class="td-dup-btn" title="Start a new theme file from this one">Duplicate…</button></span>
          <button type="button" class="close" aria-label="Close theme panel">Close</button></header>
        <div class="td-main"><div class="td-body"></div></div>
      </div>`;
    host.append(this.root);
    this.body = this.root.querySelector('.td-body')!;
    // Clicking a part in a gallery tile jumps to the component (and state) that styles it.
    this.gallery = new ThemeGallery(i => { this.tab = 'components'; this.comp = i.key; this.state = i.state; this.render(); this.body.querySelector('.td-comp')?.scrollIntoView({ block: 'nearest' }); });
    this.root.querySelector('.td-main')!.append(this.gallery.element);
    this.nameSel = this.root.querySelector('.td-name')!;
    this.root.addEventListener('mousedown', e => { if (e.target === this.root) this.close(); });
    this.root.querySelector('.close')!.addEventListener('click', () => this.close());
    this.root.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); } });
    trapModal(this.root, () => this.close());
    this.nameSel.addEventListener('change', () => this.render());
    this.root.querySelector('.td-json')!.addEventListener('click', () => { const n = this.name; this.close(); if (n) this.h.openJson(n); });
    this.root.querySelector('.td-dup-btn')!.addEventListener('click', () => this.duplicate());
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-tab]')) b.addEventListener('click', () => { this.tab = b.dataset.tab as 'palette' | 'components'; this.render(); });
  }

  get isOpen() { return !this.root.hidden; }
  private get name() { return this.nameSel.value; }
  private get builtIn() { return !this.h.themes().includes(this.name); }

  /** Fills the theme list: the theme files, then the built-in ones that no file replaces. */
  private fillNames(select?: string) {
    const files = this.h.themes();
    const builtIns = this.h.builtIns().filter(n => !files.includes(n));
    this.nameSel.innerHTML = files.map(n => `<option>${esc(n)}</option>`).join('')
      + builtIns.map(n => `<option value="${esc(n)}">${esc(n)} (built-in)</option>`).join('');
    if (select && [...files, ...builtIns].includes(select)) this.nameSel.value = select;
  }

  open(theme: string | null, returnFocus: () => void) {
    this.returnFocus = returnFocus;
    this.duplicating = false;
    this.fillNames(theme ?? undefined);
    this.root.hidden = false;
    this.render();
    this.nameSel.focus();
  }

  /** Asks for a name and makes a theme file from the selected theme (call after `open`). */
  duplicate() {
    this.duplicating = true;
    this.render();
    this.body.querySelector<HTMLInputElement>('.td-dup input')?.focus();
  }

  /** "Extends paper → base": the chain a theme inherits from, with a picker to change the parent of a theme file. */
  private extendsRow(name: string, builtIn: boolean, files: Record<string, unknown>) {
    const parentOf = (n: string) => { const e = (files[n] as { extends?: unknown } | undefined)?.extends; return typeof e === 'string' ? e : null; };
    const chain: string[] = [];
    for (let n = parentOf(name); n !== null && !chain.includes(n) && n !== name; n = Object.hasOwn(files, n) ? parentOf(n) : null) chain.push(n);
    const missing = chain.length > 0 && !Object.hasOwn(files, chain[chain.length - 1]);
    const text = chain.length ? `Extends ${chain.map(esc).join(' → ')}${missing ? ` <span class="td-warn">(no theme "${esc(chain[chain.length - 1])}")</span>` : ''}` : 'Extends nothing (the plain look)';
    if (builtIn) return `<p class="td-extends">${text}</p>`;
    const choices = ['', ...[...this.h.themes(), ...this.h.builtIns()].filter((n, i, a) => n !== name && a.indexOf(n) === i)];
    const cur = parentOf(name) ?? '';
    return `<p class="td-extends"><label>Extends <select class="td-parent" aria-label="Theme this one extends">${choices.map(n => `<option value="${esc(n)}"${n === cur ? ' selected' : ''}>${n ? esc(n) : '(nothing)'}</option>`).join('')}${cur && !choices.includes(cur) ? `<option value="${esc(cur)}" selected>${esc(cur)} (missing)</option>` : ''}</select></label>
      <span class="td-src">${chain.length > 1 ? `chain: ${chain.map(esc).join(' → ')}` : ''}${missing ? '<span class="td-warn"> no such theme</span>' : ''}</span></p>`;
  }

  private duplicateRow(name: string) {
    const row = document.createElement('div');
    row.className = 'td-dup';
    row.innerHTML = `<label>New theme from ${esc(name)}: themes/ <input type="text" value="${esc(name)}-copy" spellcheck="false" aria-label="Name of the new theme"> .json</label>
      <button type="button" class="td-make">Create</button><button type="button" class="td-cancel">Cancel</button><span class="td-warn" role="alert"></span>`;
    const input = row.querySelector('input')!, err = row.querySelector('.td-warn')!;
    const make = () => {
      const to = input.value.trim();
      const taken = [...this.h.themes(), ...this.h.builtIns()];
      if (!/^[\w-]+$/.test(to)) { err.textContent = 'Use letters, digits, _ and -'; return; }
      if (taken.includes(to)) { err.textContent = `"${to}" already exists`; return; }
      this.h.duplicate(name, to);
      this.duplicating = false;
      this.fillNames(to);
      this.render();
    };
    row.querySelector('.td-make')!.addEventListener('click', make);
    row.querySelector('.td-cancel')!.addEventListener('click', () => { this.duplicating = false; this.render(); });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); make(); } });
    input.select();
    return row;
  }

  close() {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.returnFocus?.();
  }

  private render() {
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-tab]')) b.setAttribute('aria-pressed', String(b.dataset.tab === this.tab));
    const name = this.name;
    if (!name) { this.body.innerHTML = '<p class="td-empty">No theme file yet. Use "Theme: Open or Create a Theme File".</p>'; return; }
    const builtIn = this.builtIn;
    this.root.querySelector<HTMLButtonElement>('.td-json')!.hidden = builtIn;
    const files = this.h.parsed();
    let html = this.extendsRow(name, builtIn, files) + (builtIn ? '<p class="td-note">A built-in theme: read-only. Use Duplicate… to start a theme file from it.</p>' : '');
    let fields: ThemeField[];
    if (this.tab === 'palette') fields = TOKEN_FIELDS;
    else {
      if (!componentStates(this.comp).includes(this.state)) this.state = '';
      html += `<div class="td-pick"><label>Component <select class="td-comp">${componentKeys().map(k => `<option${k === this.comp ? ' selected' : ''}>${k}</option>`).join('')}</select></label>
        <label>State <select class="td-state">${componentStates(this.comp).map(s => `<option value="${s}"${s === this.state ? ' selected' : ''}>${s || 'resting'}</option>`).join('')}</select></label></div>`;
      fields = componentFields(this.comp, this.state);
    }
    const fonts = this.h.fonts();
    html += '<div class="td-fields">' + fields.map((f, i) => {
      const { value, from } = themeValueSource(name, f.path, files);
      const own = from === name && !builtIn;
      const hint = from === name ? (builtIn ? 'built in' : 'set here') : from ? `from ${esc(from)}` : 'default';
      const v = value === undefined ? '' : String(value);
      const input = f.kind === 'font'
        ? `<select data-i="${i}"${builtIn ? ' disabled' : ''}><option value="">(default)</option>`
          + (fonts.length ? `<optgroup label="Project fonts (assets/fonts)">${fonts.map(x => `<option${x === v ? ' selected' : ''}>${esc(x)}</option>`).join('')}</optgroup>` : '')
          + `<optgroup label="Common system fonts">${COMMON_FONTS.filter(x => !fonts.includes(x)).map(x => `<option${x === v ? ' selected' : ''}>${esc(x)}</option>`).join('')}</optgroup>`
          + `${v && !fonts.includes(v) && !COMMON_FONTS.includes(v) ? `<option selected>${esc(v)}</option>` : ''}</select>`
        : `<input data-i="${i}" type="${f.kind === 'number' ? 'number' : 'text'}" value="${esc(v)}" spellcheck="false"${builtIn ? ' disabled' : ''}>`
          + (f.kind === 'color' ? `<input class="td-swatch" data-sw="${i}" type="color"${builtIn ? ' disabled' : ''} value="${/^#[0-9a-f]{6}$/i.test(v) ? v : '#000000'}" aria-label="Pick ${f.label}">` : '');
      const note = f.kind === 'color' ? contrastNote(f.path, p => themeValueSource(name, p, files).value) : f.kind === 'font' ? fontNote(v, fonts) : null;
      return `<div class="td-field" data-own="${own}"><label>${f.label}</label>${input}<span class="td-src">${hint}</span><button type="button" class="td-reset" data-r="${i}"${own ? '' : ' hidden'} aria-label="Reset ${f.label}">Reset</button>`
        + (note ? `<span class="td-warn" role="note">${esc(note)}</span>` : '') + '</div>';
    }).join('') + '</div>';
    this.body.innerHTML = html;
    this.body.querySelector<HTMLSelectElement>('.td-parent')?.addEventListener('change', e => {
      const next = setThemeValue(this.h.text(name) ?? '{}', ['extends'], (e.target as HTMLSelectElement).value || undefined);
      if (next !== null) this.h.apply(name, next);
      this.render();
    });
    if (this.duplicating) this.body.prepend(this.duplicateRow(name));
    void this.gallery.update(this.h.css(name), this.h.stage());
    this.body.querySelector<HTMLSelectElement>('.td-comp')?.addEventListener('change', e => { this.comp = (e.target as HTMLSelectElement).value; this.render(); });
    this.body.querySelector<HTMLSelectElement>('.td-state')?.addEventListener('change', e => { this.state = (e.target as HTMLSelectElement).value; this.render(); });
    const set = (f: ThemeField, raw: string) => {
      const value = raw === '' ? undefined : f.kind === 'number' ? (Number.isFinite(Number(raw)) ? Number(raw) : undefined) : raw;
      const next = setThemeValue(this.h.text(name) ?? '{}', f.path, value);
      if (next !== null) this.h.apply(name, next);
    };
    for (const el of this.body.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-i],[data-sw]')) {
      const f = fields[Number(el.dataset.i ?? el.dataset.sw)];
      el.addEventListener('change', () => { set(f, el.value); this.render(); });
    }
    for (const el of this.body.querySelectorAll<HTMLButtonElement>('[data-r]')) {
      el.addEventListener('click', () => { set(fields[Number(el.dataset.r)], ''); this.render(); });
    }
  }
}
