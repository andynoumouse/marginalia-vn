// F1 help: a modal over the editor showing docs/commands.md, opened at the section of the statement under the cursor.
// help.html shows the same thing in a window of its own (`standalone`). Ctrl+F or the search box highlights matches.

import { parseHelp, type HelpDoc } from '../engine/src/index.js';

export type HelpSource = 'commands' | 'game-json' | 'rig-json';
export const HELP_DOCS: Record<HelpSource, { url: string; title: string }> = {
  commands: { url: '../docs/commands.md', title: 'Command reference' },
  'game-json': { url: '../docs/game-json.md', title: 'game.json reference' },
  'rig-json': { url: '../docs/rig-json.md', title: 'rig.json reference' },
};

export class HelpDialog {
  private root: HTMLDivElement;
  private nav: HTMLElement;
  private body: HTMLElement;
  private doc: HelpDoc | null = null;
  private loading: Promise<void> | null = null;
  private source: HelpSource | null = null;
  private heading: HTMLElement;
  private returnFocus: (() => void) | null = null;
  private query: HTMLInputElement;
  private count: HTMLElement;
  private hits: HTMLElement[] = [];
  private hit = -1;

  constructor(host: HTMLElement, private readonly standalone = false) {
    this.root = document.createElement('div');
    this.root.id = 'help';
    this.root.hidden = true;
    this.root.classList.toggle('standalone', standalone);
    this.root.innerHTML = `
      <div class="help-card" role="${standalone ? 'main' : 'dialog'}" aria-modal="${!standalone}" aria-label="Reference">
        <header><strong>Command reference</strong>
          <span class="search"><input type="search" placeholder="Search (Ctrl+F)" aria-label="Search the reference" spellcheck="false">
            <span class="count" aria-live="polite"></span>
            <button type="button" class="prev" title="Previous match (Shift+Enter)" aria-label="Previous match">↑</button>
            <button type="button" class="next" title="Next match (Enter)" aria-label="Next match">↓</button></span>
          <span class="hint modal-only">F1 or Esc to close</span>
          <button type="button" class="popout modal-only" title="Open the reference in a window of its own">Open in window</button>
          <button type="button" class="close modal-only" aria-label="Close help">Close</button></header>
        <div class="help-main"><nav aria-label="Topics"></nav><article tabindex="-1"></article></div>
      </div>`;
    host.append(this.root);
    this.heading = this.root.querySelector('header strong')!;
    this.nav = this.root.querySelector('nav')!;
    this.body = this.root.querySelector('article')!;
    this.query = this.root.querySelector('.search input')!;
    this.count = this.root.querySelector('.search .count')!;
    this.query.addEventListener('input', () => this.search());
    this.query.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); this.step(e.shiftKey ? -1 : 1); }
      else if (e.key === 'Escape' && this.query.value) { e.preventDefault(); e.stopPropagation(); this.query.value = ''; this.search(); }
    });
    this.root.querySelector('.prev')!.addEventListener('click', () => this.step(-1));
    this.root.querySelector('.next')!.addEventListener('click', () => this.step(1));
    this.root.querySelector('.popout')!.addEventListener('click', () => this.popOut());
    this.root.addEventListener('mousedown', e => { if (e.target === this.root) this.close(); });
    this.root.querySelector('.close')!.addEventListener('click', () => this.close());
    // The standalone page listens on the window: focus can be on nothing there.
    (standalone ? window : this.root).addEventListener('keydown', e => {
      const k = e as KeyboardEvent;
      if ((k.ctrlKey || k.metaKey) && !k.altKey && !k.shiftKey && k.key.toLowerCase() === 'f') {
        k.preventDefault(); k.stopPropagation();
        this.query.focus();
        this.query.select();
      } else if (k.key === 'Escape' && !standalone) { k.preventDefault(); k.stopPropagation(); this.close(); }
    });
    // Links inside the document ([Story](#story)) and the topic list scroll instead of navigating.
    this.root.addEventListener('click', e => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-help]');
      if (!a) return;
      e.preventDefault();
      this.show(a.dataset.help!);
    });
  }

  get isOpen() { return !this.root.hidden; }

  /** Open at the topic `key` (a command word or heading id), or at the top when unknown. */
  async open(key: string | null, returnFocus?: () => void, source: HelpSource = 'commands') {
    this.returnFocus = returnFocus ?? null;
    if (this.source !== source) { this.source = source; this.loading = null; this.doc = null; }
    this.loading ??= this.load(source);
    await this.loading;
    this.root.hidden = false;
    if (this.query.value) { this.query.value = ''; this.search(); } // a fresh F1 is about the cursor, not the last search
    this.show(key ? this.doc?.find(key) : undefined);
    this.body.focus({ preventScroll: true });
  }

  close() {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.returnFocus?.();
  }

  toggle(key: string | null, returnFocus?: () => void, source: HelpSource = 'commands') {
    if (this.isOpen) this.close(); else void this.open(key, returnFocus, source);
  }

  private async load(source: HelpSource) {
    const { url, title } = HELP_DOCS[source];
    this.heading.textContent = title;
    if (this.standalone) document.title = `${title} · Marginalia VN`;
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error(`${r.status}`);
      this.doc = parseHelp(await r.text());
      this.body.innerHTML = this.doc.html;
      this.nav.replaceChildren(...this.doc.outline.map(h => {
        const a = document.createElement('a');
        a.href = `#${h.id}`;
        a.dataset.help = h.id;
        a.dataset.level = String(h.level);
        a.textContent = h.title;
        return a;
      }));
      this.hits = [];
      if (this.query.value) this.search();
    } catch (e) {
      this.loading = null; // try again next time
      this.body.textContent = `Could not load ${url} (${e instanceof Error ? e.message : e}).`;
    }
  }

  /** Scroll to the heading `id` (the top when unknown); the standalone page keeps it in the address. */
  show(id: string | undefined) {
    const target = id ? this.body.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`) : null;
    if (target) this.body.scrollTo({ top: target.offsetTop - 8 });
    else this.body.scrollTo({ top: 0 });
    this.mark(target ? id : undefined);
    if (this.standalone) history.replaceState(null, '', target ? `#${id}` : location.pathname + location.search);
  }

  private mark(id: string | undefined) {
    for (const a of this.nav.querySelectorAll('a')) a.toggleAttribute('aria-current', a.dataset.help === id);
    this.nav.querySelector('[aria-current]')?.scrollIntoView({ block: 'nearest' });
  }

  /** The heading at the top of the scrolled document, or the one a search hit is under. */
  private sectionOf(el: HTMLElement | null): string | undefined {
    let block = el;
    while (block && block.parentElement !== this.body) block = block.parentElement;
    for (let b = block; b; b = b.previousElementSibling as HTMLElement | null) if (/^H[23]$/.test(b.tagName)) return b.id;
    return undefined;
  }

  /** Highlight every match of the search box in the document and show only the topics that have one. */
  private search() {
    for (const m of this.body.querySelectorAll('mark')) {
      const parent = m.parentNode!;
      m.replaceWith(...m.childNodes);
      parent.normalize();
    }
    this.hits = [];
    this.hit = -1;
    const q = this.query.value.trim().toLowerCase();
    const found = new Set<string>();
    if (q) {
      const walker = document.createTreeWalker(this.body, NodeFilter.SHOW_TEXT);
      const texts: Text[] = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n as Text);
      for (let t of texts) {
        for (let at = t.data.toLowerCase().indexOf(q); at >= 0; at = t.data.toLowerCase().indexOf(q)) {
          const rest = t.splitText(at);
          t = rest.splitText(q.length);
          const m = document.createElement('mark');
          rest.replaceWith(m);
          m.append(rest);
          this.hits.push(m);
        }
      }
      for (const m of this.hits) { const id = this.sectionOf(m); if (id) found.add(id); }
      // A chapter stays listed while one of its topics matches.
      let chapter: HTMLElement | null = null, keep = false;
      for (const a of this.nav.querySelectorAll<HTMLElement>('a')) {
        if (a.dataset.level === '2') { chapter = a; keep = found.has(a.dataset.help!); }
        else if (found.has(a.dataset.help!)) keep = true;
        a.classList.toggle('nohit', !found.has(a.dataset.help!));
        if (keep) chapter?.classList.remove('nohit');
      }
    } else {
      for (const a of this.nav.querySelectorAll('a')) a.classList.remove('nohit');
    }
    this.count.textContent = !q ? '' : this.hits.length ? `${this.hits.length} found` : 'No matches';
    if (this.hits.length) this.step(1);
  }

  /** Go to the next (1) or previous (-1) match. */
  private step(dir: 1 | -1) {
    if (!this.hits.length) return;
    this.hits[this.hit]?.classList.remove('current');
    this.hit = (this.hit + dir + this.hits.length) % this.hits.length;
    const m = this.hits[this.hit];
    m.classList.add('current');
    const box = this.body.getBoundingClientRect(), r = m.getBoundingClientRect();
    if (r.top < box.top + 8 || r.bottom > box.bottom - 8) {
      this.body.scrollTo({ top: this.body.scrollTop + r.top - box.top - this.body.clientHeight / 3 });
    }
    this.count.textContent = `${this.hit + 1} of ${this.hits.length}`;
    this.mark(this.sectionOf(m));
  }

  /** Open help.html at the topic in view, in a new window (a Studio window in Marginalia Studio), and close the modal. */
  private popOut() {
    const top = this.body.scrollTop + 16;
    let id: string | undefined;
    for (const h of this.body.querySelectorAll<HTMLElement>('h2, h3')) { if (h.offsetTop > top) break; id = h.id; }
    window.open(`help.html?doc=${this.source ?? 'commands'}${id ? `#${id}` : ''}`, '_blank', 'noopener');
    this.close();
  }
}
