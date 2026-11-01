// Animation studio: a modal over the editor that plays and edits a character's animations (its rig.json `animations`;
// the presets can be copied into editable ones) on a stage of their own, with a timeline of every channel. The stage is
// the preview page in studio mode (preview/studio.ts), embedded in an iframe and driven by postMessage. Edits go to a
// working copy; Apply hands it to the editor, which writes it to the rig.json tab in one undo step.

import {
  addKey, ANCHORS, anchorToken, FEET, parseAnchor, type Placement, type Positions, type Anchors, ANIMS, animParts, bakePreset, deleteAnim, deleteKey, duplicateAnim, EASE_NAMES, KEY_CHANNELS, keysOf, newAnim, renameAnim,
  sampleChannel, setDur, setKey, setPivot, setPivots, showLine, uniqueName, noRigSettings, type RigSettings, type AnimDef, type Anims, type KeyChannel, type KeyDef, type Pivots,
} from '../engine/src/index.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const LANE = 52, AXIS = 22, LABEL = 70, PAD = 14, HISTORY = 100;
/** The smallest range a lane shows, so a tiny value does not fill it. */
const MIN_RANGE: Record<KeyChannel, number> = { x: 0.02, y: 0.02, scale: 0.02, rot: 2 };
/** How much an arrow key changes a channel. */
const NUDGE: Record<KeyChannel, number> = { x: 0.005, y: 0.005, scale: 0.005, rot: 0.5 };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
}
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, text?: string) {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  return e;
}

interface Entry { name: string; preset: boolean; def: AnimDef; dur: number }
export type { RigSettings };
/** What the studio edits: the character's `animations`, `pivots`, `idle`, the animation of `speak` and `blink`. */
export interface Snap { anims: Anims; pivots: Pivots; rig: RigSettings }
export interface StudioHost {
  returnFocus?: () => void;
  /** The game's named stage positions (game.json `positions` and the built-in ones), so the Place row writes `at farleft` where one fits. */
  positions?: Positions;
  /** The game's named anchors (game.json `anchors` and the built-in ones). */
  anchors?: Anchors;
  /** The character's parts (slots and plain layers) and the PSD canvas size, for the part list and for placing pivots. */
  parts: string[];
  /** Pose and shorthand names for `show`, and each slot's variants, for dressing the character on the stage. */
  poses: string[];
  slots: Record<string, string[]>;
  width: number;
  height: number;
  /** The parts drawn for a pose and slot variants (what the stage shows); absent when the rig cannot tell. */
  shown?: (pose: string | null, overrides: Record<string, string>) => string[];
  /** Write both to the character's rig.json; false when that failed (the studio then keeps its changes pending). */
  apply: (change: Snap) => boolean;
}

export class AnimStudio {
  private root: HTMLDivElement;
  private card: HTMLElement;
  private title: HTMLElement;
  private stageHost: HTMLElement;
  private listEl: HTMLElement;
  private tl: SVGSVGElement;
  private playBtn: HTMLButtonElement;
  private loopBox: HTMLInputElement;
  private slider: HTMLInputElement;
  private time: HTMLElement;
  private partSel: HTMLSelectElement;
  private durInput: HTMLInputElement;
  private note: HTMLElement;
  private tools: Record<'new' | 'copy' | 'rename' | 'delete' | 'undo' | 'redo' | 'apply', HTMLButtonElement>;
  private keySel: HTMLSelectElement;
  private fields: Record<'t' | KeyChannel, HTMLInputElement>;
  private easeSel: HTMLSelectElement;
  private delKey: HTMLButtonElement;
  private addCh: HTMLSelectElement;
  private addBtn: HTMLButtonElement;
  private frame: HTMLIFrameElement | null = null;
  private host: StudioHost = { parts: [], poses: [], slots: {}, width: 0, height: 0, apply: () => false };
  private char = '';
  private anims: Anims = {};
  private pivots: Pivots = {};
  private rig: RigSettings = noRigSettings();
  private auto: Record<'spSlot' | 'spVars' | 'spRate' | 'blSlot' | 'blVariant' | 'blMin' | 'blMax' | 'blDur', HTMLInputElement>;
  private variantList: HTMLDataListElement;
  private pose: string | null = null;     // how the stage dresses the character (not saved anywhere)
  private overrides: Record<string, string> = {};
  private placing = false;                // a drag on the stage places the character
  private place: Placement = { x: 0.5, y: 0, scale: 1, flip: false, anchor: FEET };
  private picking = false;                // the stage waits for a click that places the pivot of `part`
  private pivotBtn: HTMLButtonElement;
  private pivotFields: Record<'x' | 'y', HTMLInputElement>;
  private pivotClear: HTMLButtonElement;
  private pivotShare: HTMLButtonElement;
  private shareBox: HTMLElement;
  private poseSel: HTMLSelectElement;
  private slotsEl: HTMLElement;
  private idleSel: HTMLSelectElement;
  private speakSel: HTMLSelectElement;
  private blinkBox: HTMLInputElement;
  private placeBtn: HTMLButtonElement;
  private placeFields: Record<'x' | 'y' | 'scale', HTMLInputElement>;
  private flipBox: HTMLInputElement;
  private anchorBox: HTMLInputElement;
  private placeLine: HTMLInputElement;
  private baseline = '';
  private past: Snap[] = [];
  private future: Snap[] = [];
  private entries: Entry[] = [];
  private cur: Entry | null = null;
  private part: string | null = null;
  private sel: number | null = null;      // index into the animation's keys
  private frozen: Partial<Record<KeyChannel, number>> | null = null; // lane ranges held still while a key is dragged
  private ranges: Record<KeyChannel, number> = { x: 1, y: 1, scale: 1, rot: 1 };
  private t = 0;
  private playing = false;
  private playLine: SVGLineElement | null = null;
  private presetNote = false;  // the note says what a preset is
  private closeWarned = false; // Close was pressed with unapplied changes; the next press discards them

  constructor(host: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'animStudio';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="as-card" role="dialog" aria-modal="true" aria-label="Animation studio" tabindex="-1">
        <header><strong></strong>
          <span class="hint">Space: play or pause. Ctrl+Z / Ctrl+Y: undo and redo. Esc to close</span>
          <button type="button" data-t="undo">Undo</button><button type="button" data-t="redo">Redo</button>
          <button type="button" data-t="apply" class="primary">Apply</button>
          <button type="button" class="close" aria-label="Close animation studio">Close</button></header>
        <div class="as-body">
          <div class="as-side">
            <div class="as-tools"><button type="button" data-t="new">New</button><button type="button" data-t="copy">Copy</button>
              <button type="button" data-t="rename">Rename</button><button type="button" data-t="delete">Delete</button></div>
            <form class="as-name" hidden><span></span>
              <input type="text" aria-label="Animation name" spellcheck="false" autocomplete="off">
              <div><button type="submit">OK</button><button type="button">Cancel</button></div></form>
            <div class="as-list" role="group" aria-label="Animations"></div>
          </div>
          <div class="as-main">
            <div class="as-stage"></div>
            <div class="as-transport">
              <button type="button" class="as-play" aria-label="Play">Play</button>
              <label><input type="checkbox" class="as-loop"> Loop</label>
              <input type="range" class="as-slider" min="0" max="1000" value="0" aria-label="Position in the animation">
              <span class="as-time" aria-live="off"></span>
              <label>Length <input type="number" class="as-dur" min="0.05" step="0.1" aria-label="Length in seconds"> s</label>
              <label>Lanes of <select class="as-part" aria-label="Show the keys of"></select></label>
            </div>
            <svg class="as-timeline" role="img" aria-label="Timeline: one lane for each of x, y, scale and rotation. Double-click a lane to add a key, drag a key to move it."></svg>
          </div>
          <div class="as-inspect">
            <div class="as-tabs" role="tablist" aria-label="Inspector">
              <button type="button" role="tab" class="as-tab" data-tab="key" id="as-tab-key" aria-controls="as-panel-key">Key</button>
              <button type="button" role="tab" class="as-tab" data-tab="part" id="as-tab-part" aria-controls="as-panel-part">Part</button>
              <button type="button" role="tab" class="as-tab" data-tab="char" id="as-tab-char" aria-controls="as-panel-char">Character</button>
              <button type="button" role="tab" class="as-tab" data-tab="stage" id="as-tab-stage" aria-controls="as-panel-stage">Stage</button>
            </div>
            <div class="as-panel" role="tabpanel" data-panel="key" id="as-panel-key" aria-labelledby="as-tab-key">
        <div class="as-inspector">
          <label>Key <select class="as-key" aria-label="Key"></select></label>
          <label>t <input type="number" data-f="t" min="0" max="1" step="0.01"></label>
          <label>x <input type="number" data-f="x" step="0.005"></label>
          <label>y <input type="number" data-f="y" step="0.005"></label>
          <label>scale <input type="number" data-f="scale" step="0.005"></label>
          <label>rot <input type="number" data-f="rot" step="0.5"></label>
          <label>ease <select class="as-ease" aria-label="Ease into this key"></select></label>
          <button type="button" class="as-delkey">Delete key</button>
          <span class="as-add"><button type="button" class="as-addkey">Add key at playhead for</button>
            <select class="as-addch" aria-label="Channel of the new key"></select></span>
        </div>
            </div>
            <div class="as-panel" role="tabpanel" data-panel="part" id="as-panel-part" aria-labelledby="as-tab-part" hidden>
        <div class="as-pivot">
          <span class="as-pivot-name">Pivot</span>
          <label>x <input type="number" data-p="x" step="1"></label>
          <label>y <input type="number" data-p="y" step="1"></label>
          <button type="button" class="as-pick">Pick on stage</button>
          <button type="button" class="as-pivot-clear">Clear</button>
          <button type="button" class="as-pivot-share" aria-expanded="false">Same pivot for…</button>
          <span class="as-share" hidden></span>
          <span class="as-pivot-hint">Choose a part in "Lanes of". The pivot is where the part turns and scales; in PSD pixels.</span>
        </div>
            </div>
            <div class="as-panel" role="tabpanel" data-panel="char" id="as-panel-char" aria-labelledby="as-tab-char" hidden>
        <div class="as-auto">
          <span class="as-pivot-name">By itself</span>
          <label>Idle <select class="as-idle" aria-label="Animation that loops while the character is on stage"></select></label>
          <label>Talking <select class="as-speak" aria-label="Animation that loops while a line types"></select></label>
          <label><input type="checkbox" class="as-blink"> Blink</label>
          <span class="as-pivot-hint">Saved as idle, speak and blink. Empty fields use the defaults shown in grey.</span>
        </div>
        <div class="as-auto">
          <span class="as-pivot-name">Mouth</span>
          <label>Slot <input type="text" class="as-sp-slot" list="as-slotnames" placeholder="mouth" size="8"></label>
          <label>Variants <input type="text" class="as-sp-vars" list="as-variantnames" placeholder="open, neutral" size="24" aria-label="Mouth variants cycled while a line types, separated by commas"></label>
          <label>Changes a second <input type="number" class="as-sp-rate" min="0.5" step="0.5" placeholder="8"></label>
        </div>
        <div class="as-auto">
          <span class="as-pivot-name">Blink</span>
          <label>Slot <input type="text" class="as-bl-slot" list="as-slotnames" placeholder="eyes" size="8"></label>
          <label>Variant <input type="text" class="as-bl-variant" list="as-variantnames" placeholder="closed" size="8"></label>
          <label>Every <input type="number" class="as-bl-min" min="0.1" step="0.5" placeholder="3"> to <input type="number" class="as-bl-max" min="0.1" step="0.5" placeholder="6"> s</label>
          <label>Closed for <input type="number" class="as-bl-dur" min="0.02" step="0.02" placeholder="0.12"> s</label>
          <datalist id="as-slotnames"></datalist><datalist id="as-variantnames"></datalist>
        </div>
            </div>
            <div class="as-panel" role="tabpanel" data-panel="stage" id="as-panel-stage" aria-labelledby="as-tab-stage" hidden>
        <div class="as-dress">
          <span class="as-pivot-name">On stage</span>
          <label>Pose <select class="as-pose" aria-label="Pose shown on the stage"></select></label>
          <span class="as-slots" role="group" aria-label="Slot variants shown on the stage"></span>
          <span class="as-pivot-hint">Only for looking; the stage dress is not saved.</span>
        </div>
        <div class="as-place">
          <span class="as-pivot-name">Place</span>
          <button type="button" class="as-place-btn" aria-pressed="false">Place on stage</button>
          <label>x <input type="number" data-pl="x" step="0.01"></label>
          <label>y <input type="number" data-pl="y" step="0.01"></label>
          <label>scale <input type="number" data-pl="scale" step="0.05" min="0.05"></label>
          <label><input type="checkbox" class="as-flip"> flip</label>
          <label>anchor <input type="text" class="as-anchor" list="as-anchornames" size="9" placeholder="feet"></label>
          <datalist id="as-anchornames"></datalist>
          <input type="text" class="as-place-line" readonly aria-label="The show line for this placement" size="38">
          <button type="button" class="as-place-copy">Copy</button>
          <span class="as-pivot-hint">Drag the character on the stage, then paste the line into the script.</span>
        </div>
            </div>
          </div>
        </div>
        <div class="as-note" role="status"></div>
      </div>`;
    host.append(this.root);
    const q = <T extends Element>(s: string) => this.root.querySelector<T>(s)!;
    this.card = q('.as-card');
    this.title = q('header strong');
    this.stageHost = q('.as-stage');
    this.listEl = q('.as-list');
    this.tl = q('.as-timeline');
    this.playBtn = q('.as-play');
    this.loopBox = q('.as-loop');
    this.slider = q('.as-slider');
    this.time = q('.as-time');
    this.partSel = q('.as-part');
    this.durInput = q('.as-dur');
    this.note = q('.as-note');
    this.keySel = q('.as-key');
    this.easeSel = q('.as-ease');
    this.delKey = q('.as-delkey');
    this.addCh = q('.as-addch');
    this.addBtn = q('.as-addkey');
    this.tools = Object.fromEntries(['new', 'copy', 'rename', 'delete', 'undo', 'redo', 'apply'].map(n => [n, q<HTMLButtonElement>(`[data-t="${n}"]`)])) as StudioTools;
    this.fields = Object.fromEntries(['t', ...KEY_CHANNELS].map(n => [n, q<HTMLInputElement>(`[data-f="${n}"]`)])) as Record<'t' | KeyChannel, HTMLInputElement>;
    this.pivotBtn = q('.as-pick');
    this.pivotClear = q('.as-pivot-clear');
    this.pivotShare = q('.as-pivot-share');
    this.shareBox = q('.as-share');
    this.poseSel = q('.as-pose');
    this.slotsEl = q('.as-slots');
    this.idleSel = q('.as-idle');
    this.speakSel = q('.as-speak');
    this.blinkBox = q('.as-blink');
    this.auto = { spSlot: q('.as-sp-slot'), spVars: q('.as-sp-vars'), spRate: q('.as-sp-rate'), blSlot: q('.as-bl-slot'), blVariant: q('.as-bl-variant'), blMin: q('.as-bl-min'), blMax: q('.as-bl-max'), blDur: q('.as-bl-dur') };
    this.variantList = q('#as-variantnames');
    this.placeBtn = q('.as-place-btn');
    this.placeFields = { x: q('[data-pl="x"]'), y: q('[data-pl="y"]'), scale: q('[data-pl="scale"]') };
    this.flipBox = q('.as-flip');
    this.anchorBox = q('.as-anchor');
    this.placeLine = q('.as-place-line');
    this.pivotShare.addEventListener('click', () => this.toggleShare());
    this.poseSel.addEventListener('change', () => { this.pose = this.poseSel.value || null; this.overrides = {}; this.dressStage(); this.refreshView(); this.showDress(); this.showPlace(); });
    this.idleSel.addEventListener('change', () => this.edit(() => { this.rig = { ...this.rig, idle: this.idleSel.value || null }; }));
    this.speakSel.addEventListener('change', () => this.edit(() => { this.rig = { ...this.rig, speakAnim: this.speakSel.value || null }; }));
    this.blinkBox.addEventListener('change', () => this.edit(() => { this.rig = { ...this.rig, blink: this.blinkBox.checked }; }));
    const word = (v: string) => v.trim() || null;
    const num = (v: string) => { const n = Number(v); return v.trim() !== '' && Number.isFinite(n) && n > 0 ? n : null; };
    const offer = (slot: () => string) => () => this.variantList.replaceChildren(...(this.host.slots[slot()] ?? []).map(n => el('option', { value: n })));
    this.auto.spVars.addEventListener('focus', offer(() => this.rig.speakSlot ?? 'mouth'));
    this.auto.blVariant.addEventListener('focus', offer(() => this.rig.blinkSlot ?? 'eyes'));
    const set = (patch: Partial<RigSettings>) => this.edit(() => { this.rig = { ...this.rig, ...patch }; });
    const a = this.auto;
    a.spSlot.addEventListener('change', () => set({ speakSlot: word(a.spSlot.value) }));
    a.spVars.addEventListener('change', () => set({ speakVariants: a.spVars.value.split(',').map(v => v.trim()).filter(Boolean) }));
    a.spRate.addEventListener('change', () => set({ speakRate: num(a.spRate.value) }));
    a.blSlot.addEventListener('change', () => set({ blinkSlot: word(a.blSlot.value) }));
    a.blVariant.addEventListener('change', () => set({ blinkVariant: word(a.blVariant.value) }));
    a.blDur.addEventListener('change', () => set({ blinkDur: num(a.blDur.value) }));
    for (const box of [a.blMin, a.blMax]) box.addEventListener('change', () => {
      const lo = num(a.blMin.value), hi = num(a.blMax.value);
      // One end left empty takes its default; a range that runs backwards is not kept.
      const every: [number, number] | null = lo === null && hi === null ? null : [lo ?? 3, hi ?? 6];
      if (every && every[1] < every[0]) { this.showAuto(); this.note.textContent = 'Blink "every" needs the first number to be the smaller.'; return; }
      set({ blinkEvery: every });
    });
    this.placeBtn.addEventListener('click', () => this.setPlacing(!this.placing));
    for (const [k, input] of Object.entries(this.placeFields)) input.addEventListener('change', () => {
      const v = Number(input.value);
      if (input.value !== '' && Number.isFinite(v)) this.place = { ...this.place, [k]: k === 'scale' ? Math.max(0.05, v) : v };
      this.sendPlace();
    });
    this.flipBox.addEventListener('change', () => { this.place = { ...this.place, flip: this.flipBox.checked }; this.sendPlace(); });
    this.anchorBox.addEventListener('change', () => {
      try { this.place = { ...this.place, anchor: this.anchorBox.value.trim() === '' ? FEET : parseAnchor(this.anchorBox.value.trim(), this.host.anchors) }; }
      catch (e) { this.note.textContent = (e as Error).message; }
      this.sendPlace();
    });
    q('.as-place-copy').addEventListener('click', () => {
      this.placeLine.select();
      void navigator.clipboard?.writeText(this.placeLine.value).then(() => { this.note.textContent = 'Copied the show line.'; }, () => { this.note.textContent = 'Press Ctrl+C to copy the selected line.'; });
    });
    this.pivotFields = { x: q('[data-p="x"]'), y: q('[data-p="y"]') };
    this.pivotBtn.addEventListener('click', () => this.setPicking(!this.picking));
    this.pivotClear.addEventListener('click', () => { this.setPicking(false); this.edit(() => { if (this.part) this.pivots = setPivot(this.pivots, this.part, null); }); });
    for (const axis of ['x', 'y'] as const) this.pivotFields[axis].addEventListener('change', () => this.pivotTyped());
    this.easeSel.append(el('option', { value: '', textContent: `(default: inout)` }), ...EASE_NAMES.map(n => el('option', { value: n, textContent: n })));
    this.addCh.append(...KEY_CHANNELS.map(c => el('option', { value: c, textContent: c })));

    this.root.addEventListener('mousedown', e => { if (e.target === this.root) this.close(); });
    q('.close').addEventListener('click', () => this.close());
    const tabs = [...this.root.querySelectorAll<HTMLButtonElement>('.as-tab')];
    for (const tab of tabs) {
      tab.addEventListener('click', () => this.showTab(tab.dataset.tab!));
      tab.addEventListener('keydown', e => {
        const i = tabs.indexOf(tab);
        const to = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1;
        if (to < 0) return;
        e.preventDefault();
        const next = tabs[(to + tabs.length) % tabs.length];
        this.showTab(next.dataset.tab!);
        next.focus();
      });
    }
    this.showTab(this.tab);
    // A click on a key opens the Key tab, choosing a part in "Lanes of" opens Part.
    this.tl.addEventListener('pointerdown', e => { if ((e.target as Element).closest('[data-key]')) this.showTab('key'); });
    this.partSel.addEventListener('change', () => { if (this.partSel.value) this.showTab('part'); });
    this.playBtn.addEventListener('click', () => this.toggle());
    this.slider.addEventListener('input', () => this.seek(Number(this.slider.value) / 1000));
    this.partSel.addEventListener('change', () => { this.part = this.partSel.value || null; this.sel = null; this.setPicking(this.picking); this.refreshView(); });
    this.loopBox.addEventListener('change', () => { if (this.playing) this.play(); });
    this.durInput.addEventListener('change', () => this.edit(() => { if (this.cur && !this.cur.preset) this.anims[this.cur.name] = setDur(this.cur.def, Number(this.durInput.value)); }));
    this.tools.new.addEventListener('click', () => this.newAnimation());
    this.tools.copy.addEventListener('click', () => this.copyAnimation());
    this.tools.rename.addEventListener('click', () => this.renameAnimation());
    this.tools.delete.addEventListener('click', () => this.deleteAnimation());
    this.tools.undo.addEventListener('click', () => this.undo());
    this.tools.redo.addEventListener('click', () => this.redo());
    this.tools.apply.addEventListener('click', () => this.apply());
    this.keySel.addEventListener('change', () => { this.sel = this.keySel.value === '' ? null : Number(this.keySel.value); this.refreshView(); });
    for (const [name, input] of Object.entries(this.fields)) input.addEventListener('change', () => this.fieldChanged(name as 't' | KeyChannel, input.value));
    this.easeSel.addEventListener('change', () => this.patchSelected({ ease: this.easeSel.value || undefined }));
    this.delKey.addEventListener('click', () => this.removeSelected());
    this.addBtn.addEventListener('click', () => this.addAtPlayhead());

    this.tl.addEventListener('pointerdown', e => this.pointerDown(e));
    this.tl.addEventListener('dblclick', e => this.addAtPointer(e));
    this.tl.addEventListener('keydown', e => this.diamondKey(e));
    this.root.addEventListener('keydown', e => {
      const typing = e.target instanceof HTMLInputElement && e.target.type !== 'range' && e.target.type !== 'checkbox';
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); }
      else if (e.key === 'Tab') this.trapTab(e);
      else if ((e.ctrlKey || e.metaKey) && !typing && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) {
        e.preventDefault();
        if (e.key.toLowerCase() === 'y' || e.shiftKey) this.redo(); else this.undo();
      } else if (e.key === ' ' && !(e.target instanceof HTMLButtonElement || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof SVGElement)) {
        e.preventDefault();
        this.toggle();
      }
    });
    window.addEventListener('message', e => this.onMessage(e));
    new ResizeObserver(() => { if (!this.root.hidden) this.drawTimeline(); }).observe(this.tl);
  }

  get isOpen() { return !this.root.hidden; }

  private tab = 'key'; // remembered while the page lives, also across openings

  private showTab(name: string) {
    this.tab = name;
    for (const t of this.root.querySelectorAll<HTMLButtonElement>('.as-tab')) {
      const on = t.dataset.tab === name;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    }
    for (const p of this.root.querySelectorAll<HTMLElement>('.as-panel')) p.hidden = p.dataset.panel !== name;
  }

  /** Keep Tab inside the dialog: wrap from the last focusable element to the first and back. */
  private trapTab(e: KeyboardEvent) {
    const items = [...this.card.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]')]
      .filter(x => x.tabIndex >= 0 && !(x as HTMLInputElement).disabled && x.getClientRects().length > 0);
    if (!items.length) { e.preventDefault(); return; }
    const first = items[0], last = items[items.length - 1];
    const at = document.activeElement;
    if (e.shiftKey && (at === first || at === this.card)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
    else if (!this.card.contains(at)) { e.preventDefault(); first.focus(); }
  }
  private doc(): Snap { return { anims: this.anims, pivots: this.pivots, rig: this.rig }; }
  private snap(): Snap { return structuredClone(this.doc()); }
  private get dirty() { return JSON.stringify(this.doc()) !== this.baseline; }

  /** Show `char`'s animations: `start` is its rig.json `animations` and `pivots` and what it does by itself. */
  open(char: string, start: Snap, host: StudioHost) {
    this.host = host;
    this.root.querySelector('#as-anchornames')!.replaceChildren(...Object.keys(host.anchors ?? ANCHORS).map(n => el('option', { value: n })));
    this.char = char;
    this.anims = structuredClone(start.anims);
    this.pivots = structuredClone(start.pivots);
    this.rig = { ...start.rig };
    this.picking = false;
    this.placing = false;
    this.place = { x: 0.5, y: 0, scale: 1, flip: false, anchor: FEET };
    this.pose = null;
    this.overrides = {};
    this.shareBox.hidden = true;
    this.baseline = JSON.stringify(this.doc());
    this.past = [];
    this.future = [];
    this.t = 0;
    this.playing = false;
    this.sel = null;
    this.part = null;
    this.rebuild();
    this.showDress();
    this.showPlace();
    this.frame = el('iframe', { title: `${char} on the studio stage`, src: `/?studio=${encodeURIComponent(char)}` });
    this.stageHost.replaceChildren(this.frame);
    if (!host.parts?.length) this.stageHost.append(el('div', { className: 'as-empty', textContent: `No art for ${char} yet. Convert its PSD (or add its images) to see it here.` }));
    this.root.hidden = false;
    this.select(this.entries[0] ?? null);
    this.card.focus({ preventScroll: true });
  }

  close(force = false) {
    if (this.root.hidden) return;
    if (!force && this.dirty && !this.closeWarned) {
      this.closeWarned = true; // browser confirm dialogs are not shown everywhere: ask in the dialog, close on the second try
      this.note.textContent = 'There are changes that were not applied. Apply them, or press Close (or Esc) again to discard them.';
      return;
    }
    this.closeWarned = false;
    this.post({ type: 'studioPause' });
    this.root.hidden = true;
    this.frame?.remove(); // frees the stage's WebGL context
    this.frame = null;
    this.playing = false;
    this.host.returnFocus?.();
  }

  private post(msg: object) { this.frame?.contentWindow?.postMessage(msg, location.origin); }

  private onMessage(e: MessageEvent) {
    if (e.origin !== location.origin || !this.frame || e.source !== this.frame.contentWindow) return;
    const m = e.data as { type?: string; t?: number; playing?: boolean } | null;
    if (m?.type === 'studioReady') {
      this.post({ type: 'studioAnims', anims: this.anims });
      this.postPivots();
      this.dressStage();
      this.sendPlace();
      if (this.picking) this.post({ type: 'studioPick', part: this.part });
      else if (this.cur) this.post({ type: 'studioSeek', name: this.cur.name, t: this.t });
    } else if (m?.type === 'studioPicked' && this.picking && typeof (m as { x?: unknown }).x === 'number' && typeof (m as { y?: unknown }).y === 'number') {
      const { x, y } = m as unknown as { x: number; y: number };
      if (this.part) this.edit(() => { this.pivots = setPivot(this.pivots, this.part!, [x, y]); });
    } else if (m?.type === 'studioPlaced' && typeof (m as { x?: unknown }).x === 'number' && typeof (m as { y?: unknown }).y === 'number') {
      const { x, y } = m as unknown as { x: number; y: number };
      this.place = { ...this.place, x, y };
      this.showPlace();
    } else if (m?.type === 'studioTime' && typeof m.t === 'number') {
      this.t = m.t;
      if (m.playing === false && this.playing) { this.playing = false; this.showTransport(); }
      this.showTime();
    }
  }

  // ---- the working copy ----
  /** The animations that can be shown: the character's own, then the presets it does not override. */
  private rebuild() {
    const own = Object.keys(this.anims).filter(n => Array.isArray(this.anims[n]?.keys));
    this.entries = [
      ...own.map(name => { const def = this.anims[name]; return { name, preset: false, def, dur: def.dur !== undefined && def.dur > 0 ? def.dur : 1 }; }),
      ...Object.keys(ANIMS).filter(name => !Object.hasOwn(this.anims, name) || !Array.isArray(this.anims[name]?.keys))
        .map(name => ({ name, preset: true, def: bakePreset(name, 48)!, dur: ANIMS[name].dur })),
    ];
  }

  /** Change the working copy with `fn` as one undo step, then show it. */
  private edit(fn: () => void) {
    this.closeWarned = false;
    const before = this.snap();
    fn();
    if (JSON.stringify(before) === JSON.stringify(this.doc())) return;
    this.past.push(before);
    if (this.past.length > HISTORY) this.past.shift();
    this.future = [];
    this.changed();
  }
  private restore(s: Snap) {
    this.anims = s.anims;
    this.pivots = s.pivots;
    this.rig = s.rig;
    this.changed();
  }
  private undo() {
    const prev = this.past.pop();
    if (!prev) return;
    this.future.push(this.snap());
    this.restore(prev);
  }
  private redo() {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.snap());
    this.restore(next);
  }
  private postPivots() { this.post({ type: 'studioPivots', pivots: this.pivots, width: this.host.width, height: this.host.height }); }
  /** The working copy changed: refresh the lists, the timeline and the stage. */
  private changed() {
    const name = this.cur?.name;
    this.rebuild();
    this.cur = this.entries.find(e => e.name === name) ?? this.entries[0] ?? null;
    if (this.sel !== null && !this.cur?.def.keys[this.sel]) this.sel = null;
    this.post({ type: 'studioAnims', anims: this.anims });
    this.postPivots();
    this.refreshList();
    this.refreshView();
  }

  private apply() {
    if (!this.dirty) return;
    if (this.host.apply(this.snap())) {
      this.baseline = JSON.stringify(this.doc());
      this.note.textContent = 'Applied to rig.json (Ctrl+Z in the editor undoes it; Ctrl+S saves).';
      this.refreshView();
    } else this.note.textContent = 'Could not write to rig.json; fix its errors first.';
  }

  // ---- the animation list ----
  private select(entry: Entry | null) {
    if (this.picking) this.setPicking(false);
    this.cur = entry;
    this.part = null;
    this.sel = null;
    this.playing = false;
    this.refreshList();
    this.refreshView();
    if (entry) this.seek(this.t);
  }

  private refreshList() {
    this.listEl.replaceChildren();
    let heading = '';
    for (const e of this.entries) {
      const group = e.preset ? 'Presets' : 'Of this character';
      if (group !== heading) { heading = group; this.listEl.append(el('h3', { textContent: group })); }
      const b = el('button', { type: 'button', textContent: e.name });
      b.setAttribute('aria-pressed', String(e === this.cur));
      b.addEventListener('click', () => this.select(e));
      this.listEl.append(b);
    }
  }

  /** Ask for a name in the dialog itself (browser prompts are not shown everywhere) and call `then` with it. */
  private askName(message: string, value: string, then: (name: string) => void) {
    const row = this.root.querySelector<HTMLFormElement>('.as-name')!, input = row.querySelector('input')!;
    row.querySelector('span')!.textContent = message;
    input.value = value;
    row.hidden = false;
    const done = () => { row.hidden = true; row.onsubmit = null; this.card.focus({ preventScroll: true }); };
    row.onsubmit = e => {
      e.preventDefault();
      const v = input.value.trim();
      if (!/^[\w-]+$/.test(v)) { this.note.textContent = 'A name has letters, digits, _ and - only.'; input.focus(); return; }
      done();
      then(v);
    };
    row.querySelector<HTMLButtonElement>('button[type="button"]')!.onclick = done;
    input.onkeydown = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(); } };
    input.focus();
    input.select();
  }
  private pick(name: string) { this.cur = this.entries.find(e => e.name === name) ?? this.cur; this.part = null; this.sel = null; this.refreshList(); this.refreshView(); this.seek(this.t); }

  private newAnimation() {
    this.askName('Name of the new animation', uniqueName(this.anims, 'anim'), name => {
      if (Object.hasOwn(this.anims, name)) { this.note.textContent = `${name} exists already.`; return; }
      this.edit(() => { this.anims = newAnim(this.anims, name).anims; });
      this.pick(name);
    });
  }
  private copyAnimation() {
    const c = this.cur;
    if (!c) return;
    this.askName(c.preset ? `Name of the editable copy of ${c.name} (${c.name} itself would replace the preset for this character)` : `Name of the copy of ${c.name}`,
      uniqueName(this.anims, c.preset ? `${c.name}-custom` : `${c.name}-copy`), name => {
        if (Object.hasOwn(this.anims, name) && Array.isArray(this.anims[name]?.keys)) { this.note.textContent = `${name} exists already.`; return; }
        this.edit(() => {
          if (c.preset) this.anims = { ...this.anims, [name]: bakePreset(c.name, 16)! };
          else { const d = duplicateAnim(this.anims, c.name); if (d) this.anims = renameAnim(d.anims, d.name, name) ?? d.anims; }
        });
        this.pick(name);
      });
  }
  private renameAnimation() {
    const c = this.cur;
    if (!c || c.preset) return;
    this.askName(`New name of ${c.name}`, c.name, name => {
      if (name === c.name) return;
      const renamed = renameAnim(this.anims, c.name, name);
      if (!renamed) { this.note.textContent = `${name} exists already.`; return; }
      this.edit(() => { this.anims = renamed; });
      this.pick(name);
    });
  }
  private deleteAnimation() {
    const c = this.cur;
    if (!c || c.preset) return;
    this.edit(() => { this.anims = deleteAnim(this.anims, c.name); });
    this.pick(this.entries[0]?.name ?? '');
  }

  // ---- keys ----
  private editable() { return !!this.cur && !this.cur.preset; }
  private selectedKey(): KeyDef | null { return this.sel === null ? null : this.cur?.def.keys[this.sel] ?? null; }

  /** Change the selected key; the key keeps its place in the selection even when `t` moves it past another. */
  private patchSelected(patch: Partial<KeyDef>) {
    const c = this.cur;
    if (!c || c.preset || this.sel === null) return;
    this.edit(() => {
      const r = setKey(c.def, this.sel!, patch);
      this.anims[c.name] = r.def;
      this.sel = r.index;
    });
  }
  private fieldChanged(name: 't' | KeyChannel, raw: string) {
    if (name === 't') { const t = Number(raw); if (raw !== '' && Number.isFinite(t)) this.patchSelected({ t }); else this.refreshView(); return; }
    const v = Number(raw);
    this.patchSelected({ [name]: raw === '' || !Number.isFinite(v) ? undefined : v });
  }
  private removeSelected() {
    const c = this.cur;
    if (!c || c.preset || this.sel === null) return;
    this.edit(() => { this.anims[c.name] = deleteKey(c.def, this.sel!); this.sel = null; });
  }
  /** Add a key of one channel at `t`, with `value` (and for the part being shown, its `part`). */
  private addKeyAt(ch: KeyChannel, t: number, value: number) {
    const c = this.cur;
    if (!c || c.preset) return;
    this.edit(() => {
      const key: KeyDef = { t, [ch]: Math.round(value * 10000) / 10000 };
      if (this.part) key.part = this.part;
      const r = addKey(c.def, key);
      this.anims[c.name] = r.def;
      this.sel = r.index;
    });
  }
  private addAtPlayhead() {
    const c = this.cur;
    if (!c || c.preset) return;
    const ch = this.addCh.value as KeyChannel;
    const v = sampleChannel(c.def, ch, this.part, 120)[Math.round(this.t * 120)] ?? 0;
    this.addKeyAt(ch, this.t, v);
  }

  // ---- pointer and keyboard on the timeline ----
  private laneOf(y: number) { return Math.min(KEY_CHANNELS.length - 1, Math.max(0, Math.floor(y / LANE))); }
  private valueAt(ch: KeyChannel, y: number) {
    const i = KEY_CHANNELS.indexOf(ch), mid = i * LANE + LANE / 2;
    return ((mid - y) / (LANE / 2 - 8)) * (this.frozen?.[ch] ?? this.ranges[ch]);
  }
  private local(e: PointerEvent | MouseEvent) {
    const r = this.tl.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, t: Math.min(1, Math.max(0, (e.clientX - r.left - LABEL) / Math.max(1, r.width - LABEL - PAD))) };
  }

  private pointerDown(e: PointerEvent) {
    const key = (e.target as Element).closest<SVGElement>('[data-key]');
    this.tl.setPointerCapture(e.pointerId);
    let move: (m: PointerEvent) => void;
    if (key && this.editable()) {
      const ch = key.dataset.ch as KeyChannel;
      this.sel = Number(key.dataset.key);
      this.frozen = { ...this.ranges };
      const before = this.snap();
      move = m => {
        const p = this.local(m), c = this.cur!;
        const r = setKey(c.def, this.sel!, { t: p.t, [ch]: this.valueAt(ch, p.y) });
        this.anims[c.name] = r.def;
        this.sel = r.index;
        this.rebuild();
        this.cur = this.entries.find(en => en.name === c.name) ?? this.cur;
        this.post({ type: 'studioAnims', anims: this.anims });
        this.refreshView();
      };
      const up = () => {
        this.tl.removeEventListener('pointermove', move);
        this.tl.removeEventListener('pointerup', up);
        this.frozen = null;
        if (JSON.stringify(before) !== JSON.stringify(this.doc())) { this.past.push(before); this.future = []; this.changed(); }
        else this.refreshView();
      };
      this.tl.addEventListener('pointermove', move);
      this.tl.addEventListener('pointerup', up);
      this.refreshView();
      return;
    }
    if (this.cur?.preset) this.note.textContent = `${this.cur.name} is a preset and cannot be changed. Press "Edit copy" to make an editable version.`;
    else if (key) this.sel = Number(key.dataset.key);
    this.seek(this.local(e).t);
    move = m => this.seek(this.local(m).t);
    const up = () => { this.tl.removeEventListener('pointermove', move); this.tl.removeEventListener('pointerup', up); };
    this.tl.addEventListener('pointermove', move);
    this.tl.addEventListener('pointerup', up);
  }

  private addAtPointer(e: MouseEvent) {
    if (!this.editable() || (e.target as Element).closest('[data-key]')) return;
    const p = this.local(e), ch = KEY_CHANNELS[this.laneOf(p.y)];
    if (p.x < LABEL) return;
    this.addKeyAt(ch, p.t, this.valueAt(ch, p.y));
  }

  private diamondKey(e: KeyboardEvent) {
    const key = (e.target as Element).closest<SVGElement>('[data-key]');
    if (!key || !this.editable() || this.sel === null) return;
    const ch = key.dataset.ch as KeyChannel, big = e.shiftKey ? 5 : 1, k = this.selectedKey();
    let patch: Partial<KeyDef> | null = null;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') patch = { t: (k?.t ?? 0) + (e.key === 'ArrowRight' ? 1 : -1) * 0.01 * big };
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') patch = { [ch]: (k?.[ch] ?? 0) + (e.key === 'ArrowUp' ? 1 : -1) * NUDGE[ch] * big };
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.removeSelected(); return; }
    if (!patch) return;
    e.preventDefault();
    this.patchSelected(patch);
    this.tl.querySelector<SVGElement>(`[data-key="${this.sel}"][data-ch="${ch}"]`)?.focus();
  }

  // ---- parts that share a pivot ----
  private toggleShare() {
    const open = this.shareBox.hidden;
    this.shareBox.hidden = !open;
    this.pivotShare.setAttribute('aria-expanded', String(open));
    if (open) this.fillShare();
  }
  /** One checkbox for every other part; ticking it gives that part the pivot of the chosen one. */
  private fillShare() {
    const part = this.part;
    this.shareBox.replaceChildren();
    if (!part) { this.shareBox.append('Choose a part in "Lanes of" first.'); return; }
    const at = this.pivots[part];
    if (!at) { this.shareBox.append(`${part} has no pivot yet.`); return; }
    for (const other of this.host.parts.filter(p => p !== part)) {
      const same = this.pivots[other]?.[0] === at[0] && this.pivots[other]?.[1] === at[1];
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = same;
      const change = () => this.edit(() => { this.pivots = setPivots(this.pivots, [other], box.checked ? at : null); });
      box.onchange = change;
      this.shareBox.append(el('label', {}, box, other));
    }
  }

  // ---- how the stage dresses the character ----
  private dressStage() { this.post({ type: 'studioShow', pose: this.pose, overrides: this.overrides }); }
  private showDress() {
    this.poseSel.replaceChildren(el('option', { value: '', textContent: '(default)' }), ...this.host.poses.map(p => el('option', { value: p, textContent: p })));
    this.poseSel.value = this.pose ?? '';
    this.slotsEl.replaceChildren();
    for (const [slot, variants] of Object.entries(this.host.slots)) {
      const sel = document.createElement('select');
      sel.setAttribute('aria-label', `Variant of ${slot}`);
      sel.append(el('option', { value: '', textContent: '(pose)' }), ...['none', ...variants].map(v => el('option', { value: v, textContent: v })));
      sel.value = this.overrides[slot] ?? '';
      sel.onchange = () => {
        const { [slot]: _gone, ...rest } = this.overrides;
        this.overrides = sel.value ? { ...rest, [slot]: sel.value } : rest;
        this.dressStage();
        this.refreshView();
      };
      this.slotsEl.append(el('label', {}, `${slot} `, sel));
    }
  }

  // ---- idle, talking, blinking ----
  private showAuto() {
    const names = [...new Set([...Object.keys(this.anims).filter(n => Array.isArray(this.anims[n]?.keys)), ...Object.keys(ANIMS)])];
    for (const [sel, value] of [[this.idleSel, this.rig.idle], [this.speakSel, this.rig.speakAnim]] as const) {
      const all = value && !names.includes(value) ? [...names, value] : names; // a name the file has but nothing defines stays visible
      sel.replaceChildren(el('option', { value: '', textContent: '(none)' }), ...all.map(n => el('option', { value: n, textContent: n })));
      sel.value = value ?? '';
    }
    this.blinkBox.checked = this.rig.blink;
    const r = this.rig, a = this.auto;
    a.spSlot.value = r.speakSlot ?? '';
    a.spVars.value = r.speakVariants.join(', ');
    a.spRate.value = r.speakRate === null ? '' : String(r.speakRate);
    a.blSlot.value = r.blinkSlot ?? '';
    a.blVariant.value = r.blinkVariant ?? '';
    a.blMin.value = r.blinkEvery ? String(r.blinkEvery[0]) : '';
    a.blMax.value = r.blinkEvery ? String(r.blinkEvery[1]) : '';
    a.blDur.value = r.blinkDur === null ? '' : String(r.blinkDur);
    for (const k of ['blSlot', 'blVariant', 'blMin', 'blMax', 'blDur'] as const) a[k].disabled = !r.blink;
    this.root.querySelector('#as-slotnames')!.replaceChildren(...Object.keys(this.host.slots).map(n => el('option', { value: n })));
  }

  // ---- placing the character in a scene ----
  private setPlacing(on: boolean) {
    this.placing = on;
    if (on && this.picking) this.setPicking(false);
    this.placeBtn.setAttribute('aria-pressed', String(on));
    this.placeBtn.textContent = on ? 'Done placing' : 'Place on stage';
    this.sendPlace();
  }
  private sendPlace() {
    this.post({ type: 'studioPlace', on: this.placing, ...this.place });
    this.showPlace();
  }
  private showPlace() {
    const r = (v: number, d: number) => String(Math.round(v * 10 ** d) / 10 ** d);
    this.placeFields.x.value = r(this.place.x, 3);
    this.placeFields.y.value = r(this.place.y, 3);
    this.placeFields.scale.value = r(this.place.scale, 2);
    this.flipBox.checked = this.place.flip;
    const tok = anchorToken(this.place.anchor ?? FEET, this.host.anchors);
    this.anchorBox.value = tok === 'feet' ? '' : tok;
    this.placeLine.value = showLine(this.char, this.pose, this.place, this.host.positions, this.host.anchors);
  }

  // ---- transport ----
  /** Start or stop placing the pivot of the selected part by clicking on the stage. */
  private setPicking(on: boolean) {
    this.picking = on && !!this.part;
    if (this.picking && this.placing) this.setPlacing(false);
    if (this.picking) { this.playing = false; this.showTransport(); }
    this.post({ type: 'studioPick', part: this.picking ? this.part : null });
    this.showPivot();
  }
  private pivotTyped() {
    if (!this.part) return;
    const x = Number(this.pivotFields.x.value), y = Number(this.pivotFields.y.value);
    if (this.pivotFields.x.value === '' || this.pivotFields.y.value === '' || !Number.isFinite(x) || !Number.isFinite(y)) { this.showPivot(); return; }
    this.edit(() => { this.pivots = setPivot(this.pivots, this.part!, [x, y]); });
  }
  private showPivot() {
    const part = this.part, at = part ? this.pivots[part] : undefined;
    this.root.querySelector('.as-pivot-name')!.textContent = part ? `Pivot of ${part}` : 'Pivot';
    this.pivotFields.x.value = at ? String(at[0]) : '';
    this.pivotFields.y.value = at ? String(at[1]) : '';
    for (const f of Object.values(this.pivotFields)) f.disabled = !part;
    this.pivotBtn.disabled = !part;
    this.pivotClear.disabled = !at;
    if (!this.shareBox.hidden) this.fillShare();
    this.pivotBtn.textContent = this.picking ? 'Done picking' : 'Pick on stage';
    this.pivotBtn.setAttribute('aria-pressed', String(this.picking));
    this.root.querySelector('.as-pivot-hint')!.textContent = this.picking ? 'Click the stage where the part should turn. The character is shown at rest.'
      : part ? (at ? '' : 'No pivot: the part turns about the middle of its image.') : 'Choose a part in "Lanes of". The pivot is where the part turns and scales; in PSD pixels.';
  }

  private toggle() { if (this.playing) this.pause(); else this.play(); }
  private play() {
    if (!this.cur) return;
    if (this.picking) this.setPicking(false);
    this.playing = true;
    this.post({ type: 'studioPlay', name: this.cur.name, dur: this.cur.dur, loop: this.loopBox.checked, part: null });
    this.showTransport();
  }
  private pause() {
    this.playing = false;
    this.post({ type: 'studioPause' });
    this.showTransport();
  }
  private seek(t: number) {
    this.t = Math.min(1, Math.max(0, t));
    this.playing = false;
    if (this.picking) this.setPicking(false);
    if (this.cur) this.post({ type: 'studioSeek', name: this.cur.name, t: this.t });
    this.showTransport();
    this.showTime();
  }
  private showTransport() {
    this.playBtn.textContent = this.playing ? 'Pause' : 'Play';
    this.playBtn.setAttribute('aria-label', this.playing ? 'Pause' : 'Play');
  }
  private showTime() {
    const dur = this.cur?.dur ?? 1;
    this.slider.value = String(Math.round(this.t * 1000));
    this.time.textContent = `${(this.t * dur).toFixed(2)} / ${dur.toFixed(2)} s`;
    const x = this.xOf(this.t);
    this.playLine?.setAttribute('x1', String(x));
    this.playLine?.setAttribute('x2', String(x));
  }

  // ---- everything that depends on the animation or the selection ----
  private refreshView() {
    const c = this.cur, can = this.editable();
    this.title.textContent = `Animations: ${this.char}${this.dirty ? ' •' : ''}`;
    this.tools.undo.disabled = !this.past.length;
    this.tools.redo.disabled = !this.future.length;
    this.tools.apply.disabled = !this.dirty;
    this.tools.rename.disabled = this.tools.delete.disabled = !can;
    this.tools.copy.disabled = !c;
    this.tools.copy.textContent = c?.preset ? 'Edit copy' : 'Copy';
    this.durInput.disabled = !can;
    this.durInput.value = c ? String(c.dur) : '';
    const keyed = c ? animParts(c.def) : [];
    const parts = [...new Set([...this.host.parts, ...keyed])];
    if (this.part && !parts.includes(this.part)) this.part = null;
    const shown = this.host.shown?.(this.pose, this.overrides);
    const label = (p: string) => {
      const notes = [keyed.includes(p) ? 'has keys' : '', shown && !shown.includes(p) ? 'hidden in this pose' : ''].filter(Boolean);
      return notes.length ? `${p} (${notes.join(', ')})` : p;
    };
    this.partSel.replaceChildren(el('option', { value: '', textContent: 'the whole character' }),
      ...parts.map(p => el('option', { value: p, textContent: label(p) })));
    this.partSel.value = this.part ?? '';
    this.partSel.disabled = !parts.length;
    this.showPivot();
    this.showAuto();
    if (c?.preset) { this.note.textContent = `${c.name} is a preset (shown as a sampled copy; it plays exactly as in the game). "Edit copy" makes an editable version.`; this.presetNote = true; }
    else if (this.presetNote) { this.note.textContent = ''; this.presetNote = false; }
    this.refreshInspector();
    this.drawTimeline();
    this.showTransport();
  }

  private refreshInspector() {
    const c = this.cur, can = this.editable(), k = this.selectedKey();
    const keys = c ? keysOf(c.def, this.part) : [];
    this.keySel.replaceChildren(el('option', { value: '', textContent: keys.length ? '(none selected)' : '(no keys)' }),
      ...keys.map(({ index, key }) => el('option', { value: String(index), textContent: `t=${key.t}  ${KEY_CHANNELS.filter(ch => key[ch] !== undefined).map(ch => `${ch} ${key[ch]}`).join(', ')}` })));
    this.keySel.value = this.sel !== null && keys.some(x => x.index === this.sel) ? String(this.sel) : '';
    this.keySel.disabled = !keys.length;
    this.fields.t.value = k ? String(k.t) : '';
    for (const ch of KEY_CHANNELS) this.fields[ch].value = k?.[ch] !== undefined ? String(k[ch]) : '';
    this.easeSel.value = k?.ease ?? '';
    for (const f of [...Object.values(this.fields), this.easeSel, this.delKey]) f.disabled = !can || !k;
    this.addBtn.disabled = this.addCh.disabled = !can;
  }

  // ---- timeline ----
  private width() { return Math.max(320, this.tl.clientWidth); }
  private xOf(t: number) { return LABEL + t * (this.width() - LABEL - PAD); }

  private drawTimeline() {
    const w = this.width(), height = LANE * KEY_CHANNELS.length + AXIS;
    this.tl.setAttribute('viewBox', `0 0 ${w} ${height}`);
    this.tl.setAttribute('height', String(height));
    this.tl.replaceChildren();
    const def = this.cur?.def;
    if (!def) return;
    KEY_CHANNELS.forEach((ch, i) => {
      const top = i * LANE, mid = top + LANE / 2;
      const samples = sampleChannel(def, ch, this.part, 120);
      // A preset is only a sampled copy: its curve is shown, but no diamonds that look as if they could be moved.
      const keys = this.cur!.preset ? [] : keysOf(def, this.part).filter(k => typeof k.key[ch] === 'number');
      const own = Math.max(MIN_RANGE[ch], ...samples.map(Math.abs), ...keys.map(k => Math.abs(k.key[ch]!)));
      const range = this.frozen?.[ch] ?? own;
      this.ranges[ch] = range;
      const y = (v: number) => mid - (v / range) * (LANE / 2 - 8);
      this.tl.append(
        svg('rect', { x: 0, y: top, width: w, height: LANE, class: i % 2 ? 'tl-bg-b' : 'tl-bg-a' }),
        svg('line', { x1: LABEL, x2: w - PAD, y1: mid, y2: mid, class: 'tl-zero' }),
        svg('text', { x: 8, y: mid - 2, class: 'tl-label' }, ch),
        svg('text', { x: 8, y: mid + 12, class: 'tl-range' }, `±${+range.toPrecision(2)}`),
        svg('polyline', { points: samples.map((v, s) => `${this.xOf(s / 120)},${y(v)}`).join(' '), class: 'tl-curve' }),
      );
      for (const k of keys) {
        const on = k.index === this.sel;
        const d = svg('rect', {
          x: -5, y: -5, width: 10, height: 10, class: on ? 'tl-key tl-on' : 'tl-key', transform: `translate(${this.xOf(k.key.t)} ${y(k.key[ch]!)}) rotate(45)`,
          'data-key': k.index, 'data-ch': ch, tabindex: on ? 0 : -1, role: 'button',
          'aria-label': `${ch} key at t ${k.key.t}, value ${k.key[ch]}${this.editable() ? '. Arrows move it, Delete removes it' : ''}`,
        });
        d.append(svg('title', {}, `${ch} ${k.key[ch]} at t=${k.key.t}${k.key.ease ? `, ease ${k.key.ease}` : ''}`));
        this.tl.append(d);
      }
    });
    const dur = this.cur!.dur, base = LANE * KEY_CHANNELS.length;
    for (const f of [0, 0.25, 0.5, 0.75, 1]) {
      const x = this.xOf(f);
      this.tl.append(svg('line', { x1: x, x2: x, y1: 0, y2: base + 4, class: 'tl-grid' }),
        svg('text', { x, y: base + 16, class: 'tl-tick', 'text-anchor': f === 1 ? 'end' : f === 0 ? 'start' : 'middle' }, `${+(f * dur).toFixed(2)}s`));
    }
    this.playLine = svg('line', { x1: 0, x2: 0, y1: 0, y2: base, class: 'tl-play' });
    this.tl.append(this.playLine);
    this.showTime();
  }
}

type StudioTools = Record<'new' | 'copy' | 'rename' | 'delete' | 'undo' | 'redo' | 'apply', HTMLButtonElement>;
