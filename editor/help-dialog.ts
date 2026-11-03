// F1 help: a modal over the editor showing docs/commands.md, opened at the section of the statement under the cursor.

import { parseHelp, type HelpDoc } from '../engine/src/index.js';

export type HelpSource = 'commands' | 'game-json' | 'rig-json';
const DOCS: Record<HelpSource, { url: string; title: string }> = {
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

  constructor(host: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'help';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="help-card" role="dialog" aria-modal="true" aria-label="Reference">
        <header><strong>Command reference</strong><span class="hint">F1 or Esc to close</span>
          <button type="button" class="close" aria-label="Close help">Close</button></header>
        <div class="help-main"><nav aria-label="Topics"></nav><article tabindex="-1"></article></div>
      </div>`;
    host.append(this.root);
    this.heading = this.root.querySelector('header strong')!;
    this.nav = this.root.querySelector('nav')!;
    this.body = this.root.querySelector('article')!;
    this.root.addEventListener('mousedown', e => { if (e.target === this.root) this.close(); });
    this.root.querySelector('.close')!.addEventListener('click', () => this.close());
    this.root.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); }
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
    const { url, title } = DOCS[source];
    this.heading.textContent = title;
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
    } catch (e) {
      this.loading = null; // try again next time
      this.body.textContent = `Could not load ${url} (${e instanceof Error ? e.message : e}).`;
    }
  }

  private show(id: string | undefined) {
    const target = id ? this.body.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`) : null;
    if (target) this.body.scrollTo({ top: target.offsetTop - 8 });
    else this.body.scrollTo({ top: 0 });
    for (const a of this.nav.querySelectorAll('a')) a.toggleAttribute('aria-current', a.dataset.help === id);
    this.nav.querySelector('[aria-current]')?.scrollIntoView({ block: 'nearest' });
  }
}
