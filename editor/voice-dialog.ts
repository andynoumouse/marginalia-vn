// Voice: every spoken line with the state of its recording in one language at a time (missing, recorded, outdated), like the
// Translations dialog. A file dropped on a row becomes that line's take; files dropped on the list are matched by their names.
// The row logic and the comparison with the lock (voice.lock.json in the project folder) are the engine's (voice.ts).

import {
  acceptVoice, changedSpan, checkVoice, matchVoiceDrops, recordingScriptCsv, voiceRows, voiceText,
  type StringRow, type StringTable, type VoiceLock, type VoiceRow,
} from '../engine/src/index.js';
import { VirtualList } from './virtual-list.js';

export interface VoiceHost {
  /** The strings of the current scripts, in script order. */
  rows(): StringRow[];
  /** Show a string's line in the editor. */
  reveal(file: string, line: number): void;
  /** The language the scripts are written in (game.json "language", default en): the label of the default take. */
  source(): string;
  /** The languages game.json "voiceLanguages" lists for recording (apart from the source language). */
  declared(): string[];
}

const LANG = /^[A-Za-z]{2,3}([_-][A-Za-z0-9]+)?$/;
const ROW_HEIGHT = 96;
const FILTER_DELAY = 150;
const AUDIO = /\.(ogg|mp3|wav|m4a|flac|opus)$/i;
const LABEL: Record<VoiceRow['status'], string> = { missing: 'no recording', recorded: 'recorded', outdated: 'outdated' };

export class VoiceDialog {
  private readonly root: HTMLDivElement;
  private readonly langSel: HTMLSelectElement;
  private readonly newLang: HTMLInputElement;
  private readonly filter: HTMLInputElement;
  private readonly missing: HTMLInputElement;
  private readonly outdatedOnly: HTMLInputElement;
  private readonly summary: HTMLElement;
  private readonly note: HTMLElement;
  private readonly ask: HTMLElement;
  private readonly unmatched: HTMLElement;
  private readonly allBtn: HTMLButtonElement;
  private readonly scroller: HTMLElement;
  private readonly list: VirtualList<VoiceRow>;
  private rows: StringRow[] = [];
  private strings: Record<string, string> = {};
  private locale: Record<string, StringTable> = {};
  private recordings: Record<string, string> = {};
  private files: Record<string, string> = {};
  private lock: VoiceLock = {};
  private shown: VoiceRow[] = [];
  private added = new Set<string>(); // languages started here that have no recording or game.json entry yet
  private lang: string | null = null; // null = the default take
  private leftover: File[] = []; // dropped on the list but named after no line of this language
  private dragged: File | null = null;
  private audio: HTMLAudioElement | null = null;
  private filterTimer = 0;
  private returnFocus: (() => void) | null = null;

  constructor(host: HTMLElement, private readonly h: VoiceHost) {
    this.root = document.createElement('div');
    this.root.id = 'voice';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="vo-card" role="dialog" aria-modal="true" aria-label="Voice">
        <header><strong>Voice</strong><span class="hint">Esc to close. Drop audio files on a row, or name them after the lines and drop them on the list.</span>
          <button type="button" class="close" aria-label="Close voice">Close</button></header>
        <div class="vo-bar">
          <label>Language <select class="vo-lang" aria-label="Voice language"></select></label>
          <input class="vo-newlang" type="text" size="6" placeholder="new, e.g. ja" aria-label="New voice language code" title="Start recording in another language; add it to game.json &quot;voiceLanguages&quot; to keep it listed before the first recording">
          <button type="button" class="vo-addlang">Add</button>
          <input class="vo-filter" type="search" placeholder="Filter by text, id, speaker, label or file" aria-label="Filter lines">
          <label><input class="vo-missing" type="checkbox"> Missing only</label>
          <label><input class="vo-outdated" type="checkbox"> Outdated only</label>
          <button type="button" class="vo-all" title="Keep every outdated recording listed here as matching its line's current wording" hidden>Still fine: all</button>
          <button type="button" class="vo-csv" title="Download the lines shown as a recording script for the voice actor">Recording script (CSV)</button>
        </div>
        <div class="vo-summary" role="status"></div>
        <div class="vo-note" role="status" hidden></div>
        <div class="vo-ask" role="alertdialog" hidden><span class="vo-ask-msg"></span>
          <button type="button" class="vo-ask-yes">Replace</button><button type="button" class="vo-ask-no">Keep the old take</button></div>
        <div class="vo-unmatched" hidden><span>Not matched to a line (drag one onto its row):</span><span class="vo-chips"></span></div>
        <div class="vo-scroll"><div class="vo-spacer"></div></div>
      </div>`;
    host.append(this.root);
    const q = <T extends HTMLElement>(s: string) => this.root.querySelector<T>(s)!;
    this.langSel = q('.vo-lang'); this.filter = q('.vo-filter'); this.missing = q('.vo-missing'); this.outdatedOnly = q('.vo-outdated');
    this.summary = q('.vo-summary'); this.note = q('.vo-note'); this.ask = q('.vo-ask'); this.unmatched = q('.vo-unmatched');
    this.allBtn = q('.vo-all'); this.scroller = q('.vo-scroll');
    this.list = new VirtualList(this.scroller, q('.vo-spacer'), ROW_HEIGHT, v => this.rowEl(v));
    this.root.addEventListener('mousedown', e => { if (e.target === this.root) this.close(); });
    q('.close').addEventListener('click', () => this.close());
    this.root.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); } });
    this.newLang = q('.vo-newlang');
    q('.vo-addlang').addEventListener('click', () => this.addLanguage());
    this.newLang.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); this.addLanguage(); } });
    this.langSel.addEventListener('change', () => { this.lang = this.langSel.value || null; this.leftover = []; this.refilter(); });
    this.filter.addEventListener('input', () => { window.clearTimeout(this.filterTimer); this.filterTimer = window.setTimeout(() => this.refilter(), FILTER_DELAY); });
    this.missing.addEventListener('change', () => this.refilter());
    this.outdatedOnly.addEventListener('change', () => this.refilter());
    this.allBtn.addEventListener('click', () => void this.accept(this.shown.filter(v => v.status === 'outdated').map(v => v.name)));
    q('.vo-csv').addEventListener('click', () => this.exportCsv());
    this.scroller.addEventListener('dragover', e => { if (hasFiles(e)) { e.preventDefault(); this.scroller.dataset.drop = 'true'; } });
    this.scroller.addEventListener('dragleave', e => { if (!this.scroller.contains(e.relatedTarget as Node | null)) delete this.scroller.dataset.drop; });
    this.scroller.addEventListener('drop', e => {
      delete this.scroller.dataset.drop;
      if (!hasFiles(e)) return;
      e.preventDefault();
      void this.dropOnList([...e.dataTransfer!.files]);
    });
    q('.vo-ask-no').addEventListener('click', () => { this.ask.hidden = true; });
  }

  get isOpen() { return !this.root.hidden; }

  async open(returnFocus: () => void) {
    this.returnFocus = returnFocus;
    this.root.hidden = false;
    this.summary.textContent = 'Loading...';
    this.list.set([]);
    this.note.hidden = true;
    this.ask.hidden = true;
    this.leftover = [];
    this.unmatched.hidden = true;
    this.rows = this.h.rows();
    this.strings = Object.fromEntries(this.rows.map(r => [r.id, r.source]));
    this.locale = {};
    try {
      const all = await (await fetch('/api/locales')).json() as Record<string, string>;
      for (const [file, text] of Object.entries(all)) {
        if (!file.endsWith('.json')) continue;
        try { this.locale[file.replace(/^locale\/|\.json$/g, '')] = JSON.parse(text) as StringTable; } catch { /* a broken table is left alone */ }
      }
    } catch { /* no locale folder yet */ }
    delete this.locale[this.h.source()]; // <source>.json only exports the script, which is the source language
    if (!await this.load()) return;
    this.fillLanguages();
    this.lang = this.langSel.value ? this.langSel.value : null;
    this.refilter();
    this.filter.focus();
  }

  close() {
    if (this.root.hidden) return;
    this.audio?.pause();
    this.root.hidden = true;
    this.returnFocus?.();
  }

  /** Read the recordings and the lock from the server. */
  private async load() {
    try {
      const v = await (await fetch('/api/voice')).json() as { recordings: Record<string, string>; files?: Record<string, string>; lock: VoiceLock };
      this.recordings = v.recordings;
      this.files = v.files ?? {};
      this.lock = v.lock;
      return true;
    } catch { this.summary.textContent = 'Could not read the voice recordings.'; return false; }
  }

  /**
   * The default take (labelled with the source language), then every language game.json lists in "voiceLanguages", has a
   * recording, or was added here this session. Translation tables alone don't add one: text and voice languages are separate.
   */
  private fillLanguages() {
    const source = this.h.source();
    const langs = new Set([...this.h.declared(), ...this.added]);
    for (const name of Object.keys(this.recordings)) { const dot = name.indexOf('.'); if (dot >= 0) langs.add(name.slice(dot + 1)); }
    langs.delete(source);
    const opts = [['', `${source} (default take)`], ...[...langs].sort().map(l => [l, l])];
    this.langSel.replaceChildren(...opts.map(([value, text]) => Object.assign(document.createElement('option'), { value, textContent: text })));
    this.langSel.value = this.lang !== null && langs.has(this.lang) ? this.lang : '';
  }

  private addLanguage() {
    const code = this.newLang.value.trim();
    const source = this.h.source();
    if (!LANG.test(code) || code.toLowerCase() === source.toLowerCase()) { this.say(`A language code is 2-3 letters, optionally with a region (ja, pt-BR); ${source} is the default take.`); return; }
    this.say('');
    this.newLang.value = '';
    this.added.add(code);
    this.lang = code;
    this.leftover = [];
    this.fillLanguages();
    this.refilter();
  }

  private textOf =(name: string) => voiceText(name, this.strings, this.locale);

  private table() {
    return voiceRows(this.rows, this.lang, this.recordings, this.lock, this.locale,
      { missing: this.missing.checked, outdated: this.outdatedOnly.checked, query: this.filter.value });
  }

  /** The language, filters or recordings changed: recompute the rows and redraw the window. */
  private refilter(keepScroll = false) {
    const t = this.table();
    this.shown = t.rows;
    const where = this.lang ?? `${this.h.source()} (default take)`;
    this.summary.textContent = !t.total ? 'No lines with an id yet: run "npm run ids" (or add ids from the Translations dialog).'
      : `${t.voiced} of ${t.total} lines voiced in ${where}`
        + (t.outdated ? ` · ${t.outdated} outdated (recorded for other wording)` : '')
        + (t.rows.length !== t.total ? ` · ${t.rows.length} shown` : '');
    this.allBtn.hidden = t.rows.filter(v => v.status === 'outdated').length < 2;
    this.list.set(this.shown, keepScroll);
  }

  private say(msg: string) {
    this.note.textContent = msg;
    this.note.hidden = !msg;
  }

  private rowEl(v: VoiceRow) {
    const r = v.row;
    const row = document.createElement('div');
    row.className = 'vo-row';
    row.dataset.name = v.name;
    row.dataset.status = v.status;
    const ctx = document.createElement('div');
    ctx.className = 'vo-ctx';
    ctx.append(Object.assign(document.createElement('span'), { className: 'vo-name', textContent: `#${v.name}${r.who ? ` · ${r.who}` : ''}` }));
    if (r.file !== undefined && r.line !== undefined) {
      const where = Object.assign(document.createElement('button'), { type: 'button', className: 'vo-where', textContent: `${r.file}:${r.line}`, title: `Go to ${r.file} line ${r.line}` });
      where.addEventListener('click', () => { this.close(); this.h.reveal(r.file!, r.line!); });
      ctx.append(where);
    }
    ctx.append(Object.assign(document.createElement('span'), { className: 'vo-status', textContent: LABEL[v.status] }));

    const text = document.createElement('div');
    text.className = 'vo-text';
    if (v.recorded !== undefined) {
      const [start, was, now, end] = changedSpan(v.recorded, v.text);
      const side = (label: string, mid: string) => {
        const el = document.createElement('div');
        const mark = document.createElement('mark');
        mark.textContent = mid;
        el.append(Object.assign(document.createElement('span'), { className: 'vo-tag', textContent: label }), start, ...(mid ? [mark] : []), end);
        return el;
      };
      text.append(side('recorded', was), side('now', now));
    } else text.textContent = v.text;

    const act = document.createElement('div');
    act.className = 'vo-act';
    const play = Object.assign(document.createElement('button'), { type: 'button', className: 'vo-play', textContent: 'Play', title: 'Listen to this take', disabled: v.status === 'missing' });
    play.addEventListener('click', () => this.play(v.name));
    const pick = Object.assign(document.createElement('input'), { type: 'file', accept: 'audio/*', hidden: true });
    pick.addEventListener('change', () => { const f = pick.files?.[0]; if (f) void this.take(v, f); pick.value = ''; });
    const choose = Object.assign(document.createElement('button'), { type: 'button', className: 'vo-choose', textContent: v.status === 'missing' ? 'Add file…' : 'Replace…', title: 'Pick an audio file, or drop one on this row' });
    choose.addEventListener('click', () => pick.click());
    act.append(play, choose, pick);
    if (v.status === 'outdated') {
      const ok = Object.assign(document.createElement('button'), { type: 'button', className: 'vo-ok', textContent: 'Still fine', title: 'The recording still matches this line; stop flagging it' });
      ok.addEventListener('click', () => void this.accept([v.name]));
      act.append(ok);
    }

    row.addEventListener('dragover', e => { if (hasFiles(e) || this.dragged) { e.preventDefault(); e.stopPropagation(); row.dataset.drop = 'true'; } });
    row.addEventListener('dragleave', e => { if (!row.contains(e.relatedTarget as Node | null)) delete row.dataset.drop; });
    row.addEventListener('drop', e => {
      delete row.dataset.drop;
      const file = e.dataTransfer?.files[0] ?? this.dragged;
      if (!file) return;
      e.preventDefault();
      e.stopPropagation(); // the list's own handler matches by name; a drop on a row names the line itself
      void this.take(v, file);
    });
    row.append(ctx, text, act);
    return row;
  }

  /** Play the take of `name`. */
  private play(name: string) {
    const file = this.files[name];
    if (!file) return;
    this.audio?.pause();
    this.audio = new Audio(`../assets/voice/${encodeURIComponent(file)}?t=${Date.now()}`);
    void this.audio.play().catch(() => this.say(`Could not play ${file}.`));
  }

  /** Save `file` as the take of `v`. An existing take is only replaced after asking. */
  private async take(v: VoiceRow, file: File, replace = false): Promise<'saved' | 'exists' | 'failed'> {
    if (!AUDIO.test(file.name)) { this.say(`${file.name}: not an audio file (ogg, mp3, wav, m4a, flac or opus).`); return 'failed'; }
    this.ask.hidden = true;
    let reply: Response;
    try {
      reply = await fetch(`/api/asset?voice=${encodeURIComponent(v.name)}&name=${encodeURIComponent(file.name)}${replace ? '&replace=1' : ''}`,
        { method: 'PUT', headers: { 'X-VN-Editor': '1' }, body: file });
    } catch { this.say(`${file.name}: upload failed.`); return 'failed'; }
    if (reply.status === 409) {
      const dest = ((await reply.json()) as { dest: string }).dest;
      this.ask.querySelector('.vo-ask-msg')!.textContent = `${dest} already has a take for #${v.name}. Replace it with ${file.name}?`;
      const yes = this.ask.querySelector<HTMLButtonElement>('.vo-ask-yes')!;
      yes.onclick = () => void this.take(v, file, true);
      this.ask.hidden = false;
      yes.focus();
      return 'exists';
    }
    if (!reply.ok) { this.say(`${file.name}: ${await reply.text()}`); return 'failed'; }
    const { dest, sum } = await reply.json() as { dest: string; sum: string };
    this.recordings[v.name] = sum;
    this.files[v.name] = dest.split('/').pop()!;
    this.lock = { ...this.lock, [v.name]: { sum, text: v.text } };
    await this.saveLock(`Saved ${dest}.`);
    this.refilter(true);
    return 'saved';
  }

  /** Files dropped on the list: the ones named after a line of this language become its take, the rest wait for a row. */
  private async dropOnList(files: File[]) {
    const byName = new Map(files.map(f => [f.name, f]));
    const { matched, rest } = matchVoiceDrops(files.map(f => f.name), this.lang, this.rows.filter(r => r.kind === 'say').map(r => r.id));
    const lines = new Map(voiceRows(this.rows, this.lang, this.recordings, this.lock, this.locale).rows.map(v => [v.name, v] as const));
    const kept: string[] = [];
    let saved = 0;
    for (const m of matched) {
      const v = lines.get(m.name);
      if (!v) continue;
      const r = await this.take(v, byName.get(m.file)!);
      if (r === 'saved') saved++; else if (r === 'exists') kept.push(m.name);
    }
    this.leftover = rest.map(n => byName.get(n)!);
    this.drawLeftover();
    this.say([saved ? `Saved ${saved} ${saved === 1 ? 'take' : 'takes'}.` : '', kept.length ? `Already recorded, not replaced: ${kept.join(', ')} (drop on its row to replace).` : ''].filter(Boolean).join(' '));
    if (kept.length) this.ask.hidden = true;
  }

  private drawLeftover() {
    this.unmatched.hidden = !this.leftover.length;
    this.unmatched.querySelector('.vo-chips')!.replaceChildren(...this.leftover.map(f => {
      const chip = Object.assign(document.createElement('span'), { className: 'vo-chip', textContent: f.name, draggable: true });
      chip.addEventListener('dragstart', e => { this.dragged = f; e.dataTransfer?.setData('text/plain', f.name); });
      chip.addEventListener('dragend', () => { this.dragged = null; });
      return chip;
    }));
  }

  /** Confirm recordings as matching their lines, and save the lock (which also notes recordings seen for the first time). */
  private async accept(names: string[]) {
    if (!names.length) return;
    this.lock = acceptVoice(checkVoice(this.recordings, this.textOf, this.lock).lock, names, this.textOf);
    await this.saveLock('');
    this.refilter(true);
  }

  private async saveLock(done: string) {
    try {
      const r = await fetch('/api/voice', { method: 'PUT', headers: { 'X-VN-Editor': '1', 'Content-Type': 'text/plain' }, body: JSON.stringify(this.lock) });
      if (!r.ok) throw new Error(await r.text());
      this.say(done);
    } catch (e) { this.say(`Could not save voice.lock.json: ${(e as Error).message}`); }
  }

  private exportCsv() {
    const blob = new Blob(['﻿', recordingScriptCsv(this.shown)], { type: 'text/csv;charset=utf-8' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `recording-script-${this.lang ?? this.h.source()}.csv` });
    a.click();
    URL.revokeObjectURL(a.href);
  }
}

const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
