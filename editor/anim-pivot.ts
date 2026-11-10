// The Pivot row of the animation studio (Properties, Transform): the pivot of the chosen part or bone as two fields; and, in the tool options bar with the
// Pivot tool (Q, which is the pick on the stage), clearing it and giving other parts the same pivot. The studio keeps the working copy;
// this works through `PivotHost`.

import type { Pivots, SetView } from '../engine/src/index.js';
import { el } from './anim-dom.js';
import { Popover } from './studio-popover.js';

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
  /** A Ctrl-click set: the fields show the pivot its parts share (blank when they differ), and a pivot typed is set on all of them. */
  set: SetView | null;
}

export interface PivotHost {
  state(): PivotState;
  /** Set the chosen part's pivot (a set's: every part's) as one undo step. */
  setPivot(at: [number, number]): void;
  /** Clear it (ends picking first). */
  clear(): void;
  /** Give `part` the pivot `at`, or take its own away (null), as one undo step. */
  share(part: string, at: [number, number] | null): void;
}

export class PivotPanel {
  private name: HTMLElement;
  private hint: HTMLElement;
  private fields: Record<'x' | 'y', HTMLInputElement>;
  private clearBtn: HTMLButtonElement;
  private shareBtn: HTMLButtonElement;
  private shareBox: HTMLElement;
  private share: Popover;

  /** `row` is the Pivot row of Properties' Transform sub-block, `bar` the Pivot panel of the tool options bar. */
  constructor(private row: HTMLElement, bar: HTMLElement, private host: PivotHost) {
    const root = row;
    const q = <T extends Element>(s: string) => root.querySelector<T>(s)!;
    this.name = q('.as-pivot-name');
    this.hint = q('.as-pivot-hint');
    this.fields = { x: q('[data-p="x"]'), y: q('[data-p="y"]') };
    this.clearBtn = bar.querySelector('.as-pivot-clear')!;
    this.shareBtn = bar.querySelector('.as-pivot-share')!;
    this.shareBox = bar.querySelector('.as-share')!;
    this.share = new Popover(this.shareBtn, this.shareBox, () => this.fillShare());
    this.clearBtn.addEventListener('click', () => host.clear());
    for (const axis of ['x', 'y'] as const) this.fields[axis].addEventListener('change', () => this.typed());
  }

  /** A new opening: the list of parts to share with is closed. */
  reset() { this.share.close(); }

  private typed() {
    const { part } = this.host.state();
    if (!part) return;
    const x = Number(this.fields.x.value), y = Number(this.fields.y.value);
    if (this.fields.x.value === '' || this.fields.y.value === '') return; // one typed into a blank row: wait for the other
    if (!Number.isFinite(x) || !Number.isFinite(y)) { this.show(); return; }
    this.host.setPivot([x, y]);
  }

  show() {
    const { part, at: own, isBone, picking, set } = this.host.state();
    this.name.textContent = 'Pivot'; // the focus header names the part
    const at = set ? set.pivot.value ?? undefined : own;
    this.fields.x.value = at ? String(at[0]) : '';
    this.fields.y.value = at ? String(at[1]) : '';
    for (const f of Object.values(this.fields)) f.disabled = !part;
    // A set clears every part's pivot; Same pivot gives one part's to others, which a set does by typing it.
    this.clearBtn.disabled = set ? !set.pivot.mixed && !at : !at;
    this.shareBtn.disabled = (part !== null && isBone) || !!set;
    if (this.shareBtn.disabled) this.share.close();
    if (this.share.isOpen) this.fillShare();
    // The hint is the row's tooltip (Transform has room for the two rows only); it is said in PSD pixels.
    const hint = set ? (picking ? `Click the stage where the ${set.label} should turn: each gets that pivot.` : set.pivot.mixed ? `The ${set.label} have different pivots: a pivot typed here is set on all of them (Ctrl+Z undoes it at once)` : at ? `Where the ${set.label} turn and scale, in PSD pixels: a pivot typed here is set on all of them` : `None of the ${set.label} has a pivot: one typed here is set on all of them`)
      : picking ? 'Click the stage where the part should turn. The character is shown at rest.'
      : part ? (at ? 'Where it turns and scales, in PSD pixels (the Pivot tool, Q, places it on the stage)' : isBone ? "No pivot of its own: the bone turns about its parent's pivot, else the middle of its parts." : 'No pivot: the part turns about the middle of its image (Q places one).') : 'Choose a part or a bone in the tree. The pivot is where it turns and scales; in PSD pixels.';
    this.hint.textContent = hint;
    this.row.title = hint;
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
