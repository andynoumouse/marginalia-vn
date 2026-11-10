// The sub-blocks of the animation studio's Properties section in Model mode (docs/design/studio-inspector.md, step 4): Transform, Deform,
// Skin, Clip and Variants. Each is a head line (a chevron, its name, a summary, a compact picker, then its verbs as icon buttons) and a
// body that the panels fill (the Pivot row and the tree's bone rows in Transform, anim-warp.ts in Deform, anim-weights.ts in Skin,
// anim-mask.ts in Clip, the tree's variant chips in Variants). What shows, what opens by itself and what the line says is
// engine/src/studio-inspector.ts `propBlocks`; the studio keeps the open flags and the rule that folds a sub-block the tool opened. This
// draws the frames and wires their heads and verbs.

import type { PropBlock, PropBlockId, PropBlocksView, PropVerb, PropVerbId } from '../engine/src/index.js';
import { iconButton, type IconName } from './studio-icons.js';

export interface PropsHost {
  view(): PropBlocksView;
  isOpen(id: PropBlockId): boolean;
  /** The author folded or opened a sub-block by its head. */
  toggle(id: PropBlockId): void;
  verb(id: PropVerbId): void;
}

/**
 * Each verb's icon, and the class the tests and the stage's other code know it by. `inPick`: the verb is the picker its panel puts in the
 * line's pick slot (Skin's Bind ▾ binds the bone chosen), so the line gives that picker the verb's enabled state and tooltip instead of a button.
 */
const VERBS: Record<PropVerbId, { icon: IconName; cls: string } | { inPick: true }> = {
  newShape: { icon: 'shape-new', cls: 'am-new' },
  removeClip: { icon: 'unclip', cls: 'am-remove' },
  deleteShape: { icon: 'trash', cls: 'am-delete' },
  removeBone: { icon: 'trash', cls: 'as-bone-del' },
  addWarp: { icon: 'warp-add', cls: 'aw-addbtn' },
  addGroupWarp: { icon: 'warp-group', cls: 'aw-groupbtn' },
  removeWarp: { icon: 'unwarp', cls: 'aw-remove' },
  bind: { inPick: true },
  removeSkin: { icon: 'unskin', cls: 'aw-unskin' },
};

/** The markup of one sub-block, with its body's inside; Transform has no chevron (it never folds). */
export function subBlockHtml(id: PropBlockId, title: string, body: string, fixed = false): string {
  const head = fixed
    ? `<span class="as-sub-head as-sub-fixed"><span class="as-sub-title">${title}</span><span class="as-sub-sum"></span></span>`
    : `<button type="button" class="as-sub-head" aria-expanded="false" aria-controls="as-sub-${id}"><span class="as-chev" aria-hidden="true"></span><span class="as-sub-title">${title}</span><span class="as-sub-sum"></span></button>`;
  return `<div class="as-sub" data-sub="${id}" hidden><div class="as-sub-line">${head}<span class="as-sub-warn" role="img" hidden>⚠</span><span class="as-sub-pick"></span><span class="as-sub-verbs"></span></div>`
    + `<div class="as-sub-body" id="as-sub-${id}" role="group" aria-label="${title}">${body}</div></div>`;
}

export class PropBlocksPanel {
  private drawn = new Map<string, string>(); // the verbs each head line shows, so they are rebuilt (and lose the focus) only when they change

  /** `root` holds the sub-blocks' markup (subBlockHtml) and the line shown while nothing is chosen (`.as-subs-empty`). */
  constructor(private root: HTMLElement, private host: PropsHost) {
    root.addEventListener('click', e => {
      const t = e.target as Element, head = t.closest<HTMLElement>('button.as-sub-head'), verb = t.closest<HTMLButtonElement>('.as-sub-verb');
      if (head && root.contains(head)) this.host.toggle(head.closest<HTMLElement>('.as-sub')!.dataset.sub as PropBlockId);
      else if (verb && !verb.disabled) this.host.verb(verb.dataset.verb as PropVerbId);
    });
  }

  /** The sub-block's elements: its head's pick slot is where a compact picker stands (Clip to ▾ once clipped, Target ▾, Bind ▾). */
  sub(id: PropBlockId) { return this.root.querySelector<HTMLElement>(`.as-sub[data-sub="${id}"]`)!; }
  pickSlot(id: PropBlockId) { return this.sub(id).querySelector<HTMLElement>('.as-sub-pick')!; }

  show() {
    const v = this.host.view();
    const empty = this.root.querySelector<HTMLElement>('.as-subs-empty');
    if (empty) { empty.textContent = v.empty; empty.hidden = !v.empty; }
    for (const b of v.blocks) this.showBlock(b);
  }

  private showBlock(b: PropBlock) {
    const sub = this.root.querySelector<HTMLElement>(`.as-sub[data-sub="${b.id}"]`);
    if (!sub) return;
    sub.hidden = !b.shown;
    if (!b.shown) return;
    const open = b.fixed || this.host.isOpen(b.id);
    sub.querySelector('button.as-sub-head')?.setAttribute('aria-expanded', String(open));
    sub.querySelector<HTMLElement>('.as-sub-body')!.hidden = !open;
    sub.dataset.open = String(open);
    const sum = sub.querySelector<HTMLElement>('.as-sub-sum')!;
    sum.textContent = b.summary;
    const warn = sub.querySelector<HTMLElement>('.as-sub-warn')!;
    warn.hidden = !b.warn;
    warn.title = b.warn ?? '';
    warn.setAttribute('aria-label', b.warn ? `Problem: ${b.warn}` : '');
    const pick = sub.querySelector<HTMLElement>('.as-sub-pick')!;
    pick.hidden = !b.pick;
    const verbs = [b.primary, b.destructive].filter((x): x is PropVerb => x !== null);
    for (const x of verbs) {
      const p = VERBS[x.id];
      if (!('inPick' in p)) continue;
      const ctl = pick.querySelector<HTMLSelectElement>('select');
      if (ctl) { ctl.disabled = !x.enabled; ctl.title = x.title; }
    }
    const buttons = verbs.filter(x => !('inPick' in VERBS[x.id]));
    const sig = JSON.stringify(buttons);
    if (this.drawn.get(b.id) === sig) return;
    this.drawn.set(b.id, sig);
    const box = sub.querySelector<HTMLElement>('.as-sub-verbs')!;
    box.innerHTML = buttons.map(x => { const p = VERBS[x.id] as { icon: IconName; cls: string }; return iconButton({ icon: p.icon, label: x.label, title: x.title, className: `as-sub-verb ${p.cls}`, data: { verb: x.id } }); }).join('');
    buttons.forEach((x, i) => { (box.children[i] as HTMLButtonElement).disabled = !x.enabled; });
  }
}
