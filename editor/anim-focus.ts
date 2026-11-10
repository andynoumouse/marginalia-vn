// Keeping the keyboard focus in the animation studio. Panels redraw by replacing their controls (a key button, a bone chip, the whole
// parameter palette), and a focused control that is replaced takes the focus with it to the page body, where the studio's keys (W, E, R,
// Ctrl+Z, Esc) no longer reach. The keeper remembers the control that had the focus and, after a redraw, focuses its replacement: the
// control of the same kind, data and text in the same section, or the one at its place (engine/src/studio-keys.ts `refocusIndex`).
// It also remembers what each field held when it took the focus or last committed, so Esc can put back a typed edit and Ctrl+Z can
// tell typing from the studio's undo.
import { refocusIndex } from '../engine/src/index.js';

const FOCUSABLE = 'button, input, select, textarea, a[href], [tabindex]';
/** Where a replacement is looked for: the control's section, the timeline, the transport row, a tool-row group, a panel of the tool options bar, the focus header or the header. */
const ZONE = '[data-sect], .as-timeline, .as-transport, .as-gz-group, .atb, .as-focus, header';

type Focusable = HTMLElement | SVGElement;
type Field = HTMLInputElement | HTMLTextAreaElement;

const usable = (e: Element): boolean =>
  (e as HTMLElement | SVGElement).tabIndex >= -1 && !(e as HTMLButtonElement).disabled && e.getClientRects().length > 0 && !e.closest('[hidden], [inert]');

/** A control's identity across a redraw: its tag, first class, data, accessible name, and its text (or, for a field, its label's text). */
function sigOf(e: Focusable): string {
  const data = Object.entries(e.dataset).map(([k, v]) => `${k}=${v}`).join(',');
  const words = e instanceof HTMLInputElement || e instanceof HTMLSelectElement || e instanceof HTMLTextAreaElement
    ? `${e.type}:${e.closest('label')?.firstChild?.textContent?.trim() ?? ''}` : (e.textContent ?? '').trim();
  return `${e.tagName}|${e.classList[0] ?? ''}|${data}|${e.getAttribute('aria-label') ?? ''}|${words.slice(0, 40)}`;
}

export const isField = (t: EventTarget | null): t is Field =>
  (t instanceof HTMLInputElement && t.type !== 'range' && t.type !== 'checkbox' && t.type !== 'radio') || t instanceof HTMLTextAreaElement;

export class FocusKeeper {
  private last: { el: Focusable; zone: Element; sig: string; index: number } | null = null;
  private values = new WeakMap<Field, string>();
  /** A Tab pressed in a field, while its commit may redraw the controls Tab was going to: the focus then goes one step on from the field's replacement. */
  private tab: { from: Element; back: boolean } | null = null;

  /** `root` is the studio, `card` the dialog that takes the focus when nothing else can. */
  constructor(private root: HTMLElement, private card: HTMLElement) {
    root.addEventListener('keydown', e => {
      if (e.key !== 'Tab' || !isField(e.target)) return;
      this.tab = { from: e.target, back: e.shiftKey };
      setTimeout(() => { this.tab = null; });
    }, true);
    root.addEventListener('focusin', e => this.note(e.target));
    root.addEventListener('change', e => { if (isField(e.target)) this.values.set(e.target, e.target.value); }, true);
    new MutationObserver(() => this.restore()).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'hidden'] });
  }

  /** A new opening: what had the focus before belongs to the last one. */
  forget() { this.last = null; }

  /** Has the field an edit typed and not committed yet? */
  dirty(f: Field): boolean { const v = this.values.get(f); return v !== undefined && v !== f.value; }
  /** Put back what the field held before the typing (Esc). */
  revert(f: Field) { const v = this.values.get(f); if (v !== undefined) f.value = v; }

  private focusables(zone: Element): Focusable[] {
    return [...zone.querySelectorAll<Focusable>(FOCUSABLE)].filter(usable);
  }
  private note(t: EventTarget | null) {
    if (!(t instanceof HTMLElement || t instanceof SVGElement) || t === this.card || t === this.root) return;
    if (isField(t)) this.values.set(t, t.value);
    const zone = t.closest(ZONE) ?? this.card;
    this.last = { el: t, zone, sig: sigOf(t), index: this.focusables(zone).indexOf(t) };
  }

  /**
   * Called after every redraw: when the focus fell to the page, onto a control that is now disabled or hidden, or onto the card because
   * of that, give it to the replacement of the control that had it, or to the card.
   */
  restore() {
    if (this.root.hidden) return;
    const a = document.activeElement, onCard = a === this.card;
    // Focus somewhere else on purpose (a confirmation dialog the studio opened) is not lost.
    if (!(!a || a === document.body || onCard || (this.root.contains(a) && !usable(a)))) return;
    const l = this.last;
    // The card was focused on purpose (an inline form closed, the studio opened) while the last control is still there: leave it.
    if (onCard && (!l || (l.el.isConnected && usable(l.el)))) return;
    // The control is still there (a panel that fills its fields in place): it takes the focus back, or a Tab from it goes one step on.
    if (l && l.el.isConnected && usable(l.el) && this.tab?.from !== l.el) { l.el.focus({ preventScroll: true }); return; }
    if (l) {
      const zone = l.zone.isConnected ? l.zone : this.card, list = this.focusables(zone), here = list.indexOf(l.el);
      let i = here >= 0 ? here : refocusIndex(l.sig, l.index, list.map(e => ({ sig: sigOf(e), usable: true })));
      if (i >= 0 && this.tab?.from === l.el) i = Math.max(0, Math.min(list.length - 1, i + (this.tab.back ? -1 : 1)));
      this.tab = null;
      if (i >= 0) { list[i].focus({ preventScroll: true }); return; }
    }
    if (!onCard) this.card.focus({ preventScroll: true });
  }
}
