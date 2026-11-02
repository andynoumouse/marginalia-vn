// A scroll list that mounts only the rows in (and just around) the viewport, for projects with tens of thousands of lines. Rows have a
// fixed height (long texts scroll inside their cell), which makes the scroll maths trivial. The Voice and Translations dialogs draw their rows with it.

const OVERSCAN = 6;

export class VirtualList<T> {
  private items: T[] = [];
  private readonly mounted = new Map<number, HTMLElement>(); // index into `items` -> its row element
  private frame = 0;

  /** `scroller` is the scrolling element, `spacer` its relatively positioned child that rows are absolutely placed in. */
  constructor(private readonly scroller: HTMLElement, private readonly spacer: HTMLElement, private readonly rowHeight: number,
    private readonly make: (item: T, index: number) => HTMLElement) {
    scroller.addEventListener('scroll', () => this.schedule());
    new ResizeObserver(() => this.schedule()).observe(scroller);
  }

  /** The items to show; every mounted row is rebuilt and the list goes back to the top (unless `keepScroll`). */
  set(items: T[], keepScroll = false) {
    this.items = items;
    for (const el of this.mounted.values()) el.remove();
    this.mounted.clear();
    if (!keepScroll) this.scroller.scrollTop = 0;
    this.spacer.style.height = `${items.length * this.rowHeight}px`;
    this.draw();
  }

  /** Rebuild the row at `index` (when mounted) after its item changed. */
  refresh(index: number) {
    const el = this.mounted.get(index);
    if (!el) return;
    el.remove();
    this.mounted.delete(index);
    this.draw();
  }

  private schedule() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw(); });
  }

  private draw() {
    const first = Math.max(0, Math.floor(this.scroller.scrollTop / this.rowHeight) - OVERSCAN);
    const last = Math.min(this.items.length, Math.ceil((this.scroller.scrollTop + this.scroller.clientHeight) / this.rowHeight) + OVERSCAN);
    for (const [i, el] of this.mounted) {
      if ((i >= first && i < last) || el.contains(document.activeElement)) continue;
      el.remove();
      this.mounted.delete(i);
    }
    for (let i = first; i < last; i++) {
      if (this.mounted.has(i)) continue;
      const el = this.make(this.items[i], i);
      el.style.top = `${i * this.rowHeight}px`;
      this.spacer.append(el);
      this.mounted.set(i, el);
    }
  }
}
