// A small right-click menu (the files panel's). Opens at the pointer, or under the element when opened from the keyboard
// (Shift+F10, the Menu key); arrows move, Enter runs, Esc and any click elsewhere close it and give focus back.

export interface MenuItem {
  label: string;
  run(): void;
  disabled?: boolean;
  title?: string;
}
/** `null` draws a separator. */
export type MenuEntry = MenuItem | null;

export class ContextMenu {
  private el = document.createElement('div');
  private back: HTMLElement | null = null;

  constructor(host: HTMLElement) {
    this.el.className = 'ctxmenu';
    this.el.setAttribute('role', 'menu');
    this.el.hidden = true;
    host.append(this.el);
    this.el.addEventListener('keydown', e => this.key(e));
    // Capture: a click anywhere else closes the menu before that click does its own thing.
    document.addEventListener('pointerdown', e => { if (!this.el.hidden && !this.el.contains(e.target as Node)) this.close(false); }, true);
    window.addEventListener('blur', () => this.close(false));
    window.addEventListener('resize', () => this.close(false));
  }

  get isOpen() { return !this.el.hidden; }

  /** Shows `entries` for the `contextmenu` event `e` on `target`. */
  open(e: MouseEvent, target: HTMLElement, entries: MenuEntry[]) {
    e.preventDefault();
    this.back = document.activeElement as HTMLElement | null;
    const items = this.el;
    items.replaceChildren(...entries.filter((x, i, a) => x || (i > 0 && i < a.length - 1 && a[i - 1])).map(x => {
      if (!x) return Object.assign(document.createElement('div'), { className: 'sep', role: 'separator' });
      const b = Object.assign(document.createElement('button'), { type: 'button', textContent: x.label, disabled: !!x.disabled, title: x.title ?? '' });
      b.setAttribute('role', 'menuitem');
      b.addEventListener('click', () => { this.close(true); x.run(); });
      return b;
    }));
    items.hidden = false;
    // A keyboard-opened menu has no pointer position: put it under the element instead.
    const r = target.getBoundingClientRect();
    const fromKeys = e.button !== 2 || (e.clientX === 0 && e.clientY === 0);
    const x = fromKeys ? r.left + 16 : e.clientX, y = fromKeys ? r.bottom : e.clientY;
    const w = items.offsetWidth, h = items.offsetHeight;
    items.style.left = `${Math.max(4, Math.min(x, innerWidth - w - 4))}px`;
    items.style.top = `${Math.max(4, y + h > innerHeight - 4 ? y - h : y)}px`;
    this.buttons()[0]?.focus();
  }

  close(keepFocus: boolean) {
    if (this.el.hidden) return;
    this.el.hidden = true;
    if (!keepFocus) return;
    this.back?.focus();
  }

  private buttons() { return [...this.el.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]; }

  private key(e: KeyboardEvent) {
    const list = this.buttons(), at = list.indexOf(document.activeElement as HTMLButtonElement);
    const move = (i: number) => { e.preventDefault(); list[(i + list.length) % list.length]?.focus(); };
    if (e.key === 'ArrowDown') move(at + 1);
    else if (e.key === 'ArrowUp') move(at - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(list.length - 1);
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); this.close(true); }
  }
}
