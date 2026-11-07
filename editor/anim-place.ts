// The Place row of the animation studio: where the character stands in a scene (dragged on the stage or typed), and the
// `show` line that says so, to copy or insert into the script.

import { anchorToken, FEET, parseAnchor, showLine, type Placement } from '../engine/src/index.js';
import type { StudioHost } from './anim-studio.js';

export interface PlaceHost {
  /** The studio's current host (it changes with each opening). */
  studio(): StudioHost;
  /** What the line dresses: the character, its look and the slot variants set on the stage. */
  dress(): { char: string; pose: string | null; overrides: Record<string, string> };
  post(msg: object): void;
  note(text: string): void;
  /** Placing and picking a pivot exclude each other; this ends picking. */
  stopPicking(): void;
}

const START: Placement = { x: 0.5, y: 0, scale: 1, flip: false, anchor: FEET };

export class PlacePanel {
  placing = false;
  private place: Placement = { ...START };
  private btn: HTMLButtonElement;
  private fields: Record<'x' | 'y' | 'scale', HTMLInputElement>;
  private flipBox: HTMLInputElement;
  private anchorBox: HTMLInputElement;
  private line: HTMLInputElement;
  private insertBtn: HTMLButtonElement;

  constructor(root: HTMLElement, private host: PlaceHost) {
    const q = <T extends Element>(s: string) => root.querySelector<T>(s)!;
    this.btn = q('.as-place-btn');
    this.fields = { x: q('[data-pl="x"]'), y: q('[data-pl="y"]'), scale: q('[data-pl="scale"]') };
    this.flipBox = q('.as-flip');
    this.anchorBox = q('.as-anchor');
    this.line = q('.as-place-line');
    this.insertBtn = q('.as-place-insert');
    this.btn.addEventListener('click', () => this.setPlacing(!this.placing));
    for (const [k, input] of Object.entries(this.fields)) input.addEventListener('change', () => {
      const v = Number(input.value);
      if (input.value !== '' && Number.isFinite(v)) this.place = { ...this.place, [k]: k === 'scale' ? Math.max(0.05, v) : v };
      this.send();
    });
    this.flipBox.addEventListener('change', () => { this.place = { ...this.place, flip: this.flipBox.checked }; this.send(); });
    this.anchorBox.addEventListener('change', () => {
      try { this.place = { ...this.place, anchor: this.anchorBox.value.trim() === '' ? FEET : parseAnchor(this.anchorBox.value.trim(), host.studio().anchors) }; }
      catch (e) { host.note((e as Error).message); }
      this.send();
    });
    q('.as-place-copy').addEventListener('click', () => {
      this.line.select();
      void navigator.clipboard?.writeText(this.line.value).then(() => host.note('Copied the show line.'), () => host.note('Press Ctrl+C to copy the selected line.'));
    });
    this.insertBtn.addEventListener('click', () => host.note(host.studio().insertLine?.(this.line.value) ?? ''));
  }

  /** A new opening: the default place, and "Insert in script" only when the studio was opened from a script. */
  reset() {
    this.placing = false;
    this.place = { ...START };
    this.insertBtn.hidden = !this.host.studio().insertLine;
  }

  setPlacing(on: boolean) {
    this.placing = on;
    if (on) this.host.stopPicking();
    this.btn.setAttribute('aria-pressed', String(on));
    this.btn.textContent = on ? 'Done placing' : 'Place on stage';
    this.send();
  }

  /** The stage reports a drag of the character. */
  placed(x: number, y: number) {
    this.place = { ...this.place, x, y };
    this.show();
  }

  send() {
    this.host.post({ type: 'studioPlace', on: this.placing, ...this.place });
    this.show();
  }

  show() {
    const r = (v: number, d: number) => String(Math.round(v * 10 ** d) / 10 ** d);
    const { x, y, scale, flip, anchor } = this.place;
    this.fields.x.value = r(x, 3);
    this.fields.y.value = r(y, 3);
    this.fields.scale.value = r(scale, 2);
    this.flipBox.checked = flip;
    const { anchors, positions } = this.host.studio();
    const tok = anchorToken(anchor ?? FEET, anchors);
    this.anchorBox.value = tok === 'feet' ? '' : tok;
    const { char, pose, overrides } = this.host.dress();
    this.line.value = showLine(char, pose, this.place, positions, anchors, overrides);
  }
}
