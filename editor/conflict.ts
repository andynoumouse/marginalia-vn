// A file that changed outside the editor while its tab had unsaved edits (UX round EL-18): the bar over the editor says so and offers
// Compare (Monaco's side-by-side diff in place of the editor), Keep mine (save over the outside version on purpose) and Take theirs (put
// the version on disk in the tab, as one edit Ctrl+Z takes back). Until one is chosen the file is not autosaved. The server's half is the
// save base in engine/src/save-base.ts.

import type { FileState } from './state.js';

declare const monaco: any;

export interface ConflictHost {
  keepMine(f: FileState): void;
  takeTheirs(f: FileState): void;
}

export class ConflictBar {
  readonly el: HTMLElement;
  private text: HTMLElement;
  private compareBtn: HTMLButtonElement;
  private diffBox: HTMLElement;
  private diff: any = null;
  private theirs: any = null; // the disk text as a model, for the diff
  private shown: FileState | null = null;

  /** `left` holds the tabs and `work` (the editor's area): the bar goes between them, the diff over `work`. */
  constructor(left: HTMLElement, private work: HTMLElement, private host: ConflictHost) {
    this.el = document.createElement('div');
    this.el.id = 'conflictBar';
    this.el.setAttribute('role', 'alert');
    this.el.hidden = true;
    this.text = document.createElement('span');
    const btn = (label: string, title: string, run: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.title = title;
      b.addEventListener('click', run);
      return b;
    };
    this.compareBtn = btn('Compare', 'Show your text and the version on disk side by side', () => this.toggleCompare());
    this.el.append(this.text,
      this.compareBtn,
      btn('Keep mine', 'Save your text over the version on disk', () => { const f = this.shown; this.closeCompare(); if (f) this.host.keepMine(f); }),
      btn('Take theirs', 'Put the version on disk in this tab (Ctrl+Z brings your text back)', () => { const f = this.shown; this.closeCompare(); if (f) this.host.takeTheirs(f); }));
    left.insertBefore(this.el, work);
    this.diffBox = document.createElement('div');
    this.diffBox.className = 'conflict-diff';
    this.diffBox.hidden = true;
    work.append(this.diffBox);
  }

  /** Show the bar for the tab on show when its file is in conflict, else hide it (and the diff). */
  show(f: FileState | null) {
    const on = !!f && f.conflict !== undefined;
    if (!on) { this.closeCompare(); this.el.hidden = true; this.shown = null; return; }
    if (this.shown !== f) this.closeCompare();
    this.shown = f;
    this.text.textContent = `${f!.name} changed outside the editor while you had unsaved edits here. It is not saved until you choose:`;
    this.el.hidden = false;
  }

  private toggleCompare() { if (this.diff) this.closeCompare(); else this.openCompare(); }

  private openCompare() {
    const f = this.shown;
    if (!f || f.conflict === undefined) return;
    this.theirs = monaco.editor.createModel(f.conflict, f.model.getLanguageId?.() ?? 'vn');
    this.diffBox.hidden = false;
    this.diff = monaco.editor.createDiffEditor(this.diffBox, { automaticLayout: true, originalEditable: false, renderSideBySide: true });
    this.diff.setModel({ original: this.theirs, modified: f.model }); // left: on disk, right: yours (still editable)
    this.compareBtn.textContent = 'Close compare';
  }

  private closeCompare() {
    if (!this.diff) return;
    this.diff.setModel(null);
    this.diff.dispose();
    this.diff = null;
    this.theirs?.dispose();
    this.theirs = null;
    this.diffBox.hidden = true;
    this.compareBtn.textContent = 'Compare';
  }
}
