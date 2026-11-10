// The studio's Export dialog: renders the animation on show to a PNG sequence with alpha (movie export, Standalone mode in
// docs/design/animation-studio-parameters.md). The stage page draws the frames one at a time at a fixed timestep (preview/studio.ts,
// engine/src/movie-export.ts) and this module asks for them in order, writes each one as it arrives (into a folder, through the Studio's
// bridge, or into a zip it collects) and shows progress with a Cancel. Nothing here depends on scripts or game state.

import {
  DEFAULT_EXPORT, EXPORT_MAX_FPS, EXPORT_MAX_LEAD_IN, EXPORT_MAX_LOOPS, EXPORT_MAX_SIDE, EXPORT_MIN_FPS, EXPORT_MIN_SIDE, exportBackground, exportStem, movieProblem, movieSeconds, planMovie,
  readExportOptions, runMovieExport, ZipStream, type ExportOptions,
} from '../engine/src/index.js';
import { el } from './anim-dom.js';
import type { StageEvent } from './anim-stage.js';
import { wrapTab } from './modal.js';

type ExportEvent = Extract<StageEvent, { type: 'exportReady' | 'exportData' | 'exportError' | 'exportDone' }>;

const STORE_KEY = 'vn.editor.studioExport';
const PREPARE_MS = 120_000;  // the stage poses the whole animation once to frame the character
const FRAME_MS = 30_000;
const SIZES: [string, number, number][] = [['1280 x 720', 1280, 720], ['1920 x 1080', 1920, 1080], ['960 x 540', 960, 540], ['1024 x 1024', 1024, 1024], ['512 x 512', 512, 512]];

export interface ExportHost {
  post(msg: object): void;
  /** The animation on show (length in seconds), or null when there is none. */
  anim(): { name: string; dur: number } | null;
  char(): string;
  /** The rig has physics chains (a lead-in only matters then). */
  hasPhysics(): boolean;
  /** The stage is about to be used for the export (stop playing) and has been given back (pose it again). */
  begin(): void;
  end(): void;
  note(text: string): void;
  returnFocus(): void;
}

/** Where the files go. `finish` says what was done, for the studio's status line. */
interface Sink { write(name: string, bytes: Uint8Array): Promise<void>; finish(written: number): Promise<string>; abort(written: number): string }

interface DirHandle { name: string; getFileHandle(name: string, o: { create: boolean }): Promise<{ createWritable(): Promise<{ write(d: Uint8Array): Promise<void>; close(): Promise<void> }> }> }
const dirPicker = () => (window as unknown as { showDirectoryPicker?: (o: { mode: 'readwrite' }) => Promise<DirHandle> }).showDirectoryPicker;
/** Marginalia Studio's bridge (studio/preload.cjs): a folder picked in a native dialog, and frames written into it. */
interface StudioMovie { pickFolder(title: string): Promise<string | null>; write(name: string, bytes: Uint8Array): Promise<void> }
const studioMovie = () => (window as unknown as { vnStudio?: { movie?: StudioMovie } }).vnStudio?.movie;

const aborted = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';
const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;

export class ExportDialog {
  private root: HTMLElement;
  private card: HTMLElement;
  private f: { fps: HTMLInputElement; loops: HTMLInputElement; leadIn: HTMLInputElement; width: HTMLInputElement; height: HTMLInputElement; name: HTMLInputElement; color: HTMLInputElement; size: HTMLSelectElement; framing: HTMLSelectElement; bg: HTMLSelectElement };
  private loopRadio: HTMLInputElement;
  private onceRadio: HTMLInputElement;
  private saveRadio: Record<'folder' | 'zip', HTMLInputElement>;
  private summary: HTMLElement;
  private status: HTMLElement;
  private go: HTMLButtonElement;
  private bar: HTMLProgressElement;
  private count: HTMLElement;
  private seq = 0;
  private running = false;
  private cancelled = false;
  private waiting: { type: ExportEvent['type']; n?: number; resolve(e: ExportEvent): void; reject(err: Error): void; timer: ReturnType<typeof setTimeout> } | null = null;

  constructor(host: HTMLElement, private deps: ExportHost) {
    this.root = el('div', { className: 'as-export', hidden: true });
    this.root.innerHTML = `
      <div class="ax-card" role="dialog" aria-modal="true" aria-labelledby="ax-title" tabindex="-1">
        <h2 id="ax-title">Export animation</h2>
        <form class="ax-form" novalidate>
          <p class="ax-what"></p>
          <div class="ax-grid">
            <label>Frame rate <span><input type="number" class="ax-fps" min="${EXPORT_MIN_FPS}" max="${EXPORT_MAX_FPS}" step="1" list="ax-fpslist"> fps</span></label>
            <datalist id="ax-fpslist"><option value="12"><option value="24"><option value="25"><option value="30"><option value="50"><option value="60"></datalist>
            <fieldset class="ax-range"><legend>Length</legend>
              <label class="ax-inline"><input type="radio" name="ax-range" value="once" class="ax-once"> Once, ending on the last pose</label>
              <label class="ax-inline"><input type="radio" name="ax-range" value="loop" class="ax-loop"> Loop <input type="number" class="ax-loops" min="1" max="${EXPORT_MAX_LOOPS}" step="1" aria-label="Number of loops"> times, with no repeated end frame</label>
            </fieldset>
            <label>Size <span><select class="ax-size" aria-label="Size preset">${SIZES.map(([t, w, h]) => `<option value="${w}x${h}">${t}</option>`).join('')}<option value="">Custom</option></select>
              <input type="number" class="ax-w" min="${EXPORT_MIN_SIDE}" max="${EXPORT_MAX_SIDE}" step="1" aria-label="Width in pixels"> x <input type="number" class="ax-h" min="${EXPORT_MIN_SIDE}" max="${EXPORT_MAX_SIDE}" step="1" aria-label="Height in pixels"> px</span></label>
            <label>Framing <select class="ax-framing"><option value="stage">The whole stage, as placed</option><option value="character">The character, filling the image</option></select></label>
            <label>Background <span><select class="ax-bg"><option value="">Transparent</option><option value="colour">A colour</option></select> <input type="color" class="ax-color" value="#00b140" aria-label="Background colour"></span></label>
            <label class="ax-lead" hidden>Physics lead-in <span><input type="number" class="ax-leadin" min="0" max="${EXPORT_MAX_LEAD_IN}" step="0.5"> s</span></label>
            <label>File name <span><input type="text" class="ax-name" spellcheck="false" autocomplete="off" size="26"> _0001.png ...</span></label>
            <fieldset class="ax-save"><legend>Save as</legend>
              <label class="ax-inline"><input type="radio" name="ax-save" value="folder" class="ax-folder"> A folder of PNG files</label>
              <label class="ax-inline"><input type="radio" name="ax-save" value="zip" class="ax-zip"> One zip file</label>
            </fieldset>
          </div>
          <p class="ax-summary" aria-live="polite"></p>
          <p class="ax-status" role="alert"></p>
          <div class="ax-buttons"><button type="submit" class="primary ax-go">Export</button><button type="button" class="ax-close">Close</button></div>
        </form>
        <div class="ax-run" hidden>
          <p class="ax-run-what"></p>
          <progress class="ax-bar" max="1" value="0"></progress>
          <p class="ax-count"></p>
          <div class="ax-buttons"><button type="button" class="ax-cancel">Cancel</button></div>
        </div>
      </div>`;
    host.append(this.root);
    const q = <T extends Element>(s: string) => this.root.querySelector<T>(s)!;
    this.card = q('.ax-card');
    this.f = {
      fps: q('.ax-fps'), loops: q('.ax-loops'), leadIn: q('.ax-leadin'), width: q('.ax-w'), height: q('.ax-h'), name: q('.ax-name'),
      size: q('.ax-size'), framing: q('.ax-framing'), bg: q('.ax-bg'), color: q('.ax-color'),
    };
    this.loopRadio = q('.ax-loop');
    this.onceRadio = q('.ax-once');
    this.saveRadio = { folder: q('.ax-folder'), zip: q('.ax-zip') };
    this.summary = q('.ax-summary');
    this.status = q('.ax-status');
    this.go = q('.ax-go');
    this.bar = q('.ax-bar');
    this.count = q('.ax-count');
    q('.ax-close').addEventListener('click', () => this.close());
    q('.ax-cancel').addEventListener('click', () => this.cancel());
    q<HTMLFormElement>('.ax-form').addEventListener('submit', e => { e.preventDefault(); void this.start(); });
    this.f.size.addEventListener('change', () => {
      const [w, h] = this.f.size.value.split('x').map(Number);
      if (w && h) { this.f.width.value = String(w); this.f.height.value = String(h); }
      this.refresh();
    });
    for (const k of ['width', 'height'] as const) this.f[k].addEventListener('input', () => { this.f.size.value = SIZES.find(([, w, h]) => String(w) === this.f.width.value && String(h) === this.f.height.value)?.slice(1).join('x') ?? ''; });
    this.root.addEventListener('input', () => this.refresh());
    this.root.addEventListener('change', () => this.refresh());
    // Everything typed here stays here: the studio's own keys (tools on letters, Space, Ctrl+Z, Esc closing the studio) must not fire under the dialog.
    this.root.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); if (this.running) this.cancel(); else this.close(); }
      else if (e.key === 'Tab') wrapTab(e, this.card);
    });
  }

  get isOpen() { return !this.root.hidden; }

  /** Show the dialog for the animation on show. */
  open() {
    const a = this.deps.anim();
    if (!a || this.running) return;
    let o: ExportOptions;
    try { o = readExportOptions(localStorage.getItem(STORE_KEY)); } catch { o = readExportOptions(null); }
    const can = { folder: !!(studioMovie() || dirPicker()), zip: true };
    this.f.fps.value = String(o.fps);
    this.loopRadio.checked = o.loop;
    this.onceRadio.checked = !o.loop;
    this.f.loops.value = String(o.loops);
    this.f.leadIn.value = String(o.leadIn);
    this.f.width.value = String(o.width);
    this.f.height.value = String(o.height);
    this.f.size.value = SIZES.find(([, w, h]) => w === o.width && h === o.height)?.slice(1).join('x') ?? '';
    this.f.framing.value = o.framing;
    this.f.bg.value = o.background ? 'colour' : '';
    this.f.color.value = o.background ?? '#00b140';
    this.f.name.value = exportStem(`${this.deps.char()}_${a.name}`, 'animation');
    this.saveRadio.folder.disabled = !can.folder;
    this.saveRadio.folder.title = can.folder ? '' : 'This browser cannot write into a folder. The zip holds the same files.';
    (can.folder && o.save === 'folder' ? this.saveRadio.folder : this.saveRadio.zip).checked = true;
    this.root.querySelector('.ax-what')!.textContent = `${a.name} on ${this.deps.char()}, ${a.dur} s long. The frames show the look chosen on the left and the parameter values set in the Parameters section, with every part at full strength.`;
    this.root.querySelector<HTMLElement>('.ax-lead')!.hidden = !this.deps.hasPhysics();
    this.setRunning(false);
    this.status.textContent = '';
    this.root.hidden = false;
    this.refresh();
    this.f.fps.focus();
  }

  close() {
    if (this.running) { this.cancel(); return; }
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.deps.returnFocus();
  }

  /** The studio closes under a running export: stop it without waiting for the stage. */
  abort() {
    this.cancelled = true;
    this.fail(new Error('The studio was closed.'));
    this.root.hidden = true;
  }

  /** The stage's answers to the export messages. */
  event(e: ExportEvent) {
    const w = this.waiting;
    if (!w) return;
    if (e.type === 'exportError') { if (e.id === this.seq) this.fail(new Error(e.error)); return; }
    if (e.id === this.seq && e.type === w.type && (w.n === undefined || (e.type === 'exportData' && e.n === w.n))) { clearTimeout(w.timer); this.waiting = null; w.resolve(e); }
  }

  // ---- the form ----
  private options(): ExportOptions {
    const num = (i: HTMLInputElement, or: number) => (i.value.trim() !== '' && Number.isFinite(Number(i.value)) ? Number(i.value) : or);
    return {
      fps: num(this.f.fps, DEFAULT_EXPORT.fps), loop: this.loopRadio.checked, loops: num(this.f.loops, 1), leadIn: Math.max(0, num(this.f.leadIn, 0)),
      width: num(this.f.width, NaN), height: num(this.f.height, NaN), framing: this.f.framing.value === 'character' ? 'character' : 'stage',
      background: this.f.bg.value === 'colour' ? exportBackground(this.f.color.value) : null, save: this.saveRadio.zip.checked ? 'zip' : 'folder',
    };
  }
  private refresh() {
    const a = this.deps.anim(), o = this.options();
    this.f.loops.disabled = !o.loop;
    this.f.color.hidden = this.f.bg.value !== 'colour';
    if (!a) { this.go.disabled = true; return; }
    const plan = planMovie({ dur: a.dur, fps: o.fps, loop: o.loop, loops: o.loops, leadIn: o.leadIn }), problem = movieProblem(plan, o.width, o.height);
    this.summary.textContent = problem ?? `${plan.frames} frames, ${movieSeconds(plan).toFixed(2)} s at ${plan.fps} fps; ${o.width} x ${o.height} px PNG${o.background ? '' : ' with alpha'}.${o.save === 'zip' && plan.frames * o.width * o.height > 3e8 ? ' The zip is collected in memory: for a long export choose a folder.' : ''}`;
    this.go.disabled = !!problem;
  }
  private setRunning(on: boolean) {
    this.running = on;
    this.card.querySelector<HTMLElement>('.ax-form')!.hidden = on;
    this.card.querySelector<HTMLElement>('.ax-run')!.hidden = !on;
    if (on) this.card.querySelector<HTMLButtonElement>('.ax-cancel')!.disabled = false;
  }

  // ---- the run ----
  private cancel() {
    if (!this.running) return;
    this.cancelled = true;
    this.card.querySelector<HTMLButtonElement>('.ax-cancel')!.disabled = true;
    this.count.textContent = 'Stopping after this frame...';
  }

  /** Wait for the stage's next message of `type` (for frame `n`, when given). It rejects when the stage reports an error or says nothing for `ms`. */
  private expect(type: ExportEvent['type'], ms: number, n?: number): Promise<ExportEvent> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error('The stage stopped answering. Close the studio and open it again.')), ms);
      this.waiting = { type, n, resolve, reject, timer };
    });
  }
  private fail(err: Error) {
    const w = this.waiting;
    if (!w) return;
    clearTimeout(w.timer);
    this.waiting = null;
    w.reject(err);
  }

  /** The place the files go, asked for first (a folder picker needs the click that pressed Export). Null: the animator backed out of the picker. */
  private async sink(o: ExportOptions, stem: string): Promise<Sink | null> {
    if (o.save === 'zip') {
      const zip = new ZipStream(), parts: Uint8Array[] = [];
      return {
        write: async (name, bytes) => { parts.push(...zip.add(name, bytes)); },
        finish: async () => {
          parts.push(...zip.finish());
          const blob = new Blob(parts as BlobPart[], { type: 'application/zip' }), url = URL.createObjectURL(blob);
          const a = el('a', { href: url, download: `${stem}.zip` });
          document.body.append(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 60_000);
          return `${stem}.zip (${zip.files} frames, ${mb(blob.size)}) was handed to the browser to save.`;
        },
        abort: () => 'Cancelled: nothing was saved.',
      };
    }
    const studio = studioMovie();
    if (studio) {
      const folder = await studio.pickFolder(`Folder for the ${stem} frames`);
      if (!folder) return null;
      return {
        write: (name, bytes) => studio.write(name, bytes),
        finish: async n => `Saved ${n} frames to ${folder}.`,
        abort: n => `Cancelled after ${n} frame${n === 1 ? '' : 's'}; they are in ${folder}.`,
      };
    }
    const pick = dirPicker();
    if (!pick) throw new Error('This browser cannot write into a folder: save as a zip instead.');
    let dir: DirHandle;
    try { dir = await pick({ mode: 'readwrite' }); } catch (e) { if (aborted(e)) return null; throw e; }
    return {
      write: async (name, bytes) => { const w = await (await dir.getFileHandle(name, { create: true })).createWritable(); await w.write(bytes); await w.close(); },
      finish: async n => `Saved ${n} frames to the folder "${dir.name}".`,
      abort: n => `Cancelled after ${n} frame${n === 1 ? '' : 's'}; they are in the folder "${dir.name}".`,
    };
  }

  private async start() {
    const a = this.deps.anim();
    if (!a || this.running) return;
    const o = this.options(), stem = exportStem(this.f.name.value, 'animation');
    this.f.name.value = stem;
    const plan = planMovie({ dur: a.dur, fps: o.fps, loop: o.loop, loops: o.loops, leadIn: o.leadIn });
    if (movieProblem(plan, o.width, o.height)) { this.refresh(); return; }
    try { localStorage.setItem(STORE_KEY, JSON.stringify(o)); } catch { /* storage blocked: the options are not kept */ }
    this.status.textContent = '';
    let sink: Sink | null;
    try { sink = await this.sink(o, stem); } catch (e) { this.status.textContent = e instanceof Error ? e.message : String(e); return; }
    if (!sink) return;
    const id = ++this.seq;
    let written = 0, message = '', failed = false;
    this.cancelled = false;
    this.setRunning(true);
    this.card.querySelector('.ax-run-what')!.textContent = `Exporting ${a.name} as ${stem}_0001.png ... at ${o.width} x ${o.height}.`;
    this.bar.removeAttribute('value');
    this.count.textContent = 'Preparing the stage...';
    this.deps.begin();
    try {
      const begin = this.expect('exportReady', PREPARE_MS);
      this.deps.post({ type: 'studioExportBegin', id, name: a.name, fps: o.fps, loop: o.loop, loops: o.loops, leadIn: o.leadIn, width: o.width, height: o.height, framing: o.framing, background: o.background });
      const ready = (await begin) as Extract<ExportEvent, { type: 'exportReady' }>;
      this.bar.max = ready.frames;
      this.bar.value = 0;
      const r = await runMovieExport({
        frames: ready.frames, stem,
        frame: async n => {
          const got = this.expect('exportData', FRAME_MS, n);
          this.deps.post({ type: 'studioExportFrame', id, n });
          return new Uint8Array(((await got) as Extract<ExportEvent, { type: 'exportData' }>).bytes);
        },
        write: (name, bytes) => sink!.write(name, bytes),
        progress: done => { written = done; this.bar.value = done; this.count.textContent = `Frame ${done} of ${ready.frames}`; },
        cancelled: () => this.cancelled,
      });
      message = r.cancelled ? sink.abort(r.written) : await sink.finish(r.written);
    } catch (e) {
      failed = true;
      message = `${e instanceof Error ? e.message : String(e)}${written ? ` (${written} frame${written === 1 ? '' : 's'} were written before it stopped.)` : ''}`;
    }
    if (this.root.hidden) { this.setRunning(false); return; } // the studio closed meanwhile; the stage is gone
    const done = this.expect('exportDone', 5000);
    this.deps.post({ type: 'studioExportEnd', id });
    try { await done; } catch { /* the stage will catch up; the next pose redraws it */ }
    this.deps.end();
    this.setRunning(false);
    if (failed) { this.status.textContent = message; return; }
    this.root.hidden = true;
    this.deps.note(message);
    this.deps.returnFocus();
  }
}
