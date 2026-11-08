// Build: the pre-build checks (engine/src/build-checks.ts, run by the dev server on the saved project) as rows grouped by severity,
// then the export itself for a target and output folder. Errors block the build, warnings need an "I've seen these" tick.

import { CHECK_TITLES, type BuildFinding, type BuildLanguages, type CheckId, type CheckLevel } from '../engine/src/index.js';
import { esc } from '../engine/src/util.js';
import { trapModal } from './modal.js';

export interface BuildHost {
  /** Show a script line in the editor. */
  reveal(file: string, line: number): void;
  /** Open the Translations / Voice dialog (this one closes first). */
  openTranslations(): void;
  openVoice(): void;
  /** Write the unsaved tabs to disk: the checks and the export read the project folder. */
  saveAll(): Promise<void>;
  /** Run the export through the dev server's task stream; `output` is everything it printed. */
  build(target: BuildTarget, out: string, langs: BuildLanguages, playtest: boolean): Promise<{ ok: boolean; output: string }>;
  /** Inside Marginalia Studio: the desktop app can be built ready to run, on the Studio's own Electron runtime. */
  portable?: boolean;
}

export type BuildTarget = 'web' | 'desktop' | 'portable';
/** What the project has to include: the source language, translation tables, voice languages (the source name = default takes). */
interface Languages { source: string; text: string[]; voice: string[] }
interface CheckReport { findings: BuildFinding[]; errors: number; warnings: number; languages: Languages }

/** The query string for the dev server: a list only when some language is left out (an empty list ships none). */
export function langQuery(l: BuildLanguages): string {
  return (l.text ? `&locales=${encodeURIComponent(l.text.join(','))}` : '') + (l.voice ? `&voice=${encodeURIComponent(l.voice.join(','))}` : '');
}

/** `&playtest=off` when the author turned the playtest bot off in the dialog (the dev server then skips it). */
export function playtestQuery(on: boolean): string {
  return on ? '' : '&playtest=off';
}

const BOT_KEY = 'vn.build.playtest';

const LEVELS: CheckLevel[] = ['error', 'warning', 'info'];
const HEADINGS: Record<CheckLevel, string> = { error: 'Errors (the build refuses)', warning: 'Warnings', info: 'Notes' };
/** Same rule as the dev server (and export-web.mjs): a folder inside build/. */
const FOLDER = /^build(\/\w[\w.-]*)+$/;
const defaultFolder = (target: BuildTarget) => `build/${target}`;
const SUMMARY = /Exported ".*?" to .*?: (\d+) files, ([\d.]+) MB/;
/** The portable export's exe and zip, relative to the project folder. */
const APP = /^App: (.+)$/m;
const ZIP = /^Zip: (.+?) \(([\d.]+) MB\)/m;


export class BuildDialog {
  private readonly root: HTMLDivElement;
  private readonly targetSel: HTMLSelectElement;
  private readonly folder: HTMLInputElement;
  private readonly folderNote: HTMLElement;
  private readonly summary: HTMLElement;
  private readonly rows: HTMLElement;
  private readonly langBox: HTMLElement;
  private readonly ackLabel: HTMLLabelElement;
  private readonly ack: HTMLInputElement;
  private readonly buildBtn: HTMLButtonElement;
  private readonly rerun: HTMLButtonElement;
  private readonly bot: HTMLInputElement;
  private readonly result: HTMLElement;
  private report: CheckReport | null = null;
  private checkSeq = 0; // a language toggle or Re-run while a check is in flight makes the older answer stale
  private off = { text: new Set<string>(), voice: new Set<string>() }; // languages the author unticked: kept across re-runs
  private langs: Languages | null = null;
  private building = false;
  private folderEdited = false;
  private returnFocus: (() => void) | null = null;

  constructor(host: HTMLElement, private readonly h: BuildHost) {
    this.root = document.createElement('div');
    this.root.id = 'build';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="bd-card" role="dialog" aria-modal="true" aria-label="Build">
        <header><strong>Build</strong><span class="hint">Esc to close. The checks read the saved project.</span>
          <button type="button" class="close" aria-label="Close build">Close</button></header>
        <div class="bd-bar">
          <label>Target <select class="bd-target" aria-label="Build target">
            <option value="web">Web (static folder)</option>
            <option value="portable">Desktop app (ready to run, zipped)</option>
            <option value="desktop">Desktop npm folder (Electron, for installers)</option></select></label>
          <label>Folder <input class="bd-folder" type="text" spellcheck="false" aria-label="Output folder"></label>
          <label title="Plays every route to find dead lines, loops and unused variables. Turn it off if it is slow on a big game."><input type="checkbox" class="bd-bot" checked> Playtest bot</label>
          <button type="button" class="bd-rerun">Re-run checks</button>
        </div>
        <div class="bd-langs" hidden>
          <span class="bd-group-langs" data-kind="text" hidden><b>Text languages</b></span>
          <span class="bd-group-langs" data-kind="voice" hidden><b>Voice languages</b></span>
        </div>
        <div class="bd-note" role="status" hidden></div>
        <div class="bd-summary" role="status"></div>
        <div class="bd-rows"></div>
        <div class="bd-foot">
          <label class="bd-ack" hidden><input type="checkbox" class="bd-ack-box"> I've seen these warnings</label>
          <button type="button" class="primary bd-go" disabled>Build</button>
        </div>
        <div class="bd-result" role="status" hidden></div>
      </div>`;
    host.append(this.root);
    const q = <T extends HTMLElement>(s: string) => this.root.querySelector<T>(s)!;
    this.targetSel = q('.bd-target'); this.folder = q('.bd-folder'); this.folderNote = q('.bd-note'); this.summary = q('.bd-summary');
    this.rows = q('.bd-rows'); this.langBox = q('.bd-langs'); this.ackLabel = q('.bd-ack'); this.ack = q('.bd-ack-box'); this.buildBtn = q('.bd-go');
    this.rerun = q('.bd-rerun'); this.result = q('.bd-result'); this.bot = q('.bd-bot');
    try { this.bot.checked = localStorage.getItem(BOT_KEY) !== 'off'; } catch { /* storage blocked: the bot stays on */ }
    this.bot.addEventListener('change', () => {
      try { localStorage.setItem(BOT_KEY, this.bot.checked ? 'on' : 'off'); } catch { /* the choice lasts until the page reloads */ }
      void this.check();
    });
    // Outside the Studio there is no Electron runtime to copy: the npm folder downloads its own.
    if (!h.portable) this.targetSel.querySelector('option[value=portable]')!.remove();
    this.root.addEventListener('mousedown', e => { if (e.target === this.root) this.close(); });
    q('.close').addEventListener('click', () => this.close());
    this.root.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); } });
    trapModal(this.root, () => this.close());
    this.targetSel.addEventListener('change', () => { if (!this.folderEdited) this.folder.value = defaultFolder(this.target); this.update(); });
    this.folder.addEventListener('input', () => { this.folderEdited = true; this.update(); });
    this.ack.addEventListener('change', () => this.update());
    this.rerun.addEventListener('click', () => void this.check());
    this.buildBtn.addEventListener('click', () => void this.build());
    this.rows.addEventListener('click', e => {
      const go = (e.target as HTMLElement).closest<HTMLElement>('[data-go]');
      if (go) this.goTo(this.report!.findings[Number(go.dataset.go)]);
    });
  }

  get isOpen() { return !this.root.hidden; }

  private get target(): BuildTarget { const v = this.targetSel.value; return v === 'desktop' || v === 'portable' ? v : 'web'; }

  async open(returnFocus: () => void) {
    this.returnFocus = returnFocus;
    this.root.hidden = false;
    this.result.hidden = true;
    if (!this.folderEdited) this.folder.value = defaultFolder(this.target);
    await this.check();
    this.folder.focus();
  }

  close() {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.returnFocus?.();
  }

  /** Save the tabs, then ask the dev server for the checks. */
  private async check() {
    const seq = ++this.checkSeq;
    this.report = null;
    this.ack.checked = false;
    this.summary.textContent = 'Running checks...';
    this.rows.replaceChildren();
    this.update();
    try {
      await this.h.saveAll();
      if (seq !== this.checkSeq) return;
      const q = langQuery(this.selection()) + playtestQuery(this.bot.checked);
      const r = await fetch(`/api/build-check${q && '?' + q.slice(1)}`, { headers: { 'X-VN-Editor': '1' }, cache: 'no-store' });
      if (!r.ok) throw new Error(await r.text());
      const report = await r.json() as CheckReport;
      if (seq !== this.checkSeq) return;
      this.report = report;
      const langs = this.report.languages;
      if (JSON.stringify(langs) !== JSON.stringify(this.langs)) { this.langs = langs; this.renderLanguages(); } // not on every tick: keeps focus
    } catch (e) {
      if (seq !== this.checkSeq) return;
      this.summary.textContent = `Could not run the checks: ${e instanceof Error ? e.message : 'dev server unreachable'}`;
      this.update();
      return;
    }
    this.render();
    this.update();
  }

  /** The languages to ship: a list only for a kind where something is unticked (missing = all of them). */
  private selection(): BuildLanguages {
    const all = this.langs;
    const pick = (kind: 'text' | 'voice') => all && this.off[kind].size ? all[kind].filter(l => !this.off[kind].has(l)) : undefined;
    return { text: pick('text'), voice: pick('voice') };
  }

  /** One tick per translation and per voice language the project has; each kind is hidden when it has none. */
  private renderLanguages() {
    const langs = this.langs!;
    for (const kind of ['text', 'voice'] as const) {
      const group = this.langBox.querySelector<HTMLElement>(`[data-kind="${kind}"]`)!;
      group.querySelectorAll('label').forEach(l => l.remove());
      group.hidden = !langs[kind].length;
      for (const l of langs[kind]) {
        const label = document.createElement('label');
        const box = Object.assign(document.createElement('input'), { type: 'checkbox', checked: !this.off[kind].has(l) });
        box.addEventListener('change', () => { if (box.checked) this.off[kind].delete(l); else this.off[kind].add(l); void this.check(); });
        label.append(box, ` ${kind === 'voice' && l === langs.source ? `${l} (default take)` : l}`);
        group.append(label);
      }
    }
    this.langBox.hidden = !langs.text.length && !langs.voice.length;
  }

  private render() {
    const { findings, errors, warnings } = this.report!;
    this.summary.textContent = !findings.length ? 'All checks passed.'
      : `${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}${findings.length > errors + warnings ? `, ${findings.length - errors - warnings} note(s)` : ''}.`;
    this.rows.replaceChildren(...LEVELS.flatMap(level => {
      const list = findings.map((f, i) => ({ f, i })).filter(x => x.f.severity === level);
      if (!list.length) return [];
      const group = document.createElement('details');
      group.className = 'bd-group';
      group.dataset.severity = level;
      group.open = level !== 'info'; // notes are shown collapsed
      group.innerHTML = `<summary>${HEADINGS[level]} <span class="bd-count">${list.length}</span></summary>${list.map(({ f, i }) => this.rowHtml(f, i)).join('')}`;
      return [group];
    }));
  }

  private rowHtml(f: BuildFinding, i: number) {
    const where = this.target_(f);
    const lang = f.lang ? ` <span class="bd-lang">${esc(f.lang)}</span>` : '';
    return `<div class="bd-row" data-check="${f.check}"><span class="bd-badge" data-severity="${f.severity}">${f.severity}</span>
      <span class="bd-msg"><span class="bd-title">${esc(CHECK_TITLES[f.check as CheckId] ?? f.check)}${lang}</span> ${esc(f.message)}</span>
      ${where ? `<button type="button" class="bd-goto" data-go="${i}">${esc(where)}</button>` : ''}</div>`;
  }

  /** The link text of a finding's go-to button: the line, the dialog that handles it, or nothing when there is nowhere to go. */
  private target_(f: BuildFinding): string {
    if (f.file !== undefined && f.line !== undefined) return `${f.file}:${f.line}`;
    if (f.check === 'untranslated' || f.check === 'translation-outdated' || f.check === 'unused-locale') return 'Translations...';
    if (f.check === 'voice-outdated' || f.check === 'voice-missing' || f.check === 'unmatched-voice') return 'Voice...';
    return '';
  }

  private goTo(f: BuildFinding) {
    if (f.file !== undefined && f.line !== undefined) { this.close(); this.h.reveal(f.file, f.line); return; }
    const open = f.check === 'untranslated' || f.check === 'translation-outdated' || f.check === 'unused-locale' ? this.h.openTranslations : this.h.openVoice;
    this.close();
    open();
  }

  private folderOk() { return FOLDER.test(this.folder.value) && !this.folder.value.includes('..'); }

  /** Button states: errors block, warnings wait for the tick, a bad folder blocks. */
  private update() {
    const r = this.report;
    const ok = this.folderOk();
    this.folderNote.hidden = ok;
    this.folderNote.textContent = ok ? '' : 'The output folder must be inside build/ (for example build/web); it is emptied before the export.';
    this.ackLabel.hidden = !r?.warnings || !!r.errors;
    this.buildBtn.disabled = this.building || !r || r.errors > 0 || !ok || (r.warnings > 0 && !this.ack.checked);
    this.buildBtn.title = !r ? 'Waiting for the checks' : r.errors ? 'Fix the errors first' : r.warnings && !this.ack.checked ? 'Tick "I\'ve seen these warnings"' : '';
    this.rerun.disabled = this.building;
    this.bot.disabled = this.building;
  }

  private async build() {
    this.building = true;
    this.update();
    this.result.hidden = false;
    this.result.dataset.state = 'running';
    this.result.textContent = 'Building...';
    const out = this.folder.value;
    const target = this.target;
    let res: { ok: boolean; output: string };
    try { res = await this.h.build(target, out, this.selection(), this.bot.checked); } catch { res = { ok: false, output: 'Could not reach the dev server.' }; }
    this.building = false;
    this.update();
    const m = SUMMARY.exec(res.output);
    this.result.dataset.state = res.ok ? 'ok' : 'failed';
    if (!res.ok) { this.result.textContent = `Build failed. ${res.output.trim().split('\n').slice(-3).join(' ')}`; return; }
    const open = target === 'web' ? ` <a class="bd-open" href="/${esc(out)}/" target="_blank" rel="noopener">Open the game</a>` : '';
    const app = APP.exec(res.output), zip = ZIP.exec(res.output);
    const next = target === 'web' ? 'Upload the folder or zip its contents (index.html at the root).'
      : target === 'desktop' ? 'Run <code>npm install &amp;&amp; npm start</code> inside it to try the app.'
      : `${zip ? `Share <code class="bd-path">${esc(zip[1])}</code> (${zip[2]} MB): players unzip it and run the exe.` : ''}${app ? ` Try it: <code class="bd-path">${esc(app[1])}</code>.` : ''}`;
    this.result.innerHTML = `Built into <code class="bd-path">${esc(out)}</code> in the project folder${m ? `: ${m[1]} files, ${m[2]} MB` : ''}.${open}
      ${next}`;
  }
}
