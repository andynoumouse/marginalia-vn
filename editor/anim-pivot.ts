// The Pivot row of the animation studio: the pivot of the chosen part or bone as two fields, picking it on the stage,
// clearing it, and giving other parts the same pivot. The studio keeps the working copy; this works through `PivotHost`.

import type { Pivots } from '../engine/src/index.js';
import { el } from './anim-dom.js';

export interface PivotState {
  /** The part or bone chosen. */
  part: string | null;
  /** Its pivot, if it has one of its own. */
  at: [number, number] | undefined;
  /** Chosen name is a bone (and no part): its pivot is the bone's, and pivots cannot be shared. */
  isBone: boolean;
  /** The stage waits for a click that places the pivot. */
  picking: boolean;
  pivots: Pivots;
  /** Every part of the character. */
  parts: string[];
}

export interface PivotHost {
  state(): PivotState;
  /** Start or stop picking on the stage. */
  setPicking(on: boolean): void;
  /** Set the chosen part's pivot as one undo step. */
  setPivot(at: [number, number]): void;
  /** Clear it (ends picking first). */
  clear(): void;
  /** Give `part` the pivot `at`, or take its own away (null), as one undo step. */
  share(part: string, at: [number, number] | null): void;
}

export class PivotPanel {
  private name: HTMLElement;
  private hint: HTMLElement;
  private pickBtn: HTMLButtonElement;
  private fields: Record<'x' | 'y', HTMLInputElement>;
  private clearBtn: HTMLButtonElement;
  private shareBtn: HTMLButtonElement;
  private shareBox: HTMLElement;

  constructor(root: HTMLElement, private host: PivotHost) {
    const q = <T extends Element>(s: string) => root.querySelector<T>(s)!;
    this.name = q('.as-pivot-name');
    this.hint = q('.as-pivot-hint');
    this.pickBtn = q('.as-pick');
    this.fields = { x: q('[data-p="x"]'), y: q('[data-p="y"]') };
    this.clearBtn = q('.as-pivot-clear');
    this.shareBtn = q('.as-pivot-share');
    this.shareBox = q('.as-share');
    this.shareBtn.addEventListener('click', () => this.toggleShare());
    this.pickBtn.addEventListener('click', () => host.setPicking(!host.state().picking));
    this.clearBtn.addEventListener('click', () => host.clear());
    for (const axis of ['x', 'y'] as const) this.fields[axis].addEventListener('change', () => this.typed());
  }

  /** A new opening: the list of parts to share with is closed. */
  reset() { this.shareBox.hidden = true; }

  private typed() {
    const { part } = this.host.state();
    if (!part) return;
    const x = Number(this.fields.x.value), y = Number(this.fields.y.value);
    if (this.fields.x.value === '' || this.fields.y.value === '' || !Number.isFinite(x) || !Number.isFinite(y)) { this.show(); return; }
    this.host.setPivot([x, y]);
  }

  show() {
    const { part, at, isBone, picking } = this.host.state();
    this.name.textContent = part ? `Pivot of ${part}` : 'Pivot';
    this.fields.x.value = at ? String(at[0]) : '';
    this.fields.y.value = at ? String(at[1]) : '';
    for (const f of Object.values(this.fields)) f.disabled = !part;
    this.pickBtn.disabled = !part;
    this.clearBtn.disabled = !at;
    this.shareBtn.disabled = part !== null && isBone;
    if (!this.shareBox.hidden) this.fillShare();
    this.pickBtn.textContent = picking ? 'Done picking' : 'Pick on stage';
    this.pickBtn.setAttribute('aria-pressed', String(picking));
    this.hint.textContent = picking ? 'Click the stage where the part should turn. The character is shown at rest.'
      : part ? (at ? '' : isBone ? "No pivot of its own: the bone turns about its parent's pivot, else the middle of its parts." : 'No pivot: the part turns about the middle of its image.') : 'Choose a part or a bone in the tree. The pivot is where it turns and scales; in PSD pixels.';
  }

  private toggleShare() {
    const open = this.shareBox.hidden;
    this.shareBox.hidden = !open;
    this.shareBtn.setAttribute('aria-expanded', String(open));
    if (open) this.fillShare();
  }

  /** One checkbox for every other part; ticking it gives that part the pivot of the chosen one. */
  private fillShare() {
    const { part, pivots, parts } = this.host.state();
    this.shareBox.replaceChildren();
    if (!part) { this.shareBox.append('Choose a part in the tree first.'); return; }
    const at = pivots[part];
    if (!at) { this.shareBox.append(`${part} has no pivot yet.`); return; }
    for (const other of parts.filter(p => p !== part)) {
      const same = pivots[other]?.[0] === at[0] && pivots[other]?.[1] === at[1];
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = same;
      box.onchange = () => this.host.share(other, box.checked ? at : null);
      this.shareBox.append(el('label', {}, box, other));
    }
  }
}
