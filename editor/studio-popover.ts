// A small panel that opens under a ▾ button of the studio's tool options bar (Set value, Mirror, Same pivot for…). It takes its own
// Esc before the studio does (engine/src/studio-keys.ts: an open popover first), giving the focus back to its button; a press outside
// it, or a second press of its button, closes it too. The panel stays in the bar's markup, so its controls keep their handlers.

export class Popover {
  private onOpen: (() => void) | undefined;

  constructor(readonly button: HTMLButtonElement, readonly panel: HTMLElement, onOpen?: () => void) {
    this.onOpen = onOpen;
    panel.hidden = true;
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-expanded', 'false');
    if (!panel.id) panel.id = `pop-${Math.random().toString(36).slice(2, 8)}`;
    button.setAttribute('aria-controls', panel.id);
    button.addEventListener('click', () => (this.isOpen ? this.close() : this.open()));
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !this.isOpen) return;
      e.preventDefault();
      e.stopPropagation();
      this.close();
      button.focus({ preventScroll: true });
    };
    panel.addEventListener('keydown', esc);
    button.addEventListener('keydown', esc);
    document.addEventListener('pointerdown', e => {
      if (this.isOpen && !panel.contains(e.target as Node) && !button.contains(e.target as Node)) this.close();
    }, true);
  }

  get isOpen() { return !this.panel.hidden; }

  open() {
    this.panel.hidden = false;
    this.button.setAttribute('aria-expanded', 'true');
    this.onOpen?.();
  }

  close() {
    if (!this.isOpen) return;
    this.panel.hidden = true;
    this.button.setAttribute('aria-expanded', 'false');
  }
}
