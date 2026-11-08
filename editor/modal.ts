// Keyboard behaviour shared by the editor's modal dialogs (Build, Translations, Voice, Help, Outline, Theme, Commit, asset viewer).
// Their own handlers cover Esc while focus is inside; this covers the rest: Tab stays in the dialog, focus that lands behind it
// (or on nothing, e.g. after a button disables itself) is pulled back, and Esc closes it from wherever focus is.

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/** The tab stops inside `root`, in document order (hidden ones left out). */
export function tabStops(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => el.getClientRects().length > 0);
}

/** A native <dialog> (editor/ask.ts) is on top: it handles its own focus and Esc. */
const nativeDialogOpen = () => !!document.querySelector('dialog[open]');

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
