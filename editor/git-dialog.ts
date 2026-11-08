// Git in the Files panel: a bar with the branch and the number of changed files, and Commit, a dialog that lists the changes,
// says what blocks or deserves a second look (engine/src/git.ts, run by the dev server) and commits everything under the
// project folder with one message. Nothing here pushes, pulls, switches branches or throws changes away.

import { changeKind, type GitChange } from '../engine/src/index.js';
import { esc } from '../engine/src/util.js';
import { trapModal } from './modal.js';

export interface GitHost {
  /** Write the unsaved tabs to disk first: a commit takes the files as they are on disk. */
  saveAll(): Promise<void>;
  /** After a commit or a .gitignore change: say it in the status bar. */
  done(message: string): void;
}

interface GitStatus {
  repo: boolean;
  git: boolean;
  branch?: string | null;
  changes?: GitChange[];
  blockers?: string[];
  warnings?: string[];
  suggest?: string;
  unignored?: string[];
}

const MAX_ROWS = 500;

export class GitPanel {
  private readonly bar: HTMLElement;
  private readonly root: HTMLDivElement;
  private readonly summary: HTMLElement;
  private readonly notes: HTMLElement;
  private readonly rows: HTMLElement;
  private readonly message: HTMLTextAreaElement;
  private readonly ignoreBtn: HTMLButtonElement;
  private readonly commitBtn: HTMLButtonElement;
  private readonly result: HTMLElement;
  private status: GitStatus | null = null;
  private busy = false;
  private committing = false; // from the click, through the save that comes first: `busy` only starts at the POST
  private refreshSeq = 0;
  private edited = false; // the author typed a message: a refresh keeps it
  private returnFocus: (() => void) | null = null;
  private refreshTimer = 0;

  constructor(bar: HTMLElement, host: HTMLElement, private readonly h: GitHost) {
    this.bar = bar;
    this.root = document.createElement('div');
    this.root.id = 'gitCommit';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="gd-card" role="dialog" aria-modal="true" aria-label="Commit">
        <header><strong>Commit</strong><span class="gd-branch"></span><span class="hint">Everything under the project folder. Ctrl+Enter commits, Esc closes.</span>
          <button type="button" class="close" aria-label="Close commit">Close</button></header>
        <div class="gd-notes"></div>
        <div class="gd-summary" role="status"></div>
        <div class="gd-rows"></div>
        <label class="gd-label">Message <textarea class="gd-message" rows="3" spellcheck="true" aria-label="Commit message"></textarea></label>
        <div class="gd-foot">
          <button type="button" class="gd-ignore" hidden>Add to .gitignore</button>
          <button type="button" class="primary gd-go" disabled>Commit all</button>
        </div>
        <div class="gd-result" role="status" hidden></div>
      </div>`;
    host.append(this.root);
    const q = <T extends HTMLElement>(s: string) => this.root.querySelector<T>(s)!;
    this.summary = q('.gd-summary'); this.notes = q('.gd-notes'); this.rows = q('.gd-rows'); this.message = q('.gd-message');
    this.ignoreBtn = q('.gd-ignore'); this.commitBtn = q('.gd-go'); this.result = q('.gd-result');
    this.root.addEventListener('mousedown', e => { if (e.target === this.root) this.close(); });
    q('.close').addEventListener('click', () => this.close());
    this.root.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void this.commit(); }
    });
    trapModal(this.root, () => this.close());
    this.message.addEventListener('input', () => { this.edited = true; this.update(); });
    this.ignoreBtn.addEventListener('click', () => void this.ignore());
    this.commitBtn.addEventListener('click', () => void this.commit());
  }

  get isOpen() { return !this.root.hidden; }

  /** Re-reads the status soon (files change in bursts: a save, a PSD conversion). */
  refreshSoon() {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => void this.refresh(), 600);
  }

  async refresh() {
    const seq = ++this.refreshSeq;
    let status: GitStatus | null;
    try {
      const r = await fetch('/api/git', { cache: 'no-store' });
      status = r.ok ? await r.json() as GitStatus : null;
    } catch { status = null; }
    if (seq !== this.refreshSeq) return; // a newer read is on its way
    this.status = status;
    this.renderBar();
    if (this.isOpen && !this.busy) this.render();
  }

  private renderBar() {
    const s = this.status;
    this.bar.hidden = !s?.git;
    if (!s?.git) return;
    if (!s.repo) {
      this.bar.innerHTML = '<span class="gb-none" title="Commits keep every version of the project. Run git init in the project folder (or use a git app) to start one.">Not in a git repository</span>';
      return;
    }
    const n = s.changes?.length ?? 0;
    this.bar.innerHTML = `<span class="gb-branch" title="The checked-out branch">⎇ ${esc(s.branch ?? 'detached')}</span>
      <span class="gb-count" title="Changed files under the project folder">${n ? `${n} change${n === 1 ? '' : 's'}` : 'no changes'}</span>
      <button type="button" class="gb-commit" title="Review the changes and commit them all"${n ? '' : ' disabled'}>Commit…</button>`;
    this.bar.querySelector('button')!.addEventListener('click', () => void this.open(() => {}));
  }

  async open(returnFocus: () => void) {
    this.returnFocus = returnFocus;
    this.root.hidden = false;
    this.result.hidden = true;
    this.edited = false;
    this.message.value = '';
    this.summary.textContent = 'Saving and reading the changes...';
    this.rows.replaceChildren();
    this.notes.replaceChildren();
    this.update();
    await this.h.saveAll();
    await this.refresh(); // renders the dialog too
    this.message.focus();
    this.message.select();
  }

  close() {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.returnFocus?.();
  }

  private render() {
    const s = this.status;
    this.root.querySelector('.gd-branch')!.textContent = s?.repo ? `on ${s.branch ?? 'a detached HEAD'}` : '';
    if (!s?.repo) {
      this.summary.textContent = s?.git ? 'The project is not in a git repository.' : 'Could not run git: is it installed?';
      this.update();
      return;
    }
    const changes = s.changes ?? [];
    this.notes.innerHTML = [...(s.blockers ?? []).filter(b => b !== 'Nothing to commit.').map(b => `<div class="gd-note" data-kind="blocker">${esc(b)}</div>`),
      ...(s.warnings ?? []).map(w => `<div class="gd-note" data-kind="warning">${esc(w)}</div>`)].join('');
    this.ignoreBtn.hidden = !s.unignored?.length;
    this.ignoreBtn.title = `Add ${s.unignored?.join(' and ')} to the project's .gitignore`;
    this.summary.textContent = changes.length ? `${changes.length} changed file${changes.length === 1 ? '' : 's'}:` : 'Nothing to commit: the project matches the last commit.';
    this.rows.innerHTML = changes.slice(0, MAX_ROWS).map(c => {
      const kind = changeKind(c);
      return `<div class="gd-row"><span class="gd-kind" data-kind="${kind}">${kind}</span><span class="gd-path">${esc(c.path)}${c.from ? ` <span class="gd-from">from ${esc(c.from)}</span>` : ''}</span></div>`;
    }).join('') + (changes.length > MAX_ROWS ? `<div class="gd-row gd-more">and ${changes.length - MAX_ROWS} more</div>` : '');
    if (!this.edited) this.message.value = s.suggest ?? '';
    this.update();
  }

  private update() {
    const s = this.status;
    const blocked = !s?.repo || !!s.blockers?.length;
    this.commitBtn.disabled = this.busy || blocked || !this.message.value.trim();
    this.commitBtn.title = blocked ? (s?.blockers?.join(' ') ?? '') : !this.message.value.trim() ? 'Write a message' : 'Stage and commit every change listed';
    this.ignoreBtn.disabled = this.busy;
  }

  private async post(url: string, body?: string) {
    this.busy = true;
    this.update();
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'X-VN-Editor': '1' }, body });
      return { ok: r.ok, text: await r.text() };
    } catch { return { ok: false, text: 'Could not reach the dev server.' }; }
    finally { this.busy = false; }
  }

  private async ignore() {
    const r = await this.post('/api/git/ignore');
    if (r.ok) this.h.done(`added ${(JSON.parse(r.text) as { added: string[] }).added.join(', ')} to .gitignore`);
    else this.show(false, r.text);
    await this.refresh();
  }

  private async commit() {
    if (this.commitBtn.disabled || this.committing) return;
    this.committing = true;
    try { await this.commitNow(); } finally { this.committing = false; }
  }

  private async commitNow() {
    await this.h.saveAll();
    const r = await this.post('/api/git/commit', this.message.value.trim());
    if (!r.ok) {
      this.show(false, r.text);
      await this.refresh();
      return;
    }
    const { hash, files } = JSON.parse(r.text) as { hash: string; files: number };
    this.h.done(`committed ${files} file${files === 1 ? '' : 's'} (${hash})`);
    await this.refresh();
    this.close();
  }

  private show(ok: boolean, text: string) {
    this.result.hidden = false;
    this.result.dataset.state = ok ? 'ok' : 'failed';
    this.result.textContent = text;
    this.update();
  }
}
