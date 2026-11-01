// Find and replace across every script and game.json: a panel under the editor. The matching and the edits come from
// the engine (refactor.ts); this only collects the options, lists the hits and hands the edits back to the editor.

import { findInFiles, replaceInFiles, type FindMatch, type FindOptions, type ProjectFile, type LabelEdit } from '../engine/src/index.js';

export interface FindHost {
  files(): ProjectFile[];
  /** Show a hit: activate its file and select the match. */
  reveal(m: FindMatch): void;
  apply(edits: LabelEdit[]): void;
}

const MAX_SHOWN = 500;

export class FindDialog {
  private readonly root = document.getElementById('findAll') as HTMLElement;
  private readonly find = document.getElementById('findText') as HTMLInputElement;
  private readonly replace = document.getElementById('replaceText') as HTMLInputElement;
  private readonly opts = ['findCase', 'findWord', 'findRegex'].map(id => document.getElementById(id) as HTMLInputElement);
  private readonly summary = document.getElementById('findSummary') as HTMLElement;
  private readonly list = document.getElementById('findResults') as HTMLElement;

  constructor(private readonly host: FindHost) {
    const run = () => this.search();
    this.find.addEventListener('input', run);
    for (const o of this.opts) o.addEventListener('change', run);
    this.root.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.stopPropagation(); this.close(); }
      else if (e.key === 'Enter' && e.target === this.find) { e.preventDefault(); this.search(); }
    });
    document.getElementById('findClose')!.addEventListener('click', () => this.close());
    document.getElementById('replaceAll')!.addEventListener('click', () => this.replaceAll());
  }

  get isOpen() { return !this.root.hidden; }

  /** Show the panel; `seed` (the editor's selection) becomes the search text. */
  open(seed = '') {
    this.root.hidden = false;
    if (seed && !seed.includes('\n')) this.find.value = seed;
    this.find.focus();
    this.find.select();
    this.search();
  }

  close() { this.root.hidden = true; }

  private options(): FindOptions {
    const [matchCase, wholeWord, regex] = this.opts.map(o => o.checked);
    return { find: this.find.value, matchCase, wholeWord, regex };
  }

  private search() {
    this.list.replaceChildren();
    if (!this.find.value) { this.summary.textContent = ''; return; }
    const res = findInFiles(this.host.files(), this.options());
    if ('error' in res) { this.summary.textContent = res.error; return; }
    const { matches } = res;
    const nFiles = new Set(matches.map(m => m.file)).size;
    this.summary.textContent = matches.length ? `${matches.length} match${matches.length === 1 ? '' : 'es'} in ${nFiles} file${nFiles === 1 ? '' : 's'}` : 'No results';
    let lastFile = '';
    for (const m of matches.slice(0, MAX_SHOWN)) {
      if (m.file !== lastFile) {
        lastFile = m.file;
        const h = document.createElement('div');
        h.className = 'find-file';
        h.textContent = m.file;
        this.list.append(h);
      }
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'find-hit';
      const num = document.createElement('span');
      num.textContent = String(m.line);
      const text = document.createElement('span');
      const start = Math.max(0, m.col - 30);
      const mark = document.createElement('mark');
      mark.textContent = m.text;
      text.append(m.preview.slice(start, m.col).trimStart(), mark, m.preview.slice(m.col + m.length, m.col + m.length + 60));
      row.append(num, text);
      row.addEventListener('click', () => this.host.reveal(m));
      this.list.append(row);
    }
    if (matches.length > MAX_SHOWN) {
      const more = document.createElement('div');
      more.className = 'find-more';
      more.textContent = `... and ${matches.length - MAX_SHOWN} more (all are replaced by Replace all)`;
      this.list.append(more);
    }
  }

  private replaceAll() {
    const res = replaceInFiles(this.host.files(), this.options(), this.replace.value);
    if ('error' in res || !res.edits.length) return;
    this.host.apply(res.edits);
    this.search();
    this.summary.textContent = `Replaced ${res.edits.length}. ${this.summary.textContent}`;
  }
}
