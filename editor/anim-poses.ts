// The Poses section: pick a saved pose and use it, save the values on show as a new one, delete one, reset every parameter, and (Animate)
// key every changed parameter at the playhead. It works on the Parameters panel's hand-set values (ParamPanel.base, hold) through the
// panel's own methods, so a pose set here reads like one dragged there.
import { changedParams, type PoseDef } from '../engine/src/index.js';
import { el } from './anim-dom.js';
import type { ParamHost, ParamPanel } from './anim-params.js';

export interface PoseHost extends Pick<ParamHost, 'defs' | 'poses' | 'editable' | 'keying' | 'note'> {
  /** Save `values` as pose `name` (one undo step); the note to show. */
  savePose(name: string, values: Record<string, number>): string;
  /** Delete pose `name` (one undo step); the note to show. */
  deletePose(name: string): string;
}

export class PosePanel {
  private sel: HTMLSelectElement;
  private name: HTMLInputElement;
  private use: HTMLButtonElement;
  private del: HTMLButtonElement;
  private save: HTMLButtonElement;
  private keyAll: HTMLButtonElement;

  constructor(private root: HTMLElement, private params: ParamPanel, private host: PoseHost) {
    this.root.innerHTML = `
      <div class="apo-bar">
        <span class="apo-group"><select class="ap-pose-sel" aria-label="Poses"></select><button type="button" class="ap-pose-use">Use pose</button><button type="button" class="ap-pose-del" aria-label="Delete the chosen pose" title="Delete the chosen pose from rig.json">✕</button></span>
        <span class="apo-group"><input type="text" class="ap-pose-name" placeholder="pose name" size="12" spellcheck="false" autocomplete="off" aria-label="Name of the new pose"><button type="button" class="ap-pose-save" title="Save the values that differ from their defaults as a pose in rig.json">Save as pose</button></span>
        <span class="apo-group"><button type="button" class="ap-reset-all">Reset all</button><button type="button" class="ap-key-all" title="Key every parameter that differs from its default at the playhead">Key changed</button></span>
      </div>`;
    const q = <T extends Element>(s: string) => this.root.querySelector<T>(s)!;
    this.sel = q('.ap-pose-sel'); this.name = q('.ap-pose-name');
    this.use = q('.ap-pose-use'); this.del = q('.ap-pose-del'); this.save = q('.ap-pose-save'); this.keyAll = q('.ap-key-all');
    this.use.addEventListener('click', () => this.params.usePose(this.sel.value));
    this.save.addEventListener('click', () => {
      this.host.note(this.host.savePose(this.name.value.trim(), changedParams(this.host.defs(), this.params.values())));
    });
    this.del.addEventListener('click', () => { if (this.sel.value) this.host.note(this.host.deletePose(this.sel.value)); });
    q('.ap-reset-all').addEventListener('click', () => this.params.resetAll());
    this.keyAll.addEventListener('click', () => this.params.keyChanged());
  }

  /** What the section shows beside its title. */
  static summary(poses: Record<string, PoseDef>): string {
    const n = Object.keys(poses).length;
    return n ? `${n} pose${n === 1 ? '' : 's'}` : 'none';
  }

  /** Redraw from the rig's poses and the studio's state (the list, which buttons can act). */
  sync() {
    const poses = Object.keys(this.host.poses());
    const was = this.sel.value;
    this.sel.replaceChildren(el('option', { value: '', textContent: poses.length ? '(poses)' : '(no poses yet)' }), ...poses.map(n => el('option', { value: n, textContent: n })));
    this.sel.value = poses.includes(was) ? was : '';
    const none = this.host.defs().length === 0;
    this.use.disabled = this.del.disabled = !poses.length;
    this.save.disabled = none;
    this.keyAll.disabled = !this.host.editable();
    this.root.classList.toggle('ap-nokey', !this.host.keying());
  }
}
