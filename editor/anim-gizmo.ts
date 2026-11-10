// The tool row over the studio's stage: which gizmo tool is on (Move / Rotate / Scale, and Pivot, Warp, Weights and Mask in Model mode),
// local or world axes, auto-key and the Key button; and, in the Selection section, the exact values of the chosen part or bone.
// The stage page draws and drags the gizmo (preview/studio-gizmo.ts) and reports a finished drag as a delta; this hands it on
// as one undo step: a key at the playhead in Animate mode, a keyform of the active parameter at its current value in Model mode.
// (The pivot is placed with the Pivot tool, by a click or drag on the stage, not with the gizmo.) The studio keeps the working
// copy; this works through `GizmoHost`.

import {
  addKey, escapesToMove, isNoOffset, keyedOffset, keyFromDelta, NO_OFFSET, sumOffset,
  type AnimDef, type GizmoSpace, type GizmoTool, type KeyChannel, type Offset, type StudioMode,
} from '../engine/src/index.js';

/** Pivot, Warp and Mask are for Model mode: the pivot cross, the lattice of the part's mesh warp (Keyforms shows the keyform they write to), and the points of a drawn mask. */
export type StageTool = GizmoTool | 'pivot' | 'warp' | 'weights' | 'mask';
/** The tools only Model mode has (they draw no transform gizmo). */
const MODEL_TOOLS: readonly StageTool[] = ['pivot', 'warp', 'weights', 'mask'];
const TOOL_KEYS: Record<string, StageTool> = { w: 'move', e: 'rotate', r: 'scale', q: 'pivot', d: 'warp', b: 'weights', m: 'mask' };
const FIELDS: KeyChannel[] = ['x', 'y', 'scale', 'rot', 'opacity'];

export interface GizmoHost {
  mode(): StudioMode;
  /** The chosen part or bone. */
  part(): string | null;
  /** What the gizmo moves: in Model mode a chosen part on a bone gives the bone (the part stays chosen for the deform sections); else the chosen row. */
  subject(): string | null;
  /** Would a drag of the gizmo be thrown away (no parameter, the subject unbound, no animation or a preset)? The stage draws no handles then. */
  locked(): boolean;
  t(): number;
  anim(): { name: string; def: AnimDef; preset: boolean; dur?: number } | null;
  post(msg: object): void;
  note(text: string): void;
  /** Change the working copy as one undo step. */
  edit(fn: () => void): void;
  setAnim(name: string, def: AnimDef): void;
  /** The tool changed: Model mode places pivots only with the Pivot tool, shows the lattice only with the Warp tool and the points of a drawn mask only with the Mask tool. */
  toolChanged(): void;
  /** Auto-key was turned on or off: the tool options bar says whether a drag keys. */
  autoChanged?(): void;
  /** Model mode: a finished gizmo drag of `name`, `delta` on top of the pose on show. The studio writes it as the keyform of the active parameter at its value (one undo step). */
  keyformDrag(name: string, tool: GizmoTool, delta: Offset): void;
  undo(): void;
  redo(): void;
  /** The Weights tool's test pose: which gizmo to show (null: none) and on which bone (its active one). Drags with it are kept as unkeyed offsets, never written. */
  weights?(): { tool: GizmoTool | null; bone: string | null };
  /** The test pose changed (a drag, or Reset pose). */
  posed?(): void;
}

export class GizmoBar {
  tool: StageTool = 'move';
  private space: GizmoSpace = 'local';
  private auto = true;
  /** Drags not keyed yet (auto-key off): the stage shows them on top of the pose. */
  private pending = new Map<string, { tool: GizmoTool; delta: Offset }[]>();
  private sent = '';
  private buttons: HTMLButtonElement[];
  private fields: Record<KeyChannel, HTMLInputElement>;
  private keyBtn: HTMLButtonElement;
  private worldBtn: HTMLButtonElement;
  private autoBtn: HTMLButtonElement;
  private nameEl: HTMLElement;

  constructor(root: HTMLElement, private host: GizmoHost) {
    const q = <T extends Element>(s: string) => root.querySelector<T>(s)!;
    this.buttons = [...root.querySelectorAll<HTMLButtonElement>('[data-gz]')];
    this.fields = Object.fromEntries(FIELDS.map(c => [c, q<HTMLInputElement>(`[data-g="${c}"]`)])) as Record<KeyChannel, HTMLInputElement>;
    this.keyBtn = q('.as-gz-key');
    this.worldBtn = q('.as-gz-world');
    this.autoBtn = q('.as-gz-auto');
    this.nameEl = q('.as-gz-name');
    for (const b of this.buttons) b.addEventListener('click', () => this.setTool(b.dataset.gz as StageTool));
    this.worldBtn.addEventListener('click', () => this.toggleWorld());
    this.autoBtn.addEventListener('click', () => { this.auto = !this.auto; if (this.auto) this.commit(); this.show(); this.host.autoChanged?.(); });
    this.keyBtn.addEventListener('click', () => this.commit());
    q('.as-gz-fit').addEventListener('click', () => host.post({ type: 'studioView', whole: false }));
    for (const c of FIELDS) this.fields[c].addEventListener('change', () => this.typed(c));
  }

  /** A new opening or a change of mode. */
  setMode(mode: StudioMode) {
    // Model keeps the tool it has (it starts on Move: a click on the stage picks parts to bind; the Pivot tool is one key away); Animate has no Pivot, Warp or Mask.
    this.tool = mode === 'model' ? this.tool : MODEL_TOOLS.includes(this.tool) ? 'move' : this.tool;
    this.clearPending();
    this.sent = '';
  }

  /** Does a drag in Animate write a key at once (Auto-key on)? */
  get autoKey() { return this.auto; }

  /** Is anything posed and not keyed (a test pose, or a drag with Auto-key off)? */
  get hasPending() { return this.pending.size > 0; }

  setTool(tool: StageTool) {
    if (this.tool === 'weights' && tool !== 'weights') this.clearPending(); // leaving the Weights tool lets go of the test pose
    const mode = this.host.mode();
    if (mode === 'animate' && MODEL_TOOLS.includes(tool)) {
      this.host.note(`The ${tool === 'warp' ? 'Warp' : tool === 'mask' ? 'Mask' : tool === 'weights' ? 'Weights' : 'Pivot'} tool is for Model mode.`);
      return;
    }
    this.tool = tool;
    this.host.toolChanged();
    this.send();
    this.show();
  }

  /** A key typed on the stage page or in the dialog; true when it was one of ours. */
  key(key: string, ctrl: boolean, shift: boolean): boolean {
    if (ctrl) { if (key === 'y' || (key === 'z' && shift)) this.host.redo(); else if (key === 'z') this.host.undo(); else return false; return true; }
    if (Object.hasOwn(TOOL_KEYS, key)) { this.setTool(TOOL_KEYS[key]); return true; }
    // Esc on the stage with nothing selected in a deform tool (the stage page decides that), or with any tool but Move: back to Move. On Move it closes the studio.
    if (key === 'escape') { if (escapesToMove(this.tool)) { this.setTool('move'); return true; } return false; }
    if (key === 'x') { this.toggleWorld(); return true; }
    // Animate: K writes the previewed drags at the playhead, Shift+K turns Auto-key on or off.
    if (key === 'k' && this.host.mode() === 'animate') { if (shift) this.autoBtn.click(); else if (this.pending.size) this.commit(); return true; }
    if (key === 'f') { this.host.post({ type: 'studioView', whole: shift }); return true; }
    return false;
  }

  private toggleWorld() {
    this.space = this.space === 'world' ? 'local' : 'world';
    this.worldBtn.setAttribute('aria-pressed', String(this.space === 'world'));
    this.send();
  }

  /** Tell the stage which tool is on and for what, and which stage mode the tool row is in (`stage`: what a press does there). */
  send() {
    // With the Weights tool the gizmo is the test pose's: on the panel's active bone, as the panel says (none by default).
    const w = this.tool === 'weights' ? this.host.weights?.() ?? null : null;
    const tool = this.tool === 'weights' ? w?.tool ?? null : MODEL_TOOLS.includes(this.tool) ? null : this.tool;
    // A gizmo whose drag would be thrown away at the release is locked: no handles (docs/design/studio-locked-gizmo.md). Never the test pose's.
    const lock = this.tool !== 'weights' && tool !== null && this.host.locked();
    const msg = { type: 'studioGizmo', tool, name: this.tool === 'weights' ? w?.bone ?? null : this.host.subject(), space: this.space, stage: this.tool, lock };
    const s = JSON.stringify(msg);
    if (s === this.sent) return;
    this.sent = s;
    this.host.post(msg);
  }
  resend() { this.sent = ''; this.send(); this.postExtra(); }

  // ---- drags ----
  event(m: { phase: 'start' | 'move' | 'end'; name: string; tool: GizmoTool; delta: Offset }) {
    if (m.phase !== 'end') return; // the stage shows the drag as it goes; the working copy changes once, at the release
    if (this.host.mode() !== 'animate') {
      if (this.tool === 'weights') {
        // The test pose: the stage shows the drag on top of the pose; nothing is keyed or written, and Reset pose lets it go.
        if (!isNoOffset(m.delta)) this.pending.set(m.name, [...(this.pending.get(m.name) ?? []), { tool: m.tool, delta: m.delta }]);
        this.postExtra();
        this.host.posed?.();
        return;
      }
      if (!isNoOffset(m.delta)) this.host.keyformDrag(m.name, m.tool, m.delta);
      this.postExtra(); // ends the drag on the stage; the written keyform is what it shows now
      return;
    }
    const a = this.host.anim();
    if (!a || a.preset) {
      this.host.note(a ? `${a.name} is a preset and cannot be keyed. Press "Edit copy" to make an editable version.` : 'Choose an animation first.');
      this.postExtra();
      return;
    }
    if (isNoOffset(m.delta)) { this.postExtra(); return; }
    if (this.auto) this.host.edit(() => { this.host.setAnim(a.name, keyFromDelta(a.def, m.name, this.host.t(), m.tool, m.delta)); });
    else {
      this.pending.set(m.name, [...(this.pending.get(m.name) ?? []), { tool: m.tool, delta: m.delta }]);
      this.host.note('Not keyed yet: press Key to write it at the playhead (or turn Auto-key on).');
    }
    this.postExtra();
    this.show();
  }

  /** Write the pending drags as keys at the playhead (one undo step). */
  commit() {
    const a = this.host.anim();
    if (!this.pending.size) return;
    if (!a || a.preset) { this.host.note('Nothing to key into: choose an editable animation.'); return; }
    const t = this.host.t(), todo = [...this.pending];
    this.pending.clear();
    this.host.edit(() => {
      let def = a.def;
      for (const [name, pieces] of todo) for (const p of pieces) def = keyFromDelta(def, name, t, p.tool, p.delta);
      this.host.setAnim(a.name, def);
    });
    const secs = a.dur !== undefined ? ` (${+(t * a.dur).toFixed(2)} s)` : '';
    this.host.note(`Keyed ${todo.map(([name]) => name).join(', ')} at the playhead${secs}.`);
    this.postExtra();
    this.show();
  }

  clearPending() {
    if (!this.pending.size) return;
    this.pending.clear();
    this.postExtra();
    this.host.posed?.();
  }

  private postExtra() {
    const extra: Record<string, Offset> = {};
    for (const [name, pieces] of this.pending) extra[name] = pieces.reduce((o, p) => sumOffset(o, p.delta), NO_OFFSET);
    this.host.post({ type: 'studioExtra', extra });
  }

  // ---- the fields ----
  private typed(c: KeyChannel) {
    const a = this.host.anim(), part = this.host.part(), input = this.fields[c];
    const v = Number(input.value);
    if (!a || a.preset || !part || input.value.trim() === '' || !Number.isFinite(v)) { this.show(); return; }
    this.host.edit(() => { this.host.setAnim(a.name, addKey(a.def, { t: this.host.t(), part, [c]: v }).def); });
  }

  show() {
    const mode = this.host.mode(), a = this.host.anim(), part = this.host.part();
    for (const b of this.buttons) b.setAttribute('aria-pressed', String(b.dataset.gz === this.tool));
    this.worldBtn.setAttribute('aria-pressed', String(this.space === 'world'));
    this.autoBtn.setAttribute('aria-pressed', String(this.auto));
    const can = mode === 'animate' && !!a && !a.preset && !!part;
    this.nameEl.textContent = part ? `${part}` : 'Nothing chosen: click a part on the stage, or choose it in the Parts tree';
    this.fields.x.closest('.as-gz-nums')?.classList.toggle('as-off', !part); // nothing chosen: the name line says what to do, no blank fields (ES-9)
    const o = a && part ? keyedOffset(a.def, part, this.host.t()) : NO_OFFSET;
    const shown: Record<KeyChannel, number> = { x: o.dx, y: o.dy, scale: o.sy, rot: o.rot, opacity: o.opacity ?? 1 };
    for (const c of FIELDS) {
      const input = this.fields[c];
      input.disabled = !can;
      if (document.activeElement !== input) input.value = a && part ? String(Math.round(shown[c] * 1e4) / 1e4) : '';
    }
    this.keyBtn.disabled = !this.pending.size;
  }
}
