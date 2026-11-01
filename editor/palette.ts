// Ctrl+P palette. What you type picks the mode, like VS Code:
//   (nothing)  go to file          >  commands          @  go to label          :  go to line          ?  help
// Each mode is a provider in editor.ts; a mode turns the query into items, the palette shows and runs them.

export interface PaletteItem {
  label: string;
  hits?: number[];   // indices in `label` to highlight
  detail?: string;   // dimmed, after the label
  hint?: string;     // right-aligned (keys, status)
  className?: string;
  run(): void;
}

export interface PaletteMode {
  prefix: string;      // '' for the default mode
  title: string;       // shown in the ? list
  placeholder: string;
  items(query: string): PaletteItem[];
}

/** Letters of `query` in order within `text`; higher score for runs and word starts. Null if no match. */
export function fuzzy(query: string, text: string): { score: number; hits: number[] } | null {
  const q = query.toLowerCase(), t = text.toLowerCase();
  const hits: number[] = [];
  let score = 0, from = 0;
  for (const ch of q) {
    if (ch === ' ') continue;
    const i = t.indexOf(ch, from);
    if (i < 0) return null;
    const run = hits.length > 0 && hits[hits.length - 1] === i - 1;
    const wordStart = i === 0 || '/_-. :'.includes(t[i - 1]);
    score += 1 + (run ? 3 : 0) + (wordStart ? 2 : 0) - Math.min(i - from, 5) * 0.1;
    hits.push(i);
    from = i + 1;
  }
  return { score: score - text.length * 0.01, hits };
}

/** Filter and sort `entries` by fuzzy match of `query` against `key(entry)`; ties keep the given order. */
export function rank<T>(entries: T[], query: string, key: (e: T) => string): { entry: T; hits: number[] }[] {
  if (!query.trim()) return entries.map(entry => ({ entry, hits: [] }));
  return entries
    .map((entry, i) => { const m = fuzzy(query, key(entry)); return m ? { entry, i, ...m } : null; })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(({ entry, hits }) => ({ entry, hits }));
}

export class Palette {
  private root = document.createElement('div');
  private input = document.createElement('input');
  private list = document.createElement('ul');
  private items: PaletteItem[] = [];
  private sel = 0;

  constructor(parent: HTMLElement, private modes: PaletteMode[], private onCancel: () => void) {
    this.root.id = 'palette';
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Command palette');
    this.input.type = 'text';
    this.input.spellcheck = false;
    this.input.setAttribute('role', 'combobox');
    this.input.setAttribute('aria-controls', 'paletteList');
    this.input.setAttribute('aria-expanded', 'true');
    this.list.id = 'paletteList';
    this.list.setAttribute('role', 'listbox');
    this.root.append(this.input, this.list);
    parent.append(this.root);

    this.input.addEventListener('input', () => { this.sel = 0; this.render(); });
    this.input.addEventListener('keydown', e => this.key(e));
    this.input.addEventListener('blur', () => { if (!this.root.hidden) this.close(true); });
    // Choose on mousedown so the input's blur doesn't close the list first.
    this.list.addEventListener('mousedown', e => {
      const li = (e.target as HTMLElement).closest('li');
      if (!li?.dataset.i) return;
      e.preventDefault();
      this.sel = Number(li.dataset.i);
      this.choose();
    });
  }

  get isOpen() { return !this.root.hidden; }

  /** Open with `text` typed (e.g. '>' for commands); when already open, move to the next item. */
  open(text = '') {
    if (this.isOpen) { this.move(1); return; }
    this.input.value = text;
    this.sel = 0;
    this.root.hidden = false;
    this.render();
    this.input.focus();
  }

  /** Show the palette with `text` typed; when open, items use this to switch mode and stay open. */
  setText(text: string) {
    this.root.hidden = false;
    this.input.value = text;
    this.sel = 0;
    this.render();
    this.input.focus();
  }

  private close(cancelled: boolean) {
    this.root.hidden = true;
    if (cancelled) this.onCancel();
  }

  private key(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); this.move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); this.move(-1); }
    else if (e.key === 'PageDown' || e.key === 'PageUp') { e.preventDefault(); this.move(e.key === 'PageDown' ? 8 : -8); }
    else if (e.key === 'Enter') { e.preventDefault(); this.choose(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(true); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') { e.preventDefault(); this.move(1); }
  }

  private move(d: number) {
    if (!this.items.length) return;
    this.sel = Math.max(0, Math.min(this.items.length - 1, this.sel + d));
    if (Math.abs(d) === 1) this.sel = (this.sel + this.items.length) % this.items.length;
    this.render();
  }

  private choose() {
    const item = this.items[this.sel];
    if (!item) return;
    const before = this.input.value;
    item.run();
    // An item may keep the palette open by changing the text (mode switch); otherwise close it.
    if (this.input.value === before) this.close(false);
  }

  private mode(): { mode: PaletteMode; query: string } {
    const text = this.input.value;
    const mode = this.modes.find(m => m.prefix && text.startsWith(m.prefix)) ?? this.modes.find(m => m.prefix === '')!;
    return { mode, query: text.slice(mode.prefix.length).trimStart() };
  }

  private render() {
    const { mode, query } = this.mode();
    this.input.placeholder = mode.placeholder;
    this.items = mode.items(query);
    this.sel = Math.min(this.sel, Math.max(0, this.items.length - 1));
    this.list.replaceChildren(...this.items.map((item, i) => {
      const li = document.createElement('li');
      li.dataset.i = String(i);
      li.id = `palette-${i}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === this.sel));
      if (item.className) li.className = item.className;
      const main = document.createElement('span');
      main.className = 'main';
      const hits = new Set(item.hits ?? []);
      [...item.label].forEach((ch, j) => {
        if (hits.has(j)) { const b = document.createElement('b'); b.textContent = ch; main.append(b); }
        else main.append(ch);
      });
      if (item.detail) {
        const d = document.createElement('span');
        d.className = 'detail';
        d.textContent = item.detail;
        main.append(d);
      }
      li.append(main);
      if (item.hint) {
        const h = document.createElement('span');
        h.className = 'hint';
        h.textContent = item.hint;
        li.append(h);
      }
      return li;
    }));
    if (!this.items.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'No matches';
      this.list.append(li);
    }
    this.input.setAttribute('aria-activedescendant', this.items.length ? `palette-${this.sel}` : '');
    this.list.children[this.sel]?.scrollIntoView({ block: 'nearest' });
  }
}
