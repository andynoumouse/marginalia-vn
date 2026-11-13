// Translations: every string of the script beside its translation, for one language at a time. The strings, their context and the
// progress counts come from the engine (translation.ts); this draws the table and saves edits to locale/<lang>.json as you type.
// The list is virtual (virtual-list.ts): projects can have tens of thousands of strings, so only the rows in (and just around)
// the viewport exist in the DOM.

import { dropUnused, importTranslatorCsv, translationStatus, translatorCsv, uiLabelRows, outdatedIds, type SourceSnapshot, type StringRow, type StringTable } from '../engine/src/index.js';
import { VirtualList } from './virtual-list.js';
import { mountModal } from './modal.js';
import { choiceAsk } from './ask.js';

export interface TranslationsHost {
  /** The strings of the current scripts, in script order. */
  rows(): StringRow[];
  /** Show a string's line in the editor. */
  reveal(file: string, line: number): void;
  /** How many string lines have no id yet (they cannot be translated until they get one). */
  missingIds(): number;
  /** Give every string line an id; returns how many were added. */
  addIds(): number;
  /** The language the scripts are written in (game.json "language", default en). */
  source(): string;
  /** game.json "labels": the menu labels in the source language that replace the built-in texts. */
  labels(): Record<string, string>;
}

const ROW_HEIGHT = 88;
const SAVE_DELAY = 500;
const FILTER_DELAY = 150;
const LANG = /^[A-Za-z]{2,3}([_-][A-Za-z0-9]+)?$/;
const KIND: Record<StringRow['kind'], string> = { say: 'line', choice: 'choice', reason: 'disabled choice', prompt: 'menu prompt', input: 'input prompt', ending: 'ending name', other: 'screen / item', label: 'menu label' };

export class TranslationsDialog {
  private readonly root: HTMLDivElement;
  private readonly langSel: HTMLSelectElement;
  private readonly filter: HTMLInputElement;
  private readonly todo: HTMLInputElement;
  private readonly changed: HTMLInputElement;
  private readonly summary: HTMLElement;
  private readonly scroller: HTMLElement;
  private readonly list: VirtualList<StringRow>;
  private readonly newLang: HTMLInputElement;
  private idsBar!: HTMLElement;
  private prune!: HTMLButtonElement;
  private tables: Record<string, StringTable> = {};
  private snaps: Record<string, SourceSnapshot> = {}; // per language: the source text each translation was made against
  private snapSaves = new Map<string, number>();
  private outdated = new Set<string>(); // ids of the current language whose source changed after they were translated
  private rows: StringRow[] = [];
  private shown: StringRow[] = []; // the rows passing the filter, in order
  private lang = '';
  private saves = new Map<string, number>();
  private filterTimer = 0;
  private returnFocus: (() => void) | null = null;

  constructor(host: HTMLElement, private readonly h: TranslationsHost) {
    const { root, q } = mountModal(host, 'translations', `
      <div class="tr-card" role="dialog" aria-modal="true" aria-label="Translations">
        <header><strong>Translations</strong><span class="hint">Esc to close. Edits are saved as you type.</span>
          <button type="button" class="close" aria-label="Close translations">Close</button></header>
        <div class="tr-bar">
          <label>Language <select class="tr-lang" aria-label="Language"></select></label>
          <input class="tr-new" type="text" placeholder="new language, e.g. fi" aria-label="New language code" size="20">
          <button type="button" class="tr-add">Add</button>
          <input class="tr-filter" type="search" placeholder="Filter by text, id, speaker, label or file" aria-label="Filter strings">
          <label><input class="tr-todo" type="checkbox"> Untranslated only</label>
          <label><input class="tr-changed" type="checkbox"> Source changed only</label>
          <button type="button" class="tr-csv" title="Download every string with its context and all translations as a spreadsheet for translators">Export CSV</button>
          <button type="button" class="tr-import" title="Read translations back from a CSV sheet with an id column and a column per language code (empty cells keep what is there)">Import CSV</button>
        </div>
        <div class="tr-ids" hidden><span class="tr-ids-msg"></span><button type="button" class="tr-ids-add">Add ids to all files</button></div>
        <div class="tr-status"><div class="tr-summary" role="status"></div><button type="button" class="tr-prune" hidden title="Delete the entries whose id no line of the script has any more">Remove unused</button></div>
        <div class="tr-scroll"><div class="tr-spacer"></div></div>
      </div>`, () => this.close());
    this.root = root;
    this.langSel = q('.tr-lang'); this.filter = q('.tr-filter'); this.todo = q('.tr-todo'); this.changed = q('.tr-changed');
    this.summary = q('.tr-summary'); this.scroller = q('.tr-scroll'); this.newLang = q('.tr-new');
    this.langSel.addEventListener('change', () => { this.lang = this.langSel.value; this.refilter(); });
    this.filter.addEventListener('input', () => { window.clearTimeout(this.filterTimer); this.filterTimer = window.setTimeout(() => this.refilter(), FILTER_DELAY); });
    this.todo.addEventListener('change', () => this.refilter());
    this.changed.addEventListener('change', () => this.refilter());
    q('.tr-add').addEventListener('click', () => this.addLanguage());
    this.newLang.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); this.addLanguage(); } });
    q('.tr-csv').addEventListener('click', () => this.exportCsv());
    q('.tr-import').addEventListener('click', () => this.pickCsv());
    this.prune = q('.tr-prune');
    this.prune.addEventListener('click', () => void this.removeUnused());
    this.idsBar = q('.tr-ids');
    q('.tr-ids-add').addEventListener('click', () => {
      this.h.addIds();
      this.rows = this.allRows();
      this.refilter();
    });
    this.list = new VirtualList(this.scroller, q('.tr-spacer'), ROW_HEIGHT, r => this.rowEl(r, this.tables[this.lang]));
  }

  get isOpen() { return !this.root.hidden; }

  async open(returnFocus: () => void) {
    this.returnFocus = returnFocus;
    this.root.hidden = false;
    this.summary.textContent = 'Loading...';
    this.flushPending(); // so the GET below cannot return a table older than an edit still waiting for its debounce
    this.rows = this.allRows(); // the labels are already known after the first open
    // Read into locals: the rows still on screen keep their table until the new ones are whole.
    const tables: Record<string, StringTable> = {}, snaps: Record<string, SourceSnapshot> = {};
    try {
      const all = await (await fetch('/api/locales')).json() as Record<string, string>;
      for (const [file, text] of Object.entries(all)) {
        const lang = file.replace(/^locale\/|\.(json|src)$/g, '');
        try {
          if (file.endsWith('.src')) snaps[lang] = JSON.parse(text) as SourceSnapshot;
          else tables[lang] = JSON.parse(text) as StringTable;
        } catch { /* a broken file is left alone */ }
      }
    } catch { /* no locale folder yet */ }
    if (!Object.keys(this.uiDefaults).length) { this.uiDefaults = await this.loadUiDefaults(); this.rows = this.allRows(); } // read once: the page does not change while the editor is open
    delete tables[this.h.source()]; // <source>.json is only an export of the script, which is the source language
    this.tables = tables;
    this.snaps = snaps;
    const langs = Object.keys(this.tables).sort();
    if (!langs.includes(this.lang)) this.lang = langs[0] ?? '';
    this.fillLanguages();
    this.refilter();
    (this.lang ? this.filter : this.newLang).focus();
  }

  /** The script's strings, then the built-in menu labels (`ui.<key>`). */
  private allRows(): StringRow[] { return [...this.h.rows(), ...uiLabelRows(this.uiDefaults, this.h.labels())]; }

  /** The menu labels the game page ships (its `data-ui` elements, the page the preview shows) by key, with their built-in text. */
  private async loadUiDefaults(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    try {
      const doc = new DOMParser().parseFromString(await (await fetch('../')).text(), 'text/html');
      for (const e of doc.querySelectorAll<HTMLElement>('[data-ui]')) {
        const key = e.dataset.ui!;
        if (!(key in out)) out[key] = (e.textContent ?? '').trim();
      }
    } catch { /* no page to read: only the script's strings are listed */ }
    return out;
  }
  private uiDefaults: Record<string, string> = {};

  close() {
    if (this.root.hidden) return;
    this.flushPending();
    this.root.hidden = true;
    this.returnFocus?.();
  }

  /** Writes the edits still waiting for their debounce (on close, before a reload, and when the editor is left). */
  flushPending() {
    for (const lang of [...this.saves.keys()]) this.flush(lang);
    for (const lang of [...this.snapSaves.keys()]) this.flushSnap(lang);
  }

  private fillLanguages() {
    this.langSel.replaceChildren(...Object.keys(this.tables).sort().map(l => Object.assign(document.createElement('option'), { value: l, textContent: l })));
    this.langSel.value = this.lang;
  }

  private addLanguage() {
    const code = this.newLang.value.trim();
    const source = this.h.source();
    if (!LANG.test(code) || code.toLowerCase() === source.toLowerCase()) { this.summary.textContent = `A language code is 2-3 letters, optionally with a region (fi, pt-BR); ${source} is the script itself.`; return; }
    this.newLang.value = '';
    const isNew = !this.tables[code];
    this.tables[code] ??= {};
    this.snaps[code] ??= {};
    this.lang = code;
    this.fillLanguages();
    this.refilter();
    if (isNew) this.flush(code); // locale/<code>.json is written at once, so the language stays when the dialog closes before a line is typed (ED-3)
  }

  /** The filter, language or table changed: recompute which rows show and redraw the window. */
  private refilter() {
    const missing = this.h.missingIds();
    this.idsBar.hidden = !missing;
    this.idsBar.querySelector('.tr-ids-msg')!.textContent = `${missing} ${missing === 1 ? 'line has' : 'lines have'} no id yet and can't be translated.`;
    const table = this.tables[this.lang];
    if (!table) {
      this.prune.hidden = true;
      this.shown = [];
      this.list.set([]);
      this.summary.textContent = 'No translations yet: add a language code above to start one.';
      return;
    }
    const q = this.filter.value.trim().toLowerCase();
    this.outdated = new Set(outdatedIds(this.rows, table, this.snaps[this.lang] ??= {}));
    this.shown = this.rows.filter(r => (!this.todo.checked || !table[r.id]) && (!this.changed.checked || this.outdated.has(r.id))
      && (!q || [r.id, r.source, table[r.id] ?? '', r.who ?? '', r.label ?? '', r.file ?? ''].some(s => s.toLowerCase().includes(q))));
    this.updateSummary();
    this.list.set(this.shown);
  }

  private updateSummary() {
    const table = this.tables[this.lang];
    if (!table) return;
    const st = translationStatus(this.rows, table);
    this.summary.textContent = `${st.translated} of ${st.total} translated`
      + (this.outdated.size ? ` · ${this.outdated.size} with changed source` : '')
      + (st.unused.length ? ` · ${st.unused.length} unused ${st.unused.length === 1 ? 'entry' : 'entries'} in locale/${this.lang}.json` : '')
      + (this.shown.length !== st.total ? ` · ${this.shown.length} shown` : '');
    this.prune.hidden = !st.unused.length;
  }

  /** Delete the current language's entries that match no string, from the table and its snapshot, after asking. */
  private async removeUnused() {
    const lang = this.lang, table = this.tables[lang];
    if (!table) return;
    const { unused } = translationStatus(this.rows, table);
    if (!unused.length) return;
    const n = unused.length === 1 ? '1 entry' : `${unused.length} entries`;
    const pick = await choiceAsk(`Remove ${n} from locale/${lang}.json whose id no line of the script has (${unused.slice(0, 5).map(id => `#${id}`).join(', ')}${unused.length > 5 ? ', ...' : ''})? `
      + 'Their translations are deleted from the file, with no undo; a line that is given one of those ids back would need translating again.', ['Remove']);
    if (pick !== 0 || this.tables[lang] !== table) return;
    // In place: the rows on screen write their edits into this same table object.
    const snap = this.snaps[lang] ??= {};
    for (const id of dropUnused(this.rows, table, snap).removed) { delete table[id]; delete snap[id]; }
    this.flush(lang);
    this.flushSnap(lang);
    if (lang === this.lang) this.refilter();
    this.summary.textContent = `Removed ${n} from locale/${lang}.json. ${this.summary.textContent ?? ''}`; // it said nothing (ED-11)
    this.filter.focus(); // the button hides once nothing is left to remove
  }

  private rowEl(r: StringRow, table: StringTable) {
    const row = document.createElement('div');
    row.className = 'tr-row';
    const ctx = document.createElement('div');
    ctx.className = 'tr-ctx';
    ctx.append(Object.assign(document.createElement('span'), { className: 'tr-kind', textContent: r.who ? `${KIND[r.kind]} · ${r.who}` : KIND[r.kind] }));
    if (r.file !== undefined && r.line !== undefined) {
      const where = Object.assign(document.createElement('button'), { type: 'button', className: 'tr-where', textContent: `${r.file}:${r.line}`, title: `Go to ${r.file} line ${r.line}${r.label ? ` (label ${r.label})` : ''}` });
      where.addEventListener('click', () => { this.close(); this.h.reveal(r.file!, r.line!); });
      ctx.append(where);
    }
    ctx.append(Object.assign(document.createElement('span'), { className: 'tr-id', textContent: `#${r.id}` }));
    const src = Object.assign(document.createElement('div'), { className: 'tr-src', textContent: r.source });
    const snap = this.snaps[this.lang] ??= {};
    if (this.outdated.has(r.id)) {
      row.dataset.outdated = 'true';
      src.append(Object.assign(document.createElement('div'), { className: 'tr-was', textContent: `Was: ${snap[r.id]}` }));
      const ok = Object.assign(document.createElement('button'), { type: 'button', className: 'tr-ok', textContent: 'Still correct', title: 'Keep this translation for the new source text' });
      ok.addEventListener('click', () => { this.record(r, table); this.outdated.delete(r.id); this.updateSummary(); row.removeAttribute('data-outdated'); src.querySelector('.tr-was')?.remove(); ok.remove(); });
      ctx.append(ok);
    }
    const edit = document.createElement('textarea');
    edit.className = 'tr-edit';
    edit.value = table[r.id] ?? '';
    edit.lang = this.lang;
    edit.setAttribute('aria-label', `Translation of #${r.id}`);
    edit.dataset.empty = String(!edit.value);
    edit.addEventListener('input', () => {
      table[r.id] = edit.value;
      edit.dataset.empty = String(!edit.value);
      this.record(r, table);
      this.queueSave(this.lang);
    });
    row.append(ctx, src, edit);
    return row;
  }

  /** Remember the source text `r` is translated against (or forget it when the translation is cleared). */
  private record(r: StringRow, table: StringTable) {
    const lang = this.lang;
    const snap = this.snaps[lang] ??= {};
    if (table[r.id]) snap[r.id] = r.source; else delete snap[r.id];
    window.clearTimeout(this.snapSaves.get(lang));
    this.snapSaves.set(lang, window.setTimeout(() => this.flushSnap(lang), SAVE_DELAY));
  }

  private flushSnap(lang: string) {
    window.clearTimeout(this.snapSaves.get(lang));
    this.snapSaves.delete(lang);
    const snap = this.snaps[lang];
    if (!snap) return;
    void fetch(`/api/locale?file=${encodeURIComponent(`${lang}.src`)}`, {
      method: 'PUT', headers: { 'X-VN-Editor': '1', 'Content-Type': 'text/plain' }, body: `${JSON.stringify(snap, null, 2)}
`,
    }).then(r => r.ok, () => false).then(ok => { if (!ok) this.summary.textContent = `Could not save locale/${lang}.src`; });
  }

  private queueSave(lang: string) {
    window.clearTimeout(this.saves.get(lang));
    this.saves.set(lang, window.setTimeout(() => this.flush(lang), SAVE_DELAY));
  }

  private flush(lang: string) {
    window.clearTimeout(this.saves.get(lang));
    this.saves.delete(lang);
    const table = this.tables[lang];
    if (!table) return;
    if (lang === this.lang) this.updateSummary();
    void fetch(`/api/locale?file=${encodeURIComponent(`${lang}.json`)}`, {
      method: 'PUT', headers: { 'X-VN-Editor': '1', 'Content-Type': 'text/plain' }, body: `${JSON.stringify(table, null, 2)}\n`,
    }).then(r => r.ok, () => false).then(ok => { if (!ok) this.summary.textContent = `Could not save locale/${lang}.json`; });
  }

  private exportCsv() {
    const langs = Object.keys(this.tables).sort();
    const blob = new Blob(['﻿', translatorCsv(this.rows, this.tables, langs, this.snaps)], { type: 'text/csv;charset=utf-8' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'translations.csv' });
    a.click();
    URL.revokeObjectURL(a.href);
  }

  private pickCsv() {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.csv,.tsv,.txt,text/csv' });
    input.addEventListener('change', () => { const f = input.files?.[0]; if (f) void f.text().then(t => this.importCsv(t, f.name)); });
    input.click();
  }

  /** Merge a translators' sheet into the tables, after showing what it would change and asking. */
  private async importCsv(text: string, name: string) {
    const out = importTranslatorCsv(text, this.rows, this.tables, this.snaps, this.h.source());
    if (out.error) { this.summary.textContent = `Could not import ${name}: ${out.error}`; return; }
    const langs = out.languages.filter(l => l.added.length || l.changed.length);
    const notes = [
      out.unknown.length ? `Skipped ${out.unknown.length === 1 ? 'an id' : `${out.unknown.length} ids`} no line of the script has (${out.unknown.slice(0, 5).map(id => `#${id}`).join(', ')}${out.unknown.length > 5 ? ', ...' : ''}).` : '',
      out.ignored.length ? `Columns not read: ${out.ignored.join(', ')}.` : '',
    ].filter(Boolean).join(' ');
    if (!langs.length) { this.summary.textContent = `${name} has nothing new to import.${notes ? ` ${notes}` : ''}`; return; }
    const lines = langs.map(l => `${l.lang}${l.isNew ? ' (new language)' : ''}: `
      + [l.added.length && `${l.added.length} new`, l.changed.length && `${l.changed.length} changed`].filter(Boolean).join(', ')
      + (l.outdated.length ? ` (${l.outdated.length} made against older source text, shown as changed source)` : ''));
    const pick = await choiceAsk(`Import ${name}? ${lines.join('; ')}. Changed translations are overwritten in ${langs.map(l => `locale/${l.lang}.json`).join(', ')}, with no undo.${notes ? ` ${notes}` : ''}`, ['Import']);
    if (pick !== 0) return;
    for (const l of langs) {
      // In place: the rows on screen write their edits into these same objects.
      const table = this.tables[l.lang] ??= {}, snap = this.snaps[l.lang] ??= {};
      for (const id of [...l.added, ...l.changed]) { table[id] = l.table[id]; snap[id] = l.snapshot[id]; }
      this.flush(l.lang);
      this.flushSnap(l.lang);
    }
    if (!this.tables[this.lang]) this.lang = langs[0].lang;
    this.fillLanguages();
    this.refilter();
    this.summary.textContent = `Imported ${name}: ${lines.join('; ')}. ${this.summary.textContent ?? ''}`; // it said nothing (ED-11)
    this.filter.focus();
  }
}
