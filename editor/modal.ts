// Keyboard behaviour shared by the editor's modal dialogs (Build, Translations, Voice, Help, Outline, Theme, Commit, asset viewer).
// Their own handlers cover Esc while focus is inside; this covers the rest: Tab stays in the dialog, focus that lands behind it
// (or on nothing, e.g. after a button disables itself) is pulled back, and Esc closes it from wherever focus is.

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/** The tab stops inside `root`, in document order (hidden ones left out). */
export function tabStops(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => el.getClientRects().length > 0);
}

/** For a dialog that handles its own keys: Tab (`e`) wraps from the last tab stop in `card` to the first and back, and comes back in from outside. */
export function wrapTab(e: KeyboardEvent, card: HTMLElement) {
  const stops = tabStops(card);
  if (!stops.length) { e.preventDefault(); return; }
  const first = stops[0], last = stops[stops.length - 1], at = document.activeElement;
  if (e.shiftKey && (at === first || at === card)) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
  else if (!card.contains(at)) { e.preventDefault(); first.focus(); }
}

/** A native <dialog> (editor/ask.ts) is on top: it handles its own focus and Esc. */
const nativeDialogOpen = () => !!document.querySelector('dialog[open]');

const mounted: HTMLElement[] = [];
/** Whether a dialog made with mountModal is open. */
export const anyModalOpen = () => mounted.some(root => !root.hidden);

/**
 * The frame every modal dialog of the editor shares: a hidden `#id` element holding `html`, appended to `host`. A press on its
 * backdrop, its `.close` button and Esc (unless `escape` is false: the dialog handles Esc itself) run `close`, and focus stays
 * inside while it shows (unless `trap` is false). Returns the root and a querySelector on it.
 */
export function mountModal(host: HTMLElement, id: string, html: string, close: () => void, { escape = true, trap = true } = {}) {
  const root = document.createElement('div');
  root.id = id;
  root.hidden = true;
  root.innerHTML = html;
  host.append(root);
  mounted.push(root);
  const q = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
  root.addEventListener('mousedown', e => { if (e.target === root) close(); });
  root.querySelector('.close')?.addEventListener('click', () => close());
  if (escape) root.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } });
  if (trap) trapModal(root, close);
  return { root, q };
}

/** Trap keyboard focus in `root` while it is visible; `close` runs on Esc that no control inside handled. */
export function trapModal(root: HTMLElement, close: () => void) {
  const active = () => !root.hidden && !nativeDialogOpen();
  const enter = (last = false) => {
    const stops = tabStops(root);
    (stops[last ? stops.length - 1 : 0] ?? root.querySelector<HTMLElement>('[role="dialog"]') ?? root).focus({ preventScroll: true });
  };
  document.addEventListener('keydown', e => {
    if (!active()) return;
    if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab' || e.ctrlKey || e.altKey || e.metaKey) return;
    const stops = tabStops(root), at = document.activeElement as HTMLElement | null;
    if (!stops.length || !at || !root.contains(at)) { e.preventDefault(); enter(e.shiftKey); return; }
    if (e.shiftKey && at === stops[0]) { e.preventDefault(); enter(true); }
    else if (!e.shiftKey && at === stops[stops.length - 1]) { e.preventDefault(); enter(); }
  });
  document.addEventListener('focusin', e => {
    if (active() && !root.contains(e.target as Node)) enter();
  });
}
